class_name CarEditorEngine
extends RefCounted
## The Engine and the Engine sound cards of the car editor (car-editor.js): the engine block (EngineBuild: the torque curve
## follows from the block, the cam, the inlet and the exhaust, the fuel and a turbo or supercharger, every field within the
## limits the others allow), the exhaust, Simple (power and max rpm) or Advanced, the chart of the torque and the power with
## Run dyno (a full-throttle pull at the wheels), the engine speeds; the settings of the engine sound in a window, and the
## test bar over the view that plays the sound (the native EngineSimSynth of the game) at an engine speed and a throttle.

const BUILD_FIELDS := [["bore", "bore (mm)", 0.5, "bore"], ["stroke", "stroke (mm)", 0.5, "stroke"], ["compression", "compression", 0.1, "compression"],
	["cam_duration", "cam duration (°)", 2, "cam"], ["intake_flow", "inlet flow (cfm)", 5, "intake"], ["exhaust_flow", "exhaust flow (cfm)", 5, "exhaust"],
	["primary_length", "header length (m)", 0.05, "primary"], ["exhaust_length", "exhaust length (m)", 0.1, "exhaustLen"],
	["lambda", "mixture (λ, rich < 1)", 0.01, "lambda"],
	["induction.boost", "boost (bar)", 0.05, "boost"], ["ambient.celsius", "air (°C)", 1, "temp"], ["ambient.altitude", "altitude (m)", 50, "altitude"]]
const SOUND_FIELDS := [
	["Cylinder"], ["bore", "bore (mm)", 0.5], ["stroke", "stroke (mm)", 0.5], ["rod", "rod (mm)", 1],
	["compression_ratio", "compression ratio", 0.1], ["burn_duration", "burn (crank °)", 1], ["burn_randomness", "burn randomness", 0.05],
	["Camshaft (duration in crank °, lift in mm, lobes from TDC)"], ["intake_duration", "intake duration", 2], ["intake_lift", "intake lift", 0.1],
	["intake_lobe_centre", "intake centre", 1], ["exhaust_duration", "exhaust duration", 2], ["exhaust_lift", "exhaust lift", 0.1],
	["exhaust_lobe_centre", "exhaust centre", 1],
	["Ports (flow at full lift, cfm at 28 inH2O)"], ["intake_flow", "intake port", 10], ["exhaust_flow", "exhaust port", 10],
	["idle_pressure", "manifold at idle (atm)", 0.05],
	["Exhaust (lengths in metres, flows in cfm)"], ["primary_length", "primary tube length", 0.05], ["primary_flow", "primary flow", 10],
	["exhaust_length", "exhaust length", 0.1], ["outlet_flow", "outlet flow", 10], ["collector_area", "collector area (cm²)", 1],
	["The mix of engine-sim"], ["hf_gain", "high frequency gain", 0.005], ["noise", "low frequency noise", 0.05], ["jitter", "high frequency noise", 0.05],
	["volume", "volume", 0.05], ["audio_volume", "exhaust volume", 0.1], ["simulation_frequency", "simulation (Hz)", 1000],
]
const MIX_RATE := 44100.0

var ed: CarEditor
var dyno_best_hp := 0.0
var top_kmh := 0
var build_result: Dictionary = {}
var crash_pane: VBoxContainer       # the tab Crash test of the test bar (the Soft body card fills it)
var _block: OptionButton
var _exhaust: OptionButton
var _info: Label
var _simple_hp: EditorStyle.NumberField
var _simple_rpm: EditorStyle.NumberField
var _simple_row: Control
var _advanced: VBoxContainer
var _build_box: VBoxContainer
var _mode_buttons: Array = []
var _chart: Control
var _dyno_button: Button
var _dyno_info: Label
var _build_fields := {}              # key -> NumberField
var _speed_fields := {}              # idle, limiter, inertia
var _valves: OptionButton
var _fuel: OptionButton
var _induction: OptionButton
var _variant: OptionButton
var _size: OptionButton
var _intercooler: OptionButton
var _variant_box: Control
var _boost_row: Control
var _size_box: Control
var _timing: LineEdit
var _sound_dialog: Dictionary = {}
var _advanced_on := false
var _dyno: Dictionary = {}           # { points, up_to, time, gear, room }
var _test_bar: PanelContainer
var _play: Button
var _rpm: HSlider
var _throttle: HSlider
var _rpm_label: Label
var _throttle_label: Label
var _inside: CheckBox
var _synth: Object = null
var _player: AudioStreamPlayer
var _playback: AudioStreamGeneratorPlayback
var _playing := false
var _sweep := -1.0
var _ir_name := ""
var _refreshing := false


func _init(editor: CarEditor) -> void:
	ed = editor


# ---- the Engine card

func build_engine_card() -> void:
	var c := ed.add_card("Engine")
	var b: VBoxContainer = c["body"]
	var blocks := [["", "Choose an engine block…"]]
	for n in EngineBuild.PRESETS:
		blocks.append([n, n])
	_block = EditorStyle.options(blocks)
	_block.tooltip_text = "The block gives the cylinders, bore, stroke, cam, inlet and exhaust; the torque curve is worked out from the build and measured with Run dyno"
	_block.item_selected.connect(func(_i: int): _block_chosen())
	b.add_child(EditorStyle.labelled(_block, "Engine block"))
	_info = EditorStyle.hint("")
	b.add_child(_info)
	var ex := [["custom", "Custom (as it was set before)"]]
	for e in EngineBuild.EXHAUST_LABELS:
		ex.append([e[0], "%s · %s" % [e[1], e[2]]])
	_exhaust = EditorStyle.options(ex)
	_exhaust.tooltip_text = "How the exhaust sounds: the engine sound follows the block and this choice"
	_exhaust.item_selected.connect(func(_i: int):
		if _refreshing:
			return
		Tuning.write(ed.cfg, "sound.engine_sim.exhaust_type", EditorStyle.value_of(_exhaust))
		sound_changed()
		ed.changed())
	b.add_child(EditorStyle.labelled(_exhaust, "Exhaust"))
	var seg := HBoxContainer.new()
	seg.add_theme_constant_override("separation", 0)
	for m in [["simple", "Simple"], ["advanced", "Advanced"]]:
		var btn := EditorStyle.button(m[1], "small")
		btn.pressed.connect(func(): set_mode(m[0] == "advanced"))
		seg.add_child(btn)
		_mode_buttons.append(btn)
	b.add_child(seg)
	_simple_row = EditorStyle.row(b)
	_simple_hp = EditorStyle.NumberField.new("power (hp)", 5)
	_simple_hp.edit.editable = false
	_simple_hp.tooltip_text = "The power follows from the engine"
	_simple_row.add_child(_simple_hp)
	_simple_rpm = EditorStyle.NumberField.new("max rpm", 100, 2000.0, 20000.0)
	_simple_rpm.committed.connect(func(v: float):
		if Tuning.read(ed.cfg, "engine.build") is Dictionary and v > 1000.0:
			ed.cfg["engine"]["limiter_rpm"] = roundf(v)
			ed.refresh_fields()
			_speeds_changed()
			ed.changed())
	_simple_row.add_child(_simple_rpm)
	_chart = Chart.new()
	_chart.engine = self
	_chart.custom_minimum_size = Vector2(0, 175)
	b.add_child(_chart)
	b.add_child(EditorStyle.hint("— torque (Nm, orange)   — power (hp, blue)   - - at the wheels (the dyno)   | rev limit (red)"))
	var dr := HBoxContainer.new()
	_dyno_button = EditorStyle.button("▶ Run dyno", "small",
		"A full-throttle pull in the gear closest to 1:1, measured at the wheels of a car that stands on rollers: the " +
		"drivetrain (efficiency) and the rolling of the tyres count, air drag and grip do not. Only the chart changes.")
	_dyno_button.pressed.connect(run_dyno)
	dr.add_child(_dyno_button)
	_dyno_info = EditorStyle.hint("")
	dr.add_child(_dyno_info)
	b.add_child(dr)
	_advanced = VBoxContainer.new()
	b.add_child(_advanced)
	_build_box = VBoxContainer.new()
	_advanced.add_child(_build_box)
	_build_ui()
	_advanced.add_child(EditorStyle.group("Engine speeds"))
	var r := EditorStyle.row(_advanced)
	_speed_fields["idle"] = ed.bind_number(r, "engine.idle_rpm", "idle (rpm)", 50, 300.0, 4000.0, 1.0, "", _speeds_changed)
	_speed_fields["limiter"] = ed.bind_number(r, "engine.limiter_rpm", "rev limit (rpm)", 100, 1500.0, 20000.0, 1.0, "", _speeds_changed)
	_speed_fields["inertia"] = ed.bind_number(r, "engine.inertia", "inertia (kg m²)", 0.05, 0.01, 3.0)
	set_mode(false)


func _build_ui() -> void:
	var bx := _build_box
	var f := func(row: Control, key: String) -> EditorStyle.NumberField:
		for d in BUILD_FIELDS:
			if d[0] == key:
				var field := ed.bind_number(row, "engine.build." + key, d[1], d[2], 0.0, 1.0, 1.0, "", func(): _build_edited(false))
				_build_fields[key] = field
				return field
		return null
	bx.add_child(EditorStyle.group("Block and cam"))
	var r := EditorStyle.row(bx)
	f.call(r, "bore")
	f.call(r, "stroke")
	f.call(r, "compression")
	r = EditorStyle.row(bx)
	f.call(r, "cam_duration")
	var vb := VBoxContainer.new()
	vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_valves = ed.bind_select(vb, "engine.build.valves", [[2, "2"], [3, "3"], [4, "4"], [5, "5"]], func(): _build_edited(false), 4)
	vb.add_child(EditorStyle.hint("valves per cylinder"))
	r.add_child(vb)
	bx.add_child(EditorStyle.group("Inlet and exhaust"))
	r = EditorStyle.row(bx)
	f.call(r, "intake_flow")
	f.call(r, "exhaust_flow")
	r = EditorStyle.row(bx)
	f.call(r, "primary_length")
	f.call(r, "exhaust_length")
	bx.add_child(EditorStyle.group("Fuel"))
	r = EditorStyle.row(bx)
	var fuels := []
	for k in EngineBuild.FUELS:
		fuels.append([k, EngineBuild.FUELS[k]["label"]])
	var fb := VBoxContainer.new()
	fb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_fuel = ed.bind_select(fb, "engine.build.fuel", fuels, func(): _build_edited(false), "pump95")
	fb.add_child(EditorStyle.hint("fuel"))
	r.add_child(fb)
	f.call(r, "lambda")
	bx.add_child(EditorStyle.group("Turbo or supercharger"))
	r = EditorStyle.row(bx)
	var ib := VBoxContainer.new()
	ib.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_induction = ed.bind_select(ib, "engine.build.induction.type", [["none", "None"], ["turbo", "Turbo"], ["supercharger", "Supercharger"]], func():
		_fill_variants()
		Tuning.write(ed.cfg, "engine.build.induction.variant", EditorStyle.value_of(_variant))
		_build_edited(false), "none")
	ib.add_child(EditorStyle.hint("induction"))
	r.add_child(ib)
	_variant_box = VBoxContainer.new()
	_variant_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_variant = ed.bind_select(_variant_box, "engine.build.induction.variant", [["single", "Single"]], func(): _build_edited(false), "single")
	_variant_box.add_child(EditorStyle.hint("type"))
	r.add_child(_variant_box)
	_boost_row = EditorStyle.row(bx)
	_size_box = VBoxContainer.new()
	_size_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var sizes := []
	for k in EngineBuild.TURBO_SIZES:
		sizes.append([k, EngineBuild.TURBO_SIZES[k]["label"]])
	_size = ed.bind_select(_size_box, "engine.build.induction.size", sizes, func(): _build_edited(false), "medium")
	_size_box.add_child(EditorStyle.hint("size"))
	_boost_row.add_child(_size_box)
	f.call(_boost_row, "induction.boost")
	var icb := VBoxContainer.new()
	icb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var ics := []
	for k in EngineBuild.INTERCOOLERS:
		ics.append([k, EngineBuild.INTERCOOLERS[k]["label"]])
	_intercooler = ed.bind_select(icb, "engine.build.induction.intercooler", ics, func(): _build_edited(false), "air")
	icb.add_child(EditorStyle.hint("intercooler"))
	_boost_row.add_child(icb)
	bx.add_child(EditorStyle.group("Dyno room"))
	r = EditorStyle.row(bx)
	f.call(r, "ambient.celsius")
	f.call(r, "ambient.altitude")


func _fill_variants() -> void:
	var turbo := str(Tuning.read(ed.cfg, "engine.build.induction.type")) == "turbo"
	var list: Dictionary = EngineBuild.TURBO_VARIANTS if turbo else EngineBuild.SUPERCHARGERS
	var keep: Variant = Tuning.read(ed.cfg, "engine.build.induction.variant")
	_variant.clear()
	for k in list:
		_variant.add_item(list[k]["label"])
		_variant.set_item_metadata(_variant.item_count - 1, k)
	EditorStyle.select_value(_variant, keep if keep != null and list.has(str(keep)) else list.keys()[0])


func set_mode(advanced: bool) -> void:
	_advanced_on = advanced
	_advanced.visible = advanced
	_simple_row.visible = not advanced
	for i in _mode_buttons.size():
		EditorStyle.style_button(_mode_buttons[i], "small" + (" on" if (i == 1) == advanced else " ghost"))
	_apply_build_ui()
	_chart.queue_redraw()


func _has_build() -> bool:
	return Tuning.read(ed.cfg, "engine.build") is Dictionary and Tuning.read(ed.cfg, "engine.build.bore") != null


func _block_chosen() -> void:
	if _refreshing:
		return
	var nm := str(EditorStyle.value_of(_block))
	if nm == "":
		return
	var build := EngineBuild.from_preset(nm)
	ed.cfg["engine"]["build"] = build
	ed.cfg["engine"]["limiter_rpm"] = EngineBuild.compute(build, 9000.0, ed.num("engine.idle_rpm", 850.0))["suggestedLimiter"]
	_sync_sound_from_build(build, true)
	_refresh_build_fields()
	recompute_build()
	ed.changed()


func _refresh_build_fields() -> void:
	_refreshing = true
	ed.refresh_fields()
	_fill_variants()
	_refreshing = false


func _build_edited(_unused: bool) -> void:
	if not _has_build():
		return
	_sync_sound_from_build(ed.cfg["engine"]["build"], false)
	recompute_build()


func _speeds_changed() -> void:
	if _has_build():
		recompute_build()
	clear_dyno()
	_chart.queue_redraw()
	update_speed_info()
	_rpm.max_value = roundf(ed.num("engine.limiter_rpm", 7000.0) * 1.1)


## The limits of the build fields follow from the others (EngineBuild.limits): a value they no longer allow is pulled in.
func _update_limits() -> bool:
	var changed := false
	if not _has_build():
		for pair in [["idle", 300.0, 4000.0], ["limiter", 1500.0, 20000.0], ["inertia", 0.01, 3.0]]:
			(_speed_fields[pair[0]] as EditorStyle.NumberField).set_range(pair[1], pair[2])
		return false
	var b: Dictionary = ed.cfg["engine"]["build"]
	var lim := EngineBuild.limits(b, ed.num("engine.limiter_rpm", 7000.0), ed.num("engine.idle_rpm", 850.0))
	for d in BUILD_FIELDS:
		var f: EditorStyle.NumberField = _build_fields[d[0]]
		var l: Array = lim[d[3]]
		f.set_range(float(l[0]), float(l[1]), str(l[2]))
		var v: Variant = Tuning.read(ed.cfg, "engine.build." + d[0])
		if v != null and (float(v) < minf(l[0], l[1]) or float(v) > maxf(l[0], l[1])):
			Tuning.write(ed.cfg, "engine.build." + d[0], clampf(float(v), minf(l[0], l[1]), maxf(l[0], l[1])))
			changed = true
	for k in ["idle", "limiter", "inertia"]:
		var l: Array = lim[k]
		(_speed_fields[k] as EditorStyle.NumberField).set_range(float(l[0]), float(l[1]), str(l[2]))
		var path: String = {"idle": "engine.idle_rpm", "limiter": "engine.limiter_rpm", "inertia": "engine.inertia"}[k]
		var v := ed.num(path)
		if v < minf(l[0], l[1]) or v > maxf(l[0], l[1]):
			Tuning.write(ed.cfg, path, clampf(v, minf(l[0], l[1]), maxf(l[0], l[1])))
			changed = true
	if not int(Tuning.read(b, "valves") if Tuning.read(b, "valves") != null else 4) in lim["valves"]:
		b["valves"] = lim["valves"][-1]
		changed = true
	for i in _valves.item_count:
		_valves.set_item_disabled(i, not int(_valves.get_item_metadata(i)) in lim["valves"])
	for i in _size.item_count:
		_size.set_item_disabled(i, not str(_size.get_item_metadata(i)) in lim["turboSizes"])
	if str(Tuning.read(b, "induction.type")) == "turbo":
		for i in _variant.item_count:
			_variant.set_item_disabled(i, not str(_variant.get_item_metadata(i)) in lim["turboVariants"])
	return changed


## The curve, the turbo of the game and the chart follow the build.
func recompute_build() -> void:
	if not _has_build():
		build_result = {}
		_apply_build_ui()
		return
	for i in 3:
		if not _update_limits():
			break
	var b: Dictionary = ed.cfg["engine"]["build"]
	var res := EngineBuild.compute(b, ed.num("engine.limiter_rpm", 7000.0), ed.num("engine.idle_rpm", 850.0))
	build_result = res
	ed.cfg["engine"]["torque_curve"] = (res["curve"] as Array).duplicate(true)
	var spec := EngineBuild.turbo_spec(b)
	if not spec.is_empty():
		var ind: Dictionary = b["induction"]
		Tuning.set_value(ed.cfg, "turbo_share", roundf(float(res["boostShare"]) * 100.0 / 5.0) * 5.0)
		Tuning.set_value(ed.cfg, "turbo_boost", 0.0)
		Tuning.set_value(ed.cfg, "turbo_spool", spec["spool"])
		Tuning.set_value(ed.cfg, "turbo_threshold", spec["threshold"])
		Tuning.set_value(ed.cfg, "turbo_intercooler", roundf(float(EngineBuild.INTERCOOLERS.get(str(ind.get("intercooler", "air")), {"value": 0.65})["value"]) * 100.0))
		Tuning.set_value(ed.cfg, "turbo_efficiency", 72.0)
		Tuning.set_value(ed.cfg, "boost_full", float(ind.get("boost", 0.6)))
	else:
		Tuning.erase(ed.cfg, "engine.turbo")
	_refresh_build_fields()
	ed.suspension.refresh(false)
	ed.tuning.render_groups()
	clear_dyno()
	_chart.queue_redraw()
	update_speed_info()
	_apply_build_ui()


func _apply_build_ui() -> void:
	var has := _has_build()
	_build_box.visible = has
	var t := str(Tuning.read(ed.cfg, "engine.build.induction.type"))
	_variant_box.visible = t != "none" and t != "<null>"
	_boost_row.visible = t != "none" and t != "<null>"
	_size_box.visible = t == "turbo"
	_simple_rpm.edit.editable = has
	_simple_rpm.tooltip_text = "The rev limit of the engine" if has else "Choose an engine block first"
	_block.set_item_disabled(0, has)
	var res := build_result
	if has and not res.is_empty():
		_info.text = "%.1f L, %d cylinders · %d hp at %d rpm · piston speed at the limit %d m/s%s%s" % [res["displacement"], res["cylinders"], roundi(res["peakPower"]),
			res["peakPowerRpm"], roundi(res["pistonSpeedAtLimit"]), " (too fast for the engine to last)" if float(res["pistonSpeedAtLimit"]) > 25.0 else "",
			(" · knock: %d%% of the torque is lost, use better fuel or less boost" % roundi(float(res["knock"]) * 100.0)) if float(res["knock"]) > 0.03 else ""]
	else:
		_info.text = "This car still has an old torque curve that cannot be changed. Choose an engine block to build its engine: the curve then follows from it."
	_update_limits()


## The engine sound follows the engine that is built (the same bore, stroke, compression, cam, flows and lengths).
func _sync_sound_from_build(b: Dictionary, whole_preset: bool) -> void:
	var es: Dictionary = ed.cfg["sound"]["engine_sim"]
	if whole_preset and EngineBuild.PRESETS.has(str(b.get("block", ""))):
		es.merge(EngineBuild.PRESETS[b["block"]], true)
		es["exhaust_type"] = _default_exhaust(str(b["block"]))
	es.merge({"bore": b["bore"], "stroke": b["stroke"], "compression_ratio": b["compression"], "intake_duration": b["cam_duration"],
		"exhaust_duration": maxf(180.0, float(b["cam_duration"]) - 4.0), "intake_flow": b["intake_flow"], "exhaust_flow": b["exhaust_flow"],
		"primary_length": b["primary_length"], "exhaust_length": b["exhaust_length"]}, true)
	_refreshing = true
	EditorStyle.select_value(_exhaust, es.get("exhaust_type", "custom"))
	_refreshing = false
	sound_changed()


static func _default_exhaust(block: String) -> String:
	if RegEx.create_from_string("kart|Single 0.4|Twin").search(block) != null:
		return "straight"
	if RegEx.create_from_string("supersport|superbike|triple|thumper").search(block) != null:
		return "performance"
	if RegEx.create_from_string("flatplane|V10|V12|Flat-6").search(block) != null:
		return "sport"
	return "standard"


func update_speed_info() -> void:
	var meta: Label = ed.card_of["Drivetrain"]["meta"] if ed.card_of.has("Drivetrain") else null
	if meta == null:
		return
	var gears: Array = Tuning.read(ed.cfg, "drivetrain.gear_ratios") if Tuning.read(ed.cfg, "drivetrain.gear_ratios") is Array else []
	var r := ed.num("chassis.tire_diameter", 0.65) / 2.0
	var final := ed.num("drivetrain.final_drive")
	var limiter := ed.num("engine.limiter_rpm")
	if gears.is_empty() or not (final > 0.0) or not (limiter > 0.0):
		meta.text = ""
		top_kmh = 0
		return
	var top := CarEditorIO.top_speed(ed.cfg)
	top_kmh = roundi(top * 3.6)
	meta.text = "Top speed ~%d km/h" % top_kmh if top > 0.0 else ""
	var parts := []
	for i in gears.size():
		parts.append("gear %d: %d km/h" % [i + 1, roundi(limiter * PI / 30.0 * r / (float(gears[i]) * final) * 3.6)])
	meta.tooltip_text = "At the rev limit: " + ", ".join(parts)


# ---- the chart and the dyno

func peak() -> Dictionary:
	var best := {"hp": 0.0, "rpm": 0.0}
	var nm := 0.0
	for p in Tuning.read(ed.cfg, "engine.torque_curve") if Tuning.read(ed.cfg, "engine.torque_curve") is Array else []:
		var hp := float(p[1]) * float(p[0]) * PI / 30.0 / 745.7
		if hp > best["hp"]:
			best = {"hp": hp, "rpm": float(p[0])}
		nm = maxf(nm, float(p[1]))
	best["nm"] = nm
	return best


func clear_dyno() -> void:
	if _dyno.is_empty():
		return
	_dyno = {}
	dyno_best_hp = 0.0
	_dyno_button.disabled = false
	_dyno_info.text = ""


func _dyno_pull() -> Dictionary:
	var gears: Array = Tuning.read(ed.cfg, "drivetrain.gear_ratios") if Tuning.read(ed.cfg, "drivetrain.gear_ratios") is Array else []
	var final := ed.num("drivetrain.final_drive")
	var limit := ed.num("engine.limiter_rpm")
	var r := ed.num("chassis.tire_diameter", 0.65) / 2.0
	var mass := ed.num("chassis.mass", 1000.0)
	var curve: Array = (Tuning.read(ed.cfg, "engine.torque_curve") as Array).duplicate(true) if Tuning.read(ed.cfg, "engine.torque_curve") is Array else []
	if gears.is_empty() or not (final > 0.0) or not (limit > 0.0) or curve.size() < 2:
		return {}
	curve.sort_custom(func(a, b): return float(a[0]) < float(b[0]))
	var ratio: float = gears[0]
	for g in gears:
		if absf(float(g) - 1.0) < absf(ratio - 1.0):
			ratio = g
	var big_g := ratio * final
	var eff := ed.num("drivetrain.efficiency", 0.92)
	var room := 1.0
	if _has_build():
		room = 1.0 / EngineBuild.correction(float(Tuning.read(ed.cfg, "engine.build.ambient.altitude") if Tuning.read(ed.cfg, "engine.build.ambient.altitude") != null else 0),
			float(Tuning.read(ed.cfg, "engine.build.ambient.celsius") if Tuning.read(ed.cfg, "engine.build.ambient.celsius") != null else 20))
	var torque_at := func(rpm: float) -> float:
		if rpm > float(curve[-1][0]):
			return 0.0
		for i in range(1, curve.size()):
			if rpm <= float(curve[i][0]):
				var a: Array = curve[i - 1]
				var b: Array = curve[i]
				var f := (rpm - float(a[0])) / (float(b[0]) - float(a[0])) if float(b[0]) > float(a[0]) else 0.0
				return (float(a[1]) + (float(b[1]) - float(a[1])) * f) * room
		return 0.0
	var rolling := 0.012 * mass * 9.81
	var meff := mass + ed.num("engine.inertia", 0.3) * big_g * big_g / (r * r)
	var rpm := maxf(ed.num("engine.idle_rpm", 850.0) * 1.4, limit * 0.25)
	var v := rpm * PI / 30.0 * r / big_g
	var last := -1e9
	var points := []
	var t := 0.0
	while t < 120.0 and rpm < limit:
		var net: float = torque_at.call(rpm) * big_g * eff / r - rolling
		if rpm - last >= 50.0:
			points.append({"rpm": rpm, "nm": maxf(0.0, net * r / big_g), "hp": maxf(0.0, net * v / 745.7)})
			last = rpm
		if net <= 0.0 and rpm > float(curve[1][0]):
			break
		v += maxf(net, 0.0) / meff * 0.01 + 0.002
		rpm = v * 30.0 / PI * big_g / r
		t += 0.01
	return {"points": points, "gear": gears.find(ratio) + 1, "room": room} if points.size() > 3 else {}


func run_dyno() -> void:
	clear_dyno()
	var run := _dyno_pull()
	if run.is_empty():
		_dyno_info.text = "Needs gears, a final drive, a rev limit and a curve."
		return
	_dyno = run
	_dyno["up_to"] = 0
	_dyno["time"] = 0.0
	_dyno_button.disabled = true
	if not _playing:
		play()
		_dyno["sound"] = true


func _dyno_frame(delta: float) -> void:
	if _dyno.is_empty() or _dyno.has("done"):
		return
	_dyno["time"] = float(_dyno["time"]) + delta
	var f := clampf(float(_dyno["time"]) / 4.5, 0.0, 1.0)
	var pts: Array = _dyno["points"]
	_dyno["up_to"] = floori(f * (pts.size() - 1))
	if _playing:
		_rpm.value = pts[_dyno["up_to"]]["rpm"]
		_throttle.value = 100
	_chart.queue_redraw()
	if f < 1.0:
		return
	_dyno["done"] = true
	_dyno_button.disabled = false
	if _playing:
		_throttle.value = 0
		_sweep = -2.0
	var best: Dictionary = pts[0]
	for p in pts:
		if p["hp"] > best["hp"]:
			best = p
	dyno_best_hp = best["hp"]
	var eng := float(peak()["hp"])
	_dyno_info.text = "At the wheels (dashed): %d hp at %d rpm, %d%% below the engine · gear %d%s" % [roundi(best["hp"]), roundi(float(best["rpm"]) / 10.0) * 10,
		roundi(100.0 * (1.0 - float(best["hp"]) / maxf(1.0, eng))), _dyno["gear"],
		(" · in this air; corrected (DIN) %d hp" % roundi(float(best["hp"]) / float(_dyno["room"]))) if _has_build() and float(_dyno["room"]) != 1.0 else ""]
	ed.update_summary()


## The chart of the Engine card: the torque (orange) and the power (blue) on one scale, the rev limit (red), the dyno (dashed).
class Chart:
	extends Control
	var engine: CarEditorEngine

	func _draw() -> void:
		var ed := engine.ed
		var w := size.x
		var h := size.y
		draw_rect(Rect2(Vector2.ZERO, size), Color("#12161c"))
		var curve: Array = Tuning.read(ed.cfg, "engine.torque_curve") if Tuning.read(ed.cfg, "engine.torque_curve") is Array else []
		var max_rpm := ed.num("engine.limiter_rpm", 7000.0)
		var top := 1.0
		for p in curve:
			max_rpm = maxf(max_rpm, float(p[0]))
			top = maxf(top, maxf(float(p[1]), float(p[1]) * float(p[0]) * PI / 30.0 / 745.7))
		max_rpm *= 1.05
		top *= 1.08
		var step := 1.0
		for m in [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]:
			step = m
			if top / m <= 7.0:
				break
		var max_y := ceilf(top / step) * step
		var left := 34.0
		var bottom := h - 14.0
		var pw := w - left - 4.0
		var ph := bottom - 6.0
		var font := get_theme_default_font()
		var xr := func(rpm: float) -> float: return left + rpm / max_rpm * pw
		var yv := func(v: float) -> float: return bottom - v / max_y * ph
		var v := 0.0
		while v <= max_y + 1e-9:
			draw_line(Vector2(left, yv.call(v)), Vector2(w, yv.call(v)), Color("#2c3541"))
			draw_string(font, Vector2(2, clampf(yv.call(v) + 4.0, 10.0, bottom)), str(int(v)), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color("#8a97aa"))
			v += step
		var r := 0.0
		while r <= max_rpm:
			draw_line(Vector2(xr.call(r), 0), Vector2(xr.call(r), bottom), Color("#2c3541"))
			draw_string(font, Vector2(xr.call(r) + 2.0, h - 2.0), "%dk" % int(r / 1000.0), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color("#6f7d92"))
			r += 1000.0
		var tq := PackedVector2Array()
		var pwr := PackedVector2Array()
		for p in curve:
			tq.append(Vector2(xr.call(float(p[0])), yv.call(float(p[1]))))
			pwr.append(Vector2(xr.call(float(p[0])), yv.call(float(p[1]) * float(p[0]) * PI / 30.0 / 745.7)))
		if tq.size() > 1:
			draw_polyline(tq, Color("#ff9f43"), 2.0, true)
			draw_polyline(pwr, Color("#54a0ff"), 2.0, true)
		var dyno := engine._dyno
		if not dyno.is_empty():
			var shown: Array = (dyno["points"] as Array).slice(0, int(dyno["up_to"]) + 1)
			for kind in [["nm", Color("#ffd29a")], ["hp", Color("#a9cdff")]]:
				var line := PackedVector2Array()
				for p in shown:
					line.append(Vector2(xr.call(float(p["rpm"])), yv.call(float(p[kind[0]]))))
				for i in range(0, line.size() - 1, 2):
					draw_line(line[i], line[i + 1], kind[1], 2.0)
			if not dyno.has("done") and not shown.is_empty():
				draw_line(Vector2(xr.call(float(shown[-1]["rpm"])), 0), Vector2(xr.call(float(shown[-1]["rpm"])), bottom), Color.WHITE, 1.5)
		var lx: float = xr.call(ed.num("engine.limiter_rpm"))
		draw_line(Vector2(lx, 0), Vector2(lx, bottom), Color("#ff5e5e"), 1.5)
		var pk := engine.peak()
		var meta: Label = ed.card_of["Engine"]["meta"]
		meta.text = "%d hp at %d rpm, %d Nm%s" % [roundi(pk["hp"]), roundi(pk["rpm"]), roundi(pk["nm"]),
			(" · %d hp at the wheels" % roundi(engine.dyno_best_hp)) if engine.dyno_best_hp > 0.0 else ""]
		if not engine._simple_hp.edit.has_focus():
			engine._simple_hp.set_value(roundf(pk["hp"]))
		if not engine._simple_rpm.edit.has_focus():
			engine._simple_rpm.set_value(ed.num("engine.limiter_rpm"))


# ---- the Engine sound card and its window

func build_sound_card() -> void:
	var c := ed.add_card("Engine sound")
	var b: VBoxContainer = c["body"]
	b.add_child(EditorStyle.tipline("Press Play in the view to listen", "The gas in every cylinder is simulated and the pressure in the exhaust is played through " +
		"the recorded impulse response of an exhaust (after engine-sim). Press Play in the test bar of the view (Tests) to listen while you change the settings."))
	var r := EditorStyle.row(b)
	ed.bind_number(r, "sound.engine_sim.convolution", "exhaust effect", 0.05, 0.0, 1.0, 1.0, "", sound_changed)
	r.add_child(Control.new())
	var link := EditorStyle.row(b)
	link.add_child(EditorStyle.hint("The sound follows the engine block and the exhaust of the Engine card"))
	var all := EditorStyle.button("All settings…", "small")
	all.pressed.connect(func(): (_sound_dialog["window"] as Window).popup_centered())
	link.add_child(all)
	_sound_dialog = EditorStyle.dialog(ed, "Engine sound settings", Vector2(640, 640))
	var d: VBoxContainer = _sound_dialog["body"]
	d.add_child(EditorStyle.tipline("Lower the rate if the sound stutters", "The gas in every cylinder is simulated: compression, the burn, the valves, the exhaust " +
		"runners and the collector. The simulation rate sets how much of the computer it costs; lower it if the sound stutters."))
	var row: HBoxContainer = null
	for f in SOUND_FIELDS:
		if f.size() == 1:
			d.add_child(EditorStyle.group(f[0]))
			row = null
			continue
		if row == null or row.get_child_count() >= 3:
			row = EditorStyle.row(d)
		ed.bind_number(row, "sound.engine_sim." + f[0], f[1], f[2], NAN, NAN, 1.0, "", sound_changed)
	var sys_row := EditorStyle.row(d)
	ed.bind_select(sys_row, "sound.engine_sim.exhaust_systems", [[1, "one exhaust"], [2, "two (per bank)"]], sound_changed, 1)
	sys_row.add_child(EditorStyle.hint("exhaust systems"))
	d.add_child(EditorStyle.label("Ignition timing (rpm:degrees, comma separated)", 12, Color("#b9c3d0")))
	_timing = EditorStyle.line_edit()
	_timing.text_submitted.connect(func(_t: String): _timing_edited())
	_timing.focus_exited.connect(_timing_edited)
	d.add_child(_timing)


func _timing_edited() -> void:
	var list := []
	for part in _timing.text.split(",", false):
		var kv := part.strip_edges().split(":")
		if kv.size() == 2 and kv[0].is_valid_float() and kv[1].is_valid_float():
			list.append([float(kv[0]), float(kv[1])])
	list.sort_custom(func(a, b): return a[0] < b[0])
	if not list.is_empty():
		ed.cfg["sound"]["engine_sim"]["timing"] = list
		sound_changed()
		ed.changed()


## The car into the cards (a load, a tune, an undo).
func fill() -> void:
	_refreshing = true
	EditorStyle.select_value(_block, Tuning.read(ed.cfg, "engine.build.block") if _has_build() else "")
	EditorStyle.select_value(_exhaust, Tuning.read(ed.cfg, "sound.engine_sim.exhaust_type") if Tuning.read(ed.cfg, "sound.engine_sim.exhaust_type") else "custom")
	_fill_variants()
	var t: Variant = Tuning.read(ed.cfg, "sound.engine_sim.timing")
	var parts := []
	for p in (t if t is Array else []):
		parts.append("%s:%s" % [CarEditorIO._json(float(p[0]), ""), CarEditorIO._json(float(p[1]), "")])
	_timing.text = ", ".join(parts)
	_refreshing = false
	stop_sound()
	build_result = EngineBuild.compute(ed.cfg["engine"]["build"], ed.num("engine.limiter_rpm", 7000.0), ed.num("engine.idle_rpm", 850.0)) if _has_build() else {}
	_rpm.max_value = roundf(ed.num("engine.limiter_rpm", 7000.0) * 1.1)
	clear_dyno()
	_apply_build_ui()
	_chart.queue_redraw()
	update_speed_info()


# ---- the test bar over the view: the engine sound at an engine speed and a throttle

func build_test_bar() -> void:
	_test_bar = EditorStyle.float_panel()
	_test_bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_test_bar.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_test_bar.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_test_bar.position.y = -14
	_test_bar.visible = false
	ed.view.overlay.add_child(_test_bar)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 6)
	_test_bar.add_child(col)
	var tabs := HBoxContainer.new()
	col.add_child(tabs)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	col.add_child(row)
	crash_pane = VBoxContainer.new()
	crash_pane.visible = false
	col.add_child(crash_pane)
	_build_tabs(tabs, row)
	_play = EditorStyle.button("Play", "accent", "Play the engine sound of the form")
	_play.pressed.connect(func():
		if _playing:
			stop_sound()
		else:
			play())
	row.add_child(_play)
	var slider := func(title: String, lo: float, hi: float, value: float) -> Array:
		var box := VBoxContainer.new()
		box.add_theme_constant_override("separation", 0)
		var l := EditorStyle.label(title, 11, EditorStyle.MUTED, false)
		box.add_child(l)
		var s := HSlider.new()
		s.min_value = lo
		s.max_value = hi
		s.value = value
		s.custom_minimum_size.x = 112                # (room for the buttons of the tests: Drop car, Full test, Drive, ↺)
		s.focus_mode = Control.FOCUS_NONE
		box.add_child(s)
		row.add_child(box)
		return [s, l]
	var a: Array = slider.call("Engine speed", 0.0, 7000.0, 900.0)
	_rpm = a[0]
	_rpm_label = a[1]
	var t: Array = slider.call("Throttle", 0.0, 100.0, 0.0)
	_throttle = t[0]
	_throttle_label = t[1]
	_rpm.value_changed.connect(func(_v: float): _labels())
	_throttle.value_changed.connect(func(_v: float): _labels())
	var rev := EditorStyle.button("Rev", "small ghost", "Up to the rev limit with the throttle open and down again")
	rev.pressed.connect(func():
		if not _playing:
			play()
		_sweep = 0.0)
	row.add_child(rev)
	_inside = CheckBox.new()
	_inside.text = "cockpit"
	_inside.focus_mode = Control.FOCUS_NONE
	_inside.toggled.connect(func(on: bool):
		if _synth != null:
			_synth.set_inside(on))
	row.add_child(_inside)
	var sep := ColorRect.new()
	sep.color = Color("#2f3845")
	sep.custom_minimum_size = Vector2(1, 34)
	row.add_child(sep)
	var drop := EditorStyle.button("Drop car", "small accent", "Lets the car fall on its wheels from a height, with the physics of the game")
	row.add_child(drop)
	var h: Array = slider.call("Height", 0.1, 5.0, 1.0)
	(h[0] as HSlider).step = 0.1
	(h[0] as HSlider).custom_minimum_size.x = 90
	var tl: Array = slider.call("Tilt", 0.0, 30.0, 0.0)
	(tl[0] as HSlider).custom_minimum_size.x = 90
	var show_drop := func(_v: float):
		h[1].text = "Height  %.1f m" % h[0].value
		tl[1].text = "Tilt  %d°" % roundi(tl[0].value)
	(h[0] as HSlider).value_changed.connect(show_drop)
	(tl[0] as HSlider).value_changed.connect(show_drop)
	show_drop.call(0.0)
	drop.pressed.connect(func(): ed.bench.drop(h[0].value, tl[0].value))
	var full := EditorStyle.button("Full test", "small accent", "A drop from 1 m at 5°, the engine to the rev limiter in neutral, a metre " +
		"forwards and back, the steering to both locks, then a wall far ahead and full throttle into it")
	full.pressed.connect(func(): ed.bench.full_test())
	row.add_child(full)
	var drive := EditorStyle.button("Drive", "small accent", "Drive the car on the floor with the keys of the game: arrows or WASD, space is the handbrake, " +
		"the shift keys shift, R puts it back")
	drive.pressed.connect(func():
		ed.bench.toggle_drive()
		drive.text = "Stop driving" if ed.bench.driving else "Drive")
	row.add_child(drive)
	var back := EditorStyle.button("↺", "small ghost", "Stop the test: back to the model as it is")
	back.pressed.connect(func():
		ed.bench.stop()
		ed._hook_call("bench_stopped")
		drive.text = "Drive")
	tabs.add_child(back)
	_labels()
	ed._hook_call("crash_tab", [crash_pane])
	tabs.get_child(0).visible = crash_pane.get_child_count() > 0
	tabs.get_child(1).visible = crash_pane.get_child_count() > 0


## The tabs of the test bar (the browser's Tests | Crash test), and the room for ↺ at their right.
func _build_tabs(tabs: HBoxContainer, row: Control) -> void:
	var buttons := []
	for t in ["Tests", "Crash test"]:
		var b := EditorStyle.button(t, "small accent" if t == "Tests" else "small ghost")
		tabs.add_child(b)
		buttons.append(b)
	var show := func(crash: bool):
		row.visible = not crash
		crash_pane.visible = crash
		EditorStyle.style_button(buttons[0], "small ghost" if crash else "small accent")
		EditorStyle.style_button(buttons[1], "small accent" if crash else "small ghost")
	(buttons[0] as Button).pressed.connect(show.bind(false))
	(buttons[1] as Button).pressed.connect(show.bind(true))
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tabs.add_child(gap)


## The test bar is shown or hidden (the crash test hides it while it runs).
func show_test_bar(on: bool) -> void:
	_test_bar.visible = on


func test_bar_shown() -> bool:
	return _test_bar.visible


func toggle_test_bar() -> void:
	_test_bar.visible = not _test_bar.visible


func _labels() -> void:
	_rpm_label.text = "Engine speed  %d rpm" % roundi(_rpm.value)
	_throttle_label.text = "Throttle  %d%%" % roundi(_throttle.value)


func play() -> void:
	if not ClassDB.class_exists("EngineSimSynth"):
		ed.status("The native engine sound (EngineSimSynth) is not loaded: build godot/native (see README).", "error")
		return
	if _synth == null:
		_synth = ClassDB.instantiate("EngineSimSynth")
		_player = AudioStreamPlayer.new()
		var gen := AudioStreamGenerator.new()
		gen.mix_rate = MIX_RATE
		gen.buffer_length = 0.08
		_player.stream = gen
		ed.add_child(_player)
	_configure()
	_player.play()
	_playback = _player.get_stream_playback()
	_playing = true
	_synth.set_inside(_inside.button_pressed)
	_play.text = "Stop"


func _configure() -> void:
	if _synth == null:
		return
	var p := EngineSimParams.params(ed.cfg)
	_synth.configure(EngineSimParams.options(p), MIX_RATE)
	var ir := str(p["impulse_response"])
	if ir != _ir_name:
		var bytes := FileAccess.get_file_as_bytes(Content.path("sounds/ir/" + str(EngineSimParams.IMPULSE_RESPONSES.get(ir, "smooth_39.wav"))))
		if bytes.size() > 0:
			_synth.set_impulse_response_wav(bytes)
			_ir_name = ir


func sound_changed() -> void:
	if _playing:
		_configure()


func stop_sound() -> void:
	if _player != null:
		_player.stop()
	_playing = false
	_sweep = -1.0
	if _play != null:
		_play.text = "Play"


func frame(delta: float) -> void:
	_dyno_frame(delta)
	if _sweep >= 0.0:
		_sweep += delta
		var t := minf(1.0, _sweep / 6.0)
		var up := t * 2.0 if t < 0.5 else 2.0 - t * 2.0
		var idle := ed.num("engine.idle_rpm", 900.0)
		_rpm.value = idle + (ed.num("engine.limiter_rpm", 6500.0) - idle) * up
		_throttle.value = 100 if t < 0.5 else 0
		if t >= 1.0:
			_sweep = -1.0
	elif _sweep < -1.5:
		# (after the dyno: the engine runs down to idle, then the sound stops)
		var idle := ed.num("engine.idle_rpm", 900.0)
		_rpm.value = lerpf(_rpm.value, idle, 1.0 - exp(-delta / 1.5))
		if absf(_rpm.value - idle) < 30.0:
			_sweep = -1.0
			if _dyno.get("sound", false):
				stop_sound()
	if not _playing or _synth == null or _playback == null:
		return
	_synth.set_rpm(_rpm.value)
	_synth.set_throttle(_throttle.value / 100.0)
	_synth.set_ignition(true)
	var frames := _playback.get_frames_available()
	if frames > 0:
		_playback.push_buffer(_synth.generate(frames))
