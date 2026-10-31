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
        grabFrame(v);
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
        for (i = 0; i < spheres.length && showShell; i++) {
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
        if (sb && sb.beamA && showShell) {
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
        // the wheels: the contact (not in a replay: it is not recorded)
        var replaying = !!(OpenRacer.Replay && OpenRacer.Replay.active);
        var forward = v2.set(0, 0, 1).applyQuaternion(q).clone();
        for (i = 0; i < 4; i++) {
            var w = v.wheels[i];
            if (!replaying && w.hasContact && w.normal) {
                var n = w.normal;
                seg(lines, w.contact.x, w.contact.y, w.contact.z, w.contact.x + n.nx * 0.5, w.contact.y + n.ny * 0.5, w.contact.z + n.nz * 0.5, CYAN);
            }
        }
        // the tyre (TyreShell.js): the nodes and the beams of every wheel; green where a node holds, red where it slides
        for (i = 0; i < 4; i++) {
            var tbody = v.wheels[i].tyreBody;
            if (!tbody || !v.wheels[i].cylActive) continue;
            // the shell tyre (TyreShell.js): the outer shell as it is (nodes and the belt), the inner shell (the rim), and the beams between them coloured by their strain: dark where they are
            // slack, towards cyan as they are stretched, towards red as they are pushed in
            {
                var sh = tbody.shells();
                for (k = 0; k < sh.beams; k++) {
                    var ba = sh.a[k], bb = sh.b[k], inner = bb >= sh.count, cls = sh.bclass[k];
                    var ex = sh.ox[ba], ey = sh.oy[ba], ez = sh.oz[ba];
                    var fx2 = inner ? sh.ix[bb - sh.count] : sh.ox[bb], fy2 = inner ? sh.iy[bb - sh.count] : sh.oy[bb], fz2 = inner ? sh.iz[bb - sh.count] : sh.oz[bb];
                    var strain = sh.strain[k], tt = Math.max(-1, Math.min(1, strain / 0.12));
                    var colourB = tt >= 0 ? [DIM[0] * (1 - tt) + 0.2 * tt, DIM[1] * (1 - tt) + 0.9 * tt, DIM[2] * (1 - tt) + 1 * tt] : [DIM[0] * (1 + tt) + 1 * -tt, DIM[1] * (1 + tt) + 0.2 * -tt, DIM[2] * (1 + tt) + 0.2 * -tt];
                    if(cls === 0 && (k % 2 === 0 || Math.abs(strain) > 0.02)) seg(lines, ex, ey, ez, fx2, fy2, fz2, colourB);        // (the cables to the rim: every second one when they are at rest)
                    else if(cls === 3 || cls === 4) seg(lines, ex, ey, ez, fx2, fy2, fz2, TEAL);                                       // the belt
                }
                for (k = 0; k < sh.count; k++) {
                    push(points, sh.ox[k], sh.oy[k], sh.oz[k], sh.contact[k] ? (sh.sliding[k] ? RED : GREEN) : TEAL);
                    if(k % 2 === 0) push(points, sh.ix[k], sh.iy[k], sh.iz[k], WHITE);                                                  // the rim
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
            setGrabMode(true);                              // (the node grabber is there with the view: no key for it)
        } else { if (group && group.parent) group.parent.remove(group); if (modelsHidden) { modelsHidden = false; showModels(true); } setGrabMode(false); }
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

    // ---- the node grabber (as BeamNG has it): with the view on, it is on; press on a node of the shell with the left mouse button and drag it, held by an elastic
    // whose strength is set in the panel at the top right (SoftBody.grab: a spring from the node to the pointer, at the depth the node had when it was taken). Let go and
    // it is free again. The elastic is drawn red from the node to the pointer.
    // the nodes and the beams of the shell can be left out of the view (the box in the panel of the node grabber), also while they are grabbed
    var showShell = true;
    try { showShell = localStorage.getItem("openracer.showShell") !== "0"; } catch (e) { /* no storage */ }
    var grabMode = false, grabbed = null, grabPanel = null, grabLine = null, grabStrength = 5000, hitKmh = 50;
    try { var keptHit = parseFloat(localStorage.getItem("openracer.hitSpeed")); if (keptHit >= 5 && keptHit <= 200) hitKmh = keptHit; } catch (e) { /* no storage */ }
    // the hit of the middle mouse button as the panel says it: the speed of the block of a tonne, and what that is as a force over the time of the hit
    function hitText() { return Math.round(hitKmh) + " km/h (" + Math.round(HIT_MASS * (hitKmh / 3.6) / HIT_TIME / 1000) + " kN)"; }
    try { var keptStrength = parseFloat(localStorage.getItem("openracer.grabStrength")); if (keptStrength >= 100 && keptStrength <= 200000) grabStrength = keptStrength; } catch (e) { /* no storage */ }
    var grabPointer = new THREE.Vector2(), grabRay = new THREE.Raycaster(), grabTarget = new THREE.Vector3(), grabNode = new THREE.Vector3(), grabLocal = new THREE.Vector3(), grabQ = new THREE.Quaternion();
    function strengthText(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + " kN/m" : Math.round(n) + " N/m"; }
    function makeGrabPanel() {
        grabPanel = document.createElement("div");
        grabPanel.style.cssText = "position: fixed; right: 16px; top: 14px; z-index: 950; width: 230px; padding: 10px 14px 12px; background: rgba(14, 18, 24, 0.86); border: 1px solid #323c4a; border-radius: 10px; " +
            "color: #dfe6ef; font: 12.5px Arial, sans-serif; display: none;";
        grabPanel.innerHTML = "<div style=\"font-weight: bold; margin-bottom: 6px;\">Node grabber</div>" +
            "<div style=\"color: #9fb0c4; margin-bottom: 8px;\">Press on a node and drag it. Let go to drop it.</div>" +
            "<div style=\"display: flex; justify-content: space-between;\"><span>Elastic</span><b class=\"grabValue\"></b></div>" +
            "<input type=\"range\" class=\"grabSlider\" min=\"2\" max=\"5.3\" step=\"0.01\" style=\"width: 100%;\">" +
            "<div style=\"display: flex; justify-content: space-between; margin-top: 8px;\" title=\"The hit of the middle mouse button: a block of a tonne and a metre at this speed\"><span>Hit (middle mouse)</span><b class=\"hitValue\"></b></div>" +
            "<input type=\"range\" class=\"hitSlider\" min=\"5\" max=\"200\" step=\"5\" style=\"width: 100%;\">" +
            "<label style=\"display: flex; gap: 6px; align-items: center; margin-top: 8px; cursor: pointer;\"><input type=\"checkbox\" class=\"showShell\"> Show the nodes and the beams</label>" +
            "<div style=\"display: flex; gap: 6px; margin-top: 10px;\"><button type=\"button\" data-tool=\"hinge\" title=\"Right click a hinge (a door, the hood) to open it with a small torque, again to close it where it was\">Open hinges</button>" +
            "<button type=\"button\" data-tool=\"break\" title=\"Right click a part to break it loose\">Break parts</button></div>" +
            "<div class=\"grabTool\" style=\"color: #9fb0c4; margin-top: 6px; min-height: 1.2em;\"></div>";
        var slider = grabPanel.querySelector(".grabSlider"), value = grabPanel.querySelector(".grabValue");
        var hitSlider = grabPanel.querySelector(".hitSlider"), hitValue = grabPanel.querySelector(".hitValue");
        hitSlider.value = hitKmh; hitValue.textContent = hitText();
        hitSlider.oninput = function () {
            hitKmh = Math.max(5, Math.min(200, parseFloat(hitSlider.value) || 50));
            hitValue.textContent = hitText();
            try { localStorage.setItem("openracer.hitSpeed", String(hitKmh)); } catch (e) { /* no storage */ }
        };
        slider.value = Math.log10(grabStrength);
        value.textContent = strengthText(grabStrength);
        slider.oninput = function () {
            grabStrength = Math.round(Math.pow(10, parseFloat(slider.value)));
            value.textContent = strengthText(grabStrength);
            try { localStorage.setItem("openracer.grabStrength", String(grabStrength)); } catch (e) { /* no storage */ }
            var v = typeof car !== "undefined" && car ? car.vehicle : null;
            if (grabbed && v && v.softBody) v.softBody.moveGrab(targetOf(v), grabStrength);
        };
        var shellBox = grabPanel.querySelector(".showShell");
        shellBox.checked = showShell;
        shellBox.addEventListener("change", function () { showShell = shellBox.checked; try { localStorage.setItem("openracer.showShell", showShell ? "1" : "0"); } catch (e) { /* no storage */ } });
        grabPanel.querySelectorAll("[data-tool]").forEach(function (b) {
            b.addEventListener("click", function () { partTool = partTool === b.dataset.tool ? null : b.dataset.tool; showTools(); });
        });
        showTools();
        if (OpenRacer.Movable) OpenRacer.Movable.make(grabPanel, { key: "node-grabber", handle: grabPanel.firstElementChild });
        document.body.appendChild(grabPanel);
    }
    // ---- the tools for the parts in the same panel, switched on and off (one at a time): Open hinges, a right click on a hinge opens it with a small torque (Parts.toggleHinge)
    // and another one closes it where it was made; Break parts, a right click on a part breaks it loose (Parts.breakLoose)
    var partTool = null, toolRay = new THREE.Raycaster(), toolPointer = new THREE.Vector2();
    function toolText(text) { var t = grabPanel && grabPanel.querySelector(".grabTool"); if (t) t.textContent = text; }
    function showTools() {
        if (!grabPanel) return;
        grabPanel.querySelectorAll("[data-tool]").forEach(function (b) {
            var lit = partTool === b.dataset.tool;
            b.style.cssText = "flex: 1; padding: 5px 4px; border-radius: 6px; cursor: pointer; font: 12px Arial, sans-serif; color: " + (lit ? "#10151c" : "#dfe6ef") + "; background: " + (lit ? "#f0b83a" : "#232c38") + "; border: 1px solid " + (lit ? "#f0b83a" : "#3a4656") + ";";
        });
        toolText(partTool === "hinge" ? "Right click a hinge to open or close it." : partTool === "break" ? "Right click a part to break it loose." : "");
    }
    function partUnder(e, c) {
        var list = c.parts || (c.vehicle && c.vehicle.parts);
        if (!list || !list.partOf || !c.body) return null;
        var rect = renderer.domElement.getBoundingClientRect();
        toolPointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        toolRay.setFromCamera(toolPointer, camera);
        // the car, and the parts that are out of it (hinged or loose, they hang in the scene)
        var targets = [c.body];
        list.parts.forEach(function (p) { if (p.state !== "held" && p.wheel === undefined && p.object.parent) targets.push(p.object); });
        var hits = toolRay.intersectObjects(targets, true).filter(function (h) { return h.object.isMesh && h.object.visible; });
        // (Open hinges: the first part with a hinge along the ray, so that what lies under a hood or behind a door does not take the click)
        var first = null;
        for (var i = 0; i < hits.length; i++) {
            var p = list.partOf(hits[i].object);
            if (!p) continue;
            if (partTool !== "hinge" || p.hinge) return { list: list, part: p };
            if (!first) first = p;
        }
        return first ? { list: list, part: first } : null;
    }
    window.addEventListener("pointerdown", function (e) {
        if (!grabMode || !on || !partTool || e.button !== 2 || typeof renderer === "undefined" || typeof camera === "undefined" || e.target !== renderer.domElement || (OpenRacer.Replay && OpenRacer.Replay.active)) return;
        var c = typeof car !== "undefined" ? car : null;
        if (!c) return;
        e.preventDefault();
        var hit = partUnder(e, c);
        if (!hit) { toolText("No part there."); return; }
        var p = hit.part;
        if (partTool === "hinge") {
            var done = hit.list.toggleHinge(p);
            toolText(done ? p.name + ": " + done : p.name + (p.hinge ? " cannot be opened now (" + p.state + ")." : " has no hinge."));
        } else toolText(hit.list.breakLoose(p) ? p.name + ": broken loose" : p.name + " is loose already.");
    });
    window.addEventListener("contextmenu", function (e) { if (grabMode && on && partTool && typeof renderer !== "undefined" && e.target === renderer.domElement) e.preventDefault(); });
    function setGrabMode(value) {
        grabMode = value;
        if (value && !grabPanel) makeGrabPanel();
        if (grabPanel) grabPanel.style.display = value ? "block" : "none";
        if (!value) dropNode();
    }
    function pointerAt(e) {
        var rect = renderer.domElement.getBoundingClientRect();
        grabPointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    }
    // the node nearest to the pointer on the screen (within 30 px): its number and its distance from the camera
    function nodeUnder(e, v, sb) {
        var rect = renderer.domElement.getBoundingClientRect(), best = null, bestD = 30;
        grabQ.set(v.qx, v.qy, v.qz, v.qw);
        for (var k = 0; k < sb.count; k++) {
            if (!sb.alive(k)) continue;
            sb.position(k, nodePos);
            grabNode.set(nodePos.x, nodePos.y, nodePos.z).applyQuaternion(grabQ); grabNode.x += v.px; grabNode.y += v.py; grabNode.z += v.pz;
            var depth = grabNode.distanceTo(camera.position);
            grabLocal.copy(grabNode).project(camera);
            if (grabLocal.z > 1) continue;
            var sx = rect.left + (grabLocal.x + 1) / 2 * rect.width, sy = rect.top + (1 - grabLocal.y) / 2 * rect.height;
            var d = Math.hypot(sx - e.clientX, sy - e.clientY);
            if (d < bestD) { bestD = d; best = { node: k, depth: depth }; }
        }
        return best;
    }
    // the point under the pointer at the depth of the node, in the frame of the car
    function targetOf(v) {
        grabRay.setFromCamera(grabPointer, camera);
        grabTarget.copy(grabRay.ray.origin).addScaledVector(grabRay.ray.direction, grabbed.depth);
        grabQ.set(v.qx, v.qy, v.qz, v.qw).invert();
        grabLocal.copy(grabTarget).sub(v2.set(v.px, v.py, v.pz)).applyQuaternion(grabQ);
        return [grabLocal.x, grabLocal.y, grabLocal.z];
    }
    function dropNode() {
        var v = typeof car !== "undefined" && car ? car.vehicle : null;
        if (grabbed && v && v.softBody) v.softBody.release();
        grabbed = null;
        if (grabLine && grabLine.parent) grabLine.parent.remove(grabLine);
    }
    // every frame: the elastic goes where the pointer is (the car moves under it), and its line is drawn
    function grabFrame(v) {
        if (!grabbed || !v.softBody || !v.softBody.pull) { if (grabbed) dropNode(); return; }
        var sb = v.softBody;
        sb.moveGrab(targetOf(v), grabStrength);
        sb.position(grabbed.node, nodePos);
        grabQ.set(v.qx, v.qy, v.qz, v.qw);
        grabNode.set(nodePos.x, nodePos.y, nodePos.z).applyQuaternion(grabQ); grabNode.x += v.px; grabNode.y += v.py; grabNode.z += v.pz;
        if (!grabLine) {
            grabLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xff4040, depthTest: false, transparent: true }));
            grabLine.frustumCulled = false; grabLine.renderOrder = 1002; grabLine.userData.noGBuffer = true;
        }
        if (!grabLine.parent && typeof scene !== "undefined" && scene) scene.add(grabLine);
        var pos = grabLine.geometry.attributes.position;
        pos.setXYZ(0, grabNode.x, grabNode.y, grabNode.z); pos.setXYZ(1, grabTarget.x, grabTarget.y, grabTarget.z); pos.needsUpdate = true;
    }
    window.addEventListener("pointerdown", function (e) {
        if (!grabMode || !on || e.button !== 0 || typeof renderer === "undefined" || e.target !== renderer.domElement || (OpenRacer.Replay && OpenRacer.Replay.active)) return;
        var v = typeof car !== "undefined" && car ? car.vehicle : null, sb = v && v.softBody;
        if (!sb || typeof camera === "undefined") return;
        var hit = nodeUnder(e, v, sb);
        if (!hit) return;
        e.preventDefault();
        pointerAt(e);
        grabbed = hit;
        sb.grab(hit.node, targetOf(v), grabStrength);
        try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic event */ }
    });
    window.addEventListener("pointermove", function (e) {
        if (!grabbed) return;
        pointerAt(e);
        var v = typeof car !== "undefined" && car ? car.vehicle : null;
        if (v) grabFrame(v);                   // (the elastic follows the pointer at once, not only at the next picture)
    });
    window.addEventListener("pointerup", function (e) { if (grabbed && e.button === 0) dropNode(); });
    // A hit on the car with the middle mouse button while the view is on, as Apply force of the car editor does it: a cube of a tonne and a metre at 50 km/h against the
    // surface of the car where it is clicked (SoftBody.pushPlate, in the frame of the car). The car is not clamped here: it feels the hit too. A red arrow shows it for a moment.
    // (the speed is set in the panel of the node grabber, 5 to 200 km/h; 50 when it was not)
    var HIT_MASS = 1000, HIT_SIDE = 1, HIT_TIME = 0.03;
    var raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), hitArrow = null, hitTimer = 0;
    function hitCar(e) {
        var c = typeof car !== "undefined" ? car : null, v = c && c.vehicle, sb = v && v.softBody;
        if (!on || !sb || !c.body || typeof camera === "undefined" || typeof renderer === "undefined" || (OpenRacer.Replay && OpenRacer.Replay.active)) return false;
        var rect = renderer.domElement.getBoundingClientRect();
        pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        var hits = raycaster.intersectObject(c.body, true).filter(function (h) { return h.object.isMesh && h.object.visible && h.face; });
        if (!hits.length) return false;
        var h = hits[0], normal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (normal.dot(raycaster.ray.direction) > 0) normal.negate();          // (the side that faces the camera)
        q.set(v.qx, v.qy, v.qz, v.qw).invert();
        var local = v1.copy(h.point).sub(v2.set(v.px, v.py, v.pz)).applyQuaternion(q), n = v3.copy(normal).applyQuaternion(q);
        sb.pushPlate([local.x, local.y, local.z], [n.x, n.y, n.z], HIT_MASS * (hitKmh / 3.6) / HIT_TIME, HIT_SIDE, HIT_MASS, HIT_TIME, null);
        sb.pinned = false;                     // (the reaction of the shell goes to the car: it is pushed and turned by the hit)
        var plate = sb.plate;
        setTimeout(function () { if (sb.plate === plate) sb.releasePlate(); }, 1500);
        if (typeof scene !== "undefined" && scene) {
            if (hitArrow && hitArrow.parent) hitArrow.parent.remove(hitArrow);
            hitArrow = new THREE.ArrowHelper(normal.clone().negate(), h.point.clone().addScaledVector(normal, 0.8), 0.8, 0xff5555, 0.3, 0.18);
            hitArrow.traverse(function (o) { if (o.material) { o.material.depthTest = false; o.renderOrder = 1001; } });
            scene.add(hitArrow);
            clearTimeout(hitTimer);
            hitTimer = setTimeout(function () { if (hitArrow && hitArrow.parent) hitArrow.parent.remove(hitArrow); hitArrow = null; }, 1000);
        }
        return true;
    }
    window.addEventListener("pointerdown", function (e) {
        if (e.button !== 1 || !on || typeof renderer === "undefined" || e.target !== renderer.domElement) return;
        if (hitCar(e)) e.preventDefault();
    });
    window.addEventListener("auxclick", function (e) { if (on && e.button === 1 && typeof renderer !== "undefined" && e.target === renderer.domElement) e.preventDefault(); });

    OpenRacer.DebugView = { partToolOn: function () { return grabMode && !!partTool; }, toggle: toggle, isOn: function () { return on; }, modelsHidden: function () { return on && modelsHidden; }, hitCar: hitCar, setGrabMode: setGrabMode, grabbing: function () { return grabbed; } };
})();
