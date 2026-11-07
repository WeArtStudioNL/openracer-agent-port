class_name AIDriver
extends RefCounted
## Drives a car along the racing line: it steers at a point ahead on the line (further ahead the faster it goes)
## and holds the speed of the line there with the throttle and the brake (web/js/Driver.js). It backs off behind
## a slower car and moves aside to pass it. It drives the opponents of a race, the player's car after the finish,
## and the player's car in the tests (--ai).

var car: Car
var line: RacingLine
var pace := 0.8                  # a share of the grip that it uses
var others: Array[Car] = []       # the other cars of the race (to back off behind one and to move aside)
var pit: AIPit = null             # an AI car of a race: its pit stops (AIPit)
var _index := -1
var _speed_error_i := 0.0
var _side := 0.0                  # m to the side of the line, to pass a car
var _passing: Car = null
var _pass_side := 0.0
var _pass_for := 0.0
var _brake := 9.0
var _speeds := PackedFloat32Array()
var _learned_at := -100
var _was_off := false
var _yaw_i := 0.0
var _last_index := -1
var _base_speeds := PackedFloat32Array()
var _rolled := 0.0                # a motorcycle: the throttle as it is rolled on
var _beside := NAN                # a motorcycle: how far it was to the left of the line


func setup(c: Car, l: RacingLine, p := -1.0) -> void:
	car = c
	line = l
	if p > 0.0:
		pace = p
	elif Content.arg("ai-pace") != "":
		pace = float(Content.arg("ai-pace"))
	var grip := 1.2 * float(c.config.get("tyres", {}).get("grip", 1.0))
	var lateral := grip
	var braking := grip * 0.75
	if c.bike != null:
		# a motorcycle holds what its lean and its max_lateral_g allow, and it cannot brake hard and lean at once
		# (Opponent.js); it leans as much as the bend that is asked needs
		var m: Dictionary = c.config.get("motorcycle", {})
		lateral = minf(minf(grip, c.bike.lateral_g(c)), minf(float(m.get("max_lateral_g", 0.9)), tan(deg_to_rad(minf(55.0, float(m.get("max_lean_deg", 50))))))) * 0.9
		braking = minf(braking, 0.8) * pace
		c.bike.lean_from_bend = true
	# (its own speeds: the cars of a race differ, and it learns where it was too fast)
	_speeds = line.compute_speeds(lateral * Car.G * pace, braking * Car.G, 90.0).duplicate()
	_brake = braking * Car.G
	_base_speeds = _speeds.duplicate()
	# what an AI with this car learned on this track before (where it ran off the road), as factors on the speeds
	var f := _learned_path()
	if FileAccess.file_exists(f):
		var factors: Variant = bytes_to_var(FileAccess.get_file_as_bytes(f))
		if factors is PackedFloat32Array and factors.size() == _speeds.size():
			for i in _speeds.size():
				_speeds[i] = maxf(6.0, _base_speeds[i] * factors[i])
			RacingLine.brake_pass(_speeds, _brake)


## Keeps what it learned (the speeds as factors of those of the line) for the next time.
func save_learned() -> void:
	if _speeds.is_empty() or car == null:
		return
	var factors := PackedFloat32Array()
	factors.resize(_speeds.size())
	for i in _speeds.size():
		factors[i] = _speeds[i] / maxf(0.1, _base_speeds[i])
	DirAccess.make_dir_recursive_absolute(_learned_path().get_base_dir())
	var file := FileAccess.open(_learned_path(), FileAccess.WRITE)
	if file:
		file.store_buffer(var_to_bytes(factors))


func _learned_path() -> String:
	# (the AI of the tests, --ai, learns apart: not into what the AI of the player's races learned)
	var folder := "user://test-ai" if Content.arg("ai") != "" else "user://ai"
	return "%s/%s__%s__%d.learned" % [folder, car.get_meta("track_id", "track"), car.car_id, roundi(pace * 100)]


## Looks for the car on the line again (after a reset).
func lost() -> void:
	_index = -1
	_yaw_i = 0.0
	if pit != null:
		pit.reset()


func drive(dt: float) -> void:
	var xf := car.global_transform
	_index = line.nearest_facing(xf.origin, xf.basis.z) if _index < 0 else line.nearest(xf.origin, _index)
	var v := absf(car.speed)
	# the point to steer at
	var ahead := int((5.0 + v * 0.45) / RacingLine.STEP)
	if car.bike != null:
		ahead = int(clampf(3.0 + v * 0.75, 7.0, 35.0) / RacingLine.STEP)      # (Opponent.js: a bike leans into a bend before it turns)
	var target := line.point(_index + ahead)
	var want := _speeds[posmod(_index + int((3.0 + v * 0.3) / RacingLine.STEP), line.count())]
	# the pits (AIPit): a speed of the pit lane, and a point on the pit line or at the box to steer at
	var pits: Dictionary = pit.update(dt, _index, v) if pit != null else {}
	if not pits.is_empty():
		want = minf(want, float(pits["speed"]))
		if pits.has("target"):
			target = pits["target"]
	# the front tyres at their limit (understeer: the car runs wide): off the throttle, a little slower; and the
	# bend is learned: the line before here a little slower, for the next lap (what a driver learns, RacingLine.js factorOf)
	var front_s := maxf(car.wheels[0].s, car.wheels[1].s)
	if front_s > 1.0 and v > 8.0:
		want = minf(want, v - 1.5 * (front_s - 0.9))
	# (it learns when it ran off the road: a wheel on loose ground, away from the line; what it learned comes back
	# slowly while it stays on the road)
	var off_road := false
	for w in car.wheels:
		if w.contact and Content.surface(w.surface).get("loose", false):
			off_road = true
	if _index != _last_index:
		_speeds[_index] = minf(_base_speeds[_index], _speeds[_index] * 1.003)
		_last_index = _index
	var off_line := absf(_lane(_index, xf.origin))
	var off := off_road and off_line > 2.0 and v > 8.0 and absf(_side) < 0.5 and pits.is_empty()
	# (once for a trip off the road, when it starts)
	if off and not _was_off:
		for k in range(-30, 4):
			var j := posmod(_index + k, _speeds.size())
			_speeds[j] = maxf(6.0, _speeds[j] * 0.97)
		RacingLine.brake_pass(_speeds, _brake)
		_learned_at = _index
		RunLog.line("AI %s learned: slower before point %d (%.0f km/h, %.1f m off the line)" % [car.name, _index, v * 3.6, off_line])
	_was_off = off
	var inv := xf.affine_inverse()
	var cap := _traffic(xf, inv, v, dt)
	want = minf(want, cap)
	if pit != null:
		pit.waiting = cap < 0.5
	if not pits.is_empty():
		_side = 0.0
	if absf(_side) > 0.01 and not pits.has("target"):
		var nxt := line.point(_index + ahead + 1)
		var dir := Vector3(nxt.x - target.x, 0.0, nxt.z - target.z).normalized()
		target += Vector3(dir.z, 0.0, -dir.x) * _side     # (to the left of the line: +; x is to the left of forward)
	var local := inv * target
	# the angle to it in the plane of the car (x to the left, z forward): a positive angle is a turn to the left
	var angle := atan2(local.x, maxf(0.5, local.z))
	# pure pursuit: the curvature of the arc through the point, as a steering angle of the front wheels
	var dist := Vector2(local.x, local.z).length()
	var steer := atan(2.0 * car.wheelbase * sin(angle) / maxf(1.0, dist))
	# the tyres need a slip angle to turn the car (a soft tyre a large one): the yaw rate that the arc asks for against
	# the one the car has adds steering (less when the car turns too fast)
	var curvature := 2.0 * sin(angle) / maxf(1.0, dist)
	var yaw_error := v * curvature - car.angular_velocity.dot(xf.basis.y)
	_yaw_i = clampf(_yaw_i + yaw_error * dt, -0.6, 0.6)
	if car.bike == null:
		steer += 0.12 * yaw_error + 0.25 * _yaw_i
	else:
		# (a motorcycle, Opponent.js: a pull towards the line itself, scaled to the speed and damped by how fast it closes in)
		var beside := 0.0 if pits.has("target") else _lane(_index, xf.origin) - _side
		var rate := 0.0 if is_nan(_beside) else (beside - _beside) / maxf(dt, 1e-3)
		_beside = beside
		steer += clampf((-beside * 0.012 - rate * 0.01) * minf(1.0, 225.0 / maxf(225.0, v * v)), -0.05, 0.05)
	car.steer_direct = true
	car.steer_input = clampf(steer / car.max_steer, -1.0, 1.0)
	var err := want - v
	_speed_error_i = clampf(_speed_error_i + err * dt, -5.0, 5.0)
	var u := 0.6 * err + 0.1 * _speed_error_i
	# a driver's right foot: less throttle while the driven tyres are past their grip (the car would spin or the
	# wheels would only smoke) and while the wheels are turned far
	var slip := 0.0
	for w in car.wheels:
		if w.driven:
			slip = maxf(slip, w.s)
	var traction := clampf(1.8 - slip, 0.0, 1.0)
	# (not at low speed: a car that has to pull away round a bend needs its throttle)
	var lock := lerpf(1.0, clampf(1.3 - absf(car.steer_input) * 1.2, 0.3, 1.0), clampf(v / 3.0, 0.0, 1.0))
	car.throttle_input = clampf(u, 0.0, 1.0) * traction * lock
	if car.bike != null:
		# a motorcycle rolls the throttle on, and less of it the more it leans
		var max_lean := deg_to_rad(float(car.config.get("motorcycle", {}).get("max_lean_deg", 50)))
		_rolled = minf(minf(car.throttle_input, 1.0 - 0.7 * minf(1.0, absf(car.bike.lean) / max_lean)), _rolled + 2.5 * dt)
		car.throttle_input = _rolled
	car.brake_input = clampf(-u * 0.5, 0.0, 1.0) if err < -1.0 else 0.0
	car.handbrake_input = 0.0
	if pit != null and pit.at_stop:
		# in its box until the stop is done
		car.throttle_input = 0.0
		car.brake_input = 1.0 if v < 1.0 else maxf(car.brake_input, 0.2)


## The other cars (Opponent.js drive): the car ahead is passed on a side that is chosen once and kept until it is
## by (or a second without it ahead); the car in its path, close by along its heading or further along the line in
## its lane, gives the speed at which it can still stop behind it. Returns that speed (INF: none).
func _traffic(xf: Transform3D, inv: Transform3D, v: float, dt: float) -> float:
	var ahead: Car = null
	var ahead_along := INF
	var ahead_across := 0.0
	var blocker_along := INF
	var blocker_speed := 0.0
	var blocker_len := 4.5
	var my_lane := _lane(_index, xf.origin)
	var fwd := xf.basis.z
	var reach := maxf(25.0, v * 1.5)
	for o in others:
		if o == car or not is_instance_valid(o):
			continue
		var rel := inv * o.global_position
		var along := rel.z
		var across := rel.x
		if absf(rel.y) > 3.0:
			continue                        # (a bridge, an underpass)
		var box := 5.5 if o == _passing else 3.2
		if along > -2.0 and along < 22.0 and absf(across) < box and (along > 0.0 or o == _passing) and along < ahead_along:
			ahead = o
			ahead_along = along
			ahead_across = across
		var closing := maxf(0.0, o.linear_velocity.dot(fwd))
		var o_len := float(o.config.get("dimensions", {}).get("length", 4.2))
		if along > 1.5 and along < 10.0 and absf(across) < 2.2:
			if along < blocker_along:
				blocker_along = along
				blocker_speed = closing
				blocker_len = o_len
		elif along > 0.0 and rel.length() < reach + 5.0:
			var oi := line.nearest(o.global_position, _index)
			var on_line := posmod(oi - _index, line.count()) * RacingLine.STEP
			if on_line > 1.5 and on_line < reach and absf(_lane(oi, o.global_position) - my_lane) < 2.2 and on_line < blocker_along:
				blocker_along = on_line
				blocker_speed = closing
				blocker_len = o_len
	var side_want := 0.0
	if ahead != null:
		if ahead != _passing or _pass_side == 0.0:
			_passing = ahead
			_pass_side = -1.0 if ahead_across > 0.0 else 1.0
		_pass_for = 0.0
		side_want = _pass_side * 2.6
	elif _passing != null:
		_pass_for += dt
		if _pass_for < 1.0:
			side_want = _pass_side * 2.6
		else:
			_passing = null
			_pass_side = 0.0
	_side = move_toward(_side, side_want, dt * 1.5)
	if blocker_along == INF:
		return INF
	var my_len := float(car.config.get("dimensions", {}).get("length", 4.2))
	var gap := blocker_along - (my_len + blocker_len) / 2.0 - 0.3
	if gap < 2.0:
		return maxf(0.0, blocker_speed * 0.85 - (2.0 - gap))
	return blocker_speed + sqrt(2.0 * _brake * 0.8 * (gap - 2.0))


## How far to the left of the line a point is, at point i of the line.
func _lane(i: int, p: Vector3) -> float:
	var a := line.point(i)
	var b := line.point(i + 1)
	var d := Vector2(b.x - a.x, b.z - a.z)
	var l := maxf(1e-3, d.length())
	# (left of forward is + x in the car's terms; along the line (d.x, d.y) the left is (d.y, -d.x))
	return ((p.x - a.x) * d.y - (p.z - a.z) * d.x) / l


## How far along the line the car is (0..1 of a lap, from the first point).
func progress() -> float:
	return float(_index) / maxf(1.0, line.count())
