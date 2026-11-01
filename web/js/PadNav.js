/*
 * PadNav.js
 *
 * Description: The menus with a game controller. Start opens and closes the pause menu, as Escape does. In a menu (the main menu, the pause menu,
 *              a question, a window of the main menu) the D-pad or the left stick moves the focus to the next thing in that direction, A chooses
 *              it (as Enter or a click), B goes back (as Escape). On a slider or a list left and right change the value. While the car is driven
 *              only Start does something here: the other buttons are the controls of the car (Settings.js).
 *              The layout is the standard mapping of the browser (button 0 is A / cross, 1 is B / circle, 9 is Start / options, 12 to 15 the
 *              D-pad); the controller is the one that is not the racing wheel.
 */

OpenRacer.PadNav = (function() {
    var A = 0, B = 1, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
    var STICK = 0.6, FIRST_REPEAT = 0.35, REPEAT = 0.12;           // the stick counts as a direction past 0.6; a held direction repeats after 0.35 s, then every 0.12 s
    var was = {}, held = { dir: null, since: 0, next: 0 };
    var FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1']), [role='button']";
    // the layers that take the controller, the one on top first
    var LAYERS = "#orDialog, .or-dialog, #replaysDialog, #garageDialog, #vehiclePicker, #replayLeave, .veShade";

    // (only a controller with the standard layout: separate pedals, a shifter or a button box beside a wheel have other mappings, and their resting axes moved the
    // focus and changed a slider every 0.12 s; and nothing while a control is being bound in the settings, where the buttons are what is bound)
    function pad() {
        if (typeof Settings === "undefined" || !Settings.controllerPad || (Settings.capturing && Settings.capturing())) return null;
        var p = Settings.controllerPad();
        return p && p.mapping === "standard" ? p : null;
    }
    function pressed(p, i) { var b = p.buttons[i]; return !!b && (b.pressed || b.value > 0.5); }

    // the part of the page that the controller works in, or null while the car is driven
    function layer() {
        var layers = document.querySelectorAll(LAYERS);
        if (layers.length) return layers[layers.length - 1];
        var settings = document.getElementById("settingsMenu");
        if (settings) return settings;
        // the results of a race (Race again, Main menu): under the pause menu and in a replay, where they are hidden, they are not the controller's
        var results = document.getElementById("raceResults");
        if (results && !document.body.classList.contains("replaying") && results.offsetParent) return results;
        return document.getElementById("mainMenu");
    }

    function key(code, target) {
        var ev = new KeyboardEvent("keydown", { code: code, key: code === "Escape" ? "Escape" : code, bubbles: true, cancelable: true });
        (target || document.activeElement || document.body).dispatchEvent(ev);
    }

    function visible(el) {
        if (el.disabled || el.getAttribute("aria-hidden") === "true") return false;
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        var s = getComputedStyle(el);
        return s.visibility !== "hidden" && s.display !== "none";
    }

    function candidates(root) { return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), visible); }

    // the focus goes to the nearest thing in the direction; what lies in a straight line counts more than what lies to the side
    function move(root, dx, dy) {
        var list = candidates(root);
        if (!list.length) return;
        var from = root.contains(document.activeElement) && document.activeElement !== root ? document.activeElement : null;
        if (!from) { focus(list.filter(function(el) { return el.classList.contains("selected"); })[0] || list[0]); return; }
        var a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
        var best = null, bestScore = Infinity;
        list.forEach(function(el) {
            if (el === from || from.contains(el) || el.contains(from)) return;
            var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
            var along = (x - ax) * dx + (y - ay) * dy;
            if (along <= 4) return;
            var side = Math.abs((x - ax) * dy - (y - ay) * dx);
            var score = along + side * 2.5;
            if (score < bestScore) { bestScore = score; best = el; }
        });
        if (best) focus(best);
    }

    function focus(el) {
        var old = document.querySelector(".or-padfocus");
        if (old) old.classList.remove("or-padfocus");
        try { el.focus({ focusVisible: true, preventScroll: true }); } catch (e) { el.focus(); }
        el.classList.add("or-padfocus");
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    // left and right on a slider or a list change it, as the arrow keys do
    function adjust(el, step) {
        if (!el) return false;
        if (el.tagName === "INPUT" && el.type === "range") {
            if (step > 0) el.stepUp(); else el.stepDown();
        } else if (el.tagName === "SELECT") {
            var i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + step));
            if (i === el.selectedIndex) return true;
            el.selectedIndex = i;
        } else return false;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        // (the pause menu builds itself again on a change and gives the focus back a moment later, to the new slider: the mark goes with it)
        setTimeout(function() { var now = document.activeElement; if (now && now !== document.body && now !== el) focus(now); }, 30);
        return true;
    }

    function choose(root) {
        var el = document.activeElement;
        if (!el || !root.contains(el) || el === root) { move(root, 0, 1); return; }
        // a card or a tile of the main menu has its own Enter (it chooses, and Enter on what is chosen goes on)
        if (el.closest && el.closest("#mainMenu") && el.matches(".mode, .tile, .card, .steps span.done")) { key("Enter", el); return; }
        el.click();
    }

    function direction(p) {
        var x = p.axes[0] || 0, y = p.axes[1] || 0;
        if (pressed(p, UP) || y < -STICK) return "up";
        if (pressed(p, DOWN) || y > STICK) return "down";
        if (pressed(p, LEFT) || x < -STICK) return "left";
        if (pressed(p, RIGHT) || x > STICK) return "right";
        return null;
    }

    function step(root, dir) {
        var d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
        if ((dir === "left" || dir === "right") && adjust(document.activeElement, d[0])) return;
        move(root, d[0], d[1]);
    }

    function poll(now) {
        requestAnimationFrame(poll);
        pollOnce(now);
    }
    function pollOnce(now) {
        var t = now / 1000, p = pad();
        if (!p) { was = {}; held.dir = null; return; }
        var edge = function(i) { var on = pressed(p, i), e = on && !was[i]; was[i] = on; return e; };
        var start = edge(START), a = edge(A), b = edge(B);
        var root = layer();
        // Start: in the game the pause menu, as Escape; on a page of the main menu it goes on, as Enter (Start the race)
        if (start) {
            if (root && root.id === "mainMenu") key("Enter", document.body);
            else key("Escape", document.body);
            return;
        }
        // the fly-by over the grid before a race: A skips it, as Enter does
        if (!root && a && typeof race !== "undefined" && race && race.state === "flyby" && race.flyby) { race.flyby.skip = true; return; }
        if (!root) { held.dir = null; return; }
        if (b) { key("Escape"); return; }
        if (a) { choose(root); return; }
        var dir = direction(p);
        if (!dir) { held.dir = null; return; }
        if (dir !== held.dir) { held.dir = dir; held.next = t + FIRST_REPEAT; step(root, dir); }
        else if (t >= held.next) { held.next = t + REPEAT; step(root, dir); }
    }

    var style = document.createElement("style");
    style.textContent = ".or-padfocus { outline: 3px solid #ffb020 !important; outline-offset: 2px; }";
    document.head.appendChild(style);
    // a click or a key takes the mark of the controller away (the mouse or the keyboard shows its own focus)
    ["pointerdown", "keydown"].forEach(function(type) {
        window.addEventListener(type, function(ev) { if (!ev.isTrusted) return; var el = document.querySelector(".or-padfocus"); if (el) el.classList.remove("or-padfocus"); }, true);
    });
    requestAnimationFrame(poll);
    return { layer: layer, poll: function(now) { pollOnce(now === undefined ? performance.now() : now); } };
})();
