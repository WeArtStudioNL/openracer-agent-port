extends Node
## (a scene, for the autoloads: Godot --headless --path godot res://tools/test_car_editor.tscn -- --out=/tmp/folder)
## Tests the car editor: opens a car of the game, changes fields as a user types them, adds an exhaust point and saves
## it under a new id into a temporary folder (never the garage of the player, never web/); checks the car.json that is
## written (the keys and the format of the browser editor, what was changed); then makes a new car from a glb and saves
## it too. The game drives a saved car with --set=garage_folder:"<out>" (see the README). --keep keeps the files.

var out := ""
var failures := 0


func _ready() -> void:
	get_tree().create_timer(120.0).timeout.connect(func():
		print("TIMEOUT")
		get_tree().quit(2))
	out = Content.arg("out")
	if out == "":
		out = OS.get_temp_dir().path_join("oracer-car-editor-test")
	DirAccess.make_dir_recursive_absolute(out.path_join("cars"))
	print("saving into ", out)
	await _run()
	print("RESULT: %s (%d failures)" % ["ok" if failures == 0 else "FAILED", failures])
	if Content.arg("keep") == "":
		_remove(out)
	get_tree().quit(1 if failures > 0 else 0)


func check(ok: bool, what: String) -> void:
	print(("  ok    " if ok else "  FAIL  ") + what)
	if not ok:
		failures += 1


func _type(ed: CarEditor, path: String, text: String) -> void:
	var f: Variant = ed.field_for(path)
	if f is EditorStyle.NumberField:
		(f as EditorStyle.NumberField).edit.text = text
		(f as EditorStyle.NumberField).edit.text_changed.emit(text)
		(f as EditorStyle.NumberField).committed.emit(float(text))
	elif f is LineEdit:
		(f as LineEdit).text = text
		(f as LineEdit).text_changed.emit(text)


func _run() -> void:
	var ed := CarEditor.new()
	ed.save_root_override = out.path_join("cars")
	add_child(ed)
	await get_tree().process_frame
	print("1. open the hatchback of the game")
	ed.load_existing("hatchback")
	await get_tree().process_frame
	check(ed.model_root != null, "the model is loaded (%d named parts)" % ed.nodes.size())
	check(ed.num("chassis.mass") == 1270.0, "the mass is in the form (%s)" % ed.num("chassis.mass"))
	check(ed.form._id_edit.text == "hatchback", "the id is in the form")
	check(ed.engine._has_build(), "the engine block is there (%s)" % Tuning.read(ed.cfg, "engine.build.block"))
	check(ed.problems().is_empty(), "nothing is missing (%s)" % ", ".join(ed.problems()))
	check(ed.layers.exhaust.size() == 1, "the exhaust point is there")
	print("1b. drop it on the bench (the physics of the game)")
	ed.bench.drop(1.0, 5.0)
	check(ed.bench.car != null and not ed.view.pivot.visible, "the car of the bench is made, the model is hidden")
	await get_tree().create_timer(3.0).timeout
	if ed.bench.car != null:
		var bc := ed.bench.car
		var touching := 0
		for w in bc.wheels:
			touching += 1 if w.contact else 0
		check(touching == 4 and bc.linear_velocity.length() < 0.3, "it stands on its four wheels (%d, %.2f m/s)" % [touching, bc.linear_velocity.length()])
		check(absf(bc.global_position.y - ed.view.grid.position.y - ed.num("chassis.tire_diameter") / 2.0) < 0.25,
			"at the height of its axles (%.2f m)" % bc.global_position.y)
	ed.bench.stop()
	check(ed.bench.car == null and ed.view.pivot.visible, "↺: back to the model")
	print("2. change it as a user does")
	_type(ed, "name", "Hatchback editor test")
	ed.form._id_edit.text = "zz-editor-test"
	ed.form._id_edit.text_changed.emit("zz-editor-test")
	_type(ed, "chassis.mass", "1310")
	_type(ed, "chassis.weight_distribution", "58")
	_type(ed, "drivetrain.final_drive", "4.1")
	_type(ed, "cameras.follow.distance", "7.2")
	ed.form._gears.text = "3.2, 1.9, 1.3, 0.95, 0.75"
	ed.form._gears.text_changed.emit(ed.form._gears.text)
	ed.tuning._change("grip", 105.0)
	EditorStyle.select_value(ed.engine._block, "Inline-4 2.0 L")
	ed.engine._block_chosen()
	var e := ed.layers.new_exhaust()
	ed.layers.select(e["id"])
	(e["target"] as Node3D).position += Vector3(0.1, 0, 0)
	ed.layers.gizmo_moved()
	check(ed.dirty, "the car is marked changed")
	check(ed.car_id == "zz-editor-test", "the id is zz-editor-test")
	var bad := ed.build_config("zz-editor-test")
	check(not bad.has("_error"), "the form makes a car.json (%s)" % bad.get("_error", "no error"))
	ed.car_id = "Bad Id!"
	check(RegEx.create_from_string(CarEditor.ID_PATTERN).search(ed.car_id) == null, "an id with capitals and ! is refused by the id pattern")
	ed.car_id = "zz-editor-test"
	print("3. save it into the test folder")
	var saved: bool = await ed.save()
	check(saved, "saved")
	var dir := out.path_join("cars/zz-editor-test")
	check(FileAccess.file_exists(dir.path_join("car.json")), "car.json written")
	check(FileAccess.file_exists(dir.path_join("hatchback.glb")), "the model is copied along (a new id)")
	check(FileAccess.file_exists(dir.path_join("driver.glb")), "the driver is copied along")
	var text := FileAccess.get_file_as_string(dir.path_join("car.json"))
	var c: Variant = JSON.parse_string(text)
	check(c is Dictionary, "car.json is JSON")
	if not c is Dictionary:
		return
	var original: Dictionary = Content.load_json("cars/hatchback/car.json")
	var keys := (c as Dictionary).keys()
	check(keys[0] == "name" and keys[1] == "description" and keys[2] == "model", "the keys in the order of the browser (%s)" % ", ".join(keys.slice(0, 6)))
	for k in original:
		if k == "tunes":
			continue
		check(c.has(k), "has \"%s\" as the car of the game" % k)
	check(not text.contains("1310.0") and text.contains("\"mass\": 1310"), "whole numbers without a fraction, as the browser writes them")
	check(text.begins_with("{\n  \"name\": \"Hatchback editor test\""), "indented by two, as JSON.stringify(c, null, 2)")
	check(c["model"]["file"] == "cars/zz-editor-test/hatchback.glb", "model.file is cars/<id>/<file> (%s)" % c["model"]["file"])
	check(c["model"]["offset"] is Array and c["model"].has("rotation_y") and c["model"].has("scale"), "the transform of the model")
	check(float(c["chassis"]["mass"]) == 1310.0 and absf(float(c["chassis"]["weight_distribution"]) - 0.58) < 1e-9, "mass and weight (%s, %s)" % [c["chassis"]["mass"],
		c["chassis"]["weight_distribution"]])
	check(float(c["drivetrain"]["final_drive"]) == 4.1 and (c["drivetrain"]["gear_ratios"] as Array).size() == 5, "final drive and gears")
	check(float(c["cameras"]["follow"]["distance"]) == 7.2, "the follow camera")
	check(absf(float(c["tyres"]["grip"]) - 1.05) < 1e-9, "a setting of the tuning groups (grip 105 %%: %s)" % c["tyres"]["grip"])
	check(c["engine"]["build"]["block"] == "Inline-4 2.0 L" and (c["engine"]["torque_curve"] as Array).size() > 10, "the engine block and its curve")
	check(c["sound"]["engine_sim"]["layout"] == "inline-4", "the sound follows the block")
	check((c["exhaust"] as Array).size() == 2 and (c["exhaust"][1] as Dictionary).has("flame_length_cm"), "two exhaust points with their settings")
	check(c["wheels"]["mode"] == original["wheels"]["mode"] and c["wheels"].has("library"), "the wheels and the rims of the library")
	check(c.has("softbody") and c.has("parts") and c.has("driver"), "the soft body, the parts and the driver are kept")
	check(c["driver"]["file"] == "cars/zz-editor-test/driver.glb", "the driver file follows the id")
	check(not c.has("id") and not c.has("tunes"), "no id, and the tunes stay with the car they came with")
	print("4. a new car from a glb (the kart of the game)")
	ed.new_car("car")
	ed.load_model_files(PackedStringArray([Content.root.path_join("cars/openracer-kart/Kart.glb")]))
	await get_tree().process_frame
	check(ed.model_root != null, "the glb is loaded (%d named parts)" % ed.nodes.size())
	check(str(ed.cfg.get("name", "")) == "Kart" and ed.car_id == "kart", "the name and the id from the file (%s, %s)" % [ed.cfg.get("name"), ed.car_id])
	check(ed.num("dimensions.length") > 0.5, "the size from the model (%s m long)" % ed.num("dimensions.length"))
	var found := 0
	for s in CarEditor.SLOTS:
		if not (ed.wheel_parts[s] as Array).is_empty():
			found += 1
	check(found == 4 and ed.wheel_parts["FL"] == ["wheel_FL"], "the wheels found by their names (%s)" % ed.wheel_parts)
	check(absf(ed.num("chassis.wheelbase") - 1.096) < 0.01, "the wheelbase from the wheels (%s m)" % ed.num("chassis.wheelbase"))
	EditorStyle.select_value(ed.engine._block, "Single 0.25 L (kart)")
	ed.engine._block_chosen()
	ed.car_id = "zz-editor-new"
	ed.id_edited = true
	var saved2: bool = await ed.save()
	check(saved2, "the new car is saved")
	var c2: Variant = JSON.parse_string(FileAccess.get_file_as_string(out.path_join("cars/zz-editor-new/car.json")))
	check(c2 is Dictionary and c2["model"]["file"] == "cars/zz-editor-new/Kart.glb", "its model file")
	check(FileAccess.file_exists(out.path_join("cars/zz-editor-new/Kart.glb")), "the glb is copied into its folder")
	print("     wheels of the new car: mode %s, %d of 4 with parts" % [c2["wheels"]["mode"] if c2 is Dictionary else "?", found])
	print("5. open the saved car again (the garage folder of the test)")
	ed.queue_free()


func _remove(path: String) -> void:
	for f in DirAccess.get_files_at(path):
		DirAccess.remove_absolute(path.path_join(f))
	for d in DirAccess.get_directories_at(path):
		_remove(path.path_join(d))
	DirAccess.remove_absolute(path)
