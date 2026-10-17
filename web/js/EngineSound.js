/*
    This file is part of OpenRacer.

    OpenRacer is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    OpenRacer is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/*
 * EngineSound.js
 *
 * Description: Synthesised V8 engine sound driven by the engine RPM and throttle,
 *              using the Web Audio API (no audio files needed).
 * Notes: Browsers only start audio after a key press or click, so the sound starts
 *        on the first such interaction. The sound can be switched off in the settings menu (Esc).
 */

var EngineSound = (function() {
    var PULSES_PER_REV = 4;   // a V8 fires four cylinders per crankshaft revolution
    var TARGET_SMOOTHING = 0.04; // seconds, so that pitch and volume changes are not steppy

    var ctx = null;
    var master = null;
    var filter = null;
    var oscillators = [];     // { osc, ratio }: oscillator and its frequency relative to the firing frequency
    var muted = false;
    var paused = false;       // silent while the game is paused
    var enabledByUser = false;

    function start() {
        enabledByUser = true;
        if(!ctx) {
            var AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if(!AudioContextClass) return;
            ctx = new AudioContextClass();

            master = ctx.createGain();
            master.gain.value = 0;
            master.connect(ctx.destination);

            filter = ctx.createBiquadFilter();
            filter.type = "lowpass";
            filter.Q.value = 2;
            filter.connect(master);

            // The firing frequency plus a lower octave for the V8 rumble and an upper
            // harmonic for some bite
            var layers = [
                { type: "sawtooth", ratio: 1, gain: 0.5 },
                { type: "square", ratio: 0.5, gain: 0.35 },
                { type: "triangle", ratio: 2, gain: 0.25 }
            ];
            for(var i = 0; i < layers.length; i++) {
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.type = layers[i].type;
                osc.frequency.value = 50;
                gain.gain.value = layers[i].gain;
                osc.connect(gain);
                gain.connect(filter);
                osc.start();
                oscillators.push({ osc: osc, ratio: layers[i].ratio });
            }
        }
        if(ctx.state === "suspended") ctx.resume();
    }

    // Called every frame with the engine RPM and the throttle position (0..1)
    function update(rpm, throttle) {
        if(!ctx || ctx.state !== "running") return;
        var now = ctx.currentTime;
        var firing = (rpm / 60) * PULSES_PER_REV;
        for(var i = 0; i < oscillators.length; i++) {
            oscillators[i].osc.frequency.setTargetAtTime(firing * oscillators[i].ratio, now, TARGET_SMOOTHING);
        }
        // Opening the throttle makes the engine louder and brighter
        filter.frequency.setTargetAtTime(300 + rpm * 0.35 + throttle * 700, now, TARGET_SMOOTHING);
        var volume = (muted || paused) ? 0 : 0.08 + 0.12 * Math.min(rpm / 6000, 1) + 0.15 * throttle;
        master.gain.setTargetAtTime(volume, now, TARGET_SMOOTHING);
    }

    function status() {
        if(muted) return "Engine sound: muted";
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
        status: status,
        setMuted: function(value) { muted = value; },
        setPaused: function(value) { paused = value; }
    };
})();
