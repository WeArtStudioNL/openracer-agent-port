/*
    This file is part of OpenRacer.

    OpenRacer is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    OpenRacer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/*
 * WheelControls.js
 *
 * Description: Support for racing wheels (steering wheel, pedals and shifter)
 *              through the Gamepad API.
 * Notes: Browsers expose wheels as generic gamepads, and the axis/button
 *        numbering differs per device and per browser. Instead of hard-coding
 *        mappings, press K in-game to run a short calibration. The resulting
 *        mapping is stored per device in localStorage.
 *
 *        Supported inputs:
 *          - steering axis
 *          - throttle, brake and (optional) clutch pedal axes
 *          - sequential shifting (paddles / buttons) or an H-pattern shifter
 *
 *        Limitations: pedals must be reported by the same device as the wheel,
 *        and each pedal needs its own axis (combined throttle/brake axes are
 *        not supported).
 */

var WheelControls = (function() {
    // Ids of wheels that are recognised even when the browser reports a standard layout.
    var KNOWN_WHEELS = /wheel|g25|g27|g29|g920|g923|driving force|thrustmaster|t300|t150|tmx|fanatec|moza|simagic|simucube/i;
    var STORAGE_PREFIX = "openracer.wheel.";
    var LAST_KEY = "~last";    // the calibration of the wheel that was calibrated last

    var DEAD_ZONE = 0.03;      // ignore tiny pedal movements
    var STEER_DEAD_ZONE = 0.03; // the wheel counts as centred within this part of its range
    var SETTLE_MS = 500;       // the device must be quiet this long before resting values are read
    var MAX_SETTLE_MS = 4000;  // give up waiting for a quiet device (noisy axes) after this long
    var QUIET_DELTA = 0.02;    // axis changes below this count as quiet
    var HOLD_MS = 600;         // an axis must be held still this long before its extreme is accepted
    var MAX_HOLD_MS = 4000;    // accept the extreme after this long even if the axis keeps jittering
    var STABLE_DELTA = 0.05;   // axis changes below this count as holding still
    var DETECT_DELTA = 0.35;   // minimal axis movement to count as input during calibration
    var NOISE_SHARE = 0.6;     // an axis that changes in more than this share of the frames while waiting for quiet is noise
    var REVERSE_MAX_MPH = 3;   // sequential shift into reverse is only allowed below this speed

    var profiles = {};
    var calibration = null;
    var overlay = null;
    var overlayTimeout = null;
    var hinted = {};
    var lastButtons = [];
    var wasActive = false;
    var reverseFromWheel = false;
    var enabled = true;            // toggled with M, to fall back to the keyboard
    var zeroed = {};               // pads whose pedal rest values were verified this session
    var ownsSteer = false;         // the wheel only overrides an input while it is being used,
    var ownsThrottle = false;      // so the keyboard keeps working when the wheel is idle
    var ownsBrake = false;
    var lastStatus = "";
    var shiftSource = null;        // "h" or "sequential": whichever the driver used last

    function clamp(x, min, max) {
        return Math.max(min, Math.min(max, x));
    }

    function getPads() {
        return navigator.getGamepads ? navigator.getGamepads() : [];
    }

    function isPressed(pad, index) {
        var b = pad.buttons[index];
        return !!b && b.pressed;
    }

    function normalise(id) {
        return id.toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function readStored(key) {
        try {
            var stored = window.localStorage.getItem(key);
            return stored ? JSON.parse(stored) : null;
        } catch(e) {
            return null;
        }
    }

    function isWheelCandidate(pad) {
        return pad.mapping !== "standard" || KNOWN_WHEELS.test(pad.id);
    }

    // The calibration of a pad. Pad ids are normally the same every time the wheel is connected, but the
    // spelling can differ and a wheel can show up under another id (another USB port, a browser update). So
    // after the exact id, the same id in another spelling is tried, and then the calibration of the last wheel
    // that was calibrated, if this pad is a wheel with the same number of axes and buttons.
    function loadProfile(id, pad) {
        if(profiles[id]) return profiles[id];
        var profile = readStored(STORAGE_PREFIX + id);
        try {
            if(!profile) {
                var wanted = normalise(id);
                for(var i = 0; i < window.localStorage.length && !profile; i++) {
                    var name = window.localStorage.key(i);
                    if(name.indexOf(STORAGE_PREFIX) === 0 && name !== STORAGE_PREFIX + LAST_KEY && normalise(name.substring(STORAGE_PREFIX.length)) === wanted) {
                        profile = readStored(name);
                    }
                }
            }
        } catch(e) {
            profile = null;
        }
        if(!profile && pad && isWheelCandidate(pad)) {
            var last = readStored(STORAGE_PREFIX + LAST_KEY);
            if(last && last.profile && last.axes === pad.axes.length && last.buttons === pad.buttons.length) {
                profile = last.profile;
                console.log("WheelControls: using the calibration of " + last.id + " for " + id);
            }
        }
        if(profile) profiles[id] = profile;
        return profile;
    }

    function saveProfile(id, profile, pad) {
        profiles[id] = profile;
        try {
            window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(profile));
            var source = pad || findPadById(id);
            if(source) {
                window.localStorage.setItem(STORAGE_PREFIX + LAST_KEY, JSON.stringify({
                    id: id, profile: profile, axes: source.axes.length, buttons: source.buttons.length
                }));
            }
        } catch(e) {
            console.log("Could not store wheel profile: " + e);
        }
    }

    function findPadById(id) {
        var pads = getPads();
        for(var i = 0; i < pads.length; i++) {
            if(pads[i] && pads[i].id === id) return pads[i];
        }
        return null;
    }

    // Returns the connected pad that should be treated as a racing wheel.
    function findWheel() {
        var pads = getPads();
        var i;
        for(i = 0; i < pads.length; i++) {
            if(pads[i] && pads[i].connected && loadProfile(pads[i].id, pads[i])) return pads[i];
        }
        for(i = 0; i < pads.length; i++) {
            if(pads[i] && pads[i].connected && isWheelCandidate(pads[i])) return pads[i];
        }
        return null;
    }

    // Returns the pad to calibrate: a wheel if we can find one, else any connected pad.
    function findCalibrationPad() {
        var wheel = findWheel();
        if(wheel) return wheel;
        var pads = getPads();
        for(var i = 0; i < pads.length; i++) {
            if(pads[i] && pads[i].connected) return pads[i];
        }
        return null;
    }

    // Converts a pedal axis to 0..1 using the calibrated rest and fully-pressed values.
    function readPedal(pad, binding) {
        var raw = pad.axes[binding.axis];
        if(raw === undefined || binding.full === binding.rest) return 0;
        var value = clamp((raw - binding.rest) / (binding.full - binding.rest), 0, 1);
        return value < DEAD_ZONE ? 0 : value;
    }

    // Converts the steering axis to -1 (full left) .. 1 (full right).
    function readSteering(pad, binding) {
        var raw = pad.axes[binding.axis];
        var half = (binding.right - binding.left) / 2;
        if(raw === undefined || half === 0) return 0;
        var centre = (binding.right + binding.left) / 2;
        return clamp((raw - centre) / half, -1, 1);
    }

    function showMessage(text, duration) {
        if(!overlay) {
            overlay = document.createElement("div");
            overlay.style.cssText = "position: absolute; top: 20px; left: 50%; transform: translateX(-50%); " +
                "z-index: 1001; padding: 10px 20px; background: rgba(0, 0, 0, 0.75); color: #ffffff; white-space: pre-line; " +
                "font-family: Arial; font-size: 16px; border-radius: 4px; display: none;";
            document.body.appendChild(overlay);
        }
        overlay.textContent = text;
        overlay.style.display = "block";
        clearTimeout(overlayTimeout);
        if(duration) {
            overlayTimeout = setTimeout(function() { overlay.style.display = "none"; }, duration);
        }
    }

    function hideMessage() {
        clearTimeout(overlayTimeout);
        if(overlay) overlay.style.display = "none";
    }

    // Calibration

    function buildSteps(car) {
        var steps = [
            { id: "steerLeft", kind: "axis", text: "Turn the wheel fully LEFT and hold it" },
            { id: "steerRight", kind: "axis", text: "Turn the wheel fully RIGHT and hold it" },
            { id: "throttle", kind: "axis", text: "Press the THROTTLE pedal fully" },
            { id: "brake", kind: "axis", text: "Press the BRAKE pedal fully" },
            { id: "clutch", kind: "axis", optional: true, text: "Press the CLUTCH pedal fully" },
            { id: "shiftUp", kind: "button", optional: true, text: "Press SHIFT UP (paddle or button)" },
            { id: "shiftDown", kind: "button", optional: true, text: "Press SHIFT DOWN (paddle or button)" },
            { id: "hshifter", kind: "confirm", text: "Do you have an H-pattern shifter?" }
        ];
        for(var g = 0; g < car.gear_ratios.length; g++) {
            steps.push({ id: "gear" + g, gear: g, kind: "button", hshifter: true, optional: true, text: "Put the shifter in gear " + (g + 1) });
        }
        steps.push({ id: "reverse", kind: "button", hshifter: true, optional: true, text: "Put the shifter in REVERSE" });
        return steps;
    }

    function startCalibration(car, partial) {
        var pad = partial ? partial.pad : findCalibrationPad();
        if(!car || !pad) {
            showMessage("No wheel found. Connect it and press a button on it first.", 4000);
            return;
        }
        calibration = {
            padIndex: pad.index,
            steps: partial ? partial.steps : buildSteps(car),
            step: 0,
            profile: partial ? partial.profile : { gears: {} },
            usedAxes: [],
            usedButtons: [],
            baseline: [],
            prevAxes: [],
            lastMove: [],
            ignored: [],
            quietSince: Date.now(),
            waiting: false,
            baselineReady: false,
            lastDetected: "",
            prevButtons: [],
            detect: null,
            stepStart: Date.now()
        };
        if(partial) {
            // inputs that are not measured again keep their axes and buttons
            var redone = partial.steps.map(function(step) { return step.id; });
            var keep = partial.profile;
            ["throttle", "brake", "clutch", "steer"].forEach(function(name) {
                var skipped = name === "steer" ? redone.indexOf("steerLeft") >= 0 : redone.indexOf(name) >= 0;
                if(keep[name] && !skipped && calibration.usedAxes.indexOf(keep[name].axis) < 0 && name !== "steer") calibration.usedAxes.push(keep[name].axis);
                if(keep[name] && !skipped && name === "steer") calibration.usedAxes.push(keep[name].axis);
            });
        }
        showStep();
    }

    function cancelCalibration(message) {
        calibration = null;
        showMessage(message, 3000);
    }

    function showStep() {
        var step = calibration.steps[calibration.step];
        var hint = "";
        if(step.kind === "confirm") hint = "   [Y] yes  [N] no";
        else if(step.optional) hint = "   [N] skip";
        calibration.text = "Wheel calibration (" + (calibration.step + 1) + "/" + calibration.steps.length + "): " +
            step.text + hint + "   [Esc] cancel";
        showMessage(calibration.text);
    }

    // Shows the live input values below the instructions, to help diagnose odd wheel layouts.
    function showLiveValues(pad) {
        var axes = [];
        for(var i = 0; i < pad.axes.length; i++) axes.push(i + ":" + pad.axes[i].toFixed(2));
        var pressed = [];
        for(var b = 0; b < pad.buttons.length; b++) {
            if(isPressed(pad, b)) pressed.push(b);
        }
        overlay.textContent = calibration.text + (calibration.waiting ? "\n(keep the wheel and pedals still...)" : "") +
            "\naxes " + axes.join("  ") + "\nbuttons " + (pressed.join(",") || "-") +
            (calibration.lastDetected ? "\nlast: " + calibration.lastDetected : "");
    }

    function nextStep(skipHShifter) {
        calibration.step++;
        calibration.detect = null;
        calibration.stepStart = Date.now();
        calibration.quietSince = calibration.stepStart;
        // axes that were noisy in an earlier step may be the next pedal: look at them again
        calibration.ignored = [];
        calibration.moveFrames = [];
        calibration.frames = 0;
        calibration.baselineReady = false;
        calibration.waiting = false;
        while(skipHShifter && calibration.step < calibration.steps.length && calibration.steps[calibration.step].hshifter) {
            calibration.step++;
        }
        if(calibration.step >= calibration.steps.length) {
            finishCalibration();
        } else {
            showStep();
        }
    }

    function finishCalibration() {
        var pad = getPads()[calibration.padIndex];
        if(pad) {
            // Some pedals only report their real resting value after they have been pressed once.
            // The pedals are released now, so correct a rest value that lies on the pressed side.
            var names = ["throttle", "brake", "clutch"];
            for(var n = 0; n < names.length; n++) {
                var b = calibration.profile[names[n]];
                var raw = b ? pad.axes[b.axis] : undefined;
                if(b && raw !== undefined && Math.abs(raw - b.rest) > 0.3 && (raw - b.rest) * (b.full - b.rest) <= 0) {
                    b.rest = raw;
                }
            }
            saveProfile(pad.id, calibration.profile, pad);
            zeroed[pad.id] = true;
        }
        calibration = null;
        showMessage("Wheel calibrated and saved.", 3000);
    }

    // Stores the value measured by an axis step in the profile being built.
    function commitAxis(step, detect) {
        var profile = calibration.profile;
        if(step.id === "steerLeft") {
            profile.steer = { axis: detect.axis, rest: detect.rest, left: detect.extreme, right: detect.extreme };
        } else if(step.id === "steerRight") {
            profile.steer.right = detect.extreme;
        } else {
            profile[step.id] = { axis: detect.axis, rest: detect.rest, full: detect.extreme };
        }
        if(calibration.usedAxes.indexOf(detect.axis) < 0) calibration.usedAxes.push(detect.axis);
        // steering, throttle and brake are enough to drive: keep them already, in case the rest of the
        // calibration is not finished (a finished calibration replaces this)
        var calPad = getPads()[calibration.padIndex];
        if(step.id === "brake" && calPad && !loadProfile(calPad.id, calPad)) {
            saveProfile(calPad.id, JSON.parse(JSON.stringify(calibration.profile)), calPad);
        }
        calibration.lastDetected = step.id + " = axis " + detect.axis + " (rest " + detect.rest.toFixed(2) +
            ", end " + detect.extreme.toFixed(2) + ")";
    }

    function commitButton(step, index) {
        var profile = calibration.profile;
        if(step.gear !== undefined) {
            profile.gears[step.gear] = index;
        } else if(step.id === "reverse") {
            profile.reverseGear = index;
        } else {
            profile[step.id] = index;
        }
        calibration.usedButtons.push(index);
    }

    function findPedalOnAxis(profile, axis) {
        var names = ["throttle", "brake", "clutch"];
        for(var i = 0; i < names.length; i++) {
            if(profile[names[i]] && profile[names[i]].axis === axis) return profile[names[i]];
        }
        return null;
    }

    function calibrateAxisStep(pad, step) {
        var c = calibration;
        var now = Date.now();
        var axes = Array.prototype.slice.call(pad.axes);
        var i;

        // Track an axis that started moving until it has been held still, so that the
        // measured extreme is the real end of its travel and not a point along the way.
        if(c.detect) {
            var d = c.detect;
            var v = axes[d.axis];
            if(Math.abs(v - d.rest) > Math.abs(d.extreme - d.rest)) d.extreme = v;
            if(Math.abs(v - d.lastValue) > STABLE_DELTA) {
                d.lastValue = v;
                d.stableSince = now;
            }
            if(now - d.stableSince > HOLD_MS || now - d.start > MAX_HOLD_MS) {
                if(Math.abs(v - d.rest) >= DETECT_DELTA) {
                    commitAxis(step, d);
                    nextStep(false);
                } else {
                    // The axis went back to rest: it was a spike, not the requested input
                    c.detect = null;
                    c.baselineReady = false;
                    c.quietSince = now;
                }
            }
            return;
        }

        if(step.id === "steerRight") {
            // The steering axis must move away from the left extreme, past the centre
            // measured when the wheel was released at the start of the left step
            var steer = c.profile.steer;
            var centre = steer.rest;
            var v2 = axes[steer.axis];
            if((v2 - centre) * (steer.left - centre) < 0 && Math.abs(v2 - centre) > Math.abs(steer.left - centre) / 2) {
                c.detect = { axis: steer.axis, rest: centre, extreme: v2, lastValue: v2, start: now, stableSince: now };
            }
            return;
        }

        // Read the resting values only once the whole device is quiet. This skips axes
        // that are still moving from the previous step (a released pedal or wheel).
        // Once the resting values are known they stay fixed, so that later movement is detected.
        if(!c.baselineReady) {
            var moved = false;
            c.frames = (c.frames || 0) + 1;
            c.moveFrames = c.moveFrames || [];
            for(i = 0; i < axes.length; i++) {
                if(c.ignored[i]) continue;
                if(c.prevAxes[i] === undefined || Math.abs(axes[i] - c.prevAxes[i]) > QUIET_DELTA) {
                    moved = true;
                    c.lastMove[i] = now;
                    c.moveFrames[i] = (c.moveFrames[i] || 0) + 1;
                }
            }
            c.prevAxes = axes;
            if(moved) c.quietSince = now;
            var quiet = now - c.quietSince >= SETTLE_MS;
            c.waiting = !quiet && now - c.stepStart < MAX_SETTLE_MS;
            c.baseline = axes;
            if(c.waiting) return;
            if(!quiet) {
                // The device never settled: ignore the axes that keep moving on their own (noise)
                // (only the axes that moved all the time: a pedal that was touched on the way is not noise)
                for(i = 0; i < axes.length; i++) {
                    if((c.moveFrames[i] || 0) > NOISE_SHARE * c.frames) c.ignored[i] = true;
                }
            }
            c.baselineReady = true;
            return;
        }

        var best = -1;
        var bestDelta = DETECT_DELTA;
        var bestRest = 0;
        for(i = 0; i < axes.length; i++) {
            // Skip axes outside the normal range, such as the hat switch on some devices
            if(c.ignored[i] || Math.abs(c.baseline[i]) > 1.05 || Math.abs(axes[i]) > 1.05) continue;
            var rest = c.baseline[i];
            if(c.usedAxes.indexOf(i) >= 0) {
                // Some wheels report throttle and brake on one combined axis. Allow a pedal to share
                // the axis of another pedal when it moves the opposite way from that pedal's rest value.
                var other = findPedalOnAxis(c.profile, i);
                if(!other) continue;
                rest = other.rest;
                if((axes[i] - rest) * (other.full - other.rest) >= 0) continue;
            }
            var delta = Math.abs(axes[i] - rest);
            if(delta > bestDelta) {
                bestDelta = delta;
                best = i;
                bestRest = rest;
            }
        }
        if(best >= 0) {
            c.detect = { axis: best, rest: bestRest, extreme: axes[best], lastValue: axes[best], start: now, stableSince: now };
        }
    }

    function calibrateButtonStep(pad, step) {
        var c = calibration;
        for(var i = 0; i < pad.buttons.length; i++) {
            if(isPressed(pad, i) && !c.prevButtons[i] && c.usedButtons.indexOf(i) < 0) {
                commitButton(step, i);
                nextStep(false);
                return;
            }
        }
    }

    function calibrationFrame(pad) {
        var step = calibration.steps[calibration.step];
        if(step.kind === "axis") calibrateAxisStep(pad, step);
        else if(step.kind === "button") calibrateButtonStep(pad, step);

        if(calibration) {
            for(var i = 0; i < pad.buttons.length; i++) {
                calibration.prevButtons[i] = isPressed(pad, i);
            }
            showLiveValues(pad);
        }
    }

    window.addEventListener("keydown", function(event) {
        if(!calibration) return;
        var key = event.key ? event.key.toLowerCase() : "";
        var step = calibration.steps[calibration.step];
        if(key === "escape") {
            cancelCalibration("Wheel calibration cancelled.");
        } else if(step.kind === "confirm") {
            if(key === "y") nextStep(false);
            else if(key === "n") nextStep(true);
        } else if(key === "n" && step.optional) {
            nextStep(false);
        }
    }, false);

    function toggle() {
        enabled = !enabled;
        showMessage(enabled ? "Wheel input on." : "Wheel input off (keyboard only).", 3000);
    }

    // What is known about the wheel, for the settings menu
    function statusText() {
        var pad = findWheel();
        if(!pad) return "No wheel found. Connect it and press a button on it, so the browser shows it.";
        var profile = loadProfile(pad.id, pad);
        if(!profile) return "Wheel found: " + pad.id + ". Not calibrated yet.";
        var known = ["steer", "throttle", "brake", "clutch"].filter(function(name) { return profile[name]; });
        return "Wheel: " + pad.id + ". Calibration saved in this browser (" + known.join(", ") + ").";
    }

    // Text about what an action of the wheel is set to (axis or button), or null if it is not set
    function describe(name) {
        var pad = findWheel();
        var profile = pad ? loadProfile(pad.id, pad) : null;
        if(!profile) return null;
        if(name === "steer" || name === "throttle" || name === "brake" || name === "clutch") {
            return profile[name] ? "Axis " + profile[name].axis : null;
        }
        if(name === "reverseGear") return profile.reverseGear !== undefined ? "Button " + profile.reverseGear : null;
        if(/^gear[0-9]+$/.test(name)) {
            var g = parseInt(name.substring(4), 10);
            return profile.gears && profile.gears[g] !== undefined ? "Button " + profile.gears[g] : null;
        }
        return profile[name] !== undefined ? "Button " + profile[name] : null;
    }

    // Forgets what the wheel is set to for an action
    function clear(name) {
        var pad = findWheel();
        var profile = pad ? loadProfile(pad.id, pad) : null;
        if(!profile) return;
        if(/^gear[0-9]+$/.test(name)) delete profile.gears[parseInt(name.substring(4), 10)];
        else delete profile[name];
        saveProfile(pad.id, profile, pad);
    }

    // Measures only some of the inputs of the wheel again (the calibration steps with these ids)
    function recalibrate(stepIds) {
        var car = window.car;
        var pad = findWheel();
        if(!car || !pad) {
            showMessage("No wheel found. Connect it and press a button on it first.", 4000);
            return;
        }
        var existing = loadProfile(pad.id, pad) || { gears: {} };
        var steps = buildSteps(car).filter(function(step) { return stepIds.indexOf(step.id) >= 0; });
        // a single step can always be skipped, to leave the input as it was
        steps.forEach(function(step) { step.optional = true; step.hshifter = false; });
        startCalibration(car, { steps: steps, profile: JSON.parse(JSON.stringify(existing)), pad: pad });
    }

    // Driving

    // Switches the car back to its automatic gearbox and keyboard/mouse reverse.
    function release(car) {
        if(!wasActive) return;
        car.manualGearbox = false;
        car.neutral = false;
        car.clutch = 0;
        car.clutchPedalPresent = false;
        // a disconnected wheel must not leave the pedals it was holding pressed
        if(ownsThrottle) car.throttle = 0;
        if(ownsBrake) car.brakePedal = 0;
        ownsSteer = ownsThrottle = ownsBrake = false;
        shiftSource = null;
        lastStatus = "";
        if(reverseFromWheel) {
            car.reverse = false;
            reverseFromWheel = false;
        }
        wasActive = false;
    }

    function applyShifter(car, pad, profile) {
        var gears = profile.gears || {};
        var hasHShifter = Object.keys(gears).length > 0 || profile.reverseGear !== undefined;
        var sequential = profile.shiftUp !== undefined || profile.shiftDown !== undefined;

        if(!hasHShifter && !sequential) {
            car.manualGearbox = false;
            car.neutral = false;
            return;
        }
        car.manualGearbox = true;

        var up = profile.shiftUp !== undefined && isPressed(pad, profile.shiftUp) && !lastButtons[profile.shiftUp];
        var down = profile.shiftDown !== undefined && isPressed(pad, profile.shiftDown) && !lastButtons[profile.shiftDown];

        // With both an H-pattern shifter and paddles mapped, the most recent action decides which
        // one selects the gear: moving the shifter into a gear, or pulling a paddle.
        var hMoved = false;
        var hButtons = [];
        for(var h = 0; h < car.gear_ratios.length; h++) {
            if(gears[h] !== undefined) hButtons.push(gears[h]);
        }
        if(profile.reverseGear !== undefined) hButtons.push(profile.reverseGear);
        for(var hb = 0; hb < hButtons.length; hb++) {
            if(isPressed(pad, hButtons[hb]) && !lastButtons[hButtons[hb]]) hMoved = true;
        }
        if(!hasHShifter) shiftSource = "sequential";
        else if(!sequential) shiftSource = "h";
        else if(up || down) shiftSource = "sequential";
        else if(hMoved || shiftSource === null) shiftSource = "h";

        if(shiftSource === "h") {
            // The gear is whatever the shifter currently holds; nothing held means neutral
            var gear = -1;
            for(var g = 0; g < car.gear_ratios.length; g++) {
                if(gears[g] !== undefined && isPressed(pad, gears[g])) gear = g;
            }
            var reverse = profile.reverseGear !== undefined && isPressed(pad, profile.reverseGear);
            car.reverse = reverse;
            reverseFromWheel = true;
            car.neutral = !reverse && gear < 0;
            if(gear >= 0) car.current_gear = gear;
        } else {
            car.neutral = false;
            if(up) {
                if(car.reverse) {
                    car.reverse = false;
                    car.current_gear = 0;
                } else if(car.current_gear < car.gear_ratios.length - 1) {
                    car.current_gear++;
                }
            } else if(down) {
                if(car.current_gear > 0 && !car.reverse) {
                    car.current_gear--;
                } else if(Math.abs(car.wheels[3].forwardMPH) < REVERSE_MAX_MPH) {
                    car.reverse = true;
                    reverseFromWheel = true;
                }
            }
        }
    }

    // Reads the wheel and updates the car's controls. Returns true while a wheel
    // is in control, so that other gamepad handling can be skipped.
    function update(car) {
        if(calibration) {
            var calPad = getPads()[calibration.padIndex];
            if(!calPad || !calPad.connected) {
                cancelCalibration("Wheel disconnected, calibration cancelled.");
            } else {
                calibrationFrame(calPad);
            }
            if(calibration) {
                car.throttle = 0;
                car.brakePedal = 0;
                return true;
            }
        }

        if(!enabled) {
            release(car);
            return false;
        }

        var pad = findWheel();
        if(!pad) {
            release(car);
            return false;
        }

        var profile = loadProfile(pad.id, pad);
        if(!profile) {
            if(!hinted[pad.id]) {
                hinted[pad.id] = true;
                showMessage("Wheel or controller detected. Open the settings menu (Esc) to set it up.", 10000);
            }
            release(car);
            return false;
        }

        if(!zeroed[pad.id]) {
            zeroed[pad.id] = true;
            verifyRestValues(pad, profile);
        }

        wasActive = true;
        var steer = readSteering(pad, profile.steer);
        var throttle = readPedal(pad, profile.throttle);
        var brake = readPedal(pad, profile.brake);
        car.clutch = profile.clutch ? readPedal(pad, profile.clutch) : 0;
        // without a clutch pedal the car works the clutch itself
        car.clutchPedalPresent = !!profile.clutch;

        // Only override an input while the wheel is using it (and once more when it is released).
        // The wheel turns the front wheels over its whole calibrated range (a 900 degree wheel gives full
        // lock at 450 degrees), or over a smaller part of it with the steering range of the settings menu.
        if(Math.abs(steer) > STEER_DEAD_ZONE || ownsSteer) {
            if(Math.abs(steer) > STEER_DEAD_ZONE) {
                var range = Settings.option("wheelRange") || 1;
                car.turnAngle = car.maxTurn * clamp(steer / range, -1, 1);
                ownsSteer = true;
            } else {
                // back in the middle: straight ahead, not the last small angle that was above the dead zone
                car.turnAngle = 0;
                ownsSteer = false;
            }
        }
        if(throttle > 0 || ownsThrottle) {
            car.throttle = throttle;
            ownsThrottle = throttle > 0;
        }
        if(brake > 0 || ownsBrake) {
            car.brakePedal = brake;
            ownsBrake = brake > 0;
        }
        lastStatus = "Wheel: steer " + steer.toFixed(2) + " | throttle " + throttle.toFixed(2) + " | brake " + brake.toFixed(2) +
            " | clutch " + car.clutch.toFixed(2) + " | axes " + Array.prototype.map.call(pad.axes, function(v, i) { return i + ":" + v.toFixed(2); }).join(" ");
        applyShifter(car, pad, profile);

        for(var i = 0; i < pad.buttons.length; i++) {
            lastButtons[i] = isPressed(pad, i);
        }
        // report the wheel as in control only while it overrides something, so the car's own
        // steering return and the keyboard behave normally when the wheel is idle
        return ownsSteer || ownsThrottle || ownsBrake;
    }

    // A pedal that reads as pressed the first time the profile is used (before the driver has
    // touched anything) has a wrong stored rest value; use the current reading as rest instead.
    function verifyRestValues(pad, profile) {
        var names = ["throttle", "brake", "clutch"];
        for(var n = 0; n < names.length; n++) {
            var b = profile[names[n]];
            if(!b) continue;
            var raw = pad.axes[b.axis];
            if(raw !== undefined && readPedal(pad, b) > 0.5 && Math.abs(b.full - raw) > 0.3) {
                console.warn("WheelControls: " + names[n] + " reads pressed at start, using " + raw + " as its rest value");
                b.rest = raw;
            }
        }
    }

    return {
        status: function() { return enabled ? lastStatus : "Wheel input off"; },
        update: update,
        startCalibration: function(car) { startCalibration(car); },
        recalibrate: recalibrate,
        describe: describe,
        clear: clear,
        toggle: toggle,
        statusText: statusText,
        findWheel: findWheel,
        isCalibrating: function() { return !!calibration; }
    };
})();
