/*
 * HudLayout.js
 *
 * Description: Where the HUD is, how big it is and how see-through: the player can change every element of it (the gauge, the lap times, the tyres and the fuel, and on a
 *              touch screen the pedals and the buttons). It works on every device. The layout is kept in the browser (localStorage) and is put on the elements by their own
 *              CSS properties translate, scale and opacity, so the HUD itself (Hud.js, TouchControls.js) does not know about it.
 *
 * Use: OpenRacer.HudLayout.edit() opens the editor (the game is held; a container at the top of the screen): an element is chosen by a tap on it or on its name, moved by
 *      dragging it, and scaled and made see-through with the sliders. Save keeps the layout, Cancel goes back to what it was.
 *      OpenRacer.HudLayout.editing() tells that the editor is open.
 */

OpenRacer.HudLayout = (function () {
    var KEY = "openracer.hudLayout";
    // the elements: a name, a label and where to find it; what is not on the screen now (no turbo, no tyres in the race) is not offered
    var ELEMENTS = [
        { id: "gauge", label: "Gauge", sel: "#hud" },
        { id: "boost", label: "Boost", sel: "#hudBoost" },
        { id: "laps", label: "Lap times", sel: "#hudLaps" },
        { id: "car", label: "Tyres and fuel", sel: "#hudCar" },
        { id: "brake", label: "Brake", sel: "#touch .brk" },
        { id: "gas", label: "Gas", sel: "#touch .gas" },
        { id: "buttons", label: "Gear buttons", sel: "#touch .grid" },
        { id: "top", label: "Top buttons", sel: "#touch .top" }
    ];
    var MIN_SCALE = 0.4, MAX_SCALE = 2.5, MIN_OPACITY = 0.1;

    var saved = load();        // id -> { x, y (a part of the width and of the height of the window), s (scale), o (opacity) }
    var working = null;        // the layout while the editor is open
    var selected = null;
    var ui = null;
    var frame = 0;

    function load() {
        try {
            var o = JSON.parse(window.localStorage.getItem(KEY));
            return o && typeof o === "object" ? o : {};
        } catch (e) { return {}; }
    }
    function store(layout) {
        try {
            if(Object.keys(layout).length) window.localStorage.setItem(KEY, JSON.stringify(layout)); else window.localStorage.removeItem(KEY);
        } catch (e) { /* no storage */ }
    }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function number(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback; }
    function find(id) { return ELEMENTS.filter(function (e) { return e.id === id; })[0]; }
    function element(entry) { return document.querySelector(entry.sel); }
    function isDefault(v) { return !v || (!v.x && !v.y && number(v.s, 1) === 1 && number(v.o, 1) === 1); }

    // puts a layout on the elements that exist now (the string that is on an element is kept, so nothing is set twice)
    function apply(layout) {
        ELEMENTS.forEach(function (entry) {
            var el = element(entry);
            if(!el) return;
            var v = layout[entry.id];
            var s = isDefault(v) ? "" : [Math.round(number(v.x, 0) * 10000) / 10000, Math.round(number(v.y, 0) * 10000) / 10000, number(v.s, 1), number(v.o, 1), window.innerWidth, window.innerHeight].join(" ");
            if(el.__hudLayout === s) return;
            el.__hudLayout = s;
            if(!s) { el.style.translate = ""; el.style.scale = ""; el.style.opacity = ""; return; }
            el.style.translate = (v.x || 0) * window.innerWidth + "px " + (v.y || 0) * window.innerHeight + "px";
            el.style.scale = number(v.s, 1) === 1 ? "" : String(v.s);
            el.style.opacity = number(v.o, 1) === 1 ? "" : String(v.o);
        });
    }

    // the HUD and the controls are built when the game starts, and the window can turn: the saved layout is put on now and then
    setInterval(function () { if(!working) apply(saved); }, 500);
    window.addEventListener("resize", function () { if(!working) apply(saved); });

    function visible(entry) {
        var el = element(entry);
        if(!el) return null;
        var r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 ? { el: el, rect: r } : null;
    }
    function entryOf(id) { return working && working[id] ? working[id] : (working[id] = { x: 0, y: 0, s: 1, o: 1 }); }

    // ---- the editor

    function css() {
        if(document.getElementById("hudEditStyle")) return;
        var style = document.createElement("style");
        style.id = "hudEditStyle";
        style.textContent =
            "#hudEditCatch { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 2900; touch-action: none; user-select: none; -webkit-user-select: none; background: rgba(8, 10, 14, 0.35); }" +
            "#hudEditCatch .box { position: absolute; border: 2px dashed rgba(255, 255, 255, 0.55); border-radius: 6px; pointer-events: none; box-sizing: border-box; }" +
            "#hudEditCatch .box.on { border: 2px solid var(--accent, #ff5a1f); background: rgba(255, 90, 31, 0.12); }" +
            "#hudEditCatch .box span { position: absolute; left: 0; top: -20px; font: 11px system-ui, sans-serif; color: #fff; background: rgba(20, 24, 29, 0.85); padding: 2px 6px; border-radius: 4px; white-space: nowrap; }" +
            "#hudEdit { position: fixed; left: 50%; top: calc(10px + env(safe-area-inset-top)); transform: translateX(-50%); width: min(560px, calc(100vw - 20px)); box-sizing: border-box; z-index: 3000; " +
                "padding: 10px 12px 12px; background: rgba(22, 27, 34, 0.96); border: 1px solid #323c4a; border-radius: 10px; color: #dfe6ef; font: 13px system-ui, -apple-system, sans-serif; " +
                "touch-action: manipulation; max-height: calc(100vh - 20px); overflow-y: auto; }" +
            "#hudEdit .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: bold; font-size: 15px; color: var(--head, #f4f6f8); }" +
            "#hudEdit .head .tools { display: flex; gap: 6px; }" +
            "#hudEdit .help { color: #8d97a3; margin: 4px 0 8px; }" +
            "#hudEdit .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }" +
            "#hudEdit .or-btn { padding: 6px 12px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }" +
            "#hudEdit .or-btn.sel { border-color: var(--accent, #ff5a1f); color: #fff; }" +
            "#hudEdit .row { display: grid; grid-template-columns: 70px 1fr 56px; align-items: center; gap: 10px; margin: 6px 0; }" +
            "#hudEdit .row input { width: 100%; min-width: 0; }" +
            "#hudEdit .row b { text-align: right; color: var(--head, #f4f6f8); font-weight: normal; font-variant-numeric: tabular-nums; }" +
            "#hudEdit .foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 10px; }" +
            "#hudEdit .foot div { display: flex; gap: 8px; }" +
            "#hudEdit.small .help, #hudEdit.small .chips, #hudEdit.small .controls { display: none; }";
        document.head.appendChild(style);
    }

    function button(parent, text, icon, cls, onClick) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "or-btn" + (cls ? " " + cls : "");
        b.innerHTML = (icon ? OpenRacer.icon(icon, 16) : "") + (text ? "<span>" + text + "</span>" : "");
        b.addEventListener("click", onClick);
        parent.appendChild(b);
        return b;
    }

    function slider(parent, label, min, max, step, get, set, text) {
        var row = document.createElement("div");
        row.className = "row";
        var l = document.createElement("span");
        l.textContent = label;
        var input = document.createElement("input");
        input.type = "range"; input.min = min; input.max = max; input.step = step;
        var value = document.createElement("b");
        input.addEventListener("input", function () { set(parseFloat(input.value)); value.textContent = text(parseFloat(input.value)); apply(working); });
        row.appendChild(l); row.appendChild(input); row.appendChild(value);
        parent.appendChild(row);
        return { refresh: function () { input.value = get(); value.textContent = text(get()); }, input: input };
    }

    function refreshUi() {
        if(!ui) return;
        var shown = [];
        ui.chips.innerHTML = "";
        ELEMENTS.forEach(function (entry) {
            if(!visible(entry)) return;
            shown.push(entry.id);
            var b = button(ui.chips, entry.label, null, entry.id === selected ? "sel" : "", function () { selected = entry.id; refreshUi(); });
            b.dataset.id = entry.id;
        });
        if(selected && shown.indexOf(selected) < 0) selected = null;
        ui.controls.style.opacity = selected ? "1" : "0.45";
        ui.controls.style.pointerEvents = selected ? "" : "none";
        ui.help.textContent = selected ? "Drag " + find(selected).label.toLowerCase() + " on the screen to move it." : (shown.length ? "Tap an element or its name, then drag it. Nothing is chosen." : "There is nothing on the screen to move. Close the menu with the HUD on.");
        ui.size.refresh(); ui.opacity.refresh();
        if(selected) { ui.size.input.disabled = ui.opacity.input.disabled = false; }
    }

    // the dashed boxes round the elements, drawn every frame (an element can change its size by itself)
    function drawBoxes() {
        if(!ui) return;
        var seen = {};
        ELEMENTS.forEach(function (entry) {
            var v = visible(entry);
            var box = ui.boxes[entry.id];
            if(!v) { if(box) box.style.display = "none"; return; }
            seen[entry.id] = true;
            if(!box) {
                box = ui.boxes[entry.id] = document.createElement("div");
                box.className = "box";
                box.innerHTML = "<span>" + entry.label + "</span>";
                ui.catcher.appendChild(box);
            }
            box.style.display = "block";
            box.style.left = v.rect.left + "px"; box.style.top = v.rect.top + "px"; box.style.width = v.rect.width + "px"; box.style.height = v.rect.height + "px";
            box.classList.toggle("on", entry.id === selected);
        });
        frame = requestAnimationFrame(drawBoxes);
    }

    function hit(x, y) {
        var best = null, bestArea = Infinity;
        ELEMENTS.forEach(function (entry) {
            var v = visible(entry);
            if(!v) return;
            var r = v.rect, slack = 6;
            if(x < r.left - slack || x > r.right + slack || y < r.top - slack || y > r.bottom + slack) return;
            var area = r.width * r.height;
            if(area < bestArea) { best = entry.id; bestArea = area; }       // (the smallest: a button on top of a bigger element)
        });
        return best;
    }

    function edit() {
        if(ui) return;
        if(typeof Settings === "undefined") return;
        css();
        fromMenu = !!document.getElementById("settingsMenu");       // (Save and Cancel go back to the settings menu it was opened from, not into the running game)
        Settings.closeMenu();
        Settings.holdPause(true);
        if(typeof TouchControls !== "undefined") TouchControls.setEditing(true);
        working = clone(saved);
        selected = null;
        ui = { boxes: {} };

        var catcher = ui.catcher = document.createElement("div");
        catcher.id = "hudEditCatch";
        document.body.appendChild(catcher);

        var panel = ui.panel = document.createElement("div");
        panel.id = "hudEdit";
        document.body.appendChild(panel);
        var head = document.createElement("div");
        head.className = "head";
        head.innerHTML = "<span>Edit HUD</span>";
        var tools = document.createElement("div");
        tools.className = "tools";
        head.appendChild(tools);
        var fold = button(tools, "", "chevron-up", "ghost", function () {
            var small = panel.classList.toggle("small");
            fold.innerHTML = OpenRacer.icon(small ? "chevron-down" : "chevron-up", 16);
        });
        fold.title = "Fold the panel";
        panel.appendChild(head);
        ui.help = document.createElement("div");
        ui.help.className = "help";
        panel.appendChild(ui.help);
        ui.chips = document.createElement("div");
        ui.chips.className = "chips";
        panel.appendChild(ui.chips);
        ui.controls = document.createElement("div");
        ui.controls.className = "controls";
        panel.appendChild(ui.controls);
        ui.size = slider(ui.controls, "Size", MIN_SCALE * 100, MAX_SCALE * 100, 5, function () { return selected ? Math.round(number(entryOf(selected).s, 1) * 100) : 100; },
            function (v) { if(selected) entryOf(selected).s = v / 100; }, function (v) { return Math.round(v) + "%"; });
        ui.opacity = slider(ui.controls, "Opacity", MIN_OPACITY * 100, 100, 5, function () { return selected ? Math.round(number(entryOf(selected).o, 1) * 100) : 100; },
            function (v) { if(selected) entryOf(selected).o = v / 100; }, function (v) { return Math.round(v) + "%"; });
        var foot = document.createElement("div");
        foot.className = "foot";
        panel.appendChild(foot);
        var left = document.createElement("div");
        foot.appendChild(left);
        button(left, "Reset element", "rotate-ccw", "", function () { if(selected) { delete working[selected]; apply(working); refreshUi(); } });
        button(left, "Reset all", "", "", function () { working = {}; apply(working); refreshUi(); });
        var right = document.createElement("div");
        foot.appendChild(right);
        button(right, "Cancel", "x", "", cancel);
        button(right, "Save", "check", "primary", save);

        // the elements are moved by dragging them: a tap chooses one, and a finger on the chosen one moves it
        var drag = null;
        catcher.addEventListener("pointerdown", function (e) {
            e.preventDefault();
            var id = hit(e.clientX, e.clientY);
            if(!id) { selected = null; refreshUi(); return; }
            selected = id;
            try { catcher.setPointerCapture(e.pointerId); } catch (err) { /* not captured */ }
            var v = entryOf(id);
            drag = { pointer: e.pointerId, id: id, x: e.clientX, y: e.clientY, startX: number(v.x, 0), startY: number(v.y, 0) };
            refreshUi();
        });
        catcher.addEventListener("pointermove", function (e) {
            if(!drag || e.pointerId !== drag.pointer) return;
            var v = entryOf(drag.id), entry = find(drag.id), el = element(entry);
            var nx = drag.startX + (e.clientX - drag.x) / window.innerWidth, ny = drag.startY + (e.clientY - drag.y) / window.innerHeight;
            v.x = nx; v.y = ny;
            apply(working);
            // the element stays on the screen: at least a part of it that a finger can find again
            if(el) {
                var r = el.getBoundingClientRect(), keep = Math.min(40, r.width / 2, r.height / 2);
                var dx = r.right < keep ? keep - r.right : (r.left > window.innerWidth - keep ? window.innerWidth - keep - r.left : 0);
                var dy = r.bottom < keep ? keep - r.bottom : (r.top > window.innerHeight - keep ? window.innerHeight - keep - r.top : 0);
                if(dx || dy) { v.x += dx / window.innerWidth; v.y += dy / window.innerHeight; drag.x += dx; drag.y += dy; apply(working); }
            }
        });
        function end(e) { if(drag && e.pointerId === drag.pointer) drag = null; }
        catcher.addEventListener("pointerup", end);
        catcher.addEventListener("pointercancel", end);
        catcher.addEventListener("contextmenu", function (e) { e.preventDefault(); });

        refreshUi();
        frame = requestAnimationFrame(drawBoxes);
    }

    var fromMenu = false;
    function close() {
        cancelAnimationFrame(frame);
        if(ui) { ui.catcher.remove(); ui.panel.remove(); }
        ui = null; working = null; selected = null;
        if(typeof TouchControls !== "undefined") TouchControls.setEditing(false);
        Settings.holdPause(false);
        if(fromMenu) { fromMenu = false; Settings.toggleMenu(); }
    }
    function cancel() { if(!ui) return; apply(saved); close(); }
    function save() {
        if(!ui) return;
        Object.keys(working).forEach(function (id) { if(isDefault(working[id])) delete working[id]; });
        saved = clone(working);
        store(saved);
        apply(saved);
        close();
    }

    return { edit: edit, editing: function () { return !!ui; }, cancel: cancel, save: save, apply: function () { apply(working || saved); } };
})();
