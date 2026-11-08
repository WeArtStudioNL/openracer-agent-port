extends "res://scripts/node_grabber.gd"
## The node grabber of the tests of the car editor (a toggle in the test bar; node_grabber.gd does the work). Turning it on
## starts the test when none is running; it goes off with the test.

var ed: CarEditor
var button: Button = null           # (the toggle of the test bar)


func _init(editor: CarEditor) -> void:
	super()
	ed = editor
	on = false
	layer = CarEditorView.MARKER_LAYER
	car_of = func() -> Car: return ed.bench.car
	camera_of = func() -> Camera3D: return ed.view.camera
	holder_of = func() -> Node: return ed.view.viewport


func set_strength(v: float) -> void:
	strength = clampf(v, 100.0, 200000.0)
	VideoPrefs.set_value("debug", "grab_strength", strength)


func set_on(want: bool) -> void:
	if want and (ed.bench.car == null or ed.bench.parked):
		ed.bench.drop(0.05, 0.0)
		if ed.bench.car == null:
			want = false
	on = want
	if button != null:
		button.set_pressed_no_signal(on)
	if not on:
		release()
		clear()
	elif not ed.view.container.mouse_exited.is_connected(leave):
		ed.view.container.mouse_exited.connect(leave)


func frame() -> void:
	if not on:
		return
	if ed.bench.car == null or ed.bench.parked:
		set_on(false)
		return
	super()
