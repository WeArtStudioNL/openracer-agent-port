extends Node3D
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_shell_car.tscn -- --car=openracer-muscle
## [--tyres=shell|simple] [--set=sim_tyre_detail:low])
## The road test of tools/physics-bench.js of the browser game, on a flat floor: the car at rest (its tyres, the ride
## height), 0 to 100 km/h on full throttle (no traction control), the brakes from 100 km/h (with ABS), and the skidpad
## (the wheels turned for a circle of about 50 m, the speed raised slowly until the car does not follow: the most
## lateral acceleration it held). With the shell tyre (ShellTyres, as the browser game's player's car) or the simple
## one. The figures can be held against `node tools/physics-bench.js <car>`.

const KMH := 1.0 / 3.6
const MPH := 0.44704

var car: Car
var _cfg: Dictionary = {}
var _id := ""
var _phase := ""
var _t := 0.0
var _x0 := Vector3.ZERO
var _t60 := -1.0
var _t100 := -1.0
var _best_ay := 0.0
var _best_speed := 0.0
var _ay := 0.0
var _rest := {}
var _steps_us := 0
var _steps := 0


func _ready() -> void:
	get_tree().create_timer(400.0).timeout.connect(get_tree().quit)
	_id = Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	add_to_group("track")
	var floor_body := StaticBody3D.new()
	var floor_col := CollisionShape3D.new()
	var floor_shape := BoxShape3D.new()
	floor_shape.size = Vector3(800, 1, 800)
	floor_col.shape = floor_shape
	floor_col.position = Vector3(0, -0.5, 0)
	floor_body.add_child(floor_col)
	add_child(floor_body)
	var cfg: Variant = Content.load_json("cars/%s/car.json" % _id)
	_cfg = cfg if cfg is Dictionary else {}
	_new_car()
	_phase = "rest"
	print("road test: %s, tyres %s (native %s), tyre detail %s" % [_id, "shell" if ShellTyres.wanted(car) else "simple", ShellTyres.available(),
		Settings.get_value("sim_tyre_detail")])


func _new_car(z := -380.0) -> void:
	if car != null:
		car.queue_free()
	car = Car.new()
	car.player_tyres = true
	car.setup(_id, _cfg)
	add_child(car)
	car.place(Vector3(0, car.wheels[0].radius + 0.05, z), PI / 2.0)
	car.freeze = false
	car.steer_direct = true
	_t = 0.0


func _physics_process(dt: float) -> void:
	if car == null or not car.is_inside_tree():
		return
	_t += dt
	var v := car.linear_velocity
	var u := car.speed
	_ay = lerpf(_ay, u * car.angular_velocity.dot(car.global_transform.basis.y), minf(1.0, dt / 1.0))
	match _phase:
		"rest":
			car.throttle_input = 0.0
			car.brake_input = 0.0
			if _t > 3.0:
				var ride := car.global_position.y
				var loads := []
				for w in car.wheels:
					loads.append(roundi(w.load))
				var sag := ""
				if car.shell_tyres != null:
					var r: Dictionary = car.shell_tyres.results[0]
					sag = "  tyre in %.1f mm, patch %.0f mm, %d nodes on the road, %d substeps" % [float(r.get("sag", 0)) * 1000.0,
						float(r.get("patch", 0)) * 1000.0, int(r.get("contacts", 0)), int(r.get("substeps", 0))]
				print("  at rest: the origin %.3f m above the floor, loads %s (weight %d N), spring lengths %.3f %.3f %.3f %.3f%s" % [ride, loads,
					roundi(car.mass * Car.G), car.wheels[0].length, car.wheels[1].length, car.wheels[2].length, car.wheels[3].length, sag])
				_rest = {"ride": ride}
				_phase = "accelerate"
				if Content.arg("shot") != "":
					_phase = "picture"
					_picture()
				_t = 0.0
		"accelerate":
			car.throttle_input = 1.0
			var t0 := Time.get_ticks_usec()
			if _t60 < 0.0 and u >= 60.0 * MPH:
				_t60 = _t
			if _t100 < 0.0 and u >= 100.0 * KMH:
				_t100 = _t
			_steps_us += Time.get_ticks_usec() - t0
			if (_t60 >= 0.0 and _t100 >= 0.0) or _t > 40.0:
				print("  0-60 mph %.2f s, 0-100 km/h %.2f s" % [_t60, _t100])
				_phase = "to brake"
		"to brake":
			car.throttle_input = 1.0
			if u >= 100.0 * KMH or _t > 60.0:
				_x0 = car.global_position
				_phase = "brake"
				_t = 0.0
		"brake":
			car.throttle_input = 0.0
			car.brake_input = 1.0
			if u < 0.3 or _t > 20.0:
				print("  100-0 km/h %.1f m (%.1f s)" % [(car.global_position - _x0).length(), _t])
				car.brake_input = 0.0
				_new_car(0.0)
				_phase = "skidpad"
		"skidpad":
			car.steer_input = (car.wheelbase / 50.0) / car.max_steer
			var target := 5.0 + _t * 0.25
			var err := target - u
			car.throttle_input = minf(1.0, err * 0.5) if err > 0.0 else 0.0
			car.brake_input = 0.0 if err > 0.0 else minf(1.0, -err * 0.3)
			var lateral := v.dot(car.global_transform.basis.x)
			var slip := absf(atan2(lateral, u))
			if Content.arg("verbose") != "" and fmod(_t, 2.0) < dt:
				print("    t %.0f  %.1f km/h  ay %.2f g  slip %.1f deg  steer %.2f deg  gear %d  pos %s" % [_t, u / KMH, _ay / Car.G, rad_to_deg(slip),
					rad_to_deg(car.steer_angle), car.gear, car.global_position.snapped(Vector3.ONE * 0.1)])
			if slip < 0.12 and absf(_ay) > _best_ay and _t > 3.0:
				_best_ay = absf(_ay)
				_best_speed = u
			if _t > 5.0 and (slip > 0.2 or absf(_ay) < _best_ay * 0.7) or _t > 240.0:
				print("  skidpad %.2f g at %.0f km/h (ended at %.0f km/h: slip angle %.1f deg, %.2f g)" % [_best_ay / Car.G, _best_speed / KMH, u / KMH,
					rad_to_deg(slip), absf(_ay) / Car.G])
				get_tree().quit()


## (--shot=file.png, not headless: a picture of the front left wheel from the side, at rest, the deformation of the tread
## drawn --deform-gain times as deep (TyreDeform))
func _picture() -> void:
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.9, 0.5, 0)
	add_child(sun)
	var we := WorldEnvironment.new()
	we.environment = Environment.new()
	we.environment.background_mode = Environment.BG_COLOR
	we.environment.background_color = Color(0.55, 0.65, 0.8)
	we.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	we.environment.ambient_light_color = Color(0.7, 0.7, 0.7)
	add_child(we)
	var floor_mesh := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(40, 40)
	floor_mesh.mesh = pm
	floor_mesh.position = car.global_position * Vector3(1, 0, 1)
	add_child(floor_mesh)
	if car.shell_tyres != null and Content.arg("deform-gain") != "":
		for d: TyreDeform in car.shell_tyres._deform:
			if d != null:
				d.gain = float(Content.arg("deform-gain"))
	var w := car.wheels[0]
	var xf := car.global_transform
	var hub := xf * (w.hub + Vector3.UP * (car.susp_length - w.length))
	var cam := Camera3D.new()
	add_child(cam)
	cam.fov = 30.0
	cam.look_at_from_position(hub + xf.basis.x * 2.2 + Vector3(0, 0.05, 0), hub)
	cam.make_current()
	await get_tree().create_timer(1.0).timeout
	get_viewport().get_texture().get_image().save_png(Content.arg("shot"))
	print("shot: ", Content.arg("shot"))
	get_tree().quit()
