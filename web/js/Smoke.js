/*
 * Smoke.js
 *
 * Description: The smoke of the tyres (and dust on soft ground) as plumes of billboards with a picture of a puff of smoke on them. Every wheel that
 *              slides makes it at a rate that comes from the physics (wheel.smoke, see Vehicle.js): the longer a tyre slides, the thicker it gets.
 *
 *              The puffs are small pictures (four, in an atlas that is made when the game starts: noise with a soft edge, a lit top and a darker
 *              underside), each turned by its own angle, that rise, are carried by a little turbulence and the wind, grow and fade away. The smoke is
 *              made along the path of the tyre, not only where it is each frame, so that it is a plume and not a row of blobs, also at speed.
 *              The billboards are quads (not points: a point has a largest size on a graphics card, and a close puff of smoke is bigger than that).
 */

// The depth of the surfaces for the smoke, when the smoke is drawn after the screen space effects (SmokePass in Graphics.js): the puffs fade
// where they meet a surface and are not drawn behind one. Without it (uUseDepth 0) the smoke is drawn with the scene and the depth buffer does it.
OpenRacer.SmokeDepth = { tDepth: { value: null }, uUseDepth: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) }, uNear: { value: 1 }, uFar: { value: 5000 } };

OpenRacer.TyreSmoke = function(scene, capacity) {
    capacity = capacity || 2500;
    var positions = new Float32Array(capacity * 3);
    var sizes = new Float32Array(capacity);
    var alphas = new Float32Array(capacity);
    var colours = new Float32Array(capacity * 3);
    var rotations = new Float32Array(capacity);
    var frames = new Float32Array(capacity);
    var bases = new Float32Array(capacity);              // the height of the road where the puff was made: it fades in above it, not in the road
    var vel = new Float32Array(capacity * 3);
    var spin = new Float32Array(capacity);
    var age = new Float32Array(capacity).fill(1e9);
    var life = new Float32Array(capacity).fill(1);
    var size0 = new Float32Array(capacity), size1 = new Float32Array(capacity), alpha0 = new Float32Array(capacity);
    var next = 0;
    var time = 0;
    var last = [null, null, null, null];                 // where every wheel made its smoke last: the plume is made along the path

    // ---- the pictures of a puff: noise with a soft edge, in an atlas of 2 by 2
    var TILE = 128;
    function makeAtlas() {
        var canvas = document.createElement("canvas");
        canvas.width = canvas.height = TILE * 2;
        var context = canvas.getContext("2d");
        var image = context.createImageData(canvas.width, canvas.height);
        var seed = 1;
        function random() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
        // value noise on a lattice that wraps, so that the tile has no seam in the middle of the puff
        function lattice(n) { var a = new Float32Array(n * n); for (var i = 0; i < a.length; i++) a[i] = random(); return a; }
        function noise(a, n, x, y) {
            var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
            fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
            var x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
            return (a[y0 * n + x0] * (1 - fx) + a[y0 * n + x1] * fx) * (1 - fy) + (a[y1 * n + x0] * (1 - fx) + a[y1 * n + x1] * fx) * fy;
        }
        for (var tile = 0; tile < 4; tile++) {
            var lat = lattice(16);
            var ox = (tile % 2) * TILE, oy = Math.floor(tile / 2) * TILE;
            var blobs = [];                                // a puff is a soft cloud with a ragged edge, not a few discs: wide soft lumps, eaten by noise
            for (var b = 0; b < 3; b++) blobs.push([0.5 + (random() - 0.5) * 0.3, 0.5 + (random() - 0.5) * 0.3, 0.34 + random() * 0.14]);
            var warp = lattice(16);
            for (var y = 0; y < TILE; y++) {
                for (var x = 0; x < TILE; x++) {
                    var u = x / TILE, v = y / TILE;
                    // the picture is bent by noise before the shape is looked up, so that the edge curls like smoke does
                    var wu = u + (noise(warp, 16, u * 5 + 2, v * 5 + 9) - 0.5) * 0.22, wv = v + (noise(warp, 16, u * 5 + 7, v * 5 + 1) - 0.5) * 0.22;
                    var shape = 0;
                    for (var k = 0; k < blobs.length; k++) {
                        var d = Math.hypot(wu - blobs[k][0], wv - blobs[k][1]) / blobs[k][2];
                        shape = Math.max(shape, Math.pow(1 - Math.min(1, d), 0.8));
                    }
                    var n = 0.5 * noise(lat, 16, u * 5, v * 5) + 0.3 * noise(lat, 16, u * 11 + 3, v * 11 + 7) + 0.2 * noise(lat, 16, u * 23 + 11, v * 23 + 5);
                    var density = Math.max(0, Math.min(1, shape * 1.15 + (n - 0.5) * 0.95 - 0.2));
                    density = density * density * (3 - 2 * density);
                    var light = 0.78 + 0.22 * (1 - v) - 0.12 * (1 - n);
                    var i = ((oy + y) * canvas.width + ox + x) * 4;
                    image.data[i] = Math.min(255, 255 * light); image.data[i + 1] = Math.min(255, 255 * light); image.data[i + 2] = Math.min(255, 255 * (light + 0.03));
                    image.data[i + 3] = Math.round(255 * density);
                }
            }
        }
        context.putImageData(image, 0, 0);
        var texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
        return texture;
    }

    // ---- the billboards: one quad, repeated for every puff
    var geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    var attributes = {
        iPos: new THREE.InstancedBufferAttribute(positions, 3), iSize: new THREE.InstancedBufferAttribute(sizes, 1), iAlpha: new THREE.InstancedBufferAttribute(alphas, 1),
        iTint: new THREE.InstancedBufferAttribute(colours, 3), iRot: new THREE.InstancedBufferAttribute(rotations, 1), iFrame: new THREE.InstancedBufferAttribute(frames, 1),
        iBase: new THREE.InstancedBufferAttribute(bases, 1)
    };
    for (var name in attributes) { attributes[name].setUsage(THREE.DynamicDrawUsage); geometry.setAttribute(name, attributes[name]); }
    geometry.instanceCount = capacity;
    var material = new THREE.ShaderMaterial({
        uniforms: Object.assign({ map: { value: makeAtlas() } }, OpenRacer.SmokeDepth),
        vertexShader: "attribute vec3 iPos; attribute float iSize; attribute float iAlpha; attribute vec3 iTint; attribute float iRot; attribute float iFrame; attribute float iBase;" +
            "varying vec2 vUv; varying float vAlpha; varying vec3 vTint; varying vec2 vTile;" +
            "void main() {" +
            "  vUv = position.xy + 0.5; vAlpha = iAlpha; vTint = iTint; vTile = vec2(mod(iFrame, 2.0), floor(iFrame / 2.0));" +
            // a puff has no height at the road: it fades in over the first 40 cm above it
            "  vAlpha *= smoothstep(0.0, 0.4, iPos.y - iBase);" +
            "  float c = cos(iRot), s = sin(iRot);" +
            "  vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize;" +
            "  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);" +
            "  mv.xy += corner;" +
            "  gl_Position = projectionMatrix * mv;" +
            "}",
        fragmentShader: "uniform sampler2D map; uniform sampler2D tDepth; uniform float uUseDepth; uniform vec2 uResolution; uniform float uNear; uniform float uFar;" +
            "varying vec2 vUv; varying float vAlpha; varying vec3 vTint; varying vec2 vTile;" +
            "float lin(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }" +
            "void main() {" +
            "  vec4 t = texture2D(map, (vTile + vUv) * 0.5);" +
            "  float a = t.a * vAlpha;" +
            // soft particles: against the depth of the surfaces (the picture of the normals and the depth that the screen space effects make)
            "  if (uUseDepth > 0.5) {" +
            "    float sd = texture2D(tDepth, gl_FragCoord.xy / uResolution).x;" +
            "    if (sd < 0.99999) a *= smoothstep(0.0, 0.6, lin(sd) - lin(gl_FragCoord.z));" +
            "  }" +
            "  if (a < 0.003) discard;" +
            "  gl_FragColor = vec4(t.rgb * vTint, a);" +
            "}",
        transparent: true,
        depthWrite: false
    });
    var mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.userData.noGBuffer = true;                     // not a surface for the screen space effects (Graphics.js)
    mesh.layers.set(1);                                 // its own layer: the camera draws it with the scene or after the screen space effects (Graphics.js)
    scene.add(mesh);

    var amount = 1;                                      // the smoke setting of the graphics menu (1 is 100%)

    function spawn(x, y, z, vx, vy, vz, heat, dust) {
        var i = next;
        next = (next + 1) % capacity;
        positions[i * 3] = x + (Math.random() - 0.5) * 0.3;
        positions[i * 3 + 1] = y + 0.04;
        positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
        bases[i] = y;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        age[i] = 0;
        life[i] = (dust ? 1.4 : 2.0) + Math.random() * 1.4 + heat * 0.8;
        size0[i] = 0.6 + Math.random() * 0.4;
        size1[i] = (dust ? 2.4 : 2.8) + Math.random() * 1.4 + heat * 1.6;
        alpha0[i] = ((dust ? 0.3 : 0.4) + 0.32 * heat) * Math.max(0.5, Math.min(1.2, 0.5 + 0.5 * amount));
        rotations[i] = Math.random() * 6.2832;
        spin[i] = (Math.random() - 0.5) * 0.8;
        frames[i] = Math.floor(Math.random() * 4);
        var shade = 0.9 + Math.random() * 0.1;
        if(dust) { colours[i * 3] = 0.66 * shade; colours[i * 3 + 1] = 0.55 * shade; colours[i * 3 + 2] = 0.4 * shade; }
        else { colours[i * 3] = 0.9 * shade; colours[i * 3 + 1] = 0.91 * shade; colours[i * 3 + 2] = 0.94 * shade; }
    }

    // ---- the car is not a place for smoke: the body as a box in the frame of the car (from the collision spheres of the shell), that the puffs leave
    var box = null, qCar = new THREE.Quaternion(), qInv = new THREE.Quaternion(), pLocal = new THREE.Vector3(), fwd = new THREE.Vector3(), left = new THREE.Vector3(), carVel = new THREE.Vector3();
    function bodyBox(vehicle) {
        var spheres = vehicle.collisionSpheres;
        if(!spheres || !spheres.length) return null;
        var b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9, spheres: spheres };
        for(var k = 0; k < spheres.length; k++) {
            var sp = spheres[k];
            if(sp.wheel || sp.rig) continue;               // the wheels are where the smoke is made
            b.x0 = Math.min(b.x0, sp.x - sp.r); b.x1 = Math.max(b.x1, sp.x + sp.r);
            b.y0 = Math.min(b.y0, sp.y - sp.r); b.y1 = Math.max(b.y1, sp.y + sp.r);
            b.z0 = Math.min(b.z0, sp.z - sp.r); b.z1 = Math.max(b.z1, sp.z + sp.r);
        }
        if(b.x0 > b.x1) return null;
        b.radius = Math.hypot(Math.max(Math.abs(b.x0), Math.abs(b.x1)), Math.max(Math.abs(b.y0), Math.abs(b.y1)), Math.max(Math.abs(b.z0), Math.abs(b.z1))) + 0.3;
        return b;
    }

    // Moves the smoke and makes new smoke at the wheels along the path of the tyres. camera is not needed any more (the billboards face it in
    // the vertex shader) but it is still given.
    this.update = function(delta, vehicle, camera) {
        time += delta;
        var setting = typeof Settings !== "undefined" ? Settings.option("gfxSmoke") : undefined;
        amount = setting === undefined ? 1 : Math.max(0, setting / 100);
        if(!box || box.spheres !== vehicle.collisionSpheres) box = bodyBox(vehicle);
        qCar.set(vehicle.qx, vehicle.qy, vehicle.qz, vehicle.qw);
        qInv.copy(qCar).invert();
        // the way the car points (level) and its left, and how it moves
        fwd.set(0, 0, 1).applyQuaternion(qCar); fwd.y = 0;
        if(fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0); else fwd.normalize();
        left.set(fwd.z, 0, -fwd.x);
        carVel.set(vehicle.vx, vehicle.vy, vehicle.vz);
        var wheels = vehicle.wheels;
        for(var w = 0; w < 4; w++) {
            var wheel = wheels[w];
            if(amount > 0 && wheel.smoke > 0.02 && wheel.hasContact) {
                var dust = wheel.surface !== "road" && wheel.surface !== "track01";
                var cx = wheel.contact.x, cy = wheel.contact.y, cz = wheel.contact.z;
                var from = last[w];
                if(!from || Math.hypot(cx - from.x, cz - from.z) > 6) from = { x: cx, y: cy, z: cz, carry: 0 };
                // the number of puffs follows the time (the rate) and they are spread over the path since the last frame
                from.carry += (dust ? 45 : 90) * wheel.smoke * delta * amount;
                var count = Math.floor(from.carry);
                from.carry -= count;
                // The smoke is made where the tyre meets the road and has almost nothing of the speed of the car (it is left on the road, so when the car
                // swings away it is not taken along): what the spinning tyre does to it is what counts. A tyre that spins faster than the car goes throws it backwards, fast (at the speed of the spin that is
                // beyond the speed of the car), and to the outside of the car, with a spread; a locked tyre leaves it where the car was.
                var overspeed = (wheel.omega || 0) * wheel.radius - (wheel.forwardSpeed || 0);
                var spun = Math.max(0, overspeed), locked = Math.max(0, -overspeed);
                var outward = wheel.right ? -1 : 1;
                for(var n = 0; n < count; n++) {
                    var f = (n + Math.random()) / Math.max(1, count);
                    var back = Math.min(5, spun * (0.12 + Math.random() * 0.2)) - locked * 0.05;          // (at most 5 m/s: the air stops it within a few metres)
                    var side = outward * Math.min(3, spun * (0.08 + Math.random() * 0.12)) + (Math.random() - 0.5) * (0.8 + 0.05 * Math.min(spun, 10));
                    spawn(from.x + (cx - from.x) * f, from.y + (cy - from.y) * f, from.z + (cz - from.z) * f,
                        carVel.x * 0.06 - fwd.x * back + left.x * side + (Math.random() - 0.5) * 0.5,
                        0.4 + Math.random() * 0.9 + Math.min(2, spun * 0.08),
                        carVel.z * 0.06 - fwd.z * back + left.z * side + (Math.random() - 0.5) * 0.5, wheel.heat, dust);
                }
                from.x = cx; from.y = cy; from.z = cz;
                last[w] = from;
            } else {
                last[w] = null;
            }
        }
        var drag = Math.exp(-2.2 * delta);
        for(var i = 0; i < capacity; i++) {
            if(age[i] >= life[i]) {
                if(alphas[i] !== 0) alphas[i] = 0;
                continue;
            }
            age[i] += delta;
            var t = Math.min(1, age[i] / life[i]);
            var px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
            // a little turbulence that changes slowly in space and time, and the wind: the plume curls and drifts instead of rising in a column
            var ax = Math.sin(py * 1.7 + pz * 0.9 + time * 0.8 + i) * 0.9 + 0.25;
            var az = Math.sin(px * 1.3 + py * 1.1 + time * 0.7 + i * 0.5) * 0.9 + 0.1;
            vel[i * 3] = (vel[i * 3] + ax * delta) * drag;
            vel[i * 3 + 1] = vel[i * 3 + 1] * drag + (0.3 * (1 - t)) * delta;      // warm air rises, less as it cools
            vel[i * 3 + 2] = (vel[i * 3 + 2] + az * delta) * drag;
            px += vel[i * 3] * delta; py += vel[i * 3 + 1] * delta; pz += vel[i * 3 + 2] * delta;
            // out of the body of the car: a puff that is inside it is put on the nearest side, and thrown off it (the car pushes the air away, it does
            // not carry it): it gets the speed that took it out, away from the surface, so that a car that turns or slides through its own smoke leaves
            // it behind instead of dragging it along
            if(box && Math.abs(px - vehicle.px) < box.radius && Math.abs(pz - vehicle.pz) < box.radius && Math.abs(py - vehicle.py) < box.radius) {
                pLocal.set(px - vehicle.px, py - vehicle.py, pz - vehicle.pz).applyQuaternion(qInv);
                var m = 0.12;                                // the puff has a size of its own: it keeps a little off the surface
                var yLow = box.y0 + 0.1;                     // under the floor of the car the smoke can go (the car stands a hand above the road)
                if(pLocal.x > box.x0 - m && pLocal.x < box.x1 + m && pLocal.y > yLow && pLocal.y < box.y1 + m && pLocal.z > box.z0 - m && pLocal.z < box.z1 + m) {
                    var ox = px, oy = py, oz = pz;
                    var dxa = pLocal.x - (box.x0 - m), dxb = (box.x1 + m) - pLocal.x, dyb = (box.y1 + m) - pLocal.y, dza = pLocal.z - (box.z0 - m), dzb = (box.z1 + m) - pLocal.z;
                    var least = Math.min(dxa, dxb, dyb, dza, dzb);        // (not down: a puff does not leave through the road)
                    if(least === dxa) pLocal.x = box.x0 - m; else if(least === dxb) pLocal.x = box.x1 + m;
                    else if(least === dyb) pLocal.y = box.y1 + m;
                    else if(least === dza) pLocal.z = box.z0 - m; else pLocal.z = box.z1 + m;
                    pLocal.applyQuaternion(qCar);
                    px = vehicle.px + pLocal.x; py = vehicle.py + pLocal.y; pz = vehicle.pz + pLocal.z;
                    var pushed = Math.hypot(px - ox, py - oy, pz - oz) || 1e-6;
                    var away = Math.min(5, pushed / Math.max(delta, 1e-3));            // m/s, along the way out
                    vel[i * 3] = vel[i * 3] * 0.5 + (px - ox) / pushed * away;
                    vel[i * 3 + 1] = vel[i * 3 + 1] * 0.5 + (py - oy) / pushed * away;
                    vel[i * 3 + 2] = vel[i * 3 + 2] * 0.5 + (pz - oz) / pushed * away;
                }
            }
            positions[i * 3] = px; positions[i * 3 + 1] = py; positions[i * 3 + 2] = pz;
            rotations[i] += spin[i] * delta;
            sizes[i] = size0[i] + (size1[i] - size0[i]) * Math.sqrt(t);
            alphas[i] = alpha0[i] * Math.pow(1 - t, 1.4) * Math.min(1, t / 0.05);
        }
        attributes.iPos.needsUpdate = true; attributes.iSize.needsUpdate = true; attributes.iAlpha.needsUpdate = true; attributes.iRot.needsUpdate = true;
        attributes.iTint.needsUpdate = true; attributes.iFrame.needsUpdate = true; attributes.iBase.needsUpdate = true;
    };

    this.clear = function() {
        age.fill(1e9);
        alphas.fill(0);
        last = [null, null, null, null];
        attributes.iAlpha.needsUpdate = true;
    };
};
