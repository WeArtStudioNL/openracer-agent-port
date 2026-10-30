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
    // the nodes of the suspension (a hub, a knuckle, the pivots of the arms: CollisionProxy.js) come last: they are not part of the model of the
    // car (the vertices are not tied to them) and get no beams of their own to their neighbours, only the ones that are added for the rig
    var isRig = sphereOf.map(function (si) { return !!spheres[si].rig; });
    this.isRig = isRig;
    this.bodyCount = isRig.indexOf(true) < 0 ? N : isRig.indexOf(true);
    var aScale = new Float64Array(N);                  // the stiffness of the anchor of a node as a factor (a hub is held by its arms, not by its anchor)
    aScale.fill(1);
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
    var beamRig = [];                                  // 1 for a beam of the suspension: the position solver has it, not the explicit loop (see rigSolve)
    var seen = {};
    // the beams of the model (an object "beams" with edges, CollisionProxy.js): exactly those, between the nodes with the numbers of its vertices, instead of the nearest neighbours
    var explicit = config.explicit_beams;
    if (explicit) {
        explicit.forEach(function (e) {
            var lo = Math.min(e[0], e[1]), hi = Math.max(e[0], e[1]);
            if (lo === hi || hi >= N || isRig[lo] || isRig[hi]) return;
            var key = lo * 4096 + hi;
            if (seen[key]) return;
            var d = Math.hypot(rest[3 * lo] - rest[3 * hi], rest[3 * lo + 1] - rest[3 * hi + 1], rest[3 * lo + 2] - rest[3 * hi + 2]);
            if (d < 0.01) return;
            seen[key] = true;
            beamA.push(lo); beamB.push(hi); beamRest.push(d); beamK.push(P.beamK); beamYield.push(P.beamYield); beamBreak.push(P.beamBreak); beamAlive.push(1); beamRig.push(0);
        });
    }
    for (var a = 0; a < N && !explicit; a++) {
        var near = [];
        for (var b = 0; b < N; b++) {
            if (a === b || partOf[a] !== partOf[b] || isRig[a] || isRig[b]) continue;
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
            beamA.push(lo); beamB.push(hi); beamRest.push(near[m][0]); beamK.push(P.beamK); beamYield.push(P.beamYield); beamBreak.push(P.beamBreak); beamAlive.push(1); beamRig.push(0);
        }
    }
    var B = beamA.length;
    this.beamCount = B;
    this.beamA = beamA; this.beamB = beamB; this.beamAlive = beamAlive;          // for the debug view (DebugView.js)
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
        beamRig.push(isRig[a] || isRig[b] ? 1 : 0);
        B = beamA.length;
        self.beamCount = B;
        safeStep();
        return B - 1;
    };
    // Strength and mass of a node afterwards (the hub of a wheel, CollisionProxy.js): { yield, break (N, of its anchor), mass (kg) }
    this.setNode = function (k, o) {
        if (o.yield !== undefined) anchorYield[k] = o.yield;
        if (o.break !== undefined) anchorBreak[k] = o.break;
        if (o.mass !== undefined) mass[k] = Math.max(0.5, o.mass);
        if (o.anchorScale !== undefined) aScale[k] = o.anchorScale;
        if (o.release) anchorAlive[k] = 0;                 // its anchor is gone: it is held by its beams only
        safeStep();
    };
    // The force in a beam now (N, along the beam: positive when it is stretched): for the load on a link of a part
    this.beamForce = function (i) {
        if (!beamAlive[i] || gone[beamA[i]] || gone[beamB[i]]) return 0;
        var a = beamA[i] * 3, b = beamB[i] * 3;
        var ex = rest[b] + u[b] + q[b] - rest[a] - u[a] - q[a], ey = rest[b + 1] + u[b + 1] + q[b + 1] - rest[a + 1] - u[a + 1] - q[a + 1], ez = rest[b + 2] + u[b + 2] + q[b + 2] - rest[a + 2] - u[a + 2] - q[a + 2];
        return beamK[i] * (Math.sqrt(ex * ex + ey * ey + ez * ez) - beamRest[i]);
    };
    // The nodes of a part come loose with it: their anchors and beams are gone (they are not tested against the road any more)
    this.detachGroup = function (name) {
        for (var k = 0; k < N; k++) if (partOf[k] === name) { gone[k] = 1; anchorAlive[k] = 0; w[3 * k] = w[3 * k + 1] = w[3 * k + 2] = 0; }      // its bend stays as it was: the model of the part keeps its dents
        self.version++;
    };
    this.beamA = beamA; this.beamB = beamB; this.beamAlive = beamAlive; this.beamYield = beamYield; this.beamBreak = beamBreak; this.beamK = beamK;


    // The biggest step with which the nodes stay stable: explicit integration of springs and dampers blows up when the step is too long for
    // the stiffest and the densest place (a part with many nodes close together). For every node: the stiffness of its anchor, its contacts and
    // twice that of its beams (the worst mode of a network), and the same for the dampers; the step is a fraction of what each of them allows.
    var hSafe = 0.001;
    function safeStep() {
        var kSum = new Float64Array(N), cSum = new Float64Array(N);
        for (var k = 0; k < N; k++) {
            var ka = isRig[k] ? 0 : P.anchorK * aScale[k];       // the anchors and the beams of the suspension are solved by position (rigSolve): they do not limit the step
            kSum[k] = ka + P.contactK;
            cSum[k] = 2 * P.anchorDamping * Math.sqrt(ka * mass[k]) + 2 * P.contactDamping * Math.sqrt(P.contactK * mass[k]);
        }
        for (var i = 0; i < beamA.length; i++) {
            if (beamRig[i]) continue;
            var a = beamA[i], b = beamB[i];
            var cb = 2 * P.beamDamping * Math.sqrt(beamK[i] * Math.min(mass[a], mass[b]));
            kSum[a] += 2 * beamK[i]; kSum[b] += 2 * beamK[i];
            cSum[a] += 2 * cb; cSum[b] += 2 * cb;
        }
        var h = 1;
        for (var j = 0; j < N; j++) h = Math.min(h, 0.9 / Math.sqrt(kSum[j] / mass[j]), 0.6 * mass[j] / cSum[j]);
        hSafe = h;
        self.safeH = h;
    }

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

    // A repair that takes time (the pit stop, Pit.js): repairStart keeps the shape as it is, repairTo(share) puts every node that share of the way back to its place
    // (0: as it was, 1: where it belongs) and keeps it still; repair() at the end makes it whole (the beams, the anchors, the lengths as made)
    var repairFrom = null;
    this.repairStart = function () { repairFrom = { u: u.slice(), q: q.slice() }; };
    this.repairTo = function (share) {
        if (!repairFrom) return;
        var k = 1 - Math.max(0, Math.min(1, share));
        for (var n = 0; n < 3 * N; n++) { u[n] = repairFrom.u[n] * k; q[n] = repairFrom.q[n] * k; this.displacement[n] = u[n] + q[n]; }
        w.fill(0); f.fill(0);
        this.version++;
    };
    // how damaged the shell is: the mean distance of the nodes from their place (m) and the beams and anchors that broke
    this.damage = function () {
        var sum = 0, count = 0, broken = 0;
        for (var k = 0; k < N; k++) { if (gone[k]) continue; sum += Math.hypot(u[3 * k] + q[3 * k], u[3 * k + 1] + q[3 * k + 1], u[3 * k + 2] + q[3 * k + 2]); count++; if (!anchorAlive[k]) broken++; }
        for (var i = 0; i < B; i++) if (!beamAlive[i]) broken++;
        return { mean: count ? sum / count : 0, broken: broken };
    };

    // The car is whole again
    this.repair = function () {
        repairFrom = null;
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

    // The car is put somewhere else and stands still: the movement of the nodes stops, the shape stays as it is (the nodes live in the frame of the body, so a move of the
    // body takes them along; the elastic bending is left too: taken away, the nodes stood where the yielded beams no longer fitted and hung slack until they found a new rest)
    this.settle = function () {
        w.fill(0); f.fill(0);
        for (var n = 0; n < 3 * N; n++) this.displacement[n] = u[n] + q[n];
        this.version++;
    };

    // The displacement for the model from the state of the nodes (after a replay has put other numbers there)
    this.syncDisplacement = function () {
        for (var n = 0; n < 3 * N; n++) self.displacement[n] = u[n] + q[n];
        this.version++;
    };

    // The reaction of the anchors on the car, summed over the steps of the nodes: reaction[0..2] the force, [3..5] the torque about the centre of
    // gravity (frame, newtons and newton metres). Vehicle.js turns it into the world and adds it to the forces of the body.
    this.reaction = new Float64Array(6);
    this.quiet = true;                                 // nothing moves and nothing is pulled: a step can be left out


    // ---- the suspension: a position solver (XPBD) instead of the explicit springs
    // The beams of the suspension and the anchors of its nodes are the stiffest part (1e6 N/m on a few kg): explicit integration needs a very small
    // step for them. Here a spring is a constraint with a compliance of 1/k (extended position based dynamics, Macklin 2016): that is backward Euler
    // for the spring, stable for any step, and Gauss-Seidel over the few constraints of a wheel converges in a few passes. Everything else (the
    // contacts, the shell) has already moved the nodes in the explicit step; this pulls the suspension into shape and takes the speed from the move.
    var rigNodes = [], rigOld = new Float64Array(3 * N), rigLamA = new Float64Array(N), rigLamB = [], rigIters = 6;
    for (var rn = 0; rn < N; rn++) if (isRig[rn]) rigNodes.push(rn);
    var rigMaxMove = 0, rigMaxSpeed2 = 0;
    function rigSolve(h, dt) {
        var hard = P.hardening, h2 = h * h, i, k, it;
        var reaction = self.reaction;
        rigMaxMove = 0; rigMaxSpeed2 = 0;
        var moved = false;
        for (i = rigLamB.length; i < B; i++) rigLamB.push(0);
        for (i = 0; i < B; i++) rigLamB[i] = 0;
        for (i = 0; i < rigNodes.length; i++) rigLamA[rigNodes[i]] = 0;
        for (it = 0; it < rigIters; it++) {
            for (i = 0; i < rigNodes.length; i++) {                       // the anchors: the node is pulled to where it is held (q)
                k = rigNodes[i];
                if (!anchorAlive[k] || gone[k]) continue;
                var ix = 3 * k;
                var dx = u[ix] - q[ix], dy = u[ix + 1] - q[ix + 1], dz = u[ix + 2] - q[ix + 2];
                var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d < 1e-12) continue;
                var alpha = 1 / (P.anchorK * aScale[k] * h2), wk = 1 / mass[k];
                var dl = (-d - alpha * rigLamA[k]) / (wk + alpha);
                rigLamA[k] += dl;
                var sc = wk * dl / d;
                u[ix] += dx * sc; u[ix + 1] += dy * sc; u[ix + 2] += dz * sc;
            }
            for (i = 0; i < B; i++) {                                      // the beams
                if (!beamRig[i] || !beamAlive[i] || gone[beamA[i]] || gone[beamB[i]]) continue;
                var a = beamA[i] * 3, b = beamB[i] * 3;
                var ex = rest[b] + u[b] + q[b] - rest[a] - u[a] - q[a], ey = rest[b + 1] + u[b + 1] + q[b + 1] - rest[a + 1] - u[a + 1] - q[a + 1], ez = rest[b + 2] + u[b + 2] + q[b + 2] - rest[a + 2] - u[a + 2] - q[a + 2];
                var len = Math.sqrt(ex * ex + ey * ey + ez * ez);
                if (len < 1e-6) continue;
                var wa = 1 / mass[beamA[i]], wb = 1 / mass[beamB[i]];
                var al = 1 / (beamK[i] * h2);
                var dlb = (beamRest[i] - len - al * rigLamB[i]) / (wa + wb + al);      // C = len - rest, so -C = rest - len
                rigLamB[i] += dlb;
                var cx = ex / len * dlb, cy = ey / len * dlb, cz = ez / len * dlb;
                u[a] -= wa * cx; u[a + 1] -= wa * cy; u[a + 2] -= wa * cz;
                u[b] += wb * cx; u[b + 1] += wb * cy; u[b + 2] += wb * cz;
            }
        }
        // the speed that the move gave, and the dampers (as an impulse that cannot overshoot)
        for (i = 0; i < rigNodes.length; i++) {
            k = rigNodes[i];
            if (gone[k]) continue;
            var o = 3 * k;
            w[o] = (u[o] - rigOld[o]) / h; w[o + 1] = (u[o + 1] - rigOld[o + 1]) / h; w[o + 2] = (u[o + 2] - rigOld[o + 2]) / h;
        }
        for (i = 0; i < B; i++) {
            if (!beamRig[i] || !beamAlive[i] || gone[beamA[i]] || gone[beamB[i]]) continue;
            var a2 = beamA[i] * 3, b2 = beamB[i] * 3;
            var fx = rest[b2] + u[b2] + q[b2] - rest[a2] - u[a2] - q[a2], fy = rest[b2 + 1] + u[b2 + 1] + q[b2 + 1] - rest[a2 + 1] - u[a2 + 1] - q[a2 + 1], fz = rest[b2 + 2] + u[b2 + 2] + q[b2 + 2] - rest[a2 + 2] - u[a2 + 2] - q[a2 + 2];
            var l2 = Math.sqrt(fx * fx + fy * fy + fz * fz);
            if (l2 < 1e-6) continue;
            var nx = fx / l2, ny = fy / l2, nz = fz / l2;
            var ma = mass[beamA[i]], mb = mass[beamB[i]], wsum = 1 / ma + 1 / mb;
            var rv = (w[b2] - w[a2]) * nx + (w[b2 + 1] - w[a2 + 1]) * ny + (w[b2 + 2] - w[a2 + 2]) * nz;
            var cb = 2 * P.beamDamping * Math.sqrt(beamK[i] * Math.min(ma, mb));
            var imp = rv * cb * h / (1 + cb * h * wsum);
            w[a2] += imp / ma * nx; w[a2 + 1] += imp / ma * ny; w[a2 + 2] += imp / ma * nz;
            w[b2] -= imp / mb * nx; w[b2 + 1] -= imp / mb * ny; w[b2 + 2] -= imp / mb * nz;
            // yield and break, as in the explicit loop
            var ext = l2 - beamRest[i], force = beamK[i] * ext;
            if (Math.abs(force) > beamYield[i]) {
                var beyond = Math.abs(ext) - beamYield[i] / beamK[i];
                var change = Math.sign(ext) * beyond * (1 - hard);
                beamRest[i] += change;
                self.absorbed += beamYield[i] * Math.abs(change);
                ext = l2 - beamRest[i]; force = beamK[i] * ext;
                moved = true;
            }
            if (Math.abs(force) > beamBreak[i]) { beamAlive[i] = 0; moved = true; }
        }
        for (i = 0; i < rigNodes.length; i++) {                            // the anchors: damper, yield, break, and what they pull on the car
            k = rigNodes[i];
            if (!anchorAlive[k] || gone[k]) { if (!gone[k]) { var s0 = 3 * k; var sp = w[s0] * w[s0] + w[s0 + 1] * w[s0 + 1] + w[s0 + 2] * w[s0 + 2]; if (sp > rigMaxSpeed2) rigMaxSpeed2 = sp; } continue; }
            var ix2 = 3 * k;
            var kA = P.anchorK * aScale[k];
            var c = 2 * P.anchorDamping * Math.sqrt(kA * mass[k]);
            var damp = 1 / (1 + c * h / mass[k]);
            w[ix2] *= damp; w[ix2 + 1] *= damp; w[ix2 + 2] *= damp;
            var ddx = u[ix2] - q[ix2], ddy = u[ix2 + 1] - q[ix2 + 1], ddz = u[ix2 + 2] - q[ix2 + 2];
            var dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            var yieldD = anchorYield[k] / kA;
            if (dd > yieldD) {
                var shift = (dd - yieldD) * (1 - hard);
                q[ix2] += ddx / dd * shift; q[ix2 + 1] += ddy / dd * shift; q[ix2 + 2] += ddz / dd * shift;
                self.absorbed += anchorYield[k] * shift;
                ddx = u[ix2] - q[ix2]; ddy = u[ix2 + 1] - q[ix2 + 1]; ddz = u[ix2 + 2] - q[ix2 + 2];
                dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
                moved = true;
            }
            if (dd > rigMaxMove) rigMaxMove = dd;
            var sp2 = w[ix2] * w[ix2] + w[ix2 + 1] * w[ix2 + 1] + w[ix2 + 2] * w[ix2 + 2];
            if (sp2 > rigMaxSpeed2) rigMaxSpeed2 = sp2;
            if (kA * dd > anchorBreak[k]) { anchorAlive[k] = 0; moved = true; continue; }
            var gx = kA * ddx + c * w[ix2], gy = kA * ddy + c * w[ix2 + 1], gz = kA * ddz + c * w[ix2 + 2];
            var px = rest[ix2] + u[ix2] + q[ix2], py = rest[ix2 + 1] + u[ix2 + 1] + q[ix2 + 1], pz = rest[ix2 + 2] + u[ix2 + 2] + q[ix2 + 2];
            reaction[0] += gx * h / dt; reaction[1] += gy * h / dt; reaction[2] += gz * h / dt;
            reaction[3] += (py * gz - pz * gy) * h / dt; reaction[4] += (pz * gx - px * gz) * h / dt; reaction[5] += (px * gy - py * gx) * h / dt;
        }
        return moved;
    }

    // One step of dt seconds of the nodes and the beams; 'contacts' (optional) is called with (dt) before the forces are summed, to add the
    // forces of the hits to this.force
    this.step = function (dt, contacts) {
        var hard = P.hardening;
        var reaction = this.reaction;
        reaction.fill(0);
        var moved = false, maxMove = 0, maxMove2 = 0;
        var steps = Math.max(3, Math.min(8, Math.ceil(dt / hSafe))), h = dt / steps;      // small enough for the stiffest and densest place (see safeStep)
        for (var s = 0; s < steps; s++) {
            // the forces of the hits (the callback fills this.force), then the anchors and the beams
            if (contacts) contacts(h);
            if (this.plate) { pushPlate(this.plate, h); if (this.plate.done) { this.lastPlate = this.plate; this.plate = null; this.pinned = false; } }
            for (var k = 0; k < N; k++) {
                if (!anchorAlive[k] || isRig[k]) continue;
                var ix = 3 * k;
                var dx = u[ix] - q[ix], dy = u[ix + 1] - q[ix + 1], dz = u[ix + 2] - q[ix + 2];
                var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                var kA = P.anchorK * aScale[k];
                var yieldD = anchorYield[k] / kA;
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
                var c = 2 * P.anchorDamping * Math.sqrt(kA * mass[k]);
                var fx = kA * dx + c * w[ix], fy = kA * dy + c * w[ix + 1], fz = kA * dz + c * w[ix + 2];   // the anchor pulls the node back; this is what it pulls on the car
                if (kA * d > anchorBreak[k]) { anchorAlive[k] = 0; moved = true; continue; }       // it tears off
                f[ix] -= fx; f[ix + 1] -= fy; f[ix + 2] -= fz;
                // on the car, at the place of the node
                var px = rest[ix] + u[ix] + q[ix], py = rest[ix + 1] + u[ix + 1] + q[ix + 1], pz = rest[ix + 2] + u[ix + 2] + q[ix + 2];
                reaction[0] += fx * h / dt; reaction[1] += fy * h / dt; reaction[2] += fz * h / dt;
                reaction[3] += (py * fz - pz * fy) * h / dt; reaction[4] += (pz * fx - px * fz) * h / dt; reaction[5] += (px * fy - py * fx) * h / dt;
            }
            for (var i = 0; i < B; i++) {
                if (!beamAlive[i] || beamRig[i] || gone[beamA[i]] || gone[beamB[i]]) continue;
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
                if (isRig[j]) { rigOld[o] = u[o]; rigOld[o + 1] = u[o + 1]; rigOld[o + 2] = u[o + 2]; }
                u[o] += w[o] * h; u[o + 1] += w[o + 1] * h; u[o + 2] += w[o + 2] * h;
                f[o] = 0; f[o + 1] = 0; f[o + 2] = 0;
            }
            if (rigNodes.length) { if (rigSolve(h, dt)) moved = true; if (rigMaxMove > maxMove) maxMove = rigMaxMove; if (rigMaxSpeed2 > maxMove2) maxMove2 = rigMaxSpeed2; }
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
    this.pushPlate = function (point, normal, newtons, side, cubeMass, pushTime, group) {
        var nl = Math.hypot(normal[0], normal[1], normal[2]) || 1;
        var n = [normal[0] / nl, normal[1] / nl, normal[2] / nl];
        // two directions in the plane of the plate
        var t1 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        var e1 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
        var l1 = Math.hypot(e1[0], e1[1], e1[2]);
        e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
        var e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
        var surface = n[0] * point[0] + n[1] * point[1] + n[2] * point[2];
        this.plate = { n: n, e1: e1, e2: e2, p: point.slice(), force: newtons, pushT: pushTime || 0.03, half: Math.max(0.05, side / 2), mass: Math.max(1, cubeMass || 100), surface: surface, w: surface + 0.4, vw: 0, held: 0, peak: 0, travelled: 0, hit: false, done: false, group: group };
        this.pinned = true;
        this.quiet = false;
    };
    this.lastPlate = null;                             // the cube that has just been and gone: its peak force and speed
    this.releasePlate = function () { this.plate = null; this.lastPlate = null; this.pinned = false; };

    function pushPlate(pl, h) {
        var n = pl.n, total = 0;
        for (var k = 0; k < N; k++) {
            if (!anchorAlive[k]) continue;
            if (pl.group !== undefined && partOf[k] !== pl.group) continue;       // the cube hits the part that it was fired at (or the body), not what lies behind it
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

    safeStep();
    this.repair();
};
