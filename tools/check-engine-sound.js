#!/usr/bin/env node
/*
 * check-engine-sound.js
 *
 * Runs the engine sound of the game (web/js/EngineSimWorklet.js, the real worklet with a few stubs) for a preset of web/js/EngineSim.js or a car, without a browser,
 * and says what it makes: at some engine speeds the level (rms and peak), whether it is silent or clips, and the strongest frequency against the firing frequency
 * of the engine (rpm / 60 x cylinders / 2). It does not tell how it sounds, but it finds a preset that is silent, that blows up or that does not follow the speed.
 *
 *   node tools/check-engine-sound.js                  every preset
 *   node tools/check-engine-sound.js "Inline-4 0.6 L (supersport)"
 *   node tools/check-engine-sound.js --car honda-cbr600
 *   node tools/check-engine-sound.js --wav out.wav "Inline-4 0.6 L (supersport)"     also writes a wav (a rise from idle to the limiter) to listen to
 */
const fs = require("fs");
const path = require("path");
const web = path.join(__dirname, "..", "web");

global.OpenRacer = {};
global.sampleRate = 44100;
global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
let Processor = null;
global.registerProcessor = (name, cls) => { Processor = cls; };
(0, eval)(fs.readFileSync(path.join(web, "js", "EngineSim.js"), "utf8").split("OpenRacer.EngineSimSynth")[0]);
(0, eval)(fs.readFileSync(path.join(web, "js", "EngineSimWorklet.js"), "utf8"));

function run(params, rpmList, seconds) {
    const options = OpenRacer.engineSimWorkletOptions(OpenRacer.engineSimParams({ sound: { engine_sim: params } }));
    const cylinders = options.cylinders.length;
    const results = [];
    for (const rpm of rpmList) {
        const p = new Processor({ processorOptions: options });
        const frames = 128, count = Math.floor(seconds * sampleRate / frames) * frames, signal = new Float32Array(count);
        const outputs = Array.from({ length: options.exhaust_systems }, () => [new Float32Array(frames)]);
        for (let i = 0; i < count; i += frames) {
            p.process([], outputs, { rpm: [rpm], throttle: [1], ignition: [1] });
            for (let n = 0; n < frames; n++) { let v = 0; for (const o of outputs) v += o[0][n]; signal[i + n] = v; }
        }
        results.push(analyse(signal, rpm, cylinders));
    }
    return results;
}

function analyse(signal, rpm, cylinders) {
    const skip = Math.floor(signal.length * 0.4), s = signal.subarray(skip);
    let sum = 0, peak = 0;
    for (const v of s) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    const rms = Math.sqrt(sum / s.length);
    const expected = rpm / 60 * cylinders / 2;
    // the strongest frequency near the expected one and its first harmonics (a DFT of a few bins, on a part of the signal)
    const n = Math.min(s.length, 1 << 14);
    let best = 0, bestMag = 0;
    for (let f = Math.max(20, expected * 0.5); f < expected * 2.5; f += Math.max(1, expected * 0.01)) {
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) { const a = 2 * Math.PI * f * i / sampleRate; re += s[i] * Math.cos(a); im += s[i] * Math.sin(a); }
        const mag = Math.hypot(re, im);
        if (mag > bestMag) { bestMag = mag; best = f; }
    }
    return { rpm, rms, peak, expected, found: best, finite: s.every(Number.isFinite) };
}

function report(name, params) {
    const limit = params.__limit || 8000;
    const list = [1200, limit * 0.25, limit * 0.5, limit * 0.75, limit].map(Math.round);
    const rows = run(params, list, 0.8);
    console.log("\n" + name + "  (" + params.layout + ")");
    let bad = false;
    for (const r of rows) {
        const silent = r.rms < 1e-4, clipping = r.peak >= 0.99, off = Math.abs(r.found / r.expected - 1) > 0.15 && Math.abs(r.found / r.expected - 2) > 0.3 && Math.abs(r.found / r.expected - 0.5) > 0.1;
        if (silent || clipping || !r.finite) bad = true;
        console.log("  " + String(r.rpm).padStart(6) + " rpm  rms " + r.rms.toFixed(4) + "  peak " + r.peak.toFixed(3) + "  fires at " + r.expected.toFixed(0) + " Hz, strongest " + r.found.toFixed(0) + " Hz" +
            (silent ? "  SILENT" : "") + (clipping ? "  CLIPS" : "") + (!r.finite ? "  NOT A NUMBER" : "") + (off ? "  (the pitch is not the firing frequency: check)" : ""));
    }
    return !bad;
}

function writeWav(file, params) {
    const options = OpenRacer.engineSimWorkletOptions(OpenRacer.engineSimParams({ sound: { engine_sim: params } }));
    const p = new Processor({ processorOptions: options });
    const frames = 128, seconds = 8, total = Math.floor(seconds * sampleRate / frames) * frames, out = new Int16Array(total);
    const outputs = Array.from({ length: options.exhaust_systems }, () => [new Float32Array(frames)]);
    for (let i = 0; i < total; i += frames) {
        const t = i / total, rpm = 1300 + (params.__limit - 1300) * Math.min(1, t * 1.6) * (t < 0.8 ? 1 : 1 - (t - 0.8) * 2.5);
        p.process([], outputs, { rpm: [rpm], throttle: [t < 0.1 ? 0.2 : 1], ignition: [1] });
        for (let n = 0; n < frames; n++) { let v = 0; for (const o of outputs) v += o[0][n]; out[i + n] = Math.max(-1, Math.min(1, v * 0.8)) * 32767; }
    }
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(36 + out.length * 2, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(out.length * 2, 40);
    fs.writeFileSync(file, Buffer.concat([header, Buffer.from(out.buffer)]));
    console.log("wrote " + file);
}

const args = process.argv.slice(2);
let wav = null, car = null;
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--wav") { wav = args[i + 1]; args.splice(i, 2); i--; }
    else if (args[i] === "--car") { car = args[i + 1]; args.splice(i, 2); i--; }
}
let ok = true;
if (car) {
    const config = JSON.parse(fs.readFileSync(path.join(web, "cars", car, "car.json"), "utf8"));
    const params = Object.assign({}, (config.sound && config.sound.engine_sim) || {}, { __limit: config.engine.limiter_rpm });
    ok = report(config.name, params);
    if (wav) writeWav(wav, params);
} else {
    const names = args.length ? args : Object.keys(OpenRacer.engineSimPresets);
    for (const name of names) {
        const preset = OpenRacer.engineSimPresets[name];
        if (!preset) { console.log("No preset called " + name); ok = false; continue; }
        const limit = /superbike/.test(name) ? 14000 : /supersport/.test(name) ? 15500 : /triple/.test(name) ? 12500 : /thumper/.test(name) ? 8500 : /kart/.test(name) ? 3800 : /V12|V10|flatplane|Flat/.test(name) ? 8500 : 6500;
        ok = report(name, Object.assign({}, preset, { __limit: limit })) && ok;
        if (wav && args.length === 1) writeWav(wav, Object.assign({}, preset, { __limit: limit }));
    }
}
process.exit(ok ? 0 : 1);
