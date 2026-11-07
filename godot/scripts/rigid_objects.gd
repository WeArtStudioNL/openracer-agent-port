class_name RigidObjects
extends Node3D
## Rigid bodies in a track (web/js/RigidObjects.js): barrels, boxes, cones, balls, anything that can be knocked over.
## They are RigidBody3D of Jolt, placed asleep (they cost nothing until a car touches one); a car that hits one pushes it
## and is pushed back by it (a concrete block stops a car, a cone does not), and one that has lain still for a while
## goes to sleep again.
##
## Where they come from:
##   - the model of the track: every part whose name, or the name of a node above it, starts with "rigid"
##     (rigid_barrel_1, Rigid Cone.002). Its shape is the convex hull of the part, its mass the volume of its box times
##     a density of 250 kg/m3 (track.json "rigid_density"), or "rigid_<n>kg" in the name. It leaves the road and the
##     walls of the track.
##   - track.json "objects": [{shape: "box" | "cylinder" | "cone" | "sphere", x, z, y (the road when left out), heading
##     (degrees), size: [w, h, d] (box) or radius and height, mass (kg), color, grid: [nx, nz] with spacing: [dx, dz]
##     for a block of them, layers: n for a stack}], and objects with a model of the track folder (model, pivot, scale,
##     pitch, roll; kind "rigid" (the default) a body with the hull of the model, "static" stands still and can be hit,
##     its triangles join the walls, "decor" is only seen).
##
## The wheels do not see them (the rays of the suspension look at layer 1 only): a car meets them with its body.

const LAYER := 4
const DENSITY := 250.0
const DEFAULT_COLOR := {"box": "#c9a25b", "cylinder": "#d9532b", "cone": "#ff7a1a", "sphere": "#e8e8e8"}

var track: Track
var bodies: Array[RigidBody3D] = []
var _home: Array[Transform3D] = []
var _materials := {}


## The objects of a track (an empty node when it has none).
static func make(t: Track) -> RigidObjects:
	var r := RigidObjects.new()
	r.name = "RigidObjects"
	r.track = t
	r.add_to_group("clear_at_start")
	return r


func _ready() -> void:
	if track == null:
		return
	var density := float(track.config.get("rigid_density", DENSITY))
	for node in _rigid_pieces():
		_from_piece(node, density)
	for spec in track.config.get("objects", []):
		if not (spec is Dictionary):
			continue
		if spec.has("model"):
			_from_model(spec, density)
		else:
			_from_spec(spec)
	if not bodies.is_empty():
		RunLog.event("rigid objects: %d" % bodies.size())


## The parts of the model of the track that are rigid: the highest node whose name starts with "rigid".
func _rigid_pieces() -> Array[Node3D]:
	var out: Array[Node3D] = []
	for n in track.find_children("*", "Node3D", true, false):
		if not str(n.name).to_lower().begins_with("rigid") or n is CollisionObject3D:
			continue
		var above := n.get_parent()
		var inner := false
		while above != null and above != track:
			if str(above.name).to_lower().begins_with("rigid"):
				inner = true
				break
			above = above.get_parent()
		if not inner:
			out.append(n as Node3D)
	return out


## A part of the model: out of the static collision of the track (and its walls), into a body with its hull.
func _from_piece(node: Node3D, density: float) -> void:
	var meshes: Array = node.find_children("*", "MeshInstance3D", true, false)
	if node is MeshInstance3D:
		meshes.append(node)
	for m in meshes:
		for sb in (m as Node).get_children():
			if sb is StaticBody3D:
				for col in sb.get_children():
					track._colliders.erase(col)
				sb.queue_free()
	var pts := _points(meshes)
	if pts.size() < 4:
		return
	var box := AABB(pts[0], Vector3.ZERO)
	for p in pts:
		box = box.expand(p)
	var mass := _mass_from_name(str(node.name))
	if mass <= 0.0:
		mass = maxf(1.0, box.size.x * box.size.y * box.size.z * density)
	var body := _body(Transform3D(Basis.IDENTITY, box.get_center()), mass)
	_hull(body, pts, box)
	var gx := node.global_transform
	node.get_parent().remove_child(node)
	body.add_child(node)
	node.global_transform = gx
	_keep(body)


static func _mass_from_name(n: String) -> float:
	var re := RegEx.create_from_string("(\\d+(?:\\.\\d+)?)\\s*kg")
	var m := re.search(n.to_lower())
	return float(m.get_string(1)) if m != null else 0.0


## Points of the meshes in the world (at most about 160 of each, no point twice).
static func _points(meshes: Array) -> PackedVector3Array:
	var out := PackedVector3Array()
	var seen := {}
	for m in meshes:
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		var xf := mi.global_transform
		for si in mi.mesh.get_surface_count():
			var verts: PackedVector3Array = mi.mesh.surface_get_arrays(si)[Mesh.ARRAY_VERTEX]
			var step := maxi(1, verts.size() / 160)
			for i in range(0, verts.size(), step):
				var p := xf * verts[i]
				var key := Vector3i(roundi(p.x * 500), roundi(p.y * 500), roundi(p.z * 500))
				if not seen.has(key):
					seen[key] = true
					out.append(p)
	return out


func _body(xf: Transform3D, mass: float) -> RigidBody3D:
	var body := RigidBody3D.new()
	body.name = "Rigid%d" % bodies.size()
	body.mass = mass
	body.collision_layer = LAYER
	body.collision_mask = 1 | 2 | LAYER
	body.linear_damp = 0.1
	body.angular_damp = 0.25
	body.continuous_cd = true
	body.can_sleep = true
	var mat := PhysicsMaterial.new()
	mat.friction = 0.7
	mat.bounce = 0.25
	body.physics_material_override = mat
	add_child(body)
	body.global_transform = xf
	body.sleeping = true
	return body


## The hull of points (world) on a body, or a box of their size when there is no hull.
static func _hull(body: RigidBody3D, pts: PackedVector3Array, box: AABB) -> void:
	var col := CollisionShape3D.new()
	var inv := body.global_transform.affine_inverse()
	if pts.size() >= 4:
		var local := PackedVector3Array()
		for p in pts:
			local.append(inv * p)
		var hull := ConvexPolygonShape3D.new()
		hull.points = local
		col.shape = hull
	else:
		var b := BoxShape3D.new()
		b.size = box.size.max(Vector3(0.08, 0.08, 0.08))
		col.shape = b
	body.add_child(col)


func _keep(body: RigidBody3D) -> void:
	bodies.append(body)
	_home.append(body.global_transform)


func _ground(x: float, z: float) -> float:
	return track.ground_at(x, z) if track.is_inside_tree() else 0.0


## An object of track.json made into one or more bodies (a grid and layers make a block, turned with its heading).
func _from_spec(spec: Dictionary) -> void:
	var shape := str(spec.get("shape", "box"))
	var size: Array = spec.get("size", [1, 1, 1])
	var radius := float(spec.get("radius", 0.3))
	var height := float(spec.get("height", 0.9))
	var w := float(size[0])
	var h := float(size[1]) if size.size() > 1 else w
	var d := float(size[2]) if size.size() > 2 else w
	var half := h / 2.0 if shape == "box" else (radius if shape == "sphere" else height / 2.0)
	var grid: Array = spec.get("grid", [1, 1])
	var spacing: Array = spec.get("spacing", [w * 1.02 if shape == "box" else radius * 2.2, d * 1.02 if shape == "box" else radius * 2.2])
	var layers := maxi(1, int(spec.get("layers", 1)))
	var heading := deg_to_rad(float(spec.get("heading", 0)))
	var volume := w * h * d
	if shape == "sphere":
		volume = 4.0 / 3.0 * PI * pow(radius, 3.0)
	elif shape != "box":
		volume = PI * radius * radius * height * (0.4 if shape == "cone" else 1.0)
	var mass := float(spec.get("mass", maxf(1.0, volume * DENSITY)))
	var mat := _material(str(spec.get("color", DEFAULT_COLOR.get(shape, "#cccccc"))))
	for layer in layers:
		for i in int(grid[0]):
			for j in int(grid[1]):
				var lx := (i - (int(grid[0]) - 1) / 2.0) * float(spacing[0])
				var lz := (j - (int(grid[1]) - 1) / 2.0) * float(spacing[1])
				var x := float(spec.get("x", 0)) + lx * cos(heading) - lz * sin(heading)
				var z := float(spec.get("z", 0)) + lx * sin(heading) + lz * cos(heading)
				var y := float(spec["y"]) if spec.has("y") else _ground(x, z)
				y += half * (1 + 2 * layer) + 0.01 * layer
				var body := _body(Transform3D(Basis(Vector3.UP, -heading), Vector3(x, y, z)), mass)
				var mi := MeshInstance3D.new()
				var col := CollisionShape3D.new()
				match shape:
					"cylinder", "cone":
						var cm := CylinderMesh.new()
						cm.top_radius = radius * (0.18 if shape == "cone" else 1.0)
						cm.bottom_radius = radius
						cm.height = height
						mi.mesh = cm
						var cs := CylinderShape3D.new()
						cs.radius = radius
						cs.height = height
						col.shape = cs
					"sphere":
						var sm := SphereMesh.new()
						sm.radius = radius
						sm.height = radius * 2.0
						mi.mesh = sm
						var ss := SphereShape3D.new()
						ss.radius = radius
						col.shape = ss
					_:
						var bm := BoxMesh.new()
						bm.size = Vector3(w, h, d)
						mi.mesh = bm
						var bs := BoxShape3D.new()
						bs.size = Vector3(w, h, d)
						col.shape = bs
				mi.material_override = mat
				body.add_child(mi)
				body.add_child(col)
				_keep(body)


func _material(color: String) -> StandardMaterial3D:
	if not _materials.has(color):
		var m := StandardMaterial3D.new()
		m.albedo_color = Color.html(color) if Color.html_is_valid(color) else Color(0.8, 0.8, 0.8)
		m.roughness = 0.7
		m.metallic = 0.05
		_materials[color] = m
	return _materials[color]


## An object with a model of the track folder: placed with its pivot on the road, turned by its heading, pitch and roll,
## scaled. kind rigid: a body with the hull of the model; static: it stands and can be hit (its triangles join the
## walls of the track); decor: only seen.
func _from_model(spec: Dictionary, density: float) -> void:
	var model := Content.load_model("tracks/%s/%s" % [track.track_id, str(spec["model"])])
	if model == null:
		return
	var x := float(spec.get("x", 0))
	var z := float(spec.get("z", 0))
	var y := float(spec["y"]) if spec.has("y") else _ground(x, z)
	var inner := Node3D.new()
	var pivot: Variant = spec.get("pivot")
	if pivot is Array and (pivot as Array).size() == 3:
		model.position = -Vector3(float(pivot[0]), float(pivot[1]), float(pivot[2]))
	inner.add_child(model)
	var sc: Variant = spec.get("scale")
	if sc is float or sc is int:
		inner.scale = Vector3.ONE * float(sc)
	elif sc is Array and (sc as Array).size() == 3:
		inner.scale = Vector3(float(sc[0]) if float(sc[0]) != 0.0 else 1.0, float(sc[1]) if float(sc[1]) != 0.0 else 1.0, float(sc[2]) if float(sc[2]) != 0.0 else 1.0)
	var turn := Basis.from_euler(Vector3(deg_to_rad(float(spec.get("pitch", 0))), -deg_to_rad(float(spec.get("heading", 0))), deg_to_rad(float(spec.get("roll", 0)))),
		EULER_ORDER_YXZ)
	var kind := str(spec.get("kind", "decor" if spec.get("rigid", true) == false else "rigid"))
	if kind != "rigid":
		var holder := Node3D.new()
		add_child(holder)
		holder.global_transform = Transform3D(turn, Vector3(x, y, z))
		holder.add_child(inner)
		if kind == "static":
			for m in inner.find_children("*", "MeshInstance3D", true, false):
				var mi := m as MeshInstance3D
				var shape := mi.mesh.create_trimesh_shape() if mi.mesh != null else null
				if shape == null:
					continue
				shape.backface_collision = true
				var sb := StaticBody3D.new()
				sb.set_meta("surface", "road")
				var col := CollisionShape3D.new()
				col.shape = shape
				sb.add_child(col)
				mi.add_child(sb)
				track._colliders.append(col)
		return
	add_child(inner)
	inner.global_transform = Transform3D(turn, Vector3(x, y, z)) * Transform3D(Basis.from_scale(inner.scale), Vector3.ZERO)
	var meshes: Array = inner.find_children("*", "MeshInstance3D", true, false)
	var pts := _points(meshes)
	if pts.size() < 4:
		inner.queue_free()
		return
	var box := AABB(pts[0], Vector3.ZERO)
	for p in pts:
		box = box.expand(p)
	var mass := float(spec.get("mass", maxf(1.0, box.size.x * box.size.y * box.size.z * density)))
	var body := _body(Transform3D(turn, box.get_center()), mass)
	_hull(body, pts, box)
	var gx := inner.global_transform
	remove_child(inner)
	body.add_child(inner)
	inner.global_transform = gx
	_keep(body)


## Every object back where it was, asleep (the car is put back at the start).
func clear() -> void:
	for i in bodies.size():
		var b := bodies[i]
		if not is_instance_valid(b):
			continue
		b.global_transform = _home[i]
		b.linear_velocity = Vector3.ZERO
		b.angular_velocity = Vector3.ZERO
		b.process_mode = Node.PROCESS_MODE_INHERIT
		b.visible = true
		b.sleeping = true


func _physics_process(_dt: float) -> void:
	for b in bodies:
		# (one that fell off the world)
		if is_instance_valid(b) and b.process_mode != Node.PROCESS_MODE_DISABLED and b.global_position.y < -500.0:
			b.process_mode = Node.PROCESS_MODE_DISABLED
			b.visible = false


func awake() -> int:
	var n := 0
	for b in bodies:
		if is_instance_valid(b) and not b.sleeping:
			n += 1
	return n
