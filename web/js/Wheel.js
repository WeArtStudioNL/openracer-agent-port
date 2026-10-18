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
 * Wheel.js
 *
 * Author: Chris Barnard
 * Description: One wheel with its tyre: a spinning inertia (angular speed omega) and the
 *              forces between the tyre and the road. The tyre force follows from the slip
 *              ratio and slip angle through a friction circle with a peak and a lower sliding
 *              grip, so a wheel can hook up, spin or lock depending on the load on it.
 *              Vehicle.js drives the wheels; the optional 3D object is only for display.
 */

OpenRacer.Wheel = function (parameters) {
    this.name = parameters.name;
    this.diameter = parameters.diameter;
    this.radius = this.diameter / 2;
    this.diameterOver2 = this.radius;
    this.right = parameters.right;       // this wheel is on the right side of the car
    this.front = parameters.front;       // front axle (steers)
    this.driven = parameters.driven;     // receives engine torque
    this.mass = parameters.mass;
    this.inertia = parameters.inertia || 1.6; // wheel, tyre and brake disc (kg m^2)
    this.maxBrakeTorque = parameters.maxBrakeTorque || 1500; // Nm
    this.object = parameters.object || null;
    this.a = 0; // position relative to the centre of gravity: forward (m)
    this.b = 0; // and to the right (m)

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.weight = this.mass * 9.81; // vertical load (N)
    this.omega = 0;                 // angular speed (rad/s), positive when rolling forward
    this.slipRatio = 0;             // longitudinal slip (lagged), negative while braking
    this.slipTan = 0;               // tan of the slip angle (lagged)
    this.turnAngle = 0;
    this.forwardSpeed = 0;          // speed of the contact patch along the wheel (m/s)
    this.forwardMPH = 0;
    this.RPM = 0;
    this.surface = "road";
    this.groundY = 0;               // height of the road below the wheel
    this.compression = 0;           // suspension compression relative to rest (m), for display
    this.onGround = true;
    this.slip = false;              // is the tyre sliding?
    this.tc = false;                // is traction control cutting power for this wheel?
    this.abs = false;               // is ABS releasing this wheel's brake?
    this.esc = false;               // is the stability control braking this wheel?
    this.s = 0;                     // how far the tyre is towards its limit: 1 is the peak grip, from the slip ratio and the slip angle together
    this.absFactor = 1;
    this.fx = 0;                    // tyre force along the wheel (N)
    this.fy = 0;                    // tyre force across the wheel (N)
    this.brakeTorque = 0;
    this.spin = 0;                  // angle of the wheel for display

    // Tyre model parameters
    this.relaxation = 0.35;     // relaxation length: the tyre needs this much rolling to build up slip (m)
    this.slipPeak = 0.14;       // slip ratio with the most grip
    this.anglePeak = 0.15;      // tan of the slip angle with the most grip
    this.rollingResistance = 0.015;
    this.gripScale = 1;         // tuning: the grip of the tyre, as a factor
    this.loadSensitivity = 0.00007; // grip coefficient lost per extra Newton of load above the nominal load (a tyre grips less
                                    // per Newton the more it is loaded: the axle that gets the most load transfer loses the most grip).
                                    // 0.00007 loses a fifth of the grip when the load doubles, as a road tyre does (tools/physics-bench.js)
    this.lateralGrip = 1.05;    // the grip across the tyre as a factor of the grip along it
    this.shapeX = 0;            // the E of the magic formula along the tyre
    this.shapeY = 0;            // and across it
    this.stiffnessBias = 1;     // the stiffness of the tyre against the slip angle, as a factor of the front tyres (the rear is a bit stiffer)
    this.nominalLoad = 3500;

    // Brings the wheel to the position and rotation display state. Safe without a 3D object.
    this.turn = function (turnAngle) {
        this.turnAngle = turnAngle;
        if(this.object) this.object.children[0].rotation.y = -turnAngle;
    };

    this.getWheelVelocity = function () {
        return Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
    };

    // Tyre force for a slip ratio and slip angle on a surface, with the load on the tyre. Returns the forces in the wheel frame:
    // fx along the wheel (forward) and fy across it, towards the side that the slip angle is measured to the other side of: the
    // force always opposes the slip.
    //
    // The Pacejka "magic formula" gives the force for each slip on its own:
    //     F = D sin(C atan(B x - E (B x - atan(B x))))
    // with the slip ratio as x for the longitudinal force and the tangent of the slip angle for the lateral force. D is the peak
    // (the grip times the load), C sets the force when the tyre slides (the sliding grip of the surface), B puts the peak at the
    // slip of the tyre, and E bends the curve. The force on the tyre is not the two together: the tyre has only a grip to
    // spend, a friction circle (here an ellipse, for a tyre that grips a little more across than along). When the two forces
    // together are more than the grip, both are scaled back, so a tyre that brakes hard has less to corner with.
    this.tyreForce = function (kappa, tanAlpha, load, surface) {
        var grip = surface.static * this.gripScale * (this.condition || 1); // condition: the temperature and the wear of the tyre (Vehicle.js)
        var mu = Math.min(1.4 * grip, Math.max(0.2 * grip, grip - this.loadSensitivity * (load - this.nominalLoad)));
        var slidingRatio = Math.min(0.98, surface.kinetic / surface.static);
        var C = 2 - (2 / Math.PI) * Math.asin(slidingRatio);
        var peak = Math.tan(Math.PI / (2 * C)); // B x at the peak of the curve

        var Dx = mu * load;
        var Dy = mu * load * this.lateralGrip;
        var Bx = peak / this.slipPeak, By = peak / this.anglePeak;
        var bk = Bx * kappa, ba = By * tanAlpha;
        var fx = Dx * Math.sin(C * Math.atan(bk - this.shapeX * (bk - Math.atan(bk))));
        var fy = -Dy * Math.sin(C * Math.atan(ba - this.shapeY * (ba - Math.atan(ba))));

        // how far the tyre is towards its limit, for the traction control, ABS and slide detection
        var sx = kappa / this.slipPeak, sy = tanAlpha / this.anglePeak;
        this.s = Math.sqrt(sx * sx + sy * sy);

        var ex = fx / Dx, ey = fy / Dy;
        var used = Math.sqrt(ex * ex + ey * ey);
        if(used > 1) {
            fx /= used;
            fy /= used;
        }
        this.fx = fx;
        this.fy = fy;
        this.slip = this.s > 1.15;
    };
};
