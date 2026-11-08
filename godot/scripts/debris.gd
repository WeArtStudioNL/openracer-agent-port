class_name Debris
extends Node3D
## Small pieces of grass, sand, gravel, mud and earth that a wheel throws up from loose ground (web/js/Debris.js; the water
## and the snow are GroundSpray).
## Next to the dust (TyreEffects, the cloud) these are the bits that fly and fall (Specks): a thin green blade for grass
## (turned along the way it flies, now and then a clod of earth), tiny round grains for sand, angular chunks for gravel,
## clumps for mud and earth.
##
## A wheel on a loose surface (Content.SURFACES "loose") throws them when its tyre slips
## against the ground, the way the tread moves against it: a driven wheel that spins throws them backwards, a wheel
## that slides sideways the way the slide goes. The faster the slip, the more there are and the further they fly. They
## are made along the path of the tyre. The Graphics settings: how many (gfx_debris_rate), how big (gfx_debris_scale),
## the most at once (gfx_debris_max, read when the drive starts).

const SHADES := {
	"grass": [[0.22, 0.46, 0.08], [0.3, 0.56, 0.1], [0.4, 0.62, 0.14], [0.18, 0.38, 0.07], [0.5, 0.6, 0.18], [0.3, 0.5, 0.1]],
	"clod": [[0.32, 0.24, 0.13], [0.26, 0.19, 0.1], [0.4, 0.3, 0.18]],
	"sand": [[0.88, 0.74, 0.52], [0.8, 0.66, 0.44], [0.93, 0.82, 0.62], [0.74, 0.6, 0.4], [0.96, 0.88, 0.72]],
	"gravel": [[0.8, 0.7, 0.54], [0.7, 0.6, 0.45], [0.86, 0.78, 0.62], [0.6, 0.52, 0.4], [0.66, 0.64, 0.6]],
	"mud": [[0.28, 0.2, 0.13], [0.2, 0.14, 0.09], [0.36, 0.26, 0.16]],
	"ground": [[0.55, 0.43, 0.3], [0.46, 0.36, 0.24], [0.62, 0.5, 0.36]],
}
# the shape, the size (m: the length of a blade, the width of the rest), the number made against the rest, how far they fly
const LOOK := {
	"grass": [1, 0.1, 0.2, 1.3, 1.0], "clod": [2, 0.025, 0.05, 1.0, 0.8], "sand": [2, 0.008, 0.02, 3.2, 1.0],
	"gravel": [0, 0.012, 0.03, 2.0, 0.9], "mud": [2, 0.03, 0.07, 0.9, 0.7], "ground": [2, 0.02, 0.045, 1.2, 0.9],
}

var car: Car
var amount := 1.0                   # how many are made (1 normal, 0 none)
var specks: Specks
var _last: Array = [null, null, null, null]
var _carry := [0.0, 0.0, 0.0, 0.0]


static func make(c: Car) -> Debris:
	var d := Debris.new()
	d.name = "Debris"
	d.car = c
	d.add_to_group("clear_at_start")
	d.specks = Specks.new(clampi(int(Settings.get_value("gfx_debris_max")), 100, 20000))
	d.specks.drag = 0.7
	d.add_child(d.specks)
	ReplayFx.attach("debris", c, d)
	return d


func _process(delta: float) -> void:
	delta = minf(delta, 0.05)
	if car == null or not is_instance_valid(car) or delta <= 0.0 or get_tree().paused or ReplayFx.active:
		return
	amount = maxf(0.0, float(Settings.get_value("gfx_debris_rate")))
	var size_scale := maxf(0.0, float(Settings.get_value("gfx_debris_scale")))
	specks.set_look(1.0, size_scale)
	for wi in 4:
		var w := car.wheels[wi]
		var loose: bool = Content.surface(w.surface).get("loose", false)
		if amount <= 0.0 or size_scale <= 0.0 or not w.contact or not loose:
			_last[wi] = null
			continue
		var fwd := Vector3(w.fp.x, 0.0, w.fp.z)
		if fwd.length_squared() < 1e-6:
			_last[wi] = null
			continue
		fwd = fwd.normalized()
		var lft := Vector3(fwd.z, 0.0, -fwd.x)
		var along := w.forward_speed - w.omega * w.radius          # (the tread against the ground: negative is backwards)
		var across := w.slip_tan * maxf(absf(w.forward_speed), 1.5)
		var slip := Vector2(along, across).length()
		if slip < 1.2:
			_last[wi] = null
			continue
		var strength := minf(1.0, (slip - 1.0) / 6.0)
		var main := w.surface if SHADES.has(w.surface) else "ground"
		_carry[wi] += (70.0 + 330.0 * strength) * float(LOOK[main][3]) * amount * delta
		var count := mini(ceili(120.0 * maxf(1.0, amount)), floori(_carry[wi]))
		_carry[wi] = minf(_carry[wi] - count, 1.0)
		var c := w.point
		var from: Vector3 = _last[wi] if _last[wi] != null else c
		if Vector2(c.x - from.x, c.z - from.z).length() > 5.0:
			from = c
		# the direction of the throw: the way the tread moves against the ground (w.lf is the left of the tyre)
		var d := (fwd * along + w.lf * across) / slip
		d = Vector3(d.x, 0.0, d.z)
		var speed := minf(11.0, 1.5 + slip * 0.9)
		for n in count:
			var kind := "clod" if main == "grass" and randf() < 0.12 else main
			var look: Array = LOOK[kind]
			var f := (n + randf()) / maxf(1.0, count)
			var r := d.rotated(Vector3.UP, (randf() - 0.5) * 0.9)
			var v := speed * float(look[4]) * (0.35 + randf() * 0.75)
			var shades: Array = SHADES[kind]
			var sc: Array = shades[randi() % shades.size()]
			var at := from.lerp(c, f) + Vector3((randf() - 0.5) * 0.12, 0.03, (randf() - 0.5) * 0.12)
			var vel := r * v + car.linear_velocity * 0.5 + Vector3.UP * (1.4 + randf() * (1.5 + strength * 3.2))
			var col := Color(sc[0], sc[1], sc[2]).srgb_to_linear()
			var size := float(look[1]) + randf() * (float(look[2]) - float(look[1]))
			var tilt := (randf() - 0.5) * 1.2
			var life := 0.7 + randf() * 0.9
			specks.add(at, vel, col, size, int(look[0]), tilt, life, at.y - 0.02)
			ReplayFx.add("debris", car, [0.0, at.x, at.y, at.z, vel.x, vel.y, vel.z, col.r, col.g, col.b, size, look[0], tilt, life, at.y - 0.02])
		_last[wi] = c
	specks.step(delta)


## All gone (the car is put back at the start).
func clear() -> void:
	specks.clear()
	_last = [null, null, null, null]


# ---- the replay (ReplayFx: the rows are the pieces as they were thrown)

func replay_lookback(_kind: String) -> float:
	return 8.0


func replay_add(_kind: String, r: Array) -> void:
	specks.add(Vector3(r[1], r[2], r[3]), Vector3(r[4], r[5], r[6]), Color(r[7], r[8], r[9]), r[10], int(r[11]), r[12], r[13], r[14])


func replay_step(_kind: String, dt: float) -> void:
	specks.step(dt)


func replay_clear(_kind: String) -> void:
	specks.clear()


func replay_snapshot(_kind: String) -> Variant:
	return specks.snapshot()


func replay_restore(_kind: String, snap: Variant) -> void:
	specks.restore(snap)
	_last = [null, null, null, null]
