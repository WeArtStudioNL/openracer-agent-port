class_name TrackObjects
extends Node3D
## The objects of a track (web/js/RigidObjects.js): track.json "objects", placed in the track editor, and the parts of the
## model whose name starts with "rigid".
##   - an object with a model (a glb in the folder of the track): its kind says what it is. "rigid" (the default; the older
##     "rigid": false is decor) is a body that sleeps until a car hits it and is then pushed and falls (its shape the hull of the
##     model, its mass "mass" or the volume of its box times 250 kg/m3); "static" stands still and is hit as a wall of the
##     track; "decor" is only drawn. "pivot" is the point of the model that stands on the place (the middle of its base), "scale"
##     a number or [x, y, z], "heading", "pitch" and "roll" in degrees.
##   - an object of a shape: "shape": box | cylinder | cone | sphere, "size" [w, h, d] or "radius" and "height", "mass",
##     "color", "grid": [nx, nz] with "spacing" for a block of them, "layers" for a stack. Always rigid.
## The cars do not meet the bodies of Godot (Car.gd has its own wheels and shells): as in the browser game every car has a box
## that pushes the objects, and what the car gives to an object comes back to it as a change of its speed.

const DENSITY := 250.0
const LAYER_OBJECT := 32            # the bodies of the objects (the wheels of the cars look only at layer 1)
const LAYER_CAR := 64               # the boxes of the cars that push them
const WAKE := 6.0
const DEFAULT_COLOR := {"box": "#c9a25b", "cylinder": "#d9532b", "cone": "#ff7a1a", "sphere": "#e8e8e8"}

var bodies: Array[RigidBody3D] = []
var _track: Node3D
var _cars: Array = []
var _boxes := {}                    # car -> AnimatableBody3D
var _before := {}                   # body -> its velocity at the last frame
var _find_in := 0.0
var _homes := {}                    # body -> its transform at the start


## Builds the objects of cfg in the track (once the track is in the scene: their height comes from a ray).
func setup(track: Node3D, cfg: Dictionary, track_id: String, pieces: Array = []) -> void:
	name = "TrackObjects"
	_track = track
	var density := float(cfg.get("rigid_density", DENSITY))
	for mi in pieces:
		_rigid_piece(mi, density)
	var scenes := {}
	for spec in cfg.get("objects", []):
		if not (spec is Dictionary) or not spec.has("x") or not spec.has("z"):
			continue
		if spec.has("model"):
			var file := str(spec["model"])
			if not scenes.has(file):
				scenes[file] = Content.load_model("tracks/%s/%s" % [track_id, file])
			if scenes[file] != null:
				_from_model(spec, scenes[file], density)
		else:
			_from_shape(spec)
	for s in scenes.values():
		if s != null:
			s.free()
	if not bodies.is_empty():
		RunLog.event("objects of the track: %d rigid" % bodies.size())


func _ground(x: float, z: float) -> float:
	return _track.ground_at(x, z) if _track != null and _track.has_method("ground_at") else 0.0


func _turn(spec: Dictionary) -> Basis:
	var e := Vector3(deg_to_rad(float(spec.get("pitch", 0))), -deg_to_rad(float(spec.get("heading", 0))), deg_to_rad(float(spec.get("roll", 0))))
	return Basis.from_euler(e, EULER_ORDER_YXZ)


func _from_model(spec: Dictionary, source: Node3D, density: float) -> void:
	var y := float(spec["y"]) if spec.has("y") else _ground(float(spec["x"]), float(spec["z"]))
	var model := source.duplicate() as Node3D
	var inner := Node3D.new()
	var pivot: Variant = spec.get("pivot")
	if pivot is Array and pivot.size() == 3:
		model.position = -Vector3(float(pivot[0]), float(pivot[1]), float(pivot[2]))
	inner.add_child(model)
	var sc: Variant = spec.get("scale")
	if (sc is float or sc is int) and float(sc) > 0.0:
		inner.scale = Vector3.ONE * float(sc)
	elif sc is Array and sc.size() == 3:
		inner.scale = Vector3(float(sc[0]) if float(sc[0]) != 0.0 else 1.0, float(sc[1]) if float(sc[1]) != 0.0 else 1.0,
			float(sc[2]) if float(sc[2]) != 0.0 else 1.0)
	var turn := _turn(spec)
	var kind := str(spec.get("kind", "decor" if spec.get("rigid", true) == false else "rigid"))
	if kind != "rigid":
		inner.transform = Transform3D(turn * Basis.from_scale(inner.scale), Vector3(float(spec["x"]), y, float(spec["z"])))
		add_child(inner)
		for m in inner.find_children("*", "MeshInstance3D", true, false):
			(m as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		if kind == "static":
			_make_static(inner)
		return
	# a rigid one: the body turns about the middle of the box of the model
	var points := PackedVector3Array()
	var box := AABB()
	var first := true
	var xf_inner := Transform3D(Basis.from_scale(inner.scale), Vector3.ZERO)
	for m in inner.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		var xf := xf_inner * _local_to(mi, inner)
		var faces := mi.mesh.get_faces()
		var step := maxi(1, faces.size() / 300)
		for i in range(0, faces.size(), step):
			var p := xf * faces[i]
			points.append(p)
			if first:
				box = AABB(p, Vector3.ZERO)
				first = false
			else:
				box = box.expand(p)
	if points.is_empty():
		inner.free()
		return
	var centre := box.get_center()
	var body := _body(float(spec.get("mass", maxf(1.0, box.size.x * box.size.y * box.size.z * density))))
	var shape := ConvexPolygonShape3D.new()
	var local := PackedVector3Array()
	for p in points:
		local.append(p - centre)
	shape.points = local
	var col := CollisionShape3D.new()
	col.shape = shape
	body.add_child(col)
	inner.transform = Transform3D(xf_inner.basis, -centre)
	body.add_child(inner)
	body.transform = Transform3D(turn, Vector3(float(spec["x"]), y, float(spec["z"])) + turn * centre)
	_add_body(body)


## The transform of a node relative to an ancestor.
static func _local_to(n: Node3D, ancestor: Node3D) -> Transform3D:
	var xf := Transform3D.IDENTITY
	var cur: Node = n
	while cur != null and cur != ancestor:
		if cur is Node3D:
			xf = (cur as Node3D).transform * xf
		cur = cur.get_parent()
	return xf


## A static object: its triangles are walls of the track (and the cars' shells meet them).
func _make_static(root: Node3D) -> void:
	for m in root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		var shape := mi.mesh.create_trimesh_shape()
		if shape == null:
			continue
		shape.backface_collision = true
		var sb := StaticBody3D.new()
		sb.set_meta("surface", "scenery")
		sb.collision_layer = Track.SCENERY_LAYER
		var col := CollisionShape3D.new()
		col.shape = shape
		sb.add_child(col)
		mi.add_child(sb)
		if _track != null and _track.has_method("add_collider"):
			_track.add_collider(col)


func _from_shape(spec: Dictionary) -> void:
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
	var colour := Color(str(spec.get("color", DEFAULT_COLOR.get(shape, "#cccccc"))))
	var volume := PI * radius * radius * height * (0.4 if shape == "cone" else 1.0)
	if shape == "box":
		volume = w * h * d
	elif shape == "sphere":
		volume = 4.0 / 3.0 * PI * pow(radius, 3)
	var mass := float(spec.get("mass", maxf(1.0, volume * DENSITY)))
	var mat := StandardMaterial3D.new()
	mat.albedo_color = colour
	mat.roughness = 0.7
	mat.metallic = 0.05
	for layer in layers:
		for i in int(grid[0]):
			for j in int(grid[1]):
				var lx := (i - (int(grid[0]) - 1) / 2.0) * float(spacing[0])
				var lz := (j - (int(grid[1]) - 1) / 2.0) * float(spacing[1])
				var x := float(spec["x"]) + lx * cos(heading) - lz * sin(heading)
				var z := float(spec["z"]) + lx * sin(heading) + lz * cos(heading)
				var y := float(spec["y"]) if spec.has("y") else _ground(x, z)
				y += half * (1 + 2 * layer) + 0.01 * layer
				var mesh: Mesh
				var col_shape: Shape3D
				if shape == "cylinder" or shape == "cone":
					var cm := CylinderMesh.new()
					cm.top_radius = radius * (0.18 if shape == "cone" else 1.0)
					cm.bottom_radius = radius
					cm.height = height
					cm.radial_segments = 20
					mesh = cm
					var cs := CylinderShape3D.new()
					cs.radius = radius
					cs.height = height
					col_shape = cs
				elif shape == "sphere":
					var sm := SphereMesh.new()
					sm.radius = radius
					sm.height = radius * 2.0
					mesh = sm
					var ss := SphereShape3D.new()
					ss.radius = radius
					col_shape = ss
				else:
					var bm := BoxMesh.new()
					bm.size = Vector3(w, h, d)
					mesh = bm
					var bs := BoxShape3D.new()
					bs.size = Vector3(w, h, d)
					col_shape = bs
				var body := _body(mass)
				var mi := MeshInstance3D.new()
				mi.mesh = mesh
				mi.material_override = mat
				body.add_child(mi)
				var col := CollisionShape3D.new()
				col.shape = col_shape
				body.add_child(col)
				body.transform = Transform3D(Basis(Vector3.UP, -heading), Vector3(x, y, z))
				_add_body(body)


## A part of the model of the track named rigid...: a body of its own (its mass from 'rigid_<n>kg' in the name, or its box).
func _rigid_piece(mi: MeshInstance3D, density: float) -> void:
	var xf := mi.global_transform
	var faces := mi.mesh.get_faces()
	if faces.is_empty():
		return
	var box := AABB(xf * faces[0], Vector3.ZERO)
	for f in faces:
		box = box.expand(xf * f)
	var centre := box.get_center()
	var re := RegEx.create_from_string("(\\d+(?:\\.\\d+)?)\\s*kg")
	var m := re.search(str(mi.name).to_lower())
	var mass := float(m.get_string(1)) if m != null else maxf(1.0, box.size.x * box.size.y * box.size.z * density)
	var body := _body(mass)
	var shape := ConvexPolygonShape3D.new()
	var pts := PackedVector3Array()
	var step := maxi(1, faces.size() / 300)
	for i in range(0, faces.size(), step):
		pts.append(xf * faces[i] - centre)
	shape.points = pts
	var col := CollisionShape3D.new()
	col.shape = shape
	body.add_child(col)
	mi.get_parent().remove_child(mi)
	mi.transform = Transform3D(xf.basis, xf.origin - centre)
	body.add_child(mi)
	body.position = centre
	_add_body(body)


func _body(mass: float) -> RigidBody3D:
	var body := RigidBody3D.new()
	body.mass = mass
	body.collision_layer = LAYER_OBJECT
	body.collision_mask = 1 | Track.SCENERY_LAYER | LAYER_OBJECT | LAYER_CAR
	body.linear_damp = 0.1
	body.angular_damp = 0.25
	body.continuous_cd = true
	body.can_sleep = true
	var pm := PhysicsMaterial.new()
	pm.friction = 0.7
	pm.bounce = 0.25
	body.physics_material_override = pm
	return body


func _add_body(body: RigidBody3D) -> void:
	add_child(body)
	body.sleeping = true
	bodies.append(body)
	_homes[body] = body.transform


## Every object back where it was, asleep (a new start).
func reset() -> void:
	for b in bodies:
		b.linear_velocity = Vector3.ZERO
		b.angular_velocity = Vector3.ZERO
		b.transform = _homes[b]
		b.sleeping = true


func _physics_process(dt: float) -> void:
	if bodies.is_empty():
		return
	_find_in -= dt
	if _find_in <= 0.0:
		_find_in = 1.0
		_find_cars()
	for car in _cars:
		if not is_instance_valid(car):
			continue
		var box: AnimatableBody3D = _boxes.get(car)
		if box == null:
			box = _car_box(car)
		box.global_transform = (car as Node3D).global_transform
		# what the car gave the objects near it in the last step comes back to it, only as a push against its way
		var push := Vector3.ZERO
		var cp: Vector3 = (car as Node3D).global_position
		for b in bodies:
			if b.sleeping or b.global_position.distance_to(cp) > 6.0:
				continue
			var before: Vector3 = _before.get(b, b.linear_velocity)
			push += (b.linear_velocity - before) * b.mass
		push.y = 0.0
		var cm := float((car as RigidBody3D).mass)
		var dv := -push / maxf(1.0, cm)
		if dv.length() > 3.0:
			dv = dv.normalized() * 3.0
		var v: Vector3 = (car as RigidBody3D).linear_velocity
		if dv.length() > 0.001 and dv.dot(v) < 0.0:
			(car as RigidBody3D).linear_velocity = v + dv
	for b in bodies:
		_before[b] = b.linear_velocity
		if b.global_position.y < -500.0:
			b.freeze = true
			b.visible = false


func _find_cars() -> void:
	_cars.clear()
	var root := get_tree().current_scene if get_tree().current_scene != null else get_tree().root
	for n in root.find_children("*", "RigidBody3D", true, false):
		if n is Car:
			_cars.append(n)


func _car_box(car: Node3D) -> AnimatableBody3D:
	var box := AnimatableBody3D.new()
	box.sync_to_physics = false
	box.collision_layer = LAYER_CAR
	box.collision_mask = LAYER_OBJECT
	var aabb := AABB()
	var first := true
	for m in car.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.visible:
			continue
		var a := car.global_transform.affine_inverse() * mi.global_transform * mi.get_aabb()
		aabb = a if first else aabb.merge(a)
		first = false
	if first or aabb.size.length() > 12.0:
		aabb = AABB(Vector3(-0.9, 0.0, -2.2), Vector3(1.8, 1.3, 4.4))
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(aabb.size.x, maxf(0.4, aabb.size.y - 0.2), aabb.size.z)
	col.shape = shape
	col.position = aabb.get_center() + Vector3(0, 0.1, 0)
	box.add_child(col)
	add_child(box)
	_boxes[car] = box
	return box
