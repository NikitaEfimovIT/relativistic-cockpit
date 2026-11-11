"""The dash under the panel, as in a car: a skirt down to the deck under each wing with the footwell open under the
centre screen, a cheek out to each wall, and the top running on from behind the screens to the nose, under the glass.
And the desks either side of the seat, from beside it out to the walls and forward to the foot of the panel."""

import math

from .cabin import CONSOLE_INNER, CONSOLE_TOP, RIB_DEPTH, RIB_WIDTH
from .geometry import Vec, collection, frame_point, frange, loft, mesh_object, sweep
from .panel import PANEL_HEIGHT, facets
from .shape import BOW_Y, CROWN, FLOOR, GLASS_FRONT, HEADER_SPAN, NOSE, UPPER_EXPONENT, WAIST, glass_sill, half_width, hull_point, scales, waist

TOP_PROFILE = ((1.05, -0.32), (2.2, -0.47), (NOSE, -0.62))  # (y, z) of the dash top, joined by straight lines
TOP_Z = TOP_PROFILE[0][1]  # where it meets the faces of the panel
GLASS_MARGIN = 0.03  # m the top keeps under the glass's lower edge, so that it meets white wall and not glass
DESK_BACK = -0.2  # m: the desks start beside the seat's back
FOOTWELL_DEPTH, FOOTWELL_TOP = 0.6, -0.72  # under the row of switches


def top_z(y: float) -> float:
    for (y0, z0), (y1, z1) in zip(TOP_PROFILE, TOP_PROFILE[1:]):
        if y <= y1:
            return z0 + (z1 - z0) * max(0.0, (y - y0) / (y1 - y0))
    return TOP_PROFILE[-1][1]


def wall(y: float) -> float:
    return max(half_width(y, top_z(y)) - 0.004, 0.0)


def wing_line(wing) -> tuple[Vec, Vec]:
    """Where a wing's face goes down into the dash top: its inner end (at the hinge), then its outer end."""
    centre, axes, width, _ = wing
    v = (TOP_Z - centre[2]) / axes[1][2]
    inner, outer = sorted((frame_point(centre, axes, u, v) for u in (-width / 2, width / 2)), key=lambda p: abs(p[0]))
    return inner, outer


def bottom_edge(wing) -> tuple[Vec, Vec]:
    centre, axes, width, _ = wing
    return tuple(sorted((frame_point(centre, axes, u, -PANEL_HEIGHT / 2) for u in (-width / 2, width / 2)), key=lambda p: abs(p[0])))


def build_top(by_name: dict, mats) -> None:
    """Full width forward of the hinges; abaft them, only outboard of the wings, which stand further aft towards the walls."""
    cabin = collection('cabin')
    inner, outer = wing_line(by_name['right'])
    for y in frange(outer[1], GLASS_FRONT, 0.05):
        assert top_z(y) < glass_sill(y) - GLASS_MARGIN, f'the dash top comes up into the glass at y = {y:.2f}'
    loft('dash_top', frange(inner[1], NOSE - 0.02, 0.1), lambda y: [(-wall(y), top_z(y)), (wall(y), top_z(y))], mats['white'], cabin)

    def from_wing(y: float) -> float:
        t = (y - outer[1]) / (inner[1] - outer[1])
        return outer[0] + (inner[0] - outer[0]) * t

    sides = frange(outer[1], inner[1], 0.03)
    loft('dash_top_right', sides, lambda y: [(from_wing(y), top_z(y)), (wall(y), top_z(y))], mats['white'], cabin)
    loft('dash_top_left', sides, lambda y: [(-wall(y), top_z(y)), (-from_wing(y), top_z(y))], mats['white'], cabin)


def build_front(by_name: dict, mats) -> None:
    """Skirts from the wings' lower edges to the deck, a cheek from each wing's outer end to the wall, and the footwell."""
    cabin = collection('cabin')
    for name, side in (('right', 1), ('left', -1)):
        (ix, iy, iz), (ox, oy, oz) = bottom_edge(by_name[name])
        mesh_object(f'dash_skirt_{name}', [(ix, iy, iz), (ox, oy, oz), (ox, oy, FLOOR), (ix, iy, FLOOR)], [(0, 1, 2, 3)], mats['white'], cabin)
        _, (wx, wy, _) = wing_line(by_name[name])
        heights = [FLOOR + (TOP_Z - FLOOR) * i / 8 for i in range(9)]
        cheek = [(wx, wy, FLOOR)] + [(side * half_width(wy, z), wy, z) for z in heights] + [(wx, wy, TOP_Z)]
        mesh_object(f'dash_cheek_{name}', cheek, [tuple(range(len(cheek)))], mats['white'], cabin)
    (x, y, _), _ = bottom_edge(by_name['right'])
    back = y + FOOTWELL_DEPTH
    corners = [(-x, y, FLOOR), (x, y, FLOOR), (x, back, FLOOR), (-x, back, FLOOR),
               (-x, y, FOOTWELL_TOP), (x, y, FOOTWELL_TOP), (x, back, FOOTWELL_TOP), (-x, back, FOOTWELL_TOP)]
    faces = [(2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7), (4, 5, 6, 7)]  # back, the two sides and the roof: open to the pilot
    mesh_object('dash_footwell', corners, faces, mats['graphite'], cabin)


def desk_outline(by_name: dict) -> list[tuple[float, float]]:
    """In plan, round the right-hand desk: out to the wall beside the seat, forward to the wing, back along its foot."""
    (ix, iy, _), (ox, oy, _) = bottom_edge(by_name['right'])
    wall_x = half_width(oy, CONSOLE_TOP) - 0.003
    front = iy + (oy - iy) * (CONSOLE_INNER - ix) / (ox - ix) - 0.01
    return [(CONSOLE_INNER, DESK_BACK), (wall_x, DESK_BACK), (wall_x, oy - 0.01), (ox, oy - 0.01), (CONSOLE_INNER, front)]


def prism(name: str, outline: list[tuple[float, float]], z0: float, z1: float, mat, coll):
    """A solid standing on a plan outline that runs anticlockwise seen from above."""
    n = len(outline)
    verts = [(x, y, z0) for x, y in outline] + [(x, y, z1) for x, y in outline]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return mesh_object(name, verts, faces, mat, coll)


def build_desks(by_name: dict, mats) -> None:
    cabin = collection('cabin')
    right = desk_outline(by_name)
    for name, outline in (('right', right), ('left', [(-x, y) for x, y in reversed(right)])):
        prism(f'console_{name}', outline, FLOOR, CONSOLE_TOP, mats['white'], cabin)
        cx, cy = (sum(c) / len(outline) for c in zip(*outline))
        inset = [(cx + (x - cx) * 0.92, cy + (y - cy) * 0.92, CONSOLE_TOP + 0.002) for x, y in outline]
        mesh_object(f'console_{name}_top', inset, [tuple(range(len(inset)))], mats['graphite_soft'], cabin)


def angle_at(y: float, z: float) -> float:
    """Round the vault from the right-hand waist to where the wall is at height z (the inverse of hull_point)."""
    u = (z - waist(y)) / ((CROWN - WAIST) * scales(y)[1])
    return math.asin(min(max(u, 0.0), 1.0) ** (UPPER_EXPONENT / 2))


def build_front_pillars(by_name: dict, mats) -> None:
    """From each end of the header down and aft to the outer top corner of a wing, against the wall: between the glass
    ahead and the glass at the side. A strip of light down the middle, as on the roof pillars."""
    cabin, half = collection('cabin'), RIB_WIDTH / 2
    centre, axes, width, _ = by_name['right']
    _, foot_y, foot_z = frame_point(centre, axes, width / 2, PANEL_HEIGHT / 2)
    top, foot = math.radians(HEADER_SPAN[0]), angle_at(foot_y, foot_z + 0.03)
    stations = [(BOW_Y + (foot_y - BOW_Y) * i / 24, top + (foot - top) * i / 24) for i in range(25)]
    for name, turn in (('right', lambda a: a), ('left', lambda a: math.pi - a)):
        rings = [[hull_point(y + dy, turn(a), grow) for dy, grow in ((-half, 0.005), (half, 0.005), (half, -RIB_DEPTH), (-half, -RIB_DEPTH))]
                 for y, a in stations]
        sweep(f'pillar_front_{name}', rings, mats['white'], cabin, closed_profile=True, caps=True)
        strip = [[hull_point(y + dy, turn(a), -RIB_DEPTH - 0.001) for dy in (-0.012, 0.012)] for y, a in stations]
        sweep(f'light_line_pillar_front_{name}', strip, mats['strip'], cabin)


def build_dash(mats) -> None:
    by_name = {name: (centre, axes, width, yaw) for name, centre, axes, width, yaw in facets()}
    build_top(by_name, mats)
    build_front(by_name, mats)
    build_desks(by_name, mats)
    build_front_pillars(by_name, mats)
