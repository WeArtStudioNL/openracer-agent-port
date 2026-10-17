/*
 * EngineSoundWorklet.js
 *
 * Description: A car engine sound that is calculated from a physical model, as an AudioWorklet (it runs on the audio
 *              thread). It follows the engine speed (rpm) and the throttle, and has three outputs: the sound of the
 *              intake, of the vibrations of the engine block and of the outlet (the end of the exhaust).
 *
 * This is based on the engine sound generator of Antonio-R1 (https://github.com/Antonio-R1/engine-sound-generator),
 * which works after the ideas of Baldan et al., "Physically informed car engine sound synthesis for virtual and
 * augmented environments" (2015): every cylinder is a set of waveguides (pipes in which a wave travels up and down, and
 * is partly reflected at the ends) for the intake, the exhaust and the extractor, with valves that open and close with the
 * crank angle and a pressure pulse from the piston and the ignition; the exhausts of the cylinders come together in a
 * straight pipe, a muffler of several elements and the outlet.
 *
 * Copyright (c) 2021-2022 Antonio-R1 (MIT license, see ENGINE_SOUND_LICENSE.txt).
 * Changes for OpenRacer: the throttle changes the strength of the ignition and of the intake noise, so that the engine
 * is louder and rougher under load and quiet when the throttle is closed; the filters follow the sample rate of the
 * audio context; the parameters can be changed while the engine runs.
 */

class LowpassFilter {
    constructor(frequency) {
        const w = 2.0 * Math.PI * frequency / sampleRate;
        this.alpha = w / (w + 1.0);
        this.lastValue = 0.0;
    }

    getFilteredValue(value) {
        this.lastValue += this.alpha * (value - this.lastValue);
        return this.lastValue;
    }
}

class DelayLine {
    constructor(length) {
        this.data = new Float32Array(Math.max(1, Math.round(length)));
        this.index = 0;
    }

    updateLeft(value) {
        this.data[this.index] = value;
        if (++this.index >= this.data.length) this.index = 0;
    }

    updateRight(value) {
        this.data[this.index] = value;
        if (--this.index < 0) this.index = this.data.length - 1;
    }

    // the value that is at the end of the line, where the wave leaves
    get end() {
        return this.data[this.index];
    }
}

class Waveguide {
    constructor(length, reflectionLeft, reflectionRight) {
        this.upper = new DelayLine(length);
        this.lower = new DelayLine(length);
        this.reflectionLeft = reflectionLeft;
        this.reflectionRight = reflectionRight;
        this.outputLeft = 0.0;
        this.outputRight = 0.0;
    }

    add(valueLeft, valueRight) {
        const lower = this.lower.end;
        const upper = this.upper.end;
        this.outputLeft = lower * (1.0 - this.reflectionLeft);
        this.outputRight = upper * (1.0 - this.reflectionRight);
        this.upper.updateRight(valueLeft + lower * this.reflectionLeft);
        this.lower.updateLeft(valueRight + upper * this.reflectionRight);
    }
}

class Cylinder {
    constructor(p) {
        this.cylinderWaveguide = new Waveguide(10, 0.75, 0.75);
        this.intakeWaveguide = new Waveguide(p.intakeWaveguideLength, 0.01, p.intakeOpenReflectionFactor);
        this.exhaustWaveguide = new Waveguide(p.exhaustWaveguideLength, p.exhaustClosedReflectionFactor, 0.01);
        this.extractorWaveguide = new Waveguide(p.extractorWaveguideLength, 0.01, 0.01);
        this.p = p;
    }

    // x is the position in the cycle of the cylinder, from 0 to 1 (two turns of the crankshaft)
    update(intakeNoise, straightPipeOutputLeft, x, load) {
        const p = this.p;
        const exhaustValve = (x > 0.75 && x < 1.0) ? -Math.sin(4.0 * Math.PI * x) : 0;
        const intakeValve = (x > 0 && x < 0.25) ? Math.sin(4.0 * Math.PI * x) : 0;
        const piston = Math.cos(4.0 * Math.PI * x);
        const ignition = (x > 0.0 && x < 0.5 * p.ignitionTime) ? Math.sin(2.0 * Math.PI * (x / p.ignitionTime)) : 0;

        const intakeReflection = p.intakeOpenReflectionFactor * intakeValve + p.intakeClosedReflectionFactor * (1.0 - intakeValve);
        const exhaustReflection = p.exhaustOpenReflectionFactor * exhaustValve + p.exhaustClosedReflectionFactor * (1.0 - exhaustValve);
        this.intakeWaveguide.reflectionRight = intakeReflection;
        this.cylinderWaveguide.reflectionLeft = intakeReflection;
        this.exhaustWaveguide.reflectionLeft = exhaustReflection;
        this.cylinderWaveguide.reflectionRight = exhaustReflection;

        // the pressure in the cylinder: the piston, and the ignition, which is much stronger under load
        const amplitude = piston * 1.5 + ignition * 5.0 * load;

        const exhaustOutputRight = this.exhaustWaveguide.outputRight;
        const extractorOutputLeft = this.extractorWaveguide.outputLeft;
        const cylinderOutputLeft = this.cylinderWaveguide.outputLeft;
        const cylinderOutputRight = this.cylinderWaveguide.outputRight;
        const intakeOutputRight = this.intakeWaveguide.outputRight;

        this.extractorWaveguide.add(exhaustOutputRight, straightPipeOutputLeft);
        this.exhaustWaveguide.add(cylinderOutputRight, extractorOutputLeft);
        this.cylinderWaveguide.add(amplitude + intakeOutputRight * (1.0 - this.intakeWaveguide.reflectionRight),
            extractorOutputLeft * (1.0 - this.exhaustWaveguide.reflectionLeft));
        this.intakeWaveguide.add(intakeNoise * intakeValve, cylinderOutputLeft * (1.0 - this.intakeWaveguide.reflectionRight));
    }
}

class Muffler {
    constructor(elementLengths, action) {
        this.elements = elementLengths.map((length) => new Waveguide(length, 0.0, action));
        this.inverse = 1.0 / this.elements.length;
        this.outputLeft = 0.0;
        this.outputRight = 0.0;
    }

    update(input, outletValue) {
        input *= this.inverse;
        outletValue *= this.inverse;
        this.outputLeft = 0.0;
        this.outputRight = 0.0;
        for (const element of this.elements) {
            this.outputLeft += element.outputLeft;
            this.outputRight += element.outputRight;
            element.add(input, outletValue);
        }
    }
}

class EngineSoundProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: "throttle", defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: "k-rate" },
            { name: "rpm", defaultValue: 0.0, minValue: 0.0, automationRate: "k-rate" }
        ];
    }

    constructor(options) {
        super();
        this.rpm = 0.0;
        this.throttle = 0.0;
        this.revolution = 0.0;
        this.smoothThrottle = 0.0;
        this.intakeFilter = new LowpassFilter(11000.0);
        this.crankshaftFilter = new LowpassFilter(75.0);
        this.engineFilter = new LowpassFilter(125.0);
        this.setParameters(options.processorOptions);
        this.port.onmessage = (event) => this.setParameters(event.data);
    }

    // The lengths of the waveguides are in samples
    setParameters(p) {
        this.cylinders = [];
        this.cylindersInverse = 1.0 / p.cylinders;
        for (let i = 0; i < p.cylinders; i++) this.cylinders.push(new Cylinder(p));
        this.straightPipe = new Waveguide(p.straightPipeWaveguideLength, p.straightPipeReflectionFactor, p.straightPipeReflectionFactor);
        this.muffler = new Muffler(p.mufflerElementsLength, p.action);
        this.outlet = new Waveguide(p.outletWaveguideLength, p.outletReflectionFactor, p.outletReflectionFactor);
    }

    process(inputs, outputs, parameters) {
        const intake = outputs[0][0];
        const block = outputs[1][0];
        const outlet = outputs[2][0];
        const secondsPerSample = 1.0 / sampleRate;
        this.rpm = parameters.rpm[0];
        const targetThrottle = parameters.throttle[0];
        const cylinders = this.cylinders;
        const count = cylinders.length;

        for (let n = 0; n < intake.length; n++) {
            // the load follows the throttle with a little delay, like the air in the intake does
            this.smoothThrottle += (targetThrottle - this.smoothThrottle) * 0.0006;
            const load = 0.3 + 0.7 * this.smoothThrottle;

            let intakeNoise = this.intakeFilter.getFilteredValue(2.0 * Math.random() - 1.0) * (0.25 + 0.75 * this.smoothThrottle);
            if (this.rpm < 25.0) intakeNoise = 0;

            // the cylinders do not fire exactly evenly: the crankshaft turns a little unevenly
            const crankshaft = this.crankshaftFilter.getFilteredValue(0.25 * Math.random());
            let blockSample = 0.0;
            for (let i = 0; i < count; i++) {
                const x = (this.revolution + i * (this.cylindersInverse + crankshaft)) % 1;
                cylinders[i].update(intakeNoise, this.straightPipe.outputLeft, x, load);
                blockSample += cylinders[i].cylinderWaveguide.outputLeft;
            }
            this.revolution += secondsPerSample * this.rpm / 120.0;
            if (this.revolution > 1.0) this.revolution -= 1.0;

            let intakeSample = 0.0;
            let straightPipeInput = 0.0;
            for (let i = 0; i < count; i++) {
                intakeSample += cylinders[i].intakeWaveguide.outputLeft;
                straightPipeInput += cylinders[i].extractorWaveguide.outputRight;
            }

            this.straightPipe.add(straightPipeInput, this.muffler.outputLeft);
            this.outlet.add(this.muffler.outputRight, 0.0);
            this.muffler.update(this.straightPipe.outputRight, this.outlet.outputLeft);

            intake[n] = intakeSample;
            block[n] = this.engineFilter.getFilteredValue(blockSample);
            outlet[n] = this.outlet.outputRight;
        }
        return true;
    }
}

registerProcessor("engine-sound-processor", EngineSoundProcessor);
