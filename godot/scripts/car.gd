class_name Car
extends RigidBody3D
## A car of OpenRacer, from its car.json.
##
## The body is a rigid body (Godot's physics, Jolt) on four wheels that are worked out here, the way the browser
## game does it (web/js/Vehicle.js and Wheel.js): each wheel looks down its suspension with a ray, the spring and
## the damper push the body up, and the tyre makes a force along and across itself from its slip ratio and slip
## angle (Pacejka's magic formula, limited by a friction circle). The wheels spin with their own inertia, driven
## by the engine through a clutch, a gearbox and the differentials, and slowed by the brakes.
##
## Space of the body: x to the left, y up, z forward; the origin is at the height of the axles, in the middle
## between them (the origin of the model in CarLoader.js).

const G := 9.81
const AIR := 1.225
const SUBSTEPS := 8

class Wheel:
	var slot := "FL"
	var front := true
	var left := true
	var driven := false
	var hub := Vector3.ZERO         # the hub at rest, in the space of the body
	var radius := 0.33
	var width := 0.25
	var inertia := 1.6
	var spring := 30000.0           # N/m at the wheel
	var damper := 3000.0            # N s/m
	var rebound := 1.5              # the damper pulling back, as a factor of the bump
	var free_length := 0.4          # the length of the spring with no load
	var max_brake := 1500.0         # N m
	var grip := 1.0
	var roll_centre := 0.1
	# state
	var length := 0.28              # from the top of the suspension to the hub
	var contact := false
	var point := Vector3.ZERO       # the contact patch (world)
	var normal := Vector3.UP
	var surface := "road"
	var load := 0.0
	var omega := 0.0
	var spin := 0.0
	var steer := 0.0
	var slip_ratio := 0.0
	var slip_tan := 0.0
	var forward_speed := 0.0
	var fx := 0.0
	var fy := 0.0
	var s := 0.0                    # the slip in units of the peak (1: the tyre is at its limit)
	var tyre_slope := 0.0
	var abs_factor := 1.0
	var side_speed := 0.0           # m/s across the tyre
	var comp_rate := 0.0            # m/s that the spring is pushed in (for the force feedback)
	var squeal := 0.0               # how loud it squeals (0..1)
	var smoke := 0.0                # how much it smokes or throws up dust (0..1)
	var mark := 0.0                 # how dark a mark it leaves on the road (0..1)
	var surf_t := 25.0              # the surface of the tread, C
	var road_t := 25.0              # the strip of road under it, C
	var fp := Vector3.FORWARD       # the tyre on the road: forward and to the left (world)
	var lf := Vector3.LEFT
	var vref := 1.5
	var visual_offset := Vector3.ZERO
	var hub_node: Node3D
	var steer_node: Node3D
	var spin_node: Node3D

var config: Dictionary = {}
var car_id := ""
var wheels: Array[Wheel] = []
var engine := CarEngine.new()

# chassis
var wheelbase := 2.6
var front_track := 1.5
var rear_track := 1.5
var weight_front := 0.5
var cg_height := 0.5
var susp_length := 0.28
var susp_travel := 0.1
var droop := 0.15
var max_steer := deg_to_rad(30.0)
var ackermann := 0.6
var drag_area := 0.7            # Cd times the frontal area
var arb_front := 0.0            # anti-roll bars, N per m of difference in compression
var arb_rear := 0.0
var rolling := 0.015
# drivetrain
var drive := "rwd"
var diff := "open"
var diff_preload := 100.0
var diff_power := 0.3
var diff_coast := 0.1
var centre_split := 0.4
var gear_ratios: Array = [3.0, 2.0, 1.4, 1.0, 0.8]
var reverse_ratio := 3.0
var final_drive := 3.7
var efficiency := 0.92
var shift_time := 0.3
var gearbox := "gears"
var cvt_rpm := 4000.0
var clutch_capacity := 500.0
var clutch_start := 1100.0
var clutch_full := 2000.0
var shares := [0.0, 0.0, 0.0, 0.0]

# controls (set by the player, or by a test)
var steer_input := 0.0          # -1 right .. 1 left
var throttle_input := 0.0
var brake_input := 0.0
var handbrake_input := 0.0
var autopilot := false          # (the --drive test: full throttle, straight on)
var is_ghost := false           # the see-through car of the best lap (LapTimer): no physics, placed from a recording
var steer_direct := false       # a racing wheel: steer_input is the position of the wheel, as a part of the lock
var abs_on := true
var manual := false

# state
var gear := 1                   # -1 reverse, 0 neutral, 1.. forward
var shift_timer := 0.0
var since_shift := 0.0
var cvt_ratio := 3.0
var steer_angle := 0.0
var speed := 0.0                # m/s along the car
var clutch_engagement := 0.0
var reverse_hold := 0.0
var throttle := 0.0
var brake := 0.0
var model_root: Node3D


func setup(id: String, cfg: Dictionary) -> void:
	car_id = id
	config = cfg
	name = "Car"
	var ch: Dictionary = cfg.get("chassis", {})
	var dims: Dictionary = cfg.get("dimensions", {})
	var dt: Dictionary = cfg.get("drivetrain", {})
	var ty: Dictionary = cfg.get("tyres", {})
	var br: Dictionary = cfg.get("brakes", {})
	mass = float(ch.get("mass", 1200))
	wheelbase = float(ch.get("wheelbase", 2.6))
	front_track = float(ch.get("front_track", 1.5))
	rear_track = float(ch.get("rear_track", 1.5))
	weight_front = float(ch.get("weight_distribution", 0.5))
	cg_height = float(ch.get("cg_height", 0.5))
	susp_length = float(ch.get("suspension_length", 0.28))
	susp_travel = float(ch.get("suspension_travel", 0.1))
	droop = maxf(0.08, susp_travel * 1.5)
	max_steer = deg_to_rad(float(ch.get("max_steer_deg", 30)))
	ackermann = float(ch.get("ackermann", 0.6))
	var length := float(dims.get("length", 4.2))
	var width := float(dims.get("width", 1.8))
	var height := float(dims.get("height", 1.4))
	drag_area = float(ch.get("drag_coefficient", 0.35)) * width * height * 0.82
	rolling = float(ty.get("rolling_resistance", 0.015))

	drive = str(dt.get("drive", "rwd"))
	diff = str(dt.get("diff", "open"))
	if Content.arg("diff") != "":
		diff = Content.arg("diff")      # (a test: --diff=open)
	diff_preload = float(dt.get("diff_preload", 100))
	diff_power = float(dt.get("diff_power", 0.3))
	diff_coast = float(dt.get("diff_coast", 0.1))
	centre_split = float(dt.get("center_split", 0.4))
	gear_ratios = dt.get("gear_ratios", gear_ratios)
	reverse_ratio = float(dt.get("reverse_ratio", 3.0))
	final_drive = float(dt.get("final_drive", 3.7))
	efficiency = float(dt.get("efficiency", 0.92))
	shift_time = float(dt.get("shift_time", 0.3))
	gearbox = str(dt.get("gearbox", "gears"))
	cvt_rpm = float(dt.get("cvt_rpm", 4000))
	engine.setup(cfg.get("engine", {}))
	clutch_capacity = float(dt.get("clutch", 1.5)) * engine.peak_torque * engine.power_scale
	if gearbox == "torque-converter":
		clutch_start = engine.idle_rpm * 1.05
		clutch_full = maxf(clutch_start + 300.0, float(dt.get("tc_stall_rpm", 2000)))
	else:
		clutch_start = float(dt.get("clutch_start_rpm", engine.idle_rpm + 150.0))
		clutch_full = maxf(clutch_start + 200.0, float(dt.get("clutch_full_rpm", 2000)))
	if gear_ratios.is_empty():
		gear_ratios = [1.0]
	cvt_ratio = float(gear_ratios[0])

	# the wheels: front left, front right, rear left, rear right
	var diameters := _diameters(cfg)
	var static_front := mass * G * weight_front / 2.0
	var static_rear := mass * G * (1.0 - weight_front) / 2.0
	wheels.clear()
	for i in 4:
		var w := Wheel.new()
		w.slot = CarModel.SLOTS[i]
		w.front = i < 2
		w.left = i % 2 == 0
		var track := front_track if w.front else rear_track
		var z := wheelbase / 2.0 + float(ch.get("front_axle_offset", 0)) if w.front else -wheelbase / 2.0 + float(ch.get("rear_axle_offset", 0))
		w.hub = Vector3(track / 2.0 * (1.0 if w.left else -1.0), 0.0, z)
		w.radius = diameters[0 if w.front else 1] / 2.0
		w.inertia = clampf(1.6 * pow(w.radius / 0.33, 3.0), 0.12, 6.0)
		w.spring = float(ch.get("spring_front" if w.front else "spring_rear", 30000))
		var corner_mass := (static_front if w.front else static_rear) / G
		var ratio := float(ch.get("damping_front" if w.front else "damping_rear", 0.35))
		w.damper = ratio * 2.0 * sqrt(w.spring * corner_mass)
		w.rebound = float(ch.get("damping_rebound", 1.5))
		w.free_length = susp_length + (static_front if w.front else static_rear) / w.spring
		w.length = susp_length
		w.max_brake = float(br.get("front" if w.front else "rear", 1500))
		w.grip = float(ty.get("grip", 1.0)) * (1.0 if w.front else float(ty.get("grip_balance", 1.0)))
		w.roll_centre = float(ch.get("roll_center_front" if w.front else "roll_center_rear", 0.1))
		w.driven = drive == "awd" or (drive == "fwd" and w.front) or (drive == "rwd" and not w.front)
		wheels.append(w)
	for i in 4:
		if not wheels[i].driven:
			shares[i] = 0.0
		elif drive == "awd":
			shares[i] = (centre_split if wheels[i].front else 1.0 - centre_split) / 2.0
		else:
			shares[i] = 0.5

	# the anti-roll bars give the front the share of the roll stiffness that car.json asks for
	var kf := wheels[0].spring * front_track * front_track / 2.0
	var kr := wheels[2].spring * rear_track * rear_track / 2.0
	var total := (kf + kr) * 1.6
	var share := float(ch.get("roll_front", 0.5))
	arb_front = maxf(0.0, share * total - kf) * 2.0 / (front_track * front_track)
	arb_rear = maxf(0.0, (1.0 - share) * total - kr) * 2.0 / (rear_track * rear_track)

	# the rigid body
	var mean_r := (wheels[0].radius + wheels[2].radius) / 2.0
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0.0, cg_height - mean_r, wheelbase * (weight_front - 0.5))
	var k := 0.7
	inertia = Vector3(
		mass / 12.0 * (height * height + length * length) * k,
		mass / 12.0 * (length * length + width * width) * k,
		mass / 12.0 * (width * width + height * height) * k)
	can_sleep = false
	continuous_cd = true
	var mat := PhysicsMaterial.new()
	mat.friction = 0.35
	mat.bounce = 0.05
	physics_material_override = mat
	# the body for knocks against walls and other things: from a little above the road to the roof
	var bottom := -mean_r + 0.12
	var shape := BoxShape3D.new()
	shape.size = Vector3(width * 0.95, maxf(0.2, height - 0.12 - 0.05), length * 0.97)
	var col := CollisionShape3D.new()
	col.shape = shape
	col.position = Vector3(0.0, bottom + shape.size.y / 2.0, 0.0)
	add_child(col)
	_build_visual()


func _diameters(cfg: Dictionary) -> Array[float]:
	var d := float(cfg.get("chassis", {}).get("tire_diameter", 0.65))
	var out: Array[float] = [d, d]
	var lib: Dictionary = cfg.get("wheels", {}).get("library", {})
	for i in 2:
		var axle: Dictionary = lib.get("front" if i == 0 else "rear", {})
		var custom: Dictionary = axle.get("custom", {})
		if axle.get("tyre", "") == "custom" and custom.has("diameter"):
			out[i] = float(custom["diameter"])
	return out


func _build_visual() -> void:
	var m: Dictionary = config.get("model", {})
	var wcfg: Dictionary = config.get("wheels", {})
	var nodes: Dictionary = wcfg.get("nodes", {})
	var pivot := Node3D.new()
	pivot.name = "Model"
	add_child(pivot)
	model_root = pivot
	var off: Array = m.get("offset", [0, 0, 0])
	pivot.position = Vector3(float(off[0]), float(off[1]), float(off[2]))
	pivot.rotation.y = deg_to_rad(float(m.get("rotation_y", 0)))
	pivot.scale = Vector3.ONE * float(m.get("scale", 1))
	var body: Node3D = null
	if m.get("type", "gltf") == "gltf" and m.has("file"):
		body = Content.load_model(str(m["file"]))
	if body != null:
		pivot.add_child(body)
	else:
		var box := MeshInstance3D.new()
		var bm := BoxMesh.new()
		var dims: Dictionary = config.get("dimensions", {})
		bm.size = Vector3(float(dims.get("width", 1.8)), float(dims.get("height", 1.4)) * 0.6, float(dims.get("length", 4.2)))
		box.mesh = bm
		box.position.y = bm.size.y / 2.0
		pivot.add_child(box)

	var model_wheels: bool = wcfg.get("mode", "default") == "model" and body != null
	var lib: Dictionary = wcfg.get("library", {})
	for i in 4:
		var w := wheels[i]
		w.hub_node = Node3D.new()
		w.hub_node.name = "Wheel" + w.slot
		w.steer_node = Node3D.new()
		w.spin_node = Node3D.new()
		add_child(w.hub_node)
		w.hub_node.add_child(w.steer_node)
		w.steer_node.add_child(w.spin_node)
		w.hub_node.position = w.hub
		var parts: Array[Node3D] = []
		if body != null:
			for n in nodes.get(w.slot, []):
				var part := body.find_child(str(n), true, false) as Node3D
				if part != null and not parts.has(part):
					parts.append(part)
		if model_wheels and not parts.is_empty():
			# the wheel parts of the model: their middle is the hub (the model knows best where its wheels are)
			var box := AABB()
			for p in parts.size():
				var b := CarModel.relative(parts[p], self) * CarModel.bounds(parts[p], parts[p])
				box = b if p == 0 else box.merge(b)
			var centre := box.get_center()
			w.visual_offset = Vector3(centre.x - w.hub.x, centre.y, centre.z - w.hub.z)
			w.hub_node.position = w.hub + w.visual_offset
			for part in parts:
				var t := CarModel.relative(part, self)
				part.get_parent().remove_child(part)
				w.spin_node.add_child(part)
				part.transform = Transform3D(Basis.IDENTITY, -w.hub_node.position) * t
			continue
		for part in parts:
			part.get_parent().remove_child(part)
			part.queue_free()
		_library_wheel(w, lib.get("front" if w.front else "rear", {}))


func _library_wheel(w: Wheel, axle: Dictionary) -> void:
	var custom: Dictionary = axle.get("custom", {})
	var dia := w.radius * 2.0
	var width := float(custom.get("width", 0.24))
	var inner := float(custom.get("inner_ratio", 0.68))
	var tyre := MeshInstance3D.new()
	tyre.mesh = CarModel.tyre_mesh(w.radius, w.radius * inner, width)
	w.spin_node.add_child(tyre)
	var rim := CarModel.library_rim(str(axle.get("rim", "")), dia * inner * 1.02, width)
	if not w.left:
		rim.rotation.y = PI
	w.spin_node.add_child(rim)
	w.width = width


## Puts the car at a place on the road, standing still, facing the heading of the browser game (the angle from
## +x towards +z of the direction it faces).
func place(pos: Vector3, heading: float) -> void:
	var yaw := PI / 2.0 - heading
	var xf := Transform3D(Basis(Vector3.UP, yaw), pos)
	PhysicsServer3D.body_set_state(get_rid(), PhysicsServer3D.BODY_STATE_TRANSFORM, xf)
	PhysicsServer3D.body_set_state(get_rid(), PhysicsServer3D.BODY_STATE_LINEAR_VELOCITY, Vector3.ZERO)
	PhysicsServer3D.body_set_state(get_rid(), PhysicsServer3D.BODY_STATE_ANGULAR_VELOCITY, Vector3.ZERO)
	global_transform = xf
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	reset_physics_interpolation()
	for w in wheels:
		w.omega = 0.0
		w.slip_ratio = 0.0
		w.slip_tan = 0.0
		w.length = susp_length
	engine.omega = engine.idle_rpm * PI / 30.0
	gear = 1
	shift_timer = 0.0


## The car as a ghost: it is not simulated and touches nothing; it is seen through.
func make_ghost() -> void:
	is_ghost = true
	name = "Ghost"
	freeze = true
	collision_layer = 0
	collision_mask = 0
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	set_physics_process(false)
	for m in find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		mi.transparency = 0.6
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func heading() -> float:
	var f := global_transform.basis.z
	return atan2(f.z, f.x)


func _physics_process(dt: float) -> void:
	if autopilot:
		throttle_input = 1.0
		brake_input = 0.0
		steer_input = float(Content.arg("steer")) if Content.arg("steer") != "" else 0.0
	_controls(dt)


func _controls(dt: float) -> void:
	# reverse: hold the brake at a standstill to put it in reverse; then the brake drives and the throttle brakes
	var t := throttle_input
	var b := brake_input
	if gear < 0:
		t = brake_input
		b = throttle_input
	if not manual and Settings.get_value("auto_reverse"):
		if gear >= 0 and absf(speed) < 0.6 and brake_input > 0.5 and throttle_input < 0.1:
			reverse_hold += dt
			if reverse_hold > 0.35:
				gear = -1
				reverse_hold = 0.0
		elif gear < 0 and absf(speed) < 0.6 and throttle_input > 0.3 and brake_input < 0.1:
			gear = 1
		else:
			reverse_hold = 0.0
	throttle = t
	brake = b
	abs_on = bool(Settings.get_value("abs"))
	if steer_direct:
		# a racing wheel turns the wheels as far as it is turned
		steer_angle = clampf(steer_input, -1.0, 1.0) * max_steer
		return
	# the keys and the stick: slower and less far at speed (a key gives full lock at once)
	var at_speed := float(Settings.get_value("key_steer_at_speed"))
	var limit := max_steer / (1.0 + at_speed * absf(speed) / 22.0)
	var target := clampf(steer_input, -1.0, 1.0) * limit
	var rate := (2.2 if absf(target) > absf(steer_angle) else 4.0) * float(Settings.get_value("key_steer_speed"))
	steer_angle = move_toward(steer_angle, target, rate * dt)


func shift(up: bool) -> void:
	manual = true
	var top := gear_ratios.size()
	var next := clampi(gear + (1 if up else -1), -1, top)
	if next != gear:
		gear = next
		shift_timer = shift_time
		since_shift = 0.0


func _gear_total() -> float:
	if gear == 0:
		return 0.0
	if gear < 0:
		return -reverse_ratio * final_drive
	if gearbox == "cvt":
		return cvt_ratio * final_drive
	return float(gear_ratios[clampi(gear - 1, 0, gear_ratios.size() - 1)]) * final_drive


func _auto_shift(dt: float) -> void:
	since_shift += dt
	if manual or gear <= 0 or gearbox == "cvt" or shift_timer > 0.0 or since_shift < 0.7:
		return
	# the engine speed that the road speed asks for in this gear: spinning wheels must not cause a shift
	var radius := (wheels[0].radius + wheels[2].radius) / 2.0
	var rpm := maxf(0.0, speed) / radius * absf(_gear_total()) * 30.0 / PI
	var top := gear_ratios.size()
	var wheel_omega := maxf(0.0, speed) / radius
	if gear < top and rpm > (engine.power_rpm if throttle > 0.8 else engine.power_rpm * 0.75) and throttle > 0.3:
		gear += 1
		shift_timer = shift_time
		since_shift = 0.0
	elif gear > 1:
		var lower := float(gear_ratios[gear - 2]) * final_drive * wheel_omega * 30.0 / PI
		# down only when the lower gear has room: well under the limiter (kick-down with the throttle open)
		var room := 0.72 if throttle > 0.6 else 0.5
		if rpm < engine.limiter_rpm * 0.5 and lower < engine.limiter_rpm * room:
			gear -= 1
			shift_timer = shift_time * 0.7
			since_shift = 0.0


func _driven_omega() -> float:
	var sum := 0.0
	for i in 4:
		sum += shares[i] * wheels[i].omega
	return sum


func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	if is_ghost:
		return
	var dt := state.step
	var xf := state.transform
	var basis := xf.basis
	var up := basis.y
	var origin := xf.origin
	var com := state.center_of_mass
	var v := state.linear_velocity
	var av := state.angular_velocity
	var space := state.get_space_state()
	speed = v.dot(basis.z)
	if shift_timer > 0.0:
		shift_timer = maxf(0.0, shift_timer - dt)
	_auto_shift(dt)

	# ---- the steering of the front wheels, with Ackermann (the inner wheel turns further)
	var angles := [steer_angle, steer_angle, 0.0, 0.0]
	if absf(steer_angle) > 1e-4 and ackermann > 0.0:
		var r := wheelbase / tan(absf(steer_angle))
		var inner := atan(wheelbase / maxf(0.1, r - front_track / 2.0))
		var outer := atan(wheelbase / (r + front_track / 2.0))
		var a_in := lerpf(absf(steer_angle), inner, ackermann) * signf(steer_angle)
		var a_out := lerpf(absf(steer_angle), outer, ackermann) * signf(steer_angle)
		# turning left (+): the left wheel is the inner one
		angles[0] = a_in if steer_angle > 0.0 else a_out
		angles[1] = a_out if steer_angle > 0.0 else a_in

	# ---- the suspension: each wheel looks down for the road
	var max_len := susp_length + droop
	var exclude := [get_rid()]
	var comp_rate := [0.0, 0.0, 0.0, 0.0]
	for i in 4:
		var w := wheels[i]
		w.steer = angles[i]
		var top := xf * (w.hub + Vector3.UP * susp_length)
		var reach := max_len + w.radius
		var q := PhysicsRayQueryParameters3D.create(top, top - up * reach, 1, exclude)
		var hit := space.intersect_ray(q)
		if hit.is_empty():
			w.contact = false
			w.length = max_len
			continue
		w.contact = true
		w.point = hit["position"]
		w.normal = hit["normal"]
		w.surface = "road"
		var col: Object = hit.get("collider")
		if col != null and col.has_meta("surface"):
			w.surface = str(col.get_meta("surface"))
		w.length = clampf(top.distance_to(w.point) - w.radius, 0.0, max_len)
		var hub_world := top - up * w.length
		var pv := v + av.cross(hub_world - origin - com)
		comp_rate[i] = -pv.dot(up)          # + while the spring is pushed in
		w.comp_rate = comp_rate[i]

	# ---- spring, damper, bump stop and anti-roll bars: the load on each tyre
	var loads := [0.0, 0.0, 0.0, 0.0]
	for i in 4:
		var w := wheels[i]
		if not w.contact:
			continue
		var f := w.spring * (w.free_length - w.length)
		var rate: float = comp_rate[i]
		f += w.damper * rate * (1.0 if rate > 0.0 else w.rebound)
		var bump := susp_length - susp_travel - w.length
		if bump > 0.0:
			f += bump * w.spring * 12.0 + maxf(0.0, rate) * w.damper * 2.0
		loads[i] = f
	for axle in 2:
		var il := axle * 2
		var ir := il + 1
		var k := arb_front if axle == 0 else arb_rear
		var cl := susp_length - wheels[il].length
		var cr := susp_length - wheels[ir].length
		var fa := k * (cl - cr)
		if wheels[il].contact:
			loads[il] += fa
		if wheels[ir].contact:
			loads[ir] -= fa

	# ---- the tyres: the frame of each on the road, its speed, and the slip across it
	for i in 4:
		var w := wheels[i]
		w.load = maxf(0.0, loads[i])
		w.fx = 0.0
		w.fy = 0.0
		if not w.contact:
			w.s = 0.0
			w.tyre_slope = 0.0
			continue
		var hub_world := xf * (w.hub + Vector3.UP * (susp_length - w.length))
		state.apply_force(up * w.load, hub_world - origin)
		# forward along the wheel on the road, and to the left of it
		var n := w.normal
		var dir := basis * Vector3(sin(w.steer), 0.0, cos(w.steer))
		w.fp = (dir - n * dir.dot(n)).normalized()
		w.lf = n.cross(w.fp)
		var cv := v + av.cross(w.point - origin - com)
		w.forward_speed = cv.dot(w.fp)
		w.vref = maxf(absf(w.forward_speed), 1.5)
		# the slip across builds up over the relaxation length of the tyre (0.35 m)
		w.side_speed = cv.dot(w.lf)
		var tan_a := clampf(w.side_speed / w.vref, -12.0, 12.0)
		w.slip_tan += (tan_a - w.slip_tan) * (1.0 - exp(-dt * w.vref / 0.35))

	# ---- the wheels and the drivetrain, in substeps: the tyre is stiff against the wheel speed, so the wheel
	# speed, the clutch and the engine are stepped SUBSTEPS times with the road speed of this step, and the body
	# gets the mean force of the tyres
	var h := dt / SUBSTEPS
	var sum_fx := [0.0, 0.0, 0.0, 0.0]
	var sum_fy := [0.0, 0.0, 0.0, 0.0]
	var tyre_torque := [0.0, 0.0, 0.0, 0.0]
	for _n in SUBSTEPS:
		for i in 4:
			var w := wheels[i]
			if not w.contact:
				tyre_torque[i] = 0.0
				continue
			w.slip_ratio = clampf((w.omega * w.radius - w.forward_speed) / w.vref, -12.0, 12.0)
			var surf := Content.surface(w.surface)
			_tyre_force(w, w.load, surf, w.vref)
			sum_fx[i] += w.fx
			sum_fy[i] += w.fy
			var rr := rolling * float(surf.get("drag", 1.0)) * w.load * w.radius
			tyre_torque[i] = -w.fx * w.radius - rr * tanh(w.omega / 1.0)
		_drivetrain(h, tyre_torque)
	for i in 4:
		var w := wheels[i]
		if not w.contact:
			continue
		w.fx = sum_fx[i] / SUBSTEPS
		w.fy = sum_fy[i] / SUBSTEPS
		# the side force acts at the roll centre (the geometric load transfer of the browser game)
		var at := w.point + up * w.roll_centre
		state.apply_force(w.fp * w.fx + w.lf * w.fy, at - origin)
	for w in wheels:
		_tyre_effects(w, dt)

	# ---- the air
	var vv := v.length()
	if vv > 0.1:
		state.apply_central_force(-v * vv * 0.5 * AIR * drag_area)


## Squeal, smoke and marks (web/js/Vehicle.js): the power that the slip burns heats the surface of the tread; from
## about 220 C it smokes. A tyre that spins throws a thick cloud, one that is locked or slides sideways smokes
## thinner and leaves more of a mark. On loose ground it throws up dust instead.
func _tyre_effects(w: Wheel, dt: float) -> void:
	const AMBIENT := 25.0
	if not w.contact or w.load < 200.0:
		w.squeal = 0.0
		w.smoke = maxf(0.0, w.smoke - dt * 2.0)
		w.mark = 0.0
		w.surf_t = maxf(AMBIENT, w.surf_t - (w.surf_t - AMBIENT) * dt / 6.0)
		return
	var spin := w.omega * w.radius - w.forward_speed
	var slide_speed := sqrt(spin * spin + w.side_speed * w.side_speed)
	var burnt := absf(w.fx * spin) + absf(w.fy * w.side_speed)
	var strip := absf(w.forward_speed) / 0.15 + 0.15
	w.road_t = clampf(w.road_t + ((0.7 * burnt / 2500.0) - (w.road_t - AMBIENT) * strip) * dt, AMBIENT, 300.0)
	var spin_hot := smoothstep(4.0, 14.0, spin) * (1.0 - smoothstep(1.0, 3.0, absf(w.forward_speed)))
	var share := 0.3 + 0.3 * minf(1.0, (w.road_t - AMBIENT) / 150.0) + 0.3 * spin_hot
	w.surf_t = clampf(w.surf_t + (share * burnt / 350.0 - (w.surf_t - AMBIENT) / 6.0) * dt, AMBIENT, 330.0)
	var surf := Content.surface(w.surface)
	var sliding := smoothstep(1.2, 2.2, w.s) * smoothstep(1.5, 6.0, slide_speed)
	if surf.get("loose", false):
		var rolling_dust := minf(0.28, maxf(0.0, (absf(w.forward_speed) - 5.0) / 40.0))
		w.smoke = maxf(minf(1.0, 0.15 + 0.85 * sliding) * sliding, rolling_dust)
		w.squeal = 0.0
		w.mark = sliding * 0.6
		return
	var spin_share := clampf(maxf(0.0, spin) / maxf(2.0, slide_speed), 0.0, 1.0)
	var smoking := 0.12 * smoothstep(180.0, 220.0, w.surf_t) + 0.88 * smoothstep(220.0, 260.0, w.surf_t)
	w.smoke = smoking * (0.4 + 0.6 * minf(1.0, burnt / 40000.0)) * (0.3 + 0.7 * spin_share)
	w.squeal = smoothstep(1.0, 2.0, w.s) * (1.0 - 0.4 * smoothstep(2.5, 4.0, w.s)) * smoothstep(0.8, 5.0, slide_speed)
	w.mark = smoothstep(1.1, 2.0, w.s) * smoothstep(1.0, 4.0, slide_speed)


## The magic formula of Wheel.js (tyreForce): the slip along and across in units of the slip at the peak gives
## how far the tyre is towards its limit; the curve gives the share of the peak force, which is the friction
## times the load, in the direction of the slip.
func _tyre_force(w: Wheel, load: float, surf: Dictionary, vref: float) -> void:
	var grip := float(surf["static"]) * w.grip
	var mu := clampf(grip - 0.00007 * (load * 0.1 - 3500.0), 0.2 * grip, 1.4 * grip)
	var spin_slide := w.omega * w.radius - w.forward_speed
	var melt := smoothstep(4.0, 14.0, spin_slide)
	var sliding_ratio := minf(0.98, float(surf["kinetic"]) / float(surf["static"])) * (1.0 - 0.45 * melt)
	var c := 2.0 - (2.0 / PI) * asin(sliding_ratio)
	var peak := tan(PI / (2.0 * c))
	var slip_peak := 0.14
	var angle_peak := 0.15 / float(config.get("tyres", {}).get("cornering", 1.0))
	var sx := w.slip_ratio / slip_peak
	var sy := w.slip_tan / angle_peak
	var s := sqrt(sx * sx + sy * sy)
	w.s = s
	var f := sin(c * atan(peak * s))
	var d := mu * load
	if s > 1e-9:
		w.fx = d * f * sx / s
		w.fy = -d * 1.05 * f * sy / s
	else:
		w.fx = 0.0
		w.fy = 0.0
	# how fast the torque of the tyre on the wheel grows with the wheel speed (N m per rad/s), for the implicit step
	# of the wheel: the secant of the curve from no slip to where the tyre is (the steepest slope near no slip),
	# so that one step can bring the wheel to the speed of the road but never past it (with the local slope, a
	# wheel past the peak jumped over the whole curve in one step and the wheels of a heavy four wheel drive rang)
	var secant := d * (f / s if s > 1e-6 else c * peak) / slip_peak
	w.tyre_slope = secant * w.radius * w.radius / vref


func _drivetrain(dt: float, tyre_torque: Array) -> void:
	# the brakes, with ABS
	var brake_torque := [0.0, 0.0, 0.0, 0.0]
	for i in 4:
		var w := wheels[i]
		if abs_on and brake > 0.05 and w.contact and w.slip_ratio < -0.1 and absf(w.forward_speed) > 2.0:
			w.abs_factor = maxf(0.2, w.abs_factor - dt * 12.0)
		else:
			w.abs_factor = minf(1.0, w.abs_factor + dt * 6.0)
		brake_torque[i] = brake * w.max_brake * w.abs_factor
		if not w.front:
			brake_torque[i] += handbrake_input * maxf(1800.0, w.max_brake)

	# the gearbox: a CVT holds the engine near its speed for power
	var wheel_omega := _driven_omega()
	if gearbox == "cvt" and gear > 0:
		var lo := float(gear_ratios[-1])
		var hi := float(gear_ratios[0])
		var want := (cvt_rpm if throttle > 0.2 else engine.idle_rpm * 1.4) * PI / 30.0
		var r := clampf(want / maxf(0.5, absf(wheel_omega) * final_drive), lo, hi)
		cvt_ratio = lerpf(cvt_ratio, r, minf(1.0, dt * 3.0))
	var gs := _gear_total()

	# the engine and the clutch, solved implicitly (web/js/Vehicle.js): stable for a clutch that is locked
	var te := engine.net_torque(throttle if shift_timer <= shift_time * 0.5 else 0.0, dt)
	var je := engine.inertia
	var td := 0.0
	var tc := 0.0
	var drive_rpm := absf(wheel_omega * gs) * 30.0 / PI
	if gs != 0.0:
		var omega_s := 0.0
		var inv_jd := 0.0
		var a_ext := 0.0
		for k in 4:
			var sh: float = shares[k]
			if sh == 0.0:
				continue
			var wk := wheels[k]
			var ext: float = tyre_torque[k] - brake_torque[k] * tanh(wk.omega / 0.5)
			# (the inertia of the wheel with the grip of the tyre, as the wheel step below takes it)
			var ik := wk.inertia + dt * wk.tyre_slope
			omega_s += gs * sh * wk.omega
			inv_jd += gs * gs * sh * sh / ik
			a_ext += gs * sh * ext / ik
		var engagement := smoothstep(clutch_start, clutch_full, maxf(engine.rpm(), drive_rpm))
		if shift_timer > 0.0:
			engagement = minf(engagement, 1.0 - shift_timer / maxf(0.01, shift_time))
		clutch_engagement = engagement
		var cap := clutch_capacity * engagement
		var k_cl := cap / 1.5
		var base := engine.omega - omega_s + dt * (te / je - a_ext)
		var den := 1.0 + dt * k_cl * (1.0 / je + inv_jd)
		tc = clampf(k_cl * base / den, -cap, cap)
		td = tc
	else:
		clutch_engagement = 0.0
	engine.omega = clampf(engine.omega + dt * (te - tc) / je, 0.0, engine.limiter_rpm * 1.08 * PI / 30.0)
	var drive_total := td * gs * efficiency
	var wheel_drive := [0.0, 0.0, 0.0, 0.0]
	for k in 4:
		wheel_drive[k] = drive_total * shares[k]
	# a limited slip differential: the faster wheel of an axle gives torque to the slower one
	if diff == "lsd":
		for axle in 2:
			var il := axle * 2
			var ir := il + 1
			if shares[il] == 0.0:
				continue
			var axle_t: float = wheel_drive[il] + wheel_drive[ir]
			var lock_max := diff_preload + (diff_power if axle_t >= 0.0 else diff_coast) * absf(axle_t) / 2.0
			var lock := clampf(60.0 * (wheels[il].omega - wheels[ir].omega), -lock_max, lock_max)
			wheel_drive[il] -= lock
			wheel_drive[ir] += lock

	# ---- the wheel speeds; the grip of the tyre is taken implicitly (it falls as the wheel speeds up)
	for j in 4:
		var wj := wheels[j]
		var i_eff := wj.inertia + dt * wj.tyre_slope
		var d_om: float = dt * tyre_torque[j] / i_eff
		var over := wj.omega - wj.forward_speed / wj.radius
		if absf(wheel_drive[j]) < 5.0 and over * d_om < 0.0 and absf(d_om) > absf(over):
			d_om = -over
		var om: float = wj.omega + d_om + dt * wheel_drive[j] / i_eff
		var bt: float = brake_torque[j]
		if bt > 0.0:
			var dw := dt * bt / wj.inertia
			if absf(om) <= dw:
				om = 0.0
			else:
				om -= dw * signf(om)
		wj.omega = om
	# a welded or locked differential: both wheels of the driven axle turn at the same speed
	if diff == "welded" or diff == "locked":
		for axle in 2:
			var a := wheels[axle * 2]
			var b := wheels[axle * 2 + 1]
			if not a.driven:
				continue
			var common := (a.inertia * a.omega + b.inertia * b.omega) / (a.inertia + b.inertia)
			a.omega = common
			b.omega = common
	for w in wheels:
		w.spin = fmod(w.spin + w.omega * dt, TAU)


func _process(_delta: float) -> void:
	for w in wheels:
		if w.hub_node == null:
			continue
		w.hub_node.position = w.hub + w.visual_offset + Vector3.UP * (susp_length - w.length)
		w.steer_node.rotation.y = w.steer
		w.spin_node.rotation.x = w.spin


func gear_name() -> String:
	if gear < 0:
		return "R"
	if gear == 0:
		return "N"
	if gearbox == "cvt":
		return "D"
	return str(gear)
