/*
 * Marbles.js
 *
 * Description: The marbles: small pellets of rubber that a tyre sheds when its surface is soft and hot (from about 150 to 180 degrees, before it
 *              smokes; Vehicle.js, wheel.surfT) and slides. They are thrown off a little backwards and to the side, fall, bounce once or twice and lie on
 *              the road, off the line where the tyres run, dark and about a centimetre across (drawn a little bigger, so that they can be seen). One mesh holds all of them in a ring (the oldest are drawn
 *              over when it is full). Every car draws into the same one. Like the skid marks they stay (until the car is put back at the start).
 */

OpenRacer.Marbles = function (scene, capacity) {
    capacity = capacity || 4000;
    var positions = new Float32Array(capacity * 3);
    var sizes = new Float32Array(capacity);
    var rotations = new Float32Array(capacity);
    var radii = new Float32Array(capacity), masses = new Float32Array(capacity);       // m and kg: 4 to 10 mm, 0.5 to 2.5 g
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

    var SEEN = 2.5;                                      // how much bigger they are drawn than they are
    var moving = 0;                                      // how many are in the air
    var forward = { x: 0, z: 1 };

    function spawn(x, y, z, vx, vy, vz) {
        var i = next;
        next = (next + 1) % capacity;
        if (flying[i]) moving--;
        radii[i] = 0.004 + Math.random() * 0.006;
        masses[i] = 0.0005 + (radii[i] - 0.004) / 0.006 * 0.002 * (0.7 + 0.6 * Math.random());
        positions[i * 3] = x; positions[i * 3 + 1] = y + radii[i]; positions[i * 3 + 2] = z;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        flying[i] = 1; moving++;
        sizes[i] = 2 * radii[i] * SEEN;
        rotations[i] = Math.random() * 6.2832;
        shades[i] = 0.04 + Math.random() * 0.07;
    }

    // Called every frame for a vehicle: makes marbles at its wheels that slide with a soft hot surface, and lets the ones in the air fall.
    this.update = function (vehicle, delta) {
        // the way the car points (level)
        var qx = vehicle.qx, qy = vehicle.qy, qz = vehicle.qz, qw = vehicle.qw;
        forward.x = 2 * (qx * qz + qw * qy); forward.z = 1 - 2 * (qx * qx + qy * qy);
        var fl0 = Math.hypot(forward.x, forward.z) || 1; forward.x /= fl0; forward.z /= fl0;
        var wheels = vehicle.wheels, kind = vehicle.tyreKind ? vehicle.tyreKind() : null, off = kind ? kind.smoke : 0;
        for (var w = 0; w < 4; w++) {
            var wheel = wheels[w];
            var road = wheel.surface === "road" || wheel.surface === "track01";
            if (!wheel.hasContact || !road || !wheel.surfT || wheel.weight < 300) { carry[w] = 0; continue; }
            // soft from 150 degrees, burning (the smoke takes it) from 230: marbles come in between; harder the slip burns more of the tread away
            var soft = Math.max(0, Math.min(1, (wheel.surfT - (150 + off)) / 30)) * (1 - 0.8 * Math.max(0, Math.min(1, (wheel.surfT - (220 + off)) / 40)));
            var slide = Math.hypot((wheel.omega || 0) * wheel.radius - (wheel.forwardSpeed || 0), (wheel.slipTan || 0) * Math.max(Math.abs(wheel.forwardSpeed || 0), 1.5));
            var rate = 16 * soft * Math.max(0, Math.min(1, (slide - 1.5) / 5));
            carry[w] += rate * delta;
            var count = Math.floor(carry[w]);
            carry[w] -= count;
            // They come off at the back of the patch of contact (a hand behind the middle of the tyre) with the speed of the tread, which runs
            // backwards against the car (the speed of the wheel, omega times the radius), on top of the speed of the car: a tyre that rolls (the tread
            // as fast as the car) lets them fall where they are, a spinning tyre throws them back, a locked one leaves them with the car. Into a cone:
            // a little to the side and up.
            var tangent = (wheel.omega || 0) * wheel.radius;
            for (var n = 0; n < count; n++) {
                var spreadSide = (Math.random() - 0.5) * 0.25, spreadUp = Math.random() * 0.15;
                var dx = -forward.x + forward.z * spreadSide, dz = -forward.z - forward.x * spreadSide, dy = spreadUp;   // backwards, with the cone (the side is to the left of the car)
                var dl = Math.hypot(dx, dy, dz) || 1;
                spawn(wheel.contact.x - forward.x * 0.1 + (Math.random() - 0.5) * 0.05, wheel.contact.y, wheel.contact.z - forward.z * 0.1 + (Math.random() - 0.5) * 0.05,
                    vehicle.vx + dx / dl * tangent, vehicle.vy + dy / dl * tangent + Math.random() * 0.3, vehicle.vz + dz / dl * tangent);
            }
        }
        if (!moving) return;
        var ground = vehicle.ground;
        var rolling = Math.pow(0.65, delta * 60);
        for (var i = 0; i < capacity; i++) {
            if (!flying[i]) continue;
            var vx = vel[i * 3], vy = vel[i * 3 + 1] - 9.81 * delta, vz = vel[i * 3 + 2];
            // the drag of the air: half rho, Cd 0.7, the cross section of the marble, over its mass
            var speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (speed > 1e-3) {
                var slow = Math.min(0.9, 0.5 * 1.225 * 0.7 * Math.PI * radii[i] * radii[i] * speed / masses[i] * delta);      // (the share of the speed that it loses, kept below one)
                vx -= vx * slow; vy -= vy * slow; vz -= vz * slow;
            }
            var x = positions[i * 3] += vx * delta, y = positions[i * 3 + 1] += vy * delta, z = positions[i * 3 + 2] += vz * delta;
            var road = ground && ground.query ? ground.query(x, z, y + 0.3, 0.6) : null;
            if (!road) { vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz; if (y < vehicle.py - 3) { flying[i] = 0; moving--; shades[i] = -1; } continue; }
            var floor = road.y + radii[i];
            if (y <= floor) {
                positions[i * 3 + 1] = floor;
                vy *= -0.25;                                  // hot rubber does not bounce
                vx *= rolling; vz *= rolling;                 // and it rolls only a little
                if (Math.abs(vy) < 0.5 && vx * vx + vz * vz < 0.16) { flying[i] = 0; moving--; vx = vy = vz = 0; }
            }
            vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
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
