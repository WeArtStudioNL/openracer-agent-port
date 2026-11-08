class_name TuningEngine
extends VBoxContainer
## The engine build in the Engine card of the tuning menu (EngineBuildUI.js, which the browser's tuning menu shares with
## its car editor; here the pieces of the car editor's Engine card, CarEditorEngine, are used): the engine block and
## Stock block, the exhaust, the chart of the torque and the power with Run dyno (a full-throttle pull at the wheels),
## and the build (bore, stroke, compression, cam, valves, inlet and exhaust, fuel and mixture, turbo or supercharger, the
## air of the dyno room), every field within the limits the others allow (EngineBuild.limits). A change works out the
## torque curve and the turbo of the game (CarEditorEngine.build_curve), the engine sound follows the build, the car is
## heavier or lighter by the difference of the engines (EngineBuild.mass), and the car takes it at once (TuningMenu).

const FIELDS := [["bore", "Bore (mm)", 0.5, "bore"], ["stroke", "Stroke (mm)", 0.5, "stroke"], ["compression", "Compression", 0.1, "compression"],
	["cam_duration", "Cam duration (°)", 2.0, "cam"], ["intake_flow", "Inlet flow (cfm)", 5.0, "intake"], ["exhaust_flow", "Exhaust flow (cfm)", 5.0, "exhaust"],
	["primary_length", "Header length (m)", 0.05, "primary"], ["exhaust_length", "Exhaust length (m)", 0.1, "exhaustLen"],
	["lambda", "Mixture (λ, rich < 1)", 0.01, "lambda"], ["induction.boost", "Boost (bar)", 0.05, "boost"],
	["ambient.celsius", "Air (°C)", 1.0, "temp"], ["ambient.altitude", "Altitude (m)", 50.0, "altitude"]]
## The engine speeds of the extras that follow a new rev limit (Tuning.js setLimiter).
const FOLLOW_LIMIT := ["two_step_rpm", "launch_rpm", "governor_rpm", "cvt_rpm", "pops_rpm", "antilag_rpm"]

var menu: Node                      # the TuningMenu: its car, its message and _apply
var _block: OptionButton
var _exhaust: OptionButton
var _info: Label
var _chart: Control
var _dyno_button: Button
var _dyno_info: Label
var _body: VBoxContainer
var _fields := {}                   # key -> [row, SpinBox, HSlider]
var _selects := {}                  # path -> OptionButton
var _boost_box: VBoxContainer
var _variant_row: Control
var _size_row: Control
var _dyno := {}
var _engine_mass := 0.0             # what the engine of the car weighs now (kg), from the first change on
var _refreshing := false


func setup(m: Node) -> void:
	menu = m
	add_theme_constant_override("separation", 3)
	var blocks := [["", "Choose an engine block…"]]
	for n in EngineBuild.PRESETS:
		blocks.append([n, n])
	var row := _line("Engine block")
	_block = _pick(row, blocks, func(v: Variant): _block_chosen(str(v)))
	var stock := Button.new()
	stock.text = "Stock block"
	stock.focus_mode = Control.FOCUS_NONE
	stock.tooltip_text = "Every setting of the build back to how this block comes; the rev limit and the exhaust stay"
	stock.pressed.connect(_stock)
	row.add_child(stock)
	_info = _note("")
	var ex := [["custom", "Custom (as it was set before)"]]
	for e in EngineBuild.EXHAUST_LABELS:
		ex.append([e[0], "%s · %s" % [e[1], e[2]]])
	_exhaust = _pick(_line("Exhaust"), ex, func(v: Variant):
		var cfg := _cfg()
		Tuning.write(cfg, "sound.engine_sim.exhaust_type", str(v))
		menu.call("_apply", cfg, "exhaust %s" % v))
	_chart = CarEditorEngine.Chart.new()
	_chart.cfg_of = func() -> Dictionary: return menu.get("car").config
	_chart.dyno_of = func() -> Dictionary: return _dyno
	_chart.after = func() -> void: pass
	_chart.custom_minimum_size = Vector2(0, 170)
	add_child(_chart)
	_note("— torque (Nm, orange)   — power (hp, blue)   - - at the wheels (the dyno)   | rev limit (red)")
	var dr := HBoxContainer.new()
	add_child(dr)
	_dyno_button = Button.new()
	_dyno_button.text = "▶ Run dyno"
	_dyno_button.focus_mode = Control.FOCUS_NONE
	_dyno_button.tooltip_text = "A full-throttle pull in the gear closest to 1:1, measured at the wheels of a car on rollers: the drivetrain and the " \
		+ "rolling of the tyres count, air drag and grip do not. Only the chart changes."
	_dyno_button.pressed.connect(run_dyno)
	dr.add_child(_dyno_button)
	_dyno_info = Label.new()
	_dyno_info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_dyno_info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_dyno_info.add_theme_font_size_override("font_size", 11)
	_dyno_info.modulate.a = 0.75
	dr.add_child(_dyno_info)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 2)
	add_child(_body)
	_group("Block and cam")
	for i in 4:
		_field(_body, FIELDS[i])
	var valves := [[2, "2"], [3, "3"], [4, "4"], [5, "5"]]
	_selects["valves"] = _pick(_line("Valves per cylinder", _body), valves, func(_v: Variant): _edited())
	_group("Inlet and exhaust")
	for i in range(4, 8):
		_field(_body, FIELDS[i])
	_group("Fuel")
	var fuels := []
	for k in EngineBuild.FUELS:
		fuels.append([k, EngineBuild.FUELS[k]["label"]])
	_selects["fuel"] = _pick(_line("Fuel", _body), fuels, func(_v: Variant): _edited())
	_field(_body, FIELDS[8])
	_group("Turbo or supercharger")
	_selects["induction.type"] = _pick(_line("Induction", _body), [["none", "None"], ["turbo", "Turbo"], ["supercharger", "Supercharger"]],
		func(_v: Variant):
			_fill_variants(str(_value_of(_selects["induction.type"])), "")
			_edited())
	_variant_row = _line("Type", _body)
	_selects["induction.variant"] = _pick(_variant_row, [["single", "Single"]], func(_v: Variant): _edited())
	_size_row = _line("Size", _body)
	var sizes := []
	for k in EngineBuild.TURBO_SIZES:
		sizes.append([k, EngineBuild.TURBO_SIZES[k]["label"]])
	_selects["induction.size"] = _pick(_size_row, sizes, func(_v: Variant): _edited())
	_boost_box = VBoxContainer.new()
	_body.add_child(_boost_box)
	_field(_boost_box, FIELDS[9])
	var ics := []
	for k in EngineBuild.INTERCOOLERS:
		ics.append([k, EngineBuild.INTERCOOLERS[k]["label"]])
	_selects["induction.intercooler"] = _pick(_line("Intercooler", _boost_box), ics, func(_v: Variant): _edited())
	_group("Dyno room")
	_field(_body, FIELDS[10])
	_field(_body, FIELDS[11])
	update()


func _cfg() -> Dictionary:
	return (menu.get("car").config as Dictionary).duplicate(true)


func _build() -> Variant:
	var b: Variant = Tuning.read(menu.get("car").config, "engine.build")
	return b if b is Dictionary and (b as Dictionary).has("bore") else null


# ---- the pieces

func _line(text: String, parent: Control = self) -> HBoxContainer:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 13)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(l)
	parent.add_child(row)
	return row


func _note(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 11)
	l.modulate.a = 0.75
	add_child(l)
	return l


func _group(text: String) -> void:
	var l := Label.new()
	l.text = text.to_upper()
	l.add_theme_font_size_override("font_size", 11)
	l.modulate.a = 0.6
	_body.add_child(l)


func _pick(row: HBoxContainer, items: Array, on_pick: Callable) -> OptionButton:
	var p := OptionButton.new()
	p.focus_mode = Control.FOCUS_NONE
	p.fit_to_longest_item = false
	p.clip_text = true
	p.custom_minimum_size.x = 190
	_fill(p, items)
	p.item_selected.connect(func(i: int):
		if not _refreshing:
			on_pick.call(p.get_item_metadata(i)))
	row.add_child(p)
	return p


static func _fill(p: OptionButton, items: Array) -> void:
	p.clear()
	for it in items:
		p.add_item(str(it[1]))
		p.set_item_metadata(p.item_count - 1, it[0])


static func _value_of(p: OptionButton) -> Variant:
	return p.get_item_metadata(p.selected) if p.selected >= 0 else null


static func _select(p: OptionButton, v: Variant) -> void:
	for i in p.item_count:
		if str(p.get_item_metadata(i)) == str(v):
			p.select(i)
			return


func _field(parent: Control, d: Array) -> void:
	var item := VBoxContainer.new()
	item.add_theme_constant_override("separation", 0)
	parent.add_child(item)
	var row := _line(d[1], item)
	var num := SpinBox.new()
	num.step = d[2]
	num.custom_minimum_size.x = 96
	num.alignment = HORIZONTAL_ALIGNMENT_RIGHT
	num.select_all_on_focus = true
	num.get_line_edit().text_submitted.connect(func(_t: String): num.get_line_edit().release_focus())
	row.add_child(num)
	var slider := HSlider.new()
	slider.scrollable = false              # (the wheel scrolls the page)
	slider.step = d[2]
	slider.focus_mode = Control.FOCUS_NONE
	item.add_child(slider)
	slider.value_changed.connect(func(x: float):
		if not _refreshing:
			num.set_value_no_signal(x)
			_edited())
	num.value_changed.connect(func(x: float):
		if not _refreshing:
			slider.set_value_no_signal(x)
			_edited())
	_fields[d[0]] = [item, num, slider]


func _fill_variants(kind: String, keep: String) -> void:
	var list: Dictionary = EngineBuild.TURBO_VARIANTS if kind == "turbo" else EngineBuild.SUPERCHARGERS
	var items := []
	for k in list:
		items.append([k, list[k]["label"]])
	var p: OptionButton = _selects["induction.variant"]
	_fill(p, items)
	_select(p, keep if list.has(keep) else list.keys()[0])


# ---- the car follows the build

## The build as the fields have it (a field that is not a number keeps what the build had).
func _read() -> Dictionary:
	var b: Dictionary = (_build() as Dictionary).duplicate(true)
	for d in FIELDS:
		Tuning.write(b, d[0], float((_fields[d[0]][1] as SpinBox).value))
	for path in _selects:
		var v: Variant = _value_of(_selects[path])
		if v != null:
			Tuning.write(b, path, int(v) if path == "valves" else v)
	return b


func _edited() -> void:
	if _build() == null:
		return
	_push(_read(), false, "engine build")


## A new build on the car: the curve and the turbo follow, the sound, the mass of the car (the difference of the engines).
func _push(b: Dictionary, whole_preset: bool, what: String) -> void:
	var cfg := _cfg()
	var old: Variant = Tuning.read(cfg, "engine.build")
	if not (_engine_mass > 0.0):
		_engine_mass = EngineBuild.mass(old) if old is Dictionary and (old as Dictionary).has("bore") else _stock_mass(cfg)
	var change := roundf(EngineBuild.mass(b) - _engine_mass)
	_engine_mass += change
	Tuning.write(cfg, "engine.build", b)
	CarEditorEngine.build_curve(cfg)
	CarEditorEngine.sound_from_build(cfg, Tuning.read(cfg, "engine.build"), whole_preset)
	if change != 0.0:
		var mass := maxf(50.0, CarEditorEngine._num(cfg, "chassis.mass", 1000.0) + change)
		Tuning.write(cfg, "chassis.mass", mass)
		if absf(change) >= 5.0:
			menu.get("_message").text = "The engine is %d kg %s: the car weighs %d kg now." % [absf(change), "heavier" if change > 0.0 else "lighter", roundi(mass)]
	clear_dyno()
	menu.call("_apply", cfg, what)


## What the engine of a car without a build weighs: a guess from its peak torque (about 95 Nm a litre) and its cylinders.
static func _stock_mass(cfg: Dictionary) -> float:
	var peak := 0.0
	for p in Tuning.read(cfg, "engine.torque_curve") if Tuning.read(cfg, "engine.torque_curve") is Array else []:
		peak = maxf(peak, float(p[1]) if p is Array else 0.0)
	var layout := str(Tuning.read(cfg, "sound.engine_sim.layout") if Tuning.read(cfg, "sound.engine_sim.layout") != null else "inline-4")
	var cyl := int(EngineBuild.CYLINDERS.get(layout, 4))
	return 15.0 + 32.0 * maxf(0.1, peak / 95.0) + 5.0 * cyl


func _block_chosen(block_name: String) -> void:
	if block_name == "":
		return
	var b := EngineBuild.from_preset(block_name)
	# (a new block: the rev limit it suggests, and the speeds of the extras follow it)
	var cfg := _cfg()
	var limiter := float(EngineBuild.compute(b, 9000.0, CarEditorEngine._num(cfg, "engine.idle_rpm", 850.0))["suggestedLimiter"])
	_set_limiter(limiter)
	_push(b, true, "engine block %s" % block_name)


func _stock() -> void:
	var b: Variant = _build()
	if b == null or not EngineBuild.PRESETS.has(str(b.get("block", ""))):
		return
	var keep: Variant = Tuning.read(menu.get("car").config, "sound.engine_sim.exhaust_type")
	_push(EngineBuild.from_preset(str(b["block"])), false, "stock block")
	if keep != null:
		var cfg := _cfg()
		Tuning.write(cfg, "sound.engine_sim.exhaust_type", keep)
		menu.call("_apply", cfg, "exhaust kept")


## The rev limit, with the engine speeds of the extras that belong to the old one (Tuning.js setLimiter).
func _set_limiter(rpm: float) -> void:
	var car: Car = menu.get("car")
	var cfg := car.config.duplicate(true)
	var v := Tuning.values_of(cfg)
	var was := float(v.get("limiter_rpm", rpm))
	var f := rpm / was if was > 0.0 else 1.0
	Tuning.write(cfg, "engine.limiter_rpm", rpm)
	if absf(f - 1.0) >= 0.01:
		for k in FOLLOW_LIMIT:
			if float(v.get(k, 0.0)) > 0.0:
				Tuning.set_value(cfg, k, roundf(float(v[k]) * f / 100.0) * 100.0)
		if float(v.get("tc_stall_rpm", 0.0)) > 0.0:
			Tuning.set_value(cfg, "tc_stall_rpm", roundf(float(v["tc_stall_rpm"]) * f / 50.0) * 50.0)
	car.config = cfg


## The fields as the car has them, their limits, and the chart.
func update() -> void:
	_refreshing = true
	var cfg: Dictionary = menu.get("car").config
	var b: Variant = _build()
	_body.visible = b != null
	_select(_block, b.get("block", "") if b != null else "")
	var ex: Variant = Tuning.read(cfg, "sound.engine_sim.exhaust_type")
	_select(_exhaust, ex if ex != null and str(ex) != "" else "custom")
	if b != null:
		var lim := EngineBuild.limits(b, CarEditorEngine._num(cfg, "engine.limiter_rpm", 7000.0), CarEditorEngine._num(cfg, "engine.idle_rpm", 850.0))
		for d in FIELDS:
			var l: Array = lim[d[3]]
			var num: SpinBox = _fields[d[0]][1]
			var slider: HSlider = _fields[d[0]][2]
			for r: Range in [num, slider]:
				r.min_value = minf(l[0], l[1])
				r.max_value = maxf(l[0], l[1])
			(_fields[d[0]][0] as Control).tooltip_text = str(l[2])
			var v: Variant = Tuning.read(b, d[0])
			num.set_value_no_signal(float(v) if v != null else num.min_value)
			slider.set_value_no_signal(num.value)
		var ind: Dictionary = b.get("induction", {}) if b.get("induction") is Dictionary else {}
		var kind := str(ind.get("type", "none"))
		_select(_selects["valves"], int(b.get("valves", 4)))
		var vp: OptionButton = _selects["valves"]
		for i in vp.item_count:
			vp.set_item_disabled(i, not int(vp.get_item_metadata(i)) in lim["valves"])
		_select(_selects["fuel"], b.get("fuel", "pump95"))
		_select(_selects["induction.type"], kind)
		_fill_variants(kind, str(ind.get("variant", "")))
		if kind == "turbo":
			var tv: OptionButton = _selects["induction.variant"]
			for i in tv.item_count:
				tv.set_item_disabled(i, not str(tv.get_item_metadata(i)) in lim["turboVariants"])
		_select(_selects["induction.size"], ind.get("size", "medium"))
		var sp: OptionButton = _selects["induction.size"]
		for i in sp.item_count:
			sp.set_item_disabled(i, not str(sp.get_item_metadata(i)) in lim["turboSizes"])
		_select(_selects["induction.intercooler"], ind.get("intercooler", "air"))
		_variant_row.visible = kind != "none"
		_boost_box.visible = kind != "none"
		_size_row.visible = kind == "turbo"
		var res := EngineBuild.compute(b, CarEditorEngine._num(cfg, "engine.limiter_rpm", 7000.0), CarEditorEngine._num(cfg, "engine.idle_rpm", 850.0))
		_info.text = "%.1f L, %d cylinders · %d hp at %d rpm · piston speed at the limit %d m/s%s%s" % [res["displacement"], res["cylinders"],
			roundi(res["peakPower"]), res["peakPowerRpm"], roundi(res["pistonSpeedAtLimit"]),
			" (too fast for the engine to last)" if float(res["pistonSpeedAtLimit"]) > 25.0 else "",
			(" · knock: %d%% of the torque is lost, use better fuel or less boost" % roundi(float(res["knock"]) * 100.0)) if float(res["knock"]) > 0.03 else ""]
	else:
		_info.text = "This car has a torque curve of its own. Choose an engine block to build its engine: the curve then follows from it."
	_refreshing = false
	_chart.queue_redraw()


# ---- the dyno

func clear_dyno() -> void:
	_dyno = {}
	_dyno_button.disabled = false
	_dyno_info.text = ""


func run_dyno() -> void:
	clear_dyno()
	var run := CarEditorEngine.dyno_pull(menu.get("car").config)
	if run.is_empty():
		_dyno_info.text = "Needs gears, a final drive, a rev limit and a curve."
		return
	_dyno = run
	_dyno["up_to"] = 0
	_dyno["time"] = 0.0
	_dyno_button.disabled = true


func _process(delta: float) -> void:
	if _dyno.is_empty() or _dyno.has("done"):
		return
	_dyno["time"] = float(_dyno["time"]) + delta
	var f := clampf(float(_dyno["time"]) / 4.5, 0.0, 1.0)
	var pts: Array = _dyno["points"]
	_dyno["up_to"] = floori(f * (pts.size() - 1))
	_chart.queue_redraw()
	if f < 1.0:
		return
	_dyno["done"] = true
	_dyno_button.disabled = false
	var best: Dictionary = pts[0]
	for p in pts:
		if p["hp"] > best["hp"]:
			best = p
	var eng := float(Tuning.peak_of(menu.get("car").config)["hp"])
	_dyno_info.text = "At the wheels (dashed): %d hp at %d rpm, %d%% below the engine · gear %d%s" % [roundi(best["hp"]),
		roundi(float(best["rpm"]) / 10.0) * 10, roundi(100.0 * (1.0 - float(best["hp"]) / maxf(1.0, eng))), _dyno["gear"],
		(" · in this air; corrected (DIN) %d hp" % roundi(float(best["hp"]) / float(_dyno["room"]))) if float(_dyno["room"]) != 1.0 else ""]
