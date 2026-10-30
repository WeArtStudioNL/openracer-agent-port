/*
 * CarTuning.js
 *
 * Description: The table of everything that can be set on a car (the groups of the tuning menu: the key, the label, the unit, the
 *              range and the step, in the units of the menu), and the three ways through it: the values of a car.json (fromConfig),
 *              the settings for the physics (toRetune, for Vehicle.retune) and a car.json with the values in it (toConfig). The
 *              tuning menu of the game (Tuning.js) and the car editor both use it, so they always agree on what a car has.
 */

OpenRacer.CarTuning = (function () {
    var GROUPS = [
        { name: "Chassis", items: [
            // the colours of the car: the meshes of the model called body and the rims (the wheels of the model called rim, the rims of the wheel library); a colour picker
            // in the tuning menu (Tuning.js), "" is the car as made (the colours of the model)
            ["body_color", "Colour of the body (the material carpaint)", "", 0, 0, 0],
            ["rim_color", "Colour of the rims (the material rimpaint)", "", 0, 0, 0],
            ["body_finish", "Finish of the body", "", 0, 0, 0],
            ["rim_finish", "Finish of the rims", "", 0, 0, 0],
            ["body_pattern", "Flake pattern of the body", "", 0, 0, 0],
            ["body_flake", "Flake size of the body (metal flake)", "%", 2, 400, 1],
            ["body_uv", "Flake map of the body (the UV map)", "", 0, 0, 0],
            ["rim_pattern", "Flake pattern of the rims", "", 0, 0, 0],
            ["rim_flake", "Flake size of the rims (metal flake)", "%", 2, 400, 1],
            ["rim_uv", "Flake map of the rims (the UV map)", "", 0, 0, 0],
            ["mass", "Mass", "kg", 300, 6000, 10],
            ["front_weight", "Weight on the front axle", "%", 25, 75, 0.5],
            ["cg_height", "Height of the centre of gravity", "m", 0.15, 1.5, 0.01],
            ["roll_front", "Roll stiffness at the front", "%", 10, 90, 1],
            ["spring_front", "Front springs (wheel rate)", "N/mm", 3, 200, 1],
            ["spring_rear", "Rear springs (wheel rate)", "N/mm", 3, 200, 1],
            ["damping_front", "Front dampers", "%", 5, 200, 1],
            ["damping_rear", "Rear dampers", "%", 5, 200, 1],
            ["unsprung", "Suspension (none: a kart, the frame stands on its tyres)", "", 0, 0, 0],
            ["frame_torsion", "Frame stiffness against twisting (a kart: 0 is a rigid frame)", "N·m/°", 0, 2000, 10],
            ["inner_lift", "Inner rear wheel lift in a fast bend (a kart)", "mm", 0, 60, 1],
            ["suspension_travel", "Suspension travel before the bump stop", "cm", 1, 120, 1],
            ["suspension_length", "Room for the travel (the spring from the mount to the middle of the wheel)", "cm", 10, 150, 1],
            ["spring_progression", "Progressive springs (extra stiffness at the end of the travel)", "%", 0, 800, 10],
            ["damping_rebound", "Rebound damping (against compression damping)", "×", 0.5, 6, 0.1],
            ["ride_front", "Ride height at the front (from the car as made)", "mm", -150, 150, 5],
            ["ride_rear", "Ride height at the rear", "mm", -150, 150, 5],
            ["roll_center_front", "Roll centre at the front", "cm", -20, 60, 1],
            ["roll_center_rear", "Roll centre at the rear", "cm", -20, 60, 1],
            ["toe_front", "Toe at the front (positive: toe-in)", "°", -4, 4, 0.05],
            ["toe_rear", "Toe at the rear", "°", -4, 4, 0.05],
            ["camber_front", "Camber at the front (negative: top in)", "°", -12, 6, 0.1],
            ["camber_rear", "Camber at the rear", "°", -12, 6, 0.1],
            ["roll_camber", "Camber lost in roll", "%", 0, 150, 5]
        ] },
        { name: "Tyres", items: [
            ["compound", "Tyre compound", "", 0, 0, 0],
            ["tyre_damage", "Tyre damage", "", 0, 0, 0],
            // the rims and the tyres of the wheel library (WheelLibrary.js; selects: the car is built again). A tyre of the library brings its own shell: the shell sliders go
            ["rim_front", "Rim at the front (the wheel library)", "", 0, 0, 0],
            ["tyre_front", "Tyre at the front (a tyre of the wheel library: only for the cars that have one)", "", 0, 0, 0],
            ["rim_rear", "Rim at the rear", "", 0, 0, 0],
            ["tyre_rear", "Tyre at the rear", "", 0, 0, 0],
            // a custom tyre (WheelLibrary.js: made from the numbers; the width, the nodes and the inner shell are the shell sliders below, the rim takes the size of the inner shell)
            ["tyre_diameter_front", "Tyre at the front: diameter", "mm", 300, 1100, 5],
            ["tyre_height_front", "Tyre at the front: height of the sidewall (the rim takes what is left)", "mm", 20, 300, 5],
            ["rubber_front", "Tyre at the front: rubber", "", 0, 100, 1],
            ["tyre_diameter_rear", "Tyre at the rear: diameter", "mm", 300, 1100, 5],
            ["tyre_height_rear", "Tyre at the rear: height of the sidewall", "mm", 20, 300, 5],
            ["rubber_rear", "Tyre at the rear: rubber", "", 0, 100, 1],
            ["tyre_width", "Tyre: width of the tread, front (0: from the wheel)", "cm", 0, 60, 1],
            ["tyre_width_rear", "Tyre: width of the rear tread (0: as the front)", "cm", 0, 60, 1],
            ["tyre_rings", "Tyre: rings of nodes across the tread", "", 1, 5, 1],
            ["tyre_segments", "Tyre: nodes round the wheel (the sides of the tyre: 4 is a square, 6 a hexagon; fewer is cheaper, the road is still felt between the nodes)", "", 4, 72, 1],
            ["tyre_inner_ratio", "Tyre: radius of the inner shell (the rim), as a share of the tyre", "%", 30, 90, 1],
            ["tyre_carcass", "Tyre: softness of the carcass, how far a node goes in before its cable is slack and the air carries it (0: 1.8 times the static deflection of the tyre, which gives it the stiffness of the car's tyre rate; a few mm is a very stiff tyre)", "mm", 0, 80, 0.5],
            ["tyre_stiff_x", "Tyre: stiffness of the tread along the tyre (x load)", "", 4, 60, 0.5],
            ["tyre_stiff_y", "Tyre: stiffness of the tread across the tyre (x load)", "", 4, 60, 0.5],
            ["grip", "Grip", "%", 20, 300, 1],
            ["grip_balance", "Grip of the rear tyres (as a share of the front)", "%", 40, 200, 1],
            ["cornering", "Stiffness against the slip angle", "%", 20, 300, 1],
            ["pressure_front", "Tyre pressure at the front", "bar", 0.5, 6, 0.1],
            ["pressure_rear", "Tyre pressure at the rear", "bar", 0.5, 6, 0.1],
            ["rolling_resistance", "Rolling resistance", "", 0.002, 0.1, 0.001],
            ["tyre_heating", "Heating up (wear and fuel on)", "%", 5, 800, 5],
            ["tyre_life", "Life of the tyres", "%", 5, 1000, 5]
        ] },
        { name: "Fuel", items: [
            ["tank", "Tank", "L", 2, 400, 1],
            ["fuel_use", "Fuel use", "%", 5, 1000, 5]
        ] },
        { name: "Engine", items: [
            ["idle_rpm", "Idle speed", "rpm", 300, 4000, 50],
            ["limiter_rpm", "Rev limit", "rpm", 2000, 20000, 100],
            ["limiter_hz", "Rev limiter: cuts per second", "Hz", 1, 60, 1],
            ["engine_inertia", "Inertia of the engine", "kg m²", 0.01, 3, 0.01],
            ["engine_braking", "Engine braking", "%", 0, 500, 5],
            ["turbo_share", "Turbo: share of the torque that is boost (0: no turbo)", "%", 0, 95, 5],
            ["turbo_spool", "Turbo: spool time (the lag)", "s", 0.02, 5, 0.05],
            ["turbo_threshold", "Turbo: from", "rpm", 500, 10000, 100],
            ["turbo_boost", "Turbo: boost pressure at full boost (0: the share of the torque above is used)", "bar", 0, 10, 0.05],
            ["turbo_intercooler", "Turbo: intercooler efficiency", "%", 0, 99, 1],
            ["turbo_efficiency", "Turbo: compressor efficiency", "%", 40, 90, 1],
            ["gen_power", "Torque curve: peak power (a change makes a new curve)", "hp", 20, 3000, 5],
            ["gen_peak_rpm", "Torque curve: peak power at", "rpm", 1500, 15000, 100]
        ] },
        { name: "Transmission", items: [
            ["drive", "Drive", "", 0, 0, 0],
            ["final_drive", "Final drive", "", 1, 10, 0.05],
            ["shift_time", "Shift time (without a clutch pedal)", "s", 0.02, 3, 0.01],
            ["clutch_start_rpm", "Automatic clutch: starts to grip at", "rpm", 300, 10000, 50],
            ["clutch_full_rpm", "Automatic clutch: grips fully at", "rpm", 400, 12000, 50],
            ["gearbox", "Gearbox", "", 0, 0, 0],
            ["shift_style", "Shift pattern (automatic gearboxes)", "", 0, 0, 0],
            ["cvt_rpm", "CVT: engine speed at full throttle", "rpm", 1000, 20000, 100],
            ["tc_stall_rpm", "Torque converter: stall speed", "rpm", 500, 8000, 50],
            ["tc_ratio", "Torque converter: torque ratio at stall", "", 1, 4, 0.05],
            ["gears", "Gears (a CVT runs between the first and the last)", "", 0, 0, 0],
            ["reverse_ratio", "Reverse", "", 0.5, 10, 0.05],
            ["clutch", "Clutch capacity (x peak torque)", "", 0.5, 6, 0.05],
            ["diff", "Differential", "", 0, 0, 0],
            ["diff_preload", "Limited slip: preload", "Nm", 0, 2000, 10],
            ["diff_power", "Limited slip: lock under power", "%", 0, 100, 1],
            ["diff_coast", "Limited slip: lock off the throttle", "%", 0, 100, 1],
            ["diff_lock", "Limited slip: build-up", "Nm/(rad/s)", 0, 1000, 5],
            ["center_diff", "Centre differential (all wheel drive)", "", 0, 0, 0],
            ["center_split", "Torque to the front (all wheel drive)", "%", 0, 100, 1]
        ] },
        { name: "Brakes", items: [
            ["brake_total", "Brakes: front and rear together (per side)", "Nm", 100, 15000, 50],
            ["brake_bias", "Brake bias: the share of the front", "%", 20, 95, 1]
        ] },
        { name: "Aerodynamics and steering", items: [
            ["drag_coefficient", "Drag coefficient", "", 0.05, 2, 0.01],
            ["downforce_front", "Downforce at the front axle at 100 km/h (negative: lift)", "N", -10000, 20000, 50],
            ["downforce_rear", "Downforce at the rear axle at 100 km/h", "N", -10000, 20000, 50],
            ["max_steer_deg", "Steering lock", "°", 5, 80, 1],
            ["ackermann", "Ackermann (the inner wheel steers more)", "%", -50, 150, 5]
        ] },
        { name: "Suspension and driveline", items: [
            ["susp_front", "Suspension at the front (the parts library; the car is built again)", "", 0, 0, 0],
            ["susp_rear", "Suspension at the rear", "", 0, 0, 0],
            ["engine_place", "Engine placement (the driveline)", "", 0, 0, 0],
            ["efficiency", "Efficiency of the driveline", "", 0.5, 1, 0.01],
            ["tc_lockup", "Torque converter: lock-up clutch", "", 0, 0, 0]
        ] },
        { name: "Size and steering wheel", items: [
            ["length", "Length", "m", 1, 8, 0.01],
            ["width", "Width", "m", 0.5, 3.5, 0.01],
            ["height", "Height", "m", 0.4, 3.5, 0.01],
            ["steering_degrees", "Steering wheel: turn at full lock (each way; 450 is 900° lock to lock)", "°", 30, 1000, 10]
        ] },
        { name: "Cameras", items: [
            ["cam_follow_distance", "Follow camera: distance", "m", 1, 20, 0.1],
            ["cam_follow_height", "Follow camera: height", "m", 0, 10, 0.05],
            ["cam_follow_look_height", "Follow camera: looks at a height of", "m", -1, 5, 0.05],
            ["cam_follow_look_z", "Follow camera: looks ahead of the car by", "m", -5, 5, 0.1],
            ["cam_follow_smoothing", "Follow camera: smoothing", "", 0.2, 20, 0.1],
            ["cam_follow_fov_standing", "Follow camera: field of view standing", "°", 20, 120, 1],
            ["cam_follow_fov_fast", "Follow camera: field of view at speed", "°", 20, 140, 1],
            ["cam_follow_fov_full_speed", "Follow camera: that field of view from", "km/h", 10, 400, 5],
            ["cam_follow_dolly", "Follow camera: dolly with the speed", "", 0, 3, 0.05],
            ["cam_cockpit_x", "Cockpit camera: to the left", "m", -1.5, 1.5, 0.01],
            ["cam_cockpit_y", "Cockpit camera: height", "m", -1, 3, 0.01],
            ["cam_cockpit_z", "Cockpit camera: forward", "m", -3, 3, 0.01],
            ["cam_cockpit_fov", "Cockpit camera: field of view", "°", 30, 130, 1]
        ] },
        { name: "Soft body", items: [
            ["sb_enabled", "The car dents (the shell of nodes; the car is built again)", "", 0, 0, 0],
            ["sb_max_nodes", "Nodes of the shell at most", "", 10, 120, 5],
            ["sb_wheel_strength", "A wheel comes off at a hit of (0: never)", "kN s", 0, 200, 1]
        ] },
        { name: "Motorcycle", items: [
            ["bike_max_lean", "Lean at most", "°", 20, 75, 1],
            ["bike_fast_lean", "Lean the keys can ask for at speed", "°", 5, 60, 1],
            ["bike_rake", "Rake of the fork", "°", 15, 40, 0.5],
            ["bike_rider_mass", "Rider", "kg", 30, 200, 1],
            ["bike_hang_off", "The rider hangs off the seat by", "m", 0, 1, 0.02],
            ["bike_max_lateral_g", "Lateral grip of the tyres", "g", 0.3, 2.5, 0.05],
            ["bike_balance", "Balance of the rider", "", 0.1, 4, 0.05],
            ["bike_fork_dive", "Dive of the fork on the brakes", "", 0, 3, 0.05]
        ] },
        { name: "Engine sound", items: [
            ["es_volume", "Volume", "", 0, 5, 0.05],
            ["es_convolution", "Through the exhaust (impulse response)", "", 0, 1, 0.05],
            ["es_audio_volume", "Exhaust volume", "", 0, 10, 0.1],
            ["es_hf_gain", "High frequency gain", "", 0, 0.2, 0.005],
            ["es_noise", "Low frequency noise", "", 0, 1, 0.05],
            ["es_jitter", "High frequency noise", "", 0, 2, 0.05],
            ["es_exhaust_length", "Exhaust length", "m", 0.3, 6, 0.1],
            ["es_primary_length", "Primary tube length", "m", 0.1, 2, 0.05],
            ["es_idle_pressure", "Manifold pressure at idle", "atm", 0.1, 0.9, 0.05]
        ] }
    ];

    // The optional extras: each has a checkbox (key + "_on") that opens its settings in the tuning menu. The values are kept in car.json under "extras".
    // A select (antilag_mode) is made in Tuning.js.
    // Which settings apply, from the values of the others: a setting that cannot do anything is not shown (the tuning menu of the game and the car editor): the CVT's engine speed
    // only with a CVT, the stall speed only with a torque converter, the clutch not with one, the limited slip's settings only with a limited slip, the centre differential only with
    // all wheel drive, the turbo's lag only with a turbo, and the anti-lag (an extra) only with a turbo
    // the peak power of a torque curve ([[rpm, nm], ...]) in hp, and where it is; and a curve from a peak (the generator of the car editor: p = P (x + x² − x³), x = rpm / peak)
    function peakOf(curve) {
        if(!curve || curve.length < 2) return null;
        var hp = 0, at = 0;
        curve.forEach(function (p) { var rpm = Array.isArray(p) ? p[0] : p.rpm, nm = Array.isArray(p) ? p[1] : p.nm, h = nm * rpm * Math.PI / 30 / 745.7; if(h > hp) { hp = h; at = rpm; } });
        return { hp: hp, rpm: at };
    }
    function generateCurve(hp, peakRpm, limiter) {
        var watts = hp * 745.7, curve = [[0, 0]], limit = Math.max(limiter || 0, peakRpm * 1.1);
        for(var rpm = 500; rpm <= limit + 600; rpm += 500) {
            var x = rpm / peakRpm, p = watts * (x + x * x - x * x * x);
            curve.push([rpm, Math.max(0, Math.round(p / (rpm * Math.PI / 30) * 10) / 10)]);
        }
        return curve;
    }
    var BIKE = { max_lean_deg: 52, fast_lean_deg: 30, rake_deg: 24.5, rider_mass: 80, hang_off: 0.3, max_lateral_g: 0.9, balance: 1, fork_dive: 1 };

    function visible(key, v) {
        var g = v.gearbox || "gears", lsd = v.diff === "lsd", awd = v.drive === "awd", turbo = v.turbo_share > 0 || v.turbo_boost > 0;
        switch(key) {
            case "shift_time": return g !== "cvt";
            case "clutch": case "clutch_start_rpm": case "clutch_full_rpm": return g !== "torque-converter";
            case "cvt_rpm": return g === "cvt";
            case "tc_stall_rpm": case "tc_ratio": return g === "torque-converter";
            case "diff_preload": case "diff_power": case "diff_coast": case "diff_lock": return lsd;
            case "center_diff": return awd;
            case "center_split": return awd && v.center_diff !== "locked";
            case "turbo_spool": case "turbo_threshold": case "turbo_boost": return turbo;
            case "turbo_intercooler": case "turbo_efficiency": return v.turbo_boost > 0;
            case "tc_lockup": return g === "torque-converter";
            // (the tyre of a rim of the library is a custom one: made from the numbers; the tyres of the library stay for the cars that have one)
            case "tyre_inner_ratio": return !(customTyre(v, "front") && customTyre(v, "rear"));
            case "rim_front": case "rim_rear": return v.model_tyres !== "on";
            case "tyre_front": return !!v.tyre_front && v.tyre_front !== "custom";
            case "tyre_rear": return !!v.tyre_rear && v.tyre_rear !== "custom";
            case "tyre_diameter_front": case "tyre_height_front": case "rubber_front": return customTyre(v, "front");
            case "tyre_diameter_rear": case "tyre_height_rear": case "rubber_rear": return customTyre(v, "rear");
            case "shift_style": return g === "torque-converter" || g === "dct" || g === "amt";
            case "sb_max_nodes": case "sb_wheel_strength": return v.sb_enabled !== "off";
            case "body_flake": case "body_pattern": case "body_uv": return v.body_finish === "flake";
            case "rim_flake": case "rim_pattern": case "rim_uv": return v.rim_finish === "flake";
            case "es_exhaust_length": case "es_primary_length": return !v.engine_build;      // (the built engine has them)
            // no suspension: the springs, the dampers, the travel, the progression, the rebound and the ride height do nothing (the tyre is the spring; the roll stiffness and the roll centres still work)
            case "frame_torsion": case "inner_lift": return v.unsprung === "none";
            case "spring_front": case "spring_rear": case "damping_front": case "damping_rear": case "suspension_travel": case "suspension_length": case "spring_progression": case "damping_rebound": case "ride_front": case "ride_rear": return v.unsprung !== "none";
            case "bike_max_lean": case "bike_fast_lean": case "bike_rake": case "bike_rider_mass": case "bike_hang_off": case "bike_max_lateral_g": case "bike_balance": case "bike_fork_dive": return v.vehicle_type === "motorcycle";
            default: return true;
        }
    }
    function visibleFeature(key, v) {
        if(key === "antilag" || key === "boost_gauge") return v.turbo_share > 0 || v.turbo_boost > 0;
        return true;
    }

    // the systems of the car: each has a tick (the car has it, or not) and its settings; a car that does not have one has no key for it and no light on the gauge
    var FEATURES = [
        { key: "tc", label: "Traction control", items: [
            ["tc_allowance", "Wheel spin allowed", "%", 5, 800, 5]
        ] },
        { key: "abs", label: "ABS", items: [] },
        { key: "esc", label: "Stability control (ESC)", items: [
            ["esc_gain", "How hard it steps in", "%", 10, 400, 5]
        ] },
        { key: "launch_control", label: "Launch control", items: [
            ["launch_rpm", "Engine speed", "rpm", 1000, 20000, 100]
        ] },
        { key: "two_step", label: "Two-step (the key, or the clutch pedal at a standstill)", items: [
            ["two_step_rpm", "Engine speed", "rpm", 1000, 20000, 100]
        ] },
        { key: "pops", label: "Pops and bangs (unburnt fuel burns in the exhaust)", items: [
            ["pops_amount", "How often (on the rev limiter and the two-step)", "%", 0, 100, 5],
            ["pops_overrun", "After lifting off the throttle: for", "s", 0, 4, 0.1],
            ["pops_rpm", "From an engine speed of", "rpm", 1000, 8000, 100],
            ["pops_loud", "How loud", "%", 0, 500, 10],
            ["pops_flames", "Flames from the exhaust", "%", 0, 400, 10]
        ] },
        { key: "antilag", label: "Anti-lag (keeps the turbo spinning off the throttle)", items: [
            ["antilag_mode", "When", "", 0, 0, 0],
            ["antilag_boost", "Boost that is held", "%", 5, 100, 5],
            ["antilag_rpm", "Works from an engine speed of", "rpm", 1000, 8000, 100],
            ["antilag_time", "Longest time that it works", "s", 0.5, 60, 0.5],
            ["antilag_bangs", "Bangs and flames", "%", 0, 500, 10],
            ["antilag_fuel", "Extra fuel use while it works", "%", 0, 500, 10]
        ] },
        { key: "boost_gauge", label: "Boost gauge (the pressure of the turbo)", items: [
            ["boost_full", "Boost pressure at full boost (when the turbo has no pressure of its own)", "bar", 0.1, 10, 0.05],
            ["boost_scale", "The gauge goes up to", "bar", 0.5, 10, 0.5]
        ] }
    ];
    var FEATURE_DEFAULTS = {
        tc_on: true, abs_on: true, esc_on: true, launch_control_on: true, two_step_on: true,
        pops_on: false, pops_amount: 60, pops_overrun: 2, pops_rpm: 3000, pops_loud: 100, pops_flames: 100,
        antilag_on: false, antilag_mode: "lift", antilag_boost: 60, antilag_rpm: 3000, antilag_time: 5, antilag_bangs: 100, antilag_fuel: 60,
        boost_gauge_on: false, boost_full: 1, boost_scale: 2
    };

    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    var V100 = (100 / 3.6) * (100 / 3.6); // (m/s)^2 at 100 km/h: the downforce in the menu is the force at that speed

    // the values of a car configuration, in the units of the menu
    // what car.json chose from the wheel library for an axle ({ rim, tyre } ids, "" for none; WheelLibrary.js)
    // a custom tyre on an axle: the one of a rim of the library, or one that was chosen
    function customTyre(v, axle) { var t = v["tyre_" + axle]; return t === "custom" || (!t && (!!v["rim_" + axle] || v.model_tyres === "on")); }
    // the height of the sidewall (mm) of a custom tyre: what is between the outer shell and the inner shell; the inner shell is a share of the diameter
    function heightOf(diameterM, ratio) { return Math.max(20, Math.min(300, Math.round(diameterM / 2 * (1 - ratio) * 1000 / 5) * 5)); }
    function libChoice(c, axle) { return OpenRacer.WheelLibrary ? OpenRacer.WheelLibrary.choiceOf(c, axle) : { rim: "", tyre: "" }; }

    // where a kind of tyre of the list is on the rubber slider (a custom tyre starts from the kind of the car)
    function rubberOfCompound(id) {
        var stops = OpenRacer.RUBBER_STOPS || [];
        for(var i = 0; i < stops.length; i++) if(stops[i][0] === id) return stops[i][1];
        return 22;
    }

    function fromConfig(c) {
        var ch = c.chassis, dt = c.drivetrain, en = c.engine || {}, tyres = c.tyres || {}, assists = c.assists || {};
        var v = {
            mass: ch.mass + (OpenRacer.Motorcycle ? OpenRacer.Motorcycle.riderMass(c) : 0),      // (a motorcycle: the bike and its rider)
            front_weight: ch.weight_distribution * 100,
            cg_height: ch.cg_height || 0.55,
            roll_front: (ch.roll_front !== undefined ? ch.roll_front : 0.55) * 100,
            spring_front: (ch.spring_front !== undefined ? ch.spring_front : 29000) / 1000,
            spring_rear: (ch.spring_rear !== undefined ? ch.spring_rear : 27000) / 1000,
            damping_front: (ch.damping_front !== undefined ? ch.damping_front : 0.35) * 100,
            damping_rear: (ch.damping_rear !== undefined ? ch.damping_rear : 0.35) * 100,
            compound: tyres.compound || "road",
            tyre_damage: tyres.damage ? "on" : "off",
            model_tyres: libChoice(c, "front").model || libChoice(c, "rear").model ? "on" : "off", rim_front: libChoice(c, "front").rim, tyre_front: libChoice(c, "front").tyre, rim_rear: libChoice(c, "rear").rim, tyre_rear: libChoice(c, "rear").tyre,
            body_color: (c.colors && c.colors.body) || "", rim_color: (c.colors && c.colors.rim) || "", body_finish: (c.colors && c.colors.bodyFinish) || "", rim_finish: (c.colors && c.colors.rimFinish) || "",
            body_flake: (c.colors && c.colors.bodyFlake) || 100, rim_flake: (c.colors && c.colors.rimFlake) || 100,
            body_pattern: (c.colors && c.colors.bodyPattern) || "noise", rim_pattern: (c.colors && c.colors.rimPattern) || "noise",
            body_uv: (c.colors && c.colors.bodyUv) || "model", rim_uv: (c.colors && c.colors.rimUv) || "model",
            // the rest of the car editor (the tuning menu changes these too; Tuning.js builds the car again for what the model is built from)
            vehicle_type: c.type === "motorcycle" ? "motorcycle" : "car",
            susp_front: (c.suspension && c.suspension.front && c.suspension.front.type) || "model",
            susp_rear: (c.suspension && c.suspension.rear && c.suspension.rear.type) || "model",
            engine_place: (c.driveline && c.driveline.engine) || "front",
            efficiency: c.drivetrain && c.drivetrain.efficiency !== undefined ? c.drivetrain.efficiency : 0.92,
            tc_lockup: c.drivetrain && c.drivetrain.tc_lockup === false ? "off" : "on",
            length: c.dimensions && c.dimensions.length || 4.5, width: c.dimensions && c.dimensions.width || 1.8, height: c.dimensions && c.dimensions.height || 1.4,
            steering_degrees: (c.steering_wheel && c.steering_wheel.degrees) || 450,
            gen_power: (function () { var pk = peakOf(c.engine && c.engine.torque_curve); return pk ? Math.round(pk.hp) : 200; })(),
            gen_peak_rpm: (function () { var pk = peakOf(c.engine && c.engine.torque_curve); return pk ? pk.rpm : 6000; })(),
            sb_enabled: c.softbody && c.softbody.enabled === false ? "off" : "on",
            sb_max_nodes: (c.softbody && c.softbody.max_nodes) || 120,
            sb_wheel_strength: c.softbody && c.softbody.wheel_strength !== undefined ? c.softbody.wheel_strength : 25,
            bike_max_lean: (c.motorcycle || {}).max_lean_deg !== undefined ? c.motorcycle.max_lean_deg : BIKE.max_lean_deg,
            bike_fast_lean: (c.motorcycle || {}).fast_lean_deg !== undefined ? c.motorcycle.fast_lean_deg : BIKE.fast_lean_deg,
            bike_rake: (c.motorcycle || {}).rake_deg !== undefined ? c.motorcycle.rake_deg : BIKE.rake_deg,
            bike_rider_mass: (c.motorcycle || {}).rider_mass !== undefined ? c.motorcycle.rider_mass : BIKE.rider_mass,
            bike_hang_off: (c.motorcycle || {}).hang_off !== undefined ? c.motorcycle.hang_off : BIKE.hang_off,
            bike_max_lateral_g: (c.motorcycle || {}).max_lateral_g !== undefined ? c.motorcycle.max_lateral_g : BIKE.max_lateral_g,
            bike_balance: (c.motorcycle || {}).balance !== undefined ? c.motorcycle.balance : BIKE.balance,
            bike_fork_dive: (c.motorcycle || {}).fork_dive !== undefined ? c.motorcycle.fork_dive : BIKE.fork_dive,
            engine_build: (c.engine && c.engine.build) || null,                    // the engine as it is built (EngineBuild.js); an object, not a number of the menu
            exhaust_type: (c.sound && c.sound.engine_sim && c.sound.engine_sim.exhaust_type) || "custom",
            tyre_diameter_front: Math.round((libChoice(c, "front").custom && libChoice(c, "front").custom.diameter > 0 ? libChoice(c, "front").custom.diameter : (ch.tire_diameter || 0.65)) * 1000 / 5) * 5,
            tyre_diameter_rear: Math.round((libChoice(c, "rear").custom && libChoice(c, "rear").custom.diameter > 0 ? libChoice(c, "rear").custom.diameter : (ch.tire_diameter || 0.65)) * 1000 / 5) * 5,
            tyre_height_front: heightOf(Math.round((libChoice(c, "front").custom && libChoice(c, "front").custom.diameter > 0 ? libChoice(c, "front").custom.diameter : (ch.tire_diameter || 0.65)) * 1000 / 5) * 5 / 1000, libChoice(c, "front").custom && libChoice(c, "front").custom.inner_ratio > 0 ? libChoice(c, "front").custom.inner_ratio : (tyres.shell && tyres.shell.inner_ratio ? tyres.shell.inner_ratio : 0.62)),
            tyre_height_rear: heightOf(Math.round((libChoice(c, "rear").custom && libChoice(c, "rear").custom.diameter > 0 ? libChoice(c, "rear").custom.diameter : (ch.tire_diameter || 0.65)) * 1000 / 5) * 5 / 1000, libChoice(c, "rear").custom && libChoice(c, "rear").custom.inner_ratio > 0 ? libChoice(c, "rear").custom.inner_ratio : (tyres.shell && tyres.shell.inner_ratio ? tyres.shell.inner_ratio : 0.62)),
            rubber_front: libChoice(c, "front").custom && libChoice(c, "front").custom.rubber >= 0 ? libChoice(c, "front").custom.rubber : rubberOfCompound(tyres.compound),
            rubber_rear: libChoice(c, "rear").custom && libChoice(c, "rear").custom.rubber >= 0 ? libChoice(c, "rear").custom.rubber : rubberOfCompound(tyres.compound),
            tyre_width: tyres.shell && tyres.shell.width ? Math.round(tyres.shell.width * 100) : 0,
            tyre_width_rear: tyres.shell && tyres.shell.width_rear ? Math.round(tyres.shell.width_rear * 100) : 0,
            tyre_rings: tyres.shell && tyres.shell.rings ? tyres.shell.rings : 3,
            tyre_segments: tyres.shell && tyres.shell.segments ? tyres.shell.segments : 36,
            tyre_inner_ratio: tyres.shell && tyres.shell.inner_ratio ? Math.round(tyres.shell.inner_ratio * 100) : 62,
            tyre_carcass: tyres.shell && tyres.shell.carcass ? tyres.shell.carcass : 0,
            tyre_stiff_x: tyres.stiff_x || 20,
            tyre_stiff_y: tyres.stiff_y || 18,
            grip: (tyres.grip !== undefined ? tyres.grip : 1) * 100,
            grip_balance: (tyres.grip_balance !== undefined ? tyres.grip_balance : 1) * 100,
            cornering: (tyres.cornering !== undefined ? tyres.cornering : 1) * 100,
            pressure_front: tyres.pressure_front || 2.2,
            pressure_rear: tyres.pressure_rear || 2.2,
            tyre_heating: (tyres.heating !== undefined ? tyres.heating : 1) * 100,
            tyre_life: (tyres.life !== undefined ? tyres.life : 1) * 100,
            tank: (c.fuel && c.fuel.tank) || 60,
            fuel_use: (c.fuel && c.fuel.use !== undefined ? c.fuel.use : 1) * 100,
            rolling_resistance: tyres.rolling_resistance !== undefined ? tyres.rolling_resistance : 0.015,
            idle_rpm: en.idle_rpm || 900,
            limiter_rpm: en.limiter_rpm || 6600,
            limiter_hz: en.limiter_hz || 12,
            two_step_rpm: en.two_step_rpm || Math.round((en.limiter_rpm || 6600) * 0.7 / 100) * 100,
            launch_rpm: en.launch_rpm || Math.round((en.limiter_rpm || 6600) * 0.6 / 100) * 100,
            engine_inertia: en.inertia || 0.4,
            engine_braking: (en.braking_scale !== undefined ? en.braking_scale : 1) * 100,
            drive: dt.drive || "rwd",
            gearbox: ["cvt", "torque-converter", "dct", "amt", "imt"].indexOf(dt.gearbox) >= 0 ? dt.gearbox : "gears",
            cvt_rpm: dt.cvt_rpm || Math.round((en.limiter_rpm || 6600) * 0.85 / 100) * 100,
            tc_stall_rpm: dt.tc_stall_rpm || Math.round((en.limiter_rpm || 6600) * 0.35 / 50) * 50,
            tc_ratio: dt.tc_ratio || 1.9,
            shift_style: ["sport", "drag", "manual"].indexOf(dt.shift_style) >= 0 ? dt.shift_style : "normal",
            gear_count: dt.gear_ratios.length,
            final_drive: dt.final_drive,
            reverse_ratio: dt.reverse_ratio || dt.gear_ratios[0],
            clutch: dt.clutch !== undefined ? dt.clutch : 1.5,
            diff: dt.diff || "lsd",
            diff_power: (dt.diff_power !== undefined ? dt.diff_power : 0.3) * 100,
            diff_coast: (dt.diff_coast !== undefined ? dt.diff_coast : 0.1) * 100,
            center_diff: dt.center_diff || "lsd",
            center_split: (dt.center_split !== undefined ? dt.center_split : 0.4) * 100,
            diff_preload: dt.diff_preload !== undefined ? dt.diff_preload : 150,
            diff_lock: dt.diff_lock !== undefined ? dt.diff_lock : 60,
            brake_total: ((c.brakes && c.brakes.front) || 1700) + ((c.brakes && c.brakes.rear) || 900),
            brake_bias: Math.round(((c.brakes && c.brakes.front) || 1700) / (((c.brakes && c.brakes.front) || 1700) + ((c.brakes && c.brakes.rear) || 900)) * 1000) / 10,
            turbo_share: (en.turbo && en.turbo.share !== undefined ? en.turbo.share : (en.turbo ? 0.5 : 0)) * 100,
            turbo_spool: en.turbo && en.turbo.spool ? en.turbo.spool : 0.4,
            turbo_threshold: en.turbo && en.turbo.threshold_rpm ? en.turbo.threshold_rpm : 2500,
            turbo_boost: en.turbo && en.turbo.boost_bar > 0 ? en.turbo.boost_bar : 0,
            turbo_intercooler: (en.turbo && en.turbo.intercooler !== undefined ? en.turbo.intercooler : 0.75) * 100,
            turbo_efficiency: (en.turbo && en.turbo.efficiency > 0 ? en.turbo.efficiency : 0.7) * 100,
            shift_time: dt.shift_time || 0.32,
            clutch_start_rpm: dt.clutch_start_rpm || 1050,
            clutch_full_rpm: dt.clutch_full_rpm || 2000,
            unsprung: ch.unsprung ? "none" : "sprung",
            frame_torsion: Math.round(ch.frame_torsion || 0),
            inner_lift: Math.round((ch.inner_lift || 0) * 1000),
            suspension_travel: Math.round((ch.suspension_travel || 0.09) * 100),
            suspension_length: Math.round((ch.suspension_length || 0.28) * 100),
            spring_progression: Math.round((ch.spring_progression || 0) * 100),
            damping_rebound: ch.damping_rebound || 1.7,
            ride_front: Math.round((ch.ride_front || 0) * 1000),
            ride_rear: Math.round((ch.ride_rear || 0) * 1000),
            roll_center_front: (ch.roll_center_front !== undefined ? ch.roll_center_front : 0.06) * 100,
            roll_center_rear: (ch.roll_center_rear !== undefined ? ch.roll_center_rear : 0.12) * 100,
            toe_front: ch.toe_front || 0,
            toe_rear: ch.toe_rear || 0,
            camber_front: ch.camber_front || 0,
            camber_rear: ch.camber_rear || 0,
            roll_camber: (ch.roll_camber !== undefined ? ch.roll_camber : 0.6) * 100,
            drag_coefficient: ch.drag_coefficient,
            downforce_front: Math.round((ch.downforce_front !== undefined ? ch.downforce_front : (ch.downforce || 0) * ch.weight_distribution) * V100),
            downforce_rear: Math.round((ch.downforce_rear !== undefined ? ch.downforce_rear : (ch.downforce || 0) * (1 - ch.weight_distribution)) * V100),
            max_steer_deg: ch.max_steer_deg || 30,
            ackermann: (ch.ackermann !== undefined ? ch.ackermann : 0.6) * 100,
            tc_allowance: (assists.tc_allowance !== undefined ? assists.tc_allowance : 1) * 100,
            esc_gain: (assists.esc_gain !== undefined ? assists.esc_gain : 1) * 100
        };
        dt.gear_ratios.forEach(function(ratio, i) { v["gear" + i] = ratio; });
        var sound = OpenRacer.engineSimParams(c);
        ["volume", "convolution", "audio_volume", "hf_gain", "noise", "jitter", "exhaust_length", "primary_length", "idle_pressure"].forEach(function(key) {
            v["es_" + key] = sound[key];
        });
        // the extras: what car.json has, or the default (the full boost of a turbo car follows its share of boost)
        var ex = c.extras || {};
        Object.keys(FEATURE_DEFAULTS).forEach(function (key) { v[key] = ex[key] !== undefined ? ex[key] : FEATURE_DEFAULTS[key]; });
        if(ex.boost_full === undefined && en.turbo && en.turbo.share) v.boost_full = Math.round(en.turbo.share * 20) / 10;
        camerasOf(c, v);
        return v;
    }

    // the gear ratios of the values: gear_count of them (gear0, gear1, ...); a missing one is the one before it, a little lower
    function gearsOf(v) {
        var n = Math.max(1, Math.min(12, Math.round(v.gear_count || 0)));
        if(!v.gear_count) { n = 0; while(v["gear" + n] !== undefined) n++; }
        var out = [];
        for(var i = 0; i < n; i++) out.push(v["gear" + i] !== undefined ? v["gear" + i] : (out.length ? Math.max(0.3, out[out.length - 1] * 0.82) : 3));
        return out;
    }
    // puts the keys gear0... in order with gear_count (the extra ones go, the missing ones are made)
    function normaliseGears(v) {
        var n = gearsOf(v);
        Object.keys(v).forEach(function(k) { if(/^gear\d+$/.test(k)) delete v[k]; });
        n.forEach(function(r, i) { v["gear" + i] = r; });
        v.gear_count = n.length;
    }

    // the settings for Vehicle.retune from the values; the drag needs the frontal area of the car and the density of the air
    function toRetune(v, frontalArea, airDensity) {
        var gears = gearsOf(v);
        return {
            mass: v.mass,
            weight_distribution: v.front_weight / 100,
            cg_height: v.cg_height,
            roll_front: v.roll_front / 100,
            spring_front: v.spring_front * 1000,
            spring_rear: v.spring_rear * 1000,
            damping_front: v.damping_front / 100,
            damping_rear: v.damping_rear / 100,
            compound: v.compound,
            tyre_damage: v.tyre_damage === "on",
            rubber_front: v.tyre_front === "custom" ? v.rubber_front : -1, rubber_rear: v.tyre_rear === "custom" ? v.rubber_rear : -1,
            tyre_width: v.tyre_width, tyre_width_rear: v.tyre_width_rear, tyre_rings: v.tyre_rings, tyre_segments: v.tyre_segments, tyre_inner_ratio: v.tyre_inner_ratio / 100, tyre_carcass: v.tyre_carcass,
            tyre_stiff_x: v.tyre_stiff_x,
            tyre_stiff_y: v.tyre_stiff_y,
            grip: v.grip / 100,
            grip_balance: v.grip_balance / 100,
            cornering: v.cornering / 100,
            pressure_front: v.pressure_front,
            pressure_rear: v.pressure_rear,
            toe_front: v.toe_front,
            toe_rear: v.toe_rear,
            efficiency: v.efficiency,
            tc_lockup: v.tc_lockup === undefined ? undefined : v.tc_lockup !== "off",
            live_axle_front: v.susp_front && OpenRacer.PartsLibrary ? OpenRacer.PartsLibrary.isLive(v.susp_front) : undefined,
            live_axle_rear: v.susp_rear && OpenRacer.PartsLibrary ? OpenRacer.PartsLibrary.isLive(v.susp_rear) : undefined,
            rolling_resistance: v.rolling_resistance,
            tyre_heating: v.tyre_heating / 100,
            tyre_life: v.tyre_life / 100,
            tank: v.tank,
            fuel_use: v.fuel_use / 100,
            idle_rpm: v.idle_rpm,
            limiter_rpm: v.limiter_rpm,
            limiter_hz: v.limiter_hz,
            two_step_rpm: v.two_step_rpm,
            launch_rpm: v.launch_rpm,
            engine_inertia: v.engine_inertia,
            engine_braking: v.engine_braking / 100,
            drive: v.drive,
            gearbox: v.gearbox, shift_style: v.shift_style, cvt_rpm: v.cvt_rpm, tc_stall_rpm: v.tc_stall_rpm, tc_ratio: v.tc_ratio,
            final_drive: v.final_drive,
            gear_ratios: gears,
            reverse_ratio: v.reverse_ratio,
            clutch: v.clutch,
            diff: v.diff,
            center_diff: v.center_diff,
            center_split: v.center_split / 100,
            diff_power: v.diff_power / 100,
            diff_coast: v.diff_coast / 100,
            diff_preload: v.diff_preload,
            diff_lock: v.diff_lock,
            brake_front: v.brake_total * v.brake_bias / 100,
            brake_rear: v.brake_total * (1 - v.brake_bias / 100),
            drag: 0.5 * v.drag_coefficient * frontalArea * airDensity,
            downforce_front: v.downforce_front / V100,
            downforce_rear: v.downforce_rear / V100,
            ackermann: v.ackermann / 100,
            shift_time: v.shift_time,
            clutch_start_rpm: v.clutch_start_rpm, clutch_full_rpm: v.clutch_full_rpm,
            turbo_share: v.turbo_share / 100,
            turbo_spool: v.turbo_spool,
            turbo_threshold: v.turbo_threshold,
            turbo_boost: v.turbo_boost,
            turbo_intercooler: v.turbo_intercooler / 100,
            turbo_efficiency: v.turbo_efficiency / 100,
            suspension_travel: v.suspension_travel / 100,
            unsprung: v.unsprung === "none",
            frame_torsion: v.frame_torsion,
            inner_lift: v.inner_lift / 1000,
            suspension_length: v.suspension_length / 100,
            spring_progression: v.spring_progression / 100,
            damping_rebound: v.damping_rebound,
            ride_front: v.ride_front / 1000,
            ride_rear: v.ride_rear / 1000,
            roll_center_front: v.roll_center_front / 100,
            roll_center_rear: v.roll_center_rear / 100,
            camber_front: v.camber_front,
            camber_rear: v.camber_rear,
            roll_camber: v.roll_camber / 100,
            tc_allowance: v.tc_allowance / 100,
            esc_gain: v.esc_gain / 100,
            tc_fitted: v.tc_on !== false, abs_fitted: v.abs_on !== false, esc_fitted: v.esc_on !== false, launch_control_fitted: v.launch_control_on !== false, two_step_fitted: v.two_step_on !== false,
            extras: extrasOf(v)
        };
    }

    // the extras of the values (what is in car.json under "extras")
    function extrasOf(v) {
        var out = {};
        Object.keys(FEATURE_DEFAULTS).forEach(function (key) { out[key] = v[key] !== undefined ? v[key] : FEATURE_DEFAULTS[key]; });
        return out;
    }

    // a car configuration with the values in it (a copy; the id is left out, as car.json has none)
    // the cameras of a configuration, in the values of the table (after fromConfig has made the rest)
    function camerasOf(c, v) {
        try {
            var cams = OpenRacer.cameraSettings ? OpenRacer.cameraSettings(c) : null;
            if(!cams) return;
            var f = cams.follow, k = cams.cockpit;
            v.cam_follow_distance = f.distance; v.cam_follow_height = f.height; v.cam_follow_look_height = f.look_height; v.cam_follow_look_z = f.look_z; v.cam_follow_smoothing = f.smoothing;
            v.cam_follow_fov_standing = f.fov_standing; v.cam_follow_fov_fast = f.fov_fast; v.cam_follow_fov_full_speed = f.fov_full_speed; v.cam_follow_dolly = f.dolly;
            v.cam_cockpit_x = k.position[0]; v.cam_cockpit_y = k.position[1]; v.cam_cockpit_z = k.position[2]; v.cam_cockpit_fov = k.fov;
        } catch(e) { /* a configuration without dimensions: no cameras */ }
    }

    // the rims and the tyres of the wheel library for the values of the table: a rim brings a custom tyre, made from the numbers (width, diameter, sidewall height, rubber)
    function libraryOf(v) {
        var library = {};
        ["front", "rear"].forEach(function (axle) {
            // (the rim and the tyre of the model itself: objects called rim and tyre in the model, WheelLibrary.js; no rim of the library then)
            var fromModel = v.model_tyres === "on";
            var r = fromModel ? "" : (v["rim_" + axle] || ""), t = v["tyre_" + axle] || (r || fromModel ? "custom" : ""), entry = {};
            if(fromModel) entry.model = true;
            if(r) entry.rim = r;
            if(t) entry.tyre = t;
            if(t === "custom") {
                // (the width of the rear is the width of the front when it is not set; 0 for both: a tyre of 245 mm)
                var widthCm = axle === "rear" && v.tyre_width_rear > 0 ? v.tyre_width_rear : (v.tyre_width > 0 ? v.tyre_width : 24.5);
                var diameter = v["tyre_diameter_" + axle] > 0 ? v["tyre_diameter_" + axle] : 650, height = v["tyre_height_" + axle];
                entry.custom = { width: widthCm / 100, diameter: diameter / 1000, inner_ratio: height > 0 ? Math.max(0.3, Math.min(0.9, 1 - 2 * height / diameter)) : (v.tyre_inner_ratio > 0 ? v.tyre_inner_ratio / 100 : 0.62), rings: v.tyre_rings > 0 ? v.tyre_rings : 4, segments: v.tyre_segments > 0 ? v.tyre_segments : 36, carcass: v.tyre_carcass > 0 ? v.tyre_carcass : 0, rubber: v["rubber_" + axle] >= 0 ? v["rubber_" + axle] : 50 };
            }
            if(r || t) library[axle] = entry;
        });
        return library;
    }
    function toConfig(c, v) {
        c = clone(c);
        c.chassis.mass = v.mass - (OpenRacer.Motorcycle ? OpenRacer.Motorcycle.riderMass(c) : 0);
        c.chassis.weight_distribution = v.front_weight / 100;
        c.chassis.cg_height = v.cg_height;
        c.chassis.roll_front = v.roll_front / 100;
        c.chassis.spring_front = v.spring_front * 1000;
        c.chassis.spring_rear = v.spring_rear * 1000;
        c.chassis.damping_front = v.damping_front / 100;
        c.chassis.damping_rear = v.damping_rear / 100;
        c.chassis.drag_coefficient = v.drag_coefficient;
        c.chassis.max_steer_deg = v.max_steer_deg;
        c.chassis.downforce_front = v.downforce_front / V100;
        c.chassis.downforce_rear = v.downforce_rear / V100;
        delete c.chassis.downforce;
        c.chassis.ackermann = v.ackermann / 100;
        c.chassis.suspension_travel = v.suspension_travel / 100;
        c.chassis.unsprung = v.unsprung === "none";
        if (v.frame_torsion > 0) c.chassis.frame_torsion = v.frame_torsion; else delete c.chassis.frame_torsion;
        if (v.inner_lift > 0) c.chassis.inner_lift = v.inner_lift / 1000; else delete c.chassis.inner_lift;
        c.chassis.suspension_length = v.suspension_length / 100;
        c.chassis.spring_progression = v.spring_progression / 100;
        c.chassis.damping_rebound = v.damping_rebound;
        c.chassis.ride_front = v.ride_front / 1000;
        c.chassis.ride_rear = v.ride_rear / 1000;
        c.chassis.roll_center_front = v.roll_center_front / 100;
        c.chassis.roll_center_rear = v.roll_center_rear / 100;
        c.chassis.toe_front = v.toe_front;
        c.chassis.toe_rear = v.toe_rear;
        c.chassis.camber_front = v.camber_front;
        c.chassis.camber_rear = v.camber_rear;
        c.chassis.roll_camber = v.roll_camber / 100;
        c.tyres = { compound: v.compound || "road", damage: v.tyre_damage === "on", shell: { width: v.tyre_width / 100, rings: v.tyre_rings, segments: v.tyre_segments, inner_ratio: v.tyre_inner_ratio / 100, carcass: v.tyre_carcass }, stiff_x: v.tyre_stiff_x, stiff_y: v.tyre_stiff_y, grip: v.grip / 100, grip_balance: v.grip_balance / 100, cornering: v.cornering / 100, rolling_resistance: v.rolling_resistance, heating: v.tyre_heating / 100, life: v.tyre_life / 100,
            pressure_front: v.pressure_front, pressure_rear: v.pressure_rear };
        if(!(v.tyre_width_rear > 0)) delete c.tyres.shell.width_rear; else c.tyres.shell.width_rear = v.tyre_width_rear / 100;
        c.fuel = { tank: v.tank, use: v.fuel_use / 100 };
        c.engine = c.engine || {};
        c.engine.braking_scale = v.engine_braking / 100;
        c.engine.idle_rpm = v.idle_rpm;
        c.engine.limiter_rpm = v.limiter_rpm;
        c.engine.limiter_hz = v.limiter_hz;
        c.engine.two_step_rpm = v.two_step_rpm;
        c.engine.launch_rpm = v.launch_rpm;
        c.engine.inertia = v.engine_inertia;
        if(v.turbo_share > 0 || v.turbo_boost > 0) {
            c.engine.turbo = { share: v.turbo_share / 100, spool: v.turbo_spool, threshold_rpm: v.turbo_threshold };
            // (the intercooler and the compressor are kept with every turbo: the engine build sets them, and a setup that did not keep them was "changed" the moment it was saved)
            c.engine.turbo.intercooler = v.turbo_intercooler / 100; c.engine.turbo.efficiency = v.turbo_efficiency / 100;
            if(v.turbo_boost > 0) c.engine.turbo.boost_bar = v.turbo_boost;
        } else delete c.engine.turbo;
        c.drivetrain.shift_time = v.shift_time;
        c.drivetrain.clutch_start_rpm = v.clutch_start_rpm; c.drivetrain.clutch_full_rpm = Math.max(v.clutch_full_rpm, v.clutch_start_rpm + 50);
        c.drivetrain.drive = v.drive;
        c.drivetrain.gearbox = ["cvt", "torque-converter", "dct", "amt", "imt"].indexOf(v.gearbox) >= 0 ? v.gearbox : "gears";
        c.drivetrain.cvt_rpm = v.cvt_rpm;
        c.drivetrain.tc_stall_rpm = v.tc_stall_rpm; c.drivetrain.tc_ratio = v.tc_ratio;
        c.drivetrain.final_drive = v.final_drive;
        c.drivetrain.reverse_ratio = v.reverse_ratio;
        c.drivetrain.clutch = v.clutch;
        c.drivetrain.diff = v.diff;
        c.drivetrain.center_diff = v.center_diff;
        c.drivetrain.center_split = v.center_split / 100;
        c.drivetrain.diff_power = v.diff_power / 100;
        c.drivetrain.diff_coast = v.diff_coast / 100;
        c.drivetrain.diff_preload = v.diff_preload;
        c.drivetrain.diff_lock = v.diff_lock;
        c.drivetrain.gear_ratios = gearsOf(v);
        if(v.shift_style && v.shift_style !== "normal") c.drivetrain.shift_style = v.shift_style; else delete c.drivetrain.shift_style;
        c.brakes = { front: Math.round(v.brake_total * v.brake_bias / 100), rear: Math.round(v.brake_total * (1 - v.brake_bias / 100)) };
        c.assists = { tc_allowance: v.tc_allowance / 100, esc_gain: v.esc_gain / 100 };
        var sound = {};
        Object.keys(v).forEach(function(key) { if(key.indexOf("es_") === 0) sound[key.substring(3)] = v[key]; });
        c.sound = { engine_sim: Object.assign({}, (c.sound || {}).engine_sim, sound) };
        if(v.pops_on !== undefined) c.extras = extrasOf(v);        // (values from the car editor may not have them: the car keeps its own)
        // the rest of the car editor (values from before these rows do not have them: the car keeps its own)
        if(v.susp_front || v.susp_rear) {
            c.suspension = Object.assign({}, c.suspension || {});
            ["front", "rear"].forEach(function (axle) { var t = v["susp_" + axle]; if(t) c.suspension[axle] = Object.assign({}, c.suspension[axle] || {}, { type: t }); });
        }
        if(v.engine_place) c.driveline = Object.assign({}, c.driveline || {}, { engine: v.engine_place });
        // the colours of the body and the rims (none: the colours of the model)
        if(v.body_color !== undefined || v.rim_color !== undefined || v.body_finish !== undefined || v.rim_finish !== undefined) {
            var colors = {};
            if(v.body_color) colors.body = v.body_color;
            if(v.rim_color) colors.rim = v.rim_color;
            if(v.body_finish) colors.bodyFinish = v.body_finish;
            if(v.rim_finish) colors.rimFinish = v.rim_finish;
            if(v.body_finish === "flake" && v.body_flake && v.body_flake !== 100) colors.bodyFlake = v.body_flake;
            if(v.rim_finish === "flake" && v.rim_flake && v.rim_flake !== 100) colors.rimFlake = v.rim_flake;
            if(v.body_finish === "flake" && v.body_pattern && v.body_pattern !== "noise") colors.bodyPattern = v.body_pattern;
            if(v.rim_finish === "flake" && v.rim_pattern && v.rim_pattern !== "noise") colors.rimPattern = v.rim_pattern;
            if(v.body_finish === "flake" && v.body_uv === "generated") colors.bodyUv = "generated";
            if(v.rim_finish === "flake" && v.rim_uv === "generated") colors.rimUv = "generated";
            if(Object.keys(colors).length) c.colors = colors; else delete c.colors;
        }
        // the rims and the tyres of the wheel library (none chosen: the wheels of the model)
        if(v.rim_front !== undefined || v.tyre_front !== undefined || v.rim_rear !== undefined || v.tyre_rear !== undefined) {
            var library = libraryOf(v);
            c.wheels = Object.assign({}, c.wheels || { mode: "default" });
            if(Object.keys(library).length) c.wheels.library = library; else delete c.wheels.library;
        }
        if(v.efficiency !== undefined) c.drivetrain.efficiency = v.efficiency;
        if(v.tc_lockup !== undefined) c.drivetrain.tc_lockup = v.tc_lockup !== "off";
        if(v.length > 0 && v.width > 0 && v.height > 0) c.dimensions = Object.assign({}, c.dimensions || {}, { length: v.length, width: v.width, height: v.height });
        if(v.steering_degrees > 0) c.steering_wheel = Object.assign({}, c.steering_wheel || {}, { degrees: v.steering_degrees });
        if(v.gen_power > 0 && v.gen_peak_rpm > 0) {
            // a new curve only when the peak was moved: a curve drawn by hand in the car editor stays as it is
            var pk = peakOf(c.engine.torque_curve);
            if(!pk || Math.abs(pk.hp - v.gen_power) > 0.6 || Math.abs(pk.rpm - v.gen_peak_rpm) > 60) c.engine.torque_curve = generateCurve(v.gen_power, v.gen_peak_rpm, c.engine.limiter_rpm);
        }
        if(v.cam_follow_distance !== undefined) {
            c.cameras = {
                follow: { distance: v.cam_follow_distance, height: v.cam_follow_height, look_height: v.cam_follow_look_height, look_z: v.cam_follow_look_z, smoothing: v.cam_follow_smoothing,
                    fov_standing: v.cam_follow_fov_standing, fov_fast: v.cam_follow_fov_fast, fov_full_speed: v.cam_follow_fov_full_speed, dolly: v.cam_follow_dolly },
                cockpit: { position: [v.cam_cockpit_x, v.cam_cockpit_y, v.cam_cockpit_z], fov: v.cam_cockpit_fov }
            };
        }
        if(v.sb_enabled !== undefined) {
            c.softbody = Object.assign({}, c.softbody || {});
            if(v.sb_enabled === "off") c.softbody.enabled = false; else delete c.softbody.enabled;
            if(v.sb_max_nodes > 0) c.softbody.max_nodes = v.sb_max_nodes;
            if(v.sb_wheel_strength !== undefined) c.softbody.wheel_strength = v.sb_wheel_strength;
        }
        if(c.type === "motorcycle" && v.bike_max_lean !== undefined) {
            c.motorcycle = Object.assign({}, c.motorcycle || {}, { max_lean_deg: v.bike_max_lean, fast_lean_deg: v.bike_fast_lean, rake_deg: v.bike_rake, rider_mass: v.bike_rider_mass,
                hang_off: v.bike_hang_off, max_lateral_g: v.bike_max_lateral_g, balance: v.bike_balance, fork_dive: v.bike_fork_dive });
        }
        // the exhaust of the sound, and the engine that is built: the torque curve follows from the build, and so do the settings of the sound that the build has too
        c.sound = c.sound || {}; c.sound.engine_sim = Object.assign({}, c.sound.engine_sim || {});
        if(v.exhaust_type) c.sound.engine_sim.exhaust_type = v.exhaust_type;
        if(v.engine_build && OpenRacer.EngineBuild) {
            var b = JSON.parse(JSON.stringify(v.engine_build));
            c.engine.build = b;
            c.engine.torque_curve = OpenRacer.EngineBuild.compute(b, c.engine.limiter_rpm, c.engine.idle_rpm).curve;
            if(OpenRacer.engineSimPresets[b.block]) c.sound.engine_sim.layout = OpenRacer.engineSimPresets[b.block].layout;
            Object.assign(c.sound.engine_sim, { bore: b.bore, stroke: b.stroke, compression_ratio: b.compression, intake_duration: b.cam_duration, exhaust_duration: Math.max(180, b.cam_duration - 4),
                intake_flow: b.intake_flow, exhaust_flow: b.exhaust_flow, primary_length: b.primary_length, exhaust_length: b.exhaust_length });
        }
        delete c.id;
        return c;
    }

    // the keys of the groups, without the ones that are not a number (drive, gears, diff, center_diff) and the engine sound
    function keys() {
        var out = [];
        GROUPS.forEach(function (g) { g.items.forEach(function (item) { if(item[4] > item[3] && item[0].indexOf("es_") !== 0) out.push(item[0]); }); });
        FEATURES.forEach(function (f) { f.items.forEach(function (item) { if(item[4] > item[3]) out.push(item[0]); }); });
        return out;
    }

    // (visible and visibleFeature: see above)
    // The cards of the car editor and of the tuning menu of the game, in their order, with the groups of the table that each has (and "features": the systems and the extras): one
    // structure for both. A group that has the name of its card is shown as "<name> settings".
    var CARDS = [
        { name: "Wheels", groups: ["Tyres"] },
        { name: "Suspension and driveline", groups: ["Suspension and driveline"] },
        { name: "Chassis", groups: ["Chassis", "Brakes", "Aerodynamics and steering", "Size and steering wheel"] },
        { name: "Drivetrain", groups: ["Transmission"] },
        { name: "Engine", groups: ["Fuel", "Engine"] },
        { name: "Engine sound", groups: ["Engine sound"] },
        { name: "Assists and extras", features: true },
        { name: "Cameras", groups: ["Cameras"] },
        { name: "Soft body", groups: ["Soft body"] },
        { name: "Motorcycle", groups: ["Motorcycle"] }
    ];
    // the settings of the tyre that lie on top of the kind of tyre (the compound sets the grip, the heat, the wear and the rolling resistance): they are folded away in a part of their own
    var TYRE_FINE = ["tyre_stiff_x", "tyre_stiff_y", "grip", "grip_balance", "cornering", "rolling_resistance", "tyre_heating", "tyre_life"];
    return {
        TYRE_FINE: TYRE_FINE, CARDS: CARDS, visible: visible, visibleFeature: visibleFeature, GROUPS: GROUPS, FEATURES: FEATURES, FEATURE_DEFAULTS: FEATURE_DEFAULTS, V100: V100, gearsOf: gearsOf, normaliseGears: normaliseGears, fromConfig: fromConfig, toRetune: toRetune, toConfig: toConfig, libraryOf: libraryOf, keys: keys };
})();

// The setups of a car: whole configurations of the car (everything car.json has but the model: the chassis, the tyres, the engine, the gearbox, the suspension and the parts,
// the driver, the soft body, the cameras, the sound...), kept under a name in this browser (localStorage "openracer.setups.<car id>": { setups: { name: config }, active: name }).
// The tuning menu of the game saves the car as it is tuned (its configuration with the tuning in it) and the car editor saves the car as the form has it; loading one in the
// tuning menu takes the values of the table from it, loading one in the editor fills the form with all of it. The main menu offers the setups on the card of a car that has
// two or more; the one that is chosen is the car of the next game: main.js lays its configuration over car.json (the model and the id stay those of the car).
OpenRacer.Setups = (function () {
    var PREFIX = "openracer.setups.", CURRENT = "openracer.tuning.";
    function read(id) { try { var d = JSON.parse(window.localStorage.getItem(PREFIX + id)); if(d && d.setups) return d; } catch(e) {} return { setups: {}, active: null }; }
    // The pictures of the cars and tracks that the menu keeps (openracer.preview.*, openracer.trackpreview.*) are made again when they are missing: they go first
    // when the storage of the browser is full, so that a tune can still be kept. Gives false when it could not be written.
    function dropPictures() {
        try { Object.keys(window.localStorage).filter(function (k) { return /^openracer\.(track)?preview\./.test(k); }).forEach(function (k) { window.localStorage.removeItem(k); }); } catch(e) {}
    }
    function write(id, d) {
        var attempt = function () { if(Object.keys(d.setups).length) window.localStorage.setItem(PREFIX + id, JSON.stringify(d)); else window.localStorage.removeItem(PREFIX + id); };
        try { attempt(); return true; } catch(e) {}
        dropPictures();
        try { attempt(); return true; } catch(e) { return false; }
    }
    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    return {
        names: function (id) { return Object.keys(read(id).setups).sort(function (a, b) { return a.localeCompare(b); }); },
        get: function (id, name) { var v = read(id).setups[name]; return v ? clone(v) : null; },
        // the configuration of a setup (a setup from before this form held the values of the table only: those are laid on the base configuration)
        configOf: function (id, name, base) {
            var v = read(id).setups[name];
            if(!v) return null;
            // (no setting makes the engine stronger than the car is: the power scale of a setup is the one of the car)
            if(v.chassis) { var out = clone(v); if(out.engine) { if(base && base.engine && base.engine.power_scale !== undefined) out.engine.power_scale = base.engine.power_scale; else delete out.engine.power_scale; } return out; }
            return base && OpenRacer.CarTuning ? OpenRacer.CarTuning.toConfig(base, v) : null;
        },
        active: function (id) { return read(id).active || null; },
        // (the picture of a setup on its tile in the main menu is drawn by the menu from the configuration: MainMenu.js, requestTune)
        save: function (id, name, config) { var d = read(id); d.setups[name] = clone(config); d.active = name; delete d.thumbs; return write(id, d); },
        remove: function (id, name) { var d = read(id); delete d.setups[name]; if(d.active === name) d.active = null; write(id, d); },
        setActive: function (id, name) { var d = read(id); d.active = name && d.setups[name] ? name : null; write(id, d); },
        // a tune as a file, to share: { "openracer-tune": 1, car, name, saved, config }; the name of the file is <car>-<name>.openracer-tune.json
        exportFile: function (id, name, config) {
            var data = { "openracer-tune": 1, car: id, name: name, saved: new Date().toISOString(), config: clone(config) };
            delete data.config.model; delete data.config.id;
            var blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
            var safe = function (t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tune"; };
            var url = URL.createObjectURL(blob), link = document.createElement("a");
            link.href = url; link.download = safe(id) + "-" + safe(name) + ".openracer-tune.json";
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        },
        // the text of such a file read: { name, car, config }, or an Error with what is wrong (the car of the file is only a note: a tune is laid over the car it is imported on)
        parseFile: function (text) {
            var data;
            try { data = JSON.parse(text); } catch (e) { return new Error("This is not a tune file (no JSON)."); }
            if(!data || data["openracer-tune"] !== 1 || !data.config || typeof data.config !== "object") return new Error("This is not an OpenRacer tune file.");
            if(!data.config.chassis && !data.config.drivetrain && !data.config.tyres) return new Error("The tune file has no car in it.");
            var config = clone(data.config); delete config.model; delete config.id; if(config.engine) delete config.engine.power_scale;
            return { name: String(data.name || "Imported tune").slice(0, 40), car: data.car ? String(data.car) : "", config: config };
        },
        // the setup for the next game (null: the car as it was made); the tuning that was kept for the car is forgotten, the setup is the car from here
        use: function (id, name) {
            var d = read(id);
            d.active = name && d.setups[name] ? name : null; write(id, d);
            try { window.localStorage.removeItem(CURRENT + id); } catch(e) {}
        }
    };
})();
