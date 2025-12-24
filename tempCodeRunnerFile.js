"use strict";

var canvas, gl, program;

// --- GEOMETRY COUNTS ---
// We will simply reuse the same 36 vertices (a cube) for EVERYTHING.
// We change WHAT we draw by changing the Color Buffer only? 
// No, WebGL 2 needs specific buffers. 
// STRATEGY: We will create one giant buffer with ALL color variations baked in.
// 1. Robot Parts (White/Grey)
// 2. Table (Brown)
// 3. Jig (Blue)
// 4. Object (White)

var NumVertices = 36; 
var points = [];
var colors = [];

// Unit Cube centered at 0,0,0
var vertices = [
    vec4( -0.5, -0.5,  0.5, 1.0 ),
    vec4( -0.5,  0.5,  0.5, 1.0 ),
    vec4(  0.5,  0.5,  0.5, 1.0 ),
    vec4(  0.5, -0.5,  0.5, 1.0 ),
    vec4( -0.5, -0.5, -0.5, 1.0 ),
    vec4( -0.5,  0.5, -0.5, 1.0 ),
    vec4(  0.5,  0.5, -0.5, 1.0 ),
    vec4(  0.5, -0.5, -0.5, 1.0 )
];

// --- COLOR PALETTES (Matches your Image) ---
var robotWhite = [ vec4(0.9,0.9,0.9,1), vec4(0.8,0.8,0.8,1), vec4(0.7,0.7,0.7,1), vec4(0.95,0.95,0.95,1) ];
var tableBrown = [ vec4(0.55,0.35,0.2,1), vec4(0.45,0.25,0.1,1), vec4(0.35,0.15,0.05,1), vec4(0.6,0.4,0.25,1) ];
var jigBlue    = [ vec4(0.0,0.2,0.6,1), vec4(0.0,0.1,0.5,1), vec4(0.0,0.1,0.4,1), vec4(0.0,0.3,0.7,1) ];
var objectGrey = [ vec4(0.9,0.9,0.9,1), vec4(0.85,0.85,0.85,1), vec4(0.8,0.8,0.8,1), vec4(1.0,1.0,1.0,1) ]; // Slightly different white

// --- ROBOT DIMENSIONS ---
var BASE_HEIGHT      = 1.0; // Shorter, sleeker base
var BASE_WIDTH       = 3.0;
var LOWER_ARM_HEIGHT = 6.0;
var LOWER_ARM_WIDTH  = 0.8;
var UPPER_ARM_HEIGHT = 5.0;
var UPPER_ARM_WIDTH  = 0.7;
var GRIPPER_HEIGHT   = 1.5;
var GRIPPER_WIDTH    = 0.6;
var FINGER_HEIGHT    = 1.5;
var FINGER_WIDTH     = 0.15;

var Base = 0;
var LowerArm = 1;
var UpperArm = 2;
var GripperBase = 3;
var FingerOpen = 4;

var theta = [0, 0, 0, 0, 1.0]; 

var modelViewMatrix, projectionMatrix;
var modelViewMatrixLoc;
var vBuffer, cBuffer;

// Animation
var animState = 0; 
var isAnimating = false;
var objectGripped = false;
// Initial position of the object (inside the jig)
var objPos = vec3(5.0, 1.0, 0.0); 

//----------------------------------------------------------------------------

function quad( a, b, c, d, colorSet ) {
    // Fake lighting: cycle through shades for faces
    colors.push(colorSet[a%4]); points.push(vertices[a]);
    colors.push(colorSet[a%4]); points.push(vertices[b]);
    colors.push(colorSet[a%4]); points.push(vertices[c]);
    colors.push(colorSet[a%4]); points.push(vertices[a]);
    colors.push(colorSet[a%4]); points.push(vertices[c]);
    colors.push(colorSet[a%4]); points.push(vertices[d]);
}

function buildColorCube(colorSet) {
    quad( 1, 0, 3, 2, colorSet ); // Front
    quad( 2, 3, 7, 6, colorSet ); // Right
    quad( 3, 0, 4, 7, colorSet ); // Bottom
    quad( 6, 5, 1, 2, colorSet ); // Top
    quad( 4, 5, 6, 7, colorSet ); // Back
    quad( 5, 4, 0, 1, colorSet ); // Left
}

//--------------------------------------------------

window.onload = function init() {
    canvas = document.getElementById( "gl-canvas" );

    gl = canvas.getContext('webgl2');
    if (!gl) { alert( "WebGL 2.0 isn't available" ); }

    gl.viewport( 0, 0, canvas.width, canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 ); // Transparent (shows CSS background)
    gl.enable( gl.DEPTH_TEST );

    program = initShaders( gl, "vertex-shader", "fragment-shader" );
    gl.useProgram( program );

    // --- BUILD BUFFERS ---
    // We append data sequentially:
    // 0-36: Robot (White)
    // 36-72: Table (Brown)
    // 72-108: Jig (Blue)
    // 108-144: Object (White Payload)
    
    buildColorCube(robotWhite);
    buildColorCube(tableBrown);
    buildColorCube(jigBlue);
    buildColorCube(objectGrey);

    vBuffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, vBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW );

    var positionLoc = gl.getAttribLocation( program, "aPosition" );
    gl.vertexAttribPointer( positionLoc, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( positionLoc );

    cBuffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, cBuffer );
    gl.bufferData( gl.ARRAY_BUFFER, flatten(colors), gl.STATIC_DRAW );

    var colorLoc = gl.getAttribLocation( program, "aColor" );
    gl.vertexAttribPointer( colorLoc, 4, gl.FLOAT, false, 0, 0 );
    gl.enableVertexAttribArray( colorLoc );

    // --- UI EVENTS ---
    document.getElementById("slider1").oninput = function(e) { theta[Base] = parseFloat(e.target.value); };
    document.getElementById("slider2").oninput = function(e) { theta[LowerArm] = parseFloat(e.target.value); };
    document.getElementById("slider3").oninput = function(e) { theta[UpperArm] = parseFloat(e.target.value); };
    document.getElementById("slider4").oninput = function(e) { theta[GripperBase] = parseFloat(e.target.value); };
    document.getElementById("slider5").oninput = function(e) { theta[FingerOpen] = parseFloat(e.target.value); };

    document.getElementById("btnAnim").onclick = function() {
        if(!isAnimating) { isAnimating = true; animState = 1; }
    };
    document.getElementById("btnReset").onclick = function() {
        isAnimating = false; animState = 0; objectGripped = false;
        theta = [0, 0, 0, 0, 1.0]; objPos = vec3(5.0, 1.0, 0.0);
        document.getElementById("slider1").value = 0;
        document.getElementById("slider2").value = 0;
        document.getElementById("slider3").value = 0;
    };

    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");

    // Camera Setup (Matches reference perspective)
    var aspect = canvas.width / canvas.height;
    projectionMatrix = perspective(50.0, aspect, 0.1, 100.0);
    gl.uniformMatrix4fv( gl.getUniformLocation(program, "projectionMatrix"),  false, flatten(projectionMatrix) );

    render();
}

// Smooth Helper
function moveTowards(index, target, speed) {
    if (Math.abs(theta[index] - target) < speed) {
        theta[index] = target; return true;
    }
    theta[index] += (theta[index] < target) ? speed : -speed;
    return false;
}

function runAnimationSequence() {
    var speed = 1.0;
    switch(animState) {
        case 1: // Swing to Object
            var r1 = moveTowards(Base, 45, speed);
            var r2 = moveTowards(LowerArm, 30, speed); // Reach out
            var r3 = moveTowards(UpperArm, 30, speed); // Dip down
            if(r1 && r2 && r3) animState = 2;
            break;
        case 2: // Grab
            if(theta[FingerOpen] > 0.6) theta[FingerOpen] -= 0.05;
            else { objectGripped = true; animState = 3; }
            break;
        case 3: // Lift
            var r1 = moveTowards(UpperArm, -10, speed);
            var r2 = moveTowards(LowerArm, 0, speed);
            if(r1 && r2) animState = 4;
            break;
        case 4: // Rotate to drop
            var r1 = moveTowards(Base, -45, speed);
            if(r1) animState = 5;
            break;
        case 5: // Drop
            if(theta[FingerOpen] < 1.2) theta[FingerOpen] += 0.05;
            else { objectGripped = false; objPos = vec3(-5.0, 1.0, 0.0); animState = 6; }
            break;
        case 6: // Reset
            var r1 = moveTowards(Base, 0, speed);
            var r2 = moveTowards(LowerArm, 0, speed);
            var r3 = moveTowards(UpperArm, 0, speed);
            if(r1 && r2 && r3) { isAnimating = false; animState = 0; }
            break;
    }
    // Update Sliders
    document.getElementById("slider1").value = theta[Base];
    document.getElementById("slider2").value = theta[LowerArm];
    document.getElementById("slider3").value = theta[UpperArm];
}

// --- DRAWING FUNCTIONS ---

// 1. Draw ROBOT (Use Vertices 0-36)
function drawRobotPart(w, h, d, tx, ty, tz) {
    var s = scale(w, h, d);
    var t = translate(tx, ty, tz);
    var instanceMatrix = mult(t, s);
    var m = mult(modelViewMatrix, instanceMatrix);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(m));
    gl.drawArrays(gl.TRIANGLES, 0, 36);
}

// 2. Draw TABLE (Use Vertices 36-72)
function drawTable() {
    // Large flattened cube
    var s = scale(20.0, 0.5, 12.0); 
    var t = translate(0.0, -0.25, 0.0); // Just below y=0
    var m = mult(modelViewMatrix, mult(t, s));
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(m));
    gl.drawArrays(gl.TRIANGLES, 36, 36); 
}

// 3. Draw JIG (Use Vertices 72-108, Blue)
function drawJig() {
    // A U-shaped holder at position (5, 0, 0)
    var fixtureMatrix = mult(modelViewMatrix, translate(5.0, 0.25, 0.0));
    
    // Left Wall
    var m1 = mult(fixtureMatrix, mult(translate(0.0, 0.0, -0.6), scale(1.5, 0.5, 0.2)));
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(m1));
    gl.drawArrays(gl.TRIANGLES, 72, 36);

    // Right Wall
    var m2 = mult(fixtureMatrix, mult(translate(0.0, 0.0, 0.6), scale(1.5, 0.5, 0.2)));
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(m2));
    gl.drawArrays(gl.TRIANGLES, 72, 36);
    
    // Back Wall
    var m3 = mult(fixtureMatrix, mult(translate(-0.65, 0.0, 0.0), scale(0.2, 0.5, 1.4)));
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(m3));
    gl.drawArrays(gl.TRIANGLES, 72, 36);
}

// 4. Draw OBJECT (Use Vertices 108-144, White payload)
function drawObject(finalMatrix) {
    var s = scale(0.8, 0.8, 0.8); // Payload size
    var m = mult(finalMatrix, s);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(m));
    gl.drawArrays(gl.TRIANGLES, 108, 36);
}

function render() {
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

    if(isAnimating) runAnimationSequence();

    // Camera: Move back and up to see the table
    var eye = vec3(0.0, 10.0, 20.0);
    var at = vec3(0.0, 2.0, 0.0);
    var up = vec3(0.0, 1.0, 0.0);
    var viewMatrix = lookAt(eye, at, up);
    modelViewMatrix = viewMatrix;

    // --- ENVIRONMENT ---
    drawTable();
    drawJig();

    // --- ROBOT HIERARCHY ---
    
    // Base (Sits on table)
    modelViewMatrix = mult(modelViewMatrix, rotate(theta[Base], vec3(0, 1, 0 )));
    drawRobotPart(BASE_WIDTH, BASE_HEIGHT, BASE_WIDTH, 0, 0.5*BASE_HEIGHT, 0);

    // Lower Arm
    modelViewMatrix = mult(modelViewMatrix, translate(0.0, BASE_HEIGHT, 0.0)); // Move to top of base
    modelViewMatrix = mult(modelViewMatrix, rotate(theta[LowerArm], vec3(0, 0, 1))); // Rotate Z
    drawRobotPart(LOWER_ARM_WIDTH, LOWER_ARM_HEIGHT, LOWER_ARM_WIDTH, 0, 0.5*LOWER_ARM_HEIGHT, 0);

    // Upper Arm
    modelViewMatrix = mult(modelViewMatrix, translate(0.0, LOWER_ARM_HEIGHT, 0.0));
    modelViewMatrix = mult(modelViewMatrix, rotate(theta[UpperArm], vec3(0, 0, 1)));
    drawRobotPart(UPPER_ARM_WIDTH, UPPER_ARM_HEIGHT, UPPER_ARM_WIDTH, 0, 0.5*UPPER_ARM_HEIGHT, 0);

    // Gripper Base
    modelViewMatrix = mult(modelViewMatrix, translate(0.0, UPPER_ARM_HEIGHT, 0.0));
    modelViewMatrix = mult(modelViewMatrix, rotate(theta[GripperBase], vec3(0, 0, 1)));
    drawRobotPart(GRIPPER_WIDTH, GRIPPER_HEIGHT, GRIPPER_WIDTH, 0, 0.5*GRIPPER_HEIGHT, 0);

    var gripperMatrix = modelViewMatrix;

    // Fingers
    modelViewMatrix = mult(gripperMatrix, translate(-0.2 - (theta[FingerOpen]*0.2), GRIPPER_HEIGHT, 0.0));
    drawRobotPart(FINGER_WIDTH, FINGER_HEIGHT, FINGER_WIDTH, 0, 0.5*FINGER_HEIGHT, 0);

    modelViewMatrix = mult(gripperMatrix, translate(0.2 + (theta[FingerOpen]*0.2), GRIPPER_HEIGHT, 0.0));
    drawRobotPart(FINGER_WIDTH, FINGER_HEIGHT, FINGER_WIDTH, 0, 0.5*FINGER_HEIGHT, 0);

    // --- OBJECT ---
    if (objectGripped) {
        // Parented to gripper
        var objectMatrix = mult(gripperMatrix, translate(0.0, GRIPPER_HEIGHT + 0.4, 0.0));
        drawObject(objectMatrix);
    } else {
        // World Space
        var worldMatrix = mult(viewMatrix, translate(objPos[0], objPos[1], objPos[2]));
        // We lift it slightly (0.4) so it sits ON the table (scale 0.8 -> height 0.8 -> center 0.4)
        worldMatrix = mult(worldMatrix, translate(0.0, 0.4, 0.0));
        drawObject(worldMatrix);
    }

    function releaseObject() {
    isGripped = false;

    // 1. Calculate where the object IS right now (while still held)
    // We reuse the logic from the code block above
    let finalGripperPos = mat4.create();
    mat4.multiply(finalGripperPos, baseMatrix, lowerArmMatrix);
    mat4.multiply(finalGripperPos, finalGripperPos, upperArmMatrix);
    
    let offset = mat4.create();
    mat4.fromTranslation(offset, [0, -2.0, 0]); 
    mat4.multiply(finalGripperPos, finalGripperPos, offset);

    // 2. Extract the XYZ translation from that final matrix
    let dropX = finalGripperPos[12];
    let dropY = finalGripperPos[13]; // Usually the floor height (e.g., 0)
    let dropZ = finalGripperPos[14];

    // 3. Update the "World Mode" coordinates to this new spot
    // This ensures that when the else { ... } block runs next frame,
    // the object stays exactly where it was dropped.
    objectWorldPosition = [dropX, 0, dropZ]; // Force Y to 0 if placing on floor
}

    requestAnimationFrame(render);
}