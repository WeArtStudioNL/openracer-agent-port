extends Control
## (a scene: Godot --path godot res://tools/test_track_editor.tscn -- --out=/tmp/te-test [--shot-dir=/tmp])
## The track editor driven as a player would: a track of the game is opened, the tools are used with the mouse (a grid box, a
## gate, a curb, a pit line, a camera, a cone, the drag strip), undo and redo, and it is saved into the folder --out (never in
## the garage of the player or in web/). The track.json that is written is checked against the format of the browser. Then a
## new track is drawn with nodes (a node, a prefab row, a surface, a branch) and saved with its glb, and go-kart-track-1 is
## opened and saved again unchanged: its design, curbs and gates must come out as they went in.

var ed: TrackEditor
var out := ""
var fails := 0


func _ready() -> void:
	out = Content.arg("out")
	if out == "" or out.begins_with(ProjectSettings.globalize_path("user://")) or out.begins_with(Content.root):
		print("test: give --out=<a temp folder>")
		get_tree().quit(1)
		return
	set_anchors_preset(Control.PRESET_FULL_RECT)
	size = get_viewport_rect().size
	await _model_track()
	await _design_track()
	await _round_trip("go-kart-track-1")
	print("TRACK EDITOR TEST: %s" % ("PASS" if fails == 0 else "%d FAILED" % fails))
	get_tree().quit(1 if fails > 0 else 0)


func _check(ok: bool, what: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + what)
	if not ok:
		fails += 1


func _editor(open_id: String) -> void:
	if ed != null:
		ed.queue_free()
		await get_tree().process_frame
	ed = TrackEditor.new()
	ed.set_meta("out", out)
	ed.set_meta("open", open_id)
	add_child(ed)
	for i in 4:
		await get_tree().process_frame


func _screen(p: Vector3) -> Vector2:
	return ed.camera.unproject_position(p)


func _mouse(kind: String, at: Vector2, shift := false) -> void:
	var e: InputEvent
	if kind == "move":
		var m := InputEventMouseMotion.new()
		m.position = at
		m.button_mask = MOUSE_BUTTON_MASK_LEFT
		e = m
	else:
		var b := InputEventMouseButton.new()
		b.button_index = MOUSE_BUTTON_LEFT
		b.pressed = kind == "down"
		b.position = at
		b.shift_pressed = shift
		e = b
	ed.input.view_event(e)


## Press on a point of the road and drag towards another (the tools that need a direction).
func _press_drag(a: Vector3, b: Vector3) -> void:
	_mouse("down", _screen(a))
	_mouse("move", _screen(a.lerp(b, 0.5)))
	_mouse("move", _screen(b))
	_mouse("up", _screen(b))


func _click(a: Vector3, shift := false) -> void:
	_mouse("down", _screen(a), shift)
	_mouse("up", _screen(a), shift)


func _key(code: Key, ctrl := false) -> void:
	var k := InputEventKey.new()
	k.keycode = code
	k.pressed = true
	k.ctrl_pressed = ctrl
	ed.input.key(k)


func _shot(name: String) -> void:
	var dir := Content.arg("shot-dir")
	if dir == "" or DisplayServer.get_name() == "headless":
		return
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(dir.path_join(name))
	print("  shot ", dir.path_join(name))


# ---- a track with a model: the tools with the mouse

func _model_track() -> void:
	print("testtrack: the tools")
	await _editor("testtrack")
	_check(ed.model_root != null and ed.existing_id == "testtrack", "testtrack opened with its model (%d parts)" % ed.parts.size())
	var s: Dictionary = ed.grid[0]
	var start := Vector3(s["x"], s["y"], s["z"])
	var fwd := Vector3(cos(s["heading"]), 0, sin(s["heading"]))
	ed.target = start
	ed.distance = 70.0
	ed.pitch = 1.2
	ed._place_camera()
	await get_tree().process_frame
	var on_road := func(d: float, side := 0.0) -> Vector3:
		var p := start + fwd * d + Vector3(-fwd.z, 0, fwd.x) * side
		p.y = ed.ground_y(p.x, p.z, start.y)
		return p
	# a grid box behind the start, driven the same way
	ed.set_mode("grid")
	var before := ed.grid.size()
	_press_drag(on_road.call(-8.0), on_road.call(2.0))
	_check(ed.grid.size() == before + 1, "Grid box: a box is added (%d)" % ed.grid.size())
	_check(absf(angle_difference(float(ed.grid[-1]["heading"]), float(s["heading"]))) < 0.15, "Grid box: it faces the way of the drag")
	# a gate
	ed.set_mode("gate")
	ed.gates.clear()
	_press_drag(on_road.call(6.0), on_road.call(16.0))
	_check(ed.gates.size() == 1 and absf(float(ed.gates[0]["width"]) - 24.0) < 0.01, "Add gate: gate 1 with the width of new gates")
	# the undo and the redo
	ed.history.undo()
	_check(ed.gates.is_empty(), "Undo takes the gate away")
	ed.history.redo()
	_check(ed.gates.size() == 1, "Redo brings it back")
	# a curb of three nodes, Enter ends it
	ed.set_mode("curb")
	ed.select("")
	for d in [10.0, 20.0, 30.0]:
		_click(on_road.call(d, 4.0))
	_key(KEY_ENTER)
	_check(ed.curbs.size() == 1 and (ed.curbs[0]["nodes"] as Array).size() == 3, "Draw curb: a curb of 3 nodes")
	_check((ed.curbs[0]["points"] as Array).size() > 20, "the curb has its points on the ground (%d)" % (ed.curbs[0]["points"] as Array).size())
	# a pit line of three points
	ed.set_mode("pitline")
	for d in [0.0, 12.0, 24.0]:
		_click(on_road.call(d, -3.0))
	_check(ed.pit_line.size() == 3, "Pit line: three points")
	ed.set_mode("pitbox")
	_press_drag(on_road.call(4.0, -3.0), on_road.call(14.0, -3.0))
	_check(ed.pit_boxes.size() >= 2, "Pit box: a box is added")
	# a camera and a cone (a prefab placed as an object of a track with a model)
	ed.set_mode("camera")
	_click(on_road.call(40.0, 8.0))
	_check(ed.cameras.size() == 1 and absf(float(ed.cameras[0]["y"]) - on_road.call(40.0, 8.0).y - 3.0) < 0.3, "Add camera: 3 m above the road")
	TrackEditorIO.use_prefab(ed, "cone", "")
	_press_drag(on_road.call(25.0, -5.0), on_road.call(30.0, -5.0))
	_check(ed.objects.size() == 1 and ed.objects[0]["model"] == "obj-prefab-cone.glb", "Place object: a cone")
	# the chosen gate is turned with the ring of its handles
	ed.set_mode("view")
	ed.select("gate", 0)
	ed.markers.rebuild()
	var g: Dictionary = ed.gates[0]
	var gc := Vector3(g["x"], g["y"], g["z"])
	var h0 := float(g["heading"])
	var ring := _screen(gc) + Vector2(TrackEditorMarkers.RING, 0)
	_mouse("down", ring)
	_mouse("move", _screen(gc) + Vector2(0, TrackEditorMarkers.RING).rotated(-0.2))
	_mouse("move", _screen(gc) + Vector2(0, TrackEditorMarkers.RING))
	_mouse("up", _screen(gc) + Vector2(0, TrackEditorMarkers.RING))
	_check(absf(angle_difference(float(ed.gates[0]["heading"]), h0)) > 0.5, "the ring of the handles turns the gate")
	# the drag strip, kept as it was
	_check(not ed.drag.is_empty(), "the drag strip of testtrack is there")
	await _shot("te-tools.png")
	ed.ui["name"].text = "Editor test"
	ed.ui["id"].text = "te-test-model"
	_check(TrackEditorIO.save(ed), "saved as te-test-model: " + ed.ui["status"].text)
	var cfg: Variant = JSON.parse_string(FileAccess.get_file_as_string(out.path_join("tracks/te-test-model/track.json")))
	_check(cfg is Dictionary, "track.json is written")
	if cfg is Dictionary:
		_format(cfg)
		_check(FileAccess.file_exists(out.path_join("tracks/te-test-model/testtrack.glb")), "the model is copied with the new id")
		_check(FileAccess.file_exists(out.path_join("tracks/te-test-model/obj-prefab-cone.glb")), "the glb of the cone is in the folder")


## The format of the browser (track-editor.js save): the fields and their types.
func _format(cfg: Dictionary) -> void:
	var start: Dictionary = cfg["start"]
	_check(start.keys() == ["x", "z", "heading"], "start {x, z, heading}")
	_check(cfg["grid"] is Array and (cfg["grid"] as Array).all(func(b: Dictionary) -> bool: return b.keys() == ["x", "z", "heading"]), "grid [{x, z, heading}]")
	for g in cfg.get("gates", []):
		_check(g.keys() == ["x", "z", "heading", "width", "y"], "a gate {x, z, heading, width, y}")
	for c in cfg.get("curbs", []):
		_check(c.has("nodes") and c.has("points") and c.has("width") and c.has("height") and c.has("colour"), "a curb {nodes, width, height, colour, points}")
		_check((c["points"] as Array).all(func(q: Array) -> bool: return q.size() == 6), "the points of a curb [x, z, yL, yM, yR, size]")
	for o in cfg.get("objects", []):
		if o.has("model"):
			_check(o.has("x") and o.has("y") and o.has("z") and o.has("heading") and o.has("pivot"), "an object {model, x, z, y, heading, pivot}")
	if cfg.has("pit"):
		_check((cfg["pit"].get("line", []) as Array).all(func(q: Array) -> bool: return q.size() == 2), "pit.line [[x, z]]")
	if cfg.has("dragstrip"):
		_check(cfg["dragstrip"].keys() == ["x", "z", "heading", "width", "length"], "dragstrip {x, z, heading, width, length}")
	for c in cfg.get("cameras", []):
		_check(c.has("x") and c.has("y") and c.has("z"), "a camera {x, y, z}")
	_check(cfg["surfaces"] is Dictionary and cfg["surfaces"].get("meshes") is Dictionary, "surfaces.meshes")


# ---- a track drawn with nodes

func _design_track() -> void:
	print("a new track drawn with nodes")
	await _editor("")
	_check(ed.design != null and (ed.design.data["nodes"] as Array).size() == 8, "New track: an oval of 8 nodes")
	var nodes: Array = ed.design.data["nodes"]
	ed.parts_kit.frame_track()
	ed.pitch = 1.4
	ed._place_camera()
	await get_tree().process_frame
	# a node between node 1 and 2 (Edit road, a click on the ground)
	ed.set_mode("node")
	var a: Dictionary = nodes[1]
	var b: Dictionary = nodes[2]
	var mid := Vector3((a["x"] + b["x"]) / 2.0 + 10.0, 0, (a["z"] + b["z"]) / 2.0)
	mid.y = ed.ground_y(mid.x, mid.z)
	_click(mid)
	_check((ed.design.data["nodes"] as Array).size() == 9, "Edit road: a node is added between two nodes")
	# a row of tyre walls drawn with the mouse, and a single tree
	ed.prefab_type = "tyrewall"
	ed.set_mode("prefab")
	var r0 := Vector3(0, 0, -40)
	var r1 := Vector3(40, 0, -40)
	r0.y = ed.ground_y(r0.x, r0.z)
	r1.y = ed.ground_y(r1.x, r1.z)
	_press_drag(r0, r1)
	var pre: Array = ed.design.data["prefabs"]
	_check(pre.size() == 1 and pre[0].get("row", false), "Prefabs: a row of tyre walls")
	ed.prefab_type = "tree"
	_click(Vector3(0, ed.ground_y(0, 20), 20))
	_check(pre.size() == 2 and not pre[1].get("row", false), "Prefabs: a single tree")
	# an area of gravel: three corners and Enter
	ed.set_mode("patch")
	ed.select("")
	for q in [Vector3(-30, 0, 0), Vector3(-10, 0, 0), Vector3(-20, 0, 15)]:
		_click(Vector3(q.x, ed.ground_y(q.x, q.z), q.z))
	_key(KEY_ENTER)
	_check((ed.design.data["patches"] as Array).size() == 1 and ed.design.patch_group.get_child_count() == 1, "Surfaces: an area of gravel")
	await _shot("te-design.png")
	ed.ui["name"].text = "Editor test design"
	ed.ui["id"].text = "te-test-design"
	# the start on the road: box 1 at the first node, along the road
	var n0: Dictionary = ed.design.data["nodes"][0]
	var n1: Dictionary = ed.design.data["nodes"][1]
	ed.grid = [{"x": n0["x"], "y": ed.ground_y(n0["x"], n0["z"]), "z": n0["z"], "heading": atan2(n1["z"] - n0["z"], n1["x"] - n0["x"])}]
	TrackEditorUI._gate_at_start(ed)
	_check(TrackEditorIO.save(ed), "saved as te-test-design: " + ed.ui["status"].text)
	var dir := out.path_join("tracks/te-test-design")
	_check(FileAccess.file_exists(dir.path_join("te-test-design.glb")), "the glb of the design is written")
	var cfg: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("track.json")))
	if cfg is Dictionary:
		_format(cfg)
		_check(cfg["design"]["prefabs"].size() == 2 and cfg["design"]["patches"].size() == 1, "track.json has the design")
		var sm: Dictionary = cfg["surfaces"]["meshes"]
		_check(sm.get("road") == "road" and sm.get("ground") == "ground" and sm.get("prefab_tree_2") == null and sm.get("patch_gravel_1") == "gravel",
			"the surfaces of the parts (road, ground, gravel; a tree is scenery)")
	# the glb as the game loads it: its parts by name
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	doc.append_from_file(dir.path_join("te-test-design.glb"), st)
	var root := doc.generate_scene(st)
	var names := {}
	for m in root.find_children("*", "MeshInstance3D", true, false):
		names[str(m.name)] = true
		names[str(m.get_parent().name)] = true
	root.free()
	_check(names.has("road") and names.has("shoulder_left") and names.has("ground") and names.has("prefab_tyrewall_1") and names.has("patch_gravel_1"),
		"the glb has road, shoulder_left, ground, prefab_tyrewall_1, patch_gravel_1")


## A track opened and saved again without a change: what the browser wrote comes out the same.
func _round_trip(id: String) -> void:
	print("%s opened and saved again" % id)
	var orig: Dictionary = Content.load_json("tracks/%s/track.json" % id)
	await _editor(id)
	_check(not ed.history.unsaved(), "no changes after opening")
	_check(TrackEditorIO.save(ed), "saved: " + ed.ui["status"].text)
	var cfg: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(out.path_join("tracks/%s/track.json" % id)))
	var keys_o := orig.keys()
	keys_o.sort()
	var keys_n := cfg.keys()
	keys_n.sort()
	_check(keys_o == keys_n, "the same fields (%s)" % ", ".join(keys_n))
	_check(JSON.stringify(cfg["design"]) == JSON.stringify(orig["design"]), "the design is the same")
	_check(JSON.stringify(cfg["grid"]) == JSON.stringify(orig["grid"]), "the grid is the same")
	_check(JSON.stringify(cfg["gates"]) == JSON.stringify(orig["gates"]), "the gates are the same")
	_check(JSON.stringify(cfg["pit"]) == JSON.stringify(orig["pit"]), "the pit is the same")
	_check(JSON.stringify(cfg["surfaces"]) == JSON.stringify(orig["surfaces"]), "the surfaces are the same")
	_check(JSON.stringify(cfg["objects"]) == JSON.stringify(orig["objects"]), "the objects are the same")
	_check(JSON.stringify(cfg["dragstrip"]) == JSON.stringify(orig["dragstrip"]), "the drag strip is the same")
	var same_nodes := true
	var worst := 0.0
	for i in (orig["curbs"] as Array).size():
		same_nodes = same_nodes and JSON.stringify(cfg["curbs"][i]["nodes"]) == JSON.stringify(orig["curbs"][i]["nodes"])
		var po: Array = orig["curbs"][i]["points"]
		var pn: Array = cfg["curbs"][i]["points"]
		if po.size() != pn.size():
			worst = INF
			continue
		for k in po.size():
			for c in 6:
				worst = maxf(worst, absf(float(po[k][c]) - float(pn[k][c])))
	_check(same_nodes, "the nodes of the %d curbs are the same" % (orig["curbs"] as Array).size())
	_check(worst < 0.02, "the points of the curbs within 2 cm of the browser's (the worst %.3f m)" % worst)
	_check(cfg["racing_line"].size() == orig["racing_line"].size(), "the racing line is kept")
	await _shot("te-roundtrip.png")
