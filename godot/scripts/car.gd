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

## A bang in the exhaust (pops, anti-lag): { strength, loud, flame } (the sound and the flames take it)
signal bang(event: Dictionary)

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
	var kind: Dictionary = {}       # the kind of tyre (TyreCompounds)
	var temp := 25.0                # the core of the tyre, C
	var wear := 0.0                 # 0 new, 1 worn through
	var condition := 1.0            # the grip of the temperature, the wear and the pressure (a factor)
	var pressure_grip := 1.0
	var pressure_corner := 1.0
	var pressure_roll := 1.0
	var pressure := 2.2             # bar, as set (the tuning)
	var leak := 0.0                 # a puncture: bar a second (0: none)
	var pressure_loss := 0.0        # bar lost so far
	var stiffness_bias := 1.0       # the rear tyres are a bit stiffer against the slip angle
	var tc := false                 # the traction control holds this wheel back
	var esc := false                # the stability control brakes this wheel
	var side_speed := 0.0           # m/s across the tyre
	var comp_rate := 0.0            # m/s that the spring is pushed in (for the force feedback)
	var grip_load := 0.0            # the load the tyre grips with (with the geometric load transfer)
	var lean := 0.0                 # rad: the lean of the wheel to the left (camber, and the roll of the body)
	var offset := 0.0               # m that the wheel is pulled up (a kart: the twist of the frame, the lift of the inner rear wheel)
	var squeal := 0.0               # how loud it squeals (0..1)
	var smoke := 0.0                # how much it smokes or throws up dust (0..1)
	var mark := 0.0                 # how dark a mark it leaves on the road (0..1)
	var surf_t := 25.0              # the surface of the tread, C
	var road_t := 25.0              # the strip of road under it, C
	var fp := Vector3.FORWARD       # the tyre on the road: forward and to the left (world)
	var lf := Vector3.LEFT
	var vref := 1.5
	var visual_offset := Vector3.ZERO
	var lost := false               # a motorcycle: the second wheel of a pair is not there (no road, spring, drive, brake)
	var lat_grip := 1.0             # a share of the grip across (a motorcycle in flat-track style: the tail steps out)
	var toe_bend := 0.0             # rad to the left, a bent suspension (WheelRig)
	var camber_bend := 0.0          # rad of lean to the left, a bent knuckle
	var damage_grip := 1.0          # a bent wheel grips up to 40 % less
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
var unsprung := false           # a kart: the frame stands on its tyres
var frame_torsion := 0.0        # N m per degree of twist of a kart frame (0: rigid)
var inner_lift := 0.0           # m: how far the inner rear wheel of a kart is pulled up in a fast bend
var tyre_rate := 220000.0
var tyre_damping := 3000.0
var frame_twist := 0.0
var inner_lift_now := 0.0
var camber_front := 0.0         # degrees, negative: the top of the wheel in
var camber_rear := 0.0
var roll_camber := 0.6          # the share of the roll of the body that the wheels lean with
var toe_front := 0.0            # degrees, positive: toe-in
var toe_rear := 0.0
var ride_front := 0.0           # m: the ride height, from the car as made
var ride_rear := 0.0
var spring_progression := 0.0   # extra stiffness at the end of the travel
var anti_dive := 0.0            # the share of the pitch of the brake and drive forces that the linkage takes
var anti_squat := 0.0
var anti_lift_front := 0.0
var anti_lift_rear := 0.0
var tank := 60.0                # litres
var fuel := 60.0
var fuel_use := 1.0
var fuel_flow := 0.0            # litres a second
var base_mass := 1200.0
var downforce_front := 0.0      # N per (m/s)^2 at each axle
var downforce_rear := 0.0
var cornering := 1.0
var understeer_gradient := 0.0008
# assists (car.json extras: fitted; the settings: switched on)
var launch_control_fitted := true
var two_step_fitted := true
var two_step_input := false      # the two-step key is held
var transbrake_input := false    # the transbrake key is held
var lc_armed := false            # the launch control holds the engine now
var transbrake_held := false
var two_step_active := false
var launch_release := 0.0        # s left of the take-up of the clutch after a launch
var launching := 0.0             # s left of a launch, with the traction control on
var tc_fitted := true
var esc_fitted := true
var tc_allowance := 1.0
var esc_gain := 1.0
var tc_factor := 1.0
var esc_level := 0.0
var yaw_wanted := 0.0
# the torque converter
var tc_stall_rpm := 2000.0
var tc_ratio := 2.0
var tc_lockup := true
var tc_lock := 0.0
var tc_slip := 0.0
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
var shell: CarShell = null      # the shell that dents (damage on, Settings), or null
var shell_mesh: SoftBodyMesh = null
var parts: CarParts = null      # the parts that come off (damage on)
var engine_damage: EngineDamage = null   # what a crash does to the engine (damage on, not for the AI)
var engine_damage_on := true    # (the AI cars have none: they have no pit stop to mend it)
var tyre_damage := false        # car.json tyres.damage: a hard hit can puncture a tyre (with damage on)
var bike: Motorcycle = null     # a motorcycle ("type": "motorcycle"): its rider (motorcycle.gd)
var bike_model: MotorcycleModel = null
var _box: CollisionShape3D
var _box_full := Vector3.ZERO   # the size of the box of the body (x, z) and its place along the car, without a shell
var _box_shell := Vector3.ZERO  # and inside what the nodes can be crushed to
var _esc_brake := [0.0, 0.0, 0.0, 0.0]
var _esc_cut := 0.0
var _axle_fy := [0.0, 0.0]      # the side force of each axle in the last step (the geometric load transfer)
var _pitch_links := 0.0         # the pitch moment that the linkage took in the last step
var _fuel_mass_in := 0.0
var _auto_time := 0.0
var _limiter_time := 0.0
var _no_downshift := 0.0


func setup(id: String, cfg: Dictionary) -> void:
	car_id = id
	config = cfg
	name = "Car"
	_read_config()
	# the body for knocks against walls and other things: from a little above the road to the roof
	var dims: Dictionary = cfg.get("dimensions", {})
	var width := float(dims.get("width", 1.8))
	var height := float(dims.get("height", 1.4))
	var length := float(dims.get("length", 4.2))
	var mean_r := (wheels[0].radius + wheels[2].radius) / 2.0
	var bottom := -mean_r + 0.12
	var shape := BoxShape3D.new()
	shape.size = Vector3(width * 0.95, maxf(0.2, height - 0.12 - 0.05), length * 0.97)
	var col := CollisionShape3D.new()
	col.shape = shape
	col.position = Vector3(0.0, bottom + shape.size.y / 2.0, 0.0)
	add_child(col)
	_box = col
	_build_visual()
	_make_shell()
	if Settings.get_value("damage") and not config.get("parts", []).is_empty():
		parts = CarParts.new(self)


## The shell that dents (SoftBody, CarShell), with damage on (Settings) and unless car.json says
## "softbody": {"enabled": false}. With a shell the walls and the other cars meet its nodes first: the box of the body
## is made smaller across and along by what a node can be crushed (it stays for the road under the car, a car on
## its roof and as a backstop); without a shell the car is a rigid body, as before.
func _make_shell() -> void:
	if shell != null:
		shell.dispose()
		shell = null
	var cfg: Dictionary = config.get("softbody", {})
	if Settings.get_value("damage") and cfg.get("enabled", true) != false:
		shell = CarShell.new(self)
		if shell.sb == null:
			shell.dispose()
			shell = null
	var dims: Dictionary = config.get("dimensions", {})
	var box := _box.shape as BoxShape3D
	box.size.x = float(dims.get("width", 1.8)) * 0.95
	box.size.z = float(dims.get("length", 4.2)) * 0.97
	_box.position.z = 0.0
	if shell != null:
		# (the box inside what the nodes can be crushed to: max_bend and the springing on top of it)
		var lo := Vector3(INF, 0.0, INF)
		var hi := Vector3(-INF, 0.0, -INF)
		for k in shell.sb.count:
			var p := shell.sb.rest[k]
			var r: float = shell.sb.radius[k]
			lo = Vector3(minf(lo.x, p.x - r), 0.0, minf(lo.z, p.z - r))
			hi = Vector3(maxf(hi.x, p.x + r), 0.0, maxf(hi.z, p.z + r))
		var inset := shell.sb.anchor_max_bend + 0.15
		var x0 := maxf(lo.x + inset, -box.size.x / 2.0 + inset)
		var x1 := minf(hi.x - inset, box.size.x / 2.0 - inset)
		var z0 := maxf(lo.z + inset, -box.size.z / 2.0 + inset)
		var z1 := minf(hi.z - inset, box.size.z / 2.0 - inset)
		box.size.x = maxf(0.4, x1 - x0)
		box.size.z = maxf(0.6, z1 - z0)
		_box.position.z = (z0 + z1) / 2.0
	_box_shell = Vector3(box.size.x, _box.position.z, box.size.z)
	_box_full = Vector3(float(dims.get("width", 1.8)) * 0.95, 0.0, float(dims.get("length", 4.2)) * 0.97)
	if shell != null:
		RunLog.event("soft body %s: %d nodes, %d beams, a small step of %.2f ms is stable" % [car_id, shell.sb.count, shell.sb.beam_count,
			shell.sb.safe_h * 1000.0])


## Makes the car whole again: the shell, its model and the parts (the browser game does it when the car is put back
## at the start).
func repair() -> void:
	if shell != null:
		shell.repair()
	if parts != null:
		parts.repair()
	if engine_damage != null:
		engine_damage.repair()
	TyreDamage.repair(self)
	if bike != null:
		bike.recover()


## The car was moved (put back on its wheels): the shell stops moving and keeps its dents.
func settle_shell() -> void:
	if shell != null:
		shell.sb.settle()


func _exit_tree() -> void:
	if parts != null:
		parts.dispose()
	if shell_mesh != null:
		shell_mesh.dispose()
	if shell != null:
		shell.dispose()


## A new configuration while the car drives (the tuning menu): the physics take it at once; the model stays.
func apply_config(cfg: Dictionary) -> void:
	var shell_before: Variant = config.get("softbody", {})
	config = cfg
	var rpm_omega := engine.omega
	_read_config()
	engine.omega = rpm_omega
	if cfg.get("softbody", {}) != shell_before:
		# (new strengths of the shell: a new shell, whole, and the parts back; the model keeps its weights when the nodes
		# are the same, else it is made again for the new nodes)
		if parts != null:
			parts.repair()
		_make_shell()
		if shell_mesh != null:
			if shell != null and shell.sb.count == shell_mesh.sb.count:
				shell_mesh.use(shell.sb)
			else:
				shell_mesh.restore()
				shell_mesh = null
		if parts != null:
			parts = CarParts.new(self)


## Everything the physics take from car.json (setup, and the tuning menu). The wheels are made the first time and
## kept after that (their place in the scene and their state stay).
func _read_config() -> void:
	var cfg := config
	var ch: Dictionary = cfg.get("chassis", {})
	var dims: Dictionary = cfg.get("dimensions", {})
	var dt: Dictionary = cfg.get("drivetrain", {})
	var ty: Dictionary = cfg.get("tyres", {})
	tyre_damage = bool(ty.get("damage", false))
	var br: Dictionary = cfg.get("brakes", {})
	mass = float(ch.get("mass", 1200)) + Motorcycle.rider_mass_of(cfg)
	if str(cfg.get("type", "car")) == "motorcycle":
		if bike == null:
			bike = Motorcycle.new(cfg.get("motorcycle", {}))
		else:
			bike.retune(cfg.get("motorcycle", {}))
	else:
		bike = null
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
	cornering = float(ty.get("cornering", 1.0))
	downforce_front = float(ch.get("downforce_front", float(ch.get("downforce", 0)) * weight_front))
	downforce_rear = float(ch.get("downforce_rear", float(ch.get("downforce", 0)) * (1.0 - weight_front)))
	var extras: Dictionary = cfg.get("extras", {})
	var assists: Dictionary = cfg.get("assists", {})
	tc_fitted = extras.get("tc_on", true) != false
	launch_control_fitted = extras.get("launch_control_on", true) != false
	two_step_fitted = extras.get("two_step_on", true) != false
	esc_fitted = extras.get("esc_on", true) != false
	tc_allowance = float(assists.get("tc_allowance", 1.0))
	esc_gain = float(assists.get("esc_gain", 1.0))
	tc_stall_rpm = float(dt.get("tc_stall_rpm", 2000))
	tc_ratio = float(dt.get("tc_ratio", 2.0))
	tc_lockup = dt.get("tc_lockup", true) != false
	# a kart: no suspension, the frame stands on its tyres (the tyre is the spring), and the frame twists
	unsprung = bool(ch.get("unsprung", false))
	frame_torsion = maxf(0.0, float(ch.get("frame_torsion", 0)))
	inner_lift = maxf(0.0, float(ch.get("inner_lift", 0)))
	var light := mass / 1230.0 if mass < 600.0 else 1.0
	tyre_rate = float(ch.get("tyre_rate", 220000.0 * sqrt(light)))
	tyre_damping = float(ch.get("tyre_damping", 3000.0 * sqrt(light)))

	drive = str(dt.get("drive", "rwd"))
	diff = str(dt.get("diff", "open")) if bike == null else "open"
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
	engine.set_extras(cfg.get("extras", {}))
	camber_front = float(ch.get("camber_front", 0))
	camber_rear = float(ch.get("camber_rear", 0))
	roll_camber = float(ch.get("roll_camber", 0.6))
	toe_front = float(ch.get("toe_front", 0))
	toe_rear = float(ch.get("toe_rear", 0))
	ride_front = float(ch.get("ride_front", 0))
	ride_rear = float(ch.get("ride_rear", 0))
	spring_progression = maxf(0.0, float(ch.get("spring_progression", 0)))
	anti_dive = clampf(float(ch.get("anti_dive", 0)), 0.0, 1.5)
	anti_squat = clampf(float(ch.get("anti_squat", 0)), 0.0, 1.5)
	anti_lift_front = clampf(float(ch.get("anti_lift_front", 0)), 0.0, 1.5)
	anti_lift_rear = clampf(float(ch.get("anti_lift_rear", 0)), 0.0, 1.5)
	var fuel_cfg: Dictionary = cfg.get("fuel", {})
	var new_tank := float(fuel_cfg.get("tank", 60))
	if wheels.size() != 4 or new_tank != tank:
		fuel = new_tank
	tank = new_tank
	fuel_use = float(fuel_cfg.get("use", 1))
	base_mass = mass
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
	var fresh := wheels.size() != 4
	for i in 4:
		var w: Wheel = Wheel.new() if fresh else wheels[i]
		w.slot = CarModel.SLOTS[i]
		w.front = i < 2
		w.left = i % 2 == 0
		var track := front_track if w.front else rear_track
		var z := wheelbase / 2.0 + float(ch.get("front_axle_offset", 0)) if w.front else -wheelbase / 2.0 + float(ch.get("rear_axle_offset", 0))
		w.hub = Vector3(track / 2.0 * (1.0 if w.left else -1.0), 0.0, z)
		w.radius = diameters[0 if w.front else 1] / 2.0
		w.inertia = clampf(1.6 * pow(w.radius / 0.33, 3.0), 0.12, 6.0)
		var pressure := float(ty.get("pressure_front" if w.front else "pressure_rear", 2.2))
		w.spring = float(ch.get("spring_front" if w.front else "spring_rear", 30000))
		var corner_mass := (static_front if w.front else static_rear) / G
		var ratio := float(ch.get("damping_front" if w.front else "damping_rear", 0.35))
		w.damper = ratio * 2.0 * sqrt(w.spring * corner_mass)
		if unsprung:
			# (the tyre is the spring: its rate with the pressure, and its own little damping)
			w.spring = tyre_rate * pow(maxf(0.15, pressure) / 2.2, 0.8)
			w.damper = tyre_damping
		w.lost = bike != null and not w.left
		if bike != null:
			# (the one wheel of an end carries it all, on the spring and the damper of both)
			w.spring *= 2.0
			w.damper *= 2.0
			if w.front:
				w.inertia = maxf(w.inertia, 1.2)
		w.rebound = float(ch.get("damping_rebound", 1.5))
		# (the ride height: the wheel sits further out at rest, the body higher)
		w.free_length = susp_length + (ride_front if w.front else ride_rear) + (static_front if w.front else static_rear) / w.spring
		if fresh:
			w.length = susp_length
		w.max_brake = float(br.get("front" if w.front else "rear", 1500))
		w.grip = float(ty.get("grip", 1.0)) * (1.0 if w.front else float(ty.get("grip_balance", 1.0)))
		w.roll_centre = float(ch.get("roll_center_front" if w.front else "roll_center_rear", 0.1))
		w.driven = drive == "awd" or (drive == "fwd" and w.front) or (drive == "rwd" and not w.front)
		w.kind = TyreCompounds.of_axle(cfg, w.front)
		w.stiffness_bias = 1.0 if w.front else 1.08
		if fresh:
			w.temp = float(w.kind.get("optimum", 85))
		w.pressure = pressure
		set_pressure(w, maxf(0.15, pressure - w.pressure_loss))
		if fresh:
			wheels.append(w)
	for i in 4:
		if not wheels[i].driven:
			shares[i] = 0.0
		elif drive == "awd":
			shares[i] = (centre_split if wheels[i].front else 1.0 - centre_split) / 2.0
		else:
			shares[i] = 0.5
		if bike != null:
			shares[i] = 0.0 if wheels[i].lost else shares[i] * 2.0

	# the anti-roll bars give the front the share of the roll stiffness that car.json asks for
	var kf := wheels[0].spring * front_track * front_track / 2.0
	var kr := wheels[2].spring * rear_track * rear_track / 2.0
	var total := (kf + kr) * 1.6
	var share := float(ch.get("roll_front", 0.5))
	arb_front = maxf(0.0, share * total - kf) * 2.0 / (front_track * front_track)
	arb_rear = maxf(0.0, (1.0 - share) * total - kr) * 2.0 / (rear_track * rear_track)

	# the rigid body
	var mean_r := (wheels[0].radius + wheels[2].radius) / 2.0
	if unsprung or bike != null:
		arb_front = 0.0
		arb_rear = 0.0
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0.0, cg_height - mean_r, wheelbase * (weight_front - 0.5))
	var k := 0.7 if bike == null else 1.0      # (a motorcycle: the box of Vehicle.js)
	inertia = Vector3(
		mass / 12.0 * (height * height + length * length) * k,
		mass / 12.0 * (length * length + width * width) * k,
		mass / 12.0 * (width * width + height * height) * k)
	can_sleep = false
	# no damping of Godot's own (0.1 by default: a drag of 0.1 x mass x speed, 4200 N at 30 m/s on a car of 1400 kg);
	# the air and the tyres are worked out here
	linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	linear_damp = 0.0
	angular_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	angular_damp = 0.0
	continuous_cd = true
	var mat := PhysicsMaterial.new()
	mat.friction = 0.35
	mat.bounce = 0.05
	physics_material_override = mat


## The pressure of a tyre (applyPressure of Vehicle.js): best around 2.2 bar; 0.8 bar off costs 8 % of the grip;
## higher is stiffer against the slip angle; lower rolls harder and heats more.
func set_pressure(w: Wheel, p: float) -> void:
	var off := (p - 2.2) / 0.8
	w.pressure_grip = maxf(0.6, 1.0 - 0.08 * off * off)
	w.pressure_corner = clampf(1.0 + 0.15 * (p - 2.2), 0.7, 1.25)
	w.pressure_roll = sqrt(2.2 / maxf(0.15, p))
	w.condition = w.pressure_grip


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
		CollisionProxy.hide_objects(body)
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
		if w.lost:
			continue
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
				part.owner = null
				w.spin_node.add_child(part)
				part.transform = Transform3D(Basis.IDENTITY, -w.hub_node.position) * t
			continue
		for part in parts:
			part.get_parent().remove_child(part)
			part.queue_free()
		_library_wheel(w, lib.get("front" if w.front else "rear", {}))
	if bike != null:
		bike_model = MotorcycleModel.new(self, body)


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
	if bike != null:
		bike.recover()
	shift_timer = 0.0
	if parts != null:
		parts.settle()


## The car as a ghost: it is not simulated and touches nothing; it is seen through.
func make_ghost() -> void:
	is_ghost = true
	name = "Ghost"
	if shell != null:
		shell.dispose()
		shell = null
	parts = null
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
		# (--steer=x from the start, or after --steer-after=seconds, once --drive-speed=km/h is held: lift to hold it)
		_auto_time += dt
		var hold := float(Content.arg("drive-speed")) / 3.6 if Content.arg("drive-speed") != "" else 1000.0
		throttle_input = 1.0 if speed < hold else 0.0
		brake_input = 0.0
		var after := float(Content.arg("steer-after")) if Content.arg("steer-after") != "" else 0.0
		steer_input = float(Content.arg("steer")) if Content.arg("steer") != "" and _auto_time >= after else 0.0
	_controls(dt)
	if parts != null and not freeze:
		parts.update(dt)
	if bike != null:
		bike.fit_box(self, _box)
	elif shell != null:
		_fit_box()


## The box of a car with a shell is smaller than the car (the walls meet the nodes first); a car on its side or on its
## nose lies on the box, not on the nodes (they only meet walls), so the box grows to the full size of the car as it
## tips over, in steps of 2 cm.
func _fit_box() -> void:
	var b := global_transform.basis
	var side := clampf((0.85 - absf(b.y.y)) / 0.45, 0.0, 1.0)
	var nose := clampf((absf(b.z.y) - 0.5) / 0.4, 0.0, 1.0)
	var box := _box.shape as BoxShape3D
	var want_x := lerpf(_box_shell.x, _box_full.x, maxf(side, nose))
	var want_z := lerpf(_box_shell.z, _box_full.z, nose)
	if absf(box.size.x - want_x) > 0.02 or absf(box.size.z - want_z) > 0.02:
		box.size = Vector3(want_x, box.size.y, want_z)
		_box.position.z = lerpf(_box_shell.y, _box_full.y, nose)


func _controls(dt: float) -> void:
	# reverse: hold the brake at a standstill to put it in reverse; then the brake drives and the throttle brakes
	var t := throttle_input
	var b := brake_input
	if gear < 0:
		t = brake_input
		b = throttle_input
	if bike != null:
		# (no reverse gear: held at a standstill, the brake has the rider walk the bike back)
		# (not while it is held on the grid, the brake and the handbrake on, and not for the AI)
		var walk := brake_input > 0.5 and throttle_input < 0.1 and handbrake_input < 0.5 and not bike.lean_from_bend
		reverse_hold = reverse_hold + dt if absf(speed) < 0.6 and walk else 0.0
		bike.pushing = reverse_hold > 0.35 or (bike.pushing and walk)
		gear = maxi(gear, 0)
	elif not manual and Settings.get_value("auto_reverse"):
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
	if bike != null:
		if bike.pushing:
			throttle = 0.0
			brake = 0.0
		steer_angle = bike.steer_angle(self, dt)
		return
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
	if manual or gear <= 0 or gearbox == "cvt" or shift_timer > 0.0:
		return
	# (the automatic gearbox of Vehicle.js) the engine speed that the road speed asks for in this gear: spinning
	# wheels must not cause a shift
	var radius := (wheels[0].radius + wheels[2].radius) / 2.0 if drive == "awd" else (wheels[0].radius if drive == "fwd" else wheels[2].radius)
	var ratio := absf(_gear_total())
	var road_rpm := maxf(0.0, speed) / radius * ratio * 30.0 / PI
	var top := gear_ratios.size()
	var limit := engine.limiter_rpm
	var thr := throttle
	var engine_rpm := engine.rpm()
	# the engine on the limiter with the throttle open while the wheels spin faster than the road asks: after a
	# moment it shifts up, as an automatic does at the redline (a leaky time: the engine speed jumps about)
	var spin := 0.0
	for w in wheels:
		if w.driven:
			spin = maxf(spin, w.slip_ratio)
	var slipping := gearbox == "torque-converter" and tc_lock < 0.9 and spin < 0.2
	# (a cut of the limiter counts as on the limiter: the engine braking of the cut drops the engine speed far under
	# the limit at once, and the gearbox of a truck with a strong engine stayed in first on the limiter)
	var on_limiter := (engine_rpm >= limit * 0.8 and engine_rpm > road_rpm * 1.1 + 100.0 and not slipping) or engine_rpm >= limit * 0.97 or engine.cut
	var spinning := on_limiter and thr > 0.5 and speed > 1.0
	_limiter_time = _limiter_time + dt if spinning else maxf(0.0, _limiter_time - dt * 0.3)
	_no_downshift = maxf(0.0, _no_downshift - dt)
	if since_shift < 0.6:
		return
	var up_rpm := limit * (0.45 + 0.42 * thr)
	var down_rpm := limit * (0.23 + 0.17 * thr)
	var next_ratio := float(gear_ratios[gear]) / float(gear_ratios[gear - 1]) if gear < top else 1.0
	var prev_ratio := float(gear_ratios[gear - 2]) / float(gear_ratios[gear - 1]) if gear > 1 else 1.0
	# the downshift is where the engine is still in its torque band (60 % of the speed of the peak torque off the
	# throttle, 90 % wide open), and the upshift not under a quarter above the peak torque
	var peak := engine.peak_torque_rpm()
	if peak > 0.0:
		up_rpm = maxf(up_rpm, peak * 1.25)
		down_rpm = minf(peak * (0.6 + 0.3 * thr), up_rpm / maxf(1.0, prev_ratio) * 0.9)
	down_rpm = minf(down_rpm, up_rpm / maxf(1.0, prev_ratio) * 0.9)
	up_rpm = minf(up_rpm, limit * 0.94)
	# (a converter that is not locked runs the engine faster than the road: at full throttle the engine speed counts)
	var shift_rpm := road_rpm
	if gearbox == "torque-converter" and tc_lock < 0.9 and thr > 0.5:
		shift_rpm = maxf(road_rpm, engine_rpm)
	if gear < top and _limiter_time > 0.35:
		_shift_to(gear + 1)
		_limiter_time = 0.0
		_no_downshift = 3.0
	elif gear < top and shift_rpm > up_rpm and road_rpm * next_ratio > 0.35 * limit and speed > 1.0:
		_shift_to(gear + 1)
	elif gear > 1 and ((road_rpm < down_rpm and road_rpm * prev_ratio < 0.86 * limit and _no_downshift <= 0.0) or (speed < 1.5 and thr < 0.1)):
		_shift_to(gear - 1)


func _shift_to(g: int) -> void:
	shift_timer = shift_time if g > gear else shift_time * 0.7
	gear = g
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
	_launch(dt)

	_stability_control(dt, av.dot(up), v.dot(basis.x))

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
	# toe-in: each wheel points a little inwards (the left one to the right, the right one to the left)
	var tf := deg_to_rad(toe_front)
	var tr := deg_to_rad(toe_rear)
	angles[0] -= tf
	angles[1] += tf
	angles[2] = -tr
	angles[3] = tr

	if shell != null:
		shell.wheels(dt)              # (the bend of the suspension, a wheel that comes off: WheelRig)
	# ---- the suspension: each wheel looks down for the road
	var max_len := susp_length + droop
	var exclude := [get_rid()]
	var comp_rate := [0.0, 0.0, 0.0, 0.0]
	for i in 4:
		var w := wheels[i]
		w.steer = angles[i] + w.toe_bend
		var top := xf * (w.hub + Vector3.UP * susp_length)
		var reach := max_len + w.radius + (0.25 if bike != null else 0.0)
		var q := PhysicsRayQueryParameters3D.create(top, top - up * reach, 1, exclude)
		var hit := {} if w.lost else space.intersect_ray(q)
		# (a motorcycle: the round crown of the tyre, a leaned wheel stands on its shoulder)
		var along := 0.0
		if not hit.is_empty():
			w.point = hit["position"]
			w.normal = hit["normal"]
			along = bike.crown(w, up) if bike != null else w.radius
		if hit.is_empty() or top.distance_to(hit["position"]) - along > max_len:
			w.contact = false
			w.length = max_len
			continue
		w.contact = true
		w.surface = "road"
		var col: Object = hit.get("collider")
		if col != null and col.has_meta("surface"):
			w.surface = str(col.get_meta("surface"))
		w.length = clampf(top.distance_to(hit["position"]) - along, 0.0, max_len)
		var hub_world := top - up * w.length
		var pv := v + av.cross(hub_world - origin - com)
		comp_rate[i] = -pv.dot(up)          # + while the spring is pushed in
		w.comp_rate = comp_rate[i]

	_kart_frame(dt, speed * av.dot(up))

	# ---- spring, damper, bump stop and anti-roll bars: the load on each tyre
	var loads := [0.0, 0.0, 0.0, 0.0]
	for i in 4:
		var w := wheels[i]
		if not w.contact:
			continue
		var f := w.spring * (w.free_length - w.length - w.offset)
		if spring_progression > 0.0 and not unsprung:
			var used := maxf(0.0, susp_length + (ride_front if w.front else ride_rear) - w.length)
			f += spring_progression * w.spring * used * used / maxf(0.01, susp_travel)
		var rate: float = comp_rate[i]
		f += w.damper * rate * (1.0 if rate > 0.0 else w.rebound)
		var bump := susp_length - susp_travel - w.length
		if bump > 0.0 and not unsprung:
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
		if w.contact and (tyre_damage or w.leak > 0.0) and Settings.get_value("damage"):
			TyreDamage.step(self, w, dt)
		w.fx = 0.0
		w.fy = 0.0
		if not w.contact:
			w.s = 0.0
			w.tyre_slope = 0.0
			continue
		var hub_world := xf * (w.hub + Vector3.UP * (susp_length - w.length))
		if bike != null:
			# (a motorcycle: the road pushes along its normal at the contact; a leaned spring carries load / cos(lean))
			w.load *= maxf(0.3, w.normal.dot(up))
			state.apply_force(w.normal * w.load, w.point - origin)
		else:
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
		# the load that the tyre grips with: its load, and the geometric load transfer that the linkage passes at
		# once (Vehicle.js): the side force of the axle at its roll centre (to the outer wheel), and the pitch of
		# the brake and drive forces that anti-dive and anti-squat take
		var axle := 0 if w.front else 1
		var track := front_track if w.front else rear_track
		var geometric: float = (-1.0 if w.left else 1.0) * _axle_fy[axle] * w.roll_centre / track
		geometric += (-1.0 if w.front else 1.0) * _pitch_links / maxf(0.5, wheelbase) / 2.0
		w.grip_load = maxf(0.0, w.load + (geometric if bike == null else 0.0))
		w.lean = _lean(w) if bike == null else 0.0
	if bike != null:
		bike.before_tyres(self, dt)

	# ---- the wheels and the drivetrain, in substeps: the tyre is stiff against the wheel speed, so the wheel
	# speed, the clutch and the engine are stepped SUBSTEPS times with the road speed of this step, and the body
	# gets the mean force of the tyres
	var h := dt / SUBSTEPS
	var new_axle_fy := [0.0, 0.0]
	var new_pitch := 0.0
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
			_tyre_force(w, w.grip_load, surf, w.vref)
			sum_fx[i] += w.fx
			sum_fy[i] += w.fy
			var loose_roll := float(w.kind.get("looseRolling", 1.0)) if surf.get("loose", false) else 1.0
			var rr := rolling * float(w.kind.get("rolling", 1.0)) * w.pressure_roll * loose_roll * float(surf.get("drag", 1.0)) * w.load * w.radius
			tyre_torque[i] = -w.fx * w.radius - rr * tanh(w.omega / 1.0)
		_drivetrain(h, tyre_torque)
	for i in 4:
		var w := wheels[i]
		if not w.contact:
			continue
		w.fx = sum_fx[i] / SUBSTEPS
		w.fy = sum_fy[i] / SUBSTEPS
		# the side force acts at the roll centre (the geometric load transfer of the browser game); the force along
		# the wheel at the contact, raised by anti-dive or anti-squat (the linkage passes that share higher up)
		var at := w.point + up * w.roll_centre
		state.apply_force(w.lf * w.fy, at - origin)
		var anti := (anti_dive if w.fx < 0.0 else anti_lift_front) if w.front else (anti_lift_rear if w.fx < 0.0 else anti_squat)
		var below := (origin + com - w.point).dot(up)
		state.apply_force(w.fp * w.fx, w.point + up * (anti * below) - origin)
		new_axle_fy[0 if w.front else 1] += w.fy
		new_pitch += anti * w.fx * below
	_axle_fy = new_axle_fy
	_pitch_links = new_pitch
	for w in wheels:
		CarWear.tyre_effects(w, dt)
		CarWear.wear_step(w, dt)
	_fuel_step(dt)
	if engine_damage != null and (shell == null or not engine_damage_on):
		engine_damage.repair()
		engine_damage = null
		if has_node("EngineFumes"):
			get_node("EngineFumes").queue_free()
	if shell != null and engine_damage_on:
		if engine_damage == null:
			var ed: Variant = config.get("engine", {}).get("damage", {})
			engine_damage = EngineDamage.new(self, ed if ed is Dictionary else {})
			if not is_ghost and is_inside_tree():
				var fumes := EngineFumes.new()
				fumes.setup(self)
				add_child.call_deferred(fumes)
		engine_damage.update(dt)
	_traction_control(dt)

	# ---- the air: the drag, and the downforce (or lift) of each axle along the up axis of the body, at the axle
	var vv := v.length()
	if vv > 0.1:
		state.apply_central_force(-v * vv * 0.5 * AIR * drag_area * (bike.drag_scale() if bike != null else 1.0))
	var u2 := speed * speed
	if u2 > 1.0 and (downforce_front != 0.0 or downforce_rear != 0.0):
		state.apply_force(-up * downforce_front * u2, basis * Vector3(0.0, 0.0, wheels[0].hub.z))
		state.apply_force(-up * downforce_rear * u2, basis * Vector3(0.0, 0.0, wheels[2].hub.z))

	# ---- a motorcycle: the rider and the camber thrust of the tyres
	if bike != null:
		bike.physics(self, state, dt)
	# ---- the shell: the walls and the other cars on its nodes, and its anchors on the body
	if shell != null:
		shell.step(state)


## Launch control, two-step and transbrake (Vehicle.js). Launch control (Settings; when the car has it): the brake
## and full throttle at a standstill hold the engine at its launch speed with the clutch open; letting go of the
## brake launches, the clutch takes up in 0.15 s and the traction control works for the launch. The two-step key
## holds the engine at its two-step speed; the transbrake key holds the driven wheels with the engine free.
func _launch(dt: float) -> void:
	var was_held := lc_armed or transbrake_held
	var was_lc := lc_armed
	transbrake_held = transbrake_input and gear != 0 and _any_contact()
	if Settings.get_value("launch_control") and launch_control_fitted and gear > 0 and absf(speed) < 2.0:
		lc_armed = (brake > 0.15 and throttle > 0.5) if lc_armed else (brake > 0.5 and throttle > 0.7)
	else:
		lc_armed = false
	if was_held and not (lc_armed or transbrake_held) and throttle > 0.3:
		launch_release = 0.15
		if was_lc and not transbrake_held and gear > 0:
			launching = 6.0
	if launching > 0.0:
		launching -= dt
		if speed > 25.0 or throttle < 0.3 or speed < -0.5:
			launching = 0.0
	var was_two_step := two_step_active
	two_step_active = two_step_fitted and absf(speed) < 3.0 and two_step_input
	if was_two_step and not two_step_active and throttle > 0.3:
		launch_release = 0.15
	engine.hold_rpm = engine.two_step_rpm if two_step_active else (engine.launch_rpm if lc_armed else 0.0)
	engine.holding = lc_armed or transbrake_held or two_step_active


func _held_for_launch() -> bool:
	return lc_armed or transbrake_held or two_step_active


## The lean of a wheel to the left (rad): its static camber (negative: the top in), and the share of the roll of
## the body on its springs that the wheel takes along (roll_camber).
func _lean(w: Wheel) -> float:
	var camber := deg_to_rad(camber_front if w.front else camber_rear)
	var lean := camber if w.left else -camber
	if not unsprung:
		var l := wheels[0 if w.front else 2]
		var r := wheels[1 if w.front else 3]
		var track := front_track if w.front else rear_track
		var roll_right := clampf(atan2(l.length - r.length, track), -0.26, 0.26)      # (the left side extended: the body leans right)
		lean -= roll_right * roll_camber
	return lean + w.camber_bend


## The fuel (fuelStep of Vehicle.js, with "Tyre temperature and wear" on, as the browser game has it with wear):
## a racing engine burns about four times what its work says; the mass goes down with the fuel; empty, it stops.
func _fuel_step(dt: float) -> void:
	var scale := float(Settings.get_value("tyre_wear"))
	if scale <= 0.0:
		engine.no_fuel = false
		fuel_flow = 0.0
		return
	var power := maxf(0.0, engine.throttle_used * engine.full_torque(engine.rpm())) * engine.omega
	fuel_flow = (0.0003 + power / (0.25 * 34e6) * 4.0) * fuel_use * scale * engine.fuel_factor
	fuel = maxf(0.0, fuel - fuel_flow * dt)
	engine.no_fuel = fuel <= 0.0
	_fuel_mass_in -= dt
	if _fuel_mass_in <= 0.0:
		_fuel_mass_in = 1.0
		mass = base_mass + fuel * 0.75


## A kart (Vehicle.js, unsprung): the roll moment of the front axle and the one of the rear axle differ, and the
## difference twists the frame; the twist moves the wheels along their axes, so the wheel of the lighter diagonal
## gives way and the load evens out. And the inner rear wheel is pulled up in a bend, the more the lateral
## acceleration, fully at 0.8 g: the rigid rear axle has no differential, and it would scrub through the bend.
## ay_left: the lateral acceleration to the left (m/s2).
func _kart_frame(dt: float, ay_left: float) -> void:
	for w in wheels:
		w.offset = 0.0
	if not unsprung:
		frame_twist = 0.0
		inner_lift_now = 0.0
		return
	if frame_torsion > 0.0:
		var moment_f := (wheels[0].load - wheels[1].load) * front_track
		var moment_r := (wheels[2].load - wheels[3].load) * rear_track
		var target := clampf((moment_f - moment_r) / 2.0 / (frame_torsion * 180.0 / PI), -0.05, 0.05)
		frame_twist += (target - frame_twist) * minf(1.0, dt / 0.02)
		for w in wheels:
			# (the front axle one way, the rear the other, and the left wheel against the right)
			w.offset += frame_twist * (1.0 if w.front else -1.0) * (1.0 if w.left else -1.0) * (front_track if w.front else rear_track) / 4.0
	else:
		frame_twist = 0.0
	# (an addition to the browser game: the caster of the front axle lifts the inner rear wheel as the wheels are
	# turned, also at a low speed, where there is little lateral acceleration; the rigid axle scrubbed through a
	# hairpin and stopped the kart. By lateral acceleration as in Vehicle.js, or by the steering, whichever is more;
	# the inside is the side the car turns to, or the side it is steered to)
	var by_ay := smoothstep(0.2, 0.8, absf(ay_left) / G)
	var by_steer := smoothstep(0.25, 0.75, absf(steer_angle) / maxf(0.05, max_steer))
	var lift_to := inner_lift * maxf(by_ay, by_steer) if inner_lift > 0.0 else 0.0
	inner_lift_now += (lift_to - inner_lift_now) * minf(1.0, dt / 0.05)
	var left_inside := ay_left > 0.0 if by_ay >= by_steer else steer_angle > 0.0
	if inner_lift_now > 0.0:
		wheels[2 if left_inside else 3].offset += inner_lift_now      # (the rear wheel on the inside of the bend)


## Traction control (Vehicle.js): when a driven wheel turns faster than the road under it, more than one metre per
## second and 12 % of the speed, power is taken off, as a controller (not a switch), down to a fifth.
func _traction_control(dt: float) -> void:
	var max_slip := 0.0
	for w in wheels:
		if w.driven and w.contact:
			max_slip = maxf(max_slip, (w.omega * w.radius - w.forward_speed) / (tc_allowance * (1.2 + 0.12 * absf(w.forward_speed))))
	var err := max_slip - 1.0
	if (tc_fitted and Settings.get_value("tc")) or launching > 0.0:
		var rate := -(4.0 + 8.0 * err) * minf(1.0, err * 4.0) if err > 0.0 else minf(1.0, -err * 6.0) + 1.5 * clampf((-err - 0.5) / 0.4, 0.0, 1.0)
		var floor_f := 0.2 * (1.0 - minf(1.0, (err - 0.3) / 1.2)) if err > 0.3 else 0.2
		tc_factor = clampf(tc_factor + dt * rate, floor_f, 1.0)
	else:
		tc_factor = minf(1.0, tc_factor + dt * 2.0)
	for w in wheels:
		w.tc = w.driven and tc_factor < 0.98 and err > 0.05


## Stability control (Vehicle.js): the yaw rate that the steering asks for against the one the car has; oversteer
## (or the rear sliding out) brakes the outer front wheel, understeer the inner rear one, and takes power off.
## r: the yaw rate (+ to the left), v_left: the speed to the left.
func _stability_control(dt: float, r: float, v_left: float) -> void:
	_esc_brake = [0.0, 0.0, 0.0, 0.0]
	var u := speed
	if esc_fitted and bike == null and Settings.get_value("esc") and handbrake_input < 0.1 and u > 5.0 and _any_contact():
		var steady := u * steer_angle / (wheelbase + understeer_gradient * u * u)
		yaw_wanted += (steady - yaw_wanted) * minf(1.0, dt / 0.25)
		var error := r - yaw_wanted
		var amount := clampf((absf(error) - 0.1) / 0.3, 0.0, 1.0) * esc_gain
		var magnitude := 0.0
		var slip_angle := atan2(v_left, u)
		var rear_out := clampf((-signf(r) * slip_angle - 0.05) / 0.12, 0.0, 1.0) * minf(1.0, absf(r) / 0.15)
		var target := -1
		var share := 1.0
		if (absf(r) > absf(yaw_wanted) and r * error > 0.0) or rear_out > 0.0:
			target = 1 if r > 0.0 else 0               # oversteer: the outer front wheel (turning left: the right one)
			magnitude = maxf(amount, rear_out)
		elif absf(r) < absf(yaw_wanted) and yaw_wanted * error < 0.0:
			target = 2 if yaw_wanted > 0.0 else 3      # understeer: the inner rear wheel
			share = 0.7
			magnitude = amount * 0.7
		esc_level += (magnitude - esc_level) * minf(1.0, dt / 0.04)
		_esc_cut = esc_level
		if target >= 0:
			var w := wheels[target]
			_esc_brake[target] = share * esc_level * w.max_brake * minf(1.5, esc_gain)
	else:
		esc_level = 0.0
		_esc_cut = 0.0
		yaw_wanted = 0.0
	for i in 4:
		wheels[i].esc = _esc_brake[i] > 30.0


func _any_contact() -> bool:
	for w in wheels:
		if w.contact:
			return true
	return false


## The magic formula of Wheel.js (tyreForce): the slip along and across in units of the slip at the peak gives
## how far the tyre is towards its limit; the curve gives the share of the peak force, which is the friction
## times the load, in the direction of the slip.
func _tyre_force(w: Wheel, load: float, surf: Dictionary, vref: float) -> void:
	# the grip of the surface, the tyre (its kind, its grip of car.json), its condition (temperature, wear, pressure)
	var loose: bool = surf.get("loose", false)
	var grip := float(surf["static"]) * w.grip * w.condition * w.damage_grip * float(w.kind.get("grip", 1.0)) * (float(w.kind.get("looseGrip", 1.0)) if loose else 1.0)
	var mu := clampf(grip - 0.00007 * (load * 0.1 - 3500.0), 0.2 * grip, 1.4 * grip)
	var spin_slide := w.omega * w.radius - w.forward_speed
	var melt := smoothstep(4.0, 14.0, spin_slide)
	var ratio := float(surf["kinetic"]) / float(surf["static"])
	if loose and float(w.kind.get("looseSlide", 0.0)) > ratio:
		ratio = float(w.kind["looseSlide"])            # (a knobbly tyre that slides keeps its grip)
	var sliding_ratio := minf(0.98, ratio) * (1.0 - 0.45 * melt)
	var c := 2.0 - (2.0 / PI) * asin(sliding_ratio)
	var peak := tan(PI / (2.0 * c))
	var slip_peak := 0.14
	var angle_peak := 0.15 / (cornering * float(w.kind.get("lateral", 1.0)) * w.stiffness_bias * w.pressure_corner)
	var sx := w.slip_ratio / slip_peak
	# the camber: a leaning tyre pushes to the side it leans to, like a little slip angle (camber thrust, Vehicle.js)
	var sy := (w.slip_tan - 0.5 * w.lean * angle_peak / 0.15) / angle_peak
	var s := sqrt(sx * sx + sy * sy)
	w.s = s
	var f := sin(c * atan(peak * s))
	var d := mu * load
	if s > 1e-9:
		w.fx = d * f * sx / s
		w.fy = -d * 1.05 * f * sy / s * w.lat_grip
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
		brake_torque[i] = brake * w.max_brake * w.abs_factor * (bike.brake_scale(w) if bike != null else 1.0) + _esc_brake[i]
		if transbrake_held and w.driven:
			brake_torque[i] = maxf(brake_torque[i], 4000.0)          # (the transbrake holds the driven wheels)
		if not w.front and bike != null:
			brake_torque[i] = maxf(brake_torque[i], handbrake_input * w.max_brake * w.abs_factor)      # (a motorcycle: the rear brake alone)
		elif not w.front:
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
	# the throttle as the engine gets it: less by the traction and the stability control, and while the gearbox shifts
	# (a converter keeps the drive through a shift: less is taken off)
	var thr := throttle * tc_factor * (1.0 - 0.85 * _esc_cut) * (bike.throttle_scale if bike != null else 1.0)
	if shift_timer > 0.0:
		thr *= 0.6 if gearbox == "torque-converter" else (0.15 if shift_timer < shift_time * 0.5 else 0.0)
	# a stalled engine starts again by itself (no clutch pedal here: Vehicle.js restarts it automatically then)
	if not engine.running and not engine.starting:
		engine.start()
	var te := engine.net_torque(thr, dt)
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
			# (the inertia of the wheel with the grip of the tyre, as the wheel step below takes it; a welded axle: of
			# both wheels, which turn as one)
			var ik := wk.inertia + dt * wk.tyre_slope
			if diff == "welded" or diff == "locked":
				var mate := wheels[k ^ 1]
				ik = (wk.inertia + mate.inertia + dt * (wk.tyre_slope + mate.tyre_slope)) / 2.0
			omega_s += gs * sh * wk.omega
			inv_jd += gs * gs * sh * sh / ik
			a_ext += gs * sh * ext / ik
		var engagement := smoothstep(clutch_start, clutch_full, maxf(engine.rpm(), drive_rpm))
		if shift_timer > 0.0:
			engagement = minf(engagement, 1.0 - shift_timer / maxf(0.01, shift_time))
		# held for a launch: the engine turns free; after it, the clutch takes up in 0.15 s
		if _held_for_launch():
			engagement = 0.0
		elif launch_release > 0.0:
			engagement = minf(engagement, 1.0 - launch_release / 0.15)
			launch_release = maxf(0.0, launch_release - dt)
		clutch_engagement = engagement
		var cap := clutch_capacity * engagement
		var k_cl := cap / 1.5
		var base := engine.omega - omega_s + dt * (te / je - a_ext)
		var den := 1.0 + dt * k_cl * (1.0 / je + inv_jd)
		tc = clampf(k_cl * base / den, -cap, cap)
		td = tc
		if gearbox == "torque-converter":
			# the fluid coupling (Vehicle.js): the pump on the engine, the turbine on the gearbox; it multiplies the torque
			# while it slips, creeps at idle, and a lock-up clutch closes it at speed
			var we := maxf(1.0, engine.omega)
			var sr := clampf(omega_s / we, -1.0, 2.0)
			var stall := tc_stall_rpm * PI / 30.0
			var ccoef := engine.peak_torque * engine.power_scale / (stall * stall)
			var idle_w := engine.idle_rpm * PI / 30.0
			var soft := 0.16 + 0.84 * smoothstep(idle_w * 1.05, idle_w * 1.9, we)
			var tp := ccoef * we * we * (1.0 - sr) * soft * (0.5 if sr > 1.0 else 1.0)
			var tr := 1.0 + (tc_ratio - 1.0) * maxf(0.0, 1.0 - maxf(0.0, sr) / 0.85)
			var tt := tp * (tr if sr < 1.0 else 1.0)
			if _held_for_launch() or launch_release > 0.0:
				tp = 0.0
				tt = 0.0
			var u := absf(speed)
			var want_lock := 1.0 if tc_lockup and u > 7.0 and sr > 0.93 and sr < 1.07 and shift_timer <= 0.0 and not (throttle > 0.9 and u < 15.0) else 0.0
			if shift_timer > 0.0 or u < 5.0:
				want_lock = 0.0
			tc_lock += (want_lock - tc_lock) * minf(1.0, dt / (0.3 if want_lock > 0.0 else 0.1))
			tc = tc_lock * tc + (1.0 - tc_lock) * tp
			td = tc_lock * td + (1.0 - tc_lock) * tt
			tc_slip = sr
			clutch_engagement = tc_lock
	else:
		clutch_engagement = 0.0
		tc_lock = 0.0
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
	# A welded or locked axle is one body: both wheels turn at one speed, with the inertia of both, the torques of
	# both and the grip of both taken implicitly together. (Each wheel stepped on its own and the two then averaged
	# lost energy where the two tyres pull against each other, as a kart at full lock does: it was a brake, and the
	# kart stopped in a hairpin.)
	var done := [false, false, false, false]
	if diff == "welded" or diff == "locked":
		for axle in 2:
			var ia := axle * 2
			var a := wheels[ia]
			var b := wheels[ia + 1]
			if not a.driven:
				continue
			var i_sum := a.inertia + b.inertia
			var i_eff := i_sum + dt * (a.tyre_slope + b.tyre_slope)
			var om: float = a.omega + dt * (tyre_torque[ia] + tyre_torque[ia + 1] + wheel_drive[ia] + wheel_drive[ia + 1]) / i_eff
			var bt: float = brake_torque[ia] + brake_torque[ia + 1]
			if bt > 0.0:
				var dw := dt * bt / i_sum
				om = 0.0 if absf(om) <= dw else om - dw * signf(om)
			a.omega = om
			b.omega = om
			done[ia] = true
			done[ia + 1] = true
	for j in 4:
		if done[j]:
			continue
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
	for w in wheels:
		w.spin = fmod(w.spin + w.omega * dt, TAU)


func _process(_delta: float) -> void:
	if shell != null and shell_mesh == null:
		shell_mesh = SoftBodyMesh.new(self, shell.sb, _part_objects())
	if shell_mesh != null:
		shell_mesh.update()
	if not engine.events.is_empty():
		for e in engine.events:
			bang.emit(e)
		engine.events.clear()
	for w in wheels:
		if w.hub_node == null:
			continue
		w.hub_node.position = w.hub + w.visual_offset + Vector3.UP * (susp_length - w.length + w.offset)
		w.steer_node.rotation.y = w.steer
		w.spin_node.rotation.x = w.spin
	if bike_model != null:
		bike_model.update(get_process_delta_time())


## The objects of the model that are parts (car.json "parts").
func _part_objects() -> Dictionary:
	var out := {}
	for p in config.get("parts", []):
		if p is Dictionary and p.has("object") and str(p.get("mode", "fixed")) != "fixed":
			out[str(p["object"])] = p
	return out


func gear_name() -> String:
	if gear < 0:
		return "R"
	if gear == 0:
		return "N"
	if gearbox == "cvt":
		return "D"
	return str(gear)
