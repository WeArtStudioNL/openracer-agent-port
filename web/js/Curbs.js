/*
 * Curbs.js
 *
 * Description: The curbstones that are drawn in the track editor: a strip of red and white (or another colour) on the ground along a
 *              smooth line through its nodes. track.json "curbs": [{ nodes: [[x, y, z, size], ...], width, height, colour, points }]. The
 *              nodes are what the editor changes (size: how large the curb is at that node, 0 to 1.5, left out 1: a node at an end with a
 *              small size makes the curb taper off there); points is the line through them about every half metre with the height of the
 *              ground under its left edge, its middle and its right edge and its size there ([x, z, yLeft, yMiddle, yRight, size]), found by
 *              the editor on the track, so that the game builds the same strip without looking for the ground. Both ends slope up from the
 *              ground (a car that drove into the end of a curb hit a step of 5 cm). Used by the track editor and by the game (TrackLoader.js:
 *              a curb is road the car drives over). No page and no 3D library of its own: THREE is passed in.
 */

OpenRacer.CURB_STEP = 0.5;                   // metres between two points of the line (about: each piece between two nodes has its own whole number of points)
OpenRacer.CURB_STRIPE = 1;                   // metres of one stripe
OpenRacer.CURB_RAMP = 1.2;                   // metres over which an end of the curb rises from the ground to its height
OpenRacer.CURB_DEFAULTS = { width: 1.2, height: 0.05, colour: "red" };
OpenRacer.CURB_COLOURS = {
    red: [0.82, 0.12, 0.1], blue: [0.1, 0.32, 0.8], green: [0.12, 0.55, 0.22], yellow: [0.95, 0.75, 0.1], black: [0.08, 0.08, 0.08]
};
OpenRacer.curbSize = function(node) { var s = node && node[3]; return Number.isFinite(s) ? Math.max(0, Math.min(1.5, s)) : 1; };

// The line of a curb through its nodes ([[x, y, z, size], ...], two at least): a smooth curve (centripetal Catmull-Rom, as the racing line) with
// points about every CURB_STEP metres: [{ x, z, sx, sz, size, segment }], sx and sz the unit vector to its left side, segment the piece between
// node segment and node segment + 1 that the point is on. Every piece is sampled on its own, so that a node that moves changes only the points of
// the pieces near it (the editor then looks for the ground only there).
OpenRacer.curbLine = function(THREE, nodes) {
    if(!nodes || nodes.length < 2) return [];
    var vectors = nodes.map(function(n) { return new THREE.Vector3(n[0], 0, n[2]); });
    var curve = nodes.length === 2 ? new THREE.LineCurve3(vectors[0], vectors[1]) : new THREE.CatmullRomCurve3(vectors, false, "centripetal", 0.5);
    var pieces = nodes.length - 1, line = [], p = new THREE.Vector3(), t = new THREE.Vector3();
    for(var i = 0; i < pieces; i++) {
        var count = Math.max(1, Math.ceil(vectors[i].distanceTo(vectors[i + 1]) / OpenRacer.CURB_STEP));
        var a = OpenRacer.curbSize(nodes[i]), b = OpenRacer.curbSize(nodes[i + 1]);
        for(var k = 0; k < count || (i === pieces - 1 && k === count); k++) {
            var u = (i + k / count) / pieces;          // (a Catmull-Rom curve goes through its pieces evenly in u)
            curve.getPoint(u, p); curve.getTangent(u, t);
            var len = Math.hypot(t.x, t.z) || 1, f = k / count;
            line.push({ x: p.x, z: p.z, sx: t.z / len, sz: -t.x / len, size: a + (b - a) * f, segment: Math.min(i, pieces - 1) });
        }
    }
    return line;
};

// The points of a curb as they are saved: the line, and the height of the ground under it (groundY(x, z, hint): the ground there, from the editor).
OpenRacer.curbPoints = function(THREE, curb, groundY) {
    var half = (curb.width || OpenRacer.CURB_DEFAULTS.width) / 2, nodes = curb.nodes;
    var r = function(v) { return Math.round(v * 1000) / 1000; };
    var hint = nodes.length ? nodes[0][1] : 0;
    return OpenRacer.curbLine(THREE, nodes).map(function(p) {
        var yMiddle = groundY(p.x, p.z, hint), w = half * Math.max(0.05, p.size);
        hint = yMiddle;
        return [r(p.x), r(p.z), r(groundY(p.x + p.sx * w, p.z + p.sz * w, yMiddle)), r(yMiddle), r(groundY(p.x - p.sx * w, p.z - p.sz * w, yMiddle)), r(p.size)];
    });
};

// The strip of a curb from its points: across it, the edges just above the ground and the top (from a fifth in from either edge) the height
// of the curb above it, both times its size there; along it, the height rises from the ground over CURB_RAMP metres at both ends; stripes of
// CURB_STRIPE metres, the colour and white. Gives a BufferGeometry with colours (no index: every stripe has its own colour, and every vertex its
// own place in the index), or null when the curb has fewer than two points.
OpenRacer.curbGeometry = function(THREE, curb) {
    var points = (curb.points || []).filter(function(p) { return Array.isArray(p) && p.length >= 5 && p.slice(0, 5).every(Number.isFinite); });
    if(points.length < 2) return null;
    var half = (curb.width > 0 ? curb.width : OpenRacer.CURB_DEFAULTS.width) / 2;
    var height = curb.height >= 0 ? curb.height : OpenRacer.CURB_DEFAULTS.height;
    var colour = OpenRacer.CURB_COLOURS[curb.colour] || OpenRacer.CURB_COLOURS.red, white = [0.94, 0.94, 0.92];
    // the distance along the curb at every point, for the ramps at the ends and the stripes
    var along = [0];
    for(var i = 1; i < points.length; i++) along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    var total = along[along.length - 1], ramp = Math.min(OpenRacer.CURB_RAMP, total / 2);
    var smooth = function(v) { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
    // across: the place (-1 the left edge, 1 the right edge) and whether it is at the top
    var across = [[-1, 0], [-0.6, 1], [0.6, 1], [1, 0]];
    var rows = points.map(function(p, i) {
        var a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
        var tx = b[0] - a[0], tz = b[1] - a[1], len = Math.hypot(tx, tz) || 1, sx = tz / len, sz = -tx / len;
        var size = Number.isFinite(p[5]) ? Math.max(0, p[5]) : 1;
        var lift = height * size * (ramp > 0 ? smooth(Math.min(along[i], total - along[i]) / ramp) : 1);
        return across.map(function(c) {
            var s = c[0], ground = s < 0 ? p[3] + (p[2] - p[3]) * -s : p[3] + (p[4] - p[3]) * s;       // (from the middle towards the edge that is on that side)
            return [p[0] - sx * half * size * s, ground + 0.012 + lift * c[1], p[1] - sz * half * size * s];
        });
    });
    var position = [], colours = [];
    for(var j = 0; j + 1 < rows.length; j++) {
        var c = Math.floor((along[j] + along[j + 1]) / 2 / OpenRacer.CURB_STRIPE) % 2 === 0 ? colour : white;
        for(var k = 0; k + 1 < across.length; k++) {
            var a0 = rows[j][k], a1 = rows[j][k + 1], b0 = rows[j + 1][k], b1 = rows[j + 1][k + 1];
            // two triangles, the normal up (counter-clockwise seen from above)
            [a0, b0, a1, a1, b0, b1].forEach(function(v) { position.push(v[0], v[1], v[2]); colours.push(c[0], c[1], c[2]); });
        }
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    // (a normal that faces down is turned: which side is left depends on the way the curb was drawn)
    var pos = geometry.attributes.position, flip = false;
    for(var t = 0; t + 2 < pos.count; t += 3) {
        var ax = pos.getX(t + 1) - pos.getX(t), az = pos.getZ(t + 1) - pos.getZ(t), bx = pos.getX(t + 2) - pos.getX(t), bz = pos.getZ(t + 2) - pos.getZ(t);
        var cross = az * bx - ax * bz;
        if(Math.abs(cross) > 1e-9) { flip = cross < 0; break; }          // (the first triangle that is not flat: a size of 0 at the start makes the first ones lines)
    }
    if(flip) {
        for(var q = 0; q < pos.count; q += 3) {
            for(var d = 0; d < 3; d++) { var v = pos.getComponent(q + 1, d); pos.setComponent(q + 1, d, pos.getComponent(q + 2, d)); pos.setComponent(q + 2, d, v); }
        }
    }
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
