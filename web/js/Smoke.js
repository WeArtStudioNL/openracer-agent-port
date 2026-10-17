/*
 * Smoke.js
 *
 * Description: The smoke of the tyres (and dust on soft ground) as a cloud of soft points that rise, spread out and fade away. Every wheel that slides
 *              makes it at a rate that comes from the physics (wheel.smoke, see Vehicle.js): the longer a tyre slides, the thicker it gets.
 */

OpenRacer.TyreSmoke = function(scene, capacity) {
    capacity = capacity || 2500;
    var positions = new Float32Array(capacity * 3);
    var sizes = new Float32Array(capacity);
    var alphas = new Float32Array(capacity);
    var colours = new Float32Array(capacity * 3);
    var vel = new Float32Array(capacity * 3);
    var age = new Float32Array(capacity).fill(1e9);
    var life = new Float32Array(capacity).fill(1);
    var size0 = new Float32Array(capacity), size1 = new Float32Array(capacity), alpha0 = new Float32Array(capacity);
    var next = 0;
    var carry = [0, 0, 0, 0];

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute("tint", new THREE.BufferAttribute(colours, 3));
    var material = new THREE.ShaderMaterial({
        uniforms: { pixelScale: { value: 600 } },
        vertexShader: "attribute float size; attribute float alpha; attribute vec3 tint; varying float vAlpha; varying vec3 vTint; uniform float pixelScale;" +
            "void main() { vAlpha = alpha; vTint = tint; vec4 mv = modelViewMatrix * vec4(position, 1.0);" +
            "  gl_PointSize = size * pixelScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }",
        fragmentShader: "varying float vAlpha; varying vec3 vTint;" +
            "void main() { float d = length(gl_PointCoord - vec2(0.5)) * 2.0; float a = (1.0 - smoothstep(0.0, 1.0, d)); a *= a; gl_FragColor = vec4(vTint, a * vAlpha); }",
        transparent: true,
        depthWrite: false
    });
    var points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 10;
    scene.add(points);

    function spawn(x, y, z, vx, vy, vz, heat, dust) {
        var i = next;
        next = (next + 1) % capacity;
        positions[i * 3] = x + (Math.random() - 0.5) * 0.3;
        positions[i * 3 + 1] = y + 0.05;
        positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
        vel[i * 3] = vx * 0.35 + (Math.random() - 0.5) * 0.9;
        vel[i * 3 + 1] = 0.5 + Math.random() * 0.9;
        vel[i * 3 + 2] = vz * 0.35 + (Math.random() - 0.5) * 0.9;
        age[i] = 0;
        life[i] = (dust ? 1.4 : 2.0) + Math.random() * 1.6 + heat * 0.8;
        size0[i] = 0.8 + Math.random() * 0.4;
        size1[i] = (dust ? 4 : 5) + Math.random() * 2 + heat * 3.5;
        alpha0[i] = (dust ? 0.3 : 0.42) + 0.35 * heat;
        var shade = 0.85 + Math.random() * 0.1;
        if(dust) { colours[i * 3] = 0.62 * shade; colours[i * 3 + 1] = 0.52 * shade; colours[i * 3 + 2] = 0.38 * shade; }
        else { colours[i * 3] = 0.86 * shade; colours[i * 3 + 1] = 0.87 * shade; colours[i * 3 + 2] = 0.9 * shade; }
    }

    // Moves the smoke and makes new smoke at the wheels. camera is for the size of the points on the screen.
    this.update = function(delta, vehicle, camera) {
        var wheels = vehicle.wheels;
        for(var w = 0; w < 4; w++) {
            var wheel = wheels[w];
            if(wheel.smoke > 0.02 && wheel.hasContact) {
                var dust = wheel.surface !== "road" && wheel.surface !== "track01";
                carry[w] += (dust ? 50 : 100) * wheel.smoke * delta;
                var count = Math.floor(carry[w]);
                carry[w] -= count;
                for(var n = 0; n < count; n++) {
                    spawn(wheel.contact.x, wheel.contact.y, wheel.contact.z, vehicle.vx, vehicle.vy, vehicle.vz, wheel.heat, dust);
                }
            } else {
                carry[w] = 0;
            }
        }
        var drag = Math.exp(-1.3 * delta);
        for(var i = 0; i < capacity; i++) {
            if(age[i] >= life[i]) {
                if(alphas[i] !== 0) alphas[i] = 0;
                continue;
            }
            age[i] += delta;
            var t = Math.min(1, age[i] / life[i]);
            vel[i * 3] *= drag; vel[i * 3 + 1] = vel[i * 3 + 1] * drag + 0.25 * delta; vel[i * 3 + 2] *= drag;
            positions[i * 3] += vel[i * 3] * delta;
            positions[i * 3 + 1] += vel[i * 3 + 1] * delta;
            positions[i * 3 + 2] += vel[i * 3 + 2] * delta;
            sizes[i] = size0[i] + (size1[i] - size0[i]) * Math.sqrt(t);
            alphas[i] = alpha0[i] * Math.pow(1 - t, 1.5) * Math.min(1, t / 0.06);
        }
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.size.needsUpdate = true;
        geometry.attributes.alpha.needsUpdate = true;
        geometry.attributes.tint.needsUpdate = true;
        // pixels per metre at a distance of one metre
        var height = renderer.domElement.height;
        material.uniforms.pixelScale.value = height / (2 * Math.tan(camera.fov * Math.PI / 360));
    };

    this.clear = function() {
        age.fill(1e9);
        alphas.fill(0);
        geometry.attributes.alpha.needsUpdate = true;
    };
};
