/*
 * TyreDeform.js
 *
 * Description: The deformation of the shell tyre (tyre model "shell", TyreShell.js) on the model of the wheel: the vertices of the tyre of the wheel model are pushed in by how far the
 *              outer nodes of the shell are pushed in (flat where the road holds the tread, a little wider at the sides, and out where the air pushes it). The table of the shell
 *              (per ring across the tread and per place round the wheel, in the frame of the wheel that does not spin) goes to the vertex shader of every material of the wheel; the
 *              shader turns every vertex with the spin of the wheel to find its place in that frame, takes the push-in of the two rings beside it and of the two places beside it, and
 *              moves the vertex towards the axle by it, more the nearer it is to the tread (nothing at the rim: the vertices below the radius of the inner shell stay as they are).
 *              The depth shader (the shadow) and the normals are not changed. A wheel model that is a single mesh (rim and tyre in one) works the same: the rim does not move.
 * Author:      Glenn Hofman
 * Date:        2026-10-25
 * License:     MIT
 */

OpenRacer.TyreDeform = (function () {
    var BINS = 72, MAX_RINGS = 5;

    var VERTEX = {
        head: "uniform vec4 uDef[" + (BINS * MAX_RINGS / 4) + "];\nuniform float uDefOn;\nuniform float uDefSpin;\nuniform float uDefRIn;\nuniform float uDefROut;\nuniform float uDefK;\nuniform float uDefRings;\n" +
            "float defAt(int ring, float t) {\n  int i0 = int(floor(t)); float f = t - float(i0); i0 = i0 - (i0 / " + BINS + ") * " + BINS + "; int i1 = i0 + 1; if (i1 >= " + BINS + ") i1 -= " + BINS + ";\n" +
            "  int a = ring * " + BINS + " + i0, b = ring * " + BINS + " + i1;\n  return mix(uDef[a / 4][a - (a / 4) * 4], uDef[b / 4][b - (b / 4) * 4], f);\n}\n",
        body: "if (uDefOn > 0.5) {\n" +
            "  float cs = cos(uDefSpin), sn = sin(uDefSpin);\n" +
            "  float yy = position.y * cs - position.z * sn, zz = position.y * sn + position.z * cs;\n" +
            "  float rr = sqrt(yy * yy + zz * zz);\n" +
            "  float wgt = smoothstep(uDefRIn, uDefROut, rr);\n" +
            "  if (wgt > 0.0) {\n" +
            "    float ang = atan(zz, yy); if (ang < 0.0) ang += 6.2831853;\n" +
            "    float lat = clamp(position.x * uDefK, -1.0, 1.0);\n" +
            "    float rp = clamp((lat * 0.5 + 0.5) * (uDefRings - 1.0), 0.0, uDefRings - 1.0);\n" +
            "    int r0 = int(floor(rp)); int r1 = int(min(float(r0) + 1.0, uDefRings - 1.0)); float rf = rp - float(r0);\n" +
            "    float t = ang * (" + BINS + ".0 / 6.2831853);\n" +
            "    float d = mix(defAt(r0, t), defAt(r1, t), rf);\n" +
            "    float k = 1.0 - d * wgt / max(rr, 1e-4);\n" +
            "    float ny = yy * k, nz = zz * k;\n" +
            "    transformed.y = ny * cs + nz * sn; transformed.z = -ny * sn + nz * cs;\n" +
            "  }\n}\n"
    };

    function patch(material, uniforms) {
        var m = material.clone();
        m.onBeforeCompile = function (shader) {
            for (var key in uniforms) shader.uniforms[key] = uniforms[key];
            shader.vertexShader = shader.vertexShader.replace("void main() {", VERTEX.head + "void main() {")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERTEX.body);
        };
        m.customProgramCacheKey = function () { return "tyredeform"; };
        return m;
    }

    // the state of one wheel: made when the wheel has a shell tyre, kept on the wheel
    function make(wheel) {
        var spin = wheel.object && wheel.object.children[0] && wheel.object.children[0].children[0];
        if (!spin) return null;
        var uniforms = {
            uDef: { value: [] }, uDefOn: { value: 0 }, uDefSpin: { value: 0 }, uDefRIn: { value: 0 }, uDefROut: { value: 0 }, uDefK: { value: 1 }, uDefRings: { value: 3 }
        };
        for (var i = 0; i < BINS * MAX_RINGS / 4; i++) uniforms.uDef.value.push(new THREE.Vector4());
        var originals = [], count = 0;
        spin.traverse(function (node) {
            if (!node.isMesh || node.isSkinnedMesh || !node.material) return;
            originals.push({ node: node, material: node.material });
            node.material = Array.isArray(node.material) ? node.material.map(function (m) { return patch(m, uniforms); }) : patch(node.material, uniforms);
            count++;
        });
        return { spin: spin, uniforms: uniforms, originals: originals, table: new Float32Array(BINS * MAX_RINGS), meshes: count };
    }

    var scaleV = null;
    // once a frame for every wheel (Car.js): the table from the shell tyre of the wheel, or off when the wheel has another tyre
    function update(wheel, body, steerGroup) {
        var st = wheel.deform;
        if (!body || !body.isShell || !body.deformation) { if (st) { st.uniforms.uDefOn.value = 0; } return; }
        if (!st) { st = wheel.deform = make(wheel); if (!st) return; }
        if (!st.meshes) return;
        var rings = body.deformation(st.table);
        if (!rings) { st.uniforms.uDefOn.value = 0; return; }
        if (!scaleV) scaleV = new THREE.Vector3();
        st.spin.updateWorldMatrix(true, false);
        st.spin.getWorldScale(scaleV);
        var scale = scaleV.x || 1, R = wheel.radius, width = body.width > 0 ? body.width : 0.7 * R, ratio = body.innerRatio || 0.62;
        // the side of the model that is outwards: the lateral axis of the wheel in the model against the left of the wheel in the physics (the table is symmetric about the middle)
        var u = st.uniforms;
        for (var i = 0; i < BINS * MAX_RINGS; i++) {
            var v = i < BINS * rings ? st.table[i] * api.gain / scale : 0;
            u.uDef.value[i >> 2].setComponent(i & 3, v);
        }
        u.uDefRIn.value = R * ratio / scale;
        u.uDefROut.value = R * 0.97 / scale;
        u.uDefK.value = scale / (width / 2);
        u.uDefRings.value = rings;
        u.uDefSpin.value = wheel.spin;
        u.uDefOn.value = rings > 1 || rings === 1 ? 1 : 0;
    }

    // back to the plain materials (a tyre model that is not the shell)
    function off(wheel) { if (wheel.deform) wheel.deform.uniforms.uDefOn.value = 0; }

    var api = { update: update, off: off, BINS: BINS, gain: 1 };      // (gain: to see it, for a test: 5 draws the push-in five times as deep)
    return api;
})();
