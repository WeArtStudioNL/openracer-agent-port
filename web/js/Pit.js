/*
 * Pit.js
 *
 * Description: The pit stop and the pit lane.
 *   - PitStop: a car that stands still on the pit lane (the surface "track01") is serviced: the tank is filled and, when the tyres
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

    this.onPitLane = function () {
        var w = vehicle.wheels;
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
