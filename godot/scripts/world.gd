class_name World
extends Node3D
## One drive: a track, the player's car on its start, the camera and the dashboard.

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
var pause_layer: CanvasLayer
var _pause_box: Control
var _shot_path := ""
var _shot_at := -1.0
var _log_every := 0.0
var _time := 0.0
var _next_log := 0.0
var _last_velocity := Vector3.ZERO
var _stuck := 0.0
var _going := false


func setup(car_id: String, track_id: String) -> void:
	name = "World"
	track = Track.new()
	var tcfg: Variant = Content.load_json("tracks/%s/track.json" % track_id)
	track.setup(track_id, tcfg if tcfg is Dictionary else {})
	add_child(track)
	car = Car.new()
	var ccfg: Variant = Content.load_json("cars/%s/car.json" % car_id)
	car.setup(car_id, ccfg if ccfg is Dictionary else {})
	car.set_meta("track_name", track.config.get("name", track_id))
	car.freeze = true
	add_child(car)
	camera = ChaseCamera.new()
	# (the camera is moved every frame, after the interpolated car: it is not interpolated itself)
	camera.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	camera.far = 4000.0
	add_child(camera)
	hud = Hud.new()
	hud.car = car
	add_child(hud)
	audio = CarAudio.new()
	audio.setup(car)
	add_child(audio)
	effects = TyreEffects.new()
	effects.setup(car)
	add_child(effects)
	laps = LapTimer.new()
	laps.setup(car, track)
	laps.message.connect(hud.toast)
	add_child(laps)
	hud.laps = laps
	line = RacingLine.from_track(track.config)
	# (a test: the AI drives the player's car along the racing line)
	if Content.arg("ai") != "" and line != null:
		ai = AIDriver.new()
		ai.setup(car, line)
	# the tests and the screenshots of the command line: --drive (full throttle), --shot=file.png --shot-at=seconds, --log=seconds
	car.autopilot = Content.arg("drive") != ""
	_shot_path = Content.arg("shot")
	_shot_at = float(Content.arg("shot-at")) if Content.arg("shot-at") != "" else 3.0
	_log_every = float(Content.arg("log")) if Content.arg("log") != "" else 0.0


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
	camera.follow(car)
	camera.make_current()
	RunLog.car = car
	RunLog.on_mark = hud.toast
	WheelInput.calibration_text.connect(hud.calibration)
	camera.mode = int(Settings.get_value("camera")) as ChaseCamera.Mode
	camera.snap()
	audio.set_inside(camera.mode != ChaseCamera.Mode.FOLLOW)
	if Content.arg("settings") != "":
		pause()
		_show_settings()
	RunLog.event("start  %s on %s  mass %d kg  %s %s  %s" % [car.config.get("name", car.car_id), track.config.get("name", track.track_id),
		roundi(car.mass), car.drive, car.gearbox, "engine sound on" if audio.synth != null else "NO engine sound"])


func to_start() -> void:
	RunLog.event("to the start")
	var s: Dictionary = track.start
	var x := float(s.get("x", 0))
	var z := float(s.get("z", 0))
	var y := track.ground_at(x, z)
	car.place(Vector3(x, y + car.wheels[0].radius + 0.15, z), float(s.get("heading", 0)))
	effects.clear()
	if laps:
		laps.restart()
	if ai != null:
		ai.lost()
	if camera.car != null:
		camera.snap()


## Puts the car back on its wheels: on the racing line where it is nearest, facing along it (a track without a
## line: where it is, facing the way it faced).
func recover() -> void:
	RunLog.event("reset (R)")
	laps.invalidate()
	var p := car.global_position
	var h := car.heading()
	if line != null:
		var i := line.nearest_facing(p, car.global_transform.basis.z)
		var a := line.point(i)
		var b := line.point(i + 2)
		p = a
		h = atan2(b.z - a.z, b.x - a.x)
	var y := track.ground_at(p.x, p.z)
	car.place(Vector3(p.x, y + car.wheels[0].radius + 0.4, p.z), h)
	camera.snap()
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
	if ai != null:
		if car.freeze:
			return
		ai.drive(get_physics_process_delta_time())
		# stuck (against a wall, on its side): back on the line
		# (only once it was going: a car at the start is not stuck)
		if absf(car.speed) > 5.0:
			_going = true
		_stuck = _stuck + get_physics_process_delta_time() if absf(car.speed) < 1.0 else 0.0
		if _stuck > (4.0 if _going else 8.0):
			_going = false
			_stuck = 0.0
			recover()
		return
	var keys_steer := Input.get_axis("steer_right", "steer_left")
	car.throttle_input = Input.get_action_strength("throttle")
	car.brake_input = Input.get_action_strength("brake")
	car.handbrake_input = Input.get_action_strength("handbrake")
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


func _unhandled_input(event: InputEvent) -> void:
	if WheelInput.calibrating and event is InputEventKey and event.pressed:
		if event.physical_keycode == KEY_ESCAPE:
			WheelInput.cancel()
		elif event.physical_keycode == KEY_N:
			WheelInput.skip()
		get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_K:
		WheelInput.calibrate()
	elif event.is_action_pressed("menu"):
		pause()
	elif event.is_action_pressed("camera"):
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
		hud.toggle_debug()


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
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	pause_layer.add_child(centre)
	_pause_box = centre
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(320, 0)
	box.add_theme_constant_override("separation", 10)
	centre.add_child(box)
	var items := [["Resume", resume], ["Settings", _show_settings], ["Back to the start", func():
		resume()
		to_start()], ["Main menu", func():
		resume()
		RunLog.car = null
		ForceFeedback.neutral()
		leave.emit()]]
	for item in items:
		var b := Button.new()
		b.text = item[0]
		b.custom_minimum_size.y = 44
		b.pressed.connect(item[1])
		box.add_child(b)
	(box.get_child(0) as Button).grab_focus.call_deferred()


func _show_settings() -> void:
	_pause_box.queue_free()
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	pause_layer.add_child(centre)
	_pause_box = centre
	var menu := SettingsMenu.new()
	menu.closed.connect(func():
		if WheelInput.calibrating:
			resume()
		else:
			_show_pause_buttons())
	centre.add_child(menu)


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
				print("   %s fx %+6.0f fy %+6.0f slip %+.3f wr %.2f v %.2f %s" % [
					w.slot, w.fx, w.fy, w.slip_ratio, w.omega * w.radius, w.forward_speed, w.surface])

