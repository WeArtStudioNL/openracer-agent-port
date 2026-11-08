class_name CatmullRom
extends RefCounted
## A curve through points as three.js makes it (CatmullRomCurve3, centripetal; LineCurve3 for a straight piece of two
## points), so that what the track editor and the game build from nodes (the road of a design, a curb, a row of prefabs,
## the racing line through the nodes of a design) lies where the browser game puts it: the same points at the same t, the
## same length from 200 pieces (arcLengthDivisions) and the same point at a share u of the length (getPointAt).

var pts := PackedVector3Array()
var closed := false
var straight := false               # a LineCurve3: a straight line from the first point to the second
var divisions := 200
var _lengths := PackedFloat64Array()


static func make(points: PackedVector3Array, is_closed := false, arc_divisions := 200) -> CatmullRom:
	var c := CatmullRom.new()
	c.pts = points
	c.closed = is_closed
	c.divisions = arc_divisions
	return c


## A straight line (three.js LineCurve3).
static func line(a: Vector3, b: Vector3) -> CatmullRom:
	var c := CatmullRom.new()
	c.pts = PackedVector3Array([a, b])
	c.straight = true
	return c


func point(t: float) -> Vector3:
	if straight:
		return pts[1] if t >= 1.0 else pts[0].lerp(pts[1], t)
	var l := pts.size()
	var p := (l - (0 if closed else 1)) * t
	var ip := int(floor(p))
	var weight := p - ip
	if closed:
		ip += 0 if ip > 0 else (int(floor(absi(ip) / float(l))) + 1) * l
	elif weight == 0.0 and ip == l - 1:
		ip = l - 2
		weight = 1.0
	var p0: Vector3
	if closed or ip > 0:
		p0 = pts[posmod(ip - 1, l)]
	else:
		p0 = pts[0] - pts[1] + pts[0]
	var p1 := pts[ip % l]
	var p2 := pts[(ip + 1) % l]
	var p3: Vector3
	if closed or ip + 2 < l:
		p3 = pts[(ip + 2) % l]
	else:
		p3 = pts[l - 1] - pts[l - 2] + pts[l - 1]
	var dt0 := pow(p0.distance_squared_to(p1), 0.25)
	var dt1 := pow(p1.distance_squared_to(p2), 0.25)
	var dt2 := pow(p2.distance_squared_to(p3), 0.25)
	if dt1 < 1e-4:
		dt1 = 1.0
	if dt0 < 1e-4:
		dt0 = dt1
	if dt2 < 1e-4:
		dt2 = dt1
	return Vector3(_calc(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2, weight), _calc(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2, weight),
		_calc(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2, weight))


static func _calc(x0: float, x1: float, x2: float, x3: float, dt0: float, dt1: float, dt2: float, t: float) -> float:
	var t1 := (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1
	var t2 := (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2
	t1 *= dt1
	t2 *= dt1
	var c2 := -3.0 * x1 + 3.0 * x2 - 2.0 * t1 - t2
	var c3 := 2.0 * x1 - 2.0 * x2 + t1 + t2
	return x1 + t1 * t + c2 * t * t + c3 * t * t * t


## The length from the start at every one of the pieces (divisions + 1 values).
func lengths() -> PackedFloat64Array:
	if _lengths.size() == divisions + 1:
		return _lengths
	_lengths.resize(divisions + 1)
	_lengths[0] = 0.0
	var last := point(0.0)
	var total := 0.0
	for k in range(1, divisions + 1):
		var cur := point(float(k) / divisions)
		total += cur.distance_to(last)
		_lengths[k] = total
		last = cur
	return _lengths


func length() -> float:
	if straight:
		return pts[0].distance_to(pts[1])
	return lengths()[divisions]


## The t of the point at a share u of the length (getUtoTmapping).
func u_to_t(u: float) -> float:
	if straight:
		return u
	var arc := lengths()
	var il := arc.size()
	var target := u * arc[il - 1]
	var low := 0
	var high := il - 1
	var i := 0
	while low <= high:
		i = low + (high - low) / 2
		var cmp := arc[i] - target
		if cmp < 0.0:
			low = i + 1
		elif cmp > 0.0:
			high = i - 1
		else:
			high = i
			break
	i = high
	if i < 0:
		return 0.0
	if arc[i] == target:
		return float(i) / (il - 1)
	if i + 1 >= il:
		return 1.0
	var seg := arc[i + 1] - arc[i]
	return (i + (target - arc[i]) / seg) / (il - 1)


func point_at(u: float) -> Vector3:
	return point(u_to_t(u))


func tangent(t: float) -> Vector3:
	if straight:
		return (pts[1] - pts[0]).normalized()
	var t1 := maxf(0.0, t - 0.0001)
	var t2 := minf(1.0, t + 0.0001)
	return (point(t2) - point(t1)).normalized()


func tangent_at(u: float) -> Vector3:
	return tangent(u_to_t(u))


## n + 1 points at the same distance from each other (getSpacedPoints).
func spaced_points(n: int) -> PackedVector3Array:
	var out := PackedVector3Array()
	for d in n + 1:
		out.append(point_at(float(d) / n))
	return out


## n + 1 points at the same step of t (getPoints).
func points(n: int) -> PackedVector3Array:
	var out := PackedVector3Array()
	for d in n + 1:
		out.append(point(float(d) / n))
	return out
