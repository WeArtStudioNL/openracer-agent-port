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
var ENVIRONMENT_EVERY = 12; // the lighting of the physically based materials is made again after this many cube map updates
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

window.onresize = function() {
    if(!camera) return; // the game is not running (the main menu has a renderer of its own)
    updateScreenSize();

    renderer.setSize( SCREEN_WIDTH, SCREEN_HEIGHT );
    camera.aspect = SCREEN_WIDTH / SCREEN_HEIGHT;
    camera.updateProjectionMatrix();
    
    // the buffers of the post-processing are sized in device pixels (the composer takes care of that)
    if(useComposer) {
        composer.setSize( SCREEN_WIDTH, SCREEN_HEIGHT );
    }
};

RACER.Scene = function (parameters, domElement) {
    this.init = function() {
        container = document.createElement( 'div' );
        document.body.appendChild( container );

        // with post-processing the anti-aliasing is done on the buffer of the composer
        renderer = new THREE.WebGLRenderer( { antialias: !useComposer } );
        renderer.setPixelRatio( window.devicePixelRatio );
        applyToneMapping(Settings.option("toneMapping"));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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
            var pixelRatio = renderer.getPixelRatio();
            var renderTarget = new THREE.WebGLRenderTarget(
                Math.floor( SCREEN_WIDTH * pixelRatio ), Math.floor( SCREEN_HEIGHT * pixelRatio ),
                { type: THREE.HalfFloatType, samples: 4 } );
            composer = new THREE.EffectComposer( renderer, renderTarget );
            
            composer.addPass( new THREE.RenderPass( scene, camera ) );
            
            var effectColor = new THREE.ShaderPass( THREE.ColorCorrectionShader );
            effectColor.uniforms[ 'mulRGB' ].value.set( 1.2, 1.2, 1.2 );
            effectColor.uniforms[ 'powRGB' ].value.set( 1.1, 1.1, 1.1 );
            composer.addPass( effectColor );

            var effectVignette = new THREE.ShaderPass( THREE.VignetteShader );
            effectVignette.uniforms[ "darkness" ].value = 1.2;
            composer.addPass( effectVignette );

            // converts the picture to the colours of the screen
            composer.addPass( new THREE.OutputPass() );
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
    if(enableCubeCamera && car) {
        if(cubeCount > cubeUpdate) {
            //console.log("cub");
            cubeCamera.position.copy(car.body.position);

            // Hide everything that samples the cube map while it is being rendered. Modern
            // browsers reject drawing with a texture that is also the framebuffer
            // ("feedback loop"), which corrupts the whole frame. The wheels use the same
            // reflective materials as the body.
            car.body.visible = false;
            for(var w = 0; w < car.wheels.length; w++) {
                car.wheels[w].object.visible = false;
            }

            //renderer.autoClear = true;
            cubeCamera.update( renderer, scene );
            //renderer.autoClear = false;

            car.body.visible = true;
            for(var w = 0; w < car.wheels.length; w++) {
                car.wheels[w].object.visible = true;
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
    //camera.position.z += 0.1;
};