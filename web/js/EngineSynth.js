/*
 * EngineSynth.js
 *
 * Description: The engine sound of a car: the physical model of EngineSoundWorklet.js with its mixer, and the parameters
 *              of a car (cars/<id>/car.json, "sound"). Used by the game (EngineSound.js) and by the car editor, which plays
 *              it while the parameters are set.
 *
 * Parameters of "sound" (all optional; what is missing is taken from the V8 preset):
 *   cylinders; intake_length, exhaust_length, extractor_length (the pipes of every cylinder, in samples at 44.1 kHz: the
 *   longer, the lower the resonance); intake_open, intake_closed, exhaust_open, exhaust_closed (how much of the wave a
 *   valve reflects when it is open or closed, 0 to 1); ignition_time (how long the burn lasts, as a part of the cycle);
 *   straight_pipe_length, straight_pipe_reflection; muffler (the lengths of the elements) and muffler_action (how much of the
 *   sound the muffler holds back, 0 to 1); outlet_length, outlet_reflection;
 *   volume (1 is the normal volume), mix_intake, mix_block, mix_outlet (the volume of the three parts of the sound).
 */

OpenRacer.engineSoundPresets = {
    "Inline-4": { cylinders: 4, intake_length: 100, exhaust_length: 100, extractor_length: 100, intake_open: 0.01, intake_closed: 0.95,
        exhaust_open: 0.01, exhaust_closed: 0.95, ignition_time: 0.016, straight_pipe_length: 128, straight_pipe_reflection: 0.01,
        muffler: [10, 15, 20, 25], muffler_action: 0.1, outlet_length: 5, outlet_reflection: 0.01, mix_intake: 1, mix_block: 1, mix_outlet: 1 },
    "Turbo inline-4": { cylinders: 4, intake_length: 80, exhaust_length: 90, extractor_length: 90, intake_open: 0.01, intake_closed: 0.9,
        exhaust_open: 0.01, exhaust_closed: 0.9, ignition_time: 0.014, straight_pipe_length: 140, straight_pipe_reflection: 0.02,
        muffler: [20, 30, 40, 50], muffler_action: 0.2, outlet_length: 6, outlet_reflection: 0.02, mix_intake: 1.4, mix_block: 0.8, mix_outlet: 0.8 },
    "V6": { cylinders: 6, intake_length: 90, exhaust_length: 110, extractor_length: 100, intake_open: 0.01, intake_closed: 0.95,
        exhaust_open: 0.01, exhaust_closed: 0.94, ignition_time: 0.014, straight_pipe_length: 140, straight_pipe_reflection: 0.01,
        muffler: [12, 18, 24, 30], muffler_action: 0.08, outlet_length: 6, outlet_reflection: 0.01, mix_intake: 1, mix_block: 1, mix_outlet: 1 },
    "V8 muscle": { cylinders: 8, intake_length: 120, exhaust_length: 140, extractor_length: 120, intake_open: 0.01, intake_closed: 0.95,
        exhaust_open: 0.01, exhaust_closed: 0.93, ignition_time: 0.018, straight_pipe_length: 160, straight_pipe_reflection: 0.01,
        muffler: [14, 20, 26, 32], muffler_action: 0.06, outlet_length: 8, outlet_reflection: 0.01, mix_intake: 0.8, mix_block: 1.2, mix_outlet: 1.1 },
    "Flat-6": { cylinders: 6, intake_length: 80, exhaust_length: 100, extractor_length: 90, intake_open: 0.01, intake_closed: 0.95,
        exhaust_open: 0.01, exhaust_closed: 0.95, ignition_time: 0.012, straight_pipe_length: 120, straight_pipe_reflection: 0.01,
        muffler: [10, 14, 20, 26], muffler_action: 0.08, outlet_length: 5, outlet_reflection: 0.01, mix_intake: 1.1, mix_block: 0.9, mix_outlet: 1.1 },
    "V10": { cylinders: 10, intake_length: 70, exhaust_length: 80, extractor_length: 80, intake_open: 0.01, intake_closed: 0.95,
        exhaust_open: 0.01, exhaust_closed: 0.95, ignition_time: 0.010, straight_pipe_length: 100, straight_pipe_reflection: 0.01,
        muffler: [8, 12, 16, 20], muffler_action: 0.04, outlet_length: 4, outlet_reflection: 0.01, mix_intake: 1, mix_block: 0.9, mix_outlet: 1.3 },
    "V12": { cylinders: 12, intake_length: 70, exhaust_length: 90, extractor_length: 80, intake_open: 0.01, intake_closed: 0.95,
        exhaust_open: 0.01, exhaust_closed: 0.95, ignition_time: 0.010, straight_pipe_length: 110, straight_pipe_reflection: 0.01,
        muffler: [10, 14, 18, 22], muffler_action: 0.06, outlet_length: 5, outlet_reflection: 0.01, mix_intake: 1, mix_block: 1, mix_outlet: 1.1 },
    "Straight pipes": { cylinders: 8, intake_length: 100, exhaust_length: 110, extractor_length: 100, intake_open: 0.01, intake_closed: 0.95,
        exhaust_open: 0.01, exhaust_closed: 0.95, ignition_time: 0.016, straight_pipe_length: 140, straight_pipe_reflection: 0.01,
        muffler: [4, 6, 8], muffler_action: 0.01, outlet_length: 4, outlet_reflection: 0.01, mix_intake: 0.6, mix_block: 0.8, mix_outlet: 1.6 }
};

OpenRacer.engineSoundDefaults = Object.assign({ volume: 1 }, OpenRacer.engineSoundPresets["V8 muscle"]);

// The sound parameters of a car configuration, with the default for what it does not give
OpenRacer.engineSoundParams = function (config) {
    var given = (config && config.sound) || {};
    var params = Object.assign({}, OpenRacer.engineSoundDefaults, given);
    params.muffler = (Array.isArray(given.muffler) && given.muffler.length ? given.muffler : OpenRacer.engineSoundDefaults.muffler).slice();
    return params;
};

// The loudness that the model has at a volume of 1: the model itself is much louder than a sound can be
var ENGINE_SOUND_LEVEL = 0.28;

OpenRacer.EngineSynth = function (context, params) {
    var self = this;
    this.context = context;
    this.params = Object.assign({}, params);

    // the names and the lengths (in samples at 44.1 kHz; the audio context may run at another rate) of the worklet
    function forWorklet(p) {
        var scale = context.sampleRate / 44100;
        var length = function (v) { return Math.max(1, Math.round(v * scale)); };
        return {
            cylinders: Math.max(1, Math.min(16, Math.round(p.cylinders))),
            intakeWaveguideLength: length(p.intake_length),
            exhaustWaveguideLength: length(p.exhaust_length),
            extractorWaveguideLength: length(p.extractor_length),
            intakeOpenReflectionFactor: p.intake_open,
            intakeClosedReflectionFactor: p.intake_closed,
            exhaustOpenReflectionFactor: p.exhaust_open,
            exhaustClosedReflectionFactor: p.exhaust_closed,
            ignitionTime: p.ignition_time,
            straightPipeWaveguideLength: length(p.straight_pipe_length),
            straightPipeReflectionFactor: p.straight_pipe_reflection,
            mufflerElementsLength: p.muffler.map(length),
            action: p.muffler_action,
            outletWaveguideLength: length(p.outlet_length),
            outletReflectionFactor: p.outlet_reflection
        };
    }

    this.node = new AudioWorkletNode(context, "engine-sound-processor", {
        numberOfInputs: 0, numberOfOutputs: 3, outputChannelCount: [1, 1, 1], processorOptions: forWorklet(this.params)
    });
    this.rpmParam = this.node.parameters.get("rpm");
    this.throttleParam = this.node.parameters.get("throttle");

    // the three parts of the sound: intake, engine block, outlet
    this.gains = [0, 1, 2].map(function (i) {
        var gain = context.createGain();
        self.node.connect(gain, i);
        return gain;
    });
    var bus = context.createGain();
    this.gains.forEach(function (gain) { gain.connect(bus); });
    // a lowpass for a sound that is heard inside the car, and a limiter against peaks
    this.filter = context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.7;
    var limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 10;
    limiter.ratio.value = 8;
    this.master = context.createGain();
    bus.connect(this.filter);
    this.filter.connect(limiter);
    // an engine is louder under load and at high speed
    this.dynamics = context.createGain();
    limiter.connect(this.dynamics);
    this.dynamics.connect(this.master);
    this.output = this.master;
    var lastRpm = 0, lastThrottle = 0;
    function dynamicsUpdate() {
        var level = (0.45 + 0.55 * lastThrottle) * (0.55 + 0.45 * Math.min(1, lastRpm / 6000));
        self.dynamics.gain.setTargetAtTime(level, context.currentTime, 0.04);
    }

    this.inside = false;
    this.silent = false;

    function apply() {
        var p = self.params;
        // inside the car the outlet is far away and the intake and the engine are close
        var mix = [p.mix_intake, p.mix_block, p.mix_outlet];
        var inside = self.inside ? [1.3, 1.3, 0.35] : [1, 1, 1];
        for (var i = 0; i < 3; i++) self.gains[i].gain.setTargetAtTime(mix[i] * inside[i], context.currentTime, 0.05);
        self.filter.frequency.setTargetAtTime(self.inside ? 1800 : 20000, context.currentTime, 0.08);
        self.master.gain.setTargetAtTime(self.silent ? 0 : ENGINE_SOUND_LEVEL * p.volume, context.currentTime, 0.05);
    }
    this.apply = apply;
    apply();

    // all the parameters at once; the model is built again, the engine does not have to stop
    this.setParams = function (p) {
        this.params = Object.assign({}, p);
        this.node.port.postMessage(forWorklet(this.params));
        apply();
    };
    this.setRpm = function (rpm) { lastRpm = Math.max(0, rpm); this.rpmParam.setTargetAtTime(lastRpm, context.currentTime, 0.02); dynamicsUpdate(); };
    this.setThrottle = function (throttle) { lastThrottle = Math.max(0, Math.min(1, throttle)); this.throttleParam.setTargetAtTime(lastThrottle, context.currentTime, 0.03); dynamicsUpdate(); };
    this.setInside = function (inside) { this.inside = inside; apply(); };
    this.setSilent = function (silent) { if(this.silent !== silent) { this.silent = silent; apply(); } };
    this.connect = function (destination) { this.output.connect(destination); };
    this.disconnect = function () { this.node.disconnect(); this.output.disconnect(); };
};

// Makes the audio context know the worklet (before the first EngineSynth)
OpenRacer.EngineSynth.load = function (context, url) {
    return context.audioWorklet.addModule(url);
};
