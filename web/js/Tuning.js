/*
 * Tuning.js
 *
 * Description: The tuning menu: sliders and fields to change the car while it drives (mass and weight distribution, grip of the
 *              tyres, engine, gears, brakes, aerodynamics, assists and the engine sound). The menu is shown or hidden with
 *              a key (U by default, it can be changed in the settings menu). The tuning of a car is kept in this browser;
 *              "Save to the car" writes it to the car (cars/<id>/car.json), "Reset" goes back to the car as it was made.
 *
 *              The values that are not in the configuration of a car have a default (the factory values of this game); they
 *              are added to car.json when the tuning is saved: chassis.roll_front, chassis.spring_front/spring_rear,
 *              tyres { grip, cornering, rolling_resistance }, engine.power_scale and braking_scale, drivetrain.clutch,
 *              diff_preload and diff_lock, assists { tc_allowance, esc_gain }.
 */

var Tuning = (function() {
    var STORAGE_PREFIX = "openracer.tuning.";
    var panel = null;
    var car = null;
    var config = null;       // the configuration of the car as it was made (never changed by the tuning)
    var base = {};           // the values of the car as it was made, in the units of the menu
    var values = {};         // the values that are in use
    var controls = [];       // { def, row, number, slider, reset }
    var info = null;
    var visible = false;

    // key, label, unit, minimum, maximum, step: the values are in the units of the menu (percent, N/mm, ...)
    var GROUPS = [
        { name: "Chassis", items: [
            ["mass", "Mass", "kg", 500, 4000, 10],
            ["front_weight", "Weight on the front axle", "%", 30, 70, 0.5],
            ["cg_height", "Height of the centre of gravity", "m", 0.25, 1.0, 0.01],
            ["roll_front", "Roll stiffness at the front", "%", 30, 80, 1],
            ["spring_front", "Front springs (wheel rate)", "N/mm", 10, 90, 1],
            ["spring_rear", "Rear springs (wheel rate)", "N/mm", 10, 90, 1],
            ["damping_front", "Front dampers", "%", 10, 100, 1],
            ["damping_rear", "Rear dampers", "%", 10, 100, 1]
        ] },
        { name: "Tyres", items: [
            ["grip", "Grip", "%", 50, 160, 1],
            ["cornering", "Stiffness against the slip angle", "%", 50, 160, 1],
            ["rolling_resistance", "Rolling resistance", "", 0.005, 0.05, 0.001]
        ] },
        { name: "Engine", items: [
            ["power", "Power", "%", 30, 250, 1],
            ["idle_rpm", "Idle speed", "rpm", 500, 2000, 50],
            ["limiter_rpm", "Rev limit", "rpm", 3000, 13000, 100],
            ["engine_inertia", "Inertia of the engine", "kg m²", 0.05, 1.5, 0.01],
            ["engine_braking", "Engine braking", "%", 20, 300, 5]
        ] },
        { name: "Transmission", items: [
            ["drive", "Drive", "", 0, 0, 0],
            ["final_drive", "Final drive", "", 1.5, 6.5, 0.05],
            ["gears", "Gears", "", 0, 0, 0],
            ["reverse_ratio", "Reverse", "", 1.0, 6.0, 0.05],
            ["clutch", "Clutch capacity (x peak torque)", "", 1.0, 3.5, 0.05],
            ["diff_preload", "Differential preload", "Nm", 0, 800, 10],
            ["diff_lock", "Differential locking", "Nm/(rad/s)", 0, 400, 5]
        ] },
        { name: "Brakes", items: [
            ["brake_front", "Front brakes (per wheel)", "Nm", 300, 4000, 50],
            ["brake_rear", "Rear brakes (per wheel)", "Nm", 150, 3000, 50]
        ] },
        { name: "Aerodynamics and steering", items: [
            ["drag_coefficient", "Drag coefficient", "", 0.15, 1.2, 0.01],
            ["max_steer_deg", "Steering lock", "°", 10, 50, 1]
        ] },
        { name: "Assists", items: [
            ["tc_allowance", "Traction control: wheel spin allowed", "%", 30, 400, 5],
            ["esc_gain", "ESC: how hard it steps in", "%", 30, 250, 5]
        ] },
        { name: "Engine sound", items: [
            ["snd_cylinders", "Cylinders", "", 1, 16, 1],
            ["snd_volume", "Volume", "", 0, 3, 0.05],
            ["snd_ignition_time", "Ignition time", "", 0.002, 0.05, 0.001],
            ["snd_intake_length", "Intake pipe", "samples", 1, 400, 1],
            ["snd_exhaust_length", "Exhaust pipe", "samples", 1, 400, 1],
            ["snd_extractor_length", "Extractor pipe", "samples", 1, 400, 1],
            ["snd_straight_pipe_length", "Straight pipe", "samples", 1, 400, 1],
            ["snd_outlet_length", "Outlet", "samples", 1, 100, 1],
            ["snd_intake_closed", "Intake valve closed: reflection", "", 0, 0.99, 0.01],
            ["snd_exhaust_closed", "Exhaust valve closed: reflection", "", 0, 0.99, 0.01],
            ["snd_muffler_action", "Muffler", "", 0, 0.99, 0.01],
            ["snd_mix_intake", "Intake in the mix", "", 0, 3, 0.1],
            ["snd_mix_block", "Engine block in the mix", "", 0, 3, 0.1],
            ["snd_mix_outlet", "Outlet in the mix", "", 0, 3, 0.1]
        ] }
    ];

    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    // ---- the values of a car configuration, in the units of the menu

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
            cornering: (tyres.cornering !== undefined ? tyres.cornering : 1) * 100,
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
            diff_preload: dt.diff_preload !== undefined ? dt.diff_preload : 150,
            diff_lock: dt.diff_lock !== undefined ? dt.diff_lock : 60,
            brake_front: (c.brakes && c.brakes.front) || 1700,
            brake_rear: (c.brakes && c.brakes.rear) || 900,
            drag_coefficient: ch.drag_coefficient,
            max_steer_deg: ch.max_steer_deg || 30,
            tc_allowance: (assists.tc_allowance !== undefined ? assists.tc_allowance : 1) * 100,
            esc_gain: (assists.esc_gain !== undefined ? assists.esc_gain : 1) * 100
        };
        dt.gear_ratios.forEach(function(ratio, i) { v["gear" + i] = ratio; });
        var sound = OpenRacer.engineSoundParams(c);
        Object.keys(sound).forEach(function(key) {
            if(key !== "muffler") v["snd_" + key] = sound[key];
        });
        v.snd_muffler = sound.muffler.slice();
        return v;
    }

    // ---- the car follows the values

    function apply() {
        var v = values;
        var gears = [];
        for(var i = 0; v["gear" + i] !== undefined; i++) gears.push(v["gear" + i]);
        car.vehicle.retune({
            mass: v.mass,
            weight_distribution: v.front_weight / 100,
            cg_height: v.cg_height,
            roll_front: v.roll_front / 100,
            spring_front: v.spring_front * 1000,
            spring_rear: v.spring_rear * 1000,
            damping_front: v.damping_front / 100,
            damping_rear: v.damping_rear / 100,
            grip: v.grip / 100,
            cornering: v.cornering / 100,
            rolling_resistance: v.rolling_resistance,
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
            diff_preload: v.diff_preload,
            diff_lock: v.diff_lock,
            brake_front: v.brake_front,
            brake_rear: v.brake_rear,
            drag: 0.5 * v.drag_coefficient * car.frontal_area * air_density,
            tc_allowance: v.tc_allowance / 100,
            esc_gain: v.esc_gain / 100
        });
        car.mass = v.mass;
        car.final_drive = v.final_drive;
        car.Cd = v.drag_coefficient;
        car.Cdrag = 0.5 * v.drag_coefficient * car.frontal_area * air_density;
        car.maxTurn = v.max_steer_deg * Math.PI / 180;
        car.turnLimit = car.maxTurn;
        var sound = {};
        Object.keys(v).forEach(function(key) {
            if(key.indexOf("snd_") === 0) sound[key.substring(4)] = v[key];
        });
        EngineSound.setParams(sound);
        updateInfo();
    }

    function updateInfo() {
        if(!info) return;
        var engine = car.engine;
        var peakHp = 0, peakHpRpm = 0, peakNm = 0;
        engine.torque_curve.forEach(function(p) {
            var nm = p.nm * engine.torqueScale;
            var hp = nm * p.rpm * Math.PI / 30 / 745.7;
            if(hp > peakHp) { peakHp = hp; peakHpRpm = p.rpm; }
            peakNm = Math.max(peakNm, nm);
        });
        var top = car.gear_ratios[car.gear_ratios.length - 1];
        var kmh = engine.limiterRPM * Math.PI / 30 * car.wheels[0].radius / (top * car.final_drive) * 3.6;
        var imperial = Settings.option("units") === "imperial";
        info.textContent = Math.round(peakHp) + " hp at " + peakHpRpm + " rpm · " + Math.round(peakNm) + " Nm · " +
            (imperial ? Math.round(kmh / 1.609344) + " mph" : Math.round(kmh) + " km/h") + " at the limiter in top gear · " +
            Math.round(car.mass) + " kg · " + (car.mass / Math.max(1, peakHp)).toFixed(1) + " kg/hp";
    }

    // ---- storing

    function storageKey() {
        return STORAGE_PREFIX + config.id;
    }

    function store() {
        var changed = {};
        Object.keys(values).forEach(function(key) {
            if(JSON.stringify(values[key]) !== JSON.stringify(base[key])) changed[key] = values[key];
        });
        try {
            if(Object.keys(changed).length) window.localStorage.setItem(storageKey(), JSON.stringify(changed));
            else window.localStorage.removeItem(storageKey());
        } catch(e) {}
    }

    function load() {
        try {
            var stored = JSON.parse(window.localStorage.getItem(storageKey()));
            if(stored) Object.keys(stored).forEach(function(key) { if(key in base) values[key] = stored[key]; });
        } catch(e) {}
    }

    // ---- the menu

    function addStyle() {
        var style = document.createElement("style");
        style.textContent =
            "#tuning { position: fixed; right: 10px; top: 10px; bottom: 10px; width: 390px; z-index: 1500; overflow-y: auto; padding: 12px 14px 20px; " +
            "background: rgba(16, 20, 26, 0.9); color: #e6e9ee; font-family: Arial, sans-serif; font-size: 13px; border-radius: 8px; display: none; }" +
            "#tuning h1 { font-size: 18px; margin: 0 0 2px; }" +
            "#tuning .sub { color: #8895a7; font-size: 12px; margin-bottom: 8px; line-height: 1.4; }" +
            "#tuning .info { background: #20262f; border-radius: 5px; padding: 6px 8px; margin-bottom: 8px; color: #b6c4d6; font-size: 12px; line-height: 1.4; }" +
            "#tuning details { border-top: 1px solid #2c3541; padding: 4px 0; }" +
            "#tuning summary { cursor: pointer; padding: 5px 0; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; font-size: 12px; color: #9ab; }" +
            "#tuning .item { margin: 5px 0 8px; }" +
            "#tuning .line { display: flex; align-items: center; gap: 6px; }" +
            "#tuning .line .label { flex: 1; }" +
            "#tuning .line.changed .label { color: #ffd04d; }" +
            "#tuning input[type=number], #tuning select { width: 84px; background: #12161c; color: #fff; border: 1px solid #323c4a; border-radius: 4px; padding: 3px 5px; font: inherit; }" +
            "#tuning input[type=range] { width: 100%; margin: 2px 0 0; }" +
            "#tuning .unit { width: 52px; color: #7f90a5; font-size: 11px; }" +
            "#tuning button { background: #36404e; color: #fff; border: 0; border-radius: 4px; padding: 4px 10px; cursor: pointer; font: inherit; }" +
            "#tuning button:hover { background: #4a586b; }" +
            "#tuning button.small { padding: 1px 6px; }" +
            "#tuning .actions { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }" +
            "#tuning .actions .save { background: #2e9a5c; }" +
            "#tuning .message { color: #ffd04d; min-height: 16px; margin-top: 4px; }" +
            "#tuning .gears { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 8px; }" +
            "#tuning .gears label { font-size: 11px; color: #8895a7; display: block; } #tuning .gears input { width: 100%; box-sizing: border-box; }";
        document.head.appendChild(style);
    }

    function format(def, v) {
        var step = def[5];
        var digits = step >= 1 ? 0 : (step >= 0.1 ? 1 : (step >= 0.01 ? 2 : 3));
        return Number(v).toFixed(digits);
    }

    function changed(key) {
        return JSON.stringify(values[key]) !== JSON.stringify(base[key]);
    }

    function message(text) {
        var el = panel.querySelector(".message");
        if(el) el.textContent = text;
    }

    function set(key, value) {
        values[key] = value;
        apply();
        store();
        refresh();
    }

    function slider(def) {
        var key = def[0];
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("div");
        line.className = "line";
        var label = document.createElement("span");
        label.className = "label";
        label.textContent = def[1];
        line.appendChild(label);
        var number = document.createElement("input");
        number.type = "number";
        number.min = def[3];
        number.max = def[4];
        number.step = def[5];
        line.appendChild(number);
        var unit = document.createElement("span");
        unit.className = "unit";
        unit.textContent = def[2];
        line.appendChild(unit);
        var reset = document.createElement("button");
        reset.className = "small";
        reset.textContent = "↺";
        reset.title = "Back to the value of the car";
        line.appendChild(reset);
        item.appendChild(line);
        var range = document.createElement("input");
        range.type = "range";
        range.min = def[3];
        range.max = def[4];
        range.step = def[5];
        item.appendChild(range);
        range.addEventListener("input", function() { set(key, parseFloat(range.value)); });
        // a slider that was used lets go of the keyboard again, so that the car can be driven
        range.addEventListener("change", function() { range.blur(); });
        number.addEventListener("change", function() {
            var value = parseFloat(number.value);
            if(Number.isFinite(value)) set(key, Math.min(def[4] * 2, Math.max(def[3] / 2, value)));
            number.blur();
        });
        reset.addEventListener("click", function() { set(key, base[key]); });
        controls.push({ key: key, def: def, line: line, number: number, range: range });
        return item;
    }

    function gearsRow() {
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("div");
        line.className = "line";
        line.innerHTML = "<span class=\"label\">Gear ratios</span>";
        item.appendChild(line);
        var grid = document.createElement("div");
        grid.className = "gears";
        car.gear_ratios.forEach(function(ratio, i) {
            var wrap = document.createElement("div");
            var label = document.createElement("label");
            label.textContent = "Gear " + (i + 1);
            var input = document.createElement("input");
            input.type = "number";
            input.min = 0.3;
            input.max = 7;
            input.step = 0.01;
            input.addEventListener("change", function() {
                var value = parseFloat(input.value);
                if(Number.isFinite(value) && value > 0) set("gear" + i, value);
                input.blur();
            });
            wrap.appendChild(label);
            wrap.appendChild(input);
            grid.appendChild(wrap);
            controls.push({ key: "gear" + i, input: input, gear: true });
        });
        item.appendChild(grid);
        return item;
    }

    function driveRow() {
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("div");
        line.className = "line";
        line.innerHTML = "<span class=\"label\">Drive</span>";
        var select = document.createElement("select");
        select.innerHTML = "<option value=\"rwd\">Rear wheels</option><option value=\"fwd\">Front wheels</option>";
        select.style.width = "130px";
        select.addEventListener("change", function() { set("drive", select.value); select.blur(); });
        line.appendChild(select);
        item.appendChild(line);
        controls.push({ key: "drive", select: select, line: line });
        return item;
    }

    function mufflerRow() {
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("div");
        line.className = "line";
        line.innerHTML = "<span class=\"label\">Muffler elements (samples)</span>";
        var input = document.createElement("input");
        input.type = "text";
        input.style.cssText = "width: 130px; background: #12161c; color: #fff; border: 1px solid #323c4a; border-radius: 4px; padding: 3px 5px; font: inherit;";
        input.addEventListener("change", function() {
            var list = input.value.split(/[,;\s]+/).map(parseFloat).filter(function(n) { return n > 0; });
            if(list.length) set("snd_muffler", list);
            input.blur();
        });
        line.appendChild(input);
        item.appendChild(line);
        controls.push({ key: "snd_muffler", text: input, line: line });
        return item;
    }

    function build() {
        addStyle();
        panel = document.createElement("div");
        panel.id = "tuning";
        panel.innerHTML = "<h1>Tuning</h1><div class=\"sub\">Change the car while you drive. The tuning of this car is kept in the browser. " +
            "The key to show or hide this menu can be changed in the settings menu.</div>";
        info = document.createElement("div");
        info.className = "info";
        panel.appendChild(info);
        var actions = document.createElement("div");
        actions.className = "actions";
        var resetAll = document.createElement("button");
        resetAll.textContent = "Reset to the car";
        resetAll.onclick = function() {
            values = clone(base);
            apply();
            store();
            refresh();
            message("Back to the values of the car.");
        };
        var save = document.createElement("button");
        save.className = "save";
        save.textContent = "Save to the car";
        save.onclick = saveToCar;
        var close = document.createElement("button");
        close.textContent = "Close";
        close.onclick = function() { setVisible(false); };
        actions.appendChild(resetAll);
        actions.appendChild(save);
        actions.appendChild(close);
        panel.appendChild(actions);
        var messageLine = document.createElement("div");
        messageLine.className = "message";
        panel.appendChild(messageLine);

        GROUPS.forEach(function(group, index) {
            var details = document.createElement("details");
            details.open = index < 2;
            var summary = document.createElement("summary");
            summary.textContent = group.name;
            details.appendChild(summary);
            group.items.forEach(function(def) {
                if(def[0] === "drive") details.appendChild(driveRow());
                else if(def[0] === "gears") details.appendChild(gearsRow());
                else details.appendChild(slider(def));
                if(def[0] === "snd_muffler_action") details.appendChild(mufflerRow());
            });
            panel.appendChild(details);
        });
        document.body.appendChild(panel);
    }

    function refresh() {
        controls.forEach(function(c) {
            if(c.range) {
                var v = values[c.key];
                // a value outside of the slider (typed in) widens it
                c.range.min = Math.min(c.def[3], v);
                c.range.max = Math.max(c.def[4], v);
                c.range.value = v;
                if(document.activeElement !== c.number) c.number.value = format(c.def, v);
                c.line.classList.toggle("changed", changed(c.key));
            } else if(c.gear) {
                if(document.activeElement !== c.input) c.input.value = Number(values[c.key]).toFixed(2);
                c.input.style.color = changed(c.key) ? "#ffd04d" : "";
            } else if(c.select) {
                c.select.value = values.drive;
                c.line.classList.toggle("changed", changed("drive"));
            } else if(c.text) {
                if(document.activeElement !== c.text) c.text.value = values.snd_muffler.join(", ");
                c.line.classList.toggle("changed", changed("snd_muffler"));
            }
        });
        updateInfo();
    }

    // The configuration of the car with the tuning in it
    function tunedConfig() {
        var c = clone(config);
        var v = values;
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
        c.tyres = { grip: v.grip / 100, cornering: v.cornering / 100, rolling_resistance: v.rolling_resistance };
        c.engine = c.engine || {};
        c.engine.power_scale = v.power / 100;
        c.engine.braking_scale = v.engine_braking / 100;
        c.engine.idle_rpm = v.idle_rpm;
        c.engine.limiter_rpm = v.limiter_rpm;
        c.engine.inertia = v.engine_inertia;
        c.drivetrain.drive = v.drive;
        c.drivetrain.final_drive = v.final_drive;
        c.drivetrain.reverse_ratio = v.reverse_ratio;
        c.drivetrain.clutch = v.clutch;
        c.drivetrain.diff_preload = v.diff_preload;
        c.drivetrain.diff_lock = v.diff_lock;
        c.drivetrain.gear_ratios = c.drivetrain.gear_ratios.map(function(r, i) { return v["gear" + i]; });
        c.brakes = { front: v.brake_front, rear: v.brake_rear };
        c.assists = { tc_allowance: v.tc_allowance / 100, esc_gain: v.esc_gain / 100 };
        var sound = {};
        Object.keys(v).forEach(function(key) { if(key.indexOf("snd_") === 0) sound[key.substring(4)] = v[key]; });
        c.sound = sound;
        delete c.id;
        return c;
    }

    function saveToCar() {
        if(!window.confirm("Write this tuning to the car (cars/" + config.id + "/car.json)? The car as it was made is overwritten.")) return;
        var tuned = tunedConfig();
        fetch("api/cars/" + encodeURIComponent(config.id) + "/car.json", { method: "PUT", body: JSON.stringify(tuned, null, 2) + "\n" }).then(function(response) {
            if(!response.ok) throw new Error("HTTP " + response.status + " (start the game with start-server.sh to be able to save)");
            // the car is the way it is tuned now
            tuned.id = config.id;
            config = tuned;
            base = fromConfig(config);
            values = clone(base);
            store();
            refresh();
            message("Saved to cars/" + config.id + ".");
        }).catch(function(error) {
            message("Could not save: " + error.message);
        });
    }

    function setVisible(show) {
        visible = show;
        panel.style.display = show ? "block" : "none";
        if(show) {
            refresh();
            message("");
        } else if(document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
    }

    // Makes the tuning menu for a car, and puts the tuning that was kept for it on the car
    function attach(newCar, newConfig) {
        car = newCar;
        config = clone(newConfig);
        base = fromConfig(config);
        values = clone(base);
        load();
        controls = [];
        if(panel) panel.parentNode.removeChild(panel);
        build();
        apply();
        refresh();
    }

    Settings.onOptionChange(function(name) {
        if(name === "units" && info) updateInfo();
    });

    return {
        attach: attach,
        toggle: function() { if(panel) setVisible(!visible); },
        isVisible: function() { return visible; }
    };
})();
