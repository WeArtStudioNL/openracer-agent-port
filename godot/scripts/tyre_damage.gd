class_name TyreDamage
extends RefCounted
## Punctures (Vehicle.js puncture, with car.json tyres.damage and damage on): a hard hit (a kerb, a landing: more
## than five times the static load) punctures a tyre now and then; a leaking tyre loses its pressure (0.05 to 0.15
## bar a second, down to 0.15 bar), and its grip, its sidewall and (a kart) its spring follow.


static func step(car: Car, w: Car.Wheel, dt: float) -> void:
	if car.tyre_damage and w.leak == 0.0 and w.load > 5.0 * car.mass * Car.G / 4.0 and randf() < 0.3:
		puncture(car, car.wheels.find(w))
	if w.leak > 0.0:
		w.pressure_loss = minf(w.pressure - 0.15, w.pressure_loss + w.leak * dt)
		if Engine.get_physics_frames() % 15 == 0:
			apply(car, w)


## The tyre of wheel i leaks (bar a second; 0.05 to 0.15 when not given).
static func puncture(car: Car, i: int, rate := 0.0) -> void:
	var w := car.wheels[i]
	if w.leak == 0.0:
		w.leak = rate if rate > 0.0 else 0.05 + randf() * 0.1
		RunLog.event("puncture: %s, %.2f bar a second" % [["FL", "FR", "RL", "RR"][i], w.leak])


## Whether a tyre leaks.
static func punctured(car: Car) -> bool:
	for w in car.wheels:
		if w.leak > 0.0:
			return true
	return false


static func apply(car: Car, w: Car.Wheel) -> void:
	var p := maxf(0.15, w.pressure - w.pressure_loss)
	car.set_pressure(w, p)
	if car.unsprung:
		w.spring = car.tyre_rate * pow(p / 2.2, 0.8)


## The tyres whole again (a repair).
static func repair(car: Car) -> void:
	for w in car.wheels:
		w.leak = 0.0
		w.pressure_loss = 0.0
		apply(car, w)
