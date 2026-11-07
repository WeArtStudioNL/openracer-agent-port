// The engine sound of O-Racer: a port of web/js/EngineSimWorklet.js (after engine-sim of Ange Yaghi, MIT license,
// see web/sounds/ir/ENGINE_SIM_LICENSE.txt) and of the exhaust chain of web/js/EngineSim.js, as a GDExtension.
//
// The combustion in every cylinder is simulated at its own rate (10 kHz by default): the volume of gas in the
// cylinder, the valves, the burn, the exhaust runner and the collector. The sound is the pressure in the runners.
// Then the chain of the browser game: the dry sound and the sound through an impulse response of an exhaust
// (a convolution), a drive, bass, mid, treble, a muffler (lowpass), the lowpass inside the car and a limiter.

#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/packed_vector2_array.hpp>

#include <memory>
#include <vector>

namespace orsound {

struct Engine;
struct Chain;

class EngineSimSynth : public godot::RefCounted {
	GDCLASS(EngineSimSynth, godot::RefCounted)

public:
	EngineSimSynth();
	~EngineSimSynth();

	// options: the parameters of OpenRacer.engineSimWorkletOptions (engine_sim_params.gd) plus the exhaust chain
	void configure(const godot::Dictionary &options, double sample_rate);
	// an impulse response as the bytes of a wav file (mono or the first channel; 16 bit pcm or 32 bit float)
	bool set_impulse_response_wav(const godot::PackedByteArray &bytes);
	void set_rpm(double rpm);
	void set_throttle(double throttle);
	void set_ignition(bool on);
	void set_inside(bool inside);
	void set_silent(bool silent);
	void pop(double energy);
	// the next frames of the sound (the same on both channels)
	godot::PackedVector2Array generate(int frames);
	// the rms of the last frames that generate made (for the tests)
	double get_level() const;

protected:
	static void _bind_methods();

private:
	std::unique_ptr<Engine> engine;
	std::unique_ptr<Chain> chain;
	double sample_rate = 44100.0;
	double rpm = 0.0, rpm_target = 0.0;
	double throttle = 0.0, throttle_target = 0.0;
	bool ignition = true;
	double level = 0.0;
};

} // namespace orsound
