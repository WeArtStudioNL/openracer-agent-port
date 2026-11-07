extends Node
## (a scene: Godot --headless --path godot res://tools/test_extras.tscn)
## Tests the extras of the engine on its own: pops after lifting off, bangs at the cuts of the limiter, the governor,
## the hold of the two-step, and the anti-lag that keeps the boost.


func _run(e: CarEngine, seconds: float, throttle: float, load_nm := 0.0) -> Dictionary:
	var dt := 1.0 / 120.0
	var bangs := 0
	var top := 0.0
	for i in int(seconds / dt):
		var t := e.net_torque(throttle, dt)
		e.omega = clampf(e.omega + dt * (t - load_nm) / e.inertia, 0.0, 2000.0)
		bangs += e.events.size()
		e.events.clear()
		top = maxf(top, e.rpm())
	return {"bangs": bangs, "rpm": roundi(e.rpm()), "top": roundi(top), "boost": snappedf(e.boost, 0.01)}


func _ready() -> void:
	var cfg: Dictionary = get_node("/root/Content").load_json("cars/openracer-muscle/car.json")
	var e := CarEngine.new()
	e.setup(cfg["engine"])
	e.set_extras({"pops_on": true, "pops_amount": 100, "pops_rpm": 2500})
	print("pops: full throttle 1 s ", _run(e, 1.0, 1.0), "  lift 2 s ", _run(e, 2.0, 0.0))
	e.set_extras({"governor_on": true, "governor_rpm": 4000})
	print("governor 4000: ", _run(e, 2.0, 1.0))
	e.set_extras({})
	e.hold_rpm = e.two_step_rpm
	e.holding = true
	print("two-step at %d: " % e.two_step_rpm, _run(e, 2.0, 1.0))
	e.hold_rpm = 0.0
	e.holding = false
	var t: Dictionary = cfg["engine"].duplicate(true)
	t["turbo"] = {"share": 0.4, "spool": 0.8, "threshold_rpm": 2500}
	var et := CarEngine.new()
	et.setup(t)
	et.set_extras({"antilag_on": true})
	print("turbo, full throttle 2 s: ", _run(et, 2.0, 1.0, 200.0), "  anti-lag off the throttle 1 s: ", _run(et, 1.0, 0.0, 0.0))
	get_tree().quit()
