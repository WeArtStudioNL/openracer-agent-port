class_name CarInfo
extends RefCounted
## What the menu says about a car and a track (MainMenu.js carPower, carSpecs, topSpeedText; CarDefaults.js
## OpenRacer.topSpeed), and their pictures: preview.webp of the car or the track; a car without one gets a picture
## drawn once from its model (MainMenu.js showcase.still), kept in the user folder (previews/<id>.png).

static var _textures := {}
static var _rendering := {}
static var _show: Showcase = null
static var _chosen := {}                # the chosen tile: bg, id, cfg, host (it turns when no other does)


## The showcase (MainMenu.js showcase): the tile whose car turns in 3D is the one under the mouse or with the focus,
## else the chosen one. One viewport draws it (a car model each is too much for a list of cars); the other tiles keep
## their pictures.
class Showcase:
	extends SubViewport
	var car: Car
	var car_id := ""
	var clock := 0.0
	var radius := 0.33
	var shown: TextureRect = null    # the picture that shows it now, and what it showed before
	var still: Texture2D = null

	func _process(dt: float) -> void:
		clock += dt
		if car != null and is_instance_valid(car):
			car.place(Vector3(0, radius, 0), clock * 0.35 + 0.75)


## The peak power in HP from the torque curve, times the power scale of the tuning.
static func power(cfg: Dictionary) -> int:
	var eng: Dictionary = cfg.get("engine", {})
	var peak := 0.0
	for p in eng.get("torque_curve", []):
		peak = maxf(peak, float(p[1]) * float(p[0]) * PI / 30.0 / 745.7)
	return roundi(peak * float(eng.get("power_scale", 1.0)))


## The top speed in m/s worked out from the configuration (OpenRacer.topSpeed): in every gear the speed where the
## thrust at the wheels is as big as the drag and the rolling resistance, up to the rev limit; the highest of them.
static func top_speed(cfg: Dictionary) -> float:
	var ch: Dictionary = cfg.get("chassis", {})
	var dt: Dictionary = cfg.get("drivetrain", {})
	var eng: Dictionary = cfg.get("engine", {})
	var dim: Dictionary = cfg.get("dimensions", {})
	var curve: Array = eng.get("torque_curve", [])
	var gears: Array = dt.get("gear_ratios", [])
	if ch.is_empty() or curve.size() < 2 or gears.is_empty() or float(dt.get("final_drive", 0)) <= 0.0 or float(eng.get("limiter_rpm", 0)) <= 0.0 \
			or float(ch.get("tire_diameter", 0)) <= 0.0:
		return 0.0
	var axle := "front" if dt.get("drive", "rwd") == "fwd" else "rear"
	var fitted: Dictionary = cfg.get("wheels", {}).get("library", {}).get(axle, {}) if cfg.get("wheels", {}) is Dictionary else {}
	var custom: Variant = fitted.get("custom", null) if fitted is Dictionary else null
	var r := (float(custom["diameter"]) if custom is Dictionary and float(custom.get("diameter", 0)) > 0.0 else float(ch["tire_diameter"])) / 2.0
	var scale := float(eng.get("power_scale", 1.0))
	var efficiency := float(dt.get("efficiency", 0.92))
	var cdrag := 0.5 * float(ch.get("drag_coefficient", 0.3)) * float(dim.get("width", 1.8)) * float(dim.get("height", 1.4)) * 0.85 * 1.29
	var roll := float(cfg.get("tyres", {}).get("rolling_resistance", 0.015)) * float(ch.get("mass", 1000)) * 9.81
	var ratios: Array = gears
	if dt.get("gearbox", "") == "cvt":
		var lo: float = gears.min()
		var hi: float = gears.max()
		ratios = []
		for k in 41:
			ratios.append(lo + (hi - lo) * k / 40.0)
	var best := 0.0
	var final := float(dt["final_drive"])
	var limiter := float(eng["limiter_rpm"])
	for ratio in ratios:
		var total := float(ratio) * final
		var v := limiter * PI / 30.0 * r / total
		while v > 0.5:
			var rpm := v / r * total * 30.0 / PI
			var thrust := _torque(curve, rpm) * scale * efficiency * total / r
			if thrust >= cdrag * v * v + roll:
				best = maxf(best, v)
				break
			v -= 0.1
	return best


static func _torque(curve: Array, rpm: float) -> float:
	for i in range(1, curve.size()):
		if rpm <= float(curve[i][0]):
			var a: Array = curve[i - 1]
			var b: Array = curve[i]
			return float(a[1]) + (float(b[1]) - float(a[1])) * (rpm - float(a[0])) / maxf(1e-9, float(b[0]) - float(a[0]))
	return 0.0


## "1250 kg · RWD · 5 gears · 230 km/h" (a motorcycle: with its rider).
static func specs(cfg: Dictionary) -> String:
	var gears: int = cfg.get("drivetrain", {}).get("gear_ratios", []).size()
	var v := top_speed(cfg)
	var top := " · " + Settings.speed_text(v) if v > 0.0 else ""
	var mass := float(cfg.get("chassis", {}).get("mass", 0))
	if str(cfg.get("type", "car")) == "motorcycle":
		mass += float(cfg.get("rider", {}).get("mass", 75)) if cfg.get("rider", {}) is Dictionary else 75.0
		return "%d kg · motorcycle · %d gears%s" % [roundi(mass), gears, top]
	return "%d kg · %s · %d gears%s" % [roundi(mass), str(cfg.get("drivetrain", {}).get("drive", "rwd")).to_upper(), gears, top]


## "my garage" or "folder" for a car or track of the garage, "" for one of the game.
static func source(kind: String, id: String) -> String:
	if not Garage.ids(kind).has(id):
		return ""
	var own := str(Settings.get_value("garage_folder"))
	if own != "" and FileAccess.file_exists(own.path_join(kind).path_join(id).path_join(Garage.CONFIG_FILE[kind])):
		return "folder"
	return "my garage"


## The picture of a track (its preview.webp), or null.
static func track_picture(id: String) -> Texture2D:
	return _webp("tracks/%s/preview.webp" % id)


## The picture of a car: preview.webp, else the one drawn from its model (made once, in the background: on_ready gets it).
static func car_picture(id: String, cfg: Dictionary, host: Node, on_ready: Callable) -> Texture2D:
	var t := _webp("cars/%s/preview.webp" % id)
	if t != null:
		return t
	var file := Settings.path("previews/%s.png" % id)
	if _textures.has(file):
		return _textures[file]
	if FileAccess.file_exists(file):
		var img := Image.load_from_file(file)
		if img != null:
			_textures[file] = ImageTexture.create_from_image(img)
			return _textures[file]
	if not _rendering.has(id) and host != null and DisplayServer.get_name() != "headless":
		_rendering[id] = true
		_render(id, cfg, host, file, on_ready)
	return null


static func _webp(rel: String) -> Texture2D:
	var p := Content.path(rel)
	if _textures.has(p):
		return _textures[p]
	if not FileAccess.file_exists(p):
		return null
	var img := Image.new()
	if img.load_webp_from_buffer(FileAccess.get_file_as_bytes(p)) != OK:
		return null
	var tex := ImageTexture.create_from_image(img)
	_textures[p] = tex
	return tex


## The car drawn once in a viewport of its own, from the front at an angle (showcase.still), and kept as a png.
static func _render(id: String, cfg: Dictionary, host: Node, file: String, on_ready: Callable) -> void:
	var vp := SubViewport.new()
	vp.size = Vector2i(480, 480)
	vp.own_world_3d = true
	vp.transparent_bg = true
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	host.add_child(vp)
	var car := Car.new()
	car.engine_damage_on = false
	car.setup(id, cfg)
	car.freeze = true
	vp.add_child(car)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, 35, 0)
	sun.light_energy = 1.6
	vp.add_child(sun)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(0.6, 0.62, 0.66)
	env.environment.background_mode = Environment.BG_CLEAR_COLOR
	vp.add_child(env)
	var cam := Camera3D.new()
	cam.fov = 32.0
	vp.add_child(cam)
	var length := float(cfg.get("dimensions", {}).get("length", 4.5))
	var radius := float(cfg.get("chassis", {}).get("tire_diameter", 0.65)) / 2.0
	car.place(Vector3(0, radius, 0), 0.0)
	var d := length * 1.75
	cam.position = Vector3(sin(0.75) * d, length * 0.38 + radius, cos(0.75) * d)
	cam.look_at(Vector3(0, radius * 1.3, 0))
	cam.make_current()
	for i in 4:
		await RenderingServer.frame_post_draw
	if not is_instance_valid(vp):
		return
	var img := vp.get_texture().get_image()
	DirAccess.make_dir_recursive_absolute(file.get_base_dir())
	img.save_png(file)
	_textures[file] = ImageTexture.create_from_image(img)
	vp.queue_free()
	RunLog.event("menu: picture of %s drawn (%s)" % [id, file])
	if on_ready.is_valid():
		on_ready.call(_textures[file])


## The key of the records of a car with a tune of its own (Records.js key: car~tune).
static func record_key(car_id: String, tune_name: String) -> String:
	return car_id + "~" + tune_name if tune_name != "" else car_id


## The best lap of a car (and tune) on a track, or -1.
static func best_lap(track_id: String, key: String) -> float:
	var cfg := ConfigFile.new()
	if cfg.load(LapTimer.RECORDS) != OK:
		return -1.0
	return float(cfg.get_value(track_id, key, -1.0))


## The name of the tune in use for a car ("" for the car as made).
static func active_tune(car_id: String, cfg: Dictionary) -> String:
	var path := str(Settings.get_value("tunes").get(car_id, ""))
	if path == "":
		return ""
	var tunes := Tuning.list(car_id, cfg)
	for n in tunes:
		if tunes[n] == path:
			return str(n)
	return ""


## The kind of a car: "car", "kart" or "motorcycle" (as Race picks the opponents).
static func kind(cfg: Dictionary) -> String:
	if str(cfg.get("type", "car")) == "motorcycle":
		return "motorcycle"
	var light := float(cfg.get("chassis", {}).get("mass", 1000)) < 400
	return "kart" if light or str(cfg.get("name", "")).to_lower().contains("kart") else "car"


# ---- the showcase (MainMenu.js showcase): the 3D model of a car turns slowly on its tile

## The car of a tile turns on it (bg: its picture). chosen: the tile of the chosen car (it turns when no other does).
static func showcase(bg: TextureRect, id: String, cfg: Dictionary, host: Node, chosen := false) -> void:
	if chosen:
		_chosen = {"bg": bg, "id": id, "cfg": cfg, "host": host}
	if host == null or not host.is_inside_tree() or DisplayServer.get_name() == "headless":
		return
	if _show == null or not is_instance_valid(_show):
		_show = Showcase.new()
		_show.size = Vector2i(400, 400)
		_show.own_world_3d = true
		_show.transparent_bg = true
		_show.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		var sun := DirectionalLight3D.new()
		sun.rotation_degrees = Vector3(-50, 35, 0)
		sun.light_energy = 1.6
		_show.add_child(sun)
		var env := WorldEnvironment.new()
		env.environment = Environment.new()
		env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		env.environment.ambient_light_color = Color(0.6, 0.62, 0.66)
		env.environment.background_mode = Environment.BG_CLEAR_COLOR
		_show.add_child(env)
		var cam := Camera3D.new()
		cam.name = "Camera"
		cam.fov = 32.0
		_show.add_child(cam)
		host.get_tree().root.add_child(_show)
	if _show.shown != null and is_instance_valid(_show.shown) and _show.shown != bg:
		_show.shown.texture = _show.still
	if _show.shown != bg:
		_show.still = bg.texture
		_show.shown = bg
	if _show.car_id != id:
		if _show.car != null and is_instance_valid(_show.car):
			_show.car.queue_free()
		var car := Car.new()
		car.engine_damage_on = false
		car.setup(id, cfg)
		car.freeze = true
		_show.add_child(car)
		_show.car = car
		_show.car_id = id
		var length := float(cfg.get("dimensions", {}).get("length", 4.5))
		_show.radius = float(cfg.get("chassis", {}).get("tire_diameter", 0.65)) / 2.0
		# (the camera by the size of the model as it is, not by the figures of car.json: MainMenu.js modelOf)
		car.place(Vector3(0, _show.radius, 0), 0.0)
		var box := AABB()
		var first := true
		for m in car.find_children("*", "MeshInstance3D", true, false):
			var mi := m as MeshInstance3D
			if mi.mesh == null or not mi.is_visible_in_tree():
				continue
			var b := mi.global_transform * mi.get_aabb()
			box = b if first else box.merge(b)
			first = false
		if not first and box.size.x > 1.0 and box.size.z > 1.0:
			length = maxf(box.size.x, box.size.z)
		var cam := _show.get_node("Camera") as Camera3D
		var d := length * 2.1          # (a little further than the still: the car turns, its diagonal must fit)
		cam.position = Vector3(sin(0.6) * d, length * 0.4 + _show.radius, cos(0.6) * d)
		cam.look_at(Vector3(0, _show.radius * 1.3, 0))
		cam.make_current()
	bg.texture = _show.get_texture()


## The mouse or the focus left a tile: the chosen car turns again (or nothing, when it was the chosen one).
static func showcase_leave(bg: TextureRect) -> void:
	if _show == null or not is_instance_valid(_show) or _show.shown != bg:
		return
	var c := _chosen
	if not c.is_empty() and is_instance_valid(c["bg"]) and c["bg"] != bg:
		showcase(c["bg"], c["id"], c["cfg"], c["host"])


## The menu is gone (a drive starts): the viewport and its car go.
static func showcase_end() -> void:
	if _show != null and is_instance_valid(_show):
		if _show.shown != null and is_instance_valid(_show.shown):
			_show.shown.texture = _show.still
		_show.queue_free()
	_show = null
	_chosen = {}
