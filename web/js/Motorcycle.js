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
    this.camberThrust = s.camber_thrust !== undefined ? s.camber_thrust : 0.3;
    this.standUp = s.throttle_stand_up !== undefined ? s.throttle_stand_up : 0.18;
    this.cameraRollFactor = s.camera_roll !== undefined ? s.camera_roll : 0.45;
    this.keyRate = s.key_steer_rate || 2;                    // how much faster the steering keys bring the lean command than they turn the wheels of a car
    this.cornerBrake = s.corner_brake !== undefined ? s.corner_brake : 0.2;    // how much further the bike leans into the bend on the rear brake
    this.riderMass = s.rider_mass !== undefined ? s.rider_mass : 80;
    this.maxHang = s.hang_off !== undefined ? s.hang_off : 0.3;                    // m: how far the rider hangs off the seat to the inside of a bend
    this.posture = { lat: 0, long: 0, drop: 0, tuck: 0, sit: 0, knee: 0 };       // body space: lat to the left, long forward, drop up (m); tuck, sit, knee: 0 to 1
    var vPrev = null, accel = { x: 0, y: 0, z: 0 }, dw = { x: 0, y: 0, z: 0 };
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

    // The lean of the bike to the left (rad), and how fast it falls to the left, from its pose
    function leanOf(v) {
        rotate(v, 0, 1, 0, up);
        rotate(v, 0, 0, 1, fwd);
        var fl = Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z) || 1, fx = fwd.x / fl, fz = fwd.z / fl;
        return { lean: Math.atan2(up.x * fz - up.z * fx, up.y), rate: -(v.wx * fx + v.wz * fz), fx: fx, fz: fz };
    }

    // ---- hook: the angle of the front wheel (right is positive), from what the input asks for. delta: what the input gave (the angle of the wheel or the lock that is turned).
    this.steering = function (v, delta, u, dt) {
        var inp = v.input, lock = inp.turnLimit || inp.maxTurn || 0.38;
        var c = Math.max(-1, Math.min(1, delta / lock));          // the lean command: left is negative, as the steering of a car
        self.command = c;
        var state = leanOf(v);
        var fast = smooth(1.5, 4.5, Math.abs(u));                  // at a walking pace the rider holds it up with a foot
        // the lean that the command asks for, less at a walking pace (a bend of that lean needs a speed: tan(lean) = u^2 tan(steering lock) / (L g)), and stood up a little by the throttle
        var cap = Math.atan(u * u * Math.tan(lock) / (v.wheelbase * G));
        // the lean of the whole (the bike and the rider that hangs off): tan(phi) = a / g. The bike itself leans phi less atan(share * hang off / height of the centre of gravity)
        var share = self.riderMass / v.mass, epsFull = Math.atan(share * self.maxHang / v.cgHeight);
        var eps = Math.atan(share * self.posture.lat / v.cgHeight);       // to the left: positive
        var phiMax = self.maxLean + epsFull;
        var want = -c * Math.min(phiMax, cap) * fast;
        var brake = Math.max(0, Math.min(1, inp.brakePedal || 0)), bend = smooth(8 * DEG, 30 * DEG, Math.abs(want));
        want *= 1 + self.cornerBrake * brake * bend;                  // the rear brake takes it deeper into the bend (the front brake is not used in a bend: brakeScale)
        want = Math.max(-phiMax, Math.min(phiMax, want));
        want *= 1 - self.standUp * Math.max(0, Math.min(1, inp.throttle || 0)) * Math.min(1, Math.abs(want) / (15 * DEG));
        var bikeWant = Math.max(-self.maxLean, Math.min(self.maxLean, want - eps * Math.min(1, Math.abs(want) / (6 * DEG))));
        self.targetLean += (bikeWant - self.targetLean) * Math.min(1, dt / self.leanResponse);
        var target = self.targetLean;
        // the angle of the wheel that a bend of this lean needs: a = g tan(lean of the whole) less the camber thrust of the tyres, delta = L a / u^2 (to the left: negative)
        var phiNow = target + eps * Math.min(1, Math.abs(target) / (6 * DEG));
        var phi = Math.abs(phiNow);
        var aSlip = G * Math.max(0, Math.tan(phi) - self.camberThrust * Math.sin(Math.abs(target)));
        var steady = -Math.sign(phiNow) * Math.atan(v.wheelbase * aSlip / Math.max(u * u, 1));
        // countersteering: to start a lean to the left the wheel goes to the right for a moment, in proportion to what the lean still has to go
        var cLimit = Math.min(0.07, 5 / Math.max(u * u, 1));       // (at most about half a g of sideways push from it at any speed)
        var counter = Math.max(-cLimit, Math.min(cLimit, 0.3 * (target - state.lean))) * smooth(3, 10, Math.abs(u));
        var geometric = -c * lock;                                  // at a walking pace the angle is the command
        var w = 1 - smooth(2, 5, Math.abs(u));
        var wanted = w * geometric + (1 - w) * (steady + counter);
        self.steer += (wanted - self.steer) * Math.min(1, dt / 0.05);
        return self.steer;
    };

    // ---- hook: the brakes. brakeStep once per step of the physics, brakeScale for every wheel
    this.brakeStep = function (v, dt) {
        var m = v.mass, w = v.wheels;
        var rearRatio = ((w[2].weight || 0) + (w[3].weight || 0)) / Math.max(1, (1 - v.weight_distribution) * m * G);
        // the front brake is let off as the rear wheel is nearly free of the road (it keeps a few percent of its load: the limit of the front brake), the rear brake goes with the load of the rear wheel
        var target = Math.max(0, Math.min(1, (rearRatio - 0.015) / 0.07));
        self.frontBrake += (target - self.frontBrake) * Math.min(1, dt / (target < self.frontBrake ? 0.02 : 0.1));
        self.rearBrake = Math.max(0, Math.min(1, rearRatio * 1.2));
    };
    // in a bend the front brake stands the bike up, so it is hardly used (a rider uses the rear brake): from 8 to 30 degrees of lean it goes to a tenth
    this.brakeScale = function (v, wheel) {
        if(!wheel.front) return self.rearBrake;
        return self.frontBrake * (1 - 0.9 * smooth(8 * DEG, 30 * DEG, Math.abs(v.lean)));
    };

    // ---- hook: the body of the bike does not touch the road in a lean (it is no crash until the bike is nearly on its side)
    this.keepBodyOff = function (v) { return Math.abs(v.lean) < 1.15; };

    // ---- hook: the rider and the tyres; the forces and the torques of the physics are added to
    this.apply = function (v, force, torque, dt, c) {
        var state = leanOf(v), u = c.u;
        v.lean = state.lean;
        self.rider(v, torque, dt, u, state);
        var m = v.mass, gh = m * G * v.cgHeight;
        var kp = self.balance * 10 * gh, inertia = m * v.cgHeight * v.cgHeight + c.inertiaZ, kd = 1.5 * Math.sqrt(kp * inertia);
        var T = kp * (self.targetLean - state.lean) - kd * state.rate;                           // about the axis that leans it to the left
        var alive = 1 - Math.min(1, Math.max(0, (Math.abs(state.lean) - 1.15) / 0.25));         // past about 66 degrees the bike is going down: the rider lets go
        T = alive * Math.max(-6 * gh, Math.min(6 * gh, T));
        torque.x -= state.fx * T; torque.z -= state.fz * T;
        // the yaw that the steering did not ask for is damped
        var fast = smooth(1.5, 4.5, Math.abs(u));
        if (Math.abs(u) > 3) {
            var yawErr = c.r - u * c.delta / v.wheelbase;
            torque.y += Math.max(-1800, Math.min(1800, self.balance * (c.inertiaY / 0.12) * yawErr * fast));
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
        // the camber thrust: the leaned tyres push the bike to the inside of the bend
        var load = 0;
        for (var i = 0; i < 4; i++) load += v.wheels[i].weight || 0;
        var thrust = self.camberThrust * load * Math.sin(state.lean) * alive;
        force.x += state.fz * thrust; force.z -= state.fx * thrust;                              // (the left of the bike is (fz, -fx))
    };

    // ---- the rider on the bike: where he sits, from what the bike does, and what his weight does to the bike
    var inputOf = function (v) { var i = v.input; return { thr: Math.max(0, Math.min(1, i.throttle || 0)), brk: Math.max(0, Math.min(1, i.brakePedal || 0)) }; };
    this.rider = function (v, torque, dt, u, state) {
        var p = self.posture, i = inputOf(v), fwdSpeed = Math.max(0, u);
        // the targets: sits back and up on the brake, flat and forward on the throttle at speed, off the seat to the inside of a bend
        var tuck = i.thr * smooth(12, 35, fwdSpeed) * (1 - i.brk), sit = i.brk * smooth(4, 20, fwdSpeed);
        var bendT = smooth(8 * DEG, 40 * DEG, Math.abs(self.targetLean)) * smooth(5, 12, Math.abs(u));
        var hang = Math.sign(self.targetLean) * bendT;
        var k = function (t) { return Math.min(1, dt / t); };
        p.tuck += (tuck - p.tuck) * k(0.35); p.sit += (sit - p.sit) * k(0.25);
        p.lat += (hang * self.maxHang - p.lat) * k(0.25); p.knee += (bendT - p.knee) * k(0.3);
        p.long += ((-0.22 * sit + 0.12 * tuck) - p.long) * k(0.3);
        p.drop += ((-0.09 * tuck + 0.05 * sit) - p.drop) * k(0.3);
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
        var along = tx * state.fx + tz * state.fz;
        torque.x += tx - along * state.fx; torque.y += ty; torque.z += tz - along * state.fz;
    };

    // the drag of the air: a rider that sits up (on the brake) has more of it, one that lies flat (on the throttle) has less
    this.dragScale = function () { return 1 + 0.35 * self.posture.sit - 0.3 * self.posture.tuck; };

    // ---- hook for the camera: it rolls with the lean, a part of it, smoothed. camera: the three.js camera, after it was placed
    this.cameraRoll = function (camera, v, dt) {
        self.roll += (v.lean * self.cameraRollFactor - self.roll) * Math.min(1, (dt || 0.016) / 0.12);
        camera.rotateZ(self.roll);
    };
};

// The mass of the rider of a motorcycle (car.json "motorcycle.rider_mass", 80 kg), which is on top of the "mass" of the bike; 0 for a car
OpenRacer.Motorcycle.riderMass = function (config) {
    if(!config || config.type !== "motorcycle") return 0;
    var m = config.motorcycle && config.motorcycle.rider_mass;
    return m !== undefined ? m : 80;
};
