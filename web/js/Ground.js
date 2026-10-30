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
 * Ground.js
 *
 * Description: The road that the car drives on, for the suspension: the drivable triangles of the track in a grid on the ground
 *              plane. A query for a place (x, z) gives the surface under it: its height, its normal and what it is made of.
 *              Much faster than a ray against the meshes, so every wheel can ask in every step of the physics. No 3D dependencies.
 *
 *              That grid on the ground plane has one height per place, so it cannot hold a loop, a vertical wall that is driven on or a
 *              road that overhangs. The 3D side of this world does: every triangle of the track (the drivable ones, and the rest that the
 *              car can hit) is kept in a 3D grid, with rays (the wheels feel the road along their own axis, so a car can drive on a wall or
 *              upside down) and with spheres (the body of the car, see Vehicle.js). It is built for a track with "physics": "3d".
 */

OpenRacer.GroundWorld = function (cellSize) {
    cellSize = cellSize || 5;
    var tri = [];            // per triangle: x0, z0, x1, z1, x2, z2, y0, y1, y2, nx, ny, nz, priority, surface index
    var surfaces = [];       // names of the surfaces
    var meshes = [];         // names of the meshes
    var meshOf = [];
    var cells = {};
    // the pit areas of the track (track.json "pit": a polygon on the ground, drawn in the track editor): a place inside one is the pit lane, whatever the road there is
    // called (the surface "track01", which Pit.js and Opponent.js know as the pit lane)
    var pitAreas = [];
    var PIT = "track01";
    this.setPitAreas = function (polygons) { pitAreas = (polygons || []).filter(function (p) { return Array.isArray(p) && p.length >= 3; }); };
    function inPolygon(poly, x, z) {
        var inside = false;
        for(var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
            if(((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi)) inside = !inside;
        }
        return inside;
    }
    this.inPit = function (x, z) { for(var i = 0; i < pitAreas.length; i++) if(inPolygon(pitAreas[i], x, z)) return true; return false; };
    this.hasPitAreas = function () { return pitAreas.length > 0; };
    var inPit = this.inPit;
    function pitSurface(x, z, surface) { return pitAreas.length && surface !== "wall" && inPit(x, z) ? PIT : surface; }

    function surfaceIndex(name) {
        var i = surfaces.indexOf(name);
        if(i < 0) { surfaces.push(name); i = surfaces.length - 1; }
        return i;
    }

    function meshIndex(name) {
        var i = meshes.indexOf(name);
        if(i < 0) { meshes.push(name); i = meshes.length - 1; }
        return i;
    }

    // A triangle of the road, in world coordinates. priority: where roads lie over each other the lowest wins (a road over grass)
    this.addTriangle = function (x0, y0, z0, x1, y1, z1, x2, y2, z2, surface, mesh, priority) {
        // the normal, pointing up
        var ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
        var vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        var length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if(length < 1e-9) return;
        if(ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        nx /= length; ny /= length; nz /= length;
        if(ny < 0.2) return; // a wall, not a road
        var index = tri.length / 14;
        tri.push(x0, z0, x1, z1, x2, z2, y0, y1, y2, nx, ny, nz, priority || 0, surfaceIndex(surface));
        meshOf.push(meshIndex(mesh));
        var minX = Math.floor(Math.min(x0, x1, x2) / cellSize), maxX = Math.floor(Math.max(x0, x1, x2) / cellSize);
        var minZ = Math.floor(Math.min(z0, z1, z2) / cellSize), maxZ = Math.floor(Math.max(z0, z1, z2) / cellSize);
        for(var i = minX; i <= maxX; i++) {
            for(var j = minZ; j <= maxZ; j++) {
                var key = i + "," + j;
                if(!cells[key]) cells[key] = [];
                cells[key].push(index);
            }
        }
    };

    this.count = function () {
        return tri.length / 14;
    };

    // The middles of the triangles of a surface (the pit lane, for the line the AI drives through it), as { x, y, z }
    this.centroidsOf = function (surface) {
        var index = surfaces.indexOf(surface);
        var out = [];
        if(index >= 0) for(var t = 0; t < tri.length; t += 14) {
            if(tri[t + 13] !== index) continue;
            out.push({ x: (tri[t] + tri[t + 2] + tri[t + 4]) / 3, y: (tri[t + 6] + tri[t + 7] + tri[t + 8]) / 3, z: (tri[t + 1] + tri[t + 3] + tri[t + 5]) / 3 });
        }
        // the pit areas: points on a grid inside the polygon, on the road there (for the line of the AI through the pit lane, Pit.js)
        if(surface === PIT) for(var p = 0; p < pitAreas.length; p++) {
            var poly = pitAreas[p], minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            poly.forEach(function (q) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minZ = Math.min(minZ, q[1]); maxZ = Math.max(maxZ, q[1]); });
            var step = Math.max(1.5, Math.min(3, Math.max(maxX - minX, maxZ - minZ) / 40));
            for(var x = minX + step / 2; x < maxX; x += step) for(var z = minZ + step / 2; z < maxZ; z += step) {
                if(!inPolygon(poly, x, z)) continue;
                var road = this.query(x, z, 1e4, 1e4);
                if(road) out.push({ x: x, y: road.y, z: z, area: true });
            }
        }
        return out;
    };

    // The surface under (x, z): the highest one that is not more than 'above' above hintY (the car is above the road, or under it
    // after a hit; a bridge above the car is not the road). Returns { y, nx, ny, nz, surface, mesh } or null. Where several
    // surfaces are at about the same height (a road over grass) the one with the lowest priority is taken.
    this.query = function (x, z, hintY, above) {
        var list = cells[Math.floor(x / cellSize) + "," + Math.floor(z / cellSize)];
        if(!list) return null;
        var limit = hintY + (above === undefined ? 0.6 : above);
        var best = -1, bestY = -1e9, bestPriority = 1e9;
        for(var k = 0; k < list.length; k++) {
            var t = list[k];
            var o = t * 14;
            var x0 = tri[o], z0 = tri[o + 1], x1 = tri[o + 2], z1 = tri[o + 3], x2 = tri[o + 4], z2 = tri[o + 5];
            // barycentric coordinates of (x, z)
            var d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
            if(d === 0) continue;
            var a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
            var b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
            var c = 1 - a - b;
            var e = -1e-5;
            if(a < e || b < e || c < e) continue;
            var y = a * tri[o + 6] + b * tri[o + 7] + c * tri[o + 8];
            if(y > limit) continue;
            var priority = tri[o + 12];
            var better;
            if(best < 0) better = true;
            else if(Math.abs(y - bestY) <= 0.05) better = priority < bestPriority || (priority === bestPriority && y > bestY);
            else better = y > bestY;
            if(better) {
                best = o; bestY = y; bestPriority = priority;
                bestMesh = t;
            }
        }
        if(best < 0) return null;
        return { y: bestY, nx: tri[best + 9], ny: tri[best + 10], nz: tri[best + 11], surface: pitSurface(x, z, surfaces[tri[best + 13]]), mesh: meshes[meshOf[bestMesh]] };
    };
    var bestMesh = 0;

    // ---- the 3D side: all triangles in a 3D grid, for rays (the wheels) and spheres (the body)

    this.use3D = false;           // the physics uses the rays and the spheres, and not the one height per place
    var CELL3 = 4;
    var data3 = new Float32Array(12 * 1024);   // per triangle: the corner v0, the edges e1 and e2, the unit normal
    var box3 = new Float32Array(6 * 1024);     // the box around it
    var meta3 = new Int32Array(3 * 1024);      // the surface, the mesh, the priority and whether it is drivable (flag in bit 20)
    var count3 = 0;
    var grid3 = new Map();
    var stamp3 = new Int32Array(1024);
    var stampValue = 0;

    function cellKey(i, j, k) { return ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096); }

    function grow3() {
        var capacity = stamp3.length * 2;
        var d = new Float32Array(capacity * 12); d.set(data3); data3 = d;
        var b = new Float32Array(capacity * 6); b.set(box3); box3 = b;
        var m = new Int32Array(capacity * 3); m.set(meta3); meta3 = m;
        var st = new Int32Array(capacity); st.set(stamp3); stamp3 = st;
    }

    // A triangle of the track, in world coordinates, for the 3D side. drivable: the wheels can drive on it (else it is only for the body).
    this.addTriangle3D = function (x0, y0, z0, x1, y1, z1, x2, y2, z2, surface, mesh, priority, drivable) {
        var e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0, e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
        var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        var length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if(length < 1e-9) return;
        var minX = Math.min(x0, x1, x2), maxX = Math.max(x0, x1, x2), minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2), minZ = Math.min(z0, z1, z2), maxZ = Math.max(z0, z1, z2);
        var i0 = Math.floor(minX / CELL3), i1 = Math.floor(maxX / CELL3), j0 = Math.floor(minY / CELL3), j1 = Math.floor(maxY / CELL3), k0 = Math.floor(minZ / CELL3), k1 = Math.floor(maxZ / CELL3);
        if((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1) > 60000) return;     // a triangle as big as a country: not a part of a track
        if(count3 >= stamp3.length) grow3();
        var t = count3++;
        var o = t * 12;
        data3[o] = x0; data3[o + 1] = y0; data3[o + 2] = z0; data3[o + 3] = e1x; data3[o + 4] = e1y; data3[o + 5] = e1z;
        data3[o + 6] = e2x; data3[o + 7] = e2y; data3[o + 8] = e2z; data3[o + 9] = nx / length; data3[o + 10] = ny / length; data3[o + 11] = nz / length;
        var b = t * 6;
        box3[b] = minX; box3[b + 1] = minY; box3[b + 2] = minZ; box3[b + 3] = maxX; box3[b + 4] = maxY; box3[b + 5] = maxZ;
        meta3[t * 3] = surfaceIndex(surface); meta3[t * 3 + 1] = meshIndex(mesh); meta3[t * 3 + 2] = (priority || 0) | (drivable ? (1 << 20) : 0);
        for(var i = i0; i <= i1; i++) {
            for(var j = j0; j <= j1; j++) {
                for(var k = k0; k <= k1; k++) {
                    var key = cellKey(i, j, k);
                    var list = grid3.get(key);
                    if(!list) { list = []; grid3.set(key, list); }
                    list.push(t);
                }
            }
        }
    };

    // The corners of triangle t of the 3D side into out (nine numbers)
    this.vertices = function (t, out) {
        var o = t * 12;
        out[0] = data3[o]; out[1] = data3[o + 1]; out[2] = data3[o + 2];
        out[3] = data3[o] + data3[o + 3]; out[4] = data3[o + 1] + data3[o + 4]; out[5] = data3[o + 2] + data3[o + 5];
        out[6] = data3[o] + data3[o + 6]; out[7] = data3[o + 1] + data3[o + 7]; out[8] = data3[o + 2] + data3[o + 8];
        return out;
    };

    this.count3D = function () { return count3; };
    this.isDrivable = function (t) { return (meta3[t * 3 + 2] & (1 << 20)) !== 0; };
    this.surfaceOf = function (t) { return surfaces[meta3[t * 3]]; };
    this.meshOf = function (t) { return meshes[meta3[t * 3 + 1]]; };

    // The nearest drivable surface along a ray (a direction of unit length), not further than maxT. The side of the triangle that faces the
    // ray counts (a road is the same road from both sides); a hit that is nearly along the surface (the cosine between the ray and the
    // normal is less than minFacing) is no road. Where several surfaces are at about the same distance (a road over grass) the one with
    // the lowest priority is taken. Gives { t, x, y, z, nx, ny, nz, surface, mesh } (the normal faces the ray), or null.
    // what the simulation asks of the triangles, counted per frame (Scene.js shows it in the debug text and resets it): rays and the triangles they test, the spheres of the
    // shell (nearby) and the triangles they bring, the exact tests (closest), and the most triangles that one ray tested (a ray through a thick bundle of triangles is the lag)
    this.stats = { rays: 0, rayTris: 0, rayMax: 0, nearby: 0, nearbyTris: 0, closest: 0, boxes: 0 };
    var stats = this.stats;
    this.ray = function (ox, oy, oz, dx, dy, dz, maxT, minFacing) {
        if(!count3) return null;
        stats.rays++;
        var rayStart = stats.rayTris;
        minFacing = minFacing === undefined ? 0.17 : minFacing;
        var ex = ox + dx * maxT, ey = oy + dy * maxT, ez = oz + dz * maxT;
        var i0 = Math.floor(Math.min(ox, ex) / CELL3), i1 = Math.floor(Math.max(ox, ex) / CELL3);
        var j0 = Math.floor(Math.min(oy, ey) / CELL3), j1 = Math.floor(Math.max(oy, ey) / CELL3);
        var k0 = Math.floor(Math.min(oz, ez) / CELL3), k1 = Math.floor(Math.max(oz, ez) / CELL3);
        stampValue++;
        var best = -1, bestT = Infinity, bestPriority = 1e9;
        for(var i = i0; i <= i1; i++) {
            for(var j = j0; j <= j1; j++) {
                for(var k = k0; k <= k1; k++) {
                    var list = grid3.get(cellKey(i, j, k));
                    if(!list) continue;
                    for(var q = 0; q < list.length; q++) {
                        var t = list[q];
                        if(stamp3[t] === stampValue) continue;
                        stamp3[t] = stampValue;
                        stats.rayTris++;
                        var m = t * 3 + 2;
                        if((meta3[m] & (1 << 20)) === 0) continue;
                        var o = t * 12;
                        var nx = data3[o + 9], ny = data3[o + 10], nz = data3[o + 11];
                        var facing = -(nx * dx + ny * dy + nz * dz);
                        if(facing < 0) facing = -facing;
                        if(facing < minFacing) continue;
                        // Moller-Trumbore, for the two sides
                        var e1x = data3[o + 3], e1y = data3[o + 4], e1z = data3[o + 5], e2x = data3[o + 6], e2y = data3[o + 7], e2z = data3[o + 8];
                        var px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
                        var det = e1x * px + e1y * py + e1z * pz;
                        if(det > -1e-12 && det < 1e-12) continue;
                        var inv = 1 / det;
                        var tx = ox - data3[o], ty = oy - data3[o + 1], tz = oz - data3[o + 2];
                        var u = (tx * px + ty * py + tz * pz) * inv;
                        if(u < -1e-6 || u > 1 + 1e-6) continue;
                        var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
                        var v = (dx * qx + dy * qy + dz * qz) * inv;
                        if(v < -1e-6 || u + v > 1 + 1e-6) continue;
                        var hitT = (e2x * qx + e2y * qy + e2z * qz) * inv;
                        if(hitT < 0 || hitT > maxT) continue;
                        var priority = meta3[m] & 0xfffff;
                        var better;
                        if(best < 0) better = true;
                        else if(Math.abs(hitT - bestT) <= 0.05) better = priority < bestPriority || (priority === bestPriority && hitT < bestT);
                        else better = hitT < bestT;
                        if(better) { best = t; bestT = hitT; bestPriority = priority; }
                    }
                }
            }
        }
        if(stats.rayTris - rayStart > stats.rayMax) stats.rayMax = stats.rayTris - rayStart;
        if(best < 0) return null;
        var ob = best * 12;
        var bnx = data3[ob + 9], bny = data3[ob + 10], bnz = data3[ob + 11];
        if(bnx * dx + bny * dy + bnz * dz > 0) { bnx = -bnx; bny = -bny; bnz = -bnz; }
        return { t: bestT, x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT, nx: bnx, ny: bny, nz: bnz,
            surface: pitSurface(ox + dx * bestT, oz + dz * bestT, surfaces[meta3[best * 3]]), mesh: meshes[meta3[best * 3 + 1]] };
    };

    // How far along a ray (a direction of unit length) the first triangle of any kind is (the road, a kerb, a wall, a fence; from both sides), not further than
    // maxT; gives Infinity when there is none. For the camera: it must not go through a wall.
    this.firstHit = function (ox, oy, oz, dx, dy, dz, maxT) {
        if(!count3) return Infinity;
        var ex = ox + dx * maxT, ey = oy + dy * maxT, ez = oz + dz * maxT;
        var i0 = Math.floor(Math.min(ox, ex) / CELL3), i1 = Math.floor(Math.max(ox, ex) / CELL3);
        var j0 = Math.floor(Math.min(oy, ey) / CELL3), j1 = Math.floor(Math.max(oy, ey) / CELL3);
        var k0 = Math.floor(Math.min(oz, ez) / CELL3), k1 = Math.floor(Math.max(oz, ez) / CELL3);
        stampValue++;
        var bestT = Infinity;
        for(var i = i0; i <= i1; i++) {
            for(var j = j0; j <= j1; j++) {
                for(var k = k0; k <= k1; k++) {
                    var list = grid3.get(cellKey(i, j, k));
                    if(!list) continue;
                    for(var q = 0; q < list.length; q++) {
                        var t = list[q];
                        if(stamp3[t] === stampValue) continue;
                        stamp3[t] = stampValue;
                        var o = t * 12;
                        var e1x = data3[o + 3], e1y = data3[o + 4], e1z = data3[o + 5], e2x = data3[o + 6], e2y = data3[o + 7], e2z = data3[o + 8];
                        var px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
                        var det = e1x * px + e1y * py + e1z * pz;
                        if(det > -1e-12 && det < 1e-12) continue;
                        var inv = 1 / det;
                        var tx = ox - data3[o], ty = oy - data3[o + 1], tz = oz - data3[o + 2];
                        var u = (tx * px + ty * py + tz * pz) * inv;
                        if(u < -1e-6 || u > 1 + 1e-6) continue;
                        var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
                        var v = (dx * qx + dy * qy + dz * qz) * inv;
                        if(v < -1e-6 || u + v > 1 + 1e-6) continue;
                        var hitT = (e2x * qx + e2y * qy + e2z * qz) * inv;
                        if(hitT >= 0 && hitT < bestT && hitT <= maxT) bestT = hitT;
                    }
                }
            }
        }
        return bestT;
    };

    // The triangles (all, drivable or not) whose box touches a sphere, as a list of numbers in out
    this.nearby = function (cx, cy, cz, radius, out) {
        out.length = 0;
        stats.nearby++;
        var i0 = Math.floor((cx - radius) / CELL3), i1 = Math.floor((cx + radius) / CELL3);
        var j0 = Math.floor((cy - radius) / CELL3), j1 = Math.floor((cy + radius) / CELL3);
        var k0 = Math.floor((cz - radius) / CELL3), k1 = Math.floor((cz + radius) / CELL3);
        stampValue++;
        for(var i = i0; i <= i1; i++) {
            for(var j = j0; j <= j1; j++) {
                for(var k = k0; k <= k1; k++) {
                    var list = grid3.get(cellKey(i, j, k));
                    if(!list) continue;
                    for(var q = 0; q < list.length; q++) {
                        var t = list[q];
                        if(stamp3[t] === stampValue) continue;
                        stamp3[t] = stampValue;
                        var b = t * 6;
                        if(box3[b] > cx + radius || box3[b + 3] < cx - radius || box3[b + 1] > cy + radius || box3[b + 4] < cy - radius || box3[b + 2] > cz + radius || box3[b + 5] < cz - radius) continue;
                        out.push(t);
                    }
                }
            }
        }
        stats.nearbyTris += out.length;
        return out;
    };

    // Is the sphere (c, r) near the box of triangle t? (a cheap test before the exact one)
    this.boxNear = function (t, cx, cy, cz, r) {
        stats.boxes++;
        var b = t * 6;
        return !(box3[b] > cx + r || box3[b + 3] < cx - r || box3[b + 1] > cy + r || box3[b + 4] < cy - r || box3[b + 2] > cz + r || box3[b + 5] < cz - r);
    };

    // The point of triangle t that is nearest to p: into out as { x, y, z }; gives the squared distance
    this.closest = function (t, px, py, pz, out) {
        stats.closest++;
        var o = t * 12;
        var ax = data3[o], ay = data3[o + 1], az = data3[o + 2];
        var abx = data3[o + 3], aby = data3[o + 4], abz = data3[o + 5], acx = data3[o + 6], acy = data3[o + 7], acz = data3[o + 8];
        var apx = px - ax, apy = py - ay, apz = pz - az;
        var d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
        var rx, ry, rz, region = 2;
        if(d1 <= 0 && d2 <= 0) { rx = ax; ry = ay; rz = az; }
        else {
            var bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
            var d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
            if(d3 >= 0 && d4 <= d3) { rx = ax + abx; ry = ay + aby; rz = az + abz; }
            else {
                var vc = d1 * d4 - d3 * d2;
                if(vc <= 0 && d1 >= 0 && d3 <= 0) { var vv = d1 / (d1 - d3); rx = ax + abx * vv; ry = ay + aby * vv; rz = az + abz * vv; region = 1; }
                else {
                    var cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
                    var d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
                    if(d6 >= 0 && d5 <= d6) { rx = ax + acx; ry = ay + acy; rz = az + acz; }
                    else {
                        var vb = d5 * d2 - d1 * d6;
                        if(vb <= 0 && d2 >= 0 && d6 <= 0) { var ww = d2 / (d2 - d6); rx = ax + acx * ww; ry = ay + acy * ww; rz = az + acz * ww; region = 1; }
                        else {
                            var va = d3 * d6 - d5 * d4;
                            if(va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
                                var w2 = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                                rx = ax + abx + (acx - abx) * w2; ry = ay + aby + (acy - aby) * w2; rz = az + abz + (acz - abz) * w2; region = 1;
                            } else {
                                var denom = 1 / (va + vb + vc), v2 = vb * denom, w3 = vc * denom;
                                rx = ax + abx * v2 + acx * w3; ry = ay + aby * v2 + acy * w3; rz = az + abz * v2 + acz * w3; region = 0;
                            }
                        }
                    }
                }
            }
        }
        out.x = rx; out.y = ry; out.z = rz; out.region = region;
        var dx = px - rx, dy = py - ry, dz = pz - rz;
        return dx * dx + dy * dy + dz * dz;
    };

    // the corners of triangle t into out (9 numbers), for the debug view
    this.corners = function (t, out) {
        var o = t * 12;
        out[0] = data3[o]; out[1] = data3[o + 1]; out[2] = data3[o + 2];
        out[3] = data3[o] + data3[o + 3]; out[4] = data3[o + 1] + data3[o + 4]; out[5] = data3[o + 2] + data3[o + 5];
        out[6] = data3[o] + data3[o + 6]; out[7] = data3[o + 1] + data3[o + 7]; out[8] = data3[o + 2] + data3[o + 8];
        return out;
    };
    this.normalOf = function (t, out) { var o = t * 12; out.x = data3[o + 9]; out.y = data3[o + 10]; out.z = data3[o + 11]; };

    // How far a line (through p, in the direction u of unit length) runs inside triangle t, as a range of distances along it: the top of a
    // wall above a point of it is the upper end. Gives [low, high] in out, or false when the line misses the triangle.
    this.lineRange = function (t, px, py, pz, ux, uy, uz, out) {
        var o = t * 12;
        var e1x = data3[o + 3], e1y = data3[o + 4], e1z = data3[o + 5], e2x = data3[o + 6], e2y = data3[o + 7], e2z = data3[o + 8];
        var d00 = e1x * e1x + e1y * e1y + e1z * e1z, d01 = e1x * e2x + e1y * e2y + e1z * e2z, d11 = e2x * e2x + e2y * e2y + e2z * e2z;
        var denom = d00 * d11 - d01 * d01;
        if(denom < 1e-12) return false;
        var wx = px - data3[o], wy = py - data3[o + 1], wz = pz - data3[o + 2];
        var a20 = wx * e1x + wy * e1y + wz * e1z, a21 = wx * e2x + wy * e2y + wz * e2z;
        var b20 = ux * e1x + uy * e1y + uz * e1z, b21 = ux * e2x + uy * e2y + uz * e2z;
        // the two barycentric coordinates are linear in the distance s: l = a + b s
        var l1a = (d11 * a20 - d01 * a21) / denom, l1b = (d11 * b20 - d01 * b21) / denom;
        var l2a = (d00 * a21 - d01 * a20) / denom, l2b = (d00 * b21 - d01 * b20) / denom;
        var low = -1e9, high = 1e9;
        // l1 >= 0, l2 >= 0, 1 - l1 - l2 >= 0
        var cons = [[l1a, l1b], [l2a, l2b], [1 - l1a - l2a, -l1b - l2b]];
        for(var c = 0; c < 3; c++) {
            var a = cons[c][0], b = cons[c][1];
            if(Math.abs(b) < 1e-9) { if(a < 0) return false; }
            else if(b > 0) low = Math.max(low, -a / b);
            else high = Math.min(high, -a / b);
        }
        if(low > high) return false;
        out[0] = low; out[1] = high;
        return true;
    };
};

// A flat road at one height with the interface of the GroundWorld of a track (3D): for the test benches (the car editor, tools/physics-bench.js), where the
// tyre bodies need triangles. One triangle, as big as the world, at height y; everything is "road".
OpenRacer.FlatGround = function (y, surface) {
    var Y = y || 0, name = surface || "road", big = 1e5;
    this.use3D = true;
    this.nearby = function (cx, cy, cz, radius, out) { out.length = 0; if(Math.abs(cy - Y) <= radius + 2) out.push(0); };
    this.boxNear = function (t, cx, cy, cz, r) { return Math.abs(cy - Y) <= r; };
    this.closest = function (t, px, py, pz, out) { out.x = px; out.y = Y; out.z = pz; out.region = 0; return (py - Y) * (py - Y); };
    this.normalOf = function (t, out) { out.x = 0; out.y = 1; out.z = 0; };
    this.surfaceOf = function () { return name; };
    this.meshOf = function () { return ""; };
    this.ray = function (ox, oy, oz, dx, dy, dz, maxT) { if(dy >= -1e-6) return null; var t = (oy - Y) / -dy; if(t < 0 || t > maxT) return null; return { t: t, y: Y, nx: 0, ny: 1, nz: 0, surface: name, mesh: "", triangle: 0 }; };
    this.query = function () { return { y: Y, nx: 0, ny: 1, nz: 0, surface: name, mesh: "" }; };
    // (a line through a point of the floor runs inside it as far as it goes: the floor is never a low wall)
    this.lineRange = function (t, px, py, pz, ux, uy, uz, out) { out[0] = -big; out[1] = big; return true; };
    // the one triangle, as big as the world (a part that falls on the floor, Parts.js; the marbles)
    this.vertices = function (t, out) { out[0] = -big; out[1] = Y; out[2] = -big; out[3] = big; out[4] = Y; out[5] = -big; out[6] = 0; out[7] = Y; out[8] = big; return out; };
    // how far a ray goes before the floor (Infinity when it does not reach it)
    this.firstHit = function (ox, oy, oz, dx, dy, dz, maxT) { if(Math.abs(dy) < 1e-9) return Infinity; var t = (Y - oy) / dy; return t >= 0 && t <= maxT ? t : Infinity; };
    this.setHeight = function (h) { Y = h; };
};
