// --- SHADERS ---
const vsSource = `
    attribute vec4 aVertexPosition;
    attribute vec3 aVertexNormal;
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat4 uNormalMatrix;
    varying highp vec3 vLighting;

    void main(void) {
        gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
        
        // Lighting
        highp vec3 ambientLight = vec3(0.3, 0.3, 0.3);
        highp vec3 directionalLightColor = vec3(1, 1, 1);
        highp vec3 lightDir = normalize(vec3(0.5, 0.8, 0.5));
        highp vec4 transformedNormal = uNormalMatrix * vec4(aVertexNormal, 1.0);
        highp float directional = max(dot(transformedNormal.xyz, lightDir), 0.0);
        vLighting = ambientLight + (directionalLightColor * directional);
    }
`;

const fsSource = `
    varying highp vec3 vLighting;
    uniform highp vec4 uColor;
    void main(void) {
        gl_FragColor = vec4(uColor.rgb * vLighting, uColor.a);
    }
`;

// --- GLOBAL VARIABLES ---
let gl, programInfo, buffers;
let ui = {};

// Matrices storage to avoid garbage collection
const matrices = {
    base: mat4.create(),
    lower: mat4.create(),
    upper: mat4.create(),
    wrist: mat4.create(), // The "End Effector"
    object: mat4.create(),
    gripOffset: mat4.create() // Stores the relative transform when gripped
};

// Robot State
const state = {
    baseAngle: 0,
    lowerAngle: 0,
    upperAngle: 0,
    gripperVal: 100, // 0-100 (Slider value)
    
    // Logic
    isGripped: false,
    
    // Physics Constraints
    fingerGap: 0, 
    objectWidth: 1.5, // The visual size of the cube
    
    // Automation
    isAuto: false,
    autoStep: 0,
    timer: 0
};

// --- INIT ---
window.onload = function() {
    const canvas = document.getElementById('glcanvas');
    gl = canvas.getContext('webgl');
    if (!gl) { alert('WebGL not supported'); return; }

    const shaderProgram = initShaderProgram(gl, vsSource, fsSource);
    
    programInfo = {
        program: shaderProgram,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
            vertexNormal: gl.getAttribLocation(shaderProgram, 'aVertexNormal'),
        },
        uniformLocations: {
            projectionMatrix: gl.getUniformLocation(shaderProgram, 'uProjectionMatrix'),
            modelViewMatrix: gl.getUniformLocation(shaderProgram, 'uModelViewMatrix'),
            normalMatrix: gl.getUniformLocation(shaderProgram, 'uNormalMatrix'),
            color: gl.getUniformLocation(shaderProgram, 'uColor'),
        },
    };

    buffers = initBuffers(gl);

    // Initial Object Position (On the ground)
    mat4.fromTranslation(matrices.object, [8.0, 0.75, 8.0]); 

    ui = {
        base: document.getElementById('baseSlider'),
        lower: document.getElementById('lowerSlider'),
        upper: document.getElementById('upperSlider'),
        gripper: document.getElementById('gripperSlider'),
        status: document.getElementById('statusText'),
        btn: document.getElementById('btnAuto')
    };

    ui.btn.addEventListener('click', startAutoSequence);
    setupInputs();
    requestAnimationFrame(render);
};

// --- LOGIC LOOP ---
function render(now) {
    updatePhysics();

    // Setup View
    gl.clearColor(0.1, 0.1, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, 45 * Math.PI / 180, gl.canvas.width / gl.canvas.height, 0.1, 100.0);

    const viewMatrix = mat4.create();
    mat4.translate(viewMatrix, viewMatrix, [0.0, -5.0, -40.0]);
    mat4.rotate(viewMatrix, viewMatrix, 0.5, [1, 0, 0]);

    gl.useProgram(programInfo.program);
    gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);

    // --- ROBOT HIERARCHY ---
    
    // 1. Base
    mat4.copy(matrices.base, viewMatrix);
    mat4.rotate(matrices.base, matrices.base, state.baseAngle * Math.PI/180, [0, 1, 0]);
    drawCube(matrices.base, [2, 1, 2], [0.5, 0.5, 0.5, 1.0]);

    // 2. Lower Arm
    mat4.copy(matrices.lower, matrices.base);
    mat4.translate(matrices.lower, matrices.lower, [0, 1.0, 0]);
    mat4.rotate(matrices.lower, matrices.lower, state.lowerAngle * Math.PI/180, [1, 0, 0]);
    
    let visualLower = mat4.clone(matrices.lower);
    mat4.translate(visualLower, visualLower, [0, 2.5, 0]);
    drawCube(visualLower, [1, 5, 1], [0.2, 0.4, 0.8, 1.0]);

    // 3. Upper Arm
    mat4.copy(matrices.upper, matrices.lower);
    mat4.translate(matrices.upper, matrices.upper, [0, 5.0, 0]);
    mat4.rotate(matrices.upper, matrices.upper, state.upperAngle * Math.PI/180, [1, 0, 0]);

    let visualUpper = mat4.clone(matrices.upper);
    mat4.translate(visualUpper, visualUpper, [0, 2.0, 0]);
    drawCube(visualUpper, [0.8, 4, 0.8], [0.8, 0.2, 0.2, 1.0]);

    // 4. Wrist (End Effector)
    mat4.copy(matrices.wrist, matrices.upper);
    mat4.translate(matrices.wrist, matrices.wrist, [0, 4.0, 0]);
    drawCube(matrices.wrist, [1.2, 0.5, 1.2], [0.6, 0.6, 0.6, 1.0]);

    // 5. Fingers
    // Calculate finger position based on slider 
    // Slider 0 (Closed) -> Gap 1.5 (Object Width)
    // Slider 100 (Open) -> Gap 4.0
    
    let openAmt = state.gripperVal / 100.0;
    // Map 0..1 to 0.8..2.0 (distance from center)
    let fingerDist = 0.8 + (openAmt * 1.2); 
    
    // If we are gripping the object, the fingers physically cannot close further than the object width
    if (state.isGripped) {
        // Clamp visually so fingers don't clip through object
        // Half of object width (1.5) is 0.75. Add slight margin 0.8
        if (fingerDist < 0.8) fingerDist = 0.8; 
    }

    // Left Finger
    let f1 = mat4.clone(matrices.wrist);
    mat4.translate(f1, f1, [-fingerDist, 1.0, 0]);
    drawCube(f1, [0.2, 1.5, 0.5], [0.7, 0.7, 0.7, 1.0]);

    // Right Finger
    let f2 = mat4.clone(matrices.wrist);
    mat4.translate(f2, f2, [fingerDist, 1.0, 0]);
    drawCube(f2, [0.2, 1.5, 0.5], [0.7, 0.7, 0.7, 1.0]);


    // --- OBJECT PHYSICS (THE FIX) ---
    
    if (state.isGripped) {
        // If gripped, Object = WristMatrix * SavedOffset
        mat4.multiply(matrices.object, matrices.wrist, matrices.gripOffset);
    }
    // If not gripped, matrices.object stays where it was last drawn (World Coords)

    drawCube(matrices.object, [1.5, 1.5, 1.5], [1.0, 0.8, 0.2, 1.0]);

    // Floor
    let floor = mat4.clone(viewMatrix);
    mat4.translate(floor, floor, [0, -1, 0]);
    drawCube(floor, [20, 0.2, 20], [0.2, 0.2, 0.2, 1.0]);

    requestAnimationFrame(render);
}

// --- PHYSICS & LOGIC ---

function updatePhysics() {
    if (state.isAuto) {
        runAutoSequence();
    } else {
        // Manual Sync
        state.baseAngle = parseFloat(ui.base.value);
        state.lowerAngle = parseFloat(ui.lower.value);
        state.upperAngle = parseFloat(ui.upper.value);
        
        // Manual Grip Toggle Logic
        let sliderVal = parseFloat(ui.gripper.value);
        
        // Attempt to Grip (Closing)
        if (sliderVal < 50 && state.gripperVal >= 50 && !state.isGripped) {
            attemptGrip();
        }
        // Attempt to Release (Opening)
        else if (sliderVal > 50 && state.gripperVal <= 50 && state.isGripped) {
            releaseGrip();
        }
        
        state.gripperVal = sliderVal;
    }
}

function attemptGrip() {
    // 1. Get Wrist Position
    let wristPos = vec3.create();
    mat4.getTranslation(wristPos, matrices.wrist);

    // 2. Get Object Position
    let objPos = vec3.create();
    mat4.getTranslation(objPos, matrices.object);

    // 3. Calculate Distance
    let dist = vec3.distance(wristPos, objPos);

    // 4. "Realistic" Check:
    // Grip only if wrist is close enough (e.g., < 3.0 units) 
    // AND The wrist is slightly ABOVE the object (y difference)
    if (dist < 4.0) {
        state.isGripped = true;
        ui.status.innerText = "Status: OBJECT GRIPPED";
        
        // --- THE KEY FIX: CALCULATE RELATIVE OFFSET ---
        // Instead of snapping to 0,0,0, we calculate: Offset = Inverse(Wrist) * Object
        let invWrist = mat4.create();
        mat4.invert(invWrist, matrices.wrist);
        mat4.multiply(matrices.gripOffset, invWrist, matrices.object);
    } else {
        console.log("Missed grip! Too far away: " + dist.toFixed(2));
        ui.status.innerText = "Status: MISSED (Too Far)";
        // We do NOT set isGripped to true. The fingers close, but grab air.
    }
}

function releaseGrip() {
    state.isGripped = false;
    ui.status.innerText = "Status: RELEASED";
    // Object matrix is now detached. It will stay exactly where it was in World Space.
    
    // Optional: Add simple gravity (snap to floor y=0.75) if you want it to fall
    let pos = vec3.create();
    mat4.getTranslation(pos, matrices.object);
    if (pos[1] > 0.75) {
        // Simple "drop to floor" logic
        mat4.translate(matrices.object, matrices.object, [0, 0.75 - pos[1], 0]);
    }
}


// --- AUTOMATION SEQUENCE ---
function startAutoSequence() {
    state.isAuto = true;
    state.autoStep = 0;
    state.timer = 0;
    state.isGripped = false;
    ui.btn.disabled = true;
    ui.status.style.color = "#FFD700";
}

function runAutoSequence() {
    // Exact Angles to hit the object at [8, 0, 8]
    // These are approximations. In a real engine, we'd use Inverse Kinematics.
    const TARGETS = {
        PICK:   { b: -45, l: 38, u: 25 },
        LIFT:   { b: -45, l: -10, u: -10 },
        DROP:   { b: 45,  l: 38, u: 25 },
        HOME:   { b: 0,   l: 0,  u: 0 }
    };

    const spd = 0.05; // speed

    switch (state.autoStep) {
        case 0: // Approach
            ui.status.innerText = "Auto: Approaching...";
            state.baseAngle = lerp(state.baseAngle, TARGETS.PICK.b, spd);
            state.lowerAngle = lerp(state.lowerAngle, TARGETS.PICK.l, spd);
            state.upperAngle = lerp(state.upperAngle, TARGETS.PICK.u, spd);
            state.gripperVal = 100; 

            if (Math.abs(state.lowerAngle - TARGETS.PICK.l) < 0.5) {
                state.autoStep = 1;
            }
            break;

        case 1: // Grip
            ui.status.innerText = "Auto: Gripping...";
            state.gripperVal = lerp(state.gripperVal, 0, 0.1);
            if (state.gripperVal < 10) {
                attemptGrip(); // Try to attach
                if (state.isGripped) {
                    state.autoStep = 2; // Success
                } else {
                    // If missed (physics check failed), abort or retry
                     // For demo, we force it, but in reality we'd error out
                     state.autoStep = 2; 
                }
            }
            break;

        case 2: // Lift
            ui.status.innerText = "Auto: Lifting...";
            state.lowerAngle = lerp(state.lowerAngle, TARGETS.LIFT.l, spd);
            state.upperAngle = lerp(state.upperAngle, TARGETS.LIFT.u, spd);
            if (Math.abs(state.lowerAngle - TARGETS.LIFT.l) < 0.5) state.autoStep = 3;
            break;

        case 3: // Turn
            ui.status.innerText = "Auto: Turning...";
            state.baseAngle = lerp(state.baseAngle, TARGETS.DROP.b, spd);
            if (Math.abs(state.baseAngle - TARGETS.DROP.b) < 0.5) state.autoStep = 4;
            break;

        case 4: // Lower
            ui.status.innerText = "Auto: Placing...";
            state.lowerAngle = lerp(state.lowerAngle, TARGETS.DROP.l, spd);
            state.upperAngle = lerp(state.upperAngle, TARGETS.DROP.u, spd);
            if (Math.abs(state.lowerAngle - TARGETS.DROP.l) < 0.5) state.autoStep = 5;
            break;

        case 5: // Release
            ui.status.innerText = "Auto: Releasing...";
            state.gripperVal = lerp(state.gripperVal, 100, 0.1);
            if (state.gripperVal > 90) {
                releaseGrip();
                state.autoStep = 6;
            }
            break;

        case 6: // Home
            ui.status.innerText = "Auto: Going Home...";
            state.baseAngle = lerp(state.baseAngle, TARGETS.HOME.b, spd);
            state.lowerAngle = lerp(state.lowerAngle, TARGETS.HOME.l, spd);
            state.upperAngle = lerp(state.upperAngle, TARGETS.HOME.u, spd);
            if (Math.abs(state.baseAngle) < 1) {
                state.isAuto = false;
                ui.btn.disabled = false;
                ui.status.style.color = "#4CAF50";
                ui.status.innerText = "Mode: MANUAL CONTROL";
            }
            break;
    }
}

function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

// --- SETUP HELPERS (Standard Boilerplate) ---
function setupInputs() {
    document.addEventListener('keydown', (e) => {
        if(state.isAuto) return;
        switch(e.key) {
            case 'ArrowLeft': ui.base.value -= 2; break;
            case 'ArrowRight': ui.base.value = parseInt(ui.base.value) + 2; break;
            case 'ArrowUp': ui.lower.value -= 2; break;
            case 'ArrowDown': ui.lower.value = parseInt(ui.lower.value) + 2; break;
            case 'w': ui.upper.value -= 2; break;
            case 's': ui.upper.value = parseInt(ui.upper.value) + 2; break;
            case ' ': 
                ui.gripper.value = (ui.gripper.value > 50) ? 0 : 100;
                break;
        }
    });
}

function drawCube(matrix, scale, color) {
    let mv = mat4.clone(matrix);
    mat4.scale(mv, mv, scale);
    
    let nm = mat4.create();
    mat4.invert(nm, mv);
    mat4.transpose(nm, nm);

    gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, mv);
    gl.uniformMatrix4fv(programInfo.uniformLocations.normalMatrix, false, nm);
    gl.uniform4fv(programInfo.uniformLocations.color, color);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
    gl.vertexAttribPointer(programInfo.attribLocations.vertexNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexNormal);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
}

function initBuffers(gl) {
    const positions = [
        -0.5, -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,  0.5,  0.5, -0.5,  0.5,  0.5, // Front
        -0.5, -0.5, -0.5, -0.5,  0.5, -0.5,  0.5,  0.5, -0.5,  0.5, -0.5, -0.5, // Back
        -0.5,  0.5, -0.5, -0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5, -0.5, // Top
        -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  0.5, -0.5,  0.5, -0.5, -0.5,  0.5, // Bottom
         0.5, -0.5, -0.5,  0.5,  0.5, -0.5,  0.5,  0.5,  0.5,  0.5, -0.5,  0.5, // Right
        -0.5, -0.5, -0.5, -0.5, -0.5,  0.5, -0.5,  0.5,  0.5, -0.5,  0.5, -0.5, // Left
    ];
    const normals = [
         0,0,1, 0,0,1, 0,0,1, 0,0,1,  0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
         0,1,0, 0,1,0, 0,1,0, 0,1,0,  0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
         1,0,0, 1,0,0, 1,0,0, 1,0,0,  -1,0,0, -1,0,0, -1,0,0, -1,0,0
    ];
    const indices = [
        0,1,2, 0,2,3, 4,5,6, 4,6,7, 8,9,10, 8,10,11,
        12,13,14, 12,14,15, 16,17,18, 16,18,19, 20,21,22, 20,22,23
    ];
    
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    return { position: posBuf, normal: normBuf, indices: idxBuf };
}

function initShaderProgram(gl, vs, fs) {
    const v = loadShader(gl, gl.VERTEX_SHADER, vs);
    const f = loadShader(gl, gl.FRAGMENT_SHADER, fs);
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    return p;
}

function loadShader(gl, type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
}