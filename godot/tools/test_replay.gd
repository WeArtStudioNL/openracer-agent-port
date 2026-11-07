extends Node
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_replay.tscn -- --ai
## [--car=openracer-muscle] [--track=kartbaan-oldenzaal] [--shot=file.png] [--free=1: the free camera, aimed at the car]) The replay (Replay.js): the AI drives
## for 12 s, the replay opens, jumps 5 s back and plays 2 s, then the game goes on; it prints where the car was and
## is, and that the car drives on from where it was left. Without --headless --shot saves a picture of the replay.

var world: World
var _time := 0.0
var _step := 0
var _left_at := Vector3.ZERO


func _ready() -> void:
	world = World.new()
	add_child(world)
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	var track_id := Content.arg("track") if Content.arg("track") != "" else "kartbaan-oldenzaal"
	world.setup(car_id, track_id, {})
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(dt: float) -> void:
	_time += dt
	var r := world.replay
	match _step:
		0:
			if _time > 12.0:
				_left_at = world.car.global_position
				world.pause()
				world._start_replay()
				print("replay: %.1f s recorded, %d cars, at the end the car is %.2f m from where the game stopped" % [r.duration(), r.cars.size(),
					world.car.global_position.distance_to(_left_at)])
				r.time = r.duration() - 5.0
				r.running = true
				_step = 1
				_time = 0.0
		1:
			if _time > 2.0 and Content.arg("free") != "" and r._free == null:
				for k in 3:
					r._next_camera()
				r._free.global_position = world.car.global_position + Vector3(6, 3, 6)
				r._free.aim = true
				r.running = false
				_time = 1.0
			elif _time > 2.0:
				if r._free != null:
					var fc := r._free
					print("free camera: current %s, %.1f m from the car, looking at it %s" % [fc.current, fc.global_position.distance_to(world.car.global_position),
						(-fc.global_transform.basis.z).dot((world.car.global_position + Vector3.UP * 0.6 - fc.global_position).normalized()) > 0.95])
				print("after 2 s of play from 5 s back: time %.2f s, the car %.1f m from where the game stopped, %s" % [r.time,
					world.car.global_position.distance_to(_left_at), "playing" if r.running else "paused"])
				if Content.arg("shot") != "":
					get_viewport().get_texture().get_image().save_png(Content.arg("shot"))
				r._exit()
				print("back in the game: the car %.2f m from where it was left, paused %s" % [world.car.global_position.distance_to(_left_at),
					get_tree().paused])
				_step = 2
				_time = 0.0
		2:
			if _time > 3.0:
				print("3 s later: %.1f km/h, %.1f m from there" % [world.car.speed * 3.6, world.car.global_position.distance_to(_left_at)])
				get_tree().quit()
