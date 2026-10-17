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

        return this.getTorque(rpm) * this.torqueScale * thr - (1 - thr) * this.getMotoringTorque(rpm);
    };
};
