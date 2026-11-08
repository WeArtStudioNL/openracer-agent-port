class_name DragTopWindow
extends RefCounted
## The Top 50 of the drag strip of a track (DragStrip.js showTop): the best runs that drag_strip.gd kept, with the
## reaction time, the time, the top speed and the ticket (the time slip) of each.


static func file() -> String:
	return "user://test-drag.cfg" if Content.arg("ai") != "" else "user://drag.cfg"


static func runs(track_id: String) -> Array:
	var cfg := ConfigFile.new()
	if cfg.load(file()) != OK:
		return []
	var out: Array = cfg.get_value("runs", track_id, [])
	out.sort_custom(func(a, b): return float(a["et"]) < float(b["et"]))
	return out.slice(0, 50)


static func open(parent: Node, track_id: String, track_cfg: Dictionary) -> MenuDialog:
	var length := float(track_cfg.get("dragstrip", {}).get("length", 402.336))
	var d := MenuDialog.new("Top 50 · drag strip", "%s · %s · the best runs on this computer" % [str(track_cfg.get("name", track_id)), _length_name(length)], 760)
	parent.add_child(d)
	var list := runs(track_id)
	if list.is_empty():
		d.box.add_child(MenuStyle.label("No runs over this distance yet. Drive the strip and your runs are kept here.", 15, MenuStyle.MUTED, true))
	else:
		var grid := GridContainer.new()
		grid.columns = 6
		grid.add_theme_constant_override("h_separation", 18)
		grid.add_theme_constant_override("v_separation", 4)
		for h in ["#", "Car", "R/T", "Time", "Top speed", ""]:
			grid.add_child(MenuStyle.label(h, 13, MenuStyle.MUTED))
		var n := 0
		for run: Dictionary in list:
			n += 1
			grid.add_child(MenuStyle.label(str(n), 15))
			var car_label := MenuStyle.label(str(run.get("car", "?")), 15, MenuStyle.HEAD)
			car_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			grid.add_child(car_label)
			grid.add_child(MenuStyle.label(_t(float(run.get("rt", -1))), 15))
			grid.add_child(MenuStyle.label(_t(float(run.get("et", -1))), 15))
			grid.add_child(MenuStyle.label(Settings.speed_text(float(run.get("top", 0))), 15))
			grid.add_child(MenuStyle.button("Ticket", "", _ticket.bind(parent, run)))
		d.box.add_child(grid)
	d.foot([MenuStyle.button("Close", "primary", d.close)])
	d.focus_first.call_deferred()
	return d


## The time slip of a run.
static func _ticket(parent: Node, run: Dictionary) -> void:
	var d := MenuDialog.new("Time slip", str(run.get("car", "")), 420)
	parent.add_child(d)
	d.box.add_child(MenuStyle.label("R/T  %s" % _t(float(run.get("rt", -1))), 16))
	for sp in run.get("splits", []):
		d.box.add_child(MenuStyle.label("%s  %s  %s" % [sp[0], _t(float(sp[1])), Settings.speed_text(float(sp[2]))], 16))
	d.box.add_child(MenuStyle.label("Top speed  %s" % Settings.speed_text(float(run.get("top", 0))), 16))
	d.foot([MenuStyle.button("Close", "primary", d.close)])
	d.focus_first.call_deferred()


static func _t(v: float) -> String:
	return "–" if v < 0.0 else "%.3f s" % v


static func _length_name(m: float) -> String:
	if absf(m - 402.336) < 1.0:
		return "1/4 mile"
	if absf(m - 201.168) < 1.0:
		return "1/8 mile"
	if absf(m - 304.8) < 1.0:
		return "1000 ft"
	if absf(m - 804.672) < 1.0:
		return "1/2 mile"
	return "%d m" % roundi(m)
