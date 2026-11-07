class_name CollisionProxy
extends RefCounted
## Where the nodes of the shell of a car are (web/js/CollisionProxy.js): the list that the maker of the car set in
## the car editor (car.json "softbody.layout"), or, without it, a cloud of spheres made from the model: the car is
## cut into columns seen from above, and every column gets a sphere at its lowest point, one at its highest and, at
## the edge of the car, one in the middle.
##
## The spheres are given in the frame of the body in Godot: [{x, y, z, r, part}]. The layout of car.json is in the
## frame of the browser game, from the centre of gravity; it is moved by the centre of mass of the body here.

const MAX_SPHERES := 90


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
	var layout: Array = cfg.get("layout", [])
	var out: Array = []
	if layout.size() >= 3:
		# drawn at one centre of gravity and radius of the tyres, used with another: the nodes stay where they were on
		# the model (the browser game shifts them the same way)
		var shift := 0.0
		if cfg.has("layout_cg"):
			shift += float(cfg["layout_cg"]) - car.cg_height
		if cfg.has("layout_radius"):
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
