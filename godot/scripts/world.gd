class_name World
extends Node3D
## One drive: a track, the player's car on its start, the camera and the dashboard; in a race (Race) the AI cars
## on the grid as well.

signal leave

var track: Track
var car: Car
var camera: ChaseCamera
var hud: Hud
var audio: CarAudio
var effects: TyreEffects
var laps: LapTimer
var line: RacingLine
var ai: AIDriver = null
var race: Race = null
var replay: Replay = null
var free_cam: GameFreeCamera = null    # the fourth camera (C: follow, cockpit, bonnet, free)
var take: Take = null                  # the 5 key (Take)
var options := {}
var base_config := {}
var pause_layer: CanvasLayer
var tuning_layer: CanvasLayer = null
var parking_brake := false          # the parking brake (P): on until it is pressed again
var touch: Node = null              # the controls of a touch screen (TouchControls), when there is one
var debug_view: Node = null         # what the physics sees (DebugView, the key 0)
var telemetry: Node = null          # the values of the car (Telemetry, V)
var _pause_box: Control
var _results: CanvasLayer
var _shot_path := ""
var _shot_at := -1.0
var _log_every := 0.0
var _time := 0.0
var _next_log := 0.0
var _last_velocity := Vector3.ZERO
var _tuning_paused := false
var _saved_place := {}              # the place for the reset on a track without a racing line (the key 4)
var _key_held := {"throttle": 0.0, "brake": 0.0}   # s that the key of a pedal is held (the easing of the keys)


## options: mode ("practice", "race", "skidpad" or "replay"), opponents, laps, pole (the player starts in front), and from the
## menu: difficulty, grid ("front", "random", "back"), opp (the chosen opponents: [{car, tune}]), ghost and records (bool),
## surface (the ground of the skidpad).
func setup(car_id: String, track_id: String, opts := {}) -> void:
	options = opts
	name = "World"
	track = Track.new()
	var tcfg: Variant = Content.load_json("tracks/%s/track.json" % track_id)
	if tcfg is Dictionary and options.get("mode", "") == "skidpad":
		Skidpad.set_ground(tcfg, str(options.get("surface", "road")))
	track.setup(track_id, tcfg if tcfg is Dictionary else {})
	add_child(track)
	car = Car.new()
	var ccfg: Variant = Content.load_json("cars/%s/car.json" % car_id)
	base_config = ccfg if ccfg is Dictionary else {}
	# the tune in use for this car (the tuning menu), else the car as car.json makes it
	var cfg_use := base_config
	var tune_path: String = Settings.get_value("tunes").get(car_id, "")
	var tune_name := ""
	if tune_path != "":
		var tuned := Tuning.load_tune(tune_path)
		if not tuned.is_empty():
			cfg_use = tuned
			var tunes := Tuning.list(car_id, base_config)
			for n in tunes:
				if tunes[n] == tune_path:
					tune_name = str(n)
			RunLog.event("tune in use: %s" % tune_path)
	car.setup(car_id, cfg_use)
	car.set_meta("track_name", track.config.get("name", track_id))
	car.set_meta("track_id", track_id)
	car.freeze = true
	add_child(car)
	camera = ChaseCamera.new()
	# (the camera is moved every frame, after the interpolated car: it is not interpolated itself)
	camera.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	camera.far = 4000.0
	add_child(camera)
	hud = Hud.new()
	hud.car = car
	hud.world = self
	add_child(hud)
	_add_extras()
	audio = CarAudio.new()
	audio.setup(car)
	add_child(audio)
	effects = TyreEffects.new()
	effects.setup(car)
	add_child(effects)
	for fx: Node in [Marbles.new(), Debris.make(car)]:     # (the marbles, the debris)
		add_child(fx)
	var flames := ExhaustFlames.new()
	flames.setup(car)
	add_child(flames)
	# the pit stop of the player's car (box 1; Pit.js) and the drag strip of the track (DragStrip.js)
	var pit := PitStop.new()
	pit.setup(car, track.config, 0, true)
	car.add_child(pit)
	var drag := DragStrip.make(car, track, track.config, track_id)
	if drag != null:
		add_child(drag)
	laps = LapTimer.new()
	laps.setup(car, track, {"records": options.get("records", true), "ghost": options.get("ghost", true), "tune": tune_name})
	laps.message.connect(hud.toast)
	add_child(laps)
	hud.laps = laps
	line = RacingLine.from_track(track.config)
	# (a test: the AI drives the player's car along the racing line)
	if Content.arg("ai") != "" and line != null:
		ai = AIDriver.new()
		ai.setup(car, line)
	if options.get("mode", "practice") == "race":
		if line == null:
			hud.toast.call_deferred("This track has no racing line for the AI: free driving")
			RunLog.event("race asked, but the track has no racing line")
		else:
			race = Race.new()
			race.setup(self, line, track, car, int(options.get("opponents", 5)), int(options.get("laps", 3)), bool(options.get("pole", false)),
				{"difficulty": options.get("difficulty", "normal"), "grid": options.get("grid", "front" if options.get("pole", false) else "back"),
				"opp": options.get("opp", [])})
			race.finished.connect(_race_finished)
			add_child(race)
			hud.race = race
	# the skidpad (main.js startSkidpad): the car drives round the circle by itself
	if options.get("mode", "") == "skidpad":
		var pad := Skidpad.new()
		pad.setup(self, str(options.get("surface", "road")))
		add_child(pad)
	# a replay from a file (the main menu, Replays): a viewer, no game behind it
	if options.get("mode", "") == "replay":
		_open_replay_file.call_deferred(str(options.get("file", "")))
		return
	# the replay: every car, from the start (Replay.js)
	replay = Replay.new()
	var all: Array = [car]
	if race != null:
		for e in race.entries:
			if e.car != car:
				all.append(e.car)
	replay.setup(self, all)
	add_child(replay)
	take = Take.new()
	take.setup(self)
	add_child(take)
	# the tests and the screenshots of the command line: --drive (full throttle), --shot=file.png --shot-at=seconds, --log=seconds
	car.autopilot = Content.arg("drive") != ""
	_shot_path = Content.arg("shot")
	_shot_at = float(Content.arg("shot-at")) if Content.arg("shot-at") != "" else 3.0
	_log_every = float(Content.arg("log")) if Content.arg("log") != "" else 0.0


## The parts of the browser game that are scripts of their own (made when they are there): the touch controls, the
## debug view (0) and the telemetry (V).
func _add_extras() -> void:
	for spec in [["res://scripts/touch_controls.gd", "touch"], ["res://scripts/debug_view.gd", "debug_view"],
			["res://scripts/telemetry.gd", "telemetry"]]:
		if not ResourceLoader.exists(spec[0]):
			continue
		var script: Script = load(spec[0])
		if spec[1] == "touch" and not script.call("wanted"):
			continue
		var n: Node = script.new()
		n.call("setup", self)
		add_child(n)
		set(spec[1], n)


func _shot() -> void:
	var img := get_viewport().get_texture().get_image()
	img.save_png(_shot_path)
	print("shot: ", _shot_path)
	if Content.arg("quit") != "":
		get_tree().quit()


func _ready() -> void:
	if _shot_path != "":
		# (a timer that also runs while the game is paused: the screenshot of a menu)
		get_tree().create_timer(_shot_at, true, false, true).timeout.connect(_shot)
	# the collision of the track is there after a physics frame
	await get_tree().physics_frame
	await get_tree().physics_frame
	to_start()
	car.freeze = false
	if track.marks != null:
		track.marks.follow(car)          # (the checkpoints follow the lap of the player: TrackMarks)
	if race != null:
		race.place_all()
	camera.follow(car)
	camera.make_current()
	RunLog.car = car
	RunLog.on_mark = hud.toast
	WheelInput.calibration_text.connect(hud.calibration)
	camera.mode = mini(int(Settings.get_value("camera")), 2) as ChaseCamera.Mode
	camera.snap()
	if int(Settings.get_value("camera")) == 3 and options.get("mode", "") != "replay":
		set_free_camera(true)
	audio.set_inside(camera.mode != ChaseCamera.Mode.FOLLOW)
	if Content.arg("settings") != "":
		pause()
		_show_settings()
	if Content.arg("edit-hud") != "":
		# (the screenshots of the tests: the HUD editor, with an element chosen and moved)
		await get_tree().create_timer(1.0).timeout
		hud.edit_layout()
		if Content.arg("edit-hud") != "1":
			hud.editor.selected = Content.arg("edit-hud")
			hud.editor._entry(hud.editor.selected).merge({"x": -0.3, "y": -0.1, "s": 0.8, "o": 0.7}, true)
			HudLayout.apply(get_tree(), hud.editor.working)
			hud.editor._refresh()
	if Content.arg("tuning") != "":
		open_tuning.call_deferred()
	RunLog.event("start  %s on %s  mass %d kg  %s %s  %s" % [car.config.get("name", car.car_id), track.config.get("name", track.track_id),
		roundi(car.mass), car.drive, car.gearbox, "engine sound on" if audio.synth != null else "NO engine sound"])


func to_start() -> void:
	RunLog.event("to the start")
	var s: Dictionary = track.start
	var x := float(s.get("x", 0))
	var z := float(s.get("z", 0))
	var y := track.ground_at(x, z)
	car.place(Vector3(x, y + car.wheels[0].radius + 0.15, z), float(s.get("heading", 0)))
	car.repair()                       # (as the browser game: back at the start the car is whole again)
	effects.clear()
	if track.marks != null:
		track.marks.restart()
	if track.objects != null:
		track.objects.reset()
	get_tree().call_group("clear_at_start", "clear")     # (the pieces of what broke, the marbles, the debris)
	if laps:
		laps.restart()
	if ai != null:
		ai.lost()
	if race != null and race.state != Race.State.COUNTDOWN:
		_restart_race()
		return
	if camera.car != null:
		camera.snap()


## Puts the car back on its wheels: on the racing line where it is nearest, facing along it (a track without a
## line: where it is, facing the way it faced).
func recover() -> void:
	RunLog.event("reset (R)")
	laps.invalidate()
	put_on_line(car)
	camera.snap()


func put_on_line(c: Car) -> void:
	var p := c.global_position
	var h := c.heading()
	if line == null and c == car and not _saved_place.is_empty():
		p = _saved_place["p"]
		h = _saved_place["h"]
	elif line != null:
		var i := line.nearest_facing(p, c.global_transform.basis.z)
		var a := line.point(i)
		var b := line.point(i + 2)
		p = a
		h = atan2(b.z - a.z, b.x - a.x)
	var y := track.ground_at(p.x, p.z)
	c.place(Vector3(p.x, y + c.wheels[0].radius + 0.4, p.z), h)
	c.settle_shell()                   # (put back on its wheels: it keeps its dents)


## The race again from the grid (a new Race with the same options).
func _exit_tree() -> void:
	if ai != null and race == null:
		ai.save_learned()
	if race != null:
		for e in race.entries:
			if e.driver != null:
				e.driver.save_learned()


func _restart_race() -> void:
	RunLog.event("race again")
	var opts := options
	var w := World.new()
	w.setup(car.car_id, track.track_id, opts)
	if get_parent().has_method("_back_to_menu"):
		w.leave.connect(get_parent()._back_to_menu)
	get_parent().add_child(w)
	if get_parent().has_method("set_world"):
		get_parent().set_world(w)
	queue_free()


## The player finished: the results, and the AI drives the player's car slowly on.
func _race_finished() -> void:
	ai = AIDriver.new()
	ai.setup(car, line, 0.5)
	_results = CanvasLayer.new()
	_results.layer = 5
	add_child(_results)
	var panel := PanelContainer.new()
	panel.anchor_left = 0.5
	panel.anchor_right = 0.5
	panel.anchor_top = 0.5
	panel.anchor_bottom = 0.5
	panel.offset_left = -330
	panel.offset_right = 330
	panel.offset_top = -200
	panel.offset_bottom = 200
	_results.add_child(panel)
	var box := VBoxContainer.new()
	panel.add_child(box)
	var text := Label.new()
	text.text = race.results_text()
	text.add_theme_font_override("font", SystemFont.new())
	text.add_theme_font_size_override("font_size", 18)
	box.add_child(text)
	var again := Button.new()
	again.text = "Race again"
	again.pressed.connect(_restart_race)
	box.add_child(again)
	var menu := Button.new()
	menu.text = "Main menu"
	menu.pressed.connect(func():
		RunLog.car = null
		ForceFeedback.neutral()
		leave.emit())
	box.add_child(menu)
	again.grab_focus.call_deferred()
	RunLog.line("RESULTS\n" + race.results_text())
	if ai != null:
		ai.lost()


func _physics_process(_delta: float) -> void:
	# a knock: the speed of the car changed by more than 4 m/s in one physics step
	if not car.freeze:
		var dv := (car.linear_velocity - _last_velocity).length()
		if dv > 4.0 and _last_velocity.length() > 2.0:
			RunLog.event("impact %.1f m/s at %.0f km/h" % [dv, _last_velocity.length() * 3.6])
			ForceFeedback.knock(dv)
		_last_velocity = car.linear_velocity
	if car.autopilot:
		return
	if race != null and race.is_held():
		# the countdown: everyone is held on the grid (the throttle may rev the engine)
		car.steer_input = 0.0
		car.throttle_input = Input.get_action_strength("throttle")
		car.brake_input = 1.0
		car.handbrake_input = 1.0
		if WheelInput.active:
			car.throttle_input = maxf(car.throttle_input, WheelInput.throttle)
		return
	if ai != null:
		if car.freeze:
			return
		if race != null:
			ai.others.assign(race.entries.map(func(e): return e.car))
		ai.drive(get_physics_process_delta_time())
		# stuck (against a wall, on its side, no headway): put back beside the line, as the AI cars (AIDriver)
		if ai.put_back_reason != "":
			RunLog.event("reset (the AI: %s)" % ai.put_back_reason)
			laps.invalidate()
			ai.put_back()
			camera.snap()
		return
	var keys_steer := Input.get_axis("steer_right", "steer_left")
	var dt := get_physics_process_delta_time()
	car.throttle_input = _pedal("throttle", dt)
	car.brake_input = _pedal("brake", dt)
	car.handbrake_input = 1.0 if parking_brake else Input.get_action_strength("handbrake")
	if touch != null and bool(touch.get("engaged")):
		keys_steer = float(touch.get("steer"))
		car.throttle_input = maxf(car.throttle_input, float(touch.get("throttle")))
		car.brake_input = maxf(car.brake_input, float(touch.get("brake")))
	# (the two-step option: at a standstill the engine is held at the two-step speed without the key, Settings.js twoStep)
	car.two_step_input = Input.is_action_pressed("two_step") or (bool(Settings.get_value("two_step")) and absf(car.speed) < 1.0)
	car.pedal_input = not Controls.key_held("brake") and car.brake_input > 0.0
	car.transbrake_input = Input.is_action_pressed("transbrake")
	var stop := 0.0
	var wheel_on: bool = WheelInput.active and not WheelInput.calibrating
	if wheel_on and absf(keys_steer) < 0.01:
		# a racing wheel: as a part of the lock of the car; with "turn as far as the steering wheel of the car" the
		# wheel turns as far as the steering wheel in car.json and the force feedback stops it there
		var s: float = WheelInput.steer
		if Settings.get_value("wheel_match"):
			var car_degrees := float(car.config.get("steering_wheel", {}).get("degrees", 450))
			s *= float(Settings.get_value("wheel_degrees")) / maxf(90.0, car_degrees)
		stop = s
		car.steer_direct = true
		car.steer_input = clampf(s, -1.0, 1.0)
		car.throttle_input = maxf(car.throttle_input, WheelInput.throttle)
		car.brake_input = maxf(car.brake_input, WheelInput.brake)
	else:
		car.steer_direct = false
		car.steer_input = keys_steer
	if wheel_on:
		ForceFeedback.update(car, get_physics_process_delta_time(), stop)


## A pedal from its action: a key comes up over the time and the curve of the Keyboard settings (Settings.js
## keyThrottleTime, keyThrottleCurve), a trigger of a gamepad as it is.
func _pedal(action: String, dt: float) -> float:
	var analog := Input.get_action_strength(action)
	if not Controls.key_held(action):
		_key_held[action] = 0.0
		return analog
	_key_held[action] += dt
	var time := maxf(0.02, float(Settings.get_value("key_%s_time" % action)))
	var curve := float(Settings.get_value("key_%s_curve" % action))
	return maxf(analog if analog < 0.99 else 0.0, pow(minf(1.0, _key_held[action] / time), curve))


func _unhandled_input(event: InputEvent) -> void:
	if WheelInput.calibrating and event is InputEventKey and event.pressed:
		if event.physical_keycode == KEY_ESCAPE:
			WheelInput.cancel()
		elif event.physical_keycode == KEY_N:
			WheelInput.skip()
		get_viewport().set_input_as_handled()
		return
	if event.is_action_pressed("calibrate"):
		WheelInput.calibrate()
	elif event.is_action_pressed("menu"):
		pause()
	elif event.is_action_pressed("tuning"):
		open_tuning()
	elif event.is_action_pressed("camera"):
		if free_cam != null and free_cam.active:
			set_free_camera(false)
		elif camera.mode == ChaseCamera.Mode.BONNET:
			set_free_camera(true)
		else:
			camera.next_mode()
			audio.set_inside(camera.mode != ChaseCamera.Mode.FOLLOW)
			RunLog.event("camera %s" % ChaseCamera.Mode.keys()[camera.mode])
	elif event.is_action_pressed("reset"):
		recover()
	elif event.is_action_pressed("restart"):
		to_start()
	elif event.is_action_pressed("shift_up"):
		car.shift(true)
		RunLog.event("shift up -> %s" % car.gear_name())
	elif event.is_action_pressed("shift_down"):
		car.shift(false)
		RunLog.event("shift down -> %s" % car.gear_name())
	elif event.is_action_pressed("debug"):
		Settings.set_value("debug", not Settings.get_value("debug"))
	else:
		_more_actions(event)


## The other actions of the browser game (Settings.js handlers).
func _more_actions(event: InputEvent) -> void:
	for g in 8:
		if event.is_action_pressed("gear%d" % (g + 1)):
			_select_gear(g + 1)
		elif event.is_action_released("gear%d" % (g + 1)) and car.gear == g + 1:
			_select_gear(0)
	if event.is_action_pressed("reverse_gear") or event.is_action_pressed("reverse"):
		_select_gear(-1)
	elif event.is_action_released("reverse_gear"):
		_select_gear(0)
	elif event.is_action_released("reverse") and car.gear < 0:
		car.gear = 1
	elif event.is_action_pressed("parking_brake"):
		parking_brake = not parking_brake
		hud.notice("Parking brake %s" % ("on" if parking_brake else "off"))
	elif event.is_action_pressed("toggle_tc"):
		_aid("tc", "Traction control", "toggle_tc")
	elif event.is_action_pressed("toggle_abs"):
		_aid("abs", "ABS", "toggle_abs")
	elif event.is_action_pressed("toggle_esc"):
		_aid("esc", "Stability control (ESC)", "toggle_esc")
	elif event.is_action_pressed("toggle_launch"):
		_aid("launch_control", "Launch control", "toggle_launch")
	elif event.is_action_pressed("toggle_two_step"):
		_aid("two_step", "Two-step", "toggle_two_step")
	elif event.is_action_pressed("mute"):
		_aid("sound", "Engine sound", "mute")
	elif event.is_action_pressed("hud_toggle"):
		Settings.set_value("hud", not Settings.get_value("hud"))
	elif event.is_action_pressed("camera_left") or event.is_action_pressed("camera_right"):
		camera.orbit = wrapf(camera.orbit + (0.35 if event.is_action_pressed("camera_left") else -0.35), -PI, PI)
	elif event.is_action_pressed("camera_reset"):
		camera.orbit = 0.0
	elif event.is_action_pressed("start_engine"):
		car.engine.start()
	elif event.is_action_pressed("repair"):
		repair_here()
	elif event.is_action_pressed("save_reset_position"):
		_saved_place = {"p": car.global_position, "h": car.heading()}
		hud.notice("Place saved for the reset")
	elif event.is_action_pressed("photo"):
		photo()
	elif event.is_action_pressed("wheel_toggle"):
		WheelInput.active = not WheelInput.active and not Settings.profile(WheelInput.guid).is_empty()
		Controls.rebind(WheelInput.device if WheelInput.active else -1)
		hud.notice("Wheel %s" % ("on" if WheelInput.active else "off"))
	elif event.is_action_pressed("ragdoll") or event.is_action_pressed("rider_back") or event.is_action_pressed("rider_forward"):
		if car.bike != null:
			hud.notice("Not in the Godot version yet")


## A driver aid on or off by its key, with a short line in the middle of the screen (Settings.js aid).
func _aid(key: String, text: String, action: String) -> void:
	Settings.set_value(key, not Settings.get_value(key))
	var k := Controls.key_name(action)
	hud.notice("%s %s%s" % [text, "on" if Settings.get_value(key) else "off", " (%s)" % k if k != "" else ""])


## A gear of the H-shifter (0: neutral, -1: reverse): the gearbox is manual from then on.
func _select_gear(g: int) -> void:
	if car.bike != null and g < 0:
		return
	car.manual = true
	car.gear = clampi(g, -1, car.gear_ratios.size())
	car.shift_timer = car.shift_time
	RunLog.event("H-shifter -> %s" % car.gear_name())


## Repaired and on its wheels where it is (Settings.js repairCar); in a race the lap is no record.
func repair_here() -> void:
	RunLog.event("repair where it is")
	var p := car.global_position
	car.place(Vector3(p.x, track.ground_at(p.x, p.z) + car.wheels[0].radius + 0.3, p.z), car.heading())
	car.repair()
	laps.invalidate()
	camera.snap()


## A photo of the game without the HUD (F2), in the pictures folder of the computer.
func photo() -> void:
	var layers := find_children("*", "CanvasLayer", true, false)
	var shown := []
	for l: CanvasLayer in layers:
		if l.visible:
			shown.append(l)
			l.visible = false
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	for l: CanvasLayer in shown:
		l.visible = true
	var dir := OS.get_system_dir(OS.SYSTEM_DIR_PICTURES).path_join("O-Racer")
	DirAccess.make_dir_recursive_absolute(dir)
	var file := dir.path_join("openracer-%s.png" % Time.get_datetime_string_from_system().replace(":", "-"))
	img.save_png(file)
	hud.notice("Photo saved: %s" % file)
	RunLog.event("photo %s" % file)


## The pause menu: the game stops, the wheel is let go.
func pause() -> void:
	if get_tree().paused:
		return
	get_tree().paused = true
	ForceFeedback.neutral()
	RunLog.event("pause")
	pause_layer = CanvasLayer.new()
	pause_layer.process_mode = Node.PROCESS_MODE_ALWAYS
	pause_layer.layer = 10
	add_child(pause_layer)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.5)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	pause_layer.add_child(dim)
	_show_pause_buttons()


func _show_pause_buttons() -> void:
	if _pause_box != null:
		_pause_box.queue_free()
	var m := PauseMenu.new()
	m.setup(self)
	pause_layer.add_child(m)
	_pause_box = m


func _open_replay_file(path: String) -> void:
	replay = Replay.new()
	if not replay.open_file(path, self, car, not options.get("edit", false)):
		hud.toast("This is not a replay of this version")
		replay = null
		return
	add_child(replay)
	car.make_ghost()
	for m in car.find_children("*", "MeshInstance3D", true, false):
		(m as MeshInstance3D).transparency = 0.0
	get_tree().paused = true
	replay.play()
	# (Edit in Replays: the video editor on the recording itself, Close goes back to the main menu)
	if options.get("edit", false):
		var ed := VideoEditor.new()
		ed.standalone = true
		ed.setup(replay)
		replay.add_child(ed)


## The free camera of the game (GameFreeCamera, FreeCam.js) on or off; off: the follow camera.
func set_free_camera(on: bool) -> void:
	if on:
		if free_cam == null:
			free_cam = GameFreeCamera.new()
			free_cam.take = take
			free_cam.left_camera.connect(func(): set_free_camera(false))
			if take != null:
				take.state_changed.connect(func(_s: String): free_cam.refresh())
			add_child(free_cam)
		free_cam.enter(camera, car)
		audio.set_inside(false)
	elif free_cam != null and free_cam.active:
		free_cam.leave()
		camera.mode = ChaseCamera.Mode.FOLLOW
		camera.make_current()
		camera.snap()
		audio.set_inside(false)
		RunLog.event("camera FOLLOW")


## The replay of what was driven (Replay.js): the pause menu goes, the game stays paused behind it.
func _start_replay() -> void:
	if replay == null or replay.count < 2:
		return
	if pause_layer != null:
		pause_layer.visible = false
	replay.play()


## The tuning menu (U), at the right of the screen (Tuning.js): in free driving the car is tuned while it drives; in
## a race the game waits while the menu is open. U again (or Esc) closes it.
func open_tuning() -> void:
	if tuning_layer != null:
		close_tuning()
		return
	if get_tree().paused:
		return
	tuning_layer = CanvasLayer.new()
	tuning_layer.process_mode = Node.PROCESS_MODE_ALWAYS
	tuning_layer.layer = 9
	add_child(tuning_layer)
	var menu := TuningMenu.new()
	menu.setup(self, car, base_config)
	menu.closed.connect(close_tuning)
	tuning_layer.add_child(menu)
	_tuning_paused = race != null and race.state != Race.State.DONE
	if _tuning_paused:
		get_tree().paused = true
		ForceFeedback.neutral()
		# (the gamepad works the menu while it holds the race, PadNav.js; in free driving the pad drives)
		_focus_first.call_deferred(menu)
	RunLog.event("tuning menu open%s" % (" (the race waits)" if _tuning_paused else ""))


func _focus_first(root: Node) -> void:
	for c in root.find_children("*", "Control", true, false):
		var ctl := c as Control
		if ctl.focus_mode == Control.FOCUS_ALL and ctl.is_visible_in_tree() and not (ctl is BaseButton and (ctl as BaseButton).disabled):
			ctl.grab_focus()
			return


func close_tuning() -> void:
	if tuning_layer == null:
		return
	tuning_layer.queue_free()
	tuning_layer = null
	if _tuning_paused:
		get_tree().paused = false
		_tuning_paused = false
	RunLog.event("tuning menu closed")


func _show_settings() -> void:
	if _pause_box == null:
		_show_pause_buttons()
	(_pause_box as PauseMenu).show_settings.call_deferred()


func resume() -> void:
	if pause_layer != null:
		pause_layer.queue_free()
		pause_layer = null
		_pause_box = null
	get_tree().paused = false
	RunLog.event("resume")


func _process(delta: float) -> void:
	_time += delta
	if _log_every > 0.0 and _time >= _next_log and not car.freeze:
		_next_log = _time + _log_every
		var p := car.global_position
		var loads := []
		for w in car.wheels:
			loads.append(roundi(w.load))
		var fx := []
		for w in car.wheels:
			fx.append("%.1f/%.1f/%d" % [w.squeal, w.smoke, roundi(w.surf_t)])
		print("t %5.2f  pos (%.1f %.2f %.1f)  %5.1f km/h  gear %s  %4d rpm  clutch %.2f  loads %s  up %.2f  sound %.3f  tyres %s" % [
			_time, p.x, p.y, p.z, car.speed * 3.6, car.gear_name(), roundi(car.engine.rpm()), car.clutch_engagement, loads,
			car.global_transform.basis.y.y, audio.engine_level(), fx])
		if Content.arg("verbose") != "":
			for w in car.wheels:
				print("   %s fx %+6.0f fy %+6.0f slip %+.3f/%+.3f steer %+5.1f wr %.2f v %.2f side %+.2f off %.3f %s" % [
					w.slot, w.fx, w.fy, w.slip_ratio, w.slip_tan, rad_to_deg(w.steer), w.omega * w.radius, w.forward_speed, w.side_speed, w.offset, w.surface])
			var r := car.angular_velocity.dot(car.global_transform.basis.y)
			print("   yaw %.2f rad/s, geometry asks %.2f  (steer %.1f, speed %.2f)" % [
				r, car.speed * tan(car.steer_angle) / car.wheelbase, rad_to_deg(car.steer_angle), car.speed])

