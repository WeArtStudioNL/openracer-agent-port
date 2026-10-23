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
            ["mass", "Mass", "kg", 500, 4000, 10],
            ["front_weight", "Weight on the front axle", "%", 30, 70, 0.5],
            ["cg_height", "Height of the centre of gravity", "m", 0.25, 1.0, 0.01],
            ["roll_front", "Roll stiffness at the front", "%", 30, 80, 1],
            ["spring_front", "Front springs (wheel rate)", "N/mm", 10, 90, 1],
            ["spring_rear", "Rear springs (wheel rate)", "N/mm", 10, 90, 1],
            ["damping_front", "Front dampers", "%", 10, 100, 1],
            ["damping_rear", "Rear dampers", "%", 10, 100, 1],
            ["suspension_travel", "Suspension travel before the bump stop", "cm", 1, 80, 1],
            ["suspension_length", "Room for the travel (the spring from the mount to the middle of the wheel)", "cm", 20, 100, 1],
            ["spring_progression", "Progressive springs (extra stiffness at the end of the travel)", "%", 0, 400, 10],
            ["damping_rebound", "Rebound damping (against compression damping)", "×", 1, 4, 0.1],
            ["ride_front", "Ride height at the front (from the car as made)", "mm", -60, 80, 5],
            ["ride_rear", "Ride height at the rear", "mm", -60, 80, 5],
            ["roll_center_front", "Roll centre at the front", "cm", -5, 40, 1],
            ["roll_center_rear", "Roll centre at the rear", "cm", -5, 40, 1],
            ["toe_front", "Toe at the front (positive: toe-in)", "°", -1.5, 1.5, 0.05],
            ["toe_rear", "Toe at the rear", "°", -1.5, 1.5, 0.05],
            ["camber_front", "Camber at the front (negative: top in)", "°", -6, 3, 0.1],
            ["camber_rear", "Camber at the rear", "°", -6, 3, 0.1],
            ["roll_camber", "Camber lost in roll", "%", 0, 100, 5]
        ] },
        { name: "Tyres", items: [
            ["compound", "Tyre compound", "", 0, 0, 0],
            ["tyre_model", "Tyre model", "", 0, 0, 0],
            ["tyre_damage", "Tyre damage", "", 0, 0, 0],
            ["tyre_width", "Tyre cylinder: width (0: from the wheel)", "cm", 0, 40, 1],
            ["tyre_rings", "Tyre cylinder: rings of nodes across the tread", "", 1, 5, 1],
            ["tyre_segments", "Tyre cylinder: nodes round the wheel", "", 8, 72, 1],
            ["tyre_nodes", "Tyre of nodes: nodes in the tread", "", 36, 180, 4],
            ["tyre_stiff_x", "Tyre of nodes: stiffness along the tyre (x load)", "", 8, 40, 0.5],
            ["tyre_stiff_y", "Tyre of nodes: stiffness across the tyre (x load)", "", 8, 40, 0.5],
            ["grip", "Grip", "%", 50, 160, 1],
            ["grip_balance", "Grip of the rear tyres (as a share of the front)", "%", 60, 140, 1],
            ["cornering", "Stiffness against the slip angle", "%", 50, 160, 1],
            ["pressure_front", "Tyre pressure at the front", "bar", 1.2, 3.5, 0.1],
            ["pressure_rear", "Tyre pressure at the rear", "bar", 1.2, 3.5, 0.1],
            ["rolling_resistance", "Rolling resistance", "", 0.005, 0.05, 0.001],
            ["tyre_heating", "Heating up (wear and fuel on)", "%", 20, 400, 5],
            ["tyre_life", "Life of the tyres", "%", 20, 500, 5]
        ] },
        { name: "Fuel", items: [
            ["tank", "Tank", "L", 10, 200, 1],
            ["fuel_use", "Fuel use", "%", 20, 500, 5]
        ] },
        { name: "Engine", items: [
            ["power", "Power", "%", 30, 250, 1],
            ["idle_rpm", "Idle speed", "rpm", 500, 2000, 50],
            ["limiter_rpm", "Rev limit", "rpm", 3000, 13000, 100],
            ["limiter_hz", "Rev limiter: cuts per second", "Hz", 2, 40, 1],
            ["two_step_rpm", "Two-step: engine speed (key held)", "rpm", 2000, 13000, 100],
            ["launch_rpm", "Launch control: engine speed", "rpm", 2000, 13000, 100],
            ["engine_inertia", "Inertia of the engine", "kg m²", 0.05, 1.5, 0.01],
            ["engine_braking", "Engine braking", "%", 20, 300, 5],
            ["turbo_share", "Turbo: share of the torque that is boost (0: no turbo)", "%", 0, 90, 5],
            ["turbo_spool", "Turbo: spool time (the lag)", "s", 0.05, 2, 0.05],
            ["turbo_threshold", "Turbo: from", "rpm", 1000, 6000, 100],
            ["turbo_boost", "Turbo: boost pressure at full boost (0: the share of the torque above is used)", "bar", 0, 6, 0.05],
            ["turbo_intercooler", "Turbo: intercooler efficiency", "%", 0, 95, 1],
            ["turbo_efficiency", "Turbo: compressor efficiency", "%", 55, 80, 1]
        ] },
        { name: "Transmission", items: [
            ["drive", "Drive", "", 0, 0, 0],
            ["final_drive", "Final drive", "", 1.5, 6.5, 0.05],
            ["shift_time", "Shift time (without a clutch pedal)", "s", 0.05, 1.5, 0.01],
            ["clutch_start_rpm", "Automatic clutch: starts to grip at", "rpm", 500, 6000, 50],
            ["clutch_full_rpm", "Automatic clutch: grips fully at", "rpm", 600, 7000, 50],
            ["gears", "Gears", "", 0, 0, 0],
            ["reverse_ratio", "Reverse", "", 1.0, 6.0, 0.05],
            ["clutch", "Clutch capacity (x peak torque)", "", 1.0, 3.5, 0.05],
            ["diff", "Differential", "", 0, 0, 0],
            ["diff_preload", "Limited slip: preload", "Nm", 0, 800, 10],
            ["diff_power", "Limited slip: lock under power", "%", 0, 100, 1],
            ["diff_coast", "Limited slip: lock off the throttle", "%", 0, 100, 1],
            ["diff_lock", "Limited slip: build-up", "Nm/(rad/s)", 0, 400, 5],
            ["center_diff", "Centre differential (all wheel drive)", "", 0, 0, 0],
            ["center_split", "Torque to the front (all wheel drive)", "%", 0, 100, 1]
        ] },
        { name: "Brakes", items: [
            ["brake_total", "Brakes: front and rear together (per side)", "Nm", 500, 7000, 50],
            ["brake_bias", "Brake bias: the share of the front", "%", 40, 85, 1]
        ] },
        { name: "Aerodynamics and steering", items: [
            ["drag_coefficient", "Drag coefficient", "", 0.15, 1.2, 0.01],
            ["downforce_front", "Downforce at the front axle at 100 km/h (negative: lift)", "N", -2000, 8000, 50],
            ["downforce_rear", "Downforce at the rear axle at 100 km/h", "N", -2000, 8000, 50],
            ["max_steer_deg", "Steering lock", "°", 10, 50, 1],
            ["ackermann", "Ackermann (the inner wheel steers more)", "%", 0, 100, 5]
        ] },
        { name: "Assists", items: [
            ["tc_allowance", "Traction control: wheel spin allowed", "%", 30, 400, 5],
            ["esc_gain", "ESC: how hard it steps in", "%", 30, 250, 5]
        ] },
        { name: "Engine sound", items: [
            ["es_volume", "Volume", "", 0, 3, 0.05],
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
    var FEATURES = [
        { key: "pops", label: "Pops and bangs (unburnt fuel burns in the exhaust)", items: [
            ["pops_amount", "How often (on the rev limiter and the two-step)", "%", 0, 100, 5],
            ["pops_overrun", "After lifting off the throttle: for", "s", 0, 4, 0.1],
            ["pops_rpm", "From an engine speed of", "rpm", 1000, 8000, 100],
            ["pops_loud", "How loud", "%", 20, 300, 10],
            ["pops_flames", "Flames from the exhaust", "%", 0, 200, 10]
        ] },
        { key: "antilag", label: "Anti-lag (keeps the turbo spinning off the throttle)", items: [
            ["antilag_mode", "When", "", 0, 0, 0],
            ["antilag_boost", "Boost that is held", "%", 10, 100, 5],
            ["antilag_rpm", "Works from an engine speed of", "rpm", 1000, 8000, 100],
            ["antilag_time", "Longest time that it works", "s", 0.5, 20, 0.5],
            ["antilag_bangs", "Bangs and flames", "%", 0, 300, 10],
            ["antilag_fuel", "Extra fuel use while it works", "%", 0, 300, 10]
        ] },
        { key: "boost_gauge", label: "Boost gauge (the pressure of the turbo)", items: [
            ["boost_full", "Boost pressure at full boost (when the turbo has no pressure of its own)", "bar", 0.2, 6, 0.05],
            ["boost_scale", "The gauge goes up to", "bar", 0.5, 4, 0.5]
        ] }
    ];
    var FEATURE_DEFAULTS = {
        pops_on: false, pops_amount: 60, pops_overrun: 2, pops_rpm: 3000, pops_loud: 100, pops_flames: 100,
        antilag_on: false, antilag_mode: "lift", antilag_boost: 60, antilag_rpm: 3000, antilag_time: 5, antilag_bangs: 100, antilag_fuel: 60,
        boost_gauge_on: false, boost_full: 1, boost_scale: 2
    };

    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    var V100 = (100 / 3.6) * (100 / 3.6); // (m/s)^2 at 100 km/h: the downforce in the menu is the force at that speed

    // the values of a car configuration, in the units of the menu
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
            tyre_model: tyres.model === "nodes" ? "nodes" : "cylinder",
            tyre_damage: tyres.damage ? "on" : "off",
            tyre_width: tyres.shell && tyres.shell.width ? Math.round(tyres.shell.width * 100) : 0,
            tyre_rings: tyres.shell && tyres.shell.rings ? tyres.shell.rings : 3,
            tyre_segments: tyres.shell && tyres.shell.segments ? tyres.shell.segments : 36,
            tyre_nodes: tyres.nodes || 72,
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
            power: (en.power_scale !== undefined ? en.power_scale : 1) * 100,
            idle_rpm: en.idle_rpm || 900,
            limiter_rpm: en.limiter_rpm || 6600,
            limiter_hz: en.limiter_hz || 12,
            two_step_rpm: en.two_step_rpm || Math.round((en.limiter_rpm || 6600) * 0.7 / 100) * 100,
            launch_rpm: en.launch_rpm || Math.round((en.limiter_rpm || 6600) * 0.6 / 100) * 100,
            engine_inertia: en.inertia || 0.4,
            engine_braking: (en.braking_scale !== undefined ? en.braking_scale : 1) * 100,
            drive: dt.drive || "rwd",
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
        return v;
    }

    // the settings for Vehicle.retune from the values; the drag needs the frontal area of the car and the density of the air
    function toRetune(v, frontalArea, airDensity) {
        var gears = [];
        for(var i = 0; v["gear" + i] !== undefined; i++) gears.push(v["gear" + i]);
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
            tyre_model: v.tyre_model,
            tyre_damage: v.tyre_damage === "on",
            tyre_width: v.tyre_width, tyre_rings: v.tyre_rings, tyre_segments: v.tyre_segments,
            tyre_nodes: v.tyre_nodes,
            tyre_stiff_x: v.tyre_stiff_x,
            tyre_stiff_y: v.tyre_stiff_y,
            grip: v.grip / 100,
            grip_balance: v.grip_balance / 100,
            cornering: v.cornering / 100,
            pressure_front: v.pressure_front,
            pressure_rear: v.pressure_rear,
            toe_front: v.toe_front,
            toe_rear: v.toe_rear,
            rolling_resistance: v.rolling_resistance,
            tyre_heating: v.tyre_heating / 100,
            tyre_life: v.tyre_life / 100,
            tank: v.tank,
            fuel_use: v.fuel_use / 100,
            power: v.power / 100,
            idle_rpm: v.idle_rpm,
            limiter_rpm: v.limiter_rpm,
            limiter_hz: v.limiter_hz,
            two_step_rpm: v.two_step_rpm,
            launch_rpm: v.launch_rpm,
            engine_inertia: v.engine_inertia,
            engine_braking: v.engine_braking / 100,
            drive: v.drive,
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
        c.tyres = { compound: v.compound || "road", model: v.tyre_model === "nodes" ? "nodes" : "cylinder", damage: v.tyre_damage === "on", shell: { width: v.tyre_width / 100, rings: v.tyre_rings, segments: v.tyre_segments }, nodes: v.tyre_nodes, stiff_x: v.tyre_stiff_x, stiff_y: v.tyre_stiff_y, grip: v.grip / 100, grip_balance: v.grip_balance / 100, cornering: v.cornering / 100, rolling_resistance: v.rolling_resistance, heating: v.tyre_heating / 100, life: v.tyre_life / 100,
            pressure_front: v.pressure_front, pressure_rear: v.pressure_rear };
        c.fuel = { tank: v.tank, use: v.fuel_use / 100 };
        c.engine = c.engine || {};
        c.engine.power_scale = v.power / 100;
        c.engine.braking_scale = v.engine_braking / 100;
        c.engine.idle_rpm = v.idle_rpm;
        c.engine.limiter_rpm = v.limiter_rpm;
        c.engine.limiter_hz = v.limiter_hz;
        c.engine.two_step_rpm = v.two_step_rpm;
        c.engine.launch_rpm = v.launch_rpm;
        c.engine.inertia = v.engine_inertia;
        if(v.turbo_share > 0 || v.turbo_boost > 0) {
            c.engine.turbo = { share: v.turbo_share / 100, spool: v.turbo_spool, threshold_rpm: v.turbo_threshold };
            if(v.turbo_boost > 0) { c.engine.turbo.boost_bar = v.turbo_boost; c.engine.turbo.intercooler = v.turbo_intercooler / 100; c.engine.turbo.efficiency = v.turbo_efficiency / 100; }
        } else delete c.engine.turbo;
        c.drivetrain.shift_time = v.shift_time;
        c.drivetrain.clutch_start_rpm = v.clutch_start_rpm; c.drivetrain.clutch_full_rpm = Math.max(v.clutch_full_rpm, v.clutch_start_rpm + 50);
        c.drivetrain.drive = v.drive;
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
        c.drivetrain.gear_ratios = c.drivetrain.gear_ratios.map(function(r, i) { return v["gear" + i]; });
        c.brakes = { front: Math.round(v.brake_total * v.brake_bias / 100), rear: Math.round(v.brake_total * (1 - v.brake_bias / 100)) };
        c.assists = { tc_allowance: v.tc_allowance / 100, esc_gain: v.esc_gain / 100 };
        var sound = {};
        Object.keys(v).forEach(function(key) { if(key.indexOf("es_") === 0) sound[key.substring(3)] = v[key]; });
        c.sound = { engine_sim: Object.assign({}, (c.sound || {}).engine_sim, sound) };
        if(v.pops_on !== undefined) c.extras = extrasOf(v);        // (values from the car editor may not have them: the car keeps its own)
        delete c.id;
        return c;
    }

    // the keys of the groups, without the ones that are not a number (drive, gears, diff, center_diff) and the engine sound
    function keys() {
        var out = [];
        GROUPS.forEach(function (g) { g.items.forEach(function (item) { if(item[4] > item[3] && item[0].indexOf("es_") !== 0) out.push(item[0]); }); });
        return out;
    }

    return { GROUPS: GROUPS, FEATURES: FEATURES, FEATURE_DEFAULTS: FEATURE_DEFAULTS, V100: V100, fromConfig: fromConfig, toRetune: toRetune, toConfig: toConfig, keys: keys };
})();
