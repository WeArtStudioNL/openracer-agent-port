class_name TrackDesign
extends Node3D
## The design of a track in the track editor without a model from Blender (web/tools/track-design.js): a road drawn with nodes
## (a smooth loop through them, with the height and the width of the road at every node), the grass beside it and the ground
## under it, branches (roads of their own that join the track: a pit lane, a side road), surfaces (an area of gravel, sand ...)
## and prefabs. The design is kept in track.json ("design": nodes, branches, patches and prefabs, so it can be changed again)
## and saved as a glb that the game loads like any other track (the parts are named so that the surfaces are known).
## The editor (TrackEditor) does the pointer and the fields; this node makes the meshes from data.

signal rebuilt

const DEFAULT_TEXTURES := {"road": "asphalt", "shoulder": "grass", "ground": "grass"}
const BRANCH_STEP := 2.0
const BRANCH_SHOULDER := 6.0
const PATCH_SURFACES := {"road": {"label": "Road", "texture": "", "role": "road"}, "gravel": {"label": "Gravel", "texture": "gravel", "role": "gravel"},
	"sand": {"label": "Sand", "texture": "sand", "role": "sand"}, "grass": {"label": "Grass", "texture": "grass", "role": "grass"},
	"dirt": {"label": "Dirt", "texture": "dirt", "role": "ground"}}
const GRIP_CHOICES := [["road", "Road"], ["grass", "Grass"], ["ground", "Dirt"], ["sand", "Sand"], ["gravel", "Gravel"], ["mud", "Mud"]]
const HIDDEN_MIN := 0.005
const HIDDEN_MAX := 2.0
const HIDDEN_CELL := 4.0
const HIDDEN_STEP := 1.0

var data: Dictionary = {}
var road_group := Node3D.new()      # the road, the shoulders and the ground
var branch_group := Node3D.new()
var patch_group := Node3D.new()
var prefab_group := Node3D.new()
var main_line: Array = []           # the middle of the road: { x, y, z, w, u }
var main_curve: CatmullRom = null
var road_edges: Array = []          # [{ pts, closed }] the two edges of the track
var branch_lines: Array = []        # [{ points: [{ x, y, z, w, tangent, along }], index }]
var branch_edges: Array = []
var surface_grid := TriGrid.new()   # what a prefab stands on: the road, the branches, the surfaces and the ground
var ground_y: Callable              # the ground of the editor under the surfaces (x, z, hint) -> y
var _last_terrain: MeshInstance3D = null


static func default_design() -> Dictionary:
	var nodes: Array = []
	for i in 8:
		var a := i / 8.0 * TAU
		nodes.append({"x": roundf(cos(a) * 120), "y": 0, "z": roundf(sin(a) * 70), "width": 12})
	return {"nodes": nodes, "closed": true, "prefabs": [], "textures": DEFAULT_TEXTURES.duplicate()}


func _init() -> void:
	name = "Design"
	road_group.name = "design-road"
	branch_group.name = "design-branches"
	patch_group.name = "design-patches"
	prefab_group.name = "design-prefabs"
	for g in [road_group, branch_group, patch_group, prefab_group]:
		add_child(g)


func set_data(d: Dictionary) -> void:
	data = d
	if not (data.get("textures") is Dictionary):
		data["textures"] = DEFAULT_TEXTURES.duplicate()
	for k in ["prefabs", "patches", "branches"]:
		if not (data.get(k) is Array):
			data[k] = []
	if not data.has("closed"):
		data["closed"] = true


static func r2(v: float) -> float:
	return roundf(v * 100.0) / 100.0


func texture_of(what: String) -> String:
	var chosen := str(data.get("textures", {}).get(what, ""))
	return chosen if MeshKit.TEXTURES.has(chosen) else str(DEFAULT_TEXTURES[what])


func curve_of() -> CatmullRom:
	var pts := PackedVector3Array()
	for n in data["nodes"]:
		pts.append(Vector3(float(n["x"]), float(n.get("y", 0)), float(n["z"])))
	return CatmullRom.make(pts, data.get("closed", true) != false, maxi(200, pts.size() * 40))


func _width_at(curve: CatmullRom, u: float) -> float:
	var nodes: Array = data["nodes"]
	var n := nodes.size()
	var closed: bool = data.get("closed", true) != false
	var lengths := curve.lengths()
	var total := lengths[lengths.size() - 1]
	var fractions: Array[float] = []
	for i in n:
		var t := float(i) / n if closed else float(i) / (n - 1)
		fractions.append(lengths[mini(lengths.size() - 1, roundi(t * (lengths.size() - 1)))] / total)
	for i in n:
		var nxt := (i + 1) % n
		var a := fractions[i]
		var b := 1.0 if closed and nxt == 0 else fractions[nxt]
		if not closed and nxt == 0:
			return float(nodes[i]["width"])
		if u >= a and u <= b:
			var s := (u - a) / (b - a) if b > a else 0.0
			var k := s * s * (3.0 - 2.0 * s)
			return float(nodes[i]["width"]) + (float(nodes[nxt]["width"]) - float(nodes[i]["width"])) * k
	return float(nodes[n - 1]["width"])


## A ribbon between two rows of points; the texture tiled in metres (across by the width there, along by along[i]).
func _strip(part: String, left: Array, right: Array, tex: String, role: String, along: Array, open: bool) -> MeshInstance3D:
	var count := left.size()
	var closed: bool = false if open else data.get("closed", true) != false
	var size := MeshKit.size_of(tex)
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	for i in count:
		verts.append(left[i])
		verts.append(right[i])
		var v: float = along[i] / size
		uvs.append(Vector2(0, v))
		uvs.append(Vector2((left[i] as Vector3).distance_to(right[i]) / size, v))
	var segments := count if closed else count - 1
	for i in segments:
		var a := i * 2
		var b := ((i + 1) % count) * 2
		idx.append_array([a, a + 1, b, a + 1, b + 1, b])
	var mi := MeshInstance3D.new()
	mi.name = part
	mi.mesh = MeshKit.build(verts, uvs, idx, MeshKit.textured(tex, Color.WHITE, true))
	mi.mesh.resource_name = part
	mi.set_meta("role", role)
	return mi


## A row of points beside a line folds over itself on the inside of a sharp bend: a point that goes backwards is put on the last
## one that went forwards (the ribbon narrows to a fan there).
static func unfold(points: Array, tangents: Array, closed: bool) -> void:
	var n := points.size()
	if n < 3:
		return
	var start := 0
	if closed:
		var best := INF
		for i in n:
			var a: Vector3 = tangents[(i + n - 1) % n]
			var c: Vector3 = tangents[(i + 1) % n]
			var turn := 1.0 - (a.x * c.x + a.z * c.z)
			if turn < best:
				best = turn
				start = i
	var last: Vector3 = points[start]
	for k in range(1, n):
		var i := (start + k) % n
		if not closed and i < start:
			break
		var p: Vector3 = points[i]
		var t: Vector3 = tangents[i]
		var t0: Vector3 = tangents[(i + n - 1) % n]
		if (p.x - last.x) * t.x + (p.z - last.z) * t.z <= 0.01 or (p.x - last.x) * t0.x + (p.z - last.z) * t0.z <= 0.01:
			points[i] = last
		else:
			last = p


## The road, its shoulders, the branches and the ground made again from the data (with_terrain false: the ground of before stays,
## while a node is dragged).
func rebuild(with_terrain := true) -> void:
	for c in road_group.get_children():
		c.free()
	if with_terrain:
		_last_terrain = null
	var nodes: Array = data.get("nodes", [])
	if nodes.size() < 2:
		main_line = []
		road_edges = []
		_grid()
		rebuilt.emit()
		return
	var closed: bool = data.get("closed", true) != false
	var curve := curve_of()
	var length := curve.length()
	var samples := clampi(roundi(length / 2.0), 24, 2000)
	var count := samples if closed else samples + 1
	var left: Array = []
	var right: Array = []
	var sh_l: Array = []
	var sh_r: Array = []
	var along: Array = []
	var tangents: Array = []
	var centre: Array = []
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	var min_y := INF
	main_line = []
	for i in count:
		var u := minf(1.0, float(i) / samples)
		along.append(u * length)
		var t := curve.u_to_t(u)
		var p := curve.point(t)
		var tg := curve.tangent(t)
		tg.y = 0.0
		tg = tg.normalized()
		var side := Vector3(tg.z, 0, -tg.x)
		var w := _width_at(curve, u) / 2.0
		tangents.append(tg)
		main_line.append({"x": p.x, "y": p.y, "z": p.z, "w": w, "u": u})
		left.append(p + side * w)
		right.append(p - side * w)
		sh_l.append(p + side * (w + 14.0) + Vector3(0, -0.3, 0))
		sh_r.append(p - side * (w + 14.0) + Vector3(0, -0.3, 0))
		min_y = minf(min_y, p.y)
		lo = lo.min(Vector2(p.x, p.z))
		hi = hi.max(Vector2(p.x, p.z))
		centre.append([p.x, p.z, p.y, w + 14.0])
	for row in [left, right, sh_l, sh_r]:
		unfold(row, tangents, closed)
	main_curve = curve
	road_edges = [{"pts": left, "closed": closed}, {"pts": right, "closed": closed}]
	var lines := build_branch_lines()
	for b in lines:
		for q in b["points"]:
			centre.append([q["x"], q["z"], q["y"], q["w"] + 6.0])
			lo = lo.min(Vector2(q["x"], q["z"]))
			hi = hi.max(Vector2(q["x"], q["z"]))
			min_y = minf(min_y, q["y"])
	var road := _strip("road", left, right, texture_of("road"), "road", along, false)
	var parts := _branch_parts(lines)
	var inner_l: Array = left.duplicate()
	var inner_r: Array = right.duplicate()
	if not parts["rings"].is_empty():
		for pair in [[inner_l, sh_l], [inner_r, sh_r]]:
			for i in (pair[0] as Array).size():
				var q: Vector3 = pair[0][i]
				var o: Vector3 = pair[1][i]
				var d := Vector2(o.x - q.x, o.z - q.z).normalized() * 0.4
				for r in parts["rings"]:
					if inside_ring(r, q.x + d.x, q.z + d.y):
						pair[0][i] = q - Vector3(0, 0.15, 0)
						break
	var shoulder_l := _strip("shoulder_left", sh_l, inner_l, texture_of("shoulder"), "grass", along, false)
	var shoulder_r := _strip("shoulder_right", inner_r, sh_r, texture_of("shoulder"), "grass", along, false)
	var ground: MeshInstance3D
	if not with_terrain and _last_terrain != null:
		ground = _last_terrain.duplicate()
	else:
		ground = _terrain(centre, lo, hi, min_y)
	_last_terrain = ground.duplicate()
	for m in [road, shoulder_l, shoulder_r, ground]:
		road_group.add_child(m)
	for c in branch_group.get_children():
		c.free()
	for m in parts["meshes"]:
		branch_group.add_child(m)
	_grid()
	if with_terrain:
		build_patches()
	rebuilt.emit()


func _grid() -> void:
	surface_grid.clear()
	for g in [road_group, branch_group, patch_group]:
		for m in g.get_children():
			var mi := m as MeshInstance3D
			if mi != null and mi.mesh != null and mi.mesh.get_surface_count() > 0:
				surface_grid.add_faces(mi.mesh.get_faces(), mi.transform, 0)


## The ground: a grid of heights. Under the road and its shoulders a little below the lowest road nearby, further away it follows
## the heights of the road around it (the nearer, the more), with gentle hills of its own where the shoulders end.
func _terrain(centre: Array, lo: Vector2, hi: Vector2, min_y: float) -> MeshInstance3D:
	var margin := 220.0
	var min_x := lo.x - margin
	var min_z := lo.y - margin
	var span := maxf(hi.x + margin - min_x, hi.y + margin - min_z)
	var cell := minf(10.0, maxf(4.0, span / 110.0))
	var nx := ceili((hi.x + margin - min_x) / cell) + 1
	var nz := ceili((hi.y + margin - min_z) / cell) + 1
	var bucket := 40.0
	var buckets := {}
	for p in centre:
		var k := Vector2i(floori(p[0] / bucket), floori(p[1] / bucket))
		if not buckets.has(k):
			buckets[k] = []
		buckets[k].append(p)
	var reach_max := 80.0
	var cells := ceili(reach_max / bucket)
	var tex := texture_of("ground")
	var tex_size := MeshKit.size_of(tex)
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	verts.resize(nx * nz)
	uvs.resize(nx * nz)
	var n := 0
	for j in nz:
		for i in nx:
			var x := min_x + i * cell
			var z := min_z + j * cell
			uvs[n] = Vector2(x / tex_size, z / tex_size)
			var wsum := 0.0
			var hsum := 0.0
			var nearest := INF
			var under := INF
			var bx := floori(x / bucket)
			var bz := floori(z / bucket)
			for dx in range(-cells, cells + 1):
				for dz in range(-cells, cells + 1):
					var list: Variant = buckets.get(Vector2i(bx + dx, bz + dz))
					if list == null:
						continue
					for p in list:
						var outside: float = Vector2(p[0] - x, p[1] - z).length() - p[3]
						if outside < nearest:
							nearest = outside
						if outside <= 0.5:
							under = minf(under, p[2])
						if outside < reach_max:
							var o := maxf(outside, 0.0)
							var w := 1.0 / (o * o * 0.02 + 1.0)
							wsum += w
							hsum += w * p[2]
			var y: float
			if under < INF:
				y = under - 0.35
			elif wsum > 0.0:
				var t := minf(1.0, nearest / reach_max)
				var near := hsum / wsum - 0.35
				var far := min_y - 1.0 + _noise(x, z) * 2.5
				var s := t * t * (3.0 - 2.0 * t)
				y = near * (1.0 - s) + far * s + _noise(x, z) * 1.2 * minf(1.0, nearest / 40.0)
			else:
				y = min_y - 1.0 + _noise(x, z) * 2.5
			verts[n] = Vector3(x, y, z)
			n += 1
	var idx := PackedInt32Array()
	for j in nz - 1:
		for i in nx - 1:
			var a := j * nx + i
			idx.append_array([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1])
	var mi := MeshInstance3D.new()
	mi.name = "ground"
	mi.mesh = MeshKit.build(verts, uvs, idx, MeshKit.textured(tex))
	mi.mesh.resource_name = "ground"
	mi.set_meta("role", "ground")
	return mi


static func _noise(x: float, z: float) -> float:
	var v := 0.0
	var amp := 1.0
	var f := 1.0 / 48.0
	for o in 2:
		v += amp * (sin(x * f * 1.7 + cos(z * f * 1.3)) * cos(z * f * 1.1 - sin(x * f * 0.7)))
		amp *= 0.5
		f *= 2.1
	return v


static func inside_ring(ring: Array, x: float, z: float) -> bool:
	var inside := false
	var j := ring.size() - 1
	for i in ring.size():
		var a: Vector3 = ring[i]
		var b: Vector3 = ring[j]
		if (a.z > z) != (b.z > z):
			var dz := b.z - a.z
			if absf(dz) < 1e-9:
				dz = 1e-9
			if x < (b.x - a.x) * (z - a.z) / dz + a.x:
				inside = not inside
		j = i
	return inside


# ---- the branches: data.branches [{ nodes: [{ x, z, width? }], width, start, end }]; start and end { road (-1 the track), u } or null

func _attach_point(a: Variant, lines: Array) -> Variant:
	if not (a is Dictionary):
		return null
	if int(a["road"]) < 0:
		if main_curve == null:
			return null
		return main_curve.point_at(clampf(float(a["u"]), 0.0, 1.0))
	var k := int(a["road"])
	var src: Array = lines if k < lines.size() else branch_lines
	if k >= src.size():
		return null
	var line: Array = src[k]["points"]
	if line.size() < 2:
		return null
	var f := clampf(float(a["u"]), 0.0, 1.0) * (line.size() - 1)
	var i := mini(line.size() - 2, floori(f))
	var t := f - i
	var q: Dictionary = line[i]
	var r: Dictionary = line[i + 1]
	return Vector3(q["x"] + (r["x"] - q["x"]) * t, q["y"] + (r["y"] - q["y"]) * t, q["z"] + (r["z"] - q["z"]) * t)


func nearest_road_y(x: float, z: float) -> float:
	var best := INF
	var y := 0.0
	for q in main_line:
		var d: float = (q["x"] - x) * (q["x"] - x) + (q["z"] - z) * (q["z"] - z)
		if d < best:
			best = d
			y = q["y"]
	return y


func build_branch_lines() -> Array:
	var lines: Array = []
	var branches: Array = data.get("branches", [])
	for k in branches.size():
		var b: Dictionary = branches[k]
		var nodes: Array = b["nodes"]
		if nodes.size() < 2:
			lines.append({"points": [], "index": k})
			continue
		var a: Variant = _attach_point(b.get("start"), lines)
		var e: Variant = _attach_point(b.get("end"), lines)
		if a != null:
			nodes[0]["x"] = r2(a.x)
			nodes[0]["z"] = r2(a.z)
		if e != null:
			nodes[-1]["x"] = r2(e.x)
			nodes[-1]["z"] = r2(e.z)
		var y0: float = a.y - 0.03 if a != null else nearest_road_y(float(nodes[0]["x"]), float(nodes[0]["z"]))
		var y1: float
		if e != null:
			y1 = e.y - 0.03
		else:
			y1 = y0 if a != null else nearest_road_y(float(nodes[-1]["x"]), float(nodes[-1]["z"]))
		var vectors := PackedVector3Array()
		for nd in nodes:
			vectors.append(Vector3(float(nd["x"]), 0, float(nd["z"])))
		var curve := CatmullRom.line(vectors[0], vectors[1]) if vectors.size() == 2 else CatmullRom.make(vectors)
		var length := curve.length()
		var count := maxi(2, ceili(length / BRANCH_STEP))
		var cum: Array[float] = [0.0]
		for i in range(1, nodes.size()):
			cum.append(cum[i - 1] + Vector2(float(nodes[i]["x"]) - float(nodes[i - 1]["x"]), float(nodes[i]["z"]) - float(nodes[i - 1]["z"])).length())
		var total: float = cum[-1] if cum[-1] > 0.0 else 1.0
		var points: Array = []
		for i in count + 1:
			var u := float(i) / count
			var t := curve.u_to_t(u)
			var p := curve.point(t)
			var tg := curve.tangent(t)
			tg.y = 0.0
			tg = tg.normalized()
			var s := u * u * (3.0 - 2.0 * u)
			var at := u * total
			var ii := 0
			while ii < cum.size() - 2 and cum[ii + 1] < at:
				ii += 1
			var seg := cum[ii + 1] - cum[ii]
			var f := clampf((at - cum[ii]) / (seg if seg != 0.0 else 1.0), 0.0, 1.0)
			var ss := f * f * (3.0 - 2.0 * f)
			var h0 := _half(nodes[ii], b)
			var h1 := _half(nodes[ii + 1], b)
			points.append({"x": p.x, "y": y0 + (y1 - y0) * s, "z": p.z, "w": h0 + (h1 - h0) * ss, "tangent": tg, "along": u * length})
		lines.append({"points": points, "index": k})
	branch_lines = lines
	return lines


static func _half(n: Dictionary, b: Dictionary) -> float:
	var w := float(n.get("width", 0))
	if w <= 0.0:
		w = float(b.get("width", 8))
	return maxf(2.0, w) / 2.0


func _host_at(attach: Dictionary, lines: Array, a: Dictionary, towards: Dictionary) -> Dictionary:
	var list: Array = main_line if int(attach["road"]) < 0 else (lines[int(attach["road"])]["points"] if int(attach["road"]) < lines.size() else [])
	if list.size() < 2:
		return {}
	var best := 0
	if int(attach["road"]) >= 0:
		best = clampi(roundi(float(attach["u"]) * (list.size() - 1)), 0, list.size() - 1)
	else:
		var best_d := INF
		for i in list.size():
			var d: float = (list[i]["x"] - a["x"]) ** 2 + (list[i]["z"] - a["z"]) ** 2
			if d < best_d:
				best_d = d
				best = i
	var q0: Dictionary = list[maxi(0, best - 1)]
	var q1: Dictionary = list[mini(list.size() - 1, best + 1)]
	var t := Vector2(q1["x"] - q0["x"], q1["z"] - q0["z"]).normalized()
	var n := Vector2(-t.y, t.x)
	if (towards["x"] - a["x"]) * n.x + (towards["z"] - a["z"]) * n.y < 0.0:
		n = -n
	return {"t": t, "n": n, "w": list[best]["w"], "y": list[best]["y"]}


func _join_step(attach: Variant, lines: Array, a: Dictionary, towards: Dictionary, e: float) -> float:
	if not (attach is Dictionary):
		return 0.0
	var host := _host_at(attach, lines, a, towards)
	if host.is_empty():
		return 0.0
	var tg: Vector3 = a["tangent"]
	var dx := e * tg.x
	var dz := e * tg.z
	var n: Vector2 = host["n"]
	var into := -(dx * n.x + dz * n.y)
	var reach := absf(tg.z * n.x - tg.x * n.y) * float(a["w"])
	var step := float(host["w"]) * 0.9
	if into > 1e-3:
		step = minf(step, (float(host["w"]) - 0.6 - reach) / into)
	return maxf(0.0, step)


func _branch_parts(lines: Array) -> Dictionary:
	var meshes: Array = []
	var rings: Array = []
	var built: Array = []
	branch_edges = []
	var branches: Array = data.get("branches", [])
	for line in lines:
		var pts: Array = line["points"]
		if pts.size() < 2:
			continue
		var b: Dictionary = branches[line["index"]]
		var last := pts.size() - 1
		var back := _join_step(b.get("start"), lines, pts[0], pts[mini(4, last)], -1.0)
		var fore := _join_step(b.get("end"), lines, pts[last], pts[maxi(0, last - 4)], 1.0)
		var left: Array = []
		var right: Array = []
		var tangents: Array = []
		var along: Array = []
		var add_row := func(c: Vector3, t: Vector3, s: float, w: float) -> void:
			var n := Vector3(t.z, 0, -t.x)
			left.append(c + n * w)
			right.append(c - n * w)
			tangents.append(t)
			along.append(s)
		var first: Dictionary = pts[0]
		var end: Dictionary = pts[last]
		if back > 0.0:
			add_row.call(Vector3(first["x"], first["y"], first["z"]) - first["tangent"] * back, first["tangent"], -back, first["w"])
		for q in pts:
			add_row.call(Vector3(q["x"], q["y"], q["z"]), q["tangent"], q["along"], q["w"])
		if fore > 0.0:
			add_row.call(Vector3(end["x"], end["y"], end["z"]) + end["tangent"] * fore, end["tangent"], end["along"] + fore, end["w"])
		unfold(left, tangents, false)
		unfold(right, tangents, false)
		var footprint: Array = left.duplicate()
		var rr: Array = right.duplicate()
		rr.reverse()
		footprint.append_array(rr)
		var st: Variant = b.get("start")
		var en: Variant = b.get("end")
		if (st is Dictionary and int(st["road"]) < 0) or (en is Dictionary and int(en["road"]) < 0):
			rings.append(footprint)
		var part := "branch_%d" % (int(line["index"]) + 1)
		var road := _strip(part, left, right, texture_of("road"), "road", along, true)
		road.set_meta("branch", line["index"])
		meshes.append(road)
		built.append({"line": line, "b": b, "pts": pts, "name": part, "left": left, "right": right, "along": along, "back": back, "footprint": footprint})
	for e in built:
		var off := 1 if e["back"] > 0.0 else 0
		var pts: Array = e["pts"]
		var count := pts.size()
		var inner_l: Array = (e["left"] as Array).slice(off, off + count)
		var inner_r: Array = (e["right"] as Array).slice(off, off + count)
		var outer_l: Array = []
		var outer_r: Array = []
		var tg: Array = []
		for q in pts:
			var t: Vector3 = q["tangent"]
			var n := Vector3(t.z, 0, -t.x)
			var c := Vector3(q["x"], q["y"] - 0.3, q["z"])
			outer_l.append(c + n * (float(q["w"]) + BRANCH_SHOULDER))
			outer_r.append(c - n * (float(q["w"]) + BRANCH_SHOULDER))
			tg.append(t)
		unfold(outer_l, tg, false)
		unfold(outer_r, tg, false)
		var joined: Array = []
		for o in built:
			var os: Variant = o["b"].get("start")
			var oe: Variant = o["b"].get("end")
			if (os is Dictionary and int(os["road"]) == int(e["line"]["index"])) or (oe is Dictionary and int(oe["road"]) == int(e["line"]["index"])):
				joined.append(o["footprint"])
		if not joined.is_empty():
			for pair in [[inner_l, outer_l], [inner_r, outer_r]]:
				for i in (pair[0] as Array).size():
					var q: Vector3 = pair[0][i]
					var far: Vector3 = pair[1][i]
					var d := Vector2(far.x - q.x, far.z - q.z).normalized() * 0.4
					for r in joined:
						if inside_ring(r, q.x + d.x, q.z + d.y):
							pair[0][i] = q - Vector3(0, 0.15, 0)
							break
		var al: Array = (e["along"] as Array).slice(off, off + count)
		var grass := texture_of("shoulder")
		var s1 := _strip(e["name"] + "_shoulder_1", outer_l, inner_l, grass, "grass", al, true)
		var s2 := _strip(e["name"] + "_shoulder_2", inner_r, outer_r, grass, "grass", al, true)
		s1.set_meta("branch", e["line"]["index"])
		s2.set_meta("branch", e["line"]["index"])
		meshes.append_array([s1, s2])
		branch_edges.append_array([{"pts": inner_l, "closed": false}, {"pts": inner_r, "closed": false}])
	return {"meshes": meshes, "rings": rings}


# ---- the edges of the roads (for a row of prefabs, a curb or a surface that connects to the road)

## The nearest place on the edge of the track or of a branch: { x, z, nx, nz (away from the road), d }, or {}.
func road_edge_at(x: float, z: float) -> Dictionary:
	var best := {}
	var sets: Array = []
	if road_edges.size() == 2:
		sets.append([road_edges[0], road_edges[1]])
		sets.append([road_edges[1], road_edges[0]])
	for i in range(0, branch_edges.size() - 1, 2):
		sets.append([branch_edges[i], branch_edges[i + 1]])
		sets.append([branch_edges[i + 1], branch_edges[i]])
	for s in sets:
		var pts: Array = s[0]["pts"]
		var other: Array = s[1]["pts"]
		var n := pts.size()
		var count := n if s[0]["closed"] else n - 1
		for i in count:
			var j := (i + 1) % n
			var a: Vector3 = pts[i]
			var b: Vector3 = pts[j]
			var dx := b.x - a.x
			var dz := b.z - a.z
			var l2 := dx * dx + dz * dz
			var t := clampf(((x - a.x) * dx + (z - a.z) * dz) / (l2 if l2 > 0.0 else 1e-9), 0.0, 1.0)
			var px := a.x + dx * t
			var pz := a.z + dz * t
			var d := Vector2(x - px, z - pz).length()
			if not best.is_empty() and d >= best["d"]:
				continue
			var oa: Vector3 = other[i]
			var ob: Vector3 = other[j]
			var nv := Vector2((a.x - oa.x) * (1 - t) + (b.x - ob.x) * t, (a.z - oa.z) * (1 - t) + (b.z - ob.z) * t).normalized()
			best = {"d": d, "x": px, "z": pz, "nx": nv.x, "nz": nv.y}
	return best


## Whether (x, z) is well inside a road (also 10 cm to every side of it).
func _deep(x: float, z: float) -> bool:
	for k in [Vector2.ZERO, Vector2(0.1, 0), Vector2(-0.1, 0), Vector2(0, 0.1), Vector2(0, -0.1)]:
		if not _on_road(x + k.x, z + k.y):
			return false
	return true


func _on_road(x: float, z: float) -> bool:
	if road_edges.size() == 2:
		var l: Array = road_edges[0]["pts"]
		var r: Array = road_edges[1]["pts"]
		if road_edges[0]["closed"]:
			if inside_ring(l, x, z) != inside_ring(r, x, z):
				return true
		else:
			var ring: Array = l.duplicate()
			var rr := r.duplicate()
			rr.reverse()
			ring.append_array(rr)
			if inside_ring(ring, x, z):
				return true
	for i in range(0, branch_edges.size() - 1, 2):
		var ring: Array = (branch_edges[i]["pts"] as Array).duplicate()
		var rr: Array = (branch_edges[i + 1]["pts"] as Array).duplicate()
		rr.reverse()
		ring.append_array(rr)
		if inside_ring(ring, x, z):
			return true
	return false


## The way along the nearest edge of a road from the edge point nearest to b to the one nearest to a (an area that connects to
## the road closes along it).
func _edge_path(a: Vector2, b: Vector2) -> Array:
	var all: Array = road_edges.duplicate()
	all.append_array(branch_edges)
	var pick := func(p: Vector2) -> Array:
		var best := [-1, -1, 60.0 * 60.0]
		for e in all.size():
			var pts: Array = all[e]["pts"]
			for i in pts.size():
				var d := Vector2(pts[i].x - p.x, pts[i].z - p.y).length_squared()
				if d < best[2]:
					best = [e, i, d]
		return best
	var na: Array = pick.call(a)
	var nb: Array = pick.call(b)
	if na[0] < 0 or nb[0] < 0 or na[0] != nb[0]:
		return []
	var pts: Array = all[na[0]]["pts"]
	var n := pts.size()
	var out: Array = []
	var from: int = nb[1]
	var to: int = na[1]
	var fwd := posmod(to - from, n)
	var step := 1
	var n_len := absi(to - from)
	if all[na[0]]["closed"]:
		step = 1 if fwd <= n - fwd else -1
		n_len = fwd if step == 1 else n - fwd
	elif to < from:
		step = -1
	for k in n_len + 1:
		var q: Vector3 = pts[posmod(from + k * step, n)]
		out.append(Vector2(q.x, q.z))
	return out


# ---- the surfaces: data.patches [{ surface, points: [{ x, z }], connect }]

func surface_of(key: String) -> Dictionary:
	if key.begins_with("c:"):
		for c in data.get("surfaces", []):
			if "c:" + str(c.get("id", "")) == key:
				var grips := GRIP_CHOICES.map(func(g: Array) -> String: return g[0])
				var tex := str(c.get("texture", ""))
				return {"label": str(c.get("label", "Surface")), "texture": tex if c.get("kind") == "texture" and MeshKit.TEXTURES.has(tex) else "",
					"colour": "" if c.get("kind") == "texture" else str(c.get("colour", "#8a7a5a")), "size": float(c.get("size", 0)),
					"role": str(c.get("grip")) if grips.has(str(c.get("grip"))) else "ground"}
	var built: Dictionary = PATCH_SURFACES.get(key, PATCH_SURFACES["gravel"]).duplicate()
	if key == "road":
		built["texture"] = texture_of("road")
	return built


func patch_outline(p: Dictionary) -> Dictionary:
	var poly: Array = []
	for q in p.get("points", []):
		poly.append(Vector2(float(q["x"]), float(q["z"])))
	var path: Array = []
	if p.get("connect", false) and poly.size() >= 2:
		path = _edge_path(poly[0], poly[-1])
	var all := poly.duplicate()
	all.append_array(path)
	return {"poly": all, "path": path}


static func _edge_distance(poly: Array, x: float, z: float) -> float:
	var best := INF
	for i in poly.size():
		var a: Vector2 = poly[i]
		var b: Vector2 = poly[(i + 1) % poly.size()]
		var d := b - a
		var t := clampf((Vector2(x, z) - a).dot(d) / maxf(d.length_squared(), 1e-9), 0.0, 1.0)
		best = minf(best, (Vector2(x, z) - a - d * t).length())
	return best


func _patch_mesh(p: Dictionary, index: int) -> MeshInstance3D:
	var points: Array = p.get("points", [])
	if points.size() < (2 if p.get("connect", false) else 3):
		return null
	var surface := surface_of(str(p.get("surface", "gravel")))
	var size: float = surface["size"] if float(surface.get("size", 0)) > 0.0 else (MeshKit.size_of(surface["texture"]) if surface["texture"] != "" else 4.0)
	var outline := patch_outline(p)
	var poly: Array = outline["poly"]
	var path: Array = outline["path"]
	var deep: bool = p.get("connect", false)
	if poly.size() < 3:
		return null
	var ground := func(x: float, z: float) -> float:
		return ground_y.call(x, z, INF) if ground_y.is_valid() else 0.0
	var highest := func(x: float, z: float) -> float:
		var r := 0.5
		return maxf(ground.call(x, z), maxf(maxf(ground.call(x + r, z), ground.call(x - r, z)), maxf(ground.call(x, z + r), ground.call(x, z - r))))
	var edge_heights: Array = path.map(func(q: Vector2) -> float: return highest.call(q.x, q.y))
	var heights := {}
	var height := func(x: float, z: float) -> float:
		var key := Vector2(snappedf(x, 0.001), snappedf(z, 0.001))
		if not heights.has(key):
			var y: float = highest.call(x, z)
			if not path.is_empty():
				var near := INF
				var at := 0
				for i in path.size():
					var d := (path[i] as Vector2).distance_to(Vector2(x, z))
					if d < near:
						near = d
						at = i
				var t := minf(1.0, near / 3.0)
				if edge_heights[at] > y:
					y += (edge_heights[at] - y) * (1.0 - t * t * (3.0 - 2.0 * t))
			heights[key] = ground.call(x, z) - 0.1 if deep and _deep(x, z) else y + 0.02 + 0.10 * minf(1.0, _edge_distance(poly, x, z))
		return heights[key]
	var contour := PackedVector2Array()
	for i in poly.size():
		if (poly[i] as Vector2).distance_to(poly[(i + poly.size() - 1) % poly.size()]) > 1e-4:
			contour.append(poly[i])
	if contour.size() < 3:
		return null
	var tri := Geometry2D.triangulate_polygon(contour)
	var stack: Array = []
	for t in tri.size() / 3:
		stack.append([contour[tri[3 * t]], contour[tri[3 * t + 1]], contour[tri[3 * t + 2]]])
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	while not stack.is_empty():
		var tr: Array = stack.pop_back()
		var a: Vector2 = tr[0]
		var b: Vector2 = tr[1]
		var c: Vector2 = tr[2]
		var sides := [[a.distance_to(b), a, b, c], [b.distance_to(c), b, c, a], [c.distance_to(a), c, a, b]]
		var longest: Array = sides[0]
		for s in sides:
			if s[0] > longest[0]:
				longest = s
		if longest[0] > 1.2:
			var mid: Vector2 = (longest[1] + longest[2]) / 2.0
			stack.append([longest[1], mid, longest[3]])
			stack.append([mid, longest[2], longest[3]])
			continue
		if deep and _deep(a.x, a.y) and _deep(b.x, b.y) and _deep(c.x, c.y):
			continue
		var order := [a, b, c] if (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0.0 else [a, c, b]
		for q in order:
			idx.append(verts.size())
			verts.append(Vector3(q.x, height.call(q.x, q.y), q.y))
			uvs.append(q / size)
	if verts.is_empty():
		return null
	var mat: Material = MeshKit.textured(surface["texture"]) if surface["texture"] != "" else MeshKit.colour_material(surface["colour"])
	var mi := MeshInstance3D.new()
	mi.name = "patch_%s_%d" % [str(p.get("surface", "gravel")).replace(":", "_"), index + 1]
	mi.mesh = MeshKit.build(verts, uvs, idx, mat)
	mi.mesh.resource_name = mi.name
	mi.set_meta("role", surface["role"])
	mi.set_meta("overlay", true)
	mi.set_meta("patch", index)
	return mi


func build_patches() -> void:
	for c in patch_group.get_children():
		c.free()
	var patches: Array = data.get("patches", [])
	for i in patches.size():
		var mi := _patch_mesh(patches[i], i)
		if mi != null:
			patch_group.add_child(mi)


# ---- the prefabs: data.prefabs [{ type, x, y, z, rotation, scale, texture } or { type, row: true, points, spacing, scale, attach, offset }]

## The ground under a point for a prefab: { y, normal }.
func surface_at(x: float, z: float) -> Dictionary:
	var q := surface_grid.query(x, z)
	return q if not q.is_empty() else {"y": 0.0, "normal": Vector3.UP}


func row_curve(p: Dictionary) -> CatmullRom:
	var pts := PackedVector3Array()
	for q in p["points"]:
		pts.append(Vector3(float(q["x"]), float(q.get("y", 0)), float(q["z"])))
	return null if pts.size() < 2 else CatmullRom.make(pts)


func _attach_row(p: Dictionary) -> void:
	if not p.get("row", false) or not p.get("attach", false):
		return
	for q in p["points"]:
		var e := road_edge_at(float(q["x"]), float(q["z"]))
		if e.is_empty():
			continue
		var off := float(q.get("offset", p.get("offset", 0)))
		q["x"] = r2(e["x"] + e["nx"] * off)
		q["z"] = r2(e["z"] + e["nz"] * off)
	snap_row(p)


func snap_row(p: Dictionary) -> void:
	for q in p["points"]:
		q["y"] = r2(surface_at(float(q["x"]), float(q["z"]))["y"])


## The offset of a node that is put on a row that is attached to the road: its distance from the edge now.
func start_node_offset(q: Dictionary) -> void:
	var e := road_edge_at(float(q["x"]), float(q["z"]))
	if not e.is_empty():
		q["offset"] = clampf(r2((float(q["x"]) - e["x"]) * e["nx"] + (float(q["z"]) - e["z"]) * e["nz"]), -6.0, 6.0)


func make_prefab(p: Dictionary, index: int) -> Node3D:
	var type := str(p.get("type", "wall"))
	var part := "prefab_%s_%d" % [type, index + 1]
	var tex := str(p.get("texture", ""))
	var g := Node3D.new()
	g.name = part
	g.set_meta("prefab", index)
	g.set_meta("role", DesignPrefabs.role(type))
	var sc := float(p.get("scale", 1))
	if sc <= 0.0:
		sc = 1.0
	if p.get("row", false):
		var curve := row_curve(p)
		var spacing := maxf(0.3, float(p.get("spacing", DesignPrefabs.SPACING.get(type, 4.0))))
		var copies: Array = []
		if curve != null:
			var length := curve.length()
			var count := clampi(floori(length / spacing) + 1, 1, 400)
			for k in count:
				var u := minf(1.0, (k * spacing) / length) if count > 1 else 0.0
				var pos := curve.point_at(u)
				var t := curve.tangent_at(u)
				var gr := surface_at(pos.x, pos.z)
				copies.append(Transform3D(DesignPrefabs.orient(gr["normal"], atan2(-t.z, t.x)).scaled_local(Vector3.ONE * sc), Vector3(pos.x, gr["y"], pos.z)))
		else:
			var q: Dictionary = p["points"][0]
			var gr := surface_at(float(q["x"]), float(q["z"]))
			copies.append(Transform3D(DesignPrefabs.orient(gr["normal"], 0.0).scaled_local(Vector3.ONE * sc), Vector3(float(q["x"]), gr["y"], float(q["z"]))))
		for mi in DesignPrefabs.merged(type, tex, copies, part):
			g.add_child(mi)
		g.set_meta("copies", copies.size())
	else:
		var gr := surface_at(float(p["x"]), float(p["z"]))
		p["y"] = r2(gr["y"])
		var turn := DesignPrefabs.orient(gr["normal"], float(p.get("rotation", 0))).scaled_local(Vector3.ONE * sc)
		g.transform = Transform3D(turn, Vector3(float(p["x"]), float(p["y"]), float(p["z"])))
		var body := DesignPrefabs.make(type, tex)
		for c in body.get_children():
			body.remove_child(c)
			c.name = part
			(c as MeshInstance3D).mesh.resource_name = part
			g.add_child(c, true)
		body.free()
	return g


func rebuild_prefabs() -> void:
	for c in prefab_group.get_children():
		c.free()
	var prefabs: Array = data.get("prefabs", [])
	for p in prefabs:
		_attach_row(p)
	for i in prefabs.size():
		prefab_group.add_child(make_prefab(prefabs[i], i))


## The roles of the parts, as track.json "surfaces" keeps them.
func roles() -> Dictionary:
	var r := {}
	for g in [road_group, branch_group, patch_group]:
		for m in g.get_children():
			r[str(m.name)] = str(m.get_meta("role", "scenery"))
	for g in prefab_group.get_children():
		r[str(g.name)] = str(g.get_meta("role", "scenery"))
	return r


func to_json() -> Dictionary:
	return data.duplicate(true)


# ---- the glb

## The triangles that lie wholly under another part (above it by more than HIDDEN_MIN and less than HIDDEN_MAX: not under a
## bridge) are left out of the glb: the game would test them for nothing. Gives { mesh instance: its new mesh }.
func _without_hidden() -> Dictionary:
	var meshes: Array[MeshInstance3D] = []
	for g in [road_group, branch_group, patch_group]:
		for m in g.get_children():
			if m is MeshInstance3D and (m as MeshInstance3D).mesh.get_surface_count() > 0:
				meshes.append(m)
	var tris := PackedVector3Array()
	var owner_of := PackedInt32Array()
	var cells := {}
	var parts: Array = []
	for mi_i in meshes.size():
		var arrays := meshes[mi_i].mesh.surface_get_arrays(0)
		var pos: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		var first := owner_of.size()
		for k in idx.size() / 3:
			var a := pos[idx[3 * k]]
			var b := pos[idx[3 * k + 1]]
			var c := pos[idx[3 * k + 2]]
			var t := owner_of.size()
			tris.append_array([a, b, c])
			owner_of.append(mi_i)
			for i in range(floori(minf(a.x, minf(b.x, c.x)) / HIDDEN_CELL), floori(maxf(a.x, maxf(b.x, c.x)) / HIDDEN_CELL) + 1):
				for j in range(floori(minf(a.z, minf(b.z, c.z)) / HIDDEN_CELL), floori(maxf(a.z, maxf(b.z, c.z)) / HIDDEN_CELL) + 1):
					var key := Vector2i(i, j)
					if not cells.has(key):
						cells[key] = PackedInt32Array()
					var l: PackedInt32Array = cells[key]
					l.append(t)
					cells[key] = l
		parts.append({"arrays": arrays, "first": first})
	var covered := func(x: float, z: float, y: float, own: int) -> bool:
		var list: Variant = cells.get(Vector2i(floori(x / HIDDEN_CELL), floori(z / HIDDEN_CELL)))
		if list == null:
			return false
		for t in (list as PackedInt32Array):
			if owner_of[t] == own:
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
			var h := wa * a.y + wb * b.y + wc * c.y - y
			if h > HIDDEN_MIN and h < HIDDEN_MAX:
				return true
		return false
	var result := {}
	for mi_i in meshes.size():
		var arrays: Array = parts[mi_i]["arrays"]
		var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		var keep := PackedInt32Array()
		for k in idx.size() / 3:
			var t: int = parts[mi_i]["first"] + k
			var a := tris[3 * t]
			var b := tris[3 * t + 1]
			var c := tris[3 * t + 2]
			var edge := maxf(Vector2(b.x - a.x, b.z - a.z).length(), maxf(Vector2(c.x - b.x, c.z - b.z).length(), Vector2(a.x - c.x, a.z - c.z).length()))
			var n := maxi(1, ceili(edge / HIDDEN_STEP))
			var hidden := true
			for i in n + 1:
				for j in n - i + 1:
					var wa := float(i) / n
					var wb := float(j) / n
					var wc := 1.0 - wa - wb
					var p := a * wa + b * wb + c * wc
					if not covered.call(p.x, p.z, p.y, mi_i):
						hidden = false
						break
				if not hidden:
					break
			if not hidden:
				keep.append_array([idx[3 * k], idx[3 * k + 1], idx[3 * k + 2]])
		if keep.size() == idx.size():
			continue
		var out := ArrayMesh.new()
		if not keep.is_empty():
			arrays[Mesh.ARRAY_INDEX] = keep
			out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			out.surface_set_material(0, meshes[mi_i].mesh.surface_get_material(0))
		out.resource_name = meshes[mi_i].mesh.resource_name
		result[meshes[mi_i]] = out
	return result


## Writes the glb of the track: the road, the branches, the surfaces and the prefabs, named so that the game knows what they are.
func export_glb(path: String) -> Error:
	var cut := _without_hidden()
	var root := Node3D.new()
	root.name = "track"
	for g in [road_group, branch_group, patch_group, prefab_group]:
		var copy := Node3D.new()
		copy.name = g.name
		root.add_child(copy)
		for m in g.get_children():
			var c := m.duplicate() as Node3D
			if cut.has(m):
				if (cut[m] as ArrayMesh).get_surface_count() == 0:
					c.free()
					continue
				(c as MeshInstance3D).mesh = cut[m]
			copy.add_child(c, true)
	var doc := GLTFDocument.new()
	doc.image_format = "JPEG"
	doc.lossy_quality = 0.9
	doc.root_node_mode = GLTFDocument.ROOT_NODE_MODE_MULTI_ROOT
	var state := GLTFState.new()
	var err := doc.append_from_scene(root, state)
	if err == OK:
		err = doc.write_to_filesystem(state, path)
	root.free()
	return err
