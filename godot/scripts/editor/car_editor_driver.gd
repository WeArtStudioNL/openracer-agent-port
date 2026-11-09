# gdlint: disable=max-public-methods
extends RefCounted
## The Driver card of the car editor (web/tools/driver-editor.js): a model of a driver (a glb with a skeleton, made in
## Blender in the T pose) that sits in the car. It is placed with the gizmo of the view and the fields: the model itself
## (move and turn, the scale in a field), the two grips of the hands on the steering wheel, the two feet on the pedals,
## the ring of the wheel the hands hold, the chest and the head (turn), and where the elbows and the knees point to; the
## arms and the legs follow with the inverse kinematics of the game (CarDriver, the same code). The sliders Steering,
## Throttle and Brake try the driver out: the hands turn with the wheel (and the steering wheel of the model with them)
## and pass over when they would cross, or follow the keys; the feet follow the pedals. The bones are guessed from their
## names and can be set by hand. Everything goes in car.json as "driver"; a model picked here is saved with the car as
## driver.glb (CarEditorIO._finish). The editor loads this file (CarEditor.CARD_HOOKS) and calls setup, fill, read,
## frame, on_model, click, key and saved.
## A motorcycle: the figure sits with his hands on the grips and his feet on the pegs, as in the game in his neutral posture (_pose_on_bike); the card places it and its
## bones, the chest and the head. How he rides is MotorcycleRider in the game.

const ROLES := [["armL", "Left arm", ["upper arm", "forearm", "hand"]], ["armR", "Right arm", ["upper arm", "forearm", "hand"]],
	["legL", "Left leg", ["thigh", "shin", "foot"]], ["legR", "Right leg", ["thigh", "shin", "foot"]]]
const MARK := {"handL": Color("#5ec8ff"), "handR": Color("#ff6b6b"), "footL": Color("#8ee26b"), "footR": Color("#ffd04d")}
const TORSO := {"chest": Color("#ffe2a8"), "head": Color("#e8c8ff")}
const POLES := {"pArmL": "armL", "pArmR": "armR", "pLegL": "legL", "pLegR": "legR"}
const POLE_COLOUR := {"pArmL": Color("#a8e0ff"), "pArmR": Color("#ffb3b3"), "pLegL": Color("#c5f0b0"), "pLegR": Color("#ffe79a")}
const PLACES := [["model", "Driver"], ["handL", "Left hand"], ["handR", "Right hand"], ["footL", "Left foot (brake)"], ["footR", "Right foot (gas)"],
	["wheel", "Wheel (ring)"], ["chest", "Chest"], ["head", "Head"]]
const HAND_SIDE := {"handL": "left", "handR": "right"}
const TURNABLE := ["model", "wheel", "handL", "handR", "footL", "footR"]     # (the ones with Move and Rotate)
const KEY_NAME := {"handL": "left", "handR": "right", "chest": "chest", "head": "head"}
const KEY_COLOURS := [["left", Color("#5ec8ff"), 0.0], ["right", Color("#ff6b6b"), 8.0], ["chest", Color("#ffe2a8"), 16.0], ["head", Color("#e8c8ff"), 24.0]]

var ed: CarEditor
var body: Node3D                     # the space of the body of the car in the view (where the model's pivot hangs)
var marks: Node3D                    # the nodes of the hands, the feet, the chest, the head, the poles and the ring
var driver: CarDriver = null
var _bike_parts := {}                # a motorcycle: grip_left, grip_right, peg_left, peg_right (nodes of the model)
var enabled := false
var touched := false                 # the driver was changed since it was saved (it goes in car.json, whatever tune is chosen)
var editing := false
var selected := ""
var mode := "move"
var steer := 0.0                     # the steering slider (degrees; the turn of the wheel is minus that)
var throttle := 0.0
var brake := 0.0
var file := ""                       # the figure: cars/<id>/driver.glb, or the absolute path of a model picked here
var removed := false
var targets := {}                    # key -> the node in the view
var ring: Node3D                     # the ring of the hands: its place, its turn and its scale (the radius)
var wheel: SteeringWheel = null      # the steering wheel of the model (turned with the slider)
var ui := {}

var _scenes := {}                    # file -> the loaded scene (a copy for every figure)
var _quiet := false
var _bench_was := false
var _ring_was := Transform3D.IDENTITY     # the ring as it was: the hands go with it when it is moved


func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		for sc in _scenes.values():
			if is_instance_valid(sc):
				(sc as Node).free()


func setup(editor: CarEditor, card_body: VBoxContainer) -> void:
	ed = editor
	body = Node3D.new()
	body.name = "DriverSpace"
	ed.view.viewport.add_child(body)
	marks = Node3D.new()
	marks.name = "DriverMarks"
	ed.view.viewport.add_child(marks)
	_make_markers()
	_build(card_body)
	ed.view.gizmo.moved.connect(_moved)
	_info()


# ---- the nodes in the view

func _make_markers() -> void:
	for k in MARK:
		var m := CarEditorView.sphere(0.03 if k.begins_with("hand") else 0.045, MARK[k], true)
		# the turn of a hand or a foot: a small cross (red x, green y, blue z of the car)
		var a := CarEditorView.lines([Vector3.ZERO, Vector3.RIGHT * 0.07, Vector3.ZERO, Vector3.UP * 0.07, Vector3.ZERO, Vector3.BACK * 0.07],
			[Color.RED, Color.RED, Color.GREEN, Color.GREEN, Color(0.3, 0.5, 1), Color(0.3, 0.5, 1)], true)
		a.layers = CarEditorView.MARKER_LAYER
		m.add_child(a)
		_add_marker(k, m)
	for k in TORSO:
		_add_marker(k, CarEditorView.sphere(0.05, Color(TORSO[k], 0.9), true))
	for k in POLES:
		var b := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3.ONE * 0.05
		b.mesh = bm
		b.material_override = CarEditorView.flat_material(Color(POLE_COLOUR[k], 0.85), true)
		b.layers = CarEditorView.MARKER_LAYER
		_add_marker(k, b)
	ring = Node3D.new()
	ring.name = "Ring"
	marks.add_child(ring)
	var torus := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.965
	tm.outer_radius = 1.035
	tm.rings = 48
	tm.ring_segments = 6
	torus.mesh = tm
	torus.material_override = CarEditorView.flat_material(Color(Color("#9aa7b8"), 0.6), true)
	torus.rotation.x = PI / 2.0              # (a torus lies about y; the ring's axis is its z)
	torus.layers = CarEditorView.MARKER_LAYER
	ring.add_child(torus)
	var top := CarEditorView.sphere(0.02, Color("#9aa7b8"), true)
	top.position = Vector3.UP
	top.set_meta("layer", "drv:wheel")
	ring.add_child(top)
	targets["wheel"] = ring
	marks.visible = false


func _add_marker(k: String, m: Node3D) -> void:
	m.set_meta("layer", "drv:" + k)
	marks.add_child(m)
	targets[k] = m


func _show_markers() -> void:
	marks.visible = editing and enabled and driver != null and ed.bench.car == null


# ---- the card

func _build(b: VBoxContainer) -> void:
	b.add_child(EditorStyle.hint("A driver in the car: a .glb with a simple skeleton in the T pose (from Blender). Place it and the hands and feet " +
		"with the gizmo; in the game the hands hold the steering wheel and pass over when they would cross, and the feet follow the pedals."))
	var en := CheckBox.new()
	en.text = "The car has a driver"
	en.focus_mode = Control.FOCUS_NONE
	en.toggled.connect(func(on: bool):
		if _quiet:
			return
		if on and driver == null:
			en.set_pressed_no_signal(false)
			ed.status("Load the driver model first.", "error")
			return
		set_enabled(on)
		_changed())
	b.add_child(en)
	ui["enabled"] = en
	var r := EditorStyle.row(b)
	var pick := EditorStyle.button("Load the driver model…", "small accent")
	pick.pressed.connect(_pick_file)
	r.add_child(pick)
	var rm := EditorStyle.button("Remove", "small danger", "Takes the driver out of the car")
	rm.pressed.connect(remove)
	r.add_child(rm)
	ui["file"] = EditorStyle.hint("No model loaded.")
	b.add_child(ui["file"])
	var edit := EditorStyle.button("Edit driver", "small", "Shows the nodes of the hands, the feet, the chest, the head and the ring of the wheel in the view, " +
		"and the controls to place them; Escape or this button again stops")
	edit.pressed.connect(func(): set_editing(not editing))
	b.add_child(edit)
	ui["edit"] = edit
	_build_edit_box(b)
	_build_fields(b)
	_build_try(b)
	var bones := EditorStyle.fold(b, "Bones of the arms and the legs")
	var guess := EditorStyle.button("Guess them from the names", "small")
	guess.pressed.connect(func():
		if driver == null:
			return
		driver.cfg["bones"] = {}
		driver.resolve_bones()
		_fill_bones()
		_info()
		_changed())
	bones.add_child(guess)
	ui["bones"] = VBoxContainer.new()
	bones.add_child(ui["bones"])


func _build_edit_box(b: VBoxContainer) -> void:
	var box := VBoxContainer.new()
	box.visible = false
	b.add_child(box)
	ui["edit_box"] = box
	box.add_child(EditorStyle.group("Place (the gizmo is in the view)"))
	var places := HFlowContainer.new()
	box.add_child(places)
	ui["places"] = {}
	for p in PLACES:
		var btn := EditorStyle.button(p[1], "small")
		btn.pressed.connect(func(): select(p[0]))
		places.add_child(btn)
		ui["places"][p[0]] = btn
	var modes := EditorStyle.row(box)
	ui["modes"] = modes
	ui["mode_buttons"] = {}
	for m in [["move", "Move (W)"], ["rotate", "Rotate (E)"]]:
		var btn := EditorStyle.button(m[1], "small")
		btn.pressed.connect(func():
			mode = m[0]
			_attach())
		modes.add_child(btn)
		ui["mode_buttons"][m[0]] = btn
	var grip := VBoxContainer.new()
	box.add_child(grip)
	ui["grip_box"] = grip
	ui["grip_label"] = EditorStyle.hint("Grip of this hand 0% (the fingers, open to closed)")
	grip.add_child(ui["grip_label"])
	var gs := HSlider.new()
	gs.min_value = 0
	gs.max_value = 100
	gs.step = 1
	gs.focus_mode = Control.FOCUS_NONE
	gs.value_changed.connect(_grip_changed)
	grip.add_child(gs)
	ui["grip"] = gs
	var curl := EditorStyle.options([["x", "+x of the bones"], ["-x", "-x of the bones (reversed)"]])
	curl.item_selected.connect(func(_i: int):
		if driver != null and not _quiet:
			driver.cfg["grip_curl"] = EditorStyle.value_of(curl)
			driver.refresh_fingers()
			_changed())
	grip.add_child(EditorStyle.labelled(curl, "Direction the fingers close", false))
	ui["curl"] = curl
	grip.add_child(EditorStyle.hint("Rotate (E) turns the hand."))
	box.add_child(EditorStyle.hint("Click a ball, a cube or the top of the ring in the view to take it. The ring carries the hands. " +
		"A foot: Move is the place the leg reaches for, Rotate (E) the way the foot points."))
	var reset := EditorStyle.button("Reset the elbows and knees", "small ghost")
	reset.pressed.connect(func():
		if driver != null:
			driver.cfg["poles"] = null
			_changed())
	box.add_child(reset)


func _number(parent: Control, hint_text: String, step: float, lo: float, hi: float, apply: Callable) -> EditorStyle.NumberField:
	var f := EditorStyle.NumberField.new(hint_text, step, lo, hi)
	parent.add_child(f)
	f.edited.connect(func(v: float):
		if driver != null and not _quiet:
			apply.call(v)
			_changed(false))
	f.committed.connect(func(_v: float):
		if driver != null and not _quiet:
			_changed())
	return f


func _build_fields(b: VBoxContainer) -> void:
	b.add_child(EditorStyle.group("The figure (the space of the body of the car)"))
	ui["fields"] = {}
	var pos := EditorStyle.row(b)
	var rot := EditorStyle.row(b)
	for i in 3:
		var axis: String = ["x (left)", "y (up)", "z (forward)"][i]
		ui["fields"]["p%d" % i] = _number(pos, axis + " m", 0.001, NAN, NAN, func(v: float):
			driver.cfg["position"][i] = v
			driver.place())
		ui["fields"]["r%d" % i] = _number(rot, "turn about " + axis.substr(0, 1) + " °", 0.1, -180.0, 180.0, func(v: float):
			driver.cfg["rotation"][i] = v
			driver.place())
	var r := EditorStyle.row(b)
	ui["fields"]["scale"] = _number(r, "scale", 0.01, 0.1, 3.0, func(v: float):
		if v > 0.0:
			driver.cfg["scale"] = v
			driver.place())
	ui["fields"]["travel"] = _number(r, "pedal travel (cm)", 1.0, 0.0, 20.0, func(v: float): driver.cfg["feet"]["travel"] = maxf(0.0, v) / 100.0)
	ui["fields"]["elbow"] = _number(r, "elbows out", 0.05, -1.0, 2.0, func(v: float): driver.cfg["elbow_out"] = v)
	ui["fields"]["knee"] = _number(r, "knees out", 0.05, -1.0, 2.0, func(v: float): driver.cfg["knee_out"] = v)
	var r2 := EditorStyle.row(b)
	ui["fields"]["radius"] = _number(r2, "radius of the ring of the hands (m)", 0.005, 0.05, 0.4, func(v: float):
		_ring_to_config()
		driver.cfg["wheel"]["radius"] = maxf(0.03, v))


func _slider(parent: Control, lo: float, hi: float, step: float, on_change: Callable) -> HSlider:
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.focus_mode = Control.FOCUS_NONE
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.value_changed.connect(on_change)
	parent.add_child(s)
	return s


func _build_try(b: VBoxContainer) -> void:
	b.add_child(EditorStyle.group("Try it"))
	ui["steer_label"] = EditorStyle.hint("Steering 0°")
	b.add_child(ui["steer_label"])
	ui["steer"] = _slider(b, -450, 450, 1, func(v: float):
		steer = v
		ui["steer_label"].text = "Steering %d°" % roundi(v)
		_refresh_keys())
	var strip := Control.new()
	strip.custom_minimum_size = Vector2(0, 34)
	strip.mouse_filter = Control.MOUSE_FILTER_STOP
	strip.draw.connect(func(): _draw_strip(strip))
	strip.gui_input.connect(func(e: InputEvent): _strip_click(strip, e))
	b.add_child(strip)
	ui["strip"] = strip
	b.add_child(EditorStyle.group("Keyframes of the hands"))
	b.add_child(EditorStyle.hint("Set the hands, chest and head by keys."))
	var k1 := HFlowContainer.new()
	b.add_child(k1)
	var k2 := HFlowContainer.new()
	b.add_child(k2)
	for e in [[k1, "Make keys from the automatic movement", "small accent", _bake], [k1, "Back to automatic", "small ghost", _keys_off],
			[k2, "Add a key here", "small", _key_add], [k2, "Delete the key here", "small ghost", _key_del],
			[k2, "Mirror the + keys to the − side", "small", _mirror]]:
		var btn := EditorStyle.button(e[1], e[2])
		btn.pressed.connect(e[3])
		(e[0] as Control).add_child(btn)
	var rides := CheckBox.new()
	rides.text = "rides the wheel"
	rides.focus_mode = Control.FOCUS_NONE
	rides.toggled.connect(_rides_toggled)
	k2.add_child(rides)
	ui["rides"] = rides
	ui["key_info"] = EditorStyle.hint("No keys: the hands move by themselves.")
	b.add_child(ui["key_info"])
	b.add_child(EditorStyle.hint("Throttle"))
	ui["throttle"] = _slider(b, 0, 1, 0.01, func(v: float): throttle = v)
	b.add_child(EditorStyle.hint("Brake"))
	ui["brake"] = _slider(b, 0, 1, 0.01, func(v: float): brake = v)


# ---- the state

func set_enabled(on: bool) -> void:
	enabled = on
	_quiet = true
	(ui["enabled"] as CheckBox).button_pressed = on
	_quiet = false
	if driver != null:
		driver.root.visible = on
	if not on:
		_deselect()
		if wheel != null:
			wheel.turn(0.0)
	set_editing(editing and on)
	_info()


func set_editing(on: bool) -> void:
	editing = on and driver != null and enabled and ed.bench.car == null
	ui["edit_box"].visible = editing
	var e: Button = ui["edit"]
	e.text = "Stop editing (Esc)" if editing else "Edit driver"
	EditorStyle.style_button(e, "small accent" if editing else "small")
	e.disabled = driver == null or not enabled or ed.bench.car != null
	if not editing:
		_deselect()
	else:
		var sb: Variant = ed.hooks.get("Soft body")      # (no part stays lit under the nodes of the driver)
		if sb != null:
			sb.partwin.close()
	_show_markers()


func _info() -> void:
	ed.card_of["Driver"]["meta"].text = "none" if driver == null else ("on" if enabled else "off")
	var t := "No model loaded."
	if driver != null:
		t = (file.get_file() + " (picked: saved with the car as driver.glb)") if file.is_absolute_path() else ("The model of this car (%s)" % file)
		if not driver.complete():
			t += ". Not every bone of the arms and the legs is found: set them under Bones."
		elif ed.is_bike():
			t += ". (A motorcycle: the game poses the rider on the grips and the pegs.)"
	ui["file"].text = t


## A change of the driver: car.json "driver" of the form follows (the test bench and undo see it).
func _changed(step := true) -> void:
	touched = true
	if driver != null:
		ed.cfg["driver"] = to_config()
	elif removed:
		ed.cfg.erase("driver")
	_info()
	ed.changed(step)


# ---- the model

func _pick_file() -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.filters = PackedStringArray(["*.glb, *.gltf ; A driver (a glb with a skeleton)"])
	dlg.title = "A driver model (.glb with a skeleton in the T pose)"
	ed.add_child(dlg)
	dlg.file_selected.connect(func(p: String):
		dlg.queue_free()
		load_file(p))
	dlg.canceled.connect(dlg.queue_free)
	dlg.popup_centered_ratio(0.6)


## A model picked from the disk (an absolute path).
func load_file(path: String) -> bool:
	var scene := _scene(path)
	if scene == null:
		ed.status("Could not read the driver model " + path.get_file() + ".", "error")
		return false
	if scene.find_children("*", "Skeleton3D", true, false).is_empty():
		scene.free()
		ed.status("The driver model %s has no skeleton." % path.get_file(), "error")
		return false
	var cfg := driver.cfg.duplicate(true) if driver != null else CarDriver.with_defaults({"enabled": true})
	file = path
	removed = false
	_install(scene, cfg, true)
	ed.status("Driver model loaded. It faced the back of the car, so it is turned round (rotation 180° about y)." if driver.turned_round
		else "Driver model loaded.", "ok")
	_changed()
	return true


func remove() -> void:
	if driver == null:
		return
	driver.dispose()
	driver = null
	file = ""
	removed = true
	set_enabled(false)
	_fill_bones()
	_changed()
	ed.status("The driver is taken out of the car (Save to keep it so).", "ok")


## A copy of the scene of a file (loaded once).
func _scene(path: String) -> Node3D:
	if not _scenes.has(path):
		var root := CarEditorIO.load_gltf(Content.path(path))
		if root == null:
			return null
		_scenes[path] = root
	return (_scenes[path] as Node3D).duplicate() as Node3D


func _install(scene: Node3D, config: Dictionary, fresh: bool) -> void:
	if driver != null:
		driver.dispose()
	var d := CarDriver.new(body, config, {"axis": Vector3.BACK, "centre": Vector3.ZERO, "degrees": 450.0, "angle": 0.0})
	# a new model that faces the back of the car (a Rigify mannequin does) is turned round, when it was not turned yet
	var rot := BoneIK.vec(d.cfg["rotation"])
	var unturned := rot.length() < 1e-6 or (absf(rot.x) + absf(rot.z) < 1e-6 and absf(absf(rot.y) - 180.0) < 1e-6)
	if fresh and unturned:
		d.cfg["rotation"] = [0, 0, 0]
	d.set_model(scene)
	if fresh and unturned and d.facing == -1:
		d.cfg["rotation"] = [0, 180, 0]
		d.place()
		d.turned_round = true
	driver = d
	for m in d.root.find_children("*", "MeshInstance3D", true, false):
		(m as MeshInstance3D).layers = CarEditorView.DRIVER_LAYER
	_ring_from_config()
	_sync_targets()
	_fill_bones()
	_sync_fields()
	_refresh_keys()
	set_enabled(true)
	_attach()


## A car was loaded (or undone): its "driver" into the card.
func fill(cfg: Dictionary) -> void:
	var dc: Variant = cfg.get("driver")
	if driver != null and dc is Dictionary and JSON.stringify(dc) == JSON.stringify(to_config()):
		return
	touched = false
	if driver != null:
		driver.dispose()
		driver = null
	file = ""
	removed = false
	steer = 0.0
	(ui["steer"] as HSlider).set_value_no_signal(0.0)
	_deselect()
	set_enabled(false)
	_fill_bones()
	wheel = SteeringWheel.find(ed.model_root, body, cfg.get("steering_wheel", {}) if cfg.get("steering_wheel") is Dictionary else {})
	if not (dc is Dictionary) or str(dc.get("file", "")) == "":
		_info()
		return
	file = str(dc["file"])
	var scene := _scene(file)
	if scene == null:
		ed.status("The driver model of this car could not be loaded (%s)." % file, "error")
		file = ""
		_info()
		return
	var given: Dictionary = (dc as Dictionary).duplicate(true)
	given["enabled"] = true
	_install(scene, given, false)
	set_enabled(dc.get("enabled", true) != false)


func on_model(root: Node3D) -> void:
	wheel = SteeringWheel.find(root, body, ed.cfg.get("steering_wheel", {}) if ed.cfg.get("steering_wheel") is Dictionary else {})


## The car was saved: the file of the figure is the one that went with it.
func saved(c: Dictionary) -> void:
	touched = false
	if c.get("driver") is Dictionary and driver != null:
		file = str(c["driver"].get("file", file))
		if ed.cfg.get("driver") is Dictionary:
			ed.cfg["driver"]["file"] = file
	_info()


## car.json "driver" as the browser's driver-editor.js writes it (also when switched off: the place, the hands and the
## keys stay with it, and the game shows no driver).
func to_config() -> Dictionary:
	if driver == null:
		return {}
	var c := driver.cfg
	var h: Dictionary = c["hands"]
	var f: Dictionary = c["feet"]
	var out := {"enabled": enabled, "file": file, "position": (c["position"] as Array).duplicate(), "rotation": (c["rotation"] as Array).duplicate(),
		"scale": c["scale"], "bones": driver.bone_config(),
		"hands": {"left": (h["left"] as Array).duplicate(), "right": (h["right"] as Array).duplicate(), "rotation": h["rotation"].duplicate(true),
			"grip": h["grip"].duplicate(true), "offset": h["offset"].duplicate(true)},
		"grip_curl": c["grip_curl"]}
	if c.get("keys") is Dictionary:
		out["keys"] = c["keys"].duplicate(true)
	out["feet"] = {"left": (f["left"] as Array).duplicate(), "right": (f["right"] as Array).duplicate(), "travel": f["travel"],
		"direction": (f["direction"] as Array).duplicate(), "offset": f["offset"].duplicate(true)}
	if BoneIK.vec(f["rotation"]["left"]).length() > 1e-3 or BoneIK.vec(f["rotation"]["right"]).length() > 1e-3:
		out["feet"]["rotation"] = f["rotation"].duplicate(true)
	out["elbow_out"] = c["elbow_out"]
	out["knee_out"] = c["knee_out"]
	if c.get("wheel") is Dictionary:
		out["wheel"] = c["wheel"].duplicate(true)
	out["pivot"] = c.get("pivot", "")
	out["chest"] = {"rotation": (c["chest"]["rotation"] as Array).duplicate()}
	out["head"] = {"rotation": (c["head"]["rotation"] as Array).duplicate()}
	if c.get("poles") is Dictionary:
		out["poles"] = c["poles"].duplicate(true)
	return out


## The car is saved: its "driver" (none when it was removed; what the car had when no driver was loaded here).
func read(cfg: Dictionary) -> void:
	if driver != null:
		cfg["driver"] = to_config()
	elif removed:
		cfg.erase("driver")


# ---- the bones

func _fill_bones() -> void:
	var box: VBoxContainer = ui["bones"]
	for c in box.get_children():
		c.queue_free()
	if driver == null or driver.skel == null:
		box.add_child(EditorStyle.hint("Load a driver model first."))
		return
	var names := []
	for i in driver.skel.get_bone_count():
		names.append(BoneIK.browser_name(driver.skel.get_bone_name(i)))
	# (a rig with many control bones, Rigify: the deform bones first, the ones that move the mesh)
	names.sort_custom(func(a: String, b: String): return a.begins_with("DEF-") and not b.begins_with("DEF-"))
	var items := [["", "(none)"]]
	for n in names:
		items.append([n, n])
	var now := driver.bone_config()
	for role in ROLES:
		for i in 3:
			_bone_row(box, items, role[0], i, "%s: %s" % [role[1], role[2][i]], str(now[role[0]][i]) if now.has(role[0]) else _bone_name(driver.bones[role[0]][i]))
	_bone_row(box, items, "chest", -1, "Chest (the bone that the shoulders hang on)", str(now.get("chest", "")))
	_bone_row(box, items, "hips", -1, "Hips", str(now.get("hips", "")))
	_bone_row(box, items, "head", -1, "Head (hidden in the cockpit view)", str(now.get("head", "")))


func _bone_name(b: int) -> String:
	return BoneIK.browser_name(driver.skel.get_bone_name(b)) if b >= 0 else ""


func _bone_row(box: VBoxContainer, items: Array, key: String, index: int, label: String, value: String) -> void:
	var o := EditorStyle.options(items, value)
	o.item_selected.connect(func(_i: int):
		var v: String = str(EditorStyle.value_of(o))
		var bones: Dictionary = driver.cfg["bones"]
		if index < 0:
			if v == "":
				bones.erase(key)
			else:
				bones[key] = v
		else:
			var list: Array = bones[key].duplicate() if bones.get(key) is Array else []
			if list.size() < 3:
				for b in driver.bones[key]:
					list.append(_bone_name(b))
				list = list.slice(list.size() - 3)
			list[index] = v if v != "" else null
			bones[key] = list
		driver.resolve_bones()
		_info()
		_changed())
	box.add_child(EditorStyle.labelled(o, label, false))


# ---- the gizmo and the selection

func select(key: String) -> void:
	selected = "" if selected == key else key
	if selected != "" and ed.layers.selected != "":
		ed.layers.select(ed.layers.selected)
	_refresh_keys()
	_attach()


func _deselect() -> void:
	if selected != "":
		selected = ""
		_attach()


func _node_of(key: String) -> Node3D:
	if key == "model":
		return driver.root if driver != null else null
	return targets.get(key)


func _attach() -> void:
	var g := ed.view.gizmo
	if g.target != null and (g.target == ring or targets.values().has(g.target) or (driver != null and g.target == driver.root)):
		g.detach()
	if selected != "" and driver != null:
		var how := "move"
		if TORSO.has(selected):
			how = "rotate"
		elif selected in TURNABLE:
			how = mode
		g.attach(_node_of(selected), how)
	_mark_buttons()


func _mark_buttons() -> void:
	for k in ui["places"]:
		EditorStyle.style_button(ui["places"][k], "small accent" if k == selected else "small")
	for m in ui["mode_buttons"]:
		EditorStyle.style_button(ui["mode_buttons"][m], "small accent" if m == mode else "small ghost")
	var hand := HAND_SIDE.has(selected)
	ui["modes"].visible = selected in TURNABLE
	ui["grip_box"].visible = hand and driver != null
	if hand and driver != null:
		_quiet = true
		var g := float(driver.cfg["hands"]["grip"][HAND_SIDE[selected]])
		(ui["grip"] as HSlider).value = roundf(g * 100.0)
		ui["grip_label"].text = "Grip of this hand %d%% (the fingers, open to closed)" % roundi(g * 100.0)
		EditorStyle.select_value(ui["curl"], driver.cfg.get("grip_curl", "x"))
		_quiet = false


## A click in the view (CarEditor._on_view_click): a node of the driver, the figure; true when it was taken.
func click(mouse: Vector2) -> bool:
	if not editing or driver == null or ed.bench.car != null:
		return false
	var list := []
	for k in targets:
		list.append(targets[k])
	list.append(ring.get_child(1))
	var hit := ed.view.pick_marker(mouse, list)
	if hit.begins_with("drv:"):
		var key := hit.substr(4)
		if key != selected:
			select(key)
		return true
	return true


## A key (CarEditor._unhandled_key_input): Escape stops editing, W moves, E turns; true when it was used.
func key(code: Key) -> bool:
	if not editing:
		return false
	if code == KEY_ESCAPE:
		set_editing(false)
		return true
	if selected in TURNABLE and (code == KEY_W or code == KEY_E):
		mode = "move" if code == KEY_W else "rotate"
		_attach()
		return true
	return false


## The gizmo moved something: the config follows.
func _moved() -> void:
	if driver == null or selected == "" or ed.view.gizmo.target != _node_of(selected):
		return
	var c := driver.cfg
	var t: Node3D = _node_of(selected)
	if _moved_on_bike(t):
		_refresh_keys()
		_sync_fields()
		_changed(false)
		return
	if TORSO.has(selected) and driver.keys_any():
		driver.set_torso_key(selected, steer, BoneIK.euler_deg(t.basis))
	elif HAND_SIDE.has(selected) and driver.keys_active():
		_set_hand_key(HAND_SIDE[selected])
	elif selected == "wheel":
		_carry_hands()
		_ring_to_config()
	elif selected == "model":
		c["position"] = BoneIK.arr(t.position)
		c["rotation"] = BoneIK.arr(BoneIK.euler_deg(t.basis))
	elif TORSO.has(selected):
		c[selected] = {"rotation": BoneIK.arr(BoneIK.euler_deg(t.basis))}
	elif POLES.has(selected):
		if not (c.get("poles") is Dictionary):
			c["poles"] = {}
		c["poles"][POLES[selected]] = BoneIK.arr(t.position)
	elif HAND_SIDE.has(selected) and mode == "rotate":
		c["hands"]["rotation"][HAND_SIDE[selected]] = BoneIK.arr(BoneIK.euler_deg(t.basis))
	elif HAND_SIDE.has(selected):
		c["hands"][HAND_SIDE[selected]] = BoneIK.arr(t.position)
	elif mode == "rotate":
		c["feet"]["rotation"]["left" if selected == "footL" else "right"] = BoneIK.arr(BoneIK.euler_deg(t.basis))
	else:
		c["feet"]["left" if selected == "footL" else "right"] = BoneIK.arr(t.position)
	_refresh_keys()
	_sync_fields()
	_changed(false)


## A motorcycle: a hand or a foot is where it is from its grip or its peg (the offset that the game uses). The turn goes in as on a car.
func _moved_on_bike(t: Node3D) -> bool:
	if not ed.is_bike() or mode != "move" or not (HAND_SIDE.has(selected) or selected == "footL" or selected == "footR") or not _find_bike_parts():
		return false
	var hand := HAND_SIDE.has(selected)
	var side: String = HAND_SIDE[selected] if hand else ("left" if selected == "footL" else "right")
	var part: Node3D = _bike_parts[("grip_" if hand else "peg_") + side]
	driver.cfg["hands" if hand else "feet"]["offset"][side] = BoneIK.arr(CarModel.relative(part, body).affine_inverse() * t.position)
	return true


func _sync_targets() -> void:
	var c := driver.cfg
	for e in [["handL", "left"], ["handR", "right"]]:
		targets[e[0]].transform = Transform3D(BoneIK.euler(BoneIK.vec(c["hands"]["rotation"][e[1]])), BoneIK.vec(c["hands"][e[1]]))
	for e in [["footL", "left"], ["footR", "right"]]:
		targets[e[0]].transform = Transform3D(BoneIK.euler(BoneIK.vec(c["feet"]["rotation"][e[1]])), BoneIK.vec(c["feet"][e[1]]))


func _sync_fields() -> void:
	if driver == null:
		return
	_quiet = true
	var c := driver.cfg
	var f: Dictionary = ui["fields"]
	for i in 3:
		(f["p%d" % i] as EditorStyle.NumberField).set_value(float(c["position"][i]))
		(f["r%d" % i] as EditorStyle.NumberField).set_value(float(c["rotation"][i]))
	(f["scale"] as EditorStyle.NumberField).set_value(float(c["scale"]))
	(f["travel"] as EditorStyle.NumberField).set_value(roundf(float(c["feet"]["travel"]) * 100.0))
	(f["elbow"] as EditorStyle.NumberField).set_value(float(c["elbow_out"]))
	(f["knee"] as EditorStyle.NumberField).set_value(float(c["knee_out"]))
	(f["radius"] as EditorStyle.NumberField).set_value(snappedf(ring.basis.get_scale().x, 0.001))
	_quiet = false


func _grip_changed(v: float) -> void:
	if driver == null or _quiet or not HAND_SIDE.has(selected):
		return
	var side: String = HAND_SIDE[selected]
	if driver.keys_active():
		_set_hand_key(side, v / 100.0)
	else:
		driver.cfg["hands"]["grip"][side] = v / 100.0
	ui["grip_label"].text = "Grip of this hand %d%% (the fingers, open to closed)" % roundi(v)
	_changed(false)


# ---- the ring of the hands: its place, its turn and its size are what the hands turn about (the steering wheel of the
# model stays where it is: the ring is matched to it)

func _ring_from_config() -> void:
	if driver == null:
		return
	var c := driver.cfg
	var w: Variant = c.get("wheel")
	if w is Dictionary and (w as Dictionary).get("position") is Array:
		var r := maxf(0.03, float(w.get("radius", 0.15)))
		ring.transform = Transform3D(BoneIK.euler(BoneIK.vec(w.get("rotation", [0, 0, 0]))).scaled(Vector3.ONE * r), BoneIK.vec(w["position"]))
	else:
		var l := BoneIK.vec(c["hands"]["left"])
		var rr := BoneIK.vec(c["hands"]["right"])
		ring.transform = Transform3D(Basis(Quaternion(Vector3.BACK, Vector3(0, 0.3, -1).normalized())).scaled(Vector3.ONE * maxf(0.05, l.distance_to(rr) / 2.0)),
			(l + rr) / 2.0)
	_ring_was = _ring_pose()


func _ring_pose() -> Transform3D:
	return Transform3D(ring.basis.orthonormalized(), ring.position)


## The ring was moved or turned: the two hands (and their keys) go with it, as children of it.
func _carry_hands() -> void:
	var now := _ring_pose()
	var d := now * _ring_was.affine_inverse()
	_ring_was = now
	var c := driver.cfg
	for side in ["left", "right"]:
		c["hands"][side] = BoneIK.arr(d * BoneIK.vec(c["hands"][side]), 0.0001)
		c["hands"]["rotation"][side] = BoneIK.arr(BoneIK.euler_deg(d.basis * BoneIK.euler(BoneIK.vec(c["hands"]["rotation"][side]))))
		var keys: Variant = c["keys"].get(side) if c.get("keys") is Dictionary else null
		if keys is Array:
			for k in keys:
				if k.has("pos"):
					k["pos"] = BoneIK.arr(d * BoneIK.vec(k["pos"]), 0.0001)
				if k.has("rot"):
					k["rot"] = BoneIK.arr(BoneIK.euler_deg(d.basis * BoneIK.euler(BoneIK.vec(k["rot"]))), 0.1)
	_sync_targets()


func _ring_to_config() -> void:
	driver.cfg["wheel"] = {"position": BoneIK.arr(ring.position), "rotation": BoneIK.arr(BoneIK.euler_deg(ring.basis)),
		"radius": snappedf(ring.basis.get_scale().x, 0.001)}


func _ring_axis() -> Vector3:
	return (ring.basis.orthonormalized() * Vector3.BACK).normalized()


# ---- the keys

func _set_hand_key(side: String, grip_override := -1.0) -> void:
	var m: Node3D = targets["handL" if side == "left" else "handR"]
	var grip: float = grip_override if grip_override >= 0.0 else float(driver.hand_pose[side]["grip"])
	driver.set_key(side, steer, m.position, m.basis.orthonormalized().get_rotation_quaternion(), grip)
	_refresh_keys()


func _refresh_keys() -> void:
	(ui["strip"] as Control).queue_redraw()
	var rides: CheckBox = ui["rides"]
	if driver == null or not driver.keys_any():
		ui["key_info"].text = "No keys: the hands move by themselves."
		rides.disabled = true
		return
	var side: String = KEY_NAME.get(selected, "")
	var k: Variant = driver.key_at(side, steer) if side != "" else null
	rides.disabled = not (k is Dictionary) or not HAND_SIDE.has(selected)
	rides.set_pressed_no_signal(k is Dictionary and bool(k.get("wheel", false)))
	var counts := []
	for n in ["left", "right", "chest", "head"]:
		var list: Variant = driver.cfg["keys"].get(n)
		counts.append((list as Array).size() if list is Array else 0)
	var here := "Take a hand, the chest or the head to set keys."
	if side != "":
		here = ("A key of this one is here (%s°)." % str(k["t"])) if k is Dictionary else "No key of this one here."
	ui["key_info"].text = "Keys: left hand %d, right hand %d, chest %d, head %d. %s" % [counts[0], counts[1], counts[2], counts[3], here]


func _draw_strip(strip: Control) -> void:
	var w := strip.size.x
	strip.draw_line(Vector2(w / 2.0, 0), Vector2(w / 2.0, 32), Color(1, 1, 1, 0.15))
	if driver == null or not (driver.cfg.get("keys") is Dictionary):
		return
	for e in KEY_COLOURS:
		var list: Variant = driver.cfg["keys"].get(e[0])
		if not list is Array:
			continue
		for k in list:
			var x := (float(k["t"]) + 450.0) / 900.0 * w
			strip.draw_rect(Rect2(x - 2.5, float(e[2]), 5, 7), e[1])
	var at := (steer + 450.0) / 900.0 * w
	strip.draw_line(Vector2(at, 0), Vector2(at, 32), EditorStyle.ACCENT, 1.5)


func _strip_click(strip: Control, e: InputEvent) -> void:
	var mb := e as InputEventMouseButton
	if mb == null or not mb.pressed or mb.button_index != MOUSE_BUTTON_LEFT or driver == null or not (driver.cfg.get("keys") is Dictionary):
		return
	var best := 8.0
	var t: Variant = null
	for side in ["left", "right", "chest", "head"]:
		var list: Variant = driver.cfg["keys"].get(side)
		for k in (list if list is Array else []):
			var d := absf((float(k["t"]) + 450.0) / 900.0 * strip.size.x - mb.position.x)
			if d < best:
				best = d
				t = float(k["t"])
	if t != null:
		(ui["steer"] as HSlider).value = t


func _bake() -> void:
	if driver == null:
		ed.status("Load the driver model first.", "error")
		return
	_frame_steering()
	if driver.bake_keys():
		ed.status("Keys made from the automatic movement. Turn the steering slider to a key and move a hand to change it.", "ok")
		_refresh_keys()
		_changed()
	else:
		ed.status("The keys could not be made.", "error")


func _keys_off() -> void:
	if driver == null:
		return
	driver.cfg["keys"] = null
	_sync_targets()
	_refresh_keys()
	_changed()


func _mirror() -> void:
	if driver == null or not driver.keys_any():
		ed.status("Make keys first.", "error")
		return
	var made := driver.mirror_keys()
	ed.status(("%d keys mirrored to the negative side (what was there is replaced)." % made) if made > 0 else "There are no keys on the positive side to mirror.",
		"ok" if made > 0 else "error")
	_refresh_keys()
	_changed()


func _key_add() -> void:
	var side: String = KEY_NAME.get(selected, "")
	if driver == null or side == "":
		ed.status("Take a hand, the chest or the head first.", "error")
		return
	if not driver.keys_any():
		ed.status("Make keys first.", "error")
		return
	if HAND_SIDE.has(selected):
		_set_hand_key(side)
	else:
		driver.set_torso_key(side, steer, BoneIK.euler_deg((targets[selected] as Node3D).basis))
		_refresh_keys()
	_changed()


func _key_del() -> void:
	var side: String = KEY_NAME.get(selected, "")
	if driver != null and side != "":
		driver.remove_key(side, steer)
		_refresh_keys()
		_changed()


func _rides_toggled(on: bool) -> void:
	var side: String = HAND_SIDE.get(selected, "")
	if driver == null or side == "" or not (driver.key_at(side, steer) is Dictionary):
		return
	var pose: Dictionary = driver.hand_pose[side]
	driver.set_key(side, steer, pose["pos"], pose["quat"], pose["grip"], on)
	_refresh_keys()
	_changed()


# ---- every frame: the ring, the steering wheel of the model and the driver, turned by the slider

func _frame_steering() -> void:
	driver.steering = {"axis": _ring_axis(), "centre": ring.position, "degrees": 450.0, "angle": -steer * CarDriver.DEG}


func frame(dt: float) -> void:
	# (the test bench: the car of the game has its own driver; the figure of the card is out of the way meanwhile)
	var bench := ed.bench.car != null
	if bench != _bench_was:
		_bench_was = bench
		if driver != null:
			driver.root.visible = enabled and not bench
		set_editing(editing and not bench)
	if driver == null or not enabled or bench:
		return
	var g := ed.view.gizmo
	if selected != "" and g.target != _node_of(selected):
		selected = ""
		_mark_buttons()
	if not (selected == "wheel" and g.dragging):
		_ring_from_config()
	_frame_steering()
	if wheel != null and is_instance_valid(wheel.node):
		# (the steering wheel of the model turns with the slider, about the ring)
		wheel.to_body = CarModel.relative(wheel.node.get_parent(), body) if wheel.node.get_parent() is Node3D else Transform3D.IDENTITY
		wheel.turn(-steer * CarDriver.DEG, ring.position, _ring_axis())
	if ed.is_bike():
		_pose_on_bike()
	else:
		driver.update(dt, throttle, brake)
	_frame_markers(g)


## A motorcycle: the hands on the grips and the feet on the pegs of the model, as the game has him in his neutral posture (MotorcycleRider.update); the chest and the head as they
## are set. Without the grips and the pegs in the model only the chest and the head.
func _pose_on_bike() -> void:
	if not driver.complete():
		return
	var skel := driver.skel
	skel.reset_bone_poses()
	var to_body := driver._to_body()
	var to_skel := to_body.affine_inverse()
	driver._torso(to_skel.basis)
	if not _find_bike_parts():
		return
	var cfg := driver.cfg
	var left_arm := "armL" if driver._body_pos(driver.bones["armL"][0]).x >= driver._body_pos(driver.bones["armR"][0]).x else "armR"
	var left_leg := "legL" if driver._body_pos(driver.bones["legL"][0]).x >= driver._body_pos(driver.bones["legR"][0]).x else "legR"
	var hands: Dictionary = cfg.get("hands", {}) if cfg.get("hands") is Dictionary else {}
	var hand_off: Dictionary = hands.get("offset", {}) if hands.get("offset") is Dictionary else {}
	var hand_turn: Dictionary = hands.get("rotation", {}) if hands.get("rotation") is Dictionary else {}
	var rot := to_skel.basis.orthonormalized()
	for e in [[left_arm, "left", 1.0], ["armR" if left_arm == "armL" else "armL", "right", -1.0]]:
		var chain: Array = driver.bones[e[0]]
		var target: Vector3 = CarModel.relative(_bike_parts["grip_" + e[1]], body) * BoneIK.vec(hand_off.get(e[1], [0, 0, 0]))
		BoneIK.solve(skel, chain, to_skel * target, to_skel * driver._pole(e[0], driver._body_pos(chain[0]) + Vector3(float(e[2]) * 0.45, -0.25, -0.35)))
		_marker_at("handL" if e[1] == "left" else "handR", target, hand_turn.get(e[1], [0, 0, 0]))
		var hand := to_body.basis.orthonormalized() * BoneIK.global(skel, chain[2]).basis.orthonormalized()
		BoneIK.set_global_basis(skel, chain[2], rot * (BoneIK.euler(BoneIK.vec(hand_turn.get(e[1], [0, 0, 0]))) * hand))
	var feet: Dictionary = cfg.get("feet", {}) if cfg.get("feet") is Dictionary else {}
	var foot_off: Dictionary = feet.get("offset", {}) if feet.get("offset") is Dictionary else {}
	var foot_turn: Dictionary = feet.get("rotation", {}) if feet.get("rotation") is Dictionary else {}
	for e in [[left_leg, "left", 1.0], ["legR" if left_leg == "legL" else "legL", "right", -1.0]]:
		var chain: Array = driver.bones[e[0]]
		var target: Vector3 = CarModel.relative(_bike_parts["peg_" + e[1]], body) * BoneIK.vec(foot_off.get(e[1], [0, 0, 0]))
		BoneIK.solve(skel, chain, to_skel * target, to_skel * driver._pole(e[0], driver._body_pos(chain[0]) + Vector3(float(e[2]) * 0.3, 0.1, 0.8)))
		var foot := to_body.basis.orthonormalized() * BoneIK.global(skel, chain[2]).basis.orthonormalized()
		BoneIK.set_global_basis(skel, chain[2], rot * (BoneIK.euler(BoneIK.vec(foot_turn.get(e[1], [0, 0, 0]))) * foot))
		_marker_at("footL" if e[1] == "left" else "footR", target, foot_turn.get(e[1], [0, 0, 0]))


## A ball of a hand or a foot stands where that hand or foot is (not while it is being dragged).
func _marker_at(key: String, at: Vector3, turn: Variant) -> void:
	if ed.view.gizmo.dragging and selected == key:
		return
	(targets[key] as Node3D).transform = Transform3D(BoneIK.euler(BoneIK.vec(turn)), at)


## The grips and the pegs of the model (grip_L/R, footpeg_L/R), looked for once per model; false when one is missing.
func _find_bike_parts() -> bool:
	var valid := _bike_parts.size() == 4 and _bike_parts.values().all(func(n: Variant) -> bool: return is_instance_valid(n))
	if valid:
		return true
	_bike_parts.clear()
	var wanted := {"gripl": "grip_left", "gripr": "grip_right", "footpegl": "peg_left", "footpegr": "peg_right"}
	if ed.model_root == null:
		return false
	for n in ed.model_root.find_children("*", "Node3D", true, false):
		var k := BoneIK.key(str(n.name))
		if wanted.has(k):
			_bike_parts[wanted[k]] = n
	return _bike_parts.size() == 4


func _frame_markers(g: EditorGizmo) -> void:
	if not marks.visible or not driver.complete():
		return
	if driver.keys_active():
		for e in [["handL", "left"], ["handR", "right"]]:
			if g.dragging and selected == e[0]:
				continue
			var pose: Dictionary = driver.hand_pose[e[1]]
			targets[e[0]].transform = Transform3D(Basis(pose["quat"]), pose["pos"])
			if selected == e[0] and not g.dragging:
				_quiet = true
				(ui["grip"] as HSlider).value = roundf(float(pose["grip"]) * 100.0)
				_quiet = false
	var tb := CarModel.relative(driver.skel, body)
	for k in TORSO:
		if g.dragging and selected == k:
			continue
		var b: int = driver.bones["chest"][0] if k == "chest" and not (driver.bones["chest"] as Array).is_empty() else (driver.bones["head"] if k == "head" else -1)
		var p: Vector3 = tb * BoneIK.global(driver.skel, b).origin if b >= 0 else Vector3.ZERO
		targets[k].transform = Transform3D(BoneIK.euler(driver.torso_pose[k]), p)
	for k in POLES:
		if g.dragging and selected == k:
			continue
		if driver.poles.has(POLES[k]):
			targets[k].position = driver.poles[POLES[k]]
