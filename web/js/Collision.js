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
 * Collision.js
 *
 * Description: What the car can drive into. The steep triangles of the track (walls, fences, buildings,
 *              cliffs) are kept as outlines on the ground plane, with the height they span, in a grid
 *              so that only the few near the car are looked at. The car is a rectangle on the ground
 *              plane; where the rectangle overlaps an outline there is a contact, with the direction
 *              to push the car out, how deep it is and where. No 3D dependencies.
 */

OpenRacer.CollisionWorld = function (cellSize) {
    cellSize = cellSize || 10;
    var ax = [], az = [], bx = [], bz = [], cx = [], cz = [], ymin = [], ymax = [];
    var cells = {};
    var stamp = 0;       // marks the triangles that were already looked at in one query
    var seen = [];

    // A triangle of a wall, with the world coordinates of its corners
    this.addTriangle = function (x0, y0, z0, x1, y1, z1, x2, y2, z2) {
        var index = ax.length;
        ax.push(x0); az.push(z0);
        bx.push(x1); bz.push(z1);
        cx.push(x2); cz.push(z2);
        ymin.push(Math.min(y0, y1, y2));
        ymax.push(Math.max(y0, y1, y2));
        var minX = Math.floor(Math.min(x0, x1, x2) / cellSize);
        var maxX = Math.floor(Math.max(x0, x1, x2) / cellSize);
        var minZ = Math.floor(Math.min(z0, z1, z2) / cellSize);
        var maxZ = Math.floor(Math.max(z0, z1, z2) / cellSize);
        for(var i = minX; i <= maxX; i++) {
            for(var j = minZ; j <= maxZ; j++) {
                var key = i + "," + j;
                if(!cells[key]) cells[key] = [];
                cells[key].push(index);
            }
        }
        seen.push(0);
    };

    this.count = function () {
        return ax.length;
    };

    // Contacts of a rectangle with the walls. The rectangle has its centre at (x, z), its length along
    // (cos psi, sin psi), half sizes halfLength and halfWidth, and spans the heights yLow..yHigh.
    // Each contact: nx, nz (unit vector that pushes the car out of the wall), depth, px, pz (where the car
    // is deepest in the wall). The contact with the deepest overlap comes first.
    this.query = function (x, z, psi, halfLength, halfWidth, yLow, yHigh) {
        var contacts = [];
        var ux = Math.cos(psi), uz = Math.sin(psi);   // along the car
        var wx = -uz, wz = ux;                        // across the car
        var reach = Math.sqrt(halfLength * halfLength + halfWidth * halfWidth);
        stamp++;
        var minX = Math.floor((x - reach) / cellSize), maxX = Math.floor((x + reach) / cellSize);
        var minZ = Math.floor((z - reach) / cellSize), maxZ = Math.floor((z + reach) / cellSize);
        var corners = [
            [x + ux * halfLength + wx * halfWidth, z + uz * halfLength + wz * halfWidth],
            [x + ux * halfLength - wx * halfWidth, z + uz * halfLength - wz * halfWidth],
            [x - ux * halfLength - wx * halfWidth, z - uz * halfLength - wz * halfWidth],
            [x - ux * halfLength + wx * halfWidth, z - uz * halfLength + wz * halfWidth]
        ];
        for(var i = minX; i <= maxX; i++) {
            for(var j = minZ; j <= maxZ; j++) {
                var list = cells[i + "," + j];
                if(!list) continue;
                for(var k = 0; k < list.length; k++) {
                    var t = list[k];
                    if(seen[t] === stamp) continue;
                    seen[t] = stamp;
                    // only walls that reach into the height of the car
                    if(ymax[t] < yLow || ymin[t] > yHigh) continue;
                    var contact = overlap(t, x, z, ux, uz, wx, wz, halfLength, halfWidth, corners);
                    if(contact) contacts.push(contact);
                }
            }
        }
        contacts.sort(function (a, b) { return b.depth - a.depth; });
        return contacts;
    };

    // Separating axis test of the car rectangle and one triangle on the ground plane
    function overlap(t, x, z, ux, uz, wx, wz, hl, hw, corners) {
        var tx = [ax[t], bx[t], cx[t]];
        var tz = [az[t], bz[t], cz[t]];
        // quick rejection: the triangle against the box around the car
        var reach = Math.abs(ux) * hl + Math.abs(wx) * hw;
        var reachZ = Math.abs(uz) * hl + Math.abs(wz) * hw;
        if(Math.max(tx[0], tx[1], tx[2]) < x - reach || Math.min(tx[0], tx[1], tx[2]) > x + reach) return null;
        if(Math.max(tz[0], tz[1], tz[2]) < z - reachZ || Math.min(tz[0], tz[1], tz[2]) > z + reachZ) return null;

        var axes = [ux, uz, wx, wz];
        for(var e = 0; e < 3; e++) {
            var ex = tx[(e + 1) % 3] - tx[e];
            var ez = tz[(e + 1) % 3] - tz[e];
            var len = Math.sqrt(ex * ex + ez * ez);
            if(len > 1e-6) axes.push(-ez / len, ex / len);
        }

        var bestDepth = Infinity, bestX = 0, bestZ = 0;
        for(var a = 0; a < axes.length; a += 2) {
            var axx = axes[a], azz = axes[a + 1];
            var centre = x * axx + z * azz;
            var radius = hl * Math.abs(ux * axx + uz * azz) + hw * Math.abs(wx * axx + wz * azz);
            var tmin = Infinity, tmax = -Infinity;
            for(var v = 0; v < 3; v++) {
                var p = tx[v] * axx + tz[v] * azz;
                if(p < tmin) tmin = p;
                if(p > tmax) tmax = p;
            }
            var d1 = centre + radius - tmin;   // how far the car reaches into the triangle from the low side
            var d2 = tmax - (centre - radius); // and from the high side
            if(d1 <= 0 || d2 <= 0) return null; // a gap: no contact
            if(d1 < bestDepth) { bestDepth = d1; bestX = -axx; bestZ = -azz; }
            if(d2 < bestDepth) { bestDepth = d2; bestX = axx; bestZ = azz; }
        }

        // the corner(s) of the car that are deepest in the wall
        var deepest = -Infinity;
        for(var c = 0; c < 4; c++) {
            var depthC = -(corners[c][0] * bestX + corners[c][1] * bestZ);
            if(depthC > deepest) deepest = depthC;
        }
        var px = 0, pz = 0, n = 0;
        for(var c2 = 0; c2 < 4; c2++) {
            if(-(corners[c2][0] * bestX + corners[c2][1] * bestZ) > deepest - 0.05) {
                px += corners[c2][0];
                pz += corners[c2][1];
                n++;
            }
        }
        return { nx: bestX, nz: bestZ, depth: bestDepth, px: px / n, pz: pz / n };
    }
};
