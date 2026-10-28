/*
 * Atmosphere.js
 *
 * Description: The time of day and the weather of the game (the Graphics page of the Escape menu), laid over the environment of the track (TrackEnvironment.js: the sky, the sun,
 *              the light of the sky and the fog that track.json says). With "As the track" and Clear weather nothing changes: the light is the one of track.json.
 *
 *              Time of day (gfxTime, the hour 0 to 24, or -1 for as the track): the sun goes over the sky (it rises at 5:00, is highest at 12:00 and sets at 19:00, its place round the
 *              compass turns with the hour), its light gets warm and weak near the horizon, the sky goes orange there and then dark blue, the light of the sky weakens and turns blue and
 *              from dusk to dawn a faint moon light takes over from the sun. There are no headlights: the night is dark, but not black.
 *
 *              Weather (gfxWeather): clear; cloudy (the sun weak, the shadows soft, a grey sky); fog (a short view, a grey world); rain (as cloudy, darker, with a view that ends in the
 *              wet air and rain that falls past the camera). The weather is how it looks: the grip of the road does not change.
 *
 *              OpenRacer.Atmosphere.set(env, sky)   the environment of the track that is loaded and its sky (TrackLoader.applyTrackEnvironment); it applies the options
 *              OpenRacer.Atmosphere.apply()         again, after an option changed
 *
 *              It sets the lights of Scene.js (sunLight, shadowLight, ambientLight, sunDirection), the colours of the sky, the fog and the clear colour.
 * Author:      Glenn Hofman
 * Date:        2026-10-28
 * License:     MIT
 */

OpenRacer.Atmosphere = (function () {
    var base = null, sky = null, rain = null, fog = null, fogWas = null;

    function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
    function colour(hex) { return new THREE.Color(hex); }

    // what the weather does: the share of the sun and of the light of the sky that is left, how grey the sky gets, the softness of the shadows, the view (near, far of the fog; null:
    // as the track), and the rain
    var WEATHER = {
        clear: { sun: 1, sky: 1, grey: 0, shadow: 1, fog: null, rain: false },
        cloudy: { sun: 0.4, sky: 1.15, grey: 0.7, shadow: 0.35, fog: null, rain: false },
        fog: { sun: 0.25, sky: 1.25, grey: 1, shadow: 0.2, fog: [4, 110], rain: false },
        rain: { sun: 0.18, sky: 0.95, grey: 0.9, shadow: 0.12, fog: [15, 380], rain: true, dark: 0.7 }
    };

    function set(env, skyMesh) {
        base = env;
        sky = skyMesh || null;
        apply();
    }

    function apply() {
        if (!base || typeof scene === "undefined" || !scene || !sunLight) return;
        var hour = Settings.option("gfxTime"), kind = Settings.option("gfxWeather");
        var W = WEATHER[kind] || WEATHER.clear;
        var sun = base.sun, az = sun.azimuth, el = sun.elevation;
        var sunColour = colour(sun.color), sunIntensity = sun.intensity;
        var ambientColour = colour(base.ambient.color), ambientIntensity = base.ambient.intensity;
        var top = colour(base.sky_top), horizon = colour(base.sky_horizon);
        var daylight = 1, glow = 0;                          // daylight: 0 at night, 1 by day (for the light of the sky and the colours); glow: the red of the sunrise and the sunset

        if (hour >= 0) {
            var raw = 62 * Math.sin(Math.PI * (hour - 5) / 14);                         // the height of the sun: -62 (midnight) to 62 (noon) degrees
            el = raw;
            az = base.sun.azimuth + (hour - 12) * 15;
            daylight = smooth(-12, 8, raw);                                             // the twilight goes on below the horizon
            glow = Math.exp(-Math.pow((raw - 2) / 8, 2)) * (raw > -10 ? 1 : 0);
            sunColour.lerp(colour("#ff9a4d"), Math.min(1, glow * 0.9));
            sunIntensity = base.sun.intensity * smooth(-1, 10, raw);
            if (raw < -1) {                                                             // the moon takes over, from another side of the sky
                el = 42; az += 180;
                sunColour.set("#9fb6ff");
                sunIntensity = base.sun.intensity * 0.14 * smooth(-1, -10, raw);
            }
            ambientColour.lerp(colour("#1d2b52"), 1 - daylight);
            ambientIntensity = base.ambient.intensity * (0.22 + 0.78 * daylight);
            top.lerp(colour("#050a1e"), 1 - daylight);
            horizon.lerp(colour("#0d1631"), 1 - daylight);
            horizon.lerp(colour("#ff8a4a"), Math.min(1, glow * 0.65) * smooth(-10, 0, raw));
            top.lerp(colour("#7a5a8a"), glow * 0.18);
        }

        // the weather: the grey of the sky follows the daylight, the light is weaker
        if (W.grey > 0) {
            var grey = colour("#aab3bd").multiplyScalar((0.1 + 0.9 * daylight) * (W.dark || 1));
            top.lerp(grey.clone().multiplyScalar(0.8), W.grey * 0.9);
            horizon.lerp(grey, W.grey);
            ambientColour.lerp(grey, W.grey * 0.5);
        }
        sunIntensity *= W.sun;
        ambientIntensity *= W.sky * (W.dark || 1);

        // the lights, as TrackLoader.applyTrackEnvironment sets them
        var v = OpenRacer.sunVector({ sun: { azimuth: az, elevation: el } }, 1000);
        sunLight.position.set(v.x, v.y, v.z);
        sunLight.color.copy(sunColour);
        sunLight.intensity = 0.7 * Math.PI * sunIntensity;
        shadowLight.color.copy(sunColour);
        shadowLight.intensity = 0.5 * Math.PI * sunIntensity;
        shadowLight.shadow.intensity = 0.8 * W.shadow;
        var sv = OpenRacer.sunVector({ sun: { azimuth: az, elevation: el } }, 91);
        sunDirection.set(sv.x, sv.y, sv.z);
        ambientLight.color.copy(ambientColour);
        ambientLight.intensity = Math.PI * ambientIntensity;

        // the sky: the colours of the shader, or the tint of a picture
        if (sky && sky.material) {
            var m = sky.material;
            if (m.uniforms && m.uniforms.top) { m.uniforms.top.value.copy(top); m.uniforms.horizon.value.copy(horizon); }
            else if (m.color) {
                var lit = daylight * daylight;                      // (a picture of a day sky goes dark sooner than the light does)
                var tint = colour("#ffffff").multiplyScalar(0.05 + 0.95 * lit);
                tint.lerp(colour("#ff9d6a").multiplyScalar(0.05 + 0.95 * lit), Math.min(1, glow * 0.6));
                tint.lerp(colour("#7f8fc0").multiplyScalar(0.05 + 0.95 * lit), (1 - daylight) * 0.6);
                if (W.grey > 0) tint.lerp(colour("#9aa2ac").multiplyScalar((0.05 + 0.95 * lit) * (W.dark || 1)), Math.min(1, W.grey * 0.9));       // (the sky picture goes grey: the weather)
                m.color.copy(tint);
            }
        }

        // the view: the fog of the weather, or the one of the track in the colour of the sky now
        var fogRange = W.fog || (base.fog.enabled ? [base.fog.near, base.fog.far] : null);
        if (fogRange) {
            if (!fog) fog = new THREE.Fog(horizon, fogRange[0], fogRange[1]);
            fog.color.copy(horizon); fog.near = fogRange[0]; fog.far = fogRange[1];
            scene.fog = fog;
        } else scene.fog = null;
        // (a material is compiled with or without the fog code: when the fog comes or goes, they are made again)
        if (fogWas !== !!scene.fog) {
            if (fogWas !== null) scene.traverse(function (o) { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); });
            fogWas = !!scene.fog;
        }
        renderer.setClearColor(horizon, 1);

        showRain(W.rain);
    }

    // ---- rain: streaks that fall in a box round the camera, moved in the shader (no work on the processor): the box follows the camera in whole steps so that the streaks stay in the world
    function showRain(on) {
        if (on && !rain) rain = makeRain();
        if (rain) { rain.visible = on; if (on && rain.parent !== scene) scene.add(rain); }
    }
    function makeRain() {
        var count = 4000, positions = new Float32Array(count * 6), ends = new Float32Array(count * 2), seeds = new Float32Array(count * 2);
        for (var i = 0; i < count; i++) {
            var x = Math.random() * 40, y = Math.random() * 28, z = Math.random() * 40;
            positions.set([x, y, z, x, y, z], i * 6);
            ends[i * 2] = 0; ends[i * 2 + 1] = 1;
            seeds[i * 2] = seeds[i * 2 + 1] = 0.7 + Math.random() * 0.6;
        }
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("tail", new THREE.BufferAttribute(ends, 1));
        geometry.setAttribute("speed", new THREE.BufferAttribute(seeds, 1));
        var material = new THREE.ShaderMaterial({
            uniforms: { cam: { value: new THREE.Vector3() }, time: { value: 0 }, colour: { value: new THREE.Color("#c9d3de") } },
            vertexShader: "uniform vec3 cam; uniform float time; attribute float tail; attribute float speed; varying float vFade;" +
                "void main() { vec3 p = position; float fall = time * 16.0 * speed;" +
                "p.y = cam.y - 8.0 + mod(p.y - fall, 28.0);" +                                                  // (falls, and starts at the top again)
                "p.x = cam.x + mod(p.x - cam.x + 20.0, 40.0) - 20.0; p.z = cam.z + mod(p.z - cam.z + 20.0, 40.0) - 20.0;" +
                "p.y += tail * 0.9; p.x += tail * 0.08;" +                                                      // (a streak of 0.9 m, a little slanted)
                "vFade = 1.0 - tail * 0.7;" +
                "gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }",
            fragmentShader: "uniform vec3 colour; varying float vFade; void main() { gl_FragColor = vec4(colour, 0.5 * vFade); }",
            transparent: true, depthWrite: false, fog: false
        });
        var mesh = new THREE.LineSegments(geometry, material);
        mesh.name = "rain";
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        mesh.onBeforeRender = function (renderer, scene, camera) {
            material.uniforms.cam.value.copy(camera.position);
            material.uniforms.time.value = performance.now() / 1000;
        };
        return mesh;
    }

    return { set: set, apply: apply, WEATHER: WEATHER };
})();
