class_name TrackEditor
extends Control
## The track editor (web/tools/track-editor.html and track-editor.js) in Godot: a side bar of cards on the left (the track, ready
## to race, the reference image, the model, the surfaces, the start and the gates, the pit, the objects, the curbs, the cinematic
## cameras, the AI racing line, the sky and the light) with Save at the bottom, and the 3D view on the right with the tools in a
## bar at the bottom (Look, Grid box, Pit box, Pit line, Add gate, Drag strip, Place object, Add camera, Draw curb, Measure, and
## for a track drawn with nodes Edit road, Branch, Surfaces, Prefabs), the Layers panel, the panel of what is chosen and the
## drawer of the road designer. A track is saved as track.json and its files in tracks/<id>/: in the garage of the player
## (user://garage/tracks/<id>/) or, in the repository, in web/tracks/<id>/ when that is chosen. Opened from the main menu.
## The parts: TrackEditorUI (the cards and the bars), TrackEditorInput (the pointer and the tools), TrackEditorMarkers (what is
## drawn over the track), TrackEditorIO (open, save, export, thumbnail, height map) and TrackDesign (the road of nodes).

signal leave
signal drive(track_id: String)

const ROLES := [["road", "Road"], ["track01", "Pit lane"], ["grass", "Grass"], ["ground", "Ground"], ["sand", "Sand"], ["gravel", "Gravel"],
	["mud", "Mud"], ["scenery", "Scenery"], ["decor", "Decor"]]
const ROLE_COLORS := {"road": Color("8a93a1"), "track01": Color("c2a672"), "grass": Color("4f9b45"), "ground": Color("9a7a4e"),
	"sand": Color("e0c27a"), "gravel": Color("9b9a93"), "mud": Color("5b432b"), "scenery": Color("c45d5d"), "decor": Color("6c8cd5")}
const DRIVABLE := {"road": true, "track01": true, "grass": true, "ground": true, "sand": true, "gravel": true, "mud": true}
const GRID_MAX := 8
const SNAP_STEPS := [0.0, 1.0, 2.0, 5.0]
const DESIGN_MODES := ["node", "branch", "patch", "prefab"]

# ---- the track
var tracks: Array[Dictionary] = []
var existing_id := ""
var existing: Dictionary = {}       # the track.json that was opened (with "id")
var loaded_design := ""             # the design as it was opened (to see whether the road changed)
var model_root: Node3D = null
var model_source := ""              # a model picked to import (absolute path); "" when the model is the one of the track
var model_file := ""                # its name in the folder of the track
var model_extra: Array[String] = [] # the .bin and the pictures of a .gltf that was imported
var parts := {}                     # name -> Array[MeshInstance3D]
var roles := {}                     # name -> role
var selected_part := ""
var design: TrackDesign = null
var grid: Array = []                # the boxes of the grid: { x, y, z, heading }; box 1 is the start
var pit_boxes: Array = []
var pit_line: Array = []            # { x, y, z }
var pit_polygon: Array = []         # the older pit area, kept as it is
var gates: Array = []               # { x, y, z, heading, width }
var show_gates := true
var cameras: Array = []             # { x, y, z, range? }
var cam_range := false              # the range of the chosen camera is being changed
var drag: Dictionary = {}           # the drag strip { x, y, z, heading, width, length }, {} for none
var curbs: Array = []               # { nodes, width, height, colour, connect?, points, segments, mesh }
var objects: Array = []             # { model, x, y, z, heading, pitch, roll, sx, sy, sz } (angles in radians)
var models := {}                    # file name -> { name, source, kind, mass, pivot, base, scene }
var object_model := ""              # the model that Place object puts down
var env := {}
var env_on := true
var sky_source := ""                # a picture of the sky that was picked (absolute path)
var sky_name := ""
var reference := {}                 # { image, x, y, z, width, rotation, opacity, show, top }
var ref_source := ""
var ref_texture: Texture2D = null
var thumbnail: Image = null
var line_edit := {"editing": false, "drawing": false, "nodes": [], "selected": -1, "start": ""}
var show_line := true
# ---- the view and the work of the moment
var mode := "view"
var sel := {"kind": "", "i": -1, "node": -1}
var gizmo_mode := "move"            # move, turn, scale (W, E, R)
var snap := 0.0
var measure_points: Array = []
var save_to_repo := false
var marker_scale := 1.0
var colours := true
var prefab_type := "wall"
var prefab_style := "draw"
var prefab_attach := false
var patch_surface := "gravel"
var patch_connect := false
var drawing := {}                   # a patch, a branch or a row of points that is being drawn: { kind, index }
var draft: Array = []               # the points of a row (Points)
var gate_width := 24.0
var ui := {}                        # the controls of the cards and bars (TrackEditorUI)
var input: TrackEditorInput
var curbs_kit: TrackEditorCurbs
var line: TrackEditorLine
var road: TrackEditorRoad
var parts_kit: TrackEditorParts
var history: TrackEditorHistory
var markers: TrackEditorMarkers
var view: SubViewport
var view_box: SubViewportContainer
var camera: Camera3D
var track_group: Node3D             # the model or the design
var curb_layer: Node3D
var object_layer: Node3D
var ref_mesh: MeshInstance3D = null
var sun: DirectionalLight3D
var world_env: WorldEnvironment
var target := Vector3.ZERO          # the point that the camera turns about
var yaw := 0.6
var pitch := 0.75
var distance := 300.0
var ground_grid := TriGrid.new()    # the drivable parts (the height of the road)
var pick_grid := TriGrid.new()      # all the parts (what a click finds)
var pick_parts: Array[MeshInstance3D] = []
var _grids_dirty := true


func _ready() -> void:
	name = "TrackEditor"
	set_anchors_preset(Control.PRESET_FULL_RECT)
	size = get_viewport_rect().size
	get_viewport().size_changed.connect(func(): size = get_viewport_rect().size)
	theme = TrackEditorUI.make_theme()
	_build_world()
	input = TrackEditorInput.new(self)
	curbs_kit = TrackEditorCurbs.new(self)
	line = TrackEditorLine.new(self)
	road = TrackEditorRoad.new(self)
	parts_kit = TrackEditorParts.new(self)
	history = TrackEditorHistory.new(self)
	TrackEditorUI.build(self)
	markers = TrackEditorMarkers.new(self)
	view.add_child(markers)
	TrackEditorIO.refresh_list(self)
	env = TrackEditorIO.environment_defaults()
	var want: String = get_meta("open", Content.arg("editor-track"))
	if want != "" and tracks.any(func(t: Dictionary) -> bool: return t["id"] == want):
		TrackEditorIO.open(self, want)
	else:
		TrackEditorIO.new_track(self)
	RunLog.event("track editor opened")
	# (a screenshot of the editor for the tests: --shot=file.png --shot-at=seconds --quit)
	if Content.arg("shot") != "":
		var at := float(Content.arg("shot-at")) if Content.arg("shot-at") != "" else 3.0
		get_tree().create_timer(at).timeout.connect(func():
			get_viewport().get_texture().get_image().save_png(Content.arg("shot"))
			print("shot: ", Content.arg("shot"))
			if Content.arg("quit") != "":
				get_tree().quit())


func _build_world() -> void:
	view_box = SubViewportContainer.new()
	view_box.stretch = true
	view_box.focus_mode = Control.FOCUS_CLICK
	add_child(view_box)
	view = SubViewport.new()
	view.own_world_3d = true
	view.handle_input_locally = false
	view.msaa_3d = Viewport.MSAA_2X
	view_box.add_child(view)
	camera = Camera3D.new()
	camera.fov = 45.0
	camera.near = 0.5
	camera.far = 20000.0
	view.add_child(camera)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 600.0
	view.add_child(sun)
	world_env = WorldEnvironment.new()
	view.add_child(world_env)
	track_group = Node3D.new()
	track_group.name = "Track"
	view.add_child(track_group)
	curb_layer = Node3D.new()
	view.add_child(curb_layer)
	object_layer = Node3D.new()
	view.add_child(object_layer)
	view_box.gui_input.connect(func(e: InputEvent): input.view_event(e))
	view_box.mouse_exited.connect(func():
		if ui.has("coords"):
			ui["coords"].text = "")


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and ui.has("side"):
		(ui["side"] as Control).size.y = size.y
		parts_kit.layout_view((ui["side"] as Control).size.x)


func _process(_dt: float) -> void:
	_place_camera()
	if markers != null:
		markers.overlay.queue_redraw()


func _place_camera() -> void:
	var dir := Vector3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw))
	camera.global_position = target + dir * distance
	camera.look_at(target, Vector3.UP if absf(pitch) < 1.55 else Vector3.FORWARD)


func invalidate_ground() -> void:
	_grids_dirty = true


# ---- the ground

func _rebuild_grids() -> void:
	if not _grids_dirty:
		return
	_grids_dirty = false
	ground_grid.clear()
	pick_grid.clear()
	pick_parts.clear()
	for key in parts:
		var drivable := DRIVABLE.has(roles.get(key, ""))
		for mi in parts[key]:
			if not is_instance_valid(mi) or not (mi as MeshInstance3D).is_inside_tree() or (mi as MeshInstance3D).mesh == null:
				continue
			var m := mi as MeshInstance3D
			var faces := m.mesh.get_faces()
			var xf := m.global_transform
			if drivable and not m.has_meta("overlay"):
				ground_grid.add_faces(faces, xf, pick_parts.size())
			pick_grid.add_faces(faces, xf, pick_parts.size())
			pick_parts.append(m)


## The height of the drivable surface at (x, z): the highest one not more than 50 m above hint (no hint: the highest).
func ground_y(x: float, z: float, hint := INF) -> float:
	_rebuild_grids()
	var q := ground_grid.query(x, z, hint, 50.0)
	if q.is_empty():
		return 0.0 if hint == INF else hint
	return q["y"]


## The surface of the road at (x, z) near the height hint ("" when there is none).
func part_role_at(x: float, z: float, hint: float) -> String:
	_rebuild_grids()
	var q := ground_grid.query(x, z, hint, 50.0)
	return "" if q.is_empty() else str(roles.get(str(pick_parts[q["tag"]].name), ""))


## The ray of the camera through a point of the view.
func ray_of(pos: Vector2) -> Array:
	return [camera.project_ray_origin(pos), camera.project_ray_normal(pos)]


## Where a click on the view meets the road (a drivable part first, else any part): { point, part } or {}.
func road_hit(pos: Vector2) -> Dictionary:
	_rebuild_grids()
	var r := ray_of(pos)
	var hit := ground_grid.ray(r[0], r[1], camera.far)
	if hit.is_empty():
		hit = pick_grid.ray(r[0], r[1], camera.far)
		if hit.is_empty():
			return {}
		hit["part"] = str(pick_parts[hit["tag"]].name)
	var p: Vector3 = hit["point"]
	if snap > 0.0 and (mode == "object" or mode == "camera"):
		p.x = roundf(p.x / snap) * snap
		p.z = roundf(p.z / snap) * snap
	hit["point"] = p
	return hit


## The part of the track under a point of the view (Look: a click chooses it), or "".
func part_at(pos: Vector2) -> String:
	_rebuild_grids()
	var r := ray_of(pos)
	var hit := pick_grid.ray(r[0], r[1], camera.far)
	return "" if hit.is_empty() else str(pick_parts[hit["tag"]].name)


## Where the pointer is on the surface near the height y (a plane at that height, then the surface there: it follows a slope).
func surface_point(pos: Vector2, y: float, rounds := 2) -> Variant:
	var r := ray_of(pos)
	var h := y
	var p: Variant = null
	for k in rounds:
		var q: Variant = Plane(Vector3.UP, h).intersects_ray(r[0], r[1])
		if q == null:
			break
		if snap > 0.0:
			q.x = roundf(q.x / snap) * snap
			q.z = roundf(q.z / snap) * snap
		h = ground_y(q.x, q.z, h + 20.0)
		p = Vector3(q.x, h, q.z)
	return p


func plane_point(pos: Vector2, y: float) -> Variant:
	var r := ray_of(pos)
	var q: Variant = Plane(Vector3.UP, y).intersects_ray(r[0], r[1])
	if q != null and snap > 0.0:
		q.x = roundf(q.x / snap) * snap
		q.z = roundf(q.z / snap) * snap
	return q


func sync_start() -> Dictionary:
	return grid[0] if not grid.is_empty() else {}


# ---- one thing chosen at a time

func select(kind: String, i := -1, node := -1) -> void:
	if kind != "part" and selected_part != "":
		selected_part = ""
		parts_kit.apply_colours()
	sel = {"kind": kind, "i": i, "node": node}
	if kind == "" or kind == "part":
		cam_range = false
	refresh()


func chosen() -> bool:
	return sel["kind"] != ""


## Everything that shows the track again: the markers, the lists and the panels.
func refresh() -> void:
	if markers != null:
		markers.rebuild()
	TrackEditorUI.refresh(self)


## A step for undo: what the track is now, after a click, a key or a field.
func changed() -> void:
	history.note()
	refresh()


func status(text: String, kind := "") -> void:
	if not ui.has("status"):
		return
	var l: Label = ui["status"]
	l.text = text
	l.tooltip_text = text
	l.modulate = Color("ff8a80") if kind == "error" else (Color("7fe0a8") if kind == "ok" else (Color("ffc04d") if kind == "warn" else Color(1, 1, 1, 0.75)))
	if kind == "error":
		RunLog.event("track editor: " + text)


# ---- the design (a track drawn with nodes)

func start_design(d: Variant) -> void:
	parts_kit.clear_track()
	design = TrackDesign.new()
	design.set_data(d if d is Dictionary else TrackDesign.default_design())
	design.ground_y = func(x: float, z: float, hint: float) -> float: return ground_y(x, z, hint)
	track_group.add_child(design)
	rebuild_design(true)
	design.rebuild_prefabs()
	parts_kit.design_parts_changed()
	parts_kit.frame_track()


## The road made again; what stands on it goes to its new height (with_terrain: not while a node is dragged).
func rebuild_design(with_terrain: bool) -> void:
	if design == null:
		return
	design.rebuild(with_terrain)
	parts_kit.design_parts_changed()
	if with_terrain:
		design.build_patches()
		design.rebuild_prefabs()
		parts_kit.design_parts_changed()
		snap_to_surface()


func snap_to_surface() -> void:
	for list in [grid, pit_boxes, pit_line, gates, objects]:
		for q in list:
			q["y"] = ground_y(float(q["x"]), float(q["z"]), float(q.get("y", 0)))
	if not drag.is_empty():
		drag["y"] = ground_y(drag["x"], drag["z"], drag["y"])
	for c in curbs:
		for n in c["nodes"]:
			if c.get("connect", false):
				curbs_kit.snap_curb_node(n)
			else:
				n[1] = ground_y(n[0], n[2], n[1])
	curbs_kit.draw_curbs()
	parts_kit.show_objects()


# ---- the tools

func set_mode(m: String) -> void:
	if m in DESIGN_MODES and design == null:
		status("That tool is for a track drawn with nodes (New track).", "warn")
		return
	if mode == "curb" and m != "curb":
		curbs_kit.end_curb_draw()
	if not drawing.is_empty() and m != drawing.get("kind", ""):
		road.finish_drawing()
	if mode == "measure" and m != "measure":
		measure_points.clear()
	mode = m
	if m == "object" and object_model == "":
		status("Choose a model in the Objects card first (Place).", "warn")
	refresh()


func set_gizmo_mode(m: String) -> void:
	gizmo_mode = m
	refresh()


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if input.key(event as InputEventKey):
			get_viewport().set_input_as_handled()


## Leaves the editor (the main menu), after a question when there are changes that are not saved.
func close_editor() -> void:
	if history.unsaved():
		TrackEditorUI.ask(self, "Leave the track editor?", "The changes that are not saved are lost.", "Leave", func(): leave.emit())
		return
	leave.emit()
