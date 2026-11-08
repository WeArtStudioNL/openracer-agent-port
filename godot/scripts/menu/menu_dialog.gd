class_name MenuDialog
extends Control
## A window of the main menu (MainMenu.js dialog, #garageDialog, #replaysDialog): a shade over the menu and a box
## with a title and a note. A click beside it, Escape or B (ui_cancel) closes it; the one on top first.

signal closed

var box: VBoxContainer
var panel: PanelContainer
var status: Label


func _init(title: String, note := "", width := 720.0) -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	process_mode = Node.PROCESS_MODE_ALWAYS
	var shade := ColorRect.new()
	shade.color = Color(0, 0, 0, 0.7)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	shade.gui_input.connect(func(e: InputEvent):
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			close())
	add_child(shade)
	var centre := CenterContainer.new()
	centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(centre)
	panel = PanelContainer.new()
	panel.add_theme_stylebox_override("panel", MenuStyle.flat(MenuStyle.PANEL, MenuStyle.LINE, 12, 1, 22))
	centre.add_child(panel)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size = Vector2(width, 0)
	panel.add_child(scroll)
	box = VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_theme_constant_override("separation", 8)
	scroll.add_child(box)
	box.add_child(MenuStyle.label(title, 22, MenuStyle.HEAD))
	if note != "":
		box.add_child(MenuStyle.label(note, 14, MenuStyle.MUTED, true))
	status = MenuStyle.label("", 14, MenuStyle.ACCENT2, true)
	status.visible = false
	# (the box grows with what is put in, up to the window less a margin; then it scrolls)
	box.resized.connect(_fit.bind(scroll))


func _fit(scroll: ScrollContainer) -> void:
	var most := get_viewport_rect().size.y - 80.0
	scroll.custom_minimum_size.y = minf(box.get_combined_minimum_size().y, most)


## A line under the title that says what happened (red for an error).
func say(text: String, error := false) -> void:
	if status.get_parent() == null:
		box.add_child(status)
		box.move_child(status, mini(2, box.get_child_count() - 1))
	status.text = text
	status.visible = text != ""
	status.add_theme_color_override("font_color", MenuStyle.BAD if error else MenuStyle.ACCENT2)


## A row of buttons at the bottom (right aligned).
func foot(buttons: Array) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	for b in buttons:
		row.add_child(b)
	box.add_child(row)
	return row


func close() -> void:
	closed.emit()
	queue_free()


## A question (OpenRacerDialog.ask): yes calls on_yes.
static func confirm(parent: Node, title: String, text: String, ok: String, on_yes: Callable) -> MenuDialog:
	var d := MenuDialog.new(title, text, 460)
	parent.add_child(d)
	var cancel := MenuStyle.button("Cancel", "ghost", d.close)
	var yes := MenuStyle.button(ok, "primary", func():
		d.close()
		on_yes.call())
	d.foot([cancel, yes])
	cancel.grab_focus.call_deferred()
	return d


## A file dialog of the system (open or save), for a zip, a replay or a folder.
static func file_dialog(parent: Node, mode: FileDialog.FileMode, filters: PackedStringArray, title: String, on_pick: Callable,
		file_name := "") -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = mode
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.filters = filters
	dlg.title = title
	if file_name != "":
		dlg.current_file = file_name
	parent.add_child(dlg)
	var done := func(p: Variant) -> void:
		dlg.queue_free()
		on_pick.call(p)
	if mode == FileDialog.FILE_MODE_OPEN_DIR:
		dlg.dir_selected.connect(done)
	elif mode == FileDialog.FILE_MODE_OPEN_FILES:
		dlg.files_selected.connect(done)
	else:
		dlg.file_selected.connect(done)
	dlg.canceled.connect(dlg.queue_free)
	dlg.popup_centered_ratio(0.6)


## The first thing to choose gets the focus (the keyboard and the gamepad).
func focus_first() -> void:
	for c in box.find_children("*", "BaseButton", true, false):
		if (c as Control).is_visible_in_tree() and not (c as BaseButton).disabled and (c as Control).focus_mode != Control.FOCUS_NONE:
			(c as Control).grab_focus()
			return


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") or (event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE):
		# (the window on top: the last child of its parent that is a window)
		for c in range(get_parent().get_child_count() - 1, -1, -1):
			var top := get_parent().get_child(c)
			if top is MenuDialog:
				if top == self:
					get_viewport().set_input_as_handled()
					close()
				return
