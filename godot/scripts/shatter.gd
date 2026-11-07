class_name Shatter
extends Node3D
## The pieces and the particles of a part that breaks (web/js/Shatter.js): a part of the mode "breakable" (car.json
## "parts", CarParts) is gone at once, and in its place there are its pieces, each a rigid piece of the part (a cluster
## of the faces of its meshes, or a piece of the hidden object <name>_broken of the model), and a cloud of small
## particles of a material (glass, a lamp, plastic, chrome). The pieces fly off with the speed of the car and a little
## more, turn, bounce off the walls and the road, come to lie flat, lie a while and shrink away; the particles fly,
## fall and lie a while (Specks).
##
## The pieces move by a simple physics of their own (gravity, drag, the road under them, a ray for the walls): that is
## cheap for many of them. One Shatter per scene (Shatter.of).
##
## car.json "shatter": {pieces: "faces" | "mesh" | "none", max_pieces: 40, particles: 120, particle: "shards" |
## "splinters" | "grains", material: glass, tinted, red, orange, white, black, chrome, colour: "#rrggbb", size: 0.012}

const MAX_PIECES := 400
const LIE := 7.0
const SHRINK := 1.0
const COLOURS := {"glass": [0.86, 0.93, 1.0, 1.5], "tinted": [0.28, 0.32, 0.36, 1.0], "red": [0.85, 0.06, 0.04, 1.0],
	"orange": [1.0, 0.5, 0.08, 1.0], "white": [0.93, 0.93, 0.9, 1.0], "black": [0.05, 0.05, 0.055, 1.0], "chrome": [0.82, 0.83, 0.86, 1.3]}
const SHAPES := {"shards": 0, "splinters": 1, "grains": 2}

var specks: Specks
var _pieces: Array = []             # {mesh, p, q, s, v, w, age, life, lying, settle, from, to, flat, half, radius, landed}


## The one of the scene of node (made when it is first asked for).
static func of(node: Node) -> Shatter:
	var tree := node.get_tree()
	if tree == null:
		return null
	var s := tree.get_first_node_in_group("shatter") as Shatter
	if s == null:
		s = Shatter.new()
		s.name = "Shatter"
		s.add_to_group("shatter")
		s.add_to_group("clear_at_start")
		var top := tree.current_scene if tree.current_scene != null else tree.root
		top.add_child(s)
	return s


func _init() -> void:
	specks = Specks.new(4000)
	specks.drag = 0.6
	specks.bounce_walls = true
	specks.lie_from = 6.0
	specks.lie_more = 8.0
	add_child(specks)


## The colour of the particles of a spec ("colour" goes before "material"), linear.
static func colour_of(sh: Dictionary) -> Color:
	var hex := str(sh.get("colour", ""))
	if hex.length() >= 6 and Color.html_is_valid(hex):
		return Color.html(hex).srgb_to_linear()
	var c: Array = COLOURS.get(str(sh.get("material", "glass")), COLOURS["glass"])
	return Color(c[0], c[1], c[2]).srgb_to_linear() * float(c[3])


## The pieces of a part that breaks: the faces of its meshes ([{xf (world), mesh, mats (per surface)}]), in at most
## max_pieces clusters (by material, the nearest faces together); by_mesh: every mesh is a piece of its own, and a
## single mesh is cut where it falls apart (its islands). Each piece: {mesh: ArrayMesh, centre (world), flat, half,
## radius}.
static func pieces_of(meshes: Array, max_pieces: int, by_mesh: bool) -> Array:
	var buckets := {}               # material -> [units]; a unit: {tris: [[a, b, c, na, nb, nc, ua, ub, uc]], centre}
	var total := 0
	for entry: Dictionary in meshes:
		var mesh: Mesh = entry["mesh"]
		var xf: Transform3D = entry["xf"]
		var nb := xf.basis.inverse().transposed()
		for si in mesh.get_surface_count():
			if mesh is ArrayMesh and (mesh as ArrayMesh).surface_get_primitive_type(si) != Mesh.PRIMITIVE_TRIANGLES:
				continue
			var mat: Material = entry["mats"][si] if si < (entry["mats"] as Array).size() else null
			var arrays := mesh.surface_get_arrays(si)
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
			var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV] if arrays[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
			var index: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			var n := index.size() if not index.is_empty() else verts.size()
			var tris: Array = []
			for t in range(0, n - 2, 3):
				var ids := [index[t], index[t + 1], index[t + 2]] if not index.is_empty() else [t, t + 1, t + 2]
				var tri := []
				for k in 3:
					tri.append(xf * verts[ids[k]])
				for k in 3:
					tri.append((nb * normals[ids[k]]).normalized() if not normals.is_empty() else Vector3.ZERO)
				for k in 3:
					tri.append(uvs[ids[k]] if not uvs.is_empty() else Vector2.ZERO)
				tris.append(tri)
			if tris.is_empty():
				continue
			var units: Array = []
			if not by_mesh:
				for tri in tris:
					units.append({"tris": [tri]})
			elif meshes.size() > 1:
				units.append({"tris": tris})
			else:
				units = _islands(tris)
			var key: Variant = mat if mat != null else "none"
			if not buckets.has(key):
				buckets[key] = []
			buckets[key].append_array(units)
			total += units.size()
	var out: Array = []
	for key: Variant in buckets:
		var units: Array = buckets[key]
		for u: Dictionary in units:
			u["centre"] = _centre(u["tris"])
		var budget := maxi(1, roundi(max_pieces * units.size() / float(maxi(1, total))))
		for tris in _clusters(units, budget):
			out.append(_piece(tris, key as Material if key is Material else null))
	return out


static func _centre(tris: Array) -> Vector3:
	var c := Vector3.ZERO
	for t in tris:
		c += t[0] + t[1] + t[2]
	return c / maxf(1.0, tris.size() * 3.0)


## The parts of a mesh that hang together (by the places of their corners).
static func _islands(tris: Array) -> Array:
	var parent := range(tris.size())
	var owner := {}
	var find := func(i: int) -> int:
		while parent[i] != i:
			parent[i] = parent[parent[i]]
			i = parent[i]
		return i
	for i in tris.size():
		for k in 3:
			var p: Vector3 = tris[i][k]
			var key := Vector3i(roundi(p.x * 2000), roundi(p.y * 2000), roundi(p.z * 2000))
			if not owner.has(key):
				owner[key] = i
			else:
				var r1: int = find.call(i)
				var r2: int = find.call(owner[key])
				if r1 != r2:
					parent[r1] = r2
	var by_root := {}
	for i in tris.size():
		var r: int = find.call(i)
		if not by_root.has(r):
			by_root[r] = []
		by_root[r].append(tris[i])
	var out: Array = []
	for r: int in by_root:
		out.append({"tris": by_root[r]})
	return out


## The units in at most n groups: n of them spread over the list are the seeds, and every unit goes to the nearest.
static func _clusters(units: Array, n: int) -> Array:
	var out: Array = []
	if units.size() <= n:
		for u: Dictionary in units:
			out.append(u["tris"])
		return out
	var seeds: Array[Vector3] = []
	var step := units.size() / float(n)
	for i in n:
		seeds.append(units[floori(i * step)]["centre"])
	for i in n:
		out.append([])
	for u: Dictionary in units:
		var best := 0
		var bd := INF
		var c: Vector3 = u["centre"]
		for k in seeds.size():
			var d := c.distance_squared_to(seeds[k])
			if d < bd:
				bd = d
				best = k
		out[best].append_array(u["tris"])
	return out.filter(func(g: Array) -> bool: return not g.is_empty())


static func _piece(tris: Array, mat: Material) -> Dictionary:
	var centre := _centre(tris)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var flat := Vector3.ZERO
	var has_normals := true
	for t in tris:
		for k in 3:
			var n: Vector3 = t[3 + k]
			if n == Vector3.ZERO:
				has_normals = false
			else:
				st.set_normal(n)
			st.set_uv(t[6 + k])
			st.add_vertex(t[k] - centre)
		var f: Vector3 = (t[1] - t[0]).cross(t[2] - t[0])
		if flat.dot(f) < 0.0:
			f = -f                   # (both sides of a thin piece point the same way)
		flat += f
	if not has_normals:
		st.generate_normals()
	if mat != null:
		st.set_material(mat)
	var mesh := st.commit()
	flat = flat.normalized() if flat.length_squared() > 1e-12 else Vector3.UP
	var half := 0.0
	var radius := 0.0
	for t in tris:
		for k in 3:
			var p: Vector3 = t[k] - centre
			half = maxf(half, absf(p.dot(flat)))
			radius = maxf(radius, p.length())
	return {"mesh": mesh, "centre": centre, "flat": flat, "half": maxf(0.002, half), "radius": maxf(0.01, radius)}


## A piece out in the world: where its middle is, its speed and spin (world, rad/s).
func piece(look: Dictionary, velocity: Vector3, spin: Vector3) -> void:
	if _pieces.size() >= MAX_PIECES:
		_remove(0)
	var mi := MeshInstance3D.new()
	mi.mesh = look["mesh"]
	add_child(mi)
	var p := {"mesh": mi, "p": look["centre"], "q": Quaternion.IDENTITY, "s": 1.0, "v": velocity, "w": spin, "age": 0.0,
		"life": LIE + (_pieces.size() % 7) * 0.4, "lying": false, "settle": 0.0, "from": Quaternion.IDENTITY, "to": Quaternion.IDENTITY,
		"flat": look["flat"], "half": look["half"], "radius": look["radius"], "landed": 0}
	_pieces.append(p)
	_place(p)


func _remove(i: int) -> void:
	(_pieces[i]["mesh"] as Node).queue_free()
	_pieces.remove_at(i)


func _place(p: Dictionary) -> void:
	var shrink := maxf(0.0, 1.0 - (p["age"] - p["life"]) / SHRINK) if p["lying"] and p["age"] > p["life"] else 1.0
	(p["mesh"] as MeshInstance3D).global_transform = Transform3D(Basis(p["q"] as Quaternion).scaled(Vector3.ONE * p["s"] * shrink), p["p"])


## count particles from a place (within spread metres of it), with the speed of the car and some of their own; shape
## 0 shards, 1 splinters, 2 grains; colour linear; size in metres.
func burst(at: Vector3, v: Vector3, count: int, shape: int, colour: Color, size: float, spread: float) -> void:
	var floor_y := _floor_at(at)
	for n in mini(600, count):
		var o := Vector3((randf() - 0.5) * 2.0 * spread, (randf() - 0.5) * spread, (randf() - 0.5) * 2.0 * spread)
		var out := 0.8 + randf() * 2.6
		var d := o.normalized() if o.length() > 1e-6 else Vector3.UP
		var vel := Vector3(v.x + d.x * out + randf() - 0.5, v.y + 0.6 + randf() * 1.8, v.z + d.z * out + randf() - 0.5)
		var shade := 0.75 + randf() * 0.5
		specks.add(at + o, vel, Color(colour.r * shade, colour.g * shade, colour.b * shade, 1.0), size * (0.5 + randf()), shape, randf() * TAU,
			1.5 + randf(), floor_y)


func _floor_at(p: Vector3) -> float:
	if not is_inside_tree():
		return p.y - 1.2
	var hit := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(p + Vector3.UP * 0.3, p + Vector3.DOWN * 1.5, 1))
	return float(hit["position"].y) if not hit.is_empty() else p.y - 1.2


func _process(delta: float) -> void:
	delta = clampf(delta, 0.0, 0.05)
	if delta <= 0.0:
		return
	var space := get_world_3d().direct_space_state
	specks.step(delta, space)
	var drag := exp(-0.25 * delta)
	for i in range(_pieces.size() - 1, -1, -1):
		var p: Dictionary = _pieces[i]
		p["age"] += delta
		if p["lying"] and p["age"] > p["life"] + SHRINK:
			_remove(i)
			continue
		if not p["lying"]:
			var v: Vector3 = p["v"] * drag + Vector3.DOWN * 9.81 * delta
			var pos: Vector3 = p["p"]
			var reach: float = maxf(0.01, p["radius"] * p["s"] * 0.3)
			var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(pos, pos + v * delta + v.normalized() * reach, 1)) \
				if v.length_squared() > 1e-8 else {}
			if not hit.is_empty() and absf(hit["normal"].y) <= 0.7:
				# (a wall in the way: it bounces off it, a little, slowed; it does not go through)
				var n: Vector3 = hit["normal"]
				if v.dot(n) > 0.0:
					n = -n
				pos = hit["position"] + n * reach
				v = (v - n * (1.3 * v.dot(n))) * Vector3(0.6, 0.8, 0.6)
				p["w"] *= 0.5
			else:
				pos += v * delta
			var wl: float = (p["w"] as Vector3).length()
			if wl > 1e-4:
				p["q"] = (Quaternion((p["w"] as Vector3) / wl, wl * delta) * (p["q"] as Quaternion)).normalized()
			var ground := _floor_at(pos)
			var touch: float = maxf(0.01, p["radius"] * p["s"] * 0.45)
			if pos.y - ground < touch and v.y < 0.0:
				p["landed"] += 1
				if p["landed"] >= 3 or absf(v.y) < 1.2:
					# it lies down: turned flat (its own flat side up or down, whichever is nearer), on the road
					p["lying"] = true
					p["settle"] = 0.0
					p["from"] = p["q"]
					var fn: Vector3 = (p["q"] as Quaternion) * (p["flat"] as Vector3)
					if fn.y < 0.0:
						fn = -fn
					p["to"] = (Quaternion(fn, Vector3.UP) * (p["q"] as Quaternion)).normalized()
					pos.y = ground + p["half"] * p["s"] + 0.002
					v = Vector3.ZERO
					p["w"] = Vector3.ZERO
					p["life"] = maxf(p["life"], p["age"] + LIE * 0.6)
				else:
					pos.y = ground + touch
					v = Vector3(v.x * 0.55, -v.y * 0.3, v.z * 0.55)
					p["w"] *= 0.5
			p["p"] = pos
			p["v"] = v
		elif p["settle"] < 1.0:
			p["settle"] = minf(1.0, p["settle"] + delta / 0.12)
			p["q"] = (p["from"] as Quaternion).slerp(p["to"], p["settle"])
		_place(p)


## All gone (the car is put back at the start).
func clear() -> void:
	while not _pieces.is_empty():
		_remove(_pieces.size() - 1)
	specks.clear()


func count() -> Dictionary:
	return {"pieces": _pieces.size(), "particles": specks.count_air()}
