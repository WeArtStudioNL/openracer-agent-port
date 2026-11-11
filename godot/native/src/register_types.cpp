// The native part of GripWorks (a GDExtension): the engine sound, the force feedback of a racing wheel and the shell tyre.

#include "engine_sim.h"
#include "tyre_shell.h"
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
	GDREGISTER_CLASS(orsound::TyreGround);
	GDREGISTER_CLASS(orsound::TyreShell);
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
