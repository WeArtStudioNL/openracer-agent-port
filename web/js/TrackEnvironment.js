/*
 * TrackEnvironment.js
 *
 * Description: The sky and the light of a track (the "environment" of track.json), shared by the game and the track editor. All of it is
 *              optional; what is missing has a default. A track of the old format has its own sky in its model and keeps it, unless it has an environment.
 *
 *   "environment": {
 *       "sky_top": "#4a82c4", "sky_horizon": "#d3e4f4",       the colours of the sky, overhead and at the horizon
 *       "sky_image": "sky.jpg",                                 a picture of the whole sky (equirectangular) in the folder of the track, instead of the colours
 *       "fog": { "enabled": false, "color": "#cfdbe8", "near": 300, "far": 2500 },
 *       "sun": { "azimuth": 40, "elevation": 45, "intensity": 1, "color": "#ffffff" },   azimuth in degrees from +x towards +z
 *       "ambient": { "color": "#576777", "intensity": 1 }       the light of the sky on everything
 *   }
 *
 * No 3D library is needed to load this file: the functions that make 3D objects get THREE as a parameter.
 */

OpenRacer.environmentDefaults = function() {
    return {
        sky_top: "#4a82c4",
        sky_horizon: "#d3e4f4",
        sky_image: "",
        fog: { enabled: false, color: "#cfdbe8", near: 300, far: 2500 },
        sun: { azimuth: 40, elevation: 45, intensity: 1, color: "#ffffff" },
        ambient: { color: "#576777", intensity: 1 }
    };
};

// The environment of a track configuration, with the defaults for what it does not say
OpenRacer.environmentOf = function(config) {
    var env = OpenRacer.environmentDefaults();
    var given = (config && config.environment) || {};
    ["sky_top", "sky_horizon", "sky_image"].forEach(function(key) {
        if(typeof given[key] === "string") env[key] = given[key];
    });
    ["fog", "sun", "ambient"].forEach(function(key) {
        if(given[key]) Object.keys(env[key]).forEach(function(k) {
            if(given[key][k] !== undefined) env[key][k] = given[key][k];
        });
    });
    return env;
};

// The direction to the sun as a vector of a length, in the axes of the game (y is up, azimuth from +x towards +z)
OpenRacer.sunVector = function(env, length) {
    var az = env.sun.azimuth * Math.PI / 180, el = env.sun.elevation * Math.PI / 180;
    return { x: Math.cos(el) * Math.cos(az) * length, y: Math.sin(el) * length, z: Math.cos(el) * Math.sin(az) * length };
};

// The sky: a big sphere around the camera with the colours (or the picture, a THREE texture) of the environment
OpenRacer.makeSky = function(THREE, env, texture) {
    var material;
    if(texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.repeat.x = -1; // seen from inside
        material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false, fog: false });
    } else {
        material = new THREE.ShaderMaterial({
            uniforms: { top: { value: new THREE.Color(env.sky_top) }, horizon: { value: new THREE.Color(env.sky_horizon) } },
            vertexShader: "varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
            fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;" +
                "void main() { float h = normalize(vDir).y; float t = smoothstep(0.0, 0.7, h); gl_FragColor = vec4(mix(horizon, top, pow(t, 0.8)), 1.0); }",
            side: THREE.BackSide,
            depthWrite: false,
            fog: false
        });
    }
    var sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), material);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    sky.name = "sky";
    // The sky is centred on the camera that draws it, for every render (the main picture, and the cube map of the reflections that is
    // drawn from the car): its matrix is set here, in onBeforeRender, because the matrix that three.js computes at the start of a render is
    // the one of the render before. With that the sky stood a few metres beside the camera in some of the frames, and trembled.
    sky.matrixAutoUpdate = false;
    sky.matrixWorldAutoUpdate = false;
    sky.onBeforeRender = function(renderer, scene, camera) {
        sky.position.copy(camera.position);
        sky.matrixWorld.makeTranslation(camera.position.x, camera.position.y, camera.position.z);
    };
    return sky;
};
