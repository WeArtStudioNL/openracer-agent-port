class_name HudGauge
extends Control
## The round gauge of the HUD (web/js/Hud.js drawGauge): the ring of the engine speed with the red zone at the rev
## limit and the shift light, the ticks and the thousands, the speed and its unit, the gear (R orange, N green, red
## when the engine is off), the coolant temperature as an arc on the right with its icon and the oil lamp on the left
## (lit only when the oil is nearly gone), and the badges of the systems (TC, ESC, ABS on an arc along the bottom,
## launch control and the two-step under the gear, P and TB as text lights). A click on a badge switches that aid,
## as its key does. With boost = true it is the boost gauge (Hud.js drawBoost) instead.

const COOLANT_RANGE := [40.0, 140.0]
const COOLANT_BANDS := [70.0, 105.0, 118.0]
const BADGE_FILE := {"TC": "tc", "LC": "launch", "ESC": "esc", "ABS": "abs", "2S": "2step"}
const LIGHT_ACTION := {"TC": ["tc", "Traction control", "toggle_tc"], "LC": ["launch_control", "Launch control", "toggle_launch"],
	"ESC": ["esc", "Stability control (ESC)", "toggle_esc"], "ABS": ["abs", "ABS", "toggle_abs"], "2S": ["two_step", "Two-step", "toggle_two_step"]}
## [border, fill, text] of a text light in its state
const LIGHT_STYLE := {"off": [Color("#d9372f"), Color(0.08, 0.09, 0.12, 0.6), Color("#ff6b62")],
	"on": [Color("#2eb35a"), Color(0.08, 0.09, 0.12, 0.6), Color("#52e085")],
	"active": [Color("#f5c518"), Color(0.96, 0.77, 0.09, 0.9), Color("#1a1500")],
	"park": [Color("#d9372f"), Color(0.85, 0.22, 0.18, 0.85), Color.WHITE]}

static var _images := {}            # file -> Texture2D (null: not there)

var hud: Node                       # the Hud: its car, world and the states of the lights
var boost := false
var states := {}                    # light -> off, on, active, park (null: the car has no such system)
var _rects: Array = []              # [Rect2, light] of the badges, for a click
var _font: Font
var _peak := 0.0
var _peak_time := 0.0


func _ready() -> void:
	_font = get_theme_default_font()
	mouse_filter = Control.MOUSE_FILTER_PASS


static func image(file: String) -> Texture2D:
	if _images.has(file):
		return _images[file]
	var tex: Texture2D = null
	var p := Content.root.path_join("images/HUD/%s.png" % file)
	if FileAccess.file_exists(p):
		var img := Image.load_from_file(p)
		if img != null:
			tex = ImageTexture.create_from_image(img)
	_images[file] = tex
	return tex


func _gui_input(event: InputEvent) -> void:
	var press: bool = (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT) \
		or (event is InputEventScreenTouch and event.pressed)
	if not press:
		return
	for r in _rects:
		var rect: Rect2 = r[0]
		if rect.grow(rect.size.x * 0.15).has_point(event.position) and LIGHT_ACTION.has(r[1]):
			var a: Array = LIGHT_ACTION[r[1]]
			if hud.world != null and hud.world.has_method("_aid"):
				hud.world.call("_aid", a[0], a[1], a[2])
			accept_event()
			return


func _process(_delta: float) -> void:
	queue_redraw()


func _angle(fraction: float) -> float:
	return deg_to_rad(135.0 + 270.0 * fraction)


func _ring(c: Vector2, r: float, from: float, to: float, w: float, col: Color) -> void:
	if absf(to - from) < 0.001:
		return
	draw_arc(c, r, from, to, maxi(8, int(absf(to - from) * 30.0)), col, w, true)


func _text(t: String, at: Vector2, size: int, col: Color) -> void:
	if size < 1:
		return                        # (before the gauge has its size: a font of size 0 is an error of the text server)
	var w := _font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var asc := _font.get_ascent(size)
	var desc := _font.get_descent(size)
	draw_string(_font, at + Vector2(-w / 2.0, (asc - desc) / 2.0), t, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)


func _face(c: Vector2, r: float) -> void:
	draw_circle(c, r, Color(0.07, 0.08, 0.1, 0.86))
	draw_circle(c, r * 0.8, Color(0.11, 0.13, 0.16, 0.5))
	draw_arc(c, r - 1.0, 0.0, TAU, 64, Color(1, 1, 1, 0.22), 2.0, true)


func _draw() -> void:
	var car: Car = hud.car
	if car == null:
		return
	if boost:
		_draw_boost(car)
	else:
		_draw_gauge(car)


func _draw_gauge(car: Car) -> void:
	var s := size.x
	var c := Vector2(s, s) / 2.0
	var r := s / 2.0 - 3.0
	var limit := maxf(1000.0, car.engine.limiter_rpm)
	var rpm_now := car.engine.rpm()
	var fraction := clampf(rpm_now / limit, 0.0, 1.0)
	var flash := int(Time.get_ticks_msec() / 90) % 2 == 0
	_face(c, r)
	var ring := r * 0.83
	var ring_w := r * 0.13
	_ring(c, ring, _angle(0.0), _angle(1.0), ring_w, Color(1, 1, 1, 0.09))
	_ring(c, ring, _angle(maxf(0.0, (limit - 900.0) / limit)), _angle(1.0), ring_w, Color(0.75, 0.14, 0.12, 0.62))
	var shift := rpm_now > limit - 450.0
	var bar := Color("#f5f7fa")
	if rpm_now > limit - 150.0:
		bar = Color("#ff3b30") if flash else Color("#ffb199")
	elif shift:
		bar = Color("#ff9f0a")
	if fraction > 0.002:
		_ring(c, ring, _angle(0.0), _angle(fraction), ring_w, bar)
	if shift:
		draw_arc(c, r - 1.0, 0.0, TAU, 64, Color(1, 0.62, 0.04, 0.95 if rpm_now > limit - 150.0 and flash else 0.55), 3.0, true)
	# the ticks every 500 rpm and the thousands
	var i := 0
	while i * 500.0 <= limit + 1.0:
		var a := _angle(i * 500.0 / limit)
		var major := i % 2 == 0
		var inner := ring - ring_w / 2.0 - (r * 0.06 if major else r * 0.03)
		var outer := ring - ring_w / 2.0 - 1.0
		var dir := Vector2(cos(a), sin(a))
		draw_line(c + dir * inner, c + dir * outer, Color(1, 1, 1, 0.85 if major else 0.4), 2.0 if major else 1.0, true)
		if major:
			var lab := ring - ring_w / 2.0 - r * 0.17
			_text(str(i / 2), c + dir * lab, roundi(r * 0.12), Color("#ff8a80") if (i / 2) * 1000.0 >= limit - 900.0 else Color("#e8edf3"))
		i += 1
	# the coolant on the right and the oil lamp on the left (EngineDamage)
	var pedal_r := r * 0.5
	var pedal_w := r * 0.07
	_ring(c, pedal_r, deg_to_rad(-45.0), deg_to_rad(45.0), pedal_w, Color(1, 1, 1, 0.1))
	var oil_warn := false
	var coolant_warn := false
	if car.engine_damage != null:
		var h: Dictionary = car.engine_damage.health
		var temp := float(h.get("temp", 90.0))
		var cf := clampf((temp - COOLANT_RANGE[0]) / (COOLANT_RANGE[1] - COOLANT_RANGE[0]), 0.0, 1.0)
		if cf > 0.01:
			_ring(c, pedal_r, deg_to_rad(45.0 - 90.0 * cf), deg_to_rad(45.0), pedal_w, _band(temp))
		oil_warn = float(h.get("oil", 1.0)) < 0.2
		coolant_warn = temp > COOLANT_BANDS[2] or float(h.get("coolant", 1.0)) < 0.3 or float(h.get("failed", 0.0)) > 0.0
	var blink := int(Time.get_ticks_msec() / 250) % 2 == 0
	var icon := r * 0.17
	if oil_warn:
		_icon("oil-warning", c + Vector2(-r * 0.37, r * 0.02), icon, 1.0, "OIL", Color("#ff3b30"))
	var cool_file := "coolant-idle" if not coolant_warn or blink else "coolant-warning"
	_icon(cool_file, c + Vector2(r * 0.37, r * 0.02), icon, 1.0 if coolant_warn else 0.55, "H2O", Color(1, 1, 1, 0.45))
	# the speed, the unit, the gear
	var metric := str(Settings.get_value("units")) != "imperial"
	var spd := absf(car.speed) * (3.6 if metric else 2.2369362920544)
	_text(str(roundi(spd)), c + Vector2(0, -r * 0.17), roundi(r * 0.4), Color.WHITE)
	_text("km/h" if metric else "mph", c + Vector2(0, r * 0.06), roundi(r * 0.11), Color("#b8c2cf"))
	var stalled := not car.engine.running
	var gear := car.gear_name()
	var gc := Color.WHITE
	if stalled:
		gc = Color("#ff5a4f")
	elif gear.begins_with("R"):
		gc = Color("#ffb340")
	elif gear.begins_with("N"):
		gc = Color("#52e085")
	_text(gear, c + Vector2(0, r * 0.3), roundi(r * 0.26), gc)
	_draw_lights(c, r, stalled)


func _band(t: float) -> Color:
	if t < COOLANT_BANDS[0]:
		return Color("#6ab0ff")
	if t <= COOLANT_BANDS[1]:
		return Color("#37d67a")
	if t <= COOLANT_BANDS[2]:
		return Color("#ffb347")
	return Color("#ff5a4f")


## A picture of images/HUD, or a short word while it is not there.
func _icon(file: String, at: Vector2, sz: float, alpha: float, word: String, col: Color) -> void:
	var tex := image(file)
	if tex != null:
		draw_texture_rect(tex, Rect2(at - Vector2(sz, sz) / 2.0, Vector2(sz, sz)), false, Color(1, 1, 1, alpha))
	else:
		_text(word, at, roundi(sz * 0.55), col)


## The badges (Hud.js drawLights): a picture in its state, orange when on, grey when switched off, blinking while it works.
func _badge(n: String, rect: Rect2) -> void:
	var st: String = states.get(n, "")
	var blink := int(Time.get_ticks_msec() / 125) % 2 == 0
	var file: String = BADGE_FILE[n]
	var which := "active"
	if st == "off":
		which = "off" if n == "TC" else "inactive"
	elif st == "active" and blink:
		which = "inactive"
	var tex := image("%s-%s" % [file, which])
	if tex != null:
		draw_texture_rect(tex, rect, false)
	_rects.append([rect, n])


func _draw_lights(c: Vector2, r: float, stalled: bool) -> void:
	_rects.clear()
	if stalled:
		_text("ENGINE OFF", c + Vector2(0, r * 0.53), roundi(r * 0.095), Color("#ff5a4f"))
	else:
		var column := ["LC", "2S"].filter(func(n): return states.get(n, null) != null)
		var word := r * 0.36
		var step := r * 0.1
		var top := c.y + r * 0.53 - step * (column.size() - 1) / 2.0
		for k in column.size():
			var yc := top + k * step
			_badge(column[k], Rect2(c.x - word / 2.0, yc - word / 2.0, word, word))
	var arc_names := ["TC", "ESC", "ABS", "P", "TB"].filter(func(n): return states.get(n, null) != null)
	var badge := r * 0.24
	var radius := r * 0.77
	var spread := deg_to_rad(27.0)
	var h := r * 0.13
	var font := roundi(r * 0.075)
	for k in arc_names.size():
		var n: String = arc_names[k]
		var a := PI / 2.0 + ((arc_names.size() - 1) / 2.0 - k) * spread
		var p := c + Vector2(cos(a), sin(a)) * radius
		if BADGE_FILE.has(n):
			_badge(n, Rect2(p - Vector2(badge, badge) / 2.0, Vector2(badge, badge)))
			continue
		var st: Array = LIGHT_STYLE.get(states[n], LIGHT_STYLE["off"])
		var w := maxf(r * 0.2, _font.get_string_size(n, HORIZONTAL_ALIGNMENT_LEFT, -1, maxi(1, font)).x + r * 0.1)
		var box := StyleBoxFlat.new()
		box.bg_color = st[1]
		box.border_color = st[0]
		box.set_border_width_all(maxi(1, roundi(r * 0.012)))
		box.set_corner_radius_all(roundi(h * 0.3))
		draw_style_box(box, Rect2(p - Vector2(w, h) / 2.0, Vector2(w, h)))
		_text(n, p, font, st[2])


## The boost gauge (an extra of the tuning menu): the manifold from the vacuum of a closed throttle (-1 bar) to the full
## boost, with a mark that keeps the peak for a while.
func _draw_boost(car: Car) -> void:
	var e := car.engine
	var s := size.x
	var c := Vector2(s, s) / 2.0
	var r := s / 2.0 - 2.0
	var x: Dictionary = e.extras
	var full := e.turbo_bar if e.turbo_bar > 0.0 else float(x.get("boost_full", 1.0))
	var top := maxf(0.5, maxf(float(x.get("boost_scale", 2.0)), full * 1.15))
	var low := -1.0
	var value := e.boost * full - (1.0 - clampf(car.throttle, 0.0, 1.0)) * 0.6 * (1.0 - e.boost)
	var now := Time.get_ticks_msec() / 1000.0
	if value >= _peak:
		_peak = value
		_peak_time = now
	elif now - _peak_time > 2.5:
		_peak = value
	var fr := func(p: float) -> float: return clampf((p - low) / (top - low), 0.0, 1.0)
	_face(c, r)
	var ring := r * 0.8
	var w := r * 0.12
	_ring(c, ring, _angle(0.0), _angle(1.0), w, Color(1, 1, 1, 0.09))
	_ring(c, ring, _angle(fr.call(0.0)), _angle(fr.call(top)), w, Color(0.18, 0.7, 0.35, 0.18))
	_ring(c, ring, _angle(fr.call(maxf(0.1, full))), _angle(fr.call(top)), w, Color(0.75, 0.14, 0.12, 0.3))
	if value > 0.005:
		_ring(c, ring, _angle(fr.call(0.0)), _angle(fr.call(value)), w, Color("#ff9f0a") if value > full * 1.02 else Color("#5fb3ff"))
	elif value < -0.005:
		_ring(c, ring, _angle(fr.call(value)), _angle(fr.call(0.0)), w, Color("#9aa7b8"))
	var pa := _angle(fr.call(_peak))
	var pd := Vector2(cos(pa), sin(pa))
	draw_line(c + pd * (ring - w * 0.7), c + pd * (ring + w * 0.7), Color("#ffd04d"), 3.0, true)
	var p := low
	while p <= top + 1e-6:
		var a := _angle(fr.call(p))
		var d := Vector2(cos(a), sin(a))
		var whole := absf(p - roundf(p)) < 1e-6
		var inner := ring - w / 2.0 - (r * 0.07 if whole else r * 0.035)
		draw_line(c + d * inner, c + d * (ring - w / 2.0 - 1.0), Color(1, 1, 1, 0.85 if whole else 0.4), 2.0 if whole else 1.0, true)
		if whole:
			_text(str(roundi(p)), c + d * (ring - w / 2.0 - r * 0.2), roundi(r * 0.13), Color("#e8edf3"))
		p += 0.5
	var metric := str(Settings.get_value("units")) != "imperial"
	_text(("%.2f" % value) if metric else ("%.1f" % (value * 14.5038)), c + Vector2(0, r * 0.12), roundi(r * 0.3), Color.WHITE)
	_text("bar" if metric else "psi", c + Vector2(0, r * 0.42), roundi(r * 0.13), Color("#8fa0b4"))
	if e.als_active:
		var flash := int(Time.get_ticks_msec() / 90) % 2 == 0
		_text("ANTI-LAG", c + Vector2(0, r * 0.62), roundi(r * 0.13), Color("#ffb340") if flash else Color("#ff6b62"))
