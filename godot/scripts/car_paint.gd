class_name CarPaint
extends RefCounted
## The materials and the paint of a car (web/js/MaterialOverrides.js and CarColors.js), for the game, the AI cars and
## the car editor.
##
## car.json "materials": { material name: { color, metalness, roughness, opacity, clearcoat, clearcoatRoughness,
## envMapIntensity } }: a material of the model set right (glass that arrived as opaque white metal, ...). Every field
## is optional; the rest stays as the model has it.
##
## car.json "colors": { body, rim, bodyFinish, rimFinish, bodyFlake, rimFlake, bodyPattern, rimPattern, bodyUv, rimUv }:
## the paint of the body (every material called carpaint) and of the rims (rimpaint), with a finish (gloss, satin, matte,
## metallic, pearl, metal flake, candy, chrome, brushed metal; "" keeps the finish of the model). Metal flake has a
## pattern (noise, voronoi, hexagons, marble: a normal map made here), a size (100 %: the normal size) and a map: from the
## UV map of the model, or generated (a box projection, Godot's triplanar mapping).
##
## The model's own materials are not changed (the parts library and the wheels share theirs): a changed material is a
## copy, set as the surface override of the mesh; it carries the meta "car_paint" (and a painted one "paint_base", the
## material under the paint), so that a new paint or new overrides start again from the model.

## The finishes (OpenRacer.carFinishes): roughness, metalness, clear coat, its roughness.
const FINISHES := {
	"gloss": [0.22, 0.1, 1.0, 0.03],
	"satin": [0.5, 0.12, 0.25, 0.35],
	"matte": [0.92, 0.0, 0.0, 0.0],
	"metallic": [0.33, 0.75, 1.0, 0.05],
	"pearl": [0.28, 0.3, 1.0, 0.04],
	"flake": [0.38, 0.9, 1.0, 0.06],
	"candy": [0.15, 0.85, 1.0, 0.02],
	"chrome": [0.04, 1.0, 0.0, 0.0],
	"brushed": [0.42, 1.0, 0.0, 0.0],
}
const FINISH_LABELS := {"": "As the model", "gloss": "Gloss", "satin": "Satin", "matte": "Matte", "metallic": "Metallic",
	"pearl": "Pearl (the colour shifts)", "flake": "Metal flake (sparkle)", "candy": "Candy (deep and glassy)", "chrome": "Chrome", "brushed": "Brushed metal"}
const PATTERNS := {"noise": "Noise (fine sparkle)", "voronoi": "Voronoi (crystals)", "hexagons": "Hexagons (honeycomb)", "marble": "Marble (veins)"}
const UVS := {"model": "From the model", "generated": "Generated (box projection)"}
const PATTERN_SCALE := {"noise": 0.45, "voronoi": 0.6, "hexagons": 0.6, "marble": 0.9}
const TILES_PER_METRE := {"noise": 16.0, "voronoi": 1.5, "hexagons": 1.5, "marble": 1.0}
const PATTERN_SIZE := 256

static var _patterns := {}               # pattern -> ImageTexture (made once)


## The materials and the paint of car.json on everything under root (the car: its model, wheels and rig).
static func apply(root: Node, cfg: Dictionary) -> void:
	apply_overrides(root, cfg.get("materials") if cfg.get("materials") is Dictionary else {})
	paint(root, colors_of(cfg.get("colors")))


## The colours of car.json with the defaults of Car.setColors, or {} when there is no paint.
static func colors_of(c: Variant) -> Dictionary:
	if not c is Dictionary:
		return {}
	var d: Dictionary = c
	var any := false
	for k in ["body", "rim", "bodyFinish", "rimFinish"]:
		any = any or (d.get(k) is String and str(d[k]) != "")
	if not any:
		return {}
	var out := {}
	for kind in ["body", "rim"]:
		var col: Variant = d.get(kind)
		out[kind] = Color(str(col)) if col is String and str(col) != "" else null
		out[kind + "Finish"] = str(d.get(kind + "Finish", "")) if d.get(kind + "Finish") is String else ""
		out[kind + "Flake"] = float(d.get(kind + "Flake", 100.0)) if d.get(kind + "Flake") != null else 100.0
		out[kind + "Pattern"] = str(d.get(kind + "Pattern", "noise")) if d.get(kind + "Pattern") is String else "noise"
		out[kind + "Uv"] = str(d.get(kind + "Uv", "model")) if d.get(kind + "Uv") is String else "model"
	return out


# ---- the overrides of car.json "materials"

## The values of a material that can be overridden.
static func values_of(m: BaseMaterial3D) -> Dictionary:
	return {"color": "#" + m.albedo_color.to_html(false), "metalness": m.metallic, "roughness": m.roughness, "opacity": m.albedo_color.a,
		"clearcoat": m.clearcoat if m.clearcoat_enabled else 0.0, "clearcoatRoughness": m.clearcoat_roughness, "envMapIntensity": 1.0,
		"transparency": m.transparency}


## A material as it was in the model (its meta "original"), with an override (or none) on it.
static func apply_override(m: BaseMaterial3D, o: Variant) -> void:
	var v: Dictionary = (m.get_meta("original") as Dictionary).duplicate() if m.has_meta("original") else values_of(m)
	if o is Dictionary:
		v.merge(o, true)
	var c := Color(str(v["color"]))
	var opacity := float(v["opacity"])
	m.albedo_color = Color(c.r, c.g, c.b, opacity)
	m.metallic = float(v["metalness"])
	m.roughness = float(v["roughness"])
	m.clearcoat_enabled = float(v["clearcoat"]) > 0.0
	m.clearcoat = float(v["clearcoat"])
	m.clearcoat_roughness = float(v["clearcoatRoughness"])
	m.metallic_specular = clampf(0.5 * float(v["envMapIntensity"]), 0.0, 1.0)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if opacity < 1.0 else int(v.get("transparency", BaseMaterial3D.TRANSPARENCY_DISABLED))


## The overrides on every mesh under root: a copy of the material per car, made from the model's material.
static func apply_overrides(root: Node, overrides: Dictionary) -> void:
	var copies := {}
	for n in _meshes(root):
		var mi := n as MeshInstance3D
		for i in mi.mesh.get_surface_count():
			var base := mi.mesh.surface_get_material(i) as BaseMaterial3D
			var cur := mi.get_surface_override_material(i)
			if base == null or (cur != null and not cur.has_meta("car_paint")):
				continue                     # (no material, or one that someone else set)
			var m: BaseMaterial3D = base
			var o: Variant = overrides.get(base.resource_name)
			if o is Dictionary and not (o as Dictionary).is_empty():
				if not copies.has(base):
					var own := base.duplicate() as BaseMaterial3D
					own.resource_name = base.resource_name
					own.set_meta("original", base.get_meta("original") if base.has_meta("original") else values_of(base))
					own.set_meta("car_paint", true)
					apply_override(own, o)
					copies[base] = own
				m = copies[base]
			mi.set_surface_override_material(i, null if m == base else m)


# ---- the paint of car.json "colors"

## Paints the body (materials called carpaint) and the rims (rimpaint) under root; colors as colors_of gives them ({}:
## the materials as they are without paint). body_fallback: a model without carpaint has its material called body
## painted (the karts, for the AI colours). Returns the number of surfaces painted.
static func paint(root: Node, colors: Dictionary, body_fallback := false) -> int:
	var body_re := RegEx.create_from_string("(?i)car[ _-]?paint")
	if body_fallback and not _has_material(root, body_re):
		body_re = RegEx.create_from_string("(?i)^body$")
	var rim_re := RegEx.create_from_string("(?i)rim[ _-]?paint")
	var styled := {}
	var count := 0
	for n in _meshes(root):
		var mi := n as MeshInstance3D
		for i in mi.mesh.get_surface_count():
			var base := mi.mesh.surface_get_material(i)
			var cur := mi.get_surface_override_material(i)
			var under: Material = cur.get_meta("paint_base") if cur != null and cur.has_meta("paint_base") else (cur if cur != null else base)
			var m := under as BaseMaterial3D
			if m == null:
				continue
			var kind := "rim" if rim_re.search(m.resource_name) != null else ("body" if body_re.search(m.resource_name) != null else "")
			var wanted := kind != "" and (colors.get(kind) != null or str(colors.get(kind + "Finish", "")) != "")
			if not wanted:
				if cur != null and cur.has_meta("paint_base"):
					mi.set_surface_override_material(i, null if under == base else under)
				continue
			var key := "%d/%s" % [m.get_instance_id(), kind]
			if not styled.has(key):
				var s := style(m, colors.get(kind), str(colors.get(kind + "Finish", "")), float(colors.get(kind + "Flake", 100.0)),
					str(colors.get(kind + "Pattern", "noise")), str(colors.get(kind + "Uv", "model")))
				s.set_meta("paint_base", m)
				s.set_meta("car_paint", true)
				styled[key] = s
			mi.set_surface_override_material(i, styled[key])
			count += 1
	return count


## A material with a colour (or null: the colour of the model) and a finish ("": the finish of the model).
static func style(m: BaseMaterial3D, colour: Variant, finish: String, flake := 100.0, pattern := "noise", uv := "model") -> BaseMaterial3D:
	var own := m.duplicate() as BaseMaterial3D
	own.resource_name = m.resource_name
	if colour is Color:
		var c: Color = colour
		own.albedo_color = Color(c.r, c.g, c.b, m.albedo_color.a)
		own.albedo_texture = null
	if not FINISHES.has(finish):
		return own
	var f: Array = FINISHES[finish]
	own.roughness = f[0]
	own.metallic = f[1]
	own.clearcoat_enabled = f[2] > 0.0
	own.clearcoat = f[2]
	own.clearcoat_roughness = f[3]
	own.roughness_texture = null           # (the finish decides, not the maps of the model)
	own.metallic_texture = null
	own.metallic_specular = 0.6
	if finish == "pearl":
		# (Godot has no thin-film iridescence: a rim of light at grazing angles, half in the colour, stands in for it)
		own.rim_enabled = true
		own.rim = 0.55
		own.rim_tint = 0.35
	if finish == "flake":
		if not PATTERNS.has(pattern):
			pattern = "noise"
		var size := clampf(flake if flake > 0.0 else 100.0, 2.0, 400.0)
		own.normal_enabled = true
		own.normal_texture = flakes(pattern)
		if uv == "generated":
			own.uv1_triplanar = true
			own.uv1_world_triplanar = false
			own.uv1_triplanar_sharpness = 4.0
			own.uv1_scale = Vector3.ONE * float(TILES_PER_METRE[pattern]) * 100.0 / size
			own.normal_scale = minf(1.0, float(PATTERN_SCALE[pattern]) * 1.3)
		else:
			var rep := (4.0 if pattern == "marble" else (6.0 if pattern == "voronoi" or pattern == "hexagons" else 64.0)) * 100.0 / size
			own.uv1_scale = Vector3(rep, rep, 1.0)
			own.normal_scale = float(PATTERN_SCALE[pattern])
	return own


static func _meshes(root: Node) -> Array:
	var out := []
	var list: Array[Node] = root.find_children("*", "MeshInstance3D", true, false)
	if root is MeshInstance3D:
		list.append(root)
	for n in list:
		if (n as MeshInstance3D).mesh != null:
			out.append(n)
	return out


static func _has_material(root: Node, re: RegEx) -> bool:
	for n in _meshes(root):
		var mi := n as MeshInstance3D
		for i in mi.mesh.get_surface_count():
			var mat := mi.mesh.surface_get_material(i)
			if mat != null and re.search(mat.resource_name) != null:
				return true
	return false


# ---- the patterns of metal flake: a normal map, a tile that repeats

## The normal map of a pattern (made the first time).
static func flakes(pattern: String) -> ImageTexture:
	if not PATTERNS.has(pattern):
		pattern = "noise"
	if not _patterns.has(pattern):
		var rng := RandomNumberGenerator.new()
		rng.seed = hash(pattern)
		var data: PackedByteArray
		match pattern:
			"voronoi":
				var pts: Array[Vector2] = []
				for i in 44:
					pts.append(Vector2(rng.randf() * PATTERN_SIZE, rng.randf() * PATTERN_SIZE))
				data = _cells(pts, 3.0, rng)
			"hexagons":
				var hp: Array[Vector2] = []
				var cols := 8
				var rows := 10
				for r in rows:
					for c in cols:
						hp.append(Vector2((c + (r % 2) * 0.5) * PATTERN_SIZE / cols + PATTERN_SIZE / cols / 4.0, (r + 0.5) * PATTERN_SIZE / rows))
				data = _cells(hp, 2.5, rng)
			"marble":
				data = _marble(rng)
			_:
				data = _noise(rng)
		var img := Image.create_from_data(PATTERN_SIZE, PATTERN_SIZE, false, Image.FORMAT_RGBA8, data)
		img.generate_mipmaps()
		_patterns[pattern] = ImageTexture.create_from_image(img)
	return _patterns[pattern]


static func _tilt(data: PackedByteArray, i: int, a: float, tilt: float) -> void:
	data[i * 4] = clampi(roundi(128.0 + cos(a) * 127.0 * tilt), 0, 255)
	data[i * 4 + 1] = clampi(roundi(128.0 + sin(a) * 127.0 * tilt), 0, 255)
	data[i * 4 + 2] = 255
	data[i * 4 + 3] = 255


## Tiny mirrors: a random tilt per pixel (most of the flakes tilt, a few lie flat).
static func _noise(rng: RandomNumberGenerator) -> PackedByteArray:
	var data := PackedByteArray()
	data.resize(PATTERN_SIZE * PATTERN_SIZE * 4)
	for i in PATTERN_SIZE * PATTERN_SIZE:
		_tilt(data, i, rng.randf() * TAU, pow(rng.randf(), 0.6))
	return data


## Cells: every pixel takes the tilt of the nearest point (on a torus: the tile repeats), with a ridge of the width edge
## along the border of two cells. The points are put in a grid of buckets, and a pixel looks at the buckets around it.
static func _cells(points: Array[Vector2], edge: float, rng: RandomNumberGenerator) -> PackedByteArray:
	var size := PATTERN_SIZE
	var data := PackedByteArray()
	data.resize(size * size * 4)
	var tilts := []
	for p in points:
		tilts.append(Vector2(rng.randf() * TAU, 0.35 + 0.65 * rng.randf()))
	var g := 8
	var cell := float(size) / g
	var buckets := []
	buckets.resize(g * g)
	for b in g * g:
		buckets[b] = PackedInt32Array()
	for k in points.size():
		var bx := int(points[k].x / cell) % g
		var by := int(points[k].y / cell) % g
		(buckets[by * g + bx] as PackedInt32Array).append(k)
	var half := size / 2.0
	for y in size:
		var cy := int(y / cell)
		for x in size:
			var cx := int(x / cell)
			var best := 1e9
			var second := 1e9
			var which := 0
			for oy in range(-2, 3):
				for ox in range(-2, 3):
					for k in buckets[((cy + oy + g) % g) * g + (cx + ox + g) % g]:
						var dx := absf(x - points[k].x)
						var dy := absf(y - points[k].y)
						if dx > half:
							dx = size - dx
						if dy > half:
							dy = size - dy
						var d := dx * dx + dy * dy
						if d < best:
							second = best
							best = d
							which = k
						elif d < second:
							second = d
			var gap := sqrt(second) - sqrt(best)
			var t: Vector2 = tilts[which]
			if gap < edge:
				_tilt(data, y * size + x, t.x + PI, 0.8 * (1.0 - gap / edge) + 0.2)      # the ridge leans away from the cell
			else:
				_tilt(data, y * size + x, t.x, t.y)
	return data


## Veins: a height made of sine waves bent by noise, its slope the normal.
static func _marble(rng: RandomNumberGenerator) -> PackedByteArray:
	var size := PATTERN_SIZE
	var n1 := _lattice(rng, 6)
	var n2 := _lattice(rng, 12)
	var n3 := _lattice(rng, 24)
	var height := PackedFloat32Array()
	height.resize(size * size)
	for y in size:
		for x in size:
			var u := float(x) / size
			var v := float(y) / size
			var turb := _value_noise(n1, 6, u, v) + _value_noise(n2, 12, u, v) * 0.5 + _value_noise(n3, 24, u, v) * 0.25
			height[y * size + x] = sin((u * 3.0 + v * 2.0) * TAU + turb * 9.0)       # (3 and 2 whole waves over the tile: it repeats)
	var data := PackedByteArray()
	data.resize(size * size * 4)
	for y in size:
		for x in size:
			var gx := height[y * size + (x + 1) % size] - height[y * size + (x + size - 1) % size]
			var gy := height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x]
			var l := sqrt(gx * 3.0 * gx * 3.0 + gy * 3.0 * gy * 3.0 + 1.0)
			var p := (y * size + x) * 4
			data[p] = clampi(roundi(128.0 - gx * 3.0 / l * 127.0), 0, 255)
			data[p + 1] = clampi(roundi(128.0 - gy * 3.0 / l * 127.0), 0, 255)
			data[p + 2] = clampi(roundi(128.0 + 127.0 / l), 0, 255)
			data[p + 3] = 255
	return data


static func _lattice(rng: RandomNumberGenerator, cells: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(cells * cells)
	for i in cells * cells:
		out[i] = rng.randf()
	return out


## Smooth value noise that repeats over the tile (u, v in 0..1).
static func _value_noise(lattice: PackedFloat32Array, cells: int, u: float, v: float) -> float:
	var fx := u * cells
	var fy := v * cells
	var ix := int(floor(fx))
	var iy := int(floor(fy))
	var tx := fx - ix
	var ty := fy - iy
	tx = tx * tx * (3.0 - 2.0 * tx)
	ty = ty * ty * (3.0 - 2.0 * ty)
	var a := lattice[(ix % cells) * cells + iy % cells]
	var b := lattice[((ix + 1) % cells) * cells + iy % cells]
	var c := lattice[(ix % cells) * cells + (iy + 1) % cells]
	var d := lattice[((ix + 1) % cells) * cells + (iy + 1) % cells]
	return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
