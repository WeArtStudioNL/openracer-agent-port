/*
    OpenRacer, 
    Copyright (C) 2015 Chris Barnard

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/*
 * Car.js
 * 
 * Author: Chris Barnard
 * Description: Gives us a structure for holding information about a car.
 * Notes: Obviously, this is currently a massive mess. First job is to tidy up,
 *        follow some sort of style guide and restructure coherently.
 */

// Builds a car from its configuration: the contents of cars/<id>/car.json (see the car editor in tools/car-editor.html).
OpenRacer.Car = function( config, domElement ) {
    var chassis = config.chassis;
    var drivetrain = config.drivetrain;
    this.config = config;
    this.wheels = [];
    this.wheelsLoaded = false; // set once the model has loaded and all four wheels exist
    this.bodyLoaded = false;   // set once the body model has loaded
    this.loadError = null;     // description of a failed model load, if any
    this.wheelbase = chassis.wheelbase;
    this.front_track = chassis.front_track;
    this.rear_track = chassis.rear_track;
    this.weight_distribution = chassis.weight_distribution;
    this.tire_diameter = chassis.tire_diameter;
    this.body = new THREE.Object3D();
    this.bodyLift = 2;         // how far the origin of the body is above the road, in tyre radii (set by the model)
    this.mass = chassis.mass;
    this.throttle = 0;
    this.brakePedal = 0;
    this.width = config.dimensions.width;
    this.height = config.dimensions.height;
    this.length = config.dimensions.length;
    this.frontal_area = this.width * this.height * 0.85;
    this.Cd = chassis.drag_coefficient;
    this.Cdrag = 0.5 * this.Cd * this.frontal_area * air_density;
    this.reset = false;
    this.cameraAngle = 0;
    
    this.lapsCompleted = 0;
    this.raceLaps = 0;        // the laps of the race (0: practice, no end), shown by the HUD
    this.held = false;        // held on the grid (the countdown of a race, see main.js)
    this.lapStartTime = 0;    // the time (of the clock below) that the lap that is going started
    this.laps = [];
    this.lapTimes = [];       // the times of the laps that are done, in seconds
    this.clock = 0;           // the time that the car has been driven (not while the game is paused), in seconds
    this.checkPointsCompleted = trackCheckPoints.map(function() { return false; });
    this.ghost = null;        // the ghost of the best lap (Ghost.js), set by the game
    this.racePosition = 0;    // in a race: the place, and how many cars there are
    this.raceCount = 0;
    this.newRecord = false;   // the last lap was a record
    this.currentCheckPoint = "";
    
    // Where the car starts (and returns to with the reset key): from the track
    var startX = currentTrack.start.x;
    var startZ = currentTrack.start.z;
    var startHeading = currentTrack.start.heading || 0;

    this.gear_ratios = drivetrain.gear_ratios;
    this.final_drive = drivetrain.final_drive;
    this.current_gear = 0;
    this.manualGearbox = false;     // the driver selects the gears (sequential and manual): no automatic shifting
    this.neutral = false;           // no drive while in neutral
    this.clutch = 0;                // clutch pedal: 0 = engaged, 1 = fully pressed
    this.clutchPedalPresent = false; // the clutch pedal works the clutch (manual mode, used last); otherwise the clutch is automatic
    this.handbrake = false;
    this.engineRPM = (config.engine && config.engine.idle_rpm) || 900; // engine speed, for the dashboard and the engine sound

    this.accelerate = false;
    this.brake = false;
    this.reverse = false;
    this.turnLeft = false;
    this.turnRight = false;
    this.turnDir = 0;
    this.maxTurn = (chassis.max_steer_deg || 30) * Math.PI / 180;
    this.turnLimit = this.maxTurn;
    this.turnSpeed = 2; // radians per second
    this.turnAngle = 0;
    this.turnAmt = 0;

    this.carAngle = startHeading; // heading of the car, from +x towards +z
    
    var tobj = this;

    // The physics of the car (see Vehicle.js); the car reads its controls from this object
    this.vehicle = new OpenRacer.Vehicle({
        mass: this.mass,
        wheelbase: this.wheelbase,
        front_track: this.front_track,
        rear_track: this.rear_track,
        weight_distribution: this.weight_distribution,
        cgHeight: chassis.cg_height,
        roll_front: chassis.roll_front,
        spring_front: chassis.spring_front,
        spring_rear: chassis.spring_rear,
        damping_front: chassis.damping_front,
        damping_rear: chassis.damping_rear,
        downforce: chassis.downforce,
        tire_diameter: this.tire_diameter,
        width: this.width,
        length: this.length,
        height: this.height,
        Cdrag: this.Cdrag,
        gear_ratios: this.gear_ratios,
        reverse_ratio: drivetrain.reverse_ratio,
        final_drive: this.final_drive,
        efficiency: drivetrain.efficiency,
        drive: drivetrain.drive,
        diff: drivetrain.diff,
        diff_preload: drivetrain.diff_preload,
        diff_lock: drivetrain.diff_lock,
        diff_power: drivetrain.diff_power,
        diff_coast: drivetrain.diff_coast,
        center_diff: drivetrain.center_diff,
        center_split: drivetrain.center_split,
        engine: config.engine,
        brake_front: config.brakes && config.brakes.front,
        brake_rear: config.brakes && config.brakes.rear,
        tank: config.fuel && config.fuel.tank,
        getSurface: getSurface
    }, this);
    this.vehicle.collision = collisionWorld;
    this.vehicle.ground = groundWorld;
    this.pit = new OpenRacer.PitStop(this.vehicle); // the pit stop on the pit lane (Pit.js), when the race has wear and fuel
    var tyreSmoke = new OpenRacer.TyreSmoke(scene);
    this.engine = this.vehicle.engine;
    EngineSound.setCar(config); // the engine sound of this car
    this.wheels = this.vehicle.wheels;
    var placed = false; // set once the car has been put on the road

    // The model: the body (it pitches and rolls) and the four wheels, see CarLoader.js
    OpenRacer.loadCarModel(config, function(model) {
        tobj.bodyLift = model.bodyLift;
        tobj.steeringWheel = model.steeringWheel || null;
        tobj.followModelWheels(model.measured);
        tobj.body.add(model.tilt);
        scene.add(tobj.body);
        shadowLight.target = tobj.body;
        tobj.bodyLoaded = true;
        for(var i = 0; i < tobj.wheels.length; i++) {
            tobj.wheels[i].object = model.wheels[i];
            scene.add(model.wheels[i]);
        }
        tobj.wheelsLoaded = true;
    }, function(message) {
        tobj.loadError = message;
        console.error(message);
        var banner = document.createElement("div");
        banner.style.cssText = "position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 1001; " +
            "padding: 10px 20px; background: rgba(160, 0, 0, 0.85); color: #ffffff; font-family: Arial;";
        banner.textContent = message;
        document.body.appendChild(banner);
    });

    // The wheels of a glTF model say where the wheels are: the physics takes the wheelbase, the tracks and the tyre from them, and the body
    // is placed so that its wheel arches are over the wheels (whatever the origin of the model is), so the game shows the car the way
    // the car editor does.
    var modelMid = null; // the middle between the wheels of the model, in the space of the model
    this.followModelWheels = function(measured) {
        if(!measured) return;
        var c = measured.centres;
        var wheelbase = (c.FR.z + c.FL.z) / 2 - (c.RL.z + c.RR.z) / 2;
        var frontTrack = Math.abs(c.FR.x - c.FL.x);
        var rearTrack = Math.abs(c.RR.x - c.RL.x);
        var diameter = measured.diameter;
        if(!(wheelbase > 1.2 && wheelbase < 5 && frontTrack > 0.6 && frontTrack < 3 && rearTrack > 0.6 && rearTrack < 3 && diameter > 0.3 && diameter < 1.5)) {
            console.warn("Car: the wheels of the model give no sensible wheelbase/track/tyre (" + wheelbase.toFixed(2) + ", " + frontTrack.toFixed(2) + ", " + rearTrack.toFixed(2) + ", " + diameter.toFixed(2) + "), using car.json");
            return;
        }
        var differs = Math.abs(wheelbase - this.wheelbase) > 0.02 || Math.abs(frontTrack - this.front_track) > 0.02 || Math.abs(rearTrack - this.rear_track) > 0.02 || Math.abs(diameter - this.tire_diameter) > 0.02;
        if(differs) console.log("Car: the wheels of the model differ from car.json (wheelbase " + wheelbase.toFixed(3) + ", tracks " + frontTrack.toFixed(3) + "/" + rearTrack.toFixed(3) + ", tyre " + diameter.toFixed(3) + "): the model wins");
        this.wheelbase = wheelbase; this.front_track = frontTrack; this.rear_track = rearTrack; this.tire_diameter = diameter;
        this.vehicle.retune({ wheelbase: wheelbase, front_track: frontTrack, rear_track: rearTrack, tire_diameter: diameter });
        modelMid = new THREE.Vector3((c.FR.x + c.FL.x + c.RL.x + c.RR.x) / 4, (c.FR.y + c.FL.y + c.RL.y + c.RR.y) / 4, (c.FR.z + c.FL.z + c.RL.z + c.RR.z) / 4);
    };

    // Puts the car on the road at a position, standing still
    this.place = function(x, z, heading) {
        var v = this.vehicle;
        v.reset(x, z, heading);
        tyreSmoke.clear();
        lastGateX = null; // a jump of the car is no crossing of a gate
        this.lapStarted = false;
        this.throttle = 0;
        this.brakePedal = 0;
        this.turnAngle = 0;
        this.current_gear = 0;
        this.updateVisuals(0);
    };

    // ---- display: the 3D objects follow the physics

    var bodyPosition = { x: 0, y: 0, z: 0 };
    var cameraBaseY = null;   // the height that the cameras behind the car stand on
    var bodyQuaternion = { x: 0, y: 0, z: 0, w: 1 };
    var bodyUp = new THREE.Vector3();

    this.updateVisuals = function(delta) {
        var v = this.vehicle;
        var w = this.wheels;
        this.carAngle = v.psi;
        var cosP = Math.cos(v.psi);
        var sinP = Math.sin(v.psi);
        var yaw = piOver2 - v.psi; // the model faces +z

        // the middle between the axles, which is the centre of the body model
        var offset = (v.af - v.ar) / 2;
        var cx = v.x + cosP * offset;
        var cz = v.z + sinP * offset;

        // the body follows the rigid body of the physics. Its origin is bodyLift tyre radii above the road at rest (see CarLoader.js),
        // the physics gives the height of the axles at rest, one radius above the road.
        v.getBodyPose(bodyPosition, bodyQuaternion);
        this.body.quaternion.set(bodyQuaternion.x, bodyQuaternion.y, bodyQuaternion.z, bodyQuaternion.w);
        bodyUp.set(0, 1, 0).applyQuaternion(this.body.quaternion);
        if(modelMid) {
            // the middle between the wheels of the model goes where the physics has the middle between the axles
            bodyUp.copy(modelMid).applyQuaternion(this.body.quaternion);
            this.body.position.set(bodyPosition.x - bodyUp.x, bodyPosition.y - bodyUp.y, bodyPosition.z - bodyUp.z);
        } else {
            var lift = (this.bodyLift - 1) * w[0].radius;
            this.body.position.set(bodyPosition.x + bodyUp.x * lift, bodyPosition.y + bodyUp.y * lift, bodyPosition.z + bodyUp.z * lift);
        }
        if(this.body.children[0]) this.body.children[0].rotation.set(0, 0, 0);

        // the wheels hang on their springs
        for(var i = 0; i < 4; i++) {
            var wheel = w[i];
            wheel.position.set(wheel.center.x, wheel.center.y, wheel.center.z);
            if(wheel.object) {
                wheel.object.position.copy(wheel.position);
                wheel.object.quaternion.copy(this.body.quaternion);
                if(i < 2) wheel.turn(this.vehicle.steerApplied);
                wheel.object.children[0].children[0].rotation.x = wheel.spin;
            }
        }
        // the steering wheel of the model turns with the steering
        if(this.steeringWheel) {
            var sw = this.steeringWheel;
            var ratio = (sw.degrees * Math.PI / 180) / this.maxTurn;
            sw.object.quaternion.setFromAxisAngle(sw.axis, -v.steerApplied * ratio);
        }
        // the checkpoint of the road under the rear wheel
        var rear = w[2];
        if(trackGates.length === 0 && rear.hasContact && rear.normal) lastTerrain = rear.normal.mesh;

        tyreSmoke.update(delta, v, camera);
        // the cameras behind the car follow its height (a jump, a hill), not the road under it; the small movements of the springs are smoothed out
        var baseY = bodyPosition.y - w[0].radius;
        if(cameraBaseY === null || Math.abs(baseY - cameraBaseY) > 3) cameraBaseY = baseY;
        cameraBaseY += (baseY - cameraBaseY) * Math.min(1, delta / 0.08);
        this.updateCamera(delta, cx, cz, cameraBaseY, yaw, this.body.quaternion);

        shadowLight.position.copy(this.body.position).add(sunDirection);
    };

    // ---- the cameras: 1 is the fixed camera behind the car, 2 follows the direction of the car smoothly and
    // widens its field of view with the speed (and comes closer, so the car keeps its size), 3 is in the car. Their places are set per car (see CarDefaults.js).
    this.cameraSettings = OpenRacer.cameraSettings(config);
    this.cameraMode = 1;
    var followYaw = null;       // the direction that the following camera looks in
    var cameraFov = null;
    var cameraNear = 1;
    var qBody = new THREE.Quaternion();
    var qLook = new THREE.Quaternion();
    var qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    var eulerTilt = new THREE.Euler();
    var cockpitOffset = new THREE.Vector3();

    function wrapPi(a) {
        while(a > Math.PI) a -= 2 * Math.PI;
        while(a < -Math.PI) a += 2 * Math.PI;
        return a;
    }

    function setLens(fov, near) {
        if(Math.abs(camera.fov - fov) > 0.01 || camera.near !== near) {
            camera.fov = fov;
            camera.near = near;
            camera.updateProjectionMatrix();
        }
    }

    this.setCameraMode = function(mode) {
        this.cameraMode = mode;
        EngineSound.setInside(mode === 3);
        followYaw = null;
        cameraFov = null;
    };

    this.updateCamera = function(delta, cx, cz, avgGround, yaw, bodyQ) {
        var cs = this.cameraSettings;
        var radius = this.wheels[0].radius;
        var speed = Math.abs(this.vehicle.u);

        if(this.cameraMode === 3) {
            // in the car: the camera goes with the body, with the pitch and the roll
            qBody.copy(bodyQ);
            var p = cs.cockpit.position;
            cockpitOffset.set(p[0], p[1], p[2]).applyQuaternion(qBody).add(this.body.position);
            camera.position.copy(cockpitOffset);
            qLook.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraAngle);
            camera.quaternion.copy(qBody).multiply(qLook).multiply(qFlip);
            setLens(cs.cockpit.fov, 0.1);
            return;
        }

        if(this.cameraMode === 2) {
            var f = cs.follow;
            if(followYaw === null) followYaw = yaw;
            followYaw += wrapPi(yaw - followYaw) * (1 - Math.exp(-f.smoothing * Math.min(delta, 0.1)));
            // the faster, the wider the field of view
            var target = f.fov_standing + (f.fov_fast - f.fov_standing) * Math.min(1, speed / f.fov_full_speed);
            cameraFov = cameraFov === null ? target : cameraFov + (target - cameraFov) * (1 - Math.exp(-4 * Math.min(delta, 0.1)));
            // ... and the camera comes closer in the same measure, so that the car stays the same size in the picture: only
            // the field of view seems to change (a dolly zoom). The distance and the height are those at a standstill; dolly
            // is how far this goes: 1 keeps the car the same size, 0 leaves the camera where it is.
            var scale = 1 + f.dolly * (Math.tan(f.fov_standing * Math.PI / 360) / Math.tan(cameraFov * Math.PI / 360) - 1);
            camera.position.set(cx, avgGround + radius, cz);
            camera.rotation.set(0, followYaw + Math.PI + this.cameraAngle, 0);
            camera.translateZ(f.distance * scale);
            camera.position.y = avgGround + f.look_height + (f.height - f.look_height) * scale;
            camera.lookAt(cx, avgGround + f.look_height, cz);
            setLens(cameraFov, 1);
            return;
        }

        // the fixed camera behind the car
        camera.position.set(cx, avgGround + radius, cz);
        camera.rotation.set(0, yaw + Math.PI + this.cameraAngle, 0);
        camera.translateZ(cs.chase.distance);
        camera.translateY(cs.chase.height - radius);
        setLens(cs.chase.fov, 1);
    };

    this.startEngine = function() {
        this.vehicle.startEngine();
    };

    // ---- main loop

    this.update = function( delta, showDebug ) {
        if(!this.isReady()) return;
        if(!placed) {
            placed = true;
            this.place(startX, startZ, startHeading);
        }
        this.pollInput();
        gamepadUpdate();
        // on the grid before the start of a race: the brakes are on, the engine can be revved
        if(this.held) { this.brakePedal = 1; this.handbrake = true; this.accelerate = false; this.throttle = Math.min(this.throttle, 0.6); }
        // the clutch pedal works the clutch in the manual mode, once it is used or the shifter was moved
        if(this.clutchAvailable && this.gearboxMode === "manual" && this.clutch > 0.08) this.manualClutch = true;
        this.clutchPedalPresent = this.clutchAvailable && this.gearboxMode === "manual" && this.manualClutch;
        var v = this.vehicle;

        if(this.reset) {
            // one reset per key press
            this.reset = false;
            this.place(startX, startZ, startHeading);
            return;
        }

        if(this.cameraLeft) {
            this.cameraAngle += 2  * delta;
        }
        if(this.cameraRight) {
            this.cameraAngle -= 2 * delta;
        }
        if(showDebug) { debugClear(); }
        if(showDebug) {
            var wheelStatus = WheelControls.status();
            if(wheelStatus) debugOut(wheelStatus);
            if(typeof ForceFeedback !== "undefined") debugOut(ForceFeedback.status());
            var soundStatus = EngineSound.status();
            if(soundStatus) debugOut(soundStatus);
        }
        if(this.accelerate) {
            this.throttle += (1 - this.throttle) * delta * 4;
        }
        if(this.throttle > 1) this.throttle = 1;
        if(this.brake) {
            this.brakePedal += (1 - this.brakePedal) * delta * 6;
        }
        if(delta > 0.1) {
            if(showDebug) { debugOut("DELTA WARN - " + delta); }
            delta = 0.1;
        }
        this.clock += delta;

        // steering with the keyboard: slower at speed, and the wheels centre themselves
        this.turnDir = 0;
        if(this.turnLeft) this.turnDir = -1;
        if(this.turnRight) this.turnDir = 1;
        if(this.turnLeft && this.turnRight) this.turnDir = 0;
        var tSpeed = this.turnSpeed * 0.3;
        var speedFactor = Math.max(Math.abs(v.u) / 4, 1);
        if(this.turnDir === 0) {
            if(!mouseDown && !usingGamepad)
                this.turnAngle *= Math.pow(0.75, delta * 60);
        } else if(this.turnDir < 0 && this.turnAngle > 0) {
            this.turnAngle += this.turnDir * ((tSpeed * 3) / speedFactor) * delta;
        } else if(this.turnDir > 0 && this.turnAngle < 0) {
            this.turnAngle += this.turnDir * ((tSpeed * 3) / speedFactor) * delta;
        } else {
            this.turnAngle += this.turnDir * (tSpeed / speedFactor) * delta;
            if(Math.abs(this.turnAngle) > this.turnLimit) {
                this.turnAngle = this.turnDir * this.turnLimit;
            }
        }

        v.update(delta);
        this.pit.update(delta);
        this.engineRPM = this.engine.getRPM();
        // the rev limiter cuts the fuel: the engine sounds like it too
        EngineSound.update(this.engineRPM, this.throttle * this.engine.throttleCut, this.engine.throttleCut > 0.5);
        EngineSound.setTyres(v.squeal, Math.abs(v.u));

        this.updateVisuals(delta);
        if(typeof ForceFeedback !== "undefined") ForceFeedback.update(this, delta);

        Hud.update(this);

        if(showDebug) {
            var metric = Settings.option("units") !== "imperial";
            debugOut(Math.round(v.u * (metric ? 3.6 : 2.2369362920544)) + (metric ? " km/h" : " mph") + " | Gear: " + this.gearLabel() + " (" + this.gearboxMode +
                (this.clutchPedalPresent ? ", clutch pedal" : "") + ") | RPM: " + Math.round(this.engineRPM) +
                (this.engine.running ? "" : " (STALLED: " + (this.clutchPedalPresent ? "clutch + throttle or I to start" : "starting") + ")") +
                " | Throttle: " + this.throttle.toFixed(2) + " | Brake: " + this.brakePedal.toFixed(2) +
                " | Clutch: " + v.clutchEngagement.toFixed(2) + " | TC: " + (v.tcEnabled ? "on" : "off") + " | ESC: " + (v.escEnabled ? "on" : "off") + " | ABS: " + (v.absEnabled ? "on" : "off"));
        }

        this.updateLaps(showDebug);

        if(telemetry) {
            telemetry.update();
        }
    };

    // A track with gates (lines across the road, see the track editor): a gate is passed when the car crosses its line in the direction of
    // the gate. It is then handled like a piece of road that is a checkpoint.
    var lastGateX = null, lastGateZ = null;
    function checkGates(v) {
        var crossed = null;
        if(lastGateX !== null) {
            for(var g = 0; g < trackGates.length; g++) {
                var gate = trackGates[g];
                var dx = Math.cos(gate.heading), dz = Math.sin(gate.heading);
                // position relative to the gate: along the direction of the gate (a) and across it (b)
                var a0 = (lastGateX - gate.x) * dx + (lastGateZ - gate.z) * dz;
                var a1 = (v.x - gate.x) * dx + (v.z - gate.z) * dz;
                if(a0 < 0 && a1 >= 0) {
                    var t = a0 / (a0 - a1);
                    var px = lastGateX + (v.x - lastGateX) * t - gate.x, pz = lastGateZ + (v.z - lastGateZ) * t - gate.z;
                    var b = -px * dz + pz * dx;
                    if(Math.abs(b) <= (gate.width || 30) / 2) crossed = g;
                }
            }
        }
        lastGateX = v.x;
        lastGateZ = v.z;
        return crossed;
    }

    this.lapStarted = false; // the finish line was passed once: the laps are timed from there
    this.updateLaps = function(showDebug) {
        if(trackCheckPoints.length === 0) return;
        var name;
        if(trackGates.length) {
            var crossed = checkGates(this.vehicle);
            if(crossed === null) return;
            name = "g" + crossed;
        } else {
            if(lastTerrain === this.currentCheckPoint) return;
            this.currentCheckPoint = lastTerrain;
            name = lastTerrain;
        }
        if(name === trackCheckPoints[0]) {
            // the finish line; a lap of less than twenty seconds is no lap (back and forth over the line)
            if(this.lapStarted && this.clock - this.lapStartTime < 20) return;
            this.checkPointsCompleted[0] = true;
            var checkpointsPassed = this.lapStarted;
            for(var i = 1; i < this.checkPointsCompleted.length; i++) {
                if(checkpointsPassed) checkpointsPassed = this.checkPointsCompleted[i];
                this.checkPointsCompleted[i] = false;
            }
            if(checkpointsPassed) {
                // we passed all checkpoints
                var lapTime = this.clock - this.lapStartTime;
                this.lapTimes.push(lapTime);
                this.laps.push(Hud.formatTime(lapTime));
                this.newRecord = !!(this.ghost && this.ghost.lapDone(lapTime));
                console.log("lap time: " + this.laps[this.laps.length - 1]);
                this.lapsCompleted++;
            }
            this.lapStarted = true;
            this.lapStartTime = this.clock;
            if(this.ghost) this.ghost.startLap();
        } else {
            for(var k = 1; k < this.checkPointsCompleted.length; k++) {
                if(name === trackCheckPoints[k]) {
                    this.checkPointsCompleted[k] = true;
                    break;
                }
            }
        }
    };

    // The car is only simulated once everything it needs has loaded.
    this.isReady = function() {
        return !this.loadError && this.bodyLoaded && this.wheelsLoaded && this.wheels.length === 4;
    };

    // ---- input

    var heldAccelerate = false;
    var heldBrake = false;
    var heldReverse = false;

    // Reads the keys and buttons that are held (the inputs are set in the settings menu, see Settings.js)
    this.pollInput = function() {
        this.accelerate = Settings.isDown("throttle");
        this.brake = Settings.isDown("brake");
        this.turnLeft = Settings.isDown("steerLeft");
        this.turnRight = Settings.isDown("steerRight");
        this.handbrake = Settings.isDown("handbrake");
        this.cameraLeft = Settings.isDown("cameraLeft");
        this.cameraRight = Settings.isDown("cameraRight");
        // letting go of the key lets go of the pedal at once
        if(heldAccelerate && !this.accelerate) this.throttle = 0;
        if(heldBrake && !this.brake) this.brakePedal = 0;
        heldAccelerate = this.accelerate;
        heldBrake = this.brake;
        var reverseKey = Settings.isDown("reverse");
        if(this.gearboxMode === "automatic") {
            // while the key is held it is the R of the selector
            this.reverse = reverseKey || this.selector === "R";
            this.neutral = (this.selector === "N" || this.selector === "P") && !reverseKey;
            this.parkingLock = this.selector === "P" && !reverseKey;
        } else if(reverseKey !== heldReverse) {
            // reverse is also set by the shifter of a wheel, so only a change of the key counts
            this.reverse = reverseKey;
            if(reverseKey) this.neutral = false;
        }
        heldReverse = reverseKey;
    };

    // ---- the gearbox
    //
    // Three modes (the gearbox key and the settings menu change them):
    //   automatic:  the selector P, R, N, D; the gears and the clutch are automatic. The shift buttons move the selector.
    //   sequential: the gears are 1, 2, ... with N and R below 1; the shift buttons (paddles) change the gear. The clutch is automatic.
    //   manual:     the H-pattern shifter selects the gear and the clutch pedal is used; the paddles still shift, with the
    //               automatic clutch. What was used last decides the clutch: after the paddles (or a key) the automatic clutch,
    //               after the shifter or the clutch pedal the clutch pedal.
    this.gearboxMode = "automatic";
    this.selector = "D";             // automatic: P, R, N or D
    this.clutchAvailable = false;    // a clutch pedal is connected (set by WheelControls)
    this.manualClutch = false;       // the clutch pedal was the last way of working the clutch
    this.parkingLock = false;        // automatic: P, the wheels are locked

    this.setGearboxMode = function(mode) {
        var was = this.gearboxMode;
        this.gearboxMode = mode;
        this.manualGearbox = mode !== "automatic";
        if(mode === "automatic" && was !== "automatic") {
            this.selector = this.reverse ? "R" : (this.neutral ? "N" : "D");
        } else if(mode !== "automatic" && was === "automatic") {
            // the selector becomes a gear that the driver can shift from
            this.neutral = this.selector === "N" || this.selector === "P";
            this.reverse = this.selector === "R";
            this.parkingLock = false;
        }
        this.manualClutch = false;
    };

    // The shift buttons: the selector in automatic, the gears in sequential and manual. A button is the automatic
    // clutch in the manual mode.
    this.shiftUp = function() {
        this.manualClutch = false;
        var standing = Math.abs(this.vehicle.u) < 1.5;
        if(this.gearboxMode === "automatic") {
            var order = ["P", "R", "N", "D"];
            var next = order[Math.min(3, order.indexOf(this.selector) + 1)];
            if(next === "R" && !standing) return;
            this.selector = next;
            return;
        }
        if(this.reverse) {
            this.reverse = false;
            this.neutral = true;
        } else if(this.neutral) {
            this.neutral = false;
            this.current_gear = 0;
        } else if(this.current_gear < this.gear_ratios.length - 1) {
            this.current_gear++;
        }
    };

    this.shiftDown = function() {
        this.manualClutch = false;
        var standing = Math.abs(this.vehicle.u) < 1.5;
        if(this.gearboxMode === "automatic") {
            var order = ["P", "R", "N", "D"];
            var previous = order[Math.max(0, order.indexOf(this.selector) - 1)];
            if((previous === "R" || previous === "P") && !standing) return;
            this.selector = previous;
            return;
        }
        if(this.reverse) {
            return;
        } else if(this.neutral) {
            if(standing) {
                this.neutral = false;
                this.reverse = true;
            }
        } else if(this.current_gear > 0) {
            this.current_gear--;
        } else {
            this.neutral = true;
        }
    };

    // The H-pattern shifter: gear is the gear it is in (0 is first gear), -1 for neutral; or reverse. Only in the manual mode.
    this.hShifter = function(gear, reverse) {
        if(this.gearboxMode !== "manual") return;
        if(reverse !== this.reverse || (gear >= 0 && gear !== this.current_gear) || (gear < 0 && !reverse && !this.neutral)) {
            this.manualClutch = true; // the clutch pedal goes with the shifter
        }
        this.reverse = reverse;
        this.neutral = !reverse && gear < 0;
        if(gear >= 0 && !reverse) this.current_gear = gear;
    };

    // The gear as it is shown: P R N D (and the gear of the automatic) in automatic, 1, 2, ... N R otherwise
    this.gearLabel = function() {
        if(this.gearboxMode === "automatic") {
            if(this.selector === "D" && !this.reverse) return "D" + (this.current_gear + 1);
            return this.reverse ? "R" : this.selector;
        }
        return this.reverse ? "R" : (this.neutral ? "N" : String(this.current_gear + 1));
    };

    // The options of the settings menu
    var applyOption = function(name, value) {
        if(name === "tc") tobj.vehicle.tcEnabled = value;
        else if(name === "abs") tobj.vehicle.absEnabled = value;
        else if(name === "esc") tobj.vehicle.escEnabled = value;
        else if(name === "gearbox") tobj.setGearboxMode(value);
        else if(name === "camera") tobj.setCameraMode(value);
    };
    applyOption("tc", Settings.option("tc"));
    applyOption("abs", Settings.option("abs"));
    applyOption("esc", Settings.option("esc"));
    applyOption("camera", Settings.option("camera"));
    applyOption("gearbox", Settings.option("gearbox"));
    Settings.onOptionChange(applyOption);

};