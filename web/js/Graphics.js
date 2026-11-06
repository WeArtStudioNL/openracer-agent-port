/*
 * Graphics.js
 *
 * Description: The graphics settings of the game (the Graphics page of the Escape menu): the resolution, the anti-aliasing, the shadows, how
 *              often the reflections are made again, and the screen space effects: ambient occlusion (SSAO, the GTAO of three.js) and global
 *              illumination (SSGI, a pass of our own, below). It makes the post-processing chain (the composer of Scene.js) from the options and
 *              makes it again when one of them changes.
 *
 *              The screen space effects read a picture of the normals and the depth of the scene (GBufferPass: the scene once more, with a
 *              normal material), so they cost a second pass over the scene; both are off in the presets that do not need them.
 *
 *              SSGI: for every pixel it looks at a few dozen other pixels around it (a ring that grows with the distance of the surface) and
 *              takes the light that they give off towards it: the colour of such a pixel, weighted by how much that pixel faces this one and
 *              this one faces it, and by the distance. That light is found at half the resolution, smoothed with a blur that follows the
 *              edges (depth and normal), and added to the picture times the colour of the surface (guessed from the picture: its colour with most of
 *              its brightness divided out, so the bounce also shows in the shade): a red car lights the road next to it red,
 *              a sunlit wall lights the shade at its foot. It is one bounce of what the screen shows, not the real thing: what is not on the
 *              screen gives no light.
 */

OpenRacer.Graphics = (function () {
    var PRESETS = {
        low: { gfxResolution: 720, gfxAA: 0, gfxShadows: 1, gfxReflections: 1, gfxAO: 0, gfxGI: 0, gfxVignette: false, gfxSmoke: 50, gfxDistance: 500, gfxAniso: 2, gfxSharpen: 0 },
        medium: { gfxResolution: "native", gfxAA: 2, gfxShadows: 2, gfxReflections: 1, gfxAO: 0, gfxGI: 0, gfxVignette: true, gfxSmoke: 75, gfxDistance: 1000, gfxAniso: 4, gfxSharpen: 0 },
        high: { gfxResolution: "native", gfxAA: 4, gfxShadows: 2, gfxReflections: 2, gfxAO: 0, gfxGI: 0, gfxVignette: true, gfxSmoke: 100, gfxDistance: 2000, gfxAniso: 8, gfxSharpen: 1 },
        ultra: { gfxResolution: "native", gfxAA: 4, gfxShadows: 3, gfxReflections: 2, gfxAO: 2, gfxGI: 1, gfxVignette: true, gfxSmoke: 100, gfxDistance: 5000, gfxAniso: 16, gfxSharpen: 2 }
    };
    var SHARPEN = [0, 0.18, 0.35, 0.55];                  // the strength of the sharpening (gfxSharpen: Off, Low, Medium, High)
    var SHADOW_SIZES = [0, 512, 1024, 2048, 4096];
    var REFLECTION_EVERY = [0, 8, 1];                     // the frames between two updates of the cube map of the reflections (0: not at all)
    var ENVIRONMENT_UPDATES = [0, 3, 1];                  // after how many of those the lighting of the glTF cars (the filtered cube map) is made again

    var ctx = null;                                       // { renderer, scene, camera, shadowLight, size() }
    var passes = {};

    function opt(name) { return Settings.option(name); }
    function touch() { try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } }

    function seeThrough(material) { var m = Array.isArray(material) ? material[0] : material; return !!(m && m.transparent && !m.depthWrite); }

    // ---- the picture of the normals and the depth: the scene with a normal material (as the GTAOPass makes it for itself)
    class GBufferPass extends THREE.Pass {
        constructor(scene, camera, width, height, scale) {
            super();
            this.scene = scene; this.camera = camera;
            this.scale = scale || 1;                       // the picture is smaller than the screen: the effects do not need more, and it costs less
            width = Math.max(1, Math.floor(width * this.scale)); height = Math.max(1, Math.floor(height * this.scale));
            this.needsSwap = false;
            this.depthTexture = new THREE.DepthTexture(width, height);
            this.depthTexture.format = THREE.DepthStencilFormat;
            this.depthTexture.type = THREE.UnsignedInt248Type;
            this.target = new THREE.WebGLRenderTarget(width, height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType, depthTexture: this.depthTexture });
            this.normalTexture = this.target.texture;
            this.material = new THREE.MeshNormalMaterial();
            this.material.blending = THREE.NoBlending;
            // a surface that is drawn on both sides gets the normal of the face that is seen (from the derivatives of the place: flat shading, which three.js does not turn
            // with the side): the stored normals of such a model can point the other way (the spokes of the rims of the wheel library, the road of a track of the track editor
            // of before) without it showing in the picture, but here the occlusion read them as a surface that faces into the wheel, and the rims went black
            this.doubleMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, flatShading: true });
            this.doubleMaterial.blending = THREE.NoBlending;
            this.hidden = [];
            this.swapped = [];
            this.clearColor = new THREE.Color();
        }
        // the normal material of a mesh that the shell bends: made once for the mesh, with the same bend as its own material
        normalFor(mesh) {
            if (!mesh.geometry || !mesh.geometry.attributes.aNodes) return null;
            var own = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            if (!own || !own.onBeforeCompile) return null;
            var normal = mesh.userData.sbNormal;
            var uniform = mesh.userData.sbUniform || null;             // a part that has come off keeps the bend that it had (SoftBodyMesh.release)
            if (!normal) {
                normal = mesh.userData.sbNormal = new THREE.MeshNormalMaterial();
                normal.blending = THREE.NoBlending;
                normal.onBeforeCompile = own.onBeforeCompile;
                normal.customProgramCacheKey = function () { return "softbodyNormal"; };
                normal.userData.uniform = uniform;
            } else if (normal.userData.uniform !== uniform) {
                normal.userData.uniform = uniform;
                normal.needsUpdate = true;
            }
            return normal;
        }
        setSize(width, height) { this.target.setSize(Math.max(1, Math.floor(width * this.scale)), Math.max(1, Math.floor(height * this.scale))); }
        dispose() { this.target.dispose(); this.material.dispose(); this.doubleMaterial.dispose(); }
        render(renderer) {
            // only meshes count: points, lines and sprites (smoke, skid marks) are not part of the surfaces
            var hidden = this.hidden;
            hidden.length = 0;
            this.scene.traverse(function (o) {
                // (and a see-through surface that does not write the depth, a pit box or a line on the road: it is not in the way of the light, and the pit box has no normals,
                // so it was a black square of occlusion)
                if ((o.isPoints || o.isLine || o.isSprite || (o.isMesh && (o.userData.noGBuffer || seeThrough(o.material)))) && o.visible) { hidden.push(o); o.visible = false; }
            });
            var oldTarget = renderer.getRenderTarget(), oldAuto = renderer.autoClear, oldAlpha = renderer.getClearAlpha();
            renderer.getClearColor(this.clearColor);
            var oldBackground = this.scene.background, oldOverride = this.scene.overrideMaterial, oldShadows = renderer.shadowMap.autoUpdate;
            renderer.shadowMap.autoUpdate = false;                  // the shadow maps were made for the picture of the scene: not again
            renderer.setRenderTarget(this.target);
            renderer.autoClear = false;
            renderer.setClearColor(0x7777ff, 1);
            renderer.clear();
            this.scene.background = null;
            this.scene.overrideMaterial = null;
            // every mesh gets the normal material; one that the shell bends (SoftBodyMesh.js moves its vertices in the vertex shader) gets one that
            // bends it the same way, or the normals and the depth, and the effects that read them (the occlusion), stay where the car was whole
            var swapped = this.swapped;
            swapped.length = 0;
            var plain = this.material, double = this.doubleMaterial, self = this;
            this.scene.traverse(function (o) {
                if (!o.isMesh || !o.visible) return;
                swapped.push(o, o.material);
                var own = Array.isArray(o.material) ? o.material[0] : o.material;
                o.material = self.normalFor(o) || (own && own.side === THREE.DoubleSide ? double : plain);
            });
            renderer.render(this.scene, this.camera);
            renderer.shadowMap.autoUpdate = oldShadows;
            for (var m = 0; m < swapped.length; m += 2) swapped[m].material = swapped[m + 1];
            this.scene.overrideMaterial = oldOverride;
            this.scene.background = oldBackground;
            renderer.setClearColor(this.clearColor, oldAlpha);
            renderer.autoClear = oldAuto;
            renderer.setRenderTarget(oldTarget);
            for (var i = 0; i < hidden.length; i++) hidden[i].visible = true;
        }
    }

    // ---- SSGI
    var VERTEX = "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
    var COMMON = [
        "uniform sampler2D tDepth; uniform sampler2D tNormal; uniform mat4 projInv; uniform mat4 proj;",
        "vec3 viewPos(vec2 uv, float d) { vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec4 v = projInv * c; return v.xyz / v.w; }",
        "vec3 viewNormal(vec2 uv) { return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0); }"
    ].join("\n");
    var GATHER_FRAGMENT = COMMON + [
        "uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float radius; uniform float intensity; varying vec2 vUv;",
        "float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }",
        "void main() {",
        "  float d0 = texture2D(tDepth, vUv).x;",
        "  if (d0 >= 0.99999) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }",
        "  vec3 P = viewPos(vUv, d0); vec3 N = viewNormal(vUv);",
        "  float rUv = min(0.2, radius * 0.5 * proj[1][1] / max(0.2, -P.z));",
        "  float ang = ign(gl_FragCoord.xy) * 6.2831853;",
        "  float aspect = resolution.y / resolution.x;",
        "  vec3 acc = vec3(0.0);",
        "  for (int i = 0; i < SAMPLES; i++) {",
        "    float t = (float(i) + 0.5) / float(SAMPLES);",
        "    float a = ang + float(i) * 2.39996323;",
        "    vec2 suv = vUv + vec2(cos(a) * aspect, sin(a)) * (sqrt(t) * rUv);",
        "    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;",
        "    float sd = texture2D(tDepth, suv).x;",
        "    if (sd >= 0.99999) continue;",
        "    vec3 S = viewPos(suv, sd);",
        "    vec3 dv = S - P; float dist2 = dot(dv, dv); float dist = sqrt(dist2) + 1e-4; vec3 L = dv / dist;",
        "    float cs = max(dot(N, L), 0.0); float cl = max(dot(viewNormal(suv), -L), 0.0);",
        "    float fall = 1.0 / (1.0 + 4.0 * dist2 / (radius * radius));",
        "    acc += min(texture2D(tDiffuse, suv).rgb, vec3(3.0)) * (cs * cl * fall);",
        "  }",
        "  gl_FragColor = vec4(acc / float(SAMPLES) * intensity, 1.0);",
        "}"
    ].join("\n");
    var COMPOSE_FRAGMENT = COMMON + [
        "uniform sampler2D tDiffuse; uniform sampler2D tIndirect; uniform vec2 texel; varying vec2 vUv;",
        "void main() {",
        "  vec4 base = texture2D(tDiffuse, vUv);",
        "  float d0 = texture2D(tDepth, vUv).x;",
        "  if (d0 >= 0.99999) { gl_FragColor = base; return; }",
        "  vec3 N0 = viewNormal(vUv); float z0 = viewPos(vUv, d0).z;",
        // a blur of the indirect light that stops at the edges: the weight falls with the difference of depth and of normal
        "  vec3 sum = vec3(0.0); float wsum = 0.0;",
        "  for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {",
        "    vec2 suv = vUv + vec2(float(x), float(y)) * texel * 1.5;",
        "    float sd = texture2D(tDepth, suv).x; if (sd >= 0.99999) continue;",
        "    float dz = abs(viewPos(suv, sd).z - z0) / max(0.5, -z0) * 20.0;",
        "    float w = exp(-dz * dz) * pow(max(dot(N0, viewNormal(suv)), 0.0), 8.0);",
        "    sum += texture2D(tIndirect, suv).rgb * w; wsum += w;",
        "  }",
        "  vec3 gi = wsum > 1e-4 ? sum / wsum : vec3(0.0);",
        // the light that comes in is reflected with the colour of the surface itself, not with its colour as lit: in the shade that is nearly black, and the bounce did not
        // show where it should (the shade under a car, beside a wall). The colour of the surface is guessed from the picture: its colour with most of its brightness divided out
        "  float lum = max(max(base.r, base.g), base.b);",
        "  vec3 albedo = base.rgb / (lum + 0.25);",
        "  gl_FragColor = vec4(base.rgb + gi * albedo, base.a);",
        "}"
    ].join("\n");

    class SSGIPass extends THREE.Pass {
        constructor(camera, gbuffer, width, height, quality) {
            super();
            this.camera = camera; this.gbuffer = gbuffer;
            this.scale = 0.5;
            this.target = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(width * this.scale)), Math.max(1, Math.floor(height * this.scale)), { type: THREE.HalfFloatType, depthBuffer: false });
            var uniforms = function (extra) {
                return Object.assign({ tDepth: { value: gbuffer.depthTexture }, tNormal: { value: gbuffer.normalTexture }, projInv: { value: new THREE.Matrix4() }, proj: { value: new THREE.Matrix4() } }, extra);
            };
            this.gather = new THREE.ShaderMaterial({
                defines: { SAMPLES: quality > 1 ? 24 : 12 },
                uniforms: uniforms({ tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(width, height) }, radius: { value: 3.5 }, intensity: { value: quality > 1 ? 3.5 : 2.5 } }),
                vertexShader: VERTEX, fragmentShader: GATHER_FRAGMENT, depthTest: false, depthWrite: false
            });
            this.compose = new THREE.ShaderMaterial({
                uniforms: uniforms({ tDiffuse: { value: null }, tIndirect: { value: this.target.texture }, texel: { value: new THREE.Vector2(1 / this.target.width, 1 / this.target.height) } }),
                vertexShader: VERTEX, fragmentShader: COMPOSE_FRAGMENT, depthTest: false, depthWrite: false
            });
            this.quad = new THREE.FullScreenQuad(null);
        }
        setSize(width, height) {
            this.target.setSize(Math.max(1, Math.floor(width * this.scale)), Math.max(1, Math.floor(height * this.scale)));
            this.gather.uniforms.resolution.value.set(width, height);
            this.compose.uniforms.texel.value.set(1 / this.target.width, 1 / this.target.height);
        }
        dispose() { this.target.dispose(); this.gather.dispose(); this.compose.dispose(); this.quad.dispose(); }
        render(renderer, writeBuffer, readBuffer) {
            var m;
            for (m of [this.gather, this.compose]) { m.uniforms.projInv.value.copy(this.camera.projectionMatrixInverse); m.uniforms.proj.value.copy(this.camera.projectionMatrix); }
            this.gather.uniforms.tDiffuse.value = readBuffer.texture;
            this.quad.material = this.gather;
            renderer.setRenderTarget(this.target);
            this.quad.render(renderer);
            this.compose.uniforms.tDiffuse.value = readBuffer.texture;
            this.quad.material = this.compose;
            renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
            this.quad.render(renderer);
        }
    }

    // ---- the smoke, after the screen space effects: the occlusion and the bounce are worked out from the surfaces, and the smoke is no surface;
    // drawn with the scene they would darken and tint it as if it were the road behind it. Its own layer (Smoke.js): the camera leaves it out
    // of the scene and this pass draws only that layer on the picture, with the depth of the surfaces to fade against and hide behind them.
    class SmokePass extends THREE.Pass {
        constructor(scene, camera, gbuffer, width, height) {
            super();
            this.scene = scene; this.camera = camera; this.gbuffer = gbuffer;
            // the smoke goes into a picture of its own (not into the buffer of the composer, which is multisampled: what is drawn on such a buffer
            // later is not kept), and is laid over the picture after it
            this.target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false });
            this.material = new THREE.ShaderMaterial({
                uniforms: { tBase: { value: null }, tSmoke: { value: this.target.texture } },
                vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
                fragmentShader: "uniform sampler2D tBase; uniform sampler2D tSmoke; varying vec2 vUv;" +
                    "void main() { vec4 base = texture2D(tBase, vUv); vec4 smoke = texture2D(tSmoke, vUv); gl_FragColor = vec4(base.rgb * (1.0 - smoke.a) + smoke.rgb, base.a); }",
                depthTest: false, depthWrite: false
            });
            this.quad = new THREE.FullScreenQuad(this.material);
        }
        setSize(width, height) { this.target.setSize(width, height); }
        dispose() { this.target.dispose(); this.material.dispose(); this.quad.dispose(); }
        render(renderer, writeBuffer, readBuffer) {
            var u = OpenRacer.SmokeDepth, camera = this.camera, scene = this.scene;
            u.tDepth.value = this.gbuffer.depthTexture; u.uUseDepth.value = 1;
            u.uResolution.value.set(this.target.width, this.target.height);
            u.uNear.value = camera.near; u.uFar.value = camera.far;
            var oldMask = camera.layers.mask, oldBackground = scene.background, oldTarget = renderer.getRenderTarget(), oldShadows = renderer.shadowMap.autoUpdate;
            var oldAuto = renderer.autoClear, oldAlpha = renderer.getClearAlpha();
            renderer.getClearColor(this.clearColor || (this.clearColor = new THREE.Color()));
            camera.layers.set(1);
            scene.background = null;
            renderer.shadowMap.autoUpdate = false;
            renderer.setRenderTarget(this.target);
            renderer.autoClear = false;
            renderer.setClearColor(0x000000, 0);
            renderer.clear();
            renderer.render(scene, camera);
            renderer.setClearColor(this.clearColor, oldAlpha);
            renderer.shadowMap.autoUpdate = oldShadows;
            renderer.autoClear = oldAuto;
            scene.background = oldBackground;
            camera.layers.mask = oldMask;
            // (and let go of the depth: the debris and the glass splinters share these uniforms and are drawn while the
            // next frame writes that depth, which the browser refused as a loop: "Mismatch between texture format and sampler type")
            u.uUseDepth.value = 0; u.tDepth.value = null;
            // over the picture
            this.material.uniforms.tBase.value = readBuffer.texture;
            renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
            this.quad.render(renderer);
            renderer.setRenderTarget(oldTarget);
        }
    }

    // ---- the chain
    function disposePasses() {
        for (var k in passes) if (passes[k] && passes[k].dispose) passes[k].dispose();
        passes = {};
        if (ctx.composer) {
            ctx.composer.passes.forEach(function (p) { if (p.dispose) p.dispose(); });
            if (ctx.composer.renderTarget1) ctx.composer.renderTarget1.dispose();
            if (ctx.composer.renderTarget2) ctx.composer.renderTarget2.dispose();
        }
    }

    // ---- the look: the exposure, the contrast and the saturation, in the linear picture before the tone mapping (the exposure has to be here: the tone mapping None has none of its own)
    var GradeShader = {
        uniforms: { tDiffuse: { value: null }, exposure: { value: 1 }, contrast: { value: 1 }, saturation: { value: 1 } },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform sampler2D tDiffuse; uniform float exposure; uniform float contrast; uniform float saturation; varying vec2 vUv;" +
            "void main() { vec4 c = texture2D(tDiffuse, vUv); vec3 rgb = c.rgb * exposure;" +
            "float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722)); rgb = mix(vec3(l), rgb, saturation);" +                       // (the saturation about the grey of the same brightness)
            "rgb = 0.18 * pow(max(rgb / 0.18, vec3(0.0)), vec3(contrast));" +                                                  // (the contrast about the middle grey)
            "gl_FragColor = vec4(rgb, c.a); }"
    };
    // ---- the last step, on the picture of the screen: a sharpening (the picture minus the blur of its four neighbours, a little of it added back; cheap, and the picture of a
    // resolution below 100% or of an anti-aliasing is soft) and a fine noise of less than one level of the eight bits, which takes the bands out of the gradients of the sky
    var SharpenShader = {
        uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) }, strength: { value: 0.3 } },
        vertexShader: GradeShader.vertexShader,
        fragmentShader: "uniform sampler2D tDiffuse; uniform vec2 texel; uniform float strength; varying vec2 vUv;" +
            "float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }" +
            "void main() { vec3 c = texture2D(tDiffuse, vUv).rgb;" +
            "vec3 blur = 0.25 * (texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb);" +
            "vec3 sharp = clamp(c + (c - blur) * strength * 2.0, vec3(0.0), vec3(1.0));" +
            "float n = (hash(gl_FragCoord.xy) - 0.5) / 255.0;" +
            "gl_FragColor = vec4(sharp + n, 1.0); }"
    };

    function build() {
        var renderer = ctx.renderer, scene = ctx.scene, camera = ctx.camera;
        if (ctx.composer) disposePasses();
        var size = ctx.size();
        var pixelRatio = renderer.getPixelRatio();
        var width = Math.floor(size.width * pixelRatio), height = Math.floor(size.height * pixelRatio);
        var aa = Math.min(opt("gfxAA"), touch() ? 2 : 8);
        var target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: aa });
        var composer = new THREE.EffectComposer(renderer, target);
        composer.setPixelRatio(pixelRatio);
        composer.addPass(new THREE.RenderPass(scene, camera));

        var ao = opt("gfxAO"), gi = opt("gfxGI"), gScale = 1;
        if (ao || gi) {
            gScale = Math.max(ao, gi) > 1 ? 0.75 : 0.5;
            passes.gbuffer = new GBufferPass(scene, camera, width, height, gScale);
            composer.addPass(passes.gbuffer);
        }
        if (ao) {
            // it reads the picture of the normals and the depth that GBufferPass made, and does not make its own (the textures stay those of GBufferPass)
            var gtao = new THREE.GTAOPass(scene, camera, Math.floor(width * gScale), Math.floor(height * gScale),
                { depthTexture: passes.gbuffer.depthTexture, normalTexture: passes.gbuffer.normalTexture });
            gtao.setSize = function (w, h) { THREE.GTAOPass.prototype.setSize.call(this, Math.floor(w * gScale), Math.floor(h * gScale)); };
            gtao.output = THREE.GTAOPass.OUTPUT.Default;
            // (a radius of a metre and more: the shade under a car and at the foot of a rail or a wall; at 0.6 m and a scale of 1.3 only the small creases showed)
            gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.4, thickness: 1.5, scale: 2.0, samples: ao > 1 ? 16 : 8, distanceFallOff: 1, screenSpaceRadius: false });
            gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: ao > 1 ? 8 : 5, rings: 2, samples: ao > 1 ? 16 : 8 });
            gtao.blendIntensity = 1;
            passes.gtao = gtao;
            composer.addPass(gtao);
        }
        if (gi) {
            passes.ssgi = new SSGIPass(camera, passes.gbuffer, width, height, gi);
            composer.addPass(passes.ssgi);
        }

        // the smoke (layer 1): with the scene when there are no screen space effects, otherwise after them (SmokePass)
        if (passes.gbuffer) { camera.layers.disable(1); passes.smoke = new SmokePass(scene, camera, passes.gbuffer, width, height); composer.addPass(passes.smoke); }
        else camera.layers.enable(1);

        passes.grade = new THREE.ShaderPass(GradeShader);
        composer.addPass(passes.grade);
        applyLook();
        if (opt("gfxVignette")) {
            var effectVignette = new THREE.ShaderPass(THREE.VignetteShader);
            effectVignette.uniforms["darkness"].value = 1.2;
            composer.addPass(effectVignette);
        }
        // converts the picture to the colours of the screen
        composer.addPass(new THREE.OutputPass());
        var sharpen = SHARPEN[opt("gfxSharpen")] || 0;
        if (sharpen > 0) {
            var finish = new THREE.ShaderPass(SharpenShader);
            finish.uniforms["strength"].value = sharpen;
            finish.uniforms["texel"].value.set(1 / width, 1 / height);
            finish.setSize = function (w, h) { this.uniforms["texel"].value.set(1 / w, 1 / h); };
            passes.finish = finish;
            composer.addPass(finish);
        }
        ctx.composer = composer;
        ctx.onComposer(composer);
        return composer;
    }

    // ---- the options, one by one
    function applyShadows() {
        var light = ctx.shadowLight, size = SHADOW_SIZES[opt("gfxShadows")];
        ctx.renderer.shadowMap.enabled = size > 0;
        light.castShadow = size > 0;
        if (size > 0) {
            light.shadow.mapSize.set(size, size);
            if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
        }
        // the materials were compiled with or without the shadow code
        ctx.scene.traverse(function (o) { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); });
    }
    // the reflections: the cube map of the surroundings is made again every so many frames, and the lighting of the glTF cars (the filtered cube map) after every so many of
    // those updates: High does both all the time (the mirrors and the paint follow the surroundings), Low is slow
    function applyReflections() {
        var level = opt("gfxReflections");
        ctx.reflections(REFLECTION_EVERY[level]);
        ENVIRONMENT_EVERY = ENVIRONMENT_UPDATES[level] || 3;
    }
    // the tone mapping, the exposure, the contrast and the saturation (the picture is not made again: the numbers go to the pass)
    function applyLook() {
        if (typeof applyToneMapping === "function") applyToneMapping(opt("gfxTone"));
        if (passes.grade) {
            passes.grade.uniforms["exposure"].value = opt("gfxExposure");
            passes.grade.uniforms["contrast"].value = opt("gfxContrast");
            passes.grade.uniforms["saturation"].value = opt("gfxSaturation");
        }
    }
    // the sharpness of the textures at a slant (the road ahead of the car): every texture that is made from now on, and the ones that are there
    function applyAniso() {
        var level = Math.min(opt("gfxAniso") || 1, ctx.renderer.capabilities.getMaxAnisotropy());
        THREE.Texture.DEFAULT_ANISOTROPY = level;
        var seen = new Set();
        ctx.scene.traverse(function (o) {
            if (!o.material) return;
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
                for (var key in m) {
                    var t = m[key];
                    if (t && t.isTexture && !seen.has(t)) { seen.add(t); if (t.anisotropy !== level && !t.isCubeTexture && !t.isRenderTargetTexture) { t.anisotropy = level; t.needsUpdate = true; } }
                }
            });
        });
    }
    function applyDistance() {
        ctx.camera.far = opt("gfxDistance") || 5000;
        ctx.camera.updateProjectionMatrix();
    }
    // The resolution: "native" draws at the density of the screen (basePixelRatio, which on a phone is held to a budget of pixels); a height
    // in pixels (720, 1080, 1440, 2160) draws the picture that many pixels high, whatever the size of the window, and the browser stretches
    // it to the window. A height above the screen draws more than it shows (a sharper picture for a price); it stops at twice the density of
    // the screen, and on a touch device at the native density (the buffers would not fit in the memory of a phone).
    var RESOLUTIONS = ["native", 720, 1080, 1440, 2160];
    function pixelRatio() {
        var base = ctx.basePixelRatio(), res = opt("gfxResolution");
        if (typeof res !== "number") return base;
        var ratio = res / Math.max(1, window.innerHeight);
        return Math.max(0.25, Math.min(ratio, touch() ? base : 2 * base));
    }
    function applyResolution() {
        ctx.renderer.setPixelRatio(pixelRatio());
        ctx.resize();
    }

    // Starts the chain: ctx = { renderer, scene, camera, shadowLight, size(), basePixelRatio(), resize(), reflections(every), onComposer(composer) }
    function init(context) {
        ctx = context;
        ctx.renderer.setPixelRatio(pixelRatio());
        applyShadows();
        applyReflections();
        applyDistance();
        applyAniso();
        return build();
    }

    function currentPreset() {
        for (var name in PRESETS) {
            var p = PRESETS[name], same = true;
            for (var k in p) if (opt(k) !== p[k]) same = false;
            if (same) return name;
        }
        return "custom";
    }

    // an option changed in the menu
    var applying = false;
    function changed(name) {
        if (!ctx || applying || name === "gfxPreset") return;
        if (name === "gfxResolution") { applyResolution(); build(); }
        else if (name.indexOf("gfxDebris") === 0) { /* (Debris.js reads them) */ }
        else if (name === "gfxSmoke") { if (currentPreset() !== opt("gfxPreset")) Settings.setOption("gfxPreset", currentPreset()); }       // (Smoke.js reads it)
        else if (name === "gfxDistance") { applyDistance(); if (currentPreset() !== opt("gfxPreset")) Settings.setOption("gfxPreset", currentPreset()); }
        else if (name === "gfxShadows") applyShadows();
        else if (name === "gfxReflections") applyReflections();
        else if (name === "gfxTone" || name === "gfxExposure" || name === "gfxContrast" || name === "gfxSaturation") applyLook();
        else if (name === "gfxAniso") { applyAniso(); if (currentPreset() !== opt("gfxPreset")) Settings.setOption("gfxPreset", currentPreset()); }
        else if (name === "gfxTime" || name === "gfxWeather" || name === "gfxSunAzimuth" || name === "gfxMoon" || name === "gfxGround") { if (OpenRacer.Atmosphere) OpenRacer.Atmosphere.apply(); }
        else build();       // the anti-aliasing, the screen space effects, the vignette
    }

    // a preset: all the options of it, then the chain is made again once
    function applyPreset(name) {
        var p = PRESETS[name];
        if (!p || !ctx) return;
        applying = true;
        for (var k in p) Settings.setOption(k, p[k]);
        Settings.setOption("gfxPreset", name);
        applying = false;
        applyResolution(); applyShadows(); applyReflections(); applyDistance(); applyAniso(); build();
    }

    function setSize(width, height) {
        if (!ctx || !ctx.composer) return;
        ctx.composer.setPixelRatio(ctx.renderer.getPixelRatio());      // (with a resolution in pixels the density follows the window: see pixelRatio)
        ctx.composer.setSize(width, height);      // the composer sizes its passes too
    }

    return { PRESETS: PRESETS, SHADOW_SIZES: SHADOW_SIZES, RESOLUTIONS: RESOLUTIONS, pixelRatio: function() { return ctx ? pixelRatio() : null; }, init: init, changed: changed, applyPreset: applyPreset, currentPreset: currentPreset, setSize: setSize, GBufferPass: GBufferPass, SSGIPass: SSGIPass };
})();
