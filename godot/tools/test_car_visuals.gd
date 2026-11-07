extends Node3D
## (a scene: Godot --headless --path godot res://tools/test_car_visuals.tscn [-- --car=hatchback])
## Tests the look of a car (CarVisuals): the suspension rig of the muscle car and the hatchback (the parts found, and
## moving with the travel of the wheels and the steering), the overrides of car.json "materials" and the paint of
## "colors" with every finish and flake pattern, and the mirrors (found, aimed, real ones made from the cockpit).
## Without --headless, --shot=file.png saves a picture of the front corner with the wheel up and steered
## (--corner=FL|FR|RL|RR, --travel=m, --steer=rad, --view=side|below|front).

var _fails := 0


func _check(ok: bool, what: String) -> void:
	print(("ok    " if ok else "FAIL  ") + what)
	if not ok:
		_fails += 1


func _ready() -> void:
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.55, 0.6, 0.66)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(0.7, 0.72, 0.75)
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(deg_to_rad(-50), deg_to_rad(30), 0)
	add_child(sun)
	await get_tree().process_frame
	var only := Content.arg("car")
	var shot := Content.arg("shot")
	if Content.arg("mirror-shot") != "":
		await _mirror_picture(only if only != "" else "hatchback", Content.arg("mirror-shot"))
		get_tree().quit()
		return
	if shot != "":
		await _picture(only if only != "" else "openracer-muscle", shot)
		get_tree().quit()
		return
	for id in ([only] if only != "" else ["openracer-muscle", "hatchback"]):
		await _test_car(id)
	_test_paint()
	print("FAILED: %d" % _fails if _fails > 0 else "ALL OK")
	get_tree().quit(1 if _fails > 0 else 0)


func _make(id: String, cfg: Dictionary) -> Car:
	var car := Car.new()
	car.setup(id, cfg)
	car.freeze = true
	add_child(car)
	car.set_physics_process(false)
	return car


func _visuals(car: Car) -> CarVisuals:
	return car.get_node("CarVisuals") as CarVisuals


func _holder(rig: SuspensionRig, kind: String, wheel: int) -> Dictionary:
	for p in rig.parts:
		if p["kind"] == kind and (wheel < 0 or p["wheel"] == wheel):
			return p
	return {}


## The place of the far end of a part (its far point carried by its holder) in the body.
func _tip(p: Dictionary) -> Vector3:
	var h: Node3D = p["holder"]
	var local: Vector3 = (p["rest_basis"] as Basis).inverse() * ((p["far"] as Vector3) - (p["centre"] as Vector3))
	return h.transform * local


func _test_car(id: String) -> void:
	print("== ", id)
	var cfg: Dictionary = Content.load_json("cars/%s/car.json" % id)
	var car := _make(id, cfg)
	var v := _visuals(car)
	_check(v != null and v.rig != null, "%s: a suspension rig" % id)
	if v == null or v.rig == null:
		return
	var rig := v.rig
	var kinds := {}
	for p in rig.parts:
		kinds[p["kind"]] = int(kinds.get(p["kind"], 0)) + 1
	print("   parts: ", kinds, "  library: ", rig.built.get("names", []))
	_check(rig.parts.size() >= 10, "%s: %d moving parts" % [id, rig.parts.size()])
	var rest := {}
	for p in rig.parts:
		rest[p] = (p["holder"] as Node3D).transform
	# the front left wheel 6 cm up, the rear right 4 cm down, steered 0.3 rad to the left
	car.wheels[0].length = car.susp_length - 0.06
	car.wheels[3].length = car.susp_length + 0.04
	car.steer_angle = 0.3
	car.wheels[0].steer = 0.3
	car.wheels[1].steer = 0.28
	for w in car.wheels:
		w.spin = 1.0
	await get_tree().process_frame
	var moved := 0
	for p in rig.parts:
		if not (p["holder"] as Node3D).transform.is_equal_approx(rest[p]):
			moved += 1
	_check(moved >= rig.parts.size() / 2, "%s: %d of %d parts moved" % [id, moved, rig.parts.size()])
	var up := _holder(rig, "upright", 0)
	if not up.is_empty():
		var dy := (up["holder"] as Node3D).position.y - (up["origin"] as Vector3).y
		_check(absf(dy - 0.06) < 0.002, "%s: the upright FL went up %.3f m" % [id, dy])
		var yaw := (up["holder"] as Node3D).basis.get_euler().y - (up["rest_basis"] as Basis).get_euler().y
		_check(absf(yaw - 0.3) < 0.01, "%s: the upright FL turned %.3f rad with the steering" % [id, yaw])
	var arm := _holder(rig, "arm", 0)
	if not arm.is_empty():
		var tip := _tip(arm)
		var far: Vector3 = arm["far"]
		_check(absf(tip.y - far.y - 0.06) < 0.01, "%s: the lower arm FL swung its ball joint up %.3f m" % [id, tip.y - far.y])
	var rack := _holder(rig, "rack", -1)
	if not rack.is_empty():
		var dx := (rack["holder"] as Node3D).position.x - (rack["origin"] as Vector3).x
		_check(absf(dx + rig.rack_travel * 0.3) < 1e-4, "%s: the rack slid %.3f m (to the right for a steer to the left)" % [id, dx])
	for kind in ["spring", "tierod"]:
		var s := _holder(rig, kind, 0)
		if s.is_empty():
			continue
		var len_now := ((p_far_now(rig, s)) - (s["holder"] as Node3D).position).length()
		print("   %s FL: rest %.3f m, now %.3f m" % [kind, s["rest_length"], len_now])
	var axle := _holder(rig, "axle", -1)
	if not axle.is_empty() and axle["rear"]:
		var h: Node3D = axle["holder"]
		var roll := h.basis.get_euler().z - (axle["rest_basis"] as Basis).get_euler().z
		_check(absf(roll - atan2(0.0 - (-0.04), car.rear_track)) < 0.01, "%s: the rear axle rolled %.4f rad" % [id, roll])
	# the pin of the upright: the wheel goes round it
	_check(v.mirrors != null and v.mirrors.list.size() >= 2, "%s: %d mirror glass(es) %s" % [id, v.mirrors.list.size() if v.mirrors else 0,
		[] if v.mirrors == null else v.mirrors.list.map(func(e): return e["side"])])
	if v.mirrors != null:
		await _test_mirrors(car, v)
	car.queue_free()
	await get_tree().process_frame


func p_far_now(_rig: SuspensionRig, p: Dictionary) -> Vector3:
	var h: Node3D = p["holder"]
	return h.transform * (Vector3.UP * float(p["rest_length"]))


func _test_mirrors(car: Car, v: CarVisuals) -> void:
	# (the settings of this run only: --set, never written to the user's settings)
	Settings._overrides["mirror_left_yaw"] = 10.0
	v.mirrors.aim()
	var left: Dictionary = {}
	for e in v.mirrors.list:
		if e["side"] == "left":
			left = e
	if not left.is_empty():
		_check(absf(rad_to_deg((left["pivot"] as Node3D).rotation.y) + 10.0) < 0.01, "the left glass turned 10 degrees outwards")
	Settings._overrides.erase("mirror_left_yaw")
	v.mirrors.aim()
	var cam := ChaseCamera.new()
	add_child(cam)
	cam.follow(car)
	cam.mode = ChaseCamera.Mode.COCKPIT
	cam.current = true
	for i in 6:
		await get_tree().process_frame
	_check(v.mirrors.real_count() >= 1, "real mirrors on from the cockpit: %d" % v.mirrors.real_count())
	cam.mode = ChaseCamera.Mode.FOLLOW
	for i in 3:
		await get_tree().process_frame
	_check(v.mirrors.real_count() == 0, "real mirrors off from behind the car")
	cam.queue_free()


func _test_paint() -> void:
	print("== paint and materials")
	var cfg: Dictionary = Content.load_json("cars/hatchback/car.json")
	cfg["materials"] = {"Glass": {"color": "#ff0000", "opacity": 0.5, "roughness": 0.3}}
	cfg["colors"] = {"body": "#2266ff", "bodyFinish": "flake", "bodyPattern": "hexagons", "bodyUv": "generated", "bodyFlake": 200,
		"rim": "#ffcc00", "rimFinish": "chrome"}
	var car := _make("hatchback", cfg)
	var glass := 0
	var body := 0
	for n in car.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			var m := mi.get_active_material(i) as BaseMaterial3D
			if m == null:
				continue
			if m.resource_name == "Glass" and m.albedo_color.is_equal_approx(Color(1, 0, 0, 0.5)) and m.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA \
					and is_equal_approx(m.roughness, 0.3):
				glass += 1
			if m.resource_name == "carpaint" and m.uv1_triplanar and m.normal_texture != null and m.albedo_color.is_equal_approx(Color("#2266ff")):
				body += 1
	_check(glass > 0, "the override of Glass on %d surfaces" % glass)
	_check(body > 0, "the flake paint (hexagons, generated map) on %d surfaces" % body)
	var model_glass := false
	for n in car.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		for i in (mi.mesh.get_surface_count() if mi.mesh else 0):
			var base := mi.mesh.surface_get_material(i) as BaseMaterial3D
			if base != null and base.resource_name == "Glass" and base.albedo_color.is_equal_approx(Color(1, 0, 0, 0.5)):
				model_glass = true
	_check(not model_glass, "the material of the model itself is not changed")
	# a new car.json (the tuning menu): no paint, no overrides: back to the model
	var plain: Dictionary = cfg.duplicate(true)
	plain.erase("materials")
	plain.erase("colors")
	car.config = plain
	_visuals(car)._process(0.0)
	var left := 0
	for n in car.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		for i in (mi.mesh.get_surface_count() if mi.mesh else 0):
			var o := mi.get_surface_override_material(i)
			if o != null and o.has_meta("car_paint"):
				left += 1
	_check(left == 0, "back to the model after the paint and the overrides were taken away (%d left)" % left)
	for f in CarPaint.FINISHES:
		var m := CarPaint.style(StandardMaterial3D.new(), Color.RED, f, 100.0, "noise", "model")
		_check(m != null and is_equal_approx(m.roughness, CarPaint.FINISHES[f][0]), "finish %s" % f)
	for pat in CarPaint.PATTERNS:
		var t0 := Time.get_ticks_msec()
		var tex := CarPaint.flakes(pat)
		_check(tex != null and tex.get_width() == CarPaint.PATTERN_SIZE, "flake pattern %s made in %d ms" % [pat, Time.get_ticks_msec() - t0])
	car.queue_free()


## A picture of a corner of the car with its wheel up and steered.
func _picture(id: String, path: String) -> void:
	var cfg: Dictionary = Content.load_json("cars/%s/car.json" % id)
	var car := _make(id, cfg)
	var corner := CarModel.SLOTS.find(Content.arg("corner") if Content.arg("corner") != "" else "FL")
	var travel := float(Content.arg("travel")) if Content.arg("travel") != "" else 0.06
	var steer := float(Content.arg("steer")) if Content.arg("steer") != "" else 0.35
	car.wheels[corner].length = car.susp_length - travel
	car.steer_angle = steer
	car.wheels[0].steer = steer
	car.wheels[1].steer = steer
	var w: Car.Wheel = car.wheels[corner]
	var hub := w.hub + w.visual_offset
	var cam := Camera3D.new()
	add_child(cam)
	var view := Content.arg("view") if Content.arg("view") != "" else "side"
	var side := 1.0 if w.left else -1.0
	var eye: Vector3 = {"side": hub + Vector3(side * 1.6, 0.2, 0.9), "below": hub + Vector3(-side * 0.9, -0.55, 0.9),
		"front": Vector3(hub.x * 0.4, hub.y + 0.1, hub.z + 2.2)}[view]
	cam.look_at_from_position(eye, Vector3(hub.x * 0.5, hub.y, hub.z), Vector3.UP)
	cam.fov = 55
	cam.current = true
	if Content.arg("hide-body") != "":
		car.model_root.visible = false
	for i in 20:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("picture: ", path)


## A picture from the cockpit with marks behind the car (a red box behind the left mirror, a blue one behind the right,
## a green floor), and the picture of every real mirror (path-<side>.png).
func _mirror_picture(id: String, path: String) -> void:
	var car := _make(id, Content.load_json("cars/%s/car.json" % id))
	var floor_mesh := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(60, 60)
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.2, 0.5, 0.2)
	pm.material = fm
	floor_mesh.mesh = pm
	floor_mesh.position.y = -car.wheels[0].radius
	add_child(floor_mesh)
	for mark in [[Vector3(2.0, 0.8, -7.0), Color(0.9, 0.1, 0.1)], [Vector3(-2.0, 0.8, -7.0), Color(0.1, 0.2, 0.9)], [Vector3(1.1, 4.4, -6.8), Color(1, 1, 0)]]:
		var box := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(1.2, 1.6, 1.2) if mark[1] != Color(1, 1, 0) else Vector3(4.0, 2.4, 0.5)
		var m := StandardMaterial3D.new()
		m.albedo_color = mark[1]
		bm.material = m
		box.mesh = bm
		box.position = mark[0]
		add_child(box)
	var cam := ChaseCamera.new()
	add_child(cam)
	cam.follow(car)
	cam.mode = ChaseCamera.Mode.COCKPIT
	cam.current = true
	for i in 30:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	for e in _visuals(car).mirrors.list:
		var mi: MeshInstance3D = e["mesh"]
		print("   %s: middle %s, normal %s, box %s, eye %s, mirror camera %s" % [e["side"], mi.global_transform * (e["box"] as AABB).get_center(),
			(mi.global_basis.inverse().transposed() * (e["normal"] as Vector3)).normalized(), (e["box"] as AABB).size, cam.global_position,
			(e["real"]["cam"] as Camera3D).global_transform if not (e["real"] as Dictionary).is_empty() else null])
		if not (e["real"] as Dictionary).is_empty():
			(e["real"]["vp"] as SubViewport).get_texture().get_image().save_png(path.get_basename() + "-" + str(e["side"]) + ".png")
	print("picture: ", path)
