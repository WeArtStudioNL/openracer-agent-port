extends Node
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_effects.tscn -- [--car=openracer-muscle])
## The things of the track and of the tyres (RigidObjects.js, Debris.js, Marbles.js) on the desert track: the car drives
## into a stack of boxes (track.json "objects") and the boxes must fly; it spins its wheels on the sand (the debris
## must fly); its tyres are made hot and it slides on the road (marbles must fall and lie). Without --headless,
## --shot=prefix saves a picture of each (prefix-objects.png, -debris.png, -marbles.png).

var world: World
var _time := 0.0
var _phase := "wait"
var _objects: RigidObjects
var _homes: Array[Vector3] = []
var _shot := ""


func _ready() -> void:
	get_tree().create_timer(120.0).timeout.connect(get_tree().quit)
	world = World.new()
	add_child(world)
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	world.setup(car_id, "desert", {})
	world.set_physics_process(false)          # (the inputs are the test's, not the keys')
	_shot = Content.arg("shot")
	process_mode = Node.PROCESS_MODE_ALWAYS


func _place(target: Vector3, heading: float, back: float) -> void:
	var dir := Vector3(cos(heading), 0.0, sin(heading))
	var p := target - dir * back
	world.car.place(Vector3(p.x, world.track.ground_at(p.x, p.z) + world.car.wheels[0].radius + 0.2, p.z), heading)
	world.car.freeze = false
	world.camera.snap()


func _snap(name: String) -> void:
	if _shot == "" or DisplayServer.get_name() == "headless":
		return
	get_viewport().get_texture().get_image().save_png("%s-%s.png" % [_shot, name])
	print("shot: %s-%s.png" % [_shot, name])


func _physics_process(dt: float) -> void:
	_time += dt
	var car := world.car
	match _phase:
		"wait":
			if _time > 1.0:
				_objects = world.get_node_or_null("RigidObjects") as RigidObjects
				print("objects: %d, asleep %d" % [_objects.bodies.size() if _objects else 0, _objects.bodies.size() - _objects.awake() if _objects else 0])
				for b in _objects.bodies:
					_homes.append(b.global_position)
				# the stack of boxes (15 of them, 3 layers) at 285.91, 393.68
				_place(Vector3(285.91, 0.0, 393.68), 0.3, 18.0)
				_phase = "objects"
				_time = 0.0
		"objects":
			car.throttle_input = 1.0 if car.speed < 40.0 / 3.6 else 0.0
			if _time > 2.6 and _time - dt <= 2.6:
				_snap("objects")
			if _time > 4.0:
				var moved := 0
				for i in _objects.bodies.size():
					if _objects.bodies[i].global_position.distance_to(_homes[i]) > 0.2:
						moved += 1
				print("into the boxes at 40 km/h: %d objects moved, %d awake, the car at %.1f km/h" % [moved, _objects.awake(), car.speed * 3.6])
				# on the sand beside the road, the wheels spinning
				_place(Vector3(car.global_position.x + 30.0, 0.0, car.global_position.z + 30.0), 1.2, 0.0)
				_phase = "debris"
				_time = 0.0
		"debris":
			car.throttle_input = 1.0
			car.handbrake_input = 0.0
			car.steer_input = 0.5
			var fx := world.get_node_or_null("Debris") as Debris
			if _time > 2.0 and _time - dt <= 2.0:
				var surfaces := []
				for w in car.wheels:
					surfaces.append(w.surface)
				print("on %s, %.1f km/h: debris in the air %d" % [str(surfaces), car.speed * 3.6, fx.specks.count_air() if fx else -1])
				_snap("debris")
			if _time > 2.5:
				var s: Dictionary = world.track.start
				_place(Vector3(float(s["x"]), 0.0, float(s["z"])), float(s.get("heading", 0)), 0.0)
				_phase = "marbles"
				_time = 0.0
		"marbles":
			# (full throttle from a standstill: the rear wheels spin on the road)
			car.throttle_input = 1.0
			car.steer_input = 0.0
			for w in car.wheels:
				w.surf_t = 170.0
			if _time > 2.5:
				var m := world.get_node_or_null("Marbles") as Marbles
				var surfaces := []
				for w in car.wheels:
					surfaces.append(w.surface)
				print("hot tyres sliding on %s at %.1f km/h: marbles made %d" % [str(surfaces), car.speed * 3.6, m.count() if m else -1])
				_snap("marbles")
				world.to_start()
				print("back at the start: marbles %d, objects asleep at home %s" % [m.count() if m else -1, _objects.awake() == 0])
				get_tree().quit()
