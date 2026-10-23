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
    var wasHeld = false;
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
    this.autoReverse = false;        // automatic: the car is in reverse because the brake key was held at a standstill
    this.autoReversePedals = false;  // the same with analog pedals (a wheel, a pad, the touch pedals): the pedals are swapped for the physics
    this.keyPedals = false;
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
        downforce_front: chassis.downforce_front,
        downforce_rear: chassis.downforce_rear,
        ackermann: chassis.ackermann,
        suspension_travel: chassis.suspension_travel, unsprung_mass: chassis.unsprung_mass, tyre_rate: chassis.tyre_rate, tyre_damping: chassis.tyre_damping, suspension_length: chassis.suspension_length, spring_progression: chassis.spring_progression, damping_rebound: chassis.damping_rebound,
        compound: config.tyres && config.tyres.compound,
        pressure_front: config.tyres && config.tyres.pressure_front, pressure_rear: config.tyres && config.tyres.pressure_rear,
        toe_front: chassis.toe_front, toe_rear: chassis.toe_rear,
        ride_front: chassis.ride_front,
        ride_rear: chassis.ride_rear,
        roll_center_front: chassis.roll_center_front,
        roll_center_rear: chassis.roll_center_rear,
        camber_front: chassis.camber_front,
        camber_rear: chassis.camber_rear,
        roll_camber: chassis.roll_camber,
        motorcycle: config.type === "motorcycle" ? (config.motorcycle || {}) : null,
        tire_diameter: this.tire_diameter,
        width: this.width,
        length: this.length,
        height: this.height,
        Cdrag: this.Cdrag,
        gear_ratios: this.gear_ratios,
        reverse_ratio: drivetrain.reverse_ratio,
        final_drive: this.final_drive,
        efficiency: drivetrain.efficiency,
        shift_time: drivetrain.shift_time,
        clutch_start_rpm: drivetrain.clutch_start_rpm, clutch_full_rpm: drivetrain.clutch_full_rpm,
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
    var flames = new OpenRacer.ExhaustFlames(scene, { length: this.length, width: this.width, exhaust: config.exhaust, exhaustSystems: (config.sound && config.sound.engine_sim && config.sound.engine_sim.exhaust_systems) || 1,
        smoke: function(x, y, z, vx, vy, vz, diameter) { tyreSmoke.spawn(x, y, z, vx, vy, vz, 0.15, false, true, true); } });
    this.engine = this.vehicle.engine;
    EngineSound.setCar(config); // the engine sound of this car
    this.wheels = this.vehicle.wheels;
    var placed = false; // set once the car has been put on the road

    // The model: the body (it pitches and rolls) and the four wheels, see CarLoader.js
    OpenRacer.loadCarModel(config, function(model) {
        tobj.bodyLift = model.bodyLift;
        tobj.steeringWheel = model.steeringWheel || null;
        tobj.rig = model.rig || null; // the moving parts of the suspension and the steering of the model, when it has them
        tobj.head = model.head || null;   // the front end of a motorcycle that stays and turns (CarLoader.js)
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
        // the collision shape of the car, from its model (CollisionProxy.js), for the 3D physics
        OpenRacer.CollisionProxy.apply(tobj, model, modelMid);
        // the driver: a model with a skeleton that holds the steering wheel and works the pedals (Driver.js), when the car has one
        var driverConfig = config.driver;
        if(driverConfig && driverConfig.enabled && driverConfig.file && OpenRacer.Driver) {
            var driver = new OpenRacer.Driver(driverConfig, model.tilt, model.steeringWheel);
            driver.load(OpenRacer.Garage ? OpenRacer.Garage.resolve(config, driverConfig.file) : driverConfig.file, OpenRacer.Garage ? OpenRacer.Garage.manager(config) : undefined,
                function() { tobj.driver = driver; },
                function(error) { console.warn("The driver model could not be loaded: " + (error && error.message ? error.message : error)); });
        }
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
        var bike = config.type === "motorcycle";          // (a wheel at each end: no track)
        if(bike) { frontTrack = Math.max(0.04, frontTrack); rearTrack = Math.max(0.04, rearTrack); }
        if(!(wheelbase > 0.6 && wheelbase < 5 && frontTrack > (bike ? 0 : 0.4) && frontTrack < 3 && rearTrack > (bike ? 0 : 0.4) && rearTrack < 3 && diameter > 0.1 && diameter < 1.5)) {
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
        flames.clear();
        if(OpenRacer.DragStrip) OpenRacer.DragStrip.reset();
        lastGateX = null; // a jump of the car is no crossing of a gate
        this.lapStarted = false;
        this.throttle = 0;
        this.brakePedal = 0;
        this.turnAngle = 0;
        this.current_gear = 0;
        this.updateVisuals(0);
    };

    // ---- the place that the reset key goes back to: the one that was saved with the save key (per track, kept in the browser), else the start
    var resetKey = "openracer.resetposition." + (currentTrack && currentTrack.id);
    var savedReset = null;
    try { var stored = JSON.parse(window.localStorage.getItem(resetKey)); if(stored && isFinite(stored.x) && isFinite(stored.z) && isFinite(stored.psi)) savedReset = stored; } catch(e) { /* no storage */ }
    this.saveResetPosition = function() {
        savedReset = this.vehicle.pose();
        try { window.localStorage.setItem(resetKey, JSON.stringify(savedReset)); } catch(e) { /* no storage */ }
        var note = document.createElement("div");
        note.style.cssText = "position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 1001; padding: 8px 18px; background: rgba(20, 24, 31, 0.85); color: #fff; font-family: Arial; border-radius: 6px;";
        note.textContent = "Reset position saved";
        document.body.appendChild(note);
        setTimeout(function() { note.remove(); }, 1600);
    };
    this.returnToSaved = function() {
        var v = this.vehicle, p = savedReset || { x: startX, z: startZ, psi: startHeading, py: null };
        v.relocate(p.x, p.z, p.psi, p.py);
        tyreSmoke.clear();
        flames.clear();
        if(OpenRacer.DragStrip) OpenRacer.DragStrip.reset();
        lastGateX = null; // a jump of the car is no crossing of a gate
        this.lapStarted = false;
        this.throttle = 0;
        this.brakePedal = 0;
        this.turnAngle = 0;
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
                wheel.turn(i < 2 ? this.vehicle.steerApplied : 0);
                wheel.object.children[0].children[0].rotation.x = wheel.spin;
                if(this.head && i === 1) OpenRacer.updateFork(this.head, wheel, this.body, this.vehicle.steerApplied);
            }
        }
        if(this.rig) this.rig.update(this.vehicle);
        if(this.softBodyMesh) this.softBodyMesh.update();
        if(this.parts) this.parts.update(delta);
        // the steering wheel of the model turns with the steering
        if(this.steeringWheel) {
            var sw = this.steeringWheel;
            var ratio = (sw.degrees * Math.PI / 180) / this.maxTurn;
            sw.object.quaternion.setFromAxisAngle(sw.axis, -v.steerApplied * ratio);
            sw.angle = -v.steerApplied * ratio;
        }
        // the driver: the hands on the steering wheel, the feet on the pedals (the head is not drawn in the cockpit view, it is in front of the camera)
        if(this.driver) {
            // (the camera of a replay that is its own, the free and the cinematic one, is outside the car whatever the camera of the game is)
            this.driver.setCockpit(this.cameraMode === 3 && !(OpenRacer.Replay && OpenRacer.Replay.active && OpenRacer.Replay.ownCamera));
            this.driver.update(delta || 0.016, this.throttle, this.brakePedal, { gear: this.current_gear, neutral: this.neutral });
        }
        // the checkpoint of the road under the rear wheel
        var rear = w[2];
        if(trackGates.length === 0 && rear.hasContact && rear.normal) lastTerrain = rear.normal.mesh;

        if(!(OpenRacer.Replay && OpenRacer.Replay.active)) {   // a replay does not make new smoke and marks from the state of the physics
            tyreSmoke.update(delta, v, camera);
            var marks = OpenRacer.skidMarks && OpenRacer.skidMarks();
            if(marks) marks.update(v); // the rubber a sliding tyre leaves on the road (SkidMarks.js)
            var pellets = OpenRacer.marbles && OpenRacer.marbles();
            if(pellets) pellets.update(v, delta); // the marbles that a soft, hot tyre sheds (Marbles.js)
        }
        // the cameras behind the car follow its height (a jump, a hill), not the road under it; the small movements of the springs are smoothed out
        // (in a replay the camera can follow another car, which is then the subject of the camera)
        var subject = this.cameraSubject || this, camX = cx, camZ = cz, camYaw = yaw, baseY = bodyPosition.y - w[0].radius;
        if(subject !== this) {
            var sv = subject.vehicle, soffset = (sv.af - sv.ar) / 2;
            camX = sv.x + Math.cos(sv.psi) * soffset; camZ = sv.z + Math.sin(sv.psi) * soffset;
            camYaw = piOver2 - sv.psi;
            baseY = subject.body.position.y - subject.wheels[0].radius;
        }
        if(subject !== lastSubject) { lastSubject = subject; cameraBaseY = null; followYaw = null; camClear = 1; }
        if(cameraBaseY === null || Math.abs(baseY - cameraBaseY) > 3) cameraBaseY = baseY;
        cameraBaseY += (baseY - cameraBaseY) * Math.min(1, delta / 0.08);
        this.updateCamera(delta, camX, camZ, cameraBaseY, camYaw, subject.body.quaternion, subject);

        shadowLight.position.copy(subject.body.position).add(sunDirection);
    };

    // ---- the cameras: (1, the fixed camera behind the car, is gone) 2 follows the direction of the car smoothly and
    // widens its field of view with the speed (and comes closer, so the car keeps its size), 3 is in the car, 4 is the free camera (FreeCam.js). Their places are set per car (see CarDefaults.js).
    this.cameraSettings = OpenRacer.cameraSettings(config);
    this.cameraMode = 2;
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
        if(mode === 1) mode = 2;      // the fixed camera is gone (a saved choice of it becomes the following camera)
        // 4 is the free camera (FreeCam.js): it goes free from where the camera is now
        if(this.cameraMode === 4 && mode !== 4) OpenRacer.FreeCam.leave();
        if(mode === 4 && this.cameraMode !== 4) OpenRacer.FreeCam.enter(camera, this.body.position);
        this.cameraMode = mode;
        EngineSound.setInside(mode === 3);
        followYaw = null;
        cameraFov = null;
    };

    // The cameras behind the car must not go through a wall (or the road of a crest): three rays from the car to the camera and to a place a bit to each
    // side of it, against all the triangles of the track (Ground.firstHit); the camera comes in front of the nearest. It comes in at once and goes out again
    // smoothly, when the way is free.
    var camClear = 1, camTarget = new THREE.Vector3(), camDir = new THREE.Vector3(), camEnd = new THREE.Vector3(), camSide = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0);
    function keepCameraInView(car, delta) {
        var ground = car.vehicle.ground;
        if(!ground || !ground.firstHit) return;
        camTarget.copy(car.body.position); camTarget.y += 0.9;
        camDir.copy(camera.position).sub(camTarget);
        var length = camDir.length();
        if(length < 0.5) return;
        camDir.divideScalar(length);
        camSide.crossVectors(camDir, camUp).normalize();
        var allowed = 1;
        for(var r = 0; r < 4; r++) {
            camEnd.copy(camera.position);
            if(r === 1) camEnd.addScaledVector(camSide, 0.45);
            else if(r === 2) camEnd.addScaledVector(camSide, -0.45);
            else if(r === 3) camEnd.y += 0.4;
            var rx = camEnd.x - camTarget.x, ry = camEnd.y - camTarget.y, rz = camEnd.z - camTarget.z, rl = Math.hypot(rx, ry, rz) || 1;
            var hit = ground.firstHit(camTarget.x, camTarget.y, camTarget.z, rx / rl, ry / rl, rz / rl, rl);
            if(hit < rl) allowed = Math.min(allowed, Math.max(0.1, (hit - 0.4) / rl));
        }
        camClear += (allowed - camClear) * (1 - Math.exp(-(allowed < camClear ? 40 : 3) * Math.min(delta, 0.1)));
        camClear = Math.min(1, Math.max(0.1, camClear));
        if(camClear < 0.999) camera.position.copy(camTarget).addScaledVector(camDir, length * camClear);
    }

    this.cameraSubject = null;      // the car that the camera follows when it is not this one (a replay: Replay.js)
    var lastSubject = null;
    this.cameraOverride = null;     // a function that places the camera itself (the fly-by over the grid, main.js); true when it did
    this.updateCamera = function(delta, cx, cz, avgGround, yaw, bodyQ, subject) {
        if(this.cameraOverride && this.cameraOverride(delta)) return;
        subject = subject || this;
        var cs = this.cameraSettings;
        var radius = subject.wheels[0].radius;
        var speed = Math.abs(subject.vehicle.u);

        if(this.cameraMode === 4) {
            OpenRacer.FreeCam.update(delta, this.body.position, camera, yaw);
            return;
        }

        if(this.cameraMode === 3) {
            // in the car: the camera goes with the body, with the pitch and the roll
            qBody.copy(bodyQ);
            var p = cs.cockpit.position;
            cockpitOffset.set(p[0], p[1], p[2]).applyQuaternion(qBody).add(subject.body.position);
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
            keepCameraInView(subject, delta);
            camera.lookAt(cx, avgGround + f.look_height, cz);
            if(this.vehicle.controller) this.vehicle.controller.cameraRoll(camera, this.vehicle, delta);      // (a motorcycle: the picture leans with the bike)
            setLens(cameraFov, 1);
            return;
        }
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
        gamepadUpdate(delta);
        // on the grid before the start of a race: the brakes are on, the engine can be revved
        if(this.held) { this.brakePedal = 1; this.handbrake = true; this.accelerate = false; this.throttle = Math.min(this.throttle, 0.6); }
        else if(wasHeld) { this.brakePedal = 0; this.handbrake = false; this.brake = false; }   // GO: the brake of the grid is let go
        wasHeld = this.held;
        // the clutch pedal works the clutch in the manual mode, once it is used or the shifter was moved
        if(this.clutchAvailable && this.gearboxMode === "manual" && this.clutch > 0.08) this.manualClutch = true;
        this.clutchPedalPresent = this.clutchAvailable && this.gearboxMode === "manual" && this.manualClutch;
        var v = this.vehicle;

        if(this.reset) {
            // one reset per key press: back to the saved place (the start when none was saved), in the state that the car is in
            this.reset = false;
            this.returnToSaved();
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
        // the keys bring the pedals up over a time and along a curve (settings menu, Keyboard: the easing of the throttle and of the brake); letting go is at once
        var easeThrottle = Settings.option("keyThrottleCurve"), timeThrottle = Settings.option("keyThrottleTime") || 0.5;
        var easeBrake = Settings.option("keyBrakeCurve"), timeBrake = Settings.option("keyBrakeTime") || 0.4;
        if(this.accelerate) {
            this.thrHeld = (this.thrHeld || 0) + delta;
            this.throttle = Math.pow(Math.min(1, this.thrHeld / timeThrottle), easeThrottle || 1);
        } else this.thrHeld = 0;
        if(this.held) this.throttle = Math.min(this.throttle, 0.6);
        if(this.throttle > 1) this.throttle = 1;
        if(this.brake) {
            this.brkHeld = (this.brkHeld || 0) + delta;
            this.brakePedal = Math.pow(Math.min(1, this.brkHeld / timeBrake), easeBrake || 1);
        } else this.brkHeld = 0;
        if(delta > 0.1) {
            if(showDebug) { debugOut("DELTA WARN - " + delta); }
            delta = 0.1;
        }
        this.clock += delta;

        // the steering assist of the keyboard: what it added last frame comes off first (the keys move the angle they made); when something else wrote the
        // angle since (a wheel, a pad, the mouse), the assist is not ours to take off and it waits for the keys again
        var assistWas = this.assistOffset || 0;
        if(this.lastWritten !== undefined && this.turnAngle !== this.lastWritten) assistWas = 0; else this.turnAngle -= assistWas;
        var foreign = this.lastWritten !== undefined && assistWas === 0 && this.turnAngle !== this.lastWritten;
        // the keys work on the angle without the curve (keyRaw); what the car gets is that angle along the curve of the settings (Keyboard: the easing of the steering)
        var keyboardSteering = !mouseDown && !usingGamepad && !foreign;
        if(keyboardSteering && this.keyRaw !== undefined) this.turnAngle = this.keyRaw; else this.keyRaw = this.turnAngle;

        // steering with the keyboard: slower at speed, and the wheels centre themselves
        this.turnDir = 0;
        if(this.turnLeft) this.turnDir = -1;
        if(this.turnRight) this.turnDir = 1;
        if(this.turnLeft && this.turnRight) this.turnDir = 0;
        var tSpeed = this.turnLimit / (Settings.option("keySteerTime") || 0.9);      // the steering speed of the keyboard: the lock in the time of the settings menu (at a standstill)
        var slow = Settings.option("keySlow");           // how much slower the keys steer at speed (settings menu, Keyboard): 1 as it was, 0 not at all
        if(slow === undefined || slow === null) slow = 1;
        if(v.controller) slow = 0;                       // (a motorcycle: the keys ask for a lean, and that is the same at every speed)
        var speedFactor = 1 + Math.max(0, Math.abs(v.u) / 4 - 1) * slow;
        if(this.turnDir === 0) {
            if(!mouseDown && !usingGamepad)
                this.turnAngle *= Math.pow(0.75, delta * 60);
        } else if(this.turnDir < 0 && this.turnAngle > 0) {
            this.turnAngle += this.turnDir * ((tSpeed * 3) / speedFactor) * delta;
        } else if(this.turnDir > 0 && this.turnAngle < 0) {
            this.turnAngle += this.turnDir * ((tSpeed * 3) / speedFactor) * delta;
        } else {
            this.turnAngle += this.turnDir * (tSpeed / speedFactor) * delta;
            // the lock of the keyboard gets smaller with the speed (about half at 80 km/h, a fifth from 150 km/h): a key that is held at speed
            // took the wheels to full lock, and the car snapped round; a wheel, a pad and the mouse have their own range
            var lock = this.turnLimit * Math.max(0.2, 1 / (1 + Math.pow(Math.abs(v.u) / 22, 2) * slow));
            if(Math.abs(this.turnAngle) > lock) {
                this.turnAngle = this.turnDir * lock;
            }
        }

        var steerCurve = Settings.option("keySteerCurve") || 1;
        if(keyboardSteering) {
            this.keyRaw = this.turnAngle;
            if(steerCurve !== 1) {
                var lockNow = this.turnLimit * Math.max(0.2, 1 / (1 + Math.pow(Math.abs(v.u) / 22, 2) * slow));
                this.turnAngle = Math.sign(this.turnAngle) * lockNow * Math.pow(Math.min(1, Math.abs(this.turnAngle) / lockNow), steerCurve);
            }
        } else this.keyRaw = this.turnAngle;

        // The assist: when the rear steps out, the front wheels are turned into the slide (as the pad does, controls.js), on top of what the keys
        // made, and it fades with the slide. Only while the keyboard steers (not mouse, pad or a wheel that has the angle).
        var assist = 0;
        if(Settings.option("keyAssist") && !v.controller && !mouseDown && !usingGamepad && !foreign && v.u > 3) {     // (a motorcycle has its rider: the front wheel is not turned into a slide by itself)
            var beta = Math.atan2(v.v, v.u);                 // the slip angle of the car: positive when it moves to the right of where it points
            var counter = Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.035) * 1.1;
            assist = Math.max(-0.6 * this.maxTurn, Math.min(0.6 * this.maxTurn, counter));
        }
        this.assistOffset = assistWas + (assist - assistWas) * Math.min(1, delta * 12);
        this.turnAngle += this.assistOffset;
        this.turnAngle = Math.max(-this.maxTurn, Math.min(this.maxTurn, this.turnAngle));
        this.lastWritten = this.turnAngle;

        // The same reverse for analog pedals (a wheel, the triggers of a pad, the touch pedals): the brake pedal held at a standstill is the gas of the reverse,
        // the gas pedal is the brake; for the physics the two values are swapped, and put back after it
        var swapPedals = false;
        if(usingGamepad && !this.keyPedals && !this.autoReverse && this.gearboxMode === "automatic" && this.selector === "D" && !this.parkingLock && Settings.option("autoReversePedals") &&
           !this.vehicle.launchControlEnabled && !(OpenRacer.DragStrip && OpenRacer.DragStrip.holding)) {
            var padUp = this.throttle > 0.1, padDown = this.brakePedal > 0.1, padAlong = v.u, padLimit = Math.max(0.3, Settings.option("autoReverseSpeed") / 3.6);
            if(!this.autoReversePedals) {
                if(padDown && !padUp && padAlong < padLimit) this.autoReversePedals = true;
            } else if(padUp && !padDown && padAlong > -padLimit) this.autoReversePedals = false;
            else if(!padUp && !padDown && padAlong > -0.3) this.autoReversePedals = false;
        } else {
            this.autoReversePedals = false;
        }
        if(this.autoReversePedals) {
            this.reverse = true;
            var swapped = this.throttle; this.throttle = this.brakePedal; this.brakePedal = swapped;
            swapPedals = true;
        }

        v.update(delta);
        this.pit.update(delta);
        this.engineRPM = this.engine.getRPM();
        // the rev limiter cuts the fuel: the engine sounds like it too
        EngineSound.update(this.engineRPM, this.throttle * this.engine.throttleCut, this.engine.throttleCut > 0.5);
        if(swapPedals) { var back = this.throttle; this.throttle = this.brakePedal; this.brakePedal = back; }
        EngineSound.setTyres(v.squeal, Math.abs(v.u));
        // the road under the tyres (the surface of the wheels that touch it), and a landing or a hit on the bump stop
        var under = "road";
        for(var gi = 0; gi < 4; gi++) if(this.wheels[gi].hasContact && this.wheels[gi].surface !== "road" && this.wheels[gi].surface !== "track01") under = this.wheels[gi].surface;
        EngineSound.setGround(under, Math.abs(v.u));
        if(v.soundImpact > 0.12) EngineSound.impact(v.soundImpact);
        // the bangs of the exhaust (pops, anti-lag): the sound, and the flames
        var bangs = this.engine.events;
        for(var bi = 0; bi < bangs.length; bi++) { EngineSound.pop(bangs[bi].strength, bangs[bi].loud); flames.emit(v, bangs[bi], this.body); }
        bangs.length = 0;
        flames.update(delta, camera);

        this.updateVisuals(delta);
        if(typeof ForceFeedback !== "undefined") ForceFeedback.update(this, delta);

        Hud.update(this);

        if(showDebug) {
            var metric = Settings.option("units") !== "imperial";
            // the surface of the tread of every tyre: grip below 180, gum from 180 (marbles from 150), smoke from 220, with the road under it
            var phaseOf = function(t) { return t >= 220 ? "smoke" : (t >= 180 ? "gum" : (t >= 150 ? "marbles" : "grip")); };
            if(v.tyreDamage) debugOut("Tyre pressure (bar): " + ["FR", "FL", "RL", "RR"].map(function(n, i) { var wh = v.wheels[i]; return n + " " + ((wh.front ? v.pressureFront : v.pressureRear) - (wh.pressureLoss || 0)).toFixed(2) + (wh.leak ? " LEAK" : ""); }).join(" | "));
            debugOut("Tread surface: " + ["FR", "FL", "RL", "RR"].map(function(n, i) { var wh = v.wheels[i]; return n + " " + Math.round(wh.surfT) + "° " + phaseOf(wh.surfT) + " (road " + Math.round(wh.roadT) + "°)"; }).join(" | "));
            debugOut(Math.round(v.u * (metric ? 3.6 : 2.2369362920544)) + (metric ? " km/h" : " mph") + " | Gear: " + this.gearLabel() + " (" + this.gearboxMode +
                (this.clutchPedalPresent ? ", clutch pedal" : "") + ") | RPM: " + Math.round(this.engineRPM) +
                (this.engine.running ? "" : " (STALLED: " + (this.clutchPedalPresent ? "clutch + throttle or I to start" : "starting") + ")") +
                " | Throttle: " + this.throttle.toFixed(2) + " | Brake: " + this.brakePedal.toFixed(2) +
                " | Clutch: " + v.clutchEngagement.toFixed(2) + " | TC: " + (v.tcEnabled ? "on" : "off") + " | ESC: " + (v.escEnabled ? "on" : "off") + " | ABS: " + (v.absEnabled ? "on" : "off"));
        }

        this.updateLaps(showDebug);
        if(OpenRacer.DragStrip) OpenRacer.DragStrip.update(this, this.clock);

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
        if(trackGates.length && window.OpenRacer && OpenRacer.GateMarkers) OpenRacer.GateMarkers.passed(this, crossed);
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
        // The automatic gearbox in D: holding the brake key at a standstill (or below a speed) puts the car in reverse while the key is held, as in
        // most games. In reverse the brake key is the gas and the gas key brakes; the gas key at a standstill is D again.
        var rawUp = this.accelerate, rawDown = this.brake;
        this.keyPedals = rawUp || rawDown;
        if(this.gearboxMode === "automatic" && this.selector === "D" && !this.parkingLock && Settings.option("autoReverse") &&
           !this.vehicle.launchControlEnabled && !(OpenRacer.DragStrip && OpenRacer.DragStrip.holding)) {
            var along = this.vehicle.u, limit = Math.max(0.3, Settings.option("autoReverseSpeed") / 3.6);
            if(!this.autoReverse) {
                if(rawDown && !rawUp && along < limit) this.autoReverse = true;
            } else if(rawUp && !rawDown && along > -limit) this.autoReverse = false;
            else if(!rawUp && !rawDown && along > -0.3) this.autoReverse = false;
        } else {
            this.autoReverse = false;
        }
        if(this.autoReverse) { this.accelerate = rawDown; this.brake = rawUp; }
        this.turnLeft = Settings.isDown("steerLeft");
        this.turnRight = Settings.isDown("steerRight");
        this.handbrake = Settings.isDown("handbrake");
        this.twoStep = Settings.isDown("twoStep");
        this.transbrake = Settings.isDown("transbrake");
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
            this.reverse = reverseKey || this.selector === "R" || this.autoReverse;
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
        else if(name === "launchControl") tobj.vehicle.launchControlEnabled = value;
        else if(name === "twoStep") tobj.vehicle.twoStepEnabled = value;
        else if(name === "abs") tobj.vehicle.absEnabled = value;
        else if(name === "esc") tobj.vehicle.escEnabled = value;
        else if(name === "gearbox") tobj.setGearboxMode(value);
        else if(name === "camera") tobj.setCameraMode(value);
    };
    applyOption("tc", Settings.option("tc"));
    applyOption("launchControl", Settings.option("launchControl"));
    applyOption("twoStep", Settings.option("twoStep"));
    applyOption("abs", Settings.option("abs"));
    applyOption("esc", Settings.option("esc"));
    applyOption("camera", Settings.option("camera"));
    applyOption("gearbox", Settings.option("gearbox"));
    Settings.onOptionChange(applyOption);

};