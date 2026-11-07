class_name Track
extends Node3D
## A track of OpenRacer, from its track.json: the glb model, a collision shape for each of its meshes with the
## surface that track.json gives it ("surfaces.meshes": road, grass, sand ...; "decor" has no collision), the
## sky, the sun and the start.

var config: Dictionary = {}
var track_id := ""
var start := {"x": 0.0, "z": 0.0, "heading": 0.0}
var marks: TrackMarks = null       # the grid boxes, the pit area and the checkpoints (TrackMarks)
var objects: TrackObjects = null   # the objects of track.json and the rigid parts of the model (TrackObjects)
var _colliders: Array[CollisionShape3D] = []
var _walls: WallGrid = null


func setup(id: String, cfg: Dictionary) -> void:
	track_id = id
	config = cfg
	name = "Track"
	add_to_group("track")
	start = cfg.get("start", start)
	_environment(cfg.get("environment", {}))
	var model := Content.load_model("tracks/%s/%s" % [id, cfg.get("model", id + ".glb")])
	if model == null:
		_flat_ground()
		return
	add_child(model)
	var surfaces: Dictionary = cfg.get("surfaces", {}).get("meshes", {})
	var double_sided: Array = cfg.get("double_sided", []) if cfg.get("double_sided") is Array else []
	var rigid: Array = []
	for m in model.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		if not double_sided.is_empty():
			_double_sided(mi, double_sided)
		if _is_rigid(mi):
			rigid.append(mi)
			continue
		var kind := _surface_of(mi, surfaces)
		if kind == "decor":
			continue
		_add_body(mi, kind)
	# the curbs of the track editor (Curbs.js): road, a few centimetres above what is under them
	for curb in Curbs.meshes(cfg.get("curbs")):
		add_child(curb)
		_add_body(curb, "road")
	# the pit boxes on the road (Pit.js), the grid, the pit area and the checkpoints (TrackMarks.js, GateMarkers.js) and the
	# objects (RigidObjects.js), once the track is in the scene (their heights come from a ray)
	_add_marks.call_deferred(PitStop.boxes_of(cfg), rigid)


func _add_marks(boxes: Array, rigid: Array) -> void:
	await get_tree().physics_frame
	if not boxes.is_empty():
		add_child(PitStop.markings(boxes, self))
	marks = TrackMarks.new()
	add_child(marks)
	marks.setup(self, config)
	objects = TrackObjects.new()
	add_child(objects)
	objects.setup(self, config, track_id, rigid)


## A part of the model with collision: a static body under it with its surface.
func _add_body(mi: MeshInstance3D, kind: String) -> void:
	var shape := mi.mesh.create_trimesh_shape()
	if shape == null:
		return
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


## A collision shape that is a wall of the track too (a static object): the shells of the cars meet it.
func add_collider(col: CollisionShape3D) -> void:
	_colliders.append(col)
	if _walls != null and col.shape is ConcavePolygonShape3D and col.is_inside_tree():
		_walls.add_faces((col.shape as ConcavePolygonShape3D).get_faces(), col.global_transform, "scenery")


## A part named rigid... (or under a node so named) is a body of its own (TrackObjects).
func _is_rigid(mi: MeshInstance3D) -> bool:
	var n: Node = mi
	while n != null and n != self:
		if str(n.name).to_lower().begins_with("rigid"):
			return true
		n = n.get_parent()
	return false


## track.json "double_sided": the materials that are seen from both sides (a sign of one flat panel).
func _double_sided(mi: MeshInstance3D, names: Array) -> void:
	for s in mi.mesh.get_surface_count():
		var m := mi.mesh.surface_get_material(s) as BaseMaterial3D
		if m != null and names.has(m.resource_name):
			m.cull_mode = BaseMaterial3D.CULL_DISABLED


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


func _environment(env: Dictionary) -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(str(env.get("sky_top", "#4a82c4")))
	sky_mat.sky_horizon_color = Color(str(env.get("sky_horizon", "#d3e4f4")))
	sky_mat.ground_horizon_color = sky_mat.sky_horizon_color
	sky_mat.ground_bottom_color = Color(0.25, 0.27, 0.25)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	e.sky = sky
	var amb: Dictionary = env.get("ambient", {})
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	e.ambient_light_color = Color(str(amb.get("color", "#576777")))
	e.ambient_light_sky_contribution = 0.6
	e.ambient_light_energy = float(amb.get("intensity", 1.0))
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.ssao_enabled = true
	var fog: Dictionary = env.get("fog", {})
	if fog.get("enabled", false):
		e.fog_enabled = true
		e.fog_mode = Environment.FOG_MODE_DEPTH
		e.fog_light_color = Color(str(fog.get("color", "#cfdbe8")))
		e.fog_depth_begin = float(fog.get("near", 300))
		e.fog_depth_end = float(fog.get("far", 2500))
	var we := WorldEnvironment.new()
	we.environment = e
	add_child(we)

	var sun_cfg: Dictionary = env.get("sun", {})
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_color = Color(str(sun_cfg.get("color", "#ffffff")))
	sun.light_energy = float(sun_cfg.get("intensity", 1.0)) * 1.2
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 220.0
	sun.rotation = Vector3(-deg_to_rad(float(sun_cfg.get("elevation", 45))), deg_to_rad(float(sun_cfg.get("azimuth", 40))), 0.0)
	add_child(sun)


## The height of the road under (x, z): the highest thing a ray from far above finds; 0 when there is nothing.
func ground_at(x: float, z: float) -> float:
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(Vector3(x, 2000, z), Vector3(x, -2000, z))
	var hit := space.intersect_ray(q)
	return float(hit["position"].y) if not hit.is_empty() else 0.0
