extends Node
## (a scene, for the autoloads: Godot --fixed-fps 60 --path godot res://tools/test_smoke.tscn -- --user-dir=<tmp> [--shot=prefix])
## The smoke of the tyres and the car (Smoke.js): a burnout at the start of the desert (the plume and the small puffs
## at the tyres), then the car is put 40 m back and driven through the plume at 50 km/h: it must take wisps of it
## along. Without --headless, --shot=prefix saves prefix-burnout.png, -through.png and -after.png.

var world: World
var _time := 0.0
var _phase := "wait"
var _shot := ""
var _start := Vector3.ZERO
var _heading := 0.0
var _first_wisp := -1.0


func _ready() -> void:
	get_tree().create_timer(60.0).timeout.connect(get_tree().quit)
	world = World.new()
	add_child(world)
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	world.setup(car_id, "desert", {})
	world.set_physics_process(false)
	Settings.set_value("tc", false)
	_shot = Content.arg("shot")
	process_mode = Node.PROCESS_MODE_ALWAYS


func _snap(name: String) -> void:
	if _shot == "" or DisplayServer.get_name() == "headless":
		return
	get_viewport().get_texture().get_image().save_png("%s-%s.png" % [_shot, name])
	print("shot: %s-%s.png" % [_shot, name])


func _place(p: Vector3, heading: float) -> void:
	world.car.place(Vector3(p.x, world.track.ground_at(p.x, p.z) + world.car.wheels[0].radius + 0.1, p.z), heading)
	world.car.freeze = false
	world.camera.snap()


func _physics_process(dt: float) -> void:
	_time += dt
	var car := world.car
	var fx := world.effects
	match _phase:
		"wait":
			if _time > 1.0:
				var s: Dictionary = world.track.start
				_start = Vector3(float(s["x"]), 0.0, float(s["z"]))
				_heading = float(s.get("heading", 0))
				_place(_start, _heading)
				_phase = "burnout"
				_time = 0.0
		"burnout":
			# (full throttle from a standstill on hot tyres: the rear wheels spin)
			car.throttle_input = 1.0
			car.brake_input = 0.0
			car.handbrake_input = 0.0
			for w in car.wheels:
				if not w.front:
					w.surf_t = maxf(w.surf_t, 250.0)      # (hot: a tyre smokes from about 220 C)
			if _time > 1.5 and _time - dt <= 1.5:
				var smokes := []
				for w in car.wheels:
					smokes.append("%.2f" % w.smoke)
				print("burnout: the smoke of the wheels %s" % str(smokes))
				_snap("burnout")
			if _time > 4.0:
				var fwd := car.global_transform.basis.z
				_place(_start - Vector3(fwd.x, 0.0, fwd.z).normalized() * 40.0, _heading)
				if Content.arg("red-wisps") != "":
					# (to see them: the wisps red)
					(fx.wisps.process_material as ParticleProcessMaterial).color = Color(1, 0, 0)
				_phase = "through"
				_time = 0.0
		"through":
			car.throttle_input = 1.0 if car.speed < 50.0 / 3.6 else 0.1
			car.steer_input = 0.0
			if fx.wisps_made > 0 and _first_wisp < 0.0:
				_first_wisp = _time
			if _first_wisp >= 0.0 and _time > _first_wisp + 0.4 and _time - dt <= _first_wisp + 0.4:
				_snap("through")
			if _time > 6.0:
				print("through the plume at %.1f km/h: %d wisps taken along" % [car.speed * 3.6, fx.wisps_made])
				_snap("after")
				get_tree().quit()
