class_name Curbs
extends RefCounted
## The curbstones drawn in the track editor (web/js/Curbs.js): a strip of red and white (or another colour) on the ground
## along a smooth line through its nodes. track.json "curbs": [{ nodes: [[x, y, z, size, offset], ...], width, height, colour,
## points }]. The nodes are what the editor changes; points is the line through them about every half metre with the height
## of the ground under its left edge, its middle and its right edge and its size there ([x, z, yLeft, yMiddle, yRight, size]),
## found by the editor, so that the game builds the same strip without looking for the ground. Both ends slope up from the
## ground. In the game a curb is road, a few centimetres high.

const STEP := 0.5                   # metres between two points of the line
const STRIPE := 1.0                 # metres of one stripe
const RAMP := 1.2                   # metres over which an end rises from the ground to its height
const DEFAULTS := {"width": 1.2, "height": 0.05, "colour": "red"}
const COLOURS := {
	"red": Color(0.82, 0.12, 0.1), "blue": Color(0.1, 0.32, 0.8), "green": Color(0.12, 0.55, 0.22),
	"yellow": Color(0.95, 0.75, 0.1), "black": Color(0.08, 0.08, 0.08),
}
const WHITE := Color(0.94, 0.94, 0.92)


## The size of a node (0 to 1.5; left out: 1).
static func size_of(node: Array) -> float:
	if node.size() > 3 and (node[3] is float or node[3] is int):
		return clampf(float(node[3]), 0.0, 1.5)
	return 1.0


## The line through the nodes (two at least): { x, z, sx, sz (the unit vector to its left), size, segment }, about every STEP
## metres; every piece between two nodes is sampled on its own.
static func line_of(nodes: Array) -> Array:
	var out: Array = []
	if nodes.size() < 2:
		return out
	var vectors := PackedVector3Array()
	for n in nodes:
		vectors.append(Vector3(float(n[0]), 0.0, float(n[2])))
	var curve := CatmullRom.line(vectors[0], vectors[1]) if nodes.size() == 2 else CatmullRom.make(vectors)
	var pieces := nodes.size() - 1
	for i in pieces:
		var count := maxi(1, ceili(vectors[i].distance_to(vectors[i + 1]) / STEP))
		var a := size_of(nodes[i])
		var b := size_of(nodes[i + 1])
		var k := 0
		while k < count or (i == pieces - 1 and k == count):
			var u := (i + float(k) / count) / pieces
			var p := curve.point(u)
			var t := curve.tangent(u)
			var l := Vector2(t.x, t.z).length()
			if l == 0.0:
				l = 1.0
			var f := float(k) / count
			out.append({"x": p.x, "z": p.z, "sx": t.z / l, "sz": -t.x / l, "size": a + (b - a) * f, "segment": mini(i, pieces - 1)})
			k += 1
	return out


## The points of a curb as they are saved: the line and the ground under it. ground: Callable(x, z, hint) -> y.
static func points_of(curb: Dictionary, ground: Callable) -> Array:
	var half := float(curb.get("width", DEFAULTS["width"])) / 2.0
	var nodes: Array = curb.get("nodes", [])
	var hint := float(nodes[0][1]) if not nodes.is_empty() else 0.0
	var out: Array = []
	for p in line_of(nodes):
		var y_mid: float = ground.call(p["x"], p["z"], hint)
		var w: float = half * maxf(0.05, p["size"])
		hint = y_mid
		out.append([_r(p["x"]), _r(p["z"]), _r(ground.call(p["x"] + p["sx"] * w, p["z"] + p["sz"] * w, y_mid)), _r(y_mid),
			_r(ground.call(p["x"] - p["sx"] * w, p["z"] - p["sz"] * w, y_mid)), _r(p["size"])])
	return out


static func _r(v: float) -> float:
	return roundf(v * 1000.0) / 1000.0


## The strip of a curb from its points, with the colours of its stripes; null with fewer than two points.
static func mesh_of(curb: Dictionary) -> ArrayMesh:
	var points: Array = []
	for p in curb.get("points", []):
		if p is Array and p.size() >= 5:
			points.append(p)
	if points.size() < 2:
		return null
	var half := (float(curb["width"]) if float(curb.get("width", 0)) > 0.0 else DEFAULTS["width"]) / 2.0
	var height := float(curb["height"]) if float(curb.get("height", -1)) >= 0.0 else DEFAULTS["height"]
	var colour: Color = COLOURS.get(str(curb.get("colour", "red")), COLOURS["red"])
	var along := PackedFloat64Array([0.0])
	for i in range(1, points.size()):
		along.append(along[i - 1] + Vector2(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]).length())
	var total := along[along.size() - 1]
	var ramp := minf(RAMP, total / 2.0)
	var across := [[-1.0, 0.0], [-0.6, 1.0], [0.6, 1.0], [1.0, 0.0]]
	var rows: Array = []
	for i in points.size():
		var p: Array = points[i]
		var a: Array = points[maxi(0, i - 1)]
		var b: Array = points[mini(points.size() - 1, i + 1)]
		var tx: float = b[0] - a[0]
		var tz: float = b[1] - a[1]
		var len := Vector2(tx, tz).length()
		if len == 0.0:
			len = 1.0
		var sx := tz / len
		var sz := -tx / len
		var size := maxf(0.0, float(p[5])) if p.size() > 5 else 1.0
		var lift := height * size * (_smooth(minf(along[i], total - along[i]) / ramp) if ramp > 0.0 else 1.0)
		var row: Array = []
		for c in across:
			var s: float = c[0]
			var ground: float = p[3] + (p[2] - p[3]) * -s if s < 0.0 else p[3] + (p[4] - p[3]) * s
			row.append(Vector3(p[0] - sx * half * size * s, ground + 0.012 + lift * c[1], p[1] - sz * half * size * s))
		rows.append(row)
	var verts := PackedVector3Array()
	var cols := PackedColorArray()
	for j in rows.size() - 1:
		var c := colour if int(floor((along[j] + along[j + 1]) / 2.0 / STRIPE)) % 2 == 0 else WHITE
		for k in across.size() - 1:
			var a0: Vector3 = rows[j][k]
			var a1: Vector3 = rows[j][k + 1]
			var b0: Vector3 = rows[j + 1][k]
			var b1: Vector3 = rows[j + 1][k + 1]
			for v in [a0, b0, a1, a1, b0, b1]:
				verts.append(v)
				cols.append(c)
	# the triangles face up: which side is left depends on the way the curb was drawn (Godot's front faces are clockwise)
	var flip := false
	for t in range(0, verts.size() - 2, 3):
		var ax := verts[t + 1].x - verts[t].x
		var az := verts[t + 1].z - verts[t].z
		var bx := verts[t + 2].x - verts[t].x
		var bz := verts[t + 2].z - verts[t].z
		var cross := az * bx - ax * bz
		if absf(cross) > 1e-9:
			flip = cross > 0.0
			break
	if flip:
		for t in range(0, verts.size() - 2, 3):
			var v := verts[t + 1]
			verts[t + 1] = verts[t + 2]
			verts[t + 2] = v
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in verts.size():
		st.set_color(cols[i])
		st.add_vertex(verts[i])
	st.generate_normals()
	return st.commit()


static func _smooth(v: float) -> float:
	v = clampf(v, 0.0, 1.0)
	return v * v * (3.0 - 2.0 * v)


static func material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 0.75
	return m


## The meshes of the curbs of a track (track.json "curbs"), each named curb_<n>.
static func meshes(curbs: Variant) -> Array[MeshInstance3D]:
	var out: Array[MeshInstance3D] = []
	if not (curbs is Array):
		return out
	var mat := material()
	for i in curbs.size():
		if not (curbs[i] is Dictionary):
			continue
		var mesh := mesh_of(curbs[i])
		if mesh == null:
			continue
		var mi := MeshInstance3D.new()
		mi.name = "curb_%d" % (i + 1)
		mi.mesh = mesh
		mi.material_override = mat
		mi.set_meta("surface", "road")
		out.append(mi)
	return out
