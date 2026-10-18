/*
 * Garage.js
 *
 * Description: The garage: cars and tracks of the player, kept in this browser (IndexedDB), or read from a folder on the PC
 *              (the File System Access API, where the browser has it). The game on a plain web server ships its own set
 *              of cars and tracks; what the player makes in the editors, imports from a zip or keeps in a folder is added
 *              to that set on the player's side, nothing is sent to the server.
 *
 *   A record: { kind: "cars" | "tracks", id, json: the car.json or track.json, files: { <name>: Blob } }. The names of the
 *   files are relative to the folder of the item (model.glb, textures, images/road.jpg), the way they are in web/cars/<id>.
 *   A record with only json and no files overrides the car or track of the server of the same id and keeps using its files:
 *   that is what "Save to the car" of the tuning menu makes on a plain server.
 *
 *   Catalog.js merges the three sources (server, garage, folder). An item that comes from the garage or the folder gets a
 *   hidden property _garage with blob URLs for its files; resolve(config, url) turns a URL of the game (cars/<id>/model.glb)
 *   into the blob URL, and manager(config) gives a THREE.LoadingManager that does the same for the files a glTF refers to.
 *
 *   store(kind, id, json, files, options) saves an item the way the page is served: to the server through its API
 *   (tools/serve.py) when that is there, otherwise to the garage; it says where it went.
 */

OpenRacer.Garage = (function () {
    var DB_NAME = "openracer-garage", DB_VERSION = 1, STORE = "items", SETTINGS = "settings";
    var CONFIG_FILE = { cars: "car.json", tracks: "track.json" };
    var dbPromise = null;

    function available() { return typeof indexedDB !== "undefined"; }

    function open() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            if (!available()) { reject(new Error("This browser has no IndexedDB: the garage cannot keep anything.")); return; }
            var request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = function () {
                var db = request.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    var items = db.createObjectStore(STORE, { keyPath: "key" });
                    items.createIndex("kind", "kind", { unique: false });
                }
                if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: "key" });
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error || new Error("The garage could not be opened.")); };
            request.onblocked = function () { reject(new Error("The garage is open in another tab.")); };
        });
        dbPromise.catch(function () { dbPromise = null; });
        return dbPromise;
    }

    // one request in a transaction, as a promise
    function tx(store, mode, action) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var transaction = db.transaction(store, mode);
                var request = action(transaction.objectStore(store));
                transaction.oncomplete = function () { resolve(request ? request.result : undefined); };
                transaction.onerror = function () { reject(transaction.error || new Error("The garage could not be written.")); };
                transaction.onabort = function () { reject(transaction.error || new Error("The garage could not be written.")); };
            });
        });
    }

    function keyOf(kind, id) { return kind + "/" + id; }

    // ---- the records

    // Promise of the records of a kind, sorted by id (each with json and files)
    function list(kind) {
        return tx(STORE, "readonly", function (store) { return store.index("kind").getAll(kind); }).then(function (records) {
            return (records || []).sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
        });
    }

    function get(kind, id) {
        return tx(STORE, "readonly", function (store) { return store.get(keyOf(kind, id)); }).then(function (record) { return record || null; });
    }

    // Writes an item. The files are added to the ones the record already has (a car.json saved alone keeps the model);
    // options.replace drops the old files first, options.remove is a list of file names to drop.
    function put(kind, id, json, files, options) {
        options = options || {};
        json = JSON.parse(JSON.stringify(json));
        delete json.id;
        return get(kind, id).then(function (old) {
            var kept = old && !options.replace ? Object.assign({}, old.files) : {};
            (options.remove || []).forEach(function (name) { delete kept[name]; });
            Object.keys(files || {}).forEach(function (name) { kept[name] = files[name]; });
            var record = { key: keyOf(kind, id), kind: kind, id: id, json: json, files: kept, updated: Date.now() };
            return tx(STORE, "readwrite", function (store) { return store.put(record); }).then(function () { return record; });
        });
    }

    function remove(kind, id) {
        return tx(STORE, "readwrite", function (store) { return store.delete(keyOf(kind, id)); });
    }

    function setting(key) {
        return tx(SETTINGS, "readonly", function (store) { return store.get(key); }).then(function (row) { return row ? row.value : null; });
    }

    function putSetting(key, value) {
        return tx(SETTINGS, "readwrite", function (store) { return value === null ? store.delete(key) : store.put({ key: key, value: value }); });
    }

    // ---- the files of an item in the game

    // The hidden bookkeeping of an item that is not on the server: { source, urls: { name: blob URL }, names: [...] }
    function tag(config, source, urls) {
        Object.defineProperty(config, "_garage", { value: { source: source, urls: urls, names: Object.keys(urls) }, enumerable: false, configurable: true, writable: true });
        return config;
    }

    // "garage", "folder" or null (the server) for a configuration from Catalog.load
    function sourceOf(config) { return config && config._garage ? config._garage.source : null; }

    // The configuration of a record, ready for the game: its files as blob URLs
    function configOf(record, source) {
        var config = JSON.parse(JSON.stringify(record.json));
        config.id = record.id;
        var urls = {};
        Object.keys(record.files || {}).forEach(function (name) { urls[name] = URL.createObjectURL(record.files[name]); });
        return tag(config, source || "garage", urls);
    }

    function baseName(url) { return decodeURIComponent(url.split("?")[0].split("#")[0].split("/").pop()); }

    // A URL of the game for a file of this item (cars/<id>/model.glb, ../tracks/<id>/images/road.jpg, or just the name of a
    // file that a glTF refers to) as the blob URL of the garage, or the URL as it is when the item does not have that file
    function resolve(config, url) {
        if (!config || !config._garage || !url || /^(blob|data):/.test(url)) return url;
        var urls = config._garage.urls;
        var clean = decodeURIComponent(url.split("?")[0].split("#")[0]).replace(/^(\.\.\/|\.\/)+/, "");
        var marker = new RegExp("(^|/)(cars|tracks)/" + config.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/(.+)$");
        var match = clean.match(marker);
        if (match && urls[match[3]]) return urls[match[3]];
        if (urls[clean]) return urls[clean];
        var name = baseName(clean);
        return urls[name] || url;
    }

    // A THREE.LoadingManager that sends the files a glTF refers to (its .bin, its textures) to the garage
    function manager(config, three) {
        three = three || (typeof THREE !== "undefined" ? THREE : null);
        if (!three || !three.LoadingManager) return undefined;
        var m = new three.LoadingManager();
        if (config && config._garage) m.setURLModifier(function (url) { return resolve(config, url); });
        return m;
    }

    // ---- the folder on the PC (File System Access API)

    function folderSupported() { return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function"; }

    var folderState = { handle: null, name: null, permission: null, loaded: false };

    function folderHandle() {
        if (folderState.loaded) return Promise.resolve(folderState.handle);
        return setting("folder").then(function (handle) {
            folderState.loaded = true;
            folderState.handle = handle || null;
            folderState.name = handle ? handle.name : null;
            return folderState.handle;
        }).catch(function () { folderState.loaded = true; return null; });
    }

    // Asks for a folder and keeps it (the handle survives a reload; the browser asks again for permission the next time)
    function linkFolder() {
        if (!folderSupported()) return Promise.reject(new Error("This browser cannot open a folder (Chrome and Edge can)."));
        return window.showDirectoryPicker({ mode: "read" }).then(function (handle) {
            folderState.handle = handle;
            folderState.name = handle.name;
            folderState.permission = "granted";
            folderState.loaded = true;
            return putSetting("folder", handle).then(function () { return handle; });
        });
    }

    function unlinkFolder() {
        folderState.handle = null; folderState.name = null; folderState.permission = null; folderState.loaded = true;
        return putSetting("folder", null);
    }

    // "granted", "prompt" (the player has to allow it again: a click on a button) or null (no folder)
    function folderPermission(ask) {
        return folderHandle().then(function (handle) {
            if (!handle) return null;
            var query = ask ? handle.requestPermission({ mode: "read" }) : handle.queryPermission({ mode: "read" });
            return query.then(function (state) { folderState.permission = state; return state; }, function () { return "prompt"; });
        });
    }

    function folderInfo() { return { supported: folderSupported(), name: folderState.name, permission: folderState.permission }; }

    // all files under a directory handle, as { relative path: File }
    function readFolder(dir, prefix, into) {
        var work = [];
        return (function walk() {
            var iterator = dir.entries();
            function next() {
                return iterator.next().then(function (step) {
                    if (step.done) return into;
                    var name = step.value[0], handle = step.value[1];
                    if (handle.kind === "file") {
                        work.push(handle.getFile().then(function (file) { into[prefix + name] = file; }));
                    } else if (handle.kind === "directory") {
                        work.push(readFolder(handle, prefix + name + "/", into));
                    }
                    return next();
                });
            }
            return next();
        })().then(function () { return Promise.all(work); }).then(function () { return into; });
    }

    // Promise of the configurations of a kind in the linked folder: <folder>/cars/<id>/car.json (or, without a cars folder, the
    // folder itself as the cars folder), each with blob URLs for its files. Empty without a folder or without permission.
    function folderList(kind) {
        return folderHandle().then(function (handle) {
            if (!handle) return [];
            return folderPermission(false).then(function (state) {
                if (state !== "granted") return [];
                return handle.getDirectoryHandle(kind).catch(function () { return handle; }).then(function (dir) {
                    var items = [];
                    var iterator = dir.entries();
                    function next() {
                        return iterator.next().then(function (step) {
                            if (step.done) return items;
                            var id = step.value[0], sub = step.value[1];
                            if (sub.kind !== "directory" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return next();
                            return sub.getFileHandle(CONFIG_FILE[kind]).then(function (fh) { return fh.getFile(); }).then(function (file) {
                                return file.text();
                            }).then(function (text) {
                                var json = JSON.parse(text);
                                return readFolder(sub, "", {}).then(function (files) {
                                    delete files[CONFIG_FILE[kind]];
                                    items.push(configOf({ id: id, json: json, files: files }, "folder"));
                                });
                            }).catch(function () { /* not an item */ }).then(next);
                        });
                    }
                    return next();
                });
            });
        }).catch(function (error) { console.warn("Garage: the folder could not be read (" + error.message + ")"); return []; });
    }

    // ---- saving: the server when it is there, otherwise the garage

    // Promise of { where: "server" | "garage" }. files: { name: Blob or string }, options.remove: files to drop,
    // options.base: the folder of the page relative to web ("" in the game, "../" in the editors).
    function store(kind, id, json, files, options) {
        options = options || {};
        var base = options.base || "";
        var body = JSON.stringify(json, function (key, value) { return key === "id" && this === json ? undefined : value; }, 2) + "\n";
        var names = Object.keys(files || {});
        function putOne(name, data) {
            return fetch(base + "api/" + kind + "/" + encodeURIComponent(id) + "/" + name.split("/").map(encodeURIComponent).join("/"), { method: "PUT", body: data }).then(function (response) {
                if (!response.ok) throw new Error("HTTP " + response.status);
            });
        }
        var server = names.reduce(function (chain, name) { return chain.then(function () { return putOne(name, files[name]); }); }, Promise.resolve())
            .then(function () { return putOne(CONFIG_FILE[kind], body); })
            .then(function () {
                return Promise.all((options.remove || []).map(function (name) {
                    return fetch(base + "api/" + kind + "/" + encodeURIComponent(id) + "/" + encodeURIComponent(name), { method: "DELETE" }).catch(function () {});
                }));
            }).then(function () { return { where: "server" }; });
        return server.catch(function (error) {
            console.log("Garage: the server does not save (" + error.message + "), saving to the garage");
            var blobs = {};
            names.forEach(function (name) { blobs[name] = files[name] instanceof Blob ? files[name] : new Blob([files[name]]); });
            return put(kind, id, json, blobs, { remove: options.remove, replace: options.replace }).then(function () { return { where: "garage" }; });
        });
    }

    // Removes an item: from the server when it is there, otherwise from the garage. Promise of { where }.
    function discard(kind, id, options) {
        var base = (options && options.base) || "";
        return fetch(base + "api/" + kind + "/" + encodeURIComponent(id), { method: "DELETE" }).then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return { where: "server" };
        }).catch(function () {
            return remove(kind, id).then(function () { return { where: "garage" }; });
        });
    }

    // ---- zip

    // A zip of an item: <id>/car.json and the files
    function exportZip(kind, id) {
        return get(kind, id).then(function (record) {
            if (!record) throw new Error("There is no " + kind.slice(0, -1) + " " + id + " in the garage.");
            var entries = [{ name: id + "/" + CONFIG_FILE[kind], data: JSON.stringify(record.json, null, 2) + "\n" }];
            Object.keys(record.files).forEach(function (name) { entries.push({ name: id + "/" + name, data: record.files[name] }); });
            return OpenRacer.Zip.write(entries).then(function (blob) { return { blob: blob, name: id + "." + kind.slice(0, -1) + ".zip" }; });
        });
    }

    // Puts the item of a zip (car.json or track.json at the root or in one folder) in the garage. Promise of { kind, id }.
    function importZip(file) {
        return OpenRacer.Zip.read(file).then(function (entries) {
            var found = null;
            entries.forEach(function (entry) {
                var parts = entry.name.split("/").filter(Boolean);
                var name = parts[parts.length - 1];
                var kind = name === "car.json" ? "cars" : name === "track.json" ? "tracks" : null;
                if (kind && (!found || parts.length < found.depth)) found = { kind: kind, depth: parts.length, prefix: parts.slice(0, -1).join("/"), entry: entry };
            });
            if (!found) throw new Error("The zip has no car.json or track.json.");
            return found.entry.blob.text().then(function (text) {
                var json = JSON.parse(text);
                var folder = found.prefix.split("/").pop();
                var id = (json.id || folder || file.name.replace(/\.(car|track)?\.?zip$/i, "")).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
                if (!/^[a-z0-9]/.test(id)) id = "item-" + id;
                delete json.id;
                var files = {};
                entries.forEach(function (entry) {
                    if (entry === found.entry || entry.name.slice(-1) === "/") return;
                    var rel = found.prefix ? (entry.name.indexOf(found.prefix + "/") === 0 ? entry.name.slice(found.prefix.length + 1) : null) : entry.name;
                    if (rel) files[rel] = entry.blob;
                });
                // the car.json of a car names its model as cars/<id>/<file>: it is this car now
                if (found.kind === "cars" && json.model && json.model.file) {
                    json.model.file = "cars/" + id + "/" + json.model.file.split("/").pop();
                }
                return put(found.kind, id, json, files, { replace: true }).then(function () { return { kind: found.kind, id: id }; });
            });
        });
    }

    // Promise of { used, quota } in bytes, where the browser tells
    function usage() {
        if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
        return navigator.storage.estimate().then(function (e) { return { used: e.usage || 0, quota: e.quota || 0 }; }).catch(function () { return null; });
    }

    function sizeOf(record) {
        var total = 0;
        Object.keys(record.files || {}).forEach(function (name) { total += record.files[name].size || 0; });
        return total;
    }

    return {
        available: available, list: list, get: get, put: put, remove: remove,
        configOf: configOf, sourceOf: sourceOf, resolve: resolve, manager: manager,
        folderSupported: folderSupported, linkFolder: linkFolder, unlinkFolder: unlinkFolder, folderPermission: folderPermission, folderInfo: folderInfo, folderList: folderList,
        store: store, discard: discard, exportZip: exportZip, importZip: importZip, usage: usage, sizeOf: sizeOf
    };
})();
