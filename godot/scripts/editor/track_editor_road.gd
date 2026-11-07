class_name TrackEditorRoad
extends RefCounted
## The road of nodes in the track editor (track-design.js): its nodes, the prefabs and their rows, the surfaces and the
## branches, drawn with the pointer.

var ed: TrackEditor


func _init(editor: TrackEditor) -> void:
	ed = editor


# ---- the road of nodes (track-design.js)

func ground_point(pos: Vector2) -> Variant:
	var hit := ed.road_hit(pos)
	if not hit.is_empty():
		var p: Vector3 = hit["point"]
		if ed.snap > 0.0:
			p.x = roundf(p.x / ed.snap) * ed.snap
			p.z = roundf(p.z / ed.snap) * ed.snap
		return p
	return ed.plane_point(pos, 0.0)


## A new node goes between the two nodes it is nearest to, with the height and the width between theirs.
func add_node(x: float, z: float) -> void:
	var nodes: Array = ed.design.data["nodes"]
	var node: Dictionary
	var at: int
	if nodes.size() < 2:
		node = {"x": TrackDesign.r2(x), "y": 0, "z": TrackDesign.r2(z), "width": float(ed.ui["dsWidth"].value)}
		at = nodes.size()
	else:
		var best := INF
		var bi := nodes.size() - 1
		var bt := 0.0
		var segments := nodes.size() if ed.design.data.get("closed", true) != false else nodes.size() - 1
		for i in segments:
			var a: Dictionary = nodes[i]
			var b: Dictionary = nodes[(i + 1) % nodes.size()]
			var d := Vector2(b["x"] - a["x"], b["z"] - a["z"])
			var t := clampf((Vector2(x, z) - Vector2(a["x"], a["z"])).dot(d) / maxf(d.length_squared(), 1.0), 0.0, 1.0)
			var dist := Vector2(x, z).distance_to(Vector2(a["x"], a["z"]) + d * t)
			if dist < best:
				best = dist
				bi = i
				bt = t
		var a: Dictionary = nodes[bi]
		var b: Dictionary = nodes[(bi + 1) % nodes.size()]
		node = {"x": TrackDesign.r2(x), "y": TrackDesign.r2(a["y"] + (b["y"] - a["y"]) * bt), "z": TrackDesign.r2(z),
			"width": TrackDesign.r2(a["width"] + (b["width"] - a["width"]) * bt)}
		at = bi + 1
	nodes.insert(at, node)
	ed.rebuild_design(true)
	ed.select("dnode", at)
	ed.changed()


func delete_node() -> void:
	var nodes: Array = ed.design.data["nodes"]
	if nodes.size() <= 3:
		ed.status("A track needs at least three nodes.", "warn")
		return
	nodes.remove_at(ed.sel["i"])
	ed.rebuild_design(true)
	ed.select("dnode", mini(ed.sel["i"], nodes.size() - 1))
	ed.changed()


func refresh_prefabs() -> void:
	ed.design.rebuild_prefabs()
	ed.parts_kit.design_parts_changed()
	ed.markers.rebuild()
	TrackEditorUI.refresh(ed)


func add_prefab(x: float, z: float) -> void:
	var y: float = ed.design.surface_at(x, z)["y"]
	(ed.design.data["prefabs"] as Array).append({"type": ed.prefab_type, "x": TrackDesign.r2(x), "y": TrackDesign.r2(y), "z": TrackDesign.r2(z),
		"rotation": 0, "scale": 1})
	refresh_prefabs()
	ed.select("prefab", (ed.design.data["prefabs"] as Array).size() - 1)
	ed.changed()


func add_row(points: Array) -> void:
	var pts: Array = points.map(func(q: Variant) -> Dictionary:
		var v: Vector2 = q if q is Vector2 else Vector2(q["x"], q["z"])
		return {"x": TrackDesign.r2(v.x), "y": 0, "z": TrackDesign.r2(v.y)})
	var p := {"type": ed.prefab_type, "row": true, "points": pts, "spacing": DesignPrefabs.SPACING.get(ed.prefab_type, 4.0), "scale": 1}
	if ed.prefab_attach:
		p["attach"] = true
		for q in pts:
			ed.design.start_node_offset(q)
	ed.design.snap_row(p)
	(ed.design.data["prefabs"] as Array).append(p)
	refresh_prefabs()
	ed.select("prefab", (ed.design.data["prefabs"] as Array).size() - 1)
	ed.changed()


func insert_row_point(at: Dictionary) -> void:
	var p: Dictionary = ed.design.data["prefabs"][ed.sel["i"]]
	var node := {"x": TrackDesign.r2(at["x"]), "y": 0, "z": TrackDesign.r2(at["z"])}
	if p.get("attach", false):
		ed.design.start_node_offset(node)
	(p["points"] as Array).insert(at["at"] + 1, node)
	ed.design.snap_row(p)
	refresh_prefabs()
	ed.select("prefab", ed.sel["i"], at["at"] + 1)
	ed.changed()


func delete_prefab() -> void:
	var p: Dictionary = ed.design.data["prefabs"][ed.sel["i"]]
	if p.get("row", false) and ed.sel["node"] >= 0:
		(p["points"] as Array).remove_at(ed.sel["node"])
		if (p["points"] as Array).size() >= 2:
			refresh_prefabs()
			ed.select("prefab", ed.sel["i"])
			return
	(ed.design.data["prefabs"] as Array).remove_at(ed.sel["i"])
	refresh_prefabs()
	ed.select("")


func duplicate_prefab() -> void:
	var p: Dictionary = (ed.design.data["prefabs"][ed.sel["i"]] as Dictionary).duplicate(true)
	if p.get("row", false):
		for q in p["points"]:
			q["x"] = float(q["x"]) + 5.0
			q["z"] = float(q["z"]) + 5.0
	else:
		p["x"] = float(p["x"]) + 4.0 * cos(float(p.get("rotation", 0)))
		p["z"] = float(p["z"]) - 4.0 * sin(float(p.get("rotation", 0)))
	(ed.design.data["prefabs"] as Array).append(p)
	refresh_prefabs()
	ed.select("prefab", (ed.design.data["prefabs"] as Array).size() - 1)


static func _stroke_length(s: Array) -> float:
	var l := 0.0
	for i in range(1, s.size()):
		l += (s[i] as Vector2).distance_to(s[i - 1])
	return l


## Fewer points that still follow the line (Douglas-Peucker).
static func _simplify(points: Array, tolerance: float) -> Array:
	if points.size() <= 2:
		return points.duplicate()
	var a: Vector2 = points[0]
	var b: Vector2 = points[-1]
	var far := 0.0
	var index := 0
	for i in range(1, points.size() - 1):
		var d := TrackEditorInput.seg_dist(points[i], a, b)
		if d > far:
			far = d
			index = i
	if far <= tolerance:
		return [a, b]
	var left := _simplify(points.slice(0, index + 1), tolerance)
	left.pop_back()
	left.append_array(_simplify(points.slice(index), tolerance))
	return left


# ---- the surfaces and the branches of the road

func patch_click(pos: Vector2) -> void:
	var g: Variant = ground_point(pos)
	var patches: Array = ed.design.data["patches"]
	if ed.drawing.get("kind", "") == "patch":
		var p: Dictionary = patches[ed.drawing["index"]]
		var first: Dictionary = p["points"][0] if not (p["points"] as Array).is_empty() else {}
		if (p["points"] as Array).size() >= 3 and not first.is_empty():
			var s: Variant = ed.markers.screen_of(Vector3(first["x"], ed.ground_y(first["x"], first["z"]), first["z"]))
			if s != null and (s as Vector2).distance_to(pos) < 14.0:
				finish_drawing()
				return
		if g == null:
			return
		(p["points"] as Array).append({"x": TrackDesign.r2(g.x), "z": TrackDesign.r2(g.z)})
		ed.sel["node"] = (p["points"] as Array).size() - 1
		ed.design.build_patches()
		ed.parts_kit.design_parts_changed()
		ed.refresh()
		return
	if ed.sel["kind"] == "patch" and g != null:
		var chosen: Dictionary = patches[ed.sel["i"]]
		var piece := ed.markers.near_piece(pos, chosen["points"], not chosen.get("connect", false))
		if piece >= 0:
			(chosen["points"] as Array).insert(piece + 1, {"x": TrackDesign.r2(g.x), "z": TrackDesign.r2(g.z)})
			ed.design.build_patches()
			ed.parts_kit.design_parts_changed()
			ed.select("patch", ed.sel["i"], piece + 1)
			ed.changed()
			return
	var pick := ed.markers.pick(pos)
	if pick.get("kind", "") == "patch":
		ed.select("patch", pick["i"])
		return
	if g == null:
		return
	var p := {"surface": ed.patch_surface, "points": [{"x": TrackDesign.r2(g.x), "z": TrackDesign.r2(g.z)}]}
	if ed.patch_connect:
		p["connect"] = true
	patches.append(p)
	ed.drawing = {"kind": "patch", "index": patches.size() - 1}
	ed.select("patch", patches.size() - 1, 0)


## The nearest place on the middle of a road (the track, or a branch but not the one that is drawn) within its width and 2 m.
func _snap_road(x: float, z: float, exclude: int, own_end := -1) -> Dictionary:
	var best := {}
	var best_d := INF
	for q in ed.design.main_line:
		var d := Vector2(q["x"] - x, q["z"] - z).length()
		if d < q["w"] + 2.0 and d < best_d:
			best_d = d
			best = {"road": -1, "u": q["u"], "x": q["x"], "y": q["y"], "z": q["z"]}
	for k in ed.design.branch_lines.size():
		var pts: Array = ed.design.branch_lines[k]["points"]
		if pts.size() < 2:
			continue
		var total: float = pts[-1]["along"]
		for i in pts.size():
			var q: Dictionary = pts[i]
			if k == exclude:
				if own_end < 0:
					continue
				var gap := maxf(12.0, float(pts[pts.size() - 1 if own_end == 1 else 0]["w"]) * 6.0)
				if (own_end == 1 and q["along"] > total - gap) or (own_end == 0 and q["along"] < gap):
					continue
			var d := Vector2(q["x"] - x, q["z"] - z).length()
			if d < q["w"] + 2.0 and d < best_d:
				best_d = d
				best = {"road": k, "u": float(i) / (pts.size() - 1), "x": q["x"], "y": q["y"], "z": q["z"]}
	return best


func branch_click(pos: Vector2) -> void:
	var g: Variant = ground_point(pos)
	var branches: Array = ed.design.data["branches"]
	if ed.drawing.get("kind", "") == "branch":
		if g == null:
			return
		var b: Dictionary = branches[ed.drawing["index"]]
		var snap := _snap_road(g.x, g.z, ed.drawing["index"], 1)
		var first: Dictionary = b["nodes"][0]
		var away := Vector2(g.x - first["x"], g.z - first["z"]).length() > float(b.get("width", 8))
		if not snap.is_empty() and away:
			(b["nodes"] as Array).append({"x": TrackDesign.r2(snap["x"]), "z": TrackDesign.r2(snap["z"])})
			b["end"] = {"road": snap["road"], "u": snap["u"]}
			finish_drawing()
			return
		(b["nodes"] as Array).append({"x": TrackDesign.r2(g.x), "z": TrackDesign.r2(g.z)})
		ed.sel["node"] = (b["nodes"] as Array).size() - 1
		ed.rebuild_design(false)
		ed.refresh()
		return
	if ed.sel["kind"] == "branch" and g != null:
		var chosen: Dictionary = branches[ed.sel["i"]]
		var piece := ed.markers.near_piece(pos, chosen["nodes"], false)
		if piece >= 0:
			(chosen["nodes"] as Array).insert(piece + 1, {"x": TrackDesign.r2(g.x), "z": TrackDesign.r2(g.z)})
			ed.rebuild_design(true)
			ed.select("branch", ed.sel["i"], piece + 1)
			ed.changed()
			return
	var pick := ed.markers.pick(pos)
	if pick.get("kind", "") == "branch":
		ed.select("branch", pick["i"])
		return
	if g == null:
		return
	var snap := _snap_road(g.x, g.z, -2)
	var start := {"x": TrackDesign.r2(snap["x"]), "z": TrackDesign.r2(snap["z"])} if not snap.is_empty() else {"x": TrackDesign.r2(g.x), "z": TrackDesign.r2(g.z)}
	branches.append({"nodes": [start], "width": maxf(2.0, float(ed.ui["dsBranchWidth"].value)),
		"start": {"road": snap["road"], "u": snap["u"]} if not snap.is_empty() else null, "end": null})
	ed.drawing = {"kind": "branch", "index": branches.size() - 1}
	ed.select("branch", branches.size() - 1, 0)


func snap_branch_end() -> void:
	var b: Dictionary = ed.design.data["branches"][ed.sel["i"]]
	var i: int = ed.sel["node"]
	var nodes: Array = b["nodes"]
	if i != 0 and i != nodes.size() - 1:
		return
	var s := _snap_road(float(nodes[i]["x"]), float(nodes[i]["z"]), ed.sel["i"], 0 if i == 0 else 1)
	if s.is_empty():
		return
	nodes[i]["x"] = TrackDesign.r2(s["x"])
	nodes[i]["z"] = TrackDesign.r2(s["z"])
	b["start" if i == 0 else "end"] = {"road": s["road"], "u": s["u"]}


## The end of drawing: an area needs three corners, a branch two nodes, or it goes; a row of points becomes a row.
func finish_drawing() -> void:
	var dr := ed.drawing
	if dr.is_empty():
		return
	ed.drawing = {}
	if dr["kind"] == "rowdraft":
		var pts := ed.draft.duplicate()
		ed.draft = []
		ed.markers.stroke = []
		if pts.size() >= 2:
			add_row(pts)
		elif pts.size() == 1:
			add_prefab(pts[0]["x"], pts[0]["z"])
		return
	if dr["kind"] == "patch":
		var patches: Array = ed.design.data["patches"]
		var p: Dictionary = patches[dr["index"]]
		if (p["points"] as Array).size() < (2 if p.get("connect", false) else 3):
			patches.remove_at(dr["index"])
			ed.select("")
		ed.design.build_patches()
		ed.parts_kit.design_parts_changed()
	else:
		var b: Dictionary = ed.design.data["branches"][dr["index"]]
		if (b["nodes"] as Array).size() < 2:
			remove_branch(dr["index"])
			ed.select("")
		ed.rebuild_design(true)
	ed.changed()


func remove_branch(i: int) -> void:
	var branches: Array = ed.design.data["branches"]
	branches.remove_at(i)
	for b in branches:
		for k in ["start", "end"]:
			var a: Variant = b.get(k)
			if not (a is Dictionary) or int(a["road"]) < 0:
				continue
			if int(a["road"]) == i:
				b[k] = null
			elif int(a["road"]) > i:
				a["road"] = int(a["road"]) - 1


func delete_extra_point() -> void:
	if not ed.drawing.is_empty():
		finish_drawing()
		return
	var k: String = ed.sel["kind"]
	var i: int = ed.sel["i"]
	var node: int = ed.sel["node"]
	if k == "patch":
		var patches: Array = ed.design.data["patches"]
		var pts: Array = patches[i]["points"]
		if node >= 0 and pts.size() > 1:
			pts.remove_at(node)
			ed.sel["node"] = -1
		else:
			patches.remove_at(i)
			ed.select("")
		ed.design.build_patches()
		ed.parts_kit.design_parts_changed()
	elif k == "branch":
		var b: Dictionary = ed.design.data["branches"][i]
		var nodes: Array = b["nodes"]
		if node >= 0 and nodes.size() > 1:
			nodes.remove_at(node)
			if node == 0:
				b["start"] = null
			if node == nodes.size():
				b["end"] = null
			ed.sel["node"] = -1
			if nodes.size() < 2:
				remove_branch(i)
				ed.select("")
		else:
			remove_branch(i)
			ed.select("")
		ed.rebuild_design(true)
	ed.changed()
