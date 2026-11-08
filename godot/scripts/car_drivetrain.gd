class_name CarDrivetrain
extends RefCounted
## The gearbox, the clutch, the engine, the differentials, the brakes and the wheel speeds of a car: Vehicle.js of the
## browser game line for line (updateControls: the automatic gearbox, the CVT and the timing of a shift; step: the
## ABS, the throttle and the clutch through a shift, the clutch or the torque converter solved implicitly with the
## engine, the differentials between the wheels and between the axles, and the wheel speeds). Godot steps it in steps of Car.SUBSTEP
## times in a step of the physics (the simple tyre) or in the small steps of the shell tyre.


static func _smooth(lo: float, hi: float, x: float) -> float:
	var t := clampf((x - lo) / (hi - lo), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


## The engine speed of the peak torque above idle (Vehicle.peakTorqueRPM), for the gearbox.
static func peak_torque_rpm(e: CarEngine) -> float:
	var best := -1.0
	var at := 0.0
	for p in e.curve:
		if float(p[1]) > best and float(p[0]) > e.idle_rpm:
			best = float(p[1])
			at = float(p[0])
	return at


## The radius of the driven wheels (Vehicle.drivenRadius).
static func driven_radius(c: Car) -> float:
	var sum := 0.0
	var n := 0
	for w in c.wheels:
		if w.driven and not w.lost:
			sum += w.radius
			n += 1
	return sum / n if n > 0 else c.wheels[0].radius


## Once a step of the physics (updateControls of Vehicle.js): the ratio of a CVT, the automatic gearbox, and the timer
## of a shift (every change of the gear, by the driver or the gearbox, is a shift of shift_time; a dual clutch 0.08 to
## 0.15 s, an automated manual half a second at least).
static func controls(c: Car, dt: float) -> void:
	var gears := c.gear_ratios.size()
	c.gear = mini(c.gear, gears)
	c.since_shift += dt
	var thr := clampf(c.throttle, 0.0, 1.0)
	var u := c.speed
	if c.gearbox == "cvt":
		_cvt(c, dt, thr)
	elif not c.manual and c.gear > 0:
		_automatic(c, dt, thr, u, gears)
	var key := c.gear
	if c.last_gear_key != -99 and key != c.last_gear_key:
		c.since_shift = 0.0
		c.shift_up = key > 0 and c.last_gear_key > 0 and key > c.last_gear_key
		if c.gearbox == "dct":
			c.shift_duration = clampf(c.shift_time, 0.08, 0.15)
		elif c.gearbox == "amt":
			c.shift_duration = maxf(0.5, c.shift_time)
		else:
			c.shift_duration = c.shift_time
		c.shift_timer = c.shift_duration
	c.last_gear_key = key
	if c.shift_timer > 0.0:
		c.shift_timer -= dt


## The CVT: the ratio that holds the engine at the speed the throttle asks for, from the speed of the road (not of
## spinning wheels), changing by at most e^cvt_rate a second.
static func _cvt(c: Car, dt: float, thr: float) -> void:
	var lo := maxf(c.cvt_low, c.cvt_high)
	var hi := minf(c.cvt_low, c.cvt_high)
	var idle := c.engine.idle_rpm
	var top := c.cvt_rpm if c.cvt_rpm > 0.0 else c.engine.limiter_rpm * 0.85
	var brk := clampf(c.brake, 0.0, 1.0)
	var want_rpm := idle + (top - idle) * pow(thr, 0.6) if thr > 0.05 else idle + (top - idle) * (0.18 + 0.3 * brk)
	var road_omega := maxf(0.5, absf(c.speed)) / driven_radius(c)
	var want := clampf((want_rpm * PI / 30.0) / (road_omega * c.final_drive), hi, lo)
	var pace := exp(c.cvt_rate * dt)
	c.cvt_ratio = maxf(c.cvt_ratio / pace, minf(c.cvt_ratio * pace, want))
	if c.gear <= 0:
		c.cvt_ratio = lo


## The automatic gearbox (Vehicle.js): up at a share of the limiter that grows with the throttle (not under a quarter
## above the peak torque), down where the engine is still in its torque band, the shift style (sport, drag), and up
## after a moment on the limiter with the wheels spinning.
static func _automatic(c: Car, dt: float, thr: float, u: float, gears: int) -> void:
	var g := c.gear - 1
	var ratio := absf(c.gear_total())
	var rpm := maxf(0.0, u) / driven_radius(c) * ratio * 30.0 / PI
	if c.since_shift <= 0.6:
		return
	var limit := c.engine.limiter_rpm
	var up_rpm := limit * (0.45 + 0.42 * thr)
	var down_rpm := limit * (0.23 + 0.17 * thr)
	var next_ratio := float(c.gear_ratios[g + 1]) / float(c.gear_ratios[g]) if g < gears - 1 else 1.0
	var prev_ratio := float(c.gear_ratios[g - 1]) / float(c.gear_ratios[g]) if g > 0 else 1.0
	var peak := peak_torque_rpm(c.engine)
	if peak > 0.0:
		up_rpm = maxf(up_rpm, peak * 1.25)
		down_rpm = minf(peak * (0.6 + 0.3 * thr), up_rpm / maxf(1.0, prev_ratio) * 0.9)
	if c.shift_style == "sport":
		up_rpm = maxf(up_rpm, limit * (0.62 + 0.3 * thr))
		down_rpm = minf(maxf(down_rpm, limit * (0.3 + 0.2 * thr)), up_rpm / maxf(1.0, prev_ratio) * 0.9)
	elif c.shift_style == "drag":
		up_rpm = limit * 0.965
		down_rpm = limit * 0.12
	down_rpm = minf(down_rpm, up_rpm / maxf(1.0, prev_ratio) * 0.9)
	up_rpm = minf(up_rpm, limit * (0.965 if c.shift_style == "drag" else 0.94))
	var engine_rpm := c.engine.rpm()
	var shift_rpm := rpm
	if c.gearbox == "torque-converter" and c.tc_lock < 0.9 and thr > 0.5:
		shift_rpm = maxf(rpm, engine_rpm)
	var spin := 0.0
	for w in c.wheels:
		if w.driven and w.slip_ratio > spin:
			spin = w.slip_ratio
	var slipping := c.gearbox == "torque-converter" and c.tc_lock < 0.9 and spin < 0.2
	var spinning := ((engine_rpm >= limit * 0.8 and engine_rpm > rpm * 1.1 + 100.0 and not slipping) or engine_rpm >= limit * 0.97) \
		and thr > 0.5 and u > 1.0 and c.engine.hold_rpm <= 0.0
	c.limiter_time = c.limiter_time + dt if spinning else maxf(0.0, c.limiter_time - dt * 0.3)
	c.no_downshift = maxf(0.0, c.no_downshift - dt)
	if g < gears - 1 and c.limiter_time > 0.35:
		c.gear += 1
		c.limiter_time = 0.0
		c.no_downshift = 3.0
	elif g < gears - 1 and shift_rpm > up_rpm and rpm * next_ratio > 0.35 * limit and u > 1.0:
		c.gear += 1
	elif g > 0 and ((rpm < down_rpm and rpm * prev_ratio < 0.86 * limit and c.no_downshift <= 0.0) or (u < 1.5 and thr < 0.1)):
		c.gear -= 1


## One small step of the brakes, the engine, the clutch, the differentials and the wheel speeds (step of Vehicle.js).
## tyre_torque: the torque of the road on each wheel (N m).
static func step(c: Car, dt: float, tyre_torque: Array) -> void:
	var wheels := c.wheels
	var e := c.engine
	# ---- the brakes, with ABS (it lets a wheel go that slips back past the peak of the tyre)
	var brake_torque := [0.0, 0.0, 0.0, 0.0]
	for i in 4:
		var w := wheels[i]
		if c.abs_on and c.abs_fitted and c.brake > 0.05 and w.contact and w.slip_ratio < -0.08 and w.s > 1.1 and absf(w.forward_speed) > 2.0:
			w.abs_factor = maxf(0.05, w.abs_factor - 15.0 * dt)
		else:
			w.abs_factor = minf(1.0, w.abs_factor + 8.0 * dt)
		var bt: float = c.brake * w.max_brake * w.abs_factor * (c.bike.brake_scale(w) if c.bike != null else 1.0)
		if not w.front:
			bt = maxf(bt, c.handbrake_input * w.max_brake * w.abs_factor) if c.bike != null else bt + c.handbrake_input * 1800.0
		if c.transbrake_held and w.driven:
			bt = maxf(bt, 4000.0)          # (the transbrake holds the driven wheels)
		brake_torque[i] = bt + c.esc_brake[i]

	# ---- the throttle as the engine gets it: less by the traction and the stability control, and through a shift
	var gs := c.gear_total()
	var drive_speed := 0.0
	if gs != 0.0:
		for k in 4:
			drive_speed += c.shares[k] * wheels[k].omega
	var drive_rpm := maxf(0.0, gs * drive_speed) * 30.0 / PI
	var thr: float = c.throttle * c.tc_factor * (1.0 - 0.85 * c.esc_cut) * (c.bike.throttle_scale if c.bike != null else 1.0)
	if c.shift_timer > 0.0:
		if c.gearbox == "dct":
			# (a dual clutch: a short cut on the way up, a blip on the way down until the engine has the speed of the gear)
			if c.shift_up:
				thr *= 0.35
			elif e.rpm() < drive_rpm * 0.97:
				thr = maxf(thr, 0.45)
		else:
			thr *= 0.6 if c.gearbox == "torque-converter" else 0.15
	# a stalled engine starts again by itself (no clutch pedal here: Vehicle.js restarts it automatically then)
	if not e.running and not e.starting:
		e.start()
	var te := e.net_torque(thr, dt)
	var je := e.inertia

	# ---- the clutch: it closes with the engine speed or the speed the wheels ask for, and opens through a shift
	var engagement := _smooth(c.clutch_start, c.clutch_full, maxf(e.rpm(), drive_rpm))
	if c.shift_timer > 0.0:
		var ts := c.shift_timer
		if c.gearbox == "dct":
			engagement = minf(engagement, 0.4 + 0.6 * (1.0 - ts / maxf(0.01, c.shift_duration)))
		else:
			engagement = minf(engagement, 0.0 if ts > 0.14 else 1.0 - _smooth(0.0, 0.14, ts))
	if c.held_for_launch():
		engagement = 0.0
	elif c.launch_release > 0.0:
		engagement = minf(engagement, 1.0 - c.launch_release / 0.15)
		c.launch_release = maxf(0.0, c.launch_release - dt)
	c.clutch_engagement = engagement

	# ---- the engine and the clutch solved implicitly: stable for a clutch that is locked
	var tc := 0.0
	var td := 0.0
	var converter := c.gearbox == "torque-converter"
	if gs != 0.0:
		var cap := c.clutch_capacity * engagement
		var omega_s := 0.0
		var inv_jd := 0.0
		var a_ext := 0.0
		for k in 4:
			var sh: float = c.shares[k]
			if sh == 0.0:
				continue
			var wk := wheels[k]
			var ext: float = tyre_torque[k] - brake_torque[k] * tanh(wk.omega / 0.5)
			# (the inertia of the wheel with the grip of the tyre, as the wheel step below takes it)
			var ik := wk.inertia + dt * wk.tyre_slope
			omega_s += gs * sh * wk.omega
			inv_jd += gs * gs * sh * sh / ik
			a_ext += gs * sh * ext / ik
		var k_cl := cap / 1.5
		var base := e.omega - omega_s + dt * (te / je - a_ext)
		var den := 1.0 + dt * k_cl * (1.0 / je + inv_jd)
		tc = k_cl * base / den
		if absf(tc) > cap:
			tc = cap * (1.0 if base > 0.0 else -1.0)
		td = tc
		if converter:
			# the fluid coupling: the pump on the engine, the turbine on the gearbox; it multiplies the torque while it
			# slips, creeps at idle, and a lock-up clutch closes it at speed
			var we := maxf(1.0, e.omega)
			var sr := clampf(omega_s / we, -1.0, 2.0)
			var stall := (c.tc_stall_rpm if c.tc_stall_rpm > 0.0 else e.limiter_rpm * 0.35) * PI / 30.0
			var ccoef := e.peak_torque * e.power_scale / (stall * stall)
			var idle_w := e.idle_rpm * PI / 30.0
			var soft := 0.16 + 0.84 * _smooth(idle_w * 1.05, idle_w * 1.9, we)
			var tp := ccoef * we * we * (1.0 - sr) * soft * (0.5 if sr > 1.0 else 1.0)
			var tr := 1.0 + (c.tc_ratio - 1.0) * maxf(0.0, 1.0 - maxf(0.0, sr) / 0.85)
			var tt := tp * (tr if sr < 1.0 else 1.0)
			if c.held_for_launch() or c.launch_release > 0.0:
				tp = 0.0
				tt = 0.0
			var u := absf(c.speed)
			var want_lock := 1.0 if c.tc_lockup and u > 7.0 and sr > 0.93 and sr < 1.07 and c.shift_timer <= 0.0 and not (c.throttle > 0.9 and u < 15.0) else 0.0
			if c.shift_timer > 0.0 or u < 5.0:
				want_lock = 0.0
			c.tc_lock += (want_lock - c.tc_lock) * minf(1.0, dt / (0.3 if want_lock > 0.0 else 0.1))
			tc = c.tc_lock * tc + (1.0 - c.tc_lock) * tp
			td = c.tc_lock * td + (1.0 - c.tc_lock) * tt
			c.tc_slip = sr
	elif converter:
		c.tc_lock = 0.0
		c.tc_slip = 0.0
	e.omega = clampf(e.omega + dt * (te - tc) / je, 0.0, (e.limiter_rpm + 1000.0) * PI / 30.0)
	var drive_total := td * gs * c.efficiency
	var wheel_drive := [0.0, 0.0, 0.0, 0.0]
	for k in 4:
		wheel_drive[k] = drive_total * c.shares[k]

	# ---- the differentials: between the axles (four wheel drive, "lsd"), and between the wheels of an axle ("lsd"; the
	# extra locking under power is for getting going and tight turns: at speed the car stays calm)
	if c.drive == "awd" and c.centre_diff == "lsd" and c.bike == null:
		var axle_f := (wheels[0].omega + wheels[1].omega) / 2.0
		var axle_r := (wheels[2].omega + wheels[3].omega) / 2.0
		var c_max := 100.0 + 0.3 * absf(drive_total)
		var c_lock := clampf(150.0 * (axle_f - axle_r), -c_max, c_max)
		wheel_drive[0] -= c_lock / 2.0
		wheel_drive[1] -= c_lock / 2.0
		wheel_drive[2] += c_lock / 2.0
		wheel_drive[3] += c_lock / 2.0
	if c.diff == "lsd" and c.bike == null:
		var calm := 1.0 - _smooth(8.0, 25.0, absf(c.speed))
		for axle in 2:
			var il := axle * 2
			var ir := il + 1
			if c.shares[il] == 0.0:
				continue
			var axle_t: float = wheel_drive[il] + wheel_drive[ir]
			var factor := (c.diff_power if axle_t >= 0.0 else c.diff_coast) * calm
			var lock_max := c.diff_preload + factor * absf(axle_t) / 2.0
			var lock := clampf(c.diff_lock * (wheels[il].omega - wheels[ir].omega), -lock_max, lock_max)
			wheel_drive[il] -= lock
			wheel_drive[ir] += lock

	# ---- the wheel speeds (the grip taken implicitly where the tyre has a slope: the shell has none, the simple tyre
	# neither, as in Vehicle.js); a welded axle: each wheel on its own, then both at the speed that keeps their angular
	# momentum
	# (the brake over the same inertia as the tyre: with the grip taken implicitly and the brake over the bare inertia,
	# a braked wheel settled where the tyre gave (I + dt slope) / I times the brake torque, and a car stopped in three
	# quarters of the distance of the browser game)
	for j in 4:
		var wj := wheels[j]
		var i_eff := wj.inertia + dt * wj.tyre_slope
		var d_om: float = dt * tyre_torque[j] / i_eff
		var over := wj.omega - wj.forward_speed / wj.radius
		if absf(wheel_drive[j]) < 5.0 and not wj.omega_from_tyre and over * d_om < 0.0 and absf(d_om) > absf(over):      # (the shell tyre turns it)
			d_om = -over
		var om: float = wj.omega + d_om + dt * wheel_drive[j] / i_eff
		var bt: float = brake_torque[j]
		if bt > 0.0:
			var dw := dt * bt / i_eff
			om = 0.0 if absf(om) <= dw else om - dw * signf(om)
		wj.omega = om
	if c.diff == "welded" and c.bike == null:
		for axle in 2:
			var wl := wheels[axle * 2]
			var wr := wheels[axle * 2 + 1]
			if wl.driven:
				var common := (wl.inertia * wl.omega + wr.inertia * wr.omega) / (wl.inertia + wr.inertia)
				wl.omega = common
				wr.omega = common
	# a locked centre: both axles turn at one speed (the angular momentum kept)
	if c.drive == "awd" and c.centre_diff == "locked" and c.bike == null:
		var i_f := wheels[0].inertia + wheels[1].inertia
		var i_r := wheels[2].inertia + wheels[3].inertia
		var o_f := (wheels[0].inertia * wheels[0].omega + wheels[1].inertia * wheels[1].omega) / i_f
		var o_r := (wheels[2].inertia * wheels[2].omega + wheels[3].inertia * wheels[3].omega) / i_r
		var o_c := (i_f * o_f + i_r * o_r) / (i_f + i_r)
		for k in 4:
			wheels[k].omega += o_c - (o_f if k < 2 else o_r)
	for w in wheels:
		w.spin = fmod(w.spin + w.omega * dt, TAU)
