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
	w.squeal = smoothstep(1.0, 2.0, w.s) * (1.0 - 0.4 * smoothstep(2.5, 4.0, w.s)) * smoothstep(0.8, 5.0, slide_speed)
	w.mark = smoothstep(1.1, 2.0, w.s) * smoothstep(1.0, 4.0, slide_speed)


## The temperature and the wear of a tyre (wearStep of Vehicle.js): the power that the slip burns and the flexing
## under the load heat it, the air cools it; outside its window it grips less; it wears with the slip, faster when
## it is too hot. Off (Settings "tyre_wear" 0): the tyre is at its best temperature and does not wear.
static func wear_step(w: Car.Wheel, dt: float) -> void:
	var k := w.kind
	var scale := float(Settings.get_value("tyre_wear"))
	if scale <= 0.0:
		w.temp = float(k.get("optimum", 85))
		w.condition = w.pressure_grip
		return
	var spin := w.omega * w.radius - w.forward_speed
	var slide_power := (absf(w.fx * spin) + absf(w.fy * w.side_speed)) if w.contact else 0.0
	var heat_in := (slide_power + (w.load * absf(w.forward_speed) * 0.025 if w.contact else 0.0)) * float(k.get("heating", 1.0)) * w.pressure_roll
	var size := clampf(pow(w.radius / 0.315, 3.0), 0.04, 2.5)
	var cooling := (40.0 + 3.0 * absf(w.forward_speed)) * size * (w.temp - 25.0)
	w.temp += (heat_in - cooling) / (20000.0 * size) * dt
	var optimum := float(k.get("optimum", 85))
	var window := float(k.get("window", 15))
	var overheated := clampf((w.temp - (optimum + window)) / 30.0, 0.0, 2.0)
	var counted := slide_power * 0.35 if absf(w.forward_speed) < 8.0 else slide_power
	w.wear += counted * (1.0 + 2.0 * overheated) * dt / (4.8e7 * float(k.get("life", 1.0))) * scale
	var off := maxf(0.0, absf(w.temp - optimum) - window) / float(k.get("cold", 45))
	var by_temp := 1.0 - float(k.get("coldLoss", 0.22)) * minf(1.0, off)
	var by_wear := 1.0 - 0.2 * pow(minf(1.0, w.wear), 1.5) - (0.15 if w.wear >= 1.0 else 0.0)
	w.condition = by_temp * by_wear * w.pressure_grip
