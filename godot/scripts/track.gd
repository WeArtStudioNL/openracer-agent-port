class_name Track
extends Node3D
## A track of OpenRacer, from its track.json: the glb model, a collision shape for each of its meshes with the
## surface that track.json gives it ("surfaces.meshes": road, grass, sand ...; "decor" has no collision), the
## start, and its Atmosphere (the sky, the sun, the weather and the ground).

## The parts that the wheels do not drive on (scenery: walls, buildings, the objects that stand still) are on a layer of
## their own: the wheels look only at layer 1, as the wheels of the browser game only meet the drivable triangles
## (Ground.js); the body of a car and the loose parts meet both.
const SCENERY_LAYER := 4
const DRIVABLE := {"road": true, "track01": true, "wet": true, "grass": true, "ground": true, "sand": true, "gravel": true, "mud": true}

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
	if not DRIVABLE.has(kind):
		body.collision_layer = SCENERY_LAYER
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


## The middles of the triangles of a surface (the pit lane of a track without pit boxes, PitLane).
func surface_centroids(kind: String) -> Array[Vector3]:
	var out: Array[Vector3] = []
	for col in _colliders:
		if str(col.get_parent().get_meta("surface", "road")) != kind or not col.is_inside_tree():
			continue
		var faces := (col.shape as ConcavePolygonShape3D).get_faces()
		var xf := col.global_transform
		for t in range(0, faces.size() - 2, 3):
			out.append(xf * ((faces[t] + faces[t + 1] + faces[t + 2]) / 3.0))
	return out


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


## What a part is made of (TrackLoader.js trackRole): the role of track.json "surfaces.meshes" for its name or the name of a
## node above it, else of "surfaces.materials" for its material; a part that is not mentioned is scenery (it is hit, not
## driven on).
func _surface_of(mi: MeshInstance3D, surfaces: Dictionary) -> String:
	if surfaces.has(mi.mesh.resource_name):
		return str(surfaces[mi.mesh.resource_name])
	var n: Node = mi
	while n != null and n != self:
		if surfaces.has(str(n.name)):
			return str(surfaces[str(n.name)])
		n = n.get_parent()
	var materials: Dictionary = config.get("surfaces", {}).get("materials", {}) if config.get("surfaces") is Dictionary else {}
	var mat := mi.mesh.surface_get_material(0) if mi.mesh.get_surface_count() > 0 else null
	if mat != null and materials.has(mat.resource_name):
		return str(materials[mat.resource_name])
	return "scenery"


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
	var q := PhysicsRayQueryParameters3D.create(Vector3(x, 2000, z), Vector3(x, -2000, z), 1)
	var hit := space.intersect_ray(q)
	return float(hit["position"].y) if not hit.is_empty() else 0.0
