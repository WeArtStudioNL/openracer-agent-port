extends Node3D
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_parts.tscn -- --car=hatchback)
## The hinged parts and a wheel that comes off (Parts.js, SOFTBODY.md): the car drives on a flat floor, every hinged
## part is unlatched after a second, and the car weaves and brakes hard, so that they swing; the angle of every one on
## its hinge is printed, with the range of its pin (it must stay in it). Then the front left wheel is torn off: it must
## roll away as a body and hit the floor (and the car, once it is clear of it), and the car must go on on three. Then
## a breakable part is broken (its pieces and particles), and the car is repaired: everything back.
## Without --headless, --shot=file.png saves a picture while the parts swing (--shot-at seconds, 3 by default).

var car: Car
var cam: Camera3D
var _walls := WallGrid.new()
var _time := 0.0
var _phase := "drive"
var _range := {}                    # part -> [min, max] seen (degrees)
var _shot := ""
var _shot_at := 3.0
var _wheel_from := Vector3.ZERO
var _wheel_hit_car := false
var _ok := true


func _ready() -> void:
	get_tree().create_timer(90.0).timeout.connect(get_tree().quit)
	var id := Content.arg("car") if Content.arg("car") != "" else "hatchback"
	_shot = Content.arg("shot")
	if Content.arg("shot-at") != "":
		_shot_at = float(Content.arg("shot-at"))
	add_to_group("track")
	var floor_body := StaticBody3D.new()
	var floor_col := CollisionShape3D.new()
	var floor_shape := BoxShape3D.new()
	floor_shape.size = Vector3(800, 1, 800)
	floor_col.shape = floor_shape
	floor_col.position = Vector3(0, -0.5, 0)
	floor_body.add_child(floor_col)
	add_child(floor_body)
	var floor_mesh := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(800, 800)
	floor_mesh.mesh = pm
	add_child(floor_mesh)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.8, 0.6, 0)
	sun.shadow_enabled = true
	add_child(sun)
	var we := WorldEnvironment.new()
	we.environment = Environment.new()
	we.environment.background_mode = Environment.BG_COLOR
	we.environment.background_color = Color(0.55, 0.65, 0.8)
	we.environment.ambient_light_color = Color(0.6, 0.6, 0.6)
	we.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	add_child(we)
	car = Car.new()
	var cfg: Variant = Content.load_json("cars/%s/car.json" % id)
	car.setup(id, cfg if cfg is Dictionary else {})
	add_child(car)
	car.place(Vector3(0, car.wheels[0].radius + 0.15, 0), PI / 2.0)
	cam = Camera3D.new()
	add_child(cam)
	cam.make_current()
	var hinges := []
	if car.parts != null:
		for p in car.parts.parts:
			if p.mode == "hinge":
				hinges.append(p.name)
	print("parts test: %s, %d parts, hinged: %s; wheel rig: %s" % [id, car.parts.parts.size() if car.parts else 0, ", ".join(hinges),
		"yes" if car.shell != null and car.shell.rig != null and car.shell.rig.rigs[0] != null else "no"])


func walls() -> WallGrid:
	return _walls


## The angle of a hinged part on its joint (degrees, about the X of the joint), from its rest place.
func _angle(p: CarParts.Part) -> float:
	if p.body == null or p.joint == null or not is_instance_valid(p.joint):
		return NAN
	var jx := p.joint.global_transform.basis.orthonormalized()
	var rel := (car.global_transform.basis.orthonormalized().inverse() * p.body.global_transform.basis.orthonormalized())
	var rest := (car.global_transform.basis.orthonormalized().inverse() * jx)
	var q := (rest.inverse() * rel * rest).get_rotation_quaternion()
	return rad_to_deg(wrapf(2.0 * atan2(q.x, q.w), -PI, PI))


func _physics_process(dt: float) -> void:
	_time += dt
	var fwd := car.global_transform.basis.z
	match _phase:
		"drive":
			car.throttle_input = 1.0 if car.speed < 50.0 / 3.6 else 0.0
			car.steer_input = clampf(-car.global_position.x * 0.3 - fwd.x * 2.0, -0.3, 0.3)
			if _time > 1.0 and car.parts != null:
				for p in car.parts.parts:
					if p.mode == "hinge" and p.state == "held":
						car.parts._start(p, "hinge")
				_phase = "weave"
				_time = 0.0
		"weave":
			car.throttle_input = 1.0 if car.speed < 50.0 / 3.6 else 0.0
			car.steer_input = 0.6 * sin(_time * 2.5)
			if _time > 4.0:
				print("weaving with the parts open: %.1f km/h" % (car.speed * 3.6))
				_phase = "brake"
				_time = 0.0
		"brake":
			car.throttle_input = 0.0
			car.brake_input = 1.0
			car.steer_input = 0.0
			if _time > 2.0:
				_report_hinges()
				_phase = "wheel"
				_time = 0.0
				car.brake_input = 0.0
		"wheel":
			car.throttle_input = 1.0 if car.speed < 40.0 / 3.6 else 0.0
			car.steer_input = 0.0
			if _time > 1.5 and car.shell != null and not car.shell.rig.lost[0]:
				car.shell.rig.tear_off(0)
				_wheel_from = car.global_position
				print("wheel FL torn off at %.1f km/h" % (car.speed * 3.6))
			if _time > 1.5:
				var b: RigidBody3D = car.shell.rig.bodies[0] if car.shell != null else null
				if b != null and not b.get_collision_exceptions().has(car):
					_wheel_hit_car = true
			if _time > 5.0:
				_report_wheel()
				_phase = "break"
				_time = 0.0
		"break":
			car.throttle_input = 0.0
			car.brake_input = 1.0
			if _time > 0.2 and car.parts != null:
				for p in car.parts.parts:
					if p.mode == "breakable" and p.state == "held":
						car.parts._break(p)
						print("broke %s" % p.name)
						break
				_phase = "pieces"
				_time = 0.0
		"pieces":
			if _time > 1.0:
				var fx := Shatter.of(car)
				print("shatter: %s" % fx.count())
				car.repair()
				_phase = "repaired"
				_time = 0.0
		"repaired":
			if _time > 0.5:
				var off := car.parts.count_off() if car.parts else 0
				var lost := 0
				for i in 4:
					if car.shell != null and car.shell.rig.lost[i]:
						lost += 1
				print("repaired: parts off %d, wheels off %d, FL on the road: %s" % [off, lost, car.wheels[0].contact])
				_ok = _ok and off == 0 and lost == 0
				print("RESULT: %s" % ("ok" if _ok else "FAILED"))
				get_tree().quit()
	if car.parts != null and not (_phase == "weave" and _time < 0.5):    # (a closed part outside its range is pushed in first)
		for p in car.parts.parts:
			if p.state == "hinged":
				var a := _angle(p)
				if not is_nan(a):
					if Content.arg("verbose") != "" and fmod(_time, 0.25) < 1.0 / 120.0:
						print("  %s %.2f s %s: %.0f deg, spin %.1f, speed %.1f km/h" % [_phase, _time, p.name, a, p.body.angular_velocity.length(), car.speed * 3.6])
					var r: Array = _range.get(p.name, [a, a])
					_range[p.name] = [minf(r[0], a), maxf(r[1], a)]


func _report_hinges() -> void:
	for p in car.parts.parts:
		if p.mode != "hinge":
			continue
		var r: Array = _range.get(p.name, [NAN, NAN])
		var lim := "free"
		if p.joint != null and is_instance_valid(p.joint):
			var j := p.joint as Generic6DOFJoint3D
			if j.get("angular_limit_x/enabled"):
				# (the joint of Jolt has the range mirrored: see CarParts._join)
				lim = "%.0f..%.0f" % [-rad_to_deg(float(j.get("angular_limit_x/upper_angle"))), -rad_to_deg(float(j.get("angular_limit_x/lower_angle")))]
		# (a pin that is turned about its axis can have the closed part outside its range: it is pushed in when it opens)
		# (a pin with more axes turns about the others too: its angle about X is only near its range)
		var slack := 6.0 if p.mounts.is_empty() or p.mounts[0].axes.values().count(true) <= 1 else 15.0
		var inside: bool = lim == "free" or is_nan(r[0]) or (r[0] >= minf(0.0, float(lim.split("..")[0])) - slack and r[1] <= maxf(0.0, float(lim.split("..")[1])) + slack)
		print("hinge %s: %s, swung %.0f..%.0f deg, its range %s %s" % [p.name, p.state, r[0], r[1], lim, "" if inside else "OUTSIDE"])
		_ok = _ok and inside


func _report_wheel() -> void:
	var b: RigidBody3D = car.shell.rig.bodies[0] if car.shell != null else null
	if b == null or not is_instance_valid(b):
		print("wheel: no body")
		_ok = false
		return
	var fl := car.wheels[0]
	print("wheel body: %.1f m from the car, %.1f m/s, spin %.1f rad/s, height %.2f m (radius %.2f), hits the car again: %s" % [
		b.global_position.distance_to(car.global_position), b.linear_velocity.length(), b.angular_velocity.length(), b.global_position.y,
		fl.radius, _wheel_hit_car])
	print("car on three wheels: %.1f km/h, %.1f m from where the wheel came off, FL contact %s, loads %.0f %.0f %.0f %.0f N" % [car.speed * 3.6,
		car.global_position.distance_to(_wheel_from), fl.contact, car.wheels[0].load, car.wheels[1].load, car.wheels[2].load, car.wheels[3].load])
	_ok = _ok and b.global_position.y > 0.0 and not fl.contact


func _process(_delta: float) -> void:
	if car == null:
		return
	var p := car.global_transform.origin
	var view: Vector3 = car.global_transform.basis * Vector3(4.5, 2.2, -1.5)
	cam.global_transform = Transform3D(Basis(), p + view).looking_at(p + Vector3(0, 0.3, 0))
	if _shot != "" and _phase == "weave" and _time > _shot_at - 1.0:
		get_viewport().get_texture().get_image().save_png(_shot)
		print("shot: ", _shot)
		_shot = ""
