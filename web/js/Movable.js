/*
 * Movable.js
 *
 * Description: Makes a panel that floats over the game (the tuning menu, the free camera, the replay bar, the windows of the editors) movable and
 *              scalable: drag it by any part of it that is not a control (a button, a field, a slider), and drag the bottom right corner to scale it.
 *              Where it is and how large it is, is kept in this browser per panel (a key), and a panel that would be out of the window is brought back.
 *              OpenRacer.Movable.make(element, { key: "tuning" }); OpenRacer.Movable.reset(element) puts it back as the page made it.
 *              With { handle: element } (or a function that gives it) the panel is only dragged by that part (a header), and nothing else of it takes the drag: a panel that
 *              scrolls can then be scrolled with the finger without moving it (the handle stops the browser from scrolling: touch-action none; the corner still scales).
 *              With { edges: true } every edge and every corner scales it (a band of 7 px along the border), not only the bottom right corner.
 *              With { frame: { title, onClose } } the panel is a window: a bar at the top with the title (it drags the panel) and a × (onClose; none without it), every edge and
 *              corner scales it, and what the panel holds goes into a body under the bar that scrolls by itself, its scroll bar away from the edge (on the edge it took the
 *              drag that scales). OpenRacer.Movable.body(element) is that body: content that is made later goes there. The panel keeps showing and hiding itself with
 *              style.display as before ("none" hides it; anything else shows it as the window).
 */

OpenRacer.Movable = (function () {
    var PREFIX = "openracer.popup.";
    var CORNER = 18;                    // px: the corner that scales
    var MIN_W = 170, MIN_H = 80;
    var all = [];

    function load(key) { try { return JSON.parse(window.localStorage.getItem(PREFIX + key)); } catch (e) { return null; } }
    function save(key, value) { try { if (value) window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); else window.localStorage.removeItem(PREFIX + key); } catch (e) { /* no storage */ } }

    // a control keeps its own behaviour
    function control(target, root) {
        for (var n = target; n && n !== root; n = n.parentElement) {
            if (/^(INPUT|BUTTON|SELECT|TEXTAREA|A|LABEL|CANVAS|OPTION|SUMMARY)$/.test(n.tagName) || n.isContentEditable) return true;
        }
        return false;
    }

    // left and top are in the window; a panel that is positioned inside another element (absolute) is placed from that element
    function place(el, left, top) {
        var base = { left: 0, top: 0 };
        if (window.getComputedStyle(el).position === "absolute" && el.offsetParent) base = el.offsetParent.getBoundingClientRect();
        el.style.left = (left - base.left) + "px";
        el.style.top = (top - base.top) + "px";
    }

    // from the anchors of the page (right, bottom, a transform) to a place in left and top, with the size it has now
    function free(el) {
        if (el.__free) return;
        el.__free = true;
        var rect = el.getBoundingClientRect();
        el.style.boxSizing = "border-box";           // (the size that is set is the size that is seen, with the padding)
        place(el, rect.left, rect.top);
        el.style.right = "auto";
        el.style.bottom = "auto";
        el.style.transform = "none";
        el.style.width = rect.width + "px";
        el.style.height = rect.height + "px";
        el.style.maxHeight = "none";
        el.style.maxWidth = "none";
        el.style.margin = "0";                        // (a dialog of the editors has margins: the place that is set is where it is seen)
    }

    // keeps a part of the panel in the window
    function keep(el) {
        if (!el.__free || el.style.display === "none") return;
        var rect = el.getBoundingClientRect();
        if (!rect.width) return;
        var left = Math.min(Math.max(rect.left, 60 - rect.width), window.innerWidth - 60);
        var top = Math.min(Math.max(rect.top, 0), window.innerHeight - 40);
        place(el, left, top);
        // (and no taller or wider than the window: a panel sized on a large screen hung 350 px under a smaller one, and its own scroll could not reach the bottom)
        if (rect.height > window.innerHeight - 10) el.style.height = Math.max(MIN_H, window.innerHeight - 10) + "px";
        if (rect.width > window.innerWidth - 10) el.style.width = Math.max(MIN_W, window.innerWidth - 10) + "px";
        rect = el.getBoundingClientRect();
        if (rect.bottom > window.innerHeight && rect.height <= window.innerHeight) place(el, left, Math.max(0, window.innerHeight - rect.height - 5));
    }

    // ---- the window: a bar at the top, a body that scrolls (see the description above)
    var styled = false;
    function frameStyle() {
        if (styled) return;
        styled = true;
        var st = document.createElement("style");
        st.textContent =
            ".mvFrame { flex-direction: column; overflow: hidden !important; }" +
            ".mvFrame:not([style*=\"display: none\"]) { display: flex !important; }" +
            ".mvBar { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 30px; box-sizing: border-box; padding: 4px 5px 4px 12px; " +
            "background: rgba(28, 36, 48, 0.98); border-bottom: 1px solid #323c4a; color: #9fb0c4; font: bold 13px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; " +
            "letter-spacing: 0; text-transform: none; cursor: move; user-select: none; -webkit-user-select: none; touch-action: none; }" +
            ".mvBar .mvTitle { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }" +
            // (!important: the panels have their own rules for their buttons, with an id, which would win)
            ".mvBar .mvClose { flex: none !important; width: 28px !important; height: 24px !important; min-width: 0 !important; padding: 0 !important; margin: 0 !important; border: 0 !important; " +
            "border-radius: 6px !important; background: transparent !important; color: #dfe6ef !important; font: 18px/1 Arial, sans-serif !important; cursor: pointer; box-shadow: none !important; }" +
            ".mvBar .mvClose:hover { background: #c2412d !important; color: #fff !important; }" +
            ".mvBody { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; margin: 0 7px 7px 0; box-sizing: border-box; }";
        document.head.appendChild(st);
    }
    function frame(el, f) {
        if (el.__body) return el.__body;
        frameStyle();
        var cs = window.getComputedStyle(el);
        if (cs.display === "none" && el.style.display !== "none") el.style.display = "none";      // (hidden by a style sheet: hidden here too, the window rule would show it)
        var pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(function (x) { return parseFloat(x) || 0; });
        var bar = document.createElement("div");
        bar.className = "mvBar";
        var title = document.createElement("span");
        title.className = "mvTitle";
        title.textContent = f.title || "";
        bar.appendChild(title);
        if (typeof f.onClose === "function") {
            var x = document.createElement("button");
            x.type = "button"; x.className = "mvClose"; x.textContent = "\u00d7"; x.title = f.closeTitle || "Close"; x.setAttribute("aria-label", x.title);
            x.addEventListener("click", function (e) { e.stopPropagation(); f.onClose(); });
            bar.appendChild(x);
        }
        var body = document.createElement("div");
        body.className = "mvBody";
        while (el.firstChild) body.appendChild(el.firstChild);
        // (the padding of the panel goes to the body: the bar reaches the edges; the body stays 7 px from the right edge and from the bottom, the band where the panel scales)
        body.style.padding = pad[0] + "px " + Math.max(0, pad[1] - 7) + "px " + Math.max(0, pad[2] - 7) + "px " + pad[3] + "px";
        el.style.padding = "0";
        el.classList.add("mvFrame");
        el.appendChild(bar);
        el.appendChild(body);
        if (cs.position === "fixed" && (cs.maxHeight === "none" || !cs.maxHeight)) el.style.maxHeight = "calc(100vh - 20px)";
        el.__body = body; el.__bar = bar; el.__title = title;
        return body;
    }

    function make(el, options) {
        if (!el || el.__movable) return el;
        if (options && options.frame) {
            frame(el, options.frame);
            options = Object.assign({}, options, { edges: true, handle: el.__bar });
        }
        el.__movable = options || {};
        var key = (options && options.key) || null;
        all.push(el);
        var original = { left: el.style.left, top: el.style.top, right: el.style.right, bottom: el.style.bottom, transform: el.style.transform,
            width: el.style.width, height: el.style.height, maxHeight: el.style.maxHeight, maxWidth: el.style.maxWidth };
        el.__original = original;
        var gesture = null;
        var handleAtStart = options && (typeof options.handle === "function" ? options.handle() : options.handle);
        if(handleAtStart) handleAtStart.style.touchAction = "none";
        var edges = !!(options && options.edges), EDGE = 7;
        // the side that is taken: { l, r, t, b } (the bottom right corner is { r, b }), or null
        var inCorner = function (e) {
            var r = el.getBoundingClientRect();
            if (!edges) return r.right - e.clientX < CORNER && r.bottom - e.clientY < CORNER ? { r: true, b: true } : null;
            var z = { l: e.clientX - r.left < EDGE, r: r.right - e.clientX < EDGE, t: e.clientY - r.top < EDGE, b: r.bottom - e.clientY < EDGE };
            if (r.right - e.clientX < CORNER && r.bottom - e.clientY < CORNER) z.r = z.b = true;
            return z.l || z.r || z.t || z.b ? z : null;
        };
        var cursorOf = function (z) { return !z ? "" : (z.l && z.t) || (z.r && z.b) ? "nwse-resize" : (z.r && z.t) || (z.l && z.b) ? "nesw-resize" : z.l || z.r ? "ew-resize" : "ns-resize"; };

        el.addEventListener("pointermove", function (e) {
            if (gesture) return;
            el.style.cursor = cursorOf(inCorner(e));
        });
        el.addEventListener("pointerdown", function (e) {
            if (e.button !== 0) return;
            var corner = inCorner(e);
            if (!corner && control(e.target, el)) return;
            var handle = options && (typeof options.handle === "function" ? options.handle() : options.handle);
            if (!corner && handle && !handle.contains(e.target)) return;         // (only the handle drags: the rest of the panel scrolls)
            free(el);
            var rect = el.getBoundingClientRect();
            gesture = { corner: corner, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height, id: e.pointerId };
            try { el.setPointerCapture(e.pointerId); } catch (x) { /* no capture */ }
            e.preventDefault();
        });
        el.addEventListener("pointermove", function (e) {
            if (!gesture || e.pointerId !== gesture.id) return;
            var dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
            if (gesture.corner) {
                var z = gesture.corner, left = gesture.left, top = gesture.top, width = gesture.width, height = gesture.height;
                if (z.r) width = Math.max(MIN_W, gesture.width + dx);
                if (z.b) height = Math.max(MIN_H, gesture.height + dy);
                if (z.l) { width = Math.max(MIN_W, gesture.width - dx); left = gesture.left + gesture.width - width; }
                if (z.t) { height = Math.max(MIN_H, gesture.height - dy); top = gesture.top + gesture.height - height; }
                el.style.width = width + "px"; el.style.height = height + "px";
                if (z.l || z.t) place(el, left, top);
            } else {
                place(el, gesture.left + dx, gesture.top + dy);
            }
        });
        var end = function (e) {
            if (!gesture || (e && e.pointerId !== gesture.id)) return;
            gesture = null;
            keep(el);
            if (key) { var r = el.getBoundingClientRect(); save(key, { left: r.left, top: r.top, width: r.width, height: r.height }); }
        };
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", end);

        // where it was left last time
        var saved = key ? load(key) : null;
        if (saved && saved.width > 0) {
            free(el);
            place(el, saved.left, saved.top);
            el.style.width = Math.max(MIN_W, saved.width) + "px";
            el.style.height = Math.max(MIN_H, saved.height) + "px";
            keep(el);
        }
        return el;
    }

    // back to the place and the size that the page made
    function reset(el) {
        if (!el || !el.__movable) return;
        var o = el.__original;
        Object.keys(o).forEach(function (k) { el.style[k] = o[k]; });
        el.style.boxSizing = "";
        el.__free = false;
        if (el.__movable.key) save(el.__movable.key, null);
    }

    window.addEventListener("resize", function () { all.forEach(keep); });

    // the body of a window (frame): where its content goes; a panel that is no window is its own body
    function body(el) { return el && el.__body ? el.__body : el; }
    function setTitle(el, text) { if (el && el.__title) el.__title.textContent = text; }

    return { make: make, reset: reset, keep: keep, body: body, setTitle: setTitle };          // (keep: for a panel that is shown again, in a window that may be smaller now)
})();
