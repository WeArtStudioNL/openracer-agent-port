/*
 * Pit.js
 *
 * Description: The pit stop and the pit lane.
 *   - Pit boxes ("pit": { "boxes": [{ x, z, heading }] } in track.json, placed in the track editor): a box of 4 m by 8 m for every player (box 1 is the player's, box 2 to 8 are for the
 *     AI cars in the order of the grid). A car that stands still with all four wheels inside its box (wheels over the box, at least two on the ground) is serviced; a track with fewer boxes than cars lets a car without a box of its own
 *     use any box. OpenRacer.PitStop.BOX_W, BOX_L and boxesOf(track) are for the rest of the game (the markings on the road, the AI).
 *   - PitStop: a car that stands still on the pit lane (the surface "track01") is serviced (without pit boxes): the tank is filled and, when the tyres
 *     are worn enough or one leaks, new tyres go on (the leak is repaired), and with Damage on the car is repaired: its dents go out over the stop. How long it takes depends on what is needed: the fuel goes in at a rate, the tyres take
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
    // the damage (with Damage on): the dents of the shell (2 s and 4 s more for every centimetre that its nodes are out of place on average, at most 14 s), and 3 s for every
    // part that came off and 4 s for every wheel that is bent or torn off; the repair goes side by side with the fuel and the tyres, at most 30 s
    var REPAIR_BASE = 2, REPAIR_PER_CM = 4, REPAIR_DENTS_MAX = 14, REPAIR_PART = 3, REPAIR_WHEEL = 4, REPAIR_MAX = 30;
    var wheelsFrom = null;     // the bends of the wheels when the repair began (they go straight with it)
    this.active = false;       // a stop is going on
    this.done = false;         // the stop is complete (until the car pulls away)
    this.elapsed = 0;
    this.plan = null;          // { fuel, tyres, total }: the seconds that each part takes
    var fuelGiven = 0, tyresDone = false, repaired = false, changed = [];
    var fuelWanted = 0;

    this.holdCar = false;      // the car of the player: once the stop has begun the car is on the jacks and cannot pull away (Car.js holds it, lift() is how far up)
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
        // (a track with a pit area drawn: a stop elsewhere on a road called "track01" is no pit stop)
        var ground = typeof groundWorld !== "undefined" ? groundWorld : null;
        if(ground && ground.hasPitAreas && ground.hasPitAreas() && !ground.inPit(vehicle.x, vehicle.z)) return false;
        return true;
    };

    function repairFor(v) {
        if(OpenRacer.damageEnabled === false) return 0;
        var secs = 0, sb = v.softBody, d = sb && sb.damage ? sb.damage() : null;
        if(d && (d.mean > 0.002 || d.broken > 0)) secs += REPAIR_BASE + Math.min(REPAIR_DENTS_MAX, d.mean * 100 * REPAIR_PER_CM);
        var parts = v.parts && v.parts.parts ? v.parts.parts : [];
        for(var p = 0; p < parts.length; p++) if(parts[p].state !== "held" && parts[p].wheel === undefined) secs += REPAIR_PART;
        for(var i = 0; i < 4; i++) {
            var w = v.wheels[i], lost = v.wheelLost && v.wheelLost[i] && !(v.soloWheels && (i === 1 || i === 3));
            if(lost || (v.wheelDamage && v.wheelDamage[i] > 0.01) || Math.abs(w.toeBend || 0) > 0.002 || Math.abs(w.camberBend || 0) > 0.002) secs += REPAIR_WHEEL;
        }
        return Math.min(REPAIR_MAX, secs);
    }

    function planFor(v) {
        var fuel = (v.tank - v.fuel) / FUEL_RATE;
        if(fuel < 0.05) fuel = 0;            // (a tank that is full but for a rounding: no fuel to give)
        var repair = repairFor(v);
        var worn = v.maxWear();
        // (a tyre that leaks is changed too, however little it is worn: the stop repaired the wear only, and the leak stayed)
        var leaking = v.punctured && v.punctured();
        var tyres = worn > TYRES_WHEN || leaking ? TYRES_MIN + TYRES_PER_WEAR * Math.min(1, worn) : 0;
        // the tyres that are changed: the ones that are worn past the mark or leak, one after the other, each in its share of the time of the tyres
        var change = [];
        if(tyres > 0) for(var i = 0; i < 4; i++) { var w = v.wheels[i]; if(v.soloWheels && (i === 1 || i === 3)) continue; if(w.wear > TYRES_WHEN || w.leak) change.push(i); }
        var work = Math.max(fuel, tyres, repair);
        return { fuel: fuel, tyres: tyres, change: change, repair: repair, work: work, total: LIFT + work + (tyres > 0 || repair > 0 ? LIFT : 0.3) };
    }

    // what a stop would take now, in seconds (for the AI and the HUD)
    this.estimate = function () { return planFor(vehicle).total; };

    this.update = function (dt) {
        if(!vehicle.wearEnabled) { this.active = false; this.done = false; return; }
        // (a car on the jacks is in its box until the stop is done: its wheels are off the ground)
        var still = (this.active && this.holdCar) || (Math.abs(vehicle.u) < 0.4 && this.onPitLane());
        if(!still) {
            if(this.active || this.done) { this.active = false; this.done = false; this.plan = null; }
            return;
        }
        if(this.done) return;
        if(!this.active) {
            this.active = true;
            this.elapsed = 0;
            this.plan = planFor(vehicle);
            fuelGiven = 0; tyresDone = false; changed = [];
            fuelWanted = vehicle.tank - vehicle.fuel;
            if(this.plan.fuel <= 0 && this.plan.tyres <= 0 && this.plan.repair <= 0) { this.done = true; this.active = false; return; }
            repaired = false;
            if(this.plan.repair > 0) {
                if(vehicle.softBody && vehicle.softBody.repairStart) vehicle.softBody.repairStart();
                wheelsFrom = vehicle.wheels.map(function (w) { return { toe: w.toeBend || 0, camber: w.camberBend || 0, x: w.shiftX || 0, z: w.shiftZ || 0 }; });
            }
        }
        this.elapsed += dt;
        var t = this.elapsed - LIFT; // the work starts once the car is up
        if(t > 0) {
            var give = Math.min(fuelWanted, t * FUEL_RATE) - fuelGiven;
            if(give > 0) { vehicle.fuel = Math.min(vehicle.tank, vehicle.fuel + give); fuelGiven += give; }
            // every tyre that is changed gets its new one halfway through its turn (the old wheel is off by then, the new one goes on)
            var list = this.plan.change || [], slot = list.length ? this.plan.tyres / list.length : 0;
            for(var c = 0; c < list.length; c++) if(!changed[c] && t >= slot * (c + 0.5)) { changed[c] = true; vehicle.freshTyre(list[c], 60); }
            if(!tyresDone && this.plan.tyres > 0 && t >= this.plan.tyres) tyresDone = true;
        }
        // the repair: from the start of the work to its end every node of the shell goes back to its place a little more, and the bent wheels go straight; then all is whole
        // (the shell, the beams, the parts back on the car, the wheels, the tyres that leak)
        if(this.plan.repair > 0 && !repaired) {
            var share = Math.max(0, Math.min(1, t / Math.max(0.1, this.plan.work)));
            if(vehicle.softBody && vehicle.softBody.repairTo) vehicle.softBody.repairTo(share);
            if(wheelsFrom) for(var wi = 0; wi < 4; wi++) { var wf = wheelsFrom[wi], wh = vehicle.wheels[wi]; wh.toeBend = wf.toe * (1 - share); wh.camberBend = wf.camber * (1 - share); wh.shiftX = wf.x * (1 - share); wh.shiftZ = wf.z * (1 - share); }
            if(share >= 1) { repaired = true; wheelsFrom = null; vehicle.repair(); }
        }
        if(this.elapsed >= this.plan.total) { this.done = true; this.active = false; vehicle.fuel = Math.min(vehicle.tank, vehicle.fuel); }
    };

    this.remaining = function () { return this.active && this.plan ? Math.max(0, this.plan.total - this.elapsed) : 0; };
    // A wheel that is being changed, for the picture (Car.js, Opponent.js): how far it is pulled out (m) and whether it is off (between the old one and the new one), or null.
    // Its turn: the first 40 % the old wheel comes off and out by 60 cm, then it is gone, the last 40 % the new one goes on.
    this.tyreChange = function (index) {
        if(!this.active || !this.plan || !this.plan.change || !this.plan.change.length) return null;
        var c = this.plan.change.indexOf(index);
        if(c < 0) return null;
        var slot = this.plan.tyres / this.plan.change.length, f = (this.elapsed - LIFT - slot * c) / slot;
        if(f <= 0 || f >= 1) return null;
        var ease = function (x) { return x * x * (3 - 2 * x); };
        if(f < 0.4) return { out: 0.6 * ease(f / 0.4), off: false };
        if(f < 0.6) return { out: 0.6, off: true };
        return { out: 0.6 * ease((1 - f) / 0.4), off: false };
    };
    // how far the car is up on the jacks, 0 to 1: it goes up slowly in the first part of the stop and stays up; when the stop is done it is let go (and falls)
    this.lift = function () { return this.active && this.plan ? Math.min(1, this.elapsed / LIFT) : 0; };
};

// the wheel of a car in the picture while its tyre is changed in a pit stop: pulled out sideways (to the left for the left wheels: x of the car is to the left), hidden
// between the old one and the new one; drawn again where the car has it when it is not being changed
OpenRacer.PitStop.showChange = (function () {
    var side = new THREE.Vector3();
    return function (pit, index, object, quaternion) {
        if(!object) return;
        var change = pit && pit.tyreChange ? pit.tyreChange(index) : null;
        if(!change) { if(object.userData.pitHidden) { object.visible = true; object.userData.pitHidden = false; } return; }
        side.set(index === 1 || index === 2 ? 1 : -1, 0, 0).applyQuaternion(quaternion);
        object.position.addScaledVector(side, change.out);
        if(change.off !== !object.visible || object.userData.pitHidden !== change.off) { object.visible = !change.off; object.userData.pitHidden = change.off; }
    };
})();

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
        // where a point is: the index of the racing line it is nearest to, and how far to the left of the line it lies
        var hint = null;
        function placeOf(c) {
            var i = line.nearest(c.x, c.z, hint);
            hint = i;
            var p = line.point(i), q = line.point(i + 1), tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
            return { index: i, left: (-(c.x - p.x) * tz + (c.z - p.z) * tx) / tl, dist: Math.hypot(p.x - c.x, p.z - c.z) };
        }
        // the pit-lane road beside the track (a track with a pit area drawn: walk, below; else all of that road along the line)
        var placed = centroids.map(function (c) { var at = placeOf(c); at.c = c; return at; }).filter(function (at) { return at.dist <= 60; });     // (not beside the track: not the lane)
        var inArea = placed.filter(function (at) { return at.c.area; });
        var points, ordered;
        if(inArea.length) {
            points = OpenRacer.PitLane.walk(placed, inArea, n, placeOf, ground, line);
            if(points.length < 3) return null;
            ordered = points.map(function (p) { return p.index; });
        } else {
            // the centroids by the index of the racing line they are nearest to
            var byIndex = {};
            placed.forEach(function (at) {
                var i = at.index, c = at.c;
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
            ordered = indices.slice(start).concat(indices.slice(0, start));
            points = ordered.map(function (i) { var b = byIndex[i]; return { x: b.x / b.k, y: b.y / b.k, z: b.z / b.k, index: i }; });
        }
        // smoothed, so the AI does not weave over the triangles
        var smooth = points.map(function (p, i) {
            var a = points[Math.max(0, i - 1)], c = points[Math.min(points.length - 1, i + 1)];
            return { x: (a.x + p.x + c.x) / 3, y: p.y, z: (a.z + p.z + c.z) / 3, index: p.index };
        });
        var stopAt = Math.floor(smooth.length / 2);
        if(inArea.length) {
            var middle = inArea.map(function (at) { return at.index; }).sort(function (a, b) { return ((a - ordered[0]) % n + n) % n - ((b - ordered[0]) % n + n) % n; })[Math.floor(inArea.length / 2)];
            var apart = function (a, b) { var d = ((a - b) % n + n) % n; return Math.min(d, n - d); };
            smooth.forEach(function (p, i) { if(apart(p.index, middle) < apart(smooth[stopAt].index, middle)) stopAt = i; });
        }
        return {
            points: smooth,
            entry: ordered[0],                                    // the index of the racing line where it starts
            exit: ordered[ordered.length - 1],                    // ... and ends
            stop: stopAt,                                         // the point to stop at (the middle of the pit area, else of the lane)
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
    },

    // The lane of a track with a pit area drawn (track.json "pit"). Through the area: the middle of it. Out of it, both ways along the racing line: the pit-lane road ("track01")
    // that goes on from the point before (within 8 m to the side of it, two metres on, no wall in between; the nearest in line first), until it has joined the track (8 m from the line). Only on the
    // side of the area: the road of Circuit is "track01" on both sides of the straight, and in many kerbs. (An average of all of it per point of the line ran a kilometre,
    // from the right of the road to the grass on its left; with the side kept, it followed a dead end beside the pit exit into the wall, a strip painted across the road, and
    // a strip on the other side of the pit wall; an AI that went in got stuck there.)
    walk: function (placed, inArea, n, placeOf, ground, line) {
        // a wall between two points (a triangle that stands up out of the road, at the height of a car), looked for every metre: a branch behind a wall is not the
        // road on (beside the pit lane of Circuit runs a strip of "track01" on the other side of the pit wall, and the lane went along that, into the wall at its end)
        var probe = [], nearest = {};
        function blocked(a, b, room) {
            var r = room || 0.6;
            if(!ground.nearby || !ground.closest) return false;
            var steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
            for(var s = 0; s <= steps; s++) {
                var x = a.x + (b.x - a.x) * s / steps, z = a.z + (b.z - a.z) * s / steps, y = a.y + (b.y - a.y) * s / steps;
                var under = ground.query(x, z, y + 2, 4), h = (under ? under.y : y) + 0.9;
                ground.nearby(x, h, z, r, probe);
                for(var t = 0; t < probe.length; t++) if(ground.closest(probe[t], x, h, z, nearest) < r * r && nearest.y > h - 0.6) return true;
            }
            return false;
        }
        var side = inArea.reduce(function (sum, at) { return sum + at.left; }, 0) >= 0 ? 1 : -1;
        var area = {}, road = {};
        inArea.forEach(function (at) { (area[at.index] = area[at.index] || []).push(at); });
        placed.forEach(function (at) { if(!at.c.area && at.left * side > 3) (road[at.index] = road[at.index] || []).push(at); });
        var wrap = function (i) { return ((i % n) + n) % n; };
        var mean = function (list) {
            var x = 0, y = 0, z = 0, left = 0;
            list.forEach(function (at) { x += at.c.x; y += at.c.y; z += at.c.z; left += at.left; });
            return { x: x / list.length, y: y / list.length, z: z / list.length, left: left / list.length };
        };
        // the stretch of the line beside the area (a gap of a few points within it is still the area)
        var seed = inArea[Math.floor(inArea.length / 2)].index, from = seed, to = seed, miss, i;
        for(miss = 0, i = seed - 1; miss <= 3 && seed - i < n / 2; i--) { if(area[wrap(i)]) { from = wrap(i); miss = 0; } else miss++; }
        for(miss = 0, i = seed + 1; miss <= 3 && i - seed < n / 2; i++) { if(area[wrap(i)]) { to = wrap(i); miss = 0; } else miss++; }
        // through the area: the free part of it (2 m from a wall or a building in it: the middle of the area of Circuit runs through one), and of two free strips side by
        // side the one nearest to the track at the start, the fast lane, and then the one that goes on from it
        // (with the pit-lane road beside the area too: on Circuit the area is narrow there, and the lane is wider than it)
        var middle = [];
        for(i = from; ; i = wrap(i + 1)) {
            var free = (area[i] || []).concat(road[i] || []).filter(function (at) { return !blocked(at.c, at.c, 2); }).sort(function (a, b) { return a.left - b.left; });
            var strips = free.length ? [[free[0]]] : [];
            for(var f = 1; f < free.length; f++) { if(free[f].left - free[f - 1].left > 3.5) strips.push([]); strips[strips.length - 1].push(free[f]); }
            var before = middle[middle.length - 1];
            strips = strips.filter(function (st) { return st.some(function (at) { return at.c.area; }) && (!before || !blocked(before, mean(st))); });
            if(strips.length) {
                // (the first the one nearest to the track, after that the one in line with the point before)
                var score = function (st) { return before ? Math.abs(mean(st).left - before.left) : Math.abs(mean(st).left); };
                var strip = strips.reduce(function (a, b) { return score(b) < score(a) ? b : a; });
                var m = mean(strip); m.index = i;
                if(!blocked(m, m, 1.2) && (!before || !blocked(before, m))) middle.push(m);        // (the middle of a strip can be on a wall in it)
            }
            if(i === to) break;
        }
        if(!middle.length) return [];
        // out of the area: the road that goes on (a branch side by side with another is the one in line with the point before); a branch that ends without joining the
        // track (a dead end, a strip behind a wall) is left, and the search goes back to the fork for the other branch
        function out(step, start, left, last) {
            var seen = {}, longest = [];
            function search(k, last, left, gone, path) {
                if(k >= n / 2 || gone > 6) return null;
                var at = wrap(start + step * k), key = at + "," + Math.round(left / 2);
                if(seen[key]) return null;
                seen[key] = true;
                var near = (road[at] || []).filter(function (r) { return Math.abs(r.left - left) < 8; });
                // the branches: the points side by side, split where there is more than 2.5 m between them, and not behind a wall
                near.sort(function (a, b) { return a.left - b.left; });
                var branches = near.length ? [[near[0]]] : [];
                for(var q = 1; q < near.length; q++) { if(near[q].left - near[q - 1].left > 2.5) branches.push([]); branches[branches.length - 1].push(near[q]); }
                var middleOf = function (list) { return list.reduce(function (sum, r) { return sum + r.left; }, 0) / list.length; };
                branches = branches.filter(function (b) { return !blocked(last, mean(b)); });
                branches.sort(function (a, b) { return Math.abs(middleOf(a) - left) - Math.abs(middleOf(b) - left); });
                for(var b = 0; b < branches.length; b++) {
                    var p = mean(branches[b]); p.index = at;
                    var l = placeOf(p).left, next = path.concat([p]);
                    if(next.length > longest.length) longest = next;
                    if(Math.abs(l) < 8 && !blocked(p, line.point(at))) return next;        // joined the track (no pit wall in between)
                    var found = search(k + 1, p, l, 0, next);
                    if(found) return found;
                }
                return search(k + 1, last, left, gone + 1, path);
            }
            var found = search(1, last, left, 0, []);
            return { path: found || longest, joined: !!found };
        }
        // (from the last point of the area, or one before it when the road on is not to be found from there: the end of the area of Circuit is against a wall)
        function leave(step) {
            var tries = Math.min(10, middle.length - 1), best = null;
            for(var t = 0; t <= tries; t++) {
                var k = step > 0 ? middle.length - 1 - t : t, from = middle[k], way = out(step, from.index, placeOf(from).left, from);
                if(!best) best = { k: k, path: way.path };
                if(way.joined) return { k: k, path: way.path };
            }
            return best;
        }
        var exit = leave(1);
        middle = middle.slice(0, exit.k + 1);
        var entry = leave(-1);
        middle = middle.slice(entry.k);
        return entry.path.reverse().concat(middle, exit.path);
    }
};
