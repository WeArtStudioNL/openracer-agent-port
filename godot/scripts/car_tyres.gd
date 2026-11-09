extends RefCounted
## The tyre of a wheel of the model, for the tread and the size that are chosen. A model can bring its tyres as loose objects: tyre_road, tyre_slick,
## tyre_allterrain, tyre_knobbly (one of each, made as the left tyre with its origin in the middle and its axle along x; tyre_knobbly_rear or
## tyre_knobbly_FR for one that is only for an axle or a corner). They are hidden; the one of the tread is shaped to the wheel and shown in the place of
## its tyre. A tyre of a size that is given (wheels.library.<axle>.custom: diameter, inner_ratio, width) is shaped to it, and its rim with it.

const BANDS := ["road", "slick", "allterrain", "knobbly"]

var exemplars := {}                 # clean name (knobbly, knobblyrear, knobblyfr) -> { mesh, basis, centre, dims }
var wheels := {}                    # slot -> { tyre, orig, frame, centre, dims, rims, key }


static func exemplar_name(raw: String) -> String:
	var m := RegEx.create_from_string("^tyre(road|slick|allterrain|knobbly)(fl|fr|rl|rr|front|rear)?[0-9]*$").search(SuspensionRig.clean(raw))
	return "" if m == null else m.get_string(1) + m.get_string(2)


static func band_of(tread: float, rubber: float) -> String:
	if tread >= 75.0:
		return "knobbly"
	if tread >= 25.0:
		return "allterrain"
	return "slick" if rubber >= 75.0 else "road"


func collect(root: Node3D) -> void:
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var key := exemplar_name(str(n.name))
		var mi := n as MeshInstance3D
		if key == "" or mi.mesh == null:
			continue
		var b := CarModel.relative(mi, root).basis
		exemplars[key] = {"mesh": mi.mesh, "basis": b, "dims": _dims(mi.mesh, b)}


## The size of a mesh round its axle (x): { centre, outer, inner, width } in the frame that the basis goes to.
static func _dims(mesh: Mesh, b: Basis) -> Dictionary:
	var lo := Vector3(INF, INF, INF)
	var hi := -lo
	var pts: Array[PackedVector3Array] = []
	for s in mesh.get_surface_count():
		var vs: PackedVector3Array = mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX]
		pts.append(vs)
		for v in vs:
			var p := b * v
			lo = Vector3(minf(lo.x, p.x), minf(lo.y, p.y), minf(lo.z, p.z))
			hi = Vector3(maxf(hi.x, p.x), maxf(hi.y, p.y), maxf(hi.z, p.z))
	var c := (lo + hi) / 2.0
	var outer := 0.0
	var inner := INF
	for vs in pts:
		for v in vs:
			var p := b * v - c
			var r := Vector2(p.y, p.z).length()
			outer = maxf(outer, r)
			inner = minf(inner, r)
	return {"centre": c, "outer": outer, "inner": minf(inner, outer * 0.95), "width": maxf(1e-3, hi.x - lo.x)}


## The parts of the wheel of a corner: the biggest mesh is the tyre (never a rim or a brake), what is called a rim goes with its size. Without a tyre
## of its own (a model that has only loose tyres) a tyre is made round the rim, of this radius.
func add_wheel(slot: String, parts: Array, frame: Node3D, radius: float) -> void:
	var tyre: MeshInstance3D = null
	var best := 0.0
	var meshes: Array[MeshInstance3D] = []
	var rim_re := RegEx.create_from_string("(?i)rim|felg|velg")
	var not_tyre := RegEx.create_from_string("(?i)rim|felg|velg|disc|disk|rotor|brake|caliper|hub")
	var rims := []
	for part: Node3D in parts:
		if not is_instance_valid(part):
			continue
		if part is MeshInstance3D:
			meshes.append(part)
		for c in part.find_children("*", "MeshInstance3D", true, false):
			meshes.append(c)
		if rim_re.search(str(part.name)) != null:
			rims.append({"node": part, "rel": CarModel.relative(part, frame)})
	for mi in meshes:
		if mi.mesh == null or not mi.mesh is ArrayMesh or not_tyre.search(str(mi.name)) != null:
			continue
		var size := CarModel.bounds(mi, frame).size
		if maxf(size.y, size.z) > best:
			best = maxf(size.y, size.z)
			tyre = mi
	var made := false
	if tyre == null:
		if rims.is_empty() or radius <= 0.0:
			return
		var box := CarModel.bounds(rims[0]["node"], frame)
		for e: Dictionary in rims:
			box = box.merge(CarModel.bounds(e["node"], frame))
		var rim_r := maxf(box.size.y, box.size.z) / 2.0
		tyre = MeshInstance3D.new()
		tyre.name = "tyre-made-" + slot
		tyre.mesh = CarModel.tyre_mesh(radius, clampf(rim_r, radius * 0.3, radius * 0.95), maxf(0.05, box.size.x))
		frame.add_child(tyre)
		tyre.position = box.get_center()
		made = true
	var rel := CarModel.relative(tyre, frame)
	var d := _dims(tyre.mesh, rel.basis)
	d["centre"] = rel.origin + (d["centre"] as Vector3)
	wheels[slot] = {"tyre": tyre, "orig": tyre.mesh, "frame": frame, "dims": d, "rims": rims, "key": "", "made": made}


## Every wheel as the configuration says (only what has changed is made again).
func apply(cfg: Dictionary) -> void:
	var v := Tuning.values_of(cfg)
	for slot: String in wheels:
		var w: Dictionary = wheels[slot]
		if not is_instance_valid(w["tyre"]):
			continue
		var axle := "front" if slot[0] == "F" else "rear"
		var band := band_of(float(v.get("tread_" + axle, 0.0)), float(v.get("rubber_" + axle, 50.0)))
		var ex: Variant = _exemplar(band, slot, axle, bool(w["made"]))
		var custom: Variant = Tuning.read(cfg, "wheels.library.%s.custom" % axle)
		var sized: bool = custom is Dictionary and str(Tuning.read(cfg, "wheels.library.%s.tyre" % axle)) == "custom" and float(custom.get("diameter", 0.0)) > 0.0
		var d0: Dictionary = w["dims"]
		var target := {"outer": float(d0["outer"]), "inner": float(d0["inner"]), "width": float(d0["width"])}
		if sized:
			target["outer"] = float(custom["diameter"]) / 2.0
			target["inner"] = target["outer"] * clampf(float(custom.get("inner_ratio", 0.65)), 0.2, 0.95)
			if float(custom.get("width", 0.0)) > 0.0:
				target["width"] = float(custom["width"])
		var key := "%s/%s/%s" % [(ex[1] if ex != null else ""), sized, target]
		if key == w["key"]:
			continue
		w["key"] = key
		_shape(w, ex, target, slot)
		_fit_rims(w, target, sized)


## The tyre of a band for a corner; a wheel that has no tyre of its own takes the nearest one that the model has.
func _exemplar(band: String, slot: String, axle: String, any: bool) -> Variant:
	var order: Array = [band]
	if any:
		order = {"road": ["road", "slick", "allterrain", "knobbly"], "slick": ["slick", "road", "allterrain", "knobbly"],
			"allterrain": ["allterrain", "road", "knobbly", "slick"], "knobbly": ["knobbly", "allterrain", "road", "slick"]}[band]
	for b: String in order:
		for k in [b + slot.to_lower(), b + axle, b]:
			if exemplars.has(k):
				return [exemplars[k], k]
	return null


func _shape(w: Dictionary, ex: Variant, target: Dictionary, slot: String) -> void:
	var tyre: MeshInstance3D = w["tyre"]
	var d0: Dictionary = w["dims"]
	var same: bool = is_equal_approx(float(target["outer"]), float(d0["outer"])) and is_equal_approx(float(target["inner"]), float(d0["inner"])) and is_equal_approx(float(target["width"]), float(d0["width"]))
	if ex == null and same:
		tyre.mesh = w["orig"]
		return
	var rel := CarModel.relative(tyre, w["frame"])
	var src: Dictionary = {"mesh": w["orig"], "basis": rel.basis, "dims": _dims(w["orig"], rel.basis)}
	var mirror := false
	if ex != null:
		src = ex[0]
		mirror = slot[1] == "R" and not (ex[1] as String).ends_with(slot.to_lower())
	tyre.mesh = _made(src, target, rel.basis, (rel.affine_inverse() * (d0["centre"] as Vector3)), mirror)


## A mesh of the tyre: the source round its middle, mirrored for the other side, its radii and its width as asked, in the frame of the part.
static func _made(src: Dictionary, target: Dictionary, to_part: Basis, centre: Vector3, mirror: bool) -> ArrayMesh:
	var b: Basis = src["basis"]
	var dims: Dictionary = src["dims"]
	var c: Vector3 = dims["centre"]
	var back := to_part.inverse()
	var n_in := b.inverse().transposed()
	var n_out := to_part.transposed()
	var kx := float(target["width"]) / float(dims["width"])
	var r0 := float(dims["inner"])
	var r1 := maxf(r0 + 1e-4, float(dims["outer"]))
	var out := ArrayMesh.new()
	var mesh: Mesh = src["mesh"]
	for s in mesh.get_surface_count():
		var a: Array = mesh.surface_get_arrays(s)
		var vs: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		var ns: PackedVector3Array = a[Mesh.ARRAY_NORMAL] if a[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
		for i in vs.size():
			var p := b * vs[i] - c
			var r := Vector2(p.y, p.z).length()
			if r > 1e-6:
				var at := clampf((r - r0) / (r1 - r0), 0.0, 1.0)
				var k := lerpf(float(target["inner"]), float(target["outer"]), at) / r
				p.y *= k
				p.z *= k
			p.x *= kx * (-1.0 if mirror else 1.0)
			vs[i] = back * p + centre
			if i < ns.size():
				var n := (n_in * ns[i]).normalized()
				if mirror:
					n.x = -n.x
				ns[i] = (n_out * n).normalized()
		a[Mesh.ARRAY_VERTEX] = vs
		if not ns.is_empty():
			a[Mesh.ARRAY_NORMAL] = ns
		a[Mesh.ARRAY_TANGENT] = null
		if mirror:
			var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX] if a[Mesh.ARRAY_INDEX] != null else PackedInt32Array(range(vs.size()))
			for i in range(0, idx.size() - 2, 3):
				var t := idx[i + 1]
				idx[i + 1] = idx[i + 2]
				idx[i + 2] = t
			a[Mesh.ARRAY_INDEX] = idx
		out.add_surface_from_arrays((mesh as ArrayMesh).surface_get_primitive_type(s), a)
		out.surface_set_material(s, mesh.surface_get_material(s))
	return out


func _fit_rims(w: Dictionary, target: Dictionary, sized: bool) -> void:
	var d0: Dictionary = w["dims"]
	var r := float(target["inner"]) / maxf(1e-3, float(d0["inner"])) if sized else 1.0
	var k := float(target["width"]) / float(d0["width"]) if sized else 1.0
	var c: Vector3 = d0["centre"]
	var s := Basis.from_scale(Vector3(k, r, r))
	for e: Dictionary in w["rims"]:
		var node: Node3D = e["node"]
		if not is_instance_valid(node):
			continue
		var rel: Transform3D = e["rel"]
		var now := Transform3D(s * rel.basis, c + s * (rel.origin - c))
		node.transform = CarModel.relative(node.get_parent(), w["frame"]).affine_inverse() * now
