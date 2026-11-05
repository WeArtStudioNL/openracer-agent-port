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
        compound: config.tyres && config.tyres.compound, pressure_front: config.tyres && config.tyres.pressure_front, pressure_rear: config.tyres && config.tyres.pressure_rear, roll_center_front: chassis.roll_center_front, roll_center_rear: chassis.roll_center_rear, anti_dive: chassis.anti_dive, anti_squat: chassis.anti_squat, anti_lift_front: chassis.anti_lift_front, anti_lift_rear: chassis.anti_lift_rear, camber_front: chassis.camber_front, camber_rear: chassis.camber_rear, roll_camber: chassis.roll_camber,
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
        engine: config.engine, engine_place: config.driveline && config.driveline.engine, brake_front: config.brakes && config.brakes.front, brake_rear: config.brakes && config.brakes.rear,
        tank: config.fuel && config.fuel.tank, getSurface: getSurface
    };
};

var GHOST_TIME = 10;      // seconds that a car that was put back is a ghost for the other cars
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
    this.leanFromBend = config.type === "motorcycle";        // (a motorcycle leans as much as the bend that is asked needs, Motorcycle.js steering)

    // the AI drives on the simple tyre (Vehicle.simpleTyres: rays and a slip curve): the shell of nodes of the player's tyres costs most of the time of a car, and with it every
    // AI car cost as much as the player, and the frame rate fell with every car on the grid
    var params = OpenRacer.vehicleParams(config, getSurface);
    params.simpleTyres = options.shellTyres ? false : true;
    this.vehicle = options.vehicle || new OpenRacer.Vehicle(params, this);
    if(!options.vehicle) this.vehicle.engineDamageOn = false;       // (the AI cars have no engine damage: they have no pit stop to mend it)
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
    if (OpenRacer.sim && !options.vehicle) this.vehicle.tyreDetail = OpenRacer.sim.tyreDetail;      // (an AI car on tyres of nodes, aitires=shell)
    this.body = new THREE.Object3D();
    this.loaded = false;
    this.steeringWheel = null;
    var modelMid = null;
    // the speed of the line for this driver: the grip of the road times the skill, less on sand or grass (the surfaces of the track, Helpers.getSurface), and no flying off the crests
    // (the grip of the road as it is now: in the rain or on snow the line is driven slower; the speeds are made again when the grip has changed)
    var speeds = null, speedsGrip = -1, speedsTyres = 1;
    // the grip the tyres have left from their wear and temperature, the mean of the wheels on the road (worn tyres kept the speeds of new ones: it ran wide and crashed,
    // and the learning saved that as slower bends for the next race)
    function tyresNow() {
        var v = self.vehicle, sum = 0, count = 0;
        if (!v || !v.wheels) return 1;
        for (var i = 0; i < v.wheels.length; i++) {
            if (v.soloWheels && (i === 1 || i === 3)) continue;
            var w = v.wheels[i];
            sum += (w.condition || 1) / (w.pressureGrip || 1); count++;
        }
        return count ? Math.max(0.5, Math.min(1.1, sum / count)) : 1;
    }
    // learning: the line is driven in pieces of five points (10 m); each piece has a factor on the speed the line allows, that grows when the piece was driven cleanly (the car stayed
    // near the line) and shrinks when the car ran wide in it or crashed just after it, up to a ceiling that goes with the skill (hard: 1.6, normal: 1.35, easy: 1.1)
    // (the factor is on the speed of the bend, and the braking before it is worked out again from it: a factor on the speed at every point let a straight that was
    // driven cleanly learn a speed that left no room to brake for the bend at its end, and the AI went into the first bend too fast and off)
    var SEG = 5, learn = null, segNow = -1, segOff = 0, learnChanged = false, learnBuilt = 0;
    // the grip of the car as the skidpad measured it (OpenRacer.SkidpadGrip, in g, for this car and setup), else null: a guess from tyres.grip in car.json
    var measuredGrip = OpenRacer.SkidpadGrip ? OpenRacer.SkidpadGrip.get(config) : null;
    this.measuredGrip = measuredGrip;
    // the ceiling of the factor: with the grip measured little is left to learn (easy 1, normal 1.04, hard 1.08); a guess can be far off (a wide tyre grips much more
    // than tyres.grip says), so it may learn more
    var skillShare = Math.max(0, Math.min(1, (self.skill - 0.7) / 0.3));
    var learnCap = measuredGrip ? 1 + 0.08 * skillShare : 1.1 + 0.3 * skillShare;
    this.learnFactor = function () { return learn; };
    var learnSavedLap = 0;
    function learnKey() { return "openracer.ai." + (typeof currentTrack !== "undefined" && currentTrack && currentTrack.id || "track") + "." + (config.id || "car") + "." + self.name + "." + Math.round(self.skill * 100) + "." + (line && line.points.length ? Math.round(line.points[0].x) + "," + Math.round(line.points[0].z) + "," + line.points.length : ""); }
    function learnEnd(seg, off, crashed) {
        if (!learn) return;
        var k = ((seg % learn.length) + learn.length) % learn.length;
        var before = learn[k];
        if (crashed) { for (var b = 0; b < 3; b++) { var kb = ((k - b) % learn.length + learn.length) % learn.length; learn[kb] = Math.max(0.6, learn[kb] * 0.82); } }
        else if (off < 1.8) learn[k] = Math.min(learnCap, learn[k] * 1.03);
        else if (off > 3.5) learn[k] = Math.max(0.6, learn[k] * 0.93);
        if (crashed || learn[k] !== before) learnChanged = true;
    }
    var brakeAccel = 9;
    var carGrip = Math.max(0.8, Math.min(2, (config && config.tyres && config.tyres.grip) || 1.2));    // (the grip of the tyres of the car: a kart on semislicks holds 1.2 g, a car on road tyres less)
    function buildSpeeds() {
        var roadGrip = typeof getSurface === "function" ? getSurface("road").static : 1;
        var wetness = roadGrip / 1.2;                                // (1 on a dry road)
        speedsGrip = roadGrip;
        speedsTyres = tyresNow();

        // (the skidpad's g is what the car holds, the share of it that the driver uses is the skill; the guess from tyres.grip is a factor on 1 g)
        var lateral = measuredGrip ? measuredGrip : carGrip * 1.1, braking = measuredGrip ? measuredGrip * 0.95 : carGrip * 0.95;
        // the grip the tyres have left, before the limits of a motorcycle (its lean holds it under what the tyres give: cold tyres took a quarter off its speeds on
        // top of the lean, and a lap took 165 s)
        lateral *= speedsTyres; braking *= speedsTyres;
        // A motorcycle holds what its lean and its "max_lateral_g" allow (0.9 g), not the 1.2 g of the guess for a car on the same tyres, and it cannot brake hard
        // and lean at once: it came into every bend too fast, braked, could not lean enough, ran 10 to 16 m wide into the barriers and went down every ten seconds
        if (config.type === "motorcycle") {
            var bike = config.motorcycle || {}, leanLimit = Math.tan(Math.min(55, bike.max_lean_deg || 50) * Math.PI / 180);
            lateral = Math.min(lateral, bike.max_lateral_g || 0.9, leanLimit) * 0.9;
            braking = Math.min(braking, 0.8);
        }
        // (below hard a share of what was learned: a normal driver never goes wide at 85 %, so it learned up to the ceiling and was as fast as hard after a few laps)
        var share = 0.4 + 0.6 * skillShare;
        var factor = learn ? function (i) { var f = learn[Math.floor(i / SEG) % learn.length]; return f > 1 ? 1 + (f - 1) * share : f; } : null;      // (slower where it went wide or crashed: all of it)
        brakeAccel = 9.81 * braking * self.skill * wetness;
        speeds = line ? line.computeSpeeds(9.81 * lateral * self.skill * wetness, 9.81 * braking * self.skill * wetness, 90, function (name) { return typeof getSurface === "function" && name ? getSurface(name).static / roadGrip : 1; }, factor,
            // (a grip measured on the skidpad has the downforce at that speed in it already: not twice)
            !measuredGrip && self.vehicle && self.vehicle.mass > 0 ? ((self.vehicle.downforceFront || 0) + (self.vehicle.downforceRear || 0)) / self.vehicle.mass : 0) : null;      // (the downforce: more grip the faster)
        learnChanged = false; learnBuilt = self.clock || 0;
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
    this.finished = false;       // the race is done: it drives on, at a calmer pace (main.js sets paceFactor), and no more stops in the pits
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
    }, function (message) {
        // (a car whose model does not load leaves the race: it was never placed, stayed "running" in the results for ever, and kept the replay from starting)
        console.error("Opponent: " + message);
        self.failed = true;
        if (typeof race !== "undefined" && race.opponents) {
            var at = race.opponents.indexOf(self);
            if (at >= 0) race.opponents.splice(at, 1);
            if (typeof car !== "undefined" && car) car.raceCount = race.opponents.length + 1;
            if (typeof banner === "function") banner((self.name || "An AI car") + " could not be loaded and does not race.");
        }
    });

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
    var passing = null, passSide = 0, passFor = 0;   // the car that it is passing, the side it chose (1: left), and how long ago it last saw it ahead (s)
    var lastBeside = null;
    this.drive = function (delta, others) {
        var v = this.vehicle;
        if (!line || !speeds) { this.throttle = 0; this.brakePedal = 1; return; }
        if (this.held) { this.throttle = 0; this.brakePedal = 1; this.turnAngle = 0; this.stuck = 0; return; }
        var speed = Math.max(0, v.u);
        this.lineIndex = line.nearest(v.x, v.z, this.lineIndex);
        var n = line.count();

        // the car ahead: move aside for it, and do not run into it
        var ahead = null, aheadDist = Infinity, blocker = null;
        // how far left of the racing line a point is, at a point of the line
        var laneOf = function (i, x, z) { var a = line.point(i), b = line.point(i + 1), l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x)) / l; };
        var myLane = laneOf(this.lineIndex, v.x, v.z);
        for (var k = 0; k < others.length; k++) {
            var o = others[k];
            if (o === v) continue;
            var dx = o.x - v.x, dz = o.z - v.z;
            var forward = Math.cos(v.psi), side = Math.sin(v.psi);
            var along = dx * forward + dz * side;              // in front of us
            var across = -dx * side + dz * forward;             // to the left
            // (the car that it is passing stays the one ahead while it is beside it, in a wider box: moved aside, the car ahead dropped out of the narrow box, the AI went
            // back to the line, saw it again and moved aside again, and weaved from left to right down the straights)
            var box = o === passing ? 5.5 : 3.2;
            if (along > -2 && along < 22 && Math.abs(across) < box && (along > 0 || o === passing) && along < aheadDist) { ahead = { along: along, across: across, u: o.u, vehicle: o }; aheadDist = along; }
            // the car in its path: in front (or its nose level with our middle) and overlapping sideways; it holds back for that one (the cars side by side into a bend,
            // squeezed together where the road narrows, all held on and took each other off: now the one that is behind gives way)
            // (as far ahead as it needs to stop at its speed: 25 m was 0.5 s at 50 m/s, and it ran into a car that was much slower. And only a car whose nose is
            // clearly ahead: two cars level each took the other for the one in front, and both braked hard in the bend)
            // (its speed along our heading, not its own: a car that came the other way or slid sideways had a large speed of its own; and only on our level: a bridge,
            // an underpass. One it waited behind for six seconds is passed: see below)
            var ignored = o === this.ignoreBlocker && this.clock < this.ignoreUntil;
            if (ignored || Math.abs((o.py || 0) - (v.py || 0)) > 3) continue;
            var reachB = Math.max(25, speed * 1.5), closing = Math.max(0, o.vx * forward + o.vz * side);
            // close by: straight ahead along its heading
            if (along > 1.5 && along < 10 && Math.abs(across) < 2.2 && (!blocker || along < blocker.along)) blocker = { along: along, u: closing, vehicle: o };
            // further: along the racing line, in its lane (along its heading a car in the bend ahead was off to the side until 9 m, too late to stop from 17 m/s)
            else if (along > 0 && dx * dx + dz * dz < (reachB + 5) * (reachB + 5)) {
                var oi = line.nearest(o.x, o.z, this.lineIndex), dI = ((oi - this.lineIndex) % n + n) % n, onLine = dI * line.step;
                if (onLine > 1.5 && onLine < reachB && Math.abs(laneOf(oi, o.x, o.z) - myLane) < 2.2 && (!blocker || onLine < blocker.along)) {
                    var lp = line.point(oi), ln = line.point(oi + 1), ll = Math.hypot(ln.x - lp.x, ln.z - lp.z) || 1;
                    blocker = { along: onLine, u: Math.max(0, (o.vx * (ln.x - lp.x) + o.vz * (ln.z - lp.z)) / ll), vehicle: o };
                }
            }
        }
        asideTarget = 0;
        if (ahead) {
            // the side is chosen once for a car and kept until it is passed (or a second has gone by without it ahead)
            if (ahead.vehicle !== passing || !passSide) { passing = ahead.vehicle; passSide = ahead.across > 0 ? -1 : 1; }
            passFor = 0;
            asideTarget = passSide * 2.6;
        } else if (passing) {
            passFor += delta;
            if (passFor < 1) asideTarget = passSide * 2.6;
            else { passing = null; passSide = 0; }
        }
        // the car in its path: no faster than it can still stop behind it (the speed of that car, and what the brakes take off over the gap). A factor on its own
        // speed held it back too little when it closed fast: from 15 m/s faster it hit the car ahead
        var blockerCap = Infinity;
        if (blocker) {
            var gap = blocker.along - 4.5;
            // (closer than 2 m behind it: a little slower than it, so it drops back out of the overlap; at its speed it stayed there)
            blockerCap = gap < 2 ? Math.max(0, blocker.u * 0.85 - (2 - gap)) : blocker.u + Math.sqrt(2 * brakeAccel * 0.8 * (gap - 2));
        }

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
        var lane = this.pitLane, inLane = false, laneSpeed = 16;
        if (lane && !box && v.wearEnabled) {
            var lapsLeft = this.raceLaps ? this.raceLaps - this.lapsCompleted : 99;
            var fuelNeeded = fuelPerLap !== null ? fuelPerLap * (lapsLeft + 0.4) : v.tank * 0.12;
            var need = !this.finished && lapsLeft >= 1 && ((v.maxWear() > 0.75 && lapsLeft >= 2) || v.fuel < fuelNeeded);
            var toEntry = ((lane.entry - this.lineIndex) % n + n) % n * line.step;
            if (!this.pitting && need && toEntry < 60) this.pitting = true;
            if (this.pitting) {
                inLane = lane.covers(this.lineIndex) || toEntry < 60;
                if (!inLane) { this.pitting = false; this.pitStops++; this.laneStopped = false; }
                else {
                    asideTarget = 0;
                    // (the stop of this visit is done once: the pit forgets it as soon as the car moves, and the AI stopped again, and again, at the same place)
                    if (this.pit.done) this.laneStopped = true;
                    var stopIndex = lane.points[lane.stop].index;
                    var span = ((lane.exit - lane.entry) % n + n) % n, at = ((this.lineIndex - lane.entry) % n + n) % n, stopAt = ((stopIndex - lane.entry) % n + n) % n;
                    if (at <= span && at >= stopAt - 1 && at <= stopAt + 2 && !this.pit.done && !this.laneStopped) atStop = true;
                    // (the brakes come on in time for the stop: it was told to stop only within the last six metres, at the speed of the lane, and drove past)
                    if (!this.pit.done && !this.laneStopped && at <= stopAt) laneSpeed = Math.min(16, Math.sqrt(2 * 3.5 * Math.max(0, (stopAt - at) * line.step - 1)) + 0.6);
                }
            }
        }
        // (aside only as far as there is road: on the inside or the outside of a bend 2.6 m from the line is often the kerb or the gravel, and in the first bend the
        // cars that moved aside for the car ahead went off; the point ahead is looked at in steps, and the side shrinks to where the road still is)
        if (asideTarget !== 0) {
            var ground = typeof groundWorld !== "undefined" ? groundWorld : v.ground;
            var lookA = Math.round(Math.max(6, speed * 0.6) / line.step), pa = line.point(this.lineIndex + lookA), pb = line.point(this.lineIndex + lookA + 1);
            var ux = pb.x - pa.x, uz = pb.z - pa.z, ul = Math.hypot(ux, uz) || 1, roadName = pa.surface || "road";
            for (var tries = 0; tries < 4 && ground && ground.query; tries++) {
                var sx = pa.x - (uz / ul) * asideTarget, sz = pa.z + (ux / ul) * asideTarget;
                var under = ground.query(sx, sz, (pa.y || 0) + 3, 6);
                if (under && (under.surface === roadName || under.surface === "road")) break;
                asideTarget *= 0.6;
            }
            if (Math.abs(asideTarget) < 0.8) asideTarget = 0;
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
        // (without a loop: a car whose heading had become infinite or enormous, a car that the physics threw away, kept a loop of -2π going for ever, and the whole
        // game stood still in that frame)
        wanted = isFinite(wanted) ? Math.atan2(Math.sin(wanted), Math.cos(wanted)) : 0;
        // pure pursuit: the steering angle that makes the car reach the point
        var dist = Math.hypot(dxT, dzT);
        var steer = Math.atan2(2 * v.wheelbase * Math.sin(wanted), Math.max(dist, 1));
        // and a pull towards the line itself: pure pursuit on a point far ahead asks the geometric angle, and a car that slips (its tyres need their slip angles, or it
        // understeers on sand) tracks a wider arc than that and drifts off the line without ever asking for more; up to 8 degrees for 5 m beside the line it should be on
        var hereP = line.point(this.lineIndex), hx = hereP.x - (tz / tl) * aside - v.x, hz = hereP.z + (tx / tl) * aside - v.z;
        var beside = -hx * Math.sin(v.psi) + hz * Math.cos(v.psi);                        // the line to the left of the car (m)
        // (the same angle turns the car much harder at speed: the yaw rate goes with the speed, and the sideways speed it gives with its square; the pull is scaled to
        // that, and damped by how fast the car already closes in on the line, else it swung across the line and back on every straight)
        var rate = lastBeside === null ? 0 : (beside - lastBeside) / Math.max(delta, 1e-3);
        lastBeside = beside;
        var atSpeed = Math.min(1, (15 * 15) / Math.max(15 * 15, speed * speed));
        steer += Math.max(-0.05, Math.min(0.05, (beside * 0.012 + rate * 0.01) * atSpeed));
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
            buildSpeeds();
        }
        if (learnChanged && this.clock - learnBuilt > 1) buildSpeeds();
        if (this.lapsCompleted !== learnSavedLap) {
            learnSavedLap = this.lapsCompleted;
            try { localStorage.setItem(learnKey(), JSON.stringify(Array.prototype.map.call(learn, function (x) { return Math.round(x * 100) / 100; }))); } catch (e) { /* no storage */ }
        }
        var segHere = Math.floor(this.lineIndex / SEG);
        if (segHere !== segNow) { if (segNow >= 0 && !this.crashedAt && this.clock - (this.lapStart || 0) > 3 && !boxMode && !inLane) learnEnd(segNow, segOff, false); segNow = segHere; segOff = 0; }
        segOff = Math.max(segOff, Math.hypot(line.point(this.lineIndex).x - v.x, line.point(this.lineIndex).z - v.z));
        var allowed = Infinity;
        // (as far ahead as 0.35 s at its speed: the brakes and the tyres need that long; 8 m was 0.16 s at 50 m/s, and it came into the bends 10 to 20 % too fast)
        var reach = Math.min(40, n - 1, Math.max(4, Math.round(speed * 0.35 / line.step) || 4));
        for (var j = 0; j <= reach; j++) { var kj = ((this.lineIndex + j) % n + n) % n; allowed = Math.min(allowed, speeds[kj]); }
        allowed = Math.min(allowed * this.paceFactor, this.paceCap, blockerCap);
        if (inLane) allowed = Math.min(allowed, laneSpeed);  // the pit lane: slowly, and to a stop at the box
        if (boxMode) allowed = Math.min(allowed, boxSpeed);      // to the box and back: slowly
        if (atStop) allowed = 0;                            // at the box, until the stop is done
        var error = allowed - speed;
        if (error > 0.5) { this.throttle = Math.min(1, 0.3 + error * 0.25); this.brakePedal = 0; }
        else if (error < -0.5) { this.throttle = 0; this.brakePedal = Math.min(1, -error * 0.3); }          // (full brake at 3.3 m/s too fast: 0.18 needed 5.5)
        else { this.throttle = 0.15 + error * 0.2; this.brakePedal = 0; }
        // (a stop that does not begin, the car standing still and no pit stop going: a pit lane of the track editor that misses the boxes, more cars than boxes. It
        // waited there for the rest of the race, in the way of the others: after six seconds it gives up the stop and drives on)
        if (atStop && speed < 1 && !this.pit.active) this.stopWait = (this.stopWait || 0) + delta; else if (!atStop) this.stopWait = 0;
        // (a box: the way out, phase 2, which counts the stop at its end; going back to phase 0 next to the box it pitted again at once. The lane: on through it)
        if (atStop && this.stopWait > 6) { this.stopWait = 0; atStop = false; if (boxMode) this.pitPhase = 2; else this.laneStopped = true; }
        if (atStop) { this.throttle = 0; this.brakePedal = Math.max(this.brakePedal, speed < 1 ? 1 : 0.2); this.stuck = 0; return; }
        // waiting behind a car that stands (the player who spun, a car that crashed, the queue at a stop in the pit lane): it stands too, and that is no being stuck
        // (it crept, reversed into the car behind and was put back as crashed, with the speeds there cut). After six seconds it goes round it
        // (and when that does not get it 8 m on in 15 s, wedged against the car or no room beside it, it is put back further along: no crash, so no speeds are cut)
        if (this.blockAnchor && Math.hypot(v.x - this.blockAnchor.x, v.z - this.blockAnchor.z) > 8) this.blockAnchor = null;
        if (this.blockAnchor && this.clock - this.blockAnchor.t > 15 && !options.vehicle) {
            this.blockAnchor = null; this.crashedAt = this.clock; this.crashWait = 0; this.crashReason = "blocked"; return;
        }
        if (blocker && blockerCap < 0.5 && speed < 1) {
            if (!this.blockAnchor) this.blockAnchor = { x: v.x, z: v.z, t: this.clock };
            this.blockWait = (this.blockWait || 0) + delta;
            if (this.blockWait < 6) {
                this.throttle = 0; this.brakePedal = 1; this.reverse = false;
                this.stuck = 0; this.lostFor = 0; this.stillFor = 0; this.anchor = null; this.laneStuck = 0;
                return;
            }
            this.ignoreBlocker = blocker.vehicle; this.ignoreUntil = this.clock + 5; this.blockWait = 0;
        } else this.blockWait = 0;
        if (speed < 2 && v.clutchEngagement < 0.5) this.throttle = Math.max(this.throttle, 0.5);
        // a motorcycle rolls the throttle on, and less of it the more it leans: from 0.1 to full in one frame at 35 m/s and 10 degrees the rear stepped out and the bike spun
        if (this.leanFromBend) {
            var leanNow = Math.abs(v.lean || 0), bikeLean = ((config.motorcycle && config.motorcycle.max_lean_deg) || 50) * Math.PI / 180;
            var leanCap = 1 - 0.7 * Math.min(1, leanNow / bikeLean);
            var rolled = (this.rolledThrottle || 0) + 2.5 * delta;
            this.throttle = Math.min(this.throttle, leanCap, rolled);
            this.rolledThrottle = this.throttle;
        }
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
        // stuck in the pit lane (against its wall, not at the stop): it was never put back, and stood there for the rest of the race
        if ((inLane || boxMode) && !atStop && speed < 1 && this.throttle > 0.3) this.laneStuck = (this.laneStuck || 0) + delta; else this.laneStuck = 0;
        if (this.laneStuck > 10) { this.lostFor = 99; inLane = boxMode = false; }
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

    // After a reset an AI car is a ghost for a while (GHOST_TIME seconds): half see-through, and the other cars go through it (their shells and discs do not see it;
    // the road and the walls still work). Two cars put back at the same place no longer hit each other, and the player cannot run into a car that has just appeared.
    var ghostSaved = [];
    function ghostLook(on) {
        if (!on) {
            ghostSaved.forEach(function (e) {
                if (!e.own) { e.mesh.material = e.orig; e.mat.dispose(); }
                else { e.mat.transparent = e.transparent; e.mat.opacity = e.opacity; e.mat.depthWrite = e.depthWrite; e.mat.needsUpdate = true; }
            });
            ghostSaved.length = 0;
            return;
        }
        if (ghostSaved.length) return;
        [self.body].concat(self.wheels.map(function (w) { return w.object; })).forEach(function (root) {
            if (!root) return;
            root.traverse(function (mesh) {
                if (!mesh.isMesh || !mesh.material) return;
                var own = !!mesh.userData.sbOriginal;        // (a material of the bent shell is this car's own; the others are shared with the cars of the same model: a copy)
                var orig = mesh.material;
                var list = Array.isArray(orig) ? orig : [orig];
                var used = list.map(function (material) {
                    var m = own ? material : material.clone();
                    ghostSaved.push({ mesh: mesh, orig: orig, own: own, mat: m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
                    m.transparent = true; m.opacity = 0.4; m.depthWrite = false; m.needsUpdate = true;
                    return m;
                });
                if (!own) mesh.material = Array.isArray(orig) ? used : used[0];
            });
        });
    }
    this.setGhost = function (seconds) {
        this.ghostLeft = seconds;
        this.vehicle.ghost = seconds > 0;
        ghostLook(seconds > 0);
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
        this.pitting = false; this.pitPhase = 0; this.laneStopped = false; this.laneStuck = 0;      // (put back beside the track: out of the pits)
        if (this.parts && this.parts.moved) this.parts.moved();
        this.lostFor = 0; this.overFor = 0; this.stuck = 0; smoothSteer = 0; this.reverse = false; speedTrail.length = 0;        // (the stop of the reset is no hit)
        this.anchor = null; this.stillFor = 0;
        this.throttle = 0; this.brakePedal = 1; this.turnAngle = 0;
        this.recovered = (this.recovered || 0) + 1;
        this.setGhost(GHOST_TIME);
        this.updateVisuals();
    };

    this.update = function (delta, others) {
        if (!this.loaded) return;
        this.clock += delta;
        // the glass of an AI car is see-through (opacity), not refracting: the transmission of three.js draws the scene a second time for the glass of every car, and showed
        // black blocks on the glass of the AI cars (the materials of a car are its own: the player's car keeps its glass)
        if (!this.glassDone && this.body.children.length && !options.vehicle) {
            this.glassDone = true;
            this.body.traverse(function (mesh) {
                if (!mesh.isMesh || !mesh.material) return;
                (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(function (m) { if (m.transmission > 0) { m.transmission = 0; m.needsUpdate = true; } });
            });
        }
        if (this.ghostLeft > 0 && (this.ghostLeft -= delta) <= 0) this.setGhost(0);
        if (line && typeof getSurface === "function" && (Math.abs(getSurface("road").static - speedsGrip) > 0.03 || Math.abs(tyresNow() - speedsTyres) > 0.03)) buildSpeeds();
        if (this.crashedAt) {
            // crashed: it stands (no throttle, the brakes on, no steering) until the wait is over, then it is put back at the side of the track
            this.throttle = 0; this.brakePedal = 1; this.turnAngle = 0; this.reverse = false;
            if (this.clock - this.crashedAt >= this.crashWait) { this.crashedAt = 0; this.putBack(); }
        }
        else this.drive(delta, others);
        this.vehicle.updateControls(delta);
        // the simulation options (Settings, tab Simulation): an AI car far from the player's car, or all of them, do not step their shell (no new dents, a lot less time)
        var sim = OpenRacer.sim, own = this.vehicle;
        if(sim && !options.vehicle && own.softBody) {
            var focus = sim.focus;
            own.shellSkip = sim.aiDamage === "off" || (sim.aiDamage === "near" && !!focus && Math.hypot(own.px - focus.px, own.pz - focus.pz) > sim.range);
            own.softBody.minSteps = sim.aiSteps;
        }
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
            this.lapStartBefore = this.lapStart;
            this.lapStart = this.clock;
            maxFraction = 0;
            // the fuel a lap takes, for the decision to pit (a lap with a stop in it does not count)
            if (fuelAtLapStart !== null && !this.pittedThisLap) fuelPerLap = Math.max(fuelPerLap || 0, fuelAtLapStart - this.vehicle.fuel);
            fuelAtLapStart = this.vehicle.fuel;
            this.pittedThisLap = false;
        } else if (fraction > 0.8 && lastFraction < 0.2 && this.lapsCompleted > 0 && maxFraction < 0.2) {
            this.lapsCompleted--; // went back over the line
            // (and that lap is undone: its time stayed, and going forward again gave a lap of a few seconds, the "best lap" of that car)
            if (this.lapTimes.length) this.lapTimes.pop();
            if (this.lapStartBefore !== undefined) this.lapStart = this.lapStartBefore;
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
            if (v.wheelLost && v.wheelLost[i] && !(v.soloWheels && (i === 1 || i === 3))) continue;      // (a wheel that came off lies on the road: it does not steer or spin with the car)
            wheel.object.position.set(wheel.center.x, wheel.center.y, wheel.center.z);
            wheel.object.quaternion.copy(this.body.quaternion);
            wheel.turn(wheel.steerNow !== undefined ? wheel.steerNow : (i < 2 ? v.steerApplied : 0));
            wheel.object.children[0].children[0].rotation.x = wheel.spin;
            if (this.head && i === 1) OpenRacer.updateFork(this.head, wheel, this.body, v.steerApplied);
            OpenRacer.PitStop.showChange(this.pit, i, wheel.object, this.body.quaternion);
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

var sphereBuffer = new Float64Array(7 * 2);
var rigidContacts = [];
// Two rigid cars: every sphere of one against every sphere of the other. The cars are pushed apart along the horizontal line between the spheres and exchange momentum
// along it (with a turn from the hit off the middle), the push and the impulse shared over the spheres that touch. Returns false when no sphere touches (the discs then
// have the say, as before: a car without spheres has none).
function rigidPair(a, b) {
    var ra = a.boundRadius(), rb = b.boundRadius();
    var ddx = b.px - a.px, ddy = b.py - a.py, ddz = b.pz - a.pz, reach = ra + rb;
    if (ddx * ddx + ddy * ddy + ddz * ddz > reach * reach) return true;      // too far apart for any sphere: done
    var na = a.proxy3.length, nb = b.proxy3.length, count = 0;
    var A = new Float64Array(7 * na), B = new Float64Array(7 * nb), ca = 0, cb = 0;
    for (var i = 0; i < na; i++) if (a.sphereWorld(i, A, 7 * ca)) ca++;
    for (var j = 0; j < nb; j++) if (b.sphereWorld(j, B, 7 * cb)) cb++;
    rigidContacts.length = 0;
    for (var p = 0; p < ca; p++) {
        for (var q = 0; q < cb; q++) {
            var dx = B[7 * q] - A[7 * p], dy = B[7 * q + 1] - A[7 * p + 1], dz = B[7 * q + 2] - A[7 * p + 2];
            var rr = A[7 * p + 3] + B[7 * q + 3], d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= rr * rr) continue;
            var h = Math.hypot(dx, dz);
            if (h < 1e-4) continue;
            var d = Math.sqrt(d2);
            rigidContacts.push({ nx: dx / h, nz: dz / h, overlap: (rr - d) * (h / d), x: (A[7 * p] + B[7 * q]) / 2, z: (A[7 * p + 2] + B[7 * q + 2]) / 2 });
        }
    }
    count = rigidContacts.length;
    if (!count) return true;
    var share = 1 / Math.min(count, 6), restitution = 0.25, total = a.mass + b.mass;
    for (var c = 0; c < count; c++) {
        var k = rigidContacts[c], nx = k.nx, nz = k.nz;
        var push = k.overlap * share;
        a.px -= nx * push * (b.mass / total); a.pz -= nz * push * (b.mass / total);
        b.px += nx * push * (a.mass / total); b.pz += nz * push * (a.mass / total);
        var vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (vn > 0) continue;
        var jImp = -(1 + restitution) * vn / (1 / a.mass + 1 / b.mass) * share;
        a.vx -= jImp * nx / a.mass; a.vz -= jImp * nz / a.mass;
        b.vx += jImp * nx / b.mass; b.vz += jImp * nz / b.mass;
        // the turn: the impulse at the place of the hit (r x F, the y part), as the discs did with their arm
        var rax = k.x - a.px, raz = k.z - a.pz, rbx = k.x - b.px, rbz = k.z - b.pz;
        a.wy -= 0.5 * (raz * (-jImp * nx) - rax * (-jImp * nz)) / a.yawInertia;
        b.wy -= 0.5 * (rbz * (jImp * nx) - rbx * (jImp * nz)) / b.yawInertia;
        if (-vn * 0.5 > (a.lastImpact || 0) || a.impactTime > 0.5) a.lastImpact = -vn * 0.5;
        if (-vn * 0.5 > (b.lastImpact || 0) || b.impactTime > 0.5) b.lastImpact = -vn * 0.5;
        a.impactTime = 0; b.impactTime = 0;
    }
    return true;
}
OpenRacer.collideCars = function (vehicles) {
    var restitution = 0.25;
    for (var i = 0; i < vehicles.length; i++) {
        var soft = vehicles[i];
        if (!soft.otherCars) continue;
        soft.otherCars.length = 0;
        if (!soft.softBody || soft.shellSkip) continue;
        // (the shells hit each other only when both are stepped; any other pair is a pair of rigid bodies, below)
        for (var s = 0; s < vehicles.length; s++) if (s !== i && !vehicles[s].ghost && !soft.ghost && vehicles[s].softBody && !vehicles[s].shellSkip && Math.abs(soft.py - vehicles[s].py) < 6) soft.otherCars.push(vehicles[s]);
    }
    for (var i = 0; i < vehicles.length; i++) {
        for (var j = i + 1; j < vehicles.length; j++) {
            var a = vehicles[i], b = vehicles[j];
            if (a.ghost || b.ghost) continue;
            if (Math.abs(a.py - b.py) > 2.5) continue;
            // a pair where a shell is not stepped (damage off, an AI car far away, Settings > Simulation) is a pair of rigid bodies: they hit each other with the spheres of
            // the model (the nodes of the shell, where they are), not with the two discs at the axles, which kept the cars too far apart
            if (!(a.softBody && !a.shellSkip && b.softBody && !b.shellSkip) && a.sphereWorld && b.sphereWorld && rigidPair(a, b)) continue;
            var ra = a.halfWidth + 0.15, rb = b.halfWidth + 0.15;
            if (a.softBody && b.softBody && !a.shellSkip && !b.shellSkip && a.ground && a.ground.use3D && b.ground && b.ground.use3D) { ra -= 0.35; rb -= 0.35; }
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

// The grip that a car holds, as the skidpad measured it (main.js), kept in this browser per car and setup: the AI drives the bends with it (a share of it, the skill). The key
// is the car and a hash of its whole configuration, so a changed setup is a car that has not been measured yet.
OpenRacer.SkidpadGrip = {
    key: function (config) {
        // (the keys sorted at every level: the same setup gives the same text however its object was put together)
        function stable(value) {
            if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
            if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(value[k]); }).join(",") + "}";
            return JSON.stringify(value);
        }
        var copy = {};
        // (setupName is the key of the records, main.js withTune: not part of the car)
        Object.keys(config || {}).forEach(function (k) { if (["name", "description", "preview", "folder", "source", "model", "tunes", "setupName"].indexOf(k) < 0) copy[k] = config[k]; });
        var text = stable(copy), hash = 5381;
        for (var i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
        return "openracer.grip." + ((config && config.id) || "car") + "." + hash.toString(36);
    },
    get: function (config) {
        try { var kept = JSON.parse(localStorage.getItem(this.key(config)) || "null"); return kept && kept.g > 0.3 && kept.g < 4 ? kept.g : null; } catch (e) { return null; }
    },
    set: function (config, g) {
        try { localStorage.setItem(this.key(config), JSON.stringify({ g: Math.round(g * 1000) / 1000 })); } catch (e) { /* no storage */ }
    }
};
