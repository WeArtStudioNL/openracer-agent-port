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
const AIR := 1.29              # (the air density of the browser game, Helpers.js)
const SUBSTEP := 1.0 / 360.0     # the step of the wheels and the drivetrain (Vehicle.js: 1/360 s at 60 or 120 frames a second)

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
	var local_snow := -1.0          # the snow at the patch (Ground: what the cars left of it; -1 the whole ground)
	var local_water := 0.0          # the water of a puddle at the patch (Ground)
	var ring_time := 0.0
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
	var fe_load := 0.0              # a motorcycle: the load of the road force along the travel of the fork or the swingarm (N)
	var toe_bend := 0.0             # rad to the left, a bent suspension (WheelRig)
	var camber_bend := 0.0          # rad of lean to the left, a bent knuckle
	var damage_grip := 1.0          # a bent wheel grips up to 40 % less
	var omega_from_tyre := false    # the shell tyre turns the wheel itself in its small steps (ShellTyres)
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
# drivetrain (CarDrivetrain)
var drive := "rwd"
var diff := "lsd"
var diff_preload := 150.0
var diff_lock := 60.0           # N m per rad/s of the difference: how fast the limited slip locks
var diff_power := 0.3
var diff_coast := 0.1
var centre_diff := "lsd"        # between the axles of a four wheel drive: lsd, open, locked
var centre_split := 0.4
var cvt_low := 3.0              # the ratios of a CVT (the first and the last of gear_ratios unless car.json says)
var cvt_high := 1.0
var cvt_rate := 1.8             # the ratio changes by at most e^rate a second
var shift_style := "normal"     # normal, sport, drag (an automatic)
var shift_duration := 0.3       # the shift that is going on takes this long
var shift_up := false           # the shift that is going on is an upshift
var last_gear_key := -99
var limiter_time := 0.0
var no_downshift := 0.0
var abs_fitted := true
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
var pedal_input := false        # the brake comes from a pedal (a wheel, a pad, the touch screen), not a key (World)
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
var player_tyres := false       # the player's car (World, the bench of the car editor): it can have the shell tyre (ShellTyres)
var shell_tyres: ShellTyres = null
var shell_mesh: SoftBodyMesh = null
var parts: CarParts = null      # the parts that come off (damage on)
var engine_damage: EngineDamage = null   # what a crash does to the engine (damage on, not for the AI)
var engine_damage_on := true    # (the AI cars have none: they have no pit stop to mend it)
var tyre_damage := false        # car.json tyres.damage: a hard hit can puncture a tyre (with damage on)
var bike: Motorcycle = null     # a motorcycle ("type": "motorcycle"): its rider (motorcycle.gd)
var bike_model: MotorcycleModel = null
var esc_brake := [0.0, 0.0, 0.0, 0.0]   # the brake torque of the stability control on each wheel
var esc_cut := 0.0              # the power that it takes off
var _box: CollisionShape3D
var _box_full := Vector3.ZERO   # the size of the box of the body (x, z) and its place along the car, without a shell
var _box_shell := Vector3.ZERO  # and inside what the nodes can be crushed to
var _axle_fy := [0.0, 0.0]      # the side force of each axle in the last step (the geometric load transfer)
var _pitch_links := 0.0         # the pitch moment that the linkage took in the last step
var _fuel_mass_in := 0.0
var _auto_time := 0.0


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
	collision_mask = 1 | Track.SCENERY_LAYER       # (the road and the scenery of the track, Track)
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
	# (Vehicle.js: the travel to the bump stop leaves 5 cm of the room)
	susp_travel = minf(float(ch.get("suspension_travel", 0.09)), maxf(0.05, susp_length - 0.05))
	droop = maxf(0.08, susp_travel * 1.5)
	max_steer = deg_to_rad(float(ch.get("max_steer_deg", 30)))
	ackermann = float(ch.get("ackermann", 0.6))
	var length := float(dims.get("length", 4.2))
	var width := float(dims.get("width", 1.8))
	var height := float(dims.get("height", 1.4))
	drag_area = float(ch.get("drag_coefficient", 0.35)) * width * height * 0.85      # (the frontal area of Car.js)
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
	abs_fitted = extras.get("abs_on", true) != false
	tc_stall_rpm = float(dt.get("tc_stall_rpm", 0))      # (0: 35 % of the limiter)
	tc_ratio = float(dt.get("tc_ratio", 1.9))
	tc_lockup = dt.get("tc_lockup", true) != false
	# a kart: no suspension, the frame stands on its tyres (the tyre is the spring), and the frame twists
	unsprung = bool(ch.get("unsprung", false))
	frame_torsion = maxf(0.0, float(ch.get("frame_torsion", 0)))
	inner_lift = maxf(0.0, float(ch.get("inner_lift", 0)))
	var light := mass / 1230.0 if mass < 600.0 else 1.0
	tyre_rate = float(ch.get("tyre_rate", 220000.0 * sqrt(light)))
	tyre_damping = float(ch.get("tyre_damping", 3000.0 * sqrt(light)))

	drive = str(dt.get("drive", "rwd"))
	# (Vehicle.js: open or welded, anything else a limited slip; "locked" is welded)
	diff = str(dt.get("diff", "lsd")) if bike == null else "open"
	if Content.arg("diff") != "":
		diff = Content.arg("diff")      # (a test: --diff=open)
	diff = "welded" if diff == "locked" else (diff if diff in ["open", "welded"] else "lsd")
	diff_preload = float(dt.get("diff_preload", 150))
	diff_lock = float(dt.get("diff_lock", 60))
	diff_power = float(dt.get("diff_power", 0.3))
	diff_coast = float(dt.get("diff_coast", 0.1))
	centre_diff = str(dt.get("center_diff", "lsd"))
	centre_split = float(dt.get("center_split", 0.4))
	gear_ratios = dt.get("gear_ratios", gear_ratios)
	if gear_ratios.is_empty():
		gear_ratios = [1.0]
	reverse_ratio = float(dt.get("reverse_ratio", gear_ratios[0]))
	final_drive = float(dt.get("final_drive", 3.7))
	efficiency = float(dt.get("efficiency", 0.92))
	shift_time = float(dt.get("shift_time", 0.32))
	shift_style = str(dt.get("shift_style", "normal"))
	gearbox = str(dt.get("gearbox", "gears"))
	cvt_rpm = float(dt.get("cvt_rpm", 0))      # (0: 85 % of the limiter)
	cvt_rate = float(dt.get("cvt_rate", 1.8))
	cvt_low = float(dt.get("cvt_low", gear_ratios[0]))
	cvt_high = float(dt.get("cvt_high", gear_ratios[-1]))
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
	# (the automatic clutch of Vehicle.js, also under a torque converter, whose coupling is apart from it)
	clutch_start = float(dt.get("clutch_start_rpm", 1050))
	clutch_full = maxf(clutch_start + 50.0, float(dt.get("clutch_full_rpm", 2000)))
	if wheels.size() != 4:
		cvt_ratio = maxf(cvt_low, cvt_high)

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
		# (Vehicle.js: 1.6 kg m2, a light vehicle less by its mass and the square of its tyre)
		var tyre_d := float(ch.get("tire_diameter", 0.65))
		w.inertia = float(ch.get("wheel_inertia", 1.6 * light * pow(tyre_d / 0.632, 2.0) if light < 1.0 else 1.6))
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
		w.rebound = maxf(1.0, float(ch.get("damping_rebound", 1.7)))
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
	# (Vehicle.layout: a bar on the axle that is short of its share, none on the other)
	var kf := wheels[0].spring * front_track * front_track / 2.0
	var kr := wheels[2].spring * rear_track * rear_track / 2.0
	var share := float(ch.get("roll_front", 0.55))
	arb_front = 0.0
	arb_rear = 0.0
	if kf / (kf + kr) < share:
		arb_front = maxf(0.0, share * kr / (1.0 - share) - kf) / (front_track * front_track)
	else:
		arb_rear = maxf(0.0, kf * (1.0 - share) / share - kr) / (rear_track * rear_track)

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
	else:
		CarDriver.attach(self, body)       # the steering wheel of the model turns, the driver of car.json sits in the car (car_driver.gd)
	add_child(CarVisuals.new(self, body))     # the suspension rig, the paint and materials, the mirrors (car_visuals.gd)


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
	elif not manual and Settings.get_value("auto_reverse_pedals" if pedal_input else "auto_reverse"):
		var below := maxf(0.6, float(Settings.get_value("auto_reverse_speed")) / 3.6)      # (Settings.js autoReverseSpeed)
		if gear >= 0 and absf(speed) < below and brake_input > 0.5 and throttle_input < 0.1:
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
		if bike.pushing or bike.crashed or bike.limp:
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
	gear = clampi(gear + (1 if up else -1), -1, gear_ratios.size())      # (the timer of the shift: CarDrivetrain.controls)


## The ratio from the engine to the wheels with the final drive: negative in reverse, 0 in neutral.
func gear_total() -> float:
	if gear == 0:
		return 0.0
	if gear < 0:
		return -reverse_ratio * final_drive
	if gearbox == "cvt":
		return cvt_ratio * final_drive
	return float(gear_ratios[clampi(gear - 1, 0, gear_ratios.size() - 1)]) * final_drive



func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	if is_ghost:
		return
	var dt := state.step
	var basis := state.transform.basis
	var up := basis.y
	var v := state.linear_velocity
	var av := state.angular_velocity
	speed = v.dot(basis.z)
	CarDrivetrain.controls(self, dt)      # (the CVT, the automatic gearbox and the timing of a shift)
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
	# ---- the tyres: the shell of nodes of the browser game (ShellTyres, the player's car), or the ray and the slip curve
	if player_tyres and ShellTyres.wanted(self):
		if shell_tyres == null:
			shell_tyres = ShellTyres.new(self)
		shell_tyres.physics(state, dt, angles)
	else:
		_ray_tyres(state, dt, angles)
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


## The simple tyre (the AI cars of the browser game, Vehicle.simpleTyres): each wheel looks down its suspension with a
## ray, and the slip curve of the magic formula gives the force; the wheels and the drivetrain in steps of SUBSTEP.
func _ray_tyres(state: PhysicsDirectBodyState3D, dt: float, angles: Array) -> void:
	var xf := state.transform
	var basis := xf.basis
	var up := basis.y
	var origin := xf.origin
	var com := state.center_of_mass
	var v := state.linear_velocity
	var av := state.angular_velocity
	var space := state.get_space_state()
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
		loads[i] = f - (bike.fork_load(self, w, dt) if bike != null else 0.0)      # (the fork and the swingarm)
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
	# speed, the clutch and the engine are stepped in steps of SUBSTEP with the road speed of this step, and the body
	# gets the mean force of the tyres
	var steps := maxi(1, ceili(dt / SUBSTEP - 0.001))
	var h := dt / steps
	var new_axle_fy := [0.0, 0.0]
	var new_pitch := 0.0
	var sum_fx := [0.0, 0.0, 0.0, 0.0]
	var sum_fy := [0.0, 0.0, 0.0, 0.0]
	var tyre_torque := [0.0, 0.0, 0.0, 0.0]
	var rolling_force := [0.0, 0.0, 0.0, 0.0]
	for i in 4:
		if wheels[i].contact:
			rolling_force[i] = CarWear.rolling_force(self, wheels[i])
	for _n in steps:
		for i in 4:
			var w := wheels[i]
			if not w.contact:
				tyre_torque[i] = 0.0
				continue
			# the slip along builds up over the relaxation length too, and the tyre turns the wheel explicitly (Vehicle.js,
			# the simple tyre: no implicit grip, the wheel only brought back to the road speed, not past it)
			var kappa := clampf((w.omega * w.radius - w.forward_speed) / w.vref, -12.0, 12.0)
			w.slip_ratio += (kappa - w.slip_ratio) * (1.0 - exp(-h * w.vref / 0.35))
			var surf := Ground.surface(w.surface, w.local_snow, w.local_water)
			CarWear.tyre_force(w, w.grip_load, surf, w.vref, cornering)
			w.tyre_slope = 0.0
			# (Vehicle.js: a little damping on the slip speed keeps a nearly stationary wheel from ringing; the body gets it too)
			var fx: float = w.fx + 400.0 * clampf(w.omega * w.radius - w.forward_speed, -0.3, 0.3)
			sum_fx[i] += fx
			sum_fy[i] += w.fy
			tyre_torque[i] = -fx * w.radius
		_drivetrain(h, tyre_torque)
	for i in 4:
		var w := wheels[i]
		if not w.contact:
			continue
		# (the rolling resistance is a force on the body at the contact, not a torque on the wheel, as in Vehicle.js)
		w.fx = sum_fx[i] / steps - rolling_force[i]
		w.fy = sum_fy[i] / steps
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


func held_for_launch() -> bool:
	return lc_armed or transbrake_held or two_step_active


## The lean of a wheel to the left (rad): its static camber (negative: the top in), and the share of the roll of
## the body on its springs that the wheel takes along (roll_camber).
func _lean(w: Wheel) -> float:
	var camber := deg_to_rad(camber_front if w.front else camber_rear)
	var lean := camber if w.left else -camber
	var l := wheels[0 if w.front else 2]
	var r := wheels[1 if w.front else 3]
	var track := front_track if w.front else rear_track
	# (the left side extended: the body leans right, as Vehicle.springRoll; a kart has its wheels where the frame holds
	# them, moved by the twist of the frame and the lift of the inner rear wheel)
	var dl := -l.offset if unsprung else l.length - r.length
	var dr := -r.offset if unsprung else 0.0
	var roll_right := clampf(atan2(dl - dr, track), -0.26, 0.26)
	# (Vehicle.wheelLean adds the roll: the wheels lean against the roll of the body, the outer one into the bend,
	# which gives it camber thrust; Godot took it away, and the cars had less grip on the skidpad than in the browser)
	lean += roll_right * roll_camber
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
	esc_brake = [0.0, 0.0, 0.0, 0.0]
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
		esc_cut = esc_level
		if target >= 0:
			var w := wheels[target]
			esc_brake[target] = share * esc_level * w.max_brake * minf(1.5, esc_gain)
	else:
		esc_level = 0.0
		esc_cut = 0.0
		yaw_wanted = 0.0
	for i in 4:
		wheels[i].esc = esc_brake[i] > 30.0


func _any_contact() -> bool:
	for w in wheels:
		if w.contact:
			return true
	return false


## The brakes, the engine, the clutch, the differentials and the wheel speeds (CarDrivetrain, Vehicle.js).
func _drivetrain(dt: float, tyre_torque: Array) -> void:
	CarDrivetrain.step(self, dt, tyre_torque)



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
	if shell_tyres != null:
		shell_tyres.draw()              # (the tread of the model pushed in as the shell is, TyreDeform)
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
