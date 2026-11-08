extends Node3D
## (a scene, for the autoloads) Damage between two cars (Vehicle.js, Parts.js): a car drives at --speed km/h (40) into
## the side of another one at its front wheel; the wheel of the car that is hit feels it (its suspension in the shell,
## WheelRig, bends, the wheel is damaged or torn off), and a loose part of one car does not meet the other car or its
## parts (each car's parts are in a physics world of their own in the browser).
##   Godot --headless --fixed-fps 120 --path godot res://tools/test_damage_cars.tscn -- [--car=hatchback] [--speed=40]

var _fails := 0
var _grid := WallGrid.new()


func _check(ok: bool, what: String) -> void:
	print(("ok    " if ok else "FAIL  ") + what)
	if not ok:
		_fails += 1


func _ready() -> void:
	add_to_group("track")
	var floor_body := StaticBody3D.new()
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(400, 1, 400)
	col.shape = shape
	col.position = Vector3(0, -0.5, 0)
	floor_body.add_child(col)
	add_child(floor_body)
	_run.call_deferred()


## (the walls of the track for the shells: none)
func walls() -> WallGrid:
	return _grid


func _wait(seconds: float) -> void:
	for i in roundi(seconds * Engine.physics_ticks_per_second):
		await get_tree().physics_frame


func _car(id: String, pos: Vector3, heading: float) -> Car:
	var cfg: Variant = Content.load_json("cars/%s/car.json" % id)
	var c := Car.new()
	c.setup(id, cfg)
	add_child(c)
	var r := float(cfg.get("chassis", {}).get("tire_diameter", 0.65)) / 2.0
	c.place(pos + Vector3.UP * (r + 0.1), heading)
	return c


func _run() -> void:
	var id := Content.arg("car") if Content.arg("car") != "" else "hatchback"
	var kmh := float(Content.arg("speed")) if Content.arg("speed") != "" else 40.0
	var cfg: Dictionary = Content.load_json("cars/%s/car.json" % id)
	var wb := float(cfg.get("chassis", {}).get("wheelbase", 2.6))
	# the car that is hit stands across, its front wheels at x = 0; the other comes along x = 0 from -30 m
	var parked := _car(id, Vector3(-wb / 2.0, 0, 0), 0.0)
	var runner := _car(id, Vector3(0.6, 0, -(20.0 + kmh * kmh / 25.0)), PI / 2.0)
	runner.name = "Runner"
	parked.name = "Parked"
	await _wait(1.0)
	_check(parked.shell != null and parked.shell.rig != null, "the parked car has a shell with its wheels in it")
	if parked.shell == null:
		get_tree().quit(1)
		return
	# (the wheel on the side of the runner: the one with the lower z in the world)
	var z0 := (parked.global_transform * parked.wheels[0].hub).z
	var z1 := (parked.global_transform * parked.wheels[1].hub).z
	var near := 0 if z0 < z1 else 1
	var near_w := parked.wheels[near]
	print("the parked car's front wheel %s is hit (at %.2f m in the world)" % [near_w.slot, minf(z0, z1)])
	runner.steer_direct = true
	runner.steer_input = 0.0
	runner.throttle_input = 1.0
	var t := 0.0
	while runner.speed < kmh / 3.6 and t < 20.0:
		await get_tree().physics_frame
		t += 1.0 / Engine.physics_ticks_per_second

	runner.throttle_input = 0.0
	print("the runner at %.0f km/h" % (runner.speed * 3.6))
	var hit := false
	t = 0.0
	var hub: int = parked.shell.rig.rigs[near]["nodes"]["H"] if parked.shell.rig.rigs[near] != null else -1
	var hub_pairs := 0
	var hub_move := 0.0
	var felt := 0.0
	var home: Vector3 = parked.shell.rig.rigs[near]["home"] if hub >= 0 else Vector3.ZERO
	while t < 6.0:
		await get_tree().physics_frame
		t += 1.0 / Engine.physics_ticks_per_second
		if runner.shell.car_contacts > 0 or parked.shell.car_contacts > 0:
			hit = true
		if hub >= 0:
			hub_pairs = maxi(hub_pairs, parked.shell._pairs[hub].size())
			hub_move = maxf(hub_move, parked.shell.sb.position(hub).distance_to(home))
		felt = maxf(felt, float(parked.shell.rig.damage[near]))
	print("(the hub node %d of the parked car: alive %d, pairs at most %d, moved at most %.1f cm)" % [hub, parked.shell.sb.anchor_alive[hub] if hub >= 0 else -1,
		hub_pairs, hub_move * 100.0])
	runner.brake_input = 1.0
	await _wait(1.0)
	_check(hit, "the cars met")
	var rig := parked.shell.rig
	var bend := absf(near_w.toe_bend) + absf(near_w.camber_bend)
	print("the parked car's wheels: damage %s, lost %s, toe/camber of the hit one %.1f / %.1f deg" % [str(rig.damage), str(rig.lost),
		rad_to_deg(near_w.toe_bend), rad_to_deg(near_w.camber_bend)])
	_check(hub_move > 0.01 and (felt > 0.05 or rig.lost[near]),
		"the hit wheel of the other car feels it: its hub pushed %.1f cm, damage %.0f %% at the most, %.0f %% after (bend %.1f deg)%s" % [
		hub_move * 100.0, felt * 100.0, float(rig.damage[near]) * 100.0, rad_to_deg(bend), ", torn off" if rig.lost[near] else ""])
	# a loose part of one car and the other car
	if runner.parts != null and not runner.parts.parts.is_empty():
		var p: CarParts.Part = null
		for q in runner.parts.parts:
			if q.state == "held" and q.mode != "breakable":
				p = q
				break
		if p != null:
			runner.parts.break_loose(p)
			await _wait(0.3)
			var body := p.body
			_check(body != null and is_instance_valid(body) and body.get_collision_exceptions().has(parked),
				"the loose %s of the runner does not meet the parked car" % p.name)
		else:
			print("(the runner has no part that comes off)")
	print("FAILS %d" % _fails)
	get_tree().quit(1 if _fails > 0 else 0)
