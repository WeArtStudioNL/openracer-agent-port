class_name Ground
extends RefCounted
## The condition of the ground (web/js/Atmosphere.js and Surfaces.js): how wet it is, how much snow lies on it, the
## puddles, and what the wet and the snow take from the grip of every surface. The state is shared (static): the
## physics of every car reads it through Content.surface, the Atmosphere of the track moves it with the weather and
## draws it.
##
## The ground always follows the weather: rain wets the road in about 40 s and it dries in about 3 minutes; snow covers
## the ground in about 2.5 minutes and melts in about 7 (rain melts it in 2). The puddles fill in a minute and a half
## of rain. Where a car has been, the snow is scraped (a tyre that slides takes it away, one that rolls takes a little)
## and melted (the heat of the engine under the car): kept in tiles of 25.6 m with cells of 40 cm, so that it does
## not come back when the car drives away and returns; while it snows the bare cells fill up again (17 minutes).

## What the wet and the snow take from the grip of a surface at a fully wet or a fully snowy ground (Surfaces.js).
const WET_LOSS := {"road": 0.28, "track01": 0.28, "grass": 0.2, "ground": 0.2, "sand": 0.08, "gravel": 0.1, "mud": 0.0, "wet": 0.0}
const SNOW_LOSS := {"road": 0.62, "track01": 0.62, "wet": 0.62, "grass": 0.42, "ground": 0.42, "sand": 0.35, "gravel": 0.45, "mud": 0.25}
const CLEAR_N := 512                 # the window of cleared snow round the car that goes to the shader (cells)
const CLEAR_CELL := 0.4              # m
const CLEAR_SIZE := CLEAR_N * CLEAR_CELL
const TILE := 64                     # cells per side of a tile of the cleared snow
const RINGS := 12                    # the rings of the wheels in a puddle that the shader shows

static var road_sound := ""          # a road with the texture of loose ground (dirt, gravel): the surface that it sounds like; it grips as a road
static var wet := 0.0
static var snow := 0.0
static var puddle := 0.0
static var road_melt := 0.0          # the share of the snow on the road that is melted (a race starts with a partly bare road)
static var rain := 0.0               # the rain on the puddles (0 to 1, follows the weather slowly)
## How far the cleared snow has grown back (the cells keep a level; what is bare is that level minus this): the
## snow comes back everywhere at once without a pass over all the cells.
static var regrow := 0.0
static var rings: Array[Vector4] = []                 # x, z, age, strength
static var window := PackedFloat32Array()             # the cells round window_centre (wrapping), raw levels
static var window_centre := Vector2i.ZERO
static var window_dirty := false
static var _window_set := false
static var _tiles := {}                               # Vector2i -> Array of TILE * TILE floats (an Array: written in place)
static var _cache := {}
static var _rec := {}                                 # (the replay: what a wheel or a car did to the snow since its last row)
static var _replayer: Ground = null                   # (the object of the replay, ReplayFx "ground")
static var _last_grip := -1.0
## A number that goes up when the grip of the road changed (the AI makes its speeds again).
static var grip_version := 0


## Starts the ground as the weather would have left it (Atmosphere.js startGround): a new drive.
static func start(weather: String) -> void:
	wet = 0.9 if weather == "rain" else 0.0
	snow = 0.55 if weather == "snow" else 0.0
	puddle = 0.6 if weather == "rain" else 0.0
	road_melt = 0.42 if weather == "snow" else 0.0
	rain = 1.0 if weather == "rain" else 0.0
	regrow = 0.0
	rings.clear()
	_tiles.clear()
	_window_set = false
	window = PackedFloat32Array()
	window.resize(CLEAR_N * CLEAR_N)
	window_dirty = true
	_fixed(str(Settings.get_value("gfx_ground")))
	_changed(true)


## The grip of a surface (Surfaces.js getSurface): level is the snow at the wheel (-1: the snow of the whole ground),
## water how deep the water of a puddle is there (0 to 1; it makes the wet at least that much more).
## What the tyres hear on a surface: the road of a track that is drawn as dirt or gravel (track.json design.textures.road)
## does not squeal and has the noise of that ground.
static func sound_surface(id: String) -> String:
	return road_sound if road_sound != "" and (id == "road" or id == "track01") else id


static func surface(id: String, level := -1.0, water := 0.0) -> Dictionary:
	var key := id if Content.SURFACES.has(id) else "road"
	var base: Dictionary = Content.SURFACES[key]
	var lv := snow if level < 0.0 else level
	var w := maxf(wet, minf(1.5, water * 1.5)) if water > 0.0 else wet
	if w < 0.005 and lv < 0.005:
		return base
	var step := clampi(roundi(lv * 20.0), 0, 20)
	var wet_step := clampi(roundi(w * 20.0), 0, 30)
	var cache_key := "%s%dw%d" % [key, step, wet_step]
	var cached: Variant = _cache.get(cache_key)
	if cached != null:
		return cached
	var factor := (1.0 - float(WET_LOSS.get(key, 0.0)) * wet_step / 20.0) * (1.0 - float(SNOW_LOSS.get(key, 0.0)) * step / 20.0)
	var out := base.duplicate()
	out["static"] = float(base["static"]) * factor
	out["kinetic"] = float(base["kinetic"]) * factor
	_cache[cache_key] = out
	return out


## The share of the dry grip that the whole ground has (for the debug text and the AI).
static func grip() -> float:
	return (1.0 - 0.28 * wet) * (1.0 - 0.62 * snow)


## The grip of the road now (Opponent.js: the AI drives its line slower by this over 1.2).
static func road_grip() -> float:
	return float(surface("road")["static"])


static func _changed(force: bool) -> void:
	var g := grip()
	if force or absf(g - _last_grip) > 0.004:
		_last_grip = g
		_cache.clear()
		grip_version += 1


## Every physics step: the ground follows the weather, and the cars take the snow away (Atmosphere.js update and
## snowWork). cars: the Car nodes (not the ghost).
static func step(dt: float, weather: String, cars: Array) -> void:
	dt = minf(dt, 0.25)
	var raining := weather == "rain"
	var snowing := weather == "snow"
	rain += ((1.0 if raining else 0.0) - rain) * minf(1.0, dt * 0.5)
	if _fixed(str(Settings.get_value("gfx_ground"))):
		_rings_and_cars(dt, cars)
		return
	puddle = minf(1.0, puddle + dt / 90.0) if raining else maxf(0.0, puddle - dt / 420.0)
	if raining:
		wet = minf(1.0, wet + dt / 40.0)
		snow = maxf(0.0, snow - dt / 120.0)
	else:
		wet = maxf(0.0, wet - dt / 180.0)
		if snowing:
			snow = minf(1.0, snow + dt / 150.0)
		elif snow > 0.0:
			snow = maxf(0.0, snow - dt / 420.0)
	if snowing:
		wet = maxf(0.0, wet - dt / 20.0)
		road_melt = maxf(0.0, road_melt - dt / 1800.0)
		if snow > 0.0:
			regrow += dt / 1100.0
			window_dirty = true
	_changed(false)
	_rings_and_cars(dt, cars)


static func _rings_and_cars(dt: float, cars: Array) -> void:
	for i in range(rings.size() - 1, -1, -1):
		rings[i].z += dt
		if rings[i].z > 1.6:
			rings.remove_at(i)
	_cars(dt, cars)


## The ground fixed by the setting gfx_ground (Atmosphere.js groundOverride: the car editor's Save and test): dry, wet or
## snow at once and kept so; "auto" (false) leaves it to the weather.
static func _fixed(mode: String) -> bool:
	match mode:
		"dry":
			wet = 0.0
			snow = 0.0
			puddle = 0.0
		"wet":
			wet = 1.0
			snow = 0.0
			puddle = 0.7
		"snow":
			wet = 0.0
			snow = 1.0
			puddle = 0.0
			road_melt = maxf(road_melt, 0.34)
		_:
			return false
	_changed(false)
	return true


static func _cars(dt: float, cars: Array) -> void:
	if cars.is_empty():
		return
	var lead: Car = cars[0]
	_move_window(lead.global_position.x, lead.global_position.z)
	for v in cars.size():
		var car: Car = cars[v]
		var speed := Vector2(car.linear_velocity.x, car.linear_velocity.z).length()
		if snow > 0.03 and v < 8:
			# the heat of the engine and the exhaust under the car: discs along its length
			var fwd := car.global_transform.basis.z
			fwd.y = 0.0
			if fwd.length_squared() > 1e-6:
				fwd = fwd.normalized()
				var length := float(car.config.get("dimensions", {}).get("length", 4.0))
				var width := maxf(0.8, car.front_track * 0.85)
				_heat(car.global_position.x, car.global_position.z, fwd.x, fwd.z, length, width, 0.55 * dt)
				# (the replay: the heat of a tenth of a second, where the car is then)
				var rec: Array = _rec.get(car.get_instance_id(), [0.0, 0.0])
				rec[0] += 0.55 * dt
				rec[1] += dt
				if rec[1] > 0.1:
					ReplayFx.add("ground", null, [0.0, 1.0, car.global_position.x, car.global_position.z, fwd.x, fwd.z, length, width, rec[0]])
					rec = [0.0, 0.0]
				_rec[car.get_instance_id()] = rec
		for w: Car.Wheel in car.wheels:
			if not w.contact:
				w.local_snow = snow
				w.local_water = 0.0
				continue
			var water := puddle_at(w.point.x, w.point.z) if puddle > 0.05 else 0.0
			w.local_water = water
			if water > 0.3 and speed > 2.5:
				w.ring_time += dt
				if w.ring_time > 0.07:
					w.ring_time = 0.0
					add_ring(w.point.x, w.point.z, minf(1.0, speed / 24.0) * water)
					ReplayFx.add("ground", null, [0.0, 2.0, w.point.x, w.point.z, minf(1.0, speed / 24.0) * water])
			if snow > 0.03:
				var slip := Vector2(w.forward_speed - w.omega * w.radius, w.side_speed).length()
				var scrape := clampf((slip - 1.0) / 5.0, 0.0, 1.0)
				paint_clear(w.point.x, w.point.z, 0.16, (3.0 + 7.0 * scrape) * dt)
				# (the replay: what a wheel takes away, added up over a tenth of a second, at the place where it is then)
				var key := "%d/%d" % [car.get_instance_id(), car.wheels.find(w)]
				var rec: Array = _rec.get(key, [0.0, 0.0])
				rec[0] += (3.0 + 7.0 * scrape) * dt
				rec[1] += dt
				if rec[1] > 0.1:
					ReplayFx.add("ground", null, [0.0, 0.0, w.point.x, w.point.z, 0.16, rec[0]])
					rec = [0.0, 0.0]
				_rec[key] = rec
			var on_road := w.surface == "road" or w.surface == "track01" or w.surface == "wet"
			w.local_snow = snow * (1.0 - clear_at(w.point.x, w.point.z)) * ((1.0 - road_melt) if on_road else 1.0)


static func add_ring(x: float, z: float, amp: float) -> void:
	if rings.size() >= RINGS:
		rings.remove_at(0)
	rings.append(Vector4(x, z, 0.0, amp))


# ---- the puddles: a pattern of blobs that the rain fills; the shader makes the same pattern (the same hash with
# whole numbers), so that the wheel knows where the water is

static func _ihash(x: int, y: int) -> float:
	var h := (x * 374761393 + y * 668265263) & 0xFFFFFFFF
	h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
	h = h ^ (h >> 16)
	return float(h & 0xFFFFFF) / 16777216.0


static func _vnoise(x: float, y: float) -> float:
	var ix := floori(x)
	var iy := floori(y)
	var fx := x - ix
	var fy := y - iy
	fx = fx * fx * (3.0 - 2.0 * fx)
	fy = fy * fy * (3.0 - 2.0 * fy)
	var a := _ihash(ix, iy)
	var b := _ihash(ix + 1, iy)
	var c := _ihash(ix, iy + 1)
	var d := _ihash(ix + 1, iy + 1)
	return lerpf(lerpf(a, b, fx), lerpf(c, d, fx), fy)


## The water of a puddle at a place (0 to 1).
static func puddle_at(x: float, z: float) -> float:
	if puddle < 0.01:
		return 0.0
	var n := 0.6 * _vnoise(x / 5.0, z / 5.0) + 0.4 * _vnoise(x / 1.9 + 31.7, z / 1.9 + 11.3)
	var t := 0.8 - 0.22 * puddle
	return smoothstep(t, t + 0.04, n) * smoothstep(0.0, 0.2, puddle)


# ---- the snow that the cars took away

static func _cell(i: int, j: int) -> float:
	var tile: Variant = _tiles.get(Vector2i(floori(float(i) / TILE), floori(float(j) / TILE)))
	if tile == null:
		return 0.0
	return tile[posmod(j, TILE) * TILE + posmod(i, TILE)]


## How bare the snow is at a place (0: the snow of the ground, 1: bare).
static func clear_at(x: float, z: float) -> float:
	return clampf(_cell(floori(x / CLEAR_CELL), floori(z / CLEAR_CELL)) - regrow, 0.0, 1.0)


## The snow that lies at a place (0 to 1).
static func snow_at(x: float, z: float) -> float:
	return snow * (1.0 - clear_at(x, z))


static func _in_window(i: int, j: int) -> bool:
	return _window_set and absi(i - window_centre.x) < CLEAR_N / 2 and absi(j - window_centre.y) < CLEAR_N / 2


static func _cell_add(i: int, j: int, add: float) -> void:
	var key := Vector2i(floori(float(i) / TILE), floori(float(j) / TILE))
	var tile: Variant = _tiles.get(key)
	if tile == null:
		var fresh := []
		fresh.resize(TILE * TILE)
		fresh.fill(0.0)
		_tiles[key] = fresh
		tile = fresh
	var index := posmod(j, TILE) * TILE + posmod(i, TILE)
	var value := minf(maxf(float(tile[index]), regrow) + add, regrow + 1.0)
	tile[index] = value
	if _in_window(i, j) and not window.is_empty():
		window[posmod(j, CLEAR_N) * CLEAR_N + posmod(i, CLEAR_N)] = value


## A disc round a place gets more bare, most at the middle (a disc is at least one cell wide).
static func paint_clear(x: float, z: float, radius: float, amount: float) -> void:
	if amount <= 0.0:
		return
	radius = maxf(radius, CLEAR_CELL * 0.6)
	var i0 := floori((x - radius) / CLEAR_CELL)
	var i1 := floori((x + radius) / CLEAR_CELL)
	var j0 := floori((z - radius) / CLEAR_CELL)
	var j1 := floori((z + radius) / CLEAR_CELL)
	for j in range(j0, j1 + 1):
		for i in range(i0, i1 + 1):
			var dx := (i + 0.5) * CLEAR_CELL - x
			var dz := (j + 0.5) * CLEAR_CELL - z
			var d2 := (dx * dx + dz * dz) / (radius * radius)
			if d2 <= 1.0:
				_cell_add(i, j, amount * (1.3 - d2))
	window_dirty = true


## The cells of a block of the world (cell numbers, both ends in) from the tiles into the window.
static func _fill_window(i0: int, i1: int, j0: int, j1: int) -> void:
	for j in range(j0, j1 + 1):
		var row := posmod(j, CLEAR_N) * CLEAR_N
		for i in range(i0, i1 + 1):
			window[row + posmod(i, CLEAR_N)] = 0.0
	for key: Vector2i in _tiles:
		var ti0 := key.x * TILE
		var tj0 := key.y * TILE
		if ti0 > i1 or ti0 + TILE - 1 < i0 or tj0 > j1 or tj0 + TILE - 1 < j0:
			continue
		var tile: Array = _tiles[key]
		for r in range(maxi(j0, tj0), mini(j1, tj0 + TILE - 1) + 1):
			for c in range(maxi(i0, ti0), mini(i1, ti0 + TILE - 1) + 1):
				var value: float = tile[(r - tj0) * TILE + (c - ti0)]
				if value > 0.0:
					window[posmod(r, CLEAR_N) * CLEAR_N + posmod(c, CLEAR_N)] = value


## The window follows the car: the strips that come into it are filled from the tiles.
static func _move_window(x: float, z: float) -> void:
	if window.is_empty():
		window.resize(CLEAR_N * CLEAR_N)
	var ci := floori(x / CLEAR_CELL)
	var cj := floori(z / CLEAR_CELL)
	var half := CLEAR_N / 2
	if not _window_set or absi(ci - window_centre.x) >= half or absi(cj - window_centre.y) >= half:
		window_centre = Vector2i(ci, cj)
		_window_set = true
		_fill_window(ci - half + 1, ci + half - 1, cj - half + 1, cj + half - 1)
		window_dirty = true
		return
	var di := ci - window_centre.x
	var dj := cj - window_centre.y
	if di == 0 and dj == 0:
		return
	var old := window_centre
	window_centre = Vector2i(ci, cj)
	if di > 0:
		_fill_window(old.x + half, ci + half - 1, cj - half + 1, cj + half - 1)
	elif di < 0:
		_fill_window(ci - half + 1, old.x - half, cj - half + 1, cj + half - 1)
	if dj > 0:
		_fill_window(ci - half + 1, ci + half - 1, old.y + half, cj + half - 1)
	elif dj < 0:
		_fill_window(ci - half + 1, ci + half - 1, cj - half + 1, old.y - half)
	window_dirty = true


## The middle of the window in the world (m), for the shader.
static func window_middle() -> Vector2:
	return Vector2((window_centre.x + 0.5) * CLEAR_CELL, (window_centre.y + 0.5) * CLEAR_CELL)


## The heat of a car under it: discs along its length (x, z its middle, f the way it points).
static func _heat(x: float, z: float, fx: float, fz: float, length: float, width: float, amount: float) -> void:
	var steps := maxi(2, roundi(length / 0.7))
	for k in steps:
		var along := (float(k) / (steps - 1) - 0.5) * length * 0.9
		paint_clear(x + fx * along, z + fz * along, width * 0.5, amount)


# ---- the replay (ReplayFx "ground", Atmosphere.js groundRecord): what the cars did to the ground, as rows: [t, 0, x, z,
# radius, amount] the snow a wheel took away in a tenth of a second, [t, 1, x, z, fx, fz, length, width, amount] the
# heat of a car, [t, 2, x, z, strength] a ring of a wheel in a puddle. The replay makes the snow again by the same
# scraping on the same places (a jump: everything until then), the rings of the last seconds.

## The object that the replay attaches (Atmosphere).
static func replayer() -> Ground:
	if _replayer == null:
		_replayer = Ground.new()
	return _replayer


static func _apply(r: Array, age := 0.0) -> void:
	match int(r[1]):
		0:
			paint_clear(r[2], r[3], r[4], r[5])
		1:
			if r.size() >= 9:
				_heat(r[2], r[3], r[4], r[5], r[6], r[7], r[8])
		2:
			if age < 1.6:
				add_ring(r[2], r[3], r[4])
				rings[-1].z = age


## The window of the shader round the car that the replay follows.
static func _follow_replay() -> void:
	var rec := ReplayFx.recording
	if rec == null or not is_instance_valid(rec.replay):
		return
	var body: Node3D = rec.replay.call("car_body", int(rec.replay.get("target")))
	if body != null:
		_move_window(body.global_position.x, body.global_position.z)


func replay_lookback(_kind: String) -> float:
	return 0.0


func replay_add(_kind: String, r: Array) -> void:
	_apply(r)


func replay_step(_kind: String, dt: float) -> void:
	_rings_and_cars(minf(dt, 0.25), [])
	_follow_replay()


func replay_clear(_kind: String) -> void:
	pass


func replay_rebuild(_kind: String, rows: Array, end: int, t: float) -> void:
	_tiles.clear()
	rings.clear()
	for i in end:
		_apply(rows[i], t - float(rows[i][0]))
	_window_set = false
	_follow_replay()
	window_dirty = true


func replay_snapshot(_kind: String) -> Variant:
	return {"tiles": _tiles.duplicate(true), "rings": rings.duplicate()}


func replay_restore(_kind: String, snap: Variant) -> void:
	if not (snap is Dictionary):
		return
	_tiles = snap["tiles"]
	rings.assign(snap["rings"])
	_window_set = false              # (the window is filled again round the car of the game at the next step)
	window_dirty = true
