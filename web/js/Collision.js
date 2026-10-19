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
 *
 *              A wall only counts where the car is lower than its top: the height of the wall at the point of the contact is
 *              compared with the underside of the car at that point (the car can be tilted on a ramp, with its nose over the
 *              edge of the ramp: that edge is then not a wall).
 */

OpenRacer.CollisionWorld = function (cellSize) {
    cellSize = cellSize || 10;
    var ax = [], az = [], bx = [], bz = [], cx = [], cz = [], ay = [], by = [], cy = [], ymin = [], ymax = [];
    var cells = {};
    var stamp = 0;       // marks the triangles that were already looked at in one query
    var seen = [];

    // A triangle of a wall, with the world coordinates of its corners
    this.addTriangle = function (x0, y0, z0, x1, y1, z1, x2, y2, z2) {
        var index = ax.length;
        ax.push(x0); az.push(z0);
        bx.push(x1); bz.push(z1);
        cx.push(x2); cz.push(z2);
        ay.push(y0); by.push(y1); cy.push(y2);
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
    // body (optional): { bottomAt(x, z): the height of the underside of the car there, height: of the body, kerb: what is driven over }.
    // With it a wall is tested against the car where it touches, and yLow and yHigh are only the first, rough, selection.
    this.query = function (x, z, psi, halfLength, halfWidth, yLow, yHigh, body) {
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
        if(body) {
            var low = Infinity, high = -Infinity;
            for(var q = 0; q < 4; q++) {
                var b = body.bottomAt(corners[q][0], corners[q][1]);
                if(b < low) low = b;
                if(b > high) high = b;
            }
            yLow = low + body.kerb;
            yHigh = high + body.height;
        }
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
                    if(contact && body) {
                        // the wall where the car touches it, against the underside of the car there
                        var range = wallRange(t, contact.px, contact.pz);
                        var under = body.bottomAt(contact.px, contact.pz);
                        if(range[1] < under + body.kerb || range[0] > under + body.height) continue;
                    }
                    if(contact) contacts.push(contact);
                }
            }
        }
        contacts.sort(function (a, b) { return b.depth - a.depth; });
        return contacts;
    };

    // The lowest and the highest height of triangle t above the point (px, pz) of the ground plane. A wall is vertical, so its
    // footprint is a line: then the heights are those of the triangle on the vertical line through that point of the line.
    function wallRange(t, px, pz) {
        var x0 = ax[t], z0 = az[t], x1 = bx[t], z1 = bz[t], x2 = cx[t], z2 = cz[t];
        var area = (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0);
        if(Math.abs(area) > 1e-3) {
            // a slanted triangle: the height of its plane
            var l1 = ((x1 - px) * (z2 - pz) - (z1 - pz) * (x2 - px)) / area;
            var l2 = ((x2 - px) * (z0 - pz) - (z2 - pz) * (x0 - px)) / area;
            var l3 = 1 - l1 - l2;
            var y = l1 * ay[t] + l2 * by[t] + l3 * cy[t];
            return [y, y];
        }
        var xs = [x0, x1, x2], zs = [z0, z1, z2], ys = [ay[t], by[t], cy[t]];
        // the direction of the line: between its two furthest corners
        var best = -1, di = 0, dj = 1;
        for(var i = 0; i < 3; i++) {
            for(var j = i + 1; j < 3; j++) {
                var d = (xs[i] - xs[j]) * (xs[i] - xs[j]) + (zs[i] - zs[j]) * (zs[i] - zs[j]);
                if(d > best) { best = d; di = i; dj = j; }
            }
        }
        if(best < 1e-12) return [Math.min(ys[0], ys[1], ys[2]), Math.max(ys[0], ys[1], ys[2])];
        var len = Math.sqrt(best);
        var dx = (xs[dj] - xs[di]) / len, dz = (zs[dj] - zs[di]) / len;
        var s = [0, 0, 0];
        for(var k = 0; k < 3; k++) s[k] = (xs[k] - xs[di]) * dx + (zs[k] - zs[di]) * dz;
        var sp = (px - xs[di]) * dx + (pz - zs[di]) * dz;
        var smin = Math.min(s[0], s[1], s[2]), smax = Math.max(s[0], s[1], s[2]);
        sp = Math.max(smin, Math.min(smax, sp));
        var lo = Infinity, hi = -Infinity;
        for(var e = 0; e < 3; e++) {
            var f = (e + 1) % 3;
            var s1 = s[e], s2 = s[f];
            if(Math.abs(s1 - s2) < 1e-9) {
                // an upright edge: all of its heights are above this point, when the point is on it
                if(Math.abs(sp - s1) < 1e-6) {
                    lo = Math.min(lo, ys[e], ys[f]);
                    hi = Math.max(hi, ys[e], ys[f]);
                }
            } else if(sp >= Math.min(s1, s2) - 1e-9 && sp <= Math.max(s1, s2) + 1e-9) {
                var yy = ys[e] + (ys[f] - ys[e]) * (sp - s1) / (s2 - s1);
                lo = Math.min(lo, yy);
                hi = Math.max(hi, yy);
            }
        }
        if(lo === Infinity) return [Math.min(ys[0], ys[1], ys[2]), Math.max(ys[0], ys[1], ys[2])];
        return [lo, hi];
    }

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
