/*
    OpenRacer,
    Copyright (C) 2015 Chris Barnard

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/*
 * Vehicle.js
 *
 * Description: The physics of the car, without any 3D objects, so it can run (and be tested) on its own. The way it is built
 *              follows "Programming vehicles in games" of Wassim Alhajomar (wassimulator.com): three parts that are coupled
 *
 *                engine, gearbox, clutch, differential  <-- wheel speed / engine speed -->  wheels with tyres
 *                                                                                            |  forces at the contact patches
 *                chassis: a rigid body in 3D  <-----------------------------------------------+
 *                  (gravity, aerodynamics, the road, walls)   --- weight, momentum ---> the load on every tyre
 *
 *              - The chassis is a rigid body in three dimensions: a position, an orientation, a velocity and an angular velocity,
 *                with a mass and an inertia. It can pitch, roll, jump and flip over.
 *              - Every wheel hangs on a spring and damper (and an anti-roll bar). A ray from the mount of the wheel finds the
 *                road (see Ground.js); how far the spring is pushed in gives the force on the car and the load on the tyre. The
 *                weight and the momentum of the car reach the tyres through these springs, instead of a formula for it.
 *              - The tyre makes a longitudinal force from the slip ratio and a lateral force from the slip angle (Pacejka's
 *                magic formula, see Wheel.js), limited by a friction ellipse. The forces are applied to the chassis at the
 *                contact patches, where the tyre touches the road.
 *              - The engine has inertia and can stall. A friction clutch (that can slip) couples it to the wheels through the gearbox
 *                and a differential; the wheels have their own inertia, brakes and slip against the road.
 *
 *              Axes of the body and the world: x to the left, y up, z forward (the way the 3D models are made). The heading psi is
 *              the direction of the car on the ground plane, from +x towards +z. u is the speed forward, v the speed to the right and r
 *              the yaw rate (positive = turning right) of the car.
 */

OpenRacer.Vehicle = function (parameters, input) {
    var G = 9.81;
    var self = this;

    // A motorcycle ("type": "motorcycle" in car.json, see MOTORCYCLE.md): the same physics, with a pair of wheels at both ends (no track between them), and a rider
    // who keeps the bike up: a torque about the long axis that holds the lean the corner asks for (a_lateral = g tan(lean)) and damps the fall
    this.controller = parameters.motorcycle ? new OpenRacer.Motorcycle(parameters.motorcycle) : null;
    // the simple tyre (the AI cars, Opponent.js): rays along the suspension find the road and a slip curve gives the grip (Wheel.tyreForce), instead of the shell of nodes of
    // TyreShell.js, which costs most of the time of a car; the car is otherwise the same (the suspension, the engine, the body, the soft body)
    this.simpleTyres = !!parameters.simpleTyres;   // (Motorcycle.js; a car has none, and goes through none of its hooks)
    this.lean = 0;                    // how far the bike leans to the left (rad; negative: to the right)
    this.input = input; // throttle, brakePedal, clutch, clutchPedalPresent, handbrake, turnAngle, neutral, reverse, manualGearbox, current_gear
    this.mass = parameters.mass;
    this.wheelbase = parameters.wheelbase;
    this.front_track = parameters.front_track;
    this.rear_track = parameters.rear_track;
    this.weight_distribution = parameters.weight_distribution;
    this.Cdrag = parameters.Cdrag;
    // the air on the body: downforce per axle in N per (m/s)^2 (negative is lift, as a road car has); "downforce" alone is split by the
    // weight distribution. The balance changes with the speed: a car with more downforce at the rear understeers more the faster it goes.
    this.downforce = parameters.downforce || 0;
    this.downforceFront = parameters.downforce_front !== undefined ? parameters.downforce_front : this.downforce * (parameters.weight_distribution || 0.5);
    this.downforceRear = parameters.downforce_rear !== undefined ? parameters.downforce_rear : this.downforce * (1 - (parameters.weight_distribution || 0.5));
    // Ackermann: in a bend the inner front wheel steers more than the outer one, so both roll around the same point (1: the
    // full geometry, 0: parallel; a racing car has some of it)
    this.ackermann = parameters.ackermann !== undefined ? parameters.ackermann : 0.6;
    // Tyre pressure (bar) per axle: the band is stiffest and grips best around 2.2 bar; lower it is softer (less stiff against the
    // slip angle, more rolling resistance, more heat, a stiffer ride is not), higher it is stiffer with a smaller patch. Toe (degrees,
    // positive is toe-in: the wheels point a little inwards) per axle: toe-in at the rear calms the car, toe-out at the front sharpens it.
    this.pressureFront = parameters.pressure_front || 2.2;
    this.pressureRear = parameters.pressure_rear || 2.2;
    this.toeFront = parameters.toe_front || 0;
    this.toeRear = parameters.toe_rear || 0;
    this.corneringScale = 1;
    this.applyPressure = function () {
        for(var i = 0; i < 4; i++) {
            var w = this.wheels[i];
            var p = Math.max(0.15, (w.front ? this.pressureFront : this.pressureRear) - (w.pressureLoss || 0));      // (a puncture takes pressure away)
            var off = (p - 2.2) / 0.8;                                   // 0.8 bar off the optimum
            w.pressureGrip = Math.max(0.6, 1 - 0.08 * off * off);           // the grip of the patch: 0.8 bar off costs 8 %
            w.pressureCorner = Math.max(0.7, Math.min(1.25, 1 + 0.15 * (p - 2.2)));   // the stiffness of the sidewall against the slip angle
            w.pressureRoll = Math.sqrt(2.2 / p);                            // rolling resistance and heat
            w.tyreRate = this.tyreRate * Math.pow(p / 2.2, 0.8);            // the stiffness of the tyre as a spring
            w.anglePeak = this.baseAnglePeak / (this.corneringScale * w.stiffnessBias * w.pressureCorner);
            w.condition = (w.condition || 1); // taken up with the wear in wearStep
        }
    };
    // the wheel with its tyre, brake and hub is a mass of its own on the spring (kg per wheel), standing on the tyre, which is a
    // stiff spring (N/m) with a little damping (Ns/m): this is what takes the edge off a kerb
    // a light vehicle (a kart: 200 kg) has light wheels and a softer tyre: the values for a car would make the wheels most of its mass and the tyre far too stiff for its load
    var lightScale = (parameters.mass || 1230) < 600 ? (parameters.mass || 1230) / 1230 : 1;
    this.unsprungMass = parameters.unsprung_mass || (lightScale < 1 ? Math.max(2, 0.0285 * parameters.mass) : 35);
    this.tyreRate = parameters.tyre_rate || 220000 * Math.sqrt(lightScale);
    this.tyreDamping = parameters.tyre_damping || 3000 * Math.sqrt(lightScale);
    // The roll centres: the height (m above the road) at which the suspension of an axle passes the lateral force of its tyres
    // to the body. The part of the load transfer below it goes through the linkage at once (geometric), only the rest rolls the
    // body on its springs. A higher roll centre: less roll, quicker response, a little jacking.
    this.rollCentreFront = parameters.roll_center_front !== undefined ? parameters.roll_center_front : 0.06;
    this.rollCentreRear = parameters.roll_center_rear !== undefined ? parameters.roll_center_rear : 0.12;
    // Camber: the lean of the wheels (degrees; negative is the top in, as it is set on a car that corners), and how much the
    // wheels lean with the body when it rolls (1: like a live axle keeps them upright... no: 0 keeps them upright, 1 leans them fully)
    this.camberFront = parameters.camber_front || 0;
    this.camberRear = parameters.camber_rear || 0;
    this.rollCamber = parameters.roll_camber !== undefined ? parameters.roll_camber : 0.6;
    this.liveAxle = { front: !!parameters.live_axle_front, rear: !!parameters.live_axle_rear };   // the wheels of a live axle lean with the axle (the travel of the two wheels), not with the roll of the body
    this.camberGain = 0.5;            // a degree of lean is worth this many degrees of slip angle (camber thrust)
    var axleFy = [0, 0];              // the lateral force of each axle in the last step, for the geometric load transfer
    this.gear_ratios = parameters.gear_ratios;
    this.final_drive = parameters.final_drive;
    this.getSurface = parameters.getSurface;
    this.ground = null;               // the road (Ground.js, or anything with query(x, z, y, above)); without it the road is flat at 0

    this.cgHeight = parameters.cgHeight || 0.55;
    this.length = parameters.length || 4.8;
    this.width = parameters.width || 1.8;
    this.bodyHeight = parameters.height || 1.3;

    // ---- the suspension (all of the values per wheel)
    this.rollFrontShare = parameters.roll_front || 0.55;      // share of the roll stiffness at the front (the anti-roll bars make up the difference)
    this.frontWheelRate = parameters.spring_front || 29000;   // spring stiffness at the wheel (N/m)
    this.rearWheelRate = parameters.spring_rear || 27000;
    this.frontDamping = parameters.damping_front || 0.35;     // damping ratio when the spring is pushed in (rebound is stiffer)
    this.rearDamping = parameters.damping_rear || 0.35;
    this.reboundFactor = parameters.damping_rebound || 1.7;    // the damper is this much stiffer when the spring goes out (rebound) than when it is pushed in
    this.springProgression = parameters.spring_progression || 0;   // 0: a linear spring; 1: the spring is twice as stiff at the end of the bump travel as at rest (a progressive spring, as the long travel of an off-road car needs)
    this.restLength = parameters.suspension_length || 0.28;   // from the mount to the middle of the wheel, at rest (m): the room that the travel has
    // the ride height per axle: how much further out (positive) or in the wheels of an axle sit at rest than that (m); it raises or
    // lowers the body there, with its centre of gravity, and gives it rake when the two differ
    this.rideFront = parameters.ride_front || 0;
    this.rideRear = parameters.ride_rear || 0;
    this.bumpTravel = Math.min(parameters.suspension_travel || 0.09, Math.max(0.05, (parameters.suspension_length || 0.28) - 0.05)); // how much further the spring can go in before the bump stop (m)
    this.unsprung = !!parameters.unsprung;   // no suspension (a kart: the frame stands on its tyres): the wheel is fixed at its rest length and the load of the tyre goes straight into the body; the tyre is the only spring
    this.groundClearance = 0.13;      // of the underside of the body at rest (m)

    this.engine = new OpenRacer.Engine(parameters.engine);
    this.driveEfficiency = parameters.efficiency || 0.92;
    this.reverseRatio = parameters.reverse_ratio || parameters.gear_ratios[0];
    // the clutch is made for the engine: it holds a good deal more than the peak torque
    this.clutchCapacity = 1.5 * this.engine.getPeakTorque(); // the most torque the clutch can transmit when fully engaged (Nm)
    this.driveType = parameters.drive === "fwd" || parameters.drive === "awd" ? parameters.drive : "rwd"; // which wheels get the engine torque
    this.frontDriven = this.driveType === "fwd";             // (the front wheels are the only driven ones)
    this.diffType = parameters.diff === "open" || parameters.diff === "welded" ? parameters.diff : "lsd"; // the differential(s) between the wheels of an axle
    this.centerType = parameters.center_diff === "open" || parameters.center_diff === "locked" ? parameters.center_diff : "lsd"; // between the axles, when all wheels are driven
    this.centerSplit = parameters.center_split !== undefined ? parameters.center_split : 0.4; // the share of the torque to the front axle
    this.clutchSlipSpeed = 1.5;       // slip speed (rad/s) at which the clutch reaches its full capacity
    this.clutchEngagement = 1;        // how hard the clutch is clamped (0..1)
    // The differential between the two wheels of an axle: "open" sends the same torque to both wheels, so the wheel with the least grip decides how much
    // there is; "lsd" (limited slip) locks: a preload, a part of the torque that is driven (under power, and less on the throttle off) and
    // how fast it builds up with the speed difference; "welded" turns both wheels at the same speed (as a locked axle does).
    this.lockTorque = parameters.diff_preload !== undefined ? parameters.diff_preload : 150;  // preload (Nm)
    this.lockStiffness = parameters.diff_lock !== undefined ? parameters.diff_lock : 60;      // how fast it builds up (Nm per rad/s)
    this.lockPower = parameters.diff_power !== undefined ? parameters.diff_power : 0.3;       // locks harder under power (share of the torque)
    this.lockCoast = parameters.diff_coast !== undefined ? parameters.diff_coast : 0.1;       // and a little when the throttle is off
    this.centerPreload = 100;         // the same for the differential between the axles (all wheel drive)
    this.centerStiffness = 150;
    this.centerPower = 0.3;
    this.isDriven = function (front) {
        return this.driveType === "awd" || (this.driveType === "fwd") === front;
    };

    this.tyreDamage = false;          // a hard hit can puncture a tyre: it leaks and loses its pressure (applyPressure, the grip and the stiffness follow)
    this.tyreShell = { width: 0, rings: 3, segments: 36, inner_ratio: 0.62, carcass: 0 };      // the tread of the tyre (TyreShell.js): rings across the tread, nodes round the wheel, the width (m, 0: from the wheel), the inner shell and the carcass
    // the shell of one wheel: its own (wheel.tyreSpec, a tyre of the wheel library: WheelLibrary.js, set by Car.js) where it says, the shared one for the rest
    this.tyreShellOf = function (w) {
        var s = this.tyreShell, t = w.tyreSpec;
        if(!t) return s;
        return { width: t.width > 0 ? t.width : s.width, rings: t.rings > 0 ? t.rings : s.rings, segments: t.segments > 0 ? t.segments : s.segments,
            inner_ratio: t.inner_ratio > 0 ? Math.max(0.3, Math.min(0.9, t.inner_ratio)) : s.inner_ratio, carcass: t.carcass !== undefined && t.carcass !== null ? Math.max(0, t.carcass) : s.carcass };
    };
    this.tyreStiffX = 20;              // the stiffness of the tyre of nodes along and across (per N of load)
    this.tyreStiffY = 18;
    this.tcAllowance = 1;             // tuning: how much wheel spin the traction control allows, as a factor
    this.escGain = 1;                 // tuning: how hard the stability control steps in, as a factor
    // the systems the car has (the tuning menu); a system that is not fitted does nothing, whatever its key says
    this.tcFitted = parameters.tc_fitted !== false; this.absFitted = parameters.abs_fitted !== false; this.escFitted = parameters.esc_fitted !== false;
    this.launchControlFitted = parameters.launch_control_fitted !== false; this.twoStepFitted = parameters.two_step_fitted !== false;
    this.tcEnabled = false;           // traction control: takes power off when the driven wheels spin
    this.escEnabled = false;          // stability control (see step())
    this.absEnabled = true;
    this.tcFactor = 1;
    // Launch: the two-step key, the transbrake key and the launch control (an option). While the car is held for a launch the clutch is open and the
    // engine turns freely to its held speed (the lower limit, Engine.js: holdRPM); letting go engages the clutch fast, and the traction control (also
    // when it is off) keeps the wheels at the grip for the first part of the launch.
    this.twoStepEnabled = false;       // the option: the clutch (or the two-step key) at a standstill holds the engine at the two-step speed
    this.twoStepActive = false;
    this.launchControlEnabled = false; // the option: brake and full throttle at a standstill hold the engine speed, letting go of the brake launches
    this.lcArmed = false;              // the launch control holds the engine now
    this.transbrakeHeld = false;       // the transbrake key holds the car now
    this.launchRelease = 0;            // s left of the ramp of the clutch after a launch
    this.launching = 0;                // s left of the launch, with the traction control on
    this.escLevel = 0;                // how hard the stability control works (0..1)
    this.yawWanted = 0;               // the yaw rate the steering asks for, as the car can follow it (it needs a moment to turn)
    this.steerApplied = 0;            // the angle of the front wheels
    this.understeerGradient = 0.0008; // (rad s^2/m) of the car, to know what the car does at a steering angle; set by layout() from the car
    this.clutchStartRPM = parameters.clutch_start_rpm || 1050;      // the automatic clutch starts to grip here and grips fully at clutchFullRPM (a kart with a centrifugal clutch: later)
    this.clutchFullRPM = parameters.clutch_full_rpm || 2000;
    this.shiftTime = parameters.shift_time || 0.32; // how long a shift of the gearbox takes without a clutch pedal (s)
    // a CVT (gearbox "cvt"): no gears but a ratio that goes smoothly between the first and the last of gear_ratios (cvt_low, cvt_high), chosen to hold the engine at the
    // speed the throttle asks for (idle to cvt_rpm at full throttle; a little above idle off the throttle, more on the brakes: engine braking), the belt moving at a
    // limited pace (cvt_rate: the ratio changes by at most e^rate a second)
    // an automatic with a torque converter (gearbox "torque-converter"): the gears and the shifting of the automatic, but a fluid coupling instead of the clutch: the pump on the
    // engine takes C w_e^2 (1 - SR) (SR the speed ratio turbine/pump; C from tc_stall_rpm: the engine's peak torque holds it at that speed with the turbine still), the turbine
    // gives that times the torque ratio (tc_ratio at stall, 1 from a speed ratio of 0.85), a lock-up clutch closes above 25 km/h once the slip is small (tc_lockup), and at idle
    // the coupling is a sixth of itself, so the car creeps gently and the brakes hold it
    // a dual-clutch gearbox (gearbox "dct"): the gears and the shifting as with a clutch, but the next gear waits on the other clutch, so a shift is a hand-over of 0.15 s at most
    // in which the drive never stops (the clutch keeps 40 % and goes to full as the engine is pulled to the new speed), with a short cut of the throttle on an upshift and a
    // blip on a downshift
    // an automated manual (gearbox "amt"): the gears of a manual with a clutch and a shift that a robot does: slow (half a second at least) with the power off, and the shifting of
    // an automatic. A manual with an automatic clutch (gearbox "imt"): the driver shifts, the clutch is never a pedal.
    var GEARBOXES = ["gears", "cvt", "torque-converter", "dct", "amt", "imt"];
    this.gearbox = GEARBOXES.indexOf(parameters.gearbox) > 0 ? parameters.gearbox : "gears";
    this.shiftDuration = 0;                                  // how long the shift that is going on takes (s)
    this.shiftUp = false;                                    // the shift that is going on is an upshift
    this.tcStallRPM = parameters.tc_stall_rpm || 0;          // (0: 35 % of the rev limit)
    this.tcRatio = parameters.tc_ratio || 1.9;
    this.tcLockup = parameters.tc_lockup !== false;
    this.tcLock = 0;                                         // the lock-up clutch, 0 to 1
    this.tcSlip = 0;                                         // the speed ratio of the converter (for the debugging and the HUD)
    this.cvtLow = parameters.cvt_low || parameters.gear_ratios[0];
    this.cvtHigh = parameters.cvt_high || parameters.gear_ratios[parameters.gear_ratios.length - 1];
    this.cvtRPM = parameters.cvt_rpm || 0;                 // (0: 85 % of the rev limit)
    this.cvtRate = parameters.cvt_rate || 1.8;
    this.cvtRatio = this.cvtLow;
    this.shiftTimer = 0;
    this.lastGearKey = null;
    this.timeSinceShift = 10;

    // ---- the state of the chassis: a rigid body
    this.px = 0; this.py = 0; this.pz = 0;                     // the centre of gravity in the world
    this.qx = 0; this.qy = 0; this.qz = 0; this.qw = 1;        // the orientation of the body
    this.vx = 0; this.vy = 0; this.vz = 0;                     // the velocity of the centre of gravity
    this.wx = 0; this.wy = 0; this.wz = 0;                     // the angular velocity (in the world)
    // what the rest of the game wants to know, kept up to date
    this.x = 0;                       // the position on the ground plane
    this.z = 0;
    this.psi = 0;                     // the heading
    this.u = 0;                       // the speed along the car
    this.v = 0;                       // the speed to the right
    this.r = 0;                       // the yaw rate, positive to the right
    this.ax = 0;                      // the acceleration along and across the car, filtered (m/s^2)
    this.ay = 0;
    this.groundLevel = 0;             // the height of the road under the car
    this.drivelineRPM = 0;            // engine speed implied by the driven wheels in the current gear
    this.airborne = false;            // no wheel touches the road

    // Walls and other things to drive into (see Collision.js); set by the caller
    this.collision = null;
    this.halfLength = this.length / 2;
    this.halfWidth = this.width / 2;
    this.kerbHeight = 0.3;            // things lower than this above the road are driven over
    this.lastImpact = 0;              // speed of the last hit of a wall (m/s), for effects
    this.impactTime = 0;
    this.wallRestitution = 0.2;
    this.wallFriction = 0.1;

    // ---- the wheels: 0 front right, 1 front left, 2 rear left, 3 rear right
    this.brakeFront = parameters.brake_front || 1700;  // largest brake torque per wheel (Nm)
    this.brakeRear = parameters.brake_rear || 900;
    var diameter = parameters.tire_diameter;
    var defs = [
        { name: "FR", right: true,  front: true },
        { name: "FL", right: false, front: true },
        { name: "RL", right: false, front: false },
        { name: "RR", right: true,  front: false }
    ];
    this.wheels = [];
    for(var i = 0; i < 4; i++) {
        var w = new OpenRacer.Wheel({
            name: defs[i].name, diameter: diameter, right: defs[i].right, front: defs[i].front,
            driven: this.isDriven(defs[i].front), mass: 0, maxBrakeTorque: defs[i].front ? this.brakeFront : this.brakeRear,
            inertia: parameters.wheel_inertia || (lightScale < 1 ? 1.6 * lightScale * Math.pow(diameter / 0.632, 2) : 1.6)      // (a kart wheel is a few kg on a small radius, not a car wheel)
        });
        // A car that understeers at the limit is stable: the front tyres give up before the rear tyres. The rear tyres are
        // a little stiffer against the slip angle, as the whole car is (a rear that is too weak spins from a small steering movement).
        w.stiffnessBias = w.front ? 1 : 1.08;
        w.anglePeak = w.anglePeak / w.stiffnessBias;
        w.center = { x: 0, y: 0, z: 0 };    // the middle of the wheel in the world
        w.contact = { x: 0, y: 0, z: 0 };   // where it touches the road
        w.suspensionLength = 0;
        w.susLength = this.restLength;      // the place of the wheel along the suspension (the quarter car, see step)
        w.susVel = 0;
        w.hasContact = false;
        w.heat = 0;                         // how hot the tyre is from sliding (0..1)
        w.smoke = 0;                        // how much smoke it makes (0..1)
        w.roadT = 25;                       // the temperature of the strip of road under it (°C): it heats when the tyre stays on it (a burnout) and is replaced when the car moves (a lock-up)
        w.surfT = 25;                       // the temperature of the surface of the tread (°C): what the slip burns heats a thin layer, see the smoke below
        w.squeal = 0;                       // how loud it squeals (0..1)
        w.normalForce = 0;
        w.temp = 25;                        // the temperature of the tyre (°C), see wearStep
        w.wear = 0;                         // how worn it is (0: new, 1: gone)
        w.condition = 1;                    // the grip that is left from the temperature and the wear, as a factor
        this.wheels.push(w);
    }
    this.baseAnglePeak = this.wheels[0].anglePeak;

    // ---- the tyres and the fuel over a race (off unless the race switches it on: wearEnabled)
    //
    // A tyre has a working window: cold it grips less, overheated too. It warms from sliding (the power that the slip burns) and
    // from flexing under its load, and cools with the air that passes. It wears with the sliding, faster when it is overheated; a
    // worn tyre grips less. The fuel burns with the power of the engine and makes the car lighter as it goes; an empty tank
    // stops the engine. tyreHeating, tyreLife and fuelUse are factors for the tuning; wearScale is the option of the race (1: as it
    // is, 3: three times as fast, for a short race).
    this.wearEnabled = false;
    this.wearScale = 1;
    this.tyreHeating = 1;
    this.tyreLife = 1;
    this.fuelUse = 1;
    this.ambient = 25;
    this.tank = parameters.tank || 60;              // litres
    this.fuel = this.tank;
    this.fuelFlow = 0;                              // litres per second, for the dashboard
    this.baseMass = this.mass;                      // the mass without the fuel
    this.wearLaps = 0;
    var fuelMassTimer = 0;
    // the kind of tyre (Wheel.js, TyreCompounds): the best temperature, the width of the window, how far out the grip is at its least
    var tc = OpenRacer.TyreCompounds[1];
    this.compound = 1;
    this.setCompound = function (c) {
        var list = OpenRacer.TyreCompounds, at = typeof c === "string" ? list.findIndex(function (k) { return k.id === c; }) : (c >= 0 && c < list.length ? Math.floor(c) : -1);
        if(at < 0) at = 1;
        this.compound = at;
        tc = list[at];
        for(var i = 0; i < 4; i++) { var w = this.wheels[i]; w.compoundGrip = tc.grip; w.compoundLoose = tc.looseGrip || 1; w.compoundLooseSlide = tc.looseSlide || 0; w.condition = conditionOf(w) * (w.pressureGrip || 1); }
    };
    this.tyreKind = function () { return tc; };
    this.setCompound(parameters.compound);
    var ROAD_CAPACITY = 2500;                                            // J/K of the strip of road under the tyre that takes the heat
    var SURFACE_SHARE = 0.3, SURFACE_CAPACITY = 350, SURFACE_TAU = 6;    // the share of the burnt power that heats the rubber, the heat that the hot layer takes (J/K), how slowly it gives it away (s)

    function conditionOf(w) {
        var off = Math.max(0, Math.abs(w.temp - tc.optimum) - tc.window) / tc.cold;
        var byTemp = 1 - tc.coldLoss * Math.min(1, off);
        var byWear = 1 - 0.2 * Math.pow(Math.min(1, w.wear), 1.5) - (w.wear >= 1 ? 0.15 : 0);
        return byTemp * byWear;
    }

    // called every step for a wheel: slidePower is the power the slip burns (W), fz the load (N), v the speed over the road (m/s)
    this.wearStep = function (w, dt, slidePower, fz, v, contact) {
        if(!this.wearEnabled) { w.temp = tc.optimum; w.wear = Math.min(w.wear, 1); w.condition = w.pressureGrip || 1; return; }
        // the power of the slip (tens of kW in a bend at the limit) and the flexing under the load heat the tyre; the air cools
        // it (W/K, more the faster); the tread has a heat capacity of about 20 kJ/K, so it takes a minute or two to come up
        var heatIn = (slidePower + (contact ? fz * Math.abs(v) * 0.025 : 0)) * this.tyreHeating * tc.heating * (w.pressureRoll || 1);
        // (the numbers are those of a car tyre, a radius of 0.315 m: a smaller tyre has less rubber to heat and less surface to cool by about the cube of its radius, which is
        // also how its load goes, so a kart tyre comes up to temperature on a lap like a car tyre does, instead of staying cold)
        var size = Math.max(0.04, Math.min(2, Math.pow((w.radius || 0.315) / 0.315, 3)));
        var cooling = (40 + 3 * Math.abs(v)) * size * (w.temp - this.ambient);
        w.temp += (heatIn - cooling) / (20000 * size) * dt;
        var overheated = Math.min(2, Math.max(0, (w.temp - (tc.optimum + tc.window)) / 30));
        // a powerful car spins its wheels a lot: the slip when driving off counts less than a slide through a bend
        var counted = Math.abs(v) < 8 ? slidePower * 0.35 : slidePower;
        w.wear += counted * (1 + 2 * overheated) * dt / (6e6 * this.tyreLife * tc.life) * this.wearScale;
        w.condition = conditionOf(w) * (w.pressureGrip || 1);
    };

    this.fuelStep = function (dt, engineTorque, engineOmega) {
        if(!this.wearEnabled) { this.engine.noFuel = false; return; }
        var power = Math.max(0, engineTorque) * engineOmega;           // W
        // a racing engine burns about four times what the energy alone says (rich mixture, the throttle open and shut all the time)
        this.fuelFlow = (0.0003 + power / (0.25 * 34e6) * 4) * this.fuelUse * this.wearScale * this.engine.fuelFactor;
        this.fuel = Math.max(0, this.fuel - this.fuelFlow * dt);
        this.engine.noFuel = this.fuel <= 0;
        fuelMassTimer += dt;
        if(fuelMassTimer > 1) { fuelMassTimer = 0; this.mass = this.baseMass + this.fuel * 0.75; this.layout(); }
    };

    // new tyres (at the temperature of the blankets) and the fuel that is asked for: a pit stop (Pit.js), or the start of a race
    this.freshTyres = function (temp) {
        for(var i = 0; i < 4; i++) { var w = this.wheels[i]; w.wear = 0; w.temp = temp === undefined ? 60 : temp; w.condition = conditionOf(w) * (w.pressureGrip || 1); }
    };
    // a puncture: the tyre leaks (bar per second); the pressure falls and the grip, the sidewall and the stiffness of the tyre follow (applyPressure)
    this.puncture = function (index, rate) { var w = this.wheels[index]; if(w && !w.leak) w.leak = rate || 0.05 + Math.random() * 0.1; };
    this.repairTyres = function () { for(var i = 0; i < 4; i++) { this.wheels[i].leak = 0; this.wheels[i].pressureLoss = 0; } this.applyPressure(); };
    this.punctured = function () { for(var i = 0; i < 4; i++) if(this.wheels[i].leak) return true; return false; };
    this.maxWear = function () { var m = 0; for(var i = 0; i < 4; i++) m = Math.max(m, this.wheels[i].wear); return m; };

    // ---- geometry that follows from the mass, the weight distribution and the springs
    var arbFront = 0, arbRear = 0;    // anti-roll bars: the force at a wheel per metre that the wheels are pushed in differently
    var inertiaX = 1, inertiaY = 1, inertiaZ = 1;
    // the lean to the left of the two wheels of a live axle, from the travel of its wheels (the left wheel higher: the axle rolls and its wheels lean to the right)
    this.axleLean = function (front) {
        var l = this.wheels[front ? 1 : 2], r = this.wheels[front ? 0 : 3], track = (front ? this.front_track : this.rear_track) || 1.5;
        return -Math.atan2((r.susLength || 0) - (l.susLength || 0), track);
    };
    this.layout = function () {
        this.af = this.wheelbase * (1 - this.weight_distribution); // front axle to the centre of gravity
        this.ar = this.wheelbase * this.weight_distribution;       // rear axle to the centre of gravity
        var radius = this.wheels[0].radius;
        for(var i = 0; i < 4; i++) {
            var w = this.wheels[i];
            var track = w.front ? this.front_track : this.rear_track;
            w.a = w.front ? this.af : -this.ar;                    // forward of the centre of gravity
            w.b = (w.right ? 1 : -1) * track / 2;                  // to the right of it
            w.mass = this.mass * (w.front ? this.weight_distribution : 1 - this.weight_distribution) / 2;
            w.rate = w.front ? this.frontWheelRate : this.rearWheelRate;
            if(this.soloWheels && (i === 0 || i === 2)) { w.mass *= 2; w.rate *= 2; }                         // (a motorcycle: the one wheel of the end carries it all, on the spring of both)
            // (and the front wheel has the inertia of a front wheel with its discs and tyre, 1.2 kg m2 at least: at the 0.33 that the size of a bike gave, the tyre force of a hard brake turned
            // the wheel round in a frame, past the road speed, and back: the force flipped between -3000 and +3000 N about three times a second, and the fork and the rear wheel hopped)
            if(this.soloWheels && this.wheels[i] && this.wheels[i].front && !parameters.wheel_inertia) this.wheels[i].inertia = Math.max(this.wheels[i].inertia, 1.2);
            w.staticLoad = w.mass * G;
            // free length: the spring is pushed in by the weight at rest, to the rest length
            w.restLengthWheel = this.restLength + (w.front ? this.rideFront : this.rideRear); // where the wheel sits at rest
            w.freeLength = w.restLengthWheel + w.staticLoad / w.rate;
            w.minLength = w.restLengthWheel - this.bumpTravel;
            // the mount of the spring on the body (x to the left, y up, z forward) from the centre of gravity
            w.mount = { x: -w.b, y: (radius - this.cgHeight) + this.restLength, z: w.a };
        }
        // the anti-roll bars give the roll stiffness the front share that was asked for
        var Kf = this.frontWheelRate * this.front_track * this.front_track / 2;
        var Kr = this.rearWheelRate * this.rear_track * this.rear_track / 2;
        var share = this.rollFrontShare;
        arbFront = arbRear = 0;
        if(Kf / (Kf + Kr) < share) arbFront = Math.max(0, share * Kr / (1 - share) - Kf) / (this.front_track * this.front_track);
        else arbRear = Math.max(0, Kf * (1 - share) / share - Kr) / (this.rear_track * this.rear_track);
        // the inertia of a box (x: pitch, y: yaw, z: roll)
        var m = this.mass;
        inertiaX = m * (this.bodyHeight * this.bodyHeight + this.length * this.length) / 12;
        inertiaY = m * (this.width * this.width + this.length * this.length) / 12;
        inertiaZ = m * (this.width * this.width + this.bodyHeight * this.bodyHeight) / 12;
        this.yawInertia = inertiaY;
        // The understeer gradient of the car, for the stability control: what the steering asks for at a speed depends on how
        // much each axle has to slip for its share of the weight. K = Wf / Cf - Wr / Cr, with the cornering stiffness of an axle
        // from the slope of its tyres' curve at zero slip (on the road). Positive: the car understeers, the front slips more.
        var road = this.getSurface ? this.getSurface("road") : { static: 1.2, kinetic: 1.06 };
        var C = 2 - (2 / Math.PI) * Math.asin(Math.min(0.98, road.kinetic / road.static));
        var peak = Math.tan(Math.PI / (2 * C));
        var stiffness = [0, 0], weight = [0, 0];
        for(var k = 0; k < 4; k++) {
            var wk = this.wheels[k], axle = wk.front ? 0 : 1;
            // the grip per Newton falls with the load (the load sensitivity): the heavier axle slips more for its share
            var mu = Math.max(0.2, road.static * wk.gripScale - wk.loadSensitivity * (wk.staticLoad - wk.nominalLoad));
            stiffness[axle] += mu * wk.staticLoad * wk.lateralGrip * C * peak / wk.anglePeak;
            weight[axle] += wk.staticLoad;
        }
        // the slope at zero slip overstates what the car does at a real lateral acceleration (the bench measures about half)
        if(stiffness[0] > 0 && stiffness[1] > 0) this.understeerGradient = Math.max(-0.003, Math.min(0.01, 0.45 * (weight[0] / stiffness[0] - weight[1] / stiffness[1])));
    };
    this.layout();
    this.applyPressure();

    // ---- vectors and quaternions
    function rotate(qx, qy, qz, qw, x, y, z, out) {
        // v + 2 w (q x v) + 2 q x (q x v)
        var tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
        out.x = x + qw * tx + (qy * tz - qz * ty);
        out.y = y + qw * ty + (qz * tx - qx * tz);
        out.z = z + qw * tz + (qx * ty - qy * tx);
        return out;
    }

    function rotateInverse(qx, qy, qz, qw, x, y, z, out) {
        return rotate(-qx, -qy, -qz, qw, x, y, z, out);
    }

    // the inverse inertia applied to a torque in the world: R diag(1/I) R^T torque
    var tmpA = { x: 0, y: 0, z: 0 }, tmpB = { x: 0, y: 0, z: 0 };
    function applyInverseInertia(tx, ty, tz, out) {
        rotateInverse(self.qx, self.qy, self.qz, self.qw, tx, ty, tz, tmpA);
        tmpA.x /= inertiaX; tmpA.y /= inertiaY; tmpA.z /= inertiaZ;
        return rotate(self.qx, self.qy, self.qz, self.qw, tmpA.x, tmpA.y, tmpA.z, out);
    }

    // ---- changes while the car drives (the tuning menu), all optional: mass (kg), weight_distribution (front share, 0..1),
    // cg_height, roll_front (share of the roll stiffness at the front), spring_front and spring_rear (N/m at the wheel),
    // damping_front and damping_rear (damping ratio), grip (factor), cornering (factor: the stiffness of the tyres against the
    // slip angle), rolling_resistance, power (factor), idle_rpm, limiter_rpm, engine_inertia, engine_braking (factor), final_drive,
    // gear_ratios, reverse_ratio, clutch (the capacity as a multiple of the peak torque), diff_preload, diff_lock, drive ("rwd" or
    // "fwd"), brake_front, brake_rear (Nm), drag (Cdrag), tc_allowance, esc_gain, downforce.
    this.retune = function (t) {
        var i, w;
        if(t.mass !== undefined) { this.baseMass = t.mass; this.mass = t.mass + (this.wearEnabled ? this.fuel * 0.75 : 0); }
        if(t.compound !== undefined) this.setCompound(t.compound);
        if(t.tyre_heating !== undefined) this.tyreHeating = t.tyre_heating;
        if(t.tyre_life !== undefined) this.tyreLife = t.tyre_life;
        if(t.fuel_use !== undefined) this.fuelUse = t.fuel_use;
        if(t.tank !== undefined) { this.fuel = Math.min(this.fuel, t.tank) + (t.tank > this.tank ? t.tank - this.tank : 0); this.tank = t.tank; }
        if(t.weight_distribution !== undefined) this.weight_distribution = t.weight_distribution;
        if(t.cg_height !== undefined) this.cgHeight = t.cg_height;
        if(t.roll_front !== undefined) this.rollFrontShare = t.roll_front;
        if(t.spring_front !== undefined) this.frontWheelRate = t.spring_front;
        if(t.spring_rear !== undefined) this.rearWheelRate = t.spring_rear;
        if(t.damping_front !== undefined) this.frontDamping = t.damping_front;
        if(t.damping_rear !== undefined) this.rearDamping = t.damping_rear;
        if(t.wheelbase !== undefined) this.wheelbase = t.wheelbase;
        if(t.front_track !== undefined) this.front_track = t.front_track;
        if(t.rear_track !== undefined) this.rear_track = t.rear_track;
        if(t.tire_diameter !== undefined) {
            for(var ti = 0; ti < 4; ti++) { this.wheels[ti].diameter = t.tire_diameter; this.wheels[ti].radius = this.wheels[ti].diameterOver2 = t.tire_diameter / 2; }
        }
        if(t.drive !== undefined) { this.driveType = t.drive === "fwd" || t.drive === "awd" ? t.drive : "rwd"; this.frontDriven = this.driveType === "fwd"; }
        if(t.diff !== undefined) this.diffType = t.diff === "open" || t.diff === "welded" ? t.diff : "lsd";
        if(t.center_diff !== undefined) this.centerType = t.center_diff === "open" || t.center_diff === "locked" ? t.center_diff : "lsd";
        if(t.center_split !== undefined) this.centerSplit = t.center_split;
        if(t.downforce !== undefined) { this.downforce = t.downforce; this.downforceFront = t.downforce * this.weight_distribution; this.downforceRear = t.downforce * (1 - this.weight_distribution); }
        if(t.downforce_front !== undefined) this.downforceFront = t.downforce_front;
        if(t.downforce_rear !== undefined) this.downforceRear = t.downforce_rear;
        if(t.ackermann !== undefined) this.ackermann = t.ackermann;
        if(t.pressure_front !== undefined) this.pressureFront = Math.max(0.8, t.pressure_front);
        if(t.pressure_rear !== undefined) this.pressureRear = Math.max(0.8, t.pressure_rear);
        if(t.toe_front !== undefined) this.toeFront = t.toe_front;
        if(t.toe_rear !== undefined) this.toeRear = t.toe_rear;
        this.applyPressure();
        if(t.shift_time !== undefined) this.shiftTime = t.shift_time;
        if(t.tc_fitted !== undefined) this.tcFitted = !!t.tc_fitted;
        if(t.abs_fitted !== undefined) this.absFitted = !!t.abs_fitted;
        if(t.esc_fitted !== undefined) this.escFitted = !!t.esc_fitted;
        if(t.launch_control_fitted !== undefined) this.launchControlFitted = !!t.launch_control_fitted;
        if(t.two_step_fitted !== undefined) this.twoStepFitted = !!t.two_step_fitted;
        if(t.gearbox !== undefined) this.gearbox = ["cvt", "torque-converter", "dct", "amt", "imt"].indexOf(t.gearbox) >= 0 ? t.gearbox : "gears";
        if(t.tc_stall_rpm !== undefined) this.tcStallRPM = t.tc_stall_rpm;
        if(t.tc_ratio !== undefined) this.tcRatio = t.tc_ratio;
        if(t.tc_lockup !== undefined) this.tcLockup = !!t.tc_lockup;
        if(t.live_axle_front !== undefined) this.liveAxle.front = !!t.live_axle_front;      // (a suspension type changed in the tuning menu: Car.rebuild)
        if(t.live_axle_rear !== undefined) this.liveAxle.rear = !!t.live_axle_rear;
        if(t.efficiency !== undefined) this.driveEfficiency = t.efficiency;
        if(t.cvt_rpm !== undefined) this.cvtRPM = t.cvt_rpm;
        if(t.cvt_rate !== undefined) this.cvtRate = t.cvt_rate;
        if(t.cvt_low !== undefined) this.cvtLow = t.cvt_low;
        if(t.cvt_high !== undefined) this.cvtHigh = t.cvt_high;
        if(t.clutch_start_rpm !== undefined) this.clutchStartRPM = t.clutch_start_rpm;
        if(t.clutch_full_rpm !== undefined) this.clutchFullRPM = Math.max(t.clutch_full_rpm, this.clutchStartRPM + 50);
        if(t.suspension_length !== undefined) this.restLength = Math.max(0.2, t.suspension_length);
        if(t.suspension_travel !== undefined) this.bumpTravel = Math.max(0.01, Math.min(t.suspension_travel, this.restLength - 0.05));
        if(t.unsprung !== undefined) this.unsprung = !!t.unsprung;
        if(t.spring_progression !== undefined) this.springProgression = Math.max(0, t.spring_progression);
        if(t.damping_rebound !== undefined) this.reboundFactor = Math.max(1, t.damping_rebound);
        if(t.ride_front !== undefined) this.rideFront = t.ride_front;
        if(t.ride_rear !== undefined) this.rideRear = t.ride_rear;
        if(t.turbo_share !== undefined) this.engine.turboShare = Math.max(0, Math.min(0.9, t.turbo_share));
        if(t.turbo_spool !== undefined) this.engine.turboSpool = Math.max(0.05, t.turbo_spool);
        if(t.turbo_threshold !== undefined) this.engine.turboThreshold = t.turbo_threshold;
        if(t.turbo_boost !== undefined) this.engine.turboBar = Math.max(0, t.turbo_boost);
        if(t.turbo_intercooler !== undefined) this.engine.turboIntercooler = Math.max(0, Math.min(0.98, t.turbo_intercooler));
        if(t.turbo_efficiency !== undefined) this.engine.turboEfficiency = Math.max(0.3, Math.min(0.9, t.turbo_efficiency));
        if(t.unsprung_mass !== undefined) this.unsprungMass = t.unsprung_mass;
        if(t.tyre_rate !== undefined) this.tyreRate = t.tyre_rate;
        if(t.roll_center_front !== undefined) this.rollCentreFront = t.roll_center_front;
        if(t.roll_center_rear !== undefined) this.rollCentreRear = t.roll_center_rear;
        if(t.camber_front !== undefined) this.camberFront = t.camber_front;
        if(t.camber_rear !== undefined) this.camberRear = t.camber_rear;
        if(t.roll_camber !== undefined) this.rollCamber = t.roll_camber;
        this.layout();
        for(i = 0; i < 4; i++) {
            w = this.wheels[i];
            w.driven = this.isDriven(w.front);
            if(t.grip !== undefined) w.gripScale = t.grip * (!w.front && t.grip_balance !== undefined ? t.grip_balance : 1); // grip_balance: the rear tyres as a factor of the front
            if(t.cornering !== undefined) this.corneringScale = t.cornering;
            if(t.rolling_resistance !== undefined) w.rollingResistance = t.rolling_resistance;
            if(t.brake_front !== undefined && w.front) w.maxBrakeTorque = t.brake_front;
            if(t.brake_rear !== undefined && !w.front) w.maxBrakeTorque = t.brake_rear;
        }
        if(t.brake_front !== undefined) this.brakeFront = t.brake_front;
        if(t.brake_rear !== undefined) this.brakeRear = t.brake_rear;
        var engine = this.engine;
        if(t.power !== undefined) engine.torqueScale = t.power;
        if(t.engine_braking !== undefined) engine.motoringFactor = t.engine_braking;
        if(t.idle_rpm !== undefined) { engine.idleRPM = t.idle_rpm; engine.stallRPM = t.idle_rpm * 0.4; }
        if(t.limiter_rpm !== undefined) { engine.limiterRPM = t.limiter_rpm; engine.maxRPM = t.limiter_rpm + 1000; }
        if(t.extras !== undefined) engine.extras = t.extras;
        if(t.limiter_hz !== undefined) engine.limiterHz = Math.max(1, t.limiter_hz);
        if(t.two_step_rpm !== undefined) engine.twoStepRPM = t.two_step_rpm;
        if(t.launch_rpm !== undefined) engine.launchRPM = t.launch_rpm;
        if(t.engine_inertia !== undefined) engine.inertia = t.engine_inertia;
        if(t.final_drive !== undefined) this.final_drive = t.final_drive;
        if(t.reverse_ratio !== undefined) this.reverseRatio = t.reverse_ratio;
        if(t.gear_ratios !== undefined) {
            // the same array is used by the car and by the controls: change it in place
            for(i = 0; i < t.gear_ratios.length && i < this.gear_ratios.length; i++) this.gear_ratios[i] = t.gear_ratios[i];
        }
        if(t.clutch !== undefined) this.clutchCapacity = t.clutch * engine.getPeakTorque() * engine.torqueScale;
        else if(t.power !== undefined) this.clutchCapacity = 1.5 * engine.getPeakTorque() * engine.torqueScale;
        if(t.diff_preload !== undefined) this.lockTorque = t.diff_preload;
        if(t.diff_lock !== undefined) this.lockStiffness = t.diff_lock;
        if(t.diff_power !== undefined) this.lockPower = t.diff_power;
        if(t.diff_coast !== undefined) this.lockCoast = t.diff_coast;
        if(t.drag !== undefined) this.Cdrag = t.drag;
        if(t.tc_allowance !== undefined) this.tcAllowance = t.tc_allowance;
        if(t.tyre_width !== undefined) this.tyreShell.width = Math.max(0, t.tyre_width) / 100;
        if(t.tyre_rings !== undefined) this.tyreShell.rings = t.tyre_rings;
        if(t.tyre_segments !== undefined) this.tyreShell.segments = t.tyre_segments;
        if(t.tyre_width !== undefined || t.tyre_rings !== undefined || t.tyre_segments !== undefined) for(var tb = 0; tb < 4; tb++) if(this.wheels[tb].tyreBody) { var tsb = this.tyreShellOf(this.wheels[tb]); this.wheels[tb].tyreBody.width = tsb.width; this.wheels[tb].tyreBody.rings = tsb.rings; this.wheels[tb].tyreBody.segments = tsb.segments; }
        if(t.tyre_damage !== undefined) { this.tyreDamage = !!t.tyre_damage; if(!this.tyreDamage) this.repairTyres(); }
        if(t.tyre_inner_ratio !== undefined) this.tyreShell.inner_ratio = Math.max(0.3, Math.min(0.9, t.tyre_inner_ratio));
        if(t.tyre_carcass !== undefined) this.tyreShell.carcass = Math.max(0, t.tyre_carcass);
        if(t.tyre_stiff_x !== undefined) this.tyreStiffX = t.tyre_stiff_x;
        if(t.tyre_stiff_y !== undefined) this.tyreStiffY = t.tyre_stiff_y;
        if(t.esc_gain !== undefined) this.escGain = t.esc_gain;
    };

    // The road under (x, z), as { y, nx, ny, nz, surface, mesh }; a flat road at 0 without a ground
    var flat = { y: 0, nx: 0, ny: 1, nz: 0, surface: "road", mesh: "" };
    function roadAt(x, z, y, above) {
        if(!self.ground) return flat;
        return self.ground.query(x, z, y, above);
    }

    // Repairs the car where it stands: the shell (dents), the parts that came off, the wheels (bent, torn off) and the tyres (punctures)
    this.repair = function () {
        if(this.softBody) this.softBody.repair();
        if(this.parts) this.parts.repair();
        if(this.repairWheels) this.repairWheels();
        this.repairTyres();
    };

    // Repairs the car and puts it back on its wheels where it is: the same place and heading, the roof up, 30 cm above the road, not moving (for a car that lies on its roof or its side)
    this.repairUpright = function () {
        var heading = this.psi;
        var fx = axisZ.x, fz = axisZ.z;
        if(fx * fx + fz * fz > 0.09) heading = Math.atan2(fz, fx);          // (a car that stands on its nose or tail has no heading from its front: it keeps the last one)
        var x = this.px, z = this.pz;
        this.reset(x, z, heading);                                           // (reset puts it on its wheels on the road there: standOnWheels, a ray under every wheel; it fell 30 cm before)
    };

    // The car put on its wheels where it is, with the heading it has: a ray down under every wheel finds the road there, the body is laid on the plane through the four
    // (the pitch and the roll of the road), at the height at which the wheels sit on their springs at rest. On a crest, a bank or a slope the wheels then stand on the
    // road instead of the body standing level with two wheels in the ground and two in the air (a drop from a height was the other way to get there).
    this.standOnWheels = function (psi) {
        var angle = Math.PI / 2 - psi, baseY = this.py - this.cgHeight - (this.rideFront + this.rideRear) / 2;      // (the road under the middle, as reset and relocate found it)
        var ex = Math.cos(psi), ez = Math.sin(psi);                          // forward on the ground, from the heading, and the left of the body (its +x: the yaw of reset turns (1, 0, 0) to (sin psi, 0, -cos psi))
        var lx = ez, lz = -ex;
        var pts = [], i, w;
        for(i = 0; i < 4; i++) {
            w = this.wheels[i];
            var ax = w.mount.z, aLeft = w.mount.x;                           // the mount: z forward, x to the left, in the frame of the body
            var wx = this.px + ex * ax + lx * aLeft, wz = this.pz + ez * ax + lz * aLeft;
            var road = roadAt(wx, wz, baseY + 2, 3);
            pts.push({ x: wx, y: road ? road.y : baseY, z: wz, rest: w.restLengthWheel !== undefined ? w.restLengthWheel : this.restLength });
        }
        // the plane through the four: its normal from the two diagonals (pointing up), its height at the middle
        var d1x = pts[2].x - pts[0].x, d1y = pts[2].y - pts[0].y, d1z = pts[2].z - pts[0].z;
        var d2x = pts[3].x - pts[1].x, d2y = pts[3].y - pts[1].y, d2z = pts[3].z - pts[1].z;
        var nx = d1y * d2z - d1z * d2y, ny = d1z * d2x - d1x * d2z, nz = d1x * d2y - d1y * d2x, nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if(nl < 1e-6 || Math.abs(ny / nl) < 0.5) { nx = 0; ny = 1; nz = 0; nl = 1; }                       // (a wall or nonsense: level)
        nx /= nl; ny /= nl; nz /= nl; if(ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        var meanY = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
        // the body: the heading about the up of the road, and the up of the body along the normal (the shortest turn from (0, 1, 0) to the normal, after the yaw)
        var yq = { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
        var cx = nz, cy = 0, cz = -nx, dot = ny;                              // (0,1,0) x n, and (0,1,0) . n
        var tw = 1 + dot, tl = Math.sqrt(cx * cx + cz * cz + tw * tw) || 1;
        var tq = { x: cx / tl, y: cy / tl, z: cz / tl, w: tw / tl };
        // q = tq * yq
        this.qw = tq.w * yq.w - tq.x * yq.x - tq.y * yq.y - tq.z * yq.z;
        this.qx = tq.w * yq.x + tq.x * yq.w + tq.y * yq.z - tq.z * yq.y;
        this.qy = tq.w * yq.y - tq.x * yq.z + tq.y * yq.w + tq.z * yq.x;
        this.qz = tq.w * yq.z + tq.x * yq.y - tq.y * yq.x + tq.z * yq.w;
        // the height: the middle of the body above the plane by what a wheel at rest needs (its centre a radius above the road, the mount its rest length above that), along the normal
        var lift = this.cgHeight + (this.rideFront + this.rideRear) / 2;
        this.px += nx * lift - 0; this.pz += nz * lift - 0;
        this.py = meanY + ny * lift + 0.02;
        for(i = 0; i < 4; i++) { w = this.wheels[i]; w.susLength = pts[i].rest; w.susVel = 0; }
    };

    // Where the car is (for a place to come back to): { x, z, psi (the heading), py (the height of the body, null when the car is not on its wheels) }
    this.pose = function () {
        var heading = this.psi;
        if(axisZ.x * axisZ.x + axisZ.z * axisZ.z > 0.09) heading = Math.atan2(axisZ.z, axisZ.x);
        var up = rotate(this.qx, this.qy, this.qz, this.qw, 0, 1, 0, { x: 0, y: 0, z: 0 });
        return { x: this.px, z: this.pz, psi: heading, py: up.y > 0.7 ? this.py : null };
    };

    // Puts the car somewhere standing still and on its wheels, in the state it is in: the damage, the tyres (heat, wear, pressure) and the engine stay as they are, only the place, the
    // movement and the springs are reset. py: the height of the body there (null: on the road)
    this.relocate = function (x, z, psi, py) {
        var angle = Math.PI / 2 - psi;
        this.qx = 0; this.qy = Math.sin(angle / 2); this.qz = 0; this.qw = Math.cos(angle / 2);
        var road = roadAt(x, z, 1000, 0);
        this.px = x; this.pz = z;
        this.py = py === null || py === undefined ? (road ? road.y : 0) + this.cgHeight + (this.rideFront + this.rideRear) / 2 : py + 0.05;
        this.vx = this.vy = this.vz = 0;
        this.wx = this.wy = this.wz = 0;
        this.ax = this.ay = 0;
        this.suspensionHistory = null;
        if((py === null || py === undefined) && road) this.standOnWheels(psi);      // (on the road there: a ray under every wheel, the body on their plane)
        // the engine at idle with the clutch open (it kept its speed, and in gear it spun the wheels up again the moment the car was put down)
        this.engine.omega = this.engine.idleRPM * Math.PI / 30;
        this.clutchEngagement = 0;
        this.shiftTimer = 0;
        if(this.softBody) this.softBody.settle();
        for(var i = 0; i < 4; i++) {
            var w = this.wheels[i];
            w.omega = 0;
            w.slipRatio = w.slipTan = 0;
            w.absFactor = 1;
            w.velocity.set(0, 0, 0);
            w.lastCompression = undefined;
            w.susLength = w.restLengthWheel !== undefined ? w.restLengthWheel : this.restLength;
            w.susVel = 0;
        }
        this.updateOutputs();
        this.measureWheels();
    };

    // Puts the car on the road at a place, standing still with the springs at rest.
    this.reset = function (x, z, psi) {
        var road = roadAt(x, z, 1000, 0);
        var height = road ? road.y : 0;
        // the heading psi, from +x towards +z, is a turn around the y axis of the body of (pi / 2 - psi)
        var angle = Math.PI / 2 - psi;
        this.qx = 0; this.qy = Math.sin(angle / 2); this.qz = 0; this.qw = Math.cos(angle / 2);
        this.px = x; this.py = height + this.cgHeight + (this.rideFront + this.rideRear) / 2; this.pz = z; // the ride height lifts the body
        this.vx = this.vy = this.vz = 0;
        this.wx = this.wy = this.wz = 0;
        this.repair();
        if(road) this.standOnWheels(psi);                                    // (on the road there: a ray under every wheel, the body on their plane)
        this.ax = this.ay = 0;
        this.suspensionHistory = null;
        for(var i = 0; i < 4; i++) {
            var w = this.wheels[i];
            w.omega = 0;
            w.slipRatio = w.slipTan = 0;
            w.absFactor = 1;
            w.heat = w.smoke = w.squeal = 0; w.surfT = w.temp; w.roadT = this.ambient;
            w.velocity.set(0, 0, 0);
            w.lastCompression = undefined;
            w.susLength = w.restLengthWheel !== undefined ? w.restLengthWheel : this.restLength;   // the wheel where it is at rest on the spring
            w.susVel = 0;
        }
        lastBodyAccDown = 0;
        this.engine.omega = this.engine.idleRPM * Math.PI / 30;
        this.engine.running = true;
        this.engine.starting = false;
        this.clutchEngagement = 0;
        this.shiftTimer = 0;
        this.updateOutputs();
        this.measureWheels();
    };

    // Total gear ratio from the engine to the wheels, including the final drive. Negative in reverse and 0 in neutral.
    this.getGearRatio = function () {
        var inp = this.input;
        if(inp.neutral) return 0;
        var ratio = this.final_drive;
        if(inp.reverse) return -this.reverseRatio * ratio;
        if(this.gearbox === "cvt") return this.cvtRatio * ratio;
        return this.gear_ratios[inp.current_gear] * ratio;
    };

    // the driven wheels: left and right
    this.drivenA = function () { return this.wheels[this.driveType === "fwd" ? 1 : 2]; };
    this.drivenB = function () { return this.wheels[this.driveType === "fwd" ? 0 : 3]; };

    // the share of the engine torque that every wheel gets (in the order of the wheels) when the differentials are open
    this.torqueShares = function () {
        if(this.soloWheels) return this.driveType === "fwd" ? [1, 0, 0, 0] : this.driveType === "awd" ? [0.5, 0, 0.5, 0] : [0, 0, 1, 0];      // (a motorcycle: the one wheel of the end)
        if(this.driveType === "awd") {
            var f = Math.max(0, Math.min(1, this.centerSplit));
            return [f / 2, f / 2, (1 - f) / 2, (1 - f) / 2];
        }
        return this.driveType === "fwd" ? [0.5, 0.5, 0, 0] : [0, 0, 0.5, 0.5];
    };

    this.getSpeed = function () {
        return this.u;
    };

    // An impulse (N s, world) at a point (world) from outside: the ragdoll of a rider that hits the bike (Driver.js). The speed and the turn of the body take it (the turn with the
    // mean inertia: a nudge, not a collision solver).
    this.applyImpulse = function (px, py, pz, jx, jy, jz) {
        var m = this.mass || 1, I = (inertiaX + inertiaY + inertiaZ) / 3 || 1;
        var jl = Math.sqrt(jx * jx + jy * jy + jz * jz), cap = 4 * m;                     // (never more than 4 m/s of speed from one impulse)
        if(jl > cap) { jx *= cap / jl; jy *= cap / jl; jz *= cap / jl; }
        this.vx += jx / m; this.vy += jy / m; this.vz += jz / m;
        var rx = px - this.px, ry = py - this.py, rz = pz - this.pz;
        this.wx += (ry * jz - rz * jy) / I; this.wy += (rz * jx - rx * jz) / I; this.wz += (rx * jy - ry * jx) / I;
    };

    // the place and the orientation of the middle of the body model: the middle between the axles, at the height of the axles at rest
    this.getBodyPose = function (position, quaternion) {
        var offset = rotate(this.qx, this.qy, this.qz, this.qw, 0, this.wheels[0].radius - this.cgHeight, (this.af - this.ar) / 2, { x: 0, y: 0, z: 0 });
        position.x = this.px + offset.x; position.y = this.py + offset.y; position.z = this.pz + offset.z;
        quaternion.x = this.qx; quaternion.y = this.qy; quaternion.z = this.qz; quaternion.w = this.qw;
    };

    // How hard the clutch is clamped for a pedal position: fully engaged for the first part of the
    // travel, then releasing smoothly; the point where it bites is around the middle of the pedal.
    function pedalBite(pedal) {
        if(pedal <= 0.15) return 1;
        if(pedal >= 0.8) return 0;
        return 0.5 + 0.5 * Math.cos(Math.PI * (pedal - 0.15) / 0.65);
    }

    function smoothstep(lo, hi, x) {
        var t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
        return t * t * (3 - 2 * t);
    }

    // Gearbox and clutch behaviour that does not depend on the physics of one substep.
    // Called once per frame.
    this.updateControls = function (delta) {
        var inp = this.input;
        var engine = this.engine;
        var gears = this.gear_ratios.length;
        var ratio = Math.abs(this.getGearRatio());
        this.timeSinceShift += delta;

        // engine speed implied by the wheels in the current gear (the engine speed itself while slipping the clutch is no guide)
        var shares0 = this.torqueShares();
        var drivenOmega = 0;
        for(var di = 0; di < 4; di++) drivenOmega += shares0[di] * this.wheels[di].omega;
        this.drivelineRPM = Math.abs(drivenOmega) * ratio * 30 / Math.PI;

        // the CVT: the ratio that holds the engine at the speed the throttle asks for, from the speed of the road
        if(this.gearbox === "cvt") {
            if(this.gear_ratios.length) {
                var cl = Math.max(this.cvtLow, this.cvtHigh), ch = Math.min(this.cvtLow, this.cvtHigh);
                var idle = engine.idleRPM || 900, top = this.cvtRPM > 0 ? this.cvtRPM : engine.limiterRPM * 0.85;
                var cthr = Math.max(0, Math.min(1, inp.throttle || 0)), cbrk = Math.max(0, Math.min(1, inp.brakePedal || 0));
                var wantRPM = cthr > 0.05 ? idle + (top - idle) * Math.pow(cthr, 0.6) : idle + (top - idle) * (0.18 + 0.3 * cbrk);
                var roadOmega = Math.max(0.5, Math.abs(this.u)) / this.wheels[0].radius;              // rad/s of the wheels from the speed of the road (not from spinning wheels)
                var wantRatio = (wantRPM * Math.PI / 30) / (roadOmega * this.final_drive);
                wantRatio = Math.max(ch, Math.min(cl, wantRatio));
                var pace = Math.exp(this.cvtRate * delta);
                this.cvtRatio = Math.max(this.cvtRatio / pace, Math.min(this.cvtRatio * pace, wantRatio));
                if(inp.neutral || inp.reverse) this.cvtRatio = cl;
            }
        }
        // automatic gearbox
        // (not in a burnout of a motorcycle: the gear is held, the wheel is meant to spin)
        else if(!inp.manualGearbox && !inp.reverse && !inp.neutral && !(self.controller && self.controller.burnout > 0.5)) {
            var g = inp.current_gear;
            var thr = inp.throttle;
            // the engine speed the road speed asks for in this gear: spinning wheels must not cause a shift
            var rpm = Math.max(0, this.u) / this.wheels[0].radius * ratio * 30 / Math.PI;
            if(this.timeSinceShift > 0.6) {
                var limit = this.engine.limiterRPM;
                var upRPM = limit * (0.45 + 0.42 * thr);
                var downRPM = limit * (0.23 + 0.17 * thr);
                var nextRatio = g < gears - 1 ? this.gear_ratios[g + 1] / this.gear_ratios[g] : 1;
                var prevRatio = g > 0 ? this.gear_ratios[g - 1] / this.gear_ratios[g] : 1;
                // The engine near the rev limiter with the throttle open while the car moves and the wheels spin faster than the road asks (a lot of power in a low
                // gear: the speed of the road does not reach the shift speed): after a moment it shifts up, as an automatic does at the redline. The time is
                // kept leaky, because the engine speed jumps about with the spinning wheels and the limiter.
                var engineRpm = this.engine.getRPM();
                var spinning = engineRpm >= limit * 0.8 && engineRpm > rpm * 1.2 + 300 && thr > 0.5 && this.u > 1 && this.engine.holdRPM <= 0;
                this.limiterTime = spinning ? (this.limiterTime || 0) + delta : Math.max(0, (this.limiterTime || 0) - delta * 0.3);
                this.noDownshift = Math.max(0, (this.noDownshift || 0) - delta);
                if(g < gears - 1 && this.limiterTime > 0.35) {
                    inp.current_gear++;
                    this.limiterTime = 0;
                    this.noDownshift = 3;                     // (and no kick down for a while: the engine speed drops, and it would go back and forth)
                } else if(g < gears - 1 && rpm > upRPM && rpm * nextRatio > 0.35 * limit && this.u > 1) {
                    inp.current_gear++;
                } else if(g > 0 && ((rpm < downRPM && rpm * prevRatio < 0.86 * limit && this.noDownshift <= 0) || (this.u < 1.5 && thr < 0.1))) {
                    inp.current_gear--;
                }
            }
        }

        // a shift of the gear (by the driver or by the automatic gearbox) needs the clutch
        var key = inp.neutral ? -1 : (inp.reverse ? -2 : inp.current_gear);
        if(this.lastGearKey !== null && key !== this.lastGearKey) {
            this.timeSinceShift = 0;
            this.shiftUp = key >= 0 && this.lastGearKey >= 0 && key > this.lastGearKey;
            // (a dual clutch: the next gear is already in, the shift is the hand-over between the two clutches)
            if(!inp.clutchPedalPresent) {
                this.shiftDuration = this.gearbox === "dct" ? Math.max(0.08, Math.min(this.shiftTime, 0.15)) : (this.gearbox === "amt" ? Math.max(0.5, this.shiftTime) : this.shiftTime);
                this.shiftTimer = this.shiftDuration;
            }
        }
        this.lastGearKey = key;
        if(this.shiftTimer > 0) this.shiftTimer -= delta;

        // a stalled engine is restarted: automatically without a clutch pedal, otherwise with clutch and throttle
        if(!engine.running && !engine.starting) {
            if(!inp.clutchPedalPresent) engine.start();
            else if((inp.neutral || inp.clutch > 0.8) && inp.throttle > 0.05) engine.start();
        }
    };

    this.startEngine = function () {
        this.engine.start();
    };

    // ---- what the rest of the game wants to know, from the rigid body
    var axisX = { x: 0, y: 0, z: 0 }, axisY = { x: 0, y: 0, z: 0 }, axisZ = { x: 0, y: 0, z: 0 };
    var cylF = { x: 0, y: 0, z: 0 }, cylL = { x: 0, y: 0, z: 0 }, cylU = { x: 0, y: 0, z: 0 }, cylHub = { x: 0, y: 0, z: 0 }, cylVel = { x: 0, y: 0, z: 0 }, wheelList = [[], [], [], []];
    this.updateOutputs = function () {
        rotate(this.qx, this.qy, this.qz, this.qw, 1, 0, 0, axisX);
        rotate(this.qx, this.qy, this.qz, this.qw, 0, 1, 0, axisY);
        rotate(this.qx, this.qy, this.qz, this.qw, 0, 0, 1, axisZ);
        this.x = this.px;
        this.z = this.pz;
        this.psi = Math.atan2(axisZ.z, axisZ.x);
        this.u = this.vx * axisZ.x + this.vy * axisZ.y + this.vz * axisZ.z;
        this.v = -(this.vx * axisX.x + this.vy * axisX.y + this.vz * axisX.z);
        this.r = -(this.wx * axisY.x + this.wy * axisY.y + this.wz * axisY.z);
        var road = roadAt(this.px, this.pz, this.py, 1.5);
        this.groundLevel = road ? road.y : this.py - this.cgHeight;
    };

    // Where the wheels are, from the springs, for the display (also when the car is not stepped)
    this.measureWheels = function () {
        var tmp = { x: 0, y: 0, z: 0 };
        for(var i = 0; i < 4; i++) {
            var w = this.wheels[i];
            rotate(this.qx, this.qy, this.qz, this.qw, w.mount.x + (w.shiftX || 0), w.mount.y, w.mount.z + (w.shiftZ || 0), tmp);
            var mx = this.px + tmp.x, my = this.py + tmp.y, mz = this.pz + tmp.z;
            // The wheel is drawn on the road, not pushed into it: the tyre's squash beyond what it has at rest (a landing, a kerb)
            // lifts the drawn wheel, because the mesh of the tyre does not flatten. The parts of the suspension rig follow the same place.
            var squash = Math.max(0, (w.tyreDeflection || 0) - w.staticLoad / (w.tyreRate || this.tyreRate));
            // (a wheel that lets go of the road for a moment goes out on its spring as the physics has it, it does not snap to the end of its travel and back)
            w.visualLength = Math.min(w.suspensionLength, w.freeLength) - squash;
            var length = w.visualLength;
            w.center.x = mx - axisY.x * length;
            w.center.y = my - axisY.y * length;
            w.center.z = mz - axisY.z * length;
        }
    };

    // Pushes the car out of the walls it is in and gives it an impulse that stops it moving further into them.
    // The impulse acts on the point of the car that touched the wall, so the car also spins when it hits a wall
    // with a corner. Some of the speed along the wall is lost to scraping.
    var rVec = { x: 0, y: 0, z: 0 }, rxn = { x: 0, y: 0, z: 0 }, ia = { x: 0, y: 0, z: 0 }, ib = { x: 0, y: 0, z: 0 };
    function impulseAt(rx, ry, rz, nx, ny, nz, restitution, vnOut) {
        // velocity of the point of contact along the normal
        var cx = self.vx + (self.wy * rz - self.wz * ry);
        var cy = self.vy + (self.wz * rx - self.wx * rz);
        var cz = self.vz + (self.wx * ry - self.wy * rx);
        var vn = cx * nx + cy * ny + cz * nz;
        if(vn >= 0) return 0;
        // 1/m + n . ((I^-1 (r x n)) x r)
        rxn.x = ry * nz - rz * ny; rxn.y = rz * nx - rx * nz; rxn.z = rx * ny - ry * nx;
        applyInverseInertia(rxn.x, rxn.y, rxn.z, ia);
        var termX = ia.y * rz - ia.z * ry, termY = ia.z * rx - ia.x * rz, termZ = ia.x * ry - ia.y * rx;
        var invMass = 1 / self.mass + nx * termX + ny * termY + nz * termZ;
        var j = -(1 + restitution) * vn / invMass;
        self.vx += j * nx / self.mass; self.vy += j * ny / self.mass; self.vz += j * nz / self.mass;
        applyInverseInertia(rxn.x * j, rxn.y * j, rxn.z * j, ib);
        self.wx += ib.x; self.wy += ib.y; self.wz += ib.z;
        vnOut.value = -vn;
        return j;
    }

    // The underside of the car as a plane (the car can be tilted, on a ramp for example): its height above a point of the ground plane, so that
    // a wall is only a wall where the car is lower than its top. Without a car that is upright enough it is the road under the car.
    var underside = { bottomAt: null, height: 0, kerb: 0 }, upAxis = { x: 0, y: 0, z: 0 };
    function undersideOfCar() {
        rotate(self.qx, self.qy, self.qz, self.qw, 0, 1, 0, upAxis);
        var yUnder = -self.cgHeight + self.groundClearance;
        var ox = self.px + upAxis.x * yUnder, oy = self.py + upAxis.y * yUnder, oz = self.pz + upAxis.z * yUnder;
        var nx = upAxis.x, ny = upAxis.y, nz = upAxis.z;
        if(ny > 0.35) underside.bottomAt = function(x, z) { return oy - (nx * (x - ox) + nz * (z - oz)) / ny; };
        else { var level = self.groundLevel; underside.bottomAt = function() { return level; }; }
        underside.height = self.bodyHeight;
        underside.kerb = self.kerbHeight;
        return underside;
    }

    var impactSpeed = { value: 0 };
    function resolveCollisions() {
        var offset = (self.af - self.ar) / 2; // the rectangle of the car is centred between the axles
        for(var pass = 0; pass < 3; pass++) {
            var cosP = Math.cos(self.psi), sinP = Math.sin(self.psi);
            var contacts = self.collision.query(self.px + cosP * offset, self.pz + sinP * offset, self.psi,
                self.halfLength, self.halfWidth, self.groundLevel + self.kerbHeight, self.groundLevel + self.bodyHeight, undersideOfCar());
            if(contacts.length === 0) return;
            var c = contacts[0];

            // out of the wall
            self.px += c.nx * c.depth;
            self.pz += c.nz * c.depth;

            var rx = c.px - self.px, ry = 0, rz = c.pz - self.pz;
            var jn = impulseAt(rx, ry, rz, c.nx, 0, c.nz, self.wallRestitution, impactSpeed);
            if(jn === 0) continue; // already moving away
            // scraping along the wall: an impulse along the surface, at most a share of the impulse of the hit
            var tx = -c.nz, tz = c.nx;
            var cx = self.vx + (self.wy * rz - self.wz * ry);
            var cz = self.vz + (self.wx * ry - self.wy * rx);
            var vt = cx * tx + cz * tz;
            var jt = Math.max(-self.wallFriction * jn, Math.min(self.wallFriction * jn, -vt * self.mass * 0.5));
            self.vx += jt * tx / self.mass;
            self.vz += jt * tz / self.mass;
            if(impactSpeed.value > self.lastImpact || self.impactTime > 0.5) {
                self.lastImpact = impactSpeed.value;
                self.impactTime = 0;
            }
        }
    }

    // ---- the body in the 3D physics: a set of spheres (the collision proxy), against the triangles of the track
    //
    // The body is a cloud of spheres in the frame of the car (self.collisionSpheres, [{ x, y, z, r }], measured from the centre of gravity:
    // x to the left, y up, z forward). It is made from the model of the car when that has loaded (CollisionProxy.js), else from the size of
    // the car. A sphere that is pushed into a triangle gives a contact with the normal of the triangle on the side of the sphere. A contact
    // with a surface that the car could be riding on (one that faces up in the world, or up for the car: the car can be on a wall or a
    // loop) is soft: a damped spring, the underside that scrapes, the body that comes down after a landing. Any other is a wall: the car is
    // pushed out and gets an impulse. A wall that is lower than the kerb height above the underside of the car is driven over.
    var proxyKey = "", proxyRadius = 0;
    var candidates = [], candX = 1e9, candY = 1e9, candZ = 1e9, candRadius = 0;
    var sphereAt = { x: 0, y: 0, z: 0 }, nearest = { x: 0, y: 0, z: 0 }, wallRange = [0, 0], triNormal = { x: 0, y: 0, z: 0 };
    var contacts3 = [], contactCount = 0;
    var carUp = { x: 0, y: 1, z: 0 };

    function defaultProxy() {
        var r = Math.max(0.15, Math.min(0.3, self.bodyHeight / 3.5, self.halfWidth / 2.5));
        var yBottom = -self.cgHeight + self.groundClearance, yTop = yBottom + self.bodyHeight;
        var zCentre = (self.af - self.ar) / 2;
        var xs = [-(self.halfWidth - r), 0, self.halfWidth - r];
        var zFront = zCentre + self.halfLength - r, zBack = zCentre - self.halfLength + r;
        var n = Math.max(2, Math.ceil((zFront - zBack) / 0.6));
        var zs = []; for(var i = 0; i <= n; i++) zs.push(zBack + (zFront - zBack) * i / n);
        var out = [];
        for(var a = 0; a < zs.length; a++) for(var b = 0; b < xs.length; b++) out.push({ x: xs[b], y: yBottom + r, z: zs[a], r: r });          // the underside
        var yMid = (yBottom + yTop) / 2;
        for(var c = 0; c < zs.length; c++) { out.push({ x: xs[0], y: yMid, z: zs[c], r: r }); out.push({ x: xs[2], y: yMid, z: zs[c], r: r }); }     // the sides
        out.push({ x: 0, y: yMid, z: zFront, r: r }); out.push({ x: 0, y: yMid, z: zBack, r: r });                                                   // the ends
        for(var d = 0; d < 3; d++) out.push({ x: xs[0] * 0.55, y: yTop - r, z: zCentre - self.halfLength * (0.45 - d * 0.35), r: r }), out.push({ x: xs[2] * 0.55, y: yTop - r, z: zCentre - self.halfLength * (0.45 - d * 0.35), r: r }); // the roof
        return out;
    }

    function ensureProxy() {
        if(self.collisionSpheres) {
            if(self.collisionSpheres !== self.proxyUsed) { self.proxyUsed = self.collisionSpheres; proxyKey = ""; self.proxy3 = self.collisionSpheres; computeProxyRadius(); }
            return;
        }
        var key = [self.halfLength, self.halfWidth, self.bodyHeight, self.cgHeight, self.groundClearance, self.af, self.ar].join(",");
        if(key !== proxyKey) { proxyKey = key; self.proxy3 = defaultProxy(); computeProxyRadius(); }
    }
    function computeProxyRadius() {
        proxyRadius = 0;
        self.proxy3.forEach(function(sp) { proxyRadius = Math.max(proxyRadius, Math.sqrt(sp.x * sp.x + sp.y * sp.y + sp.z * sp.z) + sp.r); });
    }
    this.proxy3 = null;
    this.softContacts = 0;
    this.debugContacts = function () { return contacts3.slice(0, contactCount); };      // the contacts of the body spheres with the triangles in the last scan (DebugView.js)
    this.bodyFriction = 0.3;          // the friction of the body that slides on a surface (the underside on the road)

    // The triangles near the car, kept for a while (the car moves a few centimetres in a step)
    function refreshCandidates() {
        var R = proxyRadius + 1.5;
        var dx = self.px - candX, dy = self.py - candY, dz = self.pz - candZ;
        if(candRadius === R && dx * dx + dy * dy + dz * dz < 0.8 * 0.8) return;
        candX = self.px; candY = self.py; candZ = self.pz; candRadius = R;
        self.ground.nearby(self.px, self.py, self.pz, R + 0.8, candidates);
        // the triangles that can be a wall for the shell: not the ones that lie flat (the road under the car)
        wallCandidates.length = 0;
        for(var c = 0; c < candidates.length; c++) {
            self.ground.normalOf(candidates[c], triNormal);
            if(Math.abs(triNormal.y) < 0.5) wallCandidates.push(candidates[c]);
        }
    }
    var wallCandidates = [];

    function testSphere(i, cx, cy, cz, r, tyreWheel, wantSoft, list) {
        var ground = self.ground, yUnder = -self.cgHeight + self.groundClearance;
        var ux = self.px + carUp.x * yUnder, uy = self.py + carUp.y * yUnder, uz = self.pz + carUp.z * yUnder;
        for(var k = 0; k < list.length; k++) {
            var t = list[k];
            if(!ground.boxNear(t, cx, cy, cz, r)) continue;
            var d2 = ground.closest(t, cx, cy, cz, nearest);
            if(d2 >= r * r) continue;
            var dist = Math.sqrt(d2);
            var nx, ny, nz;
            if(dist > 1e-5) { nx = (cx - nearest.x) / dist; ny = (cy - nearest.y) / dist; nz = (cz - nearest.z) / dist; }
            else { ground.normalOf(t, triNormal); nx = triNormal.x; ny = triNormal.y; nz = triNormal.z; dist = 0; }
            var depth = r - dist;
            if(depth < 1e-4) continue;
            if(nearest.region !== 0) {
                // a contact with an edge or a corner of a triangle: when its direction is not that of the face, it is the seam between two
                // triangles of a surface (the neighbour has the contact), and it would push the car sideways along the surface
                ground.normalOf(t, triNormal);
                var along = nx * triNormal.x + ny * triNormal.y + nz * triNormal.z;
                if(along < 0) along = -along;
                if(along < 0.85) continue;
            }
            var nUp = nx * carUp.x + ny * carUp.y + nz * carUp.z;
            var soft = ny >= 0.5 || nUp >= 0.5;
            if(soft && tyreWheel >= 0) {
                // the road under the wheel is the business of the suspension (the tyre is pressed into it by its deflection, a few centimetres); only what the tyre is pressed into
                // further than that (the side of a hump that the ray of the wheel does not see) is felt here
                var pressed = depth - ((self.wheels[tyreWheel].tyreDeflection || 0) + 0.015);
                if(pressed <= 0) continue;
                depth = pressed;
            }
            var lowWall = false;
            if(!soft) {
                // a wall that is lower than the kerb height above the underside is driven over: the top of the wall above this point
                if(ground.lineRange(t, nearest.x, nearest.y, nearest.z, carUp.x, carUp.y, carUp.z, wallRange)) {
                    var top = (nearest.x - ux) * carUp.x + (nearest.y - uy) * carUp.y + (nearest.z - uz) * carUp.z + wallRange[1];
                    if(top < self.kerbHeight) {
                        if(tyreWheel < 0) continue;
                        lowWall = true;                      // a tyre on a kerb or the side of a low ramp: the body does not hit it, but the tyre rests against it (a spring)
                    }
                }
                // only a car that goes into the wall is hit by it; one that scrapes along it, or is in it after a hit, is pushed out softly
                // (a hard push on something that does not come at it throws the car through the thin parts of a track)
                var wx = self.vx + (self.wy * sphereAt.z - self.wz * sphereAt.y);
                var wy = self.vy + (self.wz * sphereAt.x - self.wx * sphereAt.z);
                var wz = self.vz + (self.wx * sphereAt.y - self.wy * sphereAt.x);
                if(lowWall || wx * nx + wy * ny + wz * nz > -0.3) soft = true;
            }
            if(soft !== wantSoft) continue;
            var c = contacts3[contactCount];
            if(!c) c = contacts3[contactCount] = { nx: 0, ny: 0, nz: 0, depth: 0, qx: 0, qy: 0, qz: 0, tri: 0, sphere: 0 };
            c.tri = t; c.sphere = i; c.tyre = tyreWheel >= 0;
            c.nx = nx; c.ny = ny; c.nz = nz; c.depth = depth; c.qx = nearest.x; c.qy = nearest.y; c.qz = nearest.z;
            contactCount++;
        }
    }

    // The contacts of the spheres with the triangles: the soft ones (wantSoft) or the walls, into contacts3 (contactCount of them)
    function scanContacts(wantSoft) {
        ensureProxy();
        refreshCandidates();
        rotate(self.qx, self.qy, self.qz, self.qw, 0, 1, 0, carUp);
        var yUnder = -self.cgHeight + self.groundClearance;
        var ux = self.px + carUp.x * yUnder, uy = self.py + carUp.y * yUnder, uz = self.pz + carUp.z * yUnder;   // a point of the underside plane
        var ground = self.ground;
        contactCount = 0;
        var spheres = self.proxy3;
        for(var i = 0; i < spheres.length; i++) {
            var sp = spheres[i];
            if(sp.disabled) continue;
            rotate(self.qx, self.qy, self.qz, self.qw, sp.x, sp.y, sp.z, sphereAt);
            var node = self.softBody ? self.softBody.nodeOfSphere[i] : -1;
            if(node >= 0) {
                // a sphere that is a node of the shell: where the node is now (it can be bent); the walls are the business of the shell
                if(!wantSoft && self.softBody.alive(node)) continue;
                self.softBody.position(node, nodePos);
                rotate(self.qx, self.qy, self.qz, self.qw, nodePos.x, nodePos.y, nodePos.z, sphereAt);
            }
            testSphere(i, self.px + sphereAt.x, self.py + sphereAt.y, self.pz + sphereAt.z, sp.r, -1, wantSoft, candidates);
        }
        return contactCount;
    }

    // ---- damage to the wheels: a hard hit of a wheel on a wall bends its suspension (a toe and a camber that pull the car aside, less grip),
    // and a harder one tears the wheel off (Parts.js makes it a loose body). wheelStrength: the impulse (N s) that tears a wheel off, 0 is never.
    this.wheelStrength = 0;
    this.wheelDamage = [0, 0, 0, 0];                  // 0 whole, 1 torn off
    this.wheelLost = [false, false, false, false];
    // A motorcycle has two wheels: the second wheel of each pair (1 and 3) is a lost wheel for good: no road, no spring, no drive (torqueShares), no brake; the wheel that stays
    // carries the whole end (layout: twice the mass and the rate of a wheel of a pair). The pair on a 4 cm track held the bike up at a standstill, as a sidecar does.
    this.soloWheels = !!parameters.motorcycle;
    // The geometry of the fork and of the swingarm of a motorcycle (Car.js sets them from the model): the wheel does not move straight up, it moves along the fork (up and back) and on
    // the arc of the swingarm (the tangent of it). For a travel direction t (forward z, up y) a force on the wheel along the road, Fx, loads the spring with Fx t.z / t.y on top of the
    // vertical force: under the brake the fork dives (forkSlope = -tan rake, so a force backwards gives a positive load), and on a swingarm whose pivot is above the axle the drive force
    // lifts the rear (anti-squat). The body gets the same total force as before: only how far the spring is pushed in changes. forkDive scales it (car.json motorcycle.fork_dive, 0: off).
    this.forkSlope = 0; this.swingSlope = 0; this.forkDive = 1;
    if(this.soloWheels) this.wheelLost = [false, true, false, true];
    this.wheelSpinAtLoss = [0, 0, 0, 0];              // rad/s, for the wheel that flies off
    this.hubNode = [-1, -1, -1, -1];                  // the node of the shell that is the hub of a wheel (front wheels), CollisionProxy.js
    this.hubSphere = [-1, -1, -1, -1];
    this.hubLimit = 0.3;                               // m: a hub that has moved so far from its place has taken the wheel with it
    function loseWheel(i) {
        if(self.wheelLost[i]) return;
        self.wheelLost[i] = true;
        self.wheelDamage[i] = 1;
        self.wheelSpinAtLoss[i] = self.wheels[i].omega;
        if(self.hubSphere[i] >= 0 && self.proxy3 && self.proxy3[self.hubSphere[i]]) self.proxy3[self.hubSphere[i]].disabled = true;      // the hub is not in the way any more
        if(self.onWheelLost) self.onWheelLost(i);
    }
    // The hub of a front wheel is a node of the shell: where it is now (the hit bent it) gives the place of the wheel on the car, its toe and its
    // camber; when its anchor has torn the wheel is off. In the frame of the car: x to the left, z forward.
    var hubPos = { x: 0, y: 0, z: 0 }, hubA = { x: 0, y: 0, z: 0 }, hubB = { x: 0, y: 0, z: 0 };
    this.rig = [null, null, null, null];              // per wheel: the nodes of its suspension and the beams (CollisionProxy.js)
    function turnOf(a) { return a > Math.PI ? a - 2 * Math.PI : (a < -Math.PI ? a + 2 * Math.PI : a); }
    function updateHubs() {
        var sb = self.softBody;
        if(!sb) return;
        for(var i = 0; i < 4; i++) {
            var rig = self.rig[i];
            if(!rig || self.wheelLost[i]) continue;
            var wh = self.wheels[i], n = rig.nodes;
            // the wheel is off when the arms are gone (both beams of the upper or of the lower arm), or the hub has moved too far
            var upperAlive = sb.beamAlive[rig.upper[0]] || sb.beamAlive[rig.upper[1]], lowerAlive = sb.beamAlive[rig.lower[0]] || sb.beamAlive[rig.lower[1]];
            sb.position(n.H, hubPos);
            var dx = hubPos.x - rig.home.x, dy = hubPos.y - rig.home.y, dz = hubPos.z - rig.home.z;
            var moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if(!upperAlive || !lowerAlive || moved > self.hubLimit) { sb.setNode(n.H, { release: true }); loseWheel(i); continue; }
            // the camber from how the knuckle leans (the ball joints, above and below), the toe from how it has turned (the end of the tie rod
            // against the hub), both against how it was made; and the hub gives the place of the wheel on the car
            sb.position(n.Ub, hubA); sb.position(n.Lb, hubB);
            var camber = turnOf(Math.atan2(hubA.x - hubB.x, hubA.y - hubB.y) - rig.camber0);
            sb.position(n.Te, hubA);
            var toe = turnOf(Math.atan2(hubA.x - hubPos.x, hubA.z - hubPos.z) - rig.toe0);
            wh.shiftX = dx; wh.shiftZ = dz;
            wh.camberBend = Math.max(-0.35, Math.min(0.35, -camber));       // (a lean of the top to the left is a negative bend)
            wh.toeBend = Math.max(-0.35, Math.min(0.35, -toe));              // (a turn towards the left is a negative angle of the wheel)
            self.wheelDamage[i] = Math.min(0.99, Math.max(moved / self.hubLimit, Math.abs(toe) / 0.2, Math.abs(camber) / 0.2));
        }
    }
    this.onWheelLost = null;
    function wheelHit(sphereIndex, impulse) {
        var sp = self.proxy3 && self.proxy3[sphereIndex];
        if(!sp || !sp.wheel || !(self.wheelStrength > 0) || sp.wheelIndex === undefined) return;
        var i = sp.wheelIndex;
        if(self.wheelLost[i]) return;
        self.wheelDamage[i] = Math.min(1, self.wheelDamage[i] + impulse / self.wheelStrength);
        if(self.wheelDamage[i] >= 1) {
            self.wheelLost[i] = true;
            self.wheelSpinAtLoss[i] = self.wheels[i].omega;
            if(self.onWheelLost) self.onWheelLost(i);
        }
    }
    // the bend of a wheel (a bent suspension arm and tie rod): toe in or out and a lean, to the side that the hit pushed it
    this.repairWheels = function () {
        for(var i = 0; i < 4; i++) {
            this.wheelDamage[i] = 0; this.wheelLost[i] = this.soloWheels && (i === 1 || i === 3); this.wheels[i].toeBend = 0; this.wheels[i].camberBend = 0; this.wheels[i].damageGrip = 1;
            this.wheels[i].shiftX = 0; this.wheels[i].shiftZ = 0;
            if(this.hubSphere[i] >= 0 && this.proxy3 && this.proxy3[this.hubSphere[i]]) this.proxy3[this.hubSphere[i]].disabled = false;
        }
    };

    // ---- the shell (SoftBody.js): the walls act on its nodes, and the car feels them through the anchors
    this.softBody = null;
    var Rm = new Float64Array(9);                     // the turn of the car as a matrix: world = Rm * frame
    var shellForce = { x: 0, y: 0, z: 0 }, nodePos = { x: 0, y: 0, z: 0 }, nodeVel = { x: 0, y: 0, z: 0 };

    function setTurn() {
        var x = self.qx, y = self.qy, z = self.qz, wq = self.qw;
        Rm[0] = 1 - 2 * (y * y + z * z); Rm[1] = 2 * (x * y - z * wq); Rm[2] = 2 * (x * z + y * wq);
        Rm[3] = 2 * (x * y + z * wq); Rm[4] = 1 - 2 * (x * x + z * z); Rm[5] = 2 * (y * z - x * wq);
        Rm[6] = 2 * (x * z - y * wq); Rm[7] = 2 * (y * z + x * wq); Rm[8] = 1 - 2 * (x * x + y * y);
    }

    // The forces of the walls on the nodes (a stiff spring with a damper and friction, at the place where the node is now, bent or not)
    // The triangles that a node can touch in this step of the physics, found once (the car does not move while the shell takes its small steps, and
    // a node moves a few centimetres at most): the small steps only test these. Before, every small step (up to 14) went through all the triangles
    // near the car for every node, which made the game stutter on a bump or a ramp, where there are many.
    var nodeTris = [], nodeTriCount = 0, nodeTriMargin = 0.2, noTriangles = [], carForce = { x: 0, y: 0, z: 0 };
    function buildNodeTriangles() {
        var sb = self.softBody, ground = self.ground;
        var upY = Rm[4];
        var list = upY > 0.2 ? wallCandidates : candidates;
        nodeTriCount = 0;
        if(!list.length) return;
        for(var k = 0; k < sb.count; k++) {
            var tris = nodeTris[k] || (nodeTris[k] = []);
            tris.length = 0;
            if(!sb.alive(k)) continue;
            sb.position(k, nodePos);
            var cx = self.px + Rm[0] * nodePos.x + Rm[1] * nodePos.y + Rm[2] * nodePos.z, cy = self.py + Rm[3] * nodePos.x + Rm[4] * nodePos.y + Rm[5] * nodePos.z, cz = self.pz + Rm[6] * nodePos.x + Rm[7] * nodePos.y + Rm[8] * nodePos.z;
            var reach = sb.radiusOf(k) + nodeTriMargin;
            for(var i = 0; i < list.length; i++) if(ground.boxNear(list[i], cx, cy, cz, reach)) { tris.push(list[i]); nodeTriCount++; }
        }
    }
    // ---- two cars that hit each other (M4): the nodes of this car against the collision spheres of the others, where those are now (bent or
    // not). The other car does the same with its nodes against ours, so both cars dent and nobody has to hand a force over to the other. The
    // others are put here by OpenRacer.collideCars (Opponent.js) once a frame. Found once per step of the physics, like the triangles: the cache
    // holds where the spheres of the cars that are near are (world, with their speed) and every node the spheres that it can touch.
    this.otherCars = [];
    this.boundRadius = function () { ensureProxy(); return proxyRadius; };
    var sphereTmp = { x: 0, y: 0, z: 0 }, sphereVel = { x: 0, y: 0, z: 0 }, sphereNode = { x: 0, y: 0, z: 0 };
    // The sphere i of this car in the world: [x, y, z, r, vx, vy, vz] into out at offset o; false when it is gone (a torn node, a wheel that is off)
    this.sphereWorld = function (i, out, o) {
        ensureProxy();
        var sp = self.proxy3[i];
        if(!sp || sp.disabled) return false;
        var sb = self.softBody, x = sp.x, y = sp.y, z = sp.z, r = sp.r, node = sb ? sb.nodeOfSphere[i] : -1;
        if(node >= 0) {
            if(!sb.alive(node)) return false;
            sb.position(node, sphereNode); x = sphereNode.x; y = sphereNode.y; z = sphereNode.z; r = sb.radiusOf(node);
            sb.velocity(node, sphereVel);
        } else { sphereVel.x = 0; sphereVel.y = 0; sphereVel.z = 0; }
        rotate(self.qx, self.qy, self.qz, self.qw, x, y, z, sphereTmp);
        var rx = sphereTmp.x, ry = sphereTmp.y, rz = sphereTmp.z;
        out[o] = self.px + rx; out[o + 1] = self.py + ry; out[o + 2] = self.pz + rz; out[o + 3] = r;
        rotate(self.qx, self.qy, self.qz, self.qw, sphereVel.x, sphereVel.y, sphereVel.z, sphereTmp);
        out[o + 4] = self.vx + (self.wy * rz - self.wz * ry) + sphereTmp.x;
        out[o + 5] = self.vy + (self.wz * rx - self.wx * rz) + sphereTmp.y;
        out[o + 6] = self.vz + (self.wx * ry - self.wy * rx) + sphereTmp.z;
        return true;
    };
    var carCache = new Float64Array(7 * 512), carCacheCount = 0, carPairs = [], carPairCount = 0;
    this.carContacts = 0;                              // for the debugging: the pairs of spheres that touch now
    this.carHit = 0;                                   // the biggest force between two cars on a node
    function buildCarPairs() {
        carPairCount = 0; carCacheCount = 0;
        var others = self.otherCars, sb = self.softBody;
        if(!sb || !others.length || !self.ground || !self.ground.use3D) return;
        ensureProxy();
        for(var oi = 0; oi < others.length; oi++) {
            var o = others[oi];
            if(o === self) continue;
            var dx = o.px - self.px, dy = o.py - self.py, dz = o.pz - self.pz, reach = proxyRadius + o.boundRadius() + 0.6;
            if(dx * dx + dy * dy + dz * dz > reach * reach) continue;
            var spheres = o.proxy3;
            if(carCache.length < 7 * (carCacheCount + spheres.length)) { var bigger = new Float64Array(2 * carCache.length + 7 * spheres.length); bigger.set(carCache); carCache = bigger; }
            for(var j = 0; j < spheres.length; j++) if(o.sphereWorld(j, carCache, 7 * carCacheCount)) carCacheCount++;
        }
        if(!carCacheCount) return;
        for(var k = 0; k < sb.count; k++) {
            var list = carPairs[k] || (carPairs[k] = []);
            list.length = 0;
            if(!sb.alive(k)) continue;
            sb.position(k, nodePos);
            var cx = self.px + Rm[0] * nodePos.x + Rm[1] * nodePos.y + Rm[2] * nodePos.z, cy = self.py + Rm[3] * nodePos.x + Rm[4] * nodePos.y + Rm[5] * nodePos.z, cz = self.pz + Rm[6] * nodePos.x + Rm[7] * nodePos.y + Rm[8] * nodePos.z;
            var rk = sb.radiusOf(k) + 0.25;                      // a node moves a few centimetres in a step; the other car too
            for(var g = 0; g < carCacheCount; g++) {
                var ex = cx - carCache[7 * g], ey = cy - carCache[7 * g + 1], ez = cz - carCache[7 * g + 2], rr = rk + carCache[7 * g + 3];
                if(ex * ex + ey * ey + ez * ez < rr * rr) { list.push(g); carPairCount++; }
            }
        }
    }
    var carOver = [];
    function carContactsOfNode(k, cx, cy, cz, r, rx, ry, rz, h, out) {
        var P = self.softBody.params, sb = self.softBody;
        var list = carPairs[k];
        if(!list || !list.length) return;
        var n = 0;
        for(var i = 0; i < list.length; i++) {
            var g = list[i];
            var dx = cx - carCache[7 * g], dy = cy - carCache[7 * g + 1], dz = cz - carCache[7 * g + 2], rr = r + carCache[7 * g + 3];
            if(dx * dx + dy * dy + dz * dz < rr * rr) carOver[n++] = g;
        }
        if(!n) return;
        sb.velocity(k, nodeVel);
        var vx = self.vx + (self.wy * rz - self.wz * ry) + Rm[0] * nodeVel.x + Rm[1] * nodeVel.y + Rm[2] * nodeVel.z;
        var vy = self.vy + (self.wz * rx - self.wx * rz) + Rm[3] * nodeVel.x + Rm[4] * nodeVel.y + Rm[5] * nodeVel.z;
        var vz = self.vz + (self.wx * ry - self.wy * rx) + Rm[6] * nodeVel.x + Rm[7] * nodeVel.y + Rm[8] * nodeVel.z;
        // the node has one stiffness: shared over the spheres that it touches
        var kc = P.contactK / n, cc = 2 * P.contactDamping * Math.sqrt(kc * sb.massOf(k));
        for(var m = 0; m < n; m++) {
            var s = carOver[m] * 7;
            var ex = cx - carCache[s], ey = cy - carCache[s + 1], ez = cz - carCache[s + 2];
            var dist = Math.sqrt(ex * ex + ey * ey + ez * ez), nx, ny, nz;
            if(dist > 1e-5) { nx = ex / dist; ny = ey / dist; nz = ez / dist; } else { nx = 0; ny = 1; nz = 0; dist = 0; }
            var depth = r + carCache[s + 3] - dist;
            var wx = vx - carCache[s + 4], wy = vy - carCache[s + 5], wz = vz - carCache[s + 6];
            var vn = wx * nx + wy * ny + wz * nz;
            var fn = Math.max(0, kc * depth - cc * vn);
            var tx = wx - vn * nx, ty = wy - vn * ny, tz = wz - vn * nz;
            var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
            var ft = tl > 1e-6 ? Math.min(P.friction * fn, tl * sb.massOf(k) / h / n) : 0;
            out.x += fn * nx - (tl > 1e-6 ? ft * tx / tl : 0); out.y += fn * ny - (tl > 1e-6 ? ft * ty / tl : 0); out.z += fn * nz - (tl > 1e-6 ? ft * tz / tl : 0);
            if(fn > self.carHit) self.carHit = fn;
        }
        self.carContacts += n;
    }

    function nodeContacts(h) {
        var sb = self.softBody, ground = self.ground;
        var P = sb.params;
        var upX = Rm[1], upY = Rm[4], upZ = Rm[7];
        if(!nodeTriCount && !carPairCount) return;
        var yUnder = -self.cgHeight + self.groundClearance;
        var ux = self.px + upX * yUnder, uy = self.py + upY * yUnder, uz = self.pz + upZ * yUnder;
        for(var k = 0; k < sb.count; k++) {
            if(!sb.alive(k)) continue;
            sb.position(k, nodePos);
            var rx = Rm[0] * nodePos.x + Rm[1] * nodePos.y + Rm[2] * nodePos.z, ry = Rm[3] * nodePos.x + Rm[4] * nodePos.y + Rm[5] * nodePos.z, rz = Rm[6] * nodePos.x + Rm[7] * nodePos.y + Rm[8] * nodePos.z;
            var cx = self.px + rx, cy = self.py + ry, cz = self.pz + rz, r = sb.radiusOf(k);
            var fx = 0, fy = 0, fz = 0;
            var mine = nodeTriCount ? nodeTris[k] : null;
            if(carPairCount) { carForce.x = 0; carForce.y = 0; carForce.z = 0; carContactsOfNode(k, cx, cy, cz, r, rx, ry, rz, h, carForce); fx = carForce.x; fy = carForce.y; fz = carForce.z; }
            if(!mine || !mine.length) mine = noTriangles;
            for(var i = 0; i < mine.length; i++) {
                var t = mine[i];
                var d2 = ground.closest(t, cx, cy, cz, nearest);
                if(d2 >= r * r) continue;
                var dist = Math.sqrt(d2);
                var nx, ny, nz;
                if(dist > 1e-5) { nx = (cx - nearest.x) / dist; ny = (cy - nearest.y) / dist; nz = (cz - nearest.z) / dist; }
                else { ground.normalOf(t, triNormal); nx = triNormal.x; ny = triNormal.y; nz = triNormal.z; dist = 0; }
                var depth = r - dist;
                if(depth < 1e-4) continue;
                if(nearest.region !== 0) {
                    ground.normalOf(t, triNormal);
                    var along = nx * triNormal.x + ny * triNormal.y + nz * triNormal.z;
                    if(along < 0) along = -along;
                    if(along < 0.85) continue;
                }
                var nUp = nx * upX + ny * upY + nz * upZ;
                if(ny >= 0.5 || nUp >= 0.5) continue;           // a surface that the car rides on: the springs of the body (bodyContacts3D)
                if(ground.lineRange(t, nearest.x, nearest.y, nearest.z, upX, upY, upZ, wallRange)) {
                    var top = (nearest.x - ux) * upX + (nearest.y - uy) * upY + (nearest.z - uz) * upZ + wallRange[1];
                    if(top < self.kerbHeight) continue;          // lower than the kerb height: driven over
                }
                // the speed of the node against the wall
                sb.velocity(k, nodeVel);
                var vx = self.vx + (self.wy * rz - self.wz * ry) + Rm[0] * nodeVel.x + Rm[1] * nodeVel.y + Rm[2] * nodeVel.z;
                var vy = self.vy + (self.wz * rx - self.wx * rz) + Rm[3] * nodeVel.x + Rm[4] * nodeVel.y + Rm[5] * nodeVel.z;
                var vz = self.vz + (self.wx * ry - self.wy * rx) + Rm[6] * nodeVel.x + Rm[7] * nodeVel.y + Rm[8] * nodeVel.z;
                var vn = vx * nx + vy * ny + vz * nz;
                var cc = 2 * P.contactDamping * Math.sqrt(P.contactK * sb.massOf(k));
                var fn = Math.max(0, P.contactK * depth - cc * vn);
                var tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
                var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
                var ft = tl > 1e-6 ? Math.min(P.friction * fn, tl * sb.massOf(k) / h) : 0;
                fx += fn * nx - (tl > 1e-6 ? ft * tx / tl : 0); fy += fn * ny - (tl > 1e-6 ? ft * ty / tl : 0); fz += fn * nz - (tl > 1e-6 ? ft * tz / tl : 0);
                if(fn > 0 && self.shellHit < fn) self.shellHit = fn;
            }
            if(fx !== 0 || fy !== 0 || fz !== 0) {
                // into the frame of the car
                var o = 3 * k;
                sb.force[o] += Rm[0] * fx + Rm[3] * fy + Rm[6] * fz;
                sb.force[o + 1] += Rm[1] * fx + Rm[4] * fy + Rm[7] * fz;
                sb.force[o + 2] += Rm[2] * fx + Rm[5] * fy + Rm[8] * fz;
            }
        }
    }
    this.shellHit = 0;                                // the biggest force of a wall on a node, for the debugging

    // One step of the shell, and the force and the torque of its anchors on the car
    function shellStep(dt, force, torque) {
        var sb = self.softBody;
        ensureProxy();
        refreshCandidates();
        setTurn();
        self.carContacts = 0; self.carHit = 0;
        buildCarPairs();
        if(sb.quiet && !sb.plate && !wallCandidates.length && !carPairCount && Rm[4] > 0.2) return;      // nothing to hit and nothing moving
        if(carPairCount) sb.quiet = false;
        buildNodeTriangles();
        sb.step(dt, nodeContacts);
        var rc = sb.reaction;
        var fx = Rm[0] * rc[0] + Rm[1] * rc[1] + Rm[2] * rc[2], fy = Rm[3] * rc[0] + Rm[4] * rc[1] + Rm[5] * rc[2], fz = Rm[6] * rc[0] + Rm[7] * rc[1] + Rm[8] * rc[2];
        var tx = Rm[0] * rc[3] + Rm[1] * rc[4] + Rm[2] * rc[5], ty = Rm[3] * rc[3] + Rm[4] * rc[4] + Rm[5] * rc[5], tz = Rm[6] * rc[3] + Rm[7] * rc[4] + Rm[8] * rc[5];
        if(sb.pinned) return;                         // the car is clamped (the car editor pushes a plate on it): the anchors do not move the car
        force.x += fx; force.y += fy; force.z += fz;
        torque.x += tx; torque.y += ty; torque.z += tz;
    }

    // soft contacts: a damped spring along the normal of the surface and friction along it, at the point of contact
    function bodyContacts3D(force, torque) {
        self.softContacts = scanContacts(true);       // for the debugging
        if(!self.softContacts) return;
        var kBody = 20 * self.mass, cBody = 1.0 * Math.sqrt(kBody * self.mass);
        var kTyre = 0.5 * self.tyreRate, cTyre = 0.3 * Math.sqrt(kTyre * self.mass);      // a tyre against a kerb or a ramp: the stiffness of the tyre
        for(var i = 0; i < contactCount; i++) {
            var c = contacts3[i];
            var kc = c.tyre ? kTyre : kBody, cc = c.tyre ? cTyre : cBody;
            var rx = c.qx - self.px, ry = c.qy - self.py, rz = c.qz - self.pz;
            var cx = self.vx + (self.wy * rz - self.wz * ry);
            var cy = self.vy + (self.wz * rx - self.wx * rz);
            var cz = self.vz + (self.wx * ry - self.wy * rx);
            var vn = cx * c.nx + cy * c.ny + cz * c.nz;
            var fn = Math.max(0, kc * c.depth - cc * vn);
            var tx = cx - vn * c.nx, ty = cy - vn * c.ny, tz = cz - vn * c.nz;
            var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
            var ft = Math.min(self.bodyFriction * fn, tl * 0.5 * self.mass / 4);    // the underside of a car slides on the road with about 0.3
            var fx = fn * c.nx, fy = fn * c.ny, fz = fn * c.nz;
            if(tl > 1e-6) { fx -= ft * tx / tl; fy -= ft * ty / tl; fz -= ft * tz / tl; }
            force.x += fx; force.y += fy; force.z += fz;
            torque.x += ry * fz - rz * fy; torque.y += rz * fx - rx * fz; torque.z += rx * fy - ry * fx;
        }
    }

    // walls: the car is pushed out along the normal and gets an impulse, like the walls of the standard physics but in 3D
    var impactSpeed3 = { value: 0 };
    function resolveCollisions3D() {
        for(var pass = 0; pass < 3; pass++) {
            if(!scanContacts(false)) return;
            var best = 0;
            for(var i = 1; i < contactCount; i++) if(contacts3[i].depth > contacts3[best].depth) best = i;
            var c = contacts3[best];
            self.lastWall = { mesh: self.ground.meshOf(c.tri), surface: self.ground.surfaceOf(c.tri), n: [c.nx, c.ny, c.nz], depth: c.depth, at: [c.qx, c.qy, c.qz], sphere: c.sphere, v: [self.vx, self.vy, self.vz], t: self.impactTime };   // for the debugging
            var rx = c.qx - self.px, ry = c.qy - self.py, rz = c.qz - self.pz;
            if(self.debugWalls) self.debugWalls.push({ mesh: self.ground.meshOf(c.tri), tri: c.tri, n: [c.nx, c.ny, c.nz], depth: c.depth, sphere: c.sphere, p0: [self.px, self.py, self.pz], v: [self.vx, self.vy, self.vz], pass: pass, count: contactCount });
            var push = Math.min(c.depth, 0.15);     // a big overlap is taken out in steps
            self.px += c.nx * push; self.py += c.ny * push; self.pz += c.nz * push;
            candX = 1e9;     // the car moved: look again for the triangles around it
            var jn = impulseAt(rx, ry, rz, c.nx, c.ny, c.nz, self.wallRestitution, impactSpeed3);
            if(jn === 0) continue;                                    // already moving away
            wheelHit(c.sphere, jn);
            // scraping along the wall: an impulse along the surface, at most a share of the impulse of the hit
            var cx = self.vx + (self.wy * rz - self.wz * ry);
            var cy = self.vy + (self.wz * rx - self.wx * rz);
            var cz = self.vz + (self.wx * ry - self.wy * rx);
            var vn = cx * c.nx + cy * c.ny + cz * c.nz;
            var tx = cx - vn * c.nx, ty = cy - vn * c.ny, tz = cz - vn * c.nz;
            var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
            if(tl > 1e-6) {
                var jt = Math.min(self.wallFriction * jn, tl * self.mass * 0.5);
                self.vx -= jt * tx / tl / self.mass; self.vy -= jt * ty / tl / self.mass; self.vz -= jt * tz / tl / self.mass;
            }
            if(impactSpeed3.value > self.lastImpact || self.impactTime > 0.5) {
                self.lastImpact = impactSpeed3.value;
                self.impactTime = 0;
            }
        }
    }

    // ---- the body on the road: the corners of the body touch it after a landing or when the car has turned over
    var corner = { x: 0, y: 0, z: 0 }, local = { x: 0, y: 0, z: 0 };
    var cornerForce = { x: 0, y: 0, z: 0 };
    function bodyCorners(force, torque) {
        var yBottom = -self.cgHeight + self.groundClearance;
        var yTop = yBottom + self.bodyHeight;
        var zCentre = (self.af - self.ar) / 2;
        // a stiff contact that is well damped: the underside of a car that bottoms out scrapes and deforms, it does not bounce
        // (with a quarter of the critical damping the body came back up from a landing as if from a trampoline)
        var kc = 30 * self.mass, cc = 1.0 * Math.sqrt(kc * self.mass);
        for(var k = 0; k < 8; k++) {
            local.x = (k & 1 ? 1 : -1) * self.halfWidth;
            local.y = (k & 2 ? yTop : yBottom);
            local.z = zCentre + (k & 4 ? 1 : -1) * self.halfLength;
            rotate(self.qx, self.qy, self.qz, self.qw, local.x, local.y, local.z, corner);
            var rx = corner.x, ry = corner.y, rz = corner.z;
            var qx = self.px + rx, qy = self.py + ry, qz = self.pz + rz;
            var road = roadAt(qx, qz, qy, 0.4);
            if(!road || qy >= road.y) continue;
            var depth = road.y - qy;
            var cx = self.vx + (self.wy * rz - self.wz * ry);
            var cy = self.vy + (self.wz * rx - self.wx * rz);
            var cz = self.vz + (self.wx * ry - self.wy * rx);
            var vn = cx * road.nx + cy * road.ny + cz * road.nz;
            var fn = Math.max(0, kc * depth - cc * vn);
            // friction along the road
            var tx = cx - vn * road.nx, ty = cy - vn * road.ny, tz = cz - vn * road.nz;
            var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
            var ft = Math.min(0.6 * fn, tl * 0.5 * self.mass / 4);
            var fx = fn * road.nx, fy = fn * road.ny, fz = fn * road.nz;
            if(tl > 1e-6) { fx -= ft * tx / tl; fy -= ft * ty / tl; fz -= ft * tz / tl; }
            force.x += fx; force.y += fy; force.z += fz;
            torque.x += ry * fz - rz * fy; torque.y += rz * fx - rx * fz; torque.z += rx * fy - ry * fx;
        }
    }

    // ---- one step of the physics (small: 1/300 s or less)
    var Mv = { x: 0, y: 0, z: 0 }, Rv = { x: 0, y: 0, z: 0 }, Cv = { x: 0, y: 0, z: 0 };
    var force = { x: 0, y: 0, z: 0 }, torque = { x: 0, y: 0, z: 0 };
    var alpha = { x: 0, y: 0, z: 0 };
    var comp = [0, 0, 0, 0], compVelocity = [0, 0, 0, 0], tyreLoad = [0, 0, 0, 0], springForce = [0, 0, 0, 0];
    var forceBody = { x: 0, y: 0, z: 0 };
    var lastBodyAccDown = 0;

    function step(dt) {
        var inp = self.input;
        var engine = self.engine;
        var wheels = self.wheels;
        var m = self.mass;
        var L = self.wheelbase;
        var delta = inp.turnAngle || 0;

        self.updateOutputs();
        var u = self.u, v = self.v, r = self.r;
        if(self.controller) delta = self.controller.steering(self, delta, u, dt);

        // ---- ESC, the electronic stability control
        // Sensors tell it what the driver asks for (the steering angle gives the direction that the car should turn to, at
        // this speed) and what the car does (its yaw rate). When these differ, it steps in: a car that turns more than
        // asked (oversteer) gets a short brake on the outer front wheel, which pulls the nose back out; a car that turns
        // less (understeer) gets the inner rear wheel braked, which turns it in. Both also take power off the engine. The
        // steering itself is not touched. It can only do so much, so a sudden steer from left to right at speed can still
        // make the car slide.
        var escBrake = [0, 0, 0, 0];
        var escCut = 0;
        // (not on a motorcycle: its front wheel is turned a little for a lot of yaw in a bend, which looks like oversteer to it, and a brake on the front in a bend throws a bike down)
        if(self.escEnabled && self.escFitted && !self.controller && !inp.handbrake && u > 5 && !self.airborne) {
            var steady = u * delta / (L + self.understeerGradient * u * u); // the yaw rate that goes with the steering
            // the car follows a steering movement with a delay: a car that is only just starting to turn is not understeering
            self.yawWanted += (steady - self.yawWanted) * Math.min(1, dt / 0.25);
            var wanted = self.yawWanted;
            var error = r - wanted;
            var amount = Math.min(1, Math.max(0, (Math.abs(error) - 0.1) / 0.3) * self.escGain);
            var magnitude = 0;
            // the direction the car moves in against the way it points (the slip angle of the car): a rear end that
            // slides out is seen at once, also when the car does not turn faster than the steering asks
            var slipAngle = Math.atan2(v, u);
            var rearOut = Math.min(1, Math.max(0, (-Math.sign(r) * slipAngle - 0.05) / 0.12)) * Math.min(1, Math.abs(r) / 0.15);
            if((Math.abs(r) > Math.abs(wanted) && r * error > 0) || rearOut > 0) {
                escBrake[r > 0 ? 1 : 0] = 1;          // oversteer: the outer front wheel
                magnitude = Math.max(amount, rearOut);
            } else if(Math.abs(r) < Math.abs(wanted) && wanted * error < 0) {
                escBrake[wanted > 0 ? 3 : 2] = 0.7;   // understeer: the inner rear wheel
                magnitude = amount * 0.7;
            }
            self.escLevel += (magnitude - self.escLevel) * Math.min(1, dt / 0.04);
            escCut = self.escLevel;
            for(var k = 0; k < 4; k++) escBrake[k] *= self.escLevel * (k < 2 ? self.brakeFront : self.brakeRear) * Math.min(1.5, self.escGain);
        } else {
            self.escLevel = 0;
            self.yawWanted = r;
        }
        self.steerApplied = delta; // the steering of the driver is used as it is
        // Ackermann: the angle of each front wheel. With the full geometry the inner wheel turns around the same point as the
        // outer one: tan(inner) = L / (R - t/2), tan(outer) = L / (R + t/2) with R = L / tan(delta). Positive delta is to the right.
        var steerOf = [delta, delta]; // front right, front left (the toe comes below)
        if(Math.abs(delta) > 1e-4 && self.ackermann > 0) {
            var R = L / Math.tan(Math.abs(delta)), half = self.front_track / 2;
            var inner = Math.atan(L / Math.max(0.3, R - half)), outer = Math.atan(L / (R + half));
            var dInner = Math.abs(delta) + (inner - Math.abs(delta)) * self.ackermann, dOuter = Math.abs(delta) + (outer - Math.abs(delta)) * self.ackermann;
            var sign = delta > 0 ? 1 : -1;
            steerOf = delta > 0 ? [sign * dInner, sign * dOuter] : [sign * dOuter, sign * dInner];
        }
        // toe: a wheel on the right (x negative) points inwards with a turn to the left (a negative angle), one on the left with a turn to the right
        var toeF = self.toeFront * Math.PI / 180, toeR = self.toeRear * Math.PI / 180;
        var wheelAngle = [steerOf[0] - toeF, steerOf[1] + toeF, toeR, -toeR]; // FR, FL, RL, RR
        for(var sn = 0; sn < 4; sn++) wheels[sn].steerNow = wheelAngle[sn];
        updateHubs();
        // a bent suspension: a wheel that is damaged points a little to the side, and grips less
        for(var bi = 0; bi < 4; bi++) {
            var wb = wheels[bi], dmg = self.wheelDamage[bi];
            if(self.hubNode[bi] < 0) {
                wb.toeBend = dmg * 0.09 * (wb.right ? -1 : 1);
                wb.camberBend = dmg * 0.12 * (wb.right ? -1 : 1);
            }
            wb.damageGrip = 1 - 0.4 * dmg;
            wheelAngle[bi] += wb.toeBend;
            if(self.wheelLost[bi]) wb.omega = 0;
        }

        // ---- the springs: how far every wheel is pushed in, and the force that makes
        var down = { x: -axisY.x, y: -axisY.y, z: -axisY.z };
        var ground3D = !!(self.ground && self.ground.use3D);
        var anyContact = false;
        // the roll of the body (positive: leaning to the right), for the camber of the wheels of the tyre bodies (as below for the ring of nodes)
        rotateInverse(self.qx, self.qy, self.qz, self.qw, 0, 1, 0, tmpA);
        var rollRightNow = Math.asin(Math.max(-1, Math.min(1, tmpA.x)));
        for(var i = 0; i < 4; i++) {
            var w = wheels[i];
            rotate(self.qx, self.qy, self.qz, self.qw, w.mount.x + (w.shiftX || 0), w.mount.y, w.mount.z + (w.shiftZ || 0), Rv);
            var mx = self.px + Rv.x, my = self.py + Rv.y, mz = self.pz + Rv.z;
            // The wheel is round: the road is sampled ahead of and behind the middle of the wheel, and the rim touches where it
            // reaches the road first. So a kerb or an edge lifts the wheel gradually as it rolls on to it, instead of all at once
            // when the middle passes it. The surface under the middle is the one that counts for the grip.
            var road = null, t = Infinity, surfaceRoad = null;
            var cyl = ground3D && !self.wheelLost[i] && !self.simpleTyres;       // the tyre is a body of nodes (TyreShell.js): it finds the road itself (a wheel that is lost has no tyre)
            if(ground3D && self.simpleTyres && !self.wheelLost[i]) {
                // the simple tyre: the road is sampled ahead of and behind the middle of the wheel with rays along the axis of the suspension (down for the car, whichever way that is in
                // the world) from a little above the mount, and the rim touches where it reaches the road first, so a kerb lifts the wheel gradually as it rolls on to it; the surface under
                // the middle is the one that counts for the grip
                var RISE = 0.3;
                for(var sk = -2; sk <= 2; sk++) {
                    var alongR = sk * 0.4 * w.radius;
                    var hit = self.ground.ray(mx + axisZ.x * alongR + axisY.x * RISE, my + axisZ.y * alongR + axisY.y * RISE, mz + axisZ.z * alongR + axisY.z * RISE,
                        down.x, down.y, down.z, RISE + w.freeLength + w.radius + 0.5, 0.17);
                    if(!hit) continue;
                    if(sk === 0) surfaceRoad = hit;
                    var tR = hit.t - RISE + (w.radius - Math.sqrt(w.radius * w.radius - alongR * alongR));
                    if(tR < t) { t = tR; road = hit; }
                }
            }
            // The wheel is a mass of its own (the unsprung mass) that hangs on the spring and the damper and stands on the tyre, which
            // is a stiff spring too. The road pushes the tyre in, the tyre pushes the wheel up, the wheel pushes the spring in, the
            // spring pushes the body: a kerb is taken up by the tyre and the wheel first and reaches the body softened, as it does
            // in a car. The place of the wheel along the suspension (susLength, from the mount) and its speed (susVel, positive
            // when it goes out) are the state of that.
            // how fast the mount moves towards the road, to know how fast the road comes at the tyre
            var vmx = self.vx + (self.wy * Rv.z - self.wz * Rv.y);
            var vmy = self.vy + (self.wz * Rv.x - self.wx * Rv.z);
            var vmz = self.vz + (self.wx * Rv.y - self.wy * Rv.x);
            var mountDown = vmx * down.x + vmy * down.y + vmz * down.z;
            w.hasContact = false;
            tyreLoad[i] = 0;
            if(road && !self.wheelLost[i]) {
                var pen = (w.susLength + w.radius) - t;      // how far the road pushes the tyre in
                if(pen > 0) {
                    w.hasContact = true;
                    anyContact = true;
                    w.surface = (surfaceRoad || road).surface;
                    w.groundY = road.y;
                    w.normal = road;
                    w.contact.x = mx + down.x * t; w.contact.y = my + down.y * t; w.contact.z = mz + down.z * t;
                    var penRate = w.susVel + mountDown;
                    // (the tyre gets hard when it is pushed in a long way)
                    var hard = pen > 0.22 * w.radius ? 1 + 10 * (pen - 0.22 * w.radius) / w.radius : 1;
                    tyreLoad[i] = Math.max(0, (w.tyreRate || self.tyreRate) * pen * hard + self.tyreDamping * penRate);
                    w.tyreDeflection = pen;  // how far the road pushes the tyre in (m)
                }
            }
            w.cylActive = false;
            if(cyl) {
                var body = w.tyreBody || (w.tyreBody = new OpenRacer.TyreShell(w));
                var shellOf = self.tyreShellOf(w);
                { body.isShell = true; body.round = !!self.soloWheels; body.tyreMass = Math.max(1.5, 0.3 * self.unsprungMass); body.pressure = Math.max(0.15, (w.front ? self.pressureFront : self.pressureRear) - (w.pressureLoss || 0)); body.innerRatio = shellOf.inner_ratio; body.carcass = shellOf.carcass; }
                body.rings = shellOf.rings; body.segments = shellOf.segments; body.width = shellOf.width;
                body.stiffX = self.tyreStiffX; body.stiffY = self.tyreStiffY * self.corneringScale * (w.stiffnessBias || 1) * (w.pressureCorner || 1);
                body.verticalStiffness = w.tyreRate || self.tyreRate; body.verticalDamping = self.tyreDamping; body.staticLoad = w.staticLoad || (self.mass * G / 4);
                // the axes of the wheel: up (the suspension), forward in its plane (turned by the steering), and to the left
                var ca = Math.cos(wheelAngle[i]), sa = Math.sin(wheelAngle[i]);
                var cfx = axisZ.x * ca - axisX.x * sa, cfy = axisZ.y * ca - axisX.y * sa, cfz = axisZ.z * ca - axisX.z * sa;
                var cdot = cfx * axisY.x + cfy * axisY.y + cfz * axisY.z;
                cfx -= axisY.x * cdot; cfy -= axisY.y * cdot; cfz -= axisY.z * cdot;
                var cfl = Math.sqrt(cfx * cfx + cfy * cfy + cfz * cfz) || 1; cfx /= cfl; cfy /= cfl; cfz /= cfl;
                cylF.x = cfx; cylF.y = cfy; cylF.z = cfz;
                cylL.x = axisY.y * cfz - axisY.z * cfy; cylL.y = axisY.z * cfx - axisY.x * cfz; cylL.z = axisY.x * cfy - axisY.y * cfx;
                // the camber: the wheel leans to the left by its static camber less what the roll of the body takes (and a bent knuckle); the up of the tyre and its axle turn with it
                // about its forward axis, so the shoulder on the side it leans to carries more, and the tread that goes round a leaning wheel is pulled sideways by the road: the camber
                // thrust. (A motorcycle: its wheels lean with it and nothing more.)
                var camberDeg = w.front ? self.camberFront : self.camberRear;
                var lean = self.soloWheels ? 0 : (w.right ? -camberDeg : camberDeg) * Math.PI / 180 - rollRightNow * self.rollCamber - (w.camberBend || 0);
                if(!self.soloWheels && self.liveAxle[w.front ? "front" : "rear"]) lean = self.axleLean(w.front) - (w.camberBend || 0);
                var cl = Math.cos(lean), sl = Math.sin(lean);
                cylU.x = axisY.x * cl + cylL.x * sl; cylU.y = axisY.y * cl + cylL.y * sl; cylU.z = axisY.z * cl + cylL.z * sl;
                cylL.x = cylL.x * cl - axisY.x * sl; cylL.y = cylL.y * cl - axisY.y * sl; cylL.z = cylL.z * cl - axisY.z * sl;
                w.lean = lean;
                cylHub.x = mx - axisY.x * w.susLength; cylHub.y = my - axisY.y * w.susLength; cylHub.z = mz - axisY.z * w.susLength;
                cylVel.x = vmx + down.x * w.susVel; cylVel.y = vmy + down.y * w.susVel; cylVel.z = vmz + down.z * w.susVel;
                ensureProxy();
                refreshCandidates();
                var reach = w.radius + (body.width > 0 ? body.width : 0.7 * w.radius) / 2 + 0.12, wl = wheelList[i];
                wl.length = 0;
                for(var cc = 0; cc < candidates.length; cc++) if(self.ground.boxNear(candidates[cc], cylHub.x, cylHub.y, cylHub.z, reach)) wl.push(candidates[cc]);
                var touched = body.step(dt, cylHub, cylVel, cylL, cylF, cylU, w.omega, self.ground, wl, function (load, name) { return w.frictionFor(load, self.getSurface(name, w.localSnow, w.localWater)); }, w.lateralGrip, self.mass);
                if(touched) {
                    var up = body.normal.x * axisY.x + body.normal.y * axisY.y + body.normal.z * axisY.z + body.friction.x * axisY.x + body.friction.y * axisY.y + body.friction.z * axisY.z;
                    tyreLoad[i] = Math.max(0, up);
                    // (a motorcycle: a tyre carries no more than six times its static load; a leaned landing from a jump at 170 km/h pressed one in to 31 kN, and the bike was thrown over)
                    if(self.soloWheels) tyreLoad[i] = Math.min(tyreLoad[i], 25 * (w.staticLoad || 1500));       // (6 before: a landing from 3 m needs more than that, the bike went through the road)
                    // what is left of the pressing forces across the suspension (the side of a ramp, a wall, a slope) goes to the car at the hub
                    var nu = body.normal.x * axisY.x + body.normal.y * axisY.y + body.normal.z * axisY.z;
                    w.perpX = body.normal.x - nu * axisY.x; w.perpY = body.normal.y - nu * axisY.y; w.perpZ = body.normal.z - nu * axisY.z;
                    w.hasContact = true; anyContact = true; w.cylActive = true;
                    w.surface = body.surface; w.groundY = body.groundY;
                    w.normal = { nx: body.surfaceNormal.x, ny: body.surfaceNormal.y, nz: body.surfaceNormal.z, y: body.groundY, surface: body.surface, mesh: body.mesh };
                    w.contact.x = body.centre.x; w.contact.y = body.centre.y; w.contact.z = body.centre.z;
                    w.tyreDeflection = body.maxDepth;
                }
            }
            if(w.hasContact && !w.hadContact && self.vy < -3) self.soundImpact = Math.max(self.soundImpact || 0, Math.min(1, -self.vy / 12));       // (a landing)
            if(!w.hasContact) { w.tyreDeflection = 0; w.hadContact = false; }
            comp[i] = w.freeLength - w.susLength;
            compVelocity[i] = -w.susVel;
            w.suspensionLength = w.susLength;
        }
        // how long the car has been in the air, and how long its last flight was (set at the touchdown; a motorcycle's rider braces after a flight)
        if(!anyContact) self.airTime = (self.airTime || 0) + dt;
        else { if(self.airborne) self.lastFlight = self.airTime || 0; self.airTime = 0; }
        self.airborne = !anyContact;
        // the anti-roll bars push the wheel that is pushed in more down, and the other up
        var arbF = arbFront * (comp[1] - comp[0]);       // front: left minus right
        var arbR = arbRear * (comp[2] - comp[3]);        // rear: left minus right
        var arbForce = self.soloWheels ? [0, 0, 0, 0] : [-arbF, arbF, arbR, -arbR];      // on FR, FL, RL, RR (in the order of the wheels); a motorcycle has no bar

        // the spring, the damper, the bump stop and the anti-roll bar: the force between the body and the wheel (positive pushes
        // the wheel out, away from the body), and the wheel moves on it against the tyre
        var mBody = m - 4 * self.unsprungMass;
        var gDown = G * axisY.y;                          // the pull of gravity on a wheel along the suspension, outwards
        for(var si = 0; si < 4; si++) {
            var ws = wheels[si];
            var rateS = ws.rate;
            var zetaS = ws.front ? self.frontDamping : self.rearDamping;
            var cS = 2 * zetaS * Math.sqrt(rateS * ws.mass);
            var xdotS = -ws.susVel;                        // positive while the spring is pushed in
            // the damper is digressive: past a knee the force grows only slowly with the speed (the blow-off of a real damper), so a
            // sharp hit of the wheel does not go through the damper into the body
            var cUse = xdotS > 0 ? cS : cS * self.reboundFactor;
            var knee = 0.3, mag = Math.abs(xdotS);
            var blow = xdotS > 0 ? 0.35 : 0.7;               // (going out the damper holds on better: a spring that is let go does not throw the body up)
            // a fork or a shock of a motorcycle: no blow-off, and a hard hit (a landing from a wheelie) is taken by the damper, twice as much from 0.5 m/s, and the rebound is held
            // (the tyre does not bounce back off the road)
            if(self.soloWheels) { blow = 1; if(xdotS <= 0) cUse *= 1.25; }
            var damperS = (mag <= knee ? cUse * mag : cUse * (knee + blow * (mag - knee))) * (xdotS > 0 ? 1 : -1);
            // the bump stop and the droop stop: stiff, and damped (a wheel that lands on an undamped stop rings on it at 16 Hz)
            var stopRate = 12 * rateS, stopDamping = 2.5 * Math.sqrt(stopRate * self.unsprungMass);
            // (the damping works both ways, and only the force that comes out is kept above zero: a stop that only damps going in gives back the energy that it took, and a truck
            // that lands hard bounces off it like a trampoline)
            var bumpS = ws.susLength < ws.minLength ? Math.max(0, stopRate * (ws.minLength - ws.susLength) + stopDamping * xdotS) : 0;
            var droopS = ws.susLength > ws.freeLength ? Math.min(0, -stopRate * (ws.susLength - ws.freeLength) - stopDamping * ws.susVel) : 0;
            // a progressive spring: beyond the rest height the spring gets stiffer with the travel that is used (the extra stiffness is zero at rest, so the ride height stays)
            var used = Math.max(0, ws.restLengthWheel - ws.susLength);
            var progressive = self.springProgression > 0 ? self.springProgression * rateS * used * used / self.bumpTravel : 0;
            if(bumpS > 0 && xdotS > 2.5) self.soundImpact = Math.max(self.soundImpact || 0, Math.min(1, (xdotS - 2) / 6));       // (the bump stop hit hard)
            var fs, accel;
            if(self.soloWheels) {
                // A motorcycle: the damper (and the damping of the stops) is solved implicitly: it is stable at any strength. The one wheel of an end has twice the spring of a wheel
                // of a pair, and the explicit damper rang at 240 Hz and blew up on a hard landing or on the brakes (c dt / m was past 2 in the stops).
                var cTot = cUse + (ws.susLength < ws.minLength || ws.susLength > ws.freeLength ? stopDamping : 0);
                var bumpSpring = ws.susLength < ws.minLength ? stopRate * (ws.minLength - ws.susLength) : 0, droopSpring = ws.susLength > ws.freeLength ? -stopRate * (ws.susLength - ws.freeLength) : 0;
                var fs0 = rateS * comp[si] + progressive + bumpSpring + droopSpring + arbForce[si];
                // the part of the road force along the wheel that goes along the travel (the force of the last step, a little smoothed: the brake and the ABS make it jump)
                var slopeS = ws.front ? self.forkSlope : self.swingSlope, staticS = ws.staticLoad || 1500;
                ws.feLoad = (ws.feLoad || 0) + (Math.max(-1.5 * staticS, Math.min(1.5 * staticS, self.forkDive * slopeS * (ws.fxLast || 0))) - (ws.feLoad || 0)) * Math.min(1, dt / (self.feTau || 0.03));
                var accel0 = (fs0 - tyreLoad[si] - ws.feLoad) / self.unsprungMass + gDown - lastBodyAccDown;
                ws.susVel = (ws.susVel + accel0 * dt) / (1 + cTot * dt / self.unsprungMass);
                fs = fs0 - cTot * ws.susVel;
                springForce[si] = self.wheelLost[si] ? 0 : fs - ws.feLoad;       // (the body gets the vertical force that the tyre gave: the rest goes through the rigid part of the fork)
                ws.susLength += ws.susVel * dt;
            } else if(self.unsprung) {
                // no suspension: the wheel does not move along the axis, the body gets what the tyre gives (the tyre is the spring; a kart frame flexes a little, which is left out)
                ws.susLength = ws.restLengthWheel !== undefined ? ws.restLengthWheel : self.restLength; ws.susVel = 0;
                fs = tyreLoad[si];
                springForce[si] = self.wheelLost[si] ? 0 : fs;
            } else {
            // The damper, and the damping of the stops, solved implicitly (as for a motorcycle above): stable at any strength. The explicit damper took c dt / m past 2 in the
            // bump stop of a light wheel on a stiff spring (a kart: 8 kg on 50 kN/m, the stop at twelve times that) and the car was thrown hundreds of metres into the air.
            // The digressive damper is kept as the secant of its curve at the speed of this step (its force over the speed), so its knee and its blow-off stay
            var cEff = Math.abs(xdotS) > 1e-4 ? Math.abs(damperS / xdotS) : cUse;
            var cTotC = cEff + (ws.susLength < ws.minLength || ws.susLength > ws.freeLength ? stopDamping : 0);
            var bumpSpringC = ws.susLength < ws.minLength ? stopRate * (ws.minLength - ws.susLength) : 0, droopSpringC = ws.susLength > ws.freeLength ? -stopRate * (ws.susLength - ws.freeLength) : 0;
            var fs0C = rateS * comp[si] + progressive + bumpSpringC + droopSpringC + arbForce[si];
            // the wheel: the spring pushes it out, the tyre pushes it in, gravity pulls it along the axis, and it rides with the mount
            var accel0C = (fs0C - tyreLoad[si]) / self.unsprungMass + gDown - lastBodyAccDown;
            ws.susVel = (ws.susVel + accel0C * dt) / (1 + cTotC * dt / self.unsprungMass);
            fs = fs0C - cTotC * ws.susVel;
            springForce[si] = self.wheelLost[si] ? 0 : fs;
            ws.susLength += ws.susVel * dt;
            }
            if(ws.susLength < 0.02) { ws.susLength = 0.02; if(ws.susVel < 0) ws.susVel = 0; }
            if(ws.susLength > ws.freeLength + 0.06) { ws.susLength = ws.freeLength + 0.06; if(ws.susVel > 0) ws.susVel = 0; }
        }
        // a motorcycle: the lost wheel of a pair goes with the live one, for what is drawn on it (the fork legs, the caliper and the mudguard hang on the model's wheel_FL, which is slot 1)
        if(self.soloWheels) for(var sm = 0; sm < 2; sm++) {
            var live = wheels[sm * 2], ghost = wheels[sm * 2 + 1];
            ghost.susLength = live.susLength; ghost.susVel = live.susVel; ghost.omega = live.omega; ghost.spin = live.spin;
        }

        // two sums of forces: what acts on the body alone (gravity on it, the springs: it moves the sprung mass) and what acts on
        // the whole car (the tyres along the road, the air, the walls: the wheels go with the body, so it moves everything)
        force.x = 0; force.y = 0; force.z = 0;
        forceBody.x = 0; forceBody.y = -mBody * G; forceBody.z = 0;
        torque.x = torque.y = torque.z = 0;
        var tyreTorque = [0, 0, 0, 0];
        var brakeTorque = [0, 0, 0, 0];
        if(self.controller) self.controller.brakeStep(self, dt);
        var maxDrivenSlip = 0;
        var brakePedal = inp.brakePedal;
        var handbrake = inp.handbrake ? 1 : 0;
        var sumFx = 0, sumFy = 0;
        // the roll of the body (positive: leaning to the right), for the camber of the wheels
        rotateInverse(self.qx, self.qy, self.qz, self.qw, 0, 1, 0, tmpA);
        var rollRight = Math.asin(Math.max(-1, Math.min(1, tmpA.x)));
        var speedNow = Math.sqrt(self.vx * self.vx + self.vy * self.vy + self.vz * self.vz);
        var restHold = 1 - smoothstep(0.5, 2, speedNow);   // 1 at a standstill

        // ---- launch: the transbrake, the launch control and the two-step
        var launchGear = self.getGearRatio();
        var wasHeld = self.lcArmed || self.transbrakeHeld;
        var wasLC = self.lcArmed;
        self.transbrakeHeld = !!inp.transbrake && launchGear !== 0 && !self.airborne;
        if(self.launchControlEnabled && self.launchControlFitted && launchGear > 0 && Math.abs(self.u) < 2) {
            // armed with the brake and full throttle; it stays armed while the brake and most of the throttle stay (so the pedals can move a little)
            self.lcArmed = self.lcArmed ? (inp.brakePedal > 0.15 && inp.throttle > 0.5) : (inp.brakePedal > 0.5 && inp.throttle > 0.7);
        } else {
            self.lcArmed = false;
        }
        if(wasHeld && !(self.lcArmed || self.transbrakeHeld) && inp.throttle > 0.3) {
            self.launchRelease = 0.15;                       // the clutch takes up in this time: a launch
            if(wasLC && !self.transbrakeHeld && launchGear > 0) self.launching = 6;
        }
        if(self.launching > 0) {
            self.launching -= dt;
            if(self.u > 25 || inp.throttle < 0.3 || self.u < -0.5) self.launching = 0;
        }
        // The two-step (an option, on a key): with the clutch pedal in (or the two-step key, for a keyboard) at a standstill the engine is held at its own
        // lower limit, to launch from. Without a clutch pedal in use the clutch is opened too, and the launch is a ramp of the clutch when it is let go.
        var wasTwoStep = self.twoStepActive;
        self.twoStepActive = self.twoStepFitted && Math.abs(self.u) < 3 && ((self.twoStepEnabled && inp.clutchAvailable && inp.clutch > 0.7) || !!inp.twoStep);        // the key always works, the clutch pedal only when the option is on
        if(wasTwoStep && !self.twoStepActive && inp.throttle > 0.3 && !inp.clutchPedalPresent) self.launchRelease = 0.15;
        engine.holdRPM = self.twoStepActive ? engine.twoStepRPM : (self.lcArmed ? engine.launchRPM : 0);
        engine.holding = self.lcArmed || self.transbrakeHeld || self.twoStepActive;
        var newAxleFy = [0, 0];

        for(var iw = 0; iw < 4; iw++) {
            var wheel = wheels[iw];
            var fz = 0, fxW = 0, fyW = 0;
            var vl = 0;
            // the spring pushes on the body at the mount, whether the tyre touches the road or not (a wheel in the air hangs on its droop stop)
            rotate(self.qx, self.qy, self.qz, self.qw, wheel.mount.x + (wheel.shiftX || 0), wheel.mount.y, wheel.mount.z + (wheel.shiftZ || 0), Rv);
            var fsBody = -springForce[iw];                 // the reaction on the body, along the suspension axis (up when the spring is pushed in)
            var fsx = axisY.x * -fsBody, fsy = axisY.y * -fsBody, fsz = axisY.z * -fsBody;
            // At a standstill the suspension arms hold the wheel lengthways and sideways, so the spring only pushes the body along the normal of the
            // road: the push along the tilted axis of a pitched body (a raised front: ride height) had a part along the road, and the car rolled
            // back on flat ground with nothing in the model to hold it. Driving, the push is left as it was (the tuning of the cars is made with it):
            // the projection fades out between 0.5 and 2 m/s.
            if(restHold > 0 && wheel.hasContact && wheel.normal) {
                var pn = wheel.normal, along = (axisY.x * pn.nx + axisY.y * pn.ny + axisY.z * pn.nz) * -fsBody;
                fsx += (pn.nx * along - fsx) * restHold; fsy += (pn.ny * along - fsy) * restHold; fsz += (pn.nz * along - fsz) * restHold;
            }
            forceBody.x += fsx; forceBody.y += fsy; forceBody.z += fsz;
            torque.x += Rv.y * fsz - Rv.z * fsy;
            torque.y += Rv.z * fsx - Rv.x * fsz;
            torque.z += Rv.x * fsy - Rv.y * fsx;
            if(wheel.hasContact) {
                var road2 = wheel.normal;
                fz = tyreLoad[iw];                         // the load on the tyre, which is what it grips with
                wheel.weight = fz;
                if(self.tyreDamage && OpenRacer.damageEnabled !== false) {
                    // a hard hit (a kerb, a landing: a load of more than 5 times the static one) can puncture the tyre; a leaking tyre loses its pressure
                    if(!wheel.leak && fz > 5 * self.mass * gravity / 4 && Math.random() < 0.3) self.puncture(iw);
                    if(wheel.leak) {
                        var nominal = wheel.front ? self.pressureFront : self.pressureRear;
                        wheel.pressureLoss = Math.min(nominal - 0.15, (wheel.pressureLoss || 0) + wheel.leak * dt);
                        if(++wheel.leakTick % 15 === 0) self.applyPressure();
                    }
                }

                var nx = road2.nx, ny = road2.ny, nz = road2.nz;
                // the point of contact and its velocity
                Cv.x = wheel.contact.x - self.px; Cv.y = wheel.contact.y - self.py; Cv.z = wheel.contact.z - self.pz;
                var cvx = self.vx + (self.wy * Cv.z - self.wz * Cv.y);
                var cvy = self.vy + (self.wz * Cv.x - self.wx * Cv.z);
                var cvz = self.vz + (self.wx * Cv.y - self.wy * Cv.x);
                // the direction of the wheel on the road: forward along the wheel (turned by the steering), and to the left of it
                var fbx, fby, fbz;
                if(wheelAngle[iw] !== 0) {
                    var cosD = Math.cos(wheelAngle[iw]), sinD = Math.sin(wheelAngle[iw]);
                    fbx = axisZ.x * cosD - axisX.x * sinD; fby = axisZ.y * cosD - axisX.y * sinD; fbz = axisZ.z * cosD - axisX.z * sinD;
                } else {
                    fbx = axisZ.x; fby = axisZ.y; fbz = axisZ.z;
                }
                var dotN = fbx * nx + fby * ny + fbz * nz;
                var fpx = fbx - nx * dotN, fpy = fby - ny * dotN, fpz = fbz - nz * dotN;
                var fl = Math.sqrt(fpx * fpx + fpy * fpy + fpz * fpz) || 1;
                fpx /= fl; fpy /= fl; fpz /= fl;
                wheel.heading = wheel.heading || { x: 0, y: 0, z: 0 }; wheel.heading.x = fpx; wheel.heading.y = fpy; wheel.heading.z = fpz;       // (for the debug view)
                var lx = ny * fpz - nz * fpy, ly = nz * fpx - nx * fpz, lz = nx * fpy - ny * fpx;   // n x f: to the left

                vl = cvx * fpx + cvy * fpy + cvz * fpz;
                var vt = cvx * lx + cvy * ly + cvz * lz;
                wheel.forwardSpeed = vl;
                wheel.spinSlide = wheel.omega * wheel.radius - vl;                         // (Wheel.frictionFor: a tyre that spins fast melts and gives less)

                // slip, with a relaxation length: the tyre needs to roll a bit before the slip builds up
                var vref = Math.max(Math.abs(vl), 1.5);
                // the slips are not cut off at the slip angle of a drift: a wheel that spins and slides sideways at the same time has to keep
                // the direction of its slip (a cut at 1.5 made the rear of a car in a donut lose its sideways hold past 56 degrees, so
                // the yaw ran away, the car spun round and started again: a stutter instead of a donut)
                var kappa = Math.max(-12, Math.min(12, (wheel.omega * wheel.radius - vl) / vref));
                var tanA = Math.max(-12, Math.min(12, vt / vref));
                var a = 1 - Math.exp(-dt * vref / wheel.relaxation);
                wheel.slipRatio += (kappa - wheel.slipRatio) * a;
                wheel.slipTan += (tanA - wheel.slipTan) * a;

                // the geometric load transfer: the lateral force of the axle, passed to the body at the roll centre, presses the outer
                // wheel down and lifts the inner one at once (it does not wait for the springs)
                var axle = wheel.front ? 0 : 1;
                var rollCentre = wheel.front ? self.rollCentreFront : self.rollCentreRear;
                var trackWidth = wheel.front ? self.front_track : self.rear_track;
                var geometric = self.soloWheels ? 0 : (wheel.right ? 1 : -1) * axleFy[axle] * rollCentre / trackWidth;        // (one wheel on an axle: nothing to move the load to)
                var fzGrip = Math.max(0, fz + geometric);
                // camber: the lean of the wheel to the left (its static camber, and the lean of the body in roll); a wheel that
                // leans pushes towards the side it leans to, as if it had a slip angle
                var camber = (wheel.front ? self.camberFront : self.camberRear) * Math.PI / 180;
                var leanLeft = (wheel.right ? -camber : camber) - rollRight * self.rollCamber - (wheel.camberBend || 0);
                if(self.liveAxle[wheel.front ? "front" : "rear"]) leanLeft = self.axleLean(wheel.front) - (wheel.camberBend || 0);
                wheel.lean = self.soloWheels ? 0 : leanLeft;            // (for the wheel of the model: it leans with the camber, Wheel.turn)
                var surface = self.getSurface(wheel.surface, wheel.localSnow, wheel.localWater);
                if(wheel.cylActive) {
                    // the tyre as a body of nodes and beams (TyreShell.js): the friction that its nodes carry, along the wheel and across it
                    var tb = wheel.tyreBody;
                    wheel.tyreSlope = tb.dampSlope * wheel.radius * wheel.radius;       // (Nm per rad/s: the damping of the grip, which the wheel takes implicitly below)
                    wheel.fx = tb.friction.x * fpx + tb.friction.y * fpy + tb.friction.z * fpz;
                    wheel.fy = tb.friction.x * lx + tb.friction.y * ly + tb.friction.z * lz;
                    wheel.s = tb.slidingShare < 0.05 ? tb.used / 0.92 : Math.max(tb.used / 0.92, 1 + 0.9 * tb.slidingShare);
                    wheel.slip = wheel.s > 1.15;
                } else if(self.simpleTyres) {
                    // the simple tyre: the slip curve, with the camber as a little slip angle (Wheel.tyreForce)
                    wheel.tyreForce(wheel.slipRatio, wheel.slipTan - self.camberGain * leanLeft * wheel.anglePeak / 0.15, fzGrip, surface);
                    wheel.tyreSlope = 0;
                } else { wheel.tyreSlope = 0; wheel.fx = 0; wheel.fy = 0; wheel.s = 0; wheel.slip = false; }      // (no tyre body on the road: a wheel that is lost)
                // Smoke and squeal: the tyre slides (s is above 1 past the peak of the grip) at some speed over the road. The heat builds
                // up the longer it slides, so the smoke gets thicker, and goes away slowly when it grips again.
                var slideSpeed = Math.sqrt((wheel.omega * wheel.radius - vl) * (wheel.omega * wheel.radius - vl) + vt * vt);
                var sliding = smoothstep(1.2, 2.2, wheel.s) * smoothstep(1.5, 6, slideSpeed);
                wheel.heat = Math.max(0, Math.min(1, wheel.heat + (sliding > 0 ? sliding * dt / 1.8 : -dt / 2.5)));
                // The smoke of the rubber on the road comes from the temperature of the surface of the tread (it gives off its oils and burns at
                // about 200 to 260 °C; a little earlier here, so that a hard launch gives a wisp), not from the slip itself: the power that the slip burns (the force of the tyre times how fast it slides) heats a thin
                // layer, of which a share goes into the rubber (the rest into the road); the layer gives its heat to the tyre and the air. A tyre that
                // spins at a standstill, or one that spins a lot faster than the car goes, burns a lot of power and gets there in a few seconds; one that
                // only slides a little, or only for a moment, does not. On dirt and grass there is dust, from the slide as before.
                var burnt = Math.abs(wheel.fx * (wheel.omega * wheel.radius - vl)) + Math.abs(wheel.fy * vt);              // W
                // The road under the tyre: what the rubber does not take goes into it. A tyre that stays on the same strip (a burnout, the car at a
                // standstill) heats it, and a hot road takes less: more of the heat stays in the rubber. A tyre that moves over the road meets new,
                // cold road all the time (a lock-up: the heat is spread over the braking distance), so the share stays at what a cold road gives.
                var strip = Math.abs(vl) / 0.15 + 0.15;                                  // 1/s: how fast the strip is replaced (the patch is about 15 cm long) or cools
                wheel.roadT += (((1 - SURFACE_SHARE) * burnt / ROAD_CAPACITY) - (wheel.roadT - self.ambient) * strip) * dt;
                wheel.roadT = Math.max(self.ambient, Math.min(300, wheel.roadT));
                // a tyre that spins on a car that stands (a burnout) keeps its heat: the strip of road under it is not replaced and the rubber that melts stays on the tread
                var spinHot = smoothstep(4, 14, wheel.omega * wheel.radius - vl) * (1 - smoothstep(1, 3, Math.abs(vl)));
                var share = SURFACE_SHARE + 0.3 * Math.min(1, (wheel.roadT - self.ambient) / 150) + 0.3 * spinHot;
                wheel.surfT += (share * burnt / SURFACE_CAPACITY - (wheel.surfT - wheel.temp) / SURFACE_TAU) * dt;
                wheel.surfT = Math.max(wheel.temp, Math.min(330, wheel.surfT));
                if(wheel.surface === "road" || wheel.surface === "track01") {
                    // A spinning tyre throws a thick cloud (a burnout); one that is locked, or only slides sideways (a handbrake turn, a drift without
                    // power), is scrubbed along the road: it smokes, but thinner, and most of what it makes is the mark on the road.
                    var spinShare = Math.max(0, Math.min(1, Math.max(0, wheel.omega * wheel.radius - vl) / Math.max(2, slideSpeed)));
                    var density = 0.3 + 0.7 * spinShare;
                    // from about 180 degrees the rubber turns to gum (a light haze, and the marbles of Marbles.js); from about 220 the smoke is a plume
                    // (the particles of Smoke.js), full at 260 and more
                    var smoking = 0.12 * smoothstep(180 + tc.smoke, 220 + tc.smoke, wheel.surfT) + 0.88 * smoothstep(220 + tc.smoke, 260 + tc.smoke, wheel.surfT);
                    wheel.heat = smoothstep(200 + tc.smoke, 330 + tc.smoke, wheel.surfT) * (0.4 + 0.6 * spinShare);
                    wheel.smoke = fz > 200 ? smoking * (0.4 + 0.6 * Math.min(1, burnt / 40000)) * density : 0;
                } else {
                    wheel.smoke = fz > 200 ? Math.min(1, 0.15 * sliding + wheel.heat * Math.min(1, sliding * 2 + 0.2)) : 0;
                    // loose ground is thrown up by a tyre that only rolls (a thin plume that follows the car), and by a tyre that lands (a puff that dies away in a tenth of a second)
                    if(surface.loose && fz > 200) {
                        var rollingDust = Math.min(0.28, Math.max(0, (Math.abs(vl) - 5) / 40));
                        if(!wheel.hadContact) wheel.puff = Math.min(1, Math.abs(self.vy) / 9);
                        wheel.puff = (wheel.puff || 0) * Math.exp(-dt / 0.12);
                        wheel.smoke = Math.max(wheel.smoke, rollingDust, wheel.puff > 0.08 ? wheel.puff : 0);
                    }
                }
                wheel.hadContact = true;
                // (a motorcycle squeals later: the camber of its tyres carries a bend, and its tyres read as used before they slide)
                // (it starts at the peak of the grip, s = 1, where the tread begins to slide, and from a slide of under a metre a second: a tyre at the limit is heard before it lets go)
                var sqLo = self.controller ? 1.5 : 1.0;
                wheel.squeal = (wheel.surface === "road" || wheel.surface === "track01") && fz > 200
                    ? smoothstep(sqLo, sqLo + 1, wheel.s) * (1 - 0.4 * smoothstep(2.5, 4, wheel.s)) * smoothstep(self.controller ? 1.6 : 0.8, 5, slideSpeed) : 0;
                fxW = wheel.fx;
                fyW = wheel.fy;
                // the temperature and the wear: the power that the slip burns
                self.wearStep(wheel, dt, Math.abs(fxW * (wheel.omega * wheel.radius - vl)) + Math.abs(fyW * vt), fz, vl, true);
                // the shell tyre turns the wheel itself in its substeps (the grip of the tread saturates within a step of the car): the torque that gives the turn it found
                var tbS = wheel.cylActive && wheel.tyreBody && wheel.tyreBody.isShell && wheel.tyreBody.omegaOut !== undefined ? wheel.tyreBody : null;
                if(tbS) { tyreTorque[iw] = (tbS.omegaOut - wheel.omega) * wheel.inertia / dt; wheel.tyreSlope = 0; wheel.omegaFromTyre = true; }
                else {
                    // a little damping on the slip speed keeps a nearly stationary wheel from ringing
                    fxW += 400 * Math.max(-0.3, Math.min(0.3, wheel.omega * wheel.radius - vl));
                    tyreTorque[iw] = -fxW * wheel.radius;
                    wheel.omegaFromTyre = false;
                }
                wheel.fxLast = fxW;                                       // (the forward force of the road on the wheel, for the geometry of the fork and the swingarm)

                // rolling resistance (more on soft ground), not a torque on the wheel
                var rr = wheel.rollingResistance * tc.rolling * (wheel.pressureRoll || 1) * (surface.drag ? surface.drag * (surface.loose && tc.looseRolling ? tc.looseRolling : 1) : (surface.static < 0.8 ? 4 * (surface.loose && tc.looseRolling ? tc.looseRolling : 1) : 1)) * fz * Math.tanh(vl / 0.3);
                fxW -= rr;

                // the forces on the car: the force along the wheel at the point of contact, the force across the wheel at the roll
                // centre above it (the linkage passes it to the body there, so the body rolls less). The load along the normal went
                // to the wheel, which passes it to the body through the spring (above).
                var fxx = fxW * fpx;
                var fyy = fxW * fpy;
                var fzz = fxW * fpz;
                force.x += fxx + fyW * lx; force.y += fyy + fyW * ly; force.z += fzz + fyW * lz;
                torque.x += Cv.y * fzz - Cv.z * fyy;
                torque.y += Cv.z * fxx - Cv.x * fzz;
                torque.z += Cv.x * fyy - Cv.y * fxx;
                var rcx = Cv.x + axisY.x * rollCentre, rcy = Cv.y + axisY.y * rollCentre, rcz = Cv.z + axisY.z * rollCentre;
                torque.x += rcy * fyW * lz - rcz * fyW * ly;
                torque.y += rcz * fyW * lx - rcx * fyW * lz;
                torque.z += rcx * fyW * ly - rcy * fyW * lx;
                sumFx += fxW; sumFy += fyW;
                if(wheel.cylActive) {
                    // the pressing force of the nodes across the suspension (a ramp side, a wall, a slope), on the car at the hub
                    // (a motorcycle: no more than the static load of the wheel; a tyre that lands leaned on a slope at 170 km/h pressed with 4 000 N and threw the bike backwards at 100 km/h)
                    if(self.soloWheels) {
                        var perpMag = Math.sqrt(wheel.perpX * wheel.perpX + wheel.perpY * wheel.perpY + wheel.perpZ * wheel.perpZ), perpCap = wheel.staticLoad || 1500;
                        if(perpMag > perpCap) { var ps = perpCap / perpMag; wheel.perpX *= ps; wheel.perpY *= ps; wheel.perpZ *= ps; }
                    }
                    var hx = Rv.x - axisY.x * wheel.susLength, hy = Rv.y - axisY.y * wheel.susLength, hz = Rv.z - axisY.z * wheel.susLength;
                    force.x += wheel.perpX; force.y += wheel.perpY; force.z += wheel.perpZ;
                    torque.x += hy * wheel.perpZ - hz * wheel.perpY; torque.y += hz * wheel.perpX - hx * wheel.perpZ; torque.z += hx * wheel.perpY - hy * wheel.perpX;
                }
                newAxleFy[axle] += fyW;
            } else {
                wheel.weight = 0;
                wheel.tyreSlope = 0;
                wheel.forwardSpeed = 0;
                wheel.slipRatio *= 0.98;
                wheel.slipTan *= 0.98;
                wheel.heat = Math.max(0, wheel.heat - dt / 2.5);
                wheel.smoke = 0;
                wheel.squeal = 0;
                self.wearStep(wheel, dt, 0, 0, self.u, false);
            }

            // brakes, with ABS
            if(self.absEnabled && self.absFitted && brakePedal > 0.05 && wheel.hasContact && wheel.slipRatio < -0.08 && wheel.s > 1.1 && Math.abs(vl) > 2) {
                wheel.absFactor = Math.max(0.05, wheel.absFactor - 15 * dt);
                wheel.abs = true;
            } else {
                wheel.absFactor = Math.min(1, wheel.absFactor + 8 * dt);
                if(wheel.absFactor > 0.98) wheel.abs = false;
            }
            var bt = brakePedal * wheel.maxBrakeTorque * wheel.absFactor * (self.controller ? self.controller.brakeScale(self, wheel) : 1);
            // the handbrake: the rear wheels; a motorcycle has none, its handbrake key is the rear brake alone (the pedal works both brakes)
            if(!wheel.front) bt = self.controller ? Math.max(bt, handbrake * wheel.maxBrakeTorque * wheel.absFactor) : bt + handbrake * 1800;
            if(inp.parkingLock) bt = Math.max(bt, 4000); // P: the parking lock holds all wheels
            if(self.transbrakeHeld && wheel.driven) bt = Math.max(bt, 4000); // the transbrake holds the driven wheels
            bt += escBrake[iw];
            wheel.esc = escBrake[iw] > 30;
            brakeTorque[iw] = bt;
            wheel.brakeTorque = bt;
            if(wheel.driven && wheel.hasContact) maxDrivenSlip = Math.max(maxDrivenSlip, (wheel.omega * wheel.radius - vl) / (self.tcAllowance * (1.2 + 0.12 * Math.abs(vl))));
        }

        axleFy[0] = newAxleFy[0]; axleFy[1] = newAxleFy[1];

        // ---- traction control
        // Traction control only looks at the wheels: when a driven wheel turns faster than the road under it (it spins),
        // power is taken off the engine until it grips again, and given back slowly. A little wheel speed is allowed: one
        // metre per second and 12% of the speed, which is about where a tyre has the most grip.
        // The power follows the slip like a controller, not like a switch: the factor changes at a rate that grows with how far the slip is past
        // the allowance (down) or below it (up), and is still at the allowance. A switch (fast down above it, slow up below it) made the power
        // saw-tooth at the edge, and the engine speed with it: the car stuttered under traction control instead of pulling in one stroke.
        var slipError = maxDrivenSlip - 1;
        // (not in a burnout of a motorcycle: the rear wheel is meant to spin there, and the throttle it cut let the clutch slip and the wheel stop after a moment)
        if((self.tcEnabled && self.tcFitted && !(self.controller && self.controller.burnout > 0.5)) || self.launching > 0) {
            var rate = slipError > 0 ? -(4 + 8 * slipError) * Math.min(1, slipError * 4) : Math.min(1, -slipError * 6) + 1.5 * Math.max(0, Math.min(1, (-slipError - 0.5) / 0.4));
            self.tcFactor = Math.max(0.2, Math.min(1, self.tcFactor + dt * rate));
            if(slipError > 0.05) for(var ti = 0; ti < 4; ti++) if(wheels[ti].driven) wheels[ti].tc = true;
            if(self.tcFactor > 0.98) for(var tk = 0; tk < 4; tk++) wheels[tk].tc = false;
        } else {
            self.tcFactor = Math.min(1, self.tcFactor + dt * 2);
            for(var tj = 0; tj < 4; tj++) wheels[tj].tc = false;
        }

        // ---- engine and clutch
        var gs = self.getGearRatio();
        var shares = self.torqueShares(); // the share of the torque of every wheel with open differentials
        var throttle = inp.throttle * self.tcFactor * (1 - 0.85 * escCut) * (self.controller && self.controller.throttleScale ? self.controller.throttleScale(self, dt) : 1);
        // the gearbox takes the power off while it shifts
        if(self.shiftTimer > 0) {
            if(self.gearbox === "dct") throttle = self.shiftUp ? throttle * 0.35 : Math.max(throttle, 0.45);     // (a dual clutch: a short cut on the way up, a blip on the way down)
            else throttle *= self.gearbox === "torque-converter" ? 0.6 : 0.15;                                   // (a converter keeps the drive through a shift: less is taken off)
        }
        self.throttleUsed = throttle;                      // (for the debugging)
        engine.updateBoost(throttle, dt);
        var Te = engine.getNetTorque(throttle);
        var rpm = engine.getRPM();
        self.fuelStep(dt, Te, engine.omega);

        // How hard the clutch is clamped: from the clutch pedal, or by an automatic clutch that
        // engages with the engine speed (so the engine does not stall) and opens while shifting.
        var engagement;
        if(inp.clutchPedalPresent) {
            engagement = pedalBite(inp.clutch);
        } else {
            engagement = smoothstep(self.clutchStartRPM, self.clutchFullRPM, rpm);
            if(self.shiftTimer > 0) {
                var ts = self.shiftTimer;
                if(self.gearbox === "dct") engagement = Math.min(engagement, 0.4 + 0.6 * (1 - ts / Math.max(0.01, self.shiftDuration)));      // (the hand-over: never open)
                else engagement = Math.min(engagement, ts > 0.14 ? 0 : 1 - smoothstep(0, 0.14, ts));
            }
        }
        if(self.lcArmed || self.transbrakeHeld || (self.twoStepActive && !inp.clutchPedalPresent)) engagement = 0;     // held for a launch: the engine turns free
        else if(self.launchRelease > 0) {
            engagement = Math.min(engagement, 1 - self.launchRelease / 0.15);
            self.launchRelease = Math.max(0, self.launchRelease - dt);
        }
        self.clutchEngagement = engagement;

        // brake torque as it is felt by the wheel at its current speed, for the clutch solution below
        var Je = engine.inertia;
        var Tc = 0, Td = 0;                                // the torque on the engine, and the torque into the gearbox (the same through a clutch; a converter multiplies)
        var converter = self.gearbox === "torque-converter";
        if(gs !== 0) {
            var cap = self.clutchCapacity * engagement;
            var omegaS = 0, invJd = 0, aExt = 0;
            for(var k2 = 0; k2 < 4; k2++) {
                var sh = shares[k2];
                if(sh === 0) continue;
                var wk = wheels[k2];
                var ext = tyreTorque[k2] - brakeTorque[k2] * Math.tanh(wk.omega / 0.5);
                omegaS += gs * sh * wk.omega;
                invJd += gs * gs * sh * sh / wk.inertia;
                aExt += gs * sh * ext / wk.inertia;
            }
            var dOmega = engine.omega - omegaS;
            var kClutch = cap / self.clutchSlipSpeed;
            // Implicit solution of the slip between engine and driveline: it can be stiff (a locked
            // clutch), and this stays stable. Beyond the capacity the clutch slips with a fixed torque.
            var base = dOmega + dt * (Te / Je - aExt);
            var den = 1 + dt * kClutch * (1 / Je + invJd);
            Tc = kClutch * base / den;
            if(Math.abs(Tc) > cap) Tc = cap * (base > 0 ? 1 : -1);
            Td = Tc;
            if(converter) {
                // the fluid coupling: the pump on the engine, the turbine on the gearbox
                var we = Math.max(1, engine.omega), sr = Math.max(-1, Math.min(2, omegaS / we));
                var stall = (self.tcStallRPM > 0 ? self.tcStallRPM : engine.limiterRPM * 0.35) * Math.PI / 30;
                var C = engine.getPeakTorque() * engine.torqueScale / (stall * stall);
                var idleW = (engine.idleRPM || 900) * Math.PI / 30;
                var soft = 0.16 + 0.84 * smoothstep(idleW * 1.05, idleW * 1.9, we);              // (at idle a sixth: a gentle creep)
                var Tp = C * we * we * (1 - sr) * soft * (sr > 1 ? 0.5 : 1);
                var tr = 1 + (self.tcRatio - 1) * Math.max(0, 1 - Math.max(0, sr) / 0.85);
                var Tt = Tp * (sr < 1 ? tr : 1);
                // (held for a launch, or the clutch pedal pressed: the engine turns free; not the automatic clutch's engagement, which is 0 at idle: the converter creeps there)
                var freed = self.lcArmed || self.transbrakeHeld || (self.twoStepActive && !inp.clutchPedalPresent) || self.launchRelease > 0 || (inp.clutchPedalPresent && inp.clutch > 0.5);
                if(freed) { Tp = 0; Tt = 0; }
                // the lock-up clutch: closed above 25 km/h once the slip is small and the gearbox is not shifting, open again under a wide throttle at a low speed
                var wantLock = self.tcLockup && Math.abs(u) > 7 && sr > 0.93 && sr < 1.07 && self.shiftTimer <= 0 && !(inp.throttle > 0.9 && Math.abs(u) < 15) ? 1 : 0;
                if(self.shiftTimer > 0 || Math.abs(u) < 5) wantLock = 0;
                self.tcLock += (wantLock - self.tcLock) * Math.min(1, dt / (wantLock ? 0.3 : 0.1));
                var lk = self.tcLock;
                Tc = lk * Tc + (1 - lk) * Tp;
                Td = lk * Td + (1 - lk) * Tt;
                self.tcSlip = sr;
            }
        } else if(converter) { self.tcLock = 0; self.tcSlip = 0; }
        engine.omega += dt * (Te - Tc) / Je;
        if(engine.omega < 0) engine.omega = 0;
        if(engine.omega > engine.maxRPM * Math.PI / 30) engine.omega = engine.maxRPM * Math.PI / 30;
        var driveTotal = Td * gs * self.driveEfficiency; // the torque to all driven wheels together
        var wheelDrive = [driveTotal * shares[0], driveTotal * shares[1], driveTotal * shares[2], driveTotal * shares[3]];

        // ---- differentials
        // Between the axles (all wheel drive, "lsd"): the axle that turns faster than the other gets torque taken off and the slower one gets it. "open" gives
        // every axle the same share all the time; "locked" makes both axles turn at the same speed (see below).
        if(self.driveType === "awd" && self.centerType === "lsd") {
            var axleF = (wheels[0].omega + wheels[1].omega) / 2, axleR = (wheels[2].omega + wheels[3].omega) / 2;
            var cMax = self.centerPreload + self.centerPower * Math.abs(driveTotal);
            var cLock = Math.max(-cMax, Math.min(cMax, self.centerStiffness * (axleF - axleR)));
            wheelDrive[0] -= cLock / 2; wheelDrive[1] -= cLock / 2; wheelDrive[2] += cLock / 2; wheelDrive[3] += cLock / 2;
        }
        // Between the wheels of an axle. Left and right are given by the order of the wheels: 1 and 0 (front), 2 and 3 (rear).
        if(self.diffType === "lsd" && !self.soloWheels) {
            // the extra locking under power is for getting going and for tight turns: at speed the car stays calm (see the stability at 150 km/h)
            var calm = 1 - smoothstep(8, 25, Math.abs(u));
            for(var ax = 0; ax < 2; ax++) {
                var iL = ax === 0 ? 1 : 2, iR = ax === 0 ? 0 : 3;
                if(shares[iL] === 0) continue;
                var axleTorque = wheelDrive[iL] + wheelDrive[iR];
                var factor = axleTorque >= 0 ? self.lockPower * calm : self.lockCoast * calm;
                var lockMax = self.lockTorque + factor * Math.abs(axleTorque) / 2;
                var lock = Math.max(-lockMax, Math.min(lockMax, self.lockStiffness * (wheels[iL].omega - wheels[iR].omega)));
                wheelDrive[iL] -= lock; wheelDrive[iR] += lock;
            }
        }

        // ---- wheel speeds
        var omegaWas = [wheels[0].omega, wheels[1].omega, wheels[2].omega, wheels[3].omega];
        for(var j = 0; j < 4; j++) {
            var wj = wheels[j];
            // The tyre can only bring the wheel to the speed of the road, not past it in one step: at a standstill the step of the tyre force is far more than the slip it answers
            // (a light wheel, a stiff tyre), and the wheel reversed every frame (the tyres of a bike jittered back and forth at a standstill)
            // (not while the engine drives the wheel: the tyre then holds the slip that balances the drive, and a wheel kept at the road speed has no slip and the drive goes through it: a
            // bike looped over backwards at the start)
            // The damping of the grip is taken implicitly: the torque of the tyre falls as the wheel speeds up by tyreSlope per rad/s, so the step is divided by the inertia plus dt times that.
            // The damping of a car at a standstill is that of its whole weight (the ring of nodes of before, restDamping): on a light wheel in one explicit step it turned the wheel past the road speed and
            // back, and the wheels of a stadium truck rocked forwards and backwards at a standstill, with the force of the tyre flipping between its two limits every frame.
            var iEff = wj.inertia + dt * (wj.tyreSlope || 0);
            var dOm = dt * tyreTorque[j] / iEff, over = wj.omega - (wj.forwardSpeed || 0) / wj.radius;
            if(Math.abs(wheelDrive[j]) < 5 && !wj.omegaFromTyre && over * dOm < 0 && Math.abs(dOm) > Math.abs(over)) dOm = -over;       // (not the shell tyre: it turns the wheel itself)
            var omegaFree = wj.omega + dOm + dt * wheelDrive[j] / iEff;
            var bt2 = brakeTorque[j];
            if(bt2 > 0) {
                var dw = dt * bt2 / wj.inertia;
                if(Math.abs(omegaFree) <= dw) omegaFree = 0;
                else omegaFree -= dw * (omegaFree > 0 ? 1 : -1);
            }
            wj.omega = omegaFree;
        }

        // ---- in the air the wheels turn the body: what spins a wheel up (the engine) or slows it (the brake) turns the body the other way, as the angular momentum is kept;
        // a rider lands a jump nose up by opening the gas and nose down by braking (a motorcycle; the rear wheel of a bike is a fair share of its inertia in pitch)
        if(self.airborne && self.controller && self.controller.airPitch > 0) {
            var react = 0;
            for(var ja = 0; ja < 4; ja++) if(!self.wheelLost[ja]) react -= wheels[ja].inertia * (wheels[ja].omega - omegaWas[ja]) / dt;
            react *= self.controller.airPitch;
            torque.x += react * axisX.x; torque.y += react * axisX.y; torque.z += react * axisX.z;
        }
        // ---- locked: the wheels of an axle (welded), or the axles (locked centre) turn at the same speed. The speed they get keeps the angular momentum.
        if(self.diffType === "welded" && !self.soloWheels) {
            for(var ax2 = 0; ax2 < 2; ax2++) {
                var wl = wheels[ax2 === 0 ? 1 : 2], wr = wheels[ax2 === 0 ? 0 : 3];
                if(!wl.driven) continue;
                var common = (wl.inertia * wl.omega + wr.inertia * wr.omega) / (wl.inertia + wr.inertia);
                wl.omega = wr.omega = common;
            }
        }
        if(self.driveType === "awd" && self.centerType === "locked") {
            var iF = wheels[0].inertia + wheels[1].inertia, iR2 = wheels[2].inertia + wheels[3].inertia;
            var oF = (wheels[0].inertia * wheels[0].omega + wheels[1].inertia * wheels[1].omega) / iF;
            var oR = (wheels[2].inertia * wheels[2].omega + wheels[3].inertia * wheels[3].omega) / iR2;
            var oC = (iF * oF + iR2 * oR) / (iF + iR2);
            wheels[0].omega += oC - oF; wheels[1].omega += oC - oF;
            wheels[2].omega += oC - oR; wheels[3].omega += oC - oR;
        }
        for(var js = 0; js < 4; js++) wheels[js].spin += wheels[js].omega * dt;

        // ---- the forces on the car that are not at the wheels: the air (drag, and downforce)
        var speed = Math.sqrt(self.vx * self.vx + self.vy * self.vy + self.vz * self.vz);
        var cDrag = self.controller ? self.Cdrag * self.controller.dragScale() : self.Cdrag;      // (a rider of a motorcycle sits up or lies flat)
        var dragX = -cDrag * speed * self.vx, dragY = -cDrag * speed * self.vy, dragZ = -cDrag * speed * self.vz;
        force.x += dragX; force.y += dragY; force.z += dragZ;
        // the downforce (or lift) of each axle presses along the up axis of the body, at the axle: it also pitches the car
        var u2 = u * u;
        if(u2 > 1 && (self.downforceFront || self.downforceRear)) {
            var dfF = -self.downforceFront * u2, dfR = -self.downforceRear * u2;
            force.x += axisY.x * (dfF + dfR); force.y += axisY.y * (dfF + dfR); force.z += axisY.z * (dfF + dfR);
            // r x F with r = a * axisZ (the axle ahead of or behind the centre of gravity) and F along axisY: a * F * (axisZ x axisY) = -a * F * axisX
            var pitch = -(self.af * dfF - self.ar * dfR);
            torque.x += pitch * axisX.x; torque.y += pitch * axisX.y; torque.z += pitch * axisX.z;
        }

        // ---- pushes from outside (the shake test), straight down at a point of the body
        for(var pi = 0; pi < self.pushes.length; pi++) {
            var push = self.pushes[pi];
            rotate(self.qx, self.qy, self.qz, self.qw, push.x, push.y, push.z, Rv);
            force.y -= push.n;
            torque.x += Rv.y * 0 - Rv.z * -push.n;   // r x F with F = (0, -n, 0)
            torque.z += Rv.x * -push.n - Rv.y * 0;
        }

        // ---- a controller (the rider and the tyres of a motorcycle)
        if(self.controller && !self.airborne) self.controller.apply(self, force, torque, dt, { u: u, r: r, delta: delta, inertiaZ: inertiaZ, inertiaY: inertiaY });

        // ---- the body on the road, for a landing or a car that has turned over
        // (a motorcycle that leans in a corner has its bodywork near the road: that is no crash until it is nearly on its side)
        if(ground3D) { if(!(self.controller && self.controller.keepBodyOff(self))) bodyContacts3D(force, torque); if(self.softBody) shellStep(dt, force, torque); } else if(!(self.controller && self.controller.keepBodyOff(self))) bodyCorners(force, torque);

        // ---- integrate: Newton for the movement, Euler for the rotation (with the gyroscopic term of a body that is not round)
        var accX = force.x / m + forceBody.x / mBody, accY = force.y / m + forceBody.y / mBody, accZ = force.z / m + forceBody.z / mBody;
        self.vx += accX * dt; self.vy += accY * dt; self.vz += accZ * dt;
        // the acceleration of the body along the suspension axis (outwards), for the wheels in the next step
        lastBodyAccDown = -(accX * axisY.x + accY * axisY.y + accZ * axisY.z);
        rotateInverse(self.qx, self.qy, self.qz, self.qw, self.wx, self.wy, self.wz, tmpB);       // angular velocity in the body
        var gx = (inertiaZ - inertiaY) * tmpB.y * tmpB.z, gy = (inertiaX - inertiaZ) * tmpB.z * tmpB.x, gz = (inertiaY - inertiaX) * tmpB.x * tmpB.y;
        rotate(self.qx, self.qy, self.qz, self.qw, gx, gy, gz, Mv);
        applyInverseInertia(torque.x + Mv.x, torque.y + Mv.y, torque.z + Mv.z, alpha);
        self.wx += alpha.x * dt; self.wy += alpha.y * dt; self.wz += alpha.z * dt;

        self.px += self.vx * dt; self.py += self.vy * dt; self.pz += self.vz * dt;
        var hx = self.wx * dt * 0.5, hy = self.wy * dt * 0.5, hz = self.wz * dt * 0.5;
        var nqx = self.qx + hx * self.qw + hy * self.qz - hz * self.qy;
        var nqy = self.qy + hy * self.qw + hz * self.qx - hx * self.qz;
        var nqz = self.qz + hz * self.qw + hx * self.qy - hy * self.qx;
        var nqw = self.qw - hx * self.qx - hy * self.qy - hz * self.qz;
        var norm = Math.sqrt(nqx * nqx + nqy * nqy + nqz * nqz + nqw * nqw);
        self.qx = nqx / norm; self.qy = nqy / norm; self.qz = nqz / norm; self.qw = nqw / norm;

        // a car that stands still on the brakes stays where it is: stop instead of drifting
        if(!self.airborne && Math.abs(self.u) < 0.02 && Math.abs(self.v) < 0.02 && inp.brakePedal > 0.3 && Math.abs(self.vy) < 0.05) {
            self.vx = self.vy = self.vz = 0;
            self.wx = self.wy = self.wz = 0;
        }

        if(ground3D) resolveCollisions3D(); else if(self.collision) resolveCollisions();

        // accelerations along and across the car, for the display (the tyre forces and the air, without gravity)
        var aT = Math.min(1, dt / 0.1);
        self.ax += (sumFx / m - self.ax) * aT;
        self.ay += (-sumFy / m - self.ay) * aT;

        for(var q = 0; q < 4; q++) {
            wheels[q].velocity.set(self.vx, self.vy, self.vz);
            wheels[q].RPM = wheels[q].omega * 30 / Math.PI;
            wheels[q].forwardMPH = Math.round(wheels[q].forwardSpeed * 2.2369362920544);
            wheels[q].compression = comp[q];
            wheels[q].compressionVelocity = compVelocity[q]; // how fast the spring is pushed in (m/s), for the force feedback
            wheels[q].onGround = wheels[q].hasContact;
        }
    }

    // Moves the physics forward by delta seconds, in small steps. The 3D side of the car is left to Car.js.
    // A push on the body from outside (the shake test of the car editor): a force in newtons straight down in the world, at a point
    // of the body (x to the left, y up, z forward from the centre of gravity). It lasts until the next frame.
    this.pushes = [];
    this.pushDown = function (bx, by, bz, newtons) { this.pushes.push({ x: bx, y: by, z: bz, n: newtons }); };

    // A number that is not a number (NaN, infinity) in the state of the car stays there for good and the car is dead (and the sound throws). It should not happen; when it does, it is
    // reported once with the name of the field (the cause is then to be found), the car is put back upright where it last was fine, and the wheels start clean.
    var lastGood = null, reported = false, lastSpeed = 0, blewUp = false;
    var BODY_FIELDS = ["px", "py", "pz", "vx", "vy", "vz", "wx", "wy", "wz", "qx", "qy", "qz", "qw"];
    var WHEEL_FIELDS = ["omega", "s", "slipRatio", "slipTan", "susLength", "susVel", "heat", "smoke", "squeal", "surfT", "roadT", "temp", "fx", "fy"];
    this.checkFinite = function () {
        var bad = null, i, k, w;
        for(i = 0; i < BODY_FIELDS.length && !bad; i++) if(!isFinite(this[BODY_FIELDS[i]])) bad = BODY_FIELDS[i];
        var wheelBad = null;
        for(i = 0; i < 4 && !wheelBad; i++) {
            w = this.wheels[i];
            for(k = 0; k < WHEEL_FIELDS.length; k++) if(typeof w[WHEEL_FIELDS[k]] === "number" && !isFinite(w[WHEEL_FIELDS[k]])) { wheelBad = "wheel " + i + " " + WHEEL_FIELDS[k]; break; }
        }
        if(!bad && !wheelBad) {
            // a car does not gain 35 m/s in one update, nor spin faster than 60 rad/s: that is the contacts blowing up (a wheel in a corner of the terrain), not driving. The speed
            // that it had is kept, and it is said once.
            var speedNow = Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz), spinNow = Math.sqrt(this.wx * this.wx + this.wy * this.wy + this.wz * this.wz);
            if((speedNow - lastSpeed > 35 && speedNow > 50) || spinNow > 60) {
                if(!blewUp) { blewUp = true; console.warn("Vehicle: the speed jumped from " + lastSpeed.toFixed(0) + " to " + speedNow.toFixed(0) + " m/s (spin " + spinNow.toFixed(0) + " rad/s) at " + this.px.toFixed(0) + ", " + this.pz.toFixed(0) + ": it is held back."); }
                if(speedNow - lastSpeed > 35 && speedNow > 50) { var keep = Math.max(lastSpeed, 1) / speedNow; this.vx *= keep; this.vy *= keep; this.vz *= keep; }
                if(spinNow > 60) { var calm = 60 / spinNow; this.wx *= calm; this.wy *= calm; this.wz *= calm; }
                speedNow = Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
            }
            lastSpeed = speedNow;
            lastGood = { x: this.px, z: this.pz, psi: this.psi };
            return;
        }
        if(!reported) { reported = true; console.warn("Vehicle: a value is not a number (" + (bad || wheelBad) + "); the car is put back on the road."); }
        if(bad && lastGood) { this.reset(lastGood.x, lastGood.z, lastGood.psi); this.py += 0.3; }
        else if(bad) this.reset(0, 0, 0);
        // the wheels that were not reset (or have a field that is not a number) start clean
        for(i = 0; i < 4; i++) {
            w = this.wheels[i];
            for(k = 0; k < WHEEL_FIELDS.length; k++) if(typeof w[WHEEL_FIELDS[k]] === "number" && !isFinite(w[WHEEL_FIELDS[k]])) w[WHEEL_FIELDS[k]] = (WHEEL_FIELDS[k] === "temp" || WHEEL_FIELDS[k] === "surfT" || WHEEL_FIELDS[k] === "roadT") ? this.ambient : (WHEEL_FIELDS[k] === "susLength" && w.restLengthWheel !== undefined ? w.restLengthWheel : 0);
        }
    };

    this.update = function (delta) {
        this.updateControls(delta);
        this.impactTime += delta;
        this.soundImpact = 0;             // how hard something landed or hit the bump stop in this update (0..1), for the sound (Car.js)
        var steps = Math.max(1, Math.ceil(delta / 0.003));
        var dt = delta / steps;
        for(var s = 0; s < steps; s++) step(dt);
        this.pushes.length = 0;
        this.checkFinite();
        this.squeal = 0;
        for(var q = 0; q < 4; q++) this.squeal = Math.max(this.squeal, this.wheels[q].squeal);
        this.updateOutputs();
        this.measureWheels();
    };
};
