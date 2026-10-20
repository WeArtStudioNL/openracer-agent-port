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
        uniforms: { map: { value: makeAtlas() } },
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
        fragmentShader: "uniform sampler2D map; varying vec2 vUv; varying float vAlpha; varying vec3 vTint; varying vec2 vTile;" +
            "void main() {" +
            "  vec4 t = texture2D(map, (vTile + vUv) * 0.5);" +
            "  float a = t.a * vAlpha;" +
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
    scene.add(mesh);

    function spawn(x, y, z, vx, vy, vz, heat, dust) {
        var i = next;
        next = (next + 1) % capacity;
        positions[i * 3] = x + (Math.random() - 0.5) * 0.35;
        positions[i * 3 + 1] = y + 0.04;
        positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.35;
        bases[i] = y;
        // it is thrown a little the way the car goes (the tyre drags the air along), spreads sideways and rises
        vel[i * 3] = vx * 0.3 + (Math.random() - 0.5) * 1.2;
        vel[i * 3 + 1] = 0.4 + Math.random() * 0.9;
        vel[i * 3 + 2] = vz * 0.3 + (Math.random() - 0.5) * 1.2;
        age[i] = 0;
        life[i] = (dust ? 1.6 : 2.4) + Math.random() * 1.8 + heat * 1.0;
        size0[i] = 0.9 + Math.random() * 0.5;
        size1[i] = (dust ? 3.6 : 4.4) + Math.random() * 2.2 + heat * 3;
        alpha0[i] = (dust ? 0.3 : 0.4) + 0.32 * heat;
        rotations[i] = Math.random() * 6.2832;
        spin[i] = (Math.random() - 0.5) * 0.8;
        frames[i] = Math.floor(Math.random() * 4);
        var shade = 0.9 + Math.random() * 0.1;
        if(dust) { colours[i * 3] = 0.66 * shade; colours[i * 3 + 1] = 0.55 * shade; colours[i * 3 + 2] = 0.4 * shade; }
        else { colours[i * 3] = 0.9 * shade; colours[i * 3 + 1] = 0.91 * shade; colours[i * 3 + 2] = 0.94 * shade; }
    }

    // Moves the smoke and makes new smoke at the wheels along the path of the tyres. camera is not needed any more (the billboards face it in
    // the vertex shader) but it is still given.
    this.update = function(delta, vehicle, camera) {
        time += delta;
        var wheels = vehicle.wheels;
        for(var w = 0; w < 4; w++) {
            var wheel = wheels[w];
            if(wheel.smoke > 0.02 && wheel.hasContact) {
                var dust = wheel.surface !== "road" && wheel.surface !== "track01";
                var cx = wheel.contact.x, cy = wheel.contact.y, cz = wheel.contact.z;
                var from = last[w];
                if(!from || Math.hypot(cx - from.x, cz - from.z) > 6) from = { x: cx, y: cy, z: cz, carry: 0 };
                // the number of puffs follows the time (the rate) and they are spread over the path since the last frame
                from.carry += (dust ? 45 : 90) * wheel.smoke * delta;
                var count = Math.floor(from.carry);
                from.carry -= count;
                for(var n = 0; n < count; n++) {
                    var f = (n + Math.random()) / Math.max(1, count);
                    spawn(from.x + (cx - from.x) * f, from.y + (cy - from.y) * f, from.z + (cz - from.z) * f, vehicle.vx, vehicle.vy, vehicle.vz, wheel.heat, dust);
                }
                from.x = cx; from.y = cy; from.z = cz;
                last[w] = from;
            } else {
                last[w] = null;
            }
        }
        var drag = Math.exp(-1.1 * delta);
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
            positions[i * 3] = px + vel[i * 3] * delta;
            positions[i * 3 + 1] = py + vel[i * 3 + 1] * delta;
            positions[i * 3 + 2] = pz + vel[i * 3 + 2] * delta;
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
