class_name TrackEditorMarkers
extends Node3D
## What the track editor draws over the track (track-editor.js updateMarkers): the boxes of the grid (box 1 yellow) and of the
## pit, the pit line, the gates (the finish line green), the cinematic cameras and their range, the drag strip with its marks,
## the racing line, the curbs' nodes, the nodes of the road and what is chosen. Lines and areas are 3D (on top of the track); the
## nodes, the numbers and the arrows are drawn on an overlay of the view in pixels, so that they keep one size on the screen and
## a click finds them.

const DRAG_MARKS := [["60 ft", 18.288], ["330 ft", 100.584], ["1/8 mile", 201.168], ["1000 ft", 304.8], ["1/4 mile", 402.336],
	["1/2 mile", 804.672], ["1 km", 1000.0], ["1 mile", 1609.344]]
const BOX_W := 2.4
const BOX_L := 5.0
const PIT_W := 4.0
const PIT_L := 8.0
const RING := 58.0                  # px: the ring of the handles that turns
const CHOSEN := Color("ff8a3d")

static var _flat_cache := {}

var ed: TrackEditor
var overlay: Control
var dots: Array = []                # { p, r, color, kind, i, node }
var labels: Array = []              # { p, text, color }
var arrows: Array = []              # { p, heading, px, color }
var stroke: Array = []              # the line of a row that is being drawn (Vector2)
var _lines: ImmediateMesh
var _areas: Node3D
var _ref: MeshInstance3D = null



func _init(editor: TrackEditor) -> void:
	ed = editor
	name = "Markers"
	_lines = ImmediateMesh.new()
	var mi := MeshInstance3D.new()
	mi.mesh = _lines
	mi.material_override = _line_material()
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	_areas = Node3D.new()
	add_child(_areas)
	overlay = Control.new()
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.draw.connect(_draw_overlay)
	ed.view_box.add_child(overlay)


static func _line_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.no_depth_test = true
	m.render_priority = 10
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return m


## A material of one colour without light (on_top: over the track, whatever is in front).
static func flat(c: Color, alpha: float, on_top := true) -> StandardMaterial3D:
	var key := "%s:%s:%s" % [c.to_html(false), alpha, on_top]
	if not _flat_cache.has(key):
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.albedo_color = Color(c, alpha)
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		if alpha < 1.0:
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.no_depth_test = on_top
		m.render_priority = 5 if on_top else 0
		_flat_cache[key] = m
	return _flat_cache[key]


func screen_of(p: Vector3) -> Variant:
	if ed.camera.is_position_behind(p):
		return null
	return ed.camera.unproject_position(p)


# ---- made again at every change

func rebuild() -> void:
	dots.clear()
	labels.clear()
	arrows.clear()
	_lines.clear_surfaces()
	for c in _areas.get_children():
		c.free()
	_lines.surface_begin(Mesh.PRIMITIVE_LINES)
	_seg(Vector3.ZERO, Vector3.ZERO, Color(0, 0, 0, 0))     # (a surface needs a vertex)
	var k := ed.marker_scale
	var sk: String = ed.sel["kind"]
	var si: int = ed.sel["i"]
	# the grid: a box per place on the road, box 1 (the start) yellow with a long arrow, the others white, each with its number
	for i in ed.grid.size():
		var b: Dictionary = ed.grid[i]
		var colour := CHOSEN if sk == "grid" and si == i else (Color("ffd04d") if i == 0 else Color.WHITE)
		_loop(_box_corners(b, BOX_L, BOX_W), float(b.get("y", 0)) + 0.08, colour)
		arrows.append({"p": _v(b), "heading": float(b["heading"]), "px": 60.0 if i == 0 else 40.0, "color": colour})
		labels.append({"p": _v(b) + Vector3(0, 1.2 * k, 0), "text": str(i + 1), "color": colour})
	for i in ed.pit_boxes.size():
		var b: Dictionary = ed.pit_boxes[i]
		var corners := _box_corners(b, PIT_L, PIT_W)
		_fill(corners, float(b.get("y", 0)) + 0.07, Color("ffd23c"), 0.35)
		_loop(corners, float(b.get("y", 0)) + 0.09, CHOSEN if sk == "pit" and si == i else Color("ffe066"))
		arrows.append({"p": _v(b), "heading": float(b["heading"]), "px": 40.0, "color": Color("ffd04d")})
		labels.append({"p": _v(b) + Vector3(0, 1.2 * k, 0), "text": str(i + 1), "color": Color("ffd04d")})
	_pit_line()
	if ed.pit_polygon.size() >= 2:
		var ring: Array = []
		for q in ed.pit_polygon:
			ring.append(Vector3(float(q[0]), ed.ground_y(float(q[0]), float(q[1])) + 0.1, float(q[1])))
		_polyline(ring, Color("9cc8ff"), true)
	for i in ed.gates.size():
		_gate(i, sk == "gate" and si == i)
	for i in ed.cameras.size():
		_camera(i, sk == "camera" and si == i)
	_drag_strip()
	_racing_line()
	_curb_nodes()
	_design()
	if sk == "object" and si < ed.objects.size():
		_wire_box(ed.parts_kit.object_box(si), Color("ffd04d"))
	_measure()
	if not stroke.is_empty():
		var pts: Array = stroke.map(func(q: Vector2) -> Vector3: return Vector3(q.x, ed.ground_y(q.x, q.y) + 0.3, q.y))
		_polyline(pts, Color("ffd04d"), false)
	_lines.surface_end()
	overlay.queue_redraw()


func _v(q: Dictionary) -> Vector3:
	return Vector3(float(q["x"]), float(q.get("y", 0)), float(q["z"]))


static func _box_corners(b: Dictionary, length: float, width: float) -> Array:
	var c := cos(float(b["heading"]))
	var s := sin(float(b["heading"]))
	var ax := c * length / 2.0
	var az := s * length / 2.0
	var bx := -s * width / 2.0
	var bz := c * width / 2.0
	var x := float(b["x"])
	var z := float(b["z"])
	return [Vector2(x - ax + bx, z - az + bz), Vector2(x + ax + bx, z + az + bz), Vector2(x + ax - bx, z + az - bz), Vector2(x - ax - bx, z - az - bz)]


func _seg(a: Vector3, b: Vector3, c: Color) -> void:
	_lines.surface_set_color(c)
	_lines.surface_add_vertex(a)
	_lines.surface_set_color(c)
	_lines.surface_add_vertex(b)


func _polyline(pts: Array, c: Color, closed: bool) -> void:
	for i in pts.size() - 1:
		_seg(pts[i], pts[i + 1], c)
	if closed and pts.size() > 2:
		_seg(pts[-1], pts[0], c)


## A loop of corners (x, z) on the road.
func _loop(corners: Array, y: float, c: Color) -> void:
	var pts: Array = []
	for q in corners:
		pts.append(Vector3(q.x, ed.ground_y(q.x, q.y, y) + 0.08, q.y))
	_polyline(pts, c, true)


## A see-through area of corners (x, z) on the road.
func _fill(corners: Array, y: float, c: Color, alpha: float) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pts := PackedVector2Array(corners)
	for i in Geometry2D.triangulate_polygon(pts):
		st.add_vertex(Vector3(pts[i].x, ed.ground_y(pts[i].x, pts[i].y, y) + 0.07, pts[i].y))
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = flat(c, alpha)
	_areas.add_child(mi)


func _quad(centre: Vector3, along: Vector3, across: Vector3, c: Color, alpha: float) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for v in [centre - along - across, centre + along - across, centre + along + across, centre - along - across, centre + along + across, centre - along + across]:
		st.add_vertex(v)
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = flat(c, alpha)
	_areas.add_child(mi)


func _pit_line() -> void:
	var line: Array = ed.pit_line
	if line.is_empty():
		return
	var pts: Array = []
	if line.size() >= 3:
		var v := PackedVector3Array()
		for q in line:
			v.append(_v(q) + Vector3(0, 0.25, 0))
		pts = Array(CatmullRom.make(v).points(line.size() * 12))
	else:
		for q in line:
			pts.append(_v(q) + Vector3(0, 0.25, 0))
	_polyline(pts, Color("ff9a2e"), false)
	for i in line.size():
		var chosen: bool = ed.sel["kind"] == "pitline" and ed.sel["i"] == i
		var c := Color.WHITE if chosen else (Color("4ed88a") if i == 0 else (Color("ff5a4a") if i == line.size() - 1 else Color("ff9a2e")))
		dots.append({"p": _v(line[i]) + Vector3(0, 0.3, 0), "r": 6.0, "color": c, "kind": "pitline", "i": i})
		if i < line.size() - 1:
			arrows.append({"p": _v(line[i]), "heading": atan2(line[i + 1]["z"] - line[i]["z"], line[i + 1]["x"] - line[i]["x"]), "px": 28.0, "color": Color("ff9a2e")})


func _gate(i: int, chosen: bool) -> void:
	var g: Dictionary = ed.gates[i]
	var colour := Color("ffd04d") if chosen else (Color("4ed88a") if i == 0 else Color("4db8ff"))
	var h := float(g["heading"])
	var along := Vector3(cos(h), 0, sin(h))
	var across := Vector3(-along.z, 0, along.x) * float(g["width"]) / 2.0
	var p := _v(g)
	# a wall across the road, and a strip on it to be seen from above
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for v in [p - across, p + across, p + across + Vector3(0, 4, 0), p - across, p + across + Vector3(0, 4, 0), p - across + Vector3(0, 4, 0)]:
		st.add_vertex(v)
	var wall := MeshInstance3D.new()
	wall.mesh = st.commit()
	wall.material_override = flat(colour, 0.6 if chosen else 0.45, false)
	_areas.add_child(wall)
	_quad(p + Vector3(0, 0.3, 0), along * ed.marker_scale, across, colour, 0.6 if chosen else 0.45)
	arrows.append({"p": p, "heading": h, "px": 50.0, "color": colour})


func _camera(i: int, chosen: bool) -> void:
	var c: Dictionary = ed.cameras[i]
	var colour := Color("ffd04d") if chosen else Color("ff7bd5")
	var p := _v(c)
	_wire_box(AABB(p - Vector3(0.7, 0.5, 0.9) * ed.marker_scale, Vector3(1.4, 1.0, 1.8) * ed.marker_scale), colour)
	_seg(p, Vector3(p.x, ed.ground_y(p.x, p.z, p.y), p.z), colour)
	dots.append({"p": p, "r": 9.0, "color": colour, "kind": "camera", "i": i})
	var r: Dictionary = c.get("range", {"x": c["x"], "z": c["z"], "r": 30.0})
	var ring: Array = []
	for k in 64:
		var a := k / 64.0 * TAU
		var x: float = r["x"] + cos(a) * r["r"]
		var z: float = r["z"] + sin(a) * r["r"]
		ring.append(Vector3(x, ed.ground_y(x, z, p.y) + 0.3, z))
	_polyline(ring, Color(colour, 1.0 if chosen else 0.5), true)
	if chosen and ed.cam_range:
		var gy := ed.ground_y(r["x"], r["z"], p.y)
		dots.append({"p": Vector3(r["x"], gy + 0.9, r["z"]), "r": 9.0, "color": Color.WHITE, "kind": "range", "i": i, "node": 0, "y": gy})
		dots.append({"p": Vector3(r["x"] + r["r"], ed.ground_y(r["x"] + r["r"], r["z"], gy) + 0.9, r["z"]), "r": 9.0, "color": CHOSEN, "kind": "range",
			"i": i, "node": 1, "y": gy})


func _drag_strip() -> void:
	var d := ed.drag
	if d.is_empty():
		return
	var h := float(d["heading"])
	var dir := Vector3(cos(h), 0, sin(h))
	var across := Vector3(-dir.z, 0, dir.x) * float(d["width"]) / 2.0
	var start := _v(d)
	var fx: float = d["x"] + dir.x * float(d["length"])
	var fz: float = d["z"] + dir.z * float(d["length"])
	var finish := Vector3(fx, ed.ground_y(fx, fz, d["y"]), fz)
	_quad(start + Vector3(0, 0.35, 0), dir * 0.6 * ed.marker_scale, across, Color("4ed88a"), 0.85)
	_quad(finish + Vector3(0, 0.35, 0), dir * 0.6 * ed.marker_scale, across, Color("ff5a4f"), 0.85)
	_seg(start + Vector3(0, 0.5, 0), finish + Vector3(0, 0.5, 0), Color.WHITE)
	for m in DRAG_MARKS:
		if m[1] < float(d["length"]) - 0.5:
			var x: float = d["x"] + dir.x * m[1]
			var z: float = d["z"] + dir.z * m[1]
			var y := ed.ground_y(x, z, d["y"])
			_seg(Vector3(x, y + 0.35, z) - across, Vector3(x, y + 0.35, z) + across, Color.WHITE)
	arrows.append({"p": start, "heading": h, "px": 70.0, "color": Color("4ed88a")})


func _racing_line() -> void:
	var pts := ed.line.line_points()
	if pts.size() < 2:
		return
	var editing: bool = ed.line_edit["editing"]
	var colour := Color("4db8ff") if editing else Color("ffd04d")
	var lifted: Array = []
	for p in pts:
		lifted.append(p + Vector3(0, 0.5, 0))
	_polyline(lifted, colour, false)
	var step := maxi(1, pts.size() / 24)
	for i in range(0, pts.size() - 1, step):
		arrows.append({"p": pts[i], "heading": atan2(pts[i + 1].z - pts[i].z, pts[i + 1].x - pts[i].x), "px": 34.0, "color": colour})
	if editing:
		var nodes: Array = ed.line_edit["nodes"]
		for i in nodes.size():
			var c := CHOSEN if i == ed.line_edit["selected"] else (Color("4ed88a") if i == 0 else Color.WHITE)
			dots.append({"p": _v(nodes[i]) + Vector3(0, 0.5, 0), "r": 8.0, "color": c, "kind": "linenode", "i": i})


func _curb_nodes() -> void:
	if not (ed.mode in ["view", "curb"]) and ed.sel["kind"] != "curb":
		return
	for i in ed.curbs.size():
		var chosen: bool = ed.sel["kind"] == "curb" and ed.sel["i"] == i
		var nodes: Array = ed.curbs[i]["nodes"]
		for k in nodes.size():
			var n: Array = nodes[k]
			var c := CHOSEN if chosen and k == ed.sel["node"] else (Color("4ed88a") if chosen and k == 0 else (Color.WHITE if chosen else Color("ff6a5a")))
			dots.append({"p": Vector3(n[0], n[1] + 0.3, n[2]), "r": 8.0 if chosen else 5.0, "color": c, "kind": "curbnode", "i": i, "node": k})


func _design() -> void:
	var d := ed.design
	if d == null:
		return
	var nodes: Array = d.data.get("nodes", [])
	if ed.mode in ["view", "node"]:
		for i in nodes.size():
			var chosen: bool = ed.sel["kind"] == "dnode" and ed.sel["i"] == i
			dots.append({"p": _v(nodes[i]) + Vector3(0, 0.3, 0), "r": 11.0 if chosen else 8.0,
				"color": Color("ffd04d") if chosen else (Color("4ed88a") if i == 0 else Color("4db8ff")), "kind": "dnode", "i": i})
		if nodes.size() >= 2:
			var curve := d.curve_of()
			var pts: Array = Array(curve.points(maxi(64, nodes.size() * 16))).map(func(p: Vector3) -> Vector3: return p + Vector3(0, 0.3, 0))
			_polyline(pts, Color("4db8ff"), false)
	var sk: String = ed.sel["kind"]
	var si: int = ed.sel["i"]
	if sk == "prefab" and si < (d.data["prefabs"] as Array).size():
		var p: Dictionary = d.data["prefabs"][si]
		if p.get("row", false):
			var pts: Array = p["points"]
			for k in pts.size():
				dots.append({"p": _v(pts[k]) + Vector3(0, 0.2, 0), "r": 7.0, "color": CHOSEN if k == ed.sel["node"] else Color("ffd04d"), "kind": "rowpoint",
					"i": si, "node": k})
			var curve := d.row_curve(p)
			if curve != null:
				_polyline(Array(curve.points(64)).map(func(v: Vector3) -> Vector3: return v + Vector3(0, 0.2, 0)), Color("ffd04d"), false)
		else:
			for g in d.prefab_group.get_children():
				if int(g.get_meta("prefab", -1)) == si:
					var box := AABB()
					var first := true
					for m in g.find_children("*", "MeshInstance3D", true, false):
						var b: AABB = (m as MeshInstance3D).global_transform * (m as MeshInstance3D).get_aabb()
						box = b if first else box.merge(b)
						first = false
					if not first:
						_wire_box(box, Color("ffd04d"))
	if sk == "patch" and si < (d.data["patches"] as Array).size():
		var p: Dictionary = d.data["patches"][si]
		var ring: Array = []
		for k in (p["points"] as Array).size():
			var q: Dictionary = p["points"][k]
			var y := ed.ground_y(float(q["x"]), float(q["z"]))
			ring.append(Vector3(q["x"], y + 0.3, q["z"]))
			dots.append({"p": Vector3(q["x"], y + 0.4, q["z"]), "r": 7.0, "color": CHOSEN if k == ed.sel["node"] else Color("ffd04d"), "kind": "patchpoint",
				"i": si, "node": k})
		_polyline(ring, Color("ffd04d"), not p.get("connect", false) and ed.drawing.get("kind", "") != "patch")
	if sk == "branch" and si < (d.data["branches"] as Array).size():
		var b: Dictionary = d.data["branches"][si]
		var line: Array = d.branch_lines[si]["points"] if si < d.branch_lines.size() else []
		var bn: Array = b["nodes"]
		for k in bn.size():
			var q: Dictionary = bn[k]
			var end: Variant = b.get("start") if k == 0 else (b.get("end") if k == bn.size() - 1 else null)
			var y: float = (line[0 if k == 0 else line.size() - 1]["y"] if not line.is_empty() and (k == 0 or k == bn.size() - 1)
				else ed.ground_y(float(q["x"]), float(q["z"])))
			dots.append({"p": Vector3(q["x"], y + 0.4, q["z"]), "r": 7.0,
				"color": CHOSEN if k == ed.sel["node"] else (Color("4ed88a") if end != null else Color("4db8ff")), "kind": "branchnode", "i": si, "node": k})
		_polyline(line.map(func(q: Dictionary) -> Vector3: return Vector3(q["x"], q["y"] + 0.3, q["z"])), Color("4db8ff"), false)


func _wire_box(b: AABB, c: Color) -> void:
	var e := b.end
	var p := b.position
	var corners := [Vector3(p.x, p.y, p.z), Vector3(e.x, p.y, p.z), Vector3(e.x, p.y, e.z), Vector3(p.x, p.y, e.z),
		Vector3(p.x, e.y, p.z), Vector3(e.x, e.y, p.z), Vector3(e.x, e.y, e.z), Vector3(p.x, e.y, e.z)]
	for pair in [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]:
		_seg(corners[pair[0]], corners[pair[1]], c)


func _measure() -> void:
	var pts: Array = ed.measure_points
	for p in pts:
		dots.append({"p": p + Vector3(0, 0.3, 0), "r": 6.0, "color": Color("7dff9a"), "kind": "measure", "i": -1})
	_polyline(pts.map(func(p: Vector3) -> Vector3: return p + Vector3(0, 0.3, 0)), Color("7dff9a"), false)


static func measure_text(e: TrackEditor) -> String:
	var pts: Array = e.measure_points
	if pts.size() < 2:
		return "Measure: click a point on the track, then the next ones. Escape ends it."
	var total := 0.0
	for i in range(1, pts.size()):
		total += (pts[i] as Vector3).distance_to(pts[i - 1])
	var a: Vector3 = pts[-1]
	var b: Vector3 = pts[-2]
	return "Measure: %.1f m in all (%d ft); the last piece %.1f m over the ground. Escape ends it." % [total, roundi(total / 0.3048),
		Vector2(a.x - b.x, a.z - b.z).length()]


# ---- the overlay: the nodes, the numbers, the arrows and the handles of what is chosen

func _draw_overlay() -> void:
	var font := overlay.get_theme_default_font()
	for a in arrows:
		var s: Variant = screen_of(a["p"] + Vector3(0, 0.6, 0))
		var h: float = a["heading"]
		var tip: Variant = screen_of(a["p"] + Vector3(cos(h), 0.6 / ed.marker_scale, sin(h)) * ed.marker_scale)
		if s == null or tip == null:
			continue
		var dir: Vector2 = ((tip as Vector2) - (s as Vector2)).normalized()
		var end: Vector2 = s + dir * float(a["px"])
		var side := Vector2(-dir.y, dir.x)
		overlay.draw_line(s, end, a["color"], 2.0, true)
		overlay.draw_colored_polygon(PackedVector2Array([end + dir * 6, end - dir * 6 + side * 5, end - dir * 6 - side * 5]), a["color"])
	for d in dots:
		var s: Variant = screen_of(d["p"])
		if s == null:
			continue
		overlay.draw_circle(s, d["r"] + 1.5, Color(0, 0, 0, 0.6))
		overlay.draw_circle(s, d["r"], d["color"])
	for l in labels:
		var s: Variant = screen_of(l["p"])
		if s == null:
			continue
		var at: Vector2 = s + Vector2(-6, 8)
		overlay.draw_string_outline(font, at, l["text"], HORIZONTAL_ALIGNMENT_LEFT, -1, 20, 5, Color(0, 0, 0, 0.7))
		overlay.draw_string(font, at, l["text"], HORIZONTAL_ALIGNMENT_LEFT, -1, 20, l["color"])
	for h in _handles():
		var c: Color = Color("ffd04d") if h["kind"] == ed.gizmo_mode else Color(1, 1, 1, 0.85)
		match h["kind"]:
			"move":
				overlay.draw_circle(h["at"], 9.0, Color(0, 0, 0, 0.5))
				overlay.draw_arc(h["at"], 9.0, 0, TAU, 24, c, 2.0, true)
				overlay.draw_line(h["at"] - Vector2(14, 0), h["at"] + Vector2(14, 0), c, 2.0)
				overlay.draw_line(h["at"] - Vector2(0, 14), h["at"] + Vector2(0, 14), c, 2.0)
			"turn":
				overlay.draw_arc(h["centre"], RING, 0, TAU, 64, c, 2.5, true)
			"scale":
				overlay.draw_rect(Rect2(h["at"] - Vector2(6, 6), Vector2(12, 12)), c)
			"height":
				overlay.draw_line(h["centre"], h["at"], c, 2.5, true)
				overlay.draw_colored_polygon(PackedVector2Array([h["at"] + Vector2(0, -10), h["at"] + Vector2(-7, 2), h["at"] + Vector2(7, 2)]), c)


## The handles of what is chosen: [{ kind: move | turn | scale | height, at, centre }].
func _handles() -> Array:
	var out: Array = []
	var p: Variant = ed.input.chosen_point()
	if p == null:
		return out
	var s: Variant = screen_of(p)
	if s == null:
		return out
	var sk: String = ed.sel["kind"]
	out.append({"kind": "move", "at": s, "centre": s})
	var it := ed.input.item()
	if TrackEditorInput.heading_of(sk, it) != null:
		out.append({"kind": "turn", "at": s, "centre": s})
	if sk in ["gate", "object", "drag", "prefab"]:
		out.append({"kind": "scale", "at": s + Vector2(RING, 0).rotated(-PI / 4.0), "centre": s})
	if sk == "dnode":
		out.append({"kind": "height", "at": s + Vector2(0, -60), "centre": s})
	return out


func handle_hit(pos: Vector2) -> Dictionary:
	var best := {}
	for h in _handles():
		var d: float
		if h["kind"] == "turn":
			d = absf(pos.distance_to(h["centre"]) - RING)
			if d < 8.0:
				best = h
		elif pos.distance_to(h["at"]) < 13.0:
			return h
	return best


## The node, point or dot under the pointer (the smallest distance), or {}.
func dot_hit(pos: Vector2) -> Dictionary:
	var best := {}
	var best_d := INF
	for d in dots:
		var s: Variant = screen_of(d["p"])
		if s == null:
			continue
		var dist := pos.distance_to(s)
		if dist <= float(d["r"]) + 5.0 and dist < best_d:
			best_d = dist
			best = d
	return best


## What a click in Look chooses: a camera, the drag strip, a curb, an object, a gate, a box, a prefab, a surface, a branch: { kind, i }.
func pick(pos: Vector2) -> Dictionary:
	for finder in [_pick_dot, _pick_drag, _pick_curb, _pick_object, _pick_gate, _pick_box, _pick_design]:
		var found: Dictionary = finder.call(pos)
		if not found.is_empty():
			return found
	return {}


func _pick_dot(pos: Vector2) -> Dictionary:
	var d := dot_hit(pos)
	if not d.is_empty() and d["kind"] in ["camera", "pitline", "dnode", "curbnode"]:
		return {"kind": "curb" if d["kind"] == "curbnode" else d["kind"], "i": d["i"], "node": d.get("node", -1)}
	return {}


func _pick_drag(pos: Vector2) -> Dictionary:
	if ed.drag.is_empty():
		return {}
	var h := float(ed.drag["heading"])
	var dir := Vector3(cos(h), 0, sin(h))
	var across := Vector3(-dir.z, 0, dir.x) * float(ed.drag["width"]) / 2.0
	var st := _v(ed.drag)
	var fi := st + dir * float(ed.drag["length"])
	if _near_segment(pos, st - across, st + across, 10.0) or _near_segment(pos, fi - across, fi + across, 10.0):
		return {"kind": "drag", "i": 0}
	return {}


func _pick_curb(pos: Vector2) -> Dictionary:
	var c := curb_strip_hit(pos)
	return {} if c.is_empty() else {"kind": "curb", "i": c["i"]}


func _pick_object(pos: Vector2) -> Dictionary:
	var r := ed.ray_of(pos)
	var best_t := INF
	var best_o := -1
	for i in ed.objects.size():
		var hit: Variant = ed.parts_kit.object_box(i).intersects_ray(r[0], r[1])
		if hit != null and (hit as Vector3).distance_to(r[0]) < best_t:
			best_t = (hit as Vector3).distance_to(r[0])
			best_o = i
	return {"kind": "object", "i": best_o} if best_o >= 0 else {}


func _pick_gate(pos: Vector2) -> Dictionary:
	for i in ed.gates.size():
		var g: Dictionary = ed.gates[i]
		var across := Vector3(-sin(float(g["heading"])), 0, cos(float(g["heading"]))) * float(g["width"]) / 2.0
		if _near_segment(pos, _v(g) - across, _v(g) + across, 10.0):
			return {"kind": "gate", "i": i}
	return {}


func _pick_box(pos: Vector2) -> Dictionary:
	for list in [["grid", ed.grid, BOX_L, BOX_W], ["pit", ed.pit_boxes, PIT_L, PIT_W]]:
		for i in (list[1] as Array).size():
			var b: Dictionary = list[1][i]
			var poly := PackedVector2Array()
			for q in _box_corners(b, list[2], list[3]):
				var s: Variant = screen_of(Vector3(q.x, float(b.get("y", 0)), q.y))
				if s != null:
					poly.append(s)
			if poly.size() == 4 and Geometry2D.is_point_in_polygon(pos, poly):
				return {"kind": list[0], "i": i}
	return {}


func _pick_design(pos: Vector2) -> Dictionary:
	var part: Variant = _design_part(pos) if ed.design != null else null
	var n: Node = part as Node
	while n != null and n != ed.design:
		for k in ["prefab", "patch", "branch"]:
			if n.has_meta(k):
				return {"kind": k, "i": int(n.get_meta(k))}
		n = n.get_parent()
	return {}


func _design_part(pos: Vector2) -> Variant:
	ed._rebuild_grids()
	var r := ed.ray_of(pos)
	var hit := ed.pick_grid.ray(r[0], r[1], ed.camera.far)
	return null if hit.is_empty() else ed.pick_parts[hit["tag"]]


## The prefab of the design under the pointer, or -1.
func prefab_at(pos: Vector2) -> int:
	var p := pick(pos)
	return int(p["i"]) if p.get("kind", "") == "prefab" else -1


func _near_segment(pos: Vector2, a: Vector3, b: Vector3, px: float) -> bool:
	var sa: Variant = screen_of(a)
	var sb: Variant = screen_of(b)
	if sa == null or sb == null:
		return false
	return TrackEditorInput.seg_dist(pos, sa, sb) <= px


## The strip of a curb under the pointer, within 10 pixels of its line: { i, point }, the chosen curb first.
func curb_strip_hit(pos: Vector2) -> Dictionary:
	var best := {}
	var best_d := 10.0
	var order: Array = range(ed.curbs.size())
	if ed.sel["kind"] == "curb":
		order.erase(ed.sel["i"])
		order.push_front(ed.sel["i"])
	for i in order:
		for q in ed.curbs[i]["points"]:
			var p := Vector3(q[0], q[3], q[1])
			var s: Variant = screen_of(p)
			if s == null:
				continue
			var d := pos.distance_to(s)
			if d < best_d:
				best_d = d
				best = {"i": i, "point": p}
		if not best.is_empty() and ed.sel["kind"] == "curb" and i == ed.sel["i"]:
			break
	return best


## A click on the line of a row (within 12 pixels): { at (the piece), x, z }.
func row_line_hit(pos: Vector2, row: Dictionary) -> Dictionary:
	var curve := ed.design.row_curve(row)
	if curve == null:
		return {}
	var best := {}
	var best_d := 12.0
	for i in 161:
		var t := i / 160.0
		var v := curve.point(t)
		var s: Variant = screen_of(v + Vector3(0, 0.2, 0))
		if s == null:
			continue
		var d := pos.distance_to(s)
		if d < best_d:
			best_d = d
			best = {"t": t, "x": v.x, "z": v.z}
	if not best.is_empty():
		best["at"] = mini((row["points"] as Array).size() - 2, floori(best["t"] * ((row["points"] as Array).size() - 1)))
	return best


## The piece of a row of points nearest to the pointer within 12 pixels (its first index), or -1.
func near_piece(pos: Vector2, points: Array, closed: bool) -> int:
	var best := -1
	var best_d := 12.0
	var last := points.size() if closed else points.size() - 1
	for i in last:
		var a: Dictionary = points[i]
		var b: Dictionary = points[(i + 1) % points.size()]
		var pa := Vector3(a["x"], ed.ground_y(a["x"], a["z"]), a["z"])
		var pb := Vector3(b["x"], ed.ground_y(b["x"], b["z"]), b["z"])
		var sa: Variant = screen_of(pa)
		var sb: Variant = screen_of(pb)
		if sa == null or sb == null:
			continue
		var d := TrackEditorInput.seg_dist(pos, sa, sb)
		if d < best_d:
			best_d = d
			best = i
	return best
