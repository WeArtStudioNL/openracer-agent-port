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
 * Hud.js
 *
 * Description: What is shown on top of the game:
 *   - bottom right: a round gauge with the engine speed (the ring, with a red zone at the rev limit and a shift light),
 *     the speed, the gear (P R N D and the gear of the automatic, or the gear of the sequential and manual gearbox) and
 *     the oil temperature (left) and the coolant temperature (right) on the two sides, each with its icon, with the indicators of ABS and traction control below:
 *     red is off, green is on, yellow is working.
 *   - top left: the lap, the time of the lap that is going and the last laps.
 *   - bottom left: hints (the sound that still has to be switched on by a key press).
 *   The HUD can be switched off (settings menu or a key), the units are metric or imperial (settings menu), and the
 *   text with the technical details (debug text) is a separate option.
 */

var Hud = (function() {
    var container = null;
    var canvas = null;
    var context = null;
    var lapPanel = null;
    var hintBar = null;
    var pillStates = {};     // the state of every light: off, on, active, park
    var lightRects = [];     // where the lights are on the gauge canvas (for a tap on a touch screen)
    var LIGHT_ACTION = { TC: "toggleTC", LC: "toggleLaunch", ESC: "toggleESC", ABS: "toggleABS", "2S": "toggleTwoStep" };
    // the badges of the systems (web/images/HUD): orange when the system is on, grey when it is switched off (TC has its own off badge), blinking while it works
    var BADGE_FILE = { TC: "tc", LC: "launch", ESC: "esc", ABS: "abs", "2S": "2step" };
    var badges = {};         // name -> { active, inactive, off } images
    // the oil and coolant temperature arcs of the gauge (degrees): the range of the arc, and the bands: cold below the first, normal to the second, warm to the third, then hot
    var OIL_RANGE = [40, 160], OIL_BANDS = [70, 130, 145], COOLANT_RANGE = [40, 140], COOLANT_BANDS = [70, 105, 118];
    function gaugeColour(t, bands) { return t < bands[0] ? "#6ab0ff" : (t <= bands[1] ? "#37d67a" : (t <= bands[2] ? "#ffb347" : "#ff5a4f")); }
    // the icons beside them, images/HUD/oil-idle.png, oil-warning.png, coolant-idle.png and coolant-warning.png
    var gaugeIcons = { oil: {}, coolant: {} };
    var size = 0;
    var ratio = 1;
    var flash = 0;
    var active = false;     // the HUD is only shown once there is a car

    var STATE_NAMES = { off: "off", on: "on", active: "working" };

    function addStyle() {
        var style = document.createElement("style");
        style.textContent =
            "#hud { position: fixed; right: 16px; bottom: 16px; z-index: 900; display: flex; align-items: flex-end; gap: 10px; pointer-events: none; font-family: Arial, sans-serif; }" +
            "#hud .pills { display: flex; flex-direction: column; gap: 7px; margin-bottom: 14px; }" +
            "#hud .pill { min-width: 62px; padding: 5px 10px; border-radius: 7px; font-size: 15px; font-weight: bold; letter-spacing: 1px; text-align: center; color: #fff;" +
            " border: 2px solid; background: rgba(15, 18, 22, 0.72); transition: background 0.12s, border-color 0.12s, color 0.12s; }" +
            "#hud canvas { pointer-events: auto; }" +
            "body.touch #hud canvas { touch-action: manipulation; }" +
            "#hud .pill.off { border-color: #d9372f; color: #ff6b62; box-shadow: 0 0 8px rgba(217, 55, 47, 0.35); }" +
            "#hud .pill.on { border-color: #2eb35a; color: #52e085; box-shadow: 0 0 8px rgba(46, 179, 90, 0.35); }" +
            "#hud .pill.active { border-color: #f5c518; background: rgba(245, 197, 24, 0.9); color: #1a1500; box-shadow: 0 0 14px rgba(245, 197, 24, 0.8); }" +
            "#hud .pill.park { border-color: #d9372f; background: rgba(217, 55, 47, 0.85); color: #fff; }" +
            "#hudLaps { position: fixed; left: 16px; top: 14px; z-index: 900; pointer-events: none; font-family: Arial, sans-serif; color: #fff; min-width: 190px; " +
            "background: rgba(14, 18, 24, 0.62); border-radius: 10px; padding: 9px 14px 10px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); }" +
            "#hudLaps .lap { font-size: 12px; letter-spacing: 2px; color: #9fb0c4; }" +
            "#hudLaps .time { font-size: 34px; font-weight: bold; font-variant-numeric: tabular-nums; line-height: 1.15; }" +
            "#hudLaps .last { font-size: 14px; font-variant-numeric: tabular-nums; color: #cfd8e3; margin-top: 3px; }" +
            "#hudLaps .last b { color: #7ee7a0; font-weight: bold; }" +
            "#hudLaps .keys { margin-top: 6px; font-size: 11px; color: #7f90a5; }" +
            "#hudHint { position: fixed; left: 16px; bottom: 14px; z-index: 900; pointer-events: none; font-family: Arial, sans-serif; font-size: 14px; color: #ffe08a; " +
            "text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); }" +
            "#hudCar { position: fixed; left: 16px; top: 150px; z-index: 900; pointer-events: none; font-family: Arial, sans-serif; color: #fff; width: 190px; " +
            "background: rgba(14, 18, 24, 0.62); border-radius: 10px; padding: 9px 14px 10px; font-size: 12px; display: none; }" +
            "#hudCar .row { display: flex; align-items: center; gap: 10px; }" +
            "#hudCar .tyres { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; width: 84px; }" +
            "#hudCar .tyre { height: 26px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.25); position: relative; font-size: 10px; text-align: center; line-height: 26px; font-variant-numeric: tabular-nums; }" +
            "#hudCar .tyre i { position: absolute; left: 0; bottom: 0; width: 100%; background: rgba(0, 0, 0, 0.55); border-radius: 0 0 4px 4px; }" +
            "#hudCar .tyre span { position: relative; }" +
            "#hudCar .fuel { flex: 1; }" +
            "#hudCar .bar { height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.15); overflow: hidden; margin-top: 3px; }" +
            "#hudCar .bar i { display: block; height: 100%; background: #5fb3ff; }" +
            "#hudCar .label { color: #9fb0c4; letter-spacing: 1px; font-size: 11px; }" +
            "#hudCar .pit { margin-top: 6px; font-weight: bold; color: #ffd04d; }" +
            // the pit stop of the player in the middle of the screen: what is done and the seconds that are left, then GO when the car is let go
            "#hudPit { position: fixed; left: 50%; top: 38%; transform: translate(-50%, -50%); z-index: 900; pointer-events: none; font-family: Arial, sans-serif; color: #fff; " +
            "text-align: center; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.85); display: none; }" +
            "#hudPit .what { font-size: 16px; letter-spacing: 3px; color: #ffd04d; font-weight: bold; }" +
            "#hudPit .count { font-size: 72px; font-weight: bold; font-variant-numeric: tabular-nums; line-height: 1.05; }" +
            "#hudPit .count.go { color: #7ee7a0; }";
        document.head.appendChild(style);
    }

    function build() {
        addStyle();
        container = document.createElement("div");
        container.id = "hud";
        // the badges of the systems (TC, LC, ESC, ABS, 2S; P and the transbrake while they hold) are drawn in the gauge: a click or a tap on one switches the aid, as the keys do
        canvas = document.createElement("canvas");
        Object.keys(gaugeIcons).forEach(function(n) {
            ["idle", "warning"].forEach(function(st) {
                var img = new Image();
                img.src = "images/HUD/" + n + "-" + st + ".png";
                img.onload = function() { gaugeIcons[n][st] = img; };
            });
        });
        Object.keys(BADGE_FILE).forEach(function(n) {
            var set = badges[n] = {};
            ["active", "inactive", "off"].forEach(function(st) {
                if(st === "off" && n !== "TC") return;
                var img = new Image();
                img.src = "images/HUD/" + BADGE_FILE[n] + "-" + st + ".png";
                img.onload = function() { set[st] = img; };
            });
        });
        function lightAt(e) {
            var rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
            var slack = document.body.classList.contains("touch") ? 0.5 : 0;       // (a finger is less exact than a mouse)
            for(var k = 0; k < lightRects.length; k++) {
                var r = lightRects[k];
                if(r.action && x >= r.x - r.w * slack * 0.3 && x <= r.x + r.w * (1 + slack * 0.3) && y >= r.y - r.h * slack && y <= r.y + r.h * (1 + slack)) return r;
            }
            return null;
        }
        canvas.addEventListener("pointerdown", function(e) {
            var r = lightAt(e);
            if(r) { e.preventDefault(); e.stopPropagation(); Settings.trigger(r.action); }
        });
        canvas.addEventListener("pointermove", function(e) { canvas.style.cursor = lightAt(e) ? "pointer" : ""; });
        container.appendChild(canvas);
        document.body.appendChild(container);
        context = canvas.getContext("2d");
        boostCanvas = document.createElement("canvas");
        boostCanvas.id = "hudBoost";
        boostCanvas.id = "hudBoost";
        boostCanvas.style.cssText = "position: fixed; bottom: 16px; z-index: 900; pointer-events: none; display: none;";
        document.body.appendChild(boostCanvas);
        boostContext = boostCanvas.getContext("2d");

        lapPanel = document.createElement("div");
        lapPanel.id = "hudLaps";
        document.body.appendChild(lapPanel);
        hintBar = document.createElement("div");
        hintBar.id = "hudHint";
        document.body.appendChild(hintBar);
        carPanel = document.createElement("div");
        carPanel.id = "hudCar";
        document.body.appendChild(carPanel);
        pitPanel = document.createElement("div");
        pitPanel.id = "hudPit";
        document.body.appendChild(pitPanel);
        applyOptions();
    }

    // the tyres (the temperature as the colour, the wear as the dark part) and the fuel, when the race has them (Vehicle.js, Pit.js)
    var boostCanvas = null, boostContext = null, boostPeak = 0, boostPeakTime = 0;
    var carPanel = null, carHtml = "", pitPanel = null, pitHtml = "", pitGoUntil = 0, pitWasActive = false;
    function tyreColour(temp) {
        // blue when cold, green in the window, red when hot
        if(temp < 70) { var c = Math.max(0, Math.min(1, (temp - 25) / 45)); return "rgb(" + Math.round(60 + 20 * c) + ", " + Math.round(120 + 70 * c) + ", " + Math.round(220 - 90 * c) + ")"; }
        if(temp <= 100) return "rgb(70, 190, 110)";
        var h = Math.max(0, Math.min(1, (temp - 100) / 40));
        return "rgb(" + Math.round(90 + 150 * h) + ", " + Math.round(190 - 130 * h) + ", " + Math.round(110 - 70 * h) + ")";
    }
    // the engine, when something is wrong with it (EngineDamage.js, vehicle.engineHealth): the heat, the oil and the coolant, and what it is doing; nothing when it is whole and cool
    function engineHealthRow(eh) {
        var hot = eh.temp > 104, trouble = hot || eh.coolant < 0.97 || eh.oil < 0.97 || eh.wear > 0.02 || eh.ignition > 0.02 || eh.gasket > 0.02 || eh.failed;
        if(!trouble) return "";
        var colour = eh.failed || eh.temp > 125 || eh.oil < 0.2 || eh.coolant < 0.2 ? "#ff6b62" : (hot || eh.oil < 0.5 || eh.coolant < 0.5 || eh.misfire > 0.2 ? "#ffb347" : "#e8d98a");
        var state = eh.failed ? "ENGINE FAILED" : (eh.temp > 118 ? "OVERHEATING" : (eh.gasket > 0.3 ? "HEAD GASKET" : (eh.misfire > 0.15 ? "MISFIRING" : (eh.wear > 0.5 ? "ENGINE WORN" : ""))));
        return "<div class=\"engine\" style=\"margin-top: 6px; color: " + colour + ";\"><div class=\"label\">ENGINE " + Math.round(eh.temp) + "° · OIL " + Math.round(eh.oil * 100) + "% · COOLANT " + Math.round(eh.coolant * 100) + "%" +
            (state ? " · " + state : "") + "</div></div>";
    }
    function updateCar(car) {
        var v = car.vehicle;
        var eh = v.engineHealth, engineRow = eh ? engineHealthRow(eh) : "";
        if(!v.wearEnabled && !engineRow) { if(carPanel.style.display !== "none") carPanel.style.display = "none"; return; }
        if(carPanel.style.display !== "block" && Settings.option("hud")) carPanel.style.display = "block";
        // (under the lap times as they grow: the panel stood at 150 px, and the lap times of the second lap and the best lap went under it. Not when one of them was
        // moved in the HUD editor, which places them from where they stand by default)
        // (no floor: on a phone the panel stands higher, TouchControls.js; moved in the HUD editor, it is placed from its own default, the style is let go)
        if(!carPanel.__hudLayout && !lapPanel.__hudLayout && lapPanel.offsetHeight > 0) { var under      /* (offsetHeight: a fixed element has no offsetParent) */ = (lapPanel.offsetTop + lapPanel.offsetHeight + 8) + "px"; if(carPanel.style.top !== under) carPanel.style.top = under; }
        else if(carPanel.style.top) carPanel.style.top = "";
        var order = [1, 0, 2, 3]; // FL FR / RL RR
        if(!v.wearEnabled) { if(engineRow !== carHtml) { carHtml = engineRow; carPanel.innerHTML = engineRow; } return; }       // (no tyres and fuel: only the engine, when it is hurt)
        var html = "<div class=\"row\"><div class=\"tyres\">";
        order.forEach(function(i) {
            var w = v.wheels[i];
            html += "<div class=\"tyre\" style=\"background: " + tyreColour(w.temp) + "\"><i style=\"height: " + Math.round(Math.min(1, w.wear) * 100) + "%\"></i><span>" + Math.round(w.temp) + "°</span></div>";
        });
        // the fuel in laps, when a lap has been driven (Car.js fuelPerLap): the warning at 12 % of the tank came with less than a lap left on a long track
        var lapsOfFuel = car.fuelPerLap > 0 ? v.fuel / car.fuelPerLap : null, lapsLeft = car.raceLaps ? car.raceLaps - car.lapsCompleted : Infinity;
        html += "</div><div class=\"fuel\"><div class=\"label\">FUEL " + v.fuel.toFixed(1) + " L" + (lapsOfFuel !== null ? " · " + lapsOfFuel.toFixed(1) + " laps" : "") + "</div><div class=\"bar\"><i style=\"width: " + Math.round(v.fuel / v.tank * 100) + "%\"></i></div>" +
            "<div class=\"label\" style=\"margin-top: 4px;\">TYRES " + Math.round((1 - Math.min(1, v.maxWear())) * 100) + "%</div></div></div>";
        var pit = car.pit;
        if(pit && pit.active) html += "<div class=\"pit\">PIT STOP " + pit.remaining().toFixed(1) + " s" + (pit.plan && pit.plan.repair > 0 ? " · repair" : "") + (pit.plan && pit.plan.tyres > 0 ? " · tyres" : "") + (pit.plan && pit.plan.fuel > 0 ? " · fuel" : "") + "</div>";
        else if(pit && pit.done) html += "<div class=\"pit\" style=\"color: #7ee7a0;\">PIT STOP DONE · go</div>";
        else if(v.fuel <= 0) html += "<div class=\"pit\" style=\"color: #ff6b62;\">OUT OF FUEL</div>";
        else {
            // (both reasons: worn tyres hid the fuel that was running out)
            var fuelLow = lapsOfFuel !== null ? lapsOfFuel < lapsLeft && lapsOfFuel < 1.5 : v.fuel < v.tank * 0.12;
            var reasons = (v.maxWear() > 0.8 ? ["tyres"] : []).concat(fuelLow ? ["fuel"] : []);
            if(reasons.length) html += "<div class=\"pit\"" + (flash ? "" : " style=\"opacity: 0.4\"") + ">PIT · " + reasons.join(" · ") + "</div>";
        }
        html += engineRow;
        if(html !== carHtml) { carHtml = html; carPanel.innerHTML = html; }
        updatePit(car);
    }
    // the countdown of the pit stop in the middle of the screen (the player's car is on the jacks, Car.js), and GO for a moment and a half when it is let go
    function updatePit(car) {
        var pit = car.pit, now = performance.now(), html = "";
        if(pit && pit.active) {
            var parts = [pit.plan && pit.plan.repair > 0 ? "REPAIR" : "", pit.plan && pit.plan.tyres > 0 ? "TYRES" : "", pit.plan && pit.plan.fuel > 0 ? "FUEL" : ""].filter(Boolean).join(" · ");
            html = "<div class=\"what\">PIT STOP" + (parts ? " · " + parts : "") + "</div><div class=\"count\">" + pit.remaining().toFixed(1) + "</div>";
        } else {
            if(pitWasActive && pit && pit.done) pitGoUntil = now + 1500;
            if(now < pitGoUntil) html = "<div class=\"what\">PIT STOP DONE</div><div class=\"count go\">GO</div>";
        }
        pitWasActive = !!(pit && pit.active);
        var show = html && Settings.option("hud") ? "block" : "none";
        if(pitPanel.style.display !== show) pitPanel.style.display = show;
        if(html !== pitHtml) { pitHtml = html; pitPanel.innerHTML = html; }
    }

    // the HUD and the debug text follow the options of the settings menu
    function applyOptions() {
        var visible = Settings.option("hud") && active ? "" : "none";
        container.style.display = visible;
        lapPanel.style.display = visible;
        hintBar.style.display = visible;
        if(visible === "none") carPanel.style.display = "none";
        var debug = document.getElementById("debugOut");
        if(debug) debug.style.display = Settings.option("debug") ? "" : "none";
    }

    function setPill(name, state) { pillStates[name] = state; }

    // the size of the gauge: one rule for resize and for the check in update (they had two, so on a phone the canvases were made again every frame)
    function gaugeSize() {
        var small = typeof OpenRacer !== "undefined" && OpenRacer.touchDevice && OpenRacer.touchDevice() && Math.min(window.innerWidth, window.innerHeight) < 600;      // a phone: a smaller gauge
        return Math.round(Math.max(small ? 130 : 210, Math.min(330, Math.min(window.innerWidth, window.innerHeight) * (small ? 0.3 : 0.36))));
    }
    function resize() {
        ratio = window.devicePixelRatio || 1;
        size = gaugeSize();
        canvas.style.width = size + "px";
        canvas.style.height = size + "px";
        canvas.width = Math.round(size * ratio);
        canvas.height = Math.round(size * ratio);
        var small = Math.round(size * 0.5);
        boostCanvas.style.width = small + "px";
        boostCanvas.style.height = small + "px";
        boostCanvas.width = Math.round(small * ratio);
        boostCanvas.height = Math.round(small * ratio);
        boostCanvas.style.right = (16 + Math.round(size * 0.77)) + "px";             // top left of the gauge, its ring against the ring of the gauge
        boostCanvas.style.bottom = (16 + Math.round(size * 0.72)) + "px";
    }

    function formatTime(seconds) {
        var minutes = Math.floor(seconds / 60);
        var rest = seconds - minutes * 60;
        return minutes + ":" + (rest < 10 ? "0" : "") + rest.toFixed(3);
    }

    // angle on the gauge (the canvas counts clockwise from the right): zero at the bottom left, full at the bottom right
    function angle(fraction) {
        return (135 + 270 * fraction) * Math.PI / 180;
    }

    function arc(cx, cy, radius, from, to, width, color, counter) {
        context.beginPath();
        context.arc(cx, cy, radius, from, to, !!counter);
        context.lineWidth = width;
        context.strokeStyle = color;
        context.stroke();
    }

    function drawGauge(car) {
        var s = size;
        var cx = s / 2, cy = s / 2, R = s / 2 - 3;
        var engine = car.engine;
        var limit = engine.limiterRPM;
        // the dial ends at the rev limit (the red zone runs to the end of the ring); the numbers are at the thousands below it
        var top = Math.floor(limit / 1000);
        var scale = limit;
        var rpm = Math.min(car.engineRPM, scale);
        var fraction = rpm / scale;

        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, s, s);
        context.lineCap = "butt";

        // the face
        var face = context.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
        face.addColorStop(0, "rgba(34, 40, 48, 0.82)");
        face.addColorStop(1, "rgba(14, 17, 22, 0.86)");
        context.beginPath();
        context.arc(cx, cy, R, 0, Math.PI * 2);
        context.fillStyle = face;
        context.fill();
        arc(cx, cy, R - 1, 0, Math.PI * 2, 2, "rgba(255, 255, 255, 0.22)");

        // the ring: the track, the red zone and the engine speed
        var ringRadius = R * 0.83, ringWidth = R * 0.13;
        arc(cx, cy, ringRadius, angle(0), angle(1), ringWidth, "rgba(255, 255, 255, 0.09)");
        arc(cx, cy, ringRadius, angle(Math.max(0, (limit - 900) / scale)), angle(limit / scale), ringWidth, "rgba(190, 36, 30, 0.62)");
        var shift = car.engineRPM > limit - 450;
        var barColor = car.engineRPM > limit - 150 ? (flash ? "#ff3b30" : "#ffb199") : (shift ? "#ff9f0a" : "#f5f7fa");
        if(fraction > 0.002) arc(cx, cy, ringRadius, angle(0), angle(fraction), ringWidth, barColor);
        if(shift) arc(cx, cy, R - 1, 0, Math.PI * 2, 3, "rgba(255, 159, 10, " + (car.engineRPM > limit - 150 && flash ? 0.95 : 0.55) + ")");

        // the ticks and the numbers
        context.fillStyle = "#e8edf3";
        context.font = "bold " + Math.round(R * 0.12) + "px Arial";
        context.textAlign = "center";
        context.textBaseline = "middle";
        for(var i = 0; i * 500 <= limit + 1; i++) {
            var f = i * 500 / scale;
            var a = angle(f);
            var major = i % 2 === 0;
            var inner = ringRadius - ringWidth / 2 - (major ? R * 0.06 : R * 0.03);
            var outer = ringRadius - ringWidth / 2 - 1;
            context.beginPath();
            context.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
            context.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
            context.lineWidth = major ? 2 : 1;
            context.strokeStyle = major ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.4)";
            context.stroke();
            if(major) {
                var label = ringRadius - ringWidth / 2 - R * 0.17;
                context.fillStyle = (i / 2) * 1000 >= limit - 900 ? "#ff8a80" : "#e8edf3";
                context.fillText(String(i / 2), cx + Math.cos(a) * label, cy + Math.sin(a) * label);
            }
        }

        // the oil temperature (left) and the coolant temperature (right) as small arcs, each with its icon beside it (EngineDamage.js, vehicle.engineHealth)
        var pedalRadius = R * 0.5;
        var pedalWidth = R * 0.07;
        var eh = car.vehicle.engineHealth;
        arc(cx, cy, pedalRadius, 135 * Math.PI / 180, 225 * Math.PI / 180, pedalWidth, "rgba(255, 255, 255, 0.1)");
        arc(cx, cy, pedalRadius, 45 * Math.PI / 180, -45 * Math.PI / 180, pedalWidth, "rgba(255, 255, 255, 0.1)", true);
        var oilWarn = false, coolantWarn = false;
        if(eh) {
            var oilFrac = Math.max(0, Math.min(1, (eh.oilTemp - OIL_RANGE[0]) / (OIL_RANGE[1] - OIL_RANGE[0])));
            var coolantFrac = Math.max(0, Math.min(1, (eh.temp - COOLANT_RANGE[0]) / (COOLANT_RANGE[1] - COOLANT_RANGE[0])));
            if(oilFrac > 0.01) arc(cx, cy, pedalRadius, 135 * Math.PI / 180, (135 + 90 * oilFrac) * Math.PI / 180, pedalWidth, gaugeColour(eh.oilTemp, OIL_BANDS));
            if(coolantFrac > 0.01) arc(cx, cy, pedalRadius, 45 * Math.PI / 180, (45 - 90 * coolantFrac) * Math.PI / 180, pedalWidth, gaugeColour(eh.temp, COOLANT_BANDS), true);
            oilWarn = eh.oilTemp > OIL_BANDS[2] || eh.oil < 0.3 || !!eh.failed;
            coolantWarn = eh.temp > COOLANT_BANDS[2] || eh.coolant < 0.3 || !!eh.failed;
        }
        // the icons: dim while all is well, bright (and blinking) with a warning; before the picture is there a short word stands in
        function gaugeIcon(name, warn, x, y, size) {
            var set = gaugeIcons[name], img = warn ? (blinkNow ? set.idle : (set.warning || set.idle)) : set.idle;
            if(img) { context.globalAlpha = warn ? 1 : 0.55; context.drawImage(img, x - size / 2, y - size / 2, size, size); context.globalAlpha = 1; }
            else {
                context.fillStyle = warn ? (blinkNow ? "#ffb347" : "#ff5a4f") : "rgba(255, 255, 255, 0.45)";
                context.font = "bold " + Math.round(size * 0.55) + "px Arial";
                context.fillText(name === "oil" ? "OIL" : "H2O", x, y);
            }
        }
        var blinkNow = Math.floor(Date.now() / 250) % 2 === 0;
        gaugeIcon("oil", oilWarn, cx - R * 0.37, cy + R * 0.02, R * 0.17);
        gaugeIcon("coolant", coolantWarn, cx + R * 0.37, cy + R * 0.02, R * 0.17);

        // the speed, the unit, the gear and the engine speed
        var metric = Settings.option("units") !== "imperial";
        var speed = Math.abs(car.vehicle.u) * (metric ? 3.6 : 2.2369362920544);
        context.fillStyle = "#ffffff";
        context.font = "bold " + Math.round(R * 0.4) + "px Arial";
        context.fillText(String(Math.round(speed)), cx, cy - R * 0.17);
        context.fillStyle = "#b8c2cf";
        context.font = "bold " + Math.round(R * 0.11) + "px Arial";
        context.fillText(metric ? "km/h" : "mph", cx, cy + R * 0.06);

        var stalled = !engine.running;
        var gear = car.gearLabel();
        context.fillStyle = stalled ? "#ff5a4f" : (gear.charAt(0) === "R" ? "#ffb340" : (gear.charAt(0) === "N" ? "#52e085" : (gear.charAt(0) === "P" ? "#ff6b62" : "#ffffff")));
        context.font = "bold " + Math.round(R * 0.26) + "px Arial";
        context.fillText(gear, cx, cy + R * 0.3);
        drawLights(context, cx, cy, R, stalled);
    }

    // the badges of the systems in the gauge: orange when the system is on, grey when it is switched off (TC has its own off badge), blinking while the system
    // is at work; only the systems the car has. Launch control and the two-step (words) stand one above
    // the other under the gear; TC, ESP and ABS (and P and TB while they hold, as text lights) stand on an arc along the bottom of the gauge.
    var LIGHT_STYLE = { off: ["#d9372f", "rgba(20, 24, 30, 0.6)", "#ff6b62"], on: ["#2eb35a", "rgba(20, 24, 30, 0.6)", "#52e085"], active: ["#f5c518", "rgba(245, 197, 24, 0.9)", "#1a1500"], park: ["#d9372f", "rgba(217, 55, 47, 0.85)", "#ffffff"] };
    function drawLights(c, cx, cy, R, stalled) {
        lightRects = [];
        var font = Math.round(R * 0.075);
        c.textAlign = "center"; c.textBaseline = "middle";
        // the picture of a badge in its state: orange when the system is on, grey when it is switched off (TC has its own off badge), and while the system
        // is at work (the computer steps in) it blinks between the two
        var blink = Math.floor(Date.now() / 125) % 2 === 0;
        function picture(n, x, y, w) {
            var state = pillStates[n], set = badges[n];
            var img = state === "off" ? (set.off || set.inactive) : (state === "active" && blink ? set.inactive : set.active);
            if(img) c.drawImage(img, x, y, w, w);
        }
        // launch control and the two-step, one above the other, where the gearbox mode used to be (ENGINE OFF takes their place while the engine is off)
        if(stalled) {
            c.fillStyle = "#ff5a4f"; c.font = Math.round(R * 0.095) + "px Arial";
            c.fillText("ENGINE OFF", cx, cy + R * 0.53);
        }
        else {
            var column = ["LC", "2S"].filter(function(n) { return pillStates[n]; }), wordW = R * 0.36, step = R * 0.1;
            var top = cy + R * 0.53 - step * (column.length - 1) / 2;
            column.forEach(function(n, i) {
                var yc = top + i * step;
                picture(n, cx - wordW / 2, yc - wordW / 2, wordW);
                lightRects.push({ x: cx - wordW / 2, y: yc - step / 2, w: wordW, h: step, action: LIGHT_ACTION[n] });
            });
        }
        // the arc: TC, ESP, ABS and the text lights, spread along the bottom of the gauge
        var arcNames = ["TC", "ESC", "ABS", "P", "TB"].filter(function(n) { return pillStates[n]; });
        var badge = R * 0.24, radius = R * 0.77, spread = 27 * Math.PI / 180, h = R * 0.13;      // (close enough together to stay clear of the pedal arcs)
        c.font = "bold " + font + "px Arial";
        arcNames.forEach(function(n, i) {
            var a = Math.PI / 2 + ((arcNames.length - 1) / 2 - i) * spread;          // (the first on the left)
            var xc = cx + Math.cos(a) * radius, yc = cy + Math.sin(a) * radius;
            if(badges[n]) {
                picture(n, xc - badge / 2, yc - badge / 2, badge);
                lightRects.push({ x: xc - badge / 2, y: yc - badge / 2, w: badge, h: badge, action: LIGHT_ACTION[n] });
                return;
            }
            var st = LIGHT_STYLE[pillStates[n]] || LIGHT_STYLE.off, w = Math.max(R * 0.2, c.measureText(n).width + R * 0.1), r = h * 0.3, x = xc - w / 2, y = yc - h / 2;
            c.beginPath();
            c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
            c.fillStyle = st[1]; c.fill();
            c.lineWidth = Math.max(1, R * 0.012); c.strokeStyle = st[0]; c.stroke();
            c.fillStyle = st[2];
            c.fillText(n, xc, yc + font * 0.05);
            lightRects.push({ x: x, y: y, w: w, h: h, action: LIGHT_ACTION[n] });
        });
        c.textBaseline = "alphabetic";
    }

    // The boost gauge (an extra of the tuning menu): the pressure of the manifold from the vacuum of a closed throttle (-1 bar) to the full boost, with a mark for the peak
    function drawBoost(car) {
        var engine = car.engine, x = engine.extras || {};
        var show = !!x.boost_gauge_on && engine.hasTurbo() && Settings.option("hud");
        boostCanvas.style.display = show ? "block" : "none";
        if(!show) return;
        var s = Math.round(size * 0.5), cx = s / 2, cy = s / 2, R = s / 2 - 2;
        var full = engine.turboBar > 0 ? engine.turboBar : (x.boost_full || 1), top = Math.max(0.5, x.boost_scale || 2, full * 1.15), low = -1;
        // the pressure: the boost, or the vacuum behind a throttle that is closed (less of it with boost)
        var value = engine.boost * full - (1 - Math.min(1, Math.max(0, car.throttle))) * 0.6 * (1 - engine.boost);
        var now = Date.now();
        if(value >= boostPeak) { boostPeak = value; boostPeakTime = now; }
        else if(now - boostPeakTime > 2500) boostPeak = value;               // the peak is kept for a while
        var fraction = function(p) { return Math.max(0, Math.min(1, (p - low) / (top - low))); };
        var c = boostContext;
        c.setTransform(ratio, 0, 0, ratio, 0, 0);
        c.clearRect(0, 0, s, s);
        var face = c.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
        face.addColorStop(0, "rgba(34, 40, 48, 0.82)");
        face.addColorStop(1, "rgba(14, 17, 22, 0.86)");
        c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fillStyle = face; c.fill();
        c.lineWidth = 2; c.strokeStyle = "rgba(255, 255, 255, 0.22)"; c.stroke();
        var ring = R * 0.8, width = R * 0.12;
        function ark(from, to, color) { c.beginPath(); c.arc(cx, cy, ring, angle(from), angle(to), false); c.lineWidth = width; c.strokeStyle = color; c.stroke(); }
        ark(0, 1, "rgba(255, 255, 255, 0.09)");
        ark(fraction(0), fraction(top), "rgba(46, 179, 90, 0.18)");
        ark(fraction(Math.max(0.1, full)), fraction(top), "rgba(190, 36, 30, 0.3)");
        if(value > 0.005) ark(fraction(0), fraction(value), value > full * 1.02 ? "#ff9f0a" : "#5fb3ff");
        else if(value < -0.005) ark(fraction(value), fraction(0), "#9aa7b8");
        // the peak
        var pa = angle(fraction(boostPeak));
        c.beginPath(); c.moveTo(cx + Math.cos(pa) * (ring - width * 0.7), cy + Math.sin(pa) * (ring - width * 0.7)); c.lineTo(cx + Math.cos(pa) * (ring + width * 0.7), cy + Math.sin(pa) * (ring + width * 0.7));
        c.lineWidth = 3; c.strokeStyle = "#ffd04d"; c.stroke();
        // the ticks and the numbers: every half bar, the whole bars are named
        c.textAlign = "center"; c.textBaseline = "middle"; c.font = "bold " + Math.round(R * 0.13) + "px Arial";
        for(var p = low; p <= top + 1e-6; p += 0.5) {
            var a = angle(fraction(p)), whole = Math.abs(p - Math.round(p)) < 1e-6;
            var inner = ring - width / 2 - (whole ? R * 0.07 : R * 0.035), outer = ring - width / 2 - 1;
            c.beginPath(); c.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner); c.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
            c.lineWidth = whole ? 2 : 1; c.strokeStyle = whole ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.4)"; c.stroke();
            if(whole) { c.fillStyle = "#e8edf3"; c.fillText(String(Math.round(p)), cx + Math.cos(a) * (ring - width / 2 - R * 0.2), cy + Math.sin(a) * (ring - width / 2 - R * 0.2)); }
        }
        // the value in the unit of the settings (bar, or psi)
        var metric = Settings.option("units") !== "imperial";
        c.fillStyle = "#ffffff"; c.font = "bold " + Math.round(R * 0.3) + "px Arial";
        c.fillText((metric ? value : value * 14.5038).toFixed(metric ? 2 : 1), cx, cy + R * 0.12);
        c.fillStyle = "#8fa0b4"; c.font = Math.round(R * 0.13) + "px Arial";
        c.fillText(metric ? "bar" : "psi", cx, cy + R * 0.42);
        if(engine.alsActive) { c.fillStyle = flash ? "#ffb340" : "#ff6b62"; c.font = "bold " + Math.round(R * 0.13) + "px Arial"; c.fillText("ANTI-LAG", cx, cy + R * 0.62); }
    }

    function updateLaps(car) {
        var lap = car.raceLaps ? (car.lapsCompleted >= car.raceLaps ? "FINISHED" : car.lapsCompleted + 1 === car.raceLaps ? "FINAL LAP" : "LAP " + (car.lapsCompleted + 1) + "/" + car.raceLaps) : "LAP " + (car.lapsCompleted + 1);
        var html = "<div class=\"lap\">" + lap + (car.raceCount > 1 ? " &nbsp;·&nbsp; P" + car.racePosition + "/" + car.raceCount : "") + "</div>";
        var current = car.lapStartTime !== undefined ? car.clock - car.lapStartTime : 0;
        if(typeof race !== "undefined" && race && (race.state === "waiting" || race.state === "flyby" || race.state === "countdown")) current = 0;      // (the time starts at GO)
        html += "<div class=\"time\">" + formatTime(Math.max(0, current)) + "</div>";
        // the gaps to the car ahead and the one behind (main.js), once a lap time is known
        if(car.raceCount > 1 && (car.gapAhead !== null && car.gapAhead !== undefined || car.gapBehind !== null && car.gapBehind !== undefined) && car.lapsCompleted < (car.raceLaps || Infinity)) {
            var gap = function(s) { return s >= 60 ? formatTime(s) : s.toFixed(1) + " s"; };
            html += "<div class=\"last\">" + (car.gapAhead != null ? "ahead " + gap(car.gapAhead) : "") + (car.gapAhead != null && car.gapBehind != null ? " &nbsp;·&nbsp; " : "") + (car.gapBehind != null ? "behind " + gap(car.gapBehind) : "") + "</div>";
        }
        var times = car.lapTimes;
        if(times.length) {
            var best = Math.min.apply(null, times);
            for(var i = times.length - 1, shown = 0; i >= 0 && shown < 3; i--, shown++) {
                var text = formatTime(times[i]);
                html += "<div class=\"last\">" + (i + 1) + ". " + (times[i] === best ? "<b>" + text + "</b>" : text) + "</div>";
            }
        }
        var best = car.ghost ? car.ghost.bestTime() : null;
        if(best) html += "<div class=\"last\">best " + formatTime(best) + (car.newRecord ? " <b>new record</b>" : "") + "</div>";
        html += "<div class=\"keys\">" + (typeof TouchControls !== "undefined" && TouchControls.enabled() ? "☰: settings and controls" : (typeof usingGamepad !== "undefined" && usingGamepad ? "Start" : "Esc") + ": pause, restart, settings and controls") + "</div>";
        if(lapPanel.innerHTML !== html) lapPanel.innerHTML = html;
    }

    function update(car) {
        if(!container) return;
        if(!active) {
            active = true;
            applyOptions();
        }
        if(!Settings.option("hud")) return;
        flash = Math.floor(Date.now() / 90) % 2;
        var v = car.vehicle;
        var absWorking = false, tcWorking = false;
        for(var i = 0; i < car.wheels.length; i++) {
            if(car.wheels[i].abs) absWorking = true;
            if(car.wheels[i].tc) tcWorking = true;
        }
        // (a system the car does not have has no light)
        setPill("ABS", !v.absFitted ? null : (!v.absEnabled ? "off" : (absWorking ? "active" : "on")));
        setPill("TC", !v.tcFitted ? null : (!v.tcEnabled ? "off" : (tcWorking ? "active" : "on")));
        setPill("ESC", !v.escFitted ? null : (!v.escEnabled ? "off" : (v.escLevel > 0.05 ? "active" : "on")));
        setPill("LC", !v.launchControlFitted ? null : (!v.launchControlEnabled ? "off" : (v.lcArmed || v.launching > 0 ? "active" : "on")));
        setPill("2S", !v.twoStepFitted ? null : (v.twoStepActive ? "active" : (!v.twoStepEnabled ? "off" : "on")));
        setPill("TB", v.transbrakeHeld ? "active" : null);
        setPill("P", car.parkingLock ? "park" : null);
        if(gaugeSize() !== size || (window.devicePixelRatio || 1) !== ratio) resize();
        drawGauge(car);
        drawBoost(car);
        updateLaps(car);
        updateCar(car);
        var hint = EngineSound.status();
        if(hintBar.textContent !== hint) hintBar.textContent = hint;
    }

    build();
    resize();
    window.addEventListener("resize", resize);
    Settings.onOptionChange(function(name) {
        if(name === "hud" || name === "debug") applyOptions();
    });

    return { update: update, formatTime: formatTime };
})();
