class_name Track
extends Node3D
## A track of OpenRacer, from its track.json: the glb model, a collision shape for each of its meshes with the
## surface that track.json gives it ("surfaces.meshes": road, grass, sand ...; "decor" has no collision), the
## start, and its Atmosphere (the sky, the sun, the weather and the ground).

var config: Dictionary = {}
var track_id := ""
var start := {"x": 0.0, "z": 0.0, "heading": 0.0}
var _colliders: Array[CollisionShape3D] = []
var _walls: WallGrid = null


func setup(id: String, cfg: Dictionary) -> void:
	track_id = id
	config = cfg
	name = "Track"
	add_to_group("track")
	start = cfg.get("start", start)
	var model := Content.load_model("tracks/%s/%s" % [id, cfg.get("model", id + ".glb")])
	# the sky, the light, the weather and the ground (the same on every track; the track gives how bright it likes the light)
	var atmosphere := Atmosphere.new()
	atmosphere.setup(cfg.get("environment", {}), model)
	add_child(atmosphere)
	if model == null:
		_flat_ground()
		return
	add_child(model)
	var surfaces: Dictionary = cfg.get("surfaces", {}).get("meshes", {})
	for m in model.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		var kind := _surface_of(mi, surfaces)
		if kind == "decor":
			continue
		var shape := mi.mesh.create_trimesh_shape()
		if shape == null:
			continue
		shape.backface_collision = true
		var body := StaticBody3D.new()
		body.set_meta("surface", kind)
		var mat := PhysicsMaterial.new()
		mat.friction = 0.6
		body.physics_material_override = mat
		var col := CollisionShape3D.new()
		col.shape = shape
		body.add_child(col)
		mi.add_child(body)
		_colliders.append(col)
	# the pit boxes on the road (Pit.js), once the track is in the scene (their height comes from a ray)
	var boxes := PitStop.boxes_of(cfg)
	if not boxes.is_empty():
		_add_pit_boxes.call_deferred(boxes)


func _add_pit_boxes(boxes: Array) -> void:
	await get_tree().physics_frame
	add_child(PitStop.markings(boxes, self))


## The walls of the track for the shells of the cars (WallGrid), made the first time they are asked for (the track
## must be in the scene by then).
func walls() -> WallGrid:
	if _walls == null:
		var t0 := Time.get_ticks_msec()
		_walls = WallGrid.new()
		for col in _colliders:
			var shape := col.shape as ConcavePolygonShape3D
			if shape != null and col.is_inside_tree():
				_walls.add_faces(shape.get_faces(), col.global_transform, str(col.get_parent().get_meta("surface", "road")))
		RunLog.event("walls of the track for the soft bodies: %d triangles in %d ms" % [_walls.count, Time.get_ticks_msec() - t0])
	return _walls


func _surface_of(mi: MeshInstance3D, surfaces: Dictionary) -> String:
	# the name in track.json is the name of the mesh or of its object in Blender
	for key in [str(mi.name), mi.mesh.resource_name, str(mi.get_parent().name)]:
		if surfaces.has(key):
			return str(surfaces[key])
	return "road"


func _flat_ground() -> void:
	var body := StaticBody3D.new()
	var col := CollisionShape3D.new()
	col.shape = WorldBoundaryShape3D.new()
	body.add_child(col)
	add_child(body)
	var plane := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(2000, 2000)
	plane.mesh = pm
	add_child(plane)


## The height of the road under (x, z): the highest thing a ray from far above finds; 0 when there is nothing.
func ground_at(x: float, z: float) -> float:
	# (not in the world yet, as while World.setup builds the drag strip: no ground to find; the web version crashed on
	# the null world, the desktop one gave an error and 0)
	if not is_inside_tree():
		return 0.0
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(Vector3(x, 2000, z), Vector3(x, -2000, z))
	var hit := space.intersect_ray(q)
	return float(hit["position"].y) if not hit.is_empty() else 0.0
