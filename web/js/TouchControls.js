/*
 * TouchControls.js
 *
 * Description: Controls for a phone or a tablet, drawn over the game. They only exist on a touch screen (a coarse pointer), or with
 *              ?touch=1 in the address (?touch=0 switches them off), so the desktop does not see any of this.
 *
 *   - The left half of the screen steers: touch anywhere and a stick appears under the finger; moving it left or right steers. The
 *     stick follows the finger when it goes far, so the hand never runs out of room. How far the finger goes for the full steering is the
 *     option touchSteer (the Mobile tab of the settings, 1 is the whole stick).
 *   - The pedals are on the right: BRAKE and GAS, big and each for a thumb. They build up smoothly (a pedal, not a switch).
 *   - Buttons: handbrake, shift up and down, reverse (held), and at the top the menu, the camera and back to the start.
 *
 * The steering and the pedals go through the same path as a gamepad (see gamepadUpdate in controls.js), so the steering gets slower with
 * the speed and has the steering assist. The buttons are actions of the settings (Settings.setVirtual), so they do what their keys do.
 * Every finger is its own pointer: the car can be steered and braked while a button is held.
 */

var TouchControls = (function() {
    var STICK_DEAD = 0.06;
    var root = null, zone = null, ring = null, knob = null, gasEl = null, brakeEl = null;
    var shown = false;
    var state = { steer: 0, throttle: 0, brake: 0, engaged: false };
    var stick = { id: null, x0: 0, y0: 0, radius: 70, travel: 70 };
    var pedals = { gas: { id: null, value: 0 }, brake: { id: null, value: 0 } };
    var virtualHeld = {};   // action -> id of the pointer that holds its button
    var buttonOf = {};      // action -> the button element

    function wanted() {
        var q = new URLSearchParams(window.location.search).get("touch");
        if(q === "1") return true;
        if(q === "0") return false;
        // only on a device with a touch screen: a coarse pointer alone is not enough (a desktop can say so), and a mouse never drives the controls
        try { return window.matchMedia("(pointer: coarse)").matches && (navigator.maxTouchPoints || 0) > 0; } catch(e) { return false; }
    }
    var enabled = wanted();
    var forced = new URLSearchParams(window.location.search).get("touch") === "1";
    function fromMouse(e) { return e.pointerType === "mouse" && !forced; }

    function css() {
        var style = document.createElement("style");
        style.textContent =
            "body.touch { overscroll-behavior: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }" +
            "body.touch #hud { bottom: calc(210px + env(safe-area-inset-bottom)) !important; right: calc(14px + env(safe-area-inset-right)) !important; }" +
            "body.touch #hudHint { bottom: calc(170px + env(safe-area-inset-bottom)) !important; }" +
            "body.touch #debugOut { display: none !important; }" +
            "body.touch #hudBoost { bottom: calc(210px + env(safe-area-inset-bottom)) !important; }" +
            // a phone: everything of the HUD smaller
            "@media (max-width: 640px), (max-height: 480px) { body.touch #hudLaps { padding: 6px 10px 7px; min-width: 0; } body.touch #hudLaps .time { font-size: 22px; } body.touch #hudLaps .lap { font-size: 10px; } " +
                "body.touch #hudLaps .last { font-size: 12px; } body.touch #hudLaps .keys { display: none; } body.touch #hudCar { width: 150px; top: 86px; font-size: 11px; padding: 6px 10px 7px; } body.touch #hudCar .tyre { height: 20px; } " +
                "body.touch #hud { gap: 6px; } body.touch #hud .pills { gap: 5px; margin-bottom: 8px; } body.touch #hud .pill, body.touch #hud .pill.tap { font-size: 11px; min-width: 46px; padding: 6px 7px; } " +
                "body.touch #hudHint { font-size: 12px; } body.touch #freeCam { transform: scale(0.8); transform-origin: right top; } }" +
            "#touch { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 950; pointer-events: none; touch-action: none; " +
                "font-family: Arial, sans-serif; -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }" +
            "#touch.off { display: none; }" +
            "#touch .zone { position: absolute; left: 0; top: 0; width: 50%; height: 100%; pointer-events: auto; touch-action: none; }" +
            "#touch .ring { position: absolute; width: 140px; height: 140px; margin: -70px 0 0 -70px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.45); " +
                "background: radial-gradient(circle, rgba(0,0,0,0.30), rgba(0,0,0,0.12)); display: none; pointer-events: none; }" +
            "#touch .knob { position: absolute; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; " +
                "background: rgba(255,255,255,0.55); border: 2px solid rgba(255,255,255,0.85); display: none; pointer-events: none; }" +
            "#touch .pedals { position: absolute; right: calc(14px + env(safe-area-inset-right)); bottom: calc(18px + env(safe-area-inset-bottom)); display: flex; align-items: flex-end; gap: 12px; }" +
            "#touch .pedal, #touch .btn { pointer-events: auto; touch-action: none; box-sizing: border-box; color: #fff; font-weight: bold; text-align: center; " +
                "background: rgba(39,46,55,0.88); border: 1px solid #3a4452; text-shadow: 0 1px 3px #000; }" +
            "#touch .pedal { border-radius: 10px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 12px; font-size: 15px; letter-spacing: 1px; position: relative; overflow: hidden; }" +
            "#touch .pedal .fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; pointer-events: none; }" +
            "#touch .pedal span { position: relative; }" +
            "#touch .gas { width: 104px; height: 176px; } #touch .gas .fill { background: rgba(70,200,90,0.55); }" +
            "#touch .brk { width: 86px; height: 128px; } #touch .brk .fill { background: rgba(230,60,50,0.60); }" +
            "#touch .grid { display: grid; grid-template-columns: 54px 54px; gap: 8px; }" +
            "#touch .btn { border-radius: 8px; width: 54px; height: 54px; font-size: 13px; display: flex; align-items: center; justify-content: center; }" +
            "#touch .btn.rec { background: #d9372f; border-color: #ff6b62; }" +
            "#touch .btn.down { background: var(--accent, #ff5a1f); border-color: var(--accent, #ff5a1f); }" +
            "#touch .top { position: absolute; right: calc(12px + env(safe-area-inset-right)); top: calc(12px + env(safe-area-inset-top)); display: flex; gap: 8px; }" +
            "#touch .top .btn { width: 44px; height: 44px; }" +
            // upright: the pedals take the width, so the buttons go in a row above them and the left side stays free for the steering
            "@media (orientation: portrait) { #touch .pedals { flex-wrap: wrap; justify-content: flex-end; width: 210px; } #touch .grid { order: -1; width: 100%; " +
                "grid-template-columns: repeat(4, 1fr); justify-items: end; } #touch .btn { width: 46px; height: 46px; font-size: 12px; } " +
                "body.touch #hud, body.touch #hudBoost { bottom: calc(272px + env(safe-area-inset-bottom)) !important; } body.touch #hudHint { bottom: calc(232px + env(safe-area-inset-bottom)) !important; } }" +
            "@media (max-height: 420px) { #touch .gas { height: 140px; width: 96px; } #touch .brk { height: 104px; width: 80px; } #touch .btn { width: 46px; height: 46px; } " +
                "#touch .grid { grid-template-columns: 46px 46px; } body.touch #hud { bottom: calc(138px + env(safe-area-inset-bottom)) !important; transform: scale(0.72); transform-origin: right bottom; } " +
                "body.touch #hudHint { bottom: calc(120px + env(safe-area-inset-bottom)) !important; } }";
        document.head.appendChild(style);
    }

    // how far a finger goes for the full steering: the stick of a hand, times what the player has set (Mobile in the settings)
    function baseRadius() { return Math.max(50, Math.min(90, 0.17 * Math.min(window.innerWidth, window.innerHeight))); }
    function travelOf(multiplier) {
        var m = multiplier !== undefined ? multiplier : (typeof Settings !== "undefined" ? Settings.option("touchSteer") : 1);
        return baseRadius() * Math.max(0.01, Math.min(1, typeof m === "number" && isFinite(m) ? m : 1));
    }

    function el(parent, tag, cls, text) {
        var e = document.createElement(tag);
        if(cls) e.className = cls;
        if(text) e.textContent = text;
        parent.appendChild(e);
        return e;
    }

    // a button that holds an action of the settings while it is pressed
    function actionButton(parent, label, action, cls) {
        var b = el(parent, "div", "btn" + (cls ? " " + cls : ""));
        if(/^icon:/.test(label)) b.innerHTML = OpenRacer.icon(label.slice(5), 24); else b.textContent = label;
        b.addEventListener("pointerdown", function(e) {
            e.preventDefault();
            try { b.setPointerCapture(e.pointerId); } catch(err) { /* not captured */ }
            virtualHeld[action] = e.pointerId;
            buttonOf[action] = b;
            b.classList.add("down");
            Settings.setVirtual(action, true);
        });
        function up(e) {
            if(virtualHeld[action] !== e.pointerId) return;
            delete virtualHeld[action];
            b.classList.remove("down");
            Settings.setVirtual(action, false);
        }
        b.addEventListener("pointerup", up);
        b.addEventListener("pointercancel", up);
        b.addEventListener("lostpointercapture", up);
        return b;
    }

    function pedal(parent, name, label, cls) {
        var p = el(parent, "div", "pedal " + cls);
        var fill = el(p, "div", "fill");
        el(p, "span", "", label);
        p.fill = fill;
        p.addEventListener("pointerdown", function(e) {
            e.preventDefault();
            try { p.setPointerCapture(e.pointerId); } catch(err) { /* not captured */ }
            pedals[name].id = e.pointerId;
        });
        function up(e) { if(pedals[name].id === e.pointerId) pedals[name].id = null; }
        p.addEventListener("pointerup", up);
        p.addEventListener("pointercancel", up);
        p.addEventListener("lostpointercapture", up);
        return p;
    }

    function build() {
        css();
        document.body.classList.add("touch");
        root = el(document.body, "div");
        root.id = "touch";
        root.addEventListener("contextmenu", function(e) { e.preventDefault(); });

        zone = el(root, "div", "zone");
        ring = el(root, "div", "ring");
        knob = el(root, "div", "knob");

        zone.addEventListener("pointerdown", function(e) {
            if(fromMouse(e)) return;
            // (a finger that is down already, and a new one: the old one is a finger whose end was lost, the new touch takes over)
            e.preventDefault();
            try { zone.setPointerCapture(e.pointerId); } catch(err) { /* not captured */ }
            stick.id = e.pointerId;
            stick.x0 = e.clientX;
            stick.y0 = e.clientY;
            stick.radius = baseRadius();
            stick.travel = travelOf();
            var size = 2 * Math.max(stick.travel, 28);       // (the ring is as wide as the finger goes: it shows how far the full steering is)
            ring.style.width = ring.style.height = size + "px"; ring.style.margin = -size / 2 + "px 0 0 " + -size / 2 + "px";
            ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px";
            knob.style.left = e.clientX + "px"; knob.style.top = e.clientY + "px";
            ring.style.display = knob.style.display = "block";
            state.steer = 0;
        });
        zone.addEventListener("pointermove", function(e) {
            if(e.pointerId !== stick.id) return;
            var dx = e.clientX - stick.x0;
            var travel = stick.travel, limit = travel * 1.35;
            // the stick follows a finger that goes far, so the hand does not run out of room
            if(Math.abs(dx) > limit) { stick.x0 = e.clientX - Math.sign(dx) * limit; dx = Math.sign(dx) * limit; ring.style.left = stick.x0 + "px"; }
            var n = Math.max(-1, Math.min(1, dx / travel));
            knob.style.left = (stick.x0 + n * travel) + "px";
            knob.style.top = (stick.y0 + Math.max(-0.35, Math.min(0.35, (e.clientY - stick.y0) / stick.radius)) * stick.radius * 0.5) + "px";
            // a little progressive, so small movements are fine adjustments
            var a = Math.abs(n);
            state.steer = a < STICK_DEAD ? 0 : Math.sign(n) * Math.pow((a - STICK_DEAD) / (1 - STICK_DEAD), 1.25);
        });
        function release(e) {
            if(e.pointerId !== stick.id) return;
            releaseStick();
        }
        releaseStickNow = function() { stick.id = null; state.steer = 0; ring.style.display = knob.style.display = "none"; };
        zone.addEventListener("pointerup", release);
        zone.addEventListener("pointercancel", release);
        zone.addEventListener("lostpointercapture", release);

        var right = el(root, "div", "pedals");
        var grid = el(right, "div", "grid");
        actionButton(grid, "icon:chevron-up", "shiftUp");
        actionButton(grid, "HB", "handbrake");
        actionButton(grid, "icon:chevron-down", "shiftDown");
        actionButton(grid, "REV", "reverse");
        brakeEl = pedal(right, "brake", "BRAKE", "brk");
        gasEl = pedal(right, "gas", "GAS", "gas");

        var top = el(root, "div", "top");
        actionButton(top, "icon:rotate-ccw", "resetCar");
        actionButton(top, "icon:wrench", "repairCar");
        actionButton(top, "icon:camera", "cameraSwitch");
        var rec = actionButton(top, "icon:video", "take");
        if(typeof OpenRacer !== "undefined" && OpenRacer.Take) OpenRacer.Take.onChange(function(st) {
            rec.classList.toggle("rec", st === "taking" || st === "counting");
            rec.innerHTML = OpenRacer.icon(st === "taking" || st === "counting" ? "square" : "video", 24);
        });
        actionButton(top, "icon:sliders", "tuningMenu");
        var menu = el(top, "div", "btn");
        menu.innerHTML = OpenRacer.icon("menu", 24);
        menu.addEventListener("pointerup", function() { Settings.toggleMenu(); });
    }

    var editing = false;      // the HUD editor shows the controls (HudLayout.js) and holds them
    var releaseStickNow = null;
    function releaseStick() { if(releaseStickNow) releaseStickNow(); else { stick.id = null; state.steer = 0; } }

    // A finger that has ended, wherever it was (the browser can take the end of a touch away from the element that has it: a gesture of the system, a notification, a
    // finger on the edge, a third finger): what that finger held is let go. And when no finger is on the screen any more, nothing is held.
    function endPointer(id) {
        if(stick.id === id) releaseStick();
        ["gas", "brake"].forEach(function(name) { if(pedals[name].id === id) pedals[name].id = null; });
        Object.keys(virtualHeld).forEach(function(action) {
            if(virtualHeld[action] !== id) return;
            delete virtualHeld[action];
            Settings.setVirtual(action, false);
            if(buttonOf[action]) buttonOf[action].classList.remove("down");
        });
    }
    window.addEventListener("pointerup", function(e) { if(enabled) endPointer(e.pointerId); }, true);
    window.addEventListener("pointercancel", function(e) { if(enabled) endPointer(e.pointerId); }, true);
    function touchesEnded(e) { if(enabled && e.touches && e.touches.length === 0) releaseAll(); }
    window.addEventListener("touchend", touchesEnded, true);
    window.addEventListener("touchcancel", touchesEnded, true);
    document.addEventListener("visibilitychange", function() { if(enabled && document.hidden) releaseAll(); });
    window.addEventListener("pagehide", function() { if(enabled) releaseAll(); });

    function releaseAll() {
        stick.id = null; state.steer = 0;
        if(ring) ring.style.display = knob.style.display = "none";
        pedals.gas.id = pedals.brake.id = null;
        Object.keys(virtualHeld).forEach(function(a) { Settings.setVirtual(a, false); delete virtualHeld[a]; });
        if(root) Array.prototype.forEach.call(root.querySelectorAll(".btn.down"), function(b) { b.classList.remove("down"); });
    }

    window.addEventListener("blur", function() { if(enabled) releaseAll(); });

    // Once per frame (from gamepadUpdate): builds the controls when the game runs, hides them while the menu is open, builds up the pedals
    function update(delta) {
        if(!enabled || typeof Settings === "undefined") return state;
        if(!root) {
            if(!window.car || !document.body) return state;
            build();
        }
        var visible = !Settings.isPaused() || editing;
        if(visible !== shown) {
            shown = visible;
            root.classList.toggle("off", !visible);
            if(!visible) releaseAll();
        }
        // a pedal comes up as the keys do (the settings of the keyboard: the time and the curve of the throttle and of the brake), and lets go at once
        ["gas", "brake"].forEach(function(name) {
            var p = pedals[name], gas = name === "gas";
            var time = (typeof Settings !== "undefined" && Settings.option(gas ? "keyThrottleTime" : "keyBrakeTime")) || (gas ? 0.5 : 0.4);
            var curve = (typeof Settings !== "undefined" && Settings.option(gas ? "keyThrottleCurve" : "keyBrakeCurve")) || 1;
            if(p.id !== null) { p.held = (p.held || 0) + delta; p.value = Math.pow(Math.min(1, p.held / time), curve); }
            else { p.held = 0; p.value = 0; }
            (gas ? gasEl : brakeEl).fill.style.height = Math.round(p.value * 100) + "%";
        });
        state.throttle = pedals.gas.value;
        state.brake = pedals.brake.value;
        state.engaged = stick.id !== null || pedals.gas.id !== null || pedals.brake.id !== null || pedals.gas.value > 0 || pedals.brake.value > 0;
        return state;
    }

    return {
        enabled: function() { return enabled; },
        update: update,
        travel: travelOf,
        setEditing: function(flag) { editing = !!flag; if(editing) releaseAll(); if(root) root.classList.toggle("off", !editing && Settings.isPaused()); },
        state: state
    };
})();
