class_name TriGrid
extends RefCounted
## The triangles of a track in a grid of cells seen from above (web/js/Ground.js as the track editor uses it): the height of the
## surface under a point (the highest one that is not more than `above` metres over a hint) and the first triangle that a ray
## meets. The editor asks for the ground hundreds of times in a drag (a curb, a row of prefabs): a ray of the physics needs the
## shapes to be in a step first, and was slow for that.

const CELL := 5.0

var tris := PackedVector3Array()    # three corners per triangle
var tags := PackedInt32Array()      # per triangle: what it belongs to (the index of a list of the caller)
var _cells := {}                    # Vector2i -> PackedInt32Array
var _stamp := PackedInt32Array()
var _mark := 0
var _lo := Vector2(INF, INF)
var _hi := Vector2(-INF, -INF)


func clear() -> void:
	tris = PackedVector3Array()
	tags = PackedInt32Array()
	_cells = {}
	_stamp = PackedInt32Array()
	_lo = Vector2(INF, INF)
	_hi = Vector2(-INF, -INF)


func count() -> int:
	return tags.size()


## Adds the faces of a mesh (as Mesh.get_faces gives them), placed by xf.
func add_faces(faces: PackedVector3Array, xf: Transform3D, tag: int) -> void:
	for t in faces.size() / 3:
		add_triangle(xf * faces[3 * t], xf * faces[3 * t + 1], xf * faces[3 * t + 2], tag)


func add_triangle(a: Vector3, b: Vector3, c: Vector3, tag: int) -> void:
	var i := tags.size()
	tris.append(a)
	tris.append(b)
	tris.append(c)
	tags.append(tag)
	_stamp.append(0)
	_lo = _lo.min(Vector2(minf(a.x, minf(b.x, c.x)), minf(a.z, minf(b.z, c.z))))
	_hi = _hi.max(Vector2(maxf(a.x, maxf(b.x, c.x)), maxf(a.z, maxf(b.z, c.z))))
	for gx in range(floori(minf(a.x, minf(b.x, c.x)) / CELL), floori(maxf(a.x, maxf(b.x, c.x)) / CELL) + 1):
		for gz in range(floori(minf(a.z, minf(b.z, c.z)) / CELL), floori(maxf(a.z, maxf(b.z, c.z)) / CELL) + 1):
			var key := Vector2i(gx, gz)
			if not _cells.has(key):
				_cells[key] = PackedInt32Array()
			var list: PackedInt32Array = _cells[key]
			list.append(i)
			_cells[key] = list


## The height of the surface at (x, z): the highest one that is not more than `above` metres over hint (hint INF: the highest
## of all); { y, normal, tag } or {} when there is nothing there. skip: a tag that is left out.
func query(x: float, z: float, hint := INF, above := 50.0, skip := -1) -> Dictionary:
	var list: Variant = _cells.get(Vector2i(floori(x / CELL), floori(z / CELL)))
	if list == null:
		return {}
	var best := -INF
	var best_t := -1
	var limit := hint + above
	for t in (list as PackedInt32Array):
		if skip >= 0 and tags[t] == skip:
			continue
		var a := tris[3 * t]
		var b := tris[3 * t + 1]
		var c := tris[3 * t + 2]
		var d := (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
		if absf(d) < 1e-12:
			continue
		var wa := ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d
		var wb := ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d
		var wc := 1.0 - wa - wb
		if wa < -1e-6 or wb < -1e-6 or wc < -1e-6:
			continue
		var y := wa * a.y + wb * b.y + wc * c.y
		if y > best and y <= limit:
			best = y
			best_t = t
	if best_t < 0:
		return {}
	var n := (tris[3 * best_t + 1] - tris[3 * best_t]).cross(tris[3 * best_t + 2] - tris[3 * best_t]).normalized()
	if n.y < 0.0:
		n = -n
	return {"y": best, "normal": n, "tag": tags[best_t]}


## The first triangle that a ray from o in the direction d meets within far metres: { point, t, tag } or {}.
func ray(o: Vector3, d: Vector3, far := 20000.0) -> Dictionary:
	_mark += 1
	var best := far
	var best_tag := -1
	var flat := Vector2(d.x, d.z)
	var step := CELL * 0.5
	var flat_len := flat.length()
	# along the ray seen from above, cell by cell (a ray straight down is one cell)
	var s := 0.0
	var reach := far * flat_len
	# (only where the grid is: the part of the ray over the box of the triangles)
	if flat_len > 1e-6 and _lo.x <= _hi.x:
		var dir := flat / flat_len
		var s0 := 0.0
		var s1 := reach
		for axis in 2:
			var oa := o.x if axis == 0 else o.z
			var da := dir.x if axis == 0 else dir.y
			var lo := (_lo.x if axis == 0 else _lo.y) - CELL
			var hi := (_hi.x if axis == 0 else _hi.y) + CELL
			if absf(da) < 1e-9:
				if oa < lo or oa > hi:
					return {}
				continue
			var ta := (lo - oa) / da
			var tb := (hi - oa) / da
			s0 = maxf(s0, minf(ta, tb))
			s1 = minf(s1, maxf(ta, tb))
		if s0 > s1:
			return {}
		s = s0
		reach = s1
	var last_key := Vector2i(1 << 30, 0)
	while true:
		var p := o + d * (s / flat_len if flat_len > 1e-6 else 0.0)
		var key := Vector2i(floori(p.x / CELL), floori(p.z / CELL))
		for k in [key, key + Vector2i(1, 0), key + Vector2i(0, 1), key + Vector2i(-1, 0), key + Vector2i(0, -1)]:
			if k == last_key:
				continue
			var list: Variant = _cells.get(k)
			if list == null:
				continue
			for t in (list as PackedInt32Array):
				if _stamp[t] == _mark:
					continue
				_stamp[t] = _mark
				var hit: Variant = Geometry3D.ray_intersects_triangle(o, d, tris[3 * t], tris[3 * t + 1], tris[3 * t + 2])
				if hit != null:
					var dist := o.distance_to(hit)
					if dist < best:
						best = dist
						best_tag = tags[t]
		last_key = key
		# (a hit nearer than where the walk is now cannot be beaten by the cells further on)
		if best_tag >= 0 and best * flat_len < s - CELL * 2.0:
			break
		if flat_len <= 1e-6 or s > reach:
			break
		s += step
	if best_tag < 0:
		return {}
	return {"point": o + d * best, "t": best, "tag": best_tag}
