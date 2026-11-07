class_name ReplayFreeCamera
extends Camera3D
## The free camera of the replay (Replay.js "free"): moved by hand. W A S D or the arrows move it (W the way it
## looks, also up and down with the look; the sides are level), Z, Space and Shift up, X, Alt and Control down,
## Q and E tilt the picture, [ and ] the field of view; click the scene and the mouse looks around (Escape lets it
## go), a gamepad: the left stick moves, the right stick looks, the triggers up and down, the shoulders zoom.
## F aims it at the car (and the mouse look rests), L fixes it to the car (its place and its turn: the frame of the
## car), K fixes it with the sky up (the car's place, not its turn), Tab another car. Everything is smoothed: the
## speed (a slider, 0.01 to 3 times) is how fast it moves, looks and zooms; 5 and 6 the smoothing of the look.
## It starts fixed to the car, where the camera was.

const BASE_SPEED := 12.0
const VERTICAL_SPEED := 8.0
const FOV_RATE := 40.0
const LOOK_SENSITIVITY := 0.0022
const STICK_LOOK := 2.4
const ROLL_RATE := 1.0

var active := false
var speed := 1.0                    # 0.01 .. 3
var pos := Vector3.ZERO             # in the frame of the world, or of the car while it is fixed to it
var vel := Vector3.ZERO
var yaw := 0.0
var pitch := 0.0
var yaw_t := 0.0
var pitch_t := 0.0
var look_rate := 20.0               # 1 .. 60 (60: direct)
var fov_now := 60.0
var fov_t := 60.0
var roll := 0.0
var roll_t := 0.0
var quat := Quaternion.IDENTITY     # how it looked in the world, last frame
var aim := false
var parent := false
var sky := false
var target := 0
var body_of: Callable               # func(i) -> Node3D: the car i
var car_count := 1
var keys_on := true                 # (the video editor: the fields of the inspector take the keys)


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	far = 4000.0
	near = 0.03
	speed = clampf(float(VideoPrefs.get_value("replay", "free_speed", 1.0)), 0.01, 3.0)
	look_rate = clampf(float(VideoPrefs.get_value("replay", "free_look", 20.0)), 1.0, 60.0)


func _body() -> Node3D:
	if not body_of.is_valid():
		return null
	var b: Variant = body_of.call(mini(target, car_count - 1))
	return b as Node3D


## Starts where another camera is, looking the way it looks; fixed to the car.
func enter(from: Camera3D) -> void:
	active = true
	pos = from.global_position
	vel = Vector3.ZERO
	quat = from.global_transform.basis.get_rotation_quaternion()
	parent = false
	sky = false
	aim = false
	_angles_from_world(quat)
	fov_now = from.fov
	fov_t = fov_now
	if _body() != null:
		set_parent("car")
	global_transform = from.global_transform
	fov = fov_now
	make_current()


func leave() -> void:
	active = false
	parent = false
	sky = false
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


## yaw and pitch (in the frame of the camera) from how it looks in the world
func _angles_from_world(q: Quaternion) -> void:
	var b := _body() if parent and not sky else null
	var local := q
	if b != null:
		local = b.global_transform.basis.get_rotation_quaternion().inverse() * q
	var e := Basis(local).get_euler()
	yaw = e.y
	yaw_t = e.y
	pitch = e.x
	pitch_t = e.x
	roll = e.z
	roll_t = e.z


## The mouse and the stick look left and right about the vertical of the world, up and down about the level axis
## of the camera, also when it is fixed to a car (the look is found in the world and put back in its frame).
func look_by(d_yaw: float, d_pitch: float) -> void:
	var b := _body() if parent and not sky else null
	if b == null:
		yaw_t += d_yaw
		pitch_t = clampf(pitch_t + d_pitch, -1.5, 1.5)
		return
	var bq := b.global_transform.basis.get_rotation_quaternion()
	var world := bq * Basis.from_euler(Vector3(pitch_t, yaw_t, 0.0)).get_rotation_quaternion()
	var f := world * Vector3.FORWARD
	var y := atan2(-f.x, -f.z) + d_yaw
	var p := clampf(asin(clampf(f.y, -1.0, 1.0)) + d_pitch, -1.5, 1.5)
	var local := bq.inverse() * Basis.from_euler(Vector3(p, y, 0.0)).get_rotation_quaternion()
	var e := Basis(local).get_euler()
	var turn := wrapf(e.y - yaw_t, -PI, PI)
	yaw_t += turn
	pitch_t = clampf(e.x, -1.5, 1.5)


func toggle_aim() -> void:
	aim = not aim
	if not aim:
		_angles_from_world(quat)


## Fixed to the car: "car" (its place and its turn), "sky" (its place only), or "none".
func set_parent(mode: String) -> void:
	var b := _body()
	if b == null:
		return
	var bxf := b.global_transform
	var bq := bxf.basis.get_rotation_quaternion()
	if parent:
		if sky:
			pos += bxf.origin
		else:
			pos = bxf.origin + bq * pos
			vel = bq * vel
		parent = false
		sky = false
	if mode == "car":
		pos = bq.inverse() * (pos - bxf.origin)
		vel = bq.inverse() * vel
		parent = true
	elif mode == "sky":
		pos -= bxf.origin
		parent = true
		sky = true
	_angles_from_world(quat)


func toggle_parent() -> void:
	set_parent("none" if parent and not sky else "car")


func toggle_sky() -> void:
	set_parent("none" if parent and sky else "sky")


## The next car: the camera keeps its place in the world.
func next_target() -> void:
	if car_count < 2:
		return
	if parent:
		set_parent("none")
	target = (target + 1) % car_count


func set_speed(v: float) -> void:
	speed = clampf(v, 0.01, 3.0)
	VideoPrefs.set_value("replay", "free_speed", speed)


func _key(codes: Array) -> float:
	if not keys_on:
		return 0.0
	for c in codes:
		if Input.is_physical_key_pressed(c):
			return 1.0
	return 0.0


static func _stick(v: float) -> float:
	return 0.0 if absf(v) < 0.15 else v


func _unhandled_input(event: InputEvent) -> void:
	if active and event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT and not aim:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		get_viewport().set_input_as_handled()


func _input(event: InputEvent) -> void:
	if active and event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and not aim:
		look_by(-event.relative.x * LOOK_SENSITIVITY, -event.relative.y * LOOK_SENSITIVITY)
		get_viewport().set_input_as_handled()


## Once per frame while the camera is on (the replay calls it, after the cars are placed).
func update(delta: float) -> void:
	delta = minf(delta, 0.1)
	var b := _body()
	var fixed_to := parent and b != null
	var mx := _key([KEY_D, KEY_RIGHT]) - _key([KEY_A, KEY_LEFT])
	var mz := _key([KEY_W, KEY_UP]) - _key([KEY_S, KEY_DOWN])
	var my := _key([KEY_Z, KEY_SPACE, KEY_SHIFT]) - _key([KEY_X, KEY_ALT, KEY_CTRL])
	var zoom := _key([KEY_BRACKETRIGHT]) - _key([KEY_BRACKETLEFT])
	var tilt := _key([KEY_Q]) - _key([KEY_E])
	for pad in Input.get_connected_joypads():
		if pad == WheelInput.device:
			continue
		mx += _stick(Input.get_joy_axis(pad, JOY_AXIS_LEFT_X))
		mz -= _stick(Input.get_joy_axis(pad, JOY_AXIS_LEFT_Y))
		my += Input.get_joy_axis(pad, JOY_AXIS_TRIGGER_RIGHT) - Input.get_joy_axis(pad, JOY_AXIS_TRIGGER_LEFT)
		zoom += (1.0 if Input.is_joy_button_pressed(pad, JOY_BUTTON_RIGHT_SHOULDER) else 0.0) - (1.0 if Input.is_joy_button_pressed(pad, JOY_BUTTON_LEFT_SHOULDER) else 0.0)
		if not aim:
			var k := STICK_LOOK * delta * maxf(0.5, speed)
			look_by(-_stick(Input.get_joy_axis(pad, JOY_AXIS_RIGHT_X)) * k, -_stick(Input.get_joy_axis(pad, JOY_AXIS_RIGHT_Y)) * k)
	pitch_t = clampf(pitch_t, -1.5, 1.5)
	# the direction: W along where the camera looks, the sides level; the steps are in the world, put in the frame of the car
	var f := quat * Vector3.FORWARD
	var look_y := f.y
	f.y = 0.0
	var level := f.length()
	f = Vector3.FORWARD if level < 1e-6 else f / level
	var right := Vector3(-f.z, 0.0, f.x)
	var want := Vector3((f.x * level * mz + right.x * mx) * BASE_SPEED * speed, look_y * mz * BASE_SPEED * speed + my * VERTICAL_SPEED * speed,
		(f.z * level * mz + right.z * mx) * BASE_SPEED * speed)
	if fixed_to and not sky:
		want = b.global_transform.basis.get_rotation_quaternion().inverse() * want
	vel = vel.lerp(want, 1.0 - exp(-5.0 * delta))
	pos += vel * delta
	# the look: the mouse decides where it wants to look, the camera follows smoothly (5 and 6: how smoothly)
	var look_change := _key([KEY_6]) - _key([KEY_5])
	if look_change != 0.0:
		look_rate = clampf(look_rate * exp(look_change * 1.2 * delta), 1.0, 60.0)
		VideoPrefs.set_value("replay", "free_look", look_rate)
	var share := 1.0 if look_rate >= 60.0 else 1.0 - exp(-look_rate * delta)
	yaw += (yaw_t - yaw) * share
	pitch += (pitch_t - pitch) * share
	roll_t = clampf(roll_t + tilt * ROLL_RATE * maxf(0.5, speed) * delta, -PI, PI)
	roll += (roll_t - roll) * (1.0 - exp(-8.0 * delta))
	fov_t = clampf(fov_t + zoom * FOV_RATE * speed * delta, 8.0, 110.0)
	fov_now += (fov_t - fov_now) * (1.0 - exp(-8.0 * delta))
	# the place in the world, and the way it looks
	var world := pos
	if fixed_to:
		var bxf := b.global_transform
		world = pos + bxf.origin if sky else bxf.origin + bxf.basis.get_rotation_quaternion() * pos
	if aim and b != null:
		var at := b.global_position + Vector3.UP * 0.7
		if (at - world).length() > 1e-3:
			var want_q := Basis.looking_at(at - world, Vector3.UP).get_rotation_quaternion()
			if absf(roll) > 1e-4:
				want_q = want_q * Quaternion(Vector3.BACK, roll)
			quat = quat.slerp(want_q, 1.0 - exp(-10.0 * delta)).normalized()
	else:
		quat = Basis.from_euler(Vector3(pitch, yaw, roll)).get_rotation_quaternion()
		if fixed_to and not sky:
			quat = b.global_transform.basis.get_rotation_quaternion() * quat
	global_transform = Transform3D(Basis(quat), world)
	fov = fov_now
	near = 0.03
