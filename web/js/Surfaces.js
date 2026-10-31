/*
 * Surfaces.js
 *
 * Description: The grip of the surfaces the wheels drive on, and what the wet and the snow take from it. No 3D library and no page:
 *              it also loads in a Web Worker (with the physics: Vehicle.js, Wheel.js and the rest; see PHYSICS-WORKER.md).
 *              getSurface(name, snow, water) gives the grip of a surface; setGroundCondition(wet, snow) sets the condition of the
 *              whole ground (Atmosphere.js). Was part of Helpers.js.
 */

var gravity = 9.81;

// Friction of the surfaces: the grip at the peak of the tyre curve (static) and while sliding (kinetic).
var uCoeff = {
    "road": { static: 1.2, kinetic: 1.06 },
    "track01": { static: 1.03, kinetic: 0.93 },
    "wet": { static: 0.85, kinetic: 0.75 },        // wet asphalt (the skidpad)
    "grass": { static: 0.62, kinetic: 0.52, loose: true, dust: [0.5, 0.58, 0.3] },
    // sand, gravel and mud: loose ground, each with its own grip, its own drag (the rolling resistance of the tyre in it, as a factor) and the colour of what it throws up
    "sand": { static: 0.6, kinetic: 0.5, loose: true, drag: 4.5, dust: [0.86, 0.72, 0.5] },
    "gravel": { static: 0.78, kinetic: 0.66, loose: true, drag: 3, dust: [0.62, 0.58, 0.52] },
    "mud": { static: 0.5, kinetic: 0.44, loose: true, drag: 6, dust: [0.34, 0.25, 0.17] },     // about half the road: the car slows and slides, but it can be driven back
    "ground": { static: 0.7, kinetic: 0.58, loose: true, dust: [0.66, 0.55, 0.4] }       // (dirt)
};

// The ground condition (Atmosphere.js: rain wets the road, snow lies on it): the grip of a surface is less by what the wet and the snow take from it, per surface (road and kerb lose most;
// loose ground, which is not smooth to start with, loses less). The numbers are what a dry value becomes at a fully wet (WET) or a fully snow covered (SNOW) ground.
var groundWet = 0, groundSnow = 0, surfaceCache = {};
var WET_LOSS = { road: 0.28, track01: 0.28, grass: 0.2, ground: 0.2, sand: 0.08, gravel: 0.1, mud: 0, wet: 0 };
var SNOW_LOSS = { road: 0.62, track01: 0.62, wet: 0.62, grass: 0.42, ground: 0.42, sand: 0.35, gravel: 0.45, mud: 0.25 };
function setGroundCondition(wet, snow) {
    groundWet = Math.max(0, Math.min(1, wet)); groundSnow = Math.max(0, Math.min(1, snow));
    surfaceCache = {};
}
// snow: how much snow lies at the wheel (0 to 1; where the snow was scraped or melted away the grip is back); left out, it is the snow of the whole ground
// water: how deep the water is at the wheel (a puddle, 0 to 1): the wet is then at least that much more than the wet of the ground (a puddle loses more grip than a wet road)
function getSurface(name, snow, water) {
    var key = uCoeff[name] ? name : "track01";
    var level = snow === undefined ? groundSnow : snow;
    var wet = water > 0 ? Math.max(groundWet, Math.min(1.5, water * 1.5)) : groundWet;
    if(wet < 0.005 && level < 0.005) return uCoeff[key];
    var step = Math.max(0, Math.min(20, Math.round(level * 20))), wetStep = Math.max(0, Math.min(30, Math.round(wet * 20))), cacheKey = key + step + "w" + wetStep;
    var cached = surfaceCache[cacheKey];
    if(cached) return cached;
    var base = uCoeff[key], factor = (1 - (WET_LOSS[key] || 0) * wetStep / 20) * (1 - (SNOW_LOSS[key] || 0) * step / 20);
    cached = Object.assign({}, base, { static: base.static * factor, kinetic: base.kinetic * factor });
    surfaceCache[cacheKey] = cached;
    return cached;
}
