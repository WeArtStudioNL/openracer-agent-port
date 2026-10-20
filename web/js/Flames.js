/*
 * Flames.js
 *
 * Description: The flames at the exhaust when unburnt fuel burns in it (pops and bangs, anti-lag; Engine.js makes the events, Car.js hands them
 *              here): short, bright puffs that fly backwards from the tail pipes with the speed of the car, orange with a pale core, drawn
 *              additive. The tail pipes are where car.json says ("exhaust": [{ "position": [x, y, z], "rotation": [degrees] }, ...] in the frame of the
 *              car, as in the car editor, where they are placed: x to the left, y up, z forward; a flame goes along the negative z of the point,
 *              turned by the rotation; the older form is a list of [x, y, z]), or a guess: at the back, at the height of the hubs, one on each side for two exhaust
 *              systems and one on the right for one.
 *              Your own pictures: flat PNGs with transparency in web/images/flames/ named flame1.png, flame2.png, flame3.png, ... (numbered
 *              without a gap; it stops at the first missing number; at most 16). Every flame takes one of them at random. A picture points to
 *              the right: the nozzle is the left edge in the middle, the tip is the right edge; it is turned to the way the flame flies and drawn
 *              additive (black is nothing). Without pictures the flames are the gradient that is made here.
 */

OpenRacer.ExhaustFlames = function (scene, car) {
    var N = 64;
    var canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    var g = canvas.getContext("2d");
    var gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.25, "rgba(255, 230, 170, 0.9)");
    gradient.addColorStop(0.6, "rgba(255, 120, 30, 0.45)");
    gradient.addColorStop(1, "rgba(255, 60, 0, 0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    var texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    // the pictures of web/images/flames/ (flame1.png, flame2.png, ...), when there are some
    var custom = [];
    (function load(n) {
        if (n > 16) return;
        new THREE.TextureLoader().load((car.imageBase || "") + "images/flames/flame" + n + ".png", function (t) {
            t.colorSpace = THREE.SRGBColorSpace;
            custom.push(t);
            load(n + 1);
        }, undefined, function () { /* no more pictures */ });
    })(1);

    var sprites = [], age = new Float32Array(N).fill(1e9), life = new Float32Array(N).fill(1), size0 = new Float32Array(N), size1 = new Float32Array(N);
    var alpha0 = new Float32Array(N), own = new Float32Array(N), lengthF = new Float32Array(N), widthF = new Float32Array(N), vel = [], next = 0;
    var view = new THREE.Vector3(), pos = [], toCamera = new THREE.Vector3();
    for (var i = 0; i < N; i++) {
        var material = new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
        var sprite = new THREE.Sprite(material);
        sprite.visible = false;
        sprite.frustumCulled = false;
        scene.add(sprite);
        sprites.push(sprite);
        vel.push(new THREE.Vector3());
        pos.push(new THREE.Vector3());
    }

    var q = new THREE.Quaternion(), p = new THREE.Vector3(), dir = new THREE.Vector3(), carVel = new THREE.Vector3(), local = null;

    // the tail pipes in the frame of the car: { position, direction }
    var euler = new THREE.Euler();
    function pipes(vehicle) {
        if (local) return local;
        if (car.exhaust && car.exhaust.length) {
            local = car.exhaust.map(function (e) {
                var position = Array.isArray(e) ? e : e.position, rotation = Array.isArray(e) ? [0, 0, 0] : (e.rotation || [0, 0, 0]);
                euler.set(rotation[0] * Math.PI / 180, rotation[1] * Math.PI / 180, rotation[2] * Math.PI / 180);
                // the settings of the point (the car editor): the diameter of the pipe (m), the smoke and the brightness (factors), the length and the width of the
                // flame (cm, as the editor has them; the older form was a factor of 30 and of 12 cm)
                var o = Array.isArray(e) ? {} : e;
                var diameter = o.diameter || 0.08;
                var length = o.flame_length_cm !== undefined ? o.flame_length_cm / 100 : (o.flame_length !== undefined ? o.flame_length * 0.3 : 0.3);
                var width = o.flame_width_cm !== undefined ? o.flame_width_cm / 100 : (o.flame_width !== undefined ? o.flame_width * 0.12 * diameter / 0.08 : 0.12);
                return { position: new THREE.Vector3(position[0], position[1], position[2]), direction: new THREE.Vector3(0, 0, -1).applyEuler(euler),
                    diameter: diameter, smoke: o.smoke !== undefined ? o.smoke : 1, length: Math.max(0.01, Math.min(0.8, length)), width: Math.max(0.01, Math.min(0.8, width)),
                    brightness: o.brightness !== undefined ? o.brightness : 1 };
            });
            return local;
        }
        var rear = vehicle.wheels[2].mount;
        var z = rear.z - Math.max(0.3, (car.length - vehicle.wheelbase) / 2 * 0.95);
        var y = rear.y - 0.05;
        var backwards = new THREE.Vector3(0, -0.06, -1).normalize();
        local = (car.exhaustSystems >= 2 ? [car.width * 0.3, -car.width * 0.3] : [-car.width * 0.3]).map(function (x) {
            return { position: new THREE.Vector3(x, y, z), direction: backwards.clone(), diameter: 0.08, smoke: 1, length: 0.3, width: 0.12, brightness: 1 };
        });
        return local;
    }

    // a bang: { strength (0.5 to 1.5), flame (a factor) }
    this.emit = function (vehicle, event, body) {
        if (event.flame <= 0.01) return;
        q.copy(body.quaternion);
        carVel.set(vehicle.vx, vehicle.vy, vehicle.vz);
        var list = pipes(vehicle), s = event.strength * Math.min(2, event.flame);
        for (var k = 0; k < list.length; k++) {
            p.copy(list[k].position).applyQuaternion(q);
            dir.copy(list[k].direction).applyQuaternion(q);
            var count = 2 + Math.round(s * 3);
            for (var c = 0; c < count; c++) {
                var i = next;
                next = (next + 1) % N;
                var sp = sprites[i];
                pos[i].set(body.position.x + p.x + (Math.random() - 0.5) * list[k].diameter * 0.5, body.position.y + p.y + (Math.random() - 0.5) * list[k].diameter * 0.5, body.position.z + p.z + (Math.random() - 0.5) * list[k].diameter * 0.5).addScaledVector(dir, Math.random() * 0.15);
                vel[i].copy(dir).multiplyScalar(2.5 + Math.random() * 5 * s).addScaledVector(carVel, 0.95);
                vel[i].x += (Math.random() - 0.5) * 0.8; vel[i].y += (Math.random() - 0.5) * 0.8 + 0.3; vel[i].z += (Math.random() - 0.5) * 0.8;
                age[i] = 0;
                life[i] = 0.07 + Math.random() * 0.13 * Math.min(1.5, s);
                size0[i] = 0.03 + Math.random() * 0.03;
                size1[i] = (0.08 + 0.12 * Math.random()) * Math.min(2, 0.6 + s);
                alpha0[i] = 0.9 * list[k].brightness;
                // the length and the width are those of the flame at its largest (m), a little different for every one
                lengthF[i] = list[k].length * Math.min(2, event.flame) * (0.75 + 0.25 * Math.min(1.5, event.strength)) * (0.8 + 0.4 * Math.random());
                widthF[i] = list[k].width * Math.min(2, event.flame) * (0.85 + 0.3 * Math.random());
                // a picture of your own, or the gradient
                var picture = custom.length ? custom[(Math.random() * custom.length) | 0] : null;
                sp.material.map = picture || texture;
                sp.material.needsUpdate = true;
                own[i] = picture ? picture.image.width / picture.image.height : 0;
                sp.center.set(picture ? 0 : 0.25, 0.5);          // (the gradient starts a little in front of the pipe)
                sp.visible = true;
            }
            // the smoke after the bang: a few grey puffs from the pipe (the game makes them with the smoke of the tyres)
            if (car.smoke && list[k].smoke > 0.01) {
                var puffs = Math.round(list[k].smoke * (1 + event.strength * 1.5));
                for (var m = 0; m < puffs; m++) {
                    car.smoke(body.position.x + p.x + dir.x * 0.12, body.position.y + p.y + dir.y * 0.12, body.position.z + p.z + dir.z * 0.12,
                        dir.x * (0.8 + Math.random()) + carVel.x * 0.5 + (Math.random() - 0.5) * 0.4, dir.y * (0.8 + Math.random()) + carVel.y * 0.5 + 0.2 + Math.random() * 0.3,
                        dir.z * (0.8 + Math.random()) + carVel.z * 0.5 + (Math.random() - 0.5) * 0.4, list[k].diameter);
                }
            }
        }
    };

    this.update = function (dt, camera) {
        for (var i = 0; i < N; i++) {
            if (age[i] >= life[i]) { if (sprites[i].visible) sprites[i].visible = false; continue; }
            age[i] += dt;
            var t = Math.min(1, age[i] / life[i]);
            var sp = sprites[i];
            pos[i].addScaledVector(vel[i], dt);
            vel[i].multiplyScalar(Math.exp(-5 * dt));
            var size = size0[i] + (size1[i] - size0[i]) * Math.sqrt(t);
            // The flame is drawn a little towards the camera, so that the body of the car does not hide the start of it (a pipe is at the surface or inside it).
            sp.position.copy(pos[i]);
            var side = 1;
            if (camera) {
                toCamera.copy(camera.position).sub(pos[i]);
                var distance = toCamera.length() || 1;
                sp.position.addScaledVector(toCamera, Math.min(0.4, distance * 0.4) / distance);
                // long in the way that it flies (as seen from the camera), the nozzle at the pipe; seen from the front or the back (in the way of the flame) it is a round puff
                view.copy(vel[i]).transformDirection(camera.matrixWorldInverse);
                sp.material.rotation = Math.atan2(view.y, view.x);
                side = Math.min(1, Math.hypot(view.x, view.y) * 1.2);
            }
            var grow = 0.35 + 0.65 * Math.sqrt(t), L = lengthF[i] * grow, W = widthF[i] * grow;
            sp.scale.set(W * 1.2 + (L - W * 1.2) * side, W, 1);
            sp.material.opacity = alpha0[i] * Math.pow(1 - t, 1.5);
            sp.material.color.setRGB(1, 0.9 - 0.55 * t, 0.7 - 0.65 * t);       // pale at the start, orange at the end
        }
    };

    this.refresh = function () { local = null; };           // the points of car.exhaust have changed (the car editor)
    this.clear = function () { age.fill(1e9); sprites.forEach(function (sp) { sp.visible = false; }); };
};
