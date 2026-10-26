/*
 * Tuning.js
 *
 * Description: The tuning menu: sliders and fields to change the car while it drives (mass and weight distribution, grip of the
 *              tyres, engine, gears, brakes, aerodynamics, assists and the engine sound). The menu is shown or hidden with
 *              a key (U by default, it can be changed in the settings menu). The tuning of a car is kept in this browser;
 *              "Save to the car" writes it to the car (cars/<id>/car.json with start-server.sh, otherwise the garage of this
 *              browser, see Garage.js), "Reset" goes back to the car as it was made.
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
    var GROUPS = OpenRacer.CarTuning.GROUPS;

    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    var V100 = (100 / 3.6) * (100 / 3.6); // (m/s)^2 at 100 km/h: the downforce in the menu is the force at that speed

    // ---- the values of a car configuration, in the units of the menu

    function fromConfig(c) { return OpenRacer.CarTuning.fromConfig(c); }

    // ---- the car follows the values

    function apply() {
        var v = values;
        car.vehicle.retune(OpenRacer.CarTuning.toRetune(v, car.frontal_area, air_density));
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
            "background: rgba(24, 29, 35, 0.9); color: var(--head); font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 13px; border-radius: 8px; display: none; }" +
            "#tuning h1 { font-size: 18px; margin: 0 0 2px; }" +
            "#tuning .sub { color: var(--muted); font-size: 12px; margin-bottom: 8px; line-height: 1.4; }" +
            "#tuning .info { background: var(--bg2); border-radius: 5px; padding: 6px 8px; margin-bottom: 8px; color: var(--head); font-size: 12px; line-height: 1.4; }" +
            "#tuning details { border-top: 1px solid var(--line); padding: 4px 0; }" +
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
        gearbox: ["Gearbox", [["gears", "Gears (a clutch)"], ["torque-converter", "Automatic with a torque converter"], ["cvt", "CVT (continuously variable)"]]],
        diff: ["Differential", [["open", "Open"], ["lsd", "Limited slip"], ["welded", "Welded (locked)"]]],
        compound: ["Tyre compound", OpenRacer.TyreCompounds.map(function(k) { return [k.id, k.name]; })],
        center_diff: ["Centre differential", [["open", "Open"], ["lsd", "Limited slip"], ["locked", "Locked"]]],
        tyre_damage: ["Tyre damage", [["off", "Off"], ["on", "On (a hard hit can puncture a tyre: it loses its pressure)"]]],
        antilag_mode: ["When", [["lift", "After lifting off the throttle"], ["launch", "Only with the two-step, the transbrake or the launch control"]]]
    };

    function selectRow(key) {
        var item = document.createElement("div");
        item.className = "item";
        var line = document.createElement("div");
        line.className = "line";
        line.innerHTML = "<span class=\"label\">" + SELECTS[key][0] + "</span>";
        var select = document.createElement("select");
        select.innerHTML = SELECTS[key][1].map(function(o) { return "<option value=\"" + o[0] + "\">" + o[1] + "</option>"; }).join("");
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
            details.open = false;                          // all the groups are folded when the menu opens
            var summary = document.createElement("summary");
            summary.textContent = group.name;
            details.appendChild(summary);
            group.items.forEach(function(def) {
                if(SELECTS[def[0]]) details.appendChild(selectRow(def[0]));
                else if(def[0] === "gears") details.appendChild(gearsRow());
                else details.appendChild(slider(def));
            });
            panel.appendChild(details);
        });
        var extras = document.createElement("details");
        extras.open = false;
        extras.innerHTML = "<summary>Extras</summary>";
        OpenRacer.CarTuning.FEATURES.forEach(function(feature) { extras.appendChild(featureRow(feature)); });
        panel.appendChild(extras);
        document.body.appendChild(panel);
        OpenRacer.Movable.make(panel, { key: "tuning" });
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
                c.input.style.color = changed(c.key) ? "var(--accent2)" : "";
            } else if(c.select) {
                c.select.value = values[c.key];
                c.line.classList.toggle("changed", changed(c.key));
            } else if(c.checkbox) {
                c.checkbox.checked = !!values[c.key];
                c.inner.style.display = values[c.key] ? "block" : "none";
                c.line.classList.toggle("changed", changed(c.key));
            }
        });
        updateInfo();
    }

    // The configuration of the car with the tuning in it
    function tunedConfig() { return OpenRacer.CarTuning.toConfig(config, values); }

    function saveToCar() {
        OpenRacerDialog.ask({ title: "Write this tuning to the car?", text: "The car as it was made is overwritten (cars/" + config.id + "/car.json). Without the server of start-server.sh it goes to the garage of this browser instead.", ok: "Write it" }).then(function(yes) { if(yes) writeTuning(); });
    }

    function writeTuning() {
        var tuned = tunedConfig();
        // the server when it is there (serve.py), otherwise the garage of this browser (Garage.js)
        OpenRacer.Garage.store("cars", config.id, tuned, {}, {}).then(function(result) {
            // the car is the way it is tuned now
            tuned.id = config.id;
            config = tuned;
            base = fromConfig(config);
            values = clone(base);
            store();
            refresh();
            message(result.where === "server" ? "Saved to cars/" + config.id + "." : "Saved to your garage in this browser (the server does not save).");
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
