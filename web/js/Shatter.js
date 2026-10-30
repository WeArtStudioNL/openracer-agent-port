/*
 * Shatter.js
 *
 * Description: The pieces and the particles of a part that breaks (a part of the mode "breakable" in car.json, Parts.js): glass, a lamp, a mirror. The part is
 *              gone at once and in its place there are its pieces, each a rigid piece of the part (a face or a cluster of faces of its own mesh, or a piece of
 *              the hidden mesh <name>_broken of the model), and a cloud of small particles of a material (glass, plastic, metal). The pieces fly off with the speed
 *              of the car and a little more, turn, bounce on the road, come to lie flat, lie a while and shrink away; the particles fly and fall and lie a while, as
 *              the debris of the wheels does (Debris.js).
 *
 *              The pieces move by a simple physics of their own (gravity, drag, the road under them from the ground of the track), not in the physics of the
 *              parts: that is cheap for many of them, and a replay makes them again from what was recorded when they were made (the place, the turn, the speed
 *              and the spin of each piece; the place, the speed, the number and the look of each cloud) and lets them move by the same code.
 *
 *              The shapes of the pieces come from the part (Parts.js registers a builder for every breakable part under a key that follows from the model, so a
 *              replay that builds the car again finds them under the same key).
 *
 *              OpenRacer.Shatter.register(key, { build, top, ground })    build(): [{ geometry, material, flat, half, radius }] in the frame of the piece
 *              OpenRacer.Shatter.piece(key, index, position, quaternion, scale, velocity, spin)
 *              OpenRacer.Shatter.burst(x, y, z, vx, vy, vz, count, shape, colour, size, spread, seed, key)
 *              OpenRacer.Shatter.step(delta)    every frame of the game (Car.js; the car editor's bench)
 *              OpenRacer.Shatter.clear()
 * Author:      Glenn Hofman
 * Date:        2026-10-30
 * License:     MIT
 */

OpenRacer.Shatter = (function () {
    var sources = {};                  // key -> { build, pieces (made once), top() (the scene), ground() }
    var pieces = [];                   // the pieces that are out: { key, index, mesh, p, q, s, v, w, age, life, lying, settle, from, to }
    var MAX_PIECES = 400, LIE = 7, SHRINK = 1, GRAVITY = 9.81;
    var lastGround = null, lastTop = null;

    // the particles: points as Debris.js has them, a ring of a few thousand
    var CAP = 4000, made = false, points = null, material = null, geometry = null;
    var pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 3), size = new Float32Array(CAP), alpha = new Float32Array(CAP), shape = new Float32Array(CAP), tilt = new Float32Array(CAP);
    var vel = new Float32Array(CAP * 3), age = new Float32Array(CAP).fill(1e9), life = new Float32Array(CAP).fill(1), floor = new Float32Array(CAP), lying = new Uint8Array(CAP);
    var next = 0, alive = 0, dirty = false;
    var attrs = null;

    function makePoints(top) {
        if (made) { if (top && points.parent !== top) top.add(points); return; }
        made = true;
        geometry = new THREE.BufferGeometry();
        function dyn(array, n) { return new THREE.BufferAttribute(array, n).setUsage(THREE.DynamicDrawUsage); }
        attrs = { position: dyn(pos, 3), colour: dyn(col, 3), size: dyn(size, 1), alpha: dyn(alpha, 1), shape: dyn(shape, 1), tilt: dyn(tilt, 1) };
        for (var name in attrs) geometry.setAttribute(name, attrs[name]);
        // shape: 0 an angular shard, 1 a thin splinter, 2 a round grain (as Debris.js; the shards glint a little: a lighter edge)
        material = new THREE.ShaderMaterial({
            uniforms: { light: { value: 1 }, scale: { value: 600 } },
            vertexShader: "attribute vec3 colour; attribute float size; attribute float alpha; attribute float shape; attribute float tilt; uniform float scale;" +
                "varying vec3 vColour; varying float vAlpha; varying float vShape; varying float vTilt;" +
                "void main() { vColour = colour; vAlpha = alpha; vShape = shape; vTilt = tilt; vec4 mv = modelViewMatrix * vec4(position, 1.0);" +
                "gl_PointSize = max(1.5, size * scale / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; }",
            fragmentShader: "uniform float light; varying vec3 vColour; varying float vAlpha; varying float vShape; varying float vTilt;" +
                "void main() { vec2 c = gl_PointCoord - 0.5; float cs = cos(vTilt), sn = sin(vTilt); vec2 r = vec2(c.x * cs + c.y * sn, -c.x * sn + c.y * cs); float a; float edge = 0.0;" +
                "if (vShape < 0.5) { float d = abs(r.x) + abs(r.y) * 1.4; a = smoothstep(0.5, 0.42, d); edge = smoothstep(0.3, 0.45, d); }" +
                "else if (vShape < 1.5) { float w = 0.04 + 0.08 * (1.0 - abs(r.x) * 2.0); a = smoothstep(w, w * 0.35, abs(r.y)) * smoothstep(0.5, 0.4, abs(r.x)); }" +
                "else a = smoothstep(0.5, 0.2, length(c));" +
                "if (a * vAlpha < 0.02) discard; gl_FragColor = vec4(vColour * light * (1.0 + 0.6 * edge), a * vAlpha); }",
            transparent: true, depthWrite: false, fog: false
        });
        points = new THREE.Points(geometry, material);
        points.name = "shatter";
        points.frustumCulled = false;
        points.renderOrder = 4;
        points.userData.noGBuffer = true;
        if (top) top.add(points);
    }

    // a random number from a seed (the same cloud again in a replay)
    function seeded(seed) {
        var t = (seed >>> 0) || 1;
        return function () { t += 0x6D2B79F5; var r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
    }
    function floorAt(x, y, z) {
        var g = lastGround;
        var hit = g && g.query ? g.query(x, z, y + 0.3, 0.5) : null;
        return hit ? hit.y : y - 1.2;
    }

    var api = { recorder: null };

    // ---- the pieces
    api.register = function (key, source) {
        var old = sources[key];
        sources[key] = { build: source.build, pieces: old ? old.pieces : null, top: source.top, ground: source.ground };
        if (!api.attached && OpenRacer.Replay && OpenRacer.Replay.attach) { api.attached = true; OpenRacer.Replay.attach("shatter", api); }
    };
    function shapesOf(key) {
        var s = sources[key];
        if (!s) return null;
        if (!s.pieces) { try { s.pieces = s.build() || []; } catch (e) { console.warn("Shatter: " + e.message); s.pieces = []; } }
        return s.pieces;
    }
    function globalScene() { return typeof scene !== "undefined" && scene && scene.isScene ? scene : null; }
    api.shapes = function (key) { return shapesOf(key); };
    function topOf(key) { var s = sources[key]; var t = s && s.top ? s.top() : null; if (t) lastTop = t; return t || lastTop || globalScene(); }
    function groundOf(key) { var s = sources[key]; var g = s && s.ground ? s.ground() : null; if (g) lastGround = g; return g || lastGround; }

    function addPiece(key, index, px, py, pz, qx, qy, qz, qw, sc, vx, vy, vz, wx, wy, wz) {
        var list = shapesOf(key), look = list && list[index];
        if (!look) return;
        var top = topOf(key);
        groundOf(key);
        if (!top) return;
        if (pieces.length >= MAX_PIECES) removePiece(0);
        var mesh = new THREE.Mesh(look.geometry, look.material);
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        top.add(mesh);
        var piece = { key: key, index: index, mesh: mesh, p: new THREE.Vector3(px, py, pz), q: new THREE.Quaternion(qx, qy, qz, qw).normalize(), s: sc, v: new THREE.Vector3(vx, vy, vz), w: new THREE.Vector3(wx, wy, wz),
            age: 0, life: LIE + (index % 7) * 0.4, lying: false, settle: 0, from: null, to: null, look: look, landed: 0 };
        pieces.push(piece);
        place(piece);
    }
    function removePiece(i) { var p = pieces[i]; if (p.mesh.parent) p.mesh.parent.remove(p.mesh); pieces.splice(i, 1); }
    var tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), unit = new THREE.Vector3();
    function place(piece) {
        var shrink = piece.lying && piece.age > piece.life ? Math.max(0, 1 - (piece.age - piece.life) / SHRINK) : 1;
        unit.setScalar(piece.s * shrink);
        piece.mesh.matrix.compose(piece.p, piece.q, unit);
        piece.mesh.matrixWorldNeedsUpdate = true;
    }

    // position, quaternion: of the piece in the world; scale: one number (the size of the model); velocity, spin: in the world (rad/s)
    api.piece = function (key, index, position, quaternion, scale, velocity, spin) {
        addPiece(key, index, position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w, scale, velocity.x, velocity.y, velocity.z, spin.x, spin.y, spin.z);
        if (api.recorder) api.recorder(Float32Array.of(0, 0, key, index, position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w, scale, velocity.x, velocity.y, velocity.z, spin.x, spin.y, spin.z));
    };

    function stepPieces(delta) {
        var drag = Math.exp(-0.25 * delta);
        for (var i = pieces.length - 1; i >= 0; i--) {
            var p = pieces[i];
            p.age += delta;
            if (p.lying && p.age > p.life + SHRINK) { removePiece(i); continue; }
            if (!p.lying) {
                p.v.multiplyScalar(drag); p.v.y -= GRAVITY * delta;
                p.p.addScaledVector(p.v, delta);
                var wl = p.w.length();
                if (wl > 1e-4) { tmpQ.setFromAxisAngle(tmpV.copy(p.w).divideScalar(wl), wl * delta); p.q.premultiply(tmpQ).normalize(); }
                // the road under it: it touches when its middle is less than about half its size above it
                var ground = floorAt(p.p.x, p.p.y, p.p.z), reach = Math.max(0.01, p.look.radius * p.s * 0.45);
                if (p.p.y - ground < reach && p.v.y < 0) {
                    p.landed++;
                    if (p.landed >= 3 || Math.abs(p.v.y) < 1.2) {
                        // it lies down: turned flat (its own flat side up or down, whichever is nearer), on the road
                        p.lying = true; p.settle = 0; p.from = p.q.clone();
                        var n = tmpV.copy(p.look.flat).applyQuaternion(p.q);
                        if (n.y < 0) n.negate();
                        p.to = new THREE.Quaternion().setFromUnitVectors(n, up).multiply(p.q);
                        p.p.y = ground + p.look.half * p.s + 0.002;
                        p.v.set(0, 0, 0); p.w.set(0, 0, 0);
                        p.life = Math.max(p.life, p.age + LIE * 0.6);
                    } else {
                        p.p.y = ground + reach;
                        p.v.y = -p.v.y * 0.3; p.v.x *= 0.55; p.v.z *= 0.55; p.w.multiplyScalar(0.5);
                    }
                }
            } else if (p.settle < 1) {
                p.settle = Math.min(1, p.settle + delta / 0.12);
                p.q.slerpQuaternions(p.from, p.to, p.settle);
            }
            place(p);
        }
    }

    // ---- the particles
    // count particles from a place (within spread metres of it), with the speed of the car and some of their own; shape 0 shards, 1 splinters, 2 grains;
    // colour [r, g, b] linear; size in metres
    function addBurst(x, y, z, vx, vy, vz, count, kind, r, g, b, sz, spread, seed) {
        makePoints(lastTop || globalScene());
        var rnd = seeded(seed), ground = floorAt(x, y, z);
        count = Math.min(600, Math.max(0, Math.round(count)));
        for (var n = 0; n < count; n++) {
            var i = next; next = (next + 1) % CAP;
            var ox = (rnd() - 0.5) * 2 * spread, oy = (rnd() - 0.5) * spread, oz = (rnd() - 0.5) * 2 * spread;
            pos[i * 3] = x + ox; pos[i * 3 + 1] = y + oy; pos[i * 3 + 2] = z + oz;
            var out = 0.8 + rnd() * 2.6, len = Math.hypot(ox, oy, oz) || 1;
            vel[i * 3] = vx + ox / len * out + (rnd() - 0.5); vel[i * 3 + 1] = vy + 0.6 + rnd() * 1.8; vel[i * 3 + 2] = vz + oz / len * out + (rnd() - 0.5);
            var shade = 0.75 + rnd() * 0.5;
            col[i * 3] = r * shade; col[i * 3 + 1] = g * shade; col[i * 3 + 2] = b * shade;
            size[i] = sz * (0.5 + rnd()); alpha[i] = 1; shape[i] = kind; tilt[i] = rnd() * 6.283;
            age[i] = 0; life[i] = 1.5 + rnd(); lying[i] = 0; floor[i] = ground;
        }
        dirty = true;
    }
    // (key: of the part, for the scene to draw in and the ground under it)
    api.burst = function (x, y, z, vx, vy, vz, count, kind, colour, sz, spread, seed, key) {
        if (key !== undefined) { topOf(key); groundOf(key); }
        addBurst(x, y, z, vx, vy, vz, count, kind, colour[0], colour[1], colour[2], sz, spread, seed);
        if (api.recorder) api.recorder(Float32Array.of(0, 1, x, y, z, vx, vy, vz, count, kind, colour[0], colour[1], colour[2], sz, spread, seed, 0, 0));
    };
    function stepParticles(delta) {
        if (!made || (alive === 0 && !dirty)) return;
        alive = 0;
        var drag = Math.exp(-0.6 * delta);
        for (var i = 0; i < CAP; i++) {
            if (age[i] >= life[i]) { if (alpha[i] !== 0) { alpha[i] = 0; size[i] = 0; } continue; }
            age[i] += delta;
            if (!lying[i]) {
                vel[i * 3] *= drag; vel[i * 3 + 2] *= drag; vel[i * 3 + 1] = vel[i * 3 + 1] * drag - GRAVITY * delta;
                pos[i * 3] += vel[i * 3] * delta; pos[i * 3 + 1] += vel[i * 3 + 1] * delta; pos[i * 3 + 2] += vel[i * 3 + 2] * delta;
                if (pos[i * 3 + 1] < floor[i] + 0.004) { pos[i * 3 + 1] = floor[i] + 0.004; lying[i] = 1; life[i] = age[i] + 6 + (i % 9); }
            }
            alpha[i] = Math.min(1, (life[i] - age[i]) / 1.2);
            alive++;
        }
        var lum = typeof ambientLight !== "undefined" && ambientLight && typeof sunLight !== "undefined" && sunLight ? (ambientLight.intensity + 0.7 * sunLight.intensity) / (Math.PI * 1.6) : 1;
        material.uniforms.light.value = Math.max(0.08, Math.min(1, lum));
        for (var name in attrs) attrs[name].needsUpdate = true;
        dirty = false;
    }

    api.step = function (delta) {
        delta = Math.min(Math.max(delta || 0, 0), 0.05);
        if (!delta) return;
        stepPieces(delta);
        stepParticles(delta);
    };
    api.clear = function () {
        while (pieces.length) removePiece(pieces.length - 1);
        age.fill(1e9); alpha.fill(0); size.fill(0); lying.fill(0); alive = 0; dirty = true;
        if (made) for (var name in attrs) attrs[name].needsUpdate = true;
    };
    api.count = function () { return { pieces: pieces.length, particles: alive }; };

    // ---- the replay (Replay.js): a row is a piece (row[1] 0) or a cloud of particles (row[1] 1), made again as it was
    api.replayLookback = 12;
    api.replayAdd = function (row) {
        if (row[1] === 0) addPiece(row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13], row[14], row[15], row[16], row[17]);
        else addBurst(row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12], row[13], row[14], row[15]);
    };
    api.replayStep = function (delta, vehicle) { if (vehicle && vehicle.ground) lastGround = vehicle.ground; stepPieces(delta); stepParticles(delta); };
    api.replayClear = function () { api.clear(); };
    var particleState = [pos, col, size, alpha, shape, tilt, vel, age, life, floor, lying];
    api.replaySnapshot = function () {
        return {
            pieces: pieces.map(function (p) { return { key: p.key, index: p.index, p: p.p.clone(), q: p.q.clone(), s: p.s, v: p.v.clone(), w: p.w.clone(), age: p.age, life: p.life, lying: p.lying, settle: p.settle, from: p.from && p.from.clone(), to: p.to && p.to.clone(), landed: p.landed }; }),
            particles: particleState.map(function (a) { return a.slice(); }), next: next
        };
    };
    api.replayRestore = function (snap) {
        while (pieces.length) removePiece(pieces.length - 1);
        snap.pieces.forEach(function (s) {
            addPiece(s.key, s.index, s.p.x, s.p.y, s.p.z, s.q.x, s.q.y, s.q.z, s.q.w, s.s, s.v.x, s.v.y, s.v.z, s.w.x, s.w.y, s.w.z);
            var p = pieces[pieces.length - 1];
            if (!p) return;
            p.age = s.age; p.life = s.life; p.lying = s.lying; p.settle = s.settle; p.from = s.from; p.to = s.to; p.landed = s.landed;
            place(p);
        });
        for (var k = 0; k < particleState.length; k++) particleState[k].set(snap.particles[k]);
        next = snap.next; dirty = true;
    };
    return api;
})();
