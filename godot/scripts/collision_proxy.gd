class_name CollisionProxy
extends RefCounted
## Where the nodes of the shell of a car are (web/js/CollisionProxy.js): the list that the maker of the car set in
## the car editor (car.json "softbody.layout"), or, without it, a cloud of spheres made from the model: the car is
## cut into columns seen from above, and every column gets a sphere at its lowest point, one at its highest and, at
## the edge of the car, one in the middle.
##
## The spheres are given in the frame of the body in Godot: [{x, y, z, r, part}]. The layout of car.json is in the
## frame of the browser game, from the centre of gravity; it is moved by the centre of mass of the body here.
##
## A model can bring its own shell: an object called "beams" (also softbody_beams, shell_beams) made of vertices and
## edges (glTF lines; Blender: Data > Mesh > Loose Edges in the export). Every vertex is a node and every edge a beam
## (the car gets the edges as meta "model_beams"); it goes before a layout of car.json. The suspension of every wheel
## comes last (a hub, a knuckle and the pivots of the arms, "rig": true, see WheelRig), unless "wheel_hubs" is false.

const MAX_SPHERES := 90
const MAX_BEAM_NODES := 200


## The spheres of the shell of a car, or [] when there are too few. The car has its model (model_root) and its
## wheels.
static func spheres_of(car: Car) -> Array:
	var cfg: Dictionary = car.config.get("softbody", {})
	var ch: Dictionary = car.config.get("chassis", {})
	var com := car.center_of_mass
	var r_front := car.wheels[0].radius
	var mean_r := (car.wheels[0].radius + car.wheels[2].radius) / 2.0
	# the underside of the car: car.json chassis.ground_clearance, or the lowest corner of the boxes of the meshes
	var floor_y := -mean_r + 0.12
	if ch.has("ground_clearance"):
		floor_y = clampf(float(ch["ground_clearance"]), 0.02, 0.6) - mean_r
	elif car.model_root != null:
		var box := CarModel.bounds(car.model_root, car)
		if box.size != Vector3.ZERO:
			floor_y = clampf(box.position.y + mean_r, 0.02, 0.6) - mean_r
	car.set_meta("floor_y", floor_y)
	car.remove_meta("model_beams")
	var out := _body_spheres(car, cfg, floor_y, com, r_front)
	if out.size() >= 3 and cfg.get("wheel_hubs", true) != false:
		out.append_array(_rig_spheres(car))
	return out


static func _body_spheres(car: Car, cfg: Dictionary, floor_y: float, com: Vector3, r_front: float) -> Array:
	var layout: Array = cfg.get("layout", [])
	var out: Array = []
	var found := beams_from_model(car) if car.model_root != null else {}
	var model_beams := not found.is_empty()
	if model_beams:
		# (the nodes keep the numbers of the vertices: the beams point at them; the frame is the body's already)
		var edges: Array = found["edges"]
		var pts: PackedVector3Array = found["points"]
		var mean := 0.0
		for e in edges:
			mean += pts[e[0]].distance_to(pts[e[1]])
		mean /= edges.size()
		var nr := float(cfg["beam_node_radius"]) if float(cfg.get("beam_node_radius", 0)) > 0.0 else clampf(0.35 * mean, 0.05, 0.28)
		layout = []
		for i in mini(MAX_BEAM_NODES, pts.size()):
			layout.append({"x": pts[i].x - com.x, "y": pts[i].y - com.y, "z": pts[i].z - com.z, "r": nr})
		car.set_meta("model_beams", edges.filter(func(e: Array) -> bool: return e[0] < MAX_BEAM_NODES and e[1] < MAX_BEAM_NODES))
	if layout.size() >= 3:
		# drawn at one centre of gravity and radius of the tyres, used with another: the nodes stay where they were on
		# the model (the browser game shifts them the same way)
		var shift := 0.0
		if cfg.has("layout_cg") and not model_beams:
			shift += float(cfg["layout_cg"]) - car.cg_height
		if cfg.has("layout_radius") and not model_beams:
			shift += r_front - float(cfg["layout_radius"])
		for n in layout.slice(0, 2000):
			if not (n is Dictionary) or not n.has("x") or not n.has("y") or not n.has("z") or float(n.get("r", 0)) <= 0.0:
				continue
			var r := clampf(float(n["r"]), 0.05, 0.6)
			var y := float(n["y"]) + shift + com.y
			# a node must not reach below the underside of the car (it would stand on the road with the wheels)
			if y - r < floor_y:
				if y < floor_y + 0.02:
					y = floor_y + 0.02
				r = maxf(0.02, minf(r, y - floor_y))
			out.append({"x": float(n["x"]) + com.x, "y": y, "z": float(n["z"]) + com.z, "r": r,
				"part": str(n["part"]) if n.get("part") is String else ""})
		if out.size() >= 3:
			return out
		car.remove_meta("model_beams")
	if car.model_root == null:
		return []
	var limit := clampi(int(cfg.get("max_nodes", MAX_SPHERES)), 8, 120)
	var points := _surface_points(car)
	if points.size() < 10:
		return []
	var cell := 0.5
	while cell <= 3.0:
		out = _columns(points, cell)
		if out.size() + 4 <= limit or (not cfg.has("max_nodes") and cell >= 1.2):
			break
		cell += 0.1
	return out if out.size() >= 8 else []


## Points on the surface of the model in the frame of the body: the vertices, and a grid on the big triangles (a
## roof of two triangles would be missed in its middle).
static func _surface_points(car: Car) -> PackedVector3Array:
	var pts := PackedVector3Array()
	for m in car.model_root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		# (a model that bends already: its meshes as they were made are kept by SoftBodyMesh)
		var mesh: Mesh = mi.mesh if mi.mesh != null or car.shell_mesh == null else car.shell_mesh.original(mi)
		if mesh == null or not mi.is_visible_in_tree() or hidden_object(mi):
			continue
		var xf := CarModel.relative(mi, car)
		for s in mesh.get_surface_count():
			if mesh is ArrayMesh and (mesh as ArrayMesh).surface_get_primitive_type(s) != Mesh.PRIMITIVE_TRIANGLES:
				continue
			var arrays := mesh.surface_get_arrays(s)
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var step := maxi(1, verts.size() / 20000)
			for i in range(0, verts.size(), step):
				pts.append(xf * verts[i])
			var index: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			var tri_count := index.size() / 3 if not index.is_empty() else verts.size() / 3
			for t in tri_count:
				var a := xf * verts[index[3 * t] if not index.is_empty() else 3 * t]
				var b := xf * verts[index[3 * t + 1] if not index.is_empty() else 3 * t + 1]
				var c := xf * verts[index[3 * t + 2] if not index.is_empty() else 3 * t + 2]
				var longest := maxf(a.distance_to(b), maxf(a.distance_to(c), b.distance_to(c)))
				if longest < 0.4:
					continue
				var n := mini(10, ceili(longest / 0.2))
				for i in n + 1:
					for j in n + 1 - i:
						pts.append(a + (b - a) * (float(i) / n) + (c - a) * (float(j) / n))
	return pts


## Hides the objects of a model that are not seen: the drawing of the shell and the broken forms of parts.
static func hide_objects(root: Node) -> void:
	for n in root.find_children("*", "Node3D", true, false):
		if _hidden_name(str(n.name)):
			(n as Node3D).visible = false


static func _hidden_name(raw: String) -> bool:
	var nm := raw.to_lower()
	if nm.ends_with("_broken"):
		return true
	var letters := ""
	for ch in nm:
		if ch >= "a" and ch <= "z":
			letters += ch
	return letters in ["beams", "beam", "softbodybeams", "shellbeams", "softbodybeam", "shellbeam"]


## An object of the model that is not part of the car's shape: the drawing of the shell ("beams") and the broken
## form of a part ("<name>_broken").
static func hidden_object(node: Node) -> bool:
	var n := node
	while n != null and not (n is Car):
		if _hidden_name(str(n.name)):
			return true
		n = n.get_parent()
	return false


## The car cut into columns of a square of cell metres seen from above: the lowest and the highest point of each.
static func _columns(points: PackedVector3Array, cell: float) -> Array:
	var cols := {}
	for p in points:
		var key := Vector2i(floori(p.x / cell), floori(p.z / cell))
		var col: Vector2 = cols.get(key, Vector2(INF, -INF))
		cols[key] = Vector2(minf(col.x, p.y), maxf(col.y, p.y))
	var out: Array = []
	var r := minf(0.28, cell * 0.55)
	for key: Vector2i in cols:
		var col: Vector2 = cols[key]
		var x := (key.x + 0.5) * cell
		var z := (key.y + 0.5) * cell
		var h := col.y - col.x
		if h < 0.04:
			continue                     # a thin thing (an aerial, a wing mirror) is not a part of the body
		if h <= 2.0 * r + 0.05:
			out.append({"x": x, "y": (col.x + col.y) / 2.0, "z": z, "r": maxf(0.1, h / 2.0 + 0.03), "part": ""})
			continue
		out.append({"x": x, "y": col.x + r, "z": z, "r": r, "part": ""})
		out.append({"x": x, "y": col.y - r, "z": z, "r": r, "part": ""})
		var edge := not cols.has(key + Vector2i(1, 0)) or not cols.has(key + Vector2i(-1, 0)) or not cols.has(key + Vector2i(0, 1)) \
			or not cols.has(key + Vector2i(0, -1))
		if edge and h > 4.0 * r + 0.1:
			out.append({"x": x, "y": (col.x + col.y) / 2.0, "z": z, "r": r, "part": ""})
	return out


## The shell of the model: the vertices and the edges of an object "beams" (lines, or the edges of its faces) in the
## frame of the body, {points, edges}, or {} without one. Vertices that sit on each other are one node.
static func beams_from_model(car: Car) -> Dictionary:
	var holder: Node = null
	for n in car.model_root.find_children("*", "Node3D", true, false):
		if _beams_name(str(n.name)):
			holder = n
			break
	if holder == null:
		return {}
	var points := PackedVector3Array()
	var edges: Array = []
	var lookup := {}
	var meshes: Array = holder.find_children("*", "MeshInstance3D", true, false)
	if holder is MeshInstance3D:
		meshes.push_front(holder)
	for m in meshes:
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		var xf := CarModel.relative(mi, car)
		for si in mi.mesh.get_surface_count():
			var arrays := mi.mesh.surface_get_arrays(si)
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var index: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			var n := index.size() if not index.is_empty() else verts.size()
			var at := func(k: int) -> int: return index[k] if not index.is_empty() else k
			var node := func(i: int) -> int:
				var p: Vector3 = xf * verts[i]
				var key := Vector3i(roundi(p.x * 1e4), roundi(p.y * 1e4), roundi(p.z * 1e4))
				if not lookup.has(key):
					lookup[key] = points.size()
					points.append(p)
				return lookup[key]
			var kind := (mi.mesh as ArrayMesh).surface_get_primitive_type(si) if mi.mesh is ArrayMesh else Mesh.PRIMITIVE_TRIANGLES
			var pairs: Array = []
			if kind == Mesh.PRIMITIVE_LINES:
				for t in range(0, n - 1, 2):
					pairs.append([at.call(t), at.call(t + 1)])
			elif kind == Mesh.PRIMITIVE_LINE_STRIP:
				for t in n - 1:
					pairs.append([at.call(t), at.call(t + 1)])
			elif kind == Mesh.PRIMITIVE_TRIANGLES:
				for t in range(0, n - 2, 3):
					pairs.append_array([[at.call(t), at.call(t + 1)], [at.call(t + 1), at.call(t + 2)], [at.call(t + 2), at.call(t)]])
			for pr in pairs:
				var a: int = node.call(pr[0])
				var b: int = node.call(pr[1])
				if a != b:
					edges.append([a, b])
	if points.size() < 3 or edges.is_empty():
		return {}
	return {"points": points, "edges": edges}


static func _beams_name(raw: String) -> bool:
	var letters := ""
	for ch in raw.to_lower():
		if ch >= "a" and ch <= "z":
			letters += ch
	return letters in ["beams", "beam", "softbodybeams", "shellbeams", "softbodybeam", "shellbeam"]


## The suspension of every wheel as nodes (CollisionProxy.js): the hub (the collision sphere of the wheel), the ball
## joints above and below and the end of the tie rod, and the pivots of the arms and the tie rod on the car. A smaller
## wheel (a kart) has them closer to the hub; a motorcycle has them 7 cm beside the middle, and none for the wheel it
## does not have.
static func _rig_spheres(car: Car) -> Array:
	var out: Array = []
	var wide := 0.15 if car.bike != null else 1.0
	for wi in car.wheels.size():
		var wh := car.wheels[wi]
		if wh.lost:
			continue
		var c := wh.hub
		var s := -1.0 if c.x > 0.0 else 1.0                   # towards the middle of the car (x is to the left)
		var fit := minf(1.0, wh.radius / 0.3)
		for d in [["H", 0.0, 0.0, 0.0, maxf(0.06, 0.55 * wh.radius)], ["Ub", 0.12, 0.14, 0.0, 0.02], ["Lb", 0.10, -0.14, 0.0, 0.02],
				["Te", 0.12, -0.04, -0.12, 0.02], ["U1", 0.45, 0.20, 0.15, 0.02], ["U2", 0.45, 0.20, -0.15, 0.02],
				["L1", 0.50, -0.12, 0.20, 0.02], ["L2", 0.50, -0.12, -0.20, 0.02], ["R", 0.50, -0.02, -0.12, 0.02]]:
			var dx: float = d[1]
			out.append({"x": c.x + s * dx * fit * (wide if dx > 0.3 else 1.0), "y": c.y + float(d[2]) * fit, "z": c.z + float(d[3]) * fit,
				"r": d[4], "part": "", "rig": true, "role": d[0], "wheel": wi})
	return out
