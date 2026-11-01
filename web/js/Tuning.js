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
    var source = null;       // where the car comes from: null for the server, "garage" or "folder" (OpenRacer.Garage.sourceOf): only car.json of the server is written by Save on Default
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
    // (the rubber and the tread of a custom tyre work on the grip, not on the model: they only build the car again when the pattern of the tyre changes, Wheel.js treadPattern)
    function libraryWithoutRubber(c) {
        var L = c.wheels && c.wheels.library;
        if(!L) return L;
        var out = {};
        Object.keys(L).forEach(function(axle) {
            out[axle] = Object.assign({}, L[axle]);
            if(out[axle].custom) { var k = out[axle].custom; out[axle].custom = Object.assign({}, k, { pattern: OpenRacer.treadPattern(k.tread, k.rubber >= 0 ? k.rubber : 50) }); delete out[axle].custom.rubber; delete out[axle].custom.tread; }
        });
        return out;
    }
    function builtFrom(c) { return JSON.stringify([c.suspension, c.driveline, c.softbody, c.dimensions, c.steering_wheel && c.steering_wheel.degrees, libraryWithoutRubber(c), c.chassis && c.chassis.cg_height, c.chassis && c.chassis.tire_diameter, c.engine && c.engine.build && c.engine.build.block]); }      // (the block: the engine model of the parts library, PartsLibrary.js)
    function apply() {
        var v = values;
        if(v.width > 0 && v.height > 0) car.frontal_area = v.width * v.height * 0.85;
        if(car.setColors) car.setColors({ body: v.body_color || null, rim: v.rim_color || null, bodyFinish: v.body_finish || "", rimFinish: v.rim_finish || "", bodyFlake: v.body_flake || 100, rimFlake: v.rim_flake || 100, bodyPattern: v.body_pattern || "noise", rimPattern: v.rim_pattern || "noise", bodyUv: v.body_uv || "model", rimUv: v.rim_uv || "model" });
        // the torque curve first: the clutch of retune() is made for the peak torque of the engine (a block that was swapped kept the clutch of the old one)
        var tuned = tunedConfig();
        var curve = tuned.engine && tuned.engine.torque_curve;
        if(curve && car.engine && JSON.stringify(curve) !== JSON.stringify(lastCurve)) {
            car.engine.torque_curve = curve.map(function(p) { return { rpm: p[0], nm: p[1] }; });
            lastCurve = curve;
        }
        car.vehicle.retune(OpenRacer.CarTuning.toRetune(v, car.frontal_area, air_density));
        // the rest of the car editor, live: the cameras, the steering wheel, the rider of a motorcycle, the sound; and the model built again for
        // what it is built from (the suspension and the driveline of the parts library, the soft body, the size), half a second after the last change
        if(OpenRacer.cameraSettings) car.cameraSettings = OpenRacer.cameraSettings(tuned);
        if(car.steeringWheel && v.steering_degrees > 0) car.steeringWheel.degrees = v.steering_degrees;
        if(car.vehicle.controller && car.vehicle.controller.retune && tuned.motorcycle) car.vehicle.controller.retune(tuned.motorcycle);
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
        // (and the character of another block than the car's own: tunedConfig lays it over the sound, CarTuning.toConfig)
        var presetKeys = v.engine_build && OpenRacer.engineSimPresets[v.engine_build.block] ? Object.keys(OpenRacer.engineSimPresets[v.engine_build.block]) : [];
        if(tunedSound && v.engine_build) ["layout", "bore", "stroke", "compression_ratio", "intake_duration", "exhaust_duration", "intake_flow", "exhaust_flow", "primary_length", "exhaust_length"].concat(presetKeys).forEach(function(k) { if(tunedSound[k] !== undefined) sound[k] = tunedSound[k]; });
        EngineSound.setParams(sound);
        updateInfo();
    }

    function updateInfo() {
        if(!info) return;
        var engine = car.engine;
        var peakHp = 0, peakHpRpm = 0, peakNm = 0;
        engine.torque_curve.forEach(function(p) {
            if(p.rpm > engine.limiterRPM) return;          // (the curve of a build goes on past the rev limit: a peak there is never reached)
            var nm = p.nm * engine.torqueScale;
            var hp = nm * p.rpm * Math.PI / 30 / 745.7;
            if(hp > peakHp) { peakHp = hp; peakHpRpm = p.rpm; }
            peakNm = Math.max(peakNm, nm);
        });
        var top = car.gear_ratios[car.gear_ratios.length - 1];
        var driven = car.wheels[values.drive === "fwd" ? 0 : 2] || car.wheels[0];      // (the wheel that drives, as it is fitted: it was the front one, whatever drove)
        var kmh = engine.limiterRPM * Math.PI / 30 * driven.radius / (top * car.final_drive) * 3.6;
        var imperial = Settings.option("units") === "imperial";
        if(cardMeta["Engine"]) cardMeta["Engine"].textContent = Math.round(peakHp) + " hp at " + peakHpRpm + " rpm, " + Math.round(peakNm) + " Nm";
        if(cardMeta["Drivetrain"]) {
            var topSpeed = 0;
            try { topSpeed = OpenRacer.topSpeed ? OpenRacer.topSpeed(tunedConfig()) : 0; } catch(e) { topSpeed = 0; }
            cardMeta["Drivetrain"].textContent = topSpeed > 0 ? "Top speed ~" + (imperial ? Math.round(topSpeed * 2.2369362920544) + " mph" : Math.round(topSpeed * 3.6) + " km/h") : "";
        }
        // (the top speed the car reaches, as the Drivetrain card says it; the speed at the limiter in top gear was 341 km/h for the hatchback, whose CVT ends in an overdrive)
        var reach = 0;
        try { reach = OpenRacer.topSpeed ? OpenRacer.topSpeed(tunedConfig()) * 3.6 : 0; } catch(e) { reach = 0; }
        if(!(reach > 0)) reach = kmh;
        info.textContent = Math.round(peakHp) + " hp at " + peakHpRpm + " rpm · " + Math.round(peakNm) + " Nm · top speed ~" +
            (imperial ? Math.round(reach / 1.609344) + " mph" : Math.round(reach) + " km/h") + " · " +
            Math.round(car.mass) + " kg · " + (car.mass / Math.max(1, peakHp)).toFixed(1) + " kg/hp";
    }

    // ---- storing

    function storageKey() {
        return STORAGE_PREFIX + config.id;
    }

    // (the differences from the setup that is chosen, which is the car of the next start: from the setup of this start, a setup switched to in the menu or a
    // deleted one came back at the next start as another car with these differences on it)
    function store() {
        var changed = {}, ref = reference();
        Object.keys(values).forEach(function(key) {
            if(JSON.stringify(values[key]) !== JSON.stringify(key in ref ? ref[key] : base[key])) changed[key] = values[key];
        });
        try {
            if(Object.keys(changed).length) window.localStorage.setItem(storageKey(), JSON.stringify(changed));
            else window.localStorage.removeItem(storageKey());
        } catch(e) {}
    }

    function load() {
        try {
            var stored = JSON.parse(window.localStorage.getItem(storageKey()));
            if(stored) Object.keys(stored).forEach(function(key) { if(key in base || /^gear\d+$/.test(key)) values[key] = stored[key]; });
            OpenRacer.CarTuning.normaliseGears(values);       // (a gearbox with more or fewer gears than the car had: the keys of the gears follow the count)
        } catch(e) {}
    }

    // ---- the menu

    function addStyle() {
        var style = document.createElement("style");
        style.textContent =
            "#tuning { position: fixed; right: 10px; top: 10px; bottom: 10px; box-sizing: border-box; width: min(418px, calc(100vw - 20px)); z-index: 1500; overflow-y: auto; padding: 0 14px 20px; " +
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

    // a control lets go of the keyboard after a change made with the mouse or a finger (so the car can be driven), not after one with the keys or a controller
    var byPointer = false;
    window.addEventListener("pointerdown", function() { byPointer = true; }, true);
    window.addEventListener("keydown", function() { byPointer = false; }, true);
    function letGo(el) { if(byPointer && !(OpenRacer.PadNav && OpenRacer.PadNav.recent && OpenRacer.PadNav.recent()) && el && el.blur) el.blur(); }

    function format(def, v) {
        var step = def[5];
        var digits = step >= 1 ? 0 : (step >= 0.1 ? 1 : (step >= 0.01 ? 2 : 3));
        return Number(v).toFixed(digits);
    }

    // What a value is compared with to be orange: the setup that is chosen as it was saved (so after Save the values are not orange any more; they are when they moved away from it),
    // else the car as it was made. The reset arrow of a value still goes back to the car as it was made.
    var referenceValues = null;
    // the tuning on the car differs from the setup that is chosen (as the "(changed)" of the list: gen_power and gen_peak_rpm follow from the curve)
    function unsavedChanges() { return differs(reference()); }
    // the values differ from those of a setup: the keys of the car and all the gears of each (a setup with another number of gears than the car of the start was
    // "changed" at once, or an edit of its sixth gear was not seen)
    function differs(ref) {
        var gearKey = /^gear\d+$/;
        if(JSON.stringify(OpenRacer.CarTuning.gearsOf(values)) !== JSON.stringify(OpenRacer.CarTuning.gearsOf(ref))) return true;
        return Object.keys(base).some(function(key) { return !gearKey.test(key) && key !== "gen_power" && key !== "gen_peak_rpm" && JSON.stringify(values[key]) !== JSON.stringify(ref[key]); });
    }
    function reference() {
        if(referenceValues) return referenceValues;
        referenceValues = base;
        var active = OpenRacer.Setups && config ? OpenRacer.Setups.active(config.id) : null;
        var cfg = active ? OpenRacer.Setups.configOf(config.id, active, config) : null;
        // (Default is the car as made, not the setup this start was on: every value of that setup was orange, and ↺ went to it)
        // (without the gears of the car of the start: the setup brings all of its own)
        try {
            var withoutGears = Object.assign({}, base);
            Object.keys(withoutGears).forEach(function(key) { if(/^gear\d+$/.test(key)) delete withoutGears[key]; });
            referenceValues = Object.assign(withoutGears, fromConfig(cfg ? Object.assign({}, original, cfg) : original));
        } catch(e) { referenceValues = base; }
        return referenceValues;
    }
    function changed(key) {
        return JSON.stringify(values[key]) !== JSON.stringify(reference()[key]);
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
        reset.title = "Back to the value of the setup that is chosen (or of the car as made)";
        line.appendChild(reset);
        item.appendChild(line);
        var range = document.createElement("input");
        range.type = "range";
        range.min = def[3];
        range.max = def[4];
        range.step = def[5];
        item.appendChild(range);
        range.addEventListener("input", function() { set(key, parseFloat(range.value)); });
        // a slider that was used with the mouse or a finger lets go of the keyboard again, so that the car can be driven (with the arrows it keeps it: it let go
        // after one step, and the next arrow steered the car)
        range.addEventListener("change", function() { letGo(range); });
        number.addEventListener("change", function() {
            var value = parseFloat(number.value);
            // (a typed value may go past the slider: to half its lowest and twice its highest, away from zero. With a negative lowest, half of it was nearer
            // to zero than the slider itself: a camber of -8 became -6, a ride height of -100 mm became -75)
            var lo = def[3] < 0 ? def[3] * 2 : def[3] / 2, hi = def[4] > 0 ? def[4] * 2 : def[4] / 2;
            // (a share in % stays a share: a brake bias of 655 % gave the rear brakes a negative torque, a front weight of 150 % the rear wheels a negative mass)
            if(def[2] === "%" && def[3] >= 0 && def[4] <= 100) { lo = Math.max(0, lo); hi = Math.min(100, hi); }       // (the floor as it was: 0 % front weight left an axle without mass)
            if(Number.isFinite(value)) set(key, Math.min(hi, Math.max(lo, value)));
            number.blur();
        });
        // (the setup that is chosen now, as the orange of a changed value: it went back to the car as the game started, also after a switch of setup)
        reset.addEventListener("click", function() { var ref = reference(); set(key, key in ref ? ref[key] : base[key]); });
        controls.push({ key: key, def: def, line: line, number: number, range: range });
        return item;
    }

    var gearGrid = null, gearsSummary = null;
    // the boxes of the gear ratios: one for every gear of the values (gear_count), made again when the number of gears changes
    function buildGearGrid() {
        if(!gearGrid) return;
        controls = controls.filter(function(c) { return !(c.gear && /^gear\d+$/.test(c.key)); });
        gearGrid.innerHTML = "";
        var n = OpenRacer.CarTuning.gearsOf(values).length;
        for(var gi = 0; gi < n; gi++) (function(i) {
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
            gearGrid.appendChild(wrap);
            controls.push({ key: "gear" + i, input: input, gear: true });
        })(gi);
        if(gearsSummary) gearsSummary();
    }
    // one more or one fewer gear (the last one is dropped; a new one is a little lower than the last)
    function gearCount(delta) {
        var gears = OpenRacer.CarTuning.gearsOf(values), n = Math.max(1, Math.min(10, gears.length + delta));
        if(n === gears.length) return;
        values.gear_count = n;
        OpenRacer.CarTuning.normaliseGears(values);
        buildGearGrid();
        apply(); store(); refresh();
    }
    function gearsRow() {
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("div");
        line.className = "line";
        line.innerHTML = "<span class=\"label\">Gear ratios</span>";
        // the ratios come with the transmission that is chosen; the final drive is set below. Advanced opens them gear by gear (and the number of gears).
        var advanced = false;
        try { advanced = window.localStorage.getItem("openracer.tuning.advancedGears") === "1"; } catch(e) { /* no storage */ }
        var summary = document.createElement("span");
        summary.style.cssText = "color: var(--muted); font-size: 11.5px; margin-left: 8px; flex: 1;";
        var counter = document.createElement("span");
        counter.style.cssText = "display: inline-flex; gap: 4px;";
        [["−", -1, "One gear fewer"], ["+", 1, "One gear more"]].forEach(function(b) {
            var button = document.createElement("button");
            button.type = "button"; button.textContent = b[0]; button.title = b[2]; button.style.cssText = "padding: 1px 9px;";
            button.addEventListener("click", function() { gearCount(b[1]); });
            counter.appendChild(button);
        });
        var toggle = document.createElement("button");
        toggle.type = "button"; toggle.style.cssText = "padding: 1px 9px;";
        line.appendChild(summary);
        line.appendChild(counter);
        line.appendChild(toggle);
        item.appendChild(line);
        gearGrid = document.createElement("div");
        gearGrid.className = "gears";
        item.appendChild(gearGrid);
        gearsSummary = function() {
            var g = OpenRacer.CarTuning.gearsOf(values);
            summary.textContent = g.length + " gears · " + g[0].toFixed(2) + " … " + g[g.length - 1].toFixed(2);
        };
        function show() {
            gearGrid.style.display = counter.style.display = advanced ? "" : "none";
            toggle.textContent = advanced ? "Simple" : "Advanced";
            toggle.title = advanced ? "Hide the ratios of the gears" : "Set the ratio of every gear, and the number of gears";
        }
        toggle.addEventListener("click", function() {
            advanced = !advanced;
            try { window.localStorage.setItem("openracer.tuning.advancedGears", advanced ? "1" : "0"); } catch(e) { /* no storage */ }
            show();
        });
        show();
        buildGearGrid();
        gearsSummary();
        return item;
    }

    // The transmissions to choose from: a gearbox with its gears, how it shifts and (for the automatics) its converter. Choosing one sets those values (the final drive stays: it
    // belongs to the car); they can be changed after. Only the ones that make sense with the choice are kept apart: the gears of a drag race automatic are two or three.
    var TRANSMISSIONS = [
        ["manual5", "5-speed manual (a clutch pedal)", { gearbox: "gears", gears: [3.55, 2.05, 1.38, 1.03, 0.82], reverse: 3.4, shift_time: 0.25 }],
        ["manual6", "6-speed manual (a clutch pedal)", { gearbox: "gears", gears: [3.62, 2.19, 1.52, 1.14, 0.92, 0.76], reverse: 3.5, shift_time: 0.25 }],
        ["sequential6", "6-speed sequential (no clutch pedal, quick shifts)", { gearbox: "imt", gears: [2.9, 2.0, 1.5, 1.2, 1.0, 0.84], reverse: 3.2, shift_time: 0.06 }],
        ["dct7", "7-speed dual clutch (DCT)", { gearbox: "dct", gears: [3.8, 2.4, 1.7, 1.3, 1.0, 0.8, 0.65], reverse: 3.6, shift_time: 0.12, shift_style: "normal" }],
        ["amt6", "6-speed automated manual (AMT)", { gearbox: "amt", gears: [3.62, 2.19, 1.52, 1.14, 0.92, 0.76], reverse: 3.5, shift_time: 0.6, shift_style: "normal" }],
        ["auto3", "3-speed automatic (TH400)", { gearbox: "torque-converter", gears: [2.48, 1.48, 1.0], reverse: 2.08, shift_time: 0.45, tc_stall_rpm: 2400, tc_ratio: 2.1, tc_lockup: "on", shift_style: "normal" }],
        ["auto4", "4-speed automatic", { gearbox: "torque-converter", gears: [2.84, 1.55, 1.0, 0.7], reverse: 2.3, shift_time: 0.4, tc_stall_rpm: 2300, tc_ratio: 2.0, tc_lockup: "on", shift_style: "normal" }],
        ["auto6", "6-speed automatic", { gearbox: "torque-converter", gears: [4.17, 2.34, 1.52, 1.14, 0.87, 0.69], reverse: 3.4, shift_time: 0.3, tc_stall_rpm: 2200, tc_ratio: 1.9, tc_lockup: "on", shift_style: "normal" }],
        ["auto8", "8-speed automatic (sport)", { gearbox: "torque-converter", gears: [4.7, 3.13, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67], reverse: 3.5, shift_time: 0.2, tc_stall_rpm: 2000, tc_ratio: 1.7, tc_lockup: "on", shift_style: "sport" }],
        ["drag2", "Drag automatic, 2-speed (Powerglide)", { gearbox: "torque-converter", gears: [1.76, 1.0], reverse: 1.8, shift_time: 0.3, tc_stall_rpm: 3800, tc_ratio: 2.3, tc_lockup: "off", shift_style: "drag" }],
        ["drag3", "Drag automatic, 3-speed (race TH400)", { gearbox: "torque-converter", gears: [2.48, 1.48, 1.0], reverse: 2.08, shift_time: 0.3, tc_stall_rpm: 4200, tc_ratio: 2.4, tc_lockup: "off", shift_style: "drag" }],
        ["drag3m", "Drag automatic, 3-speed, you shift (paddles, keys)", { gearbox: "torque-converter", gears: [2.48, 1.48, 1.0], reverse: 2.08, shift_time: 0.25, tc_stall_rpm: 4200, tc_ratio: 2.4, tc_lockup: "off", shift_style: "manual" }]
    ];
    function transmissionRow() {
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("div");
        line.className = "line";
        line.innerHTML = "<span class=\"label\">Transmission</span>";
        var select = document.createElement("select");
        select.title = "Sets the gearbox, its gears, the shifting and the converter of a kind of transmission. The values can be changed after.";
        select.innerHTML = "<option value=\"\">Choose a transmission…</option>" + TRANSMISSIONS.map(function(t) { return "<option value=\"" + t[0] + "\">" + t[1] + "</option>"; }).join("");
        select.style.width = "170px";
        select.addEventListener("change", function() {
            var t = TRANSMISSIONS.filter(function(x) { return x[0] === select.value; })[0];
            select.value = "";
            letGo(select);
            if(!t) return;
            var p = t[2];
            values.gearbox = p.gearbox;
            values.gear_count = p.gears.length;
            p.gears.forEach(function(r, i) { values["gear" + i] = r; });
            values.reverse_ratio = p.reverse;
            values.shift_time = p.shift_time;
            ["tc_stall_rpm", "tc_ratio", "tc_lockup", "shift_style"].forEach(function(k) { if(p[k] !== undefined) values[k] = p[k]; });
            if(p.shift_style === undefined) values.shift_style = "normal";
            OpenRacer.CarTuning.normaliseGears(values);
            buildGearGrid();
            apply(); store(); refresh();
            message(t[1] + ".");
        });
        line.appendChild(select);
        item.appendChild(line);
        return item;
    }

    var SELECTS = {
        drive: ["Drive", [["rwd", "Rear wheels"], ["fwd", "Front wheels"], ["awd", "All wheels"]]],
        shift_style: ["Shift pattern", [["normal", "Normal"], ["sport", "Sport (holds the gears)"], ["drag", "Drag (up at the rev limiter, no kick down)"], ["manual", "Manual (you shift, it does not)"]]],
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
        input.addEventListener("change", function() { letGo(input); });
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
    function libraryList(kind) {
        var L = OpenRacer.WheelLibrary, list = L ? L[kind]() : [];
        var out = [["", kind === "rims" ? "From the model" : "From the model (tyres.shell of the car)"]].concat(list.map(function(e) { return [e.id, e.name || e.id]; }));
        // (a custom tyre: made from the numbers of the shell, the rim fits its inner shell)
        if(kind === "tyres") out.push(["custom", "Custom (made from the shell settings)"]);
        return out;
    }

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
        select.addEventListener("change", function() { set(key, select.value); letGo(select); });
        line.appendChild(select);
        item.appendChild(line);
        controls.push({ key: key, select: select, line: line });
        return item;
    }

    // A setting that is on or off (a checkbox in the card of its group)
    function boolRow(key, label) {
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("label");
        line.className = "line featureLine";
        var box = document.createElement("input");
        box.type = "checkbox";
        var text = document.createElement("span");
        text.className = "label";
        text.textContent = label;
        line.appendChild(box);
        line.appendChild(text);
        item.appendChild(line);
        box.addEventListener("change", function() { set(key, box.checked); letGo(box); });
        controls.push({ key: key, bool: box, line: line });
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
        box.addEventListener("change", function() { set(feature.key + "_on", box.checked); letGo(box); });
        controls.push({ key: feature.key + "_on", checkbox: box, inner: inner, line: line });
        return wrap;
    }

    var cardMeta = {}, engineUi = null, buildResult = null, header = null;

    // the engine that is built (EngineBuild.js) for the piece of the Engine card (EngineBuildUI.js): what it works on is in the values of the menu
    // what the engine of the car weighs as it is now (EngineBuild.mass), worked out when the build is first changed; for an engine without a build (a torque curve of its own)
    // a guess from its peak torque (about 95 Nm a litre) and the cylinders of its sound
    var engineMassNow = 0;
    function stockEngineMass() {
        var c = config || {}, curve = (c.engine && c.engine.torque_curve) || [], peak = 0;
        curve.forEach(function(p) { peak = Math.max(peak, Array.isArray(p) ? p[1] : p.nm || 0); });
        var layout = String((OpenRacer.engineSimParams ? OpenRacer.engineSimParams(c) : {}).layout || "inline-4");
        var cylinders = /single/.test(layout) ? 1 : /twin/.test(layout) ? 2 : parseInt((layout.match(/\d+/) || [4])[0], 10) || 4;
        return 15 + 32 * Math.max(0.1, peak / 95) + 5 * cylinders;
    }
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
        turbo: function() {
            var share = (values.turbo_share || 0) / 100, bar = values.turbo_boost || 0;
            return { share: share, bar: bar, threshold: values.turbo_threshold || 2500, efficiency: (values.turbo_efficiency || 70) / 100, intercooler: (values.turbo_intercooler !== undefined ? values.turbo_intercooler : 75) / 100 };
        },
        closeCard: function() { if(engineCard) engineCard.open = false; },
        build: function() { return values.engine_build || null; },
        setBuild: function(b) {
            // the engine weighs what its size and its cylinders make it: the car is heavier or lighter by the difference with the engine it had (the Mass row shows it).
            // Every change counts (a bigger bore too), from the engine the car has now: the first swap from an engine without a build (a kart, a motorcycle) changed
            // nothing, and a bore that was enlarged and swapped away took its kilos off again at every round
            var EBm = OpenRacer.EngineBuild;
            if(b && EBm && EBm.mass) {
                if(!(engineMassNow > 0)) engineMassNow = values.engine_build ? EBm.mass(values.engine_build) : stockEngineMass();
                var heavier = EBm.mass(b), change = Math.round(heavier - engineMassNow);
                engineMassNow += change;          // (what was applied: with the exact value the rounding was lost at every step of a slider, 20 kg for a bore dragged by 10 mm)
                if(change) {
                    values.mass = Math.max(50, values.mass + change);
                    if(Math.abs(change) >= 5) message("The engine is " + Math.abs(change) + " kg " + (change > 0 ? "heavier" : "lighter") + ": the car weighs " + Math.round(values.mass) + " kg now.");
                }
            }
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
        // (a new block: the speeds that belong to the old engine follow the new rev limit, or a two-step of 9800 sat above the limiter of a V8 at 6400 and did nothing)
        setLimiter: function(rpm) {
            var f = values.limiter_rpm > 0 ? rpm / values.limiter_rpm : 1;
            values.limiter_rpm = rpm;
            if(Math.abs(f - 1) < 0.01) return;
            ["two_step_rpm", "launch_rpm", "governor_rpm", "cvt_rpm", "pops_rpm", "antilag_rpm"].forEach(function(k) { if(values[k] > 0) values[k] = Math.round(values[k] * f / 100) * 100; });
            if(values.tc_stall_rpm > 0) values.tc_stall_rpm = Math.round(values.tc_stall_rpm * f / 50) * 50;
        },
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
            // tuning that was not saved is lost by a switch: asked first (it was gone without a word)
            var was = OpenRacer.Setups.active(config.id) || "";
            if(!unsavedChanges()) { switchSetup(); return; }
            var to = setupSelect.value;
            setupSelect.value = was;
            OpenRacerDialog.ask({ title: "Switch the setup?", text: "The tuning on the car has changes that are not saved. They are lost when you switch to " + (to ? "“" + to + "”" : "the car as made") + ".", ok: "Switch", danger: true }).then(function(yes) {
                if(!yes) return;
                setupSelect.value = to;
                switchSetup();
            });
        };
        function switchSetup() {
            // the values of the table from the setup (its whole configuration; what the table does not have, the suspension and the parts, waits for the next start)
            var name = setupSelect.value, from = name ? OpenRacer.Setups.configOf(config.id, name, config) : null;
            values = clone(base); engineMassNow = 0;
            // (a setup laid over the car as made, as main.js lays it at the start: what the setup does not say, the car says)
            var saved = fromConfig(from ? Object.assign({}, original, from) : original);
            // (and all its gears: one of 8 gears on a car of 4 got made-up ratios for 5 to 8, and the boxes stayed 4)
            Object.keys(values).forEach(function(key) { if(/^gear\d+$/.test(key)) delete values[key]; });
            Object.keys(saved).forEach(function(key) { if(key in base || /^gear\d+$/.test(key)) values[key] = saved[key]; });
            OpenRacer.CarTuning.normaliseGears(values);
            OpenRacer.Setups.setActive(config.id, name || null);
            referenceValues = null;
            buildGearGrid();
            apply(); store(); refresh();
            message(name ? "Setup " + name + " (what the menu does not have, the suspension and the parts, comes at the next start)." : "The car as it was made (fully at the next start).");
        }
        var saveSetup = document.createElement("button");
        saveSetup.className = "save";
        saveSetup.textContent = "Save";
        saveSetup.title = "The setup that is chosen is overwritten with the car as it is now";
        saveSetup.onclick = function() {
            var name = setupSelect.value;
            if(!name) { saveDefault(); return; }
            var ok = OpenRacer.Setups.save(config.id, name, tunedConfig());           // (the whole car, as it is tuned; the main menu draws its picture)
            refresh();
            message(ok === false ? "Could not save: the storage of this browser is full." : "Setup " + name + " saved.");
        };
        // Save on Default: car.json is written with the tuning in it (the car as made becomes the car as it is tuned), through the API of the game's own server
        // (tools/serve.py, from this computer). The site has no such API, and a car of the garage or of a folder is changed in the car editor
        function saveDefault() {
            if(source) { message("This car is in your " + source + ": change car.json in the car editor, or keep the tuning with Save as new…"); return; }
            OpenRacerDialog.ask({ title: "Overwrite car.json?", text: "Default, the car as made, becomes the car as it is tuned now: this writes cars/" + config.id + "/car.json.", ok: "Overwrite", danger: true }).then(function(yes) {
                if(!yes) return;
                var made = OpenRacer.CarTuning.toConfig(original, values);
                var body = JSON.stringify(made, function(key, value) { return key === "id" && this === made ? undefined : value; }, 2) + "\n";
                return fetch("api/cars/" + encodeURIComponent(config.id) + "/car.json", { method: "PUT", body: body }).then(function(response) {
                    if(response.ok) {
                        // the car as made is this car now: nothing of the tuning differs from it, and the tuning kept for the car goes
                        made.id = config.id;
                        original = clone(made); config = clone(made); base = fromConfig(config);
                        store(); refresh();
                        message("car.json saved: Default is the car as it is tuned now.");
                        return;
                    }
                    return response.json().catch(function() { return {}; }).then(function(data) {
                        message(response.status === 403 ? "car.json is only written from this computer, by the game's own server (tools/serve.py). Keep the tuning with Save as new…"
                            : [404, 405, 501].indexOf(response.status) >= 0 ? "This server does not write car.json (the game's own server, tools/serve.py, does). Keep the tuning with Save as new…"
                            : "car.json was not saved: " + (data && data.error ? data.error : "HTTP " + response.status) + ".");
                    });
                }).catch(function() { message("car.json was not saved: there is no server that writes it (tools/serve.py). Keep the tuning with Save as new…"); });
            });
        }
        var saveNew = document.createElement("button");
        saveNew.textContent = "Save as new…";
        // (a name in a window of the game: the prompt of the browser stopped the game, and looked out of place in full screen and on a phone; a name that is
        // there already is overwritten only when that is confirmed)
        function askName(title, value) {
            return OpenRacerDialog.prompt({ title: title, input: value || "", ok: "Save", maxLength: 40 }).then(function(name) {
                if(name === null) return null;
                name = name.trim().slice(0, 40);
                if(!name) return null;
                if(OpenRacer.Setups.names(config.id).indexOf(name) < 0) return name;
                return OpenRacerDialog.ask({ title: "Overwrite the setup “" + name + "”?", text: "There is a setup with this name already.", ok: "Overwrite", danger: true }).then(function(yes) { return yes ? name : null; });
            });
        }
        saveNew.onclick = function() {
            askName("The name of the new setup").then(function(name) {
                if(!name) return;
                var ok = OpenRacer.Setups.save(config.id, name, tunedConfig());
                refresh();
                message(ok === false ? "Could not save: the storage of this browser is full." : "Setup " + name + " saved; the main menu asks which tune to drive.");
            });
        };
        var dropSetup = document.createElement("button");
        dropSetup.textContent = "Delete";
        dropSetup.onclick = function() {
            var name = setupSelect.value;
            if(!name) return;
            // (a setup that comes with the car, changed here: the changes go, and the setup as it comes with the car is on the car)
            if(OpenRacer.Setups.shippedState(config.id, name) === "copy") {
                OpenRacerDialog.ask({ title: "Undo the changes to “" + name + "”?", text: "The setup goes back to how it comes with the car.", ok: "Undo changes", danger: true }).then(function(yes) {
                    if(!yes) return;
                    OpenRacer.Setups.remove(config.id, name);
                    refresh();
                    setupSelect.value = name;
                    switchSetup();          // (chosen by the user already: not the question of a switch, which saw the new setup as active and the tuning as unsaved)
                });
                return;
            }
            OpenRacerDialog.ask({ title: "Delete the setup “" + name + "”?", text: "The tuning on the car stays as it is.", ok: "Delete", danger: true }).then(function(yes) {
                if(!yes) return;
                OpenRacer.Setups.remove(config.id, name);
                refresh();
                store();          // (kept now as differences from the car as made: they were kept from the deleted setup, and the next start was another car)
                message("Setup " + name + " deleted (the tuning on the car stays as it is).");
            });
        };
        // a tune shared as a file: Export (the setup that is chosen, or the car as it is tuned now) and Import (a file: it is kept as a setup of this car and chosen)
        var exportTune = document.createElement("button");
        exportTune.textContent = "Export…";
        exportTune.title = "The setup that is chosen (or the car as it is tuned now) as a file, to share";
        exportTune.onclick = function() {
            var name = setupSelect.value;
            // (a setup with changes on the car: the car as it is tuned now, under the name with "(changed)"; the saved setup was exported, without the changes)
            if(name && unsavedChanges()) {
                OpenRacer.Setups.exportFile(config.id, name + " (changed)", tunedConfig());
                message("Tune " + name + " with the changes that are not saved yet saved as a file (in your downloads).");
                return;
            }
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
                var other = tune.car && tune.car !== config.id;
                askName("The name of this tune" + (other ? " (it was made for " + tune.car + ": only its tuning is taken, not that car's wheels, size, shell or type)" : ""), tune.name).then(function(name) {
                if(!name) return;
                var taken = other && OpenRacer.Setups.tuningOnly ? OpenRacer.Setups.tuningOnly(tune.config, original) : tune.config;
                if(OpenRacer.Setups.save(config.id, name, Object.assign({}, original, taken)) === false) { message("Could not import: the storage of this browser is full."); return; }
                setupSelect.value = name;
                refreshSetups();
                setupSelect.value = name;
                switchSetup();          // (chosen by the user already: not the question of a switch, which saw the new setup as active and the tuning as unsaved)
                message("Tune " + name + " imported and chosen" + (other ? " (made for " + tune.car + ": its tuning, on this car's model)" : "") + ".");
                });
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
                if(def[0] === "gearbox") target.appendChild(transmissionRow());
                if(SELECTS[def[0]]) target.appendChild(selectRow(def[0]));
                else if(COLORS[def[0]]) target.appendChild(colorRow(def[0]));
                else if(def[0] === "gears") target.appendChild(gearsRow());
                else if(def[0] === "cam_cockpit_hide_driver") target.appendChild(boolRow(def[0], def[1]));
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
        // the soft body: shown as the car has it, not set here. The shell, its dents, the strength of the wheels and the loose parts are the car's (car.json): every setup and
        // every tune uses those (Setups.configOf); they are changed in the car editor, with Default chosen
        var shellCard = document.createElement("details");
        shellCard.open = false;
        shellCard.className = "card";
        shellCard.innerHTML = "<summary>Soft body</summary>";
        var shellBody = document.createElement("div");
        shellCard.appendChild(shellBody);
        function fillShell() {
            shellBody.innerHTML = "";
            var cfg = car && car.config ? car.config : {}, soft = cfg.softbody || {}, parts = (cfg.parts || []).filter(function(p) { return p && p.mode && p.mode !== "fixed"; });
            var strength = soft.wheel_strength !== undefined ? soft.wheel_strength : 25;
            [["The car dents", soft.enabled === false ? "Off" : "On"], ["Nodes of the shell at most", String(soft.max_nodes || 120)],
             ["A wheel comes off at a hit of", strength > 0 ? strength + " kN s" : "never"], ["Loose, hinged and breakable parts", String(parts.length)]].forEach(function(row) {
                var item = document.createElement("div");
                item.className = "item";
                var line = document.createElement("div");
                line.className = "line";
                var label = document.createElement("span");
                label.className = "label";
                label.textContent = row[0];
                var value = document.createElement("b");
                value.textContent = row[1];
                line.append(label, value);
                item.appendChild(line);
                shellBody.appendChild(item);
            });
            var note = document.createElement("div");
            note.className = "item";
            note.style.cssText = "color: var(--muted); font-size: 13px; padding: 6px 2px;";
            note.textContent = "These belong to the car, not to a setup: every setup uses them. Change them in the car editor with Default (the car as made) chosen, and save the car.";
            shellBody.appendChild(note);
        }
        shellCard.addEventListener("toggle", function() { if(shellCard.open) fillShell(); });
        panel.appendChild(shellCard);
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
        referenceValues = null;
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
            if(name === active) { var cfg = OpenRacer.Setups.configOf(config.id, name, config), saved = cfg ? fromConfig(Object.assign({}, original, cfg)) : null; if(saved) same = !differs(Object.assign({}, base, saved)); }       // (gen_power and gen_peak_rpm follow from the torque curve: they are not part of what is saved)
            var ship = OpenRacer.Setups.shippedState(config.id, name);
            o.textContent = name + (ship ? " · with the car" : "") + (name === active && !same ? " (changed)" : "");
            setupSelect.appendChild(o);
        });
        setupSelect.value = active && names.indexOf(active) >= 0 ? active : "";
        if(setupButtons) {
            // (a tune that comes with the car and has no copy in this browser cannot be deleted; of one with a copy, Delete takes the copy away)
            var none = !setupSelect.value, ship = none ? null : OpenRacer.Setups.shippedState(config.id, setupSelect.value);
            setupButtons.drop.disabled = none || ship === "car";
            setupButtons.save.title = none ? "car.json is overwritten with the car as it is now (Default becomes the car as tuned)" : "The setup that is chosen is overwritten with the car as it is now";
            setupButtons.drop.style.opacity = setupButtons.drop.disabled ? 0.45 : 1;
            setupButtons.drop.textContent = ship === "copy" ? "Undo changes" : "Delete";
            setupButtons.drop.title = ship === "car" ? "This setup comes with the car" : ship === "copy" ? "The setup as it comes with the car, without the changes saved here" : "";
        }
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
        if(gearsSummary) gearsSummary();
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
                // the rubber of a custom tyre says what kind of tyre it is, from its grip: eco, road, sport, semi-slick, race slick, drag slick
                if(c.key === "rubber_front" || c.key === "rubber_rear") { var rl = c.line.querySelector(".label"); if(rl) rl.textContent = "Tyre at the " + c.key.slice(7) + ": rubber · " + OpenRacer.rubberLabel(v); }
                // the tread: what pattern the tyre has (road, slick, all-terrain, knobbly)
                if(c.key === "tread_front" || c.key === "tread_rear") { var tl = c.line.querySelector(".label"); if(tl) tl.textContent = "Tyre at the " + c.key.slice(6) + ": tread · " + OpenRacer.treadLabel(v, values["rubber_" + c.key.slice(6)]); }
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
            } else if(c.bool) {
                c.bool.checked = !!values[c.key];
                c.line.classList.toggle("changed", changed(c.key));
            }
        });
        // a group whose settings are all hidden goes too, and so does a card with nothing left in it (a car had the card Motorcycle, empty)
        if(panel) {
            panel.querySelectorAll("details.card > details").forEach(function(group) {
                var items = group.querySelectorAll(".item");
                if(items.length) group.style.display = Array.prototype.some.call(items, function(it) { return it.style.display !== "none"; }) ? "" : "none";
            });
            panel.querySelectorAll("details.card").forEach(function(card) {
                if(card === engineCard) return;
                var shown = Array.prototype.some.call(card.children, function(el) { return el.tagName !== "SUMMARY" && el.style.display !== "none"; });
                card.style.display = shown ? "" : "none";
            });
        }
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
        // in a race against others the game stands still while the menu is open (the AI drove on while it was read), also when it was opened before the start;
        // in free drive the car is tuned as it drives
        var racing = typeof race !== "undefined" && race && race.opponents && race.opponents.length && race.state !== "finished";
        if(Settings.holdPause) Settings.holdPause(show && !!racing, "tuning");
        if(show) {
            if(OpenRacer.Movable && OpenRacer.Movable.keep) OpenRacer.Movable.keep(panel);       // (moved and sized on a larger screen: into this window)
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
        source = OpenRacer.Garage && OpenRacer.Garage.sourceOf ? OpenRacer.Garage.sourceOf(baseConfig || newConfig) : null;
        base = fromConfig(config);
        values = clone(base); engineMassNow = 0;
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
        isVisible: function() { return visible; },
        // the car as it is tuned now, and whether that differs from the setup that is chosen (the skidpad keeps its measurement for the car that was measured)
        tunedConfig: function() { return config ? tunedConfig() : null; },
        changed: function() { return !!config && !!panel && unsavedChanges(); }
    };
})();
