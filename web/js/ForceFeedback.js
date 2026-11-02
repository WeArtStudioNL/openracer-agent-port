/*
 * ForceFeedback.js
 *
 * Description: Force feedback on a racing wheel. The torque that the driver would feel is calculated from the physics every frame
 *              (the aligning torque of the front tyres, which goes light when they slide, the bumps of the road, the rumble of grass and
 *              kerbs, the pulses of the ABS, the jolt of a hit) and is sent to the wheel in one of three ways:
 *
 *              - a wheel that speaks HID PID (the standard for force feedback devices: PXN, Thrustmaster, Fanatec, Moza, Simagic, the
 *                Logitech G920/G923 in their native mode, and most others) through WebHID: a constant force effect that is updated every
 *                frame, with a spring and a damper that the wheel does itself;
 *              - a Logitech wheel with the classic protocol (G25, G27, G29, Driving Force GT and Pro) through WebHID: the constant force
 *                of its first slot and its own centring spring;
 *              - a gamepad or wheel without any of that: rumble through the Gamepad API, from the bumps and the slip (no torque).
 *
 *              WebHID exists in Chrome and Edge, and a device has to be chosen once by the user (Connect in the settings menu); after that
 *              it is opened again by itself, also when it is switched off and on during a race (a wheel without a serial number loses that
 *              permission when it goes, and has to be chosen again). The settings menu has the strength, the centring spring, the damping, the road detail and the
 *              direction. See Settings.js for the options and Car.js for the call every frame.
 */

var ForceFeedback = (function() {
    var PID_PAGE = 0x0f;
    var STORAGE_KEY = "openracer.ffb.device";
    var device = null;          // the HIDDevice
    var driver = null;          // "pid" or "logitech"
    var deviceName = "";
    var failure = "";           // why the device does not work, if it does not
    var connecting = false;
    var opening = false;        // a device is being opened
    var session = 0;            // goes up when the wheel is gone: what was still to be sent to it is dropped
    var reopenTimer = null;
    var lastSent = 0;           // the last constant force that was sent (-1..1)
    var lastSendTime = 0;
    var lastSpring = -1, lastDamper = -1;
    var output = 0;             // the torque that is sent, smoothed (-1..1)
    var queue = Promise.resolve();
    var pid = null;             // the reports of a PID device (see parse)
    var phase = 0;              // for the vibrations
    var noiseValue = 0;
    var impactLeft = 0;
    var lastSteer = 0;
    var steerRateFiltered = 0;
    var currentSpeed = 0;
    var testUntil = 0;

    function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }

    var logLines = [];
    function log(text) {
        logLines.push(text);
        if(logLines.length > 60) logLines.shift();
        console.log("Force feedback: " + text);
    }

    // Everything that is known about the device, to find out why a wheel does not work: the reports of its descriptor and what was made of them
    function diagnose() {
        if(!device) return "No device. " + (failure || "");
        var lines = [deviceName + " vendor " + device.vendorId.toString(16) + " product " + device.productId.toString(16) + ", driver " + driver + (failure ? ", failure: " + failure : "")];
        flattenReports(device.collections).forEach(function(r) {
            lines.push(r.kind + " id " + r.id + " (" + r.bits + " bits): " + r.fields.map(function(f) {
                if(f.array) return "[" + f.usages.map(function(u) { return u.toString(16); }).join(",") + "]x" + f.size + "b";
                return f.usage.toString(16) + ":" + f.size + "b(" + f.min + ".." + f.max + ")";
            }).join(" "));
        });
        if(pid) {
            lines.push("PID: set effect " + (pid.setEffect && pid.setEffect.id) + ", constant " + (pid.setConstant && pid.setConstant.id) + ", condition " + (pid.setCondition && pid.setCondition.id) +
                ", operation " + (pid.operation && pid.operation.id) + ", control " + (pid.control && pid.control.id) + ", gain " + (pid.deviceGain && pid.deviceGain.id) +
                ", create " + (pid.create && pid.create.id) + ", block load " + (pid.blockLoad && pid.blockLoad.id) + "; types " + pid.types.map(function(u) { return u.toString(16); }).join(",") +
                "; blocks " + JSON.stringify(blocks) + "; spring " + pid.hasSpring + " damper " + pid.hasDamper);
        }
        return lines.concat(logLines).join("\n");
    }

    function option(name, fallback) {
        var v = Settings.option(name);
        return v === undefined ? fallback : v;
    }

    // ---- the torque, from the physics (also used by the tests: it needs the vehicle and the options only)
    //
    // Returns { torque, vibration } with the torque in -1..1 (positive turns the wheel to the right) and the vibration 0..1 (for the rumble).
    function compute(vehicle, dt, opts) {
        var w = vehicle.wheels;
        var g = 9.81;
        var frontWeight = vehicle.mass * g * vehicle.weight_distribution;
        // the aligning torque: the lateral force of the front tyres on the trail of the steering pulls the wheel back to the middle.
        // The tyres are at their limit when it stops growing and then falls: the wheel goes light.
        // The trail shrinks as the slip angle grows (the pneumatic trail of a tyre collapses before its grip does), so a front tyre that
        // slides pulls hardly at all: the wheel goes light in understeer.
        var fy = 0;
        for(var t = 0; t < 2; t++) {
            var trail = clamp(1 - ((w[t].s || 0) - 0.6) / 1.2, 0.12, 1);
            fy += (w[t].fy || 0) * trail;
        }
        var aligning = clamp(fy / (0.75 * frontWeight), -1.5, 1.5);
        // standing still the tyres make no aligning torque: it fades in with the speed
        var speed = Math.abs(vehicle.u);
        aligning *= clamp(speed / 3, 0, 1);
        var torque = aligning * opts.strength;

        // the vibrations: bumps of the road (the springs move fast), grass and kerbs, the sliding of the front tyres, the ABS
        var bump = 0, rough = 0, slide = 0, abs = 0;
        for(var i = 0; i < 2; i++) {
            var wheel = w[i];
            if(!wheel.hasContact) continue;
            bump = Math.max(bump, Math.abs(wheel.compressionVelocity || 0));
            if(wheel.surface === "grass" || wheel.surface === "ground") rough = 1;
            if(wheel.s > 1.2 && speed > 3) slide = Math.max(slide, clamp((wheel.s - 1.2) / 1.5, 0, 1));
            if(wheel.abs) abs = 1;
        }
        var road = opts.road;
        phase += dt;
        noiseValue += (Math.random() * 2 - 1 - noiseValue) * Math.min(1, dt * 40);
        var vibration = 0;
        var detail = 0;
        if(bump > 0.15) { detail += clamp((bump - 0.15) / 1.5, 0, 0.6) * Math.sin(phase * 2 * Math.PI * 22); vibration += clamp((bump - 0.15) / 1.5, 0, 1); }
        if(rough && speed > 2) { detail += 0.25 * clamp(speed / 15, 0.2, 1) * noiseValue; vibration += 0.5 * clamp(speed / 15, 0.2, 1); }
        if(slide > 0) { detail += 0.18 * slide * Math.sin(phase * 2 * Math.PI * 27); vibration += 0.6 * slide; }
        if(abs) { detail += 0.2 * Math.sign(Math.sin(phase * 2 * Math.PI * 14)); vibration += 0.4; }
        torque += detail * road;

        // a hit: a jolt that dies away
        if(vehicle.impactTime < 0.02 && vehicle.lastImpact > 1) impactLeft = clamp(vehicle.lastImpact / 8, 0.3, 1) * (Math.random() < 0.5 ? -1 : 1);
        if(Math.abs(impactLeft) > 0.01) {
            torque += impactLeft * Math.sin(phase * 2 * Math.PI * 9);
            vibration += Math.abs(impactLeft);
            impactLeft *= Math.exp(-dt * 7);
        }
        // the hard stop of the steering: past the lock of the car (vehicle.wheelStop is the position of the wheel as a part of it, WheelControls.js, with "Match the steering lock of
        // the car") the wheel is pushed back with all the force, over the last 3 percent before the lock and 3 more past it, as the end stop of a kart that the column runs into
        var stop = vehicle.wheelStop || 0;
        if(Math.abs(stop) > 0.97) {
            var wall = clamp((Math.abs(stop) - 0.97) / 0.06, 0, 1);
            torque = torque * (1 - wall) - Math.sign(stop) * wall;
            vibration += 0.3 * wall;
        }
        // the engine shakes the wheel a little at idle
        if(vehicle.engine && vehicle.engine.running && speed < 1) torque += 0.02 * road * Math.sin(phase * 2 * Math.PI * vehicle.engine.getRPM() / 60);
        return { torque: clamp(torque, -1, 1), vibration: clamp(vibration, 0, 1) };
    }

    // ---- HID PID: the reports are found in the descriptor of the device, by the usages they hold
    function flattenReports(collections) {
        var byKey = {};
        function walk(collection) {
            ["inputReports", "outputReports", "featureReports"].forEach(function(kind) {
                (collection[kind] || []).forEach(function(report) {
                    var key = kind + ":" + report.reportId;
                    if(byKey[key]) return; // the outermost collection lists the whole report; the nested ones repeat their part of it
                    byKey[key] = { kind: kind, id: report.reportId, fields: [], bits: 0 };
                    var r = byKey[key];
                    report.items.forEach(function(item) {
                        var usages = item.isRange ? rangeUsages(item) : (item.usages || []);
                        if(item.isArray) {
                            // a selector: one value that is the index (1-based) of the usage in its list
                            for(var c = 0; c < item.reportCount; c++) {
                                r.fields.push({ usages: usages, array: true, bit: r.bits, size: item.reportSize, min: item.logicalMinimum, max: item.logicalMaximum, exponent: item.unitExponent });
                                r.bits += item.reportSize;
                            }
                        } else {
                            for(var k = 0; k < item.reportCount; k++) {
                                var usage = usages.length ? usages[Math.min(k, usages.length - 1)] : 0;
                                r.fields.push({ usage: usage, bit: r.bits, size: item.reportSize, min: item.logicalMinimum, max: item.logicalMaximum, exponent: item.unitExponent, constant: item.isConstant });
                                r.bits += item.reportSize;
                            }
                        }
                    });
                });
            });
            (collection.children || []).forEach(walk);
        }
        collections.forEach(walk);
        return Object.keys(byKey).map(function(k) { return byKey[k]; });
    }

    function rangeUsages(item) {
        var list = [];
        var page = (item.usageMinimum >>> 16) << 16;
        for(var u = item.usageMinimum; u <= item.usageMaximum && list.length < 64; u++) list.push(page | (u & 0xffff));
        return list;
    }

    function pidUsage(id) { return (PID_PAGE << 16) | id; }

    function hasUsage(report, usage) {
        return report.fields.some(function(f) { return f.usage === usage || (f.array && f.usages.indexOf(usage) >= 0); });
    }

    function writeBits(bytes, bit, size, value) {
        value = Math.round(value);
        for(var i = 0; i < size; i++) {
            var b = bit + i;
            if(value & (1 << i)) bytes[b >> 3] |= 1 << (b & 7);
            else bytes[b >> 3] &= ~(1 << (b & 7));
        }
    }

    function readBits(view, bit, size) {
        var value = 0;
        for(var i = 0; i < size; i++) {
            var b = bit + i;
            if(view.getUint8(b >> 3) & (1 << (b & 7))) value |= 1 << i;
        }
        return value;
    }

    // A report to send: values by usage. unsigned values are a part of 0..1 of the range, signed ones -1..1
    function Report(report) {
        this.report = report;
        this.bytes = new Uint8Array(Math.ceil(report.bits / 8));
    }
    Report.prototype.set = function(usage, value) {
        var hit = false;
        this.report.fields.forEach(function(f) {
            if(f.usage !== usage || f.array) return;
            writeBits(this.bytes, f.bit, f.size, clamp(value, f.min, f.max));
            hit = true;
        }, this);
        return hit;
    };
    Report.prototype.setRaw = function(usage, value) {
        this.report.fields.forEach(function(f) {
            if(f.usage !== usage || f.array) return;
            writeBits(this.bytes, f.bit, f.size, value);
        }, this);
    };
    Report.prototype.setFraction = function(usage, fraction) {
        this.report.fields.forEach(function(f) {
            if(f.usage !== usage || f.array) return;
            writeBits(this.bytes, f.bit, f.size, f.min + (f.max - f.min) * clamp(fraction, 0, 1));
        }, this);
    };
    Report.prototype.setSigned = function(usage, value) {
        this.report.fields.forEach(function(f) {
            if(f.usage !== usage || f.array) return;
            var v;
            if(f.min < 0) v = value >= 0 ? value * f.max : -value * f.min;
            else v = f.min + (f.max - f.min) * (value + 1) / 2;
            writeBits(this.bytes, f.bit, f.size, clamp(v, f.min, f.max));
        }, this);
    };
    Report.prototype.setAll = function(usage) {
        this.report.fields.forEach(function(f) {
            if(f.usage !== usage || f.array) return;
            writeBits(this.bytes, f.bit, f.size, f.size >= 32 ? 0xffffffff : (1 << f.size) - 1);
        }, this);
    };
    // a selector: the chosen usage of an array field
    Report.prototype.select = function(selectorUsages, chosen) {
        var hit = false;
        this.report.fields.forEach(function(f) {
            if(!f.array || hit) return;
            var index = f.usages.indexOf(chosen);
            if(index < 0) return;
            writeBits(this.bytes, f.bit, f.size, f.min + index);
            hit = true;
        }, this);
        if(!hit) log("the report has no selector for usage " + chosen.toString(16));
        return hit;
    };
    Report.prototype.send = function() {
        var r = this.report;
        if(setupLogging) log((r.kind === "featureReports" ? "feature " : "output ") + r.id + ": " + Array.prototype.map.call(this.bytes, function(b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(" "));
        if(r.kind === "featureReports") return device.sendFeatureReport(r.id, this.bytes);
        return device.sendReport(r.id, this.bytes);
    };
    var setupLogging = true; // the reports of the setup are logged, the constant force every frame is not

    var U = { setEffect: 0x21, blockIndex: 0x22, pbo: 0x23, effectType: 0x25, constant: 0x26, spring: 0x40, damper: 0x41, byteCount: 0x2b,
        duration: 0x50, samplePeriod: 0x51, gain: 0x52, triggerButton: 0x53, triggerRepeat: 0x54, axesEnable: 0x55, directionEnable: 0x56, direction: 0x57,
        startDelay: 0xa7, cpOffset: 0x60, posCoeff: 0x61, negCoeff: 0x62, posSat: 0x63, negSat: 0x64, deadBand: 0x65, magnitude: 0x70,
        effectOperation: 0x78, opStart: 0x79, opStartSolo: 0x7a, opStop: 0x7b, loopCount: 0x7c, deviceGain: 0x7e,
        deviceControl: 0x96, enableActuators: 0x97, disableActuators: 0x98, stopAll: 0x99, reset: 0x9a, blockLoadStatus: 0x8b, loadSuccess: 0x8c };

    function parsePid(collections) {
        var reports = flattenReports(collections);
        var out = function(usageId, extra) {
            return reports.filter(function(r) { return r.kind === "outputReports" && hasUsage(r, pidUsage(usageId)) && (!extra || extra(r)); })[0] || null;
        };
        var p = {
            setEffect: out(U.constant, function(r) { return hasUsage(r, pidUsage(U.duration)) || hasUsage(r, pidUsage(U.gain)); }),
            setConstant: out(U.magnitude, function(r) { return !hasUsage(r, pidUsage(0x71)) && !hasUsage(r, pidUsage(0x72)) && !hasUsage(r, pidUsage(0x6f)); }),
            setCondition: out(U.cpOffset),
            operation: out(U.opStart),
            control: out(U.enableActuators),
            deviceGain: out(U.deviceGain),
            create: reports.filter(function(r) { return r.kind === "featureReports" && hasUsage(r, pidUsage(U.constant)); })[0] || null,
            blockLoad: reports.filter(function(r) { return (r.kind === "featureReports" || r.kind === "inputReports") && hasUsage(r, pidUsage(U.loadSuccess)); })[0] || null
        };
        if(!p.setEffect || !p.setConstant || !p.operation) return null;
        // which effect types the device has
        var types = [];
        p.setEffect.fields.forEach(function(f) { if(f.array) f.usages.forEach(function(u) { if(types.indexOf(u) < 0) types.push(u); }); });
        p.types = types;
        p.hasSpring = types.indexOf(pidUsage(U.spring)) >= 0 && !!p.setCondition;
        p.hasDamper = types.indexOf(pidUsage(U.damper)) >= 0 && !!p.setCondition;
        return p;
    }

    function later(fn) {
        var started = session;
        queue = queue.then(function() { if(started === session) return fn(); }).catch(function(error) {
            if(started !== session) return;
            failure = "Force feedback: " + (error.message || error);
            log("error: " + (error.message || error));
        });
        return queue;
    }

    function wait(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }

    // Makes an effect of a type on the device and gives its block index (a promise)
    function createEffect(typeUsage) {
        if(!pid.create || !pid.blockLoad) return Promise.resolve(nextBlock++);
        var r = new Report(pid.create);
        r.select([pidUsage(U.effectType)], typeUsage);
        r.setRaw(pidUsage(U.byteCount), 0);
        r.setRaw((0x01 << 16) | 0x3b, 0); // the byte count is on the Generic Desktop page in some descriptors
        return r.send().then(function() { return wait(20); }).then(function() {
            return device.receiveFeatureReport(pid.blockLoad.id);
        }).then(function(view) {
            // the report id is the first byte of what comes back when the device uses report ids
            var offset = pid.blockLoad.id ? 8 : 0;
            var index = 1, status = null;
            pid.blockLoad.fields.forEach(function(f) {
                if(f.usage === pidUsage(U.blockIndex)) index = readBits(view, f.bit + offset, f.size);
                if(f.array && f.usages.indexOf(pidUsage(U.loadSuccess)) >= 0) { var v = readBits(view, f.bit + offset, f.size); status = f.usages[v - f.min]; }
            });
            log("block load: index " + index + ", status " + (status === null ? "unknown" : status.toString(16)));
            if(status !== null && status !== pidUsage(U.loadSuccess)) throw new Error("the wheel could not make an effect (block load " + status.toString(16) + ")");
            return index || 1;
        });
    }
    var nextBlock = 1;

    function setEffectReport(block, typeUsage, directionFraction) {
        var r = new Report(pid.setEffect);
        r.set(pidUsage(U.blockIndex), block);
        r.select([pidUsage(U.effectType)], typeUsage);
        r.setAll(pidUsage(U.duration));           // for ever
        r.set(pidUsage(U.triggerRepeat), 0);
        r.set(pidUsage(U.samplePeriod), 0);
        r.setFraction(pidUsage(U.gain), 1);
        r.setRaw(pidUsage(U.triggerButton), 0);   // no trigger button (0 is outside the range of the buttons)
        r.setRaw(pidUsage(U.startDelay), 0);
        // the axes: the first one (X) on, the direction along it. Axes Enable holds Generic Desktop X and Y (one bit each); the
        // Direction collection holds two instances (the Ordinal page, or usages 1 and 2 of the PID page, or Generic Desktop X and Y).
        var axes = 0, dirs = 0;
        pid.setEffect.fields.forEach(function(f) {
            if(f.array) return;
            var page = f.usage >>> 16, id = f.usage & 0xffff;
            if(page === 0x01 && f.size === 1) { writeBits(r.bytes, f.bit, 1, axes === 0 ? 1 : 0); axes++; return; }   // axes enable X, Y
            var direction = (page === 0x0a) || (page === 0x0f && (id === 0x01 || id === 0x02)) || (page === 0x01 && f.size > 1);
            if(direction) { writeBits(r.bytes, f.bit, f.size, dirs === 0 ? f.min + (f.max - f.min) * directionFraction : f.min); dirs++; return; }
            if(f.usage === pidUsage(U.directionEnable)) writeBits(r.bytes, f.bit, f.size, 1);
        });
        return r.send();
    }

    function operation(block, opUsage) {
        var r = new Report(pid.operation);
        r.set(pidUsage(U.blockIndex), block);
        r.select([pidUsage(U.effectOperation), pidUsage(U.opStart)], pidUsage(opUsage));
        r.set(pidUsage(U.loopCount), 1);
        return r.send();
    }

    function control(usage) {
        if(!pid.control) return Promise.resolve();
        var r = new Report(pid.control);
        r.select([pidUsage(U.deviceControl), pidUsage(U.enableActuators)], pidUsage(usage));
        return r.send();
    }

    function sendCondition(block, coefficient, saturation) {
        var r = new Report(pid.setCondition);
        r.set(pidUsage(U.blockIndex), block);
        r.set(pidUsage(U.pbo), 0);
        r.setSigned(pidUsage(U.cpOffset), 0);
        r.setSigned(pidUsage(U.posCoeff), coefficient);
        r.setSigned(pidUsage(U.negCoeff), coefficient);
        r.setFraction(pidUsage(U.posSat), saturation);
        r.setFraction(pidUsage(U.negSat), saturation);
        r.setFraction(pidUsage(U.deadBand), 0);
        return r.send();
    }

    var blocks = { constant: 0, spring: 0, damper: 0 };

    function startPid() {
        return later(function() {
            return control(U.reset).then(function() { return wait(30); })
                .then(function() { return control(U.stopAll); })
                .then(function() { return control(U.enableActuators); })
                .then(function() {
                    if(!pid.deviceGain) return;
                    var r = new Report(pid.deviceGain);
                    r.setFraction(pidUsage(U.deviceGain), 1);
                    return r.send();
                })
                .then(function() { return createEffect(pidUsage(U.constant)); })
                .then(function(block) {
                    blocks.constant = block;
                    return setEffectReport(block, pidUsage(U.constant), 0.25).then(function() { return sendConstant(0); }).then(function() { return operation(block, U.opStart); });
                })
                .then(function() {
                    if(!pid.hasSpring) return;
                    return createEffect(pidUsage(U.spring)).then(function(block) {
                        blocks.spring = block;
                        return setEffectReport(block, pidUsage(U.spring), 0.25).then(function() { return sendCondition(block, 0, 1); }).then(function() { return operation(block, U.opStart); });
                    });
                })
                .then(function() {
                    if(!pid.hasDamper) return;
                    return createEffect(pidUsage(U.damper)).then(function(block) {
                        blocks.damper = block;
                        return setEffectReport(block, pidUsage(U.damper), 0.25).then(function() { return sendCondition(block, 0, 1); }).then(function() { return operation(block, U.opStart); });
                    });
                });
        });
    }

    function sendConstant(value) {
        if(blocks.constant && setupLogging && lastSent !== 0) setupLogging = false;
        var r = new Report(pid.setConstant);
        r.set(pidUsage(U.blockIndex), blocks.constant);
        r.setSigned(pidUsage(U.magnitude), value);
        return r.send();
    }

    function stopPid() {
        if(!device || !pid) return Promise.resolve();
        return later(function() {
            return sendConstant(0).then(function() { return control(U.stopAll); }).then(function() { return control(U.disableActuators); });
        });
    }

    // ---- the Logitech classic protocol (7 byte commands, no report id)
    function lg(bytes) {
        var data = new Uint8Array(7);
        for(var i = 0; i < bytes.length; i++) data[i] = bytes[i];
        return device.sendReport(0, data);
    }

    function startLogitech() {
        return later(function() {
            return lg([0xf5]).then(function() { return lg([0xf8, 0x81, 900 & 0xff, 900 >> 8]); }).then(function() { return lg([0x11, 0x00, 0x80]); });
        });
    }

    function logitechSpring(strength) {
        // the centring spring of the wheel itself (the way the Linux driver sets it)
        if(strength <= 0.01) return lg([0xf5]);
        var m = Math.round(0xaaaa * clamp(strength, 0, 1));
        var a = Math.round(0x0c * m / 0xaaaa) >> 1, b = Math.round(0x80 * m / 0xaaaa);
        return lg([0xfe, 0x0d, a, a, b]).then(function() { return lg([0x14]); });
    }

    function stopLogitech() {
        if(!device) return Promise.resolve();
        return later(function() { return lg([0xf3]).then(function() { return lg([0xf5]); }); });
    }

    // ---- the device
    function describe(d) {
        return (d.productName || ("device " + d.vendorId.toString(16) + ":" + d.productId.toString(16)));
    }

    function useDevice(d) {
        failure = "";
        opening = true;
        return (d.opened ? Promise.resolve() : d.open()).then(function() {
            opening = false;
            device = d;
            deviceName = describe(d);
            pid = parsePid(d.collections);
            log("opened " + deviceName + (pid ? ", HID PID: " + diagnose().split("\n").slice(-1)[0] : ", no HID PID reports found"));
            if(pid) driver = "pid";
            else if(d.vendorId === 0x046d) driver = "logitech";
            else {
                driver = null;
                failure = deviceName + " has no force feedback that this game knows (no HID PID and not a Logitech wheel).";
                return;
            }
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ vendorId: d.vendorId, productId: d.productId })); } catch(e) { /* no storage */ }
            lastSpring = lastDamper = -1;
            lastSent = 0;
            nextBlock = 1;
            setupLogging = true;
            d.addEventListener("inputreport", function() { /* the game reads the wheel through the Gamepad API */ });
            return driver === "pid" ? startPid() : startLogitech();
        }, function(error) {
            opening = false;
            throw error;
        });
    }

    // The wheel is gone: nothing more goes to it, and a write that hangs on it does not hold up the wheel that comes back (the effects are lost with it, useDevice makes them again)
    function lost() {
        session++;
        queue = Promise.resolve();
        device = null; driver = null; pid = null;
        blocks = { constant: 0, spring: 0, damper: 0 };
        output = 0;
    }

    // Lets the user pick the wheel (a click is needed for this)
    function connect() {
        if(!navigator.hid) {
            failure = "This browser has no WebHID (use Chrome or Edge): rumble only.";
            return Promise.resolve(false);
        }
        connecting = true;
        return navigator.hid.requestDevice({ filters: [{ usagePage: 0x01, usage: 0x04 }, { usagePage: 0x01, usage: 0x05 }, { usagePage: 0x01, usage: 0x08 }] }).then(function(devices) {
            connecting = false;
            // the interface with the force feedback: the one that has output reports
            var chosen = devices.filter(function(d) { return flattenReports(d.collections).some(function(r) { return r.kind === "outputReports"; }); })[0] || devices[0];
            if(!chosen) return false;
            return disconnect().then(function() { return useDevice(chosen); }).then(function() { return !failure; });
        }).catch(function(error) {
            connecting = false;
            failure = "Force feedback: " + (error.message || error);
            return false;
        });
    }

    function disconnect() {
        if(!device) return Promise.resolve();
        var d = device;
        var stop = driver === "pid" ? stopPid() : stopLogitech();
        return stop.then(function() { return d.close(); }).catch(function() {}).then(function() {
            if(device === d) { device = null; driver = null; pid = null; }
        });
    }

    function forget() {
        try { localStorage.removeItem(STORAGE_KEY); } catch(e) { /* no storage */ }
        return disconnect().then(function() { deviceName = ""; failure = ""; });
    }

    function keptWheel() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch(e) { return null; }
    }

    function isKept(d, wanted) { return d.vendorId === wanted.vendorId && d.productId === wanted.productId; }

    function hasOutput(d) { return flattenReports(d.collections).some(function(r) { return r.kind === "outputReports"; }); }

    // Opens the wheel that was chosen before, without asking (the permission is kept by the browser). A wheel that was just switched on may not take the setup yet: it is tried again.
    function openKept(tries, anyInterface) {
        var wanted = keptWheel();
        if(!wanted || device || opening || connecting) return;
        navigator.hid.getDevices().then(function(devices) {
            var found = devices.filter(function(d) { return isKept(d, wanted); });
            var chosen = found.filter(hasOutput)[0] || (anyInterface ? found[0] : null);
            if(!chosen || device || opening || connecting) return;
            return useDevice(chosen).catch(function(error) {
                failure = "Force feedback: " + (error.message || error);
                log("error: " + (error.message || error));
            }).then(function() {
                if(device && device !== chosen) return;    // (the user chose another one meanwhile)
                if(!failure || (device && !driver)) return;
                log("the setup failed, try " + (tries + 1));
                lost();
                Promise.resolve(chosen.opened ? chosen.close() : null).catch(function() {});
                if(tries < 5) { clearTimeout(reopenTimer); reopenTimer = setTimeout(function() { openKept(tries + 1, anyInterface); }, 2000); }
            });
        });
    }

    function watchDevices() {
        if(!navigator.hid) return;
        openKept(0, true);
        navigator.hid.addEventListener("disconnect", function(event) {
            if(event.device !== device && !(device && !device.opened)) return;
            log("disconnected");
            lost();
            failure = "";
        });
        // the wheel is back as a new device. It is opened a moment later: it has several interfaces that come one by one, and it has just started up
        navigator.hid.addEventListener("connect", function(event) {
            var wanted = keptWheel();
            if(!wanted || !isKept(event.device, wanted)) return;
            log("connected again");
            clearTimeout(reopenTimer);
            reopenTimer = setTimeout(function() { openKept(0, false); }, 1500);
        });
        // The Gamepad API sees the wheel but WebHID does not give it: the browser kept no permission (it does not for a device without a serial number), and only a click can ask for it again
        window.addEventListener("gamepadconnected", function(event) {
            var wanted = keptWheel();
            if(!wanted || event.gamepad.id.toLowerCase().indexOf(hex4(wanted.vendorId)) < 0 || event.gamepad.id.toLowerCase().indexOf(hex4(wanted.productId)) < 0) return;
            setTimeout(function() {
                if(device || opening || connecting) return;
                navigator.hid.getDevices().then(function(devices) {
                    if(device || devices.some(function(d) { return isKept(d, wanted); })) return;
                    failure = "The browser needs permission for the wheel again: choose Connect a wheel… in the settings menu.";
                    log(failure);
                    if(typeof WheelControls !== "undefined") WheelControls.showMessage("Force feedback is off: the browser asks for the wheel to be chosen again.\nOpen the settings menu (Esc) and choose Connect a wheel…", 10000);
                });
            }, 3000);
        });
    }

    function hex4(n) { return ("000" + n.toString(16)).slice(-4); }

    // ---- every frame
    var lastUpdate = 0;
    // the window has the focus and is shown: else the wheel is let go, and not driven again by the next frame of a game that goes on in the background (the zero of the blur was
    // followed by a new force at once)
    var focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
    window.addEventListener("focus", function() { focused = true; });
    window.addEventListener("blur", function() { focused = false; });
    function windowActive() { return focused && !document.hidden && (typeof document.hasFocus !== "function" || document.hasFocus()); }
    function update(car, delta) {
        lastUpdate = performance.now();
        if((!windowActive() || car.autopilot || car.cameraOverride) && performance.now() >= testUntil) { neutral(); return; }      // (not active, or the car drives itself after the finish with the cinematic camera: the wheel is let go)
        if(!option("ffb", true)) {
            if(device && Math.abs(lastSent) > 0.001) send(0);
            return;
        }
        var opts = { strength: option("ffbStrength", 0.6), road: option("ffbRoad", 0.5) };
        var result = compute(car.vehicle, delta, opts);
        var torque = result.torque;
        if(performance.now() < testUntil) torque = 0.6 * Math.sin(performance.now() / 1000 * 2 * Math.PI * 1.5);
        // a centring spring when the wheel cannot do it itself, and damping: the wheel of the game sends its torque with a delay
        // (the frame, the USB) and a wheel that is let go at speed would swing to and fro on the aligning torque, as a car with a
        // worn damper does. The damping grows with the speed, both in the wheel itself (its damper effect) and here.
        var steer = car.turnAngle / (car.maxTurn || 0.5);
        var speed = Math.abs(car.vehicle.u);
        currentSpeed = speed;
        var speedFactor = 0.4 + 0.6 * clamp(speed / 25, 0, 1);
        var softSpring = !(device && (driver === "logitech" || (pid && pid.hasSpring)));
        if(softSpring) torque -= option("ffbSpring", 0.15) * steer;
        var steerRate = delta > 0 ? (steer - lastSteer) / delta : 0;
        lastSteer = steer;
        steerRateFiltered += (steerRate - steerRateFiltered) * Math.min(1, delta / 0.02);
        torque -= option("ffbDamping", 0.35) * speedFactor * clamp(steerRateFiltered * 0.12, -0.7, 0.7);
        if(option("ffbInvert", false)) torque = -torque;
        output += (torque - output) * Math.min(1, delta / (0.03 + 0.03 * clamp(speed / 30, 0, 1)));
        send(clamp(output, -1, 1));
        if(!device) rumble(result.vibration);
    }

    function send(value) {
        if(!device || !driver) return;
        var now = performance.now();
        if(now - lastSendTime < 8) return; // at most 120 times a second
        var spring = option("ffbSpring", 0.15);
        // the damper of the wheel itself, more at speed (sent when it changes)
        var damper = Math.round(option("ffbDamping", 0.35) * (0.4 + 0.6 * clamp(currentSpeed / 25, 0, 1)) * 20) / 20;
        if(driver === "pid") {
            if(Math.abs(value - lastSent) > 0.004 || now - lastSendTime > 200) {
                lastSent = value; lastSendTime = now;
                later(function() { return sendConstant(value); });
            }
            if(pid.hasSpring && spring !== lastSpring) { lastSpring = spring; later(function() { return sendCondition(blocks.spring, spring, 1); }); }
            if(pid.hasDamper && damper !== lastDamper) { lastDamper = damper; later(function() { return sendCondition(blocks.damper, damper, 1); }); }
        } else {
            if(Math.abs(value - lastSent) > 0.004 || now - lastSendTime > 200) {
                lastSent = value; lastSendTime = now;
                var force = clamp(Math.round(0x80 + value * 0x7f), 0, 0xff);
                later(function() { return lg([0x11, 0x00, force]); });
            }
            if(spring !== lastSpring) { lastSpring = spring; later(function() { return logitechSpring(spring); }); }
        }
    }

    // rumble through the Gamepad API, for a gamepad or a wheel without force feedback
    var lastRumble = 0;
    function rumble(amount) {
        var now = performance.now();
        if(now - lastRumble < 80) return;
        lastRumble = now;
        var pad = typeof WheelControls !== "undefined" ? WheelControls.findWheel() : null;
        if(!pad || !pad.vibrationActuator || !pad.vibrationActuator.playEffect) return;
        var level = clamp(amount * option("ffbRoad", 0.5) * 1.5, 0, 1);
        if(level < 0.02) return;
        pad.vibrationActuator.playEffect("dual-rumble", { startDelay: 0, duration: 120, strongMagnitude: level, weakMagnitude: level * 0.6 }).catch(function() {});
    }

    // The wheel let go: no force while the game does not run (the menu, a replay, the tab in the background, the window without focus). The force of a
    // HID PID wheel stays at the last value that was sent, so it pulled to one side for as long as the menu was open; and the zero of the background tab
    // could fall under the limit of 120 sends a second, and was lost. This zero always goes.
    function neutral() {
        output = 0;
        if(!device || !driver || Math.abs(lastSent) < 0.004) return;
        lastSendTime = 0;
        send(0);
    }
    // called every frame that the car does not run (main.js): the zero once, unless the test is shaking the wheel
    function idle() {
        if(performance.now() < testUntil) return;
        neutral();
    }

    // The test shakes the wheel for two seconds, also from the settings menu, where the game (and so update) does not run
    var testTimer = null;
    function test() {
        testUntil = performance.now() + 2000;
        if(testTimer) return;
        testTimer = setInterval(function() {
            var now = performance.now();
            if(now >= testUntil) { clearInterval(testTimer); testTimer = null; if(now - lastUpdate > 100) neutral(); return; }
            if(now - lastUpdate > 100) send(0.6 * Math.sin(now / 1000 * 2 * Math.PI * 1.5));     // (the game runs: update sends it)
        }, 16);
    }

    function status() {
        if(device && driver) return "Force feedback: " + deviceName + " (" + (driver === "pid" ? "HID PID" : "Logitech") + ")" + (failure ? " - " + failure : "") + (lastSent ? " sending " + lastSent.toFixed(2) : "");
        if(failure) return failure;
        if(!navigator.hid) return "Force feedback needs WebHID (Chrome or Edge); rumble only.";
        return "No force feedback device connected (connect it in the settings menu).";
    }

    window.addEventListener("beforeunload", function() { if(device) (driver === "pid" ? stopPid() : stopLogitech()); });
    document.addEventListener("visibilitychange", function() { if(document.hidden) neutral(); });
    window.addEventListener("blur", neutral);
    watchDevices();

    return {
        update: update,
        compute: compute,
        connect: connect,
        forget: forget,
        test: test,
        neutral: neutral,
        idle: idle,
        status: status,
        diagnose: diagnose,
        parse: parsePid,               // for tests: the PID reports of a descriptor (collections as WebHID gives them)
        makeReport: function(report) { return new Report(report); },
        isConnected: function() { return !!(device && driver); },
        deviceName: function() { return deviceName; },
        canConnect: function() { return !!navigator.hid; }
    };
})();
