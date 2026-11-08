extends Node
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_drag.tscn -- --ai
## --car=openracer-muscle) The drag strip (DragStrip.js) on desert-drag-strip: the car creeps to the line, stands,
## waits for the green light and goes flat out to the finish; the run is in the log. (--ai: the run is kept in the
## test store, not with the player's runs.)

var world: World
var drag: DragStrip
var _time := 0.0
var _ending := false


func _ready() -> void:
	process_physics_priority = -100         # (before the car reads its inputs; the world's own input step is off)
	world = World.new()
	add_child(world)
	world.setup(Content.arg("car") if Content.arg("car") != "" else "openracer-muscle", "desert-drag-strip", {})
	world.set_physics_process(false)
	# (in the right lane: a barrier of the track lies along the middle of the strip, past the line)
	await get_tree().create_timer(0.3).timeout
	var st: Dictionary = world.track.start
	var h := float(st.get("heading", 0.0))
	var at := Vector3(float(st["x"]), 0.0, float(st["z"])) + Vector3(-sin(h), 0.0, cos(h)) * -3.0
	world.car.place(at + Vector3(0, world.track.ground_at(at.x, at.z) + world.car.wheels[0].radius + 0.3, 0), h)
	drag = world.get_node_or_null("DragStrip") as DragStrip
	if drag == null:
		print("drag test: no drag strip")
		get_tree().quit()


func _physics_process(dt: float) -> void:
	if drag == null:
		return
	_time += dt
	var car := world.car
	car.steer_input = 0.0
	match drag.state:
		"idle", "approach":
			var a := car.to_global(car.wheels[0].hub)
			var s := (a - drag.origin).dot(drag.dir)
			car.throttle_input = 0.25 if s < -1.5 and car.speed < 3.0 else 0.0
			car.brake_input = 1.0 if s > -0.25 or car.speed > 3.0 else 0.0
		"ready", "tree":
			car.throttle_input = 0.0
			car.brake_input = 1.0
		_:
			car.throttle_input = 1.0
			car.brake_input = 0.0
	if Content.arg("verbose") != "" and Engine.get_physics_frames() % 120 == 0:
		var f := car.to_global(car.wheels[0].hub)
		print("%.1f s  %s  s %.2f  %.1f km/h  thr %.2f brk %.2f gear %d frozen %s" % [_time, drag.state, (f - drag.origin).dot(drag.dir), car.speed * 3.6,
			car.throttle_input, car.brake_input, car.gear, car.freeze])
	if (drag.state == "finished" or _time > 60.0) and not _ending:
		_ending = true
		print("drag test: %s after %.1f s" % [drag.state, _time])
		for r in drag.results:
			print("  %s  %.3f s  %.1f km/h" % [r["label"], r["time"], r["speed"] * 3.6])
		if drag.state == "finished":
			print("the time slip:\n  " + "\n  ".join(drag.slip_rows.map(func(r: Array) -> String: return str(r[0]))))
			# (--slip-dir=<folder>: the slip as a PNG there, as its Save PNG button does; --shot=<file>: the screen with the slip)
			if Content.arg("shot") != "" and DisplayServer.get_name() != "headless":
				await get_tree().create_timer(1.0).timeout
				get_viewport().get_texture().get_image().save_png(Content.arg("shot"))
				print("shot: " + Content.arg("shot"))
			if Content.arg("slip-dir") != "":
				var path := await drag.save_slip_png(Content.arg("slip-dir"))
				print("the time slip as a PNG: %s" % (path if path != "" else "not saved (no renderer: headless)"))
		get_tree().quit()
