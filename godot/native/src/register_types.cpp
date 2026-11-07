// The native part of O-Racer (a GDExtension): the engine sound and the force feedback of a racing wheel.

#include "engine_sim.h"
#include "wheel_force.h"

#include <gdextension_interface.h>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

using namespace godot;

void initialize_oracer(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) {
		return;
	}
	GDREGISTER_CLASS(orsound::EngineSimSynth);
	GDREGISTER_CLASS(orsound::WheelForce);
}

void uninitialize_oracer(ModuleInitializationLevel p_level) {
}

extern "C" {
GDExtensionBool GDE_EXPORT oracer_library_init(GDExtensionInterfaceGetProcAddress p_get_proc_address, const GDExtensionClassLibraryPtr p_library,
		GDExtensionInitialization *r_initialization) {
	GDExtensionBinding::InitObject init_obj(p_get_proc_address, p_library, r_initialization);
	init_obj.register_initializer(initialize_oracer);
	init_obj.register_terminator(uninitialize_oracer);
	init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
	return init_obj.init();
}
}
