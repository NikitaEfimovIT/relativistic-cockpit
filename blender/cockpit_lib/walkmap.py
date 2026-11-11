"""Where the player can walk and what the gaze can pick, for the app's layout file, in its axes (x right, y up, z aft)."""

import math

from . import console as c
from . import furniture as f
from .cabin import BULKHEAD, RIB_DEPTH
from .geometry import Vec
from .shape import DOOR_HALF, DOOR_TOP, DOOR_Y, FLOOR, TAIL, half_width, hull_point

FAR = 40.0  # m: walls are thick, out past the whole ship
STATION_AFT = 0.32  # m aft of the eye: the top of the seat's shell, where the pilot's station stops the feet
PILOT_EXIT = 0.62  # m aft of the eye: a body's radius and a little behind the seat
DESK_EXIT = 0.1  # m to starboard of the centre line: in the aisle, clear of the chair
IMPORT = "import type { Box, Profile, SeatName, Spot, Target, Vec3 } from './walk'"
SHIN = FLOOR + 0.3  # ponytail: the walls are taken at shin height, where the hull's curve in is felt by the feet
BULKHEAD_Z = -DOOR_Y  # app z of the partition at the cockpit door
COCKPIT_HALF = half_width(-STATION_AFT, SHIN, -RIB_DEPTH)  # narrowest where one walks in the cockpit: it tapers forward
QUARTERS_HALF = half_width(DOOR_Y - 0.5, SHIN, -RIB_DEPTH)  # clear of the ribs; the section is the same back to the aft wall


def box(x0: float, x1: float, z0: float, z1: float) -> str:
    return f'  {{ minX: {min(x0, x1):.3f}, maxX: {max(x0, x1):.3f}, minZ: {min(z0, z1):.3f}, maxZ: {max(z0, z1):.3f} }},'


def plan(spans: tuple[float, float, float, float]) -> str:
    """A box from Blender's spans: x from, to; y (forward) from, to."""
    return box(spans[0], spans[1], -spans[2], -spans[3])


def target(name: str, kind: str, low: Vec, high: Vec) -> str:
    """A box the gaze can land on, from two opposite corners in Blender's axes."""
    a, b = (low[0], low[2], -low[1]), (high[0], high[2], -high[1])
    least, most = ([f'{pick(p, q):.3f}' for p, q in zip(a, b)] for pick in (min, max))
    return f"  {{ id: '{name}', kind: '{kind}', min: [{', '.join(least)}], max: [{', '.join(most)}] }},"


def profiles() -> tuple[str, str]:
    floor = [(-1.0, FLOOR), (-TAIL, FLOOR)]
    roof = [(-y, hull_point(y, math.pi / 2, 0.0)[2]) for y in (0.75, 0.0, DOOR_Y + 0.05)]
    door = [(BULKHEAD_Z - BULKHEAD, DOOR_TOP), (BULKHEAD_Z + BULKHEAD, DOOR_TOP), (BULKHEAD_Z + BULKHEAD + 0.001, hull_point(DOOR_Y - 0.1, math.pi / 2, 0.0)[2])]
    ceiling = roof + door + [(-TAIL, hull_point(TAIL, math.pi / 2, 0.0)[2])]
    return tuple('[' + ', '.join(f'[{z:.3f}, {h:.3f}]' for z, h in points) + ']' for points in (floor, ceiling))


def walls() -> list[str]:
    fore, aft = BULKHEAD_Z - BULKHEAD / 2, BULKHEAD_Z + BULKHEAD / 2
    return [box(s * COCKPIT_HALF, s * FAR, -FAR, fore) for s in (-1, 1)] + [box(s * DOOR_HALF, s * FAR, fore, aft) for s in (-1, 1)] \
        + [box(s * QUARTERS_HALF, s * FAR, aft, FAR) for s in (-1, 1)] + [box(-FAR, FAR, -TAIL, FAR)]


def blockers() -> list[str]:
    x, y, r = *f.CHAIR, f.SEAT_SIZE / 2
    deep, long, _ = f.RACK_SIZE
    racks = [plan((rx - deep / 2, rx + deep / 2, ry - long / 2, ry + long / 2)) for rx, ry in f.RACKS]
    cabinet = plan((c.FRONT_X, c.BACK_X, c.CONSOLE_Y - c.CONSOLE_LENGTH / 2, c.CONSOLE_Y + c.CONSOLE_LENGTH / 2))
    return [box(-COCKPIT_HALF, COCKPIT_HALF, -FAR, STATION_AFT), plan(f.DESK), plan((x - r, x + r, y - r, y + r)), plan(f.BED), *racks, cabinet]


def targets() -> list[str]:
    (x, y), r = f.CHAIR, f.SEAT_SIZE / 2
    _, wide, high = f.DRAWER_SIZE
    found = [target('pilot', 'seat', (-0.32, -0.27, -0.7), (0.32, 0.3, 0.1)),
             target('desk', 'seat', (x - r, y - r, FLOOR), (x + r, y + r, f.SEAT_TOP + 0.55))]
    found += [target(f'drawer_bed_{i + 1}', 'drawer', (f.BED[0] - 0.04, at - wide / 2, f.DRAWER_Z - high / 2), (f.BED[0], at + wide / 2, f.DRAWER_Z + high / 2))
              for i, at in enumerate(f.DRAWER_Y)]
    for name, _, u, v, kind in c.SWITCHES:  # a cube round each control on the sloped face
        cx, cy, cz = c.at(u, v, 0.02)
        found.append(target(name, kind, (cx - 0.04, cy - 0.04, cz - 0.04), (cx + 0.04, cy + 0.04, cz + 0.04)))
    for name, _, u, v, kind in c.ROOM_SWITCHES:
        cx, cy, cz = c.room_at(u, v)
        found.append(target(name, kind, (cx - 0.05, cy - 0.03, cz - 0.04), (cx, cy + 0.03, cz + 0.04)))  # out from the starboard wall
    return found


def lines() -> list[str]:
    floor, ceiling = profiles()
    (x, y), eye = f.CHAIR, f.SEAT_TOP + f.SITTING_EYE
    return [
        '/** Where the eye sits in a seat, which way it faces (yaw, 0 is forward) and where the feet land on standing up. */',
        'export interface Seat {', '  readonly eye: Vec3', '  readonly yaw: number', '  readonly exit: Spot', '}',
        '',
        '/** Heights of the floor and of the ceiling along the ship, as [z, height] joined by straight lines. */',
        f'export const FLOOR_PROFILE: Profile = {floor}', f'export const CEILING_PROFILE: Profile = {ceiling}',
        '/** Full-height walls: they stop the feet and the gaze. */',
        'export const WALLS: readonly Box[] = [', *walls(), ']',
        '/** Furniture: it stops the feet only. */',
        'export const BLOCKERS: readonly Box[] = [', *blockers(), ']',
        '/** What E acts on; a target is named as its mount in the model, a seat as itself. */',
        'export const TARGETS: readonly Target[] = [', *targets(), ']',
        'export const SEATS: Readonly<Record<SeatName, Seat>> = {',
        f'  pilot: {{ eye: [0, 0, 0], yaw: 0, exit: {{ x: 0, z: {PILOT_EXIT} }} }},',
        f'  desk: {{ eye: [{x:.3f}, {eye:.3f}, {-y:.3f}], yaw: {math.pi / 2:.4f}, exit: {{ x: {DESK_EXIT}, z: {-y:.3f} }} }},',
        '}',
        '',
    ]
