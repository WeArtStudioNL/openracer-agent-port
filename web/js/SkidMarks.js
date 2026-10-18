/*
 * SkidMarks.js
 *
 * Description: The marks that a sliding tyre leaves on the road: a strip of rubber along the path of the contact patch, darker the
 *              harder it slides (black on the road, a lighter track on grass and dirt). One mesh holds all of them in a ring: the
 *              oldest marks are drawn over when it is full. Every car (the player's and the AI's) draws into the same one.
 */

OpenRacer.SkidMarks = function (scene, capacity) {
    capacity = capacity || 8000;                       // strips of about 15 cm: a kilometre of marks
    var positions = new Float32Array(capacity * 4 * 3);
    var colors = new Float32Array(capacity * 4 * 4);   // r, g, b and the alpha of every corner
    var indices = new Uint32Array(capacity * 6);
    for (var s = 0; s < capacity; s++) {
        var b = s * 4, i = s * 6;
        indices[i] = b; indices[i + 1] = b + 2; indices[i + 2] = b + 1;
        indices[i + 3] = b + 1; indices[i + 4] = b + 2; indices[i + 5] = b + 3;
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // never culled
    var material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    var mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    var next = 0;
    var HALF_WIDTH = 0.1, STEP = 0.12, LIFT = 0.012;
    var last = new WeakMap();                          // wheel -> { x, y, z, sx, sy, sz, a }: where its mark ended, and the side vector there
    var side = new THREE.Vector3(), dir = new THREE.Vector3(), n = new THREE.Vector3();

    // Called every frame for a wheel with how hard it slides (0..1, 0 ends the mark)
    this.mark = function (wheel, strength, dust) {
        var prev = last.get(wheel);
        if (strength < 0.05 || !wheel.hasContact || !wheel.normal) { if (prev) last.delete(wheel); return; }
        n.set(wheel.normal.nx, wheel.normal.ny, wheel.normal.nz);
        var px = wheel.contact.x + n.x * LIFT, py = wheel.contact.y + n.y * LIFT, pz = wheel.contact.z + n.z * LIFT;
        var alpha = Math.min(0.85, strength * (dust ? 0.5 : 0.95));
        if (!prev) { last.set(wheel, { x: px, y: py, z: pz, sx: 0, sy: 0, sz: 0, a: alpha * 0.3 }); return; }
        dir.set(px - prev.x, py - prev.y, pz - prev.z);
        var d = dir.length();
        if (d < STEP) return;
        if (d > 3) { prev.x = px; prev.y = py; prev.z = pz; prev.a = alpha * 0.3; prev.sx = prev.sy = prev.sz = 0; return; } // a jump: a new mark
        dir.divideScalar(d);
        side.crossVectors(n, dir).normalize().multiplyScalar(HALF_WIDTH);
        if (prev.sx === 0 && prev.sy === 0 && prev.sz === 0) { prev.sx = side.x; prev.sy = side.y; prev.sz = side.z; }
        var r = dust ? 0.36 : 0.05, g = dust ? 0.29 : 0.05, bl = dust ? 0.2 : 0.05;
        var base = next * 4;
        var corners = [
            [prev.x - prev.sx, prev.y - prev.sy, prev.z - prev.sz, prev.a], [prev.x + prev.sx, prev.y + prev.sy, prev.z + prev.sz, prev.a],
            [px - side.x, py - side.y, pz - side.z, alpha], [px + side.x, py + side.y, pz + side.z, alpha]
        ];
        for (var c = 0; c < 4; c++) {
            positions[(base + c) * 3] = corners[c][0]; positions[(base + c) * 3 + 1] = corners[c][1]; positions[(base + c) * 3 + 2] = corners[c][2];
            colors[(base + c) * 4] = r; colors[(base + c) * 4 + 1] = g; colors[(base + c) * 4 + 2] = bl; colors[(base + c) * 4 + 3] = corners[c][3];
        }
        next = (next + 1) % capacity;
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        prev.x = px; prev.y = py; prev.z = pz; prev.sx = side.x; prev.sy = side.y; prev.sz = side.z; prev.a = alpha;
    };

    // how hard a wheel slides, for mark(): past the peak of its grip and at some speed over the road
    this.strengthOf = function (wheel) {
        if (!wheel.hasContact || wheel.weight < 300) return 0;
        var vl = wheel.forwardSpeed || 0;
        var slideSpeed = Math.hypot(wheel.omega * wheel.radius - vl, wheel.slipTan * Math.max(Math.abs(vl), 1.5));
        var past = Math.max(0, Math.min(1, (wheel.s - 1.1) / 1.0));
        var speed = Math.max(0, Math.min(1, (slideSpeed - 0.8) / 3));
        return past * speed;
    };

    // all the wheels of a vehicle
    this.update = function (vehicle) {
        for (var w = 0; w < 4; w++) {
            var wheel = vehicle.wheels[w];
            var dust = wheel.surface !== "road" && wheel.surface !== "track01";
            this.mark(wheel, this.strengthOf(wheel), dust);
        }
    };

    this.clear = function () {
        colors.fill(0);
        geometry.attributes.color.needsUpdate = true;
    };
};

// the one set of marks of the scene, made when the first car asks for it
OpenRacer.skidMarks = function () {
    if (!OpenRacer.skidMarksInstance && typeof scene !== "undefined" && scene) OpenRacer.skidMarksInstance = new OpenRacer.SkidMarks(scene);
    return OpenRacer.skidMarksInstance || null;
};
