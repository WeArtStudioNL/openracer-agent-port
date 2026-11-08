class_name WallGrid
extends RefCounted
## The walls of a track for the shells of the cars (the triangles of its collision that do not lie flat, as the
## wallCandidates of web/js/Vehicle.js), in a grid of cells seen from above, so that a car finds the few near it.
## The road under a car is the business of its wheels and its body; the nodes of the shell only meet the walls.

const CELL := 4.0

var a := PackedVector3Array()
var b := PackedVector3Array()
var c := PackedVector3Array()
var normal := PackedVector3Array()
var lo := PackedVector3Array()
var hi := PackedVector3Array()
var surface := PackedStringArray()
var count := 0
var _cells := {}                    # Vector2i -> [triangle]
var _stamp := PackedInt32Array()
var _mark := 0


## Adds the triangles of a collision shape (faces as ConcavePolygonShape3D.get_faces gives them) placed by xf.
func add_faces(faces: PackedVector3Array, xf: Transform3D, kind: String) -> void:
	for t in faces.size() / 3:
		var p0 := xf * faces[3 * t]
		var p1 := xf * faces[3 * t + 1]
		var p2 := xf * faces[3 * t + 2]
		var n := (p1 - p0).cross(p2 - p0)
		var l := n.length()
		if l < 1e-8:
			continue
		n /= l
		if absf(n.y) >= 0.5:
			continue                    # it lies flat: a road, not a wall
		var tlo := p0.min(p1).min(p2)
		var thi := p0.max(p1).max(p2)
		var i := count
		a.append(p0)
		b.append(p1)
		c.append(p2)
		normal.append(n)
		lo.append(tlo)
		hi.append(thi)
		surface.append(kind)
		_stamp.append(0)
		count += 1
		for gx in range(floori(tlo.x / CELL), floori(thi.x / CELL) + 1):
			for gz in range(floori(tlo.z / CELL), floori(thi.z / CELL) + 1):
				var key := Vector2i(gx, gz)
				if not _cells.has(key):
					_cells[key] = []
				(_cells[key] as Array).append(i)


## Adds the shapes of a body as walls (a ConcavePolygonShape3D or a box: the wall of the crash test of the car editor).
func add_body(body: CollisionObject3D, kind: String) -> void:
	for n in body.find_children("*", "CollisionShape3D", false, false):
		var col := n as CollisionShape3D
		if col.shape is ConcavePolygonShape3D:
			add_faces((col.shape as ConcavePolygonShape3D).get_faces(), col.global_transform, kind)
		elif col.shape is BoxShape3D:
			var bm := BoxMesh.new()
			bm.size = (col.shape as BoxShape3D).size
			add_faces(bm.get_faces(), col.global_transform, kind)


## The triangles whose box comes within r of the point p (each once).
func near(p: Vector3, r: float) -> PackedInt32Array:
	var out := PackedInt32Array()
	_mark += 1
	for gx in range(floori((p.x - r) / CELL), floori((p.x + r) / CELL) + 1):
		for gz in range(floori((p.z - r) / CELL), floori((p.z + r) / CELL) + 1):
			var list: Variant = _cells.get(Vector2i(gx, gz))
			if list == null:
				continue
			for t: int in list:
				if _stamp[t] == _mark:
					continue
				_stamp[t] = _mark
				if box_near(t, p, r):
					out.append(t)
	return out


func box_near(t: int, p: Vector3, r: float) -> bool:
	var l := lo[t]
	var h := hi[t]
	return p.x > l.x - r and p.x < h.x + r and p.y > l.y - r and p.y < h.y + r and p.z > l.z - r and p.z < h.z + r


## The point of the triangle t nearest to p (Ericson, Real-Time Collision Detection 5.1.5), and whether it is inside
## the face (region 0) or on an edge or a corner (1): [point, region].
func closest(t: int, p: Vector3) -> Array:
	var pa := a[t]
	var pb := b[t]
	var pc := c[t]
	var ab := pb - pa
	var ac := pc - pa
	var ap := p - pa
	var d1 := ab.dot(ap)
	var d2 := ac.dot(ap)
	if d1 <= 0.0 and d2 <= 0.0:
		return [pa, 1]
	var bp := p - pb
	var d3 := ab.dot(bp)
	var d4 := ac.dot(bp)
	if d3 >= 0.0 and d4 <= d3:
		return [pb, 1]
	var cp := p - pc
	var d5 := ab.dot(cp)
	var d6 := ac.dot(cp)
	if d6 >= 0.0 and d5 <= d6:
		return [pc, 1]
	var vc := d1 * d4 - d3 * d2
	var vb := d5 * d2 - d1 * d6
	var va := d3 * d6 - d5 * d4
	var edge := Vector3.ZERO
	var on_edge := true
	if vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
		edge = pa + ab * (d1 / (d1 - d3))
	elif vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
		edge = pa + ac * (d2 / (d2 - d6))
	elif va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
		edge = pb + (pc - pb) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)))
	else:
		on_edge = false
	if on_edge:
		return [edge, 1]
	var denom := 1.0 / (va + vb + vc)
	return [pa + ab * (vb * denom) + ac * (vc * denom), 0]
