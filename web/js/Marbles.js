/*
 * Marbles.js
 *
 * Description: The marbles: small pellets of rubber that a tyre sheds when its surface is soft and hot (from about 150 to 180 degrees, before it
 *              smokes; Vehicle.js, wheel.surfT) and slides. They are thrown off a little backwards and to the side, fall, bounce once or twice and lie on
 *              the road, off the line where the tyres run, dark and a few centimetres across. One mesh holds all of them in a ring (the oldest are drawn
 *              over when it is full). Every car draws into the same one. Like the skid marks they stay (until the car is put back at the start).
 */

OpenRacer.Marbles = function (scene, capacity) {
    capacity = capacity || 4000;
    var positions = new Float32Array(capacity * 3);
    var sizes = new Float32Array(capacity);
    var rotations = new Float32Array(capacity);
    var shades = new Float32Array(capacity);
    var vel = new Float32Array(capacity * 3);
    var flying = new Uint8Array(capacity);               // 1 while it is in the air
    var next = 0;
    var carry = [0, 0, 0, 0];

    var geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5]), 3));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    var attributes = {
        iPos: new THREE.InstancedBufferAttribute(positions, 3), iSize: new THREE.InstancedBufferAttribute(sizes, 1),
        iRot: new THREE.InstancedBufferAttribute(rotations, 1), iShade: new THREE.InstancedBufferAttribute(shades, 1)
    };
    for (var name in attributes) { attributes[name].setUsage(THREE.DynamicDrawUsage); geometry.setAttribute(name, attributes[name]); }
    geometry.instanceCount = capacity;
    var material = new THREE.ShaderMaterial({
        vertexShader: "attribute vec3 iPos; attribute float iSize; attribute float iRot; attribute float iShade; varying vec2 vUv; varying float vShade;" +
            "void main() {" +
            "  vUv = position.xz + 0.5; vShade = iShade;" +
            "  float c = cos(iRot), s = sin(iRot);" +
            "  vec2 p = vec2(position.x * c - position.z * s, position.x * s + position.z * c) * iSize;" +
            "  gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + vec3(p.x, 0.004, p.y), 1.0);" +
            "}",
        fragmentShader: "varying vec2 vUv; varying float vShade;" +
            "void main() {" +
            "  float d = length(vUv - 0.5) * 2.0;" +
            "  float a = 1.0 - smoothstep(0.55, 1.0, d);" +
            "  if (a < 0.05 || vShade < 0.0) discard;" +
            "  gl_FragColor = vec4(vec3(vShade), a * 0.92);" +
            "}",
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    });
    var mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.userData.noGBuffer = true;                      // a thin film on the road, not a surface for the screen space effects (Graphics.js)
    scene.add(mesh);
    shades.fill(-1);                                     // not there yet
    attributes.iShade.needsUpdate = true;

    var moving = 0;                                      // how many are in the air
    var probe = { x: 0, y: 0, z: 0 };

    function spawn(x, y, z, vx, vy, vz) {
        var i = next;
        next = (next + 1) % capacity;
        if (flying[i]) moving--;
        positions[i * 3] = x; positions[i * 3 + 1] = y + 0.02; positions[i * 3 + 2] = z;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        flying[i] = 1; moving++;
        sizes[i] = 0.02 + Math.random() * 0.04;
        rotations[i] = Math.random() * 6.2832;
        shades[i] = 0.04 + Math.random() * 0.07;
    }

    // Called every frame for a vehicle: makes marbles at its wheels that slide with a soft hot surface, and lets the ones in the air fall.
    this.update = function (vehicle, delta) {
        var wheels = vehicle.wheels, kind = vehicle.tyreKind ? vehicle.tyreKind() : null, off = kind ? kind.smoke : 0;
        for (var w = 0; w < 4; w++) {
            var wheel = wheels[w];
            var road = wheel.surface === "road" || wheel.surface === "track01";
            if (!wheel.hasContact || !road || !wheel.surfT || wheel.weight < 300) { carry[w] = 0; continue; }
            // soft from 150 degrees, burning (the smoke takes it) from 230: marbles come in between; harder the slip burns more of the tread away
            var soft = Math.max(0, Math.min(1, (wheel.surfT - (150 + off)) / 30)) * (1 - 0.8 * Math.max(0, Math.min(1, (wheel.surfT - (230 + off)) / 40)));
            var slide = Math.hypot((wheel.omega || 0) * wheel.radius - (wheel.forwardSpeed || 0), (wheel.slipTan || 0) * Math.max(Math.abs(wheel.forwardSpeed || 0), 1.5));
            var rate = 16 * soft * Math.max(0, Math.min(1, (slide - 1.5) / 5));
            carry[w] += rate * delta;
            var count = Math.floor(carry[w]);
            carry[w] -= count;
            // thrown the way the tyre drags it: backwards against how the tread slides, and to the side
            var spin = Math.max(0, (wheel.omega || 0) * wheel.radius - (wheel.forwardSpeed || 0));
            var fx = vehicle.vx, fz = vehicle.vz, fl = Math.hypot(fx, fz) || 1;
            for (var n = 0; n < count; n++) {
                var side = (Math.random() - 0.5) * 3;
                var back = 0.5 + Math.random() * (1.5 + Math.min(4, spin * 0.1));
                spawn(wheel.contact.x + (Math.random() - 0.5) * 0.2, wheel.contact.y, wheel.contact.z + (Math.random() - 0.5) * 0.2,
                    vehicle.vx * 0.6 - (fx / fl) * back + (fz / fl) * side, 0.5 + Math.random() * 1.2, vehicle.vz * 0.6 - (fz / fl) * back - (fx / fl) * side);
            }
        }
        if (!moving) return;
        var ground = vehicle.ground;
        for (var i = 0; i < capacity; i++) {
            if (!flying[i]) continue;
            vel[i * 3 + 1] -= 9.81 * delta;
            var x = positions[i * 3] += vel[i * 3] * delta, y = positions[i * 3 + 1] += vel[i * 3 + 1] * delta, z = positions[i * 3 + 2] += vel[i * 3 + 2] * delta;
            var road = ground && ground.query ? ground.query(x, z, y + 0.3, 0.6) : null;
            var floor = road ? road.y : null;
            if (floor === null) { if (y < vehicle.py - 3) { flying[i] = 0; moving--; shades[i] = -1; } continue; }
            if (y <= floor + 0.01) {
                positions[i * 3 + 1] = floor + 0.01;
                if (vel[i * 3 + 1] < -1.2) { vel[i * 3 + 1] *= -0.3; vel[i * 3] *= 0.5; vel[i * 3 + 2] *= 0.5; }
                else { flying[i] = 0; moving--; }
            }
        }
        attributes.iPos.needsUpdate = true; attributes.iSize.needsUpdate = true; attributes.iRot.needsUpdate = true; attributes.iShade.needsUpdate = true;
    };

    this.clear = function () {
        shades.fill(-1); flying.fill(0); moving = 0;
        attributes.iShade.needsUpdate = true;
    };
};

// the one set of marbles of the scene, made when the first car asks for it
OpenRacer.marbles = function () {
    if (!OpenRacer.marblesInstance && typeof scene !== "undefined" && scene) OpenRacer.marblesInstance = new OpenRacer.Marbles(scene);
    return OpenRacer.marblesInstance || null;
};
