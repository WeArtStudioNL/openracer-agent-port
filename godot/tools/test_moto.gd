extends Node3D
## (a scene, for the autoloads: Godot --fixed-fps 60 --path godot res://tools/test_moto.tscn -- --car=sports-motorcycle-600cc)
## The rider of a motorcycle (motorcycle_rider.gd, rider_ragdoll.gd) on a flat floor: the bike speeds up straight (the
## shift lever taps with every shift), brakes hard from 60 km/h (the fork dives more than the shock, the rider is pushed
## forward by the g-forces, the front brake lever is pulled and the fingers close), goes on, the rider goes limp at 40
## km/h (the key 9: the bike goes down and he slides off as a ragdoll), is put back, and rides into a wall at 50 km/h
## (the crash throws him off). Every step is checked; with a window and --shot=/folder it saves brake.png, levers.png,
## limp.png and crash.png there, and limp_<t>.png, crash_<t>.png (the limp rider and the crash a few moments after).
## --user-dir as for the game.

var car: Car
var cam: Camera3D
var failures := 0
var _walls: WallGrid
var _phase := "run"
var _time := 0.0
var _since := 0.0
var _shot := ""
var _shift_max := 0.0
var _fork_peak := 0.0
var _gears := 0
var _brake_seen := {}
var _throttle_seen := false
var _wall_z := 70.0
var _view := "side"


func _ready() -> void:
	get_tree().create_timer(90.0).timeout.connect(func():
		print("TIMEOUT")
		get_tree().quit(2))
	var id := Content.arg("car") if Content.arg("car") != "" else "sports-motorcycle-600cc"
	_shot = Content.arg("shot")
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
	var grey := StandardMaterial3D.new()
	grey.albedo_color = Color(0.36, 0.37, 0.38)
	floor_mesh.material_override = grey
	add_child(floor_mesh)
	_walls = WallGrid.new()
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
	car.place(Vector3(0, car.wheels[0].radius + 0.05, 0), PI / 2.0)
	cam = Camera3D.new()
	add_child(cam)
	cam.make_current()
	await get_tree().process_frame
	var rider := _rider()
	check(car.bike != null and car.bike_model != null and rider != null, "%s is a motorcycle with a rider" % id)
	if rider == null:
		_end()
		return
	check(rider.can_ragdoll(), "the rider has the bones for the ragdoll")
	check(rider.levers.has("brake") and rider.levers.has("clutch"), "the front brake lever and the clutch lever are found (%s)" % [rider.levers.keys()])
	check(rider.shifter != null, "the shift lever is found")
	check(not rider.fingers["armL"].is_empty() and not rider.fingers["armR"].is_empty(), "the fingers are found (%d, %d bones)" % [
		rider.fingers["armL"].size(), rider.fingers["armR"].size()])
	print("fork slope %.3f (-tan of the rake), swingarm slope %.3f" % [car.bike.fork_slope, car.bike.swing_slope])
	check(car.bike.fork_slope < -0.2, "the fork leans back")


func _rider() -> MotorcycleRider:
	return car.bike_model.rider if car.bike_model != null else null


func check(ok: bool, what: String) -> void:
	print(("  ok    " if ok else "  FAIL  ") + what)
	if not ok:
		failures += 1


func walls() -> WallGrid:
	return _walls


func _wall() -> void:
	var xf := Transform3D(Basis.IDENTITY, Vector3(0, 1.0, _wall_z))
	var body := StaticBody3D.new()
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(10, 2, 1)
	col.shape = shape
	body.add_child(col)
	body.transform = xf
	add_child(body)
	var mesh := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = shape.size
	mesh.mesh = bm
	mesh.transform = xf
	add_child(mesh)
	_walls.add_faces(bm.get_faces(), xf, "wall")


func _physics_process(dt: float) -> void:
	if car == null or _rider() == null:
		return
	_time += dt
	_since += dt
	var rider := _rider()
	var fwd := car.global_transform.basis.z
	var straight := clampf(-car.global_position.x * 0.15 - fwd.x * 1.5, -0.3, 0.3)
	_shift_max = maxf(_shift_max, absf(float(rider.shift["angle"])))
	match _phase:
		"run":
			car.steer_input = straight
			car.throttle_input = 1.0
			car.brake_input = 0.0
			if car.speed > 20.0 / 3.6 and _shift_max == 0.0 and _since > 0.5 and not _throttle_seen:
				_throttle_seen = true
				print("on the throttle: the rider %.1f cm back" % (-rider.g_off.z * 100.0))
				check(rider.g_off.z < -0.01, "the rider is pushed back by the throttle")
				_save("throttle.png", "side")
			if car.speed > 30.0 / 3.6 and _gears == 0:
				_gears = car.gear
				car.shift(true)                 # (a shift by the key: the gearbox is manual from here on)
			if car.speed > 60.0 / 3.6:
				check(_shift_max > 0.1, "the shift lever tapped (%.2f rad) from gear %d to %d" % [_shift_max, _gears, car.gear])
				car.manual = false
				_go("brake")
		"brake":
			car.throttle_input = 0.0
			car.brake_input = 1.0
			car.steer_input = straight
			_fork_peak = maxf(_fork_peak, car.wheels[0].fe_load)         # (the most of it: the load goes up and down with the ABS)
			if _since > 0.35 and _brake_seen.is_empty():
				var front := car.wheels[0]
				var lever: Node3D = rider.levers["brake"]["node"]
				var rest: Transform3D = rider.levers["brake"]["rest"]
				_brake_seen = {"fe": front.fe_load, "g": rider.g_off.z, "lever": rad_to_deg(lever.basis.get_rotation_quaternion().angle_to(rest.basis.get_rotation_quaternion())),
					"speed": car.speed * 3.6}
				print("on the brake at %.0f km/h: fork load %.0f N, the rider %.1f cm forward, the lever %.1f deg" % [_brake_seen["speed"],
					_brake_seen["fe"], rider.g_off.z * 100.0, _brake_seen["lever"]])
				check(_fork_peak > 100.0, "the fork takes a load along its travel on the brake (it dives)")
				check(rider.g_off.z > 0.02, "the rider is pushed forward by the brake")
				check(float(_brake_seen["lever"]) > 8.0, "the front brake lever is pulled")
				_save("brake.png", "side")
			if _since > 0.6 and _since < 0.6 + dt * 1.5:
				_save("levers.png", "bars")
			if car.speed < 3.0 or _since > 4.0:
				_go("speed up")
		"speed up":
			car.steer_input = straight
			car.throttle_input = 0.7
			car.brake_input = 0.0
			if car.speed > 40.0 / 3.6:
				car.bike_model.go_limp()
				check(car.bike.limp and rider.ragdoll != null, "the key 9: the rider goes limp on the bike")
				_go("limp")
		"limp":
			car.throttle_input = 0.0
			car.steer_input = 0.0
			if _since > 0.5 and _since < 0.5 + dt * 1.5:
				_save("limp_ride.png", "side")
			for at in [0.25, 1.0, 1.5]:
				if _since > at and _since < at + dt * 1.5:
					_save("limp_%.2f.png" % at, "side")
			if Content.arg("debug") != "" and int(_since * 60.0) % 6 == 0 and _since < 1.0:
				var r := rider.ragdoll
				var inv := car.global_transform.affine_inverse()
				var parts := PackedStringArray()
				for i in RiderRagdoll.COUNT:
					var l := inv * r.p[i]
					parts.append("%d:%.2f,%.2f,%.2f" % [i, l.x, l.y, l.z])
				print("t %.2f lean %.0f v %.2f  %s" % [_since, rad_to_deg(car.bike.lean), car.speed, " ".join(parts)])
				if _since < 0.02:
					var vs := PackedStringArray()
					for i in RiderRagdoll.COUNT:
						var dv := car.global_transform.basis.inverse() * (r.v0[i] - car.linear_velocity)
						vs.append("%d:%.1f,%.1f,%.1f" % [i, dv.x, dv.y, dv.z])
					print("v0 rel ", " ".join(vs), "  box ", r._box_on, " ", r._box_half, " near ", r._box_xf.origin.distance_to(r.centre))
			if _since > 5.0:
				check(car.bike.crashed, "the bike with the limp rider went down (%s)" % car.bike.crash_reason)
				_check_ragdoll("limp")
				_save("limp.png", "ragdoll")
				_go("limp shot")
		"limp shot":
			if _since > 0.5:
				car.place(Vector3(0, car.wheels[0].radius + 0.05, 0), PI / 2.0)
				car.repair()
				_go("back")
		"back":
			car.throttle_input = 0.0
			car.brake_input = 1.0
			if _since > 0.5:
				check(rider.ragdoll == null and rider.root.visible and not car.bike.crashed, "after a reset the rider is back on the bike")
				_wall()
				_go("wall")
		"wall":
			car.steer_input = straight
			car.brake_input = 0.0
			car.throttle_input = 1.0 if car.speed < 50.0 / 3.6 else 0.0
			if car.bike.crashed:
				print("down (%s) at %.0f km/h, %.1f m from the start" % [car.bike.crash_reason, car.speed * 3.6, car.global_position.z])
				_go("crash")
			elif _since > 12.0:
				check(false, "the bike hit the wall")
				_end()
		"crash":
			for at in [0.15, 0.5, 1.0, 1.8]:
				if _since > at and _since < at + dt * 1.5:
					_save("crash_%.2f.png" % at, "ragdoll")
			if _since > 3.0:
				check(rider.ragdoll != null, "the rider is thrown off as a ragdoll")
				_check_ragdoll("crash")
				_save("crash.png", "ragdoll")
				_end()


func _go(phase: String) -> void:
	_phase = phase
	_since = 0.0


func _check_ragdoll(what: String) -> void:
	var r := _rider().ragdoll
	if r == null:
		check(false, "%s: a ragdoll" % what)
		return
	var low := INF
	var high := -INF
	var finite := true
	for i in RiderRagdoll.COUNT:
		low = minf(low, r.p[i].y - r.rad[i])
		high = maxf(high, r.p[i].y)
		finite = finite and r.p[i].is_finite()
	var worst := 0.0
	for st in r.sticks:
		worst = maxf(worst, absf(r.p[st[0]].distance_to(r.p[st[1]]) - float(st[2])))
	print("%s: the ragdoll from %.2f to %.2f m above the floor, the middle %.1f m from the bike, sticks within %.1f cm, still for %.1f s" % [
		what, low, high, r.centre.distance_to(car.global_position), worst * 100.0, r.asleep])
	check(finite and low > -0.05 and high < 1.6, "%s: the rider lies on the floor" % what)
	check(worst < 0.05, "%s: the body holds together" % what)


## A picture: "side" beside the bike, "bars" over the right shoulder at the bars, "ragdoll" at the rider on the floor.
func _save(file: String, view: String) -> void:
	if _shot == "":
		return
	_place_camera(view)
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	_place_camera(view)
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	DirAccess.make_dir_recursive_absolute(_shot)
	img.save_png(_shot.path_join(file))
	print("shot: ", _shot.path_join(file))


func _place_camera(view: String) -> void:
	_view = view


func _process(_delta: float) -> void:
	if car == null:
		return
	var xf := car.global_transform
	var p := xf.origin
	match _view:
		"side":
			cam.fov = 45.0
			cam.global_transform = Transform3D(Basis(), p + xf.basis * Vector3(-3.2, 0.9, 0.3)).looking_at(p + Vector3.UP * 0.4)
		"bars":
			cam.fov = 40.0
			var grip: Node3D = _rider().grips["right"]
			var at := grip.global_position
			cam.global_transform = Transform3D(Basis(), p + xf.basis * Vector3(-0.7, 1.25, 1.25)).looking_at(at)
		"ragdoll":
			cam.fov = 50.0
			var r := _rider().ragdoll
			var c := r.centre if r != null else p
			cam.global_transform = Transform3D(Basis(), c + Vector3(-2.6, 1.6, -1.2)).looking_at(c)


func _end() -> void:
	_phase = "end"
	print("RESULT: %s (%d failures)" % ["ok" if failures == 0 else "FAILED", failures])
	await get_tree().create_timer(0.2).timeout
	get_tree().quit(1 if failures > 0 else 0)
