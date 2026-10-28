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
 * Scene.js
 * 
 * Author: Chris Barnard
 * Description: Sets up the ThreeJS scene.
 * Notes: Obviously, this is currently a massive mess. There is a lack of
 *        structure in this file and the majority of it will need to be
 *        abstracted into a class.
 */

var scene;
var container;
var renderer;
var composer;
var camera;
var cubeUpdate = 2;
var cubeCount = 0;
var environmentCount = 0;
var ENVIRONMENT_EVERY = 3; // the lighting of the physically based materials is made again after this many cube map updates (12 made the glTF cars follow the surroundings only about once a second)
var TONE_MAPPINGS = { none: THREE.NoToneMapping, neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping };

function applyToneMapping(name) {
    renderer.toneMapping = TONE_MAPPINGS[name] !== undefined ? TONE_MAPPINGS[name] : THREE.NoToneMapping;
}
var shadowLight;
var sunLight;          // the main light, see applyTrackEnvironment in TrackLoader.js
var ambientLight;
var sunDirection = new THREE.Vector3(40, 70, 40); // from the car to the sun that casts its shadow
var SCREEN_WIDTH = window.innerWidth;
var SCREEN_HEIGHT = window.innerHeight;

var useComposer = true;
var enableCubeCamera = true;

// Size of the picture in CSS pixels: the whole window, or the upper half while the telemetry is shown
function updateScreenSize() {
    SCREEN_WIDTH = window.innerWidth;
    SCREEN_HEIGHT = window.innerHeight;
    if(telemetry) {
        if(telemetry.visible) {
            SCREEN_HEIGHT *= 0.5;
            SCREEN_HEIGHT = Math.floor(SCREEN_HEIGHT);
        }
    }
}

// A phone or a tablet (a touch screen is the main pointer). The desktop is not touched by anything that depends on this.
function isTouchDevice() {
    if(typeof OpenRacer !== "undefined" && OpenRacer.touchDevice) return OpenRacer.touchDevice();
    try { return window.matchMedia("(pointer: coarse)").matches; } catch(e) { return false; }
}

// The pixel density of the picture. A desktop draws at the density of the screen. A phone has three device pixels per point, which is
// 3.6 million pixels on an iPhone Plus, and the post-processing keeps several half-float buffers of that size (one of them
// multisampled): Safari then ends the page for lack of memory. On a touch device the picture is limited to about two million pixels
// (and a density of 2 at most), which still looks sharp on such a screen.
var TOUCH_PIXEL_BUDGET = 2000000;
function pickPixelRatio() {
    var ratio = window.devicePixelRatio || 1;
    if(!isTouchDevice()) return ratio;
    var fit = Math.sqrt(TOUCH_PIXEL_BUDGET / Math.max(1, window.innerWidth * window.innerHeight));
    return Math.max(1, Math.min(ratio, 2, fit));
}

window.onresize = function() {
    if(!camera) return; // the game is not running (the main menu has a renderer of its own)
    updateScreenSize();

    renderer.setSize( SCREEN_WIDTH, SCREEN_HEIGHT );
    camera.aspect = SCREEN_WIDTH / SCREEN_HEIGHT;
    camera.updateProjectionMatrix();
    
    // the buffers of the post-processing are sized in device pixels (the composer takes care of that)
    if(useComposer) {
        OpenRacer.Graphics.setSize( SCREEN_WIDTH, SCREEN_HEIGHT );
    }
};

RACER.Scene = function (parameters, domElement) {
    this.init = function() {
        container = document.createElement( 'div' );
        document.body.appendChild( container );

        // with post-processing the anti-aliasing is done on the buffer of the composer
        renderer = new THREE.WebGLRenderer( { antialias: !useComposer } );
        renderer.setPixelRatio( pickPixelRatio() );
        applyToneMapping(Settings.option("gfxTone"));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // when the browser takes the graphics away (too little memory on the video card), the picture can go wrong without any error: say so
        renderer.domElement.addEventListener("webglcontextlost", function(event) {
            event.preventDefault();
            console.warn("The browser took the graphics away (webglcontextlost).");
            var note = document.createElement("div");
            note.id = "contextLostNote";
            note.style.cssText = "position: fixed; left: 50%; top: 20px; transform: translateX(-50%); z-index: 5000; padding: 10px 18px; background: rgba(120, 30, 20, 0.92); color: #fff; font: 15px Arial; border-radius: 8px;";
            note.textContent = "The browser reset the graphics. Reload the page if the picture stays wrong.";
            document.body.appendChild(note);
        });
        renderer.domElement.addEventListener("webglcontextrestored", function() {
            console.warn("The graphics are back (webglcontextrestored).");
            var note = document.getElementById("contextLostNote");
            if(note) note.remove();
        });

        camera = new THREE.PerspectiveCamera( 35, SCREEN_WIDTH / SCREEN_HEIGHT, 1, 5000 );

        camera.position.x = -130.38620930679173;
        camera.position.y = 5.1395574378241913;
        camera.position.z = 11.5269260973467418;
        
        scene = new THREE.Scene();

        // The lights are meant in physical units: a diffuse surface lit by a light of intensity PI
        // looks as bright as the colour of the light itself.
        var light = new THREE.DirectionalLight( 0xffffff, 0.7 * Math.PI );
        light.position.set( 350, 75, 250 );
        light.target.position.copy( scene.position );
        scene.add( light );
        sunLight = light;

        light = new THREE.PointLight( 0xffffff, Math.PI, 0, 0 );
        light.position.set( 500, 1000, 0 );
        scene.add(light);
        
        light = new THREE.AmbientLight( 0x576777, Math.PI );
        scene.add(light);
        ambientLight = light;

        // The sun that casts the shadow of the car. It follows the car (see Car.js), and its
        // shadow map only covers the surroundings of the car.
        shadowLight = new THREE.DirectionalLight( 0xffffff, 0.5 * Math.PI );
        shadowLight.position.set(40, 70, 40);
        shadowLight.castShadow = true;
        shadowLight.shadow.mapSize.set(1024, 1024);
        shadowLight.shadow.camera.left = -8;
        shadowLight.shadow.camera.right = 8;
        shadowLight.shadow.camera.top = 8;
        shadowLight.shadow.camera.bottom = -8;
        shadowLight.shadow.camera.near = 20;
        shadowLight.shadow.camera.far = 180;
        shadowLight.shadow.bias = -0.0005;
        shadowLight.shadow.normalBias = 0.02;
        shadowLight.shadow.intensity = 0.8;
        scene.add(shadowLight);
        scene.add(shadowLight.target);

        // RENDERER
        renderer.setSize( SCREEN_WIDTH, SCREEN_HEIGHT );
        renderer.setClearColor( 0xf2f7ff, 1 );

        renderer.domElement.style.position = "relative";
        container.appendChild( renderer.domElement );
        
        if(useComposer) {
            // the post-processing chain, made from the graphics options (Graphics.js): anti-aliasing, SSAO, SSGI, the vignette
            OpenRacer.Graphics.init({
                renderer: renderer, scene: scene, camera: camera, shadowLight: shadowLight,
                size: function() { return { width: SCREEN_WIDTH, height: SCREEN_HEIGHT }; },
                basePixelRatio: pickPixelRatio,
                resize: function() { window.onresize(); },
                reflections: function(every) { enableCubeCamera = every > 0; if(every > 0) cubeUpdate = every; },
                onComposer: function(c) { composer = c; }
            });
        }

        animate();
    };
};


function animate() {
    requestAnimationFrame( animate );
    render();
};

var frameCount = 0;
var countStart = 0;
var fps = 0;
var processingSplit = "";

// The picture of the game (the canvas only, so without the HUD) as a PNG file. It is drawn again and copied in the same turn, because the
// canvas is empty again when the browser has shown it.
function takePhoto() {
    if(useComposer) composer.render(); else renderer.render(scene, camera);
    renderer.domElement.toBlob(function(blob) {
        if(!blob) return;
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "openracer-" + (typeof currentTrack !== "undefined" && currentTrack ? currentTrack.id : "photo") + "-" + Date.now() + ".png";
        link.click();
        setTimeout(function() { URL.revokeObjectURL(link.href); }, 5000);
        if(typeof banner === "function") banner("Photo saved");
    }, "image/png");
}

function render() {
    if(Date.now() - countStart > 1000) {
        fps = frameCount;
        frameCount = 0;
        countStart = Date.now();
        //console.log(fps);
    }
    frameCount++;
    var timeStart = Date.now();
    onEnterFrame();
    var afterCalc = Date.now();
    if(enableCubeCamera && car && car.isReady()) {   // the reflections wait until the car and its wheels have loaded
        if(cubeCount >= cubeUpdate) {          // (cubeUpdate frames between two updates: 1 is every frame; it was > before, which was every other frame)
            //console.log("cub");
            cubeCamera.position.copy(car.body.position);

            // Hide everything that samples the cube map while it is being rendered. Modern
            // browsers reject drawing with a texture that is also the framebuffer
            // ("feedback loop"), which corrupts the whole frame. The wheels use the same
            // reflective materials as the body.
            car.body.visible = false;
            for(var w = 0; w < car.wheels.length; w++) {
                if(car.wheels[w].object) car.wheels[w].object.visible = false;
            }

            //renderer.autoClear = true;
            cubeCamera.update( renderer, scene );
            //renderer.autoClear = false;

            var shown = !(OpenRacer.DebugView && OpenRacer.DebugView.modelsHidden());      // (the debug view can hide the model: the - key)
            car.body.visible = shown;
            for(var w = 0; w < car.wheels.length; w++) {
                if(car.wheels[w].object) car.wheels[w].object.visible = shown;
            }
            cubeCount = 0;
            if(environmentCount++ % ENVIRONMENT_EVERY === 0) updateEnvironment();
        }
        cubeCount++;
    }
    
    if(useComposer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
    var afterRender = Date.now();
    var renderTime = afterRender - afterCalc;
    var calcTime = afterCalc - timeStart;
    var totalTime = afterRender - timeStart;
    processingSplit = Math.round((calcTime / totalTime).toFixed(2) * 100) + "/" + Math.round((renderTime / totalTime).toFixed(2) * 100);
    
    if(fps > 0) {
        debugOut("FPS: " + fps + " (" + processingSplit + ")");
    }
    // what the simulation asked of the triangles of the track in this frame (Ground.js stats): lag on a place of a track is mostly many triangles in a few cells
    if(typeof groundWorld !== "undefined" && groundWorld && groundWorld.stats) {
        var gs = groundWorld.stats;
        if(fps > 0) debugOut("Sim triangles: rays " + gs.rays + " tested " + gs.rayTris + " (most for one ray " + gs.rayMax + ") | shell spheres " + gs.nearby + " gave " + gs.nearbyTris + ", box tests " + gs.boxes + ", exact tests " + gs.closest);
        gs.rays = gs.rayTris = gs.rayMax = gs.nearby = gs.nearbyTris = gs.closest = gs.boxes = 0;
    }
    // the ground condition (Atmosphere.js): wet and snow, and the grip that is left
    if(fps > 0 && OpenRacer.Atmosphere) {
        var ai = OpenRacer.Atmosphere.info();
        if(ai.wet > 0.01 || ai.snow > 0.01) debugOut("Ground: wet " + Math.round(ai.wet * 100) + "%, snow " + Math.round(ai.snow * 100) + "%, the grip of the road " + Math.round(getSurface("road").static / 1.2 * 100) + "% of dry");
    }
    // what a tyre of the player costs: the nodes of its shell and the small steps that it takes in a step of the physics (the cost of the road tests goes with both)
    if(fps > 0 && typeof car !== "undefined" && car && car.vehicle && car.vehicle.wheels) {
        var shell = car.vehicle.wheels[0] && car.vehicle.wheels[0].tyreBody;
        if(shell && shell.substeps) debugOut("Tyre shell: " + shell.rings + " rings x " + shell.segments + " segments = " + (shell.rings * shell.segments) + " nodes a tyre, " + shell.substeps + " substeps in a step of 3 ms");
    }
    //camera.position.z += 0.1;
};