/*
 * CarDefaults.js
 *
 * Description: The settings of the cameras of a car (cars/<id>/car.json, "cameras"), with defaults from the size of the
 *              car for what is not in the configuration. Used by the game and by the car editor.
 *
 *   chase:   the fixed camera behind the car (camera 1): distance behind the middle of the car, height above the road, field of view.
 *   follow:  the camera behind the car that turns smoothly with the direction of the car (camera 2): distance, height above the road,
 *            look_height (the height above the road that it looks at), smoothing (how fast it follows, per second),
 *            fov_standing and fov_fast (the field of view at a standstill and at fov_full_speed in m/s: the faster, the smaller).
 *   cockpit: the camera in the car (camera 3): position [x, y, z] from the origin of the model (x to the left, y up from the
 *            height of the axles, z forward) and the field of view.
 *   Every field of view is the vertical angle in degrees.
 */

OpenRacer.cameraSettings = function (config) {
    var d = config.dimensions;
    var r = config.chassis.tire_diameter / 2;
    var round = function (v, n) { var f = Math.pow(10, n); return Math.round(v * f) / f; };
    var given = config.cameras || {};
    var defaults = {
        chase: { distance: round(d.length * 2.08, 1), height: round(r + 2, 2), fov: 35 },
        follow: { distance: round(d.length * 1.55, 1), height: round(d.height * 1.6, 2), look_height: round(d.height * 0.6, 2),
            smoothing: 3.5, fov_standing: 62, fov_fast: 30, fov_full_speed: 70 },
        cockpit: { position: [round(d.width * 0.2, 2), round(d.height * 0.8 - r, 2), round(d.length * 0.05, 2)], fov: 75 }
    };
    var result = {};
    Object.keys(defaults).forEach(function (name) {
        result[name] = Object.assign({}, defaults[name], given[name] || {});
        if(!Array.isArray(result[name].position) && name === "cockpit") result[name].position = defaults[name].position;
    });
    return result;
};
