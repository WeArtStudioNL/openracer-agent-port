extends Node3D
## (a scene, for the autoloads: Godot --path godot res://tools/test_rig.tscn -- --car=stadium-truck [--shot=file.png])
## The moving parts of the suspension (SuspensionRig.js) and the parts library (PartsLibrary.js): the car stands on a
## flat floor with the body of the model hidden, steers to the left and is pressed down on one side, and the parts are
## printed (where the upright, the arms, the spring are against the wheel). Without --headless --shot saves a picture
## from the front, low (and file-1.png at rest).

var car: Car
var cam: Camera3D
var _time := 0.0
var _shot := ""
var _walls := WallGrid.new()


func _ready() -> void:
	get_tree().create_timer(30.0).timeout.connect(get_tree().quit)
	var id := Content.arg("car") if Content.arg("car") != "" else "stadium-truck"
	_shot = Content.arg("shot")
	add_to_group("track")
	var floor_body := StaticBody3D.new()
	var floor_col := CollisionShape3D.new()
	var floor_shape := BoxShape3D.new()
	floor_shape.size = Vector3(200, 1, 200)
	floor_col.shape = floor_shape
	floor_col.position = Vector3(0, -0.5, 0)
	floor_body.add_child(floor_col)
	add_child(floor_body)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.6, 2.4, 0)
	add_child(sun)
	var we := WorldEnvironment.new()
	we.environment = Environment.new()
	we.environment.background_mode = Environment.BG_COLOR
	we.environment.background_color = Color(0.55, 0.65, 0.8)
	we.environment.ambient_light_color = Color(0.7, 0.7, 0.7)
	we.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	add_child(we)
	car = Car.new()
	var cfg: Variant = Content.load_json("cars/%s/car.json" % id)
	car.setup(id, cfg if cfg is Dictionary else {})
	add_child(car)
	car.place(Vector3(0, car.wheels[0].radius + 0.1, 0), PI / 2.0)
	cam = Camera3D.new()
	add_child(cam)
	cam.make_current()
	var rig := car.get_node_or_null("SuspensionRig") as SuspensionRig
	var kinds := {}
	if rig != null:
		for p: Dictionary in rig.parts:
			kinds[p["kind"]] = int(kinds.get(p["kind"], 0)) + 1
	print("rig of %s: %s; parts library: %s" % [id, kinds if rig else "none", "yes" if car.get_node_or_null("PartsLibrary") != null else "no"])


func walls() -> WallGrid:
	return _walls


func _physics_process(dt: float) -> void:
	_time += dt
	car.steer_input = 0.0 if _time < 2.0 else 1.0
	car.brake_input = 1.0
	if _time > 2.0:
		# (the left side pressed down: the springs go in, the arms swing up)
		car.apply_force(Vector3.DOWN * car.mass * 6.0, car.global_transform.basis * Vector3(0.8, 0, 0))


func _process(_delta: float) -> void:
	if car == null:
		return
	var p := car.global_transform.origin
	cam.global_transform = Transform3D(Basis(), p + car.global_transform.basis * Vector3(-0.5, 0.0, 4.5)).looking_at(p + Vector3(0, -0.1, 0))
	if _shot != "" and _time > 1.5 and _time < 1.6 and DisplayServer.get_name() != "headless":
		_hide_body()
		get_viewport().get_texture().get_image().save_png(_shot.replace(".png", "-1.png"))
	if _time > 3.5:
		var rig := car.get_node_or_null("SuspensionRig") as SuspensionRig
		if rig != null:
			for part: Dictionary in rig.parts:
				if part.get("wheel", -1) == 0 and part["kind"] in ["upright", "arm", "spring", "tierod"]:
					var h: Node3D = part["holder"]
					print("  FL %s at %s, turned %s" % [part["kind"], h.position, h.basis.get_euler()])
			print("  FL wheel at %s, steer %.2f; travel FL %.3f FR %.3f" % [car.wheels[0].hub_node.position, car.wheels[0].steer,
				car.susp_length - car.wheels[0].length, car.susp_length - car.wheels[1].length])
		if _shot != "" and DisplayServer.get_name() != "headless":
			get_viewport().get_texture().get_image().save_png(_shot)
			print("shot: ", _shot)
		get_tree().quit()


func _hide_body() -> void:
	# (the body of the model, so that the suspension can be seen: every mesh of the model that is not a part of the rig)
	for m in car.model_root.find_children("*", "MeshInstance3D", true, false):
		(m as MeshInstance3D).visible = false
	if car.shell_mesh != null:
		for m in car.shell_mesh.meshes:
			m.visible = false
