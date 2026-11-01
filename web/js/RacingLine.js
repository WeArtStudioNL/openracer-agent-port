/*
 * RacingLine.js
 *
 * Description: The line that the AI cars drive, and that the race is measured along: a closed loop of points a couple of metres apart,
 *              with for every point a speed that a car can take there (from the curvature of the line and the braking that the bends
 *              ahead ask for). It comes from the design of a track (the middle of the road), from "racing_line" in track.json, or from
 *              the best lap that the player drove (see Ghost.js), so every track can get one.
 */

OpenRacer.RacingLine = function (points, closed) {
    this.closed = closed !== false;
    this.points = [];         // { x, y, z, s }: s is the distance along the line from the first point
    this.length = 0;
    this.speeds = null;       // the speed (m/s) at every point, after computeSpeeds

    // the points are resampled a fixed distance apart, so that an index is a distance along the line
    var STEP = 2;
    var source = points.filter(function (p, i) { return i === 0 || Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > 0.05; });
    if (source.length >= 2) {
        var list = this.closed ? source.concat([source[0]]) : source;
        var carry = 0;
        this.points.push({ x: list[0].x, y: list[0].y || 0, z: list[0].z, s: 0 });
        var s = 0;
        for (var i = 1; i < list.length; i++) {
            var a = list[i - 1], b = list[i];
            var d = Math.hypot(b.x - a.x, b.z - a.z);
            var pos = carry;
            while (pos < d) {
                var t = pos / d;
                s += STEP - (this.points.length === 1 ? 0 : 0);
                this.points.push({ x: a.x + (b.x - a.x) * t, y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t, z: a.z + (b.z - a.z) * t, s: this.points.length * STEP });
                pos += STEP;
            }
            carry = pos - d;
        }
        if (this.closed) this.points.pop(); // the last one would be the first again
        this.length = this.points.length * STEP;
    }
    this.step = STEP;
};

OpenRacer.RacingLine.prototype.count = function () { return this.points.length; };

// The part of a lap (0..1) that an index is at, counted from the origin (the start of the track; set by the game)
OpenRacer.RacingLine.prototype.fractionOf = function (index) {
    var n = this.points.length;
    if (!n) return 0;
    return (((index - (this.origin || 0)) % n) + n) % n / n;
};

// The line the other way round (a track can be drawn against the direction in which it is driven)
OpenRacer.RacingLine.prototype.reverse = function () {
    this.points.reverse();
    var step = this.step;
    this.points.forEach(function (p, i) { p.s = i * step; });
    this.speeds = null;
};

// The direction of the line at its point nearest to (x, z), as a heading from +x towards +z
OpenRacer.RacingLine.prototype.headingAt = function (x, z) {
    var i = this.nearest(x, z);
    var a = this.point(i), b = this.point(i + 1);
    return Math.atan2(b.z - a.z, b.x - a.x);
};

OpenRacer.RacingLine.prototype.point = function (index) {
    var n = this.points.length;
    if (this.closed) return this.points[((index % n) + n) % n];
    return this.points[Math.max(0, Math.min(n - 1, index))];
};

// The index of the point nearest to (x, z); with a hint (the last index) only the points around it are looked at
OpenRacer.RacingLine.prototype.nearest = function (x, z, hint) {
    var n = this.points.length;
    if (!n) return 0;
    var best = -1, bestD = Infinity;
    if (hint === undefined || hint === null) {
        for (var i = 0; i < n; i++) {
            var p = this.points[i];
            var d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }
    for (var k = -15; k <= 40; k++) {
        var j = this.closed ? ((hint + k) % n + n) % n : Math.max(0, Math.min(n - 1, hint + k));
        var q = this.points[j];
        var dd = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z);
        if (dd < bestD) { bestD = dd; best = j; }
    }
    // far off the line (a spin, a reset): look everywhere
    if (bestD > 60 * 60) return this.nearest(x, z);
    return best;
};

// How far along the line (0..1) a car at (x, z) is
OpenRacer.RacingLine.prototype.progress = function (x, z, hint) {
    var i = this.nearest(x, z, hint);
    return { index: i, fraction: this.points.length ? i / this.points.length : 0 };
};

// The heights of the points from the road (a GroundWorld or anything with query(x, z, hintY, above))
OpenRacer.RacingLine.prototype.settle = function (ground) {
    if (!ground) return;
    this.points.forEach(function (p) {
        // the surface at the height of the point (a line that was driven or recorded has it): under a bridge that is the road, not the deck above it;
        // a point with no surface near its height (a line drawn flat, at 0) takes the highest one
        var road = (isFinite(p.y) ? ground.query(p.x, p.z, p.y, 1.5) : null) || ground.query(p.x, p.z, 1000, 0);
        if (road) { p.y = road.y; p.surface = road.surface; }
    });
};

// A line drawn along the middle of the road is not the quickest way round: this moves every point sideways, within the road (the ground there is the surface of the
// line, up to 'margin' metres from its edge), to the smoothest line there is (a bend cut, a straight kept straight). The points are probed to either side every half
// metre, up to 'reach' metres; a point with no room (a one-lane stretch, a bridge) stays where it is
OpenRacer.RacingLine.prototype.shorten = function (ground, margin, reach) {
    var n = this.points.length;
    if (!ground || n < 8) return;
    // (the line is the middle of the car: half a car and a little more stay between it and the edge. At 0.8 m the outer wheels ran on the edge, onto the
    // grass and the kerb, and on the circuit an AI car rolled over there at speed)
    margin = margin === undefined ? 1.5 : margin; reach = reach || 6;
    var base = this.points.map(function (p) { return { x: p.x, z: p.z }; });
    var nx = new Float32Array(n), nz = new Float32Array(n), left = new Float32Array(n), right = new Float32Array(n);
    var self = this;
    for (var i = 0; i < n; i++) {
        var a = base[(i + n - 1) % n], b = base[(i + 1) % n];
        var tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
        nx[i] = -tz / tl; nz[i] = tx / tl;                      // to the left of the direction of the line
        var p = this.points[i];
        for (var side = -1; side <= 1; side += 2) {
            var room = 0;
            for (var d = 0.5; d <= reach; d += 0.5) {
                var q = ground.query(base[i].x + nx[i] * d * side, base[i].z + nz[i] * d * side, (p.y || 0) + 0.5, 0.6);
                if (!q || q.surface !== p.surface || Math.abs(q.y - (p.y || 0)) > 0.5) break;
                room = d;
            }
            if (side < 0) right[i] = Math.max(0, room - margin); else left[i] = Math.max(0, room - margin);
        }
    }
    var off = new Float32Array(n);
    for (var it = 0; it < 300; it++) {
        for (var k = 0; k < n; k++) {
            var pa = (k + n - 1) % n, pb = (k + 1) % n;
            var ax = base[pa].x + nx[pa] * off[pa], az = base[pa].z + nz[pa] * off[pa], bx = base[pb].x + nx[pb] * off[pb], bz = base[pb].z + nz[pb] * off[pb];
            var wantX = (ax + bx) / 2 - base[k].x, wantZ = (az + bz) / 2 - base[k].z;
            var want = wantX * nx[k] + wantZ * nz[k];
            off[k] = Math.max(-right[k], Math.min(left[k], off[k] + (want - off[k]) * 0.5));
        }
    }
    for (var m = 0; m < n; m++) { this.points[m].x = base[m].x + nx[m] * off[m]; this.points[m].z = base[m].z + nz[m] * off[m]; }
    this.settle(ground);
};

// The speed a car can have at every point: limited by the bend there (lateral acceleration aLat, m/s^2, on the road; gripOf(surface) gives the share of that
// grip on another surface, sand or grass, when it is given), by the crest there (above the speed at which the car leaves the ground over the top of a dune
// it flies, and lands where the line is not: a little of that is allowed) and by the braking (aBrake, scaled by the grip too) that the slower points ahead ask for
// factorOf (optional): a factor on the speed of the bend at a point (what a driver learned there); the braking before it follows from that speed
// aeroK: the downforce of the car per kg, in 1/m (N per (m/s)² over the mass): the grip grows with the square of the speed (a car with wings was too slow in the
// fast bends, as if it had none); 0 or left out for none
OpenRacer.RacingLine.prototype.computeSpeeds = function (aLat, aBrake, vMax, gripOf, factorOf, aeroK) {
    var n = this.points.length, G = 9.81, self = this, aero = Math.max(0, aeroK || 0);
    var speeds = new Float32Array(n);
    var grip = new Float32Array(n);
    for (var gi = 0; gi < n; gi++) grip[gi] = gripOf ? Math.max(0.25, Math.min(1, gripOf(this.points[gi].surface))) : 1;
    // the height of the line, smoothed over five points (the road is sampled, and bumpy)
    var height = new Float32Array(n);
    for (var hi = 0; hi < n; hi++) { var sum = 0; for (var hk = -2; hk <= 2; hk++) sum += this.point(hi + hk).y || 0; height[hi] = sum / 5; }
    for (var i = 0; i < n; i++) {
        // the curvature from the point before and after (a circle through three points)
        var a = this.point(i - 4), b = this.point(i), c = this.point(i + 4);
        var abx = b.x - a.x, abz = b.z - a.z, bcx = c.x - b.x, bcz = c.z - b.z;
        var cross = abx * bcz - abz * bcx;
        var lab = Math.hypot(abx, abz), lbc = Math.hypot(bcx, bcz), lac = Math.hypot(c.x - a.x, c.z - a.z);
        var curvature = (lab * lbc * lac) > 1e-6 ? Math.abs(2 * cross / (lab * lbc * lac)) : 0;
        // (with downforce: v² · curvature = aLat · grip · (1 + k v² / g), so v² = aLat · grip / (curvature − aLat · grip · k / g); no limit when that is not positive)
        var room = curvature - aLat * grip[i] * aero / G;
        speeds[i] = curvature > 1e-4 && room > 1e-6 ? Math.min(vMax, Math.sqrt(aLat * grip[i] / room)) : vMax;
        // the crest: the second derivative of the height along the line over six metres; the car leaves the ground at sqrt(g / curvature), a hop of 15 % over that is allowed
        var h = 3, d2 = (height[(i + h) % n] - 2 * height[i] + height[((i - h) % n + n) % n]) / ((h * this.step) * (h * this.step));
        if (this.closed && d2 < -1e-4) speeds[i] = Math.min(speeds[i], 1.15 * Math.sqrt(G / -d2));
        if (speeds[i] < 6) speeds[i] = 6;                 // (a bend tighter than that does not exist on a track; a kink of the line is not a reason to crawl)
        if (factorOf) speeds[i] = Math.min(vMax, speeds[i] * factorOf(i));
    }
    // braking: going backwards, a point may not be faster than the next one allows
    var passes = this.closed ? 2 : 1;
    for (var pass = 0; pass < passes; pass++) {
        for (var k = n - 1; k >= 0; k--) {
            var next = this.closed ? (k + 1) % n : Math.min(n - 1, k + 1);
            var allowed = Math.sqrt(speeds[next] * speeds[next] + 2 * aBrake * grip[k] * (1 + aero * speeds[next] * speeds[next] / G) * this.step);
            if (speeds[k] > allowed) speeds[k] = allowed;
        }
    }
    this.speeds = speeds;
    return speeds;
};

// The line through the nodes of a designed track (the middle of the road)
OpenRacer.RacingLine.fromDesign = function (design) {
    if (!design || !design.nodes || design.nodes.length < 3) return null;
    var pts = design.nodes.map(function (n) { return new THREE.Vector3(n.x, n.y, n.z); });
    var curve = new THREE.CatmullRomCurve3(pts, design.closed !== false, "centripetal", 0.5);
    var samples = Math.max(32, Math.round(curve.getLength() / 2));
    var points = [];
    for (var i = 0; i < samples; i++) {
        var p = curve.getPointAt(i / samples);
        points.push({ x: p.x, y: p.y, z: p.z });
    }
    return new OpenRacer.RacingLine(points, design.closed !== false);
};

// The line of a lap that was driven (the samples of a ghost recording: { x, y, z } with the body position)
OpenRacer.RacingLine.fromLap = function (samples) {
    if (!samples || samples.length < 10) return null;
    var line = new OpenRacer.RacingLine(samples.map(function (s) { return { x: s.x, y: s.y, z: s.z }; }), true);
    // A lap is driven, not drawn: it wobbles, and where it is closed (the timing line) the end does not meet the start, since the car crosses the line
    // somewhere else on the road a lap later. As it was, the closing gave the line a kink there, the speed profile read it as a hairpin, and every AI car
    // braked to a crawl just past the start. The line is smoothed (a moving average over 10 m, four times, round the loop), which spreads the step at
    // the joint into a gentle S and takes the wobble out.
    line.smooth(5, 4);
    return line;
};

// The points pulled towards their neighbours: a moving average over the 2 * half + 1 points round each one, passes times (a closed line wraps round)
OpenRacer.RacingLine.prototype.smooth = function (half, passes) {
    var n = this.points.length;
    if (n < 2 * half + 3) return;
    for (var pass = 0; pass < passes; pass++) {
        var next = new Array(n);
        for (var i = 0; i < n; i++) {
            var sx = 0, sy = 0, sz = 0, count = 0;
            for (var k = -half; k <= half; k++) {
                var j = this.closed ? ((i + k) % n + n) % n : Math.max(0, Math.min(n - 1, i + k));
                var p = this.points[j];
                sx += p.x; sy += p.y; sz += p.z; count++;
            }
            next[i] = { x: sx / count, y: sy / count, z: sz / count, s: this.points[i].s };
        }
        this.points = next;
    }
    this.speeds = null;
};

// Saves a lap that was driven as "racing_line" of a track (track.json, through the server of start-server.sh, or else in the garage of
// this browser): every third sample, rounded to centimetres. Gives a promise of the number of points; it fails when nothing can save.
OpenRacer.RacingLine.save = function (track, samples) {
    var line = samples.filter(function (s, i) { return i % 3 === 0; }).map(function (s) {
        return { x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100, z: Math.round(s.z * 100) / 100 };
    });
    var config = JSON.parse(JSON.stringify(track));
    delete config.id;
    config.racing_line = line;
    config.line_date = new Date().toISOString();         // (the laps driven before do not take the place of this line: Records.anyGhost)
    return OpenRacer.Garage.store("tracks", track.id, config, {}, {}).then(function () {
        track.racing_line = line;
        track.line_date = config.line_date;
        return line.length;
    });
};
