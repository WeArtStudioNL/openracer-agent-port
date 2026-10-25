/*
 * TyreShell.js
 *
 * Description: An experiment: the tyre as two shells of nodes with beams between them (tyre model "shell", an option of the cylinder tyre of TyreBody.js, which it can be
 *              switched to in the tuning menu and in car.json, "tyres": { "model": "shell" }). The model has the same job as TyreBody.js and the same interface for Vehicle.js, but
 *              the outer shell is made of nodes that have a mass and move on their own:
 *
 *              - The INNER SHELL is the rim: rings of nodes at a smaller radius (inner_ratio of the radius of the tyre, and narrower) that are fixed to the wheel and turn with it.
 *              - The OUTER SHELL is the tread and the shoulder: the same rings and nodes as the cylinder, but free: every node has a place, a speed and a mass, and is pushed by the
 *                beams, by the air and by the road.
 *              - The BEAMS (as in a jbeam) are springs with a damper between nodes: a cable from every outer node to the inner node under it (the carcass: it only pulls, and it is
 *                set so that it just holds the node against the pressure; a stop takes over when the node is pushed in a long way, the sidewall is folded and the rim is near), cables
 *                from every outer node to the inner nodes beside it (they carry the force along the tyre, and across it), springs between the outer nodes (round the tyre and across
 *                the tread: the belt).
 *              - The PRESSURE (bar) pushes every outer node outwards, along the normal of the shell, with the force of the area that the node stands for, and the same force
 *                pushes the inner shell the other way: where the road holds the tread in, the air pushes the rim up. The load of the tyre is the pressure on its patch; a tyre with
 *                less pressure has a bigger patch and a softer carcass, and its sidewall folds more. The stiffness of the cables follows the pressure.
 *              - The ROAD pushes a node out of a triangle with a stiff spring, and holds it with the bristles of TyreBody.js (the friction at the node, up to the friction of the
 *                road times the force that presses it); the speed of a node over the road is its own speed, which is not that of the wheel: the tread sticks while the rim slips
 *                on, the beams stretch, and that is the relaxation of a tyre. What the car gets is the force of the beams on the rim.
 *              The nodes are moved in a few steps for every step of the car (the number follows the stiffness), the damping of the road is held to what stops a node in one step.
 *              The debug view (0) draws the two shells and the beams between them, coloured by their load.
 */

OpenRacer.TyreShell = function (wheel) {
    var self = this;
    var rings = 3, segs = 36, N = 0;
    var width = 0, radius = 0, phase = 0;
    var nodeLat, nodeRad, innerLat, innerRad;              // per ring: place across the tread (m) and radius of an outer and of an inner node
    var Px, Py, Pz, Vx, Vy, Vz, Fx, Fy, Fz;                // the outer nodes: place, speed, force
    var Ix, Iy, Iz, IVx, IVy, IVz;                         // the inner nodes: the same, but fixed to the wheel
    var Ox, Oy, Oz, OVx, OVy, OVz, Tx, Ty, Tz;              // where the outer nodes would be on a tyre that is not deformed, and the way along the tread there
    var Nx, Ny, Nz;                                        // the outward normal of the shell at a node
    var eFn, eNx, eNy, eNz, tFn;                           // the load on a node from the samples between the nodes (and the sum of its own and those)
    var fnNode, cnx, cny, cnz, ctri, inContact, sliding, ux, uy;
    var bA, bB, bL0, bLmin, bClass, bKind, bStrain;        // the beams: ends (outer 0..N-1, inner N..2N-1), rest length, length of the stop, class of stiffness, kind, strain of the last step
    var beamCount = 0, started = false;
    var surfaceNames = [];
    var near = { x: 0, y: 0, z: 0 }, triNormal = { x: 0, y: 0, z: 0 };
    var hubFx = 0, hubFy = 0, hubFz = 0, hubTorque = 0;
    var CLASS_RADIAL = 0, CLASS_ALONG = 1, CLASS_ACROSS = 2, CLASS_BELT = 3, CLASS_CROSS = 4;
    var classK = [0, 0, 0, 0, 0], classL0Pre = 0;

    // set by Vehicle.js
    this.forceFilter = 0.006;
    this.rings = 3; this.segments = 36; this.width = 0;
    this.stiffX = 20; this.stiffY = 18; this.damping = 0.8; this.restDamping = 2; this.stribeck = 8; this.tolerance = 0.004;
    this.verticalStiffness = 220000; this.verticalDamping = 3000; this.staticLoad = 3000;
    this.pressure = 2.2;               // bar
    this.innerRatio = 0.62;            // the radius of the inner shell (the rim) as a share of the radius of the tyre
    this.carcass = 0;                  // mm: how far a node of the tread is pushed in before its cable goes slack (0: so that the tyre has the stiffness of the cylinder tyre at its static load)
    this.tyreMass = 0;                 // kg of the outer shell (0: from the wheel)
    this.roadStiffness = 4;            // the stiffness of the road on a node as a multiple of the cable of the carcass
    this.roadDamping = 0.6;            // and its damping, as a share of the critical damping
    this.maxSubsteps = 14;             // the most steps for one step of the car
    this.beamDamping = 0.7;            // the damping of the beams, as a share of the critical damping of a node on it
    this.count = 0; this.contacts = 0; this.patch = 0; this.slidingShare = 0;
    this.normal = { x: 0, y: 0, z: 0 };
    this.friction = { x: 0, y: 0, z: 0 };
    this.centre = { x: 0, y: 0, z: 0 };
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.surface = "road"; this.mesh = ""; this.groundY = 0; this.maxDepth = 0; this.axleTorque = 0; this.used = 0; this.dampSlope = 0;
    this.sag = 0;                      // m: how far the tyre is pushed in at its lowest place (for the debug view and the HUD)
    this.substeps = 0;

    function key() { return [Math.max(1, Math.min(5, Math.round(self.rings))), Math.max(8, Math.min(72, Math.round(self.segments))), self.width, wheel.radius, self.innerRatio].join(","); }

    function build() {
        rings = Math.max(1, Math.min(5, Math.round(self.rings)));
        segs = Math.max(8, Math.min(72, Math.round(self.segments)));
        radius = wheel.radius;
        width = self.width > 0 ? self.width : Math.max(0.1, 0.7 * radius);
        N = rings * segs;
        nodeLat = new Float32Array(rings); nodeRad = new Float32Array(rings); innerLat = new Float32Array(rings); innerRad = new Float32Array(rings);
        var shoulder = Math.min(0.03, 0.12 * width), ratio = Math.max(0.3, Math.min(0.9, self.innerRatio));
        for(var j = 0; j < rings; j++) {
            var t = rings === 1 ? 0 : (j / (rings - 1)) * 2 - 1;
            nodeLat[j] = t * width / 2 * (rings === 1 ? 0 : 0.92);
            nodeRad[j] = radius - shoulder * t * t * t * t;
            innerLat[j] = nodeLat[j] * 0.62;                                   // the rim is narrower than the tread
            innerRad[j] = radius * ratio;
        }
        function f64() { return new Float64Array(N); }
        Px = f64(); Py = f64(); Pz = f64(); Vx = f64(); Vy = f64(); Vz = f64(); Fx = f64(); Fy = f64(); Fz = f64();
        Ix = f64(); Iy = f64(); Iz = f64(); IVx = f64(); IVy = f64(); IVz = f64();
        Ox = f64(); Oy = f64(); Oz = f64(); OVx = f64(); OVy = f64(); OVz = f64(); Tx = f64(); Ty = f64(); Tz = f64(); Nx = f64(); Ny = f64(); Nz = f64();
        eFn = f64(); eNx = f64(); eNy = f64(); eNz = f64(); tFn = f64();
        fnNode = new Float32Array(N); cnx = new Float32Array(N); cny = new Float32Array(N); cnz = new Float32Array(N);
        ctri = new Int32Array(N); inContact = new Uint8Array(N); sliding = new Uint8Array(N); ux = new Float32Array(N); uy = new Float32Array(N);
        // the beams, with their rest length from the shape of the tyre in its own frame (a node: lateral, and the place round the wheel)
        function local(j, k, inner) {
            var a = 2 * Math.PI * k / segs, r = inner ? innerRad[j] : nodeRad[j], o = inner ? innerLat[j] : nodeLat[j];
            return [o, Math.sin(a) * r, Math.cos(a) * r];
        }
        var A = [], B = [], L0 = [], LM = [], CL = [], KD = [];
        function add(a, b, pa, pb, cls, kind) {
            var d = Math.sqrt((pa[0] - pb[0]) * (pa[0] - pb[0]) + (pa[1] - pb[1]) * (pa[1] - pb[1]) + (pa[2] - pb[2]) * (pa[2] - pb[2]));
            A.push(a); B.push(b); L0.push(d); LM.push(kind === 2 ? 0.5 * d : 0); CL.push(cls); KD.push(kind);
        }
        for(var j2 = 0; j2 < rings; j2++) for(var k = 0; k < segs; k++) {
            var o = j2 * segs + k, po = local(j2, k, false);
            add(o, N + o, po, local(j2, k, true), CLASS_RADIAL, 2);                                           // the cable down to the rim, with the stop
            var kp = (k + 1) % segs;
            add(o, j2 * segs + kp, po, local(j2, kp, false), CLASS_BELT, 1);                                  // the belt, round the tyre
            if(j2 < rings - 1) add(o, (j2 + 1) * segs + k, po, local(j2 + 1, k, false), CLASS_CROSS, 1);       // and across the tread
        }
        beamCount = A.length;
        bA = Int32Array.from(A); bB = Int32Array.from(B); bL0 = Float64Array.from(L0); bLmin = Float64Array.from(LM); bClass = Uint8Array.from(CL); bKind = Uint8Array.from(KD);
        bStrain = new Float32Array(beamCount);
        self.count = N; self.builtFor = key(); started = false;
    }

    // where the nodes of the two shells are on a tyre that is not deformed: from the hub c and the axes L (along the axle, to the left), F (forward in the plane of the wheel), U (up)
    function placeShells(cx, cy, cz, L, F, U, ph, omega, vel) {
        for(var j = 0; j < rings; j++) {
            for(var k = 0; k < segs; k++) {
                var i = j * segs + k, a = ph + 2 * Math.PI * k / segs, s = Math.sin(a), c = Math.cos(a);
                var ro = nodeRad[j], lo = nodeLat[j];
                Tx[i] = F.x * c - U.x * s; Ty[i] = F.y * c - U.y * s; Tz[i] = F.z * c - U.z * s;
                Ox[i] = cx + L.x * lo + F.x * s * ro + U.x * c * ro; Oy[i] = cy + L.y * lo + F.y * s * ro + U.y * c * ro; Oz[i] = cz + L.z * lo + F.z * s * ro + U.z * c * ro;
                var orx = L.x * lo + F.x * s * ro + U.x * c * ro, ory = L.y * lo + F.y * s * ro + U.y * c * ro, orz = L.z * lo + F.z * s * ro + U.z * c * ro;
                OVx[i] = vel.x + omega * (L.y * orz - L.z * ory); OVy[i] = vel.y + omega * (L.z * orx - L.x * orz); OVz[i] = vel.z + omega * (L.x * ory - L.y * orx);
                var ri = innerRad[j], li = innerLat[j];
                var rx = L.x * li + F.x * s * ri + U.x * c * ri, ry = L.y * li + F.y * s * ri + U.y * c * ri, rz = L.z * li + F.z * s * ri + U.z * c * ri;
                Ix[i] = cx + rx; Iy[i] = cy + ry; Iz[i] = cz + rz;
                // the speed of a place of the rim: the hub and the turn of the wheel
                IVx[i] = vel.x + omega * (L.y * rz - L.z * ry); IVy[i] = vel.y + omega * (L.z * rx - L.x * rz); IVz[i] = vel.z + omega * (L.x * ry - L.y * rx);
            }
        }
    }

    // the normal of the shell at the outer nodes, outwards: the way from the rim node under it (a normal from the neighbours moved with the shape of the shell, and the pressure that
    // follows it made the shell flutter in the steps)
    function shellNormals(hubx, huby, hubz) {
        for(var i = 0; i < N; i++) {
            var nx = Px[i] - Ix[i], ny = Py[i] - Iy[i], nz = Pz[i] - Iz[i], l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            Nx[i] = nx / l; Ny[i] = ny / l; Nz[i] = nz / l;
        }
    }

    // the road at a place: the depth of the node in the nearest triangle that it is in, and the normal (as in TyreBody.js)
    var cDepth = 0, cNx = 0, cNy = 0, cNz = 0, cTri = -1;
    function contactAt(x, y, z, hub, ground, list, tol) {
        cDepth = 0; cTri = -1;
        for(var q = 0; q < list.length; q++) {
            var t = list[q];
            if(!ground.boxNear(t, x, y, z, tol + 0.06)) continue;
            var d2 = ground.closest(t, x, y, z, near), dist = Math.sqrt(d2), mx, my, mz, dd;
            if(near.region === 0) {
                ground.normalOf(t, triNormal);
                var sideHub = (hub.x - near.x) * triNormal.x + (hub.y - near.y) * triNormal.y + (hub.z - near.z) * triNormal.z, sgn = sideHub >= 0 ? 1 : -1;
                mx = triNormal.x * sgn; my = triNormal.y * sgn; mz = triNormal.z * sgn;
                dd = tol - ((x - near.x) * mx + (y - near.y) * my + (z - near.z) * mz);
            } else {
                if(dist > tol || dist < 1e-6) continue;
                mx = (x - near.x) / dist; my = (y - near.y) / dist; mz = (z - near.z) / dist;
                ground.normalOf(t, triNormal);
                if(Math.abs(mx * triNormal.x + my * triNormal.y + mz * triNormal.z) < 0.85) continue;
                dd = tol - dist;
            }
            if(dd > cDepth) { cDepth = dd; cTri = t; cNx = mx; cNy = my; cNz = mz; }
        }
        return cTri >= 0;
    }

    function smoothstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
    var halfPatch = 0.1, contactSamples = 4;
    // The softness of the carcass that gives the tyre the stiffness of the cylinder tyre at its static load: a node that is pushed in by d holds with a force of k d (k = pA / softness) up
    // to pA (the cable is slack from there: the air carries it), and the patch of a tyre that is pushed in by d is as long as 2 sqrt(2 R d), so the load of the whole patch is the sum
    // over its nodes; it is looked for by halving (the load grows as the carcass gets stiffer).
    var softCache = { key: "", value: 0.012 };
    function autoSoftness(R, pA, An) {
        var spacing = 2 * Math.PI * R / segs, target = self.staticLoad / self.verticalStiffness;
        var cacheKey = [R, pA, spacing, rings, self.staticLoad, self.verticalStiffness].join(",");
        if(softCache.key === cacheKey) return softCache.value;
        function load(soft) {
            var kr = pA / soft, f = 0;
            for(var j = 0; j < rings; j++) {
                var d = target - (R - nodeRad[j]);                          // (the outer rings lie lower, on the shoulder: they touch later)
                if(d <= 0) continue;
                var x0 = Math.sqrt(2 * R * d);
                for(var x = -x0; x <= x0; x += spacing / 8) f += Math.min(kr * (d - x * x / (2 * R)), pA) * (spacing / 8) / spacing;
            }
            return f;
        }
        var lo = 0.002, hi = 0.15;
        for(var it = 0; it < 40; it++) { var mid = Math.sqrt(lo * hi); if(load(mid) > self.staticLoad) lo = mid; else hi = mid; }
        softCache.key = cacheKey; softCache.value = Math.sqrt(lo * hi);
        return softCache.value;
    }

    // One step of the car: hub, vel, the axes, the turn of the wheel, the road (Ground.js) and its triangles near the wheel, friction(load, name): { mu, sliding }.
    this.step = function (dt, hub, vel, L, F, U, omega, ground, list, frictionOf, lateralGrip, carMass) {
        if(!Px || self.builtFor !== key()) build();
        var R = radius, mn = Math.max(0.01, (self.tyreMass > 0 ? self.tyreMass : 8) / N);     // the mass of a node (kg)
        // ---- the constants of the beams from the pressure and the stiffness
        var Pa = Math.max(0.15, self.pressure) * 1e5, An = (2 * Math.PI * R / segs) * (width / rings), pA = Pa * An;
        var softness = self.carcass > 0 ? Math.max(0.003, self.carcass / 1000) : autoSoftness(R, pA, An);
        var kr = pA / softness;                                               // the cable down to the rim: slack when the node is in by the softness of the carcass
        var spacing = 2 * Math.PI * R / segs, nominal = Math.max(4, rings * 0.19 / spacing);
        var Kt = 3 * self.stiffX * self.staticLoad / 0.095, Ky = 3 * self.stiffY * self.staticLoad / 0.095;
        var inertia = wheel.inertia || 1.6;
        Kt = Math.min(Kt, 0.8 * inertia / (R * R * dt * dt));                  // (a stiffer belt than the wheel can follow in one step would ring)
        classK[CLASS_RADIAL] = kr;
        var kShearT = Kt / nominal, kShearL = Ky / nominal;
        var cShearT = 2 * 0.7 * Math.sqrt(kShearT * mn), cShearL = 2 * 0.7 * Math.sqrt(kShearL * mn);
        classK[CLASS_BELT] = 0.25 * kr; classK[CLASS_CROSS] = 0.25 * kr;
        var kg = self.roadStiffness * kr, kStop = 20 * kr, zeta = self.beamDamping;
        var hubx = hub.x, huby = hub.y, hubz = hub.z;
        // the number of steps: the fastest node (the road on it, and the beams) against a step of 0.9 rad; a node that is too light for the steps that we can afford is made heavier
        var kSum = kg + kr + kShearT + kShearL + 2 * classK[CLASS_BELT] + 2 * classK[CLASS_CROSS];
        var stepMax = dt / self.maxSubsteps;
        mn = Math.max(mn, 1.15 * kSum * (stepMax / 0.9) * (stepMax / 0.9));
        var nWanted = Math.ceil(dt * Math.sqrt(kSum / mn) / 0.9), n = Math.max(2, Math.min(self.maxSubsteps, nWanted));
        self.substepsWanted = nWanted;
        self.substeps = n;
        var h = dt / n;
        // ---- the first step, or a jump of the car: the nodes start on the shape of the tyre
        var jumped = started && ((Px[0] - hub.x) * (Px[0] - hub.x) + (Py[0] - hub.y) * (Py[0] - hub.y) + (Pz[0] - hub.z) * (Pz[0] - hub.z) > 4 * R * R);
        placeShells(hub.x, hub.y, hub.z, L, F, U, phase, omega, vel);
        if(!started || jumped) {
            for(var i0 = 0; i0 < N; i0++) { Px[i0] = Ox[i0]; Py[i0] = Oy[i0]; Pz[i0] = Oz[i0]; Vx[i0] = OVx[i0]; Vy[i0] = OVy[i0]; Vz[i0] = OVz[i0]; ux[i0] = uy[i0] = 0; inContact[i0] = 0; }
            started = true;
        }
        var tol = self.tolerance;
        var fHubX = 0, fHubY = 0, fHubZ = 0, torque = 0;
        // a force on a node of the rim: it goes to the hub (and its torque about the axle)
        function rimForce(i, fx, fy, fz) {
            fHubX += fx; fHubY += fy; fHubZ += fz;
            var rx = Ix[i] - hubx, ry = Iy[i] - huby, rz = Iz[i] - hubz;
            torque += L.x * (ry * fz - rz * fy) + L.y * (rz * fx - rx * fz) + L.z * (rx * fy - ry * fx);
        }
        var load0 = Math.max(self.staticLoad * 0.3, 1);
        var surf = frictionOf(Math.max(load0, loadPrev), self.surface);
        // ---- the steps
        var maxDepth = 0, count = 0, sumFn = 0, slideLoad = 0, cxs = 0, cys = 0, czs = 0, nxs = 0, nys = 0, nzs = 0, minF = 1e9, maxF = -1e9, bestFn = 0, bestTri = -1, sag = 0;
        for(var s = 0; s < n; s++) {
            // (the path of the rim is centred on the hub of now, from half a step before to half a step after: the force of the step is then the force at the place where the car has the wheel; a path that ran ahead of the hub gave a force that led the motion, which is a negative damping)
            var tc = h * (s + 1) - 0.5 * dt, ph = phase + omega * tc;
            placeShells(hub.x + vel.x * tc, hub.y + vel.y * tc, hub.z + vel.z * tc, L, F, U, ph, omega, vel);
            shellNormals(hubx, huby, hubz);
            for(var i = 0; i < N; i++) { Fx[i] = Fy[i] = Fz[i] = 0; }
            // the pressure: on the outer node, outwards, and the reaction on the rim node under it
            for(var ip = 0; ip < N; ip++) {
                var fx = pA * Nx[ip], fy = pA * Ny[ip], fz = pA * Nz[ip];
                Fx[ip] += fx; Fy[ip] += fy; Fz[ip] += fz;
                rimForce(ip, -fx, -fy, -fz);
            }
            // the beams
            for(var b = 0; b < beamCount; b++) {
                var a = bA[b], c = bB[b], ax, ay, az, avx, avy, avz, bx, by, bz, bvx, bvy, bvz, bInner = c >= N;
                ax = Px[a]; ay = Py[a]; az = Pz[a]; avx = Vx[a]; avy = Vy[a]; avz = Vz[a];
                if(bInner) { var ci = c - N; bx = Ix[ci]; by = Iy[ci]; bz = Iz[ci]; bvx = IVx[ci]; bvy = IVy[ci]; bvz = IVz[ci]; }
                else { bx = Px[c]; by = Py[c]; bz = Pz[c]; bvx = Vx[c]; bvy = Vy[c]; bvz = Vz[c]; }
                var dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if(len < 1e-9) continue;
                dx /= len; dy /= len; dz /= len;
                var k = classK[bClass[b]], L0 = bL0[b], kind = bKind[b], force = 0;
                var vr = (bvx - avx) * dx + (bvy - avy) * dy + (bvz - avz) * dz;
                if(kind === 2) {
                    // the cable to the rim: it pulls (taut by the pressure at rest: its rest length is shorter by pA / k) and it goes slack when the node is in; the stop takes over deep in
                    var lSlack = L0 - pA / k, spring = 0;
                    if(len > lSlack) spring = k * (len - lSlack);
                    else if(len < bLmin[b]) spring = -kStop * (bLmin[b] - len);
                    force = spring + zeta * 2 * Math.sqrt(k * mn) * vr;              // (the damper works whether the cable is taut or slack: the node has to be held in the patch)
                    bStrain[b] = (len - L0) / L0;
                } else if(kind === 0) {
                    var s0 = len - L0;
                    if(s0 > 0) force = k * s0 + zeta * 2 * Math.sqrt(k * mn) * vr; else force = 0;
                    if(force < 0) force = 0;
                    bStrain[b] = s0 / L0;
                } else {
                    force = k * (len - L0) + zeta * 2 * Math.sqrt(k * mn * 0.5) * vr;
                    bStrain[b] = (len - L0) / L0;
                }
                var gx = force * dx, gy = force * dy, gz = force * dz;
                Fx[a] += gx; Fy[a] += gy; Fz[a] += gz;
                if(bInner) rimForce(c - N, -gx, -gy, -gz);
                else { Fx[c] -= gx; Fy[c] -= gy; Fz[c] -= gz; }
            }
            // the shear of the tread against the rim: a spring along the tread and one across it, between the node and the place where it would be, which pull the rim the other way
            // (the sidewall that is bent by what the tread carries; as cables to the rim beside the node they pulled it up with a force many times that of the shear)
            for(var is2 = 0; is2 < N; is2++) {
                var ex = Px[is2] - Ox[is2], ey = Py[is2] - Oy[is2], ez = Pz[is2] - Oz[is2];
                var dT = ex * Tx[is2] + ey * Ty[is2] + ez * Tz[is2], dL = ex * L.x + ey * L.y + ez * L.z;
                var rvx = Vx[is2] - OVx[is2], rvy = Vy[is2] - OVy[is2], rvz = Vz[is2] - OVz[is2];
                var vT = rvx * Tx[is2] + rvy * Ty[is2] + rvz * Tz[is2], vL = rvx * L.x + rvy * L.y + rvz * L.z;
                var fT = -(kShearT * dT + cShearT * vT), fL = -(kShearL * dL + cShearL * vL);
                var sx = fT * Tx[is2] + fL * L.x, sy = fT * Ty[is2] + fL * L.y, sz = fT * Tz[is2] + fL * L.z;
                Fx[is2] += sx; Fy[is2] += sy; Fz[is2] += sz;
                rimForce(is2, -sx, -sy, -sz);
            }
            // the road on the nodes: the stiff spring out of the triangle, and the bristles
            count = 0; sumFn = 0; slideLoad = 0; maxDepth = 0; cxs = cys = czs = nxs = nys = nzs = 0; minF = 1e9; maxF = -1e9; bestFn = 0; bestTri = -1; sag = 0;
            var load = Math.max(loadPrev, 1), springX = self.stiffX * load / halfPatch;
            // the road is felt at S places per span between two nodes (the nodes and the places between them on the straight line): a patch of two or three nodes would otherwise grow in jumps, and the
            // load of the tyre would jump with it; the spring of a span is shared out over its places, and the force of a place between goes to the two nodes beside it
            var S = contactSamples, kgS = kg / S, mS = mn / S;
            for(var ie = 0; ie < N; ie++) { eFn[ie] = 0; eNx[ie] = eNy[ie] = eNz[ie] = 0; }
            for(var jr = 0; jr < rings; jr++) for(var kq = 0; kq < segs; kq++) {
                var na = jr * segs + kq, nb2 = jr * segs + (kq + 1) % segs;
                // (far from the road, both ends: nothing to look for)
                for(var m = 1; m < S; m++) {
                    var tt = m / S, qx = Px[na] + (Px[nb2] - Px[na]) * tt, qy = Py[na] + (Py[nb2] - Py[na]) * tt, qz = Pz[na] + (Pz[nb2] - Pz[na]) * tt;
                    if(!contactAt(qx, qy, qz, hub, ground, list, tol)) continue;
                    var qvx = Vx[na] + (Vx[nb2] - Vx[na]) * tt, qvy = Vy[na] + (Vy[nb2] - Vy[na]) * tt, qvz = Vz[na] + (Vz[nb2] - Vz[na]) * tt;
                    var qvn = qvx * cNx + qvy * cNy + qvz * cNz;
                    var qd = -self.roadDamping * 2 * Math.sqrt(kgS * mS) * qvn, qcap = 0.5 * mS * Math.abs(qvn) / h;
                    if(qd > qcap) qd = qcap; else if(qd < -qcap) qd = -qcap;
                    var qf = kgS * cDepth + qd;
                    if(qf <= 0) continue;
                    var fqx = qf * cNx, fqy = qf * cNy, fqz = qf * cNz, wa = 1 - tt;
                    Fx[na] += fqx * wa; Fy[na] += fqy * wa; Fz[na] += fqz * wa; Fx[nb2] += fqx * tt; Fy[nb2] += fqy * tt; Fz[nb2] += fqz * tt;
                    eFn[na] += qf * wa; eFn[nb2] += qf * tt;
                    eNx[na] += fqx * wa; eNy[na] += fqy * wa; eNz[na] += fqz * wa; eNx[nb2] += fqx * tt; eNy[nb2] += fqy * tt; eNz[nb2] += fqz * tt;
                    if(qf > bestFn) { bestFn = qf; bestTri = cTri; }
                }
            }
            for(var ig = 0; ig < N; ig++) {
                var depth = 0, nxg = 0, nyg = 0, nzg = 0, fnOwn = 0;
                if(contactAt(Px[ig], Py[ig], Pz[ig], hub, ground, list, tol)) {
                    depth = cDepth; nxg = cNx; nyg = cNy; nzg = cNz;
                    var vn = Vx[ig] * nxg + Vy[ig] * nyg + Vz[ig] * nzg;
                    // the spring of the road, and its damper, which can at most stop the node in a step (a stiff damper on a light node would ring)
                    var dampF = -self.roadDamping * 2 * Math.sqrt(kgS * mS) * vn, dampCap = 0.5 * mS * Math.abs(vn) / h;
                    if(dampF > dampCap) dampF = dampCap; else if(dampF < -dampCap) dampF = -dampCap;
                    fnOwn = kgS * depth + dampF;
                    if(fnOwn < 0) fnOwn = 0;
                }
                var fn = fnOwn + eFn[ig];
                if(fn <= 0) { inContact[ig] = 0; sliding[ig] = 0; fnNode[ig] = 0; continue; }
                if(fnOwn > 0) { Fx[ig] += fnOwn * nxg; Fy[ig] += fnOwn * nyg; Fz[ig] += fnOwn * nzg; }
                // the direction of the load on the node: its own and that of the places beside it
                var sxn = fnOwn * nxg + eNx[ig], syn = fnOwn * nyg + eNy[ig], szn = fnOwn * nzg + eNz[ig], sln = Math.sqrt(sxn * sxn + syn * syn + szn * szn) || 1;
                nxg = sxn / sln; nyg = syn / sln; nzg = szn / sln;
                if(fnOwn <= 0) cTri = bestTri;
                if(!inContact[ig]) { inContact[ig] = 1; sliding[ig] = 0; }
                fnNode[ig] = fn; cnx[ig] = nxg; cny[ig] = nyg; cnz[ig] = nzg; ctri[ig] = cTri;
                count++; sumFn += fn;
                if(depth > maxDepth) maxDepth = depth;
                cxs += fn * Px[ig]; cys += fn * Py[ig]; czs += fn * Pz[ig];
                nxs += fn * nxg; nys += fn * nyg; nzs += fn * nzg;
                var along = (Px[ig] - hub.x) * F.x + (Py[ig] - hub.y) * F.y + (Pz[ig] - hub.z) * F.z;
                if(along < minF) minF = along; if(along > maxF) maxF = along;
                if(fn > bestFn) { bestFn = fn; bestTri = cTri; }
                // the bristles: the speed of the tread over the road is the speed of the node
                var dotN = F.x * nxg + F.y * nyg + F.z * nzg;
                var t1x = F.x - nxg * dotN, t1y = F.y - nyg * dotN, t1z = F.z - nzg * dotN, tl = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
                if(tl < 1e-3) continue;
                t1x /= tl; t1y /= tl; t1z /= tl;
                var t2x = nyg * t1z - nzg * t1y, t2y = nzg * t1x - nxg * t1z, t2z = nxg * t1y - nyg * t1x;
                var vnn = Vx[ig] * nxg + Vy[ig] * nyg + Vz[ig] * nzg;
                var tvx = Vx[ig] - vnn * nxg, tvy = Vy[ig] - vnn * nyg, tvz = Vz[ig] - vnn * nzg;
                var sxs = tvx * t1x + tvy * t1y + tvz * t1z, sys = tvx * t2x + tvy * t2y + tvz * t2z;
                ux[ig] += sxs * h; uy[ig] += sys * h;
                var kx = self.stiffX * fn / halfPatch, ky = self.stiffY * fn / halfPatch;
                var slideSpeed = Math.sqrt(sxs * sxs + sys * sys);
                var muNow = surf.sliding + (surf.mu - surf.sliding) * Math.exp(-slideSpeed / self.stribeck);
                var dX = 0.3 * 2 * Math.sqrt(kx * mn), dY = 0.3 * 2 * Math.sqrt(ky * mn);
                var fX = -(kx * ux[ig]) - Math.sign(sxs) * Math.min(dX * Math.abs(sxs), 0.6 * mn * Math.abs(sxs) / h);
                var fY = -(ky * uy[ig]) - Math.sign(sys) * Math.min(dY * Math.abs(sys), 0.6 * mn * Math.abs(sys) / h);
                var mag = Math.sqrt(fX * fX + (fY / lateralGrip) * (fY / lateralGrip)), limit = muNow * fn;
                if(mag > limit && mag > 0) { var sc = limit / mag; ux[ig] *= sc; uy[ig] *= sc; fX *= sc; fY *= sc; sliding[ig] = 1; slideLoad += fn; } else sliding[ig] = 0;
                Fx[ig] += fX * t1x + fY * t2x; Fy[ig] += fX * t1y + fY * t2y; Fz[ig] += fX * t1z + fY * t2z;
            }
            if(count > 0) halfPatch = Math.max(0.03, (maxF - minF) / 2 + spacing / 2);
            // the nodes
            for(var im = 0; im < N; im++) {
                Vx[im] += Fx[im] / mn * h; Vy[im] += Fy[im] / mn * h; Vz[im] += Fz[im] / mn * h;
                Px[im] += Vx[im] * h; Py[im] += Vy[im] * h; Pz[im] += Vz[im] * h;
                var ex = Px[im] - Ox[im], ey = Py[im] - Oy[im], ez = Pz[im] - Oz[im];
                var e2 = ex * ex + ey * ey + ez * ez;
                if(e2 > 0.04 * R * R) { var es = 0.2 * R / Math.sqrt(e2); Px[im] = Ox[im] + ex * es; Py[im] = Oy[im] + ey * es; Pz[im] = Oz[im] + ez * es; Vx[im] = OVx[im]; Vy[im] = OVy[im]; Vz[im] = OVz[im]; }
            }
        }
        phase += omega * dt;
        if(phase > 1e4 || phase < -1e4) phase %= (2 * Math.PI);
        // a shell that has blown up (a number that is not one) starts again on the shape of the tyre, and the car gets nothing this step
        if(!(fHubX === fHubX && fHubY === fHubY && fHubZ === fHubZ) || Math.abs(fHubX) + Math.abs(fHubY) + Math.abs(fHubZ) > 1e7) { started = false; filtered = false; self.contacts = 0; self.normal.x = self.normal.y = self.normal.z = 0; self.friction.x = self.friction.y = self.friction.z = 0; loadPrev = 0; return false; }
        // ---- what the car gets: the force of the beams (and the air) on the rim, averaged over the steps
        // (the tyre has modes of its own, much faster than the wheel on its suspension; the car gets the force through a filter, which keeps those from being pushed through the wheel and back again)
        var af = 1 - Math.exp(-dt / self.forceFilter);
        if(!filtered || jumped) { fltX = fHubX / n; fltY = fHubY / n; fltZ = fHubZ / n; fltT = torque / n; filtered = true; }
        else { fltX += af * (fHubX / n - fltX); fltY += af * (fHubY / n - fltY); fltZ += af * (fHubZ / n - fltZ); fltT += af * (torque / n - fltT); }
        hubFx = fltX; hubFy = fltY; hubFz = fltZ; hubTorque = fltT;
        self.contacts = count; self.maxDepth = maxDepth; self.axleTorque = hubTorque;
        self.dampSlope = 0;
        // how far the tread is in: the lowest place of the outer shell against where it would be
        for(var is = 0; is < N; is++) if(inContact[is]) { var sd = Math.sqrt((Px[is] - Ox[is]) * (Px[is] - Ox[is]) + (Py[is] - Oy[is]) * (Py[is] - Oy[is]) + (Pz[is] - Oz[is]) * (Pz[is] - Oz[is])); if(sd > sag) sag = sd; }
        self.sag = sag;
        if(count === 0 || sumFn <= 0) { self.patch = 0; self.normal.x = self.normal.y = self.normal.z = 0; self.friction.x = self.friction.y = self.friction.z = 0; self.slidingShare = 0; self.used = 0; loadPrev = 0; return false; }
        var nl = Math.sqrt(nxs * nxs + nys * nys + nzs * nzs) || 1;
        self.surfaceNormal.x = nxs / nl; self.surfaceNormal.y = nys / nl; self.surfaceNormal.z = nzs / nl;
        self.centre.x = cxs / sumFn; self.centre.y = cys / sumFn; self.centre.z = czs / sumFn;
        self.groundY = self.centre.y;
        self.surface = ground.surfaceOf(bestTri); self.mesh = ground.meshOf(bestTri);
        self.patch = 2 * halfPatch;
        // the force on the hub: the part along the surface normal is the load, the rest the friction
        var fn0 = hubFx * self.surfaceNormal.x + hubFy * self.surfaceNormal.y + hubFz * self.surfaceNormal.z;
        self.normal.x = self.surfaceNormal.x * fn0; self.normal.y = self.surfaceNormal.y * fn0; self.normal.z = self.surfaceNormal.z * fn0;
        self.friction.x = hubFx - self.normal.x; self.friction.y = hubFy - self.normal.y; self.friction.z = hubFz - self.normal.z;
        loadPrev = Math.max(0, fn0);
        self.slidingShare = slideLoad / Math.max(sumFn, 1);
        var fm = Math.sqrt(self.friction.x * self.friction.x + self.friction.y * self.friction.y + self.friction.z * self.friction.z);
        self.used = fm / Math.max(1, surf.mu * Math.max(loadPrev, 1));
        return true;
    };
    var loadPrev = 0, filtered = false, fltX = 0, fltY = 0, fltZ = 0, fltT = 0;

    // for the debug view: the nodes of the two shells, the beams and their strain
    this.shells = function () {
        return { rings: rings, segments: segs, count: N, ox: Px, oy: Py, oz: Pz, ix: Ix, iy: Iy, iz: Iz, contact: inContact, sliding: sliding, beams: beamCount, a: bA, b: bB, strain: bStrain, bclass: bClass };
    };
    // for the debug view of the cylinder: the same arrays as TyreBody.js (the nodes at the even places, stride 1 here)
    this.nodes = function () {
        return { rings: rings, segments: segs, count: N, x: Px, y: Py, z: Pz, contact: inContact, sliding: sliding, stride: 1, shell: true };
    };
    this.reset = function () { started = false; filtered = false; loadPrev = 0; if(ux) for(var i = 0; i < N; i++) { ux[i] = uy[i] = 0; inContact[i] = 0; sliding[i] = 0; } };
};
