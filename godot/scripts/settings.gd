extends Node
## The settings of the player, kept in user://settings.cfg: the sound, the driving aids, the keyboard, the racing
## wheel and its force feedback, the HUD, the graphics (the defaults are those of web/js/Settings.js), and the
## profiles of the wheels that were calibrated (per device, see WheelInput).
##
## (the tests: --user-dir=/some/folder keeps settings.cfg and the other files of the menus there, not in the
## player's user folder; --set=key:value,key:value changes a setting for this run only, not saved)

signal changed(key: String)

const FILE := "settings.cfg"

const DEFAULTS := {
	"garage_folder": "",                 # a folder of the player's own cars and tracks (Garage), "" for none
	"volume": 0.8,                # the engine
	"tyre_volume": 0.8,
	"sound": true,                # the engine sound on or off (the key E of the browser game: mute)
	"abs": true,
	"tc": true,                   # traction control (when the car has it)
	"esc": true,                  # stability control (when the car has it)
	"launch_control": false,      # brake and full throttle at a standstill hold the engine; the brake let go: a launch
	"two_step": false,            # the clutch in at a standstill holds the engine at the two-step speed
	"tyre_wear": 0.0,             # tyre temperature and wear: 0 off (the tyres at their best), else how fast they wear
	"damage": true,               # the cars dent and lose parts (the soft body); off: rigid bodies, as main.js &damage=0
	"auto_reverse": true,         # holding the brake at a standstill puts the car in reverse (the keys)
	"auto_reverse_pedals": true,  # the same with the brake pedal of a wheel, a pad or the touch screen
	"auto_reverse_speed": 3.0,    # km/h: below this speed
	"drag_ready": 2.0,            # s of "Get ready" on the drag strip before the lights
	"drag_green": 1.5,            # s that the lights stay after the green
	"key_steer_speed": 1.0,       # how fast the keys turn the wheels (a factor; the Keyboard page sets it from the time)
	"key_steer_at_speed": 1.0,    # how much less the keys steer at speed (a factor: 0 none, 1 as the browser game)
	# the easing of the keys (Settings.js): the time to the full value (s) and the curve (1 straight)
	"key_throttle_time": 0.5,
	"key_throttle_curve": 0.6,
	"key_brake_time": 0.4,
	"key_brake_curve": 0.6,
	"key_steer_time": 0.9,
	"key_steer_curve": 1.0,
	"key_slow": 1.0,              # the keys steer slower at speed
	"key_assist": true,           # the front wheels turn into a slide by themselves (keys)
	"pad_slow": 1.5,              # the stick steers slower at speed
	"pad_assist": true,
	"touch_steer": 1.0,           # the finger travel for the full lock (TouchControls)
	"touch": "auto",              # the touch controls: auto (a touch screen), on, off
	"camera": 0,                  # the camera at the start: 0 behind, 1 cockpit, 2 bonnet
	# a motorcycle (Settings.js)
	"bike_steering": "lean",      # lean: the lean only; counter: countersteering and the lean
	"bike_camera": "lean",        # lean: the picture rolls with the bike; classic: as a car
	"wheelie_control": true,
	"bike_fast_lean": 30.0,       # degrees of lean the keys ask for at top speed
	"bike_push": false,           # flat-track style
	"wheel_range": 1.0,           # the part of the turn of the wheel that is used for the lock (1: all)
	"wheel_match": false,         # turn as far as the steering wheel of the car (car.json steering_wheel.degrees)
	"wheel_degrees": 900,         # how far the wheel turns from lock to lock
	"wheel_deadzone": 1.0,        # % of the range around the middle
	"ffb": true,
	"ffb_strength": 0.6,
	"ffb_spring": 0.15,
	"ffb_damping": 0.35,
	"ffb_road": 0.5,
	"ffb_invert": false,
	"hud": true,                  # the HUD on or off (H)
	"units": "metric",            # metric (km/h) or imperial (mph)
	"debug": false,               # the debug text (F3)
	"hud_layout": {},             # the HUD editor: element -> {x, y (parts of the window), s (scale), o (opacity)}
	"panels": {},                 # the floating panels (Movable): key -> {x, y, w, h}
	"settings_tab": "Car",        # the tab of the settings that was open
	"debug_show_shell": true,     # the debug view (0) draws the nodes, the beams and the triangles
	"keys_shown": false,          # the box with the keys that matter was shown once
	"controls": {},               # the bindings that the player set (Controls)
	"tunes": {},                  # car -> the tune in use (its file)
	# the graphics (Graphics, the Graphics page of web/js/Graphics.js): a preset is a set of these
	"gfx_preset": "high",
	"gfx_resolution": "native",   # "native" or the height of the picture in pixels (720, 1080, 1440, 2160)
	"gfx_aa": 4,                  # MSAA samples (0, 2, 4, 8)
	"gfx_smooth": "off",          # a screen space anti-aliasing over it (Godot): off, fxaa, smaa, taa
	"gfx_shadows": 2,             # 0 off .. 4 ultra
	"gfx_reflections": 2,         # 0 off, 1 low, 2 high
	"gfx_ao": 0,                  # ambient occlusion: 0 off, 1 low, 2 high
	"gfx_gi": 0,                  # global illumination (SSIL): 0 off, 1 low, 2 high
	"gfx_vignette": true,
	"gfx_smoke": 100,             # % of the tyre smoke and dust
	"gfx_distance": 2000,         # m
	"gfx_aniso": 8,
	"gfx_sharpen": 1,             # 0 off .. 3 high
	"gfx_tone": "neutral",        # neutral, agx, aces, none
	"gfx_exposure": 0.9,
	"gfx_contrast": 1.05,
	"gfx_saturation": 1.0,
	"gfx_debris_rate": 1.0,       # the grass, sand and snow that the wheels throw up (not in Godot yet)
	"gfx_debris_scale": 1.0,
	"gfx_debris_max": 6000,
	# the atmosphere (Atmosphere): the hour, where the sun is at noon, the phase of the moon, the weather
	"gfx_time": 14.0,
	"gfx_sun_azimuth": 40.0,
	"gfx_moon": 1.0,
	"gfx_weather": "clear",       # clear, cloudy, fog, rain, snow
	# the mirrors of the car (CarMirrors, Mirrors.js): the turn and the tilt of each glass (degrees), and a real mirror
	"mirror_left_yaw": 0.0, "mirror_left_tilt": 0.0, "mirror_left_real": true,
	"mirror_right_yaw": 0.0, "mirror_right_tilt": 0.0, "mirror_right_real": true,
	"mirror_centre_yaw": 0.0, "mirror_centre_tilt": 0.0, "mirror_centre_real": true,
	# the simulation (Settings.js, the Simulation tab)
	"sim_tyre_detail": "full",
	"sim_ai_damage": "near",
	"sim_ai_range": 60.0,
	"sim_ai_steps": 3,
}

var _values := {}
var _profiles := {}                # guid -> the profile of a calibrated wheel
var _config := ConfigFile.new()
var _overrides := {}               # (the tests: --set=key:value,key:value, for this run only, not saved)
var _dir := "user://"


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--user-dir="):
			_dir = a.substr(11)
			DirAccess.make_dir_recursive_absolute(_dir)
	_values = DEFAULTS.duplicate(true)
	if _config.load(path(FILE)) == OK:
		for key in DEFAULTS:
			if _config.has_section_key("settings", key):
				_values[key] = _config.get_value("settings", key)
		_profiles = _config.get_value("wheels", "profiles", {})
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--set="):
			for pair in a.substr(6).split(","):
				var kv := pair.split(":")
				if kv.size() == 2 and DEFAULTS.has(kv[0]):
					var parsed: Variant = str_to_var(kv[1])
					_overrides[kv[0]] = parsed if parsed != null else kv[1]       # (a word is a text: gfx_weather:rain)


## A file of the menus in the user folder (or in the folder of the tests, --user-dir).
func path(file: String) -> String:
	return _dir.path_join(file)


func get_value(key: String) -> Variant:
	if _overrides.has(key):
		return _overrides[key]
	return _values.get(key, DEFAULTS.get(key))


func set_value(key: String, value: Variant) -> void:
	_values[key] = value
	_overrides.erase(key)
	_save()
	changed.emit(key)
	if key not in ["controls", "hud_layout", "panels"]:
		RunLog.event("setting %s = %s" % [key, value])


## The settings back to the defaults (the keys given, or all but the bindings, the tunes and the garage folder).
func reset(keys: Array = []) -> void:
	if keys.is_empty():
		for k in DEFAULTS:
			if k not in ["controls", "tunes", "garage_folder", "hud_layout", "panels", "settings_tab", "keys_shown"]:
				keys.append(k)
	for k in keys:
		_values[k] = DEFAULTS[k].duplicate(true) if DEFAULTS[k] is Dictionary else DEFAULTS[k]
	_save()
	for k in keys:
		changed.emit(k)
	RunLog.event("settings reset: %s" % ", ".join(keys))


## The speed in the units of the settings: [value, "km/h" or "mph"].
func speed_text(ms: float) -> String:
	if str(get_value("units")) == "imperial":
		return "%d mph" % roundi(ms * 2.2369362920544)
	return "%d km/h" % roundi(ms * 3.6)


func profile(guid: String) -> Dictionary:
	return _profiles.get(guid, {})


func profiles() -> Dictionary:
	return _profiles


func set_profile(guid: String, p: Dictionary) -> void:
	_profiles[guid] = p
	_save()
	RunLog.event("wheel profile %s: %s" % [guid, p])


func forget_profile(guid: String) -> void:
	_profiles.erase(guid)
	_save()
	RunLog.event("wheel profile %s forgotten" % guid)


func _save() -> void:
	for key in _values:
		_config.set_value("settings", key, _values[key])
	_config.set_value("wheels", "profiles", _profiles)
	_config.save(path(FILE))
