/*
 * Curbs.js
 *
 * Description: The curbstones that are drawn in the track editor: a strip of red and white (or another colour) on the ground along a
 *              smooth line through its nodes. track.json "curbs": [{ nodes: [[x, y, z], ...], width, height, colour, points }]. The
 *              nodes are what the editor changes; points is the line through them every half metre with the height of the ground
 *              under its left edge, its middle and its right edge ([x, z, yLeft, yMiddle, yRight]), found by the editor with rays on
 *              the track, so that the game builds the same strip without looking for the ground. Used by the track editor and by the
 *              game (TrackLoader.js: a curb is road the car drives over). No page and no 3D library of its own: THREE is passed in.
 */

OpenRacer.CURB_STEP = 0.5;                   // metres between two points of the line
OpenRacer.CURB_STRIPE = 1;                   // metres of one stripe
OpenRacer.CURB_DEFAULTS = { width: 1.2, height: 0.05, colour: "red" };
OpenRacer.CURB_COLOURS = {
    red: [0.82, 0.12, 0.1], blue: [0.1, 0.32, 0.8], green: [0.12, 0.55, 0.22], yellow: [0.95, 0.75, 0.1], black: [0.08, 0.08, 0.08]
};

// The line of a curb through its nodes ([[x, y, z], ...], two at least): a smooth curve (centripetal Catmull-Rom, as the racing line) with
// a point every CURB_STEP metres: [{ x, z, sx, sz }], sx and sz the unit vector to its left side.
OpenRacer.curbLine = function(THREE, nodes) {
    if(!nodes || nodes.length < 2) return [];
    var vectors = nodes.map(function(n) { return new THREE.Vector3(n[0], 0, n[2]); });
    var curve = nodes.length === 2 ? new THREE.LineCurve3(vectors[0], vectors[1]) : new THREE.CatmullRomCurve3(vectors, false, "centripetal", 0.5);
    var count = Math.max(1, Math.round(curve.getLength() / OpenRacer.CURB_STEP));
    var line = [];
    for(var i = 0; i <= count; i++) {
        var u = i / count, p = curve.getPointAt(u), t = curve.getTangentAt(u);
        var len = Math.hypot(t.x, t.z) || 1;
        line.push({ x: p.x, z: p.z, sx: t.z / len, sz: -t.x / len });
    }
    return line;
};

// The points of a curb as they are saved: the line, and the height of the ground under it (groundY(x, z, hint): the ground there, from the editor).
OpenRacer.curbPoints = function(THREE, curb, groundY) {
    var half = (curb.width || OpenRacer.CURB_DEFAULTS.width) / 2, nodes = curb.nodes;
    var r = function(v) { return Math.round(v * 1000) / 1000; };
    var hint = nodes.length ? nodes[0][1] : 0;
    return OpenRacer.curbLine(THREE, nodes).map(function(p) {
        var yMiddle = groundY(p.x, p.z, hint);
        hint = yMiddle;
        return [r(p.x), r(p.z), r(groundY(p.x + p.sx * half, p.z + p.sz * half, yMiddle)), r(yMiddle), r(groundY(p.x - p.sx * half, p.z - p.sz * half, yMiddle))];
    });
};

// The strip of a curb from its points: across it, the edges just above the ground and the top (from a fifth in from either edge) the height
// of the curb above it; stripes of CURB_STRIPE metres, the colour and white. Gives a BufferGeometry with colours (no index: every stripe has its
// own colour, and every vertex its own place in the index), or null when the curb has fewer than two points.
OpenRacer.curbGeometry = function(THREE, curb) {
    var points = (curb.points || []).filter(function(p) { return Array.isArray(p) && p.length === 5 && p.every(Number.isFinite); });
    if(points.length < 2) return null;
    var half = (curb.width > 0 ? curb.width : OpenRacer.CURB_DEFAULTS.width) / 2;
    var height = curb.height >= 0 ? curb.height : OpenRacer.CURB_DEFAULTS.height;
    var colour = OpenRacer.CURB_COLOURS[curb.colour] || OpenRacer.CURB_COLOURS.red, white = [0.94, 0.94, 0.92];
    // across: the place (-1 the left edge, 1 the right edge) and the lift above the ground
    var across = [[-1, 0.012], [-0.6, height + 0.012], [0.6, height + 0.012], [1, 0.012]];
    var rows = points.map(function(p, i) {
        var a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
        var tx = b[0] - a[0], tz = b[1] - a[1], len = Math.hypot(tx, tz) || 1, sx = tz / len, sz = -tx / len;
        return across.map(function(c) {
            var s = c[0], ground = s < 0 ? p[3] + (p[3] - p[2]) * s : p[3] + (p[4] - p[3]) * s;      // (from the middle towards the edge that is on that side)
            return [p[0] - sx * half * s, ground + c[1], p[1] - sz * half * s];
        });
    });
    var position = [], colours = [], along = 0;
    for(var i = 0; i + 1 < rows.length; i++) {
        var step = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
        var c = Math.floor((along + step / 2) / OpenRacer.CURB_STRIPE) % 2 === 0 ? colour : white;
        along += step;
        for(var k = 0; k + 1 < across.length; k++) {
            var a0 = rows[i][k], a1 = rows[i][k + 1], b0 = rows[i + 1][k], b1 = rows[i + 1][k + 1];
            // two triangles, the normal up (counter-clockwise seen from above)
            [a0, b0, a1, a1, b0, b1].forEach(function(v) { position.push(v[0], v[1], v[2]); colours.push(c[0], c[1], c[2]); });
        }
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    // (a normal that faces down is turned: which side is left depends on the way the curb was drawn)
    var pos = geometry.attributes.position, flip = false;
    if(pos.count >= 3) {
        var ax = pos.getX(1) - pos.getX(0), az = pos.getZ(1) - pos.getZ(0), bx = pos.getX(2) - pos.getX(0), bz = pos.getZ(2) - pos.getZ(0);
        flip = (az * bx - ax * bz) < 0;
    }
    if(flip) {
        for(var t = 0; t < pos.count; t += 3) {
            for(var d = 0; d < 3; d++) { var v = pos.getComponent(t + 1, d); pos.setComponent(t + 1, d, pos.getComponent(t + 2, d)); pos.setComponent(t + 2, d, v); }
        }
    }
    // (an index of its own for every vertex: the game reads the triangles of the track through the index)
    var indices = new Uint32Array(pos.count);
    for(var n = 0; n < pos.count; n++) indices[n] = n;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
};

// The meshes of the curbs of a track (track.json "curbs"), each named curb_<n>, with the role road.
OpenRacer.curbMeshes = function(THREE, curbs) {
    var material = null;
    var meshes = [];
    (Array.isArray(curbs) ? curbs : []).forEach(function(curb, i) {
        var geometry = curb && OpenRacer.curbGeometry(THREE, curb);
        if(!geometry) return;
        material = material || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
        var mesh = new THREE.Mesh(geometry, material);
        mesh.name = "curb_" + (i + 1);
        mesh.userData.surface = "road";
        meshes.push(mesh);
    });
    return meshes;
};
