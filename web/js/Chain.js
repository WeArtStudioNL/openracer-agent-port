/*
 * Chain.js
 *
 * Description: The drive chain of a motorcycle (or a kart), drawn from one link of the model: the model has a part `chain_link` (one link, its long side
 *              along the chain), `front_sprocket` (on the engine, part of the body) and `rear_sprocket` (on the rear wheel: CarLoader.js hangs it on the spin
 *              of the wheel, so it turns with the wheel and goes up and down with the swingarm). The link is taken out of the model and drawn as many times
 *              as the chain is long (an InstancedMesh), every frame along the path round the two sprockets: the two straight strands between them and the
 *              arcs round each sprocket, in the plane of the sprockets. The radii come from the sprockets, the pitch from the link. The chain moves with the
 *              rear wheel (the rim of the rear sprocket) and turns the front sprocket with it. The number of links is fixed once; the little change of the
 *              length as the swingarm moves is spread over the links.
 *              Purely a picture: the drive goes through the drivetrain of the physics.
 * Author:      Glenn Hofman
 * Date:        2026-10-25
 * License:     MIT
 */

OpenRacer.Chain = (function () {
    var V = THREE.Vector3, box = new THREE.Box3();

    function nameOf(o) { return (o.name || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
    function findPart(root, names) {
        var found = null;
        root.traverse(function (child) { if(!found && names.indexOf(nameOf(child)) >= 0) found = child; });
        return found;
    }
    function firstMesh(o) { var m = null; o.traverse(function (c) { if(!m && c.isMesh) m = c; }); return m; }

    // The chain of a model: called by CarLoader.js when the body (tilt) and the wheels are built; space is the frame of the model (the objects are put in it to measure)
    function find(root, space, tilt, wheelObjects) {
        var link = findPart(tilt, ["chainlink", "chain"]), front = findPart(tilt, ["frontsprocket", "sprocketfront", "sprocketf"]);
        var rearWheel = wheelObjects[2] || wheelObjects[0], rear = rearWheel ? findPart(rearWheel, ["rearsprocket", "sprocketrear", "sprocketr", "sprocketrl", "sprocketrr"]) : null;
        if(!link || !front || !rear) return null;
        var mesh = firstMesh(link);
        if(!mesh) return null;
        var added = [];
        [tilt, rearWheel].forEach(function (o) { if(o && o.parent !== space) { space.add(o); added.push(o); } });
        space.updateMatrixWorld(true);
        // the sizes: in the plane of the chain (y and z of the model; x is the axle), the radius of a sprocket is half its height, the pitch of the chain the length of the link
        box.setFromObject(front); var fc = box.getCenter(new V()), fs = box.getSize(new V());
        box.setFromObject(rear); var rc = box.getCenter(new V()), rs = box.getSize(new V());
        box.setFromObject(link); var lc = box.getCenter(new V()), ls = box.getSize(new V());
        var rFront = Math.max(fs.y, fs.z) / 2, rRear = Math.max(rs.y, rs.z) / 2, pitch = Math.max(ls.y, ls.z);
        var alongZ = ls.z >= ls.y;
        // the link as an instance: its geometry and material, and its own transform in the model with its middle at the origin (the instances are placed by their middle)
        mesh.updateWorldMatrix(true, false);
        var linkMatrix = mesh.matrixWorld.clone().premultiply(new THREE.Matrix4().makeTranslation(-lc.x, -lc.y, -lc.z));
        // the front sprocket: where it turns about, in the frame of its parent
        var frontCentre = front.parent.worldToLocal(fc.clone());
        var frontRest = front.matrix.clone();
        added.forEach(function (o) { space.remove(o); });
        // the link comes out of the body
        if(link.parent) link.parent.remove(link);
        var count = 0, instanced = null;
        var chain = {
            link: mesh, linkMatrix: linkMatrix, pitch: pitch, alongZ: alongZ,
            front: front, frontRest: frontRest, frontCentre: frontCentre, rFront: rFront,
            rear: rear, rRear: rRear, tilt: tilt,
            count: count, mesh: instanced, s: 0, spinPrev: null, length: 0, x: (fc.x + rc.x) / 2
        };
        console.log("Chain: sprockets of " + (2 * rFront * 1000).toFixed(0) + " and " + (2 * rRear * 1000).toFixed(0) + " mm, a pitch of " + (pitch * 1000).toFixed(1) + " mm");
        return chain;
    }

    // ---- the path round the two sprockets, in the plane (z along the bike, y up), in the frame of the body
    var c1 = new THREE.Vector2(), c2 = new THREE.Vector2(), u = new THREE.Vector2(), nTop = new THREE.Vector2(), nBot = new THREE.Vector2();
    var tmp = new V(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), mr = new THREE.Matrix4(), mt = new THREE.Matrix4();
    // the pieces of the path: straight strands and arcs; a point at a distance s along it gives a place and a direction
    var pieces = [];
    function piece(kind, ax, ay, bx, by, cx, cy, r, a0, sweep) {
        var len = kind === 0 ? Math.hypot(bx - ax, by - ay) : Math.abs(sweep) * r;
        return { kind: kind, ax: ax, ay: ay, bx: bx, by: by, cx: cx, cy: cy, r: r, a0: a0, sweep: sweep, len: len };
    }
    function at(p, t, out) {
        // out: { z, y, dz, dy } (the plane: first coordinate along the bike, second up)
        if(p.kind === 0) { var f = t / p.len; out.z = p.ax + (p.bx - p.ax) * f; out.y = p.ay + (p.by - p.ay) * f; out.dz = (p.bx - p.ax) / p.len; out.dy = (p.by - p.ay) / p.len; }
        else { var a = p.a0 + p.sweep * (t / p.len), s = p.sweep >= 0 ? 1 : -1; out.z = p.cx + p.r * Math.cos(a); out.y = p.cy + p.r * Math.sin(a); out.dz = -Math.sin(a) * s; out.dy = Math.cos(a) * s; }
    }
    // the sweep from angle a to angle b that passes through the angle "through"
    function sweepThrough(a, b, through) {
        var ccw = (b - a) % (2 * Math.PI); if(ccw < 0) ccw += 2 * Math.PI;
        var toT = (through - a) % (2 * Math.PI); if(toT < 0) toT += 2 * Math.PI;
        return toT <= ccw ? ccw : ccw - 2 * Math.PI;
    }
    var pt = { z: 0, y: 0, dz: 0, dy: 0 };

    // once a frame: the spin of the rear wheel (rad, as the wheel of the model turns, Car.js) moves the chain
    function update(chain, spinRear) {
        if(!chain) return;
        var tilt = chain.tilt, rear = chain.rear, front = chain.front;
        rear.updateWorldMatrix(true, false);
        tilt.updateWorldMatrix(true, false);
        // the middle of the rear sprocket in the frame of the body (it goes up and down with the swingarm)
        box.makeEmpty(); box.expandByObject(rear);          // (world)
        box.getCenter(tmp); tilt.worldToLocal(tmp);
        c2.set(tmp.z, tmp.y);
        var fc = chain.frontCentre;
        tmp.copy(fc); if(front.parent !== tilt) { front.parent.localToWorld(tmp); tilt.worldToLocal(tmp); }
        c1.set(tmp.z, tmp.y);
        var r1 = chain.rFront, r2 = chain.rRear;
        u.subVectors(c2, c1); var d = u.length(); if(d < r1 + r2 + 0.01) return; u.divideScalar(d);
        // the two tangents: their normals make the angle psi with the line between the middles (n . u = (r1 - r2) / d)
        var psi = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
        nTop.set(u.x * Math.cos(psi) - u.y * Math.sin(psi), u.x * Math.sin(psi) + u.y * Math.cos(psi));
        nBot.set(u.x * Math.cos(-psi) - u.y * Math.sin(-psi), u.x * Math.sin(-psi) + u.y * Math.cos(-psi));
        if(nTop.y < nBot.y) { var sw = nTop; nTop = nBot; nBot = sw; }
        var p1t = { x: c1.x + r1 * nTop.x, y: c1.y + r1 * nTop.y }, p2t = { x: c2.x + r2 * nTop.x, y: c2.y + r2 * nTop.y };
        var p1b = { x: c1.x + r1 * nBot.x, y: c1.y + r1 * nBot.y }, p2b = { x: c2.x + r2 * nBot.x, y: c2.y + r2 * nBot.y };
        var aTop = Math.atan2(nTop.y, nTop.x), aBot = Math.atan2(nBot.y, nBot.x), aU = Math.atan2(u.y, u.x), aBack = Math.atan2(-u.y, -u.x);
        // the path, the way the chain runs when the wheel goes forward: on top from the rear to the front, round the front sprocket, below from the front to the rear, round the rear
        pieces.length = 0;
        pieces.push(piece(0, p2t.x, p2t.y, p1t.x, p1t.y));
        pieces.push(piece(1, 0, 0, 0, 0, c1.x, c1.y, r1, aTop, sweepThrough(aTop, aBot, aBack)));
        pieces.push(piece(0, p1b.x, p1b.y, p2b.x, p2b.y));
        pieces.push(piece(1, 0, 0, 0, 0, c2.x, c2.y, r2, aBot, sweepThrough(aBot, aTop, aU)));
        var L = 0; for(var i = 0; i < pieces.length; i++) L += pieces[i].len;
        chain.length = L;
        // the links: as many as the chain is long, once
        if(!chain.mesh) {
            chain.count = Math.max(4, Math.round(L / chain.pitch));
            chain.mesh = new THREE.InstancedMesh(chain.link.geometry, chain.link.material, chain.count);
            chain.mesh.castShadow = true; chain.mesh.name = "chain";
            tilt.add(chain.mesh);
        }
        // the chain moves with the rim of the rear sprocket
        if(chain.spinPrev === null) chain.spinPrev = spinRear || 0;
        var dSpin = (spinRear || 0) - chain.spinPrev; chain.spinPrev = spinRear || 0;
        if(Math.abs(dSpin) > Math.PI) dSpin -= Math.sign(dSpin) * 2 * Math.PI;
        chain.s = (chain.s + r2 * dSpin) % L; if(chain.s < 0) chain.s += L;
        var spacing = L / chain.count, phi0 = chain.alongZ ? 0 : Math.PI / 2;
        for(var k = 0; k < chain.count; k++) {
            var s = (chain.s + k * spacing) % L, j = 0;
            while(j < pieces.length - 1 && s > pieces[j].len) { s -= pieces[j].len; j++; }
            at(pieces[j], Math.min(s, pieces[j].len), pt);
            var angle = Math.atan2(pt.dy, pt.dz);
            mt.makeTranslation(chain.x, pt.y, pt.z);
            mr.makeRotationX(-(angle - phi0));                   // (a turn about x by t takes the z axis to the angle -t in the plane: the sign is the other way round)
            m.copy(mt).multiply(mr).multiply(chain.linkMatrix);
            chain.mesh.setMatrixAt(k, m);
        }
        chain.mesh.instanceMatrix.needsUpdate = true;
        // the front sprocket turns with the chain (its rim moves as fast as the chain): about its own middle
        var a1 = chain.s / Math.max(1e-6, r1);
        var c = chain.frontCentre;
        mt.makeTranslation(c.x, c.y, c.z); mr.makeRotationX(a1);
        front.matrixAutoUpdate = false;
        front.matrix.copy(mt).multiply(mr).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).multiply(chain.frontRest);
        front.matrixWorldNeedsUpdate = true;
    }

    return { find: find, update: update };
})();
