extends RefCounted
## What of a car collides as its maker drew it in Blender: objects whose name starts with "collision" (hidden in the game).
##
## Parented to nothing that moves (the body, or nothing): a part of the rigid body, one convex shape per object, made from the
## vertices of the mesh. They replace the box of the body (Car._box), for the road under the car and for walls; a model without them
## keeps the box.
##
## Parented to a part that moves (susp_lowerarm_FL, susp_upright_FL, steer_tierod_FL, coilover_cylinder_FL, wheel_FL ...): a ball that goes
## with that part, its radius the size of the object (an empty: 5 cm times its scale). A ball meets the road and the walls of the track
## (WallGrid, what the nodes of the shell meet). On the road a ball on the suspension of a wheel presses the arm up against its spring, by
## the lever of where it sits on the arm; the rest of a blow goes to the body at that point. It does not bend anything: the damage of the
## wheels stays the business of the shell (WheelRig).

const KERB_HEIGHT := 0.3            # m above the underside of the car: a wall that is lower is driven over (CarShell)
const CONTACT_K := 3000000.0        # N/m of a ball against a wall: a ball of 8 cm stops a car at walking pace within its radius
const CONTACT_MASS := 150.0         # kg that a ball moves, for its damper
const CONTACT_DAMPING := 0.6
const FRICTION := 0.5
const MAX_FORCE := 300000.0         # N of one ball
const ARM_MASS := 35.0              # kg of what a ball on an arm moves (the wheel and the arm)
const GROUND_K := 400000.0          # N/m of a ball on the road: many balls carry the car together
const REFRESH := 0.25               # m that the car moves before the walls near each ball are looked up again
const MARGIN := 0.35                # m round a ball: the walls it can touch before they are looked up again

var car: Node
var balls: Array[Dictionary] = []   # { node, r, near (triangles), at }
var walls: WallGrid = null
var _floor := -0.2
var _ray: PhysicsRayQueryParameters3D = null
var _rig_of: Variant = null
var contacts := 0                   # balls that have touched the road (the tests)
var step_usec := 0                  # how long the last step took (the tests)


static func is_collision(raw: String) -> bool:
	return SuspensionRig.clean(raw).begins_with("collision")


## Whether a node sits under a part of the suspension, the steering or a wheel.
static func _on_moving_part(n: Node, car_node: Node) -> bool:
	var a := n.get_parent()
	while a != null and a != car_node:
		var c := SuspensionRig.clean(str(a.name))
		if not is_collision(str(a.name)) and (not SuspensionRig.classify(str(a.name)).is_empty()
				or c.begins_with("coilover") or c.begins_with("wheel") or c.begins_with("rim") or c.begins_with("ball") or c.begins_with("brake")):
			return true
		a = a.get_parent()
	return false


## The convex shapes of the body in the frame of the car (Array of PackedVector3Array), and the collision objects that move.
static func read_model(root: Node3D, car_node: Node3D) -> Dictionary:
	var hulls: Array[PackedVector3Array] = []
	var moving: Array[Node3D] = []
	for n in root.find_children("*", "Node3D", true, false):
		var node := n as Node3D
		if not is_collision(str(node.name)):
			continue
		if _on_moving_part(node, car_node):
			moving.append(node)
			continue
		var mi := node as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		var shape := mi.mesh.create_convex_shape(true, false)
		if shape == null or (shape as ConvexPolygonShape3D).points.size() < 4:
			continue
		var xf := CarModel.relative(mi, car_node)
		var points := PackedVector3Array()
		for p in (shape as ConvexPolygonShape3D).points:
			points.append(xf * p)
		hulls.append(points)
	return {"hulls": hulls, "moving": moving}


## The radius of a ball, from the size of its mesh in the frame of the car.
static func radius_of(node: Node3D, car_node: Node3D) -> float:
	var xf := CarModel.relative(node, car_node)
	var mi := node as MeshInstance3D
	if mi == null or mi.mesh == null:
		return maxf(0.01, 0.05 * maxf(xf.basis.x.length(), maxf(xf.basis.y.length(), xf.basis.z.length())))
	var s := mi.mesh.get_aabb().size
	return maxf(0.01, maxf(s.x * xf.basis.x.length(), maxf(s.y * xf.basis.y.length(), s.z * xf.basis.z.length())) / 2.0)


## The balls of a car, or null when it has none. moving: the collision objects that move (read_model).
static func make(c: Node3D, moving: Array[Node3D]) -> Variant:
	if moving.is_empty():
		return null
	var out = load("res://scripts/car_collision.gd").new()
	out.car = c
	for node in moving:
		out.balls.append({"node": node, "r": radius_of(node, c), "near": PackedInt32Array(), "at": Vector3(1e9, 1e9, 1e9), "side": {}, "wheel": _wheel_of(node, c), "lever": -1.0})
	return out


## The wheel of the part that a ball is on, or -1.
static func _wheel_of(n: Node, car_node: Node) -> int:
	var a := n.get_parent()
	while a != null and a != car_node:
		var wheel: int = SuspensionRig.CORNERS.get(SuspensionRig.stem(str(a.name)).right(2), -1)
		if wheel >= 0 and not is_collision(str(a.name)):
			return wheel
		a = a.get_parent()
	return -1


func _rig() -> Variant:
	if _rig_of == null:
		for c in car.get_children():
			if c.get("rig") != null:
				_rig_of = c.get("rig")
	return _rig_of


## How far a ball goes up per metre that its wheel goes up: where it sits along its arm (hinge 0, ball joint 1), 1 on anything else.
func _lever(b: Dictionary, rig: Variant) -> float:
	var at := CarModel.relative(b["node"], car).origin
	var a: Node = (b["node"] as Node).get_parent()
	while a != null and a != car:
		for p: Dictionary in rig.parts:
			if p["node"] == a and p["kind"] == "arm":
				var o: Vector3 = p["origin"]
				var f: Vector3 = p["far"]
				return clampf((Vector2(at.x, at.y).distance_to(Vector2(o.x, o.y))) / maxf(0.05, Vector2(f.x, f.y).distance_to(Vector2(o.x, o.y))), 0.05, 1.0)
		a = a.get_parent()
	return 1.0


func step(state: PhysicsDirectBodyState3D) -> void:
	for w in car.wheels:
		w.ball_load = 0.0
	var rig: Variant = _rig()
	var grid := _grid()
	var t0 := Time.get_ticks_usec()
	var xf := state.transform
	var up := xf.basis.y
	var com := xf.origin + state.center_of_mass
	var v := state.linear_velocity
	var w := state.angular_velocity
	_floor = float(car.get_meta("floor_y", _floor))
	for b in balls:
		var node: Node3D = b["node"]
		if not is_instance_valid(node):
			continue
		var p: Vector3 = xf * CarModel.relative(node, car).origin
		var on_arm: bool = int(b["wheel"]) >= 0 and rig != null and car.shell_tyres != null
		if on_arm:
			if float(b["lever"]) < 0.0:
				b["lever"] = _lever(b, rig)
			var i: int = b["wheel"]              # (the arm as it is now: the parts are placed once a frame, the physics runs more often)
			p += up * float(b["lever"]) * (float(rig._travel(i)) - float(rig.travel_shown[i]))
		if grid != null and p.distance_squared_to(b["at"]) > REFRESH * REFRESH:
			b["at"] = p
			b["near"] = _walls_near(grid, p, float(b["r"]) + MARGIN, xf.origin + up * _floor, up)
		var r: float = b["r"]
		var total := Vector3.ZERO
		var vel := v + w.cross(p - com)
		for t: int in (b["near"] if grid != null else PackedInt32Array()):
			var res := grid.closest(t, p)
			var dv: Vector3 = p - (res[0] as Vector3)
			var d2 := dv.length_squared()
			var side: Dictionary = b["side"]
			var over := dv.dot(grid.normal[t])
			if d2 >= r * r and not (side.has(t) and over * float(side[t]) < 0.0):
				side.erase(t)
				continue
			var dist := sqrt(d2)
			var n: Vector3 = dv / dist if dist > 1e-5 else grid.normal[t]
			var depth := r - dist
			if not side.has(t):
				side[t] = signf(over) if over != 0.0 else 1.0
			elif over * float(side[t]) < 0.0:      # (the ball went through the face: it is pushed back, not on through)
				n = grid.normal[t] * float(side[t])
				depth = r + dist
			if int(res[1]) != 0 and absf(n.dot(grid.normal[t])) < 0.85:
				continue                # (the seam between two triangles: the neighbour has the contact)
			if n.y >= 0.5 or n.dot(up) >= 0.5:
				continue                # (a surface that the car rides on)
			var vn := vel.dot(n)
			var fn := maxf(0.0, CONTACT_K * depth - 2.0 * CONTACT_DAMPING * sqrt(CONTACT_K * CONTACT_MASS) * vn)
			var tv := vel - n * vn
			var tl := tv.length()
			total += n * fn
			if tl > 1e-6:
				total -= tv / tl * minf(FRICTION * fn, tl * CONTACT_MASS / state.step)
		if total != Vector3.ZERO:
			state.apply_force(total.limit_length(MAX_FORCE), p - xf.origin)
		_on_the_ground(state, p, r, vel, b if on_arm else {})
	step_usec = Time.get_ticks_usec() - t0


## A ball on the road (the road is no wall: it is found with a ray straight down).
func _on_the_ground(state: PhysicsDirectBodyState3D, p: Vector3, r: float, vel: Vector3, on_arm: Dictionary) -> void:
	if _ray == null:
		_ray = PhysicsRayQueryParameters3D.create(p, p, 1, [(car as RigidBody3D).get_rid()])
	_ray.from = p + Vector3.UP * r
	_ray.to = p + Vector3.DOWN * r * 1.2
	var hit := state.get_space_state().intersect_ray(_ray)
	if hit.is_empty():
		return
	var n: Vector3 = hit["normal"]
	var depth := r - (p - (hit["position"] as Vector3)).dot(n)
	if n.y < 0.5 or depth <= 0.0:
		return
	var up := state.transform.basis.y
	var at := vel
	var mass := CONTACT_MASS
	var lever := 1.0
	var wheel: Variant = null
	if not on_arm.is_empty():
		wheel = car.wheels[int(on_arm["wheel"])]
		lever = float(on_arm["lever"])
		at += up * lever * float(wheel.comp_rate)     # (the arm goes up with the wheel)
		mass = ARM_MASS
	var vn := at.dot(n)
	var fn := maxf(0.0, GROUND_K * depth - 2.0 * CONTACT_DAMPING * sqrt(GROUND_K * mass) * vn)
	var tv := at - n * vn
	var tl := tv.length()
	var f := n * fn
	if tl > 1e-6:
		f -= tv / tl * minf(FRICTION * fn, tl * mass / state.step)
	f = f.limit_length(MAX_FORCE)
	if wheel != null:
		var lift := maxf(0.0, f.dot(up))
		wheel.ball_load += lift * lever          # (up along the suspension it presses the arm, against the spring)
		f -= up * lift
	state.apply_force(f, p - state.transform.origin)
	contacts += 1


func _grid() -> WallGrid:
	if car.shell != null and car.shell.walls != null:
		walls = car.shell.walls
	if walls == null and car.is_inside_tree():
		var track := car.get_tree().get_first_node_in_group("track")
		if track != null and track.has_method("walls"):
			walls = track.walls()
	return walls


func _walls_near(grid: WallGrid, p: Vector3, r: float, under: Vector3, up: Vector3) -> PackedInt32Array:
	var out := PackedInt32Array()
	for t in grid.near(p, r):
		if maxf((grid.a[t] - under).dot(up), maxf((grid.b[t] - under).dot(up), (grid.c[t] - under).dot(up))) >= KERB_HEIGHT:
			out.append(t)
	return out
