/*
 * bootstrap.js
 *
 * three.js is an ES module, while the rest of the game consists of ordinary scripts that share
 * global variables. This module loads three.js (with the post-processing it needs) and makes it
 * available as the global THREE, and then loads the scripts of the game one by one, in order.
 */

import * as THREE_MODULE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ColorCorrectionShader } from "three/addons/shaders/ColorCorrectionShader.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";

// the module namespace of three.js is read-only; copy it to be able to add the add-ons
window.THREE = Object.assign({}, THREE_MODULE, {
    EffectComposer: EffectComposer,
    RenderPass: RenderPass,
    ShaderPass: ShaderPass,
    GLTFLoader: GLTFLoader,
    OutputPass: OutputPass,
    ColorCorrectionShader: ColorCorrectionShader,
    VignetteShader: VignetteShader
});

var scripts = [
    "js/Helpers.js",
    "js/Catalog.js",
    "js/MainMenu.js",
    "js/MaterialOverrides.js",
    "js/CarDefaults.js",
    "js/TrackEnvironment.js",
    "js/CarLoader.js",
    "js/MaterialLibrary.js",
    "js/TrackLoader.js",
    "js/Scene.js",
    "js/EnvironmentExport.js",
    "js/Car.js",
    "js/Engine.js",
    "js/Wheel.js",
    "js/Collision.js",
    "js/Ground.js",
    "js/Smoke.js",
    "js/Vehicle.js",
    "js/Telemetry.js",
    "js/EngineSynth.js",
    "js/EngineSampler.js",
    "js/EngineSim.js",
    "js/EngineSound.js",
    "js/WheelControls.js",
    "js/Settings.js",
    "js/Hud.js",
    "js/Tuning.js",
    "js/controls.js",
    "js/main.js"
];

function loadScript(src) {
    return new Promise(function (resolve, reject) {
        var element = document.createElement("script");
        element.src = src;
        element.async = false;
        element.onload = resolve;
        element.onerror = function () { reject(new Error("Could not load " + src)); };
        document.head.appendChild(element);
    });
}

scripts.reduce(function (previous, src) {
    return previous.then(function () { return loadScript(src); });
}, Promise.resolve()).catch(function (error) {
    console.error(error);
    var banner = document.createElement("div");
    banner.style.cssText = "position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 1001; " +
        "padding: 10px 20px; background: rgba(160, 0, 0, 0.85); color: #ffffff; font-family: Arial;";
    banner.textContent = error.message;
    document.body.appendChild(banner);
});
