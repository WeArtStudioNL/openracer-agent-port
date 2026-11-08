class_name SettingsMenu
extends PanelContainer
## The settings (the Escape menu of web/js/Settings.js): the tabs Car, Keyboard, Gamepad, Wheel, Display and sound,
## Mobile, Graphics, Simulation, Tools and Controls (SettingsPages, SettingsControlsPage), a hint line, Reset all
## and the version. Used by the main menu and the pause menu (PauseMenu). With a gamepad (PadNav.js): the D-pad or the
## stick moves, A chooses, left and right change a list or a slider, L1 and R1 change the tab, B (and Esc) closes.

signal closed

const TABS := ["Car", "Keyboard", "Gamepad", "Wheel", "Display and sound", "Mobile", "Graphics", "Simulation", "Tools", "Controls"]

var world: Node = null              # the drive behind the menu (null in the main menu)
var pages: SettingsPages
var _tabs: TabContainer
var _hint: Label
var _controls: SettingsControlsPage
var _capture_action := ""            # the action that waits for an input ("" when none)
var _capture_index := 0


## The buttons of a gamepad in the menus of Godot (PadNav.js): A is ui_accept, B is ui_cancel (Godot's own ui_cancel has
## no joypad button; the D-pad and the stick are in ui_up, ui_down, ui_left and ui_right already).
static func pad_ui() -> void:
	for spec in [["ui_accept", JOY_BUTTON_A], ["ui_cancel", JOY_BUTTON_B]]:
		var has := false
		for e in InputMap.action_get_events(spec[0]):
			has = has or (e is InputEventJoypadButton and (e as InputEventJoypadButton).button_index == spec[1])
		if not has:
			var e := InputEventJoypadButton.new()
			e.device = -1
			e.button_index = spec[1]
			InputMap.action_add_event(spec[0], e)


func _ready() -> void:
	pad_ui()
	process_mode = Node.PROCESS_MODE_ALWAYS
	world = _find_world()
	var vp := get_viewport_rect().size
	custom_minimum_size = Vector2(minf(1000.0, vp.x - 40.0), minf(860.0, vp.y - 40.0))
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0.085, 0.1, 0.125, 0.97)
	bg.set_corner_radius_all(8)
	bg.border_color = Color(0.2, 0.24, 0.29)
	bg.set_border_width_all(1)
	add_theme_stylebox_override("panel", bg)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 18)
	add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	margin.add_child(box)
	var top := HBoxContainer.new()
	box.add_child(top)
	var head := VBoxContainer.new()
	head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(head)
	var title := Label.new()
	title.text = "Settings"
	title.add_theme_font_size_override("font_size", 28)
	head.add_child(title)
	var sub := Label.new()
	sub.text = ("The game is paused. " if world != null else "") + "Esc closes this menu."
	sub.modulate.a = 0.7
	head.add_child(sub)
	var close := Button.new()
	close.text = "Back" if world != null else "Close"
	close.custom_minimum_size = Vector2(120, 40)
	SettingsRows.style(close)
	close.pressed.connect(func(): closed.emit())
	top.add_child(close)
	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(_tabs)
	var foot := HBoxContainer.new()
	box.add_child(foot)
	var reset := Button.new()
	reset.text = "Reset all settings to the defaults"
	SettingsRows.style(reset)
	reset.pressed.connect(func():
		pages._confirm("Reset all settings?", "Every option of every tab goes back to the default (the controls, the setups and the "
			+ "calibration of the wheel stay).", "Reset", func():
				Settings.reset()
				rebuild()
				hint("The settings are back to the defaults.")))
	foot.add_child(reset)
	_hint = Label.new()
	_hint.add_theme_color_override("font_color", Color(1, 0.75, 0.45))
	_hint.autowrap_mode = TextServer.AUTOWRAP_WORD
	_hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	foot.add_child(_hint)
	var version := Label.new()
	version.text = "OpenRacer " + str(ProjectSettings.get_setting("application/config/version"))
	version.modulate.a = 0.5
	foot.add_child(version)
	_build_pages()
	var want := Content.arg("settings-tab")
	if want == "" or want == "pause":
		want = str(Settings.get_value("settings_tab"))
	_select_tab(want)
	_tabs.tab_changed.connect(func(i: int): Settings.set_value("settings_tab", _tabs.get_tab_title(i)))
	Controls.changed.connect(_controls_changed)
	_focus_first.call_deferred()


func _find_world() -> Node:
	for w in get_tree().root.find_children("World", "Node3D", true, false):
		if w.get("car") is Car:
			return w
	return null


func _build_pages() -> void:
	pages = SettingsPages.new(self, world)
	for t in TABS:
		if t == "Mobile" and not _touch_on():
			continue
		var page := _page(t)
		match t:
			"Car": pages.car_page(page)
			"Keyboard": pages.keyboard_page(page)
			"Gamepad": pages.gamepad_page(page)
			"Wheel": pages.wheel_page(page)
			"Display and sound": pages.display_page(page)
			"Mobile": pages.mobile_page(page)
			"Graphics": pages.graphics_page(page)
			"Simulation": pages.simulation_page(page)
			"Tools": pages.tools_page(page)
			"Controls":
				_controls = SettingsControlsPage.new(self, page)
				_controls.build()


func _touch_on() -> bool:
	return (world != null and world.get("touch") != null) or str(Settings.get_value("touch")) == "on"


## Every page again (after a reset, a wheel forgotten), on the same tab.
func rebuild() -> void:
	var tab := _tabs.get_tab_title(_tabs.current_tab) if _tabs.get_tab_count() > 0 else ""
	for c in _tabs.get_children():
		_tabs.remove_child(c)
		c.queue_free()
	_build_pages()
	_select_tab(tab)


func _select_tab(want: String) -> void:
	for i in _tabs.get_tab_count():
		if _tabs.get_tab_title(i).to_lower() == want.to_lower() or str(i) == want:
			_tabs.current_tab = i


func hint(text: String) -> void:
	if _hint != null:
		_hint.text = text


func capturing(action: String, index: int) -> bool:
	return _capture_action == action and _capture_index == index


func _process(_delta: float) -> void:
	if pages != null:
		pages.update_wheel_status()


func _controls_changed() -> void:
	if _controls != null:
		_controls.build()


func _capture(action: String, index: int) -> void:
	_capture_action = action
	_capture_index = index
	hint("%s: press a key, a gamepad button or stick, or a wheel button  (Esc: cancel, Delete: remove this one)" % Controls.label(action))
	_controls.build()


## While a binding waits for an input, every input goes here (and to nothing else); else the keys and the buttons of
## the menu: Esc and B close it, L1 and R1 change the tab, left and right change a list.
func _input(event: InputEvent) -> void:
	if _capture_action == "":
		_navigate(event)
		return
	if event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
		_end_capture("")
		get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and event.physical_keycode == KEY_DELETE:
		Controls.clear_binding(_capture_action, _capture_index)
		_end_capture("")
		get_viewport().set_input_as_handled()
		return
	var b: Variant = Controls.binding_of(event)
	if b == null:
		if event is InputEventKey or event is InputEventJoypadButton or event is InputEventJoypadMotion or event is InputEventMouseButton:
			get_viewport().set_input_as_handled()
		return
	RunLog.event("binding %s %d = %s" % [_capture_action, _capture_index, Controls.describe(b)])
	var action := _capture_action
	_capture_action = ""
	var taken := Controls.set_binding(action, _capture_index, b)
	_end_capture("That input was used for %s: it is moved to %s." % [taken, Controls.label(action)] if taken != "" else "")
	get_viewport().set_input_as_handled()


func _end_capture(text: String) -> void:
	_capture_action = ""
	hint(text)
	if _controls != null:
		_controls.build()
	_focus_first.call_deferred()


func _navigate(event: InputEvent) -> void:
	if not is_visible_in_tree() or not event.is_pressed() or event.is_echo() and not event is InputEventKey:
		return
	for w in find_children("*", "Window", true, false):
		if (w as Window).visible:
			return              # (a question or a window over the menu: its own keys)
	if event.is_action_pressed("ui_cancel") or event.is_action_pressed("menu"):
		get_viewport().set_input_as_handled()
		closed.emit()
		return
	if event is InputEventJoypadButton and event.button_index in [JOY_BUTTON_LEFT_SHOULDER, JOY_BUTTON_RIGHT_SHOULDER]:
		var n := _tabs.get_tab_count()
		_tabs.current_tab = (_tabs.current_tab + (1 if event.button_index == JOY_BUTTON_RIGHT_SHOULDER else -1) + n) % n
		get_viewport().set_input_as_handled()
		_focus_first.call_deferred()
		return
	var focus := get_viewport().gui_get_focus_owner()
	if focus is OptionButton and (event.is_action_pressed("ui_left") or event.is_action_pressed("ui_right")):
		var o := focus as OptionButton
		var i := clampi(o.selected + (1 if event.is_action_pressed("ui_right") else -1), 0, o.item_count - 1)
		if i != o.selected and not o.disabled:
			o.select(i)
			o.item_selected.emit(i)
		get_viewport().set_input_as_handled()


## The focus on the first thing that can be chosen on the tab that is open (a gamepad starts there).
func _focus_first() -> void:
	if _tabs == null or _tabs.get_current_tab_control() == null:
		return
	for c in _tabs.get_current_tab_control().find_children("*", "Control", true, false):
		var ctl := c as Control
		if ctl.focus_mode == Control.FOCUS_ALL and ctl.is_visible_in_tree() and not (ctl is BaseButton and (ctl as BaseButton).disabled) \
				and not ctl is ScrollBar:
			ctl.grab_focus()
			return


func _page(name_text: String) -> VBoxContainer:
	var scroll := ScrollContainer.new()
	scroll.name = name_text
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.follow_focus = true
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_right", 14)
	margin.add_theme_constant_override("margin_top", 6)
	scroll.add_child(margin)
	var page := VBoxContainer.new()
	page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	page.add_theme_constant_override("separation", 6)
	margin.add_child(page)
	_tabs.add_child(scroll)
	return page
