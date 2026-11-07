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
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { ColorCorrectionShader } from "three/addons/shaders/ColorCorrectionShader.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// the module namespace of three.js is read-only; copy it to be able to add the add-ons
window.THREE = Object.assign({}, THREE_MODULE, {
    EffectComposer: EffectComposer,
    RenderPass: RenderPass,
    ShaderPass: ShaderPass,
    GLTFLoader: GLTFLoader,
    mergeGeometries: mergeGeometries,
    OutputPass: OutputPass,
    Pass: Pass,
    FullScreenQuad: FullScreenQuad,
    GTAOPass: GTAOPass,
    ColorCorrectionShader: ColorCorrectionShader,
    VignetteShader: VignetteShader,
    RoomEnvironment: RoomEnvironment
});

var scripts = [
    "js/Surfaces.js",
    "js/Helpers.js",
    "js/Movable.js",
    "js/Version.js",
    "js/Zip.js",
    "js/Garage.js",
    "js/Catalog.js",
    "js/MainMenu.js",
    "js/MaterialOverrides.js",
    "js/CarDefaults.js",
    "js/TrackEnvironment.js",
    "js/SuspensionRig.js",
    "js/PartsLibrary.js",
    "js/WheelLibrary.js",
    "js/TextureBudget.js",
    "js/Chain.js",
    "js/CarLoader.js",
    "js/MaterialLibrary.js",
    "js/Curbs.js",
    "js/TrackLoader.js",
    "js/Graphics.js",
    "js/Atmosphere.js",
    "js/Scene.js",
    "js/EnvironmentExport.js",
    "js/SoftBody.js",
    "js/EngineDamage.js",
    "js/SoftBodyMesh.js",
    "js/Parts.js",
    "js/CollisionProxy.js",
    "js/CarColors.js",
    "js/Car.js",
    "js/RacingLine.js",
    "js/Records.js",
    "js/GateMarkers.js",
    "js/TrackMarks.js",
    "js/RigidObjects.js",
    "js/Ghost.js",
    "js/Opponent.js",
    "js/Pit.js",
    "js/Engine.js",
    "js/Wheel.js",
    "js/PhysicsWasm.js",
    "js/TyreShell.js",
    "js/TyreDeform.js",
    "js/Collision.js",
    "js/Ground.js",
    "js/Smoke.js",
    "js/Debris.js",
    "js/Shatter.js",
    "js/Mirrors.js",
    "js/SkidMarks.js",
    "js/Leaks.js",
    "js/Marbles.js",
    "js/Flames.js",
    "js/Driver.js",
    "js/DebugView.js",
    "js/DragStrip.js",
    "js/Motorcycle.js",
    "js/Vehicle.js",
    "js/VehicleState.js",
    "js/PhysicsLink.js",
    "js/Telemetry.js",
    "js/EngineSim.js",
    "js/EngineBuild.js",
    "js/EngineSound.js",
    "js/WheelControls.js",
    "js/ForceFeedback.js",
    "js/Icons.js",
    "js/HudLayout.js",
    "js/Settings.js",
    "js/PadNav.js",
    "js/FreeCam.js",
    "js/Hud.js",
    "js/CarTuning.js",
    "js/EngineBuildUI.js",
    "js/Tuning.js",
    "js/CameraTrack.js",
    "js/Replay.js",
    "js/Take.js",
    "js/VideoEditor.js",
    "js/TouchControls.js",
    "js/controls.js",
    "js/main.js"
];

// the scripts get the same ?v=... as this file (see index.html), so a new version is not served from the cache of the browser
var version = new URL(import.meta.url).search;

function loadScript(src) {
    return new Promise(function (resolve, reject) {
        var element = document.createElement("script");
        element.src = src + version;
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
