/*
 * Tuning.js
 *
 * Description: The tuning menu: sliders and fields to change the car while it drives (mass and weight distribution, grip of the
 *              tyres, engine, gears, brakes, aerodynamics, assists and the engine sound). The menu is shown or hidden with
 *              a key (U by default, it can be changed in the settings menu). The tuning of a car is kept in this browser;
 *              the setups (OpenRacer.Setups) keep the car under a name: Save overwrites the setup that is chosen, Save as new… asks
 *              a name; "Default" is car.json, the car as made, which the car editor writes.
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
    var original = null;     // the car as made (car.json), when the game started on a setup: "the car as made" of the setups
    var base = {};           // the values of the car as it was made, in the units of the menu
    var values = {};         // the values that are in use
    var controls = [];       // { def, row, number, slider, reset }
    var info = null;
    var setupSelect = null, setupButtons = null;  // the setups of the car (OpenRacer.Setups): the list, Save and Delete (they go grey for "the car as made")
    var visible = false;

    // key, label, unit, minimum, maximum, step: the values are in the units of the menu (percent, N/mm, ...)
    var GROUPS = OpenRacer.CarTuning.GROUPS;

    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    var V100 = (100 / 3.6) * (100 / 3.6); // (m/s)^2 at 100 km/h: the downforce in the menu is the force at that speed

    // ---- the values of a car configuration, in the units of the menu

    function fromConfig(c) { return OpenRacer.CarTuning.fromConfig(c); }

    // ---- the car follows the values

    var rebuildSig = null, rebuildTimer = null, lastCurve = null;      // what the model of the car is built from, as it was last applied; the torque curve as last applied
    // (the centre of gravity and the tyre are in it: the shell of the car sits on the centre of gravity, CollisionProxy.js)
    function builtFrom(c) { return JSON.stringify([c.suspension, c.driveline, c.softbody, c.dimensions, c.steering_wheel && c.steering_wheel.degrees, c.wheels && c.wheels.library, c.chassis && c.chassis.cg_height, c.chassis && c.chassis.tire_diameter]); }
    function apply() {
        var v = values;
        if(v.width > 0 && v.height > 0) car.frontal_area = v.width * v.height * 0.85;
        if(car.setColors) car.setColors({ body: v.body_color || null, rim: v.rim_color || null, bodyFinish: v.body_finish || "", rimFinish: v.rim_finish || "", bodyFlake: v.body_flake || 100, rimFlake: v.rim_flake || 100, bodyPattern: v.body_pattern || "noise", rimPattern: v.rim_pattern || "noise", bodyUv: v.body_uv || "model", rimUv: v.rim_uv || "model" });
        car.vehicle.retune(OpenRacer.CarTuning.toRetune(v, car.frontal_area, air_density));
        // the rest of the car editor, live: the cameras, the steering wheel, the rider of a motorcycle, the torque curve, the sound; and the model built again for
        // what it is built from (the suspension and the driveline of the parts library, the soft body, the size), half a second after the last change
        var tuned = tunedConfig();
        if(OpenRacer.cameraSettings) car.cameraSettings = OpenRacer.cameraSettings(tuned);
        if(car.steeringWheel && v.steering_degrees > 0) car.steeringWheel.degrees = v.steering_degrees;
        if(car.vehicle.controller && car.vehicle.controller.retune && tuned.motorcycle) car.vehicle.controller.retune(tuned.motorcycle);
        var curve = tuned.engine && tuned.engine.torque_curve;
        if(curve && car.engine && JSON.stringify(curve) !== JSON.stringify(lastCurve)) {
            car.engine.torque_curve = curve.map(function(p) { return { rpm: p[0], nm: p[1] }; });
            lastCurve = curve;
        }
        var sig = builtFrom(tuned);
        if(rebuildSig !== null && sig !== rebuildSig && car.rebuild) {
            clearTimeout(rebuildTimer);
            rebuildTimer = setTimeout(function() {
                var cfg = tunedConfig();
                car.rebuild(cfg);
                message("The car is built again (the suspension, the driveline, the wheels, the soft body, the size).");
                // a rim or a tyre of the wheel library that is not there: said here, not only in the console (the files load with the car: looked at a moment later)
                setTimeout(function() { var bad = OpenRacer.WheelLibrary && OpenRacer.WheelLibrary.problems(cfg); if(bad && bad.length) message("Wheel library: " + bad.join("; ") + ". The wheels of the model are used."); }, 1500);
            }, 500);
        }
        rebuildSig = sig;
        car.mass = v.mass;
        car.final_drive = v.final_drive;
        car.Cd = v.drag_coefficient;
        car.Cdrag = 0.5 * v.drag_coefficient * car.frontal_area * air_density;
        car.maxTurn = v.max_steer_deg * Math.PI / 180;
        car.turnLimit = car.maxTurn;
        var sound = {};
        Object.keys(v).forEach(function(key) {
            if(key.indexOf("es_") === 0) sound[key.substring(3)] = v[key];
        });
        // the exhaust of the sound, and (for an engine that is built) what the sound has of the build: the layout, the bore and the stroke, the cam, the flows and the lengths
        if(v.exhaust_type) sound.exhaust_type = v.exhaust_type;
        var tunedSound = tuned.sound && tuned.sound.engine_sim;
        if(tunedSound && v.engine_build) ["layout", "bore", "stroke", "compression_ratio", "intake_duration", "exhaust_duration", "intake_flow", "exhaust_flow", "primary_length", "exhaust_length"].forEach(function(k) { if(tunedSound[k] !== undefined) sound[k] = tunedSound[k]; });
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
        if(cardMeta["Engine"]) cardMeta["Engine"].textContent = Math.round(peakHp) + " hp at " + peakHpRpm + " rpm, " + Math.round(peakNm) + " Nm";
        if(cardMeta["Drivetrain"]) {
            var topSpeed = 0;
            try { topSpeed = OpenRacer.topSpeed ? OpenRacer.topSpeed(tunedConfig()) : 0; } catch(e) { topSpeed = 0; }
            cardMeta["Drivetrain"].textContent = topSpeed > 0 ? "Top speed ~" + (imperial ? Math.round(topSpeed * 2.2369362920544) + " mph" : Math.round(topSpeed * 3.6) + " km/h") : "";
        }
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
            "#tuning { position: fixed; right: 10px; top: 10px; bottom: 10px; width: 390px; z-index: 1500; overflow-y: auto; padding: 0 14px 20px; " +
            "background: rgba(24, 29, 35, 0.9); color: var(--head); font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 13px; border-radius: 8px; display: none; }" +
            "#tuning h1 { font-size: 18px; margin: 0; }" +
            "#tuning .tuneHeader { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; justify-content: space-between; margin: 0 -14px 6px; padding: 10px 14px 8px; " +
            "background: rgba(24, 29, 35, 0.98); border-bottom: 1px solid var(--line); border-radius: 8px 8px 0 0; cursor: grab; touch-action: none; user-select: none; }" +
            "#tuning .tuneHeader button { font-size: 20px; line-height: 1; padding: 2px 10px; }" +
            "#tuning .sub { color: var(--muted); font-size: 12px; margin-bottom: 8px; line-height: 1.4; }" +
            "#tuning .info { background: var(--bg2); border-radius: 5px; padding: 6px 8px; margin-bottom: 8px; color: var(--head); font-size: 12px; line-height: 1.4; }" +
            "#tuning details { border-top: 1px solid var(--line); padding: 4px 0; }" +
            "#tuning details.card { border: 1px solid var(--line); border-radius: 8px; margin: 6px 0; padding: 2px 10px; background: rgba(255, 255, 255, 0.025); }" +
            "#tuning details.card > summary { font-size: 14px; letter-spacing: 0; text-transform: none; color: var(--head); padding: 8px 0; }" +
            "#tuning details.card > summary .meta { float: right; color: var(--muted); font-weight: normal; font-size: 12px; }" +
            "#tuning details.card > details { border-top: 0; }" +
            "#tuning summary { cursor: pointer; padding: 5px 0; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; font-size: 12px; color: var(--muted); }" +
            "#tuning .item { margin: 5px 0 8px; }" +
            "#tuning .line { display: flex; align-items: center; gap: 6px; }" +
            "#tuning .line .label { flex: 1; }" +
            "#tuning .line.changed .label { color: var(--accent2); }" +
            "#tuning input[type=number], #tuning select { width: 84px; background: var(--bg2); color: #fff; border: 1px solid var(--line); border-radius: 4px; padding: 3px 5px; font: inherit; }" +
            "#tuning input[type=range] { width: 100%; margin: 2px 0 0; }" +
            "#tuning .unit { width: 52px; color: var(--muted); font-size: 11px; }" +
            "#tuning button { background: var(--line); color: #fff; border: 0; border-radius: 4px; padding: 4px 10px; cursor: pointer; font: inherit; }" +
            "#tuning button:hover { background: #343c47; }" +
            "#tuning button.small { padding: 1px 6px; }" +
            "#tuning .actions { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }" +
            "#tuning .actions .save { background: var(--accent); }" +
            "#tuning .message { color: var(--accent2); min-height: 16px; margin-top: 4px; }" +
            "#tuning .featureLine { cursor: pointer; margin: 6px 0 2px; } #tuning .featureLine input { margin: 0; }" +
            "#tuning .featureBox { display: none; margin: 4px 0 8px 10px; padding-left: 10px; border-left: 2px solid var(--line); }" +
            "#tuning .ebu { margin: 4px 0 8px; } #tuning .ebuItem { margin: 5px 0 8px; } #tuning .ebuItem select { width: 100%; } #tuning .ebuLine { display: flex; align-items: center; gap: 6px; } #tuning .ebuLabel { flex: 1; }" +
            "#tuning .ebuRange { width: 100%; margin: 2px 0 0; } #tuning .ebuInfo { color: var(--muted); font-size: 12px; margin: 2px 0 8px; line-height: 1.4; }" +
            "#tuning .ebuGroup { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin: 10px 0 2px; } #tuning .ebuChart { width: 100%; height: auto; aspect-ratio: 800 / 360; background: #12161c; border: 1px solid var(--line); border-radius: 8px; }" +
            "#tuning .ebuPanel { position: relative; } #tuning .ebuPanelClose { display: none; position: absolute; top: 6px; right: 6px; z-index: 2; width: 28px; height: 28px; padding: 0; align-items: center; justify-content: center; }" +
            "#tuning .ebuPanel.pinned { position: fixed; top: 10px; width: 440px; box-sizing: border-box; z-index: 1501; background: rgba(24, 29, 35, 0.96); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px 4px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); }" +
            "#tuning .ebuPanel.pinned .ebuPanelClose { display: inline-flex; } #tuning .ebuPanel.pinned .ebuChart { border: 0; }" +
            "#tuning .ebuLegend, #tuning .ebuDynoInfo { color: var(--muted); font-size: 11.5px; } #tuning .ebuDyno { display: flex; align-items: center; gap: 8px; margin: 6px 0 8px; } #tuning .ebu input[type=number] { width: 84px; }" +
            "#tuning .gears { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 8px; }" +
            "#tuning .gears label { font-size: 11px; color: var(--muted); display: block; } #tuning .gears input { width: 100%; box-sizing: border-box; }";
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

    var SELECTS = {
        drive: ["Drive", [["rwd", "Rear wheels"], ["fwd", "Front wheels"], ["awd", "All wheels"]]],
        gearbox: ["Gearbox", [["gears", "Manual (a clutch pedal)"], ["imt", "Manual with an automatic clutch (IMT)"], ["amt", "Automated manual (AMT)"], ["dct", "Dual clutch (DCT)"], ["torque-converter", "Automatic with a torque converter"], ["cvt", "CVT (continuously variable)"]]],
        diff: ["Differential", [["open", "Open"], ["lsd", "Limited slip"], ["welded", "Welded (locked)"]]],
        compound: ["Tyre compound", OpenRacer.TyreCompounds.map(function(k) { return [k.id, k.name]; })],
        center_diff: ["Centre differential", [["open", "Open"], ["lsd", "Limited slip"], ["locked", "Locked"]]],
        tyre_damage: ["Tyre damage", [["off", "Off"], ["on", "On (a hard hit can puncture a tyre: it loses its pressure)"]]],
        unsprung: ["Suspension", [["sprung", "Springs and dampers"], ["none", "None (a kart: the frame stands on its tyres)"]]],
        antilag_mode: ["When", [["lift", "After lifting off the throttle"], ["launch", "Only with the two-step, the transbrake or the launch control"]]],
        // the rest of the car editor (the lists are made when the menu is built: the tables they come from load after this file)
        susp_front: ["Suspension at the front", function() { return partsTypes(); }],
        susp_rear: ["Suspension at the rear", function() { return partsTypes(); }],
        engine_place: ["Engine placement", [["front", "Front"], ["mid", "Mid"], ["rear", "Rear"]]],
        tc_lockup: ["Torque converter: lock-up clutch", [["on", "On"], ["off", "Off"]]],
        sb_enabled: ["The car dents (the shell of nodes)", [["on", "On"], ["off", "Off (a rigid body; the car is built again)"]]],
        rim_front: ["Rim at the front (the wheel library; the car is built again)", function() { return libraryList("rims"); }],
        tyre_front: ["Tyre at the front (it brings its own shell)", function() { return libraryList("tyres"); }],
        rim_rear: ["Rim at the rear", function() { return libraryList("rims"); }],
        tyre_rear: ["Tyre at the rear", function() { return libraryList("tyres"); }],
        body_finish: ["Finish of the body", function() { var F = OpenRacer.carFinishes || {}; return Object.keys(F).map(function(id) { return [id, F[id].label]; }); }],
        body_pattern: ["Flake pattern of the body", function() { var P = OpenRacer.carFlakePatterns || {}; return Object.keys(P).map(function(id) { return [id, P[id]]; }); }],
        body_uv: ["Flake map of the body (the UV map)", function() { var U = OpenRacer.carFlakeUvs || {}; return Object.keys(U).map(function(id) { return [id, U[id]]; }); }],
        rim_uv: ["Flake map of the rims (the UV map)", function() { var U = OpenRacer.carFlakeUvs || {}; return Object.keys(U).map(function(id) { return [id, U[id]]; }); }],
        rim_pattern: ["Flake pattern of the rims", function() { var P = OpenRacer.carFlakePatterns || {}; return Object.keys(P).map(function(id) { return [id, P[id]]; }); }],
        rim_finish: ["Finish of the rims", function() { var F = OpenRacer.carFinishes || {}; return Object.keys(F).map(function(id) { return [id, F[id].label]; }); }],
        sim_layout: ["Engine layout (the sound)", function() { var L = OpenRacer.engineSimLayouts || {}; return Object.keys(L).map(function(id) { return [id, L[id].label || id]; }); }],
        sim_ir: ["Exhaust of the sound", function() { return (OpenRacer.engineSimImpulseResponses || []).map(function(ir) { return [ir.id, ir.label || ir.id]; }); }]
    };
    // the colour pickers (CarTuning.js: body_color, rim_color): a picker and a button back to the car as made
    var COLORS = { body_color: "Colour of the body (the material carpaint)", rim_color: "Colour of the rims (the material rimpaint)" };
    function colorRow(key) {
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("div");
        line.className = "line";
        line.innerHTML = "<span class=\"label\">" + COLORS[key] + "</span>";
        var input = document.createElement("input");
        input.type = "color";
        input.style.cssText = "width: 44px; height: 26px; padding: 0 2px; border: 1px solid var(--line); border-radius: 5px; background: transparent; cursor: pointer;";
        input.addEventListener("input", function() { set(key, input.value); });
        input.addEventListener("change", function() { input.blur(); });
        var reset = document.createElement("button");
        reset.className = "small";
        reset.textContent = "↺";
        reset.title = "The colour of the model";
        reset.addEventListener("click", function() { set(key, ""); });
        line.appendChild(input);
        line.appendChild(reset);
        item.appendChild(line);
        controls.push({ key: key, color: input, line: line });
        return item;
    }
    function partsTypes() { var T = OpenRacer.PartsLibrary && OpenRacer.PartsLibrary.TYPES || {}; return Object.keys(T).map(function(id) { return [id, T[id].label || id]; }); }
    // the rims or the tyres of the wheel library (WheelLibrary.js; wheels/wheels.json), with "the wheel of the model" first
    function libraryList(kind) { var L = OpenRacer.WheelLibrary, list = L ? L[kind]() : []; return [["", kind === "rims" ? "From the model" : "From the model (tyres.shell of the car)"]].concat(list.map(function(e) { return [e.id, e.name || e.id]; })); }

    function selectRow(key) {
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("div");
        line.className = "line";
        line.innerHTML = "<span class=\"label\">" + SELECTS[key][0] + "</span>";
        var select = document.createElement("select");
        var options = typeof SELECTS[key][1] === "function" ? SELECTS[key][1]() : SELECTS[key][1];
        select.innerHTML = options.map(function(o) { return "<option value=\"" + o[0] + "\">" + o[1] + "</option>"; }).join("");
        select.style.width = "130px";
        select.addEventListener("change", function() { set(key, select.value); select.blur(); });
        line.appendChild(select);
        item.appendChild(line);
        controls.push({ key: key, select: select, line: line });
        return item;
    }

    // An extra with a checkbox: its settings are in a container below it that is open while the box is ticked
    function featureRow(feature) {
        var wrap = document.createElement("div");
        wrap.className = "feature";
        var line = document.createElement("label");
        line.className = "line featureLine";
        var box = document.createElement("input");
        box.type = "checkbox";
        var label = document.createElement("span");
        label.className = "label";
        label.textContent = feature.label;
        line.appendChild(box);
        line.appendChild(label);
        wrap.appendChild(line);
        var inner = document.createElement("div");
        inner.className = "featureBox";
        feature.items.forEach(function(def) { inner.appendChild(SELECTS[def[0]] ? selectRow(def[0]) : slider(def)); });
        wrap.appendChild(inner);
        box.addEventListener("change", function() { set(feature.key + "_on", box.checked); box.blur(); });
        controls.push({ key: feature.key + "_on", checkbox: box, inner: inner, line: line });
        return wrap;
    }

    var cardMeta = {}, engineUi = null, buildResult = null, header = null;

    // the engine that is built (EngineBuild.js) for the piece of the Engine card (EngineBuildUI.js): what it works on is in the values of the menu
    function workOutBuild() {
        var b = values.engine_build;
        buildResult = b && OpenRacer.EngineBuild ? OpenRacer.EngineBuild.compute(b, values.limiter_rpm, values.idle_rpm) : null;
    }
    // The chart and Run dyno of the Engine card stand next to the menu (at its left) while the card is open, so they do not scroll away with the settings (as in the car editor);
    // not on a narrow window. The menu can be moved, so the place is looked at now and then while it is there.
    var engineCard = null, engineChartTimer = null;
    function placeEngineChart() {
        var chart = engineUi && engineUi.panel;
        if(!chart || !engineCard) return;
        var rect = panel ? panel.getBoundingClientRect() : null;
        var pinned = engineCard.open && panel && panel.style.display !== "none" && window.innerWidth >= 1000 && rect && rect.left > 460;
        chart.classList.toggle("pinned", !!pinned);
        if(pinned) {
            chart.style.right = Math.round(window.innerWidth - rect.left + 12) + "px";
            chart.style.top = Math.round(Math.max(10, rect.top)) + "px";
            chart.style.maxWidth = Math.round(rect.left - 24) + "px";
            if(!engineChartTimer) engineChartTimer = setInterval(placeEngineChart, 300);
        } else {
            chart.style.right = chart.style.top = chart.style.maxWidth = "";
            if(engineChartTimer) { clearInterval(engineChartTimer); engineChartTimer = null; }
        }
    }
    window.addEventListener("resize", placeEngineChart);

    var engineHost = {
        closeCard: function() { if(engineCard) engineCard.open = false; },
        build: function() { return values.engine_build || null; },
        setBuild: function(b) {
            values.engine_build = JSON.parse(JSON.stringify(b));
            workOutBuild();
            // the turbo of the game follows the build (as in the car editor): the share of the torque that is boost, the lag, the intercooler; a supercharger has no lag
            var EB = OpenRacer.EngineBuild, spec = EB.turboSpec(b), ind = b.induction || {};
            values.turbo_share = spec && buildResult ? Math.round(buildResult.boostShare * 100 / 5) * 5 : 0;
            values.turbo_boost = 0;
            if(spec) { values.turbo_spool = spec.spool; values.turbo_threshold = spec.threshold; values.turbo_intercooler = Math.round(EB.INTERCOOLERS[ind.intercooler].value * 100); values.turbo_efficiency = 72; values.boost_full = ind.boost; }
            apply(); store(); refresh();
        },
        exhaust: function() { return values.exhaust_type || "custom"; },
        setExhaust: function(type) { values.exhaust_type = type; apply(); store(); refresh(); },
        speeds: function() { return { idle: values.idle_rpm, limiter: values.limiter_rpm }; },
        setLimiter: function(rpm) { values.limiter_rpm = rpm; },
        curve: function() { var t = tunedConfig(); return t.engine && t.engine.torque_curve; },
        result: function() { return buildResult; },
        driveline: function() {
            var t = tunedConfig();
            return { gears: t.drivetrain.gear_ratios, final_drive: t.drivetrain.final_drive, tyre: t.chassis.tire_diameter, mass: t.chassis.mass, efficiency: t.drivetrain.efficiency, inertia: t.engine.inertia, power: t.engine.power_scale };
        }
    };

    function build() {
        addStyle();
        panel = document.createElement("div");
        panel.id = "tuning";
        // the header (the title and a cross to close) is the handle: only it drags the panel, so the rest scrolls with the finger without moving the menu
        header = document.createElement("div");
        header.className = "tuneHeader";
        header.innerHTML = "<h1>Tuning</h1>";
        var cross = document.createElement("button");
        cross.type = "button"; cross.textContent = "\u00d7"; cross.title = "Close the tuning menu"; cross.setAttribute("aria-label", "Close the tuning menu");
        cross.onclick = function() { setVisible(false); };
        header.appendChild(cross);
        panel.appendChild(header);
        panel.insertAdjacentHTML("beforeend", "<div class=\"sub\">Change the car while you drive. The tuning of this car is kept in the browser. " +
            "The key to show or hide this menu can be changed in the settings menu.</div>");
        info = document.createElement("div");
        info.className = "info";
        panel.appendChild(info);
        var messageLine = document.createElement("div");
        messageLine.className = "message";
        panel.appendChild(messageLine);
        // the setups: the car under a name, kept in the browser (OpenRacer.Setups; the main menu offers them on the card of the car when there are two or more): the list,
        // Save (the setup that is chosen is overwritten with the car as it is now), Save as new… (a name is asked), Delete; "The car as made" is car.json, which the car editor writes
        var setupLine = document.createElement("div");
        setupLine.className = "actions setups";
        var setupLabel = document.createElement("span");
        setupLabel.textContent = "Setup";
        setupLabel.style.cssText = "align-self: center; color: var(--muted);";
        setupSelect = document.createElement("select");
        setupSelect.style.width = "150px";
        setupSelect.onchange = function() {
            // the values of the table from the setup (its whole configuration; what the table does not have, the suspension and the parts, waits for the next start)
            var name = setupSelect.value, from = name ? OpenRacer.Setups.configOf(config.id, name, config) : null;
            values = clone(base);
            // (a setup laid over the car as made, as main.js lays it at the start: what the setup does not say, the car says)
            var saved = fromConfig(from ? Object.assign({}, original, from) : original);
            Object.keys(saved).forEach(function(key) { if(key in base) values[key] = saved[key]; });
            OpenRacer.Setups.setActive(config.id, name || null);
            apply(); store(); refresh();
            message(name ? "Setup " + name + " (what the menu does not have, the suspension and the parts, comes at the next start)." : "The car as it was made (fully at the next start).");
        };
        var saveSetup = document.createElement("button");
        saveSetup.className = "save";
        saveSetup.textContent = "Save";
        saveSetup.title = "The setup that is chosen is overwritten with the car as it is now";
        saveSetup.onclick = function() {
            var name = setupSelect.value;
            if(!name) { message("Choose a setup to overwrite, or Save as new…"); return; }
            OpenRacer.Setups.save(config.id, name, tunedConfig());           // (the whole car, as it is tuned; the main menu draws its picture)
            refresh();
            message("Setup " + name + " saved.");
        };
        var saveNew = document.createElement("button");
        saveNew.textContent = "Save as new…";
        saveNew.onclick = function() {
            var name = window.prompt("The name of the new setup", "");
            if(name === null) return;
            name = name.trim().slice(0, 40);
            if(!name) return;
            OpenRacer.Setups.save(config.id, name, tunedConfig());
            refresh();
            message("Setup " + name + " saved; the main menu asks which tune to drive.");
        };
        var dropSetup = document.createElement("button");
        dropSetup.textContent = "Delete";
        dropSetup.onclick = function() {
            var name = setupSelect.value;
            if(!name) return;
            OpenRacer.Setups.remove(config.id, name);
            refresh();
            message("Setup " + name + " deleted (the tuning on the car stays as it is).");
        };
        // a tune shared as a file: Export (the setup that is chosen, or the car as it is tuned now) and Import (a file: it is kept as a setup of this car and chosen)
        var exportTune = document.createElement("button");
        exportTune.textContent = "Export…";
        exportTune.title = "The setup that is chosen (or the car as it is tuned now) as a file, to share";
        exportTune.onclick = function() {
            var name = setupSelect.value;
            var cfg = name ? (OpenRacer.Setups.configOf(config.id, name, original) || tunedConfig()) : tunedConfig();
            OpenRacer.Setups.exportFile(config.id, name || ((config.name || config.id) + " as tuned"), name ? Object.assign({}, original, cfg) : cfg);
            message("Tune " + (name || "as tuned now") + " saved as a file (in your downloads).");
        };
        var importTune = document.createElement("button");
        importTune.textContent = "Import…";
        importTune.title = "A tune file of someone else: it becomes a setup of this car, and is chosen";
        var importInput = document.createElement("input");
        importInput.type = "file"; importInput.accept = ".json,application/json"; importInput.style.display = "none";
        importInput.onchange = function() {
            var file = importInput.files && importInput.files[0];
            importInput.value = "";
            if(!file) return;
            file.text().then(function(text) {
                var tune = OpenRacer.Setups.parseFile(text);
                if(tune instanceof Error) { message(tune.message); return; }
                var name = window.prompt("The name of this tune" + (tune.car && tune.car !== config.id ? " (it was made for " + tune.car + ")" : ""), tune.name);
                if(name === null) return;
                name = name.trim().slice(0, 40) || tune.name;
                OpenRacer.Setups.save(config.id, name, Object.assign({}, original, tune.config));
                setupSelect.value = name;
                refreshSetups();
                setupSelect.value = name;
                setupSelect.onchange();
                message("Tune " + name + " imported and chosen" + (tune.car && tune.car !== config.id ? " (it was made for " + tune.car + ": mind the wheels and the parts)" : "") + ".");
            });
        };
        importTune.onclick = function() { importInput.click(); };
        setupLine.appendChild(setupLabel);
        setupLine.appendChild(setupSelect);
        setupLine.appendChild(saveSetup);
        setupLine.appendChild(saveNew);
        setupLine.appendChild(dropSetup);
        setupLine.appendChild(exportTune);
        setupLine.appendChild(importTune);
        setupLine.appendChild(importInput);
        panel.appendChild(setupLine);
        setupButtons = { save: saveSetup, drop: dropSetup };

        // the cards of the car editor, with the same names and the same order: each holds its groups of settings (a group with the name of its card is "<name> settings"), and
        // the Assists and extras card the systems and the extras. Cards without a setting that the car can use do not show. (The torque curve is not set here: it follows from
        // the engine that is built in the car editor.)
        var HIDDEN = { gen_power: true, gen_peak_rpm: true };
        var placed = {};
        function groupDetails(group, card) {
            var details = document.createElement("details");
            details.open = false;
            var summary = document.createElement("summary");
            summary.textContent = group.name === card.name ? group.name + " settings" : group.name;
            details.appendChild(summary);
            var count = 0;
            // (the settings of the tyre on top of its kind are folded away in a part of their own)
            var fineKeys = group.name === "Tyres" ? OpenRacer.CarTuning.TYRE_FINE : [];
            var fine = document.createElement("details");
            fine.innerHTML = "<summary title=\"The kind of tyre sets most of these: change them only to move away from it\">Fine-tune the tyre (on top of the kind)</summary>";
            var fineCount = 0;
            group.items.forEach(function(def) {
                if(HIDDEN[def[0]]) return;
                count++;
                var target = fineKeys.indexOf(def[0]) >= 0 ? fine : details;
                if(target === fine) fineCount++;
                if(SELECTS[def[0]]) target.appendChild(selectRow(def[0]));
                else if(COLORS[def[0]]) target.appendChild(colorRow(def[0]));
                else if(def[0] === "gears") target.appendChild(gearsRow());
                else target.appendChild(slider(def));
            });
            if(fineCount) details.appendChild(fine);
            return count ? details : null;
        }
        var cardList = OpenRacer.CarTuning.CARDS.slice();
        var known = {};
        cardList.forEach(function(card) { (card.groups || []).forEach(function(g) { known[g] = true; }); });
        var rest = GROUPS.filter(function(g) { return !known[g.name]; }).map(function(g) { return g.name; });
        if(rest.length) cardList.push({ name: "More settings", groups: rest });
        cardMeta = {};
        cardList.forEach(function(card) {
            var wrap = document.createElement("details");
            wrap.className = "card";
            wrap.open = false;
            var summary = document.createElement("summary");
            summary.appendChild(document.createTextNode(card.name));
            var meta = document.createElement("span");
            meta.className = "meta";
            summary.appendChild(meta);
            wrap.appendChild(summary);
            cardMeta[card.name] = meta;
            if(card.name === "Engine" && OpenRacer.EngineBuildUI && OpenRacer.EngineBuild) { engineUi = OpenRacer.EngineBuildUI.create(engineHost); wrap.appendChild(engineUi.element); engineCard = wrap; wrap.addEventListener("toggle", placeEngineChart); }
            var content = 0;
            (card.groups || []).forEach(function(name) {
                var group = GROUPS.filter(function(g) { return g.name === name; })[0];
                var details = group && groupDetails(group, card);
                if(details) { wrap.appendChild(details); content++; }
            });
            if(card.features) {
                OpenRacer.CarTuning.FEATURES.forEach(function(feature) { wrap.appendChild(featureRow(feature)); content++; });
            }
            if(content || (card.name === "Engine" && engineUi)) panel.appendChild(wrap);
        });
        // the mirrors (Mirrors.js): the turn and the tilt of every glass, kept as options of the game (they are not part of a tune: where you want to look is yours); filled when the group is opened,
        // since the model of the car may not be there yet when the menu is made
        var mirrorGroup = document.createElement("details");
        mirrorGroup.open = false;
        mirrorGroup.className = "card";
        mirrorGroup.innerHTML = "<summary>Mirrors</summary>";
        var mirrorBody = document.createElement("div");
        mirrorGroup.appendChild(mirrorBody);
        function fillMirrors() {
            mirrorBody.innerHTML = "";
            var list = car && car.mirrors ? car.mirrors : [], sides = [];
            list.forEach(function(m) { if(sides.indexOf(m.side) < 0) sides.push(m.side); });
            if(!sides.length) {
                var none = document.createElement("div");
                none.className = "item";
                none.style.cssText = "color: var(--muted); font-size: 13px; padding: 6px 2px;";
                none.textContent = "This car has no mirror glass that can be aimed (a mesh with the material \"mirror\").";
                mirrorBody.appendChild(none);
                return;
            }
            var names = { Left: "Left mirror", Right: "Right mirror", Centre: "Mirror inside" };
            sides.forEach(function(side) {
                [["Yaw", "turn (positive " + (side === "Centre" ? "to the left" : "outwards") + ")"], ["Tilt", "tilt (positive up)"]].forEach(function(kind) {
                    var name = "mirror" + side + kind[0], item = document.createElement("div");
                    item.className = "item";
                    var line = document.createElement("div");
                    line.className = "line";
                    var label = document.createElement("span");
                    label.className = "label";
                    label.textContent = names[side] + ": " + kind[1];
                    var input = document.createElement("input");
                    input.type = "range"; input.min = -25; input.max = 25; input.step = 1; input.value = Settings.option(name) || 0;
                    input.style.cssText = "flex: 1; min-width: 80px;";
                    var text = document.createElement("span");
                    text.style.cssText = "min-width: 38px; text-align: right;";
                    text.textContent = input.value + "\u00b0";
                    input.addEventListener("input", function() { Settings.setOption(name, parseFloat(input.value)); text.textContent = input.value + "\u00b0"; });
                    var reset = document.createElement("button");
                    reset.className = "small";
                    reset.textContent = "\u21ba";
                    reset.title = "As the model has it";
                    reset.addEventListener("click", function() { Settings.setOption(name, 0); input.value = 0; text.textContent = "0\u00b0"; });
                    line.appendChild(label); line.appendChild(input); line.appendChild(text); line.appendChild(reset);
                    item.appendChild(line);
                    mirrorBody.appendChild(item);
                });
            });
        }
        mirrorGroup.addEventListener("toggle", function() { if(mirrorGroup.open) fillMirrors(); });
        panel.appendChild(mirrorGroup);
        document.body.appendChild(panel);
        OpenRacer.Movable.make(panel, { key: "tuning", handle: header });
    }

    // the list of the setups, with the one in use chosen (and "(changed)" when the tuning has moved away from it)
    function refreshSetups() {
        if(!setupSelect || !OpenRacer.Setups) return;
        var names = OpenRacer.Setups.names(config.id), active = OpenRacer.Setups.active(config.id);
        setupSelect.innerHTML = "";
        var none = document.createElement("option");
        none.value = ""; none.textContent = "Default (the car as made)";
        setupSelect.appendChild(none);
        names.forEach(function(name) {
            var o = document.createElement("option");
            o.value = name;
            var same = true;
            if(name === active) { var cfg = OpenRacer.Setups.configOf(config.id, name, config), saved = cfg ? fromConfig(Object.assign({}, original, cfg)) : null; if(saved) Object.keys(saved).forEach(function(key) { if(key in base && JSON.stringify(saved[key]) !== JSON.stringify(values[key])) same = false; }); }
            o.textContent = name + (name === active && !same ? " (changed)" : "");
            setupSelect.appendChild(o);
        });
        setupSelect.value = active && names.indexOf(active) >= 0 ? active : "";
        if(setupButtons) { var none = !setupSelect.value; setupButtons.save.disabled = none; setupButtons.drop.disabled = none; setupButtons.save.style.opacity = setupButtons.drop.style.opacity = none ? 0.45 : 1; }
    }

    // The shell of a tyre of the wheel library is the tyre's own (WheelLibrary.js): with a library tyre on both axles the shell sliders show the tyre's values and are
    // grey (front; the rear in the note below the tyres), with a tyre of the model on one axle they work for that axle
    var SHELL_KEYS = { tyre_width: ["width", 100], tyre_rings: ["rings", 1], tyre_segments: ["segments", 1], tyre_inner_ratio: ["inner_ratio", 100], tyre_carcass: ["carcass", 1] };
    var shellNote = null;
    function libraryShell(axle) {
        var L = OpenRacer.WheelLibrary;
        if(!L || !values["tyre_" + axle]) return null;
        var s = L.shellOf(tunedConfig(), axle);
        if(!s) return null;
        var d = car.vehicle.tyreShell;        // (what the tyre does not say, the car's shared shell gives)
        return { width: s.width > 0 ? s.width : d.width, rings: s.rings > 0 ? s.rings : d.rings, segments: s.segments > 0 ? s.segments : d.segments, inner_ratio: s.inner_ratio > 0 ? s.inner_ratio : d.inner_ratio, carcass: s.carcass !== undefined && s.carcass !== null ? s.carcass : d.carcass };
    }
    function shellText(s) { return (s.width > 0 ? Math.round(s.width * 100) + " cm wide, " : "") + s.rings + " rings × " + s.segments + " nodes, inner shell " + Math.round(s.inner_ratio * 100) + " %, carcass " + s.carcass + " mm"; }

    function refresh() {
        refreshSetups();
        var CT = OpenRacer.CarTuning;
        var shellFront = libraryShell("front"), shellRear = libraryShell("rear"), shellLocked = !!(shellFront && shellRear);
        if(!shellNote) { var after = controls.filter(function(c) { return c.key === "tyre_rear"; })[0]; if(after && after.line.parentNode) { shellNote = document.createElement("div"); shellNote.id = "tuningShellNote"; shellNote.style.cssText = "font-size:12px; color:var(--accent2); margin:2px 0 6px"; after.line.parentNode.parentNode.insertBefore(shellNote, after.line.parentNode.nextSibling); } }
        if(shellNote) {
            var parts = [];
            if(shellFront) parts.push("front: " + shellText(shellFront));
            if(shellRear) parts.push("rear: " + shellText(shellRear));
            shellNote.textContent = parts.length ? "The shell of a library tyre is set on the tyre (wheels/wheels.json): " + parts.join("; ") + (shellLocked ? "." : ". The shell sliders work for the other axle.") : "";
            shellNote.style.display = parts.length ? "" : "none";
        }
        controls.forEach(function(c) {
            if(c.range && SHELL_KEYS[c.key]) {
                c.range.disabled = c.number.disabled = shellLocked;
                c.line.style.opacity = shellLocked ? 0.55 : "";
                if(shellLocked) { var sv = shellFront[SHELL_KEYS[c.key][0]] * SHELL_KEYS[c.key][1]; c.range.min = Math.min(c.def[3], sv); c.range.max = Math.max(c.def[4], sv); c.range.value = sv; c.number.value = format(c.def, sv); c.line.classList.remove("changed"); return; }
            }
            // the row of a setting that cannot do anything with the others as they are is hidden (CarTuning.visible)
            if(c.line && c.line.parentNode && CT.visible) {
                var shown = c.checkbox ? CT.visibleFeature(c.key.replace(/_on$/, ""), values) : CT.visible(c.key, values);
                c.line.parentNode.style.display = shown ? "" : "none";
            }
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
                c.input.style.color = changed(c.key) ? "var(--accent2)" : "";
            } else if(c.select) {
                c.select.value = values[c.key];
                c.line.classList.toggle("changed", changed(c.key));
            } else if(c.color) {
                if(document.activeElement !== c.color) c.color.value = values[c.key] || "#888888";
                c.color.style.opacity = values[c.key] ? "" : 0.45;
                c.color.title = values[c.key] ? values[c.key] : "The colour of the model (click to choose one)";
                c.line.classList.toggle("changed", changed(c.key));
            } else if(c.checkbox) {
                c.checkbox.checked = !!values[c.key];
                c.inner.style.display = values[c.key] ? "block" : "none";
                c.line.classList.toggle("changed", changed(c.key));
            }
        });
        workOutBuild();
        if(engineUi) engineUi.update();
        updateInfo();
    }

    // The configuration of the car with the tuning in it
    function tunedConfig() { return OpenRacer.CarTuning.toConfig(config, values); }


    // the lists that are made when the menu is built can grow after it (the wheel library loads with the car): made again when the menu opens
    function refreshSelectLists() {
        controls.forEach(function(c) {
            if(!c.select || typeof SELECTS[c.key][1] !== "function") return;
            var options = SELECTS[c.key][1]();
            var html = options.map(function(o) { return "<option value=\"" + o[0] + "\">" + o[1] + "</option>"; }).join("");
            if(html !== c.select.innerHTML) { var was = c.select.value; c.select.innerHTML = html; c.select.value = was; }
        });
    }

    function setVisible(show) {
        visible = show;
        panel.style.display = show ? "block" : "none";
        if(show) {
            refreshSelectLists();
            refresh();
            message("");
        } else if(document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
    }

    // Makes the tuning menu for a car, and puts the tuning that was kept for it on the car
    function attach(newCar, newConfig, baseConfig) {
        car = newCar;
        config = clone(newConfig);
        original = clone(baseConfig || newConfig);
        base = fromConfig(config);
        values = clone(base);
        load();
        rebuildSig = builtFrom(OpenRacer.CarTuning.toConfig(config, base));        // (what the car is built with now, the car as loaded: a tuning that was kept with another suspension, other wheels or another soft body builds it again, below in apply)
        lastCurve = config.engine && config.engine.torque_curve ? clone(config.engine.torque_curve) : null;
        controls = [];
        engineUi = null;
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
