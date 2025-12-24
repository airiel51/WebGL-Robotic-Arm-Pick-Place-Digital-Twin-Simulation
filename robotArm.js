"use strict";

var canvas, gl, program;

var NumVertices = 36; //(6 faces)(2 triangles/face)(3 vertices/triangle)

var points = [];
var colors = [];

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

// RGBA colors
var vertexColors = [
    vec4( 0.0, 0.0, 0.0, 1.0 ),  // black
    vec4( 1.0, 0.0, 0.0, 1.0 ),  // red
    vec4( 1.0, 1.0, 0.0, 1.0 ),  // yellow
    vec4( 0.0, 1.0, 0.0, 1.0 ),  // green
    vec4( 0.0, 0.0, 1.0, 1.0 ),  // blue
    vec4( 1.0, 0.0, 1.0, 1.0 ),  // magenta
    vec4( 1.0, 1.0, 1.0, 1.0 ),  // white
    vec4( 0.0, 1.0, 1.0, 1.0 )   // cyan
];


// --- ROBOT DIMENSIONS ---
var BASE_HEIGHT      = 2.0;
var BASE_WIDTH       = 5.0;
var LOWER_ARM_HEIGHT = 5.0;
var LOWER_ARM_WIDTH  = 0.5;
var UPPER_ARM_HEIGHT = 5.0;
var UPPER_ARM_WIDTH  = 0.5;

// NEW: Dimensions for the Gripper parts
var GRIPPER_HEIGHT   = 1.5;
var GRIPPER_WIDTH    = 0.6;
var FINGER_HEIGHT    = 1.5;
var FINGER_WIDTH     = 0.2;

// --- ANGLES & STATE ---
var Base = 0;
var LowerArm = 1;
var UpperArm = 2;
var GripperBase = 3;
var FingerOpen = 4;

// Default angles
var theta = [0, 0, 0, 0, 1.0]; 

var modelViewMatrix, projectionMatrix;
var modelViewMatrixLoc;
var vBuffer, cBuffer;

// --- ANIMATION VARIABLES ---
var animState = 0; 
var isAnimating = false;
var objectGripped = false;

// Object positions
var objPos = vec3(4.0, 0.5, 0.0); 
var targetPos = vec3(-4.0, 0.5, 0.0);

//----------------------------------------------------------------------------

function quad( a, b, c, d ) {
    colors.push(vertexColors[a]);
    points.push(vertices[a]);
    colors.push(vertexColors[a]);
    points.push(vertices[b]);
    colors.push(vertexColors[a]);
    points.push(vertices[c]);
    colors.push(vertexColors[a]);
    points.push(vertices[a]);
    colors.push(vertexColors[a]);
    points.push(vertices[c]);
    colors.push(vertexColors[a]);
    points.push(vertices[d]);
}

function colorCube() {
    quad( 1, 0, 3, 2 );
    quad( 2, 3, 7, 6 );
    quad( 3, 0, 4, 7 );
    quad( 6, 5, 1, 2 );
    quad( 4, 5, 6, 7 );
    quad( 5, 4, 0, 1 );
}

//--------------------------------------------------

window.onload = function init() {
    canvas = document.getElementById( "gl-canvas" );

    gl = canvas.getContext('webgl2');
    if (!gl) { alert( "WebGL 2.0 isn't available" ); }

    gl.viewport( 0, 0, canvas.width, canvas.height );
    gl.clearColor( 1.0, 1.0, 1.0, 1.0 );
    gl.enable( gl.DEPTH_TEST );

    program = initShaders( gl, "vertex-shader", "fragment-shader" );
    gl.useProgram( program );

    colorCube();

    // Buffers
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

    // --- EVENT LISTENERS ---
    document.getElementById("slider1").oninput = function(event) {
        theta[Base] = parseFloat(event.target.value);
    };
    document.getElementById("slider2").oninput = function(event) {
         theta[LowerArm] = parseFloat(event.target.value);
    };
    document.getElementById("slider3").oninput = function(event) {
         theta[UpperArm] =  parseFloat(event.target.value);
    };
    
    // Check if new sliders exist before attaching
    if(document.getElementById("slider4")) {
        document.getElementById("slider4").oninput = function(event) {
            theta[GripperBase] = parseFloat(event.target.value);
        };
    }
    if(document.getElementById("slider5")) {
        document.getElementById("slider5").oninput = function(event) {
            theta[FingerOpen] = parseFloat(event.target.value);
        };
    }
    if(document.getElementById("btnAnim")) {
        document.getElementById("btnAnim").onclick = function() {
            if(!isAnimating) {
                isAnimating = true;
                animState = 1;
                document.getElementById("status").innerText = "Status: Moving to Object...";
            }
        };
    }
    if(document.getElementById("btnReset")) {
        document.getElementById("btnReset").onclick = function() {
            isAnimating = false;
            animState = 0;
            objectGripped = false;
            theta = [0, 0, 0, 0, 1.0];
            objPos = vec3(4.0, 0.5, 0.0);
            document.getElementById("status").innerText = "Status: Reset";
            // Update UI
            document.getElementById("slider1").value = 0;
            document.getElementById("slider2").value = 0;
            document.getElementById("slider3").value = 0;
            if(document.getElementById("slider4")) document.getElementById("slider4").value = 0;
            if(document.getElementById("slider5")) document.getElementById("slider5").value = 1.0;
        };
    }

    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");

    // Increased view volume to see full arm
    projectionMatrix = ortho(-20, 20, -20, 20, -20, 20);
    gl.uniformMatrix4fv( gl.getUniformLocation(program, "projectionMatrix"),  false, flatten(projectionMatrix) );

    render();
}

//----------------------------------------------------------------------------

function base() {
    var s = scale(BASE_WIDTH, BASE_HEIGHT, BASE_WIDTH);
    var instanceMatrix = mult( translate( 0.0, 0.5 * BASE_HEIGHT, 0.0 ), s);
    var t = mult(modelViewMatrix, instanceMatrix);
    gl.uniformMatrix4fv(modelViewMatrixLoc,  false, flatten(t)  );
    gl.drawArrays( gl.TRIANGLES, 0, NumVertices );
}

function upperArm() {
    var s = scale(UPPER_ARM_WIDTH, UPPER_ARM_HEIGHT, UPPER_ARM_WIDTH);
    var instanceMatrix = mult(translate( 0.0, 0.5 * UPPER_ARM_HEIGHT, 0.0 ),s);
    var t = mult(modelViewMatrix, instanceMatrix);
    gl.uniformMatrix4fv( modelViewMatrixLoc,  false, flatten(t)  );
    gl.drawArrays( gl.TRIANGLES, 0, NumVertices );
}

function lowerArm() {
    var s = scale(LOWER_ARM_WIDTH, LOWER_ARM_HEIGHT, LOWER_ARM_WIDTH);
    var instanceMatrix = mult( translate( 0.0, 0.5 * LOWER_ARM_HEIGHT, 0.0 ), s);
    var t = mult(modelViewMatrix, instanceMatrix);
    gl.uniformMatrix4fv( modelViewMatrixLoc,  false, flatten(t)   );
    gl.drawArrays( gl.TRIANGLES, 0, NumVertices );
}

function gripperBase() {
    var s = scale(GRIPPER_WIDTH, GRIPPER_HEIGHT, GRIPPER_WIDTH);
    var instanceMatrix = mult(translate(0.0, 0.5 * GRIPPER_HEIGHT, 0.0), s);
    var t = mult(modelViewMatrix, instanceMatrix);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(t));
    gl.drawArrays(gl.TRIANGLES, 0, NumVertices);
}

function leftFinger() {
    var s = scale(FINGER_WIDTH, FINGER_HEIGHT, FINGER_WIDTH);
    var instanceMatrix = mult(translate(0.0, 0.5 * FINGER_HEIGHT, 0.0), s);
    var t = mult(modelViewMatrix, instanceMatrix);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(t));
    gl.drawArrays(gl.TRIANGLES, 0, NumVertices);
}

function rightFinger() {
    var s = scale(FINGER_WIDTH, FINGER_HEIGHT, FINGER_WIDTH);
    var instanceMatrix = mult(translate(0.0, 0.5 * FINGER_HEIGHT, 0.0), s);
    var t = mult(modelViewMatrix, instanceMatrix);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(t));
    gl.drawArrays(gl.TRIANGLES, 0, NumVertices);
}

function drawPickableObject(finalMatrix) {
    var s = scale(1.0, 1.0, 1.0); 
    // Just drawing the same cube again with the passed matrix
    var t = mult(finalMatrix, s);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(t));
    gl.drawArrays(gl.TRIANGLES, 0, NumVertices);
}

//----------------------------------------------------------------------------

function runAnimationSequence() {
    var speed = 1.0; 

    switch(animState) {
        case 1: // Move to Object
            if(theta[Base] < 45) theta[Base] += speed;
            if(theta[LowerArm] < 30) theta[LowerArm] += speed;
            if(theta[UpperArm] < 45) theta[UpperArm] += speed;
            
            if(theta[Base] >= 45 && theta[UpperArm] >= 45) {
                animState = 2;
                document.getElementById("status").innerText = "Status: Gripping...";
            }
            break;

        case 2: // Grip
            if(theta[FingerOpen] > 0.4) {
                theta[FingerOpen] -= 0.05;
            } else {
                objectGripped = true; 
                animState = 3;
                document.getElementById("status").innerText = "Status: Lifting...";
            }
            break;

        case 3: // Lift
            if(theta[LowerArm] > 0) theta[LowerArm] -= speed;
            if(theta[UpperArm] > 0) theta[UpperArm] -= speed;
            
            if(theta[LowerArm] <= 0 && theta[UpperArm] <= 0) {
                animState = 4;
                document.getElementById("status").innerText = "Status: Moving to Target...";
            }
            break;

        case 4: // Move to Target 
            if(theta[Base] > -45) theta[Base] -= speed;
            
            if(theta[Base] <= -45) {
                animState = 5;
                document.getElementById("status").innerText = "Status: Releasing...";
            }
            break;

        case 5: // Release
            if(theta[FingerOpen] < 1.0) {
                theta[FingerOpen] += 0.05;
            } else {
                objectGripped = false;
                objPos = vec3(-4.0, 0.5, 0.0); // Drop location
                
                animState = 0;
                isAnimating = false;
                document.getElementById("status").innerText = "Status: Done (Idle)";
            }
            break;
    }
}

//----------------------------------------------------------------------------

function render() {
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

    // IMPORTANT: Reset Matrix
    modelViewMatrix = mat4();

    if(isAnimating) {
        runAnimationSequence();
    }

    // 1. BASE
    modelViewMatrix = mult(modelViewMatrix, rotate(theta[Base], vec3(0, 1, 0 )));
    base();

    // 2. LOWER ARM
    modelViewMatrix = mult(modelViewMatrix, translate(0.0, BASE_HEIGHT, 0.0));
    modelViewMatrix = mult(modelViewMatrix, rotate(theta[LowerArm], vec3(0, 0, 1 )));
    lowerArm();

    // 3. UPPER ARM
    modelViewMatrix  = mult(modelViewMatrix, translate(0.0, LOWER_ARM_HEIGHT, 0.0));
    modelViewMatrix  = mult(modelViewMatrix, rotate(theta[UpperArm], vec3(0, 0, 1)) );
    upperArm();

    // 4. GRIPPER BASE
    modelViewMatrix  = mult(modelViewMatrix, translate(0.0, UPPER_ARM_HEIGHT, 0.0));
    modelViewMatrix  = mult(modelViewMatrix, rotate(theta[GripperBase], vec3(0, 0, 1)) );
    gripperBase();

    var gripperMatrix = modelViewMatrix;

    // 5. LEFT FINGER
    modelViewMatrix = mult(gripperMatrix, translate(-0.2 - (theta[FingerOpen]*0.2), GRIPPER_HEIGHT, 0.0));
    leftFinger();

    // 6. RIGHT FINGER
    modelViewMatrix = mult(gripperMatrix, translate(0.2 + (theta[FingerOpen]*0.2), GRIPPER_HEIGHT, 0.0));
    rightFinger();

    // 7. OBJECT
    if (objectGripped) {
        var objectMatrix = mult(gripperMatrix, translate(0.0, GRIPPER_HEIGHT + 0.5, 0.0));
        drawPickableObject(objectMatrix);
    } else {
        var worldMatrix = mat4();
        worldMatrix = mult(worldMatrix, translate(objPos[0], objPos[1], objPos[2]));
        drawPickableObject(worldMatrix);
    }

    requestAnimationFrame(render);
}