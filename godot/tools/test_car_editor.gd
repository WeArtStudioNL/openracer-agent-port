extends Node
## (a scene, for the autoloads: Godot --headless --path godot res://tools/test_car_editor.tscn -- --out=/tmp/folder)
## Tests the car editor: opens a car of the game, changes fields as a user types them, adds an exhaust point and saves
## it under a new id into a temporary folder (never the garage of the player, never web/); checks the car.json that is
## written (the keys and the format of the browser editor, what was changed); then makes a new car from a glb and saves
## it too. The game drives a saved car with --set=garage_folder:"<out>" (see the README). --keep keeps the files.

var out := ""
var failures := 0


func _ready() -> void:
	get_tree().create_timer(240.0).timeout.connect(func():
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
		# the nodes of the shell tyres over it while a tyre setting is changed (CarEditorTyreNodes)
		ed.bench.tyre_nodes.show(true)
		await get_tree().process_frame
		await get_tree().process_frame
		var drawn: MeshInstance3D = ed.bench.tyre_nodes._lines
		check(bc.shell_tyres == null or (drawn != null and drawn.mesh.get_surface_count() > 0), "the nodes of the tyres are drawn (%s)" % [
			"no shell tyres" if bc.shell_tyres == null else "%d lines" % (drawn.mesh.surface_get_array_len(0) / 2 if drawn != null else 0)])
		ed.bench.tyre_nodes.show(false)
	ed.bench.stop()
	check(ed.bench.car == null and ed.view.pivot.visible, "↺: back to the model")
	print("1c. the Full test of the bench")
	ed.bench.full_test()
	var seen := {}
	var top_rpm := 0.0
	var moved := {}
	var steer := [0.0, 0.0]
	var hit_kmh := -1.0
	var waited := 0.0
	while not ed.bench.test_run.is_empty() and waited < 90.0:
		await get_tree().process_frame
		waited += get_process_delta_time()
		var run := ed.bench.test_run
		if run.is_empty() or ed.bench.car == null:
			break
		var stage: String = run["stage"]
		seen[stage] = true
		if stage == "rev":
			top_rpm = maxf(top_rpm, ed.bench.car.engine.rpm())
		if stage in ["forward", "back"] and run.has("start_z"):
			moved[stage] = absf(ed.bench.car.global_position.z - float(run["start_z"]))
		steer = [float(run.get("min_steer", 0.0)), float(run.get("max_steer", 0.0))]
		if run.get("hit", false) and hit_kmh < 0.0:
			hit_kmh = absf(float(run.get("hit_speed", 0.0))) * 3.6
	check(seen.has("rev") and seen.has("forward") and seen.has("back") and seen.has("steer") and seen.has("wall"), "every stage ran (%s)" % ", ".join(seen.keys()))
	var lim := float(Tuning.read(ed.cfg, "engine.limiter_rpm") if Tuning.read(ed.cfg, "engine.limiter_rpm") != null else 6000.0)
	check(top_rpm > lim - 400.0, "the engine went to the rev limiter in neutral (%d of %d rpm)" % [roundi(top_rpm), roundi(lim)])
	check(absf(float(moved.get("forward", 0.0)) - 1.0) < 0.4 and absf(float(moved.get("back", 0.0)) - 1.0) < 0.4,
		"a metre forwards and a metre back (%.2f, %.2f m)" % [moved.get("forward", 0.0), moved.get("back", 0.0)])
	check(steer[0] < -0.3 and steer[1] > 0.3, "the steering to both locks (%.0f°, %.0f°)" % [rad_to_deg(steer[0]), rad_to_deg(steer[1])])
	check(hit_kmh > 40.0, "full throttle into the wall (%d km/h)" % roundi(hit_kmh))
	check(ed.bench.car == null and ed.bench.test_run.is_empty(), "the full test ends by itself, back at the model")
	print("1d. the flame test of the exhaust points")
	ed.layers.set_flame_test(true)
	ed.layers.flames_frame(10.0)
	var lit := 0
	for m in ed.layers._flames.get_children():
		lit += 1 if (m as Node3D).visible else 0
	check(lit > 0 and ed.layers._flames.root == ed.view.extras, "a bang makes flames at the exhaust point (%d)" % lit)
	ed.layers.set_flame_test(false)
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
	# the gizmo: the arrow of z of the new exhaust point dragged 60 pixels
	await get_tree().process_frame
	var cam := ed.view.camera
	var g := ed.view.gizmo
	g.update_view(cam)
	var o: Vector3 = (e["target"] as Node3D).global_position
	var before_z := o.z
	var tip := cam.unproject_position(o + Vector3.BACK * g._scale_for(cam) * 0.7)
	var grabbed := g.grab(cam, tip)
	var along := (cam.unproject_position(o + Vector3.BACK) - cam.unproject_position(o)).normalized()
	g.drag(cam, tip + along * 60.0)
	g.release()
	ed.layers.gizmo_moved()
	check(grabbed and (e["target"] as Node3D).global_position.z > before_z + 0.05 and absf((e["target"] as Node3D).global_position.x - o.x) < 1e-4,
		"the gizmo moves the exhaust point along z (%.3f → %.3f)" % [before_z, (e["target"] as Node3D).global_position.z])
	# undo: a step back and forth
	ed._remember()
	var mass_now := ed.num("chassis.mass")
	_type(ed, "chassis.mass", "999")
	ed._remember()
	ed.undo()
	check(ed.num("chassis.mass") == mass_now, "Ctrl+Z puts the mass back (%s)" % ed.num("chassis.mass"))
	ed.undo(true)
	check(ed.num("chassis.mass") == 999.0, "Shift+Ctrl+Z again (%s)" % ed.num("chassis.mass"))
	_type(ed, "chassis.mass", "1310")
	check(ed.dirty, "the car is marked changed")
	check(ed.car_id == "zz-editor-test", "the id is zz-editor-test")
	var bad := ed.build_config("zz-editor-test")
	check(not bad.has("_error"), "the form makes a car.json (%s)" % bad.get("_error", "no error"))
	ed.car_id = "Bad Id!"
	check(RegEx.create_from_string(CarEditor.ID_PATTERN).search(ed.car_id) == null, "an id with capitals and ! is refused by the id pattern")
	ed.car_id = "zz-editor-test"
	print("3. save it into the test folder")
	# the warnings about the numbers, over the cards: the button of one cures it, in the form too
	var travel_was: Variant = Tuning.read(ed.cfg, "chassis.suspension_travel")
	var length_was: Variant = Tuning.read(ed.cfg, "chassis.suspension_length")
	Tuning.write(ed.cfg, "chassis.suspension_travel", 0.6)
	Tuning.write(ed.cfg, "chassis.suspension_length", 0.3)
	ed.update_summary()
	var warned: Button = null
	for line in ed.checks_box.get_children():
		if (line.get_child(0) as Label).text.contains("travel"):
			warned = line.get_child(1) as Button
	check(warned != null, "too much travel for the room of the spring: a warning with a button")
	if warned != null:
		warned.pressed.emit()
		check(is_equal_approx(float(Tuning.read(ed.cfg, "chassis.suspension_length")), 0.65), "the button gives the spring the room")
	Tuning.write(ed.cfg, "chassis.suspension_travel", travel_was)
	Tuning.write(ed.cfg, "chassis.suspension_length", length_was)
	ed.update_summary()
	await get_tree().process_frame
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
	print("3b. a tune shipped with the car, and taken off again (the tunes of the test folder)")
	Tuning.tunes_root = out.path_join("tunes")
	Settings._overrides["garage_folder"] = out
	var tune_cfg := ed.build_config("zz-editor-test")
	tune_cfg.erase("model")
	Tuning.save_tune("zz-editor-test", "Test tune", tune_cfg)
	ed.tuning.render_setups()
	EditorStyle.select_value(ed.tuning._setup_pick, "Test tune")
	check(ed.tuning.chosen_tune() == "Test tune" and ed.tuning.shipped_state("Test tune") == "", "a tune of the player is chosen")
	await ed.tuning.ship_pressed()
	var shipped: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("car.json")))
	check(FileAccess.file_exists(dir.path_join("test-tune.openracer-tune.json")) and shipped is Dictionary and shipped.get("tunes") == ["test-tune.openracer-tune.json"],
		"Ship with the car: the file next to car.json and in its tunes (%s)" % (shipped.get("tunes") if shipped is Dictionary else "?"))
	check(ed.tuning.shipped_state("Test tune") == "car" and not FileAccess.file_exists(Tuning.tunes_dir("zz-editor-test").path_join("test-tune.openracer-tune.json")),
		"it comes with the car now, the copy of the player is gone")
	var t_file: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("test-tune.openracer-tune.json")))
	check(t_file is Dictionary and t_file.get("openracer-tune") == 1.0 and not (t_file["config"] as Dictionary).has("model"), "the file is a tune file without the model")
	check(ed.tuning._ship.visible and ed.tuning._ship.text == "Take off the car", "the button says Take off the car")
	_confirm_soon(ed)
	await ed.tuning.ship_pressed()
	shipped = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("car.json")))
	check(not FileAccess.file_exists(dir.path_join("test-tune.openracer-tune.json")) and shipped is Dictionary and not shipped.has("tunes"),
		"Take off the car: the file and the list are gone")
	Settings._overrides.erase("garage_folder")
	Tuning.tunes_root = "user://tunes"
	print("3c. the window of Save and test: the track and the conditions")
	var dlg := ed.open_test_dialog()
	await get_tree().process_frame
	var labels := []
	for b in dlg.find_children("*", "Button", true, false):
		labels.append((b as Button).text)
	check(labels.has("Rain") and labels.has("Dusk") and labels.has("Wet") and labels.has("Follows the weather"),
		"the weather, the time of day and the ground to choose")
	check(labels.any(func(t: String) -> bool: return t.begins_with("Use last settings: ")), "and Use last settings")
	dlg.hide()
	EditorStyle.select_value(ed.tuning._setup_pick, "")
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


## Presses OK of the question that the editor asks next.
func _confirm_soon(ed: Node) -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	for d in ed.get_children():
		if d is ConfirmationDialog and (d as ConfirmationDialog).visible:
			(d as ConfirmationDialog).get_ok_button().pressed.emit()


func _remove(path: String) -> void:
	for f in DirAccess.get_files_at(path):
		DirAccess.remove_absolute(path.path_join(f))
	for d in DirAccess.get_directories_at(path):
		_remove(path.path_join(d))
	DirAccess.remove_absolute(path)
