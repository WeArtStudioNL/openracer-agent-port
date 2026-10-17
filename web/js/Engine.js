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

    // Full throttle brake power of the 351 (bhp at rpm); the torque is derived from it
    this.power_curve = [
        { "rpm" : 3000, "bhp" : 237.5 },
        { "rpm" : 3500, "bhp" : 280 },
        { "rpm" : 4000, "bhp" : 327 },
        { "rpm" : 4500, "bhp" : 360 },
        { "rpm" : 5000, "bhp" : 370 },
        { "rpm" : 5300, "bhp" : 379 },
        { "rpm" : 5500, "bhp" : 375 },
        { "rpm" : 6000, "bhp" : 350 }
    ];

    // Full throttle torque in Nm. Below 3000 rpm a big V8 already has most of its torque, and
    // the curve falls away past the power peak. The points from 3000 rpm come from the power curve.
    this.torque_curve = [
        { "rpm" : 0,    "nm" : 0 },
        { "rpm" : 300,  "nm" : 110 },
        { "rpm" : 800,  "nm" : 250 },
        { "rpm" : 1500, "nm" : 400 },
        { "rpm" : 2000, "nm" : 480 },
        { "rpm" : 2500, "nm" : 530 }
    ];
    for(var i = 0; i < this.power_curve.length; i++) {
        this.torque_curve.push({
            "rpm" : this.power_curve[i].rpm,
            "nm" : this.power_curve[i].bhp * 5252 / this.power_curve[i].rpm * 1.35581795
        });
    }
    this.torque_curve.push({ "rpm" : 6500, "nm" : 330 });
    this.torque_curve.push({ "rpm" : 7500, "nm" : 150 });

    this.inertia = parameters.inertia || 0.4; // crankshaft, flywheel and clutch plate (kg m^2)
    this.idleRPM = 900;
    this.stallRPM = 350;
    this.limiterRPM = 6600;
    this.maxRPM = 7600;
    this.starterTorque = 150;

    this.omega = this.idleRPM * Math.PI / 30; // rad/s
    this.running = true;
    this.starting = false;
    this.throttleCut = 1; // 0..1 factor from the rev limiter, for the dashboard

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
    this.getMotoringTorque = function( rpm ) {
        return 30 + 0.0155 * rpm + 0.02 * rpm;
    };

    this.start = function() {
        if(!this.running) this.starting = true;
    };

    // Net torque (Nm) the engine delivers to the clutch for a throttle position (0..1)
    this.getNetTorque = function( throttle ) {
        var rpm = this.getRPM();

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
        this.throttleCut = 1;
        if(rpm > this.limiterRPM - 200) {
            this.throttleCut = Math.max(0, (this.limiterRPM - rpm) / 200);
        }
        thr *= this.throttleCut;

        return this.getTorque(rpm) * thr - (1 - thr) * this.getMotoringTorque(rpm);
    };
};
