class_name EngineDamage
extends RefCounted
## What a crash does to the engine, with damage on (the shell of the car, CarShell), after web/js/EngineDamage.js.
##
## The engine bay is a sphere in the frame of the car; the nodes of the shell inside it say how hurt the engine is,
## in five places: block (all the nodes of the bay: power, friction, wear), top (above its middle: the ignition, the
## wiring, misfires and stalls), pan (below it: an oil leak), front (its front face: the front seal, an oil leak)
## and radiator (a sphere at the front of the car, or the part called radiator: a coolant leak). Every place keeps the
## worst it has had. From them come misfires, leaks, a blown head gasket, the heat of the engine, and the wear of its
## bearings without oil pressure; the result goes to the engine (health_scale, friction_scale, misfire_cut,
## disabled) and to `health` for the HUD.
##
## car.json engine.damage (all optional): { enabled, position [x, y, z] of the bay and radiator [x, y, z] (from the
## centre of gravity: x to the left, y up, z forward), radius, radiator_radius, coolant (litres), oil (litres),
## strength (how much bend counts: 1) }.

var car: Car
var usable := false
var nodes := 0
var health := {}
var bay := Vector3.ZERO         # in the frame of the body
var radiator_at := Vector3.ZERO
var _cfg := {}
var _bay_r := 0.75
var _rad_r := 0.55
var _strength := 1.0
var _sb: SoftBody = null
var _list: Array = []           # [node, wb, wt, wp, wr, wf]
var _sum := {"b": 0.0, "t": 0.0, "p": 0.0, "r": 0.0, "f": 0.0}
var _seized := false
var _cut_left := 0.0
var _next_misfire := 0.0
var _shock_cool := 0.0
var _acc := 0.0
var _last_shock := 0.0
var _peak := 8000.0


func _init(c: Car, cfg: Dictionary) -> void:
	car = c
	_cfg = cfg
	_bay_r = float(cfg.get("radius", 0.75)) if float(cfg.get("radius", 0)) > 0.0 else 0.75
	_rad_r = float(cfg.get("radiator_radius", 0.55)) if float(cfg.get("radiator_radius", 0)) > 0.0 else 0.55
	_strength = float(cfg.get("strength", 1.0)) if float(cfg.get("strength", 0)) > 0.0 else 1.0
	repair()


## Where the bay and the radiator are in the frame of the body (its origin at the height of the axles, in the
## middle; Engine.js measures from the centre of gravity), and the nodes of the shell near them.
func bind(sb: SoftBody) -> void:
	_sb = sb
	_list.clear()
	for k in _sum:
		_sum[k] = 0.0
	if sb == null:
		usable = false
		return
	var com := car.center_of_mass
	var front_z := car.wheels[0].hub.z
	var rear_z := car.wheels[2].hub.z
	var af := front_z - com.z
	var ar := com.z - rear_z
	var place := str(car.config.get("engine_place", "front"))
	var p: Array = _cfg.get("position", [])
	var b := Vector3(0.0, -car.cg_height + 0.55, -ar + 0.1 if place == "rear" else (-ar * 0.35 if place == "mid" else af - 0.2))
	if p.size() == 3:
		b = Vector3(float(p[0]), float(p[1]), float(p[2]))
	var rp: Array = _cfg.get("radiator", [])
	var r := Vector3(0.0, b.y + 0.05, b.z + 0.55 if place == "front" else af + 0.2)
	if rp.size() == 3:
		r = Vector3(float(rp[0]), float(rp[1]), float(rp[2]))
	bay = com + b
	radiator_at = com + r
	for k in sb.count:
		var at := sb.rest[k]
		var wb := maxf(0.0, 1.0 - at.distance_to(bay) / _bay_r)
		var wr := maxf(0.0, 1.0 - at.distance_to(radiator_at) / _rad_r)
		if wb <= 0.0 and wr <= 0.0:
			continue
		var ny := (at.y - bay.y) / _bay_r
		var nz := (at.z - bay.z) / _bay_r
		var n := [k, wb, wb if ny > -0.1 else 0.0, wb if ny < 0.1 else 0.0, wr, wb if nz > 0.15 else 0.0]
		_list.append(n)
		_sum["b"] += wb
		_sum["t"] += n[2]
		_sum["p"] += n[3]
		_sum["r"] += wr
		_sum["f"] += n[5]
	nodes = _list.size()
	usable = _cfg.get("enabled", true) != false and _sum["b"] > 0.3


## A pit stop and a repair: the engine is whole, the oil and the coolant are full, and it is cool.
func repair() -> void:
	health = {"block": 0.0, "top": 0.0, "pan": 0.0, "radiator": 0.0, "ignition": 0.0, "coolant": 1.0, "oil": 1.0, "temp": 78.0,
		"oil_temp": 70.0, "wear": 0.0, "power": 1.0, "misfire": 0.0, "steam": 0.0, "smoke": 0.0, "white_smoke": 0.0, "failed": 0.0,
		"stalled": 0.0, "leaking": 0, "jets": 0, "front": 0.0, "gasket": 0.0, "contam": 0.0, "radiator_gone": false}
	_seized = false
	_cut_left = 0.0
	_next_misfire = 0.0
	_shock_cool = 0.0
	_last_shock = 0.0
	_acc = 0.0
	var e := car.engine
	e.health_scale = 1.0
	e.friction_scale = 1.0
	e.misfire_cut = false
	e.disabled = false


## Every physics step: the clocks of the misfires; the engine itself is looked at 30 times a second.
func update(dt: float) -> void:
	var sb: SoftBody = car.shell.sb if car.shell != null else null
	if sb != _sb:
		bind(sb)
	if not usable:
		return
	var e := car.engine
	_acc += dt
	if _acc >= 1.0 / 30.0:
		_tick(_acc)
		_acc = 0.0
	if _cut_left > 0.0:
		_cut_left -= dt
		if _cut_left <= 0.0:
			e.misfire_cut = false
	elif e.running and _next_misfire > 0.0 and randf() < _next_misfire * dt:
		_cut_left = 0.035 + 0.07 * randf()
		e.misfire_cut = true
		# the unburnt fuel bangs in the exhaust; a rough idle can die of it
		if e.events.size() < 40:
			e.events.append({"strength": 0.4 + randf() * 0.7, "loud": 1.0, "flame": 1.0})
		if e.rpm() < e.idle_rpm * 1.4 and randf() < 0.2 * float(health["misfire"]):
			_stall()


func _stall() -> void:
	car.engine.running = false
	car.engine.starting = false
	health["stalled"] = 1.0


## How hurt a node is, 0..1: a bend that stays (5 cm is nothing, 30 cm all of it); a node torn off is gone.
func _hurt(k: int) -> float:
	if not _sb.alive(k) or _sb.gone[k] == 1:
		return 1.0
	return clampf((_sb.bend_of(k) - 0.05 / _strength) / (0.25 / _strength), 0.0, 1.0)


func _radiator_part() -> CarParts.Part:
	if car.parts == null:
		return null
	for p in car.parts.parts:
		if p.name.to_lower() == "radiator":
			return p
	var re := RegEx.create_from_string("(?i)fan|hose|cap|cover")
	for p in car.parts.parts:
		if p.name.to_lower().contains("radiator") and re.search(p.name) == null:
			return p
	return null


## What the nodes say: the worst of every place is kept.
func _read_nodes(dt: float) -> void:
	var b := 0.0
	var t := 0.0
	var p := 0.0
	var r := 0.0
	var rt := 0.0
	var f := 0.0
	var shock := 0.0
	for n in _list:
		var k: int = n[0]
		var h := _hurt(k)
		b += n[1] * h
		t += n[2] * h
		p += n[3] * h
		r += n[4] * h
		f += n[5] * h
		if n[4] > 0.0 and not _sb.alive(k):
			rt += n[4]
		if n[1] > 0.0:
			shock += n[1] * _sb.u[k].length()
	if _sum["b"] > 0.0:
		health["block"] = maxf(health["block"], b / _sum["b"])
		shock /= _sum["b"]
	if _sum["t"] > 0.0:
		health["top"] = maxf(health["top"], t / _sum["t"])
	if _sum["p"] > 0.0:
		health["pan"] = maxf(health["pan"], p / _sum["p"])
	if _sum["r"] > 0.0:
		health["radiator"] = maxf(health["radiator"], r / _sum["r"])
	if _sum["f"] > 0.0:
		health["front"] = maxf(health["front"], f / _sum["f"])
	# a radiator that is only a place in the shell is torn open when most of its nodes have torn off
	if not health["radiator_gone"] and _sum["r"] > 0.0 and rt / _sum["r"] > 0.4 and health["radiator"] > 0.8:
		health["radiator_gone"] = true
	var rp := _radiator_part()
	if rp != null:
		if rp.state != "held":
			health["radiator"] = 1.0
			health["radiator_gone"] = true
		elif not rp.nodes.is_empty():
			var sum := 0.0
			var worst := 0.0
			for k in rp.nodes:
				var hq := _hurt(k)
				sum += hq
				worst = maxf(worst, hq)
			health["radiator"] = maxf(health["radiator"], 0.5 * sum / rp.nodes.size() + 0.5 * worst)
	# a hard hit shakes the wiring loose even when nothing stays bent (the springing of the shell in the bay)
	_shock_cool = maxf(0.0, _shock_cool - dt)
	var jolt := clampf((shock - 0.10) / 0.30, 0.0, 1.0)
	if jolt > 0.05 and shock > _last_shock + 0.02 and _shock_cool <= 0.0:
		_shock_cool = 1.0
		health["top"] = maxf(health["top"], 0.3 * jolt)
		# the engine dies at a hard hit, now and then: the harder, the more often
		if car.engine.running and randf() < 0.9 * jolt * jolt + 0.05 * jolt:
			_stall()
	health["gasket"] = maxf(health["gasket"], maxf(clampf(0.7 * health["top"] + 0.5 * health["block"] - 0.2, 0.0, 1.0), 0.5 * jolt * jolt))
	_last_shock = shock
	health["ignition"] = clampf(maxf(health["top"] * 0.85, health["block"] * 0.6), 0.0, 1.0)


func _oil_pressure() -> float:
	return _smooth(health["oil"] / 0.55) * (1.0 - 0.5 * clampf((health["temp"] - 130.0) / 30.0, 0.0, 1.0)) * (1.0 - 0.4 * health["contam"])


func _oil_starvation(r: float, limiter: float, load: float) -> float:
	var dry := 1.0 - _oil_pressure()
	var ay := (car.linear_velocity.cross(car.angular_velocity)).length()
	if health["oil"] < 0.7 and ay > 9.0:
		dry = minf(1.0, dry + 0.3 * (1.0 - health["oil"]))
	return dry * clampf(r / limiter + 0.5 * load, 0.0, 1.0)


func _smooth(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	return x * x * (3.0 - 2.0 * x)


func _tick(dt: float) -> void:
	var e := car.engine
	var r := e.rpm()
	var limiter := e.limiter_rpm
	var best := 0.0
	for c in e.curve:
		best = maxf(best, float(c[1]) * float(c[0]) * PI / 30.0)
	_peak = maxf(8000.0, best * e.power_scale)
	var pk := _peak
	_read_nodes(dt)
	var h := health

	# leaks: the radiator, the block, the pan, the front of the engine, and hot oil through the seals
	var hot_leak := 0.4 + 0.6 * clampf((h["temp"] - 20.0) / 80.0, 0.0, 1.0)
	if h["radiator_gone"] and h["jets"] == 0:
		h["jets"] = 1 + randi() % 5
	var cool_leak := (pow(h["radiator"], 1.5) / 200.0 + 0.3 * pow(maxf(0.0, h["block"] - 0.4), 1.5) / 90.0) * hot_leak
	if h["radiator_gone"]:
		cool_leak = h["jets"] / 25.0
	var oil_leak: float = (pow(h["pan"], 1.5) + 0.2 * pow(maxf(0.0, h["block"] - 0.5), 1.5)) / 150.0 + pow(h["front"], 1.5) / 120.0 \
		+ pow(clampf((h["oil_temp"] - 140.0) / 30.0, 0.0, 1.0), 1.5) / 180.0
	# the head gasket: the coolant is burnt in the engine
	h["gasket"] = minf(1.0, h["gasket"] + pow(clampf((h["temp"] - 125.0) / 30.0, 0.0, 1.0), 2.0) * 0.02 * dt)
	var burn: float = pow(h["gasket"], 1.5) / 60.0 * (1.0 if e.running else 0.2) if h["coolant"] > 0.0 else 0.0
	h["coolant"] = maxf(0.0, h["coolant"] - burn * dt)
	h["contam"] += (pow(h["gasket"], 1.2) * (1.0 if h["coolant"] > 0.02 else 0.3) - h["contam"]) * minf(1.0, dt / 20.0)
	h["coolant"] = maxf(0.0, h["coolant"] - cool_leak * dt)
	h["oil"] = maxf(0.0, h["oil"] - oil_leak * dt)
	h["leaking"] = (1 if cool_leak > 0.0005 else 0) + (2 if oil_leak > 0.0005 else 0)

	# heat
	var running := 1.0 if e.running else 0.0
	var output := maxf(0.0, e.last_torque * e.omega) * running
	var starve := _oil_starvation(r, limiter, output / pk)
	var heat := 0.95 * output + running * (0.02 * pk + 0.045 * pk * pow(minf(1.2, r / limiter), 1.5)) * e.friction_scale + starve * 0.08 * pk * running
	var airflow := 0.45 + 0.55 * minf(1.0, absf(car.speed) / 25.0)
	var thermostat := 0.04 + 0.96 * _smooth((h["temp"] - 78.0) / 14.0)
	var coolant := 0.05 + 0.95 * _smooth(h["coolant"] / 0.45)
	var ua: float = 0.0122 * pk * airflow * thermostat * coolant * (1.0 - 0.85 * h["radiator"]) * (1.0 - 0.35 * h["gasket"])
	var capacity := 25000.0 + 450.0 * pk / 1000.0
	h["temp"] += (heat - ua * (h["temp"] - 20.0)) / capacity * dt
	if h["temp"] > 112.0 and h["coolant"] > 0.0:
		h["coolant"] = maxf(0.0, h["coolant"] - 0.004 * (h["temp"] - 112.0) * dt)
	h["temp"] = clampf(h["temp"], 15.0, 220.0)
	var oil_target: float = h["temp"] + 6.0 + 24.0 * clampf(r / limiter, 0.0, 1.2) * (0.3 + 0.7 * clampf(output / pk, 0.0, 1.0)) + 40.0 * starve \
		+ 25.0 * clampf((0.4 - h["oil"]) / 0.4, 0.0, 1.0)
	h["oil_temp"] = clampf(h["oil_temp"] + (oil_target - h["oil_temp"]) * minf(1.0, dt / 90.0), 15.0, 250.0)

	# wear: dry bearings, a bent engine, a boiled one
	var load := clampf(output / pk, 0.0, 1.0)
	h["wear"] = clampf(h["wear"] + (pow(starve, 1.3) * 0.012 + pow(h["block"], 2.0) * 0.0015 * load + pow(h["contam"], 2.0) * 0.004 * load
		+ pow(clampf((h["temp"] - 135.0) / 20.0, 0.0, 1.0), 2.0) * 0.02) * dt, 0.0, 1.0)

	# what it does to the engine
	var overheat := clampf((h["temp"] - 108.0) / 40.0, 0.0, 1.0)
	var power: float = (1.0 - 0.5 * pow(h["block"], 1.3)) * (1.0 - 0.2 * h["top"]) * (1.0 - 0.4 * overheat) * (1.0 - 0.35 * pow(h["wear"], 1.3)) \
		* (1.0 - 0.3 * h["contam"]) * (1.0 - 0.15 * (1.0 - _oil_pressure()))
	h["power"] = clampf(power, 0.2, 1.0)
	e.health_scale = h["power"]
	e.friction_scale = 1.0 + 1.2 * h["wear"] + 0.6 * pow(h["block"], 2.0) + 0.3 * (1.0 - _oil_pressure())
	var rate: float = 9.0 * pow(h["ignition"], 1.8) + 6.0 * pow(clampf((h["temp"] - 118.0) / 25.0, 0.0, 1.0), 1.5) + 3.0 * pow(h["wear"], 3.0) \
		+ 8.0 * pow(h["contam"], 1.6)
	h["misfire"] = clampf(rate / 9.0, 0.0, 1.0)
	_next_misfire = rate
	h["steam"] = clampf((h["temp"] - 100.0) / 25.0, 0.15, 1.0) if h["temp"] > 100.0 and (int(h["leaking"]) & 1 or h["temp"] > 112.0) else 0.0
	h["white_smoke"] = clampf(h["contam"] * 1.3, 0.0, 1.0) if e.running else 0.0
	h["smoke"] = clampf(maxf(h["wear"] - 0.35, 0.5 * h["pan"] if int(h["leaking"]) & 2 else 0.0) * 1.5, 0.0, 1.0) if e.running else 0.0
	# the end: it seizes when the bearings are gone (or it is cooked); a ruined ignition does not start again
	if not _seized and (h["wear"] >= 1.0 or h["temp"] >= 165.0):
		_seized = true
		e.running = false
		e.starting = false
	h["failed"] = 1.0 if _seized else 0.0
	e.disabled = _seized or h["ignition"] > 0.95
