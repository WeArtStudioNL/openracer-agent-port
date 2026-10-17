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

OpenRacer.Car = function( parameters, domElement ) {
    this.bodyMeshFile = parameters.body;
    this.wheelMeshFile = parameters.wheel;
    this.wheels = [];
    this.wheelsLoaded = false; // set once the wheel model has loaded and all four wheels exist
    this.bodyLoaded = false;   // set once the body model has loaded
    this.loadError = null;     // description of a failed model load, if any
    this.wheelbase = parameters.wheelbase;
    this.front_track = parameters.front_track;
    this.rear_track = parameters.rear_track;
    this.weight_distribution = parameters.weight_distribution;
    this.tire_diameter = parameters.tire_diameter;
    this.body = new THREE.Object3D();
    this.mass = parameters.mass;
    this.throttle = 0;
    this.brakePedal = 0;
    this.width = parameters.width;
    this.height = parameters.height;
    this.length = parameters.length;
    this.frontal_area = this.width * this.height * 0.85;
    this.Cd = 0.4;
    this.Cdrag = 0.5 * this.Cd * this.frontal_area * air_density;
    this.reset = false;
    this.cameraAngle = 0;
    
    this.lapsCompleted = 0;
    this.lapStartTime;
    this.laps = [];
    this.checkPointsCompleted = [false, false, false, false, false, false, false, false, false, false];
    this.currentCheckPoint = "";
    
    // Where the car starts (and returns to with the R key), heading along +x
    var startX = -130.38620930679173;
    var startZ = 1.5269260973467418;
    var startHeading = 0;

    //this.gear_ratios = [ 2.99, 1.75, 1 ]; // Standard Mach 1 351 transmission, code RAT-AM (3.03)
    //this.gear_ratios = [ 2.78, 1.93, 1.36, 1 ]; // Toploader four speed, wide-ratio 351 RUG-E3
    this.gear_ratios = [ 2.32, 1.69, 1.29, 1 ]; // Toploader close-ratio, 351 RUG-AG
    this.final_drive = 3.5; // 3.25, 3.5 or 4.3
    this.current_gear = 0;
    this.manualGearbox = false;     // true while a wheel with a shifter selects the gear
    this.neutral = false;           // no drive while in neutral
    this.clutch = 0;                // clutch pedal: 0 = engaged, 1 = fully pressed
    this.clutchPedalPresent = false; // a real clutch pedal is available; otherwise the clutch is automatic
    this.handbrake = false;
    this.engineRPM = 900;           // engine speed, for the dashboard and the engine sound

    this.accelerate = false;
    this.brake = false;
    this.reverse = false;
    this.turnLeft = false;
    this.turnRight = false;
    this.turnDir = 0;
    this.maxTurn = Math.PI / 6;
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
        tire_diameter: this.tire_diameter,
        width: this.width,
        length: this.length,
        Cdrag: this.Cdrag,
        gear_ratios: this.gear_ratios,
        final_drive: this.final_drive,
        getSurface: getSurface
    }, this);
    this.engine = this.vehicle.engine;
    this.wheels = this.vehicle.wheels;
    this.vehicle.tcEnabled = true;
    this.vehicle.absEnabled = true;
    var placed = false; // set once the car has been put on the road

    function bodyLoaded(geometry) {
        // one material for every part of the body model, in the order of the model
        var material = [
            mlib["Black metal"], /* windows */
            new THREE.MeshLambertMaterial ( { color: 0x000000 } ), /* front grille */
            mlib["Black metal"], /* rear lights */
            mlib["Chrome"], /* bumpers */
            mlib.body["Orange"], /* car body */
            mlib["Chrome"], /* chrome trim */
            new THREE.MeshBasicMaterial ( { color: 0x0000ff } )
        ];

        var mesh = new THREE.Mesh( geometry, material );
        mesh.scale.set(0.5, 0.5, 0.5);
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        tobj.body.add(mesh);
        //carBody.position.x = -36.77731522287426;
        //carBody.position.y = -14.842332522928999;
        //carBody.position.z = 430.97136850461845;

        scene.add(tobj.body);

        shadowLight.target = tobj.body;
        tobj.bodyLoaded = true;
    }
    
    function wheelLoaded(geometry) {
        var material = [
            new THREE.MeshPhongMaterial ( { color: 0x878787 } ), /* brakes */
            mlib["Chrome"], /* alloys */
            new THREE.MeshBasicMaterial ( { color: 0x000000 } ) /* tyre */
        ];
        var mesh = new THREE.Mesh( geometry, material );
        mesh.castShadow = true;
        mesh.scale.set(0.5, 0.5, 0.5);

        // Every wheel is a chain of objects: the wheel (position and orientation), the steering
        // (children[0], turns around the vertical axis) and the spin (children[0].children[0]).
        for(var i = 0; i < tobj.wheels.length; i++) {
            var wheel = tobj.wheels[i];
            var spin = new THREE.Object3D();
            spin.add(mesh.clone());
            // the wheel model has to face outwards on both sides of the car
            if(!wheel.right) spin.rotation.z = Math.PI;
            var steer = new THREE.Object3D();
            steer.add(spin);
            var object = new THREE.Object3D();
            object.add(steer);
            wheel.object = object;
            scene.add(object);
        }
        tobj.wheelsLoaded = true;
    }

    // Loads a model and reports failures explicitly (the old JSON models have no loader any more).
    function loadModel(url, onLoad) {
        var request = new XMLHttpRequest();
        request.onreadystatechange = function() {
            if(request.readyState !== 4) return;
            if(request.status !== 200 && request.status !== 0) {
                modelFailed(url, "HTTP " + request.status);
                return;
            }
            try {
                onLoad(parseLegacyModel(JSON.parse(request.responseText)));
            } catch(e) {
                modelFailed(url, e);
            }
        };
        request.open("GET", url, true);
        request.send();
    }

    function modelFailed(url, reason) {
        tobj.loadError = "Could not load " + url + " (" + reason + ")";
        console.error(tobj.loadError);
        var banner = document.createElement("div");
        banner.style.cssText = "position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 1001; " +
            "padding: 10px 20px; background: rgba(160, 0, 0, 0.85); color: #ffffff; font-family: Arial;";
        banner.textContent = tobj.loadError;
        document.body.appendChild(banner);
    }

    // The car is only simulated once everything it needs has loaded.
    this.isReady = function() {
        return !this.loadError && this.bodyLoaded && this.wheelsLoaded && this.wheels.length === 4;
    };

    loadModel("models/mustang_wheel.json", wheelLoaded);
    loadModel("models/mustang.json", bodyLoaded);

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
        // the origin of the body model is one wheel radius above the axles
        this.body.position.set(cx, avgGround + 2 * w[0].radius - avgCompression, cz);
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
                if(i < 2) wheel.turn(this.turnAngle);
                wheel.object.children[0].children[0].rotation.x = wheel.spin;
            }
        }

        // chase camera
        camera.position.set(cx, avgGround + w[0].radius, cz);
        camera.rotation.set(0, yaw + Math.PI + this.cameraAngle, 0);
        camera.translateZ(10);
        camera.translateY(2);

        shadowLight.position.x = this.body.position.x + 40;
        shadowLight.position.y = this.body.position.y + 70;
        shadowLight.position.z = this.body.position.z + 40;
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
        gamepadUpdate();
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

        // dashboard lights: traction control and ABS while they are working
        var tcOn = false;
        var absOn = false;
        for(var i = 0; i < this.wheels.length; i++) {
            if(this.wheels[i].tc) tcOn = true;
            if(this.wheels[i].abs) absOn = true;
        }
        dash_tc.className = tcOn ? "dash-tc-on" : "dash-tc-off";
        dash_abs.className = absOn ? "dash-abs-on" : "dash-abs-off";

        if(showDebug) {
            var gear = this.reverse ? "R" : (this.neutral ? "N" : this.current_gear + 1);
            debugOut(Math.round(v.u * 2.2369362920544) + " mph | Gear: " + gear + " | RPM: " + Math.round(this.engineRPM) +
                (this.engine.running ? "" : " (STALLED: " + (this.clutchPedalPresent ? "clutch + throttle or I to start" : "starting") + ")") +
                " | Throttle: " + this.throttle.toFixed(2) + " | Brake: " + this.brakePedal.toFixed(2) +
                " | Clutch: " + v.clutchEngagement.toFixed(2) + " | TC [C]: " + (v.tcEnabled ? "on" : "off") + " | ABS [B]: " + (v.absEnabled ? "on" : "off"));
        }

        this.updateLaps(showDebug);

        if(telemetry) {
            telemetry.update();
        }
    };

    this.updateLaps = function(showDebug) {
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
                    if(this.lapStartTime > 0) {
                        var elapsedTime = Date.now() - this.lapStartTime;
                        var min = (elapsedTime / 1000 / 60) << 0;
                        var sec = (elapsedTime / 1000) % 60;
                        var milli = elapsedTime % 1000;
                        this.laps.push(min + ":" + sec + "." + milli.toFixed(3));
                        console.log("lap time: " + this.laps[this.laps.length - 1]);
                    }
                    this.lapsCompleted++;
                }
                this.lapStartTime = Date.now();
            } else {
                for(var i = 1; i < this.checkPointsCompleted.length; i++) {
                    if(lastTerrain === trackCheckPoints[i]) {
                        this.checkPointsCompleted[i] = true;
                        break;
                    }
                }
            }
        }
        if(showDebug) { debugOut("Laps: " + this.lapsCompleted); }
        var lCount = 0;
        for(var i = this.laps.length - 1; i >= 0; i--) {
            if(showDebug) { debugOut("[" + this.laps[i] + "]"); }
            
            lCount++;
            if(lCount === 3) {
                break;
            }
        }
    };

    // The car is only simulated once everything it needs has loaded.
    this.isReady = function() {
        return !this.loadError && this.bodyLoaded && this.wheelsLoaded && this.wheels.length === 4;
    };

    this.onKeyDown = function ( event ) {

        //event.preventDefault();

        switch ( event.keyCode ) {

            case 32: /*space*/ this.handbrake = true; break;

            case 38: /*up*/
            case 87: /*W*/ this.accelerate = true; break;

            case 37: /*left*/
            case 65: /*A*/ this.turnLeft = true; break;

            case 40: /*down*/
            case 83: /*S*/ this.brake = true; break;
            
            case 190: /*.*/ this.reverse = true; break;

            case 39: /*right*/
            case 68: /*D*/ this.turnRight = true; break;

            case 82: /*R*/ this.reset = true; break;
            case 70: /*F*/ this.moveDown = true; break;

            case 219: /*[*/ this.cameraLeft = true; break;
            case 221: /*]*/ this.cameraRight = true; break;
            case 192: /*@*/ this.cameraAngle = 0; break;
            
            case 84: /*t*/ if(telemetry) telemetry.setVisible(!telemetry.visible); break;

            case 67: /*C*/ this.vehicle.tcEnabled = !this.vehicle.tcEnabled; break;
            case 66: /*B*/ this.vehicle.absEnabled = !this.vehicle.absEnabled; break;
            case 73: /*I*/ this.startEngine(); break;

            default: console.log(event.keyCode + " pressed."); break;

        }

    };

    this.onKeyUp = function ( event ) {

        switch( event.keyCode ) {

            case 32: /*space*/ this.handbrake = false; break;

            case 38: /*up*/
            case 87: /*W*/ this.accelerate = false; this.throttle = 0; break;

            case 37: /*left*/
            case 65: /*A*/ this.turnLeft = false; break;

            case 40: /*down*/
            case 83: /*S*/ this.brake = false; this.brakePedal = 0; break;
            
            case 190: /*.*/ this.reverse = false; break;

            case 39: /*right*/
            case 68: /*D*/ this.turnRight = false; break;

            case 82: /*R*/ this.reset = false; break;
            case 70: /*F*/ this.moveDown = false; break;

            case 219: /*[*/ this.cameraLeft = false; break;
            case 221: /*]*/ this.cameraRight = false; break;
        }

    };

    
    window.addEventListener( 'keydown', bind( this, this.onKeyDown ), false );
    window.addEventListener( 'keyup', bind( this, this.onKeyUp ), false );

    function bind( scope, fn ) {

            return function () {

                    fn.apply( scope, arguments );

            };

    };

};