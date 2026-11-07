class_name GraphicsPage
extends VBoxContainer
## The Graphics tab of the settings (the Graphics page of the Escape menu of the browser game, Settings.js): the
## preset, the picture, light and shadow, the look, the atmosphere (time of day, sun, moon, weather) and the effects.
## Every change works at once (Atmosphere applies it to the drive); a change of an option of a preset makes it Custom.

const TIMES := [[5.25, "Dawn"], [8.0, "Morning"], [12.0, "Noon"], [15.0, "Afternoon"], [17.5, "Evening"], [19.0, "Sunset"],
	[20.25, "Dusk"], [23.5, "Night"]]
const WEATHERS := [["clear", "Clear"], ["cloudy", "Cloudy"], ["fog", "Fog"], ["rain", "Rain"], ["snow", "Snow"]]

var _status: Label


func _ready() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 6)
	_build()


func _build() -> void:
	for c in get_children():
		c.queue_free()
	_note("A preset sets all of these at once; changing one of them makes it Custom. The screen space effects (SSAO, SSIL) cost "
		+ "frames: try them one by one.")
	var presets := [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["ultra", "Ultra"]]
	var now := Graphics.current_preset()
	if now == "custom":
		presets.append(["custom", "Custom"])
	_pick("Preset", now, presets, func(v: Variant):
		if str(v) != "custom":
			Graphics.apply_preset(str(v))
			_build.call_deferred())
	_section("Picture")
	var native := "Native (%dp)" % DisplayServer.window_get_size().y if DisplayServer.get_name() != "headless" else "Native"
	var res := []
	for r in Graphics.RESOLUTIONS:
		res.append([r, native if str(r) == "native" else ("2160p (4K)" if str(r) == "2160" else "%sp" % r)])
	_pick("Resolution", Settings.get_value("gfx_resolution"), res, _setter("gfx_resolution"))
	_pick("Anti-aliasing", Settings.get_value("gfx_aa"), [[0, "Off"], [2, "2× MSAA"], [4, "4× MSAA"], [8, "8× MSAA"]], _setter("gfx_aa"))
	_pick("Edge smoothing over it (Godot)", Settings.get_value("gfx_smooth"),
		[["off", "Off"], ["fxaa", "FXAA"], ["smaa", "SMAA"], ["taa", "TAA (temporal)"]], _setter("gfx_smooth"))
	_pick("Texture sharpness at a slant (anisotropic)", Settings.get_value("gfx_aniso"),
		[[1, "Off"], [2, "2×"], [4, "4×"], [8, "8×"], [16, "16×"]], _setter("gfx_aniso"))
	_pick("Sharpening", Settings.get_value("gfx_sharpen"), [[0, "Off"], [1, "Low"], [2, "Medium"], [3, "High"]], _setter("gfx_sharpen"))
	_pick("Draw distance", Settings.get_value("gfx_distance"), [[500, "500 m"], [1000, "1000 m"], [2000, "2000 m"], [5000, "5000 m"]],
		_setter("gfx_distance"))
	_section("Light and shadow")
	var shadows := [[0, "Off"]]
	var names := ["Off", "Low", "Medium", "High", "Ultra"]
	for i in range(1, 5):
		shadows.append([i, "%s (%d)" % [names[i], Graphics.SHADOW_SIZES[i]]])
	_pick("Shadows", Settings.get_value("gfx_shadows"), shadows, _setter("gfx_shadows"))
	_pick("Reflections (screen space)", Settings.get_value("gfx_reflections"), [[0, "Off (the sky only)"], [1, "Low"], [2, "High"]],
		_setter("gfx_reflections"))
	_pick("Ambient occlusion (SSAO)", Settings.get_value("gfx_ao"), [[0, "Off"], [1, "Low"], [2, "High"]], _setter("gfx_ao"))
	_pick("Global illumination (SSIL)", Settings.get_value("gfx_gi"), [[0, "Off"], [1, "Low"], [2, "High"]], _setter("gfx_gi"))
	_section("Look")
	_pick("Tone mapping", Settings.get_value("gfx_tone"), [["neutral", "Neutral (Filmic in Godot)"], ["agx", "AgX (soft, a little flat)"],
		["aces", "ACES (film, strong contrast)"], ["none", "Off (clips the bright parts)"]], _setter("gfx_tone"))
	_slider("Exposure (the brightness of the picture)", "gfx_exposure", 0.4, 1.6, 0.05, "%.2f")
	_slider("Contrast", "gfx_contrast", 0.7, 1.4, 0.05, "%.2f")
	_slider("Saturation", "gfx_saturation", 0.0, 1.6, 0.05, "%.2f")
	_pick("Vignette", Settings.get_value("gfx_vignette"), [[false, "Off"], [true, "On"]], _setter("gfx_vignette"))
	_section("Atmosphere")
	_pick("Time of day", Settings.get_value("gfx_time"), TIMES, func(v: Variant):
		Settings.set_value("gfx_time", v)
		_build.call_deferred())
	_slider("Hour (fine)", "gfx_time", 0.0, 24.0, 0.25, "hour")
	_slider("Sun direction (where it is at noon)", "gfx_sun_azimuth", 0.0, 355.0, 5.0, "%d°")
	_pick("Moon", Settings.get_value("gfx_moon"), [[0.0, "New"], [0.25, "Crescent"], [0.5, "Half"], [0.75, "Gibbous"], [1.0, "Full"]],
		_setter("gfx_moon"))
	_pick("Weather", Settings.get_value("gfx_weather"), WEATHERS, _setter("gfx_weather"))
	_note("The sky is the same on every track. Rain wets the road and snow lies on it and stays: both give less grip (the AI drives "
		+ "slower), snow most. Wet comes in about 40 seconds and dries in a few minutes; snow builds up in a few minutes and melts "
		+ "slowly. There are no headlights yet: the night is dark.")
	_section("Effects")
	_slider("Smoke", "gfx_smoke", 0.0, 200.0, 10.0, "%d%%")
	var world := _world()
	if world != null:
		_section("Surroundings for Blender")
		var row := HBoxContainer.new()
		var b := Button.new()
		b.text = "Save as HDR"
		row.add_child(b)
		_status = Label.new()
		_status.autowrap_mode = TextServer.AUTOWRAP_WORD
		_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(_status)
		b.pressed.connect(_export.bind(b))
		add_child(row)


## The drive behind the menu, if there is one.
func _world() -> Node3D:
	var found := get_tree().root.find_children("World", "Node3D", true, false) if is_inside_tree() else []
	for w in found:
		if w.get("car") is Car:
			return w
	return null


func _export(button: Button) -> void:
	var world := _world()
	if world == null:
		return
	var car: Car = world.get("car")
	button.disabled = true
	_status.text = "Rendering…"
	var path := await EnvironmentExport.save(world, car.global_position + Vector3(0, 0.6, 0), EnvironmentExport.own_cars(world, car))
	_status.text = ("Saved: " + path) if path != "" else "Could not save the picture."
	button.disabled = false


func _setter(key: String) -> Callable:
	return func(v: Variant):
		Settings.set_value(key, v)
		_preset_follows(key)


## An option of a preset changed by hand: the preset is Custom now (or the one that it matches).
func _preset_follows(key: String) -> void:
	var before := str(Settings.get_value("gfx_preset"))
	Graphics.preset_follows(key)
	if str(Settings.get_value("gfx_preset")) != before:
		_build.call_deferred()


func _section(text: String) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 20)
	add_child(l)


func _note(text: String) -> void:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.modulate.a = 0.75
	add_child(l)


func _row(text: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = text
	label.custom_minimum_size.x = 300
	label.autowrap_mode = TextServer.AUTOWRAP_WORD
	row.add_child(label)
	add_child(row)
	return row


## A choice: items are [value, text]; the item of the value now is selected (none when the value is between them).
func _pick(text: String, current: Variant, items: Array, apply: Callable) -> void:
	var row := _row(text)
	var o := OptionButton.new()
	o.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	o.fit_to_longest_item = false
	var chosen := -1
	for i in items.size():
		o.add_item(str(items[i][1]))
		if str(items[i][0]) == str(current) or (current is float and items[i][0] is float and is_equal_approx(current, items[i][0])):
			chosen = i
	o.select(chosen)
	o.item_selected.connect(func(i: int): apply.call(items[i][0]))
	row.add_child(o)


func _slider(text: String, key: String, lo: float, hi: float, step: float, fmt: String) -> void:
	var row := _row(text)
	var slider := HSlider.new()
	slider.min_value = lo
	slider.max_value = hi
	slider.step = step
	slider.value = float(Settings.get_value(key))
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.custom_minimum_size.x = 160
	row.add_child(slider)
	var value := Label.new()
	value.custom_minimum_size.x = 64
	var show := func(v: float) -> void:
		if fmt == "hour":
			value.text = "%d:%02d" % [floori(v), roundi((v - floori(v)) * 60.0)]
		else:
			value.text = fmt % v if fmt != "%d°" and fmt != "%d%%" else fmt % roundi(v)
	show.call(slider.value)
	row.add_child(value)
	slider.value_changed.connect(func(v: float):
		show.call(v)
		Settings.set_value(key, int(v) if key == "gfx_smoke" else v)
		if key == "gfx_smoke":
			_preset_follows(key))
