extends Node3D
## The physics parity test (a scene, for the autoloads):
##     Godot --headless --path godot res://tools/test_parity.tscn -- --car=<id> [--tyres=simple|shell] --user-dir=/tmp/x
##         --set=tc:true,esc:false,abs:true,tyre_wear:0 [--verbose]
## The same road test as godot/tools/parity-bench.js runs on the browser's Vehicle.js in node, with the same controllers,
## on a flat floor: full throttle from a standstill (0-50, 0-100 km/h, the top speed, every upshift: the gear, the
## engine speed just before it and the road speed), the brakes from 100 km/h (50 when the top speed is under 110) to a
## standstill, and a skidpad of 40 m (the steering held on the curvature of the path, the speed raised by 0.25 m/s a
## second from 5 m/s: the most lateral acceleration, speed x yaw rate, while the car follows the circle). The last line
## is "PARITY <json>" with the figures (godot/tools/parity.sh puts the two tables side by side).

const KMH := 1.0 / 3.6
const RADIUS := 40.0

var car: Car
var _cfg: Dictionary = {}
var _id := ""
var _phase := "settle"
var _t := 0.0
var _x0 := Vector3.ZERO
var _out := {}
var _t50 := -1.0
var _t100 := -1.0
var _top := 0.0
var _top_at := 0.0
var _gear := 1
var _rpm := 0.0
var _shifts: Array = []
var _from := 100.0
var _integ := 0.0
var _ay := 0.0
var _best := 0.0
var _best_speed := 0.0
var _bad := 0.0


func _ready() -> void:
	get_tree().create_timer(900.0).timeout.connect(get_tree().quit)
	_id = Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	add_to_group("track")
	# the floor: a strip of tiles of 400 m along z, 20 km long and 2 km wide (the shell tyre finds the road in a grid of the triangles of
	# the ground: one box of 20 km was too big a triangle for it, and the car fell through)
	var floor_body := StaticBody3D.new()
	for k in 50:
		var floor_col := CollisionShape3D.new()
		var floor_shape := BoxShape3D.new()
		floor_shape.size = Vector3(2000, 1, 402)      # (a little over each other; wide: a bike drifts some hundred metres to the side)
		floor_col.shape = floor_shape
		floor_col.position = Vector3(0, -0.5, -9800.0 + 400.0 * k)
		floor_body.add_child(floor_col)
	add_child(floor_body)
	var cfg: Variant = Content.load_json("cars/%s/car.json" % _id)
	_cfg = cfg if cfg is Dictionary else {}
	_new_car()


func _new_car() -> void:
	if car != null:
		car.queue_free()
	car = Car.new()
	car.player_tyres = true
	car.setup(_id, _cfg)
	add_child(car)
	car.place(Vector3(0, car.wheels[0].radius + 0.05, -9000.0), PI / 2.0)
	car.freeze = false
	car.steer_direct = true
	car.contact_monitor = true
	car.max_contacts_reported = 8
	if car.bike != null:
		car.bike.lean_from_bend = true
	car.manual = false
	_t = 0.0


func _physics_process(dt: float) -> void:
	if car == null or not car.is_inside_tree():
		return
	_t += dt
	var u := car.speed
	match _phase:
		"settle":
			car.throttle_input = 0.0
			car.brake_input = 0.0
			if _t >= 2.0 and Content.arg("only") != "":
				# (--only=brake|skidpad --from=100: one test, for a look at it with --verbose)
				_from = float(Content.arg("from")) if Content.arg("from") != "" else 100.0
				_phase = "skidpad" if Content.arg("only") == "skidpad" else "to brake"
				_t = 0.0
			elif _t >= 2.0:
				_phase = "accelerate"
				_t = 0.0
				_gear = car.gear
		"accelerate":
			car.throttle_input = 1.0
			if _t50 < 0.0 and u >= 50.0 * KMH:
				_t50 = _t
			if _t100 < 0.0 and u >= 100.0 * KMH:
				_t100 = _t
			if car.gear != _gear:
				_shifts.append("%d>%d@%drpm/%.1f" % [_gear, car.gear, roundi(_rpm), u / KMH])
				_gear = car.gear
			_rpm = car.engine.rpm()
			if u > _top + 0.03:
				_top = u
				_top_at = _t
			if Content.arg("verbose") != "" and fmod(_t, 1.0) < dt:
				var ws := []
				for w in car.wheels:
					ws.append("%.1f/%d/%d/%.3f" % [w.omega, roundi(w.load), roundi(w.fx), w.slip_ratio])
				print("   t %.0f  %.1f km/h  gear %d  rpm %d  clutch %.2f  slip %.2f  thr %.2f  pos %s  %s" % [_t, u / KMH, car.gear, roundi(car.engine.rpm()),
					car.clutch_engagement, car.tc_slip, car.tc_factor, car.global_position.snapped(Vector3.ONE * 0.1), ws])
			if (_t - _top_at > 8.0 and _t > 20.0) or _t > 120.0:
				_out["0-50 (s)"] = _t50 if _t50 >= 0.0 else null
				_out["0-100 (s)"] = _t100 if _t100 >= 0.0 else null
				_out["top (km/h)"] = _top / KMH
				_out["shifts"] = " ".join(_shifts)
				_from = 100.0 if _top / KMH >= 110.0 else 50.0
				_new_car()
				_phase = "to brake"
		"to brake":
			car.throttle_input = 1.0
			if u >= _from * KMH or _t > 120.0:
				_x0 = car.global_position
				_phase = "coast" if Content.arg("only") == "coast" else "brake"
				_t = 0.0
				_rpm = u
		"coast":
			# (--only=coast: in neutral, off the throttle, the deceleration of the air and the tyres over 3 s)
			car.manual = true
			car.gear = 0
			car.throttle_input = 0.0
			if _t >= 3.0:
				var ws := []
				for w in car.wheels:
					ws.append("%.3f/%d/%d/%d/%.4f" % [w.length, roundi(w.load), roundi(w.fx), roundi(w.fy), w.slip_ratio])
				print("   coast from %.1f km/h: %.3f m/s2  body contacts %d  origin %.3f m up, length/load/fx/fy/slip %s" % [_rpm / KMH, (_rpm - u) / _t, car.get_contact_count(),
					car.global_position.y, ws])
				get_tree().quit()
		"brake":
			car.throttle_input = 0.0
			car.brake_input = 1.0
			if Content.arg("verbose") != "" and fmod(_t, 0.25) < dt:
				var ws := []
				for w in car.wheels:
					ws.append("%d/%d/%.2f/%.2f/%d" % [roundi(w.load), roundi(w.fx), w.slip_ratio, w.abs_factor, roundi(w.max_brake)])
				print("   t %.2f  %.1f km/h  rpm %d  gear %d  clutch %.2f  cvt %.2f  %s" % [_t, u / KMH, roundi(car.engine.rpm()), car.gear, car.clutch_engagement,
					car.cvt_ratio, ws])
			if u < 0.3 or _t > 30.0:
				_out["brake %d-0 (m)" % roundi(_from)] = (car.global_position - _x0).length() if _t <= 30.0 else null
				car.brake_input = 0.0
				_new_car()
				_phase = "skidpad"
		"skidpad":
			_skidpad(dt, u)


## The skidpad: the steering on the curvature of the path (to the left), the speed raised slowly.
func _skidpad(dt: float, u: float) -> void:
	var target := 5.0 + _t * 0.25
	var err := target - u
	car.throttle_input = minf(1.0, err * 0.5) if err > 0.0 else 0.0
	car.brake_input = 0.0 if err > 0.0 else minf(1.0, -err * 0.3)
	var up := car.global_transform.basis.y
	var r := car.angular_velocity.dot(up)
	var k := r / u if u > 1.0 else 0.0
	var lock := car.max_steer
	_integ = clampf(_integ + (1.0 / RADIUS - k) * dt * 2.0, -lock, lock)
	var delta := clampf(atan(car.wheelbase / RADIUS) + _integ + (1.0 / RADIUS - k) * 1.0, -lock, lock)
	car.steer_input = delta / lock
	_ay += (u * r - _ay) * minf(1.0, dt / 0.5)
	var lateral := car.linear_velocity.dot(car.global_transform.basis.x)
	var beta := absf(atan2(lateral, maxf(0.1, u)))
	var follows := absf(k * RADIUS - 1.0) < 0.06 and beta < 0.12
	if _t > 8.0 and follows and _ay > _best:
		_best = _ay
		_best_speed = u
	_bad = _bad + dt if _t > 8.0 and not follows else 0.0
	if Content.arg("verbose") != "" and fmod(_t, 5.0) < dt:
		var ws := []
		for w in car.wheels:
			ws.append("%d/%d" % [roundi(w.load), roundi(w.fy)])
		print("   t %.0f u %.1f k*R %.3f ay %.3f steer %.2f beta %.1f FL/FR/RL/RR load/fy %s" % [_t, u / KMH, k * RADIUS, _ay / Car.G,
			rad_to_deg(car.steer_angle), rad_to_deg(beta), " ".join(ws)])
	if _bad > 3.0 or _t > 300.0:
		_out["skidpad R40 (g)"] = _best / Car.G
		_out["skidpad at (km/h)"] = _best_speed / KMH
		print("PARITY ", JSON.stringify({_id: _out}))
		get_tree().quit()
