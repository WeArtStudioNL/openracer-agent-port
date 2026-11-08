extends Node3D
## (a scene: Godot --headless --path godot res://tools/test_design.tscn -- --track=dirt-run --out=/tmp/x.glb)
## The design of a track made again from its track.json (TrackDesign) and compared with the glb that the browser made of it:
## the box of every part, and the number of triangles.


func _ready() -> void:
	var id := Content.arg("track") if Content.arg("track") != "" else "dirt-run"
	var cfg: Dictionary = Content.load_json("tracks/%s/track.json" % id)
	var d := TrackDesign.new()
	add_child(d)
	var t0 := Time.get_ticks_msec()
	d.set_data(cfg["design"].duplicate(true))
	d.ground_y = func(x: float, z: float, _h: float) -> float: return d.surface_grid.query(x, z).get("y", 0.0)
	d.rebuild(true)
	d.rebuild_prefabs()
	print("design of %s made in %d ms" % [id, Time.get_ticks_msec() - t0])
	var browser := Content.load_model("tracks/%s/%s" % [id, cfg["model"]])
	var theirs := {}
	for m in browser.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		var key := str(mi.get_parent().name) if str(mi.get_parent().name).begins_with("prefab") else str(mi.name)
		theirs[key] = _box(mi)
	for g in [d.road_group, d.branch_group, d.patch_group, d.prefab_group]:
		for m in g.get_children():
			var ours := AABB()
			var first := true
			for mi in ([m] if m is MeshInstance3D else m.find_children("*", "MeshInstance3D", true, false)):
				var b := (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()
				ours = b if first else ours.merge(b)
				first = false
			var t: Variant = theirs.get(str(m.name))
			print("%-22s ours %s  browser %s" % [m.name, _fmt(ours), _fmt(t) if t != null else "-"])
	var out := Content.arg("out")
	if out != "":
		t0 = Time.get_ticks_msec()
		print("glb: ", error_string(d.export_glb(out)), " in %d ms" % (Time.get_ticks_msec() - t0))
	get_tree().quit()


func _box(mi: MeshInstance3D) -> AABB:
	return mi.global_transform * mi.get_aabb() if mi.is_inside_tree() else mi.get_aabb()


func _fmt(b: AABB) -> String:
	return "(%.1f %.1f %.1f)-(%.1f %.1f %.1f)" % [b.position.x, b.position.y, b.position.z, b.end.x, b.end.y, b.end.z]
