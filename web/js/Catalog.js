/*
 * Catalog.js
 *
 * Description: Finds the cars (cars/<id>/car.json) and tracks (tracks/<id>/track.json) that are available.
 *              With tools/serve.py (start-server.sh) the folders are scanned on every request, so a new car or track
 *              is found at once. A plain web server has no scan, but then cars/index.json and tracks/index.json,
 *              which serve.py keeps up to date, give the ids.
 */

var Catalog = (function() {
    var FILES = { cars: "car.json", tracks: "track.json" };

    function getJson(url) {
        return fetch(url, { cache: "no-store" }).then(function(response) {
            if(!response.ok) throw new Error(url + ": HTTP " + response.status);
            return response.json();
        });
    }

    // Promise of the list of configurations of "cars" or "tracks", each with its id
    function load(kind) {
        return getJson("api/" + kind).catch(function() {
            return getJson(kind + "/index.json").then(function(ids) {
                return Promise.all(ids.map(function(id) {
                    return getJson(kind + "/" + id + "/" + FILES[kind]).then(function(config) {
                        config.id = id;
                        return config;
                    }).catch(function() { return null; });
                })).then(function(list) { return list.filter(Boolean); });
            });
        });
    }

    return { load: load };
})();
