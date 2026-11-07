class_name TyreCompounds
extends RefCounted
## The kinds of tyre (web/js/Wheel.js TyreCompounds): the grip (a factor), the working window (the best
## temperature, its width, and how fast the grip goes outside of it: the smaller "cold", the faster, and
## "coldLoss" the most that is lost), how fast it heats and wears, the rolling resistance, what it does on loose
## ground (looseGrip, looseRolling, looseSlide), and "lateral" (the stiffness across the tyre, as a factor).
## A custom tyre has a rubber (0 to 100, between the kinds) and a tread (0 road to 100 knobbly).

const KINDS := {
	"eco": {"grip": 0.88, "optimum": 70, "window": 20, "cold": 55, "coldLoss": 0.16, "heating": 0.8, "life": 1.7, "rolling": 0.8, "smoke": 20},
	"road": {"grip": 1.0, "optimum": 85, "window": 15, "cold": 45, "coldLoss": 0.22, "heating": 1.0, "life": 1.0, "rolling": 1.0, "smoke": 0},
	"sport": {"grip": 1.1, "optimum": 90, "window": 14, "cold": 42, "coldLoss": 0.25, "heating": 1.15, "life": 0.7, "rolling": 1.05, "smoke": -5},
	"semislick": {"grip": 1.25, "optimum": 95, "window": 12, "cold": 38, "coldLoss": 0.3, "heating": 1.3, "life": 0.45, "rolling": 1.1, "smoke": -12},
	"slick": {"grip": 1.45, "optimum": 100, "window": 10, "cold": 30, "coldLoss": 0.4, "heating": 1.5, "life": 0.3, "rolling": 1.15, "smoke": -20},
	"winter": {"grip": 0.9, "optimum": 55, "window": 25, "cold": 55, "coldLoss": 0.2, "heating": 0.9, "life": 1.2, "rolling": 1.1, "smoke": -10},
	"offroad": {"grip": 0.82, "looseGrip": 1.7, "looseRolling": 0.6, "looseSlide": 0.97, "optimum": 70, "window": 25, "cold": 60, "coldLoss": 0.15,
		"heating": 0.9, "life": 0.9, "rolling": 1.25, "smoke": 5},
	"drag": {"grip": 1.7, "lateral": 0.5, "optimum": 85, "window": 20, "cold": 28, "coldLoss": 0.45, "heating": 1.4, "life": 0.18, "rolling": 1.4, "smoke": -24},
}

## The rubber of a custom tyre: a slider from 0 to 100 between these kinds.
const RUBBER_STOPS := [["eco", 0], ["road", 22], ["sport", 42], ["semislick", 62], ["slick", 82], ["drag", 100]]


static func kind(id: String) -> Dictionary:
	return KINDS.get(id, KINDS["road"])


## The kind of a custom tyre (rubberCompound of Wheel.js): every number between the two kinds on either side of the
## rubber (the life by a power: a soft tyre wears several times as fast as a hard one), then the tread.
static func rubber(r: float, tread := 0.0) -> Dictionary:
	var at := clampf(r, 0.0, 100.0)
	var i := 0
	while i < RUBBER_STOPS.size() - 2 and at > RUBBER_STOPS[i + 1][1]:
		i += 1
	var a: Dictionary = KINDS[RUBBER_STOPS[i][0]]
	var b: Dictionary = KINDS[RUBBER_STOPS[i + 1][0]]
	var f := (at - float(RUBBER_STOPS[i][1])) / (float(RUBBER_STOPS[i + 1][1]) - float(RUBBER_STOPS[i][1]))
	var out := {}
	for k in ["grip", "optimum", "window", "cold", "coldLoss", "heating", "life", "rolling", "smoke", "lateral"]:
		var x := float(a.get(k, 1.0))
		var y := float(b.get(k, 1.0))
		out[k] = x * pow(y / x, f) if k == "life" else lerpf(x, y, f)
	var t := clampf(tread, 0.0, 100.0) / 100.0
	if t > 0.0:
		out["grip"] = float(out["grip"]) * (1.0 - 0.18 * t)
		out["rolling"] = float(out["rolling"]) * (1.0 + 0.25 * t)
		out["looseGrip"] = 1.0 + 0.7 * t
		out["looseRolling"] = 1.0 - 0.4 * t
		out["looseSlide"] = 0.84 + 0.13 * t
	return out


## The kind of the tyres of an axle of a car: its custom rubber when car.json gives one, else the compound of the car.
static func of_axle(config: Dictionary, front: bool) -> Dictionary:
	var axle: Dictionary = config.get("wheels", {}).get("library", {}).get("front" if front else "rear", {})
	var custom: Dictionary = axle.get("custom", {})
	if axle.get("tyre", "") == "custom" and custom.has("rubber"):
		return rubber(float(custom["rubber"]), float(custom.get("tread", 0)))
	return kind(str(config.get("tyres", {}).get("compound", "road")))
