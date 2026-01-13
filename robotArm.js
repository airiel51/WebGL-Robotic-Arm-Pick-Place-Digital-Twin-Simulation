// =========================================================
//  DIGITAL TWIN: INDUSTRIAL ROBOT ARM (With Coord Display)
// =========================================================

// --- 1. GLOBAL VARIABLES ---
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

// Dimensions
var BASE_HEIGHT = 2.0;
var LOWER_ARM_HEIGHT = 20.0; 
var UPPER_ARM_HEIGHT = 15.0;   

// PHYSICS & OFFSET CONSTANTS
var WRIST_OFFSET = 2.4; // Grip Center Offset
var GRIPPER_LENGTH = 2.5;
var FLOOR_LEVEL = 0.75; 

// Colors
const COLOR_BASE   = vec4(0.2, 0.2, 0.2, 1.0); 
const COLOR_ARM    = vec4(1.0, 0.5, 0.0, 1.0); 
const COLOR_JOINT  = vec4(0.1, 0.1, 0.1, 1.0); 
const COLOR_GRIP   = vec4(0.7, 0.7, 0.7, 1.0); 
const COLOR_OBJECT = vec4(0.9, 0.8, 0.0, 1.0); 
const COLOR_DEBUG  = vec4(1.0, 0.0, 0.0, 1.0); 

// State
var objectPos = vec3(15.0, FLOOR_LEVEL, 0.0); 
var dropTarget = vec3(0.0, FLOOR_LEVEL, -12.0); 
var isHeld = false; 
var animating = false;
var animState = 0; 
var waitTimer = 0; 

// Collision Tracker
var gripTipPos = vec3(0, 0, 0); 

// --- 2. INITIALIZATION ---
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

// --- 3. HELPER FUNCTIONS ---
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

// --- 4. RENDER LOOP ---
function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    projectionMatrix = perspective(45, canvas.width/canvas.height, 0.1, 1000.0);
    gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));

    // *** UI UPDATE: DISPLAY COORDINATES ***
    var coordStr = "OBJECT: [" + objectPos[0].toFixed(2) + ", " + objectPos[1].toFixed(2) + ", " + objectPos[2].toFixed(2) + "]";
    document.getElementById("coordText").innerText = coordStr;

    // Camera
    var eye = vec3(0, 60, 90); 
    var at = vec3(0, 5, 0);
    var up = vec3(0, 1, 0);

    var viewMatrix = lookAt(eye, at, up); 
    modelViewMatrix = viewMatrix;         

    if(animating) updateAutoSequence();
    else smoothManualControl();

    // === HIERARCHY ===
    
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
            modelViewMatrix = mult(modelViewMatrix, translate(0, 10.0, 0));
            drawPart(1.8, 20.0, 1.8, COLOR_ARM);
        modelViewMatrix = stack.pop();

        // ELBOW
        stack.push(modelViewMatrix);
             modelViewMatrix = mult(modelViewMatrix, translate(0, 20.0, 0));
             modelViewMatrix = mult(modelViewMatrix, rotate(theta.upper, [0,0,1]));
             drawPart(2.0, 1.5, 2.0, COLOR_JOINT); 
        modelViewMatrix = stack.pop();

        // UPPER ARM
        modelViewMatrix = mult(modelViewMatrix, translate(0, 20.0, 0)); 
        modelViewMatrix = mult(modelViewMatrix, rotate(theta.upper, [0, 0, 1])); 

        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(0, 7.5, 0));
            drawPart(1.5, 15.0, 1.5, COLOR_ARM);
        modelViewMatrix = stack.pop();

        // GRIPPER (Wrist)
        modelViewMatrix = mult(modelViewMatrix, translate(0, 15.0, 0)); 

        // --- VISUAL TRACKING ---
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

// --- 5. LOGIC: PRECISE AUTO SEQUENCE ---

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
            var dx = gripTipPos[0] - objectPos[0];
            var dy = gripTipPos[1] - objectPos[1];
            var dz = gripTipPos[2] - objectPos[2];
            var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            if (dist < 3.0) { 
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
    var armSpeed = 0.05;  
    var gripSpeed = 0.08;
    
    if (waitTimer > 0) {
        waitTimer--;
        return;
    }

    var targetX = objectPos[0];
    var targetY = objectPos[1] + WRIST_OFFSET; 
    var targetZ = objectPos[2];
    var sol; 

    switch(animState) {
    // --- STEP 1: APPROACH (Hover Near) ---
    case 1: 
        // We use objectPos to find the yellow cube [15.0, 0.75, 0.0]
        // WRIST_OFFSET accounts for gripper length
        // + 4.0 keeps it slightly above the object (like your picture)
        sol = solveIK(objectPos[0], objectPos[1] + WRIST_OFFSET + 4.0, objectPos[2]);
        setTarget(sol);
        
        targetTheta.gripper = 1.0; // Open gripper
        
        // When we arrive "near" the object, wait briefly then go to Step 2
        if(checkArrived()) { 
            animState = 2; 
            waitTimer = 15; 
        }
        break;

    // --- STEP 2: SETTLE (Move Down to Grip) ---
    case 2: 
        // Now we remove the extra +4.0 so the gripper surrounds the object
        // The Tips will land exactly at objectPos[1] (0.75)
        sol = solveIK(objectPos[0], objectPos[1] + WRIST_OFFSET, objectPos[2]);
        setTarget(sol);
        
        if(checkArrived()) { 
            animState = 3; 
            waitTimer = 30; 
        }
        break;
       // --- STEP 3: GRIP ---
       case 3: 
           targetTheta.gripper = 0.6; 
           if(Math.abs(theta.gripper - 0.6) < 0.05) {
               isHeld = true; 
               animState = 4;
               setStatus("GRIPPED");
               waitTimer = 20; 
               // Ensure drop target also respects floor level + offset later
               dropTarget = vec3(0.0, FLOOR_LEVEL, -12.0);
           }
           break;

        // --- STEP 4: LIFT ---
        case 4: 
            sol = solveIK(targetX, targetY + 12.0, targetZ); 
            setTarget(sol);
            if(checkArrived()) { animState = 5; waitTimer = 5; }
            break;

        // --- STEP 5: TRAVERSE ---
        case 5: 
            sol = solveIK(dropTarget[0], dropTarget[1] + WRIST_OFFSET + 12.0, dropTarget[2]);
            setTarget(sol);
            if(checkArrived()) { animState = 6; waitTimer = 10; }
            break;
        
        // --- STEP 6: LOWER ---
        case 6: 
            sol = solveIK(dropTarget[0], dropTarget[1] + WRIST_OFFSET, dropTarget[2]);
            setTarget(sol);
            if(checkArrived()) { 
                animState = 7; 
                waitTimer = 30; 
            }
            break;

        // --- STEP 7: RELEASE ---
        case 7: 
            targetTheta.gripper = 1.0; 
            if(theta.gripper >= 0.9) {
                isHeld = false; 
                objectPos = vec3(gripTipPos[0], FLOOR_LEVEL, gripTipPos[2]);
                animState = 8; 
                setStatus("DROPPED");
                waitTimer = 20;
            }
            break;

        // --- STEP 8: HOME ---
        case 8: 
            sol = solveIK(dropTarget[0], dropTarget[1] + WRIST_OFFSET + 8.0, dropTarget[2]);
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

function setTarget(sol) {
    targetTheta.base = sol.base;
    targetTheta.lower = sol.lower;
    targetTheta.upper = sol.upper;
}

function checkArrived() {
    var tol = 0.1; 
    return Math.abs(theta.base - targetTheta.base) < tol && 
           Math.abs(theta.lower - targetTheta.lower) < tol && 
           Math.abs(theta.upper - targetTheta.upper) < tol;
}

function solveIK(tx, ty, tz) {
    var baseRad = Math.atan2(tz, tx);
    var baseDeg = -(baseRad * 180 / Math.PI); 

    var r = Math.sqrt(tx*tx + tz*tz); 
    var h = ty - BASE_HEIGHT; 

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

// --- UTILITIES ---
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

/* // =========================================================
//  DIGITAL TWIN: INDUSTRIAL ROBOT ARM (Realistic Movement)
// =========================================================

// --- 1. GLOBAL VARIABLES ---
var canvas, gl, program;
var numVertices = 36; 
var points = [];
var normals = []; 

// --- 1. INCREASED DIMENSIONS (So it can reach the table) ---
var BASE_HEIGHT      = 2.0;
var BASE_WIDTH       = 5.0;
var LOWER_ARM_HEIGHT = 12.0; // Increased from 5.0
var LOWER_ARM_WIDTH  = 1.0;
var UPPER_ARM_HEIGHT = 10.0; // Increased from 5.0
var UPPER_ARM_WIDTH  = 1.0;

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

// Target State (For smooth animation)
var targetTheta = {
    base: 0,
    lower: 0,
    upper: 0,
    gripper: 1.0
};

// Dimensions (Large Industrial Scale)
var BASE_HEIGHT = 2.0;
var LOWER_ARM_HEIGHT = 20.0; 
var UPPER_ARM_HEIGHT = 15.0;   

// PHYSICS & OFFSET CONSTANTS
var WRIST_OFFSET = 3.2; 
var HOLD_OFFSET = 2.2;  
var FLOOR_LEVEL = 0.75; 

// Colors
const COLOR_BASE   = vec4(0.2, 0.2, 0.2, 1.0); 
const COLOR_ARM    = vec4(1.0, 0.5, 0.0, 1.0); // Industrial Orange
const COLOR_JOINT  = vec4(0.1, 0.1, 0.1, 1.0); 
const COLOR_GRIP   = vec4(0.7, 0.7, 0.7, 1.0); 
const COLOR_OBJECT = vec4(0.9, 0.8, 0.0, 1.0); 
const COLOR_DEBUG  = vec4(1.0, 0.0, 0.0, 1.0); 

// State
var objectPos = vec3(15.0, FLOOR_LEVEL, 0.0); 
var dropTarget = vec3(0.0, FLOOR_LEVEL, 15.0); 
var isHeld = false; 
var animating = false;
var animState = 0; 
var waitTimer = 0; // Delay timer for realism

// Collision Tracker
var gripTipPos = vec3(0, 0, 0); 

// --- 2. INITIALIZATION ---
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

    // 1. Normals Buffer
    var nBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(normals), gl.STATIC_DRAW);
    
    var vNormal = gl.getAttribLocation(program, "vNormal");
    gl.vertexAttribPointer(vNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vNormal);

    // 2. Points Buffer (Crucial Fix: this was missing)
    var vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW);

    var vPosition = gl.getAttribLocation(program, "vPosition");
    gl.vertexAttribPointer(vPosition, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vPosition);

    // 3. Get Matrix Uniforms
    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
    projectionMatrixLoc = gl.getUniformLocation(program, "projectionMatrix");
    
    // 4. Get Color Uniform (Crucial Fix: Removed 'var' and 'colors' array ref)
    colorLoc = gl.getUniformLocation(program, "uColor"); 

    setupUI(); 
    setupKeyboardControl(); 
    render();  
}

// --- 3. HELPER FUNCTIONS ---
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

// --- 4. RENDER LOOP ---
function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    // Setup Projection
    projectionMatrix = perspective(45, canvas.width/canvas.height, 0.1, 1000.0);
    gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));

    // Setup Camera
    var eye = vec3(0, 60, 90); 
    var at = vec3(0, 5, 0);
    var up = vec3(0, 1, 0);
    
    // Save View Matrix
    var viewMatrix = lookAt(eye, at, up); 
    modelViewMatrix = viewMatrix;         

    if(animating) updateAutoSequence();
    else smoothManualControl();

    // === HIERARCHY ===
    
    // BASE
    stack.push(modelViewMatrix);
        // --- FIX IS HERE: Change theta[0] to theta.base ---
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
            modelViewMatrix = mult(modelViewMatrix, translate(0, 10.0, 0));
            drawPart(1.8, 20.0, 1.8, COLOR_ARM);
        modelViewMatrix = stack.pop();

        // ELBOW
        stack.push(modelViewMatrix);
             modelViewMatrix = mult(modelViewMatrix, translate(0, 20.0, 0));
             modelViewMatrix = mult(modelViewMatrix, rotate(theta.upper, [0,0,1]));
             drawPart(2.0, 1.5, 2.0, COLOR_JOINT); 
        modelViewMatrix = stack.pop();

        // UPPER ARM
        modelViewMatrix = mult(modelViewMatrix, translate(0, 20.0, 0)); 
        modelViewMatrix = mult(modelViewMatrix, rotate(theta.upper, [0, 0, 1])); 

        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(0, 7.5, 0));
            drawPart(1.5, 15.0, 1.5, COLOR_ARM);
        modelViewMatrix = stack.pop();

        // GRIPPER (Wrist)
        modelViewMatrix = mult(modelViewMatrix, translate(0, 15.0, 0)); 

        // --- COLLISION LOGIC ---
        var tipMatEye = mult(modelViewMatrix, translate(0, 2.5, 0)); 
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
                modelViewMatrix = mult(modelViewMatrix, translate(0, HOLD_OFFSET, 0)); 
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

// --- 5. LOGIC: REALISTIC PHYSICS ---

// Smoothly interpolates current value to target value
function smoothMove(current, target, speed) {
    var diff = target - current;
    // If very close, snap to target to stop micro-jitter
    if (Math.abs(diff) < 0.05) return target; 
    // Proportional speed: moves fast when far, slow when close (Ease-Out)
    return current + diff * speed; 
}

function smoothManualControl() {
    // In manual mode, keys update targetTheta, this smooths theta
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
        targetTheta.gripper = 0.0; // Target closed
        
        // Logic happens immediately, visual lags slightly
        setTimeout(function() {
            var dx = gripTipPos[0] - objectPos[0];
            var dy = gripTipPos[1] - objectPos[1];
            var dz = gripTipPos[2] - objectPos[2];
            var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            if (dist < 4.0) { 
                isHeld = true;
                setStatus("GRIPPED (Manual)");
            } else {
                isHeld = false;
                setStatus("MISSED (Dist: " + dist.toFixed(1) + ")");
            }
        }, 300); // 300ms delay for grip to physically close
        
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
    // Speed constants
    var armSpeed = 0.05;  
    var gripSpeed = 0.08;
    
    // Global pause logic
    if (waitTimer > 0) {
        waitTimer--;
        return;
    }

    var targetX = objectPos[0];
    var targetY = objectPos[1] + WRIST_OFFSET; 
    var targetZ = objectPos[2];
    var sol; 

    switch(animState) {
       // --- STEP 1: APPROACH & OPEN ---
       case 1: 
            // Hover above the object first
            sol = solveIK(targetX, targetY + 8.0, targetZ);
            setTarget(sol);
            targetTheta.gripper = 1.0; // Open wide
            
            if(checkArrived()) { animState = 2; waitTimer = 10; }
            break;

       // --- STEP 2: DESCEND & TOUCH ---
       case 2: 
            // Move EXACTLY to the object level to "touch" it
            sol = solveIK(targetX, targetY, targetZ);
            setTarget(sol);
            
            if(checkArrived()) { 
                // CRITICAL: We arrived at the cube. 
                // Wait here for 20 frames to simulate "touching" before gripping.
                animState = 3; 
                waitTimer = 20; 
            }
            break;

       // --- STEP 3: GRIP ---
       case 3: 
            targetTheta.gripper = 0.6; // Close gently
            
            if(Math.abs(theta.gripper - 0.6) < 0.05) {
                isHeld = true; 
                animState = 4;
                setStatus("GRIPPED");
                waitTimer = 20; 
                
                // --- TARGET: BACK OF THE BASE ---
                // X = 0 (Center), Z = -12 (Back), Y = Floor
                dropTarget = vec3(0.0, FLOOR_LEVEL, -12.0);
            }
            break;

        // --- STEP 4: LIFT ---
        case 4: 
            sol = solveIK(targetX, targetY + 12.0, targetZ); 
            setTarget(sol);
            if(checkArrived()) { animState = 5; waitTimer = 5; }
            break;

        // --- STEP 5: MOVE TO BACK ---
        case 5: 
            // Move through high center to avoid hitting the base
            sol = solveIK(dropTarget[0], dropTarget[1] + WRIST_OFFSET + 12.0, dropTarget[2]);
            setTarget(sol);
            if(checkArrived()) { animState = 6; waitTimer = 10; }
            break;
        
        // --- STEP 6: LOWER ARM ---
        case 6: 
            // Descend fully to the drop target level
            sol = solveIK(dropTarget[0], dropTarget[1] + WRIST_OFFSET, dropTarget[2]);
            setTarget(sol);
            
            if(checkArrived()) { 
                animState = 7; 
                waitTimer = 20; // Pause at bottom before releasing
            }
            break;

        // --- STEP 7: RELEASE ---
        case 7: 
            targetTheta.gripper = 1.0; // Open
            
            if(theta.gripper >= 0.9) {
                isHeld = false; 
                objectPos = vec3(gripTipPos[0], FLOOR_LEVEL, gripTipPos[2]);
                animState = 8; 
                setStatus("DROPPED AT BACK BASE");
                waitTimer = 20;
            }
            break;

        // --- STEP 8: HOME ---
        case 8: 
            // Lift slightly first
            sol = solveIK(dropTarget[0], dropTarget[1] + WRIST_OFFSET + 8.0, dropTarget[2]);
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

function setTarget(sol) {
    targetTheta.base = sol.base;
    targetTheta.lower = sol.lower;
    targetTheta.upper = sol.upper;
}

function checkArrived() {
    var tol = 0.5; // Stricter tolerance for smoother look
    return Math.abs(theta.base - targetTheta.base) < tol && 
           Math.abs(theta.lower - targetTheta.lower) < tol && 
           Math.abs(theta.upper - targetTheta.upper) < tol;
}

function solveIK(tx, ty, tz) {
    var baseRad = Math.atan2(tz, tx);
    var baseDeg = -(baseRad * 180 / Math.PI); 

    var r = Math.sqrt(tx*tx + tz*tz); 
    var h = ty - BASE_HEIGHT; 

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

// --- UTILITIES ---
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
    // Sliders now update TARGETS, not direct values
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
        var step = 5.0; // Larger step because we are targeting, not moving directly
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
*/

