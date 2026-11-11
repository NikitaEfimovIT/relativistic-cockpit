"""
The outside of the whole ship, as a concept to argue over before the inside is rebuilt to fit it.

  cd blender && /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup -P concept.py -- [--fast]

Writes renders/concept_*.png and concept.blend, and nothing the app loads. Axes as in cockpit.py: +Y forward, +Z up,
metres, the seated pilot's eye at the origin.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from cockpit_lib import stage  # noqa: E402  (needs the path above)
from cockpit_lib.exterior import RING_POINTS, WING, band, build_spine, build_trim, build_wings, hull_point, mirrored_bands  # noqa: E402
from cockpit_lib.geometry import Vec, collection, frange, sweep  # noqa: E402
from cockpit_lib.materials import make_materials, principled  # noqa: E402

# The hull is the inside wall of cockpit_lib/shape.py grown by its skin, so the interior and this outside cannot disagree;
# what the app loads of it too (spine, wings, loops, paint) is built in cockpit_lib/exterior.py. Here it is a solid tube
# with the glass laid over it, for the renders.
from cockpit_lib import shape  # noqa: E402
from cockpit_lib.quarters import PORTHOLES  # noqa: E402
from cockpit_lib.shape import CANOPY, DOOR_Y, SKIN, STERN, canopy_reach  # noqa: E402
from cockpit_lib.shape import NOSE as NOSE_TIP  # noqa: E402

LENGTH = NOSE_TIP - STERN


def build_hull(mats: dict, coll) -> None:
    angles = [2 * math.pi * i / RING_POINTS for i in range(RING_POINTS)]
    stations = frange(STERN, NOSE_TIP, 0.1)
    sweep('hull', [[hull_point(y, a) for a in angles] for y in stations], mats['white'], coll, closed_profile=True, caps=True)





# ---------------------------------------------------------------------------------------------------------------------
# What sits on the hull

def build_canopy(glass, coll) -> None:
    """One long drop of glass, as on the art: a point where it leaves the back, widest by the pilot, round at the nose."""
    y0, y1, _ = CANOPY
    rings = []
    for i in range(121):
        y = y0 + (y1 - y0) * i / 120
        rings.append([hull_point(y, math.pi / 2 + canopy_reach(y) * (j / 20 - 1.0), 0.012) for j in range(41)])
    sweep('canopy', rings, glass, coll)


def build_glazing(mats: dict, coll) -> None:
    """The canopy with its white frame, as from the pilot's seat (a pane ahead and overhead, a window each side), and
    the windows of the compartments, set in a dark band that runs forward into the canopy."""
    glass = principled('concept_glass', (0.012, 0.016, 0.024), roughness=0.06, coat=1.0)
    build_canopy(glass, coll)
    mirrored_bands('pillar', DOOR_Y + 0.45, DOOR_Y + 5.0, 37.0, 48.0, mats['white'], coll, grow=0.03)
    band('hoop', DOOR_Y + 0.3, DOOR_Y + 0.6, 37.0, 143.0, mats['white'], coll, grow=0.03, step=0.05)
    for zone, y0, y1 in PORTHOLES:
        mirrored_bands(f'porthole_{zone}', y0, y1, 7.5, 37.5, glass, coll, grow=0.014)  # as cut inside: points 1 to 5 of the vault


def nozzle(name: str, x: float, z: float, radius: float, mats: dict, glow, coll) -> None:
    def circle(y: float, r: float) -> list[Vec]:
        return [(x + r * math.cos(a), y, z + r * math.sin(a)) for a in (2 * math.pi * i / 32 for i in range(32))]
    bell = ((STERN + 0.3, 0.8), (STERN - 0.5, 1.0), (STERN - 0.5, 0.88), (STERN - 0.05, 0.6))  # the hull's end cap is at STERN: the throat stays abaft it
    sweep(name, [circle(y, radius * k) for y, k in bell], mats['dark_metal'], coll, closed_profile=True)
    sweep(f'{name}_glow', [circle(STERN - 0.05, radius * 0.6), circle(STERN - 0.05, 1e-4)], glow, coll, closed_profile=True)


def build_wings_and_engines(mats: dict, coll) -> None:
    build_wings(mats, coll)
    glow = principled('engine_glow', (0.0, 0.0, 0.0), emission=(0.35, 0.75, 1.0), strength=14.0)
    nozzle('nozzle_main', 0.0, 0.0, 0.62, mats, glow, coll)
    nozzle('nozzle_right', 0.64, -0.78, 0.42, mats, glow, coll)
    nozzle('nozzle_left', -0.64, -0.78, 0.42, mats, glow, coll)


# ---------------------------------------------------------------------------------------------------------------------
# Light, cameras, renders

def sun(name: str, direction: Vec, energy: float, color: Vec, coll) -> None:
    data = bpy.data.lights.new(name, 'SUN')
    data.energy, data.color, data.angle = energy, color, math.radians(3.0)
    obj = bpy.data.objects.new(name, data)
    stage.aim(obj, direction)
    coll.objects.link(obj)


AMIDSHIPS = (STERN + NOSE_TIP) / 2
VIEWS = {
    # name: where the camera stands, what it looks at (or None: straight down, nose to the right), lens or ortho scale, resolution
    'three_quarter': ((17.0, 14.5, 8.5), (0.0, AMIDSHIPS, -0.3), 35.0, None, (1600, 1000)),  # nose to the right, as on the art
    'side': ((40.0, AMIDSHIPS, 0.3), (0.0, AMIDSHIPS, 0.3), None, 27.5, (1600, 520)),
    'top': ((0.0, AMIDSHIPS, 40.0), None, None, 27.5, (1600, 1100)),
    'front': ((8.5, 19.0, -0.6), (0.0, 2.0, -0.3), 40.0, None, (1600, 1000)),
    'rear': ((-13.0, -30.0, 6.5), (0.0, -7.5, -0.2), 40.0, None, (1600, 1000)),
}


def render(is_fast: bool) -> None:
    stage.setup_render(is_fast)
    stage.build_world(1.0)
    scene = bpy.context.scene
    for name, (location, target, lens, ortho, size) in VIEWS.items():
        rotation = None if target else (0.0, 0.0, math.pi / 2)
        scene.camera = stage.camera(f'cam_{name}', location, target=target, rotation=rotation, lens=lens, ortho_scale=ortho)
        scene.render.resolution_x, scene.render.resolution_y = size
        scene.render.filepath = os.path.join(HERE, 'renders', f'concept_{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', name)


def main() -> None:
    shape.check()
    stage.reset_scene()
    mats = make_materials()
    ship = collection('ship')
    build_hull(mats, ship)
    build_glazing(mats, ship)
    build_trim(mats, ship)
    build_spine(mats, ship)
    build_wings_and_engines(mats, ship)
    lights = collection('lights')
    sun('key', (-0.5, -0.4, -0.75), 5.0, (1.0, 0.98, 0.95), lights)
    sun('fill', (0.6, 0.5, 0.35), 0.8, (0.7, 0.8, 1.0), lights)
    print(f'CONCEPT length {LENGTH:.1f} m, span {2 * WING[-1][0]:.1f} m, hull {2 * (shape.HALF + SKIN):.2f} x {shape.CROWN - shape.WAIST + shape.KEEL_DEPTH + 2 * SKIN:.2f} m')
    render('--fast' in sys.argv)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'concept.blend'))


main()
