extends Node
## (a scene, for the autoloads: Godot --headless --path godot res://tools/test_tyre_shell.tscn -- [--car=hatchback] [--quick])
## The bench of the shell tyre: tools/tyre-bench.js of the browser game, on the native TyreShell (native/src/tyre_shell.cpp).
## The tyre on a flat road with a hub held where the bench wants it, set up from a car the way the bench of the browser
## sets it up, and the same figures: the static curve, rolling, the slip ratio and slip angle sweeps, the camber, the
## friction circle, the relaxation length, a wheel mass on the tyre, the spin at a standstill, the cost. The figures can
## be held against `node tools/tyre-bench.js <car> --quick` (the same tyre in the browser game's code).

const G := 9.81
const DEG := PI / 180.0
const DT := 0.003
const MU := 1.0
const SLIDING := 0.9

var tyre: Object
var road: Object
var radius := 0.33
var static_load := 3000.0
var inertia := 1.6
var pressure := 2.2
var lateral_grip := 1.05
var _patch := 0.0


func _ready() -> void:
	if not ClassDB.class_exists("TyreShell"):
		print("no native TyreShell (build godot/native)")
		get_tree().quit(1)
		return
	var car_id := Content.arg("car") if Content.arg("car") != "" else "hatchback"
	var quick := Content.arg("quick") != ""
	var cfg: Dictionary = Content.load_json("cars/%s/car.json" % car_id)
	_setup(cfg)
	print("== %s (%s): radius %.3f m, static load %d N, %.1f bar" % [cfg.get("name", car_id), car_id, radius, roundi(static_load), pressure])
	_bench(quick)
	get_tree().quit()


func _setup(cfg: Dictionary) -> void:
	var ch: Dictionary = cfg.get("chassis", {})
	var ty: Dictionary = cfg.get("tyres", {})
	var sh: Dictionary = ty.get("shell", {})
	var dims: Dictionary = cfg.get("dimensions", {})
	radius = float(dims.get("tire_diameter", ch.get("tire_diameter", 0.65))) / 2.0
	var mass := float(ch.get("mass", 1500))
	var light := minf(1.0, mass / 1000.0)
	var unsprung := float(ch.get("unsprung_mass", maxf(2.0, 0.0285 * mass) if light < 1.0 else 35.0))
	static_load = mass * G * float(ch.get("weight_distribution", 0.5)) / 2.0
	inertia = float(ch.get("wheel_inertia", 1.6))
	pressure = float(ty.get("pressure_front", 2.2))
	tyre = ClassDB.instantiate("TyreShell")
	tyre.call("configure", {"rings": float(sh.get("rings", 3)), "segments": float(sh.get("segments", 36)), "width": float(sh.get("width", 0.0)),
		"stiff_x": float(ty.get("stiff_x", 20)), "stiff_y": float(ty.get("stiff_y", 18)),
		"vertical_stiffness": float(ch.get("tyre_rate", 220000.0 * sqrt(light))), "vertical_damping": float(ch.get("tyre_damping", 3000.0 * sqrt(light))),
		"static_load": static_load, "tyre_mass": maxf(1.5, 0.3 * unsprung), "pressure": pressure, "inner_ratio": float(sh.get("inner_ratio", 0.62)),
		"carcass": float(sh.get("carcass", 0.0)), "radius": radius, "inertia": inertia, "locked_spin": true})
	road = ClassDB.instantiate("TyreGround")
	var a := Vector3(-300, 0, -300)
	var b := Vector3(300, 0, -300)
	var c := Vector3(300, 0, 300)
	var d := Vector3(-300, 0, 300)
	road.call("add_faces", PackedVector3Array([a, c, b, a, d, c]), Transform3D.IDENTITY, "road")


func _axes(camber: float) -> Array:
	return [Vector3(cos(camber), -sin(camber), 0), Vector3(0, 0, 1), Vector3(sin(camber), cos(camber), 0)]


func _step(hub: Vector3, vel: Vector3, omega: float, ax: Array) -> Dictionary:
	tyre.call("step", DT, hub, vel, ax[0], ax[1], ax[2], omega, road, MU, SLIDING, lateral_grip)
	var r: Dictionary = tyre.call("result")
	var n: Vector3 = r["normal"]
	var f: Vector3 = r["friction"]
	return {"fz": n.y + f.y, "fx": f.z, "fy": f.x, "torque": float(r["axle_torque"]), "r": r}


static func _mean(a: Array) -> float:
	var s := 0.0
	for x: float in a:
		s += x
	return s / maxf(1, a.size())


static func _std(a: Array) -> float:
	var m := _mean(a)
	var s := 0.0
	for x: float in a:
		s += (x - m) * (x - m)
	return sqrt(s / maxf(1, a.size()))


func _load_at(y: float, camber := 0.0, steps := 400) -> float:
	var ax := _axes(camber)
	tyre.call("reset")
	var fz := []
	for i in steps:
		var f := _step(Vector3(0, y, 0), Vector3.ZERO, 0.0, ax)
		if i >= steps - 50:
			fz.append(f["fz"])
	return _mean(fz)


func _height_for(load: float, camber := 0.0) -> float:
	var hi := radius + 0.002
	var lo := hi
	for k in range(1, 25):
		lo = radius - k * 0.0125 * radius
		if _load_at(lo, camber) > load:
			break
		hi = lo
	for _it in 14:
		var y := (lo + hi) / 2.0
		if _load_at(y, camber) > load:
			lo = y
		else:
			hi = y
	return (lo + hi) / 2.0


func _roll(y: float, v: float, omega: float, slip_angle: float, camber: float, seconds: float, tail := 0.2) -> Dictionary:
	var ax := _axes(camber)
	var hub := Vector3(0, y, 0)
	var vel := Vector3(v * sin(slip_angle), 0, v * cos(slip_angle))
	var n := roundi(seconds / DT)
	var from := n - roundi(tail / DT)
	var fz := []
	var fx := []
	var fy := []
	var tq := []
	for i in n:
		var f := _step(hub, vel, omega, ax)
		hub += Vector3(vel.x, 0, vel.z) * DT
		if i >= from:
			fz.append(f["fz"])
			fx.append(f["fx"])
			fy.append(f["fy"])
			tq.append(f["torque"])
	return {"fz": _mean(fz), "fx": _mean(fx), "fy": _mean(fy), "torque": _mean(tq), "fz_std": _std(fz), "fx_std": _std(fx), "fy_std": _std(fy)}


func _free_omega(y: float, v: float, slip_angle: float, camber: float) -> float:
	var base := v / radius
	var lo := 0.9 * base
	var flo := float(_roll(y, v, lo, slip_angle, camber, 0.45)["fx"])
	var hi := lo
	var k := 0.92
	while k <= 1.16:
		hi = k * base
		var f := float(_roll(y, v, hi, slip_angle, camber, 0.45)["fx"])
		if f * flo <= 0.0:
			break
		lo = hi
		flo = f
		k += 0.02
	for _it in 12:
		var mid := 0.5 * (lo + hi)
		var f := float(_roll(y, v, mid, slip_angle, camber, 0.45)["fx"])
		if absf(f) < 0.002 * static_load:
			return mid
		if f * flo <= 0.0:
			hi = mid
		else:
			lo = mid
			flo = f
	return 0.5 * (lo + hi)


func _put(name: String, value: Variant) -> void:
	var text := str(value)
	if value is float:
		var x: float = value
		text = "%.0f" % x if absf(x) >= 100.0 else ("%.2f" % x if absf(x) >= 1.0 else "%.4f" % x)
	print("  %-58s %s" % [name, text])


func _bench(quick: bool) -> void:
	var t0 := Time.get_ticks_msec()
	var y0 := _height_for(static_load)
	var defl := radius - y0
	_put("deflection at static load (mm)", defl * 1000.0)
	var y_up := _height_for(static_load * 1.2)
	var y_down := _height_for(static_load * 0.8)
	_put("vertical stiffness (N/mm)", 0.4 * static_load / maxf(1e-6, y_down - y_up) / 1000.0)
	tyre.call("reset")
	var r: Dictionary = {}
	for i in 200:
		r = _step(Vector3(0, y0, 0), Vector3.ZERO, 0.0, _axes(0.0))["r"]
	_put("patch length (mm)", float(r["patch"]) * 1000.0)
	_put("contacts at static load", int(r["contacts"]))
	tyre.call("configure", {"pressure": pressure * 1.4})
	var y_hard := _height_for(static_load)
	tyre.call("configure", {"pressure": pressure * 0.6})
	var y_soft := _height_for(static_load)
	tyre.call("configure", {"pressure": pressure})
	_put("deflection: 1.4x pressure / nominal", (radius - y_hard) / maxf(1e-6, defl))
	_put("deflection at 0.6x pressure (mm)", (radius - y_soft) * 1000.0)
	# ---- rolling
	var v := 15.0
	tyre.call("reset")
	var w_free := _free_omega(y0, v, 0.0, 0.0)
	_put("rolling radius / radius", v / w_free / radius)
	var steady := _roll(y0, v, w_free, 0.0, 0.0, 1.0, 0.4)
	_put("rolling resistance (Crr)", absf(float(steady["torque"])) / (radius * maxf(1.0, steady["fz"])))
	_put("force along the road on the free roll (N)", steady["fx"])
	_put("load noise (% of load)", 100.0 * float(steady["fz_std"]) / maxf(1.0, steady["fz"]))
	_put("friction noise (% of load)", 100.0 * maxf(steady["fx_std"], steady["fy_std"]) / maxf(1.0, steady["fz"]))
	_put("load on the roll (N)", steady["fz"])
	r = tyre.call("result")
	_put("sliding share of the load on the free roll", r["sliding_share"])
	_put("pressure centre ahead of the hub on the free roll (mm)", 1000.0 * float(r["centre_along"]))
	# ---- the slip ratio sweep
	var kappas := [-1, -0.3, -0.15, -0.08, -0.04, -0.02, 0.02, 0.04, 0.08, 0.15, 0.3, 1] if quick else [-1, -0.5, -0.3, -0.2, -0.15, -0.1, -0.08, -0.06,
		-0.04, -0.02, -0.01, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 1]
	var curve := []
	var text := []
	for k: float in kappas:
		tyre.call("reset")
		var rr := _roll(y0, v, w_free * (1.0 + k), 0.0, 0.0, 0.7)
		curve.append([k, float(rr["fx"]) / maxf(1.0, rr["fz"])])
		text.append("%s: %.3f" % [k, curve[-1][1]])
	_put("slip ratio curve (kappa: mu x)", ", ".join(text))
	var small := []
	var peak_d := [0.0, -9.0]
	var peak_b := [0.0, 9.0]
	for p: Array in curve:
		if absf(p[0]) <= 0.02:
			small.append(p[1] / p[0])
		if p[0] > 0 and p[1] > peak_d[1]:
			peak_d = p
		if p[0] < 0 and p[1] < peak_b[1]:
			peak_b = p
	_put("slip stiffness / Fz (per unit slip)", _mean(small))
	_put("peak mu x", peak_d[1])
	_put("slip at peak (%)", 100.0 * float(peak_d[0]))
	_put("mu x at 100 % slip / peak", float(curve[-1][1]) / maxf(1e-6, peak_d[1]))
	_put("drive/brake symmetry", float(peak_d[1]) / maxf(1e-6, -float(peak_b[1])))
	# ---- the slip angle sweep
	var alphas := [-10, -6, -3, -1, 1, 3, 6, 10] if quick else [-14, -10, -8, -6, -5, -4, -3, -2, -1, -0.5, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 14]
	var curve_y := []
	text = []
	for d: float in alphas:
		var a := d * DEG
		tyre.call("reset")
		var w := _free_omega(y0, v, a, 0.0)
		var rr := _roll(y0, v, w, a, 0.0, 0.7)
		curve_y.append([a, float(rr["fy"]) / maxf(1.0, rr["fz"])])
		text.append("%.1f: %.3f" % [d, curve_y[-1][1]])
	_put("slip angle curve (deg: mu y)", ", ".join(text))
	small = []
	var peak_y := [0.0, 9.0]
	for p: Array in curve_y:
		if absf(p[0]) <= 1.01 * DEG:
			small.append(p[1] / p[0])
		if p[0] > 0 and p[1] < peak_y[1]:
			peak_y = p
	var c_alpha := -_mean(small)
	_put("cornering stiffness / Fz (per rad)", c_alpha)
	_put("peak mu y", -float(peak_y[1]))
	_put("slip angle at peak (deg)", float(peak_y[0]) / DEG)
	# ---- the relaxation length
	tyre.call("reset")
	var vr := 10.0
	var w_r := _free_omega(y0, vr, 0.0, 0.0)
	var hub := Vector3(0, y0, 0)
	var vel := Vector3(0, 0, vr)
	for i in 300:
		_step(hub, vel, w_r, _axes(0.0))
		hub.z += vr * DT
	vel = Vector3(vr * sin(2.0 * DEG), 0, vr * cos(2.0 * DEG))
	var fys := []
	for i in 400:
		fys.append(float(_step(hub, vel, w_r, _axes(0.0))["fy"]))
		hub += Vector3(vel.x, 0, vel.z) * DT
	var final := _mean(fys.slice(-60))
	var at := fys.size()
	for i in range(2, fys.size()):
		if (final < 0.0 and fys[i] <= 0.63 * final) or (final >= 0.0 and fys[i] >= 0.63 * final):
			at = i
			break
	_put("relaxation length (m)", at * DT * vr)
	# ---- the cost
	tyre.call("reset")
	hub = Vector3(0, y0, 0)
	vel = Vector3(0, 0, v)
	for i in 100:
		_step(hub, vel, w_free, _axes(0.0))
	var t1 := Time.get_ticks_usec()
	for i in 600:
		_step(hub, vel, w_free, _axes(0.0))
		hub.z += v * DT
	_put("cost (ms per step)", (Time.get_ticks_usec() - t1) / 1000.0 / 600.0)
	r = tyre.call("result")
	_put("substeps (wanted)", "%d (%d)" % [r["substeps"], r["substeps_wanted"]])
	_put("bench time (s)", (Time.get_ticks_msec() - t0) / 1000.0)
