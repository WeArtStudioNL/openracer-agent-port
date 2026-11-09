class_name DriverBody
extends RefCounted
## The driver of a car as a body in his seat (the give of the rider in Driver.js, and the muscles of its ragdoll): his trunk is a mass on a spring and a
## damper in the belts, his head a smaller one on the neck, so that he leans out of a bend, goes forward under the brakes and is thrown by a hit. A hard
## hit knocks him out for a moment: the hands leave the wheel and the arms hang as limbs (sticks, a folding limit, a weak tone of the muscles towards a
## neutral posture, damping, in the frame of the car with what the car does to them); then he comes round and takes the wheel again. It reads the motion
## of the car from frame to frame, so a replay has it too; it is only what is drawn.

const G := 9.81
const H := 1.0 / 240.0
const TRUNK_HZ := 1.5
const TRUNK_DAMP := 0.55
const TRUNK_PER_G := 0.05          # m of the trunk at 1 g
const TRUNK_LEAN := 110.0          # degrees of the chest per m of the trunk
const HEAD_HZ := 2.4
const HEAD_DAMP := 0.4
const HEAD_PER_G := 7.0            # degrees of the head at 1 g
const HIT_CAP := 30.0              # g: what a frame can ask of him
const KNOCK_G := 9.0               # g (over 40 ms): a hit that knocks him out
const KNOCK_TIME := 2.2            # s, and a little more for a harder hit
const TONE := 7.0                  # 1/s2: the muscles towards the neutral posture
const DAMP := 0.992                # of the speed of a limb, a step of H
const FOLD_LEAST := 0.5            # a share of the length of the arm: the elbow folds no further

var car: Car
var trunk := Vector3.ZERO          # m, in the frame of the car (left, up, forward)
var head := Vector2.ZERO           # degrees: x forward, y to the left
var knocked := 0.0                 # 0: he drives, 1: limp
var hands := {"left": Vector3.ZERO, "right": Vector3.ZERO}     # where the limp hands are (the frame of the body)
var elbows := {"left": Vector3.ZERO, "right": Vector3.ZERO}
var moving := false                # (the pose has to be worked out again)

var _trunk_v := Vector3.ZERO
var _head_v := Vector2.ZERO
var _acc := Vector3.ZERO
var _last_p := Vector3.ZERO
var _last_v := Vector3.ZERO
var _have := 0
var _timer := 0.0
var _left := 0.0
var _hand_q := {"left": Vector3.ZERO, "right": Vector3.ZERO}
var _elbow_q := {"left": Vector3.ZERO, "right": Vector3.ZERO}
var _ready_arms := false


func _init(c: Car) -> void:
	car = c


func chest_degrees() -> Vector3:
	return Vector3(trunk.z * TRUNK_LEAN, 0.0, -trunk.x * TRUNK_LEAN)


func head_degrees() -> Vector3:
	return Vector3(head.x, 0.0, -head.y)


## A frame. arms: { left: { shoulder, grip, upper, lower }, right: ... } in the frame of the body.
func step(dt: float, arms: Dictionary) -> void:
	if dt <= 0.0 or not is_instance_valid(car):
		return
	var pos := car.global_position
	var was_moving := moving
	if _have < 2 or pos.distance_to(_last_p) > 6.0:
		_last_v = (pos - _last_p) / dt if _have > 0 else Vector3.ZERO
		_last_p = pos
		_have += 1
		return
	var v := (pos - _last_p) / dt
	_last_p = pos
	var cap := HIT_CAP * G
	var a := ((v - _last_v) / dt).clamp(-Vector3.ONE * cap, Vector3.ONE * cap)
	_last_v = v
	_acc += (a - _acc) * minf(1.0, dt / 0.04)
	var b := car.global_transform.basis.orthonormalized()
	var body_a := Vector3(_acc.dot(b.x), _acc.dot(b.y), _acc.dot(b.z))
	var down := Vector3(Vector3.DOWN.dot(b.x), Vector3.DOWN.dot(b.y), Vector3.DOWN.dot(b.z)) * G
	if _acc.length() > KNOCK_G * G and _timer < KNOCK_TIME:
		if _timer <= 0.0:
			_start_arms(arms)
		_timer = KNOCK_TIME + minf(2.0, (_acc.length() / G - KNOCK_G) * 0.1)
	_timer = maxf(0.0, _timer - dt)
	var want := 1.0 if _timer > 0.0 else 0.0
	knocked = move_toward(knocked, want, dt / (0.08 if want > knocked else 0.7))
	var w := TAU * TRUNK_HZ
	var gain := TRUNK_PER_G / G * w * w
	var wh := TAU * HEAD_HZ
	var gain_h := HEAD_PER_G / G * wh * wh
	var n := maxi(1, ceili(dt * 120.0))
	var h := dt / n
	var droop := 32.0 * knocked
	for _i in n:
		_trunk_v += (-w * w * trunk - 2.0 * TRUNK_DAMP * w * _trunk_v - gain * body_a) * h
		trunk += _trunk_v * h
		var pull := Vector2(-body_a.z * gain_h, -body_a.x * gain_h)
		var soft := 1.0 - 0.65 * knocked
		var k := wh * wh * soft
		_head_v += (Vector2(droop, 0.0) * k - head * k - 2.0 * HEAD_DAMP * wh * _head_v + pull) * h
		head += _head_v * h
	for axis in 3:
		var lo: float = [-0.14, -0.1, -0.06][axis]
		var hi: float = [0.14, 0.05, 0.22][axis]
		if trunk[axis] < lo:
			trunk[axis] = lo
			_trunk_v[axis] = maxf(0.0, _trunk_v[axis])
		elif trunk[axis] > hi:
			trunk[axis] = hi
			_trunk_v[axis] = minf(0.0, _trunk_v[axis])
	head = head.clamp(Vector2(-35.0, -40.0), Vector2(55.0, 40.0))
	if knocked > 0.0:
		_arms(dt, arms, down - body_a)
	moving = knocked > 0.0 or trunk.length() > 0.002 or _trunk_v.length() > 0.01 or absf(head.x) + absf(head.y) > 0.2 or was_moving and _head_v.length() > 0.3


func _start_arms(arms: Dictionary) -> void:
	_ready_arms = true
	for side: String in arms:
		var a: Dictionary = arms[side]
		var s: Vector3 = a["shoulder"]
		var g: Vector3 = a["grip"]
		hands[side] = g
		_hand_q[side] = g
		var e := s.lerp(g, 0.5) + Vector3(0.0, -0.08, 0.0)
		elbows[side] = e
		_elbow_q[side] = e


## The arms as limbs: the speed they had, what the car does to them, the muscles and the sticks, in small steps.
func _arms(dt: float, arms: Dictionary, pull: Vector3) -> void:
	if not _ready_arms:
		_start_arms(arms)
	_left += dt
	var n := mini(12, floori(_left / H + 1e-4))
	_left = maxf(0.0, _left - n * H)
	var h2 := H * H
	for _i in n:
		for side: String in arms:
			var a: Dictionary = arms[side]
			var s: Vector3 = a["shoulder"]
			var upper: float = a["upper"]
			var lower: float = a["lower"]
			var neutral: Vector3 = s + Vector3(0.0, -upper * 0.9, lower * 0.75)
			var hand: Vector3 = hands[side]
			var elbow: Vector3 = elbows[side]
			var hq: Vector3 = _hand_q[side]
			var eq: Vector3 = _elbow_q[side]
			var hv := (hand - hq) * DAMP
			var ev := (elbow - eq) * DAMP
			hq = hand
			eq = elbow
			hand += hv + (pull + (neutral - hand) * TONE) * h2
			elbow += ev + pull * h2
			for _k in 3:
				elbow = s + (elbow - s).normalized() * upper
				var d := hand - elbow
				if d.length() > 1e-6:
					var off := d.normalized() * (d.length() - lower) * 0.5
					elbow += off
					hand -= off
				var reach := hand - s
				var least := (upper + lower) * FOLD_LEAST
				if reach.length() < least and reach.length() > 1e-6:
					hand = s + reach.normalized() * least
			hands[side] = hand
			elbows[side] = elbow
			_hand_q[side] = hq
			_elbow_q[side] = eq
