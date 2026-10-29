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
    var blockList = [];
    var nearNode, nodeList;                                // 1 for a node that a triangle of the list can reach in this step (the others are not looked at), and the triangles that can
    var Bx, By, Bz;                                        // per node: the stiffness times the speed of the anchors (a spring to a place that moves: the implicit step has to know where it goes)
    var Kxx, Kxy, Kxz, Kyy, Kyz, Kzz, t1xA, t1yA, t1zA, t2xA, t2yA, t2zA, holdA;      // (and per node: the directions of its bristles and whether they hold, for the bend of the bristles after the step)                       // per node: the stiffness of its springs to anchors that move with the wheel or stand on the road (the cables, the shear, the road, the bristles), taken implicitly
    var eFn, eNx, eNy, eNz, tFn;                           // the load on a node from the samples between the nodes (and the sum of its own and those)
    var fnNode, cnx, cny, cnz, ctri, inContact, sliding, ux, uy;
    var bA, bB, bL0, bLmin, bClass, bKind, bStrain, bK, bDx, bDy, bDz;      // (bK, bD: the stiffness and the direction of a cable in this substep, for the force to the rim after the implicit step)        // the beams: ends (outer 0..N-1, inner N..2N-1), rest length, length of the stop, class of stiffness, kind, strain of the last step
    var beamCount = 0, started = false;
    var surfaceNames = [];
    var near = { x: 0, y: 0, z: 0 }, triNormal = { x: 0, y: 0, z: 0 };
    var hubFx = 0, hubFy = 0, hubFz = 0, hubTorque = 0;
    var CLASS_RADIAL = 0, CLASS_ALONG = 1, CLASS_ACROSS = 2, CLASS_BELT = 3, CLASS_CROSS = 4;
    var classK = [0, 0, 0, 0, 0], classL0Pre = 0;

    // set by Vehicle.js
    this.forceFilter = 0.0015;         // s: the load that goes to the car is smoothed over this (a long one lagged behind the hop of a heavy wheel on a stiff tyre and fed it)
    this.torsion = 0;                  // kNm/rad: the torsional stiffness of the tyre, the belt against the rim through the sidewall (a car tyre 10 to 30; 0: three times the bristle stiffness, the old rule)
    this.beltMul = 0.25;               // the belt springs round the tyre and across it, as a multiple of the cable of the carcass
    this.beltTwoSided = false;         // the belt pushes back when it is compressed too (a steel belt); false: a string, it only pulls
    this.stepAngle = 0.7;              // the step of a node against its fastest ring (rad per substep): the number of substeps follows from it
    this.lockedSpin = false;           // a test rig: the wheel is turned at the omega that is given, the tread does not turn it
    this.rimStiffness = 1.5e6;         // N/m: the rim on the road (a landing that flattens the tyre)
    this.rimDamping = 8000;            // N per m/s, on the way in
    this.roadStop = 0.5;               // the damper of the road can at most take this share of the speed of a node into the road in a substep (it is at this limit nearly always: it is the loss of the tread going in and out of the patch)
    this.bristleDamping = 0.3;         // the damping of the bristles that hold a node on the road (of critical, per node)
    this.shearDamping = 1.0;           // the damping of the shear springs of the tread along the wheel (of critical, per node): it is what damps the wheel against the tread (a wheel at a standstill swung back and forth with less)
    this.shearDampingLat = 0.15;       // the same across the wheel: only against the ringing of a node (more would give a lateral force that grows with the speed)
    this.round = false;                // a motorcycle tyre: a round crown (the outer rings lie a lot lower, and the profile is a circle), a car tyre is flat with a small shoulder
    this.shoulder = 0;                 // how far the outer rings lie below the middle one (m; 0: 2 % of the width for a car, 30 % for a round tyre)
    this.softShare = 1.8;             // the carcass goes slack (the air carries the node) at this share of the static deflection of the tyre (carcass 0: this rule; carcass > 0: that many mm)
    this.rings = 3; this.segments = 36; this.width = 0;
    this.stiffX = 20; this.stiffY = 18; this.damping = 0.8; this.restDamping = 2; this.stribeck = 8; this.tolerance = 0.004;
    this.verticalStiffness = 220000; this.verticalDamping = 3000; this.staticLoad = 3000;
    this.pressure = 2.2;               // bar
    this.innerRatio = 0.62;            // the radius of the inner shell (the rim) as a share of the radius of the tyre
    this.carcass = 0;                  // mm: how far a node of the tread is pushed in before its cable goes slack (0: so that the tyre has the stiffness of the cylinder tyre at its static load)
    this.tyreMass = 0;                 // kg of the outer shell (0: from the wheel)
    this.roadStiffness = 4;            // the stiffness of the road on a node as a multiple of the cable of the carcass
    this.roadDamping = 0.6;            // and its damping, as a share of the critical damping
    this.implicit = false;             // the springs of a node to its anchors taken implicitly in its step (fewer substeps; an experiment: the force to the rim then lags the nodes, a wheel at a standstill swung by 3 rad/s)
    this.theta = 0.6;                  // the implicit step of a node on its springs to anchors: 1 is backward Euler (it damps every fast motion, a rolling tyre lost a lot in it), 0.5 the trapezoid (no loss, no damping of the fastest ringing)
    this.maxSubstep = 0.00022;          // s: the longest substep (the dampers are explicit, and the road is found per substep)
    this.maxSubsteps = 14;             // the most steps for one step of the car
    this.beamDamping = 0.3;            // the damping of the beams, as a share of the critical damping of a node on it
    this.count = 0; this.contacts = 0; this.patch = 0; this.slidingShare = 0;
    this.normal = { x: 0, y: 0, z: 0 };
    this.friction = { x: 0, y: 0, z: 0 };
    this.centre = { x: 0, y: 0, z: 0 };
    this.surfaceNormal = { x: 0, y: 1, z: 0 };
    this.surface = "road"; this.mesh = ""; this.groundY = 0; this.maxDepth = 0; this.axleTorque = 0; this.used = 0; this.dampSlope = 0;
    this.sag = 0;                      // m: how far the tyre is pushed in at its lowest place (for the debug view and the HUD)
    this.substeps = 0;
    this.omegaOut = undefined; this.omegaAvg = 0;        // the turn of the wheel at the end of the step, by the tread alone (the car adds the engine and the brake), and its mean over the step

    function key() { return [Math.max(1, Math.min(5, Math.round(self.rings))), Math.max(4, Math.min(72, Math.round(self.segments))), self.width, wheel.radius, self.innerRatio, self.round ? 1 : 0, self.shoulder].join(","); }

    function build() {
        rings = Math.max(1, Math.min(5, Math.round(self.rings)));
        segs = Math.max(4, Math.min(72, Math.round(self.segments)));
        radius = wheel.radius;
        width = self.width > 0 ? self.width : Math.max(0.1, 0.7 * radius);
        N = rings * segs;
        nodeLat = new Float32Array(rings); nodeRad = new Float32Array(rings); innerLat = new Float32Array(rings); innerRad = new Float32Array(rings);
        var shoulder = self.shoulder > 0 ? self.shoulder : (self.round ? 0.3 * width : 0.02 * width), ratio = Math.max(0.3, Math.min(0.9, self.innerRatio)), power = self.round ? 2 : 4;
        for(var j = 0; j < rings; j++) {
            var t = rings === 1 ? 0 : (j / (rings - 1)) * 2 - 1;
            nodeLat[j] = t * width / 2 * (rings === 1 ? 0 : 0.92);
            nodeRad[j] = radius - shoulder * Math.pow(Math.abs(t), power);
            innerLat[j] = nodeLat[j] * 0.62;                                   // the rim is narrower than the tread
            innerRad[j] = radius * ratio;
        }
        function f64() { return new Float64Array(N); }
        Px = f64(); Py = f64(); Pz = f64(); Vx = f64(); Vy = f64(); Vz = f64(); Fx = f64(); Fy = f64(); Fz = f64();
        Ix = f64(); Iy = f64(); Iz = f64(); IVx = f64(); IVy = f64(); IVz = f64();
        Ox = f64(); Oy = f64(); Oz = f64(); OVx = f64(); OVy = f64(); OVz = f64(); Tx = f64(); Ty = f64(); Tz = f64(); Nx = f64(); Ny = f64(); Nz = f64();
        nearNode = new Uint8Array(N); nodeList = []; for(var il = 0; il < N; il++) nodeList.push([]);
        t1xA = f64(); t1yA = f64(); t1zA = f64(); t2xA = f64(); t2yA = f64(); t2zA = f64(); holdA = new Uint8Array(N);
        Bx = f64(); By = f64(); Bz = f64();
        Kxx = f64(); Kxy = f64(); Kxz = f64(); Kyy = f64(); Kyz = f64(); Kzz = f64();
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
        bStrain = new Float32Array(beamCount); bK = new Float64Array(beamCount); bDx = new Float64Array(beamCount); bDy = new Float64Array(beamCount); bDz = new Float64Array(beamCount);
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
    var cDepth = 0, cNx = 0, cNy = 0, cNz = 0, cTri = -1, upRef = { x: 0, y: 1, z: 0 };
    function contactAt(x, y, z, hub, ground, list, tol) {
        cDepth = 0; cTri = -1;
        for(var q = 0; q < list.length; q++) {
            var t = list[q];
            if(!ground.boxNear(t, x, y, z, tol + 0.06)) continue;
            var d2 = ground.closest(t, x, y, z, near), dist = Math.sqrt(d2), mx, my, mz, dd;
            if(near.region === 0) {
                ground.normalOf(t, triNormal);
                // the side of the triangle that pushes: the one the up of the wheel points to (a hub that is driven below the road in a hard landing would have turned the push
                // the wrong way and let the wheel fall through); for a wall, where the up of the wheel lies along it, the side of the hub
                var upN = upRef.x * triNormal.x + upRef.y * triNormal.y + upRef.z * triNormal.z, sgn;
                if(Math.abs(upN) > 0.3) sgn = upN >= 0 ? 1 : -1;
                else { var sideHub = (hub.x - near.x) * triNormal.x + (hub.y - near.y) * triNormal.y + (hub.z - near.z) * triNormal.z; sgn = sideHub >= 0 ? 1 : -1; }
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
        // the softness of the carcass: how far a node goes in before its cable is slack and the air carries it; a share of the static deflection of the tyre (the stiffness of the tyre
        // then follows the pressure: the cables and the air both do), or what the car says in mm
        var softness = self.carcass > 0 ? Math.max(0.003, self.carcass / 1000) : Math.max(0.003, self.softShare * self.staticLoad / Math.max(1e4, self.verticalStiffness));
        var kr = pA / softness;                                               // the cable down to the rim: slack when the node is in by the softness of the carcass
        var spacing = 2 * Math.PI * R / segs, nominal = Math.max(4, rings * 0.19 / spacing);
        var Kt = self.torsion > 0 ? self.torsion * 1000 / (R * R) : 3 * self.stiffX * self.staticLoad / 0.095, Ky = 3 * self.stiffY * self.staticLoad / 0.095;
        var inertia = wheel.inertia || 1.6;
        // (the wheel takes the stiffness of the tread implicitly, dampSlope below: the belt can be as stiff as the tyre says; a cap far out, against a step that is not one)
        Kt = Math.min(Kt, 20 * inertia / (R * R * dt * dt));
        classK[CLASS_RADIAL] = kr;
        var kShearT = Kt / nominal, kShearL = Ky / nominal;
        var cShearT = 2 * self.shearDamping * Math.sqrt(kShearT * mn), cShearL = 2 * self.shearDampingLat * Math.sqrt(kShearL * mn);
        classK[CLASS_BELT] = self.beltMul * kr; classK[CLASS_CROSS] = self.beltMul * kr;
        var kg = self.roadStiffness * kr, kStop = 20 * kr, zeta = self.beamDamping;
        var hubx = hub.x, huby = hub.y, hubz = hub.z;
        // the number of steps: the fastest node (the road on it, and the beams) against a step of 0.9 rad; a node that is too light for the steps that we can afford is made heavier
        // (the springs to the rim, to the place of the node on the wheel, to the road and the bristles are taken implicitly in the step of a node: they do not limit it; the beams
        // between the nodes, the belt, are explicit, and the dampers; a node that is too light for the steps we can afford is made heavier, which the belt alone hardly asks)
        var kSum = self.implicit ? 2 * classK[CLASS_BELT] + 2 * classK[CLASS_CROSS] : kg + kr + kShearT + kShearL + 2 * classK[CLASS_BELT] + 2 * classK[CLASS_CROSS];
        var stepMax = dt / self.maxSubsteps;
        mn = Math.max(mn, 1.15 * kSum * (stepMax / self.stepAngle) * (stepMax / self.stepAngle));
        var nWanted = Math.max(Math.ceil(dt * Math.sqrt(kSum / mn) / self.stepAngle), Math.ceil(dt / self.maxSubstep)), n = Math.max(2, Math.min(self.maxSubsteps, nWanted));
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
        upRef.x = U.x; upRef.y = U.y; upRef.z = U.z;
        var fHubX = 0, fHubY = 0, fHubZ = 0, torque = 0;
        // a force on a node of the rim: it goes to the hub (and its torque about the axle)
        var hcx = hubx, hcy = huby, hcz = hubz;                              // the hub of the substep (the rim is placed along the path of the hub: the arm of a torque is from there)
        function rimForce(i, fx, fy, fz) {
            fHubX += fx; fHubY += fy; fHubZ += fz;
            var rx = Ix[i] - hcx, ry = Iy[i] - hcy, rz = Iz[i] - hcz;
            torque += L.x * (ry * fz - rz * fy) + L.y * (rz * fx - rx * fz) + L.z * (rx * fy - ry * fx);
        }
        // a spring of k along the unit direction d on node i, to an anchor: its stiffness k d d^T goes into the implicit step of the node
        // (vax, vay, vaz: the speed of the anchor, when it moves: the rim, or the place of the node on the wheel)
        function addK(i, k, dx, dy, dz, vax, vay, vaz) {
            Kxx[i] += k * dx * dx; Kxy[i] += k * dx * dy; Kxz[i] += k * dx * dz; Kyy[i] += k * dy * dy; Kyz[i] += k * dy * dz; Kzz[i] += k * dz * dz;
            if(vax !== undefined) { var kv = k * (vax * dx + vay * dy + vaz * dz); Bx[i] += kv * dx; By[i] += kv * dy; Bz[i] += kv * dz; }
        }
        var load0 = Math.max(self.staticLoad * 0.3, 1);
        var surf = frictionOf(Math.max(load0, loadPrev), self.surface);
        // ---- the nodes that a triangle can reach in this step: a node with no triangle near it (by the way it goes in the step) is not tested against the road in the substeps, which
        // are most of the nodes (the top of the wheel); next to a rail with many triangles this is what keeps the tyre cheap
        // (first per block of six nodes round the wheel, over the tread: the triangles that can reach the block; then per node out of those)
        var blockSize = 6, blocks = Math.ceil(segs / blockSize);
        while(blockList.length < blocks) blockList.push([]);
        for(var bl = 0; bl < blocks; bl++) {
            var bx = 0, by = 0, bz = 0, bc = 0, bv = 0, k0 = bl * blockSize, k1 = Math.min(segs, k0 + blockSize);
            for(var jb = 0; jb < rings; jb++) for(var kb = k0; kb < k1; kb++) { var ib = jb * segs + kb; bx += Px[ib]; by += Py[ib]; bz += Pz[ib]; bc++; var vb = Vx[ib] * Vx[ib] + Vy[ib] * Vy[ib] + Vz[ib] * Vz[ib]; if(vb > bv) bv = vb; }
            bx /= bc; by /= bc; bz /= bc;
            var rad = 0;
            for(var jc = 0; jc < rings; jc++) for(var kc = k0; kc < k1; kc++) { var ic = jc * segs + kc, dxb = Px[ic] - bx, dyb = Py[ic] - by, dzb = Pz[ic] - bz, db = Math.sqrt(dxb * dxb + dyb * dyb + dzb * dzb); if(db > rad) rad = db; }
            var reachB = rad * 1.05 + tol + 0.06 + 0.03 + 1.4 * dt * Math.sqrt(bv) * 1.2, bList = blockList[bl];
            bList.length = 0;
            for(var qb = 0; qb < list.length; qb++) if(ground.boxNear(list[qb], bx, by, bz, reachB)) bList.push(list[qb]);
        }
        for(var inr = 0; inr < N; inr++) {
            var reachN = tol + 0.06 + 0.03 + 1.4 * dt * Math.sqrt(Vx[inr] * Vx[inr] + Vy[inr] * Vy[inr] + Vz[inr] * Vz[inr]), mine = nodeList[inr], fromBlock = blockList[Math.floor((inr % segs) / blockSize)];
            mine.length = 0;
            for(var qn = 0; qn < fromBlock.length; qn++) if(ground.boxNear(fromBlock[qn], Px[inr], Py[inr], Pz[inr], reachN)) mine.push(fromBlock[qn]);
            nearNode[inr] = mine.length ? 1 : 0;
        }
        // ---- the steps
        var damped = 0;
        // the wheel turns with the tread in the substeps: the tread holds the rim with a stiff grip that saturates within a few millimetres of turn, which one step of the car (3 ms) cannot
        // follow (a wheel at a standstill was thrown back and forth between the two limits of the grip, 4 rad/s); so the shell turns the wheel itself with the torque of the tread, and the
        // car adds what the engine and the brake do (omegaOut, Vehicle.js)
        var omS = omega, omSum = 0, phS = phase - 0.5 * omega * dt, inertiaW = Math.max(0.05, wheel.inertia || 1.6);
        var alongSum = 0;
        var maxDepth = 0, count = 0, sumFn = 0, slideLoad = 0, cxs = 0, cys = 0, czs = 0, nxs = 0, nys = 0, nzs = 0, minF = 1e9, maxF = -1e9, bestFn = 0, bestTri = -1, sag = 0;
        for(var s = 0; s < n; s++) {
            // (the path of the rim is centred on the hub of now, from half a step before to half a step after: the force of the step is then the force at the place where the car has the wheel; a path that ran ahead of the hub gave a force that led the motion, which is a negative damping)
            var tc = h * (s + 1) - 0.5 * dt, tq0 = torque;
            phS += omS * h;
            hcx = hub.x + vel.x * tc; hcy = hub.y + vel.y * tc; hcz = hub.z + vel.z * tc;
            placeShells(hcx, hcy, hcz, L, F, U, phS, omS, vel);
            shellNormals(hubx, huby, hubz);
            for(var i = 0; i < N; i++) { Fx[i] = Fy[i] = Fz[i] = 0; Kxx[i] = Kxy[i] = Kxz[i] = Kyy[i] = Kyz[i] = Kzz[i] = 0; Bx[i] = By[i] = Bz[i] = 0; holdA[i] = 0; }
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
                    // (the belt of a real tyre is all but inextensible and carries the pull of the turn: m w^2 r on a node that is off the road; the cables here are soft, and a tyre of a low pressure grew by centimetres at 190 km/h,
                    // which made the patch long and the rolling resistance a third of the load. The cable is taut for that pull, as it is for the pressure; a node on the road has lost it)
                    var cfPull = 0;
                    if(!inContact[a] && omS * omS > 1) { var crx = Ox[a] - hcx, cry = Oy[a] - hcy, crz = Oz[a] - hcz, cax = crx * L.x + cry * L.y + crz * L.z; crx -= cax * L.x; cry -= cax * L.y; crz -= cax * L.z; cfPull = mn * omS * omS * Math.sqrt(crx * crx + cry * cry + crz * crz); }
                    var lSlack = L0 - (pA + cfPull) / k, spring = 0;
                    bK[b] = 0;
                    if(len > lSlack) { spring = k * (len - lSlack); addK(a, k, dx, dy, dz, bvx, bvy, bvz); bK[b] = k; }
                    else if(len < bLmin[b]) { spring = -kStop * (bLmin[b] - len); addK(a, kStop, dx, dy, dz, bvx, bvy, bvz); bK[b] = kStop; }
                    bDx[b] = dx; bDy[b] = dy; bDz[b] = dz;
                    force = spring + zeta * 2 * Math.sqrt(k * mn) * vr;              // (the damper works whether the cable is taut or slack: the node has to be held in the patch)
                    bStrain[b] = (len - L0) / L0;
                } else if(kind === 0) {
                    var s0 = len - L0;
                    if(s0 > 0 || self.beltTwoSided) force = k * s0 + zeta * 2 * Math.sqrt(k * mn) * vr; else force = 0;
                    if(force < 0 && !self.beltTwoSided) force = 0;
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
                addK(is2, kShearT, Tx[is2], Ty[is2], Tz[is2], OVx[is2], OVy[is2], OVz[is2]); addK(is2, kShearL, L.x, L.y, L.z, OVx[is2], OVy[is2], OVz[is2]);
                var sx = fT * Tx[is2] + fL * L.x, sy = fT * Ty[is2] + fL * L.y, sz = fT * Tz[is2] + fL * L.z;
                Fx[is2] += sx; Fy[is2] += sy; Fz[is2] += sz;
                rimForce(is2, -sx, -sy, -sz);
            }
            // the road on the nodes: the stiff spring out of the triangle, and the bristles
            count = 0; sumFn = 0; slideLoad = 0; maxDepth = 0; cxs = cys = czs = nxs = nys = nzs = 0; minF = 1e9; maxF = -1e9; bestFn = 0; bestTri = -1; sag = 0; alongSum = 0;
            var load = Math.max(loadPrev, 1), springX = self.stiffX * load / halfPatch;
            // the road is felt at S places per span between two nodes (the nodes and the places between them on the straight line): a patch of two or three nodes would otherwise grow in jumps, and the
            // load of the tyre would jump with it; the spring of a span is shared out over its places, and the force of a place between goes to the two nodes beside it
            // (a tyre with few nodes is a polygon: the places between two nodes lie on the arc of the tyre, not on the chord, so a square or a hexagon still rolls round; the
            // places are about 3 cm apart along the tread whatever the number of nodes)
            var S = Math.max(contactSamples, Math.min(24, Math.ceil(72 / segs))), kgS = kg / S, mS = mn / S;
            for(var ie = 0; ie < N; ie++) { eFn[ie] = 0; eNx[ie] = eNy[ie] = eNz[ie] = 0; }
            for(var jr = 0; jr < rings; jr++) for(var kq = 0; kq < segs; kq++) {
                var na = jr * segs + kq, nb2 = jr * segs + (kq + 1) % segs;
                if(!nearNode[na] && !nearNode[nb2]) continue;
                // (far from the road, both ends: nothing to look for)
                var oax = Ox[na] - hcx, oay = Oy[na] - hcy, oaz = Oz[na] - hcz, obx = Ox[nb2] - hcx, oby = Oy[nb2] - hcy, obz = Oz[nb2] - hcz;
                var ringR = Math.sqrt(oax * oax + oay * oay + oaz * oaz);
                for(var m = 1; m < S; m++) {
                    var tt = m / S, qx = Px[na] + (Px[nb2] - Px[na]) * tt, qy = Py[na] + (Py[nb2] - Py[na]) * tt, qz = Pz[na] + (Pz[nb2] - Pz[na]) * tt;
                    // the bulge of the arc over the chord between the two places of the nodes on the wheel, added to the place between the nodes as they are
                    var lx = oax + (obx - oax) * tt, ly = oay + (oby - oay) * tt, lz = oaz + (obz - oaz) * tt, ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1, bul = ringR / ll - 1;
                    qx += lx * bul; qy += ly * bul; qz += lz * bul;
                    if(!contactAt(qx, qy, qz, hub, ground, nearNode[na] ? nodeList[na] : nodeList[nb2], tol)) continue;
                    var qvx = Vx[na] + (Vx[nb2] - Vx[na]) * tt, qvy = Vy[na] + (Vy[nb2] - Vy[na]) * tt, qvz = Vz[na] + (Vz[nb2] - Vz[na]) * tt;
                    var qvn = qvx * cNx + qvy * cNy + qvz * cNz;
                    var qd = -self.roadDamping * 2 * Math.sqrt(kgS * mS) * qvn, qcap = self.roadStop * mS * Math.abs(qvn) / h;
                    if(qd > qcap) qd = qcap; else if(qd < -qcap) qd = -qcap;
                    var qf = kgS * cDepth + qd;
                    if(qf <= 0) continue;
                    var fqx = qf * cNx, fqy = qf * cNy, fqz = qf * cNz, wa = 1 - tt;
                    addK(na, kgS * wa * wa, cNx, cNy, cNz); addK(nb2, kgS * tt * tt, cNx, cNy, cNz);
                    Fx[na] += fqx * wa; Fy[na] += fqy * wa; Fz[na] += fqz * wa; Fx[nb2] += fqx * tt; Fy[nb2] += fqy * tt; Fz[nb2] += fqz * tt;
                    eFn[na] += qf * wa; eFn[nb2] += qf * tt;
                    eNx[na] += fqx * wa; eNy[na] += fqy * wa; eNz[na] += fqz * wa; eNx[nb2] += fqx * tt; eNy[nb2] += fqy * tt; eNz[nb2] += fqz * tt;
                    if(qf > bestFn) { bestFn = qf; bestTri = cTri; }
                }
            }
            for(var ig = 0; ig < N; ig++) {
                var depth = 0, nxg = 0, nyg = 0, nzg = 0, fnOwn = 0;
                if(nearNode[ig] && contactAt(Px[ig], Py[ig], Pz[ig], hub, ground, nodeList[ig], tol)) {
                    depth = cDepth; nxg = cNx; nyg = cNy; nzg = cNz;
                    var vn = Vx[ig] * nxg + Vy[ig] * nyg + Vz[ig] * nzg;
                    // the spring of the road, and its damper, which can at most stop the node in a step (a stiff damper on a light node would ring)
                    var dampF = -self.roadDamping * 2 * Math.sqrt(kgS * mS) * vn, dampCap = self.roadStop * mS * Math.abs(vn) / h;
                    if(dampF > dampCap) dampF = dampCap; else if(dampF < -dampCap) dampF = -dampCap;
                    fnOwn = kgS * depth + dampF;
                    if(fnOwn < 0) fnOwn = 0;
                    if(fnOwn > 0) addK(ig, kgS, nxg, nyg, nzg);
                }
                var fn = fnOwn + eFn[ig];
                if(fn <= 0) { inContact[ig] = 0; sliding[ig] = 0; fnNode[ig] = 0; ux[ig] = uy[ig] = 0; continue; }       // (a node off the road: its bristles are straight again; they kept their bend for the next time round)
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
                alongSum += fn * along;
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
                // (the bend of the bristles grows with the slide of the node: with the implicit step after it, with its speed then; the explicit step takes the slide of now, before the force)
                if(!self.implicit) { ux[ig] += sxs * h; uy[ig] += sys * h; }
                t1xA[ig] = t1x; t1yA[ig] = t1y; t1zA[ig] = t1z; t2xA[ig] = t2x; t2yA[ig] = t2y; t2zA[ig] = t2z;
                var kx = self.stiffX * fn / halfPatch, ky = self.stiffY * fn / halfPatch;
                var slideSpeed = Math.sqrt(sxs * sxs + sys * sys);
                var muNow = surf.sliding + (surf.mu - surf.sliding) * Math.exp(-slideSpeed / self.stribeck);
                var dX = self.bristleDamping * 2 * Math.sqrt(kx * mn), dY = self.bristleDamping * 2 * Math.sqrt(ky * mn);
                var fX = -(kx * ux[ig]) - Math.sign(sxs) * Math.min(dX * Math.abs(sxs), 0.6 * mn * Math.abs(sxs) / h);
                var fY = -(ky * uy[ig]) - Math.sign(sys) * Math.min(dY * Math.abs(sys), 0.6 * mn * Math.abs(sys) / h);
                var mag = Math.sqrt(fX * fX + (fY / lateralGrip) * (fY / lateralGrip)), limit = muNow * fn;
                if(mag > limit && mag > 0) { var sc = limit / mag; ux[ig] *= sc; uy[ig] *= sc; fX *= sc; fY *= sc; sliding[ig] = 1; slideLoad += fn; holdA[ig] = 1; } else { sliding[ig] = 0; holdA[ig] = 1; addK(ig, kx, t1x, t1y, t1z); addK(ig, ky, t2x, t2y, t2z); damped += Math.min(dX, 0.6 * mn / h) + cShearT + (kx * kShearT / (kx + kShearT)) * dt; }       // (what the wheel feels of a node that holds: the dampers, and the stiffness of the bristle and the shear spring in series, as it grows over a step)
                Fx[ig] += fX * t1x + fY * t2x; Fy[ig] += fX * t1y + fY * t2y; Fz[ig] += fX * t1z + fY * t2z;
            }
            if(count > 0) halfPatch = Math.max(0.03, (maxF - minF) / 2 + spacing / 2);
            // the nodes
            var hh = h * h, th = Math.max(0.5, Math.min(1, self.theta)), hhT = hh * th, hhR = hh * (1 - th);
            for(var im = 0; im < N; im++) {
                // (mn I + theta h^2 K) v' = mn v + h F - (1 - theta) h^2 K v + h^2 K va: the springs to the anchors hold back the step as far as it would stretch them (the theta method)
                var a11 = mn + hhT * Kxx[im], a12 = hhT * Kxy[im], a13 = hhT * Kxz[im], a22 = mn + hhT * Kyy[im], a23 = hhT * Kyz[im], a33 = mn + hhT * Kzz[im];
                var kvx = Kxx[im] * Vx[im] + Kxy[im] * Vy[im] + Kxz[im] * Vz[im], kvy = Kxy[im] * Vx[im] + Kyy[im] * Vy[im] + Kyz[im] * Vz[im], kvz = Kxz[im] * Vx[im] + Kyz[im] * Vy[im] + Kzz[im] * Vz[im];
                var b1 = mn * Vx[im] + h * Fx[im] + hh * Bx[im] - hhR * kvx, b2 = mn * Vy[im] + h * Fy[im] + hh * By[im] - hhR * kvy, b3 = mn * Vz[im] + h * Fz[im] + hh * Bz[im] - hhR * kvz;
                var c11 = a22 * a33 - a23 * a23, c12 = a13 * a23 - a12 * a33, c13 = a12 * a23 - a13 * a22;
                var det = a11 * c11 + a12 * c12 + a13 * c13;
                if(self.implicit && det > 1e-12) {
                    var c22 = a11 * a33 - a13 * a13, c23 = a12 * a13 - a11 * a23, c33 = a11 * a22 - a12 * a12;
                    Vx[im] = (c11 * b1 + c12 * b2 + c13 * b3) / det; Vy[im] = (c12 * b1 + c22 * b2 + c23 * b3) / det; Vz[im] = (c13 * b1 + c23 * b2 + c33 * b3) / det;
                } else { Vx[im] += Fx[im] / mn * h; Vy[im] += Fy[im] / mn * h; Vz[im] += Fz[im] / mn * h; }
                Px[im] += Vx[im] * h; Py[im] += Vy[im] * h; Pz[im] += Vz[im] * h;
                if(self.implicit && holdA[im]) { ux[im] += (Vx[im] * t1xA[im] + Vy[im] * t1yA[im] + Vz[im] * t1zA[im]) * h; uy[im] += (Vx[im] * t2xA[im] + Vy[im] * t2yA[im] + Vz[im] * t2zA[im]) * h; }
                var ex = Px[im] - Ox[im], ey = Py[im] - Oy[im], ez = Pz[im] - Oz[im];
                var e2 = ex * ex + ey * ey + ez * ez;
                if(e2 > 0.04 * R * R) { var es = 0.2 * R / Math.sqrt(e2); Px[im] = Ox[im] + ex * es; Py[im] = Oy[im] + ey * es; Pz[im] = Oz[im] + ez * es; Vx[im] = OVx[im]; Vy[im] = OVy[im]; Vz[im] = OVz[im]; }
            }
            // the implicit step: the nodes have moved against their springs to the rim and to their places on the wheel; the rim gets the force those springs have at the theta point of
            // the step, not the one of its start (with the force of the start the rim lagged the nodes, and a wheel at a standstill swung by 3 rad/s)
            if(self.implicit) {
                var hT = h * th;
                for(var bc = 0; bc < beamCount; bc++) {
                    if(bKind[bc] !== 2 || bK[bc] === 0) continue;
                    var na2 = bA[bc], nc2 = bB[bc] - N;
                    var relC = ((Vx[na2] - IVx[nc2]) * bDx[bc] + (Vy[na2] - IVy[nc2]) * bDy[bc] + (Vz[na2] - IVz[nc2]) * bDz[bc]) * hT * bK[bc];
                    rimForce(nc2, relC * bDx[bc], relC * bDy[bc], relC * bDz[bc]);
                }
                for(var ns = 0; ns < N; ns++) {
                    var rvx2 = Vx[ns] - OVx[ns], rvy2 = Vy[ns] - OVy[ns], rvz2 = Vz[ns] - OVz[ns];
                    var relT = (rvx2 * Tx[ns] + rvy2 * Ty[ns] + rvz2 * Tz[ns]) * hT * kShearT, relL = (rvx2 * L.x + rvy2 * L.y + rvz2 * L.z) * hT * kShearL;
                    rimForce(ns, relT * Tx[ns] + relL * L.x, relT * Ty[ns] + relL * L.y, relT * Tz[ns] + relL * L.z);
                }
            }
            if(!self.lockedSpin) omS += h * (torque - tq0) / inertiaW;
            omSum += omS;
        }
        self.omegaOut = omS; self.omegaAvg = omSum / n;
        phase += self.omegaAvg * dt;
        frame.hx = hub.x + vel.x * 0.5 * dt; frame.hy = hub.y + vel.y * 0.5 * dt; frame.hz = hub.z + vel.z * 0.5 * dt;
        frame.fx = F.x; frame.fy = F.y; frame.fz = F.z; frame.ux = U.x; frame.uy = U.y; frame.uz = U.z; frame.ok = true;
        if(phase > 1e4 || phase < -1e4) phase %= (2 * Math.PI);
        // a shell that has blown up (a number that is not one) starts again on the shape of the tyre, and the car gets nothing this step
        if(!(fHubX === fHubX && fHubY === fHubY && fHubZ === fHubZ) || Math.abs(fHubX) + Math.abs(fHubY) + Math.abs(fHubZ) > 1e7) { started = false; filtered = false; self.contacts = 0; self.normal.x = self.normal.y = self.normal.z = 0; self.friction.x = self.friction.y = self.friction.z = 0; loadPrev = 0; return false; }
        // ---- what the car gets: the force of the beams (and the air) on the rim, averaged over the steps
        // (the tyre has modes of its own, much faster than the wheel on its suspension; the car gets the force through a filter, which keeps those from being pushed through the wheel and back again)
        var af = self.forceFilter > 0 ? 1 - Math.exp(-dt / self.forceFilter) : 1;
        if(!filtered || jumped) { fltX = fHubX / n; fltY = fHubY / n; fltZ = fHubZ / n; fltT = torque / n; filtered = true; }
        else { fltX += af * (fHubX / n - fltX); fltY += af * (fHubY / n - fltY); fltZ += af * (fHubZ / n - fltZ); fltT += af * (torque / n - fltT); }
        hubFx = fltX; hubFy = fltY; hubFz = fltZ; hubTorque = torque / n;      // (only the load is filtered: the friction and the torque go to the wheel as they are, a delay on the stiff grip of a wheel that spins would make it ring)
        var rawX = fHubX / n, rawY = fHubY / n, rawZ = fHubZ / n;
        self.contacts = count; self.maxDepth = maxDepth; self.axleTorque = hubTorque;
        self.dampSlope = damped / n;                                   // (N per m/s of slide, the damping and the stiffness of the bristles that hold: the car takes it implicitly in the speed of the wheel)
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
        self.centreAlong = alongSum / sumFn;                      // where the load sits along the wheel, from the hub (m; ahead is positive: the pressure centre, which gives the rolling resistance)
        // the force on the hub: the part along the surface normal is the load, the rest the friction
        // the rim on the road: a landing that drives the hub down to the rim (the tyre flat, the nodes at their stops) is stopped by the rim itself, a very stiff spring with a
        // damper on the hub along the normal of the surface; without it a hard landing on a motorcycle went through the road
        var rimR = R * Math.max(0.3, Math.min(0.9, self.innerRatio)) + 0.01;
        var hubH = (hub.x - self.centre.x) * self.surfaceNormal.x + (hub.y - self.centre.y) * self.surfaceNormal.y + (hub.z - self.centre.z) * self.surfaceNormal.z;
        if(hubH < rimR) {
            var vnRim = vel.x * self.surfaceNormal.x + vel.y * self.surfaceNormal.y + vel.z * self.surfaceNormal.z;
            var fRim = self.rimStiffness * (rimR - hubH) - (vnRim < 0 ? self.rimDamping * vnRim : 0);
            hubFx += fRim * self.surfaceNormal.x; hubFy += fRim * self.surfaceNormal.y; hubFz += fRim * self.surfaceNormal.z;
            self.rimStrike = fRim;
        } else self.rimStrike = 0;
        // the damping of the tyre against the road (the car's tyre_damping, as the ray tyre has it): on the speed of the hub into the road; it holds the hop of the wheel on the tyre, which
        // the nodes alone damp little (and the smoothing of the load lags behind it)
        var vnHub = vel.x * self.surfaceNormal.x + vel.y * self.surfaceNormal.y + vel.z * self.surfaceNormal.z, cHub = (self.verticalDamping || 0) * Math.min(1, loadPrev / Math.max(1, 0.3 * self.staticLoad));
        hubFx -= cHub * vnHub * self.surfaceNormal.x; hubFy -= cHub * vnHub * self.surfaceNormal.y; hubFz -= cHub * vnHub * self.surfaceNormal.z;
        var fn0 = hubFx * self.surfaceNormal.x + hubFy * self.surfaceNormal.y + hubFz * self.surfaceNormal.z;
        var fnRaw = rawX * self.surfaceNormal.x + rawY * self.surfaceNormal.y + rawZ * self.surfaceNormal.z;
        self.normal.x = self.surfaceNormal.x * fn0; self.normal.y = self.surfaceNormal.y * fn0; self.normal.z = self.surfaceNormal.z * fn0;
        self.friction.x = rawX - self.surfaceNormal.x * fnRaw; self.friction.y = rawY - self.surfaceNormal.y * fnRaw; self.friction.z = rawZ - self.surfaceNormal.z * fnRaw;
        loadPrev = Math.max(0, fn0);
        self.slidingShare = slideLoad / Math.max(sumFn, 1);
        var fm = Math.sqrt(self.friction.x * self.friction.x + self.friction.y * self.friction.y + self.friction.z * self.friction.z);
        self.used = fm / Math.max(1, surf.mu * Math.max(loadPrev, 1));
        return true;
    };
    var frame = { ok: false, hx: 0, hy: 0, hz: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0 };       // where the hub and its axes were at the end of the last step
    var loadPrev = 0, filtered = false, fltX = 0, fltY = 0, fltZ = 0, fltT = 0;

    // The deformation of the tread for the model of the tyre (TyreDeform.js): per ring and per place round the wheel (BINS), how far the outer node is pushed in from where it would be, in
    // the frame of the wheel that does not spin (angle from the top, towards the front): out[ring * BINS + bin], in m, negative where the air pushes it out. Returns the number of rings (0: no data)
    var BINS = 72;
    var defW = null;
    this.BINS = BINS;
    this.deformation = function (out) {
        if(!frame.ok || !Px) return 0;
        if(!defW || defW.length < out.length) defW = new Float32Array(out.length);
        for(var z = 0; z < rings * BINS; z++) { out[z] = 0; defW[z] = 0; }
        for(var j = 0; j < rings; j++) for(var k = 0; k < segs; k++) {
            var i = j * segs + k;
            var qx = Px[i] - frame.hx, qy = Py[i] - frame.hy, qz = Pz[i] - frame.hz;
            var y = qx * frame.ux + qy * frame.uy + qz * frame.uz, f = qx * frame.fx + qy * frame.fy + qz * frame.fz;
            var ox = Ox[i] - frame.hx, oy = Oy[i] - frame.hy, oz = Oz[i] - frame.hz;
            var yo = ox * frame.ux + oy * frame.uy + oz * frame.uz, fo = ox * frame.fx + oy * frame.fy + oz * frame.fz;
            var d = Math.sqrt(yo * yo + fo * fo) - Math.sqrt(y * y + f * f);
            var ang = Math.atan2(f, y); if(ang < 0) ang += 2 * Math.PI;
            var t = ang / (2 * Math.PI) * BINS, b0 = Math.floor(t), fr = t - b0, b1 = (b0 + 1) % BINS; b0 = b0 % BINS;
            out[j * BINS + b0] += d * (1 - fr); defW[j * BINS + b0] += 1 - fr;
            out[j * BINS + b1] += d * fr; defW[j * BINS + b1] += fr;
        }
        for(var jj = 0; jj < rings; jj++) {
            var base = jj * BINS;
            for(var b = 0; b < BINS; b++) if(defW[base + b] > 0.05) out[base + b] /= defW[base + b];
            // places no node reached (a gap by the turning of the nodes): from the neighbours
            for(var b2 = 0; b2 < BINS; b2++) if(defW[base + b2] <= 0.05) {
                var lo = (b2 + BINS - 1) % BINS, hi = (b2 + 1) % BINS;
                out[base + b2] = 0.5 * (out[base + lo] + out[base + hi]);
            }
        }
        return rings;
    };

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
