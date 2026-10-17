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

    var DEAD_ZONE = 0.03;      // ignore tiny pedal movements
    var STEER_RATIO = 0.5;     // fraction of the wheel's range that gives full lock on the car
    var SETTLE_MS = 500;       // the device must be quiet this long before resting values are read
    var MAX_SETTLE_MS = 4000;  // give up waiting for a quiet device (noisy axes) after this long
    var QUIET_DELTA = 0.02;    // axis changes below this count as quiet
    var HOLD_MS = 600;         // an axis must be held still this long before its extreme is accepted
    var MAX_HOLD_MS = 4000;    // accept the extreme after this long even if the axis keeps jittering
    var STABLE_DELTA = 0.05;   // axis changes below this count as holding still
    var DETECT_DELTA = 0.5;    // minimal axis movement to count as input during calibration
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

    function loadProfile(id) {
        if(profiles[id] !== undefined) return profiles[id];
        var profile = null;
        try {
            var stored = window.localStorage.getItem(STORAGE_PREFIX + id);
            if(stored) profile = JSON.parse(stored);
        } catch(e) {
            profile = null;
        }
        profiles[id] = profile;
        return profile;
    }

    function saveProfile(id, profile) {
        profiles[id] = profile;
        try {
            window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(profile));
        } catch(e) {
            console.log("Could not store wheel profile: " + e);
        }
    }

    // Returns the connected pad that should be treated as a racing wheel.
    function findWheel() {
        var pads = getPads();
        var i;
        for(i = 0; i < pads.length; i++) {
            if(pads[i] && pads[i].connected && loadProfile(pads[i].id)) return pads[i];
        }
        for(i = 0; i < pads.length; i++) {
            if(pads[i] && pads[i].connected && (pads[i].mapping !== "standard" || KNOWN_WHEELS.test(pads[i].id))) return pads[i];
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

    function startCalibration(car) {
        var pad = findCalibrationPad();
        if(!car || !pad) {
            showMessage("No wheel found. Connect it and press a button on it first.", 4000);
            return;
        }
        calibration = {
            padIndex: pad.index,
            steps: buildSteps(car),
            step: 0,
            profile: { gears: {} },
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
            saveProfile(pad.id, calibration.profile);
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
            for(i = 0; i < axes.length; i++) {
                if(c.ignored[i]) continue;
                if(c.prevAxes[i] === undefined || Math.abs(axes[i] - c.prevAxes[i]) > QUIET_DELTA) {
                    moved = true;
                    c.lastMove[i] = now;
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
                for(i = 0; i < axes.length; i++) {
                    if(now - c.lastMove[i] < SETTLE_MS) c.ignored[i] = true;
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
        var key = event.key ? event.key.toLowerCase() : "";
        if(!calibration) {
            if(key === "k") startCalibration(window.car);
            else if(key === "m") {
                enabled = !enabled;
                showMessage(enabled ? "Wheel input on." : "Wheel input off (keyboard only). Press M to turn it on.", 3000);
            }
            return;
        }
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

    // Driving

    // Switches the car back to its automatic gearbox and keyboard/mouse reverse.
    function release(car) {
        if(!wasActive) return;
        car.manualGearbox = false;
        car.neutral = false;
        car.clutch = 0;
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

        var profile = loadProfile(pad.id);
        if(!profile) {
            if(!hinted[pad.id]) {
                hinted[pad.id] = true;
                showMessage("Wheel or controller detected. Press K to calibrate it.", 10000);
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

        // Only override an input while the wheel is using it (and once more when it is released)
        if(Math.abs(steer) > 0.03 || ownsSteer) {
            car.turnAngle = car.maxTurn * clamp(steer / STEER_RATIO, -1, 1);
            ownsSteer = Math.abs(steer) > 0.03;
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
        status: function() { return enabled ? lastStatus : "Wheel input off (press M)"; },
        update: update,
        startCalibration: startCalibration
    };
})();
