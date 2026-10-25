/*
 * TextureBudget.js
 *
 * Description: The textures of the models on a phone or a tablet. A car model comes with its textures as it was made (4096 by 4096 for a tank, 2048 for the
 *              rest: a model of 30 textures is 400 MB on the graphics card with its mipmaps), which a phone cannot hold: Safari on an iPhone drew black
 *              textures and then ended the page. On a touch device every texture that is bigger than the budget (1024 by 1024) is drawn smaller before it
 *              goes to the card: a quarter of the memory per step down, and on a screen of that size nothing is lost. The desktop is not touched.
 *
 *              OpenRacer.touchDevice()                  a phone or a tablet (a coarse pointer and a touch screen; ?touch=1 in the address says so too, ?touch=0 says no)
 *              OpenRacer.textureBudget()                the biggest side of a texture on this device (0: no limit)
 *              OpenRacer.shrinkTextures(object, max)    every texture of the materials under the object (the maps of a material) drawn down to max
 *              OpenRacer.shrinkTexture(texture, max)    one texture
 */

(function () {
    var MAPS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "bumpMap", "alphaMap", "specularMap", "lightMap", "displacementMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap", "sheenColorMap", "transmissionMap", "thicknessMap"];
    var TOUCH_BUDGET = 1024;

    OpenRacer.touchDevice = function () {
        try {
            var q = new URLSearchParams(window.location.search).get("touch");
            if (q === "1") return true;
            if (q === "0") return false;
            return window.matchMedia("(pointer: coarse)").matches && (navigator.maxTouchPoints || 0) > 0;
        } catch (e) { return false; }
    };
    OpenRacer.textureBudget = function () { return OpenRacer.touchDevice() ? TOUCH_BUDGET : 0; };

    var shrunk = typeof WeakSet !== "undefined" ? new WeakSet() : null;
    function sizeOf(image) {
        if (!image) return null;
        var w = image.naturalWidth || image.videoWidth || image.width, h = image.naturalHeight || image.videoHeight || image.height;
        return w > 0 && h > 0 ? { w: w, h: h } : null;
    }

    // one texture: its image drawn to a canvas of at most max by max (the proportions kept); data textures and compressed ones are left alone
    OpenRacer.shrinkTexture = function (texture, max) {
        if (!texture || !max || texture.isCompressedTexture || texture.isDataTexture || texture.isVideoTexture) return false;
        if (shrunk && shrunk.has(texture)) return false;
        var image = texture.image, size = sizeOf(image);
        if (!size) {
            // (not loaded yet: when it is)
            if (image && typeof image.addEventListener === "function" && !texture.__shrinkWaiting) {
                texture.__shrinkWaiting = true;
                image.addEventListener("load", function () { texture.__shrinkWaiting = false; OpenRacer.shrinkTexture(texture, max); }, { once: true });
            }
            return false;
        }
        if (size.w <= max && size.h <= max) { if (shrunk) shrunk.add(texture); return false; }
        var scale = max / Math.max(size.w, size.h);
        var w = Math.max(1, Math.round(size.w * scale)), h = Math.max(1, Math.round(size.h * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        try {
            var ctx = canvas.getContext("2d");
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
            ctx.drawImage(image, 0, 0, w, h);
        } catch (e) { return false; }
        if (image && typeof image.close === "function") { try { image.close(); } catch (e2) { /* an ImageBitmap that is in use */ } }      // (an ImageBitmap: its memory goes at once)
        texture.image = canvas;
        texture.needsUpdate = true;
        if (shrunk) shrunk.add(texture);
        return true;
    };

    // every texture of the materials under an object
    OpenRacer.shrinkTextures = function (object, max) {
        if (!object || !max) return 0;
        var count = 0, seen = typeof Set !== "undefined" ? new Set() : null;
        object.traverse(function (node) {
            var materials = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : [];
            materials.forEach(function (material) {
                if (!material || (seen && seen.has(material))) return;
                if (seen) seen.add(material);
                MAPS.forEach(function (name) { if (material[name] && OpenRacer.shrinkTexture(material[name], max)) count++; });
            });
        });
        if (count) console.log("TextureBudget: " + count + " texture" + (count === 1 ? "" : "s") + " drawn down to " + max + " px for this device");
        return count;
    };
})();
