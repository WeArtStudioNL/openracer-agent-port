/*
 * Ghost.js
 *
 * Description: The ghost: the best lap of the player with this car on this track, driven again as a see-through car while the player
 *              drives, so that the player can see where time is won or lost. The lap that is going is recorded (the body, the wheels, the
 *              steering, thirty times a second); when it turns out to be the best, the recording is kept with the record (Records.js).
 */

OpenRacer.Ghost = function (config, trackId) {
    var self = this;
    var RATE = 30;
    this.enabled = false;          // shows the ghost of the best lap
    OpenRacer.Ghost.current = this;
    this.saving = true;            // keeps a lap that is the best
    var recordKey = OpenRacer.Records.keyOf(config);      // the car, and its setup when it has one (Records.js)
    this.best = OpenRacer.Records.ghost(trackId, recordKey) || null;
    this.friend = null;            // the ghost of a file that someone sent: { name, car, time, samples }; it is shown instead of the best lap
    this.recording = null;         // the samples of the lap that is going
    var body = null, wheels = null, steering = null;
    var since = 0;                 // time since the last sample
    var loaded = false;

    // the model, see-through
    function load() {
        if (loaded) return;
        loaded = true;
        OpenRacer.loadCarModel(config, function (model) {
            body = new THREE.Object3D();
            body.add(model.tilt);
            wheels = model.wheels;
            steering = model.steeringWheel || null;
            [body].concat(wheels).forEach(function (object) {
                object.traverse(function (child) {
                    if (!child.isMesh) return;
                    child.castShadow = false;
                    var materials = Array.isArray(child.material) ? child.material : [child.material];
                    var ghosts = materials.map(function (m) {
                        var g = m.clone();
                        g.transparent = true;
                        g.opacity = 0.35;
                        g.depthWrite = false;
                        if (g.color) g.color.lerp(new THREE.Color(0x6fb7ff), 0.5);
                        if (g.emissive) g.emissive.set(0x1a3a66);
                        return g;
                    });
                    child.material = Array.isArray(child.material) ? ghosts : ghosts[0];
                });
                scene.add(object);
                object.visible = false;
            });
        }, function (message) { console.error("Ghost: " + message); });
    }

    this.startLap = function () {
        this.recording = [];
        since = 1;
    };

    // Called every frame with the player's car; records the lap and moves the ghost
    this.update = function (car, delta) {
        if (this.recording && car.lapStartTime !== undefined) {
            since += delta;
            if (since >= 1 / RATE) {
                since = 0;
                var b = car.body;
                var sample = {
                    t: car.clock - car.lapStartTime,
                    x: b.position.x, y: b.position.y, z: b.position.z,
                    qx: b.quaternion.x, qy: b.quaternion.y, qz: b.quaternion.z, qw: b.quaternion.w,
                    w: car.wheels.map(function (w) { return [+w.center.x.toFixed(3), +w.center.y.toFixed(3), +w.center.z.toFixed(3)]; }),
                    s: +car.vehicle.steerApplied.toFixed(3),
                    r: +car.wheels[0].spin.toFixed(2)
                };
                this.recording.push(sample);
                if (this.recording.length > RATE * 60 * 20) this.recording.shift(); // a lap of more than twenty minutes is no lap
            }
        }
        var shown = this.friend || this.best;
        if (!this.enabled || !shown || !shown.samples) return;
        load();
        if (!body) return;
        var t = car.lapStartTime !== undefined ? car.clock - car.lapStartTime : 0;
        var samples = shown.samples;
        if (t > samples[samples.length - 1].t + 0.5 || car.lapsCompleted === 0 && car.clock < 0.5) {
            // the ghost finished (or the race has not started): it waits at the line
            setVisible(false);
            return;
        }
        setVisible(true);
        // the two samples around t
        var lo = 0, hi = samples.length - 1;
        while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (samples[mid].t <= t) lo = mid; else hi = mid; }
        var a = samples[lo], b2 = samples[hi];
        var f = b2.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b2.t - a.t))) : 0;
        body.position.set(a.x + (b2.x - a.x) * f, a.y + (b2.y - a.y) * f, a.z + (b2.z - a.z) * f);
        body.quaternion.set(a.qx, a.qy, a.qz, a.qw).slerp(new THREE.Quaternion(b2.qx, b2.qy, b2.qz, b2.qw), f);
        for (var i = 0; i < 4 && i < wheels.length; i++) {
            var wa = a.w[i], wb = b2.w[i];
            wheels[i].position.set(wa[0] + (wb[0] - wa[0]) * f, wa[1] + (wb[1] - wa[1]) * f, wa[2] + (wb[2] - wa[2]) * f);
            wheels[i].quaternion.copy(body.quaternion);
            if (i < 2 && wheels[i].children[0]) wheels[i].children[0].rotation.y = -(a.s + (b2.s - a.s) * f);
            var spin = wheels[i].children[0] && wheels[i].children[0].children[0];
            if (spin) spin.rotation.x = a.r + (b2.r - a.r) * f;
        }
    };

    this.hide = function () { setVisible(false); };       // (a replay does not show the ghost; update() shows it again after the replay)
    function setVisible(v) {
        if (!body) return;
        body.visible = v;
        wheels.forEach(function (w) { w.visible = v; });
    }

    this.onLap = null;             // called with (samples, lapTime) for every lap that is done, whether it is the best or not

    // Called when a lap is done: keeps it when it is the best (and saving is on)
    this.lapDone = function (lapTime) {
        var recording = this.recording;
        this.recording = [];
        since = 1;
        if (this.onLap && recording && recording.length >= 10) this.onLap(recording, lapTime);
        if (!this.saving || !recording || recording.length < 10) return false;
        if (!OpenRacer.Records.lap(trackId, recordKey, lapTime)) return false;
        this.best = { time: lapTime, samples: recording };
        // (a ghost that does not fit in the storage of the browser is kept for this game: the record is the time)
        this.ghostKept = OpenRacer.Records.keepGhost(trackId, recordKey, this.best);
        if (!this.ghostKept) console.warn("Ghost: the storage of the browser is full; the ghost of this lap is kept until the page is closed");
        return true;
    };

    // ---- a ghost as a file, to send or to race: { format, version, track, car, name, time, samples }
    var FRIEND = "openracer.friendghost." + trackId;
    function rounded(samples) {
        var r = function (v, n) { var f = Math.pow(10, n); return Math.round(v * f) / f; };
        return samples.map(function (s) {
            return { t: r(s.t, 3), x: r(s.x, 3), y: r(s.y, 3), z: r(s.z, 3), qx: r(s.qx, 4), qy: r(s.qy, 4), qz: r(s.qz, 4), qw: r(s.qw, 4), w: s.w.map(function (p) { return [r(p[0], 3), r(p[1], 3), r(p[2], 3)]; }), s: r(s.s, 3), r: r(s.r, 2) };
        });
    }
    this.hasBest = function () { return !!(this.best && this.best.samples && this.best.samples.length > 10); };
    // saves the best lap of this car on this track as a file
    this.download = function (name) {
        if (!this.hasBest()) return false;
        var data = { format: "openracer-ghost", version: 1, track: trackId, car: { id: config.id, name: String(config.name || config.id) }, name: name || "", time: this.best.time, created: new Date().toISOString(), samples: rounded(this.best.samples) };
        var url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = "ghost-" + String(trackId).replace(/[^A-Za-z0-9_-]/g, "") + "-" + String(config.id).replace(/[^A-Za-z0-9_-]/g, "") + "-" + OpenRacer.Records.format(this.best.time).replace(/[:.]/g, "-") + ".openracer-ghost";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        return true;
    };
    // takes a ghost file; gives a promise of the ghost (or fails with a message)
    this.open = function (file) {
        var self = this;
        if (file.size > 20 * 1048576) return Promise.reject(new Error("This file is too large to be a ghost."));
        return file.text().then(function (text) {
            var d;
            try { d = JSON.parse(text); } catch (e) { throw new Error("This is not a ghost file."); }
            if (!d || d.format !== "openracer-ghost" || !Array.isArray(d.samples) || d.samples.length < 10) throw new Error("This is not a ghost file.");
            if (d.track !== trackId) throw new Error("This ghost is for another track (" + String(d.track).slice(0, 40) + ").");
            var ok = d.samples.every(function (s) { return s && isFinite(s.t) && isFinite(s.x) && isFinite(s.y) && isFinite(s.z) && isFinite(s.qw) && Array.isArray(s.w) && s.w.length >= 4; });
            if (!ok || !isFinite(d.time)) throw new Error("This ghost file is damaged.");
            self.friend = { name: String(d.name || (d.car && d.car.name) || "Ghost").slice(0, 40), car: d.car, time: d.time, samples: d.samples };
            self.enabled = true;
            try { window.localStorage.setItem(FRIEND, JSON.stringify(self.friend)); } catch (e) { /* too big or no storage: it is kept for this game only */ }
            return self.friend;
        });
    };
    this.clearFriend = function () {
        this.friend = null;
        try { window.localStorage.removeItem(FRIEND); } catch (e) { /* no storage */ }
    };
    try { var kept = JSON.parse(window.localStorage.getItem(FRIEND)); if (kept && kept.samples) this.friend = kept; } catch (e) { /* none */ }

    this.objects = function () { return body ? [body].concat(wheels) : []; };     // (the reflections leave them out: the camera of the reflections is often inside the ghost)
    this.isVisible = function () { return !!(body && body.visible); };

    this.bestTime = function () { return this.friend ? this.friend.time : (this.best ? this.best.time : OpenRacer.Records.best(trackId, recordKey)); };
};
