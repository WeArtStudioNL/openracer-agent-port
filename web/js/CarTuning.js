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
            ["ride_front", "Ride height at the front (from the car as made)", "mm", -60, 80, 5],
            ["ride_rear", "Ride height at the rear", "mm", -60, 80, 5],
            ["roll_center_front", "Roll centre at the front", "cm", -5, 40, 1],
            ["roll_center_rear", "Roll centre at the rear", "cm", -5, 40, 1],
            ["camber_front", "Camber at the front (negative: top in)", "°", -6, 3, 0.1],
            ["camber_rear", "Camber at the rear", "°", -6, 3, 0.1],
            ["roll_camber", "Camber lost in roll", "%", 0, 100, 5]
        ] },
        { name: "Tyres", items: [
            ["grip", "Grip", "%", 50, 160, 1],
            ["grip_balance", "Grip of the rear tyres (as a share of the front)", "%", 60, 140, 1],
            ["cornering", "Stiffness against the slip angle", "%", 50, 160, 1],
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
            ["engine_inertia", "Inertia of the engine", "kg m²", 0.05, 1.5, 0.01],
            ["engine_braking", "Engine braking", "%", 20, 300, 5],
            ["turbo_share", "Turbo: share of the torque that is boost (0: no turbo)", "%", 0, 90, 5],
            ["turbo_spool", "Turbo: spool time (the lag)", "s", 0.05, 2, 0.05],
            ["turbo_threshold", "Turbo: from", "rpm", 1000, 6000, 100]
        ] },
        { name: "Transmission", items: [
            ["drive", "Drive", "", 0, 0, 0],
            ["final_drive", "Final drive", "", 1.5, 6.5, 0.05],
            ["shift_time", "Shift time (without a clutch pedal)", "s", 0.05, 1.5, 0.01],
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
            ["brake_front", "Front brakes (per wheel)", "Nm", 300, 4000, 50],
            ["brake_rear", "Rear brakes (per wheel)", "Nm", 150, 3000, 50]
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

    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    var V100 = (100 / 3.6) * (100 / 3.6); // (m/s)^2 at 100 km/h: the downforce in the menu is the force at that speed

    // the values of a car configuration, in the units of the menu
    function fromConfig(c) {
        var ch = c.chassis, dt = c.drivetrain, en = c.engine || {}, tyres = c.tyres || {}, assists = c.assists || {};
        var v = {
            mass: ch.mass,
            front_weight: ch.weight_distribution * 100,
            cg_height: ch.cg_height || 0.55,
            roll_front: (ch.roll_front !== undefined ? ch.roll_front : 0.55) * 100,
            spring_front: (ch.spring_front !== undefined ? ch.spring_front : 29000) / 1000,
            spring_rear: (ch.spring_rear !== undefined ? ch.spring_rear : 27000) / 1000,
            damping_front: (ch.damping_front !== undefined ? ch.damping_front : 0.35) * 100,
            damping_rear: (ch.damping_rear !== undefined ? ch.damping_rear : 0.35) * 100,
            grip: (tyres.grip !== undefined ? tyres.grip : 1) * 100,
            grip_balance: (tyres.grip_balance !== undefined ? tyres.grip_balance : 1) * 100,
            cornering: (tyres.cornering !== undefined ? tyres.cornering : 1) * 100,
            tyre_heating: (tyres.heating !== undefined ? tyres.heating : 1) * 100,
            tyre_life: (tyres.life !== undefined ? tyres.life : 1) * 100,
            tank: (c.fuel && c.fuel.tank) || 60,
            fuel_use: (c.fuel && c.fuel.use !== undefined ? c.fuel.use : 1) * 100,
            rolling_resistance: tyres.rolling_resistance !== undefined ? tyres.rolling_resistance : 0.015,
            power: (en.power_scale !== undefined ? en.power_scale : 1) * 100,
            idle_rpm: en.idle_rpm || 900,
            limiter_rpm: en.limiter_rpm || 6600,
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
            brake_front: (c.brakes && c.brakes.front) || 1700,
            brake_rear: (c.brakes && c.brakes.rear) || 900,
            turbo_share: (en.turbo && en.turbo.share !== undefined ? en.turbo.share : (en.turbo ? 0.5 : 0)) * 100,
            turbo_spool: en.turbo && en.turbo.spool ? en.turbo.spool : 0.4,
            turbo_threshold: en.turbo && en.turbo.threshold_rpm ? en.turbo.threshold_rpm : 2500,
            shift_time: dt.shift_time || 0.32,
            suspension_travel: Math.round((ch.suspension_travel || 0.09) * 100),
            ride_front: Math.round((ch.ride_front || 0) * 1000),
            ride_rear: Math.round((ch.ride_rear || 0) * 1000),
            roll_center_front: (ch.roll_center_front !== undefined ? ch.roll_center_front : 0.06) * 100,
            roll_center_rear: (ch.roll_center_rear !== undefined ? ch.roll_center_rear : 0.12) * 100,
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
            grip: v.grip / 100,
            grip_balance: v.grip_balance / 100,
            cornering: v.cornering / 100,
            rolling_resistance: v.rolling_resistance,
            tyre_heating: v.tyre_heating / 100,
            tyre_life: v.tyre_life / 100,
            tank: v.tank,
            fuel_use: v.fuel_use / 100,
            power: v.power / 100,
            idle_rpm: v.idle_rpm,
            limiter_rpm: v.limiter_rpm,
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
            brake_front: v.brake_front,
            brake_rear: v.brake_rear,
            drag: 0.5 * v.drag_coefficient * frontalArea * airDensity,
            downforce_front: v.downforce_front / V100,
            downforce_rear: v.downforce_rear / V100,
            ackermann: v.ackermann / 100,
            shift_time: v.shift_time,
            turbo_share: v.turbo_share / 100,
            turbo_spool: v.turbo_spool,
            turbo_threshold: v.turbo_threshold,
            suspension_travel: v.suspension_travel / 100,
            ride_front: v.ride_front / 1000,
            ride_rear: v.ride_rear / 1000,
            roll_center_front: v.roll_center_front / 100,
            roll_center_rear: v.roll_center_rear / 100,
            camber_front: v.camber_front,
            camber_rear: v.camber_rear,
            roll_camber: v.roll_camber / 100,
            tc_allowance: v.tc_allowance / 100,
            esc_gain: v.esc_gain / 100
        };
    }

    // a car configuration with the values in it (a copy; the id is left out, as car.json has none)
    function toConfig(c, v) {
        c = clone(c);
        c.chassis.mass = v.mass;
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
        c.chassis.ride_front = v.ride_front / 1000;
        c.chassis.ride_rear = v.ride_rear / 1000;
        c.chassis.roll_center_front = v.roll_center_front / 100;
        c.chassis.roll_center_rear = v.roll_center_rear / 100;
        c.chassis.camber_front = v.camber_front;
        c.chassis.camber_rear = v.camber_rear;
        c.chassis.roll_camber = v.roll_camber / 100;
        c.tyres = { grip: v.grip / 100, grip_balance: v.grip_balance / 100, cornering: v.cornering / 100, rolling_resistance: v.rolling_resistance, heating: v.tyre_heating / 100, life: v.tyre_life / 100 };
        c.fuel = { tank: v.tank, use: v.fuel_use / 100 };
        c.engine = c.engine || {};
        c.engine.power_scale = v.power / 100;
        c.engine.braking_scale = v.engine_braking / 100;
        c.engine.idle_rpm = v.idle_rpm;
        c.engine.limiter_rpm = v.limiter_rpm;
        c.engine.inertia = v.engine_inertia;
        if(v.turbo_share > 0) c.engine.turbo = { share: v.turbo_share / 100, spool: v.turbo_spool, threshold_rpm: v.turbo_threshold };
        else delete c.engine.turbo;
        c.drivetrain.shift_time = v.shift_time;
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
        c.brakes = { front: v.brake_front, rear: v.brake_rear };
        c.assists = { tc_allowance: v.tc_allowance / 100, esc_gain: v.esc_gain / 100 };
        var sound = {};
        Object.keys(v).forEach(function(key) { if(key.indexOf("es_") === 0) sound[key.substring(3)] = v[key]; });
        c.sound = { engine_sim: Object.assign({}, (c.sound || {}).engine_sim, sound) };
        delete c.id;
        return c;
    }

    // the keys of the groups, without the ones that are not a number (drive, gears, diff, center_diff) and the engine sound
    function keys() {
        var out = [];
        GROUPS.forEach(function (g) { g.items.forEach(function (item) { if(item[4] > item[3] && item[0].indexOf("es_") !== 0) out.push(item[0]); }); });
        return out;
    }

    return { GROUPS: GROUPS, V100: V100, fromConfig: fromConfig, toRetune: toRetune, toConfig: toConfig, keys: keys };
})();
