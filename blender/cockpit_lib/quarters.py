"""The three compartments behind the bridge, end to end with open arches between: their vault with the portholes in it,
and the walkway down the middle."""

from . import shape
from .geometry import FLAT, Axes, Point2, Vec, collection, loft, mesh_object, oriented_box, sweep
from .shape import FLOOR, QUARTERS_AFT, QUARTERS_FRONT, ZONES

SIDES = ((1, 'right'), (-1, 'left'))
# ponytail: the walk map still asks where the steps ended, and there are none now; goes when the walk map is refitted
STAIR_FOOT = QUARTERS_FRONT
# A wide window each side of every compartment, over the desk and over the bed among them: the zone, along the hull from, to;
PORTHOLES = tuple((name, y0 + 0.4, y1 - 0.4) for name, y0, y1 in ZONES[1:4])
# and up the vault from, to, counted in points of its outline from the waist: 1.19 to 1.74 m above the deck
PANE = (1, 5)
VAULT_STEP = 0.5  # m between the vault's rings: longer faces shade it in streaks
PANE_DEPTH = 0.07  # the glass sits this far out in the wall
FACING_FORWARD: Axes = ((-1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0))  # on the end wall, read from the room


def outline(side: int, y: float, grow: float = 0.0) -> list[Point2]:
    """The vault at station y, from the waist on one side upwards. Not shape.mirrored: that also reverses the arc, which
    over the whole vault gives back the right-hand side."""
    points = shape.upper(y, grow)
    return points if side > 0 else [(-x, z) for x, z in points]


def facing_in(side: int, points: list) -> list:
    """Mirrored, a ring runs the other way round and its faces turn away from the room: run it back."""
    return points if side > 0 else points[::-1]


def build_vault(mats) -> None:
    """The vault over the compartments, left open where the portholes are."""
    ends = {QUARTERS_AFT, QUARTERS_FRONT, *(y for _, y0, y1 in PORTHOLES for y in (y0, y1))}
    steps = round((QUARTERS_FRONT - QUARTERS_AFT) / VAULT_STEP)
    stations = sorted(ends | {QUARTERS_AFT + (QUARTERS_FRONT - QUARTERS_AFT) * i / steps for i in range(steps)})
    stations = [y for i, y in enumerate(stations) if i == 0 or y - stations[i - 1] > 0.05]  # no sliver next to a porthole's end
    rings = [[(x, y, z) for x, z in shape.upper(y)] for y in stations]
    count, (low, high) = len(rings[0]), PANE
    in_pane = [any(y0 < (a + b) / 2 < y1 for _, y0, y1 in PORTHOLES) for a, b in zip(stations, stations[1:])]
    faces = [(r * count + i, r * count + i + 1, (r + 1) * count + i + 1, (r + 1) * count + i)
             for r in range(len(rings) - 1) for i in range(count - 1) if not (in_pane[r] and low <= min(i, count - 2 - i) < high)]
    mesh_object('vault_quarters', [p for ring in rings for p in ring], faces, mats['white'], collection('cabin'), smooth=True)


def build_porthole(side: int, name: str, span: tuple[float, float], mats) -> None:
    """A pane that follows the curve of the wall, set out into it, and the cut through the wall around it."""
    low, high = PANE

    def edge(grow: float) -> list[Vec]:
        """Round the opening: up the vault at one end of it, back down at the other."""
        up, down = ([(x, y, z) for x, z in outline(side, y, grow)[low:high + 1]] for y in span)
        return up + down[::-1]

    # through the whole skin, out to the hull outside (exterior.py), with the pane set partway out in it
    sweep(f'porthole_reveal_{name}', [facing_in(side, edge(0.0)), facing_in(side, edge(shape.SKIN))], mats['graphite_soft'], collection('cabin'), closed_profile=True)
    # With the canopy's glass: the app draws it over the sky without hiding the sky
    loft(f'porthole_glass_{name}', list(span), lambda y: facing_in(side, outline(side, y, PANE_DEPTH)[low:high + 1]), mats['glass'], collection('canopy'))


def build_quarters(mats) -> None:
    build_vault(mats)
    for zone, y0, y1 in PORTHOLES:
        for side, name in SIDES:
            build_porthole(side, f'{zone}_{name}', (y0, y1), mats)
    middle, length = (QUARTERS_FRONT + QUARTERS_AFT) / 2, QUARTERS_FRONT - QUARTERS_AFT
    oriented_box('quarters_walkway', (0.0, middle, FLOOR + 0.003), FLAT, (0.9, length - 0.1, 0.006), mats['graphite_soft'], collection('cabin'), 0.003)
