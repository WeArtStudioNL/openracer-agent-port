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
var trackGates = [];         // lines across the road { x, z, heading, width } that make a lap, in order; the first is the finish line
var trackCheckPoints = [];   // names of the road pieces that make a lap, from the track
var currentTrack = null;     // the track that is loaded (see tracks/<id>/track.json)
var trackBase = "";          // the folder of the track

var trackLoadedCallback;
var textureLoader = new THREE.TextureLoader();

// a file of the track (model, textures, sky picture): a track of the garage or of a folder on the PC has its files as blob URLs (Garage.js)
function trackFile(name) {
    var url = trackBase + name;
    return OpenRacer.Garage ? OpenRacer.Garage.resolve(currentTrack, url) : url;
}

// Loads a track from its configuration (the contents of tracks/<id>/track.json, with its id)
function loadTrack(track, tlCallback) {
    currentTrack = track;
    trackBase = "tracks/" + track.id + "/";
    trackGates = track.gates || [];
    trackCheckPoints = trackGates.length ? trackGates.map(function(gate, i) { return "g" + i; }) : (track.checkpoints || []);
    trackLoadedCallback = tlCallback;
    if(track.model) {
        loadGltfTrack(track);
        return;
    }
    xmlhttp.onreadystatechange = function() {
        if (xmlhttp.readyState == 4 && xmlhttp.status == 200) {
            console.log("circuit loaded");
            var myArr = JSON.parse(xmlhttp.responseText);
            circuitObjects = myArr;
            loadScene();
        }
    }
    xmlhttp.open("GET", trackFile(track.geometry), true);
    xmlhttp.send();
}

function loadScene() {
    var xmlhttp = new XMLHttpRequest();
    var url = trackFile(currentTrack.scene);

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
                                    var texture = textureLoader.load( trackFile(currentTrack.textures + textureFile) );
                                    texture.colorSpace = THREE.SRGBColorSpace;
                                    var bumpTexture;
                                    if(textureName === "road") {
                                        //console.log(myArr.textures[textureName]);
                                        //console.log(myArr.textures[textureName + "-specular"]);
                                        //console.log(myArr.textures["road-specular"]);
                                    }
                                    if(myArr.textures[textureName + "-bump"]) {
                                        //console.log("BUMP: " + myArr.textures[textureName + "-bump"].file);
                                        bumpTexture = textureLoader.load( trackFile(currentTrack.textures + myArr.textures[textureName + "-bump"].file) );
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
                                        // a picture with an alpha channel (a tree, a fence, a sign): cut out, not blended, so the order that the objects are drawn in does not matter
                                        mat.alphaTest = 0.5;
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
            applyTrackEnvironment(currentTrack);
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
var collisionIgnoredTextures = { "m_sky_blue": true, "horizon": true, "alpha": true, "grasst": true, "decor": true };
var collisionSteepness = 0.5; // a triangle is a wall when its normal points up less than this

// Small props that are drawn with a lot of triangles (a tyre of a tyre wall is 832) hit the car as their box: the physics tests every triangle near the car with
// every sphere of it, and a wall of tyres put thousands of them in reach (1 frame per second next to the wall). Returns the box of a mesh to use, or null.
function propBox(mesh) {
    var index = mesh.geometry.index;
    if(!index || index.count / 3 < 200) return null;
    var sphere = mesh.geometry.boundingSphere;
    if(!sphere || sphere.radius > 1.5) return null;
    if(!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox;
}

// the 12 triangles of a box, to f(ax, ay, az, bx, by, bz, cx, cy, cz)
function boxTriangles(box, offset, f) {
    var x0 = box.min.x + offset.x, y0 = box.min.y + offset.y, z0 = box.min.z + offset.z, x1 = box.max.x + offset.x, y1 = box.max.y + offset.y, z1 = box.max.z + offset.z;
    var c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]].forEach(function(t) {
        f(c[t[0]][0], c[t[0]][1], c[t[0]][2], c[t[1]][0], c[t[1]][1], c[t[1]][2], c[t[2]][0], c[t[2]][1], c[t[2]][2]);
    });
}

function buildCollisionWorld() {
    collisionWorld = new OpenRacer.CollisionWorld(10);
    var a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    var ab = new THREE.Vector3(), ac = new THREE.Vector3();
    for(var k = 0; k < searchOrder.length; k++) {
        var meshes = trackObjects[searchOrder[k]];
        for(var m = 0; m < meshes.length; m++) {
            var mesh = meshes[m];
            if(collisionIgnoredTextures[meshSurface(mesh)]) continue;
            var position = mesh.geometry.attributes.position;
            var index = mesh.geometry.index;
            var offset = mesh.position;
            var box = propBox(mesh);
            if(box) { boxTriangles(box, offset, function(ax, ay, az, bx, by, bz, cx, cy, cz) { collisionWorld.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz); }); continue; }
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

// The physics of a track: "3d", the default (the wheels feel the road along their own axis and the body is a set of spheres, so a loop or a car
// on a wall is possible) or "2d" (one height of the road per place, the walls as outlines on the ground). A track says it with "physics" in track.json.
function trackPhysics3D(track) {
    var forced = new URLSearchParams(window.location.search).get("physics");     // ?physics=3d or 2d: to try a track with the other one
    if(forced === "3d") return true;
    if(forced === "2d") return false;
    return !(track && track.physics === "2d");
}

function buildGroundWorld() {
    var physics3D = trackPhysics3D(currentTrack);
    groundWorld = new OpenRacer.GroundWorld(5);
    groundWorld.use3D = physics3D;
    var a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for(var k = 0; k < searchOrder.length; k++) {
        var meshes = trackObjects[searchOrder[k]];
        for(var m = 0; m < meshes.length; m++) {
            var mesh = meshes[m];
            var texture = meshSurface(mesh);
            var drivable = !!drivableTextures[texture];
            // the 3D side (loops, walls that are driven on): the drivable parts for the wheels, and the rest that the body can hit
            if(!drivable && (!physics3D || collisionIgnoredTextures[texture])) continue;
            var position = mesh.geometry.attributes.position;
            var index = mesh.geometry.index;
            var offset = mesh.position;
            var box = drivable ? null : propBox(mesh);
            if(box) { boxTriangles(box, offset, function(ax, ay, az, bx, by, bz, cx, cy, cz) { groundWorld.addTriangle3D(ax, ay, az, bx, by, bz, cx, cy, cz, texture, mesh.name, k, false); }); continue; }
            for(var t = 0; t < index.count; t += 3) {
                a.fromBufferAttribute(position, index.getX(t)).add(offset);
                b.fromBufferAttribute(position, index.getX(t + 1)).add(offset);
                c.fromBufferAttribute(position, index.getX(t + 2)).add(offset);
                if(drivable) groundWorld.addTriangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, texture, mesh.name, k);
                if(physics3D) groundWorld.addTriangle3D(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, texture, mesh.name, k, drivable);
            }
        }
    }
    console.log("ground triangles: " + groundWorld.count() + (physics3D ? ", 3D: " + groundWorld.count3D() : ""));
}

// What a piece of the track is made of: for a glTF track the role that the track editor gave it, for the old format the name of its texture.
function meshSurface(mesh) {
    if(mesh.userData.surface) return mesh.userData.surface;
    return mesh.material && mesh.material.map ? mesh.material.map.name : "";
}

// ---- tracks from a glTF/glb model (made with the track editor, see tools/track-editor.html)
//
// track.json has "model" (the file in the folder of the track) and "surfaces": { "meshes": { <name of a part>: <role> }, "materials": { <name of a
// material>: <role> } }. The roles are road, track01, grass and ground (the car can drive on them, each with its own grip), scenery (visible,
// the car drives into its steep parts), decor (only to look at) and, for what is not mentioned, scenery. The model is made in metres, y up.
var trackRoles = { road: "track", track01: "ground", grass: "grass", ground: "ground" };

function trackRole(mesh, surfaces) {
    var meshes = surfaces.meshes || {};
    var materials = surfaces.materials || {};
    for(var node = mesh; node; node = node.parent) {
        if(node.name && meshes[node.name]) return meshes[node.name];
    }
    var material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if(material && material.name && materials[material.name]) return materials[material.name];
    return "scenery";
}

function loadGltfTrack(track) {
    var loader = new THREE.GLTFLoader(OpenRacer.Garage ? OpenRacer.Garage.manager(track) : undefined);
    loader.load(trackFile(track.model), function(gltf) {
        gltf.scene.updateMatrixWorld(true);
        var surfaces = track.surfaces || {};
        var pieces = [];
        gltf.scene.traverse(function(object) { if(object.isMesh) pieces.push(object); });
        var maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
        pieces.forEach(function(piece) {
            var role = trackRole(piece, surfaces);
            // the transform of the part is baked into the geometry: the rest of the game wants the track in world coordinates
            var geometry = piece.geometry.clone();
            geometry.applyMatrix4(piece.matrixWorld);
            if(!geometry.index) {
                var count = geometry.attributes.position.count;
                var indices = new Uint32Array(count);
                for(var i = 0; i < count; i++) indices[i] = i;
                geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            }
            geometry.computeBoundingSphere();
            var mesh = new THREE.Mesh(geometry, piece.material);
            mesh.name = piece.name;
            mesh.userData.surface = role;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            [].concat(mesh.material).forEach(function(material) {
                if(material.map) material.map.anisotropy = maxAnisotropy;
                cutOut(material);
            });
            var category = trackRoles[role];
            if(category === "track") trackObjects["track"].push(mesh);
            else if(category === "grass") trackObjects["grass"].push(mesh);
            else if(category === "ground") trackObjects["ground"].push(mesh);
            else trackObjects["other"].push(mesh);
            scene.add(mesh);
        });
        buildCollisionWorld();
        buildGroundWorld();
        mergeScenery();
        applyTrackEnvironment(track);
        console.log("track loaded: " + track.model + ", " + pieces.length + " parts");
        trackLoadedCallback();
    }, undefined, function(error) {
        console.error(error);
        alert("The track could not be loaded: " + (error.message || error));
    });
}

// A material with a picture that has an alpha channel (alphaMode "BLEND" in a glTF: a tree, a fence, a sign) is blended in the order of the objects, and then an object that is behind
// another is drawn over it now and then. It is cut out instead (what is less than half there is not drawn, the rest is solid and writes the depth), where the order does not matter.
// A material that is see-through as a whole (opacity below 1: glass) stays blended.
function cutOut(material) {
    if(!material || !material.map || !material.transparent || material.opacity < 1) return;
    material.transparent = false;
    material.alphaTest = 0.5;
    material.depthWrite = true;
    material.needsUpdate = true;
}

// Decor that is only drawn (tyre walls, trees: the "other" meshes) is merged per material and per cell of 40 m, so that a track with thousands
// of loose parts costs a few hundred draw calls instead of thousands. The loose meshes stay in trackObjects (the collision and the ground world
// have been built from them) but leave the scene.
function mergeScenery() {
    var cell = 40, groups = {}, merged = 0;
    trackObjects["other"].forEach(function(mesh) {
        if(Array.isArray(mesh.material) || !mesh.parent) return;
        var s = mesh.geometry.boundingSphere;
        var key = [mesh.material.uuid, Math.floor((mesh.position.x + s.center.x) / cell), Math.floor((mesh.position.z + s.center.z) / cell),
            Object.keys(mesh.geometry.attributes).sort().join(","), mesh.userData.surface].join("|");
        (groups[key] = groups[key] || []).push(mesh);
    });
    Object.keys(groups).forEach(function(key) {
        var list = groups[key];
        if(list.length < 2) return;
        var geometry = THREE.mergeGeometries(list.map(function(mesh) {
            var g = mesh.geometry;
            if(mesh.position.lengthSq() === 0) return g;
            g = g.clone(); g.translate(mesh.position.x, mesh.position.y, mesh.position.z);
            return g;
        }), false);
        if(!geometry) return;
        geometry.computeBoundingSphere();
        var first = list[0];
        var combined = new THREE.Mesh(geometry, first.material);
        combined.name = "scenery";
        combined.userData.surface = first.userData.surface;
        combined.castShadow = list.some(function(mesh) { return mesh.castShadow; });
        combined.receiveShadow = true;
        list.forEach(function(mesh) { scene.remove(mesh); });
        scene.add(combined);
        merged += list.length;
    });
    console.log("scenery merged: " + merged + " parts in " + Object.keys(groups).length + " groups");
}

// The sky and the light of the track (see TrackEnvironment.js). A glTF track always gets them (a sky of colours if it says nothing),
// a track of the old format only if it has an environment: its sky is a part of its model.
function applyTrackEnvironment(track) {
    if(!track.model && !track.environment) return;
    var env = OpenRacer.environmentOf(track);
    var texture = env.sky_image ? textureLoader.load(trackFile(env.sky_image)) : null;
    scene.add(OpenRacer.makeSky(THREE, env, texture));

    var sun = OpenRacer.sunVector(env, 1000);
    sunLight.position.set(sun.x, sun.y, sun.z);
    sunLight.color.set(env.sun.color);
    sunLight.intensity = 0.7 * Math.PI * env.sun.intensity;
    shadowLight.color.set(env.sun.color);
    shadowLight.intensity = 0.5 * Math.PI * env.sun.intensity;
    var shadow = OpenRacer.sunVector(env, 91);
    sunDirection.set(shadow.x, shadow.y, shadow.z);
    ambientLight.color.set(env.ambient.color);
    ambientLight.intensity = Math.PI * env.ambient.intensity;

    if(env.fog.enabled) {
        scene.fog = new THREE.Fog(env.fog.color, env.fog.near, env.fog.far);
        renderer.setClearColor(env.fog.color, 1);
    } else {
        scene.fog = null;
        renderer.setClearColor(env.sky_horizon, 1);
    }
}
