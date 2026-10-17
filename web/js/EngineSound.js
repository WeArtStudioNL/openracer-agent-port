/*
 * EngineSound.js
 *
 * Description: The engine sound of the game: the physical model of EngineSynth.js, with the parameters of the car,
 *              that follows the engine speed and the throttle. Louder, with a lower sound, in the cockpit view.
 * Notes: Browsers only start audio after a key press or click, so the sound starts on the first such interaction.
 *        The sound is switched on and off, and its volume set, in the settings menu.
 */

var EngineSound = (function() {
    var ctx = null;
    var synth = null;
    var output = null;           // the volume of the whole sound
    var loading = false;
    var failed = null;           // why the sound does not work, if it does not
    var params = OpenRacer.engineSoundParams(null);
    var muted = false;
    var paused = false;          // silent while the game is paused
    var volume = 1;
    var inside = false;
    var enabledByUser = false;
    var rpm = 0, throttle = 0;

    // The squeal of the tyres: noise through a narrow filter (the howl) and a thin raw tone, that rise in pitch with the speed of the car and
    // are louder the harder the tyres slide. It is not heard on soft ground.
    var squeal = null;
    var squealLevel = 0, squealSpeed = 0;

    function makeSqueal() {
        var length = ctx.sampleRate * 2;
        var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        var data = buffer.getChannelData(0);
        for(var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        var noise = ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;
        var band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.Q.value = 9;
        band.frequency.value = 1700;
        var tone = ctx.createOscillator();
        tone.type = "sawtooth";
        tone.frequency.value = 1100;
        var toneBand = ctx.createBiquadFilter();
        toneBand.type = "bandpass";
        toneBand.Q.value = 14;
        toneBand.frequency.value = 2100;
        var gain = ctx.createGain();
        gain.gain.value = 0;
        var toneGain = ctx.createGain();
        toneGain.gain.value = 0.22;
        noise.connect(band);
        band.connect(gain);
        tone.connect(toneBand);
        toneBand.connect(toneGain);
        toneGain.connect(gain);
        gain.connect(output);
        noise.start();
        tone.start();
        return { gain: gain, band: band, tone: tone, toneBand: toneBand };
    }

    function level() {
        return (muted || paused) ? 0 : volume;
    }

    function start() {
        enabledByUser = true;
        if(failed) return;
        if(!ctx) {
            var AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if(!AudioContextClass || !window.AudioWorkletNode) {
                failed = "Engine sound needs a browser with AudioWorklet.";
                return;
            }
            ctx = new AudioContextClass();
            output = ctx.createGain();
            output.gain.value = level();
            output.connect(ctx.destination);
            squeal = makeSqueal();
        }
        if(ctx.state === "suspended") ctx.resume();
        if(!synth && !loading) {
            loading = true;
            OpenRacer.EngineSynth.load(ctx, "js/EngineSoundWorklet.js").then(function() {
                synth = new OpenRacer.EngineSynth(ctx, params);
                synth.connect(output);
                synth.setInside(inside);
                loading = false;
            }).catch(function(error) {
                failed = "Could not start the engine sound: " + error.message;
                console.error(error);
            });
        }
    }

    // Called every frame with the engine speed and the throttle position (0..1)
    function update(newRpm, newThrottle) {
        rpm = newRpm;
        throttle = newThrottle;
        if(squeal && ctx.state === "running" && (paused || muted)) squeal.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        if(!ctx || !synth || ctx.state !== "running") return;
        output.gain.setTargetAtTime(level(), ctx.currentTime, 0.05);
        synth.setRpm(rpm);
        synth.setThrottle(throttle);
    }

    // Called every frame with how hard the tyres slide (0..1) and the speed of the car (m/s)
    function setTyres(amount, speed) {
        squealLevel = amount;
        squealSpeed = speed;
        if(!ctx || !squeal || ctx.state !== "running") return;
        var pitch = 1 + Math.min(1, speed / 40) * 0.5 + amount * 0.15;
        var now = ctx.currentTime;
        squeal.gain.gain.setTargetAtTime((muted || paused ? 0 : volume) * (inside ? 0.12 : 0.3) * Math.pow(amount, 1.3), now, 0.05);
        squeal.band.frequency.setTargetAtTime(1500 * pitch, now, 0.08);
        squeal.toneBand.frequency.setTargetAtTime(1900 * pitch, now, 0.08);
        squeal.tone.frequency.setTargetAtTime(1000 * pitch, now, 0.08);
    }

    function status() {
        if(failed) return failed;
        if(muted) return "Engine sound: off";
        if(!enabledByUser || !ctx || ctx.state !== "running") return "Engine sound: press any key or click to enable";
        return "";
    }

    ["keydown", "mousedown", "touchstart"].forEach(function(name) {
        window.addEventListener(name, start, false);
    });

    // Silence the engine while the page is in the background, where no frames are updating it
    document.addEventListener("visibilitychange", function() {
        if(!ctx) return;
        if(document.hidden) ctx.suspend();
        else if(enabledByUser) ctx.resume();
    }, false);

    return {
        update: update,
        setTyres: setTyres,
        status: status,
        setMuted: function(value) { muted = value; },
        setPaused: function(value) { paused = value; },
        setVolume: function(value) { volume = value; },
        // the sound parameters of a car (its configuration, "sound"); also while the engine runs, for tuning
        setCar: function(config) {
            params = OpenRacer.engineSoundParams(config);
            if(synth) synth.setParams(params);
        },
        setParams: function(newParams) {
            params = Object.assign({}, newParams);
            if(synth) synth.setParams(params);
        },
        getParams: function() { return Object.assign({}, params); },
        // the sound is heard inside the car (cockpit camera): the outlet is far away, the engine close
        setInside: function(value) {
            inside = value;
            if(synth) synth.setInside(value);
        }
    };
})();
