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
	await get_tree().process_frame
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
