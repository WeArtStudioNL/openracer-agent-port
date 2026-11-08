extends Node
## (a scene, for the autoloads: Godot --path godot res://tools/test_flames.tscn -- --user-dir=<tmp> [--shot=prefix] [--car=id])
## The flames at the exhaust (Flames.js): the car stands at the start of the desert and its exhaust bangs ten times;
## a camera beside and behind it looks at the tail pipes. The pictures of web/images/flames/ must be loaded and used,
## the flames must be visible, and the grey smoke comes after them. --shot=prefix saves prefix-flames.png (side) and
## prefix-behind.png (the chase camera: from behind a flame is a round puff).

var world: World
var _time := 0.0
var _bangs := 0
var _cam: Camera3D
var _shot := ""


func _ready() -> void:
	get_tree().create_timer(40.0).timeout.connect(get_tree().quit)
	world = World.new()
	add_child(world)
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	world.setup(car_id, "desert", {})
	world.set_physics_process(false)
	_shot = Content.arg("shot")
	process_mode = Node.PROCESS_MODE_ALWAYS


func _snap(name: String) -> void:
	if _shot == "" or DisplayServer.get_name() == "headless":
		return
	get_viewport().get_texture().get_image().save_png("%s-%s.png" % [_shot, name])
	print("shot: %s-%s.png" % [_shot, name])


func _flames() -> ExhaustFlames:
	for n in world.get_children():
		if n is ExhaustFlames and (n as ExhaustFlames).car == world.car:
			return n
	return null


func pipe_at() -> Vector3:
	return world.car.model_root.global_transform * ExhaustFlames.pipes_of(world.car.config)[0]["position"]


func _process(dt: float) -> void:
	_time += dt
	var car := world.car
	car.handbrake_input = 1.0          # (an automatic creeps; the brake held would put it in reverse)
	if _time < 1.5:
		return
	if _cam == null:
		var xf := car.global_transform
		var pipe := pipe_at()
		_cam = Camera3D.new()
		add_child(_cam)
		# (beside the first pipe and behind it, a little above it)
		var eye := pipe + xf.basis * Vector3(-2.2 if (xf.affine_inverse() * pipe).x < 0.0 else 2.2, 0.5, -2.6)
		_cam.look_at_from_position(eye, pipe + xf.basis * Vector3(0.0, 0.0, -0.4), Vector3.UP)
		_cam.fov = 50.0
		_cam.current = true
		print("flame pictures: %d (web/images/flames)" % ExhaustFlames.pictures().size())
	var next_at := 1.6 + _bangs * 0.25
	if _bangs < 10 and _time >= next_at:
		car.bang.emit({"strength": 1.3, "loud": 1.0, "flame": 1.5})
		_bangs += 1
		if _bangs == 6:
			await get_tree().process_frame
			var f := _flames()
			var shown := 0
			if f != null:
				for m in f.get_children():
					if m is MeshInstance3D and (m as MeshInstance3D).visible:
						shown += 1
			print("bang %d: %d flames in the air" % [_bangs, shown])
			# (the picture of the viewport is a frame or two behind)
			await get_tree().process_frame
			await get_tree().process_frame
			_snap("flames")
		if _bangs == 9:
			_cam.current = false
			world.camera.current = true
			await get_tree().process_frame
			await get_tree().process_frame
			await get_tree().process_frame
			_snap("behind")
	if _time > 5.0:
		get_tree().quit()
