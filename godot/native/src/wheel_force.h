// Force feedback on a racing wheel that speaks HID PID (PXN, Thrustmaster, Fanatec, Moza, Simagic, the Logitech
// G920/G923 in their native mode and most others): a port of the PID part of web/js/ForceFeedback.js, which talks
// to the wheel through WebHID. Here the wheel is opened with the HID functions of SDL3 (hidapi), its report
// descriptor is read and parsed (what WebHID did for the browser), and a constant force, a spring and a damper
// are made on it. The force is sent from a thread of its own, at most 250 times a second.

#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <godot_cpp/variant/string.hpp>

#include <atomic>
#include <memory>

namespace orsound {

struct PidDevice;

class WheelForce : public godot::RefCounted {
	GDCLASS(WheelForce, godot::RefCounted)

public:
	WheelForce();
	~WheelForce();

	// opens the first HID device with this vendor and product that has the PID reports; "" when it worked, else why not
	godot::String open(int vendor_id, int product_id);
	bool is_open() const;
	godot::String device_name() const;
	// the constant force: -1..1 (+ turns the wheel one way, the caller knows which)
	void set_force(double value);
	// the spring and the damper that the wheel makes itself: 0..1 (sent when they change)
	void set_spring(double coefficient);
	void set_damper(double coefficient);
	bool has_spring() const;
	bool has_damper() const;
	void close();
	// what the setup sent and found, for the log (taken: the list is emptied)
	godot::PackedStringArray take_log();

protected:
	static void _bind_methods();

private:
	std::unique_ptr<PidDevice> dev;
};

} // namespace orsound
