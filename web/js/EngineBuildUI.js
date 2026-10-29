/*
 * EngineBuildUI.js
 *
 * Description: The engine build of the Engine card as a piece of the page (EngineBuild.js is the model): the block, the exhaust, the settings of the engine with their sliders and
 *              limits that follow from each other, the turbo or the supercharger, the chart of the curve that follows, and Run dyno. Used by the tuning menu of the game, which has
 *              the cards of the car editor.
 *
 *   var ui = OpenRacer.EngineBuildUI.create(host);   ui.element is the piece; ui.update() draws it again from the host
 *
 * The host gives: build() the build of the car (or null), setBuild(build) a changed build (the host works out the curve and puts it on the car), exhaust() and setExhaust(type) the
 * exhaust of the sound, speeds() { idle, limiter }, setLimiter(rpm), driveline() { gears, final_drive, tyre (m), mass, efficiency, inertia } for the dyno, and result() the
 * result of EngineBuild.compute for the build that is on the car.
 */
OpenRacer.EngineBuildUI = (function () {
    var EB = OpenRacer.EngineBuild;
    var FIELDS = [
        // id, key, label, step
        ["bore", "bore", "Bore (mm)", 0.5], ["stroke", "stroke", "Stroke (mm)", 0.5], ["compression", "compression", "Compression", 0.1], ["cam", "cam_duration", "Cam duration (°)", 2],
        ["intake", "intake_flow", "Inlet flow (cfm)", 5], ["exhaust", "exhaust_flow", "Exhaust flow (cfm)", 5], ["primary", "primary_length", "Header length (m)", 0.05], ["exhaustLen", "exhaust_length", "Exhaust length (m)", 0.1]
    ];

    // the exhaust that goes with a block, until it is chosen otherwise
    function defaultExhaust(block) {
        if(/kart|Single 0.4|Twin/.test(block)) return "straight";
        if(/supersport|superbike|triple|thumper/.test(block)) return "performance";
        if(/flatplane|V10|V12|Flat-6/.test(block)) return "sport";
        return "standard";
    }

    function create(host) {
        var element = document.createElement("div");
        element.className = "ebu";
        var rows = {};                        // id: { number, range }
        var dyno = null, dynoFrame = 0;

        function el(tag, className, text, parent) { var e = document.createElement(tag); if(className) e.className = className; if(text) e.textContent = text; if(parent) parent.appendChild(e); return e; }
        function select(label, parent) { var wrap = el("div", "ebuItem", null, parent); el("div", "ebuLabel", label, wrap); var s = el("select", null, null, wrap); return s; }
        function fill(s, entries, labelOf) { s.innerHTML = Object.keys(entries).map(function(k) { return "<option value='" + k + "'>" + labelOf(entries[k]) + "</option>"; }).join(""); }
        function field(id, label, step, parent, change) {
            var wrap = el("div", "ebuItem", null, parent), line = el("div", "ebuLine", null, wrap);
            el("span", "ebuLabel", label, line);
            var number = el("input", null, null, line); number.type = "number"; number.step = step;
            var range = el("input", "ebuRange", null, wrap); range.type = "range"; range.step = step;
            range.addEventListener("input", function() { number.value = range.value; change(); });
            number.addEventListener("input", function() { range.value = number.value; });
            number.addEventListener("change", function() { var v = parseFloat(number.value); if(isFinite(v) && number.min !== "") number.value = Math.min(+number.max, Math.max(+number.min, v)); range.value = number.value; change(); });
            rows[id] = { number: number, range: range, wrap: wrap };
            return rows[id];
        }

        // ---- the block and the exhaust
        var blockSelect = select("Engine block", element);
        blockSelect.innerHTML = "<option value=''>Choose an engine block…</option>" + Object.keys(OpenRacer.engineSimPresets).map(function(n) { return "<option>" + n + "</option>"; }).join("");
        var info = el("div", "ebuInfo", null, element);
        var exhaustSelect = select("Exhaust", element);
        exhaustSelect.innerHTML = "<option value='custom'>Custom (as it was set before)</option>" + Object.keys(OpenRacer.engineSimExhausts).map(function(id) { var e = OpenRacer.engineSimExhausts[id]; return "<option value='" + id + "'>" + e.label + " · " + e.hint + "</option>"; }).join("");

        // ---- the chart and Run dyno
        var canvas = el("canvas", "ebuChart", null, element); canvas.width = 800; canvas.height = 360;
        var legend = el("div", "ebuLegend", "torque (Nm) · power (hp)", element);
        var dynoLine = el("div", "ebuDyno", null, element);
        var dynoButton = el("button", null, "▶ Run dyno", dynoLine); dynoButton.type = "button";
        var dynoInfo = el("span", "ebuDynoInfo", null, dynoLine);

        // ---- the settings of the build
        var body = el("div", "ebuBody", null, element);
        var bodyHead = el("div", "ebuGroup", "Block and cam", body);
        function push(b) { clearDyno(); host.setBuild(b); }
        function onField() { if(!host.build()) return; for(var i = 0; i < 3 && limits(); i++); push(read()); }
        FIELDS.forEach(function(f, i) {
            if(i === 4) el("div", "ebuGroup", "Inlet and exhaust", body);
            field(f[0], f[2], f[3], body, onField);
        });
        var valvesSelect = select("Valves per cylinder", body);
        valvesSelect.innerHTML = "<option>2</option><option>3</option><option>4</option><option>5</option>";
        el("div", "ebuGroup", "Fuel", body);
        var fuelSelect = select("Fuel", body); fill(fuelSelect, EB.FUELS, function(f) { return f.label; });
        field("lambda", "Mixture (λ, rich < 1)", 0.01, body, onField);
        el("div", "ebuGroup", "Turbo or supercharger", body);
        var inductionSelect = select("Induction", body);
        inductionSelect.innerHTML = "<option value='none'>None</option><option value='turbo'>Turbo</option><option value='supercharger'>Supercharger</option>";
        var variantBox = el("div", null, null, body), variantSelect = select("Type", variantBox);
        var sizeBox = el("div", null, null, body), sizeSelect = select("Size", sizeBox); fill(sizeSelect, EB.TURBO_SIZES, function(t) { return t.label; });
        var boostBox = el("div", null, null, body);
        field("boost", "Boost (bar)", 0.05, boostBox, onField);
        var coolerSelect = select("Intercooler", boostBox); fill(coolerSelect, EB.INTERCOOLERS, function(i) { return i.label; });
        el("div", "ebuGroup", "Dyno room", body);
        field("temp", "Air (°C)", 1, body, onField);
        field("altitude", "Altitude (m)", 50, body, onField);

        function fillVariants() { fill(variantSelect, inductionSelect.value === "turbo" ? EB.TURBO_VARIANTS : EB.SUPERCHARGERS, function(v) { return v.label; }); }
        fillVariants();

        function read() {
            var old = host.build() || {};
            var b = Object.assign({}, old, { block: blockSelect.value || old.block });
            FIELDS.forEach(function(f) { b[f[1]] = parseFloat(rows[f[0]].number.value) || 0; });
            b.valves = parseInt(valvesSelect.value, 10); b.fuel = fuelSelect.value; b.lambda = parseFloat(rows.lambda.number.value) || 0.9;
            b.induction = { type: inductionSelect.value, variant: variantSelect.value, size: sizeSelect.value, boost: parseFloat(rows.boost.number.value) || 0, intercooler: coolerSelect.value };
            b.ambient = { celsius: parseFloat(rows.temp.number.value) || 0, altitude: parseFloat(rows.altitude.number.value) || 0 };
            return b;
        }
        function show(b) {
            FIELDS.forEach(function(f) { rows[f[0]].number.value = b[f[1]]; });
            valvesSelect.value = String(b.valves || 4); fuelSelect.value = b.fuel || "pump95"; rows.lambda.number.value = b.lambda || 0.9;
            var ind = b.induction || { type: "none" };
            inductionSelect.value = ind.type; fillVariants(); if(ind.variant) variantSelect.value = ind.variant;
            sizeSelect.value = ind.size || "medium"; rows.boost.number.value = ind.boost || 0.6; coolerSelect.value = ind.intercooler || "air";
            rows.temp.number.value = b.ambient ? b.ambient.celsius : 20; rows.altitude.number.value = b.ambient ? b.ambient.altitude : 0;
        }

        // the limits that follow from the other settings: a value that is not possible any more is pulled in
        function limits() {
            var b = host.build(); if(!b) return false;
            var sp = host.speeds(), lim = EB.limits(read(), sp.limiter, sp.idle), changed = false;
            var map = { bore: "bore", stroke: "stroke", compression: "compression", cam: "cam", intake: "intake", exhaust: "exhaust", primary: "primary", exhaustLen: "exhaustLen", lambda: "lambda", boost: "boost", temp: "temp", altitude: "altitude" };
            Object.keys(map).forEach(function(id) {
                var r = rows[id], l = lim[map[id]], lo = Math.min(l[0], l[1]), hi = Math.max(l[0], l[1]);
                r.number.min = r.range.min = lo; r.number.max = r.range.max = hi; r.number.title = r.range.title = l[2] || "";
                var v = parseFloat(r.number.value);
                if(isFinite(v) && (v < lo || v > hi)) { r.number.value = Math.min(hi, Math.max(lo, v)); changed = true; }
                r.range.value = r.number.value;
            });
            Array.prototype.forEach.call(valvesSelect.options, function(o) { o.disabled = lim.valves.indexOf(parseInt(o.value, 10)) < 0; });
            if(valvesSelect.selectedOptions[0] && valvesSelect.selectedOptions[0].disabled) { valvesSelect.value = String(lim.valves[lim.valves.length - 1]); changed = true; }
            Array.prototype.forEach.call(sizeSelect.options, function(o) { o.disabled = lim.turboSizes.indexOf(o.value) < 0; });
            if(sizeSelect.selectedOptions[0] && sizeSelect.selectedOptions[0].disabled) { sizeSelect.value = lim.turboSizes[lim.turboSizes.length - 1]; changed = true; }
            if(inductionSelect.value === "turbo") {
                Array.prototype.forEach.call(variantSelect.options, function(o) { o.disabled = lim.turboVariants.indexOf(o.value) < 0; });
                if(variantSelect.selectedOptions[0] && variantSelect.selectedOptions[0].disabled) { variantSelect.value = "single"; changed = true; }
            }
            return changed;
        }

        blockSelect.addEventListener("change", function() {
            if(!blockSelect.value) return;
            var build = EB.fromPreset(blockSelect.value, OpenRacer.engineSimPresets[blockSelect.value]);
            var sp = host.speeds();
            host.setLimiter(EB.compute(build, 9000, sp.idle).suggestedLimiter);
            host.setExhaust(defaultExhaust(blockSelect.value));
            push(build);
        });
        exhaustSelect.addEventListener("change", function() { host.setExhaust(exhaustSelect.value); });
        [valvesSelect, fuelSelect, sizeSelect, variantSelect, coolerSelect].forEach(function(s) { s.addEventListener("change", onField); });
        inductionSelect.addEventListener("change", function() { fillVariants(); onField(); });

        // ---- the chart
        function power(rpm, nm) { return nm * rpm * Math.PI / 30 / 745.7; }
        function draw() {
            var g = canvas.getContext("2d"), w = canvas.width, h = canvas.height, res = host.result(), sp = host.speeds();
            g.clearRect(0, 0, w, h);
            var curve = (res && res.curve) || host.curve() || [];
            if(curve.length < 2) return;
            var maxRpm = Math.max(sp.limiter || 7000, curve[curve.length - 1][0]) * 1.05;
            var top = Math.max(1, Math.max.apply(null, curve.map(function(p) { return p[1]; })), Math.max.apply(null, curve.map(function(p) { return power(p[0], p[1]); }))) * 1.08;
            var step = 1; [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].some(function(m) { step = m; return top / m <= 7; });
            var maxY = Math.ceil(top / step) * step, left = 62, bottom = h - 24, plotW = w - left - 4, plotH = bottom - 8;
            function X(rpm) { return left + rpm / maxRpm * plotW; } function Y(v) { return bottom - v / maxY * plotH; }
            g.font = "24px Arial"; g.lineWidth = 1;
            for(var v = 0; v <= maxY + 1e-9; v += step) { g.strokeStyle = "#2c3541"; g.beginPath(); g.moveTo(left, Y(v)); g.lineTo(w, Y(v)); g.stroke(); g.fillStyle = "#8a97aa"; g.textAlign = "right"; g.textBaseline = "middle"; g.fillText(String(v), left - 8, Math.min(bottom - 8, Math.max(10, Y(v)))); }
            g.textAlign = "left"; g.textBaseline = "alphabetic"; g.strokeStyle = "#2c3541"; g.fillStyle = "#6f7d92";
            for(var r = 0; r <= maxRpm; r += 1000) { g.beginPath(); g.moveTo(X(r), 0); g.lineTo(X(r), bottom); g.stroke(); g.fillText(r / 1000 + "k", X(r) + 3, h - 4); }
            function line(color, value, pts, dashed) {
                g.setLineDash(dashed ? [10, 7] : []); g.strokeStyle = color; g.lineWidth = 3; g.beginPath();
                pts.forEach(function(p, i) { var x = X(p.rpm !== undefined ? p.rpm : p[0]), y = Y(value(p)); if(i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
                g.stroke(); g.setLineDash([]);
            }
            line("#ff9f43", function(p) { return p[1]; }, curve); line("#54a0ff", function(p) { return power(p[0], p[1]); }, curve);
            if(dyno) {
                var shown = dyno.points.slice(0, dyno.upTo + 1);
                if(shown.length) { line("#ffd29a", function(p) { return p.nm; }, shown, true); line("#a9cdff", function(p) { return p.hp; }, shown, true); }
                if(res && res.maxBoost > 0 && shown.length) {
                    var maxB = Math.max(0.5, Math.ceil(res.maxBoost * 5) / 5);
                    g.strokeStyle = "#6fdc8c"; g.setLineDash([10, 7]); g.beginPath();
                    shown.forEach(function(p, i) { var x = X(p.rpm), y = bottom - p.boost / maxB * plotH * 0.6; if(i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
                    g.stroke(); g.setLineDash([]); g.fillStyle = "#6fdc8c"; g.textAlign = "right"; g.fillText(maxB.toFixed(1) + " bar", w - 4, bottom - plotH * 0.6 - 4); g.textAlign = "left";
                }
            }
            var lx = X(sp.limiter || 0); g.strokeStyle = "#ff5e5e"; g.lineWidth = 2; g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx, bottom); g.stroke();
        }

        // ---- Run dyno: a full-throttle pull at the wheels of a car on rollers (the same as the car editor: the efficiency and the rolling of the tyres count, not the air or the grip)
        function pull() {
            var d = host.driveline(), res = host.result(), curve = ((res && res.curve) || host.curve() || []).slice().sort(function(a, b) { return a[0] - b[0]; }), sp = host.speeds();
            var gears = d.gears || [];
            if(!gears.length || !(d.final_drive > 0) || !(sp.limiter > 0) || curve.length < 2) return null;
            var ratio = gears.reduce(function(best, g) { return Math.abs(g - 1) < Math.abs(best - 1) ? g : best; }, gears[0]);
            var G = ratio * d.final_drive, r = (d.tyre || 0.65) / 2, mass = d.mass || 1000, eff = d.efficiency || 0.92;
            var b = host.build(), room = b && b.ambient ? 1 / EB.correction(b.ambient.altitude, b.ambient.celsius) : 1;
            function torqueAt(rpm) {
                if(rpm > curve[curve.length - 1][0]) return 0;
                for(var i = 1; i < curve.length; i++) if(rpm <= curve[i][0]) { var a = curve[i - 1], c = curve[i], f = c[0] > a[0] ? (rpm - a[0]) / (c[0] - a[0]) : 0; return (a[1] + (c[1] - a[1]) * f) * room * (d.power || 1); }
                return 0;
            }
            function boostAt(rpm) { var bo = res && res.boost; if(!bo) return 0; for(var i = 1; i < bo.length; i++) if(rpm <= bo[i][0]) return bo[i - 1][1] + (bo[i][1] - bo[i - 1][1]) * (rpm - bo[i - 1][0]) / (bo[i][0] - bo[i - 1][0]); return 0; }
            var rolling = 0.012 * mass * 9.81, meff = mass + (d.inertia || 0.3) * G * G / (r * r);
            var rpm = Math.max(sp.idle * 1.4 || 1200, sp.limiter * 0.25), v = rpm * Math.PI / 30 * r / G, last = -1e9, points = [];
            for(var t = 0; t < 120 && rpm < sp.limiter; t += 0.01) {
                var net = torqueAt(rpm) * G * eff / r - rolling;
                if(rpm - last >= 50) { points.push({ rpm: rpm, boost: boostAt(rpm), nm: Math.max(0, net * r / G), hp: Math.max(0, net * v / 745.7) }); last = rpm; }
                if(net <= 0 && rpm > curve[1][0]) break;
                v += Math.max(net, 0) / meff * 0.01 + 0.002;
                rpm = v * 30 / Math.PI * G / r;
            }
            return points.length > 3 ? { points: points, gear: gears.indexOf(ratio) + 1, room: room } : null;
        }
        function clearDyno() { if(!dyno) return; cancelAnimationFrame(dynoFrame); dyno = null; dynoInfo.textContent = ""; dynoButton.disabled = false; }
        dynoButton.addEventListener("click", function() {
            clearDyno();
            var run = pull();
            if(!run) { dynoInfo.textContent = "Needs gears, a final drive, a rev limit and a curve."; return; }
            dyno = { points: run.points, upTo: 0 };
            dynoButton.disabled = true;
            var start = performance.now(), duration = 4500;
            function step(now) {
                if(!dyno) { dynoButton.disabled = false; return; }
                var f = Math.max(0, Math.min(1, (now - start) / duration));
                dyno.upTo = Math.floor(f * (dyno.points.length - 1));
                draw();
                if(f < 1) { dynoFrame = requestAnimationFrame(step); return; }
                dynoButton.disabled = false;
                var best = dyno.points.reduce(function(m, p) { return p.hp > m.hp ? p : m; }, dyno.points[0]);
                var res = host.result(), curve = (res && res.curve) || [], engine = curve.reduce(function(m, p) { return Math.max(m, power(p[0], p[1])); }, 0);
                dynoInfo.textContent = "At the wheels (dashed): " + Math.round(best.hp) + " hp at " + Math.round(best.rpm / 10) * 10 + " rpm, " + Math.round(100 * (1 - best.hp / Math.max(1, engine))) + "% below the engine · gear " + run.gear +
                    (run.room !== 1 ? " · corrected (DIN) " + Math.round(best.hp / run.room) + " hp" : "") + (res && res.maxBoost > 0 ? " · boost up to " + res.maxBoost.toFixed(2) + " bar" : "");
            }
            dynoFrame = requestAnimationFrame(step);
        });

        // ---- draw it all again from the host
        function update() {
            var b = host.build(), res = host.result();
            blockSelect.value = b && b.block ? b.block : "";
            blockSelect.options[0].disabled = !!b;
            var ex = host.exhaust(); if(exhaustSelect.value !== ex) exhaustSelect.value = ex;
            body.style.display = b ? "" : "none";
            if(b) {
                show(b); limits();
                variantBox.style.display = inductionSelect.value === "none" ? "none" : "";
                boostBox.style.display = inductionSelect.value === "none" ? "none" : "";
                sizeBox.style.display = inductionSelect.value === "turbo" ? "" : "none";
                Object.keys(rows).forEach(function(id) { rows[id].range.value = rows[id].number.value; });
            }
            info.textContent = b && res ? res.displacement.toFixed(1) + " L, " + res.cylinders + " cylinders · " + Math.round(res.peakPower) + " hp at " + res.peakPowerRpm + " rpm · piston speed at the limit " + res.pistonSpeedAtLimit.toFixed(0) + " m/s" +
                (res.pistonSpeedAtLimit > 25 ? " (too fast for the engine to last)" : "") + (res.knock > 0.03 ? " · knock: " + Math.round(res.knock * 100) + "% of the torque is lost, use better fuel or less boost" : "")
                : "This car has an old torque curve. Choose an engine block to build its engine: the curve then follows from it.";
            draw();
        }
        return { element: element, update: update, read: read, limits: limits, clearDyno: clearDyno };
    }
    return { create: create, defaultExhaust: defaultExhaust };
})();
