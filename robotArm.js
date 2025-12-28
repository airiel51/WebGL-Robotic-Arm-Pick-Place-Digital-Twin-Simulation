"use strict";

var canvas, gl, program;

var NumVertices = 36; 
var points = [];
var colors = [];

// --- 1. INCREASED DIMENSIONS (So it can reach the table) ---
var BASE_HEIGHT      = 2.0;
var BASE_WIDTH       = 5.0;
var LOWER_ARM_HEIGHT = 12.0; // Increased from 5.0
var LOWER_ARM_WIDTH  = 1.0;
var UPPER_ARM_HEIGHT = 10.0; // Increased from 5.0
var UPPER_ARM_WIDTH  = 1.0;

var modelViewMatrix, projectionMatrix;
var modelViewMatrixLoc;
var stack = []; // Required for hierarchy (Gripper/Fingers)

// Angles: [Base, Lower, Upper, Gripper]
var theta = [0, 0, 0, 0.8]; 

// Object State
var objectPos = vec3(10.0, 0.5, 0.0); // Object location
var isHeld = false;

// Automation State
var animating = false;
var animState = 0; 

// Cube Data
var vertices = [
    vec4( -0.5, -0.5,  0.5, 1.0 ), vec4( -0.5,  0.5,  0.5, 1.0 ),
    vec4(  0.5,  0.5,  0.5, 1.0 ), vec4(  0.5, -0.5,  0.5, 1.0 ),
    vec4( -0.5, -0.5, -0.5, 1.0 ), vec4( -0.5,  0.5, -0.5, 1.0 ),
    vec4(  0.5,  0.5, -0.5, 1.0 ), vec4(  0.5, -0.5, -0.5, 1.0 )
];
var vertexColors = [
    vec4(0,0,0,1), vec4(1,0,0,1), vec4(1,1,0,1), vec4(0,1,0,1),
    vec4(0,0,1,1), vec4(1,0,1,1), vec4(1,1,1,1), vec4(0,1,1,1)
];

window.onload = function init() {
    canvas = document.getElementById( "gl-canvas" );
    gl = WebGLUtils.setupWebGL( canvas );
    if ( !gl ) { alert( "WebGL isn't available" ); }

    gl.viewport( 0, 0, canvas.width, canvas.height );
    gl.clearColor( 0.9, 0.9, 0.9, 1.0 );
    gl.enable( gl.DEPTH_TEST );

    program = initShaders( gl, "vertex-shader", "fragment-shader" );
    gl.useProgram( program );

    colorCube();

    var vBuffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, vBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW );

    var positionLoc = gl.getAttribLocation( program, "vPosition" );
    gl.vertexAttribPointer( positionLoc, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( positionLoc );

    var cBuffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, cBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, flatten(colors), gl.STATIC_DRAW );

    var colorLoc = gl.getAttribLocation( program, "vColor" );
    gl.vertexAttribPointer( colorLoc, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( colorLoc );

    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
    projectionMatrix = perspective(45, canvas.width/canvas.height, 0.1, 1000.0);
    gl.uniformMatrix4fv( gl.getUniformLocation(program, "projectionMatrix"), flatten(projectionMatrix) );

    setupUI();
    render();
}

function quad(a, b, c, d) {
    var indices = [ a, b, c, a, c, d ];
    for ( var i = 0; i < indices.length; ++i ) {
        points.push( vertices[indices[i]] );
        colors.push( vertexColors[a] ); 
    }
}
function colorCube() {
    quad( 1, 0, 3, 2 ); quad( 2, 3, 7, 6 ); quad( 3, 0, 4, 7 );
    quad( 6, 5, 1, 2 ); quad( 4, 5, 6, 7 ); quad( 5, 4, 0, 1 );
}

// --- 2. DRAWING HELPERS ---
function drawBox(w, h, d) {
    var s = scale(w, h, d);
    var instanceMatrix = mult(modelViewMatrix, s);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(instanceMatrix));
    gl.drawArrays(gl.TRIANGLES, 0, NumVertices);
}

// --- 3. MAIN RENDER LOOP ---
function render() {
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

    if(animating) updateAnimation();

    // Zoom Camera Out
    var eye = vec3(0, 20, 60);
    var at = vec3(0, 5, 0);
    var up = vec3(0, 1, 0);
    modelViewMatrix = lookAt(eye, at, up);

    // --- BASE ---
    stack.push(modelViewMatrix);
        modelViewMatrix = mult(modelViewMatrix, rotate(theta[0], [0, 1, 0])); // Base Rotate
        
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(0, BASE_HEIGHT/2, 0));
            drawBox(BASE_WIDTH, BASE_HEIGHT, BASE_WIDTH);
        modelViewMatrix = stack.pop();

        // --- LOWER ARM ---
        modelViewMatrix = mult(modelViewMatrix, translate(0, BASE_HEIGHT, 0));
        modelViewMatrix = mult(modelViewMatrix, rotate(theta[1], [0, 0, 1])); // Lower Rotate
        
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(0, LOWER_ARM_HEIGHT/2, 0));
            drawBox(LOWER_ARM_WIDTH, LOWER_ARM_HEIGHT, LOWER_ARM_WIDTH);
        modelViewMatrix = stack.pop();

        // --- UPPER ARM ---
        modelViewMatrix = mult(modelViewMatrix, translate(0, LOWER_ARM_HEIGHT, 0));
        modelViewMatrix = mult(modelViewMatrix, rotate(theta[2], [0, 0, 1])); // Upper Rotate
        
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(0, UPPER_ARM_HEIGHT/2, 0));
            drawBox(UPPER_ARM_WIDTH, UPPER_ARM_HEIGHT, UPPER_ARM_WIDTH);
        modelViewMatrix = stack.pop();

        // --- GRIPPER (New!) ---
        modelViewMatrix = mult(modelViewMatrix, translate(0, UPPER_ARM_HEIGHT, 0));
        
        // Wrist
        stack.push(modelViewMatrix);
            drawBox(1.5, 0.5, 1.5);
        modelViewMatrix = stack.pop();

        // Fingers (Animated by theta[3])
        var fOff = 0.3 + (theta[3] * 0.4);
        
        // Left Finger
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(-fOff, 1.0, 0));
            drawBox(0.2, 1.5, 0.5);
        modelViewMatrix = stack.pop();

        // Right Finger
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(fOff, 1.0, 0));
            drawBox(0.2, 1.5, 0.5);
        modelViewMatrix = stack.pop();

        // [ATTACHMENT LOGIC]
        if(isHeld) {
            stack.push(modelViewMatrix);
                modelViewMatrix = mult(modelViewMatrix, translate(0, 0.8, 0)); // Position inside hand
                drawBox(1.2, 1.2, 1.2);
            modelViewMatrix = stack.pop();
        }

    modelViewMatrix = stack.pop(); // Restore World

    // Draw Object on Table (If not held)
    if(!isHeld) {
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(objectPos[0], objectPos[1], objectPos[2]));
            drawBox(1.2, 1.2, 1.2);
        modelViewMatrix = stack.pop();
    }

    requestAnimFrame( render );
}

// --- 4. ANIMATION & LOGIC ---
function updateAnimation() {
    var speed = 1.0; 
    
    // --- CALIBRATE YOUR ANGLES HERE ---
    // Use the sliders to find the angles that reach the table (y=0.5)
    // Then replace the numbers below.
    switch(animState) {
        case 1: // Go to Pick
            moveJoint(0, 30, speed);  // Base
            moveJoint(1, 50, speed);  // Lower (Bend Forward)
            moveJoint(2, 40, speed);  // Upper (Reach Down)
            moveJoint(3, 1.0, 0.1);   // Open Gripper
            
            if(isNear(0, 30) && isNear(1, 50) && isNear(2, 40)) animState = 2;
            break;

        case 2: // Grab
            moveJoint(3, 0.0, 0.05); // Close
            if(theta[3] <= 0.1) {
                isHeld = true;
                animState = 3;
            }
            break;

        case 3: // Lift
            moveJoint(1, 0, speed); 
            if(isNear(1, 0)) animState = 4;
            break;

        case 4: // Drop Zone
            moveJoint(0, -90, speed);
            moveJoint(1, 50, speed);
            if(isNear(0, -90) && isNear(1, 50)) animState = 5;
            break;
            
        case 5: // Release
            moveJoint(3, 1.0, 0.05);
            if(theta[3] >= 0.9) {
                isHeld = false;
                
                // NEW: Calculate exact position based on where the arm is NOW
                objectPos = getGripperCoords(); 
                
                // Optional: Force it to hit the 'floor' if it's slightly hovering
                if(objectPos[1] < 0.5) objectPos[1] = 0.5;

                animState = 6;
            }
            break;

        case 6: // Return
            moveJoint(0, 0, speed);
            moveJoint(1, 0, speed);
            moveJoint(2, 0, speed);
            if(isNear(0,0)) animating = false;
            break;
    }
    updateUI();
}

function moveJoint(idx, target, step) {
    if(theta[idx] < target) theta[idx] = Math.min(theta[idx] + step, target);
    if(theta[idx] > target) theta[idx] = Math.max(theta[idx] - step, target);
}
function isNear(idx, target) {
    return Math.abs(theta[idx] - target) < 2.0;
}

function setupUI() {
    document.getElementById("slider1").oninput = function() { theta[0] = parseFloat(this.value); };
    document.getElementById("slider2").oninput = function() { theta[1] = parseFloat(this.value); };
    document.getElementById("slider3").oninput = function() { theta[2] = parseFloat(this.value); };
    document.getElementById("slider4").oninput = function() { theta[3] = parseFloat(this.value); };
    
    document.getElementById("btn-start").onclick = function() { animating = true; animState = 1; };
    document.getElementById("btn-reset").onclick = function() { 
        animating = false; animState = 0; 
        theta = [0,0,0,0.8]; isHeld = false; objectPos = vec3(10, 0.5, 0); 
        updateUI();
    };
}
function updateUI() {
    document.getElementById("slider1").value = theta[0];
    document.getElementById("slider2").value = theta[1];
    document.getElementById("slider3").value = theta[2];
    document.getElementById("slider4").value = theta[3];

// --- HELPER: CALCULATE EXACT GRIPPER POSITION ---
function getGripperCoords() {
    // 1. Convert degrees to radians
    var b = radians(theta[0]); // Base
    var l = radians(theta[1]); // Lower
    var u = radians(theta[2]); // Upper

    // 2. Calculate planar distance (2D side view)
    // Lower Arm Vector
    var h1_y = LOWER_ARM_HEIGHT * Math.cos(l);
    var h1_x = -LOWER_ARM_HEIGHT * Math.sin(l);

    // Upper Arm Vector (Relative to Lower)
    var h2_y = UPPER_ARM_HEIGHT * Math.cos(l + u);
    var h2_x = -UPPER_ARM_HEIGHT * Math.sin(l + u);

    // Gripper Offset (Approx 1.0 unit from wrist)
    var h3_y = 1.0 * Math.cos(l + u);
    var h3_x = -1.0 * Math.sin(l + u);

    // 3. Sum up the heights (Y) and radii (X)
    var total_y = BASE_HEIGHT + h1_y + h2_y + h3_y;
    var radius  = h1_x + h2_x + h3_x;

    // 4. Rotate around Base (Y-axis)
    var final_x = radius * Math.cos(b);
    var final_z = -radius * Math.sin(b); // Negative because of WebGL RH coords

    return vec3(final_x, total_y, final_z);
}

}