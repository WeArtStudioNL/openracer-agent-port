class_name CarEngine
extends RefCounted
## The engine: the torque curve of car.json ("engine.torque_curve", rpm and N m at full throttle), the friction
## that brakes it with the throttle shut, an idle control and the rev limiter. It turns with its own inertia;
## the clutch (Car.gd) couples it to the wheels.

var curve: Array = []          # [[rpm, N m], ...], sorted
var idle_rpm := 900.0
var limiter_rpm := 6500.0
var inertia := 0.2             # kg m2: the crank, the flywheel and what turns with them
var power_scale := 1.0
var omega := 0.0               # rad/s
var peak_torque := 1.0
var power_rpm := 5000.0
var cut := false               # the limiter cuts the fuel
var throttle_used := 0.0       # the throttle after the idle control and the limiter (for the sound)
var _cut_time := 0.0


func setup(e: Dictionary) -> void:
	curve = e.get("torque_curve", [[0, 0], [1000, 150], [4000, 250], [7000, 180]])
	curve.sort_custom(func(a, b): return a[0] < b[0])
	idle_rpm = float(e.get("idle_rpm", 900))
	limiter_rpm = float(e.get("limiter_rpm", 6500))
	power_scale = float(e.get("power_scale", 1))
	# (at least 0.06: lighter, one physics step at 120 Hz throws the engine speed around)
	inertia = maxf(0.06, float(e.get("inertia", 0.15)))
	peak_torque = 1.0
	var best := 0.0
	for p in curve:
		peak_torque = maxf(peak_torque, float(p[1]))
	# the rpm of the most power, where an automatic gearbox shifts up (a little past it: the next gear lands
	# under it), at most just under the limiter
	for r in range(int(idle_rpm), int(limiter_rpm) + 1, 50):
		if full_torque(r) * r > best:
			best = full_torque(r) * r
			power_rpm = r
	power_rpm = minf(limiter_rpm * 0.97, power_rpm * 1.06)
	omega = idle_rpm * PI / 30.0


func rpm() -> float:
	return omega * 30.0 / PI


## The torque at full throttle at this rpm.
func full_torque(r: float) -> float:
	if curve.is_empty():
		return 0.0
	if r <= curve[0][0]:
		return float(curve[0][1])
	for i in range(1, curve.size()):
		if r <= curve[i][0]:
			var a: Array = curve[i - 1]
			var b: Array = curve[i]
			var t := (r - float(a[0])) / maxf(1.0, float(b[0]) - float(a[0]))
			return lerpf(float(a[1]), float(b[1]), t)
	return float(curve[-1][1])


## The torque on the crank for the throttle (0..1): the curve, less the friction and the pumping that brake
## the engine more at high rpm. Holds the idle and cuts at the limiter.
func net_torque(throttle: float, dt: float) -> float:
	var r := rpm()
	var t := throttle
	# idle control: opens the throttle a little when the engine falls under its idle speed
	if r < idle_rpm:
		t = maxf(t, clampf((idle_rpm - r) / 250.0, 0.0, 1.0) * 0.35)
	# the limiter cuts the fuel for a moment
	if r >= limiter_rpm:
		_cut_time = 0.06
	_cut_time = maxf(0.0, _cut_time - dt)
	cut = _cut_time > 0.0
	if cut:
		t = 0.0
	throttle_used = t
	var friction := peak_torque * (0.04 + 0.12 * clampf(r / limiter_rpm, 0.0, 1.5))
	return t * full_torque(r) * power_scale - (1.0 - t) * friction
