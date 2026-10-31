/*
 * CarColors.js
 *
 * Description: The paint of a car on its model: the colour, the finish (gloss, matte, metallic, pearl, metal flake, chrome, ...) and, for metal flake, the pattern and the size of the
 *              flakes, for the body (the materials called carpaint) and the rims (rimpaint). Used by the game (Car.setColors, the pictures of the tunes in the main menu), by the
 *              AI cars and by the car editor. Needs the global THREE.
 *
 *   OpenRacer.applyCarColors(roots, colors)   colors: { body, rim, bodyFinish, rimFinish, bodyFlake, rimFlake, bodyPattern, rimPattern } (all optional; none: the model as it is)
 *   OpenRacer.carFinishes, OpenRacer.carFlakePatterns   the lists to choose from
 */
var OpenRacer = window.OpenRacer || (window.OpenRacer = {});

// The colours of a car on its model (Car.setColors, and the pictures of the tunes in the main menu): roots are the body and the wheels, colors { body, rim } (a CSS colour each, or null
// for the colour of the model). The paint of the body is every material called carpaint, the paint of the rims every material called rimpaint (the name of the material in the model: a mesh can have
// more materials, only these change). The material is made its own the first time (the model shares materials), and the material as made is kept to go back to.
OpenRacer.carFinishes = {
    "": { label: "As the model" },
    gloss: { label: "Gloss", roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 },
    satin: { label: "Satin", roughness: 0.5, metalness: 0.12, clearcoat: 0.25, clearcoatRoughness: 0.35 },
    matte: { label: "Matte", roughness: 0.92, metalness: 0, clearcoat: 0 },
    metallic: { label: "Metallic", roughness: 0.33, metalness: 0.75, clearcoat: 1, clearcoatRoughness: 0.05 },
    pearl: { label: "Pearl (the colour shifts)", roughness: 0.28, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 1, iridescenceIOR: 1.8, iridescenceThickness: [250, 650] },
    flake: { label: "Metal flake (sparkle)", roughness: 0.38, metalness: 0.9, clearcoat: 1, clearcoatRoughness: 0.06, flakes: true },
    candy: { label: "Candy (deep and glassy)", roughness: 0.15, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.02 },
    chrome: { label: "Chrome", roughness: 0.04, metalness: 1, clearcoat: 0 },
    brushed: { label: "Brushed metal", roughness: 0.42, metalness: 1, clearcoat: 0 }
};
OpenRacer.applyCarColors = (function() {
    // only the materials with these names take a colour and a finish: "carpaint" for the paint of the body, "rimpaint" for the paint of the rims (the name of the
    // material in the model, whatever the mesh is called: Carpaint, carpaint.001, rim_paint)
    var BODY_MATERIAL = /car[ _-]?paint/i, RIM_MATERIAL = /rim[ _-]?paint/i;
    function kindOfMaterial(material) {
        var name = material && material.name ? material.name : "";
        if(RIM_MATERIAL.test(name)) return "rim";
        if(BODY_MATERIAL.test(name)) return "body";
        return null;
    }
    // the patterns of a metal flake paint: a normal map (a tile that repeats) made once per pattern. noise: the tiny mirrors, random tilts per pixel; voronoi: crystals (cells of
    // random size, each a flat mirror with a tilt of its own); hexagons: the cells of a hexagonal lattice, each with its own tilt; marble: veins (a height made of sine waves bent by noise)
    OpenRacer.carFlakeUvs = { model: "From the model", generated: "Generated (box projection)" };
    OpenRacer.carFlakePatterns = { noise: "Noise (fine sparkle)", voronoi: "Voronoi (crystals)", hexagons: "Hexagons (honeycomb)", marble: "Marble (veins)" };
    var PATTERN_SCALE = { noise: 0.45, voronoi: 0.6, hexagons: 0.6, marble: 0.9 };
    var patternMaps = {};
    function tiltPixel(data, i, a, tilt) {
        data[i * 4] = 128 + Math.cos(a) * 127 * tilt; data[i * 4 + 1] = 128 + Math.sin(a) * 127 * tilt; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
    }
    function cellsOf(size, points, edge) {
        // every pixel takes the tilt of the nearest point (on a torus: the tile repeats); a ridge of the width "edge" along the border of two cells
        var data = new Uint8ClampedArray(size * size * 4), tilts = points.map(function() { return [Math.random() * 2 * Math.PI, 0.35 + 0.65 * Math.random()]; });
        for(var y = 0; y < size; y++) for(var x = 0; x < size; x++) {
            var best = 1e9, second = 1e9, which = 0;
            for(var k = 0; k < points.length; k++) {
                var dx = Math.abs(x - points[k][0]), dy = Math.abs(y - points[k][1]);
                if(dx > size / 2) dx = size - dx; if(dy > size / 2) dy = size - dy;
                var d = dx * dx + dy * dy;
                if(d < best) { second = best; best = d; which = k; } else if(d < second) second = d;
            }
            var gap = Math.sqrt(second) - Math.sqrt(best), i = y * size + x;
            if(gap < edge) tiltPixel(data, i, tilts[which][0] + Math.PI, 0.8 * (1 - gap / edge) + 0.2);      // the ridge leans away from the cell
            else tiltPixel(data, i, tilts[which][0], tilts[which][1]);
        }
        return data;
    }
    function periodicNoise(size, cells) {
        var lattice = [], i, j;
        for(i = 0; i < cells; i++) { lattice.push([]); for(j = 0; j < cells; j++) lattice[i].push(Math.random()); }
        return function(x, y) {                                         // x, y in 0..1 (a tile): value noise, smooth, repeating
            var fx = x * cells, fy = y * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
            tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
            var a = lattice[ix % cells][iy % cells], b = lattice[(ix + 1) % cells][iy % cells], c = lattice[ix % cells][(iy + 1) % cells], d = lattice[(ix + 1) % cells][(iy + 1) % cells];
            return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
        };
    }
    function makePattern(name) {
        var size = 256, data = new Uint8ClampedArray(size * size * 4), i;
        if(name === "voronoi") {
            var pts = []; for(i = 0; i < 44; i++) pts.push([Math.random() * size, Math.random() * size]);
            data = cellsOf(size, pts, 3);
        } else if(name === "hexagons") {
            var cols = 8, rows = 10, hp = [];                           // a hexagonal lattice: every other row a half step over (an even number of rows: it repeats)
            for(var r = 0; r < rows; r++) for(var c = 0; c < cols; c++) hp.push([(c + (r % 2) * 0.5) * size / cols + size / cols / 4, (r + 0.5) * size / rows]);
            data = cellsOf(size, hp, 2.5);
        } else if(name === "marble") {
            var n1 = periodicNoise(size, 6), n2 = periodicNoise(size, 12), n3 = periodicNoise(size, 24), height = new Float32Array(size * size);
            for(var y = 0; y < size; y++) for(var x = 0; x < size; x++) {
                var u = x / size, v = y / size, turb = n1(u, v) * 1 + n2(u, v) * 0.5 + n3(u, v) * 0.25;
                height[y * size + x] = Math.sin((u * 3 + v * 2) * 2 * Math.PI + turb * 9);               // (3 and 2 whole waves over the tile: it repeats)
            }
            for(var yy = 0; yy < size; yy++) for(var xx = 0; xx < size; xx++) {
                var gx = height[yy * size + (xx + 1) % size] - height[yy * size + (xx + size - 1) % size], gy = height[((yy + 1) % size) * size + xx] - height[((yy + size - 1) % size) * size + xx];
                var len = Math.hypot(gx * 3, gy * 3, 1), p = (yy * size + xx) * 4;
                data[p] = 128 - gx * 3 / len * 127; data[p + 1] = 128 - gy * 3 / len * 127; data[p + 2] = 128 + 127 / len; data[p + 3] = 255;
            }
        } else {
            for(i = 0; i < size * size; i++) tiltPixel(data, i, Math.random() * 2 * Math.PI, Math.pow(Math.random(), 0.6));       // (most of the flakes tilt, a few lie flat)
        }
        var canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        var g = canvas.getContext("2d");
        g.putImageData(new ImageData(data, size, size), 0, 0);
        var texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        return texture;
    }
    function flakes(name) {
        if(!OpenRacer.carFlakePatterns[name]) name = "noise";
        return patternMaps[name] || (patternMaps[name] = makePattern(name));
    }
    // a material of the model with a colour and a finish (a paint: roughness, metal, a clear coat, a pearl or flakes); the colour of the model when none is given
    // the tiles per metre of the flakes on a generated map (the pattern is laid on the car by its place in space, not by the UV map of the model: 100% is this size)
    var TILES_PER_METRE = { noise: 16, voronoi: 1.5, hexagons: 1.5, marble: 1 };
    // the normal map of the flakes laid on the mesh from three directions (box projection, blended where they meet): no UV map needed, so a model without one (or with a bad one)
    // gets the same flakes; the shader of the material is changed for it
    function triplanar(material, texture, tiles, strength) {
        material.onBeforeCompile = function(shader) {
            shader.uniforms.triMap = { value: texture }; shader.uniforms.triRepeat = { value: tiles }; shader.uniforms.triStrength = { value: strength };
            shader.vertexShader = shader.vertexShader
                .replace("void main() {", "varying vec3 vTriPos;\nvarying vec3 vTriNormal;\nvarying mat3 vObjToView;\nvoid main() {")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvTriPos = position;\n\tvTriNormal = normal;\n\tvObjToView = normalMatrix;");
            shader.fragmentShader = shader.fragmentShader
                .replace("void main() {", "uniform sampler2D triMap;\nuniform float triRepeat;\nuniform float triStrength;\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;\nvarying mat3 vObjToView;\nvoid main() {")
                .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" +
                    "\t{\n" +
                    "\t\tvec3 n0 = normalize(vTriNormal);\n" +
                    "\t\tvec3 bl = pow(abs(n0), vec3(4.0)); bl /= (bl.x + bl.y + bl.z);\n" +
                    "\t\tvec3 p = vTriPos * triRepeat;\n" +
                    "\t\tvec3 tx = texture2D(triMap, p.zy).xyz * 2.0 - 1.0;\n" +
                    "\t\tvec3 ty = texture2D(triMap, p.xz).xyz * 2.0 - 1.0;\n" +
                    "\t\tvec3 tz = texture2D(triMap, p.xy).xyz * 2.0 - 1.0;\n" +
                    "\t\ttx = vec3(tx.xy + n0.zy, abs(tx.z) * n0.x);\n" +
                    "\t\tty = vec3(ty.xy + n0.xz, abs(ty.z) * n0.y);\n" +
                    "\t\ttz = vec3(tz.xy + n0.xy, abs(tz.z) * n0.z);\n" +
                    "\t\tvec3 nObj = normalize(tx.zyx * bl.x + ty.xzy * bl.y + tz.xyz * bl.z);\n" +
                    "\t\tvec3 nView = normalize(vObjToView * nObj) * faceDirection;\n" +
                    "\t\tnormal = normalize(mix(normal, nView, clamp(triStrength, 0.0, 1.0)));\n" +
                    "\t}");
        };
        material.customProgramCacheKey = function() { return "carpaint-triplanar"; };
    }
    function style(material, colour, finishName, flakeSize, pattern, uvMode) {
        if(!material.isMeshStandardMaterial) { var plain = material.clone(); if(colour && plain.color) plain.color.set(colour); return plain; }
        var styled = new THREE.MeshPhysicalMaterial();
        THREE.MeshStandardMaterial.prototype.copy.call(styled, material);
        if(colour) styled.color.set(colour);
        var f = OpenRacer.carFinishes[finishName];
        if(f && finishName) {
            styled.roughness = f.roughness; styled.metalness = f.metalness; styled.clearcoat = f.clearcoat; styled.clearcoatRoughness = f.clearcoatRoughness || 0;
            if(f.iridescence) { styled.iridescence = f.iridescence; styled.iridescenceIOR = f.iridescenceIOR; styled.iridescenceThicknessMinimum = f.iridescenceThickness[0]; styled.iridescenceThicknessMaximum = f.iridescenceThickness[1]; }
            if(f.flakes) {
                // the size of the flakes (100%: the normal size): a bigger flake is a smaller repeat of the map; every material has its own copy of the texture (its repeat)
                var size = Math.max(2, Math.min(400, flakeSize || 100));
                if(uvMode === "generated") {
                    triplanar(styled, flakes(pattern), (TILES_PER_METRE[pattern] || 16) * 100 / size, Math.min(1, (PATTERN_SCALE[pattern] || 0.45) * 1.3));
                } else {
                    var map = flakes(pattern).clone(), scale = (pattern === "marble" ? 4 : (pattern === "voronoi" || pattern === "hexagons" ? 6 : 64)) * 100 / size;
                    map.repeat.set(scale, scale); map.needsUpdate = true;
                    styled.normalMap = map; styled.normalScale.set(PATTERN_SCALE[pattern] || 0.45, PATTERN_SCALE[pattern] || 0.45);
                }
            }
            styled.roughnessMap = null; styled.metalnessMap = null;                 // (the finish decides, not the maps of the model)
            styled.envMapIntensity = Math.max(styled.envMapIntensity || 1, 1.2);
        }
        styled.needsUpdate = true;
        return styled;
    }
    return function(roots, colors) {
        roots.forEach(function(root) {
            if(!root) return;
            root.traverse(function(mesh) {
                if(!mesh.isMesh || !mesh.material) return;
                var ud = mesh.userData;
                if(!ud.asMade) {
                    var list = [].concat(mesh.material), kinds = list.map(kindOfMaterial);
                    if(!kinds.some(function(k) { return k; })) { ud.asMade = false; return; }          // (no paint on this mesh: it is not looked at again)
                    ud.asMadeIsArray = Array.isArray(mesh.material); ud.asMadeList = list; ud.kinds = kinds;
                }
                if(ud.asMade === false) return;
                var wanted = ud.kinds.some(function(kind) { return kind && colors && (colors[kind] || colors[kind + "Finish"]); });
                if(!wanted && !ud.asMade) return;
                if(!ud.asMade) ud.asMade = true;
                if(ud.styled) { ud.styled.forEach(function(m, i) { if(m !== ud.asMadeList[i]) { if(m.normalMap) m.normalMap.dispose(); m.dispose(); } }); ud.styled = null; }
                if(!wanted) { mesh.material = ud.asMadeIsArray ? ud.asMadeList.slice() : ud.asMadeList[0]; return; }
                ud.styled = ud.asMadeList.map(function(m, i) {
                    var kind = ud.kinds[i];
                    if(!kind || !colors || !(colors[kind] || colors[kind + "Finish"])) return m;
                    return style(m, colors[kind], colors[kind + "Finish"], colors[kind + "Flake"], colors[kind + "Pattern"], colors[kind + "Uv"]);
                });
                mesh.material = ud.asMadeIsArray ? ud.styled : ud.styled[0];
            });
        });
    };
})();
