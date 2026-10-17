/*
 * EnvironmentExport.js
 *
 * Description: Saves the surroundings of the car as a picture of the whole sky and ground around it (an equirectangular HDR image,
 *              the .hdr format of Radiance) that can be used as the world of Blender (tools/blender_match_game.py does this). The
 *              materials of a car are lit and reflect the surroundings in the game, so the same image in Blender gives the same
 *              light and the same reflections.
 */

var EnvironmentExport = (function() {
    var VERTEX = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

    // The direction of every pixel of the picture in the axes of Blender (z up, y away from the viewer) to those of the game (y up),
    // and then the surroundings (the cube map) in that direction.
    var FRAGMENT =
        "varying vec2 vUv; uniform samplerCube tCube;" +
        "void main() {" +
        "  float lon = (vUv.x - 0.5) * 6.28318530718;" +
        "  float lat = (vUv.y - 0.5) * 3.14159265359;" +
        "  vec3 b = vec3(-cos(lon) * cos(lat), sin(lon) * cos(lat), sin(lat));" +
        "  vec3 d = vec3(b.x, b.z, -b.y);" +
        "  gl_FragColor = vec4(textureCube(tCube, d).rgb, 1.0);" +
        "}";

    // Radiance RGBE: one byte per colour, with a shared exponent
    function encode(pixels, width, height) {
        var header = "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y " + height + " +X " + width + "\n";
        var data = new Uint8Array(header.length + width * height * 4);
        for(var i = 0; i < header.length; i++) data[i] = header.charCodeAt(i);
        var offset = header.length;
        // the pixels of a render target start at the bottom; the picture starts at the top
        for(var y = height - 1; y >= 0; y--) {
            for(var x = 0; x < width; x++) {
                var index = (y * width + x) * 4;
                var r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
                var max = Math.max(r, g, b);
                if(!(max > 1e-32)) {
                    data[offset++] = 0; data[offset++] = 0; data[offset++] = 0; data[offset++] = 0;
                } else {
                    var exponent = Math.ceil(Math.log2(max));
                    var scale = 256 / Math.pow(2, exponent);
                    // guard against rounding at the edge of an exponent
                    if(max * scale >= 256) { exponent++; scale /= 2; }
                    data[offset++] = Math.min(255, Math.floor(r * scale));
                    data[offset++] = Math.min(255, Math.floor(g * scale));
                    data[offset++] = Math.min(255, Math.floor(b * scale));
                    data[offset++] = exponent + 128;
                }
            }
        }
        return data;
    }

    // The surroundings of a position as the data of an .hdr file. The car is not in it.
    function capture(position, faceSize, width) {
        var height = width / 2;
        var cubeTarget = new THREE.WebGLCubeRenderTarget(faceSize, { type: THREE.HalfFloatType });
        var cubeCamera = new THREE.CubeCamera(0.1, 10000, cubeTarget);
        cubeCamera.position.copy(position);
        var hidden = [];
        if(window.car) {
            [window.car.body].concat(window.car.wheels.map(function(w) { return w.object; })).forEach(function(object) {
                if(object && object.visible) { object.visible = false; hidden.push(object); }
            });
        }
        scene.updateMatrixWorld(true);
        cubeCamera.update(renderer, scene);
        hidden.forEach(function(object) { object.visible = true; });

        var target = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, format: THREE.RGBAFormat });
        var material = new THREE.ShaderMaterial({
            uniforms: { tCube: { value: cubeTarget.texture } },
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            depthTest: false,
            depthWrite: false
        });
        var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        var quadScene = new THREE.Scene();
        quadScene.add(quad);
        var quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        var previousTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(target);
        renderer.render(quadScene, quadCamera);
        var pixels = new Float32Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        renderer.setRenderTarget(previousTarget);

        var result = encode(pixels, width, height);
        cubeTarget.dispose();
        target.dispose();
        material.dispose();
        quad.geometry.dispose();
        return result;
    }

    function download(name) {
        var position = window.car ? window.car.body.position.clone() : camera.position.clone();
        position.y += 0.6;
        var data = capture(position, 1024, 2048);
        var blob = new Blob([data], { type: "application/octet-stream" });
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = name || "openracer-environment.hdr";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function() { URL.revokeObjectURL(link.href); }, 10000);
    }

    return { capture: capture, download: download };
})();
