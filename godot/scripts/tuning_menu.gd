class_name TuningMenu
extends PanelContainer
## The tuning menu (U, as in the browser game): every item of Tuning.GROUPS of the car that drives, changed at
## once (the game is paused while it is open; the car takes the change when it goes on). The tunes of the car:
## load one, save the setup as a tune, or back to the car as made. The tune in use is remembered per car.

signal closed

var world: Node
var car: Car
var base: Dictionary = {}           # the car as car.json makes it
var _status: Label
var _tune_pick: OptionButton
var _tunes := {}
var _name_edit: LineEdit
var _page_box: VBoxContainer
var _tabs: TabContainer


func setup(w: Node, c: Car, base_config: Dictionary) -> void:
	world = w
	car = c
	base = base_config


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	custom_minimum_size = Vector2(760, 0)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 18)
	add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	margin.add_child(box)
	var title := Label.new()
	title.text = "Tuning: %s" % car.config.get("name", car.car_id)
	title.add_theme_font_size_override("font_size", 26)
	box.add_child(title)

	var row := HBoxContainer.new()
	_tune_pick = OptionButton.new()
	_tune_pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(_tune_pick)
	var load_b := Button.new()
	load_b.text = "Load"
	load_b.pressed.connect(_load_selected)
	row.add_child(load_b)
	var reset_b := Button.new()
	reset_b.text = "The car as made"
	reset_b.pressed.connect(func():
		_use(base.duplicate(true), "")
		_status.text = "Back to the car as made")
	row.add_child(reset_b)
	box.add_child(row)
	var save_row := HBoxContainer.new()
	_name_edit = LineEdit.new()
	_name_edit.placeholder_text = "Name of the tune"
	_name_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	save_row.add_child(_name_edit)
	var save_b := Button.new()
	save_b.text = "Save as a tune"
	save_b.pressed.connect(_save)
	save_row.add_child(save_b)
	box.add_child(save_row)
	_status = Label.new()
	_status.modulate.a = 0.8
	box.add_child(_status)

	_tabs = TabContainer.new()
	_tabs.custom_minimum_size = Vector2(740, 470)
	box.add_child(_tabs)
	_build_pages()
	_fill_tunes()

	var done := Button.new()
	done.text = "Close (U)"
	done.custom_minimum_size.y = 40
	done.pressed.connect(func(): closed.emit())
	box.add_child(done)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("tuning") or event.is_action_pressed("menu"):
		closed.emit()
		get_viewport().set_input_as_handled()


func _fill_tunes() -> void:
	_tunes = Tuning.list(car.car_id, base)
	_tune_pick.clear()
	if _tunes.is_empty():
		_tune_pick.add_item("(no tunes yet)")
		_tune_pick.disabled = true
		return
	_tune_pick.disabled = false
	var active: String = Settings.get_value("tunes").get(car.car_id, "")
	for n in _tunes:
		_tune_pick.add_item(n)
		if _tunes[n] == active:
			_tune_pick.select(_tune_pick.item_count - 1)


func _load_selected() -> void:
	if _tunes.is_empty():
		return
	var n := _tune_pick.get_item_text(_tune_pick.selected)
	var cfg := Tuning.load_tune(_tunes[n])
	if cfg.is_empty():
		_status.text = "This tune could not be read"
		return
	_use(cfg, _tunes[n])
	_name_edit.text = n
	_status.text = "Tune loaded: " + n


func _save() -> void:
	var n := _name_edit.text.strip_edges()
	if n == "":
		_status.text = "Give the tune a name first"
		return
	var path := Tuning.save_tune(car.car_id, n, car.config)
	_remember(path)
	_fill_tunes()
	_status.text = "Saved: %s" % ProjectSettings.globalize_path(path)
	RunLog.event("tune saved: %s (%s)" % [n, path])


## The car takes a whole configuration (a tune, or the car as made); the sliders show it.
func _use(cfg: Dictionary, path: String) -> void:
	car.apply_config(cfg)
	_remember(path)
	_build_pages()
	RunLog.event("tune in use: %s" % (path if path != "" else "the car as made"))


func _remember(path: String) -> void:
	var tunes: Dictionary = Settings.get_value("tunes").duplicate()
	if path == "":
		tunes.erase(car.car_id)
	else:
		tunes[car.car_id] = path
	Settings.set_value("tunes", tunes)


func _build_pages() -> void:
	var current := _tabs.current_tab
	for c in _tabs.get_children():
		_tabs.remove_child(c)
		c.queue_free()
	for g in Tuning.GROUPS:
		var scroll := ScrollContainer.new()
		scroll.name = g[0]
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		var page := VBoxContainer.new()
		page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		scroll.add_child(page)
		_tabs.add_child(scroll)
		for item in g[1]:
			_item(page, item)
	if current >= 0 and current < _tabs.get_tab_count():
		_tabs.current_tab = current


func _item(page: VBoxContainer, item: Array) -> void:
	var key: String = item[0]
	var label := Label.new()
	label.text = item[1]
	label.custom_minimum_size.x = 380
	label.autowrap_mode = TextServer.AUTOWRAP_WORD
	var row := HBoxContainer.new()
	row.add_child(label)
	match str(item[2]):
		"select":
			var path: String = item[4]
			var o := OptionButton.new()
			var now := str(Tuning.read(car.config, path))
			for opt in item[3]:
				o.add_item(opt)
				if opt == now:
					o.select(o.item_count - 1)
			o.item_selected.connect(func(i: int): _apply(key, path, item[3][i]))
			row.add_child(o)
		"bool":
			var path: String = item[3]
			var c := CheckBox.new()
			var v: Variant = Tuning.read(car.config, path)
			c.button_pressed = (v == item[4]) if v != null else key != "unsprung"     # (not in car.json: fitted, and a car has suspension)
			c.toggled.connect(func(on: bool): _apply(key, path, item[4] if on else item[5]))
			row.add_child(c)
		_:
			var path: String = item[6]
			var factor: float = item[7]
			var v: Variant = Tuning.read(car.config, path)
			if v == null:
				if path.contains("gear_ratios") or path.begins_with("wheels.library"):
					return                # (a gear the car does not have, or a tyre that is not a custom one)
				v = Tuning.FALLBACK.get(path, 0.0)
			var slider := HSlider.new()
			slider.min_value = item[3]
			slider.max_value = item[4]
			slider.step = item[5]
			slider.value = float(v) / factor
			slider.custom_minimum_size.x = 220
			slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(slider)
			var value := Label.new()
			value.custom_minimum_size.x = 110
			var show := func(x: float) -> void: value.text = "%s %s" % [str(snappedf(x, item[5])), item[2]]
			show.call(slider.value)
			row.add_child(value)
			slider.value_changed.connect(func(x: float):
				show.call(x)
				_apply(key, path, x * factor))
	page.add_child(row)


func _apply(key: String, path: String, value: Variant) -> void:
	var cfg := car.config.duplicate(true)
	Tuning.write(cfg, path, value)
	car.apply_config(cfg)
	RunLog.event("tuning %s = %s" % [key, value])
