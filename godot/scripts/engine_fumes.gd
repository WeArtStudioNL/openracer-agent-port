class_name EngineFumes
extends Node3D
## What a hurt engine shows (EngineDamage.health), after web/js/Car.js engineFume / exhaustFume and web/js/Leaks.js:
## steam from a hot or leaking cooling system and dark smoke from oil that burns, out of the engine bay; white smoke
## from the tail pipes after a blown head gasket; and the leaks: drops of oil (dark) from the pan and of coolant
## (pale green) from the radiator, a bent one dripping and one torn open spraying in 1 to 5 jets, that fall on the
## road and leave stains there: black blots of oil that stay, darker wet patches of coolant that dry in 70 s.

const DROPS := 500
const STAINS := 3000
const DRY_TIME := 70.0
const OIL := 0
const COOLANT := 1

var car: Car
var _steam: GPUParticles3D
var _smoke: GPUParticles3D
var _pipe_smoke: Array[GPUParticles3D] = []
var _pipes: Array = []
var _drops: MultiMeshInstance3D
var _stains: MultiMeshInstance3D
var _pos := PackedVector3Array()
var _vel := PackedVector3Array()
var _age := PackedFloat32Array()
var _floor := PackedFloat32Array()     # the height of the road under the drop when it was made
var _kind := PackedByteArray()
var _alive := PackedByteArray()
var _next_drop := 0
var _next_stain := 0
var _used_stains := 0
var _born := PackedFloat32Array()
var _peak := PackedFloat32Array()
var _stain_kind := PackedByteArray()
var _clock := 0.0
var _dry_in := 0.0
var _oil_left := 0.0
var _drip_left := 0.0
var _jet_left := [0.0, 0.0, 0.0, 0.0, 0.0]
var _jet_dirs: Array = []               # per jet: [azimuth, elevation, speed]


func setup(c: Car) -> void:
	car = c
	name = "EngineFumes"
	top_level = true
	var atlas := TyreEffects.smoke_atlas()
	_steam = TyreEffects.emitter(atlas, false, Color(0.97, 0.98, 1.0))
	_smoke = TyreEffects.emitter(atlas, false, Color(0.2, 0.19, 0.18))
	add_child(_steam)
	add_child(_smoke)
	_pipes = ExhaustFlames.pipes_of(c.config)
	for i in mini(4, _pipes.size()):
		var e := TyreEffects.emitter(atlas, false, Color(0.95, 0.95, 0.97))
		add_child(e)
		_pipe_smoke.append(e)
	_pos.resize(DROPS)
	_vel.resize(DROPS)
	_age.resize(DROPS)
	_floor.resize(DROPS)
	_kind.resize(DROPS)
	_alive.resize(DROPS)
	_born.resize(STAINS)
	_peak.resize(STAINS)
	_stain_kind.resize(STAINS)
	_drops = _multimesh(DROPS, true)
	_stains = _multimesh(STAINS, false)
	ReplayFx.attach("leaks", c, self)


func _multimesh(n: int, drops: bool) -> MultiMeshInstance3D:
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	if not drops:
		quad.orientation = PlaneMesh.FACE_Y
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = _blot(drops)
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	if drops:
		mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		mat.billboard_keep_scale = true
	else:
		mat.render_priority = -1
	quad.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = quad
	mm.instance_count = n
	mm.visible_instance_count = 0
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-1e5, -1e4, -1e5), Vector3(2e5, 2e4, 2e5))
	add_child(mi)
	return mi


## A round drop, or a soft irregular blot (a few round blobs) for a stain.
static func _blot(round_drop: bool) -> ImageTexture:
	var size := 64
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var blobs: Array = [[32.0, 32.0, 30.0]]
	if not round_drop:
		blobs.clear()
		for k in 12:
			var a := rng.randf() * TAU
			var d := rng.randf() * 10.0
			blobs.append([32.0 + cos(a) * d, 32.0 + sin(a) * d, 5.0 + rng.randf() * 13.0])
	for y in size:
		for x in size:
			var v := 0.0
			for b in blobs:
				var t: float = Vector2(x - b[0], y - b[1]).length() / b[2]
				if t < 1.0:
					v = maxf(v, 0.9 if t < 0.6 else lerpf(0.9, 0.0, (t - 0.6) / 0.4))
			img.set_pixel(x, y, Color(1, 1, 1, v))
	return ImageTexture.create_from_image(img)


## Takes the drops away (a new start; the stains are on the road and stay).
func clear() -> void:
	_alive.fill(0)
	_drops.multimesh.visible_instance_count = 0


func _process(delta: float) -> void:
	if car == null or not is_instance_valid(car):
		return
	if ReplayFx.active:                     # (a replay does not know when the engine began to smoke: what the car has now is not shown in it)
		_set_rate(_steam, 0.0)
		_set_rate(_smoke, 0.0)
		for e in _pipe_smoke:
			_set_rate(e, 0.0)
		return
	delta = minf(delta, 0.1)
	_clock += delta
	var ed := car.engine_damage
	var h: Dictionary = ed.health if ed != null and ed.usable else {}
	_fumes(h)
	if not h.is_empty() and int(h["leaking"]) != 0:
		_leak(delta, h, ed)
	_step_drops(delta)
	_dry_in -= delta
	if _dry_in <= 0.0:
		_dry_in = 0.5
		_dry()


# steam and smoke out of the bay, white smoke out of the tail pipes (the puffs a second, as Car.js makes them)
func _fumes(h: Dictionary) -> void:
	var xf := car.global_transform
	var steam: float = h.get("steam", 0.0)
	var smoke: float = h.get("smoke", 0.0)
	var white: float = h.get("white_smoke", 0.0)
	var per_second := _steam.amount / _steam.lifetime
	if car.engine_damage != null:
		_steam.global_position = xf * (car.engine_damage.bay + Vector3(0, 0.25, 0))
		_smoke.global_position = _steam.global_position
	_set_rate(_steam, steam * 40.0 / per_second)
	_set_rate(_smoke, smoke * 22.0 / per_second)
	var mxf := car.model_root.global_transform if car.model_root != null else xf
	for i in _pipe_smoke.size():
		var p: Dictionary = _pipes[i]
		_pipe_smoke[i].global_position = mxf * (p["position"] + p["direction"] * 0.1)
		_set_rate(_pipe_smoke[i], white * 45.0 / _pipe_smoke.size() / per_second)


func _set_rate(e: GPUParticles3D, ratio: float) -> void:
	e.amount_ratio = clampf(ratio, 0.0, 1.0)
	e.emitting = ratio > 0.02


func _leak(delta: float, h: Dictionary, ed: EngineDamage) -> void:
	var xf := car.global_transform
	var b := xf.basis
	var v := car.linear_velocity
	var oil_flow: float = h["oil_flow"]
	if oil_flow > 0.001:
		_oil_left += delta * (3.0 + 24.0 * minf(1.0, oil_flow))
		while _oil_left >= 1.0:
			_oil_left -= 1.0
			var at := xf * (ed.bay + Vector3(randf() - 0.5, 0.0, randf() - 0.5) * 0.4 + Vector3(0, -0.35, 0))
			_drop(at, v * 0.95 + Vector3((randf() - 0.5) * 0.3, -0.3, (randf() - 0.5) * 0.3), OIL)
	if int(h["jets"]) > 0 and h["coolant"] > 0.005:
		var pressure: float = 0.35 + 0.65 * minf(1.0, h["coolant"] * 2.0)
		while _jet_dirs.size() < int(h["jets"]):
			_jet_dirs.append([randf() * TAU, -0.15 + randf() * 1.05, 1.6 + randf() * 2.2])
		for j in mini(5, int(h["jets"])):
			_jet_left[j] = minf(14.0, _jet_left[j] + delta * 38.0 * pressure)
			var jd: Array = _jet_dirs[j]
			while _jet_left[j] >= 1.0:
				_jet_left[j] -= 1.0
				var at := xf * (ed.radiator_at + Vector3((randf() - 0.5) * 0.3, -0.05, (randf() - 0.5) * 0.15))
				var az: float = jd[0] + (randf() - 0.5) * 0.28
				var el: float = jd[1] + (randf() - 0.5) * 0.28
				var out: Vector3 = Vector3(cos(az) * cos(el), sin(el), sin(az) * cos(el)) * jd[2] * pressure * (0.8 + randf() * 0.4)
				_drop(at, v + b * out, COOLANT)
	elif h["cool_flow"] > 0.001:
		var cool_flow: float = h["cool_flow"]
		_drip_left += delta * (1.5 + 14.0 * cool_flow)
		while _drip_left >= 1.0:
			_drip_left -= 1.0
			var at := xf * (ed.radiator_at + Vector3((randf() - 0.5) * 0.5, -0.15, (randf() - 0.5) * 0.12))
			_drop(at, v * 0.8 + b * Vector3((randf() - 0.5) * 0.3, -0.1 - randf() * 0.3, (randf() - 0.5) * 0.3), COOLANT)


func _ray(from: Vector3, to: Vector3) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(from, to)
	q.exclude = [car.get_rid()]
	q.collision_mask = 1
	return get_world_3d().direct_space_state.intersect_ray(q)


func _drop(at: Vector3, vel: Vector3, kind: int) -> void:
	ReplayFx.add("leaks", car, [0.0, 1.0, at.x, at.y, at.z, vel.x, vel.y, vel.z, kind])
	var i := _next_drop
	_next_drop = (_next_drop + 1) % DROPS
	_pos[i] = at
	_vel[i] = vel
	_age[i] = 0.0
	_kind[i] = kind
	_alive[i] = 1
	var hit := _ray(at + Vector3(0, 0.3, 0), at + Vector3(0, -3.0, 0))
	_floor[i] = float(hit["position"].y) if not hit.is_empty() else at.y - 3.0


func _step_drops(delta: float, land := true) -> void:
	var mm := _drops.multimesh
	var shown := 0
	var drag := exp(-0.7 * delta)
	for i in DROPS:
		if _alive[i] == 0:
			continue
		_age[i] += delta
		var vv := _vel[i]
		vv = Vector3(vv.x * drag, vv.y * drag - 9.81 * delta, vv.z * drag)
		_vel[i] = vv
		_pos[i] += vv * delta
		if _age[i] > 4.0 or _pos[i].y <= _floor[i] + 0.015:
			_alive[i] = 0
			if _age[i] <= 4.0 and land:
				_land(_pos[i], _kind[i])
			continue
		var s := 0.05 if _kind[i] == OIL else 0.04
		mm.set_instance_transform(shown, Transform3D(Basis.from_scale(Vector3.ONE * s), _pos[i]))
		mm.set_instance_color(shown, Color(0.06, 0.045, 0.03, 0.95) if _kind[i] == OIL else Color(0.55, 0.9, 0.6, 0.55))
		shown += 1
	mm.visible_instance_count = shown


# a drop that lands leaves a stain now and then (less on loose ground, which soaks it up)
func _land(at: Vector3, kind: int) -> void:
	var hit := _ray(at + Vector3(0, 0.5, 0), at + Vector3(0, -1.0, 0))
	if hit.is_empty():
		return
	var surface := "road"
	if hit["collider"] is Node and (hit["collider"] as Node).has_meta("surface"):
		surface = str((hit["collider"] as Node).get_meta("surface"))
	var loose: bool = Content.surface(surface).get("loose", false)
	if kind == OIL:
		if randf() < (0.4 if loose else 0.8):
			_stain(hit["position"], hit["normal"], 0.07 + randf() * 0.16, OIL, 0.3 if loose else 0.6)
	elif randf() < 0.3:
		_stain(hit["position"], hit["normal"], 0.06 + randf() * 0.14, COOLANT, 0.15 if loose else 0.32)


func _stain(at: Vector3, normal: Vector3, radius: float, kind: int, alpha: float, turn := -1.0) -> void:
	if turn < 0.0:
		turn = randf() * TAU
	ReplayFx.add("leaks", car, [0.0, 2.0, at.x, at.y, at.z, normal.x, normal.y, normal.z, radius, kind, alpha, turn])
	var i := _next_stain
	_next_stain = (_next_stain + 1) % STAINS
	_used_stains = mini(STAINS, _used_stains + 1)
	var y := normal.normalized()
	var x := y.cross(Vector3.FORWARD if absf(y.z) < 0.9 else Vector3.RIGHT).normalized()
	var basis := Basis(x, y, x.cross(y)).rotated(y, turn).scaled(Vector3.ONE * radius * 2.0)
	var mm := _stains.multimesh
	mm.set_instance_transform(i, Transform3D(basis, at + y * (0.014 + (i % 7) * 0.0006)))
	mm.set_instance_color(i, _stain_colour(kind, alpha))
	mm.visible_instance_count = _used_stains
	_born[i] = _clock
	_peak[i] = alpha
	_stain_kind[i] = kind


func _stain_colour(kind: int, alpha: float) -> Color:
	return Color(0.025, 0.02, 0.018, alpha) if kind == OIL else Color(0.06, 0.085, 0.07, alpha)


# coolant dries: its stains fade
func _dry() -> void:
	var mm := _stains.multimesh
	for i in _used_stains:
		if _stain_kind[i] != COOLANT or _peak[i] <= 0.0:
			continue
		var left := 1.0 - (_clock - _born[i]) / DRY_TIME
		if left <= 0.0:
			_peak[i] = 0.0
		mm.set_instance_color(i, _stain_colour(COOLANT, _peak[i] * maxf(0.0, left)))


# ---- the replay (ReplayFx: "leaks", a row is a drop (1) or a stain (2) as it was made)

func replay_lookback(_which: String) -> float:
	return 4.0


func replay_add(_which: String, r: Array) -> void:
	if int(r[1]) == 1:
		_drop(Vector3(r[2], r[3], r[4]), Vector3(r[5], r[6], r[7]), int(r[8]))
	else:
		_stain(Vector3(r[2], r[3], r[4]), Vector3(r[5], r[6], r[7]), r[8], int(r[9]), r[10], r[11])
		_born[(_next_stain - 1 + STAINS) % STAINS] = r[0]


func replay_step(_which: String, dt: float) -> void:
	_clock += dt
	_step_drops(minf(dt, 0.1), false)
	_dry()


func replay_clear(_which: String) -> void:
	clear()
	_next_stain = 0
	_used_stains = 0
	_stains.multimesh.visible_instance_count = 0


## The stains made by time t (the coolant dried as far as it had), and the drops of the last seconds falling.
func replay_rebuild(kind: String, rows: Array, end: int, t: float) -> void:
	replay_clear(kind)
	_clock = t
	var start := t - replay_lookback(kind)
	var c := end
	for j in end:
		var r: Array = rows[j]
		if int(r[1]) == 2:
			replay_add(kind, r)
		elif c == end and float(r[0]) > start:
			c = j
	_clock = start
	var a := start
	while a < t - 1e-9:
		var b := t if a + 0.05 >= t - 1e-6 else a + 0.05
		while c < end and float(rows[c][0]) <= b:
			if int(rows[c][1]) == 1:
				replay_add(kind, rows[c])
			c += 1
		_clock += b - a
		_step_drops(b - a, false)
		a = b
	_clock = t
	_dry()


func replay_snapshot(_which: String) -> Variant:
	return {"pos": _pos.duplicate(), "vel": _vel.duplicate(), "age": _age.duplicate(), "floor": _floor.duplicate(),
		"kind": _kind.duplicate(), "alive": _alive.duplicate(), "next_drop": _next_drop, "next_stain": _next_stain,
		"used": _used_stains, "born": _born.duplicate(), "peak": _peak.duplicate(), "stain_kind": _stain_kind.duplicate(),
		"clock": _clock, "stains": _stains.multimesh.buffer.duplicate()}


func replay_restore(_which: String, s: Variant) -> void:
	_pos = s["pos"]
	_vel = s["vel"]
	_age = s["age"]
	_floor = s["floor"]
	_kind = s["kind"]
	_alive = s["alive"]
	_next_drop = s["next_drop"]
	_next_stain = s["next_stain"]
	_used_stains = s["used"]
	_born = s["born"]
	_peak = s["peak"]
	_stain_kind = s["stain_kind"]
	_clock = s["clock"]
	if (s["stains"] as PackedFloat32Array).size() == _stains.multimesh.buffer.size() and _stains.multimesh.buffer.size() > 0:
		_stains.multimesh.buffer = s["stains"]
	_stains.multimesh.visible_instance_count = _used_stains
