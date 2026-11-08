class_name SteerModel
extends RefCounted
## The steering of the keys, the gamepad stick and the touch screen as the browser game makes it (a car; a motorcycle
## has its own, Motorcycle): the angle of the front wheels, worked out here and given to the car as it is
## (car.steer_direct).
##
## The keys (Car.js): the wheels turn at the lock in the time of the settings (Keyboard, key_steer_time) at a
## standstill, slower at speed ("Slower at speed", key_slow: divided by 1 + (|u| / 4 - 1) x slow), three times as
## fast back the other way, and they centre themselves when the keys are let go (x 0.75 every 60th of a second). A
## key held at speed has a smaller lock (about half at 80 km/h, a fifth from 150 km/h). The keys move a raw angle;
## the car gets it along the curve of the settings (key_steer_curve). The assist (key_assist) is put on top and
## faded at 12 a second.
##
## The stick and the touch screen (controls.js): the stick is the steering one to one at a standstill; the wheels
## follow it at 6 rad/s divided by 1 + pad_slow x speed / 10 m/s, back towards the middle at 5 rad/s at least. The
## assist of the pad (pad_assist) is a part of the target; the touch screen has the assist of the keys on top.

var _mode := ""                    # "keys", "pad" or "touch": who steered last
var _raw := 0.0                    # the angle of the keys without the curve and the assist (Car.js keyRaw)
var _assist := 0.0                 # the assist on top (Car.js assistOffset, controls.js touchAssistOffset)
var _base := 0.0                   # the angle of the stick without the assist of the touch screen
var _last := INF                   # the angle given last: another hand (a reset, the countdown) wrote it when it differs


## The angle (rad, + to the left) for the keys: dir +1 left, -1 right, 0 none.
func keys(car: Car, dir: float, dt: float) -> float:
	_sync(car, "keys")
	var limit := car.max_steer
	var u := absf(car.speed)
	var t_speed := limit / maxf(0.05, float(Settings.get_value("key_steer_time")))
	var slow := float(Settings.get_value("key_slow"))
	var speed_factor := 1.0 + maxf(0.0, u / 4.0 - 1.0) * slow
	var lock := limit * maxf(0.2, 1.0 / (1.0 + pow(u / 22.0, 2.0) * slow))
	if dir == 0.0:
		_raw *= pow(0.75, dt * 60.0)
	elif dir * _raw < 0.0:
		_raw += dir * (t_speed * 3.0) / speed_factor * dt
	else:
		_raw += dir * t_speed / speed_factor * dt
		if absf(_raw) > lock:
			_raw = dir * lock
	var out := _raw
	var curve := float(Settings.get_value("key_steer_curve"))
	if curve > 0.0 and curve != 1.0:
		out = signf(_raw) * lock * pow(minf(1.0, absf(_raw) / lock), curve)
	var want := counter_steer(car) if bool(Settings.get_value("key_assist")) else 0.0
	_assist += (want - _assist) * minf(1.0, dt * 12.0)
	return _give(car, out + _assist)


## The angle for the stick of a gamepad or the stick of the touch screen: steer -1..1 (+ to the left).
func pad(car: Car, steer: float, dt: float, touch := false) -> float:
	_sync(car, "touch" if touch else "pad")
	var limit := car.max_steer
	var target := limit * clampf(steer, -1.0, 1.0)
	if not touch and bool(Settings.get_value("pad_assist")):
		target = clampf(target + counter_steer(car), -limit, limit)
	var rate := 6.0 / (1.0 + float(Settings.get_value("pad_slow")) * absf(car.speed) / 10.0)
	# back towards the middle the wheels go fast at any speed (the tyres straighten themselves): only steering out is slowed
	var towards_centre := absf(target) < absf(_base) and target * _base >= 0.0
	if towards_centre or target * _base < 0.0:
		rate = maxf(rate, 5.0)
	_base = move_toward(_base, target, rate * dt)
	if not touch:
		_assist = 0.0
		return _give(car, _base)
	var want := counter_steer(car) if bool(Settings.get_value("key_assist")) else 0.0
	_assist += (want - _assist) * minf(1.0, dt * 12.0)
	return _give(car, _base + _assist)


## The counter-steer of the assist: when the rear steps out, the front wheels point where the car goes (past two
## degrees of slip, 1.1 times the rest, at most 0.6 of the lock); driving forwards only.
static func counter_steer(car: Car) -> float:
	if car.speed <= 3.0:
		return 0.0
	var b := car.global_transform.basis
	var beta := atan2(car.linear_velocity.dot(b.x), car.linear_velocity.dot(b.z))      # (to the left of where it points: +)
	return clampf(signf(beta) * maxf(0.0, absf(beta) - 0.035) * 1.1, -0.6 * car.max_steer, 0.6 * car.max_steer)


## Another hand took the wheels (another mode, or the angle was written since): start from where they are.
func _sync(car: Car, mode: String) -> void:
	if mode != _mode or absf(car.steer_angle - _last) > 1e-4:
		_mode = mode
		_raw = car.steer_angle
		_base = car.steer_angle
		_assist = 0.0


func _give(car: Car, angle: float) -> float:
	_last = clampf(angle, -car.max_steer, car.max_steer)
	return _last
