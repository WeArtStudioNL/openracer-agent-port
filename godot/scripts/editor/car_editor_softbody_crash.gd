extends RefCounted
## The tab Crash test of the test bar (softbody-editor.js: crash, crashFrame, applyForceAt, pushReading; SOFTBODY.md).
##
## Crash into the wall: a new car on the bench from the form, a wall of 80 m on the floor of the bench, at the angle that
## is set and far enough ahead (2.6 m + v^2/3.5, at least 19.8 m: the browser's v^2/5 left a slow car short of the speed)
## for the car to get to the speed on its own throttle (full until near it, then just enough to hold it; kept on its line
## by its steering); at the hit the throttle goes off and the brake on. The wall is a StaticBody3D that the box of the
## body meets, and the walls of the shell (CarShell.use_walls, WallGrid.add_body) that its nodes meet. The camera goes
## with the car until the hit; the card and the bar over the view show the peak deceleration, the bend, the energy the
## shell took up, the torn anchors and beams and the parts that came off. Stop crash test takes the wall away and stops
## the bench.
##
## Apply force: an arrow on the surface under the mouse shows where and which way a cube will come; a click fires an
## invisible cube of a tonne and a metre at the car there, at the speed that is set. It starts 0.4 m outside the surface,
## presses on the nodes under its face as a wall would (CarShell.pusher: a penalty spring with a damper), slows, rebounds
## and is gone; the car is held still meanwhile. A part with nodes of its own is hit on those alone.

const WALL_SIZE := Vector3(80, 6, 0.3)
const CUBE_SIDE := 1.0
const CUBE_MASS := 1000.0
const CUBE_START := 0.4

var card: Object                     # the Soft body card (car_editor_softbody.gd)
var ed: CarEditor
var ui := {}
var wall: StaticBody3D = null
var run := {}                        # the crash test that runs: speed, angle, t, hit, peak_g, ...
var push_mode := false
var cube := {}                       # the cube that was fired (frame of the car): face, d, u, w, v, x, peak, max_in, group, kmh
var _bar: PanelContainer
var _arrow: Node3D
var _shot: Node3D                    # the arrow of the cube that was fired
var _cam := {}
var _last_pos := Vector3.ZERO


func _init(owner_card: Object) -> void:
	card = owner_card
	ed = card.get("ed")
	_arrow = _make_arrow(Color("#ff9f43"))
	_shot = _make_arrow(Color("#ff5555"))
	ed.get_tree().physics_frame.connect(_physics)


func _make_arrow(c: Color) -> Node3D:
	var root := Node3D.new()
	root.visible = false
	var shaft := CarEditorView.lines([Vector3.ZERO, Vector3(0, 0, 0.6)], [c, c], true)
	shaft.layers = CarEditorView.MARKER_LAYER
	root.add_child(shaft)
	var cone := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.0
	cm.bottom_radius = 0.09
	cm.height = 0.25
	cone.mesh = cm
	cone.material_override = CarEditorView.flat_material(c, true)
	cone.rotation.x = PI / 2.0
	cone.position.z = 0.68
	cone.layers = CarEditorView.MARKER_LAYER
	root.add_child(cone)
	ed.view.viewport.add_child(root)
	return root


## The tab: the crash test (speed, angle, the button) and under it Apply force (speed, the button), and the result.
func build(pane: VBoxContainer) -> void:
	var r1 := HBoxContainer.new()
	r1.add_theme_constant_override("separation", 10)
	pane.add_child(r1)
	ui["speed"] = _slider(r1, "Speed", 10.0, 150.0, 50.0, 5.0, " km/h")
	ui["angle"] = _slider(r1, "Angle", 0.0, 60.0, 0.0, 5.0, "°")
	var go := EditorStyle.button("Crash into the wall", "small accent",
		"The car accelerates from its start and drives into a wall ahead, at this speed and angle of the wall")
	go.pressed.connect(start)
	go.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	r1.add_child(go)
	var r2 := HBoxContainer.new()
	r2.add_theme_constant_override("separation", 10)
	pane.add_child(r2)
	ui["kmh"] = EditorStyle.NumberField.new("", 5.0, NAN, NAN, "50")
	ui["kmh"].set_value(50.0)
	ui["kmh"].custom_minimum_size.x = 90
	ui["kmh"].size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	r2.add_child(EditorStyle.labelled(ui["kmh"], "Speed (km/h)"))
	ui["push"] = EditorStyle.button("Apply force", "small accent", "Shows an arrow on the surface under the mouse; a click fires an invisible cube " +
		"of a tonne at the car there, at that speed")
	ui["push"].pressed.connect(func(): set_push(not push_mode))
	ui["push"].size_flags_vertical = Control.SIZE_SHRINK_END
	r2.add_child(ui["push"])
	ui["result"] = EditorStyle.hint("")
	ui["result"].custom_minimum_size.x = 380
	pane.add_child(ui["result"])
	_bar = EditorStyle.float_panel()
	_bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_bar.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_bar.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_bar.position.y = -14
	_bar.visible = false
	ed.view.overlay.add_child(_bar)
	var col := VBoxContainer.new()
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	_bar.add_child(col)
	ui["now"] = EditorStyle.label("0 km/h", 22, Color.WHITE, false)
	ui["now"].horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(ui["now"])
	ui["bar_result"] = EditorStyle.label("", 12, EditorStyle.TEXT)
	ui["bar_result"].custom_minimum_size.x = 520
	ui["bar_result"].horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	col.add_child(ui["bar_result"])
	var stop_b := EditorStyle.button("Stop crash test", "small danger", "Takes the wall away and goes back to the model")
	stop_b.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	stop_b.pressed.connect(stop)
	col.add_child(stop_b)


func _slider(parent: Control, title: String, lo: float, hi: float, value: float, step: float, unit: String) -> HSlider:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 0)
	var l := EditorStyle.label("", 11, EditorStyle.MUTED, false)
	box.add_child(l)
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = value
	s.custom_minimum_size.x = 130
	s.focus_mode = Control.FOCUS_NONE
	var show := func(v: float): l.text = "%s  %d%s" % [title, roundi(v), unit]
	s.value_changed.connect(show)
	show.call(value)
	box.add_child(s)
	parent.add_child(box)
	return s


func running() -> bool:
	return not run.is_empty()


func hides_shell() -> bool:
	return running() or push_mode


func _car() -> Car:
	var c: Variant = card.get("car")
	return c as Car if c != null and is_instance_valid(c) else null


func _result(text: String) -> void:
	ui["result"].text = text
	ui["bar_result"].text = text
	card.call("set_result", text)


# ---- the crash test

func start() -> void:
	_damage_for_the_test()
	var angle: float = ui["angle"].value
	var speed: float = ui["speed"].value / 3.6
	_clear_wall()
	set_push(false)
	if _cam.is_empty():
		_cam = {"target": ed.view.target, "position": ed.view.camera.position}
	card.call("restart_bench", true)
	var c := _car()
	if c == null or c.shell == null:
		ed.status("The car does not dent: tick “The car dents” first." if c != null else "Load a model first.", "error")
		return
	var distance := clampf(2.6 + speed * speed / 3.5, 19.8, 390.0)
	wall = StaticBody3D.new()
	wall.name = "CrashWall"
	wall.set_meta("surface", "wall")
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = WALL_SIZE
	col.shape = shape
	wall.add_child(col)
	var mesh := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = WALL_SIZE
	mesh.mesh = bm
	var see := StandardMaterial3D.new()
	see.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	see.albedo_color = Color(0.45, 0.5, 0.56, 0.3)        # (the car is seen through it)
	see.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	mesh.material_override = see
	wall.add_child(mesh)
	var floor_y := ed.view.grid.position.y
	wall.transform = Transform3D(Basis(Vector3.UP, -deg_to_rad(angle)), Vector3(0, floor_y + WALL_SIZE.y / 2.0, c.global_position.z + distance + WALL_SIZE.z / 2.0))
	ed.view.viewport.add_child(wall)
	var grid := WallGrid.new()
	grid.add_body(wall, "wall")
	c.shell.use_walls(grid)
	run = {"speed": speed, "angle": angle, "t": 0.0, "hit": false, "hit_t": 0.0, "peak_g": 0.0, "last_v": Vector3.ZERO, "stopped": 0.0,
		"energy": 0.5 * c.mass * speed * speed, "at_hit": 0.0, "done": false}
	_last_pos = c.global_position
	# the camera beside the car and a little behind it, so the wall ahead is seen (it goes back when the test stops)
	ed.view.target = c.global_position + Vector3(0, 0.4, 1.2)
	ed.view.camera.position = c.global_position + Vector3(-10.5, 4.0, -3.0)
	ed.view.camera.look_at(ed.view.target)
	ed.engine.show_test_bar(false)
	ed.view.hide_chrome(true)
	_bar.visible = true
	if ed.view.gizmo.target != null:
		ed.view.gizmo.detach()
	_result("Accelerating to %d km/h…" % roundi(speed * 3.6))


## These tests are about the damage: with Damage off in the settings they turn it on for the bench, without touching the setting (it is back when the editor closes).
func _damage_for_the_test() -> void:
	if Settings.get_value("damage"):
		return
	Settings.override_for_session("damage", true)
	if not ed.tree_exiting.is_connected(_damage_back):
		ed.tree_exiting.connect(_damage_back)
	ed.status("Damage is off in the settings: it is on for these tests here, the setting stays as it is.", "ok")


func _damage_back() -> void:
	Settings.clear_override("damage")


## The shell was changed while the crash test was on: the test again with the new car.
func again() -> void:
	start()


func _clear_wall() -> void:
	if wall != null:
		wall.queue_free()
		wall = null
	run = {}
	ed.view.hide_chrome(false)


## Stop crash test: the wall goes, the bench stops and the editor is back at the model; the camera where it was.
func stop() -> void:
	_clear_wall()
	_bar.visible = false
	ed.engine.show_test_bar(true)
	_cam = {}
	ed.bench.end_test()
	card.call("bench_stopped")


## The bench stopped (↺, or a new test): the wall and the cube go.
func stopped() -> void:
	if running():
		_clear_wall()
		_bar.visible = false
		ed.engine.show_test_bar(true)
	_cam = {}
	set_push(false)


func frame(_dt: float) -> void:
	var c := _car()
	if c == null:
		if running():
			stopped()
		return
	if push_mode or not cube.is_empty():
		_push_reading(c)
	if not running():
		return
	var fwd := c.global_transform.basis.z
	c.handbrake_input = 0.0
	if not run["hit"] and not run["done"]:
		c.steer_input = clampf(-c.global_position.x * 0.3 - fwd.x * 2.0, -0.2, 0.2)
		var short := float(run["speed"]) - c.speed
		c.throttle_input = 1.0 if short > 0.3 else clampf(0.3 + short, 0.0, 1.0)
		c.brake_input = 0.0
		# the camera is fixed to the car until the hit: it moves exactly as the car moves
		var move := c.global_position - _last_pos
		ed.view.target += move
		ed.view.camera.position += move
	else:
		c.throttle_input = 0.0
		c.brake_input = 1.0
		c.steer_input = 0.0
	_last_pos = c.global_position
	ui["now"].text = "%d km/h%s" % [roundi(absf(c.speed) * 3.6), " (hit)" if run["hit"] else " of %d" % roundi(float(run["speed"]) * 3.6)]
	if run["hit"]:
		_result(reading(c))


## Once a physics step: the hit, the peak deceleration, the end of the test; the car held while the cube is at it.
func _physics() -> void:
	var c := _car()
	if c == null:
		return
	if not cube.is_empty():
		c.linear_velocity = Vector3.ZERO
		c.angular_velocity = Vector3.ZERO
	if not running() or run["done"] or c.shell == null:
		return
	var dt := ed.get_physics_process_delta_time()
	run["t"] += dt
	var v := c.linear_velocity
	var st := c.shell.sb.stats()
	if not run["hit"] and (c.shell.hit > 0.0 or st["absorbed"] > 10.0 or st["max_elastic"] > 0.004):
		run["hit"] = true
		run["hit_t"] = run["t"]
		run["at_hit"] = c.speed
	if run["hit"] and run["t"] - run["hit_t"] < 1.0:
		run["peak_g"] = maxf(run["peak_g"], (v - run["last_v"]).length() / dt / 9.81)
	run["last_v"] = v
	if run["hit"] and absf(c.speed) < 0.3 and run["t"] - run["hit_t"] > 1.0:
		run["stopped"] += dt
		if run["stopped"] > 1.5:
			_finish(c)
	if run["t"] > 80.0:
		_finish(c)


func _finish(c: Car) -> void:
	run["done"] = true
	_result(reading(c))
	RunLog.event("car editor crash test: " + reading(c))


## What the crash did: the peak deceleration, the bend, the energy, what tore and what came off.
func reading(c: Car) -> String:
	var st := c.shell.sb.stats()
	var text := "Hit at %d km/h · peak %d g · bend %.1f cm · took up %d kJ of %d kJ · %d anchors and %d beams torn" % [roundi(absf(run.get("at_hit", 0.0)) * 3.6),
		roundi(run.get("peak_g", 0.0)), st["max_bend"] * 100.0, roundi(st["absorbed"] / 1000.0), roundi(run.get("energy", 0.0) / 1000.0),
		st["torn_anchors"], st["torn_beams"]]
	if c.parts != null and c.parts.count_off() > 0:
		var off := []
		for p in c.parts.parts:
			if p.state != "held":
				off.append("%s (%s)" % [p.name, p.state])
		text += " · %d parts off: %s" % [off.size(), ", ".join(off)]
	return text


# ---- apply force

func set_push(on: bool) -> void:
	if on:
		_damage_for_the_test()
		if running():
			stop()
		if _car() == null or ed.bench.parked:
			card.call("restart_bench", true)
		if _car() == null or _car().shell == null:
			ed.status("The car does not dent: tick “The car dents” first.", "error")
			return
		ed.status("Point at the car: the arrow shows where and which way the cube comes. Click to fire it.", "ok")
	else:
		_end_cube()
		_shot.visible = false
	push_mode = on
	_arrow.visible = false
	if ui.has("push"):
		ui["push"].text = "Release" if on else "Apply force"
		EditorStyle.style_button(ui["push"], "small ghost" if on else "small accent")


func escape() -> bool:
	if push_mode:
		set_push(false)
		return true
	return false


## The mouse in the view: the arrow follows the surface under it (the event is not taken).
func input(event: InputEvent) -> bool:
	if push_mode and event is InputEventMouseMotion:
		var hit: Dictionary = card.call("surface_at", (event as InputEventMouseMotion).position)
		_arrow.visible = not hit.is_empty()
		if not hit.is_empty():
			_place_arrow(_arrow, hit["position"], hit["normal"])
	return false


func _place_arrow(a: Node3D, at: Vector3, outward: Vector3) -> void:
	var start := at + outward * 0.8
	var up := Vector3.UP if absf(outward.y) < 0.95 else Vector3.RIGHT
	a.global_transform = Transform3D(Basis.looking_at(outward, up, true), start)


func click(mouse: Vector2) -> bool:
	if not push_mode:
		return false
	fire(mouse)
	return true


## The cube at the surface under the mouse.
func fire(mouse: Vector2) -> void:
	var c := _car()
	var hit: Dictionary = card.call("surface_at", mouse)
	if c == null or c.shell == null or hit.is_empty():
		return
	_end_cube()
	var inv := c.global_transform.affine_inverse()
	var local := inv * Vector3(hit["position"])
	var n := (inv.basis * Vector3(hit["normal"])).normalized()
	var d := -n
	var u := d.cross(Vector3.UP if absf(d.y) < 0.9 else Vector3.RIGHT).normalized()
	var kmh: float = ui["kmh"].value() if ui["kmh"].value() > 0.0 else 50.0
	cube = {"face": local + n * CUBE_START, "d": d, "u": u, "w": d.cross(u), "v": kmh / 3.6, "x": 0.0, "t": 0.0, "peak": 0.0, "max_in": 0.0,
		"group": _group_of(hit["node"], c), "kmh": kmh}
	# (only the nodes in front of the face when it is fired: one already inside the cube was shot off by the whole depth
	# at once, as the debug view found)
	var front := PackedByteArray()
	front.resize(c.shell.sb.count)
	for i in c.shell.sb.count:
		front[i] = 1 if c.shell.sb.radius[i] - (c.shell.sb.position(i) - Vector3(cube["face"])).dot(d) <= 0.0 else 0
	cube["front"] = front
	c.shell.pusher = _push
	_place_arrow(_shot, hit["position"], hit["normal"])
	_shot.visible = true
	_arrow.visible = false
	ed.status("Cube of %d m and %d kg fired at %d km/h%s. Click again to fire another." % [CUBE_SIDE, CUBE_MASS, roundi(kmh),
		" at the nodes of " + str(cube["group"]) if cube["group"] != "" else ""], "ok")
	# a part that hangs on a hinge (not opened yet) or breaks (glass, a lamp) feels the hit itself: it opens past its
	# latch, tears at its force, shatters (CarParts.hit); the impulse it gets is at most what sends it off at twice the
	# speed of the cube (the browser gave a door the whole impulse of the tonne)
	var pname := part_hit(hit["node"], c)
	if pname != "":
		var p: CarParts.Part = c.parts.part_named(pname)
		var speed := kmh / 3.6
		var force := CUBE_MASS * speed / 0.03
		var what := c.parts.hit(p, -Vector3(hit["normal"]), minf(CUBE_MASS * speed, p.mass * speed * 2.0), force)
		cube["part"] = "%s: %s" % [pname, what]
		ed.status("%s: %s (cube of %d km/h, %d kN)." % [pname, what, roundi(kmh), roundi(force / 1000.0)], "ok")


## The loose part (car.json "parts") whose object holds what was hit, when it is one that feels a hit itself (one on a
## hinge, one that breaks, one that comes off at a force, or one that is off already), else "".
func part_hit(node: Node, c: Car) -> String:
	if c.parts == null:
		return ""
	var n: Node = card.get("partwin").source(node)
	while n != null and n != c:
		var p := c.parts.part_named(str(n.name))
		if p != null:
			return p.name if p.state != "held" or p.mode in ["hinge", "breakable"] or p.break_force > 0.0 else ""
		n = n.get_parent()
	return ""


## The part of the object that was hit when it has nodes of its own (only those are pushed), else "" (the nodes of the body).
func _group_of(node: Node, c: Car) -> String:
	var s := c.shell.sb
	var n := node
	while n != null and n != c:
		var nm := str(n.name)
		for k in s.count:
			if s.part_of[k] == nm:
				return nm
		n = n.get_parent()
	return ""


## In every small step of the shell: the face of the cube presses on the nodes under it, and the cube slows by what it pushes.
func _push(h: float) -> void:
	var c := _car()
	if c == null or cube.is_empty():
		return
	var s := c.shell.sb
	var d: Vector3 = cube["d"]
	var face: Vector3 = cube["face"] + d * float(cube["x"])
	var half := CUBE_SIDE / 2.0
	var group: String = cube["group"]
	var v: float = cube["v"]
	var total := 0.0
	for k in s.count:
		if s.anchor_alive[k] == 0 or s.part_of[k] != group or (cube["front"] as PackedByteArray)[k] == 0:
			continue
		var rel := s.position(k) - face
		var depth := s.radius[k] - rel.dot(d)        # (how far the leading face of the cube has gone past the node)
		if depth <= 0.0 or depth > CUBE_SIDE:
			continue
		if absf(rel.dot(cube["u"])) > half or absf(rel.dot(cube["w"])) > half:
			continue
		var vn := v - s.w[k].dot(d)
		var fn := maxf(0.0, s.contact_k * depth + 2.0 * s.contact_damping * sqrt(s.contact_k * s.mass[k]) * vn)
		s.force[k] += d * fn
		total += fn
	v -= total / CUBE_MASS * h
	cube["v"] = v
	cube["x"] += v * h
	cube["t"] += h
	cube["peak"] = maxf(cube["peak"], total)
	if total > 0.0 and not cube.has("touch"):
		cube["touch"] = cube["x"]
	if cube.has("touch"):
		cube["max_in"] = maxf(cube["max_in"], float(cube["x"]) - float(cube["touch"]))
	# (gone when it has moved away again, or through what tore: it does not push for metres)
	if (v < 0.0 and float(cube["x"]) < -0.05) or float(cube["x"]) > CUBE_START + 1.5 or cube["t"] > 3.0:
		cube["done"] = true
		c.shell.pusher = Callable()


func _end_cube() -> void:
	var c := _car()
	if c != null and c.shell != null:
		c.shell.pusher = Callable()
	cube = {}


## While the cube is at the car, and what it did when it has gone.
func _push_reading(c: Car) -> void:
	if cube.is_empty() or c.shell == null:
		return
	var st := c.shell.sb.stats()
	var done: bool = cube.get("done", false)
	_result("%s %d km/h: peak %d kg of force, %.1f cm into the shell · bend %.1f cm · took up %.1f kJ · %d anchors and %d beams torn%s" % [
		"Hit with" if done else "Cube at", roundi(cube["kmh"]), roundi(cube["peak"] / 9.81), maxf(0.0, cube["max_in"]) * 100.0,
		st["max_bend"] * 100.0, st["absorbed"] / 1000.0, st["torn_anchors"], st["torn_beams"],
		" · " + str(cube["part"]) if cube.has("part") else ""])
	if done:
		_shot.visible = false
		ed.status(ui["result"].text, "ok")
		cube = {}
