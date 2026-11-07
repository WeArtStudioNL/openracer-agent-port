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
var _index := -1
var _speed_error_i := 0.0
var _side := 0.0                  # m to the side of the line, to pass a car


func setup(c: Car, l: RacingLine) -> void:
	car = c
	line = l
	if Content.arg("ai-pace") != "":
		pace = float(Content.arg("ai-pace"))
	var grip := 1.2 * float(c.config.get("tyres", {}).get("grip", 1.0))
	line.compute_speeds(grip * Car.G * pace, grip * Car.G * 0.75, 90.0)


## Looks for the car on the line again (after a reset).
func lost() -> void:
	_index = -1


func drive(dt: float) -> void:
	var xf := car.global_transform
	_index = line.nearest_facing(xf.origin, xf.basis.z) if _index < 0 else line.nearest(xf.origin, _index)
	var v := absf(car.speed)
	# the point to steer at
	var ahead := int((5.0 + v * 0.45) / RacingLine.STEP)
	var target := line.point(_index + ahead)
	var want := line.speeds[posmod(_index + int((3.0 + v * 0.3) / RacingLine.STEP), line.count())]
	# a car right ahead: back off to its speed, and move aside to the side that has more room from it
	var side_want := 0.0
	var inv := xf.affine_inverse()
	for o in others:
		if o == car or not is_instance_valid(o):
			continue
		var rel := inv * o.global_position
		var reach := 4.0 + v * 0.7
		if rel.z > 0.0 and rel.z < reach and absf(rel.x) < 2.4:
			var closing := v - absf(o.speed)
			if closing > -1.0:
				want = minf(want, absf(o.speed) + rel.z * 0.3)
				side_want = -2.8 if rel.x > 0.0 else 2.8
	_side = move_toward(_side, side_want, dt * 1.5)
	if absf(_side) > 0.01:
		var nxt := line.point(_index + ahead + 1)
		var dir := Vector3(nxt.x - target.x, 0.0, nxt.z - target.z).normalized()
		target += Vector3(dir.z, 0.0, -dir.x) * _side     # (to the left of the line: +; x is to the left of forward)
	var local := inv * target
	# the angle to it in the plane of the car (x to the left, z forward): a positive angle is a turn to the left
	var angle := atan2(local.x, maxf(0.5, local.z))
	# pure pursuit: the curvature of the arc through the point, as a steering angle of the front wheels
	var dist := Vector2(local.x, local.z).length()
	var steer := atan(2.0 * car.wheelbase * sin(angle) / maxf(1.0, dist))
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
	car.brake_input = clampf(-u * 0.5, 0.0, 1.0) if err < -1.0 else 0.0
	car.handbrake_input = 0.0


## How far along the line the car is (0..1 of a lap, from the first point).
func progress() -> float:
	return float(_index) / maxf(1.0, line.count())
