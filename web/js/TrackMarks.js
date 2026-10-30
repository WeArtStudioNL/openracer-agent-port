/*
 * TrackMarks.js
 *
 * Description: What the track editor paints on the road of a track, drawn in the game: the pit boxes ("pit": { "boxes": [{ x, z, heading }] } in track.json: a box of 4 by 8 m
 *              for every player, see-through with a line round it: the box of the player yellow, those of the other cars light blue; a car that stands in its box is serviced, Pit.js), the older pit area ("pit": { "polygon" }, a polygon on
 *              the ground, inside which the road is the pit lane) as a translucent surface with a line round it, and the grid boxes ("grid": up to eight boxes, each { x, z, heading }; box 1 is
 *              the start of the player, the others are where the opponents stand at the start of a race) as a white line across the front with a short leg back from each end (no numbers).
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
        var pitBoxes = OpenRacer.PitStop && OpenRacer.PitStop.boxesOf ? OpenRacer.PitStop.boxesOf(track) : [];
        var grid = Array.isArray(track.grid) ? track.grid.filter(function (b) { return b && isFinite(b.x) && isFinite(b.z); }) : [];
        if (!pit && !grid.length && !pitBoxes.length) return;
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
        // the pit boxes: a lattice of squares of half a metre over the 4 by 8 m, with the height of the road at every corner, so that it lies on a slope too
        // (the box of the player, the first, is yellow and stands out; the boxes of the other cars are light blue, see Pit.js boxIndex)
        pitBoxes.forEach(function (b, boxNumber) {
            var own = boxNumber === 0;
            var W = OpenRacer.PitStop.BOX_W, L = OpenRacer.PitStop.BOX_L, c = Math.cos(b.heading), s = Math.sin(b.heading), nx = Math.round(W / 0.5), nz = Math.round(L / 0.5);
            var positions = [], indices = [];
            for (var j = 0; j <= nz; j++) for (var i2 = 0; i2 <= nx; i2++) {
                var u = (j / nz - 0.5) * L, w = (i2 / nx - 0.5) * W, x = b.x + c * u - s * w, z = b.z + s * u + c * w;
                positions.push(x, heightAt(x, z, 0) + LIFT * 1.5, z);
            }
            for (var j2 = 0; j2 < nz; j2++) for (var i3 = 0; i3 < nx; i3++) { var a0 = j2 * (nx + 1) + i3; indices.push(a0, a0 + 1, a0 + nx + 1, a0 + 1, a0 + nx + 2, a0 + nx + 1); }
            var geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
            geometry.setIndex(indices);
            var fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: own ? 0xffd23c : 0x8fd0ff, transparent: true, opacity: own ? 0.55 : 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide, fog: false }));
            fill.renderOrder = 1;
            group.add(fill);
            var ring = [[b.x - c * L / 2 + s * W / 2, b.z - s * L / 2 - c * W / 2], [b.x + c * L / 2 + s * W / 2, b.z + s * L / 2 - c * W / 2], [b.x + c * L / 2 - s * W / 2, b.z + s * L / 2 + c * W / 2], [b.x - c * L / 2 - s * W / 2, b.z - s * L / 2 + c * W / 2]];
            ring.push(ring[0]);
            var edgeMesh = new THREE.Mesh(strip(ring, 0.2, 0), new THREE.MeshBasicMaterial({ color: own ? 0xffe066 : 0xb8e2ff, transparent: true, opacity: own ? 0.95 : 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide, fog: false }));
            edgeMesh.renderOrder = 2;
            group.add(edgeMesh);
        });
        grid.forEach(function (b, i) {
            var h = b.heading || 0, c = Math.cos(h), s = Math.sin(h);           // along the box (the way the car faces) and across it
            var ax = c * BOX_L / 2, az = s * BOX_L / 2, bx = -s * BOX_W / 2, bz = c * BOX_W / 2;
            // the box: a line across the front and a short leg back from each end of it (the rest of the sides and the back are open), no numbers; the lines reach half a line
            // width past the corners so that the angles are closed
            var W = 0.18, ex = W / 2, LEG = 0.8;
            var material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide });
            var fl = [b.x + ax + bx, b.z + az + bz], fr = [b.x + ax - bx, b.z + az - bz];             // the front corners
            var left = [[fl[0] - c * LEG, fl[1] - s * LEG], [fl[0] + c * ex, fl[1] + s * ex]];
            var right = [[fr[0] - c * LEG, fr[1] - s * LEG], [fr[0] + c * ex, fr[1] + s * ex]];
            var front = [[fl[0] + (-s) * ex, fl[1] + c * ex], [fr[0] - (-s) * ex, fr[1] - c * ex]];
            [left, right, front].forEach(function (line) { var m = new THREE.Mesh(strip(line, W, 0), material); m.renderOrder = 2; group.add(m); });
        });
        scene.add(group);
    }

    return { build: build };
})();
