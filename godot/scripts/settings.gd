extends Node
## The settings of the player, kept in user://settings.cfg: the sound, the driving aids, the keyboard, the racing
## wheel and its force feedback (the defaults are those of web/js/Settings.js), and the profiles of the wheels
## that were calibrated (per device, see WheelInput).

signal changed(key: String)

const PATH := "user://settings.cfg"

const DEFAULTS := {
	"volume": 0.8,                # the engine
	"tyre_volume": 0.8,
	"abs": true,
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
	"controls": {},               # the bindings that the player set (Controls)
}

var _values := {}
var _profiles := {}                # guid -> the profile of a calibrated wheel
var _config := ConfigFile.new()


func _ready() -> void:
	_values = DEFAULTS.duplicate()
	if _config.load(PATH) == OK:
		for key in DEFAULTS:
			if _config.has_section_key("settings", key):
				_values[key] = _config.get_value("settings", key)
		_profiles = _config.get_value("wheels", "profiles", {})


func get_value(key: String) -> Variant:
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
