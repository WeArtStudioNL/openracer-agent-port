/*
 * Atmosphere.js
 *
 * Description: The sky, the light, the weather and the condition of the ground of the game (the Graphics page of the Escape menu). The sky is the same on every track: a sky that is
 *              made here, in a shader, from the time of day and the weather (no picture, no environment map of the track), so that the sun, the moon, the stars, the clouds, the light and
 *              the fog all go together. The track only gives how bright its materials like the light (the intensities of the "environment" of track.json).
 *
 *              Time of day (gfxTime, the hour 0 to 24): the sun goes over the sky (it rises at 5:00, is highest at 12:00 and sets at 19:00; gfxSunAzimuth is where it stands at noon, a compass
 *              heading), its light gets warm and weak near the horizon, the sky goes orange there and then dark blue, the light of the sky weakens and turns blue, and from dusk to dawn the
 *              moon gives a faint light (gfxMoon: its phase, 0 new to 1 full; it stands where the sun stood that many hours later, so a full moon is opposite the sun) under the stars.
 *
 *              Weather (gfxWeather): clear, cloudy, fog, rain and snow: the clouds, the sun and the sky light, the view (fog), and rain or snow that falls past the camera.
 *
 *              The ground (gfxGround: auto follows the weather; dry, wet, snow fix it): rain wets the road within a minute and it dries again in a few minutes after; snow builds up on the
 *              ground while it falls (a few minutes to cover it) and stays, melting slowly (faster in rain). A wet road is darker and shinier and has less grip; snow turns what faces up white
 *              and has a lot less grip (Helpers.js, setGroundCondition: the surfaces give less friction, for the car and for the AI, which then drives slower).
 *
 *              OpenRacer.Atmosphere.attach(env)   the track is loaded (TrackLoader.applyTrackEnvironment): makes the sky, puts the weather and the ground on the surfaces of the track
 *              OpenRacer.Atmosphere.apply()       after an option changed
 *              OpenRacer.Atmosphere.update(dt)    every frame: the ground changes with the weather
 *              OpenRacer.Atmosphere.info()        { wet, snow, grip, weather, hour } for the debug text
 * Author:      Glenn Hofman
 * Date:        2026-10-28
 * License:     MIT
 */

OpenRacer.Atmosphere = (function () {
    var base = null, sky = null, rain = null, snowfall = null, fog = null, fogWas = null, attached = false, lastWeather = null;
    var ground = { wet: 0, snow: 0, lastGrip: -1, uniforms: { uWet: { value: 0 }, uSnow: { value: 0 } } };

    function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
    function colour(hex) { return new THREE.Color(hex); }
    function opt(name) { return Settings.option(name); }

    // what the weather does: the share of the sun and of the light of the sky that is left, how grey the sky gets, the clouds (how much of the sky they cover), the softness of the
    // shadows, the view (near, far of the fog; null: none), and what falls
    var WEATHER = {
        clear: { sun: 1, sky: 1, grey: 0, cover: 0.4, shadow: 1, fog: null, fall: null },
        cloudy: { sun: 0.4, sky: 1.15, grey: 0.6, cover: 0.78, shadow: 0.35, fog: null, fall: null },
        fog: { sun: 0.25, sky: 1.25, grey: 1, cover: 0.9, shadow: 0.2, fog: [4, 110], fall: null },
        rain: { sun: 0.18, sky: 0.95, grey: 0.9, cover: 0.97, shadow: 0.12, fog: [15, 380], fall: "rain", dark: 0.7 },
        snow: { sun: 0.3, sky: 1.2, grey: 0.75, cover: 0.9, shadow: 0.2, fog: [10, 300], fall: "snow" }
    };

    // ---- the sky: a sphere round the camera drawn at the far plane, last of the opaque things (so that only the pixels that nothing covers are worked out)
    var SKY_VERTEX = "varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }";
    var SKY_FRAGMENT = [
        "uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 moonDir; uniform vec3 cloudColor; uniform vec3 cloudShade;",
        "uniform float cover; uniform float stars; uniform float moonPhase; uniform float time; uniform float sunVis; uniform float moonVis; uniform float haze;",
        "varying vec3 vDir;",
        "float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
        "float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
        "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }",
        "float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }",
        "void main() {",
        "  vec3 d = normalize(vDir); float h = d.y;",
        "  vec3 col = mix(horizon, top, pow(smoothstep(0.0, 0.7, max(h, 0.0)), 0.8));",
        "  float sd = max(dot(d, sunDir), 0.0);",
        "  col += sunColor * (pow(sd, 6.0) * 0.16 + pow(sd, 80.0) * 0.4) * sunVis;",                                      // the glow round the sun
        "  if (stars > 0.01 && h > 0.0) {",                                                                                   // the stars: points of a grid over the sky, a few in a hundred
        "    vec3 q = d * 150.0; vec3 c = floor(q); float r = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);",
        "    vec3 f = fract(q) - 0.5; float tw = 0.65 + 0.35 * sin(time * 2.0 + r * 60.0);",
        "    col += vec3(1.0, 0.97, 0.9) * step(0.9965, r) * smoothstep(0.35, 0.0, length(f)) * stars * tw * smoothstep(0.0, 0.2, h); }",
        "  float disc = smoothstep(cos(0.0125), cos(0.0095), dot(d, sunDir));",                                              // the sun
        "  col = mix(col, sunColor * 10.0, disc * sunVis);",
        "  float md = dot(d, moonDir);",                                                                                      // the moon, with its phase and a few darker seas
        "  if (md > 0.9985 && moonVis > 0.01) {",
        "    vec3 up = abs(moonDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);",
        "    vec3 tx = normalize(cross(up, moonDir)); vec3 ty = cross(moonDir, tx);",
        "    vec2 p = vec2(dot(d, tx), dot(d, ty)) / 0.016; float r2 = dot(p, p);",
        "    if (r2 < 1.0) {",
        "      vec3 n = vec3(p, sqrt(1.0 - r2)); float th = (1.0 - moonPhase) * 3.14159265; vec3 l = vec3(sin(th), 0.0, cos(th));",
        "      float lit = smoothstep(-0.03, 0.05, dot(n, l));",
        "      float seas = fbm(p * 2.6 + 3.0);",
        "      vec3 moon = vec3(0.95, 0.94, 0.88) * (0.82 - 0.34 * smoothstep(0.45, 0.65, seas));",
        "      col = mix(col, moon * (0.03 + 1.7 * lit), smoothstep(1.0, 0.92, r2) * moonVis); } }",
        "  if (h > -0.02) {",                                                                                                  // the clouds: noise over a plane that is far above, thinner at the horizon
        "    vec2 uv = d.xz / (max(h, 0.0) + 0.22) * 0.75 + vec2(time * 0.006, time * 0.0025);",
        "    float n = fbm(uv * 2.3); float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.3, n) * smoothstep(0.0, 0.1, h);",
        "    vec3 cc = mix(cloudColor, cloudShade, smoothstep(0.42, 0.85, n) * 0.65);",
        "    cc += sunColor * pow(sd, 10.0) * 0.3 * sunVis;",                                                                  // the light at the edge of a cloud towards the sun
        "    col = mix(col, cc, dens * 0.94); }",
        "  col = mix(col, horizon, haze * smoothstep(0.3, 0.0, h));",
        "  gl_FragColor = vec4(col, 1.0); }"
    ].join("\n");

    function makeSky() {
        var material = new THREE.ShaderMaterial({
            uniforms: {
                top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() },
                moonDir: { value: new THREE.Vector3(0, -1, 0) }, cloudColor: { value: new THREE.Color() }, cloudShade: { value: new THREE.Color() },
                cover: { value: 0.2 }, stars: { value: 0 }, moonPhase: { value: 1 }, time: { value: 0 }, sunVis: { value: 1 }, moonVis: { value: 0 }, haze: { value: 0.3 }
            },
            vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false, fog: false
        });
        var mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), material);
        mesh.renderOrder = 100;
        mesh.frustumCulled = false;
        mesh.name = "sky";
        // centred on the camera that draws it, for every render (the main picture and the cube map of the reflections), as TrackEnvironment.makeSky does
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
        mesh.onBeforeRender = function (renderer, scene, camera) {
            material.uniforms.time.value = performance.now() / 1000;
            var scale = Math.min(1, camera.far * 0.9 / 3000);
            mesh.matrixWorld.makeScale(scale, scale, scale).setPosition(camera.position.x, camera.position.y, camera.position.z);
        };
        return mesh;
    }

    // ---- the ground: the surfaces of the track get a wet and a snow look from two numbers (shared by all of them, set every frame)
    function patchMaterial(m) {
        if (!m || m.userData.groundPatched || !m.isMeshStandardMaterial) return;
        m.userData.groundPatched = true;
        var previous = m.onBeforeCompile;
        m.onBeforeCompile = function (shader, renderer) {
            if (previous) previous.call(m, shader, renderer);
            shader.uniforms.uWet = ground.uniforms.uWet; shader.uniforms.uSnow = ground.uniforms.uSnow;
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vGroundNormal; varying vec3 vGroundPos;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGroundNormal = normalize(mat3(modelMatrix) * objectNormal); vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", "#include <common>\nuniform float uWet; uniform float uSnow; varying vec3 vGroundNormal; varying vec3 vGroundPos;\n" +
                    "float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n" +
                    "float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y); }")
                .replace("#include <color_fragment>", "#include <color_fragment>\n" +
                    "float gUp = clamp(normalize(vGroundNormal).y, 0.0, 1.0);\n" +
                    "float gFlat = smoothstep(0.45, 0.85, gUp);\n" +
                    "float gSnow = 0.0;\n" +
                    "if (uSnow > 0.003) { float gn = 0.55 * gNoise(vGroundPos.xz * 0.6) + 0.3 * gNoise(vGroundPos.xz * 2.7) + 0.15 * gNoise(vGroundPos.xz * 11.0); gSnow = smoothstep(0.0, 0.35, uSnow * 1.25 - gn * 0.55) * gFlat; }\n" +
                    "float gWet = uWet * smoothstep(0.35, 0.8, gUp) * (1.0 - gSnow);\n" +
                    "diffuseColor.rgb *= mix(1.0, 0.58, gWet);\n" +
                    "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.84, 0.9) * (0.9 + 0.2 * gNoise(vGroundPos.xz * 30.0)), gSnow * 0.93);")
                .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, gWet); roughnessFactor = mix(roughnessFactor, 0.88, gSnow);");
        };
        m.customProgramCacheKey = function () { return "ground"; };
        m.needsUpdate = true;
    }
    // the surfaces of the track: the meshes that are children of the scene itself (the cars and their wheels are groups, with the meshes inside)
    function patchTrack() {
        scene.children.forEach(function (o) {
            if (!o.isMesh || o === sky || !o.material || o.name === "rain" || o.name === "snow") return;
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(patchMaterial);
        });
    }

    // ---- what falls: streaks of rain and flakes of snow in a box round the camera, moved in the shader (no work for the processor)
    function makeFall(kind) {
        var rainy = kind === "rain", count = rainy ? 4000 : 3500;
        var positions = new Float32Array(count * (rainy ? 6 : 3)), tails = new Float32Array(count * (rainy ? 2 : 1)), seeds = new Float32Array(count * (rainy ? 2 : 1));
        for (var i = 0; i < count; i++) {
            var x = Math.random() * 40, y = Math.random() * 28, z = Math.random() * 40, k = 0.7 + Math.random() * 0.6;
            if (rainy) { positions.set([x, y, z, x, y, z], i * 6); tails[i * 2] = 0; tails[i * 2 + 1] = 1; seeds[i * 2] = seeds[i * 2 + 1] = k; }
            else { positions.set([x, y, z], i * 3); tails[i] = Math.random(); seeds[i] = k; }
        }
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("tail", new THREE.BufferAttribute(tails, 1));
        geometry.setAttribute("speed", new THREE.BufferAttribute(seeds, 1));
        var vertex = "uniform vec3 cam; uniform float time; attribute float tail; attribute float speed; varying float vFade;" +
            "void main() { vec3 p = position; float fall = time * " + (rainy ? "16.0" : "1.6") + " * speed;" +
            "p.y = cam.y - 8.0 + mod(p.y - fall, 28.0);" +
            "p.x = cam.x + mod(p.x - cam.x + 20.0, 40.0) - 20.0; p.z = cam.z + mod(p.z - cam.z + 20.0, 40.0) - 20.0;" +
            (rainy ? "p.y += tail * 0.9; p.x += tail * 0.08; vFade = 1.0 - tail * 0.7; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }"
                   : "p.x += sin(time * 0.7 + position.z) * 0.6 * speed; p.z += cos(time * 0.6 + position.x) * 0.5 * speed; vFade = 0.55 + 0.45 * tail; vec4 mv = viewMatrix * vec4(p, 1.0); gl_PointSize = (2.2 + 2.0 * tail) * 300.0 / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }");
        var fragment = rainy ? "uniform vec3 colour; varying float vFade; void main() { gl_FragColor = vec4(colour, 0.5 * vFade); }"
            : "uniform vec3 colour; varying float vFade; void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.15, length(c)); gl_FragColor = vec4(colour, 0.85 * a * vFade); }";
        var material = new THREE.ShaderMaterial({
            uniforms: { cam: { value: new THREE.Vector3() }, time: { value: 0 }, colour: { value: new THREE.Color(rainy ? "#c9d3de" : "#ffffff") } },
            vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, fog: false
        });
        var mesh = rainy ? new THREE.LineSegments(geometry, material) : new THREE.Points(geometry, material);
        mesh.name = rainy ? "rain" : "snow";
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        mesh.onBeforeRender = function (renderer, scene, camera) { material.uniforms.cam.value.copy(camera.position); material.uniforms.time.value = performance.now() / 1000; };
        return mesh;
    }
    function showFall(kind) {
        if (kind === "rain" && !rain) rain = makeFall("rain");
        if (kind === "snow" && !snowfall) snowfall = makeFall("snow");
        [[rain, "rain"], [snowfall, "snow"]].forEach(function (e) {
            if (!e[0]) return;
            e[0].visible = kind === e[1];
            if (e[0].visible && e[0].parent !== scene) scene.add(e[0]);
        });
    }

    // ---- the light, the sky, the fog: from the hour and the weather
    function hourNow() { var h = opt("gfxTime"); return h >= 0 ? h : 14; }
    function sunHeight(hour) { return 62 * Math.sin(Math.PI * (hour - 5) / 14); }          // degrees: -62 at midnight, 62 at noon, 0 at 5:00 and 19:00

    function apply() {
        if (!attached || typeof scene === "undefined" || !scene || !sunLight || !sky) return;
        var hour = hourNow(), kind = opt("gfxWeather"), W = WEATHER[kind] || WEATHER.clear, azimuth = opt("gfxSunAzimuth"), phase = opt("gfxMoon");
        var defaults = OpenRacer.environmentDefaults();
        var raw = sunHeight(hour), az = azimuth + (hour - 12) * 15, el = raw;
        var daylight = smooth(-12, 8, raw);                                                  // 0 at night, 1 by day: the light of the sky and the colours
        var glow = Math.exp(-Math.pow((raw - 2) / 8, 2)) * (raw > -10 ? 1 : 0);              // the red of the sunrise and the sunset
        var sunColour = colour("#ffffff").lerp(colour("#ff9a4d"), Math.min(1, glow * 0.9));
        var sunIntensity = smooth(-1, 10, raw);
        var ambientColour = colour(defaults.ambient.color).lerp(colour("#1d2b52"), 1 - daylight);
        var ambientIntensity = 0.22 + 0.78 * daylight;
        var top = colour(defaults.sky_top).lerp(colour("#050a1e"), 1 - daylight);
        var horizon = colour(defaults.sky_horizon).lerp(colour("#0d1631"), 1 - daylight);
        horizon.lerp(colour("#ff8a4a"), Math.min(1, glow * 0.65) * smooth(-10, 0, raw));
        top.lerp(colour("#7a5a8a"), glow * 0.18);

        // the moon: where the sun stood that many hours later (a full moon is opposite the sun, a new moon is by the sun)
        var moonHour = (hour + 12 * phase) % 24, moonRaw = sunHeight(moonHour), moonAz = azimuth + (moonHour - 12) * 15;
        var moonLight = smooth(-2, 8, moonRaw) * (1 - smooth(-3, 6, raw)) * (0.2 + 0.8 * phase);      // its light: up, the sun down, and how full it is

        // the light that is used: the sun, or the moon when the sun is down
        var lightEl = el, lightAz = az;
        if (raw < -1) { lightEl = Math.max(8, moonRaw); lightAz = moonAz; sunColour.set("#9fb6ff"); sunIntensity = 0.16 * moonLight; }

        // the weather
        var grey = colour("#aab3bd").multiplyScalar((0.1 + 0.9 * daylight) * (W.dark || 1));
        if (W.grey > 0) {
            top.lerp(grey.clone().multiplyScalar(0.8), W.grey * 0.9);
            horizon.lerp(grey, W.grey);
            ambientColour.lerp(grey, W.grey * 0.5);
        }
        sunIntensity *= W.sun;
        ambientIntensity *= W.sky * (W.dark || 1);
        var trackSun = base ? base.sun.intensity : 1, trackSky = base ? base.ambient.intensity : 1;       // (how bright the materials of the track like it)

        var v = OpenRacer.sunVector({ sun: { azimuth: lightAz, elevation: lightEl } }, 1000);
        sunLight.position.set(v.x, v.y, v.z);
        sunLight.color.copy(sunColour);
        sunLight.intensity = 0.7 * Math.PI * sunIntensity * trackSun;
        shadowLight.color.copy(sunColour);
        shadowLight.intensity = 0.5 * Math.PI * sunIntensity * trackSun;
        shadowLight.shadow.intensity = 0.8 * W.shadow;
        var sv = OpenRacer.sunVector({ sun: { azimuth: lightAz, elevation: lightEl } }, 91);
        sunDirection.set(sv.x, sv.y, sv.z);
        ambientLight.color.copy(ambientColour);
        ambientLight.intensity = Math.PI * ambientIntensity * trackSky;

        // the sky
        var u = sky.material.uniforms, sd = OpenRacer.sunVector({ sun: { azimuth: az, elevation: el } }, 1), md = OpenRacer.sunVector({ sun: { azimuth: moonAz, elevation: moonRaw } }, 1);
        u.top.value.copy(top); u.horizon.value.copy(horizon);
        u.sunDir.value.set(sd.x, sd.y, sd.z);
        u.sunColor.value.copy(colour("#ffffff").lerp(colour("#ff9a4d"), Math.min(1, glow * 0.9)).multiplyScalar(0.5 + 0.5 * smooth(-4, 6, raw)));
        u.moonDir.value.set(md.x, md.y, md.z);
        u.moonPhase.value = phase;
        u.sunVis.value = (1 - Math.min(1, W.cover * 1.1)) * smooth(-2, 3, raw);
        u.moonVis.value = (1 - Math.min(1, W.cover * 1.15)) * (1 - smooth(-6, 4, raw)) * smooth(-3, 3, moonRaw);
        u.stars.value = (1 - smooth(-14, -3, raw)) * (1 - Math.min(1, W.cover * 1.2));
        u.cover.value = W.cover;
        var cloudBase = colour("#ffffff").lerp(grey.clone().multiplyScalar(1.15), Math.min(1, W.grey * 1.1)).multiplyScalar(0.12 + 0.88 * daylight);
        cloudBase.lerp(colour("#ff9d6a").multiplyScalar(0.12 + 0.88 * daylight), Math.min(1, glow * 0.5) * (1 - W.grey * 0.6));
        u.cloudColor.value.copy(cloudBase);
        u.cloudShade.value.copy(cloudBase).multiplyScalar(0.55);
        u.haze.value = W.fog ? 0.9 : 0.35;

        // the view: the fog of the weather, in the colour of the horizon
        if (W.fog) {
            if (!fog) fog = new THREE.Fog(horizon, W.fog[0], W.fog[1]);
            fog.color.copy(horizon); fog.near = W.fog[0]; fog.far = W.fog[1];
            scene.fog = fog;
        } else scene.fog = null;
        if (fogWas !== !!scene.fog) {                                                         // (a material is compiled with or without the fog code)
            if (fogWas !== null) scene.traverse(function (o) { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); });
            fogWas = !!scene.fog;
        }
        renderer.setClearColor(horizon, 1);
        showFall(W.fall);
        // the ground follows the weather from here on; the first time it starts as the weather would have left it
        if (lastWeather === null) startGround(kind);
        lastWeather = kind;
        groundOverride();
    }

    // ---- the ground condition: wet and snow, 0 to 1
    function startGround(kind) {
        ground.wet = kind === "rain" ? 0.9 : 0;
        ground.snow = kind === "snow" ? 0.55 : 0;
        pushGround(true);
    }
    // fixed by the option: dry, wet or snow set the ground at once; auto leaves it to the weather
    function groundOverride() {
        var g = opt("gfxGround");
        if (g === "dry") { ground.wet = 0; ground.snow = 0; }
        else if (g === "wet") { ground.wet = 1; ground.snow = 0; }
        else if (g === "snow") { ground.wet = 0; ground.snow = 1; }
        else return;
        pushGround(true);
    }
    function pushGround(force) {
        ground.uniforms.uWet.value = ground.wet; ground.uniforms.uSnow.value = ground.snow;
        var grip = (1 - 0.28 * ground.wet) * (1 - 0.62 * ground.snow);
        if (force || Math.abs(grip - ground.lastGrip) > 0.004) { ground.lastGrip = grip; if (typeof setGroundCondition === "function") setGroundCondition(ground.wet, ground.snow); }
    }
    // every frame: rain wets the road in about 40 s and it dries in about 3 minutes; snow covers the ground in about 2.5 minutes and melts in about 7 (rain melts it in 2)
    function update(delta) {
        if (!attached) return;
        delta = Math.min(delta || 0, 0.25);
        if (opt("gfxGround") !== "auto") { groundOverride(); return; }
        var kind = opt("gfxWeather"), snowing = kind === "snow", raining = kind === "rain";
        if (raining) { ground.wet = Math.min(1, ground.wet + delta / 40); ground.snow = Math.max(0, ground.snow - delta / 120); }
        else {
            ground.wet = Math.max(0, ground.wet - delta / 180);
            if (snowing) ground.snow = Math.min(1, ground.snow + delta / 150);
            else if (ground.snow > 0) ground.snow = Math.max(0, ground.snow - delta / 420);
        }
        if (snowing) ground.wet = Math.max(0, ground.wet - delta / 20);
        pushGround(false);
    }

    function attach(env) {
        base = env || null;
        if (!attached || !sky || !sky.parent) {
            sky = makeSky();
            scene.add(sky);
            attached = true;
        }
        patchTrack();
        apply();
    }

    function info() { return { wet: ground.wet, snow: ground.snow, grip: ground.lastGrip < 0 ? 1 : ground.lastGrip, weather: opt("gfxWeather"), hour: hourNow() }; }

    return { attach: attach, apply: apply, update: update, info: info, WEATHER: WEATHER };
})();
