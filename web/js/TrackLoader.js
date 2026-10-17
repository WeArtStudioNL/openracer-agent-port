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
 * TrackLoader.js
 * 
 * Author: Chris Barnard
 * Description: Loads a track from a JSON file.
 * Notes: Currently, I followed the file format set out by HelloEnjoy's
 *        HelloRacer demo (http://helloracer.com/racer-s/). The intention would
 *        be to build our own track format, but since we don't currently have
 *        any track creation tools, it seems sensible to start with a
 *        pre-existing format.
 */

var xmlhttp = new XMLHttpRequest();
var circuitObjects;
//var trackObjects = [];
//var groundObjects = [];
//var otherObjects = [];
var trackObjects = { track: [], grass: [], ground: [], other: [] };
var searchOrder = ["track", "grass", "ground", "other"];
var trackCheckPoints = [];   // names of the road pieces that make a lap, from the track
var currentTrack = null;     // the track that is loaded (see tracks/<id>/track.json)
var trackBase = "";          // the folder of the track

var trackLoadedCallback;
var textureLoader = new THREE.TextureLoader();

// Loads a track from its configuration (the contents of tracks/<id>/track.json, with its id)
function loadTrack(track, tlCallback) {
    currentTrack = track;
    trackBase = "tracks/" + track.id + "/";
    trackCheckPoints = track.checkpoints || [];
    trackLoadedCallback = tlCallback;
    xmlhttp.onreadystatechange = function() {
        if (xmlhttp.readyState == 4 && xmlhttp.status == 200) {
            console.log("circuit loaded");
            var myArr = JSON.parse(xmlhttp.responseText);
            circuitObjects = myArr;
            loadScene();
        }
    }
    xmlhttp.open("GET", trackBase + track.geometry, true);
    xmlhttp.send();
}

function loadScene() {
    var xmlhttp = new XMLHttpRequest();
    var url = trackBase + currentTrack.scene;

    xmlhttp.onreadystatechange = function() {
        if (xmlhttp.readyState == 4 && xmlhttp.status == 200) {
            //console.log("scene loaded");
            var myArr = JSON.parse(xmlhttp.responseText);

            for(var obj in myArr) {
                //console.log(obj);
                if(obj == "transforms") {
                    for(var oIndex = 0; oIndex < myArr[obj].length; oIndex++) {
                        var objName = myArr[obj][oIndex].name;
                        //console.log("    " + objName);
                        //console.log(circuitObjects[objName]);
                        if(circuitObjects[objName]) {
                            //console.log("    Found " + objName);
                            var objectData = circuitObjects[objName];
                            var gotVerts = !!objectData.vertices;
                            var gotTris = !!objectData.tris;
                            var geometry = new THREE.BufferGeometry();
                            if(gotVerts && gotTris) {
                                var vertexCount = objectData.vertices.length / 3;
                                geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(objectData.vertices), 3));
                                var uvs = new Float32Array(vertexCount * 2);
                                if(objectData.uv1) {
                                    for(var u = 0; u < uvs.length; u++) uvs[u] = objectData.uv1[u] || 0;
                                }
                                geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
                                var indices = new Uint32Array(objectData.tris.length);
                                for(var i = 0; i < objectData.tris.length; i = i + 3) {
                                    // the faces are stored the other way around
                                    indices[i] = objectData.tris[i + 2];
                                    indices[i + 1] = objectData.tris[i + 1];
                                    indices[i + 2] = objectData.tris[i];
                                    if(objectData.tris[i] >= vertexCount || objectData.tris[i + 1] >= vertexCount || objectData.tris[i + 2] >= vertexCount) {
                                        console.log("warning - " + objName + " refers to a vertex that doesn't exist.");
                                    }
                                }
                                geometry.setIndex(new THREE.BufferAttribute(indices, 1));
                            }
                            if(gotVerts && gotTris) {
                                geometry.computeBoundingSphere();
                                var red = Math.round(Math.random() * 256);
                                var green = Math.round(Math.random() * 256);
                                var blue = Math.round(Math.random() * 256);
                                var mat = new THREE.MeshBasicMaterial( { color: red + 256 * green + 65536 * blue } )
                                if(myArr[obj][oIndex].renderer) {
                                    var matName = myArr[obj][oIndex].renderer;
                                    var textureName = myArr.materials[matName].colorTexture;
                                    var textureType = myArr.materials[matName].type;
                                    var shine = myArr.materials[matName].shininess;
                                    var specIntensity = myArr.materials[matName].specularIntensity;
                                    var textureOffset = myArr.materials[matName].textureOffset;
                                    var textureTile = myArr.materials[matName].textureTile;
                                    var textureFile = myArr.textures[textureName].file;
                                    //console.log("            material name: " + matName);
                                    //console.log("            texture name: " + textureName);
                                    //console.log("            texture file: " + textureFile);
                                    var texture = textureLoader.load( trackBase + currentTrack.textures + textureFile );
                                    texture.colorSpace = THREE.SRGBColorSpace;
                                    var bumpTexture;
                                    if(textureName === "road") {
                                        //console.log(myArr.textures[textureName]);
                                        //console.log(myArr.textures[textureName + "-specular"]);
                                        //console.log(myArr.textures["road-specular"]);
                                    }
                                    if(myArr.textures[textureName + "-bump"]) {
                                        //console.log("BUMP: " + myArr.textures[textureName + "-bump"].file);
                                        bumpTexture = textureLoader.load( trackBase + currentTrack.textures + myArr.textures[textureName + "-bump"].file );
                                    }
                                    //console.log("            textureTile: " + textureTile);
                                    if(textureTile) {
                                        //console.log("            setting wrapping " + textureTile[0] + " " + textureTile[1]);
                                        texture.wrapS = THREE.RepeatWrapping;
                                        texture.wrapT = THREE.RepeatWrapping;
                                        texture.repeat.set(textureTile[0], textureTile[1]);
                                        texture.offset.x = textureOffset[0];
                                        texture.offset.y = textureOffset[1];
                                        
                                        if(bumpTexture) {
                                            bumpTexture.wrapS = THREE.RepeatWrapping;
                                            bumpTexture.wrapT = THREE.RepeatWrapping;
                                            bumpTexture.repeat.set(textureTile[0], textureTile[1]);
                                            bumpTexture.offset.x = textureOffset[0];
                                            bumpTexture.offset.y = textureOffset[1];                                            
                                        }
                                    }

                                    var maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
                                    texture.anisotropy = maxAnisotropy;

                                    if(textureName === "road") {
                                        mat = new THREE.MeshPhongMaterial( { color: 0xffffff, map: texture, bumpMap: bumpTexture, bumpScale: 1 } );
                                    } else {
                                        mat = new THREE.MeshLambertMaterial( { color: 0xffffff, map: texture } );
                                    }
                                    mat.name = matName;
                                    texture.name = textureName;
                                    if(shine !== undefined && mat.isMeshPhongMaterial) mat.shininess = shine;
                                    if(endsWith(textureFile, ".png")) {
                                        mat.transparent = true;
                                    }

                                    //console.log("vert count = " + geometry.vertices.length);
                                    //console.log("uv1 count = " + geometry.faceVertexUvs[0].length);
                                    //console.log("uv2 count = " + geometry.faceVertexUvs[1].length);

                                    geometry.computeVertexNormals();

                                    var mesh = new THREE.Mesh( geometry, mat );

                                    //console.log("adding mesh");
                                    mesh.name = objName;
                                    mesh.position.x = myArr[obj][oIndex].position[0];
                                    mesh.position.y = myArr[obj][oIndex].position[1];
                                    mesh.position.z = myArr[obj][oIndex].position[2];
                                    mesh.castShadow = false;
                                    mesh.receiveShadow = true;
                                    if(textureName === "road") {
                                        trackObjects["track"].push( mesh );
                                        scene.add( mesh );
                                    } else if(textureName === "grass") {
                                        trackObjects["grass"].push( mesh );
                                        scene.add( mesh );
                                    } else if(textureName === "ground" || textureName === "track01") {
                                        trackObjects["ground"].push( mesh );
                                        scene.add( mesh );
                                    } else {
                                        if(textureName !== "alpha") {
                                            trackObjects["other"].push( mesh );
                                            scene.add( mesh );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            buildCollisionWorld();
            buildGroundWorld();
            console.log("track loaded");
            trackLoadedCallback();
        }
    };
    xmlhttp.open("GET", url, true);
    xmlhttp.send();
}

// What the car can drive into: the steep triangles of the track objects, see Collision.js
var collisionWorld;
// objects that are only a backdrop (sky, horizon, trees on a picture) or too thin to matter
var collisionIgnoredTextures = { "m_sky_blue": true, "horizon": true, "alpha": true, "grasst": true };
var collisionSteepness = 0.5; // a triangle is a wall when its normal points up less than this

function buildCollisionWorld() {
    collisionWorld = new OpenRacer.CollisionWorld(10);
    var a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    var ab = new THREE.Vector3(), ac = new THREE.Vector3();
    for(var k = 0; k < searchOrder.length; k++) {
        var meshes = trackObjects[searchOrder[k]];
        for(var m = 0; m < meshes.length; m++) {
            var mesh = meshes[m];
            if(collisionIgnoredTextures[mesh.material.map.name]) continue;
            var position = mesh.geometry.attributes.position;
            var index = mesh.geometry.index;
            var offset = mesh.position;
            for(var t = 0; t < index.count; t += 3) {
                a.fromBufferAttribute(position, index.getX(t)).add(offset);
                b.fromBufferAttribute(position, index.getX(t + 1)).add(offset);
                c.fromBufferAttribute(position, index.getX(t + 2)).add(offset);
                ab.subVectors(b, a);
                ac.subVectors(c, a);
                ab.cross(ac);
                var length = ab.length();
                if(length < 1e-9) continue;
                if(Math.abs(ab.y / length) < collisionSteepness) {
                    collisionWorld.addTriangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
                }
            }
        }
    }
    console.log("collision triangles: " + collisionWorld.count());
}

// The road for the suspension of the car: the triangles of the drivable textures, in a grid, see Ground.js. Where roads lie over each
// other (a road over grass) the order of searchOrder decides.
var groundWorld;

function buildGroundWorld() {
    groundWorld = new OpenRacer.GroundWorld(5);
    var a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for(var k = 0; k < searchOrder.length; k++) {
        var meshes = trackObjects[searchOrder[k]];
        for(var m = 0; m < meshes.length; m++) {
            var mesh = meshes[m];
            var texture = mesh.material.map.name;
            if(!drivableTextures[texture]) continue;
            var position = mesh.geometry.attributes.position;
            var index = mesh.geometry.index;
            var offset = mesh.position;
            for(var t = 0; t < index.count; t += 3) {
                a.fromBufferAttribute(position, index.getX(t)).add(offset);
                b.fromBufferAttribute(position, index.getX(t + 1)).add(offset);
                c.fromBufferAttribute(position, index.getX(t + 2)).add(offset);
                groundWorld.addTriangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, texture, mesh.name, k);
            }
        }
    }
    console.log("ground triangles: " + groundWorld.count());
}
