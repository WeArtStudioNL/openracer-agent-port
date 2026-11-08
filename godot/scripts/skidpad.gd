class_name Skidpad
extends Node
## The skidpad (web/js/main.js startSkidpad, the menu's third way to play): the car drives round the painted circle by
## itself, a little faster every second, until it lets go; the lateral acceleration it held on the circle is the
## result. Reset starts again (with the tuning as it is now), Tune opens the tuning menu, Back to the menu goes there.
## The ground can be another than asphalt (TrackLoader.js SKIDPAD_SURFACES: the pad gets that surface).

const GRIP_FILE := "grip.cfg"        # (the grip measured here, per car and setup: grip_key)

var world: Node
var car: Car
var radius := 50.0
var surface := "road"
var running := true
var best := 0.0                      # m/s² across the car, on the circle
var best_speed := 0.0
var _target := 3.0
var _turn := 0.0
var _stalled := 0.0
var _ay := 0.0
var _last_v := Vector3.ZERO
var _layer: CanvasLayer
var _overlay: Label
var _panel: PanelContainer


## The grip that a car holds as the skidpad measured it (OpenRacer.SkidpadGrip of Opponent.js), kept per car and setup
## in grip.cfg: the AI drives the bends with it (AIDriver). The key is the car and a hash of its whole configuration
## (the keys sorted), so a changed setup is a car that has not been measured yet.


static func grip_key(cfg: Dictionary, car_id: String) -> String:
	var copy := {}
	for k in cfg:
		if not (str(k) in ["name", "description", "preview", "folder", "source", "model", "tunes", "setupName", "id"]):
			copy[k] = cfg[k]
	return "%s.%s" % [car_id, JSON.stringify(copy, "", true).md5_text().substr(0, 12)]


## The g that was measured for this car and setup, or 0 when it was not.
static func measured_grip(cfg: Dictionary, car_id: String) -> float:
	var f := ConfigFile.new()
	if f.load(Settings.path(GRIP_FILE)) != OK:
		return 0.0
	var g := float(f.get_value("grip", grip_key(cfg, car_id), 0.0))
	return g if g > 0.3 and g < 4.0 else 0.0


static func keep_grip(cfg: Dictionary, car_id: String, g: float) -> void:
	var f := ConfigFile.new()
	f.load(Settings.path(GRIP_FILE))
	f.set_value("grip", grip_key(cfg, car_id), roundf(g * 1000.0) / 1000.0)
	f.save(Settings.path(GRIP_FILE))
	RunLog.event("skidpad: %.2f g kept for the AI (%s)" % [g, grip_key(cfg, car_id)])


## The pad of the skidpad gets the ground of the menu (not the field around it).
static func set_ground(tcfg: Dictionary, ground: String) -> void:
	if ground == "" or ground == "road":
		return
	var meshes: Dictionary = tcfg.get("surfaces", {}).get("meshes", {})
	for k in meshes.keys():
		if str(meshes[k]) == "road":
			meshes[k] = ground


func setup(w: Node, ground: String) -> void:
	name = "Skidpad"
	world = w
	car = w.car
	surface = ground
	radius = float(w.track.config.get("skidpad", {}).get("radius", 50.0))
	# (the car after this node: the inputs that this node sets are the ones it drives with, not the keys of World)
	car.process_physics_priority = 1


func _ready() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 6
	add_child(_layer)
	_overlay = Label.new()
	_overlay.anchor_left = 0.5
	_overlay.anchor_right = 0.5
	_overlay.offset_left = -260
	_overlay.offset_right = 260
	_overlay.offset_top = 60
	_overlay.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_overlay.add_theme_font_size_override("font_size", 18)
	_overlay.add_theme_stylebox_override("normal", MenuStyle.flat(Color(0.08, 0.09, 0.12, 0.85), Color(0, 0, 0, 0), 6, 0, 10))
	_layer.add_child(_overlay)
	RunLog.event("skidpad: circle of %d m, ground %s" % [roundi(radius), surface])


func _physics_process(dt: float) -> void:
	if car == null or car.freeze or dt <= 0.0:
		return
	var xf := car.global_transform
	var p := xf.origin
	var f := xf.basis.z
	f.y = 0.0
	f = f.normalized()
	var left := xf.basis.x
	left.y = 0.0
	left = left.normalized()
	var v := car.linear_velocity
	var accel := (v - _last_v) / dt
	_last_v = v
	_ay = lerpf(_ay, absf(accel.dot(left)), 1.0 - exp(-dt / 0.15))
	if not running:
		car.steer_direct = true
		car.throttle_input = 0.0
		car.brake_input = 1.0
		car.handbrake_input = 0.0
		return
	var flat := Vector2(p.x, p.z)
	var r := flat.length()
	var speed := maxf(0.0, car.speed)
	# the direction along the circle, the way the car goes; the steering that the circle needs and a correction to the line
	var radial := Vector3(p.x, 0, p.z) / maxf(0.01, r)
	var tangent := Vector3(-radial.z, 0, radial.x)
	if tangent.dot(f) < 0.0:
		tangent = -tangent
	var side := 1.0 if left.dot(-radial) > 0.0 else -1.0       # the middle of the pad on the left: steer left
	var heading_error := atan2(Vector3.UP.dot(f.cross(tangent)), f.dot(tangent))
	var wanted := side * (atan(car.wheelbase / radius) + 0.08 * (r - radius)) + 0.6 * heading_error
	wanted = clampf(wanted, -car.max_steer, car.max_steer)
	_turn += (wanted - _turn) * (1.0 - pow(0.7, dt * 60.0))
	car.steer_direct = true
	car.steer_input = _turn / car.max_steer
	car.handbrake_input = 0.0
	# the speed: up by a quarter of a metre per second every second; the throttle a little more than it takes
	_target += 0.25 * dt
	var error := _target - speed
	car.throttle_input = clampf(0.12 + error * 0.25, 0.0, 0.7)
	car.brake_input = minf(0.4, (-error - 1.5) * 0.2) if error < -1.5 else 0.0
	var slip := atan2(v.dot(left), v.dot(f)) if speed > 2.0 else 0.0
	var on_line := absf(r - radius) < 4.0 and absf(slip) < 0.14
	if on_line and _ay > best:
		best = _ay
		best_speed = speed
	_stalled = _stalled + dt if _target - speed > 3.0 else 0.0
	if (speed > 2.0 and (absf(r - radius) > 6.0 or absf(slip) > 0.25)) or _stalled > 3.0:
		_done()


func _process(_delta: float) -> void:
	if _overlay != null and car != null:
		_overlay.text = "Skidpad · circle of %s\n%.2f g at %s · best %.2f g" % [_circle(), _ay / 9.81, Settings.speed_text(maxf(0.0, car.speed)), best / 9.81]


func _circle() -> String:
	return "%d ft" % roundi(radius * 3.28084) if str(Settings.get_value("units")) == "imperial" else "%d m" % roundi(radius)


func _done() -> void:
	running = false
	var g := best / 9.81
	RunLog.event("skidpad: %.2f g at %.1f km/h" % [g, best_speed * 3.6])
	# (on asphalt, for the AI: it drives this car with this setup in the bends with the grip that it held here; the
	# car as it is tuned now)
	if surface == "road" and g > 0.3:
		keep_grip(car.config, car.car_id, g)
	var verdict := "a van"
	for v in [[1.1, "a racing car on slicks"], [0.95, "a sports car"], [0.85, "a good road car"], [0.75, "an ordinary road car"]]:
		if g > v[0] and verdict == "a van":
			verdict = v[1]
	_panel = PanelContainer.new()
	_panel.add_theme_stylebox_override("panel", MenuStyle.flat(Color(0.094, 0.114, 0.137, 0.95), Color(0, 0, 0, 0), 10, 0, 24))
	_panel.set_anchors_preset(Control.PRESET_CENTER)
	_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	_layer.add_child(_panel)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	_panel.add_child(box)
	var ground := ""
	for s in MainMenu.SKIDPAD_SURFACES:
		if s[0] == surface and surface != "road":
			ground = " · " + str(s[1]).to_upper()
	var head := MenuStyle.label("SKIDPAD · %s%s" % [str(car.config.get("name", car.car_id)), ground], 15, MenuStyle.MUTED)
	head.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(head)
	var big := MenuStyle.label("%.2f g" % g, 54, MenuStyle.HEAD)
	big.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(big)
	var line := MenuStyle.label("held at %s on the circle of %s · like %s" % [Settings.speed_text(best_speed), _circle(), verdict], 16, MenuStyle.HEAD)
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(line)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 8)
	var reset := MenuStyle.button("Reset", "primary", reset_run)
	row.add_child(reset)
	row.add_child(MenuStyle.button("Tune", "", func(): world.open_tuning()))
	row.add_child(MenuStyle.button("Back to the menu", "", func():
		RunLog.car = null
		world.leave.emit()))
	box.add_child(row)
	reset.grab_focus.call_deferred()


func reset_run() -> void:
	if _panel != null:
		_panel.queue_free()
		_panel = null
	best = 0.0
	best_speed = 0.0
	_stalled = 0.0
	_target = 3.0
	_turn = 0.0
	running = true
	world.to_start()
