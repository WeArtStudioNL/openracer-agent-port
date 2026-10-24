/*
 * DebugView.js
 *
 * Description: A view of what the physics sees, switched on and off with the 0 key (also on the numeric keypad): the triangles of the track near the car (green: road that is
 *              driven on, orange: walls, blue-grey: the rest that the body can hit), the nodes of the collision spheres of the car and the beams of the shell (yellow; a node that is
 *              bent or torn off is red; a broken beam is not drawn; the spheres themselves are not), the point and the normal of the contact of every
 *              wheel (cyan) and, with the tyre model of nodes, the ring of tread nodes of every wheel (green in the patch, red where a node slides, grey out of it).
 *              A motorcycle: the mass of the rider as a block (orange) where the physics has it (the centre of gravity of the bike, moved by the posture: back on the brake, flat on
 *              the gas, to the inside of a bend; the limp rider is where his ragdoll is), with its weight as an arrow (gravity less the acceleration of the bike: it tips forward on
 *              the brake), and the fork: the cylinders that stay (white, from the hub at rest up along the steering axis) and the legs that go with the wheel (orange, up from the hub).
 *              The - key (also on the keypad) hides the model of the car and the driver while the view is on, so only the lines are seen; the view off shows them again.
 *              It is drawn over everything (no depth test), outside the screen space effects, and costs nothing while it is off.
 */

(function () {
    var RADIUS = 14, MAX_TRIANGLES = 5000;
    var on = false, group = null, offsets = [0, 0, 0, 0];
    var tri = [], corners = new Array(9), nodePos = { x: 0, y: 0, z: 0 };
    var q = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

    function layer(kind) {
        var geometry = new THREE.BufferGeometry();
        var material = kind === "points" ? new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true })
            : new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 });
        var object = kind === "points" ? new THREE.Points(geometry, material) : new THREE.LineSegments(geometry, material);
        object.frustumCulled = false;
        object.renderOrder = 1000;
        object.userData.noGBuffer = true;
        group.add(object);
        return { object: object, pos: [], col: [] };
    }
    var lines, points;
    function push(l, x, y, z, c) { l.pos.push(x, y, z); l.col.push(c[0], c[1], c[2]); }
    function seg(l, ax, ay, az, bx, by, bz, c) { push(l, ax, ay, az, c); push(l, bx, by, bz, c); }
    function flush(l) {
        var g = l.object.geometry;
        g.setAttribute("position", new THREE.Float32BufferAttribute(l.pos, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(l.col, 3));
        g.computeBoundingSphere();
        l.pos.length = 0; l.col.length = 0;
    }

    var GREEN = [0.2, 0.9, 0.3], ORANGE = [1, 0.55, 0.1], GREY = [0.45, 0.55, 0.75], RED = [1, 0.2, 0.2], YELLOW = [1, 0.9, 0.2], CYAN = [0.2, 0.9, 1], MAGENTA = [1, 0.3, 1], TEAL = [0.1, 0.8, 0.8], DIM = [0.5, 0.5, 0.5], WHITE = [0.95, 0.95, 0.95];

    function update() {
        if (!on) return;
        requestAnimationFrame(update);
        var player = typeof car !== "undefined" ? car : null, v = player && player.vehicle;
        if (!v || !v.ground) return;
        var ground = v.ground, i, k;
        // the triangles near the car (3D physics only; the road of the 2D physics has no triangles of this kind)
        if (ground.use3D && ground.nearby) {
            ground.nearby(v.px, v.py, v.pz, RADIUS, tri);
            var step = Math.max(1, Math.ceil(tri.length / MAX_TRIANGLES));
            for (i = 0; i < tri.length; i += step) {
                var t = tri[i];
                ground.corners(t, corners);
                ground.normalOf(t, nodePos);
                var c = ground.isDrivable(t) ? GREEN : (Math.abs(nodePos.y) < 0.5 ? ORANGE : GREY);
                seg(lines, corners[0], corners[1], corners[2], corners[3], corners[4], corners[5], c);
                seg(lines, corners[3], corners[4], corners[5], corners[6], corners[7], corners[8], c);
                seg(lines, corners[6], corners[7], corners[8], corners[0], corners[1], corners[2], c);
            }
        }
        // the car: the collision spheres, the nodes and the beams of the shell
        q.set(v.qx, v.qy, v.qz, v.qw);
        var sb = v.softBody;
        var spheres = v.proxy3 || [];
        var worldOf = function (x, y, z, out) { out.set(x, y, z).applyQuaternion(q); out.x += v.px; out.y += v.py; out.z += v.pz; return out; };
        for (i = 0; i < spheres.length; i++) {
            var sp = spheres[i];
            if (sp.disabled) continue;
            var node = sb ? sb.nodeOfSphere[i] : -1, x = sp.x, y = sp.y, z = sp.z, colour = YELLOW;
            if (node >= 0) {
                if (!sb.alive(node)) colour = RED;
                sb.position(node, nodePos); x = nodePos.x; y = nodePos.y; z = nodePos.z;
                var rp = sb.restPosition(node, { x: 0, y: 0, z: 0 });
                if (Math.abs(rp.x - x) + Math.abs(rp.y - y) + Math.abs(rp.z - z) > 0.02) colour = RED;
            }
            worldOf(x, y, z, v1);
            push(points, v1.x, v1.y, v1.z, colour === RED ? RED : YELLOW);
        }
        if (sb && sb.beamA) {
            for (k = 0; k < sb.beamA.length; k++) {
                if (!sb.beamAlive[k]) continue;
                sb.position(sb.beamA[k], nodePos); worldOf(nodePos.x, nodePos.y, nodePos.z, v1);
                sb.position(sb.beamB[k], nodePos); worldOf(nodePos.x, nodePos.y, nodePos.z, v2);
                seg(lines, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, YELLOW);
            }
        }
        // where the body of the car touches the track (the spheres on a triangle): magenta; a wheel that has no contact with the road: a red cross at its hub
        if (!(OpenRacer.Replay && OpenRacer.Replay.active) && v.debugContacts) {
            var cs = v.debugContacts();
            for (k = 0; k < cs.length; k++) { push(points, cs[k].qx, cs[k].qy, cs[k].qz, MAGENTA); seg(lines, cs[k].qx, cs[k].qy, cs[k].qz, cs[k].qx + cs[k].nx * 0.2, cs[k].qy + cs[k].ny * 0.2, cs[k].qz + cs[k].nz * 0.2, MAGENTA); }
            for (i = 0; i < 4; i++) {
                var wc = v.wheels[i];
                if (wc.hasContact) continue;
                var cc = wc.center, sz = 0.12;
                seg(lines, cc.x - sz, cc.y, cc.z, cc.x + sz, cc.y, cc.z, RED); seg(lines, cc.x, cc.y - sz, cc.z, cc.x, cc.y + sz, cc.z, RED); seg(lines, cc.x, cc.y, cc.z - sz, cc.x, cc.y, cc.z + sz, RED);
            }
        }
        // the wheels: the contact (not in a replay: it is not recorded), and the ring of tread nodes. The ring lies in the plane of the wheel as it is drawn (the model of the
        // wheel: turned by the steering, leaning with the camber and the roll of the body), and turns with it; in a replay the turn comes from the recorded spin
        var replaying = !!(OpenRacer.Replay && OpenRacer.Replay.active);
        var forward = v2.set(0, 0, 1).applyQuaternion(q).clone();
        for (i = 0; i < 4; i++) {
            var w = v.wheels[i], nt = w.nodeTyre;
            if (!replaying && w.hasContact && w.normal) {
                var n = w.normal;
                seg(lines, w.contact.x, w.contact.y, w.contact.z, w.contact.x + n.nx * 0.5, w.contact.y + n.ny * 0.5, w.contact.z + n.nz * 0.5, CYAN);
            }
            if (!nt || w.cylActive) continue;
            var node3 = player.wheels && player.wheels[i] && player.wheels[i].object && player.wheels[i].object.children[0] && player.wheels[i].object.children[0].children[0];
            if (!node3) continue;
            node3.updateWorldMatrix(true, false);
            var L = v3.set(1, 0, 0).transformDirection(node3.matrixWorld).clone();
            // the way up in the plane of the wheel (away from the road), and forward in it
            var U = new THREE.Vector3(0, 1, 0).addScaledVector(L, -L.y).normalize();
            var F = new THREE.Vector3().crossVectors(L, U);
            if (F.dot(forward) < 0) F.negate();
            var R = w.radius, cx = w.center.x, cy = w.center.y, cz = w.center.z;
            var d = nt.debug, pitch = 2 * Math.PI / nt.count, ox = 0, oy = 0, oz = 0;
            if (!replaying) offsets[i] = d.phase() - (w.spin || 0);
            var phase = replaying ? (w.spin || 0) + (offsets[i] || 0) : d.phase();
            for (k = 0; k <= nt.count; k++) {
                var idx = k % nt.count, angle = (phase + idx * pitch) % (2 * Math.PI);
                if (angle > Math.PI) angle -= 2 * Math.PI;
                var a = -angle, sn = Math.sin(a) * R, cs = -Math.cos(a) * R;
                var px = cx + F.x * sn + U.x * cs, py = cy + F.y * sn + U.y * cs, pz = cz + F.z * sn + U.z * cs;
                if (k) seg(lines, ox, oy, oz, px, py, pz, DIM);
                ox = px; oy = py; oz = pz;
                if (k < nt.count) {
                    var inPatch = replaying ? Math.abs(angle * R) < nt.patch / 2 : d.touching[idx];
                    push(points, px, py, pz, inPatch ? (!replaying && d.sliding[idx] ? RED : GREEN) : DIM);
                }
            }
        }
        // the tyre body (tyre model "cylinder", TyreBody.js): the nodes and the beams of every wheel, flattened where they touch the track; green where a node holds, red where it slides
        for (i = 0; i < 4; i++) {
            var tbody = v.wheels[i].tyreBody;
            if (!tbody || !v.wheels[i].cylActive) continue;
            var nd = tbody.nodes(), segsN = nd.segments, perRing = segsN * 2;
            for (var r = 0; r < nd.rings; r++) {
                for (k = 0; k < perRing; k += 2) {
                    var i0 = r * perRing + k, i1 = r * perRing + (k + 2) % perRing, mid = i0 + 1;
                    var colour2 = nd.contact[i0] ? (nd.sliding[i0] ? RED : GREEN) : TEAL;
                    push(points, nd.x[i0], nd.y[i0], nd.z[i0], colour2);
                    // the beam along the ring goes through the sample in the middle of it
                    seg(lines, nd.x[i0], nd.y[i0], nd.z[i0], nd.x[mid], nd.y[mid], nd.z[mid], TEAL);
                    seg(lines, nd.x[mid], nd.y[mid], nd.z[mid], nd.x[i1], nd.y[i1], nd.z[i1], TEAL);
                    // the beam across to the next ring
                    if (r + 1 < nd.rings) seg(lines, nd.x[i0], nd.y[i0], nd.z[i0], nd.x[i0 + perRing], nd.y[i0 + perRing], nd.z[i0 + perRing], TEAL);
                    if (nd.contact[mid]) push(points, nd.x[mid], nd.y[mid], nd.z[mid], nd.sliding[mid] ? RED : GREEN);
                }
            }
        }
        // a motorcycle: the rider as a block and his weight, and the fork
        var mc = v.controller;
        if (mc && mc.posture && mc.weight) {
            var p = mc.posture, rl = mc.riderLoad, ctr = new THREE.Vector3();
            if (mc.limp && rl) ctr.set(rl.x, rl.y, rl.z);
            else worldOf(p.lat, p.drop, p.long, ctr);
            var bx = 0.16, by = 0.22, bz = 0.14, ex = v3.set(1, 0, 0).applyQuaternion(q).clone(), ey = new THREE.Vector3(0, 1, 0).applyQuaternion(q), ez = forward;
            var cornerAt = function (sx, sy, sz, out) { return out.copy(ctr).addScaledVector(ex, sx * bx).addScaledVector(ey, sy * by).addScaledVector(ez, sz * bz); };
            var ca = new THREE.Vector3(), cb = new THREE.Vector3(), edges = [[-1,-1,-1, 1,-1,-1], [1,-1,-1, 1,-1,1], [1,-1,1, -1,-1,1], [-1,-1,1, -1,-1,-1], [-1,1,-1, 1,1,-1], [1,1,-1, 1,1,1], [1,1,1, -1,1,1], [-1,1,1, -1,1,-1], [-1,-1,-1, -1,1,-1], [1,-1,-1, 1,1,-1], [1,-1,1, 1,1,1], [-1,-1,1, -1,1,1]];
            for (k = 0; k < edges.length; k++) { var ed = edges[k]; cornerAt(ed[0], ed[1], ed[2], ca); cornerAt(ed[3], ed[4], ed[5], cb); seg(lines, ca.x, ca.y, ca.z, cb.x, cb.y, cb.z, ORANGE); }
            // from the middle of the bike to the block (how far the rider is off it), and the weight: an arrow of 0.5 m at 1 g
            seg(lines, v.px, v.py, v.pz, ctr.x, ctr.y, ctr.z, ORANGE);
            var wgt = mc.weight, scaleW = 0.5 / 9.81;
            seg(lines, ctr.x, ctr.y, ctr.z, ctr.x + wgt.x * scaleW, ctr.y + wgt.y * scaleW, ctr.z + wgt.z * scaleW, RED);
            push(points, ctr.x + wgt.x * scaleW, ctr.y + wgt.y * scaleW, ctr.z + wgt.z * scaleW, RED);
            // the fork: the axis through the steering head (the cylinders, from the hub at rest up), and the legs from the hub as it is now
            var head = player.head, fw = v.wheels[0];
            if (head && head.object && player.body) {
                var hub0 = head.object.getWorldPosition(new THREE.Vector3()), ax = head.axis.clone().applyQuaternion(player.body.quaternion).normalize();
                var lat = new THREE.Vector3().crossVectors(ax, forward).normalize();
                for (k = -1; k <= 1; k += 2) {
                    var o0 = hub0.clone().addScaledVector(lat, k * 0.1);
                    seg(lines, o0.x, o0.y, o0.z, o0.x + ax.x * 0.65, o0.y + ax.y * 0.65, o0.z + ax.z * 0.65, WHITE);
                    var hc = fw.center, o1 = new THREE.Vector3(hc.x, hc.y, hc.z).addScaledVector(lat, k * 0.1);
                    seg(lines, o1.x, o1.y, o1.z, o1.x + ax.x * 0.4, o1.y + ax.y * 0.4, o1.z + ax.z * 0.4, ORANGE);
                }
                seg(lines, hub0.x - lat.x * 0.1, hub0.y - lat.y * 0.1, hub0.z - lat.z * 0.1, hub0.x + lat.x * 0.1, hub0.y + lat.y * 0.1, hub0.z + lat.z * 0.1, WHITE);
            }
        }
        flush(lines); flush(points);
    }

    // the - key: the model of the car (with the driver) and the wheels are hidden while the view is on, so only the lines are seen
    var modelsHidden = false;
    function showModels(show) {
        var player = typeof car !== "undefined" ? car : null;
        if (!player) return;
        if (player.body) player.body.visible = show;
        (player.wheels || []).forEach(function (w) { if (w.object) w.object.visible = show; });
    }
    function toggleModels() { modelsHidden = !modelsHidden; showModels(!modelsHidden); }

    function setOn(value) {
        on = value;
        if (on) {
            if (!group) { group = new THREE.Group(); group.name = "debug view"; lines = layer("lines"); points = layer("points"); }
            if (typeof scene !== "undefined" && scene) scene.add(group);
            requestAnimationFrame(update);
        } else { if (group && group.parent) group.parent.remove(group); if (modelsHidden) { modelsHidden = false; showModels(true); } }
    }
    function toggle() { setOn(!on); }

    window.addEventListener("keydown", function (e) {
        var zero = e.code === "Digit0" || e.code === "Numpad0", minus = e.code === "Minus" || e.code === "NumpadSubtract";
        if (!zero && !minus) return;
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        var tag = e.target && e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
        if (zero) toggle(); else if (on) toggleModels();
    });
    OpenRacer.DebugView = { toggle: toggle, isOn: function () { return on; }, modelsHidden: function () { return on && modelsHidden; } };
})();
