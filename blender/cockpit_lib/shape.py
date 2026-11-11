"""The shape of the hull: one section for the whole ship, as functions of Y (forward). Metres, the pilot's eye at the origin.

The section is the inside wall; the outside is the same section grown by SKIN. concept.py draws the outside from it."""

import math

from .geometry import Point2, Vec, superellipse

# Along the ship, stern to nose. The zones are those of the concept art; their lengths are a choice.
# Everything is counted from the cockpit door: where it is behind the eye puts the seat and the panel mid-cockpit.
DOOR_Y = -1.35
AFT_OF_DOOR = (('engineering', 3.6), ('living', 4.0), ('science', 3.6), ('engines', 3.4))  # m long, going aft
COCKPIT_LENGTH, NOSE_LENGTH = 3.0, 6.4  # the cockpit, and the nose ahead of it


def stack_zones() -> tuple[tuple[str, float, float], ...]:
    found, y = [('cockpit', DOOR_Y, DOOR_Y + COCKPIT_LENGTH)], DOOR_Y
    for name, length in AFT_OF_DOOR:
        found.insert(0, (name, y - length, y))
        y -= length
    return tuple(found)


ZONES = stack_zones()
STERN = ZONES[0][1]
TAIL = ZONES[1][1]  # the aft wall of the science bay: the inside ends here
NOSE = ZONES[-1][2] + NOSE_LENGTH  # the tip
TAPER_START = ZONES[-1][1]  # the section shrinks and droops forward of the cockpit door, so the pilot sits in the nose

# Sitting, the eye is 0.79 m above the seat and the seat 0.43 m above the deck (a 50th-percentile man; sources in FORMULAS.md)
FLOOR = -1.22
CROWN = 0.88  # the top of the vault, 2.10 m above the deck
WAIST = -0.27  # where the hull is widest, 0.95 m above the deck
HALF = 1.30  # m from the centre line to the wall at the waist
KEEL_DEPTH = 1.25  # the lower curve runs on to a keel this far under the waist; the deck cuts it short
UPPER_EXPONENT, LOWER_EXPONENT = 2.6, 4.0
WIDTH_TAPER, HEIGHT_TAPER = 2.4, 1.2  # the nose flattens before it narrows,
TIP_ROUND = 0.7  # and ends in a rounded bill, not a needle: below 1 the tip is blunt
DROOP = 0.9  # m the tip hangs below the waist line
STERN_PINCH = 0.22  # the share of the section lost over the engine bay (outside only)
SKIN = 0.11  # from the inner wall to the outer hull
CANOPY = (DOOR_Y - 2.4, DOOR_Y + 7.6, 90.0)  # widest ahead of the seat: the side glass comes down by it  # the drop of glass outside: from, to, and how far it reaches round from the top at its widest (°)

QUARTERS_FRONT, QUARTERS_AFT = TAPER_START, TAIL  # the cockpit door and the end wall
CANOPY_AFT = TAPER_START  # inside, the glass starts at the cockpit door,
BOW_Y = 1.2  # and is in two pieces that meet under the header, 30° above the eye's horizon
HEADER_SPAN = (70.0, 110.0)  # ° round from the waist: the header between the two roof pillars
DASH_Y = 0.75  # the face of the panel: forward of it the dash fills the nose
GLASS_FRONT = CANOPY[1]
RIBS = (ZONES[2][1], ZONES[3][1], QUARTERS_FRONT)  # at the zone boundaries, clear of the portholes
WALL_POINTS, VAULT_POINTS = 8, 25

# ponytail: names the furniture, the wall board and the walk map still import; they go when those are refitted
QUARTERS_HALF = HALF
QUARTERS_FLOOR, QUARTERS_CEILING = FLOOR, CROWN
AFT_BULKHEAD = QUARTERS_FRONT
DOOR_HALF, DOOR_TOP = 0.55, FLOOR + 2.0  # the opening in the cockpit's bulkhead


def clamp(t: float) -> float:
    return min(max(t, 0.0), 1.0)


def nose_t(y: float) -> float:
    return clamp((y - TAPER_START) / (NOSE - TAPER_START))


def scales(y: float) -> tuple[float, float]:
    """How much of the full width and of the full height the section keeps at y."""
    t = nose_t(y)
    pinch = 1.0 - STERN_PINCH * clamp((ZONES[0][2] - y) / (ZONES[0][2] - STERN)) ** 2
    return (1.0 - t ** WIDTH_TAPER) ** TIP_ROUND * pinch, (1.0 - t ** HEIGHT_TAPER) ** TIP_ROUND * pinch


def waist(y: float) -> float:
    return WAIST - DROOP * nose_t(y) ** 2


def taper(y: float) -> float:
    """1 along the parallel body, falling to 0 at the nose: the share of the height."""
    return scales(y)[1]


def hull_point(y: float, angle: float, grow: float = 0.0) -> Vec:
    """A point of the section: the angle runs from the right-hand waist (0) over the top (π/2) to the left, on under the keel."""
    fw, fh = scales(y)
    c, s = math.cos(angle), math.sin(angle)
    n, height = (UPPER_EXPONENT, CROWN - WAIST) if s >= 0 else (LOWER_EXPONENT, KEEL_DEPTH)
    x = math.copysign(abs(c) ** (2 / n), c) * max(HALF * fw + grow, 0.0)
    return (x, y, waist(y) + math.copysign(abs(s) ** (2 / n), s) * max(height * fh + grow, 0.0))


def arc(y: float, a0: float, a1: float, count: int, grow: float = 0.0) -> list[Vec]:
    """count points of the section from angle a0 to a1 (radians)."""
    return [hull_point(y, a0 + (a1 - a0) * i / (count - 1), grow) for i in range(count)]


def canopy_reach(y: float) -> float:
    """How far the glass reaches round from the top at y, in radians: a point aft, widest by the pilot, round at the nose."""
    y0, y1, widest = CANOPY
    u = clamp((y - y0) / (y1 - y0))
    peak = (1 / 3) ** 0.25 * (2 / 3) ** 0.5  # the most of √u·√(1 − u²), at u = 1/√3
    return math.radians(widest) * u ** 0.5 * (1.0 - u * u) ** 0.5 / peak


def lower(y: float, grow: float = 0.0, to_keel: bool = False) -> list[Point2]:
    """The right-hand wall from the edge of the deck (or from the keel) up to the waist. `grow` moves it outwards."""
    fw, fh = scales(y)
    depth = max(KEEL_DEPTH * fh + grow, 1e-9)
    reach = 1.0 if to_keel else min(1.0, max(waist(y) - FLOOR, 0.0) / depth)
    start = -math.asin(reach ** (LOWER_EXPONENT / 2))
    return superellipse(HALF * fw + grow, depth, waist(y), LOWER_EXPONENT, start, 0.0, WALL_POINTS)


def upper(y: float, grow: float = 0.0) -> list[Point2]:
    """Over the vault, from the waist on the right to the waist on the left."""
    fw, fh = scales(y)
    return superellipse(HALF * fw + grow, (CROWN - WAIST) * fh + grow, waist(y), UPPER_EXPONENT, 0.0, math.pi, VAULT_POINTS)


def mirrored(points: list[Point2]) -> list[Point2]:
    return [(-x, z) for x, z in reversed(points)]


def section(y: float, grow: float = 0.0, to_keel: bool = False) -> list[Point2]:
    """The whole outline: up the right-hand wall, over the vault and down the left."""
    wall = lower(y, grow, to_keel)
    return wall[:-1] + upper(y, grow) + mirrored(wall)[1:]


def half_width(y: float, z: float, grow: float = 0.0) -> float:
    """From the centre line to the wall at height z."""
    fw, fh = scales(y)
    height, n = (CROWN - WAIST, UPPER_EXPONENT) if z >= waist(y) else (KEEL_DEPTH, LOWER_EXPONENT)
    u = abs(z - waist(y)) / max(height * fh + grow, 1e-9)
    return (HALF * fw + grow) * max(0.0, 1.0 - u ** n) ** (1.0 / n)


def floor_half(y: float) -> float:
    """Half the width of the deck: zero where the nose has risen above it."""
    edge_x, edge_z = lower(y)[0]
    return edge_x if edge_z < FLOOR + 1e-6 else 0.0


def polygon_area(points: list[Point2]) -> float:
    return abs(sum(x0 * z1 - x1 * z0 for (x0, z0), (x1, z1) in zip(points, points[1:] + points[:1]))) / 2


def cabin_volume(step: float = 0.01) -> float:
    """m³ of air inside the wall from the end wall to the panel, before the furniture: section areas summed along the length."""
    count = round((DASH_Y - QUARTERS_AFT) / step)
    return sum(polygon_area(section(QUARTERS_AFT + (i + 0.5) * step)) for i in range(count)) * step


def glass_sill(y: float) -> float:
    """The height of the glass's lower edge at y."""
    return hull_point(y, math.pi / 2 - canopy_reach(y))[2]


def lowest_canopy_sill() -> float:
    return min(glass_sill(CANOPY_AFT + i * 0.05) for i in range(round((GLASS_FRONT - CANOPY_AFT) / 0.05)))


# ponytail: what the panel and the walk map still ask of the old canopy and tub; same refit as the names above
canopy_x_at = tub_x_at = half_width


def sill(y: float) -> float:
    return waist(y)


def canopy_height(y: float) -> float:
    return (CROWN - WAIST) * taper(y)


def check() -> None:
    """The sizes that were agreed, or the build stops."""
    assert abs(half_width(TAPER_START, WAIST) - 1.30) < 1e-9 and abs(CROWN - FLOOR - 2.10) < 1e-9
    assert abs(ZONES[-1][2] - ZONES[-1][1] - 3.0) < 1e-9 and abs(NOSE - STERN - 24.0) < 1e-9
    assert 1.1 < floor_half(-5.0) < 1.25 and floor_half(0.85) > 0.5 and floor_half(NOSE - 0.3) < 0.25  # the deck narrows into the nose
    assert waist(0.0) + canopy_height(0.0) >= 0.6  # over the seated head, 0.6 m to spare: my choice
    assert len(section(0.0)) == len(section(5.0)) == len(section(0.0, SKIN, True))
    assert 55.0 < cabin_volume(0.05) < 90.0
