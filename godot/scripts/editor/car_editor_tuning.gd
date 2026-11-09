class_name CarEditorTuning
extends RefCounted
## The settings of the tuning menu in the cards of the car editor (car-editor.js, the Tuning card): every group of the
## tuning table (Tuning.GROUPS, after CarTuning.js) that the form does not have in fields of its own goes into the card it
## is about (Tyres into Wheels, Fuel and Engine into Engine, Transmission into Drivetrain, ...), each setting a line with a
## number, its unit and ↺ (back to the car as loaded) over a slider; the paint of the body and the rims; the systems and
## the extras (a tick each) in Assists and extras. And the setups of the car (the tunes, Tuning.save_tune): Default is the
## car as made (car.json); Save writes to what is chosen; + New tune, Delete, Export and Import of a tune file.

## The rows of the tuning menu that the form has as its own fields.
const EDITOR_HAS := ["mass", "front_weight", "cg_height", "drag_coefficient", "max_steer_deg", "idle_rpm", "limiter_rpm", "engine_inertia",
	"final_drive", "reverse_ratio", "brake_total", "brake_bias", "diff_preload", "diff_power", "diff_coast", "center_split", "suspension_travel",
	"efficiency", "length", "width", "height", "steering_degrees", "steering_stop", "sb_max_nodes", "sb_wheel_strength", "unsprung",
	"cam_follow_distance", "cam_follow_height", "cam_follow_look_height", "cam_follow_look_z", "cam_follow_smoothing", "cam_follow_fov_standing",
	"cam_follow_fov_fast", "cam_follow_fov_full_speed", "cam_follow_dolly", "cam_follow_distance_fast", "cam_follow_height_fast", "cam_bonnet_x", "cam_bonnet_y", "cam_bonnet_z", "cam_bonnet_fov", "cam_cockpit_x", "cam_cockpit_y", "cam_cockpit_z", "cam_cockpit_fov",
	"cam_cockpit_hide_driver", "drive", "diff", "center_diff", "gearbox", "gears", "cvt_rpm", "tc_stall_rpm", "tc_ratio", "tc_lockup",
	"rim_front", "rim_rear", "tyre_front", "tyre_rear", "susp_front", "susp_rear", "engine_place", "es_convolution",
	"body_color", "rim_color", "body_finish", "rim_finish", "body_pattern", "rim_pattern", "body_uv", "rim_uv", "body_flake", "rim_flake"]
## The card each group of the table goes into.
const HOMES := {"Chassis": "Chassis", "Brakes": "Brakes", "Aerodynamics": "Aerodynamics", "Steering": "Steering", "Tyres": "Wheels", "Paint": "Materials",
	"Springs and dampers": "Suspension", "Ride height and travel": "Suspension", "Wheel alignment": "Suspension", "Suspension geometry": "Suspension", "Suspension parts": "Suspension",
	"Fuel": "Engine", "Engine": "Engine", "Transmission": "Drivetrain", "Engine sound": "Engine sound"}
const PAINT := ["body", "rim"]
const TYRE_KEYS := ["tyre_section_front", "tyre_section_rear", "tyre_aspect_front", "tyre_aspect_rear", "tyre_rim_front", "tyre_rim_rear", "tyre_diameter_front", "tyre_diameter_rear", "tyre_height_front", "tyre_height_rear", "rubber_front", "rubber_rear", "tread_front", "tread_rear",
	"tyre_width", "tyre_width_rear", "tyre_inner_ratio", "tyre_rings", "tyre_segments", "tyre_carcass"]

var ed: CarEditor
var save_button: Button
var base := {}                       # the values of the car as it was loaded (↺ goes back to them)
var _rows: Array = []                # { key, item, label, slider, num, reset, kind }
var _groups: Array = []              # the folds that were put in the cards
var _features: Array = []
var _setup_pick: OptionButton
var _save_to: Label
var _tune_menu: MenuButton
var _ship: Button
var _paths := {}                     # tune name -> its file
var _refreshing := false
var _folds: Array = []               # the bodies of the groups: one without a row that this car can use is not shown
var _tyres_root: Node3D = null
var _tyres: Variant = null
var _shown_for := ""                 # the car that the list of tunes was made for
var _before := ""                    # the tune that is chosen, for Stay when a switch is called off


func _init(editor: CarEditor) -> void:
	ed = editor


# ---- the setups

func build_setup_bar(parent: VBoxContainer) -> void:
	_setup_pick = EditorStyle.options([["", "Default (the car as made)"]])
	_setup_pick.tooltip_text = "The tune of the car: Default is the car as made (car.json), a tune is a setup kept by the game (the tuning menu, U)"
	_setup_pick.item_selected.connect(func(_i: int): _pick_setup())
	parent.add_child(_setup_pick)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	parent.add_child(row)
	save_button = EditorStyle.button("Save the car", "primary", "Save the car (car.json)")
	save_button.pressed.connect(save_pressed)
	row.add_child(save_button)
	var new_tune := EditorStyle.button("+ New tune", "small", "Keep the car as the form has it as a new tune (a name is asked)")
	new_tune.pressed.connect(_new_tune)
	row.add_child(new_tune)
	_tune_menu = MenuButton.new()
	_tune_menu.text = "Tune file ▾"
	_tune_menu.flat = false
	_tune_menu.tooltip_text = "Delete, export or import a tune"
	var pm := _tune_menu.get_popup()
	pm.add_item("Delete tune", 0)
	pm.add_item("Export tune file…", 1)
	pm.add_item("Import tune file…", 2)
	pm.id_pressed.connect(_tune_action)
	row.add_child(_tune_menu)
	_ship = EditorStyle.button("Ship with the car", "small ghost", "The tune that is chosen as a file next to car.json, listed in car.json: " +
		"it comes with the car, for everyone who plays it")
	_ship.pressed.connect(ship_pressed)
	_ship.visible = false
	parent.add_child(_ship)
	_save_to = EditorStyle.hint("Save writes car.json")
	parent.add_child(_save_to)


func chosen_tune() -> String:
	return str(EditorStyle.value_of(_setup_pick)) if _setup_pick.selected > 0 else ""


## A car was loaded: the next render_setups chooses Default.
func forget_choice() -> void:
	_shown_for = ""


func render_setups() -> void:
	var own := ed.car_id != "" and ed.car_id == ed.existing_id
	var same_car := ed.existing_id != "" and _shown_for == ed.existing_id
	var kept := chosen_tune() if _setup_pick.item_count > 0 else ""
	_setup_pick.clear()
	_setup_pick.add_item("Default (the car as made)")
	_setup_pick.set_item_metadata(0, "")
	_paths = {}
	if own:
		var detail := Tuning.list_detail(ed.existing_id, ed.existing)
		for n in detail:
			var d: Dictionary = detail[n]
			_paths[n] = d["own"] if d["own"] != "" else d["car"]
			_setup_pick.add_item(str(n) + (" · with the car" if d["own"] == "" else (" · with the car, changed here" if d["car"] != "" else "")))
			_setup_pick.set_item_metadata(_setup_pick.item_count - 1, n)
		if same_car and _paths.has(kept):   # (a save, a new model: what is being edited stays chosen; a car that was just loaded starts at Default)
			EditorStyle.select_value(_setup_pick, kept)
	_shown_for = ed.existing_id
	_before = chosen_tune()
	_setup_pick.disabled = not own
	update_tune_buttons()


## What was measured from the model belongs to every setup: the values of the form go in every tune and in car.json at once.
func share_with_setups(paths: Array) -> void:
	if ed.existing_id == "" or ed.car_id != ed.existing_id:
		return
	var values := {}
	for p: String in paths:
		values[p] = Tuning.read(ed.cfg, p)
	var detail := Tuning.list_detail(ed.existing_id, ed.existing)
	var car_dir := ed.save_dir().path_join(ed.existing_id)
	for n: String in detail:
		var d: Dictionary = detail[n]
		if d["own"] != "":
			Tuning.patch_tune_file(d["own"], values)
		if d["car"] != "":                     # (the tune that comes with the car: its file next to car.json, like the car as made)
			var shipped := car_dir.path_join(str(d["car"]).get_file())
			if FileAccess.file_exists(shipped):
				Tuning.patch_tune_file(shipped, values)
			elif d["own"] == "":
				var t := Tuning.load_tune(str(d["car"]))
				for p: String in values:
					Tuning.write(t, p, values[p])
				Tuning.save_tune(ed.existing_id, n, t)
	var e: String = ed.io.patch_car(values)
	if e != "":
		ed.status(e, "error")
		return
	render_setups()
	ed.status("Saved on all setups: Default and %d tunes." % detail.size(), "ok")


func update_tune_buttons() -> void:
	var n := chosen_tune()
	if ed.card_of.has("Model"):             # (the model belongs to the car, not to a tune)
		(ed.card_of["Model"]["panel"] as Control).visible = n == ""
	save_button.text = ("Save tune" if n != "" else "Save the car") + (" •" if ed.dirty else "")
	save_button.tooltip_text = ("Overwrite the tune %s with the car as the form has it (car.json is not written)" % n) if n != "" else "Save the car (car.json)"
	var where := "your garage" if not ed.save_to_repo else "web/cars (the repository)"
	_save_to.text = ("Save writes to the tune " + n) if n != "" else "Save writes car.json in " + where
	var ship := shipped_state(n)
	_ship.visible = n != ""
	_ship.text = "Take off the car" if ship == "car" else ("Ship the changes with the car" if ship == "copy" else "Ship with the car")
	if ship == "car":
		_save_to.text += " (a copy of your own)"


## Where a tune is: "car" (it comes with the car only), "copy" (with the car, and changed here), "" (the player's own).
func shipped_state(n: String) -> String:
	if n == "" or ed.existing_id == "":
		return ""
	var d: Variant = Tuning.list_detail(ed.existing_id, ed.existing).get(n)
	if not d is Dictionary or d["car"] == "":
		return ""
	return "car" if d["own"] == "" else "copy"


## Ship with the car (car-editor.js tuneShip): the tune that is chosen as <name>.openracer-tune.json next to car.json and
## its file in car.json "tunes" (only car.json as it was saved is written, with the list, not what the form changed); the
## player's copy goes, the file is the tune now. Take off the car removes the file and the name again.
func ship_pressed() -> void:
	var id := ed.existing_id
	var n := chosen_tune()
	if id == "" or ed.car_id != id or ed.existing.is_empty():
		ed.status("Save the car first.", "error")
		return
	if n == "":
		ed.status("Choose a tune first.", "error")
		return
	var ship := shipped_state(n)
	var detail: Dictionary = Tuning.list_detail(id, ed.existing)[n]
	var kept := str(detail["car"]).get_file() if detail["car"] != "" else ""
	var car := ed.existing.duplicate(true)
	var list := []
	for f in car.get("tunes", []) if car.get("tunes") is Array else []:
		if str(f) != kept:
			list.append(str(f))
	var dir := ed.save_dir().path_join(id)
	DirAccess.make_dir_recursive_absolute(dir)
	if ship == "car":
		if not await ed.ask("Take the tune %s off the car?" % n, "Its file is removed from the folder of the car.", "Take off"):
			return
		if FileAccess.file_exists(dir.path_join(kept)):
			DirAccess.remove_absolute(dir.path_join(kept))
	else:
		var c := Tuning.load_tune(str(detail["own"]))
		for k in ["model", "id", "tunes"]:
			c.erase(k)
		var file_name := kept
		if file_name == "":
			var base := n.validate_filename().replace(" ", "-").to_lower()
			file_name = base + ".openracer-tune.json"
			var k := 2
			while list.has(file_name):
				file_name = "%s-%d.openracer-tune.json" % [base, k]
				k += 1
		var f := FileAccess.open(dir.path_join(file_name), FileAccess.WRITE)
		if f == null:
			ed.status("Could not write %s (%s)." % [file_name, error_string(FileAccess.get_open_error())], "error")
			return
		f.store_string(JSON.stringify({"openracer-tune": 1, "car": id, "name": n, "saved": Time.get_datetime_string_from_system(true) + "Z", "config": c}, " ") + "\n")
		f.close()
		list.append(file_name)
	if list.is_empty():
		car.erase("tunes")
	else:
		car["tunes"] = list
	var jf := FileAccess.open(dir.path_join("car.json"), FileAccess.WRITE)
	if jf == null:
		ed.status("Could not change the tunes of the car (%s)." % error_string(FileAccess.get_open_error()), "error")
		return
	jf.store_string(CarEditorIO.to_json(car))
	jf.close()
	if car.has("tunes"):
		ed.existing["tunes"] = car["tunes"]
	else:
		ed.existing.erase("tunes")
	if ship != "car":
		Tuning.delete_tune(str(detail["own"]))      # (the copy of the player is the file now)
	render_setups()
	EditorStyle.select_value(_setup_pick, n)
	update_tune_buttons()
	ed.status("Tune %s is off the car." % n if ship == "car" else "Tune %s comes with the car now: %s next to car.json." % [n, list[-1]], "ok")
	RunLog.event("car editor: tune %s %s %s" % [n, "taken off" if ship == "car" else "shipped with", id])


func save_pressed() -> void:
	if chosen_tune() == "":
		await ed.save()
		return
	save_tune_now()


## The tune that is chosen, overwritten with the form (the model of a car is not part of a tune).
func save_tune_now() -> bool:
	var n := chosen_tune()
	if not ed.model_files.is_empty():
		ed.status("A new model is part of the car, not of a tune: choose “Default (the car as made)” and save the car to keep it.", "error")
		return false
	var c := ed.build_config(ed.car_id)
	if c.has("_error"):
		ed.status("Could not save the tune: " + str(c["_error"]), "error")
		return false
	if not ed.overrides.is_empty():
		c["materials"] = ed.overrides.duplicate(true)
	var driver_error := ed.io.save_driver(c)
	if driver_error != "":
		ed.status(driver_error, "error")
		return false
	var drove: bool = ed.io.driver_written
	c.erase("model")
	c.erase("driver")
	Tuning.save_tune(ed.car_id, n, c)
	render_setups()
	EditorStyle.select_value(_setup_pick, n)
	update_tune_buttons()
	ed.set_dirty(false)
	ed.status("Tune %s saved%s." % [n, "; the driver is saved in car.json, for all setups" if drove else " (car.json is not written)"], "ok")
	return true


func _new_tune() -> void:
	if ed.car_id == "" or ed.car_id != ed.existing_id:
		ed.status("Save the car first: a tune belongs to a car that is saved.", "error")
		return
	var n := await ed.ask_text("New tune", "The name of the new tune")
	n = n.substr(0, 40)
	if n == "":
		return
	var c := ed.build_config(ed.car_id)
	if c.has("_error"):
		ed.status("Could not save the tune: " + str(c["_error"]), "error")
		return
	var driver_error := ed.io.save_driver(c)
	if driver_error != "":
		ed.status(driver_error, "error")
		return
	c.erase("model")
	c.erase("driver")
	if not ed.overrides.is_empty():
		c["materials"] = ed.overrides.duplicate(true)
	Tuning.save_tune(ed.car_id, n, c)
	render_setups()
	EditorStyle.select_value(_setup_pick, n)
	update_tune_buttons()
	ed.status("Tune %s saved; the tuning menu of the game (U) has it." % n, "ok")


func _pick_setup() -> void:
	if _refreshing:
		return
	var n := chosen_tune()
	if ed.dirty and not await ed.ask("Switch to %s?" % ("“%s”" % n if n != "" else "Default"),
			"The car in the form has changes that are not saved. They are lost when you switch.",
			"Switch", "Stay"):
		EditorStyle.select_value(_setup_pick, _before)
		return
	_before = n
	var c: Dictionary
	if n == "":
		c = ed.existing.duplicate(true)
	else:
		c = Tuning.load_tune(str(_paths.get(n, "")))
		if c.is_empty():
			ed.status("Could not read the tune %s." % n, "error")
			return
		c["model"] = ed.existing.get("model", {})
		Tuning.keep_driver(c, ed.existing)
	var keep_model: Dictionary = ed.cfg.get("model", {})
	ed.cfg = ed.io.normalise(c)
	ed.cfg["model"] = keep_model if not keep_model.is_empty() else ed.cfg["model"]
	if c.get("materials") is Dictionary:
		ed.overrides = (c["materials"] as Dictionary).duplicate(true)
		ed.mats.apply_all()
	ed._fill_all()
	EditorStyle.select_value(_setup_pick, n)
	update_tune_buttons()
	ed.set_dirty(false)
	ed.status(("Tune %s is in the form." % n) if n != "" else "Default, the car as made, is in the form.")


func _tune_action(id: int) -> void:
	var n := chosen_tune()
	match id:
		0:
			if n == "":
				ed.status("Choose a tune first.", "error")
				return
			var path := str(_paths.get(n, ""))
			if not path.begins_with(Tuning.tunes_root):
				ed.status("This tune comes with the car: Take off the car takes it away.", "error")
				return
			if not await ed.ask("Delete the tune %s?" % n, "Its file is removed.", "Delete"):
				return
			Tuning.delete_tune(path)
			render_setups()
			ed.status("Tune %s deleted." % n, "ok")
		1:
			_export_tune(n)
		2:
			_import_tune()


func _file_dialog(mode: FileDialog.FileMode, file_name := "") -> FileDialog:
	var dlg := FileDialog.new()
	dlg.file_mode = mode
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.filters = PackedStringArray(["*.json ; A tune file"])
	dlg.current_file = file_name
	ed.add_child(dlg)
	dlg.canceled.connect(dlg.queue_free)
	return dlg


func _export_tune(n: String) -> void:
	if ed.car_id == "":
		ed.status("Give the car an id first.", "error")
		return
	var c: Dictionary = Tuning.load_tune(str(_paths[n])) if n != "" else ed.build_config(ed.car_id)
	if c.has("_error"):
		ed.status(str(c["_error"]), "error")
		return
	var title := n if n != "" else str(ed.cfg.get("name", ed.car_id)) + " as in the editor"
	var dlg := _file_dialog(FileDialog.FILE_MODE_SAVE_FILE, (ed.car_id + "-" + title).validate_filename().replace(" ", "-") + ".openracer-tune.json")
	dlg.file_selected.connect(func(p: String):
		var f := FileAccess.open(p, FileAccess.WRITE)
		if f != null:
			f.store_string(JSON.stringify({"openracer-tune": 1, "car": ed.car_id, "name": title, "saved": Time.get_datetime_string_from_system(true) + "Z", "config": c}, "  "))
			f.close()
			ed.status("Tune saved as %s." % p.get_file(), "ok")
		dlg.queue_free())
	dlg.popup_centered_ratio(0.6)


func _import_tune() -> void:
	if ed.car_id == "" or ed.car_id != ed.existing_id:
		ed.status("Save the car first, then import a tune for it.", "error")
		return
	var dlg := _file_dialog(FileDialog.FILE_MODE_OPEN_FILE)
	dlg.file_selected.connect(func(p: String):
		dlg.queue_free()
		var t: Variant = JSON.parse_string(FileAccess.get_file_as_string(p))
		if not t is Dictionary or not t.get("config") is Dictionary:
			ed.status("This is not a tune file of OpenRacer.", "error")
			return
		var n := await ed.ask_text("Import a tune", "The name of this tune" + (" (it was made for %s)" % t.get("car") if str(t.get("car", "")) != ed.car_id else ""),
			str(t.get("name", p.get_file())))
		if n == "":
			return
		Tuning.save_tune(ed.car_id, n.substr(0, 40), t["config"])
		render_setups()
		EditorStyle.select_value(_setup_pick, n.substr(0, 40))
		ed.set_dirty(false)
		_pick_setup()
		ed.status("Tune %s imported and loaded into the form." % n, "ok"))
	dlg.popup_centered_ratio(0.6)


# ---- the groups of the tuning table in the cards

func build_groups() -> void:
	render_groups()


func _cam() -> Dictionary:
	return {}


## The groups made again (a car was loaded, the engine changed the turbo, a rim was chosen).
func render_groups() -> void:
	for g in _groups:
		if is_instance_valid(g):
			g.queue_free()
	_groups = []
	_folds = []
	_rows = []
	_features = []
	for group in Tuning.GROUPS:
		var gname: String = group[0]
		if not HOMES.has(gname):
			continue
		var items := []
		for item in group[1]:
			if not item[0] in EDITOR_HAS:
				items.append(item)
		if items.is_empty() and gname != "Paint":
			continue
		var body := ed.body_of(HOMES[gname])
		var title := gname + " settings" if HOMES[gname] == gname else gname
		var fold := EditorStyle.fold(body, title)
		_groups.append(fold.get_parent().get_parent())
		_folds.append(fold)
		if gname == "Paint":
			_paint(fold)
		var fine: VBoxContainer = null
		for item in items:
			var target := fold
			if gname == "Tyres" and item[0] in Tuning.TYRE_FINE:
				if fine == null:
					fine = EditorStyle.fold(fold, "Fine-tune the tyre (on top of the kind)")
				target = fine
			_row(target, item)
		if fine != null:
			fold.move_child(fine.get_parent().get_parent(), fold.get_child_count() - 1)
	var assists := ed.body_of("Assists and extras")
	var box := VBoxContainer.new()
	assists.add_child(box)
	_groups.append(box)
	for f in Tuning.FEATURES:
		_feature(box, f)
	refresh()


func _row(parent: Control, d: Array) -> void:
	var key: String = d[0]
	var item := VBoxContainer.new()
	item.add_theme_constant_override("separation", 0)
	parent.add_child(item)
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 6)
	item.add_child(line)
	var label := EditorStyle.label(str(d[1]), 12, EditorStyle.MUTED)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.mouse_filter = Control.MOUSE_FILTER_PASS
	line.add_child(label)
	if key in Tuning.NOT_IN_GODOT:
		item.tooltip_text = Tuning.NOT_YET
		label.tooltip_text = Tuning.NOT_YET
	var entry := {"key": key, "item": item, "label": label, "text": str(d[1])}
	if key in CarEditorTyreNodes.KEYS:
		item.set_meta("tyre_key", true)
	if Tuning.SELECTS.has(key) or float(d[4]) <= float(d[3]):
		var items: Array = Tuning.SELECTS.get(key, [])
		if key == "tyre_damage":
			var tick := CheckBox.new()
			tick.text = ""
			tick.focus_mode = Control.FOCUS_NONE
			tick.toggled.connect(func(on: bool):
				if not _refreshing:
					_change(key, "on" if on else "off"))
			line.add_child(tick)
			entry["kind"] = "tick"
			entry["check"] = tick
			label.text = "Tyre damage (a hard hit can puncture a tyre)"
		else:
			var pick := EditorStyle.options(items)
			pick.custom_minimum_size.x = 170
			pick.size_flags_horizontal = Control.SIZE_FILL
			pick.item_selected.connect(func(_i: int):
				if not _refreshing:
					_change(key, EditorStyle.value_of(pick)))
			line.add_child(pick)
			entry["kind"] = "select"
			entry["pick"] = pick
	else:
		var num := EditorStyle.NumberField.new("", float(d[5]))
		num.custom_minimum_size.x = 84
		num.size_flags_horizontal = Control.SIZE_FILL
		line.add_child(num)
		var unit := EditorStyle.label(str(d[2]), 11, EditorStyle.MUTED, false)
		unit.custom_minimum_size.x = 44
		line.add_child(unit)
		var twin := key.trim_suffix("_rear") + "_front" if key.ends_with("_rear") else ""
		if twin != "" and not twin in EDITOR_HAS and Tuning.MAP.has(twin):
			var same := EditorStyle.button("= front", "small ghost", "The value of the front")
			same.pressed.connect(func():
				var v := Tuning.values_of(ed.cfg)
				if v.has(twin):
					_change(key, v[twin]))
			line.add_child(same)
		var reset := EditorStyle.button("↺", "small ghost", "Back to the value of the car as loaded")
		reset.pressed.connect(func():
			if base.has(key):
				_change(key, base[key]))
		line.add_child(reset)
		var slider := HSlider.new()
		slider.min_value = float(d[3])
		slider.max_value = float(d[4])
		slider.step = float(d[5])
		slider.focus_mode = Control.FOCUS_NONE
		slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		item.add_child(slider)
		var lo := float(d[3])
		var hi := float(d[4])
		slider.value_changed.connect(func(x: float):
			if not _refreshing:
				_change(key, x))
		num.committed.connect(func(x: float):
			if not _refreshing and not is_nan(x):
				_change(key, clampf(x, lo * 2.0 if lo < 0.0 else lo / 2.0, hi * 2.0)))
		entry.merge({"kind": "slider", "slider": slider, "num": num, "reset": reset})
	_rows.append(entry)


func _feature(parent: Control, f: Array) -> void:
	var key: String = f[0] + "_on"
	var wrap := VBoxContainer.new()
	parent.add_child(wrap)
	var line := HBoxContainer.new()
	var tick := CheckBox.new()
	tick.focus_mode = Control.FOCUS_NONE
	tick.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	line.add_child(tick)
	var text := EditorStyle.label(str(f[1]), 13)
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.mouse_filter = Control.MOUSE_FILTER_STOP
	text.gui_input.connect(func(e: InputEvent):
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			tick.button_pressed = not tick.button_pressed)
	line.add_child(text)
	wrap.add_child(line)
	var inner := MarginContainer.new()
	inner.add_theme_constant_override("margin_left", 14)
	var rows := VBoxContainer.new()
	inner.add_child(rows)
	wrap.add_child(inner)
	tick.toggled.connect(func(on: bool):
		inner.visible = on
		if not _refreshing:
			_change(key, on))
	for d in f[2]:
		_row(rows, d)
	if key in Tuning.NOT_IN_GODOT:
		tick.tooltip_text = Tuning.NOT_YET
	_features.append({"key": key, "feature": f[0], "wrap": wrap, "check": tick, "inner": inner})


## The paint of the body (the material carpaint) and of the rims (rimpaint), as the tuning menu of the game has it.
func _paint(parent: VBoxContainer) -> void:
	var fold := EditorStyle.fold(parent, "Paint (the materials carpaint and rimpaint)")
	for part in PAINT:
		var label := "body" if part == "body" else "rims"
		var line := HBoxContainer.new()
		var l := EditorStyle.label("Colour of the " + label, 12, EditorStyle.MUTED)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_child(l)
		var pick := ColorPickerButton.new()
		pick.custom_minimum_size = Vector2(52, 26)
		pick.edit_alpha = false
		pick.focus_mode = Control.FOCUS_NONE
		pick.color_changed.connect(func(c: Color):
			if not _refreshing:
				_change(part + "_color", "#" + c.to_html(false)))
		line.add_child(pick)
		var reset := EditorStyle.button("↺", "small ghost", "The colour of the model")
		reset.pressed.connect(func(): _change(part + "_color", ""))
		line.add_child(reset)
		fold.add_child(line)
		_rows.append({"key": part + "_color", "kind": "color", "pick": pick, "item": line, "label": l, "text": l.text})
		for k in ["_finish", "_pattern", "_uv"]:
			var key: String = part + k
			var base_key: String = "body" + k
			var d := [key, {"_finish": "Finish of the ", "_pattern": "Flake pattern of the ", "_uv": "Flake map of the "}[k] + label, "", 0, 0, 0]
			_row_select(fold, d, Tuning.SELECTS[base_key])
		_row(fold, [part + "_flake", "Flake size of the %s (metal flake)" % label, "%", 2, 400, 1])


func _row_select(parent: Control, d: Array, items: Array) -> void:
	var key: String = d[0]
	var line := HBoxContainer.new()
	var l := EditorStyle.label(str(d[1]), 12, EditorStyle.MUTED)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	line.add_child(l)
	var pick := EditorStyle.options(items)
	pick.custom_minimum_size.x = 170
	pick.size_flags_horizontal = Control.SIZE_FILL
	pick.item_selected.connect(func(_i: int):
		if not _refreshing:
			_change(key, EditorStyle.value_of(pick)))
	line.add_child(pick)
	parent.add_child(line)
	_rows.append({"key": key, "kind": "select", "pick": pick, "item": line, "label": l, "text": str(d[1])})


func _change(key: String, value: Variant) -> void:
	Tuning.set_value(ed.cfg, key, value, _cam())
	if key in CarEditorTyreNodes.KEYS:
		ed.bench.tyre_nodes.show(true)          # (the nodes of the tyres while a tyre setting is changed)
	if key in TYRE_KEYS:
		ed.io.rebuild_library()
		ed.form.sync_tyre_field()
		ed.update_helpers()
	if key.ends_with("_color") or key.ends_with("_finish"):
		ed.mats.apply_paint()
	if key.begins_with("es_"):
		ed.engine.sound_changed()
	if key in ["idle_rpm", "limiter_rpm", "turbo_share", "final_drive"]:
		ed.engine.update_speed_info()
	ed.refresh_fields()
	refresh()
	ed.changed()


## Every row shows the car; a setting that cannot do anything with the others is hidden (Tuning.visible).
func refresh() -> void:
	_refreshing = true
	var v := Tuning.values_of(ed.cfg, _cam())
	for r in _rows:
		if not is_instance_valid(r["item"]):
			continue
		var key: String = r["key"]
		var value: Variant = v.get(key)
		(r["item"] as Control).visible = Tuning.visible(key, v)
		match r["kind"]:
			"slider":
				var x := float(value) if (value is float or value is int) else float((r["slider"] as HSlider).min_value)
				(r["slider"] as HSlider).set_value_no_signal(x)
				if not (r["num"] as EditorStyle.NumberField).edit.has_focus():
					(r["num"] as EditorStyle.NumberField).set_value(x)
				var changed: bool = base.has(key) and (base[key] is float or base[key] is int) and absf(float(base[key]) - x) > 1e-9
				(r["label"] as Label).add_theme_color_override("font_color", EditorStyle.ACCENT2 if changed else EditorStyle.MUTED)
				(r["reset"] as Button).modulate.a = 1.0 if changed else 0.0
				var note := Tuning.row_note(key, v)
				if note != "":
					(r["label"] as Label).text = str(r["text"]) + " · " + note
			"select":
				EditorStyle.select_value(r["pick"], value if value != null else "")
			"tick":
				(r["check"] as CheckBox).set_pressed_no_signal(value == "on")
			"color":
				(r["pick"] as ColorPickerButton).color = Color(str(value)) if value is String and str(value) != "" else Color(0.53, 0.53, 0.53)
	for f in _features:
		var on: bool = v.get(f["key"], true) != false
		(f["check"] as CheckBox).set_pressed_no_signal(on)
		(f["inner"] as Control).visible = on
		(f["wrap"] as Control).visible = Tuning.visible_feature(f["feature"], v)
	_refreshing = false
	for fold: VBoxContainer in _folds:
		if not is_instance_valid(fold):
			continue
		var any := false
		for c in fold.get_children():
			any = any or (c as Control).visible
		(fold.get_parent().get_parent() as Control).visible = any
	_preview_tyres()


## The tyres of the model in the view, as in the game (CarTyres).
func _preview_tyres() -> void:
	if ed.model_root == null or ed.wheel_mode() != "model":
		return
	if _tyres_root != ed.model_root:
		_tyres_root = ed.model_root
		_tyres = load("res://scripts/car_tyres.gd").new()
		_tyres.collect(ed.model_root)
		for slot: String in CarEditor.SLOTS:
			_tyres.add_wheel(slot, ed.wheel_part_nodes(slot), ed.model_root, ed.num("chassis.tire_diameter", 0.65) / 2.0)
	_tyres.apply(ed.cfg)


## What kind of tyre a rubber is (rubberLabel of Wheel.js): the nearest of the kinds.
static func _rubber_label(x: float) -> String:
	var names := {"eco": "eco", "road": "road", "sport": "sport", "semislick": "semi-slick", "slick": "race slick", "drag": "drag slick"}
	var best := "road"
	var d := INF
	for s in TyreCompounds.RUBBER_STOPS:
		if absf(float(s[1]) - x) < d:
			d = absf(float(s[1]) - x)
			best = s[0]
	return names.get(best, best)


## What pattern a tread is (Wheel.js treadPattern, treadLabel): knobbly, all-terrain, or a road tyre or a slick by its rubber.
static func tread_label(tread: float, rubber: float) -> String:
	var at := clampf(tread, 0.0, 100.0)
	if at >= 75.0:
		return "Knobbly"
	if at >= 25.0:
		return "All-terrain"
	return "Slick" if rubber >= 75.0 else "Road"


func sync_visibility() -> void:
	refresh()


## The car into the cards: its values are the base of ↺, the setups of the car are listed.
func fill() -> void:
	base = Tuning.values_of(ed.cfg, _cam())
	render_groups()
	render_setups()
