/*
 * Leaks.js
 *
 * Description: What a leaking engine leaves behind (EngineDamage.js, vehicle.engineHealth): drops of oil (dark) from the pan and of coolant (the spray of a hurt radiator: the
 *              particles of a puddle that a wheel throws up, Debris.js, but thicker, green and see-through; this file only finds where they land)
 *              that fall on the road, and the stains where they land: black blots of oil that stay, darker wet patches of coolant that dry in a minute. A car that drives on
 *              drips a line of blots behind it; one that stands still makes a puddle. The stains are flat quads on the road, in one mesh, a ring of the last 3000, as the marks
 *              of the tyres (SkidMarks.js) are; the drops are points that fall with gravity and land on the road under them.
 *
 *              var leaks = new OpenRacer.Leaks(scene);
 *              leaks.update(delta, vehicle, camera, ground)   every frame (not in a replay): makes drops from the flow that engineHealth says, moves them, makes stains
 *              leaks.clear()                                  a new place: the drops go (the stains stay, they are on the road)
 */

OpenRacer.Leaks = function (scene) {
    var self = this;
    var DROPS = 500, STAINS = 3000;
    var OIL = 0, COOLANT = 1;

    // ---- the drops: points with a size and a colour of their own
    var pos = new Float32Array(DROPS * 3), vel = new Float32Array(DROPS * 3), size = new Float32Array(DROPS), color = new Float32Array(DROPS * 4), age = new Float32Array(DROPS), kind = new Uint8Array(DROPS), alive = new Uint8Array(DROPS);
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(size, 1));
    geometry.setAttribute("color", new THREE.BufferAttribute(color, 4));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    var uniforms = { scale: { value: 700 } };
    var material = new THREE.ShaderMaterial({
        uniforms: uniforms, transparent: true, depthWrite: false,
        vertexShader: "attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;\n" +
            "void main() { vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.5, size * scale / max(0.1, -mv.z)); gl_Position = projectionMatrix * mv; }",
        fragmentShader: "varying vec4 vColor;\n" +
            "void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vColor.rgb, vColor.a * smoothstep(0.5, 0.15, d)); }"
    });
    var points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 3;
    points.userData.noGBuffer = true;
    scene.add(points);
    var nextDrop = 0, liveDrops = 0;

    // ---- the stains: quads on the road with a soft irregular blot (a canvas of four blots, one chosen for every stain)
    var blotTexture = (function () {
        var c = document.createElement("canvas"); c.width = c.height = 256;
        var g = c.getContext("2d");
        for (var cell = 0; cell < 4; cell++) {
            var ox = (cell % 2) * 128 + 64, oy = Math.floor(cell / 2) * 128 + 64;
            for (var k = 0; k < 14; k++) {
                var a = Math.random() * 6.283, d = Math.random() * 20, r = 10 + Math.random() * 26;
                var x = ox + Math.cos(a) * d, y = oy + Math.sin(a) * d, grad = g.createRadialGradient(x, y, 0, x, y, r);
                grad.addColorStop(0, "rgba(255,255,255,0.9)"); grad.addColorStop(0.6, "rgba(255,255,255,0.55)"); grad.addColorStop(1, "rgba(255,255,255,0)");
                g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
            }
        }
        var t = new THREE.CanvasTexture(c);
        return t;
    })();
    var sPos = new Float32Array(STAINS * 4 * 3), sCol = new Float32Array(STAINS * 4 * 4), sUv = new Float32Array(STAINS * 4 * 2), sIdx = new Uint32Array(STAINS * 6);
    var born = new Float32Array(STAINS), peakAlpha = new Float32Array(STAINS), sKind = new Uint8Array(STAINS);
    for (var s = 0; s < STAINS; s++) { var b = s * 4, i = s * 6; sIdx[i] = b; sIdx[i + 1] = b + 2; sIdx[i + 2] = b + 1; sIdx[i + 3] = b + 1; sIdx[i + 4] = b + 2; sIdx[i + 5] = b + 3; }
    var sGeometry = new THREE.BufferGeometry();
    sGeometry.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
    sGeometry.setAttribute("color", new THREE.BufferAttribute(sCol, 4));
    sGeometry.setAttribute("uv", new THREE.BufferAttribute(sUv, 2));
    sGeometry.setIndex(new THREE.BufferAttribute(sIdx, 1));
    sGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    var sMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, map: blotTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    var stains = new THREE.Mesh(sGeometry, sMaterial);
    stains.frustumCulled = false;
    stains.renderOrder = 1;
    stains.userData.noGBuffer = true;
    scene.add(stains);
    var nextStain = 0, usedStains = 0, clock = 0, dryTimer = 0;
    var DRY_TIME = 70;           // s: a coolant stain is gone after this

    function stain(x, y, z, nx, ny, nz, radius, k, alpha) {
        var i = nextStain; nextStain = (nextStain + 1) % STAINS; usedStains = Math.min(STAINS, usedStains + 1);
        // two directions in the plane of the road
        var tx = Math.abs(ny) < 0.9 ? 0 : 1, ty = Math.abs(ny) < 0.9 ? 1 : 0;
        var e1x = ny * 0 - nz * ty, e1y = nz * tx - nx * 0, e1z = nx * ty - ny * tx;
        var l = Math.hypot(e1x, e1y, e1z) || 1; e1x /= l; e1y /= l; e1z /= l;
        var e2x = ny * e1z - nz * e1y, e2y = nz * e1x - nx * e1z, e2z = nx * e1y - ny * e1x;
        var rot = Math.random() * 6.283, c = Math.cos(rot), sn = Math.sin(rot);
        var ax = (e1x * c + e2x * sn) * radius, ay = (e1y * c + e2y * sn) * radius, az = (e1z * c + e2z * sn) * radius;
        var bx = (-e1x * sn + e2x * c) * radius, by = (-e1y * sn + e2y * c) * radius, bz = (-e1z * sn + e2z * c) * radius;
        var lift = 0.014 + (i % 7) * 0.0006;           // (a little different for every stain: two over each other do not fight)
        var px = x + nx * lift, py = y + ny * lift, pz = z + nz * lift;
        var corner = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        var cell = (Math.random() * 4) | 0, u0 = (cell % 2) * 0.5, v0 = Math.floor(cell / 2) * 0.5;
        var r = k === OIL ? 0.025 : 0.06, g = k === OIL ? 0.02 : 0.085, bl = k === OIL ? 0.018 : 0.07;
        for (var q = 0; q < 4; q++) {
            var o = (i * 4 + q);
            sPos[o * 3] = px + ax * corner[q][0] + bx * corner[q][1]; sPos[o * 3 + 1] = py + ay * corner[q][0] + by * corner[q][1]; sPos[o * 3 + 2] = pz + az * corner[q][0] + bz * corner[q][1];
            sCol[o * 4] = r; sCol[o * 4 + 1] = g; sCol[o * 4 + 2] = bl; sCol[o * 4 + 3] = alpha;
            sUv[o * 2] = u0 + (corner[q][0] > 0 ? 0.5 : 0); sUv[o * 2 + 1] = v0 + (corner[q][1] > 0 ? 0.5 : 0);
        }
        born[i] = clock; peakAlpha[i] = alpha; sKind[i] = k;
        sGeometry.attributes.position.needsUpdate = true; sGeometry.attributes.color.needsUpdate = true; sGeometry.attributes.uv.needsUpdate = true;
    }
    // coolant dries: its stains fade (looked at a few times a second)
    function dry() {
        var changed = false;
        for (var i = 0; i < usedStains; i++) {
            if (sKind[i] !== COOLANT || peakAlpha[i] <= 0) continue;
            var left = 1 - (clock - born[i]) / DRY_TIME, a = left > 0 ? peakAlpha[i] * left : 0;
            if (left <= 0) peakAlpha[i] = 0;
            for (var q = 0; q < 4; q++) sCol[(i * 4 + q) * 4 + 3] = a;
            changed = true;
        }
        if (changed) sGeometry.attributes.color.needsUpdate = true;
    }

    // ---- making drops
    function drop(x, y, z, vx, vy, vz, k, big) {
        var i = nextDrop; nextDrop = (nextDrop + 1) % DROPS;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        size[i] = (big ? 0.07 : 0.035) + Math.random() * 0.035;
        age[i] = 0; kind[i] = k; alive[i] = 1;
        if (k === OIL) { color[i * 4] = 0.06; color[i * 4 + 1] = 0.045; color[i * 4 + 2] = 0.03; color[i * 4 + 3] = 0.95; }
        else { color[i * 4] = 0.45; color[i * 4 + 1] = 0.85; color[i * 4 + 2] = 0.5; color[i * 4 + 3] = 0; }       // (the coolant is drawn by Debris.js: this one only finds the road for its stain)
    }

    var q = new THREE.Quaternion(), p = new THREE.Vector3();
    var oilLeft = 0, dripLeft = 0, jetLeft = [0, 0, 0, 0, 0];
    // a number from 0 to 1 that is the same for the same seed, jet and use (the directions of the jets: the physics may run in a worker, so the main thread makes them from the seed)
    function hash(seed, j, k) { var x = Math.sin(seed * 1000 + j * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); }
    // one drop of coolant at p (the frame of the car, rotated) from the car, with the speed out (m/s, in the world, on top of the speed of the car): the drop that makes the stain, and the one that is seen
    function coolantDrop(v, p, out, kindSeen, carry, ground, debris) {
        var cx = v.px + p.x, cy = v.py + p.y, cz = v.pz + p.z, cvx = v.vx * 0.9 * carry + out.x, cvy = v.vy * carry + out.y, cvz = v.vz * 0.9 * carry + out.z;
        drop(cx, cy, cz, cvx, cvy, cvz, COOLANT, false);          // (this one makes the stain where it lands; it is not drawn)
        if (debris && debris.emit) {                              // (what is seen: the spray of a puddle, pale green and see-through, Debris.js)
            var road = ground ? ground.query(cx, cz, cy + 0.4, 1.5) : null;
            debris.emit(cx, cy, cz, cvx, cvy, cvz, kindSeen, road ? road.y + 0.015 : v.py - 0.4);
        }
    }
    this.update = function (delta, v, camera, ground, debris) {
        delta = Math.min(delta || 0.016, 0.1);
        clock += delta;
        var eh = v && v.engineHealth;
        // the camera: the size of a point on the screen
        if (camera && typeof renderer !== "undefined" && renderer) uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
        // new drops, from where the pan and the radiator are
        if (eh && eh.leaking) {
            q.set(v.qx, v.qy, v.qz, v.qw);
            var speed = Math.hypot(v.vx, v.vz);
            if (eh.oilFlow > 0.001) {
                oilLeft += delta * (3 + 24 * Math.min(1, eh.oilFlow));
                while (oilLeft >= 1) {
                    oilLeft -= 1;
                    p.set(eh.bx + (Math.random() - 0.5) * 0.4, eh.by - 0.35, eh.bz + (Math.random() - 0.5) * 0.4).applyQuaternion(q);
                    drop(v.px + p.x, v.py + p.y, v.pz + p.z, v.vx * 0.95 + (Math.random() - 0.5) * 0.3, v.vy - 0.3, v.vz * 0.95 + (Math.random() - 0.5) * 0.3, OIL, eh.oilFlow > 0.6);
                }
            }
            // a radiator that is torn open or off: 1 to 5 jets, each in a direction of its own (the same for as long as it runs: the seed is in engineHealth), every one makes its own drops
            if (eh.jets > 0 && eh.coolant > 0.005) {
                var pressure = 0.35 + 0.65 * Math.min(1, eh.coolant * 2);        // (the jets weaken as the system empties)
                for (var j = 0; j < eh.jets && j < 5; j++) {
                    jetLeft[j] += delta * 38 * pressure;
                    if (jetLeft[j] > 14) jetLeft[j] = 14;
                    var az = hash(eh.jetSeed, j, 1) * 6.2832, el = -0.15 + hash(eh.jetSeed, j, 2) * 1.05, speed = 1.6 + hash(eh.jetSeed, j, 3) * 2.2;
                    while (jetLeft[j] >= 1) {
                        jetLeft[j] -= 1;
                        p.set(eh.rx + (Math.random() - 0.5) * 0.3, eh.ry - 0.05, eh.rz + (Math.random() - 0.5) * 0.15).applyQuaternion(q);
                        var wob = 0.28;                                             // (a jet is not a laser: a little wide)
                        var out = new THREE.Vector3(Math.cos(az + (Math.random() - 0.5) * wob) * Math.cos(el), Math.sin(el + (Math.random() - 0.5) * wob), Math.sin(az + (Math.random() - 0.5) * wob) * Math.cos(el))
                            .multiplyScalar(speed * pressure * (0.8 + Math.random() * 0.4)).applyQuaternion(q);       // (a direction in the frame of the car, x to the left, z forward)
                        coolantDrop(v, p, out, Math.random() < 0.6 ? "coolant" : "coolantDrop", 1, ground, debris);
                    }
                }
            } else if (eh.coolFlow > 0.001) {
                // a bent radiator: no jet, the coolant runs down from the bottom of it (drops that fall where they are)
                dripLeft += delta * (1.5 + 14 * Math.min(1, eh.coolFlow));
                while (dripLeft >= 1) {
                    dripLeft -= 1;
                    p.set(eh.rx + (Math.random() - 0.5) * 0.5, eh.ry - 0.15, eh.rz + (Math.random() - 0.5) * 0.12).applyQuaternion(q);
                    var out2 = new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.1 - Math.random() * 0.3, (Math.random() - 0.5) * 0.3).applyQuaternion(q);
                    coolantDrop(v, p, out2, "coolantDrop", 0.8, ground, debris);
                }
            }
        }
        // the drops fall and land
        var any = false;
        for (var i = 0; i < DROPS; i++) {
            if (!alive[i]) continue;
            age[i] += delta;
            var dragK = Math.exp(-0.7 * delta);          // (as Debris.js, so that the stain is where the drop that is seen comes down)
            vel[i * 3] *= dragK; vel[i * 3 + 2] *= dragK; vel[i * 3 + 1] = vel[i * 3 + 1] * dragK - 9.81 * delta;
            pos[i * 3] += vel[i * 3] * delta; pos[i * 3 + 1] += vel[i * 3 + 1] * delta; pos[i * 3 + 2] += vel[i * 3 + 2] * delta;
            var road = ground ? ground.query(pos[i * 3], pos[i * 3 + 2], pos[i * 3 + 1] + 0.4, 0.6) : { y: -1e9, nx: 0, ny: 1, nz: 0 };
            if (age[i] > 4 || (road && pos[i * 3 + 1] <= road.y + 0.015)) {
                alive[i] = 0; color[i * 4 + 3] = 0;
                if (road && age[i] <= 4) {
                    var loose = road.surface === "grass" || road.surface === "ground" || road.surface === "gravel" || road.surface === "sand" || road.surface === "mud";
                    if (kind[i] === OIL) { if (Math.random() < (loose ? 0.4 : 0.8)) stain(pos[i * 3], road.y, pos[i * 3 + 2], road.nx, road.ny, road.nz, 0.07 + Math.random() * 0.16 * (size[i] > 0.06 ? 1.5 : 1), OIL, loose ? 0.3 : 0.6); }
                    else if (Math.random() < 0.3) stain(pos[i * 3], road.y, pos[i * 3 + 2], road.nx, road.ny, road.nz, 0.06 + Math.random() * 0.14, COOLANT, loose ? 0.15 : 0.32);
                }
            } else any = true;
        }
        liveDrops = any ? 1 : 0;
        geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true; geometry.attributes.size.needsUpdate = true;
        points.visible = any;
        dryTimer += delta;
        if (dryTimer > 0.5) { dryTimer = 0; dry(); }
    };
    this.clear = function () { alive.fill(0); color.fill(0); points.visible = false; };
};
