extends Node
## (a scene, for the autoloads: Godot --headless --path godot res://tools/test_driver.tscn)
## Tests the driver of a car (CarDriver, car_driver.gd): builds the cars that have a driver as the game does (standing
## still, frozen), and checks that the bones are found, that the steering wheel of the model is found where the ring of
## the driver is, that the hands reach their grips and the feet their pedals, that the hands go round with the steering
## wheel, and the keys (set, mirror, make from the automatic movement). With a window and --shot=/folder it saves
## pictures of each car from the side and the front, the wheel straight and turned (--cars=hatchback,go-kart-250cc).

var failures := 0


func _ready() -> void:
	get_tree().create_timer(120.0).timeout.connect(func():
		print("TIMEOUT")
		get_tree().quit(2))
	var shot := Content.arg("shot")
	var list := Content.arg("cars").split(",", false) if Content.arg("cars") != "" else PackedStringArray(["hatchback", "go-kart-250cc", "stadium-truck"])
	if shot != "":
		_scene()
	for id in list:
		await _car(id, shot)
	print("RESULT: %s (%d failures)" % ["ok" if failures == 0 else "FAILED", failures])
	get_tree().quit(1 if failures > 0 else 0)


func check(ok: bool, what: String) -> void:
	print(("  ok    " if ok else "  FAIL  ") + what)
	if not ok:
		failures += 1


func _scene() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.32, 0.36, 0.42)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.7, 0.72, 0.75)
	env.ambient_light_energy = 0.8
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.look_at_from_position(Vector3(3, 6, 4), Vector3.ZERO)
	add_child(sun)


func _car(id: String, shot: String) -> void:
	print("== ", id)
	var raw: Variant = Content.load_json("cars/%s/car.json" % id)
	if not raw is Dictionary:
		check(false, "cars/%s/car.json is read" % id)
		return
	var car := Car.new()
	car.setup(id, raw)
	car.freeze = true
	add_child(car)
	car.set_physics_process(false)
	await get_tree().process_frame
	var frame := car.get_node_or_null("Driver") as CarDriver.Frame
	check(frame != null and frame.driver != null, "the driver is in the car")
	if frame == null or frame.driver == null:
		car.queue_free()
		return
	var d := frame.driver
	check(d.complete(), "every bone of the arms and the legs is found: %s" % JSON.stringify(d.bone_config()))
	check(d.bones["head"] >= 0 and d.bones["hips"] >= 0 and not (d.bones["chest"] as Array).is_empty(), "the hips, the chest and the head are found")
	check(frame.wheel != null, "the steering wheel of the model is found")
	if frame.wheel != null and raw["driver"].get("wheel") is Dictionary:
		var ring := BoneIK.vec(raw["driver"]["wheel"]["position"])
		var grips := (BoneIK.vec(raw["driver"]["hands"]["left"]) + BoneIK.vec(raw["driver"]["hands"]["right"])) / 2.0
		# (a ring that was not matched to the steering wheel in the browser either is not checked: the stadium truck)
		if ring.distance_to(grips) < 0.2:
			check(frame.wheel.centre.distance_to(ring) < 0.12, "the steering wheel (%s) is where the ring of the hands is (%s)" % [frame.wheel.centre, ring])
		else:
			print("  note  the ring of the hands (%s) is not at the hands of car.json (%s)" % [ring, grips])
	# standing still, the wheel straight: the hands on their grips, the feet on the pedals
	frame._process(0.016)
	var tb := CarModel.relative(d.skel, d.parent)
	var cfg := d.cfg
	for e in [["armL", "left"], ["armR", "right"]]:
		var role: String = e[0] if d.facing >= 0 else ("armR" if e[0] == "armL" else "armL")
		var hand := tb * BoneIK.global(d.skel, d.bones[role][2]).origin
		var want: Vector3 = d.hand_pose[e[1]]["pos"] if d.hand_pose[e[1]]["keyed"] else BoneIK.vec(cfg["hands"][e[1]])
		check(hand.distance_to(want) < 0.05, "the %s hand is on its grip (%.3f m off)" % [e[1], hand.distance_to(want)])
	for e in [["legL", "left"], ["legR", "right"]]:
		var role: String = e[0] if d.facing >= 0 else ("legR" if e[0] == "legL" else "legL")
		var foot := tb * BoneIK.global(d.skel, d.bones[role][2]).origin
		check(foot.distance_to(BoneIK.vec(cfg["feet"][e[1]])) < 0.06, "the %s foot is on its pedal (%.3f m off)" % [e[1], foot.distance_to(BoneIK.vec(cfg["feet"][e[1]]))])
	var left_before := tb * BoneIK.global(d.skel, d.bones["armL"][2]).origin
	var t0 := Time.get_ticks_usec()
	for i in 100:
		frame._process(0.016)
	print("  time  one frame of the driver: %.3f ms" % ((Time.get_ticks_usec() - t0) / 100000.0))
	var probe: int = d.bones["armL"][2]
	check(BoneIK.global(d.skel, probe).origin.distance_to(d.skel.get_bone_global_pose(probe).origin) < 1e-4, "get_bone_global_pose agrees")
	if shot != "":
		await _shots(car, id, shot, "straight")
	# the wheel turned a quarter of the lock to the left: the wheel and the hands go round
	car.steer_angle = car.max_steer * 0.5
	for i in 90:
		frame._process(1.0 / 60.0)
	var half := deg_to_rad(frame.wheel.degrees) * 0.5
	check(absf(frame.wheel.angle - half) < 1e-3, "the steering wheel turned %.0f°" % rad_to_deg(frame.wheel.angle))
	var left_after := CarModel.relative(d.skel, d.parent) * BoneIK.global(d.skel, d.bones["armL"][2]).origin
	check(left_after.distance_to(left_before) > 0.03, "the hand went with the wheel (%.3f m)" % left_after.distance_to(left_before))
	if shot != "":
		await _shots(car, id, shot, "left")
	car.steer_angle = -car.max_steer
	for i in 90:
		frame._process(1.0 / 60.0)
	if shot != "":
		await _shots(car, id, shot, "right")
	# the cockpit: the head is not drawn
	d.set_cockpit(true, false)
	frame._process(0.016)
	check(d.skel.get_bone_pose_scale(d.bones["head"]).x < 0.01, "in the cockpit view the head is not drawn")
	var cut: Variant = d._cull[0]["cut"] if not d._cull.is_empty() else null
	var cut_ok: bool = cut is ArrayMesh and (d._cull[0]["mesh"] as MeshInstance3D).mesh == cut
	check(cut_ok, "and the mesh without the torso is drawn (%d bones of the torso)" % (d._cull[0]["hide"] as Array).size())
	if shot != "":
		await _cockpit(car, id, shot)
	d.set_cockpit(false, false)
	_keys(d)
	car.queue_free()
	await get_tree().process_frame


## The keys: a key set and read back, the mirror image, the keys made from the automatic movement.
func _keys(d: CarDriver) -> void:
	var saved: Variant = d.cfg.get("keys")
	d.cfg["keys"] = null
	check(not d.keys_active(), "without keys the hands move by themselves")
	check(d.bake_keys(), "keys made from the automatic movement")
	var n := (d.cfg["keys"]["left"] as Array).size()
	check(n > 10 and (d.cfg["keys"]["right"] as Array).size() == n, "%d keys for each hand, the chest and the head at 0" % n)
	var k: Variant = d.key_at("left", 0.0)
	check(k is Dictionary and BoneIK.vec(k["pos"]).distance_to(BoneIK.vec(d.cfg["hands"]["left"])) < 0.01, "the key at 0 is the grip of the hand")
	d.set_key("left", 55.0, Vector3(0.1, 0.5, 0.3), Quaternion.IDENTITY, 0.5, false)
	var k2: Variant = d.key_at("left", 55.0)
	check(k2 is Dictionary and BoneIK.vec(k2["pos"]).distance_to(Vector3(0.1, 0.5, 0.3)) < 1e-3 and float(k2["grip"]) == 0.5, "a key set by hand is kept")
	d.turn = -55.0 * CarDriver.DEG
	var g: Variant = d._key_pose("left", d.turn)
	check(g is float and absf(float(g) - 0.5) < 1e-3 and (d.hand_pose["left"]["pos"] as Vector3).distance_to(Vector3(0.1, 0.5, 0.3)) < 1e-3, "the hand is at the key there")
	var made := d.mirror_keys()
	var m: Variant = d.key_at("right", -55.0)
	check(made > 0 and m is Dictionary, "%d keys mirrored to the other side" % made)
	d.remove_key("left", 55.0)
	check(d.key_at("left", 55.0) == null, "a key removed")
	d.cfg["keys"] = saved
	d.turn = 0.0


func _cam() -> Camera3D:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		cam = Camera3D.new()
		cam.fov = 40.0
		cam.near = 0.02
		add_child(cam)
		cam.make_current()
	return cam


func _shots(car: Car, id: String, folder: String, what: String) -> void:
	var cam := _cam()
	var c := Vector3(0.0, 0.6, 0.0)
	var frame := car.get_node("Driver") as CarDriver.Frame
	if frame.wheel != null:
		c = frame.wheel.centre
	var views := {"side": c + Vector3(2.4, 0.5, 0.4), "front": c + Vector3(0.3, 0.6, 2.2)}
	for v in views:
		cam.global_transform = Transform3D(Basis.IDENTITY, views[v]).looking_at(c - Vector3(0, 0.15, 0.25), Vector3.UP)
		for i in 3:
			await get_tree().process_frame
		await RenderingServer.frame_post_draw
		var path := folder.path_join("driver-%s-%s-%s.png" % [id, what, v])
		get_viewport().get_texture().get_image().save_png(path)
		print("saved ", path)


func _cockpit(car: Car, id: String, folder: String) -> void:
	var cam := _cam()
	var cams: Dictionary = car.config.get("cameras", {})
	var p := BoneIK.vec(cams.get("cockpit", {}).get("position", [0.35, 0.9, -0.2]))
	cam.global_transform = car.global_transform * Transform3D(Basis(Vector3.UP, PI), p)
	cam.fov = float(cams.get("cockpit", {}).get("fov", 75))
	for i in 3:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var path := folder.path_join("driver-%s-cockpit.png" % id)
	get_viewport().get_texture().get_image().save_png(path)
	print("saved ", path)
	cam.fov = 40.0
	await _shots(car, id, folder, "cockpit-cut")
