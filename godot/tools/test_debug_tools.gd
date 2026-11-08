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
