# gdlint: disable=max-public-methods
class_name CarEditorForm
extends RefCounted
## The cards of the car editor that are the form of the car (car-editor.html): Car, Model, Wheels, Chassis, Motorcycle,
## Drivetrain and Cameras, and what they do with the model (car-editor.js): find the wheels by their names and places, fit
## the model to the wheels and the floor, take the size and the chassis from it, keep what still fits a new model.

const DIFF_INFO := {
	"open": "Open: the wheel with least grip decides. Easy, but the worst traction.",
	"lsd": "Limited slip: locks more the harder it is driven. Traction out of corners.",
	"welded": "Welded: both wheels turn the same. Best for drifting; scrubs in slow corners.",
}
const GEARBOXES := [["gears", "Manual (a clutch pedal)"], ["imt", "Manual with an automatic clutch (IMT)"], ["amt", "Automated manual (AMT)"],
	["dct", "Dual clutch (DCT)"], ["torque-converter", "Automatic with a torque converter"], ["cvt", "CVT (continuously variable)"]]
const RIG_NAME := "^(susp(upperarm|lowerarm|arm|wishbone|link|trailingarm|trailing|upright|hub|knuckle|spring|damper|strut|shock|coilover|driveshaft|halfshaft|shaft|toelink)" + \
	"[a-z]*(fl|fr|rl|rr)|steertierod[a-z]*(fl|fr|rl|rr)|steerrack|susprack|susp(axle|panhard|watt)[a-z]*(rear|front|back)?|susp(propshaft|cardan)[a-z0-9]*|[a-z]*trailing[a-z]*(fl|fr|rl|rr)|" + \
	"(coilover|damper|shock|strut|spring)cylinder[a-z]*(fl|fr|rl|rr)|(rear|front|back)?solid[a-z]*|[a-z]*(solid|live)axle[a-z]*|axle[a-z]*)$"

var ed: CarEditor
var replace_notes: Array = []
var _id_edit: LineEdit
var _type_pick: OptionButton
var _model_note: Label
var _editing: Label
var _radio_default: CheckBox
var _radio_model: CheckBox
var _chips: HFlowContainer
var _lists := {}                     # slot -> ItemList
var _list_labels := {}
var _rim_picks := {}                 # axle -> OptionButton
var _tyre_picks := {}
var _tyre_rows := {}
var _use_model: CheckBox
var _use_model_hint: Label
var _lib_info: Label
var _lib_same: Button
var _steering_info: Label
var _travel_label: Label
var travel_row: Control = null
var _cam_height_fast: Control = null
var _cam_dolly: Control = null
var _drag_row: HBoxContainer
var _steer_box: VBoxContainer
var _travel: HSlider
var _unsprung: CheckBox
var _diff_info: Label
var _lsd_row: Control
var _centre_row: Control
var _cvt_box: Control
var _tc_row: Control
var _gears: LineEdit
var _tyre_field: Control
var _car_only: Array = []
var _bike_only: Array = []
var _cam_dialog: Dictionary = {}
var _warn_for: Variant = null
var _warn_found: Array = []
var _selecting := false


func _init(editor: CarEditor) -> void:
	ed = editor


func _row(parent: Control) -> HBoxContainer:
	return EditorStyle.row(parent)


# ---- Car

func build_car_card() -> void:
	var c := ed.add_card("Car")
	var b: VBoxContainer = c["body"]
	_editing = c["meta"]
	ed.existing_pick = EditorStyle.options([["", "Choose a car to change…"]])
	ed.existing_pick.item_selected.connect(func(_i: int):
		var id := str(EditorStyle.value_of(ed.existing_pick))
		if id == "":
			return
		if ed.dirty and not await ed.ask("Open another car?", "The car in the form has changes that are not saved. They are lost.", "Open", "Stay"):
			EditorStyle.select_value(ed.existing_pick, ed.existing_id)
			return
		ed.load_existing(id))
	b.add_child(ed.existing_pick)
	var buttons := HFlowContainer.new()
	buttons.add_theme_constant_override("h_separation", 8)
	b.add_child(buttons)
	for d in [["+ Car", "small", "Start with an empty car", func(): _new("car")], ["+ Motorcycle", "small", "Start with an empty motorcycle", func(): _new("motorcycle")],
			["Make a copy", "small ghost", "Save this car again under a new name", func(): ed.copy_car()],
			["Export zip", "small ghost", "The car as it is saved, as a zip to share (the Import of the main menu takes it)", _export_zip]]:
		var btn := EditorStyle.button(d[0], d[1], d[2])
		btn.pressed.connect(d[3])
		buttons.add_child(btn)
	var r := _row(b)
	_type_pick = EditorStyle.options([["car", "Car"], ["motorcycle", "Motorcycle"]])
	_type_pick.item_selected.connect(func(_i: int):
		if EditorStyle.value_of(_type_pick) == "motorcycle":
			ed.cfg["type"] = "motorcycle"
		else:
			ed.cfg.erase("type")
		apply_type_ui()
		ed.changed())
	r.add_child(EditorStyle.labelled(_type_pick, "Type"))
	r.add_child(EditorStyle.tipline("A motorcycle: one wheel per end", "A motorcycle shows only what a motorcycle has: one wheel at each end, no differential, " +
		"no steering wheel; the Motorcycle card has the rider and the lean."))
	r = _row(b)
	var name_box := VBoxContainer.new()
	name_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_box.add_child(EditorStyle.label("Name", 12, Color("#b9c3d0")))
	r.add_child(name_box)
	ed.bind_text(name_box, "name", "My car", func():
		if not ed.id_edited:
			ed.car_id = CarEditorIO.slug(str(ed.cfg.get("name", "")))
			_id_edit.text = ed.car_id
			ed.tuning.render_setups())
	_id_edit = EditorStyle.line_edit("", "my-car")
	_id_edit.text_changed.connect(func(t: String):
		ed.car_id = t.strip_edges()
		ed.id_edited = true
		ed.tuning.render_setups()
		ed.changed(false))
	r.add_child(EditorStyle.labelled(_id_edit, "Id (folder name)"))
	var desc := VBoxContainer.new()
	desc.add_child(EditorStyle.label("Description", 12, Color("#b9c3d0")))
	b.add_child(desc)
	ed.bind_text(desc, "description", "Short description for the menu")
	var where := ["garage", "Your garage (user://garage/cars)"]
	var items := [where]
	if CarEditorIO.repo_web() != "":
		items.append(["repo", "The game's folder (web/cars, the repository)"])
	ed.save_where = EditorStyle.options(items)
	ed.save_where.tooltip_text = "Where Save writes the car: the garage of the player, or the cars of the game in the repository " + \
		"(as the browser saves through tools/serve.py)"
	ed.save_where.item_selected.connect(func(_i: int):
		ed.save_to_repo = EditorStyle.value_of(ed.save_where) == "repo"
		ed.tuning.update_tune_buttons())
	b.add_child(EditorStyle.labelled(ed.save_where, "Save in"))


func _new(kind: String) -> void:
	if ed.dirty and not await ed.ask("Start a new " + ("motorcycle" if kind == "motorcycle" else "car") + "?", "The car in the form has changes that are not saved.",
			"New", "Stay"):
		return
	ed.new_car(kind)


func _export_zip() -> void:
	if ed.existing_id == "":
		ed.status("Save the car first: the zip is made of the car as it is saved.", "error")
		return
	if ed.dirty:
		ed.status("The zip has the car as it is saved, not the changes that are not saved yet.")
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.filters = PackedStringArray(["*.zip ; A car"])
	dlg.current_file = ed.existing_id + ".car.zip"
	ed.add_child(dlg)
	dlg.file_selected.connect(func(p: String):
		var r := ed.io.export_zip(ed.existing_id, p)
		ed.status(("Could not make the zip: " + str(r["error"])) if r.has("error") else "Saved %s: the Import of the main menu takes it." % p.get_file(),
			"error" if r.has("error") else "ok")
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	dlg.popup_centered_ratio(0.6)


func editing_note(text: String) -> void:
	_editing.text = text
	_editing.tooltip_text = text


# ---- Model

func build_model_card() -> void:
	var c := ed.add_card("Model")
	var b: VBoxContainer = c["body"]
	b.add_child(EditorStyle.tipline("Pick a .glb, or a .gltf with its files", "A .glb, or a .gltf with its .bin and textures (select them all). The car has to " +
		"face the blue arrow, y is up. Blender exports a car that looks towards -Y correctly."))
	var imp := EditorStyle.button("Import model…", "accent")
	imp.pressed.connect(_pick_files)
	b.add_child(imp)
	_model_note = EditorStyle.hint("", EditorStyle.WARN)
	b.add_child(_model_note)
	var r := _row(b)
	ed.bind_number(r, "model.rotation_y", "turn (°)", 90, NAN, NAN, 1.0, "", _turned)
	ed.bind_number(r, "model.scale", "scale", 0.01, NAN, NAN, 1.0, "", _turned)
	for deg in [90, 180, 270]:
		var t := EditorStyle.button("%d°" % deg, "small ghost")
		t.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		t.pressed.connect(func():
			ed.cfg["model"]["rotation_y"] = fmod(ed.num("model.rotation_y") + deg, 360.0)
			ed.refresh_fields()
			_turned()
			ed.changed())
		r.add_child(t)
	b.add_child(EditorStyle.label("Move the model (m)", 12, Color("#b9c3d0")))
	r = _row(b)
	var hints := ["x (sideways)", "y (up)", "z (forward)"]
	for i in 3:
		ed.bind_number(r, "model.offset.%d" % i, hints[i], 0.01, -3.0, 3.0, 1.0, "", func(): ed.apply_transform())
	r = _row(b)
	var fit_b := EditorStyle.button("Fit to the wheels and the floor", "accent small")
	fit_b.pressed.connect(func():
		ed.with_model_wheels(fit)
		ed.update_helpers()
		ed.changed())
	r.add_child(fit_b)
	r.add_child(EditorStyle.hint("Origin: axle height, between the axles"))


func _turned() -> void:
	ed.apply_transform()
	var placed := ed.layers.placed_on_model()
	if not placed.is_empty():
		ed.status("The model is scaled or turned; what was placed on it stays where it was: " + ", ".join(placed) + ". Check them.", "warn")


func _pick_files() -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILES
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.filters = PackedStringArray(["*.glb, *.gltf, *.bin, *.png, *.jpg, *.jpeg, *.webp, *.ktx2 ; A model (glb, or gltf with its files)"])
	dlg.title = "A model of a car (.glb, or a .gltf with its .bin and textures)"
	ed.add_child(dlg)
	dlg.files_selected.connect(func(paths: PackedStringArray):
		dlg.queue_free()
		ed.load_model_files(paths))
	dlg.canceled.connect(dlg.queue_free)
	dlg.popup_centered_ratio(0.6)


func model_info(text: String) -> void:
	ed.card_of["Model"]["meta"].text = text


func model_note(text: String) -> void:
	_model_note.text = text
	_model_note.visible = text != ""


# ---- Wheels

func build_wheels_card() -> void:
	var c := ed.add_card("Wheels")
	var b: VBoxContainer = c["body"]
	var group := ButtonGroup.new()
	_radio_default = CheckBox.new()
	_radio_default.text = "Dynamic wheels"
	_radio_default.button_group = group
	_radio_model = CheckBox.new()
	_radio_model.text = "Wheels from model"
	_radio_model.button_group = group
	for rb in [_radio_default, _radio_model]:
		rb.focus_mode = Control.FOCUS_NONE
		b.add_child(rb)
	_radio_default.toggled.connect(func(on: bool):
		if on and not ed._refreshing:
			ed.wheel_radio = "default"
			ed.update_helpers()
			ed.changed())
	_radio_model.toggled.connect(func(on: bool):
		if on and not ed._refreshing:
			ed.wheel_radio = "model"
			ed.update_helpers()
			ed.changed())
	var find := EditorStyle.button("Find the wheels", "small accent", "Looks for the wheel parts by their names and places")
	find.pressed.connect(func():
		ed.with_model_wheels(guess_wheels)
		ed.update_helpers()
		ed.changed())
	b.add_child(find)
	_chips = HFlowContainer.new()
	_chips.add_theme_constant_override("h_separation", 6)
	_chips.add_theme_constant_override("v_separation", 4)
	b.add_child(_chips)
	var hand := EditorStyle.fold(b, "Choose the parts by hand")
	hand.add_child(EditorStyle.hint("Ctrl or Cmd adds more parts to a wheel"))
	for pair in [["FR", "FL"], ["RR", "RL"]]:
		var r := _row(hand)
		for slot in pair:
			var box := VBoxContainer.new()
			box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var l := EditorStyle.label("■ " + CarEditor.SLOT_NAMES[slot], 12, CarEditor.SLOT_COLOURS[slot])
			box.add_child(l)
			_list_labels[slot] = l
			var list := ItemList.new()
			list.select_mode = ItemList.SELECT_MULTI
			list.custom_minimum_size = Vector2(0, 110)
			list.focus_mode = Control.FOCUS_CLICK
			list.multi_selected.connect(func(_i: int, _s: bool): _list_changed(slot))
			list.item_selected.connect(func(_i: int): _list_changed(slot))
			box.add_child(list)
			_lists[slot] = list
			r.add_child(box)
			if slot in ["FR", "RR"]:
				_car_only.append(box)
	b.add_child(EditorStyle.group("Rims from the wheel library (the tyre is made from the Tyres settings)"))
	b.add_child(EditorStyle.tipline("Replaces the wheel parts of an axle", "A rim of web/wheels/wheels.json takes the place of the wheel parts of its axle (their " +
		"middle is the hub). The tyre is made from the Tyres settings (the diameter, the sidewall, the width and the rubber)."))
	var lib := CarEditorIO.wheels_json()
	for axle in ["front", "rear"]:
		if axle == "rear":
			_use_model = CheckBox.new()
			_use_model.text = "Use the rim and the tyre of the model"
			_use_model.focus_mode = Control.FOCUS_NONE
			_use_model.toggled.connect(func(_on: bool):
				if not ed._refreshing:
					_library_changed())
			b.add_child(_use_model)
			_use_model_hint = EditorStyle.hint("Needs objects called rim and tyre in the model: they are the wheel of every corner, fitted to the tyre settings.")
			b.add_child(_use_model_hint)
			_lib_same = EditorStyle.button("Copy to rear", "small ghost", "Give the rear axle the rim and the tyre of the front axle")
			_lib_same.pressed.connect(_rear_as_front)
			b.add_child(_lib_same)
		var r := _row(b)
		var rims := [["", "From the model"]]
		for e in lib.get("rims", []):
			rims.append([str(e.get("id", "")), str(e.get("name", e.get("id", "")))])
		var rp := EditorStyle.options(rims)
		rp.item_selected.connect(func(_i: int):
			if not ed._refreshing:
				_library_changed())
		_rim_picks[axle] = rp
		r.add_child(EditorStyle.labelled(rp, "Front rim" if axle == "front" else "Rear rim"))
		var tyres := [["", "Default for the rim"]]
		for e in lib.get("tyres", []):
			if str(e.get("for", "")) == "motorcycle":
				tyres.append([str(e.get("id", "")), str(e.get("name", e.get("id", "")))])
		tyres.append(["custom", "Custom (made from the Tyres settings)"])
		var tp := EditorStyle.options(tyres)
		tp.item_selected.connect(func(_i: int):
			if not ed._refreshing:
				_library_changed())
		_tyre_picks[axle] = tp
		var tbox := EditorStyle.labelled(tp, "Front tyre" if axle == "front" else "Rear tyre")
		_tyre_rows[axle] = tbox
		r.add_child(tbox)
	_lib_info = EditorStyle.hint("")
	b.add_child(_lib_info)
	var steer := VBoxContainer.new()
	_steer_box = steer
	b.add_child(steer)
	_car_only.append(steer)
	steer.add_child(EditorStyle.group("Steering wheel"))
	_steering_info = EditorStyle.hint("No model loaded.")
	steer.add_child(_steering_info)
	var r2 := _row(steer)
	ed.bind_number(r2, "steering_wheel.degrees", "turn at full lock (°, each way)", 10, 30.0, 1000.0)
	var stop := VBoxContainer.new()
	stop.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ed.bind_select(stop, "steering_wheel.stop", [["rods", "Where the tie rods stop it"], ["degrees", "At its degrees and the wheel angle"]])
	stop.add_child(EditorStyle.hint("wheel stops"))
	r2.add_child(stop)
	steer.add_child(EditorStyle.hint("A part called steeringwheel turns with the steering."))
	var bike_tip := EditorStyle.tipline("Front end found by name (steerhead_…)", "The front end of a motorcycle is found by name: steerhead_… turns with the steering, " +
		"brake_…_FL goes with the front wheel along the fork, swingarm turns with the rear wheel, and the rider takes grip_L/R, footpeg_L/R (see MOTORCYCLE.md).")
	b.add_child(bike_tip)
	_bike_only.append(bike_tip)


func _list_changed(slot: String) -> void:
	if _selecting:
		return
	var list: ItemList = _lists[slot]
	var names := []
	for i in list.get_selected_items():
		names.append(str(list.get_item_metadata(i)))
	ed.wheel_parts[slot] = names
	if ed.is_bike():
		_sync_bike_wheels()
	ed.update_helpers()
	ed.changed()


func _sync_bike_wheels() -> void:
	ed.wheel_parts["FR"] = (ed.wheel_parts["FL"] as Array).duplicate()
	ed.wheel_parts["RR"] = (ed.wheel_parts["RL"] as Array).duplicate()
	_select_lists()


## The named parts of the model in the four lists, with the ones of each wheel selected.
func fill_wheel_lists() -> void:
	for s in CarEditor.SLOTS:
		var list: ItemList = _lists[s]
		list.clear()
		for n in ed.nodes:
			list.add_item("  ".repeat(maxi(0, int(n["depth"]) - 1)) + str(n["name"]))
			list.set_item_metadata(list.item_count - 1, n["name"])
	_select_lists()


func _select_lists() -> void:
	_selecting = true
	for s in CarEditor.SLOTS:
		var list: ItemList = _lists[s]
		list.deselect_all()
		for i in list.item_count:
			if str(list.get_item_metadata(i)) in ed.wheel_parts[s]:
				list.select(i, false)
	_selecting = false


func _library_changed() -> void:
	for axle in ["front", "rear"]:
		Tuning.write(ed.cfg, "wheels.library.%s.rim" % axle, str(EditorStyle.value_of(_rim_picks[axle])))
		Tuning.write(ed.cfg, "wheels.library.%s.tyre" % axle, str(EditorStyle.value_of(_tyre_picks[axle])) if ed.is_bike() else
			("custom" if str(EditorStyle.value_of(_rim_picks[axle])) != "" or _use_model.button_pressed else ""))
		Tuning.write(ed.cfg, "wheels.library.%s.model" % axle, _use_model.button_pressed)
	var v := Tuning.values_of(ed.cfg)
	v["model_tyres"] = "on" if _use_model.button_pressed else "off"
	for axle in ["front", "rear"]:
		v["rim_" + axle] = str(EditorStyle.value_of(_rim_picks[axle]))
		v["tyre_" + axle] = str(EditorStyle.value_of(_tyre_picks[axle])) if ed.is_bike() else ""
	var lib := CarEditorIO.library_of(v)
	if lib.is_empty():
		ed.cfg["wheels"].erase("library")
	else:
		ed.cfg["wheels"]["library"] = lib
	sync_tyre_field()
	ed.update_helpers()
	ed.tuning.render_groups()
	ed.changed()


func _rear_as_front() -> void:
	for k in ["diameter", "inner_ratio", "rubber", "tread"]:
		var f: Variant = Tuning.read(ed.cfg, "wheels.library.front.custom." + k)
		if f != null:
			Tuning.write(ed.cfg, "wheels.library.rear.custom." + k, f)
	Tuning.write(ed.cfg, "tyres.shell.width_rear", 0)
	EditorStyle.select_value(_rim_picks["rear"], EditorStyle.value_of(_rim_picks["front"]))
	EditorStyle.select_value(_tyre_picks["rear"], EditorStyle.value_of(_tyre_picks["front"]))
	_library_changed()


func _show_library() -> void:
	var use_model := false
	for axle in ["front", "rear"]:
		var a: Variant = Tuning.read(ed.cfg, "wheels.library." + axle)
		var rim := str(a.get("rim", "")) if a is Dictionary else ""
		var tyre := str(a.get("tyre", "")) if a is Dictionary else ""
		if a is Dictionary and a.get("model", false):
			use_model = true
		EditorStyle.select_value(_rim_picks[axle], rim)
		EditorStyle.select_value(_tyre_picks[axle], tyre if tyre != CarEditorIO.BIKE_TYRE[axle] else "")
	_use_model.set_pressed_no_signal(use_model)
	var has_rim_tyre := false
	for n in ed.nodes:
		var plain := str(n["name"]).to_lower()
		if plain in ["rim", "tyre", "tire"]:
			has_rim_tyre = true
	_use_model.disabled = not has_rim_tyre and not use_model
	_use_model_hint.visible = not has_rim_tyre
	for axle in ["front", "rear"]:
		(_rim_picks[axle] as Control).get_parent().visible = not use_model
		_tyre_rows[axle].visible = ed.is_bike() and str(EditorStyle.value_of(_rim_picks[axle])) != ""
	_lib_same.visible = not use_model


## With custom tyres on both axles, the tyre diameter of the Chassis card is their mean and not asked for.
func sync_tyre_field() -> void:
	var f: Variant = Tuning.read(ed.cfg, "wheels.library.front.custom.diameter")
	var r: Variant = Tuning.read(ed.cfg, "wheels.library.rear.custom.diameter")
	var both: bool = f != null and r != null and Tuning.read(ed.cfg, "wheels.library.front.tyre") == "custom" and Tuning.read(ed.cfg, "wheels.library.rear.tyre") == "custom"
	if _tyre_field != null:
		_tyre_field.visible = not both
	if both:
		var d := snappedf((float(f) + float(r)) / 2.0, 0.001)
		if absf(ed.num("chassis.tire_diameter") - d) > 1e-6:
			ed.cfg["chassis"]["tire_diameter"] = d
			ed.refresh_fields()


func update_wheel_info() -> void:
	var centres: Variant = ed.wheel_centers()
	var meta: Label = ed.card_of["Wheels"]["meta"]
	meta.text = ("4 of 4 found" if centres != null else "") if ed.wheel_mode() == "model" else ("rims of the library" if ed.library_only() else "dynamic wheels")
	for ch in _chips.get_children():
		ch.queue_free()
	for s in (["FL", "RL"] if ed.is_bike() else CarEditor.SLOTS):
		var names: Array = ed.wheel_parts[s]
		var what := "none" if names.is_empty() else str(names[0]) + (" +%d" % (names.size() - 1) if names.size() > 1 else "")
		var chip := EditorStyle.label("%s: %s" % [CarEditor.SLOT_NAMES[s], what],
			11, EditorStyle.TEXT if not names.is_empty() else EditorStyle.FAINT, false)
		var st := EditorStyle.box(Color(0, 0, 0, 0), 11, 1, CarEditor.SLOT_COLOURS[s] if not names.is_empty() else EditorStyle.LINE)
		st.content_margin_top = 2
		st.content_margin_bottom = 2
		chip.add_theme_stylebox_override("normal", st)
		_chips.add_child(chip)


## The rims and tyres of the library drawn at the wheels (the wheel parts of the model they stand in for hidden), or the grey wheels
## where the dynamic wheels go.
func update_library_preview() -> void:
	for n in ed.nodes:
		if n["node"].has_meta("lib_hidden"):
			n["node"].visible = true
			n["node"].remove_meta("lib_hidden")
	for c in ed.view.lib_preview.get_children():
		c.queue_free()
	var lib: Variant = Tuning.read(ed.cfg, "wheels.library")
	var has_lib := lib is Dictionary and not (lib as Dictionary).is_empty()
	var named_of := func(slot: String) -> Array[Node3D]:
		return CarModel.named_wheel_parts(ed.model_root, slot)
	var own_wheels := 0
	var hide := func(slot: String):
		for p in ed.wheel_part_nodes(slot):
			if (p as Node3D).visible and not (named_of.call(slot) as Array[Node3D]).has(p):
				p.visible = false
				p.set_meta("lib_hidden", true)
	var lines := []
	for s in CarEditor.SLOTS:
		if ed.is_bike() and (s == "FR" or s == "RR"):
			continue
		var axle := "front" if s[0] == "F" else "rear"
		var a: Dictionary = lib.get(axle, {}) if has_lib else {}
		var centre := ed.form_hub(s)
		# (the objects of the model with the names of the wheels are used: no rim of the library there)
		var named: Array[Node3D] = named_of.call(s)
		if not named.is_empty():
			own_wheels += 1
			if CarModel.has_named_tyre(named, s):
				continue
			a = a.duplicate()
			a.erase("rim")
		if ed.wheel_mode() == "model":
			var bx: Variant = ed.wheel_box(s)
			if bx == null or a.is_empty():
				continue
			centre = (bx as AABB).get_center()
		if ed.wheel_mode() != "model" or not a.is_empty():
			hide.call(s)
		var holder := Node3D.new()
		holder.position = centre
		ed.view.lib_preview.add_child(holder)
		var custom: Dictionary = a.get("custom", {})
		var dia := float(custom.get("diameter", ed.num("chassis.tire_diameter", 0.65)))
		var width := float(custom.get("width", 0.24))
		var inner := float(custom.get("inner_ratio", 0.68))
		if a.is_empty():
			var marker := MeshInstance3D.new()
			var cyl := CylinderMesh.new()
			cyl.top_radius = dia / 2.0
			cyl.bottom_radius = dia / 2.0
			cyl.height = maxf(0.1, dia / 2.0 * 0.6)
			marker.mesh = cyl
			var mat := StandardMaterial3D.new()
			mat.albedo_color = Color("#3a3f47")
			mat.roughness = 0.9
			marker.material_override = mat
			marker.rotation.z = PI / 2
			holder.add_child(marker)
			continue
		var tyre := MeshInstance3D.new()
		tyre.mesh = CarModel.tyre_mesh(dia / 2.0, dia / 2.0 * inner, width)
		holder.add_child(tyre)
		if str(a.get("rim", "")) != "":
			var rim := CarModel.library_rim(str(a["rim"]), dia * inner * 1.02, maxf(0.02, width + 2.0 * float(Tuning.read(a, "custom.rim_offset") if Tuning.read(a, "custom.rim_offset") != null else 0.0) / 1000.0))
			if s[1] != "L":
				rim.rotation.y = PI
			holder.add_child(rim)
	if has_lib:
		for axle in ["front", "rear"]:
			var cu: Variant = Tuning.read(ed.cfg, "wheels.library.%s.custom" % axle)
			if cu is Dictionary:
				lines.append("%s: tyre %d mm across, %d mm wide, inner shell %d %%" % [axle, roundi(float(cu.get("diameter", 0)) * 1000.0),
					roundi(float(cu.get("width", 0)) * 1000.0), roundi(float(cu.get("inner_ratio", 0.62)) * 100.0)])
		_lib_info.text = "\n".join(lines)
	elif ed.wheel_mode() != "model":
		_lib_info.text = "The demo wheel goes where the grey wheels are (the wheelbase and the tracks of the Chassis card). Choose a rim of the wheel library to see it there."
	else:
		_lib_info.text = ""
	if own_wheels > 0:
		_lib_info.text = "The model has its own wheel objects (wheel_FL, wheel_FL_rim, ...): those are used, not the rims of the library.\n" + _lib_info.text
	if ed.model_root != null:
		CarPaint.paint(ed.view.lib_preview, CarPaint.colors_of(ed.cfg.get("colors")))


## The parts of the wheels found by their names and places (guessWheels).
func guess_wheels() -> void:
	if ed.model_root == null:
		return
	var all := CarEditorView.bounds_of(ed.view.pivot)
	var centre := all.get_center()
	var size := all.size
	var wheel := RegEx.create_from_string(CarEditor.WHEEL_NAME)
	var steer := RegEx.create_from_string("(?i)steer|stuur|lenk|volant")
	var cands := []
	for n in ed.nodes:
		var nm: String = n["name"]
		if wheel.search(nm) == null or steer.search(nm) != null:
			continue
		var box := CarEditorView.bounds_of(n["node"])
		if box.size == Vector3.ZERO:
			continue
		if box.size.z > size.z * 0.4 or box.size.x > size.x * 0.5:
			continue
		cands.append({"node": n["node"], "name": nm, "c": box.get_center()})
	var kept := []
	for a in cands:
		var inside := false
		for o in cands:
			if o != a and (o["node"] as Node).is_ancestor_of(a["node"]):
				inside = true
		if not inside:
			kept.append(a)
	var picked := {"FR": [], "FL": [], "RL": [], "RR": []}
	for a in kept:
		var named := _slot_by_name(str(a["name"]))
		if named != "":
			picked[named].append(a["name"])
			continue
		var front: bool = a["c"].z > centre.z
		var left: bool = a["c"].x > centre.x
		picked[("F" if front else "R") + ("L" if left else "R")].append(a["name"])
	for s in CarEditor.SLOTS:
		ed.wheel_parts[s] = picked[s]
	_select_lists()
	ed.update_helpers()
	var missing := []
	for s in CarEditor.SLOTS:
		if (picked[s] as Array).is_empty():
			missing.append(s)
	ed.status("No parts found for: %s. Select them by hand, or use Dynamic wheels." % ", ".join(missing) if not missing.is_empty() else "Found the wheels.",
		"error" if not missing.is_empty() else "ok")


static func _slot_by_name(raw: String) -> String:
	var n := ""
	for ch in raw.to_lower():
		n += ch if ch >= "a" and ch <= "z" else " "
	var words := n.split(" ", false)
	var codes := {"fr": "FR", "fl": "FL", "rl": "RL", "rr": "RR", "lf": "FL", "rf": "FR", "lr": "RL", "rb": "RR", "lb": "RL"}
	for w in words:
		if codes.has(w):
			return codes[w]
	var front := words.has("front")
	var rear := words.has("rear") or words.has("back")
	var left := words.has("left")
	var right := words.has("right")
	if (front or rear) and (left or right):
		return ("F" if front else "R") + ("L" if left else "R")
	return ""


## Puts the origin of the model where the game wants it: between the wheels at their height, or on the floor.
func fit() -> void:
	if ed.model_root == null:
		return
	var off: Array = ed.cfg["model"].get("offset", [0, 0, 0])
	var o := Vector3(float(off[0]), float(off[1]), float(off[2]))
	var centres: Variant = ed.wheel_centers()
	if centres is Dictionary:
		var avg := Vector3.ZERO
		for s in CarEditor.SLOTS:
			avg += centres[s]["c"]
		o -= avg / 4.0
	else:
		var box := CarEditorView.bounds_of(ed.view.pivot)
		var c := box.get_center()
		o.x -= c.x
		o.z -= c.z
		o.y += -ed.num("chassis.tire_diameter", 0.65) / 2.0 - box.position.y
	ed.cfg["model"]["offset"] = [snappedf(o.x, 0.0001), snappedf(o.y, 0.0001), snappedf(o.z, 0.0001)]
	ed.refresh_fields()
	ed.apply_transform()


func size_from_model() -> void:
	if ed.model_root == null:
		return
	var box := CarEditorView.bounds_of(ed.view.pivot)
	ed.cfg["dimensions"] = {"length": snappedf(box.size.z, 0.01), "width": snappedf(box.size.x, 0.01), "height": snappedf(box.size.y, 0.01)}
	ed.refresh_fields()


func chassis_from_wheels() -> bool:
	var c: Variant = ed.wheel_centers()
	if not c is Dictionary:
		ed.status("Select the parts of the four wheels first.", "error")
		return false
	var ch: Dictionary = ed.cfg["chassis"]
	var fz: float = (c["FR"]["c"].z + c["FL"]["c"].z) / 2.0
	var rz: float = (c["RR"]["c"].z + c["RL"]["c"].z) / 2.0
	var low := 0.04 if ed.is_bike() else 0.0
	ch["wheelbase"] = snappedf(fz - rz, 0.001)
	ch["front_track"] = snappedf(maxf(low, absf(c["FL"]["c"].x - c["FR"]["c"].x)), 0.001)
	ch["rear_track"] = snappedf(maxf(low, absf(c["RL"]["c"].x - c["RR"]["c"].x)), 0.001)
	ch["tire_diameter"] = snappedf(ed.mean_tyre(c), 0.001)
	ch["front_axle_offset"] = snappedf((fz + rz) / 2.0, 0.001)
	ch["rear_axle_offset"] = ch["front_axle_offset"]
	ed.refresh_fields()
	ed.update_helpers()
	return true


## A new model for a car that exists: the transform, the wheels (by the names of their parts) and the materials are kept where they
## still fit; the chassis, the cameras, the engine and the sound are not touched.
func replace_model() -> void:
	var previous := ed.replaced_model
	var notes := replace_notes.duplicate()
	var legacy := previous.is_empty() or str(previous.get("type", "")) != "gltf"
	if legacy:
		ed.cfg["model"]["rotation_y"] = 0
		ed.cfg["model"]["scale"] = 1
		ed.cfg["model"]["offset"] = [0, 0, 0]
		ed.refresh_fields()
	ed.apply_transform()
	var wanted: Variant = Tuning.read(ed.existing, "wheels.nodes")
	var names := {}
	for n in ed.nodes:
		names[n["name"]] = true
	var all_there := wanted is Dictionary
	if all_there:
		for s in CarEditor.SLOTS:
			var found := false
			for n in wanted.get(s, []):
				if names.has(n):
					found = true
			if not found:
				all_there = false
	if not legacy and all_there:
		for s in CarEditor.SLOTS:
			ed.wheel_parts[s] = (wanted[s] as Array).duplicate()
		_select_lists()
		notes.append("The wheels were found again by the names of their parts.")
	else:
		ed.with_model_wheels(guess_wheels)
		notes.append("The wheels were looked for by their names and places: check them." if ed.with_model_wheels(ed.wheel_centers) != null
			else "The parts of the wheels were not found: select them, or use Dynamic wheels.")
	if legacy and ed.with_model_wheels(ed.wheel_centers) != null:
		ed.with_model_wheels(fit)
	var centres: Variant = ed.with_model_wheels(ed.wheel_centers)
	if centres is Dictionary:
		var wb: float = (centres["FR"]["c"].z + centres["FL"]["c"].z) / 2.0 - (centres["RR"]["c"].z + centres["RL"]["c"].z) / 2.0
		var track: float = absf(centres["FL"]["c"].x - centres["FR"]["c"].x)
		var dia := ed.mean_tyre(centres)
		var off := []
		if absf(wb - ed.num("chassis.wheelbase")) > 0.03:
			off.append("wheelbase %.2f m (car: %s)" % [wb, ed.num("chassis.wheelbase")])
		if absf(track - ed.num("chassis.front_track")) > 0.03:
			off.append("front track %.2f m (car: %s)" % [track, ed.num("chassis.front_track")])
		if absf(dia - ed.num("chassis.tire_diameter")) > 0.02:
			off.append("tyre %.2f m (car: %s)" % [dia, ed.num("chassis.tire_diameter")])
		if not off.is_empty():
			notes.append("The new model measures " + ", ".join(off) + ". \"Wheelbase, track and tyre from the wheels\" sets the car to it; the car was left as it is.")
	model_note("")
	var placed := ed.layers.placed_on_model()
	if not placed.is_empty():
		notes.append("Placed on the old model and kept where it was: " + ", ".join(placed) + ". Check them on the new model.")
	ed.status("The model is replaced, it is saved with “Save the car”.\n" + "\n".join(notes), "ok")
	ed.view.frame_model()


func update_steering_info() -> void:
	var found := ""
	for n in ed.nodes:
		if _plain(str(n["name"])).contains("steeringwheel") or _plain(str(n["name"])).contains("steerwheel"):
			found = n["name"]
			break
	_steering_info.text = "No model loaded." if ed.nodes.is_empty() else ("Found the part “%s”: it turns with the steering in the game." % found if found != ""
		else "No part called steeringwheel in this model: the steering wheel does not turn. Name it that way in Blender to make it turn.")


static func _plain(s: String) -> String:
	var out := ""
	for ch in s.to_lower():
		if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
			out += ch
	return out


## The parts of the model that are called wrong (found when a model is loaded and listed in the ready check).
func model_warnings() -> Array:
	if _warn_for == ed.nodes:
		return _warn_found
	_warn_for = ed.nodes
	var out := []
	var rig := RegEx.create_from_string(RIG_NAME)
	var middle := CarEditorView.bounds_of(ed.view.pivot).get_center().z if ed.model_root != null else 0.0
	for n in ed.nodes:
		var plain := SuspensionRig.stem(str(n["name"]))
		if plain.contains("trierod"):
			out.append("“%s”: tierod, not trierod" % n["name"])
		elif (plain.begins_with("susp") or (plain.begins_with("steer") and not plain.begins_with("steering") and not plain.begins_with("steerwheel"))) \
				and rig.search(plain) == null:
			out.append("“%s” is not a part the suspension knows" % n["name"])
		var corner := plain.right(2) if RegEx.create_from_string("^(susp|steer|ball|brake|coilover|wheel|rim|tyre|tire)").search(plain) != null else ""
		if corner in ["fl", "fr", "rl", "rr"]:
			var box := CarEditorView.bounds_of(n["node"])
			if box.size != Vector3.ZERO:
				var front := box.get_center().z > middle
				var left := box.get_center().x > 0.0
				if front != (corner[0] == "f"):
					out.append("“%s” sits at the %s but is named for the %s (it would follow that wheel)" % [n["name"], "front" if front else "rear",
						"front" if corner[0] == "f" else "rear"])
				elif absf(box.get_center().x) > 0.05 and left != (corner[1] == "l"):
					out.append("“%s” sits on the %s but is named for the %s (it would follow that wheel)" % [n["name"], "left" if left else "right",
						"left" if corner[1] == "l" else "right"])
	_warn_found = out.slice(0, 8)
	return _warn_found


# ---- Chassis

## The follow camera comes closer by itself, or has a place at full speed: of the two the fields that count.
func update_camera_fields() -> void:
	if _cam_dolly == null:
		return
	var placed := float(Tuning.read(ed.cfg, "cameras.follow.distance_fast") if Tuning.read(ed.cfg, "cameras.follow.distance_fast") != null else 0.0) > 0.0
	_cam_height_fast.visible = placed
	_cam_dolly.visible = not placed


## What was made with another card but belongs in a card of its own.
func move_to_their_cards() -> void:
	_steer_box.get_parent().remove_child(_steer_box)
	ed.body_of("Steering").add_child(_steer_box)
	ed.body_of("Aerodynamics").add_child(_drag_row)


func build_chassis_card() -> void:
	var c := ed.add_card("Chassis")
	var b: VBoxContainer = c["body"]
	var r := _row(b)
	ed.bind_number(r, "dimensions.length", "length (m)", 0.01, 1.0, 8.0, 1.0, "", _cams_follow)
	ed.bind_number(r, "dimensions.width", "width (m)", 0.01, 0.5, 3.5, 1.0, "", _cams_follow)
	ed.bind_number(r, "dimensions.height", "height (m)", 0.01, 0.5, 3.5, 1.0, "", _cams_follow)
	r = _row(b)
	ed.bind_number(r, "chassis.mass", "mass (kg)", 10, 50.0, 6000.0)
	ed.bind_number(r, "chassis.weight_distribution", "front weight (%)", 0.5, 20.0, 80.0, 100.0)
	ed.bind_number(r, "chassis.cg_height", "CG height (m)", 0.01, 0.1, 1.5)
	r = _row(ed.body_of("Suspension"))
	travel_row = r
	var travel_box := VBoxContainer.new()
	travel_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_travel_label = EditorStyle.label("Suspension travel before the bump stop: 9 cm", 12, Color("#b9c3d0"))
	travel_box.add_child(_travel_label)
	_travel = HSlider.new()
	_travel.min_value = 1
	_travel.max_value = 120
	_travel.step = 1
	_travel.focus_mode = Control.FOCUS_NONE
	_travel.value_changed.connect(func(v: float):
		_travel_label.text = "Suspension travel before the bump stop: %d cm" % roundi(v)
		if not ed._refreshing:
			ed.cfg["chassis"]["suspension_travel"] = v / 100.0
			ed.changed())
	travel_box.add_child(_travel)
	r.add_child(travel_box)
	_unsprung = CheckBox.new()
	_unsprung.text = "No suspension (a kart)"
	_unsprung.tooltip_text = "No suspension: the wheels are fixed to the frame and the tyres are the only springs (a kart)"
	_unsprung.focus_mode = Control.FOCUS_NONE
	_unsprung.toggled.connect(func(on: bool):
		if ed._refreshing:
			return
		ed.cfg["chassis"]["unsprung"] = on
		ed.suspension.unsprung_changed(on)
		ed.tuning.sync_visibility()
		ed.changed())
	r.add_child(_unsprung)
	r = _row(b)
	ed.bind_number(r, "chassis.wheelbase", "wheelbase (m)", 0.001, 0.8, 5.0, 1.0, "", _wheels_moved)
	var ft := ed.bind_number(r, "chassis.front_track", "front track (m)", 0.001, 0.5, 2.6, 1.0, "", _wheels_moved)
	var rt := ed.bind_number(r, "chassis.rear_track", "rear track (m)", 0.001, 0.5, 2.6, 1.0, "", _wheels_moved)
	_car_only.append_array([ft, rt])
	ed.bind_number(b, "chassis.front_axle_offset", "position of the axles (m, + forward: the middle between them from the middle of the model)", 0.001, -1.0, 1.0, 1.0,
		"", func():
			ed.cfg["chassis"]["rear_axle_offset"] = ed.cfg["chassis"]["front_axle_offset"]
			_wheels_moved())
	r = _row(b)
	_tyre_field = ed.bind_number(r, "chassis.tire_diameter", "tyre diameter (m)", 0.005, NAN, NAN, 1.0, "", _cams_follow)
	_drag_row = HBoxContainer.new()
	_drag_row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ed.bind_number(_drag_row, "chassis.drag_coefficient", "drag coefficient", 0.01, 0.1, 1.0)
	var lock := _row(ed.body_of("Steering"))
	ed.bind_number(lock, "chassis.max_steer_deg", "steering lock (°)", 1, 10.0, 60.0)
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 8)
	b.add_child(flow)
	var sfm := EditorStyle.button("Size from the model", "small ghost")
	sfm.pressed.connect(func():
		size_from_model()
		if ed.model_root != null:
			ed.tuning.share_with_setups(["dimensions"])
		ed.changed())
	flow.add_child(sfm)
	var cfw := EditorStyle.button("Wheelbase, track and tyre from the wheels", "small ghost")
	cfw.pressed.connect(func():
		if ed.with_model_wheels(chassis_from_wheels):
			ed.tuning.share_with_setups(["chassis.wheelbase", "chassis.front_track", "chassis.rear_track", "chassis.tire_diameter", "chassis.front_axle_offset", "chassis.rear_axle_offset"])
		ed.update_helpers()
		ed.changed())
	flow.add_child(cfw)
	r = _row(ed.body_of("Brakes"))
	ed.bind_number(r, "brakes.front", "front (Nm)", 50, 1.0, 6000.0)
	ed.bind_number(r, "brakes.rear", "rear (Nm)", 50, 1.0, 6000.0)
	r.add_child(Control.new())


func _cams_follow() -> void:
	ed.layers.update_camera_markers()
	ed.update_helpers()


func _wheels_moved() -> void:
	if ed.wheel_mode() != "model":
		ed.suspension.wheels_moved()
	ed.update_helpers()


# ---- Motorcycle

func build_bike_card() -> void:
	var c := ed.add_card("Motorcycle")
	_bike_only.append(c["panel"])
	var b: VBoxContainer = c["body"]
	b.add_child(EditorStyle.tipline("The rider and the lean", "The rider and the lean (motorcycle in car.json, Motorcycle.js). The rider is a mass on the bike that " +
		"leans into the corners; the lean is capped, and at speed the keys ask for less of it."))
	var r := _row(b)
	ed.bind_number(r, "motorcycle.max_lean_deg", "max lean (°)", 1, 20.0, 70.0)
	ed.bind_number(r, "motorcycle.fast_lean_deg", "lean at top speed (°)", 1, 10.0, 60.0)
	ed.bind_number(r, "motorcycle.rake_deg", "rake of the fork (°; not used when the model has a steerhead empty)", 0.5, 15.0, 35.0)
	r = _row(b)
	ed.bind_number(r, "motorcycle.rider_mass", "rider mass (kg, on top of the mass)", 5, 0.0, 150.0)
	ed.bind_number(r, "motorcycle.hang_off", "hang off (m, to the inside)", 0.05, 0.0, 0.6)
	ed.bind_number(r, "motorcycle.max_lateral_g", "max lateral g (the lean it asks for)", 0.05, 0.3, 2.0)
	r = _row(b)
	ed.bind_number(r, "motorcycle.balance", "balance (the strength of the rider's lean control)", 0.1, 0.0, 3.0)
	ed.bind_number(r, "motorcycle.fork_dive", "fork geometry (1: the model, 0: off)", 0.1, 0.0, 2.0)
	r = _row(b)
	var push := VBoxContainer.new()
	push.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ed.bind_check(push, "motorcycle.push", "flat-track style")
	push.add_child(EditorStyle.hint("upright, the bike pushed under the rider: a deeper lean, the inside foot out, a slide countersteered by itself (off: hang off)"))
	r.add_child(push)
	ed.bind_number(r, "motorcycle.push_foot_kmh", "flat-track: the inside foot comes out in a bend up to this speed (km/h)", 5, 20.0, 250.0)


# ---- Drivetrain

func build_drivetrain_card() -> void:
	var c := ed.add_card("Drivetrain")
	var b: VBoxContainer = c["body"]
	var r := _row(b)
	_car_only.append(r)
	var drive := VBoxContainer.new()
	drive.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	drive.add_child(EditorStyle.label("Drive", 12, Color("#b9c3d0")))
	ed.bind_select(drive, "drivetrain.drive", [["rwd", "Rear wheel drive"], ["fwd", "Front wheel drive"], ["awd", "All wheel drive"]], _drive_changed)
	r.add_child(drive)
	var diff := VBoxContainer.new()
	diff.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	diff.add_child(EditorStyle.label("Differential", 12, Color("#b9c3d0")))
	ed.bind_select(diff, "drivetrain.diff", [["open", "Open"], ["lsd", "Limited slip"], ["welded", "Welded (locked)"]], _drive_changed, "lsd")
	r.add_child(diff)
	_lsd_row = _row(b)
	ed.bind_number(_lsd_row, "drivetrain.diff_preload", "preload (Nm)", 10, 0.0, 1000.0)
	ed.bind_number(_lsd_row, "drivetrain.diff_power", "lock under power (%)", 5, 0.0, 100.0, 100.0)
	ed.bind_number(_lsd_row, "drivetrain.diff_coast", "lock off throttle (%)", 5, 0.0, 100.0, 100.0)
	_centre_row = _row(b)
	var cd := VBoxContainer.new()
	cd.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cd.add_child(EditorStyle.label("Centre differential (AWD)", 12, Color("#b9c3d0")))
	ed.bind_select(cd, "drivetrain.center_diff", [["open", "Open"], ["lsd", "Limited slip"], ["locked", "Locked"]], _drive_changed, "lsd")
	_centre_row.add_child(cd)
	ed.bind_number(_centre_row, "drivetrain.center_split", "torque to the front (%)", 1, 0.0, 100.0, 100.0)
	_diff_info = EditorStyle.hint("")
	b.add_child(_diff_info)
	_car_only.append(_diff_info)
	r = _row(b)
	var gb := VBoxContainer.new()
	gb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	gb.add_child(EditorStyle.label("Gearbox", 12, Color("#b9c3d0")))
	ed.bind_select(gb, "drivetrain.gearbox", GEARBOXES, _gearbox_changed, "gears")
	r.add_child(gb)
	_cvt_box = VBoxContainer.new()
	_cvt_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_cvt_box.add_child(EditorStyle.label("CVT: engine speed at full throttle (rpm)", 12, Color("#b9c3d0")))
	ed.bind_number(_cvt_box, "drivetrain.cvt_rpm", "", 100, NAN, NAN, 1.0, "85 % of the rev limit", Callable(), true)
	r.add_child(_cvt_box)
	_tc_row = _row(b)
	ed.bind_number(_tc_row, "drivetrain.tc_stall_rpm", "converter: stall speed (rpm)", 50, 1000.0, 5000.0, 1.0, "35 % of the rev limit", Callable(), true)
	ed.bind_number(_tc_row, "drivetrain.tc_ratio", "converter: torque ratio at stall", 0.05, 1.0, 3.0, 1.0, "1.9", Callable(), true)
	ed.bind_check(_tc_row, "drivetrain.tc_lockup", "Lock-up clutch", Callable(), true)
	b.add_child(EditorStyle.label("Gear ratios (1st, 2nd, … comma separated)", 12, Color("#b9c3d0")))
	_gears = EditorStyle.line_edit("", "3.6, 2.1, 1.4, 1.0, 0.8")
	_gears.text_changed.connect(func(t: String):
		var list := []
		for part in t.replace(";", ",").replace(" ", ",").split(",", false):
			if part.is_valid_float() and float(part) > 0.0:
				list.append(float(part))
		ed.cfg["drivetrain"]["gear_ratios"] = list
		ed.engine.update_speed_info()
		ed.changed(false))
	_gears.focus_exited.connect(func(): ed.changed())
	b.add_child(_gears)
	r = _row(b)
	ed.bind_number(r, "drivetrain.final_drive", "final drive", 0.05, 1.0, 10.0, 1.0, "", func(): ed.engine.update_speed_info())
	var rev := ed.bind_number(r, "drivetrain.reverse_ratio", "reverse ratio", 0.05, 1.0, 10.0)
	_car_only.append(rev)
	ed.bind_number(r, "drivetrain.efficiency", "efficiency", 0.01, 0.5, 1.0)


func _drive_changed() -> void:
	_update_diff()
	ed.suspension.refresh(true)
	ed.tuning.sync_visibility()


func _gearbox_changed() -> void:
	var g := str(Tuning.read(ed.cfg, "drivetrain.gearbox"))
	_cvt_box.modulate.a = 1.0 if g == "cvt" else 0.0
	_cvt_box.mouse_filter = Control.MOUSE_FILTER_STOP
	_tc_row.visible = g == "torque-converter"
	ed.tuning.sync_visibility()
	ed.engine.update_speed_info()


func _update_diff() -> void:
	var drive := str(Tuning.read(ed.cfg, "drivetrain.drive"))
	var diff := str(Tuning.read(ed.cfg, "drivetrain.diff"))
	_lsd_row.visible = diff == "lsd" and not ed.is_bike()
	_centre_row.visible = drive == "awd" and not ed.is_bike()
	var centre: String = {"open": "open, the fixed share", "lsd": "limited slip", "locked": "locked"}.get(str(Tuning.read(ed.cfg, "drivetrain.center_diff")), "")
	_diff_info.text = DIFF_INFO.get(diff, "") + (" Centre: %s." % centre if drive == "awd" else "")


# ---- Cameras

func build_cameras_card() -> void:
	var c := ed.add_card("Cameras")
	var b: VBoxContainer = c["body"]
	b.add_child(EditorStyle.hint("● 1 follow (green)   ● the point it looks at (light green)   ● 2 cockpit (orange)"))
	var r := _row(b)
	r.add_child(EditorStyle.hint("The cameras of the game; the dots in the view show them"))
	var open := EditorStyle.button("Cameras…", "small")
	open.pressed.connect(func(): (_cam_dialog["window"] as Window).popup_centered())
	r.add_child(open)
	_cam_dialog = EditorStyle.dialog(ed, "Cameras", Vector2(620, 520))
	var d: VBoxContainer = _cam_dialog["body"]
	d.add_child(EditorStyle.tipline("Heights above the road; cockpit from the origin", "Heights are above the road; the cockpit is from the origin of the model " +
		"(x to the left, y up, z forward). Fields of view are the vertical angle in degrees."))
	d.add_child(EditorStyle.group("1 Follow"))
	var upd := func():
		ed.layers.update_camera_markers()
		update_camera_fields()
	r = _row(d)
	ed.bind_number(r, "cameras.follow.distance", "distance (m)", 0.1, 1.0, 15.0, 1.0, "", upd)
	ed.bind_number(r, "cameras.follow.height", "height (m)", 0.05, 0.0, 6.0, 1.0, "", upd)
	ed.bind_number(r, "cameras.follow.look_height", "looks at height (m)", 0.05, -1.0, 4.0, 1.0, "", upd)
	ed.bind_number(r, "cameras.follow.look_z", "looks at ahead (m)", 0.1, -3.0, 3.0, 1.0, "", upd)
	r = _row(d)
	ed.bind_number(r, "cameras.follow.smoothing", "follow speed (1/s)", 0.1, 0.0, 10.0, 1.0, "", upd)
	ed.bind_number(r, "cameras.follow.fov_standing", "FOV standing", 1, 20.0, 100.0, 1.0, "", upd)
	ed.bind_number(r, "cameras.follow.fov_fast", "FOV at full speed", 1, 20.0, 120.0, 1.0, "", upd)
	r = _row(d)
	ed.bind_number(r, "cameras.follow.distance_fast", "distance at full speed (m, 0: comes closer)", 0.1, 0.0, 15.0, 1.0, "", upd)
	_cam_height_fast = ed.bind_number(r, "cameras.follow.height_fast", "height at full speed (m)", 0.05, 0.0, 6.0, 1.0, "", upd)
	r.add_child(Control.new())
	r = _row(d)
	ed.bind_number(r, "cameras.follow.fov_full_speed", "full speed (km/h)", 10, 50.0, 400.0, 3.6, "", upd)
	_cam_dolly = ed.bind_number(r, "cameras.follow.dolly", "comes closer (0 to 1)", 0.1, 0.0, 1.0, 1.0, "", upd)
	r.add_child(Control.new())
	d.add_child(EditorStyle.tipline("Faster: wider view and the camera moves in", "The faster the car, the wider the FOV. With “comes closer” at 1 the camera moves in " +
		"with it, so the car keeps its size and only the sense of speed changes (a dolly zoom)."))
	d.add_child(EditorStyle.group("3 Hood"))
	r = _row(d)
	ed.bind_number(r, "cameras.bonnet.position.0", "x (m, left)", 0.01, -1.5, 1.5, 1.0, "", upd)
	ed.bind_number(r, "cameras.bonnet.position.1", "y (m, up)", 0.01, -1.0, 3.0, 1.0, "", upd)
	ed.bind_number(r, "cameras.bonnet.position.2", "z (m, forward)", 0.01, -4.0, 4.0, 1.0, "", upd)
	r = _row(d)
	ed.bind_number(r, "cameras.bonnet.fov", "field of view", 1, 20.0, 120.0, 1.0, "", upd)
	r.add_child(Control.new())
	r.add_child(Control.new())
	d.add_child(EditorStyle.group("2 Cockpit"))
	r = _row(d)
	ed.bind_number(r, "cameras.cockpit.position.0", "x (m, left)", 0.01, -1.5, 1.5, 1.0, "", upd)
	ed.bind_number(r, "cameras.cockpit.position.1", "y (m, up)", 0.01, 0.0, 2.5, 1.0, "", upd)
	ed.bind_number(r, "cameras.cockpit.position.2", "z (m, forward)", 0.01, -3.0, 3.0, 1.0, "", upd)
	r = _row(d)
	ed.bind_number(r, "cameras.cockpit.fov", "field of view", 1, 20.0, 100.0, 1.0, "", upd)
	r.add_child(Control.new())
	r.add_child(Control.new())
	var defaults := EditorStyle.button("Defaults for the size of the car", "small ghost")
	defaults.pressed.connect(func():
		default_cameras()
		ed.changed())
	d.add_child(defaults)


func default_cameras() -> void:
	var c := ed.cfg.duplicate(true)
	var hide: bool = Tuning.read(ed.cfg, "cameras.cockpit.hide_driver") == true
	c.erase("cameras")
	ed.cfg["cameras"] = CarEditorIO.camera_settings(c)
	ed.cfg["cameras"]["cockpit"]["hide_driver"] = hide
	ed.refresh_fields()
	ed.layers.update_camera_markers()


# ---- the form shows the car

func fill() -> void:
	update_camera_fields()
	_id_edit.text = ed.car_id
	EditorStyle.select_value(_type_pick, "motorcycle" if ed.is_bike() else "car")
	_radio_default.set_pressed_no_signal(ed.wheel_radio != "model")
	_radio_model.set_pressed_no_signal(ed.wheel_radio == "model")
	_travel.set_value_no_signal(roundf(ed.num("chassis.suspension_travel", 0.09) * 100.0))
	_travel_label.text = "Suspension travel before the bump stop: %d cm" % roundi(_travel.value)
	_unsprung.set_pressed_no_signal(Tuning.read(ed.cfg, "chassis.unsprung") == true)
	var g: Variant = Tuning.read(ed.cfg, "drivetrain.gear_ratios")
	var parts := []
	for x in (g if g is Array else []):
		parts.append(CarEditorIO._json(float(x), ""))
	if not _gears.has_focus():
		_gears.text = ", ".join(parts)
	_select_lists()
	_show_library()
	_update_diff()
	_gearbox_changed()
	sync_tyre_field()
	update_steering_info()
	apply_type_ui()


## A motorcycle shows only what a motorcycle has: one wheel at each end (Front left and Rear left), no differential, the Motorcycle card.
func apply_type_ui() -> void:
	var bike := ed.is_bike()
	for c in _car_only:
		(c as Control).visible = not bike
	for c in _bike_only:
		(c as Control).visible = bike
	(_list_labels["FL"] as Label).text = "■ " + ("Front wheel" if bike else "Front left")
	(_list_labels["RL"] as Label).text = "■ " + ("Rear wheel" if bike else "Rear left")
	if bike:
		ed.cfg["drivetrain"]["drive"] = "rwd"
		ed.cfg["drivetrain"]["diff"] = "welded"
		_sync_bike_wheels()
	_update_diff()
	for axle in ["front", "rear"]:
		_tyre_rows[axle].visible = bike and str(EditorStyle.value_of(_rim_picks[axle])) != ""
	if ed.model_root != null:
		ed.update_helpers()

