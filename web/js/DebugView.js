/*
 * DebugView.js
 *
 * Description: A view of what the physics sees, switched on and off with the 0 key (also on the numeric keypad): the triangles of the track near the car (green: road that is
 *              driven on, orange: walls, blue-grey: the rest that the body can hit), the nodes of the collision spheres of the car and the beams of the shell (yellow; a node that is
 *              bent or torn off is red; a broken beam is not drawn; the spheres themselves are not), the point and the normal of the contact of every
 *              wheel (cyan) and, with the tyre model of nodes, the ring of tread nodes of every wheel (green in the patch, red where a node slides, grey out of it).
 *              It is drawn over everything (no depth test), outside the screen space effects, and costs nothing while it is off.
 */

(function () {
    var RADIUS = 14, MAX_TRIANGLES = 5000;
    var on = false, group = null, frame = 0;
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

    var GREEN = [0.2, 0.9, 0.3], ORANGE = [1, 0.55, 0.1], GREY = [0.45, 0.55, 0.75], RED = [1, 0.2, 0.2], YELLOW = [1, 0.9, 0.2], CYAN = [0.2, 0.9, 1], DIM = [0.5, 0.5, 0.5];

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
        // the wheels: the contact, and the ring of tread nodes
        var forward = v2.set(0, 0, 1).applyQuaternion(q).clone();
        for (i = 0; i < 4; i++) {
            var w = v.wheels[i];
            if (!w || !w.hasContact || !w.normal) continue;
            var n = w.normal;
            seg(lines, w.contact.x, w.contact.y, w.contact.z, w.contact.x + n.nx * 0.5, w.contact.y + n.ny * 0.5, w.contact.z + n.nz * 0.5, CYAN);
            var nt = w.nodeTyre;
            if (!nt || v.tyreModel !== "nodes") continue;
            // the forward direction along the road, and the centre of the wheel above the contact
            var fx = forward.x - n.nx * (forward.x * n.nx + forward.y * n.ny + forward.z * n.nz), fy = forward.y - n.ny * (forward.x * n.nx + forward.y * n.ny + forward.z * n.nz), fz = forward.z - n.nz * (forward.x * n.nx + forward.y * n.ny + forward.z * n.nz);
            var fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1; fx /= fl; fy /= fl; fz /= fl;
            var R = w.radius, cx = w.contact.x + n.nx * R, cy = w.contact.y + n.ny * R, cz = w.contact.z + n.nz * R;
            var d = nt.debug, phase = d.phase(), pitch = 2 * Math.PI / nt.count, ox = 0, oy = 0, oz = 0;
            for (k = 0; k <= nt.count; k++) {
                var idx = k % nt.count, a = (phase + idx * pitch) % (2 * Math.PI);
                var sn = Math.sin(a) * R, cs = -Math.cos(a) * R;
                var px = cx + fx * sn + n.nx * cs, py = cy + fy * sn + n.ny * cs, pz = cz + fz * sn + n.nz * cs;
                if (k) seg(lines, ox, oy, oz, px, py, pz, DIM);
                ox = px; oy = py; oz = pz;
                if (k < nt.count) push(points, px, py, pz, d.touching[idx] ? (d.sliding[idx] ? RED : GREEN) : DIM);
            }
        }
        flush(lines); flush(points);
    }

    function setOn(value) {
        on = value;
        if (on) {
            if (!group) { group = new THREE.Group(); group.name = "debug view"; lines = layer("lines"); points = layer("points"); }
            if (typeof scene !== "undefined" && scene) scene.add(group);
            requestAnimationFrame(update);
        } else if (group && group.parent) group.parent.remove(group);
    }
    function toggle() { setOn(!on); }

    window.addEventListener("keydown", function (e) {
        if (e.code !== "Digit0" && e.code !== "Numpad0") return;
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        var tag = e.target && e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
        toggle();
    });
    OpenRacer.DebugView = { toggle: toggle, isOn: function () { return on; } };
})();
