class_name Motorcycle
extends RefCounted
## Everything that makes a car a motorcycle ("type": "motorcycle" in car.json): the rider of web/js/Motorcycle.js
## (the model that the bikes of the game use; not the separate model "v2").
##
## The bike is the physics of the cars with a wheel at each end: the second wheel of each pair (FR, RR) is a lost
## wheel for good, the one that stays carries its end on the spring and the brakes of both, the drive goes to it
## alone (Vehicle.js soloWheels, done in car.gd). This controller is the rider:
##
## The input is a lean command (-1 to 1, the part of the lock that is turned: right is positive, as in the browser).
## The rider takes that lean, from 0 to max_lean_deg whatever the speed, with a delay, and keeps it with a torque
## about the long axis of the bike (a spring and a damper); he damps a yaw that the steering did not ask for. The
## front wheel is turned to the angle that a bend of the lean needs at this speed (a = g tan(lean), delta = L a / u^2),
## and to start a lean a little the other way (countersteering). A leaned tyre pushes the bike into the bend (the
## camber thrust). The rider moves on the bike (the posture): back on the brake, flat on the throttle, off the seat to
## the inside of a bend. The front brake is let off as the rear wheel loses its load, the rear brake goes with its
## load. The bike goes down past crash_lean_deg, in a lowside, a spin, a hit or a wheelie that goes over.

const G := 9.81
const DEG := PI / 180.0
## The rules of a crash (Motorcycle.CRASH_DEFAULTS; the panel of the 0 key in the browser, not here).
const CRASH := {
	"lowside_slip": 25.0, "lowside_lean": 25.0, "lowside_time": 2.0,
	"spin_rate": 4.0, "blow_g": 7.0, "hit_loss": 8.0,
}

var s: Dictionary = {}
# settings (readSettings)
var max_lean := 60.0 * DEG
var over_lean := 3.0 * DEG
var crash_lean := 78.0 * DEG
var balance := 1.0
var lean_speed := 1.0
var max_roll_rate := 90.0 * DEG
var lean_response := 0.1
var camber_thrust := 0.85
var stand_up := 0.18
var camera_roll_factor := 0.45
var key_rate := 2.0
var corner_brake := 0.2
var rider_mass := 80.0
var max_hang := 0.3
var counter_wait := 1.0
var counter_ramp := 1.5
var fast_from := 38.0
var fast_lean := 30.0 * DEG
var grip_g := 1.05
var front_comply := 3.0
var air_control := 1.0
var air_pitch_rate := 180.0 * DEG
var air_roll_rate := 120.0 * DEG
var air_yaw_rate := 70.0 * DEG
var air_level := 1.0
var air_gain := 8.0
var crown_radius := 0.1
var push := false
var push_extra_lean := 4.0 * DEG
var push_drift := 0.3
var push_foot := 110.0 / 3.6
var push_hang := -0.4
var style: Dictionary = {}

# state
## the posture of the rider (body space: lat to the left, long forward, drop up, m; tuck, sit, knee 0..1; look -1..1)
var posture := {"lat": 0.0, "long": 0.0, "drop": 0.0, "tuck": 0.0, "sit": 0.0, "knee": 0.0, "look": 0.0, "push": 0.0,
	"inside": 0.0, "lean": 0.0, "flat": 0.0}
var lean := 0.0                   # rad, to the left
var command := 0.0                # the lean that is asked (-1..1, right positive)
var target_lean := 0.0            # what the rider takes (rad, left positive)
var steer := 0.0                  # the angle of the front wheel (rad, right positive, as in the browser)
var front_brake := 1.0
var rear_brake := 1.0
var wheelie_scale := 1.0
var throttle_scale := 1.0         # what the wheelie control leaves of the throttle in this step
var roll := 0.0                   # the roll of the camera
var drift := 0.0
var burnout := 0.0
var crashed := false
var crash_reason := ""
var pushing := false              # the rider walks the bike back (no reverse gear)
var lean_from_bend := false       # the AI asks the angle of a bend, not a share of the lock (Opponent.js)
var foot_down := 0.0              # 0..1: the right foot on the road (at a standstill)
var foot_down_l := 0.0
var since_brake := 99.0
var complied := 0.0
var slide_time := 0.0
var brace := 0.0
var key_command := 0.0            # the keys bring the lean command over time
var rider_key := 0                # -1: the rider is put back, 1: forward (the keys < and >, set by world.gd)
var limp := false                 # the rider has gone limp on the bike (the key 9): no throttle, no steering, no balance
var rider_load = null             # Vector3 or null: the middle of the limp rider (his ragdoll), whose weight leans the bike
var counter_gain := 1.0
## the travel of the front wheel along the fork and of the rear wheel on the arc of the swingarm (forward over up,
## Vehicle.js forkSlope and swingSlope, from the model: MotorcycleModel), and fork_dive of car.json that scales it
var fork_slope := 0.0
var swing_slope := 0.0
var fork_dive := 1.0
var _foot_still := false
var _foot_wait := 0.0
var _road := Vector3.UP
var _accel := Vector3.ZERO
var _v_prev := Vector3.ZERO
var _have_prev := false
var _hist: Array = []             # [t, velocity, position] of the last tenth of a second
var _now := 0.0
var _rear_filt := -1.0
var _rear_prev := -1.0
var _rear_rate := 0.0
var _crash_speed := Vector3.ZERO
var _air_time := 0.0
var _last_flight := 0.0
var _flight_seen := 0.0


func _init(settings: Dictionary) -> void:
	retune(settings)


## The settings of car.json "motorcycle" (again when the tuning menu changes them).
func retune(settings: Dictionary) -> void:
	s = settings
	max_lean = _num("max_lean_deg", 60.0) * DEG
	over_lean = _num("over_lean_deg", 3.0) * DEG
	crash_lean = _num("crash_lean_deg", 78.0) * DEG
	balance = _num("balance", 1.0)
	lean_speed = clampf(_num("lean_speed", 1.0), 0.25, 4.0)
	max_roll_rate = _num("max_roll_rate_deg", 90.0) * DEG * lean_speed
	lean_response = _num("lean_response", 0.1) / lean_speed
	camber_thrust = _num("camber_thrust", 0.85)
	stand_up = _num("throttle_stand_up", 0.18)
	camera_roll_factor = _num("camera_roll", 0.45)
	key_rate = _num("key_steer_rate", 2.0) * lean_speed
	corner_brake = _num("corner_brake", 0.2)
	rider_mass = _num("rider_mass", 80.0)
	max_hang = _num("hang_off", 0.3)
	counter_wait = _num("counter_wait", 1.0)
	counter_ramp = _num("counter_ramp", 1.5)
	fast_from = _num("fast_from", 38.0)
	fast_lean = _num("fast_lean_deg", 30.0) * DEG
	grip_g = _num("grip_g", 1.05)
	front_comply = _num("front_comply", 3.0)
	air_control = maxf(0.0, _num("air_control", 1.0))
	air_pitch_rate = _num("air_pitch_rate_deg", 180.0) * DEG
	air_roll_rate = _num("air_roll_rate_deg", 120.0) * DEG
	air_yaw_rate = _num("air_yaw_rate_deg", 70.0) * DEG
	air_level = _num("air_level", 1.0)
	air_gain = _num("air_gain", 8.0)
	crown_radius = _num("crown_radius", 0.1)
	push = bool(s.get("push", false))
	push_extra_lean = _num("push_extra_lean_deg", 4.0) * DEG
	push_drift = _num("push_drift", 0.3)
	push_foot = _num("push_foot_kmh", 110.0) / 3.6
	push_hang = _num("push_hang", -0.4)
	fork_dive = maxf(0.0, _num("fork_dive", 1.0))
	style = {"upright": _num("push_upright", 0.55), "forward": _num("push_forward", 0.0), "chest_pitch": _num("push_chest_pitch", 0.0),
		"pelvis_slide": _num("push_pelvis_slide", 0.09), "foot_out": _num("push_foot_out", 0.14), "foot_forward": _num("push_foot_forward", 0.5),
		"pelvis_tilt": _num("push_pelvis_tilt", 35.0),
		"chest_roll": _num("hang_chest_roll", 14.0), "knee_out": _num("hang_knee_out", 0.6), "knee_down": _num("hang_knee_down", 0.5),
		"tuck_pitch": _num("hang_tuck_pitch", 28.0), "sit_pitch": _num("hang_sit_pitch", 10.0), "shift": _num("hang_shift", 0.7)}


func _num(key: String, default: float) -> float:
	return float(s.get(key, default))


static func smooth(lo: float, hi: float, x: float) -> float:
	var t := clampf((x - lo) / (hi - lo), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


## The mass of the rider (Motorcycle.riderMass): on top of the "mass" of car.json; 0 for a car.
static func rider_mass_of(cfg: Dictionary) -> float:
	if str(cfg.get("type", "car")) != "motorcycle":
		return 0.0
	return float(cfg.get("motorcycle", {}).get("rider_mass", 80.0))


## The lateral g that the lean of the bike can hold (the grip of the tyres, and the weight of the rider: hung off to
## the inside the bike needs less lean, pushed under him in flat-track style it needs more): what a skidpad would measure.
func lateral_g(car: Car) -> float:
	var share := rider_mass / car.mass
	var eps_full := atan(share * max_hang * (push_hang if _pushed() else 1.0) / car.cg_height)
	var lean_max := minf(max_lean + (push_extra_lean if _pushed() else 0.0), atan(grip_g) + over_lean)
	return tan(clampf(lean_max + eps_full, 0.1, 1.3))


## The limp rider is off the bike (beside it or on the road): nothing holds it up any more, it goes down as a body.
func fall_off(v: Vector3) -> void:
	if crashed:
		return
	crashed = true
	crash_reason = "limp-off"
	_crash_speed = v
	RunLog.event("motorcycle down (limp-off) at %.0f km/h" % (v.length() * 3.6))


## After a reset or a repair: the rider is back on the bike.
func recover() -> void:
	_hist.clear()
	slide_time = 0.0
	crashed = false
	crash_reason = ""
	foot_down = 0.0
	foot_down_l = 0.0
	limp = false
	rider_load = null
	_foot_still = false
	_foot_wait = 0.0
	brace = 0.0
	target_lean = 0.0
	steer = 0.0
	wheelie_scale = 1.0
	_have_prev = false
	_accel = Vector3.ZERO
	_rear_filt = -1.0
	_rear_prev = -1.0


## The riding style: flat track (car.json push, or the menu's "Flat-track style" for every bike) or hang off.
func _pushed() -> bool:
	return push or bool(Settings.get_value("bike_push"))


func _front_load(car: Car) -> float:
	return (car.wheels[0].load + car.wheels[1].load) / maxf(1.0, car.weight_front * car.mass * G)


## The road under the bike: the mean of the normals of the wheels on it (by their load), smoothed; in the air it
## goes back to the sky. (Once per step: dt 0 only reads it.)
func _road_of(car: Car, dt: float) -> Vector3:
	if dt <= 0.0:
		return _road
	var sum := Vector3.ZERO
	var sw := 0.0
	for w in car.wheels:
		if w.contact and w.load > 0.0:
			sum += w.normal * w.load
			sw += w.load
	if sw > 0.0:
		_road += (sum.normalized() - _road) * minf(1.0, dt / 0.15)
	else:
		_road += (Vector3.UP - _road) * minf(1.0, dt / 0.3)
	_road = _road.normalized()
	return _road


## The lean of the bike to the left from the road, how fast it falls to the left, and its axes.
func _lean_of(b: Basis, av: Vector3, n: Vector3) -> Dictionary:
	var up := b.y
	var fwd := b.z
	var side := b.x
	var flat := Vector3(fwd.x, 0.0, fwd.z).normalized()
	var l := n.cross(fwd)
	if l.length() < 0.2:
		l = side
	l = l.normalized()
	var sin_roll := clampf(-side.dot(n), -1.0, 1.0)
	var up_n := up.dot(n)
	var fwd_n := absf(fwd.dot(n))
	var lean_now := asin(sin_roll)
	if up_n < 0.0 and fwd_n < 0.7:
		lean_now = (PI if sin_roll >= 0.0 else -PI) - lean_now
	var a := fwd.normalized()
	return {"lean": lean_now, "rate": -av.dot(a), "flat": flat, "a": a, "l": l, "up_n": up_n, "nose_up": fwd.dot(n)}


## The angle of the front wheel for the physics (rad, left positive as the car has it), from the input (the part of
## the lock that is turned, left positive, or the angle of the AI). Motorcycle.js steering.
func steer_angle(car: Car, dt: float) -> float:
	var lock := car.max_steer
	var delta := 0.0
	if car.steer_direct or lean_from_bend:
		delta = -clampf(car.steer_input, -1.0, 1.0) * lock
	else:
		# (the keys bring the lean command faster than they turn the wheels of a car)
		var want := -clampf(car.steer_input, -1.0, 1.0)
		key_command = move_toward(key_command, want, dt * 2.2 * key_rate * float(Settings.get_value("key_steer_speed")))
		delta = key_command * lock
	return -_steering(car, delta, car.speed, dt)


func _steering(car: Car, delta: float, u: float, dt: float) -> float:
	if crashed:
		steer += (0.0 - steer) * minf(1.0, dt / 0.1)
		return steer
	if limp:
		# (nobody steers: the front wheel is let go and the tyres and the lean decide where the bike goes)
		steer += (0.0 - steer) * minf(1.0, dt / 0.3)
		return steer
	var lock := car.max_steer
	var c := clampf(delta / lock, -1.0, 1.0)
	command = c
	var xf := car.global_transform
	var st := _lean_of(xf.basis, car.angular_velocity, _road)
	var au := absf(u)
	var fast := smooth(1.5, 4.5, au)
	var cap := atan(u * u * tan(lock) / (car.wheelbase * G))
	var share := rider_mass / car.mass
	var eps_full := atan(share * max_hang * (push_hang if _pushed() else 1.0) / car.cg_height)
	var eps := atan(share * float(posture["lat"]) / car.cg_height)
	var brake := clampf(car.brake, 0.0, 1.0)
	# (the menu: Motorcycle: lean at top speed, for every bike; car.json fast_lean_deg without it)
	var menu_fast := float(Settings.get_value("bike_fast_lean"))
	var fast_lean_now := menu_fast * DEG if menu_fast > 0.0 else fast_lean
	var speed_max := max_lean - (max_lean - minf(max_lean, fast_lean_now)) * smooth(fast_from, fast_from + 22.0, au)
	var extra := push_extra_lean * (1.0 - smooth(14.0, 26.0, au)) * (1.0 - smooth(0.05, 0.4, brake)) if _pushed() else 0.0
	speed_max += extra
	# (the circle of grip: what the tyres give along the bike they cannot give sideways)
	var flat: Vector3 = st["flat"]
	var a_long := maxf(0.0, -_accel.dot(flat))
	var grip_max := grip_g * G * (1.0 - drift)
	speed_max = minf(speed_max, atan(sqrt(maxf(0.0, grip_max * grip_max - a_long * a_long)) / G) + over_lean + extra)
	var phi_max := speed_max + eps_full
	var want := -c * minf(phi_max, cap) * fast
	# (the AI asks the angle of the front wheel of a car on its path: the lean is the one that bend needs)
	if lean_from_bend:
		want = -signf(delta) * minf(phi_max, atan(u * u * tan(minf(absf(delta), 1.2)) / (car.wheelbase * G))) * fast
	_feet_step(dt, u, float(st["nose_up"]), not pushing)
	var bend := smooth(8.0 * DEG, 30.0 * DEG, absf(want))
	want *= 1.0 + corner_brake * brake * bend
	want = clampf(want, -phi_max, phi_max)
	want *= 1.0 - stand_up * clampf(car.throttle, 0.0, 1.0) * minf(1.0, absf(want) / (15.0 * DEG))
	var bike_want := clampf(want - eps * minf(1.0, absf(want) / (6.0 * DEG)), -speed_max, speed_max)
	var roll_step := (bike_want - target_lean) * minf(1.0, dt / lean_response)
	var roll_max := max_roll_rate * (1.0 + 2.5 * (1.0 - smooth(4.0, 12.0, au))) * dt
	target_lean += clampf(roll_step, -roll_max, roll_max)
	# the angle that a bend of the lean the bike has needs (to the left: negative), and the countersteer
	var lean_now := clampf(float(st["lean"]), -max_lean, max_lean)
	var phi_now := lean_now + eps * minf(1.0, absf(lean_now) / (6.0 * DEG))
	var a_bend := G * tan(minf(1.05, absf(phi_now)))
	var steady := -signf(phi_now) * atan(car.wheelbase * a_bend / maxf(u * u, 1.0))
	var c_limit := minf(0.07, 5.0 / maxf(u * u, 1.0))
	var counter := clampf(0.3 * (target_lean - float(st["lean"])), -c_limit, c_limit) * smooth(3.0, 10.0, au)
	var straight := 1.0 - smooth(2.0 * DEG, 6.0 * DEG, absf(target_lean))
	since_brake = 0.0 if brake > 0.05 else since_brake + dt
	# (lean only: the countersteer that starts a lean is the menu's "Countersteer + lean", off by default; it is not
	# used on the brake and comes back slowly after it)
	counter_gain = smooth(counter_wait, counter_wait + counter_ramp, since_brake)
	var pulse := counter_gain if str(Settings.get_value("bike_steering")) == "counter" else 0.0
	counter *= straight + (1.0 - straight) * pulse
	var geometric := c * lock
	var w := 1.0 - smooth(2.0, 5.0, au)
	# the front wheel castors into its own slip on the brake and in a slide (the rear keeps the bike straight)
	var slip_front := atan(car.wheels[0].slip_tan)
	var v_right := -car.linear_velocity.dot(xf.basis.x)
	var sliding := smooth(4.0 * DEG, 10.0 * DEG, absf(atan2(v_right, maxf(au, 1.0))))
	var upright := 1.0 - smooth(8.0 * DEG, 20.0 * DEG, absf(float(st["lean"])))
	var on_brake := maxf(smooth(0.05, 0.3, brake), sliding)
	# (the browser's slip is to the right; the tyre of the car here has it to the left)
	var comply := clampf(front_comply * slip_front, -0.12, 0.12) * smooth(3.0, 8.0, au) * upright * on_brake
	complied += (comply - complied) * minf(1.0, dt / 0.04)
	var wanted := w * geometric + (1.0 - w) * (steady + counter + complied)
	steer += (wanted - steer) * minf(1.0, dt / 0.05)
	return steer


## The feet at a standstill: both go down below 4 km/h and stay down until 5 km/h; then back on the pegs, the left
## one first.
func _feet_step(dt: float, u: float, nose_up: float, allowed: bool) -> void:
	var kmh := absf(u) * 3.6
	if not allowed or nose_up >= 0.5 or kmh > 5.0:
		_foot_still = false
	elif kmh < 4.0:
		_foot_still = true
	if _foot_still:
		_foot_wait = 0.0
		foot_down_l = minf(1.0, foot_down_l + dt / 0.7)
		foot_down = minf(1.0, foot_down + dt / 0.7)
	else:
		_foot_wait += dt
		foot_down_l = maxf(0.0, foot_down_l - dt / 0.7)
		if _foot_wait > 0.3:
			foot_down = maxf(0.0, foot_down - dt / 0.7)


## Once per step before the tyres: the wheelie control (the throttle) and the brakes (brakeStep).
func before_tyres(car: Car, dt: float) -> void:
	var u := car.speed
	# the wheelie control: the throttle is rolled off as the front goes light
	if crashed or limp:
		wheelie_scale = 0.0
		throttle_scale = 0.0
	else:
		var airborne := not (car.wheels[0].contact or car.wheels[2].contact)
		var on := bool(Settings.get_value("wheelie_control"))
		var want := clampf((_front_load(car) - 0.08) / 0.3, 0.15, 1.0) if on and not airborne and absf(u) > 0.5 and burnout < 0.5 else 1.0
		wheelie_scale += (want - wheelie_scale) * minf(1.0, dt / (0.03 if want < wheelie_scale else 0.25))
		# (at a walking pace with the bars far round: a third of the throttle)
		var slow_lock := smooth(0.3, 1.2, absf(u)) * (1.0 - smooth(2.0, 4.0, absf(u))) * smooth(0.6, 0.95, absf(command))
		throttle_scale = wheelie_scale * (1.0 - 0.67 * slow_lock)
	# the brakes: the front is let off as the rear wheel comes up, the rear goes with its load
	var m := car.mass
	var rear_ratio := car.wheels[2].load / maxf(1.0, (1.0 - car.weight_front) * m * G)
	var v_right := -car.linear_velocity.dot(car.global_transform.basis.x)
	var beta := atan2(v_right, maxf(absf(u), 1.0))
	var min_rear := 0.06 + 0.16 * maxf(maxf(smooth(0.15, 0.5, absf(command)), smooth(2.0 * DEG, 6.0 * DEG, absf(beta))), smooth(3.0 * DEG, 10.0 * DEG, absf(lean)))
	_rear_filt = rear_ratio if _rear_filt < 0.0 else _rear_filt + (rear_ratio - _rear_filt) * minf(1.0, dt / 0.02)
	_rear_prev = _rear_filt
	var target := clampf((_rear_filt - min_rear) / 0.16, 0.0, 1.0)
	var slide_off := 1.0 - 0.9 * smooth(5.0 * DEG, 12.0 * DEG, absf(beta))
	target *= slide_off
	# (the limit from the force: the braking force that the rear wheel keeps its load under, by statics)
	var fx_now := maxf(0.0, -(car.wheels[0].fx + car.wheels[2].fx))
	var f_max := m * G * (1.0 - car.weight_front) * (1.0 - min_rear) * car.wheelbase / maxf(0.3, car.cg_height) * 0.8
	var kf := f_max / fx_now if fx_now > f_max and fx_now > 1.0 else 1.0
	if kf < 1.0:
		front_brake += (minf(front_brake, target) * kf - front_brake) * minf(1.0, dt / 0.03)
	else:
		front_brake += (target - front_brake) * minf(1.0, dt / 0.3)
	if _rear_filt < min_rear * 0.5:
		front_brake *= maxf(0.0, 1.0 - dt / 0.04)
	var rear_target := clampf(rear_ratio * 1.2, 0.0, 1.0) * slide_off
	burnout = smooth(0.2, 0.6, car.throttle) * smooth(0.2, 0.5, car.brake) * (1.0 - smooth(2.0, 5.0, absf(u)))
	rear_target *= 1.0 - burnout
	rear_brake = minf(rear_target, rear_brake + dt / 0.3) if rear_target > rear_brake else rear_target
	if burnout > 0.5:
		front_brake = maxf(front_brake, burnout)
	# flat track: on the gas in a bend the rear tyre gives up a part of its grip across (the tail steps out)
	var drift_t := 0.0
	if _pushed() and push_drift > 0.0 and not limp:
		drift_t = push_drift * smooth(0.45, 0.9, car.throttle * wheelie_scale) * smooth(12.0 * DEG, 28.0 * DEG, absf(lean)) * (1.0 - smooth(18.0, 30.0, absf(u)))
	drift += (drift_t - drift) * minf(1.0, dt / 0.2)
	car.wheels[2].lat_grip = 1.0 - drift


## The fork and the swingarm (Vehicle.js feLoad): the wheel moves along the fork (up and back) and on the arc of the
## swingarm, so the road force along the wheel (the brake, the drive: last step's) loads the spring with its share
## along the travel: the fork dives under the brake, a swingarm with its pivot above the axle lifts the rear under
## power (anti-squat). The tyre gets the spring less that share (it goes through the rigid part of the fork), so the
## spring is pushed in further for the same load on the road. Returns that share (N).
func fork_load(car: Car, w: Car.Wheel, dt: float) -> float:
	var stat := (car.weight_front if w.front else 1.0 - car.weight_front) * car.mass * G
	var fe := clampf(fork_dive * (fork_slope if w.front else swing_slope) * w.fx, -1.5 * stat, 1.5 * stat)
	w.fe_load += (fe - w.fe_load) * minf(1.0, dt / 0.03)
	return w.fe_load


## The share of the brake of a wheel: in a bend the front brake stands the bike up, so it goes to a tenth (the one
## wheel of an end has the brakes of both).
func brake_scale(w: Car.Wheel) -> float:
	if crashed:
		return 0.0
	if not w.front:
		return rear_brake * 2.0
	return front_brake * (1.0 - 0.9 * smooth(8.0 * DEG, 30.0 * DEG, absf(lean))) * 2.0


## The air drag: a rider that sits up has more of it, one that lies flat less.
func drag_scale() -> float:
	return 1.0 + 0.35 * float(posture["sit"]) - 0.3 * float(posture["tuck"])


## The body of the bike does not touch the road in a lean: a narrow box, high off the road, until it is down (then
## the whole of it, and it slides on its side).
func fit_box(car: Car, box_node: CollisionShape3D) -> void:
	var box := box_node.shape as BoxShape3D
	var dims: Dictionary = car.config.get("dimensions", {})
	var r := car.wheels[0].radius
	var height := float(dims.get("height", 1.1))
	var full := crashed or absf(lean) > 1.15
	var width := float(dims.get("width", 0.7)) * 0.95 if full else 0.2
	var bottom := -r + (0.12 if full else 0.32)
	var size := Vector3(width, maxf(0.2, height - 0.05 - (bottom + r)), float(dims.get("length", 2.0)) * (0.97 if full else 0.8))
	if box.size.distance_to(size) > 0.02:
		box.size = size
		box_node.position = Vector3(0.0, bottom + size.y / 2.0, 0.0)


## The round crown of the tyre: a leaned wheel stands on its shoulder. Returns how far the road is from the hub
## along the axis of the suspension, and moves the contact to the inside of the lean.
func crown(w: Car.Wheel, up: Vector3) -> float:
	var cos_a := maxf(0.3, w.normal.dot(up))
	var rc := minf(crown_radius, 0.6 * w.radius)
	w.point += rc * (-w.normal + up / cos_a)
	return w.radius - rc + rc / cos_a


## The rider and the tyres, once per step (Motorcycle.js apply, airSteer and the crash brakeStep): forces and
## torques on the body.
func physics(car: Car, state: PhysicsDirectBodyState3D, dt: float) -> void:
	var xf := state.transform
	var b := xf.basis
	var v := state.linear_velocity
	var av := state.angular_velocity
	var up := b.y
	var u := car.speed
	var airborne := not (car.wheels[0].contact or car.wheels[2].contact)
	var st := _lean_of(b, av, _road_of(car, dt))
	lean = float(st["lean"])
	if airborne:
		_air_time += dt
	else:
		if _air_time > 0.0:
			_last_flight = _air_time
		_air_time = 0.0
	if not crashed:
		_crash_rules(car, st, v, xf.origin, u, dt)
	if crashed:
		posture["lat"] = 0.0
		posture["knee"] = 0.0
		posture["tuck"] = 0.0
		posture["sit"] = 0.0
		# a bike that is down slides and tumbles: the road takes its speed, it does not spin up
		var vmax := Vector2(_crash_speed.x, _crash_speed.z).length() + 1.0
		var hv := Vector2(v.x, v.z)
		if hv.length() > vmax:
			hv = hv * (vmax / hv.length())
		var sp := hv.length()
		var drop := 0.1 * dt * sp if airborne else minf(sp, (5.5 + 0.1 * sp) * dt)
		if sp > 1e-6:
			hv -= hv / sp * drop
		state.linear_velocity = Vector3(hv.x, minf(v.y, 3.0), hv.y)
		var spun := av * exp(-dt * 2.5)
		state.angular_velocity = spun.limit_length(8.0)
		# (one that still stands falls over, to the side it leans to)
		if absf(u) < 3.0 and absf(lean) < 1.0:
			var side := -1.0 if lean < -0.01 else 1.0
			state.apply_torque(-(st["a"] as Vector3) * side * 0.6 * car.mass * G * car.cg_height)
		return
	if airborne:
		if not limp:
			_air_steer(car, state, st, dt)
		return
	var m := car.mass
	if limp:
		# the rider does nothing: his weight off the middle of the bike leans it (the torque of the middle of his
		# ragdoll about the bike, at most half a metre of arm)
		posture["lat"] = 0.0
		posture["knee"] = 0.0
		posture["tuck"] = 0.0
		posture["sit"] = 0.0
		_have_prev = false
		if rider_load != null:
			var rel: Vector3 = (rider_load as Vector3) - xf.origin
			rel.y = 0.0
			if rel.length() > 0.5:
				rel = rel.normalized() * 0.5
			state.apply_torque(rel.cross(Vector3(0.0, -rider_mass * G, 0.0)))
		_camber(car, state, st, xf, 1.0 - clampf((absf(lean) - 1.2) / 0.25, 0.0, 1.0))
		return
	_rider(car, state, st, dt)
	var gh := m * G * car.cg_height
	var inertia := m * car.cg_height * car.cg_height + car.inertia.z
	# (a landing: the rider braces for a while after a flight of a quarter second or more)
	if _last_flight > 0.25 and _last_flight != _flight_seen:
		brace = 0.8
		_flight_seen = _last_flight
	if brace > 0.0:
		brace -= dt
	var braced := 1.0 + minf(1.0, brace / 0.5) if brace > 0.0 else 1.0
	var alive := 1.0 - clampf((absf(lean) - 1.2) / 0.25, 0.0, 1.0)
	var kp := balance * 10.0 * gh * braced
	var kd := 1.5 * sqrt(balance * 10.0 * gh * inertia) * braced
	var a: Vector3 = st["a"]
	var t_roll := alive * clampf(kp * (target_lean - lean) - kd * float(st["rate"]), -6.0 * gh * braced, 6.0 * gh * braced)
	state.apply_torque(-a * t_roll)
	# the yaw that the lean does not give is damped (a balanced bend: r = g tan(lean) / u)
	var brake := clampf(car.brake, 0.0, 1.0)
	var fast := smooth(1.5, 4.5, absf(u))
	if absf(u) > 2.0:
		var eps_now := atan((rider_mass / m) * float(posture["lat"]) / car.cg_height)
		var r_lean := -G * tan(clampf(lean + eps_now, -1.2, 1.2)) / maxf(absf(u), 4.0)
		var r := -av.dot(up)
		var yaw_err := r - r_lean
		var yaw_cap := (3000.0 + 6000.0 * smooth(0.2, 0.8, brake)) * braced
		var damp := clampf(balance * (car.inertia.y / 0.06) * yaw_err * fast * braced * (1.0 + 2.0 * smooth(0.2, 0.8, brake)), -yaw_cap, yaw_cap)
		state.apply_torque(Vector3.UP * damp)
	# no reverse gear: the rider walks the bike back, slowly; when the push stops he holds it with his feet
	var flat: Vector3 = st["flat"]
	if pushing:
		state.apply_central_force(flat * clampf(m * 3.0 * (-1.2 - u), -900.0, 900.0))
	elif u < -0.05 and u > -2.0 and car.throttle <= 0.05:
		state.apply_central_force(flat * minf(700.0, m * 4.0 * -u))
	_camber(car, state, st, xf, alive)


## The camber thrust: a leaned tyre pushes the bike to the inside of the bend, at its contact patch, shared as the
## weight is at rest (load times tan(lean), the whole of it at most twice the weight of the bike).
func _camber(car: Car, state: PhysicsDirectBodyState3D, st: Dictionary, xf: Transform3D, alive: float) -> void:
	var m := car.mass
	var camber := camber_thrust * tan(clampf(lean, -1.05, 1.05)) * alive
	var load_all := 0.0
	for w in car.wheels:
		if w.contact:
			load_all += w.load
	load_all = minf(load_all, 2.0 * m * G)
	var left: Vector3 = st["l"]
	for w in car.wheels:
		if not w.contact or w.load <= 0.0:
			continue
		var share_w := load_all * (car.weight_front if w.front else 1.0 - car.weight_front)
		state.apply_force(left * camber * share_w, w.point - xf.origin)


## The rules of a crash: past the lean, a lowside, a spin, a blow, a hit, on its back.
func _crash_rules(car: Car, st: Dictionary, v: Vector3, pos: Vector3, u: float, dt: float) -> void:
	_now += dt
	_hist.append([_now, v, pos])
	while _hist.size() > 2 and float(_hist[1][0]) < _now - 0.1:
		_hist.pop_front()
	var old: Array = _hist[0]
	var last: Array = _hist[_hist.size() - 2] if _hist.size() > 1 else old
	if Vector2(pos.x - (last[2] as Vector3).x, pos.z - (last[2] as Vector3).z).length() > 3.0:
		_hist = [[_now, v, pos]]
		old = _hist[0]
	var vo: Vector3 = old[1]
	var speed_old := Vector2(vo.x, vo.z).length()
	var speed_now := Vector2(v.x, v.z).length()
	var lost3 := vo.length() - v.length()
	var loss: float = CRASH["hit_loss"]
	var hit := speed_old - speed_now > loss and lost3 > loss and speed_old > 5.5
	var over := float(st["up_n"]) < -0.17
	var v_right := -v.dot(car.global_transform.basis.x)
	var beta := atan2(v_right, maxf(absf(u), 1.0))
	var rear := car.wheels[2]
	var powerslide := car.throttle > 0.2 and rear.omega * rear.radius - rear.forward_speed > 1.5
	var sliding: bool = absf(beta) > float(CRASH["lowside_slip"]) * DEG and absf(lean) > float(CRASH["lowside_lean"]) * DEG and absf(u) > 5.0 and not powerslide
	slide_time = slide_time + dt if sliding else 0.0
	var lowside := slide_time > float(CRASH["lowside_time"])
	var spin := absf(car.angular_velocity.dot(Vector3.UP)) > float(CRASH["spin_rate"]) and absf(u) > 5.0
	var blow := _accel.length() > float(CRASH["blow_g"]) * G
	var leaned := absf(lean) > (0.7 if limp else crash_lean)
	var still := limp and absf(u) < 0.5
	if leaned or still or over or lowside or spin or blow or hit:
		crashed = true
		crash_reason = "lean" if leaned else ("limp-still" if still else ("over" if over else ("lowside" if lowside else ("spin" if spin else ("blow" if blow else "hit")))))
		RunLog.event("motorcycle %s down (%s) at %.0f km/h, lean %.0f deg" % [car.name, crash_reason, v.length() * 3.6, lean / DEG])
		_crash_speed = vo if hit else v


## The rider on the bike: where he sits (the posture), and what his weight does to the bike where he is not where
## the centre of gravity was made for (m d x (g - a); the part about the long axis is left out).
func _rider(car: Car, state: PhysicsDirectBodyState3D, st: Dictionary, dt: float) -> void:
	var v := state.linear_velocity
	posture_step(dt, car.speed, clampf(car.throttle, 0.0, 1.0), clampf(car.brake, 0.0, 1.0), target_lean)
	if _have_prev and dt > 0.0:
		var acc := ((v - _v_prev) / dt).clamp(Vector3.ONE * -3.0 * G, Vector3.ONE * 3.0 * G)
		_accel += (acc - _accel) * minf(1.0, dt / 0.08)
	_have_prev = true
	_v_prev = v
	var d := state.transform.basis * Vector3(float(posture["lat"]), float(posture["drop"]), float(posture["long"]))
	var g := Vector3(0.0, -G, 0.0) - _accel
	var t := rider_mass * d.cross(g)
	var a: Vector3 = st["a"]
	state.apply_torque(t - a * t.dot(a))


## The posture of the rider from what the bike does: flat on the throttle, back on the brake, off the seat to the
## inside of a bend; the flat-track style keeps the body up and puts the inside foot out.
func posture_step(dt: float, u: float, thr: float, brk: float, lean_want: float) -> void:
	var p := posture
	var fwd_speed := maxf(0.0, u)
	var tuck := thr * smooth(12.0, 35.0, fwd_speed) * (1.0 - brk)
	var sit := brk * smooth(4.0, 20.0, fwd_speed)
	if rider_key != 0:
		# (the keys < and >: the rider back or forward while they are held)
		tuck = 1.0 if rider_key > 0 else 0.0
		sit = 1.0 if rider_key < 0 else 0.0
	var bend_t := smooth(8.0 * DEG, 40.0 * DEG, absf(lean_want)) * smooth(5.0, 12.0, absf(u))
	var hang_t := maxf(bend_t, smooth(3.0 * DEG, 12.0 * DEG, absf(lean_want)) * smooth(30.0, 50.0, absf(u)))
	var hang := signf(lean_want) * hang_t
	var pushed := _pushed()
	p["tuck"] += (tuck - float(p["tuck"])) * minf(1.0, dt / 0.35)
	p["sit"] += (sit - float(p["sit"])) * minf(1.0, dt / 0.25)
	p["lat"] += (hang * max_hang * (push_hang if pushed else 1.0) - float(p["lat"])) * minf(1.0, dt / 0.25)
	p["knee"] += ((0.0 if pushed else bend_t) - float(p["knee"])) * minf(1.0, dt / 0.3)
	var push_t := smooth(8.0 * DEG, 25.0 * DEG, absf(lean_want)) * (1.0 - smooth(0.8 * push_foot, push_foot, absf(u))) * smooth(1.5, 4.0, absf(u)) if pushed else 0.0
	p["push"] += (push_t - float(p["push"])) * minf(1.0, dt / 0.25)
	p["lean"] += (lean_want - float(p["lean"])) * minf(1.0, dt / 0.15)
	p["flat"] += ((1.0 if pushed else 0.0) - float(p["flat"])) * minf(1.0, dt / 0.3)
	p["inside"] += (signf(lean_want) * smooth(2.0 * DEG, 8.0 * DEG, absf(lean_want)) - float(p["inside"])) * minf(1.0, dt / 0.2)
	p["long"] += ((-0.22 * float(p["sit"]) + 0.12 * float(p["tuck"])) - float(p["long"])) * minf(1.0, dt / 0.3)
	p["drop"] += ((-0.09 * float(p["tuck"]) + 0.05 * float(p["sit"])) - float(p["drop"])) * minf(1.0, dt / 0.3)
	p["look"] += (clampf(lean_want / (35.0 * DEG), -1.0, 1.0) * smooth(2.0, 6.0, absf(u)) - float(p["look"])) * minf(1.0, dt / 0.2)


## The rider in the air: the gas turns the nose up, the brake down, the lean keys roll the bike; without input he
## levels it, lets the nose follow the flight and turns the bike to the way it flies (airSteer).
func _air_steer(car: Car, state: PhysicsDirectBodyState3D, st: Dictionary, dt: float) -> void:
	if not (air_control > 0.0) or dt <= 0.0:
		return
	var b := state.transform.basis
	var side := b.x
	var fwd := b.z
	var up := b.y
	var av := state.angular_velocity
	var v := state.linear_velocity
	var a := fwd.normalized()
	# (nose up positive; the rider forward brings the nose down)
	var ask := clampf(car.throttle - car.brake - 0.8 * signf(rider_key), -1.0, 1.0)
	var nose_rate := -av.dot(side)
	var lean_rate := -av.dot(a)
	var hs := Vector2(v.x, v.z).length()
	var flight_pitch := atan2(v.y, maxf(hs, 3.0))
	var nose_now := asin(clampf(fwd.y, -1.0, 1.0))
	var upright := up.y > 0.03
	var pitch_target := ask * air_pitch_rate if absf(ask) > 0.05 else (clampf(2.2 * air_level * (flight_pitch - nose_now), -1.2, 1.2) if upright else nose_rate)
	var cmd := clampf(command, -1.0, 1.0)
	var roll_target := -cmd * air_roll_rate if absf(cmd) > 0.05 else (
		clampf(3.0 * air_level * smooth(0.2, 0.45, _air_time) * (0.0 - float(st["lean"])), -air_roll_rate, air_roll_rate) if upright else lean_rate)
	var fh := Vector2(fwd.x, fwd.z).length()
	var aligning := upright and fh > 0.4 and hs > 3.0
	var yaw_target := 0.0
	if aligning:
		var head_err := atan2(fwd.z * v.x - fwd.x * v.z, fwd.x * v.x + fwd.z * v.z)
		yaw_target = air_level * smooth(3.0, 6.0, hs) * clampf(6.0 * head_err, -air_yaw_rate, air_yaw_rate)
	var g := air_gain * air_control
	var a_p := clampf(g * (pitch_target - nose_rate), -14.0 * air_control, 14.0 * air_control)
	var a_r := clampf(g * (roll_target - lean_rate), -18.0 * air_control, 18.0 * air_control)
	var fdx := av.y * fwd.z - av.z * fwd.y
	var fdz := av.x * fwd.y - av.y * fwd.x
	var head_rate := (fdx * fwd.z - fdz * fwd.x) / (fh * fh) if fh > 0.4 else av.y
	var a_y := clampf(g * (yaw_target - head_rate), -20.0 * air_control, 20.0 * air_control) if aligning else 0.0
	var inertia := car.inertia
	state.apply_torque(-side * a_p * inertia.x - a * a_r * inertia.z + Vector3.UP * a_y * inertia.y)


## The camera of the follow view rolls with a part of the lean, smoothed (cameraRoll).
func camera_roll(dt: float) -> float:
	var classic := str(Settings.get_value("bike_camera")) == "classic"      # (the menu: the chase camera of a car)
	roll += ((0.0 if classic else lean * camera_roll_factor) - roll) * minf(1.0, dt / 0.12)
	return roll
