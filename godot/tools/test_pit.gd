extends Node3D
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_pit.tscn --
## --car=openracer-muscle --track=kartbaan-oldenzaal --set=tyre_wear:1)
## The pit stop (Pit.js): the car stands in pit box 1 of the track with worn tyres, a puncture and little fuel; it
## prints the plan of the stop and what the car has when it is done. --bend=1 also bends the suspension of the front left
## wheel (toe) and dents the shell: they go straight bit by bit through the repair. --part=1 knocks a part off the car
## first: it fades where it lies while the car goes up and is brought back in its turn. It prints how high the car is
## on the jacks, the wheels as they are changed and how much of the part is seen. Without --headless, --shot=prefix
## saves prefix-up.png (on the jacks, a wheel coming off), -off.png (a wheel gone) and -part.png (the part on its way).

var car: Car
var pit: PitStop
var _time := 0.0
var _was_active := false
var _shot := ""
var _part: CarParts.Part = null
var _ground_y := 0.0
var _said := {}


func _ready() -> void:
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	var track_id := Content.arg("track") if Content.arg("track") != "" else "kartbaan-oldenzaal"
	var track := Track.new()
	var tcfg: Variant = Content.load_json("tracks/%s/track.json" % track_id)
	add_child(track)
	track.setup(track_id, tcfg if tcfg is Dictionary else {})
	var boxes := PitStop.boxes_of(track.config)
	if boxes.is_empty():
		print("pit test: %s has no pit boxes" % track_id)
		get_tree().quit()
		return
	car = Car.new()
	var ccfg: Variant = Content.load_json("cars/%s/car.json" % car_id)
	car.setup(car_id, ccfg if ccfg is Dictionary else {})
	add_child(car)
	await get_tree().physics_frame
	var b: Dictionary = boxes[0]
	car.place(Vector3(b["x"], track.ground_at(b["x"], b["z"]) + car.wheels[0].radius + 0.3, b["z"]), b["heading"])
	car.brake_input = 1.0
	for w in car.wheels:
		w.wear = 0.4
	car.fuel = 10.0
	TyreDamage.puncture(car, 1, 0.2)
	if Content.arg("bend") != "" and car.shell != null and car.shell.rig.rigs[0] != null:
		var sb := car.shell.sb
		sb.q[car.shell.rig.rigs[0]["nodes"]["Te"]] += Vector3(0.04, 0.0, 0.0)
		for k in mini(10, sb.body_count):
			sb.q[k] += Vector3(0.0, 0.0, -0.05)
		sb.settle()
		car.shell.rig.update(0.01)
		print("bent: FL toe %.1f deg, the shell %.1f cm" % [rad_to_deg(car.wheels[0].toe_bend), sb.q[0].length() * 100.0])
	_shot = Content.arg("shot")
	if _shot != "" and DisplayServer.get_name() != "headless":
		_scene(b)
	if Content.arg("part") != "" and car.parts != null:
		# (a part that comes off, the biggest that can: it lies beside the car before the stop begins)
		var best: CarParts.Part = null
		for p: CarParts.Part in car.parts.parts:
			if p.state == "held" and p.mode == "detachable" and p.object != null:
				if best == null or p.size.x * p.size.y * p.size.z > best.size.x * best.size.y * best.size.z:
					best = p
		if best != null and car.parts.break_loose(best):
			_part = best
			print("knocked off: %s (%s)" % [best.name, best.state])
		# (held by the handbrake meanwhile: the brake held at a standstill would put it in reverse)
		car.brake_input = 0.0
		car.handbrake_input = 1.0
		for i in 90:
			await get_tree().physics_frame
		car.handbrake_input = 0.0
		car.brake_input = 1.0
	print("pit test: %s in box 1 of %s, tyres 40 %% worn, FR punctured, %.0f of %.0f L" % [car_id, track_id, car.fuel, car.tank])
	_ground_y = car.global_position.y
	pit = PitStop.new()
	pit.setup(car, track.config, 0, true)
	car.add_child(pit)


func _physics_process(dt: float) -> void:
	if pit == null:
		return
	_time += dt
	if pit.active and not _was_active:
		print("stop: %.1f s (fuel %.1f s, tyres %.1f s on %s, repair %.1f s)" % [pit.plan["total"], pit.plan["fuel"], pit.plan["tyres"],
			str(pit.plan["change"]), pit.plan["repair"]])
	_was_active = pit.active
	if pit.active:
		_look()
	if pit.active and car.shell != null and absf(pit.elapsed - pit.plan["total"] / 2.0) < dt / 2.0:
		print("halfway: FL toe %.1f deg, the shell %.1f cm" % [rad_to_deg(car.wheels[0].toe_bend), car.shell.sb.displacement[0].length() * 100.0])
	if pit.done:
		var w := car.wheels[1]
		print("done after %.1f s: fuel %.1f L, wear %.2f, FR %.2f bar, leaking %s, frozen %s, FL toe %.1f deg, bent wheels %d" % [_time, car.fuel,
			car.wheels[0].wear, w.pressure - w.pressure_loss, TyreDamage.punctured(car), car.freeze, rad_to_deg(car.wheels[0].toe_bend),
			car.shell.rig.bent() if car.shell else 0])
		get_tree().quit()
	elif _time > 30.0:
		print("no stop after 30 s: speed %.2f, in the box %s" % [car.speed, pit.in_box()])
		get_tree().quit()


## A light, a sky and a camera beside the box (the test has no World).
func _scene(b: Dictionary) -> void:
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.9, 0.5, 0)
	sun.shadow_enabled = true
	add_child(sun)
	var we := WorldEnvironment.new()
	we.environment = Environment.new()
	we.environment.background_mode = Environment.BG_COLOR
	we.environment.background_color = Color(0.55, 0.65, 0.8)
	we.environment.ambient_light_color = Color(0.6, 0.6, 0.6)
	we.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	add_child(we)
	var along := Vector3(cos(b["heading"]), 0.0, sin(b["heading"]))
	var side := Vector3(-along.z, 0.0, along.x)
	var at := car.global_position
	var cam := Camera3D.new()
	add_child(cam)
	cam.look_at_from_position(at + side * 4.5 + along * 2.5 + Vector3(0, 1.6, 0), at + Vector3(0, 0.2, 0), Vector3.UP)
	cam.fov = 55.0
	cam.current = true


func _snap(name: String) -> void:
	if _said.has("shot " + name):
		return
	_said["shot " + name] = true
	if _shot == "" or DisplayServer.get_name() == "headless":
		return
	# (the picture of the viewport is a frame or two behind: taken after the next frames are drawn)
	for k in 3:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s-%s.png" % [_shot, name])
	print("shot: %s-%s.png" % [_shot, name])


func _say(key: String, text: String) -> void:
	if not _said.has(key):
		_said[key] = true
		print(text)


## What is seen of the stop: the height of the car, the wheels as they are changed, the part as it comes back.
func _look() -> void:
	if pit.elapsed > PitStop.LIFT + 0.1:
		_say("up", "on the jacks: %.3f m up (lift %.2f), the springs %s m" % [car.global_position.y - _ground_y, pit.lift(),
			str(car.wheels.map(func(w: Car.Wheel) -> String: return "%.3f" % w.length))])
	for i in 4:
		var ch := pit.tyre_change(i)
		if ch.is_empty():
			continue
		var w := car.wheels[i]
		# (the pictures of the front wheel on the side of the camera)
		var cam := get_viewport().get_camera_3d()
		var near := cam != null and w.front and (car.wheels[i ^ 1].hub_node.global_position.distance_to(cam.global_position)
			> w.hub_node.global_position.distance_to(cam.global_position))
		if not ch["off"] and float(ch["out"]) > 0.4:
			_say("out %d" % i, "wheel %s: out %.2f m, seen %s" % [w.slot, ch["out"], w.hub_node.visible])
			if near:
				_snap("up")
		if ch["off"]:
			_say("off %d" % i, "wheel %s: off, seen %s" % [w.slot, w.hub_node.visible])
			if near:
				_snap("off")
	if _part != null and _part.body != null and is_instance_valid(_part.body):
		var meshes := _part.body.find_children("*", "GeometryInstance3D", true, false)
		if meshes.is_empty():
			return
		var a := 1.0 - (meshes[0] as GeometryInstance3D).transparency
		var t := pit.elapsed - PitStop.LIFT
		if t < -0.5 * PitStop.LIFT:
			_say("fade", "part %s while the car goes up: seen %.2f, frozen %s" % [_part.name, a, _part.body.freeze])
		elif t > 0.0 and a > 0.3 and a < 0.8:
			_say("in", "part %s on its way: seen %.2f, %.2f m from the car" % [_part.name, a, _part.body.global_position.distance_to(car.global_position)])
			_snap("part")
