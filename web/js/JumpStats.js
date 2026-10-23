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

    function key(trackId) { return "openracer.jump." + trackId; }
    function best(trackId) {
        try { return JSON.parse(window.localStorage.getItem(key(trackId))); } catch (e) { return null; }
    }
    function keep(trackId, jump) {
        try { window.localStorage.setItem(key(trackId), JSON.stringify(jump)); } catch (e) { /* no storage */ }
    }

    function show(distance, air, height, isBest, bestDistance) {
        if (!element) {
            element = document.createElement("div");
            element.style.cssText = "position: fixed; left: 50%; top: 16%; transform: translateX(-50%); z-index: 900; padding: 10px 20px; border-radius: 10px; background: rgba(20, 24, 31, 0.82); " +
                "color: #fff; font-family: Arial, sans-serif; text-align: center; pointer-events: none; transition: opacity 0.5s; opacity: 0;";
            document.body.appendChild(element);
        }
        element.innerHTML = "<div style=\"font-size: 30px; font-weight: bold;\">" + distance.toFixed(0) + " m</div>" +
            "<div style=\"font-size: 14px; opacity: 0.85;\">" + air.toFixed(1) + " s in the air · " + height.toFixed(1) + " m high</div>" +
            (isBest ? "<div style=\"font-size: 13px; color: #ffd04d; margin-top: 3px;\">Longest jump here</div>" : (bestDistance ? "<div style=\"font-size: 12px; opacity: 0.6; margin-top: 3px;\">Best " + bestDistance.toFixed(0) + " m</div>" : ""));
        element.style.opacity = "1";
        clearTimeout(timer);
        timer = setTimeout(function () { if (element) element.style.opacity = "0"; }, 3800);
    }

    // every frame, with the vehicle of the player, the time of the frame and the id of the track
    function update(v, delta, trackId) {
        if (v.airborne) {
            if (state.air === 0) { state.takeoff = { x: v.px, y: v.py, z: v.pz }; state.maxY = v.py; }
            state.air += delta;
            if (v.py > state.maxY) state.maxY = v.py;
            return;
        }
        if (state.air >= MIN_AIR && state.takeoff && isFinite(v.px)) {
            var distance = Math.hypot(v.px - state.takeoff.x, v.pz - state.takeoff.z);
            var height = state.maxY - Math.min(state.takeoff.y, v.py);       // (the top of the jump above the lower of the two places)
            var old = best(trackId);
            var isBest = !old || distance > old.distance;
            if (distance >= 5) {
                if (isBest) keep(trackId, { distance: distance, air: state.air, height: height });
                show(distance, state.air, Math.max(0, height), isBest, old ? old.distance : 0);
            }
        }
        state.air = 0;
        state.takeoff = null;
    }

    return { update: update, best: best };
})();
