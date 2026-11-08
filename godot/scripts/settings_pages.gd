class_name SettingsPages
extends RefCounted
## The pages of the settings menu in the order of web/js/Settings.js renderMenu: Car, Keyboard, Gamepad, Wheel,
## Display and sound, Mobile (with the touch controls), Graphics, Simulation, Tools. (Controls: SettingsControlsPage.)

const R := preload("res://scripts/settings_rows.gd")
const CAMERAS := [[0, "Follow (smooth, FOV with speed)"], [1, "Cockpit"], [2, "Bonnet"]]

var menu: SettingsMenu
var world: Node = null              # the drive behind the menu, or null in the main menu
var _wheel_status: Label
var _io_status: Label


func _init(m: SettingsMenu, w: Node) -> void:
	menu = m
	world = w


func _car() -> Car:
	return world.get("car") if world != null else null


func _units_speed(kmh: float) -> String:
	if str(Settings.get_value("units")) == "imperial":
		return "%.1f mph" % (kmh / 1.609344)
	return "%d km/h" % roundi(kmh)


func car_page(page: VBoxContainer) -> void:
	var car := _car()
	# free driving: another vehicle in place of this one (the same track and options)
	if car != null and world.get("race") == null and world.get_parent().has_method("_start"):
		var b := R.action(page, "Vehicle: %s" % car.config.get("name", car.car_id), "Change vehicle…", _choose_vehicle)
		b.tooltip_text = "Drive another vehicle on this track"
	R.check(page, "Traction control", "tc")
	R.check(page, "Two-step (the clutch in at a standstill holds the engine at the two-step speed)", "two_step")
	R.check(page, "Launch control (brake and full throttle at a standstill, let go of the brake)", "launch_control")
	R.slider(page, "Drag strip: \"Get ready\" before the lights", "drag_ready", 0.5, 6.0, 0.5, func(v: float) -> String: return "%.1f s" % v)
	R.slider(page, "Drag strip: lights stay after the green", "drag_green", 0.5, 5.0, 0.5, func(v: float) -> String: return "%.1f s" % v)
	R.check(page, "ESC (stability control)", "esc")
	R.pick(page, "Camera", Settings.get_value("camera"), CAMERAS, func(v: Variant):
		Settings.set_value("camera", v)
		var cam: Variant = world.get("camera") if world != null else null
		if cam is ChaseCamera:
			(cam as ChaseCamera).mode = int(v) as ChaseCamera.Mode
			(cam as ChaseCamera).snap()
			world.audio.set_inside(int(v) != 0))
	if car != null and car.bike != null:
		R.pick_key(page, "Motorcycle steering", "bike_steering", [["counter", "Countersteer + lean"], ["lean", "Lean only"]])
		R.check(page, "Wheelie control (the rider rolls the gas off as the front wheel lifts)", "wheelie_control")
		R.check(page, "Flat-track style (stay upright and push the bike under you: the inside foot out, a tighter bend at a low "
			+ "speed; off: hang off to the inside, as in road racing)", "bike_push")
		R.pick_key(page, "Motorcycle follow camera", "bike_camera",
			[["lean", "Motorcycle lean chase (the picture rolls with the bike)"], ["classic", "Classic chase (as a car)"]])
		R.slider(page, "Motorcycle: lean at top speed (the keys ask for less lean as the speed goes up; this is what is left at the top)",
			"bike_fast_lean", 15, 45, 1, func(v: float) -> String: return "%d°" % roundi(v))
	R.check(page, "ABS", "abs")
	R.check(page, "Automatic: reverse with the brake key", "auto_reverse")
	R.check(page, "Automatic: reverse with the brake pedal (wheel, pad, touch)", "auto_reverse_pedals")
	R.slider(page, "Automatic: reverse below a speed of", "auto_reverse_speed", 1, 15, 1, _units_speed)
	R.slider(page, "Tyre temperature and wear (0: off; the fuel with it)", "tyre_wear", 0.0, 5.0, 0.5,
		func(v: float) -> String: return "off" if v <= 0.0 else "%.1f×" % v)
	R.check(page, "Damage: the cars dent and lose parts (from the next start of a drive)", "damage")
	# the mirrors of the car (CarMirrors, Mirrors.js; the Car page of the browser's settings)
	R.section(page, "Mirrors")
	var deg := func(v: float) -> String: return "%d°" % roundi(v)
	for side in [["left", "Left mirror", "outwards"], ["right", "Right mirror", "outwards"], ["centre", "Mirror inside", "to the left"]]:
		R.slider(page, "%s: turn (positive %s)" % [side[1], side[2]], "mirror_%s_yaw" % side[0], -25.0, 25.0, 1.0, deg)
		R.slider(page, "%s: tilt (positive up)" % side[1], "mirror_%s_tilt" % side[0], -25.0, 25.0, 1.0, deg)
		R.check(page, "%s: a real mirror (shows what is behind, from the cockpit and the bonnet)" % side[1], "mirror_%s_real" % side[0])


func keyboard_page(page: VBoxContainer) -> void:
	R.note(page, "How the keys bring the gas, the brake and the wheels up: the time to the full value and the curve of it (the line "
		+ "shows the pedal over the time that the key is held). The steering gets slower the faster the car goes; the wheels come "
		+ "back to the middle by themselves when the keys are let go.")
	for g in [["Throttle", "key_throttle_time", "key_throttle_curve", "to full gas"], ["Brake", "key_brake_time", "key_brake_curve",
			"to full brake"], ["Steering", "key_steer_time", "key_steer_curve", "to full lock at a standstill"]]:
		R.section(page, g[0])
		var after := Callable()
		if g[1] == "key_steer_time":
			# (car.gd turns the wheels at a rate: the time to the full lock sets it)
			after = func(v: float): Settings.set_value("key_steer_speed", snappedf(0.9 / maxf(0.05, v), 0.01))
		R.slider(page, "Time " + g[3], g[1], 0.05, 2.0, 0.05, R.seconds, after)
		R.curve(page, "Curve", g[2])
	R.slider(page, "Slower at speed", "key_slow", 0.0, 3.0, 0.25, func(v: float) -> String:
		var at100 := 1.0 + maxf(0.0, (100.0 / 3.6) / 4.0 - 1.0) * v
		return "off: the same at every speed" if v == 0.0 else "%.1f× slower at 100 km/h%s" % [at100, " (as it was)" if absf(v - 1.0) < 0.01 else ""],
		func(v: float): Settings.set_value("key_steer_at_speed", v))
	R.check(page, "Steering assist", "key_assist", "when the rear steps out the front wheels turn into the slide by themselves")


func gamepad_page(page: VBoxContainer) -> void:
	R.note(page, "The stick is the steering one to one at a standstill. The faster the car goes, the slower the steering follows the "
		+ "stick, as with the keyboard: a flick at speed is a small movement of the wheels.")
	R.slider(page, "Slower at speed", "pad_slow", 0.0, 4.0, 0.25, func(v: float) -> String:
		return "off: one to one at every speed" if v == 0.0 else "%.1f× slower at 100 km/h" % (1.0 + v * (100.0 / 3.6) / 10.0))
	R.check(page, "Steering assist", "pad_assist", "when the rear steps out the front tyres steer into the slide by themselves")
	R.note(page, "In the menus the D-pad or the left stick moves, A chooses, B goes back, L1 and R1 change the tab, Start pauses.")


func wheel_page(page: VBoxContainer) -> void:
	_wheel_status = Label.new()
	_wheel_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	page.add_child(_wheel_status)
	update_wheel_status()
	var row := HBoxContainer.new()
	var cal := Button.new()
	cal.text = "Calibrate the wheel from scratch (K)"
	cal.pressed.connect(func():
		menu.closed.emit()
		WheelInput.calibrate())
	R.style(cal)
	row.add_child(cal)
	var test := Button.new()
	test.text = "Test force feedback"
	test.pressed.connect(func():
		ForceFeedback.test()
		menu.hint(ForceFeedback.status))
	R.style(test)
	row.add_child(test)
	page.add_child(row)
	R.slider(page, "Wheel steering range (the part of the turn that is the lock)", "wheel_range", 0.3, 1.0, 0.05, R.percent)
	R.pick(page, "Steering lock of the wheel", Settings.get_value("wheel_degrees"),
		[270, 360, 540, 720, 900, 1080].map(func(d): return [d, "%d° from lock to lock" % d]), func(v: Variant): Settings.set_value("wheel_degrees", v))
	R.check(page, "Match the steering lock of the car", "wheel_match",
		"on: the wheel turns as far as the steering wheel of the car, then the force feedback stops it")
	R.pick(page, "Wheel dead zone", Settings.get_value("wheel_deadzone"),
		[0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0].map(func(d): return [d, "%s%%%s" % [str(d), " (none)" if d == 0.0 else ""]]),
		func(v: Variant): Settings.set_value("wheel_deadzone", v))
	R.section(page, "Force feedback")
	var dev := R.row(page, "Wheel with force feedback")
	var dev_text := Label.new()
	dev_text.text = ForceFeedback.status
	dev_text.autowrap_mode = TextServer.AUTOWRAP_WORD
	dev_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	dev.add_child(dev_text)
	R.check(page, "Force feedback", "ffb")
	R.slider(page, "Strength", "ffb_strength", 0.0, 1.5, 0.05, R.percent)
	R.slider(page, "Centring spring", "ffb_spring", 0.0, 1.0, 0.05, R.percent)
	R.slider(page, "Damping", "ffb_damping", 0.0, 1.0, 0.05, R.percent)
	R.slider(page, "Road detail (bumps, grass, slip, ABS)", "ffb_road", 0.0, 1.5, 0.05, R.percent)
	R.pick(page, "Direction", Settings.get_value("ffb_invert"), [[false, "Normal"], [true, "Inverted"]],
		func(v: Variant): Settings.set_value("ffb_invert", v))
	R.action(page, "Test", "Shake the wheel", func():
		ForceFeedback.test()
		menu.hint(ForceFeedback.status))
	R.action(page, "Diagnostics", "Copy to the clipboard", func():
		var text := "%s\n%s (%s)\nprofile %s\nconnected: %s" % [ForceFeedback.status, WheelInput.wheel_name, WheelInput.guid,
			JSON.stringify(Settings.profile(WheelInput.guid)), Input.get_connected_joypads().map(func(d): return Input.get_joy_name(d))]
		DisplayServer.clipboard_set(text)
		RunLog.line("wheel diagnostics\n" + text)
		menu.hint("The diagnostics are on the clipboard (and in the log). Paste them to whoever helps you."))
	R.section(page, "Calibrated wheels")
	var profiles: Dictionary = Settings.profiles()
	if profiles.is_empty():
		R.note(page, "No wheel is calibrated yet.")
	for guid in profiles:
		var label := "%s%s" % [guid, " · %s (connected)" % WheelInput.wheel_name if guid == WheelInput.guid else ""]
		R.action(page, label, "Forget", func():
			Settings.forget_profile(guid)
			WheelInput._pick()
			menu.hint("The calibration of %s is forgotten." % guid)
			menu.rebuild())


func update_wheel_status() -> void:
	if _wheel_status == null or not is_instance_valid(_wheel_status):
		return
	var w := "No wheel or joypad connected"
	if WheelInput.device >= 0:
		w = "%s: %s" % [WheelInput.wheel_name, "calibrated" if WheelInput.active else "not calibrated yet"]
	_wheel_status.text = "%s\n%s" % [w, ForceFeedback.status]


func display_page(page: VBoxContainer) -> void:
	R.check(page, "HUD", "hud")
	_edit_hud_row(page, "HUD layout")
	R.pick_key(page, "Units", "units", [["metric", "Metric (km/h)"], ["imperial", "Imperial (mph)"]])
	R.pick_key(page, "Touch controls (on a touch screen: the steering, the pedals, the buttons)", "touch",
		[["auto", "Auto (on a touch screen)"], ["on", "On"], ["off", "Off"]])
	R.slider(page, "Engine volume", "volume", 0.0, 1.5, 0.05, R.percent)
	R.slider(page, "Tyre volume", "tyre_volume", 0.0, 1.5, 0.05, R.percent)
	R.check(page, "Engine sound", "sound")


func _edit_hud_row(page: VBoxContainer, text: String) -> void:
	var b := R.action(page, text, "Edit HUD…", func():
		var hud := menu.get_tree().get_first_node_in_group("hud")
		if hud != null and hud.has_method("edit_layout"):
			menu.closed.emit()
			hud.call("edit_layout"))
	var hud := menu.get_tree().get_first_node_in_group("hud") if menu.is_inside_tree() else null
	if world == null or hud == null or not hud.has_method("edit_layout"):
		b.disabled = true
		b.tooltip_text = "The HUD is edited in a drive: open the settings with Esc while you drive."


func mobile_page(page: VBoxContainer) -> void:
	R.note(page, "The steering is a stick under your thumb on the left half of the screen. A smaller number takes less movement of "
		+ "the finger for the full steering.")
	R.slider(page, "Finger travel for full lock", "touch_steer", 0.01, 1.0, 0.01, func(v: float) -> String: return "%.2f×" % v)
	_edit_hud_row(page, "HUD and buttons")


func graphics_page(page: VBoxContainer) -> void:
	page.add_child(GraphicsPage.new())
	R.section(page, "Debris")
	R.slider(page, "Debris: spawn rate (grass, sand and snow that the wheels throw up; 1 is normal, 0 is none)", "gfx_debris_rate",
		0.0, 5.0, 0.1, func(v: float) -> String: return "%.1f" % v)
	R.slider(page, "Debris: size (1 is normal)", "gfx_debris_scale", 0.0, 5.0, 0.1, func(v: float) -> String: return "%.1f×" % v)
	R.slider(page, "Debris: most pieces at once", "gfx_debris_max", 500, 20000, 500, func(v: float) -> String: return "%d pieces" % v)


func simulation_page(page: VBoxContainer) -> void:
	R.note(page, "What the computer calculates. With many AI cars with damage the physics is the biggest cost: these settings trade a "
		+ "little realism for frames.")
	R.pick_key(page, "Tyres of my car (the shell of nodes is the tyre of the browser game; the simple one is that of the AI cars)",
		"sim_player_tyres", [["shell", "Shell of nodes (as the browser game)"], ["simple", "Simple (ray and slip curve)"]])
	R.pick_key(page, "Tyres of cars: detail (the tyres of nodes, most of the work of the physics; a motorcycle and a kart keep their own)",
		"sim_tyre_detail", [["full", "Full (as the car is made)"], ["medium", "Medium (2 rings of nodes: a third less work)"],
		["low", "Low (1 ring of 12: half to two thirds less)"]])
	R.pick_key(page, "AI cars: damage (soft body)", "sim_ai_damage", [["full", "Always (most realistic)"], ["near", "Only near my car"],
		["off", "Off (rigid AI cars)"]])
	R.slider(page, "AI cars: damage range around my car (when 'Only near my car')", "sim_ai_range", 20, 300, 10,
		func(v: float) -> String: return "%d m" % v)
	R.pick_key(page, "AI cars: soft body detail (steps per frame)", "sim_ai_steps", [[3, "Full"], [2, "Medium"], [1, "Low (fastest)"]])
	R.note(page, "'Only near my car': an AI car further away than the range does not dent, so the cars you see and hit are the ones that "
		+ "are calculated. (The AI cars of the Godot version have no soft body yet: these rows wait for it.)")


func tools_page(page: VBoxContainer) -> void:
	R.check(page, "Debug text (the data of the tyres, F3)", "debug")
	R.note(page, "Everything the game keeps (settings, controls, records, setups, your garage and replays) is in its folder on this "
		+ "computer: %s. Back up the settings, the records and the setups here." % ProjectSettings.globalize_path("user://"))
	R.action(page, "The folder of the game", "Open", func(): OS.shell_open(ProjectSettings.globalize_path("user://")))
	R.action(page, "Back up my settings, controls, records and setups", "Save…", _backup)
	R.action(page, "Restore a backup", "Choose a file…", _restore)
	_io_status = Label.new()
	_io_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	page.add_child(_io_status)
	if world == null:
		return
	R.action(page, "Tuning menu", "Open", func():
		world.resume()
		world.open_tuning())
	var track: Track = world.get("track")
	if track.config.get("dragstrip") is Dictionary:
		R.action(page, "Drag strip of this track", "Top 50 and tickets", func(): DragTopWindow.open(menu, track.track_id, track.config))
	var line_b := R.action(page, "Racing line of this track", "Save my best lap as the line", func(): pass)
	R.grey(line_b.get_parent(), "The Godot version does not write tracks: draw the line in the track editor of the browser game")
	R.action(page, "Records of this track", "Forget them", _forget_records.bind(track))
	var hdr_status := Label.new()
	var hdr := R.action(page, "Surroundings for Blender", "Save as HDR", func(): pass)
	hdr.pressed.connect(func():
		var car := _car()
		hdr.disabled = true
		hdr_status.text = "Rendering…"
		var path := await EnvironmentExport.save(world, car.global_position + Vector3(0, 0.6, 0), EnvironmentExport.own_cars(world, car))
		hdr_status.text = ("Saved: " + path) if path != "" else "Could not save the picture."
		hdr.disabled = false)
	hdr.get_parent().add_child(hdr_status)


func _forget_records(track: Track) -> void:
	_confirm("Forget the records of this track?", "The lap records and the ghosts of every car on %s are deleted. This cannot be undone."
		% track.config.get("name", track.track_id), "Forget them", func():
		var laps: LapTimer = world.get("laps")
		var file := laps.records_file if laps != null else LapTimer.RECORDS
		var dir := laps.ghosts_dir if laps != null else LapTimer.GHOSTS
		var cfg := ConfigFile.new()
		if cfg.load(file) == OK and cfg.has_section(track.track_id):
			cfg.erase_section(track.track_id)
			cfg.save(file)
		for f in DirAccess.get_files_at(dir):
			if f.begins_with(track.track_id + "__"):
				DirAccess.remove_absolute(dir.path_join(f))
		var drag := ConfigFile.new()
		if drag.load(DragTopWindow.file()) == OK and drag.has_section_key("runs", track.track_id):
			drag.erase_section_key("runs", track.track_id)
			drag.save(DragTopWindow.file())
		if laps != null:
			laps.best_lap = -1.0
			laps.best_splits = PackedFloat32Array()
			if laps.ghost != null:
				laps.ghost.queue_free()
				laps.ghost = null
		RunLog.event("records of %s forgotten" % track.track_id)
		menu.hint("The records and the ghost of this track are forgotten."))


func _confirm(title: String, text: String, ok: String, then: Callable) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.title = title
	dlg.dialog_text = text
	dlg.ok_button_text = ok
	dlg.dialog_autowrap = true
	dlg.min_size = Vector2i(460, 0)
	dlg.process_mode = Node.PROCESS_MODE_ALWAYS
	menu.add_child(dlg)
	dlg.confirmed.connect(func():
		dlg.queue_free()
		then.call())
	dlg.canceled.connect(dlg.queue_free)
	dlg.popup_centered()
	dlg.get_cancel_button().grab_focus.call_deferred()


## The files of a backup: a name in the backup -> the file on this computer.
static func backup_files() -> Dictionary:
	var out := {"settings.cfg": Settings.path("settings.cfg"), "menu.cfg": Settings.path("menu.cfg"),
		"records.cfg": "user://records.cfg", "drag.cfg": "user://drag.cfg"}
	if not DirAccess.dir_exists_absolute("user://tunes"):
		return out
	for car in DirAccess.get_directories_at("user://tunes"):
		for f in DirAccess.get_files_at("user://tunes".path_join(car)):
			out["tunes/%s/%s" % [car, f]] = "user://tunes".path_join(car).path_join(f)
	return out


func _backup() -> void:
	var dlg := _file_dialog(FileDialog.FILE_MODE_SAVE_FILE)
	dlg.current_file = "openracer-backup-%s.openracer-backup.json" % Time.get_date_string_from_system()
	dlg.file_selected.connect(func(p: String):
		dlg.queue_free()
		var files := {}
		var all := backup_files()
		for name in all:
			if FileAccess.file_exists(all[name]):
				files[name] = FileAccess.get_file_as_string(all[name])
		var data := {"openracerBackup": 1, "version": str(ProjectSettings.get_setting("application/config/version")),
			"made": Time.get_datetime_string_from_system(true), "files": files}
		var f := FileAccess.open(p, FileAccess.WRITE)
		if f == null:
			_io_status.text = "Could not write %s." % p
			return
		f.store_string(JSON.stringify(data, " "))
		_io_status.text = "Saved %d files in %s." % [files.size(), p])
	dlg.popup_centered_ratio(0.6)


func _restore() -> void:
	var dlg := _file_dialog(FileDialog.FILE_MODE_OPEN_FILE)
	dlg.file_selected.connect(func(p: String):
		dlg.queue_free()
		var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(p))
		if not data is Dictionary or int(data.get("openracerBackup", 0)) != 1 or not data.get("files") is Dictionary:
			_io_status.text = "That is not a backup file of OpenRacer."
			return
		var files: Dictionary = data["files"]
		_confirm("Restore this backup?", "%d files from %s (version %s) replace what this computer has under the same names: the settings, "
			% [files.size(), str(data.get("made", "a backup")).left(10), data.get("version", "?")]
			+ "the controls, the records and the setups. Other things stay. The game closes after it: start it again.", "Restore", func():
			for name: String in files:
				var target := ""
				if name in ["settings.cfg", "menu.cfg"]:
					target = Settings.path(name)
				elif name in ["records.cfg", "drag.cfg"] or (name.begins_with("tunes/") and not name.contains("..")):
					target = "user://" + name
				if target == "":
					continue
				DirAccess.make_dir_recursive_absolute(target.get_base_dir())
				var f := FileAccess.open(target, FileAccess.WRITE)
				if f != null:
					f.store_string(str(files[name]))
			RunLog.event("backup restored from %s" % p)
			menu.get_tree().quit()))
	dlg.popup_centered_ratio(0.6)


func _file_dialog(mode: FileDialog.FileMode) -> FileDialog:
	var dlg := FileDialog.new()
	dlg.file_mode = mode
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.filters = PackedStringArray(["*.json ; OpenRacer backup"])
	dlg.process_mode = Node.PROCESS_MODE_ALWAYS
	dlg.canceled.connect(dlg.queue_free)
	menu.add_child(dlg)
	return dlg


## A window with every vehicle (Settings.js chooseVehicle): a click starts this track again with that one.
func _choose_vehicle() -> void:
	var car := _car()
	var dlg := AcceptDialog.new()
	dlg.title = "Choose a vehicle"
	dlg.ok_button_text = "Close"
	dlg.process_mode = Node.PROCESS_MODE_ALWAYS
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(820, 480)
	dlg.add_child(scroll)
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	scroll.add_child(grid)
	var first: Button = null
	for c in Content.list_cars():
		var b := Button.new()
		b.text = str(c["name"])
		b.custom_minimum_size = Vector2(196, 150)
		b.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
		b.vertical_icon_alignment = VERTICAL_ALIGNMENT_TOP
		b.expand_icon = true
		var pic := Content.path("cars/%s/preview.webp" % c["id"])
		if FileAccess.file_exists(pic):
			var img := Image.load_from_file(pic)
			if img != null:
				b.icon = ImageTexture.create_from_image(img)
		if c["id"] == car.car_id:
			b.modulate = Color(1.0, 0.75, 0.55)
			first = b
		var id: String = c["id"]
		b.pressed.connect(func():
			dlg.queue_free()
			if id == car.car_id:
				return
			var main := world.get_parent()
			world.resume()
			RunLog.event("change vehicle -> %s" % id)
			main.call("_start", id, world.get("track").track_id, world.get("options")))
		grid.add_child(b)
		if first == null:
			first = b
	menu.add_child(dlg)
	dlg.confirmed.connect(dlg.queue_free)
	dlg.canceled.connect(dlg.queue_free)
	dlg.popup_centered()
	first.grab_focus.call_deferred()
