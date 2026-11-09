class_name ChaseCamera
extends Camera3D
## The cameras of the car (car.json "cameras"): behind the car (follow), in the cockpit, and on the bonnet.

enum Mode { FOLLOW, COCKPIT, BONNET }

var car: Car
var mode := Mode.FOLLOW
var distance := 6.0
var height := 2.4
var look_height := 0.6
var smoothing := 3.5
var zoom := 1.0                   # the follow camera nearer or further (the mouse wheel), times its distance
var elev := 0.0                   # rad: the follow camera higher or lower about the car (right mouse button and drag)
var right_taken := false          # (the debug view has a tool on the right mouse button)
var film_step := -1.0             # (a video is made, ReplayFilm: > 0 the step of this picture, 0 rests until the next picture; -1 not filming)
var fov_standing := 50.0
var fov_fast := 70.0
var distance_fast := 0.0          # m behind the car at full speed (0: it comes closer as the view widens, dolly)
var height_fast := 0.0            # m high at full speed
var bonnet := Vector3.INF         # the bonnet camera in the frame of the body (INF: from the size of the car)
var bonnet_fov := 72.0
var _fast := 0.0                  # 0 at a standstill, 1 at full speed, smoothed
var fov_full_speed := 70.0        # m/s: fov_fast from this speed (Car.js)
var look_z := 0.0                 # m: the point it looks at is so far ahead of the middle of the car (negative: behind)
var dolly := 1.0                  # 0..1: the camera comes closer as the field of view widens (1: the car keeps its size)
var cockpit := Vector3(0.35, 0.9, -0.2)
var cockpit_fov := 75.0
var orbit := 0.0                  # rad: the follow camera turned round the car (the keys [ and ], ` back behind it)
var _pos := Vector3.ZERO
var _look_dir := Vector3.FORWARD
var _fov := -1.0                  # the field of view of the follow camera now (it follows the speed, smoothed)
var _crash_off: Variant = null    # a motorcycle that went down: the camera follows the rider at this offset (Car.js)
var _orbiting := false            # the right mouse button is down: a drag turns the camera


func follow(c: Car) -> void:
	car = c
	read_config(c)
	snap()


## The cameras of car.json (at the start, and again when the tuning menu changes them); what car.json does not
## give stays as it is.
func read_config(c: Car) -> void:
	var cams: Dictionary = c.config.get("cameras", {})
	var f: Dictionary = cams.get("follow", {})
	distance = float(f.get("distance", distance))
	height = float(f.get("height", height))
	look_height = float(f.get("look_height", look_height))
	smoothing = float(f.get("smoothing", smoothing))
	fov_standing = float(f.get("fov_standing", fov_standing))
	fov_fast = float(f.get("fov_fast", fov_fast))
	fov_full_speed = maxf(1.0, float(f.get("fov_full_speed", fov_full_speed)))
	look_z = float(f.get("look_z", look_z))
	dolly = float(f.get("dolly", dolly))
	distance_fast = float(f.get("distance_fast", distance_fast))
	height_fast = float(f.get("height_fast", height_fast))
	var bn: Dictionary = cams.get("bonnet", {})
	if bn.has("position"):
		var b: Array = bn["position"]
		bonnet = Vector3(float(b[0]), float(b[1]), float(b[2]))
	bonnet_fov = float(bn.get("fov", bonnet_fov))
	var cp: Dictionary = cams.get("cockpit", {})
	if cp.has("position"):
		var p: Array = cp["position"]
		cockpit = Vector3(float(p[0]), float(p[1]), float(p[2]))      # (the space of the body, as the driver: car.json "driver")
	cockpit_fov = float(cp.get("fov", cockpit_fov))


func snap() -> void:
	var xf := car.get_global_transform_interpolated()
	var back := _flat_forward(xf)
	_pos = xf.origin - back * distance + Vector3.UP * height
	_look_dir = back
	reset_physics_interpolation()


func next_mode() -> void:
	mode = ((mode + 1) % 3) as Mode
	snap()


## A motorcycle that went down: the camera follows the rider (his ragdoll) with the sky up, at the offset it had from him
## at the crash (2.5 to 5 m away, at least 1.2 m above him), smoothed, looking at him, until a reset or a repair.
func _crash_view(delta: float) -> bool:
	var c: Variant = car.bike_model.rider_centre() if car.bike != null and car.bike.crashed and car.bike_model != null else null
	if c == null:
		_crash_off = null
		return false
	var at: Vector3 = c
	if _crash_off == null:
		var off := global_position - at
		var flat := Vector2(off.x, off.z)
		flat = flat.normalized() * clampf(flat.length(), 2.5, 5.0) if flat.length() > 0.1 else Vector2(0.0, -3.0)
		_crash_off = Vector3(flat.x, maxf(1.2, off.y), flat.y)
		_pos = global_position
	var want: Vector3 = at + (_crash_off as Vector3)
	_pos = _pos.lerp(want, 1.0 - exp(-delta * 4.0))
	global_transform = Transform3D(Basis.IDENTITY, _pos).looking_at(at, Vector3.UP)
	fov = 50.0
	return true


func _flat_forward(xf: Transform3D) -> Vector3:
	var f := xf.basis.z
	f.y = 0.0
	return f.normalized() if f.length() > 0.01 else Vector3.FORWARD


## The follow camera with the mouse (Car.js): the right button and a drag turn it about the car and lift or lower it,
## the wheel brings it nearer or further.
func _unhandled_input(event: InputEvent) -> void:
	if mode != Mode.FOLLOW or not current or car == null:
		return
	var mb := event as InputEventMouseButton
	if mb != null and mb.pressed:
		if mb.button_index == MOUSE_BUTTON_RIGHT and not right_taken:
			_orbiting = true
			get_viewport().set_input_as_handled()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_UP or mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_zoom_by((1.0 if mb.button_index == MOUSE_BUTTON_WHEEL_DOWN else -1.0) * 0.15 * maxf(mb.factor, 0.2) if mb.factor != 0.0 else 0.0)
			get_viewport().set_input_as_handled()
	elif event is InputEventPanGesture:          # (a trackpad: two fingers)
		_zoom_by(clampf((event as InputEventPanGesture).delta.y * 0.05, -0.45, 0.45))
		get_viewport().set_input_as_handled()


func _input(event: InputEvent) -> void:
	if not _orbiting:
		return
	var mb := event as InputEventMouseButton
	if mb != null and mb.button_index == MOUSE_BUTTON_RIGHT and not mb.pressed:
		_orbiting = false
	elif event is InputEventMouseMotion:
		var rel := (event as InputEventMouseMotion).relative
		orbit = wrapf(orbit - rel.x * 0.006, -PI, PI)
		elev = clampf(elev + rel.y * 0.005, -0.15, 1.2)


func _zoom_by(amount: float) -> void:
	zoom = clampf(zoom * exp(amount), 0.3, 4.0)


## The key that puts the camera back behind the car.
func reset_view() -> void:
	orbit = 0.0
	elev = 0.0
	zoom = 1.0


func _process(delta: float) -> void:
	if car == null:
		return
	if film_step >= 0.0:
		if film_step == 0.0:
			return
		delta = film_step
		film_step = 0.0
	var xf := car.get_global_transform_interpolated()
	var spd := absf(car.speed)
	CarDriver.camera_inside(car, mode == Mode.COCKPIT)
	if _crash_view(delta):
		return
	match mode:
		Mode.FOLLOW:
			# the camera turns after the direction the car moves, so a slide is seen from behind the car
			var want := _flat_forward(xf)
			var vel := car.linear_velocity
			vel.y = 0.0
			if vel.length() > 3.0 and car.gear >= 0:
				want = want.lerp(vel.normalized(), 0.35).normalized()
			_look_dir = _look_dir.slerp(want, 1.0 - exp(-delta * smoothing)).normalized()
			# the faster, the wider the field of view (fov_fast from fov_full_speed), and the camera comes closer in the same
			# measure (dolly 1: the car keeps its size in the picture, a dolly zoom; Car.js); it looks look_z ahead of the car
			var fov_want := lerpf(fov_standing, fov_fast, clampf(spd / fov_full_speed, 0.0, 1.0))
			_fov = fov_want if _fov < 0.0 else _fov + (fov_want - _fov) * (1.0 - exp(-4.0 * minf(delta, 0.1)))
			var scale := 1.0 + dolly * (tan(deg_to_rad(fov_standing) / 2.0) / tan(deg_to_rad(_fov) / 2.0) - 1.0)
			var dir := _look_dir.rotated(Vector3.UP, orbit)
			var far := distance * scale * zoom
			var up_by := look_height + (height - look_height) * scale
			if distance_fast > 0.0:             # (the place at full speed is given: between the two with the speed)
				_fast += (clampf(spd / fov_full_speed, 0.0, 1.0) - _fast) * (1.0 - exp(-4.0 * minf(delta, 0.1)))
				far = lerpf(distance, distance_fast, _fast) * zoom
				up_by = lerpf(height, height_fast, _fast)
			var target := xf.origin - dir * far + Vector3.UP * (up_by + tan(elev) * far)
			_pos = _pos.lerp(target, 1.0 - exp(-delta * smoothing * 2.5))
			global_transform = Transform3D(Basis.IDENTITY, _pos).looking_at(xf.origin + dir * look_z + Vector3.UP * look_height, Vector3.UP)
			if car.bike != null:
				rotate_object_local(Vector3.BACK, car.bike.camera_roll(delta))      # (a motorcycle: the camera rolls with the lean)
			fov = _fov
		Mode.COCKPIT:
			global_transform = xf * Transform3D(Basis(Vector3.UP, PI), cockpit)
			fov = cockpit_fov
		Mode.BONNET:
			var dims: Dictionary = car.config.get("dimensions", {})
			var p := bonnet if bonnet != Vector3.INF else Vector3(0.0, float(dims.get("height", 1.3)) * 0.62 + car.model_root.position.y, float(dims.get("length", 4.2)) * 0.12)
			global_transform = xf * Transform3D(Basis(Vector3.UP, PI), p)
			fov = bonnet_fov
