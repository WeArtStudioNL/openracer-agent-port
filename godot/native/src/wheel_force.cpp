// See wheel_force.h. The names follow web/js/ForceFeedback.js (parsePid, createEffect, setEffectReport, operation,
// control, sendCondition, startPid, sendConstant, stopPid).

#include "wheel_force.h"

#include <godot_cpp/core/class_db.hpp>

#include <SDL3/SDL_hidapi.h>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <dlfcn.h>
#endif

#include <algorithm>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <map>
#include <mutex>
#include <thread>
#include <vector>

using namespace godot;

namespace orsound {

namespace {

constexpr uint32_t PID_PAGE = 0x0f;
uint32_t pid(uint32_t id) { return (PID_PAGE << 16) | id; }

enum : uint32_t {
	U_SET_EFFECT = 0x21, U_BLOCK_INDEX = 0x22, U_PBO = 0x23, U_EFFECT_TYPE = 0x25, U_CONSTANT = 0x26, U_SPRING = 0x40, U_DAMPER = 0x41,
	U_BYTE_COUNT = 0x2b, U_DURATION = 0x50, U_SAMPLE_PERIOD = 0x51, U_GAIN = 0x52, U_TRIGGER_BUTTON = 0x53, U_TRIGGER_REPEAT = 0x54,
	U_DIRECTION_ENABLE = 0x56, U_START_DELAY = 0xa7, U_CP_OFFSET = 0x60, U_POS_COEFF = 0x61, U_NEG_COEFF = 0x62, U_POS_SAT = 0x63,
	U_NEG_SAT = 0x64, U_DEAD_BAND = 0x65, U_MAGNITUDE = 0x70, U_EFFECT_OPERATION = 0x78, U_OP_START = 0x79, U_LOOP_COUNT = 0x7c,
	U_DEVICE_GAIN = 0x7e, U_DEVICE_CONTROL = 0x96, U_ENABLE_ACTUATORS = 0x97, U_DISABLE_ACTUATORS = 0x98, U_STOP_ALL = 0x99,
	U_RESET = 0x9a, U_LOAD_SUCCESS = 0x8c
};

enum Kind { INPUT = 0, OUTPUT = 1, FEATURE = 2 };

struct Field {
	uint32_t usage = 0;
	std::vector<uint32_t> usages;   // an array field: the usages of its values
	bool array = false;
	bool constant = false;
	int bit = 0, size = 0;
	int64_t min = 0, max = 0;
};

struct ReportDef {
	Kind kind = OUTPUT;
	int id = 0;
	int bits = 0;
	std::vector<Field> fields;
	bool has(uint32_t usage) const {
		for (const auto &f : fields) {
			if (f.usage == usage || (f.array && std::find(f.usages.begin(), f.usages.end(), usage) != f.usages.end())) {
				return true;
			}
		}
		return false;
	}
};

// The report descriptor of a HID device, parsed into its reports and their fields
std::vector<ReportDef> parse_descriptor(const uint8_t *d, int length) {
	struct Global {
		uint32_t page = 0;
		int64_t lmin = 0, lmax = 0;
		uint32_t lmax_raw = 0;
		int lmax_size = 0;
		int size = 0, count = 0, id = 0;
	};
	Global g;
	std::vector<Global> stack;
	std::vector<uint32_t> usages;
	uint32_t umin = 0, umax = 0;
	bool has_range = false;
	std::map<std::pair<int, int>, ReportDef> reports;
	std::vector<std::pair<int, int>> order;

	int i = 0;
	while (i < length) {
		const uint8_t prefix = d[i];
		if (prefix == 0xfe) { // a long item
			if (i + 1 >= length) {
				break;
			}
			i += 3 + d[i + 1];
			continue;
		}
		const int size = (prefix & 3) == 3 ? 4 : (prefix & 3);
		const int type = (prefix >> 2) & 3, tag = prefix >> 4;
		if (i + 1 + size > length) {
			break;
		}
		uint32_t value = 0;
		for (int k = 0; k < size; k++) {
			value |= (uint32_t)d[i + 1 + k] << (8 * k);
		}
		int64_t svalue = value;
		if (size > 0 && size < 4 && (value & (1u << (size * 8 - 1)))) {
			svalue = (int64_t)value - ((int64_t)1 << (size * 8));
		} else if (size == 4) {
			svalue = (int32_t)value;
		}
		i += 1 + size;
		if (type == 1) { // global
			switch (tag) {
				case 0: g.page = value; break;
				case 1: g.lmin = svalue; break;
				case 2: g.lmax = svalue; g.lmax_raw = value; g.lmax_size = size; break;
				case 7: g.size = (int)value; break;
				case 8: g.id = (int)value; break;
				case 9: g.count = (int)value; break;
				case 10: stack.push_back(g); break;
				case 11: if (!stack.empty()) { g = stack.back(); stack.pop_back(); } break;
				default: break;
			}
		} else if (type == 2) { // local
			const uint32_t full = size == 4 ? value : ((g.page << 16) | value);
			if (tag == 0) {
				usages.push_back(full);
			} else if (tag == 1) {
				umin = full;
				has_range = true;
			} else if (tag == 2) {
				umax = full;
				has_range = true;
			}
		} else if (type == 0) { // main
			if (tag == 8 || tag == 9 || tag == 11) {
				const Kind kind = tag == 8 ? INPUT : (tag == 9 ? OUTPUT : FEATURE);
				const auto key = std::make_pair((int)kind, g.id);
				if (!reports.count(key)) {
					ReportDef r;
					r.kind = kind;
					r.id = g.id;
					reports[key] = r;
					order.push_back(key);
				}
				ReportDef &r = reports[key];
				std::vector<uint32_t> list = usages;
				if (has_range) {
					const uint32_t page = umin & 0xffff0000u;
					for (uint32_t u = umin; u <= umax && list.size() < 256; u++) {
						list.push_back(page | (u & 0xffff));
					}
				}
				// logical max: unsigned when the minimum is not negative
				const int64_t lmax = g.lmin >= 0 ? (int64_t)g.lmax_raw : g.lmax;
				const bool is_array = !(value & 2), is_constant = (value & 1) != 0;
				for (int c = 0; c < g.count; c++) {
					Field f;
					f.bit = r.bits;
					f.size = g.size;
					f.min = g.lmin;
					f.max = lmax;
					f.constant = is_constant;
					if (is_array) {
						f.array = true;
						f.usages = list;
					} else {
						f.usage = list.empty() ? 0 : list[std::min<size_t>(c, list.size() - 1)];
					}
					r.fields.push_back(f);
					r.bits += g.size;
				}
			}
			usages.clear();
			has_range = false;
		}
	}
	std::vector<ReportDef> out;
	for (const auto &k : order) {
		out.push_back(reports[k]);
	}
	return out;
}

void write_bits(std::vector<uint8_t> &bytes, int bit, int size, int64_t value) {
	for (int k = 0; k < size; k++) {
		const int b = bit + k;
		if ((b >> 3) >= (int)bytes.size()) {
			return;
		}
		if ((value >> k) & 1) {
			bytes[b >> 3] |= 1 << (b & 7);
		} else {
			bytes[b >> 3] &= ~(1 << (b & 7));
		}
	}
}

int64_t read_bits(const std::vector<uint8_t> &bytes, int bit, int size) {
	int64_t value = 0;
	for (int k = 0; k < size; k++) {
		const int b = bit + k;
		if ((b >> 3) < (int)bytes.size() && (bytes[b >> 3] & (1 << (b & 7)))) {
			value |= (int64_t)1 << k;
		}
	}
	return value;
}

double clampd(double x, double a, double b) { return std::max(a, std::min(b, x)); }

// The HID functions of the SDL3 that is in Godot itself (it exports them): taken at run time, so that there is one
// SDL in the game (a second one, linked here, clashed with it: macOS reported its classes twice)
struct Hid {
	decltype(&SDL_hid_init) init = nullptr;
	decltype(&SDL_hid_enumerate) enumerate = nullptr;
	decltype(&SDL_hid_free_enumeration) free_enumeration = nullptr;
	decltype(&SDL_hid_open_path) open_path = nullptr;
	decltype(&SDL_hid_close) close = nullptr;
	decltype(&SDL_hid_write) write = nullptr;
	decltype(&SDL_hid_send_feature_report) send_feature_report = nullptr;
	decltype(&SDL_hid_get_feature_report) get_feature_report = nullptr;
	decltype(&SDL_hid_get_report_descriptor) get_report_descriptor = nullptr;
	decltype(&SDL_GetError) get_error = nullptr;
	bool ok = false;
	bool load() {
		if (ok) {
			return true;
		}
#ifdef __EMSCRIPTEN__
		// the web: no HID here (Godot has no SDL HID in the browser), so there is no wheel to open
		return false;
#endif
#ifdef _WIN32
		// (the SDL of Godot is in the executable; when it does not export these, force feedback stays off)
		HMODULE self_module = GetModuleHandleW(nullptr);
#define OR_HID(field, name) field = reinterpret_cast<decltype(field)>(reinterpret_cast<void *>(GetProcAddress(self_module, name)))
#else
#define OR_HID(field, name) field = reinterpret_cast<decltype(field)>(dlsym(RTLD_DEFAULT, name))
#endif
		OR_HID(init, "SDL_hid_init");
		OR_HID(enumerate, "SDL_hid_enumerate");
		OR_HID(free_enumeration, "SDL_hid_free_enumeration");
		OR_HID(open_path, "SDL_hid_open_path");
		OR_HID(close, "SDL_hid_close");
		OR_HID(write, "SDL_hid_write");
		OR_HID(send_feature_report, "SDL_hid_send_feature_report");
		OR_HID(get_feature_report, "SDL_hid_get_feature_report");
		OR_HID(get_report_descriptor, "SDL_hid_get_report_descriptor");
		OR_HID(get_error, "SDL_GetError");
#undef OR_HID
		ok = init && enumerate && free_enumeration && open_path && close && write && send_feature_report && get_feature_report &&
				get_report_descriptor && get_error;
		return ok;
	}
};
Hid hid_api;

// A report to send: values by usage (Report of ForceFeedback.js)
struct Report {
	const ReportDef *def;
	std::vector<uint8_t> bytes;
	explicit Report(const ReportDef *d) : def(d), bytes((d->bits + 7) / 8, 0) {}
	void set(uint32_t usage, double value) {
		for (const auto &f : def->fields) {
			if (f.usage == usage && !f.array) {
				write_bits(bytes, f.bit, f.size, (int64_t)std::llround(clampd(value, (double)f.min, (double)f.max)));
			}
		}
	}
	void set_raw(uint32_t usage, int64_t value) {
		for (const auto &f : def->fields) {
			if (f.usage == usage && !f.array) {
				write_bits(bytes, f.bit, f.size, value);
			}
		}
	}
	void set_fraction(uint32_t usage, double fraction) {
		for (const auto &f : def->fields) {
			if (f.usage == usage && !f.array) {
				write_bits(bytes, f.bit, f.size, (int64_t)std::llround(f.min + (f.max - f.min) * clampd(fraction, 0, 1)));
			}
		}
	}
	void set_signed(uint32_t usage, double value) {
		for (const auto &f : def->fields) {
			if (f.usage != usage || f.array) {
				continue;
			}
			double v = f.min < 0 ? (value >= 0 ? value * f.max : -value * f.min) : f.min + (f.max - f.min) * (value + 1) / 2;
			write_bits(bytes, f.bit, f.size, (int64_t)std::llround(clampd(v, (double)f.min, (double)f.max)));
		}
	}
	void set_all(uint32_t usage) {
		for (const auto &f : def->fields) {
			if (f.usage == usage && !f.array) {
				write_bits(bytes, f.bit, f.size, f.size >= 32 ? 0xffffffffLL : ((1LL << f.size) - 1));
			}
		}
	}
	bool select(uint32_t chosen) {
		for (const auto &f : def->fields) {
			if (!f.array) {
				continue;
			}
			auto it = std::find(f.usages.begin(), f.usages.end(), chosen);
			if (it != f.usages.end()) {
				write_bits(bytes, f.bit, f.size, f.min + (it - f.usages.begin()));
				return true;
			}
		}
		return false;
	}
};

} // namespace

struct PidDevice {
	SDL_hid_device *hid = nullptr;
	String name;
	std::vector<ReportDef> reports;
	const ReportDef *set_effect = nullptr, *set_constant = nullptr, *set_condition = nullptr, *op = nullptr, *ctl = nullptr,
					*device_gain = nullptr, *create = nullptr, *block_load = nullptr;
	bool has_spring = false, has_damper = false;
	int block_constant = 0, block_spring = 0, block_damper = 0, next_block = 1;
	bool setup_logging = true;
	std::vector<String> log;
	std::mutex log_mutex;

	// the sender
	std::thread thread;
	std::mutex mutex;
	std::condition_variable wake;
	bool quit = false;
	double force = 0, spring = 0, damper = 0;
	bool spring_dirty = false, damper_dirty = false;

	void note(const String &text) {
		std::lock_guard<std::mutex> lock(log_mutex);
		log.push_back(text);
	}

	bool send(const Report &r) {
		std::vector<uint8_t> buf;
		buf.push_back((uint8_t)r.def->id);
		buf.insert(buf.end(), r.bytes.begin(), r.bytes.end());
		if (setup_logging) {
			String hex;
			for (uint8_t b : r.bytes) {
				const char *digits = "0123456789abcdef";
				hex += String::chr(digits[b >> 4]) + String::chr(digits[b & 15]) + " ";
			}
			note(String(r.def->kind == FEATURE ? "feature " : "output ") + String::num_int64(r.def->id) + ": " + hex);
		}
		const int n = r.def->kind == FEATURE ? hid_api.send_feature_report(hid, buf.data(), buf.size()) : hid_api.write(hid, buf.data(), buf.size());
		if (n < 0) {
			note(String("send failed: ") + String(hid_api.get_error()));
			return false;
		}
		return true;
	}

	const ReportDef *find(Kind kind, uint32_t usage, bool (*extra)(const ReportDef &) = nullptr) const {
		for (const auto &r : reports) {
			if (r.kind == kind && r.has(usage) && (!extra || extra(r))) {
				return &r;
			}
		}
		return nullptr;
	}

	bool parse_pid() {
		set_effect = find(OUTPUT, pid(U_CONSTANT), [](const ReportDef &r) { return r.has(pid(U_DURATION)) || r.has(pid(U_GAIN)); });
		set_constant = find(OUTPUT, pid(U_MAGNITUDE), [](const ReportDef &r) { return !r.has(pid(0x71)) && !r.has(pid(0x72)) && !r.has(pid(0x6f)); });
		set_condition = find(OUTPUT, pid(U_CP_OFFSET));
		op = find(OUTPUT, pid(U_OP_START));
		ctl = find(OUTPUT, pid(U_ENABLE_ACTUATORS));
		device_gain = find(OUTPUT, pid(U_DEVICE_GAIN));
		create = find(FEATURE, pid(U_CONSTANT));
		block_load = find(FEATURE, pid(U_LOAD_SUCCESS));
		if (!block_load) {
			block_load = find(INPUT, pid(U_LOAD_SUCCESS));
		}
		if (!set_effect || !set_constant || !op) {
			return false;
		}
		std::vector<uint32_t> types;
		for (const auto &f : set_effect->fields) {
			if (f.array) {
				types.insert(types.end(), f.usages.begin(), f.usages.end());
			}
		}
		has_spring = set_condition && std::find(types.begin(), types.end(), pid(U_SPRING)) != types.end();
		has_damper = set_condition && std::find(types.begin(), types.end(), pid(U_DAMPER)) != types.end();
		return true;
	}

	static void wait(int ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }

	int create_effect(uint32_t type) {
		if (!create || !block_load) {
			return next_block++;
		}
		Report r(create);
		r.select(type);
		r.set_raw(pid(U_BYTE_COUNT), 0);
		r.set_raw((0x01 << 16) | 0x3b, 0);
		send(r);
		wait(20);
		std::vector<uint8_t> buf((block_load->bits + 7) / 8 + 1, 0);
		buf[0] = (uint8_t)block_load->id;
		const int n = hid_api.get_feature_report(hid, buf.data(), buf.size());
		if (n <= 0) {
			note("block load: no answer, block " + String::num_int64(next_block));
			return next_block++;
		}
		// (hidapi gives the report id as the first byte)
		int index = 1;
		int64_t status = -1;
		for (const auto &f : block_load->fields) {
			if (f.usage == pid(U_BLOCK_INDEX)) {
				index = (int)read_bits(buf, f.bit + 8, f.size);
			}
			if (f.array && std::find(f.usages.begin(), f.usages.end(), pid(U_LOAD_SUCCESS)) != f.usages.end()) {
				const int64_t v = read_bits(buf, f.bit + 8, f.size) - f.min;
				status = (v >= 0 && v < (int64_t)f.usages.size()) ? f.usages[v] : -1;
			}
		}
		note("block load: index " + String::num_int64(index) + ", status " + String::num_int64(status, 16));
		return index > 0 ? index : 1;
	}

	void set_effect_report(int block, uint32_t type, double direction_fraction) {
		Report r(set_effect);
		r.set(pid(U_BLOCK_INDEX), block);
		r.select(type);
		r.set_all(pid(U_DURATION)); // for ever
		r.set(pid(U_TRIGGER_REPEAT), 0);
		r.set(pid(U_SAMPLE_PERIOD), 0);
		r.set_fraction(pid(U_GAIN), 1);
		r.set_raw(pid(U_TRIGGER_BUTTON), 0);
		r.set_raw(pid(U_START_DELAY), 0);
		int axes = 0, dirs = 0;
		for (const auto &f : set_effect->fields) {
			if (f.array) {
				continue;
			}
			const uint32_t page = f.usage >> 16, id = f.usage & 0xffff;
			if (page == 0x01 && f.size == 1) {
				write_bits(r.bytes, f.bit, 1, axes == 0 ? 1 : 0);
				axes++;
				continue;
			}
			const bool direction = page == 0x0a || (page == 0x0f && (id == 0x01 || id == 0x02)) || (page == 0x01 && f.size > 1);
			if (direction) {
				write_bits(r.bytes, f.bit, f.size, dirs == 0 ? (int64_t)std::llround(f.min + (f.max - f.min) * direction_fraction) : f.min);
				dirs++;
				continue;
			}
			if (f.usage == pid(U_DIRECTION_ENABLE)) {
				write_bits(r.bytes, f.bit, f.size, 1);
			}
		}
		send(r);
	}

	void operation(int block, uint32_t op_usage) {
		Report r(op);
		r.set(pid(U_BLOCK_INDEX), block);
		r.select(pid(op_usage));
		r.set(pid(U_LOOP_COUNT), 1);
		send(r);
	}

	void control(uint32_t usage) {
		if (!ctl) {
			return;
		}
		Report r(ctl);
		r.select(pid(usage));
		send(r);
	}

	void send_condition(int block, double coefficient, double saturation) {
		Report r(set_condition);
		r.set(pid(U_BLOCK_INDEX), block);
		r.set(pid(U_PBO), 0);
		r.set_signed(pid(U_CP_OFFSET), 0);
		r.set_signed(pid(U_POS_COEFF), coefficient);
		r.set_signed(pid(U_NEG_COEFF), coefficient);
		r.set_fraction(pid(U_POS_SAT), saturation);
		r.set_fraction(pid(U_NEG_SAT), saturation);
		r.set_fraction(pid(U_DEAD_BAND), 0);
		send(r);
	}

	void send_constant(double value) {
		Report r(set_constant);
		r.set(pid(U_BLOCK_INDEX), block_constant);
		r.set_signed(pid(U_MAGNITUDE), value);
		send(r);
	}

	void start() {
		control(U_RESET);
		wait(30);
		control(U_STOP_ALL);
		control(U_ENABLE_ACTUATORS);
		if (device_gain) {
			Report r(device_gain);
			r.set_fraction(pid(U_DEVICE_GAIN), 1);
			send(r);
		}
		block_constant = create_effect(pid(U_CONSTANT));
		set_effect_report(block_constant, pid(U_CONSTANT), 0.25);
		send_constant(0);
		operation(block_constant, U_OP_START);
		if (has_spring) {
			block_spring = create_effect(pid(U_SPRING));
			set_effect_report(block_spring, pid(U_SPRING), 0.25);
			send_condition(block_spring, 0, 1);
			operation(block_spring, U_OP_START);
		}
		if (has_damper) {
			block_damper = create_effect(pid(U_DAMPER));
			set_effect_report(block_damper, pid(U_DAMPER), 0.25);
			send_condition(block_damper, 0, 1);
			operation(block_damper, U_OP_START);
		}
		setup_logging = false;
	}

	void run() {
		double last = 0;
		auto last_time = std::chrono::steady_clock::now();
		std::unique_lock<std::mutex> lock(mutex);
		while (!quit) {
			wake.wait_for(lock, std::chrono::milliseconds(4));
			if (quit) {
				break;
			}
			const double f = force;
			const bool sd = spring_dirty, dd = damper_dirty;
			const double s = spring, d = damper;
			spring_dirty = damper_dirty = false;
			lock.unlock();
			const auto now = std::chrono::steady_clock::now();
			const double since = std::chrono::duration<double>(now - last_time).count();
			if (std::fabs(f - last) > 0.004 || since > 0.2) {
				send_constant(f);
				last = f;
				last_time = now;
			}
			if (sd && has_spring) {
				send_condition(block_spring, s, 1);
			}
			if (dd && has_damper) {
				send_condition(block_damper, d, 1);
			}
			lock.lock();
		}
	}

	void stop() {
		{
			std::lock_guard<std::mutex> lock(mutex);
			quit = true;
		}
		wake.notify_all();
		if (thread.joinable()) {
			thread.join();
		}
		if (hid) {
			send_constant(0);
			control(U_STOP_ALL);
			control(U_DISABLE_ACTUATORS);
			hid_api.close(hid);
			hid = nullptr;
		}
	}
};

WheelForce::WheelForce() {}

WheelForce::~WheelForce() { close(); }

String WheelForce::open(int vendor_id, int product_id) {
	close();
#ifdef __EMSCRIPTEN__
	return "no HID in the browser (force feedback is only in the desktop versions)";
#endif
	if (!hid_api.load()) {
		return "the HID functions of SDL were not found in Godot";
	}
	if (hid_api.init() != 0) {
		return String("hidapi: ") + String(hid_api.get_error());
	}
	SDL_hid_device_info *list = hid_api.enumerate((unsigned short)vendor_id, (unsigned short)product_id);
	String why = "no HID device " + String::num_int64(vendor_id, 16) + ":" + String::num_int64(product_id, 16);
	for (SDL_hid_device_info *info = list; info; info = info->next) {
		SDL_hid_device *hid = hid_api.open_path(info->path);
		if (!hid) {
			why = String("cannot open the wheel: ") + String(hid_api.get_error());
			continue;
		}
		uint8_t desc[4096];
		const int n = hid_api.get_report_descriptor(hid, desc, sizeof(desc));
		auto p = std::make_unique<PidDevice>();
		p->hid = hid;
		if (n > 0) {
			p->reports = parse_descriptor(desc, n);
		}
		if (n <= 0 || !p->parse_pid()) {
			why = "the wheel has no HID PID reports (descriptor of " + String::num_int64(n) + " bytes, " + String::num_int64(p->reports.size()) + " reports)";
			hid_api.close(hid);
			p->hid = nullptr;
			continue;
		}
		if (info->product_string) {
			p->name = String(info->product_string);
		}
		p->note("HID PID: " + p->name + ", " + String::num_int64(p->reports.size()) + " reports, spring " + (p->has_spring ? "yes" : "no") +
				", damper " + (p->has_damper ? "yes" : "no"));
		p->start();
		PidDevice *raw = p.get();
		p->thread = std::thread([raw]() { raw->run(); });
		dev = std::move(p);
		hid_api.free_enumeration(list);
		return "";
	}
	hid_api.free_enumeration(list);
	return why;
}

bool WheelForce::is_open() const { return dev != nullptr; }
String WheelForce::device_name() const { return dev ? dev->name : String(); }
bool WheelForce::has_spring() const { return dev && dev->has_spring; }
bool WheelForce::has_damper() const { return dev && dev->has_damper; }

void WheelForce::set_force(double value) {
	if (!dev) {
		return;
	}
	{
		std::lock_guard<std::mutex> lock(dev->mutex);
		dev->force = clampd(value, -1, 1);
	}
	dev->wake.notify_all();
}

void WheelForce::set_spring(double c) {
	if (!dev) {
		return;
	}
	std::lock_guard<std::mutex> lock(dev->mutex);
	if (std::fabs(c - dev->spring) > 1e-3) {
		dev->spring = clampd(c, 0, 1);
		dev->spring_dirty = true;
	}
}

void WheelForce::set_damper(double c) {
	if (!dev) {
		return;
	}
	std::lock_guard<std::mutex> lock(dev->mutex);
	if (std::fabs(c - dev->damper) > 1e-3) {
		dev->damper = clampd(c, 0, 1);
		dev->damper_dirty = true;
	}
}

void WheelForce::close() {
	if (dev) {
		dev->stop();
		dev.reset();
	}
}

PackedStringArray WheelForce::take_log() {
	PackedStringArray out;
	if (dev) {
		std::lock_guard<std::mutex> lock(dev->log_mutex);
		for (const auto &s : dev->log) {
			out.push_back(s);
		}
		dev->log.clear();
	}
	return out;
}

void WheelForce::_bind_methods() {
	ClassDB::bind_method(D_METHOD("open", "vendor_id", "product_id"), &WheelForce::open);
	ClassDB::bind_method(D_METHOD("is_open"), &WheelForce::is_open);
	ClassDB::bind_method(D_METHOD("device_name"), &WheelForce::device_name);
	ClassDB::bind_method(D_METHOD("set_force", "value"), &WheelForce::set_force);
	ClassDB::bind_method(D_METHOD("set_spring", "coefficient"), &WheelForce::set_spring);
	ClassDB::bind_method(D_METHOD("set_damper", "coefficient"), &WheelForce::set_damper);
	ClassDB::bind_method(D_METHOD("has_spring"), &WheelForce::has_spring);
	ClassDB::bind_method(D_METHOD("has_damper"), &WheelForce::has_damper);
	ClassDB::bind_method(D_METHOD("close"), &WheelForce::close);
	ClassDB::bind_method(D_METHOD("take_log"), &WheelForce::take_log);
}

} // namespace orsound
