class_name CarEngine
extends RefCounted
## The engine (web/js/Engine.js): the torque curve of car.json ("engine.torque_curve", rpm and N m at full
## throttle), the losses that brake it with the throttle shut (motoring), an idle controller, a pedal that opens
## the throttle plate faster than the torque grows, the rev limiter that cuts the fuel at a set rate (limiter_hz),
## and a turbo: a share of the torque that comes with boost (or a boost pressure in bar), which builds up over the
## spool time above a threshold speed. It turns with its own inertia; the clutch (Car.gd) couples it to the wheels.

const EXTRAS_DEFAULTS := {
	"governor_on": false, "governor_rpm": 0,
	"pops_on": false, "pops_amount": 60, "pops_overrun": 2, "pops_rpm": 3000, "pops_loud": 100, "pops_flames": 100,
	"antilag_on": false, "antilag_mode": "lift", "antilag_boost": 60, "antilag_rpm": 3000, "antilag_time": 5, "antilag_bangs": 100, "antilag_fuel": 60,
}

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
var running := true            # it runs; a stalled engine only brakes until the starter turns it over again
var starting := false          # the starter cranks it
var stall_rpm := 360.0         # below this speed it stalls
var starter_torque := 150.0    # N m of the starter motor
# what a crash did to it (EngineDamage)
var health_scale := 1.0        # the torque as a factor
var friction_scale := 1.0      # the losses as a factor
var misfire_cut := false       # a misfire: no combustion for a moment
var disabled := false          # seized, or the ignition is ruined: it does not start
var last_torque := 0.0         # the net torque of the last step
var two_step_rpm := 4500.0
var launch_rpm := 3500.0
var hold_rpm := 0.0            # a lower limit the car asks for (the two-step, the launch control); 0: none
var holding := false           # the car holds the engine for a launch
## the extras of car.json (governor, pops and bangs, anti-lag: CarTuning.js FEATURE_DEFAULTS)
var extras := {}
var als_active := false        # the anti-lag works now
var fuel_factor := 1.0         # the fuel use as a factor (more while the anti-lag works)
var events: Array = []         # the bangs of this step: { strength, loud, flame } (the sound and the flames take them)
# the turbo
var turbo_share := 0.0
var turbo_spool := 0.4
var turbo_threshold := 2500.0
var turbo_bar := 0.0
var turbo_intercooler := 0.75
var turbo_efficiency := 0.7
var turbo_built := false
var boost := 0.0               # 0..1: how much of the boost is there
## the engine braking of Engine.js on the move (a car); a motorcycle keeps the lighter one of Godot: with the floor of
## Engine.js the rear of the Sports 600 went light on the brakes into the last bend of Kartbaan Oldenzaal and the AI
## ran wide on to the grass and fell (its braking_scale of 0.3 was set on the lighter engine braking)
var browser_braking := true
var _cut_time := 0.0
var _on_time := 1.0
var _cut_length := 0.05
var _motoring_scale := 1.0
var _motoring_browser := 1.0
var _overrun := 0.0
var _previous_throttle := 0.0
var _cut_was := false
var _als_timer := 0.0



func setup(e: Dictionary) -> void:
	curve = e.get("torque_curve", [[0, 0], [1000, 150], [4000, 250], [7000, 180]]).duplicate(true)
	curve.sort_custom(func(a, b): return a[0] < b[0])
	idle_rpm = float(e.get("idle_rpm", 900))
	stall_rpm = idle_rpm * 0.4
	limiter_rpm = float(e.get("limiter_rpm", 6500))
	limiter_hz = maxf(1.0, float(e.get("limiter_hz", 12)))
	power_scale = float(e.get("power_scale", 1))
	braking_scale = float(e.get("braking_scale", 1))
	# (as Engine.js: 0.4 when car.json has none; the clutch is solved implicitly in the small steps of CarDrivetrain, so
	# a light engine, 0.02 kg m2, is stable; at least 0.01)
	inertia = maxf(0.01, float(e.get("inertia", 0.4)))
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
	two_step_rpm = float(e.get("two_step_rpm", roundf(limiter_rpm * 0.7 / 100.0) * 100.0))
	launch_rpm = float(e.get("launch_rpm", roundf(limiter_rpm * 0.6 / 100.0) * 100.0))
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
	# (Engine.js has a floor of 0.3 here: a kart engine of 30 N m then loses more than its idle controller gives it,
	# and stalls and restarts at idle. Godot keeps 0.04 around idle, so it idles, and has the floor of Engine.js from
	# twice the idle speed up, so the engine braking of a small engine on the move is the browser game's; every
	# engine of more than 175 N m is as Engine.js has it)
	_motoring_scale = clampf(peak_torque / 580.0, 0.04, 2.5)
	_motoring_browser = clampf(peak_torque / 580.0, 0.3, 2.5)
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
	var k := lerpf(_motoring_scale, _motoring_browser, smoothstep(idle_rpm * 1.3, idle_rpm * 2.0, r)) if browser_braking else _motoring_scale
	return (30.0 + 0.0355 * r) * k * braking_scale * friction_scale


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


## The extras of car.json "extras" (the defaults of CarTuning.js where it has none).
func set_extras(x: Dictionary) -> void:
	extras = EXTRAS_DEFAULTS.duplicate()
	extras.merge(x, true)


## Pops and bangs and the anti-lag (stepExtras of Engine.js): unburnt fuel burns in the exhaust after lifting off
## the throttle, at every cut of the rev limiter, and while the anti-lag keeps the turbo spinning off the throttle.
func _step_extras(throttle: float, dt: float, r: float) -> void:
	var x := extras
	var pops_on := bool(x.get("pops_on", false))
	var als := bool(x.get("antilag_on", false)) and has_turbo()
	var off := throttle < 0.15
	var want_als := als and not no_fuel and r > float(x["antilag_rpm"]) and (holding if x["antilag_mode"] == "launch" else (off or holding))
	if want_als:
		_als_timer += dt
	elif not als or (throttle > 0.3 and not holding):
		_als_timer = 0.0
	als_active = want_als and _als_timer < float(x["antilag_time"])
	fuel_factor = 1.0 + float(x["antilag_fuel"]) / 100.0 if als_active else 1.0
	if _previous_throttle > 0.5 and throttle < 0.1 and r > float(x["pops_rpm"]):
		_overrun = float(x["pops_overrun"])
	if throttle > 0.3:
		_overrun = 0.0
	elif _overrun > 0.0:
		_overrun -= dt
	_previous_throttle = throttle
	var loud := float(x["pops_loud"]) / 100.0 if pops_on else 1.0
	var flame := float(x["pops_flames"]) / 100.0 if pops_on else 1.0
	var rate := 0.0
	if pops_on and r > float(x["pops_rpm"]) and _overrun > 0.0 and throttle < 0.1:
		rate = 14.0 * float(x["pops_amount"]) / 100.0 * sqrt(_overrun / maxf(0.1, float(x["pops_overrun"]))) * clampf(r / limiter_rpm, 0.3, 1.0)
	if als_active:
		rate = maxf(rate, 16.0 * float(x["antilag_bangs"]) / 100.0)
	if rate > 0.0 and randf() < rate * dt:
		_bang((0.8 if als_active else 0.5) + randf() * 0.7, loud, flame)
	if cut and not _cut_was:
		if (pops_on and randf() < float(x["pops_amount"]) / 100.0 * (1.0 if holding else 0.6)) or (als_active and randf() < 0.8 * float(x["antilag_bangs"]) / 100.0):
			_bang(0.7 + randf() * 0.6, loud, flame)
	_cut_was = cut


func _bang(strength: float, loud: float, flame: float) -> void:
	if events.size() < 40:
		events.append({"strength": strength, "loud": loud, "flame": flame})


## The boost builds up with the throttle open (above the threshold speed) over the spool time, and falls fast.
func update_boost(throttle: float, dt: float) -> void:
	_cut_time += dt
	_on_time += dt
	_step_extras(throttle, dt, rpm())
	if not has_turbo():
		boost = 0.0
		return
	var r := rpm()
	var wanted := clampf(throttle, 0.0, 1.0) * (1.0 if turbo_built else clampf((r - turbo_threshold) / 2000.0, 0.0, 1.0))
	if als_active:
		wanted = maxf(wanted, float(extras["antilag_boost"]) / 100.0 * minf(1.0, 0.4 + (r - float(extras["antilag_rpm"])) / 3000.0))
	var tau := turbo_spool if wanted > boost else turbo_spool * 0.35
	boost += (wanted - boost) * minf(1.0, dt / maxf(0.01, tau))


## The starter turns a stalled engine over (Engine.js start).
func start() -> void:
	if not running and not disabled:
		starting = true


## The torque on the crank for the pedal (0..1), after the idle control, the limiter and the turbo.
func net_torque(throttle: float, dt: float) -> float:
	update_boost(throttle, dt)
	var r := rpm()
	if no_fuel or disabled:
		running = false
		starting = false
	if not running:
		# no combustion: only the losses (and the starter motor while it cranks)
		throttle_used = 0.0
		var t0 := -motoring(r)
		if starting:
			t0 += starter_torque
			if r > 550.0:
				running = true
				starting = false
		return t0
	if r < stall_rpm:
		running = false
		starting = false
		throttle_used = 0.0
		return -motoring(r)
	# the idle controller opens the throttle to hold the idle speed, also against a load
	var idle_throttle := clampf(0.2 + (idle_rpm - r) * 0.0008, 0.0, 0.6)
	# the pedal opens the throttle plate faster than the torque grows: half a pedal is already 70 % of the air
	var pedal := 1.0 - pow(1.0 - clampf(throttle, 0.0, 1.0), 1.8)
	var t := maxf(pedal, idle_throttle)
	# the governor (an extra): around its engine speed the throttle closes gently, so the engine holds that speed
	if extras.get("governor_on", false) and float(extras.get("governor_rpm", 0)) > 0.0:
		t = minf(t, clampf((float(extras["governor_rpm"]) + 125.0 - r) / 250.0, 0.0, 1.0))
	# the rev limiter cuts the fuel at the limit (or at the speed the car holds the engine at for a launch), and gives
	# it back so that the cuts come limiter_hz times a second
	var limit := minf(hold_rpm, limiter_rpm) if hold_rpm > 0.0 else limiter_rpm
	if cut:
		if _cut_time >= _cut_length:
			cut = false
			_on_time = 0.0
	elif r >= limit:
		cut = true
		_cut_time = 0.0
		_cut_length = maxf(0.008, 1.0 / limiter_hz - _on_time)
	if cut or misfire_cut:
		t = 0.0
	throttle_used = t
	var boosted := boost_factor(boost * turbo_bar) if turbo_bar > 0.0 else 1.0 - turbo_share * (1.0 - boost)
	last_torque = full_torque(r) * power_scale * health_scale * boosted * t - (1.0 - t) * motoring(r) * (0.5 if als_active else 1.0)
	return last_torque


## The shift points of an automatic gearbox for its pattern (Vehicle.js shiftStyle): "sport" holds the gears longer,
## "drag" goes up at the rev limiter and does not kick down; then the limits of every pattern. Vector2(up, down) in rpm.
static func shift_pattern(style: String, up: float, down: float, limit: float, thr: float, prev_ratio: float) -> Vector2:
	if style == "sport":
		up = maxf(up, limit * (0.62 + 0.3 * thr))
		down = minf(maxf(down, limit * (0.3 + 0.2 * thr)), up / maxf(1.0, prev_ratio) * 0.9)
	elif style == "drag":
		up = limit * 0.965
		down = limit * 0.12
	# (the downshift not past where it would shift up again; the upshift under the rev limiter)
	down = minf(down, up / maxf(1.0, prev_ratio) * 0.9)
	return Vector2(minf(up, limit * (0.965 if style == "drag" else 0.94)), down)
