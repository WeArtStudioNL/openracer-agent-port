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
        var road = ground.query(p.x, p.z, 1000, 0);
        if (road) p.y = road.y;
    });
};

// The speed a car can have at every point: limited by the bend there (lateral acceleration aLat, m/s^2) and by the braking (aBrake)
// that the slower points ahead ask for
OpenRacer.RacingLine.prototype.computeSpeeds = function (aLat, aBrake, vMax) {
    var n = this.points.length;
    var speeds = new Float32Array(n);
    for (var i = 0; i < n; i++) {
        // the curvature from the point before and after (a circle through three points)
        var a = this.point(i - 2), b = this.point(i), c = this.point(i + 2);
        var abx = b.x - a.x, abz = b.z - a.z, bcx = c.x - b.x, bcz = c.z - b.z;
        var cross = abx * bcz - abz * bcx;
        var lab = Math.hypot(abx, abz), lbc = Math.hypot(bcx, bcz), lac = Math.hypot(c.x - a.x, c.z - a.z);
        var curvature = (lab * lbc * lac) > 1e-6 ? Math.abs(2 * cross / (lab * lbc * lac)) : 0;
        speeds[i] = curvature > 1e-4 ? Math.min(vMax, Math.sqrt(aLat / curvature)) : vMax;
    }
    // braking: going backwards, a point may not be faster than the next one allows
    var passes = this.closed ? 2 : 1;
    for (var pass = 0; pass < passes; pass++) {
        for (var k = n - 1; k >= 0; k--) {
            var next = this.closed ? (k + 1) % n : Math.min(n - 1, k + 1);
            var allowed = Math.sqrt(speeds[next] * speeds[next] + 2 * aBrake * this.step);
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
    return new OpenRacer.RacingLine(samples.map(function (s) { return { x: s.x, y: s.y, z: s.z }; }), true);
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
    return OpenRacer.Garage.store("tracks", track.id, config, {}, {}).then(function () {
        track.racing_line = line;
        return line.length;
    });
};
