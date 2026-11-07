class_name CarEngine
extends RefCounted
## The engine (web/js/Engine.js): the torque curve of car.json ("engine.torque_curve", rpm and N m at full
## throttle), the losses that brake it with the throttle shut (motoring), an idle controller, a pedal that opens
## the throttle plate faster than the torque grows, the rev limiter that cuts the fuel at a set rate (limiter_hz),
## and a turbo: a share of the torque that comes with boost (or a boost pressure in bar), which builds up over the
## spool time above a threshold speed. It turns with its own inertia; the clutch (Car.gd) couples it to the wheels.

var curve: Array = []          # [[rpm, N m], ...], sorted
var idle_rpm := 900.0
var limiter_rpm := 6500.0
var limiter_hz := 12.0
var inertia := 0.2             # kg m2: the crank, the flywheel and what turns with them
var power_scale := 1.0
var braking_scale := 1.0       # the engine braking, as a factor
var omega := 0.0               # rad/s
var peak_torque := 1.0
var power_rpm := 5000.0
var cut := false               # the limiter cuts the fuel
var throttle_used := 0.0       # the throttle after the idle control and the limiter (for the sound)
var no_fuel := false           # the tank is empty: no combustion
# the turbo
var turbo_share := 0.0
var turbo_spool := 0.4
var turbo_threshold := 2500.0
var turbo_bar := 0.0
var turbo_intercooler := 0.75
var turbo_efficiency := 0.7
var turbo_built := false
var boost := 0.0               # 0..1: how much of the boost is there
var _cut_time := 0.0
var _on_time := 1.0
var _cut_length := 0.05
var _motoring_scale := 1.0


func setup(e: Dictionary) -> void:
	curve = e.get("torque_curve", [[0, 0], [1000, 150], [4000, 250], [7000, 180]]).duplicate(true)
	curve.sort_custom(func(a, b): return a[0] < b[0])
	idle_rpm = float(e.get("idle_rpm", 900))
	limiter_rpm = float(e.get("limiter_rpm", 6500))
	limiter_hz = maxf(1.0, float(e.get("limiter_hz", 12)))
	power_scale = float(e.get("power_scale", 1))
	braking_scale = float(e.get("braking_scale", 1))
	# (at least 0.06: lighter, one physics step at 120 Hz throws the engine speed around)
	inertia = maxf(0.06, float(e.get("inertia", 0.15)))
	var turbo: Dictionary = e.get("turbo") if e.get("turbo") is Dictionary else {}
	# (no share: no turbo by share, also when the tuning menu set its spool or its threshold first; Engine.js takes
	# 0.5 for a turbo of car.json without a share)
	turbo_share = clampf(float(turbo.get("share", 0.0)), 0.0, 0.9)
	turbo_spool = float(turbo.get("spool", 0.4))
	turbo_threshold = float(turbo.get("threshold_rpm", 2500))
	turbo_bar = maxf(0.0, float(turbo.get("boost_bar", 0)))
	turbo_intercooler = float(turbo.get("intercooler", 0.75))
	turbo_efficiency = maxf(0.3, float(turbo.get("efficiency", 0.7)))
	turbo_built = e.has("build")
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
	_motoring_scale = clampf(peak_torque / 580.0, 0.3, 2.5)
	if omega == 0.0:
		omega = idle_rpm * PI / 30.0


func rpm() -> float:
	return omega * 30.0 / PI


## The engine speed of the most torque.
func peak_torque_rpm() -> float:
	var best := 0.0
	var at := 0.0
	for p in curve:
		if float(p[1]) > best:
			best = float(p[1])
			at = float(p[0])
	return at


func has_turbo() -> bool:
	return turbo_share > 0.0 or turbo_bar > 0.0


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


## The losses of the engine with the throttle shut (the engine braking), N m.
func motoring(r: float) -> float:
	return (30.0 + 0.0355 * r) * _motoring_scale * braking_scale


## The power as a factor for a boost pressure (bar above the atmosphere): the pressure ratio, the heat of the
## compressed air (the intercooler takes part of it off) and the back pressure of the exhaust.
func boost_factor(bar: float) -> float:
	if bar <= 0.0:
		return 1.0
	var t0 := 293.15
	var ratio := 1.0 + bar
	var out := t0 * (1.0 + (pow(ratio, 0.286) - 1.0) / turbo_efficiency)
	var manifold := out - turbo_intercooler * (out - t0)
	return ratio * (t0 / manifold) * (1.0 - 0.035 * bar)


## The boost builds up with the throttle open (above the threshold speed) over the spool time, and falls fast.
func update_boost(throttle: float, dt: float) -> void:
	_cut_time += dt
	_on_time += dt
	if not has_turbo():
		boost = 0.0
		return
	var r := rpm()
	var wanted := clampf(throttle, 0.0, 1.0) * (1.0 if turbo_built else clampf((r - turbo_threshold) / 2000.0, 0.0, 1.0))
	var tau := turbo_spool if wanted > boost else turbo_spool * 0.35
	boost += (wanted - boost) * minf(1.0, dt / maxf(0.01, tau))


## The torque on the crank for the pedal (0..1), after the idle control, the limiter and the turbo.
func net_torque(throttle: float, dt: float) -> float:
	update_boost(throttle, dt)
	var r := rpm()
	if no_fuel:
		throttle_used = 0.0
		return -motoring(r)
	# the idle controller opens the throttle to hold the idle speed, also against a load
	var idle_throttle := clampf(0.2 + (idle_rpm - r) * 0.0008, 0.0, 0.6)
	# the pedal opens the throttle plate faster than the torque grows: half a pedal is already 70 % of the air
	var pedal := 1.0 - pow(1.0 - clampf(throttle, 0.0, 1.0), 1.8)
	var t := maxf(pedal, idle_throttle)
	# the rev limiter cuts the fuel at the limit, and gives it back so that the cuts come limiter_hz times a second
	if cut:
		if _cut_time >= _cut_length:
			cut = false
			_on_time = 0.0
	elif r >= limiter_rpm:
		cut = true
		_cut_time = 0.0
		_cut_length = maxf(0.008, 1.0 / limiter_hz - _on_time)
	if cut:
		t = 0.0
	throttle_used = t
	var boosted := boost_factor(boost * turbo_bar) if turbo_bar > 0.0 else 1.0 - turbo_share * (1.0 - boost)
	return full_torque(r) * power_scale * boosted * t - (1.0 - t) * motoring(r)
