class_name CarWear
extends RefCounted
## What the slip does to the tyres of a car (web/js/Vehicle.js): the squeal, the smoke and the marks, and the
## temperature and the wear. (Out of car.gd, which has a limit to its length.)

## Squeal, smoke and marks (web/js/Vehicle.js): the power that the slip burns heats the surface of the tread; from
## about 220 C it smokes. A tyre that spins throws a thick cloud, one that is locked or slides sideways smokes
## thinner and leaves more of a mark. On loose ground it throws up dust instead.
static func tyre_effects(w: Car.Wheel, dt: float) -> void:
	const AMBIENT := 25.0
	if not w.contact or w.load < 200.0:
		w.squeal = 0.0
		w.smoke = maxf(0.0, w.smoke - dt * 2.0)
		w.mark = 0.0
		w.surf_t = maxf(AMBIENT, w.surf_t - (w.surf_t - AMBIENT) * dt / 6.0)
		return
	var spin := w.omega * w.radius - w.forward_speed
	var slide_speed := sqrt(spin * spin + w.side_speed * w.side_speed)
	var burnt := absf(w.fx * spin) + absf(w.fy * w.side_speed)
	var strip := absf(w.forward_speed) / 0.15 + 0.15
	w.road_t = clampf(w.road_t + ((0.7 * burnt / 2500.0) - (w.road_t - AMBIENT) * strip) * dt, AMBIENT, 300.0)
	var spin_hot := smoothstep(4.0, 14.0, spin) * (1.0 - smoothstep(1.0, 3.0, absf(w.forward_speed)))
	var share := 0.3 + 0.3 * minf(1.0, (w.road_t - AMBIENT) / 150.0) + 0.3 * spin_hot
	w.surf_t = clampf(w.surf_t + (share * burnt / 350.0 - (w.surf_t - AMBIENT) / 6.0) * dt, AMBIENT, 330.0)
	var surf := Content.surface(w.surface)
	var sliding := smoothstep(1.2, 2.2, w.s) * smoothstep(1.5, 6.0, slide_speed)
	if surf.get("loose", false):
		var rolling_dust := minf(0.28, maxf(0.0, (absf(w.forward_speed) - 5.0) / 40.0))
		w.smoke = maxf(minf(1.0, 0.15 + 0.85 * sliding) * sliding, rolling_dust)
		w.squeal = 0.0
		w.mark = sliding * 0.6
		return
	var spin_share := clampf(maxf(0.0, spin) / maxf(2.0, slide_speed), 0.0, 1.0)
	var smoking := 0.12 * smoothstep(180.0, 220.0, w.surf_t) + 0.88 * smoothstep(220.0, 260.0, w.surf_t)
	w.smoke = smoking * (0.4 + 0.6 * minf(1.0, burnt / 40000.0)) * (0.3 + 0.7 * spin_share)
	# (a road that is drawn as dirt or gravel does not squeal: CarAudio plays the noise of that ground)
	w.squeal = smoothstep(1.0, 2.0, w.s) * (1.0 - 0.4 * smoothstep(2.5, 4.0, w.s)) * smoothstep(0.8, 5.0, slide_speed)
	if Ground.sound_surface(w.surface) != w.surface:
		w.squeal = 0.0
	w.mark = smoothstep(1.1, 2.0, w.s) * smoothstep(1.0, 4.0, slide_speed)


## The temperature and the wear of a tyre (wearStep of Vehicle.js): the power that the slip burns and the flexing
## under the load heat it, the air cools it; outside its window it grips less; it wears with the slip, faster when
## it is too hot. Off (Settings "tyre_wear" 0): the tyre is at its best temperature and does not wear.
static func wear_step(w: Car.Wheel, dt: float, heating := 1.0, life := 1.0) -> void:
	var k := w.kind
	var scale := float(Settings.get_value("tyre_wear"))
	if scale <= 0.0:
		w.temp = float(k.get("optimum", 85))
		w.condition = w.pressure_grip
		return
	var spin := w.omega * w.radius - w.forward_speed
	var slide_power := (absf(w.fx * spin) + absf(w.fy * w.side_speed)) if w.contact else 0.0
	var heat_in := (slide_power + (w.load * absf(w.forward_speed) * 0.025 if w.contact else 0.0)) * heating * float(k.get("heating", 1.0)) * w.pressure_roll
	var loose: bool = w.contact and Content.SURFACES.get(w.surface, {}).get("loose", false)
	if loose:
		heat_in *= 0.4                  # (the ground gives way and moves: a tyre does not rub on it as on a road, and the ground takes the heat away)
	var size := clampf(pow(w.radius / 0.315, 3.0), 0.04, 2.5)
	var cooling := (40.0 + 3.0 * absf(w.forward_speed)) * size * (w.temp - 25.0) * (1.5 if loose else 1.0)
	w.temp += (heat_in - cooling) / (20000.0 * size) * dt
	var optimum := float(k.get("optimum", 85))
	var window := float(k.get("window", 15))
	var overheated := clampf((w.temp - (optimum + window)) / 30.0, 0.0, 2.0)
	var counted := slide_power * 0.35 if absf(w.forward_speed) < 8.0 else slide_power
	w.wear += counted * (1.0 + 2.0 * overheated) * dt / (4.8e7 * life * float(k.get("life", 1.0))) * scale
	var cold := maxf(0.0, optimum - window - w.temp) / float(k.get("cold", 45))
	var by_temp := 1.0 - float(k.get("coldLoss", 0.22)) * minf(1.0, cold)
	# (too hot: the most at 120 C; on loose ground only what a soft tread costs)
	var hi := optimum + window
	var hot := smoothstep(hi, maxf(hi + 10.0, 120.0), w.temp) * float(k.get("hotLoss", 0.45)) * (float(k.get("looseHot", 0.7)) if loose else 1.0)
	by_temp *= 1.0 - hot
	var by_wear := 1.0 - 0.2 * pow(minf(1.0, w.wear), 1.5) - (0.15 if w.wear >= 1.0 else 0.0)
	w.condition = by_temp * by_wear * w.pressure_grip


## The rolling resistance of a tyre (Vehicle.js): a force against the travel at the contact (N), by the kind of tyre,
## its pressure and the ground (its drag, or four times on a soft ground without one: grass). vl: the speed along it.
static func rolling_force(c: Car, w: Car.Wheel, vl := INF) -> float:
	var surf := Ground.surface(w.surface, w.local_snow, w.local_water)
	var loose_roll := float(w.kind.get("looseRolling", 1.0)) if surf.get("loose", false) else 1.0
	var ground := float(surf["drag"]) * loose_roll if surf.has("drag") else (4.0 * loose_roll if float(surf["static"]) < 0.8 else 1.0)
	var speed := w.forward_speed if vl == INF else vl
	return c.rolling * float(w.kind.get("rolling", 1.0)) * w.pressure_roll * ground * w.load * tanh(speed / 0.3)


## The magic formula of Wheel.js (tyreForce): the slip along and across in units of the slip at the peak gives
## how far the tyre is towards its limit; the curve gives the share of the peak force, which is the friction
## times the load, in the direction of the slip.
static func tyre_force(w: Car.Wheel, load: float, surf: Dictionary, vref: float, cornering: float) -> void:
	# the grip of the surface, the tyre (its kind, its grip of car.json), its condition (temperature, wear, pressure)
	var loose: bool = surf.get("loose", false)
	var grip := float(surf["static"]) * w.grip * w.condition * w.damage_grip * float(w.kind.get("grip", 1.0)) * (float(w.kind.get("looseGrip", 1.0)) if loose else 1.0)
	var mu := clampf(grip - 0.00007 * (load * 0.1 - 3500.0), 0.2 * grip, 1.4 * grip)
	var spin_slide := w.omega * w.radius - w.forward_speed
	var melt := smoothstep(4.0, 14.0, spin_slide)
	var ratio := float(surf["kinetic"]) / float(surf["static"])
	if loose and float(w.kind.get("looseSlide", 0.0)) > ratio:
		ratio = float(w.kind["looseSlide"])            # (a knobbly tyre that slides keeps its grip)
	var sliding_ratio := minf(0.98, ratio) * (1.0 - 0.45 * melt)
	var c := 2.0 - (2.0 / PI) * asin(sliding_ratio)
	var peak := tan(PI / (2.0 * c))
	var slip_peak := 0.14
	var angle_peak := 0.15 / (cornering * float(w.kind.get("lateral", 1.0)) * w.stiffness_bias * w.pressure_corner)
	var sx := w.slip_ratio / slip_peak
	# the camber: a leaning tyre pushes to the side it leans to, like a little slip angle (camber thrust, Vehicle.js)
	var sy := (w.slip_tan - (0.5 * w.lean + w.camber_slip) * angle_peak / 0.15) / angle_peak
	var s := sqrt(sx * sx + sy * sy)
	w.s = s
	var f := sin(c * atan(peak * s))
	var d := mu * load
	if s > 1e-9:
		w.fx = d * f * sx / s
		w.fy = -d * 1.05 * f * sy / s * w.lat_grip
	else:
		w.fx = 0.0
		w.fy = 0.0
	# how fast the torque of the tyre on the wheel grows with the wheel speed (N m per rad/s), for the implicit step
	# of the wheel: the secant of the curve from no slip to where the tyre is (the steepest slope near no slip),
	# so that one step can bring the wheel to the speed of the road but never past it (with the local slope, a
	# wheel past the peak jumped over the whole curve in one step and the wheels of a heavy four wheel drive rang)
	var secant := d * (f / s if s > 1e-6 else c * peak) / slip_peak
	w.tyre_slope = secant * w.radius * w.radius / vref
