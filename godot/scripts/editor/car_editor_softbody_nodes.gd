extends RefCounted
## The nodes of the shell made with rays (softbody-editor.js: scan, fillInside, spread): rays go at the model from the
## six sides of its box on a grid of 10 cm and the first thing they hit is a point of the surface; the nodes are spread
## evenly over those points (the farthest point first), their radius follows the distance between them. A point of a
## grid of 20 cm is inside the model when at least five of six rays from it hit the back of a surface first (the car is
## open at the windows and the wheel arches); of those the ones farthest from the nodes there are become nodes inside.
## The triangles of the model are one TriangleMesh (the BVH of Godot), so the thousands of rays take a moment.
## Everything here is in the frame of the body of the car on the test bench.

const SURFACE_STEP := 0.1
const INSIDE_CELL := 0.2
const INSIDE_RADIUS := 0.12

var faces := PackedVector3Array()
var box := AABB()
var _tm: TriangleMesh = null


## The triangles of the model of the car (what CollisionProxy makes the shell from: no hidden objects, no wheels).
func _init(car: Car, skip: Array) -> void:
	if car == null or car.model_root == null:
		return
	var first := true
	for m in car.model_root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.is_visible_in_tree() or CollisionProxy.hidden_object(mi) or _under(mi, skip, car):
			continue
		var xf := CarModel.relative(mi, car)
		var f := xf * mi.mesh.get_faces()
		if f.is_empty():
			continue
		faces.append_array(f)
		var b := xf * mi.mesh.get_aabb()
		box = b if first else box.merge(b)
		first = false
	if faces.size() >= 3:
		_tm = TriangleMesh.new()
		if not _tm.create_from_faces(faces):
			_tm = null


static func _under(n: Node, names: Array, car: Car) -> bool:
	while n != null and n != car:
		if names.has(str(n.name)):
			return true
		n = n.get_parent()
	return false


func ok() -> bool:
	return _tm != null


## The nearest hit of a ray within reach: [distance, back] (back: the ray hits the back of the face), or [].
func cast(from: Vector3, dir: Vector3, reach: float) -> Array:
	var hit: Dictionary = _tm.intersect_ray(from, dir)
	if hit.is_empty():
		return []
	var t := (Vector3(hit["position"]) - from).dot(dir)
	if t < 0.0 or t > reach:
		return []
	var i := int(hit["face_index"])
	var n := Plane(faces[3 * i], faces[3 * i + 1], faces[3 * i + 2]).normal
	return [t, n.dot(dir) > 0.0]


## The points of the surface that rays from the six sides of the box hit first.
func surface() -> PackedVector3Array:
	var out := PackedVector3Array()
	var lo := box.position
	var hi := box.end
	for d: Vector3 in [Vector3.RIGHT, Vector3.LEFT, Vector3.UP, Vector3.DOWN, Vector3.BACK, Vector3.FORWARD]:
		var axis := 0 if d.x != 0.0 else (1 if d.y != 0.0 else 2)
		var a := [1, 2] if axis == 0 else ([0, 2] if axis == 1 else [0, 1])
		var span := hi[axis] - lo[axis] + 0.2
		var u := lo[a[0]] + SURFACE_STEP / 2.0
		while u < hi[a[0]]:
			var w := lo[a[1]] + SURFACE_STEP / 2.0
			while w < hi[a[1]]:
				var o := Vector3.ZERO
				o[a[0]] = u
				o[a[1]] = w
				o[axis] = lo[axis] - 0.1 if d[axis] > 0.0 else hi[axis] + 0.1
				var hit := cast(o, d, span)
				if not hit.is_empty():
					out.append(o + d * float(hit[0]))
				w += SURFACE_STEP
			u += SURFACE_STEP
	return out


## The points of a grid that lie inside the model.
func inside() -> PackedVector3Array:
	var out := PackedVector3Array()
	var dirs := [Vector3.UP, Vector3.DOWN, Vector3.RIGHT, Vector3.LEFT, Vector3.BACK, Vector3.FORWARD]
	var x := box.position.x + INSIDE_CELL / 2.0
	while x < box.end.x:
		var y := box.position.y + INSIDE_CELL / 2.0
		while y < box.end.y:
			var z := box.position.z + INSIDE_CELL / 2.0
			while z < box.end.z:
				var p := Vector3(x, y, z)
				var votes := 0
				for d: Vector3 in dirs:
					var hit := cast(p, d, 8.0)
					if not hit.is_empty() and hit[1]:
						votes += 1
				if votes >= 5:
					out.append(p)
				z += INSIDE_CELL
			y += INSIDE_CELL
		x += INSIDE_CELL
	return out


## Greedy: the point that is farthest from the ones chosen, again and again, so the nodes lie even over the shape.
static func spread(points: PackedVector3Array, count: int, chosen: PackedVector3Array, min_gap: float) -> PackedVector3Array:
	var dist := PackedFloat64Array()
	dist.resize(points.size())
	for i in points.size():
		var m := 1e9
		for c in chosen:
			m = minf(m, points[i].distance_squared_to(c))
		dist[i] = m
	var out := PackedVector3Array()
	while out.size() < count:
		var best := -1
		var best_d := min_gap * min_gap
		for i in points.size():
			if dist[i] > best_d:
				best_d = dist[i]
				best = i
		if best < 0:
			break
		var p := points[best]
		out.append(p)
		for i in points.size():
			dist[i] = minf(dist[i], points[i].distance_squared_to(p))
	return out


## The radius of nodes that lie this far apart (from the mean distance to the nearest one).
static func radius_for(picked: PackedVector3Array) -> float:
	if picked.size() < 2:
		return 0.2
	var gap := 0.0
	for i in picked.size():
		var m := 1e9
		for j in picked.size():
			if i != j:
				m = minf(m, picked[i].distance_to(picked[j]))
		gap += m
	gap /= picked.size()
	return snappedf(clampf(gap * 0.55, 0.08, 0.3), 0.001)


## The beams that SoftBody makes between nodes at these places (every node to its nearest neighbours of the same part):
## pairs of indices, for the drawing while nodes are moved.
static func beams_of(points: PackedVector3Array, groups: PackedStringArray, near: int, reach: float) -> PackedInt32Array:
	var out := PackedInt32Array()
	var seen := {}
	for a in points.size():
		var close := []
		for b in points.size():
			if a == b or groups[a] != groups[b]:
				continue
			var d := points[a].distance_to(points[b])
			if d < reach and d > 0.02:
				close.append([d, b])
		close.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0])
		for m in mini(near, close.size()):
			var lo := mini(a, int(close[m][1]))
			var hi := maxi(a, int(close[m][1]))
			if seen.has(lo * 4096 + hi):
				continue
			seen[lo * 4096 + hi] = true
			out.append(lo)
			out.append(hi)
	return out
