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
    this.saving = true;            // keeps a lap that is the best
    this.best = OpenRacer.Records.ghost(trackId, config.id) || null;
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
        if (!this.enabled || !this.best || !this.best.samples) return;
        load();
        if (!body) return;
        var t = car.lapStartTime !== undefined ? car.clock - car.lapStartTime : 0;
        var samples = this.best.samples;
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

    function setVisible(v) {
        if (!body) return;
        body.visible = v;
        wheels.forEach(function (w) { w.visible = v; });
    }

    // Called when a lap is done: keeps it when it is the best (and saving is on)
    this.lapDone = function (lapTime) {
        var recording = this.recording;
        this.recording = [];
        since = 1;
        if (!this.saving || !recording || recording.length < 10) return false;
        if (!OpenRacer.Records.lap(trackId, config.id, lapTime)) return false;
        this.best = { time: lapTime, samples: recording };
        OpenRacer.Records.keepGhost(trackId, config.id, this.best);
        return true;
    };

    this.isVisible = function () { return !!(body && body.visible); };

    this.bestTime = function () { return this.best ? this.best.time : OpenRacer.Records.best(trackId, config.id); };
};
