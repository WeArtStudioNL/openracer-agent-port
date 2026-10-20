/*
 * Movable.js
 *
 * Description: Makes a panel that floats over the game (the tuning menu, the free camera, the replay bar, the windows of the editors) movable and
 *              scalable: drag it by any part of it that is not a control (a button, a field, a slider), and drag the bottom right corner to scale it.
 *              Where it is and how large it is, is kept in this browser per panel (a key), and a panel that would be out of the window is brought back.
 *              OpenRacer.Movable.make(element, { key: "tuning" }); OpenRacer.Movable.reset(element) puts it back as the page made it.
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
    }

    // keeps a part of the panel in the window
    function keep(el) {
        if (!el.__free || el.style.display === "none") return;
        var rect = el.getBoundingClientRect();
        if (!rect.width) return;
        var left = Math.min(Math.max(rect.left, 60 - rect.width), window.innerWidth - 60);
        var top = Math.min(Math.max(rect.top, 0), window.innerHeight - 40);
        place(el, left, top);
    }

    function make(el, options) {
        if (!el || el.__movable) return el;
        el.__movable = options || {};
        var key = (options && options.key) || null;
        all.push(el);
        var original = { left: el.style.left, top: el.style.top, right: el.style.right, bottom: el.style.bottom, transform: el.style.transform,
            width: el.style.width, height: el.style.height, maxHeight: el.style.maxHeight, maxWidth: el.style.maxWidth };
        el.__original = original;
        var gesture = null;
        var inCorner = function (e) { var r = el.getBoundingClientRect(); return r.right - e.clientX < CORNER && r.bottom - e.clientY < CORNER; };

        el.addEventListener("pointermove", function (e) {
            if (gesture) return;
            el.style.cursor = inCorner(e) ? "nwse-resize" : "";
        });
        el.addEventListener("pointerdown", function (e) {
            if (e.button !== 0) return;
            var corner = inCorner(e);
            if (!corner && control(e.target, el)) return;
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
                el.style.width = Math.max(MIN_W, gesture.width + dx) + "px";
                el.style.height = Math.max(MIN_H, gesture.height + dy) + "px";
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

    return { make: make, reset: reset };
})();
