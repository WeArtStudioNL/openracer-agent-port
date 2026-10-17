/*
 * EngineSimWorklet.js
 *
 * Description: An engine sound that is calculated from the combustion in the cylinders, as an AudioWorklet (it runs on the audio
 *              thread). It follows the engine speed (rpm), the throttle and the ignition. The sound is the pressure in the exhaust
 *              runner of every cylinder, the way engine-sim does it (Ange Yaghi, https://github.com/ange-yaghi/engine-sim, MIT
 *              license, see ENGINE_SIM_LICENSE.txt in web/sounds/ir). This is a port to JavaScript of the parts of engine-sim that
 *              make the sound, reduced so that it runs in a browser:
 *
 *              - Every cylinder is a volume of gas (ideal gas: an amount, an energy and a volume give the pressure and the temperature)
 *                whose volume follows the crank (bore, stroke, rod, compression ratio). The intake and the exhaust valve open with the
 *                lobes of the camshaft (duration, lift, lobe centres); the flow through them is the compressible flow through an
 *                opening (choked above the critical pressure ratio), rated in cfm like a flow bench does it.
 *              - The mixture is lit by the spark (a timing curve), and burns over some crank angle (a Wiebe burn; engine-sim grows a
 *                flame front) with an efficiency that is a little different every cycle. Heat is lost to the walls. The intake takes
 *                the mixture from the manifold, whose pressure follows the throttle.
 *              - The exhaust runner (the port and the primary tube) and the collector are volumes of gas too, with rated flows
 *                between them and to the outside. The sound of a cylinder is the pressure in its runner above the atmosphere, delayed
 *                by the length of the pipes, and the cylinders of an exhaust system are added.
 *              - Then the synthesizer of engine-sim: jitter, the DC taken off, a mix of the signal and its derivative, modulated by
 *                air noise, and a leveler. The convolution with the impulse response of an exhaust is done outside the worklet, with a
 *                ConvolverNode (see EngineSim.js). The ignition cut of the rev limiter leaves unburnt mixture, that bangs in the hot
 *                exhaust.
 *
 *              The simulation runs at its own rate (simulation_frequency, 10 kHz by default) and is interpolated to the audio rate.
 *              Units: SI (m, kg, s, Pa, K, mol, J) except where the parameters say otherwise.
 */

const R = 8.314462618;        // J/(mol K)
const DOF = 5;                // degrees of freedom of air (a diatomic gas)
const GAMMA = (DOF + 2) / DOF;
const ATM = 101325;
const T_ATM = 298.15;
const SPEED_OF_SOUND = 343;
const MOL_PER_SCFM = 0.01997;         // 1 standard cubic foot per minute in mol/s
const FUEL_PER_AIR = 0.0197;          // mol of fuel per mol of air at stoichiometry (gasoline, 14.7:1 by mass)
// J per mol of fuel (44 MJ/kg, 0.1 kg/mol), as it heats a gas with the heat capacity of cold air: the burnt gas holds more heat per
// degree (its molecules vibrate, and some fall apart), so only a part of the energy shows as temperature and pressure
const FUEL_ENERGY = 4.4e6 * 0.55;
const T_WALL = 363.15;                // the walls of the cylinder, 90 C
const INCH = 0.0254, THOU = 0.0000254, CM2 = 1e-4, CC = 1e-6;

const C_CHOKED = Math.sqrt(GAMMA) * Math.pow(2 / (GAMMA + 1), (GAMMA + 1) / (2 * (GAMMA - 1)));
const R_CRITICAL = Math.pow(2 / (GAMMA + 1), GAMMA / (GAMMA - 1));

// The molar flow (mol/s, for a flow constant of 1) from a gas at p0, T0 into p1 < p0: choked at and below the critical pressure ratio
function flowRate(p0, T0, p1) {
    const r = p1 / p0;
    if (r <= R_CRITICAL) return p0 * C_CHOKED / Math.sqrt(R * T0);
    return p0 * Math.sqrt((2 * GAMMA / (GAMMA - 1)) * Math.pow(r, 2 / GAMMA) * (1 - Math.pow(r, (GAMMA - 1) / GAMMA)) / (R * T0));
}

// The flow constant of an opening that is rated at a flow (cfm) at a pressure drop (Pa) from the atmosphere
function flowConstant(cfm, drop) {
    if (cfm <= 0) return 0;
    return cfm * MOL_PER_SCFM / flowRate(ATM, T_ATM, ATM - drop);
}
const K_CARB = flowConstant(1, 1.5 * 3386.39);   // the flow constant per cfm of a carburettor, rated at 1.5 inHg
const K_28 = flowConstant(1, 28 * 248.84);        // ... and of a port on a flow bench, rated at 28 inH2O
const kCarb = (cfm) => cfm * K_CARB;
const k28 = (cfm) => cfm * K_28;

// A volume of gas: an amount n (mol), an energy E (J) and a volume V (m^3), with the fuel that is in it (mol)
class Gas {
    constructor(volume, pressure, temperature) {
        this.V = volume;
        this.n = pressure * volume / (R * temperature);
        this.E = DOF / 2 * this.n * R * temperature;
        this.fuel = 0;
        this.fixed = false;
    }
    get P() { return 2 * this.E / (DOF * this.V); }
    get T() { return this.n > 1e-15 ? 2 * this.E / (DOF * this.n * R) : T_ATM; }
    energyPerMol() { return this.n > 1e-15 ? this.E / this.n : DOF / 2 * R * T_ATM; }
}

// The air outside, or the manifold: a gas that does not change when gas flows in or out of it
class Reservoir {
    constructor(pressure, temperature, fuelFraction) {
        this.P = pressure;
        this.T = temperature;
        this.fuelFraction = fuelFraction || 0;
        this.fixed = true;
        this.n = 1e9;
    }
    energyPerMol() { return DOF / 2 * R * this.T; }
}

// Moves dn mol from a to b, with the energy and the fuel that go with it
function transfer(a, b, dn) {
    if (dn <= 0) return 0;
    if (!a.fixed) dn = Math.min(dn, 0.9 * a.n);
    const e = a.energyPerMol();
    const f = a.fixed ? a.fuelFraction : (a.n > 1e-15 ? a.fuel / a.n : 0);
    if (!a.fixed) { a.n -= dn; a.E -= dn * e; a.fuel = Math.max(0, a.fuel - dn * f); }
    if (!b.fixed) { b.n += dn; b.E += dn * e; b.fuel += dn * f; }
    return dn;
}

// The flow between two volumes through an opening with flow constant k, for a time dt
function flow(a, b, k, dt) {
    if (k <= 0) return 0;
    const pa = a.P, pb = b.P;
    if (pa > pb) return transfer(a, b, k * flowRate(pa, a.T, pb) * dt);
    if (pb > pa) return -transfer(b, a, k * flowRate(pb, b.T, pa) * dt);
    return 0;
}

// A curve y(x) through points, linear in between (the port flow against the valve lift)
function curve(points) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    return (x) => {
        if (x <= xs[0]) return ys[0];
        if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
        let i = 1;
        while (xs[i] < x) i++;
        const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
        return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    };
}

// The shape of a port flow (cfm at 28 inH2O) against the lift (m), after the heads of engine-sim: scaled to a peak flow
function portFlow(peakCfm, peakLift) {
    const shape = [[0, 0], [50, 25], [100, 75], [150, 100], [200, 130], [250, 180], [300, 190], [350, 220], [400, 240], [450, 250], [500, 260], [550, 260], [600, 260], [650, 255], [700, 250]];
    const f = curve(shape.map((p) => [p[0] * THOU * (peakLift / (600 * THOU)), p[1] * peakCfm / 260]));
    return f;
}

// A cam lobe: the lift (m) against the crank angle (degrees) from the lobe centre. A harmonic lobe: a raised cosine to a power,
// whose width follows from the duration at 50 thou of lift (the way camshafts are specified).
function lobe(durationAt50, lift, gamma) {
    const at50 = Math.min(0.9, 50 * THOU / lift);
    const c = 2 * Math.pow(at50, 1 / gamma) - 1;                       // cos(pi * (duration/2) / halfWidth)
    const halfWidth = Math.PI * (durationAt50 / 2) / Math.acos(c);
    return (angle) => {
        const a = Math.abs(angle);
        if (a >= halfWidth) return 0;
        return lift * Math.pow(0.5 + 0.5 * Math.cos(Math.PI * a / halfWidth), gamma);
    };
}

// A one-pole lowpass
class Lowpass {
    constructor(frequency, rate) {
        const w = 2 * Math.PI * frequency / rate;
        this.alpha = w / (w + 1);
        this.y = 0;
    }
    run(x) { this.y += this.alpha * (x - this.y); return this.y; }
}

// A second order Butterworth lowpass (for the anti-aliasing)
class Biquad {
    constructor(frequency, rate) {
        const w = Math.tan(Math.PI * Math.min(0.45, frequency / rate));
        const n = 1 / (1 + Math.SQRT2 * w + w * w);
        this.b0 = w * w * n; this.b1 = 2 * this.b0; this.b2 = this.b0;
        this.a1 = 2 * (w * w - 1) * n; this.a2 = (1 - Math.SQRT2 * w + w * w) * n;
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
    run(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
        return y;
    }
}

// A delay of a fixed time, with interpolation
class Delay {
    constructor(seconds, rate) {
        const length = Math.max(1, seconds * rate);
        this.size = Math.ceil(length) + 2;
        this.data = new Float32Array(this.size);
        this.frac = length - Math.floor(length);
        this.whole = Math.floor(length);
        this.index = 0;
    }
    run(x) {
        this.data[this.index] = x;
        const i0 = (this.index - this.whole + this.size) % this.size;
        const i1 = (i0 - 1 + this.size) % this.size;
        const y = this.data[i0] * (1 - this.frac) + this.data[i1] * this.frac;
        this.index = (this.index + 1) % this.size;
        return y;
    }
}

// The synthesizer of engine-sim for one channel (one exhaust system), at the audio rate
class Channel {
    constructor(p) {
        this.jitterNoise = new Lowpass(p.jitter_cutoff, sampleRate);
        this.history = new Float32Array(8);
        this.hIndex = 0;
        this.dc = new Lowpass(10, sampleRate);
        this.airNoise = new Lowpass(p.noise_cutoff, sampleRate);
        this.antialias = new Biquad(0.45 * sampleRate, sampleRate);
        this.last = 0;
        this.peak = 0.5;
        this.gain = 1;
        this.set(p);
    }
    set(p) {
        this.jitter = p.jitter;
        this.hfGain = p.hf_gain;
        this.noise = p.noise;
        this.levelerTarget = p.leveler_target;
        this.levelerMax = p.leveler_max_gain;
    }
    run(x) {
        // jitter: the signal is read a little early or late, at random
        this.history[this.hIndex] = x;
        const offset = Math.max(0, Math.min(6, 1 + this.jitter * (1 + this.jitterNoise.run(2 * Math.random() - 1))));
        const i0 = (this.hIndex - Math.floor(offset) + 8) % 8, i1 = (i0 - 1 + 8) % 8;
        const frac = offset - Math.floor(offset);
        const fIn = this.history[i0] * (1 - frac) + this.history[i1] * frac;
        this.hIndex = (this.hIndex + 1) % 8;
        // the DC taken off, and the derivative
        const f = fIn - this.dc.run(fIn);
        const fp = (fIn - this.last) * sampleRate;
        this.last = fIn;
        // the air noise: the signal is modulated by a low noise
        const r = this.airNoise.run(2 * Math.random() - 1);
        const rMixed = this.noise * r + (1 - this.noise);
        let v = fp * this.hfGain + f * rMixed * (1 - this.hfGain);
        v = this.antialias.run(v);
        // the leveler: the peak is held near the target, without making a weak signal much louder
        this.peak = Math.max(0.999 * this.peak, Math.abs(v));
        if (this.peak > 1e-9) {
            const g = Math.min(this.levelerMax, Math.max(1e-5, this.levelerTarget / this.peak));
            this.gain = 0.9 * this.gain + 0.1 * g;
        }
        return v * this.gain;
    }
}

class Cylinder {
    constructor(engine, def) {
        const p = engine.p;
        this.fireAngle = def.fire;                      // crank angle (degrees of the 720 cycle) at which the cylinder is at TDC firing
        this.exhaustSystem = def.exhaust;               // the index of the exhaust system it is on
        this.attenuation = def.attenuation;
        this.primaryLength = def.primary;               // the length of the primary tube (m)
        this.gas = new Gas(engine.clearance + engine.swept / 2, ATM, T_ATM);
        this.runner = new Gas(p.exhaust_runner_volume * CC + this.primaryLength * p.primary_area * CM2, ATM, T_ATM);
        this.runnerPending = 0;                         // energy of unburnt mixture that is burning in the runner (J)
        this.ignited = false;
        this.burning = false;
        this.burnAngle = 0;
        this.burnLength = 50;
        this.burned = 0;
        this.burnEnergy = 0;
        this.exhaustWasOpen = false;
        this.delay = new Delay((this.primaryLength + p.exhaust_length) / SPEED_OF_SOUND, engine.simRate);
        this.lastV = this.gas.V;
        this.signal = 0;
    }
}

class EngineSimProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: "rpm", defaultValue: 0, minValue: 0, automationRate: "k-rate" },
            { name: "throttle", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
            { name: "ignition", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" }
        ];
    }

    constructor(options) {
        super();
        this.crank = 0;              // the crank angle, degrees of the 720 degree cycle
        this.manifold = new Reservoir(ATM * 0.4, T_ATM, FUEL_PER_AIR / (1 + FUEL_PER_AIR));
        this.atmosphere = new Reservoir(ATM, T_ATM, 0);
        this.simPhase = 0;
        this.throttle = 0;
        this.rpmFiltered = 0;
        this.build(options.processorOptions);
        this.port.onmessage = (event) => this.build(event.data);
    }

    // Makes the engine from the parameters (see EngineSim.js for them)
    build(p) {
        this.p = p;
        this.simRate = Math.max(2000, Math.min(48000, p.simulation_frequency));
        this.substeps = Math.max(1, Math.round(p.fluid_steps || 4));
        const bore = p.bore / 1000, stroke = p.stroke / 1000;
        this.area = Math.PI * bore * bore / 4;
        this.bore = bore;
        this.throw = stroke / 2;
        this.rod = p.rod / 1000;
        this.swept = this.area * stroke;
        this.clearance = this.swept / (p.compression_ratio - 1);
        this.intakeLobe = lobe(p.intake_duration, p.intake_lift / 1000, p.lobe_gamma);
        this.exhaustLobe = lobe(p.exhaust_duration, p.exhaust_lift / 1000, p.lobe_gamma);
        this.intakeCentre = 360 + p.intake_lobe_centre;        // after TDC of the intake stroke
        this.exhaustCentre = 360 - p.exhaust_lobe_centre;      // before that TDC
        this.intakeFlow = portFlow(p.intake_flow, p.intake_lift / 1000);
        this.exhaustFlow = portFlow(p.exhaust_flow, p.exhaust_lift / 1000);
        this.kPrimary = kCarb(p.primary_flow);
        this.kOutlet = kCarb(p.outlet_flow);
        this.timing = curve(p.timing);
        this.cylinders = p.cylinders.map((def) => new Cylinder(this, def));
        this.exhaustCount = Math.max(1, p.exhaust_systems);
        this.collectors = [];
        for (let i = 0; i < this.exhaustCount; i++) this.collectors.push(new Gas(p.collector_area * CM2 * p.exhaust_length, ATM, T_ATM));
        this.channels = [];
        for (let i = 0; i < this.exhaustCount; i++) this.channels.push(new Channel(p));
        this.simValues = new Float32Array(this.exhaustCount);
        this.lastValues = new Float32Array(this.exhaustCount);
        this.antialias = [];
        for (let i = 0; i < this.exhaustCount; i++) this.antialias.push(new Biquad(p.input_cutoff, sampleRate));
        this.lengthScale = 1 / Math.pow(0.2 + p.exhaust_length, 2);
        this.random = Math.random;
    }

    // The volume of a cylinder at a crank angle (degrees from TDC)
    volume(angle) {
        const a = angle * Math.PI / 180;
        const s = this.throw * Math.sin(a);
        const x = this.throw * Math.cos(a) + Math.sqrt(Math.max(0, this.rod * this.rod - s * s));
        return this.clearance + this.area * (this.throw + this.rod - x);
    }

    // One step of the simulation
    step(dt, rpm, ignition) {
        const p = this.p;
        const degrees = rpm / 60 * 360 * dt;
        this.crank = (this.crank + degrees) % 720;
        const manifold = this.manifold;
        // the manifold pressure follows the throttle, with the delay of the air in the intake
        this.throttle += (this.throttleTarget - this.throttle) * Math.min(1, dt / 0.12);
        manifold.P = ATM * (p.idle_pressure + (1 - p.idle_pressure) * Math.pow(this.throttle, p.throttle_gamma));
        const advance = this.timing(rpm);
        const fluidDt = dt / this.substeps;
        const cylinders = this.cylinders;
        this.simValues.fill(0);

        for (let i = 0; i < cylinders.length; i++) {
            const c = cylinders[i];
            const gas = c.gas;
            const theta = (this.crank - c.fireAngle + 720 * 4) % 720;   // 0 = TDC firing, 180 BDC, 360 TDC exhaust/intake, 540 BDC
            // the piston moves: work, and the heat that goes to the walls
            const V = this.volume(theta);
            const dV = V - c.lastV;
            gas.E -= gas.P * dV;
            gas.V = V;
            c.lastV = V;
            const height = V / this.area;
            gas.E += (T_WALL - gas.T) * (Math.PI * this.bore * height + 2 * this.area) * 100 * dt;
            if (gas.E < 0) gas.E = 0;

            // the valves
            const intakeLift = this.intakeLobe(theta - this.intakeCentre);
            let exhaustAngle = theta - this.exhaustCentre;
            if (exhaustAngle > 360) exhaustAngle -= 720;
            const exhaustLift = this.exhaustLobe(exhaustAngle);
            const kIn = intakeLift > 0 ? k28(this.intakeFlow(intakeLift)) : 0;
            const kEx = exhaustLift > 0 ? k28(this.exhaustFlow(exhaustLift)) : 0;

            // the spark, and the burn
            if (theta > 360 && theta < 540) c.ignited = false;        // the intake stroke: a new charge
            const sparkAngle = 720 - advance;
            if (!c.ignited && !c.burning && theta >= sparkAngle && theta < 720 && theta > 540) {
                c.ignited = true;
                if (ignition > 0.5 && gas.fuel > 1e-9) {
                    c.burning = true;
                    c.burnAngle = 0;
                    c.burned = 0;
                    const load = Math.max(0, Math.min(1, (manifold.P / ATM - p.idle_pressure) / (1 - p.idle_pressure)));
                    c.burnLength = p.burn_duration * (1.5 - 0.5 * load);
                    const efficiency = p.burn_efficiency * (1 - p.burn_randomness * this.random());
                    c.burnEnergy = gas.fuel * FUEL_ENERGY * efficiency;
                }
            }
            if (c.burning) {
                c.burnAngle += degrees;
                const x = 1 - Math.exp(-5 * Math.pow(c.burnAngle / c.burnLength, 3));
                const dx = x - c.burned;
                c.burned = x;
                gas.E += c.burnEnergy * dx;
                gas.fuel *= 1 - dx;
                if (c.burnAngle >= c.burnLength) { c.burning = false; gas.fuel *= 0.1; }
            }

            // unburnt mixture that reaches the hot exhaust burns there (the bangs of the rev limiter)
            const exhaustOpen = exhaustLift > 0;
            if (exhaustOpen && !c.exhaustWasOpen && !c.burning && gas.fuel > 1e-7 && c.runner.T > p.afterfire_temperature) {
                c.runnerPending += gas.fuel * FUEL_ENERGY * (0.3 + 0.5 * this.random());
                gas.fuel = 0;
            }
            c.exhaustWasOpen = exhaustOpen;
            if (c.runnerPending > 0) {
                const dE = Math.min(c.runnerPending, c.runnerPending * dt / 0.004 + 1);
                c.runner.E += dE;
                c.runnerPending -= dE;
            }

            // the gas flows: into the cylinder from the manifold, out to the runner, from the runner to the collector
            const collector = this.collectors[c.exhaustSystem];
            for (let s = 0; s < this.substeps; s++) {
                if (kIn > 0) flow(manifold, gas, kIn, fluidDt);
                if (kEx > 0) flow(gas, c.runner, kEx, fluidDt);
                flow(c.runner, collector, this.kPrimary, fluidDt);
            }

            // the sound of this cylinder: the pressure in its runner, delayed by the pipes
            const pulse = c.delay.run(c.runner.P - ATM);
            this.simValues[c.exhaustSystem] += c.attenuation * pulse;
        }
        // the collectors breathe out
        for (let e = 0; e < this.exhaustCount; e++) {
            for (let s = 0; s < this.substeps; s++) flow(this.collectors[e], this.atmosphere, this.kOutlet, fluidDt);
        }
        // the sound fades out when the engine stops (below about 380 rpm)
        const speed = Math.min(1, Math.abs(rpm) * 2 * Math.PI / 60 / 40);
        const scale = speed * speed * speed * p.audio_volume * p.signal_scale * this.lengthScale / cylinders.length;
        for (let e = 0; e < this.exhaustCount; e++) this.simValues[e] *= scale;
    }

    process(inputs, outputs, parameters) {
        const rpm = parameters.rpm[0];
        this.throttleTarget = parameters.throttle[0];
        const ignition = parameters.ignition[0];
        const dt = 1 / this.simRate;
        const stepsPerSample = this.simRate / sampleRate;
        const frames = outputs[0][0].length;
        const count = this.exhaustCount;
        const current = new Float32Array(count);
        for (let n = 0; n < frames; n++) {
            // the simulation runs at its own rate; between its samples the signal is interpolated
            this.simPhase += stepsPerSample;
            while (this.simPhase >= 1) {
                this.simPhase -= 1;
                this.lastValues.set(this.simValues);
                this.step(dt, rpm, ignition);
            }
            for (let e = 0; e < count; e++) {
                const v = this.lastValues[e] + (this.simValues[e] - this.lastValues[e]) * this.simPhase;
                current[e] = this.antialias[e].run(v);
                outputs[e][0][n] = this.channels[e].run(current[e]);
            }
        }
        return true;
    }
}

registerProcessor("engine-sim-processor", EngineSimProcessor);
