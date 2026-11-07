extends Node
## The settings of the player, kept in user://settings.cfg: the sound, the driving aids, the keyboard, the racing
## wheel and its force feedback (the defaults are those of web/js/Settings.js), and the profiles of the wheels
## that were calibrated (per device, see WheelInput).

signal changed(key: String)

const PATH := "user://settings.cfg"

const DEFAULTS := {
	"garage_folder": "",                 # a folder of the player's own cars and tracks (Garage), "" for none
	"volume": 0.8,                # the engine
	"tyre_volume": 0.8,
	"abs": true,
	"tc": true,                   # traction control (when the car has it)
	"esc": true,                  # stability control (when the car has it)
	"launch_control": false,      # brake and full throttle at a standstill hold the engine; the brake let go: a launch
	"tyre_wear": 0.0,             # tyre temperature and wear: 0 off (the tyres at their best), else how fast they wear
	"damage": true,               # the cars dent and lose parts (the soft body); off: rigid bodies, as main.js &damage=0
	"auto_reverse": true,         # holding the brake at a standstill puts the car in reverse
	"key_steer_speed": 1.0,       # how fast the keys turn the wheels (a factor)
	"key_steer_at_speed": 1.0,    # how much less the keys steer at speed (a factor: 0 none, 1 as the browser game)
	"camera": 0,                  # the camera at the start: 0 behind, 1 cockpit, 2 bonnet
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
	"controls": {},
	"tunes": {},                  # car -> the tune in use (its file)               # the bindings that the player set (Controls)
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
	# the atmosphere (Atmosphere): the hour, where the sun is at noon, the phase of the moon, the weather
	"gfx_time": 14.0,
	"gfx_sun_azimuth": 40.0,
	"gfx_moon": 1.0,
	"gfx_weather": "clear",       # clear, cloudy, fog, rain, snow
	# the mirrors of the car (CarMirrors, Mirrors.js): the turn and the tilt of each glass (degrees), and a real mirror
	"mirror_left_yaw": 0.0, "mirror_left_tilt": 0.0, "mirror_left_real": true,
	"mirror_right_yaw": 0.0, "mirror_right_tilt": 0.0, "mirror_right_real": true,
	"mirror_centre_yaw": 0.0, "mirror_centre_tilt": 0.0, "mirror_centre_real": true,
}

var _values := {}
var _profiles := {}                # guid -> the profile of a calibrated wheel
var _config := ConfigFile.new()
var _overrides := {}               # (the tests: --set=key:value,key:value, for this run only, not saved)


func _ready() -> void:
	_values = DEFAULTS.duplicate()
	if _config.load(PATH) == OK:
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


func get_value(key: String) -> Variant:
	if _overrides.has(key):
		return _overrides[key]
	return _values.get(key, DEFAULTS.get(key))


func set_value(key: String, value: Variant) -> void:
	_values[key] = value
	_save()
	changed.emit(key)
	RunLog.event("setting %s = %s" % [key, value if key != "controls" else "(the bindings)"])


func profile(guid: String) -> Dictionary:
	return _profiles.get(guid, {})


func set_profile(guid: String, p: Dictionary) -> void:
	_profiles[guid] = p
	_save()
	RunLog.event("wheel profile %s: %s" % [guid, p])


func _save() -> void:
	for key in _values:
		_config.set_value("settings", key, _values[key])
	_config.set_value("wheels", "profiles", _profiles)
	_config.save(PATH)
