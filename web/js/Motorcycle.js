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
    this.maxLean = (s.max_lean_deg || 50) * DEG;
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
    this.gripG = s.grip_g !== undefined ? s.grip_g : 1.05;                        // the lateral g that the tyres give when nothing else is asked of them
    this.frontComply = s.front_comply !== undefined ? s.front_comply : 3;            // how much the front wheel castors into its own slip on the brake (3: it keeps a quarter of the slip angle)
    this.complied = 0;
    this.footDown = 0;                                       // 0 to 1: the right foot of the rider on the road (a standstill)
    this.noFoot = false;                                     // the car editor: the bike stands upright on its bench, the foot never goes down
    this.footLean = (s.foot_lean_deg !== undefined ? s.foot_lean_deg : 7) * DEG;   // how far the bike rests to the right on the foot
    this.wheelieScale = 1;                                  // the throttle that the wheelie control leaves (1: all of it)
    this.crashed = false;                                   // the bike is down: the rider is a ragdoll, the bike a body that slides, no input until a reset or a repair
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
    var up = { x: 0, y: 0, z: 0 }, fwd = { x: 0, y: 0, z: 0 };

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
        var lx = n.y * fwd.z - n.z * fwd.y, ly = n.z * fwd.x - n.x * fwd.z, lz = n.x * fwd.y - n.y * fwd.x, ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
        lx /= ll; ly /= ll; lz /= ll;
        // The roll axis of the bike is its own forward (ax, ay, az), not the horizontal one (fx, fz): a torque about the horizontal axis on a slope, or with the nose down on the brake,
        // has a part about the up of the bike, and that was a yaw of several hundred newton metres (the rider pulling the bike up on a climb swung its tail out)
        var al = Math.sqrt(fwd.x * fwd.x + fwd.y * fwd.y + fwd.z * fwd.z) || 1, ax = fwd.x / al, ay = fwd.y / al, az = fwd.z / al;
        return { lean: Math.atan2(up.x * lx + up.y * ly + up.z * lz, up.x * n.x + up.y * n.y + up.z * n.z), rate: -(v.wx * ax + v.wy * ay + v.wz * az), fx: fx, fz: fz, ax: ax, ay: ay, az: az, lx: lx, ly: ly, lz: lz };
    }

    // ---- hook: the angle of the front wheel (right is positive), from what the input asks for. delta: what the input gave (the angle of the wheel or the lock that is turned).
    this.steering = function (v, delta, u, dt) {
        if (self.crashed) { self.steer += (0 - self.steer) * Math.min(1, dt / 0.1); return self.steer; }
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
        var speedMax = self.maxLean - (self.maxLean - 18 * DEG) * smooth(self.fastFrom, self.fastFrom + 22, Math.abs(u));
        // the tyres have so much grip, and what they give along the bike (the engine, the air, the brake: how much the speed goes down) they cannot give sideways: the circle of grip
        var aLong = Math.max(0, -(accel.x * state.fx + accel.z * state.fz)), gripMax = self.gripG * G;
        speedMax = Math.min(speedMax, Math.atan(Math.sqrt(Math.max(0, gripMax * gripMax - aLong * aLong)) / G));
        var phiMax = speedMax + epsFull;
        var want = -c * Math.min(phiMax, cap) * fast;
        // at a standstill the rider puts the right foot down and the bike rests against it, a little to the right; on the gas the foot comes back up in two seconds
        var still = !self.noFoot && Math.abs(u) < 0.6 && (inp.throttle || 0) < 0.05 && !self.pushing;
        self.footDown += ((still ? 1 : 0) - self.footDown) * Math.min(1, dt / (still ? 0.5 : 2.0));
        want -= self.footLean * self.footDown * (1 - fast);
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
        var upright = 1 - smooth(8 * DEG, 20 * DEG, Math.abs(state.lean)), onBrake = smooth(0.05, 0.3, inp.brakePedal || 0);
        var comply = Math.max(-0.12, Math.min(0.12, -self.frontComply * slipFront)) * smooth(3, 8, Math.abs(u)) * upright * onBrake;
        self.complied += (comply - self.complied) * Math.min(1, dt / 0.04);
        var wanted = w * geometric + (1 - w) * (steady + counter + self.complied);
        self.steer += (wanted - self.steer) * Math.min(1, dt / 0.05);
        return self.steer;
    };

    // ---- hook: the wheelie control (the menu: Wheelie control, on by default): the rider rolls the throttle off as the front wheel goes light, and keeps it there at about a tenth of
    // its load; a bike with a lot of torque from low revs loops over backwards at full throttle otherwise
    this.throttleScale = function (v, dt) {
        if (self.crashed) { self.wheelieScale = 0; return 0; }
        var on = typeof Settings === "undefined" || Settings.option("wheelieControl") !== false;
        var frontLoad = ((v.wheels[0].weight || 0) + (v.wheels[1].weight || 0)) / Math.max(1, v.weight_distribution * v.mass * G);
        var want = on && Math.abs(v.u) > 0.5 ? Math.max(0.15, Math.min(1, (frontLoad - 0.08) / 0.3)) : 1;
        self.wheelieScale += (want - self.wheelieScale) * Math.min(1, dt / (want < self.wheelieScale ? 0.03 : 0.25));
        return self.wheelieScale;
    };

    // ---- hook: the brakes. brakeStep once per step of the physics, brakeScale for every wheel
    this.brakeStep = function (v, dt) {
        // a bike that is down slides and tumbles, it does not fly: the road takes its speed (a slide of about half a g), it does not go faster than it went, and it does not spin up
        if (self.crashed) {
            var cs = self.crashSpeed || { x: 0, y: 0, z: 0 }, vmax = Math.sqrt(cs.x * cs.x + cs.z * cs.z) + 1, sp = Math.sqrt(v.vx * v.vx + v.vz * v.vz);
            if (sp > vmax) { v.vx *= vmax / sp; v.vz *= vmax / sp; }
            var slide = Math.exp(-dt * (v.airborne ? 0.1 : 1.2));
            v.vx *= slide; v.vz *= slide;
            if (v.vy > 3) v.vy = 3;
            var spin = Math.exp(-dt * 2.5), wmax = 8, wl = Math.sqrt(v.wx * v.wx + v.wy * v.wy + v.wz * v.wz);
            v.wx *= spin; v.wy *= spin; v.wz *= spin;
            if (wl > wmax) { v.wx *= wmax / wl; v.wy *= wmax / wl; v.wz *= wmax / wl; }
        }
        var m = v.mass, w = v.wheels;
        var rearRatio = ((w[2].weight || 0) + (w[3].weight || 0)) / Math.max(1, (1 - v.weight_distribution) * m * G);
        // the front brake is let off as the rear wheel is nearly free of the road (it keeps a few percent of its load: the limit of the front brake), the rear brake goes with the load of the rear wheel
        var target = Math.max(0, Math.min(1, (rearRatio - 0.10) / 0.18));
        self.frontBrake += (target - self.frontBrake) * Math.min(1, dt / (target < self.frontBrake ? 0.02 : 0.1));
        // (after a crest the rear wheel comes down hard and it spins faster than the road: the rear brake comes back slowly, so that it does not lock and slide)
        var rearTarget = Math.max(0, Math.min(1, rearRatio * 1.2));
        self.rearBrake = rearTarget > self.rearBrake ? Math.min(rearTarget, self.rearBrake + dt / 0.3) : rearTarget;
    };
    // in a bend the front brake stands the bike up, so it is hardly used (a rider uses the rear brake): from 8 to 30 degrees of lean it goes to a tenth
    this.brakeScale = function (v, wheel) {
        if (self.crashed) return 0;
        if(!wheel.front) return self.rearBrake;
        return self.frontBrake * (1 - 0.9 * smooth(8 * DEG, 30 * DEG, Math.abs(v.lean)));
    };

    // ---- hook: the body of the bike does not touch the road in a lean (it is no crash until the bike is nearly on its side)
    this.keepBodyOff = function (v) { return !self.crashed && Math.abs(v.lean) < 1.15; };

    // ---- hook: the rider and the tyres; the forces and the torques of the physics are added to
    this.apply = function (v, force, torque, dt, c) {
        var state = leanOf(v, dt), u = c.u;
        v.lean = state.lean;
        // A crash: the bike is nearly on its side, or a hit (a change of speed of more than 6 g, or more than 2.2 g sideways at speed: a wall, a kerb). From then on the rider does nothing,
        // the bike is a body that slides (Vehicle.js: its spheres touch the road), and the rider is thrown off (Driver.js, a ragdoll), until a reset or a repair (Car.js)
        if (!self.crashed) {
            var aMag = Math.sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z);
            var aLat = accel.x * state.lx + accel.y * state.ly + accel.z * state.lz;
            if (Math.abs(state.lean) > 1.2 || aMag > 2.8 * G || (Math.abs(aLat) > 2.2 * G && Math.abs(u) > 5)) { self.crashed = true; self.crashSpeed = { x: v.vx, y: v.vy, z: v.vz }; }
        }
        if (self.crashed) { self.posture.lat = self.posture.knee = self.posture.tuck = self.posture.sit = 0; return; }
        self.rider(v, torque, dt, u, state);
        var m = v.mass, gh = m * G * v.cgHeight;
        var kp = self.balance * 10 * gh, inertia = m * v.cgHeight * v.cgHeight + c.inertiaZ, kd = 1.5 * Math.sqrt(kp * inertia);
        var T = kp * (self.targetLean - state.lean) - kd * state.rate;                           // about the axis that leans it to the left
        var alive = 1 - Math.min(1, Math.max(0, (Math.abs(state.lean) - 1.15) / 0.25));         // past about 66 degrees the bike is going down: the rider lets go
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
            self.dbg.yawDamp = Math.max(-3000, Math.min(3000, self.balance * (c.inertiaY / 0.06) * yawErr * fast));
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
    // the posture of the rider from what the bike does (also for a replay, which has no physics: the lean and the pedals of the recording)
    this.postureStep = function (dt, u, thr, brk, lean) {
        var p = self.posture, i = { thr: thr, brk: brk }, fwdSpeed = Math.max(0, u);
        var tuck = i.thr * smooth(12, 35, fwdSpeed) * (1 - i.brk), sit = i.brk * smooth(4, 20, fwdSpeed);
        if(self.riderKey) { tuck = self.riderKey > 0 ? 1 : 0; sit = self.riderKey < 0 ? 1 : 0; }
        var bendT = smooth(8 * DEG, 40 * DEG, Math.abs(lean)) * smooth(5, 12, Math.abs(u));
        var hang = Math.sign(lean) * bendT;
        var k = function (t) { return Math.min(1, dt / t); };
        p.tuck += (tuck - p.tuck) * k(0.35); p.sit += (sit - p.sit) * k(0.25);
        p.lat += (hang * self.maxHang - p.lat) * k(0.25); p.knee += (bendT - p.knee) * k(0.3);
        p.long += ((-0.22 * sit + 0.12 * tuck) - p.long) * k(0.3);
        p.drop += ((-0.09 * tuck + 0.05 * sit) - p.drop) * k(0.3);
    };
    // a replay: the posture and the foot from the recording (the lean of the body, the speed and the pedals), nothing else
    this.replayStep = function (v, dt, thr, brk) {
        var state = leanOf(v, 0), u = v.u;
        v.lean = state.lean;
        self.targetLean = state.lean;
        var still = Math.abs(u) < 0.6 && thr < 0.05;
        self.footDown += ((still ? 1 : 0) - self.footDown) * Math.min(1, dt / (still ? 0.5 : 2.0));
        self.postureStep(dt, u, thr, brk, state.lean);
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
        var tx = self.riderMass * (dw.y * gz - dw.z * gy), ty = self.riderMass * (dw.z * gx - dw.x * gz), tz = self.riderMass * (dw.x * gy - dw.y * gx);
        var along = tx * state.ax + ty * state.ay + tz * state.az;
        torque.x += tx - along * state.ax; torque.y += ty - along * state.ay; torque.z += tz - along * state.az;
    };

    // the drag of the air: a rider that sits up (on the brake) has more of it, one that lies flat (on the throttle) has less
    this.dragScale = function () { return 1 + 0.35 * self.posture.sit - 0.3 * self.posture.tuck; };

    // ---- hook for the camera: it rolls with the lean, a part of it, smoothed. camera: the three.js camera, after it was placed
    // after a reset or a repair: the rider is back on the bike
    this.recover = function () { self.crashed = false; self.footDown = 0; self.targetLean = 0; self.steer = 0; self.wheelieScale = 1; vPrev = null; accel.x = accel.y = accel.z = 0; };

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
