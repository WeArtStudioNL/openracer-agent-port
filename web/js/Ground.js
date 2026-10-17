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
 */

OpenRacer.GroundWorld = function (cellSize) {
    cellSize = cellSize || 5;
    var tri = [];            // per triangle: x0, z0, x1, z1, x2, z2, y0, y1, y2, nx, ny, nz, priority, surface index
    var surfaces = [];       // names of the surfaces
    var meshes = [];         // names of the meshes
    var meshOf = [];
    var cells = {};

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
        return { y: bestY, nx: tri[best + 9], ny: tri[best + 10], nz: tri[best + 11], surface: surfaces[tri[best + 13]], mesh: meshes[meshOf[bestMesh]] };
    };
    var bestMesh = 0;
};
