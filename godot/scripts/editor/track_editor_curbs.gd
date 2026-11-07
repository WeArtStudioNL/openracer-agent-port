class_name TrackEditorCurbs
extends RefCounted
## The curbs in the track editor (track-editor.js, Curbs.js): Draw curb, the nodes of a curb, its strip on the ground, and
## track.json "curbs".

var ed: TrackEditor


func _init(editor: TrackEditor) -> void:
	ed = editor


# ---- the curbs (Curbs.js): Draw curb, the nodes, the strip

func curb_settings() -> Dictionary:
	return {"width": clampf(float(ed.ui["curbWidth"].value), 0.3, 4.0), "height": clampf(float(ed.ui["curbHeight"].value), 0.0, 0.3),
		"colour": TrackEditorUI.CURB_COLOURS[ed.ui["curbColour"].selected]}


func build_curb(i: int) -> void:
	var c: Dictionary = ed.curbs[i]
	if c.get("mesh") != null and is_instance_valid(c["mesh"]):
		(c["mesh"] as Node).free()
	c["mesh"] = null
	var nodes: Array = c["nodes"]
	c["points"] = Curbs.points_of(c, func(x: float, z: float, hint: float) -> float: return ed.ground_y(x, z, hint)) if nodes.size() >= 2 else []
	c["segments"] = Curbs.line_of(nodes).map(func(q: Dictionary) -> int: return q["segment"]) if nodes.size() >= 2 else []
	var mesh := Curbs.mesh_of(c)
	if mesh == null:
		return
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = Curbs.material()
	mi.set_meta("curb", i)
	ed.curb_layer.add_child(mi)
	c["mesh"] = mi
	if ed.design != null and (ed.design.data.get("patches", []) as Array).any(func(q: Dictionary) -> bool: return q.get("connect", false)):
		ed.design.build_patches()


func draw_curbs() -> void:
	for c in ed.curb_layer.get_children():
		c.free()
	for i in ed.curbs.size():
		ed.curbs[i]["mesh"] = null
		build_curb(i)


func reset_curbs(list: Variant) -> void:
	ed.curbs = []
	if list is Array:
		for c in list:
			if not (c is Dictionary) or not (c.get("nodes") is Array):
				continue
			var nodes: Array = []
			for n in c["nodes"]:
				if not (n is Array) or n.size() < 3:
					continue
				var node: Array = [float(n[0]), ed.ground_y(float(n[0]), float(n[2]), float(n[1]) if n[1] != null else INF), float(n[2])]
				if c.get("connect", false) and n.size() > 4 and absf(float(n[4])) > 1e-3:
					node.append_array([Curbs.size_of(n), float(n[4])])
				elif n.size() > 3 and absf(float(n[3]) - 1.0) > 1e-3:
					node.append(Curbs.size_of(n))
				nodes.append(node)
			if nodes.is_empty():
				continue
			var curb := {"nodes": nodes, "width": float(c["width"]) if float(c.get("width", 0)) > 0.0 else 1.2,
				"height": float(c["height"]) if float(c.get("height", -1)) >= 0.0 else 0.05,
				"colour": str(c.get("colour", "red")) if Curbs.COLOURS.has(str(c.get("colour", ""))) else "red", "points": [], "segments": [], "mesh": null}
			if c.get("connect", false):
				curb["connect"] = true
			ed.curbs.append(curb)
	draw_curbs()


## As track.json keeps them (a curb of one node is not a curb yet: it is not saved).
func curbs_json() -> Array:
	var out: Array = []
	for c in ed.curbs:
		if (c["nodes"] as Array).size() < 2:
			continue
		var nodes: Array = []
		for n in c["nodes"]:
			nodes.append((n as Array).map(func(v: float) -> float: return roundf(v * 1000.0) / 1000.0))
		var d := {"nodes": nodes, "width": c["width"], "height": c["height"], "colour": c["colour"]}
		if c.get("connect", false):
			d["connect"] = true
		d["points"] = c["points"] if not (c["points"] as Array).is_empty() else Curbs.points_of(c, func(x: float, z: float, h: float) -> float: return ed.ground_y(x, z, h))
		out.append(d)
	return out


func snap_curb_node(n: Array) -> bool:
	if ed.design == null:
		return false
	var e := ed.design.road_edge_at(n[0], n[2])
	if e.is_empty():
		return false
	var off: float = n[4] if n.size() > 4 else 0.0
	n[0] = e["x"] + e["nx"] * off
	n[2] = e["z"] + e["nz"] * off
	n[1] = ed.ground_y(n[0], n[2], n[1])
	return true


func set_curb_offset(n: Array, offset: float) -> void:
	var size := Curbs.size_of(n)
	var value := roundf(clampf(offset, -6.0, 6.0) * 100.0) / 100.0
	n.resize(3)
	if absf(value) > 1e-3:
		n.append_array([size, value])
	elif absf(size - 1.0) > 1e-3:
		n.append(size)


func set_curb_size(n: Array, size: float) -> void:
	var value := roundf(clampf(size, 0.0, 1.5) * 100.0) / 100.0
	var off: float = n[4] if n.size() > 4 else 0.0
	n.resize(3)
	if off != 0.0:
		n.append_array([value, off])
	elif absf(value - 1.0) > 1e-3:
		n.append(value)


func start_curb_offset(n: Array) -> void:
	if ed.design == null:
		return
	var e := ed.design.road_edge_at(n[0], n[2])
	if not e.is_empty():
		set_curb_offset(n, (n[0] - e["x"]) * e["nx"] + (n[2] - e["z"]) * e["nz"])


func curb_click(pos: Vector2) -> void:
	var strip := ed.markers.curb_strip_hit(pos)
	var ci: int = ed.sel["i"] if ed.sel["kind"] == "curb" else -1
	if not strip.is_empty() and strip["i"] == ci:
		insert_curb_node(strip["point"])
		return
	if not strip.is_empty():
		ed.select("curb", strip["i"])
		return
	var road := ed.road_hit(pos)
	if road.is_empty():
		return
	var p: Vector3 = road["point"]
	var node: Array = [p.x, ed.ground_y(p.x, p.z, p.y), p.z]
	var c: Dictionary = ed.curbs[ci] if ci >= 0 else {}
	var connect: bool = c.get("connect", false) if not c.is_empty() else (ed.ui["curbConnect"].button_pressed and ed.design != null)
	if connect:
		start_curb_offset(node)
	if c.is_empty():
		var curb := curb_settings()
		curb.merge({"nodes": [node], "points": [], "segments": [], "mesh": null})
		if connect:
			curb["connect"] = true
		ed.curbs.append(curb)
		ed.select("curb", ed.curbs.size() - 1, 0)
		ed.changed()
		return
	var nodes: Array = c["nodes"]
	var first: Array = nodes[0]
	var last: Array = nodes[-1]
	var at_start := nodes.size() >= 2 and Vector2(node[0] - first[0], node[2] - first[2]).length() < Vector2(node[0] - last[0], node[2] - last[2]).length()
	if at_start:
		nodes.push_front(node)
	else:
		nodes.append(node)
	build_curb(ci)
	ed.select("curb", ci, 0 if at_start else nodes.size() - 1)
	ed.changed()


func insert_curb_node(point: Vector3) -> void:
	var ci: int = ed.sel["i"]
	var c: Dictionary = ed.curbs[ci]
	var pts: Array = c["points"]
	if (c["nodes"] as Array).size() < 2 or pts.is_empty():
		return
	var best := 0
	var best_d := INF
	for k in pts.size():
		var d := Vector2(pts[k][0] - point.x, pts[k][1] - point.z).length()
		if d < best_d:
			best_d = d
			best = k
	var at: int = (c["segments"][best] if best < (c["segments"] as Array).size() else 0) + 1
	var size: float = pts[best][5] if (pts[best] as Array).size() > 5 else 1.0
	var node: Array = [point.x, ed.ground_y(point.x, point.z, point.y), point.z]
	if absf(size - 1.0) > 1e-3:
		node.append(roundf(size * 100.0) / 100.0)
	if c.get("connect", false):
		start_curb_offset(node)
	(c["nodes"] as Array).insert(at, node)
	build_curb(ci)
	ed.select("curb", ci, at)
	ed.changed()


func end_curb_draw() -> void:
	if ed.sel["kind"] == "curb" and ed.sel["i"] < ed.curbs.size() and (ed.curbs[ed.sel["i"]]["nodes"] as Array).is_empty():
		remove_curb(ed.sel["i"])


func remove_curb(i: int) -> void:
	var c: Dictionary = ed.curbs[i]
	if c.get("mesh") != null and is_instance_valid(c["mesh"]):
		(c["mesh"] as Node).free()
	ed.curbs.remove_at(i)
	draw_curbs()
	ed.select("")


func delete_curb_node() -> bool:
	var ci: int = ed.sel["i"]
	var k: int = ed.sel["node"]
	if ci < 0 or k < 0:
		return false
	var nodes: Array = ed.curbs[ci]["nodes"]
	nodes.remove_at(k)
	if nodes.is_empty():
		remove_curb(ci)
		ed.status("The curb had no nodes left and is gone.", "ok")
		return true
	build_curb(ci)
	ed.select("curb", ci, mini(k, nodes.size() - 1))
	return true
