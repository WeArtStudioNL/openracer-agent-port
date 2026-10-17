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
    "road": { static: 1.1, kinetic: 0.98 },
    "track01": { static: 0.95, kinetic: 0.85 },
    "grass": { static: 0.4, kinetic: 0.33 },
    "ground": { static: 0.5, kinetic: 0.42 }
};

function getSurface(name) {
    return uCoeff[name] || uCoeff["track01"];
}

// Converts a model in the old three.js JSON format (version 3, as exported from 3ds Max) to a
// BufferGeometry. Vertices stay shared between the faces, so the normals are smooth, and the faces
// are grouped by material so that a mesh can take an array of materials.
function parseLegacyModel(json) {
    var scale = json.scale !== undefined ? json.scale : 1;
    var vertices = json.vertices;
    var normals = json.normals || [];
    var faces = json.faces;
    var materialCount = json.materials ? Math.max(1, json.materials.length) : 1;
    var positions = new Float32Array(vertices.length);
    for(var v = 0; v < vertices.length; v++) positions[v] = vertices[v] * scale;

    // triangles per material
    var perMaterial = [];
    for(var m = 0; m < materialCount; m++) perMaterial.push([]);

    var hasUv = json.uvs && json.uvs[0] && json.uvs[0].length > 0;
    var offset = 0;
    while(offset < faces.length) {
        var type = faces[offset++];
        var isQuad = (type & 1) !== 0;
        var hasMaterial = (type & 2) !== 0;
        var hasFaceUv = (type & 4) !== 0;
        var hasFaceVertexUv = (type & 8) !== 0;
        var hasFaceNormal = (type & 16) !== 0;
        var hasFaceVertexNormal = (type & 32) !== 0;
        var hasFaceColor = (type & 64) !== 0;
        var hasFaceVertexColor = (type & 128) !== 0;
        var count = isQuad ? 4 : 3;

        var idx = [];
        for(var i = 0; i < count; i++) idx.push(faces[offset++]);
        var material = 0;
        if(hasMaterial) material = faces[offset++];
        if(hasFaceUv) offset += hasUv ? 1 : 0;
        if(hasFaceVertexUv) offset += hasUv ? count : 0;
        if(hasFaceNormal) offset += 1;
        if(hasFaceVertexNormal) offset += count;
        if(hasFaceColor) offset += 1;
        if(hasFaceVertexColor) offset += count;

        if(material >= perMaterial.length) material = 0;
        perMaterial[material].push(idx[0], idx[1], idx[2]);
        if(isQuad) perMaterial[material].push(idx[0], idx[2], idx[3]);
    }

    var total = 0;
    for(var k = 0; k < perMaterial.length; k++) total += perMaterial[k].length;
    var indices = new Uint32Array(total);
    var geometry = new THREE.BufferGeometry();
    var start = 0;
    for(var g = 0; g < perMaterial.length; g++) {
        indices.set(perMaterial[g], start);
        if(perMaterial[g].length > 0) geometry.addGroup(start, perMaterial[g].length, g);
        start += perMaterial[g].length;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
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
