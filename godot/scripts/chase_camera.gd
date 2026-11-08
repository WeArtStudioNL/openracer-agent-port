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
var fov_standing := 50.0
var fov_fast := 70.0
var cockpit := Vector3(0.35, 0.9, -0.2)
var cockpit_fov := 75.0
var orbit := 0.0                  # rad: the follow camera turned round the car (the keys [ and ], ` back behind it)
var _pos := Vector3.ZERO
var _look_dir := Vector3.FORWARD
var _crash_off: Variant = null    # a motorcycle that went down: the camera follows the rider at this offset (Car.js)


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


func _process(delta: float) -> void:
	if car == null:
		return
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
			var target := xf.origin - _look_dir.rotated(Vector3.UP, orbit) * distance + Vector3.UP * height
			_pos = _pos.lerp(target, 1.0 - exp(-delta * smoothing * 2.5))
			global_transform = Transform3D(Basis.IDENTITY, _pos).looking_at(xf.origin + Vector3.UP * look_height, Vector3.UP)
			if car.bike != null:
				rotate_object_local(Vector3.BACK, car.bike.camera_roll(delta))      # (a motorcycle: the camera rolls with the lean)
			fov = lerpf(fov_standing, fov_fast, clampf(spd / 60.0, 0.0, 1.0))
		Mode.COCKPIT:
			global_transform = xf * Transform3D(Basis(Vector3.UP, PI), cockpit)
			fov = cockpit_fov
		Mode.BONNET:
			var dims: Dictionary = car.config.get("dimensions", {})
			var p := Vector3(0.0, float(dims.get("height", 1.3)) * 0.62 + car.model_root.position.y, float(dims.get("length", 4.2)) * 0.12)
			global_transform = xf * Transform3D(Basis(Vector3.UP, PI), p)
			fov = 72.0
