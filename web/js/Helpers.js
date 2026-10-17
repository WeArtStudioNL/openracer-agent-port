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
 * Helpers.js
 * 
 * Author: Chris Barnard
 * Description: Helper functions that do not have a home at present.
 * Notes: It should be considered that the majority of what ends up here is
 *        only here temporarily until it is worked into the main structure.
 *        However, in the case of often-called variables and functions, having
 *        them available statically without instantiating a class can be useful.
 */

var gravity = 9.81;
var air_density = 1.29;
var piOver2 = Math.PI / 2;
var lastTerrain;

function getSign(x) {
    return x > 0 ? 1 : x === 0 ? 0 : -1;
}

function endsWith(str, suffix) {
    return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

// Textures that can be driven on
var drivableTextures = { "road": true, "grass": true, "ground": true, "track01": true };

var groundRay = new THREE.Raycaster();
var groundDown = new THREE.Vector3(0, -1, 0);
var groundOrigin = new THREE.Vector3();

// The meshes of a group of track objects whose bounding sphere is above (x, z)
function meshesAbove(x, z, objArray) {
    var found = [];
    for(var i = 0; i < objArray.length; i++) {
        var sphere = objArray[i].geometry.boundingSphere;
        var dx = x - (objArray[i].position.x + sphere.center.x);
        var dz = z - (objArray[i].position.z + sphere.center.z);
        if(dx * dx + dz * dz <= sphere.radius * sphere.radius) found.push(objArray[i]);
    }
    return found;
}

// Finds the road under (x, z): its height, the texture it is made of and the name of the mesh.
// hintY is roughly where the car is; the road is looked for from just above it, and then from
// higher up in case the car has ended up under the road. Returns null if there is no road there.
function getGroundAt(x, z, hintY) {
    var starts = [hintY + 3, hintY + 60, hintY + 2000];
    for(var s = 0; s < starts.length; s++) {
        groundOrigin.set(x, starts[s], z);
        groundRay.set(groundOrigin, groundDown);
        for(var i = 0; i < searchOrder.length; i++) {
            var meshes = meshesAbove(x, z, trackObjects[searchOrder[i]]);
            if(meshes.length === 0) continue;
            var hits = groundRay.intersectObjects(meshes, false);
            for(var h = 0; h < hits.length; h++) {
                var texture = hits[h].object.material.map.name;
                if(drivableTextures[texture]) {
                    return { y: hits[h].point.y, surface: texture, mesh: hits[h].object.name };
                }
            }
        }
    }
    return null;
}

// Friction of the surfaces: the grip at the peak of the tyre curve (static) and while sliding (kinetic).
var uCoeff = {
    "road": { static: 1.05, kinetic: 0.88 },
    "track01": { static: 0.9, kinetic: 0.78 },
    "grass": { static: 0.4, kinetic: 0.33 },
    "ground": { static: 0.5, kinetic: 0.42 }
};

function getSurface(name) {
    return uCoeff[name] || uCoeff["track01"];
}

var dO = document.getElementById("debugOut");
var debugText = "";
//var debugCount = 0;

function debugOut(text) {
    debugText += text + "\r\n";
    //console.log(text);
    //dO.innerText += text + "\r\n";
}

function debugClear() {
    //debugCount++;
    //if(debugCount > 10) {
        dO.innerText = debugText;
    //    debugCount = 0;
    //}
    //var dO = document.getElementById("debugOut");
    //dO.innerText = "";
    debugText = "";
}
