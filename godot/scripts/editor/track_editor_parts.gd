class_name TrackEditorParts
extends RefCounted
## The parts of a track in the track editor: the model or the road of nodes, the surfaces of the parts and their colours,
## the placed objects, and the camera over the whole of it.

static var _role_materials := {}

var ed: TrackEditor


func _init(editor: TrackEditor) -> void:
	ed = editor


## The ed.size of the ed.view: right of the side bar.
func layout_view(side_width: float) -> void:
	ed.view_box.position = Vector2(side_width, 0)
	ed.view_box.size = Vector2(ed.size.x - side_width, ed.size.y)


## The ed.camera over the whole track (the part that can be driven on: a sky dome would make it too big).
func frame_track() -> void:
	var box := drive_box()
	if box.size == Vector3.ZERO:
		return
	var span := maxf(10.0, maxf(box.size.x, box.size.z))
	ed.marker_scale = maxf(1.0, span / 250.0)
	ed.camera.far = span * 30.0
	ed.camera.near = maxf(0.5, span / 5000.0)
	ed.target = box.get_center()
	ed.yaw = atan2(0.35, 0.55)
	ed.pitch = atan2(0.6, Vector2(0.35, 0.55).length())
	ed.distance = Vector3(0.35, 0.6, 0.55).length() * span


func top_view() -> void:
	var box := drive_box()
	if box.size == Vector3.ZERO:
		return
	ed.target = box.get_center()
	ed.pitch = 1.5607
	ed.distance = maxf(10.0, maxf(box.size.x, box.size.z))


func drive_box() -> AABB:
	var box := AABB()
	var first := true
	for part_name in ed.parts:
		if not TrackEditor.DRIVABLE.has(ed.roles.get(part_name, "")):
			continue
		for mi in ed.parts[part_name]:
			if not is_instance_valid(mi):
				continue
			var b: AABB = (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()
			box = b if first else box.merge(b)
			first = false
	return box


# ---- the ed.parts of the track and their surfaces

func clear_track() -> void:
	for c in ed.track_group.get_children():
		ed.track_group.remove_child(c)
		c.queue_free()
	ed.model_root = null
	ed.design = null
	ed.parts = {}
	ed.roles = {}
	ed.selected_part = ""
	ed.invalidate_ground()


static func guess_role(part: String, material_name: String) -> String:
	var text := (part + " " + material_name).to_lower()
	var has := func(words: Array) -> bool:
		for w in words:
			if text.contains(w):
				return true
		return false
	if has.call(["sky", "cloud", "tree", "flag", "banner", "sign", "horizon", "decor", "grandstand", "crowd", "lamp"]):
		return "decor"
	if text.contains("pit") and has.call(["road", "lane", "asphalt", "tarmac"]):
		return "track01"
	if has.call(["road", "asphalt", "tarmac", "track", "strip", "kerb", "curb", "circuit"]):
		return "road"
	if has.call(["grass", "gras", "lawn", "field"]):
		return "grass"
	if has.call(["sand", "zand", "desert", "dune"]):
		return "sand"
	if has.call(["gravel", "grind", "split"]):
		return "gravel"
	if has.call(["mud", "modder", "klei"]):
		return "mud"
	if has.call(["dirt", "ground", "soil", "terrain"]):
		return "ground"
	return "scenery"


func register_mesh(mi: MeshInstance3D, role: String) -> void:
	var key := str(mi.name)
	if not ed.parts.has(key):
		ed.parts[key] = []
	(ed.parts[key] as Array).append(mi)
	if not ed.roles.has(key):
		var mat_name := ""
		if mi.mesh != null and mi.mesh.get_surface_count() > 0 and mi.mesh.surface_get_material(0) != null:
			mat_name = mi.mesh.surface_get_material(0).resource_name
		ed.roles[key] = role if role != "" else guess_role(key, mat_name)
	if not mi.has_meta("original"):
		mi.set_meta("original", true)
	ed.invalidate_ground()


## A model (a glb) as the track: its ed.parts get the ed.roles of track.json (a part without one of its own: of its parent with a name).
func set_model(root: Node3D, given: Dictionary, unmentioned_scenery: bool) -> void:
	clear_track()
	ed.model_root = root
	ed.track_group.add_child(root)
	for m in root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		var role := ""
		var n: Node = mi
		while n != null and n != root:
			if given.has(str(n.name)):
				role = str(given[str(n.name)])
				break
			n = n.get_parent()
		if role == "" and unmentioned_scenery:
			role = "scenery"
		register_mesh(mi, role)
	apply_colours()
	frame_track()


## The ed.design is the track: its ed.parts are registered with their ed.roles (made again at every change of the ed.road).
func design_parts_changed() -> void:
	if ed.design == null:
		return
	for k in ed.parts.keys():
		var list: Array = ed.parts[k]
		if list.is_empty() or not is_instance_valid(list[0]) or ed.design.is_ancestor_of(list[0]):
			ed.parts.erase(k)
	var r := ed.design.roles()
	for g in [ed.design.road_group, ed.design.branch_group, ed.design.patch_group]:
		for m in g.get_children():
			ed.roles[str(m.name)] = r.get(str(m.name), "scenery")
			register_mesh(m, ed.roles[str(m.name)])
	for g in ed.design.prefab_group.get_children():
		for m in g.get_children():
			ed.roles[str(g.name)] = r.get(str(g.name), "scenery")
			var key := str(g.name)
			if not ed.parts.has(key):
				ed.parts[key] = []
			(ed.parts[key] as Array).append(m)
	ed.invalidate_ground()
	apply_colours()


## The surfaces in their own ed.colours (the Colours check of the ed.view), the ed.chosen part in yellow.
func apply_colours() -> void:
	for key in ed.parts:
		for mi in ed.parts[key]:
			if not is_instance_valid(mi):
				continue
			var m := mi as MeshInstance3D
			if key == ed.selected_part:
				m.material_override = TrackEditorMarkers.flat(Color("ffd04d"), 1.0, false)
			elif ed.colours and TrackEditor.ROLE_COLORS.has(ed.roles.get(key, "")):
				m.material_override = role_material(str(ed.roles[key]))
			else:
				m.material_override = null


static func role_material(role: String) -> Material:
	if not _role_materials.has(role):
		var m := StandardMaterial3D.new()
		m.albedo_color = TrackEditor.ROLE_COLORS[role]
		m.roughness = 1.0
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		if role == "decor":
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.albedo_color.a = 0.12
		if role == "grass" or role == "ground":
			m.render_priority = -1
		_role_materials[role] = m
	return _role_materials[role]


func set_role(part: String, role: String) -> void:
	ed.roles[part] = role
	ed.invalidate_ground()
	apply_colours()
	ed.changed()


# ---- the ed.objects

## The ed.models of the ed.objects where they stand (made again when the list or a model ed.changed, else only moved).
func show_objects() -> void:
	var key := ""
	for o in ed.objects:
		key += str(o["model"]) + "|"
	for m in ed.models.values():
		key += "#%s%s" % [m["name"], m.get("pivot")]
	if ed.object_layer.get_meta("key", "") != key:
		ed.object_layer.set_meta("key", key)
		for c in ed.object_layer.get_children():
			c.free()
		for i in ed.objects.size():
			var o: Dictionary = ed.objects[i]
			var m: Dictionary = ed.models.get(o["model"], {})
			var holder := Node3D.new()
			holder.set_meta("object", i)
			if m.get("scene") != null:
				var copy := (m["scene"] as Node3D).duplicate() as Node3D
				if m.get("pivot") is Vector3:
					copy.position = -(m["pivot"] as Vector3)
				holder.add_child(copy)
			ed.object_layer.add_child(holder)
	for c in ed.object_layer.get_children():
		var o: Dictionary = ed.objects[int(c.get_meta("object"))]
		c.transform = object_transform(o)


static func object_transform(o: Dictionary) -> Transform3D:
	var b := Basis.from_euler(Vector3(float(o.get("pitch", 0)), -float(o["heading"]), float(o.get("roll", 0))), EULER_ORDER_YXZ)
	return Transform3D(b * Basis.from_scale(Vector3(float(o.get("sx", 1)), float(o.get("sy", 1)), float(o.get("sz", 1)))),
		Vector3(float(o["x"]), float(o["y"]), float(o["z"])))


## The box of a placed object in the ed.view (for a click on it and the frame round the ed.chosen one).
func object_box(i: int) -> AABB:
	for c in ed.object_layer.get_children():
		if int(c.get_meta("object")) != i:
			continue
		var box := AABB()
		var first := true
		for m in (c as Node3D).find_children("*", "MeshInstance3D", true, false):
			var b: AABB = (m as MeshInstance3D).global_transform * (m as MeshInstance3D).get_aabb()
			box = b if first else box.merge(b)
			first = false
		if not first:
			return box
	var o: Dictionary = ed.objects[i]
	return AABB(Vector3(o["x"] - 0.5, o["y"], o["z"] - 0.5), Vector3(1, 1, 1))
