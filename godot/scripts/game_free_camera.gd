class_name GameFreeCamera
extends Camera3D
## The fourth camera of the game (web/js/FreeCam.js; the camera switcher C: follow, cockpit, bonnet, free). It is not
## tied to the car: W A S D move it (W the way it looks, also up and down with the look), Space and Z up, Alt and X
## down, the mouse looks around (click the scene: the pointer is caught, Escape lets it go), Q and E roll the picture,
## 3 and 4 slower and faster (a hundredth to three times), 7 and 8 the smoothing of the mouse look, [ and ] the field
## of view. These keys do not drive the car while this camera is on (they are taken from the controls); the arrows
## still do. P looks at the car (it keeps its place and turns to the car), O goes with the car (its place against the
## car, its own direction), I fixes it to the car as a part of it (its place and turn go with the car; the keys move
## it in the frame of the car). Fixed or moving with the car it does not go through a wall: rays from the car to it
## bring it in front of what is in the way. The camera is remembered per car (VideoPrefs, freecam/<car>): its place,
## its look, the field of view, the speed, the smoothing and the toggles; the next time it is back where it was.
## The panel at the top right (with the HUD) has the toggles, a slider for every setting and Record (Take).

signal left_camera

const BASE_SPEED := 12.0
const VERTICAL_SPEED := 8.0
const FOV_RATE := 40.0
const SPEED_RATE := 1.2
const LOOK_SENSITIVITY := 0.0022
const MOVE_RANGE := [0.5, 30.0]
const ROLL_RANGE := [0.1, 3.0]
const TILT_RANGE := [1.0, 40.0]
const LOOK_RANGE := [1.0, 60.0]
const TAKEN := [KEY_W, KEY_A, KEY_S, KEY_D, KEY_Z, KEY_SPACE, KEY_X, KEY_ALT, KEY_3, KEY_4, KEY_7, KEY_8, KEY_Q, KEY_E,
	KEY_BRACKETLEFT, KEY_BRACKETRIGHT, KEY_I, KEY_P, KEY_O]

var active := false
var car: Car
var follow := false
var aim := true
var fixed := false
var speed := 1.0
var move_smooth := 6.0
var roll_rate := 0.9
var roll_smooth := 8.0
var look_rate := 20.0
var pos := Vector3.ZERO
var vel := Vector3.ZERO
var yaw := 0.0
var pitch := 0.0
var roll := 0.0
var roll_t := 0.0
var fov_now := 60.0
var take: Node = null               # (the record button of the panel)
var _last_car := Vector3.ZERO
var _look := Vector2.ZERO
var _place_behind := false
var _fix_when_placed := false
var _clear := 1.0
var _save_in := 2.0
var _retake_in := 0.0
var _panel: CanvasLayer
var _box: PanelContainer
var _sliders: Array = []
var _buttons := {}
var _sync_in := 0.0


func _ready() -> void:
	name = "FreeCamera"
	far = 4000.0
	near = 0.03
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	_build_panel()


## The camera goes free: where it was the last time for this car, or 10 m above the camera it came from.
func enter(from: Camera3D, c: Car) -> void:
	active = true
	car = c
	fixed = false
	vel = Vector3.ZERO
	_last_car = c.global_position
	_place_behind = false
	if not _restore(c.global_position):
		pos = from.global_position + Vector3.UP * 10.0
		var e := from.global_transform.basis.get_euler()
		yaw = e.y
		pitch = e.x
		roll = 0.0
		roll_t = 0.0
		fov_now = from.fov
		_place_behind = from.global_position.distance_to(c.global_position) > 60.0
		if _place_behind:
			_fix_when_placed = true
		else:
			_set_fixed(true)
	_take_keys()
	make_current()
	_panel.visible = _hud_on()
	_refresh()
	RunLog.event("camera FREE")


func leave() -> void:
	if active:
		_save()
	active = false
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_panel.visible = false
	Controls.rebind()


## The keys of this camera are taken from the actions of the game while it is on (they do not drive the car).
func _take_keys() -> void:
	for action in InputMap.get_actions():
		if str(action).begins_with("ui_"):
			continue
		for ev in InputMap.action_get_events(action):
			if ev is InputEventKey and (ev as InputEventKey).physical_keycode in TAKEN:
				InputMap.action_erase_event(action, ev)


func _hud_on() -> bool:
	var hud: Variant = get_parent().get("hud") if get_parent() != null else null
	return hud == null or hud.visible


func _key(code: Key) -> float:
	return 1.0 if Input.is_physical_key_pressed(code) else 0.0


func _input(event: InputEvent) -> void:
	if not active or get_tree().paused:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and not aim:
		_look += event.relative * LOOK_SENSITIVITY
	elif event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		get_viewport().set_input_as_handled()
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_P:
				toggle_aim()
			KEY_O:
				toggle_follow()
			KEY_I:
				toggle_fixed()


func _unhandled_input(event: InputEvent) -> void:
	if active and not aim and not get_tree().paused and event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func toggle_aim() -> void:
	aim = not aim
	_refresh()
	_save()


func toggle_follow() -> void:
	follow = not follow
	if follow and fixed:
		_set_fixed(false)
	_refresh()
	_save()


func toggle_fixed() -> void:
	_set_fixed(not fixed)
	_refresh()
	_save()


## Fixed to the car: the place and the look go into the frame of the car (and back out to the world).
func _set_fixed(on: bool) -> void:
	if on == fixed or car == null:
		return
	var bxf := car.global_transform
	var bq := bxf.basis.get_rotation_quaternion()
	var q := Basis.from_euler(Vector3(pitch, yaw, roll)).get_rotation_quaternion()
	if fixed:
		pos = bxf.origin + bq * pos
		vel = bq * vel
		q = bq * q
	else:
		pos = bq.inverse() * (pos - bxf.origin)
		vel = bq.inverse() * vel
		q = bq.inverse() * q
		follow = false
	var e := Basis(q).get_euler()
	pitch = e.x
	yaw = e.y
	roll = e.z
	roll_t = e.z
	fixed = on


func _process(delta: float) -> void:
	if not active or car == null or not is_instance_valid(car):
		return
	if get_tree().paused:
		return
	delta = minf(delta, 0.1)
	_retake_in -= delta
	if _retake_in <= 0.0:
		_retake_in = 0.5
		_take_keys()
	var cp := car.get_global_transform_interpolated().origin
	if _place_behind:
		_place_behind = false
		var h := car.heading() if car.has_method("heading") else 0.0
		var ahead := car.global_transform.basis.z
		ahead.y = 0.0
		ahead = ahead.normalized() if ahead.length() > 1e-3 else Vector3(sin(h), 0, cos(h))
		pos = cp - ahead * 8.0 + Vector3.UP * 10.0
		yaw = atan2(ahead.x, ahead.z)
		pitch = -0.15
		fov_now = 50.0
		_last_car = cp
		if _fix_when_placed:
			_fix_when_placed = false
			_set_fixed(true)
			_refresh()
	_panel.visible = _hud_on()
	var mx := _key(KEY_D) - _key(KEY_A)
	var mz := _key(KEY_W) - _key(KEY_S)
	var my := maxf(_key(KEY_Z), _key(KEY_SPACE)) - maxf(_key(KEY_X), _key(KEY_ALT))
	var ds := _key(KEY_4) - _key(KEY_3)
	if ds != 0.0:
		speed = clampf(speed * exp(ds * SPEED_RATE * delta), 0.01, 3.0)
	var dl := _key(KEY_8) - _key(KEY_7)
	if dl != 0.0:
		look_rate = clampf(look_rate * exp(dl * 1.2 * delta), LOOK_RANGE[0], LOOK_RANGE[1])
	# the turn of the mouse goes into the look, a share of what waits every frame (all of it when the look is direct)
	if aim:
		_look = Vector2.ZERO
	if _look != Vector2.ZERO:
		var share := 1.0 if look_rate >= LOOK_RANGE[1] else 1.0 - exp(-look_rate * delta)
		var d := _look * share
		_look -= d
		if _look.length() < 1e-5:
			_look = Vector2.ZERO
		yaw -= d.x
		pitch = clampf(pitch - d.y, -1.5, 1.5)
	roll_t = clampf(roll_t + (_key(KEY_Q) - _key(KEY_E)) * roll_rate * delta, -PI, PI)
	roll = roll_t if roll_smooth >= TILT_RANGE[1] else roll + (roll_t - roll) * (1.0 - exp(-roll_smooth * delta))
	fov_now = clampf(fov_now + (_key(KEY_BRACKETRIGHT) - _key(KEY_BRACKETLEFT)) * FOV_RATE * delta, 8.0, 110.0)
	# forward is the way the camera looks (up and down with the look), the sides level
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var cpitch := cos(pitch)
	var want := Vector3(fx * cpitch * mz - fz * mx, sin(pitch) * mz + my * VERTICAL_SPEED / BASE_SPEED, fz * cpitch * mz + fx * mx) * BASE_SPEED * speed
	vel = want if move_smooth >= MOVE_RANGE[1] else vel.lerp(want, 1.0 - exp(-move_smooth * delta))
	pos += vel * delta
	if follow and not fixed:
		pos += cp - _last_car
	_last_car = cp
	var bxf := car.get_global_transform_interpolated()
	var bq := bxf.basis.get_rotation_quaternion()
	var world := bxf.origin + bq * pos if fixed else pos
	if aim:
		var d := cp + Vector3.UP * 0.7 - world
		var want_yaw := atan2(-d.x, -d.z)
		var want_pitch := atan2(d.y, Vector2(d.x, d.z).length())
		var k := 1.0 - exp(-10.0 * delta)
		if fixed:
			var q := bq * Basis.from_euler(Vector3(pitch, yaw, roll)).get_rotation_quaternion()
			var q2 := Basis.from_euler(Vector3(want_pitch, want_yaw, roll)).get_rotation_quaternion()
			var e := Basis(bq.inverse() * q.slerp(q2, k)).get_euler()
			pitch = e.x
			yaw = e.y
		else:
			yaw += wrapf(want_yaw - yaw, -PI, PI) * k
			pitch += (want_pitch - pitch) * k
	if fixed or follow:
		world = _keep_in_view(cp, world, delta)
	var basis := Basis.from_euler(Vector3(pitch, yaw, roll))
	if fixed:
		basis = Basis(bq) * basis
	global_transform = Transform3D(basis.orthonormalized(), world)
	fov = fov_now
	near = 0.03
	_sync_in -= delta
	if _sync_in <= 0.0:
		_sync_in = 0.15
		_sync_sliders()
	_save_in -= delta
	if _save_in <= 0.0:
		_save_in = 2.0
		_save()


## Not through a wall: rays from the car to the camera (and a bit to each side and above), against the world; the
## camera comes in front of the nearest at once, and goes out again smoothly when the way is free.
func _keep_in_view(cp: Vector3, world: Vector3, delta: float) -> Vector3:
	var space := get_world_3d().direct_space_state
	var from := cp + Vector3.UP * 0.9
	var dir := world - from
	var length := dir.length()
	if length < 0.5 or space == null:
		return world
	dir /= length
	var side := dir.cross(Vector3.UP).normalized()
	var allowed := 1.0
	for r in 4:
		var end := world
		if r == 1:
			end += side * 0.45
		elif r == 2:
			end -= side * 0.45
		elif r == 3:
			end.y += 0.4
		var q := PhysicsRayQueryParameters3D.create(from, end)
		q.exclude = [car.get_rid()]
		var hit := space.intersect_ray(q)
		if not hit.is_empty():
			var rl := from.distance_to(end)
			allowed = minf(allowed, maxf(0.1, (from.distance_to(hit["position"]) - 0.4) / rl))
	_clear += (allowed - _clear) * (1.0 - exp(-(40.0 if allowed < _clear else 3.0) * delta))
	_clear = clampf(_clear, 0.1, 1.0)
	return from + dir * length * _clear if _clear < 0.999 else world


# ---- remembered per car

func _save() -> void:
	if car == null:
		return
	VideoPrefs.set_value("freecam", car.car_id, {"pos": pos, "yaw": yaw, "pitch": pitch, "roll": roll, "fov": fov_now, "speed": speed, "look": look_rate,
		"move": move_smooth, "roll_rate": roll_rate, "roll_smooth": roll_smooth, "follow": follow, "aim": aim, "fixed": fixed, "car": _last_car})


func _restore(car_pos: Vector3) -> bool:
	var s: Variant = VideoPrefs.get_value("freecam", car.car_id, {})
	if not (s is Dictionary) or not (s.get("pos") is Vector3):
		return false
	pos = s["pos"]
	if s.get("follow", false) and s.get("car") is Vector3:
		pos += car_pos - (s["car"] as Vector3)
	yaw = float(s.get("yaw", 0.0))
	pitch = float(s.get("pitch", 0.0))
	roll = float(s.get("roll", 0.0))
	roll_t = roll
	fov_now = float(s.get("fov", 60.0))
	speed = clampf(float(s.get("speed", 1.0)), 0.01, 3.0)
	look_rate = clampf(float(s.get("look", 20.0)), LOOK_RANGE[0], LOOK_RANGE[1])
	move_smooth = clampf(float(s.get("move", 6.0)), MOVE_RANGE[0], MOVE_RANGE[1])
	roll_rate = clampf(float(s.get("roll_rate", 0.9)), ROLL_RANGE[0], ROLL_RANGE[1])
	roll_smooth = clampf(float(s.get("roll_smooth", 8.0)), TILT_RANGE[0], TILT_RANGE[1])
	follow = bool(s.get("follow", false))
	aim = bool(s.get("aim", true))
	fixed = bool(s.get("fixed", false))
	return true


# ---- the panel

func _build_panel() -> void:
	_panel = CanvasLayer.new()
	_panel.layer = 6
	_panel.visible = false
	add_child(_panel)
	_box = PanelContainer.new()
	_box.anchor_left = 1.0
	_box.anchor_right = 1.0
	_box.offset_left = -276
	_box.offset_right = -16
	_box.offset_top = 160
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.086, 0.106, 0.133, 0.92)
	sb.border_color = Color("323c4a")
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(10)
	_box.add_theme_stylebox_override("panel", sb)
	_panel.add_child(_box)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	_box.add_child(v)
	var head := HBoxContainer.new()
	v.add_child(head)
	var title := Label.new()
	title.text = "FREE CAMERA"
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.modulate = Color("9fb0c4")
	head.add_child(title)
	var x := Button.new()
	x.text = "×"
	x.tooltip_text = "Back to the follow camera"
	x.focus_mode = Control.FOCUS_NONE
	x.pressed.connect(func(): left_camera.emit())
	head.add_child(x)
	var keys := Label.new()
	keys.text = "W A S D move · Space Z up · Alt X down\nmouse look (click the scene) · Q E tilt\n[ ] field of view · 3 4 slower, faster\n7 8 mouse look smoother, sharper"
	keys.add_theme_font_size_override("font_size", 11)
	keys.modulate = Color("9fb0c4")
	v.add_child(keys)
	for b in [["aim", toggle_aim], ["follow", toggle_follow], ["fixed", toggle_fixed]]:
		var btn := Button.new()
		btn.focus_mode = Control.FOCUS_NONE
		btn.pressed.connect(b[1])
		v.add_child(btn)
		_buttons[b[0]] = btn
	_heading(v, "MOVEMENT")
	_slider(v, "Speed", "log", 0.01, 3.0, func(): return speed, func(x: float): speed = x, func(x: float): return ("%.2f×" if x < 0.1 else "%.1f×") % x)
	_slider(v, "Movement smoothing", "log", MOVE_RANGE[0], MOVE_RANGE[1], func(): return move_smooth, func(x: float): move_smooth = x,
		func(x: float): return "direct" if x >= MOVE_RANGE[1] * 0.97 else "%.1f/s" % x)
	_heading(v, "LOOK")
	_slider(v, "Mouse look smoothing", "log", LOOK_RANGE[0], LOOK_RANGE[1], func(): return look_rate, func(x: float): look_rate = x,
		func(x: float): return "direct" if x >= LOOK_RANGE[1] * 0.97 else "%d/s" % roundi(x))
	_slider(v, "Field of view", "lin", 8.0, 110.0, func(): return fov_now, func(x: float): fov_now = x, func(x: float): return "%d°" % roundi(x))
	_heading(v, "TILT")
	_slider(v, "Tilt", "lin", -180.0, 180.0, func(): return rad_to_deg(roll_t), func(x: float): roll_t = deg_to_rad(x), func(x: float): return "%d°" % roundi(x))
	var level := Button.new()
	level.text = "Level"
	level.focus_mode = Control.FOCUS_NONE
	level.pressed.connect(func():
		roll_t = 0.0
		_save())
	v.add_child(level)
	_slider(v, "Tilt speed", "log", ROLL_RANGE[0], ROLL_RANGE[1], func(): return roll_rate, func(x: float): roll_rate = x, func(x: float): return "%d°/s" % roundi(x * 57.3))
	_slider(v, "Tilt smoothing", "log", TILT_RANGE[0], TILT_RANGE[1], func(): return roll_smooth, func(x: float): roll_smooth = x,
		func(x: float): return "direct" if x >= TILT_RANGE[1] * 0.97 else "%.1f/s" % x)
	_heading(v, "RECORD")
	var rec := Button.new()
	rec.focus_mode = Control.FOCUS_NONE
	rec.pressed.connect(func():
		if take != null:
			take.call("toggle"))
	v.add_child(rec)
	_buttons["record"] = rec


func _heading(v: Control, text: String) -> void:
	var h := Label.new()
	h.text = text
	h.add_theme_font_size_override("font_size", 11)
	h.modulate = Color("7f90a5")
	v.add_child(h)


func _slider(v: Control, label: String, kind: String, lo: float, hi: float, getter: Callable, setter: Callable, text: Callable) -> void:
	var top := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.add_theme_font_size_override("font_size", 12)
	var val := Label.new()
	val.add_theme_font_size_override("font_size", 12)
	top.add_child(l)
	top.add_child(val)
	v.add_child(top)
	var s := HSlider.new()
	s.max_value = 1000
	s.step = 1
	s.focus_mode = Control.FOCUS_NONE
	v.add_child(s)
	var to_pos := func(x: float) -> float: return (log(x / lo) / log(hi / lo)) if kind == "log" else (x - lo) / (hi - lo)
	var from_pos := func(p: float) -> float: return (lo * pow(hi / lo, p)) if kind == "log" else lo + p * (hi - lo)
	var item := {"slider": s, "value": val, "sync": func():
		if not s.has_meta("dragging"):
			s.set_value_no_signal(roundf(to_pos.call(getter.call()) * 1000.0))
		val.text = text.call(getter.call())}
	s.drag_started.connect(func(): s.set_meta("dragging", true))
	s.drag_ended.connect(func(_c: bool):
		s.remove_meta("dragging")
		_save())
	s.value_changed.connect(func(p: float):
		setter.call(clampf(from_pos.call(p / 1000.0), minf(lo, hi), maxf(lo, hi)))
		val.text = text.call(getter.call()))
	_sliders.append(item)


func _sync_sliders() -> void:
	for item in _sliders:
		item["sync"].call()


func _refresh() -> void:
	_buttons["aim"].text = "Looking at the car (P)" if aim else "Look at the car (P)"
	_buttons["follow"].text = "Moving with the car (O)" if follow else "Move with the car (O)"
	_buttons["fixed"].text = "Fixed to the car (I)" if fixed else "Fix to the car (I)"
	for k in ["aim", "follow", "fixed"]:
		var on: bool = {"aim": aim, "follow": follow, "fixed": fixed}[k]
		_buttons[k].modulate = Color(1.0, 0.65, 0.45) if on else Color.WHITE
	var st: String = take.call("state") if take != null else "idle"
	_buttons["record"].text = "Cancel (5 key)" if st == "counting" else ("Stop recording (5 key)" if st == "taking" else "Record (5 key)")
	_buttons["record"].modulate = Color(1.0, 0.45, 0.4) if st in ["counting", "taking"] else Color.WHITE
	_sync_sliders()


func refresh() -> void:
	_refresh()
