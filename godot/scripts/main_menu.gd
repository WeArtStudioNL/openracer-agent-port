class_name MainMenu
extends Control
## The steps of Play (web/js/MainMenu.js): the way to play (free drive, race, skidpad), the car, its setup, the track,
## the weather, the race and the opponents, or the ground of the skidpad; a bar at the top with the steps and one at
## the bottom with Back, what is chosen, and Next or Start. What is chosen is remembered (menu.cfg: the browser's
## openracer.lastChoice, raceOptions, mode and skidSurface). A card or a tile goes on at a click; Enter and Start (a
## gamepad) go on, Escape and B go back.

signal begin(car_id: String, track_id: String, opts: Dictionary)
signal home

const STEP_NAMES := {"mode": "Play", "car": "Car", "tune": "Setup", "track": "Track", "weather": "Weather", "race": "Race",
	"opponents": "Opponents", "surface": "Ground"}
const MODES := [["free", "Free drive", "Just drive. No end, no opponents, and your best lap is kept."],
	["race", "Race", "Laps from a standing start against AI cars, with a countdown."],
	["skidpad", "Skidpad", "Your car circles faster and faster until it lets go: how many g does it hold?"]]
## The ground of the skidpad (TrackLoader.js SKIDPAD_SURFACES)
const SKIDPAD_SURFACES := [["road", "Asphalt", "#5d6168"], ["wet", "Wet asphalt", "#383d45"], ["grass", "Grass", "#5a8a3c"],
	["gravel", "Gravel", "#8f8a80"], ["sand", "Sand", "#cdaa6e"], ["mud", "Mud", "#5a432c"]]
const WEAR := [[0.0, "Off"], [1.0, "On"], [3.0, "Fast"]]

var screen := "mode"
var mode := "free"
var choice := {"car": "", "track": ""}
var race_options := {"ai": 3, "difficulty": "normal", "grid": "front", "ghost": true, "records": true, "laps": 3, "opp": []}
var skid_surface := "road"
var cars: Array[Dictionary] = []
var tracks: Array[Dictionary] = []
var _configs := {}                   # id -> car.json
var _track_configs := {}
var _opp_pick := {}                  # adding an opponent: {stage: "car"} or {stage: "tune", car: id}
var _page: ScrollContainer
var _inner: VBoxContainer
var _steps_box: HBoxContainer
var _summary: HBoxContainer
var _bar_right: HBoxContainer
var _store := ConfigFile.new()


static func store_path() -> String:
	return Settings.path("menu.cfg")


func _init() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	theme = MenuStyle.make_theme()
	_store.load(store_path())
	choice = _store.get_value("menu", "choice", choice)
	mode = str(_store.get_value("menu", "mode", mode))
	var saved: Dictionary = _store.get_value("menu", "race", {})
	race_options.merge(saved, true)
	skid_surface = str(_store.get_value("menu", "surface", skid_surface))


func _ready() -> void:
	cars = Content.list_cars()
	tracks = Content.list_tracks()
	choice["car"] = _pick(cars, str(choice["car"]))
	choice["track"] = _pick(tracks, str(choice["track"]))
	var bg := ColorRect.new()
	bg.color = MenuStyle.BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var col := VBoxContainer.new()
	col.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	col.add_theme_constant_override("separation", 0)
	add_child(col)
	# the top: the logo (back home) and the steps
	var top := PanelContainer.new()
	top.add_theme_stylebox_override("panel", _bar_box(false))
	col.add_child(top)
	var top_row := HBoxContainer.new()
	top_row.add_theme_constant_override("separation", 18)
	top.add_child(top_row)
	var logo := Button.new()
	logo.flat = true
	logo.focus_mode = Control.FOCUS_NONE
	logo.add_child(MenuStyle.logo(false))
	logo.custom_minimum_size = Vector2(170, 30)
	MenuStyle.pass_mouse(logo)
	logo.pressed.connect(func(): home.emit())
	top_row.add_child(logo)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top_row.add_child(spacer)
	_steps_box = HBoxContainer.new()
	_steps_box.add_theme_constant_override("separation", 6)
	top_row.add_child(_steps_box)
	# the page
	_page = ScrollContainer.new()
	_page.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_page.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(_page)
	var centre := HBoxContainer.new()
	centre.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	centre.alignment = BoxContainer.ALIGNMENT_CENTER
	_page.add_child(centre)
	var margin := MarginContainer.new()
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	margin.add_theme_constant_override("margin_top", 28)
	margin.add_theme_constant_override("margin_bottom", 40)
	centre.add_child(margin)
	_inner = VBoxContainer.new()
	_inner.add_theme_constant_override("separation", 14)
	margin.add_child(_inner)
	# the bar at the bottom
	var bar := PanelContainer.new()
	bar.add_theme_stylebox_override("panel", _bar_box(true))
	col.add_child(bar)
	var bar_row := HBoxContainer.new()
	bar_row.add_theme_constant_override("separation", 14)
	bar.add_child(bar_row)
	bar_row.add_child(MenuStyle.button("‹ Back", "ghost", go_back))
	_summary = HBoxContainer.new()
	_summary.alignment = BoxContainer.ALIGNMENT_CENTER
	_summary.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar_row.add_child(_summary)
	_bar_right = HBoxContainer.new()
	bar_row.add_child(_bar_right)
	get_viewport().size_changed.connect(_fit_width)
	render()


func _bar_box(bottom: bool) -> StyleBoxFlat:
	var s := MenuStyle.flat(MenuStyle.BG2 if bottom else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 0, 0, 14)
	s.content_margin_left = 24
	s.content_margin_right = 24
	s.border_color = MenuStyle.LINE
	if bottom:
		s.border_width_top = 1
	else:
		s.border_width_bottom = 1
	return s


func _fit_width() -> void:
	if _inner != null:
		_inner.custom_minimum_size.x = minf(1120.0, get_viewport_rect().size.x - 48.0)


func _pick(list: Array[Dictionary], id: String) -> String:
	for c in list:
		if c["id"] == id:
			return id
	return str(list[0]["id"]) if not list.is_empty() else ""


func _remember() -> void:
	_store.set_value("menu", "choice", choice)
	_store.set_value("menu", "mode", mode)
	_store.set_value("menu", "race", race_options)
	_store.set_value("menu", "surface", skid_surface)
	_store.save(store_path())


func car_config(id: String) -> Dictionary:
	if not _configs.has(id):
		var c: Variant = Content.load_json("cars/%s/car.json" % id)
		_configs[id] = c if c is Dictionary else {}
	return _configs[id]


func track_config(id: String) -> Dictionary:
	if not _track_configs.has(id):
		var t: Variant = Content.load_json("tracks/%s/track.json" % id)
		_track_configs[id] = t if t is Dictionary else {}
	return _track_configs[id]


func _name_of(list: Array[Dictionary], id: String) -> String:
	for c in list:
		if c["id"] == id:
			return str(c["name"]).trim_suffix("  (garage)")
	return id


## ---- the steps

func tunes_of(car_id: String) -> Dictionary:
	return Tuning.list(car_id, car_config(car_id)) if car_id != "" else {}


func steps_of() -> Array:
	var with_tune := not tunes_of(str(choice["car"])).is_empty()
	if mode != "race" and mode != "skidpad":
		return ["mode", "track", "car", "tune"] if with_tune else ["mode", "track", "car"]
	var steps := ["mode", "car", "track", "weather", "race", "opponents"] if mode == "race" else ["mode", "car", "surface"]
	if with_tune:
		steps.insert(2, "tune")
	return steps


func go(next: String) -> void:
	screen = next
	_opp_pick = {}
	render()
	_page.scroll_vertical = 0


func set_mode(value: String) -> void:
	mode = value
	if mode == "race":
		race_options["laps"] = maxi(1, int(race_options.get("laps", 3)))
		race_options["ai"] = maxi(1, int(race_options.get("ai", 3)))
	_remember()


func go_next() -> void:
	var steps := steps_of()
	var at := steps.find(screen)
	if at < 0:
		return
	if at == steps.size() - 1:
		start()
	else:
		go(steps[at + 1])


func go_back() -> void:
	if not _opp_pick.is_empty():
		_opp_pick = {}
		render()
		return
	var steps := steps_of()
	var at := steps.find(screen)
	if at <= 0:
		home.emit()
	else:
		go(steps[at - 1])


## What the game is started with, from the way to play (MainMenu.js begin and start).
func start() -> void:
	if choice["car"] == "":
		return
	_remember()
	if mode == "skidpad":
		begin.emit(choice["car"], "skidpad", {"mode": "skidpad", "surface": skid_surface, "ghost": false, "records": false})
		return
	if choice["track"] == "":
		return
	if mode != "race":
		Settings.set_value("gfx_weather", "clear")          # (a free drive starts in clear weather)
		begin.emit(choice["car"], choice["track"], {"mode": "practice", "ghost": bool(race_options["ghost"]), "records": bool(race_options["records"])})
		return
	var opp := opp_list()
	begin.emit(choice["car"], choice["track"], {"mode": "race", "laps": int(race_options["laps"]), "opponents": maxi(opp.size(), int(race_options["ai"])),
		"difficulty": str(race_options["difficulty"]), "grid": str(race_options["grid"]), "pole": race_options["grid"] == "front",
		"ghost": bool(race_options["ghost"]), "records": bool(race_options["records"]), "opp": opp})


func render() -> void:
	for c in _inner.get_children():
		c.queue_free()
	for c in _steps_box.get_children():
		c.queue_free()
	_fit_width()
	var steps := steps_of()
	var at := steps.find(screen)
	for i in steps.size():
		var s: String = steps[i]
		var chip := Button.new()
		chip.text = "%d %s" % [i + 1, STEP_NAMES[s]]
		chip.focus_mode = Control.FOCUS_ALL if i < at else Control.FOCUS_NONE
		var on := i == at
		chip.add_theme_stylebox_override("normal", MenuStyle.flat(MenuStyle.ACCENT if on else Color(0, 0, 0, 0), Color(0, 0, 0, 0), 12, 0, 5))
		chip.add_theme_stylebox_override("hover", MenuStyle.flat(MenuStyle.ACCENT if on else MenuStyle.PANEL, Color(0, 0, 0, 0), 12, 0, 5))
		chip.add_theme_stylebox_override("pressed", chip.get_theme_stylebox("normal"))
		chip.add_theme_stylebox_override("focus", MenuStyle.focus_box())
		chip.add_theme_font_size_override("font_size", 13)
		chip.add_theme_color_override("font_color", Color.WHITE if on else (MenuStyle.TEXT if i < at else MenuStyle.MUTED))
		if i < at:
			chip.pressed.connect(go.bind(s))
		else:
			chip.mouse_default_cursor_shape = Control.CURSOR_ARROW
		_steps_box.add_child(chip)
	match screen:
		"mode":
			_mode_step()
		"car":
			_car_step()
		"tune":
			_tune_step()
		"track":
			_track_step()
		"weather":
			_weather_step()
		"race":
			_race_step()
		"opponents":
			_opponents_step()
		"surface":
			_surface_step()
	for c in _summary.get_children():
		c.queue_free()
	var parts := summary()
	for i in parts.size():
		if i > 0:
			_summary.add_child(MenuStyle.label("  ·  ", 14, MenuStyle.MUTED))
		_summary.add_child(MenuStyle.label(parts[i], 14, MenuStyle.HEAD))
	for c in _bar_right.get_children():
		c.queue_free()
	if screen != "mode" and _opp_pick.is_empty():
		var last := at == steps.size() - 1
		var next := MenuStyle.button(("Start" if mode == "skidpad" else "Start ▶") if last else "Next ›", "primary", go_next)
		next.disabled = (screen == "car" and choice["car"] == "") or (screen == "track" and choice["track"] == "")
		_bar_right.add_child(next)
	_focus_chosen.call_deferred()


## The focus on what is chosen (a choice builds the page again), else on the first thing of the page.
func _focus_chosen() -> void:
	var first: Control = null
	for c in _inner.find_children("*", "BaseButton", true, false):
		var b := c as BaseButton
		if not b.is_visible_in_tree() or b.disabled or b.focus_mode == Control.FOCUS_NONE:
			continue
		if b.has_meta("selected"):
			b.grab_focus()
			return
		if first == null:
			first = b
	if first != null:
		first.grab_focus()
	else:
		for c in _bar_right.get_children():
			(c as Control).grab_focus()


func _heading(title: String, sub: String) -> void:
	_inner.add_child(MenuStyle.label(title, 26, MenuStyle.HEAD))
	if sub != "":
		_inner.add_child(MenuStyle.label(sub, 15, MenuStyle.MUTED, true))


func _grid(columns: int) -> GridContainer:
	var g := GridContainer.new()
	g.columns = columns
	g.add_theme_constant_override("h_separation", 14)
	g.add_theme_constant_override("v_separation", 14)
	_inner.add_child(g)
	return g


func _tile_size() -> float:
	return floorf((_inner.custom_minimum_size.x - 3 * 14.0) / 4.0)


func _mode_step() -> void:
	_heading("How do you want to play?", "You can change it any time.")
	var g := _grid(3)
	var w := floorf((_inner.custom_minimum_size.x - 2 * 14.0) / 3.0)
	for m in MODES:
		var c := MenuStyle.card(mode == m[0])
		c.custom_minimum_size = Vector2(w, 130)
		var v := VBoxContainer.new()
		v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		v.offset_left = 22
		v.offset_right = -22
		v.offset_top = 24
		v.add_child(MenuStyle.label(m[1], 20, MenuStyle.HEAD))
		v.add_child(MenuStyle.label(m[2], 14, MenuStyle.MUTED, true))
		c.add_child(v)
		MenuStyle.pass_mouse(c)
		if mode == m[0]:
			c.set_meta("selected", true)
		c.pressed.connect(func():
			set_mode(m[0])
			go(steps_of()[1]))
		g.add_child(c)


## A tile of a car (MainMenu.js carTile): its picture, the name, the specs and the power.
static func car_tile(id: String, cfg: Dictionary, selected: bool, host: Node, size: float, title := "", specs_text := "") -> Button:
	var tile := MenuStyle.card(selected, 10, Color("#1b1f25"))
	tile.custom_minimum_size = Vector2(size, size)
	tile.tooltip_text = str(cfg.get("description", ""))
	var bg := TextureRect.new()
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	var gradient := GradientTexture2D.new()
	gradient.fill = GradientTexture2D.FILL_RADIAL
	gradient.fill_from = Vector2(0.5, 0.58)
	gradient.fill_to = Vector2(1.0, 1.0)
	gradient.gradient = Gradient.new()
	gradient.gradient.set_color(0, Color("#3a3f47"))
	gradient.gradient.set_color(1, Color("#0d0f12"))
	var back := TextureRect.new()
	back.texture = gradient
	back.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	back.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	# (inside the frame: the orange of a chosen tile stays seen)
	for t: Control in [back, bg]:
		t.offset_left = 2
		t.offset_top = 2
		t.offset_right = -2
		t.offset_bottom = -2
	tile.add_child(back)
	tile.add_child(bg)
	bg.texture = CarInfo.car_picture(id, cfg, host, func(t: Texture2D):
		if is_instance_valid(bg):
			bg.texture = t)
	# (the showcase: the car under the mouse, with the focus or chosen turns in 3D on its tile)
	tile.mouse_entered.connect(func(): CarInfo.showcase(bg, id, cfg, host))
	tile.focus_entered.connect(func(): CarInfo.showcase(bg, id, cfg, host))
	tile.mouse_exited.connect(func(): CarInfo.showcase_leave(bg))
	tile.focus_exited.connect(func(): CarInfo.showcase_leave(bg))
	if selected:
		tile.ready.connect(func(): CarInfo.showcase(bg, id, cfg, host, true), CONNECT_DEFERRED)
	var over := VBoxContainer.new()
	over.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	over.offset_left = 14
	over.offset_right = -14
	over.offset_top = 12
	over.offset_bottom = -12
	tile.add_child(over)
	var name_row := HBoxContainer.new()
	var name_label := MenuStyle.label(title if title != "" else str(cfg.get("name", id)), 18, MenuStyle.HEAD, true)
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	name_label.add_theme_constant_override("outline_size", 4)
	name_row.add_child(name_label)
	var src := CarInfo.source("cars", id)
	if src != "":
		name_row.add_child(MenuStyle.badge(src))
	over.add_child(name_row)
	var gap := Control.new()
	gap.size_flags_vertical = Control.SIZE_EXPAND_FILL
	over.add_child(gap)
	var bottom := HBoxContainer.new()
	var specs := MenuStyle.label(specs_text if specs_text != "" else CarInfo.specs(cfg), 12, MenuStyle.MUTED, true)
	specs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	specs.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	specs.add_theme_constant_override("outline_size", 4)
	bottom.add_child(specs)
	var p := CarInfo.power(cfg)
	var hp := MenuStyle.label("%s" % (str(p) if p > 0 else "?"), 24, MenuStyle.HEAD)
	hp.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	hp.add_theme_constant_override("outline_size", 4)
	bottom.add_child(hp)
	bottom.add_child(MenuStyle.label("HP", 11, MenuStyle.MUTED))
	over.add_child(bottom)
	if selected:
		tile.set_meta("selected", true)
	MenuStyle.pass_mouse(tile)
	return tile


func _car_step() -> void:
	_heading("Choose your car", "Tap or click a car to go on.")
	var g := _grid(4)
	for c in cars:
		var id := str(c["id"])
		var tile := car_tile(id, car_config(id), choice["car"] == id, self, _tile_size())
		tile.pressed.connect(func():
			choice["car"] = id
			_remember()
			go_next())
		g.add_child(tile)


## The tiles of the setups of a car: Default (the car as made) and every tune, each with the specs of the tune.
func _tune_tiles(car_id: String, active: String, on_pick: Callable) -> void:
	var g := _grid(4)
	var tunes := tunes_of(car_id)
	var names: Array = [""]
	names.append_array(tunes.keys())
	for n in names:
		var cfg := car_config(car_id)
		if n != "":
			var t := Tuning.load_tune(str(tunes[n]))
			if not t.is_empty():
				cfg = t
		var tile := car_tile(car_id, cfg, active == n, self, _tile_size(), str(n) if n != "" else "Default", CarInfo.specs(cfg))
		tile.pressed.connect(on_pick.bind(str(n)))
		g.add_child(tile)


func _tune_step() -> void:
	_heading("Choose your setup", "Click a setup to go on. A setup is the car as you tuned and saved it (the tuning menu, key "
		+ "U, or the car editor), or one that comes with the car. Default is the car as it comes.")
	var car_id := str(choice["car"])
	_tune_tiles(car_id, CarInfo.active_tune(car_id, car_config(car_id)), func(n: String):
		var all: Dictionary = Settings.get_value("tunes").duplicate()
		if n == "":
			all.erase(car_id)
		else:
			all[car_id] = tunes_of(car_id)[n]
		Settings.set_value("tunes", all)
		go_next())


func _chips(parent: Control, label_text: String, items: Array, current: Variant, apply: Callable) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	var l := MenuStyle.label(label_text, 16, MenuStyle.HEAD)
	l.custom_minimum_size.x = 190
	row.add_child(l)
	var group := HFlowContainer.new()
	group.add_theme_constant_override("h_separation", 6)
	group.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for it in items:
		var on: bool = typeof(it[0]) == typeof(current) and it[0] == current or (it[0] is float and current is float and is_equal_approx(it[0], current))
		var c := MenuStyle.chip(str(it[1]), on, func():
			apply.call(it[0])
			_remember()
			render())
		if on:
			c.set_meta("selected", true)
		group.add_child(c)
	row.add_child(group)
	parent.add_child(row)
	var line := ColorRect.new()
	line.color = MenuStyle.LINE
	line.custom_minimum_size.y = 1
	parent.add_child(line)
	return row


func _wear_now() -> float:
	var w := float(Settings.get_value("tyre_wear"))
	return 0.0 if w <= 0.0 else (3.0 if w >= 2.0 else 1.0)


func _track_step() -> void:
	_heading("Choose the track", "Click a track to go on (Back brings you here again with your track chosen).")
	if mode == "free":
		var row := _chips(_inner, "Tyre wear and fuel", WEAR, _wear_now(), func(v): Settings.set_value("tyre_wear", v))
		(row.get_child(1) as HFlowContainer).add_child(MenuStyle.button("More options…", "ghost", _show_more))
		_chips(_inner, "Damage", [[true, "On"], [false, "Off"]], bool(Settings.get_value("damage")), func(v): Settings.set_value("damage", v))
	var g := _grid(2)
	var w := floorf((_inner.custom_minimum_size.x - 14.0) / 2.0)
	for t in tracks:
		var id := str(t["id"])
		if id == "skidpad":
			continue
		g.add_child(_track_card(id, w))


func _track_card(id: String, w: float) -> Button:
	var cfg := track_config(id)
	var selected: bool = choice["track"] == id
	var c := MenuStyle.card(selected)
	c.custom_minimum_size = Vector2(w, 114 if not selected else 140)
	var row := HBoxContainer.new()
	row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	row.offset_left = 16
	row.offset_right = -16
	row.offset_top = 14
	row.offset_bottom = -14
	row.add_theme_constant_override("separation", 14)
	c.add_child(row)
	var thumb := TextureRect.new()
	thumb.custom_minimum_size = Vector2(150, 84)
	thumb.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	thumb.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	thumb.texture = CarInfo.track_picture(id)
	thumb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var holder := PanelContainer.new()
	holder.add_theme_stylebox_override("panel", MenuStyle.flat(Color("#1b1f25"), Color(0, 0, 0, 0), 8))
	holder.clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
	holder.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	holder.add_child(thumb)
	row.add_child(holder)
	var text := VBoxContainer.new()
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_theme_constant_override("separation", 4)
	row.add_child(text)
	var name_row := HBoxContainer.new()
	name_row.add_child(MenuStyle.label(str(cfg.get("name", id)), 18, MenuStyle.HEAD))
	var src := CarInfo.source("tracks", id)
	if src != "":
		name_row.add_child(MenuStyle.badge(src))
	text.add_child(name_row)
	var desc := str(cfg.get("description", ""))
	if desc != "":
		var d := MenuStyle.label(desc, 14, MenuStyle.MUTED, true)
		d.max_lines_visible = 2
		d.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		text.add_child(d)
	if selected:
		c.set_meta("selected", true)
		var extra := HBoxContainer.new()
		extra.add_theme_constant_override("separation", 8)
		var car_id := str(choice["car"])
		var best := CarInfo.best_lap(id, CarInfo.record_key(car_id, CarInfo.active_tune(car_id, car_config(car_id)))) if car_id != "" else -1.0
		extra.add_child(MenuStyle.label("Best lap: %s" % LapTimer.format_time(best) if best > 0.0 else "No lap record yet", 13, MenuStyle.MUTED))
		if cfg.has("dragstrip"):
			extra.add_child(MenuStyle.button("Drag top 50", "ghost", func(): DragTopWindow.open(self, id, cfg)))
		text.add_child(extra)
	MenuStyle.pass_mouse(c)
	c.pressed.connect(func():
		choice["track"] = id
		_remember()
		go_next())
	return c


## More race options (MainMenu.js showMore): the wear and the fuel, the damage, the ghost and the records.
func _show_more() -> void:
	var d := MenuDialog.new("More race options", "", 640)
	add_child(d)
	_fill_more(d)
	d.foot([MenuStyle.button("Done", "primary", d.close)])
	d.closed.connect(render)
	d.focus_first.call_deferred()


func _fill_more(d: MenuDialog) -> void:
	for c in d.box.get_children():
		if c.has_meta("option"):
			d.box.remove_child(c)
			c.queue_free()
	var holder := VBoxContainer.new()
	holder.set_meta("option", true)
	d.box.add_child(holder)
	d.box.move_child(holder, 1)
	var redo := _fill_more.bind(d)
	_option_chips(holder, "Tyre wear and fuel", WEAR, _wear_now(), func(v): Settings.set_value("tyre_wear", v), redo)
	_option_chips(holder, "Damage", [[false, "Off"], [true, "On"]], bool(Settings.get_value("damage")), func(v): Settings.set_value("damage", v), redo)
	_option_chips(holder, "Ghost of your best lap", [[false, "Off"], [true, "On"]], bool(race_options["ghost"]), func(v): race_options["ghost"] = v, redo)
	_option_chips(holder, "Save lap records", [[false, "Off"], [true, "On"]], bool(race_options["records"]), func(v): race_options["records"] = v, redo)


func _option_chips(parent: Control, label_text: String, items: Array, current: Variant, apply: Callable, redo: Callable) -> void:
	var row := _chips(parent, label_text, items, current, apply)
	# (in a window: the chips build the window again, not the page)
	var group := row.get_child(1) as HFlowContainer
	for i in group.get_child_count():
		var b := group.get_child(i) as Button
		for conn in b.pressed.get_connections():
			b.pressed.disconnect(conn["callable"])
		var v: Variant = items[i][0]
		b.pressed.connect(func():
			apply.call(v)
			_remember()
			redo.call())


func _weather_step() -> void:
	_heading("Choose the weather", "For this %s. You can change it in the Escape menu (Graphics) while you drive." % ("race" if mode == "race" else "drive"))
	_chips(_inner, "Weather", GraphicsPage.WEATHERS, str(Settings.get_value("gfx_weather")), func(v): Settings.set_value("gfx_weather", v))
	_chips(_inner, "Time of day", GraphicsPage.TIMES, float(Settings.get_value("gfx_time")), func(v): Settings.set_value("gfx_time", v))
	_inner.add_child(MenuStyle.label("The ground follows the weather. Rain wets the road and snow lies on it: both give less grip, and the AI drives slower. "
		+ "There are no headlights yet: the night is dark.", 14, MenuStyle.MUTED, true))


func _race_step() -> void:
	_heading("Set up the race", "A race starts from a standing start, with a countdown.")
	_chips(_inner, "Laps", [[3, "3"], [5, "5"], [10, "10"], [25, "25"]], int(race_options["laps"]), func(v): race_options["laps"] = v)
	_chips(_inner, "Opponents", [[1, "1"], [2, "2"], [3, "3"], [5, "5"], [7, "7"]], int(race_options["ai"]), func(v): race_options["ai"] = v)
	_chips(_inner, "Difficulty", [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]], str(race_options["difficulty"]), func(v): race_options["difficulty"] = v)
	_chips(_inner, "Your start", [["front", "Pole"], ["random", "Random"], ["back", "Last"]], str(race_options["grid"]), func(v): race_options["grid"] = v)
	_chips(_inner, "Damage", [[true, "On"], [false, "Off"]], bool(Settings.get_value("damage")), func(v): Settings.set_value("damage", v))
	_chips(_inner, "Tyre wear and fuel", WEAR, _wear_now(), func(v): Settings.set_value("tyre_wear", v))
	_chips(_inner, "Ghost of your best lap", [[true, "On"], [false, "Off"]], bool(race_options["ghost"]), func(v): race_options["ghost"] = v)
	_chips(_inner, "Save lap records", [[true, "On"], [false, "Off"]], bool(race_options["records"]), func(v): race_options["records"] = v)
	var t := track_config(str(choice["track"]))
	if not t.is_empty() and t.get("gates", []).is_empty():
		_inner.add_child(MenuStyle.label("This track has no finish line (no gates), so there is no race on it: it opens as "
			+ "free driving. Pick another track for a race, or add gates in the track editor.",
			14, MenuStyle.MUTED, true))
	elif not t.is_empty() and t.get("racing_line", []).size() <= 10:
		_inner.add_child(MenuStyle.label("This track has no racing line yet, so the race has no AI cars: you race the clock. Draw the line in the track editor.",
			14, MenuStyle.MUTED, true))


## ---- the opponents: the places of the grid; + adds a car (and its setup), ⧉ the same car again, ✕ takes it out

func opp_list() -> Array:
	var out := []
	for o in race_options.get("opp", []):
		if not o is Dictionary or out.size() >= int(race_options["ai"]):
			continue
		var id := str(o.get("car", ""))
		var tune := str(o.get("tune", ""))
		if _pick(cars, id) != id or (tune != "" and not tunes_of(id).has(tune)):
			continue
		out.append({"car": id, "tune": tune})
	return out


func _opp_add(car_id: String, tune: String) -> void:
	var list := opp_list()
	if list.size() >= int(race_options["ai"]):
		return
	list.append({"car": car_id, "tune": tune})
	race_options["opp"] = list
	_remember()


func _opponents_step() -> void:
	if _opp_pick.get("stage", "") == "car":
		_heading("Add an opponent", "Click a car to add it.")
		var g := _grid(4)
		for c in cars:
			var id := str(c["id"])
			var tile := car_tile(id, car_config(id), false, self, _tile_size())
			tile.pressed.connect(func():
				if not tunes_of(id).is_empty():
					_opp_pick = {"stage": "tune", "car": id}
				else:
					_opp_add(id, "")
					_opp_pick = {}
				render())
			g.add_child(tile)
		return
	if _opp_pick.get("stage", "") == "tune":
		var car_id := str(_opp_pick["car"])
		_heading("Choose the setup", "Click a setup of this car to add it. Default is the car as it comes.")
		_tune_tiles(car_id, "-", func(n: String):
			_opp_add(car_id, n)
			_opp_pick = {}
			render())
		return
	var most := int(race_options["ai"])
	var list := opp_list()
	_heading("Choose your opponents", ("Up to %d. Tap + to add a car; the copy button on a car adds the same one again. The places "
		+ "you leave empty get cars of the game of your kind (cars, karts or motorcycles).") % most)
	var g := _grid(4)
	var size := _tile_size()
	for i in list.size():
		var o: Dictionary = list[i]
		var id := str(o["car"])
		var cfg := car_config(id)
		if o["tune"] != "":
			var t := Tuning.load_tune(str(tunes_of(id).get(o["tune"], "")))
			if not t.is_empty():
				cfg = t
		var tile := car_tile(id, cfg, false, self, size, str(car_config(id).get("name", id)), str(o["tune"]) if o["tune"] != "" else "Default")
		tile.focus_mode = Control.FOCUS_NONE
		var acts := HBoxContainer.new()
		acts.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
		acts.offset_left = -84
		acts.offset_top = 8
		acts.offset_right = -8
		acts.alignment = BoxContainer.ALIGNMENT_END
		if list.size() < most:
			var copy := MenuStyle.button("⧉", "")
			copy.tooltip_text = "Add the same car again"
			copy.pressed.connect(func():
				_opp_add(id, str(o["tune"]))
				render())
			acts.add_child(copy)
		var remove := MenuStyle.button("✕", "")
		remove.tooltip_text = "Remove this opponent"
		remove.pressed.connect(func():
			var rest := opp_list()
			rest.remove_at(i)
			race_options["opp"] = rest
			_remember()
			render())
		acts.add_child(remove)
		tile.add_child(acts)
		g.add_child(tile)
	for i in range(list.size(), most):
		var empty := MenuStyle.card(false, 10, Color(0, 0, 0, 0))
		empty.custom_minimum_size = Vector2(size, size)
		empty.text = "+"
		empty.add_theme_font_size_override("font_size", 56)
		empty.add_theme_color_override("font_color", MenuStyle.MUTED)
		empty.tooltip_text = "Add an opponent"
		empty.pressed.connect(func():
			_opp_pick = {"stage": "car"}
			render())
		g.add_child(empty)


## The ground of the skidpad: the same circle on asphalt, wet asphalt, grass, gravel, sand or mud.
func _surface_step() -> void:
	_heading("Choose the ground", "Your car circles faster and faster on it until it lets go.")
	var g := _grid(3)
	var w := floorf((_inner.custom_minimum_size.x - 2 * 14.0) / 3.0)
	for s in SKIDPAD_SURFACES:
		var c := MenuStyle.card(skid_surface == s[0])
		c.custom_minimum_size = Vector2(w, 100)
		var v := VBoxContainer.new()
		v.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		v.offset_left = 22
		v.offset_top = 22
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 10)
		var swatch := Panel.new()
		swatch.custom_minimum_size = Vector2(14, 14)
		swatch.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		swatch.add_theme_stylebox_override("panel", MenuStyle.flat(Color(s[2]), Color(0, 0, 0, 0), 4))
		head.add_child(swatch)
		head.add_child(MenuStyle.label(s[1], 20, MenuStyle.HEAD))
		v.add_child(head)
		var surf: Dictionary = Content.SURFACES.get(s[0], {})
		v.add_child(MenuStyle.label("Grip %.2f%s" % [float(surf.get("static", 1.0)), ", loose ground" if surf.get("loose", false) else ""], 14, MenuStyle.MUTED))
		c.add_child(v)
		MenuStyle.pass_mouse(c)
		if skid_surface == s[0]:
			c.set_meta("selected", true)
		c.pressed.connect(func():
			if skid_surface == s[0]:
				go_next()
				return
			skid_surface = s[0]
			_remember()
			render())
		g.add_child(c)


func summary() -> Array:
	var parts := []
	var car_id := str(choice["car"])
	var track_id := str(choice["track"])
	if screen != "mode":
		parts.append({"free": "Free drive", "race": "Race", "skidpad": "Skidpad"}[mode])
	if car_id != "" and screen not in ["mode", "car"]:
		parts.append(_name_of(cars, car_id))
	if car_id != "" and not tunes_of(car_id).is_empty() and screen not in ["mode", "car", "tune"]:
		var t := CarInfo.active_tune(car_id, car_config(car_id))
		parts.append(t if t != "" else "Default")
	if mode == "skidpad" and screen == "surface":
		for s in SKIDPAD_SURFACES:
			if s[0] == skid_surface:
				parts.append(s[1])
	elif car_id != "" and screen == "car":
		parts.append(_name_of(cars, car_id))
	if track_id != "" and mode != "skidpad" and (screen in ["track", "weather", "race", "opponents"] or (mode == "free" and screen in ["car", "tune"])):
		parts.append(_name_of(tracks, track_id))
	if screen == "race":
		parts.append("%d laps, %d opponents" % [int(race_options["laps"]), int(race_options["ai"])])
	if screen == "opponents":
		var n := opp_list().size()
		parts.append("%d laps, %d opponents%s" % [int(race_options["laps"]), n if n > 0 else int(race_options["ai"]), "" if n > 0 else " (chosen by the game)"])
	return parts


func _unhandled_input(event: InputEvent) -> void:
	if not is_visible_in_tree():
		return
	for c in get_children():
		if c is MenuDialog:
			return                    # (a window has its own keys)
	# Start on a gamepad goes on, as Enter does (PadNav.js); Escape and B go back
	if event is InputEventJoypadButton and event.pressed and event.button_index == JOY_BUTTON_START:
		get_viewport().set_input_as_handled()
		if screen != "mode" and _opp_pick.is_empty():
			go_next()
	elif event is InputEventKey and event.pressed and not event.echo and event.physical_keycode in [KEY_ENTER, KEY_KP_ENTER]:
		get_viewport().set_input_as_handled()
		if screen != "mode" and _opp_pick.is_empty():
			go_next()
	elif event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		go_back()
