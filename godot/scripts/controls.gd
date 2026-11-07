extends Node
## The controls: the actions of the game and what works them. Every action has a list of bindings: a key, a
## button or a stick of a gamepad, or a button of the racing wheel. The defaults are below; what the player set
## (Settings, Controls tab) is kept in Settings ("controls") and replaces the defaults of that action.
##
## A binding is a Dictionary: {"type": "key", "code": physical keycode}, {"type": "pad_button", "button": n},
## {"type": "pad_axis", "axis": n, "dir": 1 or -1}, {"type": "wheel_button", "button": n}.
##
## A racing wheel reports itself as a joypad, and its own numbers mean other things (the left paddle of a PXN is
## the Back button of a gamepad: it put the car back at the start), so the gamepad bindings are made for every
## joypad but the wheel; the buttons of the wheel are bindings of their own (WheelInput presses them).

signal changed

## The actions in the order of the menu, with their names.
const ACTIONS := [
	["throttle", "Throttle"], ["brake", "Brake"], ["steer_left", "Steer left"], ["steer_right", "Steer right"],
	["handbrake", "Handbrake"],
	["two_step", "Two-step (hold)"], ["transbrake", "Transbrake (hold, let go to launch)"],
	["shift_up", "Shift up"], ["shift_down", "Shift down"], ["camera", "Camera"],
	["reset", "Back on the wheels (reset)"], ["restart", "Back to the start"], ["menu", "Pause"],
	["tuning", "Tuning menu"], ["calibrate", "Calibrate the wheel"], ["mark", "Mark in the log"], ["debug", "Tyre data"],
]

const KEYS := {
	"throttle": [KEY_UP, KEY_W],
	"brake": [KEY_DOWN, KEY_S],
	"steer_left": [KEY_LEFT, KEY_A],
	"steer_right": [KEY_RIGHT, KEY_D],
	"handbrake": [KEY_SPACE],
	"two_step": [KEY_X],
	"transbrake": [KEY_F],
	"shift_up": [KEY_E],
	"shift_down": [KEY_Q],
	"camera": [KEY_C],
	"reset": [KEY_R],
	"restart": [KEY_BACKSPACE],
	"menu": [KEY_ESCAPE],
	"tuning": [KEY_U],
	"calibrate": [KEY_K],
	"mark": [KEY_F8],
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

const PAD_BUTTON_NAMES := {
	JOY_BUTTON_A: "A", JOY_BUTTON_B: "B", JOY_BUTTON_X: "X", JOY_BUTTON_Y: "Y", JOY_BUTTON_BACK: "Back",
	JOY_BUTTON_GUIDE: "Guide", JOY_BUTTON_START: "Start", JOY_BUTTON_LEFT_STICK: "Left stick press",
	JOY_BUTTON_RIGHT_STICK: "Right stick press", JOY_BUTTON_LEFT_SHOULDER: "LB", JOY_BUTTON_RIGHT_SHOULDER: "RB",
	JOY_BUTTON_DPAD_UP: "D-pad up", JOY_BUTTON_DPAD_DOWN: "D-pad down", JOY_BUTTON_DPAD_LEFT: "D-pad left",
	JOY_BUTTON_DPAD_RIGHT: "D-pad right",
}
const PAD_AXIS_NAMES := {
	JOY_AXIS_LEFT_X: ["Left stick left", "Left stick right"], JOY_AXIS_LEFT_Y: ["Left stick up", "Left stick down"],
	JOY_AXIS_RIGHT_X: ["Right stick left", "Right stick right"], JOY_AXIS_RIGHT_Y: ["Right stick up", "Right stick down"],
	JOY_AXIS_TRIGGER_LEFT: ["LT", "LT"], JOY_AXIS_TRIGGER_RIGHT: ["RT", "RT"],
}

var _wheel := -1                   # the joypad that is the racing wheel (no gamepad bindings)
var _bindings := {}                # action -> Array of bindings


func _ready() -> void:
	for a in ACTIONS:
		if not InputMap.has_action(a[0]):
			InputMap.add_action(a[0], 0.2)
	for action in PAD_AXES:
		InputMap.action_set_deadzone(action, 0.05)
	_bindings = defaults()
	var saved: Variant = Settings.get_value("controls")
	if saved is Dictionary:
		for action in saved:
			if _bindings.has(action):
				_bindings[action] = saved[action]
	Input.joy_connection_changed.connect(func(_d: int, _c: bool): rebind())
	rebind()


## The bindings as the game comes.
static func defaults() -> Dictionary:
	var out := {}
	for a in ACTIONS:
		var list := []
		for k in KEYS.get(a[0], []):
			list.append({"type": "key", "code": k})
		for b in PAD_BUTTONS.get(a[0], []):
			list.append({"type": "pad_button", "button": b})
		for ax in PAD_AXES.get(a[0], []):
			list.append({"type": "pad_axis", "axis": ax[0], "dir": ax[1]})
		out[a[0]] = list
	return out


func bindings(action: String) -> Array:
	return _bindings.get(action, [])


## Sets the binding at index (one past the end: adds one). The same input is taken from any other action that had it.
func set_binding(action: String, index: int, b: Dictionary) -> void:
	for other in _bindings:
		var list: Array = _bindings[other]
		for i in range(list.size() - 1, -1, -1):
			if _same(list[i], b) and not (other == action and i == index):
				list.remove_at(i)
				if other == action and i < index:
					index -= 1
	var mine: Array = _bindings[action]
	if index >= mine.size():
		mine.append(b)
	else:
		mine[index] = b
	_save()


func clear_binding(action: String, index: int) -> void:
	var mine: Array = _bindings[action]
	if index < mine.size():
		mine.remove_at(index)
		_save()


func reset_defaults() -> void:
	_bindings = defaults()
	_save()


func _save() -> void:
	Settings.set_value("controls", _bindings.duplicate(true))
	rebind()
	changed.emit()


static func _same(a: Dictionary, b: Dictionary) -> bool:
	if a.get("type") != b.get("type"):
		return false
	match str(a.get("type")):
		"key":
			return int(a["code"]) == int(b["code"])
		"pad_button", "wheel_button":
			return int(a["button"]) == int(b["button"])
		"pad_axis":
			return int(a["axis"]) == int(b["axis"]) and signf(float(a["dir"])) == signf(float(b["dir"]))
	return false


## Makes the InputMap from the bindings: the keys, the gamepad bindings for every joypad but the wheel, and the
## buttons of the wheel for WheelInput.
func rebind(wheel_device := -2) -> void:
	if wheel_device == -2:
		wheel_device = _wheel
	_wheel = wheel_device
	var wheel_buttons := {}
	for a in ACTIONS:
		var action: String = a[0]
		InputMap.action_erase_events(action)
		for b: Dictionary in _bindings.get(action, []):
			match str(b.get("type")):
				"key":
					var e := InputEventKey.new()
					e.physical_keycode = int(b["code"]) as Key
					InputMap.action_add_event(action, e)
				"pad_button":
					for d in Input.get_connected_joypads():
						if d != _wheel:
							var e := InputEventJoypadButton.new()
							e.device = d
							e.button_index = int(b["button"]) as JoyButton
							InputMap.action_add_event(action, e)
				"pad_axis":
					for d in Input.get_connected_joypads():
						if d != _wheel:
							var e := InputEventJoypadMotion.new()
							e.device = d
							e.axis = int(b["axis"]) as JoyAxis
							e.axis_value = float(b["dir"])
							InputMap.action_add_event(action, e)
				"wheel_button":
					wheel_buttons[int(b["button"])] = action
	var wi := get_node_or_null("/root/WheelInput")
	if wi != null:
		wi.button_actions = wheel_buttons


## The name of a binding, for the menu.
static func describe(b: Dictionary) -> String:
	match str(b.get("type")):
		"key":
			return OS.get_keycode_string(int(b["code"]))
		"pad_button":
			return "Pad " + str(PAD_BUTTON_NAMES.get(int(b["button"]), "button %d" % int(b["button"])))
		"pad_axis":
			var names: Array = PAD_AXIS_NAMES.get(int(b["axis"]), ["axis %d -" % int(b["axis"]), "axis %d +" % int(b["axis"])])
			return "Pad " + str(names[0] if float(b["dir"]) < 0.0 else names[1])
		"wheel_button":
			return "Wheel button %d" % int(b["button"])
	return "?"


## The binding of an input event, for the menu that waits for one (null: not one that can be bound).
func binding_of(event: InputEvent) -> Variant:
	if event is InputEventKey and event.pressed and not event.echo:
		var code: int = event.physical_keycode if event.physical_keycode != 0 else event.keycode
		return {"type": "key", "code": code}
	if event is InputEventJoypadButton and event.pressed:
		if event.device == _wheel:
			return {"type": "wheel_button", "button": event.button_index}
		return {"type": "pad_button", "button": event.button_index}
	if event is InputEventJoypadMotion and event.device != _wheel and absf(event.axis_value) > 0.6:
		return {"type": "pad_axis", "axis": event.axis, "dir": signf(event.axis_value)}
	return null
