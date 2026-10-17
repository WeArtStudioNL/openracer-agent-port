"""
Sets up a Blender scene to look like OpenRacer, so that a car in Blender looks the way it does in the game.

How to use it:
  1. In the game: Esc > "Surroundings for Blender" > Save as HDR. This saves openracer-environment.hdr: the sky and the
     ground around the car (it is lit by this in the game, and reflects it).
  2. In Blender: open or import the car (File > Import > glTF), then open the Scripting workspace, open this file, set HDRI
     below to the path of the .hdr file (or put the .hdr next to this script or next to the .blend file) and press Run Script.
  Or from a terminal:  blender car.blend --python tools/blender_match_game.py

What it sets (see the README, "Blender"):
  - the render engine (EEVEE), without the extras that the game does not have (screen space reflections / ray tracing,
    bloom, ambient occlusion), with soft shadows and enough samples to look smooth;
  - the colour management: "Standard" (the game shows the colours as they come, with the Tone mapping option off), or AgX when
    the game's Tone mapping option is AgX; no look, an exposure that goes with the colour correction of the game (x1.2; its power of 1.1 is left out);
  - the world: the picture of the surroundings of the game, with the ambient light of the game added to the light (and not to
    what the camera sees);
  - the three lights of the game as suns: a main sun, a sun that casts the shadow, and a high light;
  - a dark road under the car for its shadow, and a camera with the field of view of the chase
    camera of the game (35 degrees), if the scene has no camera.
It does not delete anything of the scene.
"""

import math
import os

import bpy
from mathutils import Vector

# ---- what you may want to change -------------------------------------------------------------------------

HDRI = ""                 # path of openracer-environment.hdr; empty: next to this script or next to the .blend file
VIEW = "standard"         # "standard" (Tone mapping off in the game) or "agx" (Tone mapping AgX in the game)
GAME_COLOUR = True        # the colour correction of the game (x1.2, as exposure)
SAMPLES = 64              # the quality of the render
RESOLUTION = (1920, 1080)
ROAD = True               # a road under the car, for its shadow
CAMERA_ANGLE = 28.0       # degrees from straight behind the car; 0 is the view of the chase camera of the game

# The lights of the game (three.js, in units where a white surface that faces the light is white at an intensity of PI),
# as suns of Blender. Directions are the places of the lights in the game (x, y up, z) turned into the axes of Blender.
LIGHTS = [
    # name, position in the game, strength, casts a shadow
    ("OpenRacer sun", (350.0, 75.0, 250.0), 0.7 * math.pi, False),
    ("OpenRacer shadow sun", (40.0, 70.0, 40.0), 0.5 * math.pi, True),
    ("OpenRacer high light", (500.0, 1000.0, 0.0), 1.0 * math.pi, False),
]
AMBIENT = (0x57 / 255.0, 0x67 / 255.0, 0x77 / 255.0)  # the ambient light of the game (sRGB)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def attempt(obj, name, value):
    """Sets a property that does not exist in every version of Blender."""
    try:
        setattr(obj, name, value)
        return True
    except (AttributeError, TypeError, ValueError):
        return False


def find_hdri():
    candidates = []
    if HDRI:
        candidates.append(bpy.path.abspath(HDRI))
    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else ""
    blend = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else ""
    for folder in (here, blend, os.path.expanduser("~/Downloads")):
        if folder:
            candidates.append(os.path.join(folder, "openracer-environment.hdr"))
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def setup_render(scene):
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    eevee = scene.eevee
    attempt(eevee, "taa_render_samples", SAMPLES)
    attempt(eevee, "taa_samples", 16)
    attempt(eevee, "use_raytracing", False)      # the game has no screen space reflections: it reflects the surroundings
    attempt(eevee, "use_ssr", False)
    attempt(eevee, "use_gtao", False)            # no ambient occlusion
    attempt(eevee, "use_bloom", False)           # no bloom
    attempt(eevee, "use_shadows", True)
    attempt(eevee, "use_soft_shadows", True)
    attempt(eevee, "use_shadow_jitter_viewport", True)
    scene.render.resolution_x, scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    attempt(scene.render, "filter_size", 1.0)

    view = scene.view_settings
    scene.display_settings.display_device = "sRGB"
    view.view_transform = "AgX" if VIEW.lower() == "agx" else "Standard"
    for look in ("None", "AgX - Base Contrast"):
        try:
            view.look = look
            break
        except TypeError:
            continue
    view.gamma = 1.0
    # the game multiplies by 1.2 (after a power of 1.1): 1.2 is 0.26 stops
    view.exposure = math.log2(1.2) if GAME_COLOUR else 0.0
    attempt(view, "use_curve_mapping", False)


def setup_world(scene, hdri):
    world = bpy.data.worlds.new("OpenRacer world")
    world.use_nodes = True
    tree = world.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputWorld")

    surroundings = tree.nodes.new("ShaderNodeBackground")
    if hdri:
        texture = tree.nodes.new("ShaderNodeTexEnvironment")
        texture.image = bpy.data.images.load(hdri, check_existing=True)
        texture.image.colorspace_settings.name = "Linear Rec.709" if "Linear Rec.709" in [e.identifier for e in texture.image.colorspace_settings.bl_rna.properties["name"].enum_items] else "Linear"
        tree.links.new(texture.outputs["Color"], surroundings.inputs["Color"])
    else:
        sky = tree.nodes.new("ShaderNodeTexSky")
        for sky_type in ("MULTIPLE_SCATTERING", "NISHITA", "HOSEK_WILKIE"):
            if attempt(sky, "sky_type", sky_type):
                break
        attempt(sky, "sun_elevation", math.radians(50))
        tree.links.new(sky.outputs["Color"], surroundings.inputs["Color"])
        print("OpenRacer: no openracer-environment.hdr found, a plain sky is used. Save the surroundings in the game (Esc menu).")
    surroundings.inputs["Strength"].default_value = 1.0

    # the ambient light of the game lights the car but is not seen by the camera
    ambient = tree.nodes.new("ShaderNodeBackground")
    ambient.inputs["Color"].default_value = tuple(srgb_to_linear(c) for c in AMBIENT) + (1.0,)
    ambient.inputs["Strength"].default_value = 1.0
    add = tree.nodes.new("ShaderNodeAddShader")
    tree.links.new(surroundings.outputs["Background"], add.inputs[0])
    tree.links.new(ambient.outputs["Background"], add.inputs[1])
    path = tree.nodes.new("ShaderNodeLightPath")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    tree.links.new(add.outputs["Shader"], mix.inputs[1])
    tree.links.new(surroundings.outputs["Background"], mix.inputs[2])
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])
    scene.world = world


def setup_lights(scene):
    for name, position, strength, shadow in LIGHTS:
        data = bpy.data.lights.new(name, "SUN")
        data.energy = strength
        data.angle = math.radians(0.5)
        attempt(data, "use_shadow", shadow)
        attempt(data, "use_contact_shadow", False)
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        # the game has y up and z towards the viewer; Blender has z up: (x, y, z) becomes (x, -z, y)
        towards = Vector((position[0], -position[2], position[1]))
        obj.location = towards.normalized() * 50.0
        obj.rotation_euler = (-towards).to_track_quat("-Z", "Y").to_euler()


def scene_bounds(scene):
    low = Vector((1e9, 1e9, 1e9))
    high = Vector((-1e9, -1e9, -1e9))
    found = False
    for obj in scene.objects:
        if obj.type != "MESH" or obj.name.startswith("OpenRacer"):
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            low = Vector((min(low[i], world[i]) for i in range(3)))
            high = Vector((max(high[i], world[i]) for i in range(3)))
            found = True
    return (low, high) if found else None


def setup_road(scene, bounds):
    low, high = bounds
    size = max(high.x - low.x, high.y - low.y) * 12
    mesh = bpy.data.meshes.new("OpenRacer road")
    half = size / 2
    centre = (low + high) / 2
    mesh.from_pydata([(-half, -half, 0), (half, -half, 0), (half, half, 0), (-half, half, 0)], [], [(0, 1, 2, 3)])
    road = bpy.data.objects.new("OpenRacer road", mesh)
    road.location = (centre.x, centre.y, low.z)
    scene.collection.objects.link(road)
    # (the picture of the surroundings already has the road in it, but a car needs a surface to cast its shadow on)
    material = bpy.data.materials.new("OpenRacer asphalt")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    # dark: the plane is lit by the surroundings and the suns, as the road of the game is by its lights
    bsdf.inputs["Base Color"].default_value = (0.075, 0.075, 0.08, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    mesh.materials.append(material)


def setup_camera(scene, bounds):
    if scene.camera is not None and not scene.camera.name.startswith("OpenRacer"):
        return
    low, high = bounds if bounds else (Vector((-2, -2, 0)), Vector((2, 2, 1.5)))
    centre = (low + high) / 2
    length = max(high.x - low.x, high.y - low.y)
    data = bpy.data.cameras.new("OpenRacer chase camera")
    # the chase camera of the game has a vertical field of view of 35 degrees
    data.sensor_fit = "VERTICAL"
    data.sensor_height = 24.0
    data.lens = 12.0 / math.tan(math.radians(35.0) / 2)
    data.clip_start = 0.1
    data.clip_end = 1000.0
    camera = bpy.data.objects.new("OpenRacer chase camera", data)
    scene.collection.objects.link(camera)
    distance = length * 2.08                       # the distance and the height of the camera of the game
    angle = math.radians(CAMERA_ANGLE)
    # a car from glTF looks towards -y: behind it is +y
    camera.location = (centre.x + math.sin(angle) * distance, centre.y + math.cos(angle) * distance, low.z + 2.34)
    target = bpy.data.objects.new("OpenRacer camera target", None)
    target.location = (centre.x, centre.y, low.z + (high.z - low.z) * 0.4)
    scene.collection.objects.link(target)
    track = camera.constraints.new("TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    scene.camera = camera


def main():
    scene = bpy.context.scene
    hdri = find_hdri()
    bounds = scene_bounds(scene)
    setup_render(scene)
    setup_world(scene, hdri)
    setup_lights(scene)
    if bounds and ROAD:
        setup_road(scene, bounds)
    setup_camera(scene, bounds)
    print("OpenRacer: the scene is set up like the game (%s, %s, exposure %.2f EV)." % (
        os.path.basename(hdri) if hdri else "no HDRI", scene.view_settings.view_transform, scene.view_settings.exposure))


main()
