class_name SteeringWheel
extends RefCounted
## The steering wheel of a car model (findSteeringWheel of web/js/CarLoader.js): a part called "steeringwheel" (or
## car.json "steering_wheel.name") turns with the steering. It turns about its own middle (the middle of its box),
## about the axis of the wheel: the direction in which it is flattest (found from its shape), or car.json
## "steering_wheel.axis" (in the space of the body). The axis points to the driver (the rear of the car), so that a
## positive angle turns it to the left as the driver sees it. The part is not moved in the tree: its transform is
## turned in place, from the one it had.

var node: Node3D
var rest := Transform3D.IDENTITY     # the transform of the part as the model has it
var to_body := Transform3D.IDENTITY  # the parent of the part in the space of the body
var centre := Vector3.ZERO           # the middle and the axis of the wheel, in the space of the body
var axis := Vector3.BACK
var degrees := 450.0                 # the turn of the wheel at full lock (car.json steering_wheel.degrees)
var stop := "rods"                   # "rods" or "degrees" (where the wheel stops: CarLoader.js)
var angle := 0.0


## The steering wheel of a model (model: the root of the glb, body: the node whose space is the body of the car, an
## ancestor of the model, or null for the space the model is in), or null when there is none.
static func find(model: Node3D, body: Node3D, settings: Dictionary) -> SteeringWheel:
	if model == null:
		return null
	var wanted := BoneIK.key(str(settings.get("name", "steeringwheel")))
	if wanted == "":
		wanted = "steeringwheel"
	var found := _first(model, wanted)
	if found == null:
		return null
	var sw := SteeringWheel.new()
	sw.node = found
	sw.rest = found.transform
	sw.to_body = CarModel.relative(found.get_parent(), body) if found.get_parent() is Node3D else Transform3D.IDENTITY
	var points := sw._points()
	if points.size() < 3:
		return null
	var box := AABB(points[0], Vector3.ZERO)
	for p in points:
		box = box.expand(p)
	sw.centre = box.get_center()
	var given: Variant = settings.get("axis")
	sw.axis = BoneIK.vec(given).normalized() if given is Array and (given as Array).size() == 3 else flattest(points, sw.centre)
	if sw.axis.z > 0.0:
		sw.axis = -sw.axis
	var d := float(settings.get("degrees", 450))
	sw.degrees = d if d > 0.0 else 450.0
	sw.stop = "degrees" if str(settings.get("stop", "")) == "degrees" else "rods"
	# (the shell that dents does not bend it: it turns)
	for m in found.find_children("*", "MeshInstance3D", true, false) + ([found] if found is MeshInstance3D else []):
		m.set_meta("no_bend", true)
	return sw


## The first node (the model itself first, then depth first) whose name has wanted in it.
static func _first(n: Node, wanted: String) -> Node3D:
	if n is Node3D:
		var k := BoneIK.key(str(n.name))
		if k.contains(wanted) or (wanted == "steeringwheel" and k.contains("steerwheel")):
			return n as Node3D
	for c in n.get_children():
		var f := _first(c, wanted)
		if f != null:
			return f
	return null


## The vertices of the wheel in the space of the body (at most some 4000 a mesh). With a steering column on it only
## the biggest mesh is the wheel: the column turns with it but does not give it its middle and its axis.
func _points() -> PackedVector3Array:
	var meshes: Array = node.find_children("*", "MeshInstance3D", true, false)
	if node is MeshInstance3D:
		meshes.append(node)
	var column := false
	var biggest: MeshInstance3D = null
	var most := -1
	for m in meshes:
		var mi := m as MeshInstance3D
		if mi != node and RegEx.create_from_string("(?i)column|shaft").search(str(mi.name)) != null:
			column = true
		var count := 0
		if mi.mesh != null:
			for s in mi.mesh.get_surface_count():
				count += (mi.mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()
		if count > most:
			most = count
			biggest = mi
	var out := PackedVector3Array()
	for m in meshes:
		var mi := m as MeshInstance3D
		if mi.mesh == null or (column and mi != biggest):
			continue
		var xf := to_body * rest * CarModel.relative(mi, node) if mi != node else to_body * rest
		for s in mi.mesh.get_surface_count():
			var verts: PackedVector3Array = mi.mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX]
			var step := maxi(1, verts.size() / 4000)
			for i in range(0, verts.size(), step):
				out.append(xf * verts[i])
	return out


## Turns the wheel (radians, positive to the left) about its own middle and axis, or about another (the ring of the
## driver in the car editor).
func turn(a: float, about := Vector3.INF, along := Vector3.ZERO) -> void:
	angle = a
	var c := centre if about == Vector3.INF else about
	var ax := axis if along == Vector3.ZERO else along.normalized()
	var spin := Transform3D(Basis(ax, a), c) * Transform3D(Basis.IDENTITY, -c)
	node.transform = to_body.affine_inverse() * spin * to_body * rest


## The direction in which a cloud of points is thinnest (the smallest axis of its covariance, by Jacobi).
static func flattest(points: PackedVector3Array, centre: Vector3) -> Vector3:
	var a := [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
	for p in points:
		var d := p - centre
		for r in 3:
			for c in 3:
				a[r][c] += d[r] * d[c] / points.size()
	var e := [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
	for sweep in 30:
		var changed := false
		for p in 2:
			for q in range(p + 1, 3):
				if absf(a[p][q]) < 1e-14:
					continue
				changed = true
				var theta: float = (a[q][q] - a[p][p]) / (2.0 * a[p][q])
				var t := signf(theta if theta != 0.0 else 1.0) / (absf(theta) + sqrt(theta * theta + 1.0))
				var cs := 1.0 / sqrt(t * t + 1.0)
				var sn := t * cs
				for k in 3:
					var akp: float = a[k][p]
					var akq: float = a[k][q]
					a[k][p] = cs * akp - sn * akq
					a[k][q] = sn * akp + cs * akq
				for k in 3:
					var apk: float = a[p][k]
					var aqk: float = a[q][k]
					a[p][k] = cs * apk - sn * aqk
					a[q][k] = sn * apk + cs * aqk
				for k in 3:
					var ekp: float = e[k][p]
					var ekq: float = e[k][q]
					e[k][p] = cs * ekp - sn * ekq
					e[k][q] = sn * ekp + cs * ekq
		if not changed:
			break
	var smallest := 0
	for m in range(1, 3):
		if a[m][m] < a[smallest][smallest]:
			smallest = m
	return Vector3(e[0][smallest], e[1][smallest], e[2][smallest]).normalized()
