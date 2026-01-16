// =========================================================
//  DIGITAL TWIN: INDUSTRIAL ROBOT ARM (Long Range & High Posture)
// =========================================================

// 1. GLOBAL VARIABLES
var canvas, gl, program;
var numVertices = 36; 
var points = [];
var normals = []; 

var modelViewMatrix, projectionMatrix;
var modelViewMatrixLoc, projectionMatrixLoc;
var colorLoc; 
var stack = []; 

// Robot State
var theta = {
    base: 0,
    lower: 0,
    upper: 0,
    gripper: 1.0 
};

// Target State
var targetTheta = {
    base: 0,
    lower: 0,
    upper: 0,
    gripper: 1.0
};

// DIMENSION UPDATE: MASSIVE REACH
var BASE_HEIGHT = 2.0;
var LOWER_ARM_HEIGHT = 35.0; 
var UPPER_ARM_HEIGHT = 35.0; 

// PHYSICS & OFFSET CONSTANTS
var WRIST_OFFSET = 2.4; // Grip Center Offset
var FLOOR_LEVEL = 0.75; 

// Colors
const COLOR_BASE   = vec4(0.2, 0.2, 0.2, 1.0); 
const COLOR_ARM    = vec4(1.0, 0.5, 0.0, 1.0); 
const COLOR_JOINT  = vec4(0.1, 0.1, 0.1, 1.0); 
const COLOR_GRIP   = vec4(0.7, 0.7, 0.7, 1.0); 
const COLOR_OBJECT = vec4(0.9, 0.8, 0.0, 1.0); 
const COLOR_DEBUG  = vec4(1.0, 0.0, 0.0, 1.0); 

// State: MOVED OBJECT FARTHER (X=22.0)
var objectPos = vec3(22.0, FLOOR_LEVEL, 0.0); 
var dropTarget = vec3(0.0, FLOOR_LEVEL, -12.0); 
var isHeld = false; 
var animating = false;
var animState = 0; 
var waitTimer = 0; 

// Collision Tracker
var gripTipPos = vec3(0, 0, 0); 

// 2. INITIALIZATION
window.onload = function init() {
    canvas = document.getElementById("gl-canvas");
    gl = canvas.getContext('webgl');
    if (!gl) { alert("WebGL isn't available"); }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.15, 0.15, 0.15, 1.0); 
    gl.enable(gl.DEPTH_TEST);

    buildCube(); 

    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    var nBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(normals), gl.STATIC_DRAW);
    
    var vNormal = gl.getAttribLocation(program, "vNormal");
    gl.vertexAttribPointer(vNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vNormal);

    var pBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW);
    
    var vPosition = gl.getAttribLocation(program, "vPosition");
    gl.vertexAttribPointer(vPosition, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vPosition);

    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
    projectionMatrixLoc = gl.getUniformLocation(program, "projectionMatrix");
    colorLoc = gl.getUniformLocation(program, "uColor"); 

    setupUI(); 
    setupKeyboardControl(); 
    render();  
}

// 3. HELPER FUNCTIONS
function scale4(a, b, c) {
    var result = mat4();
    result[0][0] = a;
    result[1][1] = b;
    result[2][2] = c;
    return result;
}

function drawPart(w, h, d, color) {
    var s = scale4(w, h, d);
    var instanceMatrix = mult(modelViewMatrix, s);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(instanceMatrix));
    gl.uniform4fv(colorLoc, flatten(color));
    gl.drawArrays(gl.TRIANGLES, 0, numVertices);
}

// 4. RENDER LOOP
function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    projectionMatrix = perspective(45, canvas.width/canvas.height, 0.1, 1000.0);
    gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));

    // UI UPDATE: DISPLAY COORDINATES
    var coordStr = "OBJECT: [" + objectPos[0].toFixed(2) + ", " + objectPos[1].toFixed(2) + ", " + objectPos[2].toFixed(2) + "]";
    document.getElementById("coordText").innerText = coordStr;

    // Camera: Moved back to see the larger scene
    var eye = vec3(0, 100, 160); 
    var at = vec3(0, 10, 0);
    var up = vec3(0, 1, 0);

    var viewMatrix = lookAt(eye, at, up); 
    modelViewMatrix = viewMatrix;         

    if(animating) updateAutoSequence();
    else smoothManualControl();

    // HIERARCHY
    
    // BASE
    stack.push(modelViewMatrix);
        modelViewMatrix = mult(modelViewMatrix, rotate(theta.base, [0, 1, 0])); 
        
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(0, 1.0, 0));
            drawPart(8.0, 2.0, 8.0, COLOR_BASE);
        modelViewMatrix = stack.pop();

        // SHOULDER
        stack.push(modelViewMatrix);
             modelViewMatrix = mult(modelViewMatrix, translate(0, 2.0, 0));
             modelViewMatrix = mult(modelViewMatrix, rotate(theta.lower, [0,0,1]));
             drawPart(2.5, 2.0, 2.5, COLOR_JOINT); 
        modelViewMatrix = stack.pop();

        // LOWER ARM
        modelViewMatrix = mult(modelViewMatrix, translate(0, 2.0, 0)); 
        modelViewMatrix = mult(modelViewMatrix, rotate(theta.lower, [0, 0, 1])); 
        
        stack.push(modelViewMatrix);
            // Adjusted draw scaling for new length
            modelViewMatrix = mult(modelViewMatrix, translate(0, LOWER_ARM_HEIGHT/2, 0));
            drawPart(1.8, LOWER_ARM_HEIGHT, 1.8, COLOR_ARM);
        modelViewMatrix = stack.pop();

        // ELBOW
        stack.push(modelViewMatrix);
             modelViewMatrix = mult(modelViewMatrix, translate(0, LOWER_ARM_HEIGHT, 0));
             modelViewMatrix = mult(modelViewMatrix, rotate(theta.upper, [0,0,1]));
             drawPart(2.0, 1.5, 2.0, COLOR_JOINT); 
        modelViewMatrix = stack.pop();

        // UPPER ARM
        modelViewMatrix = mult(modelViewMatrix, translate(0, LOWER_ARM_HEIGHT, 0)); 
        modelViewMatrix = mult(modelViewMatrix, rotate(theta.upper, [0, 0, 1])); 

        stack.push(modelViewMatrix);
            // Adjusted draw scaling for new length
            modelViewMatrix = mult(modelViewMatrix, translate(0, UPPER_ARM_HEIGHT/2, 0));
            drawPart(1.5, UPPER_ARM_HEIGHT, 1.5, COLOR_ARM);
        modelViewMatrix = stack.pop();

        // GRIPPER (Wrist)
        modelViewMatrix = mult(modelViewMatrix, translate(0, UPPER_ARM_HEIGHT, 0)); 

        // VISUAL TRACKING
        var tipMatEye = mult(modelViewMatrix, translate(0, WRIST_OFFSET, 0)); 
        var invView = inverse(viewMatrix);
        var tipMatWorld = mult(invView, tipMatEye);
        gripTipPos = vec3(tipMatWorld[0][3], tipMatWorld[1][3], tipMatWorld[2][3]); 

        // Draw Main Gripper Body
        stack.push(modelViewMatrix);
           drawPart(1.6, 0.6, 1.6, COLOR_GRIP); 
        modelViewMatrix = stack.pop();
        
        var fingerOffset = 0.3 + (theta.gripper * 0.4); 

        // Fingers 
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(-fingerOffset, 2.0, 0));
            drawPart(0.2, 3.0, 0.4, COLOR_GRIP); 
        modelViewMatrix = stack.pop();

        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(fingerOffset, 2.0, 0));
            drawPart(0.2, 3.0, 0.4, COLOR_GRIP); 
        modelViewMatrix = stack.pop();

        // HELD OBJECT
        if(isHeld) {
            stack.push(modelViewMatrix);
                modelViewMatrix = mult(modelViewMatrix, translate(0, WRIST_OFFSET, 0)); 
                drawPart(1.5, 1.5, 1.5, COLOR_OBJECT); 
            modelViewMatrix = stack.pop();
        }

    modelViewMatrix = stack.pop(); 

    // WORLD OBJECT
    if(!isHeld) {
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(objectPos[0], objectPos[1], objectPos[2]));
            drawPart(1.5, 1.5, 1.5, COLOR_OBJECT); 
        modelViewMatrix = stack.pop();
    }
    
    // DEBUG DOT
    stack.push(modelViewMatrix);
        modelViewMatrix = mult(modelViewMatrix, translate(gripTipPos[0], gripTipPos[1], gripTipPos[2]));
        drawPart(0.2, 0.2, 0.2, COLOR_DEBUG); 
    modelViewMatrix = stack.pop();

    // FLOOR
    stack.push(modelViewMatrix);
        modelViewMatrix = mult(modelViewMatrix, translate(0, -1, 0));
        drawPart(60, 0.2, 60, vec4(0.3, 0.3, 0.35, 1.0)); 
    modelViewMatrix = stack.pop();

    requestAnimationFrame(render);
}

// 5. LOGIC: PRECISE AUTO SEQUENCE

function smoothMove(current, target, speed) {
    var diff = target - current;
    if (Math.abs(diff) < 0.05) return target; 
    return current + diff * speed; 
}

function smoothManualControl() {
    var armSpeed = 0.1; 
    theta.base  = smoothMove(theta.base, targetTheta.base, armSpeed);
    theta.lower = smoothMove(theta.lower, targetTheta.lower, armSpeed);
    theta.upper = smoothMove(theta.upper, targetTheta.upper, armSpeed);
    theta.gripper = smoothMove(theta.gripper, targetTheta.gripper, 0.2);
    syncSliders();
}

function toggleGripper() {
    var isClosing = (targetTheta.gripper > 0.5); 
    
    if (isClosing) {
        targetTheta.gripper = 0.0; 
        
        setTimeout(function() {
            var dist = getDistanceToObject();
            if (dist < 4.0) { 
                isHeld = true;
                setStatus("GRIPPED (Manual)");
            } else {
                isHeld = false;
                setStatus("MISSED (Dist: " + dist.toFixed(1) + ")");
            }
        }, 300);
        
    } else {
        targetTheta.gripper = 1.0;
        if (isHeld) {
            isHeld = false;
            objectPos = vec3(gripTipPos[0], FLOOR_LEVEL, gripTipPos[2]);
            setStatus("RELEASED");
        }
    }
}

function updateAutoSequence() {
    var armSpeed = 0.08; 
    var gripSpeed = 0.1;
    
    if (waitTimer > 0) {
        waitTimer--;
        return;
    }

    var targetX = objectPos[0];
    var targetY = objectPos[1] + WRIST_OFFSET; 
    var targetZ = objectPos[2];
    var sol; 

    switch(animState) {
    // STEP 1: APPROACH (Hover)
    case 1: 
        sol = solveIK(objectPos[0], BASE_HEIGHT + 0.1 + 10.0, objectPos[2]);
        setTarget(sol);
        targetTheta.gripper = 1.0; 
        
        if(checkArrived()) { 
            animState = 2; 
            waitTimer = 10; 
        }
        break;

    // STEP 2: DESCEND (Guaranteed Reach)
    case 2: 
        sol = solveIK(objectPos[0], BASE_HEIGHT + 3.0, objectPos[2]);
        setTarget(sol);
        
        var dist = getDistanceToObject();
        setStatus("DESCENDING... H:" + gripTipPos[1].toFixed(1) + " D:" + dist.toFixed(1));
        
        if(checkArrived() && dist < 12.0) {
             animState = 3; 
             waitTimer = 30; 
        }
        break;
       
       // STEP 3: GRIP
       case 3: 
           targetTheta.gripper = 0.6; 
           if(Math.abs(theta.gripper - 0.6) < 0.1) {
               var dist = getDistanceToObject();
               
               if (dist < 12.0) {
                   isHeld = true; 
                   animState = 4;
                   setStatus("GRIPPED (Auto)");
                   waitTimer = 20; 
                   dropTarget = vec3(0.0, FLOOR_LEVEL, -12.0);
               } else {
                   isHeld = false;
                   animating = false;
                   setStatus("MISSED (Dist: " + dist.toFixed(1) + ") - ABORTING");
                   targetTheta.gripper = 1.0; 
               }
           }
           break;

        // STEP 4: LIFT
        case 4: 
            sol = solveIK(targetX, targetY + 12.0, targetZ); 
            setTarget(sol);
            if(checkArrived()) { animState = 5; waitTimer = 10; }
            break;

        // STEP 5: TRAVERSE
        case 5: 
            sol = solveIK(dropTarget[0], BASE_HEIGHT + 0.1 + 12.0, dropTarget[2]);
            setTarget(sol);
            if(checkArrived()) { animState = 6; waitTimer = 15; }
            break;
        
        // STEP 6: LOWER TO DROP
        case 6: 
            sol = solveIK(dropTarget[0], BASE_HEIGHT + 3.0, dropTarget[2]);
            setTarget(sol);
            if(checkArrived()) { 
                animState = 7; 
                waitTimer = 30; 
            }
            break;

        // STEP 7: RELEASE
        case 7: 
            targetTheta.gripper = 1.0; 
            if(theta.gripper >= 0.9) {
                isHeld = false; 
                objectPos = vec3(gripTipPos[0], FLOOR_LEVEL, gripTipPos[2]);
                animState = 8; 
                setStatus("DROPPED");
                waitTimer = 30;
            }
            break;

        // STEP 8: HOME
        case 8: 
            sol = solveIK(dropTarget[0], BASE_HEIGHT + 0.1 + 8.0, dropTarget[2]);
            setTarget(sol);
            if(checkArrived()) {
                 targetTheta.base = 0;
                 targetTheta.lower = 0;
                 targetTheta.upper = 0;
                 animating = false;
                 setStatus("READY");
            }
            break;
    }

    theta.base = smoothMove(theta.base, targetTheta.base, armSpeed);
    theta.lower = smoothMove(theta.lower, targetTheta.lower, armSpeed);
    theta.upper = smoothMove(theta.upper, targetTheta.upper, armSpeed);
    theta.gripper = smoothMove(theta.gripper, targetTheta.gripper, gripSpeed);
    syncSliders();
}

function getDistanceToObject() {
    var dx = gripTipPos[0] - objectPos[0];
    var dy = gripTipPos[1] - objectPos[1];
    var dz = gripTipPos[2] - objectPos[2];
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function setTarget(sol) {
    targetTheta.base = sol.base;
    targetTheta.lower = sol.lower;
    targetTheta.upper = sol.upper;
}

function checkArrived() {
    var tol = 1.0; 
    return Math.abs(theta.base - targetTheta.base) < tol && 
           Math.abs(theta.lower - targetTheta.lower) < tol && 
           Math.abs(theta.upper - targetTheta.upper) < tol;
}

function solveIK(tx, ty, tz) {
    var baseRad = Math.atan2(tz, tx);
    var baseDeg = -(baseRad * 180 / Math.PI); 

    var r = Math.sqrt(tx*tx + tz*tz); 
    var h = ty - BASE_HEIGHT; 

    // USE UPDATED DIMENSIONS
    var L1 = LOWER_ARM_HEIGHT; 
    var L2 = UPPER_ARM_HEIGHT; 
    
    var d = Math.sqrt(r*r + h*h);

    if(d > (L1 + L2)) d = L1 + L2 - 0.01;

    var alpha = Math.atan2(h, r); 
    var cos1 = (L1*L1 + d*d - L2*L2) / (2 * L1 * d);
    var angle1 = Math.acos(Math.max(-1, Math.min(1, cos1)));
    var cos2 = (L1*L1 + L2*L2 - d*d) / (2 * L1 * L2);
    var angle2 = Math.acos(Math.max(-1, Math.min(1, cos2)));

    var thetaL = (alpha + angle1) * (180/Math.PI);
    var thetaU = angle2 * (180/Math.PI);

    var finalLower = 90 - thetaL;
    var finalUpper = thetaU - 180;

    return { base: baseDeg, lower: -finalLower, upper: -finalUpper };
}

// UTILITIES
function buildCube() {
    quad(1, 0, 3, 2, vec3(0, 0, 1)); 
    quad(2, 3, 7, 6, vec3(1, 0, 0)); 
    quad(3, 0, 4, 7, vec3(0, -1, 0)); 
    quad(6, 5, 1, 2, vec3(0, 1, 0)); 
    quad(4, 5, 6, 7, vec3(0, 0, -1)); 
    quad(5, 4, 0, 1, vec3(-1, 0, 0)); 
}
function quad(a, b, c, d, normal) {
    var vertices = [
        vec4(-0.5, -0.5,  0.5, 1.0), vec4(-0.5,  0.5,  0.5, 1.0),
        vec4( 0.5,  0.5,  0.5, 1.0), vec4( 0.5, -0.5,  0.5, 1.0),
        vec4(-0.5, -0.5, -0.5, 1.0), vec4(-0.5,  0.5, -0.5, 1.0),
        vec4( 0.5,  0.5, -0.5, 1.0), vec4( 0.5, -0.5, -0.5, 1.0)
    ];
    var indices = [a, b, c, a, c, d];
    for (var i = 0; i < indices.length; ++i) {
        points.push(vertices[indices[i]]);
        normals.push(normal);
    }
}
function radians(deg) { return deg * Math.PI / 180.0; }

function setupUI() {
    document.getElementById("baseSlider").oninput = function() { targetTheta.base = parseFloat(this.value); };
    document.getElementById("lowerSlider").oninput = function() { targetTheta.lower = parseFloat(this.value); };
    document.getElementById("upperSlider").oninput = function() { targetTheta.upper = parseFloat(this.value); };
    document.getElementById("btnGripper").onclick = toggleGripper;
    document.getElementById("btnAuto").onclick = function() { animating = true; animState = 1; setStatus("INITIATING TRAJECTORY..."); };
    document.getElementById("btnReset").onclick = function() {
        animating = false; animState = 0;
        targetTheta = { base: 0, lower: 0, upper: 0, gripper: 1.0 };
        isHeld = false; objectPos = vec3(15.0, FLOOR_LEVEL, 0.0); 
        setStatus("SYSTEM RESET"); 
    };
}
function setupKeyboardControl() {
    window.addEventListener('keydown', function(event) {
        if(animating) return; 
        var step = 5.0; 
        switch(event.key) {
            case "a": case "A": case "ArrowLeft":  targetTheta.base -= step; break;
            case "d": case "D": case "ArrowRight": targetTheta.base += step; break;
            case "w": case "W": case "ArrowUp":    targetTheta.lower += step; break;
            case "s": case "S": case "ArrowDown":  targetTheta.lower -= step; break;
            case "q": case "Q": targetTheta.upper += step; break;
            case "e": case "E": targetTheta.upper -= step; break;
            case " ": event.preventDefault(); toggleGripper(); break;
        }
    });
}
function syncSliders() {
    document.getElementById("baseSlider").value = theta.base;
    document.getElementById("lowerSlider").value = theta.lower;
    document.getElementById("upperSlider").value = theta.upper;
}
function setStatus(msg) { document.getElementById('statusText').innerText = "STATUS: " + msg; }