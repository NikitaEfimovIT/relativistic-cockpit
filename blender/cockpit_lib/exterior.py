"""The outside of the ship, for the concept renders (concept.py) and the model the app loads (cockpit.py) alike: the hull,
which is the inside wall of shape.py grown by its skin, the spine along its back, the wings and the loops, and the paint.

In the app the hull is open wherever the cabin has glass, so that the pilot sees out past it; the wings are cut back to
the middle of the skin, so that their roots, which the concept buries in a solid hull, do not stand in the cabin."""

import math

import bpy
from mathutils import Vector

from . import shape
from .geometry import Vec, collection, frange, mesh_object, sweep
from .materials import principled
from .quarters import PORTHOLES
from .shape import CANOPY, DOOR_Y, SKIN, STERN, TAIL, ZONES, canopy_reach, clamp
from .shape import NOSE as NOSE_TIP

RING_POINTS = 96  # 3.75° apart, so that the portholes' edges, 7.5° and 37.5° round from the waist, fall on them
STEP = 0.1  # m between the hull's rings
PORTHOLE_ANGLES = ((7.5, 37.5), (142.5, 172.5))  # degrees round from the right waist: points 1 to 5 of the vault inside
GLASS_FRONT = CANOPY[1]


def hull_point(y: float, angle: float, grow: float = 0.0) -> Vec:
    """The outside: the section of the inside grown by the skin, and by `grow` past it."""
    return shape.hull_point(y, angle, SKIN + grow)


def stations(y0: float, y1: float, cuts: tuple[float, ...] = ()) -> list[float]:
    """Rings STEP apart from y0 to y1, with a ring on every cut and none in a sliver beside one."""
    n = max(1, round((y1 - y0) / STEP))
    ys = sorted({y0 + (y1 - y0) * i / n for i in range(n + 1)} | {c for c in cuts if y0 < c < y1})
    return [y for i, y in enumerate(ys) if i == 0 or y - ys[i - 1] > 0.02 or y in cuts]


# ---------------------------------------------------------------------------------------------------------------------
# The hull

def in_porthole(y: float, angle_deg: float) -> bool:
    return any(y0 < y < y1 for _, y0, y1 in PORTHOLES) and any(a0 < angle_deg < a1 for a0, a1 in PORTHOLE_ANGLES)


def build_aft_hull(mat, coll) -> None:
    """From the stern to the cockpit door, whole rings, with the portholes left open; the stern capped."""
    ys = stations(STERN, DOOR_Y, tuple(y for _, y0, y1 in PORTHOLES for y in (y0, y1)))
    angles = [2 * math.pi * i / RING_POINTS for i in range(RING_POINTS)]
    verts = [hull_point(y, a) for y in ys for a in angles]
    faces = [tuple(range(RING_POINTS - 1, -1, -1))]
    for r in range(len(ys) - 1):
        a, b = r * RING_POINTS, (r + 1) * RING_POINTS
        mid_y = (ys[r] + ys[r + 1]) / 2
        faces += [(a + i, a + (i + 1) % RING_POINTS, b + (i + 1) % RING_POINTS, b + i) for i in range(RING_POINTS)
                  if not in_porthole(mid_y, (i + 0.5) * 360 / RING_POINTS)]
    mesh_object('hull_aft', verts, faces, mat, coll, smooth=True)


def build_fore_hull(mat, coll) -> None:
    """From the cockpit door to the nose, round from one edge of the canopy's glass to the other under the keel; the
    nose capped. Ahead of the glass the edges meet at the top and the rings close."""
    ys = stations(DOOR_Y, NOSE_TIP, (GLASS_FRONT,))
    count = RING_POINTS + 1

    def ring(y: float) -> list[Vec]:
        r = canopy_reach(y)
        a0, a1 = math.pi / 2 + r, 2.5 * math.pi - r
        return [hull_point(y, a0 + (a1 - a0) * i / RING_POINTS) for i in range(count)]

    verts = [p for y in ys for p in ring(y)]
    last = (len(ys) - 1) * count
    faces = [tuple(range(last, last + RING_POINTS))]
    for r in range(len(ys) - 1):
        a, b = r * count, (r + 1) * count
        faces += [(a + i, a + i + 1, b + i + 1, b + i) for i in range(RING_POINTS)]
    mesh_object('hull_fore', verts, faces, mat, coll, smooth=True)


def build_reveals(mat, coll) -> None:
    """Through the skin round the canopy's glass: each long edge, and the aft edge over the door."""
    ys = stations(DOOR_Y, GLASS_FRONT)
    for name, side in (('right', -1), ('left', 1)):
        sweep(f'hull_reveal_{name}', [[hull_point(y, math.pi / 2 + side * canopy_reach(y), grow) for grow in (-SKIN, 0.0)] for y in ys],
              mat, coll)
    r = canopy_reach(DOOR_Y)
    arc = [math.pi / 2 - r + 2 * r * i / 32 for i in range(33)]
    sweep('hull_reveal_aft', [[hull_point(DOOR_Y, a, grow) for a in arc] for grow in (-SKIN, 0.0)], mat, coll)


def build_open_hull(mats: dict, coll) -> None:
    build_aft_hull(mats['white'], coll)
    build_fore_hull(mats['white'], coll)
    build_reveals(mats['white'], coll)


# ---------------------------------------------------------------------------------------------------------------------
# Paint and the spine

def band(name: str, y0: float, y1: float, a0: float, a1: float, mat, coll, grow: float = 0.012, step: float = 0.1):
    """A patch of the hull's own surface, lifted off it by `grow`: glass, a frame, the dark belly, a stripe. Angles in degrees."""
    count = max(2, round(abs(a1 - a0) / 3) + 1)
    angles = [math.radians(a0 + (a1 - a0) * i / (count - 1)) for i in range(count)]
    n = max(1, round((y1 - y0) / step))
    ys = [y0 + (y1 - y0) * i / n for i in range(n + 1)]
    return sweep(name, [[hull_point(y, a, grow) for a in angles] for y in ys], mat, coll)


def mirrored_bands(name: str, y0: float, y1: float, a0: float, a1: float, mat, coll, **how) -> None:
    band(f'{name}_right', y0, y1, a0, a1, mat, coll, **how)
    band(f'{name}_left', y0, y1, 180.0 - a1, 180.0 - a0, mat, coll, **how)


def build_trim(mats: dict, coll) -> None:
    """The dark belly, the red line along the waist, and the dark band the portholes sit in, broken at each of them and
    stopping at the canopy, so that it never covers glass."""
    band('belly', STERN, NOSE_TIP - 0.8, 225.0, 315.0, mats['graphite'], coll, grow=0.008)
    red = principled('hull_red', (0.55, 0.03, 0.02), roughness=0.4)  # paint: the lamp red of the cabin would glow
    mirrored_bands('red_line', ZONES[0][2], NOSE_TIP - 0.7, -6.0, -4.0, red, coll, grow=0.015)
    ends = [TAIL - 0.2, *(y for _, y0, y1 in sorted(PORTHOLES, key=lambda p: p[1]) for y in (y0, y1)), DOOR_Y]
    for i, (y0, y1) in enumerate(zip(ends[::2], ends[1::2])):
        mirrored_bands(f'side_band_{i}', y0, y1, 8.0, 32.0, mats['graphite'], coll, grow=0.008)


def top_line(y: float) -> float:
    return shape.waist(y) + shape.canopy_height(y) + SKIN


def build_spine(mats: dict, coll) -> None:
    """A raised back from behind the cockpit to the engines: where the art carries its dark ridge."""
    y0, y1 = STERN + 0.3, DOOR_Y - 1.0
    rings = []
    for y in frange(y0, y1, 0.2):
        g = clamp(min((y - y0) / 1.0, (y1 - y) / 3.5)) ** 0.5
        rings.append([(0.72 * g * math.cos(a), y, top_line(y) - 0.06 + (0.06 + 0.34 * g) * math.sin(a))
                      for a in (math.pi * i / 16 for i in range(17))])
    sweep('spine', rings, mats['white'], coll)


# ---------------------------------------------------------------------------------------------------------------------
# Wings and loops

Station = tuple[float, float, float, float, float]  # x out from the centre line, z, leading edge y, trailing edge y, thickness
WING: tuple[Station, ...] = (
    (0.9, -0.85, NOSE_TIP - 2.4, STERN + 0.4, 0.14),  # a chine along the nose,
    (1.8, -0.80, DOOR_Y + 1.2, STERN + 0.4, 0.30),
    (2.2, -0.80, DOOR_Y - 4.2, STERN + 0.4, 0.32),  # that turns into a swept wing abaft the engineering bay
    (6.6, -0.55, STERN + 2.4, STERN + 0.2, 0.08),
)
# The loop of the art: from each wing tip a fin rises, bends over and runs forward as a brace into the back of the hull.
# The centre line (x, y, z), the chord and the thickness; the first station is the wing tip, the last is buried in the spine.
LOOP = (
    ((6.6, STERN + 1.3, -0.55), 2.2, 0.08),
    ((6.45, STERN + 1.0, 0.9), 1.9, 0.09),
    ((6.1, STERN + 0.9, 2.2), 1.4, 0.08),
    ((5.2, STERN + 1.5, 2.9), 0.8, 0.07),
    ((3.6, STERN + 3.2, 2.8), 0.5, 0.06),
    ((1.9, STERN + 5.4, 2.1), 0.4, 0.06),
    ((0.45, STERN + 7.4, 1.2), 0.35, 0.06),
)


def lifting(name: str, stations_: tuple[Station, ...], side: float, mat, coll):
    """A wing: lens sections joined along the span. side is +1 for the right, −1 for the left."""
    rings = [[(side * x, (le + te) / 2 + (le - te) / 2 * math.cos(a), z + thick / 2 * math.sin(a))
              for a in (2 * math.pi * i / 16 for i in range(16))] for (x, z, le, te, thick) in stations_]
    return sweep(name, rings, mat, coll, closed_profile=True, caps=True)


def catmull_rom(points: list[tuple[float, ...]], samples: int) -> list[tuple[float, ...]]:
    """A smooth curve through every point, `samples` steps to a span; all the numbers of a point are carried along."""
    padded = [points[0], *points, points[-1]]
    out = []
    for i in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[i - 1:i + 3]
        for k in range(samples):
            t = k / samples
            out.append(tuple(0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3)
                             for a, b, c, d in zip(p0, p1, p2, p3)))
    return out + [points[-1]]


def build_loop(name: str, side: float, chord_scale: float, thick_scale: float, mat, coll) -> None:
    """A lens section carried along the loop. Its chord is the tangent turned a quarter in the yz-plane, so the ribbon
    does not twist at the bend: along y in the fin, standing up in the brace."""
    path = catmull_rom([(*centre, chord, thick) for centre, chord, thick in LOOP], 8)
    rings = []
    for i, (x, y, z, chord, thick) in enumerate(path):
        a, b = path[max(i - 1, 0)], path[min(i + 1, len(path) - 1)]
        tangent = Vector((b[0] - a[0], b[1] - a[1], b[2] - a[2])).normalized()
        across = Vector((0.0, -tangent.z, tangent.y)).normalized()
        through = tangent.cross(across).normalized()
        ring = []
        for k in range(16):
            u = 2 * math.pi * k / 16
            q = Vector((x, y, z)) + across * (chord * chord_scale / 2 * math.cos(u)) + through * (thick * thick_scale / 2 * math.sin(u))
            ring.append((side * q.x, q.y, q.z))
        rings.append(ring)
    sweep(name, rings, mat, coll, closed_profile=True, caps=True)


def cut_away(obj, cutter) -> None:
    """obj less what lies inside cutter, baked into its mesh."""
    cut = obj.modifiers.new('cut', 'BOOLEAN')
    cut.operation, cut.solver, cut.object = 'DIFFERENCE', 'EXACT', cutter
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    obj.modifiers.remove(cut)
    old, obj.data = obj.data, mesh
    bpy.data.meshes.remove(old)


def build_wings(mats: dict, coll) -> None:
    """The wings, cut back to the middle of the skin (a solid hull there, used and thrown away), and the loops."""
    angles = [-2 * math.pi * i / RING_POINTS for i in range(RING_POINTS)]  # clockwise, so that its faces look out: the
    # boolean takes a solid turned inside out for the space round it
    cutter = sweep('hull_cutter', [[hull_point(y, a, -SKIN / 2) for a in angles] for y in stations(STERN - 0.01, NOSE_TIP)],
                   mats['white'], coll, closed_profile=True, caps=True)
    for tag, side in (('right', 1.0), ('left', -1.0)):
        cut_away(lifting(f'wing_{tag}', WING, side, mats['white'], coll), cutter)
        build_loop(f'loop_{tag}', side, 1.0, 1.0, mats['white'], coll)
        build_loop(f'loop_stripe_{tag}', side, 0.4, 1.3, mats['graphite'], coll)  # the dark band down its middle
    bpy.data.objects.remove(cutter)


def build_exterior(mats: dict) -> None:
    """What the app loads of the outside: the open hull, its paint, the spine, the wings and the loops. The engines'
    nozzles are left to the concept: from inside they are never in view."""
    coll = collection('exterior')
    build_open_hull(mats, coll)
    build_trim(mats, coll)
    build_spine(mats, coll)
    build_wings(mats, coll)
