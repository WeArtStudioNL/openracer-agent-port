class_name PartsLibrary
extends RefCounted
## The suspension and the driveline of a car built from loose parts (web/js/PartsLibrary.js): a type of suspension for the
## front and for the rear (car.json "suspension": double-wishbone, macpherson, live-trailing, live-leaf; "model" keeps the
## parts of the model, "none"), the drive and where the engine is ("driveline"). The parts are glb files of the game,
## web/parts/<type>/<part>.glb, each modelled for the LEFT side (+x) on a nominal size; the right side is the mirror.
## A stretched part has its origin at the end on the body and is 1 m long along +Y: it is aimed at its other end and
## stretched to it. The mounts (the points the parts hang on) have defaults from the wheels and can be moved in the
## car editor. Used by the car editor (the Suspension and driveline card); the physics is not changed by any of it.

const TYPES := {
	"model": {"label": "From the model (parts named susp_…)", "files": [], "mounts": []},
	"none": {"label": "None", "files": [], "mounts": []},
	"double-wishbone": {"label": "Double wishbone", "files": ["upperarm", "lowerarm", "upright", "coilover", "tierod"],
		"mounts": ["upper_hinge", "upper_ball", "lower_hinge", "lower_ball", "spring_top", "spring_bottom", "tierod_inner", "tierod_outer", "rack", "rack_end"]},
	"macpherson": {"label": "MacPherson strut", "files": ["lowerarm", "strut", "upright", "tierod"],
		"mounts": ["lower_hinge", "lower_ball", "strut_top", "strut_bottom", "tierod_inner", "tierod_outer", "rack", "rack_end"]},
	"live-trailing": {"label": "Live axle, trailing arms", "files": ["axle", "trailingarm", "uppertrailingarm", "coilover", "damper", "panhard"],
		"mounts": ["axle_end", "lower_hinge", "lower_arm_end", "upper_hinge", "upper_arm_end", "spring_top", "spring_bottom", "damper_top", "damper_bottom",
			"panhard", "panhard_axle"]},
	"live-leaf": {"label": "Live axle, leaf springs", "files": ["axle", "leafspring", "damper"],
		"mounts": ["axle_end", "leaf_front", "leaf_rear", "damper_top", "damper_bottom"]},
}
const MOUNT_LABELS := {
	"upper_hinge": "Upper arm: hinge on the body", "upper_ball": "Upper arm: ball joint", "lower_hinge": "Lower arm: hinge on the body",
	"lower_ball": "Lower arm: ball joint", "spring_top": "Spring: top mount", "spring_bottom": "Spring: bottom (seat)", "strut_top": "Strut: top mount",
	"strut_bottom": "Strut: foot on the upright", "tierod_inner": "Tie rod: inner end", "tierod_outer": "Tie rod: outer end (steering arm)",
	"rack": "Steering rack (the middle)", "rack_end": "Steering rack: end (the width; along the rack only)", "damper_top": "Damper: top mount",
	"damper_bottom": "Damper: bottom (on the axle)", "lower_arm_end": "Lower trailing arm: end on the axle", "upper_arm_end": "Upper trailing arm: end on the axle",
	"panhard": "Panhard rod: end on the body", "panhard_axle": "Panhard rod: end on the axle (the other side)",
	"axle_end": "Axle: end (the width; along the axle only)", "leaf_front": "Leaf spring: front hanger", "leaf_rear": "Leaf spring: rear hanger",
	"engine": "Engine", "gearbox": "Gearbox", "diff_front": "Front differential", "diff_rear": "Rear differential",
	"prop_front_start": "Propshaft to the front: at the gearbox", "prop_front_end": "Propshaft to the front: at the differential",
	"prop_rear_start": "Propshaft to the rear: at the gearbox", "prop_rear_end": "Propshaft to the rear: at the differential",
}
const ENGINE := ["front", "mid", "rear"]
const DRIVELINE_FILES := ["engine", "gearbox", "differential", "propshaft", "driveshaft"]
const PART_LABELS := {
	"upperarm": "Upper arm", "lowerarm": "Lower arm", "upright": "Upright", "coilover": "Coilover", "tierod": "Tie rod", "strut": "Strut",
	"rack": "Steering rack", "axle": "Axle", "trailingarm": "Lower trailing arm", "uppertrailingarm": "Upper trailing arm", "damper": "Damper",
	"panhard": "Panhard rod", "leafspring": "Leaf spring", "engine": "Engine", "gearbox": "Gearbox", "differential": "Differential",
	"propshaft": "Propshaft", "driveshaft": "Driveshafts",
}

static var _cache := {}              # path -> Node3D (the scene of the part), or null when it is not there


static func is_live(t: String) -> bool:
	return t == "live-trailing" or t == "live-leaf"


static func type_of(cfg: Dictionary, axle: String) -> String:
	var s: Variant = cfg.get("suspension", {}).get(axle) if cfg.get("suspension") is Dictionary else null
	return str(s.get("type")) if s is Dictionary and TYPES.has(str(s.get("type", ""))) else "model"


static func engine_place(cfg: Dictionary) -> String:
	var e: Variant = cfg.get("driveline", {}).get("engine") if cfg.get("driveline") is Dictionary else null
	return str(e) if str(e) in ENGINE else "front"


static func driven(cfg: Dictionary) -> Dictionary:
	var d := str(cfg.get("drivetrain", {}).get("drive", "rwd")) if cfg.get("drivetrain") is Dictionary else "rwd"
	return {"front": d != "rwd", "rear": d != "fwd"}


static func hidden_of(cfg: Dictionary, group: String) -> Array:
	var h: Variant = null
	if group == "driveline":
		h = cfg.get("driveline", {}).get("hidden") if cfg.get("driveline") is Dictionary else null
	elif cfg.get("suspension") is Dictionary and cfg["suspension"].get(group) is Dictionary:
		h = cfg["suspension"][group].get("hidden")
	return h if h is Array else []


## The parts of a group for the editor: [{ file, label }].
static func parts_of(cfg: Dictionary, group: String) -> Array:
	var out := []
	if group == "driveline":
		for f in DRIVELINE_FILES:
			out.append({"file": f, "label": PART_LABELS[f]})
		return out
	var t := type_of(cfg, group)
	if t == "model" or t == "none":
		return out
	var files: Array = TYPES[t]["files"].duplicate()
	if group == "front" and not is_live(t):
		files.append("rack")
	for f in files:
		out.append({"file": f, "label": PART_LABELS.get(f, f)})
	return out


## The geometry of the car from the centres of the wheels (FL, FR, RL, RR: Vector3) and their diameter.
static func geometry(centres: Dictionary, diameter: float) -> Dictionary:
	var fl: Vector3 = centres["FL"] if centres["FL"].x >= centres["FR"].x else centres["FR"]
	var rl: Vector3 = centres["RL"] if centres["RL"].x >= centres["RR"].x else centres["RR"]
	return {
		"front": {"W": Vector3(absf(fl.x), fl.y, (centres["FL"].z + centres["FR"].z) / 2.0), "track": absf(centres["FL"].x - centres["FR"].x)},
		"rear": {"W": Vector3(absf(rl.x), rl.y, (centres["RL"].z + centres["RR"].z) / 2.0), "track": absf(centres["RL"].x - centres["RR"].x)},
		"radius": (diameter if diameter > 0.0 else 0.6) / 2.0,
	}


static func mount_names(t: String, axle: String) -> Array:
	var out := []
	if not TYPES.has(t):
		return out
	for m in TYPES[t]["mounts"]:
		if (m != "rack" and m != "rack_end") or axle == "front":
			out.append(m)
	return out


static func _at(p: Array) -> Dictionary:
	return {"position": p, "rotation": [0.0, 0.0, 0.0]}


static func default_mount(mount: String, axle: String, geo: Dictionary) -> Dictionary:
	var w: Vector3 = geo[axle]["W"]
	var xw := w.x
	var yw := w.y
	var z := w.z
	var fwd := 1.0 if axle == "front" else -1.0
	match mount:
		"upper_hinge": return _at([0.35 * xw, yw + 0.18, z])
		"upper_ball": return _at([xw - 0.12, yw + 0.17, z])
		"lower_hinge": return _at([0.35 * xw, yw - 0.15, z])
		"lower_ball": return _at([xw - 0.12, yw - 0.17, z])
		"spring_top": return _at([0.62 * xw, yw + 0.65, z])
		"spring_bottom": return _at([0.35 * xw + 0.75 * (xw - 0.12 - 0.35 * xw), yw - 0.15 + 0.75 * (-0.02), z])
		"strut_top": return _at([0.75 * xw, yw + 0.7, z - 0.03])
		"strut_bottom": return _at([xw - 0.12, yw - 0.05, z])
		"tierod_inner": return _at([0.25 * xw, yw, z + fwd * 0.18])
		"tierod_outer": return _at([xw - 0.12, yw, z + fwd * 0.14])
		"damper_bottom": return _at([0.55 * xw, yw, z - 0.1])
		"rack": return _at([0.0, yw, z + 0.18])
		"rack_end": return _at([0.45 * xw, yw, z + 0.18])
		"damper_top": return _at([0.5 * xw, yw + 0.7, z - 0.15])
		"panhard": return _at([0.8 * xw, yw + 0.15, z - 0.15])
		"leaf_front": return _at([0.75 * xw, yw + 0.1, z + 0.6])
		"leaf_rear": return _at([0.75 * xw, yw + 0.1, z - 0.6])
	return _at([0.0, yw, z])


static func default_live_mount(mount: String, axle: String, geo: Dictionary) -> Dictionary:
	var w: Vector3 = geo[axle]["W"]
	var xw := w.x
	var yw := w.y
	var z := w.z
	match mount:
		"axle_end": return _at([xw - 0.1, yw, z])
		"lower_hinge": return _at([0.7 * xw, yw + 0.05, z + 1.0])
		"lower_arm_end": return _at([0.7 * xw, yw, z])
		"upper_hinge": return _at([0.35 * xw, yw + 0.3, z + 1.0])
		"upper_arm_end": return _at([0.35 * xw, yw + 0.25, z])
		"spring_top": return _at([0.7 * xw, yw + 0.75, z + 0.1])
		"spring_bottom": return _at([0.7 * xw, yw + 0.05, z])
		"damper_bottom": return _at([0.55 * xw, yw + 0.05, z - 0.1])
		"panhard_axle": return _at([-0.7 * xw, yw + 0.1, z - 0.15])
	return default_mount(mount, axle, geo)


static func _pick(m: Variant, key: String, fallback: Array) -> Array:
	if m is Dictionary and m.get(key) is Array and (m[key] as Array).size() == 3:
		return [float(m[key][0]), float(m[key][1]), float(m[key][2])]
	return fallback.duplicate()


static func resolve_mounts(t: String, axle: String, given: Variant, geo: Dictionary) -> Dictionary:
	var out := {}
	for m in mount_names(t, axle):
		var d := default_live_mount(m, axle, geo) if is_live(t) else default_mount(m, axle, geo)
		var s: Variant = given.get(m) if given is Dictionary else null
		out[m] = {"position": _pick(s, "position", d["position"]), "rotation": _pick(s, "rotation", d["rotation"])}
	if out.has("rack") and out.has("rack_end"):
		var rp: Array = out["rack"]["position"]
		out["rack_end"] = {"position": [float(rp[0]) + maxf(0.05, absf(float(out["rack_end"]["position"][0]) - float(rp[0]))), rp[1], rp[2]],
			"rotation": [0.0, 0.0, 0.0]}
	if out.has("axle_end"):
		var w: Vector3 = geo[axle]["W"]
		out["axle_end"] = {"position": [maxf(0.1, absf(float(out["axle_end"]["position"][0]))), w.y, w.z], "rotation": [0.0, 0.0, 0.0]}
	return out


static func _mount_value(mount: String, cfg: Dictionary, geo: Dictionary, given: Variant) -> Array:
	var s: Variant = given.get(mount) if given is Dictionary else null
	if s is Dictionary and s.get("position") is Array and (s["position"] as Array).size() == 3:
		return s["position"]
	return default_driveline_mount(mount, cfg, geo)["position"]


static func _prop_to(cfg: Dictionary, axle: String, geo: Dictionary, given: Variant) -> bool:
	var t := type_of(cfg, axle)
	if not driven(cfg)[axle] or t == "model" or t == "none":
		return false
	var gb := _mount_value("gearbox", cfg, geo, given)
	var w: Vector3 = geo[axle]["W"]
	var target: Array = [0.0, w.y, w.z] if is_live(t) else _mount_value("diff_" + axle, cfg, geo, given)
	return Vector3(float(gb[0]) - float(target[0]), float(gb[1]) - float(target[1]), float(gb[2]) - float(target[2])).length() > 0.4


static func driveline_mount_names(cfg: Dictionary, geo: Dictionary, given: Variant) -> Array:
	var names := ["engine", "gearbox"]
	var dr := driven(cfg)
	for axle in ["front", "rear"]:
		var t := type_of(cfg, axle)
		if dr[axle] and t != "model" and t != "none" and not is_live(t):
			names.append("diff_" + axle)
	for axle in ["front", "rear"]:
		if _prop_to(cfg, axle, geo, given):
			names.append("prop_%s_start" % axle)
			names.append("prop_%s_end" % axle)
	return names


static func _driveline_given(cfg: Dictionary) -> Variant:
	return cfg.get("driveline", {}).get("mounts") if cfg.get("driveline") is Dictionary else null


static func default_driveline_mount(mount: String, cfg: Dictionary, geo: Dictionary) -> Dictionary:
	var zf: float = geo["front"]["W"].z
	var zr: float = geo["rear"]["W"].z
	var yw: float = (geo["front"]["W"].y + geo["rear"]["W"].y) / 2.0
	var place := engine_place(cfg)
	var p: Array = [0.0, yw, zr]
	if mount == "engine":
		p = [0.0, yw + 0.35, zf - 0.35] if place == "front" else ([0.0, yw + 0.3, (zf + zr) / 2.0 - 0.4] if place == "mid" else [0.0, yw + 0.3, zr - 0.2])
	elif mount == "gearbox":
		var front_only: bool = place == "front" and not driven(cfg)["rear"]      # (a transaxle beside the engine, on the axle: no propshaft)
		p = [0.0, yw + 0.1, zr + 0.3] if place == "rear" else ([0.3, yw + 0.1, zf - 0.2] if front_only else ([0.0, yw + 0.15, zf - 1.05] if place == "front" else [0.0, yw + 0.1, (zf + zr) / 2.0 - 1.1]))
	elif mount == "diff_front":
		p = [0.0, yw, zf]
	elif mount == "diff_rear":
		p = [0.0, yw, zr]
	elif mount.begins_with("prop_") and mount.ends_with("_start"):
		p = _mount_value("gearbox", cfg, geo, _driveline_given(cfg)).duplicate()
	elif mount.begins_with("prop_") and mount.ends_with("_end"):
		var ax := "front" if mount.contains("front") else "rear"
		var w: Vector3 = geo[ax]["W"]
		p = [0.0, w.y, w.z] if is_live(type_of(cfg, ax)) else _mount_value("diff_" + ax, cfg, geo, _driveline_given(cfg)).duplicate()
	return _at(p)


static func resolve_driveline(cfg: Dictionary, geo: Dictionary) -> Dictionary:
	var given: Variant = _driveline_given(cfg)
	var out := {}
	for m in driveline_mount_names(cfg, geo, given):
		var d := default_driveline_mount(m, cfg, geo)
		var s: Variant = given.get(m) if given is Dictionary else null
		out[m] = {"position": _pick(s, "position", d["position"]), "rotation": _pick(s, "rotation", d["rotation"])}
	return out


## The mounts of a car with their values (defaults filled in): { front: {}, rear: {}, driveline: {} }.
static func mounts_of(cfg: Dictionary, centres: Dictionary, diameter: float) -> Dictionary:
	var geo := geometry(centres, diameter)
	var out := {"front": {}, "rear": {}, "driveline": {}}
	for axle in ["front", "rear"]:
		var t := type_of(cfg, axle)
		if t == "model" or t == "none":
			continue
		out[axle] = resolve_mounts(t, axle, cfg["suspension"][axle].get("mounts"), geo)
	var tf := type_of(cfg, "front")
	var tr := type_of(cfg, "rear")
	if (tf != "model" or tr != "model") and (tf != "none" or tr != "none"):
		out["driveline"] = resolve_driveline(cfg, geo)
	return out


## The model of a particular engine: parts/driveline/<block>.glb ("Inline-3 1.0 L" is Inline-3-1-0-L.glb), or "".
static func engine_model(cfg: Dictionary) -> String:
	var b: Variant = Tuning.read(cfg, "engine.build.block")
	if not b is String:
		return ""
	var re := RegEx.create_from_string("[^A-Za-z0-9]+")
	var n := re.sub(str(b).strip_edges(), "-", true).trim_prefix("-").trim_suffix("-")
	return n if n != "" and n != "engine" else ""


static func rel(t: String, file: String) -> String:
	return "parts/%s/%s.glb" % [t, file]


static func files_for(cfg: Dictionary) -> Array:
	var out := []
	var any := false
	for axle in ["front", "rear"]:
		var t := type_of(cfg, axle)
		if t == "model" or t == "none":
			continue
		any = true
		for f in TYPES[t]["files"]:
			out.append({"type": t, "file": f})
		if axle == "front" and not is_live(t):
			out.append({"type": "steering", "file": "rack"})
	if any:
		for f in DRIVELINE_FILES:
			out.append({"type": "driveline", "file": f})
		var own := engine_model(cfg)
		if own != "":
			out.append({"type": "driveline", "file": own, "optional": true})
	return out


## Frees the scenes of the parts that were loaded (they are kept while the car editor builds again and again; a car of
## the game frees them once it is assembled: kept, they were instances leaked at the exit).
static func clear_cache() -> void:
	for r in _cache:
		var n: Node3D = _cache[r]
		if n != null and is_instance_valid(n):
			n.free()
	_cache.clear()


static func _template(t: String, file: String) -> Node3D:
	var r := rel(t, file)
	if not _cache.has(r):
		_cache[r] = Content.load_model(r) if FileAccess.file_exists(Content.path(r)) else null
	return _cache[r]


## The files the car needs that are not in web/parts.
static func missing_files(cfg: Dictionary) -> Array:
	var out := []
	for f in files_for(cfg):
		if f.get("optional", false):
			continue
		var group := "driveline" if f["type"] == "driveline" else ("front" if f["type"] == "steering" or type_of(cfg, "front") == f["type"] else "rear")
		if f["file"] in hidden_of(cfg, group):
			continue
		if _template(f["type"], f["file"]) == null:
			out.append(rel(f["type"], f["file"]))
	return out


static func _mirrored(p: Array, side: float) -> Vector3:
	return Vector3(float(p[0]) * side, float(p[1]), float(p[2]))


## A part placed: origin, the far end of a stretched part (or null), the mount (its turn), mirrored for the right side.
static func _place(out: Dictionary, t: String, file: String, node_name: String, origin: Vector3, far: Variant, mount: Variant, mirror: bool) -> Node3D:
	var group: String = "driveline" if t == "driveline" else out["axle"]
	if file in out["hidden"].get(group, []):
		return null
	if in_model(node_name, file, t, out["model"]):
		if not file in out["from_model"][group]:
			out["from_model"][group].append(file)
		return null
	var tpl := _template(t, file)
	if t == "driveline" and file == "engine" and out["engine_model"] != "":
		var own := _template(t, out["engine_model"])
		if own != null:
			tpl = own
	if tpl == null:
		if not (t + "/" + file) in out["missing"]:
			out["missing"].append(t + "/" + file)
		return null
	var node := Node3D.new()
	node.name = node_name
	node.add_child(tpl.duplicate())
	var rot: Array = mount["rotation"] if mount is Dictionary and mount.has("rotation") else [0.0, 0.0, 0.0]
	var s := -1.0 if mirror else 1.0
	var basis := Basis.IDENTITY
	var scale := Vector3.ONE
	if far is Vector3:
		var d: Vector3 = far - origin
		var length := d.length()
		if length < 1e-4:
			d = Vector3.DOWN
			length = 0.05
		basis = Basis(Quaternion(Vector3.UP, d.normalized()))
		if float(rot[1]) != 0.0:
			basis = basis * Basis(Vector3.UP, deg_to_rad(float(rot[1])) * s)
		scale = Vector3(s, length, 1.0)
		node.set_meta("rig_far", far)          # (the exact far end, for the rig: the box of a slanted part reaches past it)
	else:
		basis = Basis.from_euler(Vector3(deg_to_rad(float(rot[0])), deg_to_rad(float(rot[1])) * s, deg_to_rad(float(rot[2])) * s), EULER_ORDER_XYZ)
		scale = Vector3(s, 1.0, 1.0)
	node.transform = Transform3D(basis * Basis.from_scale(scale), origin)
	out["group"].add_child(node)
	out["names"].append(node_name)
	return node


static func _scale_axis(node: Node3D, axis: int, value: float) -> void:
	if node == null:
		return
	var sc := node.basis.get_scale()
	var b := node.basis.orthonormalized()
	sc[axis] = value * signf(sc[axis]) if sc[axis] != 0.0 else value
	node.basis = b * Basis.from_scale(sc)


static func _build_axle(out: Dictionary, t: String, axle: String, mounts: Dictionary, geo: Dictionary) -> void:
	var g: Dictionary = geo[axle]
	var w: Vector3 = g["W"]
	var corners := ["FL", "FR"] if axle == "front" else ["RL", "RR"]
	if is_live(t):
		var ax := _place(out, t, "axle", "susp_axle_" + axle, Vector3(0.0, w.y, w.z), null, null, false)
		_scale_axis(ax, 0, maxf(0.2, 2.0 * absf(float(mounts["axle_end"]["position"][0])) if mounts.has("axle_end") else float(g["track"]) - 0.2))
	for i in 2:
		var side := 1.0 if i == 0 else -1.0
		var corner: String = corners[i]
		var mirror := side < 0.0
		var at := func(n: String) -> Vector3: return _mirrored(mounts[n]["position"], side)
		if t == "double-wishbone" or t == "macpherson":
			_place(out, t, "lowerarm", "susp_lowerarm_" + corner, at.call("lower_hinge"), at.call("lower_ball"), mounts["lower_hinge"], mirror)
			_place(out, t, "upright", "susp_upright_" + corner, Vector3(w.x * side, w.y, w.z), null, null, mirror)
			_place(out, t, "tierod", "steer_tierod_" + corner, at.call("tierod_inner"), at.call("tierod_outer"), mounts["tierod_inner"], mirror)
			if t == "double-wishbone":
				_place(out, t, "upperarm", "susp_upperarm_" + corner, at.call("upper_hinge"), at.call("upper_ball"), mounts["upper_hinge"], mirror)
				_place(out, t, "coilover", "susp_spring_" + corner, at.call("spring_top"), at.call("spring_bottom"), mounts["spring_top"], mirror)
			else:
				_place(out, t, "strut", "susp_strut_" + corner, at.call("strut_top"), at.call("strut_bottom"), mounts["strut_top"], mirror)
		elif t == "live-trailing":
			_place(out, t, "trailingarm", "susp_trailingarm_" + corner, at.call("lower_hinge"), at.call("lower_arm_end"), mounts["lower_hinge"], mirror)
			_place(out, t, "uppertrailingarm", "susp_uppertrailingarm_" + corner, at.call("upper_hinge"), at.call("upper_arm_end"), mounts["upper_hinge"], mirror)
			_place(out, t, "coilover", "susp_spring_" + corner, at.call("spring_top"), at.call("spring_bottom"), mounts["spring_top"], mirror)
			_place(out, t, "damper", "susp_damper_" + corner, at.call("damper_top"), at.call("damper_bottom"), mounts["damper_top"], mirror)
		elif t == "live-leaf":
			var lf: Vector3 = at.call("leaf_front")
			var lr: Vector3 = at.call("leaf_rear")
			var leaf := _place(out, t, "leafspring", "susp_axle_leaf_%s_%s" % [axle, "right" if mirror else "left"], (lf + lr) * 0.5, null, mounts["leaf_front"], mirror)
			_scale_axis(leaf, 2, maxf(0.2, absf(lf.z - lr.z)))
			_place(out, t, "damper", "susp_damper_" + corner, at.call("damper_top"), at.call("damper_bottom"), mounts["damper_top"], mirror)
	if t == "live-trailing":
		_place(out, t, "panhard", "susp_panhard_" + axle, _mirrored(mounts["panhard"]["position"], 1.0), _mirrored(mounts["panhard_axle"]["position"], 1.0),
			mounts["panhard"], false)
	if axle == "front" and not is_live(t):
		var rack := _place(out, "steering", "rack", "steer_rack", _mirrored(mounts["rack"]["position"], 1.0), null, mounts["rack"], false)
		if mounts.has("rack_end"):
			_scale_axis(rack, 0, maxf(0.1, 2.0 * absf(float(mounts["rack_end"]["position"][0]) - float(mounts["rack"]["position"][0]))))


static func _build_driveline(out: Dictionary, cfg: Dictionary, geo: Dictionary) -> void:
	var dm := resolve_driveline(cfg, geo)
	var dr := driven(cfg)
	out["axle"] = "driveline"
	_place(out, "driveline", "engine", "engine", _mirrored(dm["engine"]["position"], 1.0), null, dm["engine"], false)
	_place(out, "driveline", "gearbox", "gearbox", _mirrored(dm["gearbox"]["position"], 1.0), null, dm["gearbox"], false)
	for axle in ["front", "rear"]:
		var t := type_of(cfg, axle)
		if not dr[axle] or t == "model" or t == "none":
			continue
		var w: Vector3 = geo[axle]["W"]
		var target := Vector3(0.0, w.y, w.z)
		if not is_live(t):
			target = _mirrored(dm["diff_" + axle]["position"], 1.0)
			if not axle in out["own_diffs"]:
				_place(out, "driveline", "differential", "differential_" + axle, target, null, dm["diff_" + axle], false)
			var corners := ["FL", "FR"] if axle == "front" else ["RL", "RR"]
			for i in 2:
				var side := 1.0 if i == 0 else -1.0
				_place(out, "driveline", "driveshaft", "susp_driveshaft_" + corners[i], target, Vector3(w.x * side, w.y, w.z), null, side < 0.0)
		if dm.has("prop_%s_start" % axle):
			var ps := _mirrored(dm["prop_%s_start" % axle]["position"], 1.0)
			var pe := _mirrored(dm["prop_%s_end" % axle]["position"], 1.0)
			if ps.distance_to(pe) > 0.1:
				_place(out, "driveline", "propshaft", ("susp_propshaft_" if is_live(t) else "propshaft_") + axle, ps, pe, dm["prop_%s_start" % axle], false)


## The axles ("front", "rear") that have a differential or a transaxle of the model (an object differential..., transaxle...: the
## nearest axle): the library does not place one there.
static func own_diffs(body: Node3D, frame: Node3D, centres: Dictionary) -> Array:
	var out := []
	if body == null or not centres.has("FL") or not centres.has("RL"):
		return out
	for n in body.find_children("*", "Node3D", true, false):
		var c := SuspensionRig.clean(str(n.name))
		if c.begins_with("differential") or c.begins_with("transaxle"):
			var z := CarModel.relative(n as Node3D, frame).origin.z
			var axle := "front" if absf(z - float(centres["FL"].z)) < absf(z - float(centres["RL"].z)) else "rear"
			if not axle in out:
				out.append(axle)
	return out


## The moving parts that a model has itself, from the names of its objects (https://openracer.eu/docs.html#car-names):
## a list of [clean name, what SuspensionRig.classify makes of it].
static func model_parts(names: Array) -> Array:
	var out := []
	for n in names:
		var what := SuspensionRig.classify(str(n))
		if not what.is_empty():
			out.append([SuspensionRig.stem(str(n)), what])
	return out


## Whether the model has this part of the library itself: then the object of the model is used and the part of the
## library is not placed. A wishbone is the upper or the lower one; a coilover of the library (a spring round a
## damper) gives way to any spring, damper, strut or coilover of the model at that corner.
static func in_model(node_name: String, file: String, t: String, model: Array) -> bool:
	if model.is_empty():
		return false
	var want := SuspensionRig.classify(node_name)
	var clean_name := SuspensionRig.stem(node_name)
	for m in model:
		if m[0] == clean_name:
			return true
		if want.is_empty() or clean_name.contains("leaf") or str(m[0]).contains("leaf"):
			continue
		var has: Dictionary = m[1]
		if _same_part(want, has, clean_name, str(m[0]), file, t):
			return true
	return false


static func _same_part(want: Dictionary, has: Dictionary, name_a: String, name_b: String, file: String, t: String) -> bool:
	var ka: String = want["kind"]
	var kb: String = has["kind"]
	if ka in ["prop", "propaxle"] and kb in ["prop", "propaxle"]:
		return true
	if ka != kb or want["wheel"] != has["wheel"] or want["rear"] != has["rear"]:
		return false
	if ka == "arm" or ka == "trailing":
		return name_a.contains("upper") == name_b.contains("upper")
	if ka != "spring":
		return true
	if file == "strut" or t == "double-wishbone":
		return true
	if file == "damper":
		return _re_any(name_b, ["damper", "shock", "strut", "cylinder"])
	return _re_any(name_b, ["spring", "coil", "strut"])


static func _re_any(n: String, words: Array) -> bool:
	for w in words:
		if n.contains(w):
			return true
	return false


## The parts placed in the frame of the car: { group (Node3D), names, missing, from_model }. model_names: the names of
## the objects of the model of the car.
static func assemble(cfg: Dictionary, centres: Dictionary, diameter: float, model_names: Array = [], diffs: Array = []) -> Dictionary:
	var group := Node3D.new()
	group.name = "parts-library"
	var out := {"group": group, "names": [], "missing": [], "axle": "front", "engine_model": engine_model(cfg), "model": model_parts(model_names), "own_diffs": diffs,
		"from_model": {"front": [], "rear": [], "driveline": []},
		"hidden": {"front": hidden_of(cfg, "front"), "rear": hidden_of(cfg, "rear"), "driveline": hidden_of(cfg, "driveline")}}
	if not centres.has("FL"):
		return out
	var geo := geometry(centres, diameter)
	var any := false
	for axle in ["front", "rear"]:
		var t := type_of(cfg, axle)
		if t == "model" or t == "none":
			continue
		any = true
		out["axle"] = axle
		_build_axle(out, t, axle, resolve_mounts(t, axle, cfg["suspension"][axle].get("mounts"), geo), geo)
	if any:
		_build_driveline(out, cfg, geo)
	return out
