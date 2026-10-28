/*
 * JumpStats.js
 *
 * Description: What a jump was: when the car has been in the air for more than half a second and lands, a small notice says how far it went, how long it was in the air and how
 *              high it went, and whether that is the longest jump on this track (kept per track in this browser, localStorage). Nothing is shown for a hop.
 */

OpenRacer.JumpStats = (function () {
    var MIN_AIR = 0.6;                  // s: shorter than this is a hop, not a jump
    var state = { air: 0, takeoff: null, maxY: 0 };
    var element = null, timer = 0;

    var KEPT = 10;                      // the jumps that are kept per track: the longest ones
    function key(trackId) { return "openracer.jump." + trackId; }
    function keys(trackId) { return "openracer.jumps." + trackId; }
    // the longest jumps of a track, the longest first
    function top(trackId) {
        var list = null;
        try { list = JSON.parse(window.localStorage.getItem(keys(trackId))); } catch (e) { /* none */ }
        if (!Array.isArray(list)) {
            // from the time that only the longest was kept
            var old = null;
            try { old = JSON.parse(window.localStorage.getItem(key(trackId))); } catch (e) { /* none */ }
            list = old && old.distance ? [old] : [];
        }
        return list;
    }
    function best(trackId) { return top(trackId)[0] || null; }
    // keeps a jump if it is among the longest; gives its place (1 is the longest) or 0
    function keep(trackId, jump) {
        var list = top(trackId).concat([jump]).sort(function (a, b) { return b.distance - a.distance; });
        var place = list.indexOf(jump) + 1;
        if (place > KEPT) return 0;
        try { window.localStorage.setItem(keys(trackId), JSON.stringify(list.slice(0, KEPT))); } catch (e) { /* no storage */ }
        return place;
    }
    function clear(trackId) {
        try { window.localStorage.removeItem(keys(trackId)); window.localStorage.removeItem(key(trackId)); } catch (e) { /* no storage */ }
    }

    function show(distance, air, height, place, bestDistance) {
        if (!element) {
            element = document.createElement("div");
            element.style.cssText = "position: fixed; left: 50%; top: 16%; transform: translateX(-50%); z-index: 900; padding: 10px 20px; border-radius: 10px; background: rgba(20, 24, 31, 0.82); " +
                "color: #fff; font-family: Arial, sans-serif; text-align: center; pointer-events: none; transition: opacity 0.5s; opacity: 0;";
            document.body.appendChild(element);
        }
        element.innerHTML = "<div style=\"font-size: 30px; font-weight: bold;\">" + distance.toFixed(0) + " m</div>" +
            "<div style=\"font-size: 14px; opacity: 0.85;\">" + air.toFixed(1) + " s in the air · " + height.toFixed(1) + " m high</div>" +
            (place === 1 ? "<div style=\"font-size: 13px; color: #ffd04d; margin-top: 3px;\">Longest jump here</div>" : (place ? "<div style=\"font-size: 13px; color: #9fd0ff; margin-top: 3px;\">#" + place + " here · longest " + bestDistance.toFixed(0) + " m</div>" : (bestDistance ? "<div style=\"font-size: 12px; opacity: 0.6; margin-top: 3px;\">Longest " + bestDistance.toFixed(0) + " m</div>" : "")));
        element.style.opacity = "1";
        clearTimeout(timer);
        timer = setTimeout(function () { if (element) element.style.opacity = "0"; }, 3800);
    }

    // every frame, with the vehicle of the player, the time of the frame and the id of the track
    function cancel() { state.air = 0; state.takeoff = null; }
    function update(v, delta, trackId, carName) {
        if (v.airborne) {
            if (state.air === 0) { state.takeoff = { x: v.px, y: v.py, z: v.pz }; state.maxY = v.py; }
            state.air += delta;
            if (v.py > state.maxY) state.maxY = v.py;
            return;
        }
        // (a fall out of the world, or a jump that ended in a reset, is no jump)
        if (state.air >= MIN_AIR && state.takeoff && isFinite(v.px) && v.py > state.takeoff.y - 40) {
            var distance = Math.hypot(v.px - state.takeoff.x, v.pz - state.takeoff.z);
            var height = state.maxY - Math.min(state.takeoff.y, v.py);       // (the top of the jump above the lower of the two places)
            var old = best(trackId);
            if (distance >= 5) {
                var place = keep(trackId, { distance: distance, air: state.air, height: Math.max(0, height), car: carName || "", date: new Date().toISOString() });
                show(distance, state.air, Math.max(0, height), place, old ? old.distance : 0);
            }
        }
        state.air = 0;
        state.takeoff = null;
    }

    return { update: update, cancel: cancel, best: best, top: top, clear: clear };
})();
