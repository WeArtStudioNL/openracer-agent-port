# gdlint: disable=max-public-methods
class_name CarEditor
extends Control
## The car editor (web/tools/car-editor.html and car-editor.js): import a glTF or glb model, show it with the places of the
## wheels, set up the car (size, chassis, drivetrain, engine, brakes, materials, cameras, exhaust points, the suspension
## of the parts library, the settings of the tuning menu) and save it as cars/<id>/ (car.json and the model files): in
## the garage (user://garage/cars/<id>/), or, when the game runs from the repository, in web/cars/<id>/ (as the browser
## saves through tools/serve.py). A car that exists is opened from the list and saved over itself, or under a new id.
## The side bar has the cards of the browser editor in its order, the middle the 3D view, the right the layers.
##
## The car being edited is one dictionary, cfg (the car.json as the form has it): every field reads and writes its path
## in it, and build_config() makes the car.json that is saved from it (the checks of the browser's buildConfig).
## The Soft body and the Driver cards are ported apart: a script at CARD_HOOKS, when it is there, fills its card (setup,
## fill, read; see the README).

signal closed
signal test_drive(car_id: String, track_id: String)

const SLOTS := ["FR", "FL", "RL", "RR"]
const SLOT_COLOURS := {"FR": Color("#ff6b6b"), "FL": Color("#5ec8ff"), "RL": Color("#8ee26b"), "RR": Color("#ffd04d")}
const SLOT_NAMES := {"FR": "Front right", "FL": "Front left", "RR": "Rear right", "RL": "Rear left"}
const ID_PATTERN := "^[a-z0-9][a-z0-9_-]{0,63}$"
const FILE_PATTERN := "^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$"
const WHEEL_NAME := "(?i)wheel|tyre|tire|rim|felg|wiel|rueda|roue|ruota|velg|alloy"
const GLASS_NAME := "(?i)glass|window|windscreen|windshield|ruit"
const CARD_HOOKS := {"Soft body": "res://scripts/editor/car_editor_softbody.gd", "Driver": "res://scripts/editor/car_editor_driver.gd"}
const DEFAULT_CURVE := [[0, 0], [300, 80], [1000, 180], [2000, 230], [3000, 250], [4000, 255], [5000, 250], [6000, 225], [7000, 170]]
const BIKE_DEFAULTS := {"max_lean_deg": 52, "fast_lean_deg": 30, "rake_deg": 24.5, "rider_mass": 80, "hang_off": 0.3, "max_lateral_g": 0.9,
	"balance": 1, "fork_dive": 1, "push": false, "push_foot_kmh": 110}

var cfg := {}                        # the car as the form has it (car.json)
var car_id := ""                     # the id (the folder): the Id field
var id_edited := false
var existing_id := ""                # the car that is open (saving overwrites it)
var existing := {}                   # its car.json as it was loaded
var model_files: PackedStringArray = []    # the files that were picked for a new model (absolute paths)
var main_file := ""                  # the name of the glb or gltf among them
var replaced_model := {}             # the model block that a new model replaces
var model_root: Node3D = null
var nodes: Array = []                # the named objects of the model: { name, depth, node }
var wheel_parts := {"FR": [], "FL": [], "RL": [], "RR": []}
var wheel_radio := "default"         # Dynamic wheels ("default") or Wheels from model ("model")
var overrides := {}                  # the changes to the materials: material name -> { field: value }
var auto_glass := false
var dirty := false
var cars: Array = []                 # { id, name, source }
var save_to_repo := false            # save in web/cars (the game runs from the repository) instead of the garage
var save_root_override := ""         # (the tests) the folder the cars are saved in
var hooks := {}                      # the cards ported apart: name -> the object that fills it

var view: CarEditorView
var form: CarEditorForm
var engine: CarEditorEngine
var tuning: CarEditorTuning
var layers: CarEditorLayers
var suspension: CarEditorSuspension
var mats: CarEditorMaterials
var io: CarEditorIO
var bench: CarEditorBench

var side: PanelContainer
var cards_box: VBoxContainer
var card_of := {}                    # card title -> the card (EditorStyle.card)
var status_label: Label
var ready_button: Button
var changes_button: Button
var delete_button: Button
var save_drive_button: Button
var summary_label: Label
var wheelie_label: Label
var existing_pick: OptionButton
var save_where: OptionButton
var tuning_bar_parent: VBoxContainer

var _bound: Array = []               # the fields that show a path of cfg: { field, path, scale, kind }
var _refreshing := false
var _undo: Array = []
var _redo: Array = []
var _last_shot: Variant = null
var _remember_timer := 0.0
var _baseline: Variant = null
var _tick := 0.0


func _ready() -> void:
	name = "CarEditor"
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	theme = EditorStyle.make_theme()
	io = CarEditorIO.new(self)
	bench = CarEditorBench.new(self)
	var bg := ColorRect.new()
	bg.color = EditorStyle.BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var hbox := HBoxContainer.new()
	hbox.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hbox.add_theme_constant_override("separation", 0)
	add_child(hbox)
	_build_side(hbox)
	view = CarEditorView.new()
	view.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	view.size_flags_vertical = Control.SIZE_EXPAND_FILL
	hbox.add_child(view)
	layers = CarEditorLayers.new(self)
	hbox.add_child(layers.build())
	view.clicked.connect(_on_view_click)
	view.gizmo_moved.connect(func(): layers.gizmo_moved())
	view.gizmo_released.connect(func(): changed())
	form = CarEditorForm.new(self)
	suspension = CarEditorSuspension.new(self)
	engine = CarEditorEngine.new(self)
	tuning = CarEditorTuning.new(self)
	mats = CarEditorMaterials.new(self)
	_build_cards()
	engine.build_test_bar()
	layers.build_view_tools()
	_refresh_list()
	var wanted := Content.arg("editor-car")
	if wanted != "" and _has_car(wanted):
		load_existing(wanted)
	else:
		new_car("car")
	_last_shot = _snapshot()


func _has_car(id: String) -> bool:
	for c in cars:
		if c["id"] == id:
			return true
	return false


# ---- the layout

func _build_side(parent: Control) -> void:
	side = PanelContainer.new()
	side.add_theme_stylebox_override("panel", EditorStyle.box(EditorStyle.SIDE, 0, 0))
	side.custom_minimum_size.x = 430
	parent.add_child(side)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	side.add_child(col)
	var header := MarginContainer.new()
	for s in ["left", "right"]:
		header.add_theme_constant_override("margin_" + s, 16)
	header.add_theme_constant_override("margin_top", 12)
	header.add_theme_constant_override("margin_bottom", 10)
	col.add_child(header)
	var head := VBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	header.add_child(head)
	var line := HBoxContainer.new()
	head.add_child(line)
	var mark := ColorRect.new()
	mark.color = EditorStyle.ACCENT
	mark.custom_minimum_size = Vector2(12, 12)
	mark.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	line.add_child(mark)
	var title := EditorStyle.label("Car editor", 17, EditorStyle.TEXT, false)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(title)
	var back := EditorStyle.button("← Menu", "small ghost", "Back to the main menu")
	back.pressed.connect(_close)
	line.add_child(back)
	tuning_bar_parent = head
	var sep := ColorRect.new()
	sep.color = EditorStyle.LINE
	sep.custom_minimum_size.y = 1
	col.add_child(sep)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for s in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + s, 12)
	margin.add_theme_constant_override("margin_top", 12)
	margin.add_theme_constant_override("margin_bottom", 20)
	scroll.add_child(margin)
	cards_box = VBoxContainer.new()
	cards_box.add_theme_constant_override("separation", 10)
	cards_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_child(cards_box)
	var sep2 := ColorRect.new()
	sep2.color = EditorStyle.LINE
	sep2.custom_minimum_size.y = 1
	col.add_child(sep2)
	var footer := MarginContainer.new()
	for s in ["left", "right", "top", "bottom"]:
		footer.add_theme_constant_override("margin_" + s, 10)
	col.add_child(footer)
	var bar := HBoxContainer.new()
	footer.add_child(bar)
	changes_button = EditorStyle.button("Changes", "small ghost", "What is different from the last saved version")
	changes_button.visible = false
	changes_button.pressed.connect(_show_changes)
	bar.add_child(changes_button)
	ready_button = EditorStyle.button("", "small ghost", "What is missing before you can save")
	ready_button.pressed.connect(func():
		var list := problems()
		status(" · ".join(list) if not list.is_empty() else "Nothing is missing.", "error" if not list.is_empty() else "ok"))
	bar.add_child(ready_button)
	status_label = EditorStyle.label("", 12, EditorStyle.MUTED, false)
	status_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	status_label.clip_text = true
	status_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	status_label.mouse_filter = Control.MOUSE_FILTER_PASS
	bar.add_child(status_label)
	delete_button = EditorStyle.button("Delete", "small danger", "Delete this car (it goes to the Trash)")
	delete_button.visible = false
	delete_button.pressed.connect(delete_car)
	bar.add_child(delete_button)
	save_drive_button = EditorStyle.button("Save and test", "small", "Save the car and drive it on a track")
	save_drive_button.pressed.connect(save_and_test)
	bar.add_child(save_drive_button)



func _build_cards() -> void:
	tuning.build_setup_bar(tuning_bar_parent)
	summary_label = EditorStyle.hint("")
	tuning_bar_parent.add_child(summary_label)
	wheelie_label = EditorStyle.hint("", EditorStyle.WARN)
	tuning_bar_parent.add_child(wheelie_label)
	form.build_car_card()
	form.build_model_card()
	form.build_wheels_card()
	suspension.build_card()
	form.build_chassis_card()
	form.build_bike_card()
	form.build_drivetrain_card()
	engine.build_engine_card()
	engine.build_sound_card()
	add_card("Assists and extras")
	form.build_cameras_card()
	for hook_name in ["Soft body", "Driver"]:
		_hook_card(hook_name)
	mats.build_card()
	tuning.build_groups()


func add_card(title: String) -> Dictionary:
	var c := EditorStyle.card(cards_box, title)
	card_of[title] = c
	return c


func body_of(title: String) -> VBoxContainer:
	return card_of[title]["body"] if card_of.has(title) else card_of["Chassis"]["body"]


## A card ported apart (the Soft body, the Driver): its script fills it when it is there; until then the card says so.
func _hook_card(title: String) -> void:
	var c := add_card(title)
	var path: String = CARD_HOOKS[title]
	if ResourceLoader.exists(path):
		var script: Variant = load(path)
		if script is GDScript:
			var hook: Object = (script as GDScript).new()
			hooks[title] = hook
			if hook.has_method("setup"):
				hook.call("setup", self, c["body"])
			return
	c["meta"].text = "not ported yet"
	c["body"].add_child(EditorStyle.hint("This card of the browser editor (" + ("softbody-editor.js" if title == "Soft body" else "driver-editor.js") +
		") is ported separately. Until then the car keeps what its car.json has for it (\"" + ("softbody\", \"parts" if title == "Soft body" else "driver") +
		"\") when it is saved."))


func _hook_call(method: String, args := []) -> void:
	for h in hooks.values():
		if h != null and h.has_method(method):
			h.callv(method, args)


## A card ported apart that takes a click in the view or a key first (the Driver: its nodes): true when one took it.
func _hook_wants(method: String, args: Array) -> bool:
	for h in hooks.values():
		if h != null and h.has_method(method) and h.callv(method, args):
			return true
	return false


func _close() -> void:
	if dirty and not await ask("Leave the car editor?", "The car has changes that are not saved. They are lost.", "Leave", "Stay"):
		return
	engine.stop_sound()
	closed.emit()


# ---- messages

func status(text: String, kind := "") -> void:
	status_label.text = text.replace("\n", " ")
	status_label.tooltip_text = text
	status_label.add_theme_color_override("font_color", EditorStyle.ERROR if kind == "error" else (EditorStyle.OK if kind == "ok" else
		(EditorStyle.WARN if kind == "warn" else EditorStyle.MUTED)))
	view.show_toast(text, kind)
	if text != "":
		RunLog.event("car editor: " + text.replace("\n", " "))


## A question with two answers (the browser's OpenRacerDialog.ask): true for ok.
func ask(title: String, text: String, ok := "OK", cancel := "Cancel") -> bool:
	var d := ConfirmationDialog.new()
	d.title = title
	d.dialog_text = text
	d.ok_button_text = ok
	d.cancel_button_text = cancel
	d.dialog_autowrap = true
	d.min_size = Vector2i(420, 0)
	add_child(d)
	var result := [false]
	d.confirmed.connect(func(): result[0] = true)
	d.popup_centered()
	await d.visibility_changed
	d.queue_free()
	return result[0]


## A name asked for (the browser's prompt): "" when it was cancelled.
func ask_text(title: String, text: String, value := "") -> String:
	var d := ConfirmationDialog.new()
	d.title = title
	d.min_size = Vector2i(420, 0)
	var box := VBoxContainer.new()
	box.add_child(EditorStyle.label(text, 13))
	var edit := EditorStyle.line_edit(value)
	box.add_child(edit)
	d.add_child(box)
	add_child(d)
	var result := [""]
	d.confirmed.connect(func(): result[0] = edit.text.strip_edges())
	edit.text_submitted.connect(func(_t: String): result[0] = edit.text.strip_edges(); d.hide())
	d.popup_centered()
	edit.grab_focus.call_deferred()
	await d.visibility_changed
	d.queue_free()
	return result[0]


# ---- the fields: each shows a path of cfg (scale: what is shown is the value times the scale)

func bind_number(parent: Control, path: String, hint_text: String, step: float, lo := NAN, hi := NAN, scale := 1.0, placeholder := "",
		on_change := Callable(), allow_empty := false) -> EditorStyle.NumberField:
	var f := EditorStyle.NumberField.new(hint_text, step, lo, hi, placeholder)
	parent.add_child(f)
	var entry := {"field": f, "path": path, "scale": scale, "kind": "number"}
	_bound.append(entry)
	f.edited.connect(func(v: float):
		if _refreshing:
			return
		Tuning.write(cfg, path, v / scale)
		if on_change.is_valid():
			on_change.call()
		changed(false))
	f.committed.connect(func(v: float):
		if _refreshing:
			return
		if is_nan(v):
			if allow_empty:
				Tuning.erase(cfg, path)
				if on_change.is_valid():
					on_change.call()
			else:
				_show_field(entry)
		changed())
	return f


func bind_text(parent: Control, path: String, placeholder := "", on_change := Callable()) -> LineEdit:
	var e := EditorStyle.line_edit("", placeholder)
	parent.add_child(e)
	_bound.append({"field": e, "path": path, "kind": "text"})
	e.text_changed.connect(func(t: String):
		if _refreshing:
			return
		Tuning.write(cfg, path, t.strip_edges())
		if on_change.is_valid():
			on_change.call()
		changed(false))
	e.focus_exited.connect(func(): changed())
	return e


func bind_select(parent: Control, path: String, items: Array, on_change := Callable(), fallback: Variant = null) -> OptionButton:
	var o := EditorStyle.options(items)
	parent.add_child(o)
	_bound.append({"field": o, "path": path, "kind": "select", "fallback": fallback if fallback != null else items[0][0]})
	o.item_selected.connect(func(_i: int):
		if _refreshing:
			return
		Tuning.write(cfg, path, EditorStyle.value_of(o))
		if on_change.is_valid():
			on_change.call()
		changed())
	return o


func bind_check(parent: Control, path: String, text: String, on_change := Callable(), fallback := false) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.focus_mode = Control.FOCUS_NONE
	parent.add_child(c)
	_bound.append({"field": c, "path": path, "kind": "check", "fallback": fallback})
	c.toggled.connect(func(on: bool):
		if _refreshing:
			return
		Tuning.write(cfg, path, on)
		if on_change.is_valid():
			on_change.call()
		changed())
	return c


func _show_field(e: Dictionary) -> void:
	var v: Variant = Tuning.read(cfg, e["path"])
	match e["kind"]:
		"number":
			(e["field"] as EditorStyle.NumberField).set_value(float(v) * float(e["scale"]) if (v is float or v is int) else null)
		"text":
			var le := e["field"] as LineEdit
			if not le.has_focus():
				le.text = str(v) if v != null else ""
		"select":
			EditorStyle.select_value(e["field"], v if v != null else e["fallback"])
		"check":
			(e["field"] as CheckBox).set_pressed_no_signal(bool(v) if v != null else e["fallback"])


## Every field shows cfg again (a car was loaded, a tune, an undo).
func refresh_fields() -> void:
	_refreshing = true
	for e in _bound:
		if is_instance_valid(e["field"]):
			_show_field(e)
	_refreshing = false


func num(path: String, fallback := 0.0) -> float:
	var v: Variant = Tuning.read(cfg, path)
	return float(v) if (v is float or v is int) else fallback


## A change of the car: Save lights up, the ready check and the summary follow, and a step of undo is kept.
func changed(step := true) -> void:
	set_dirty(true)
	if step:
		_remember_timer = 0.3


func set_dirty(on: bool) -> void:
	dirty = on
	for b in [tuning.save_button, save_drive_button]:
		if b != null:
			b.text = b.text.trim_suffix(" •") + (" •" if on else "")
	changes_button.visible = on and not existing.is_empty()
	if not on:
		_baseline = null
		get_tree().create_timer(0.4).timeout.connect(func():
			if not dirty:
				_baseline = build_config(existing_id if existing_id != "" else car_id, true))
	refresh_ready()


# ---- the cars that exist

func _refresh_list(select := "") -> void:
	cars = io.list_cars()
	if existing_pick == null:
		return
	existing_pick.clear()
	existing_pick.add_item("Choose a car to change…")
	existing_pick.set_item_metadata(0, "")
	for c in cars:
		existing_pick.add_item("%s (%s)%s" % [c["name"], c["id"], " · my garage" if c["source"] == "garage" else (" · folder" if c["source"] == "folder" else "")])
		existing_pick.set_item_metadata(existing_pick.item_count - 1, c["id"])
	EditorStyle.select_value(existing_pick, select)


## A new car (or motorcycle): the defaults of the browser editor's form.
func new_car(kind := "car") -> void:
	engine.stop_sound()
	bench.stop()
	cfg = io.default_car(kind)
	car_id = ""
	id_edited = false
	existing_id = ""
	existing = {}
	model_files = []
	main_file = ""
	replaced_model = {}
	_set_root(null)
	nodes = []
	for s in SLOTS:
		wheel_parts[s] = []
	wheel_radio = "default"
	overrides = {}
	auto_glass = false
	cfg["cameras"] = io.camera_settings(cfg)
	_fill_all()
	form.model_info("No model loaded.")
	form.model_note("")
	form.editing_note("Choose a car to change it, or make a new one below. Saving a car that was chosen here overwrites it.")
	delete_button.visible = false
	if existing_pick != null:
		EditorStyle.select_value(existing_pick, "")
	set_dirty(false)
	status("")


## A car of the list into the form (the tune that is chosen for it in the game, as the browser does).
func load_existing(id: String) -> void:
	var raw: Variant = Content.load_json("cars/%s/car.json" % id)
	if not raw is Dictionary:
		status("Could not read cars/%s/car.json." % id, "error")
		return
	new_car()
	existing_id = id
	existing = raw
	var shown: Dictionary = (raw as Dictionary).duplicate(true)
	var tune_path: String = str(Settings.get_value("tunes").get(id, ""))
	var tune_note := ""
	if tune_path != "":
		var tuned := Tuning.load_tune(tune_path)
		if not tuned.is_empty():
			shown = tuned.duplicate(true)
			shown["model"] = raw.get("model", {})
			tune_note = " with the tune " + tune_path.get_file().trim_suffix(".openracer-tune.json")
	cfg = io.normalise(shown)
	car_id = id
	id_edited = true
	overrides = (shown.get("materials", raw.get("materials", {})) as Dictionary).duplicate(true) if shown.get("materials", raw.get("materials")) is Dictionary else {}
	auto_glass = not raw.has("materials")
	var w: Dictionary = cfg.get("wheels", {}) if cfg.get("wheels") is Dictionary else {}
	wheel_radio = "model" if w.get("mode") == "model" else "default"
	var given: Dictionary = w.get("nodes", {}) if w.get("nodes") is Dictionary else {}
	for s in SLOTS:
		wheel_parts[s] = (given.get(s, []) as Array).duplicate() if given.get(s) is Array else []
	_fill_all()
	delete_button.visible = true
	var m: Dictionary = cfg.get("model", {}) if cfg.get("model") is Dictionary else {}
	if str(m.get("type", "")) == "gltf" and m.has("file"):
		form.model_info("Loading " + str(m["file"]) + "…")
		var root := io.load_gltf(Content.path(str(m["file"])))
		if root == null:
			status("Could not load the model of this car (%s)." % m["file"], "error")
		else:
			set_model(root, false, false)
			form.model_info("%s, %d named parts" % [m["file"], nodes.size()])
	else:
		form.model_info("This car uses the model of the original demo. It cannot be changed here, but everything else can.")
	form.editing_note("Editing %s (cars/%s). Saving overwrites it; change the id to save a copy." % [cfg.get("name", id), id])
	form.model_note("A new model keeps the wheels, materials and settings where they still fit.")
	EditorStyle.select_value(existing_pick, id)
	set_dirty(false)
	_undo.clear()
	_redo.clear()
	_last_shot = _snapshot()
	status("Loaded %s%s." % [cfg.get("name", id), tune_note])


## Every card shows the car (after a load, a new car, a tune or an undo).
func _fill_all() -> void:
	refresh_fields()
	form.fill()
	engine.fill()
	suspension.fill()
	tuning.fill()
	layers.load_exhaust(cfg.get("exhaust", []))
	_hook_call("fill", [cfg])
	mats.render()
	update_helpers()
	layers.render()


# ---- the model

func _set_root(root: Node3D) -> void:
	if model_root != null and is_instance_valid(model_root):
		model_root.get_parent().remove_child(model_root)
		model_root.queue_free()
	model_root = root
	view.forget_meshes()
	if root != null:
		view.pivot.add_child(root)


## Files picked in the dialog (a .glb, or a .gltf with its .bin and textures).
func load_model_files(paths: PackedStringArray) -> void:
	var main := ""
	for p in paths:
		if p.get_extension().to_lower() == "glb":
			main = p
			break
	if main == "":
		for p in paths:
			if p.get_extension().to_lower() == "gltf":
				main = p
				break
	if main == "":
		status("Pick a .glb file, or a .gltf with its .bin and texture files.", "error")
		return
	var file_name := main.get_file()
	var re := RegEx.create_from_string(FILE_PATTERN)
	if re.search(file_name) == null and file_name.get_extension().to_lower() != "glb":
		status("The file name “%s” has characters that are not allowed. Rename the .gltf and its files on your disk (letters, digits, - _ . and spaces)." %
			file_name, "error")
		return
	if existing_id != "" and not await ask("Replace the model of “%s”?" % existing_id, "This car keeps its settings and gets the new model.", "Replace the model", "No"):
		if not await ask("Start a new car with this model?", "The car that is open now is closed" + (", with its changes that are not saved." if dirty else "."),
				"New car"):
			status("The model was not loaded.")
			return
		new_car(str(cfg.get("type", "car")))
	var root := io.load_gltf(main)
	if root == null:
		status("Could not read the model " + file_name + ".", "error")
		return
	model_files = paths
	main_file = io.safe_file_name(file_name)
	if main_file != file_name:
		status("The model is kept as “%s” (the name “%s” has characters that are not allowed in a file name of the game)." % [main_file, file_name])
	var replacing := existing_id != ""
	replaced_model = (cfg.get("model", {}) as Dictionary).duplicate(true) if cfg.get("model") is Dictionary else {}
	set_model(root, not replacing, replacing)
	changed()
	form.model_info("%s (%.1f MB), %d named parts" % [file_name, FileAccess.get_file_as_bytes(main).size() / 1048576.0, nodes.size()])
	if not replacing:
		_quick_setup(file_name)


func set_model(root: Node3D, is_new: bool, replace: bool) -> void:
	_set_root(root)
	CollisionProxy.hide_objects(root)
	mats.collect(root)
	var glass := RegEx.create_from_string(GLASS_NAME)
	if replace:
		var dropped := []
		for n in overrides.keys():
			if not mats.has_material(n):
				dropped.append(n)
				overrides.erase(n)
		form.replace_notes = ["Material changes dropped, the new model has no material of that name: " + ", ".join(dropped)] if not dropped.is_empty() else []
	elif is_new:
		overrides = {}
	if replace or is_new or auto_glass:
		for n in mats.names():
			if not overrides.has(n) and glass.search(n) != null and mats.plain_opaque(n):
				overrides[n] = CarEditorMaterials.PRESETS["Glass"].duplicate()
	mats.apply_all()
	mats.render()
	nodes = []
	_walk(root, 0)
	form.fill_wheel_lists()
	form.update_steering_info()
	if replace:
		form.replace_model()
	elif is_new:
		var m: Dictionary = cfg.get("model", {})
		m["rotation_y"] = 0
		m["scale"] = 1
		m["offset"] = [0, 0, 0]
		cfg["model"] = m
		refresh_fields()
		apply_transform()
		wheel_radio = "model" if is_bike() else "default"
		with_model_wheels(func():
			form.guess_wheels()
			if wheel_centers() != null:
				form.fit()
			form.size_from_model()
			if wheel_centers() != null:
				form.chassis_from_wheels())
		form.fill()
		form.default_cameras()
		view.frame_model()
	else:
		apply_transform()
		view.frame_model()
	update_helpers()
	layers.render()
	_hook_call("on_model", [root])


func _walk(n: Node, depth: int) -> void:
	if n != model_root and n is Node3D and str(n.name) != "":
		nodes.append({"name": str(n.name), "depth": depth, "node": n})
	for c in n.get_children():
		_walk(c, depth + 1)


func find_node_named(n: String) -> Node3D:
	for e in nodes:
		if e["name"] == n:
			return e["node"]
	return null


## A new model is set up by itself: the wheels are found, the car takes its size from them, the model goes on the floor.
func _quick_setup(file_name: String) -> void:
	with_model_wheels(func(): form.guess_wheels())
	var ok := true
	for s in SLOTS:
		if (wheel_parts[s] as Array).is_empty():
			ok = false
	if ok:
		with_model_wheels(func():
			form.chassis_from_wheels()
			form.fit()
			form.size_from_model())
	form.fill()
	update_helpers()
	if existing_id == "" and str(cfg.get("name", "")).strip_edges() == "":
		var n := file_name.get_basename().replace("_", " ").replace("-", " ").strip_edges()
		cfg["name"] = n
		if not id_edited:
			car_id = io.slug(n)
		refresh_fields()
		form.fill()
		tuning.render_setups()
	var dynamic := wheel_radio != "model"
	status("Ready: Save and test." if ok else ("No wheel parts found: the dynamic wheels stand at the wheelbase and the tracks of the Chassis card. Check them, then Save."
		if dynamic else "Pick the four wheels (Wheels card), then Save."), "ok" if ok or dynamic else "error")


func apply_transform() -> void:
	var m: Dictionary = cfg.get("model", {}) if cfg.get("model") is Dictionary else {}
	var off: Array = m.get("offset", [0, 0, 0]) if m.get("offset") is Array else [0, 0, 0]
	view.pivot.rotation = Vector3(0, deg_to_rad(float(m.get("rotation_y", 0))), 0)
	var s := float(m.get("scale", 1))
	view.pivot.scale = Vector3.ONE * (s if s > 0.0 else 1.0)
	view.pivot.position = Vector3(float(off[0]), float(off[1]), float(off[2]))
	update_helpers()


func is_bike() -> bool:
	return str(cfg.get("type", "car")) == "motorcycle"


# ---- the wheels

## The parts selected for a wheel, without the parts inside other selected parts.
func wheel_part_nodes(slot: String) -> Array:
	var out := []
	if model_root == null:
		return out
	for n in wheel_parts[slot]:
		var node := find_node_named(str(n))
		if node != null:
			out.append(node)
	var kept := []
	for p in out:
		var inside := false
		for o in out:
			if o != p and (o as Node).is_ancestor_of(p):
				inside = true
		if not inside:
			kept.append(p)
	return kept


func wheel_box(slot: String) -> Variant:
	var parts := wheel_part_nodes(slot)
	if parts.is_empty():
		return null
	var box := AABB()
	var first := true
	for p in parts:
		var b := CarEditorView.bounds_of(p)
		if b.size == Vector3.ZERO and b.position == Vector3.ZERO:
			continue
		box = b if first else box.merge(b)
		first = false
	return null if first else box


## The centres of the four wheels (Wheels from model), or null when a wheel has no parts: { slot: { c, size } }.
func wheel_centers() -> Variant:
	if wheel_mode() != "model":
		return null
	var out := {}
	for s in SLOTS:
		var b: Variant = wheel_box(s)
		if b == null:
			return null
		out[s] = {"c": (b as AABB).get_center(), "size": (b as AABB).size}
	return out


## The diameter of the tyre: the mean of the wheels that are wheels (a motorcycle has dots for the slots it does not need).
func mean_tyre(c: Dictionary) -> float:
	var sizes := []
	for s in SLOTS:
		sizes.append(float(c[s]["size"].y))
	var big: float = sizes.max()
	var total := 0.0
	var n := 0
	for v in sizes:
		if v >= 0.5 * big:
			total += v
			n += 1
	return total / maxf(1.0, n)


func with_model_wheels(fn: Callable) -> Variant:
	var was := wheel_radio
	wheel_radio = "model"
	var r: Variant = fn.call()
	wheel_radio = was
	return r


func library_only() -> bool:
	if wheel_radio != "model":
		return false
	for s in SLOTS:
		if not (wheel_parts[s] as Array).is_empty():
			return false
	return str(Tuning.read(cfg, "wheels.library.front.rim")) not in ["", "<null>"] and str(Tuning.read(cfg, "wheels.library.rear.rim")) not in ["", "<null>"]


func wheel_mode() -> String:
	return "default" if library_only() else wheel_radio


## The middle of a wheel where the Chassis card puts it (Dynamic wheels).
func form_hub(slot: String) -> Vector3:
	var front := slot[0] == "F"
	var left := slot[1] == "L"
	var track := num("chassis.front_track" if front else "chassis.rear_track", 1.5)
	var x := 0.0 if is_bike() else (1.0 if left else -1.0) * track / 2.0
	return Vector3(x, 0, (1.0 if front else -1.0) * num("chassis.wheelbase", 2.6) / 2.0 + num("chassis.front_axle_offset", 0.0))


## The middles and the sizes of the wheels as the car has them (the parts of the model, or the form).
func wheel_places() -> Dictionary:
	var c: Variant = wheel_centers()
	if c is Dictionary:
		return c
	var out := {}
	var sizes := io.library_wheel_sizes()
	for i in 4:
		var s: String = SLOTS[i]
		var d: float = sizes[i] if not sizes.is_empty() else num("chassis.tire_diameter", 0.65)
		out[s] = {"c": form_hub(s), "size": Vector3(0.25, d, d)}
	return out


## The boxes of the wheels, the chips, the grid at the floor, the preview of the library wheels and the text of the view.
func update_helpers() -> void:
	for c in view.helpers.get_children():
		c.queue_free()
	if wheel_mode() == "model":
		for s in SLOTS:
			var b: Variant = wheel_box(s)
			if b != null:
				view.helpers.add_child(CarEditorView.box_lines(b, SLOT_COLOURS[s]))
	form.update_wheel_info()
	form.update_library_preview()
	suspension.refresh(false)
	var centres: Variant = wheel_centers()
	var radius := num("chassis.tire_diameter", 0.65) / 2.0
	if centres is Dictionary:
		var low := INF
		for s in SLOTS:
			low = minf(low, centres[s]["c"].y - centres[s]["size"].y / 2.0)
		view.grid.position.y = low
	else:
		view.grid.position.y = -radius
	engine.update_speed_info()
	var box := CarEditorView.bounds_of(view.pivot)
	view.hud.text = "Import a .glb model to make a car (Model card)" if model_root == null else (
		"Blue arrow: forward. The axes are the origin: it has to be at the height of the " +
		"wheel axles, between the axles.\nModel %.2f x %.2f x %.2f m (width x height x length)" % [box.size.x, box.size.y, box.size.z])
	layers.update_camera_markers()


# ---- the configuration

## The car.json of the form, checked as the browser's buildConfig does: { ... } or { "_error": message }. quiet: no exhaust
## or hook calls that change anything (the baseline of Changes).
func build_config(id: String, quiet := false) -> Dictionary:
	return io.build_config(id, quiet)


## What is missing before the car can be saved (the ready check).
func problems() -> Array:
	var list := []
	var nm := str(cfg.get("name", "")).strip_edges()
	var id := car_id.strip_edges() if car_id.strip_edges() != "" else io.slug(nm)
	if nm == "":
		list.append("Give the car a name")
	elif id == "":
		list.append("Type an id for the car (a-z, 0-9, - and _): it is its folder and its name in the files")
	elif RegEx.create_from_string(ID_PATTERN).search(id) == null:
		list.append("The id may only have a-z, 0-9, - and _")
	if model_root == null and not (existing.get("model") is Dictionary):
		list.append("Import a model")
	elif wheel_mode() == "model" and model_root != null and wheel_centers() == null:
		list.append("Pick the parts of all four wheels")
	for pair in [["chassis.mass", "mass"], ["chassis.wheelbase", "wheelbase"], ["chassis.tire_diameter", "tyre diameter"]]:
		if not (num(pair[0]) > 0.0):
			list.append("Fill in the " + pair[1])
	if not (Tuning.read(cfg, "engine.build") is Dictionary):
		list.append("Choose an engine block")
	list.append_array(form.model_warnings())
	return list


func refresh_ready() -> void:
	if ready_button == null:
		return
	var list := problems()
	ready_button.text = ("⚠ %d to fix" % list.size()) if not list.is_empty() else "✓ Ready"
	ready_button.tooltip_text = "\n".join(list) if not list.is_empty() else "Nothing is missing"
	ready_button.add_theme_color_override("font_color", EditorStyle.WARN if not list.is_empty() else EditorStyle.MUTED)


func update_summary() -> void:
	if summary_label == null:
		return
	var peak := 0.0
	var curve: Variant = Tuning.read(cfg, "engine.torque_curve")
	if curve is Array:
		for p in curve:
			peak = maxf(peak, float(p[1]) * float(p[0]) * PI / 30.0)
	peak /= 1000.0
	var parts := []
	if num("chassis.mass") > 0.0:
		parts.append("%d kg" % roundi(num("chassis.mass")))
	var front := num("chassis.weight_distribution") * 100.0
	if front > 0.0:
		parts.append("%d/%d front/rear" % [roundi(front), 100 - roundi(front)])
	if peak > 0.0:
		parts.append("%d kW (%d hp)" % [roundi(peak), roundi(peak * 1.341)])
	if engine.dyno_best_hp > 0.0:
		parts.append("%d hp at the wheels" % roundi(engine.dyno_best_hp))
	if engine.top_kmh > 0:
		parts.append("%d km/h" % engine.top_kmh)
	summary_label.text = " · ".join(parts)
	wheelie_label.text = io.wheelie_text() if is_bike() else ""
	wheelie_label.visible = wheelie_label.text != ""


# ---- saving

func save_dir() -> String:
	if save_root_override != "":
		return save_root_override
	if save_to_repo and io.repo_web() != "":
		return io.repo_web().path_join("cars")
	return ProjectSettings.globalize_path(Garage.DIR).path_join("cars")


## Saves the car (car.json and the model files): true when it was saved.
func save() -> bool:
	return await io.save()


func save_and_test() -> void:
	if tuning.chosen_tune() != "":
		if not tuning.save_tune_now():
			return
	elif not await save():
		return
	var tracks := Content.list_tracks()
	var d := ConfirmationDialog.new()
	d.title = "Test the car"
	d.ok_button_text = "Start"
	var box := VBoxContainer.new()
	box.add_child(EditorStyle.label("Track", 12, Color("#b9c3d0")))
	var pick := OptionButton.new()
	for t in tracks:
		pick.add_item(str(t["name"]))
		pick.set_item_metadata(pick.item_count - 1, t["id"])
	EditorStyle.select_value(pick, "testtrack")
	box.add_child(pick)
	box.add_child(EditorStyle.hint("The weather, the time of day and the ground of the browser game are not in the Godot version yet."))
	d.add_child(box)
	add_child(d)
	d.confirmed.connect(func():
		var track := str(EditorStyle.value_of(pick))
		visible = false
		engine.stop_sound()
		test_drive.emit(existing_id, track)
		_watch_test())
	d.visibility_changed.connect(func():
		if not d.visible:
			d.queue_free())
	d.popup_centered(Vector2i(420, 0))


## The test drive ends (Esc, Main menu): back here.
func _watch_test() -> void:
	var w: Variant = get_parent().get("world")
	if w is Node and (w as Node).has_signal("leave"):
		(w as Node).leave.connect(func():
			var p := get_parent()
			if p != null and p.get("menu") is Control:
				(p.get("menu") as Control).set_deferred("visible", false)
			set_deferred("visible", true), CONNECT_ONE_SHOT)
	else:
		visible = true


func delete_car() -> void:
	if existing_id == "":
		return
	if not await ask("Delete the car “%s”?" % existing_id, "Its folder goes to the Trash, with all its files.", "Delete", "Cancel"):
		return
	var r := io.delete_car(existing_id)
	if r.has("error"):
		status(str(r["error"]), "error")
		return
	status(str(r.get("message", "Deleted.")), "ok")
	new_car()
	_refresh_list()


func copy_car() -> void:
	if existing_id == "":
		status("Save the car first, then make a copy.", "error")
		return
	cfg["name"] = (str(cfg.get("name", "")).strip_edges() if str(cfg.get("name", "")).strip_edges() != "" else existing_id) + " copy"
	car_id = io.slug(str(cfg["name"]))
	id_edited = true
	refresh_fields()
	form.fill()
	tuning.render_setups()
	changed()
	status("Saving now makes a new car: %s. Change the name first if you like." % car_id, "ok")


# ---- the view

func _on_view_click(mouse: Vector2) -> void:
	if suspension.editing:
		var mount := view.pick_marker(mouse, suspension.pickables())
		if mount != "" and mount != layers.selected:
			layers.select(mount)
		return
	if _hook_wants("click", [mouse]):
		return
	var hit := view.pick_marker(mouse, layers.pickables())
	if hit != "":
		if hit != layers.selected:
			layers.select(hit)
		return
	var part: Variant = view.pick_mesh(mouse, view.pivot)
	if part is Dictionary:
		layers.show_part(_named_ancestor(part["node"]))
		_hook_call("picked", [part])


func _named_ancestor(n: Node) -> String:
	while n != null and n != model_root:
		for e in nodes:
			if e["node"] == n:
				return e["name"]
		n = n.get_parent()
	return ""


# ---- undo, changes, keys

func _snapshot() -> Dictionary:
	var c := cfg.duplicate(true)
	c["exhaust"] = layers.exhaust_config()
	return {"cfg": c, "overrides": overrides.duplicate(true), "wheels": wheel_parts.duplicate(true), "radio": wheel_radio, "id": car_id}


func _restore(shot: Dictionary) -> void:
	cfg = shot["cfg"].duplicate(true)
	overrides = shot["overrides"].duplicate(true)
	wheel_parts = shot["wheels"].duplicate(true)
	wheel_radio = shot["radio"]
	car_id = shot["id"]
	mats.apply_all()
	apply_transform()
	_fill_all()
	_last_shot = _snapshot()


func _remember() -> void:
	var shot := _snapshot()
	if _last_shot != null and JSON.stringify(shot["cfg"]) + JSON.stringify(shot["overrides"]) + JSON.stringify(shot["wheels"]) == \
			JSON.stringify(_last_shot["cfg"]) + JSON.stringify(_last_shot["overrides"]) + JSON.stringify(_last_shot["wheels"]):
		return
	if _last_shot != null:
		_undo.append(_last_shot)
		if _undo.size() > 60:
			_undo.pop_front()
		_redo.clear()
	_last_shot = shot


func undo(redo := false) -> void:
	var from: Array = _redo if redo else _undo
	var to: Array = _undo if redo else _redo
	if from.is_empty():
		status("Nothing to redo." if redo else "Nothing to undo.")
		return
	to.append(_snapshot())
	_restore(from.pop_back())
	set_dirty(true)
	status("Redone." if redo else "Undone.", "ok")


func _show_changes() -> void:
	var before: Variant = _baseline if _baseline is Dictionary and not (_baseline as Dictionary).has("_error") else existing
	if not before is Dictionary or (before as Dictionary).is_empty():
		status("This car is not saved yet.")
		return
	var now := build_config(existing_id if existing_id != "" else car_id, true)
	if now.has("_error"):
		status(str(now["_error"]), "error")
		return
	var list := io.differences(before, now)
	status(("%d changed: %s%s" % [list.size(), " · ".join(list.slice(0, 6)), " · …" if list.size() > 6 else ""]) if not list.is_empty()
		else "Nothing in the settings is different from the saved car.", "ok")


func _process(delta: float) -> void:
	if _remember_timer > 0.0:
		_remember_timer -= delta
		if _remember_timer <= 0.0:
			_remember()
	_tick += delta
	if _tick > 0.8:
		_tick = 0.0
		update_summary()
		refresh_ready()
	layers.frame()
	engine.frame(delta)
	bench.frame(delta)
	_hook_call("frame", [delta])


func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or k.echo or not visible:
		return
	var cmd := k.ctrl_pressed or k.meta_pressed
	if cmd and k.physical_keycode == KEY_S:
		tuning.save_pressed()
		get_viewport().set_input_as_handled()
		return
	var focus := get_viewport().gui_get_focus_owner()
	if cmd and k.physical_keycode == KEY_Z and not (focus is LineEdit):
		undo(k.shift_pressed)
		get_viewport().set_input_as_handled()
		return
	if focus is LineEdit or cmd or k.alt_pressed:
		return
	if _hook_wants("key", [k.physical_keycode]) or layers.key(k.physical_keycode):
		get_viewport().set_input_as_handled()


## (the tests) the field bound to a path of cfg, to type into it as a user would.
func field_for(path: String) -> Control:
	for e in _bound:
		if e["path"] == path:
			return e["field"]
	return null
