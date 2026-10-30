/*
 * Catalog.js
 *
 * Description: Finds the cars (cars/<id>/car.json) and tracks (tracks/<id>/track.json) that are available, from three sources:
 *
 *   - the server: with tools/serve.py (start-server.sh) the folders are scanned on every request (api/cars, api/tracks), so a
 *     new car or track is found at once. A plain web server has no scan, but then cars/index.json and tracks/index.json,
 *     which serve.py keeps up to date, give the ids;
 *   - the garage of this browser (Garage.js): what the player saved in the editors or imported from a zip;
 *   - a folder on the player's PC that is linked in the garage dialog (cars/<id>/car.json in it, like web/cars).
 *
 *   An item of the garage replaces the one of the folder with the same id, and both replace the one of the server. The
 *   configurations of the garage and the folder carry their files as blob URLs (Garage.resolve, Garage.manager).
 *
 *   The tunes that come with a car (car.json "tunes": the tune files next to it) are read before the list is given, and handed
 *   to OpenRacer.Setups.ship, so that every menu has them as soon as it has the car.
 */

var Catalog = (function() {
    var FILES = { cars: "car.json", tracks: "track.json" };

    function getJson(url) {
        return fetch(url, { cache: "no-store" }).then(function(response) {
            if(!response.ok) throw new Error(url + ": HTTP " + response.status);
            return response.json();
        });
    }

    // the set of the server; base is the folder of the page relative to web ("" in the game, "../" in the editors)
    function server(kind, base) {
        return getJson(base + "api/" + kind).catch(function() {
            return getJson(base + kind + "/index.json").then(function(ids) {
                return Promise.all(ids.map(function(id) {
                    return getJson(base + kind + "/" + id + "/" + FILES[kind]).then(function(config) {
                        config.id = id;
                        return config;
                    }).catch(function() { return null; });
                })).then(function(list) { return list.filter(Boolean); });
            });
        });
    }

    function garage(kind) {
        var Garage = typeof OpenRacer !== "undefined" && OpenRacer.Garage;
        if(!Garage || !Garage.available()) return Promise.resolve([]);
        return Garage.list(kind).then(function(records) {
            return records.map(function(record) { return Garage.configOf(record, "garage"); });
        }).catch(function(error) {
            console.warn("Catalog: the garage could not be read (" + error.message + ")");
            return [];
        });
    }

    function folder(kind) {
        var Garage = typeof OpenRacer !== "undefined" && OpenRacer.Garage;
        if(!Garage || !Garage.folderSupported()) return Promise.resolve([]);
        return Garage.folderList(kind);
    }

    // the tune files of a car (car.json "tunes", names of files next to car.json); a file that is missing or is not a tune is left out
    function tunes(config, base) {
        var Setups = typeof OpenRacer !== "undefined" && OpenRacer.Setups, Garage = typeof OpenRacer !== "undefined" && OpenRacer.Garage;
        if(!Setups) return Promise.resolve();
        if(!Array.isArray(config.tunes)) { Setups.ship(config.id, []); return Promise.resolve(); }      // (a car that had tunes before and has none now)
        return Promise.all(config.tunes.map(function(file) {
            if(typeof file !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(file)) return null;
            var url = base + "cars/" + config.id + "/" + file;
            if(Garage && Garage.resolve) url = Garage.resolve(config, url);
            return fetch(url, { cache: "no-store" }).then(function(response) { return response.ok ? response.text() : null; }).then(function(text) {
                var tune = text === null ? null : Setups.parseFile(text);
                if(!tune || tune instanceof Error) { console.warn("Catalog: the tune " + file + " of " + config.id + " is left out" + (tune ? " (" + tune.message + ")" : "")); return null; }
                tune.file = file;
                return tune;
            }).catch(function() { return null; });
        })).then(function(list) { Setups.ship(config.id, list.filter(Boolean)); });
    }

    // Promise of the list of configurations of "cars" or "tracks", each with its id. It fails only when nothing at all can be read.
    function load(kind, base) {
        base = base || "";
        var serverError = null;
        return Promise.all([
            server(kind, base).catch(function(error) { serverError = error; return []; }),
            folder(kind),
            garage(kind)
        ]).then(function(lists) {
            var byId = {}, order = [];
            lists.forEach(function(list) {
                list.forEach(function(config) {
                    if(!byId[config.id]) order.push(config.id);
                    byId[config.id] = config; // the later sources win: folder over server, garage over both
                });
            });
            var merged = order.map(function(id) { return byId[id]; });
            if(!merged.length && serverError) throw serverError;
            if(kind !== "cars") return merged;
            return Promise.all(merged.map(function(config) { return tunes(config, base); })).then(function() { return merged; });
        });
    }

    return { load: load };
})();
