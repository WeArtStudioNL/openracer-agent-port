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
    this.maxLean = (s.max_lean_deg || 60) * DEG;
    this.overLean = (s.over_lean_deg !== undefined ? s.over_lean_deg : 10) * DEG;   // how far past what the tyres hold the rider can lean it: past that the tyres let go (a lowside)
    this.crashLean = (s.crash_lean_deg || 63) * DEG;                                   // from here the bike is down
    this.balance = s.balance || 1;
    this.leanResponse = s.lean_response || 0.1;          // s: how fast the lean follows what is asked
    this.camberThrust = s.camber_thrust !== undefined ? s.camber_thrust : 0.85;     // the part of load * tan(lean) that a leaned tyre gives by itself (a round tyre: nearly all of it)
    this.standUp = s.throttle_stand_up !== undefined ? s.throttle_stand_up : 0.18;
    this.cameraRollFactor = s.camera_roll !== undefined ? s.camera_roll : 0.45;
    this.keyRate = s.key_steer_rate || 2;                    // how much faster the steering keys bring the lean command than they turn the wheels of a car
    this.cornerBrake = s.corner_brake !== undefined ? s.corner_brake : 0.2;    // how much further the bike leans into the bend on the rear brake
    this.riderMass = s.rider_mass !== undefined ? s.rider_mass : 80;
    this.maxHang = s.hang_off !== undefined ? s.hang_off : 0.3;                    // m: how far the rider hangs off the seat to the inside of a bend
    this.posture = { lat: 0, long: 0, drop: 0, tuck: 0, sit: 0, knee: 0 };       // body space: lat to the left, long forward, drop up (m); tuck, sit, knee: 0 to 1
    var vPrev = null, accel = { x: 0, y: 0, z: 0 }, dw = { x: 0, y: 0, z: 0 };
    this.riderKey = 0;                                      // -1: the rider is put back, 1: forward (keys, set by Car.js)
    this.sinceBrake = 99; this.counterGain = 1;
    this.counterWait = s.counter_wait !== undefined ? s.counter_wait : 1.0;      // s after the brake before the countersteering starts to come back
    this.counterRamp = s.counter_ramp !== undefined ? s.counter_ramp : 1.5;      // s in which it comes back
    this.fastFrom = s.fast_from !== undefined ? s.fast_from : 38;                  // m/s: from this speed the lean that the keys can ask for goes down
    this.fastLean = (s.fast_lean_deg !== undefined ? s.fast_lean_deg : 30) * DEG;   // the lean it can still ask for at fast_from + 22 m/s (it was 18 degrees: the bike hardly steered at 200 km/h)
    this.gripG = s.grip_g !== undefined ? s.grip_g : 1.05;                        // the lateral g that the tyres give when nothing else is asked of them
    this.frontComply = s.front_comply !== undefined ? s.front_comply : 3;            // how much the front wheel castors into its own slip on the brake (3: it keeps a quarter of the slip angle)
    this.complied = 0;
    this.footDownL = 0; this.footStill = false; this.footWait = 0;       // the left foot (footDown is the right one), whether the bike is at a standstill, and the time since the feet should come up
    this.footDown = 0;                                       // 0 to 1: the right foot of the rider on the road (a standstill)
    this.noFoot = false;                                     // the car editor: the bike stands upright on its bench, the foot never goes down
    this.footLean = (s.foot_lean_deg !== undefined ? s.foot_lean_deg : 7) * DEG;   // how far the bike rests to the right on the foot
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
    this.command = 0;                                      // the lean that is asked (-1..1)
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
        var cap = Math.atan(u * u * Math.tan(lock) / (v.wheelbase * G));
        // the lean of the whole (the bike and the rider that hangs off): tan(phi) = a / g. The bike itself leans phi less atan(share * hang off / height of the centre of gravity)
        var share = self.riderMass / v.mass, epsFull = Math.atan(share * self.maxHang / v.cgHeight);
        var eps = Math.atan(share * self.posture.lat / v.cgHeight);       // to the left: positive
        // at speed the tyres have to give a slip angle for every bit of lean, and the body crabs: past about 40 m/s the lean that is allowed goes down (to 18 degrees at 60 m/s), so that a key
        // held at 190 km/h is a gentle bend and not a slide
        var fastLean = typeof Settings !== "undefined" && Settings.option("bikeFastLean") ? Settings.option("bikeFastLean") * DEG : self.fastLean;      // (the menu: Motorcycle: lean at top speed)
        var speedMax = self.maxLean - (self.maxLean - Math.min(self.maxLean, fastLean)) * smooth(self.fastFrom, self.fastFrom + 22, Math.abs(u));
        // the tyres have so much grip, and what they give along the bike (the engine, the air, the brake: how much the speed goes down) they cannot give sideways: the circle of grip
        var aLong = Math.max(0, -(accel.x * state.fx + accel.z * state.fz)), gripMax = self.gripG * G;
        speedMax = Math.min(speedMax, Math.atan(Math.sqrt(Math.max(0, gripMax * gripMax - aLong * aLong)) / G) + self.overLean);     // (a little past the grip: that is the lowside)
        var phiMax = speedMax + epsFull;
        var want = -c * Math.min(phiMax, cap) * fast;
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
        self.targetLean += (bikeWant - self.targetLean) * Math.min(1, dt / self.leanResponse);
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
        var pulse = typeof Settings !== "undefined" && Settings.option("bikeSteering") === "counter" ? self.counterGain : 0;
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
        var wanted = w * geometric + (1 - w) * (steady + counter + self.complied);
        self.steer += (wanted - self.steer) * Math.min(1, dt / 0.05);
        return self.steer;
    };

    // ---- hook: the wheelie control (the menu: Wheelie control, on by default): the rider rolls the throttle off as the front wheel goes light, and keeps it there at about a tenth of
    // its load; a bike with a lot of torque from low revs loops over backwards at full throttle otherwise
    this.throttleScale = function (v, dt) {
        if (self.crashed || self.limp) { self.wheelieScale = 0; return 0; }
        var on = typeof Settings === "undefined" || Settings.option("wheelieControl") !== false;
        var frontLoad = ((v.wheels[0].weight || 0) + (v.wheels[1].weight || 0)) / Math.max(1, v.weight_distribution * v.mass * G);
        var want = on && Math.abs(v.u) > 0.5 && self.burnout < 0.5 ? Math.max(0.15, Math.min(1, (frontLoad - 0.08) / 0.3)) : 1;     // (not in a burnout: the front lifts a little there, and the cut let the engine fall to the clutch)
        self.wheelieScale += (want - self.wheelieScale) * Math.min(1, dt / (want < self.wheelieScale ? 0.03 : 0.25));
        // at a walking pace with the bars turned far the throttle is eased: the bike slows in the turn instead of driving on round it
        var slowLock = (1 - smooth(2.0, 4.0, Math.abs(v.u))) * smooth(0.6, 0.95, Math.abs(self.command || 0));
        return self.wheelieScale * (1 - 0.92 * slowLock);
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
            self.slideTime = Math.abs(betaNow) > 15 * DEG && Math.abs(state.lean) > 25 * DEG && Math.abs(u) > 5 ? self.slideTime + dt : 0;
            var lowside = self.slideTime > 0.5;
            // a spin: the bike turns about its vertical faster than 4 rad/s at speed (a jump landed on a lean: the front took the hit with the rear in the air, and the bike was
            // thrown round in a tenth of a second and went on backwards at 100 km/h)
            var spin = Math.abs(v.wy || 0) > 4 && Math.abs(u) > 5;
            // (a wheel torn off is no crash by itself: the rider can hold the bike up on its fork or its swingarm, which touch the road (keepBodyOff); it goes down when it leans)
            if (Math.abs(state.lean) > (self.limp ? 0.7 : self.crashLean) || (self.limp && Math.abs(u) < 0.5) || over || lowside || spin || aMag > 3.5 * G || (Math.abs(aLat) > 3 * G && Math.abs(u) > 5) || wall) {
                self.crashed = true;
                self.crashReason = Math.abs(state.lean) > (self.limp ? 0.7 : self.crashLean) ? "lean" : (self.limp && Math.abs(u) < 0.5) ? "limp-still" : over ? "over" : lowside ? "lowside" : spin ? "spin" : aMag > 3.5 * G ? "accel " + (aMag / G).toFixed(1) + "g" : (Math.abs(aLat) > 3 * G && Math.abs(u) > 5) ? "lateral" : hit ? "hit " + (speedOld - speedNow).toFixed(1) : "wall";     // (for the debugging)
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
        var alive = 1 - Math.min(1, Math.max(0, (Math.abs(state.lean) - 1.15) / 0.25));         // past about 66 degrees the bike is going down: the rider lets go
        if (!self.limp) {                                                                        // (a limp rider: none of this; the tyres below still give their camber thrust)
        self.rider(v, torque, dt, u, state);
        var m = v.mass, gh = m * G * v.cgHeight;
        var kp = self.balance * 10 * gh, inertia = m * v.cgHeight * v.cgHeight + c.inertiaZ, kd = 1.5 * Math.sqrt(kp * inertia);
        // at a walking pace with the bars turned far the rider cannot hold the bike up: the balance fades and it leans into the turn and goes down (unless the foot is down: standing)
        var slowLock = (1 - smooth(2.0, 4.0, Math.abs(u))) * smooth(0.6, 0.95, Math.abs(self.command || 0)) * (1 - Math.max(self.footDown, self.footDownL));
        kp *= 1 - 0.98 * slowLock; kd *= 1 - 0.8 * slowLock;
        var T = kp * (self.targetLean - state.lean) - kd * state.rate;                           // about the axis that leans it to the left
        T -= slowLock * 0.5 * gh * Math.sign(self.command || 0);                              // (and it leans into the turn: a bike that crawls with the bars at the lock goes over to the inside; left is a negative command and a positive T)
        T = alive * Math.max(-6 * gh, Math.min(6 * gh, T));
        torque.x -= state.ax * T; torque.y -= state.ay * T; torque.z -= state.az * T;
        // the yaw that the steering did not ask for is damped
        var fast = smooth(1.5, 4.5, Math.abs(u));
        // the front wheel in the air (a wheelie): it does not steer, the lean does. A bike that leans turns at g tan(lean) / u, and the rider takes it round at that rate
        var frontLoad = ((v.wheels[0].weight || 0) + (v.wheels[1].weight || 0)) / Math.max(1, v.weight_distribution * v.mass * G);
        var lift = 1 - smooth(0.05, 0.5, frontLoad);
        self.dbg = { T: T, yawDamp: 0, yawLift: 0, lift: lift };
        // The rider keeps the bike turning at the rate that its lean gives (a balanced bend: r = g tan(lean) / u): a torque about the vertical against the yaw that the tyres make on their own
        // (a front that is loaded on the brake and a light rear would swing the tail out, as a car oversteers). With the front wheel in the air it is all there is.
        if (Math.abs(u) > 2) {
            var epsNow = Math.atan((self.riderMass / v.mass) * self.posture.lat / v.cgHeight);       // (the rider that hangs off: the lean of the whole)
            var rLean = -G * Math.tan(Math.max(-1.2, Math.min(1.2, state.lean + epsNow))) / Math.max(Math.abs(u), 4);
            var yawErr = c.r - rLean;
            // (on the brakes the rider holds the bars harder: with the rear nearly off the road the front alone turned the bike 14 degrees out of line in a second at 145 km/h)
            var yawCap = self.yawCap + self.yawCapBrake * smooth(0.2, 0.8, v.input.brakePedal || 0);
            self.dbg.yawDamp = Math.max(-yawCap, Math.min(yawCap, self.balance * (c.inertiaY / 0.06) * yawErr * fast * (1 + 2 * smooth(0.2, 0.8, v.input.brakePedal || 0))));
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
        var camber = self.camberThrust * Math.tan(Math.max(-1.05, Math.min(1.05, state.lean))) * alive, loadAll = 0;
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
        p.lat += (hang * self.maxHang - p.lat) * k(0.25); p.knee += (bendT - p.knee) * k(0.3);
        p.long += ((-0.22 * sit + 0.12 * tuck) - p.long) * k(0.3);
        p.drop += ((-0.09 * tuck + 0.05 * sit) - p.drop) * k(0.3);
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

    // the drag of the air: a rider that sits up (on the brake) has more of it, one that lies flat (on the throttle) has less
    this.dragScale = function () { return 1 + 0.35 * self.posture.sit - 0.3 * self.posture.tuck; };

    // ---- hook for the camera: it rolls with the lean, a part of it, smoothed. camera: the three.js camera, after it was placed
    // after a reset or a repair: the rider is back on the bike
    this.recover = function () { hist.length = 0; self.slideTime = 0; self.crashed = false; self.limp = false; self.riderLoad = null; self.footDown = 0; self.footDownL = 0; self.footStill = false; self.footWait = 0; self.targetLean = 0; self.steer = 0; self.wheelieScale = 1; vPrev = null; accel.x = accel.y = accel.z = 0; };

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
