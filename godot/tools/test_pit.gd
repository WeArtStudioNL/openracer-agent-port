extends Node3D
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_pit.tscn --
## --car=openracer-muscle --track=kartbaan-oldenzaal --set=tyre_wear:1)
## The pit stop (Pit.js): the car stands in pit box 1 of the track with worn tyres, a puncture and little fuel; it
## prints the plan of the stop and what the car has when it is done.

var car: Car
var pit: PitStop
var _time := 0.0
var _was_active := false


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
	print("pit test: %s in box 1 of %s, tyres 40 %% worn, FR punctured, %.0f of %.0f L" % [car_id, track_id, car.fuel, car.tank])
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
	if pit.done:
		var w := car.wheels[1]
		print("done after %.1f s: fuel %.1f L, wear %.2f, FR %.2f bar, leaking %s, frozen %s" % [_time, car.fuel, car.wheels[0].wear,
			w.pressure - w.pressure_loss, TyreDamage.punctured(car), car.freeze])
		get_tree().quit()
	elif _time > 30.0:
		print("no stop after 30 s: speed %.2f, in the box %s" % [car.speed, pit.in_box()])
		get_tree().quit()
