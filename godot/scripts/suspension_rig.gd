class_name SuspensionRig
extends Node3D
## The moving parts of the suspension and the steering of a model (web/js/SuspensionRig.js), when the model has them
## (or the parts library built them: PartsLibrary of the car editor): wishbones that swing with the travel of the wheel, uprights that go
## up and down with it and turn with the steering, springs, dampers and struts that get shorter and longer (a coilover
## with a piston and a coil: the piston slides and the coil gets shorter), a steering rack that slides and tie rods that
## follow it, a live axle that goes up and down and rolls, trailing arms, a Panhard rod, driveshafts and propshafts.
## The physics is not changed by it: the parts follow the travel of every wheel and the steering.
##
## The names (case and other characters do not matter), with the corner FL, FR, RL or RR at the end: susp_upperarm_FL,
## susp_lowerarm_FL (the origin at the hinge on the body), susp_upright_FL (the origin at the middle of the wheel),
## susp_spring_FL, susp_damper_FL, susp_strut_FL (the origin at the top mount), steer_rack, steer_tierod_FL (the origin
## at the end on the rack), susp_axle_rear, susp_trailingarm_RL, susp_panhard_rear, susp_driveshaft_RL, propshaft.
## Not ported: the steering column of a model with fixed tie rods and no rack (the rods follow the uprights here), the
## turn of the wheel about the pin of the upright.
##
## The parts leave the model (the shell does not bend them) and hang in holders on the car, in the frame of the car.

const CORNERS := {"fl": 0, "fr": 1, "rl": 2, "rr": 3}

var car: Car
var parts: Array = []               # {kind, wheel, rear, origin, far, holder, rest_q, ...}
var rack_travel := 0.1
var uprights := {}


## The parts library of a car (when car.json says a type of suspension) and the rig of the parts of the suspension of
## its model; a motorcycle has its own (MotorcycleModel).
static func attach(c: Car) -> void:
	if c.bike != null:
		return
	var lib: Node3D = null
	if str(c.config.get("wheels", {}).get("mode", "default")) != "model":
		# (the hubs where car.json puts the wheels, as the browser game does for the demo wheels: the axle offsets do not
		# move them)
		var ch: Dictionary = c.config.get("chassis", {})
		var wb := float(ch.get("wheelbase", 2.6)) / 2.0
		var ft := float(ch.get("front_track", 1.5)) / 2.0
		var rt := float(ch.get("rear_track", 1.5)) / 2.0
		var out := PartsLibrary.assemble(c.config, {"FL": Vector3(ft, 0, wb), "FR": Vector3(-ft, 0, wb), "RL": Vector3(rt, 0, -wb),
			"RR": Vector3(-rt, 0, -wb)}, float(ch.get("tire_diameter", 0.6)))
		lib = out["group"]
		# (the files it loaded are not kept in the game: the cache of the editor would hold them to the end)
		for k: String in PartsLibrary._cache:
			if PartsLibrary._cache[k] != null:
				(PartsLibrary._cache[k] as Node).free()
		PartsLibrary._cache.clear()
		if lib.get_child_count() == 0:
			lib.free()
			lib = null
		else:
			lib.name = "PartsLibrary"
			c.add_child(lib)
	find(c, [c.model_root, lib])


## Finds the parts of the suspension under the given roots (the model, and the parts the library built) and puts each
## in a holder of the rig; null when there are none.
static func find(c: Car, roots: Array) -> SuspensionRig:
	var found: Array = []
	for r in roots:
		if r == null:
			continue
		for n in (r as Node).find_children("*", "Node3D", true, false):
			var what := classify(str(n.name))
			if not what.is_empty():
				found.append([n, what])
	# (a part inside a part, the coil and the piston of a coilover, goes with its parent)
	found = found.filter(func(f: Array) -> bool:
		for g in found:
			if g != f and (g[0] as Node).is_ancestor_of(f[0]):
				return false
		return true)
	if found.is_empty():
		return null
	var rig := SuspensionRig.new()
	rig.name = "SuspensionRig"
	rig.car = c
	var st: Variant = c.config.get("steering", {})
	if st is Dictionary and (st as Dictionary).has("rack_travel"):
		rig.rack_travel = float(st["rack_travel"])
	c.add_child(rig)
	rig._build(found)
	return rig


static func _clean(n: String) -> String:
	var out := ""
	for ch in n.to_lower():
		if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
			out += ch
	return out


## What a part is, from its name: {kind, wheel, rear}, or {}.
static func classify(raw: String) -> Dictionary:
	var n := _clean(raw)
	var re := func(p: String) -> bool: return RegEx.create_from_string(p).search(n) != null
	if re.call("^susppropshaft(rear|front|back)"):
		return {"kind": "propaxle", "rear": n.find("front") < 0}
	if re.call("^(susp)?(propshaft|cardan)") or re.call("^(susp)?driveshaft(center|centre|middle|prop)"):
		return {"kind": "prop"}
	var wheel: int = CORNERS.get(n.right(2), -1)
	if n.find("solidaxle") >= 0 or n.find("liveaxle") >= 0 or re.call("^(rear|front|back)?solid") or n.begins_with("axle"):
		return {"kind": "axle", "rear": n.find("front") < 0}
	if wheel >= 0 and n.find("trailing") >= 0:
		return {"kind": "trailing", "wheel": wheel}
	if wheel >= 0 and re.call("^(coilover|damper|shock|strut|spring)"):
		return {"kind": "spring", "wheel": wheel}
	if not n.begins_with("susp") and not n.begins_with("steer"):
		return {}
	if n == "steerrack" or n == "susprack":
		return {"kind": "rack"}
	if n.find("axle") >= 0:
		return {"kind": "axle", "rear": n.find("rear") >= 0 or n.find("back") >= 0}
	if n.find("panhard") >= 0 or n.find("watt") >= 0:
		return {"kind": "panhard", "rear": n.find("front") < 0}
	if wheel < 0:
		return {}
	for pair in [["trailing", "trailing"], ["driveshaft", "shaft"], ["halfshaft", "shaft"], ["shaft", "shaft"], ["arm", "arm"], ["wishbone", "arm"],
			["link", "arm"], ["upright", "upright"], ["hub", "upright"], ["knuckle", "upright"], ["spring", "spring"], ["damper", "spring"], ["strut", "spring"],
			["shock", "spring"], ["coilover", "spring"], ["tierod", "tierod"], ["trackrod", "tierod"]]:
		if n.find(pair[0]) >= 0:
			return {"kind": pair[1], "wheel": wheel}
	return {}


## The box of a part in the frame of the car.
func _box(node: Node3D) -> AABB:
	return CarModel.bounds(node, car)


## The middle of the face of the box of a part that is farthest from its origin (the free end of an arm, the bottom of
## a spring).
func _far_end(node: Node3D, origin: Vector3) -> Vector3:
	var box := _box(node)
	var centre := box.get_center()
	var dir := centre - origin
	if dir.length() < 1e-4:
		return centre
	dir = dir.normalized()
	var half := absf(dir.x) * box.size.x / 2.0 + absf(dir.y) * box.size.y / 2.0 + absf(dir.z) * box.size.z / 2.0
	return centre + dir * half


func _build(found: Array) -> void:
	for f in found:
		var node: Node3D = f[0]
		var what: Dictionary = f[1]
		var xf := CarModel.relative(node, car)
		var origin := xf.origin
		var e := {"kind": what["kind"], "wheel": int(what.get("wheel", -1)), "rear": bool(what.get("rear", true)), "origin": origin}
		var holder := Node3D.new()
		holder.name = "rig-" + str(node.name)
		holder.position = origin
		var exact: Variant = node.get_meta("rig_far") if node.has_meta("rig_far") else null
		var k: String = e["kind"]
		if k == "trailing":
			e["far"] = exact if exact != null else _far_end(node, origin)
			e["arm"] = maxf(0.05, absf(e["far"].z - origin.z))
			e["ahead"] = 1.0 if e["far"].z >= origin.z else -1.0
		elif k in ["spring", "tierod", "panhard", "shaft", "propaxle"]:
			e["far"] = exact if exact != null else _far_end(node, origin)
			var d: Vector3 = e["far"] - origin
			e["length"] = maxf(0.01, d.length())
			holder.basis = Basis(Quaternion(Vector3.UP, d.normalized()))
			if k == "spring":
				e["strut"] = _clean(str(node.name)).find("strut") >= 0
		elif k == "prop":
			var box := _box(node)
			if exact != null:
				e["axis"] = ((exact as Vector3) - origin).normalized()
				holder.position = (origin + exact) / 2.0
			else:
				var s := box.size
				e["axis"] = Vector3.RIGHT if s.x >= s.y and s.x >= s.z else (Vector3.UP if s.y >= s.z else Vector3.FORWARD)
				holder.position = box.get_center()
		elif k == "arm":
			e["far"] = exact if exact != null else _far_end(node, origin)
			e["arm"] = maxf(0.05, absf(e["far"].x - origin.x))
			e["side"] = 1.0 if e["far"].x >= origin.x else -1.0
		add_child(holder)
		node.get_parent().remove_child(node)
		node.owner = null
		holder.add_child(node)
		node.transform = holder.transform.affine_inverse() * xf
		e["holder"] = holder
		e["rest_q"] = holder.basis.get_rotation_quaternion()
		e["rest_pos"] = holder.position
		if k == "spring":
			e["inner"] = _inner(node, e)
		if k == "upright":
			uprights[e["wheel"]] = e
		parts.append(e)
	# a foot of a spring on an arm (it goes round the hinge of the arm), on a trailing arm, or on a live axle
	for p: Dictionary in parts:
		if p["kind"] != "trailing":
			continue
		for a: Dictionary in parts:
			if a["kind"] == "axle" and a["rear"] == (p["wheel"] >= 2) and absf(p["far"].z - a["origin"].z) < 0.15:
				p["on_axle"] = a
	for p: Dictionary in parts:
		if p["kind"] != "spring" or p["strut"]:
			continue
		var best: Variant = null
		var best_t: Variant = null
		var axle: Variant = null
		for a: Dictionary in parts:
			if a["kind"] == "axle" and a["rear"] == (p["wheel"] >= 2):
				axle = a
		if axle != null and absf(p["far"].z - axle["origin"].z) < 0.15:
			p["on_axle"] = axle
			continue
		for a: Dictionary in parts:
			if a.get("wheel", -1) != p["wheel"]:
				continue
			if a["kind"] == "arm":
				var lo := minf(a["origin"].x, a["far"].x)
				var hi := maxf(a["origin"].x, a["far"].x)
				if p["far"].x < lo - 0.02 or p["far"].x > hi + 0.02 or absf(p["far"].x - a["origin"].x) < 0.03:
					continue
				if best == null or a["origin"].y < best["origin"].y:
					best = a
			elif a["kind"] == "trailing":
				var zlo := minf(a["origin"].z, a["far"].z)
				var zhi := maxf(a["origin"].z, a["far"].z)
				if p["far"].z < zlo - 0.02 or p["far"].z > zhi + 0.02 or absf(p["far"].z - a["origin"].z) < 0.03 or absf(p["far"].z - a["far"].z) < 0.05:
					continue
				if best_t == null or a["origin"].y < best_t["origin"].y:
					best_t = a
		if best != null:
			p["on_arm"] = best
		elif best_t != null:
			p["on_trailing"] = best_t
		elif axle != null:
			p["on_axle"] = axle


## The parts inside a spring or a damper: a piston (piston, rod, shaft) slides along it with the travel, a coil (coil,
## spring) gets shorter and longer about its own origin; the cylinder keeps its length. Without them the whole part is
## scaled.
func _inner(node: Node3D, e: Dictionary) -> Variant:
	var out: Array = []
	var axis: Vector3 = (e["far"] - e["origin"]).normalized()
	for child in node.find_children("*", "Node3D", true, false):
		var n := _clean(str(child.name))
		var kind := "piston" if RegEx.create_from_string("piston|rod|shaft").search(n) else ("coil" if RegEx.create_from_string("coil(?!over)|spring").search(n) else "")
		if kind == "":
			continue
		var holds := false
		for g in child.find_children("*", "Node3D", true, false):
			if RegEx.create_from_string("piston|rod|shaft|coil(?!over)|spring").search(_clean(str(g.name))):
				holds = true
		if holds:
			continue
		var c := child as Node3D
		var parent_xf := CarModel.relative(c.get_parent() as Node3D, car)
		var in_parent := (parent_xf.basis.inverse() * axis)
		var kk := (parent_xf.basis * in_parent.normalized()).length()
		var own := (CarModel.relative(c, car).basis.inverse() * axis).normalized()
		var scale_axis := 0 if absf(own.x) >= absf(own.y) and absf(own.x) >= absf(own.z) else (1 if absf(own.y) >= absf(own.z) else 2)
		in_parent = in_parent.normalized()
		var along := clampf(c.position.dot(in_parent) * kk / maxf(0.01, e["length"]), 0.0, 1.0)
		out.append({"node": c, "kind": kind, "rest": c.position, "rest_scale": c.scale, "in_parent": in_parent, "axis": scale_axis, "along": along, "k": kk})
	return out if not out.is_empty() else null


## The travel of a wheel upwards from where the model has it (m).
func _travel(i: int) -> float:
	var w := car.wheels[i]
	return car.susp_length - w.length + w.offset


## How far up a live axle is at a distance x from its middle: the mean travel of its two wheels, and its roll.
func _axle_at(rear: bool, x: float) -> float:
	var l := _travel(2 if rear else 0)
	var r := _travel(3 if rear else 1)
	var track := car.rear_track if rear else car.front_track
	return (l + r) / 2.0 + (l - r) / maxf(0.5, track) * x


func _process(_delta: float) -> void:
	if car == null or not is_instance_valid(car):
		return
	var rack_shift := -rack_travel * car.steer_angle   # (along +x, to the left, for a steer to the right)
	for p: Dictionary in parts:
		var h: Node3D = p["holder"]
		var k: String = p["kind"]
		var rest_q: Quaternion = p["rest_q"]
		match k:
			"arm":
				var a: float = asin(clampf(_travel(p["wheel"]) / p["arm"], -1.0, 1.0)) * p["side"]
				h.basis = Basis(Quaternion(Vector3.FORWARD, a) * rest_q)
			"prop":
				var turn := 0.0
				for w in car.wheels:
					turn += w.spin
				h.basis = Basis(p["axis"], turn / 4.0)
			"upright":
				h.position = p["origin"] + Vector3.UP * _travel(p["wheel"])
				if p["wheel"] < 2:
					h.basis = Basis(Quaternion(Vector3.UP, car.wheels[p["wheel"]].steer) * rest_q)
			"spring":
				var t: Vector3
				if p.has("on_arm"):
					var arm: Dictionary = p["on_arm"]
					var aa: float = asin(clampf(_travel(p["wheel"]) / arm["arm"], -1.0, 1.0)) * arm["side"]
					t = arm["origin"] + Basis(Vector3.FORWARD, aa) * (p["far"] - arm["origin"])
				elif p.has("on_trailing"):
					var tr: Dictionary = p["on_trailing"]
					var tt := _axle_at(tr["on_axle"]["rear"], tr["far"].x) if tr.has("on_axle") else _travel(p["wheel"])
					var ta: float = -tr["ahead"] * asin(clampf(tt / tr["arm"], -1.0, 1.0))
					t = tr["origin"] + Basis(Vector3.RIGHT, ta) * (p["far"] - tr["origin"])
				elif p.has("on_axle"):
					t = p["far"] + Vector3.UP * _axle_at(p["on_axle"]["rear"], p["far"].x)
				else:
					t = p["far"] + Vector3.UP * _travel(p["wheel"])
				var d: Vector3 = t - p["origin"]
				var length := d.length()
				var q := Quaternion(Vector3.UP, d.normalized())
				if p["strut"] and p["wheel"] < 2:
					q = q * Quaternion(Vector3.UP, car.wheels[p["wheel"]].steer)
				h.basis = Basis(q)
				if p["inner"] != null:
					var delta: float = length - p["length"]
					for part: Dictionary in p["inner"]:
						var n: Node3D = part["node"]
						n.position = part["rest"] + part["in_parent"] * (delta / part["k"] * (1.0 if part["kind"] == "piston" else part["along"]))
						if part["kind"] == "coil":
							var s: Vector3 = part["rest_scale"]
							s[part["axis"]] = s[part["axis"]] * maxf(0.2, (p["length"] + delta) / p["length"])
							n.scale = s
				else:
					h.basis = h.basis.scaled_local(Vector3(1.0, maxf(0.2, length / p["length"]), 1.0))
			"rack":
				h.position = p["origin"] + Vector3(rack_shift, 0.0, 0.0)
			"tierod":
				var up: Variant = uprights.get(p["wheel"])
				var t: Vector3 = p["far"]
				if up != null and p["wheel"] < 2:
					t = up["origin"] + Basis(Vector3.UP, car.wheels[p["wheel"]].steer) * (t - up["origin"])
				t += Vector3.UP * _travel(p["wheel"])
				h.position = p["origin"] + Vector3(rack_shift if p["wheel"] < 2 else 0.0, 0.0, 0.0)
				_aim(h, t - h.position, p["length"])
			"trailing":
				var tt := _axle_at(p["on_axle"]["rear"], p["far"].x) if p.has("on_axle") else _travel(p["wheel"])
				h.basis = Basis(Quaternion(Vector3.RIGHT, -p["ahead"] * asin(clampf(tt / p["arm"], -1.0, 1.0))) * rest_q)
			"shaft":
				var hub: Variant = uprights.get(p["wheel"])
				var t: Vector3 = (hub["origin"] if hub != null else p["far"]) + Vector3.UP * _travel(p["wheel"])
				_aim(h, t - p["origin"], p["length"])
			"panhard":
				_aim(h, p["far"] + Vector3.UP * _axle_at(p["rear"], p["far"].x) - p["origin"], p["length"])
			"axle":
				var l := _travel(2 if p["rear"] else 0)
				var r := _travel(3 if p["rear"] else 1)
				var track := car.rear_track if p["rear"] else car.front_track
				h.position = p["rest_pos"] + Vector3.UP * _axle_at(p["rear"], p["origin"].x)
				h.basis = Basis(Quaternion(Vector3.FORWARD, atan2(l - r, track)) * rest_q)
			"propaxle":
				var al := _travel(2 if p["rear"] else 0)
				var ar := _travel(3 if p["rear"] else 1)
				var d: Vector3 = p["far"] + Vector3.UP * ((al + ar) / 2.0) - p["origin"]
				var spin := (car.wheels[2 if p["rear"] else 0].spin + car.wheels[3 if p["rear"] else 1].spin) / 2.0
				h.basis = Basis(Quaternion(Vector3.UP, d.normalized()) * Quaternion(Vector3.UP, spin)).scaled_local(Vector3(1.0, maxf(0.2, d.length() / p["length"]), 1.0))


## A part along d from its origin, stretched to its length.
static func _aim(h: Node3D, d: Vector3, rest_length: float) -> void:
	h.basis = Basis(Quaternion(Vector3.UP, d.normalized())).scaled_local(Vector3(1.0, maxf(0.2, d.length() / rest_length), 1.0))
