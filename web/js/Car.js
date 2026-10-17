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
    this.lapStartTime = 0;    // the time (of the clock below) that the lap that is going started
    this.laps = [];
    this.lapTimes = [];       // the times of the laps that are done, in seconds
    this.clock = 0;           // the time that the car has been driven (not while the game is paused), in seconds
    this.checkPointsCompleted = trackCheckPoints.map(function() { return false; });
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
        engine: config.engine,
        brake_front: config.brakes && config.brakes.front,
        brake_rear: config.brakes && config.brakes.rear,
        getSurface: getSurface
    }, this);
    this.vehicle.collision = collisionWorld;
    this.engine = this.vehicle.engine;
    this.wheels = this.vehicle.wheels;
    var placed = false; // set once the car has been put on the road

    // The model: the body (it pitches and rolls) and the four wheels, see CarLoader.js
    OpenRacer.loadCarModel(config, function(model) {
        tobj.bodyLift = model.bodyLift;
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

    // ---- ground

    // Samples the road under the wheels and gives it to the physics. The first time it also puts the car on the road.
    this.sampleGround = function() {
        var v = this.vehicle;
        var cosP = Math.cos(v.psi);
        var sinP = Math.sin(v.psi);
        var heights = [];
        var surfaces = [];
        for(var i = 0; i < 4; i++) {
            var w = this.wheels[i];
            var x = v.x + cosP * w.a - sinP * w.b;
            var z = v.z + sinP * w.a + cosP * w.b;
            var ground = getGroundAt(x, z, w.groundY);
            if(ground) {
                heights.push(ground.y);
                surfaces.push(ground.surface);
                w.onGround = true;
                if(i === 2) lastTerrain = ground.mesh;
            } else {
                // off the map: stay at the last known height
                heights.push(w.groundY);
                surfaces.push(w.surface);
                w.onGround = false;
            }
        }
        v.setGround(heights, surfaces);
    };

    // Puts the car on the road at a position, standing still
    this.place = function(x, z, heading) {
        var v = this.vehicle;
        // the road meshes only have their world matrices after a render; the ground queries need them now
        scene.updateMatrixWorld(true);
        for(var i = 0; i < 4; i++) this.wheels[i].groundY = 5;
        v.reset(x, z, heading);
        this.sampleGround();
        this.sampleGround(); // the second time with the road height as the starting point of the search
        this.throttle = 0;
        this.brakePedal = 0;
        this.turnAngle = 0;
        this.current_gear = 0;
        this.updateVisuals(0);
    };

    // ---- display: the 3D objects follow the physics

    var qYaw = new THREE.Quaternion();
    var qPitch = new THREE.Quaternion();
    var qRoll = new THREE.Quaternion();
    var axisX = new THREE.Vector3(1, 0, 0);
    var axisY = new THREE.Vector3(0, 1, 0);
    var axisZ = new THREE.Vector3(0, 0, 1);

    this.updateVisuals = function(delta) {
        var v = this.vehicle;
        var w = this.wheels;
        this.carAngle = v.psi;
        var cosP = Math.cos(v.psi);
        var sinP = Math.sin(v.psi);

        // slope of the road under the car, from the heights under the wheels
        var front = (w[0].groundY + w[1].groundY) / 2;
        var rear = (w[2].groundY + w[3].groundY) / 2;
        var left = (w[1].groundY + w[2].groundY) / 2;
        var right = (w[0].groundY + w[3].groundY) / 2;
        var groundPitch = Math.atan2(front - rear, this.wheelbase);              // positive = nose up
        var groundRoll = Math.atan2(left - right, (this.front_track + this.rear_track) / 2); // positive = left side up
        var avgGround = (front + rear) / 2;
        var yaw = piOver2 - v.psi; // the model faces +z

        // the middle between the axles, which is the centre of the body model
        var offset = (v.af - v.ar) / 2;
        var cx = v.x + cosP * offset;
        var cz = v.z + sinP * offset;

        var avgCompression = (w[0].compression + w[1].compression + w[2].compression + w[3].compression) / 4;
        // the origin of the body model: see CarLoader.js
        this.body.position.set(cx, avgGround + this.bodyLift * w[0].radius - avgCompression, cz);
        this.body.rotation.set(0, yaw, 0);
        if(this.body.children[0]) {
            this.body.children[0].rotation.x = -groundPitch + v.pitchVisual;
            this.body.children[0].rotation.z = groundRoll + v.rollVisual;
        }

        // wheels sit on the road, tilted with it
        qYaw.setFromAxisAngle(axisY, yaw);
        qPitch.setFromAxisAngle(axisX, -groundPitch);
        qRoll.setFromAxisAngle(axisZ, groundRoll);
        qYaw.multiply(qPitch).multiply(qRoll);
        for(var i = 0; i < 4; i++) {
            var wheel = w[i];
            wheel.position.set(v.x + cosP * wheel.a - sinP * wheel.b, wheel.groundY + wheel.radius, v.z + sinP * wheel.a + cosP * wheel.b);
            if(wheel.object) {
                wheel.object.position.copy(wheel.position);
                wheel.object.quaternion.copy(qYaw);
                if(i < 2) wheel.turn(this.vehicle.steerApplied);
                wheel.object.children[0].children[0].rotation.x = wheel.spin;
            }
        }

        var tilt = this.body.children[0];
        this.updateCamera(delta, cx, cz, avgGround, yaw, tilt ? tilt.rotation.x : 0, tilt ? tilt.rotation.z : 0);

        shadowLight.position.x = this.body.position.x + 40;
        shadowLight.position.y = this.body.position.y + 70;
        shadowLight.position.z = this.body.position.z + 40;
    };

    // ---- the cameras: 1 is the fixed camera behind the car, 2 follows the direction of the car smoothly and
    // narrows its field of view with the speed, 3 is in the car. Their places are set per car (see CarDefaults.js).
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
        followYaw = null;
        cameraFov = null;
    };

    this.updateCamera = function(delta, cx, cz, avgGround, yaw, tiltX, tiltZ) {
        var cs = this.cameraSettings;
        var radius = this.wheels[0].radius;
        var speed = Math.abs(this.vehicle.u);

        if(this.cameraMode === 3) {
            // in the car: the camera goes with the body, with the pitch and the roll
            eulerTilt.set(tiltX, 0, tiltZ, "XYZ");
            qBody.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            qBody.multiply(new THREE.Quaternion().setFromEuler(eulerTilt));
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
            camera.position.set(cx, avgGround + radius, cz);
            camera.rotation.set(0, followYaw + Math.PI + this.cameraAngle, 0);
            camera.translateZ(f.distance);
            camera.position.y = avgGround + f.height;
            camera.lookAt(cx, avgGround + f.look_height, cz);
            // the faster, the smaller the field of view
            var target = f.fov_standing + (f.fov_fast - f.fov_standing) * Math.min(1, speed / f.fov_full_speed);
            cameraFov = cameraFov === null ? target : cameraFov + (target - cameraFov) * (1 - Math.exp(-4 * Math.min(delta, 0.1)));
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
        this.engineRPM = this.engine.getRPM();
        EngineSound.update(this.engineRPM, this.throttle);

        this.sampleGround();
        this.updateVisuals(delta);

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

    this.updateLaps = function(showDebug) {
        if(trackCheckPoints.length === 0) return;
        if(lastTerrain !== this.currentCheckPoint) {
            this.currentCheckPoint = lastTerrain;
            if(lastTerrain === trackCheckPoints[0]) {
                this.checkPointsCompleted[0] = true;
                var checkpointsPassed = true;
                for(var i = 1; i < this.checkPointsCompleted.length; i++) {
                    if(checkpointsPassed) checkpointsPassed = this.checkPointsCompleted[i];
                    this.checkPointsCompleted[i] = false;
                }
                if(checkpointsPassed) {
                    // we passed all checkpoints
                    if(this.lapStartTime !== undefined) {
                        var lapTime = this.clock - this.lapStartTime;
                        this.lapTimes.push(lapTime);
                        this.laps.push(Hud.formatTime(lapTime));
                        console.log("lap time: " + this.laps[this.laps.length - 1]);
                    }
                    this.lapsCompleted++;
                }
                this.lapStartTime = this.clock;
            } else {
                for(var i = 1; i < this.checkPointsCompleted.length; i++) {
                    if(lastTerrain === trackCheckPoints[i]) {
                        this.checkPointsCompleted[i] = true;
                        break;
                    }
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