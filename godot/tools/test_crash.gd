extends Node3D
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_crash.tscn -- --car=openracer-muscle --speed=60)
## The crash test of the car editor (SOFTBODY.md): the car drives straight ahead from rest on a flat floor into a
## wall (2.6 m + v^2/5 ahead), at --speed km/h (60 by default) and --angle degrees (0: head-on). It prints the peak
## deceleration, the bend of the shell, the energy it took up and the torn anchors and beams, then puts the car on
## the floor again facing away and drives it on (the car must still drive), and repairs it. Without --headless,
## --shot=file.png saves a picture of the dent a moment after the hit. --set=damage:false: the same with a rigid car.
## --puncture=1 punctures the front left tyre as it drives on, and prints its pressure.

var car: Car
var cam: Camera3D
var _walls: WallGrid
var _wall_xf: Transform3D
var _target := 60.0 / 3.6
var _phase := "accelerate"
var _time := 0.0
var _hit_time := -1.0
var _peak_g := 0.0
var _last_v := Vector3.ZERO
var _max_step_us := 0
var _shot := ""
var _speed_at_hit := 0.0


func _ready() -> void:
	get_tree().create_timer(60.0).timeout.connect(get_tree().quit)
	var id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	_target = (float(Content.arg("speed")) if Content.arg("speed") != "" else 60.0) / 3.6
	var angle := deg_to_rad(float(Content.arg("angle")) if Content.arg("angle") != "" else 0.0)
	_shot = Content.arg("shot")
	add_to_group("track")
	# the floor and the wall
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
	var distance := maxf(19.8, 2.6 + _target * _target / 5.0)
	_wall_xf = Transform3D(Basis(Vector3.UP, angle), Vector3(0, 1.5, distance + 0.5))
	var wall_body := StaticBody3D.new()
	var wall_col := CollisionShape3D.new()
	var wall_shape := BoxShape3D.new()
	wall_shape.size = Vector3(12, 3, 1)
	wall_col.shape = wall_shape
	wall_body.add_child(wall_col)
	wall_body.transform = _wall_xf
	add_child(wall_body)
	var wall_mesh := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = wall_shape.size
	wall_mesh.mesh = bm
	var see := StandardMaterial3D.new()
	see.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	see.albedo_color = Color(0.9, 0.9, 0.9, 0.12)
	wall_mesh.material_override = see
	wall_mesh.transform = _wall_xf
	add_child(wall_mesh)
	_walls = WallGrid.new()
	_walls.add_faces(bm.get_faces(), _wall_xf, "wall")
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
	if Content.arg("roll") != "":
		# (a car that lies on its side: it lies on its box, as without a shell)
		var xf := Transform3D(Basis(Vector3.BACK, PI / 2.0), Vector3(0, 1.5, 0))
		PhysicsServer3D.body_set_state(car.get_rid(), PhysicsServer3D.BODY_STATE_TRANSFORM, xf)
		car.global_transform = xf
		_phase = "roll"
	if car.shell != null and Content.arg("steps") != "":
		car.shell.sb.max_steps = int(Content.arg("steps"))
	cam = Camera3D.new()
	add_child(cam)
	cam.make_current()
	print("crash test: %s at %.0f km/h, wall %.1f m ahead at %.0f degrees, damage %s, %s" % [id, _target * 3.6, distance,
		rad_to_deg(angle), Settings.get_value("damage"), "%d nodes %d beams" % [car.shell.sb.count, car.shell.sb.beam_count] if car.shell else "no shell"])


func walls() -> WallGrid:
	return _walls


func _physics_process(dt: float) -> void:
	_time += dt
	var v := car.linear_velocity
	var fwd := car.global_transform.basis.z
	if _hit_time >= 0.0 and _time - _hit_time < 1.0:
		_peak_g = maxf(_peak_g, (v - _last_v).length() / dt / 9.81)
	_last_v = v
	if car.shell != null:
		_max_step_us = maxi(_max_step_us, car.shell.step_usec)
	if Content.arg("max-nodes") != "" and absf(_time - 1.0) < dt / 2.0:
		# (the tuning menu: another number of nodes made from the model, while the car drives)
		var cfg := car.config.duplicate(true)
		Tuning.write(cfg, "softbody.max_nodes", int(Content.arg("max-nodes")))
		car.apply_config(cfg)
		print("max_nodes %s: %d nodes" % [Content.arg("max-nodes"), car.shell.sb.count if car.shell else 0])
	match _phase:
		"accelerate":
			car.steer_input = clampf(-car.global_position.x * 0.3 - fwd.x * 2.0, -0.2, 0.2)
			car.throttle_input = 1.0 if car.speed < _target else 0.0
			var touching := car.shell != null and car.shell.hit > 0.0
			var to_wall := (_wall_xf.origin.z - 0.5) - (car.global_position.z + float(car.config.get("dimensions", {}).get("length", 4.2)) / 2.0)
			if touching or to_wall < 0.05 or (car.shell == null and car.speed < _target * 0.6 and _time > 3.0 and to_wall < 3.0):
				_phase = "hit"
				_hit_time = _time
				_speed_at_hit = car.speed
				car.throttle_input = 0.0
				car.brake_input = 1.0
				car.steer_input = 0.0
		"roll":
			car.throttle_input = 0.0
			if _time > 3.0:
				print("on its side: the middle %.2f m above the floor, up %.2f, half the width %.2f m" % [car.global_position.y, car.global_transform.basis.y.y,
					float(car.config.get("dimensions", {}).get("width", 1.8)) / 2.0])
				get_tree().quit()
		"hit":
			if _time - _hit_time > 2.0:
				_report("after the hit")
				# on the floor again, facing away from the wall: it must drive
				car.place(Vector3(0, car.wheels[0].radius + 0.15, -5), -PI / 2.0)
				car.settle_shell()
				car.brake_input = 0.0
				car.throttle_input = 1.0
				_phase = "drive"
				_hit_time = _time
				if Content.arg("puncture") != "":
					TyreDamage.puncture(car, 0, 0.3)
		"drive":
			car.steer_input = clampf(car.global_position.x * 0.3 + fwd.x * 2.0, -0.2, 0.2)
			if _time - _hit_time > 4.0:
				print("drives on: %.1f km/h after 4 s, %s" % [car.speed * 3.6, "bend kept %.1f cm, the shell %s (anchors pull %.0f N in sum)" % [
					car.shell.sb.stats()["max_bend"] * 100.0, "quiet" if car.shell.sb.quiet else "moving", car.shell.sb.reaction_force.length()] if car.shell else ""])
				if TyreDamage.punctured(car):
					var fl := car.wheels[0]
					print("puncture FL: %.2f bar of %.2f, grip %.2f" % [fl.pressure - fl.pressure_loss, fl.pressure, fl.pressure_grip])
				if car.engine_damage != null:
					var h: Dictionary = car.engine_damage.health
					print("engine: %d nodes in the bay, block %.2f top %.2f pan %.2f radiator %.2f%s, coolant %.0f %%, oil %.0f %%, %.0f C, power %.0f %%, misfire %.2f, %s" % [
						car.engine_damage.nodes, h["block"], h["top"], h["pan"], h["radiator"], " (torn open)" if h["radiator_gone"] else "",
						h["coolant"] * 100.0, h["oil"] * 100.0, h["temp"], h["power"] * 100.0, h["misfire"], "running" if car.engine.running else "stalled"])
				car.repair()
				if car.engine_damage != null:
					print("engine repaired: power %.0f %%, coolant %.0f %%" % [car.engine_damage.health["power"] * 100.0, car.engine_damage.health["coolant"] * 100.0])
				print("tyres after the repair: %s" % ("leaking" if TyreDamage.punctured(car) else "whole, FL %.2f bar" % car.wheels[0].pressure))
				if car.shell:
					print("repaired: bend %.1f cm, parts off %d" % [car.shell.sb.stats()["max_bend"] * 100.0, car.parts.count_off() if car.parts else 0])
				get_tree().quit()


func _process(_delta: float) -> void:
	if car == null:
		return
	var p := car.global_transform.origin
	# the camera beside the front of the car, looking at its nose
	var view: Vector3 = car.global_transform.basis * Vector3(-2.2, 1.0, 3.4)
	cam.global_transform = Transform3D(Basis(), p + view).looking_at(p + car.global_transform.basis * Vector3(0, 0.2, 1.4))
	if _shot != "" and _hit_time >= 0.0 and _phase == "hit" and _time - _hit_time > 1.5:
		var img := get_viewport().get_texture().get_image()
		img.save_png(_shot)
		print("shot: ", _shot)
		if car.shell_mesh != null:
			var sk := car.shell_mesh.skeleton
			print("model: %s, %d meshes bend, bone 1 at %s" % ["ready" if car.shell_mesh.ready else "not ready", car.shell_mesh.meshes.size(),
				sk.get_bone_pose_position(1) if sk else "-"])
		_shot = ""


func _report(when: String) -> void:
	var line := "%s: hit at %.1f km/h, peak %.1f g, now %.1f km/h" % [when, _speed_at_hit * 3.6, _peak_g, car.speed * 3.6]
	if car.shell != null:
		var s := car.shell.sb.stats()
		var front := []
		for k in car.shell.sb.count:
			if car.shell.sb.bend_of(k) > 0.01:
				front.append("%d:%.0f" % [k, car.shell.sb.bend_of(k) * 100.0])
		line += ", bend %.1f cm (elastic %.1f), %.1f kJ taken up, %d anchors and %d beams torn, %d shell steps (at most %.2f ms, %d small steps)" % [
			s["max_bend"] * 100.0, s["max_elastic"] * 100.0, s["absorbed"] / 1000.0, s["torn_anchors"], s["torn_beams"],
			car.shell.steps, _max_step_us / 1000.0, car.shell.sb.steps_used]
		line += "\n  nodes bent more than 1 cm (node:cm): %s" % " ".join(front)
	if car.parts != null:
		var off := []
		for p in car.parts.parts:
			if p.state != "held":
				off.append("%s (%s)" % [p.name, p.state])
		line += "\n  parts: %d of %d off: %s" % [off.size(), car.parts.parts.size(), ", ".join(off)]
	print(line)
