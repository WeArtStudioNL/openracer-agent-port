extends Node
## (a scene, for the autoloads: Godot --headless --path godot res://tools/test_tuning.tscn)
## Tests the tuning: read and write a path of car.json, a tune saved and loaded in the format of the browser game,
## and a car that takes a change while it is there. The test tune is removed again.


func _ready() -> void:
	get_tree().create_timer(20.0).timeout.connect(get_tree().quit)
	var content: Node = get_node("/root/Content")
	var cfg: Dictionary = content.load_json("cars/go-kart-250cc/car.json")
	print("inner_lift ", Tuning.read(cfg, "chassis.inner_lift"), "  gear 2 ", Tuning.read(cfg, "drivetrain.gear_ratios.1"),
		"  missing ", Tuning.read(cfg, "chassis.nothing"))
	var c := cfg.duplicate(true)
	Tuning.write(c, "chassis.inner_lift", 0.06)
	Tuning.write(c, "drivetrain.gear_ratios.1", 1.7)
	Tuning.write(c, "assists.esc_gain", 1.5)
	print("after write: ", Tuning.read(c, "chassis.inner_lift"), " ", Tuning.read(c, "drivetrain.gear_ratios.1"), " ", Tuning.read(c, "assists.esc_gain"),
		"  the car.json itself unchanged: ", Tuning.read(cfg, "chassis.inner_lift"))
	var path := Tuning.save_tune("go-kart-250cc", "zz test tune", c)
	var back := Tuning.load_tune(path)
	print("saved and loaded: inner_lift ", Tuning.read(back, "chassis.inner_lift"), "  listed: ", Tuning.list("go-kart-250cc", cfg).has("zz test tune"))
	var head: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(path))
	print("format: ", head.keys())
	var car := Car.new()
	car.setup("go-kart-250cc", cfg)
	add_child(car)
	print("car inner_lift before ", car.inner_lift)
	car.apply_config(back)
	print("car inner_lift after ", car.inner_lift, "  wheels still 4: ", car.wheels.size())
	# the soft body: new strengths make a new shell with the same nodes; switched off there is none
	print("shell: %s nodes, anchors yield at %.0f N" % [car.shell.sb.count if car.shell else 0, car.shell.sb.anchor_yield if car.shell else 0.0])
	var soft := back.duplicate(true)
	Tuning.write(soft, "softbody.anchor.yield_force", 20000.0)
	car.apply_config(soft)
	print("after the tuning: %s nodes, anchors yield at %.0f N" % [car.shell.sb.count if car.shell else 0, car.shell.sb.anchor_yield if car.shell else 0.0])
	soft = soft.duplicate(true)
	Tuning.write(soft, "softbody.enabled", false)
	car.apply_config(soft)
	print("switched off: shell ", car.shell)
	DirAccess.remove_absolute(path)
	print("test tune removed: ", not FileAccess.file_exists(path))
	get_tree().quit()
