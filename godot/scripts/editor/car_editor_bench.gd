class_name CarEditorBench
extends RefCounted
## The test bench of the car editor (car-editor.js, the Tests bar): the car on the floor of the editor with the physics of
## the game (Car, as a drive builds it), from the model and the settings as they are now, saved or not. "Drop car" lets it
## fall on its wheels from a height and a tilt, to see the suspension work; "Drive" drives it over the floor with the keys
## of the game (arrows or WASD, space the handbrake, the shift keys, R back to the start), the view following it and the
## engine heard; ↺ stops the test and shows the model again.

var ed: CarEditor
var car: Car = null
var driving := false
var _floor: StaticBody3D = null
var _audio: CarAudio = null
var _height := 1.0
var _tilt := 0.0


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
	if _audio != null:
		_audio.queue_free()
		_audio = null
	if car != null:
		car.queue_free()
		car = null
	for n in [ed.view.pivot, ed.view.helpers, ed.view.lib_preview, ed.view.extras]:
		(n as Node3D).visible = true


func frame(_delta: float) -> void:
	if car == null:
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
