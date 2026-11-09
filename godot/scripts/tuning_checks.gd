class_name TuningChecks
extends RefCounted
## What is wrong with the numbers of a car, for whoever tunes it: a setup that will bottom out, a gearbox that cannot shift. It only warns (a car may be
## extreme on purpose); where the cure is one number, a warning brings it. Used by the tuning menu and the car editor.
##
## all(cfg) -> Array of { id, text, keys (the rows of Tuning that it is about), short (for under such a row), fix { path: value }, fix_text }

const CORNERS := ["FL", "FR", "RL", "RR"]
const HEAVY_WHEELS := 0.25         # share of the mass of the car on its four wheels
const SPRING_LEAST := 0.75         # g: what a spring has to carry above the car standing, before the stop (less: a ramp or a landing bottoms out)
const SPRING_WANTED := 1.0        # g: what the cure gives
const TRACK_APART := 1.3           # the wider track over the narrower: more is a wheel that is not where it should be


static func _n(cfg: Dictionary, path: String, default: float) -> float:
	var v: Variant = Tuning.read(cfg, path)
	return float(v) if v is float or v is int else default


static func all(cfg: Dictionary) -> Array:
	var out := []
	var bike := str(cfg.get("type", "")) == "motorcycle"
	var no_springs := bool(Tuning.read(cfg, "chassis.unsprung")) if Tuning.read(cfg, "chassis.unsprung") != null else false
	if not bike and not no_springs:
		_suspension(cfg, out)
		_track(cfg, out)
	_wheel_parts(cfg, out)
	_rims(cfg, out)
	_shifting(cfg, out)
	if not bike:
		_wheelie(cfg, out)
	return out


static func _suspension(cfg: Dictionary, out: Array) -> void:
	var mass := _n(cfg, "chassis.mass", 1200.0)
	var length := _n(cfg, "chassis.suspension_length", 0.28)
	var asked := _n(cfg, "chassis.suspension_travel", 0.09)
	var travel := minf(asked, maxf(0.05, length - 0.05))
	if asked > travel + 0.005:
		var want := snappedf(asked + 0.05, 0.01)
		out.append({"id": "travel_room", "keys": ["suspension_travel", "suspension_length"],
			"text": "Suspension travel is set to %d cm but the spring only has room for %d cm: the car reaches its bump stops early." % [roundi(asked * 100.0), roundi(travel * 100.0)],
			"short": "only %d cm of it can be used" % roundi(travel * 100.0),
			"fix": {"chassis.suspension_length": want}, "fix_text": "Room for the travel: %d cm" % roundi(want * 100.0)})
	var light := mass / 1230.0 if mass < 600.0 else 1.0
	var wheel := _n(cfg, "chassis.unsprung_mass", maxf(2.0, 0.0285 * mass) if light < 1.0 else 35.0)
	var progression := _n(cfg, "chassis.spring_progression", 0.0)
	var front_share := _n(cfg, "chassis.weight_distribution", 0.5)
	for rear in [false, true]:
		var key: String = "spring_rear" if rear else "spring_front"
		var spring := _n(cfg, "chassis." + key, 30000.0)
		var share: float = 1.0 - front_share if rear else front_share
		var body := maxf(0.0, mass * share / 2.0 - wheel) * Car.G
		var room := travel + _n(cfg, "chassis.ride_rear" if rear else "chassis.ride_front", 0.0)
		if room <= 0.0 or spring <= 0.0 or body <= 0.0:
			continue
		var carries := 1.0 + progression * room / maxf(0.01, travel)
		if spring * room * carries < SPRING_LEAST * body:
			var need := ceilf(SPRING_WANTED * body / (room * carries) / 500.0) * 500.0
			out.append({"id": key + "_soft", "keys": [key],
				"text": "The %s springs are too soft for the room they have: the body sinks %d cm per g and there are %d cm before the bump stop, so a ramp or a landing bottoms out." % [
					"rear" if rear else "front", roundi(body / spring * 100.0), roundi(room * 100.0)],
				"short": "bottoms out on a ramp or a landing",
				"fix": {"chassis." + key: need}, "fix_text": "%s springs: %d N/mm" % ["Rear" if rear else "Front", roundi(need / 1000.0)]})
	if 4.0 * wheel > HEAVY_WHEELS * mass:
		var lighter := snappedf(0.15 * mass / 4.0, 1.0)
		out.append({"id": "heavy_wheels", "keys": [],
			"text": "The four wheels weigh %d kg, %d %% of the car: the springs carry little and the wheels hop." % [roundi(4.0 * wheel), roundi(400.0 * wheel / mass)],
			"short": "", "fix": {"chassis.unsprung_mass": lighter}, "fix_text": "Unsprung mass: %d kg per wheel" % roundi(lighter)})


static func _track(cfg: Dictionary, out: Array) -> void:
	var front := _n(cfg, "chassis.front_track", 0.0)
	var rear := _n(cfg, "chassis.rear_track", 0.0)
	if front > 0.1 and rear > 0.1 and maxf(front, rear) > TRACK_APART * minf(front, rear):
		out.append({"id": "track_apart", "keys": [],
			"text": "The track is %.2f m at the front and %.2f m at the rear: a wheel is probably measured wrong (look at the parts of the wheels)." % [front, rear],
			"short": "", "fix": {}, "fix_text": ""})


## A rim much narrower than its tyre: the bead has nothing to sit on.
static func _rims(cfg: Dictionary, out: Array) -> void:
	for axle in ["front", "rear"]:
		var width := _n(cfg, "wheels.library.%s.custom.width" % axle, 0.0)
		var offset := _n(cfg, "wheels.library.%s.custom.rim_offset" % axle, 0.0) / 1000.0
		if width > 0.0 and width + 2.0 * offset < 0.6 * width:
			out.append({"id": "narrow_rim_" + axle, "keys": ["tyre_rim_offset_" + axle],
				"text": "The %s rim is %d mm wide on a tyre of %d mm: a rim that narrow leaves the tyre with nothing to sit on." % [axle, roundi((width + 2.0 * offset) * 1000.0), roundi(width * 1000.0)],
				"short": "narrow for this tyre", "fix": {"wheels.library.%s.custom.rim_offset" % axle: 0.0}, "fix_text": "Rim as wide as the tyre"})


## Parts in the list of a wheel without its corner in their name, beside parts that have it: spare tyres of the model that were taken for that wheel.
static func _wheel_parts(cfg: Dictionary, out: Array) -> void:
	var nodes: Variant = Tuning.read(cfg, "wheels.nodes")
	if not nodes is Dictionary:
		return
	var cleaned: Dictionary = (nodes as Dictionary).duplicate(true)
	var strays := []
	for slot in CORNERS:
		var parts: Variant = cleaned.get(slot)
		if not parts is Array:
			continue
		var keep := []
		var loose := []
		for p in parts:
			if SuspensionRig.stem(str(p)).right(2) == str(slot).to_lower():
				keep.append(p)
			else:
				loose.append(p)
		if not keep.is_empty() and not loose.is_empty():
			cleaned[slot] = keep
			strays.append("%s: %s" % [slot, ", ".join(loose)])
	if not strays.is_empty():
		out.append({"id": "wheel_parts", "keys": [],
			"text": "Parts that do not belong to the wheel are in its list (%s): that wheel turns about the wrong point." % "; ".join(strays),
			"short": "", "fix": {"wheels.nodes": cleaned}, "fix_text": "Take them out"})


static func _peak_torque_rpm(cfg: Dictionary) -> float:
	var curve: Variant = Tuning.read(cfg, "engine.torque_curve")
	if not curve is Array:
		return 0.0
	var best := -1.0
	var at := 0.0
	for p in curve:
		var rpm := float(p[0]) if p is Array else float(p.get("rpm", 0))
		var nm := float(p[1]) if p is Array else float(p.get("nm", 0))
		if nm > best:
			best = nm
			at = rpm
	return at


static func _peak_torque(cfg: Dictionary) -> float:
	var curve: Variant = Tuning.read(cfg, "engine.torque_curve")
	var best := 0.0
	if curve is Array:
		for p in curve:
			best = maxf(best, float(p[1]) if p is Array else float(p.get("nm", 0)))
	return best * _n(cfg, "engine.power_scale", 1.0)


## (the automatic shifts up at 1.25 times the peak of the torque at the least: CarDrivetrain._automatic)
static func _shifting(cfg: Dictionary, out: Array) -> void:
	var box := str(Tuning.read(cfg, "drivetrain.gearbox"))
	if box == "manual" or box == "cvt":
		return
	var limit := _n(cfg, "engine.limiter_rpm", 6500.0)
	var peak := _peak_torque_rpm(cfg)
	if peak * 1.25 > limit and peak > 0.0:
		out.append({"id": "no_upshift", "keys": ["limiter_rpm"],
			"text": "The torque peaks at %d rpm with the limiter at %d rpm: the automatic shifts up at 1.25 times the peak and does not get there, so the car stays on its limiter." % [roundi(peak), roundi(limit)],
			"short": "the automatic cannot shift up", "fix": {}, "fix_text": ""})


static func _wheelie(cfg: Dictionary, out: Array) -> void:
	var dt: Variant = cfg.get("drivetrain", {})
	if not dt is Dictionary or str((dt as Dictionary).get("drive", "rwd")).to_lower() == "fwd":
		return
	var gears: Variant = dt.get("gear_ratios", [])
	var diameter := _n(cfg, "chassis.tire_diameter", 0.0)
	var cg := _n(cfg, "chassis.cg_height", 0.0)
	var mass := _n(cfg, "chassis.mass", 0.0)
	var torque := _peak_torque(cfg)
	if not gears is Array or (gears as Array).is_empty() or diameter <= 0.0 or cg <= 0.0 or mass <= 0.0 or torque <= 0.0:
		return
	var limit := _n(cfg, "chassis.wheelbase", 2.5) * _n(cfg, "chassis.weight_distribution", 0.5) / cg
	var thrust := torque * float(dt.get("efficiency", 0.9)) * float(gears[0]) * float(dt.get("final_drive", 1.0)) / (diameter / 2.0) / (mass * Car.G)
	# (the weight moves back on the springs and the wheels pull on the frame as well: a car goes up a good way before the sum says so; the kart of 100 kg at 1.56 of 2.11 g did)
	if thrust > 0.7 * limit:
		out.append({"id": "wheelie", "keys": ["mass"],
			"text": "On full throttle in first gear the thrust is %.2f g and the front comes up from about %.2f g: the car can stand on its rear wheels." % [thrust, 0.7 * limit],
			"short": "", "fix": {}, "fix_text": ""})


## The warnings in a box: a line each, with its button where one number cures it. (Drawn again only when they change: a slider moves on.)
static func show_in(box: Container, list: Array, colour: Color, on_fix: Callable, make_button: Callable) -> void:
	var shown := JSON.stringify(list.map(func(e): return [e["text"], e["fix_text"]]))
	if str(box.get_meta("shown", "")) == shown:
		return
	box.set_meta("shown", shown)
	for child in box.get_children():
		box.remove_child(child)
		child.queue_free()
	box.visible = not list.is_empty()
	for e: Dictionary in list:
		var line := HBoxContainer.new()
		var label := Label.new()
		label.text = "⚠ " + str(e["text"])
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		label.add_theme_font_size_override("font_size", 12)
		label.add_theme_color_override("font_color", colour)
		line.add_child(label)
		if not (e["fix"] as Dictionary).is_empty():
			var b: Button = make_button.call(str(e["fix_text"]))
			b.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
			b.pressed.connect(func(): on_fix.call(e))
			line.add_child(b)
		box.add_child(line)


## The short word of a warning under the row it is about.
static func note(item: Control, text: String, colour: Color) -> void:
	var label := item.get_node_or_null("CheckNote") as Label
	if label == null:
		if text == "":
			return
		label = Label.new()
		label.name = "CheckNote"
		label.add_theme_font_size_override("font_size", 11)
		label.add_theme_color_override("font_color", colour)
		item.add_child(label)
	label.text = "⚠ " + text if text != "" else ""
	label.visible = text != ""


## key of a row -> the short word of the first warning about it.
static func notes_of(list: Array) -> Dictionary:
	var out := {}
	for e: Dictionary in list:
		for k in e["keys"]:
			if not out.has(k) and str(e["short"]) != "":
				out[k] = str(e["short"])
	return out
