extends RefCounted
## What of a car collides as its maker drew it in Blender: objects whose name starts with "collision" (hidden in the game).
##
## Parented to nothing that moves (the body, or nothing): a part of the rigid body, one convex shape per object, made from the
## vertices of the mesh. They replace the box of the body (Car._box), for the road under the car and for walls; a model without them
## keeps the box.
##
## Parented to a part that moves (susp_lowerarm_FL, susp_upright_FL, steer_tierod_FL, coilover_cylinder_FL, wheel_FL ...): a ball that goes
## with that part, its radius the size of the object (an empty: 5 cm times its scale). A ball meets the road and the walls of the track
## (WallGrid, what the nodes of the shell meet) and gives the blow to the body at that point. It does not bend anything: the damage of
## the wheels stays the business of the shell (WheelRig).

const KERB_HEIGHT := 0.3            # m above the underside of the car: a wall that is lower is driven over (CarShell)
const CONTACT_K := 3000000.0        # N/m of a ball against a wall: a ball of 8 cm stops a car at walking pace within its radius
const CONTACT_MASS := 150.0         # kg that a ball moves, for its damper
const CONTACT_DAMPING := 0.6
const FRICTION := 0.5
const MAX_FORCE := 300000.0         # N of one ball
const GROUND_K := 400000.0          # N/m of a ball on the road: many balls carry the car together
const REFRESH := 0.25               # m that the car moves before the walls near each ball are looked up again
const MARGIN := 0.35                # m round a ball: the walls it can touch before they are looked up again

var car: Node
var balls: Array[Dictionary] = []   # { node, r, near (triangles), at }
var walls: WallGrid = null
var _floor := -0.2
var _ray: PhysicsRayQueryParameters3D = null
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
		out.balls.append({"node": node, "r": radius_of(node, c), "near": PackedInt32Array(), "at": Vector3(1e9, 1e9, 1e9), "side": {}})
	return out


func step(state: PhysicsDirectBodyState3D) -> void:
	var grid := _grid()
	if grid == null:
		return
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
		if p.distance_squared_to(b["at"]) > REFRESH * REFRESH:
			b["at"] = p
			b["near"] = _walls_near(grid, p, float(b["r"]) + MARGIN, xf.origin + up * _floor, up)
		var r: float = b["r"]
		var total := Vector3.ZERO
		var vel := v + w.cross(p - com)
		for t: int in b["near"]:
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
		_on_the_ground(state, p, r, vel)
	step_usec = Time.get_ticks_usec() - t0


## A ball on the road (the road is no wall: it is found with a ray straight down).
func _on_the_ground(state: PhysicsDirectBodyState3D, p: Vector3, r: float, vel: Vector3) -> void:
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
	var vn := vel.dot(n)
	var fn := maxf(0.0, GROUND_K * depth - 2.0 * CONTACT_DAMPING * sqrt(GROUND_K * CONTACT_MASS) * vn)
	var tv := vel - n * vn
	var tl := tv.length()
	var f := n * fn
	if tl > 1e-6:
		f -= tv / tl * minf(FRICTION * fn, tl * CONTACT_MASS / state.step)
	state.apply_force(f.limit_length(MAX_FORCE), p - state.transform.origin)
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
