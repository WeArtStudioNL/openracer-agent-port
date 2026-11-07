extends Node
## The controls: the actions of the game and their keys and gamepad buttons, made here so that they are
## easy to read and to change (a menu to set them comes in a later phase).

const KEYS := {
	"throttle": [KEY_UP, KEY_W],
	"brake": [KEY_DOWN, KEY_S],
	"steer_left": [KEY_LEFT, KEY_A],
	"steer_right": [KEY_RIGHT, KEY_D],
	"handbrake": [KEY_SPACE],
	"shift_up": [KEY_E],
	"shift_down": [KEY_Q],
	"camera": [KEY_C],
	"reset": [KEY_R],
	"restart": [KEY_BACKSPACE],
	"menu": [KEY_ESCAPE],
	"debug": [KEY_F3],
}

const PAD_BUTTONS := {
	"handbrake": [JOY_BUTTON_A],
	"shift_up": [JOY_BUTTON_RIGHT_SHOULDER],
	"shift_down": [JOY_BUTTON_LEFT_SHOULDER],
	"camera": [JOY_BUTTON_Y],
	"reset": [JOY_BUTTON_X],
	"restart": [JOY_BUTTON_BACK],
	"menu": [JOY_BUTTON_START],
}

## [axis, direction]
const PAD_AXES := {
	"throttle": [[JOY_AXIS_TRIGGER_RIGHT, 1.0]],
	"brake": [[JOY_AXIS_TRIGGER_LEFT, 1.0]],
	"steer_left": [[JOY_AXIS_LEFT_X, -1.0]],
	"steer_right": [[JOY_AXIS_LEFT_X, 1.0]],
}


func _ready() -> void:
	for action in KEYS:
		_ensure(action)
		for key in KEYS[action]:
			var e := InputEventKey.new()
			e.physical_keycode = key
			InputMap.action_add_event(action, e)
	for action in PAD_BUTTONS:
		_ensure(action)
		for b in PAD_BUTTONS[action]:
			var e := InputEventJoypadButton.new()
			e.button_index = b
			InputMap.action_add_event(action, e)
	for action in PAD_AXES:
		_ensure(action)
		InputMap.action_set_deadzone(action, 0.05)
		for a in PAD_AXES[action]:
			var e := InputEventJoypadMotion.new()
			e.axis = a[0]
			e.axis_value = a[1]
			InputMap.action_add_event(action, e)


func _ensure(action: String) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action, 0.2)
