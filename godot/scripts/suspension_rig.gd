class_name SuspensionRig
extends RefCounted
## The moving parts of the suspension and the steering of a car (web/js/SuspensionRig.js): wishbones that swing with the
## travel of the wheel, uprights that go up and down with the wheel and turn with the steering, springs, dampers and
## struts that get shorter and longer (a coilover's piston slides and its coil is squeezed), a steering rack that slides
## and tie rods that follow it, a live axle that goes up and down and rolls, trailing arms, a Panhard rod, driveshafts and
## propshafts that turn. A part is used when a part of the model (or of the parts library, PartsLibrary.assemble, car.json
## "suspension" and "driveline") has its name: susp_lowerarm_FL, susp_upperarm_FL, susp_upright_FL, susp_spring_FL,
## susp_strut_FL, susp_damper_FL, steer_rack, steer_tierod_FL, susp_axle_rear, susp_trailingarm_RL, susp_panhard_rear,
## susp_driveshaft_FL, propshaft_rear, susp_propshaft_rear ... (case and other characters do not matter, the corner at the
## end). The physics is not changed by it; the parts follow the travel of every wheel and its steering.
##
## Every part is put in a holder (a Node3D in the frame of the body, under the node "SuspensionRig" of the car) that is
## moved every frame (update). The rest pose of the model is the car at rest on its springs (w.length = susp_length).

const CORNERS := {"fl": 0, "fr": 1, "rl": 2, "rr": 3}    # the index of the wheel in Car.wheels (FL, FR, RL, RR)
const SPRINGLIKE := ["spring", "tierod", "panhard", "shaft", "propaxle"]

static var _regex := {}

var car: Car
var root: Node3D                  # "SuspensionRig": the holders and the parts of the library that the rig did not take
var parts: Array[Dictionary] = []
var uprights := {}                # wheel -> the entry of its upright
var rack: Dictionary = {}
var rack_travel := 0.1            # m per radian of the front wheels (car.json steering.rack_travel)
var hubs := {}                    # wheel -> the middle of the wheel (the upright turns it about its pin)
var column: Dictionary = {}       # { centre, axis }: a steering column whose arm holds fixed tie rods (set by a steering wheel)
var column_angle := 0.0
var column_error := 0.0
var built: Dictionary = {}        # what PartsLibrary.assemble made (or {})
var _rods: Variant = null         # the fixed tie rods (found once), or []
var _column_key := ""


## The rig of a car: the parts of its model (body, the glb under the model pivot) and of the parts library. null when
## there is none.
static func build(c: Car, body: Node3D) -> SuspensionRig:
	if c.bike != null:
		return null
	var rig := SuspensionRig.new()
	rig.car = c
	rig.root = Node3D.new()
	rig.root.name = "SuspensionRig"
	c.add_child(rig.root)
	var roots: Array[Node3D] = []
	if body != null:
		roots.append(body)
	var centres := {}
	var diameter := 0.0
	for w in c.wheels:
		centres[w.slot] = w.hub + w.visual_offset
		diameter += w.radius * 2.0 / 4.0
	rig.hubs = {0: centres["FL"], 1: centres["FR"]}
	if _uses_library(c.config):
		var model_names := []
		if body != null:
			for n in body.find_children("*", "Node3D", true, false):
				model_names.append(str(n.name))
		rig.built = PartsLibrary.assemble(c.config, centres, diameter, model_names)
		PartsLibrary.clear_cache()          # (the templates: the car has its copies)
		if not (rig.built["missing"] as Array).is_empty():
			push_warning("PartsLibrary: missing " + ", ".join(rig.built["missing"]))
		rig.root.add_child(rig.built["group"])
		roots.append(rig.built["group"])
	var st: Variant = c.config.get("steering", {})
	if st is Dictionary and st.has("rack_travel"):
		rig.rack_travel = float(st["rack_travel"])
	rig._find(roots)
	if rig.parts.is_empty() and rig.built.is_empty():
		rig.root.queue_free()
		return null
	return rig


static func _uses_library(cfg: Dictionary) -> bool:
	for axle in ["front", "rear"]:
		var t := PartsLibrary.type_of(cfg, axle)
		if t != "model" and t != "none":
			return true
	return false


static func clean(n: String) -> String:
	var out := ""
	for ch in n.to_lower():
		if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
			out += ch
	return out


## What a part is, from its name: { kind, wheel, rear } or {} (SuspensionRig.js classify).
static func classify(node_name: String) -> Dictionary:
	var n := clean(node_name)
	if n == "":
		return {}
	if n.begins_with("susppropshaft") and (n.contains("rear") or n.contains("front") or n.contains("back")):
		return {"kind": "propaxle", "wheel": -1, "rear": not n.contains("front")}
	if _re("^(susp)?(propshaft|cardan)").search(n) != null or _re("^(susp)?driveshaft(center|centre|middle|prop)").search(n) != null:
		return {"kind": "prop", "wheel": -1, "rear": false}
	var wheel: int = CORNERS.get(n.right(2), -1)
	if n.contains("solidaxle") or n.contains("liveaxle") or _re("^(rear|front|back)?solid").search(n) != null or n.begins_with("axle"):
		return {"kind": "axle", "wheel": -1, "rear": not n.contains("front")}
	if wheel >= 0 and n.contains("trailing"):
		return {"kind": "trailing", "wheel": wheel, "rear": wheel >= 2}
	if wheel >= 0 and _re("^(coilover|damper|shock|strut|spring)").search(n) != null:
		return {"kind": "spring", "wheel": wheel, "rear": wheel >= 2}
	if not n.begins_with("susp") and not n.begins_with("steer"):
		return {}
	return _classify_susp(n, wheel)


static func _classify_susp(n: String, wheel: int) -> Dictionary:
	if n == "steerrack" or n == "susprack":
		return {"kind": "rack", "wheel": -1, "rear": false}
	if n.contains("axle"):
		return {"kind": "axle", "wheel": -1, "rear": n.contains("rear") or n.contains("back")}
	if n.contains("panhard") or n.contains("watt"):
		return {"kind": "panhard", "wheel": -1, "rear": not n.contains("front")}
	if wheel < 0:
		return {}
	var kinds := [["trailing", ["trailing"]], ["shaft", ["driveshaft", "halfshaft", "shaft"]], ["arm", ["arm", "wishbone", "link"]],
		["upright", ["upright", "hub", "knuckle"]], ["spring", ["spring", "damper", "strut", "shock", "coilover"]], ["tierod", ["tierod", "trackrod"]]]
	for k in kinds:
		for word in k[1]:
			if n.contains(word):
				return {"kind": k[0], "wheel": wheel, "rear": wheel >= 2}
	return {}


static func _re(pattern: String) -> RegEx:
	if not _regex.has(pattern):
		_regex[pattern] = RegEx.create_from_string(pattern)
	return _regex[pattern]


# ---- finding the parts

func _box(node: Node3D) -> AABB:
	return CarModel.bounds(node, car)


## The end of a part farthest from its origin, in the frame of the body: the middle of the face of its box that is
## farthest from the origin.
func _far_end(node: Node3D, origin: Vector3) -> Vector3:
	var box := _box(node)
	var centre := box.get_center()
	var dir := centre - origin
	if dir.length() < 1e-4:
		return centre
	dir = dir.normalized()
	var size := box.size
	var half := absf(dir.x) * size.x / 2.0 + absf(dir.y) * size.y / 2.0 + absf(dir.z) * size.z / 2.0
	return centre + dir * half


## The tip of a rod-like mesh farthest from the origin: the middle of its end cap.
func _tip_of(node: Node3D, origin: Vector3) -> Variant:
	var points: Array[Vector3] = []
	var far := 0.0
	var list: Array[Node] = node.find_children("*", "MeshInstance3D", true, false)
	if node is MeshInstance3D:
		list.append(node)
	for m in list:
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		var xf := CarModel.relative(mi, car)
		for si in mi.mesh.get_surface_count():
			var verts: PackedVector3Array = mi.mesh.surface_get_arrays(si)[Mesh.ARRAY_VERTEX]
			for v in verts:
				var p := xf * v
				points.append(p)
				far = maxf(far, p.distance_to(origin))
	var sum := Vector3.ZERO
	var count := 0
	for p in points:
		if p.distance_to(origin) > far - 0.012:
			sum += p
			count += 1
	return sum / count if count > 0 else null


## The parts inside a spring or a damper: a piston (piston, rod, shaft) slides along it, a coil (coil, spring) is
## squeezed about its own origin; the cylinder keeps its length. axis: from the top mount to the far end (body frame).
func _inner_parts(node: Node3D, axis: Vector3, rest_length: float) -> Array:
	var inner := []
	var piston_re := _re("piston|rod|shaft")
	var coil_re := _re("coil(?!over)|spring")
	for c in node.find_children("*", "Node3D", true, false):
		var child := c as Node3D
		var n := clean(str(child.name))
		var kind := "piston" if piston_re.search(n) != null else ("coil" if coil_re.search(n) != null else "")
		if kind == "":
			continue
		var holds := false
		for g in child.find_children("*", "Node3D", true, false):
			var gn := clean(str(g.name))
			if piston_re.search(gn) != null or coil_re.search(gn) != null:
				holds = true
		if holds:
			continue
		var parent := child.get_parent() as Node3D
		var pb := CarModel.relative(parent, car).basis
		var raw := pb.inverse() * axis
		var in_parent := raw.normalized()
		var k := 1.0 / maxf(1e-6, raw.length())        # m in the body for a unit along in_parent
		var own := CarModel.relative(child, car).basis.inverse() * axis
		var sa := 0 if absf(own.x) >= absf(own.y) and absf(own.x) >= absf(own.z) else (1 if absf(own.y) >= absf(own.z) else 2)
		var along := clampf(child.position.dot(in_parent) * k / maxf(0.01, rest_length), 0.0, 1.0)
		var mesh_length := CarModel.bounds(child, child).size[sa] * CarModel.relative(child, car).basis.get_scale()[sa]
		inner.append({"node": child, "kind": kind, "rest": child.position, "rest_basis": child.basis, "in_parent": in_parent,
			"axis": sa, "along": along, "k": k, "length": absf(mesh_length)})
	return inner


func _find(roots: Array[Node3D]) -> void:
	_gather_coilovers(roots)
	var found: Array[Dictionary] = []
	for r in roots:
		var list: Array[Node] = r.find_children("*", "Node3D", true, false)
		list.push_front(r)
		for n in list:
			var what := classify(str(n.name))
			if not what.is_empty():
				found.append({"node": n, "what": what})
	# (a part inside a part, the coil and the piston of a coilover, goes with its parent)
	var nodes := {}
	for p in found:
		nodes[p["node"]] = true
	var top: Array[Dictionary] = []
	for p in found:
		var inside := false
		var a: Node = (p["node"] as Node).get_parent()
		while a != null and not inside:
			inside = nodes.has(a)
			a = a.get_parent()
		if not inside:
			top.append(p)
	var has_rack := false
	for p in top:
		has_rack = has_rack or p["what"]["kind"] == "rack"
	for p in top:
		_add_part(p["node"], p["what"], has_rack)
	_seat_parts()
	_attach_calipers(roots)


## The piston and the coil of a coilover are parts of its cylinder, also when the model has them loose beside it (Blender
## without parents): else each would be a spring of its own, stretched from its own origin.
func _gather_coilovers(roots: Array[Node3D]) -> void:
	var all := {}
	for r in roots:
		for n in r.find_children("*", "Node3D", true, false):
			all[clean(str(n.name))] = n
	for key: String in all:
		if not key.begins_with("coilovercylinder"):
			continue
		var corner := key.right(2)
		var cylinder: Node3D = all[key]
		for what in ["coiloverpiston", "coilovercoil"]:
			var inner: Node3D = all.get(what + corner)
			if inner != null and not cylinder.is_ancestor_of(inner):
				# (by hand: the car is not in the tree yet when it is built, and reparent needs the global transform)
				var xf := CarModel.relative(inner, car)
				inner.owner = null
				inner.get_parent().remove_child(inner)
				cylinder.add_child(inner)
				inner.transform = CarModel.relative(cylinder, car).affine_inverse() * xf


## A brake caliper (brake_caliper_FL) goes with the upright of its wheel, or with the steering of the wheel when the car has
## no upright: it goes up and down and steers, and does not spin.
func _attach_calipers(roots: Array[Node3D]) -> void:
	var list: Array[Node] = []
	for r in roots:
		list.append_array(r.find_children("*", "Node3D", true, false))
	for n in list:
		var c := clean(str(n.name))
		var wheel: int = CORNERS.get(c.right(2), -1)
		if wheel < 0 or _re("caliper|brake").search(c) == null or _re("disc|disk|rotor").search(c) != null:
			continue
		var node := n as Node3D
		var up: Dictionary = uprights.get(wheel, {})
		var target: Node3D = up["holder"] if not up.is_empty() else car.wheels[wheel].steer_node
		parts.append({"kind": "caliper", "wheel": wheel, "rear": wheel >= 2, "node": node, "parent": node.get_parent(), "rest_transform": node.transform,
			"library": false, "origin": Vector3.ZERO, "holder": target})
		var xf := CarModel.relative(node, car)
		node.owner = null
		node.get_parent().remove_child(node)
		target.add_child(node)
		node.transform = CarModel.relative(target, car).affine_inverse() * xf


func _add_part(node: Node3D, what: Dictionary, has_rack: bool) -> void:
	var origin := CarModel.relative(node, car).origin
	var library := node.has_meta("rig_far") or (not built.is_empty() and (built["group"] as Node).is_ancestor_of(node))
	var e := {"kind": what["kind"], "wheel": what["wheel"], "rear": what["rear"], "origin": origin, "node": node,
		"parent": node.get_parent(), "rest_transform": node.transform, "library": library}
	var holder := Node3D.new()
	holder.name = "rig-" + str(node.name)
	var basis := Basis.IDENTITY
	var exact: Variant = node.get_meta("rig_far") if node.has_meta("rig_far") else null
	var kind: String = e["kind"]
	var centre := origin
	if kind == "trailing":
		e["far"] = exact if exact != null else _far_end(node, origin)
		e["arm_length"] = maxf(0.05, absf(e["far"].z - origin.z))
		e["ahead"] = 1.0 if e["far"].z >= origin.z else -1.0
	elif kind in SPRINGLIKE:
		var tip: Variant = _tip_of(node, origin) if kind == "tierod" and not has_rack and exact == null else null
		e["far"] = exact if exact != null else (tip if tip != null else _far_end(node, origin))
		var d: Vector3 = e["far"] - origin
		e["rest_length"] = maxf(0.01, d.length())
		e["rest_dir"] = d.normalized() if d.length() > 1e-6 else Vector3.DOWN
		basis = _aim(e["rest_dir"])
		if kind == "spring":
			e["inner"] = _inner_parts(node, e["rest_dir"], e["rest_length"])
			e["strut"] = clean(str(node.name)).contains("strut")
	elif kind == "prop":
		var box := _box(node)
		centre = box.get_center()
		if exact != null:
			e["axis"] = ((exact as Vector3) - origin).normalized()
			centre = (origin + (exact as Vector3)) * 0.5
		else:
			var s := box.size
			e["axis"] = Vector3.RIGHT if s.x >= s.y and s.x >= s.z else (Vector3.UP if s.y >= s.z else Vector3.BACK)
	elif kind == "arm":
		var ball: Variant = _tip_of(node, origin) if exact == null else exact     # (the ball joint: the end of the arm farthest from its hinge)
		e["far"] = ball if ball != null else _far_end(node, origin)
		e["arm_length"] = maxf(0.05, absf(e["far"].x - origin.x))
		e["side"] = 1.0 if e["far"].x >= origin.x else -1.0
	holder.transform = Transform3D(basis, centre)
	e["holder"] = holder
	e["rest_basis"] = basis
	e["centre"] = centre
	root.add_child(holder)
	# (the part keeps its place: its transform in the body, now under the holder)
	var body_xf := CarModel.relative(node, car)
	node.owner = null
	node.get_parent().remove_child(node)
	holder.add_child(node)
	node.transform = holder.transform.affine_inverse() * body_xf
	if kind == "rack":
		rack = e
	if kind == "upright":
		uprights[e["wheel"]] = e
	parts.append(e)


## A spring whose far end sits on an arm of its wheel goes round the hinge of the arm with it; on a trailing arm
## likewise; on a live axle it goes with the axle there. A trailing arm whose end is on a live axle stays on it.
func _seat_parts() -> void:
	for p in parts:
		if p["kind"] != "trailing":
			continue
		for a in parts:
			if a["kind"] == "axle" and a["rear"] == (int(p["wheel"]) >= 2) and absf(p["far"].z - a["origin"].z) < 0.15:
				p["on_axle"] = a
	for p in parts:
		if p["kind"] != "spring" or p["strut"]:
			continue
		var best: Variant = null
		var best_trailing: Variant = null
		var axle: Variant = null
		for a in parts:
			if a["kind"] == "axle" and a["rear"] == (int(p["wheel"]) >= 2):
				axle = a
		if axle != null and absf(p["far"].z - axle["origin"].z) < 0.15:
			p["on_axle"] = axle
			continue
		for a in parts:
			if a["wheel"] != p["wheel"]:
				continue
			if a["kind"] == "arm" and _between(p["far"].x, a["origin"].x, a["far"].x) and absf(p["far"].x - a["origin"].x) >= 0.03:
				if best == null or a["origin"].y < best["origin"].y:
					best = a
			elif a["kind"] == "trailing" and _between(p["far"].z, a["origin"].z, a["far"].z) and absf(p["far"].z - a["origin"].z) >= 0.03 \
					and absf(p["far"].z - a["far"].z) >= 0.05:
				if best_trailing == null or a["origin"].y < best_trailing["origin"].y:
					best_trailing = a
		if best != null:
			p["on_arm"] = best
		elif best_trailing != null:
			p["on_trailing"] = best_trailing
		elif axle != null:
			p["on_axle"] = axle


static func _between(v: float, a: float, b: float) -> bool:
	return v >= minf(a, b) - 0.02 and v <= maxf(a, b) + 0.02


## A basis whose Y axis points along dir (setFromUnitVectors(Y, dir)).
static func _aim(dir: Vector3) -> Basis:
	var d := dir.normalized()
	if d.dot(Vector3.UP) < -0.99999:
		return Basis(Vector3.RIGHT, PI)
	return Basis(Quaternion(Vector3.UP, d))


## Puts the parts back where the model had them (a new rig is made: the tuning changed the suspension) and frees the
## holders and the parts of the library.
func dispose() -> void:
	for p in parts:
		var node: Node3D = p["node"]
		if not is_instance_valid(node) or p["library"]:
			continue
		node.get_parent().remove_child(node)
		(p["parent"] as Node).add_child(node)
		node.transform = p["rest_transform"]
	parts.clear()
	if is_instance_valid(root):
		root.queue_free()


# ---- every frame

## The travel of a wheel upwards from where the model has it (m), as the wheel is drawn.
func _travel(i: int) -> float:
	var w: Car.Wheel = car.wheels[i]
	return car.susp_length - w.length + w.offset


## How far up a live axle is at a distance x from its middle: the mean travel of its two wheels, and its roll.
func _axle_travel_at(rear: bool, x: float) -> float:
	var l := _travel(2 if rear else 0)
	var r := _travel(3 if rear else 1)
	var track := (car.rear_track if rear else car.front_track)
	track = track if track > 0.0 else 1.5
	return (l + r) / 2.0 + (l - r) / track * x


## The steer of a wheel (positive to the left, as Car.Wheel.steer).
func _steer(i: int) -> float:
	return car.wheels[i].steer if i < 2 else 0.0


func _swing(travel: float, length: float) -> float:
	return asin(clampf(travel / length, -1.0, 1.0))


func update() -> void:
	var rack_shift := -rack_travel * car.steer_angle         # along +x (to the left) for a steer to the right
	_init_rods()
	var col_angle: Variant = _fit_column() if not (_rods as Array).is_empty() else null
	for p in parts:                  # (the arms first: the springs sit on them)
		if p["kind"] == "arm":
			_update_arm(p, p["holder"])
	for p in parts:
		var h: Node3D = p["holder"]
		match p["kind"]:
			"prop":
				var turn := 0.0
				for w in car.wheels:
					turn += w.spin
				h.basis = Basis(p["axis"], turn / 4.0)
			"upright":
				var o: Vector3 = p["origin"]
				h.position = Vector3(o.x, o.y + _travel(p["wheel"]), o.z)
				if p["wheel"] < 2:
					h.basis = Basis(Vector3.UP, _steer(p["wheel"])) * (p["rest_basis"] as Basis)
			"spring":
				_update_spring(p, h)
			"rack":
				var ro: Vector3 = p["origin"]
				h.position = Vector3(ro.x + rack_shift, ro.y, ro.z)
			"tierod":
				_update_tierod(p, h, rack_shift, col_angle)
			"trailing":
				var tt: float = _axle_travel_at(p["on_axle"]["rear"], p["far"].x) if p.has("on_axle") else _travel(p["wheel"])
				h.basis = Basis(Vector3.RIGHT, -float(p["ahead"]) * _swing(tt, p["arm_length"])) * (p["rest_basis"] as Basis)
			"shaft":
				var hub: Dictionary = uprights.get(p["wheel"], {})
				var target: Vector3 = hub["origin"] if not hub.is_empty() else p["far"]
				_stretch(p, h, target + Vector3.UP * _travel(p["wheel"]))
			"panhard":
				_stretch(p, h, p["far"] + Vector3.UP * _axle_travel_at(p["rear"], p["far"].x))
			"axle":
				_update_axle(p, h)
			"propaxle":
				var rear: bool = p["rear"]
				var lift := (_travel(2 if rear else 0) + _travel(3 if rear else 1)) / 2.0
				var d: Vector3 = p["far"] + Vector3.UP * lift - h.position
				var spin := (car.wheels[2 if rear else 0].spin + car.wheels[3 if rear else 1].spin) / 2.0
				h.basis = _aim(d) * Basis(Vector3.UP, spin) * Basis.from_scale(Vector3(1.0, maxf(0.2, d.length() / float(p["rest_length"])), 1.0))


## A wishbone stays on its upright: it turns about its hinge to where its ball joint has gone with the upright (the travel,
## the steering) and is as much longer or shorter as that takes. Without an upright it swings with the travel.
func _update_arm(p: Dictionary, h: Node3D) -> void:
	var wheel: int = p["wheel"]
	var up: Dictionary = uprights.get(wheel, {})
	if up.is_empty():
		h.basis = Basis(Vector3.BACK, _swing(_travel(wheel), p["arm_length"]) * float(p["side"])) * (p["rest_basis"] as Basis)
		return
	h.basis = _arm_basis(p, _steer(wheel) if wheel < 2 else 0.0)
	p["travel_basis"] = _arm_basis(p, 0.0)         # (what a spring on it sees: the steering does not press the spring)


func _arm_basis(p: Dictionary, steer: float) -> Basis:
	var up: Dictionary = uprights[p["wheel"]]
	var o: Vector3 = p["origin"]
	var far: Vector3 = p["far"]
	var t := far
	if steer != 0.0:
		t = (t - up["origin"]).rotated(Vector3.UP, steer) + up["origin"]
	t.y += _travel(p["wheel"])
	var was := far - o
	var now := t - o
	if was.length() < 1e-4 or now.length() < 1e-4:
		return Basis.IDENTITY
	var u := was.normalized()
	var k := now.length() / was.length() - 1.0
	var stretch := Basis(Vector3(1.0 + k * u.x * u.x, k * u.x * u.y, k * u.x * u.z), Vector3(k * u.y * u.x, 1.0 + k * u.y * u.y, k * u.y * u.z),
		Vector3(k * u.z * u.x, k * u.z * u.y, 1.0 + k * u.z * u.z))
	return Basis(Quaternion(u, now.normalized())) * stretch


## The wheels turn about the pin of their upright, not about their own middle: the hub moves along an arc. Called
## after the car has placed the wheels.
func move_hubs() -> void:
	for i in 2:
		var w: Car.Wheel = car.wheels[i]
		if not uprights.has(i) or w.hub_node == null or not hubs.has(i):
			continue
		var o: Vector3 = uprights[i]["origin"]
		var off := Vector3(hubs[i].x - o.x, 0.0, hubs[i].z - o.z)
		w.hub_node.position += off.rotated(Vector3.UP, _steer(i)) - off


## A part from its origin (on the body) to a point: aimed at it and stretched to it.
func _stretch(p: Dictionary, h: Node3D, target: Vector3) -> void:
	var d := target - h.position
	h.basis = _aim(d) * Basis.from_scale(Vector3(1.0, maxf(0.2, d.length() / float(p["rest_length"])), 1.0))


func _update_spring(p: Dictionary, h: Node3D) -> void:
	var far: Vector3 = p["far"]
	var wheel: int = p["wheel"]
	var t := far
	if p.has("on_arm"):
		var arm: Dictionary = p["on_arm"]
		var arm_basis: Basis = arm["travel_basis"] if arm.has("travel_basis") else (arm["holder"] as Node3D).basis
		t = (arm["origin"] as Vector3) + arm_basis * (far - (arm["origin"] as Vector3))
	elif p.has("on_trailing"):
		var tr: Dictionary = p["on_trailing"]
		var tt: float = _axle_travel_at(tr["on_axle"]["rear"], tr["far"].x) if tr.has("on_axle") else _travel(wheel)
		t = (far - tr["origin"]).rotated(Vector3.RIGHT, -float(tr["ahead"]) * _swing(tt, tr["arm_length"])) + tr["origin"]
	elif p.has("on_axle"):
		t.y += _axle_travel_at(p["on_axle"]["rear"], far.x)
	else:
		t.y += _travel(wheel)
	var d := t - (p["origin"] as Vector3)
	var length := d.length()
	var b := _aim(d)
	# (a strut of a front wheel turns with the steering about its own length: its foot is clamped to the upright)
	if p["strut"] and wheel < 2:
		b = b * Basis(Vector3.UP, car.steer_angle)
	var rest: float = p["rest_length"]
	if (p["inner"] as Array).is_empty():
		h.basis = b * Basis.from_scale(Vector3(1.0, maxf(0.2, length / rest), 1.0))
		return
	h.basis = b
	var delta := length - rest
	for part in p["inner"]:
		var node: Node3D = part["node"]
		var share: float = 1.0 if part["kind"] == "piston" else part["along"]
		node.position = (part["rest"] as Vector3) + (part["in_parent"] as Vector3) * (delta / float(part["k"]) * share)
		if part["kind"] == "coil":
			var sc := Vector3.ONE
			var coil_length := maxf(0.02, float(part["length"]))         # (one end stays at the top, the other goes with the piston)
			sc[int(part["axis"])] = maxf(0.2, (coil_length + delta) / coil_length)
			node.basis = (part["rest_basis"] as Basis) * Basis.from_scale(sc)


func _update_tierod(p: Dictionary, h: Node3D, rack_shift: float, col_angle: Variant) -> void:
	var t: Vector3 = p["far"]
	var wheel: int = p["wheel"]
	var up: Dictionary = uprights.get(wheel, {})
	if not up.is_empty() and wheel < 2:
		t = (t - up["origin"]).rotated(Vector3.UP, _steer(wheel)) + up["origin"]
	t.y += _travel(wheel)
	var o: Vector3 = p["origin"]
	if col_angle != null and p.has("far_now"):
		h.position = (o - column["centre"]).rotated(column["axis"], col_angle) + column["centre"]
	else:
		h.position = Vector3(o.x + (rack_shift if wheel < 2 else 0.0), o.y, o.z)
	_stretch(p, h, t)


func _update_axle(p: Dictionary, h: Node3D) -> void:
	var rear: bool = p["rear"]
	var left := _travel(2 if rear else 0)
	var right := _travel(3 if rear else 1)
	var track := car.rear_track if rear else car.front_track
	track = track if track > 0.0 else 1.5
	var o: Vector3 = p["origin"]
	h.position = Vector3(o.x, o.y + (left + right) / 2.0 + (left - right) / track * o.x, o.z)
	h.basis = Basis(Vector3.BACK, atan2(left - right, track)) * (p["rest_basis"] as Basis)


# ---- fixed tie rods on a steering column (a kart): the column turns to where the rods keep their length

func _init_rods() -> void:
	if _rods != null:
		return
	_rods = []
	if not rack.is_empty() or column.is_empty():
		return
	for p in parts:
		if p["kind"] == "tierod" and p["wheel"] < 2 and uprights.has(p["wheel"]):
			p["far_now"] = Vector3.ZERO
			(_rods as Array).append(p)


func _far_point(p: Dictionary, steer: float) -> Vector3:
	var up: Dictionary = uprights[p["wheel"]]
	var out: Vector3 = ((p["far"] as Vector3) - up["origin"]).rotated(Vector3.UP, steer) + up["origin"]
	out.y += _travel(p["wheel"])
	return out


## The angle of the steering column at which the rods fit the wheels best (radians).
func _fit_column(steers: Variant = null) -> float:
	var s0: float = _steer(0) if steers == null else steers[0]
	var s1: float = _steer(1) if steers == null else steers[1]
	var key := "%f,%f" % [s0, s1]
	if key == _column_key:
		return column_angle
	_column_key = key
	for p in _rods:
		p["far_now"] = _far_point(p, s0 if p["wheel"] == 0 else s1)
	var step := 0.004
	var lo := -2.0
	var errors := PackedFloat32Array()
	var best := 0
	var best_error := INF
	var c: Vector3 = column["centre"]
	var a := lo
	while a <= 2.0:
		var error := 0.0
		for p in _rods:
			var pin: Vector3 = ((p["origin"] as Vector3) - c).rotated(column["axis"], a) + c
			var d: float = pin.distance_to(p["far_now"]) - float(p["rest_length"])
			error += d * d
		errors.append(error)
		if error < best_error:
			best_error = error
			best = errors.size() - 1
		a += step
	var angle := lo + best * step
	if best > 0 and best < errors.size() - 1:
		var den := errors[best - 1] - 2.0 * errors[best] + errors[best + 1]
		if den > 0.0:
			angle += step * 0.5 * (errors[best - 1] - errors[best + 1]) / den
	column_angle = angle
	column_error = sqrt(best_error / maxf(1.0, (_rods as Array).size()))
	return angle


## The angle of the steering column at the lock of the front wheels, or -1 without fixed tie rods.
func lock_angle(max_turn: float) -> float:
	_init_rods()
	if (_rods as Array).is_empty():
		return -1.0
	var saved := [_column_key, column_angle, column_error]
	_column_key = ""
	var angle := absf(_fit_column([max_turn, max_turn]))
	_column_key = saved[0]
	column_angle = saved[1]
	column_error = saved[2]
	return angle
