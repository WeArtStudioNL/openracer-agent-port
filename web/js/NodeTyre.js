/*
 * NodeTyre.js
 *
 * Description: An experimental tyre model that is made of nodes, as an alternative to the slip curves of Wheel.js (tyreForce, the magic formula). The tread is a ring
 *              of nodes (72 by default) that turns with the wheel. A node that is in the contact patch is held on the road by friction and is joined to the carcass
 *              by a spring (a beam in two directions, along and across the tyre): while the node stays on the road the carcass moves on, so the spring stretches (the
 *              deflection grows with the time in the patch), and when its force is more than the node can hold (the grip, the load that the node carries, a
 *              parabolic pressure over the patch) the node slides: the spring is held at the friction force. A node that leaves the patch is free again. So:
 *              - the forces come from the deflection of the nodes, not from a table: the grip, the slip, the combined slip of a tyre that brakes and corners, the stick
 *                at a standstill (the nodes in the patch hold the car) and the way the tyre lets go when it slides come out of the nodes;
 *              - the contact patch comes from the load (a length of a patch that grows with the load), and the road is a point and a plane (the contact that the wheel
 *                already has), so the triangles of the road are asked once for every wheel, however fine the mesh of the road is;
 *              - the slope of the force against the slip is set by "stiffness" (per N of load), the carcass lag by a relaxation length.
 *              The temperatures, the wear, the compound and the pressure of Vehicle.js go through the same grip as with the slip curves. The wheel gets fx, fy, s and slip
 *              as before, so the traction control, ABS, the smoke and the rest keep working. A deeper model (the carcass as nodes and beams too, the vertical stiffness
 *              of the tyre, the kerbs) is for later: it needs the road at every node.
 */

OpenRacer.NodeTyre = function (wheel, count) {
    var N = Math.max(24, Math.min(240, Math.round(count || 72)));
    var TWO_PI = 2 * Math.PI;
    var touching = new Uint8Array(N), sliding = new Uint8Array(N);
    var dx = new Float32Array(N), dy = new Float32Array(N), weight = new Float32Array(N), inPatch = new Int32Array(N);
    var phase = 0;
    function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
    var riseAt = [0, 0, 0, 0, 0];
    // the rise of the road at x (m along the tyre): from the five places that the wheel measures (held at the ends)
    function riseOf(x, spacing) {
        var u = x / spacing + 2;
        if(u <= 0) return riseAt[0];
        if(u >= 4) return riseAt[4];
        var s = Math.floor(u), f = u - s;
        return riseAt[s] * (1 - f) + riseAt[s + 1] * f;
    }
    var filteredX = 0, filteredY = 0;

    this.count = N;
    this.stiffX = 20;               // the force along the tyre per slip (a slip ratio of 1), as a factor of the load (the slope of the curve at the start)
    this.stiffY = 18;               // the same across the tyre, per tan of the slip angle
    this.verticalStiffness = 220000;// N/m: how far the tyre is pressed in for a load (it makes the length of the patch)
    this.relaxation = 0.25;         // m: the carcass needs this much rolling to follow a change of the slip
    this.damping = 0.8;             // the damping of the carcass against the slip speed, as a share of the critical damping of the wheel on its nodes
    this.stribeck = 8;              // m/s: the speed of the slide over which the friction falls from the static to the sliding value
    this.slidingShare = 0;          // the share of the load that is carried by nodes that slide
    this.patch = 0;                 // the length of the patch (m)
    this.profile = null;            // the depth of the tyre in the road at 5 places along it, 0.4 radius apart (the wheel measures it), or null: a flat road
    this.restDamping = 1;           // the extra damping at a standstill (1 is a critical one for the car; 0 is none)
    this.carcass = true;            // the patch from the round of the tyre pressed into the road (with the profile), not from a fixed shape
    this.nodesIn = 0;

    // One step: vl and vt the speed of the contact over the road along and across the wheel (m/s, vt to the left), omegaR the speed of the tread over the hub (m/s), load
    // the load (N) and mu and muSliding the grip of the road and of a sliding tyre (the friction coefficients, with the load sensitivity, the compound and so on).
    // Gives the forces in wheel.fx and wheel.fy (fx forward, fy to the left: against the slip).
    this.step = function (dt, vl, vt, omegaR, load, mu, muSliding, radius, lateralGrip) {
        if(load < 1) { wheel.fx = wheel.fy = 0; wheel.s = 0; wheel.slip = false; this.nodesIn = 0; return; }
        // the carcass lag: the slip speeds that reach the nodes follow the real ones over a relaxation length
        var reference = Math.max(Math.abs(vl), Math.abs(omegaR), 0.8);
        var lag = 1 - Math.exp(-dt * reference / this.relaxation);
        filteredX += ((omegaR - vl) - filteredX) * lag;
        filteredY += (-vt - filteredY) * lag;

        // the patch: half a length from the pressing in of the tyre
        var pressed = load / this.verticalStiffness;
        var half = Math.max(0.025, Math.min(0.22, Math.sqrt(radius * pressed)));
        phase = (phase + omegaR / radius * dt) % TWO_PI;
        var pitch = TWO_PI / N, sumP = 0, count = 0;
        // The carcass: every node is a radial spring that the road presses in by (delta - x^2 / 2R - the rise of the road at x); delta (how far the tyre as a whole is
        // pressed in) is found so that the springs carry the load. A kerb or a bump under part of the patch then moves the load to the nodes on it.
        var useCarcass = this.carcass;
        var delta = 0, rise = null;
        if(useCarcass) {
            rise = riseAt;
            var spacing = 0.4 * radius, p0 = this.profile, ref = 0;
            if(p0 && p0[2] === p0[2]) {       // (a number: the wheel has a road under its middle)
                ref = p0[2];
                for(var s = 0; s < 5; s++) {
                    var xs = (s - 2) * spacing;
                    rise[s] = p0[s] === p0[s] ? ref - (radius - Math.sqrt(radius * radius - xs * xs)) - p0[s] : 0;      // (a place without road: no rise)
                }
            } else { rise[0] = rise[1] = rise[2] = rise[3] = rise[4] = 0; }
            // the radial stiffness per metre of the patch: the tyre as a whole has verticalStiffness for a patch of about 0.1 m
            var kr = this.verticalStiffness / 0.1, lo = 0, hi = 0.12;
            for(var it = 0; it < 14; it++) {
                var mid = 0.5 * (lo + hi), carry = 0;
                for(var q = 0; q < 36; q++) {
                    var xq = (q + 0.5) / 36 * 0.44 - 0.22;
                    var dq = mid - xq * xq / (2 * radius) - riseOf(xq, spacing);
                    if(dq > 0) carry += dq;
                }
                if(carry * kr * 0.44 / 36 < load) lo = mid; else hi = mid;
            }
            delta = 0.5 * (lo + hi);
            var lowX = 0, highX = 0;
            for(var q2 = 0; q2 < 36; q2++) {
                var xr = (q2 + 0.5) / 36 * 0.44 - 0.22;
                if(delta - xr * xr / (2 * radius) - riseOf(xr, spacing) > 0) { if(lowX === 0) lowX = xr; highX = xr; }
            }
            half = Math.max(0.025, (highX - lowX) / 2 + 0.006);
        }
        this.patch = 2 * half;
        for(var i = 0; i < N; i++) {
            var angle = (phase + i * pitch) % TWO_PI;
            if(angle > Math.PI) angle -= TWO_PI;
            var x = angle * radius;
            var dn = useCarcass ? delta - x * x / (2 * radius) - riseOf(x, spacing) : 0;
            if(useCarcass ? dn > 0 : (x > -half && x < half)) {
                var p = useCarcass ? dn : 1 - (x * x) / (half * half);
                weight[i] = p; sumP += p;
                inPatch[count++] = i;
                if(!touching[i]) { touching[i] = 1; dx[i] = 0; dy[i] = 0; sliding[i] = 0; }     // a node that comes into the patch: free of load
            } else if(touching[i]) {
                touching[i] = 0; dx[i] = 0; dy[i] = 0; sliding[i] = 0;
            }
        }
        this.nodesIn = count;
        if(count === 0 || sumP <= 0) { wheel.fx = wheel.fy = 0; wheel.s = 0; wheel.slip = false; this.slidingShare = 0; return; }

        // the stiffness of a node, so that the force follows the slip with the slope that was asked for: C = k * nodes * half
        var kx = this.stiffX * load / (count * half), ky = this.stiffY * load / (count * half);
        var fx = 0, fy = 0, slidingLoad = 0;
        var rateX = filteredX * dt, rateY = filteredY * dt;
        // the damping of the carcass: the spring of the nodes against the inertia of the wheel rings at a high frequency (the spring is stiff and the wheel light); a
        // damping of about the critical one, over the slip speed itself, takes that out (the rubber has losses, too)
        var springX = this.stiffX * load / half;                                   // N/m: the stiffness of all the nodes together
        var inertia = wheel.inertia || 1.6;
        var dampX = this.damping * 2 * Math.sqrt(springX * inertia) / radius;      // N s/m along the tyre
        var dampY = 0.15 * this.damping * 2 * Math.sqrt(this.stiffY * load / half * Math.max(5, wheel.mass || 20)) * 0.5;      // (across the tyre the mass is the car's: little damping is needed)
        var rawX = omegaR - vl, rawY = -vt;
        // At a standstill the spring of the nodes and the mass of the car ring (the car rocks on its tyres): near a standstill, and while the wheel hardly slips, the damping
        // is raised to that of a critical one for the share of the car that the tyre carries; it fades out with speed and with the slip (a burnout is not held back)
        var calm = (1 - smooth(0.5, 2.5, Math.max(Math.abs(vl), Math.abs(omegaR)))) * (1 - smooth(0.2, 0.8, Math.sqrt(rawX * rawX + rawY * rawY)));
        calm *= this.restDamping;
        if(calm > 0) {
            var carMass = load / 9.81;
            dampX = Math.max(dampX, calm * 1.2 * Math.sqrt(springX * carMass));
            dampY = Math.max(dampY, calm * 1.2 * Math.sqrt(this.stiffY * load / half * carMass));
        }
        // the friction of a node falls from the static to the sliding value with the speed that it slides at (a Stribeck curve): the peak of the grip is at a small slip,
        // the grip of a tyre that spins or locks is the sliding one
        var slideSpeed = Math.sqrt(filteredX * filteredX + filteredY * filteredY);
        var muNow = muSliding + (mu - muSliding) * Math.exp(-slideSpeed / this.stribeck);
        for(var n = 0; n < count; n++) {
            var j = inPatch[n];
            var carried = load * weight[j] / sumP;
            dx[j] += rateX; dy[j] += rateY;
            var share = weight[j] / sumP;
            var forceX = kx * dx[j] + dampX * rawX * share, forceY = ky * dy[j] + dampY * rawY * share;
            var magnitude = Math.sqrt(forceX * forceX + (forceY / lateralGrip) * (forceY / lateralGrip));
            var limit = muNow * carried;
            if(magnitude > limit) {
                // the node slides: the spring is held at the friction force
                var scale = limit / magnitude;
                dx[j] *= scale; dy[j] *= scale;
                forceX *= scale; forceY *= scale;
                slidingLoad += carried;
            }
            fx += forceX; fy += forceY;
        }
        this.slidingShare = slidingLoad / load;
        wheel.fx = fx;
        wheel.fy = fy;
        // how far the tyre is towards its limit, for the traction control, ABS and the smoke: 1 is the peak of the grip, past it the tyre slides
        var used = Math.sqrt(fx * fx + (fy / lateralGrip) * (fy / lateralGrip)) / Math.max(1, mu * load);
        wheel.s = Math.max(used / 0.92, 1 + 0.9 * this.slidingShare);
        if(this.slidingShare < 0.05) wheel.s = used / 0.92;
        wheel.slip = wheel.s > 1.15;
    };
};
