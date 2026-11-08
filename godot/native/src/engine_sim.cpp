// See engine_sim.h. The names and the comments follow web/js/EngineSimWorklet.js and web/js/EngineSim.js, so the
// two can be read side by side.

#include "engine_sim.h"

#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/array.hpp>

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstring>

using namespace godot;

namespace orsound {

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr double R = 8.314462618;                 // J/(mol K)
constexpr double DOF = 5;                         // degrees of freedom of air (a diatomic gas)
constexpr double GAMMA = (DOF + 2) / DOF;
constexpr double ATM = 101325;
constexpr double T_ATM = 298.15;
constexpr double SPEED_OF_SOUND = 343;
constexpr double MOL_PER_SCFM = 0.01997;          // 1 standard cubic foot per minute in mol/s
constexpr double FUEL_PER_AIR = 0.0197;           // mol of fuel per mol of air at stoichiometry
constexpr double FUEL_ENERGY = 4.4e6 * 0.55;      // J per mol of fuel, as it shows as heat of the gas
constexpr double T_WALL = 363.15;                 // the walls of the cylinder, 90 C
constexpr double THOU = 0.0000254, CM2 = 1e-4, CC = 1e-6;
constexpr double ENGINE_SIM_LEVEL = 0.5;          // the loudness at a volume of 1
constexpr double ENGINE_SIM_SIGNAL = 0.14;        // the rms of the signal before the drive

const double C_CHOKED = std::sqrt(GAMMA) * std::pow(2 / (GAMMA + 1), (GAMMA + 1) / (2 * (GAMMA - 1)));
const double R_CRITICAL = std::pow(2 / (GAMMA + 1), GAMMA / (GAMMA - 1));

// a small, fast random generator: 0..1
struct Random {
	uint64_t s = 0x9E3779B97F4A7C15ull;
	double next() {
		s ^= s << 13;
		s ^= s >> 7;
		s ^= s << 17;
		return (s >> 11) * (1.0 / 9007199254740992.0);
	}
};

double num(const Dictionary &d, const char *key, double def) {
	Variant v = d.get(key, def);
	if (v.get_type() == Variant::FLOAT || v.get_type() == Variant::INT) {
		return (double)v;
	}
	return def;
}

// The molar flow (mol/s, for a flow constant of 1) from a gas at p0, T0 into p1 < p0: choked below the critical ratio
double flow_rate(double p0, double T0, double p1) {
	const double r = p1 / p0;
	if (r <= R_CRITICAL) {
		return p0 * C_CHOKED / std::sqrt(R * T0);
	}
	return p0 * std::sqrt((2 * GAMMA / (GAMMA - 1)) * std::pow(r, 2 / GAMMA) * (1 - std::pow(r, (GAMMA - 1) / GAMMA)) / (R * T0));
}

// The flow constant of an opening that is rated at a flow (cfm) at a pressure drop (Pa) from the atmosphere
double flow_constant(double cfm, double drop) {
	if (cfm <= 0) {
		return 0;
	}
	return cfm * MOL_PER_SCFM / flow_rate(ATM, T_ATM, ATM - drop);
}
const double K_CARB = flow_constant(1, 1.5 * 3386.39); // per cfm of a carburettor, rated at 1.5 inHg
const double K_28 = flow_constant(1, 28 * 248.84);     // per cfm of a port on a flow bench, rated at 28 inH2O

// A volume of gas (an amount n in mol, an energy E in J, a volume V in m^3, and its fuel in mol), or, fixed, the air
// outside or the manifold: a gas that does not change when gas flows in or out of it
struct Gas {
	double V = 1e-4, n = 0, E = 0, fuel = 0;
	bool fixed = false;
	double fixed_P = ATM, fixed_T = T_ATM, fuel_fraction = 0;

	static Gas make(double volume, double pressure, double temperature) {
		Gas g;
		g.V = volume;
		g.n = pressure * volume / (R * temperature);
		g.E = DOF / 2 * g.n * R * temperature;
		return g;
	}
	static Gas reservoir(double pressure, double temperature, double fuel_fraction) {
		Gas g;
		g.fixed = true;
		g.fixed_P = pressure;
		g.fixed_T = temperature;
		g.fuel_fraction = fuel_fraction;
		g.n = 1e9;
		return g;
	}
	double P() const { return fixed ? fixed_P : 2 * E / (DOF * V); }
	double T() const { return fixed ? fixed_T : (n > 1e-15 ? 2 * E / (DOF * n * R) : T_ATM); }
	double energy_per_mol() const {
		if (fixed) {
			return DOF / 2 * R * fixed_T;
		}
		return n > 1e-15 ? E / n : DOF / 2 * R * T_ATM;
	}
};

// Moves dn mol from a to b, with the energy and the fuel that go with it
double transfer(Gas &a, Gas &b, double dn) {
	if (dn <= 0) {
		return 0;
	}
	if (!a.fixed) {
		dn = std::min(dn, 0.9 * a.n);
	}
	const double e = a.energy_per_mol();
	const double f = a.fixed ? a.fuel_fraction : (a.n > 1e-15 ? a.fuel / a.n : 0);
	if (!a.fixed) {
		a.n -= dn;
		a.E -= dn * e;
		a.fuel = std::max(0.0, a.fuel - dn * f);
	}
	if (!b.fixed) {
		b.n += dn;
		b.E += dn * e;
		b.fuel += dn * f;
	}
	return dn;
}

// The flow between two volumes through an opening with flow constant k, for a time dt
double flow(Gas &a, Gas &b, double k, double dt) {
	if (k <= 0) {
		return 0;
	}
	const double pa = a.P(), pb = b.P();
	if (pa > pb) {
		return transfer(a, b, k * flow_rate(pa, a.T(), pb) * dt);
	}
	if (pb > pa) {
		return -transfer(b, a, k * flow_rate(pb, b.T(), pa) * dt);
	}
	return 0;
}

// A curve y(x) through points, linear in between
struct Curve {
	std::vector<double> xs, ys;
	double operator()(double x) const {
		if (xs.empty()) {
			return 0;
		}
		if (x <= xs.front()) {
			return ys.front();
		}
		if (x >= xs.back()) {
			return ys.back();
		}
		size_t i = 1;
		while (xs[i] < x) {
			i++;
		}
		const double t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
		return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
	}
};

// The shape of a port flow (cfm at 28 inH2O) against the lift (m), after the heads of engine-sim
Curve port_flow(double peak_cfm, double peak_lift) {
	static const double shape[][2] = { { 0, 0 }, { 50, 25 }, { 100, 75 }, { 150, 100 }, { 200, 130 }, { 250, 180 }, { 300, 190 }, { 350, 220 },
		{ 400, 240 }, { 450, 250 }, { 500, 260 }, { 550, 260 }, { 600, 260 }, { 650, 255 }, { 700, 250 } };
	Curve c;
	for (const auto &p : shape) {
		c.xs.push_back(p[0] * THOU * (peak_lift / (600 * THOU)));
		c.ys.push_back(p[1] * peak_cfm / 260);
	}
	return c;
}

// A cam lobe: the lift (m) against the crank angle (degrees) from the lobe centre: a raised cosine to a power
struct Lobe {
	double lift = 0, gamma = 1, half_width = 1;
	void set(double duration_at_50, double l, double g) {
		lift = l;
		gamma = g;
		const double at50 = std::min(0.9, 50 * THOU / l);
		const double c = 2 * std::pow(at50, 1 / g) - 1;
		half_width = PI * (duration_at_50 / 2) / std::acos(c);
	}
	double operator()(double angle) const {
		const double a = std::fabs(angle);
		if (a >= half_width) {
			return 0;
		}
		return lift * std::pow(0.5 + 0.5 * std::cos(PI * a / half_width), gamma);
	}
};

struct Lowpass {
	double alpha = 1, y = 0;
	void set(double frequency, double rate) {
		const double w = 2 * PI * frequency / rate;
		alpha = w / (w + 1);
	}
	double run(double x) {
		y += alpha * (x - y);
		return y;
	}
};

// A biquad filter (the Butterworth lowpass of the worklet, and the filters of the Web Audio API for the chain)
struct Biquad {
	double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
	double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
	void butterworth(double frequency, double rate) {
		const double w = std::tan(PI * std::min(0.45, frequency / rate));
		const double n = 1 / (1 + std::sqrt(2.0) * w + w * w);
		b0 = w * w * n;
		b1 = 2 * b0;
		b2 = b0;
		a1 = 2 * (w * w - 1) * n;
		a2 = (1 - std::sqrt(2.0) * w + w * w) * n;
	}
	void normalise(double c0, double c1, double c2, double d0, double d1, double d2) {
		b0 = c0 / d0;
		b1 = c1 / d0;
		b2 = c2 / d0;
		a1 = d1 / d0;
		a2 = d2 / d0;
	}
	// Web Audio: the Q of a lowpass is in dB
	void lowpass(double frequency, double q_db, double rate) {
		const double w0 = 2 * PI * std::min(frequency, rate * 0.499) / rate;
		const double alpha = std::sin(w0) / (2 * std::pow(10.0, q_db / 20));
		const double c = std::cos(w0);
		normalise((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
	}
	void lowshelf(double frequency, double gain_db, double rate) {
		const double A = std::pow(10.0, gain_db / 40), w0 = 2 * PI * frequency / rate;
		const double c = std::cos(w0), alpha = std::sin(w0) / 2 * std::sqrt(2.0), s = 2 * std::sqrt(A) * alpha;
		normalise(A * ((A + 1) - (A - 1) * c + s), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - s),
				(A + 1) + (A - 1) * c + s, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - s);
	}
	void highshelf(double frequency, double gain_db, double rate) {
		const double A = std::pow(10.0, gain_db / 40), w0 = 2 * PI * frequency / rate;
		const double c = std::cos(w0), alpha = std::sin(w0) / 2 * std::sqrt(2.0), s = 2 * std::sqrt(A) * alpha;
		normalise(A * ((A + 1) + (A - 1) * c + s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - s),
				(A + 1) - (A - 1) * c + s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - s);
	}
	void peaking(double frequency, double q, double gain_db, double rate) {
		const double A = std::pow(10.0, gain_db / 40), w0 = 2 * PI * frequency / rate;
		const double c = std::cos(w0), alpha = std::sin(w0) / (2 * q);
		normalise(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A);
	}
	double run(double x) {
		const double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
		x2 = x1;
		x1 = x;
		y2 = y1;
		y1 = y;
		return y;
	}
};

// A delay of a fixed time, with interpolation
struct Delay {
	std::vector<double> data;
	double frac = 0;
	int whole = 1, index = 0, size = 3;
	void set(double seconds, double rate) {
		const double length = std::max(1.0, seconds * rate);
		size = (int)std::ceil(length) + 2;
		data.assign(size, 0.0);
		whole = (int)std::floor(length);
		frac = length - whole;
		index = 0;
	}
	double run(double x) {
		data[index] = x;
		const int i0 = (index - whole + size) % size;
		const int i1 = (i0 - 1 + size) % size;
		const double y = data[i0] * (1 - frac) + data[i1] * frac;
		index = (index + 1) % size;
		return y;
	}
};

// The synthesizer of engine-sim for one channel (one exhaust system), at the audio rate
struct Channel {
	Lowpass jitter_noise, dc, air_noise;
	Biquad antialias;
	double history[8] = { 0 };
	int h_index = 0;
	double last = 0, peak = 0.5, gain = 1;
	double jitter = 0.5, hf_gain = 0.01, noise = 1, leveler_target = 0.5, leveler_max = 12, rate = 44100;

	void set(const Dictionary &p, double sample_rate) {
		rate = sample_rate;
		jitter_noise.set(num(p, "jitter_cutoff", 10000), rate);
		dc.set(10, rate);
		air_noise.set(num(p, "noise_cutoff", 2000), rate);
		antialias.butterworth(0.45 * rate, rate);
		jitter = num(p, "jitter", 0.5);
		hf_gain = num(p, "hf_gain", 0.01);
		noise = num(p, "noise", 1);
		leveler_target = num(p, "leveler_target", 0.5);
		leveler_max = num(p, "leveler_max_gain", 12);
	}
	double run(double x, Random &random) {
		// jitter: the signal is read a little early or late, at random
		history[h_index] = x;
		const double offset = std::max(0.0, std::min(6.0, 1 + jitter * (1 + jitter_noise.run(2 * random.next() - 1))));
		const int i0 = (h_index - (int)std::floor(offset) + 8) % 8, i1 = (i0 - 1 + 8) % 8;
		const double frac = offset - std::floor(offset);
		const double f_in = history[i0] * (1 - frac) + history[i1] * frac;
		h_index = (h_index + 1) % 8;
		// the DC taken off, and the derivative
		const double f = f_in - dc.run(f_in);
		const double fp = (f_in - last) * rate;
		last = f_in;
		// the air noise: the signal is modulated by a low noise
		const double r = air_noise.run(2 * random.next() - 1);
		const double r_mixed = noise * r + (1 - noise);
		double v = fp * hf_gain + f * r_mixed * (1 - hf_gain);
		v = antialias.run(v);
		// the leveler: the peak is held near the target, without making a weak signal much louder
		peak = std::max(0.999 * peak, std::fabs(v));
		if (peak > 1e-9) {
			const double g = std::min(leveler_max, std::max(1e-5, leveler_target / peak));
			gain = 0.9 * gain + 0.1 * g;
		}
		return v * gain;
	}
};

struct Cylinder {
	double fire_angle = 0, attenuation = 1, primary_length = 0.5;
	int exhaust_system = 0;
	Gas gas, runner;
	double runner_pending = 0;
	bool ignited = false, burning = false, exhaust_was_open = false;
	double burn_angle = 0, burn_length = 50, burned = 0, burn_energy = 0;
	Delay delay;
	double last_V = 0;
};

} // namespace

// The engine of the worklet (EngineSimProcessor)
struct Engine {
	Dictionary p;
	double sim_rate = 10000, audio_rate = 44100;
	int substeps = 2;
	double area = 0, bore = 0, throw_ = 0, rod = 0, swept = 0, clearance = 0;
	Lobe intake_lobe, exhaust_lobe;
	double intake_centre = 0, exhaust_centre = 0;
	Curve intake_flow, exhaust_flow, timing;
	double k_primary = 0, k_outlet = 0;
	std::vector<Cylinder> cylinders;
	int exhaust_count = 1;
	std::vector<Gas> collectors;
	std::vector<Channel> channels;
	std::vector<double> sim_values, last_values;
	std::vector<Biquad> antialias;
	double length_scale = 1;
	double crank = 0, sim_phase = 0, throttle = 0, throttle_target = 0, pop_queue = 0;
	Gas manifold = Gas::reservoir(ATM * 0.4, T_ATM, FUEL_PER_AIR / (1 + FUEL_PER_AIR));
	Gas atmosphere = Gas::reservoir(ATM, T_ATM, 0);
	double idle_pressure = 0.35, throttle_gamma = 2, burn_duration = 45, burn_efficiency = 0.85, burn_randomness = 0.2;
	double afterfire_temperature = 650, audio_volume = 1, signal_scale = 4e-5;
	Random random;

	void build(const Dictionary &opts, double rate) {
		p = opts;
		audio_rate = rate;
		sim_rate = std::max(2000.0, std::min(48000.0, num(p, "simulation_frequency", 10000)));
		substeps = std::max(1, (int)std::round(num(p, "fluid_steps", 2)));
		bore = num(p, "bore", 101.6) / 1000;
		const double stroke = num(p, "stroke", 88.4) / 1000;
		area = PI * bore * bore / 4;
		throw_ = stroke / 2;
		rod = num(p, "rod", 146) / 1000;
		swept = area * stroke;
		clearance = swept / (num(p, "compression_ratio", 9.5) - 1);
		const double gamma = num(p, "lobe_gamma", 1);
		const double intake_lift = num(p, "intake_lift", 12) / 1000, exhaust_lift = num(p, "exhaust_lift", 12) / 1000;
		intake_lobe.set(num(p, "intake_duration", 232), intake_lift, gamma);
		exhaust_lobe.set(num(p, "exhaust_duration", 232), exhaust_lift, gamma);
		intake_centre = 360 + num(p, "intake_lobe_centre", 110);
		exhaust_centre = 360 - num(p, "exhaust_lobe_centre", 110);
		intake_flow = port_flow(num(p, "intake_flow", 260), intake_lift);
		exhaust_flow = port_flow(num(p, "exhaust_flow", 210), exhaust_lift);
		k_primary = num(p, "primary_flow", 220) * K_CARB;
		k_outlet = num(p, "outlet_flow", 650) * K_CARB;
		timing = Curve();
		Array t = p.get("timing", Array());
		for (int i = 0; i < t.size(); i++) {
			Array pt = t[i];
			if (pt.size() >= 2) {
				timing.xs.push_back((double)pt[0]);
				timing.ys.push_back((double)pt[1]);
			}
		}
		if (timing.xs.empty()) {
			timing.xs = { 0, 9000 };
			timing.ys = { 12, 38 };
		}
		idle_pressure = num(p, "idle_pressure", 0.35);
		throttle_gamma = num(p, "throttle_gamma", 2);
		burn_duration = num(p, "burn_duration", 45);
		burn_efficiency = num(p, "burn_efficiency", 0.85);
		burn_randomness = num(p, "burn_randomness", 0.2);
		afterfire_temperature = num(p, "afterfire_temperature", 650);
		audio_volume = num(p, "audio_volume", 1);
		signal_scale = num(p, "signal_scale", 4e-5);
		const double exhaust_length = num(p, "exhaust_length", 2.8);
		const double runner_volume = num(p, "exhaust_runner_volume", 100) * CC;
		const double primary_area = num(p, "primary_area", 10) * CM2;

		exhaust_count = std::max(1, (int)num(p, "exhaust_systems", 1));
		cylinders.clear();
		Array defs = p.get("cylinders", Array());
		if (defs.is_empty()) {
			Dictionary one;
			one["fire"] = 0;
			one["exhaust"] = 0;
			one["primary"] = 0.5;
			one["attenuation"] = 1;
			defs.append(one);
		}
		for (int i = 0; i < defs.size(); i++) {
			Dictionary d = defs[i];
			Cylinder c;
			c.fire_angle = num(d, "fire", 0);
			c.exhaust_system = std::min(exhaust_count - 1, std::max(0, (int)num(d, "exhaust", 0)));
			c.attenuation = num(d, "attenuation", 1);
			c.primary_length = num(d, "primary", 0.5);
			c.gas = Gas::make(clearance + swept / 2, ATM, T_ATM);
			c.runner = Gas::make(runner_volume + c.primary_length * primary_area, ATM, T_ATM);
			c.delay.set((c.primary_length + exhaust_length) / SPEED_OF_SOUND, sim_rate);
			c.last_V = c.gas.V;
			cylinders.push_back(c);
		}
		collectors.clear();
		channels.clear();
		antialias.clear();
		for (int i = 0; i < exhaust_count; i++) {
			collectors.push_back(Gas::make(num(p, "collector_area", 20) * CM2 * exhaust_length, ATM, T_ATM));
			Channel ch;
			ch.set(p, audio_rate);
			channels.push_back(ch);
			Biquad b;
			b.butterworth(num(p, "input_cutoff", 1900), audio_rate);
			antialias.push_back(b);
		}
		sim_values.assign(exhaust_count, 0.0);
		last_values.assign(exhaust_count, 0.0);
		length_scale = 1 / std::pow(0.2 + exhaust_length, 2);
	}

	// The volume of a cylinder at a crank angle (degrees from TDC)
	double volume(double angle) const {
		const double a = angle * PI / 180;
		const double s = throw_ * std::sin(a);
		const double x = throw_ * std::cos(a) + std::sqrt(std::max(0.0, rod * rod - s * s));
		return clearance + area * (throw_ + rod - x);
	}

	// One step of the simulation
	void step(double dt, double rpm, bool ignition) {
		const double degrees = rpm / 60 * 360 * dt;
		crank = std::fmod(crank + degrees, 720.0);
		// the manifold pressure follows the throttle, with the delay of the air in the intake
		throttle += (throttle_target - throttle) * std::min(1.0, dt / 0.12);
		manifold.fixed_P = ATM * (idle_pressure + (1 - idle_pressure) * std::pow(throttle, throttle_gamma));
		const double advance = timing(rpm);
		const double fluid_dt = dt / substeps;
		std::fill(sim_values.begin(), sim_values.end(), 0.0);

		for (auto &c : cylinders) {
			Gas &gas = c.gas;
			const double theta = std::fmod(crank - c.fire_angle + 720 * 4, 720.0); // 0 = TDC firing
			// the piston moves: work, and the heat that goes to the walls
			const double V = volume(theta);
			const double dV = V - c.last_V;
			gas.E -= gas.P() * dV;
			gas.V = V;
			c.last_V = V;
			const double height = V / area;
			gas.E += (T_WALL - gas.T()) * (PI * bore * height + 2 * area) * 100 * dt;
			if (gas.E < 0) {
				gas.E = 0;
			}

			// the valves
			const double intake_lift = intake_lobe(theta - intake_centre);
			double exhaust_angle = theta - exhaust_centre;
			if (exhaust_angle > 360) {
				exhaust_angle -= 720;
			}
			const double exhaust_lift = exhaust_lobe(exhaust_angle);
			const double k_in = intake_lift > 0 ? intake_flow(intake_lift) * K_28 : 0;
			const double k_ex = exhaust_lift > 0 ? exhaust_flow(exhaust_lift) * K_28 : 0;

			// the spark, and the burn
			if (theta > 360 && theta < 540) {
				c.ignited = false; // the intake stroke: a new charge
			}
			const double spark_angle = 720 - advance;
			if (!c.ignited && !c.burning && theta >= spark_angle && theta < 720 && theta > 540) {
				c.ignited = true;
				if (ignition && gas.fuel > 1e-9) {
					c.burning = true;
					c.burn_angle = 0;
					c.burned = 0;
					const double load = std::max(0.0, std::min(1.0, (manifold.fixed_P / ATM - idle_pressure) / (1 - idle_pressure)));
					c.burn_length = burn_duration * (1.5 - 0.5 * load);
					const double efficiency = burn_efficiency * (1 - burn_randomness * random.next());
					c.burn_energy = gas.fuel * FUEL_ENERGY * efficiency;
				}
			}
			if (c.burning) {
				c.burn_angle += degrees;
				const double x = 1 - std::exp(-5 * std::pow(c.burn_angle / c.burn_length, 3));
				const double dx = x - c.burned;
				c.burned = x;
				gas.E += c.burn_energy * dx;
				gas.fuel *= 1 - dx;
				if (c.burn_angle >= c.burn_length) {
					c.burning = false;
					gas.fuel *= 0.1;
				}
			}

			// unburnt mixture that reaches the hot exhaust burns there (the bangs of the rev limiter)
			const bool exhaust_open = exhaust_lift > 0;
			if (exhaust_open && !c.exhaust_was_open && !c.burning && gas.fuel > 1e-7 && c.runner.T() > afterfire_temperature) {
				c.runner_pending += gas.fuel * FUEL_ENERGY * (0.3 + 0.5 * random.next());
				gas.fuel = 0;
			}
			if (pop_queue > 0 && exhaust_open && !c.exhaust_was_open) {
				c.runner_pending += pop_queue;
				pop_queue = 0;
			}
			c.exhaust_was_open = exhaust_open;
			if (c.runner_pending > 0) {
				const double dE = std::min(c.runner_pending, c.runner_pending * dt / 0.004 + 1);
				c.runner.E += dE;
				c.runner_pending -= dE;
			}

			// the gas flows: into the cylinder from the manifold, out to the runner, from the runner to the collector
			Gas &collector = collectors[c.exhaust_system];
			for (int s = 0; s < substeps; s++) {
				if (k_in > 0) {
					flow(manifold, gas, k_in, fluid_dt);
				}
				if (k_ex > 0) {
					flow(gas, c.runner, k_ex, fluid_dt);
				}
				flow(c.runner, collector, k_primary, fluid_dt);
			}

			// the sound of this cylinder: the pressure in its runner, delayed by the pipes
			const double pulse = c.delay.run(c.runner.P() - ATM);
			sim_values[c.exhaust_system] += c.attenuation * pulse;
		}
		// the collectors breathe out
		for (int e = 0; e < exhaust_count; e++) {
			for (int s = 0; s < substeps; s++) {
				flow(collectors[e], atmosphere, k_outlet, fluid_dt);
			}
		}
		// the sound fades out when the engine stops (below about 380 rpm)
		const double speed = std::min(1.0, std::fabs(rpm) * 2 * PI / 60 / 40);
		const double scale = speed * speed * speed * audio_volume * signal_scale * length_scale / cylinders.size();
		for (int e = 0; e < exhaust_count; e++) {
			sim_values[e] *= scale;
		}
	}

	// one audio sample: the exhaust systems together
	double sample(double rpm, bool ignition) {
		const double dt = 1 / sim_rate;
		sim_phase += sim_rate / audio_rate;
		while (sim_phase >= 1) {
			sim_phase -= 1;
			last_values = sim_values;
			step(dt, rpm, ignition);
		}
		double sum = 0;
		for (int e = 0; e < exhaust_count; e++) {
			const double v = last_values[e] + (sim_values[e] - last_values[e]) * sim_phase;
			sum += channels[e].run(antialias[e].run(v), random);
		}
		return sum;
	}
};

// A convolution with an impulse response: uniformly partitioned, overlap-save, with a latency of one block
struct Convolver {
	static constexpr int B = 256, N = 512;
	using cpx = std::complex<double>;
	std::vector<std::vector<cpx>> parts;   // the impulse response, per block, in the frequency domain
	std::vector<std::vector<cpx>> fdl;     // the spectra of the last inputs
	int fdl_index = 0;
	std::vector<double> window = std::vector<double>(N, 0.0);
	std::vector<double> out = std::vector<double>(B, 0.0);
	int pos = 0;
	bool ready = false;

	static void fft(std::vector<cpx> &a, bool inverse) {
		const int n = (int)a.size();
		for (int i = 1, j = 0; i < n; i++) {
			int bit = n >> 1;
			for (; j & bit; bit >>= 1) {
				j ^= bit;
			}
			j ^= bit;
			if (i < j) {
				std::swap(a[i], a[j]);
			}
		}
		for (int len = 2; len <= n; len <<= 1) {
			const double ang = 2 * PI / len * (inverse ? 1 : -1);
			const cpx wl(std::cos(ang), std::sin(ang));
			for (int i = 0; i < n; i += len) {
				cpx w(1);
				for (int j = 0; j < len / 2; j++) {
					const cpx u = a[i + j], v = a[i + j + len / 2] * w;
					a[i + j] = u + v;
					a[i + j + len / 2] = u - v;
					w *= wl;
				}
			}
		}
		if (inverse) {
			for (auto &x : a) {
				x /= n;
			}
		}
	}

	// the impulse response, scaled the way the ConvolverNode of the Web Audio API does it (normalize)
	void set(const std::vector<double> &ir, double ir_rate) {
		parts.clear();
		ready = false;
		if (ir.empty()) {
			return;
		}
		double power = 0;
		for (double x : ir) {
			power += x * x;
		}
		power = std::sqrt(power / ir.size());
		if (!std::isfinite(power) || power < 0.000125) {
			power = 0.000125;
		}
		const double scale = 0.00125 / power * (44100.0 / ir_rate);
		const int count = (int)((ir.size() + B - 1) / B);
		for (int pi = 0; pi < count; pi++) {
			std::vector<cpx> h(N, cpx(0));
			for (int k = 0; k < B; k++) {
				const size_t i = (size_t)pi * B + k;
				if (i < ir.size()) {
					h[k] = ir[i] * scale;
				}
			}
			fft(h, false);
			parts.push_back(h);
		}
		fdl.assign(count, std::vector<cpx>(N, cpx(0)));
		fdl_index = 0;
		std::fill(window.begin(), window.end(), 0.0);
		std::fill(out.begin(), out.end(), 0.0);
		pos = 0;
		ready = true;
	}

	double run(double x) {
		if (!ready) {
			return 0;
		}
		window[B + pos] = x;
		const double y = out[pos];
		if (++pos == B) {
			pos = 0;
			std::vector<cpx> X(N);
			for (int i = 0; i < N; i++) {
				X[i] = window[i];
			}
			fft(X, false);
			fdl[fdl_index] = X;
			std::vector<cpx> Y(N, cpx(0));
			const int count = (int)parts.size();
			for (int p = 0; p < count; p++) {
				const auto &Xp = fdl[(fdl_index - p + count) % count];
				const auto &H = parts[p];
				for (int i = 0; i < N; i++) {
					Y[i] += Xp[i] * H[i];
				}
			}
			fft(Y, true);
			for (int i = 0; i < B; i++) {
				out[i] = Y[B + i].real();
			}
			fdl_index = (fdl_index + 1) % count;
			std::copy(window.begin() + B, window.end(), window.begin());
		}
		return y;
	}
};

// The chain of EngineSim.js behind the worklet
struct Chain {
	double rate = 44100;
	Convolver convolver;
	double wet = 1, dry = 0, wet_target = 1;
	double drive_pre = 0.25, drive_post = 1;
	// The drive is only as hard as the signal that reaches it, and that is not constant: where a harmonic of the firing
	// falls on a resonance of the pipe (the performance exhaust: 54 Hz, a cross-plane V8 at 3200 rpm) the signal is four
	// times what it is at the rpm around it, and the tanh turns it into a square wave: nothing clips, but the sound is
	// raspy in that band. So the rms into the drive is held under drive_ceiling (of the exhaust, 0 = not held), slowly:
	// the rms over 50 ms, the gain follows in 30 ms down and 400 ms up, so it does not change the shape of a wave.
	double drive_ceiling = 0, drive_env = 0, drive_gain = 1, drive_rms = 0, drive_attack = 0, drive_release = 0;
	Biquad bass, mid, treble, muffler, inside_filter;
	double master = 0, master_target = 0;
	// the limiter (a DynamicsCompressorNode: threshold -10 dB, knee 8 dB, ratio 6, attack 3 ms, release 250 ms)
	double env_db = -120, attack = 0, release = 0, makeup = 1;
	// the settings of the exhaust
	double conv = 1, drive = 0, bass_db = 0, mid_db = 0, mid_hz = 1000, treble_db = 0, lowpass_hz = 20000, ex_volume = 1, volume = 1;
	bool inside = false, silent = false;

	static double shaper_rms(double k) {
		double sum = 0, weight = 0;
		for (double g = -4; g <= 4.0001; g += 0.2) {
			const double w = std::exp(-g * g / 2), t = std::tanh(k * ENGINE_SIM_SIGNAL * g);
			sum += w * t * t;
			weight += w;
		}
		return std::sqrt(sum / weight);
	}

	static double curve_db(double x_db) {
		// the static curve of the compressor, with a soft knee
		const double T = -10, W = 8, ratio = 6;
		if (x_db < T - W / 2) {
			return x_db;
		}
		if (x_db > T + W / 2) {
			return T + (x_db - T) / ratio;
		}
		const double d = x_db - T + W / 2;
		return x_db + (1 / ratio - 1) * d * d / (2 * W);
	}

	void set(const Dictionary &p, double sample_rate) {
		rate = sample_rate;
		conv = num(p, "convolution", 1);
		drive = num(p, "drive", 0);
		bass_db = num(p, "bass", 0);
		mid_db = num(p, "mid", 0);
		mid_hz = num(p, "mid_hz", 1000);
		treble_db = num(p, "treble", 0);
		lowpass_hz = num(p, "lowpass", 20000);
		ex_volume = num(p, "exhaust_volume", 1);
		volume = num(p, "volume", 1);
		attack = std::exp(-1 / (0.003 * rate));
		release = std::exp(-1 / (0.25 * rate));
		drive_ceiling = num(p, "drive_ceiling", 0);
		drive_rms = 1 - std::exp(-1 / (0.05 * rate));
		drive_attack = 1 - std::exp(-1 / (0.03 * rate));
		drive_release = 1 - std::exp(-1 / (0.4 * rate));
		makeup = std::pow(1 / std::pow(10.0, curve_db(0) / 20), 0.6);
		apply();
	}

	void apply() {
		wet_target = convolver.ready ? std::max(0.0, std::min(1.0, conv)) : 0;
		const double k = 1 + 4 * drive;
		drive_pre = k / 4;
		drive_post = ENGINE_SIM_SIGNAL / shaper_rms(k);
		bass.lowshelf(150, bass_db, rate);
		mid.peaking(mid_hz, 0.9, mid_db, rate);
		treble.highshelf(3000, treble_db, rate);
		muffler.lowpass(lowpass_hz, 0.6, rate);
		inside_filter.lowpass(inside ? 2200 : 20000, 0.7, rate);
		master_target = silent ? 0 : ENGINE_SIM_LEVEL * volume * ex_volume * (inside ? 1.2 : 1);
	}

	double run(double x) {
		const double smooth = 1 - std::exp(-1 / (0.05 * rate));
		wet += (wet_target - wet) * smooth;
		master += (master_target - master) * smooth;
		double v = x * (1 - wet) + convolver.run(x) * wet;
		if (drive_ceiling > 0) {
			drive_env += (v * v - drive_env) * drive_rms;
			const double rms = std::sqrt(drive_env);
			const double target = rms > drive_ceiling ? drive_ceiling / rms : 1;
			drive_gain += (target - drive_gain) * (target < drive_gain ? drive_attack : drive_release);
			v *= drive_gain;
		}
		// the drive: tanh(4 z) over -1..1, as the WaveShaperNode of the browser game
		const double z = std::max(-1.0, std::min(1.0, v * drive_pre));
		v = std::tanh(4 * z) * drive_post;
		v = bass.run(v);
		v = mid.run(v);
		v = treble.run(v);
		v = muffler.run(v);
		v = inside_filter.run(v);
		// the limiter
		const double x_db = 20 * std::log10(std::max(1e-9, std::fabs(v)));
		const double coef = x_db > env_db ? attack : release;
		env_db = x_db + coef * (env_db - x_db);
		const double gain_db = curve_db(env_db) - env_db;
		v *= std::pow(10.0, gain_db / 20) * makeup;
		return v * master;
	}
};

EngineSimSynth::EngineSimSynth() :
		engine(std::make_unique<Engine>()), chain(std::make_unique<Chain>()) {}

EngineSimSynth::~EngineSimSynth() = default;

void EngineSimSynth::configure(const Dictionary &options, double p_sample_rate) {
	sample_rate = p_sample_rate > 0 ? p_sample_rate : 44100.0;
	engine->build(options, sample_rate);
	chain->set(options, sample_rate);
}

bool EngineSimSynth::set_impulse_response_wav(const PackedByteArray &bytes) {
	// a RIFF/WAVE file: the fmt and the data chunks
	const int64_t size = bytes.size();
	const uint8_t *b = bytes.ptr();
	if (size < 44 || std::memcmp(b, "RIFF", 4) != 0 || std::memcmp(b + 8, "WAVE", 4) != 0) {
		return false;
	}
	int format = 0, channels = 1, bits = 16;
	double rate = 44100;
	std::vector<double> ir;
	int64_t at = 12;
	auto u16 = [&](int64_t i) { return (int)(b[i] | (b[i + 1] << 8)); };
	auto u32 = [&](int64_t i) { return (uint32_t)(b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | ((uint32_t)b[i + 3] << 24)); };
	while (at + 8 <= size) {
		const uint32_t len = u32(at + 4);
		const int64_t body = at + 8;
		if (std::memcmp(b + at, "fmt ", 4) == 0 && body + 16 <= size) {
			format = u16(body);
			channels = std::max(1, u16(body + 2));
			rate = u32(body + 4);
			bits = u16(body + 14);
		} else if (std::memcmp(b + at, "data", 4) == 0) {
			const int frame = channels * bits / 8;
			const int64_t frames = std::min<int64_t>(len, size - body) / std::max(1, frame);
			ir.resize(frames);
			for (int64_t i = 0; i < frames; i++) {
				const int64_t o = body + i * frame;
				if (format == 3 && bits == 32) {
					float f;
					std::memcpy(&f, b + o, 4);
					ir[i] = f;
				} else if (bits == 16) {
					ir[i] = (int16_t)u16(o) / 32768.0;
				} else if (bits == 24) {
					int32_t s = (b[o] << 8) | (b[o + 1] << 16) | (b[o + 2] << 24);
					ir[i] = (s >> 8) / 8388608.0;
				} else {
					return false;
				}
			}
		}
		at = body + len + (len & 1);
	}
	if (ir.empty()) {
		return false;
	}
	chain->convolver.set(ir, rate);
	chain->apply();
	return true;
}

void EngineSimSynth::set_rpm(double p_rpm) { rpm_target = std::max(0.0, p_rpm); }
void EngineSimSynth::set_throttle(double p_throttle) { throttle_target = std::max(0.0, std::min(1.0, p_throttle)); }
void EngineSimSynth::set_ignition(bool on) { ignition = on; }
void EngineSimSynth::set_inside(bool p_inside) {
	chain->inside = p_inside;
	chain->apply();
}
void EngineSimSynth::set_silent(bool p_silent) {
	chain->silent = p_silent;
	chain->apply();
}
void EngineSimSynth::pop(double energy) { engine->pop_queue = std::min(4000.0, engine->pop_queue + energy); }

PackedVector2Array EngineSimSynth::generate(int frames) {
	PackedVector2Array out;
	if (frames <= 0) {
		return out;
	}
	out.resize(frames);
	Vector2 *w = out.ptrw();
	// the rpm and the throttle glide to what the game set (setTargetAtTime of the browser game: 20 and 30 ms)
	const double k_rpm = 1 - std::exp(-1 / (0.02 * sample_rate));
	const double k_thr = 1 - std::exp(-1 / (0.03 * sample_rate));
	double sum = 0;
	for (int i = 0; i < frames; i++) {
		rpm += (rpm_target - rpm) * k_rpm;
		throttle += (throttle_target - throttle) * k_thr;
		engine->throttle_target = throttle;
		double v = chain->run(engine->sample(rpm, ignition));
		if (!std::isfinite(v)) {
			v = 0;
		}
		v = std::max(-1.0, std::min(1.0, v));
		sum += v * v;
		w[i] = Vector2((float)v, (float)v);
	}
	level = std::sqrt(sum / frames);
	return out;
}

double EngineSimSynth::get_level() const { return level; }

void EngineSimSynth::_bind_methods() {
	ClassDB::bind_method(D_METHOD("configure", "options", "sample_rate"), &EngineSimSynth::configure);
	ClassDB::bind_method(D_METHOD("set_impulse_response_wav", "bytes"), &EngineSimSynth::set_impulse_response_wav);
	ClassDB::bind_method(D_METHOD("set_rpm", "rpm"), &EngineSimSynth::set_rpm);
	ClassDB::bind_method(D_METHOD("set_throttle", "throttle"), &EngineSimSynth::set_throttle);
	ClassDB::bind_method(D_METHOD("set_ignition", "on"), &EngineSimSynth::set_ignition);
	ClassDB::bind_method(D_METHOD("set_inside", "inside"), &EngineSimSynth::set_inside);
	ClassDB::bind_method(D_METHOD("set_silent", "silent"), &EngineSimSynth::set_silent);
	ClassDB::bind_method(D_METHOD("pop", "energy"), &EngineSimSynth::pop);
	ClassDB::bind_method(D_METHOD("generate", "frames"), &EngineSimSynth::generate);
	ClassDB::bind_method(D_METHOD("get_level"), &EngineSimSynth::get_level);
}

} // namespace orsound
