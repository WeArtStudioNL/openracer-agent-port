/*
 * MaterialOverrides.js
 *
 * Description: Changes to the materials of a glTF car, kept in its configuration (car.json, "materials": the name of a
 *              material of the model and the values to change). The glTF materials are physically based (colour, metalness,
 *              roughness, maps, ...), but a model does not always arrive the way it looked in Blender: a shader that
 *              the exporter does not know, such as the glass of many models, ends up as a plain opaque white metal. So
 *              the car editor can set a material right, with a preset (glass, paint, chrome, ...) or by hand.
 *
 *              This script is used by the game and by the car editor, so the three.js module is passed as an argument.
 *
 * An override is { color: "#rrggbb", metalness, roughness, opacity, clearcoat, clearcoatRoughness, envMapIntensity },
 * every field is optional.
 */

OpenRacer.materialFields = ["color", "metalness", "roughness", "opacity", "clearcoat", "clearcoatRoughness", "envMapIntensity"];

OpenRacer.materialPresets = {
    "Glass": { color: "#0b1116", metalness: 0, roughness: 0.04, opacity: 0.3, clearcoat: 0, envMapIntensity: 1.2 },
    "Car paint": { metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, opacity: 1 },
    "Chrome": { color: "#ffffff", metalness: 1, roughness: 0.05, clearcoat: 0, opacity: 1 },
    "Rubber": { color: "#0a0a0a", metalness: 0, roughness: 0.9, clearcoat: 0, opacity: 1 },
    "Black plastic": { color: "#101010", metalness: 0, roughness: 0.45, clearcoat: 0, opacity: 1 },
    "Brushed metal": { color: "#b8bcc2", metalness: 1, roughness: 0.4, clearcoat: 0, opacity: 1 }
};

// Makes every physically based material of an object a MeshPhysicalMaterial (which also has a clear coat), and returns the
// materials of the object, every one once.
OpenRacer.prepareMaterials = function (THREE, root) {
    var replaced = new Map();
    var list = [];
    root.traverse(function (child) {
        if(!child.isMesh) return;
        var materials = Array.isArray(child.material) ? child.material : [child.material];
        var result = materials.map(function (material) {
            if(replaced.has(material)) return replaced.get(material);
            var prepared = material;
            if(material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) {
                prepared = new THREE.MeshPhysicalMaterial();
                THREE.MeshStandardMaterial.prototype.copy.call(prepared, material);
            }
            if(prepared.isMeshStandardMaterial) {
                prepared.userData.original = OpenRacer.materialValues(prepared);
                list.push(prepared);
            }
            replaced.set(material, prepared);
            return prepared;
        });
        child.material = Array.isArray(child.material) ? result : result[0];
    });
    return list;
};

// The values of a material that can be overridden
OpenRacer.materialValues = function (material) {
    return {
        color: "#" + material.color.getHexString(),
        metalness: material.metalness,
        roughness: material.roughness,
        opacity: material.opacity,
        clearcoat: material.clearcoat || 0,
        clearcoatRoughness: material.clearcoatRoughness || 0,
        envMapIntensity: material.envMapIntensity
    };
};

// Puts a material back as it was in the model, and then applies an override (or none)
OpenRacer.applyMaterialOverride = function (material, override) {
    var values = Object.assign({}, material.userData.original, override || {});
    material.color.set(values.color);
    material.metalness = values.metalness;
    material.roughness = values.roughness;
    material.envMapIntensity = values.envMapIntensity;
    if(material.isMeshPhysicalMaterial) {
        material.clearcoat = values.clearcoat;
        material.clearcoatRoughness = values.clearcoatRoughness;
    }
    material.opacity = values.opacity;
    // a see-through material does not write to the depth buffer, or what is behind it would disappear
    if(material.userData.originalTransparent === undefined) {
        material.userData.originalTransparent = material.transparent;
        material.userData.originalDepthWrite = material.depthWrite;
    }
    material.transparent = values.opacity < 1 || material.userData.originalTransparent;
    material.depthWrite = values.opacity < 1 ? false : material.userData.originalDepthWrite;
    material.needsUpdate = true;
};

// Applies the overrides of a car configuration ({ "material name": override }) to the materials of some objects
OpenRacer.applyMaterialOverrides = function (THREE, objects, overrides) {
    objects.forEach(function (root) {
        OpenRacer.prepareMaterials(THREE, root).forEach(function (material) {
            OpenRacer.applyMaterialOverride(material, overrides && overrides[material.name]);
        });
    });
};
