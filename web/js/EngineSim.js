/*
 * EngineSim.js
 *
 * Description: The engine sound that is calculated from the combustion (EngineSimWorklet.js, after engine-sim of Ange Yaghi): the
 *              parameters of a car ("sound.engine_sim" of car.json, used when "sound.model" is "engine-sim"), the layouts and presets,
 *              and the sound in the audio graph: the worklet, the convolution with the impulse response of an exhaust, and the
 *              volume. Used by the game (EngineSound.js) and by the car editor, which plays it while the parameters are set.
 *
 * Parameters of "engine_sim" (all optional; what is missing is taken from the defaults):
 *   layout (see engineSimLayouts: which cylinders fire when and on which exhaust system);
 *   bore, stroke, rod (mm), compression_ratio;
 *   intake_duration, exhaust_duration (crank degrees at 50 thou of lift), intake_lift, exhaust_lift (mm), lobe_gamma (the shape of the
 *   lobe: 1 is a raised cosine, more is pointier), intake_lobe_centre (degrees after TDC), exhaust_lobe_centre (degrees before TDC);
 *   intake_flow, exhaust_flow (the flow of a port at full lift, cfm at 28 inH2O);
 *   exhaust_runner_volume (cc), primary_area (cm2), primary_length (m), primary_flow (cfm), collector_area (cm2), exhaust_length (m),
 *   outlet_flow (cfm), exhaust_systems (1 or 2), audio_volume;
 *   idle_pressure (the manifold pressure with the throttle closed, as a part of the atmosphere), throttle_gamma;
 *   burn_duration (crank degrees), burn_efficiency, burn_randomness, afterfire_temperature (K: unburnt mixture bangs in an exhaust
 *   that is hotter), timing ([[rpm, degrees of advance], ...]);
 *   simulation_frequency (Hz), fluid_steps, input_cutoff (Hz), hf_gain, noise, noise_cutoff, jitter, jitter_cutoff, leveler_target,
 *   leveler_max_gain, signal_scale;
 *   impulse_response (the name of one of engineSimImpulseResponses), convolution (0 to 1), volume.
 */

// The layouts: the cylinders in the order in which they fire, evenly spaced over the 720 degree cycle, and for each the exhaust
// system it is on (0 or 1; with one exhaust system all are on 0). The pattern of the exhaust systems is what gives a crossplane V8
// its burble: two cylinders of the same bank fire after each other.
OpenRacer.engineSimLayouts = {
    "single": { label: "Single cylinder", cylinders: 1, exhaust: [0] },
    "inline-2": { label: "Inline 2 (parallel twin, 360 degrees)", cylinders: 2, exhaust: [0, 0] },
    "inline-3": { label: "Inline 3", cylinders: 3, exhaust: [0, 0, 0] },
    "inline-4": { label: "Inline 4", cylinders: 4, exhaust: [0, 0, 0, 0] },
    "inline-5": { label: "Inline 5", cylinders: 5, exhaust: [0, 0, 0, 0, 0] },
    "inline-6": { label: "Inline 6", cylinders: 6, exhaust: [0, 1, 0, 1, 0, 1] },
    "v6": { label: "V6", cylinders: 6, exhaust: [0, 1, 0, 1, 0, 1] },
    "v8-crossplane": { label: "V8 crossplane", cylinders: 8, exhaust: [0, 1, 1, 0, 1, 0, 0, 1] },
    "v8-flatplane": { label: "V8 flatplane", cylinders: 8, exhaust: [0, 1, 0, 1, 0, 1, 0, 1] },
    "v10": { label: "V10", cylinders: 10, exhaust: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1] },
    "v12": { label: "V12", cylinders: 12, exhaust: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1] },
    "flat-4": { label: "Flat 4 (boxer)", cylinders: 4, exhaust: [0, 0, 1, 1] },
    "flat-6": { label: "Flat 6 (boxer)", cylinders: 6, exhaust: [0, 1, 0, 1, 0, 1] }
};

// The impulse responses of exhausts that come with the game (web/sounds/ir, from engine-sim, MIT license)
OpenRacer.engineSimImpulseResponses = [
    { id: "smooth_39", label: "Smooth", file: "smooth_39.wav" },
    { id: "minimal_muffling_01", label: "Open exhaust 1", file: "minimal_muffling_01.wav" },
    { id: "minimal_muffling_02", label: "Open exhaust 2", file: "minimal_muffling_02.wav" },
    { id: "minimal_muffling_03", label: "Open exhaust 3", file: "minimal_muffling_03.wav" },
    { id: "mild_exhaust", label: "Mild exhaust", file: "mild_exhaust.wav" },
    { id: "sharp_01", label: "Sharp (race)", file: "sharp_01.wav" },
    // our own: pipes and mufflers as delay lines (see engineSimExhausts)
    { id: "exhaust_standard", label: "Standard muffler", file: "exhaust_standard.wav" },
    { id: "exhaust_sport", label: "Sport resonator", file: "exhaust_sport.wav" },
    { id: "exhaust_performance", label: "Performance cat-back", file: "exhaust_performance.wav" },
    { id: "exhaust_straight", label: "Straight cut", file: "exhaust_straight.wav" },
    { id: "exhaust_open", label: "Open headers", file: "exhaust_open.wav" }
];

// The exhausts to choose from ("exhaust_type" of engine_sim). The impulse response alone hardly changes an engine sound (the engine gives a narrow band, around
// the firing frequency, and a convolution cannot add what is not there), so a type is a whole chain: the impulse response and how much of it, a drive (the pulses
// of an exhaust without a muffler are sharp: the harmonics that give it the rasp), a bass, a mid and a treble, a lowpass (the muffler), the volume, and what the
// exhaust does to the engine: the flow at the outlet and the length of the pipe (EngineSimWorklet.js). "custom" is the old way: the impulse response and the
// amount of the fields.
OpenRacer.engineSimExhausts = {
    standard: { label: "Standard", hint: "stock muffler: dark, quiet, boomy", ir: "exhaust_standard", wet: 1.0, drive: 0, lowpass: 2500, bass: 3, mid: 0, midHz: 600, treble: 0, volume: 0.9, outlet: 0.7, length: 1.15 },
    sport: { label: "Sport", hint: "resonator: fuller, more mid range", ir: "exhaust_sport", wet: 0.9, drive: 2.5, lowpass: 6000, bass: 0, mid: 6, midHz: 700, treble: 2, volume: 1.0, outlet: 1.0, length: 1.0 },
    performance: { label: "Performance", hint: "free-flowing cat-back: louder, edgier", ir: "exhaust_performance", wet: 0.8, drive: 4, lowpass: 10000, bass: -2, mid: 8, midHz: 1100, treble: 4, volume: 1.05, outlet: 1.6, length: 0.9 },
    straight: { label: "Straight cut", hint: "no muffler: raw and raspy", ir: "exhaust_straight", wet: 0.7, drive: 5, lowpass: 20000, bass: -3, mid: 6, midHz: 1400, treble: 4, volume: 1.15, outlet: 2.5, length: 0.6 },
    open: { label: "Open headers", hint: "race: loud and cracking", ir: "exhaust_open", wet: 0.5, drive: 8, lowpass: 20000, bass: -6, mid: 6, midHz: 2000, treble: 6, volume: 1.2, outlet: 4, length: 0.35 },
    quiet: { label: "Quiet", hint: "touring: muffled and soft", ir: "mild_exhaust", wet: 1.0, drive: 0, lowpass: 1600, bass: 4, mid: -2, midHz: 600, treble: -3, volume: 0.8, outlet: 0.4, length: 1.4 }
};

OpenRacer.engineSimPresets = {
    "Single 0.25 L (kart)": { layout: "single", bore: 70, stroke: 65, rod: 105, compression_ratio: 9.0, intake_duration: 232, exhaust_duration: 226,
        intake_lift: 8.0, exhaust_lift: 7.5, intake_lobe_centre: 108, exhaust_lobe_centre: 108, intake_flow: 110, exhaust_flow: 90,
        primary_length: 0.25, primary_flow: 90, exhaust_length: 0.9, outlet_flow: 160, exhaust_systems: 1, impulse_response: "minimal_muffling_03" },
    "Single 0.4 L": { layout: "single", bore: 88, stroke: 64, rod: 110, compression_ratio: 8.5, intake_duration: 220, exhaust_duration: 216,
        intake_lift: 8.5, exhaust_lift: 8.0, intake_lobe_centre: 110, exhaust_lobe_centre: 110, intake_flow: 130, exhaust_flow: 105,
        primary_length: 0.3, primary_flow: 100, exhaust_length: 1.2, outlet_flow: 200, exhaust_systems: 1, impulse_response: "minimal_muffling_02" },
    "Twin 0.8 L (parallel)": { layout: "inline-2", bore: 80, stroke: 80, rod: 130, compression_ratio: 10.0, intake_duration: 228, exhaust_duration: 224,
        intake_lift: 9.0, exhaust_lift: 8.5, intake_lobe_centre: 110, exhaust_lobe_centre: 110, intake_flow: 170, exhaust_flow: 140,
        primary_length: 0.35, primary_flow: 140, exhaust_length: 1.8, outlet_flow: 300, exhaust_systems: 1, impulse_response: "minimal_muffling_02" },
    "Inline-3 1.0 L": { layout: "inline-3", bore: 74, stroke: 77.1, rod: 130, compression_ratio: 10.5, intake_duration: 230, exhaust_duration: 226,
        intake_lift: 9.2, exhaust_lift: 8.8, intake_lobe_centre: 110, exhaust_lobe_centre: 110, intake_flow: 200, exhaust_flow: 160,
        primary_length: 0.4, primary_flow: 160, exhaust_length: 2.0, outlet_flow: 380, exhaust_systems: 1, impulse_response: "minimal_muffling_01" },
    // motorcycles: small, high revving, a short exhaust that is open and sharp
    "Single 0.65 L (thumper)": { layout: "single", bore: 100, stroke: 82.6, rod: 130, compression_ratio: 10.0, intake_duration: 236, exhaust_duration: 232,
        intake_lift: 9.5, exhaust_lift: 9.0, intake_lobe_centre: 108, exhaust_lobe_centre: 108, intake_flow: 160, exhaust_flow: 130,
        primary_length: 0.4, primary_flow: 130, exhaust_length: 1.1, outlet_flow: 260, exhaust_systems: 1, impulse_response: "mild_exhaust" },
    "Inline-3 0.8 L (triple)": { layout: "inline-3", bore: 78, stroke: 56, rod: 108, compression_ratio: 12.0, intake_duration: 250, exhaust_duration: 246,
        intake_lift: 9.5, exhaust_lift: 8.8, intake_lobe_centre: 108, exhaust_lobe_centre: 108, intake_flow: 120, exhaust_flow: 100,
        primary_length: 0.3, primary_flow: 100, exhaust_length: 1.0, outlet_flow: 300, exhaust_systems: 1, impulse_response: "sharp_01" },
    "Inline-4 0.6 L (supersport)": { layout: "inline-4", bore: 67, stroke: 42.5, rod: 100, compression_ratio: 12.2, intake_duration: 256, exhaust_duration: 250,
        intake_lift: 9.0, exhaust_lift: 8.2, intake_lobe_centre: 106, exhaust_lobe_centre: 106, intake_flow: 105, exhaust_flow: 85,
        primary_length: 0.3, primary_flow: 90, exhaust_length: 1.0, outlet_flow: 300, exhaust_systems: 1, impulse_response: "sharp_01",
        timing: [[0, 10], [2000, 14], [6000, 28], [10000, 36], [14000, 40], [17000, 40]], input_cutoff: 3500, noise_cutoff: 3500 },
    "Inline-4 1.0 L (superbike)": { layout: "inline-4", bore: 76, stroke: 55, rod: 104, compression_ratio: 13.0, intake_duration: 254, exhaust_duration: 248,
        intake_lift: 10.0, exhaust_lift: 9.0, intake_lobe_centre: 106, exhaust_lobe_centre: 106, intake_flow: 140, exhaust_flow: 115,
        primary_length: 0.32, primary_flow: 110, exhaust_length: 1.1, outlet_flow: 380, exhaust_systems: 1, impulse_response: "sharp_01",
        timing: [[0, 10], [2000, 14], [6000, 28], [10000, 36], [14000, 40], [16000, 40]], input_cutoff: 3000, noise_cutoff: 3000 },
    "Inline-4 2.0 L": { layout: "inline-4", bore: 86, stroke: 86, rod: 143, compression_ratio: 10.5, intake_duration: 228, exhaust_duration: 228,
        intake_lift: 9.5, exhaust_lift: 9.0, intake_lobe_centre: 110, exhaust_lobe_centre: 110, intake_flow: 230, exhaust_flow: 180,
        primary_length: 0.45, primary_flow: 180, exhaust_length: 2.4, outlet_flow: 450, exhaust_systems: 1, impulse_response: "minimal_muffling_02" },
    "Inline-5 2.2 L": { layout: "inline-5", bore: 81, stroke: 86.4, rod: 144, compression_ratio: 9.3, intake_duration: 232, exhaust_duration: 232,
        intake_lift: 10, exhaust_lift: 10, intake_lobe_centre: 110, exhaust_lobe_centre: 110, intake_flow: 220, exhaust_flow: 170,
        primary_length: 0.4, primary_flow: 180, exhaust_length: 2.6, outlet_flow: 500, exhaust_systems: 2, impulse_response: "smooth_39" },
    "Inline-6 3.0 L": { layout: "inline-6", bore: 84, stroke: 89.6, rod: 135, compression_ratio: 10.2, intake_duration: 236, exhaust_duration: 232,
        intake_lift: 9.7, exhaust_lift: 9.5, intake_lobe_centre: 112, exhaust_lobe_centre: 110, intake_flow: 240, exhaust_flow: 190,
        primary_length: 0.5, primary_flow: 200, exhaust_length: 2.8, outlet_flow: 550, exhaust_systems: 2, impulse_response: "minimal_muffling_01" },
    "V6 3.5 L": { layout: "v6", bore: 94, stroke: 83, rod: 150, compression_ratio: 10.8, intake_duration: 236, exhaust_duration: 232,
        intake_lift: 10, exhaust_lift: 9.5, intake_lobe_centre: 112, exhaust_lobe_centre: 110, intake_flow: 260, exhaust_flow: 200,
        primary_length: 0.4, primary_flow: 220, exhaust_length: 2.6, outlet_flow: 600, exhaust_systems: 2, impulse_response: "smooth_39" },
    "V8 5.7 L crossplane": { layout: "v8-crossplane", bore: 101.6, stroke: 88.4, rod: 146, compression_ratio: 9.5, intake_duration: 232, exhaust_duration: 232,
        intake_lift: 12, exhaust_lift: 12, intake_lobe_centre: 110, exhaust_lobe_centre: 110, intake_flow: 260, exhaust_flow: 210,
        primary_length: 0.5, primary_flow: 220, exhaust_length: 2.8, outlet_flow: 650, exhaust_systems: 2, impulse_response: "smooth_39" },
    "V8 4.5 L flatplane": { layout: "v8-flatplane", bore: 94, stroke: 81, rod: 140, compression_ratio: 12.5, intake_duration: 250, exhaust_duration: 246,
        intake_lift: 11, exhaust_lift: 10.5, intake_lobe_centre: 108, exhaust_lobe_centre: 108, intake_flow: 280, exhaust_flow: 230,
        primary_length: 0.45, primary_flow: 260, exhaust_length: 2.2, outlet_flow: 800, exhaust_systems: 2, impulse_response: "sharp_01" },
    "V10 5.2 L": { layout: "v10", bore: 84.5, stroke: 92.8, rod: 154, compression_ratio: 12.5, intake_duration: 248, exhaust_duration: 244,
        intake_lift: 11, exhaust_lift: 10.5, intake_lobe_centre: 110, exhaust_lobe_centre: 108, intake_flow: 260, exhaust_flow: 210,
        primary_length: 0.45, primary_flow: 240, exhaust_length: 2.4, outlet_flow: 800, exhaust_systems: 2, impulse_response: "minimal_muffling_03" },
    "V12 6.0 L": { layout: "v12", bore: 89, stroke: 80, rod: 138, compression_ratio: 11.5, intake_duration: 244, exhaust_duration: 240,
        intake_lift: 10.5, exhaust_lift: 10, intake_lobe_centre: 110, exhaust_lobe_centre: 108, intake_flow: 250, exhaust_flow: 200,
        primary_length: 0.4, primary_flow: 220, exhaust_length: 2.6, outlet_flow: 800, exhaust_systems: 2, impulse_response: "smooth_39" },
    "Flat-4 2.5 L": { layout: "flat-4", bore: 99.5, stroke: 79, rod: 130.6, compression_ratio: 10, intake_duration: 232, exhaust_duration: 236,
        intake_lift: 9.8, exhaust_lift: 9.6, intake_lobe_centre: 117, exhaust_lobe_centre: 112, intake_flow: 280, exhaust_flow: 245,
        primary_length: 1.0, primary_flow: 400, exhaust_length: 2.0, outlet_flow: 1000, exhaust_systems: 2, impulse_response: "minimal_muffling_02" },
    "Flat-6 3.8 L": { layout: "flat-6", bore: 102, stroke: 77.5, rod: 128, compression_ratio: 12.5, intake_duration: 246, exhaust_duration: 242,
        intake_lift: 11, exhaust_lift: 10.5, intake_lobe_centre: 110, exhaust_lobe_centre: 108, intake_flow: 290, exhaust_flow: 240,
        primary_length: 0.6, primary_flow: 260, exhaust_length: 2.2, outlet_flow: 800, exhaust_systems: 2, impulse_response: "sharp_01" }
};

OpenRacer.engineSimDefaults = Object.assign({
    exhaust_type: "custom",
    lobe_gamma: 1.0, exhaust_runner_volume: 100, primary_area: 10, collector_area: 20, audio_volume: 1,
    idle_pressure: 0.35, throttle_gamma: 2.0, burn_duration: 45, burn_efficiency: 0.85, burn_randomness: 0.2, afterfire_temperature: 650,
    timing: [[0, 12], [1000, 12], [2000, 20], [3000, 26], [4000, 30], [5000, 34], [6000, 38], [9000, 38]],
    simulation_frequency: 10000, fluid_steps: 2, input_cutoff: 1900, hf_gain: 0.01, noise: 1.0, noise_cutoff: 2000, jitter: 0.5, jitter_cutoff: 10000,
    leveler_target: 0.5, leveler_max_gain: 12, signal_scale: 4e-5, convolution: 1.0, volume: 1
}, OpenRacer.engineSimPresets["V8 5.7 L crossplane"]);

// The engine-sim parameters of a car configuration, with the default for what it does not give
OpenRacer.engineSimParams = function (config) {
    var given = (config && config.sound && config.sound.engine_sim) || {};
    var params = Object.assign({}, OpenRacer.engineSimDefaults, given);
    if (!OpenRacer.engineSimLayouts[params.layout]) params.layout = OpenRacer.engineSimDefaults.layout;
    if (!Array.isArray(params.timing) || !params.timing.length) params.timing = OpenRacer.engineSimDefaults.timing;
    params.timing = params.timing.map(function (p) { return [p[0], p[1]]; });
    var exhaust = OpenRacer.engineSimExhausts[params.exhaust_type];
    if (exhaust) { params.impulse_response = exhaust.ir; params.convolution = exhaust.wet; }       // (the type decides; a car without one keeps its own impulse response)
    return params;
};

// What the worklet is built from: the parameters, with the cylinders of the layout (when they fire, their exhaust system, the length
// of their primary tube and how loud they are, which differ a little from cylinder to cylinder as they do in a real engine)
OpenRacer.engineSimWorkletOptions = function (params) {
    var layout = OpenRacer.engineSimLayouts[params.layout] || OpenRacer.engineSimLayouts["inline-4"];
    var lengths = [1, 1.15, 0.9, 1.05, 1.1, 0.95, 1.2, 1.0, 1.08, 0.92, 1.12, 0.98];
    var attenuation = [0.9, 1.1, 0.8, 0.85, 0.9, 1.1, 0.8, 0.75, 1.0, 0.95, 1.05, 0.9];
    var count = layout.cylinders;
    var systems = params.exhaust_systems >= 2 ? 2 : 1;
    var cylinders = [];
    for (var i = 0; i < count; i++) {
        cylinders.push({
            fire: i * 720 / count,
            exhaust: systems === 2 ? layout.exhaust[i] : 0,
            primary: params.primary_length * lengths[i % lengths.length],
            attenuation: attenuation[i % attenuation.length]
        });
    }
    var options = Object.assign({}, params);
    var exhaust = OpenRacer.engineSimExhausts[params.exhaust_type];
    if (exhaust) { options.outlet_flow = params.outlet_flow * exhaust.outlet; options.exhaust_length = params.exhaust_length * exhaust.length; }       // (what the exhaust does to the engine itself)
    options.cylinders = cylinders;
    options.exhaust_systems = systems;
    return options;
};

var ENGINE_SIM_LEVEL = 0.5; // the loudness at a volume of 1

// the rms of tanh(k x) for a signal x with an rms of ENGINE_SIM_SIGNAL (a normal distribution), to put the level back after the drive of an exhaust
var ENGINE_SIM_SIGNAL = 0.14;       // (measured: the signal at that point of the graph)
function shaperRms(k) {
    var sum = 0, weight = 0;
    for (var g = -4; g <= 4.0001; g += 0.2) { var w = Math.exp(-g * g / 2), t = Math.tanh(k * ENGINE_SIM_SIGNAL * g); sum += w * t * t; weight += w; }
    return Math.sqrt(sum / weight);
}

OpenRacer.EngineSimSynth = function (context, params, impulseResponse) {
    var self = this;
    this.context = context;
    this.params = OpenRacer.engineSimParams({ sound: { engine_sim: params } });
    var options = OpenRacer.engineSimWorkletOptions(this.params);
    var outputs = options.exhaust_systems;
    this.node = new AudioWorkletNode(context, "engine-sim-processor", {
        numberOfInputs: 0, numberOfOutputs: outputs, outputChannelCount: outputs === 2 ? [1, 1] : [1], processorOptions: options
    });
    this.rpmParam = this.node.parameters.get("rpm");
    this.throttleParam = this.node.parameters.get("throttle");
    this.ignitionParam = this.node.parameters.get("ignition");

    // the exhaust systems together, then the dry sound and the sound through the exhaust (the convolution), the way engine-sim mixes them
    var sum = context.createGain();
    for (var i = 0; i < outputs; i++) this.node.connect(sum, i);
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.convolver = context.createConvolver();
    this.convolver.normalize = true;
    if (impulseResponse) this.convolver.buffer = impulseResponse;
    sum.connect(this.dry);
    sum.connect(this.convolver);
    this.convolver.connect(this.wet);
    var bus = context.createGain();
    this.dry.connect(bus);
    this.wet.connect(bus);
    // the exhaust: the drive (sharp pulses give harmonics), the tone and the muffler (see engineSimExhausts); all of it is set in apply()
    this.drivePre = context.createGain();
    this.shaper = context.createWaveShaper();
    var curve = new Float32Array(2048);
    for (var c = 0; c < curve.length; c++) curve[c] = Math.tanh((c / (curve.length - 1)) * 8 - 4);      // tanh(4 z) for z from -1 to 1
    this.shaper.curve = curve;
    this.drivePost = context.createGain();
    this.bass = context.createBiquadFilter(); this.bass.type = "lowshelf"; this.bass.frequency.value = 150;
    this.mid = context.createBiquadFilter(); this.mid.type = "peaking"; this.mid.Q.value = 0.9;
    this.treble = context.createBiquadFilter(); this.treble.type = "highshelf"; this.treble.frequency.value = 3000;
    this.muffler = context.createBiquadFilter(); this.muffler.type = "lowpass"; this.muffler.Q.value = 0.6;
    this.dryTone = context.createGain();
    // a lowpass for a sound that is heard inside the car, and a limiter against peaks
    this.filter = context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.7;
    var limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    this.master = context.createGain();
    bus.connect(this.drivePre);
    this.drivePre.connect(this.shaper);
    this.shaper.connect(this.drivePost);
    this.drivePost.connect(this.bass);
    this.bass.connect(this.mid);
    this.mid.connect(this.treble);
    this.treble.connect(this.muffler);
    this.muffler.connect(this.filter);
    this.filter.connect(limiter);
    limiter.connect(this.master);
    this.output = this.master;
    this.inside = false;
    this.silent = false;
    this.impulseResponseName = this.params.impulse_response;

    function apply() {
        var p = self.params;
        var now = context.currentTime;
        var wet = self.convolver.buffer ? Math.max(0, Math.min(1, p.convolution)) : 0;
        self.wet.gain.setTargetAtTime(wet, now, 0.05);
        self.dry.gain.setTargetAtTime(1 - wet, now, 0.05);
        var ex = OpenRacer.engineSimExhausts[p.exhaust_type];
        // the drive: the signal is about 0.14 (rms) here; y = tanh(k x) with k = 1 + 4 x drive, and the level put back behind it (the shaper has tanh(4 z) over -1..1)
        var k = 1 + 4 * (ex ? ex.drive : 0);
        self.drivePre.gain.setTargetAtTime(k / 4, now, 0.05);
        self.drivePost.gain.setTargetAtTime(ENGINE_SIM_SIGNAL / shaperRms(k), now, 0.05);
        self.bass.gain.setTargetAtTime(ex ? ex.bass : 0, now, 0.05);
        self.mid.frequency.setTargetAtTime(ex ? ex.midHz : 1000, now, 0.05);
        self.mid.gain.setTargetAtTime(ex ? ex.mid : 0, now, 0.05);
        self.treble.gain.setTargetAtTime(ex ? ex.treble : 0, now, 0.05);
        self.muffler.frequency.setTargetAtTime(ex ? ex.lowpass : 20000, now, 0.05);
        self.filter.frequency.setTargetAtTime(self.inside ? 2200 : 20000, now, 0.08);
        self.master.gain.setTargetAtTime(self.silent ? 0 : ENGINE_SIM_LEVEL * p.volume * (ex ? ex.volume : 1) * (self.inside ? 1.2 : 1), now, 0.05);
    }
    this.apply = apply;
    apply();

    // all the parameters at once; the engine is built again in the worklet (a different impulse response is loaded by the caller
    // with setImpulseResponse)
    this.setParams = function (p) {
        this.params = OpenRacer.engineSimParams({ sound: { engine_sim: p } });
        this.node.port.postMessage(OpenRacer.engineSimWorkletOptions(this.params));
        apply();
    };
    this.setImpulseResponse = function (buffer, name) {
        this.convolver.buffer = buffer || null;
        this.impulseResponseName = name;
        apply();
    };
    this.setRpm = function (rpm) { this.rpmParam.setTargetAtTime(Math.max(0, rpm), context.currentTime, 0.02); };
    this.setThrottle = function (throttle) { this.throttleParam.setTargetAtTime(Math.max(0, Math.min(1, throttle)), context.currentTime, 0.03); };
    // a bang: unburnt fuel of this energy (J) burns in the exhaust
    this.pop = function (energy) { this.node.port.postMessage({ pop: energy }); };
    this.setIgnition = function (on) { this.ignitionParam.setValueAtTime(on ? 1 : 0, context.currentTime); };
    this.setInside = function (inside) { this.inside = inside; apply(); };
    this.setSilent = function (silent) { if (this.silent !== silent) { this.silent = silent; apply(); } };
    this.connect = function (destination) { this.output.connect(destination); };
    this.disconnect = function () { this.node.disconnect(); this.output.disconnect(); };
};

// Makes the audio context know the worklet (before the first EngineSimSynth)
OpenRacer.EngineSimSynth.load = function (context, url) {
    return context.audioWorklet.addModule(url);
};

// The impulse response with a name, decoded for the context; base is the folder of the impulse responses (web/sounds/ir/)
var engineSimImpulseCache = {};
OpenRacer.EngineSimSynth.loadImpulseResponse = function (context, base, name) {
    var entry = OpenRacer.engineSimImpulseResponses.filter(function (ir) { return ir.id === name; })[0] || OpenRacer.engineSimImpulseResponses[0];
    var key = base + entry.file;
    if (!engineSimImpulseCache[key]) {
        engineSimImpulseCache[key] = fetch(key).then(function (response) {
            if (!response.ok) throw new Error(entry.file + ": HTTP " + response.status);
            return response.arrayBuffer();
        }).then(function (data) { return context.decodeAudioData(data); });
        engineSimImpulseCache[key].catch(function () { delete engineSimImpulseCache[key]; });
    }
    return engineSimImpulseCache[key].then(function (buffer) { return { buffer: buffer, name: entry.id }; });
};
