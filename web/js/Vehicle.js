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
 * Author: Chris Barnard
 * Description: The physics of the car, without any 3D objects, so it can run (and be
 *              tested) on its own. Everything is connected through torque and speed:
 *
 *                engine -> friction clutch -> gearbox -> differential -> rear wheels -> tyres
 *                                                                                        |
 *                chassis (speed, sideways speed, yaw rate) <------ tyre forces, gravity, drag
 *
 *              - The engine has inertia and can stall; the clutch transmits at most a
 *                torque set by the pedal, so it grips, slips or slides depending on the load.
 *              - Each wheel is an inertia whose speed follows from the engine, brake and
 *                tyre torque. The slip between wheel and road decides how much force the
 *                tyre makes, so wheels spin up or lock instead of being tied to the car speed.
 *              - The chassis is a rigid body on the road plane. Gravity pulls it down a slope,
 *                and load moves between the wheels while accelerating, braking and cornering.
 *
 *              The road is supplied by the caller through setGround().
 *
 *              Conventions: heading psi is measured from +x towards +z (the car's forward
 *              vector is (cos psi, sin psi)); u is the speed forward, v the speed to the
 *              right and r the yaw rate (positive = turning right).
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
    this.gear_ratios = parameters.gear_ratios;
    this.final_drive = parameters.final_drive;
    this.getSurface = parameters.getSurface;

    this.af = this.wheelbase * (1 - this.weight_distribution); // front axle to the centre of gravity
    this.ar = this.wheelbase * this.weight_distribution;       // rear axle to the centre of gravity
    this.cgHeight = parameters.cgHeight || 0.55;
    this.yawInertia = parameters.mass * (Math.pow(parameters.width || 1.8, 2) + Math.pow(parameters.length || 4.8, 2)) / 12;
    this.rollFrontShare = 0.55;       // share of the lateral load transfer that goes over the front axle
    this.frontWheelRate = 29000;      // suspension stiffness at the wheel (N/m), for body pitch and roll
    this.rearWheelRate = 27000;

    this.engine = new OpenRacer.Engine();
    this.driveEfficiency = 0.92;
    this.clutchCapacity = 850;        // the most torque the clutch can transmit when fully engaged (Nm)
    this.clutchSlipSpeed = 1.5;       // slip speed (rad/s) at which the clutch reaches its full capacity
    this.clutchEngagement = 1;        // how hard the clutch is clamped (0..1)
    this.lockTorque = 150;            // limited slip differential: preload (Nm)
    this.lockStiffness = 60;          // and how fast it builds up with the speed difference (Nm per rad/s)

    this.tcEnabled = false;
    this.absEnabled = true;
    this.tcFactor = 1;
    this.shiftTimer = 0;
    this.lastGearKey = null;
    this.timeSinceShift = 10;

    // State of the chassis
    this.x = 0;
    this.z = 0;
    this.psi = 0;
    this.u = 0;
    this.v = 0;
    this.r = 0;
    this.sinSlope = 0;                // sine of the road slope along the car, positive uphill
    this.cosSlope = 1;
    this.pitchVisual = 0;             // body pitch from load transfer (positive = nose down)
    this.rollVisual = 0;              // body roll from load transfer, as a rotation of the body around its length axis
    this.ax = 0;                      // acceleration of the car along its length, filtered (m/s^2)
    this.ay = 0;                      // acceleration across, filtered
    this.drivelineRPM = 0;            // engine speed implied by the driven wheels in the current gear
    this.grip = 1;

    var longTransfer = 0;             // filtered load transfer (N), see step()
    var latTransfer = 0;
    var lastForceX = 0;
    var lastForceY = 0;

    // Wheels: 0 front right, 1 front left, 2 rear left, 3 rear right (see Car.js for the display order)
    var diameter = parameters.tire_diameter;
    var frontMass = parameters.mass * this.weight_distribution / 2;
    var rearMass = parameters.mass * (1 - this.weight_distribution) / 2;
    var defs = [
        { name: "FR", right: true,  front: true,  driven: false, mass: frontMass, brake: 1700, a: this.af,  b:  this.front_track / 2 },
        { name: "FL", right: false, front: true,  driven: false, mass: frontMass, brake: 1700, a: this.af,  b: -this.front_track / 2 },
        { name: "RL", right: false, front: false, driven: true,  mass: rearMass,  brake: 900,  a: -this.ar, b: -this.rear_track / 2 },
        { name: "RR", right: true,  front: false, driven: true,  mass: rearMass,  brake: 900,  a: -this.ar, b:  this.rear_track / 2 }
    ];
    this.wheels = [];
    for(var i = 0; i < 4; i++) {
        var w = new OpenRacer.Wheel({
            name: defs[i].name, diameter: diameter, right: defs[i].right, front: defs[i].front,
            driven: defs[i].driven, mass: defs[i].mass, maxBrakeTorque: defs[i].brake
        });
        w.a = defs[i].a;
        w.b = defs[i].b;
        w.weight = defs[i].mass * G;
        this.wheels.push(w);
    }

    // Static positions of the wheels and the heading, for the caller to place the car
    this.reset = function (x, z, psi) {
        this.x = x;
        this.z = z;
        this.psi = psi;
        this.u = this.v = this.r = 0;
        this.ax = this.ay = 0;
        longTransfer = latTransfer = 0;
        lastForceX = lastForceY = 0;
        for(var i = 0; i < 4; i++) {
            var w = this.wheels[i];
            w.omega = 0;
            w.slipRatio = w.slipTan = 0;
            w.absFactor = 1;
            w.velocity.set(0, 0, 0);
        }
        this.engine.omega = this.engine.idleRPM * Math.PI / 30;
        this.engine.running = true;
        this.engine.starting = false;
        this.clutchEngagement = 0;
        this.shiftTimer = 0;
    };

    // The road under the car: height of the road under each wheel, and the surface it is made of
    // (see Car.js). From the heights follow the slope the car is on.
    this.setGround = function (heights, surfaces) {
        for(var i = 0; i < 4; i++) {
            this.wheels[i].groundY = heights[i];
            this.wheels[i].surface = surfaces[i];
        }
        var front = (heights[0] + heights[1]) / 2;
        var rear = (heights[2] + heights[3]) / 2;
        var rise = (front - rear) / this.wheelbase;
        var sin = Math.max(-0.5, Math.min(0.5, rise / Math.sqrt(1 + rise * rise)));
        // a little smoothing, so that the triangles of the road mesh do not shake the car
        this.sinSlope += (sin - this.sinSlope) * 0.5;
        this.cosSlope = Math.sqrt(1 - this.sinSlope * this.sinSlope);
    };

    // Total gear ratio from the engine to the wheels, including the final drive. Negative in reverse and 0 in neutral.
    this.getGearRatio = function () {
        var inp = this.input;
        if(inp.neutral) return 0;
        var ratio = this.final_drive;
        if(inp.reverse) return -this.gear_ratios[0] * ratio;
        return this.gear_ratios[inp.current_gear] * ratio;
    };

    this.getSpeed = function () {
        return this.u;
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
        var rearOmega = (this.wheels[2].omega + this.wheels[3].omega) / 2;
        this.drivelineRPM = Math.abs(rearOmega) * ratio * 30 / Math.PI;

        // automatic gearbox
        if(!inp.manualGearbox && !inp.reverse && !inp.neutral) {
            var g = inp.current_gear;
            var thr = inp.throttle;
            // the engine speed the road speed asks for in this gear: spinning wheels must not cause a shift
            var rpm = Math.max(0, this.u) / this.wheels[3].radius * ratio * 30 / Math.PI;
            if(this.timeSinceShift > 0.6) {
                var upRPM = 3000 + 2800 * thr;
                var downRPM = 1500 + 1100 * thr;
                var nextRatio = g < gears - 1 ? this.gear_ratios[g + 1] / this.gear_ratios[g] : 1;
                var prevRatio = g > 0 ? this.gear_ratios[g - 1] / this.gear_ratios[g] : 1;
                if(g < gears - 1 && rpm > upRPM && rpm * nextRatio > 2300 && this.u > 1) {
                    inp.current_gear++;
                } else if(g > 0 && (rpm < downRPM && rpm * prevRatio < 5700 || (this.u < 1.5 && thr < 0.1))) {
                    inp.current_gear--;
                }
            }
        }

        // a shift of the gear (by the driver or by the automatic gearbox) needs the clutch
        var key = inp.neutral ? -1 : (inp.reverse ? -2 : inp.current_gear);
        if(this.lastGearKey !== null && key !== this.lastGearKey) {
            this.timeSinceShift = 0;
            if(!inp.clutchPedalPresent) this.shiftTimer = 0.32;
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

    // Advances the physics by dt (small: 1/200 s or less)
    function step(dt) {
        var inp = self.input;
        var engine = self.engine;
        var wheels = self.wheels;
        var m = self.mass;
        var L = self.wheelbase;
        var delta = inp.turnAngle || 0;
        var cosD = Math.cos(delta);
        var sinD = Math.sin(delta);
        var u = self.u, v = self.v, r = self.r;

        // ---- vertical load on each wheel: static share, plus the load transferred by the forces on the car
        var N = m * G * self.cosSlope;
        var tau = Math.min(1, dt / 0.05);
        // tyre force at the ground (and drag) acts below the centre of gravity: it lifts the nose when accelerating
        longTransfer += (lastForceX * self.cgHeight / L - longTransfer) * tau;
        latTransfer += (lastForceY * self.cgHeight - latTransfer) * tau;
        var frontAxle = N * self.ar / L - longTransfer;
        var rearAxle = N * self.af / L + longTransfer;
        var halfFront = latTransfer * self.rollFrontShare / self.front_track;
        var halfRear = latTransfer * (1 - self.rollFrontShare) / self.rear_track;
        // lateral force to the right moves load to the left wheels
        var loads = [
            frontAxle / 2 - halfFront,
            frontAxle / 2 + halfFront,
            rearAxle / 2 + halfRear,
            rearAxle / 2 - halfRear
        ];

        // ---- tyres
        var sumFx = 0, sumFy = 0, sumMz = 0;
        var maxDrivenSlip = 0;
        var brakePedal = inp.brakePedal;
        var handbrake = inp.handbrake ? 1 : 0;
        var tyreTorque = [0, 0, 0, 0];
        var brakeTorque = [0, 0, 0, 0];
        for(var i = 0; i < 4; i++) {
            var w = wheels[i];
            var Fz = Math.max(100, loads[i]);
            w.weight = Fz;

            // velocity of the contact point in the wheel frame
            var up = u - r * w.b;
            var vp = v + r * w.a;
            var vl, vt;
            if(w.front) {
                vl = up * cosD + vp * sinD;
                vt = vp * cosD - up * sinD;
            } else {
                vl = up;
                vt = vp;
            }
            w.forwardSpeed = vl;

            // slip, with a relaxation length: the tyre needs to roll a bit before the slip builds up
            var vref = Math.max(Math.abs(vl), 1.5);
            var kappa = Math.max(-1.5, Math.min(1.5, (w.omega * w.radius - vl) / vref));
            var tanA = Math.max(-1.5, Math.min(1.5, vt / vref));
            var a = 1 - Math.exp(-dt * vref / w.relaxation);
            w.slipRatio += (kappa - w.slipRatio) * a;
            w.slipTan += (tanA - w.slipTan) * a;

            var surface = self.getSurface(w.surface);
            w.tyreForce(w.slipRatio, w.slipTan, Fz, surface);
            var fx = w.fx;
            var fy = w.fy;
            // a little damping on the slip speed keeps a nearly stationary wheel from ringing
            fx += 400 * Math.max(-0.3, Math.min(0.3, w.omega * w.radius - vl));
            tyreTorque[i] = -fx * w.radius;

            // rolling resistance (more on soft ground), not a torque on the wheel
            var rr = w.rollingResistance * (surface.static < 0.5 ? 4 : 1) * Fz * Math.tanh(vl / 0.3);
            fx -= rr;

            // brakes, with ABS
            var bias = w.front ? 1 : 1;
            if(self.absEnabled && brakePedal > 0.05 && w.slipRatio < -0.16 && Math.abs(vl) > 2) {
                w.absFactor = Math.max(0.05, w.absFactor - 15 * dt);
                w.abs = true;
            } else {
                w.absFactor = Math.min(1, w.absFactor + 8 * dt);
                if(w.absFactor > 0.98) w.abs = false;
            }
            var bt = brakePedal * w.maxBrakeTorque * w.absFactor * bias;
            if(!w.front) bt += handbrake * 1800;
            brakeTorque[i] = bt;
            w.brakeTorque = bt;

            // to the car (the front wheels are steered)
            var fxB, fyB;
            if(w.front) {
                fxB = fx * cosD - fy * sinD;
                fyB = fx * sinD + fy * cosD;
            } else {
                fxB = fx;
                fyB = fy;
            }
            sumFx += fxB;
            sumFy += fyB;
            sumMz += w.a * fyB - w.b * fxB;
            if(w.driven) maxDrivenSlip = Math.max(maxDrivenSlip, w.slipRatio);
        }

        // ---- traction control
        // Keeps the slip of the driven wheels near the peak of the tyre by taking torque off the engine,
        // down to a small fraction if that is what it takes.
        // The torque comes back slowly once the wheels hook up again, or it would start spinning again.
        var slipError = maxDrivenSlip - 0.18;
        if(self.tcEnabled && slipError > 0) {
            self.tcFactor = Math.max(0.12, self.tcFactor - dt * (2 + 20 * slipError));
            wheels[2].tc = wheels[3].tc = true;
        } else {
            self.tcFactor = Math.min(1, self.tcFactor + dt * (slipError < -0.08 ? 2 : 0.3));
            if(self.tcFactor > 0.98 || !self.tcEnabled) wheels[2].tc = wheels[3].tc = false;
        }

        // ---- engine and clutch
        var gs = self.getGearRatio();
        var rl = wheels[2], rr_ = wheels[3];
        var throttle = inp.throttle * self.tcFactor;
        // the gearbox takes the power off while it shifts
        if(self.shiftTimer > 0) throttle *= 0.15;
        var Te = engine.getNetTorque(throttle);
        var rpm = engine.getRPM();

        // How hard the clutch is clamped: from the clutch pedal, or by an automatic clutch that
        // engages with the engine speed (so the engine does not stall) and opens while shifting.
        var engagement;
        if(inp.clutchPedalPresent) {
            engagement = pedalBite(inp.clutch);
        } else {
            engagement = smoothstep(1050, 2000, rpm);
            if(self.shiftTimer > 0) {
                var t = self.shiftTimer;
                engagement = Math.min(engagement, t > 0.14 ? 0 : 1 - smoothstep(0, 0.14, t));
            }
        }
        self.clutchEngagement = engagement;

        // brake torque as it is felt by the wheel at its current speed, for the clutch solution below
        var extL = tyreTorque[2] - brakeTorque[2] * Math.tanh(rl.omega / 0.5);
        var extR = tyreTorque[3] - brakeTorque[3] * Math.tanh(rr_.omega / 0.5);
        var Je = engine.inertia;
        var Tc = 0;
        if(gs !== 0) {
            var cap = self.clutchCapacity * engagement;
            var omegaS = gs * (rl.omega + rr_.omega) / 2;
            var dOmega = engine.omega - omegaS;
            var invJd = gs * gs / 4 * (1 / rl.inertia + 1 / rr_.inertia);
            var aExt = gs / 2 * (extL / rl.inertia + extR / rr_.inertia);
            var k = cap / self.clutchSlipSpeed;
            // Implicit solution of the slip between engine and driveline: it can be stiff (a locked
            // clutch), and this stays stable. Beyond the capacity the clutch slips with a fixed torque.
            var base = dOmega + dt * (Te / Je - aExt);
            var den = 1 + dt * k * (1 / Je + invJd);
            Tc = k * base / den;
            if(Math.abs(Tc) > cap) Tc = cap * (base > 0 ? 1 : -1);
        }
        engine.omega += dt * (Te - Tc) / Je;
        if(engine.omega < 0) engine.omega = 0;
        if(engine.omega > engine.maxRPM * Math.PI / 30) engine.omega = engine.maxRPM * Math.PI / 30;
        var driveTorque = Tc * gs * self.driveEfficiency / 2; // to each of the two driven wheels

        // ---- differential: open, with a preload and some locking
        var lock = Math.max(-self.lockTorque, Math.min(self.lockTorque, self.lockStiffness * (rl.omega - rr_.omega)));

        // ---- wheel speeds
        for(var j = 0; j < 4; j++) {
            var wj = wheels[j];
            var T = tyreTorque[j];
            if(j === 2) T += driveTorque - lock;
            if(j === 3) T += driveTorque + lock;
            var omegaFree = wj.omega + dt * T / wj.inertia;
            var bt2 = brakeTorque[j];
            if(bt2 > 0) {
                var dw = dt * bt2 / wj.inertia;
                if(Math.abs(omegaFree) <= dw) omegaFree = 0;
                else omegaFree -= dw * (omegaFree > 0 ? 1 : -1);
            }
            wj.omega = omegaFree;
            wj.spin += wj.omega * dt;
        }

        // ---- the car as a whole
        var speed = Math.sqrt(u * u + v * v);
        var dragX = -self.Cdrag * speed * u;
        var dragY = -self.Cdrag * speed * v;
        var Fx = sumFx + dragX - m * G * self.sinSlope;
        var Fy = sumFy + dragY;
        var du = Fx / m + v * r;
        var dv = Fy / m - u * r;
        var dr = sumMz / self.yawInertia;
        self.u = u + du * dt;
        self.v = v + dv * dt;
        self.r = r + dr * dt;
        // body speeds when the car is (nearly) standing still: stop instead of drifting
        if(Math.abs(self.u) < 0.02 && Math.abs(self.v) < 0.02 && inp.brakePedal > 0.3) {
            self.u = self.v = self.r = 0;
        }

        var cosP = Math.cos(self.psi);
        var sinP = Math.sin(self.psi);
        var vx = self.u * cosP - self.v * sinP;
        var vz = self.u * sinP + self.v * cosP;
        self.x += vx * dt;
        self.z += vz * dt;
        self.psi += self.r * dt;

        // forces that move load between the wheels (tyre forces and drag, not gravity)
        lastForceX = sumFx + dragX;
        lastForceY = sumFy + dragY;
        var aT = Math.min(1, dt / 0.1);
        self.ax += (lastForceX / m - self.ax) * aT;
        self.ay += (lastForceY / m - self.ay) * aT;

        for(var q = 0; q < 4; q++) {
            wheels[q].velocity.set(vx, 0, vz);
            wheels[q].RPM = wheels[q].omega * 30 / Math.PI;
            wheels[q].forwardMPH = Math.round(wheels[q].forwardSpeed * 2.2369362920544);
        }
    }

    // Moves the physics forward by delta seconds, in small steps. The 3D side of the car is left to Car.js.
    this.update = function (delta) {
        this.updateControls(delta);
        var steps = Math.max(1, Math.ceil(delta / 0.0035));
        var dt = delta / steps;
        for(var s = 0; s < steps; s++) step(dt);

        // body pitch and roll from the loads on the wheels, relative to the loads at rest
        var staticFront = this.mass * G * this.cosSlope * this.ar / this.wheelbase / 2;
        var staticRear = this.mass * G * this.cosSlope * this.af / this.wheelbase / 2;
        var comp = [];
        for(var i = 0; i < 4; i++) {
            var w = this.wheels[i];
            var rate = w.front ? this.frontWheelRate : this.rearWheelRate;
            var base = w.front ? staticFront : staticRear;
            var target = (w.weight - base) / rate;
            w.compression += (target - w.compression) * Math.min(1, delta / 0.06);
            comp.push(w.compression);
        }
        var front = (comp[0] + comp[1]) / 2;
        var rear = (comp[2] + comp[3]) / 2;
        this.pitchVisual = (front - rear) / this.wheelbase;
        var left = (comp[1] + comp[2]) / 2;
        var right = (comp[0] + comp[3]) / 2;
        this.rollVisual = -(left - right) / ((this.front_track + this.rear_track) / 2);
        this.grip = 1;
    };
};
