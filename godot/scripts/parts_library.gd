class_name PartsLibrary
extends RefCounted
## The suspension and the driveline of a car built from loose parts (web/js/PartsLibrary.js), by what the car editor
## says: a type of suspension for the front and for the rear (car.json "suspension": {front: {type, mounts, hidden},
## rear: ...}: double-wishbone, macpherson, live-trailing, live-leaf; "model" or "none" build nothing), the drive and
## where the engine is (car.json "driveline": {engine: front|mid|rear, mounts, hidden}). The parts are the glTF files of
## web/parts/<type>/<part>.glb, modelled on a nominal size and fitted to the car:
##   a stretched part  its origin at the end on the body, 1 m along +Y to its other end: aimed at its other end and
##                     scaled along its length (arms, coilovers, dampers, struts, tie rods, the Panhard rod, shafts)
##   the axle          its origin at its middle, 1 m along X; scaled to the width of its end mount (axle_end)
##   the leaf spring   its origin at its middle, 1 m along Z; scaled from the front hanger to the rear
##   a rigid part      at its own size, its origin at its mount (the upright, the engine, the gearbox, a differential)
##   the rack          its origin at its middle, 1 m along X; scaled to the width of its end mount (rack_end)
## Every part is modelled for the left side (+x); the right side is its mirror image. A mount is a point (and a turn)
## in the frame of the car (x to the left, y up, z forward, the origin at the height of the axles, midway between them),
## with a default from the wheels. The parts get the names that SuspensionRig moves (susp_lowerarm_FL, susp_spring_RL,
## susp_axle_rear, steer_rack ...). Only what is seen: the physics of a live axle (its wheels lean with it) is not here.

const TYPES := {
	"double-wishbone": {"files": ["upperarm", "lowerarm", "upright", "coilover", "tierod"],
		"mounts": ["upper_hinge", "upper_ball", "lower_hinge", "lower_ball", "spring_top", "spring_bottom", "tierod_inner", "tierod_outer", "rack", "rack_end"]},
	"macpherson": {"files": ["lowerarm", "strut", "upright", "tierod"],
		"mounts": ["lower_hinge", "lower_ball", "strut_top", "strut_bottom", "tierod_inner", "tierod_outer", "rack", "rack_end"]},
	"live-trailing": {"files": ["axle", "trailingarm", "uppertrailingarm", "coilover", "damper", "panhard"],
		"mounts": ["axle_end", "lower_hinge", "lower_arm_end", "upper_hinge", "upper_arm_end", "spring_top", "spring_bottom", "damper_top", "damper_bottom",
			"panhard", "panhard_axle"]},
	"live-leaf": {"files": ["axle", "leafspring", "damper"], "mounts": ["axle_end", "leaf_front", "leaf_rear", "damper_top", "damper_bottom"]},
}

static var _cache := {}             # path -> Node3D (the scene of a file), or null, while a car is assembled


static func type_of(config: Dictionary, axle: String) -> String:
	var s: Variant = config.get("suspension", {})
	var t: Variant = s.get(axle, {}).get("type") if s is Dictionary and s.get(axle) is Dictionary else null
	return str(t) if t != null and TYPES.has(str(t)) else ("none" if str(t) == "none" else "model")


static func is_live(t: String) -> bool:
	return t == "live-trailing" or t == "live-leaf"


## The parts, placed, in a node in the frame of the car (null when the car has no suspension of the library): a car
## with "wheels": {"mode": "default"} and a type for an axle, not a motorcycle.
static func assemble(car: Car) -> Node3D:
	var cfg := car.config
	if str(cfg.get("type", "car")) == "motorcycle":
		return null
	if not ["front", "rear"].any(func(a: String) -> bool: return TYPES.has(type_of(cfg, a))):
		return null
	var ch: Dictionary = cfg.get("chassis", {})
	var wb := float(ch.get("wheelbase", 2.6))
	var geo := {
		"front": {"W": Vector3(float(ch.get("front_track", 1.5)) / 2.0, 0.0, wb / 2.0), "track": float(ch.get("front_track", 1.5))},
		"rear": {"W": Vector3(float(ch.get("rear_track", 1.5)) / 2.0, 0.0, -wb / 2.0), "track": float(ch.get("rear_track", 1.5))},
	}
	var out := {"group": Node3D.new(), "hidden": {}, "engine": _engine_model(cfg)}
	(out["group"] as Node3D).name = "PartsLibrary"
	for g in ["front", "rear", "driveline"]:
		var h: Variant = cfg.get("driveline", {}).get("hidden") if g == "driveline" else (cfg.get("suspension", {}).get(g, {}).get("hidden") \
			if cfg.get("suspension", {}).get(g) is Dictionary else null)
		out["hidden"][g] = h if h is Array else []
	for axle in ["front", "rear"]:
		var t := type_of(cfg, axle)
		if not TYPES.has(t):
			continue
		out["axle"] = axle
		_build_axle(out, t, axle, _mounts(t, axle, cfg["suspension"][axle].get("mounts", {}), geo), geo)
	out["axle"] = "driveline"
	_build_driveline(out, cfg, geo)
	for path: String in _cache:
		if _cache[path] != null:
			(_cache[path] as Node).free()
	_cache.clear()
	return out["group"]


static func _engine_model(cfg: Dictionary) -> String:
	var b: Variant = cfg.get("engine", {}).get("build", {}).get("block") if cfg.get("engine", {}).get("build") is Dictionary else null
	if not (b is String):
		return ""
	var name := RegEx.create_from_string("[^A-Za-z0-9]+").sub(str(b).strip_edges(), "-", true)
	name = name.trim_prefix("-").trim_suffix("-")
	return name if name != "" and name != "engine" else ""


static func _template(type: String, file: String) -> Node3D:
	var path := "parts/%s/%s.glb" % [type, file]
	if not _cache.has(path):
		_cache[path] = Content.load_model(path) if FileAccess.file_exists(Content.path(path)) else null
	var t: Node3D = _cache[path]
	return t.duplicate() as Node3D if t != null else null


static func _default_mount(name: String, axle: String, geo: Dictionary) -> Vector3:
	var g: Dictionary = geo[axle]
	var xw: float = g["W"].x
	var yw: float = g["W"].y
	var z: float = g["W"].z
	var fwd := 1.0 if axle == "front" else -1.0
	match name:
		"upper_hinge": return Vector3(0.35 * xw, yw + 0.18, z)
		"upper_ball": return Vector3(xw - 0.12, yw + 0.17, z)
		"lower_hinge": return Vector3(0.35 * xw, yw - 0.15, z)
		"lower_ball": return Vector3(xw - 0.12, yw - 0.17, z)
		"spring_top": return Vector3(0.62 * xw, yw + 0.65, z)
		"spring_bottom": return Vector3(0.35 * xw + 0.75 * (xw - 0.12 - 0.35 * xw), yw - 0.15 + 0.75 * -0.02, z)
		"strut_top": return Vector3(0.75 * xw, yw + 0.7, z - 0.03)
		"strut_bottom": return Vector3(xw - 0.12, yw - 0.05, z)
		"tierod_inner": return Vector3(0.25 * xw, yw, z + fwd * 0.18)
		"tierod_outer": return Vector3(xw - 0.12, yw, z + fwd * 0.14)
		"damper_bottom": return Vector3(0.55 * xw, yw, z - 0.1)
		"rack": return Vector3(0.0, yw, z + 0.18)
		"rack_end": return Vector3(0.45 * xw, yw, z + 0.18)
		"damper_top": return Vector3(0.5 * xw, yw + 0.7, z - 0.15)
		"panhard": return Vector3(0.8 * xw, yw + 0.15, z - 0.15)
		"leaf_front": return Vector3(0.75 * xw, yw + 0.1, z + 0.6)
		"leaf_rear": return Vector3(0.75 * xw, yw + 0.1, z - 0.6)
	return Vector3(0.0, yw, z)


## The trailing arms of a live axle hang from hinges in front of it.
static func _default_live(name: String, axle: String, geo: Dictionary) -> Vector3:
	var g: Dictionary = geo[axle]
	var xw: float = g["W"].x
	var yw: float = g["W"].y
	var z: float = g["W"].z
	match name:
		"axle_end": return Vector3(xw - 0.1, yw, z)
		"lower_hinge": return Vector3(0.7 * xw, yw + 0.05, z + 1.0)
		"lower_arm_end": return Vector3(0.7 * xw, yw, z)
		"upper_hinge": return Vector3(0.35 * xw, yw + 0.3, z + 1.0)
		"upper_arm_end": return Vector3(0.35 * xw, yw + 0.25, z)
		"spring_top": return Vector3(0.7 * xw, yw + 0.75, z + 0.1)
		"spring_bottom": return Vector3(0.7 * xw, yw + 0.05, z)
		"damper_bottom": return Vector3(0.55 * xw, yw + 0.05, z - 0.1)
		"panhard_axle": return Vector3(-0.7 * xw, yw + 0.1, z - 0.15)
	return _default_mount(name, axle, geo)


## The mounts of an axle: {name: {p: Vector3, r: Vector3 (degrees)}}, the defaults from the wheels, overridden by car.json.
static func _mounts(t: String, axle: String, mset: Variant, geo: Dictionary) -> Dictionary:
	var out := {}
	for name: String in TYPES[t]["mounts"]:
		if (name == "rack" or name == "rack_end") and axle != "front":
			continue
		var d := _default_live(name, axle, geo) if is_live(t) else _default_mount(name, axle, geo)
		var m: Variant = mset.get(name) if mset is Dictionary else null
		var p: Variant = m.get("position") if m is Dictionary else null
		var r: Variant = m.get("rotation") if m is Dictionary else null
		out[name] = {"p": Vector3(float(p[0]), float(p[1]), float(p[2])) if p is Array and (p as Array).size() == 3 else d,
			"r": Vector3(float(r[0]), float(r[1]), float(r[2])) if r is Array and (r as Array).size() == 3 else Vector3.ZERO}
	if out.has("rack") and out.has("rack_end"):
		var rk: Vector3 = out["rack"]["p"]
		out["rack_end"] = {"p": Vector3(rk.x + maxf(0.05, absf(out["rack_end"]["p"].x - rk.x)), rk.y, rk.z), "r": Vector3.ZERO}
	if out.has("axle_end"):
		var g: Dictionary = geo[axle]
		out["axle_end"] = {"p": Vector3(maxf(0.1, absf(out["axle_end"]["p"].x)), g["W"].y, g["W"].z), "r": Vector3.ZERO}
	return out


## A part placed: origin, and a far end (a stretched part) or none (a rigid part, turned by its mount); mirror: the right side.
static func _place(out: Dictionary, type: String, file: String, name: String, origin: Vector3, far: Variant, rot: Vector3, mirror: bool) -> Node3D:
	var group := "driveline" if type == "driveline" else str(out["axle"])
	if (out["hidden"][group] as Array).has(file):
		return null
	var t: Node3D = null
	if type == "driveline" and file == "engine" and out["engine"] != "":
		t = _template(type, out["engine"])
	if t == null:
		t = _template(type, file)
	if t == null:
		return null
	var node := Node3D.new()
	node.name = name
	node.add_child(t)
	node.position = origin
	var s := -1.0 if mirror else 1.0
	if far != null:
		var d: Vector3 = (far as Vector3) - origin
		var length := d.length()
		if length < 1e-4:
			d = Vector3.DOWN
			length = 0.05
		var q := Quaternion(Vector3.UP, d.normalized())
		if rot.y != 0.0:
			q = q * Quaternion(Vector3.UP, deg_to_rad(rot.y) * s)
		node.basis = Basis(q).scaled_local(Vector3(s, length, 1.0))
		node.set_meta("rig_far", far)
	else:
		node.basis = Basis.from_euler(Vector3(deg_to_rad(rot.x), deg_to_rad(rot.y) * s, deg_to_rad(rot.z) * s)).scaled_local(Vector3(s, 1.0, 1.0))
	(out["group"] as Node3D).add_child(node)
	return node


static func _build_axle(out: Dictionary, t: String, axle: String, m: Dictionary, geo: Dictionary) -> void:
	var g: Dictionary = geo[axle]
	var corners := ["FL", "FR"] if axle == "front" else ["RL", "RR"]
	var z: float = g["W"].z
	if is_live(t):
		var ax := _place(out, t, "axle", "susp_axle_" + axle, Vector3(0.0, g["W"].y, z), null, Vector3.ZERO, false)
		if ax != null:
			ax.scale.x = maxf(0.2, 2.0 * absf(m["axle_end"]["p"].x) if m.has("axle_end") else float(g["track"]) - 0.2)
	for i in 2:
		var side := 1.0 if i == 0 else -1.0
		var corner: String = corners[i]
		var mirror := side < 0.0
		var w := Vector3(g["W"].x * side, g["W"].y, z)
		var at := func(name: String) -> Vector3: return Vector3(m[name]["p"].x * side, m[name]["p"].y, m[name]["p"].z)
		var rot := func(name: String) -> Vector3: return m[name]["r"]
		if t == "double-wishbone" or t == "macpherson":
			_place(out, t, "lowerarm", "susp_lowerarm_" + corner, at.call("lower_hinge"), at.call("lower_ball"), rot.call("lower_hinge"), mirror)
			_place(out, t, "upright", "susp_upright_" + corner, w, null, Vector3.ZERO, mirror)
			_place(out, t, "tierod", "steer_tierod_" + corner, at.call("tierod_inner"), at.call("tierod_outer"), rot.call("tierod_inner"), mirror)
			if t == "double-wishbone":
				_place(out, t, "upperarm", "susp_upperarm_" + corner, at.call("upper_hinge"), at.call("upper_ball"), rot.call("upper_hinge"), mirror)
				_place(out, t, "coilover", "susp_spring_" + corner, at.call("spring_top"), at.call("spring_bottom"), rot.call("spring_top"), mirror)
			else:
				_place(out, t, "strut", "susp_strut_" + corner, at.call("strut_top"), at.call("strut_bottom"), rot.call("strut_top"), mirror)
		elif t == "live-trailing":
			_place(out, t, "trailingarm", "susp_trailingarm_" + corner, at.call("lower_hinge"), at.call("lower_arm_end"), rot.call("lower_hinge"), mirror)
			_place(out, t, "uppertrailingarm", "susp_uppertrailingarm_" + corner, at.call("upper_hinge"), at.call("upper_arm_end"), rot.call("upper_hinge"), mirror)
			_place(out, t, "coilover", "susp_spring_" + corner, at.call("spring_top"), at.call("spring_bottom"), rot.call("spring_top"), mirror)
			_place(out, t, "damper", "susp_damper_" + corner, at.call("damper_top"), at.call("damper_bottom"), rot.call("damper_top"), mirror)
		elif t == "live-leaf":
			var lf: Vector3 = at.call("leaf_front")
			var lr: Vector3 = at.call("leaf_rear")
			var leaf := _place(out, t, "leafspring", "susp_axle_leaf_%s_%s" % [axle, "right" if mirror else "left"], (lf + lr) / 2.0, null, rot.call("leaf_front"), mirror)
			if leaf != null:
				leaf.basis = leaf.basis.scaled_local(Vector3(1.0, 1.0, maxf(0.2, absf(lf.z - lr.z))))
			_place(out, t, "damper", "susp_damper_" + corner, at.call("damper_top"), at.call("damper_bottom"), rot.call("damper_top"), mirror)
	if t == "live-trailing":
		_place(out, t, "panhard", "susp_panhard_" + axle, m["panhard"]["p"], m["panhard_axle"]["p"], m["panhard"]["r"], false)
	if axle == "front" and not is_live(t):
		var rack := _place(out, "steering", "rack", "steer_rack", m["rack"]["p"], null, m["rack"]["r"], false)
		if rack != null and m.has("rack_end"):
			rack.basis = rack.basis.scaled_local(Vector3(maxf(0.1, 2.0 * absf(m["rack_end"]["p"].x - m["rack"]["p"].x)), 1.0, 1.0))


static func _drive(cfg: Dictionary) -> Dictionary:
	var d := str(cfg.get("drivetrain", {}).get("drive", "rwd"))
	return {"front": d != "rwd", "rear": d != "fwd"}


static func _build_driveline(out: Dictionary, cfg: Dictionary, geo: Dictionary) -> void:
	var dl: Dictionary = cfg.get("driveline", {}) if cfg.get("driveline") is Dictionary else {}
	var mset: Dictionary = dl.get("mounts", {}) if dl.get("mounts") is Dictionary else {}
	var place := str(dl.get("engine", "front"))
	var zf: float = geo["front"]["W"].z
	var zr: float = geo["rear"]["W"].z
	var yw: float = (geo["front"]["W"].y + geo["rear"]["W"].y) / 2.0
	var mount := func(name: String, d: Vector3) -> Dictionary:
		var m: Variant = mset.get(name)
		var p: Variant = m.get("position") if m is Dictionary else null
		var r: Variant = m.get("rotation") if m is Dictionary else null
		return {"p": Vector3(float(p[0]), float(p[1]), float(p[2])) if p is Array and (p as Array).size() == 3 else d,
			"r": Vector3(float(r[0]), float(r[1]), float(r[2])) if r is Array and (r as Array).size() == 3 else Vector3.ZERO}
	var eng: Dictionary = mount.call("engine", Vector3(0, yw + 0.35, zf - 0.35) if place == "front" else (Vector3(0, yw + 0.3, (zf + zr) / 2.0 - 0.4) if place == "mid" \
		else Vector3(0, yw + 0.3, zr - 0.2)))
	var gb: Dictionary = mount.call("gearbox", Vector3(0, yw + 0.1, zr + 0.5) if place == "rear" else (Vector3(0, yw + 0.15, zf - 1.05) if place == "front" \
		else Vector3(0, yw + 0.1, (zf + zr) / 2.0 - 1.1)))
	_place(out, "driveline", "engine", "engine", eng["p"], null, eng["r"], false)
	_place(out, "driveline", "gearbox", "gearbox", gb["p"], null, gb["r"], false)
	var driven := _drive(cfg)
	for axle in ["front", "rear"]:
		var t := type_of(cfg, axle)
		if not driven[axle] or not TYPES.has(t):
			continue
		var g: Dictionary = geo[axle]
		var target: Vector3
		if is_live(t):
			target = Vector3(0.0, g["W"].y, g["W"].z)
		else:
			var diff: Dictionary = mount.call("diff_" + axle, Vector3(0.0, yw, g["W"].z))
			target = diff["p"]
			_place(out, "driveline", "differential", "differential_" + axle, target, null, diff["r"], false)
			for i in 2:
				var side := 1.0 if i == 0 else -1.0
				var corner: String = (["FL", "FR"] if axle == "front" else ["RL", "RR"])[i]
				_place(out, "driveline", "driveshaft", "susp_driveshaft_" + corner, target, Vector3(g["W"].x * side, g["W"].y, g["W"].z), Vector3.ZERO, side < 0.0)
		# the propshaft from the gearbox (when it is more than 0.4 m from the differential or the live axle)
		var ps: Dictionary = mount.call("prop_%s_start" % axle, gb["p"])
		var pe: Dictionary = mount.call("prop_%s_end" % axle, target)
		if (gb["p"] as Vector3).distance_to(target) > 0.4 and (ps["p"] as Vector3).distance_to(pe["p"]) > 0.1:
			_place(out, "driveline", "propshaft", ("susp_propshaft_" if is_live(t) else "propshaft_") + axle, ps["p"], pe["p"], ps["r"], false)
