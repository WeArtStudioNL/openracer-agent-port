/*
 * Flames.js
 *
 * Description: The flames at the exhaust when unburnt fuel burns in it (pops and bangs, anti-lag; Engine.js makes the events, Car.js hands them
 *              here): short, bright puffs that fly backwards from the tail pipes with the speed of the car, orange with a pale core, drawn
 *              additive. The tail pipes are where car.json says ("exhaust": [[x, y, z], ...] in the frame of the car from the middle of the
 *              car: x to the left, y up, z forward), or a guess: at the back, at the height of the hubs, one on each side for two exhaust
 *              systems and one on the right for one.
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

    var sprites = [], age = new Float32Array(N).fill(1e9), life = new Float32Array(N).fill(1), size0 = new Float32Array(N), size1 = new Float32Array(N);
    var alpha0 = new Float32Array(N), vel = [], next = 0;
    for (var i = 0; i < N; i++) {
        var material = new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
        var sprite = new THREE.Sprite(material);
        sprite.visible = false;
        sprite.frustumCulled = false;
        scene.add(sprite);
        sprites.push(sprite);
        vel.push(new THREE.Vector3());
    }

    var q = new THREE.Quaternion(), p = new THREE.Vector3(), dir = new THREE.Vector3(), carVel = new THREE.Vector3(), local = null;

    // the tail pipes in the frame of the car
    function pipes(vehicle) {
        if (local) return local;
        if (car.exhaust && car.exhaust.length) { local = car.exhaust.map(function (e) { return new THREE.Vector3(e[0], e[1], e[2]); }); return local; }
        var rear = vehicle.wheels[2].mount;
        var z = rear.z - Math.max(0.3, (car.length - vehicle.wheelbase) / 2 * 0.95);
        var y = rear.y - 0.05;
        local = car.exhaustSystems >= 2 ? [new THREE.Vector3(car.width * 0.3, y, z), new THREE.Vector3(-car.width * 0.3, y, z)] : [new THREE.Vector3(-car.width * 0.3, y, z)];
        return local;
    }

    // a bang: { strength (0.5 to 1.5), flame (a factor) }
    this.emit = function (vehicle, event) {
        if (event.flame <= 0.01) return;
        q.set(vehicle.qx, vehicle.qy, vehicle.qz, vehicle.qw);
        carVel.set(vehicle.vx, vehicle.vy, vehicle.vz);
        var list = pipes(vehicle), s = event.strength * Math.min(2, event.flame);
        for (var k = 0; k < list.length; k++) {
            p.copy(list[k]).applyQuaternion(q);
            dir.set(0, -0.06, -1).applyQuaternion(q);
            var count = 2 + Math.round(s * 3);
            for (var c = 0; c < count; c++) {
                var i = next;
                next = (next + 1) % N;
                var sp = sprites[i];
                sp.position.set(vehicle.px + p.x, vehicle.py + p.y, vehicle.pz + p.z).addScaledVector(dir, Math.random() * 0.15);
                vel[i].copy(dir).multiplyScalar(4 + Math.random() * 8 * s).addScaledVector(carVel, 0.95);
                vel[i].x += (Math.random() - 0.5) * 0.8; vel[i].y += (Math.random() - 0.5) * 0.8 + 0.3; vel[i].z += (Math.random() - 0.5) * 0.8;
                age[i] = 0;
                life[i] = 0.07 + Math.random() * 0.13 * Math.min(1.5, s);
                size0[i] = 0.08 + Math.random() * 0.06;
                size1[i] = (0.22 + 0.35 * Math.random()) * Math.min(2, 0.6 + s);
                alpha0[i] = 0.9;
                sp.visible = true;
            }
        }
    };

    this.update = function (dt) {
        for (var i = 0; i < N; i++) {
            if (age[i] >= life[i]) { if (sprites[i].visible) sprites[i].visible = false; continue; }
            age[i] += dt;
            var t = Math.min(1, age[i] / life[i]);
            var sp = sprites[i];
            sp.position.addScaledVector(vel[i], dt);
            vel[i].multiplyScalar(Math.exp(-5 * dt));
            var size = size0[i] + (size1[i] - size0[i]) * Math.sqrt(t);
            sp.scale.set(size, size, 1);
            sp.material.opacity = alpha0[i] * Math.pow(1 - t, 1.5);
            sp.material.color.setRGB(1, 0.9 - 0.55 * t, 0.7 - 0.65 * t);       // pale at the start, orange at the end
        }
    };

    this.clear = function () { age.fill(1e9); sprites.forEach(function (sp) { sp.visible = false; }); };
};
