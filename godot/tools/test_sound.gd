extends Node
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_sound.tscn -- [--car=openracer-muscle])
## The sounds of the road and of a hit (EngineSound.js setGround, impact; CarAudio): the car drives on the sand of the
## desert (the noise of the ground must play and be heard), then it is dropped from 2 m onto the road (a thud of a
## landing) and driven over the edge of the road at speed. Headless nothing is heard: what plays is logged.

var world: World
var _time := 0.0
var _phase := "wait"
var _peak_ground := 0.0


func _ready() -> void:
	get_tree().create_timer(90.0).timeout.connect(get_tree().quit)
	world = World.new()
	add_child(world)
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	world.setup(car_id, "desert", {})
	world.set_physics_process(false)          # (the inputs are the test's, not the keys')
	process_mode = Node.PROCESS_MODE_ALWAYS


func _place(p: Vector3, heading: float, up: float) -> void:
	world.car.place(Vector3(p.x, world.track.ground_at(p.x, p.z) + world.car.wheels[0].radius + up, p.z), heading)
	world.car.freeze = false
	world.camera.snap()


func _players() -> String:
	var a := world.audio
	var out := []
	for kind: String in a.ground_players:
		var p: AudioStreamPlayer = a.ground_players[kind]
		out.append("%s %s %.1f dB pitch %.2f" % [kind, "playing" if p.playing else "stopped", p.volume_db, p.pitch_scale])
	if a.thud_player != null:
		out.append("thud %s" % ("playing" if a.thud_player.playing else "stopped"))
	return ", ".join(out)


func _physics_process(dt: float) -> void:
	_time += dt
	var car := world.car
	var a := world.audio
	match _phase:
		"wait":
			if _time > 1.0:
				_place(Vector3(285.91 + 30.0, 0.0, 393.68 + 30.0), 1.2, 0.2)
				_phase = "sand"
				_time = 0.0
		"sand":
			car.throttle_input = 1.0 if car.speed < 50.0 / 3.6 else 0.3
			car.steer_input = 0.0
			_peak_ground = maxf(_peak_ground, a.ground_level())
			if _time > 4.0:
				var surfaces := []
				for w in car.wheels:
					surfaces.append(w.surface)
				print("on %s at %.1f km/h: ground sound '%s', level %.3f (peak %.3f); %s" % [str(surfaces), car.speed * 3.6,
					a.ground_kind, a.ground_level(), _peak_ground, _players()])
				var s: Dictionary = world.track.start
				car.throttle_input = 0.0
				_place(Vector3(float(s["x"]), 0.0, float(s["z"])), float(s.get("heading", 0)), 2.0)
				_phase = "drop"
				_time = 0.0
		"drop":
			if _time > 0.5 and _time - dt <= 0.5:
				print("on the road: ground sound '%s', level %.3f; %s" % [a.ground_kind, a.ground_level(), _players()])
			if _time > 2.0:
				var thuds := a.sound_log.filter(func(e: Array) -> bool: return e[1] == "thud")
				print("dropped from 2 m: %d thuds %s" % [thuds.size(), str(thuds.map(func(e: Array) -> String: return "%.2f" % e[2]))])
				print("the log: %s" % str(a.sound_log.map(func(e: Array) -> String: return "%s %.2f" % [e[1], e[2]])))
				get_tree().quit()
