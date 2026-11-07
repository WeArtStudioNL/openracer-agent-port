class_name CarVisuals
extends Node
## The parts of the look of a car that follow car.json and the drive, made by Car._build_visual (one node, a child of
## the car, processed after it):
## - the suspension rig (SuspensionRig: the moving parts of the model and of the parts library),
## - the materials and the paint (CarPaint: car.json "materials" and "colors"),
## - the mirrors (CarMirrors: aimed by the settings, real mirrors for the car the camera rides in).
## A new car.json (the tuning menu) paints the car again and makes a new rig when the suspension changed.

var car: Car
var body: Node3D
var rig: SuspensionRig = null
var mirrors: CarMirrors = null
var _cfg: Dictionary


func _init(c: Car, model_body: Node3D) -> void:
	name = "CarVisuals"
	car = c
	body = model_body
	process_priority = 100                 # (after the car has placed its wheels, and after the cameras)
	rig = SuspensionRig.build(c, model_body)
	if c.bike == null:
		mirrors = CarMirrors.find(c, model_body)
		if mirrors != null:
			mirrors.holder = self
	CarPaint.apply(c, c.config)
	_cfg = c.config


func _ready() -> void:
	Settings.changed.connect(_on_setting)


func _on_setting(key: String) -> void:
	if mirrors != null and key.begins_with("mirror_"):
		mirrors.aim()


func _process(delta: float) -> void:
	if not is_same(car.config, _cfg):
		_reconfigure()
	if rig != null:
		rig.update()
		rig.move_hubs()
	if mirrors != null:
		var cam := get_viewport().get_camera_3d()
		var chase := cam as ChaseCamera
		var inside := chase != null and chase.car == car and chase.mode != ChaseCamera.Mode.FOLLOW and not car.is_ghost
		mirrors.update(cam, inside, delta)


func _reconfigure() -> void:
	var old := _cfg
	var cfg := car.config
	_cfg = cfg
	var rebuilt := false
	for k in ["suspension", "driveline", "steering"]:
		if old.get(k) != cfg.get(k) and not rebuilt:
			rebuilt = true
			if rig != null:
				rig.dispose()
			rig = SuspensionRig.build(car, body)
	if rebuilt or old.get("materials") != cfg.get("materials") or old.get("colors") != cfg.get("colors"):
		CarPaint.apply(car, cfg)
