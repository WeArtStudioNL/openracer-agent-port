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

## The actions in the order of the menu (the groups of web/js/Settings.js), with their names. An action with "wheel" is
## set up by the calibration of the racing wheel (WheelInput), not by a binding.
const ACTIONS := [
	["throttle", "Throttle", "Driving"], ["brake", "Brake", "Driving"],
	["steer_left", "Steer left", "Driving"], ["steer_right", "Steer right", "Driving"],
	["steer_wheel", "Steering wheel", "Driving", "wheel"], ["clutch", "Clutch", "Driving", "wheel"],
	["handbrake", "Handbrake", "Driving"],
	["parking_brake", "Parking brake on/off (it stays on until you press it again; P is for the free camera too: then that goes first)", "Driving"],
	["reverse", "Reverse (hold)", "Driving"],
	["rider_back", "Motorcycle: rider back (hold)", "Driving"], ["rider_forward", "Motorcycle: rider forward (hold)", "Driving"],
	["ragdoll", "Motorcycle: the rider goes limp (a crash, to try it)", "Driving"],
	["two_step", "Two-step: hold the engine at the two-step speed at a standstill (hold)", "Driving"],
	["transbrake", "Transbrake: hold the car with the engine free, let go to launch (hold)", "Driving"],
	["shift_up", "Shift up", "Gearbox"], ["shift_down", "Shift down", "Gearbox"],
	["gear1", "H-shifter: gear 1", "Gearbox"], ["gear2", "H-shifter: gear 2", "Gearbox"], ["gear3", "H-shifter: gear 3", "Gearbox"],
	["gear4", "H-shifter: gear 4", "Gearbox"], ["gear5", "H-shifter: gear 5", "Gearbox"], ["gear6", "H-shifter: gear 6", "Gearbox"],
	["gear7", "H-shifter: gear 7", "Gearbox"], ["gear8", "H-shifter: gear 8", "Gearbox"], ["reverse_gear", "H-shifter: reverse", "Gearbox"],
	["reset", "Reset the car to the nearest point of the racing line, nose forward (a track without one: the saved place), as it is", "Other"],
	["save_reset_position", "Save the place of the car for the reset (a track without a racing line)", "Other"],
	["repair", "Repair the car and put it on its wheels where it is (in a race: the lap is no record)", "Other"],
	["restart", "Back to the start (repaired)", "Other"],
	["camera_left", "Camera left", "Other"], ["camera_right", "Camera right", "Other"], ["camera_reset", "Camera behind the car", "Other"],
	["hud_toggle", "HUD on/off", "Other"], ["debug", "Debug text on/off", "Other"],
	["photo", "Photo: save the picture of the game as a PNG (no HUD)", "Other"],
	["camera", "Switch camera (follow, cockpit, bonnet)", "Other"],
	["toggle_esc", "ESC (stability control) on/off", "Other"], ["tuning", "Tuning menu on/off", "Other"],
	["toggle_tc", "Traction control on/off", "Other"], ["toggle_two_step", "Two-step on/off", "Other"],
	["toggle_launch", "Launch control on/off", "Other"], ["toggle_abs", "ABS on/off", "Other"],
	["start_engine", "Start the engine", "Other"], ["telemetry", "Telemetry", "Other"], ["mute", "Engine sound on/off", "Other"],
	["calibrate", "Calibrate the wheel", "Other"], ["wheel_toggle", "Wheel on/off", "Other"],
	["debug_view", "Debug view: what the physics sees", "Other"], ["debug_models", "Debug view: hide the car", "Other"],
	["free_cam", "Free camera on/off (off: back to the camera you had)", "Other"],
	["free_cam_aim", "Free camera: look at the car or not", "Other"],
	["free_cam_follow", "Free camera: move with the car or stay here", "Other"],
	["take", "Take: start a recording, and stop it (then: save it as a replay or a video)", "Other"],
	["menu", "Pause", "Other"], ["mark", "Mark in the log", "Other"],
]

## The keys of the browser game (Settings.js), and Esc for the pause, F8 for a mark in the log, Home back to the start.
const KEYS := {
	"throttle": [KEY_UP],
	"brake": [KEY_DOWN],
	"steer_left": [KEY_LEFT],
	"steer_right": [KEY_RIGHT],
	"handbrake": [KEY_SPACE],
	"parking_brake": [KEY_P],
	"reverse": [KEY_PERIOD],
	"rider_back": [KEY_COMMA],
	"rider_forward": [KEY_PERIOD],
	"ragdoll": [KEY_9],
	"two_step": [KEY_Q],
	"transbrake": [KEY_F],
	"shift_up": [KEY_X],
	"shift_down": [KEY_Z],
	"reset": [KEY_R],
	"save_reset_position": [KEY_4],
	"repair": [KEY_BACKSPACE],
	"restart": [KEY_HOME],
	"camera_left": [KEY_BRACKETLEFT],
	"camera_right": [KEY_BRACKETRIGHT],
	"camera_reset": [KEY_QUOTELEFT],
	"hud_toggle": [KEY_H],
	"debug": [KEY_F3],
	"photo": [KEY_F2],
	"camera": [KEY_T],
	"toggle_esc": [KEY_N],
	"tuning": [KEY_U],
	"toggle_tc": [KEY_C],
	"toggle_two_step": [KEY_Y],
	"toggle_launch": [KEY_J],
	"toggle_abs": [KEY_B],
	"start_engine": [KEY_I],
	"telemetry": [KEY_V],
	"mute": [KEY_E],
	"calibrate": [KEY_K],
	"wheel_toggle": [KEY_M],
	"debug_view": [KEY_0, KEY_KP_0],
	"debug_models": [KEY_MINUS, KEY_KP_SUBTRACT],
	"free_cam": [KEY_BACKSLASH],
	"free_cam_aim": [KEY_P],
	"free_cam_follow": [KEY_O],
	"take": [KEY_5],
	"menu": [KEY_ESCAPE],
	"mark": [KEY_F8],
}

## The inputs that an action shares with another by default (Settings.js: P is the parking brake and, while the free
## camera is on, its aim; the free camera goes first).
const SHARES := {"free_cam_aim": ["parking_brake"]}

const PAD_BUTTONS := {
	"handbrake": [JOY_BUTTON_A],
	"shift_up": [JOY_BUTTON_RIGHT_SHOULDER],
	"shift_down": [JOY_BUTTON_LEFT_SHOULDER],
	"camera": [JOY_BUTTON_X],
	"reset": [JOY_BUTTON_Y],
	"repair": [JOY_BUTTON_BACK],
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
	if saved is Dictionary and not saved.is_empty():
		for action in saved:
			if _bindings.has(action):
				_bindings[action] = saved[action]
		# an action that came later (the player saved before it was there) gets its defaults, but not an input that a
		# saved action has (the player put the camera on T: T stays the camera's)
		for a in ACTIONS:
			if saved.has(a[0]):
				continue
			var kept := []
			for b: Dictionary in _bindings[a[0]]:
				var taken := false
				for other in saved:
					if other in SHARES.get(a[0], []):
						continue
					for o: Dictionary in saved[other]:
						taken = taken or _same(o, b)
				if not taken:
					kept.append(b)
			_bindings[a[0]] = kept
	_drop_wasd()
	Input.joy_connection_changed.connect(func(_d: int, _c: bool): rebind())
	# the menus with a gamepad (PadNav.js): A chooses, B goes back, in every menu from the start
	SettingsMenu.pad_ui()
	rebind()


## Once: W A S D no longer drive the car (the arrows do), also when they were saved with the controls of the player.
func _drop_wasd() -> void:
	if Settings.get_value("wasd_dropped"):
		return
	var old := {"throttle": KEY_W, "brake": KEY_S, "steer_left": KEY_A, "steer_right": KEY_D}
	var saved: Variant = Settings.get_value("controls")
	for action: String in old:
		_bindings[action] = (_bindings[action] as Array).filter(func(b: Dictionary) -> bool: return not (b.get("type") == "key" and int(b.get("code", 0)) == int(old[action])))
		if saved is Dictionary and saved.has(action):
			saved[action] = _bindings[action]
	if saved is Dictionary and not saved.is_empty():
		Settings.set_value("controls", saved)
	Settings.set_value("wasd_dropped", true)


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


## The name of an action, for the menu and the notes.
static func label(action: String) -> String:
	for a in ACTIONS:
		if a[0] == action:
			return a[1]
	return action


## The first key of an action ("" when it has none), for the notes ("Traction control off (C)").
func key_name(action: String) -> String:
	for b: Dictionary in bindings(action):
		if b.get("type") == "key":
			return describe(b)
	return ""


## True while a key of the action is held (the easing of the keys: a gamepad trigger is analog of its own).
func key_held(action: String) -> bool:
	for b: Dictionary in bindings(action):
		if b.get("type") == "key" and Input.is_physical_key_pressed(int(b["code"]) as Key):
			return true
	return false


## Sets the binding at index (one past the end: adds one). The same input is taken from any other action that had it.
func set_binding(action: String, index: int, b: Dictionary) -> String:
	var taken := PackedStringArray()
	for other in _bindings:
		var list: Array = _bindings[other]
		for i in range(list.size() - 1, -1, -1):
			if _same(list[i], b) and not (other == action and i == index):
				list.remove_at(i)
				if other != action:
					taken.append(label(other))
				if other == action and i < index:
					index -= 1
	var mine: Array = _bindings[action]
	if index >= mine.size():
		mine.append(b)
	else:
		mine[index] = b
	_save()
	return " and ".join(taken)


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
