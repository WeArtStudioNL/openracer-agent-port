class_name ReplayFreeCamera
extends Camera3D
## The free camera of the replay (Replay.js): moved by hand. W A S D move it (W the way it looks), Space and Z up, X
## down, the mouse (drag with a button held) looks around, [ and ] change the field of view, F aims it at the car
## (and keeps aiming), L goes with the car (it keeps its place against the car). Movements and the look are smoothed.

const SPEED := 12.0                 # m/s
const LOOK := 0.004                 # rad per pixel

var target: Car
var aim := false
var follow := false
var _yaw := 0.0
var _pitch := -0.2
var _vel := Vector3.ZERO
var _offset := Vector3.ZERO         # (following: the place against the car)
var _last_target: Car


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	far = 4000.0


## Starts where another camera is, looking the way it looks.
func start_from(cam: Camera3D) -> void:
	global_transform = cam.global_transform
	fov = cam.fov
	var f := -global_transform.basis.z
	_yaw = atan2(-f.x, -f.z)
	_pitch = asin(clampf(f.y, -1.0, 1.0))


func _unhandled_input(event: InputEvent) -> void:
	if not current:
		return
	if event is InputEventMouseMotion and (event.button_mask & (MOUSE_BUTTON_MASK_LEFT | MOUSE_BUTTON_MASK_RIGHT)) != 0:
		aim = false
		_yaw -= event.relative.x * LOOK
		_pitch = clampf(_pitch - event.relative.y * LOOK, -1.5, 1.5)
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_F:
				aim = not aim
			KEY_L:
				follow = not follow
				if target != null:
					_offset = global_position - target.global_position
			KEY_BRACKETLEFT:
				fov = clampf(fov - 5.0, 10.0, 110.0)
			KEY_BRACKETRIGHT:
				fov = clampf(fov + 5.0, 10.0, 110.0)


func _process(delta: float) -> void:
	if not current:
		return
	if target != _last_target and target != null:
		_last_target = target
		_offset = global_position - target.global_position
	var basis := Basis.from_euler(Vector3(_pitch, _yaw, 0.0))
	var want := Vector3.ZERO
	if Input.is_physical_key_pressed(KEY_W):
		want += -basis.z
	if Input.is_physical_key_pressed(KEY_S):
		want += basis.z
	if Input.is_physical_key_pressed(KEY_A):
		want += -basis.x
	if Input.is_physical_key_pressed(KEY_D):
		want += basis.x
	if Input.is_physical_key_pressed(KEY_SPACE) or Input.is_physical_key_pressed(KEY_Z):
		want += Vector3.UP
	if Input.is_physical_key_pressed(KEY_X):
		want += Vector3.DOWN
	var fast := 3.0 if Input.is_physical_key_pressed(KEY_SHIFT) else 1.0
	_vel = _vel.lerp(want.normalized() * SPEED * fast, minf(1.0, delta * 6.0))
	if follow and target != null:
		_offset += _vel * delta
		global_position = target.global_position + _offset
	else:
		global_position += _vel * delta
	if aim and target != null:
		var to := (target.global_position + Vector3.UP * 0.6) - global_position
		if to.length() > 0.1:
			var f := to.normalized()
			var yaw := atan2(-f.x, -f.z)
			var pitch := asin(clampf(f.y, -1.0, 1.0))
			_yaw = lerp_angle(_yaw, yaw, minf(1.0, delta * 8.0))
			_pitch = lerpf(_pitch, pitch, minf(1.0, delta * 8.0))
	global_transform.basis = Basis.from_euler(Vector3(_pitch, _yaw, 0.0))
