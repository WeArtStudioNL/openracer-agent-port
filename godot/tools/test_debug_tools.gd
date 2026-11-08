extends Node
## (a scene, for the autoloads) The tools of the debug view (DebugView.js): the node grabber (the left mouse button on a
## node drags it on an elastic), the hit of the middle mouse button, Break parts (a right click), Pit stop here.
##   Godot --headless --fixed-fps 60 --path godot res://tools/test_debug_tools.tscn -- --user-dir=/tmp/x/u
##     --video-cfg=/tmp/x/v.cfg [--car=openracer-muscle] [--shot=/tmp/x/debug.png]

var world: World
var _fails := 0


func _check(ok: bool, what: String) -> void:
	print(("ok    " if ok else "FAIL  ") + what)
	if not ok:
		_fails += 1


func _ready() -> void:
	if Content.arg("video-cfg") == "" or Content.arg("user-dir") == "":
		push_error("test_debug_tools: give --video-cfg and --user-dir (nothing of a test goes into the player's data)")
		get_tree().quit(2)
		return
	VideoPrefs.set_value("debug", "crash_open", Content.arg("shot") != "")      # (the picture: the crash rules of a motorcycle open)
	world = World.new()
	add_child(world)
	world.setup(Content.arg("car") if Content.arg("car") != "" else "openracer-muscle", "testtrack", {"ghost": false, "records": false})
	_run.call_deferred()


func _wait(seconds: float) -> void:
	await get_tree().create_timer(seconds, true, false, true).timeout


func _click(pos: Vector2, button: MouseButton, pressed: bool) -> void:
	var e := InputEventMouseButton.new()
	e.position = pos
	e.global_position = pos
	e.button_index = button
	e.pressed = pressed
	world.debug_view._input(e)


func _run() -> void:
	await _wait(2.0)
	var dv: DebugView = world.debug_view
	var car := world.car
	dv.set_on(true)
	var cam := get_viewport().get_camera_3d()
	var sb := car.shell.sb
	# the node grabber: the node nearest the middle of the car on the screen, dragged 60 px up
	var k := 0
	var best := INF
	for i in sb.count:
		var d := (car.global_transform * sb.position(i)).distance_to(car.global_position + Vector3.UP * 0.6)
		if d < best and not cam.is_position_behind(car.global_transform * sb.position(i)):
			best = d
			k = i
	var at := cam.unproject_position(car.global_transform * sb.position(k))
	var before := sb.position(k)
	dv._strength = 100000.0              # (the default 5 kN/m only stretches the anchor: a strong elastic bends it)
	_click(at, MOUSE_BUTTON_LEFT, true)
	_check(not dv._grab.is_empty(), "the left mouse button takes node %d" % int(dv._grab.get("node", -1)))
	var mv := InputEventMouseMotion.new()
	mv.position = at + Vector2(0, -60)
	dv._input(mv)
	await _wait(1.0)
	var moved := sb.position(k).distance_to(before)
	_check(moved > 0.01, "the elastic pulls it: %.1f cm" % (moved * 100.0))
	_click(at, MOUSE_BUTTON_LEFT, false)
	_check(dv._grab.is_empty() and not car.shell.pusher.is_valid(), "let go: the elastic is gone")
	# the hit of the middle mouse button (after the car has settled again)
	await _wait(3.0)
	var bend0: float = sb.stats()["max_bend"]
	var front := car.global_transform * Vector3(0, 0.6, 2.0)
	dv._hit_kmh = float(Content.arg("kmh")) if Content.arg("kmh") != "" else 50.0
	if Content.arg("nohit") == "":
		_check(dv.hit_car(cam.unproject_position(car.global_transform * Vector3(0, 0.45, -1.9))), "the middle mouse button hits the car")
	await _wait(1.5)
	var bend1: float = sb.stats()["max_bend"]
	print("the hit pushed %.0f kN at most" % (dv._last_peak / 1000.0))
	_check(bend1 > bend0 + 0.005, "the hit dents it: %.1f cm (was %.1f)" % [bend1 * 100.0, bend0 * 100.0])
	# Break parts: a breakable part broken through the tool
	if car.parts != null:
		var target: CarParts.Part = null
		for p in car.parts.parts:
			if p.state == "held" and p.mode in ["breakable", "detachable"] and p.object != null:
				target = p
				break
		if target != null:
			var meshes := target.object.find_children("*", "MeshInstance3D", true, false)
			var found := car.parts.part_of(meshes[0] if meshes.size() > 0 else target.object)
			_check(found == target, "part_of finds %s from its mesh" % target.name)
			var said := car.parts.tool(target, "break")
			_check(target.state != "held", "Break parts: %s %s" % [target.name, said])
			# the middle mouse button on a part that is off the car: its body takes the hit
			await _wait(0.5)
			if target.body != null and is_instance_valid(target.body):
				var v0 := target.body.linear_velocity
				var meshes_off := target.body.find_children("*", "MeshInstance3D", true, false)
				var what := dv._hit_part({"node": meshes_off[0] if meshes_off.size() > 0 else target.body, "position": target.body.global_position},
					Vector3.FORWARD, 1000.0 * 50.0 / 3.6)
				await get_tree().physics_frame          # (an impulse works in the next step)
				_check(what == "part" and target.body.linear_velocity.distance_to(v0) > 1.0,
					"a hit on the loose %s moves it (%.1f m/s)" % [target.name, target.body.linear_velocity.distance_to(v0)])
		# Open hinges: a right click opens a hinge, another closes it where it was made
		var hinge: CarParts.Part = null
		for p in car.parts.parts:
			if p.state == "held" and not p.hinge.is_empty():
				hinge = p
				break
		if hinge != null:
			var said := car.parts.tool(hinge, "hinge")
			await _wait(0.6)
			_check(hinge.state == "hinged", "Open hinges: %s %s" % [hinge.name, said])
			said = car.parts.tool(hinge, "hinge")
			await _wait(0.3)
			_check(hinge.state == "held" and hinge.body == null, "again: %s %s" % [hinge.name, said])
	# the middle mouse button on a tyre: the wheel takes the damage, the car the impulse
	if car.shell != null and car.shell.rig != null:
		var w := car.wheels[2]
		var at_w := w.spin_node.global_transform.origin
		var meshes_w := w.spin_node.find_children("*", "MeshInstance3D", true, false)
		var into := (at_w - cam.global_position).normalized()
		dv._hit_kmh = 50.0
		_check(dv._hit_tyre({"node": meshes_w[0] if meshes_w.size() > 0 else w.spin_node, "position": at_w}, into, 1000.0 * 50.0 / 3.6),
			"a hit on the tyre %s: %s" % [w.slot, dv._tool_text.text])
		_check(float(car.shell.rig.damage[2]) > 0.3, "the wheel is damaged (%d%%)" % roundi(float(car.shell.rig.damage[2]) * 100.0))
		dv._hit_tyre({"node": meshes_w[0] if meshes_w.size() > 0 else w.spin_node, "position": at_w}, into, 1000.0 * 200.0 / 3.6)
		await _wait(0.2)
		_check(car.shell.rig.lost[2], "a hit at 200 km/h tears it off")
	# the rules of a motorcycle crash (the panel): set, kept, back to the standard
	Motorcycle.set_crash_rule("wall", "kmh", 33.0)
	Motorcycle.set_crash_rule("force", "on", true)
	_check(float(Motorcycle.crash_rules()["wall"]["kmh"]) == 33.0 and Motorcycle.crash_rules()["force"]["on"] == true
		and float(VideoPrefs.get_value("debug", "crash_rules", {}).get("wall", {}).get("kmh", 0.0)) == 33.0, "a crash rule is set and kept")
	Motorcycle.reset_rules()
	_check(float(Motorcycle.crash_rules()["wall"]["kmh"]) == 20.0 and Motorcycle.crash_rules()["force"]["on"] == false, "back to the standard rules")
	if car.bike != null:
		_check(dv._panel.find_children("*", "VBoxContainer", true, false).any(func(n: Node) -> bool: return n is DebugCrashRules),
			"the panel has the crash rules of a motorcycle")
	# Pit stop here
	var pit: PitStop = null
	for c in car.get_children():
		if c is PitStop:
			pit = c
	dv.pit_here()
	await _wait(0.5)
	_check(pit != null and (pit.active or pit.done), "Pit stop here: a stop where the car stands (%s)" % (str(pit.plan) if pit != null else "no pit"))
	if Content.arg("shot") != "":
		get_viewport().get_texture().get_image().save_png(Content.arg("shot"))
		print("shot: " + Content.arg("shot"))
	print("debug tools test: %s" % ("all fine" if _fails == 0 else "%d failed" % _fails))
	get_tree().quit(1 if _fails else 0)
