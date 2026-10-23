/*
 * EngineSound.js
 *
 * Description: The engine sound of the game: the combustion model of EngineSim.js with the parameters of the car ("sound.engine_sim"
 *              of car.json), that follows the engine speed, the throttle and the ignition; and the squeal of the tyres. Duller inside the car.
 * Notes: Browsers only start audio after a key press or click, so the sound starts on the first such interaction.
 *        The sound is switched on and off, and its volume set, in the settings menu.
 */

var EngineSound = (function() {
    var ctx = null;
    var synth = null;
    var output = null;           // the volume of the whole sound
    var loading = false;
    var failed = null;           // why the sound does not work, if it does not
    var simParams = OpenRacer.engineSimParams(null);
    var muted = false;
    var paused = false;          // silent while the game is paused
    var volume = 1;
    var inside = false;
    var enabledByUser = false;
    var rpm = 0, throttle = 0;

    // The squeal of the tyres. Other games play recordings of it (a loop of a squeal and one of a skid, mixed by how hard the tyre slides and
    // changed in pitch with the speed). If there is a recording in web/sounds/ (tyre-squeal.ogg, .mp3 or .wav) that is what is used here too;
    // without it the sound is made: the tone that a tyre makes when it sticks and slips again (a few raw tones, a bit inharmonic, that wobble),
    // some grit of the rubber and a low rumble. A filtered noise only gives a hiss, like a vacuum cleaner.
    var squeal = null;
    var squealLevel = 0, squealSpeed = 0;
    var analyser = null;         // to measure the level of the sound (the debug display, tests)
    var analyserData = null;
    var squealSample = null;     // the decoded recording, if there is one

    function noiseBuffer(seconds) {
        var length = Math.floor(ctx.sampleRate * seconds);
        var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        var data = buffer.getChannelData(0);
        for(var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    }

    function loadSquealSample() {
        var names = ["sounds/tyre-squeal.ogg", "sounds/tyre-squeal.mp3", "sounds/tyre-squeal.wav"];
        var tryNext = function(i) {
            if(i >= names.length) return;
            fetch(names[i]).then(function(response) {
                if(!response.ok) throw new Error("none");
                return response.arrayBuffer();
            }).then(function(data) { return ctx.decodeAudioData(data); }).then(function(buffer) {
                squealSample = buffer;
                if(squeal) squeal.useSample(buffer);
            }).catch(function() { tryNext(i + 1); });
        };
        tryNext(0);
    }

    function makeSqueal() {
        var out = ctx.createGain();
        out.gain.value = 0;
        out.connect(output);

        // the tone: raw oscillators that wobble a little, the way the stick and slip of the rubber does
        var tone = ctx.createGain();
        tone.gain.value = 0.5;
        var oscillators = [[ "sawtooth", 1, 0.5 ], [ "sawtooth", 1.012, 0.35 ], [ "square", 1.51, 0.12 ], [ "triangle", 0.5, 0.3 ]].map(function(def) {
            var o = ctx.createOscillator();
            o.type = def[0];
            o.frequency.value = 800 * def[1];
            var g = ctx.createGain();
            g.gain.value = def[2];
            o.connect(g);
            g.connect(tone);
            o.start();
            return { osc: o, ratio: def[1] };
        });
        // the wobble: a fast one and a slow one that drifts
        var lfos = [[9, 0.025], [1.3, 0.05]].map(function(def) {
            var l = ctx.createOscillator();
            l.frequency.value = def[0];
            var depth = ctx.createGain();
            depth.gain.value = 800 * def[1];
            l.connect(depth);
            oscillators.forEach(function(o) { depth.connect(o.osc.frequency); });
            l.start();
            return { depth: depth, relative: def[1] };
        });
        var formant = ctx.createBiquadFilter();
        formant.type = "bandpass";
        formant.Q.value = 1.1;
        formant.frequency.value = 2300;
        tone.connect(formant);
        formant.connect(out);

        // the grit: noise at the top that rattles at the speed of the stick and slip
        var grit = ctx.createBufferSource();
        grit.buffer = noiseBuffer(2);
        grit.loop = true;
        var gritHigh = ctx.createBiquadFilter();
        gritHigh.type = "highpass";
        gritHigh.frequency.value = 2500;
        var gritGain = ctx.createGain();
        gritGain.gain.value = 0.1;
        var rattle = ctx.createOscillator();
        rattle.frequency.value = 38;
        var rattleDepth = ctx.createGain();
        rattleDepth.gain.value = 0.08;
        rattle.connect(rattleDepth);
        rattleDepth.connect(gritGain.gain);
        grit.connect(gritHigh);
        gritHigh.connect(gritGain);
        gritGain.connect(out);
        grit.start();
        rattle.start();

        // the rumble of rubber that is dragged over the road
        var rumble = ctx.createBufferSource();
        rumble.buffer = noiseBuffer(2);
        rumble.loop = true;
        var rumbleLow = ctx.createBiquadFilter();
        rumbleLow.type = "lowpass";
        rumbleLow.frequency.value = 280;
        var rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 0.5;
        rumble.connect(rumbleLow);
        rumbleLow.connect(rumbleGain);
        rumbleGain.connect(out);
        rumble.start();

        // a recording, if there is one: it replaces all of the above
        var sampleSource = null;
        var sampleGain = ctx.createGain();
        sampleGain.gain.value = 0;
        sampleGain.connect(output);

        return {
            gain: out,
            useSample: function(buffer) {
                if(sampleSource) return;
                sampleSource = ctx.createBufferSource();
                sampleSource.buffer = buffer;
                sampleSource.loop = true;
                sampleSource.connect(sampleGain);
                sampleSource.start();
                out.gain.cancelScheduledValues(0);
                out.gain.value = 0;
            },
            // amount 0..1 (how hard the tyres slide), speed in m/s
            set: function(amount, speed, loudness, now) {
                // a tyre that only starts to slide is silent: the sound comes in from a good slide (above 0.2) and is soft at first, and it comes in slowly (not a squeak at every touch of the limit)
                amount = Math.max(0, (amount - 0.2) / 0.8);
                loudness *= 0.75;
                var base = 640 + Math.min(1, speed / 40) * 420 + amount * 90;
                oscillators.forEach(function(o) { o.osc.frequency.setTargetAtTime(base * o.ratio, now, 0.08); });
                lfos.forEach(function(l) { l.depth.gain.setTargetAtTime(base * l.relative, now, 0.1); });
                formant.frequency.setTargetAtTime(base * 2.8, now, 0.1);
                rumbleGain.gain.setTargetAtTime(0.2 + 0.6 * amount, now, 0.1);
                var attack = amount > (this.last || 0) ? 0.12 : 0.08;
                this.last = amount;
                if(sampleSource) {
                    sampleSource.playbackRate.setTargetAtTime(0.85 + Math.min(1, speed / 40) * 0.4 + amount * 0.1, now, 0.1);
                    sampleGain.gain.setTargetAtTime(loudness * Math.pow(amount, 1.6), now, attack);
                } else {
                    out.gain.setTargetAtTime(loudness * Math.pow(amount, 1.6), now, attack);
                }
            },
            mute: function(now) {
                out.gain.setTargetAtTime(0, now, 0.05);
                sampleGain.gain.setTargetAtTime(0, now, 0.05);
            }
        };
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
            analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            output.connect(analyser);
            squeal = makeSqueal();
            loadSquealSample();
        }
        if(ctx.state === "suspended") ctx.resume();
        if(!synth && !loading) {
            loading = true;
            // the combustion model, with the impulse response of its exhaust (without it the sound is dry)
            var made = OpenRacer.EngineSimSynth.load(ctx, "js/EngineSimWorklet.js").then(function() {
                return OpenRacer.EngineSimSynth.loadImpulseResponse(ctx, "sounds/ir/", simParams.impulse_response).catch(function(error) {
                    console.error("Impulse response: " + error.message);
                    return null;
                });
            }).then(function(ir) {
                return new OpenRacer.EngineSimSynth(ctx, simParams, ir && ir.buffer);
            });
            made.then(function(voice) {
                synth = voice;
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
    function update(newRpm, newThrottle, ignition) {
        rpm = newRpm;
        throttle = newThrottle;
        if(synth && synth.setIgnition && ctx && ctx.state === "running") synth.setIgnition(ignition !== false);
        if(squeal && ctx.state === "running" && (paused || muted)) squeal.mute(ctx.currentTime);
        if(!ctx || !synth || ctx.state !== "running") return;
        output.gain.setTargetAtTime(level(), ctx.currentTime, 0.05);
        synth.setRpm(rpm);
        synth.setThrottle(throttle);
    }

    // A bang in the exhaust (pops, anti-lag): the strength is about 0.5 to 1.5, the loudness a factor
    function pop(strength, loud) {
        if(synth && synth.pop && ctx && ctx.state === "running" && !muted && !paused) synth.pop(600 * strength * loud);
    }

    // Called every frame with how hard the tyres slide (0..1) and the speed of the car (m/s)
    function setTyres(amount, speed) {
        if(!isFinite(amount)) amount = 0;           // (a number that is not a number cannot go to the audio)
        if(!isFinite(speed)) speed = 0;
        squealLevel = amount;
        squealSpeed = speed;
        if(!ctx || !squeal || ctx.state !== "running") return;
        squeal.set(amount, speed, (muted || paused ? 0 : volume) * (inside ? 0.12 : 0.3), ctx.currentTime);
    }

    // ---- the road under the tyres, and what lands: noise that is made here (no files). The tyres on loose ground hiss, crunch or squelch with the speed (sand low and soft, gravel
    // high and sharp, mud dull, grass soft); a landing or the bump stop is a thud (low noise and a falling tone) as loud as it was hard.
    var landNoiseBuffer = null, ground = null;
    var GROUND_SOUND = { sand: [700, 0.5, 0.5, "lowpass"], gravel: [2600, 1.2, 0.8, "bandpass"], mud: [380, 0.7, 0.7, "lowpass"], grass: [1100, 0.5, 0.35, "lowpass"], ground: [1500, 0.7, 0.5, "lowpass"] };
    function landNoise() {
        if(landNoiseBuffer) return landNoiseBuffer;
        landNoiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        var data = landNoiseBuffer.getChannelData(0);
        for(var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        return landNoiseBuffer;
    }
    function setGround(kind, speed) {
        if(!ctx || ctx.state !== "running" || !isFinite(speed)) return;
        var spec = GROUND_SOUND[kind];
        if(!ground) {
            var source = ctx.createBufferSource();
            source.buffer = landNoise(); source.loop = true;
            var filter = ctx.createBiquadFilter();
            var gain = ctx.createGain();
            gain.gain.value = 0;
            source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
            source.start();
            ground = { filter: filter, gain: gain };
        }
        var now = ctx.currentTime;
        var loud = spec ? Math.min(1, Math.max(0, speed - 2) / 25) * spec[1] * (muted || paused ? 0 : volume) * (inside ? 0.35 : 0.5) * 0.25 : 0;
        if(spec) { ground.filter.type = spec[3]; ground.filter.frequency.setTargetAtTime(spec[0] * (0.7 + 0.5 * Math.min(1, speed / 30)), now, 0.2); ground.filter.Q.value = spec[3] === "bandpass" ? 0.8 : 0.5; }
        ground.gain.gain.setTargetAtTime(loud, now, 0.15);
    }
    function impact(strength) {
        if(!ctx || ctx.state !== "running" || muted || paused || !isFinite(strength) || strength < 0.12) return;
        strength = Math.min(1, strength);
        var now = ctx.currentTime, v = volume * (inside ? 0.7 : 1);
        var source = ctx.createBufferSource();
        source.buffer = landNoise();
        var low = ctx.createBiquadFilter();
        low.type = "lowpass"; low.frequency.value = 260 + 500 * strength;
        var gain = ctx.createGain();
        gain.gain.setValueAtTime(0.9 * strength * v, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18 + 0.3 * strength);
        source.connect(low); low.connect(gain); gain.connect(ctx.destination);
        source.start(now, Math.random()); source.stop(now + 0.6);
        var tone = ctx.createOscillator(), toneGain = ctx.createGain();
        tone.frequency.setValueAtTime(95, now);
        tone.frequency.exponentialRampToValueAtTime(38, now + 0.22);
        toneGain.gain.setValueAtTime(0.7 * strength * v, now);
        toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        tone.connect(toneGain); toneGain.connect(ctx.destination);
        tone.start(now); tone.stop(now + 0.3);
    }

    // The synth follows the parameters of the car, with the impulse response of its exhaust
    function applyParams(p) {
        simParams = p;
        if(!synth) return;
        synth.setParams(simParams);
        if(synth.impulseResponseName !== simParams.impulse_response && ctx) {
            OpenRacer.EngineSimSynth.loadImpulseResponse(ctx, "sounds/ir/", simParams.impulse_response).then(function(ir) {
                if(synth) synth.setImpulseResponse(ir.buffer, ir.name);
            }).catch(function(error) { console.error("Impulse response: " + error.message); });
        }
    }

    function status() {
        if(failed) return failed;
        if(muted) return "Engine sound: off";
        if(!enabledByUser || !ctx || ctx.state !== "running") return "Engine sound: " + (typeof TouchControls !== "undefined" && TouchControls.enabled() ? "tap the screen" : "press any key or click") + " to enable";
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

    // The level of the sound that is played (RMS, 0..1), for the debug display and tests
    function measureLevel() {
        if(!analyser) return 0;
        if(!analyserData) analyserData = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(analyserData);
        var sum = 0;
        for(var i = 0; i < analyserData.length; i++) sum += analyserData[i] * analyserData[i];
        return Math.sqrt(sum / analyserData.length);
    }

    return {
        update: update,
        pop: pop,
        level: measureLevel,
        setTyres: setTyres,
        setGround: setGround,
        impact: impact,
        status: status,
        setMuted: function(value) { muted = value; },
        setPaused: function(value) { paused = value; },
        setVolume: function(value) { volume = value; },
        // the sound parameters of a car (its configuration, "sound.engine_sim"); also while the engine runs, for tuning
        setCar: function(config) {
            applyParams(OpenRacer.engineSimParams(config));
        },
        // some of the parameters (the tuning menu)
        setParams: function(newParams) {
            applyParams(OpenRacer.engineSimParams({ sound: { engine_sim: Object.assign({}, simParams, newParams) } }));
        },
        getParams: function() { return Object.assign({}, simParams); },
        // the sound is heard inside the car (cockpit camera): the outlet is far away, the engine close
        setInside: function(value) {
            inside = value;
            if(synth) synth.setInside(value);
        }
    };
})();
