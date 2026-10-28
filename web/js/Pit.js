/*
 * Pit.js
 *
 * Description: The pit stop and the pit lane.
 *   - Pit boxes ("pit": { "boxes": [{ x, z, heading }] } in track.json, placed in the track editor): a box of 4 m by 8 m for every player (box 1 is the player's, box 2 to 8 are for the
 *     AI cars in the order of the grid). A car that stands still with all four wheels inside its box (wheels over the box, at least two on the ground) is serviced; a track with fewer boxes than cars lets a car without a box of its own
 *     use any box. OpenRacer.PitStop.BOX_W, BOX_L and boxesOf(track) are for the rest of the game (the markings on the road, the AI).
 *   - PitStop: a car that stands still on the pit lane (the surface "track01") is serviced (without pit boxes): the tank is filled and, when the tyres
 *     are worn enough, new tyres go on. How long it takes depends on what is needed: the fuel goes in at a rate, the tyres take
 *     longer the more worn they are, and the two happen side by side with a moment to lift and drop the car. A car that pulls
 *     away early keeps what was done so far.
 *   - PitLane: the line through the pit lane for the AI (Opponent.js), found from the triangles of the pit lane surface and the
 *     racing line: where it starts and ends along the racing line, the points to drive through, and where to stop.
 */

OpenRacer.PitStop = function (vehicle) {
    var FUEL_RATE = 6;         // litres per second
    var LIFT = 1.2;            // seconds to lift the car and to drop it
    var TYRES_MIN = 2.5, TYRES_PER_WEAR = 5;  // seconds for the tyres: the more worn, the longer
    var TYRES_WHEN = 0.15;     // the tyres are changed when the most worn one is past this
    this.active = false;       // a stop is going on
    this.done = false;         // the stop is complete (until the car pulls away)
    this.elapsed = 0;
    this.plan = null;          // { fuel, tyres, total }: the seconds that each part takes
    var fuelGiven = 0, tyresDone = false;
    var fuelWanted = 0;

    this.boxes = [];           // the pit boxes of the track (OpenRacer.PitStop.boxesOf), set by the game
    this.boxIndex = -1;        // the box of this car: its place in the list (the player 0, the AI cars from 1); -1: any box
    this.box = null;           // the box that the car stands in
    // are all four wheels inside a box (a rectangle BOX_L long in the direction of its heading and BOX_W wide, a little room round it)?
    function inside(b, wheels) {
        var c = Math.cos(b.heading), s = Math.sin(b.heading);
        var touching = 0;
        for(var i = 0; i < 4; i++) {
            if(!wheels[i].center) return false;
            if(wheels[i].hasContact) touching++;
            var dx = wheels[i].center.x - b.x, dz = wheels[i].center.z - b.z;
            if(Math.abs(dx * c + dz * s) > OpenRacer.PitStop.BOX_L / 2 + 0.25 || Math.abs(-dx * s + dz * c) > OpenRacer.PitStop.BOX_W / 2 + 0.25) return false;
        }
        return touching >= 2;                 // (a wheel can be off the ground for a moment on uneven ground; a car in the air is not in the box)
    }
    var self = this;
    this.onPitLane = function () {
        var w = vehicle.wheels;
        if(self.boxes && self.boxes.length) {
            self.box = null;
            var own = self.boxIndex >= 0 ? self.boxes[self.boxIndex] : null;
            var list = own ? [own] : self.boxes;
            for(var k = 0; k < list.length; k++) if(inside(list[k], w)) { self.box = list[k]; return true; }
            return false;
        }
        for(var i = 0; i < 4; i++) if(!w[i].hasContact || w[i].surface !== "track01") return false;
        return true;
    };

    function planFor(v) {
        var fuel = (v.tank - v.fuel) / FUEL_RATE;
        var worn = v.maxWear();
        var tyres = worn > TYRES_WHEN ? TYRES_MIN + TYRES_PER_WEAR * Math.min(1, worn) : 0;
        return { fuel: fuel, tyres: tyres, total: LIFT + Math.max(fuel, tyres) + (tyres > 0 ? LIFT : 0.3) };
    }

    // what a stop would take now, in seconds (for the AI and the HUD)
    this.estimate = function () { return planFor(vehicle).total; };

    this.update = function (dt) {
        if(!vehicle.wearEnabled) { this.active = false; this.done = false; return; }
        var still = Math.abs(vehicle.u) < 0.4 && this.onPitLane();
        if(!still) {
            if(this.active || this.done) { this.active = false; this.done = false; this.plan = null; }
            return;
        }
        if(this.done) return;
        if(!this.active) {
            this.active = true;
            this.elapsed = 0;
            this.plan = planFor(vehicle);
            fuelGiven = 0; tyresDone = false;
            fuelWanted = vehicle.tank - vehicle.fuel;
            if(this.plan.fuel <= 0 && this.plan.tyres <= 0) { this.done = true; this.active = false; return; }
        }
        this.elapsed += dt;
        var t = this.elapsed - LIFT; // the work starts once the car is up
        if(t > 0) {
            var give = Math.min(fuelWanted, t * FUEL_RATE) - fuelGiven;
            if(give > 0) { vehicle.fuel = Math.min(vehicle.tank, vehicle.fuel + give); fuelGiven += give; }
            if(!tyresDone && this.plan.tyres > 0 && t >= this.plan.tyres) { tyresDone = true; vehicle.freshTyres(60); }
        }
        if(this.elapsed >= this.plan.total) { this.done = true; this.active = false; vehicle.fuel = Math.min(vehicle.tank, vehicle.fuel); }
    };

    this.remaining = function () { return this.active && this.plan ? Math.max(0, this.plan.total - this.elapsed) : 0; };
};

OpenRacer.PitStop.BOX_W = 4;      // m: the width of a pit box
OpenRacer.PitStop.BOX_L = 8;      // m: its length
// the pit boxes of a track.json: [{ x, z, heading }] (heading in radians, as the grid has it: from +x towards +z); empty without
OpenRacer.PitStop.boxesOf = function (track) {
    var list = track && track.pit && Array.isArray(track.pit.boxes) ? track.pit.boxes : [];
    return list.filter(function (b) { return b && isFinite(b.x) && isFinite(b.z); }).slice(0, 8).map(function (b) { return { x: b.x, z: b.z, heading: isFinite(b.heading) ? b.heading : 0 }; });
};

// The pit line of the AI ("pit": { "line": [[x, z], ...] } in track.json, drawn in the track editor with the Pit line tool): a path of its own from the racing line, through the pit
// lane past the pit boxes, and back to the racing line. The AI cars that stop follow it at a slow speed, brake for the stop at their box (the point of the line that is nearest to
// the middle of the box) and go on along it to its end. It is a smooth curve through the points, sampled every metre.
OpenRacer.PitPath = {
    boxesOnly: false,
    pointsOf: function (track) {
        var list = track && track.pit && Array.isArray(track.pit.line) ? track.pit.line : [];
        return list.filter(function (q) { return Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]); }).map(function (q) { return { x: q[0], z: q[1] }; });
    },
    build: function (points, racingLine) {
        if(!points || points.length < 2) return null;
        // a Catmull-Rom curve through the points, walked in pieces of a few centimetres and then taken every metre
        function cr(p0, p1, p2, p3, t) {
            var t2 = t * t, t3 = t2 * t;
            return { x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                     z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3) };
        }
        var fine = [];
        for(var i = 0; i < points.length - 1; i++) {
            var p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
            var steps = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / 0.25));
            for(var k = 0; k < steps; k++) fine.push(cr(p0, p1, p2, p3, k / steps));
        }
        fine.push({ x: points[points.length - 1].x, z: points[points.length - 1].z });
        var samples = [fine[0]], carried = 0;
        for(var j = 1; j < fine.length; j++) {
            carried += Math.hypot(fine[j].x - fine[j - 1].x, fine[j].z - fine[j - 1].z);
            if(carried >= 1) { samples.push(fine[j]); carried = 0; }
        }
        if(Math.hypot(samples[samples.length - 1].x - fine[fine.length - 1].x, samples[samples.length - 1].z - fine[fine.length - 1].z) > 0.3) samples.push(fine[fine.length - 1]);
        var count = samples.length;
        var path = {
            count: count, step: 1, points: samples,
            entry: racingLine ? racingLine.nearest(samples[0].x, samples[0].z) : 0,            // the place on the racing line where the pit line starts
            exit: racingLine ? racingLine.nearest(samples[count - 1].x, samples[count - 1].z) : 0,
            point: function (i) { return samples[Math.max(0, Math.min(count - 1, i))]; },
            // the sample nearest to a place (round a hint when there is one, else everywhere)
            nearest: function (x, z, hint) {
                var from = 0, to = count - 1;
                if(hint !== undefined && hint !== null) { from = Math.max(0, hint - 25); to = Math.min(count - 1, hint + 40); }
                var best = from, bestD = Infinity;
                for(var q = from; q <= to; q++) { var d = (samples[q].x - x) * (samples[q].x - x) + (samples[q].z - z) * (samples[q].z - z); if(d < bestD) { bestD = d; best = q; } }
                return best;
            }
        };
        return path;
    }
};

// The pit lane for the AI, from the ground (Ground.js) and the racing line (RacingLine.js). null when the track has no pit lane.
OpenRacer.PitLane = {
    build: function (ground, line) {
        if(!ground || !line || !ground.centroidsOf) return null;
        var centroids = ground.centroidsOf("track01");
        if(centroids.length < 6) return null;
        var n = line.count();
        // the centroids by the index of the racing line they are nearest to
        var byIndex = {};
        var hint = null;
        centroids.forEach(function (c) {
            var i = line.nearest(c.x, c.z, hint);
            hint = i;
            var p = line.point(i);
            if(Math.hypot(p.x - c.x, p.z - c.z) > 60) return; // not beside the track
            if(!byIndex[i]) byIndex[i] = { x: 0, y: 0, z: 0, k: 0 };
            byIndex[i].x += c.x; byIndex[i].y += c.y; byIndex[i].z += c.z; byIndex[i].k++;
        });
        var indices = Object.keys(byIndex).map(Number).sort(function (a, b) { return a - b; });
        if(indices.length < 3) return null;
        // the lane is one stretch along the line: it starts after the biggest gap (around the end of the line too)
        var start = 0, biggest = -1;
        for(var k = 0; k < indices.length; k++) {
            var next = indices[(k + 1) % indices.length];
            var gap = ((next - indices[k]) % n + n) % n;
            if(gap > biggest) { biggest = gap; start = (k + 1) % indices.length; }
        }
        var ordered = indices.slice(start).concat(indices.slice(0, start));
        var points = ordered.map(function (i) { var b = byIndex[i]; return { x: b.x / b.k, y: b.y / b.k, z: b.z / b.k, index: i }; });
        // smoothed, so the AI does not weave over the triangles
        var smooth = points.map(function (p, i) {
            var a = points[Math.max(0, i - 1)], c = points[Math.min(points.length - 1, i + 1)];
            return { x: (a.x + p.x + c.x) / 3, y: p.y, z: (a.z + p.z + c.z) / 3, index: p.index };
        });
        return {
            points: smooth,
            entry: ordered[0],                                    // the index of the racing line where it starts
            exit: ordered[ordered.length - 1],                    // ... and ends
            stop: Math.floor(smooth.length / 2),                  // the point to stop at (the middle of the lane)
            length: ordered.length * line.step,
            // the point of the lane for an index of the racing line (the nearest one)
            pointAt: function (index) {
                var best = 0, bestD = Infinity;
                for(var i = 0; i < smooth.length; i++) {
                    var d = ((smooth[i].index - index) % n + n) % n;
                    d = Math.min(d, n - d);
                    if(d < bestD) { bestD = d; best = i; }
                }
                return smooth[best];
            },
            // whether an index of the racing line is within the stretch of the lane
            covers: function (index) {
                var span = ((this.exit - this.entry) % n + n) % n;
                var at = ((index - this.entry) % n + n) % n;
                return at <= span;
            }
        };
    }
};
