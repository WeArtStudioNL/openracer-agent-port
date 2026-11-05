/*
 * Motorcycle.js
 *
 * Description: Everything that makes a vehicle a motorcycle ("type": "motorcycle" in car.json, see MOTORCYCLE.md), in one place. The physics of the cars (Vehicle.js) does not know
 *              about it: it has a few hooks for a controller, a vehicle that has none (a car) goes through none of this. The controller is made from the "motorcycle" settings of car.json.
 *
 *              The bike is the physics of the game with a pair of wheels at each end, and a rider that this controller makes:
 *
 *   The input is a lean command. The steering keys, the stick or the wheel give a number from -1 to 1 (the part of the lock that is turned: left is negative, as for a car), and that is
 *   the lean that the rider takes, from 0 to `max_lean_deg`, whatever the speed. It follows the command with a delay (`lean_response`, 0.16 s), as a rider does: the keys of the keyboard
 *   bring it up over the time and along the curve of the settings (Keyboard).
 *
 *   The rider keeps the lean: a torque about the long axis of the bike (a spring and a damper), and a torque about the vertical that damps a yaw that the steering did not ask for.
 *
 *   The front wheel is steered from the lean that is wanted: the angle that a bend of that lean needs at this speed (a = g tan(lean), delta = L a / u^2, less what the leaned tyre gives
 *   by itself: the camber thrust), and, to start a lean, a short steer the other way (countersteering) that goes away as the lean arrives. At a walking pace the angle is the command.
 *
 *   The tyre: a leaned tyre pushes the bike into the bend (the camber thrust: a force towards the inside, `camber_thrust` of the load of the wheels times the sine of the lean).
 *
 *   The rider is a mass (`rider_mass`, 80 kg, in the mass of the vehicle: car.json "mass" is the bike without the rider, and the centre of gravity of car.json is the one with the rider sitting
 *   as he does by default; there is a rider mass whether the model has a driver or not). The rider moves on the bike (`posture`): back on a hard brake (a stoppie is harder to make), flat and
 *   forward on the throttle (a wheelie is harder to make, and the air has less of him: `dragScale`), and off the seat to the inside of a bend (the bike needs a smaller lean for the same bend:
 *   `tan(lean of the whole) = tan(lean of the bike + atan(rider share * hang off / height of the centre of gravity))`). The weight of the rider where he is, and what the bike does (the apparent
 *   weight: gravity less the acceleration), is a torque about the bike (the pitch and the yaw; the lean has its own rider). Driver.js takes the posture for the model (the body, the knees).
 *
 *   The throttle stands the bike up a little in a bend (`throttle_stand_up`). The brakes: the front brake is let off as the rear wheel loses its load (a stoppie goes over the front) and
 *   the rear brake goes with the load of its wheel. The body of the bike does not touch the road until it is nearly on its side. The camera rolls with the lean (`camera_roll`).
 */

OpenRacer.Motorcycle = function (settings) {
    var s = settings || {};
    var G = 9.81, DEG = Math.PI / 180;
    var self = this;
    this.settings = s;
    // the settings of the bike (car.json "motorcycle"; the tuning menu changes them while it rides: retune)
    function readSettings() {
        self.maxLean = (s.max_lean_deg || 60) * DEG;
        self.overLean = (s.over_lean_deg !== undefined ? s.over_lean_deg : 10) * DEG;   // how far past what the tyres hold the rider can lean it: past that the tyres let go (a lowside)
        self.crashLean = (s.crash_lean_deg || 78) * DEG;                                   // from here the bike is down (78: a powerslide is ridden out until the bike nearly lies on the road)
        self.balance = s.balance || 1;
        self.maxRollRate = (s.max_roll_rate_deg !== undefined ? s.max_roll_rate_deg : 90) * DEG;   // the most the lean that the rider takes can change (deg/s)
        self.leanResponse = s.lean_response || 0.1;          // s: how fast the lean follows what is asked
        self.camberThrust = s.camber_thrust !== undefined ? s.camber_thrust : 0.85;     // the part of load * tan(lean) that a leaned tyre gives by itself (a round tyre: nearly all of it)
        self.standUp = s.throttle_stand_up !== undefined ? s.throttle_stand_up : 0.18;
        self.cameraRollFactor = s.camera_roll !== undefined ? s.camera_roll : 0.45;
        self.keyRate = s.key_steer_rate || 2;                    // how much faster the steering keys bring the lean command than they turn the wheels of a car
        self.cornerBrake = s.corner_brake !== undefined ? s.corner_brake : 0.2;    // how much further the bike leans into the bend on the rear brake
        self.riderMass = s.rider_mass !== undefined ? s.rider_mass : 80;
        self.maxHang = s.hang_off !== undefined ? s.hang_off : 0.3;                    // m: how far the rider hangs off the seat to the inside of a bend
        self.counterWait = s.counter_wait !== undefined ? s.counter_wait : 1.0;      // s after the brake before the countersteering starts to come back
        self.counterRamp = s.counter_ramp !== undefined ? s.counter_ramp : 1.5;      // s in which it comes back
        self.fastFrom = s.fast_from !== undefined ? s.fast_from : 38;                  // m/s: from this speed the lean that the keys can ask for goes down
        self.fastLean = (s.fast_lean_deg !== undefined ? s.fast_lean_deg : 30) * DEG;   // the lean it can still ask for at fast_from + 22 m/s (it was 18 degrees: the bike hardly steered at 200 km/h)
        self.gripG = s.grip_g !== undefined ? s.grip_g : 1.05;                        // the lateral g that the tyres give when nothing else is asked of them
        self.frontComply = s.front_comply !== undefined ? s.front_comply : 3;            // how much the front wheel castors into its own slip on the brake (3: it keeps a quarter of the slip angle)
        self.airPitch = s.air_pitch !== undefined ? Math.max(0, s.air_pitch) : 1;      // in the air the wheels turn the bike: gas brings the nose up, the brake brings it down (a factor on the reaction of the wheels; 0: off)
        // the separate model (model "v2"): the bars are a degree of freedom with a torque from the rider; the tyre gives the camber thrust, the lean is the lean of the body
        self.v2 = s.model === "v2";
        // (the lean that is asked stays under what the tyre holds: at 1.05 g and 10 degrees over it, the lean of 45 to 48 degrees sat at the edge of the grip and a flick from lock to lock threw the bike; the old model does not
        // care, the tyre is not what gives its lean)
        if (self.v2) { if (s.grip_g === undefined) self.gripG = 0.95; if (s.over_lean_deg === undefined) self.overLean = 0; }
        self.steerInertia = s.steer_inertia || 0.35;          // kg m2: the front end about the steering axis
        self.trail = s.trail !== undefined ? s.trail : 0.015;   // m: the contact patch is this far behind the steering axis; the side force of the slip angle turns the wheel into its slip
        self.steerDamp = s.steer_damp !== undefined ? s.steer_damp : 60;   // Nm s/rad: the damping of the bars (a steering damper and the hands)
        self.riderKa = s.rider_ka !== undefined ? s.rider_ka : 1; self.riderKad = s.rider_kad !== undefined ? s.rider_kad : 0.2;   // the bars (rad) that a radian of lean error, and a radian a second of roll, ask at 10 m/s
        self.riderErrCap = (s.rider_err_cap_deg !== undefined ? s.rider_err_cap_deg : 90) * DEG;   // the most lean error that the bars answer
        self.balanceFrom = s.balance_from !== undefined ? s.balance_from : 6; self.balanceTo = s.balance_to !== undefined ? s.balance_to : 14;   // m/s: the rider's hold on the lean (the torque about the long axis) goes away between these speeds, in model v2
        self.push = !!s.push;      // the riding style of this bike (car.json motorcycle.push, the tuning menu); the menu of the game can turn it on for every bike
        self.pushExtraLean = (s.push_extra_lean_deg !== undefined ? s.push_extra_lean_deg : 4) * DEG; self.pushSlide = s.push_slide !== undefined ? s.push_slide : -0.6; self.pushSlideCap = (s.push_slide_cap_deg !== undefined ? s.push_slide_cap_deg : 7) * DEG;      // flat-track: the lean the bike may take beyond the usual (rad), and the countersteer of a slide (the bars follow the way the bike moves: the share of the slip angle, and the most)
        self.pushDrift = s.push_drift !== undefined ? s.push_drift : 0.3;      // flat track: the share of the lateral grip of the rear tyre that full gas in a bend takes (the tail steps out: a slide on the gas)
        self.pushFoot = (s.push_foot_kmh !== undefined ? s.push_foot_kmh : 110) / 3.6;      // flat track: up to this speed (m/s) the inside foot comes out in a bend (car.json motorcycle.push_foot_kmh, the tuning menu)
        // the pose of the rider in flat-track style (the tuning menu, car.json motorcycle.push_...; Driver.js reads them from the posture): how far the back leans out of the bike (a share of its lean), how far forward the
        // rider sits in a bend (m) and how far his chest leans forward (degrees), the most the pelvis tilts (degrees) and slides to the outside (m), how far the inside foot goes out and forward (m, at the most lean)
        self.poseStyle = { upright: s.push_upright !== undefined ? s.push_upright : 0.55, forward: s.push_forward !== undefined ? s.push_forward : 0, chestPitch: s.push_chest_pitch !== undefined ? s.push_chest_pitch : 0,
            pelvisTilt: s.push_pelvis_tilt !== undefined ? s.push_pelvis_tilt : 35, pelvisSlide: s.push_pelvis_slide !== undefined ? s.push_pelvis_slide : 0.09, footOut: s.push_foot_out !== undefined ? s.push_foot_out : 0.14, footForward: s.push_foot_forward !== undefined ? s.push_foot_forward : 0.5,
            // the pose in the road-race style (hang off): the roll of the trunk into the bend at the most hang off (degrees), how far the inside knee goes out and down (m), the trunk forward on the gas and back on the brake (degrees), the share of the hang off that the whole body moves
            chestRoll: s.hang_chest_roll !== undefined ? s.hang_chest_roll : 14, kneeOut: s.hang_knee_out !== undefined ? s.hang_knee_out : 0.6, kneeDown: s.hang_knee_down !== undefined ? s.hang_knee_down : 0.5,
            tuckPitch: s.hang_tuck_pitch !== undefined ? s.hang_tuck_pitch : 28, sitPitch: s.hang_sit_pitch !== undefined ? s.hang_sit_pitch : 10, shift: s.hang_shift !== undefined ? s.hang_shift : 0.7 };
        self.pushHang = s.push_hang !== undefined ? s.push_hang : -0.4; self.pushLockShare = s.push_lock_share !== undefined ? s.push_lock_share : 0.75;      // the flat-track style: the weight of the rider to the outside (a share of hang_off, negative), and the share of the lock for a low speed
        self.lockShare = s.lock_share !== undefined ? s.lock_share : 0.65;   // model v2: the share of the lock of the bars that a lean at a low speed may ask for
        self.gripFast = s.grip_fast !== undefined ? s.grip_fast : 0.2;   // model v2: the g more that the lean may ask for above 13 to 18 m/s (the bike is in the model of the rider and the tyres there; below it the lean is held)
        self.crownRadius = s.crown_radius !== undefined ? s.crown_radius : 0.1;   // m: the radius of the round crown of the tyre (v2): a leaned wheel stands on its shoulder, higher and further inside
        self.kinFrom = s.kin_from !== undefined ? s.kin_from : 7; self.kinTo = s.kin_to !== undefined ? s.kin_to : 13;   // m/s: the bars are the angle of the old model below the first speed, and the angle of the rider and the tyres above the second
        self.riderFastKa = s.rider_fast_ka !== undefined ? s.rider_fast_ka : 0.2; self.riderFastKad = s.rider_fast_kad !== undefined ? s.rider_fast_kad : 0.5;   // the share of the gains that is left at 28 m/s and above
        self.gainDownFrom = s.gain_down_from !== undefined ? s.gain_down_from : 8; self.gainDownTo = s.gain_down_to !== undefined ? s.gain_down_to : 14;   // m/s: the gains of the rider come down between these speeds while no lean is asked
        self.yawBrake = s.yaw_brake !== undefined ? s.yaw_brake : 1;   // model v2: how much of the yaw damping of the old model the rider has on the brake (0: none)
        self.bodyAssist = s.body_assist !== undefined ? s.body_assist : 1; self.bodyArm = s.body_arm !== undefined ? s.body_arm : 0.5;      // v2: the share of the help of the rider's body (0: none), and how far his weight goes out (m)
        self.pitchAssist = s.pitch_assist !== undefined ? s.pitch_assist : 1; self.pitchArm = s.pitch_arm !== undefined ? s.pitch_arm : 0.5;      // v2: the weight of the rider forward over a wheelie that is going over (share, m)
        self.pitchLead = s.pitch_lead !== undefined ? s.pitch_lead : 0.15;      // s: how far ahead the rider looks at the nose of a wheelie
        self.assistErrFrom = (s.assist_err_from_deg !== undefined ? s.assist_err_from_deg : 15) * DEG; self.assistErrTo = (s.assist_err_to_deg !== undefined ? s.assist_err_to_deg : 35) * DEG;      // the lean error from which the help comes in, and where it is all there
        self.riderBarsCap = (s.rider_bars_cap_deg !== undefined ? s.rider_bars_cap_deg : 12) * DEG;   // the most the bars are turned for the lean error (and the roll rate)
        self.armOmega = s.arm_omega !== undefined ? s.arm_omega : 40;   // rad/s: how stiff the hands hold the bars (the spring is steer_inertia * omega^2)
        self.riderTorqueMax = s.rider_torque_max !== undefined ? s.rider_torque_max : 120;   // Nm on the bars
        self.camberSlip = s.camber_slip !== undefined ? s.camber_slip : 0.087;   // slip (tan) that a radian of lean is worth, to the tyre
        self.footLean = (s.foot_lean_deg !== undefined ? s.foot_lean_deg : 7) * DEG;   // how far the bike rests to the right on the foot
    }
    readSettings();
    this.retune = function (changes) { Object.assign(s, changes || {}); self.settings = s; readSettings(); if (self.posture) self.posture.style = self.poseStyle; };
    this.posture = { lat: 0, long: 0, drop: 0, tuck: 0, sit: 0, knee: 0, assist: 0, look: 0, push: 0, inside: 0, lean: 0, flat: 0, lineYaw: 0, hasLine: 0 };      // assist: where the weight goes to the side for the help of the body (m); look: the head turned into the bend, -1 to 1 (left is positive)       // body space: lat to the left, long forward, drop up (m); tuck, sit, knee: 0 to 1
    this.posture.style = this.poseStyle;                    // (flat-track pose settings, see readSettings)
    var vPrev = null, accel = { x: 0, y: 0, z: 0 }, dw = { x: 0, y: 0, z: 0 };
    this.riderKey = 0;                                      // -1: the rider is put back, 1: forward (keys, set by Car.js)
    this.sinceBrake = 99; this.counterGain = 1;
    this.complied = 0;
    this.steerDof = 0; this.steerRate = 0; this.steerInt = 0;      // model v2: the angle of the bars (right is positive), their rate, the integral of the rider
    this.footDownL = 0; this.footStill = false; this.footWait = 0;       // the left foot (footDown is the right one), whether the bike is at a standstill, and the time since the feet should come up
    this.footDown = 0;                                       // 0 to 1: the right foot of the rider on the road (a standstill)
    this.noFoot = false;                                     // the car editor: the bike stands upright on its bench, the foot never goes down
    this.wheelieScale = 1;                                  // the throttle that the wheelie control leaves (1: all of it)
    this.crashed = false;                                   // the bike is down: the rider is a ragdoll, the bike a body that slides, no input until a reset or a repair
    this.limp = false;                                      // the rider has gone limp on the bike (a hit, or the key for it): no throttle, no steering, no balance; the bike rides on until his weight tips it over
    this.weight = { x: 0, y: -G, z: 0 };                    // the weight of the rider per kg (gravity less the acceleration of the bike), for the debug view
    this.riderLoad = null;                                  // where the middle of the limp rider is (world, from Driver.ragdollCentre): his weight off the middle of the bike leans it
    this.burnout = 0;                                        // 0 to 1: a burnout is going on (brakeStep)
    this.yawCap = 3000; this.yawCapBrake = 6000;             // N m: what the rider's hold on the yaw can give, and the extra on the brakes
    this.slideTime = 0;                                      // s that the bike has slid sideways past 15 degrees while leaning: a lowside after half a second
    this.wallHit = 0;                                        // the last wall hit that was seen (Vehicle.impactTime), so that one hit crashes once
    var hist = [], now = 0;                                  // the speed of the last tenth of a second: a hit that the smoothed acceleration misses (a wall through the wheels, a kerb)
    this.pushing = false;                                   // the rider walks the bike back (set by Car.js)
    // the options of the menu that the bike reads (OpenRacer.Motorcycle.OPTIONS): null reads them from Settings; a physics worker, which has no
    // Settings, is given them here (PHYSICS-WORKER.md)
    this.options = null;
    var option = function (name) { return self.options ? self.options[name] : (typeof Settings !== "undefined" ? Settings.option(name) : undefined); };
    // the riding style (the menu: Flat-track style, bikes only): hang off the seat to the inside (road race, the default) or stay upright and push the bike under you (flat track, supermoto):
    // the weight goes to the outside a little instead, so the bike leans further for the same bend (a bit less speed through a fast bend), it may take a tighter bend at a low speed
    // (`push_lock_share`), and the inside foot comes out and skids on the road, the inside elbow goes up
    var pushed = function () { return self.push || !!option("bikePush"); };
    this.pushStyle = pushed;
    this.command = 0;                                      // the lean that is asked (-1..1)
    this.drift = 0;                                         // flat track: the share of the lateral grip of the rear tyre that is gone (0 to push_drift)
    this.targetLean = 0;                                   // what the rider takes (rad, left is positive)
    this.steer = 0;                                        // the angle of the front wheel that was given to the physics (rad, right is positive)
    this.frontBrake = 1;
    this.rearBrake = 1;
    this.roll = 0;                                         // the roll of the camera

    function smooth(lo, hi, x) { var t = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); }
    function rotate(v, x, y, z, out) {
        var qx = v.qx, qy = v.qy, qz = v.qz, qw = v.qw;
        var ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
        out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
        out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
        out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
        return out;
    }
    var up = { x: 0, y: 0, z: 0 }, fwd = { x: 0, y: 0, z: 0 }, side = { x: 0, y: 0, z: 0 };

    // The road under the bike: the mean of the normals of the wheels that touch it (by their load), smoothed. A bike on a bank or over a crest is kept square to the road, not to the sky:
    // a bike that is upright on a bank slides down it.
    var road = { x: 0, y: 1, z: 0 }, roadAt = -1;
    function roadOf(v, dt) {
        if (!dt) return road;                                   // (once for every step of the physics: the other callers take what there is)
        var sx = 0, sy = 0, sz = 0, sw = 0;
        for (var i = 0; i < 4; i++) {
            var w = v.wheels[i];
            if (w.hasContact && w.normal && w.weight > 0) { sx += w.normal.nx * w.weight; sy += w.normal.ny * w.weight; sz += w.normal.nz * w.weight; sw += w.weight; }
        }
        if (sw > 0) {
            var l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1, k = Math.min(1, (dt || 0.016) / 0.15);
            road.x += (sx / l - road.x) * k; road.y += (sy / l - road.y) * k; road.z += (sz / l - road.z) * k;
        } else {
            var k2 = Math.min(1, (dt || 0.016) / 0.3);                     // in the air it goes back to the sky
            road.x -= road.x * k2; road.y += (1 - road.y) * k2; road.z -= road.z * k2;
        }
        var n = Math.sqrt(road.x * road.x + road.y * road.y + road.z * road.z) || 1;
        road.x /= n; road.y /= n; road.z /= n;
        return road;
    }

    // The lean of the bike to the left (rad) from the road, and how fast it falls to the left, from its pose
    function leanOf(v, dt) {
        rotate(v, 0, 1, 0, up);
        rotate(v, 0, 0, 1, fwd);
        var fl = Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z) || 1, fx = fwd.x / fl, fz = fwd.z / fl;
        var n = roadOf(v, dt);
        // the left of the bike along the road: n x forward
        var lx = n.y * fwd.z - n.z * fwd.y, ly = n.z * fwd.x - n.x * fwd.z, lz = n.x * fwd.y - n.y * fwd.x, ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
        rotate(v, 1, 0, 0, side);
        if (ll < 0.2) { lx = side.x; ly = side.y; lz = side.z; ll = 1; }                 // (the bike nearly vertical, a wheelie or a stoppie: its own left)
        lx /= ll; ly /= ll; lz /= ll;
        // The lean (the roll) is how far the bike's own left axis dips below the road: in a wheelie or a stoppie the up of the bike turns forward or back but its left axis stays level,
        // so the lean stays 0 (measured from the up of the bike it read 180 degrees past the vertical, and a wheelie that went past the balance point was a crash at once).
        // A bike that is upside down (its up below the road and not pitched up on end) is past 90 degrees.
        var sinRoll = Math.max(-1, Math.min(1, -(side.x * n.x + side.y * n.y + side.z * n.z)));
        var upN = up.x * n.x + up.y * n.y + up.z * n.z, fwdN = Math.abs(fwd.x * n.x + fwd.y * n.y + fwd.z * n.z);
        var lean = Math.asin(sinRoll);
        if (upN < 0 && fwdN < 0.7) lean = (sinRoll >= 0 ? Math.PI : -Math.PI) - lean;
        // The roll axis of the bike is its own forward (ax, ay, az), not the horizontal one (fx, fz): a torque about the horizontal axis on a slope, or with the nose down on the brake,
        // has a part about the up of the bike, and that was a yaw of several hundred newton metres (the rider pulling the bike up on a climb swung its tail out)
        var al = Math.sqrt(fwd.x * fwd.x + fwd.y * fwd.y + fwd.z * fwd.z) || 1, ax = fwd.x / al, ay = fwd.y / al, az = fwd.z / al;
        return { lean: lean, rate: -(v.wx * ax + v.wy * ay + v.wz * az), fx: fx, fz: fz, ax: ax, ay: ay, az: az, lx: lx, ly: ly, lz: lz, upN: upN, fwdN: fwdN, noseUp: fwd.x * n.x + fwd.y * n.y + fwd.z * n.z };
    }

    // ---- hook: the angle of the front wheel (right is positive), from what the input asks for. delta: what the input gave (the angle of the wheel or the lock that is turned).
    this.steering = function (v, delta, u, dt) {
        if (self.crashed) { self.steer += (0 - self.steer) * Math.min(1, dt / 0.1); return self.steer; }
        if (self.limp) {
            // nobody steers and nothing helps: the front wheel is let go (it comes straight), and the tyres and the lean decide where the bike goes; it goes down past 40 degrees, or
            // when it has stopped
            self.steer += (0 - self.steer) * Math.min(1, dt / 0.3);
            return self.steer;
        }
        var inp = v.input, lock = inp.turnLimit || inp.maxTurn || 0.38;
        var c = Math.max(-1, Math.min(1, delta / lock));          // the lean command: left is negative, as the steering of a car
        self.command = c;
        var state = leanOf(v, 0);
        var fast = smooth(1.5, 4.5, Math.abs(u));                  // at a walking pace the rider holds it up with a foot
        // the lean that the command asks for, less at a walking pace (a bend of that lean needs a speed: tan(lean) = u^2 tan(steering lock) / (L g)), and stood up a little by the throttle
        // (model v2: not for the whole lock of the bars: at the lock the front tyre is at 15 degrees of slip and the bike slides when the lean is let go)
        var cap = Math.atan(u * u * Math.tan(lock * (self.v2 ? (pushed() ? self.pushLockShare : self.lockShare) : 1)) / (v.wheelbase * G));
        // the lean of the whole (the bike and the rider that hangs off): tan(phi) = a / g. The bike itself leans phi less atan(share * hang off / height of the centre of gravity)
        var share = self.riderMass / v.mass, epsFull = Math.atan(share * self.maxHang * (pushed() ? self.pushHang : 1) / v.cgHeight);
        var eps = Math.atan(share * self.posture.lat / v.cgHeight);       // to the left: positive
        // at speed the tyres have to give a slip angle for every bit of lean, and the body crabs: past about 40 m/s the lean that is allowed goes down (to 18 degrees at 60 m/s), so that a key
        // held at 190 km/h is a gentle bend and not a slide
        var fastLean = option("bikeFastLean") ? option("bikeFastLean") * DEG : self.fastLean;      // (the menu: Motorcycle: lean at top speed)
        var speedMax = self.maxLean - (self.maxLean - Math.min(self.maxLean, fastLean)) * smooth(self.fastFrom, self.fastFrom + 22, Math.abs(u));
        if (pushed()) speedMax += self.pushExtraLean * (1 - smooth(14, 26, Math.abs(u))) * (1 - smooth(0.05, 0.4, (v.input.brakePedal || 0)));      // (flat track: a deeper lean at a low and a middle speed, where the tyres slide and the rider catches it)
        // the tyres have so much grip, and what they give along the bike (the engine, the air, the brake: how much the speed goes down) they cannot give sideways: the circle of grip
        var aLong = Math.max(0, -(accel.x * state.fx + accel.z * state.fz)), gripMax = (self.gripG + (self.v2 ? self.gripFast * smooth(13, 18, Math.abs(u)) : 0)) * G * (1 - self.drift);      // (flat track: with the tail out the lean that the tyres hold is less: the rider stands the bike up a little as it steps out)
        speedMax = Math.min(speedMax, Math.atan(Math.sqrt(Math.max(0, gripMax * gripMax - aLong * aLong)) / G) + self.overLean + (pushed() ? self.pushExtraLean * (1 - smooth(14, 26, Math.abs(u))) * (1 - smooth(0.05, 0.4, (v.input.brakePedal || 0))) : 0));     // (a little past the grip: that is the lowside)
        var phiMax = speedMax + epsFull;
        var want = -c * Math.min(phiMax, cap) * fast;
        // the AI (Opponent.js) asks the angle of the front wheel of a car on the path it wants: the lean is the one that bend needs at this speed. As a share of the
        // most lean (the keys of a player) a bend it needed 50 degrees for got 14, and an AI bike ran tens of metres wide into the barriers.
        if (inp.leanFromBend) want = -Math.sign(delta) * Math.min(phiMax, Math.atan(u * u * Math.tan(Math.min(Math.abs(delta), 1.2)) / (v.wheelbase * G))) * fast;
        // at a standstill the rider puts the right foot down and the bike rests against it, a little to the right
        // (the foot comes up once the bike itself moves at 7 km/h, or when the nose is up more than 30 degrees (a wheelie): not on the throttle and not on the speed of the rear
        // wheel, so it stays down in a burnout; up and down in about a second. Whenever it should be down it reaches for the road: a wheelie that is braked to a walking pace
        // puts the right foot down towards the ground)
        self.feetStep(dt, u, state.noseUp, !self.noFoot && !self.pushing, false);
        var brake = Math.max(0, Math.min(1, inp.brakePedal || 0)), bend = smooth(8 * DEG, 30 * DEG, Math.abs(want));
        want *= 1 + self.cornerBrake * brake * bend;                  // the rear brake takes it deeper into the bend (the front brake is not used in a bend: brakeScale)
        want = Math.max(-phiMax, Math.min(phiMax, want));
        want *= 1 - self.standUp * Math.max(0, Math.min(1, inp.throttle || 0)) * Math.min(1, Math.abs(want) / (15 * DEG));
        var bikeWant = Math.max(-speedMax, Math.min(speedMax, want - eps * Math.min(1, Math.abs(want) / (6 * DEG))));
        // (the lean cannot change faster than a rider can roll a bike: about 90 degrees a second (max_roll_rate_deg) at speed. The keys asked for the whole lean at once, and the rider's torque about
        // the long axis, which the tyres do not hold, rolled the bike over at 130 degrees a second and more: both wheels were unloaded, the bike slid sideways at 60 km/h (to 88 degrees
        // of slip angle in the test) or went over. Past about 120 degrees a second it let go. At a walking pace it can go faster.)
        var rollStep = (bikeWant - self.targetLean) * Math.min(1, dt / self.leanResponse);
        var rollMax = self.maxRollRate * (1 + 2.5 * (1 - smooth(4, 12, Math.abs(u)))) * dt;
        self.targetLean += Math.max(-rollMax, Math.min(rollMax, rollStep));
        var target = self.targetLean;
        // the angle of the wheel that a bend of this lean needs: a = g tan(lean of the whole) less the camber thrust of the tyres, delta = L a / u^2 (to the left: negative)
        // (of the lean that the bike has, not the one that it is going to: a front wheel that is ahead of the lean pushes the bike sideways, and when the keys go from left to right quickly
        // that is a bike that slides)
        var leanNow = Math.max(-self.maxLean, Math.min(self.maxLean, state.lean));
        var phiNow = leanNow + eps * Math.min(1, Math.abs(leanNow) / (6 * DEG));
        var phi = Math.abs(phiNow);
        // (the whole of it: the front wheel points along the bend whatever part of the sideways force the camber of the tyres gives; the camber only makes the slip angles small)
        var aBend = G * Math.tan(Math.min(1.05, phi));
        var steady = -Math.sign(phiNow) * Math.atan(v.wheelbase * aBend / Math.max(u * u, 1));
        // countersteering: to start a lean to the left the wheel goes to the right for a moment, in proportion to what the lean still has to go
        var cLimit = Math.min(0.07, 5 / Math.max(u * u, 1));       // (at most about half a g of sideways push from it at any speed)
        var counter = Math.max(-cLimit, Math.min(cLimit, 0.3 * (target - state.lean))) * smooth(3, 10, Math.abs(u));
        // On a straight (no lean asked for) the rider steers out a lean that came from outside (a bump, a crest, a hit): that keeps the bike straight, braking or not. It is always there.
        // The countersteering to start a lean (the menu: Countersteer + lean) is not used while the brake is on (the rider has his hands full, and a wheel that is turned the other way with
        // the weight on the front breaks the tail away): it comes back slowly after the brake (counter_wait, counter_ramp).
        var straight = 1 - smooth(2 * DEG, 6 * DEG, Math.abs(target));
        if ((inp.brakePedal || 0) > 0.05) self.sinceBrake = 0; else self.sinceBrake += dt;
        self.counterGain = smooth(self.counterWait, self.counterWait + self.counterRamp, self.sinceBrake);
        var pulse = option("bikeSteering") === "counter" ? self.counterGain : 0;
        counter *= straight + (1 - straight) * pulse;
        var geometric = c * lock;                                  // at a walking pace the angle is the command
        var w = 1 - smooth(2, 5, Math.abs(u));
        // The front wheel gives: its trail turns it towards where it goes (a wheel that is pushed sideways castors), so a sideways speed of the bike does not make a front tyre that is loaded on
        // the brake and held straight push the nose round (a front at 90 % of the weight and a light rear is a car that spins). The wheel follows a part of its own slip angle, and the rear,
        // behind the centre of gravity, is what keeps the bike straight.
        var slipFront = 0.5 * (Math.atan(v.wheels[0].slipTan || 0) + Math.atan(v.wheels[1].slipTan || 0));
        // (on the brake and upright only: that is where the front carries nearly everything; in a bend the camber of the tyres carries the bike and the front slip is part of the bend,
        // and with the wheel free to castor there the yaw of the bike hunts)
        // (and while the bike slides sideways, brakes or not: a slide that the brakes started went on with the brakes off while the wheel was held straight)
        var sliding = smooth(4 * DEG, 10 * DEG, Math.abs(Math.atan2(v.v || 0, Math.max(Math.abs(u), 1))));
        var upright = 1 - smooth(8 * DEG, 20 * DEG, Math.abs(state.lean)), onBrake = Math.max(smooth(0.05, 0.3, inp.brakePedal || 0), sliding);
        var comply = Math.max(-0.12, Math.min(0.12, -self.frontComply * slipFront)) * smooth(3, 8, Math.abs(u)) * upright * onBrake;
        self.complied += (comply - self.complied) * Math.min(1, dt / 0.04);
        if (self.v2) return self.steeringV2(v, state, w * geometric + (1 - w) * (steady + counter + self.complied), w, u, dt, steady);
        var wanted = w * geometric + (1 - w) * (steady + counter + self.complied);
        self.steer += (wanted - self.steer) * Math.min(1, dt / 0.05);
        return self.steer;
    };

    // ---- model v2: the bars as a degree of freedom. The rider's only input is a torque on them (a PID on the lean error: to lean to the left the bars go to the right first, countersteering
    // is not coded, it is what the tyres do); the side force of the front tyre's slip angle acts behind the steering axis (trail) and turns the wheel into its slip; a damper. At a walking
    // pace (w) the angle is the command, as before. Right is positive; the lean is to the left.
    this.steeringV2 = function (v, state, kinematic, w, u, dt, steady) {
        // kinematic: the angle the old model gives (the command at a walking pace, then the bend of the lean with a countersteer and the castor of the front wheel). Below kin_from the bars are that;
        // up to kin_to it goes over to the angle of the rider and the tyres. A bike at 20 km/h is not the bike at 100: below about 5 m/s it has to be steered into its fall, above it away from it, and between
        // them the bars do little to the lean; the model that holds there is the old one (the video of a bike that went down on every steer at 20 to 40 km/h).
        var front = v.wheels[0], uu = Math.max(Math.abs(u), 5);
        // the rider steers into the fall and, to start a lean, the other way first: the angle he asks for is the one the bend needs now (steady) plus a gain on the lean error. The error
        // is positive when the bike has to lean further to the left, and the bars go to the right then (countersteering): it is the sign of the loop, not a rule of its own. The gain
        // goes down with the speed (the bars have more say on the lean the faster the bike goes).
        var e = self.targetLean - state.lean;
        // (the bend of the lean that is wanted, not of the one the bike has now: the bike has the lean when its yaw rate is the one that lean needs, tan(lean) = u r / g. With the angle of
        // the lean it has, the loop sat still wherever the lean was, at half of the lean at 140 km/h)
        var wantLean = Math.max(-1.05, Math.min(1.05, self.targetLean));
        var steadyWant = -Math.sign(wantLean) * Math.atan(v.wheelbase * G * Math.tan(Math.abs(wantLean)) / Math.max(u * u, 1)) * smooth(1.5, 4.5, Math.abs(u));
        var eCap = Math.max(-self.riderErrCap, Math.min(self.riderErrCap, e));      // (a rider asks for a little countersteer, not for the whole lean at once)
        // (the gains come down above 15 to 28 m/s: with the full gain the bike weaved on the brake from 140 km/h, a weave of 1.7 Hz that grew until the bike was down (replays of a rider); the angle
        // that the bend needs does the work of the lean at speed, the rider only keeps it up)
        // (only while no lean is asked for: in a bend the full gain tracks the lean, and that was half of it at 140 km/h with the low gain)
        var fastDown = smooth(self.gainDownFrom, self.gainDownTo, Math.abs(u)) * (1 - smooth(2 * DEG, 8 * DEG, Math.abs(self.targetLean)));
        var react = (10 / uu) * (self.riderKa * (1 - (1 - self.riderFastKa) * fastDown) * eCap - self.riderKad * (1 - (1 - self.riderFastKad) * fastDown) * state.rate);
        var ask = steadyWant + Math.max(-self.riderBarsCap, Math.min(self.riderBarsCap, react));
        // flat track: a bike that slides is countersteered by itself, subtly: the bars follow the way the bike moves (the slip angle of the body: the bend itself has 3 to 5 degrees of it, so from 6 degrees), so that the front wheel points along the slide; the sign is minus: a body that points into the bend of a bike that slides out turns the front the other way
        if (pushed() && self.pushSlide) {
            var beta = Math.atan2(v.v || 0, Math.max(Math.abs(u), 2));
            self.slideAsk = self.pushSlide * Math.max(-self.pushSlideCap, Math.min(self.pushSlideCap, beta)) * smooth(6 * DEG, 12 * DEG, Math.abs(beta)) * smooth(6, 12, Math.abs(u)) * smooth(3 * DEG, 10 * DEG, Math.abs(self.targetLean));
            ask += self.slideAsk;
        } else self.slideAsk = 0;      // (and the bars answer a lean error with so much at most: a flick from lock to lock did not throw the tyres)
        var lock = v.input.turnLimit || v.input.maxTurn || 0.38;
        var kin = 1 - smooth(self.kinFrom, self.kinTo, Math.abs(u));      // 1: the angle of the old model, 0: the angle of the rider
        ask = Math.max(-lock, Math.min(lock, ask));
        // the hands: a spring and a damper on the bars, so that what the front tyre does with the trail pushes back (a wobble is damped, a bump is felt)
        var arm = self.steerInertia * self.armOmega * self.armOmega;
        var T = Math.max(-self.riderTorqueMax, Math.min(self.riderTorqueMax, (v.mass / 87) * arm * (ask - self.steerDof))) * (1 - kin);
        var align = front && front.hasContact ? self.trail * (front.fySlip || 0) : 0;
        if (kin > 0.5) { self.steerDof = kinematic; self.steerRate = 0; }
        else {
            // semi-implicit: the damper is solved with the step
            var acc = (T + align) / self.steerInertia;
            self.steerRate = (self.steerRate + acc * dt) / (1 + self.steerDamp / self.steerInertia * dt);
            self.steerDof += self.steerRate * dt;
            if (Math.abs(self.steerDof) > lock) { self.steerDof = Math.sign(self.steerDof) * lock; self.steerRate = 0; }
        }
        self.steerTorque = T; self.steerAlign = align; self.steerAsk = ask;
        self.steer = kin * kinematic + (1 - kin) * self.steerDof;
        return self.steer;
    };

    // ---- hook: the wheelie control (the menu: Wheelie control, on by default): the rider rolls the throttle off as the front wheel goes light, and keeps it there at about a tenth of
    // its load; a bike with a lot of torque from low revs loops over backwards at full throttle otherwise
    this.throttleScale = function (v, dt) {
        if (self.crashed || self.limp) { self.wheelieScale = 0; return 0; }
        var on = option("wheelieControl") !== false;
        var frontLoad = ((v.wheels[0].weight || 0) + (v.wheels[1].weight || 0)) / Math.max(1, v.weight_distribution * v.mass * G);
        var want = on && !v.airborne && Math.abs(v.u) > 0.5 && self.burnout < 0.5 ? Math.max(0.15, Math.min(1, (frontLoad - 0.08) / 0.3)) : 1;      // (not in the air: the gas is what brings the nose up for the landing there)     // (not in a burnout: the front lifts a little there, and the cut let the engine fall to the clutch)
        self.wheelieScale += (want - self.wheelieScale) * Math.min(1, dt / (want < self.wheelieScale ? 0.03 : 0.25));
        // at a walking pace with the bars turned far the throttle is eased to a third: the bike goes round the lock at a walking pace instead of driving on round it
        // (not from a standstill: with the bars at the lock the bike could not get going at all; the ease comes in once it walks)
        var slowLock = smooth(0.3, 1.2, Math.abs(v.u)) * (1 - smooth(2.0, 4.0, Math.abs(v.u))) * smooth(0.6, 0.95, Math.abs(self.command || 0));
        return self.wheelieScale * (1 - 0.67 * slowLock);
    };

    // ---- hook: the brakes. brakeStep once per step of the physics, brakeScale for every wheel
    this.brakeStep = function (v, dt) {
        // a bike that is down slides and tumbles, it does not fly: the road takes its speed (a slide of about half a g), it does not go faster than it went, and it does not spin up
        if (self.crashed) {
            var cs = self.crashSpeed || { x: 0, y: 0, z: 0 }, vmax = Math.sqrt(cs.x * cs.x + cs.z * cs.z) + 1, sp = Math.sqrt(v.vx * v.vx + v.vz * v.vz);
            if (sp > vmax) { v.vx *= vmax / sp; v.vz *= vmax / sp; }
            // (a steady 0.6 g of friction, as the rider that slides beside it has: a bike that lost its speed as a share of it, 3 g at first, caught the rider up from behind and hit him)
            var sp2 = Math.sqrt(v.vx * v.vx + v.vz * v.vz), drop = v.airborne ? 0.1 * dt * sp2 : Math.min(sp2, (5.5 + 0.1 * sp2) * dt);
            if (sp2 > 1e-6) { v.vx -= v.vx / sp2 * drop; v.vz -= v.vz / sp2 * drop; }
            if (v.vy > 3) v.vy = 3;
            var spin = Math.exp(-dt * 2.5), wmax = 8, wl = Math.sqrt(v.wx * v.wx + v.wy * v.wy + v.wz * v.wz);
            v.wx *= spin; v.wy *= spin; v.wz *= spin;
            if (wl > wmax) { v.wx *= wmax / wl; v.wy *= wmax / wl; v.wz *= wmax / wl; }
        }
        var m = v.mass, w = v.wheels;
        var rearRatio = ((w[2].weight || 0) + (w[3].weight || 0)) / Math.max(1, (1 - v.weight_distribution) * m * G);
        // the front brake is let off as the rear wheel is nearly free of the road (it keeps a few percent of its load: the limit of the front brake), the rear brake goes with the load of the rear wheel
        // the rear down to 6 % of its load on a straight (a rider brakes right at the point where the rear comes up), but not while he asks for a lean or the bike slides: a rear with no
        // load has no grip sideways, and a little steering on the brakes at 180 km/h stepped the tail out (a slip of 10 degrees), which was a crash when the brake came off
        var beta = Math.atan2(v.v || 0, Math.max(Math.abs(v.u), 1));
        var minRear = 0.06 + 0.16 * Math.max(smooth(0.15, 0.5, Math.abs(self.command || 0)), smooth(2 * DEG, 6 * DEG, Math.abs(beta)), smooth(3 * DEG, 10 * DEG, Math.abs(v.lean || 0)));
        var bt = self.brakeTune || (self.brakeTune = { ff: 1, ffGain: 0.8, band: 0.16, down: 0.03, up: 0.3, filt: 0.02 });
        // (the load of the rear wheel is noisy: the brake follows a smoothed one)
        self.rearFilt = bt.filt > 0 ? (self.rearFilt === undefined ? rearRatio : self.rearFilt + (rearRatio - self.rearFilt) * Math.min(1, dt / bt.filt)) : rearRatio;
        // (and where it is going: the load of the rear wheel with its rate of change, so that the brake lets off before the rear is up and takes hold before it is down again)
        var rearRate = self.rearPrev === undefined || dt <= 0 ? 0 : (self.rearFilt - self.rearPrev) / dt;
        self.rearPrev = self.rearFilt;
        self.rearRateF = (self.rearRateF || 0) + (rearRate - (self.rearRateF || 0)) * Math.min(1, dt / 0.03);
        var rearPred = self.rearFilt + (bt.td || 0) * self.rearRateF;
        var target = Math.max(0, Math.min(1, (rearPred - minRear) / bt.band));
        // the bike slides sideways under the brakes (the front has no grip left sideways when it brakes with all it has): both brakes come off as the slip grows past 5 degrees, so the
        // tyres can hold the bike straight again (what the cornering ABS of a modern bike does; without it a little steering on the brakes at 180 km/h ended at 40 degrees of slip)
        var slideOff = 1 - 0.9 * smooth(5 * DEG, 12 * DEG, Math.abs(beta));
        target *= slideOff;
        if (bt.ff) {
            // the limit from the force, not from what the rear wheel did a moment ago: the rear wheel keeps its load while the braking force of the road on the bike (what the tyres give: Fx)
            // is below m g (1 - front share) (1 - minRear) wheelbase / (height of the centre of gravity), the weight that the brake can throw onto the front by statics. The brake comes off
            // in proportion as that force goes past it, at once (the force follows the brake in a few hundredths of a second, the rear wheel only after the pitch), and goes back slowly.
            var fxNow = Math.max(0, -((w[0].fxLast || 0) + (w[2].fxLast || 0)));
            var fMax = m * G * (1 - v.weight_distribution) * (1 - minRear) * v.wheelbase / Math.max(0.3, v.cgHeight) * bt.ffGain;
            var kf = fxNow > fMax && fxNow > 1 ? fMax / fxNow : 1;
            if (kf < 1) self.frontBrake += (Math.min(self.frontBrake, target) * kf - self.frontBrake) * Math.min(1, dt / bt.down);
            else self.frontBrake += (target - self.frontBrake) * Math.min(1, dt / bt.up);
            if (rearPred < minRear * 0.5) self.frontBrake *= Math.max(0, 1 - dt / 0.04);
        } else
        self.frontBrake += (target - self.frontBrake) * Math.min(1, dt / (target < self.frontBrake ? bt.down : bt.up));
        // (after a crest the rear wheel comes down hard and it spins faster than the road: the rear brake comes back slowly, so that it does not lock and slide)
        var rearTarget = Math.max(0, Math.min(1, rearRatio * 1.2)) * slideOff;
        // a burnout: the brake and the throttle together at a standstill (or nearly) is the front brake held and the rear wheel let spin; the rear brake comes off
        var inp = v.input, burnout = smooth(0.2, 0.6, inp.throttle || 0) * smooth(0.2, 0.5, inp.brakePedal || 0) * (1 - smooth(2, 5, Math.abs(v.u)));
        self.burnout = burnout;                                                                  // (Vehicle.js: the traction control stays out of a burnout)
        rearTarget *= 1 - burnout;
        self.rearBrake = rearTarget > self.rearBrake ? Math.min(rearTarget, self.rearBrake + dt / 0.3) : rearTarget;
        if (burnout > 0.5) self.frontBrake = Math.max(self.frontBrake, burnout);
    };
    // in a bend the front brake stands the bike up, so it is hardly used (a rider uses the rear brake): from 8 to 30 degrees of lean it goes to a tenth
    this.brakeScale = function (v, wheel) {
        if (self.crashed) return 0;
        var solo = v.soloWheels ? 2 : 1;                                   // (one wheel on an end has the brakes of both)
        if(!wheel.front) return self.rearBrake * solo;
        return self.frontBrake * (1 - 0.9 * smooth(8 * DEG, 30 * DEG, Math.abs(v.lean))) * solo;
    };

    // ---- hook: the body of the bike does not touch the road in a lean (it is no crash until the bike is nearly on its side)
    // (a bike that lost its front or its rear wheel has nothing to stand on there: its spheres touch the road, or it falls through it)
    this.keepBodyOff = function (v) { return !self.crashed && Math.abs(v.lean) < 1.15 && !(v.wheelLost && (v.wheelLost[0] || v.wheelLost[2])); };

    // ---- hook: the rider and the tyres; the forces and the torques of the physics are added to
    this.apply = function (v, force, torque, dt, c) {
        var state = leanOf(v, dt), u = c.u;
        v.lean = state.lean;
        // A crash: the bike is nearly on its side, or a hit (a change of speed of more than 6 g, or more than 2.2 g sideways at speed: a wall, a kerb). From then on the rider does nothing,
        // the bike is a body that slides (Vehicle.js: its spheres touch the road), and the rider is thrown off (Driver.js, a ragdoll), until a reset or a repair (Car.js)
        if (!self.crashed) {
            var aMag = Math.sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z);
            var aLat = accel.x * state.lx + accel.y * state.ly + accel.z * state.lz;
            // a wall: the body of the bike hit something at more than 20 km/h (Vehicle.js: impactTime goes to 0 at a hit, lastImpact is the speed into it); the rider is thrown at the
            // speed the bike had before the hit (not the bounce)
            var wall = v.impactTime < 0.05 && v.lastImpact > 5.5 && v.impactTime !== self.wallHit;
            if (wall) self.wallHit = v.impactTime;
            // a hit that is not a wall of the body (the wheels into a barrier, a kerb): the speed lost in a tenth of a second, more than 8 m/s (over 8 g), at more than 20 km/h before it
            now += dt; hist.push({ t: now, x: v.vx, z: v.vz, px: v.px, pz: v.pz });
            while (hist.length > 2 && hist[1].t < now - 0.1) hist.shift();
            var old = hist[0], last = hist[hist.length - 2] || old;
            // (a reset puts the bike somewhere else at once: that is no hit; the speeds before it are forgotten)
            if (Math.abs(v.px - last.px) + Math.abs(v.pz - last.pz) > 3) { hist.length = 0; hist.push({ t: now, x: v.vx, z: v.vz, px: v.px, pz: v.pz }); old = hist[0]; }
            var speedOld = Math.sqrt(old.x * old.x + old.z * old.z), speedNow = Math.sqrt(v.vx * v.vx + v.vz * v.vz);
            var hit = speedOld - speedNow > 8 && speedOld > 5.5;
            if (hit && !wall) { wall = true; v.lastWall = v.lastWall || {}; v.lastWall.v = [old.x, 0, old.z]; }
            // a wheelie that went over: the bike on its back (its up more than 100 degrees from the road); up to there the tail scrapes and the rear brake can still bring it down
            var over = state.upN < -0.17;
            // a lowside: the bike slides sideways past 15 degrees for half a second while it leans (the tyres have let go; it crabbed along for seconds at the limit of the lean)
            var betaNow = Math.atan2(v.v || 0, Math.max(Math.abs(u), 1));
            // (a powerslide is no lowside: the rear wheel spins under power and the rider holds the bike on the throttle, sliding as long as he likes; it goes down by the lean alone,
            // at crashLean. A slide with the rear wheel rolling is the tyres letting go.)
            var rear = v.wheels && v.wheels[2], powerslide = !!rear && c.throttle > 0.2 && rear.omega * rear.radius - (rear.forwardSpeed || u) > 1.5;
            // (a slide of more than 25 degrees for two seconds, leaning, without power: backing it in, the rear sliding at 45 degrees for a second with the gas shut, is ridden out)
            self.slideTime = Math.abs(betaNow) > 25 * DEG && Math.abs(state.lean) > 25 * DEG && Math.abs(u) > 5 && !powerslide ? self.slideTime + dt : 0;
            var lowside = self.slideTime > 2.0;
            // a spin: the bike turns about its vertical faster than 4 rad/s at speed (a jump landed on a lean: the front took the hit with the rear in the air, and the bike was
            // thrown round in a tenth of a second and went on backwards at 100 km/h)
            var spin = Math.abs(v.wy || 0) > 4 && Math.abs(u) > 5;
            // (a wheel torn off is no crash by itself: the rider can hold the bike up on its fork or its swingarm, which touch the road (keepBodyOff); it goes down when it leans)
            // (an acceleration alone is no crash: the tyres that bite again after a long slide give 4 to 8 g sideways for a moment, and that threw the rider off a slide he had held
            // at 53 degrees; a hit is the body of the bike against something (wall) or a loss of speed (hit). Only a blow of more than 7 g counts by itself.)
            if (Math.abs(state.lean) > (self.limp ? 0.7 : self.crashLean) || (self.limp && Math.abs(u) < 0.5) || over || lowside || spin || aMag > 7 * G || wall) {
                self.crashed = true;
                self.crashReason = Math.abs(state.lean) > (self.limp ? 0.7 : self.crashLean) ? "lean" : (self.limp && Math.abs(u) < 0.5) ? "limp-still" : over ? "over" : lowside ? "lowside" : spin ? "spin" : aMag > 7 * G ? "accel " + (aMag / G).toFixed(1) + "g" : hit ? "hit " + (speedOld - speedNow).toFixed(1) : "wall";     // (for the debugging)
                var before = wall && v.lastWall && v.lastWall.v ? v.lastWall.v : null;
                self.crashSpeed = before ? { x: before[0], y: before[1], z: before[2] } : { x: v.vx, y: v.vy, z: v.vz };
            }
        }
        if (self.crashed) {
            self.posture.lat = self.posture.knee = self.posture.tuck = self.posture.sit = 0;
            // a bike that is down but still stands (a crash at a standstill, the key 9 while it stands: nothing holds it up, but its wheels on their narrow track did): it falls over,
            // to the side it leans to already (the right, where it rested on the foot, when it stands straight)
            if (Math.abs(u) < 3 && Math.abs(state.lean) < 1.0) {
                var side = state.lean < -0.01 ? -1 : 1, fall = 0.6 * v.mass * G * v.cgHeight;
                torque.x -= state.ax * side * fall; torque.y -= state.ay * side * fall; torque.z -= state.az * side * fall;
            }
            return;
        }
        if (self.limp) {
            // the rider does nothing: the bike has only its own balance (none: it leans over as his weight hangs off it) and the castor of the front wheel. His weight is on the bike already
            // (the mass of the rider is in the mass of the bike); what leans it is that weight off the middle: the torque of the middle of the body about the centre of gravity
            self.posture.lat = self.posture.knee = self.posture.tuck = self.posture.sit = 0;
            var L = self.riderLoad;
            if (L) {
                var rx = L.x - v.px, rz = L.z - v.pz, Fy = -self.riderMass * G, arm = Math.sqrt(rx * rx + rz * rz);
                if (arm > 0.5) { rx *= 0.5 / arm; rz *= 0.5 / arm; }                                 // (a body that hangs further than half a metre off the bike is off it: no more leverage)
                torque.x += -rz * Fy; torque.z += rx * Fy;
            }
            vPrev = null;
        }
        // a landing: after a flight of a quarter second or more the rider braces for the touchdown, and for a short while after it he holds the bike harder (the balance and the
        // yaw damping stronger): a bike that landed a little off line was thrown into a lean and a spin by the kick of the tyres and went down
        // (Vehicle.js counts the flight: this runs on the road only)
        if (v.lastFlight > 0.25 && v.lastFlight !== self.lastFlightSeen) { self.brace = 0.8; self.lastFlightSeen = v.lastFlight; }
        if (self.brace > 0) self.brace -= dt;
        var brace = self.brace > 0 ? 1 + 1.0 * Math.min(1, self.brace / 0.5) : 1;
        var alive = 1 - Math.min(1, Math.max(0, (Math.abs(state.lean) - 1.2) / 0.25));         // past about 69 degrees the bike is going down: the rider lets go
        if (!self.limp) {                                                                        // (a limp rider: none of this; the tyres below still give their camber thrust)
        self.rider(v, torque, dt, u, state);
        var m = v.mass, gh = m * G * v.cgHeight;
        var kp = self.balance * 10 * gh, inertia = m * v.cgHeight * v.cgHeight + c.inertiaZ, kd = 1.5 * Math.sqrt(kp * inertia);
        // (a walking pace with the bars at the lock is a tight circle that the rider holds up, as he does in a U-turn: the balance used to fade there and the bike leaned in and went
        // over, and with the feet up and down around 5 km/h that was a bike that fell to 58 degrees, was thrown round by its rear tyre, stood up and did it again every two seconds)
        kp *= brace; kd *= brace;
        var T = kp * (self.targetLean - state.lean) - kd * state.rate;                           // about the axis that leans it to the left
        T = alive * Math.max(-6 * gh * brace, Math.min(6 * gh * brace, T));
        if (self.v2) T *= 1 - smooth(self.balanceFrom, self.balanceTo, Math.abs(u));          // (model v2: from 7 m/s the rider keeps the bike up with the bars only; the torque about the long axis is for a walking pace)
        torque.x -= state.ax * T; torque.y -= state.ay * T; torque.z -= state.az * T;
        // The body of the rider helps where the bars cannot (model v2, and the keys of a keyboard are not a pair of hands): with the front wheel light or in the air the bars do not steer the lean at all,
        // and when the lean has got far from what he asked for (or runs away from it) he throws his weight to the one side or the other, as a rider does in a wheelie or a slide. It is the weight of
        // the rider moved out to the side (`body_arm`, about half a metre with the body leaned over): a torque about the long axis of at most mass x g x arm, a spring and a damper on the lean error.
        // It is nothing in a bend that goes as asked (the share is 0), and it is there in full when the front wheel is up.
        var assistT = 0, assistW = 0;
        if (self.v2 && self.bodyAssist > 0) {
            var errL = self.targetLean - state.lean, rateL = state.rate;
            var runaway = smooth(self.assistErrFrom, self.assistErrTo, Math.abs(errL)) * (errL * rateL < 0 ? 1 : 0.5);      // (the lean is going away from the target, or just far from it)
            assistW = self.bodyAssist * Math.max(1 - smooth(0.05, 0.5, ((v.wheels[0].weight || 0) + (v.wheels[1].weight || 0)) / Math.max(1, v.weight_distribution * v.mass * G)), runaway)
                * smooth(self.balanceFrom, self.balanceTo, Math.abs(u)) * alive;
            if (assistW > 0.001) {
                var akp = 2 * gh, akd = 1.2 * Math.sqrt(akp * inertia), aMax = self.riderMass * G * self.bodyArm;
                assistT = assistW * Math.max(-aMax, Math.min(aMax, akp * errL - akd * rateL));
                torque.x -= state.ax * assistT; torque.y -= state.ay * assistT; torque.z -= state.az * assistT;
            }
            self.posture.assist += (Math.max(-0.5, Math.min(0.5, assistT / (self.riderMass * G))) - self.posture.assist) * Math.min(1, dt / 0.12);      // (where the weight goes, for the model of the rider)
        }
        // The same forward and back: a front wheel that goes up past the balance point (a power wheelie in first gear, the wheelie control off) he brings down with his weight forward over the tank,
        // a torque about the left axis of at most mass x g x `pitch_arm` (the keys for the rider forward and back do it too, in full); on its own from 20 degrees of nose up in 0.15 s (in full at 37), the nose rate he sees included
        if (self.v2 && self.pitchAssist > 0 && !v.airborne) {
            var key = self.riderKey > 0 ? 1 : self.riderKey < 0 ? -1 : 0;
            var noseRate = -(v.wx * state.lx + v.wy * state.ly + v.wz * state.lz);      // (the nose up, rad/s: he sees it come and goes forward before it is there: where it will be in 0.15 s)
            var autoP = smooth(0.34, 0.6, state.noseUp + self.pitchLead * noseRate * Math.sqrt(Math.max(0, 1 - state.noseUp * state.noseUp)));
            var pT = self.pitchAssist * self.riderMass * G * self.pitchArm * (key !== 0 ? key : autoP);
            if (Math.abs(pT) > 0.01) { torque.x += state.lx * pT; torque.y += state.ly * pT; torque.z += state.lz * pT; }
            self.pitchTq = pT;
        }
        // Flat track: on the gas in a bend the rear tyre gives up a part of its grip across (what the power takes from it, and the rider's weight forward and out of the bike): the tail steps out, the body
        // of the bike points further into the bend than it goes, and the bars follow the slide (slideAsk). It comes back with the gas, over a fifth of a second.
        var driftT = pushed() && self.pushDrift > 0 && !self.limp ? self.pushDrift * smooth(0.45, 0.9, (v.input.throttle || 0) * (self.wheelieScale || 1)) * smooth(12 * DEG, 28 * DEG, Math.abs(state.lean)) * (1 - smooth(18, 30, Math.abs(u))) : 0;
        self.drift += (driftT - self.drift) * Math.min(1, dt / 0.2);
        for (var wi = 0; wi < 4; wi++) if (!v.wheels[wi].front) { var rw = v.wheels[wi]; if (rw.lateralGripBase === undefined) rw.lateralGripBase = rw.lateralGrip; rw.lateralGrip = rw.lateralGripBase * (1 - self.drift); }
        // the yaw that the steering did not ask for is damped
        var fast = smooth(1.5, 4.5, Math.abs(u));
        // the front wheel in the air (a wheelie): it does not steer, the lean does. A bike that leans turns at g tan(lean) / u, and the rider takes it round at that rate
        var frontLoad = ((v.wheels[0].weight || 0) + (v.wheels[1].weight || 0)) / Math.max(1, v.weight_distribution * v.mass * G);
        var lift = 1 - smooth(0.05, 0.5, frontLoad);
        self.dbg = { T: T, yawDamp: 0, yawLift: 0, lift: lift, assist: assistW, assistT: assistT, pitchT: self.pitchTq || 0 };
        // The rider keeps the bike turning at the rate that its lean gives (a balanced bend: r = g tan(lean) / u): a torque about the vertical against the yaw that the tyres make on their own
        // (a front that is loaded on the brake and a light rear would swing the tail out, as a car oversteers). With the front wheel in the air it is all there is.
        // (model v2: only on the brake. The old model damped the yaw that the steering did not ask for all the time; v2 leaves it to the tyres, but a bike on the brake has a light rear wheel and
        // yaws at 1 rad/s and more, back and forth (the replays of a rider at 100 to 140 km/h, a weave of the whole bike with the bars still): the rider holds it with his knees and the bars, here a torque
        // about the vertical against the yaw that the lean does not give)
        var yawOn = self.v2 ? self.yawBrake * smooth(0.05, 0.3, v.input.brakePedal || 0) : 1;
        if (Math.abs(u) > 2 && yawOn > 0) {
            var epsNow = Math.atan((self.riderMass / v.mass) * self.posture.lat / v.cgHeight);       // (the rider that hangs off: the lean of the whole)
            var rLean = -G * Math.tan(Math.max(-1.2, Math.min(1.2, state.lean + epsNow))) / Math.max(Math.abs(u), 4);
            var yawErr = c.r - rLean;
            // (on the brakes the rider holds the bars harder: with the rear nearly off the road the front alone turned the bike 14 degrees out of line in a second at 145 km/h)
            var yawCap = (self.yawCap + self.yawCapBrake * smooth(0.2, 0.8, v.input.brakePedal || 0)) * brace;
            self.dbg.yawDamp = yawOn * Math.max(-yawCap, Math.min(yawCap, self.balance * (c.inertiaY / 0.06) * yawErr * fast * brace * (1 + 2 * smooth(0.2, 0.8, v.input.brakePedal || 0))));
            torque.y += self.dbg.yawDamp;
        }
        // no reverse gear: the rider walks the bike back (Car.js says when), slowly, with a small force
        if(self.pushing) {
            var pushF = Math.max(-900, Math.min(900, v.mass * 3 * (-1.2 - u)));
            force.x += state.fx * pushF; force.z += state.fz * pushF;
        } else if(u < -0.05 && u > -2 && !(v.input.throttle > 0.05)) {
            // the push has stopped: the rider holds the bike with his feet and it stops
            var holdF = Math.min(700, v.mass * 4 * -u);
            force.x += state.fx * holdF; force.z += state.fz * holdF;
        }
        }
        // The camber thrust: a leaned tyre pushes the bike to the inside of the bend by itself, with its load times tan(lean) (a round tyre gives nearly all of the sideways force of a
        // bend this way, so the slip angles stay small and a light rear does not step out). At the contact patch of every wheel, so that it is balanced front and rear by the loads and
        // it rights the bike (a torque about the centre of gravity), as the real thing does.
        // (the whole of it is shared between the front and the rear as the weight of the bike is at rest, not as the loads are now: the weight that the brake or the gas moves to one end
        // would otherwise turn the camber thrust into a yaw, a bike that tightens its line hard when the throttle is shut at speed, and the rider lost it)
        var camber = self.v2 ? 0 : self.camberThrust * Math.tan(Math.max(-1.05, Math.min(1.05, state.lean))) * alive, loadAll = 0;
        for (var i = 0; i < 4; i++) if (v.wheels[i].hasContact) loadAll += v.wheels[i].weight || 0;
        for (var i = 0; i < 4; i++) {
            var w = v.wheels[i];
            if (!w.hasContact || !(w.weight > 0) || !w.center) continue;
            var shareW = loadAll * 0.5 * (w.front ? v.weight_distribution : 1 - v.weight_distribution);
            var fcx = camber * shareW * state.lx, fcy = camber * shareW * state.ly, fcz = camber * shareW * state.lz;
            var n = w.normal || { nx: 0, ny: 1, nz: 0 };
            var rx = w.center.x - n.nx * w.radius - v.px, ry = w.center.y - n.ny * w.radius - v.py, rz = w.center.z - n.nz * w.radius - v.pz;
            force.x += fcx; force.y += fcy; force.z += fcz;
            torque.x += ry * fcz - rz * fcy; torque.y += rz * fcx - rx * fcz; torque.z += rx * fcy - ry * fcx;
        }
    };

    // ---- the rider on the bike: where he sits, from what the bike does, and what his weight does to the bike
    var inputOf = function (v) { var i = v.input; return { thr: Math.max(0, Math.min(1, i.throttle || 0)), brk: Math.max(0, Math.min(1, i.brakePedal || 0)) }; };
    // the feet at a standstill: the bike stays upright and both feet go down to the road (below 4 km/h; they stay down until 5 km/h); above 5 km/h they go back to the pegs in a second,
    // the left foot first (over 0.7 s), the right foot a third of a second later (over 0.7 s)
    this.feetStep = function (dt, u, noseUp, allowed, snap) {
        var speed = Math.abs(u) * 3.6;
        if (!allowed || noseUp >= 0.5 || speed > 5) self.footStill = false; else if (speed < 4) self.footStill = true;
        if (snap) { self.footWait = 0; self.footDownL = self.footDown = self.footStill ? 1 : 0; return; }
        if (self.footStill) { self.footWait = 0; self.footDownL = Math.min(1, self.footDownL + dt / 0.7); self.footDown = Math.min(1, self.footDown + dt / 0.7); }
        else {
            self.footWait += dt;
            self.footDownL = Math.max(0, self.footDownL - dt / 0.7);
            if (self.footWait > 0.3) self.footDown = Math.max(0, self.footDown - dt / 0.7);
        }
    };
    // the posture of the rider from what the bike does (also for a replay, which has no physics: the lean and the pedals of the recording)
    this.postureStep = function (dt, u, thr, brk, lean) {
        var p = self.posture, i = { thr: thr, brk: brk }, fwdSpeed = Math.max(0, u);
        var tuck = i.thr * smooth(12, 35, fwdSpeed) * (1 - i.brk), sit = i.brk * smooth(4, 20, fwdSpeed);
        if(self.riderKey) { tuck = self.riderKey > 0 ? 1 : 0; sit = self.riderKey < 0 ? 1 : 0; }
        var bendT = smooth(8 * DEG, 40 * DEG, Math.abs(lean)) * smooth(5, 12, Math.abs(u));
        // at speed the rider hangs off for a small lean already (from 110 km/h, fully at 180): his weight to the inside turns the bike where it hardly leans at that speed
        var hangT = Math.max(bendT, smooth(3 * DEG, 12 * DEG, Math.abs(lean)) * smooth(30, 50, Math.abs(u)));
        var hang = Math.sign(lean) * hangT;
        var k = function (t) { return Math.min(1, dt / t); };
        p.tuck += (tuck - p.tuck) * k(0.35); p.sit += (sit - p.sit) * k(0.25);
        var push = pushed();
        p.lat += (hang * self.maxHang * (push ? self.pushHang : 1) - p.lat) * k(0.25); p.knee += ((push ? 0 : bendT) - p.knee) * k(0.3);
        // the flat-track style: the inside foot comes out in a bend at a low and a middle speed (a lean of 8 degrees and more, below `push_foot_kmh`), the inside elbow goes up; `inside` is the side of the bend either way
        var pushT = push ? smooth(8 * DEG, 25 * DEG, Math.abs(lean)) * (1 - smooth(0.8 * self.pushFoot, self.pushFoot, Math.abs(u))) * smooth(1.5, 4, Math.abs(u)) : 0;
        p.push += (pushT - p.push) * k(0.25); p.lean += (lean - p.lean) * k(0.15); p.flat += ((push ? 1 : 0) - p.flat) * k(0.3); p.inside += (Math.sign(lean) * smooth(2 * DEG, 8 * DEG, Math.abs(lean)) - p.inside) * k(0.2);
        p.long += ((-0.22 * sit + 0.12 * tuck) - p.long) * k(0.3);
        p.drop += ((-0.09 * tuck + 0.05 * sit) - p.drop) * k(0.3);
        // the head looks where the bike is going: into the bend (the lean that is asked, so a little ahead of the bike), and straight on a straight; it comes round a little before the bike does
        p.look += (Math.max(-1, Math.min(1, lean / (35 * DEG))) * smooth(2, 6, Math.abs(u)) - p.look) * k(0.2);
    };
    // a replay: the posture and the foot from the recording (the lean of the body, the speed and the pedals), nothing else
    this.replayStep = function (v, dt, thr, brk, snap) {
        var state = leanOf(v, 0), u = v.u;
        v.lean = state.lean;
        self.targetLean = state.lean;
        self.feetStep(dt, u, state.noseUp, true, snap);
        self.postureStep(snap ? 10 : dt, u, thr, brk, state.lean);
    };
    this.rider = function (v, torque, dt, u, state) {
        var p = self.posture, i = inputOf(v), fwdSpeed = Math.max(0, u);
        self.postureStep(dt, u, i.thr, i.brk, self.targetLean);
        // the acceleration of the bike, from how its speed changes (smoothed): the rider's weight is gravity less that
        if(vPrev && dt > 0) {
            var kk = Math.min(1, dt / 0.08);
            accel.x += (Math.max(-3 * G, Math.min(3 * G, (v.vx - vPrev.x) / dt)) - accel.x) * kk;
            accel.y += (Math.max(-3 * G, Math.min(3 * G, (v.vy - vPrev.y) / dt)) - accel.y) * kk;
            accel.z += (Math.max(-3 * G, Math.min(3 * G, (v.vz - vPrev.z) / dt)) - accel.z) * kk;
        } else vPrev = { x: 0, y: 0, z: 0 };
        vPrev.x = v.vx; vPrev.y = v.vy; vPrev.z = v.vz;
        // the torque of a rider who is not where the centre of gravity of the bike was made for: m d x (g - a). The lean has its own rider (and the lean of the bike is set from the hang off
        // above), so the part about the long axis of the bike is left out
        rotate(v, p.lat, p.drop, p.long, dw);
        var gx = -accel.x, gy = -G - accel.y, gz = -accel.z;
        self.weight.x = gx; self.weight.y = gy; self.weight.z = gz;         // (for the debug view: the weight of the rider per kg, gravity less the acceleration)
        var tx = self.riderMass * (dw.y * gz - dw.z * gy), ty = self.riderMass * (dw.z * gx - dw.x * gz), tz = self.riderMass * (dw.x * gy - dw.y * gx);
        var along = tx * state.ax + ty * state.ay + tz * state.az;
        torque.x += tx - along * state.ax; torque.y += ty - along * state.ay; torque.z += tz - along * state.az;
    };

    // The head looks along the racing line, not along the bars: from a point on the line ahead of the bike (a second of riding at least 8 m and at most 45 m ahead, the nearest point of the line
    // found from the last one), the angle between the way the bike points and the way to that point is the turn of the head (degrees, to the left positive, at most 60). Without a line (a track
    // that has none, the replay) the head looks into the bend by the lean that is asked, as before. Called every frame from Car.js, with the line of the race (race.line).
    var lineHint = -1;
    this.lineLook = function (line, v, dt) {
        var p = self.posture, on = 0, target = 0;
        if (line && line.points && line.points.length > 4 && !self.crashed && Math.abs(v.u) > 3) {
            var n = line.points.length, i0 = line.nearest(v.x, v.z, lineHint >= 0 ? lineHint : undefined);
            lineHint = i0;
            var ahead = Math.max(8, Math.min(45, Math.abs(v.u) * 1.0)), k = Math.max(1, Math.round(ahead / (line.step || 2)));
            var pt = line.points[line.closed ? (i0 + k) % n : Math.min(n - 1, i0 + k)];
            var fx = 2 * (v.qx * v.qz + v.qy * v.qw), fz = 1 - 2 * (v.qx * v.qx + v.qy * v.qy);          // (the way the bike points, flat)
            var lx = 1 - 2 * (v.qy * v.qy + v.qz * v.qz), lz = 2 * (v.qx * v.qz - v.qy * v.qw);          // (its left, flat)
            var fl = Math.hypot(fx, fz) || 1, ll = Math.hypot(lx, lz) || 1; fx /= fl; fz /= fl; lx /= ll; lz /= ll;
            var dx = pt.x - v.x, dz = pt.z - v.z;
            target = Math.max(-60, Math.min(60, Math.atan2(dx * lx + dz * lz, dx * fx + dz * fz) / DEG));
            on = 1;
        }
        var k2 = Math.min(1, (dt || 0.016) / 0.15);
        p.lineYaw += (target - p.lineYaw) * k2; p.hasLine += (on - p.hasLine) * Math.min(1, (dt || 0.016) / 0.3);
    };

    // the drag of the air: a rider that sits up (on the brake) has more of it, one that lies flat (on the throttle) has less
    this.dragScale = function () { return 1 + 0.35 * self.posture.sit - 0.3 * self.posture.tuck; };

    // ---- hook for the camera: it rolls with the lean, a part of it, smoothed. camera: the three.js camera, after it was placed
    // after a reset or a repair: the rider is back on the bike
    this.recover = function () { hist.length = 0; self.slideTime = 0; self.crashed = false; self.limp = false; self.riderLoad = null; self.footDown = 0; self.footDownL = 0; self.footStill = false; self.footWait = 0; self.brace = 0; self.lastFlightSeen = 0; self.targetLean = 0; self.steer = 0; self.wheelieScale = 1; vPrev = null; accel.x = accel.y = accel.z = 0; };

    this.cameraRoll = function (camera, v, dt) {
        var classic = typeof Settings !== "undefined" && Settings.option("bikeCamera") === "classic";       // (the menu: the chase camera of a car, that does not roll)
        self.roll += ((classic ? 0 : v.lean * self.cameraRollFactor) - self.roll) * Math.min(1, (dt || 0.016) / 0.12);
        camera.rotateZ(self.roll);
    };
};

// The mass of the rider of a motorcycle (car.json "motorcycle.rider_mass", 80 kg), which is on top of the "mass" of the bike; 0 for a car
OpenRacer.Motorcycle.riderMass = function (config) {
    if(!config || config.type !== "motorcycle") return 0;
    var m = config.motorcycle && config.motorcycle.rider_mass;
    return m !== undefined ? m : 80;
};

// The rider of the skidpad (main.js, and the bench): the angle that asks the lean of the bend (leanFromBend: tan(delta) = L a / u^2, the lean atan(a / g)) for a circle of radius R about the
// origin. a is the acceleration that the circle needs (u^2 / R) plus a correction that grows with the distance to the line and the speed across it (a spring and a damper in m/s^2: the
// further from the line the more lean, critically damped so that the rider does not swing round it), plus a slow trim for what the lean does not give (the acceleration the bike really has,
// from the turn of its course). st holds the state (trim, ayTrue, course); tune: w0 (the natural rate of the correction, rad/s), ki (the trim), cap (the most correction, m/s^2).
OpenRacer.Motorcycle.circleSteer = function (st, v, R, speed, dt, tune) {
    tune = tune || {};
    var w0 = tune.w0 !== undefined ? tune.w0 : 1.5, ki = tune.ki !== undefined ? tune.ki : 1.2, cap = tune.cap !== undefined ? tune.cap : 5;
    var vh = Math.hypot(v.vx, v.vz), course = Math.atan2(v.vx, v.vz);
    if(st.course !== undefined && vh > 2 && dt > 0) {
        var dc = Math.atan2(Math.sin(course - st.course), Math.cos(course - st.course));
        st.ayTrue = (st.ayTrue || 0) + (vh * Math.abs(dc) / dt - (st.ayTrue || 0)) * Math.min(1, dt / 0.15);
    }
    st.course = course;
    var r = Math.hypot(v.x, v.z), rv = r > 0.5 ? (v.x * v.vx + v.z * v.vz) / r : 0;      // (the distance to the middle, and the speed outwards)
    var corr = Math.max(-cap, Math.min(cap, w0 * w0 * (r - R) + 2 * w0 * rv));
    var aRef = speed * speed / R + corr;
    st.trim = Math.max(-6, Math.min(6, (st.trim || 0) + ki * Math.max(-2, Math.min(2, aRef - (st.ayTrue || 0))) * dt * (speed > 4 ? 1 : 0)));
    var aWanted = aRef + st.trim;
    return Math.atan(v.wheelbase * Math.max(0, aWanted) / Math.max(speed * speed, 36));
};

// The options of the menu that a bike reads (see options in the controller)
OpenRacer.Motorcycle.OPTIONS = ["bikeFastLean", "bikeSteering", "wheelieControl", "bikePush"];
