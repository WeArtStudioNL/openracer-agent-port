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
 * Engine.js
 *
 * Author: Chris Barnard
 * Description: A rotating engine with inertia. It produces torque from a full
 *              throttle curve, loses torque to friction and pumping losses, holds
 *              an idle speed, cuts fuel at the rev limit and can stall. The
 *              clutch and the wheels (see Vehicle.js) load it from outside.
 */

OpenRacer.Engine = function( parameters ) {
    parameters = parameters || {};

    // Full throttle torque in Nm at an engine speed: [rpm, Nm] points of the car's configuration. The default is the
    // 351 of the Mustang: below 3000 rpm a big V8 already has most of its torque, and the curve falls away past the power
    // peak. The points from 3000 rpm come from its power curve (bhp at rpm: 237.5 at 3000 to 350 at 6000).
    var DEFAULT_CURVE = [[0, 0], [300, 110], [800, 250], [1500, 400], [2000, 480], [2500, 530], [3000, 563.7], [3500, 569.6],
        [4000, 582], [4500, 569.7], [5000, 526.9], [5300, 509], [5500, 485.5], [6000, 415.4], [6500, 330], [7500, 150]];
    var curve = parameters.torque_curve && parameters.torque_curve.length > 1 ? parameters.torque_curve : DEFAULT_CURVE;
    this.torque_curve = curve.map(function(point) { return { "rpm" : point[0], "nm" : point[1] }; })
        .sort(function(a, b) { return a.rpm - b.rpm; });

    this.inertia = parameters.inertia || 0.4; // crankshaft, flywheel and clutch plate (kg m^2)
    this.idleRPM = parameters.idle_rpm || 900;
    this.limiterRPM = parameters.limiter_rpm || 6600;
    this.torqueScale = 1;     // tuning: all of the torque of the engine, as a factor
    this.motoringFactor = 1;  // tuning: the engine braking, as a factor
    this.stallRPM = this.idleRPM * 0.4;
    this.maxRPM = this.limiterRPM + 1000;
    this.starterTorque = 150;

    this.omega = this.idleRPM * Math.PI / 30; // rad/s
    this.running = true;
    this.starting = false;
    this.throttleCut = 1; // 0..1 factor from the rev limiter, for the dashboard
    // The rev limiter cuts the fuel completely when the limit is reached, and gives it back after a time that makes the cuts come at a set rate
    // (limiter_hz, cuts per second): the cut lasts for the rest of the period that the fuel was on for. The engine bounces against the limit.
    // holdRPM is a lower limit that the car asks for (the two-step of the key, the launch control, Vehicle.js); 0 for none.
    this.limiterHz = parameters.limiter_hz || 12;
    this.twoStepRPM = parameters.two_step_rpm || Math.round(this.limiterRPM * 0.7 / 100) * 100;     // the lower limit of the two-step key
    this.launchRPM = parameters.launch_rpm || Math.round(this.limiterRPM * 0.6 / 100) * 100;        // the engine speed that the launch control holds
    this.holdRPM = 0;
    this.cutting = false;
    this.cutTime = 0;
    this.onTime = 1;
    this.cutLength = 0.05;
    this.noFuel = false;  // the tank is empty: the engine dies and does not start (Vehicle.js sets it)
    // A turbo: a share of the torque of the curve only comes with boost, which builds up with the throttle open above a
    // threshold speed over the spool time (the lag) and falls away fast when the throttle is shut. "turbo" in the engine of
    // car.json: { share: 0..1, spool: s, threshold_rpm }. Without it the engine is naturally aspirated.
    var turbo = parameters.turbo || null;
    this.turboShare = turbo ? Math.max(0, Math.min(0.9, turbo.share !== undefined ? turbo.share : 0.5)) : 0;
    this.turboSpool = turbo ? (turbo.spool || 0.4) : 0.4;
    this.turboThreshold = turbo ? (turbo.threshold_rpm || 2500) : 2500;
    this.boost = 0;       // 0..1, how much of the boost is there
    // The extras (CarTuning.js, car.json "extras"; the tuning menu sets them through Vehicle.retune): pops and bangs, and anti-lag.
    // Pops: unburnt fuel burns in the exhaust, at the start of every cut of the rev limiter, and after lifting off the throttle; the bangs are
    // events that the car shows (the flames) and plays (the sound): { strength, loud, flame }.
    // Anti-lag: off the throttle (or in a launch hold) the turbo is kept at a share of its boost, with fuel burning in the exhaust: the throttle
    // gives the full boost at once, the bangs go on, the fuel use is higher and the engine brakes less.
    this.extras = {};
    this.events = [];
    this.holding = false;      // the car holds the engine for a launch: the two-step, the transbrake, the launch control (Vehicle.js)
    this.alsActive = false;
    this.alsTimer = 0;
    this.fuelFactor = 1;       // the fuel use as a factor (more while the anti-lag works)
    var overrun = 0, previousThrottle = 0, cutWas = false;
    var engine = this;
    function bang(strength, loud, flame) { if(engine.events.length < 40) engine.events.push({ strength: strength, loud: loud, flame: flame }); }
    function stepExtras(throttle, dt, rpm) {
        var x = engine.extras;
        var popsOn = !!x.pops_on, als = !!x.antilag_on && engine.turboShare > 0;
        var off = throttle < 0.15;
        var wantAls = als && engine.running && rpm > x.antilag_rpm && (x.antilag_mode === "launch" ? engine.holding : (off || engine.holding));
        if(wantAls) engine.alsTimer += dt;
        else if(!als || (throttle > 0.3 && !engine.holding)) engine.alsTimer = 0;
        engine.alsActive = wantAls && engine.alsTimer < x.antilag_time;
        engine.fuelFactor = engine.alsActive ? 1 + x.antilag_fuel / 100 : 1;
        if(previousThrottle > 0.5 && throttle < 0.1 && rpm > x.pops_rpm) overrun = x.pops_overrun;
        if(throttle > 0.3) overrun = 0; else if(overrun > 0) overrun -= dt;
        previousThrottle = throttle;
        var loud = popsOn ? x.pops_loud / 100 : 1, flame = popsOn ? x.pops_flames / 100 : 1;
        var rate = 0;
        if(popsOn && rpm > x.pops_rpm && overrun > 0 && throttle < 0.1) {
            rate = 14 * x.pops_amount / 100 * Math.sqrt(overrun / Math.max(0.1, x.pops_overrun)) * Math.min(1, Math.max(0.3, rpm / engine.limiterRPM));
        }
        if(engine.alsActive) rate = Math.max(rate, 16 * x.antilag_bangs / 100);
        if(rate > 0 && Math.random() < rate * dt) bang((engine.alsActive ? 0.8 : 0.5) + Math.random() * 0.7, loud, flame);
        // at the start of every cut of the rev limiter: the fuel that is not burnt in the cylinder burns in the exhaust
        if(engine.cutting && !cutWas) {
            if((popsOn && Math.random() < x.pops_amount / 100 * (engine.holding ? 1 : 0.6)) || (engine.alsActive && Math.random() < 0.8 * x.antilag_bangs / 100)) bang(0.7 + Math.random() * 0.6, loud, flame);
        }
        cutWas = engine.cutting;
    }
    this.updateBoost = function (throttle, dt) {
        this.cutTime += dt; this.onTime += dt;
        var rpm = this.getRPM();
        stepExtras(throttle, dt, rpm);
        if(this.turboShare <= 0) { this.boost = 0; return; }
        var wanted = this.running ? Math.max(0, Math.min(1, throttle)) * Math.max(0, Math.min(1, (rpm - this.turboThreshold) / 2000)) : 0;
        if(this.alsActive) wanted = Math.max(wanted, this.extras.antilag_boost / 100 * Math.min(1, 0.4 + (rpm - this.extras.antilag_rpm) / 3000));
        var tau = wanted > this.boost ? this.turboSpool : this.turboSpool * 0.35;
        this.boost += (wanted - this.boost) * Math.min(1, dt / tau);
    };

    this.getPeakTorque = function() {
        var peak = 0;
        for(var i = 0; i < this.torque_curve.length; i++) peak = Math.max(peak, this.torque_curve[i].nm);
        return peak;
    };

    this.getRPM = function() {
        return this.omega * 30 / Math.PI;
    };

    // Full throttle torque (Nm) at an engine speed
    this.getTorque = function( rpm ) {
        var c = this.torque_curve;
        if(rpm <= c[0].rpm) return c[0].nm;
        for(var i = 1; i < c.length; i++) {
            if(rpm < c[i].rpm) {
                var f = (rpm - c[i - 1].rpm) / (c[i].rpm - c[i - 1].rpm);
                return c[i - 1].nm + (c[i].nm - c[i - 1].nm) * f;
            }
        }
        return c[c.length - 1].nm;
    };

    // Torque the engine loses when the throttle is closed (friction plus pumping losses, so engine braking)
    // (scaled to the size of the engine; the numbers are for an engine with a peak torque of about 580 Nm)
    var motoringScale = Math.max(0.3, Math.min(2.5, this.getPeakTorque() / 580));
    this.getMotoringTorque = function( rpm ) {
        return (30 + 0.0355 * rpm) * motoringScale * this.motoringFactor;
    };

    this.start = function() {
        if(!this.running) this.starting = true;
    };

    // Net torque (Nm) the engine delivers to the clutch for a throttle position (0..1)
    this.getNetTorque = function( throttle ) {
        var rpm = this.getRPM();

        if(this.noFuel) { this.running = false; this.starting = false; }
        if(!this.running) {
            // no combustion: only the losses (and the starter motor when it is cranking)
            var t = -this.getMotoringTorque(rpm);
            if(this.starting) {
                t += this.starterTorque;
                if(rpm > 550) {
                    this.running = true;
                    this.starting = false;
                }
            }
            return t;
        }

        if(rpm < this.stallRPM) {
            this.running = false;
            this.starting = false;
            return -this.getMotoringTorque(rpm);
        }

        // The idle controller opens the throttle to hold the idle speed, also against a load
        var idleThrottle = Math.max(0, Math.min(0.6, 0.2 + (this.idleRPM - rpm) * 0.0008));
        // the pedal opens the throttle plate faster than the torque grows: half a pedal is already 70% of the air
        var pedal = 1 - Math.pow(1 - Math.max(0, Math.min(1, throttle)), 1.8);
        var thr = Math.max(pedal, idleThrottle);

        // rev limiter: cut the fuel
        var limit = this.holdRPM > 0 ? Math.min(this.holdRPM, this.limiterRPM) : this.limiterRPM;
        if(this.cutting) {
            if(this.cutTime >= this.cutLength) { this.cutting = false; this.onTime = 0; }
        } else if(rpm >= limit) {
            this.cutting = true;
            this.cutTime = 0;
            this.cutLength = Math.max(0.008, 1 / this.limiterHz - this.onTime);       // the period of the cuts: what is left after the time that the fuel was on
        }
        this.throttleCut = this.cutting ? 0 : 1;
        thr *= this.throttleCut;

        var boosted = 1 - this.turboShare * (1 - this.boost); // the torque without boost is the share that is not from the turbo
        return this.getTorque(rpm) * this.torqueScale * boosted * thr - (1 - thr) * this.getMotoringTorque(rpm) * (this.alsActive ? 0.5 : 1);
    };
};
