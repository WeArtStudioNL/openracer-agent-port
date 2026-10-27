/*
 * TrackMarks.js
 *
 * Description: What the track editor paints on the road of a track, drawn in the game: the pit area ("pit" in track.json: a polygon on the ground, inside which the road
 *              is the pit lane, Pit.js) as a translucent surface with a line round it, and the grid boxes ("grid": up to eight boxes, each { x, z, heading }; box 1 is
 *              the start of the player, the others are where the opponents stand at the start of a race) as two white side lines on the road joined by a line across the front (no numbers).
 *              The heights come from the ground of the track (groundWorld, TrackLoader.js), a little above the road so that they lie on it.
 *
 *              OpenRacer.TrackMarks.build(track)   makes them for the track that is loaded (after the ground world is built); nothing without a pit or a grid
 * Author:      Glenn Hofman
 * Date:        2026-10-27
 * License:     MIT
 */

OpenRacer.TrackMarks = (function () {
    var group = null;
    var BOX_W = 2.4, BOX_L = 5.0, LIFT = 0.04;

    function heightAt(x, z, fallback) {
        if (typeof groundWorld !== "undefined" && groundWorld && groundWorld.query) { var r = groundWorld.query(x, z, 1e4, 1e4); if (r) return r.y; }
        return fallback || 0;
    }
    // a flat quad strip along a line of points (the lines of a grid box), as triangles on the road
    function strip(points, width, y) {
        var positions = [];
        for (var i = 0; i < points.length - 1; i++) {
            var a = points[i], b = points[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
            var nx = -dz / len * width / 2, nz = dx / len * width / 2;
            var ya = heightAt(a[0], a[1], y) + LIFT, yb = heightAt(b[0], b[1], y) + LIFT;
            positions.push(a[0] - nx, ya, a[1] - nz, b[0] - nx, yb, b[1] - nz, b[0] + nx, yb, b[1] + nz, a[0] - nx, ya, a[1] - nz, b[0] + nx, yb, b[1] + nz, a[0] + nx, ya, a[1] + nz);
        }
        var g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        g.computeVertexNormals();
        return g;
    }
    function build(track) {
        if (group) { scene.remove(group); group = null; }
        if (!track) return;
        var pit = track.pit && Array.isArray(track.pit.polygon) && track.pit.polygon.length >= 3 ? track.pit.polygon : null;
        var grid = Array.isArray(track.grid) ? track.grid.filter(function (b) { return b && isFinite(b.x) && isFinite(b.z); }) : [];
        if (!pit && !grid.length) return;
        group = new THREE.Group();
        group.name = "track marks";
        if (pit) {
            // the surface of the pit area: the polygon on the road (its corners on the road; a hill in the middle of a big area would show through)
            var shape = new THREE.Shape(pit.map(function (p) { return new THREE.Vector2(p[0], p[1]); }));
            var geometry = new THREE.ShapeGeometry(shape);
            var pos = geometry.attributes.position;
            for (var i = 0; i < pos.count; i++) { var x = pos.getX(i), z = pos.getY(i); pos.setXYZ(i, x, heightAt(x, z, 0) + LIFT, z); }
            geometry.computeVertexNormals();
            var fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x5a7fa8, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
            fill.renderOrder = 1;
            group.add(fill);
            var edge = pit.map(function (p) { return [p[0], p[1]]; }); edge.push(edge[0]);
            group.add(new THREE.Mesh(strip(edge, 0.25, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 })));
        }
        grid.forEach(function (b, i) {
            var h = b.heading || 0, c = Math.cos(h), s = Math.sin(h);           // along the box (the way the car faces) and across it
            var ax = c * BOX_L / 2, az = s * BOX_L / 2, bx = -s * BOX_W / 2, bz = c * BOX_W / 2;
            // the box: the two long sides as straight lines and a line across the front that joins them (the back is open), no numbers; the lines reach half a line width past
            // the corners so that the angles are closed
            var W = 0.18, ex = W / 2;
            var material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide });
            var fl = [b.x + ax + bx, b.z + az + bz], fr = [b.x + ax - bx, b.z + az - bz];             // the front corners
            var left = [[b.x - ax + bx, b.z - az + bz], [fl[0] + c * ex, fl[1] + s * ex]];
            var right = [[b.x - ax - bx, b.z - az - bz], [fr[0] + c * ex, fr[1] + s * ex]];
            var front = [[fl[0] + (-s) * ex, fl[1] + c * ex], [fr[0] - (-s) * ex, fr[1] - c * ex]];
            [left, right, front].forEach(function (line) { var m = new THREE.Mesh(strip(line, W, 0), material); m.renderOrder = 2; group.add(m); });
        });
        scene.add(group);
    }

    return { build: build };
})();
