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
    var SETTLE_MS = 500;       // time to read resting axis values at the start of a calibration step
    var HOLD_MS = 600;         // time to measure the extreme value after movement is detected
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
                "z-index: 1001; padding: 10px 20px; background: rgba(0, 0, 0, 0.75); color: #ffffff; " +
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
            steps.push({ id: "gear" + g, gear: g, kind: "button", hshifter: true, text: "Put the shifter in gear " + (g + 1) });
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
        showMessage("Wheel calibration (" + (calibration.step + 1) + "/" + calibration.steps.length + "): " +
            step.text + hint + "   [Esc] cancel");
    }

    function nextStep(skipHShifter) {
        calibration.step++;
        calibration.detect = null;
        calibration.stepStart = Date.now();
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
        if(pad) saveProfile(pad.id, calibration.profile);
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

    function calibrateAxisStep(pad, step) {
        var c = calibration;
        var now = Date.now();
        var axes = Array.prototype.slice.call(pad.axes);

        // Keep reading resting values while the device settles
        if(now - c.stepStart < SETTLE_MS) {
            c.baseline = axes;
            return;
        }

        if(c.detect) {
            var d = c.detect;
            var v = axes[d.axis];
            if(Math.abs(v - d.rest) > Math.abs(d.extreme - d.rest)) d.extreme = v;
            if(now - d.start > HOLD_MS) {
                commitAxis(step, d);
                nextStep(false);
            }
            return;
        }

        var best = -1;
        var bestDelta = DETECT_DELTA;
        if(step.id === "steerRight") {
            // The steering axis must move away from the left extreme, past the centre
            // measured when the wheel was released at the start of the left step
            var steer = c.profile.steer;
            var centre = steer.rest;
            var v2 = axes[steer.axis];
            if((v2 - centre) * (steer.left - centre) < 0 && Math.abs(v2 - centre) > Math.abs(steer.left - centre) / 2) {
                c.detect = { axis: steer.axis, rest: centre, extreme: v2, start: now };
            }
            return;
        }
        for(var i = 0; i < axes.length; i++) {
            if(c.usedAxes.indexOf(i) >= 0) continue;
            var delta = Math.abs(axes[i] - c.baseline[i]);
            if(delta > bestDelta) {
                bestDelta = delta;
                best = i;
            }
        }
        if(best >= 0) {
            c.detect = { axis: best, rest: c.baseline[best], extreme: axes[best], start: now };
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
        }
    }

    window.addEventListener("keydown", function(event) {
        var key = event.key ? event.key.toLowerCase() : "";
        if(!calibration) {
            if(key === "k") startCalibration(window.car);
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
        // the wheel owned the pedals, so a disconnected wheel must not leave them pressed
        car.throttle = 0;
        car.brakePedal = 0;
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

        if(hasHShifter) {
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
            var up = profile.shiftUp !== undefined && isPressed(pad, profile.shiftUp) && !lastButtons[profile.shiftUp];
            var down = profile.shiftDown !== undefined && isPressed(pad, profile.shiftDown) && !lastButtons[profile.shiftDown];
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

        wasActive = true;
        car.turnAngle = car.maxTurn * clamp(readSteering(pad, profile.steer) / STEER_RATIO, -1, 1);
        car.throttle = readPedal(pad, profile.throttle);
        car.brakePedal = readPedal(pad, profile.brake);
        car.clutch = profile.clutch ? readPedal(pad, profile.clutch) : 0;
        applyShifter(car, pad, profile);

        for(var i = 0; i < pad.buttons.length; i++) {
            lastButtons[i] = isPressed(pad, i);
        }
        return true;
    }

    return {
        update: update,
        startCalibration: startCalibration
    };
})();
