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
        { id: "parkingBrake", group: "Driving", label: "Parking brake on/off (it stays on until you press it again; P is for the free camera too: then that goes first)", defaults: [key("KeyP")] },
        { id: "reverse", group: "Driving", label: "Reverse (hold)", defaults: [key("Period")] },
        { id: "riderBack", group: "Driving", label: "Motorcycle: rider back, < (hold)", defaults: [key("Comma")] },
        { id: "riderForward", group: "Driving", label: "Motorcycle: rider forward, > (hold)", defaults: [key("Period")] },
        { id: "ragdoll", group: "Driving", label: "Motorcycle: the rider goes limp (a crash, to try it)", defaults: [key("Digit9")] },
        { id: "twoStep", group: "Driving", label: "Two-step: hold the engine at the two-step speed at a standstill (hold; works with the option off too)", defaults: [key("KeyQ")] },
        { id: "transbrake", group: "Driving", label: "Transbrake: hold the car with the engine free, let go to launch (hold)", defaults: [key("KeyF")] },
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
        { id: "resetCar", group: "Other", label: "Reset the car to the nearest point of the racing line, nose forward (a track without a racing line: the saved position, else the line from the last gate to the next, else the start), as it is: the damage and the tyres stay", defaults: [key("KeyR"), padButton(3)] },
        { id: "saveResetPosition", group: "Other", label: "Save the place of the car for the reset (only used on a track without a racing line)", defaults: [key("Digit4")] },
        { id: "repairCar", group: "Other", label: "Repair the car and put it on its wheels where it is, on the road under every wheel (body, parts, wheels, punctures), with new tyres and a full tank (in a race no new tyres or fuel: that is the pit stop)", defaults: [key("Backspace"), padButton(8)] },
        { id: "cameraLeft", group: "Other", label: "Camera left", defaults: [key("BracketLeft")] },
        { id: "cameraRight", group: "Other", label: "Camera right", defaults: [key("BracketRight")] },
        { id: "cameraReset", group: "Other", label: "Camera behind the car", defaults: [key("Backquote")] },
        { id: "hudToggle", group: "Other", label: "HUD on/off", defaults: [key("KeyH")] },
        { id: "debugToggle", group: "Other", label: "Debug text on/off", defaults: [key("F3")] },
        { id: "photo", group: "Other", label: "Photo: save the picture of the game as a PNG (no HUD; use the free camera to frame it)", defaults: [key("F2")] },
        { id: "freeCamAim", group: "Other", label: "Free camera: look at the car or not", defaults: [key("KeyP")] },
        { id: "freeCamFollow", group: "Other", label: "Free camera: move with the car or stay here", defaults: [key("KeyO")] },
        { id: "take", group: "Other", label: "Take: start a recording, and stop it (then: save it as a replay or a video)", defaults: [key("Digit5")] },
        { id: "cameraSwitch", group: "Other", label: "Switch camera (follow, cockpit, free)", defaults: [key("KeyT"), padButton(2)] },
        { id: "toggleESC", group: "Other", label: "ESC (stability control) on/off", defaults: [key("KeyN")] },
        { id: "tuningMenu", group: "Other", label: "Tuning menu on/off", defaults: [key("KeyU")] },
        { id: "toggleTC", group: "Other", label: "Traction control on/off", defaults: [key("KeyC")] },
        { id: "toggleTwoStep", group: "Other", label: "Two-step on/off", defaults: [key("KeyY")] },
        { id: "toggleLaunch", group: "Other", label: "Launch control on/off", defaults: [key("KeyJ")] },
        { id: "toggleABS", group: "Other", label: "ABS on/off", defaults: [key("KeyB")] },
        { id: "startEngine", group: "Other", label: "Start the engine", defaults: [key("KeyI")] },
        { id: "telemetry", group: "Other", label: "Telemetry", defaults: [key("KeyV")] },
        { id: "mute", group: "Other", label: "Engine sound on/off", defaults: [key("KeyE")] },
        { id: "calibrate", group: "Other", label: "Calibrate the wheel", defaults: [key("KeyK")] },
        { id: "wheelToggle", group: "Other", label: "Wheel on/off", defaults: [key("KeyM")] }
    ];

    var actionsById = {};
    ACTIONS.forEach(function(a) { actionsById[a.id] = a; });

    var DEFAULT_OPTIONS = { tc: true, launchControl: false, twoStep: false, autoReverse: true, autoReversePedals: true, autoReverseSpeed: 3, dragReady: 2, dragGreen: 1.5, abs: true, sound: true, wheelRange: 1, wheelMatch: false, wheelDegrees: 900, wheelDeadzone: 1, ffb: true, ffbStrength: 0.6, ffbSpring: 0.15, ffbDamping: 0.35, ffbRoad: 0.5, ffbInvert: false, hud: true, units: "metric", debug: false, esc: true, camera: 2, volume: 0.8, tyreVolume: 0.8,
        touchSteer: 1, padSlow: 1.5, padAssist: true, keySteer: 1, keySlow: 1, keyAssist: true,
        // a motorcycle: the steering ("counter": countersteering to start a lean and the lean; "lean": the lean only) and the follow camera ("lean": it rolls with the bike; "classic": as a car)
        bikeSteering: "lean", bikeCamera: "lean", wheelieControl: true, bikeFastLean: 30,
        // the easing of the keys: the time that a key takes to bring the pedal or the wheels to the full value (s), and the curve of it (1 straight, below 1 quick at first, above 1 slow at first)
        keyThrottleTime: 0.5, keyThrottleCurve: 0.6, keyBrakeTime: 0.4, keyBrakeCurve: 0.6, keySteerTime: 0.9, keySteerCurve: 1,
        // the graphics (Graphics.js): a preset is a set of these
        gfxPreset: "high", gfxScale: 1, gfxAA: 4, gfxShadows: 2, gfxReflections: 2, gfxAO: 0, gfxGI: 0, gfxVignette: true, gfxSmoke: 100, gfxDistance: 2000, gfxAniso: 8, gfxSharpen: 1,
        // the look and the atmosphere (Graphics.js, Atmosphere.js): the tone mapping, the exposure, the contrast and the saturation; the hour (-1: as the track) and the weather
        mirrorLeftReal: false, mirrorRightReal: false, mirrorCentreReal: false, mirrorLeftYaw: 0, mirrorLeftTilt: 0, mirrorRightYaw: 0, mirrorRightTilt: 0, mirrorCentreYaw: 0, mirrorCentreTilt: 0, gfxDebrisRate: 1, gfxDebrisScale: 1, gfxDebrisMax: 6000, gfxTone: "neutral", gfxExposure: 0.9, gfxContrast: 1.05, gfxSaturation: 1, gfxTime: 14, gfxWeather: "clear", gfxSunAzimuth: 40, gfxMoon: 1, gfxGround: "auto", simAiDamage: "near", simAiRange: 60, simAiSteps: 3, simTyreDetail: "full" };

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
        // a phone or a tablet starts with the low graphics (the first time; what is chosen is kept)
        var touchy = typeof OpenRacer !== "undefined" && OpenRacer.touchDevice ? OpenRacer.touchDevice() : false;
        if(touchy) Object.assign(options, { gfxPreset: "low", gfxScale: 0.75, gfxAA: 0, gfxShadows: 1, gfxReflections: 1, gfxAO: 0, gfxGI: 0, gfxVignette: false, gfxSmoke: 50, gfxDistance: 500, gfxAniso: 2, gfxSharpen: 0 });
    }

    function load() {
        loadDefaults();
        try {
            var stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
            if(stored && stored.bindings) {
                ACTIONS.forEach(function(a) {
                    if(Array.isArray(stored.bindings[a.id])) bindings[a.id] = stored.bindings[a.id];
                });
                // the pad buttons that came later (camera on X, repair on Back): also for a player whose controls were saved before, when that action has no pad
                // input and nothing else uses the button (they had no button at all, and the panel of the controls showed "–")
                [["cameraSwitch", 2], ["repairCar", 8]].forEach(function(n) {
                    var list = bindings[n[0]], taken = Object.keys(bindings).some(function(id) { return bindings[id].some(function(b) { return b.d === "pad" && b.t === "b" && b.i === n[1]; }); });
                    if(!stored.padAdded && !taken && !list.some(function(b) { return b.d === "pad"; })) list.push(padButton(n[1]));
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
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ bindings: bindings, options: options, padAdded: true }));
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

    // the actions that still work while a replay is shown (the others would act on the car of the game, which stands still)
    var REPLAY_ACTIONS = { cameraSwitch: true, cameraReset: true, mute: true, hudToggle: false, photo: true };        // (a photo is of the picture: it works in a replay too)
    // the cameras that can be chosen: the three of the cars, and the free one of the game (a replay has a free camera of its own)
    function nextCamera(current) { var last = replayOn() ? 3 : 4; return current >= last ? 2 : Math.max(2, current + 1); }
    function replayOn() { return typeof OpenRacer !== "undefined" && OpenRacer.Replay && OpenRacer.Replay.active; }

    function runHandler(id) {
        if(handlers[id]) handlers[id]();
    }

    // Looks at the inputs once per frame: which actions are held, and which have just been pressed
    function update() {
        var pads = currentPads();
        var freeCam = typeof OpenRacer !== "undefined" && OpenRacer.FreeCam && OpenRacer.FreeCam.active && !replayOn() ? OpenRacer.FreeCam : null;
        var freeCamTakes = freeCam ? freeCam.takes : null;
        for(var n = 0; n < ACTIONS.length; n++) {
            var id = ACTIONS[n].id;
            var list = bindings[id];
            var isDown = false;
            for(var i = 0; i < list.length; i++) {
                // the keys of the free camera of the game are its own while it is on (W A S D and the rest move the camera, they do not drive the car)
                if(list[i].d === "key" && freeCamTakes && freeCamTakes[list[i].code]) continue;
                if(inputValue(list[i], pads) >= DIGITAL_LEVEL) { isDown = true; break; }
            }
            if(virtualDown[id]) isDown = true;
            down[id] = isDown;
            if(isDown && !wasDown[id] && !paused && (!replayOn() || REPLAY_ACTIONS[id])) runHandler(id);
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
            // a layer on top owns Escape and closes only itself: a question (dialog.js), a window of the main menu, the vehicle picker, the question to save the
            // replay, a name in the video editor. This handler comes first (the window, capturing), and it opened or closed this menu under them as well:
            // in a game that resumed the race while a question was still open, and in the video editor it left the editor
            var own = document.querySelector("#orDialog, .or-dialog, #replaysDialog, #garageDialog, #vehiclePicker, #replayLeave, .veShade");
            if(own) { if(own.id === "replayLeave") { own.remove(); event.preventDefault(); } return; }
            // the tuning menu: Escape closes it (it opened the pause menu on top of it)
            if(!menu && typeof Tuning !== "undefined" && Tuning.isVisible && Tuning.isVisible()) { Tuning.toggle(); event.preventDefault(); return; }
            // the main menu: Escape is a step back there (MainMenu.js), not the menu of a game that is not running
            if(!menu && document.getElementById("mainMenu")) return;
            // in a replay Escape goes back to the game
            // (not in the video editor: Escape left it, without the question about what was not saved; Close there asks)
            if(OpenRacer.VideoEditor && OpenRacer.VideoEditor.active) return;
            if(replayOn()) { OpenRacer.Replay.stop(); event.preventDefault(); return; }
            // Escape cancels a wheel calibration first; while the racing line is recorded for the track editor it ends that (main.js)
            if(WheelControls.isCalibrating()) return;
            if(typeof OpenRacer !== "undefined" && OpenRacer.HudLayout && OpenRacer.HudLayout.editing()) { OpenRacer.HudLayout.cancel(); return; }       // (Escape in the HUD editor is Cancel)
            if(typeof race !== "undefined" && race.recording && !menu) { race.recording.stop(); return; }
            toggleMenu();
            return;
        }
        // a key that is typed in a field of the tuning menu is not a key of the game
        var target = event.target;
        if(target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
        // the key of the tuning menu closes it while it holds the race still (keys of the game are not read while the game stands still)
        if(paused && !menu && typeof Tuning !== "undefined" && Tuning.isVisible && Tuning.isVisible() &&
            (bindings.tuningMenu || []).some(function(b) { return b.d === "key" && b.code === event.code; })) { Tuning.toggle(); event.preventDefault(); return; }
        if(!paused) {
            var freeCamTaken = typeof OpenRacer !== "undefined" && OpenRacer.FreeCam && OpenRacer.FreeCam.active && OpenRacer.FreeCam.takes[event.code];      // (Alt and Control move the free camera: not the menu of the browser)
            // (an F key of the game is not the browser's too: F3 opened the find bar, which took the keys, and the car no longer drove)
            var fKey = /^F\d+$/.test(event.code) && Object.keys(bindings).some(function(id) { return bindings[id].some(function(b) { return b.d === "key" && b.code === event.code; }); });
            if(event.code === "Space" || event.code.indexOf("Arrow") === 0 || freeCamTaken || fKey) event.preventDefault();
            keysDown[event.code] = true;
        }
    }, true);

    window.addEventListener("keyup", function(event) {
        keysDown[event.code] = false;
        // (macOS sends no keyup for the other keys while Cmd is held: after a shortcut with Cmd a key of the game stayed pressed, full throttle until it was pressed again)
        if(event.code === "MetaLeft" || event.code === "MetaRight") keysDown = {};
    }, false);

    // another window or tab took the focus in a race against others: the pause menu (the race went on, the AI drove away and the car rolled on without a driver)
    function awayInRace() {
        keysDown = {};
        var racing = typeof race !== "undefined" && race && race.opponents && race.opponents.length && (race.state === "countdown" || race.state === "racing");
        if(racing && !menu && !paused && !replayOn() && window.car) openMenu();
    }
    window.addEventListener("blur", awayInRace, false);
    document.addEventListener("visibilitychange", function() { if(document.hidden) awayInRace(); }, false);

    // ---- options


    function setOption(name, value, quiet) {
        options[name] = value;
        save();
        optionListeners.forEach(function(fn) { fn(name, value); });
        if(menu && !quiet) renderMenu();
    }

    // ---- capturing a new input for the menu

    function startCapture(done) {
        stopCapture();
        var pads = getPads();
        var baseline = [];
        for(var p = 0; p < pads.length; p++) {
            // (a button that is held already, the A that chose the binding with a controller, counts only after it is let go: it was bound at once)
            baseline[p] = pads[p] ? { axes: Array.prototype.slice.call(pads[p].axes), held: Array.prototype.map.call(pads[p].buttons, function(x) { return x.pressed; }) } : null;
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
            var heldBefore = capture.baseline[p] && capture.baseline[p].held;
            for(var b = 0; b < pad.buttons.length; b++) {
                if(heldBefore && heldBefore[b]) { if(!pad.buttons[b].pressed) heldBefore[b] = false; continue; }
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

    // the buttons and sticks of a controller with the standard layout by their names (the trigger was "Button 7"); a wheel keeps its numbers
    var PAD_BUTTONS = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "Left stick press", "Right stick press", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Home"];
    var PAD_AXES = [["Left stick ←", "Left stick →"], ["Left stick ↑", "Left stick ↓"], ["Right stick ←", "Right stick →"], ["Right stick ↑", "Right stick ↓"]];
    function inputLabel(input) {
        if(input.d === "key") return keyLabel(input.code);
        // (only for a controller of the standard layout, or none connected: another one has its own numbering)
        var connected = input.d === "pad" ? controllerPad() : null, standard = !connected || connected.mapping === "standard";
        if(standard && input.d === "pad" && input.t === "b" && PAD_BUTTONS[input.i]) return PAD_BUTTONS[input.i];
        if(standard && input.d === "pad" && input.t === "a" && PAD_AXES[input.i]) return PAD_AXES[input.i][input.s < 0 ? 0 : 1];
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
            "#settingsMenu { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 3500; background: rgba(0, 0, 0, 0.72); " +
            "color: var(--text); font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 15px; overflow-y: auto; }" +
            "#settingsMenu .panel { max-width: 820px; margin: 30px auto; padding: 22px 28px; background: var(--panel); border-radius: 8px; }" +
            "#settingsMenu h1 { margin: 0 0 4px 0; font-size: 26px; }" +
            "#settingsMenu h2 { margin: 24px 0 8px 0; font-size: 17px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }" +
            "#settingsMenu .sub { color: var(--muted); margin-bottom: 14px; }" +
            "#settingsMenu .row { display: flex; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--line); min-height: 34px; }" +
            "#settingsMenu .label { width: 210px; flex: none; }" +
            "#settingsMenu .inputs { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }" +
            "#settingsMenu .chip { display: inline-flex; align-items: center; background: var(--line); border-radius: 4px; padding: 2px 4px 2px 8px; gap: 4px; }" +
            "#settingsMenu .chip.wheel { background: #3a3326; }" +
            "#settingsMenu .chip.waiting { background: #7a5a00; }" +
            "#settingsMenu .dev { opacity: 0.55; font-size: 11px; text-transform: uppercase; }" +
            "#settingsMenu button { background: var(--line); color: #fff; border: 0; border-radius: 3px; cursor: pointer; font-size: 14px; padding: 3px 7px; }" +
            "#settingsMenu button:hover { background: #343c47; }" +
            "#settingsMenu .chip button { background: transparent; padding: 2px 5px; }" +
            "#settingsMenu .chip button:hover { background: #343c47; }" +
            "#settingsMenu .add { padding: 3px 10px; }" +
            "#settingsMenu .top { display: flex; justify-content: space-between; align-items: flex-start; }" +
            "#settingsMenu .version { text-align: right; color: var(--muted); font-size: 12px; margin-top: 18px; }" +
            "@media (max-width: 640px) { #settingsMenu { font-size: 14px; } #settingsMenu .panel { margin: 0; padding: 12px 14px 20px; border-radius: 0; min-height: 100%; box-sizing: border-box; } #settingsMenu h1 { font-size: 22px; } " +
            "#settingsMenu .tabs { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 12px 0 6px; } #settingsMenu .tab { padding: 8px 10px; font-size: 13px; white-space: nowrap; flex: none; } " +
            "#settingsMenu .label { width: 46%; font-size: 13px; } #settingsMenu .top { flex-wrap: wrap; gap: 8px; } }" +
            "#settingsMenu .tabs { display: flex; gap: 4px; margin: 18px 0 6px; border-bottom: 1px solid var(--line); }" +
            "#settingsMenu .tab { background: transparent; color: var(--muted); padding: 8px 14px; border-radius: 6px 6px 0 0; font-size: 15px; }" +
            "#settingsMenu .tab:hover { background: var(--bg2); color: #fff; }" +
            "#settingsMenu .tab.active { background: var(--bg2); color: var(--head); box-shadow: inset 0 -2px var(--accent); }" +
            "#settingsMenu .page h2:first-child { margin-top: 10px; }" +
            "#settingsMenu .big { font-size: 16px; padding: 8px 18px; background: var(--accent); }" +
            "#settingsMenu .big:hover { background: var(--accent); }" +
            "#settingsMenu .none { color: var(--muted); font-style: italic; }" +
            "#settingsMenu .hint { color: var(--accent2); margin: 8px 0 0 0; min-height: 18px; }" +
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
    // ---- a backup of what this browser keeps for the game: every key of localStorage that begins with "openracer" (the settings and the controls, the lap records and the ghosts,
    // the setups and the grip the AI measured). The cars and tracks of the garage and the replays are in IndexedDB and have their own export (the Garage, the Replays).
    var storageNoteEl = null;
    function storageNote() {
        storageNoteEl = document.createElement("div");
        storageNoteEl.className = "sub";
        refreshStorageNote();
        return storageNoteEl;
    }
    function refreshStorageNote() {
        if(!storageNoteEl) return;
        var text = "Everything the game keeps (settings, controls, records, setups, your garage and replays) is in this browser, not on a server. Clearing the site data of this browser, a private window, or a full disk deletes it. Back up the settings and records here, and export the garage and the replays from their own pages.";
        storageNoteEl.textContent = text;
        if(!navigator.storage) return;
        var kept = navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(null);
        var used = navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve(null);
        Promise.all([kept, used]).then(function(r) {
            var mb = function(n) { return (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB"; };
            var extra = " " + (r[0] === true ? "The browser keeps this data." : r[0] === false ? "The browser has not promised to keep this data: it can be cleared when the disk is full." : "");
            if(r[1] && r[1].usage !== undefined) extra += " In use: " + mb(r[1].usage) + (r[1].quota ? " of " + mb(r[1].quota) + " allowed" : "") + ".";
            storageNoteEl.textContent = text + extra;
        }).catch(function() { /* no estimate */ });
    }
    function backupDownload() {
        var items = {}, count = 0;
        try {
            for(var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if(key && key.indexOf("openracer") === 0) { items[key] = localStorage.getItem(key); count++; }
            }
        } catch(e) { hint("Could not read the storage of the browser: " + e.message); return; }
        if(!count) { hint("There is nothing to back up yet."); return; }
        var date = new Date().toISOString().slice(0, 10);
        var blob = new Blob([JSON.stringify({ openracerBackup: 1, version: typeof OpenRacer !== "undefined" ? OpenRacer.VERSION : "", made: new Date().toISOString(), items: items })], { type: "application/json" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "openracer-backup-" + date + ".openracer-backup.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function() { URL.revokeObjectURL(link.href); }, 10000);
        hint("Saved " + count + " items in " + link.download + ".");
    }
    function backupRestoreRow() {
        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.style.display = "none";
        var row = optionRow("Restore a backup", "Choose a file\u2026", function() { input.value = ""; input.click(); });
        row.appendChild(input);
        input.onchange = function() {
            var file = input.files && input.files[0];
            if(!file) return;
            file.text().then(function(text) {
                var data;
                try { data = JSON.parse(text); } catch(e) { data = null; }
                if(!data || data.openracerBackup !== 1 || !data.items || typeof data.items !== "object") { hint("That is not a backup file of OpenRacer."); return; }
                var keys = Object.keys(data.items).filter(function(k) { return k.indexOf("openracer") === 0 && typeof data.items[k] === "string"; });
                if(!keys.length) { hint("The backup is empty."); return; }
                OpenRacerDialog.ask({ title: "Restore this backup?", text: keys.length + " items from " + (data.made ? data.made.slice(0, 10) : "a backup") + " (version " + (data.version || "?") + ") replace what this browser has under the same names: the settings, the controls, the records and the setups. Other things stay. The game reloads.", ok: "Restore", danger: true }).then(function(yes) {
                    if(!yes) return;
                    try { keys.forEach(function(k) { localStorage.setItem(k, data.items[k]); }); }
                    catch(e) { hint("Could not write everything (" + e.message + "). The storage is full."); return; }
                    location.reload();
                });
            }).catch(function(e) { hint("Could not read the file: " + e.message); });
        };
        return row;
    }

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
        var taken = [];
        ACTIONS.forEach(function(other) {
            if(other.id === action.id) return;
            var kept = bindings[other.id].filter(function(existing) { return !same(existing, input); });
            if(kept.length !== bindings[other.id].length) taken.push(other.label.replace(/\s*\(.*$/, "").replace(/,.*$/, ""));
            bindings[other.id] = kept;
        });
        var target = replaceIndex !== null && replaceIndex !== undefined ? bindings[action.id][replaceIndex] : null;
        var list = bindings[action.id].filter(function(existing) { return existing === target || !same(existing, input); });
        if(target) list[list.indexOf(target)] = input;
        else list.push(input);
        bindings[action.id] = list;
        save();
        hint(taken.length ? "That input was used for " + taken.join(" and ") + ": it is moved to " + action.label.replace(/\s*\(.*$/, "") + "." : "");
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

    // a popup with every vehicle: a click on one replaces the one that is driven (the page opens again with it, the rest of the address as it is)
    function chooseVehicle(currentId) {
        if(typeof Catalog === "undefined") return;
        var back = document.createElement("div");
        back.id = "vehiclePicker";
        back.style.cssText = "position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,0.65); display: flex; align-items: center; justify-content: center;";
        var box = document.createElement("div");
        box.style.cssText = "background: var(--bg2, #222); color: var(--head, #fff); border: 1px solid var(--line, #555); border-radius: 10px; padding: 16px; width: min(720px, 92vw); max-height: 82vh; overflow: auto; font: 15px sans-serif;";
        var head = document.createElement("div");
        head.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 18px;";
        head.textContent = "Choose a vehicle";
        var close = document.createElement("button");
        close.textContent = "×";
        close.style.cssText = "font: inherit; font-size: 22px; background: none; border: 0; color: inherit; cursor: pointer;";
        head.appendChild(close);
        box.appendChild(head);
        var grid = document.createElement("div");
        grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px;";
        box.appendChild(grid);
        back.appendChild(box);
        document.body.appendChild(back);
        function done() { if(back.parentNode) back.parentNode.removeChild(back); document.removeEventListener("keydown", onKey, true); }
        function onKey(event) { if(event.code === "Escape") { event.stopPropagation(); event.preventDefault(); done(); } }
        document.addEventListener("keydown", onKey, true);
        close.onclick = done;
        back.onclick = function(event) { if(event.target === back) done(); };
        Catalog.load("cars").then(function(list) {
            list.forEach(function(c) {
                var card = document.createElement("button");
                card.style.cssText = "display: flex; flex-direction: column; gap: 6px; align-items: stretch; text-align: left; font: inherit; color: inherit; background: var(--bg, #111); border: 2px solid " + (c.id === currentId ? "var(--accent, #4aa3ff)" : "var(--line, #555)") + "; border-radius: 8px; padding: 8px; cursor: pointer;";
                var img = document.createElement("img");
                img.src = "cars/" + encodeURIComponent(c.id) + "/preview.webp";
                img.alt = "";
                img.style.cssText = "width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 4px; background: #000;";
                img.onerror = function() { img.style.visibility = "hidden"; };
                var name = document.createElement("div");
                name.textContent = c.name || c.id;
                card.appendChild(img);
                card.appendChild(name);
                card.onclick = function() {
                    if(c.id === currentId) { done(); return; }
                    var query = new URLSearchParams(window.location.search);
                    query.set("car", c.id);
                    window.location.href = window.location.pathname + "?" + query.toString();
                };
                grid.appendChild(card);
            });
        }).catch(function(error) { grid.textContent = "Could not read the vehicles: " + error.message; });
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

    // a row with a list to choose from: choices is [[value, text], ...]
    function selectRow(label, name, choices) {
        var row = document.createElement("div");
        row.className = "row";
        var l = document.createElement("div");
        l.className = "label";
        l.textContent = label;
        row.appendChild(l);
        var inputs = document.createElement("div");
        inputs.className = "inputs";
        var select = document.createElement("select");
        select.style.cssText = "font: inherit; color: var(--head); background: var(--bg2); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; cursor: pointer;";
        choices.forEach(function(c) {
            var o = document.createElement("option");
            o.value = c[0]; o.textContent = c[1];
            if(options[name] === c[0]) o.selected = true;
            select.appendChild(o);
        });
        select.onchange = function() { setOption(name, select.value); };
        inputs.appendChild(select);
        row.appendChild(inputs);
        return row;
    }

    // a row with a dropdown of values of any kind: choices are [value, text]; onPick(value) when one is chosen (a dropdown, not a button that goes round:
    // on a phone a button that only goes forward made the resolution step up until the page gave out)
    function pickRow(label, current, choices, onPick) {
        var row = document.createElement("div");
        row.className = "row";
        var l = document.createElement("div");
        l.className = "label";
        l.textContent = label;
        row.appendChild(l);
        var inputs = document.createElement("div");
        inputs.className = "inputs";
        var select = document.createElement("select");
        select.style.cssText = "font: inherit; color: var(--head); background: var(--bg2); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; cursor: pointer; max-width: 100%;";
        choices.forEach(function(c, i) {
            var o = document.createElement("option");
            o.value = String(i); o.textContent = c[1];
            if(c[0] === current) o.selected = true;
            select.appendChild(o);
        });
        select.onchange = function() { var c = choices[parseInt(select.value, 10)]; if(c) onPick(c[0]); };
        inputs.appendChild(select);
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
        input.dataset.key = name;
        input.style.cssText = "width: 160px; vertical-align: middle;";
        var value = document.createElement("span");
        value.style.cssText = "display: inline-block; min-width: 150px; margin-left: 10px; color: var(--head);";
        value.textContent = text(options[name]);
        // (the value goes on while the slider moves; the menu is built again when it is let go, for the rows that depend on it. It was built again at every
        // step: the slider under the pointer was replaced, and with the keyboard it moved one step and lost the focus)
        input.oninput = function() { setOption(name, parseFloat(input.value), true); value.textContent = text(options[name]); };
        input.onchange = function() { renderMenu(); };
        inputs.appendChild(input);
        inputs.appendChild(value);
        row.appendChild(inputs);
        return row;
    }

    // a number that is typed (no upper limit): the value is kept when it is a number of at least min
    function numberRow(label, name, min, step) {
        var row = document.createElement("div");
        row.className = "row";
        var l = document.createElement("div");
        l.className = "label";
        l.textContent = label;
        row.appendChild(l);
        var inputs = document.createElement("div");
        inputs.className = "inputs";
        var input = document.createElement("input");
        input.type = "number"; input.min = min; input.step = step;
        input.value = options[name];
        input.style.cssText = "width: 110px;";
        input.addEventListener("keydown", function(e) { e.stopPropagation(); });
        input.onchange = function() { var v = parseFloat(input.value); if(isFinite(v) && v >= min) setOption(name, v); else input.value = options[name]; };
        inputs.appendChild(input);
        row.appendChild(inputs);
        return row;
    }

    // The curve of an easing: a slider from 0.3 to 3 and the shape of the curve (the value that the pedal has, from 0 to 1, over the time that the key is held)
    function curveRow(label, name) {
        var row = sliderRow(label, name, 0.3, 3, 0.1, function(v) {
            return v.toFixed(1) + (Math.abs(v - 1) < 0.05 ? " (straight)" : (v < 1 ? " (quick at first)" : " (slow at first)"));
        });
        var c = options[name], points = [];
        for(var i = 0; i <= 20; i++) points.push((2 + i * 2.8).toFixed(1) + "," + (30 - 28 * Math.pow(i / 20, c)).toFixed(1));
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "60"); svg.setAttribute("height", "32"); svg.setAttribute("viewBox", "0 0 60 32");
        svg.style.cssText = "margin-left: 8px; flex: none;";
        svg.innerHTML = "<rect x=\"1\" y=\"1\" width=\"58\" height=\"30\" rx=\"4\" fill=\"none\" stroke=\"#272e37\"/><polyline points=\"" + points.join(" ") + "\" fill=\"none\" stroke=\"#ff5a1f\" stroke-width=\"2\"/>";
        row.querySelector(".inputs").appendChild(svg);
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
            span.style.cssText = "margin-left: 10px; color: var(--muted); font-size: 13px;";
            span.textContent = note;
            inputs.appendChild(span);
        }
        row.appendChild(inputs);
        return row;
    }

    function renderMenu() {
        if(!menu) return;
        // what had the focus and how far the menu was scrolled stay as they were (a click on a setting jumped to the top)
        var focused = document.activeElement && menu.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.key : null;
        var oldPanel = menu.querySelector(".panel"), scrollMenu = menu.scrollTop, scrollPanel = oldPanel ? oldPanel.scrollTop : 0;
        setTimeout(function() {
            if(!menu) return;
            menu.scrollTop = scrollMenu;
            var newPanel = menu.querySelector(".panel");
            if(newPanel) newPanel.scrollTop = scrollPanel;
            if(focused) { var again = menu.querySelector("[data-key=\"" + focused + "\"]"); if(again) again.focus(); }
        }, 0);
        menu.innerHTML = "";
        var panel = document.createElement("div");
        panel.className = "panel";
        menu.appendChild(panel);

        var top = document.createElement("div");
        top.className = "top";
        var title = document.createElement("div");
        var inGame = !!window.car;            // (the menu is also opened from the main menu, where no game runs)
        title.innerHTML = "<h1>Settings</h1><div class=\"sub\">" + (inGame ? "The game is paused. " : "") + "Esc closes this menu.</div>";
        top.appendChild(title);
        var buttons = document.createElement("div");
        var resume = document.createElement("button");
        resume.className = "big";
        resume.textContent = inGame ? "Resume" : "Close";
        resume.onclick = closeMenu;
        buttons.appendChild(resume);
        // the ghost as a file: to send your best lap, or to race the lap of someone else (Ghost.js)
        var ghost = window.car && window.car.ghost;
        if(ghost && ghost.open) {
            var ghostRow = document.createElement("div");
            ghostRow.style.cssText = "margin-top: 10px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 13px;";
            var label = document.createElement("span");
            label.textContent = ghost.friend ? "Ghost: " + ghost.friend.name + " " + OpenRacer.Records.format(ghost.friend.time) : "Ghost";
            label.style.cssText = "opacity: 0.8; margin-right: 4px;";
            ghostRow.appendChild(label);
            var small = function(text, title, action, off) {
                var b = document.createElement("button");
                b.className = "big";
                b.style.cssText = "font-size: 13px; padding: 5px 10px; background: var(--line);" + (off ? " opacity: 0.45;" : "");
                b.textContent = text; b.title = title; b.disabled = !!off;
                b.onclick = action;
                ghostRow.appendChild(b);
                return b;
            };
            small("Save lap", "Save your best lap with this car on this track as a file to send", function() { if(ghost.download() !== false) { label.textContent = "Ghost: saved in your downloads"; } }, !ghost.hasBest());
            var picker = document.createElement("input");
            picker.type = "file"; picker.accept = ".openracer-ghost,application/json"; picker.style.display = "none";
            picker.onchange = function() {
                var file = picker.files && picker.files[0];
                picker.value = "";
                if(!file) return;
                ghost.open(file).then(function(g) { label.textContent = "Ghost: " + g.name + " " + OpenRacer.Records.format(g.time); }).catch(function(e) { label.textContent = e.message; label.style.color = "#ff8a80"; });
            };
            ghostRow.appendChild(picker);
            small("Race a ghost", "Race against the lap in a ghost file that someone sent", function() { picker.click(); });
            if(ghost.friend) small("Own lap", "Back to your own best lap as the ghost", function() { ghost.clearFriend(); label.textContent = "Ghost: your best lap"; });
            title.appendChild(ghostRow);
        }
        var replay = document.createElement("button");
        replay.className = "big";
        replay.style.cssText = "background: var(--accent); margin-left: 8px;";
        replay.textContent = "Replay";
        var canReplay = typeof OpenRacer !== "undefined" && OpenRacer.Replay && OpenRacer.Replay.available();
        replay.disabled = !canReplay;
        replay.title = canReplay ? "Watch what was recorded since the start of the game" : "Nothing is recorded yet";
        if(!canReplay) replay.style.opacity = "0.45";
        replay.onclick = function() { closeMenu(); OpenRacer.Replay.start(); };
        if(inGame) buttons.appendChild(replay);
        // the tuning menu, at the top (it was a row under Tools, and the U key)
        if(inGame && typeof Tuning !== "undefined") {
            var tune = document.createElement("button");
            tune.className = "big";
            tune.style.cssText = "background: var(--line); margin-left: 8px;";
            tune.textContent = "Tune the car";
            tune.title = "The tuning menu: the engine, the gearbox, the suspension, the tyres and the setups (key U)";
            tune.onclick = function() { closeMenu(); Tuning.toggle(); };
            buttons.appendChild(tune);
        }
        var mainMenu = document.createElement("button");
        mainMenu.className = "big";
        mainMenu.style.cssText = "background: var(--line); margin-left: 8px;";
        mainMenu.textContent = "Main menu";
        mainMenu.onclick = function() { var leave = function() { window.location.href = window.location.pathname; }; if(OpenRacer.Replay && OpenRacer.Replay.confirmLeave) OpenRacer.Replay.confirmLeave(leave); else leave(); };
        // start the race again from the grid (it was only in the results: a spin on lap 1 meant all the laps, or the main menu and every step again)
        var restart = document.createElement("button");
        restart.className = "big";
        restart.style.cssText = "background: var(--line); margin-left: 8px;";
        restart.textContent = "Restart";
        restart.title = "Start again from the grid, with the same car, track and options";
        restart.onclick = function() { var again = function() { window.location.reload(); }; if(OpenRacer.Replay && OpenRacer.Replay.confirmLeave) OpenRacer.Replay.confirmLeave(again); else again(); };
        if(inGame && !replayOn()) buttons.appendChild(restart);
        if(inGame) buttons.appendChild(mainMenu);
        // a track with a drag strip: the Top 50 and the tickets, at the top
        if(typeof currentTrack !== "undefined" && currentTrack && currentTrack.dragstrip && OpenRacer.DragStrip) {
            var drag = document.createElement("button");
            drag.className = "big";
            drag.style.cssText = "background: #2f8f5a; margin-left: 8px;";
            drag.textContent = "Drag strip: Top 50 and tickets";
            drag.onclick = function() { OpenRacer.DragStrip.showTop(currentTrack); };
            buttons.appendChild(drag);
        }
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
        // practice (no laps): another vehicle in place of this one; the page opens again with it, on the same track and with the same options
        if(typeof race !== "undefined" && race && race.options && !race.options.laps) {
            var here = new URLSearchParams(window.location.search).get("car");
            var vehicleRow = optionRow("Vehicle: " + (here || "?"), "Change vehicle…", function() { chooseVehicle(here); });
            page.appendChild(vehicleRow);
            if(typeof Catalog !== "undefined") Catalog.load("cars").then(function(list) {
                var now = list.filter(function(c) { return c.id === here; })[0];
                if(now) vehicleRow.querySelector(".label").textContent = "Vehicle: " + (now.name || now.id);
            }).catch(function() { /* the id stays */ });
        }
        page.appendChild(optionRow("Traction control", options.tc ? "On" : "Off", function() { setOption("tc", !options.tc); }));
        page.appendChild(optionRow("Two-step (the clutch in at a standstill holds the engine at the two-step speed)", options.twoStep ? "On" : "Off", function() { setOption("twoStep", !options.twoStep); }));
        page.appendChild(optionRow("Launch control (brake and full throttle at a standstill, let go of the brake)", options.launchControl ? "On" : "Off", function() { setOption("launchControl", !options.launchControl); }));
        page.appendChild(sliderRow("Drag strip: \"Get ready\" before the lights", "dragReady", 0.5, 6, 0.5, function(v) { return v.toFixed(1) + " s"; }));
        page.appendChild(sliderRow("Drag strip: lights stay after the green", "dragGreen", 0.5, 5, 0.5, function(v) { return v.toFixed(1) + " s"; }));
        page.appendChild(optionRow("ESC (stability control)", options.esc ? "On" : "Off", function() { setOption("esc", !options.esc); }));
        var cameraNames = ["Follow (smooth, FOV with speed)", "Cockpit", "Free camera (W A S D move the way it looks, Z X up and down, the mouse looks, Q E roll, 3 4 speed, [ ] field of view; the arrows still drive; P looks at the car, O moves with it, I fixes it to the car)"];
        page.appendChild(optionRow("Camera", cameraNames[options.camera - 2] || cameraNames[0], function() { setOption("camera", nextCamera(options.camera)); }));
        // a motorcycle: how it is steered, and the camera that follows it (to try what feels right)
        if(typeof car !== "undefined" && car && car.vehicle && car.vehicle.controller) {
            page.appendChild(optionRow("Motorcycle steering", options.bikeSteering === "counter" ? "Countersteer + lean" : "Lean only", function() { setOption("bikeSteering", options.bikeSteering === "counter" ? "lean" : "counter"); }));
            page.appendChild(optionRow("Wheelie control (the rider rolls the gas off as the front wheel lifts)", options.wheelieControl !== false ? "On" : "Off", function() { setOption("wheelieControl", options.wheelieControl === false); }));
            page.appendChild(selectRow("Motorcycle follow camera", "bikeCamera", [["lean", "Motorcycle lean chase (the picture rolls with the bike)"], ["classic", "Classic chase (as a car)"]]));
            page.appendChild(sliderRow("Motorcycle: lean at top speed (the keys ask for less lean as the speed goes up; this is what is left at the top)", "bikeFastLean", 15, 45, 1, function(v) { return Math.round(v) + "°"; }));
        }
        page.appendChild(optionRow("ABS", options.abs ? "On" : "Off", function() { setOption("abs", !options.abs); }));
        page.appendChild(optionRow("Automatic: reverse with the brake key", options.autoReverse ? "On" : "Off", function() { setOption("autoReverse", !options.autoReverse); }));
        page.appendChild(optionRow("Automatic: reverse with the brake pedal (wheel, pad, touch)", options.autoReversePedals ? "On" : "Off", function() { setOption("autoReversePedals", !options.autoReversePedals); }));
        page.appendChild(sliderRow("Automatic: reverse below a speed of", "autoReverseSpeed", 1, 15, 1, function(v) { return options.units === "imperial" ? (v / 1.609344).toFixed(1) + " mph" : v + " km/h"; }));       // (the value is kept in km/h; it is shown in the units of the game)
        // the mirrors of the car (Mirrors.js): the glass of each can be turned and tilted, to see what is behind or beside the car
        if(window.car && window.car.mirrors && window.car.mirrors.length) {
            var mirrorSides = [];
            window.car.mirrors.forEach(function(m) { if(mirrorSides.indexOf(m.side) < 0) mirrorSides.push(m.side); });
            var mirrorHeading = document.createElement("h2");
            mirrorHeading.textContent = "Mirrors";
            page.appendChild(mirrorHeading);
            mirrorSides.forEach(function(side) {
                var names = { Left: "Left mirror", Right: "Right mirror", Centre: "Mirror inside" };
                page.appendChild(sliderRow(names[side] + ": turn (positive " + (side === "Centre" ? "to the left" : "outwards") + ")", "mirror" + side + "Yaw", -25, 25, 1, function(v) { return v + "\u00b0"; }));
                page.appendChild(sliderRow(names[side] + ": tilt (positive up)", "mirror" + side + "Tilt", -25, 25, 1, function(v) { return v + "\u00b0"; }));
                page.appendChild(optionRow(names[side] + ": a real mirror (a picture of what is behind; costs a render of the scene)", options["mirror" + side + "Real"] ? "On" : "Off", function() { setOption("mirror" + side + "Real", !options["mirror" + side + "Real"]); }));
            });
        }
        page = tabPage("Keyboard");
        var keyNote = document.createElement("div");
        keyNote.className = "sub";
        keyNote.textContent = "How the keys bring the gas, the brake and the wheels up: the time to the full value and the curve of it (the line shows the pedal over the time that the key is held). The steering gets slower the faster the car goes; the wheels come back to the middle by themselves when the keys are let go.";
        page.appendChild(keyNote);
        // the easing of the keys: how long a key takes to bring the pedal or the wheels to the full value, and the curve of it (drawn next to the slider)
        [["Throttle", "keyThrottleTime", "keyThrottleCurve", "to full gas"], ["Brake", "keyBrakeTime", "keyBrakeCurve", "to full brake"], ["Steering", "keySteerTime", "keySteerCurve", "to full lock at a standstill"]].forEach(function(g) {
            var head = document.createElement("h2");
            head.textContent = g[0];
            page.appendChild(head);
            page.appendChild(sliderRow("Time " + g[3], g[1], 0.05, 2, 0.05, function(v) { return v.toFixed(2) + " s"; }));
            page.appendChild(curveRow("Curve", g[2]));
        });
        page.appendChild(sliderRow("Slower at speed", "keySlow", 0, 3, 0.25, function(v) {
            var at100 = 1 + Math.max(0, (100 / 3.6) / 4 - 1) * v;
            return v === 0 ? "off: the same at every speed" : at100.toFixed(1) + "× slower at 100 km/h" + (Math.abs(v - 1) < 0.01 ? " (as it was)" : "");
        }));
        page.appendChild(checkRow("Steering assist", "keyAssist", "when the rear steps out the front wheels turn into the slide by themselves, so it does not become a spin"));
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
        // the lock of the car: a kart with a steering of 108 degrees from lock to lock is turned by 108 degrees of the wheel, and the force feedback stops the wheel there (a hard stop)
        var wheelLocks = [270, 360, 540, 720, 900, 1080];
        page.appendChild(optionRow("Steering lock of the wheel", options.wheelDegrees + "° from lock to lock",
            function() { setOption("wheelDegrees", wheelLocks[(wheelLocks.indexOf(options.wheelDegrees) + 1) % wheelLocks.length]); }));
        page.appendChild(optionRow("Match the steering lock of the car", options.wheelMatch ? "On: the wheel turns as far as the steering wheel of the car, then the force feedback stops it" : "Off: the whole range of the wheel is the lock",
            function() { setOption("wheelMatch", !options.wheelMatch); }));
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
        page.appendChild(optionRow("HUD layout", "Edit HUD…", function() { OpenRacer.HudLayout.edit(); }));
        page.appendChild(optionRow("Units", options.units === "imperial" ? "Imperial (mph)" : "Metric (km/h)",
            function() { setOption("units", options.units === "imperial" ? "metric" : "imperial"); }));
        if(typeof TouchControls !== "undefined" && TouchControls.enabled()) {
            page = tabPage("Mobile");
            var mobileNote = document.createElement("div");
            mobileNote.className = "sub";
            mobileNote.textContent = "The steering is a stick under your thumb on the left half of the screen. A smaller number takes less movement of the finger for the full steering.";
            page.appendChild(mobileNote);
            page.appendChild(sliderRow("Finger travel for full lock", "touchSteer", 0.01, 1, 0.01, function(v) {
                return v.toFixed(2) + "× (about " + Math.round(TouchControls.travel(v)) + " px)";
            }));
            page.appendChild(optionRow("HUD and buttons", "Edit HUD…", function() { OpenRacer.HudLayout.edit(); }));
        }
        page = tabPage("Graphics");
        if(typeof OpenRacer !== "undefined" && OpenRacer.Graphics) {
            var G = OpenRacer.Graphics;
            var gfxNote = document.createElement("div");
            gfxNote.className = "sub";
            gfxNote.textContent = "A preset sets all of these at once; changing one of them makes it Custom. The screen space effects (SSAO, SSGI) draw the scene a second time to find the surfaces, so they cost frames: try them one by one.";
            page.appendChild(gfxNote);
            // a dropdown per option; any change makes the preset Custom
            var gfxPick = function(name) {
                return function(value) {
                    setOption(name, value);
                    if(G.currentPreset() !== options.gfxPreset) setOption("gfxPreset", G.currentPreset());
                };
            };
            var presetNames = { low: "Low", medium: "Medium", high: "High", ultra: "Ultra", custom: "Custom" };
            var presetChoices = ["low", "medium", "high", "ultra"].map(function(k) { return [k, presetNames[k]]; });
            if(G.currentPreset() === "custom") presetChoices.push(["custom", "Custom"]);
            page.appendChild(pickRow("Preset", G.currentPreset(), presetChoices, function(name) { if(name !== "custom") G.applyPreset(name); }));
            var section = function(title) { var h = document.createElement("h2"); h.textContent = title; page.appendChild(h); };
            section("Picture");
            page.appendChild(pickRow("Resolution", options.gfxScale, [0.5, 0.75, 1, 1.25, 1.5].map(function(v) { return [v, Math.round(v * 100) + "% of the screen"]; }), gfxPick("gfxScale")));
            page.appendChild(pickRow("Anti-aliasing", options.gfxAA, [0, 2, 4, 8].map(function(v) { return [v, v ? v + "\u00d7 MSAA" : "Off"]; }), gfxPick("gfxAA")));
            page.appendChild(pickRow("Texture sharpness at a slant (anisotropic)", options.gfxAniso, [1, 2, 4, 8, 16].map(function(v) { return [v, v === 1 ? "Off" : v + "\u00d7"]; }), gfxPick("gfxAniso")));
            page.appendChild(pickRow("Sharpening", options.gfxSharpen, [[0, "Off"], [1, "Low"], [2, "Medium"], [3, "High"]], gfxPick("gfxSharpen")));
            page.appendChild(pickRow("Draw distance", options.gfxDistance, [500, 1000, 2000, 5000].map(function(v) { return [v, v + " m"]; }), gfxPick("gfxDistance")));
            section("Light and shadow");
            var shadowNames = ["Off", "Low", "Medium", "High", "Ultra"];
            page.appendChild(pickRow("Shadows", options.gfxShadows, [0, 1, 2, 3, 4].map(function(v) { return [v, shadowNames[v] + (v ? " (" + G.SHADOW_SIZES[v] + ")" : "")]; }), gfxPick("gfxShadows")));
            var reflectionNames = ["Off (still)", "Low (slow)", "High"];
            page.appendChild(pickRow("Reflections", options.gfxReflections, [0, 1, 2].map(function(v) { return [v, reflectionNames[v]]; }), gfxPick("gfxReflections")));
            var effectNames = ["Off", "Low", "High"];
            page.appendChild(pickRow("Ambient occlusion (SSAO)", options.gfxAO, [0, 1, 2].map(function(v) { return [v, effectNames[v]]; }), gfxPick("gfxAO")));
            page.appendChild(pickRow("Global illumination (SSGI)", options.gfxGI, [0, 1, 2].map(function(v) { return [v, effectNames[v]]; }), gfxPick("gfxGI")));
            section("Look");
            var toneNames = { none: "Off (clips the bright parts)", neutral: "Neutral (true colours)", agx: "AgX (soft, a little flat)", aces: "ACES (film, strong contrast)" };
            page.appendChild(pickRow("Tone mapping", options.gfxTone, ["neutral", "agx", "aces", "none"].map(function(k) { return [k, toneNames[k]]; }), function(v) { setOption("gfxTone", v); }));
            page.appendChild(sliderRow("Exposure (the brightness of the picture)", "gfxExposure", 0.4, 1.6, 0.05, function(v) { return v.toFixed(2); }));
            page.appendChild(sliderRow("Contrast", "gfxContrast", 0.7, 1.4, 0.05, function(v) { return v.toFixed(2); }));
            page.appendChild(sliderRow("Saturation", "gfxSaturation", 0, 1.6, 0.05, function(v) { return v.toFixed(2); }));
            page.appendChild(pickRow("Vignette", !!options.gfxVignette, [[false, "Off"], [true, "On"]], gfxPick("gfxVignette")));
            section("Atmosphere");
            var timeNames = [[5.25, "Dawn"], [8, "Morning"], [12, "Noon"], [15, "Afternoon"], [17.5, "Evening"], [19, "Sunset"], [20.25, "Dusk"], [23.5, "Night"]];
            page.appendChild(pickRow("Time of day", options.gfxTime, timeNames, function(v) { setOption("gfxTime", v); }));
            page.appendChild(sliderRow("Hour (fine)", "gfxTime", 0, 24, 0.25, function(v) { var h = Math.floor(v), m = Math.round((v - h) * 60); return h + ":" + (m < 10 ? "0" : "") + m; }));
            page.appendChild(sliderRow("Sun direction (where it is at noon)", "gfxSunAzimuth", 0, 355, 5, function(v) { return Math.round(v) + "\u00b0"; }));
            page.appendChild(pickRow("Moon", options.gfxMoon, [[0, "New"], [0.25, "Crescent"], [0.5, "Half"], [0.75, "Gibbous"], [1, "Full"]], function(v) { setOption("gfxMoon", v); }));
            var weatherNames = { clear: "Clear", cloudy: "Cloudy", fog: "Fog", rain: "Rain", snow: "Snow" };
            page.appendChild(pickRow("Weather", options.gfxWeather, ["clear", "cloudy", "fog", "rain", "snow"].map(function(k) { return [k, weatherNames[k]]; }), function(v) { setOption("gfxWeather", v); }));
            var groundNames = { auto: "Follows the weather", dry: "Dry", wet: "Wet", snow: "Snow" };
            page.appendChild(pickRow("Ground", options.gfxGround, ["auto", "dry", "wet", "snow"].map(function(k) { return [k, groundNames[k]]; }), function(v) { setOption("gfxGround", v); }));
            var atmoNote = document.createElement("div");
            atmoNote.className = "sub";
            atmoNote.textContent = "The sky is the same on every track. Rain wets the road and snow lies on it and stays: both give less grip (the AI drives slower), snow most. Wet comes in about 40 seconds and dries in a few minutes; snow builds up in a few minutes and melts slowly. There are no headlights yet: the night is dark.";
            page.appendChild(atmoNote);
            section("Effects");
            page.appendChild(sliderRow("Smoke", "gfxSmoke", 0, 200, 10, function(v) { return v + "%"; }));
            page.appendChild(numberRow("Debris: spawn rate (grass, sand and snow that the wheels throw up; 1 is normal, 0 is none, any number)", "gfxDebrisRate", 0, 0.1));
            page.appendChild(sliderRow("Debris: size (1 is normal)", "gfxDebrisScale", 0, 5, 0.1, function(v) { return v.toFixed(1) + "\u00d7"; }));
            page.appendChild(sliderRow("Debris: most pieces at once (they stay on the ground for a while)", "gfxDebrisMax", 500, 20000, 500, function(v) { return v + " pieces"; }));
        }
        page = tabPage("Simulation");
        var simNote = document.createElement("div");
        simNote.className = "sub";
        simNote.textContent = "What the computer calculates. With many AI cars with damage the physics is the biggest cost: these settings trade a little realism for frames.";
        page.appendChild(simNote);
        // the tyres of nodes of the cars (Vehicle.tyreDetail): most of the time of the physics of a car is in them
        page.appendChild(pickRow("Tyres of cars: detail (the tyres of nodes, most of the work of the physics; a motorcycle and a kart keep their own)", options.simTyreDetail, [["full", "Full (as the car is made)"], ["medium", "Medium (2 rings of nodes: a third less work)"], ["low", "Low (1 ring of 12: half to two thirds less)"]], function(v) { setOption("simTyreDetail", v); }));
        page.appendChild(pickRow("AI cars: damage (soft body)", options.simAiDamage, [["full", "Always (most realistic)"], ["near", "Only near my car"], ["off", "Off (rigid AI cars)"]], function(v) { setOption("simAiDamage", v); }));
        page.appendChild(sliderRow("AI cars: damage range around my car (when 'Only near my car')", "simAiRange", 20, 300, 10, function(v) { return v + " m"; }));
        page.appendChild(pickRow("AI cars: soft body detail (steps per frame)", options.simAiSteps, [[3, "Full"], [2, "Medium"], [1, "Low (fastest)"]], function(v) { setOption("simAiSteps", v); }));
        var simNote2 = document.createElement("div");
        simNote2.className = "sub";
        simNote2.textContent = "'Only near my car': an AI car further away than the range does not dent (it keeps the damage it has), so the cars you see and hit are the ones that are calculated. Low detail makes the shell of an AI car a little softer and less exact; the dents still form.";
        page.appendChild(simNote2);
        page = tabPage("Tools");
        page.appendChild(optionRow("Debug text", options.debug ? "On" : "Off", function() { setOption("debug", !options.debug); }));
        // what the browser keeps (settings, bindings, records, ghosts, setups): a backup file, and the state of the storage of the browser
        page.appendChild(storageNote());
        page.appendChild(optionRow("Back up my settings, controls, records and setups", "Download", backupDownload));
        page.appendChild(backupRestoreRow());
        page.appendChild(optionRow("Ask the browser to keep my data", "Keep", function() {
            if(!navigator.storage || !navigator.storage.persist) { hint("This browser cannot be asked."); return; }
            navigator.storage.persist().then(function(yes) { hint(yes ? "The browser will keep the data of this game unless you delete it yourself." : "The browser did not agree. Back up your data now and then."); refreshStorageNote(); });
        }));
        var tuningRow = optionRow("Tuning menu", "Open", function() { closeMenu(); Tuning.toggle(); });
        if(window.car) page.appendChild(tuningRow);            // (the tuning menu is of the car in the game)
        // the runs of the drag strip of this track (DragStrip.js): the Top 50, with the tickets
        if(typeof currentTrack !== "undefined" && currentTrack && currentTrack.dragstrip && OpenRacer.DragStrip) {
            page.appendChild(optionRow("Drag strip of this track", "Top 50 and tickets", function() { OpenRacer.DragStrip.showTop(currentTrack); }));
        }
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
                OpenRacerDialog.ask({ title: "Forget the records of this track?", text: "The lap records and the ghosts of every car on " + (currentTrack.name || currentTrack.id) + " are deleted. This cannot be undone.", ok: "Forget them", danger: true }).then(function(yes) {
                    if(!yes) return;
                    OpenRacer.Records.forget(currentTrack.id);
                    if(race.ghost) race.ghost.best = null;
                    hint("The records and the ghost of this track are forgotten.");
                });
            }));
        }
        if(window.car) page.appendChild(optionRow("Surroundings for Blender", "Save as HDR", function() {
            if(typeof EnvironmentExport !== "undefined") EnvironmentExport.download();
        }));
        page = tabPage("Display and sound");
        // the volumes as sliders (0 to 150 %): the engine, and the squeal of the tyres on its own (it went with the engine)
        var percent = function(v) { return Math.round(v * 100) + "%"; };
        page.appendChild(sliderRow("Engine volume", "volume", 0, 1.5, 0.05, percent));
        page.appendChild(sliderRow("Tyre volume", "tyreVolume", 0, 1.5, 0.05, percent));
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
            OpenRacerDialog.ask({ title: "Reset the controls?", text: "Every key, pad button and wheel axis goes back to the default. The bindings you made are lost.", ok: "Reset", danger: true }).then(function(yes) {
                if(!yes) return;
                ACTIONS.forEach(function(a) { bindings[a.id] = clone(a.defaults); });
                save();
                renderMenu();
            });
        };
        bottom.appendChild(reset);
        tabPage("Controls").appendChild(bottom);
        showTab();
        var version = document.createElement("div");
        version.className = "version";
        version.textContent = "OpenRacer " + OpenRacer.VERSION;
        panel.appendChild(version);
    }

    // what holds the game still besides this menu, each by its own name: the HUD editor, a Take, the tuning menu in a race. (One flag for all of them: the tuning
    // menu let go of the pause of the menu that the window had opened, and the race went on behind it)
    var holds = {};
    function held() { return Object.keys(holds).some(function(k) { return holds[k]; }); }

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
        paused = held();          // (the HUD editor, a Take or the tuning menu in a race may still hold the game)
        hintText = "";
    }

    function toggleMenu() {
        if(menu) closeMenu();
        else openMenu();
    }

    // ---- actions without a car

    // a short line in the middle of the screen when a key turns a driver aid on or off (a C or a B next to W, A, S, D turned it off without a sign but a badge)
    var noticeTimer = 0;
    function notice(text) {
        var el = document.getElementById("aidNotice");
        if(!el) {
            el = document.createElement("div");
            el.id = "aidNotice";
            el.style.cssText = "position: absolute; left: 50%; top: 38%; transform: translateX(-50%); z-index: 1001; padding: 8px 18px; border-radius: 6px; background: rgba(20, 24, 31, 0.85); " +
                "color: #fff; font: bold 16px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; pointer-events: none;";
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.display = "block";
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(function() { el.style.display = "none"; }, 1600);
    }
    function aid(option, name, action) {
        setOption(option, !options[option]);
        var keys = (bindings[action] || []).filter(function(b) { return b.d === "key"; }).map(function(b) { return keyLabel(b.code); });
        notice(name + (options[option] ? " on" : " off") + (keys.length ? " (" + keys[0] + ")" : ""));
    }
    handlers.toggleTC = function() { aid("tc", "Traction control", "toggleTC"); };
    handlers.toggleTwoStep = function() { aid("twoStep", "Two-step", "toggleTwoStep"); };
    handlers.toggleLaunch = function() { aid("launchControl", "Launch control", "toggleLaunch"); };
    handlers.toggleABS = function() { aid("abs", "ABS", "toggleABS"); };
    handlers.toggleESC = function() { aid("esc", "Stability control (ESC)", "toggleESC"); };
    handlers.cameraSwitch = function() { setOption("camera", nextCamera(options.camera)); };
    handlers.parkingBrake = function() { if(options.camera === 4) return; if(window.car && window.car.toggleParkingBrake) window.car.toggleParkingBrake(); };     // (the free camera has P for its aim)
    handlers.freeCamAim = function() { if(options.camera === 4 && typeof OpenRacer !== "undefined" && OpenRacer.FreeCam) OpenRacer.FreeCam.toggleAim(); };
    handlers.take = function() { if(typeof OpenRacer !== "undefined" && OpenRacer.Take) OpenRacer.Take.toggle(); };
    handlers.freeCamFollow = function() { if(options.camera === 4 && typeof OpenRacer !== "undefined" && OpenRacer.FreeCam) OpenRacer.FreeCam.toggleFollow(); };
    handlers.tuningMenu = function() { Tuning.toggle(); };
    handlers.hudToggle = function() { setOption("hud", !options.hud); };
    handlers.debugToggle = function() { setOption("debug", !options.debug); };
    handlers.photo = function() { if(typeof takePhoto === "function") takePhoto(); };
    handlers.mute = function() { aid("sound", "Engine sound", "mute"); };
    handlers.calibrate = function() { WheelControls.startCalibration(window.car); };
    handlers.wheelToggle = function() { WheelControls.toggle(); };
    handlers.startEngine = function() { if(window.car) window.car.startEngine(); };
    handlers.resetCar = function() { if(window.car) window.car.reset = true; };
    handlers.saveResetPosition = function() { if(window.car && window.car.saveResetPosition) window.car.saveResetPosition(); };
    // (in a race the repair is no pit stop: the tyres and the fuel stay as they are, and the lap does not count as a record; it was a free stop at any moment)
    handlers.repairCar = function() { if(window.car && window.car.vehicle) { var racing = typeof race !== "undefined" && race && race.state === "racing"; window.car.vehicle.repairUpright(racing); if(racing) window.car.lapInvalid = true; if(window.car.recoverCrash) window.car.recoverCrash(); if(window.car.updateVisuals) window.car.updateVisuals(0); } };
    handlers.cameraReset = function() { if(window.car) { window.car.cameraAngle = 0; window.car.cameraElev = 0; window.car.cameraZoom = 1; } };
    handlers.telemetry = function() { if(window.telemetry) window.telemetry.setVisible(!window.telemetry.visible); };
    handlers.shiftUp = function() { if(window.car) window.car.shiftUp(); };
    handlers.shiftDown = function() { if(window.car) window.car.shiftDown(); };

    // the first game on this computer: the keys that matter, for a while at the side (they were only on the last tab of the settings, in long rows)
    function showKeysOnce() {
        try { if(localStorage.getItem("openracer.keysShown")) return; localStorage.setItem("openracer.keysShown", "1"); } catch(e) { return; }
        if(typeof TouchControls !== "undefined" && TouchControls.enabled && TouchControls.enabled()) return;      // (the touch buttons are on the screen)
        var pad = typeof usingGamepad !== "undefined" && usingGamepad;
        var of = function(id) {
            var list = (bindings[id] || []).filter(function(b) { return pad ? b.d === "pad" : b.d === "key"; });
            return list.map(inputLabel).slice(0, 2).join(" / ") || "–";
        };
        var rows = [["Throttle, brake", of("throttle") + ", " + of("brake")], ["Steer", of("steerLeft") + ", " + of("steerRight")], ["Handbrake", of("handbrake")],
            ["Shift up, down", of("shiftUp") + ", " + of("shiftDown")], ["Back on the line", of("resetCar")], ["Repair", of("repairCar")], ["Camera", of("cameraSwitch")],
            ["Pause, restart, all controls", pad ? "Start" : "Esc"]];
        var box = document.createElement("div");
        box.id = "keysOnce";
        box.style.cssText = "position: absolute; right: 16px; bottom: 120px; z-index: 1001; padding: 12px 16px; border-radius: 8px; background: rgba(20, 24, 31, 0.88); color: #fff; " +
            "font: 13px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: calc(100vw - 32px); cursor: pointer;";
        box.title = "Click to close";
        var html = "<div style=\"font-weight: bold; margin-bottom: 6px;\">Controls</div><table style=\"border-spacing: 10px 2px; margin: 0 -10px;\">";
        rows.forEach(function(r) { html += "<tr><td style=\"opacity: 0.75;\"></td><td style=\"font-weight: bold;\"></td></tr>"; });
        box.innerHTML = html + "</table>";
        var cells = box.querySelectorAll("td");
        rows.forEach(function(r, i) { cells[i * 2].textContent = r[0]; cells[i * 2 + 1].textContent = r[1]; });
        box.onclick = function() { box.remove(); };
        document.body.appendChild(box);
        setTimeout(function() { box.remove(); }, 20000);
    }

    load();
    if(options.camera === 1) options.camera = 2;      // the fixed camera is gone
    if(options.camera === 4) options.camera = 2;      // (the free camera is not kept for the next game: it took W, A, S, D and Space, and the car did not drive)
    addStyle();

    return {
        update: update,
        isDown: isDown,
        keyDown: function(code) { return !!keysDown[code] && !paused; },        // a key as it is, by its code (the free camera of the game)
        controllerAnalog: controllerAnalog,
        controllerPad: controllerPad,
        option: function(name) { return options[name]; },
        setOption: setOption,
        onOptionChange: function(fn) { optionListeners.push(fn); },
        setVirtual: function(id, held) { virtualDown[id] = !!held; },
        trigger: function(id) {
            var closing = id === "tuningMenu" && typeof Tuning !== "undefined" && Tuning.isVisible && Tuning.isVisible();       // (the Tune button closes the menu that holds the race)
            if((!paused || closing) && !replayOn() && handlers[id]) handlers[id]();
        },      // an action once, as a key press does (the buttons of the HUD)
        isPaused: function() { return paused; },
        capturing: function() { return !!capture; },          // (a control is being bound: PadNav.js keeps off the buttons)
        toggleMenu: toggleMenu,
        closeMenu: closeMenu,
        holdPause: function(flag, reason) { holds[reason || "other"] = !!flag; paused = !!menu || held(); keysDown = {}; },        // the game stands still without the menu (the HUD editor, a Take, the tuning menu in a race)
        bindings: function(id) { return bindings[id]; },
        showKeysOnce: showKeysOnce
    };
})();
