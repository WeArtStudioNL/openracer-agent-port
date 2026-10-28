/*
 * Debris.js
 *
 * Description: Small pieces of grass, sand, gravel, mud, earth and snow that a wheel throws up from loose ground. Next to the dust of Smoke.js (the cloud) these are the bits that fly
 *              and fall: points with a speed and the gravity, in one draw call, with the colours of the surface (a few shades of each).
 *
 *              A wheel on a loose surface (Helpers.js, uCoeff "loose": grass, sand, gravel, mud, earth), or on any surface under snow, throws them when its tyre slips against the ground.
 *              The direction is the way that the tread moves against the ground: the speed of the tread along the wheel (the turn of the wheel against the speed of the car) and the slide
 *              sideways. A driven wheel that spins throws them backwards, away from the way that it points; a wheel that slides sideways throws them the way the slide goes. The faster the
 *              slip, the more there are and the further they fly. They are made along the path of the tyre, as the smoke is.
 *
 *              The Debris option of the Graphics page (gfxDebris, a percentage; 0 is off) sets the number. A replay does not make them (the replay has what was recorded of the smoke).
 *
 *              var debris = new OpenRacer.Debris(scene);   debris.update(delta, vehicle);   debris.clear();
 * Author:      Glenn Hofman
 * Date:        2026-10-28
 * License:     MIT
 */

OpenRacer.Debris = function (scene, capacity) {
    capacity = capacity || 1600;
    var positions = new Float32Array(capacity * 3), colours = new Float32Array(capacity * 3), sizes = new Float32Array(capacity), alphas = new Float32Array(capacity);
    var vel = new Float32Array(capacity * 3), age = new Float32Array(capacity).fill(1e9), life = new Float32Array(capacity).fill(1), floor = new Float32Array(capacity), spin = new Float32Array(capacity);
    var next = 0, alive = 0, pendingNew = true, last = [null, null, null, null], carry = [0, 0, 0, 0];

    var geometry = new THREE.BufferGeometry();
    var positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage), colourAttribute = new THREE.BufferAttribute(colours, 3).setUsage(THREE.DynamicDrawUsage);
    var sizeAttribute = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage), alphaAttribute = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", positionAttribute);
    geometry.setAttribute("colour", colourAttribute);
    geometry.setAttribute("size", sizeAttribute);
    geometry.setAttribute("alpha", alphaAttribute);
    var material = new THREE.ShaderMaterial({
        uniforms: { light: { value: 1 }, scale: { value: 600 } },
        vertexShader: "attribute vec3 colour; attribute float size; attribute float alpha; uniform float scale; varying vec3 vColour; varying float vAlpha;" +
            "void main() { vColour = colour; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.5, size * scale / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; }",
        fragmentShader: "uniform float light; varying vec3 vColour; varying float vAlpha;" +
            "void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.35, max(abs(c.x), abs(c.y))); if (a * vAlpha < 0.02) discard; gl_FragColor = vec4(vColour * light, a * vAlpha); }",
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
        grass: shades([[0.24, 0.42, 0.1], [0.34, 0.54, 0.14], [0.2, 0.34, 0.08], [0.32, 0.24, 0.12], [0.4, 0.5, 0.2]]),
        sand: shades([[0.86, 0.72, 0.5], [0.78, 0.64, 0.42], [0.92, 0.8, 0.6]]),
        gravel: shades([[0.55, 0.52, 0.48], [0.44, 0.42, 0.4], [0.66, 0.62, 0.56]]),
        mud: shades([[0.28, 0.2, 0.13], [0.2, 0.14, 0.09], [0.36, 0.26, 0.16]]),
        ground: shades([[0.55, 0.43, 0.3], [0.46, 0.36, 0.24], [0.62, 0.5, 0.36]]),
        snow: shades([[0.95, 0.97, 1.0], [0.86, 0.9, 0.97], [1.0, 1.0, 1.0]])
    };

    function spawn(x, y, z, vx, vy, vz, kind, size) {
        var i = next;
        next = (next + 1) % capacity;
        var shade = SHADES[kind] || SHADES.ground, c = shade[Math.floor(Math.random() * shade.length)];
        positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        colours[i * 3] = c[0]; colours[i * 3 + 1] = c[1]; colours[i * 3 + 2] = c[2];
        sizes[i] = size; alphas[i] = 1;
        age[i] = 0; life[i] = 0.7 + Math.random() * 0.9; floor[i] = y - 0.02;
        spin[i] = Math.random();
        pendingNew = true;
    }

    var fwd = new THREE.Vector3(), lft = new THREE.Vector3();

    // The pieces that fly: gravity and a little drag; one that comes down to the height where it began stays a moment and goes
    this.update = function (delta, vehicle) {
        delta = Math.min(delta || 0, 0.05);
        var amount = typeof Settings !== "undefined" && Settings.option("gfxDebris") !== undefined ? Math.max(0, Settings.option("gfxDebris") / 100) : 1;
        var wheels = vehicle.wheels, snow = OpenRacer.Atmosphere ? OpenRacer.Atmosphere.info().snow : 0;
        for (var w = 0; w < 4; w++) {
            var wheel = wheels[w];
            var surface = wheel.surface, info = typeof getSurface === "function" ? getSurface(surface) : null, loose = !!(info && info.loose), snowy = snow > 0.35;
            var contact = wheel.hasContact && wheel.contact ? wheel.contact : null;
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
            var load = wheel.load !== undefined ? Math.min(1, Math.max(0, wheel.load / 1500)) : 1;
            if (wheel.load !== undefined && wheel.load < 50) { last[w] = null; continue; }      // (a wheel in the air throws nothing)
            var kind = snowy && (!loose || Math.random() < snow) ? "snow" : (surface === "grass" ? "grass" : (SHADES[surface] ? surface : "ground"));
            carry[w] += (70 + 330 * strength) * (0.4 + 0.6 * Math.max(load, 0.3)) * amount * delta;
            var count = Math.floor(carry[w]);
            carry[w] -= count;
            var cx = contact.x, cy = contact.y, cz = contact.z, from = last[w] || { x: cx, y: cy, z: cz };
            if (Math.hypot(cx - from.x, cz - from.z) > 5) { from.x = cx; from.y = cy; from.z = cz; }
            // the direction of the throw: the way that the tread moves against the ground
            var dx = (fwd.x * along + lft.x * across) / slip, dz = (fwd.z * along + lft.z * across) / slip;
            var speed = Math.min(11, 1.5 + slip * 0.9);
            for (var n = 0; n < count; n++) {
                var f = (n + Math.random()) / Math.max(1, count), spreadAngle = (Math.random() - 0.5) * 0.9, ca = Math.cos(spreadAngle), sa = Math.sin(spreadAngle);
                var rx = dx * ca - dz * sa, rz = dx * sa + dz * ca, v = speed * (0.35 + Math.random() * 0.75);
                spawn(from.x + (cx - from.x) * f + (Math.random() - 0.5) * 0.12, from.y + (cy - from.y) * f + 0.03, from.z + (cz - from.z) * f + (Math.random() - 0.5) * 0.12,
                    rx * v + vehicle.vx * 0.5, 1.4 + Math.random() * (1.5 + strength * 3.2), rz * v + vehicle.vz * 0.5,
                    kind, 0.035 + Math.random() * 0.05 * (kind === "sand" ? 0.6 : 1.3));
            }
            from.x = cx; from.y = cy; from.z = cz;
            last[w] = from;
        }
        if (alive === 0 && !pendingNew) return;
        alive = 0;
        var drag = Math.exp(-0.7 * delta), fade = 0;
        for (var i = 0; i < capacity; i++) {
            if (age[i] >= life[i]) { if (alphas[i] !== 0) { alphas[i] = 0; sizes[i] = 0; } continue; }
            age[i] += delta;
            vel[i * 3] *= drag; vel[i * 3 + 2] *= drag; vel[i * 3 + 1] = vel[i * 3 + 1] * drag - 9.8 * delta;
            positions[i * 3] += vel[i * 3] * delta; positions[i * 3 + 1] += vel[i * 3 + 1] * delta; positions[i * 3 + 2] += vel[i * 3 + 2] * delta;
            if (positions[i * 3 + 1] < floor[i]) { positions[i * 3 + 1] = floor[i]; vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0; age[i] = Math.max(age[i], life[i] - 0.25); }   // (landed: gone in a moment)
            alphas[i] = Math.min(1, (life[i] - age[i]) / 0.25);
            alive++;
        }
        // the light on them: as bright as the light of the scene (a night, or the weather, makes them dark as well)
        var lum = typeof ambientLight !== "undefined" && typeof sunLight !== "undefined" ? (ambientLight.intensity + 0.7 * sunLight.intensity) / (Math.PI * 1.6) : 1;
        material.uniforms.light.value = Math.max(0.08, Math.min(1, lum));
        positionAttribute.needsUpdate = colourAttribute.needsUpdate = sizeAttribute.needsUpdate = alphaAttribute.needsUpdate = true;
        pendingNew = false;
    };
    this.clear = function () {
        age.fill(1e9); alphas.fill(0); sizes.fill(0);
        alphaAttribute.needsUpdate = sizeAttribute.needsUpdate = true;
        last = [null, null, null, null]; alive = 0;
    };
};
