/*
 * TyreBody.js
 *
 * Description: The tyre as one body of nodes and beams (tyre model "cylinder"), instead of a single ring and a slip curve. The tyre is a rounded cylinder: rings of nodes across the
 *              width of the tread (the outer rings lie a little lower, round the shoulder), every ring with the same number of nodes round the wheel, the nodes joined by beams along
 *              the rings and across them. The body turns with the wheel. This is all there is of the tyre:
 *              - collision: the nodes, and the places on the beams between them (so the tread is a surface, not a row of points), are tested against the triangles of the track
 *                (Ground.js), whatever they are: the road under the wheel, the edge of a kerb, the side of a ramp, a wall. A sample that is in a triangle is pushed back by a spring
 *                and a damper along the face (the stiffness of the tyre, the pressure and the puncture of Vehicle.js are in it), and the node is drawn where it is pushed to: the tyre
 *                flattens on the road and bends on a kerb;
 *              - grip: every sample in contact holds the road with a bristle (a spring of the displacement along the surface, which it integrates from the speed that the tread slides
 *                at, with the damping that keeps it from ringing) up to the friction of the road under it times the force that presses it, with the sliding friction past that (a
 *                Stribeck curve); so the force along the tyre, across it, the combined slip, the stick at a standstill and the way the tyre lets go come out of the nodes;
 *              - the forces: the sum of what the samples carry goes to the wheel (the part along the suspension is the load of the tyre, the rest goes to the car, the friction along the
 *                road as the force of the tyre) and the torque about the axle turns the wheel.
 *              Vehicle.js asks for a step for every wheel with where the hub is and how it moves, and gets the sums back.
 */

OpenRacer.TyreBody = function (wheel) {
    var self = this;
    var rings = 3, segs = 36, N = 0, S = 0;               // rings across the tread, nodes round the wheel, the nodes, the samples (the nodes and the middles of the beams along the rings)
    var width = 0, radius = 0;
    var phase = 0;                                         // the turn of the body (rad)
    var nodeLat, nodeRad, nodeAngle;                       // the nodes at rest: place across the tread (m), radius (m), angle round the wheel (rad, 0 at the top, from the turn)
    var px, py, pz, depth, nx, ny, nz, tri, inContact, sliding, ux, uy, fnSample, ox, oy, oz;
    var surfaceNames = [];
    var near = { x: 0, y: 0, z: 0 }, triNormal = { x: 0, y: 0, z: 0 }, tangent = { x: 0, y: 0, z: 0 };

    this.rings = 3; this.segments = 36; this.width = 0;
    this.stiffX = 20;                 // the force along the tyre per slip as a factor of the load (the same as the node ring): the stiffness of the bristles along the tyre
    this.stiffY = 18;                 // and across it
    this.damping = 0.8;               // the damping of the bristles along the tyre, as a share of the critical damping of the wheel
    this.restDamping = 2;             // the extra damping at a standstill
    this.stribeck = 8;                // m/s: the speed of the slide over which the friction falls from the static to the sliding value
    this.tolerance = 0.004;           // m: a sample is in contact when it is this near the surface (the tyre is a little rough, and a stable contact does not flicker)
    this.verticalStiffness = 220000;  // N/m of the tyre as a whole
    this.stiffnessScale = 2.8;        // the stiffness of a sample against the one that gives the vertical stiffness for a patch of a flat surface (the nodes are a polygon, the contact has a tolerance)
    this.verticalDamping = 3000;      // Ns/m
    this.staticLoad = 3000;           // N: the load that the stiffness is calibrated for
    this.count = 0;                   // the nodes
    this.contacts = 0;                // the samples that touch
    this.patch = 0;                   // the length of the contact (m)
    this.slidingShare = 0;

    // the sums of the last step, for the vehicle: the force of the normals (N, world), the force of the friction (N, world), the load along the suspension, the middle of the contact
    this.normal = { x: 0, y: 0, z: 0 };
    this.friction = { x: 0, y: 0, z: 0 };
    this.centre = { x: 0, y: 0, z: 0 };
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.surface = "road";
    this.mesh = "";
    this.groundY = 0;
    this.maxDepth = 0;
    this.axleTorque = 0;              // Nm about the axle of the force of the road on the tyre
    this.used = 0;                    // how far the friction is towards its limit (1 is the limit)

    function build() {
        rings = Math.max(1, Math.min(5, Math.round(self.rings)));
        segs = Math.max(8, Math.min(72, Math.round(self.segments)));
        radius = wheel.radius;
        width = self.width > 0 ? self.width : Math.max(0.1, 0.7 * radius);
        N = rings * segs; S = rings * segs * 2;
        nodeLat = new Float32Array(rings); nodeRad = new Float32Array(rings);
        // the cross section is rounded: the outer rings lie lower, on the shoulder of the tyre
        var shoulder = Math.min(0.03, 0.12 * width);
        for(var j = 0; j < rings; j++) {
            var t = rings === 1 ? 0 : (j / (rings - 1)) * 2 - 1;      // -1 .. 1 across the tread
            nodeLat[j] = t * width / 2 * (rings === 1 ? 0 : 0.92);
            nodeRad[j] = radius - shoulder * t * t * t * t;
        }
        px = new Float64Array(S); py = new Float64Array(S); pz = new Float64Array(S);
        ox = new Float64Array(S); oy = new Float64Array(S); oz = new Float64Array(S);
        depth = new Float32Array(S); nx = new Float32Array(S); ny = new Float32Array(S); nz = new Float32Array(S);
        tri = new Int32Array(S); inContact = new Uint8Array(S); sliding = new Uint8Array(S);
        ux = new Float32Array(S); uy = new Float32Array(S); fnSample = new Float32Array(S);
        self.count = N;
        self.builtFor = [rings, segs, self.width, radius].join(",");
    }

    // The nodes: ring j, node k (the samples hold the nodes at the even places and the middles of the beams between them at the odd ones); the positions are written to px, py, pz
    // from the hub c and the axes L (to the left, along the axle), F (forward in the plane of the wheel), U (up, the direction of the suspension)
    function place(cx, cy, cz, L, F, U) {
        var n = 0;
        for(var j = 0; j < rings; j++) {
            for(var k = 0; k < segs * 2; k++) {
                var a = phase + Math.PI * k / segs, sa = Math.sin(a) * nodeRad[j], ca = Math.cos(a) * nodeRad[j], o = nodeLat[j];
                var i = j * segs * 2 + k;
                ox[i] = cx + L.x * o + F.x * sa + U.x * ca;
                oy[i] = cy + L.y * o + F.y * sa + U.y * ca;
                oz[i] = cz + L.z * o + F.z * sa + U.z * ca;
                n++;
            }
        }
    }

    // One step. hub: { x, y, z } (m), vel: { x, y, z } the speed of the hub (m/s), axes L, F, U (unit vectors), omega the turn of the wheel (rad/s, positive when the car goes forward),
    // ground: Ground.js, list: the triangles that are near the wheel, friction(load, name): { mu, sliding } of a surface, lateralGrip, inertia: the wheel
    this.step = function (dt, hub, vel, L, F, U, omega, ground, list, frictionOf, lateralGrip, carMass) {
        if(!px || self.builtFor !== [Math.max(1, Math.min(5, Math.round(self.rings))), Math.max(8, Math.min(72, Math.round(self.segments))), self.width, wheel.radius].join(",")) build();
        phase += omega * dt;
        if(phase > 1e4 || phase < -1e4) phase %= (2 * Math.PI);
        place(hub.x, hub.y, hub.z, L, F, U);
        var R = radius;
        // the stiffness of a sample, so that the tyre as a whole has its vertical stiffness at its static load: the patch of that load is about 0.19 m, and a sample has the length of
        // a beam (half the distance between two nodes) on a ring
        var spacing = Math.PI * R / segs;
        var delta0 = self.staticLoad / self.verticalStiffness;
        var length0 = 2 * Math.sqrt(2 * R * Math.max(0.004, delta0));
        var kn = self.stiffnessScale * 1.5 * self.verticalStiffness * spacing / (rings * length0);
        var cn = self.verticalDamping * spacing / (rings * length0);
        // a tyre that is pushed in a long way gets hard (the sidewall folds and the rim comes near the road): past this depth it is stiffer the deeper it goes, so a hard landing
        // does not sink the wheel into the road
        var bottom = 0.22 * R;
        var count = 0, sumFn = 0, maxDepth = 0;
        var fnx = 0, fny = 0, fnz = 0;
        var minF = 1e9, maxF = -1e9;
        var cxs = 0, cys = 0, czs = 0, nxs = 0, nys = 0, nzs = 0;
        var bestFn = 0, bestSurface = null, bestMesh = "", bestTri = -1;
        var tol = self.tolerance;
        for(var i = 0; i < S; i++) {
            var x = ox[i], y = oy[i], z = oz[i];
            px[i] = x; py[i] = y; pz[i] = z;
            var found = -1, bestDepth = 0, bnx = 0, bny = 0, bnz = 0;
            for(var q = 0; q < list.length; q++) {
                var t = list[q];
                if(!ground.boxNear(t, x, y, z, tol + 0.06)) continue;
                var d2 = ground.closest(t, x, y, z, near);
                var dist = Math.sqrt(d2);
                var mx, my, mz, dd;
                if(near.region === 0) {
                    // on the face: its normal, on the side of the hub (a node that has gone through the face is pushed back out of it)
                    ground.normalOf(t, triNormal);
                    var sideHub = (hub.x - near.x) * triNormal.x + (hub.y - near.y) * triNormal.y + (hub.z - near.z) * triNormal.z;
                    var sgn = sideHub >= 0 ? 1 : -1;
                    mx = triNormal.x * sgn; my = triNormal.y * sgn; mz = triNormal.z * sgn;
                    var sd = (x - near.x) * mx + (y - near.y) * my + (z - near.z) * mz;
                    dd = tol - sd;
                } else {
                    if(dist > tol || dist < 1e-6) continue;
                    mx = (x - near.x) / dist; my = (y - near.y) / dist; mz = (z - near.z) / dist;
                    // an edge or a corner that is a seam between two faces of a surface: the neighbour has the contact
                    ground.normalOf(t, triNormal);
                    var al = Math.abs(mx * triNormal.x + my * triNormal.y + mz * triNormal.z);
                    if(al < 0.85) continue;
                    dd = tol - dist;
                }
                if(dd > bestDepth) { bestDepth = dd; found = t; bnx = mx; bny = my; bnz = mz; }
            }
            if(found < 0) {
                if(inContact[i]) { inContact[i] = 0; sliding[i] = 0; }
                depth[i] = 0; fnSample[i] = 0;
                continue;
            }
            // the speed of this place of the tread: the hub and the turn of the wheel
            var rx = x - hub.x, ry = y - hub.y, rz = z - hub.z;
            var vx = vel.x + omega * (L.y * rz - L.z * ry), vy = vel.y + omega * (L.z * rx - L.x * rz), vz = vel.z + omega * (L.x * ry - L.y * rx);
            var vn = vx * bnx + vy * bny + vz * bnz;
            var fn = kn * bestDepth * (bestDepth > bottom ? 1 + 10 * (bestDepth - bottom) / R : 1) - cn * vn;
            if(fn <= 0) { if(inContact[i]) { inContact[i] = 0; sliding[i] = 0; } depth[i] = 0; fnSample[i] = 0; continue; }
            if(!inContact[i]) { inContact[i] = 1; sliding[i] = 0; }
            depth[i] = bestDepth; nx[i] = bnx; ny[i] = bny; nz[i] = bnz; tri[i] = found; fnSample[i] = fn;
            fnx += fn * bnx; fny += fn * bny; fnz += fn * bnz;
            sumFn += fn; count++;
            if(bestDepth > maxDepth) maxDepth = bestDepth;
            // the tread is drawn on the surface: pushed out along the normal as far as it went in
            px[i] = x + bnx * bestDepth; py[i] = y + bny * bestDepth; pz[i] = z + bnz * bestDepth;
            cxs += fn * px[i]; cys += fn * py[i]; czs += fn * pz[i];
            nxs += fn * bnx; nys += fn * bny; nzs += fn * bnz;
            var along = (x - hub.x) * F.x + (y - hub.y) * F.y + (z - hub.z) * F.z;
            if(along < minF) minF = along; if(along > maxF) maxF = along;
            if(fn > bestFn) { bestFn = fn; bestTri = found; }
        }
        self.contacts = count;
        self.maxDepth = maxDepth;
        self.normal.x = fnx; self.normal.y = fny; self.normal.z = fnz;
        self.friction.x = self.friction.y = self.friction.z = 0;
        self.axleTorque = 0; self.slidingShare = 0; self.used = 0;
        if(count === 0 || sumFn <= 0) { self.patch = 0; relaxOut(dt, omega * R); return false; }
        self.centre.x = cxs / sumFn; self.centre.y = cys / sumFn; self.centre.z = czs / sumFn;
        var nl = Math.sqrt(nxs * nxs + nys * nys + nzs * nzs) || 1;
        self.surfaceNormal.x = nxs / nl; self.surfaceNormal.y = nys / nl; self.surfaceNormal.z = nzs / nl;
        self.groundY = self.centre.y;
        self.surface = ground.surfaceOf(bestTri); self.mesh = ground.meshOf(bestTri);
        var half = Math.max(0.03, (maxF - minF) / 2 + spacing / 2);
        self.patch = 2 * half;

        // ---- the grip. The bristles: the stiffness along and across, per sample as a share of the force that presses it
        var load = Math.max(sumFn, 1);
        var springX = self.stiffX * load / half;
        var inertia = wheel.inertia || 1.6;
        var dampX = self.damping * 2 * Math.sqrt(springX * inertia) / R;
        var dampY = 0.15 * self.damping * 2 * Math.sqrt(self.stiffY * load / half * Math.max(5, wheel.mass || 20)) * 0.5;
        var speedHub = Math.max(Math.abs(omega * R), Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z));
        var fxs = 0, fys = 0, fzs = 0, torque = 0, slideLoad = 0;
        var surf = frictionOf(load, self.surface);
        for(var s = 0; s < S; s++) {
            if(!inContact[s]) continue;
            var nsx = nx[s], nsy = ny[s], nsz = nz[s];
            // the axes of the surface: forward (the way of the wheel, along the surface) and to the left of it
            var dotN = F.x * nsx + F.y * nsy + F.z * nsz;
            var t1x = F.x - nsx * dotN, t1y = F.y - nsy * dotN, t1z = F.z - nsz * dotN;
            var tl = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
            if(tl < 1e-3) continue;                                   // a face that stands along the way of the wheel (the side of a wall): only the normal
            t1x /= tl; t1y /= tl; t1z /= tl;
            var t2x = nsy * t1z - nsz * t1y, t2y = nsz * t1x - nsx * t1z, t2z = nsx * t1y - nsy * t1x;
            var rx2 = px[s] - hub.x, ry2 = py[s] - hub.y, rz2 = pz[s] - hub.z;
            var wx = vel.x + omega * (L.y * rz2 - L.z * ry2), wy = vel.y + omega * (L.z * rx2 - L.x * rz2), wz = vel.z + omega * (L.x * ry2 - L.y * rx2);
            var wn = wx * nsx + wy * nsy + wz * nsz;
            var sx = (wx - wn * nsx) * t1x + (wy - wn * nsy) * t1y + (wz - wn * nsz) * t1z;       // the speed that the tread slides along the tyre ...
            var sy = (wx - wn * nsx) * t2x + (wy - wn * nsy) * t2y + (wz - wn * nsz) * t2z;       // ... and across it (positive to the left)
            var share = fnSample[s] / load;
            ux[s] += sx * dt; uy[s] += sy * dt;
            var kx = self.stiffX * fnSample[s] / half, ky = self.stiffY * fnSample[s] / half;
            // the extra damping at a standstill: the whole car on its tyres
            var calm = (1 - smoothstep(0.5, 2.5, speedHub)) * (1 - smoothstep(0.2, 0.8, Math.sqrt(sx * sx + sy * sy))) * self.restDamping;
            var dX = dampX, dY = dampY;
            if(calm > 0) {
                var cm = load / 9.81;
                dX = Math.max(dX, calm * 1.2 * Math.sqrt(springX * cm));
                dY = Math.max(dY, calm * 1.2 * Math.sqrt(self.stiffY * load / half * cm));
            }
            var slideSpeed = Math.sqrt(sx * sx + sy * sy);
            var muNow = surf.sliding + (surf.mu - surf.sliding) * Math.exp(-slideSpeed / self.stribeck);
            var fX = -(kx * ux[s] + dX * sx * share), fY = -(ky * uy[s] + dY * sy * share);
            var mag = Math.sqrt(fX * fX + (fY / lateralGrip) * (fY / lateralGrip));
            var limit = muNow * fnSample[s];
            if(mag > limit && mag > 0) {
                var scale = limit / mag;
                ux[s] *= scale; uy[s] *= scale;
                fX *= scale; fY *= scale;
                sliding[s] = 1; slideLoad += fnSample[s];
            } else sliding[s] = 0;
            var gx = fX * t1x + fY * t2x, gy = fX * t1y + fY * t2y, gz = fX * t1z + fY * t2z;
            fxs += gx; fys += gy; fzs += gz;
            // the torque about the axle of this force at this place
            torque += L.x * (ry2 * gz - rz2 * gy) + L.y * (rz2 * gx - rx2 * gz) + L.z * (rx2 * gy - ry2 * gx);
        }
        // the samples that are not in contact relax as the wheel turns
        relaxOut(dt, omega * R);
        self.friction.x = fxs; self.friction.y = fys; self.friction.z = fzs;
        self.axleTorque = torque;
        self.slidingShare = slideLoad / load;
        var fm = Math.sqrt(fxs * fxs + fys * fys + fzs * fzs);
        self.used = fm / Math.max(1, surf.mu * load);
        return true;
    };

    // a sample that is not on the road gives its displacement back as the wheel turns (not at a standstill: what holds a parked car stays)
    function relaxOut(dt, rolling) {
        var relax = Math.exp(-Math.abs(rolling) * dt / 0.05);
        for(var i = 0; i < S; i++) if(!inContact[i]) { ux[i] *= relax; uy[i] *= relax; }
    }
    function smoothstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    // for the debug view: the nodes (the places of the nodes as they are, flattened where they touch), and which touch and which slide
    this.nodes = function () {
        return { rings: rings, segments: segs, count: N, x: px, y: py, z: pz, contact: inContact, sliding: sliding, stride: 2 };
    };
    this.reset = function () { if(!px) return; for(var i = 0; i < S; i++) { ux[i] = uy[i] = 0; inContact[i] = 0; sliding[i] = 0; } };
};
