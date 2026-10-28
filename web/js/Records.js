/*
 * Records.js
 *
 * Description: The lap records: the best lap per track and car, kept in this browser (localStorage), and the recording of that lap
 *              for the ghost (see Ghost.js). Saving can be switched off when a race is started (the "records" option). The runs of the
 *              drag strip of a track (DragStrip.js) are kept too: the best 50 of a length, with what is needed for the ticket.
 */

OpenRacer.Records = (function () {
    var PREFIX = "openracer.records.";
    var GHOST = "openracer.ghost.";
    var DRAG = "openracer.drag.";
    var DRAG_KEPT = 50;

    function read(key) {
        try { return JSON.parse(window.localStorage.getItem(key)); } catch (e) { return null; }
    }
    function write(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    }

    // { car: { time, date } } of a track
    function ofTrack(trackId) {
        return read(PREFIX + trackId) || {};
    }

    function best(trackId, carId) {
        var r = ofTrack(trackId)[carId];
        return r ? r.time : null;
    }

    // keeps a lap if it is the best; gives true when it is
    function lap(trackId, carId, time) {
        var all = ofTrack(trackId);
        var old = all[carId];
        if (old && old.time <= time) return false;
        all[carId] = { time: time, date: new Date().toISOString() };
        write(PREFIX + trackId, all);
        return true;
    }

    function ghost(trackId, carId) {
        return read(GHOST + trackId + "." + carId);
    }

    function keepGhost(trackId, carId, recording) {
        return write(GHOST + trackId + "." + carId, recording);
    }

    // the best lap of any car on a track, as the line for the AI when the track has none: the newest best
    function anyGhost(trackId) {
        var all = ofTrack(trackId);
        var bestCar = null, bestTime = Infinity;
        Object.keys(all).forEach(function (car) {
            if (all[car].time < bestTime && ghost(trackId, car)) { bestTime = all[car].time; bestCar = car; }
        });
        return bestCar ? ghost(trackId, bestCar) : null;
    }

    // the runs of the drag strip of a track, the best first: of a length (metres), or all
    function dragRuns(trackId, length) {
        var all = read(DRAG + trackId) || [];
        return all.filter(function (run) { return length === undefined || Math.abs(run.length - length) < 0.5; }).sort(function (a, b) { return a.time - b.time; });
    }

    // keeps a run; only the best 50 of its length stay. Gives the place of the run (1 is the best) or 0 when it is not among them
    function dragRun(trackId, run) {
        var all = read(DRAG + trackId) || [];
        run.id = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        all.push(run);
        var same = all.filter(function (r) { return Math.abs(r.length - run.length) < 0.5; }).sort(function (a, b) { return a.time - b.time; }).slice(0, DRAG_KEPT);
        var kept = all.filter(function (r) { return Math.abs(r.length - run.length) >= 0.5; }).concat(same);
        write(DRAG + trackId, kept);
        return same.indexOf(run) + 1;
    }

    function forget(trackId) {
        try {
            window.localStorage.removeItem(PREFIX + trackId);
            window.localStorage.removeItem(DRAG + trackId);
            for (var i = window.localStorage.length - 1; i >= 0; i--) {
                var key = window.localStorage.key(i);
                if (key && key.indexOf(GHOST + trackId + ".") === 0) window.localStorage.removeItem(key);
            }
        } catch (e) { /* no storage */ }
    }

    function format(seconds) {
        if (seconds === null || seconds === undefined || !isFinite(seconds)) return "--:--.---";
        var m = Math.floor(seconds / 60), s = seconds - m * 60;
        return m + ":" + (s < 10 ? "0" : "") + s.toFixed(3);
    }

    return { ofTrack: ofTrack, best: best, lap: lap, ghost: ghost, keepGhost: keepGhost, anyGhost: anyGhost, dragRuns: dragRuns, dragRun: dragRun, forget: forget, format: format };
})();

// The jump records of an older version are gone: what it kept in the browser goes too
(function () {
    try {
        Object.keys(window.localStorage).filter(function (k) { return /^openracer\.jumps?\./.test(k); }).forEach(function (k) { window.localStorage.removeItem(k); });
    } catch (e) { /* no storage */ }
})();
