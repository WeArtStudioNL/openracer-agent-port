class_name SuspensionRig
extends RefCounted
## The moving parts of the suspension and the steering of a car (web/js/SuspensionRig.js): wishbones that swing with the
## travel of the wheel, uprights that go up and down with the wheel and turn with the steering, springs, dampers and
## struts that get shorter and longer (a coilover's piston slides and its coil is squeezed), a steering rack that slides
## and tie rods that follow it, a live axle that goes up and down and rolls, trailing arms, a Panhard rod, driveshafts and
## propshafts that turn. A part is used when a part of the model (or of the parts library, PartsLibrary.assemble, car.json
## "suspension" and "driveline") has its name: susp_lowerarm_FL, susp_upperarm_FL, susp_upright_FL, susp_spring_FL,
## susp_strut_FL, susp_damper_FL, steer_rack, steer_tierod_FL, susp_toelink_RL (a rigid rod from the frame to the upright, that
## keeps a wheel without steering straight: the tie rod of the rear; ball_toelink_RL is its point on the upright), susp_axle_rear, susp_trailingarm_RL, susp_panhard_rear,
## susp_driveshaft_FL, propshaft_rear, susp_propshaft_rear ... (case and other characters do not matter, the corner at the
## end). The physics is not changed by it; the parts follow the travel of every wheel and its steering.
##
## Every part is put in a holder (a Node3D in the frame of the body, under the node "SuspensionRig" of the car) that is
## moved every frame (update). The rest pose of the model is the car at rest on its springs (w.length = susp_length).

const MAX_TOE := 0.6               # rad: the most that a rod turns a wheel away from the angle of the physics
const CORNERS := {"fl": 0, "fr": 1, "rl": 2, "rr": 3}    # the index of the wheel in Car.wheels (FL, FR, RL, RR)
const SPRINGLIKE := ["spring", "tierod", "panhard", "shaft", "propaxle"]

static var _regex := {}

var car: Car
var root: Node3D                  # "SuspensionRig": the holders and the parts of the library that the rig did not take
var parts: Array[Dictionary] = []
var uprights := {}                # wheel -> the entry of its upright
const ARC_LOW := -0.6              # m of travel: the table of the way in or out of the hub (fill_arcs)
const ARC_STEP := 0.02
var corners := {}                 # wheel -> {lower, upper, up, a, moved, camber}: wishbones and upright, solved as rigid parts
var rack: Dictionary = {}
var rack_travel := 0.1            # m per radian of the front wheels (car.json steering.rack_travel)
var hubs := {}                    # wheel -> the middle of the wheel (the upright turns it about its pin)
var column: Dictionary = {}       # { centre, axis }: a steering column whose arm holds fixed tie rods (set by a steering wheel)
var column_angle := 0.0
var column_error := 0.0
var built: Dictionary = {}        # what PartsLibrary.assemble made (or {})
var travel_shown := [0.0, 0.0, 0.0, 0.0]     # the travel of each wheel at the last update (CarCollision: physics runs between two frames)
var _axle_turn := [0.0, 0.0]       # rad that the wheels of the front and of the rear axle have turned, not wrapped (Wheel.spin is)
var _spin_was := [0.0, 0.0, 0.0, 0.0]
var _rack_now := 0.0              # m that the rack is across the car from where the model has it
var _balls := {}                  # clean name of a ball joint empty -> its place in the frame of the car
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
		rig.built = PartsLibrary.assemble(c.config, centres, diameter, model_names, PartsLibrary.own_diffs(body, c, centres))
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


## The clean name of a part up to and with its corner: what comes after the corner is not part of the name (brake_caliper_FL_001,
## susp_lowerarm_FL.002 and wheel_rim_FL_bolts are brakecaliperfl, susplowerarmfl and wheelrimfl).
static func stem(n: String) -> String:
	var m := _re("(?i)^(.*?[-_. ](?:fl|fr|rl|rr))(?:[-_. 0-9].*)?$").search(n)
	if m != null:
		return clean(m.get_string(1))
	var c := clean(n)
	var digits := _re("^(.*(?:fl|fr|rl|rr))[0-9]+$").search(c)
	return digits.get_string(1) if digits != null else c


## What a part is, from its name: { kind, wheel, rear } or {} (SuspensionRig.js classify).
static func classify(node_name: String) -> Dictionary:
	var n := stem(node_name)
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
	var kinds := [["trailing", ["trailing"]], ["tierod", ["toelink"]], ["shaft", ["driveshaft", "halfshaft", "shaft"]], ["arm", ["arm", "wishbone", "link"]],
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
		if mi.mesh == null or not mi.visible:
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
		if n.begins_with("collision"):
			continue
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
	_find_balls(roots)
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
	var main := {}                                         # (more objects of one part, susp_lowerarm_FL and susp_lowerarm_FL.001: the shortest name is the part, the others are bolted to it)
	for p in top:
		var key := "%s/%s" % [p["what"]["kind"], stem(str(p["node"].name))]
		if not main.has(key) or str(p["node"].name).length() < str(main[key]["node"].name).length():
			main[key] = p
	var extra: Array[Dictionary] = []
	for p in top:
		var key := "%s/%s" % [p["what"]["kind"], stem(str(p["node"].name))]
		if p["what"]["wheel"] >= 0 and main[key] != p:
			extra.append({"node": p["node"], "main": main[key]["node"], "wheel": p["what"]["wheel"]})
		else:
			_add_part(p["node"], p["what"], has_rack)
	for x in extra:
		for e in parts:
			if e["node"] == x["main"]:
				_bolt(x["node"], x["wheel"], e["holder"])
	_seat_parts()
	_find_corners()
	_attach_calipers(roots)
	_seat_props(roots)


## The ball joints that a model marks with empties: ball_lowerarm_FL, ball_upperarm_FL, ball_tierod_FL (the point on the upright
## about which the arm or the rod turns; without one the end of the part that is farthest from its origin is taken).
func _find_balls(roots: Array[Node3D]) -> void:
	_balls = {}
	for r in roots:
		for n in r.find_children("*", "Node3D", true, false):
			var c := stem(str(n.name))
			if c.begins_with("ball") and CORNERS.has(c.right(2)) and (not _balls.has(c) or clean(str(n.name)) == c):      # (the one without anything after its corner wins)
				_balls[c] = CarModel.relative(n as Node3D, car).origin


## The empty of the ball joint of an arm or a tie rod, or null.
func _ball_of(node: Node3D, kind: String) -> Variant:
	var n := stem(str(node.name))
	var part := ("toelink" if n.contains("toelink") else "tierod") if kind == "tierod" else ("upperarm" if n.contains("upper") else "lowerarm")
	return _balls.get("ball" + part + n.right(2))


## The wheels whose upright hangs on wishbones: their lowest arm and, with two, their highest.
func _find_corners() -> void:
	corners = {}
	for w: int in uprights:
		var arms: Array = parts.filter(func(p: Dictionary) -> bool: return p["kind"] == "arm" and p["wheel"] == w)
		if arms.is_empty():
			continue
		arms.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a["origin"].y < b["origin"].y)
		corners[w] = {"lower": arms[0], "upper": arms[arms.size() - 1] if arms.size() > 1 else null, "up": uprights[w], "a": 0.0}


## The piston and the coil of a coilover are parts of its cylinder, also when the model has them loose beside it (Blender
## without parents): else each would be a spring of its own, stretched from its own origin.
func _gather_coilovers(roots: Array[Node3D]) -> void:
	var all := {}
	for r in roots:
		for n in r.find_children("*", "Node3D", true, false):
			var k := stem(str(n.name))
			if not all.has(k) or clean(str(n.name)) == k:
				all[k] = n
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


## The longest axis of the meshes of a part and the middle of that mesh, in the frame of the body, or {}.
func _long_axis(node: Node3D) -> Dictionary:
	var list: Array[Node] = node.find_children("*", "MeshInstance3D", true, false)
	if node is MeshInstance3D:
		list.append(node)
	var best := 0.0
	var out := {}
	for m in list:
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.visible:
			continue
		var box := mi.mesh.get_aabb()
		var xf := CarModel.relative(mi, car)
		for i in 3:
			var length := xf.basis[i].length() * box.size[i]
			if length > best:
				best = length
				out = {"axis": xf.basis[i].normalized(), "centre": xf * box.get_center()}
	return out


## Which axle a propshaft turns with: the driven one; with four driven wheels the one on its side of the transaxle (or the gearbox).
func _seat_props(roots: Array[Node3D]) -> void:
	var transfer := INF
	var gearbox := INF
	for r in roots:
		for n in r.find_children("*", "Node3D", true, false):
			var c := clean(str(n.name))
			if c.begins_with("transaxle"):
				transfer = CarModel.relative(n as Node3D, car).origin.z
			elif c.begins_with("gearbox"):
				gearbox = CarModel.relative(n as Node3D, car).origin.z
	var at := transfer if transfer != INF else gearbox
	if at == INF:
		at = (car.wheels[0].hub.z + car.wheels[2].hub.z) / 2.0
	for p in parts:
		if p["kind"] == "prop":
			p["on_rear"] = car.drive == "rwd" or (car.drive != "fwd" and (p["centre"] as Vector3).z < at)


## A brake caliper (brake_caliper_FL) and a ball joint (ball_lowerarm_FL, ball_upperarm_FL, ball_tierod_FL: a mesh, or an empty that
## only marks the point) go with the upright of its wheel; ball_tierod_mount_FL, at the inner end of the tie rod, goes along the rack
## with that end, or with the steering of the wheel when the car has
## no upright: it goes up and down and steers, and does not spin.
func _attach_calipers(roots: Array[Node3D]) -> void:
	var list: Array[Node] = []
	for r in roots:
		list.append_array(r.find_children("*", "Node3D", true, false))
	for n in list:
		var c := stem(str(n.name))
		if c.begins_with("collision"):
			continue
		var wheel: int = CORNERS.get(c.right(2), -1)
		var joint := _re("^ball(lowerarm|upperarm|tierod|toelink(?!mount))").search(c) != null        # (a ball joint is bolted to the upright: it goes with it, not with its arm)
		var mount := c.begins_with("balltierodmount")                                 # (but this one is on the rack, at the inner end of the rod)
		if wheel < 0 or not (joint or (_re("caliper|brake").search(c) != null and _re("disc|disk|rotor").search(c) == null)):
			continue
		var node := n as Node3D
		var up: Dictionary = uprights.get(wheel, {})
		var target: Node3D = up["holder"] if not up.is_empty() else car.wheels[wheel].steer_node
		if mount:
			target = Node3D.new()
			target.name = "rig-" + str(node.name)
			root.add_child(target)
		_bolt(node, wheel, target, "mount" if mount else "caliper")


## A part goes with a holder, and keeps its place.
func _bolt(node: Node3D, wheel: int, target: Node3D, kind := "caliper") -> void:
	parts.append({"kind": kind, "wheel": wheel, "rear": wheel >= 2, "node": node, "parent": node.get_parent(), "rest_transform": node.transform,
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
		var marked: Variant = _ball_of(node, kind) if kind == "tierod" and exact == null else null
		var tip: Variant = _tip_of(node, origin) if kind == "tierod" and not has_rack and exact == null and marked == null else null
		e["far"] = exact if exact != null else (marked if marked != null else (tip if tip != null else _far_end(node, origin)))
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
			var long := _long_axis(node)
			if long.is_empty():
				var s := box.size
				e["axis"] = Vector3.RIGHT if s.x >= s.y and s.x >= s.z else (Vector3.UP if s.y >= s.z else Vector3.BACK)
			else:                          # (along its own length: a shaft that lies at an angle must not swing round the axis of the car)
				e["axis"] = long["axis"]
				centre = long["centre"]
	elif kind == "arm":
		var ball: Variant = exact if exact != null else _ball_of(node, "arm")      # (the ball joint: its empty, or the end of the arm farthest from its hinge)
		if ball == null:
			ball = _tip_of(node, origin)
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
				if best == null or _gap_to_arm(p["far"], a) < _gap_to_arm(p["far"], best):      # (the arm that its foot is on, the upper or the lower one)
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


## How far a point is from the line of an arm (hinge to ball), across the car.
static func _gap_to_arm(point: Vector3, arm: Dictionary) -> float:
	var a := _xy(arm["origin"])
	var b := _xy(arm["far"])
	var q := _xy(point)
	var along := b - a
	var share := clampf((q - a).dot(along) / maxf(1e-9, along.length_squared()), 0.0, 1.0)
	return q.distance_to(a + along * share)


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


## The way in or out of the middle of each wheel with the travel, for the physics (Car.Wheel.set_arc): the same arms as the picture.
func fill_arcs() -> void:
	for w: int in corners:
		var wheel: Car.Wheel = car.wheels[w]
		var c: Dictionary = corners[w]
		var rest := Vector3(wheel.hub.x, wheel.visual_offset.y, wheel.hub.z)
		var bl0: Vector3 = c["lower"]["far"]
		var a := 0.0
		var last := 0.0
		var table := PackedFloat32Array()
		var count := int(round(-2.0 * ARC_LOW / ARC_STEP)) + 1
		for k in count:
			var want: float = (c["up"]["origin"] as Vector3).y + ARC_LOW + k * ARC_STEP
			for _i in 12:
				var s := _corner_at(c, a)
				var s2 := _corner_at(c, a + 1e-3)
				if s.is_empty() or s2.is_empty():
					break
				var slope: float = (s2["hub"].y - s["hub"].y) / 1e-3
				if absf(slope) < 1e-4 or absf(s["hub"].y - want) < 1e-5:
					break
				a = clampf(a - (s["hub"].y - want) / slope, -1.3, 1.3)
			var got := _corner_at(c, a)
			if not got.is_empty():
				var turn := Basis(Vector3.BACK, got["camber"])
				var moved := Transform3D(turn, Vector3(got["bl"].x, got["bl"].y, bl0.z) - turn * bl0)
				last = (moved * rest).x - rest.x
			table.append(last)
		var mid: float = table[int(round(-ARC_LOW / ARC_STEP))]
		for k in count:
			table[k] -= mid
		wheel.arc = table


func _solved(wheel: int) -> bool:
	return corners.has(wheel) and corners[wheel].has("moved")


func _swing(travel: float, length: float) -> float:
	return asin(clampf(travel / length, -1.0, 1.0))


func update() -> void:
	for i in 4:
		travel_shown[i] = _travel(i)
	for i in 4:
		var w: Car.Wheel = car.wheels[i]
		_axle_turn[0 if i < 2 else 1] += wrapf(w.spin - float(_spin_was[i]), -PI, PI) / 2.0
		_spin_was[i] = w.spin
	var rack_shift := -rack_travel * car.steer_angle         # along +x (to the left) for a steer to the right
	_init_rods()
	var col_angle: Variant = _fit_column() if not (_rods as Array).is_empty() else null
	_solve_corners()                 # (the arms and the uprights first: the springs and the rods sit on them)
	_rack_now = _rack_shift(rack_shift)
	_solve_toe()
	for p in parts:
		if p["kind"] == "arm" and not corners.has(p["wheel"]):
			(p["holder"] as Node3D).basis = Basis(Vector3.BACK, _swing(_travel(p["wheel"]), p["arm_length"]) * float(p["side"])) * (p["rest_basis"] as Basis)
	for p in parts:
		var h: Node3D = p["holder"]
		match p["kind"]:
			"prop":
				h.basis = Basis(p["axis"], fmod(float(_axle_turn[1 if p["on_rear"] else 0]) * car.final_drive, TAU))
			"upright":
				var o: Vector3 = p["origin"]
				if corners.has(p["wheel"]) and corners[p["wheel"]].has("moved"):
					h.transform = _upright_pose(corners[p["wheel"]], _steer_now(p["wheel"])) * Transform3D(p["rest_basis"], o)
				else:
					h.position = Vector3(o.x, o.y + _travel(p["wheel"]), o.z)
					if p["wheel"] < 2:
						h.basis = Basis(Vector3.UP, _steer(p["wheel"])) * (p["rest_basis"] as Basis)
			"spring":
				_update_spring(p, h)
			"rack":
				var ro: Vector3 = p["origin"]
				h.position = Vector3(ro.x + _rack_now, ro.y, ro.z)
			"tierod":
				_update_tierod(p, h, col_angle)
			"trailing":
				var tt: float = _axle_travel_at(p["on_axle"]["rear"], p["far"].x) if p.has("on_axle") else _travel(p["wheel"])
				h.basis = Basis(Vector3.RIGHT, -float(p["ahead"]) * _swing(tt, p["arm_length"])) * (p["rest_basis"] as Basis)
			"shaft":
				_update_shaft(p, h)
			"panhard":
				_stretch(p, h, p["far"] + Vector3.UP * _axle_travel_at(p["rear"], p["far"].x))
			"axle":
				_update_axle(p, h)
			"propaxle":
				var rear: bool = p["rear"]
				var lift := (_travel(2 if rear else 0) + _travel(3 if rear else 1)) / 2.0
				var d: Vector3 = p["far"] + Vector3.UP * lift - h.position
				var spin := fmod(float(_axle_turn[1 if rear else 0]) * car.final_drive, TAU)
				h.basis = _aim(d) * Basis(Vector3.UP, spin) * Basis.from_scale(Vector3(1.0, maxf(0.2, d.length() / float(p["rest_length"])), 1.0))
	for p in parts:
		if p["kind"] == "mount":
			(p["holder"] as Node3D).position.x = _rack_now if p["wheel"] < 2 else 0.0


## The wishbones and the upright of a wheel as the rigid parts they are. The arms turn about their hinges (along the car),
## the balls at their ends are on the upright, so the upright is where the two arcs let it be: the lower arm is turned until
## the middle of the wheel is at the height of the travel, the upper ball follows at its distance from the lower one. That
## gives the wheel its way in or out and its camber. With only a lower arm (a strut) the upright keeps its lean.
func _solve_corners() -> void:
	for w: int in corners:
		var c: Dictionary = corners[w]
		var want: float = (c["up"]["origin"] as Vector3).y + _travel(w)
		var a: float = c["a"]
		for _i in 8:
			var s := _corner_at(c, a)
			if s.is_empty():
				break
			var e: float = s["hub"].y - want
			if absf(e) < 1e-5:
				break
			var s2 := _corner_at(c, a + 1e-3)
			if s2.is_empty():
				break
			var slope: float = (s2["hub"].y - s["hub"].y) / 1e-3
			if absf(slope) < 1e-4:
				break
			a = clampf(a - e / slope, -1.3, 1.3)
		var got := _corner_at(c, a)
		if got.is_empty():
			continue
		c["a"] = a
		(c["lower"]["holder"] as Node3D).basis = Basis(Vector3.BACK, a)
		if c["upper"] != null:
			(c["upper"]["holder"] as Node3D).basis = Basis(Vector3.BACK, got["upper_angle"])
		var bl0: Vector3 = c["lower"]["far"]
		var turn := Basis(Vector3.BACK, got["camber"])
		var bl := Vector3(got["bl"].x, got["bl"].y, bl0.z)
		c["camber"] = got["camber"]
		c["moved"] = Transform3D(turn, bl - turn * bl0)
		c["bl"] = bl
		if c["upper"] != null:
			var bu0: Vector3 = c["upper"]["far"]
			c["pin"] = Vector3(got["bu"].x - bl.x, got["bu"].y - bl.y, bu0.z - bl0.z).normalized()
		else:
			c["pin"] = turn * Vector3.UP
		if c["pin"].y < 0.0:
			c["pin"] = -c["pin"]


## Where the balls are with the lower arm turned by a: {bl, bu, camber, upper_angle, hub} in the plane across the car; {}
## when the upper arm cannot reach.
func _corner_at(c: Dictionary, a: float) -> Dictionary:
	var ol := _xy(c["lower"]["origin"])
	var b0 := _xy(c["lower"]["far"])
	var bl := ol + (b0 - ol).rotated(a)
	var camber := 0.0
	var upper_angle := 0.0
	var bu := bl
	if c["upper"] != null:
		var ou := _xy(c["upper"]["origin"])
		var bu0 := _xy(c["upper"]["far"])
		var hit: Variant = _circles(ou, (bu0 - ou).length(), bl, (bu0 - b0).length(), bl + (bu0 - b0))      # (the point where the upright stays upright, also far from where the model has it)
		if hit == null:
			return {}
		bu = hit
		camber = (bu0 - b0).angle_to(bu - bl)
		upper_angle = (bu0 - ou).angle_to(bu - ou)
	var hub := bl + (_xy(c["up"]["origin"]) - b0).rotated(camber)
	return {"bl": bl, "bu": bu, "camber": camber, "upper_angle": upper_angle, "hub": hub}


static func _xy(v: Vector3) -> Vector2:
	return Vector2(v.x, v.y)


## The point where two circles meet that is nearest to near, or null.
static func _circles(p1: Vector2, r1: float, p2: Vector2, r2: float, near: Vector2) -> Variant:
	var d := p1.distance_to(p2)
	if d < 1e-6 or d > r1 + r2 or d < absf(r1 - r2):
		return null
	var along := (r1 * r1 - r2 * r2 + d * d) / (2.0 * d)
	var h := sqrt(maxf(0.0, r1 * r1 - along * along))
	var u := (p2 - p1) / d
	var m := p1 + u * along
	var s := Vector2(-u.y, u.x) * h
	return m + s if (m + s).distance_squared_to(near) <= (m - s).distance_squared_to(near) else m - s


## Where the rack has to be for the steering of the physics, with the car at rest on its springs: the mean of what its two rods
## want, so that the travel of one wheel does not move it. Without two rods on solved wheels: as far as the steering says.
func _rack_shift(by_steering: float) -> float:
	var sum := 0.0
	var count := 0
	for p in parts:
		if p["kind"] != "tierod" or p["wheel"] >= 2 or not _solved(p["wheel"]) or p.has("far_now"):
			continue
		var c: Dictionary = corners[p["wheel"]]
		var at: Vector3 = c["lower"]["far"]
		var pin: Vector3 = ((c["upper"]["far"] as Vector3) - at).normalized() if c["upper"] != null else Vector3.UP
		pin = -pin if pin.y < 0.0 else pin
		var far: Vector3 = p["far"]
		var outer := at + Basis(pin, _steer(p["wheel"])) * (far - at)
		var o: Vector3 = p["origin"]
		var rod := float(p["rest_length"])
		var across := rod * rod - (outer.y - o.y) * (outer.y - o.y) - (outer.z - o.z) * (outer.z - o.z)
		if across <= 0.0:
			return by_steering
		sum += outer.x - (1.0 if far.x >= o.x else -1.0) * sqrt(across) - o.x
		count += 1
	return sum / count if count == 2 else by_steering


## A tie rod is rigid and its inner end is on the rack, so the rod decides how the upright stands: it is turned from the angle of
## the physics until the rod fits. A rod that does not follow the arc of the wishbones steers the wheel with the travel (bump steer).
func _solve_toe() -> void:
	for p in parts:
		if p["kind"] != "tierod" or not _solved(p["wheel"]) or p.has("far_now"):
			continue
		var wheel: int = p["wheel"]
		var c: Dictionary = corners[wheel]
		var o: Vector3 = p["origin"]
		var inner := Vector3(o.x + (_rack_now if wheel < 2 and not rack.is_empty() else 0.0), o.y, o.z)
		var rod := float(p["rest_length"])
		var base := _steer(wheel)
		var turn: float = c.get("steer", base)
		for _i in 8:
			var e := (_upright_pose(c, turn) * (p["far"] as Vector3)).distance_to(inner) - rod
			if absf(e) < 1e-5:
				break
			var slope := ((_upright_pose(c, turn + 1e-3) * (p["far"] as Vector3)).distance_to(inner) - rod - e) / 1e-3
			if absf(slope) < 1e-4:
				break
			turn = clampf(turn - e / slope, base - MAX_TOE, base + MAX_TOE)
		c["steer"] = turn


func _steer_now(wheel: int) -> float:
	return float(corners[wheel].get("steer", _steer(wheel))) if corners.has(wheel) else _steer(wheel)


## How the upright has moved from where the model has it (the frame of the body), with a steering angle: the steering
## turns it about the line through its ball joints.
func _upright_pose(c: Dictionary, steer: float) -> Transform3D:
	var m: Transform3D = c["moved"]
	if absf(steer) < 1e-6:
		return m
	var at: Vector3 = c["bl"]
	return Transform3D(Basis.IDENTITY, at) * Transform3D(Basis(c["pin"], steer), Vector3.ZERO) * Transform3D(Basis.IDENTITY, -at) * m


## Where a point that is fixed on the upright of a solved wheel is now.
func _on_upright(wheel: int, point: Vector3, steer: float) -> Vector3:
	return _upright_pose(corners[wheel], steer) * point


## The wheels turn about the pin of their upright, not about their own middle: the hub moves along an arc. Called
## after the car has placed the wheels.
func move_hubs() -> void:
	for i in 4:
		var w: Car.Wheel = car.wheels[i]
		if w.hub_node == null or not _solved(i):
			continue
		var rest := w.hub + w.visual_offset
		var at := _upright_pose(corners[i], _steer_now(i)) * rest
		w.hub_node.position += at - (rest + Vector3.UP * _travel(i))
		w.hub_node.rotation.z = float(corners[i]["camber"]) - w.camber_bend
		w.steer_node.rotation.y = _steer_now(i)
	for i in 2:
		var w: Car.Wheel = car.wheels[i]
		if not uprights.has(i) or w.hub_node == null or not hubs.has(i) or _solved(i):
			continue
		var o: Vector3 = uprights[i]["origin"]
		var off := Vector3(hubs[i].x - o.x, 0.0, hubs[i].z - o.z)
		w.hub_node.position += off.rotated(Vector3.UP, _steer(i)) - off


## A part from its origin (on the body) to a point: aimed at it and stretched to it.
func _stretch(p: Dictionary, h: Node3D, target: Vector3, turn := 0.0) -> void:
	var d := target - h.position
	h.basis = _aim(d) * Basis(Vector3.UP, turn) * Basis.from_scale(Vector3(1.0, maxf(0.2, d.length() / float(p["rest_length"])), 1.0))


## A driveshaft: from the differential to its own end on the upright, and it turns with its wheel (the two sides look opposite ways).
func _update_shaft(p: Dictionary, h: Node3D) -> void:
	var wheel: int = p["wheel"]
	var far: Vector3 = p["far"]
	var o: Vector3 = p["origin"]
	var t := far
	if _solved(wheel):
		t = _on_upright(wheel, far, _steer_now(wheel))
	else:
		var up: Dictionary = uprights.get(wheel, {})
		if not up.is_empty() and wheel < 2:
			t = (far - up["origin"]).rotated(Vector3.UP, _steer(wheel)) + up["origin"]
		t.y += _travel(wheel)
	_stretch(p, h, t, car.wheels[wheel].spin * (1.0 if far.x >= o.x else -1.0))


func _update_spring(p: Dictionary, h: Node3D) -> void:
	var far: Vector3 = p["far"]
	var wheel: int = p["wheel"]
	var t := far
	if p.has("on_arm"):
		var arm: Dictionary = p["on_arm"]
		t = (arm["origin"] as Vector3) + (arm["holder"] as Node3D).basis * (far - (arm["origin"] as Vector3))
	elif p.has("on_trailing"):
		var tr: Dictionary = p["on_trailing"]
		var tt: float = _axle_travel_at(tr["on_axle"]["rear"], tr["far"].x) if tr.has("on_axle") else _travel(wheel)
		t = (far - tr["origin"]).rotated(Vector3.RIGHT, -float(tr["ahead"]) * _swing(tt, tr["arm_length"])) + tr["origin"]
	elif p.has("on_axle"):
		t.y += _axle_travel_at(p["on_axle"]["rear"], far.x)
	elif _solved(wheel):
		t = _on_upright(wheel, far, 0.0)
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


func _update_tierod(p: Dictionary, h: Node3D, col_angle: Variant) -> void:
	var t: Vector3 = p["far"]
	var wheel: int = p["wheel"]
	var up: Dictionary = uprights.get(wheel, {})
	if _solved(wheel):
		t = _on_upright(wheel, t, _steer_now(wheel))
	else:
		if not up.is_empty() and wheel < 2:
			t = (t - up["origin"]).rotated(Vector3.UP, _steer(wheel)) + up["origin"]
		t.y += _travel(wheel)
	var o: Vector3 = p["origin"]
	if col_angle != null and p.has("far_now"):
		h.position = (o - column["centre"]).rotated(column["axis"], col_angle) + column["centre"]
		_stretch(p, h, t)
		return
	# a rigid rod from the rack (or the body, at the rear) to the upright: _solve_toe has turned the upright so that it fits
	var inner := Vector3(o.x + (_rack_now if wheel < 2 and not rack.is_empty() else 0.0), o.y, o.z)
	h.position = inner
	if _solved(wheel):
		h.basis = _aim(t - inner)
	else:
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
	if _solved(p["wheel"]):
		return _on_upright(p["wheel"], p["far"], steer)
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
