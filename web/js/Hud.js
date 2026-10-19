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
 *     the throttle and the brake on the two sides, with the indicators of ABS and traction control next to it:
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
    var pills = {};
    var pillStates = {};
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
            "#hudCar .pit { margin-top: 6px; font-weight: bold; color: #ffd04d; }";
        document.head.appendChild(style);
    }

    function build() {
        addStyle();
        container = document.createElement("div");
        container.id = "hud";
        var pillColumn = document.createElement("div");
        pillColumn.className = "pills";
        ["TC", "ESC", "ABS", "P"].forEach(function(name) {
            var pill = document.createElement("div");
            pill.className = "pill off";
            pill.textContent = name;
            pillColumn.appendChild(pill);
            pills[name] = pill;
        });
        pills.P.style.display = "none"; // only while the parking lock holds the car
        container.appendChild(pillColumn);
        canvas = document.createElement("canvas");
        container.appendChild(canvas);
        document.body.appendChild(container);
        context = canvas.getContext("2d");

        lapPanel = document.createElement("div");
        lapPanel.id = "hudLaps";
        document.body.appendChild(lapPanel);
        hintBar = document.createElement("div");
        hintBar.id = "hudHint";
        document.body.appendChild(hintBar);
        carPanel = document.createElement("div");
        carPanel.id = "hudCar";
        document.body.appendChild(carPanel);
        applyOptions();
    }

    // the tyres (the temperature as the colour, the wear as the dark part) and the fuel, when the race has them (Vehicle.js, Pit.js)
    var carPanel = null, carHtml = "";
    function tyreColour(temp) {
        // blue when cold, green in the window, red when hot
        if(temp < 70) { var c = Math.max(0, Math.min(1, (temp - 25) / 45)); return "rgb(" + Math.round(60 + 20 * c) + ", " + Math.round(120 + 70 * c) + ", " + Math.round(220 - 90 * c) + ")"; }
        if(temp <= 100) return "rgb(70, 190, 110)";
        var h = Math.max(0, Math.min(1, (temp - 100) / 40));
        return "rgb(" + Math.round(90 + 150 * h) + ", " + Math.round(190 - 130 * h) + ", " + Math.round(110 - 70 * h) + ")";
    }
    function updateCar(car) {
        var v = car.vehicle;
        if(!v.wearEnabled) { if(carPanel.style.display !== "none") carPanel.style.display = "none"; return; }
        if(carPanel.style.display !== "block" && Settings.option("hud")) carPanel.style.display = "block";
        var order = [1, 0, 2, 3]; // FL FR / RL RR
        var html = "<div class=\"row\"><div class=\"tyres\">";
        order.forEach(function(i) {
            var w = v.wheels[i];
            html += "<div class=\"tyre\" style=\"background: " + tyreColour(w.temp) + "\"><i style=\"height: " + Math.round(Math.min(1, w.wear) * 100) + "%\"></i><span>" + Math.round(w.temp) + "°</span></div>";
        });
        html += "</div><div class=\"fuel\"><div class=\"label\">FUEL " + v.fuel.toFixed(1) + " L</div><div class=\"bar\"><i style=\"width: " + Math.round(v.fuel / v.tank * 100) + "%\"></i></div>" +
            "<div class=\"label\" style=\"margin-top: 4px;\">TYRES " + Math.round((1 - Math.min(1, v.maxWear())) * 100) + "%</div></div></div>";
        var pit = car.pit;
        if(pit && pit.active) html += "<div class=\"pit\">PIT STOP " + pit.remaining().toFixed(1) + " s" + (pit.plan && pit.plan.tyres > 0 ? " · tyres" : "") + (pit.plan && pit.plan.fuel > 0 ? " · fuel" : "") + "</div>";
        else if(pit && pit.done) html += "<div class=\"pit\" style=\"color: #7ee7a0;\">PIT STOP DONE · go</div>";
        else if(v.fuel <= 0) html += "<div class=\"pit\" style=\"color: #ff6b62;\">OUT OF FUEL</div>";
        else if(v.maxWear() > 0.8 || v.fuel < v.tank * 0.12) html += "<div class=\"pit\"" + (flash ? "" : " style=\"opacity: 0.4\"") + ">PIT · " + (v.maxWear() > 0.8 ? "tyres" : "fuel") + "</div>";
        if(html !== carHtml) { carHtml = html; carPanel.innerHTML = html; }
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

    function setPill(name, state) {
        if(pillStates[name] === state) return;
        pillStates[name] = state;
        pills[name].className = "pill " + state;
        pills[name].title = name + " " + STATE_NAMES[state];
    }

    function resize() {
        ratio = window.devicePixelRatio || 1;
        size = Math.round(Math.max(210, Math.min(330, Math.min(window.innerWidth, window.innerHeight) * 0.36)));
        canvas.style.width = size + "px";
        canvas.style.height = size + "px";
        canvas.width = Math.round(size * ratio);
        canvas.height = Math.round(size * ratio);
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
        var top = Math.ceil(limit / 1000);
        var scale = top * 1000;
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
        for(var i = 0; i <= top * 2; i++) {
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

        // the throttle (left) and the brake (right) as small arcs
        var pedalRadius = R * 0.5;
        var pedalWidth = R * 0.07;
        arc(cx, cy, pedalRadius, 135 * Math.PI / 180, 225 * Math.PI / 180, pedalWidth, "rgba(255, 255, 255, 0.1)");
        if(car.throttle > 0.01) arc(cx, cy, pedalRadius, 135 * Math.PI / 180, (135 + 90 * car.throttle) * Math.PI / 180, pedalWidth, "#37d67a");
        arc(cx, cy, pedalRadius, 45 * Math.PI / 180, -45 * Math.PI / 180, pedalWidth, "rgba(255, 255, 255, 0.1)", true);
        if(car.brakePedal > 0.01) arc(cx, cy, pedalRadius, 45 * Math.PI / 180, (45 - 90 * car.brakePedal) * Math.PI / 180, pedalWidth, "#ff5a4f", true);

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
        context.fillStyle = stalled ? "#ff5a4f" : "#8fa0b4";
        context.font = Math.round(R * 0.095) + "px Arial";
        var mode = { automatic: "AUTO", sequential: "SEQ", manual: car.clutchPedalPresent ? "MAN · CLUTCH" : "MAN" }[car.gearboxMode];
        context.fillText(stalled ? "ENGINE OFF" : mode, cx, cy + R * 0.5);
        context.fillStyle = "#8fa0b4";
        context.font = Math.round(R * 0.085) + "px Arial";
        context.fillText((car.engineRPM / 1000).toFixed(1) + " x1000 rpm", cx, cy + R * 0.62);
    }

    function updateLaps(car) {
        var lap = car.raceLaps ? (car.lapsCompleted >= car.raceLaps ? "FINISHED" : car.lapsCompleted + 1 === car.raceLaps ? "FINAL LAP" : "LAP " + (car.lapsCompleted + 1) + "/" + car.raceLaps) : "LAP " + (car.lapsCompleted + 1);
        var html = "<div class=\"lap\">" + lap + (car.raceCount > 1 ? " &nbsp;·&nbsp; P" + car.racePosition + "/" + car.raceCount : "") + "</div>";
        var current = car.lapStartTime !== undefined ? car.clock - car.lapStartTime : 0;
        html += "<div class=\"time\">" + formatTime(Math.max(0, current)) + "</div>";
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
        html += "<div class=\"keys\">" + (typeof TouchControls !== "undefined" && TouchControls.enabled() ? "☰: settings and controls" : "Esc: settings and controls") + "</div>";
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
        setPill("ABS", !v.absEnabled ? "off" : (absWorking ? "active" : "on"));
        setPill("TC", !v.tcEnabled ? "off" : (tcWorking ? "active" : "on"));
        setPill("ESC", !v.escEnabled ? "off" : (v.escLevel > 0.05 ? "active" : "on"));
        pills.P.style.display = car.parkingLock ? "" : "none";
        setPill("P", "park");
        var wanted = Math.round(Math.max(210, Math.min(330, Math.min(window.innerWidth, window.innerHeight) * 0.36)));
        if(wanted !== size) resize();
        drawGauge(car);
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
