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
    // the wheel with its tyre, brake and hub is a mass of its own on the spring (kg per wheel), standing on the tyre, which is a
    // stiff spring (N/m) with a little damping (Ns/m): this is what takes the edge off a kerb
    this.unsprungMass = parameters.unsprung_mass || 35;
    this.tyreRate = parameters.tyre_rate || 220000;
    this.tyreDamping = parameters.tyre_damping || 300;
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
    this.reboundFactor = 1.7;
    this.restLength = 0.28;           // from the mount to the middle of the wheel, at rest (m)
    // the ride height per axle: how much further out (positive) or in the wheels of an axle sit at rest than that (m); it raises or
    // lowers the body there, with its centre of gravity, and gives it rake when the two differ
    this.rideFront = parameters.ride_front || 0;
    this.rideRear = parameters.ride_rear || 0;
    this.bumpTravel = 0.09;           // how much further the spring can go in before the bump stop (m)
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

    this.tcAllowance = 1;             // tuning: how much wheel spin the traction control allows, as a factor
    this.escGain = 1;                 // tuning: how hard the stability control steps in, as a factor
    this.tcEnabled = false;           // traction control: takes power off when the driven wheels spin
    this.escEnabled = false;          // stability control (see step())
    this.absEnabled = true;
    this.tcFactor = 1;
    this.escLevel = 0;                // how hard the stability control works (0..1)
    this.yawWanted = 0;               // the yaw rate the steering asks for, as the car can follow it (it needs a moment to turn)
    this.steerApplied = 0;            // the angle of the front wheels
    this.understeerGradient = 0.0008; // (rad s^2/m) of the car, to know what the car does at a steering angle; set by layout() from the car
    this.shiftTime = parameters.shift_time || 0.32; // how long a shift of the gearbox takes without a clutch pedal (s)
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
            driven: this.isDriven(defs[i].front), mass: 0, maxBrakeTorque: defs[i].front ? this.brakeFront : this.brakeRear
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
    var OPTIMUM = 85, WINDOW = 15, COLD = 45;       // °C: the best temperature, the width of the window, how far out the grip is at its least

    function conditionOf(w) {
        var off = Math.max(0, Math.abs(w.temp - OPTIMUM) - WINDOW) / COLD;
        var byTemp = 1 - 0.22 * Math.min(1, off);
        var byWear = 1 - 0.2 * Math.pow(Math.min(1, w.wear), 1.5) - (w.wear >= 1 ? 0.15 : 0);
        return byTemp * byWear;
    }

    // called every step for a wheel: slidePower is the power the slip burns (W), fz the load (N), v the speed over the road (m/s)
    this.wearStep = function (w, dt, slidePower, fz, v, contact) {
        if(!this.wearEnabled) { w.temp = OPTIMUM; w.wear = Math.min(w.wear, 1); w.condition = 1; return; }
        // the power of the slip (tens of kW in a bend at the limit) and the flexing under the load heat the tyre; the air cools
        // it (W/K, more the faster); the tread has a heat capacity of about 20 kJ/K, so it takes a minute or two to come up
        var heatIn = (slidePower + (contact ? fz * Math.abs(v) * 0.025 : 0)) * this.tyreHeating;
        var cooling = (40 + 3 * Math.abs(v)) * (w.temp - this.ambient);
        w.temp += (heatIn - cooling) / 20000 * dt;
        var overheated = Math.min(2, Math.max(0, (w.temp - (OPTIMUM + WINDOW)) / 30));
        // a powerful car spins its wheels a lot: the slip when driving off counts less than a slide through a bend
        var counted = Math.abs(v) < 8 ? slidePower * 0.35 : slidePower;
        w.wear += counted * (1 + 2 * overheated) * dt / (6e6 * this.tyreLife) * this.wearScale;
        w.condition = conditionOf(w);
    };

    this.fuelStep = function (dt, engineTorque, engineOmega) {
        if(!this.wearEnabled) { this.engine.noFuel = false; return; }
        var power = Math.max(0, engineTorque) * engineOmega;           // W
        // a racing engine burns about four times what the energy alone says (rich mixture, the throttle open and shut all the time)
        this.fuelFlow = (0.0003 + power / (0.25 * 34e6) * 4) * this.fuelUse * this.wearScale;
        this.fuel = Math.max(0, this.fuel - this.fuelFlow * dt);
        this.engine.noFuel = this.fuel <= 0;
        fuelMassTimer += dt;
        if(fuelMassTimer > 1) { fuelMassTimer = 0; this.mass = this.baseMass + this.fuel * 0.75; this.layout(); }
    };

    // new tyres (at the temperature of the blankets) and the fuel that is asked for: a pit stop (Pit.js), or the start of a race
    this.freshTyres = function (temp) {
        for(var i = 0; i < 4; i++) { var w = this.wheels[i]; w.wear = 0; w.temp = temp === undefined ? 60 : temp; w.condition = conditionOf(w); }
    };
    this.maxWear = function () { var m = 0; for(var i = 0; i < 4; i++) m = Math.max(m, this.wheels[i].wear); return m; };

    // ---- geometry that follows from the mass, the weight distribution and the springs
    var arbFront = 0, arbRear = 0;    // anti-roll bars: the force at a wheel per metre that the wheels are pushed in differently
    var inertiaX = 1, inertiaY = 1, inertiaZ = 1;
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
        if(t.shift_time !== undefined) this.shiftTime = t.shift_time;
        if(t.ride_front !== undefined) this.rideFront = t.ride_front;
        if(t.ride_rear !== undefined) this.rideRear = t.ride_rear;
        if(t.turbo_share !== undefined) this.engine.turboShare = Math.max(0, Math.min(0.9, t.turbo_share));
        if(t.turbo_spool !== undefined) this.engine.turboSpool = Math.max(0.05, t.turbo_spool);
        if(t.turbo_threshold !== undefined) this.engine.turboThreshold = t.turbo_threshold;
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
            if(t.cornering !== undefined) w.anglePeak = this.baseAnglePeak / (t.cornering * w.stiffnessBias);
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
        if(t.esc_gain !== undefined) this.escGain = t.esc_gain;
    };

    // The road under (x, z), as { y, nx, ny, nz, surface, mesh }; a flat road at 0 without a ground
    var flat = { y: 0, nx: 0, ny: 1, nz: 0, surface: "road", mesh: "" };
    function roadAt(x, z, y, above) {
        if(!self.ground) return flat;
        return self.ground.query(x, z, y, above);
    }

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
        this.ax = this.ay = 0;
        this.suspensionHistory = null;
        for(var i = 0; i < 4; i++) {
            var w = this.wheels[i];
            w.omega = 0;
            w.slipRatio = w.slipTan = 0;
            w.absFactor = 1;
            w.heat = w.smoke = w.squeal = 0;
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
        return this.gear_ratios[inp.current_gear] * ratio;
    };

    // the driven wheels: left and right
    this.drivenA = function () { return this.wheels[this.driveType === "fwd" ? 1 : 2]; };
    this.drivenB = function () { return this.wheels[this.driveType === "fwd" ? 0 : 3]; };

    // the share of the engine torque that every wheel gets (in the order of the wheels) when the differentials are open
    this.torqueShares = function () {
        if(this.driveType === "awd") {
            var f = Math.max(0, Math.min(1, this.centerSplit));
            return [f / 2, f / 2, (1 - f) / 2, (1 - f) / 2];
        }
        return this.driveType === "fwd" ? [0.5, 0.5, 0, 0] : [0, 0, 0.5, 0.5];
    };

    this.getSpeed = function () {
        return this.u;
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

        // automatic gearbox
        if(!inp.manualGearbox && !inp.reverse && !inp.neutral) {
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
                if(g < gears - 1 && rpm > upRPM && rpm * nextRatio > 0.35 * limit && this.u > 1) {
                    inp.current_gear++;
                } else if(g > 0 && (rpm < downRPM && rpm * prevRatio < 0.86 * limit || (this.u < 1.5 && thr < 0.1))) {
                    inp.current_gear--;
                }
            }
        }

        // a shift of the gear (by the driver or by the automatic gearbox) needs the clutch
        var key = inp.neutral ? -1 : (inp.reverse ? -2 : inp.current_gear);
        if(this.lastGearKey !== null && key !== this.lastGearKey) {
            this.timeSinceShift = 0;
            if(!inp.clutchPedalPresent) this.shiftTimer = this.shiftTime;
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
            rotate(this.qx, this.qy, this.qz, this.qw, w.mount.x, w.mount.y, w.mount.z, tmp);
            var mx = this.px + tmp.x, my = this.py + tmp.y, mz = this.pz + tmp.z;
            var length = w.hasContact ? w.suspensionLength : w.freeLength;
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

    var impactSpeed = { value: 0 };
    function resolveCollisions() {
        var offset = (self.af - self.ar) / 2; // the rectangle of the car is centred between the axles
        for(var pass = 0; pass < 3; pass++) {
            var cosP = Math.cos(self.psi), sinP = Math.sin(self.psi);
            var contacts = self.collision.query(self.px + cosP * offset, self.pz + sinP * offset, self.psi,
                self.halfLength, self.halfWidth, self.groundLevel + self.kerbHeight, self.groundLevel + self.bodyHeight);
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

    // ---- the body on the road: the corners of the body touch it after a landing or when the car has turned over
    var corner = { x: 0, y: 0, z: 0 }, local = { x: 0, y: 0, z: 0 };
    var cornerForce = { x: 0, y: 0, z: 0 };
    function bodyCorners(force, torque) {
        var yBottom = -self.cgHeight + self.groundClearance;
        var yTop = yBottom + self.bodyHeight;
        var zCentre = (self.af - self.ar) / 2;
        var kc = 60 * self.mass, cc = 0.25 * Math.sqrt(kc * self.mass);
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

        // ---- ESC, the electronic stability control
        // Sensors tell it what the driver asks for (the steering angle gives the direction that the car should turn to, at
        // this speed) and what the car does (its yaw rate). When these differ, it steps in: a car that turns more than
        // asked (oversteer) gets a short brake on the outer front wheel, which pulls the nose back out; a car that turns
        // less (understeer) gets the inner rear wheel braked, which turns it in. Both also take power off the engine. The
        // steering itself is not touched. It can only do so much, so a sudden steer from left to right at speed can still
        // make the car slide.
        var escBrake = [0, 0, 0, 0];
        var escCut = 0;
        if(self.escEnabled && !inp.handbrake && u > 5 && !self.airborne) {
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
        var steerOf = [delta, delta]; // front right, front left
        if(Math.abs(delta) > 1e-4 && self.ackermann > 0) {
            var R = L / Math.tan(Math.abs(delta)), half = self.front_track / 2;
            var inner = Math.atan(L / Math.max(0.3, R - half)), outer = Math.atan(L / (R + half));
            var dInner = Math.abs(delta) + (inner - Math.abs(delta)) * self.ackermann, dOuter = Math.abs(delta) + (outer - Math.abs(delta)) * self.ackermann;
            var sign = delta > 0 ? 1 : -1;
            steerOf = delta > 0 ? [sign * dInner, sign * dOuter] : [sign * dOuter, sign * dInner];
        }

        // ---- the springs: how far every wheel is pushed in, and the force that makes
        var down = { x: -axisY.x, y: -axisY.y, z: -axisY.z };
        var anyContact = false;
        for(var i = 0; i < 4; i++) {
            var w = wheels[i];
            rotate(self.qx, self.qy, self.qz, self.qw, w.mount.x, w.mount.y, w.mount.z, Rv);
            var mx = self.px + Rv.x, my = self.py + Rv.y, mz = self.pz + Rv.z;
            // The wheel is round: the road is sampled ahead of and behind the middle of the wheel, and the rim touches where it
            // reaches the road first. So a kerb or an edge lifts the wheel gradually as it rolls on to it, instead of all at once
            // when the middle passes it. The surface under the middle is the one that counts for the grip.
            var road = null, t = Infinity, surfaceRoad = null;
            for(var sk = -2; sk <= 2; sk++) {
                var along = sk * 0.4 * w.radius;
                var sample = roadAt(mx + axisZ.x * along, mz + axisZ.z * along, my, 0.3);
                if(!sample) continue;
                if(sk === 0) surfaceRoad = sample;
                var ndS = sample.nx * axisY.x + sample.ny * axisY.y + sample.nz * axisY.z;
                if(ndS < 0.3) ndS = 0.3;
                var lift = w.radius - Math.sqrt(w.radius * w.radius - along * along); // the rim is this much higher there than at the bottom
                var tS = ((my - (sample.y - lift)) * sample.ny) / ndS;
                if(tS < t) { t = tS; road = sample; }
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
            if(road) {
                var pen = (w.susLength + w.radius) - t;      // how far the road pushes the tyre in
                if(pen > 0) {
                    w.hasContact = true;
                    anyContact = true;
                    w.surface = (surfaceRoad || road).surface;
                    w.groundY = road.y;
                    w.normal = road;
                    w.contact.x = mx + down.x * t; w.contact.y = my + down.y * t; w.contact.z = mz + down.z * t;
                    var penRate = w.susVel + mountDown;
                    tyreLoad[i] = Math.max(0, self.tyreRate * pen + self.tyreDamping * penRate);
                }
            }
            comp[i] = w.freeLength - w.susLength;
            compVelocity[i] = -w.susVel;
            w.suspensionLength = w.susLength;
        }
        self.airborne = !anyContact;
        // the anti-roll bars push the wheel that is pushed in more down, and the other up
        var arbF = arbFront * (comp[1] - comp[0]);       // front: left minus right
        var arbR = arbRear * (comp[2] - comp[3]);        // rear: left minus right
        var arbForce = [-arbF, arbF, arbR, -arbR];      // on FR, FL, RL, RR (in the order of the wheels)

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
            var damperS = (mag <= knee ? cUse * mag : cUse * (knee + 0.2 * (mag - knee))) * (xdotS > 0 ? 1 : -1);
            var bumpS = ws.susLength < ws.minLength ? 12 * rateS * (ws.minLength - ws.susLength) : 0;
            var droopS = ws.susLength > ws.freeLength ? -12 * rateS * (ws.susLength - ws.freeLength) : 0;  // the droop stop holds the wheel
            var fs = rateS * comp[si] + damperS + bumpS + droopS + arbForce[si];
            springForce[si] = fs;
            // the wheel: the spring pushes it out, the tyre pushes it in, gravity pulls it along the axis, and it rides with the mount
            var accel = (fs - tyreLoad[si]) / self.unsprungMass + gDown - lastBodyAccDown;
            ws.susVel += accel * dt;
            ws.susLength += ws.susVel * dt;
            if(ws.susLength < 0.02) { ws.susLength = 0.02; if(ws.susVel < 0) ws.susVel = 0; }
            if(ws.susLength > ws.freeLength + 0.06) { ws.susLength = ws.freeLength + 0.06; if(ws.susVel > 0) ws.susVel = 0; }
        }

        // two sums of forces: what acts on the body alone (gravity on it, the springs: it moves the sprung mass) and what acts on
        // the whole car (the tyres along the road, the air, the walls: the wheels go with the body, so it moves everything)
        force.x = 0; force.y = 0; force.z = 0;
        forceBody.x = 0; forceBody.y = -mBody * G; forceBody.z = 0;
        torque.x = torque.y = torque.z = 0;
        var tyreTorque = [0, 0, 0, 0];
        var brakeTorque = [0, 0, 0, 0];
        var maxDrivenSlip = 0;
        var brakePedal = inp.brakePedal;
        var handbrake = inp.handbrake ? 1 : 0;
        var sumFx = 0, sumFy = 0;
        // the roll of the body (positive: leaning to the right), for the camber of the wheels
        rotateInverse(self.qx, self.qy, self.qz, self.qw, 0, 1, 0, tmpA);
        var rollRight = Math.asin(Math.max(-1, Math.min(1, tmpA.x)));
        var newAxleFy = [0, 0];

        for(var iw = 0; iw < 4; iw++) {
            var wheel = wheels[iw];
            var fz = 0, fxW = 0, fyW = 0;
            var vl = 0;
            // the spring pushes on the body at the mount, whether the tyre touches the road or not (a wheel in the air hangs on its droop stop)
            rotate(self.qx, self.qy, self.qz, self.qw, wheel.mount.x, wheel.mount.y, wheel.mount.z, Rv);
            var fsBody = -springForce[iw];                 // the reaction on the body, along the suspension axis (up when the spring is pushed in)
            var fsx = axisY.x * -fsBody, fsy = axisY.y * -fsBody, fsz = axisY.z * -fsBody;
            forceBody.x += fsx; forceBody.y += fsy; forceBody.z += fsz;
            torque.x += Rv.y * fsz - Rv.z * fsy;
            torque.y += Rv.z * fsx - Rv.x * fsz;
            torque.z += Rv.x * fsy - Rv.y * fsx;
            if(wheel.hasContact) {
                var road2 = wheel.normal;
                fz = tyreLoad[iw];                         // the load on the tyre, which is what it grips with
                wheel.weight = fz;

                var nx = road2.nx, ny = road2.ny, nz = road2.nz;
                // the point of contact and its velocity
                Cv.x = wheel.contact.x - self.px; Cv.y = wheel.contact.y - self.py; Cv.z = wheel.contact.z - self.pz;
                var cvx = self.vx + (self.wy * Cv.z - self.wz * Cv.y);
                var cvy = self.vy + (self.wz * Cv.x - self.wx * Cv.z);
                var cvz = self.vz + (self.wx * Cv.y - self.wy * Cv.x);
                // the direction of the wheel on the road: forward along the wheel (turned by the steering), and to the left of it
                var fbx, fby, fbz;
                if(wheel.front) {
                    var cosD = Math.cos(steerOf[iw]), sinD = Math.sin(steerOf[iw]);
                    fbx = axisZ.x * cosD - axisX.x * sinD; fby = axisZ.y * cosD - axisX.y * sinD; fbz = axisZ.z * cosD - axisX.z * sinD;
                } else {
                    fbx = axisZ.x; fby = axisZ.y; fbz = axisZ.z;
                }
                var dotN = fbx * nx + fby * ny + fbz * nz;
                var fpx = fbx - nx * dotN, fpy = fby - ny * dotN, fpz = fbz - nz * dotN;
                var fl = Math.sqrt(fpx * fpx + fpy * fpy + fpz * fpz) || 1;
                fpx /= fl; fpy /= fl; fpz /= fl;
                var lx = ny * fpz - nz * fpy, ly = nz * fpx - nx * fpz, lz = nx * fpy - ny * fpx;   // n x f: to the left

                vl = cvx * fpx + cvy * fpy + cvz * fpz;
                var vt = cvx * lx + cvy * ly + cvz * lz;
                wheel.forwardSpeed = vl;

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
                var geometric = (wheel.right ? 1 : -1) * axleFy[axle] * rollCentre / trackWidth;
                var fzGrip = Math.max(0, fz + geometric);
                // camber: the lean of the wheel to the left (its static camber, and the lean of the body in roll); a wheel that
                // leans pushes towards the side it leans to, as if it had a slip angle
                var camber = (wheel.front ? self.camberFront : self.camberRear) * Math.PI / 180;
                var leanLeft = (wheel.right ? -camber : camber) - rollRight * self.rollCamber;
                var surface = self.getSurface(wheel.surface);
                wheel.tyreForce(wheel.slipRatio, wheel.slipTan - self.camberGain * leanLeft * wheel.anglePeak / 0.15, fzGrip, surface);
                // Smoke and squeal: the tyre slides (s is above 1 past the peak of the grip) at some speed over the road. The heat builds
                // up the longer it slides, so the smoke gets thicker, and goes away slowly when it grips again.
                var slideSpeed = Math.sqrt((wheel.omega * wheel.radius - vl) * (wheel.omega * wheel.radius - vl) + vt * vt);
                var sliding = smoothstep(1.2, 2.2, wheel.s) * smoothstep(1.5, 6, slideSpeed);
                wheel.heat = Math.max(0, Math.min(1, wheel.heat + (sliding > 0 ? sliding * dt / 1.8 : -dt / 2.5)));
                wheel.smoke = fz > 200 ? Math.min(1, 0.15 * sliding + wheel.heat * Math.min(1, sliding * 2 + 0.2)) : 0;
                wheel.squeal = (wheel.surface === "road" || wheel.surface === "track01") && fz > 200
                    ? smoothstep(0.85, 1.5, wheel.s) * (1 - 0.4 * smoothstep(2.5, 4, wheel.s)) * smoothstep(0.4, 2.5, slideSpeed) : 0;
                fxW = wheel.fx;
                fyW = wheel.fy;
                // the temperature and the wear: the power that the slip burns
                self.wearStep(wheel, dt, Math.abs(fxW * (wheel.omega * wheel.radius - vl)) + Math.abs(fyW * vt), fz, vl, true);
                // a little damping on the slip speed keeps a nearly stationary wheel from ringing
                fxW += 400 * Math.max(-0.3, Math.min(0.3, wheel.omega * wheel.radius - vl));
                tyreTorque[iw] = -fxW * wheel.radius;

                // rolling resistance (more on soft ground), not a torque on the wheel
                var rr = wheel.rollingResistance * (surface.static < 0.8 ? 4 : 1) * fz * Math.tanh(vl / 0.3);
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
                newAxleFy[axle] += fyW;
            } else {
                wheel.weight = 0;
                wheel.forwardSpeed = 0;
                wheel.slipRatio *= 0.98;
                wheel.slipTan *= 0.98;
                wheel.heat = Math.max(0, wheel.heat - dt / 2.5);
                wheel.smoke = 0;
                wheel.squeal = 0;
                self.wearStep(wheel, dt, 0, 0, self.u, false);
            }

            // brakes, with ABS
            if(self.absEnabled && brakePedal > 0.05 && wheel.hasContact && wheel.slipRatio < -0.08 && wheel.s > 1.1 && Math.abs(vl) > 2) {
                wheel.absFactor = Math.max(0.05, wheel.absFactor - 15 * dt);
                wheel.abs = true;
            } else {
                wheel.absFactor = Math.min(1, wheel.absFactor + 8 * dt);
                if(wheel.absFactor > 0.98) wheel.abs = false;
            }
            var bt = brakePedal * wheel.maxBrakeTorque * wheel.absFactor;
            if(!wheel.front) bt += handbrake * 1800;
            if(inp.parkingLock) bt = Math.max(bt, 4000); // P: the parking lock holds all wheels
            bt += escBrake[iw];
            wheel.esc = escBrake[iw] > 30;
            brakeTorque[iw] = bt;
            wheel.brakeTorque = bt;
            if(wheel.driven && wheel.hasContact) maxDrivenSlip = Math.max(maxDrivenSlip, (wheel.omega * wheel.radius - vl) / (self.tcAllowance * (1 + 0.12 * Math.abs(vl))));
        }

        axleFy[0] = newAxleFy[0]; axleFy[1] = newAxleFy[1];

        // ---- traction control
        // Traction control only looks at the wheels: when a driven wheel turns faster than the road under it (it spins),
        // power is taken off the engine until it grips again, and given back slowly. A little wheel speed is allowed: one
        // metre per second and 12% of the speed, which is about where a tyre has the most grip.
        var slipError = maxDrivenSlip - 1;
        if(self.tcEnabled && slipError > 0) {
            self.tcFactor = Math.max(0.12, self.tcFactor - dt * (3 + 5 * slipError));
            for(var ti = 0; ti < 4; ti++) if(wheels[ti].driven) wheels[ti].tc = true;
        } else {
            self.tcFactor = Math.min(1, self.tcFactor + dt * (slipError < -0.5 ? 2 : 0.4));
            if(self.tcFactor > 0.98 || !self.tcEnabled) for(var tj = 0; tj < 4; tj++) wheels[tj].tc = false;
        }

        // ---- engine and clutch
        var gs = self.getGearRatio();
        var shares = self.torqueShares(); // the share of the torque of every wheel with open differentials
        var throttle = inp.throttle * self.tcFactor * (1 - 0.85 * escCut);
        // the gearbox takes the power off while it shifts
        if(self.shiftTimer > 0) throttle *= 0.15;
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
            engagement = smoothstep(1050, 2000, rpm);
            if(self.shiftTimer > 0) {
                var ts = self.shiftTimer;
                engagement = Math.min(engagement, ts > 0.14 ? 0 : 1 - smoothstep(0, 0.14, ts));
            }
        }
        self.clutchEngagement = engagement;

        // brake torque as it is felt by the wheel at its current speed, for the clutch solution below
        var Je = engine.inertia;
        var Tc = 0;
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
        }
        engine.omega += dt * (Te - Tc) / Je;
        if(engine.omega < 0) engine.omega = 0;
        if(engine.omega > engine.maxRPM * Math.PI / 30) engine.omega = engine.maxRPM * Math.PI / 30;
        var driveTotal = Tc * gs * self.driveEfficiency; // the torque to all driven wheels together
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
        if(self.diffType === "lsd") {
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
        for(var j = 0; j < 4; j++) {
            var wj = wheels[j];
            var T = tyreTorque[j];
            T += wheelDrive[j];
            var omegaFree = wj.omega + dt * T / wj.inertia;
            var bt2 = brakeTorque[j];
            if(bt2 > 0) {
                var dw = dt * bt2 / wj.inertia;
                if(Math.abs(omegaFree) <= dw) omegaFree = 0;
                else omegaFree -= dw * (omegaFree > 0 ? 1 : -1);
            }
            wj.omega = omegaFree;
        }

        // ---- locked: the wheels of an axle (welded), or the axles (locked centre) turn at the same speed. The speed they get keeps the angular momentum.
        if(self.diffType === "welded") {
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
        var dragX = -self.Cdrag * speed * self.vx, dragY = -self.Cdrag * speed * self.vy, dragZ = -self.Cdrag * speed * self.vz;
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

        // ---- the body on the road, for a landing or a car that has turned over
        bodyCorners(force, torque);

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

        if(self.collision) resolveCollisions();

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

    this.update = function (delta) {
        this.updateControls(delta);
        this.impactTime += delta;
        var steps = Math.max(1, Math.ceil(delta / 0.003));
        var dt = delta / steps;
        for(var s = 0; s < steps; s++) step(dt);
        this.pushes.length = 0;
        this.squeal = 0;
        for(var q = 0; q < 4; q++) this.squeal = Math.max(this.squeal, this.wheels[q].squeal);
        this.updateOutputs();
        this.measureWheels();
    };
};
