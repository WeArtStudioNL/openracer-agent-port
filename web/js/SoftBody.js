/*
 * SoftBody.js
 *
 * Description: The shell of a car: a skeleton of nodes and beams in the frame of the car that dents. See SOFTBODY.md.
 *
 *              A node sits where a collision sphere of the car is (CollisionProxy.js). It is held to the frame of the car by an anchor, a
 *              spring that is elastic up to a yield force and then bends for good (the shape stays), and that tears off at its break force.
 *              Nodes that are near each other are joined by beams, with the same three: a spring, a yield force and a break force. Hits
 *              act on the nodes (Vehicle.js finds them with the triangles of the track), and the rigid body of the car feels them through the
 *              anchors, so the peak of a hit is as high as what yields, and the energy of a crash goes into the bending.
 *
 *              No 3D library: numbers in arrays. The frame of the car is x to the left, y up, z forward, from the centre of gravity.
 *              Strengths are in newtons, stiffnesses in N/m, and every default can be set per car (car.json "softbody") and per node and beam.
 */

OpenRacer.SoftBody = function (vehicle, spheres, config) {
    var self = this;
    config = config || {};
    var anchorCfg = config.anchor || {}, beamCfg = config.beam || {}, contactCfg = config.contact || {};

    // the defaults, for a car of about 1500 kg
    this.params = {
        shellMass: config.shell_mass !== undefined ? config.shell_mass : Math.min(400, 0.2 * vehicle.mass),   // kg that the nodes share
        anchorK: anchorCfg.stiffness !== undefined ? anchorCfg.stiffness : 8.0e5,
        anchorYield: anchorCfg.yield_force !== undefined ? anchorCfg.yield_force : 80000,
        anchorBreak: anchorCfg.break_force !== undefined ? anchorCfg.break_force : 250000,
        anchorDamping: anchorCfg.damping !== undefined ? anchorCfg.damping : 0.6,
        beamK: beamCfg.stiffness !== undefined ? beamCfg.stiffness : 4.0e5,
        beamYield: beamCfg.yield_force !== undefined ? beamCfg.yield_force : 40000,
        beamBreak: beamCfg.break_force !== undefined ? beamCfg.break_force : 120000,
        beamDamping: beamCfg.damping !== undefined ? beamCfg.damping : 0.15,
        hardening: config.hardening !== undefined ? config.hardening : 0.2,        // how much the force goes on rising after the yield
        contactK: contactCfg.stiffness !== undefined ? contactCfg.stiffness : 1.5e6,
        contactDamping: contactCfg.damping !== undefined ? contactCfg.damping : 0.7,
        friction: contactCfg.friction !== undefined ? contactCfg.friction : 0.5,
        neighbours: config.neighbours !== undefined ? config.neighbours : 5,
        reach: config.reach !== undefined ? config.reach : 1.1                      // beams are not longer than this (m)
    };
    var P = this.params;

    // ---- the nodes: one for every sphere that is not a wheel
    var sphereOf = [];                                // node -> sphere
    spheres.forEach(function (s, i) { if (!s.wheel) sphereOf.push(i); });
    var N = sphereOf.length;
    this.count = N;
    this.sphereOf = sphereOf;
    this.nodeOfSphere = spheres.map(function () { return -1; });
    sphereOf.forEach(function (s, k) { self.nodeOfSphere[s] = k; });
    // the nodes of a part (a hood, a door) belong to its group: they are joined to each other, and to the body only by the links of its mounts
    var partOf = sphereOf.map(function (si) { return spheres[si].part || null; });
    this.partOf = partOf;
    var gone = new Uint8Array(N);                      // nodes of a part that has come loose: not simulated any more
    var rest = new Float64Array(3 * N);               // where the node is when the car is whole
    var radius = new Float64Array(N);
    sphereOf.forEach(function (s, k) { rest[3 * k] = spheres[s].x; rest[3 * k + 1] = spheres[s].y; rest[3 * k + 2] = spheres[s].z; radius[k] = spheres[s].r; });
    var u = new Float64Array(3 * N), w = new Float64Array(3 * N), q = new Float64Array(3 * N);   // the displacement, its speed, the part that stays
    var f = new Float64Array(3 * N);                  // the force on the nodes in one step
    var mass = new Float64Array(N);
    var anchorYield = new Float64Array(N), anchorBreak = new Float64Array(N), anchorAlive = new Uint8Array(N);
    for (var k = 0; k < N; k++) { mass[k] = Math.max(2, P.shellMass / N); anchorYield[k] = P.anchorYield; anchorBreak[k] = P.anchorBreak; anchorAlive[k] = 1; }
    (config.nodes || []).forEach(function (n) {
        if (n.i === undefined || n.i < 0 || n.i >= N) return;
        if (n.yield_force !== undefined) anchorYield[n.i] = n.yield_force;
        if (n.break_force !== undefined) anchorBreak[n.i] = n.break_force;
        if (n.mass !== undefined) mass[n.i] = Math.max(0.5, n.mass);
    });
    this.nodeYield = anchorYield; this.nodeBreak = anchorBreak;

    // ---- the beams: every node to its nearest neighbours
    var beamA = [], beamB = [], beamRest = [], beamK = [], beamYield = [], beamBreak = [], beamAlive = [];
    var seen = {};
    for (var a = 0; a < N; a++) {
        var near = [];
        for (var b = 0; b < N; b++) {
            if (a === b || partOf[a] !== partOf[b]) continue;
            var dx = rest[3 * a] - rest[3 * b], dy = rest[3 * a + 1] - rest[3 * b + 1], dz = rest[3 * a + 2] - rest[3 * b + 2];
            var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < P.reach && d > 0.02) near.push([d, b]);
        }
        near.sort(function (x, y) { return x[0] - y[0]; });
        for (var m = 0; m < Math.min(P.neighbours, near.length); m++) {
            var lo = Math.min(a, near[m][1]), hi = Math.max(a, near[m][1]);
            var key = lo * 4096 + hi;
            if (seen[key]) continue;
            seen[key] = true;
            beamA.push(lo); beamB.push(hi); beamRest.push(near[m][0]); beamK.push(P.beamK); beamYield.push(P.beamYield); beamBreak.push(P.beamBreak); beamAlive.push(1);
        }
    }
    var B = beamA.length;
    this.beamCount = B;
    (config.beams || []).forEach(function (o) {
        for (var i = 0; i < B; i++) {
            if ((beamA[i] === o.a && beamB[i] === o.b) || (beamA[i] === o.b && beamB[i] === o.a)) {
                if (o.stiffness !== undefined) beamK[i] = o.stiffness;
                if (o.yield_force !== undefined) beamYield[i] = o.yield_force;
                if (o.break_force !== undefined) beamBreak[i] = o.break_force;
            }
        }
    });
    // A beam that is added afterwards (the link of a mount of a part): its index
    this.addBeam = function (a, b, params) {
        params = params || {};
        for (var i = 0; i < beamA.length; i++) if ((beamA[i] === a && beamB[i] === b) || (beamA[i] === b && beamB[i] === a)) return i;
        var d = Math.hypot(rest[3 * a] - rest[3 * b], rest[3 * a + 1] - rest[3 * b + 1], rest[3 * a + 2] - rest[3 * b + 2]);
        beamA.push(Math.min(a, b)); beamB.push(Math.max(a, b)); beamRest.push(d);
        beamK.push(params.stiffness || P.beamK); beamYield.push(params.yield_force || P.beamYield); beamBreak.push(params.break_force || P.beamBreak); beamAlive.push(1);
        B = beamA.length;
        self.beamCount = B;
        return B - 1;
    };
    // The nodes of a part come loose with it: their anchors and beams are gone (they are not tested against the road any more)
    this.detachGroup = function (name) {
        for (var k = 0; k < N; k++) if (partOf[k] === name) { gone[k] = 1; anchorAlive[k] = 0; w[3 * k] = w[3 * k + 1] = w[3 * k + 2] = 0; }      // its bend stays as it was: the model of the part keeps its dents
        self.version++;
    };
    this.beamA = beamA; this.beamB = beamB; this.beamAlive = beamAlive; this.beamYield = beamYield; this.beamBreak = beamBreak; this.beamK = beamK;

    // ---- what the rest of the game reads
    this.displacement = new Float32Array(3 * N);      // u + q, for the model (the vertex shader)
    this.version = 0;                                 // goes up when a node moved, so the model is only updated then
    this.absorbed = 0;                                // the energy that went into bending (J)
    this.restPosition = function (k, out) { out.x = rest[3 * k]; out.y = rest[3 * k + 1]; out.z = rest[3 * k + 2]; return out; };
    this.position = function (k, out) {               // where the node is now, in the frame of the car
        out.x = rest[3 * k] + u[3 * k] + q[3 * k]; out.y = rest[3 * k + 1] + u[3 * k + 1] + q[3 * k + 1]; out.z = rest[3 * k + 2] + u[3 * k + 2] + q[3 * k + 2];
        return out;
    };
    this.velocity = function (k, out) { out.x = w[3 * k]; out.y = w[3 * k + 1]; out.z = w[3 * k + 2]; return out; };
    this.radiusOf = function (k) { return radius[k]; };
    this.massOf = function (k) { return mass[k]; };
    this.alive = function (k) { return anchorAlive[k] === 1; };
    this.force = f;                                   // the contacts of Vehicle.js add their force here (frame, newtons), once per step of the nodes

    // How bent the car is: the biggest permanent displacement (m), and how many anchors and beams are gone
    this.stats = function () {
        var maxQ = 0, maxU = 0, brokenAnchors = 0, brokenBeams = 0;
        for (var k = 0; k < N; k++) {
            maxQ = Math.max(maxQ, Math.hypot(q[3 * k], q[3 * k + 1], q[3 * k + 2]));
            maxU = Math.max(maxU, Math.hypot(u[3 * k], u[3 * k + 1], u[3 * k + 2]));
            if (!anchorAlive[k] && !gone[k]) brokenAnchors++;
        }
        for (var i = 0; i < B; i++) if (!beamAlive[i]) brokenBeams++;
        return { nodes: N, beams: B, maxBend: maxQ, maxDisplacement: maxU, brokenAnchors: brokenAnchors, brokenBeams: brokenBeams, absorbed: this.absorbed };
    };

    // The car is whole again
    this.repair = function () {
        u.fill(0); w.fill(0); q.fill(0); f.fill(0);
        for (var k = 0; k < N; k++) { anchorAlive[k] = 1; gone[k] = 0; }
        for (var i = 0; i < B; i++) { beamAlive[i] = 1; }
        // the lengths of the beams as made
        for (var j = 0; j < B; j++) {
            var a = beamA[j], b = beamB[j];
            beamRest[j] = Math.hypot(rest[3 * a] - rest[3 * b], rest[3 * a + 1] - rest[3 * b + 1], rest[3 * a + 2] - rest[3 * b + 2]);
        }
        this.absorbed = 0;
        this.plate = null; this.pinned = false;
        this.displacement.fill(0);
        this.version++;
    };

    // The reaction of the anchors on the car, summed over the steps of the nodes: reaction[0..2] the force, [3..5] the torque about the centre of
    // gravity (frame, newtons and newton metres). Vehicle.js turns it into the world and adds it to the forces of the body.
    this.reaction = new Float64Array(6);
    this.quiet = true;                                 // nothing moves and nothing is pulled: a step can be left out

    // One step of dt seconds of the nodes and the beams; 'contacts' (optional) is called with (dt) before the forces are summed, to add the
    // forces of the hits to this.force
    this.step = function (dt, contacts) {
        var hard = P.hardening;
        var reaction = this.reaction;
        reaction.fill(0);
        var moved = false, maxMove = 0, maxMove2 = 0;
        var steps = 3, h = dt / steps;
        for (var s = 0; s < steps; s++) {
            // the forces of the hits (the callback fills this.force), then the anchors and the beams
            if (contacts) contacts(h);
            if (this.plate) { pushPlate(this.plate, h); if (this.plate.done) { this.lastPlate = this.plate; this.plate = null; this.pinned = false; } }
            for (var k = 0; k < N; k++) {
                if (!anchorAlive[k]) continue;
                var ix = 3 * k;
                var dx = u[ix] - q[ix], dy = u[ix + 1] - q[ix + 1], dz = u[ix + 2] - q[ix + 2];
                var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                var yieldD = anchorYield[k] / P.anchorK;
                if (d > yieldD) {
                    // past the yield force: the shape stays bent. Only a share of what is beyond it is still a spring (the force goes on rising)
                    var excess = d - yieldD;
                    var shift = excess * (1 - hard);
                    q[ix] += dx / d * shift; q[ix + 1] += dy / d * shift; q[ix + 2] += dz / d * shift;
                    this.absorbed += anchorYield[k] * shift;
                    dx = u[ix] - q[ix]; dy = u[ix + 1] - q[ix + 1]; dz = u[ix + 2] - q[ix + 2];
                    d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    moved = true;
                }
                if(d > maxMove) maxMove = d;
                var c = 2 * P.anchorDamping * Math.sqrt(P.anchorK * mass[k]);
                var fx = P.anchorK * dx + c * w[ix], fy = P.anchorK * dy + c * w[ix + 1], fz = P.anchorK * dz + c * w[ix + 2];   // the anchor pulls the node back; this is what it pulls on the car
                if (P.anchorK * d > anchorBreak[k]) { anchorAlive[k] = 0; moved = true; continue; }       // it tears off
                f[ix] -= fx; f[ix + 1] -= fy; f[ix + 2] -= fz;
                // on the car, at the place of the node
                var px = rest[ix] + u[ix] + q[ix], py = rest[ix + 1] + u[ix + 1] + q[ix + 1], pz = rest[ix + 2] + u[ix + 2] + q[ix + 2];
                reaction[0] += fx * h / dt; reaction[1] += fy * h / dt; reaction[2] += fz * h / dt;
                reaction[3] += (py * fz - pz * fy) * h / dt; reaction[4] += (pz * fx - px * fz) * h / dt; reaction[5] += (px * fy - py * fx) * h / dt;
            }
            for (var i = 0; i < B; i++) {
                if (!beamAlive[i] || gone[beamA[i]] || gone[beamB[i]]) continue;
                var a = beamA[i] * 3, b = beamB[i] * 3;
                var ex = rest[b] + u[b] + q[b] - rest[a] - u[a] - q[a], ey = rest[b + 1] + u[b + 1] + q[b + 1] - rest[a + 1] - u[a + 1] - q[a + 1], ez = rest[b + 2] + u[b + 2] + q[b + 2] - rest[a + 2] - u[a + 2] - q[a + 2];
                var len = Math.sqrt(ex * ex + ey * ey + ez * ez);
                if (len < 1e-6) continue;
                var nx = ex / len, ny = ey / len, nz = ez / len;
                var ext = len - beamRest[i];
                var force = beamK[i] * ext;
                // yield: the rest length follows what is beyond the yield force
                if (Math.abs(force) > beamYield[i]) {
                    var beyond = Math.abs(ext) - beamYield[i] / beamK[i];
                    var change = Math.sign(ext) * beyond * (1 - hard);
                    beamRest[i] += change;
                    this.absorbed += beamYield[i] * Math.abs(change);
                    ext = len - beamRest[i];
                    force = beamK[i] * ext;
                    moved = true;
                }
                if (Math.abs(force) > beamBreak[i]) { beamAlive[i] = 0; moved = true; continue; }
                var rv = (w[b] - w[a]) * nx + (w[b + 1] - w[a + 1]) * ny + (w[b + 2] - w[a + 2]) * nz;
                var cb = 2 * P.beamDamping * Math.sqrt(beamK[i] * Math.min(mass[beamA[i]], mass[beamB[i]]));
                var fb = force + cb * rv;
                f[a] += fb * nx; f[a + 1] += fb * ny; f[a + 2] += fb * nz;
                f[b] -= fb * nx; f[b + 1] -= fb * ny; f[b + 2] -= fb * nz;
            }
            // integrate: semi-implicit Euler
            for (var j = 0; j < N; j++) {
                if (gone[j]) { f[3 * j] = f[3 * j + 1] = f[3 * j + 2] = 0; continue; }
                var o = 3 * j;
                var im = 1 / mass[j];
                w[o] += f[o] * im * h; w[o + 1] += f[o + 1] * im * h; w[o + 2] += f[o + 2] * im * h;
                var speedSq = w[o] * w[o] + w[o + 1] * w[o + 1] + w[o + 2] * w[o + 2];
                if(speedSq > maxMove2) maxMove2 = speedSq;
                u[o] += w[o] * h; u[o + 1] += w[o + 1] * h; u[o + 2] += w[o + 2] * h;
                f[o] = 0; f[o + 1] = 0; f[o + 2] = 0;
            }
        }
        this.quiet = !moved && maxMove < 1e-4 && maxMove2 < 1e-6 && !this.plate;
        // the displacement for the model, when something moved
        var any = moved;
        if (!any) for (var m = 0; m < 3 * N; m++) { if (Math.abs(u[m]) > 1e-4) { any = true; break; } }
        if (any) {
            for (var n = 0; n < 3 * N; n++) self.displacement[n] = u[n] + q[n];
            this.version++;
        }
    };


    // A flat plate that is pushed on the car with a force (the car editor, "Apply force"): an invisible wall in the frame of the car. It starts
    // a little outside the surface at 'point' (the outer normal is 'normal') and is pushed inwards with 'newtons' by a mass of its own; the
    // nodes under its square (side 'side' m) push back, and the plate stops where the two balance. The nodes feel it as a hit on them, so the
    // anchors and the beams yield and tear as in a crash.
    this.plate = null;
    this.pinned = false;                              // the reaction of the anchors does not go to the car (the plate is a test of the shell on a car that is clamped)
    this.pushPlate = function (point, normal, newtons, side, cubeMass, pushTime) {
        var nl = Math.hypot(normal[0], normal[1], normal[2]) || 1;
        var n = [normal[0] / nl, normal[1] / nl, normal[2] / nl];
        // two directions in the plane of the plate
        var t1 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        var e1 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
        var l1 = Math.hypot(e1[0], e1[1], e1[2]);
        e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
        var e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
        var surface = n[0] * point[0] + n[1] * point[1] + n[2] * point[2];
        this.plate = { n: n, e1: e1, e2: e2, p: point.slice(), force: newtons, pushT: pushTime || 0.03, half: Math.max(0.05, side / 2), mass: Math.max(1, cubeMass || 100), surface: surface, w: surface + 0.4, vw: 0, held: 0, peak: 0, travelled: 0, hit: false, done: false };
        this.pinned = true;
        this.quiet = false;
    };
    this.lastPlate = null;                             // the cube that has just been and gone: its peak force and speed
    this.releasePlate = function () { this.plate = null; this.lastPlate = null; this.pinned = false; };

    function pushPlate(pl, h) {
        var n = pl.n, total = 0;
        for (var k = 0; k < N; k++) {
            if (!anchorAlive[k]) continue;
            var ix = 3 * k;
            var x = rest[ix] + u[ix] + q[ix], y = rest[ix + 1] + u[ix + 1] + q[ix + 1], z = rest[ix + 2] + u[ix + 2] + q[ix + 2];
            var dx = x - pl.p[0], dy = y - pl.p[1], dz = z - pl.p[2];
            var r = radius[k];
            if (Math.abs(dx * pl.e1[0] + dy * pl.e1[1] + dz * pl.e1[2]) > pl.half + r || Math.abs(dx * pl.e2[0] + dy * pl.e2[1] + dz * pl.e2[2]) > pl.half + r) continue;
            var depth = n[0] * x + n[1] * y + n[2] * z + r - pl.w;
            if (depth <= 0) continue;
            var vn = n[0] * w[ix] + n[1] * w[ix + 1] + n[2] * w[ix + 2] - pl.vw;     // positive: the node comes at the plate
            var c = 2 * P.contactDamping * Math.sqrt(P.contactK * mass[k]);
            var fn = P.contactK * depth + c * vn;
            if (fn <= 0) continue;
            f[ix] -= fn * n[0]; f[ix + 1] -= fn * n[1]; f[ix + 2] -= fn * n[2];
            total += fn;
        }
        pl.held = total;
        if (total > 0 && pl.contact === undefined) pl.contact = pl.w;      // where it first touched a node
        // a short push gets the cube going (its force for 'pushT' seconds), then it flies free: it hits, and it rebounds
        var push = 0;
        if (pl.pushT > 0) { push = pl.force; pl.pushT -= h; }
        pl.vw += (-push + total) / pl.mass * h;
        if (total > pl.peak) pl.peak = total;
        if (pl.contact !== undefined) pl.maxIn = Math.max(pl.maxIn || 0, pl.contact - pl.w);       // how far it got into the shell
        if (total > 0) pl.hit = true;
        // after the hit, and away from the car again: the cube is gone and the car is let go
        if (pl.hit && pl.vw > 0 && pl.w > (pl.contact !== undefined ? pl.contact : pl.surface) + 0.5) pl.done = true;
        pl.w += pl.vw * h;
        if (!pl.hit && pl.pushT <= 0 && pl.vw >= 0) pl.done = true;     // it never reached the car
        var floor = pl.surface - 1.2;                       // it does not go through the whole car
        if (pl.w < floor) { pl.w = floor; if (pl.vw < 0) pl.vw = 0; }
    }

    this.repair();
};
