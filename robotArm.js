// --- GLOBAL VARIABLES ---
var canvas, gl, program;

var numVertices = 36; 
var points = [];
var colors = [];

// Matrix Variables
var modelViewMatrix, projectionMatrix;
var modelViewMatrixLoc, projectionMatrixLoc;
var stack = []; // The Matrix Stack for Hierarchy

// Robot Parameters (Angles in degrees)
var theta = {
    base: 0,
    lower: 0,
    upper: 0,
    gripper: 0.8 // 1.0 = Fully Open, 0.0 = Fully Closed
};

// Dimensions (Matches standard Angel code style)
// Dimensions
var BASE_HEIGHT = 2.0;
var BASE_WIDTH = 5.0;

// CHANGE THESE TWO:
var LOWER_ARM_HEIGHT = 20.0; // Was 8.0 (Doubled reach)
var LOWER_ARM_WIDTH = 1.0;   // Kept thin

var UPPER_ARM_HEIGHT = 15.0; // Was 6.0 (Doubled reach)
var UPPER_ARM_WIDTH = 1.0;   // Kept thin

// Object & Animation State
var objectPos = vec3(0.0, 0.5, 0.0); // Changed X from 6.0 to 15.0 // Initial location of the target object
var isHeld = false; // The "Attachment Trick" flag
var animating = false;
var animState = 0; // State Machine Index

// Initialization
window.onload = function init() {
    canvas = document.getElementById("gl-canvas");
    gl = WebGLUtils.setupWebGL(canvas);
    if (!gl) { alert("WebGL isn't available"); }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.95, 0.95, 0.95, 1.0); // Light gray background
    gl.enable(gl.DEPTH_TEST);

    // Generate Cube Data
    colorCube();

    // Load Shaders
    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    // Buffer Setup
    var cBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(colors), gl.STATIC_DRAW);
    
    var vColor = gl.getAttribLocation(program, "vColor");
    gl.vertexAttribPointer(vColor, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vColor);

    var vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(points), gl.STATIC_DRAW);

    var vPosition = gl.getAttribLocation(program, "vPosition");
    gl.vertexAttribPointer(vPosition, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vPosition);

    modelViewMatrixLoc = gl.getUniformLocation(program, "modelViewMatrix");
    projectionMatrixLoc = gl.getUniformLocation(program, "projectionMatrix");

    setupUI(); // Attach event listeners
    render();  // Start loop
}

// --- HIERARCHY HELPER ---
function scale4(a, b, c) {
    var result = mat4();
    result[0][0] = a;
    result[1][1] = b;
    result[2][2] = c;
    return result;
}

// --- DRAWING FUNCTION ---
function drawPart(w, h, d) {
    var s = scale4(w, h, d);
    var instanceMatrix = mult(modelViewMatrix, s);
    gl.uniformMatrix4fv(modelViewMatrixLoc, false, flatten(instanceMatrix));
    gl.drawArrays(gl.TRIANGLES, 0, numVertices);
}

// --- MAIN RENDER LOOP ---
function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Camera Settings
    projectionMatrix = perspective(45, canvas.width/canvas.height, 0.1, 100.0);
    gl.uniformMatrix4fv(projectionMatrixLoc, false, flatten(projectionMatrix));

    // Inside render() function:
var eye = vec3(0, 20, 60); // Moved Z back to 60, Y up to 20
    var at = vec3(0, 0, 0);
    var up = vec3(0, 1, 0);
    modelViewMatrix = lookAt(eye, at, up);

    // Update Animation State
    if(animating) updateAnimation();

    // --- HIERARCHY TREE START ---
    
    // 1. BASE
    stack.push(modelViewMatrix);
        modelViewMatrix = mult(modelViewMatrix, rotate(theta.base, [0, 1, 0]));
        
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(0, 1.0, 0));
            drawPart(BASE_WIDTH, BASE_HEIGHT, BASE_WIDTH);
        modelViewMatrix = stack.pop();

        // 2. LOWER ARM
        modelViewMatrix = mult(modelViewMatrix, translate(0, BASE_HEIGHT, 0)); 
        modelViewMatrix = mult(modelViewMatrix, rotate(theta.lower, [0, 0, 1])); 
        
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(0, LOWER_ARM_HEIGHT/2, 0));
            drawPart(LOWER_ARM_WIDTH, LOWER_ARM_HEIGHT, LOWER_ARM_WIDTH);
        modelViewMatrix = stack.pop();

        // 3. UPPER ARM
        modelViewMatrix = mult(modelViewMatrix, translate(0, LOWER_ARM_HEIGHT, 0)); 
        modelViewMatrix = mult(modelViewMatrix, rotate(theta.upper, [0, 0, 1])); 

        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(0, UPPER_ARM_HEIGHT/2, 0));
            drawPart(UPPER_ARM_WIDTH, UPPER_ARM_HEIGHT, UPPER_ARM_WIDTH);
        modelViewMatrix = stack.pop();

        // 4. GRIPPER ASSEMBLY (Wrist + Fingers)
        modelViewMatrix = mult(modelViewMatrix, translate(0, UPPER_ARM_HEIGHT, 0)); 

        // Wrist Block
        stack.push(modelViewMatrix);
           drawPart(1.2, 0.5, 1.2); 
        modelViewMatrix = stack.pop();
        
        // Calculate Finger Position based on Slider
        var fingerOffset = 0.3 + (theta.gripper * 0.4); 

        // Left Finger
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(-fingerOffset, 1.0, 0));
            drawPart(0.2, 1.5, 0.5);
        modelViewMatrix = stack.pop();

        // Right Finger
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(fingerOffset, 1.0, 0));
            drawPart(0.2, 1.5, 0.5);
        modelViewMatrix = stack.pop();

        // [CRITICAL] THE ATTACHMENT TRICK
        // If the object is "held", we draw it HERE, inside the Gripper's matrix stack.
        // It becomes a child of the gripper and moves with it automatically.
        // Inside render() function, inside the Gripper hierarchy:

if(isHeld) {
    stack.push(modelViewMatrix);
        // PROBLEM: This line decides where the object sits in the gripper
        // If it snaps too high/low, change the Y value (currently 1.0)
        // If it snaps too forward/back, change the X value (currently 0)
        modelViewMatrix = mult(modelViewMatrix, translate(0, 1.0, 0)); 
        
        drawPart(1.0, 1.0, 1.0); // The Object
    modelViewMatrix = stack.pop();
}

    modelViewMatrix = stack.pop(); // Pop back to World Coordinates
    // --- HIERARCHY TREE END ---

    // [CRITICAL] Draw Object in World (if NOT held)
    if(!isHeld) {
        stack.push(modelViewMatrix);
            modelViewMatrix = mult(modelViewMatrix, translate(objectPos[0], objectPos[1], objectPos[2]));
            drawPart(1.0, 1.0, 1.0); // The Object
        modelViewMatrix = stack.pop();
    }

    requestAnimFrame(render);
}

// --- ANIMATION STATE MACHINE ---
function updateAnimation() {
    var speed = 1.5; 

    switch(animState) {
       // Inside script.js -> updateAnimation()

case 1: // Move to Pickup Position
    // REPLACE THESE NUMBERS with the ones you wrote down!
    // Example: If your manual test showed Base=42, Lower=15...
    moveServo('base', 42, speed);   // <--- CHANGE THIS
    moveServo('lower', 15, speed);  // <--- CHANGE THIS
    moveServo('upper', -10, speed); // <--- CHANGE THIS
    moveServo('gripper', 1.0, 0.1); 
    
    // ALSO UPDATE the check function to match!
    if(isNear(42, 15, -10)) animState = 2; // <--- CHANGE THIS
    break;

       case 2: // Grasp
    moveServo('gripper', 0.0, 0.05);
    
    // Debugging line:
    console.log("Gripper Angle:", theta.gripper); 

    if(theta.gripper <= 0.1) {
        console.log("GRABBED!"); // <--- Watch for this in the console
        isHeld = true; 
        animState = 3;
    }
    break;

        case 3: // Lift & Rotate
            moveServo('base', -90, speed); 
            moveServo('lower', 0, speed);  
            if(isNear(-90, 0, 45)) animState = 4;
            break;

        case 4: // Move to Drop Position
            // Try these angles to reach closer to the floor/table
            // Adjust '80' and '50' until it touches your floor
            moveServo('lower', 80, speed); 
            moveServo('upper', 50, speed); 
            
            if(isNear(-90, 80, 50)) animState = 5;
            break;
        
        case 5: // Release
            moveServo('gripper', 1.0, 0.05); // Open Gripper
            
            if(theta.gripper >= 0.9) {
                isHeld = false; // Detach object from arm

                // [NEW CODE] Calculate exact drop position
                // The object will stay exactly where the gripper is now.
                objectPos = getGripperWorldPos(); 
                
                // Optional: Force Y to floor level if you want it to land on a table
                // objectPos[1] = 0.5; 

                animState = 6; // Move to Return
            }
            break;

        case 6: // Return Home
            moveServo('base', 0, speed);
            moveServo('lower', 0, speed);
            moveServo('upper', 0, speed);
            if(isNear(0, 0, 0)) {
                animating = false;
                document.getElementById('status-text').innerText = "STATUS: CYCLE COMPLETE";
            }
            break;
    }
    updateUIValues();
}

// --- HELPER: CALCULATE REAL WORLD POSITION OF GRIPPER ---
function getGripperWorldPos() {
    // 1. Convert angles to Radians
    var b = theta.base * (Math.PI / 180);
    var l = theta.lower * (Math.PI / 180);
    var u = theta.upper * (Math.PI / 180);

    // 2. Calculate dimensions (Planar math on XY plane)
    // We start from the base and add vectors for Lower Arm, Upper Arm, and Gripper Offset
    
    // Lower Arm Vector
    // NOTE: Angles in WebGL rotation usually go counter-clockwise.
    // We project the arm lengths onto Y (height) and X (horizontal)
    var h1_y = LOWER_ARM_HEIGHT * Math.cos(l);
    var h1_x = -LOWER_ARM_HEIGHT * Math.sin(l);

    // Upper Arm Vector (Adds to Lower Arm angles)
    var h2_y = UPPER_ARM_HEIGHT * Math.cos(l + u);
    var h2_x = -UPPER_ARM_HEIGHT * Math.sin(l + u);
    
    // Gripper Offset (The object sits about 1.0 unit inside/below the wrist)
    var h3_y = 1.0 * Math.cos(l + u); 
    var h3_x = -1.0 * Math.sin(l + u);

    // 3. Sum them up to get position relative to the Base
    var total_y = BASE_HEIGHT + h1_y + h2_y + h3_y;
    var total_x_planar = h1_x + h2_x + h3_x;

    // 4. Apply Base Rotation (Y-axis) to the planar X distance
    var final_x = total_x_planar * Math.cos(b);
    var final_z = -total_x_planar * Math.sin(b); // Z comes from rotating X around Y

    return vec3(final_x, total_y, final_z);
}

// Moves a joint towards a target by a small step
function moveServo(joint, target, step) {
    if(theta[joint] < target) theta[joint] = Math.min(theta[joint] + step, target);
    if(theta[joint] > target) theta[joint] = Math.max(theta[joint] - step, target);
}

// Checks if the arm has reached the target angles
function isNear(b, l, u) {
    var tol = 2.0; // Tolerance in degrees
    return Math.abs(theta.base - b) < tol && 
           Math.abs(theta.lower - l) < tol && 
           Math.abs(theta.upper - u) < tol;
}

// --- SETUP HELPERS ---
function colorCube() {
    quad(1, 0, 3, 2);
    quad(2, 3, 7, 6);
    quad(3, 0, 4, 7);
    quad(6, 5, 1, 2);
    quad(4, 5, 6, 7);
    quad(5, 4, 0, 1);
}

function quad(a, b, c, d) {
    var vertices = [
        vec4(-0.5, -0.5,  0.5, 1.0), vec4(-0.5,  0.5,  0.5, 1.0),
        vec4( 0.5,  0.5,  0.5, 1.0), vec4( 0.5, -0.5,  0.5, 1.0),
        vec4(-0.5, -0.5, -0.5, 1.0), vec4(-0.5,  0.5, -0.5, 1.0),
        vec4( 0.5,  0.5, -0.5, 1.0), vec4( 0.5, -0.5, -0.5, 1.0)
    ];
    // Specific colors for faces to verify 3D
    var vertexColors = [
        [0.1, 0.1, 0.1, 1.0], [0.8, 0.0, 0.0, 1.0], // Black, Red
        [1.0, 1.0, 0.0, 1.0], [0.0, 1.0, 0.0, 1.0], // Yellow, Green
        [0.0, 0.0, 1.0, 1.0], [1.0, 0.0, 1.0, 1.0], // Blue, Magenta
        [0.0, 1.0, 1.0, 1.0], [1.0, 1.0, 1.0, 1.0]  // Cyan, White
    ];
    var indices = [a, b, c, a, c, d];
    for (var i = 0; i < indices.length; ++i) {
        points.push(vertices[indices[i]]);
        colors.push(vertexColors[a]); 
    }
}

function setupUI() {
    // Sliders
    document.getElementById("slider-base").oninput = function() { 
        theta.base = parseFloat(this.value); updateUIValues(); 
    };
    document.getElementById("slider-lower").oninput = function() { 
        theta.lower = parseFloat(this.value); updateUIValues(); 
    };
    document.getElementById("slider-upper").oninput = function() { 
        theta.upper = parseFloat(this.value); updateUIValues(); 
    };
    document.getElementById("slider-gripper").oninput = function() { 
        theta.gripper = parseFloat(this.value); updateUIValues(); 
    };
    
    // Buttons
    document.getElementById("btn-anim").onclick = function() { 
        animating = true; 
        animState = 1; 
        document.getElementById('status-text').innerText = "STATUS: AUTO-SEQUENCE RUNNING...";
    };
    document.getElementById("btn-reset").onclick = function() { 
        animating = false; 
        animState = 0; 
        theta = {base:0, lower:0, upper:0, gripper:0.8}; 
        isHeld = false;
        objectPos = vec3(6.0, 0.5, 0.0); // Reset Object
        updateUIValues();
        document.getElementById('status-text').innerText = "STATUS: RESET";
    };
}

function updateUIValues() {
    // Update Slider Positions
    document.getElementById("slider-base").value = theta.base;
    document.getElementById("slider-lower").value = theta.lower;
    document.getElementById("slider-upper").value = theta.upper;
    document.getElementById("slider-gripper").value = theta.gripper;

    // Update Text Labels
    document.getElementById("val-base").innerText = Math.round(theta.base) + "°";
    document.getElementById("val-lower").innerText = Math.round(theta.lower) + "°";
    document.getElementById("val-upper").innerText = Math.round(theta.upper) + "°";
    document.getElementById("val-gripper").innerText = theta.gripper < 0.1 ? "Closed" : "Open";
}