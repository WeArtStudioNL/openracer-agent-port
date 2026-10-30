/*
 * Opponent.js
 *
 * Description: An AI car: the same physics as the player's car (Vehicle.js) with the same model, driven by a driver that follows the
 *              racing line (RacingLine.js). The driver looks ahead on the line (further the faster it goes) and steers at that point,
 *              keeps to the speed that the line allows there, brakes for the bends ahead, moves aside for a car in front and backs off
 *              when it is right behind one. The assists are on and the gearbox is automatic. The cars bump into each other
 *              (collideCars). The difficulty sets how close to the limit of the tyres it drives.
 *
 *              Options { vehicle, noModel }: the driver of a car that is not an AI car. With a vehicle it drives that vehicle (the player's after the finish of a race: Car.autopilot): its
 *              own physics and model are not made (noModel), only drive() is used, which sets throttle, brakePedal and turnAngle; paceFactor (1: as fast as the line allows; 0.5: half)
 *              scales the speed.
 */

OpenRacer.vehicleParams = function (config, getSurface) {
    var chassis = config.chassis, drivetrain = config.drivetrain, dimensions = config.dimensions;
    return {
        mass: chassis.mass + OpenRacer.Motorcycle.riderMass(config), wheelbase: chassis.wheelbase, front_track: chassis.front_track, rear_track: chassis.rear_track,
        weight_distribution: chassis.weight_distribution, cgHeight: chassis.cg_height, roll_front: chassis.roll_front,
        spring_front: chassis.spring_front, spring_rear: chassis.spring_rear, damping_front: chassis.damping_front, damping_rear: chassis.damping_rear,
        downforce: chassis.downforce, downforce_front: chassis.downforce_front, downforce_rear: chassis.downforce_rear, ackermann: chassis.ackermann,
        suspension_travel: chassis.suspension_travel, unsprung: !!chassis.unsprung, frame_torsion: chassis.frame_torsion, inner_lift: chassis.inner_lift, unsprung_mass: chassis.unsprung_mass, tyre_rate: chassis.tyre_rate, tyre_damping: chassis.tyre_damping, suspension_length: chassis.suspension_length, spring_progression: chassis.spring_progression, damping_rebound: chassis.damping_rebound, ride_front: chassis.ride_front, ride_rear: chassis.ride_rear, toe_front: chassis.toe_front, toe_rear: chassis.toe_rear,
        tc_fitted: !(config.extras && config.extras.tc_on === false), abs_fitted: !(config.extras && config.extras.abs_on === false), esc_fitted: !(config.extras && config.extras.esc_on === false), launch_control_fitted: !(config.extras && config.extras.launch_control_on === false), two_step_fitted: !(config.extras && config.extras.two_step_on === false),
        compound: config.tyres && config.tyres.compound, pressure_front: config.tyres && config.tyres.pressure_front, pressure_rear: config.tyres && config.tyres.pressure_rear, roll_center_front: chassis.roll_center_front, roll_center_rear: chassis.roll_center_rear, camber_front: chassis.camber_front, camber_rear: chassis.camber_rear, roll_camber: chassis.roll_camber,
        motorcycle: config.type === "motorcycle" ? (config.motorcycle || {}) : null,
        // a live axle (the suspension type of the parts library): its wheels lean with the axle, not with the roll of the body (the player's car gets this in Car.js)
        live_axle_front: !!(OpenRacer.PartsLibrary && OpenRacer.PartsLibrary.isLive(OpenRacer.PartsLibrary.typeOf(config, "front"))),
        live_axle_rear: !!(OpenRacer.PartsLibrary && OpenRacer.PartsLibrary.isLive(OpenRacer.PartsLibrary.typeOf(config, "rear"))),
        tire_diameter: chassis.tire_diameter, width: dimensions.width, length: dimensions.length, height: dimensions.height,
        Cdrag: 0.5 * chassis.drag_coefficient * dimensions.width * dimensions.height * 0.85 * 1.29,
        gear_ratios: drivetrain.gear_ratios.slice(), reverse_ratio: drivetrain.reverse_ratio, final_drive: drivetrain.final_drive, efficiency: drivetrain.efficiency,
        shift_time: drivetrain.shift_time,
        clutch_start_rpm: drivetrain.clutch_start_rpm, clutch_full_rpm: drivetrain.clutch_full_rpm,
        gearbox: drivetrain.gearbox, cvt_rpm: drivetrain.cvt_rpm, cvt_rate: drivetrain.cvt_rate, cvt_low: drivetrain.cvt_low, cvt_high: drivetrain.cvt_high,
        tc_stall_rpm: drivetrain.tc_stall_rpm, tc_ratio: drivetrain.tc_ratio, tc_lockup: drivetrain.tc_lockup,
        drive: drivetrain.drive, diff: drivetrain.diff, diff_preload: drivetrain.diff_preload, diff_lock: drivetrain.diff_lock, diff_power: drivetrain.diff_power,
        diff_coast: drivetrain.diff_coast, center_diff: drivetrain.center_diff, center_split: drivetrain.center_split,
        engine: config.engine, brake_front: config.brakes && config.brakes.front, brake_rear: config.brakes && config.brakes.rear,
        tank: config.fuel && config.fuel.tank, getSurface: getSurface
    };
};

var LOD_DISTANCE = 450;   // metres from the camera, beyond that an AI car is not drawn

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

    // the AI drives on the simple tyre (Vehicle.simpleTyres: rays and a slip curve): the shell of nodes of the player's tyres costs most of the time of a car, and with it every
    // AI car cost as much as the player, and the frame rate fell with every car on the grid
    var params = OpenRacer.vehicleParams(config, getSurface);
    params.simpleTyres = options.shellTyres ? false : true;
    this.vehicle = options.vehicle || new OpenRacer.Vehicle(params, this);
    // the tyres, the power and the clutch as car.json has them (the player's car gets these through the tuning menu)
    var tyres = config.tyres || {}, engineConfig = config.engine || {}, assists = config.assists || {};
    if (!options.vehicle) this.vehicle.retune({
        grip: tyres.grip !== undefined ? tyres.grip : 1, grip_balance: tyres.grip_balance !== undefined ? tyres.grip_balance : 1,
        cornering: tyres.cornering !== undefined ? tyres.cornering : 1, rolling_resistance: tyres.rolling_resistance !== undefined ? tyres.rolling_resistance : 0.015,
        pressure_front: tyres.pressure_front || 2.2, pressure_rear: tyres.pressure_rear || 2.2,
        power: engineConfig.power_scale !== undefined ? engineConfig.power_scale : 1, engine_braking: engineConfig.braking_scale !== undefined ? engineConfig.braking_scale : 1,
        clutch: config.drivetrain.clutch !== undefined ? config.drivetrain.clutch : 1.5,
        tc_allowance: assists.tc_allowance !== undefined ? assists.tc_allowance : 1, esc_gain: assists.esc_gain !== undefined ? assists.esc_gain : 1
    });
    if (!options.vehicle) {
        this.vehicle.collision = collisionWorld;
        this.vehicle.ground = groundWorld;
        this.vehicle.tcEnabled = true;
        this.vehicle.absEnabled = true;
        this.vehicle.escEnabled = true;
    }
    this.wheels = this.vehicle.wheels;
    this.body = new THREE.Object3D();
    this.loaded = false;
    this.steeringWheel = null;
    var modelMid = null;
    // the speed of the line for this driver: the grip of the road times the skill, less on sand or grass (the surfaces of the track, Helpers.getSurface), and no flying off the crests
    // (the grip of the road as it is now: in the rain or on snow the line is driven slower; the speeds are made again when the grip has changed)
    var speeds = null, speedsGrip = -1;
    // learning: the line is driven in pieces of five points (10 m); each piece has a factor on the speed the line allows, that grows when the piece was driven cleanly (the car stayed
    // near the line) and shrinks when the car ran wide in it or crashed just after it, up to a ceiling that goes with the skill (hard: 1.6, normal: 1.35, easy: 1.1)
    var SEG = 5, learn = null, segNow = -1, segOff = 0;
    var learnCap = 1.1 + 0.5 * Math.max(0, Math.min(1, (self.skill - 0.7) / 0.3));
    this.learnFactor = function () { return learn; };
    var learnSavedLap = 0;
    function learnKey() { return "openracer.ai." + (typeof currentTrack !== "undefined" && currentTrack && currentTrack.id || "track") + "." + (config.id || "car") + "." + self.name + "." + (line && line.points.length ? Math.round(line.points[0].x) + "," + Math.round(line.points[0].z) + "," + line.points.length : ""); }
    function learnEnd(seg, off, crashed) {
        if (!learn) return;
        var k = ((seg % learn.length) + learn.length) % learn.length;
        if (crashed) { for (var b = 0; b < 3; b++) { var kb = ((k - b) % learn.length + learn.length) % learn.length; learn[kb] = Math.max(0.6, learn[kb] * 0.82); } }
        else if (off < 1.8) learn[k] = Math.min(learnCap, learn[k] * 1.07);
        else if (off > 3.5) learn[k] = Math.max(0.6, learn[k] * 0.93);
    }
    var carGrip = Math.max(0.8, Math.min(2, (config && config.tyres && config.tyres.grip) || 1.2));    // (the grip of the tyres of the car: a kart on semislicks holds 1.2 g, a car on road tyres less)
    function buildSpeeds() {
        var roadGrip = typeof getSurface === "function" ? getSurface("road").static : 1;
        var wetness = roadGrip / 1.2;                                // (1 on a dry road)
        speedsGrip = roadGrip;
        speeds = line ? line.computeSpeeds(9.81 * carGrip * 1.1 * self.skill * wetness, 9.81 * carGrip * 0.95 * self.skill * wetness, 90, function (name) { return typeof getSurface === "function" && name ? getSurface(name).static / roadGrip : 1; }) : null;
    }
    buildSpeeds();

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
    this.pitBox = null;          // the pit box of this car ({ x, z, heading }, from the track editor): it drives to it and stops in it
    this.paceFactor = 1;         // the share of the speed that the line allows that it drives (the player's car after a race: 0.5)
    this.paceCap = Infinity;     // the most it drives (m/s; the player's car after a race: half of the top speed that the player reached)
    this.pitPhase = 0;           // 0.5 on the racing line, slowing down for the start of the pit line; 1 on its way to the box and in it, 2 on its way back to the racing line
    this.pitPath = null;         // the pit line of the track (OpenRacer.PitPath, drawn in the track editor): the path to the box, with a speed of its own
    var pitIdx = 0, pitStopIdx = -1;
    this.pit = new OpenRacer.PitStop(this.vehicle);
    this.pitting = false;        // on its way through the pit lane
    this.pitStops = 0;
    var fuelAtLapStart = null, fuelPerLap = null;
    var lastFraction = 0;
    var maxFraction = 0;

    if (!options.noModel) OpenRacer.loadCarModel(config, function (model) {
        self.body.add(model.tilt);
        scene.add(self.body);
        self.steeringWheel = model.steeringWheel || null;
        self.rig = model.rig || null;
        self.head = model.head || null;
        for (var i = 0; i < 4; i++) {
            self.wheels[i].object = model.wheels[i];
            scene.add(model.wheels[i]);
        }
        if (self.color && OpenRacer.applyCarColors) {
            // another colour for the body, so the cars can be told apart: only the meshes of the model that are called body (as the body colour of the tuning menu, Car.js); a model
            // without such a mesh keeps its own colours
            var hex = ("000000" + (self.color & 0xffffff).toString(16)).slice(-6);
            OpenRacer.applyCarColors([model.tilt], { body: "#" + hex, rim: null });
        }
        if (model.measured) {
            var c = model.measured.centres;
            var wheelbase = (c.FR.z + c.FL.z) / 2 - (c.RL.z + c.RR.z) / 2;
            var frontTrack = Math.abs(c.FR.x - c.FL.x), rearTrack = Math.abs(c.RR.x - c.RL.x), bike = config.type === "motorcycle";
            if (bike) { frontTrack = Math.max(0.04, frontTrack); rearTrack = Math.max(0.04, rearTrack); }
            if (wheelbase > 1.2 && wheelbase < 5 && frontTrack > (bike ? 0 : 0.6) && rearTrack > (bike ? 0 : 0.6) && model.measured.diameter > 0.3) {
                self.vehicle.retune({ wheelbase: wheelbase, front_track: frontTrack, rear_track: rearTrack, tire_diameter: model.measured.diameter });
                modelMid = new THREE.Vector3((c.FR.x + c.FL.x + c.RL.x + c.RR.x) / 4, (c.FR.y + c.FL.y + c.RL.y + c.RR.y) / 4, (c.FR.z + c.FL.z + c.RL.z + c.RR.z) / 4);
            }
        }
        self.bodyLift = model.bodyLift;
        OpenRacer.CollisionProxy.apply(self, model, modelMid);
        // the driver of the car (car.json "driver", Driver.js): a dummy that holds the steering wheel and works the pedals, as in the player's car (Car.js); it is made after the colour
        // above, which is for the body
        var driverConfig = config.driver;
        if (driverConfig && driverConfig.enabled && driverConfig.file && OpenRacer.Driver) {
            var driver = new OpenRacer.Driver(driverConfig, model.tilt, model.steeringWheel);
            driver.load(OpenRacer.Garage ? OpenRacer.Garage.resolve(config, driverConfig.file) : driverConfig.file, OpenRacer.Garage ? OpenRacer.Garage.manager(config) : undefined,
                function () { self.driver = driver; },
                function (error) { console.warn("The driver model of " + self.name + " could not be loaded: " + (error && error.message ? error.message : error)); });
        }
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
        this.lineCrossed = false;       // (the laps count from the first time over the line, as for the player: the grid is behind it)
        this.lapStart = this.clock;
        this.updateVisuals();
    };

    // ---- the driver
    var smoothSteer = 0;
    var speedTrail = [];         // the speed over the road of the last frames, for a hard hit
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

        // the pit box: when the tyres are worn or the fuel will not last, and the box is within 70 m ahead along the line, it drives to the box (a staging point on the axis of the box
        // first, then the middle), stops with the wheels inside it until the stop is done, and goes back to the line
        var box = this.pitBox, boxMode = false, boxTarget = null, boxNext = null, boxSpeed = 16, atStop = false;
        if (box && v.wearEnabled) {
            var lapsLeftB = this.raceLaps ? this.raceLaps - this.lapsCompleted : 99;
            var fuelNeededB = fuelPerLap !== null ? fuelPerLap * (lapsLeftB + 0.4) : v.tank * 0.12;
            var needB = !this.finished && lapsLeftB >= 1 && ((v.maxWear() > 0.75 && lapsLeftB >= 2) || v.fuel < fuelNeededB);
            if (!this.pitPath && !this.pitting && needB) {
                var boxLine = line.nearest(box.x, box.z), toBoxLine = ((boxLine - this.lineIndex) % n + n) % n * line.step;
                if (toBoxLine < 70) { this.pitting = true; this.pitPhase = 1; }
            }
            var path = this.pitPath;
            if (path && !this.pitting && needB) {
                // the pit line: from 120 m before its start the car is on its way: slowing down along the racing line for the start of the line (at the speed of the pit lane there)
                var toEntry = ((path.entry - this.lineIndex) % n + n) % n * line.step;
                if (toEntry < 120) { this.pitting = true; this.pitPhase = 0.5; pitStopIdx = path.nearest(box.x, box.z); pitIdx = 0; }
            }
            if (path && this.pitting) {
                boxMode = true; asideTarget = 0;
                var PIT_SPEED = 16, BRAKE = 3.5;                                       // m/s: the speed in the pit lane; m/s2: how hard it brakes for the stop and for the start
                if (this.pitPhase === 0.5) {
                    var toStart = ((path.entry - this.lineIndex) % n + n) % n * line.step, p0 = path.point(0);
                    boxSpeed = Math.sqrt(PIT_SPEED * PIT_SPEED + 2 * BRAKE * Math.max(0, toStart - 2));
                    if (toStart < 6 || Math.hypot(p0.x - v.x, p0.z - v.z) < 7) { this.pitPhase = 1; pitIdx = path.nearest(v.x, v.z); }
                }
                if (this.pitPhase === 1 || this.pitPhase === 2) {
                    pitIdx = path.nearest(v.x, v.z, pitIdx);
                    var lookP = Math.max(4, Math.min(12, 2 + speed * 0.55)), ti = Math.min(path.count - 1, pitIdx + Math.round(lookP / path.step));
                    boxTarget = path.point(ti); boxNext = path.point(ti + 1);
                    var distStop = (pitStopIdx - pitIdx) * path.step;
                    if (this.pitPhase === 1 && this.pit.done) this.pitPhase = 2;
                    if (this.pitPhase === 1) {
                        boxSpeed = Math.min(PIT_SPEED, Math.sqrt(2 * BRAKE * Math.max(0, distStop - 0.2)) + 0.7);
                        if (distStop < 0.8 && speed < 2 && !this.pit.done) { atStop = true; boxSpeed = 0; }
                    } else {
                        boxSpeed = PIT_SPEED;
                        if (pitIdx >= path.count - 3) { this.pitting = false; this.pitPhase = 0; this.pitStops++; boxMode = false; boxTarget = null; }
                    }
                }
            } else if (!path && this.pitting) {
                boxMode = true; asideTarget = 0;
                var bf = Math.cos(box.heading), bg = Math.sin(box.heading);
                var rx = v.x - box.x, rz = v.z - box.z, distB = Math.hypot(rx, rz), alongB = rx * bf + rz * bg;
                if (this.pitPhase === 1 && this.pit.done) this.pitPhase = 2;
                if (this.pitPhase === 1) {
                    if (alongB < -9 && distB > 10) { boxTarget = { x: box.x - bf * 9, z: box.z - bg * 9 }; boxNext = { x: box.x, z: box.z }; boxSpeed = Math.min(16, 3 + (distB - 9) * 0.7); }
                    else { boxTarget = { x: box.x, z: box.z }; boxNext = { x: box.x + bf, z: box.z + bg }; boxSpeed = Math.min(12, 1.5 + distB * 0.9); }
                    if (distB < 1.3 && speed < 3 && !this.pit.done) { atStop = true; boxSpeed = 0; }
                } else {
                    // back to the line: the normal point ahead on it, slowly until it is on it again
                    var here0 = line.point(this.lineIndex), offB = Math.hypot(here0.x - v.x, here0.z - v.z);
                    boxSpeed = 14;
                    if (offB < 3.5 && distB > 12) { this.pitting = false; this.pitPhase = 0; this.pitStops++; boxMode = false; }
                }
            }
        }
        // the pit lane (a track without boxes): in when the tyres are worn or the fuel will not last, through the lane at a walking pace, a stop in the middle
        var lane = this.pitLane, inLane = false;
        if (lane && !box && v.wearEnabled) {
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
        if (boxMode && boxTarget) { target = boxTarget; next = boxNext; aside = 0; }
        var tx = next.x - target.x, tz = next.z - target.z, tl = Math.hypot(tx, tz) || 1;
        var ax = target.x - (tz / tl) * aside, az = target.z + (tx / tl) * aside; // to the left of the line
        var dxT = ax - v.x, dzT = az - v.z;
        var wanted = Math.atan2(dzT, dxT) - v.psi;
        while (wanted > Math.PI) wanted -= 2 * Math.PI;
        while (wanted < -Math.PI) wanted += 2 * Math.PI;
        // pure pursuit: the steering angle that makes the car reach the point
        var dist = Math.hypot(dxT, dzT);
        var steer = Math.atan2(2 * v.wheelbase * Math.sin(wanted), Math.max(dist, 1));
        // and a pull towards the line itself: pure pursuit on a point far ahead asks the geometric angle, and a car that slips (its tyres need their slip angles, or it
        // understeers on sand) tracks a wider arc than that and drifts off the line without ever asking for more; up to 8 degrees for 5 m beside the line it should be on
        var hereP = line.point(this.lineIndex), hx = hereP.x - (tz / tl) * aside - v.x, hz = hereP.z + (tx / tl) * aside - v.z;
        var beside = -hx * Math.sin(v.psi) + hz * Math.cos(v.psi);                        // the line to the left of the car (m)
        steer += Math.max(-0.05, Math.min(0.05, beside * 0.012));
        steer = Math.max(-this.maxTurn, Math.min(this.maxTurn, steer));
        smoothSteer += (steer - smoothSteer) * Math.min(1, delta / 0.08);
        this.turnAngle = smoothSteer;

        // the speed the line allows here and a little ahead (the brakes need a moment)
        if (!learn) {
            learn = new Float32Array(Math.ceil(n / SEG)); for (var li = 0; li < learn.length; li++) learn[li] = 1;
            // what this driver learned of this track earlier (a little less of it, for a start)
            try {
                var stored = JSON.parse(localStorage.getItem(learnKey()) || "null");
                if (stored && stored.length === learn.length) for (var ls = 0; ls < learn.length; ls++) learn[ls] = Math.max(0.6, Math.min(learnCap, 1 + (stored[ls] - 1) * 0.9));
            } catch (e) { /* no storage */ }
        }
        if (this.lapsCompleted !== learnSavedLap) {
            learnSavedLap = this.lapsCompleted;
            try { localStorage.setItem(learnKey(), JSON.stringify(Array.prototype.map.call(learn, function (x) { return Math.round(x * 100) / 100; }))); } catch (e) { /* no storage */ }
        }
        var segHere = Math.floor(this.lineIndex / SEG);
        if (segHere !== segNow) { if (segNow >= 0 && !this.crashedAt && this.clock - (this.lapStart || 0) > 3 && !boxMode && !inLane) learnEnd(segNow, segOff, false); segNow = segHere; segOff = 0; }
        segOff = Math.max(segOff, Math.hypot(line.point(this.lineIndex).x - v.x, line.point(this.lineIndex).z - v.z));
        var allowed = Infinity;
        for (var j = 0; j <= 4; j++) { var kj = ((this.lineIndex + j) % n + n) % n; allowed = Math.min(allowed, speeds[kj] * learn[Math.floor(kj / SEG) % learn.length]); }
        allowed = Math.min(allowed * holdBack * this.paceFactor, this.paceCap);
        if (inLane) allowed = Math.min(allowed, 16);        // the pit lane: slowly
        if (boxMode) allowed = Math.min(allowed, boxSpeed);      // to the box and back: slowly
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
        // A crash: a hard hit (a wall, another car: the body hit something at more than 30 km/h), the car on its side or its roof, or a wheel torn off. The car stands where it
        // came to rest for a few seconds (the driver gathers himself), and is then put back, repaired, at the side of the track a little further along the line, standing and
        // facing along it. Lost (stuck for a long time against a rock or in a dune, far from the line) goes the same way after seven seconds, and a car that fell out of the
        // world (through the road, off the edge) at once.
        var here = line.point(this.lineIndex);
        var offLine = Math.hypot(here.x - v.x, here.z - v.z);
        var upY = 1 - 2 * (v.qx * v.qx + v.qz * v.qz);
        // (a motorcycle has no wheels 1 and 3: they are "lost" from the start, and every AI motorcycle was put back as crashed every three seconds)
        var wheelOff = v.wheelLost && [0, 1, 2, 3].some(function (k) { return v.wheelLost[k] && !(v.soloWheels && (k === 1 || k === 3)); });
        // a hard hit: the speed over the road fell by more than 8 m/s within a fifth of a second (a wall, another car; a landing from a jump is not this: that is vertical)
        var over = Math.hypot(v.vx, v.vz);
        speedTrail.push(over); if (speedTrail.length > 7) speedTrail.shift();
        var hardHit = speedTrail.length === 7 && speedTrail[0] - over > 8 && speedTrail[0] > 6;
        if (hardHit) speedTrail.length = 0;
        if ((speed < 1.5 && this.throttle > 0.3 && !inLane && !boxMode) || (offLine > 45 && !boxMode)) this.lostFor = (this.lostFor || 0) + delta;
        else this.lostFor = Math.max(0, (this.lostFor || 0) - 2 * delta);
        this.overFor = upY < 0.25 ? (this.overFor || 0) + delta : 0;
        if (v.py < here.y - 25) this.lostFor = 99;
        // no headway: a car that rocks against a wall (its speed swings to and fro, so it is never slow for long) gets nowhere either; after eight seconds within
        // four metres it is lost, and put back
        if (!this.anchor || Math.hypot(v.x - this.anchor.x, v.z - this.anchor.z) > 4) { this.anchor = { x: v.x, z: v.z }; this.stillFor = 0; }
        else if (!inLane && !boxMode) this.stillFor = (this.stillFor || 0) + delta;
        if (this.stillFor > 8) this.lostFor = 99;
        // (not for a driver of a car that is not an AI car, the player's after the finish: only drive() runs for it, its clock stands still, and it was counted as
        // crashed again every frame, which also took its learnt speeds down every frame)
        if (!options.vehicle && !this.crashedAt && !inLane && !boxMode && (hardHit || this.overFor > 1 || wheelOff || this.lostFor > 7)) {
            this.crashedAt = this.clock;
            this.crashReason = hardHit ? "hit" : this.overFor > 1 ? "over" : wheelOff ? "wheel" : v.py < here.y - 25 ? "fell" : offLine > 45 ? "off line " + offLine.toFixed(0) + " m" : "stuck";      // (for the debugging)
            this.crashWait = this.lostFor > 7 || v.py < here.y - 25 ? 0 : 3;        // (lost or fallen out: it waited long enough)
            this.crashes = (this.crashes || 0) + 1;
            if (hardHit || this.overFor > 1 || this.lostFor > 7) learnEnd(Math.floor(this.lineIndex / SEG) - 1, 99, true);
        }
    };

    // Put back at the side of the track, repaired: the right of the line, a little further along it, where there is road (else on the line), facing along it, standing
    this.putBack = function () {
        var v = this.vehicle;
        var at = line.point(this.lineIndex + 3), next = line.point(this.lineIndex + 4);
        var dx = next.x - at.x, dz = next.z - at.z, len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        var x = at.x + dz * 3.5, z = at.z - dx * 3.5;                              // (3.5 m to the right: aside is negative to the right in drive)
        var ground = typeof groundWorld !== "undefined" ? groundWorld : v.ground;
        var road = ground && ground.query ? ground.query(x, z, at.y + 5, 10) : null;
        if (!road || road.surface !== "road" && road.surface !== "track01" && road.surface !== (at.surface || "road")) { x = at.x + dz * 1.5; z = at.z - dx * 1.5; }
        v.reset(x, z, Math.atan2(dz, dx));
        // repaired, as the comment says it is: the shell, the parts, the wheels and the tyres; and a motorcycle that was down is up again with its rider on it
        // (it stayed "crashed": no throttle and no steering, so it was put back again every few seconds and never got going; a torn-off wheel was a new crash at once)
        if (v.repair) v.repair();
        if (v.controller && v.controller.recover) v.controller.recover();
        if (this.driver && this.driver.recover) this.driver.recover();
        if (this.parts && this.parts.moved) this.parts.moved();
        this.lostFor = 0; this.overFor = 0; this.stuck = 0; smoothSteer = 0; this.reverse = false; speedTrail.length = 0;        // (the stop of the reset is no hit)
        this.anchor = null; this.stillFor = 0;
        this.throttle = 0; this.brakePedal = 1; this.turnAngle = 0;
        this.recovered = (this.recovered || 0) + 1;
        this.updateVisuals();
    };

    this.update = function (delta, others) {
        if (!this.loaded) return;
        this.clock += delta;
        if (line && typeof getSurface === "function" && Math.abs(getSurface("road").static - speedsGrip) > 0.03) buildSpeeds();
        if (this.crashedAt) {
            // crashed: it stands (no throttle, the brakes on, no steering) until the wait is over, then it is put back at the side of the track
            this.throttle = 0; this.brakePedal = 1; this.turnAngle = 0; this.reverse = false;
            if (this.clock - this.crashedAt >= this.crashWait) { this.crashedAt = 0; this.putBack(); }
        }
        else this.drive(delta, others);
        this.vehicle.updateControls(delta);
        this.vehicle.update(delta);
        this.pit.update(delta);
        var marks = OpenRacer.skidMarks && OpenRacer.skidMarks();
        if (marks) marks.update(this.vehicle);
        var pellets = OpenRacer.marbles && OpenRacer.marbles();
        if (pellets) pellets.update(this.vehicle, delta);
        // laps: the fraction of the line wraps around, after the car went round (not when it dithers at the line)
        var fraction = line ? line.fractionOf(this.lineIndex) : 0;
        if (fraction < 0.2 && lastFraction > 0.8 && !this.lineCrossed) {
            this.lineCrossed = true;            // over the line for the first time: the first lap starts here
            this.lapStart = this.clock;
            maxFraction = 0;
        } else if (fraction < 0.2 && lastFraction > 0.8 && maxFraction > 0.5) {
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
        this.progress = this.lapsCompleted + fraction - (this.lineCrossed ? 0 : 1);
        this.updateVisuals(delta);
    };

    var bodyPosition = { x: 0, y: 0, z: 0 }, bodyQuaternion = { x: 0, y: 0, z: 0, w: 1 }, bodyUp = new THREE.Vector3();
    this.updateVisuals = function (delta) {
        delta = delta || 0;
        var v = this.vehicle, w = this.wheels;
        // a car far from the camera is not drawn, and its model (wheels, suspension, soft body, parts) is not moved either
        var far = typeof camera !== "undefined" && camera && Math.hypot(v.px - camera.position.x, v.pz - camera.position.z) > LOD_DISTANCE;
        if (this.body.visible === far) {
            this.body.visible = !far;
            for (var k = 0; k < 4; k++) if (w[k].object) w[k].object.visible = !far;
        }
        if (far) return;
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
            wheel.turn(wheel.steerNow !== undefined ? wheel.steerNow : (i < 2 ? v.steerApplied : 0));
            wheel.object.children[0].children[0].rotation.x = wheel.spin;
            if (this.head && i === 1) OpenRacer.updateFork(this.head, wheel, this.body, v.steerApplied);
        }
        if (this.rig) this.rig.update(v, w);
        if(this.softBodyMesh) this.softBodyMesh.update();
        if(this.parts) this.parts.update(delta);
        if (this.steeringWheel) {
            var sw = this.steeringWheel;
            var swAngle = this.rig && this.rig.columnAngle !== undefined ? this.rig.columnAngle : -v.steerApplied * (sw.degrees * Math.PI / 180) / this.maxTurn;
            sw.object.quaternion.setFromAxisAngle(sw.axis, swAngle);
            sw.angle = swAngle;
        }
        // the driver: the hands on the steering wheel, the feet on the pedals (in a replay the pedals and the gear are those of the recording)
        if (this.driver) {
            var rearWheel = w[2], roadY = rearWheel && rearWheel.hasContact && rearWheel.center ? rearWheel.center.y - rearWheel.radius : undefined;
            var gearNow = this.current_gear, neutralNow = this.neutral, label = OpenRacer.Replay && OpenRacer.Replay.active ? this.replayGear : undefined;
            if (label !== undefined) { var m = /(\d+)$/.exec(label); neutralNow = label === "N"; gearNow = m ? parseInt(m[1], 10) - 1 : gearNow; }
            var controller = v.controller;
            this.driver.update(delta || 0.016, this.throttle, this.brakePedal, { gear: gearNow, neutral: neutralNow, push: false, footDown: controller ? controller.footDown : 0, footDownL: controller ? controller.footDownL || 0 : 0,
                speed: v.u, groundY: -(this.config.chassis.tire_diameter || 0.6) / 2, roadY: roadY, posture: controller ? controller.posture : null });
        }
    };
};

// The cars bump into each other: every car is two discs (at the axles); where they overlap the cars are pushed apart and exchange
// momentum along the line between them, with a little of it as a turn.
//
// Two cars with a soft body (SOFTBODY.md, M4) hit each other with their shells: every car puts the others in vehicle.otherCars, and in its step the
// nodes of the shell push against the collision spheres of the other (Vehicle.js, buildCarPairs). The discs are then only a backstop, a little
// smaller than the car, for a hit that goes through the shell. A car without a soft body has nothing in otherCars and costs nothing.
OpenRacer.collideCars = function (vehicles) {
    var restitution = 0.25;
    for (var i = 0; i < vehicles.length; i++) {
        var soft = vehicles[i];
        if (!soft.otherCars) continue;
        soft.otherCars.length = 0;
        if (!soft.softBody) continue;
        for (var s = 0; s < vehicles.length; s++) if (s !== i && Math.abs(soft.py - vehicles[s].py) < 6) soft.otherCars.push(vehicles[s]);
    }
    for (var i = 0; i < vehicles.length; i++) {
        for (var j = i + 1; j < vehicles.length; j++) {
            var a = vehicles[i], b = vehicles[j];
            if (Math.abs(a.py - b.py) > 2.5) continue;
            var ra = a.halfWidth + 0.15, rb = b.halfWidth + 0.15;
            if (a.softBody && b.softBody && a.ground && a.ground.use3D && b.ground && b.ground.use3D) { ra -= 0.35; rb -= 0.35; }
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
                    // (as in Vehicle.js: the hit of now, not the hardest since the start, which made every later touch a crash of the motorcycle)
                    if (-vn * 0.5 > (a.lastImpact || 0) || a.impactTime > 0.5) a.lastImpact = -vn * 0.5;
                    if (-vn * 0.5 > (b.lastImpact || 0) || b.impactTime > 0.5) b.lastImpact = -vn * 0.5;
                    a.impactTime = 0; b.impactTime = 0;
                }
            }
        }
    }
};
