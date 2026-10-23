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
    this.leanResponse = s.lean_response || 0.16;          // s: how fast the lean follows what is asked
    this.camberThrust = s.camber_thrust !== undefined ? s.camber_thrust : 0.3;
    this.standUp = s.throttle_stand_up !== undefined ? s.throttle_stand_up : 0.18;
    this.cameraRollFactor = s.camera_roll !== undefined ? s.camera_roll : 0.45;
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
        var want = -c * Math.min(self.maxLean, cap) * fast;
        want *= 1 - self.standUp * Math.max(0, Math.min(1, inp.throttle || 0)) * Math.min(1, Math.abs(want) / (15 * DEG));
        self.targetLean += (want - self.targetLean) * Math.min(1, dt / self.leanResponse);
        var target = self.targetLean;
        // the angle of the wheel that a bend of this lean needs: a = g tan(lean) less the camber thrust of the tyres, delta = L a / u^2 (to the left: negative)
        var phi = Math.abs(target);
        var aSlip = G * Math.max(0, Math.tan(phi) - self.camberThrust * Math.sin(phi));
        var steady = -Math.sign(target) * Math.atan(v.wheelbase * aSlip / Math.max(u * u, 1));
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
    this.brakeScale = function (v, wheel) { return wheel.front ? self.frontBrake : self.rearBrake; };

    // ---- hook: the body of the bike does not touch the road in a lean (it is no crash until the bike is nearly on its side)
    this.keepBodyOff = function (v) { return Math.abs(v.lean) < 1.15; };

    // ---- hook: the rider and the tyres; the forces and the torques of the physics are added to
    this.apply = function (v, force, torque, dt, c) {
        var state = leanOf(v), u = c.u;
        v.lean = state.lean;
        var m = v.mass, gh = m * G * v.cgHeight;
        var kp = self.balance * 7 * gh, inertia = m * v.cgHeight * v.cgHeight + c.inertiaZ, kd = 1.5 * Math.sqrt(kp * inertia);
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
        // the camber thrust: the leaned tyres push the bike to the inside of the bend
        var load = 0;
        for (var i = 0; i < 4; i++) load += v.wheels[i].weight || 0;
        var thrust = self.camberThrust * load * Math.sin(state.lean) * alive;
        force.x += state.fz * thrust; force.z -= state.fx * thrust;                              // (the left of the bike is (fz, -fx))
    };

    // ---- hook for the camera: it rolls with the lean, a part of it, smoothed. camera: the three.js camera, after it was placed
    this.cameraRoll = function (camera, v, dt) {
        self.roll += (v.lean * self.cameraRollFactor - self.roll) * Math.min(1, (dt || 0.016) / 0.12);
        camera.rotateZ(self.roll);
    };
};
