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
var _shot_path := ""
var _shot_at := -1.0
var _log_every := 0.0
var _time := 0.0
var _next_log := 0.0
var _last_velocity := Vector3.ZERO


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
	# the tests and the screenshots of the command line: --drive (full throttle), --shot=file.png --shot-at=seconds, --log=seconds
	car.autopilot = Content.arg("drive") != ""
	_shot_path = Content.arg("shot")
	_shot_at = float(Content.arg("shot-at")) if Content.arg("shot-at") != "" else 3.0
	_log_every = float(Content.arg("log")) if Content.arg("log") != "" else 0.0


func _ready() -> void:
	# the collision of the track is there after a physics frame
	await get_tree().physics_frame
	await get_tree().physics_frame
	to_start()
	car.freeze = false
	camera.follow(car)
	camera.make_current()
	RunLog.car = car
	RunLog.on_mark = hud.toast
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
	if camera.car != null:
		camera.snap()


## Puts the car back on its wheels where it is, facing the way it faced.
func recover() -> void:
	RunLog.event("reset (R)")
	var p := car.global_position
	var y := track.ground_at(p.x, p.z)
	car.place(Vector3(p.x, y + car.wheels[0].radius + 0.4, p.z), car.heading())
	camera.snap()


func _physics_process(_delta: float) -> void:
	# a knock: the speed of the car changed by more than 4 m/s in one physics step
	if not car.freeze:
		var dv := (car.linear_velocity - _last_velocity).length()
		if dv > 4.0 and _last_velocity.length() > 2.0:
			RunLog.event("impact %.1f m/s at %.0f km/h" % [dv, _last_velocity.length() * 3.6])
		_last_velocity = car.linear_velocity
	if car.autopilot:
		return
	car.steer_input = Input.get_axis("steer_right", "steer_left")
	car.throttle_input = Input.get_action_strength("throttle")
	car.brake_input = Input.get_action_strength("brake")
	car.handbrake_input = Input.get_action_strength("handbrake")


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("menu"):
		RunLog.car = null
		leave.emit()
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
	if _shot_path != "" and _time >= _shot_at:
		var img := get_viewport().get_texture().get_image()
		img.save_png(_shot_path)
		print("shot: ", _shot_path)
		_shot_path = ""
		if Content.arg("quit") != "":
			get_tree().quit()
