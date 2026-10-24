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

// loadedRoot (optional): a glTF scene that is already loaded (the car editor has one); it is copied and built like a loaded file
OpenRacer.loadCarModel = function (config, onLoad, onError, loadedRoot) {
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
        request.open("GET", fileUrl(url), true);
        request.send();
    }

    // a file of the car: a car of the garage or of a folder on the PC has its files as blob URLs (Garage.js)
    function fileUrl(url) { return OpenRacer.Garage ? OpenRacer.Garage.resolve(config, url) : url; }

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
        var loader = new THREE.GLTFLoader(OpenRacer.Garage ? OpenRacer.Garage.manager(config) : undefined);
        loader.load(fileUrl(model.file), function (loaded) {
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

    // A texture that reads a set of texture coordinates the mesh does not have (a model whose glTF says texCoord 6 for a badge) makes the shader fail to compile
    // ("uv6: undeclared identifier") and the part is not drawn: it falls back to the first set
    function fixTextureChannels(root) {
        var slots = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "bumpMap", "lightMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap",
            "sheenColorMap", "sheenRoughnessMap", "transmissionMap", "thicknessMap", "specularIntensityMap", "specularColorMap", "iridescenceMap", "anisotropyMap"];
        root.traverse(function(object) {
            if(!object.isMesh || !object.geometry) return;
            [].concat(object.material).forEach(function(material) {
                if(!material) return;
                if(typeof cutOut === "function") cutOut(material);          // (not in the car editor, which does not load Helpers.js) // (the rims and the calipers are pictures with an alpha channel: blended, they are drawn over what is in front of them)
                slots.forEach(function(slot) {
                    var texture = material[slot];
                    if(!texture || !texture.channel) return;
                    var attribute = texture.channel === 1 ? "uv1" : (texture.channel === 0 ? "uv" : "uv" + texture.channel);
                    if(!object.geometry.attributes[attribute]) {
                        texture.channel = object.geometry.attributes.uv1 && texture.channel === 1 ? 1 : 0;
                        material.needsUpdate = true;
                    }
                });
            });
        });
    }

    function build(root) {
        fixTextureChannels(root);
        calipersRoot = root;
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


        // The steering wheel: a part called "steeringwheel" turns with the steering. It turns around its own middle, about the axis
        // of the wheel: the direction in which it is flattest (found from its shape), or "steering_wheel.axis" of the car (in the space of the model).
        var steering = findSteeringWheel(root, space);

        var takenAt = {}, takenBy = {};   // the parts that the slots have taken (by name): where they were, and the chain that holds them
        var measured = null; // the centres and the size of the wheels of the model, in the space of the body
        if(complete) {
            measured = { centres: {}, diameter: 0 };
            SLOTS.forEach(function (slot) {
                var parts = nodes[slot].map(function (name) { return root.getObjectByName(name); }).filter(Boolean);
                // a part that is inside another part goes with it
                parts = parts.filter(function (part) {
                    return !parts.some(function (other) { return other !== part && isInside(part, other); });
                });
                // the parts that an earlier slot took are not in the model any more (a motorcycle: wheel_FL for both FR and FL): this slot has the same place and no wheel of its own
                var box = new THREE.Box3();
                var again = nodes[slot].filter(function (name) { return takenAt[name]; });
                var sharesWith = null;        // the chain of the earlier slot that holds the wheel of this slot (a motorcycle)
                if(!parts.length && again.length) {
                    box.setFromCenterAndSize(takenAt[again[0]], new THREE.Vector3(0.001, 0.001, 0.001));
                    sharesWith = takenBy[again[0]] || null;
                } else {
                    parts.forEach(function (part) { box.expandByObject(part); });
                    var middle = box.getCenter(new THREE.Vector3());
                    nodes[slot].forEach(function (name) { takenAt[name] = middle; });
                }
                measured.centres[slot] = box.getCenter(new THREE.Vector3());
                (measured.sizes = measured.sizes || []).push(box.getSize(new THREE.Vector3()).y);
                var chain = wheelChain(new THREE.Object3D(), false);
                chain.spin.remove(chain.spin.children[0]);
                chain.object.position.copy(box.getCenter(new THREE.Vector3()));
                space.add(chain.object);
                chain.object.updateMatrixWorld(true);
                // attach keeps the place of a part in the world: it ends up around the middle of the wheel
                parts.forEach(function (part) { chain.spin.attach(part); });
                nodes[slot].forEach(function (name) { if(!takenBy[name]) takenBy[name] = chain; });
                // the brake caliper of this wheel (a part called brake_caliper_FL or the like, not a wheel part): it goes with the
                // wheel and steers with it, but it does not spin, so it hangs on the steering link of the chain. On a motorcycle the wheel of this slot was taken by an
                // earlier slot (FR takes wheel_FL, FL has nothing of its own): its parts (brake_fork_leg_FL, brake_mudguard_FL) hang on that chain, the one that is drawn
                // at the wheel; on their own slot they stood beside the wheel, by the track of the ghost wheel, and without the travel of the fork
                var holder = sharesWith || chain, extra = calipersOf(slot);
                if(holder !== chain && extra.length) { space.add(holder.object); holder.object.updateMatrixWorld(true); }      // (attach needs it in the space of the model)
                extra.forEach(function (part) { holder.object.children[0].attach(part); });
                if(holder !== chain && extra.length) space.remove(holder.object);
                space.remove(chain.object);
                wheels.push(chain.object);
            });
            // the diameter of the tyre: the mean of the wheels that are wheels (a motorcycle has two wheels and two dots of a millimetre for the other two slots)
            var biggest = Math.max.apply(null, measured.sizes), real = measured.sizes.filter(function(s) { return s >= 0.5 * biggest; });
            measured.diameter = real.reduce(function(a, s) { return a + s; }, 0) / real.length;
            finish(wheels);
        } else {
            if(config.wheels && config.wheels.mode === "model") console.warn("CarLoader: not every wheel has parts of the model, using the default wheel");
            defaultWheels(config.wheels && config.wheels.default_model, finish);
        }

        // The front end of a motorcycle that stays and turns: the parts called steerhead_... (the cylinders of the fork, the triple clamp, the handlebar). They hang on the
        // body (they do not go with the wheel), and turn with the steering about the axis of the fork, which goes through the middle of the front wheel (config.motorcycle.rake_deg).
        function makeHead() {
            if(config.type !== "motorcycle" || !measured || !measured.centres.FL) return null;
            var parts = [];
            // (and the parts of the handlebar that the rider takes hold of, which turn with it: the grips, the brake lever and the clutch lever, see Driver.js)
            var ON_HANDLEBAR = { gripl: 1, gripr: 1, frontbraker: 1, clutchl: 1 };
            root.traverse(function(child) { var n = String(child.name || "").toLowerCase().replace(/[^a-z0-9]/g, ""); if(n.indexOf("steerhead") === 0 || ON_HANDLEBAR[n]) parts.push(child); });
            parts = parts.filter(function(part) { return !parts.some(function(other) { return other !== part && isInside(part, other); }); });
            if(!parts.length) return null;
            var object = new THREE.Object3D();
            object.name = "steerhead";
            object.position.copy(measured.centres.FL);
            space.add(object);
            object.updateMatrixWorld(true);
            parts.forEach(function(part) { object.attach(part); });
            space.remove(object);
            var rake = ((config.motorcycle && config.motorcycle.rake_deg) || 24.5) * Math.PI / 180;
            return { object: object, axis: new THREE.Vector3(0, Math.cos(rake), -Math.sin(rake)), rake: rake };
        }

        function finish(wheelObjects) {
            var head = makeHead();
            if(head) tilt.add(head.object);
            if(steering) tilt.add(steering.object);
            tilt.add(pivot);
            // the moving parts of the suspension and the steering, when the model has them (SuspensionRig.js)
            var rig = null;
            if(OpenRacer.SuspensionRig) {
                space.add(tilt);
                space.updateMatrixWorld(true);
                rig = OpenRacer.SuspensionRig.find(root, space, tilt, config);
                space.remove(tilt);
                if(rig) console.log("CarLoader: suspension rig with " + rig.count + " parts");
            }
            // glTF models are made of physically based materials: they are lit by and reflect the surroundings of the
            // scene (scene.environment, see MaterialLibrary.js)
            [tilt].concat(wheelObjects).forEach(function (object) {
                object.traverse(function (child) {
                    if(child.isMesh) child.castShadow = true;
                });
            });
            // the changes to the materials that were made in the car editor
            OpenRacer.applyMaterialOverrides(THREE, [tilt].concat(wheelObjects), config.materials);
            onLoad({ tilt: tilt, wheels: wheelObjects, bodyLift: 1, steeringWheel: steering, measured: measured, rig: rig, head: head, swingarm: head ? findSwingarm(root, space, measured) : null });
        }
    }

    // the parts of a brake caliper of a wheel, by their name: brake_caliper_FL, caliper_FL, susp_caliper_FL, brake_FL
    var calipersRoot = null;
    function calipersOf(slot) {
        var found = [];
        if(!calipersRoot) return found;
        var corner = slot.toLowerCase();
        calipersRoot.traverse(function (child) {
            var name = (child.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            if(/(caliper|brake)/.test(name) && name.slice(-2) === corner && !/disc|disk|rotor/.test(name)) found.push(child);
        });
        // a part inside another found part goes with it
        return found.filter(function (part) { return !found.some(function (other) { return other !== part && isInside(part, other); }); });
    }

    function findSteeringWheel(root, space) {
        var settings = config.steering_wheel || {};
        var wanted = String(settings.name || "steeringwheel").toLowerCase().replace(/[^a-z0-9]/g, "");
        var node = null;
        root.traverse(function (child) {
            if(node) return;
            var name = (child.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            if(name.indexOf(wanted) !== -1 || (wanted === "steeringwheel" && name.indexOf("steerwheel") !== -1)) node = child;
        });
        if(!node) return null;
        space.updateMatrixWorld(true);

        // the vertices of the part in the space of the body, for its middle and its shape
        var points = [];
        var v = new THREE.Vector3();
        node.traverse(function (child) {
            if(!child.isMesh || !child.geometry.attributes.position) return;
            var position = child.geometry.attributes.position;
            var step = Math.max(1, Math.floor(position.count / 4000));
            for(var i = 0; i < position.count; i += step) {
                v.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
                points.push(v.x, v.y, v.z);
            }
        });
        if(points.length < 9) return null;
        var box = new THREE.Box3();
        for(var p = 0; p < points.length; p += 3) box.expandByPoint(v.set(points[p], points[p + 1], points[p + 2]));
        var centre = box.getCenter(new THREE.Vector3());

        var axis;
        if(settings.axis && settings.axis.length === 3) {
            axis = new THREE.Vector3(settings.axis[0], settings.axis[1], settings.axis[2]).normalize();
        } else {
            axis = flattestDirection(points, centre);
        }
        // the axis points to the driver (to the rear of the car), so that a turn to the right is a turn clockwise as the driver sees it
        if(axis.z > 0) axis.negate();

        var object = new THREE.Object3D();
        object.name = "steeringwheel-pivot";
        object.position.copy(centre);
        space.add(object);
        object.updateMatrixWorld(true);
        object.attach(node); // keeps the place of the part
        space.remove(object);
        return { object: object, axis: axis, degrees: settings.degrees > 0 ? settings.degrees : 450 };
    }

    // The direction in which a cloud of points is the flattest: the axis of the covariance matrix with the smallest value (for a ring and
    // its spokes, the line through the middle at a right angle to the wheel)
    function flattestDirection(points, centre) {
        var c = [0, 0, 0, 0, 0, 0]; // xx, xy, xz, yy, yz, zz
        var n = points.length / 3;
        for(var i = 0; i < points.length; i += 3) {
            var x = points[i] - centre.x, y = points[i + 1] - centre.y, z = points[i + 2] - centre.z;
            c[0] += x * x; c[1] += x * y; c[2] += x * z; c[3] += y * y; c[4] += y * z; c[5] += z * z;
        }
        var a = [[c[0] / n, c[1] / n, c[2] / n], [c[1] / n, c[3] / n, c[4] / n], [c[2] / n, c[4] / n, c[5] / n]];
        var e = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // the eigenvectors, as the columns
        for(var sweep = 0; sweep < 30; sweep++) { // Jacobi
            var changed = false;
            for(var p = 0; p < 2; p++) {
                for(var q = p + 1; q < 3; q++) {
                    if(Math.abs(a[p][q]) < 1e-14) continue;
                    changed = true;
                    var theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
                    var t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                    var cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
                    for(var k = 0; k < 3; k++) {
                        var akp = a[k][p], akq = a[k][q];
                        a[k][p] = cs * akp - sn * akq;
                        a[k][q] = sn * akp + cs * akq;
                    }
                    for(var k2 = 0; k2 < 3; k2++) {
                        var apk = a[p][k2], aqk = a[q][k2];
                        a[p][k2] = cs * apk - sn * aqk;
                        a[q][k2] = sn * apk + cs * aqk;
                    }
                    for(var k3 = 0; k3 < 3; k3++) {
                        var ekp = e[k3][p], ekq = e[k3][q];
                        e[k3][p] = cs * ekp - sn * ekq;
                        e[k3][q] = sn * ekp + cs * ekq;
                    }
                }
            }
            if(!changed) break;
        }
        var smallest = 0;
        for(var m = 1; m < 3; m++) if(a[m][m] < a[smallest][smallest]) smallest = m;
        return new THREE.Vector3(e[0][smallest], e[1][smallest], e[2][smallest]).normalize();
    }

    function isInside(part, other) {
        for(var p = part.parent; p; p = p.parent) {
            if(p === other) return true;
        }
        return false;
    }

    if(loadedRoot) {
        try { build(loadedRoot.clone(true)); } catch(e) { console.error(e); onError("Could not use the model (" + e + ")"); }
    } else if(model.type === "gltf") gltf();
    else legacy();
};

// The swingarm of a motorcycle: a part called swingarm (or swing_arm, rear_arm) turns about its own origin, the pivot on the frame, as the rear wheel goes up and down: the wheel is
// on the end of it. Found once, in the space of the body: the axis of the pivot (the x axis of the body, in the frame of the part) and the length to the rear axle.
function findSwingarm(root, space, measured) {
    var part = null;
    root.traverse(function(child) { if(!part && /^(swing_?arm|rear_?arm|swingarm)/i.test(String(child.name || ""))) part = child; });
    if(!part || !measured || !measured.centres.RL) return null;
    space.updateMatrixWorld(true);
    var pivot = part.getWorldPosition(new THREE.Vector3()), axle = measured.centres.RL;
    var length = Math.hypot(axle.y - pivot.y, axle.z - pivot.z);
    if(!(length > 0.1)) return null;
    var q = part.getWorldQuaternion(new THREE.Quaternion());
    return { object: part, rest: part.quaternion.clone(), axis: new THREE.Vector3(1, 0, 0).applyQuaternion(q.invert()).normalize(), length: length, pivotZ: pivot.z, axleZ: axle.z };
}
OpenRacer.updateSwingarm = function(arm, rear, body) {
    if(!arm || !rear || !rear.object) return;
    var up = (rear.restLengthWheel || 0) - (rear.susLength || 0);                       // how far the wheel is up from where it sits at rest
    var a = Math.asin(Math.max(-1, Math.min(1, up / arm.length)));
    if(arm.pivotZ < arm.axleZ) a = -a;                                                  // (a pivot behind the axle: the other way round)
    OpenRacer.updateSwingarm.q = OpenRacer.updateSwingarm.q || new THREE.Quaternion();
    arm.object.quaternion.copy(arm.rest).multiply(OpenRacer.updateSwingarm.q.setFromAxisAngle(arm.axis, a));
    // the wheel is on the arc of the arm: it comes forward a little as it goes up
    OpenRacer.updateSwingarm.forward = OpenRacer.updateSwingarm.forward || new THREE.Vector3();
    OpenRacer.updateSwingarm.forward.set(0, 0, 1).applyQuaternion(body.quaternion).multiplyScalar(arm.length * (1 - Math.cos(a)) * (arm.pivotZ < arm.axleZ ? -1 : 1));
    rear.object.position.add(OpenRacer.updateSwingarm.forward);
};

// The front end of a motorcycle each frame: the head (the cylinders, the clamp, the handlebar) turns with the steering about the axis of the fork, the front wheel (with the
// leg, the brake caliper and the mudguard that hang on it) turns about it too and goes along it with the springs (the physics lets the wheel go straight up and down; the
// fork goes along its rake, so the wheel moves back a little as it goes up). front: the front wheel (Wheel.js), body: the object of the body, steer: the angle of the front wheel.
OpenRacer.updateFork = function(head, front, body, steer) {
    if(!head || !front || !front.object) return;
    head.object.quaternion.setFromAxisAngle(head.axis, -steer);
    front.object.children[0].quaternion.setFromAxisAngle(head.axis, -steer - (front.toeBend || 0));
    var compression = (front.restLengthWheel || 0) - (front.susLength || 0);
    var back = -compression * Math.tan(head.rake);
    OpenRacer.updateFork.forward = OpenRacer.updateFork.forward || new THREE.Vector3();
    OpenRacer.updateFork.forward.set(0, 0, 1).applyQuaternion(body.quaternion).multiplyScalar(back);
    front.object.position.add(OpenRacer.updateFork.forward);
};
