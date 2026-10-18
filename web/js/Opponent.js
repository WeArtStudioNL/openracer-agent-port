/*
 * Opponent.js
 *
 * Description: An AI car: the same physics as the player's car (Vehicle.js) with the same model, driven by a driver that follows the
 *              racing line (RacingLine.js). The driver looks ahead on the line (further the faster it goes) and steers at that point,
 *              keeps to the speed that the line allows there, brakes for the bends ahead, moves aside for a car in front and backs off
 *              when it is right behind one. The assists are on and the gearbox is automatic. The cars bump into each other
 *              (collideCars). The difficulty sets how close to the limit of the tyres it drives.
 */

OpenRacer.vehicleParams = function (config, getSurface) {
    var chassis = config.chassis, drivetrain = config.drivetrain, dimensions = config.dimensions;
    return {
        mass: chassis.mass, wheelbase: chassis.wheelbase, front_track: chassis.front_track, rear_track: chassis.rear_track,
        weight_distribution: chassis.weight_distribution, cgHeight: chassis.cg_height, roll_front: chassis.roll_front,
        spring_front: chassis.spring_front, spring_rear: chassis.spring_rear, damping_front: chassis.damping_front, damping_rear: chassis.damping_rear,
        downforce: chassis.downforce, downforce_front: chassis.downforce_front, downforce_rear: chassis.downforce_rear, ackermann: chassis.ackermann,
        roll_center_front: chassis.roll_center_front, roll_center_rear: chassis.roll_center_rear, camber_front: chassis.camber_front, camber_rear: chassis.camber_rear, roll_camber: chassis.roll_camber,
        tire_diameter: chassis.tire_diameter, width: dimensions.width, length: dimensions.length, height: dimensions.height,
        Cdrag: 0.5 * chassis.drag_coefficient * dimensions.width * dimensions.height * 0.85 * 1.29,
        gear_ratios: drivetrain.gear_ratios.slice(), reverse_ratio: drivetrain.reverse_ratio, final_drive: drivetrain.final_drive, efficiency: drivetrain.efficiency,
        shift_time: drivetrain.shift_time,
        drive: drivetrain.drive, diff: drivetrain.diff, diff_preload: drivetrain.diff_preload, diff_lock: drivetrain.diff_lock, diff_power: drivetrain.diff_power,
        diff_coast: drivetrain.diff_coast, center_diff: drivetrain.center_diff, center_split: drivetrain.center_split,
        engine: config.engine, brake_front: config.brakes && config.brakes.front, brake_rear: config.brakes && config.brakes.rear,
        tank: config.fuel && config.fuel.tank, getSurface: getSurface
    };
};

OpenRacer.Opponent = function (config, line, options) {
    var self = this;
    options = options || {};
    this.name = options.name || config.name || config.id;
    this.config = config;
    this.line = line;
    this.skill = options.skill === undefined ? 0.85 : options.skill;    // the part of the grip of the tyres that the driver uses (0.6..1)
    this.color = options.color || null;

    // the controls that the physics reads (the same fields as the player's car)
    this.throttle = 0; this.brakePedal = 0; this.clutch = 0; this.clutchPedalPresent = false; this.handbrake = false;
    this.turnAngle = 0; this.neutral = false; this.reverse = false; this.manualGearbox = false; this.current_gear = 0; this.parkingLock = false;
    this.maxTurn = (config.chassis.max_steer_deg || 30) * Math.PI / 180;

    this.vehicle = new OpenRacer.Vehicle(OpenRacer.vehicleParams(config, getSurface), this);
    this.vehicle.collision = collisionWorld;
    this.vehicle.ground = groundWorld;
    this.vehicle.tcEnabled = true;
    this.vehicle.absEnabled = true;
    this.vehicle.escEnabled = true;
    this.wheels = this.vehicle.wheels;
    this.body = new THREE.Object3D();
    this.loaded = false;
    this.steeringWheel = null;
    var modelMid = null;
    var speeds = line ? line.computeSpeeds(9.81 * 1.05 * this.skill, 9.81 * 0.9 * this.skill, 90) : null;

    // lap and position
    this.lineIndex = line ? line.nearest(0, 0) : 0;
    this.progress = 0;           // laps + the part of the lap: the race position is sorted by this
    this.lapsCompleted = 0;
    this.lapTimes = [];
    this.clock = 0;
    this.lapStart = 0;
    this.held = false;           // on the grid, before the start (the race holds it)
    this.finished = false;       // the race is done: it slows down and pulls aside
    this.raceLaps = 0;           // the laps of the race (0: no end), for the decision to pit
    this.pitLane = null;         // the pit lane of the track (Pit.js), when it has one
    this.pit = new OpenRacer.PitStop(this.vehicle);
    this.pitting = false;        // on its way through the pit lane
    this.pitStops = 0;
    var fuelAtLapStart = null, fuelPerLap = null;
    var lastFraction = 0;
    var maxFraction = 0;

    OpenRacer.loadCarModel(config, function (model) {
        self.body.add(model.tilt);
        scene.add(self.body);
        self.steeringWheel = model.steeringWheel || null;
        self.rig = model.rig || null;
        for (var i = 0; i < 4; i++) {
            self.wheels[i].object = model.wheels[i];
            scene.add(model.wheels[i]);
        }
        if (self.color) {
            // another colour for the body, so the cars can be told apart
            model.tilt.traverse(function (child) {
                if (!child.isMesh) return;
                var materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(function (m) {
                    if (m.color && (m.name === "" || /body|paint|car|lak/i.test(m.name) || materials.length === 1)) {
                        var copy = m.clone();
                        copy.color.set(self.color);
                        if (Array.isArray(child.material)) child.material[materials.indexOf(m)] = copy; else child.material = copy;
                    }
                });
            });
        }
        if (model.measured) {
            var c = model.measured.centres;
            var wheelbase = (c.FR.z + c.FL.z) / 2 - (c.RL.z + c.RR.z) / 2;
            var frontTrack = Math.abs(c.FR.x - c.FL.x), rearTrack = Math.abs(c.RR.x - c.RL.x);
            if (wheelbase > 1.2 && wheelbase < 5 && frontTrack > 0.6 && rearTrack > 0.6 && model.measured.diameter > 0.3) {
                self.vehicle.retune({ wheelbase: wheelbase, front_track: frontTrack, rear_track: rearTrack, tire_diameter: model.measured.diameter });
                modelMid = new THREE.Vector3((c.FR.x + c.FL.x + c.RL.x + c.RR.x) / 4, (c.FR.y + c.FL.y + c.RL.y + c.RR.y) / 4, (c.FR.z + c.FL.z + c.RL.z + c.RR.z) / 4);
            }
        }
        self.bodyLift = model.bodyLift;
        self.loaded = true;
        if (self.pending) { self.place(self.pending.x, self.pending.z, self.pending.heading); self.pending = null; }
    }, function (message) { console.error("Opponent: " + message); });

    this.place = function (x, z, heading) {
        if (!this.loaded) { this.pending = { x: x, z: z, heading: heading }; return; }
        this.vehicle.reset(x, z, heading);
        this.throttle = this.brakePedal = this.turnAngle = 0;
        this.current_gear = 0;
        this.lineIndex = line ? line.nearest(x, z) : 0;
        lastFraction = line ? line.fractionOf(this.lineIndex) : 0;
        maxFraction = 0;
        this.lapStart = this.clock;
        this.updateVisuals();
    };

    // ---- the driver
    var smoothSteer = 0;
    var aside = 0;               // how far to the side of the line it drives (m), to pass a car
    var asideTarget = 0;
    this.drive = function (delta, others) {
        var v = this.vehicle;
        if (!line || !speeds) { this.throttle = 0; this.brakePedal = 1; return; }
        if (this.held) { this.throttle = 0; this.brakePedal = 1; this.turnAngle = 0; this.stuck = 0; return; }
        var speed = Math.max(0, v.u);
        this.lineIndex = line.nearest(v.x, v.z, this.lineIndex);
        var n = line.count();

        // the car ahead: move aside for it, and do not run into it
        var ahead = null, aheadDist = Infinity;
        for (var k = 0; k < others.length; k++) {
            var o = others[k];
            if (o === v) continue;
            var dx = o.x - v.x, dz = o.z - v.z;
            var forward = Math.cos(v.psi), side = Math.sin(v.psi);
            var along = dx * forward + dz * side;              // in front of us
            var across = -dx * side + dz * forward;             // to the left
            if (along > 0 && along < 22 && Math.abs(across) < 3.2 && along < aheadDist) { ahead = { along: along, across: across, u: o.u }; aheadDist = along; }
        }
        asideTarget = 0;
        var holdBack = 1;
        if (ahead) {
            asideTarget = (ahead.across > 0 ? -1 : 1) * 2.6;
            var gap = ahead.along - 4.5;
            if (gap < 2 + speed * 0.15 && ahead.u < speed + 1) holdBack = Math.max(0.2, gap / (2 + speed * 0.15));
        }
        if (this.finished) asideTarget = -3; // done: to the right, out of the way

        // the pit: in when the tyres are worn or the fuel will not last, through the lane at a walking pace, a stop in the middle
        var lane = this.pitLane, inLane = false, atStop = false;
        if (lane && v.wearEnabled) {
            var lapsLeft = this.raceLaps ? this.raceLaps - this.lapsCompleted : 99;
            var fuelNeeded = fuelPerLap !== null ? fuelPerLap * (lapsLeft + 0.4) : v.tank * 0.12;
            var need = !this.finished && lapsLeft >= 1 && ((v.maxWear() > 0.75 && lapsLeft >= 2) || v.fuel < fuelNeeded);
            var toEntry = ((lane.entry - this.lineIndex) % n + n) % n * line.step;
            if (!this.pitting && need && toEntry < 60) this.pitting = true;
            if (this.pitting) {
                inLane = lane.covers(this.lineIndex) || toEntry < 60;
                if (!inLane) { this.pitting = false; this.pitStops++; }
                else {
                    asideTarget = 0;
                    var stopIndex = lane.points[lane.stop].index;
                    var span = ((lane.exit - lane.entry) % n + n) % n, at = ((this.lineIndex - lane.entry) % n + n) % n, stopAt = ((stopIndex - lane.entry) % n + n) % n;
                    if (at <= span && at >= stopAt - 1 && at <= stopAt + 2 && !this.pit.done) atStop = true;
                }
            }
        }
        aside += (asideTarget - aside) * Math.min(1, delta / 0.7);

        // the point to steer at: ahead on the line, further the faster
        var look = Math.max(7, Math.min(35, 3 + speed * 0.75));
        var target = line.point(this.lineIndex + Math.round(look / line.step));
        var next = line.point(this.lineIndex + Math.round(look / line.step) + 1);
        if (inLane) {
            look = Math.max(5, Math.min(14, 3 + speed * 0.6));
            target = lane.pointAt(this.lineIndex + Math.round(look / line.step));
            next = lane.pointAt(this.lineIndex + Math.round(look / line.step) + 1);
        }
        var tx = next.x - target.x, tz = next.z - target.z, tl = Math.hypot(tx, tz) || 1;
        var ax = target.x - (tz / tl) * aside, az = target.z + (tx / tl) * aside; // to the left of the line
        var dxT = ax - v.x, dzT = az - v.z;
        var wanted = Math.atan2(dzT, dxT) - v.psi;
        while (wanted > Math.PI) wanted -= 2 * Math.PI;
        while (wanted < -Math.PI) wanted += 2 * Math.PI;
        // pure pursuit: the steering angle that makes the car reach the point
        var dist = Math.hypot(dxT, dzT);
        var steer = Math.atan2(2 * v.wheelbase * Math.sin(wanted), Math.max(dist, 1));
        steer = Math.max(-this.maxTurn, Math.min(this.maxTurn, steer));
        smoothSteer += (steer - smoothSteer) * Math.min(1, delta / 0.08);
        this.turnAngle = smoothSteer;

        // the speed the line allows here and a little ahead (the brakes need a moment)
        var allowed = Infinity;
        for (var j = 0; j <= 4; j++) allowed = Math.min(allowed, speeds[((this.lineIndex + j) % n + n) % n]);
        allowed *= holdBack;
        if (inLane) allowed = Math.min(allowed, 16);        // the pit lane: slowly
        if (atStop) allowed = 0;                            // at the box, until the stop is done
        if (this.finished) allowed = 0; // slows down and stops
        var error = allowed - speed;
        if (error > 0.5) { this.throttle = Math.min(1, 0.3 + error * 0.25); this.brakePedal = 0; }
        else if (error < -0.5) { this.throttle = 0; this.brakePedal = Math.min(1, -error * 0.18); }
        else { this.throttle = 0.15 + error * 0.2; this.brakePedal = 0; }
        if (this.finished || atStop) { this.throttle = 0; this.brakePedal = Math.max(this.brakePedal, speed < 1 ? 1 : 0.2); this.stuck = 0; return; }
        if (speed < 2 && v.clutchEngagement < 0.5) this.throttle = Math.max(this.throttle, 0.5);
        // stuck against something: back up a moment
        if (speed < 0.5 && this.throttle > 0.3) { this.stuck = (this.stuck || 0) + delta; } else this.stuck = 0;
        if (this.stuck > 2.5) { this.reverse = true; this.throttle = 0.5; this.brakePedal = 0; this.turnAngle = -smoothSteer; if (this.stuck > 4.5) this.stuck = 0; }
        else this.reverse = false;
    };

    this.update = function (delta, others) {
        if (!this.loaded) return;
        this.clock += delta;
        this.drive(delta, others);
        this.vehicle.updateControls(delta);
        this.vehicle.update(delta);
        this.pit.update(delta);
        // laps: the fraction of the line wraps around, after the car went round (not when it dithers at the line)
        var fraction = line ? line.fractionOf(this.lineIndex) : 0;
        if (fraction < 0.2 && lastFraction > 0.8 && maxFraction > 0.5) {
            this.lapsCompleted++;
            this.lapTimes.push(this.clock - this.lapStart);
            this.lapStart = this.clock;
            maxFraction = 0;
            // the fuel a lap takes, for the decision to pit (a lap with a stop in it does not count)
            if (fuelAtLapStart !== null && !this.pittedThisLap) fuelPerLap = Math.max(fuelPerLap || 0, fuelAtLapStart - this.vehicle.fuel);
            fuelAtLapStart = this.vehicle.fuel;
            this.pittedThisLap = false;
        } else if (fraction > 0.8 && lastFraction < 0.2 && this.lapsCompleted > 0 && maxFraction < 0.2) {
            this.lapsCompleted--; // went back over the line
            maxFraction = 1;
        }
        if (fraction < 0.8) maxFraction = Math.max(maxFraction, fraction);
        lastFraction = fraction;
        if (this.pit.active) this.pittedThisLap = true;
        this.progress = this.lapsCompleted + fraction;
        this.updateVisuals();
    };

    var bodyPosition = { x: 0, y: 0, z: 0 }, bodyQuaternion = { x: 0, y: 0, z: 0, w: 1 }, bodyUp = new THREE.Vector3();
    this.updateVisuals = function () {
        var v = this.vehicle, w = this.wheels;
        v.getBodyPose(bodyPosition, bodyQuaternion);
        this.body.quaternion.set(bodyQuaternion.x, bodyQuaternion.y, bodyQuaternion.z, bodyQuaternion.w);
        if (modelMid) {
            bodyUp.copy(modelMid).applyQuaternion(this.body.quaternion);
            this.body.position.set(bodyPosition.x - bodyUp.x, bodyPosition.y - bodyUp.y, bodyPosition.z - bodyUp.z);
        } else {
            bodyUp.set(0, 1, 0).applyQuaternion(this.body.quaternion);
            var lift = ((this.bodyLift || 1) - 1) * w[0].radius;
            this.body.position.set(bodyPosition.x + bodyUp.x * lift, bodyPosition.y + bodyUp.y * lift, bodyPosition.z + bodyUp.z * lift);
        }
        for (var i = 0; i < 4; i++) {
            var wheel = w[i];
            if (!wheel.object) continue;
            wheel.object.position.set(wheel.center.x, wheel.center.y, wheel.center.z);
            wheel.object.quaternion.copy(this.body.quaternion);
            if (i < 2) wheel.turn(v.steerApplied);
            wheel.object.children[0].children[0].rotation.x = wheel.spin;
        }
        if (this.rig) this.rig.update(v);
        if (this.steeringWheel) {
            var sw = this.steeringWheel;
            sw.object.quaternion.setFromAxisAngle(sw.axis, -v.steerApplied * (sw.degrees * Math.PI / 180) / this.maxTurn);
        }
    };
};

// The cars bump into each other: every car is two discs (at the axles); where they overlap the cars are pushed apart and exchange
// momentum along the line between them, with a little of it as a turn.
OpenRacer.collideCars = function (vehicles) {
    var restitution = 0.25;
    for (var i = 0; i < vehicles.length; i++) {
        for (var j = i + 1; j < vehicles.length; j++) {
            var a = vehicles[i], b = vehicles[j];
            if (Math.abs(a.py - b.py) > 2.5) continue;
            var ra = a.halfWidth + 0.15, rb = b.halfWidth + 0.15;
            var discsA = [[a.af * 0.8, 0], [-a.ar * 0.8, 0]], discsB = [[b.af * 0.8, 0], [-b.ar * 0.8, 0]];
            for (var p = 0; p < 2; p++) {
                for (var q = 0; q < 2; q++) {
                    var ax = a.x + Math.cos(a.psi) * discsA[p][0], az = a.z + Math.sin(a.psi) * discsA[p][0];
                    var bx = b.x + Math.cos(b.psi) * discsB[q][0], bz = b.z + Math.sin(b.psi) * discsB[q][0];
                    var dx = bx - ax, dz = bz - az;
                    var d = Math.hypot(dx, dz);
                    if (d >= ra + rb || d < 1e-6) continue;
                    var nx = dx / d, nz = dz / d;
                    var overlap = ra + rb - d;
                    var total = a.mass + b.mass;
                    // apart
                    a.px -= nx * overlap * (b.mass / total); a.pz -= nz * overlap * (b.mass / total);
                    b.px += nx * overlap * (a.mass / total); b.pz += nz * overlap * (a.mass / total);
                    // the impulse along the normal
                    var rvx = b.vx - a.vx, rvz = b.vz - a.vz;
                    var vn = rvx * nx + rvz * nz;
                    if (vn > 0) continue;
                    var jImp = -(1 + restitution) * vn / (1 / a.mass + 1 / b.mass);
                    a.vx -= jImp * nx / a.mass; a.vz -= jImp * nz / a.mass;
                    b.vx += jImp * nx / b.mass; b.vz += jImp * nz / b.mass;
                    // a turn from the hit off the middle
                    var armA = discsA[p][0], armB = discsB[q][0];
                    var sideA = -Math.sin(a.psi) * nx + Math.cos(a.psi) * nz;   // the normal, to the left of a
                    var sideB = -Math.sin(b.psi) * nx + Math.cos(b.psi) * nz;
                    a.wy -= 0.5 * armA * sideA * jImp / a.yawInertia;
                    b.wy += 0.5 * armB * sideB * jImp / b.yawInertia;
                    a.lastImpact = Math.max(a.lastImpact || 0, -vn * 0.5); a.impactTime = 0;
                    b.lastImpact = Math.max(b.lastImpact || 0, -vn * 0.5); b.impactTime = 0;
                }
            }
        }
    }
};
