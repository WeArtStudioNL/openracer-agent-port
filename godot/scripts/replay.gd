class_name Replay
extends Node
## The replay (web/js/Replay.js): from the start everything is recorded, all the cars (the player and the
## opponents), 30 times a second: where the body is and how it is turned, the steering, the engine, and for every
## wheel how far its spring is out, how it is steered and how far it has turned. The last half hour is kept.
##
## Esc, Replay: the game stops where it is and the recording is played back through the same code that draws the
## cars of the game. A bar at the bottom has a slider over the whole recording, play and pause, jumps of ten
## seconds, the speed (0.1x to 5x), the camera and the car the camera is on; Exit (or Esc) goes back to the game,
## which goes on where it was left. Keys: Enter play/pause, left and right one frame (held: they keep stepping), up
## and down one second, Home and End, T the camera, Tab the next car, H hides the bar.

const RATE := 30.0
const MAX_SECONDS := 1800.0
const CAR_FIELDS := 11              # position 3, rotation 4, steering, rpm, throttle, gear
const WHEEL_FIELDS := 3             # spring length, steering, turn
const STRIDE := CAR_FIELDS + 4 * WHEEL_FIELDS
const SPEEDS := [0.1, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0]
const JUMP := 15.0                  # m between two samples: the car was put back (no sliding in between)

var world: Node
var cars: Array[Car] = []
var samples := PackedFloat32Array()
var count := 0                      # samples kept
var playing := false                # the replay is on the screen
var running := false                # it plays (not paused)
var time := 0.0                     # s from the first sample kept
var speed := 1.0
var _record_in := 0.0
var _saved: Array = []              # the cars as the game left them
var _focus := 0
var _ui: CanvasLayer
var _bar: PanelContainer
var _slider: HSlider
var _time_label: Label
var _play_button: Button
var _speed_button: OptionButton
var _camera_was: Car
var _sliding := false
var _step_held := 0.0


func setup(w: Node, list: Array) -> void:
	world = w
	name = "Replay"
	for c in list:
		if c is Car and not c.is_ghost:
			cars.append(c)
	process_mode = Node.PROCESS_MODE_ALWAYS


func duration() -> float:
	return maxf(0.0, (count - 1) / RATE)


func _physics_process(dt: float) -> void:
	if playing or get_tree().paused or cars.is_empty():
		return
	_record_in -= dt
	if _record_in > 0.0:
		return
	_record_in += 1.0 / RATE
	var row := PackedFloat32Array()
	row.resize(cars.size() * STRIDE)
	for n in cars.size():
		var c := cars[n]
		var o := n * STRIDE
		if not is_instance_valid(c):
			continue
		var xf := c.global_transform
		var q := xf.basis.get_rotation_quaternion()
		row[o] = xf.origin.x
		row[o + 1] = xf.origin.y
		row[o + 2] = xf.origin.z
		row[o + 3] = q.x
		row[o + 4] = q.y
		row[o + 5] = q.z
		row[o + 6] = q.w
		row[o + 7] = c.steer_angle
		row[o + 8] = c.engine.omega
		row[o + 9] = c.engine.throttle_used
		row[o + 10] = c.gear
		for k in 4:
			var w := c.wheels[k]
			var p := o + CAR_FIELDS + k * WHEEL_FIELDS
			row[p] = w.length
			row[p + 1] = w.steer
			row[p + 2] = w.spin
	samples.append_array(row)
	count += 1
	var most := int(MAX_SECONDS * RATE)
	if count > most + int(RATE * 60.0):
		# (the oldest minute goes at once: not a copy every sample)
		var drop := count - most
		samples = samples.slice(drop * cars.size() * STRIDE)
		count -= drop


## Starts the replay at the end of the recording (the game is paused).
func play() -> void:
	if playing or count < 2:
		return
	playing = true
	running = false
	time = duration()
	_saved.clear()
	for c in cars:
		if not is_instance_valid(c):
			_saved.append(null)
			continue
		var ws: Array = []
		for w in c.wheels:
			ws.append([w.length, w.steer, w.spin, w.omega])
		_saved.append({"xf": c.global_transform, "v": c.linear_velocity, "av": c.angular_velocity, "omega": c.engine.omega,
			"wheels": ws, "mode": c.process_mode, "interp": c.physics_interpolation_mode})
		c.process_mode = Node.PROCESS_MODE_ALWAYS
		c.set_physics_process(false)
		c.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	var cam := _camera()
	if cam != null:
		_camera_was = cam.car
		cam.process_mode = Node.PROCESS_MODE_ALWAYS
		_focus = maxi(0, cars.find(cam.car))
	_set_hud(false)
	_build_ui()
	_show(time)
	RunLog.event("replay: %.1f s of recording" % duration())


## Back to the game, where it was left.
func stop() -> void:
	if not playing:
		return
	playing = false
	for n in cars.size():
		var c := cars[n]
		var s: Variant = _saved[n] if n < _saved.size() else null
		if not is_instance_valid(c) or s == null:
			continue
		c.global_transform = s["xf"]
		c.linear_velocity = s["v"]
		c.angular_velocity = s["av"]
		c.engine.omega = s["omega"]
		for k in 4:
			var ws: Array = s["wheels"][k]
			c.wheels[k].length = ws[0]
			c.wheels[k].steer = ws[1]
			c.wheels[k].spin = ws[2]
			c.wheels[k].omega = ws[3]
		c.process_mode = s["mode"]
		c.set_physics_process(true)
		c.physics_interpolation_mode = s["interp"]
		c.reset_physics_interpolation()
	var cam := _camera()
	if cam != null:
		cam.car = _camera_was
		cam.process_mode = Node.PROCESS_MODE_INHERIT
	_set_hud(true)
	if _ui != null:
		_ui.queue_free()
		_ui = null
	RunLog.event("replay closed")


func _camera() -> ChaseCamera:
	return world.get("camera") as ChaseCamera if world != null else null


func _set_hud(on: bool) -> void:
	var hud: Variant = world.get("hud") if world != null else null
	if hud is CanvasLayer:
		(hud as CanvasLayer).visible = on
	elif hud is CanvasItem:
		(hud as CanvasItem).visible = on


func _process(delta: float) -> void:
	if not playing:
		return
	if running:
		time += delta * speed
		if time >= duration():
			time = duration()
			running = false
	# (a held arrow keeps stepping, frame after frame)
	if Input.is_key_pressed(KEY_LEFT) or Input.is_key_pressed(KEY_RIGHT):
		_step_held += delta
		if _step_held > 0.35:
			time = clampf(time + (1.0 if Input.is_key_pressed(KEY_RIGHT) else -1.0) / RATE, 0.0, duration())
	else:
		_step_held = 0.0
	_show(time)
	if _slider != null and not _sliding:
		_slider.set_value_no_signal(time)
	if _time_label != null:
		_time_label.text = "%s / %s" % [LapTimer.format_time(time), LapTimer.format_time(duration())]
	if _play_button != null:
		_play_button.text = "Pause" if running else "Play"


## Puts the cars where they were at time t (between two samples: in between).
func _show(t: float) -> void:
	var f := clampf(t * RATE, 0.0, count - 1.0)
	var i := mini(int(f), count - 2)
	var u := f - i
	var cam := _camera()
	for n in cars.size():
		var c := cars[n]
		if not is_instance_valid(c):
			continue
		var a := i * cars.size() * STRIDE + n * STRIDE
		var b := a + cars.size() * STRIDE
		var pa := Vector3(samples[a], samples[a + 1], samples[a + 2])
		var pb := Vector3(samples[b], samples[b + 1], samples[b + 2])
		var k := u if pa.distance_to(pb) < JUMP else (0.0 if u < 0.5 else 1.0)
		var qa := Quaternion(samples[a + 3], samples[a + 4], samples[a + 5], samples[a + 6]).normalized()
		var qb := Quaternion(samples[b + 3], samples[b + 4], samples[b + 5], samples[b + 6]).normalized()
		c.global_transform = Transform3D(Basis(qa.slerp(qb, k)), pa.lerp(pb, k))
		c.steer_angle = lerpf(samples[a + 7], samples[b + 7], k)
		c.engine.omega = lerpf(samples[a + 8], samples[b + 8], k)
		c.engine.throttle_used = lerpf(samples[a + 9], samples[b + 9], k)
		c.gear = int(samples[a + 10])
		for w in 4:
			var p := CAR_FIELDS + w * WHEEL_FIELDS
			var wh := c.wheels[w]
			wh.length = lerpf(samples[a + p], samples[b + p], k)
			wh.steer = lerpf(samples[a + p + 1], samples[b + p + 1], k)
			wh.spin = lerp_angle(samples[a + p + 2], samples[b + p + 2], k)
		c.linear_velocity = (pb - pa) * RATE
	if cam != null and _focus < cars.size() and is_instance_valid(cars[_focus]):
		cam.car = cars[_focus]


func _input(event: InputEvent) -> void:
	if not playing or not (event is InputEventKey) or not event.pressed:
		return
	var handled := true
	match event.physical_keycode:
		KEY_ESCAPE:
			_exit()
		KEY_ENTER, KEY_KP_ENTER, KEY_SPACE:
			_toggle()
		KEY_LEFT:
			_jump(-1.0 / RATE)
		KEY_RIGHT:
			_jump(1.0 / RATE)
		KEY_UP:
			_jump(1.0)
		KEY_DOWN:
			_jump(-1.0)
		KEY_HOME:
			_jump(-time)
		KEY_END:
			_jump(duration() - time)
		KEY_T:
			_next_camera()
		KEY_TAB:
			_next_car()
		KEY_H:
			if _bar != null:
				_bar.visible = not _bar.visible
		_:
			handled = false
	if handled:
		get_viewport().set_input_as_handled()


func _toggle() -> void:
	if not running and time >= duration() - 0.01:
		time = 0.0
	running = not running


func _jump(dt: float) -> void:
	time = clampf(time + dt, 0.0, duration())
	running = running and time < duration()


func _next_camera() -> void:
	var cam := _camera()
	if cam != null and cam.has_method("next_mode"):
		cam.next_mode()


func _next_car() -> void:
	if cars.size() > 1:
		_focus = (_focus + 1) % cars.size()


func _exit() -> void:
	stop()
	if world != null and world.has_method("resume"):
		world.resume()


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 12
	_ui.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(_ui)
	_bar = PanelContainer.new()
	_bar.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_bar.offset_top = -96
	_ui.add_child(_bar)
	var box := VBoxContainer.new()
	_bar.add_child(box)
	_slider = HSlider.new()
	_slider.min_value = 0.0
	_slider.max_value = duration()
	_slider.step = 1.0 / RATE
	_slider.value = time
	_slider.drag_started.connect(func(): _sliding = true)
	_slider.drag_ended.connect(func(_c: bool): _sliding = false)
	_slider.value_changed.connect(func(v: float):
		time = v
		running = false)
	box.add_child(_slider)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	box.add_child(row)
	_time_label = Label.new()
	_time_label.custom_minimum_size.x = 190
	row.add_child(_time_label)
	for item in [["|<", func(): _jump(-time)], ["-10 s", func(): _jump(-10.0)], ["Play", _toggle], ["+10 s", func(): _jump(10.0)],
			[">|", func(): _jump(duration() - time)]]:
		var b := Button.new()
		b.text = item[0]
		b.custom_minimum_size = Vector2(64, 36)
		b.pressed.connect(item[1])
		b.focus_mode = Control.FOCUS_NONE
		row.add_child(b)
		if item[0] == "Play":
			_play_button = b
	_speed_button = OptionButton.new()
	_speed_button.focus_mode = Control.FOCUS_NONE
	for s in SPEEDS:
		_speed_button.add_item("%sx" % str(s))
	_speed_button.select(SPEEDS.find(1.0))
	_speed_button.item_selected.connect(func(i: int): speed = SPEEDS[i])
	row.add_child(_speed_button)
	for item in [["Camera (T)", _next_camera], ["Next car (Tab)", _next_car], ["Exit (Esc)", _exit]]:
		var b := Button.new()
		b.text = item[0]
		b.custom_minimum_size.y = 36
		b.focus_mode = Control.FOCUS_NONE
		b.pressed.connect(item[1])
		row.add_child(b)
