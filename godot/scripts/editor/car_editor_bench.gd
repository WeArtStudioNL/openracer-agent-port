class_name CarEditorBench
extends RefCounted
## The test bench of the car editor (car-editor.js, the Tests bar): the car on the floor of the editor with the physics of
## the game (Car, as a drive builds it), from the model and the settings as they are now, saved or not. "Drop car" lets it
## fall on its wheels from a height and a tilt, to see the suspension work; "Drive" drives it over the floor with the keys
## of the game (arrows or WASD, space the handbrake, the shift keys, R back to the start), the view following it and the
## engine heard; ↺ stops the test and shows the model again. "Full test" (fullTest, runScript) does one thing after the
## other: a drop from 1 m at 5°; two seconds later the engine in neutral to the rev limiter and a second on it; a metre
## forwards and a metre back; the steering to the left lock and to the right lock; and at the end a wall 100 m ahead and
## full throttle into it (its own wall, not the crash test of the Soft body card), the camera with the car until the hit.

var ed: CarEditor
var car: Car = null
var driving := false
var test_run := {}                   # the Full test that runs: stage, t, limiter_t, brake, ...
var _floor: StaticBody3D = null
var _audio: CarAudio = null
var _height := 1.0
var _tilt := 0.0
var _wall: StaticBody3D = null


func _init(editor: CarEditor) -> void:
	ed = editor


## The model of the car as the bench loads it: the file that was picked, else the file of the car as saved.
func _model_file() -> String:
	if ed.main_file != "":
		for p in ed.model_files:
			if CarEditorIO.safe_file_name(p.get_file()) == ed.main_file:
				return p
	var f: Variant = Tuning.read(ed.existing, "model.file")
	return Content.path(str(f)) if f is String else ""


func _make_floor() -> void:
	if _floor != null:
		return
	_floor = StaticBody3D.new()
	_floor.name = "BenchFloor"
	_floor.set_meta("surface", "road")
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(800, 1, 800)
	shape.shape = box
	shape.position.y = -0.5
	_floor.add_child(shape)
	var pts := []
	var cols := []
	for i in 101:
		var x := -400.0 + 8.0 * i
		var c := Color("#3e4756") if i % 5 == 0 else Color("#2a313c")
		pts.append_array([Vector3(x, 0.002, -400), Vector3(x, 0.002, 400), Vector3(-400, 0.002, x), Vector3(400, 0.002, x)])
		cols.append_array([c, c, c, c])
	var grid := CarEditorView.lines(pts, cols)
	_floor.add_child(grid)
	ed.view.viewport.add_child(_floor)


## The car built from the form and dropped from a height (m) with a tilt (degrees).
func drop(height: float, tilt: float) -> void:
	_height = height
	_tilt = tilt
	stop()
	var file := _model_file()
	if file == "" or ed.model_root == null:
		ed.status("Load a model first.", "error")
		return
	var c := ed.build_config(ed.car_id if ed.car_id != "" else "bench", true)
	if c.has("_error"):
		ed.status(str(c["_error"]), "error")
		return
	var m: Dictionary = (ed.cfg.get("model", {}) as Dictionary).duplicate(true)
	m["type"] = "gltf"
	m["file"] = file
	c["model"] = m
	if not ed.overrides.is_empty():
		c["materials"] = ed.overrides.duplicate(true)
	_make_floor()
	_floor.position.y = ed.view.grid.position.y
	car = Car.new()
	car.setup("editor-bench", c)
	ed.view.viewport.add_child(car)
	_place()
	for n in [ed.view.pivot, ed.view.helpers, ed.view.lib_preview, ed.view.extras]:
		(n as Node3D).visible = false
	ed.status("Test: the car with the physics of the game. ↺ stops the test and goes back to the model.", "ok")


func _place() -> void:
	var r := ed.num("chassis.tire_diameter", 0.65) / 2.0
	car.place(Vector3(0, ed.view.grid.position.y + r + _height, 0), PI / 2.0)
	if _tilt != 0.0:
		var xf := car.global_transform
		xf.basis = Basis(Vector3.BACK, deg_to_rad(_tilt)) * xf.basis
		PhysicsServer3D.body_set_state(car.get_rid(), PhysicsServer3D.BODY_STATE_TRANSFORM, xf)
		car.global_transform = xf
	car.freeze = false


func reset() -> void:
	if car != null:
		var was := _height
		_height = 0.05
		_place()
		_height = was


func toggle_drive() -> void:
	if car == null:
		drop(0.05, 0.0)
	if car == null:
		return
	driving = not driving
	if driving:
		if ed.layers.selected != "":
			ed.layers.select(ed.layers.selected)
		_audio = CarAudio.new()
		_audio.setup(car)
		ed.add_child(_audio)
		ed.view.container.grab_focus()
		ed.status("Drive: arrows or WASD, space is the handbrake, the shift keys shift, R puts it back.", "ok")
	elif _audio != null:
		_audio.queue_free()
		_audio = null


func stop() -> void:
	driving = false
	test_run = {}
	_remove_wall()
	if _audio != null:
		_audio.queue_free()
		_audio = null
	if car != null:
		car.queue_free()
		car = null
	for n in [ed.view.pivot, ed.view.helpers, ed.view.lib_preview, ed.view.extras]:
		(n as Node3D).visible = true


func frame(delta: float) -> void:
	if car == null:
		return
	if not test_run.is_empty():
		_run_script(delta)
		return
	if not driving:
		car.throttle_input = 0.0
		car.brake_input = 0.0
		car.handbrake_input = 1.0
		return
	car.throttle_input = Input.get_action_strength("throttle")
	car.brake_input = Input.get_action_strength("brake")
	car.handbrake_input = Input.get_action_strength("handbrake")
	car.steer_input = Input.get_axis("steer_right", "steer_left")
	if Input.is_action_just_pressed("shift_up"):
		car.shift(true)
	if Input.is_action_just_pressed("shift_down"):
		car.shift(false)
	if Input.is_action_just_pressed("reset"):
		reset()
	# the view goes with the car
	var p := car.global_position
	var move := p - ed.view.target
	ed.view.target = p
	ed.view.camera.position += move


# ---- the Full test

func full_test() -> void:
	drop(1.0, 5.0)
	if car == null:
		return
	test_run = {"stage": "drop", "t": 0.0, "limiter_t": 0.0, "brake": 0.0, "view": [ed.view.target, ed.view.camera.position]}
	car.manual = true
	car.gear = 0
	_audio = CarAudio.new()
	_audio.setup(car)
	ed.add_child(_audio)
	ed.status("Full test: the drop…", "ok")


func _next(stage: String, message := "") -> void:
	test_run["stage"] = stage
	test_run["t"] = 0.0
	test_run["brake"] = 0.0
	if message != "":
		ed.status("Full test: " + message, "ok")


## Where the car is along its start line (m): the bench car stands at the origin looking along +z.
func _along() -> float:
	return car.global_position.z


func _run_script(dt: float) -> void:
	var sc := test_run
	sc["t"] += dt
	var t: float = sc["t"]
	car.manual = true
	car.handbrake_input = 0.0
	car.steer_direct = true
	var brake_gently := func():
		sc["brake"] = minf(0.35, float(sc["brake"]) + dt * 0.7)
		car.throttle_input = 0.0
		car.brake_input = sc["brake"] if car.gear >= 0 else 0.0
		if car.gear < 0:
			car.throttle_input = sc["brake"]      # (in reverse the pedals change places, Car._controls)
	match sc["stage"]:
		"drop":
			car.gear = 0
			car.throttle_input = 0.0
			car.brake_input = 1.0
			car.steer_input = 0.0
			if t > 2.0:
				sc["start_z"] = _along()
				_next("rev", "the engine to the rev limiter in neutral")
		"rev":
			# the throttle open until the engine is at the limiter, a second on it, then shut and a moment for it to fall
			car.gear = 0
			car.brake_input = 1.0
			var rpm := car.engine.rpm()
			if rpm >= car.engine.limiter_rpm - 250.0:
				sc["limiter_t"] += dt
			car.throttle_input = 1.0 if sc["limiter_t"] < 1.0 else 0.0
			if (sc["limiter_t"] >= 1.0 and rpm < car.engine.idle_rpm + 500.0) or t > 12.0:
				sc["start_z"] = _along()
				_next("forward", "a metre forwards")
		"forward":
			# gently away, off the throttle a little before the metre, a gentle brake to a stop
			car.gear = 1
			var d := _along() - float(sc["start_z"])
			if d < 0.5:
				car.throttle_input = minf(0.2, t * 0.2)
				car.brake_input = 0.0
			elif d < 0.7:
				car.throttle_input = 0.0
				car.brake_input = 0.0
			else:
				brake_gently.call()
				if absf(car.speed) < 0.03:
					_next("pause1")
			if t > 10.0:
				_next("pause1")
		"pause1":
			brake_gently.call()
			if t > 0.8:
				sc["start_z"] = _along()
				car.gear = -1
				_next("back", "a metre back")
		"back":
			car.gear = -1
			var d := float(sc["start_z"]) - _along()
			if d < 0.45:
				car.brake_input = minf(0.2, t * 0.2)      # (the brake pedal drives in reverse)
				car.throttle_input = 0.0
			elif d < 0.65:
				car.throttle_input = 0.0
				car.brake_input = 0.0
			else:
				brake_gently.call()
				if absf(car.speed) < 0.03:
					_next("steer", "the steering to both locks")
			if t > 10.0:
				_next("steer", "the steering to both locks")
		"steer":
			car.gear = 0
			car.throttle_input = 0.0
			car.brake_input = 1.0
			# to the left in a second, hold, to the right in two, hold, back to the middle in one
			var a := 0.0
			if t < 1.0:
				a = t
			elif t < 1.5:
				a = 1.0
			elif t < 3.5:
				a = 1.0 - (t - 1.5)
			elif t < 4.0:
				a = -1.0
			elif t < 5.0:
				a = -1.0 + (t - 4.0)
			car.steer_input = a
			sc["min_steer"] = minf(float(sc.get("min_steer", 0.0)), car.steer_angle)
			sc["max_steer"] = maxf(float(sc.get("max_steer", 0.0)), car.steer_angle)
			if t > 6.0:
				car.steer_input = 0.0
				_next("wall", "a wall ahead: full throttle")
		"wall":
			_wall_stage(dt)


## A wall 100 m ahead, and full throttle until the car hits it and is still; the camera follows until the hit.
func _wall_stage(dt: float) -> void:
	var sc := test_run
	if _wall == null:
		_add_wall(car.global_position.z + 100.0)
		sc["hit"] = false
		sc["still"] = 0.0
		sc["last"] = car.global_position
	car.manual = sc["hit"]           # (the gearbox shifts up on its own; after the hit it is held, it does not back off in reverse)
	car.gear = maxi(car.gear, 1)
	car.steer_direct = false
	var front := car.global_position.z + float((car.config.get("dimensions", {}) as Dictionary).get("length", 4.2)) / 2.0
	if not sc["hit"] and (front > _wall.global_position.z - 0.35 or (car.shell != null and car.shell.hit > 0.0)):
		sc["hit"] = true
		sc["hit_speed"] = car.speed
		ed.status("Full test: hit the wall at %d km/h." % roundi(absf(car.speed) * 3.6), "ok")
	car.throttle_input = 0.0 if sc["hit"] else 1.0
	car.brake_input = 1.0 if sc["hit"] else 0.0
	if sc["hit"]:
		car.steer_input = 0.0
	else:
		var fwd := car.global_transform.basis.z
		car.steer_input = clampf(-car.global_position.x * 0.3 - fwd.x * 2.0, -0.2, 0.2)
		var move := car.global_position - Vector3(sc["last"])
		ed.view.target += move
		ed.view.camera.position += move
	sc["last"] = car.global_position
	sc["still"] = float(sc["still"]) + dt if sc["hit"] and absf(car.speed) < 0.3 else 0.0
	if float(sc["still"]) > 1.5 or float(sc["t"]) > 60.0:
		RunLog.event("car editor full test: done, hit at %d km/h" % roundi(absf(float(sc.get("hit_speed", 0.0))) * 3.6))
		# (the view where it was before the test)
		ed.view.target = sc["view"][0]
		ed.view.camera.position = sc["view"][1]
		ed.view.camera.look_at(ed.view.target)
		stop()
		ed._hook_call("bench_stopped")
		ed.status("Full test done.", "ok")


func _add_wall(z: float) -> void:
	_remove_wall()
	var size := Vector3(80, 6, 0.3)
	_wall = StaticBody3D.new()
	_wall.name = "FullTestWall"
	_wall.set_meta("surface", "wall")
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	col.shape = shape
	_wall.add_child(col)
	var mesh := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mesh.mesh = bm
	var see := StandardMaterial3D.new()
	see.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	see.albedo_color = Color(0.45, 0.5, 0.56, 0.3)
	see.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	mesh.material_override = see
	_wall.add_child(mesh)
	_wall.position = Vector3(0, ed.view.grid.position.y + size.y / 2.0, z + size.z / 2.0)
	ed.view.viewport.add_child(_wall)
	if car.shell != null:
		var grid := WallGrid.new()
		grid.add_body(_wall, "wall")
		car.shell.use_walls(grid)


func _remove_wall() -> void:
	if _wall != null:
		_wall.queue_free()
		_wall = null
