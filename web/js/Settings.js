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
 * Settings.js
 *
 * Description: The inputs of the game as actions ("throttle", "shift up", ...) that can be
 *              bound to any number of inputs: keys, buttons and axes of a controller, and
 *              buttons of a racing wheel. The pedals and the steering axis of a wheel come
 *              from its calibration (see WheelControls.js), which can be redone per input here.
 *              The Escape key opens a menu to change the bindings and a few options; it pauses the game.
 *              Everything is stored in localStorage.
 *
 * An input ("binding") is one of
 *     { d: "key", code: "KeyW" }
 *     { d: "pad", t: "b", i: 7 }              button 7 of the controller
 *     { d: "pad", t: "a", i: 0, s: -1 }       axis 0 of the controller, to the negative side
 *     { d: "wheel", t: "b", i: 4 }            button 4 of the racing wheel (the pedals and the steering: see WheelControls.js)
 *     { d: "wheel", t: "a", i: 0, s: 1 }      an axis of the wheel pushed to a side, for example a paddle
 *     { d: "wheel", t: "v", i: 9, v: -0.43 }  a position of a hat switch (D-pad) that is one axis with a value per direction
 */

var Settings = (function() {
    var STORAGE_KEY = "openracer.settings";
    var AXIS_DEAD_ZONE = 0.1;
    var DIGITAL_LEVEL = 0.5;       // a button or axis counts as pressed beyond this value
    var HAT_TOLERANCE = 0.12;      // how close an axis has to be to the value of a hat position
    var CAPTURE_AXIS_DELTA = 0.6;  // how far an axis has to move to be taken as the new input

    function key(code) { return { d: "key", code: code }; }
    function padButton(i) { return { d: "pad", t: "b", i: i }; }
    function padAxis(i, s) { return { d: "pad", t: "a", i: i, s: s }; }

    // wheel: the part of the wheel calibration that belongs to the action: { profile: key in the profile, steps: calibration steps }
    var ACTIONS = [
        { id: "throttle", group: "Driving", label: "Throttle", wheel: { profile: "throttle", steps: ["throttle"] },
          defaults: [key("KeyW"), key("ArrowUp"), padButton(7)] },
        { id: "brake", group: "Driving", label: "Brake", wheel: { profile: "brake", steps: ["brake"] },
          defaults: [key("KeyS"), key("ArrowDown"), padButton(6)] },
        { id: "steerLeft", group: "Driving", label: "Steer left", defaults: [key("KeyA"), key("ArrowLeft"), padAxis(0, -1)] },
        { id: "steerRight", group: "Driving", label: "Steer right", defaults: [key("KeyD"), key("ArrowRight"), padAxis(0, 1)] },
        { id: "steerWheel", wheelOnly: true, group: "Driving", label: "Steering wheel", wheel: { profile: "steer", steps: ["steerLeft", "steerRight"] }, defaults: [] },
        { id: "clutch", wheelOnly: true, group: "Driving", label: "Clutch", wheel: { profile: "clutch", steps: ["clutch"] }, defaults: [] },
        { id: "handbrake", group: "Driving", label: "Handbrake", defaults: [key("Space"), padButton(0)] },
        { id: "reverse", group: "Driving", label: "Reverse (hold)", defaults: [key("Period")] },
        { id: "gearboxMode", group: "Gearbox", label: "Gearbox mode", defaults: [key("KeyG")] },
        { id: "shiftUp", group: "Gearbox", label: "Shift up", wheel: { profile: "shiftUp", steps: ["shiftUp"] }, defaults: [key("KeyX"), padButton(5)] },
        { id: "shiftDown", group: "Gearbox", label: "Shift down", wheel: { profile: "shiftDown", steps: ["shiftDown"] }, defaults: [key("KeyZ"), padButton(4)] },
        { id: "gear0", wheelOnly: true, group: "Gearbox", label: "H-shifter: gear 1", wheel: { profile: "gear0", steps: ["gear0"] }, defaults: [] },
        { id: "gear1", wheelOnly: true, group: "Gearbox", label: "H-shifter: gear 2", wheel: { profile: "gear1", steps: ["gear1"] }, defaults: [] },
        { id: "gear2", wheelOnly: true, group: "Gearbox", label: "H-shifter: gear 3", wheel: { profile: "gear2", steps: ["gear2"] }, defaults: [] },
        { id: "gear3", wheelOnly: true, group: "Gearbox", label: "H-shifter: gear 4", wheel: { profile: "gear3", steps: ["gear3"] }, defaults: [] },
        { id: "gear4", wheelOnly: true, group: "Gearbox", label: "H-shifter: gear 5", wheel: { profile: "gear4", steps: ["gear4"] }, defaults: [] },
        { id: "gear5", wheelOnly: true, group: "Gearbox", label: "H-shifter: gear 6", wheel: { profile: "gear5", steps: ["gear5"] }, defaults: [] },
        { id: "gear6", wheelOnly: true, group: "Gearbox", label: "H-shifter: gear 7", wheel: { profile: "gear6", steps: ["gear6"] }, defaults: [] },
        { id: "gear7", wheelOnly: true, group: "Gearbox", label: "H-shifter: gear 8", wheel: { profile: "gear7", steps: ["gear7"] }, defaults: [] },
        { id: "reverseGear", wheelOnly: true, group: "Gearbox", label: "H-shifter: reverse", wheel: { profile: "reverseGear", steps: ["reverse"] }, defaults: [] },
        { id: "resetCar", group: "Other", label: "Back to the start", defaults: [key("KeyR"), padButton(3)] },
        { id: "cameraLeft", group: "Other", label: "Camera left", defaults: [key("BracketLeft")] },
        { id: "cameraRight", group: "Other", label: "Camera right", defaults: [key("BracketRight")] },
        { id: "cameraReset", group: "Other", label: "Camera behind the car", defaults: [key("Backquote")] },
        { id: "hudToggle", group: "Other", label: "HUD on/off", defaults: [key("KeyH")] },
        { id: "debugToggle", group: "Other", label: "Debug text on/off", defaults: [key("F3")] },
        { id: "cameraSwitch", group: "Other", label: "Switch camera (fixed, follow, cockpit)", defaults: [key("KeyT")] },
        { id: "toggleESC", group: "Other", label: "ESC (stability control) on/off", defaults: [key("KeyN")] },
        { id: "tuningMenu", group: "Other", label: "Tuning menu on/off", defaults: [key("KeyU")] },
        { id: "toggleTC", group: "Other", label: "Traction control on/off", defaults: [key("KeyC")] },
        { id: "toggleABS", group: "Other", label: "ABS on/off", defaults: [key("KeyB")] },
        { id: "startEngine", group: "Other", label: "Start the engine", defaults: [key("KeyI")] },
        { id: "telemetry", group: "Other", label: "Telemetry", defaults: [key("KeyV")] },
        { id: "mute", group: "Other", label: "Engine sound on/off", defaults: [key("KeyE")] },
        { id: "calibrate", group: "Other", label: "Calibrate the wheel", defaults: [key("KeyK")] },
        { id: "wheelToggle", group: "Other", label: "Wheel on/off", defaults: [key("KeyM")] }
    ];

    var actionsById = {};
    ACTIONS.forEach(function(a) { actionsById[a.id] = a; });

    var DEFAULT_OPTIONS = { tc: true, abs: true, gearbox: "automatic", sound: true, wheelRange: 1, wheelDeadzone: 1, ffb: true, ffbStrength: 0.6, ffbSpring: 0.15, ffbDamping: 0.35, ffbRoad: 0.5, ffbInvert: false, toneMapping: "none", hud: true, units: "metric", debug: false, esc: true, camera: 1, volume: 0.8,
        padSlow: 1.5, padAssist: true, keySteer: 1 };

    var bindings = {};      // action id -> list of inputs
    var options = {};
    var keysDown = {};      // key code -> true
    var virtualDown = {};   // action id -> held by an on-screen button (TouchControls.js)
    var down = {};          // action id -> pressed now
    var wasDown = {};
    var handlers = {};      // action id -> function that runs when the action is pressed
    var optionListeners = [];
    var activeTab = "Car";    // the tab of the settings menu that is open
    try { activeTab = localStorage.getItem("openracer.settingsTab") || activeTab; } catch(e) { /* no storage */ }
    var paused = false;
    var menu = null;
    var capture = null;     // { done: function(input), baseline: [...] } while the menu waits for an input
    var captureTimer = null;

    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    function loadDefaults() {
        bindings = {};
        ACTIONS.forEach(function(a) { bindings[a.id] = clone(a.defaults); });
        options = clone(DEFAULT_OPTIONS);
    }

    function load() {
        loadDefaults();
        try {
            var stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
            if(stored && stored.bindings) {
                ACTIONS.forEach(function(a) {
                    if(Array.isArray(stored.bindings[a.id])) bindings[a.id] = stored.bindings[a.id];
                });
            }
            if(stored && stored.options) {
                // an earlier version had auto and manual, where manual is what is sequential now
                if(stored.options.transmission && !stored.options.gearbox) stored.options.gearbox = stored.options.transmission === "manual" ? "sequential" : "automatic";
                for(var name in DEFAULT_OPTIONS) {
                    if(stored.options[name] !== undefined) options[name] = stored.options[name];
                }
            }
        } catch(e) {
            loadDefaults();
        }
    }

    function save() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ bindings: bindings, options: options }));
        } catch(e) {
            console.log("Could not store the settings: " + e);
        }
    }

    // ---- devices

    function getPads() {
        return navigator.getGamepads ? navigator.getGamepads() : [];
    }

    // The racing wheel, if one is connected (see WheelControls.js)
    function wheelPad() {
        return WheelControls.findWheel();
    }

    // The connected controller that is not the wheel
    function controllerPad() {
        var wheel = wheelPad();
        var pads = getPads();
        for(var i = 0; i < pads.length; i++) {
            if(pads[i] && pads[i].connected && pads[i] !== wheel && (!wheel || pads[i].index !== wheel.index)) return pads[i];
        }
        return null;
    }

    // Value 0..1 of a pad input
    function padValue(pad, input) {
        if(!pad) return 0;
        if(input.t === "b") {
            var b = pad.buttons[input.i];
            return b ? b.value : 0;
        }
        if(input.t === "v") {
            // a position of a hat switch that reports its directions as values of one axis
            return Math.abs((pad.axes[input.i] || 0) - input.v) < HAT_TOLERANCE ? 1 : 0;
        }
        var v = (pad.axes[input.i] || 0) * input.s;
        if(v < AXIS_DEAD_ZONE) return 0;
        return Math.min(1, (v - AXIS_DEAD_ZONE) / (1 - AXIS_DEAD_ZONE));
    }

    // Value of an input of an action that is not a key: 0..1
    function inputValue(input, pads) {
        if(input.d === "key") return keysDown[input.code] ? 1 : 0;
        return padValue(input.d === "wheel" ? pads.wheel : pads.controller, input);
    }

    function currentPads() {
        return { wheel: wheelPad(), controller: controllerPad() };
    }

    // ---- actions

    function runHandler(id) {
        if(handlers[id]) handlers[id]();
    }

    // Looks at the inputs once per frame: which actions are held, and which have just been pressed
    function update() {
        var pads = currentPads();
        for(var n = 0; n < ACTIONS.length; n++) {
            var id = ACTIONS[n].id;
            var list = bindings[id];
            var isDown = false;
            for(var i = 0; i < list.length; i++) {
                if(inputValue(list[i], pads) >= DIGITAL_LEVEL) { isDown = true; break; }
            }
            if(virtualDown[id]) isDown = true;
            down[id] = isDown;
            if(isDown && !wasDown[id] && !paused) runHandler(id);
            wasDown[id] = isDown;
        }
    }

    // The analog value (0..1) of the controller inputs of an action: trigger, stick direction
    function controllerAnalog(id) {
        var pad = controllerPad();
        var best = 0;
        var list = bindings[id] || [];
        for(var i = 0; i < list.length; i++) {
            if(list[i].d === "pad") best = Math.max(best, padValue(pad, list[i]));
        }
        return best;
    }

    function isDown(id) {
        return !!down[id] && !paused;
    }

    // ---- keyboard

    function keyLabel(code) {
        if(/^Key[A-Z]$/.test(code)) return code.substring(3);
        if(/^Digit[0-9]$/.test(code)) return code.substring(5);
        var names = { Space: "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Period: ".", Comma: ",",
            BracketLeft: "[", BracketRight: "]", Backquote: "`", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'",
            Minus: "-", Equal: "=", ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Ctrl",
            ControlRight: "Right Ctrl", AltLeft: "Left Alt", AltRight: "Right Alt", Enter: "Enter", Tab: "Tab", Backspace: "Backspace" };
        return names[code] || code;
    }

    window.addEventListener("keydown", function(event) {
        if(capture) {
            event.preventDefault();
            event.stopPropagation();
            if(event.code === "Escape") stopCapture();
            else finishCapture({ d: "key", code: event.code });
            return;
        }
        if(event.code === "Escape") {
            // Escape cancels a wheel calibration first; while the racing line is recorded for the track editor it ends that (main.js)
            if(WheelControls.isCalibrating()) return;
            if(typeof race !== "undefined" && race.recording && !menu) { race.recording.stop(); return; }
            toggleMenu();
            return;
        }
        // a key that is typed in a field of the tuning menu is not a key of the game
        var target = event.target;
        if(target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
        if(!paused) {
            if(event.code === "Space" || event.code.indexOf("Arrow") === 0) event.preventDefault();
            keysDown[event.code] = true;
        }
    }, true);

    window.addEventListener("keyup", function(event) {
        keysDown[event.code] = false;
    }, false);

    window.addEventListener("blur", function() {
        keysDown = {};
    }, false);

    // ---- options

    var GEARBOX_MODES = ["automatic", "sequential", "manual"];
    function cycleGearbox() {
        setOption("gearbox", GEARBOX_MODES[(GEARBOX_MODES.indexOf(options.gearbox) + 1) % GEARBOX_MODES.length]);
    }

    function setOption(name, value) {
        options[name] = value;
        save();
        optionListeners.forEach(function(fn) { fn(name, value); });
        if(menu) renderMenu();
    }

    // ---- capturing a new input for the menu

    function startCapture(done) {
        stopCapture();
        var pads = getPads();
        var baseline = [];
        for(var p = 0; p < pads.length; p++) {
            baseline[p] = pads[p] ? { axes: Array.prototype.slice.call(pads[p].axes) } : null;
        }
        capture = { done: done, baseline: baseline };
        captureTimer = setInterval(pollCapture, 40);
        renderMenu();
    }

    function stopCapture() {
        capture = null;
        clearInterval(captureTimer);
        captureTimer = null;
        if(menu) renderMenu();
    }

    function finishCapture(input) {
        var done = capture.done;
        stopCapture();
        done(input);
    }

    function pollCapture() {
        if(!capture) return;
        var pads = getPads();
        var wheel = wheelPad();
        for(var p = 0; p < pads.length; p++) {
            var pad = pads[p];
            if(!pad || !pad.connected) continue;
            var device = wheel && pad.index === wheel.index ? "wheel" : "pad";
            for(var b = 0; b < pad.buttons.length; b++) {
                if(pad.buttons[b].pressed) {
                    finishCapture({ d: device, t: "b", i: b });
                    return;
                }
            }
            var base = capture.baseline[p];
            if(!base) continue;
            for(var a = 0; a < pad.axes.length; a++) {
                var rest = base.axes[a] || 0;
                var delta = pad.axes[a] - rest;
                if(Math.abs(delta) > CAPTURE_AXIS_DELTA) {
                    // A hat switch (the D-pad of many wheels) is one axis with a value per direction, and a rest value
                    // outside of -1..1. Then the value that the axis has now is the input; otherwise it is the direction.
                    if(Math.abs(rest) > 1.05) finishCapture({ d: device, t: "v", i: a, v: Math.round(pad.axes[a] * 100) / 100 });
                    else finishCapture({ d: device, t: "a", i: a, s: delta > 0 ? 1 : -1 });
                    return;
                }
            }
        }
    }

    // ---- the menu

    function inputLabel(input) {
        if(input.d === "key") return keyLabel(input.code);
        if(input.t === "b") return "Button " + input.i;
        if(input.t === "v") return "Hat " + input.i + " (" + input.v + ")";
        return "Axis " + input.i + (input.s < 0 ? " −" : " +");
    }

    function deviceIcon(d) {
        return d === "key" ? "Key" : (d === "wheel" ? "Wheel" : "Pad");
    }

    function addStyle() {
        var style = document.createElement("style");
        style.textContent =
            "#settingsMenu { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 2000; background: rgba(0, 0, 0, 0.72); " +
            "color: #fff; font-family: Arial, sans-serif; font-size: 15px; overflow-y: auto; }" +
            "#settingsMenu .panel { max-width: 820px; margin: 30px auto; padding: 22px 28px; background: #1c1f24; border-radius: 8px; }" +
            "#settingsMenu h1 { margin: 0 0 4px 0; font-size: 26px; }" +
            "#settingsMenu h2 { margin: 24px 0 8px 0; font-size: 17px; color: #9ab; text-transform: uppercase; letter-spacing: 1px; }" +
            "#settingsMenu .sub { color: #889; margin-bottom: 14px; }" +
            "#settingsMenu .row { display: flex; align-items: center; padding: 5px 0; border-bottom: 1px solid #2c3036; min-height: 34px; }" +
            "#settingsMenu .label { width: 210px; flex: none; }" +
            "#settingsMenu .inputs { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }" +
            "#settingsMenu .chip { display: inline-flex; align-items: center; background: #2d333b; border-radius: 4px; padding: 2px 4px 2px 8px; gap: 4px; }" +
            "#settingsMenu .chip.wheel { background: #3a3326; }" +
            "#settingsMenu .chip.waiting { background: #7a5a00; }" +
            "#settingsMenu .dev { opacity: 0.55; font-size: 11px; text-transform: uppercase; }" +
            "#settingsMenu button { background: #3b424c; color: #fff; border: 0; border-radius: 3px; cursor: pointer; font-size: 14px; padding: 3px 7px; }" +
            "#settingsMenu button:hover { background: #566070; }" +
            "#settingsMenu .chip button { background: transparent; padding: 2px 5px; }" +
            "#settingsMenu .chip button:hover { background: #566070; }" +
            "#settingsMenu .add { padding: 3px 10px; }" +
            "#settingsMenu .top { display: flex; justify-content: space-between; align-items: flex-start; }" +
            "#settingsMenu .version { text-align: right; color: #667; font-size: 12px; margin-top: 18px; }" +
            "#settingsMenu .tabs { display: flex; gap: 4px; margin: 18px 0 6px; border-bottom: 1px solid #2c3036; }" +
            "#settingsMenu .tab { background: transparent; color: #9ab; padding: 8px 14px; border-radius: 6px 6px 0 0; font-size: 15px; }" +
            "#settingsMenu .tab:hover { background: #262b33; color: #fff; }" +
            "#settingsMenu .tab.active { background: #2d333b; color: #fff; }" +
            "#settingsMenu .page h2:first-child { margin-top: 10px; }" +
            "#settingsMenu .big { font-size: 16px; padding: 8px 18px; background: #2e7d46; }" +
            "#settingsMenu .big:hover { background: #3a9a58; }" +
            "#settingsMenu .none { color: #667; font-style: italic; }" +
            "#settingsMenu .hint { color: #e0b040; margin: 8px 0 0 0; min-height: 18px; }" +
            "#settingsMenu .toggle { min-width: 110px; }";
        document.head.appendChild(style);
    }

    function chipElement(text, device, wheelChip, onEdit, onRemove) {
        var chip = document.createElement("span");
        chip.className = "chip" + (wheelChip ? " wheel" : "");
        var icon = document.createElement("span");
        icon.className = "dev";
        icon.textContent = deviceIcon(device);
        chip.appendChild(icon);
        chip.appendChild(document.createTextNode(" " + text));
        var edit = document.createElement("button");
        edit.title = "Set a new input";
        edit.textContent = "✎";
        edit.onclick = onEdit;
        chip.appendChild(edit);
        var remove = document.createElement("button");
        remove.title = "Remove";
        remove.textContent = "✕";
        remove.onclick = onRemove;
        chip.appendChild(remove);
        return chip;
    }

    function waitingChip() {
        var chip = document.createElement("span");
        chip.className = "chip waiting";
        chip.textContent = "Press a key or a button, or move an axis… (Esc cancels)";
        return chip;
    }

    // Asks the wheel calibration to measure the inputs of an action again
    function calibrateWheel(action) {
        if(!WheelControls.findWheel()) {
            hint("No wheel found. Connect it and press a button on it first.");
            return;
        }
        closeMenu();
        WheelControls.recalibrate(action.wheel.steps);
    }

    var hintText = "";
    function hint(text) {
        hintText = text;
        if(menu) {
            var element = menu.querySelector(".hint");
            if(element) element.textContent = text;
        }
    }

    // A new input for an action: a key or a button/axis of a controller is added to the list (replacing the
    // one that was edited); a wheel input of an action with a calibration is measured by the calibration.
    function same(a, b) {
        return a.d === b.d && a.t === b.t && a.i === b.i && a.s === b.s && a.v === b.v && a.code === b.code;
    }

    function addInput(action, input, replaceIndex) {
        if(input.d === "wheel" && action.wheel) {
            calibrateWheel(action);
            return;
        }
        // an input belongs to one action: take it from the others
        ACTIONS.forEach(function(other) {
            if(other.id !== action.id) bindings[other.id] = bindings[other.id].filter(function(existing) { return !same(existing, input); });
        });
        var target = replaceIndex !== null && replaceIndex !== undefined ? bindings[action.id][replaceIndex] : null;
        var list = bindings[action.id].filter(function(existing) { return existing === target || !same(existing, input); });
        if(target) list[list.indexOf(target)] = input;
        else list.push(input);
        bindings[action.id] = list;
        save();
        hint("");
    }

    // the gears of the shifter that the car does not have are not shown
    function visible(action) {
        var m = /^gear([0-9]+)$/.exec(action.id);
        return !m || !window.car || parseInt(m[1], 10) < window.car.gear_ratios.length;
    }

    function renderRow(action) {
        var row = document.createElement("div");
        row.className = "row";
        var label = document.createElement("div");
        label.className = "label";
        label.textContent = action.label;
        row.appendChild(label);
        var inputs = document.createElement("div");
        inputs.className = "inputs";

        var list = bindings[action.id];
        var shown = 0;
        list.forEach(function(input, index) {
            shown++;
            if(capture && capture.action === action.id && capture.index === index) {
                inputs.appendChild(waitingChip());
                return;
            }
            inputs.appendChild(chipElement(inputLabel(input), input.d, input.d === "wheel",
                function() { listen(action, index); },
                function() { list.splice(index, 1); save(); renderMenu(); }));
        });

        if(action.wheel) {
            var description = WheelControls.describe(action.wheel.profile);
            if(description) {
                shown++;
                inputs.appendChild(chipElement(description, "wheel", true,
                    function() { calibrateWheel(action); },
                    function() { WheelControls.clear(action.wheel.profile); renderMenu(); }));
            }
        }

        if(capture && capture.action === action.id && capture.index === null) {
            inputs.appendChild(waitingChip());
        } else {
            var add = document.createElement("button");
            add.className = "add";
            add.title = action.wheel && !shown ? "Set up the wheel or add a key or button" : "Add an input";
            add.textContent = "+";
            add.onclick = function() { listen(action, null); };
            inputs.appendChild(add);
        }
        if(!shown && !(capture && capture.action === action.id)) {
            var none = document.createElement("span");
            none.className = "none";
            none.textContent = "not set";
            inputs.insertBefore(none, inputs.firstChild);
        }
        row.appendChild(inputs);
        return row;
    }

    // Waits for the next input of the player for an action: index of the input that is replaced, or null for a new one
    function listen(action, index) {
        if(action.wheelOnly) {
            calibrateWheel(action);
            return;
        }
        startCapture(function(input) { addInput(action, input, index); renderMenu(); });
        capture.action = action.id;
        capture.index = index;
        renderMenu();
        hint("");
    }

    function optionRow(label, text, onClick) {
        var row = document.createElement("div");
        row.className = "row";
        var l = document.createElement("div");
        l.className = "label";
        l.textContent = label;
        row.appendChild(l);
        var inputs = document.createElement("div");
        inputs.className = "inputs";
        var button = document.createElement("button");
        button.className = "toggle";
        button.textContent = text;
        button.onclick = onClick;
        inputs.appendChild(button);
        row.appendChild(inputs);
        return row;
    }

    // a row with a slider: the value is shown next to it, formatted by text(value)
    function sliderRow(label, name, min, max, step, text) {
        var row = document.createElement("div");
        row.className = "row";
        var l = document.createElement("div");
        l.className = "label";
        l.textContent = label;
        row.appendChild(l);
        var inputs = document.createElement("div");
        inputs.className = "inputs";
        var input = document.createElement("input");
        input.type = "range";
        input.min = min; input.max = max; input.step = step;
        input.value = options[name];
        input.style.cssText = "width: 160px; vertical-align: middle;";
        var value = document.createElement("span");
        value.style.cssText = "display: inline-block; min-width: 150px; margin-left: 10px; color: #cfd8e3;";
        value.textContent = text(options[name]);
        input.oninput = function() { setOption(name, parseFloat(input.value)); value.textContent = text(options[name]); };
        inputs.appendChild(input);
        inputs.appendChild(value);
        row.appendChild(inputs);
        return row;
    }

    // a row with a check box
    function checkRow(label, name, note) {
        var row = document.createElement("div");
        row.className = "row";
        var l = document.createElement("div");
        l.className = "label";
        l.textContent = label;
        row.appendChild(l);
        var inputs = document.createElement("div");
        inputs.className = "inputs";
        var box = document.createElement("input");
        box.type = "checkbox";
        box.checked = !!options[name];
        box.style.cssText = "width: 18px; height: 18px; vertical-align: middle; cursor: pointer;";
        box.onchange = function() { setOption(name, box.checked); };
        inputs.appendChild(box);
        if(note) {
            var span = document.createElement("span");
            span.style.cssText = "margin-left: 10px; color: #9fb0c4; font-size: 13px;";
            span.textContent = note;
            inputs.appendChild(span);
        }
        row.appendChild(inputs);
        return row;
    }

    function renderMenu() {
        if(!menu) return;
        menu.innerHTML = "";
        var panel = document.createElement("div");
        panel.className = "panel";
        menu.appendChild(panel);

        var top = document.createElement("div");
        top.className = "top";
        var title = document.createElement("div");
        title.innerHTML = "<h1>Settings</h1><div class=\"sub\">The game is paused. Esc closes this menu.</div>";
        top.appendChild(title);
        var buttons = document.createElement("div");
        var resume = document.createElement("button");
        resume.className = "big";
        resume.textContent = "Resume";
        resume.onclick = closeMenu;
        buttons.appendChild(resume);
        var mainMenu = document.createElement("button");
        mainMenu.className = "big";
        mainMenu.style.cssText = "background: #3b424c; margin-left: 8px;";
        mainMenu.textContent = "Main menu";
        mainMenu.onclick = function() { window.location.href = window.location.pathname; };
        buttons.appendChild(mainMenu);
        top.appendChild(buttons);
        panel.appendChild(top);
        // the tabs: every tabPage(name) call gives the page of that tab (made on the first call)
        var tabBar = document.createElement("div");
        tabBar.className = "tabs";
        var pages = {};
        var pagesBox = document.createElement("div");
        panel.appendChild(tabBar);
        panel.appendChild(pagesBox);
        function tabPage(name) {
            if(!pages[name]) {
                var button = document.createElement("button");
                button.className = "tab";
                button.textContent = name;
                button.onclick = function() { activeTab = name; try { localStorage.setItem("openracer.settingsTab", name); } catch(e) { /* no storage */ } showTab(); };
                tabBar.appendChild(button);
                var el = document.createElement("div");
                el.className = "page";
                pagesBox.appendChild(el);
                pages[name] = { button: button, page: el };
            }
            return pages[name].page;
        }
        function showTab() {
            if(!pages[activeTab]) activeTab = Object.keys(pages)[0];
            Object.keys(pages).forEach(function(name) {
                pages[name].page.style.display = name === activeTab ? "" : "none";
                pages[name].button.classList.toggle("active", name === activeTab);
            });
        }

        var page = tabPage("Car");
        page.appendChild(optionRow("Traction control", options.tc ? "On" : "Off", function() { setOption("tc", !options.tc); }));
        page.appendChild(optionRow("ESC (stability control)", options.esc ? "On" : "Off", function() { setOption("esc", !options.esc); }));
        var cameraNames = ["1 Fixed behind the car", "2 Follow (smooth, FOV with speed)", "3 Cockpit"];
        page.appendChild(optionRow("Camera", cameraNames[options.camera - 1] || "1", function() { setOption("camera", options.camera % 3 + 1); }));
        page.appendChild(optionRow("ABS", options.abs ? "On" : "Off", function() { setOption("abs", !options.abs); }));
        var gearboxNames = { automatic: "Automatic (P R N D)", sequential: "Sequential (paddles)", manual: "Manual (H-shifter, clutch)" };
        page.appendChild(optionRow("Gearbox", gearboxNames[options.gearbox] || options.gearbox, function() { cycleGearbox(); }));
        page = tabPage("Keyboard");
        var keyNote = document.createElement("div");
        keyNote.className = "sub";
        keyNote.textContent = "The steering keys turn the wheels at a rate: fast at a standstill, slower the faster the car goes; the wheels come back to the middle by themselves when the keys are let go.";
        page.appendChild(keyNote);
        page.appendChild(sliderRow("Steering speed", "keySteer", 0.5, 3, 0.1, function(v) { return Math.round(v * 100) + "%" + (Math.abs(v - 1) < 0.01 ? " (as it was)" : ""); }));
        page = tabPage("Gamepad");
        var padNote = document.createElement("div");
        padNote.className = "sub";
        padNote.textContent = "The stick is the steering one to one at a standstill. The faster the car goes, the slower the steering follows the stick, as with the keyboard: a flick at speed is a small movement of the wheels.";
        page.appendChild(padNote);
        page.appendChild(sliderRow("Slower at speed", "padSlow", 0, 4, 0.25, function(v) {
            var at100 = 1 + v * (100 / 3.6) / 10;
            return v === 0 ? "off: one to one at every speed" : at100.toFixed(1) + "× slower at 100 km/h";
        }));
        page.appendChild(checkRow("Steering assist", "padAssist", "when the rear steps out the front tyres steer into the slide by themselves, so it does not become a spin"));
        page = tabPage("Wheel");
        page.appendChild(optionRow("Wheel steering range", Math.round(options.wheelRange * 100) + "%",
            function() { setOption("wheelRange", options.wheelRange > 0.9 ? 0.75 : (options.wheelRange > 0.6 ? 0.5 : 1)); }));
        // the part of the range around the middle of the wheel in which the steering stays straight (in percent of the range, one way)
        var deadzones = [0, 0.5, 1, 2, 3, 5];
        page.appendChild(optionRow("Wheel dead zone", options.wheelDeadzone + "%" + (options.wheelDeadzone === 0 ? " (none)" : ""),
            function() { setOption("wheelDeadzone", deadzones[(deadzones.indexOf(options.wheelDeadzone) + 1) % deadzones.length]); }));
        // force feedback (see ForceFeedback.js)
        if(typeof ForceFeedback !== "undefined") {
            var ffbTitle = document.createElement("h2");
            ffbTitle.textContent = "Force feedback";
            page.appendChild(ffbTitle);
            var deviceText = ForceFeedback.isConnected() ? ForceFeedback.deviceName() : (ForceFeedback.canConnect() ? "Connect a wheel…" : "Needs Chrome or Edge (WebHID)");
            page.appendChild(optionRow("Wheel with force feedback", deviceText, function() {
                if(!ForceFeedback.canConnect()) { hint("Force feedback on the wheel itself needs WebHID, which Chrome and Edge have. Other browsers get rumble only."); return; }
                if(ForceFeedback.isConnected()) {
                    ForceFeedback.forget().then(function() { renderMenu(); });
                } else {
                    hint("Choose your wheel in the window of the browser. If it has several entries, take the one of the wheel itself.");
                    ForceFeedback.connect().then(function() { renderMenu(); hint(ForceFeedback.status()); });
                }
            }));
            var percent = function(v) { return Math.round(v * 100) + "%"; };
            var cycle = function(name, steps) { return function() { var v = options[name]; var next = steps.find(function(s) { return s > v + 0.001; }); setOption(name, next === undefined ? steps[0] : next); }; };
            page.appendChild(optionRow("Force feedback", options.ffb ? "On" : "Off", function() { setOption("ffb", !options.ffb); }));
            page.appendChild(optionRow("Strength", percent(options.ffbStrength), cycle("ffbStrength", [0.2, 0.4, 0.6, 0.8, 1, 1.25, 1.5])));
            page.appendChild(optionRow("Centring spring", percent(options.ffbSpring), cycle("ffbSpring", [0, 0.1, 0.15, 0.25, 0.4, 0.6, 1])));
            page.appendChild(optionRow("Damping", percent(options.ffbDamping), cycle("ffbDamping", [0, 0.1, 0.2, 0.35, 0.5, 0.75, 1])));
            page.appendChild(optionRow("Road detail (bumps, grass, slip, ABS)", percent(options.ffbRoad), cycle("ffbRoad", [0, 0.25, 0.5, 0.75, 1])));
            page.appendChild(optionRow("Direction", options.ffbInvert ? "Inverted" : "Normal", function() { setOption("ffbInvert", !options.ffbInvert); }));
            page.appendChild(optionRow("Test", "Shake the wheel for two seconds", function() { ForceFeedback.test(); hint(ForceFeedback.status()); }));
            page.appendChild(optionRow("Diagnostics", "Copy to the clipboard", function() {
                var text = ForceFeedback.diagnose();
                var done = function() { hint("The diagnostics are on the clipboard (also in the console of the browser). Paste them to whoever helps you."); };
                if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function() { hint(text); });
                else hint(text);
                console.log(text);
            }));
        }
        var calibrate = document.createElement("div");
        calibrate.style.cssText = "margin-top: 14px;";
        var wheelButton = document.createElement("button");
        wheelButton.textContent = "Calibrate the wheel from scratch";
        wheelButton.onclick = function() {
            if(!WheelControls.findWheel()) { hint("No wheel found. Connect it and press a button on it first."); return; }
            closeMenu();
            WheelControls.startCalibration(window.car);
        };
        calibrate.appendChild(wheelButton);
        page.appendChild(calibrate);
        page = tabPage("Display and sound");
        page.appendChild(optionRow("HUD", options.hud ? "On" : "Off", function() { setOption("hud", !options.hud); }));
        page.appendChild(optionRow("Units", options.units === "imperial" ? "Imperial (mph)" : "Metric (km/h)",
            function() { setOption("units", options.units === "imperial" ? "metric" : "imperial"); }));
        page = tabPage("Tools");
        page.appendChild(optionRow("Debug text", options.debug ? "On" : "Off", function() { setOption("debug", !options.debug); }));
        var tuningRow = optionRow("Tuning menu", "Open", function() { closeMenu(); Tuning.toggle(); });
        page.appendChild(tuningRow);
        // the racing line and the records of this track (see main.js, Records.js)
        if(typeof race !== "undefined" && window.car && typeof currentTrack !== "undefined") {
            page.appendChild(optionRow("Racing line of this track", "Save my best lap as the line", function() {
                var ghost = race.ghost && race.ghost.best;
                if(!ghost) { hint("No best lap yet: drive a lap first."); return; }
                OpenRacer.RacingLine.save(currentTrack, ghost.samples).then(function(count) {
                    hint("The line is saved with the track (" + count + " points): the AI drives it from the next start.");
                }).catch(function(error) { hint("Could not save: " + error.message); });
            }));
            page.appendChild(optionRow("Records of this track", "Forget them", function() {
                OpenRacer.Records.forget(currentTrack.id);
                if(race.ghost) race.ghost.best = null;
                hint("The records and the ghost of this track are forgotten.");
            }));
        }
        page.appendChild(optionRow("Surroundings for Blender", "Save as HDR", function() {
            if(typeof EnvironmentExport !== "undefined" && window.car) EnvironmentExport.download();
        }));
        var toneNames = { none: "Off", neutral: "Neutral", agx: "AgX", aces: "ACES" };
        var toneOrder = ["none", "neutral", "agx", "aces"];
        page = tabPage("Display and sound");
        page.appendChild(optionRow("Tone mapping", toneNames[options.toneMapping] || "Off",
            function() { setOption("toneMapping", toneOrder[(toneOrder.indexOf(options.toneMapping) + 1) % toneOrder.length]); }));
        page.appendChild(optionRow("Engine volume", Math.round(options.volume * 100) + "%", function() {
            var steps = [0.2, 0.4, 0.6, 0.8, 1, 1.3];
            var next = steps.find(function(v) { return v > options.volume + 0.01; });
            setOption("volume", next === undefined ? steps[0] : next);
        }));
        page.appendChild(optionRow("Engine sound", options.sound ? "On" : "Off", function() { setOption("sound", !options.sound); }));

        var groups = [];
        ACTIONS.forEach(function(a) { if(groups.indexOf(a.group) < 0) groups.push(a.group); });
        page = tabPage("Controls");
        var explain = document.createElement("div");
        explain.className = "sub";
        explain.textContent = "Every action can have several inputs: a key, a button or axis of a controller, a button of a racing wheel. " +
            "✎ sets a new input, ✕ removes it and + adds one. The pedals and the steering of a wheel are set up by moving them.";
        page.appendChild(explain);
        var wheelStatus = document.createElement("div");
        wheelStatus.className = "sub";
        wheelStatus.textContent = WheelControls.statusText();
        page.appendChild(wheelStatus);

        groups.forEach(function(group) {
            var gh = document.createElement("h2");
            gh.textContent = group;
            page.appendChild(gh);
            ACTIONS.forEach(function(a) { if(a.group === group && visible(a)) page.appendChild(renderRow(a)); });
        });

        var hintElement = document.createElement("div");
        hintElement.className = "hint";
        hintElement.textContent = hintText;
        panel.appendChild(hintElement);

        var bottom = document.createElement("div");
        bottom.style.cssText = "margin-top: 18px; display: flex; gap: 10px;";
        var reset = document.createElement("button");
        reset.textContent = "Reset the controls to the defaults";
        reset.onclick = function() {
            ACTIONS.forEach(function(a) { bindings[a.id] = clone(a.defaults); });
            save();
            renderMenu();
        };
        bottom.appendChild(reset);
        tabPage("Controls").appendChild(bottom);
        showTab();
        var version = document.createElement("div");
        version.className = "version";
        version.textContent = "OpenRacer " + OpenRacer.VERSION;
        panel.appendChild(version);
    }

    function openMenu() {
        if(menu) return;
        paused = true;
        keysDown = {};
        menu = document.createElement("div");
        menu.id = "settingsMenu";
        document.body.appendChild(menu);
        renderMenu();
    }

    function closeMenu() {
        if(!menu) return;
        stopCapture();
        document.body.removeChild(menu);
        menu = null;
        paused = false;
        hintText = "";
    }

    function toggleMenu() {
        if(menu) closeMenu();
        else openMenu();
    }

    // ---- actions without a car

    handlers.toggleTC = function() { setOption("tc", !options.tc); };
    handlers.toggleABS = function() { setOption("abs", !options.abs); };
    handlers.gearboxMode = function() { cycleGearbox(); };
    handlers.toggleESC = function() { setOption("esc", !options.esc); };
    handlers.cameraSwitch = function() { setOption("camera", options.camera % 3 + 1); };
    handlers.tuningMenu = function() { Tuning.toggle(); };
    handlers.hudToggle = function() { setOption("hud", !options.hud); };
    handlers.debugToggle = function() { setOption("debug", !options.debug); };
    handlers.mute = function() { setOption("sound", !options.sound); };
    handlers.calibrate = function() { WheelControls.startCalibration(window.car); };
    handlers.wheelToggle = function() { WheelControls.toggle(); };
    handlers.startEngine = function() { if(window.car) window.car.startEngine(); };
    handlers.resetCar = function() { if(window.car) window.car.reset = true; };
    handlers.cameraReset = function() { if(window.car) window.car.cameraAngle = 0; };
    handlers.telemetry = function() { if(window.telemetry) window.telemetry.setVisible(!window.telemetry.visible); };
    handlers.shiftUp = function() { if(window.car) window.car.shiftUp(); };
    handlers.shiftDown = function() { if(window.car) window.car.shiftDown(); };

    load();
    addStyle();

    return {
        update: update,
        isDown: isDown,
        controllerAnalog: controllerAnalog,
        controllerPad: controllerPad,
        option: function(name) { return options[name]; },
        setOption: setOption,
        onOptionChange: function(fn) { optionListeners.push(fn); },
        setVirtual: function(id, held) { virtualDown[id] = !!held; },
        isPaused: function() { return paused; },
        toggleMenu: toggleMenu,
        bindings: function(id) { return bindings[id]; }
    };
})();
