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
 * CarLoader.js
 *
 * Description: Loads the 3D model of a car from its configuration (cars/<id>/car.json, "model" and "wheels").
 *
 *   model.type "legacy": the two JSON models of the original demo (a body and a wheel that is used four times).
 *   model.type "gltf":   a glTF or glb file, for example from Blender. The model has to face +z ("forward") and have
 *                        y up; rotation_y, scale and offset in the configuration put it right. The origin of the
 *                        model after that is the height of the wheel axles, in the middle between the axles.
 *                        The wheels are nodes of the model (wheels.nodes: for each wheel the names of the nodes that
 *                        belong to it), which are taken out of the body so that they can steer and spin; or, without
 *                        such nodes, the wheel of the original demo is used four times.
 *
 *   The result: { tilt: the object for the body (it pitches and rolls with the car), wheels: four objects in the
 *   order of Vehicle.js (front right, front left, rear left, rear right), bodyLift: how far the origin of the body
 *   is above the road, as a multiple of the tyre radius }.
 *
 *   A wheel is a chain of objects: the wheel itself (placed and tilted with the road), the steering
 *   (children[0], turns around the vertical axis) and the spin (children[0].children[0]).
 */

OpenRacer.loadCarModel = function (config, onLoad, onError) {
    var model = config.model || {};
    var tireDiameter = config.chassis.tire_diameter;
    var SLOTS = ["FR", "FL", "RL", "RR"];
    var LEGACY_WHEEL_DIAMETER = 0.67564; // the size of the wheel of the original demo at scale 0.5
    var DEFAULT_WHEEL = "models/mustang_wheel.json";

    // Loads a JSON file with a model in the old three.js format
    function loadLegacyModel(url, done) {
        var request = new XMLHttpRequest();
        request.onreadystatechange = function () {
            if(request.readyState !== 4) return;
            if(request.status !== 200 && request.status !== 0) {
                onError("Could not load " + url + " (HTTP " + request.status + ")");
                return;
            }
            try {
                done(parseLegacyModel(JSON.parse(request.responseText)));
            } catch(e) {
                onError("Could not load " + url + " (" + e + ")");
            }
        };
        request.open("GET", url, true);
        request.send();
    }

    function wheelChain(content, flip) {
        var spin = new THREE.Object3D();
        spin.add(content);
        // the wheel model of the original demo has to face outwards on both sides of the car
        if(flip) spin.rotation.z = Math.PI;
        var steer = new THREE.Object3D();
        steer.add(spin);
        var object = new THREE.Object3D();
        object.add(steer);
        return { object: object, spin: spin };
    }

    // Four wheels from the wheel model of the original demo, scaled to the tyre of the car
    function defaultWheels(fileName, done) {
        loadLegacyModel(fileName || DEFAULT_WHEEL, function (geometry) {
            var material = [
                new THREE.MeshPhongMaterial({ color: 0x878787 }), /* brakes */
                mlib["Chrome"], /* alloys */
                new THREE.MeshBasicMaterial({ color: 0x000000 }) /* tyre */
            ];
            var mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            var scale = 0.5 * tireDiameter / LEGACY_WHEEL_DIAMETER;
            mesh.scale.set(scale, scale, scale);
            var wheels = [];
            // the right wheels (front right, rear right) are the ones that are not flipped
            [true, false, false, true].forEach(function (right) {
                wheels.push(wheelChain(mesh.clone(), !right).object);
            });
            done(wheels);
        });
    }

    function legacy() {
        loadLegacyModel(model.body, function (geometry) {
            // one material for every part of the body model, in the order of the model
            var material = [
                mlib["Black metal"], /* windows */
                new THREE.MeshLambertMaterial({ color: 0x000000 }), /* front grille */
                mlib["Black metal"], /* rear lights */
                mlib["Chrome"], /* bumpers */
                mlib.body["Orange"], /* car body */
                mlib["Chrome"], /* chrome trim */
                new THREE.MeshBasicMaterial({ color: 0x0000ff })
            ];
            var mesh = new THREE.Mesh(geometry, material);
            mesh.scale.set(0.5, 0.5, 0.5);
            mesh.castShadow = true;
            mesh.receiveShadow = false;
            defaultWheels(model.wheel, function (wheels) {
                // the body model has its origin one wheel radius above the axles
                onLoad({ tilt: mesh, wheels: wheels, bodyLift: 2 });
            });
        });
    }

    function gltf() {
        var loader = new THREE.GLTFLoader();
        loader.load(model.file, function (loaded) {
            try {
                build(loaded.scene);
            } catch(e) {
                console.error(e);
                onError("Could not use " + model.file + " (" + e + ")");
            }
        }, undefined, function (error) {
            onError("Could not load " + model.file + " (" + (error && error.message ? error.message : error) + ")");
        });
    }

    function build(root) {
        var pivot = new THREE.Group();
        pivot.add(root);
        pivot.rotation.y = (model.rotation_y || 0) * Math.PI / 180;
        pivot.scale.setScalar(model.scale || 1);
        var offset = model.offset || [0, 0, 0];
        pivot.position.set(offset[0], offset[1], offset[2]);

        // everything is looked at in the space of the body: the space around the pivot
        var space = new THREE.Scene();
        space.add(pivot);
        space.updateMatrixWorld(true);

        var tilt = new THREE.Object3D();
        var nodes = (config.wheels && config.wheels.nodes) || {};
        var wheels = [];
        var complete = (config.wheels && config.wheels.mode === "model") && SLOTS.every(function (slot) {
            return nodes[slot] && nodes[slot].some(function (name) { return root.getObjectByName(name); });
        });

        if(complete) {
            SLOTS.forEach(function (slot) {
                var parts = nodes[slot].map(function (name) { return root.getObjectByName(name); }).filter(Boolean);
                // a part that is inside another part goes with it
                parts = parts.filter(function (part) {
                    return !parts.some(function (other) { return other !== part && isInside(part, other); });
                });
                var box = new THREE.Box3();
                parts.forEach(function (part) { box.expandByObject(part); });
                var chain = wheelChain(new THREE.Object3D(), false);
                chain.spin.remove(chain.spin.children[0]);
                chain.object.position.copy(box.getCenter(new THREE.Vector3()));
                space.add(chain.object);
                chain.object.updateMatrixWorld(true);
                // attach keeps the place of a part in the world: it ends up around the middle of the wheel
                parts.forEach(function (part) { chain.spin.attach(part); });
                space.remove(chain.object);
                wheels.push(chain.object);
            });
            finish(wheels);
        } else {
            if(config.wheels && config.wheels.mode === "model") console.warn("CarLoader: not every wheel has parts of the model, using the default wheel");
            defaultWheels(config.wheels && config.wheels.default_model, finish);
        }

        function finish(wheelObjects) {
            tilt.add(pivot);
            // glTF models are made of physically based materials: they are lit by and reflect the surroundings of the
            // scene (scene.environment, see MaterialLibrary.js)
            [tilt].concat(wheelObjects).forEach(function (object) {
                object.traverse(function (child) {
                    if(child.isMesh) child.castShadow = true;
                });
            });
            onLoad({ tilt: tilt, wheels: wheelObjects, bodyLift: 1 });
        }
    }

    function isInside(part, other) {
        for(var p = part.parent; p; p = p.parent) {
            if(p === other) return true;
        }
        return false;
    }

    if(model.type === "gltf") gltf();
    else legacy();
};
