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

    // The record of a car with a setup of its own is not the record of the car as made (and the AI used the best lap as its line): the key is
    // the id of the car, with "~" and the name of the setup when there is one
    function key(carId, setupName) { return setupName ? carId + "~" + setupName : carId; }
    // the key of a car config (main.js withTune marks a config with its setup)
    function keyOf(config) { return key(config.id, config.setupName); }

    // A ghost is kept packed: one list of rounded numbers per sample (time, place, rotation, steering, spin, and the four wheels from the
    // place of the car), about a fifth of the samples as objects with every digit (a lap was about a million characters, and the storage of
    // the browser was full after a few)
    var PACKED = 22;
    function round(v, n) { var f = Math.pow(10, n); return Math.round(v * f) / f; }
    function pack(recording) {
        var p = [];
        recording.samples.forEach(function (s) {
            p.push(round(s.t, 3), round(s.x, 3), round(s.y, 3), round(s.z, 3), round(s.qx, 4), round(s.qy, 4), round(s.qz, 4), round(s.qw, 4), round(s.s || 0, 3), round(s.r || 0, 2));
            for (var i = 0; i < 4; i++) { var w = s.w[i] || s.w[0]; p.push(round(w[0] - s.x, 3), round(w[1] - s.y, 3), round(w[2] - s.z, 3)); }
        });
        return { v: 2, time: recording.time, p: p };
    }
    function unpack(stored) {
        if (!stored || stored.v !== 2 || !Array.isArray(stored.p)) return stored;          // (a ghost of an older version: samples as objects)
        var p = stored.p, samples = [];
        for (var o = 0; o + PACKED <= p.length; o += PACKED) {
            var x = p[o + 1], y = p[o + 2], z = p[o + 3], w = [];
            for (var i = 0; i < 4; i++) w.push([x + p[o + 10 + 3 * i], y + p[o + 11 + 3 * i], z + p[o + 12 + 3 * i]]);
            samples.push({ t: p[o], x: x, y: y, z: z, qx: p[o + 4], qy: p[o + 5], qz: p[o + 6], qw: p[o + 7], s: p[o + 8], r: p[o + 9], w: w });
        }
        return { time: stored.time, samples: samples };
    }

    function ghost(trackId, carKey) {
        return unpack(read(GHOST + trackId + "." + carKey));
    }

    // keeps the ghost of a best lap. When the storage is full the ghosts of other tracks and cars go, the oldest record first, until it fits
    // (they were lost without a word before, and then the record and the ghost of a lap did not agree). Gives false when it does not fit.
    function keepGhost(trackId, carKey, recording) {
        var name = GHOST + trackId + "." + carKey, value = pack(recording);
        if (write(name, value)) return true;
        var others = [];
        try {
            for (var i = 0; i < window.localStorage.length; i++) {
                var k = window.localStorage.key(i);
                if (!k || k.indexOf(GHOST) !== 0 || k === name) continue;
                var rest = k.slice(GHOST.length), dot = rest.indexOf(".");
                var rec = dot > 0 ? ofTrack(rest.slice(0, dot))[rest.slice(dot + 1)] : null;
                others.push({ key: k, date: rec && rec.date ? rec.date : "", size: (window.localStorage.getItem(k) || "").length });
            }
        } catch (e) { return false; }
        // (only when the other ghosts together are at least as big as this one: the rest of the storage is the settings, the setups, the pictures of the cars,
        // and every ghost was taken away when they filled it, and this one still did not fit)
        var room = others.reduce(function (sum, o) { return sum + o.size; }, 0);
        if (room < JSON.stringify(value).length) return false;
        others.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        for (var j = 0; j < others.length; j++) {
            try { window.localStorage.removeItem(others[j].key); } catch (e) { /* gone */ }
            if (write(name, value)) { console.warn("Records: the storage of the browser was full; the ghosts of " + (j + 1) + " older records were removed"); return true; }
        }
        return false;
    }

    // the best lap of any car on a track, as the line for the AI when the track has none: the newest best. With "after" (line_date of the track: when its
    // road or its line was changed in the track editor) only a lap driven since then: an older one went over the old road
    function anyGhost(trackId, after) {
        var all = ofTrack(trackId);
        var bestCar = null, bestTime = Infinity;
        Object.keys(all).forEach(function (car) {
            if (after && !(all[car].date > after)) return;
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

    return { key: key, keyOf: keyOf, ofTrack: ofTrack, best: best, lap: lap, ghost: ghost, keepGhost: keepGhost, anyGhost: anyGhost, dragRuns: dragRuns, dragRun: dragRun, forget: forget, format: format };
})();

// The jump records of an older version are gone: what it kept in the browser goes too
(function () {
    try {
        Object.keys(window.localStorage).filter(function (k) { return /^openracer\.jumps?\./.test(k); }).forEach(function (k) { window.localStorage.removeItem(k); });
    } catch (e) { /* no storage */ }
})();
