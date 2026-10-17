/*
 * EngineSampler.js
 *
 * Description: The engine sound from recordings, the way most games do it: loops of the engine at a few engine speeds (and with the throttle
 *              open or closed), that are played at a pitch that follows the engine speed and are faded into each other. It has the same
 *              functions as EngineSynth.js (setRpm, setThrottle, setInside, connect), so the game and the car editor can use either.
 *
 * The recordings of a car are in "sound.samples" of car.json: [{ "file": "idle.ogg", "rpm": 900, "load": "off" }, ...] with files in the folder of the car:
 *   file: a seamless loop of the engine at a steady speed (ogg, mp3 or wav);
 *   rpm: the engine speed at which it was recorded;
 *   load: "on" (the throttle open, under load) or "off" (the throttle closed, coasting); recordings of one kind are enough (it is then used for both).
 * Between two recordings the sound fades from one to the other (and each is changed in pitch up to a factor of about 1.5 towards the other),
 * so a few of them, for example at idle, 2500, 4500 and at the rev limit, are enough.
 */

OpenRacer.EngineSampler = function (context, layers) {
    var self = this;
    this.context = context;
    this.inside = false;
    this.params = {};
    var rpm = 0, throttle = 0;

    var master = context.createGain();
    master.gain.value = 0.8;
    var filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 20000;
    master.connect(filter);
    this.output = filter;

    // every recording: a looping source with its own volume, and its group (on or off the throttle)
    var voices = layers.map(function (layer) {
        var source = context.createBufferSource();
        source.buffer = layer.buffer;
        source.loop = true;
        var gain = context.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(master);
        source.start(0, Math.random() * layer.buffer.duration);
        return { source: source, gain: gain, rpm: Math.max(100, layer.rpm), load: layer.load === "off" ? "off" : "on" };
    });
    var groups = { on: [], off: [] };
    voices.forEach(function (voice) { groups[voice.load].push(voice); });
    groups.on.sort(function (a, b) { return a.rpm - b.rpm; });
    groups.off.sort(function (a, b) { return a.rpm - b.rpm; });
    if(!groups.on.length) groups.on = groups.off;
    if(!groups.off.length) groups.off = groups.on;
    var lowest = Math.min.apply(null, voices.map(function (v) { return v.rpm; }));

    // the volumes of the recordings of a group at an engine speed: the two around it, in equal power, or the one at the end
    function weights(group, speed) {
        var result = [];
        var i = 0;
        while(i < group.length - 1 && group[i + 1].rpm <= speed) i++;
        if(group.length === 1 || speed <= group[0].rpm) {
            result.push([group[0], 1]);
        } else if(i >= group.length - 1) {
            result.push([group[group.length - 1], 1]);
        } else {
            var lo = group[i], hi = group[i + 1];
            var t = Math.max(0, Math.min(1, Math.log(speed / lo.rpm) / Math.log(hi.rpm / lo.rpm)));
            result.push([lo, Math.cos(t * Math.PI / 2)], [hi, Math.sin(t * Math.PI / 2)]);
        }
        return result;
    }

    function apply() {
        var now = context.currentTime;
        var targets = new Map();
        voices.forEach(function (voice) { targets.set(voice, 0); });
        // on the throttle or off it, in equal power; with one kind only that one is played
        var onShare = groups.on === groups.off ? 1 : Math.sin(Math.max(0, Math.min(1, throttle)) * Math.PI / 2);
        var offShare = groups.on === groups.off ? 0 : Math.cos(Math.max(0, Math.min(1, throttle)) * Math.PI / 2);
        weights(groups.on, rpm).forEach(function (w) { targets.set(w[0], targets.get(w[0]) + w[1] * onShare); });
        if(offShare > 0) weights(groups.off, rpm).forEach(function (w) { targets.set(w[0], targets.get(w[0]) + w[1] * offShare); });
        // a stalled engine is silent
        var running = Math.max(0, Math.min(1, (rpm - lowest * 0.3) / (lowest * 0.4)));
        voices.forEach(function (voice) {
            voice.gain.gain.setTargetAtTime(targets.get(voice) * running, now, 0.04);
            voice.source.playbackRate.setTargetAtTime(Math.max(0.3, Math.min(3, Math.max(rpm, 50) / voice.rpm)), now, 0.03);
        });
    }

    this.setRpm = function (value) { rpm = Math.max(0, value); apply(); };
    this.setThrottle = function (value) { throttle = Math.max(0, Math.min(1, value)); apply(); };
    this.setInside = function (inside) {
        this.inside = inside;
        filter.frequency.setTargetAtTime(inside ? 2600 : 20000, context.currentTime, 0.05);
        master.gain.setTargetAtTime(inside ? 0.9 : 0.8, context.currentTime, 0.05);
    };
    var silent = false;
    this.setSilent = function (value) { silent = value; master.gain.setTargetAtTime(value ? 0 : (this.inside ? 0.9 : 0.8), context.currentTime, 0.05); };
    this.setParams = function (p) { this.params = Object.assign({}, p); if(p && p.volume !== undefined) master.gain.setTargetAtTime(0.8 * p.volume, context.currentTime, 0.05); };
    this.connect = function (destination) { this.output.connect(destination); };
    this.disconnect = function () {
        voices.forEach(function (voice) { try { voice.source.stop(); } catch(e) { /* already stopped */ } });
        this.output.disconnect();
    };
};

// Loads the recordings: samples is the list of "sound.samples" of a car, and a recording is found by base + file (a URL), or is given by
// the car editor as { buffer } or { blob } instead of a file. Gives a promise of the sampler.
OpenRacer.EngineSampler.load = function (context, base, samples) {
    return Promise.all(samples.map(function (sample) {
        var data = sample.blob ? sample.blob.arrayBuffer() : fetch(base + sample.file).then(function (response) {
            if(!response.ok) throw new Error(sample.file + ": HTTP " + response.status);
            return response.arrayBuffer();
        });
        return Promise.resolve(data).then(function (bytes) {
            return context.decodeAudioData(bytes);
        }).then(function (buffer) {
            return { buffer: buffer, rpm: sample.rpm, load: sample.load };
        });
    })).then(function (layers) {
        return new OpenRacer.EngineSampler(context, layers);
    });
};
