/*
 * EngineBuild.js
 *
 * Description: An engine as it is built, and the torque curve that a dyno measures on it. The build (car.json "engine.build") is the block
 *              (cylinders, bore, stroke, compression), the cam, the inlet and the exhaust, the fuel and the mixture, and forced induction
 *              (a turbo or a supercharger); the curve is worked out from it and is not typed in. Only 4-stroke petrol engines.
 *
 *              The model, per rpm: the volumetric efficiency (VE) has its peak where the mean piston speed fits the cam (a long cam moves it up),
 *              falls off to both sides, and the flow of the inlet limits the top. The indicated pressure (IMEP) follows from the VE, the density
 *              of the air (boost, heat, the intercooler, the altitude), the compression ratio (the Otto efficiency), the fuel and the mixture, and
 *              the knock (a high compression or boost on a low octane fuel takes the timing back). The friction (FMEP) is the Chen-Flynn fit of the
 *              mean piston speed. Torque = (IMEP - FMEP - what a supercharger takes) x displacement / 4 pi.
 *
 *              A turbo does not take power from the crankshaft (the exhaust drives it) but has a back pressure; a supercharger is driven
 *              by the engine and its work is taken from the torque. The compressor heats the air by its efficiency, the intercooler takes a share of that heat off.
 */
var OpenRacer = window.OpenRacer || (window.OpenRacer = {});

OpenRacer.EngineBuild = (function () {
    var CYLINDERS = { "single": 1, "inline-2": 2, "inline-3": 3, "inline-4": 4, "inline-5": 5, "inline-6": 6, "v6": 6, "v8-crossplane": 8, "v8-flatplane": 8, "v10": 10, "v12": 12, "flat-4": 4, "flat-6": 6 };
    var T0 = 293.15;                                           // the standard air: 20 C, 101.3 kPa
    var FUELS = {
        pump95: { label: "Pump fuel (95)", knock: 11.0, energy: 1.0 },
        pump98: { label: "Pump fuel (98)", knock: 12.0, energy: 1.005 },
        e85: { label: "E85", knock: 15.5, energy: 1.03 },
        race: { label: "Race fuel (100+)", knock: 13.0, energy: 1.01 }
    };
    var INTERCOOLERS = { none: { label: "None", value: 0 }, air: { label: "Air to air", value: 0.65 }, water: { label: "Air to water", value: 0.8 } };
    // the size of the turbo: the spool speed (rpm at a 2 L engine) and the air that the compressor can move (kg/s); a variant changes both
    var TURBO_SIZES = { small: { label: "Small (to ~300 hp)", spool: 2400, flow: 0.30 }, medium: { label: "Medium (to ~500 hp)", spool: 3200, flow: 0.50 }, large: { label: "Large (to ~800 hp)", spool: 4200, flow: 0.80 } };
    var TURBO_VARIANTS = {
        single: { label: "Single", spool: 1, flow: 1, lag: 1 },
        twinscroll: { label: "Twin-scroll", spool: 0.88, flow: 1, lag: 0.85 },
        twin: { label: "Twin (two small ones)", spool: 0.9, flow: 1.7, lag: 0.9 },
        vgt: { label: "Variable geometry", spool: 0.7, flow: 0.9, lag: 0.7 }
    };
    var SUPERCHARGERS = {
        roots: { label: "Roots", eff: 0.6, effDrop: 0.07 },
        screw: { label: "Twin-screw", eff: 0.7, effDrop: 0.04 },
        centrifugal: { label: "Centrifugal", eff: 0.74, effDrop: 0.02 }
    };

    function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
    function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
    function cylinders(build) { return build.cylinders || CYLINDERS[build.layout] || 4; }
    function displacement(build) { return Math.PI / 4 * Math.pow(build.bore / 1000, 2) * (build.stroke / 1000) * cylinders(build) * 1000; }     // litres
    function airDensity(altitude, celsius) {                 // relative to the standard air
        var p = 101.325 * Math.pow(1 - 2.25577e-5 * (altitude || 0), 5.25588);
        return (p / 101.325) * (T0 / (273.15 + (celsius === undefined ? 20 : celsius)));
    }
    // the correction factor of DIN 70020 (a dyno in other air than the standard one, 20 C and 1013 mbar: the correction brings the result back to it)
    function correction(altitude, celsius) {
        var p = 101.325 * Math.pow(1 - 2.25577e-5 * (altitude || 0), 5.25588);
        return (101.325 / p) * Math.sqrt((273.15 + (celsius === undefined ? 20 : celsius)) / 293.15);
    }

    // the engine as a number of fixed values, for the rpm that comes
    function prepare(b) {
        var n = cylinders(b), vdL = displacement(b), vcyl = vdL * 1000 / n;      // cm3 per cylinder
        var duration = clamp(b.cam_duration || 230, 190, 290);
        var valves = b.valves || 4;
        var adequacy = clamp(((b.intake_flow || 200) / vcyl) / 0.42, 0.6, 1.6);
        var veBase = 0.82 + (valves >= 5 ? 0.08 : valves === 4 ? 0.07 : valves === 3 ? 0.04 : 0);
        var exhaustRatio = (b.exhaust_flow || 160) / (b.intake_flow || 200);
        var vePeak = veBase - 0.1 * Math.max(0, 0.8 - exhaustRatio) / 0.8;
        var psTorque = Math.min(15.5, 9 + (duration - 210) * 0.2);                                   // the mean piston speed (m/s) where the torque peaks
        var rpmTorque = psTorque * 30000 / b.stroke * Math.pow(0.4 / (b.primary_length || 0.4), 0.15);
        return {
            n: n, vdL: vdL, vdM3: vdL / 1000, duration: duration, valves: valves, vePeak: vePeak, rpmTorque: rpmTorque,
            low: clamp(0.35 + (duration - 210) * 0.012, 0.3, 1.2), high: 0.75 / adequacy,
            fuel: FUELS[b.fuel] || FUELS.pump95, lambda: clamp(b.lambda || 0.9, 0.75, 1.15),
            cr: b.compression || 10, stroke: b.stroke,
            etaCr: (1 - Math.pow(b.compression || 10, -0.33)) / 0.539,
            rpmPower: rpmTorque * 1.3                                              // (about where the power peaks)
        };
    }

    // the boost (bar above the air) that the induction gives at an rpm, with the air that goes through (the compressor chokes)
    function boostAt(b, p, rpm, limiter) {
        var ind = b.induction;
        if (!ind || ind.type === "none" || !(ind.boost > 0)) return 0;
        var set = ind.boost, boost;
        if (ind.type === "turbo") {
            var size = TURBO_SIZES[ind.size] || TURBO_SIZES.medium, variant = TURBO_VARIANTS[ind.variant] || TURBO_VARIANTS.single;
            var threshold = size.spool * variant.spool * clamp(Math.pow(2 / Math.max(0.3, p.vdL), 0.25), 0.7, 1.4);
            boost = set * smooth((rpm - threshold) / (threshold * 0.6 + 400));
            var pr = 1 + boost / 1.013, mass = 1.2 * p.vdM3 * rpm / 120 * p.vePeak * pr, cap = size.flow * variant.flow;
            if (mass > cap) boost *= Math.max(0.1, Math.pow(cap / mass, 1.2));         // (the compressor is past its flow: the boost falls)
        } else if (ind.type === "supercharger") {
            var kind = ind.variant === "centrifugal";
            boost = kind ? set * Math.pow(clamp(rpm / (limiter || 7000), 0, 1.2), 2) : set * smooth(rpm / 1200) * (1 - 0.1 * clamp(rpm / (limiter || 7000), 0, 1));
        }
        return Math.min(boost, set * 1.05);
    }
    function compressorEfficiency(b, rpm) {
        var ind = b.induction;
        if (ind.type === "supercharger") { var s = SUPERCHARGERS[ind.variant] || SUPERCHARGERS.screw; return Math.max(0.4, s.eff - s.effDrop * rpm / 6000); }
        return 0.72;
    }

    // what the engine gives at one rpm: { nm, boost (bar), knock (lost share of torque), power (hp) }
    // opts: { altitude, celsius, air: true for the real air of a dyno (the curve of the car is for the standard air) }
    function at(b, p, rpm, limiter, opts) {
        opts = opts || {};
        var rho = opts.air ? airDensity(opts.altitude, opts.celsius) : 1;
        var r = rpm / p.rpmTorque;
        var shape = r < 1 ? Math.max(0.25, 1 - p.low * (1 - r) * (1 - r)) : Math.max(0.05, 1 - p.high * Math.pow(r - 1, 1.4));
        var ve = p.vePeak * shape;
        var boost = boostAt(b, p, rpm, limiter), ind = b.induction || { type: "none" };
        var pr = 1 + boost / 1.013, density = 1, parasitic = 0, tCharge = 1;
        if (boost > 0) {
            var eff = compressorEfficiency(b, rpm), ic = INTERCOOLERS[ind.intercooler] ? INTERCOOLERS[ind.intercooler].value : 0.65;
            var out = T0 * (1 + (Math.pow(pr, 0.286) - 1) / eff), manifold = out - ic * (out - T0);
            density = pr * T0 / manifold;
            tCharge = manifold / T0;
            if (ind.type === "turbo") density *= 1 - 0.035 * boost;                   // the back pressure of the exhaust (as Engine.js)
            else {
                var mass = 1.2 * rho * p.vdM3 * rpm / 120 * ve * pr;                   // the work of the compressor, taken from the crankshaft
                parasitic = mass * 1005 * T0 * (Math.pow(pr, 0.286) - 1) / eff / 0.95 / Math.max(1, rpm * Math.PI / 30);   // N m
            }
        }
        // the knock: compression and charge pressure and heat against the octane
        var lambda = p.lambda, knockLimit = p.fuel.knock + Math.max(0, 1 - lambda) * 8;
        var knockIndex = p.cr * Math.pow(pr, 0.4) * Math.pow(tCharge, 0.8);
        var knock = clamp(0.06 * (knockIndex - knockLimit), 0, 0.4);
        var mix = 1 - 2.2 * Math.pow(lambda - 0.88, 2);
        var imep = 15.8 * ve * rho * density * p.etaCr * p.fuel.energy * mix * (1 - knock);
        var sp = 2 * p.stroke * rpm / 60000;
        var fmep = 0.4 + 0.004 * (45 + 12 * density * rho) + 0.09 * sp + 0.0009 * sp * sp + (p.valves >= 4 ? 0.06 : 0);
        var nm = (imep - fmep) * 1e5 * p.vdM3 / (4 * Math.PI) - parasitic;
        // below the idle speed the engine does not run: the torque falls to nothing at standstill
        nm *= clamp(rpm / Math.max(600, (b.idle || 850) * 1.1), 0, 1);
        nm = Math.max(0, nm);
        return { nm: nm, boost: boost, knock: knock, power: nm * rpm * Math.PI / 30 / 745.7, parasitic: parasitic };
    }

    // the torque curve (rpm, Nm) of a build up to the rev limit, for the standard air, and the boost at every point
    // a bore or a stroke that is not a size (a field that was emptied) is taken as 86 mm: with 0 the engine had no torque and the speed of its torque peak was
    // infinite, and the limits of the flows became 0 to 0
    function sized(b) { return b.bore > 0 && b.stroke > 0 ? b : Object.assign({}, b, { bore: b.bore > 0 ? b.bore : 86, stroke: b.stroke > 0 ? b.stroke : 86 }); }
    function compute(build, limiter, idle) {
        var b = Object.assign({}, sized(build), { idle: idle });
        var p = prepare(b), curve = [[0, 0]], boost = [[0, 0]], top = 0, peak = { power: 0, rpm: 0 }, topNm = 0;
        var end = Math.max(1000, limiter) + 600;
        for (var rpm = 500; rpm <= end; rpm += 500) {
            var v = at(b, p, rpm, limiter);
            var nm = Math.round(v.nm * 10) / 10;
            curve.push([rpm, nm]); boost.push([rpm, Math.round(v.boost * 100) / 100]);
            if (rpm <= limiter) { if (v.power > peak.power) peak = { power: v.power, rpm: rpm }; topNm = Math.max(topNm, nm); top = Math.max(top, v.boost); }
        }
        // the naturally aspirated torque at the peak (for the share of the boost that a turbo has: the older model of Engine.js counts it)
        var naBuild = Object.assign({}, b, { induction: { type: "none" } }), naP = prepare(naBuild), naPeak = 0;
        for (var r2 = 1000; r2 <= limiter; r2 += 500) naPeak = Math.max(naPeak, at(naBuild, naP, r2, limiter).nm);
        var knockLost = 0;
        for (var r3 = 1000; r3 <= limiter; r3 += 500) knockLost = Math.max(knockLost, at(b, p, r3, limiter).knock);
        return {
            curve: curve, boost: boost, peakPower: peak.power, peakPowerRpm: peak.rpm, peakTorque: topNm, maxBoost: top,
            boostShare: topNm > 0 ? clamp(1 - naPeak / topNm, 0, 0.9) : 0,
            displacement: p.vdL, cylinders: p.n, pistonSpeedAtLimit: 2 * b.stroke * limiter / 60000, knock: knockLost, rpmTorque: p.rpmTorque,
            suggestedLimiter: Math.round(Math.min(p.rpmPower * 1.12, 25 * 30000 / b.stroke) / 100) * 100
        };
    }

    // a block from a preset of the engine sound: the values that the model needs
    function fromPreset(name, preset) {
        var valves = { "Single 0.25 L (kart)": 2, "Single 0.4 L": 2, "Twin 0.8 L (parallel)": 2, "Single 0.65 L (thumper)": 4, "V8 5.7 L crossplane": 2, "Flat-4 2.5 L": 2 }[name] || 4;
        var cr = preset.compression_ratio;
        return {
            block: name, layout: preset.layout, bore: preset.bore, stroke: preset.stroke, rod: preset.rod, compression: cr,
            cam_duration: preset.intake_duration, valves: valves, intake_flow: preset.intake_flow, exhaust_flow: preset.exhaust_flow,
            primary_length: preset.primary_length, exhaust_length: preset.exhaust_length,
            fuel: cr >= 12 ? "pump98" : "pump95", lambda: 0.9,
            induction: { type: "none", variant: "single", size: "medium", boost: 0.6, intercooler: "air" },
            ambient: { celsius: 20, altitude: 0 }
        };
    }

    // what the turbo does to the engine of the game (Engine.js): the share of the torque that comes with boost, the spool time (the lag) and from what rpm
    function turboSpec(b) {
        var ind = b.induction || {};
        if (ind.type !== "turbo") return null;
        var size = TURBO_SIZES[ind.size] || TURBO_SIZES.medium, variant = TURBO_VARIANTS[ind.variant] || TURBO_VARIANTS.single;
        return { threshold: Math.round(size.spool * variant.spool * clamp(Math.pow(2 / Math.max(0.3, displacement(b)), 0.25), 0.7, 1.4) / 100) * 100,
            spool: Math.round({ small: 0.5, medium: 0.8, large: 1.2 }[ind.size || "medium"] * variant.lag * 20) / 20 };
    }

    // how far a setting can go with the others as they are: [min, max, why] for every field of the build, and what a turbo or supercharger can be
    var BOOST_CAP = { turbo: 3.0, roots: 1.0, screw: 1.5, centrifugal: 1.5 };
    function chargeFactor(b, boost) {                          // the knock factor of a charge: pressure ratio and heat (as at()), at a middle rpm
        var ind = b.induction || {};
        if (!(boost > 0) || !ind.type || ind.type === "none") return 1;
        var pr = 1 + boost / 1.013, eff = compressorEfficiency(b, 5000), ic = INTERCOOLERS[ind.intercooler] ? INTERCOOLERS[ind.intercooler].value : 0.65;
        var out = T0 * (1 + (Math.pow(pr, 0.286) - 1) / eff), manifold = out - ic * (out - T0);
        return Math.pow(pr, 0.4) * Math.pow(manifold / T0, 0.8);
    }
    function round(x, step) { return Math.round(x / step) * step; }
    function limits(b, limiter, idle) {
        b = sized(b);
        var bore = b.bore, stroke = b.stroke, valves = b.valves || 4, vdL = displacement(b), ind = b.induction || { type: "none" };
        var fuel = FUELS[b.fuel] || FUELS.pump95, knockLimit = fuel.knock + Math.max(0, 1 - (b.lambda || 0.9)) * 8, kiMax = knockLimit + 3;
        var intakeMax = 0.036 * bore * bore * (0.85 + 0.075 * valves), intakeMin = 0.012 * bore * bore;
        var strokeMax = Math.min(130, bore * 1.5, 28 * 30000 / Math.max(2000, limiter)), strokeMin = Math.max(30, bore * 0.45);
        var crMax = 16, cap = 3;
        if (ind.type && ind.type !== "none") {
            cap = ind.type === "turbo" ? BOOST_CAP.turbo : (BOOST_CAP[ind.variant] || 1.5);
            crMax = Math.min(16, kiMax / chargeFactor(b, ind.boost));
        } else crMax = Math.min(16, kiMax);
        var boostMax = cap;
        for (var x = 0.1; x <= cap + 1e-9; x += 0.05) if ((b.compression || 10) * chargeFactor(Object.assign({}, b, { induction: Object.assign({}, ind, { boost: x }) }), x) > kiMax) { boostMax = Math.max(0.1, x - 0.05); break; }
        var camMax = valves >= 4 ? 290 : valves === 3 ? 265 : 250;
        var intake = b.intake_flow || 200;
        return {
            bore: [Math.max(40, stroke / 1.5), Math.min(120, stroke / 0.45), "The bore against the stroke: between 0.45 and 1.5 times"],
            stroke: [strokeMin, strokeMax, "The stroke against the bore, and the piston speed at the rev limit (28 m/s at most)"],
            compression: [7, round(Math.max(7.5, crMax) - 0.05, 0.1), "The most that " + fuel.label.toLowerCase() + " allows without knock" + (ind.type !== "none" ? " with this boost" : "")],
            cam: [200, camMax, valves < 4 ? "A cam with " + valves + " valves per cylinder is limited to " + camMax + "°" : "The longest cam that still runs"],
            intake: [Math.round(intakeMin), Math.round(intakeMax), valves + " valves in a bore of " + bore + " mm flow at most this much"],
            exhaust: [Math.round(intake * 0.5), Math.round(intake), "An exhaust flows less than the inlet"],
            primary: [0.15, Math.min(1.5, (b.exhaust_length || 2) - 0.2), "The header is shorter than the whole exhaust"],
            exhaustLen: [Math.max(0.5, (b.primary_length || 0.4) + 0.2), 4, "The whole exhaust is longer than the header"],
            lambda: [0.75, 1.1, "Richer than 0.75 does not burn, leaner than 1.1 runs hot"],
            boost: [0.1, round(boostMax, 0.05), ind.type === "turbo" ? "A turbo up to " + BOOST_CAP.turbo + " bar; the compression and the fuel (knock) may allow less" : "This kind of supercharger can give up to " + (BOOST_CAP[ind.variant] || 1.5) + " bar; the compression and the fuel (knock) may allow less"],
            temp: [-20, 45, "Air of a dyno room"], altitude: [0, 4000, "Altitude of the dyno"],
            idle: [400, Math.max(500, Math.min(1500, Math.floor(limiter * 0.35 / 50) * 50)), "The idle speed of an engine: 400 to 1500 rpm"],
            limiter: [Math.max(2500, (idle || 850) * 3), Math.floor(Math.min(20000, 28 * 30000 / stroke) / 100) * 100, "The piston speed at the rev limit stays under 28 m/s (the stroke)"],
            inertia: [0.02, Math.round((0.35 * vdL + 0.6) * 100) / 100, "A flywheel in proportion to the engine"],
            valves: [2, 3, 4, 5].filter(function (v) { return bore >= (v === 5 ? 65 : v === 4 ? 50 : v === 3 ? 55 : 0); }),
            turboSizes: ["small", "medium", "large"].filter(function (z) { return vdL >= (z === "large" ? 1.5 : z === "medium" ? 0.6 : 0); }),
            turboVariants: Object.keys(TURBO_VARIANTS).filter(function (v) { return v !== "twin" || vdL >= 1.2; })
        };
    }

    return { limits: limits, turboSpec: turboSpec, CYLINDERS: CYLINDERS, FUELS: FUELS, INTERCOOLERS: INTERCOOLERS, TURBO_SIZES: TURBO_SIZES, TURBO_VARIANTS: TURBO_VARIANTS, SUPERCHARGERS: SUPERCHARGERS,
        compute: compute, fromPreset: fromPreset, prepare: prepare, at: at, correction: correction, airDensity: airDensity, displacement: displacement, cylinders: cylinders };
})();
