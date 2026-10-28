/*
 * Debris.js
 *
 * Description: Small pieces of grass, sand, gravel, mud, earth and snow that a wheel throws up from loose ground. Next to the dust of Smoke.js (the cloud) these are the bits that fly
 *              and fall: points with a speed and the gravity, in one draw call, each with the shape of what it is: a thin green blade for grass (turned along the way that it flies, with
 *              now and then a clod of earth), many tiny round grains for sand, angular chunks for gravel, clumps for mud and earth, and soft flakes for snow.
 *
 *              A wheel on a loose surface (Helpers.js, uCoeff "loose": grass, sand, gravel, mud, earth), or on any surface under snow, throws them when its tyre slips against the ground.
 *              The direction is the way that the tread moves against the ground: the speed of the tread along the wheel (the turn of the wheel against the speed of the car) and the slide
 *              sideways. A driven wheel that spins throws them backwards, away from the way that it points; a wheel that slides sideways throws them the way the slide goes. The faster the
 *              slip, the more there are and the further they fly. They are made along the path of the tyre, as the smoke is.
 *
 *              Three options of the Graphics page: gfxDebrisRate (how many are made: 1 is as it was, 0 is none, any number), gfxDebrisScale (the size, 0 to 5 times) and gfxDebrisMax (the most pieces at once; they stay on the ground for a while after they came down, then go). A replay does not make them (the replay has what was recorded of the smoke).
 *
 *              var debris = new OpenRacer.Debris(scene);   debris.update(delta, vehicle);   debris.clear();
 * Author:      Glenn Hofman
 * Date:        2026-10-28
 * License:     MIT
 */

OpenRacer.Debris = function (scene, capacity) {
    capacity = capacity || 20000;                          // the most that the option allows (gfxDebrisMax); the number that is used is the option
    var positions = new Float32Array(capacity * 3), colours = new Float32Array(capacity * 3), sizes = new Float32Array(capacity), alphas = new Float32Array(capacity);
    var vel = new Float32Array(capacity * 3), shapes = new Float32Array(capacity), tilts = new Float32Array(capacity);
    var age = new Float32Array(capacity).fill(1e9), life = new Float32Array(capacity).fill(1), floor = new Float32Array(capacity);
    var quick = new Uint8Array(capacity);                  // 1 for water: it is gone soon after it came down
    var lying = new Uint8Array(capacity);                  // 1 for a piece that has come down and stays on the ground a while
    var limit = 0;
    var next = 0, alive = 0, pendingNew = true, last = [null, null, null, null], carry = [0, 0, 0, 0];

    var geometry = new THREE.BufferGeometry();
    function dynamic(array, n) { return new THREE.BufferAttribute(array, n).setUsage(THREE.DynamicDrawUsage); }
    var positionAttribute = dynamic(positions, 3), colourAttribute = dynamic(colours, 3), sizeAttribute = dynamic(sizes, 1), alphaAttribute = dynamic(alphas, 1);
    var velocityAttribute = dynamic(vel, 3), shapeAttribute = dynamic(shapes, 1), tiltAttribute = dynamic(tilts, 1);
    geometry.setAttribute("position", positionAttribute);
    geometry.setAttribute("colour", colourAttribute);
    geometry.setAttribute("size", sizeAttribute);
    geometry.setAttribute("alpha", alphaAttribute);
    geometry.setAttribute("velocity", velocityAttribute);
    geometry.setAttribute("shape", shapeAttribute);
    geometry.setAttribute("tilt", tiltAttribute);
    // shape: 0 an angular chunk, 1 a thin blade (turned along the way that it flies on the screen), 2 a round grain or clump
    var material = new THREE.ShaderMaterial({
        uniforms: { light: { value: 1 }, scale: { value: 600 }, aspect: { value: 1 }, sizeScale: { value: 1 } },
        vertexShader: "attribute vec3 colour; attribute float size; attribute float alpha; attribute vec3 velocity; attribute float shape; attribute float tilt;" +
            "uniform float scale; uniform float aspect; uniform float sizeScale; varying vec3 vColour; varying float vAlpha; varying float vShape; varying float vAngle;" +
            "void main() { vColour = colour; vAlpha = alpha; vShape = shape;" +
            "vec4 mv = modelViewMatrix * vec4(position, 1.0);" +
            "vec4 p0 = projectionMatrix * mv; vec4 p1 = projectionMatrix * (mv + vec4(mat3(modelViewMatrix) * velocity * 0.05, 0.0));" +
            "vec2 d = p1.xy / p1.w - p0.xy / p0.w; d.x *= aspect; vAngle = (length(d) > 1e-5 ? atan(d.y, d.x) : 0.0) + tilt;" +        // (the way that it flies, on the screen, and a little of its own)
            "gl_PointSize = max(shape > 0.5 && shape < 1.5 ? 4.0 : 1.5, size * sizeScale * scale / max(0.5, -mv.z)); gl_Position = p0; }",
        fragmentShader: "uniform float light; varying vec3 vColour; varying float vAlpha; varying float vShape; varying float vAngle;" +
            "void main() { vec2 c = gl_PointCoord - 0.5; c.y = -c.y; float a;" +
            "if (vShape < 0.5) a = smoothstep(0.5, 0.36, max(abs(c.x), abs(c.y)));" +
            "else if (vShape < 1.5) { float cs = cos(vAngle), sn = sin(vAngle); vec2 r = vec2(c.x * cs + c.y * sn, -c.x * sn + c.y * cs);" +
            "  float w = 0.035 + 0.07 * (1.0 - abs(r.x) * 2.0); a = smoothstep(w, w * 0.35, abs(r.y)) * smoothstep(0.5, 0.4, abs(r.x)); }" +      // (a blade: thin, wider in the middle, with a point at both ends)
            "else a = smoothstep(0.5, 0.2, length(c));" +
            "if (a * vAlpha < 0.02) discard; gl_FragColor = vec4(vColour * light, a * vAlpha); }",
        transparent: true, depthWrite: false, fog: false
    });
    var points = new THREE.Points(geometry, material);
    points.name = "debris";
    points.frustumCulled = false;
    points.renderOrder = 4;
    scene.add(points);

    // the colours of the pieces of every surface: a few shades (as sRGB; the picture wants them linear)
    function shades(list) { return list.map(function (c) { return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)]; }); }
    var SHADES = {
        grass: shades([[0.22, 0.46, 0.08], [0.3, 0.56, 0.1], [0.4, 0.62, 0.14], [0.18, 0.38, 0.07], [0.5, 0.6, 0.18], [0.3, 0.5, 0.1]]),       // blades: a few greens, some dry and yellow
        clod: shades([[0.32, 0.24, 0.13], [0.26, 0.19, 0.1], [0.4, 0.3, 0.18]]),
        sand: shades([[0.88, 0.74, 0.52], [0.8, 0.66, 0.44], [0.93, 0.82, 0.62], [0.74, 0.6, 0.4], [0.96, 0.88, 0.72]]),
        gravel: shades([[0.8, 0.7, 0.54], [0.7, 0.6, 0.45], [0.86, 0.78, 0.62], [0.6, 0.52, 0.4], [0.66, 0.64, 0.6]]),
        mud: shades([[0.28, 0.2, 0.13], [0.2, 0.14, 0.09], [0.36, 0.26, 0.16]]),
        ground: shades([[0.55, 0.43, 0.3], [0.46, 0.36, 0.24], [0.62, 0.5, 0.36]]),
        water: shades([[0.95, 0.97, 1.0], [0.78, 0.83, 0.9], [0.62, 0.68, 0.76], [0.88, 0.9, 0.94]]).map(function (c) { return [c[0] * 1.7, c[1] * 1.7, c[2] * 1.7]; }),      // spray: white and grey
        snow: shades([[1.0, 1.0, 1.0], [0.92, 0.95, 1.0], [1.0, 1.0, 1.0]]).map(function (c) { return [c[0] * 2.2, c[1] * 2.2, c[2] * 2.2]; })       // (bright: lighter than the snow, which is itself lit)
    };
    // what each kind looks like: the shape, the size (m: the length of a blade, the width of the rest), the number made compared with the rest, how far they fly
    var LOOK = {
        grass: { shape: 1, size: [0.1, 0.2], rate: 1.3, fly: 1 },
        clod: { shape: 2, size: [0.025, 0.05], rate: 1, fly: 0.8 },
        sand: { shape: 2, size: [0.008, 0.02], rate: 3.2, fly: 1 },
        gravel: { shape: 0, size: [0.012, 0.03], rate: 2, fly: 0.9 },
        mud: { shape: 2, size: [0.03, 0.07], rate: 0.9, fly: 0.7 },
        ground: { shape: 2, size: [0.02, 0.045], rate: 1.2, fly: 0.9 },
        snow: { shape: 2, size: [0.01, 0.026], rate: 1.1, fly: 0.9 },
        water: { shape: 1, size: [0.05, 0.12], rate: 1, fly: 1 },
        droplet: { shape: 2, size: [0.012, 0.03], rate: 1, fly: 1 }
    };

    function spawn(x, y, z, vx, vy, vz, kind) {
        if (next >= limit) next = 0;
        var i = next, look = LOOK[kind] || LOOK.ground;
        next = (next + 1) % limit;
        var shade = SHADES[kind === "droplet" ? "water" : kind] || SHADES.ground, c = shade[Math.floor(Math.random() * shade.length)];
        quick[i] = kind === "water" || kind === "droplet" ? 1 : 0;
        positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        colours[i * 3] = c[0]; colours[i * 3 + 1] = c[1]; colours[i * 3 + 2] = c[2];
        sizes[i] = look.size[0] + Math.random() * (look.size[1] - look.size[0]); alphas[i] = 1;
        shapes[i] = look.shape; tilts[i] = (Math.random() - 0.5) * 1.2;
        age[i] = 0; life[i] = 0.7 + Math.random() * 0.9; floor[i] = y - 0.02; lying[i] = 0;
        pendingNew = true;
    }

    var fwd = new THREE.Vector3(), lft = new THREE.Vector3(), sprayCarry = [0, 0, 0, 0];
    function spray(w, wheel, contact, vehicle, puddle, speed, amount, delta) {
        fwd.set(wheel.heading.x, 0, wheel.heading.z);
        if (fwd.lengthSq() < 1e-6) return;
        fwd.normalize(); lft.set(fwd.z, 0, -fwd.x);
        var side = wheel.right ? -1 : 1;                                       // (outwards: away from the car)
        sprayCarry[w] += Math.min(500, (30 + 12 * speed) * puddle) * amount * delta;
        var count = Math.min(100, Math.floor(sprayCarry[w]));
        sprayCarry[w] = Math.min(sprayCarry[w] - count, 1);
        for (var n = 0; n < count; n++) {
            var kind = Math.random() < 0.65 ? "water" : "droplet";
            var out = (0.8 + 0.3 * speed) * (0.4 + Math.random() * 0.8), ahead = speed * (Math.random() * 0.25 - 0.08), up = 1.0 + 0.1 * speed * Math.random() + Math.random() * 1.6;
            var jitter = (Math.random() - 0.5) * 0.5;
            spawn(contact.x + lft.x * side * (Math.random() * 0.1) + (Math.random() - 0.5) * 0.1, contact.y + 0.03, contact.z + lft.z * side * (Math.random() * 0.1) + (Math.random() - 0.5) * 0.1,
                lft.x * side * out + fwd.x * (ahead + jitter) + vehicle.vx * 0.4, Math.min(5, up), lft.z * side * out + fwd.z * (ahead + jitter) + vehicle.vz * 0.4, kind);
        }
    }

    // The pieces that fly: gravity and a little drag; one that comes down to the height where it began stays a moment and goes
    this.update = function (delta, vehicle) {
        delta = Math.min(delta || 0, 0.05);
        // the options: how many are made (1 is normal, 0 is none, any number), how big (1 is normal), and the most at once
        var amount = typeof Settings !== "undefined" && Settings.option("gfxDebrisRate") !== undefined ? Math.max(0, Settings.option("gfxDebrisRate")) : 1;
        var sizeScale = typeof Settings !== "undefined" && Settings.option("gfxDebrisScale") !== undefined ? Math.max(0, Settings.option("gfxDebrisScale")) : 1;
        var newLimit = typeof Settings !== "undefined" && Settings.option("gfxDebrisMax") > 0 ? Math.min(capacity, Math.max(100, Math.round(Settings.option("gfxDebrisMax")))) : 6000;
        if (newLimit < limit) { for (var k = newLimit; k < limit; k++) { age[k] = 1e9; alphas[k] = 0; sizes[k] = 0; } pendingNew = true; }
        limit = newLimit;
        geometry.setDrawRange(0, limit);
        points.visible = sizeScale > 0;
        material.uniforms.sizeScale.value = sizeScale;
        var wheels = vehicle.wheels, snow = OpenRacer.Atmosphere ? OpenRacer.Atmosphere.info().snow : 0;
        for (var w = 0; w < 4; w++) {
            var wheel = wheels[w];
            var surface = wheel.surface, info = typeof getSurface === "function" ? getSurface(surface) : null, loose = !!(info && info.loose), snowy = snow > 0.35;
            var contact = wheel.hasContact && wheel.contact ? wheel.contact : null;
            // water: a wheel in a puddle that goes fast throws it up and to the sides (the more the faster), white and grey blades and droplets that fall again at once
            var puddleHere = wheel.localWater || 0, driving = Math.hypot(vehicle.vx, vehicle.vz);
            if (amount > 0 && contact && puddleHere > 0.3 && driving > 3 && snow < 0.3 && wheel.heading) spray(w, wheel, contact, vehicle, puddleHere, driving, amount, delta);
            if (amount <= 0 || !contact || !(loose || snowy)) { last[w] = null; continue; }
            // the way that the tread moves against the ground, in the frame of the wheel: along it (the turn against the speed of the car; backwards for a wheel that spins) and
            // across it (the slide: where the car goes sideways)
            var heading = wheel.heading;
            if (!heading) { last[w] = null; continue; }
            fwd.set(heading.x, 0, heading.z);
            if (fwd.lengthSq() < 1e-6) { last[w] = null; continue; }
            fwd.normalize();
            lft.set(fwd.z, 0, -fwd.x);
            var along = (wheel.forwardSpeed || 0) - (wheel.omega || 0) * wheel.radius;       // (the tread against the ground: negative is backwards)
            var across = (wheel.slipTan || 0) * Math.max(Math.abs(wheel.forwardSpeed || 0), 1.5);
            var slip = Math.hypot(along, across);
            if (slip < 1.2) { last[w] = null; continue; }
            var strength = Math.min(1, (slip - 1.0) / 6);
            var main = snowy && (!loose || Math.random() < snow) ? "snow" : (SHADES[surface] ? surface : "ground");
            var rate = (LOOK[main] || LOOK.ground).rate;
            carry[w] += (70 + 330 * strength) * rate * amount * delta;
            var count = Math.min(Math.ceil(120 * Math.max(1, amount)), Math.floor(carry[w]));
            carry[w] = Math.min(carry[w] - count, 1);
            var cx = contact.x, cy = contact.y, cz = contact.z, from = last[w] || { x: cx, y: cy, z: cz };
            if (Math.hypot(cx - from.x, cz - from.z) > 5) { from.x = cx; from.y = cy; from.z = cz; }
            // the direction of the throw: the way that the tread moves against the ground
            var dx = (fwd.x * along + lft.x * across) / slip, dz = (fwd.z * along + lft.z * across) / slip;
            var speed = Math.min(11, 1.5 + slip * 0.9);
            for (var n = 0; n < count; n++) {
                var kind = main === "grass" && Math.random() < 0.12 ? "clod" : main;                 // (a clod of earth now and then between the blades)
                var look = LOOK[kind], f = (n + Math.random()) / Math.max(1, count), spreadAngle = (Math.random() - 0.5) * 0.9, ca = Math.cos(spreadAngle), sa = Math.sin(spreadAngle);
                var rx = dx * ca - dz * sa, rz = dx * sa + dz * ca, v = speed * look.fly * (0.35 + Math.random() * 0.75);
                spawn(from.x + (cx - from.x) * f + (Math.random() - 0.5) * 0.12, from.y + (cy - from.y) * f + 0.03, from.z + (cz - from.z) * f + (Math.random() - 0.5) * 0.12,
                    rx * v + vehicle.vx * 0.5, 1.4 + Math.random() * (1.5 + strength * 3.2), rz * v + vehicle.vz * 0.5, kind);
            }
            from.x = cx; from.y = cy; from.z = cz;
            last[w] = from;
        }
        if (alive === 0 && !pendingNew) return;
        alive = 0;
        var drag = Math.exp(-0.7 * delta);
        for (var i = 0; i < limit; i++) {
            if (age[i] >= life[i]) { if (alphas[i] !== 0) { alphas[i] = 0; sizes[i] = 0; } continue; }
            age[i] += delta;
            if (!lying[i]) {
                vel[i * 3] *= drag; vel[i * 3 + 2] *= drag; vel[i * 3 + 1] = vel[i * 3 + 1] * drag - 9.8 * delta;
                positions[i * 3] += vel[i * 3] * delta; positions[i * 3 + 1] += vel[i * 3 + 1] * delta; positions[i * 3 + 2] += vel[i * 3 + 2] * delta;
                if (positions[i * 3 + 1] < floor[i]) {                  // it has come down: it stays where it is for a while (5 to 14 s), then goes
                    positions[i * 3 + 1] = floor[i]; vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0;
                    lying[i] = 1; life[i] = quick[i] ? age[i] + 0.15 : age[i] + 5 + Math.random() * 9;
                }
            }
            alphas[i] = Math.min(1, (life[i] - age[i]) / (lying[i] && !quick[i] ? 1.5 : 0.25));
            alive++;
        }
        // the light on them: as bright as the light of the scene (a night, or the weather, makes them dark as well)
        var lum = typeof ambientLight !== "undefined" && typeof sunLight !== "undefined" ? (ambientLight.intensity + 0.7 * sunLight.intensity) / (Math.PI * 1.6) : 1;
        material.uniforms.light.value = Math.max(0.08, Math.min(1, lum));
        material.uniforms.aspect.value = window.innerWidth / Math.max(1, window.innerHeight);
        positionAttribute.needsUpdate = colourAttribute.needsUpdate = sizeAttribute.needsUpdate = alphaAttribute.needsUpdate = true;
        velocityAttribute.needsUpdate = shapeAttribute.needsUpdate = tiltAttribute.needsUpdate = true;
        pendingNew = false;
    };

    this.clear = function () {
        age.fill(1e9); alphas.fill(0); sizes.fill(0); lying.fill(0); quick.fill(0);
        alphaAttribute.needsUpdate = sizeAttribute.needsUpdate = true;
        last = [null, null, null, null]; alive = 0;
    };
};
