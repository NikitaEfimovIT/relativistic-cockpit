"""Light, sky, cameras, the views to render, and the export the app will load."""

import math
import os

import bpy
from mathutils import Vector

from .cabin import LEFT_MOUNTS
from .geometry import collection
from .materials import set_emission
from .shape import CROWN, RIBS, WAIST, taper

# Collections that exist only for the renders; everything else is exported.
RENDER_ONLY = ('labels', 'dummy', 'hull', 'outside_light', 'cabin_lights', 'cameras')
TRIANGLE_BUDGET = 400_000


def reset_scene() -> None:
    for block in (bpy.data.objects, bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for item in list(block):
            block.remove(item)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)


def aim(obj, direction) -> None:
    """Point an object's −Z (cameras and lights look that way) along `direction`, with +Y kept up."""
    obj.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()


def build_world(strength: float) -> None:
    world = bpy.data.worlds.get('stars') or bpy.data.worlds.new('stars')
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    coords = nodes.new('ShaderNodeTexCoord')
    voronoi = nodes.new('ShaderNodeTexVoronoi')
    voronoi.inputs['Scale'].default_value = 70.0
    ramp = nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Max'].default_value = 0.04
    ramp.inputs['To Min'].default_value = 1.0
    ramp.inputs['To Max'].default_value = 0.0
    sharpen = nodes.new('ShaderNodeMath')
    sharpen.operation = 'POWER'
    sharpen.inputs[1].default_value = 6.0
    scale = nodes.new('ShaderNodeMath')
    scale.operation = 'MULTIPLY'
    scale.inputs[1].default_value = strength * 8.0
    background = nodes.new('ShaderNodeBackground')
    background.inputs['Color'].default_value = (0.9, 0.93, 1.0, 1.0)
    output = nodes.new('ShaderNodeOutputWorld')
    links.new(coords.outputs['Generated'], voronoi.inputs['Vector'])
    links.new(voronoi.outputs['Distance'], ramp.inputs['Value'])
    links.new(ramp.outputs['Result'], sharpen.inputs[0])
    links.new(sharpen.outputs['Value'], scale.inputs[0])
    links.new(scale.outputs['Value'], background.inputs['Strength'])
    links.new(background.outputs['Background'], output.inputs['Surface'])
    bpy.context.scene.world = world


def area_light(name: str, location, direction, size, energy: float, color, coll) -> None:
    data = bpy.data.lights.new(name, 'AREA')
    data.shape = 'RECTANGLE'
    data.size, data.size_y = size
    data.energy = energy
    data.color = color
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.visible_camera = False  # the light, not the panel it comes from
    aim(obj, direction)
    coll.objects.link(obj)


def build_lights():
    """The cabin's own lights under the arches, and a studio for the outside view, as the reference is lit."""
    cabin = collection('cabin_lights')
    for i, y in enumerate(RIBS):  # every arch carries a strip of light: here, the light it gives
        f = taper(y)
        area_light(f'rib_light_{i}', (0.0, y, WAIST + (CROWN - WAIST) * f - 0.07), (0.0, 0.0, -1.0), (1.3 * f, 0.05), 45.0 * f, (0.9, 0.95, 1.0), cabin)
    # ponytail: one lamp over the seat until the cockpit's own lights are laid out with the app's (the lighting step)
    area_light('cockpit_ceiling', (0.0, -0.3, CROWN - 0.12), (0.0, 0.25, -1.0), (1.2, 1.0), 90.0, (1.0, 0.97, 0.92), cabin)
    studio = collection('outside_light')
    area_light('softbox_top', (0.6, -1.0, 3.6), (-0.15, 0.0, -1.0), (3.5, 8.5), 1800.0, (1.0, 1.0, 1.0), studio)
    area_light('softbox_side', (4.0, 1.6, 0.4), (-1.0, -0.3, -0.1), (1.5, 3.0), 250.0, (0.95, 0.97, 1.0), studio)
    area_light('rim_back', (-1.5, -3.5, 1.5), (0.3, 1.0, -0.4), (2.0, 2.0), 300.0, (0.9, 0.95, 1.0), studio)
    return cabin


APP_VERTICAL_FOV = 2 * math.atan(math.tan(math.radians(50)) / (1000 / 640))  # what the app shows at 1000×640
APP_RESTING_PITCH = 0.16


def camera(name: str, location, target=None, rotation=None, lens=None, vertical_fov=None, ortho_scale=None):
    data = bpy.data.cameras.new(name)
    data.clip_start = 0.01
    if ortho_scale:
        data.type = 'ORTHO'
        data.ortho_scale = ortho_scale
    elif vertical_fov:
        data.sensor_fit = 'VERTICAL'
        data.angle_y = vertical_fov
    else:
        data.lens = lens
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    if target:
        aim(obj, Vector(target) - Vector(location))
    else:
        obj.rotation_euler = rotation
    collection('cameras').objects.link(obj)
    return obj


def build_cameras() -> dict:
    return {
        'pilot': camera('cam_pilot', (0, 0, 0), rotation=(math.pi / 2 - APP_RESTING_PITCH, 0, 0), vertical_fov=APP_VERTICAL_FOV),
        'hero': camera('cam_hero', (0.34, -0.5, 0.2), target=(-0.06, 0.95, -0.38), lens=19),  # over the shoulder, from behind the couch
        'left_wall': camera('cam_left_wall', (-0.2, 0.05, -0.22), target=(-0.69, 0.22, -0.4), lens=24),  # the life-support pod, close
        'seat': camera('cam_seat', (0.3, 1.25, 0.12), target=(-0.1, -0.3, -0.5), lens=20),  # from over the panel, back at the couch
        'outside': camera('cam_outside', (5.6, 4.4, 2.3), target=(0.0, -1.1, -0.5), lens=32),  # nose to the right, as on the reference
        'side': camera('cam_side', (-12.0, -2.7, -0.2), target=(0.0, -2.7, -0.2), ortho_scale=21.5),
        # the compartment at standing eye height: from the doorway aft, from the end wall forward, and at each wall
        'endwall': camera('cam_endwall', (-0.5, -3.33, 0.33), target=(-0.6, -4.4, 0.13), lens=22),
        'quarters': camera('cam_quarters', (0.0, -1.6, 0.4), target=(0.0, -13.0, -0.2), lens=16),  # from the cockpit door, aft down all three
        'quarters_back': camera('cam_quarters_back', (0.25, -12.8, 0.4), target=(0.0, -1.8, -0.2), lens=16),
        'doorway': camera('cam_doorway', (0.0, -2.6, 0.4), target=(0.0, 1.4, -0.25), lens=15),  # the bridge, as one walks into it
        'desk': camera('cam_desk', (0.7, -3.0, -0.1), target=(-1.3, -3.2, -0.6), lens=15),  # the engineering bay's desk
        'bed': camera('cam_bed', (-0.7, -6.6, -0.1), target=(1.3, -7.0, -0.9), lens=15),
        'board': camera('cam_board', (0.6, -3.2, 0.4), target=(1.15, -3.2, -0.27), lens=18),  # standing at the console
        'room': camera('cam_room', (0.6, -5.15, 0.4), target=(1.25, -5.15, 0.18), lens=22),  # the room panel by the bed
        'science': camera('cam_science', (0.0, -8.6, 0.4), target=(0.0, -12.55, -0.4), lens=15),
    }


# ---------------------------------------------------------------------------------------------------------------------
# Views

INSIDE_HIDDEN = ('dummy', 'hull', 'outside_light', 'canopy')  # from within, the glass is left out: the app draws its reflections itself
VIEWS = {
    # name: camera, resolution, cabin lights on, star brightness, hidden collections, cut away the left half
    'pilot_lit': ('pilot', (1000, 640), True, 1.0, INSIDE_HIDDEN, False),
    'pilot_dark': ('pilot', (1000, 640), False, 1.0, INSIDE_HIDDEN, False),
    'hero': ('hero', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'seat': ('seat', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'left_wall': ('left_wall', (1200, 750), True, 1.0, INSIDE_HIDDEN, False),
    'quarters': ('quarters', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'doorway': ('doorway', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'endwall': ('endwall', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'quarters_back': ('quarters_back', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'desk': ('desk', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'bed': ('bed', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'board': ('board', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'room': ('room', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'science': ('science', (1600, 900), True, 1.0, INSIDE_HIDDEN, False),
    'outside': ('outside', (1600, 1000), True, 1.5, ('canopy',), False),
    'side': ('side', (1200, 750), True, 0.5, ('canopy', 'exterior'), True),  # a cutaway: the outside would hide it
}


def is_left_of_section(obj) -> bool:
    node = obj
    while node:
        if '_left' in node.name or node.name in LEFT_MOUNTS:
            return True
        node = node.parent
    return False


def show_view(name: str, cameras: dict, mats) -> None:
    cam, (width, height), lights_on, stars, hidden, cut_left = VIEWS[name]
    scene = bpy.context.scene
    scene.camera = cameras[cam]
    scene.render.resolution_x, scene.render.resolution_y = width, height
    for coll in bpy.data.collections:
        coll.hide_render = coll.name in hidden or (coll.name == 'cabin_lights' and not lights_on)
    for obj in bpy.data.objects:
        obj.hide_render = cut_left and is_left_of_section(obj)
    set_emission(mats['strip'], 6.0 if lights_on else 0.0)
    build_world(stars)


def setup_render(is_fast: bool) -> None:
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for device in prefs.devices:
            device.use = True
        scene.cycles.device = 'GPU'
    except Exception as error:  # a CPU render is slower but just as right
        print('GPU unavailable, rendering on the CPU:', error)
    scene.cycles.samples = 24 if is_fast else 128
    scene.render.resolution_percentage = 55 if is_fast else 100
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.view_settings.view_transform = 'AgX'
    scene.render.image_settings.file_format = 'PNG'


def render_views(names: list[str], cameras: dict, mats, folder: str) -> None:
    os.makedirs(folder, exist_ok=True)
    for name in names:
        show_view(name, cameras, mats)
        bpy.context.scene.render.filepath = os.path.join(folder, f'{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', name)


# ---------------------------------------------------------------------------------------------------------------------
# Export


def export_glb(path: str) -> None:
    """What the app will load: the cabin, the glass and the named mounts, with modifiers applied; and how heavy it is."""
    for coll in bpy.data.collections:
        coll.hide_render = coll.name in RENDER_ONLY
    for obj in bpy.data.objects:
        obj.hide_render = False
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_renderable=True, export_apply=True, export_cameras=False, export_lights=False)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangles = 0
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or any(c.name in RENDER_ONLY for c in obj.users_collection):
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    mounts = sum(1 for obj in bpy.data.objects if obj.type == 'EMPTY')
    verdict = 'within' if triangles <= TRIANGLE_BUDGET else 'OVER'
    print(f'EXPORT {os.path.getsize(path) / 1e6:.1f} MB, {triangles} triangles ({verdict} the {TRIANGLE_BUDGET} budget), {mounts} mounts')
