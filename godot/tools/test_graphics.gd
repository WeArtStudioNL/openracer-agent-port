extends Node
## (a scene, for the autoloads: Godot --path godot res://tools/test_graphics.tscn -- [--car=..] [--track=..] [--shot=file.png]
## [--hdr=file.hdr]) The graphics and the atmosphere: the AI drives, the presets and the weathers are set one after the other
## (for this run only: the settings of the player are not touched) and what the viewport, the environment and the ground
## then are is printed; --shot saves a picture of the Graphics tab of the settings over the drive, --hdr=1 saves the
## surroundings as an HDR (EnvironmentExport) to that file and reads it back.

var world: World
var _time := 0.0
var _step := 0


func _ready() -> void:
	world = World.new()
	add_child(world)
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	var track_id := Content.arg("track") if Content.arg("track") != "" else "kartbaan-oldenzaal"
	world.setup(car_id, track_id, {})


## A setting for this run only (the overrides of --set: not saved), as if it was changed in the menu.
func _override(key: String, value: Variant) -> void:
	Settings._overrides[key] = value
	Settings.changed.emit(key)


func _state(what: String) -> void:
	var vp := get_viewport()
	var atm := world.track.get_node("Atmosphere") as Atmosphere
	print("%s: scale %.2f msaa %d aniso %d far %.0f shadows %s/%.0f m ssr %s ssao %s ssil %s tone %d exposure %.2f post %s · %s wet %.2f snow %.2f grip %.2f fog %s" % [
		what, vp.scaling_3d_scale, vp.msaa_3d, vp.anisotropic_filtering_level, vp.get_camera_3d().far, atm.sun.shadow_enabled,
		atm.sun.directional_shadow_max_distance, atm.env.ssr_enabled, atm.env.ssao_enabled, atm.env.ssil_enabled, atm.env.tonemap_mode,
		atm.env.tonemap_exposure, atm.post.visible, Settings.get_value("gfx_weather"), Ground.wet, Ground.snow, Ground.grip(), atm.env.fog_enabled])


func _process(dt: float) -> void:
	_time += dt
	match _step:
		0:
			if _time > 3.0:
				_state("start")
				for name: String in Graphics.PRESETS:
					var p: Dictionary = Graphics.PRESETS[name]
					for k: String in p:
						_override(k, p[k])
					_state("preset " + name + " (" + Graphics.current_preset() + ")")
				for k: String in Graphics.PRESETS["high"]:
					_override(k, Graphics.PRESETS["high"][k])
				_step = 1
		1:
			for w in ["fog", "rain", "snow", "clear"]:
				_override("gfx_weather", w)
				Ground.step(30.0, w, [])
				_state("weather " + w)
			if Content.arg("shot") != "":
				var layer := CanvasLayer.new()
				layer.layer = 10
				add_child(layer)
				var centre := CenterContainer.new()
				centre.set_anchors_preset(Control.PRESET_FULL_RECT)
				layer.add_child(centre)
				var m := SettingsMenu.new()
				centre.add_child(m)
				var tabs := m.find_children("*", "TabContainer", true, false)
				if not tabs.is_empty():
					(tabs[0] as TabContainer).current_tab = 3
			_time = 0.0
			_step = 2
		2:
			if _time > 2.0:
				if Content.arg("shot") != "":
					get_viewport().get_texture().get_image().save_png(Content.arg("shot"))
					print("shot: ", Content.arg("shot"))
				_step = 3
				if Content.arg("hdr") != "":
					_hdr()
				else:
					get_tree().quit()


func _hdr() -> void:
	var t0 := Time.get_ticks_msec()
	var left := EnvironmentExport.own_cars(world, world.car).map(func(c): return "%s ghost=%s" % [c.name, c.is_ghost])
	print("left out: ", left)
	var hide := EnvironmentExport.own_cars(world, world.car)
	var path := await EnvironmentExport.save(world, world.car.global_position + Vector3(0, 0.6, 0), hide, 256, 512, Content.arg("hdr"))
	var bytes := FileAccess.get_file_as_bytes(path)
	var head := bytes.slice(0, 60).get_string_from_ascii().replace("\n", " | ")
	print("hdr: %s, %d bytes in %d ms, %s" % [path, bytes.size(), Time.get_ticks_msec() - t0, head])
	get_tree().quit()
