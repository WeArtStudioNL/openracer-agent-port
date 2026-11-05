/*
 * CarDefaults.js
 *
 * Description: The settings of the cameras of a car (cars/<id>/car.json, "cameras"), with defaults from the size of the
 *              car for what is not in the configuration. Used by the game and by the car editor.
 *
 *   follow:  the camera behind the car that turns smoothly with the direction of the car (camera 1): distance, height above the road,
 *            look_height (the height above the road that it looks at), look_z (how far ahead of the middle of the car it looks, 0; negative: behind it), smoothing (how fast it follows, per second),
 *            fov_standing and fov_fast (the field of view at a standstill and at fov_full_speed in m/s: the faster, the wider), and
 *            dolly (0 to 1): the camera comes closer in the measure that the field of view widens, so that the car keeps its size in
 *            the picture and only the sense of speed changes (1); 0 leaves the camera where it is. The distance and the height are those at a standstill.
 *   cockpit: the camera in the car (camera 2): position [x, y, z] from the origin of the model (x to the left, y up from the
 *            height of the axles, z forward), the field of view, and hide_driver: the driver (the figure of Driver.js) is not drawn in this view.
 *   Every field of view is the vertical angle in degrees.
 */

OpenRacer.cameraSettings = function (config) {
    var d = config.dimensions;
    var r = config.chassis.tire_diameter / 2;
    var round = function (v, n) { var f = Math.pow(10, n); return Math.round(v * f) / f; };
    var given = config.cameras || {};
    var defaults = {
        follow: { distance: round(d.length * 1.55, 1), height: round(d.height * 1.6, 2), look_height: round(d.height * 0.6, 2), look_z: 0,
            smoothing: 3.5, fov_standing: 45, fov_fast: 75, fov_full_speed: 70, dolly: 1 },
        cockpit: { position: [round(d.width * 0.2, 2), round(d.height * 0.8 - r, 2), round(d.length * 0.05, 2)], fov: 75, hide_driver: false }
    };
    var result = {};
    Object.keys(defaults).forEach(function (name) {
        result[name] = Object.assign({}, defaults[name], given[name] || {});
        if(!Array.isArray(result[name].position) && name === "cockpit") result[name].position = defaults[name].position;
    });
    return result;
};

// Does the front wheel come up on full throttle? (a motorcycle: the car editor and the tuning menu say so, from the numbers, no simulation). The front comes up when the thrust at the rear wheel
// is more than the weight can hold down: a = g x (the distance of the centre of gravity from the rear contact) / (its height); the thrust is the peak torque of the engine through every gear, the
// final drive and the efficiency, over the radius of the tyre, over the mass (with the rider), and the rear tyre cannot give more than its grip times g. The bench (tools/bike-v2-test.js
// --only=wheelie) measures the same on the real model: a bike that pulls twice the limit loops over without the wheelie control. Returns null for anything but a motorcycle or without the numbers,
// else { limit, gears: [{ gear, g }], first (the first gear that lifts the front, 1 based, or 0), level: "ok" | "wheelie" | "loops", text }; g in units of 9.81 m/s^2.
OpenRacer.wheelieCheck = function (config) {
    var ch = config && config.chassis, dt = (config && config.drivetrain) || {}, eng = (config && config.engine) || {};
    if(!config || config.type !== "motorcycle" || !ch || !eng.torque_curve || !dt.gear_ratios || !dt.gear_ratios.length || !(dt.final_drive > 0) || !(ch.tire_diameter > 0) || !(ch.wheelbase > 0) || !(ch.cg_height > 0) || !(ch.mass > 0)) return null;
    var fitted = config.wheels && config.wheels.library && config.wheels.library.rear, rider = OpenRacer.Motorcycle && OpenRacer.Motorcycle.riderMass ? OpenRacer.Motorcycle.riderMass(config) : 80;
    var r = (fitted && fitted.custom && fitted.custom.diameter > 0 ? fitted.custom.diameter : ch.tire_diameter) / 2, scale = eng.power_scale !== undefined ? eng.power_scale : 1;
    var peak = 0; eng.torque_curve.forEach(function (p) { peak = Math.max(peak, Array.isArray(p) ? p[1] : p.nm); });
    var mass = ch.mass + (ch.includes_rider ? 0 : rider), efficiency = dt.efficiency !== undefined ? dt.efficiency : 0.9;
    var wd = ch.weight_distribution > 0 ? ch.weight_distribution : 0.5, limit = (ch.wheelbase * wd) / ch.cg_height, grip = (config.tyres && config.tyres.grip) || 0;      // (no grip known: the tyre is taken to hold)
    var gears = dt.gear_ratios.map(function (ratio, i) {
        var thrust = peak * scale * efficiency * ratio * dt.final_drive / r;
        return { gear: i + 1, g: thrust / (mass * 9.81), grip: grip };
    });
    // (the thrust is the first-order sum: the bench measures less in first gear while the clutch slips and more after a spinning wheel grips again; the rear tyre has to hold the limit too, else it spins first)
    var holds = !(grip > 0) || grip >= 0.95 * limit, first = 0; gears.forEach(function (g) { if(!first && g.g > limit) first = g.gear; });
    var worst = gears.reduce(function (m, g) { return Math.max(m, g.g); }, 0), level = !holds ? "ok" : worst > 1.8 * limit ? "loops" : worst > limit ? "wheelie" : "ok";
    var lifted = gears.filter(function (g) { return g.g > limit; }).map(function (g) { return g.gear; });
    var text = level === "ok" ? "" : (level === "loops" ? "loops over" : "wheelie") + " on full throttle in gear " + (lifted.length > 1 ? lifted[0] + "-" + lifted[lifted.length - 1] : lifted[0]) +
        ": thrust up to " + worst.toFixed(2) + " g, the front comes up at " + limit.toFixed(2) + " g (wheelie control and traction control tame it)";
    return { limit: limit, gears: gears, first: first, level: level, text: text };
};

// The top speed of a car in m/s, worked out from its configuration (no simulation): in every gear the speed at which the thrust at the wheels (the torque of the engine at that
// speed, through the gears and the final drive and the efficiency of the drive) is as big as the drag of the air and the rolling resistance, up to the rev limit; the highest of them.
// A car with one gear or a CVT is the same sum with its ratio (the lowest ratio of a CVT). Returns 0 when the numbers are not there. Downforce and wheel slip are not counted.
OpenRacer.topSpeed = function (config) {
    var ch = config && config.chassis, dt = (config && config.drivetrain) || {}, eng = (config && config.engine) || {}, dim = (config && config.dimensions) || {};
    var curve = eng.torque_curve, gears = dt.gear_ratios;
    if(!ch || !curve || curve.length < 2 || !gears || !gears.length || !(dt.final_drive > 0) || !(eng.limiter_rpm > 0) || !(ch.tire_diameter > 0)) return 0;
    // (the tyre of the driven axle as it is fitted: a custom tyre of the wheel library has its own size; car.json's tire_diameter is the tyre the car was made with)
    var drivenAxle = dt.drive === "fwd" ? "front" : "rear", fitted = config.wheels && config.wheels.library && config.wheels.library[drivenAxle];
    var r = (fitted && fitted.custom && fitted.custom.diameter > 0 ? fitted.custom.diameter : ch.tire_diameter) / 2, scale = eng.power_scale !== undefined ? eng.power_scale : 1, efficiency = dt.efficiency || 0.92;
    var cdrag = 0.5 * (ch.drag_coefficient || 0.3) * (dim.width || 1.8) * (dim.height || 1.4) * 0.85 * 1.29;
    var roll = ((config.tyres && config.tyres.rolling_resistance) || 0.015) * (ch.mass || 1000) * 9.81;
    var torque = function (rpm) {
        for(var i = 1; i < curve.length; i++) {
            if(rpm <= curve[i][0]) { var a = curve[i - 1], b = curve[i]; return a[1] + (b[1] - a[1]) * (rpm - a[0]) / Math.max(1e-9, b[0] - a[0]); }
        }
        return 0;
    };
    // (a CVT takes any ratio between its lowest and its highest, the one where the engine pulls hardest: the lowest alone held the engine at a low speed, and the
    // menu gave the i30 with its CVT a top speed of 110 km/h)
    var best = 0, ratios = gears;
    if(dt.gearbox === "cvt") {
        var lo = Math.min.apply(null, gears), hi = Math.max.apply(null, gears);
        ratios = [];
        for(var k = 0; k <= 40; k++) ratios.push(lo + (hi - lo) * k / 40);
    }
    ratios.forEach(function (ratio) {
        var total = ratio * dt.final_drive, vMax = eng.limiter_rpm * Math.PI / 30 * r / total;
        for(var v = vMax; v > 0.5; v -= 0.1) {
            var rpm = v / r * total * 30 / Math.PI, thrust = torque(rpm) * scale * efficiency * total / r;
            if(thrust >= cdrag * v * v + roll) { best = Math.max(best, v); break; }
        }
    });
    return best;
};
