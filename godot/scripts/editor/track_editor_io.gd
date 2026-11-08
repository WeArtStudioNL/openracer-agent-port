class_name TrackEditorIO
extends RefCounted
## Opening and saving in the track editor (track-editor.js loadExisting, newTrack, save, exportTrack, takeThumbnail, and the
## height map of heightmap.js): track.json in the format of the browser (the numbers rounded as it rounds them) and its files in
## tracks/<id>/: in the garage of the player (user://garage/tracks/<id>/: it wins over a track of the game with the same id, and
## the files it has not got are taken from the game's folder), or in web/tracks/<id>/ of the repository when that is chosen.
## The command line --editor-out=<folder> saves into <folder>/tracks/<id>/ instead (the tests).

const ID_CHARS := "abcdefghijklmnopqrstuvwxyz0123456789_-"
const LIB_DIR := "user://garage/objects"
const SURFACE_COLOURS := {"road": Color8(128, 128, 128), "sand": Color8(255, 255, 0), "gravel": Color8(255, 255, 255), "mud": Color8(120, 72, 30),
	"grass": Color8(0, 170, 0), "ground": Color8(200, 120, 40)}


static func environment_defaults() -> Dictionary:
	return {"sky_top": "#4a82c4", "sky_horizon": "#d3e4f4", "sky_image": "", "fog": {"enabled": false, "color": "#cfdbe8", "near": 300, "far": 2500},
		"sun": {"azimuth": 40, "elevation": 45, "intensity": 1, "color": "#ffffff"}, "ambient": {"color": "#576777", "intensity": 1}}


static func environment_of(cfg: Dictionary) -> Dictionary:
	var e := environment_defaults()
	var given: Dictionary = cfg.get("environment", {}) if cfg.get("environment") is Dictionary else {}
	for k in ["sky_top", "sky_horizon", "sky_image"]:
		if given.get(k) is String:
			e[k] = given[k]
	for k in ["fog", "sun", "ambient"]:
		if given.get(k) is Dictionary:
			for kk in (e[k] as Dictionary).keys():
				if given[k].has(kk):
					e[k][kk] = given[k][kk]
	return e


static func refresh_list(ed: TrackEditor, select := "") -> void:
	ed.tracks = Content.list_tracks()
	if not ed.ui.has("existing"):
		return
	var o: OptionButton = ed.ui["existing"]
	o.clear()
	o.add_item("—")
	for t in ed.tracks:
		o.add_item("%s (%s)" % [str(t["name"]).trim_suffix("  (garage)"), t["id"]] + ("  · my garage" if t.get("garage", false) else ""))
		if t["id"] == select:
			o.select(o.item_count - 1)


static func slug(text: String) -> String:
	var out := ""
	for ch in text.to_lower():
		out += ch if ID_CHARS.contains(ch) else "-"
	while out.contains("--"):
		out = out.replace("--", "-")
	return out.trim_prefix("-").trim_suffix("-").substr(0, 64)


static func _reset(ed: TrackEditor) -> void:
	if ed.line_edit["editing"]:
		ed.line_edit = {"editing": false, "drawing": false, "nodes": [], "selected": -1, "start": ""}
	ed.sel = {"kind": "", "i": -1, "node": -1}
	ed.mode = "view"
	ed.measure_points.clear()
	ed.drawing = {}
	ed.draft = []
	ed.existing_id = ""
	ed.existing = {}
	ed.loaded_design = ""
	ed.model_source = ""
	ed.model_file = ""
	ed.model_extra = []
	ed.thumbnail = null
	ed.grid = []
	ed.pit_boxes = []
	ed.pit_line = []
	ed.pit_polygon = []
	ed.gates = []
	ed.show_gates = true
	ed.cameras = []
	ed.drag = {}
	ed.objects = []
	ed.models = {}
	ed.object_model = ""
	ed.cam_range = false
	ed.sky_source = ""
	ed.sky_name = ""
	ed.reference = {}
	ed.ref_source = ""
	ed.ref_texture = null
	ed.curbs_kit.reset_curbs([])
	ed.parts_kit.clear_track()


static func new_track(ed: TrackEditor) -> void:
	_reset(ed)
	ed.env = environment_defaults()
	ed.env_on = true
	TrackEditorUI.fill_fields(ed, "", "", "")
	ed.start_design(null)
	apply_env(ed)
	place_reference(ed)
	ed.parts_kit.show_objects()
	ed.history.reset_history()
	ed.history.mark_saved()
	ed.refresh()
	ed.status("A new track: draw it with nodes in the view, or import a model.", "ok")


static func open(ed: TrackEditor, id: String) -> void:
	var cfg: Variant = Content.load_json("tracks/%s/track.json" % id)
	if not (cfg is Dictionary):
		ed.status("Could not load the track “%s”." % id, "error")
		return
	_reset(ed)
	ed.existing_id = id
	ed.existing = (cfg as Dictionary).duplicate(true)
	ed.existing["id"] = id
	TrackEditorUI.fill_fields(ed, str(cfg.get("name", "")), id, str(cfg.get("description", "")))
	ed.env = environment_of(cfg)
	ed.env_on = cfg.has("model") or cfg.has("environment")
	ed.sky_name = str(ed.env.get("sky_image", ""))
	if cfg.get("design") is Dictionary and cfg["design"].get("nodes") is Array:
		ed.start_design(cfg["design"].duplicate(true))
		ed.loaded_design = JSON.stringify(ed.design.to_json())
	elif cfg.has("model"):
		var root := Content.load_model("tracks/%s/%s" % [id, cfg["model"]])
		if root == null:
			ed.status("Could not load the model of this track.", "error")
		else:
			var surfaces: Dictionary = cfg.get("surfaces", {}).get("meshes", {}) if cfg.get("surfaces") is Dictionary else {}
			ed.parts_kit.set_model(root, surfaces, true)
			ed.model_file = str(cfg["model"])
	var box := func(b: Dictionary) -> Dictionary:
		return {"x": float(b["x"]), "y": ed.ground_y(float(b["x"]), float(b["z"])), "z": float(b["z"]), "heading": float(b.get("heading", 0))}
	if cfg.get("grid") is Array and not (cfg["grid"] as Array).is_empty():
		for b in cfg["grid"]:
			if b is Dictionary and b.has("x") and b.has("z") and ed.grid.size() < TrackEditor.GRID_MAX:
				ed.grid.append(box.call(b))
	elif cfg.get("start") is Dictionary:
		ed.grid.append(box.call(cfg["start"]))
	var pit: Dictionary = cfg.get("pit", {}) if cfg.get("pit") is Dictionary else {}
	for b in pit.get("boxes", []):
		if b is Dictionary and b.has("x") and ed.pit_boxes.size() < TrackEditor.GRID_MAX:
			ed.pit_boxes.append(box.call(b))
	for q in pit.get("line", []):
		if q is Array and q.size() >= 2:
			ed.pit_line.append({"x": float(q[0]), "y": ed.ground_y(float(q[0]), float(q[1])), "z": float(q[1])})
	ed.pit_polygon = pit.get("polygon", []).duplicate(true) if pit.get("polygon") is Array else []
	ed.show_gates = bool(cfg.get("show_gates", false))
	for g in cfg.get("gates", []):
		ed.gates.append({"x": float(g["x"]), "y": ed.ground_y(float(g["x"]), float(g["z"]), float(g["y"]) if g.has("y") else INF), "z": float(g["z"]),
			"heading": float(g.get("heading", 0)), "width": float(g.get("width", 24))})
	for c in cfg.get("cameras", []):
		if c is Dictionary and c.has("x") and c.has("z"):
			var cam := {"x": float(c["x"]), "y": float(c["y"]) if c.has("y") else ed.ground_y(float(c["x"]), float(c["z"])) + 3.0, "z": float(c["z"])}
			if c.get("range") is Dictionary and float(c["range"].get("r", 0)) > 0.0:
				cam["range"] = {"x": float(c["range"]["x"]), "z": float(c["range"]["z"]), "r": float(c["range"]["r"])}
			ed.cameras.append(cam)
	_load_objects(ed, id, cfg)
	ed.curbs_kit.reset_curbs(cfg.get("curbs", []))
	if cfg.get("reference") is Dictionary:
		ed.reference = (cfg["reference"] as Dictionary).duplicate()
		var img := Image.load_from_file(Content.path("tracks/%s/%s" % [id, ed.reference.get("image", "")]))
		ed.ref_texture = ImageTexture.create_from_image(img) if img != null and not img.is_empty() else null
	var ds: Variant = cfg.get("dragstrip")
	if ds is Dictionary and ds.has("x"):
		ed.drag = {"x": float(ds["x"]), "y": ed.ground_y(float(ds["x"]), float(ds["z"])), "z": float(ds["z"]), "heading": float(ds.get("heading", 0)),
			"width": float(ds.get("width", 12)), "length": float(ds.get("length", 402.336))}
		TrackEditorUI.show_drag(ed)
	apply_env(ed)
	place_reference(ed)
	ed.parts_kit.show_objects()
	ed.history.reset_history()
	ed.history.mark_saved()
	ed.refresh()
	refresh_list(ed, id)
	ed.status("Changing the track “%s”. Saving overwrites it." % id, "ok")
	RunLog.event("track editor: opened " + id)


static func _load_objects(ed: TrackEditor, id: String, cfg: Dictionary) -> void:
	for spec in cfg.get("objects", []):
		if not (spec is Dictionary) or not spec.has("model") or not spec.has("x"):
			continue
		var file := str(spec["model"])
		if not ed.models.has(file):
			var m := {"name": file, "source": "", "kind": str(spec.get("kind", "decor" if spec.get("rigid", true) == false else "rigid")),
				"mass": float(spec.get("mass", 0)), "pivot": null, "base": null, "scene": Content.load_model("tracks/%s/%s" % [id, file])}
			if spec.get("pivot") is Array and (spec["pivot"] as Array).size() == 3:
				m["pivot"] = Vector3(float(spec["pivot"][0]), float(spec["pivot"][1]), float(spec["pivot"][2]))
			m["base"] = _base_of(m["scene"])
			ed.models[file] = m
		var sc: Variant = spec.get("scale")
		var s3 := [1.0, 1.0, 1.0]
		if sc is float or sc is int:
			s3 = [float(sc), float(sc), float(sc)]
		elif sc is Array and sc.size() == 3:
			s3 = [float(sc[0]), float(sc[1]), float(sc[2])]
		ed.objects.append({"model": file, "x": float(spec["x"]), "y": float(spec["y"]) if spec.has("y") else ed.ground_y(float(spec["x"]), float(spec["z"])),
			"z": float(spec["z"]), "heading": deg_to_rad(float(spec.get("heading", 0))), "pitch": deg_to_rad(float(spec.get("pitch", 0))),
			"roll": deg_to_rad(float(spec.get("roll", 0))), "sx": s3[0], "sy": s3[1], "sz": s3[2]})
	# the objects written by hand (a shape, no model) stay as they are
	ed.set_meta("hand_objects", (cfg.get("objects", []) as Array).filter(func(o: Variant) -> bool: return o is Dictionary and not o.has("model")))


## The middle of the base of a model (where it stands when it is clicked on the road), or null.
static func _base_of(scene: Variant) -> Variant:
	if scene == null:
		return null
	var box := AABB()
	var first := true
	for m in (scene as Node3D).find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		var b := TrackObjects._local_to(mi, scene) * mi.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return null if first else Vector3(box.get_center().x, box.position.y, box.get_center().z)


## A glb picked with + (or a prefab, or a model of the library): in this track, and Place object puts it down.
static func add_model(ed: TrackEditor, path: String, file: String, kind: String, mass: float) -> void:
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	if doc.append_from_file(path, st) != OK:
		ed.status("The file “%s” could not be read as a glb." % path.get_file(), "error")
		return
	var scene := doc.generate_scene(st) as Node3D
	var name := file
	var k := 2
	while ed.models.has(name) and ed.models[name]["source"] != path:
		name = file.trim_suffix(".glb") + "-%d.glb" % k
		k += 1
	var base: Variant = _base_of(scene)
	ed.models[name] = {"name": name, "source": path, "kind": kind, "mass": mass, "pivot": base, "base": base, "scene": scene}
	ed.object_model = name
	ed.set_mode("object")
	ed.status("Placing “%s”: press on the road and drag to say which way it faces. Escape goes back to Look." % name.trim_prefix("obj-").trim_suffix(".glb"), "ok")


## The file name of a model in the folder of a track: obj-<name>.glb.
static func object_file_name(original: String) -> String:
	var base := ""
	for ch in original.get_basename():
		base += ch if ch.is_valid_identifier() or ch in "0123456789.-_ " else "-"
	base = base.lstrip(".-_ ").substr(0, 60)
	return "obj-" + (base if base != "" else "object") + ".glb"


## The models of the library: the game's (web/objects) and the player's own (user://garage/objects): [{ id, name, path, kind, mass, thumb }]
static func library(ed: TrackEditor) -> Array:
	var out: Array = []
	for dir in [Content.root.path_join("objects"), ProjectSettings.globalize_path(LIB_DIR)]:
		var j: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("objects.json"))) if FileAccess.file_exists(dir.path_join("objects.json")) else null
		if j is Dictionary:
			for e in j.get("objects", []):
				if e is Dictionary and e.has("file"):
					out.append({"id": e.get("id", ""), "name": e.get("name", e["file"]), "path": dir.path_join(e["file"]), "kind": e.get("kind", "rigid"),
						"mass": float(e.get("mass", 0)), "thumb": dir.path_join(str(e.get("thumb", "")))})
	ed.set_meta("library", out)
	return out


## A glb that is added with +: in the player's library (with the others: the same in every track) and in this track.
static func add_to_library(ed: TrackEditor, path: String) -> void:
	var dir := ProjectSettings.globalize_path(LIB_DIR)
	DirAccess.make_dir_recursive_absolute(dir)
	var id := slug(path.get_file().get_basename())
	if id == "":
		id = "object"
	DirAccess.copy_absolute(path, dir.path_join(id + ".glb"))
	var j: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("objects.json"))) if FileAccess.file_exists(dir.path_join("objects.json")) else null
	var list: Array = j.get("objects", []) if j is Dictionary else []
	list = list.filter(func(e: Dictionary) -> bool: return e.get("id") != id)
	var entry := {"id": id, "name": id, "file": id + ".glb", "thumb": "", "kind": "rigid", "mass": 0}
	list.append(entry)
	var f := FileAccess.open(dir.path_join("objects.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify({"objects": list}, " "))
	f.close()
	add_model(ed, dir.path_join(id + ".glb"), object_file_name(id), "rigid", 0.0)
	# its picture next to it (keepInLibrary: <id>.webp), as soon as it is drawn
	var glb := dir.path_join(id + ".glb")
	ed.thumbs.request(glb, func() -> Node3D: return ModelThumbs.load_glb(glb), func(tex: Texture2D):
		if tex == null or tex.get_image().save_webp(dir.path_join(id + ".webp"), false, 0.9) != OK:
			return
		var now: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("objects.json")))
		if now is Dictionary:
			for e in now.get("objects", []):
				if e is Dictionary and e.get("id") == id:
					e["thumb"] = id + ".webp"
			var w := FileAccess.open(dir.path_join("objects.json"), FileAccess.WRITE)
			w.store_string(JSON.stringify(now, " "))
			w.close()
		library(ed))


## A prefab of the designer as an object of a track with a model: its glb (with the texture chosen) in a folder of its own.
static func use_prefab(ed: TrackEditor, type: String, texture: String) -> void:
	var file := "obj-prefab-%s%s.glb" % [type, "-" + texture if texture != "" else ""]
	if ed.models.has(file):
		ed.object_model = file
		ed.set_mode("object")
		return
	var dir := OS.get_temp_dir().path_join("oracer-editor")
	DirAccess.make_dir_recursive_absolute(dir)
	var root := Node3D.new()
	var g := DesignPrefabs.make(type, texture)
	g.name = "prefab_" + type
	root.add_child(g)
	var doc := GLTFDocument.new()
	doc.image_format = "JPEG"
	var st := GLTFState.new()
	doc.append_from_scene(root, st)
	var path := dir.path_join(file)
	doc.write_to_filesystem(st, path)
	root.free()
	add_model(ed, path, file, "static" if DesignPrefabs.role(type) == "scenery" else "decor", 0.0)


# ---- the sky and the light (the view of the editor)

static func apply_env(ed: TrackEditor) -> void:
	var e := ed.env
	var sky_mat := ProceduralSkyMaterial.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	if ed.env_on:
		sky_mat.sky_top_color = Color(str(e["sky_top"]))
		sky_mat.sky_horizon_color = Color(str(e["sky_horizon"]))
		var img_path := ed.sky_source if ed.sky_source != "" else (Content.path("tracks/%s/%s" % [ed.existing_id, ed.sky_name]) if ed.sky_name != "" else "")
		if img_path != "" and FileAccess.file_exists(img_path):
			var pano := PanoramaSkyMaterial.new()
			pano.panorama = ImageTexture.create_from_image(Image.load_from_file(img_path))
			env.sky = Sky.new()
			env.sky.sky_material = pano
		ed.sun.light_color = Color(str(e["sun"]["color"]))
		ed.sun.light_energy = 1.2 * float(e["sun"]["intensity"])
		ed.sun.rotation = Vector3(-deg_to_rad(float(e["sun"]["elevation"])), deg_to_rad(90.0 - float(e["sun"]["azimuth"])), 0)
		env.ambient_light_color = Color(str(e["ambient"]["color"]))
		env.ambient_light_energy = 0.9 * float(e["ambient"]["intensity"]) + 0.2
	else:
		sky_mat.sky_top_color = Color("20262f")
		sky_mat.sky_horizon_color = Color("20262f")
		ed.sun.light_color = Color.WHITE
		ed.sun.light_energy = 1.4
		ed.sun.rotation = Vector3(-0.9, 0.6, 0)
		env.ambient_light_energy = 1.1
	sky_mat.ground_horizon_color = sky_mat.sky_horizon_color
	sky_mat.ground_bottom_color = Color(0.25, 0.27, 0.25)
	if env.sky == null:
		env.sky = Sky.new()
		env.sky.sky_material = sky_mat
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 0.6
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	ed.world_env.environment = env


# ---- the reference image: a picture lying flat in the view to draw the track over

static func place_reference(ed: TrackEditor) -> void:
	if ed.ref_mesh != null:
		ed.ref_mesh.free()
		ed.ref_mesh = null
	var r := ed.reference
	if r.is_empty() or ed.ref_texture == null or not r.get("show", true):
		return
	var w := float(r.get("width", 500))
	var aspect := float(ed.ref_texture.get_height()) / maxf(1.0, ed.ref_texture.get_width())
	var pm := PlaneMesh.new()
	pm.size = Vector2(w, w * aspect)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_texture = ed.ref_texture
	m.albedo_color = Color(1, 1, 1, float(r.get("opacity", 0.5)))
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.no_depth_test = bool(r.get("top", true))
	m.render_priority = 1
	ed.ref_mesh = MeshInstance3D.new()
	ed.ref_mesh.mesh = pm
	ed.ref_mesh.material_override = m
	ed.ref_mesh.position = Vector3(float(r.get("x", 0)), float(r.get("y", 0)), float(r.get("z", 0)))
	ed.ref_mesh.rotation.y = -deg_to_rad(float(r.get("rotation", 0)))
	ed.view.add_child(ed.ref_mesh)


static func pick_reference(ed: TrackEditor, path: String) -> void:
	var img := Image.load_from_file(path)
	if img == null or img.is_empty():
		ed.status("The picture could not be read.", "error")
		return
	ed.ref_source = path
	ed.ref_texture = ImageTexture.create_from_image(img)
	var box := ed.parts_kit.drive_box()
	var c := box.get_center() if box.size != Vector3.ZERO else ed.target
	ed.reference = {"image": "reference." + path.get_extension().to_lower().replace("jpeg", "jpg"), "x": TrackDesign.r2(c.x), "y": TrackDesign.r2(c.y - 0.2),
		"z": TrackDesign.r2(c.z), "width": maxf(50.0, roundf(maxf(box.size.x, box.size.z) * 1.3)) if box.size != Vector3.ZERO else 500.0, "rotation": 0,
		"opacity": 0.5, "show": true, "top": true}
	place_reference(ed)
	ed.changed()


## Scale by two points: two clicks on the picture whose distance is known, then the distance.
static func ref_scale_click(ed: TrackEditor, pos: Vector2) -> void:
	var r := ed.ray_of(pos)
	var p: Variant = Plane(Vector3.UP, float(ed.reference.get("y", 0))).intersects_ray(r[0], r[1])
	if p == null:
		return
	ed.measure_points.append(p)
	ed.refresh()
	if ed.measure_points.size() < 2:
		ed.status("Click the second point on the picture.", "ok")
		return
	var a: Vector3 = ed.measure_points[0]
	var b: Vector3 = ed.measure_points[1]
	var now := Vector2(a.x - b.x, a.z - b.z).length()
	TrackEditorUI.ask_number(ed, "Scale by two points", "The distance between the two points in metres (it is %.1f m now)." % now, now, func(v: float):
		if v > 0.0 and now > 0.0:
			var k := v / now
			var rr := ed.reference
			rr["width"] = TrackDesign.r2(float(rr["width"]) * k)
			rr["x"] = TrackDesign.r2(a.x + (float(rr["x"]) - a.x) * k)
			rr["z"] = TrackDesign.r2(a.z + (float(rr["z"]) - a.z) * k)
			place_reference(ed)
		ed.measure_points.clear()
		ed.mode = "view"
		ed.changed())


# ---- a model that is imported

static func import_model(ed: TrackEditor, path: String) -> void:
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	st.base_path = path.get_base_dir()
	if doc.append_from_file(path, st) != OK:
		ed.status("Could not read the model %s." % path.get_file(), "error")
		return
	var root := doc.generate_scene(st) as Node3D
	var kept := ed.roles.duplicate() if ed.model_root != null else {}
	ed.parts_kit.set_model(root, kept, false)
	ed.model_source = path
	ed.model_file = path.get_file()
	ed.model_extra = []
	if path.get_extension().to_lower() == "gltf":
		var j: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
		if j is Dictionary:
			for item in (j.get("images", []) as Array) + (j.get("buffers", []) as Array):
				if item is Dictionary and str(item.get("uri", "")) != "" and not str(item["uri"]).begins_with("data:"):
					ed.model_extra.append(path.get_base_dir().path_join(str(item["uri"]).uri_decode()))
	ed.snap_to_surface()
	ed.refresh()
	ed.status("Model loaded: %d parts. Save the track to keep it." % ed.parts.size(), "ok")


# ---- saving

static func target_dir(ed: TrackEditor, id: String) -> String:
	var out: String = ed.get_meta("out", Content.arg("editor-out"))
	if out != "":
		return out.path_join("tracks").path_join(id)
	if ed.save_to_repo and repo_writable():
		return Content.root.path_join("tracks").path_join(id)
	return ProjectSettings.globalize_path("user://garage/tracks").path_join(id)


## Whether the game runs from the repository (web/ next to godot/): a track can then be saved into web/tracks.
static func repo_writable() -> bool:
	return Content.root != "" and Content.root == ProjectSettings.globalize_path("res://").path_join("../web").simplify_path()


static func _r(v: float, digits: int) -> float:
	var k := pow(10.0, digits)
	return roundf(v * k) / k


static func _copy(from: String, to: String) -> Error:
	if from == "" or not FileAccess.file_exists(from):
		return ERR_FILE_NOT_FOUND
	if from.simplify_path() == to.simplify_path():
		return OK
	return DirAccess.copy_absolute(from, to)


## The file of the track that is open (in the garage or the game), for a file that is not new.
static func old_file(ed: TrackEditor, file: String) -> String:
	return Content.path("tracks/%s/%s" % [ed.existing_id, file]) if ed.existing_id != "" else ""


static func save(ed: TrackEditor) -> bool:
	var name := str(ed.ui["name"].text).strip_edges()
	var id := str(ed.ui["id"].text).strip_edges()
	if id == "":
		id = slug(name)
	if name == "":
		ed.status("Give the track a name.", "error")
		return false
	if id != slug(id) or id == "":
		ed.status("The id may only have lower case letters, digits, - and _.", "error")
		return false
	if ed.grid.is_empty():
		ed.status("Place box 1 of the grid on the road: it is the start of the track.", "error")
		return false
	if ed.model_root == null and ed.design == null:
		ed.status("Import a model first, or draw the track with nodes.", "error")
		return false
	if ed.design != null and (ed.design.data["nodes"] as Array).size() < 3:
		ed.status("A track needs at least three nodes.", "error")
		return false
	var dir := target_dir(ed, id)
	DirAccess.make_dir_recursive_absolute(dir)
	var old := ed.existing
	var same := id == ed.existing_id
	var config: Dictionary = old.duplicate(true) if not old.is_empty() else {}
	if not old.is_empty() and not same and ed.design == null and ed.model_source != "":
		config.erase("racing_line")
		config.erase("skidpad")
	config.erase("id")
	config["name"] = name
	config["description"] = str(ed.ui["description"].text).strip_edges()
	var s: Dictionary = ed.grid[0]
	config["start"] = {"x": _r(s["x"], 3), "z": _r(s["z"], 3), "heading": _r(s["heading"], 5)}
	config["grid"] = ed.grid.map(func(b: Dictionary) -> Dictionary: return {"x": _r(b["x"], 3), "z": _r(b["z"], 3), "heading": _r(b["heading"], 5)})
	var pit := {}
	if not ed.pit_boxes.is_empty():
		pit["boxes"] = ed.pit_boxes.map(func(b: Dictionary) -> Dictionary: return {"x": _r(b["x"], 3), "z": _r(b["z"], 3), "heading": _r(b["heading"], 5)})
	if ed.pit_polygon.size() >= 3:
		pit["polygon"] = ed.pit_polygon
	if ed.pit_line.size() >= 2:
		pit["line"] = ed.pit_line.map(func(q: Dictionary) -> Array: return [_r(q["x"], 2), _r(q["z"], 2)])
	if pit.is_empty():
		config.erase("pit")
	else:
		config["pit"] = pit
	if not ed.gates.is_empty():
		config["gates"] = ed.gates.map(func(g: Dictionary) -> Dictionary:
			return {"x": _r(g["x"], 3), "z": _r(g["z"], 3), "heading": _r(g["heading"], 5), "width": g["width"], "y": _r(g["y"], 2)})
		if ed.show_gates:
			config["show_gates"] = true
		else:
			config.erase("show_gates")
		config.erase("checkpoints")
	else:
		config.erase("gates")
	if not ed.cameras.is_empty():
		config["cameras"] = ed.cameras.map(func(c: Dictionary) -> Dictionary:
			var o := {"x": _r(c["x"], 2), "y": _r(c["y"], 2), "z": _r(c["z"], 2)}
			if c.get("range") is Dictionary:
				o["range"] = {"x": _r(c["range"]["x"], 2), "z": _r(c["range"]["z"], 2), "r": _r(c["range"]["r"], 1)}
			return o)
	else:
		config.erase("cameras")
	var curbs := ed.curbs_kit.curbs_json()
	if curbs.is_empty():
		config.erase("curbs")
	else:
		config["curbs"] = curbs
	if not ed.drag.is_empty():
		var d := ed.drag
		config["dragstrip"] = {"x": _r(d["x"], 3), "z": _r(d["z"], 3), "heading": _r(d["heading"], 5), "width": d["width"], "length": _r(d["length"], 2)}
	else:
		config.erase("dragstrip")
	# the model: the glb of the design, a model that was imported, or the one of the track (copied when the id is new)
	var old_model := str(old.get("model", ""))
	if ed.design != null:
		ed.status("Making the model of the track…")
		var file := id + ".glb"
		var err := ed.design.export_glb(dir.path_join(file))
		if err != OK:
			ed.status("The model of the track could not be written (%s)." % error_string(err), "error")
			return false
		config["model"] = file
		config["design"] = ed.design.to_json()
		if same and old_model != "" and old_model != file:
			_remove_old(dir, old_model)
	elif ed.model_source != "":
		config.erase("design")
		if _copy(ed.model_source, dir.path_join(ed.model_file)) != OK:
			ed.status("The model could not be copied into the track.", "error")
			return false
		for extra in ed.model_extra:
			_copy(extra, dir.path_join(extra.get_file()))
		config["model"] = ed.model_file
		if same and old_model != "" and old_model != ed.model_file:
			_remove_old(dir, old_model)
	elif not same and old_model != "":
		_copy(old_file(ed, old_model), dir.path_join(old_model))
	for k in ["geometry", "scene", "textures"]:
		config.erase(k)
	# the objects: their models go in the folder of the track; the objects written by hand (no model) stay
	var made: Array = ed.get_meta("hand_objects", []).duplicate(true)
	for o in ed.objects:
		var m: Dictionary = ed.models.get(o["model"], {})
		if m.is_empty():
			continue
		var spec := {"model": m["name"], "x": _r(o["x"], 3), "z": _r(o["z"], 3), "y": _r(o["y"], 3), "heading": _r(rad_to_deg(o["heading"]), 2)}
		if m.get("pivot") is Vector3:
			var p: Vector3 = m["pivot"]
			spec["pivot"] = [_r(p.x, 4), _r(p.y, 4), _r(p.z, 4)]
		if absf(o.get("pitch", 0.0)) > 1e-4:
			spec["pitch"] = _r(rad_to_deg(o["pitch"]), 2)
		if absf(o.get("roll", 0.0)) > 1e-4:
			spec["roll"] = _r(rad_to_deg(o["roll"]), 2)
		var sc := [_r(o["sx"], 4), _r(o["sy"], 4), _r(o["sz"], 4)]
		if absf(sc[0] - 1) > 1e-4 or absf(sc[1] - 1) > 1e-4 or absf(sc[2] - 1) > 1e-4:
			spec["scale"] = sc[0] if sc[0] == sc[1] and sc[1] == sc[2] else sc
		var kind := str(m.get("kind", "rigid"))
		if kind == "rigid":
			if float(m.get("mass", 0)) > 0.0:
				spec["mass"] = m["mass"]
		else:
			spec["kind"] = kind
			if kind == "decor":
				spec["rigid"] = false
		made.append(spec)
	for m in ed.models.values():
		if not ed.objects.any(func(o: Dictionary) -> bool: return o["model"] == m["name"]):
			continue
		var to: String = dir.path_join(m["name"])
		_copy(m["source"] if m["source"] != "" else old_file(ed, m["name"]), to)
	if made.is_empty():
		config.erase("objects")
	else:
		config["objects"] = made
	# the road changed under the same id: the laps of the old road are no longer the line of the AI
	var line_of_old_road := false
	if not old.is_empty() and same:
		var new_model := ed.design == null and ed.model_source != ""
		if new_model:
			config.erase("racing_line")
		if new_model or (config.has("design") and ed.loaded_design != JSON.stringify(config["design"])):
			config["line_date"] = Time.get_datetime_string_from_system(true) + "Z"
			config["road_date"] = config["line_date"]
			line_of_old_road = (config.get("racing_line", []) as Array).size() > 0
	if ed.env_on:
		var e := ed.env.duplicate(true)
		if ed.sky_source != "":
			_copy(ed.sky_source, dir.path_join(ed.sky_source.get_file()))
			e["sky_image"] = ed.sky_source.get_file()
		elif ed.sky_name != "":
			if not same:
				_copy(old_file(ed, ed.sky_name), dir.path_join(ed.sky_name))
			e["sky_image"] = ed.sky_name
		else:
			e.erase("sky_image")
		config["environment"] = e
	else:
		config.erase("environment")
	var meshes := {}
	for k in ed.roles:
		if ed.roles[k] != "scenery" and k != "":
			meshes[k] = ed.roles[k]
	config["surfaces"] = {"meshes": meshes}
	if not ed.reference.is_empty():
		if ed.ref_source != "":
			_copy(ed.ref_source, dir.path_join(ed.reference["image"]))
		elif not same:
			_copy(old_file(ed, ed.reference["image"]), dir.path_join(ed.reference["image"]))
		config["reference"] = ed.reference
	else:
		config.erase("reference")
	if ed.thumbnail != null:
		ed.thumbnail.save_webp(dir.path_join("preview.webp"), true, 0.86)
	elif not same and FileAccess.file_exists(old_file(ed, "preview.webp")):
		_copy(old_file(ed, "preview.webp"), dir.path_join("preview.webp"))
	var f := FileAccess.open(dir.path_join("track.json"), FileAccess.WRITE)
	if f == null:
		ed.status("track.json could not be written in %s." % dir, "error")
		return false
	f.store_string(JSON.stringify(config, "  ", false))
	f.close()
	if dir.begins_with(Content.root.path_join("tracks")) and not ed.has_meta("out") and Content.arg("editor-out") == "":
		_add_to_index(id)
	ed.existing_id = id
	ed.existing = config.duplicate(true)
	ed.existing["id"] = id
	ed.loaded_design = JSON.stringify(config.get("design")) if config.has("design") else ""
	ed.model_source = ""
	ed.sky_source = ""
	ed.sky_name = str(config.get("environment", {}).get("sky_image", ""))
	ed.ref_source = ""
	ed.thumbnail = null
	for m in ed.models.values():
		m["source"] = ""
	refresh_list(ed, id)
	var missing: Array[String] = []
	var special: bool = config.has("skidpad") or (config.has("dragstrip") and not config.has("gates"))
	if not special and not config.has("gates"):
		missing.append("no gates: no lap counts (put gate 1 on the start line)")
	if not special and (config.get("racing_line", []) as Array).size() <= 10 and not config.has("design"):
		missing.append("no racing line: the AI cannot race here")
	if line_of_old_road:
		missing.append("the racing line was made on the road as it was: draw it again, or edit it to the new road")
	var where := "in the repository (web/tracks/%s)" % id if dir.begins_with(Content.root) else "in your garage"
	if ed.has_meta("out") or Content.arg("editor-out") != "":
		where = "in " + dir
	ed.status("Saved %s. It is in the main menu of the game now." % where + ("  Still to do: " + "; ".join(missing) + "." if not missing.is_empty() else ""),
		"warn" if not missing.is_empty() else "ok")
	RunLog.event("track editor: saved %s in %s" % [id, dir])
	ed.history.mark_saved()
	ed.refresh()
	return true


static func _remove_old(dir: String, file: String) -> void:
	if FileAccess.file_exists(dir.path_join(file)):
		DirAccess.remove_absolute(dir.path_join(file))


static func _add_to_index(id: String) -> void:
	var p := Content.root.path_join("tracks/index.json")
	var j: Variant = JSON.parse_string(FileAccess.get_file_as_string(p))
	if j is Array and not (j as Array).has(id):
		(j as Array).append(id)
		var f := FileAccess.open(p, FileAccess.WRITE)
		f.store_string(JSON.stringify(j, "  ") + "\n")
		f.close()


## Writes the racing line (or no line) into the saved track at once (the line is not a part of an unsaved change).
static func store_line(ed: TrackEditor, line: Variant) -> bool:
	if ed.existing_id == "":
		ed.status("Save the track first: the line is saved on the saved track.", "error")
		return false
	var dir := target_dir(ed, ed.existing_id)
	DirAccess.make_dir_recursive_absolute(dir)
	var config := ed.existing.duplicate(true)
	config.erase("id")
	if line == null:
		config.erase("racing_line")
	else:
		config["racing_line"] = line
		config["line_date"] = Time.get_datetime_string_from_system(true) + "Z"
	var f := FileAccess.open(dir.path_join("track.json"), FileAccess.WRITE)
	if f == null:
		ed.status("track.json could not be written.", "error")
		return false
	f.store_string(JSON.stringify(config, "  ", false))
	f.close()
	ed.existing = config
	ed.existing["id"] = ed.existing_id
	return true


static func delete_track(ed: TrackEditor) -> void:
	var id := ed.existing_id
	if id == "" or not Garage.ids("tracks").has(id):
		ed.status("Only a track of your garage can be deleted here.", "warn")
		return
	TrackEditorUI.ask(ed, "Delete the track “%s”?" % id, "With all its files (they go to the trash).", "Delete", func():
		Garage.remove("tracks", id)
		refresh_list(ed)
		new_track(ed)
		ed.status("Deleted from your garage.", "ok"))


## The saved track as a zip to share: track.json and its files (the Garage of the main menu imports it).
static func export_zip(ed: TrackEditor, path: String) -> void:
	if ed.existing_id == "" or ed.history.unsaved():
		ed.status("Save the track first: the zip is made of the saved track.", "error")
		return
	var id := ed.existing_id
	var files := {"track.json": Content.path("tracks/%s/track.json" % id)}
	var cfg := ed.existing
	var names: Array = [cfg.get("model", ""), "preview.webp", cfg.get("environment", {}).get("sky_image", ""), cfg.get("reference", {}).get("image", "")]
	for o in cfg.get("objects", []):
		names.append(o.get("model", ""))
	for n in names:
		if str(n) != "" and FileAccess.file_exists(Content.path("tracks/%s/%s" % [id, n])):
			files[str(n)] = Content.path("tracks/%s/%s" % [id, n])
	var zip := ZIPPacker.new()
	if zip.open(path) != OK:
		ed.status("The zip could not be written.", "error")
		return
	for n in files:
		zip.start_file(id + "/" + n)
		zip.write_file(FileAccess.get_file_as_bytes(files[n]))
		zip.close_file()
	zip.close()
	ed.status("Exported %s (%d files)." % [path.get_file(), files.size()], "ok")


## The picture of the track for the menu: the view as the game shows it (no markers, the textures of the surfaces), 640 by 360.
static func take_thumbnail(ed: TrackEditor) -> void:
	if ed.model_root == null and ed.design == null:
		ed.status("Load or draw a track first.", "error")
		return
	var was := ed.colours
	ed.colours = false
	ed.parts_kit.apply_colours()
	ed.markers.visible = false
	ed.markers.overlay.visible = false
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var img := ed.view.get_texture().get_image()
	ed.markers.visible = true
	ed.markers.overlay.visible = true
	ed.colours = was
	ed.parts_kit.apply_colours()
	var w := img.get_width()
	var h := img.get_height()
	var cw := w
	var ch := roundi(w / (16.0 / 9.0))
	if ch > h:
		ch = h
		cw = roundi(h * 16.0 / 9.0)
	img = img.get_region(Rect2i((w - cw) / 2, (h - ch) / 2, cw, ch))
	img.resize(640, 360, Image.INTERPOLATE_LANCZOS)
	ed.thumbnail = img
	ed.status("Thumbnail taken (640 x 360): it is saved with the track.", "ok")
	ed.refresh()


# ---- a track from a height map (heightmap.js): a mesh of the heights with the colour map as its texture, as a glb

## The first channel of a picture as heights 0 to 65535: a PNG of 16 bits is read as it is (Godot makes it 8 bits).
static func read_heights(path: String) -> Dictionary:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.size() > 33 and bytes.slice(0, 8) == PackedByteArray([137, 80, 78, 71, 13, 10, 26, 10]):
		var png := _decode_png(bytes)
		if not png.is_empty():
			return png
	var img := Image.load_from_file(path)
	if img == null or img.is_empty():
		return {}
	img.convert(Image.FORMAT_RGBA8)
	var data := PackedInt32Array()
	data.resize(img.get_width() * img.get_height())
	var raw := img.get_data()
	for i in data.size():
		data[i] = raw[i * 4] * 257
	return {"width": img.get_width(), "height": img.get_height(), "data": data, "depth": 8}


static func _decode_png(bytes: PackedByteArray) -> Dictionary:
	var at := 8
	var w := 0
	var h := 0
	var depth := 0
	var ctype := 0
	var idat := PackedByteArray()
	while at + 8 <= bytes.size():
		var n := (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]
		var t := bytes.slice(at + 4, at + 8).get_string_from_ascii()
		if t == "IHDR":
			w = (bytes[at + 8] << 24) | (bytes[at + 9] << 16) | (bytes[at + 10] << 8) | bytes[at + 11]
			h = (bytes[at + 12] << 24) | (bytes[at + 13] << 16) | (bytes[at + 14] << 8) | bytes[at + 15]
			depth = bytes[at + 16]
			ctype = bytes[at + 17]
			if bytes[at + 20] != 0 or ctype == 3:
				return {}
		elif t == "IDAT":
			idat.append_array(bytes.slice(at + 8, at + 8 + n))
		elif t == "IEND":
			break
		at += 12 + n
	var channels: int = {0: 1, 2: 3, 4: 2, 6: 4}.get(ctype, 0)
	if channels == 0 or w == 0 or (depth != 8 and depth != 16):
		return {}
	var bpp := channels * depth / 8
	var stride := w * bpp
	var raw := idat.decompress_dynamic((stride + 1) * h + 16, FileAccess.COMPRESSION_DEFLATE)
	if raw.size() < (stride + 1) * h:
		return {}
	var rows := PackedByteArray()
	rows.resize(stride * h)
	for y in h:
		var filter := raw[y * (stride + 1)]
		var src := y * (stride + 1) + 1
		var dst := y * stride
		for x in stride:
			var v := raw[src + x]
			var left := rows[dst + x - bpp] if x >= bpp else 0
			var up := rows[dst - stride + x] if y > 0 else 0
			var ul := rows[dst - stride + x - bpp] if x >= bpp and y > 0 else 0
			match filter:
				1:
					v += left
				2:
					v += up
				3:
					v += (left + up) >> 1
				4:
					var p := left + up - ul
					var pa := absi(p - left)
					var pb := absi(p - up)
					var pc := absi(p - ul)
					v += left if pa <= pb and pa <= pc else (up if pb <= pc else ul)
			rows[dst + x] = v & 255
	var data := PackedInt32Array()
	data.resize(w * h)
	for y in h:
		for x in w:
			var i := y * stride + x * bpp
			data[y * w + x] = (rows[i] << 8) | rows[i + 1] if depth == 16 else rows[i] * 257
	return {"width": w, "height": h, "data": data, "depth": depth}


## The terrain of a height map as a glb in a folder of its own, and the roles of its parts; opts: size, top, step, role, colour, surface.
static func build_terrain(height_path: String, opts: Dictionary) -> Dictionary:
	var map := read_heights(height_path)
	if map.is_empty():
		return {"error": "The height map could not be read."}
	var size := maxf(10.0, float(opts.get("size", map["width"])))
	var top := float(opts.get("top", 60.0))
	var step := maxi(1, int(opts.get("step", 4)))
	var mw: int = map["width"]
	var mh: int = map["height"]
	var nx := maxi(2, (mw - 1) / step + 1)
	var nz := maxi(2, (mh - 1) / step + 1)
	if nx * nz > 600 * 600:
		return {"error": "That is too many points (%d × %d). Take a bigger step." % [nx, nz]}
	var depth_size := size * mh / mw
	var data: PackedInt32Array = map["data"]
	var sample := func(px: float, py: float) -> float:
		var x0 := mini(mw - 1, floori(px))
		var y0 := mini(mh - 1, floori(py))
		var x1 := mini(mw - 1, x0 + 1)
		var y1 := mini(mh - 1, y0 + 1)
		var fx := px - x0
		var fy := py - y0
		return ((data[y0 * mw + x0] * (1 - fx) + data[y0 * mw + x1] * fx) * (1 - fy) + (data[y1 * mw + x0] * (1 - fx) + data[y1 * mw + x1] * fx) * fy) / 65535.0
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	for j in nz:
		for i in nx:
			var u := float(i) / (nx - 1)
			var v := float(j) / (nz - 1)
			verts.append(Vector3((u - 0.5) * size, sample.call(u * (mw - 1), v * (mh - 1)) * top, (v - 0.5) * depth_size))
			uvs.append(Vector2(u, v))
	var surf: Image = null
	if str(opts.get("surface", "")) != "":
		surf = Image.load_from_file(opts["surface"])
	var cells := {}
	for j in nz - 1:
		for i in nx - 1:
			var role := "all"
			if surf != null:
				var c := surf.get_pixel(mini(surf.get_width() - 1, floori((i + 0.5) / (nx - 1) * surf.get_width())),
					mini(surf.get_height() - 1, floori((j + 0.5) / (nz - 1) * surf.get_height())))
				var best := INF
				for r in SURFACE_COLOURS:
					var sc: Color = SURFACE_COLOURS[r]
					var d := (c.r - sc.r) ** 2 + (c.g - sc.g) ** 2 + (c.b - sc.b) ** 2
					if d < best:
						best = d
						role = r
			var a := j * nx + i
			if not cells.has(role):
				cells[role] = PackedInt32Array()
			(cells[role] as PackedInt32Array).append_array([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1])
	var mat := StandardMaterial3D.new()
	mat.resource_name = "terrain"
	mat.roughness = 1.0
	if str(opts.get("colour", "")) != "":
		var ci := Image.load_from_file(opts["colour"])
		if ci != null and not ci.is_empty():
			mat.albedo_texture = ImageTexture.create_from_image(ci)
	else:
		mat.albedo_color = Color("8a9a78")
	var root := Node3D.new()
	var roles := {}
	for role in cells:
		var mi := MeshInstance3D.new()
		mi.name = "terrain" if role == "all" else "terrain_" + role
		mi.mesh = MeshKit.build(verts, uvs, cells[role], mat)
		root.add_child(mi)
		roles[str(mi.name)] = str(opts.get("role", "road")) if role == "all" else role
	var dir := OS.get_temp_dir().path_join("oracer-editor")
	DirAccess.make_dir_recursive_absolute(dir)
	var path := dir.path_join("terrain.glb")
	var doc := GLTFDocument.new()
	doc.image_format = "JPEG"
	doc.root_node_mode = GLTFDocument.ROOT_NODE_MODE_MULTI_ROOT
	var st := GLTFState.new()
	doc.append_from_scene(root, st)
	var err := doc.write_to_filesystem(st, path)
	root.free()
	if err != OK:
		return {"error": "The terrain could not be made (%s)." % error_string(err)}
	var tris := 0
	for c in cells.values():
		tris += (c as PackedInt32Array).size() / 3
	return {"path": path, "roles": roles, "grid": [nx, nz], "triangles": tris, "size": [size, depth_size]}


static func make_from_height_map(ed: TrackEditor, height_path: String, opts: Dictionary) -> void:
	var r := build_terrain(height_path, opts)
	if r.has("error"):
		ed.status(r["error"], "error")
		return
	new_track(ed)
	ed.parts_kit.clear_track()
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	doc.append_from_file(r["path"], st)
	ed.parts_kit.set_model(doc.generate_scene(st) as Node3D, r["roles"], false)
	ed.model_source = r["path"]
	ed.model_file = "terrain.glb"
	ed.history.reset_history()
	ed.refresh()
	ed.status("The height map is a mesh of %d × %d points (%d triangles), %d × %d m. Place the start on it, add gates and save." % [r["grid"][0], r["grid"][1],
		r["triangles"], roundi(r["size"][0]), roundi(r["size"][1])], "ok")


# ---- ready to race: what the game needs, checked while you work

static func ready_items(ed: TrackEditor) -> Array:
	var items: Array = []
	var add := func(ok: bool, text: String, warn := false) -> void: items.append(["ok" if ok else ("warn" if warn else "bad"), text])
	var name := str(ed.ui["name"].text).strip_edges() if ed.ui.has("name") else ""
	add.call(name != "", "Name: " + name if name != "" else "No name yet (Track card)")
	var road := ed.model_root != null or ed.design != null
	add.call(road, "A road: " + ("drawn with nodes" if ed.design != null else "a model") if road else "No road: import a model or draw it with nodes")
	add.call(not ed.grid.is_empty(), "Start: box 1 of the grid" if not ed.grid.is_empty() else "No start: place box 1 with Grid box (2)")
	add.call(ed.grid.size() >= TrackEditor.GRID_MAX, "%d of 8 grid boxes" % ed.grid.size() + ("" if ed.grid.size() >= 8 else " (the opponents need boxes 2 to 8: " +
		"Fill the grid)"), true)
	var special: bool = ed.existing.has("skidpad") or (not ed.drag.is_empty() and ed.gates.is_empty())
	if not special:
		add.call(ed.gates.size() >= 2, "%d gates" % ed.gates.size() if not ed.gates.is_empty() else "No gates: no lap is counted (Add gate, or Auto gates)")
		if not ed.gates.is_empty() and not ed.grid.is_empty():
			var d := Vector2(ed.gates[0]["x"] - ed.grid[0]["x"], ed.gates[0]["z"] - ed.grid[0]["z"]).length()
			add.call(d < 150.0, ("Gate 1 (the finish line) is %d m in front of the start" if d < 150.0 else "Gate 1 (the finish line) is %d m from the start: is " +
				"that right?") % roundi(d), true)
		var line := ed.line.line_source()
		add.call(not line.is_empty(), "A racing line for the AI" if not line.is_empty() else "No racing line: the AI cannot race (draw one)")
		if not line.is_empty() and ed.gates.size() >= 2:
			var index: Array = []
			for g in ed.gates:
				var n := 0
				var b := INF
				for i in line.size():
					var dd := Vector2(float(line[i]["x"]) - g["x"], float(line[i]["z"]) - g["z"]).length()
					if dd < b:
						b = dd
						n = i
				index.append([n, b, g["width"]])
			var off := index.filter(func(e: Array) -> bool: return e[1] > e[2] / 2.0 + 2.0).size()
			add.call(off == 0, "The line goes through every gate" if off == 0 else "%d gate%s not on the racing line" % [off, "s are" if off > 1 else " is"], true)
			var turns := 0
			for i in range(1, index.size()):
				if index[i][0] < index[i - 1][0]:
					turns += 1
			add.call(turns <= 1, "The gates are in the order of the line" if turns <= 1 else "The gates are not in the order that the line passes them", true)
	add.call(not ed.pit_boxes.is_empty() and ed.pit_line.size() >= 2,
		("%d pit boxes" % ed.pit_boxes.size() + (" and a pit line" if ed.pit_line.size() >= 2 else ", no pit line"))
		if not ed.pit_boxes.is_empty() else "No pit (optional)", true)
	var one := ed.curbs.filter(func(c: Dictionary) -> bool: return (c["nodes"] as Array).size() == 1).size()
	if one > 0:
		add.call(false, "%d curb%s only one node: it is not saved" % [one, "s have" if one > 1 else " has"], true)
	return items
