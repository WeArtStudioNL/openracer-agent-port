/*
 * EngineDamage.js
 *
 * Description: What a crash does to the engine, with Damage on (the soft body of the car, SoftBody.js). See ENGINE-DAMAGE.md.
 *
 *              The engine bay is a sphere in the frame of the car; the nodes of the shell inside it say how hurt the engine is, in four places:
 *                block   all the nodes of the bay: the engine is bent, its mounts are torn (power, friction, wear);
 *                top     the nodes above the middle: the ignition, the wiring and the intake (misfires, stalling);
 *                pan     the nodes below it: the oil pan (an oil leak);
 *                radiator  the nodes at the front of the car: the radiator and its hoses (a coolant leak). When the model has an object called radiator that is a
 *                          part of the car (Parts.js), its own nodes say how bent it is, and the coolant is gone in seconds when it comes off.
 *              Every place holds the worst that it has had (a bent node stays bent), 0 whole, 1 destroyed. From them come:
 *                misfires     the ignition cuts for a moment, now and then (a stumble, a bang in the exhaust), and stalls at a bad hit;
 *                leaks        coolant and oil run out, faster the worse the radiator and the pan are;
 *                heat         the engine warms from its power and cools in the radiator (less with less coolant, a hurt radiator, a low speed): it
 *                             loses power above 108 degrees, stumbles above 118 and boils its coolant away above 112;
 *                wear         without oil pressure (low oil, hot oil, a hard corner with little oil) the bearings wear; a worn engine has less power,
 *                             more friction, and seizes at 1.
 *              The result is a few numbers on the engine (healthScale, frictionScale, misfireCut, disabled) and the record vehicle.engineHealth
 *              for the HUD, the smoke and the sound. No 3D library and no page: it runs in the physics worker as well.
 *
 *              car.json engine.damage (all optional): { enabled, position [x, y, z] of the bay and radiator [x, y, z], radius, radiator_radius,
 *              coolant (litres), oil (litres), strength (how much bend counts: 1) }.
 */

OpenRacer.EngineDamage = function (vehicle, config) {
    var self = this;
    config = config || {};
    var sb = vehicle.softBody, engine = vehicle.engine;

    // ---- where the engine and the radiator are, in the frame of the car (x to the left, y up, z forward, from the centre of gravity)
    var place = (vehicle.parameters && vehicle.parameters.engine_place) || "front";
    var af = vehicle.af || vehicle.wheelbase * 0.5, ar = vehicle.ar || vehicle.wheelbase * 0.5, cgh = vehicle.cgHeight || 0.4;
    var bay = config.position && config.position.length === 3 ? config.position :
        [0, -cgh + 0.55, place === "rear" ? -ar + 0.1 : (place === "mid" ? -ar * 0.35 : af - 0.2)];
    var rad = config.radiator && config.radiator.length === 3 ? config.radiator : [0, bay[1] + 0.05, place === "front" ? bay[2] + 0.55 : af + 0.2];
    var bayR = config.radius > 0 ? config.radius : 0.75, radR = config.radiator_radius > 0 ? config.radiator_radius : 0.55;
    var strength = config.strength > 0 ? config.strength : 1;
    this.position = bay; this.radiatorPosition = rad;

    // the nodes that count, with how much: { node, weight in the bay, above the middle, below it, weight in the radiator }. The shell can be made again (the car
    // is built again in the tuning menu): the list follows vehicle.softBody
    var list = [], sumB = 0, sumT = 0, sumP = 0, sumR = 0;
    function bind(shell) {
        sb = shell; list = []; sumB = sumT = sumP = sumR = 0;
        var tmp = { x: 0, y: 0, z: 0 };
        for (var k = 0; k < sb.bodyCount; k++) {
            sb.restPosition(k, tmp);
            var d = Math.hypot(tmp.x - bay[0], tmp.y - bay[1], tmp.z - bay[2]), dr = Math.hypot(tmp.x - rad[0], tmp.y - rad[1], tmp.z - rad[2]);
            var wb = Math.max(0, 1 - d / bayR), wr = Math.max(0, 1 - dr / radR);
            if (wb <= 0 && wr <= 0) continue;
            var ny = (tmp.y - bay[1]) / bayR;
            list.push({ k: k, wb: wb, wt: wb * (ny > -0.1 ? 1 : 0), wp: wb * (ny < 0.1 ? 1 : 0), wr: wr });
        }
        list.forEach(function (n) { sumB += n.wb; sumT += n.wt; sumP += n.wp; sumR += n.wr; });
        self.nodes = list.length;
        self.usable = config.enabled !== false && sumB > 0.3;
    }
    this.nodes = 0;
    this.usable = false;
    bind(sb);

    // ---- the state (all of it is a number: vehicle.engineHealth goes to the main thread with the rest of the vehicle)
    var health = vehicle.engineHealth = { block: 0, top: 0, pan: 0, radiator: 0, ignition: 0, coolant: 1, oil: 1, temp: 78, oilTemp: 70, wear: 0, power: 1, misfire: 0, steam: 0, smoke: 0,
        failed: 0, stalled: 0, leaking: 0, coolFlow: 0, oilFlow: 0, radiatorGone: 0, bx: bay[0], by: bay[1], bz: bay[2], br: bayR, rx: rad[0], ry: rad[1], rz: rad[2], rr: radR };
    var CAP_COOLANT = config.coolant > 0 ? config.coolant : 7, CAP_OIL = config.oil > 0 ? config.oil : 5;
    var seized = false, cutLeft = 0, nextMisfire = 0, shockCool = 0, acc = 0, lastShock = 0;
    var peak = 0, peakCurve = null, peakScale = -1;

    // ---- small helpers
    function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
    function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
    function random() { return engine.random ? engine.random() : Math.random(); }

    // the peak power of the engine (W), for the heat: the engine may have been changed in the tuning menu
    function peakPower() {
        if (engine.torque_curve !== peakCurve || engine.torqueScale !== peakScale) {
            peakCurve = engine.torque_curve; peakScale = engine.torqueScale;
            peak = 0;
            for (var i = 0; i < peakCurve.length; i++) peak = Math.max(peak, peakCurve[i].nm * peakCurve[i].rpm * Math.PI / 30);
            peak = Math.max(8000, peak * (engine.torqueScale || 1));
        }
        return peak;
    }

    // the radiator as an object of the model: a part (Parts.js) whose name has radiator in it. Its nodes say how bent it is; it is gone when it is not held any more
    var radiatorPart = null;
    function findRadiator() {
        var list = vehicle.parts && vehicle.parts.parts;
        if (!list) { radiatorPart = null; return null; }
        if (radiatorPart && list.indexOf(radiatorPart) >= 0) return radiatorPart;
        radiatorPart = null;
        for (var i = 0; i < list.length; i++) if (list[i].wheel === undefined && /radiator/i.test(list[i].name || "")) { radiatorPart = list[i]; break; }
        return radiatorPart;
    }

    // how hurt a node is, 0..1: a bend of the shape that stays (5 cm is nothing, 30 cm is all of it), a node that is torn off is gone
    function hurt(k) {
        if (sb.torn(k)) return 1;
        return clamp((sb.bendOf(k) - 0.05 / strength) / (0.25 / strength), 0, 1);
    }

    // ---- what the nodes say, every tick: the worst of every place is kept
    function readNodes(dt) {
        var b = 0, t = 0, p = 0, r = 0, shock = 0;
        for (var i = 0; i < list.length; i++) {
            var n = list[i], h = hurt(n.k);
            b += n.wb * h; t += n.wt * h; p += n.wp * h; r += n.wr * h;
            if (n.wb > 0) shock += n.wb * sb.elasticOf(n.k);
        }
        if (sumB > 0) { health.block = Math.max(health.block, b / sumB); shock /= sumB; }
        if (sumT > 0) health.top = Math.max(health.top, t / sumT);
        if (sumP > 0) health.pan = Math.max(health.pan, p / sumP);
        if (sumR > 0) health.radiator = Math.max(health.radiator, r / sumR);
        var rp = findRadiator();
        if (rp) {
            if (rp.state !== "held" && rp.state !== "hinged") { health.radiator = 1; health.radiatorGone = 1; }          // (torn off, or broken)
            else if (rp.nodes && rp.nodes.length) {
                var sum = 0, worst = 0;
                for (var q = 0; q < rp.nodes.length; q++) { var hq = hurt(rp.nodes[q]); sum += hq; worst = Math.max(worst, hq); }
                health.radiator = Math.max(health.radiator, 0.5 * sum / rp.nodes.length + 0.5 * worst);               // (the mean and the worst place: a hole in one corner drains it too)
            }
        }
        // a hard hit shakes the wiring loose even when nothing stays bent (the springing of the shell in the bay: 10 cm is a hit, 40 cm a hard one)
        shockCool = Math.max(0, shockCool - dt);
        var jolt = clamp((shock - 0.10) / 0.30, 0, 1);
        if (jolt > 0.05 && shock > lastShock + 0.02 && shockCool <= 0) {
            shockCool = 1;
            health.top = Math.max(health.top, 0.3 * jolt);
            // the engine dies at a hard hit, now and then (a cut-out switch, a flooded cylinder, a hose off): the harder, the more often
            if (engine.running && random() < 0.9 * jolt * jolt + 0.05 * jolt) engine.running = false, engine.starting = false, health.stalled = 1;
        }
        lastShock = shock;
        // the ignition is the wiring above the engine, and what the block has done to it
        health.ignition = clamp(Math.max(health.top * 0.85, health.block * 0.6), 0, 1);
    }

    // ---- one tick (the physics steps by a few ms: the engine is looked at 30 times a second)
    function tick(dt) {
        var rpm = engine.getRPM(), limiter = engine.limiterRPM || 6000, pk = peakPower();
        readNodes(dt);

        // --- leaks: a hurt radiator drains the coolant in a minute and a half at the worst, a pan the oil in two and a half minutes (the hot system leaks faster)
        var hotLeak = 0.4 + 0.6 * clamp((health.temp - 20) / 80, 0, 1);
        // a radiator that is an object of the model: a crushed one is empty in 40 s, one that has come off in 8 s (a radiator that is only a place in the shell: 90 s)
        var rpart = radiatorPart, full = rpart ? 1 / 40 : 1 / 90;
        var coolLeak = (Math.pow(health.radiator, rpart ? 1.3 : 1.6) * full + 0.3 * Math.pow(Math.max(0, health.block - 0.4), 1.5) / 90) * hotLeak;
        if (health.radiatorGone) coolLeak = 1 / 8;
        var oilLeak = (Math.pow(health.pan, 1.5) + 0.2 * Math.pow(Math.max(0, health.block - 0.5), 1.5)) / 150;
        health.coolant = Math.max(0, health.coolant - coolLeak * dt);
        health.oil = Math.max(0, health.oil - oilLeak * dt);
        health.leaking = (coolLeak > 0.0005 ? 1 : 0) + (oilLeak > 0.0005 ? 2 : 0);
        // how hard it runs, for the drops and the stains (Leaks.js): 1 is the pace of a crushed radiator or a destroyed pan; nothing when the tank is dry
        health.coolFlow = health.coolant > 0 ? clamp(coolLeak * 40, 0, 6) : 0;
        health.oilFlow = health.oil > 0 ? clamp(oilLeak * 150, 0, 2) : 0;

        // --- heat
        var running = engine.running ? 1 : 0;
        var output = Math.max(0, (engine.lastTorque || 0) * engine.omega) * running;
        var starve = oilStarvation(rpm, limiter, output / pk);
        var heat = 0.95 * output + running * (0.02 * pk + 0.045 * pk * Math.pow(Math.min(1.2, rpm / limiter), 1.5)) * (1 + (engine.frictionScale - 1)) + starve * 0.08 * pk * running;
        var airflow = 0.45 + 0.55 * Math.min(1, Math.abs(vehicle.speed !== undefined ? vehicle.speed : Math.hypot(vehicle.vx || 0, vehicle.vz || 0)) / 25);
        var thermostat = 0.04 + 0.96 * smooth((health.temp - 78) / 14);
        var coolant = 0.05 + 0.95 * smooth(health.coolant / 0.45);
        var UA = 0.0122 * pk * airflow * thermostat * coolant * (1 - 0.85 * health.radiator);
        var capacity = 25000 + 450 * pk / 1000;
        health.temp += (heat - UA * (health.temp - 20)) / capacity * dt;
        if (health.temp > 112 && health.coolant > 0) health.coolant = Math.max(0, health.coolant - 0.004 * (health.temp - 112) * dt);      // it boils over
        health.temp = clamp(health.temp, 15, 220);
        // the oil runs hotter than the coolant, with the engine speed and load, with little oil and with the bearings that run dry; it follows slowly (a minute and a half)
        var oilTarget = health.temp + 6 + 24 * clamp(rpm / limiter, 0, 1.2) * (0.3 + 0.7 * clamp(output / pk, 0, 1)) + 40 * starve + 25 * clamp((0.4 - health.oil) / 0.4, 0, 1);
        health.oilTemp = clamp(health.oilTemp + (oilTarget - health.oilTemp) * Math.min(1, dt / 90), 15, 250);

        // --- wear: the bearings run dry (little oil, hot oil, a corner with the oil away from the pickup), a bent engine, and a boiled one
        health.wear += (Math.pow(starve, 1.3) * 0.012 + Math.pow(health.block, 2) * 0.0015 * clamp(output / pk, 0, 1) + Math.pow(clamp((health.temp - 135) / 20, 0, 1), 2) * 0.02) * dt;
        health.wear = clamp(health.wear, 0, 1);

        // --- what it does to the engine: power, friction, the ignition
        var overheat = clamp((health.temp - 108) / 40, 0, 1);
        var power = (1 - 0.5 * Math.pow(health.block, 1.3)) * (1 - 0.2 * health.top) * (1 - 0.4 * overheat) * (1 - 0.35 * Math.pow(health.wear, 1.3)) * (1 - 0.15 * (1 - oilPressure()));
        health.power = clamp(power, 0.2, 1);
        engine.healthScale = health.power;
        engine.frictionScale = 1 + 1.2 * health.wear + 0.6 * Math.pow(health.block, 2) + 0.3 * (1 - oilPressure());
        // misfires (events a second): the ignition, the heat (above 118) and a worn engine
        var rate = 9 * Math.pow(health.ignition, 1.8) + 6 * Math.pow(clamp((health.temp - 118) / 25, 0, 1), 1.5) + 3 * Math.pow(health.wear, 3);
        health.misfire = clamp(rate / 9, 0, 1);
        nextMisfire = rate;
        // the steam of a boiling or leaking cooling system, and the smoke of oil that burns (a worn engine, or oil that runs onto the exhaust)
        health.steam = health.temp > 100 && (health.leaking & 1 || health.temp > 112) ? clamp((health.temp - 100) / 25, 0.15, 1) : 0;
        health.smoke = running ? clamp(Math.max(health.wear - 0.35, (health.leaking & 2 ? 0.5 * health.pan : 0)) * 1.5, 0, 1) : 0;
        // the end: the engine seizes when the bearings are gone (or it is cooked), and a ruined ignition does not start again
        if (!seized && (health.wear >= 1 || health.temp >= 165)) { seized = true; engine.running = false; engine.starting = false; }
        health.failed = seized ? 1 : 0;
        engine.disabled = seized || health.ignition > 0.95;
    }

    // how well the oil pressure holds, 0..1: the level, and the heat that thins it
    function oilPressure() { return smooth(health.oil / 0.55) * (1 - 0.5 * clamp((health.temp - 130) / 30, 0, 1)); }
    // how far the bearings are from oil, 0..1, at the engine speed and load of now (and the oil that slides away from the pickup in a corner)
    function oilStarvation(rpm, limiter, load) {
        var dry = 1 - oilPressure();
        if (health.oil < 0.7 && Math.abs(vehicle.ay || 0) > 9) dry = Math.min(1, dry + 0.3 * (1 - health.oil));
        return dry * clamp(rpm / limiter + 0.5 * load, 0, 1);
    }

    // ---- every step of the physics: the clocks of the misfires run here (a cut lasts 35 to 105 ms), the engine itself is looked at by tick
    this.update = function (dt) {
        engine = vehicle.engine;
        if (vehicle.softBody && vehicle.softBody !== sb) bind(vehicle.softBody);
        if (!this.usable) return;
        acc += dt;
        if (acc >= 1 / 30) { var step = acc; acc = 0; tick(step); }
        if (cutLeft > 0) { cutLeft -= dt; if (cutLeft <= 0) engine.misfireCut = false; }
        else if (engine.running && nextMisfire > 0 && random() < nextMisfire * dt) {
            cutLeft = 0.035 + 0.07 * random();
            engine.misfireCut = true;
            // the unburnt fuel bangs in the exhaust; a rough idle can die of it
            if (engine.events.length < 40) engine.events.push({ strength: 0.4 + random() * 0.7, loud: 1, flame: 1 });
            if (engine.getRPM() < engine.idleRPM * 1.4 && random() < 0.2 * health.misfire) { engine.running = false; engine.starting = false; health.stalled = 1; }
        }
    };

    // ---- a pit stop and a repair: the engine is whole, the oil and the coolant are full, and it is cool
    this.repair = function () {
        for (var key in health) if (key.length > 2) health[key] = 0;          // (the two-letter ones are where the bay and the radiator are)
        health.coolant = 1; health.oil = 1; health.temp = 78; health.oilTemp = 70; health.power = 1;
        seized = false; cutLeft = 0; nextMisfire = 0; shockCool = 0; lastShock = 0; acc = 0;
        engine.healthScale = 1; engine.frictionScale = 1; engine.misfireCut = false; engine.disabled = false;
    };
    // the fluids and the heat only (a pit stop that does not repair the shell): top up, cool down
    this.refill = function () { health.coolant = 1; health.oil = 1; };
    this.repair();
};
