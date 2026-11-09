extends Node
## (a scene, for the autoloads) The tuning menu as the browser's (Tuning.js): the Engine card (a block, the curve, the
## mass, Run dyno), the follow camera's look-ahead, field of view with speed and dolly, a rim of the wheel library that
## builds the car again at once, Export… and Import… of a tune file, Save on Default (car.json) and Export to vehicle.
## The car is a copy of the hatchback in the garage of the user folder, so nothing is written in web/: the test refuses
## to run with the player's own user folder (give it another HOME).
##   HOME=/tmp/x Godot --headless --fixed-fps 60 --path godot res://tools/test_tuning_menu.tscn -- --user-dir=/tmp/x/u [--shot=file.png]

var world: World
var _fails := 0


func _check(ok: bool, what: String) -> void:
	print(("ok    " if ok else "FAIL  ") + what)
	if not ok:
		_fails += 1


func _ready() -> void:
	var ud := OS.get_user_data_dir()
	if Content.arg("user-dir") == "" or not (ud.contains("/tmp/") or ud.contains("/private/") or ud.contains("/var/folders/")):
		push_error("test_tuning_menu: run it with HOME in a temporary folder and --user-dir (it writes a garage car): %s" % ud)
		get_tree().quit(2)
		return
	# the hatchback in the garage (car.json and its shipped tune: the rest comes from web/)
	var web_json := Content.root.path_join("cars/hatchback/car.json")
	var dir := ProjectSettings.globalize_path(Garage.DIR).path_join("cars/hatchback")
	DirAccess.make_dir_recursive_absolute(dir)
	DirAccess.copy_absolute(web_json, dir.path_join("car.json"))
	DirAccess.copy_absolute(Content.root.path_join("cars/hatchback/race.openracer-tune.json"), dir.path_join("race.openracer-tune.json"))
	set_meta("web_md5", FileAccess.get_md5(web_json))
	var tunes: Dictionary = Settings.get_value("tunes").duplicate()
	tunes.erase("hatchback")
	Settings.set_value("tunes", tunes)
	world = World.new()
	add_child(world)
	world.setup("hatchback", "testtrack", {"ghost": false, "records": false})
	_run.call_deferred()


func _wait(seconds: float) -> void:
	for i in roundi(seconds * Engine.physics_ticks_per_second):
		await get_tree().physics_frame


func _run() -> void:
	await _wait(1.5)
	var car := world.car
	world.open_tuning()
	var menu: TuningMenu = world.tuning_layer.get_child(0)
	# the warnings about the numbers: more travel than the spring has room for shows under the row and over the menu, its button cures it
	var was_travel: Variant = menu.values.get("suspension_travel")
	var was_length: Variant = menu.values.get("suspension_length")
	_check(menu._checks.get_child_count() == 0, "no warning for the hatchback as made")
	menu._change("suspension_travel", 60.0)
	_check(menu._checks.get_child_count() == 1 and menu._checks.visible, "a travel the spring has no room for is warned about")
	var warned: Button = null
	for n in menu._checks.get_child(0).get_children():
		if n is Button:
			warned = n
	var row_note := ""
	for c in menu._controls:
		if c["key"] == "suspension_travel":
			var note: Label = c["item"].get_node_or_null("CheckNote")
			row_note = note.text if note != null else ""
	_check(row_note.contains("can be used"), "the row of the travel says so too")
	_check(warned != null, "the warning has a button")
	if warned != null:
		warned.pressed.emit()
		_check(is_equal_approx(float(car.config["chassis"]["suspension_length"]), 0.65), "the button gives the spring the room")
		await get_tree().process_frame
		_check(menu._checks.get_child_count() == 0, "and the warning is gone")
	menu._change("suspension_travel", was_travel)
	menu._change("suspension_length", was_length)
	await get_tree().process_frame
	# ---- the rings and the nodes of a custom tyre (the hatchback has one of one ring)
	_check(Tuning.visible("tyre_rings", menu.values) and Tuning.visible("tyre_segments", menu.values), "a custom tyre shows its rings and nodes")
	var rings_was: Variant = menu.values.get("tyre_rings")
	menu._change("tyre_rings", 3.0)
	_check(float(Tuning.read(car.config, "wheels.library.front.custom.rings")) == 3.0 and float(Tuning.read(car.config, "wheels.library.rear.custom.rings")) == 3.0,
		"the rings go to the tyre on both axles")
	_check(float(menu.values.get("tyre_rings")) == 3.0, "the row shows the rings of the tyre")
	await _wait(0.8)
	car = world.car
	menu = world.tuning_layer.get_child(0)
	_check(int(car.shell_tyres.shell_of(car.wheels[0])["rings"]) == 3, "the shell has them")
	menu._change("tyre_rings", rings_was)
	await _wait(0.8)
	car = world.car
	menu = world.tuning_layer.get_child(0)
	# ---- the wheels: from the model or dynamic, in the menu, and the tyres can be changed with both
	var mode_was := str(menu.values.get("wheels_mode", "default"))
	var nodes_was: Variant = Tuning.read(car.config, "wheels.nodes")
	var four := {"FL": ["wheel_FL"], "FR": ["wheel_FR"], "RL": ["wheel_RL"], "RR": ["wheel_RR"]}
	var with_parts: Dictionary = car.config.duplicate(true)
	Tuning.write(with_parts, "wheels.nodes", four)
	menu._apply(with_parts, "wheels of the model")
	_check(Tuning.visible("wheels_mode", menu.values), "the menu offers dynamic wheels or wheels from the model")
	for mode in ["default", "model"]:
		menu._change("wheels_mode", mode)
		await _wait(0.8)
		car = world.car
		menu = world.tuning_layer.get_child(0)
		_check(str(Tuning.read(car.config, "wheels.mode")) == mode, "wheels: " + mode)
		_check(Tuning.visible("tread_front", menu.values) and Tuning.visible("rubber_front", menu.values), "the tyre can be changed with wheels: " + mode)
		menu._change("tread_front", 60.0)
		_check(str(Tuning.read(car.config, "wheels.library.front.tyre")) == "custom" and float(Tuning.read(car.config, "wheels.library.front.custom.tread")) == 60.0,
			"a tread with wheels %s makes it a tyre of its own" % mode)
		var clean: Dictionary = car.config.duplicate(true)
		Tuning.erase(clean, "wheels.library.front.tyre")
		Tuning.erase(clean, "wheels.library.front.custom")
		menu._apply(clean, "tyre as it was")
		await _wait(0.8)
		car = world.car
		menu = world.tuning_layer.get_child(0)
	menu._change("wheels_mode", mode_was)
	var back: Dictionary = car.config.duplicate(true)
	if nodes_was == null:
		Tuning.erase(back, "wheels.nodes")
	else:
		Tuning.write(back, "wheels.nodes", nodes_was)
	menu._apply(back, "the wheels as they were")
	await _wait(0.8)
	car = world.car
	menu = world.tuning_layer.get_child(0)
	# ---- the Engine card
	var eng: TuningEngine = menu._engine
	_check(eng != null, "the Engine card has the engine build")
	var block_was := str(Tuning.read(car.config, "engine.build.block"))
	var mass_was := float(Tuning.read(car.config, "chassis.mass"))
	var peak_was := float(Tuning.peak_of(car.config)["hp"])
	eng._block_chosen("V8 5.7 L crossplane")
	var peak := float(Tuning.peak_of(car.config)["hp"])
	var mass := float(Tuning.read(car.config, "chassis.mass"))
	_check(str(Tuning.read(car.config, "engine.build.block")) == "V8 5.7 L crossplane" and peak > peak_was * 2.0,
		"a V8 for the %s: %d hp (was %d)" % [block_was, roundi(peak), roundi(peak_was)])
	_check(mass > mass_was + 100.0, "the car is heavier by the engine: %d kg (was %d)" % [roundi(mass), roundi(mass_was)])
	_check(absf(car.engine.peak_torque - float(Tuning.peak_of(car.config)["nm"])) < 1.0 or car.engine.peak_torque > 300.0,
		"the car drives with it: peak torque %d Nm" % roundi(car.engine.peak_torque))
	(eng._fields["bore"][1] as SpinBox).value = 104.0
	var bore := float(Tuning.read(car.config, "engine.build.bore"))
	_check(bore > 100.0 and float(Tuning.peak_of(car.config)["hp"]) > peak, "a bigger bore (%.1f mm): more power, %d hp" % [bore, roundi(Tuning.peak_of(car.config)["hp"])])
	eng.run_dyno()
	await get_tree().create_timer(5.0, true).timeout
	_check(eng._dyno.has("done") and eng._dyno_info.text.begins_with("At the wheels"), "Run dyno: %s" % eng._dyno_info.text)
	# ---- the follow camera
	menu._change("cam_follow_look_z", 2.0)
	menu._change("cam_follow_dolly", 0.5)
	menu._change("cam_follow_fov_full_speed", 40.0)
	var cam: ChaseCamera = world.camera
	_check(cam.look_z == 2.0 and cam.dolly == 0.5 and cam.fov_full_speed == 40.0,
		"the follow camera takes the look-ahead %.1f m, the dolly %.2f and the full fov from %.0f" % [cam.look_z, cam.dolly, cam.fov_full_speed])
	_check(not menu._controls.any(func(c): return c["key"] == "cam_follow_dolly" and (c["item"] as Control).modulate.a < 0.9), "its rows are not grey")
	# ---- a rim of the wheel library: the car is built again at once
	var model_was := car.model_root
	var rim := ""
	for o in menu._options("rim_front"):
		if str(o[0]) != "" and str(o[0]) != str(menu.values.get("rim_front")):
			rim = str(o[0])
	menu._change("rim_front", rim)
	await get_tree().create_timer(1.0, true).timeout
	_check(car.model_root != model_was and is_instance_valid(car.model_root) and car.wheels[0].spin_node != null and car.wheels[0].spin_node.get_child_count() > 0,
		"the rim %s: the car is built again (%s)" % [rim, menu._message.text])
	await _wait(1.0)
	_check(car.global_position.y > -1.0 and car.wheels.all(func(w): return w.hub_node != null and w.hub_node.is_inside_tree()), "it still stands on its wheels")
	# ---- Export… and Import…
	var tmp := Settings.path("tune-export.openracer-tune.json")
	_check(menu.export_to(tmp) and FileAccess.file_exists(tmp), "Export…: %s" % menu._message.text)
	var t := TuningFiles.parse_file(tmp)
	_check(not t.has("error") and str(Tuning.read(t["config"], "engine.build.block")) == "V8 5.7 L crossplane", "the file is a tune: %s" % t.get("name", t.get("error")))
	menu.import_tune(t, "zz imported")
	_check(menu._active_name() == "zz imported", "Import…: chosen as a setup (%s)" % menu._message.text)
	var bad := Settings.path("not-a-tune.json")
	var f := FileAccess.open(bad, FileAccess.WRITE)
	f.store_string("{\"x\": 1}")
	f.close()
	_check(TuningFiles.parse_file(bad).has("error"), "a file that is not a tune is refused")
	var other := TuningFiles.imported({"car": "go-kart-250cc", "config": {"chassis": {"mass": 150, "wheelbase": 1.0, "spring_front": 9000}, "type": "motorcycle"}},
		"hatchback", menu.base)
	_check(float(Tuning.read(other, "chassis.mass")) == float(Tuning.read(menu.base, "chassis.mass")) and str(other.get("type", "car")) != "motorcycle"
		and float(Tuning.read(other, "chassis.spring_front")) == 9000.0, "a tune of another car: its tuning only, on this car's model")
	# ---- Save on Default: car.json of the garage
	menu._switch("")
	eng._block_chosen("Inline-4 2.0 L")
	_check(menu.save_default_now(), "Save on Default: %s" % menu._message.text)
	var garage_json: Variant = JSON.parse_string(FileAccess.get_file_as_string(TuningFiles.car_dir("hatchback").path_join("car.json")))
	_check(garage_json is Dictionary and str(Tuning.read(garage_json, "engine.build.block")) == "Inline-4 2.0 L" and not (garage_json as Dictionary).has("id"),
		"car.json in the garage has the Inline-4 (%s)" % TuningFiles.where("hatchback"))
	_check(FileAccess.get_md5(Content.root.path_join("cars/hatchback/car.json")) == get_meta("web_md5"), "web/cars/hatchback/car.json is not touched")
	_check(not menu._differs(menu._reference), "Default is the car as it is tuned now")
	# ---- Export to vehicle: the Race tune that comes with the car
	menu._fill_setups()
	var race_name := ""
	for n in menu._setups:
		if menu._setups[n]["car"] != "":
			race_name = n
	_check(race_name != "", "the car comes with the tune %s" % race_name)
	menu._switch(race_name)
	menu._fill_setups()
	_check(menu._ship_b.visible, "Export to vehicle is shown for it")
	menu._change("final_drive", 4.44)
	_check(menu.export_to_vehicle_now(), "Export to vehicle: %s" % menu._message.text)
	var shipped := TuningFiles.parse_file(TuningFiles.car_dir("hatchback").path_join("race.openracer-tune.json"))
	_check(absf(float(Tuning.read(shipped.get("config", {}), "drivetrain.final_drive")) - 4.44) < 0.01, "the tune file next to car.json has the final drive 4.44")
	_check(FileAccess.get_md5(Content.root.path_join("cars/hatchback/race.openracer-tune.json")) != "" and \
		JSON.parse_string(FileAccess.get_file_as_string(Content.root.path_join("cars/hatchback/race.openracer-tune.json"))) is Dictionary,
		"the tune of web/ is still there")
	if Content.arg("shot") != "":
		world.close_tuning()
		TuningMenu.opened["Engine"] = true
		world.open_tuning()
		await get_tree().create_timer(1.0, true).timeout
		get_viewport().get_texture().get_image().save_png(Content.arg("shot"))
		print("shot: ", Content.arg("shot"))
	# (the garage car and the tunes of the test go again: another test opens the hatchback of the game)
	world.close_tuning()
	for d in [TuningFiles.car_dir("hatchback"), Tuning.tunes_dir("hatchback")]:
		if d != "" and DirAccess.dir_exists_absolute(d):
			for file in DirAccess.get_files_at(d):
				DirAccess.remove_absolute(d.path_join(file))
			DirAccess.remove_absolute(d)
	print("FAILS %d" % _fails)
	get_tree().quit(1 if _fails > 0 else 0)
