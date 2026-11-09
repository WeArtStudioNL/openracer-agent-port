class_name ShellTyres
extends RefCounted
## The shell tyre of the browser game (web/js/TyreShell.js) on the wheels of a car: the tyre as two shells of nodes with
## beams between them, which finds the road itself among the triangles of the ground and gives the car the force of
## its beams on the rim. The shell is native (native/src/tyre_shell.cpp, TyreShell and TyreGround: a port of
## TyreShell.js line for line); this is the part of Vehicle.js around it: when it is used, the wheel as a mass of its
## own on the spring and the damper and standing on the shell (the unsprung mass), the forces on the body, and the turn
## of the wheel, which the shell finds itself in its small steps.
##
## The browser game gives it to the player's car on a 3D track (Vehicle.simpleTyres is false), the AI cars drive on
## the simple tyre (Car._ray_tyres here). Godot: the player's car and the bench of the car editor (Car.player_tyres),
## with Settings "sim_player_tyres" on "shell" (the default), not a motorcycle (its Godot model is the v2 of the
## browser game, which drives on the simple tyre), and not the --ai test driver unless --tyres=shell (the AI drives
## on the simple tyre; --tyres=simple|shell overrides for any run). Without the native part: the simple tyre.

const SHELL_TEAL := Color(0.3, 0.8, 0.8)
const SHELL_DIM := Color(0.35, 0.4, 0.45)
const MAX_ACROSS := 3.0          # the most that the road pushes a wheel across its suspension, in the weight of the car
const MAX_RUB := 8.0             # the most that a tyre rubs, as a share of how hard it is pressed
const MAX_WALL := 2.0            # and from the side against a wall
const MAX_LOAD := 6.0            # and along it: a tyre that is rammed flat (the wheel at the end of its travel) gives no more
const STEPS := 3                 # steps of the car in a step of Godot (1/360 s; Vehicle.js steps at 1/300 s or less)

static var _ground: Object = null           # TyreGround: the triangles of the ground of the scene
static var _ground_dirty := true
static var _watching := false
static var _library: Dictionary = {}

var car: Car
var tyres: Array = []            # a TyreShell per wheel
var touched := [false, false, false, false]     # the tyre is on the road (Vehicle.js cylActive)
var results: Array = [{}, {}, {}, {}]           # what each tyre found in its last step (TyreShell.result)
var sus_vel := [0.0, 0.0, 0.0, 0.0]             # m/s that the wheel moves out along the suspension
var unsprung_mass := 35.0
var _v_prev := Vector3.ZERO
var _acc_down := 0.0             # the acceleration of the body along the suspension, outwards (lastBodyAccDown)
var _has_prev := false
var _force := Vector3.ZERO           # (the sums of the small steps)
var _torque := Vector3.ZERO
var _pitch := 0.0
var _sum_fx := [0.0, 0.0, 0.0, 0.0]
var _sum_fy := [0.0, 0.0, 0.0, 0.0]
var _axle_fy := [0.0, 0.0]
var _ready := false
var _frame := 0                  # (the physics frame of the last step)
var _deform: Array = []          # a TyreDeform per wheel
var _frozen: Array = []                         # (the debug view in a replay: the shape of every tyre in the frame of its wheel)


static func available() -> bool:
	return ClassDB.class_exists("TyreShell") and ClassDB.class_exists("TyreGround")


## Whether a car drives on the shell tyre now (the player's car: Car.player_tyres is checked by the caller).
static func wanted(c: Car) -> bool:
	if c.bike != null or c.is_ghost or not available():
		return false
	var forced := Content.arg("tyres")
	if forced != "":
		return forced == "shell"
	if Content.arg("ai") != "":
		return false
	return str(Settings.get_value("sim_player_tyres")) == "shell"


func _init(c: Car) -> void:
	car = c
	for i in 4:
		tyres.append(ClassDB.instantiate("TyreShell"))
	RunLog.event("tyres: the shell of nodes (TyreShell.js) on %s" % c.car_id)


## The triangles of the ground for the tyres: the collision shapes of the static bodies that the wheels drive on
## (layer 1: the road of the track, the curbs, the floor of the bench), and the steep faces of the scenery: the tyre meets a wall with its
## own nodes. Made again when a shape comes or goes.
static func ground(tree: SceneTree) -> Object:
	if not _watching:
		_watching = true
		tree.node_added.connect(_node_changed)
		tree.node_removed.connect(_node_changed)
	if _ground == null:
		_ground = ClassDB.instantiate("TyreGround")
	if _ground_dirty:
		_ground_dirty = false
		var t0 := Time.get_ticks_msec()
		_ground.call("clear")
		for n in tree.root.find_children("*", "CollisionShape3D", true, false):
			var col := n as CollisionShape3D
			var body := col.get_parent() as StaticBody3D
			if body == null or col.disabled or col.shape == null or (body.collision_layer & (1 | Track.SCENERY_LAYER)) == 0 or not col.is_inside_tree():
				continue
			var faces := _faces_of(col.shape)
			var wall := (body.collision_layer & 1) == 0
			if wall:
				faces = _steep(faces, col.global_transform)
			if not faces.is_empty():
				_ground.call("add_faces", faces, col.global_transform, "road" if wall else str(body.get_meta("surface", "road")))
		RunLog.event("the ground of the shell tyres: %d triangles in %d ms" % [int(_ground.call("get_count")), Time.get_ticks_msec() - t0])
	return _ground


## The faces of a shape that a tyre meets as a wall.
static func _steep(faces: PackedVector3Array, xf: Transform3D) -> PackedVector3Array:
	var out := PackedVector3Array()
	for i in range(0, faces.size() - 2, 3):
		var n := (xf.basis * faces[i + 1] - xf.basis * faces[i]).cross(xf.basis * faces[i + 2] - xf.basis * faces[i])
		if n.length_squared() > 1e-12 and absf(n.normalized().y) < 0.7:
			out.append(faces[i])
			out.append(faces[i + 1])
			out.append(faces[i + 2])
	return out


static func _node_changed(n: Node) -> void:
	if n is CollisionShape3D or n is StaticBody3D:
		_ground_dirty = true


static func _faces_of(shape: Shape3D) -> PackedVector3Array:
	if shape is ConcavePolygonShape3D:
		return (shape as ConcavePolygonShape3D).get_faces()
	if shape is BoxShape3D:
		var bm := BoxMesh.new()
		bm.size = (shape as BoxShape3D).size
		return bm.get_faces()
	if shape is WorldBoundaryShape3D:
		# (a plane: tiles of 50 m over a square of a kilometre round the origin)
		var plane := (shape as WorldBoundaryShape3D).plane
		var out := PackedVector3Array()
		var n := plane.normal
		var a := n.cross(Vector3.FORWARD if absf(n.z) < 0.9 else Vector3.RIGHT).normalized()
		var b := n.cross(a)
		var o := n * plane.d
		for i in range(-10, 10):
			for j in range(-10, 10):
				var p0 := o + a * (i * 50.0) + b * (j * 50.0)
				var p1 := p0 + a * 50.0
				var p2 := p0 + a * 50.0 + b * 50.0
				var p3 := p0 + b * 50.0
				out.append_array([p0, p2, p1, p0, p3, p2])
		return out
	return PackedVector3Array()


## The shell of the tyre of a wheel (Vehicle.tyreShellOf): a custom tyre of the wheel library has its own (WheelLibrary.js
## customSpec), as has a tyre of the catalogue; the rest takes tyres.shell of car.json (width_rear for the rear).
func shell_of(w: Car.Wheel) -> Dictionary:
	var ty: Dictionary = car.config.get("tyres", {})
	var s: Dictionary = ty.get("shell", {}) if ty.get("shell") is Dictionary else {}
	var out := {"width": float(s.get("width", 0.0)), "rings": float(s.get("rings", 3)), "segments": float(s.get("segments", 36)),
		"inner_ratio": float(s.get("inner_ratio", 0.62)), "carcass": float(s.get("carcass", 0.0)), "sized": false}
	if not w.front and float(s.get("width_rear", 0.0)) > 0.0:
		out["width"] = float(s["width_rear"])
	var spec := _spec_of(w)
	if spec.is_empty():
		return out
	if float(spec.get("width", 0.0)) > 0.0:
		out["width"] = float(spec["width"])
		out["sized"] = true
	if float(spec.get("rings", 0.0)) > 0.0:
		out["rings"] = float(spec["rings"])
	if float(spec.get("segments", 0.0)) > 0.0:
		out["segments"] = float(spec["segments"])
	if float(spec.get("inner_ratio", 0.0)) > 0.0:
		out["inner_ratio"] = clampf(float(spec["inner_ratio"]), 0.3, 0.9)
	if spec.get("carcass") != null:
		out["carcass"] = maxf(0.0, float(spec["carcass"]))
	return out


## The shell a tyre of the wheel library brings (CarLoader.js tyreSpecs), or {}.
func _spec_of(w: Car.Wheel) -> Dictionary:
	var lib: Dictionary = car.config.get("wheels", {}).get("library", {}) if car.config.get("wheels") is Dictionary else {}
	var axle: Dictionary = lib.get("front" if w.front else "rear", {}) if lib.get("front" if w.front else "rear") is Dictionary else {}
	var tyre := str(axle.get("tyre", ""))
	if tyre == "":
		return {}
	if tyre == "custom":
		var k: Dictionary = axle.get("custom", {}) if axle.get("custom") is Dictionary else {}
		return {"width": float(k.get("width", 0.245)) if float(k.get("width", 0.0)) > 0.0 else 0.245,
			"inner_ratio": clampf(float(k.get("inner_ratio", 0.7)), 0.3, 0.9) if float(k.get("inner_ratio", 0.0)) > 0.0 else 0.7,
			"rings": float(k.get("rings", 4)) if float(k.get("rings", 0)) > 0.0 else 4.0,
			"segments": float(k.get("segments", 36)) if float(k.get("segments", 0)) > 0.0 else 36.0,
			"carcass": maxf(0.0, float(k.get("carcass", 0.0)))}
	if _library.is_empty():
		var cat: Variant = Content.load_json("wheels/wheels.json")
		_library = {"tyres": {}}
		if cat is Dictionary:
			for t: Variant in cat.get("tyres", []):
				if t is Dictionary:
					_library["tyres"][str(t.get("id", ""))] = t
	var entry: Dictionary = _library["tyres"].get(tyre, {})
	if entry.is_empty():
		return {}
	var sh: Dictionary = entry.get("shell", {}) if entry.get("shell") is Dictionary else {}
	var out := sh.duplicate()
	out["width"] = float(entry.get("width", 0.0))
	return out


## The settings of the shells, once a step of Godot (Vehicle.js, before body.step).
func _configure() -> void:
	var ch: Dictionary = car.config.get("chassis", {})
	var ty: Dictionary = car.config.get("tyres", {})
	var light := car.mass / 1230.0 if car.mass < 600.0 else 1.0
	unsprung_mass = float(ch.get("unsprung_mass", maxf(2.0, 0.0285 * car.mass) if light < 1.0 else 35.0))
	var detail := str(Settings.get_value("sim_tyre_detail"))
	var lighter := not car.unsprung and (detail == "medium" or detail == "low")
	for i in 4:
		var w := car.wheels[i]
		var sh := shell_of(w)
		var p := maxf(minf(0.15, w.pressure), w.pressure - w.pressure_loss)
		var size_corner := pow(clampf(float(sh["width"]) / 0.245, 0.5, 2.0), 0.35) if sh["sized"] and float(sh["width"]) > 0.0 else 1.0
		var static_load := car.mass * (car.weight_front if w.front else 1.0 - car.weight_front) / 2.0 * Car.G
		(tyres[i] as Object).call("configure", {
			"round": false, "tyre_mass": maxf(1.5, 0.3 * unsprung_mass), "pressure": p, "inner_ratio": sh["inner_ratio"], "carcass": sh["carcass"],
			"rings": minf(float(sh["rings"]), 1.0 if detail == "low" else 2.0) if lighter else float(sh["rings"]),
			"segments": minf(float(sh["segments"]), 12.0) if lighter and detail == "low" else float(sh["segments"]),
			"width": sh["width"],
			"stiff_x": float(ty.get("stiff_x", 20.0)),
			"stiff_y": float(ty.get("stiff_y", 18.0)) * car.cornering * float(w.kind.get("lateral", 1.0)) * w.stiffness_bias * w.pressure_corner * size_corner,
			"vertical_stiffness": car.tyre_rate * pow(p / 2.2, 0.8), "vertical_damping": car.tyre_damping, "static_load": static_load,
			"radius": w.radius, "inertia": w.inertia})
	if not _ready:
		_ready = true
		var sh := shell_of(car.wheels[0])
		RunLog.event("shell tyres: %d rings x %d nodes, width %.3f m, inner shell %.2f, %d steps of the car in a step of Godot" % [
			int(sh["rings"]), int(sh["segments"]), float(sh["width"]), float(sh["inner_ratio"]), STEPS])


## The friction of the tread on a surface (Wheel.frictionFor): the static one and the one of a sliding tyre.
static func friction_for(w: Car.Wheel, load: float, surf: Dictionary) -> Vector2:
	var loose: bool = surf.get("loose", false)
	var grip := float(surf["static"]) * w.grip * w.condition * w.damage_grip * float(w.kind.get("grip", 1.0)) * (float(w.kind.get("looseGrip", 1.0)) if loose else 1.0)
	var mu := minf(1.4 * grip, maxf(0.2 * grip, grip - 0.00007 * (load - 3500.0)))
	var ratio := float(surf["kinetic"]) / float(surf["static"])
	if loose and float(w.kind.get("looseSlide", 0.0)) > ratio:
		ratio = float(w.kind["looseSlide"])
	var melt := smoothstep(4.0, 14.0, w.omega * w.radius - w.forward_speed)
	return Vector2(mu, mu * minf(0.98, ratio) * (1.0 - 0.45 * melt))


## One step of Godot: STEPS steps of the shells, the wheels on their springs and the drivetrain; the body gets the
## mean of their forces.
func physics(state: PhysicsDirectBodyState3D, dt: float, angles: Array) -> void:
	var xf := state.transform
	var basis := xf.basis
	var up := basis.y
	var origin := xf.origin
	var com := state.center_of_mass
	var v := state.linear_velocity
	var av := state.angular_velocity
	var gnd := ground(car.get_tree())
	_frame = Engine.get_physics_frames()
	_configure()
	if _has_prev:
		_acc_down = clampf(-((v - _v_prev) / dt).dot(up), -60.0, 60.0)      # (a car that was put back: not a jolt)
	_v_prev = v
	_has_prev = true
	car._kart_frame(dt, car.speed * av.dot(up))
	var h := dt / STEPS
	var rest_hold := 1.0 - smoothstep(0.5, 2.0, v.length())
	_force = Vector3.ZERO
	_torque = Vector3.ZERO
	_pitch = 0.0
	_sum_fx = [0.0, 0.0, 0.0, 0.0]
	_sum_fy = [0.0, 0.0, 0.0, 0.0]
	_axle_fy = [0.0, 0.0]
	var sum_load := [0.0, 0.0, 0.0, 0.0]
	var n_touch := [0, 0, 0, 0]
	var tyre_load := [0.0, 0.0, 0.0, 0.0]
	var tyre_torque := [0.0, 0.0, 0.0, 0.0]
	for s in STEPS:
		var t := h * s
		var rot := av * t                         # (the body as it is at this small step: its turn and its way)
		var up_s := (up + rot.cross(up)).normalized()
		var basis_s := Basis((basis.x + rot.cross(basis.x)).normalized(), up_s, (basis.z + rot.cross(basis.z)).normalized())
		var cg := origin + com + v * t
		# ---- the tyres find the road (Vehicle.js: the shell of every wheel)
		for i in 4:
			var w := car.wheels[i]
			if w.lost:                  # (a wheel that is off stands on nothing)
				touched[i] = false
				tyre_load[i] = 0.0
				tyre_torque[i] = 0.0
				continue
			w.steer = angles[i] + w.toe_bend
			var r_top := basis * (w.hub + Vector3.UP * car.susp_length)
			var top := origin + v * t + r_top + rot.cross(r_top)
			var vm := v + av.cross(r_top - com)
			var dir := (basis_s * Vector3(sin(w.steer), 0.0, cos(w.steer))).normalized()
			var left := up_s.cross(dir)
			var lean := car._lean(w)
			w.lean = lean
			var u_axis := up_s * cos(lean) + left * sin(lean)
			var l_axis := left * cos(lean) - up_s * sin(lean)
			var tb: Object = tyres[i]
			var surf := Ground.surface(w.surface, w.local_snow, w.local_water)
			var fr := friction_for(w, float(tb.call("friction_load")), surf)
			var hub := top - up_s * w.length
			touched[i] = bool(tb.call("step", h, hub, vm - up_s * float(sus_vel[i]), l_axis, dir, u_axis, w.omega, gnd, fr.x, fr.y, w.lat_grip))
			var res: Dictionary = tb.call("result")
			_limit_on_its_side(res, up_s, w)
			results[i] = res
			tyre_load[i] = 0.0
			tyre_torque[i] = 0.0
			if touched[i]:
				tyre_load[i] = maxf(0.0, ((res["normal"] as Vector3) + (res["friction"] as Vector3)).dot(up_s))
				w.contact = true
				w.point = res["centre"]
				w.normal = res["surface_normal"]
				w.surface = str(res["surface"])
				w.load = tyre_load[i]
				_tyre_forces(i, res, h, cg, v, av, basis_s, hub - cg)
				n_touch[i] += 1
				sum_load[i] += tyre_load[i]
				tyre_torque[i] = (float(res["omega_out"]) - w.omega) * w.inertia / h
			else:
				w.contact = false
		_springs(h, basis, up, com, tyre_load, rest_hold)
		# ---- the wheels and the drivetrain (the shell turned the wheel: the torque that gives that turn)
		for i in 4:
			car.wheels[i].omega_from_tyre = touched[i]
			car.wheels[i].tyre_slope = 0.0
		car._drivetrain(h, tyre_torque)
		for w in car.wheels:
			w.omega_from_tyre = false
	# ---- the body gets the mean of the small steps
	state.apply_central_force(_force / STEPS)
	state.apply_torque(_torque / STEPS)
	for i in 4:
		var w := car.wheels[i]
		w.contact = n_touch[i] > 0
		w.load = float(sum_load[i]) / maxf(1, n_touch[i])
		w.grip_load = w.load
		w.fx = float(_sum_fx[i]) / STEPS
		w.fy = float(_sum_fy[i]) / STEPS
		if w.contact and (car.tyre_damage or w.leak > 0.0) and Settings.get_value("damage"):
			TyreDamage.step(car, w, dt)
		if not w.contact:
			w.s = 0.0
			w.slip_ratio *= 0.98
			w.slip_tan *= 0.98
	car._axle_fy = [float(_axle_fy[0]) / STEPS, float(_axle_fy[1]) / STEPS]
	car._pitch_links = _pitch / STEPS


## A car that lands on its side has its tyre crushed against the road across the wheel, where nothing gives way: what the nodes then
## give is limited, or it would throw the car away. So is a tyre rammed flat under a wheel at the end of its travel. A wall is not limited.
func _limit_on_its_side(res: Dictionary, up: Vector3, w: Car.Wheel) -> void:
	var n: Vector3 = res.get("normal", Vector3.ZERO)
	# (against a wall the tyre is stiff and the car hits it hard: what it pushes back with and rubs with is limited, or a touch sends the car spinning)
	var across := Vector3(n.x, 0.0, n.z)
	var wall_most := car.mass * Car.G * MAX_WALL
	if across.length() > wall_most:
		var kept := wall_most / across.length()
		n = across * kept + Vector3.UP * n.y
		res["normal"] = n
		res["friction"] = (res["friction"] as Vector3) * kept
	# (rubber cannot rub harder than the tyre is pressed: a peak in one small step sends the car spinning)
	var fric: Vector3 = res["friction"]
	var pressed := maxf(w.load, car.mass * Car.G * 0.25)      # (the load of the wheel of the last step: a tyre of few nodes hops from node to node)
	if fric.length() > MAX_RUB * pressed:
		res["friction"] = fric.normalized() * MAX_RUB * pressed
	var size := n.length()
	if size > 1.0:                          # (a tyre on its side wall hardly grips: the car slides, it is not flung round on it)
		res["friction"] = (res["friction"] as Vector3) * smoothstep(0.45, 0.9, absf(n.dot(up)) / size)
	var most := car.mass * Car.G * (MAX_ACROSS if absf(n.dot(up)) < 0.7 * size else MAX_LOAD)
	if size <= most or absf(n.y) <= 0.7 * size:
		return
	var k := most / size
	res["normal"] = n * k
	res["friction"] = (res["friction"] as Vector3) * k


## The force of the tread on the car (Vehicle.js, wheel.cylActive): the friction of the nodes along the wheel and across
## it on the road, the slip for the rest of the car (ABS, the sound, the smoke), the rolling resistance, the force
## along the wheel at the contact (raised by the anti geometry) and across at the roll centre, and the pressing force
## of the nodes across the suspension at the hub. cg: the centre of gravity (world); r_hub: the hub from it.
func _tyre_forces(i: int, res: Dictionary, h: float, cg: Vector3, v: Vector3, av: Vector3, basis_s: Basis, r_hub: Vector3) -> void:
	var w := car.wheels[i]
	var up := basis_s.y
	var n := w.normal
	var dir := basis_s * Vector3(sin(w.steer), 0.0, cos(w.steer))
	w.fp = (dir - n * dir.dot(n)).normalized()
	w.lf = n.cross(w.fp)
	var cv := v + av.cross(w.point - cg)
	var vl := cv.dot(w.fp)
	w.forward_speed = vl
	w.side_speed = cv.dot(w.lf)
	w.vref = maxf(absf(vl), 1.5)
	var kappa := clampf((w.omega * w.radius - vl) / w.vref, -12.0, 12.0)
	var tan_a := clampf(w.side_speed / w.vref, -12.0, 12.0)
	var a := 1.0 - exp(-h * w.vref / 0.35)
	w.slip_ratio += (kappa - w.slip_ratio) * a
	w.slip_tan += (tan_a - w.slip_tan) * a
	var fric: Vector3 = res["friction"]
	var fx := fric.dot(w.fp)
	var fy := fric.dot(w.lf)
	var used := float(res["used"])
	var share := float(res["sliding_share"])
	w.s = used / 0.92 if share < 0.05 else maxf(used / 0.92, 1.0 + 0.9 * share)
	_sum_fx[i] += fx
	_sum_fy[i] += fy
	# the rolling resistance (more on soft ground), on the body
	var fx_body := fx - CarWear.rolling_force(car, w, vl)
	var anti := (car.anti_dive if fx_body < 0.0 else car.anti_lift_front) if w.front else (car.anti_lift_rear if fx_body < 0.0 else car.anti_squat)
	var below := (cg - w.point).dot(up)
	_force += w.fp * fx_body + w.lf * fy
	_torque += (w.point + up * (anti * below) - cg).cross(w.fp * fx_body)
	_torque += (w.point + up * w.roll_centre - cg).cross(w.lf * fy)
	_pitch += anti * fx_body * below
	_axle_fy[0 if w.front else 1] += fy
	# the pressing force of the nodes across the suspension (a ramp side, a wall, a slope), at the hub
	var nrm: Vector3 = res["normal"]
	var perp := nrm - up * nrm.dot(up)
	_force += perp
	_torque += r_hub.cross(perp)


## The springs (Vehicle.js): the wheel is a mass of its own between the spring and the damper and the tyre; the damper
## (digressive: the secant of its curve) and the stops are solved implicitly. The body gets the spring at the mount
## (with the weight of the wheel, which is a part of the body here); at a standstill along the normal of the road.
## A kart has no suspension: the wheel stays where the frame holds it and the body gets what the tyre gives.
func _springs(h: float, basis: Basis, up: Vector3, com: Vector3, tyre_load: Array, rest_hold: float) -> void:
	var max_len := car.susp_length + car.droop
	var min_len := car.susp_length - car.susp_travel
	var g_down := Car.G * up.y                    # (the pull of gravity on a wheel along the suspension, outwards)
	var comp := [0.0, 0.0, 0.0, 0.0]
	for i in 4:
		comp[i] = car.susp_length - car.wheels[i].length
	for i in 4:
		var w := car.wheels[i]
		var fs := 0.0
		if car.unsprung:
			w.length = car.susp_length - w.offset
			sus_vel[i] = 0.0
			fs = tyre_load[i]
		else:
			var k := car.arb_front if w.front else car.arb_rear
			var il := 0 if w.front else 2
			var arb: float = k * ((comp[il] - comp[il + 1]) if w.left else (comp[il + 1] - comp[il]))
			var xdot := -float(sus_vel[i])              # + while the spring is pushed in
			var c_use := w.damper if xdot > 0.0 else w.damper * w.rebound
			var mag := absf(xdot)
			var blow := 0.35 if xdot > 0.0 else 0.7
			var damper := (c_use * mag if mag <= 0.3 else c_use * (0.3 + blow * (mag - 0.3))) * signf(xdot)
			var c_eff := absf(damper / xdot) if absf(xdot) > 1e-4 else c_use
			var stop_rate := 12.0 * w.spring
			var stop_damping := 2.5 * sqrt(stop_rate * unsprung_mass)
			var c_tot := c_eff + (stop_damping if w.length < min_len or w.length > max_len else 0.0)
			var bump := stop_rate * (min_len - w.length) if w.length < min_len else 0.0
			if bump > 0.0 and xdot > 2.5:
				car.sound_impact = maxf(car.sound_impact, minf(1.0, (xdot - 2.0) / 6.0))
			var droop := -stop_rate * (w.length - max_len) if w.length > max_len else 0.0
			var used := maxf(0.0, car.susp_length + (car.ride_front if w.front else car.ride_rear) - w.length)
			var progressive := car.spring_progression * w.spring * used * used / maxf(0.01, car.susp_travel) if car.spring_progression > 0.0 else 0.0
			var fs0 := w.spring * (w.free_length - w.length - w.offset) + progressive + bump + droop + arb
			var accel0 := (fs0 - float(tyre_load[i]) - w.ball_load) / unsprung_mass + g_down - _acc_down
			sus_vel[i] = (float(sus_vel[i]) + accel0 * h) / (1.0 + c_tot * h / unsprung_mass)
			fs = fs0 - c_tot * float(sus_vel[i])
			w.length += float(sus_vel[i]) * h
			if w.length < 0.02:
				w.length = 0.02
				sus_vel[i] = maxf(0.0, float(sus_vel[i]))
			if w.length > max_len + 0.06:
				w.length = max_len + 0.06
				sus_vel[i] = minf(0.0, float(sus_vel[i]))
		w.comp_rate = -float(sus_vel[i])
		var r_top := basis * (w.hub + Vector3.UP * car.susp_length)
		# (on the ground the weight of the wheel goes through the tyre; a wheel in the air falls with the car and pushes on nothing)
		var push := fs + unsprung_mass * (g_down if touched[i] else g_down - _acc_down)
		var fsv := up * push
		if rest_hold > 0.0 and w.contact:
			fsv += (w.normal * up.dot(w.normal) * push - fsv) * rest_hold
		_force += fsv
		_torque += (r_top - com).cross(fsv)


## Once a frame (Car._process): the tread of the model is pushed in as the nodes of the shell are (TyreDeform), and
## back to its shape when the car no longer drives on the shell.
func draw() -> void:
	var live := Engine.get_physics_frames() - _frame <= 2
	if _deform.is_empty() and live:
		for w in car.wheels:
			_deform.append(TyreDeform.make(w, float(shell_of(w)["inner_ratio"])) if not car.is_ghost else null)
	for i in _deform.size():
		var d: TyreDeform = _deform[i]
		if d == null:
			continue
		if live:
			d.update(car.wheels[i], tyres[i], float(shell_of(car.wheels[i])["inner_ratio"]))
		else:
			d.off()


## The lines of a shell (TyreShell.shells) as the debug view draws them (DebugView.js): the cables to the rim (every
## second one when they are at rest) by their strain, the belt, the nodes (crosses) by their contact, the rim.
## A replay begins: the shape of every tyre is kept in the frame of its wheel (the replay has the wheels, not the tyres).
func freeze_for_replay() -> void:
	_frozen = []
	for i in 4:
		var sh: Dictionary = (tyres[i].call("shells") as Dictionary).duplicate() if i < tyres.size() and tyres[i] != null else {}
		if sh.is_empty() or int(sh.get("count", 0)) == 0 or car.wheels[i].spin_node == null:
			_frozen.append({})
			continue
		var inner: PackedVector3Array = sh["inner"]
		var mid := Vector3.ZERO
		for q in inner:
			mid += q
		mid /= maxf(1.0, inner.size())
		var to_wheel := Transform3D(car.wheels[i].spin_node.global_transform.basis.orthonormalized(), mid).affine_inverse()
		sh["outer"] = to_wheel * (sh["outer"] as PackedVector3Array)
		sh["inner"] = to_wheel * inner
		_frozen.append(sh)


## The lines of tyre i of the debug view during a replay.
func replay_lines(i: int, pts: Array, cols: Array) -> void:
	if i >= _frozen.size() or (_frozen[i] as Dictionary).is_empty() or car.wheels[i].spin_node == null:
		return
	var sn: Node3D = car.wheels[i].spin_node
	var to_world := Transform3D(sn.global_transform.basis.orthonormalized(), sn.global_position)
	var sh: Dictionary = (_frozen[i] as Dictionary).duplicate()
	sh["outer"] = to_world * (sh["outer"] as PackedVector3Array)
	sh["inner"] = to_world * (sh["inner"] as PackedVector3Array)
	shell_lines(sh, pts, cols)


static func shell_lines(sh: Dictionary, pts: Array, cols: Array) -> void:
	var outer: PackedVector3Array = sh["outer"]
	var inner: PackedVector3Array = sh["inner"]
	var n := int(sh["count"])
	var a: PackedInt32Array = sh["a"]
	var b: PackedInt32Array = sh["b"]
	var strain: PackedFloat32Array = sh["strain"]
	var cls: PackedByteArray = sh["bclass"]
	var contact: PackedByteArray = sh["contact"]
	var sliding: PackedByteArray = sh["sliding"]
	for k in int(sh["beams"]):
		var pa := outer[a[k]]
		var pb := inner[b[k] - n] if b[k] >= n else outer[b[k]]
		if cls[k] == 0 and (k % 2 == 0 or absf(strain[k]) > 0.02):
			var t := clampf(strain[k] / 0.12, -1.0, 1.0)
			var c := SHELL_DIM.lerp(Color(0.2, 0.9, 1.0), t) if t >= 0.0 else SHELL_DIM.lerp(Color(1.0, 0.2, 0.2), -t)
			pts.append_array([pa, pb])
			cols.append_array([c, c])
		elif cls[k] == 3 or cls[k] == 4:
			pts.append_array([pa, pb])
			cols.append_array([SHELL_TEAL, SHELL_TEAL])
	for k in n:
		var c := (Color(1.0, 0.25, 0.2) if sliding[k] else Color(0.3, 1.0, 0.4)) if contact[k] else SHELL_TEAL
		var p := outer[k]
		pts.append_array([p + Vector3(0, 0.008, 0), p - Vector3(0, 0.008, 0), p + Vector3(0.008, 0, 0), p - Vector3(0.008, 0, 0)])
		cols.append_array([c, c, c, c])
		if k % 2 == 0:
			var q := inner[k]
			pts.append_array([q + Vector3(0, 0.006, 0), q - Vector3(0, 0.006, 0)])
			cols.append_array([Color.WHITE, Color.WHITE])
