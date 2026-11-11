"""The hull around the crew: one shell from the end wall to the nose, its deck, ribs and glazing, the skin outside, and the consoles."""

import math

from . import hardware as hw
from . import shape
from .geometry import (
    FLAT, Axes, Point2, Vec, attach, capsule, collection, disc, facing_eye, frame_point, label, loft, mesh_object, mount, normalise, oriented_box,
    picture_frame, ring, sweep, uv_sphere,
)
from .shape import (
    BOW_Y, CANOPY_AFT, DOOR_HALF, DOOR_TOP, HEADER_SPAN, FLOOR, GLASS_FRONT, NOSE, QUARTERS_AFT, QUARTERS_FRONT, RIBS, TAPER_START, VAULT_POINTS, arc,
    canopy_reach,
)

SIDES = ((1, 'right'), (-1, 'left'))
RIB_DEPTH, RIB_WIDTH = 0.05, 0.09  # how far a rib stands in from the wall, and how wide it is along the hull
NOSE_STATIONS = [TAPER_START + (NOSE - TAPER_START) * math.sin(math.pi / 2 * i / 48) for i in range(49)]


def span(start: float, stop: float) -> list[float]:
    """Stations from start to stop: only the ends along the parallel body, close together where the nose curves in."""
    return [start] + [y for y in NOSE_STATIONS if start < y < stop] + [stop]


def deck(y: float) -> list[Point2]:
    """Across the hull between the feet of the two walls: the deck, and forward of it the bottom of the nose."""
    x, z = shape.lower(y)[0]
    return [(-x, z), (x, z)]


def glass(y: float) -> list[Point2]:
    """Across the drop of glass at y, as far round from the top as it reaches there."""
    r = canopy_reach(y)
    return [(x, z) for x, _, z in arc(y, math.pi / 2 - r, math.pi / 2 + r, VAULT_POINTS)]


def under_glass(side: int):
    """The white wall between the waist and the glass's edge on one side."""
    def profile(y: float) -> list[Point2]:
        points = [(x, z) for x, _, z in arc(y, 0.0, math.pi / 2 - canopy_reach(y), 8)]
        return points if side > 0 else shape.mirrored(points)
    return profile


def build_shell(mats) -> None:
    """Walls and deck from the end wall to the nose; over the cockpit the drop of glass, white below it and ahead of it."""
    cabin, glazing = collection('cabin'), collection('canopy')
    length = span(QUARTERS_AFT, NOSE)
    loft('wall_right', length, shape.lower, mats['white'], cabin)
    loft('wall_left', length, lambda y: shape.mirrored(shape.lower(y)), mats['white'], cabin)
    loft('floor', length, deck, mats['graphite'], cabin)
    for side, name in SIDES:
        loft(f'vault_{name}', span(CANOPY_AFT, GLASS_FRONT), under_glass(side), mats['white'], cabin)
    loft('vault_nose', span(GLASS_FRONT, NOSE), shape.upper, mats['white'], cabin)
    end = [(x, QUARTERS_AFT, z) for x, z in shape.section(QUARTERS_AFT)]
    mesh_object('end_wall', end, [tuple(range(len(end)))], mats['white'], cabin)
    # In two pieces that meet under the bow rib: the app draws its indicators on the windshield only
    loft('canopy_glass', span(CANOPY_AFT, BOW_Y), glass, mats['glass'], glazing)
    loft('canopy_windshield', span(BOW_Y, GLASS_FRONT), glass, mats['glass'], glazing)
    for i, y in enumerate(RIBS):
        build_rib(f'rib_{i}', frames(y, shape.section(y)), mats)
    build_rib('header', bow_frames(), mats)
    build_pillars(mats)
    build_lamps(mats)
    build_bulkhead(mats)


BULKHEAD = 0.04  # m thick
FACING_AFT: Axes = ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0))  # on the bulkhead, read from the compartment


def build_bulkhead(mats) -> None:
    """The partition at the cockpit door: a wall on the section with an open passage and no door, faced both ways."""
    cabin = collection('cabin')
    outline = shape.section(QUARTERS_FRONT)
    centre = FLOOR + 1.0  # each point of the outline is joined to the opening along the line from here

    def to_opening(x: float, z: float) -> Point2:
        dz = z - centre
        across = DOOR_HALF / abs(x) if abs(x) > 1e-9 else math.inf
        up = ((DOOR_TOP - centre) if dz > 0 else (centre - FLOOR)) / abs(dz) if abs(dz) > 1e-9 else math.inf
        t = min(across, up)
        return (x * t, centre + dz * t)

    inner = [to_opening(x, z) for x, z in outline]
    inner[0], inner[-1] = (DOOR_HALF, FLOOR), (-DOOR_HALF, FLOOR)
    n = len(outline)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    for name, y, flip in (('bulkhead_aft', QUARTERS_FRONT - BULKHEAD / 2, False), ('bulkhead_fore', QUARTERS_FRONT + BULKHEAD / 2, True)):
        verts = [(x, y, z) for x, z in outline + inner]
        mesh_object(name, verts, [f[::-1] for f in faces] if flip else faces, mats['white'], cabin)
    middle = (0.0, QUARTERS_FRONT + BULKHEAD / 2 + 0.015, (FLOOR + DOOR_TOP) / 2)  # it stands aft from here, through the wall
    picture_frame('bulkhead_door_frame', middle, FACING_AFT, 2 * DOOR_HALF + 0.1, DOOR_TOP - FLOOR + 0.05, 0.05, BULKHEAD + 0.03,
                  mats['white_trim'], cabin)


def frames(y: float, points: list[Point2]) -> list[tuple[Vec, Vec]]:
    """Points of an outline at station y, each with the direction into the hull."""
    result = []
    for i, (x, z) in enumerate(points):
        ax, az = points[max(0, i - 1)]
        bx, bz = points[min(len(points) - 1, i + 1)]
        result.append(((x, y, z), normalise((-(bz - az), 0.0, bx - ax))))
    return result


def inset(frame: tuple[Vec, Vec], depth: float, along: float = 0.0) -> Vec:
    p, n = frame
    return (p[0] + n[0] * depth, p[1] + along, p[2] + n[2] * depth)


def build_rib(name: str, outline: list[tuple[Vec, Vec]], mats) -> None:
    """An arch along an outline (deck to deck, or the header over the glass), with a strip of light along its inner face."""
    cabin, half = collection('cabin'), RIB_WIDTH / 2
    profile = ((-0.01, -half), (RIB_DEPTH, -half), (RIB_DEPTH, half), (-0.01, half))
    sweep(name, [[inset(f, a, b) for a, b in profile] for f in outline], mats['white'], cabin, closed_profile=True, caps=True)
    strip = [[inset(f, RIB_DEPTH + 0.001, b) for b in (-0.012, 0.012)] for f in outline[3:-3]]
    sweep(f'light_line_{name}', strip, mats['strip'], cabin)


STATUS = (('ПИТАНИЕ', 'green'), ('ВЗВЕДЕНО', 'amber'), ('ДВИГАТЕЛЬ', 'lamp_off'), ('ТЯГА', 'lamp_off'), ('ЩИТ', 'cyan'), ('СВЕТ', 'amber'))


def bow_frames() -> list[tuple[Vec, Vec]]:
    """Along the header over the glass, each point with the direction into the hull."""
    a0, a1 = (math.radians(a) for a in HEADER_SPAN)
    return frames(BOW_Y, [(x, z) for x, _, z in arc(BOW_Y, a0, a1, VAULT_POINTS)])


PILLAR_HALF = math.radians(4.0)  # half the width of a roof pillar, round the vault


def build_pillars(mats) -> None:
    """A pillar each side along the roof, from the cockpit door to an end of the header: between the side glass and the
    glass overhead, as in the view from the seat. A strip of light down its middle."""
    cabin, stations = collection('cabin'), span(QUARTERS_FRONT, BOW_Y)
    for angle, name in ((math.radians(HEADER_SPAN[0]), 'right'), (math.radians(HEADER_SPAN[1]), 'left')):
        def across(y: float, a0: float, a1: float, count: int) -> list[tuple[Vec, Vec]]:
            return frames(y, [(x, z) for x, _, z in arc(y, a0, a1, count)])
        rings = []
        for y in stations:
            face = across(y, angle - PILLAR_HALF, angle + PILLAR_HALF, 5)
            rings.append([inset(f, -0.005) for f in face] + [inset(f, RIB_DEPTH) for f in reversed(face)])
        sweep(f'pillar_{name}', rings, mats['white'], cabin, closed_profile=True, caps=True)
        strip = [[inset(f, RIB_DEPTH + 0.001) for f in across(y, angle - 0.012, angle + 0.012, 2)] for y in stations]
        sweep(f'light_line_pillar_{name}', strip, mats['strip'], cabin)


def build_lamps(mats) -> None:
    """The status lamps on the inner face of the header: three each side of the crown."""
    places, bow = collection('placeholders'), bow_frames()
    for i, (text, colour) in enumerate(STATUS):
        lamp = inset(bow[VAULT_POINTS // 2 - 10 + 3 * i + (5 if i >= 3 else 0)], RIB_DEPTH + 0.002)
        holder = mount(f'lamps_status_{i}', lamp, facing_eye(lamp), places)
        attach(holder, *hw.lamp_cell(f'lamps_status_{i}', lamp, facing_eye(lamp), (0.052, 0.017), mats[colour], text, mats, 0.0058,
                                     colour != 'lamp_off'))


def fob_anchor() -> tuple[Vec, Vec]:
    """Where the fob's bracket meets the inside of the bow rib, left of the line of sight, and where its cord hangs from."""
    frame = min(bow_frames(), key=lambda f: abs(f[0][0] + 0.42))
    return inset(frame, RIB_DEPTH, -0.02), inset(frame, RIB_DEPTH + 0.035, -0.02)


# ---------------------------------------------------------------------------------------------------------------------
# Consoles under the hands, and the pods along the walls above them

CONSOLE_TOP = -0.56  # level with the lower edge of the panel's wings; the desks themselves are built in dash.py
CONSOLE_INNER = 0.6  # m from the centre line: 0.28 m clear of the seat's side, room to get in and out
POD_Y, POD_LENGTH = 0.14, 0.60  # on the desk against the wall, ending short of the panel's wing; long enough aft for the
# last switch's lamp, 22 mm beside it, to sit on the face and not on the rounded end
POD_FACE = shape.half_width(POD_Y, CONSOLE_TOP) - 0.106 - 0.01  # m from the centre line: the inboard face of each pod, on the wall
POD_TOP = -0.322  # just under the sill's lip
WALL_FRONT = 0.40  # m: the forward switch on the right-hand pod
SWITCH_ROW = -0.4  # m: height of the switches on the pods
CO2_SCREEN = (0.2, 0.12)  # m
CO2_Y, CO2_Z = 0.1, -0.215  # m: over ПОГЛОТИТЕЛЬ, between the pod's top and the glass
STICK = (-0.69, 0.25, CONSOLE_TOP + 0.003)  # m: the attitude stick under the left hand
CHEM_LEVER = (-0.95, 0.2, CONSOLE_TOP + 0.003)  # m: the chemical engine's lever, outboard of it
CUTOFF = (-0.78, 0.5, CONSOLE_TOP + 0.003)  # m: the red cutoff, forward of the stick, well inside the desk's edges (13 cm and more)
LEFT_MOUNTS = ('ctl_lights', 'ctl_fans', 'ctl_scrubber', 'scr_co2', 'scr_nav')
RIGHT_WALL = (('ctl_breaker_nav', 'НАВИГАЦИЯ', True), ('ctl_breaker_comms', 'СВЯЗЬ', True), ('ctl_breaker_dosimeter', 'ДОЗИМЕТР', True),
              ('ctl_breaker_camera', 'КАМЕРА', True), ('ctl_hud', 'ИНДИКАТОРЫ', True), ('ctl_shutters', 'ШТОРКИ', False),
              ('ctl_tint', 'ТОНИРОВКА', False), ('ctl_dim', 'ЯРКОСТЬ', False))


def wall_axes(side: int) -> Axes:
    """The inboard face of a wall pod, read from the seat: along the wall, up, and towards the centre line."""
    return (0.0, -float(side), 0.0), (0.0, 0.0, 1.0), (-float(side), 0.0, 0.0)


def build_consoles(mats) -> None:
    cabin = collection('cabin')
    pod_height = POD_TOP - CONSOLE_TOP
    for s, name in SIDES:
        oriented_box(f'pod_{name}', (s * (POD_FACE + 0.053), POD_Y, CONSOLE_TOP + pod_height / 2), FLAT, (0.106, POD_LENGTH, pod_height),
                     mats['white'], cabin, 0.02, 4)
        oriented_box(f'pod_{name}_face', (s * (POD_FACE - 0.002), POD_Y, SWITCH_ROW + 0.01), wall_axes(s), (POD_LENGTH - 0.03, 0.12, 0.004),
                     mats['graphite_soft'], cabin, 0.004)
        build_vent(f'vent_{name}', (s * (POD_FACE - 0.003), VENT_Y, POD_TOP - 0.036), wall_axes(s), mats)
    build_left_controls(mats)
    build_right_controls(mats)


VENT_Y = POD_Y + POD_LENGTH / 2 - 0.06  # m: at the forward end of each pod, over its first switch


def build_vent(name: str, origin: Vec, axes: Axes, mats) -> None:
    """An eyeball air outlet set into a pod's face, its ball turned to blow the fans' breath at the pilot."""
    cabin = collection('cabin')
    ball = frame_point(origin, axes, 0, 0, 0.004)
    to_pilot = facing_eye(ball)
    nozzle = frame_point(ball, to_pilot, 0, 0, 0.0152)
    attach(mount(name, origin, axes, collection('placeholders')),
           ring(f'{name}_bezel', origin, axes, 0.024, 0.016, 0.005, mats['dark_metal'], cabin),
           uv_sphere(f'{name}_ball', ball, (0.015, 0.015, 0.015), mats['graphite_soft'], cabin, 10, 16),
           disc(f'{name}_nozzle', nozzle, to_pilot, 0.0065, mats['seal'], cabin, 16))


def build_left_controls(mats) -> None:
    """Under the left hand: the gas analyser; life support and the cabin lights on the wall. Messages from Earth are read
    on the computer in the living compartment, not here."""
    axes = wall_axes(-1)
    face = -(POD_FACE - 0.003)
    hw.toggle('ctl_fans', (face, 0.0, SWITCH_ROW), axes, mats, 'ВЕНТИЛЯЦИЯ', is_on=True)
    hw.toggle('ctl_scrubber', (face, 0.1, SWITCH_ROW), axes, mats, 'ПОГЛОТИТЕЛЬ', is_on=True)
    hw.toggle('ctl_lights', (face, 0.205, SWITCH_ROW), axes, mats, 'СВЕТ', is_on=True, lamp='amber')
    label('caption_life_support', 'ЖИЗНЕОБЕСПЕЧЕНИЕ', (face, 0.05, SWITCH_ROW + 0.055), axes, 0.009, mats['legend'], collection('labels'))
    # on the bare wall over the pod, above the life-support switches it reads for, tilted to the eye: on the desk, where the
    # reference has it, it stood in the line of sight to the switches under the navigation screen
    co2 = (-(shape.half_width(CO2_Y, CO2_Z) - 0.03), CO2_Y, CO2_Z)
    hw.screen('scr_co2', co2, facing_eye(co2), *CO2_SCREEN, mats, hw.text_rows('ui_co2', 'CO2, мм рт. ст.', 'green', [
        ('НОРМА ≤ 3', '2.5', 'green'), ('ВЕНТ · ПОГЛ', 'ВКЛ · ВКЛ', '')], mats))
    # Flight by a body, under the left hand as on the reference: the attitude stick inboard, the chemical engine's lever
    # outboard, and the cutoff forward of the stick, inboard of the CO₂ screen. All forward of the seat's back: the head
    # turns no further than 77°.
    hw.stick('ctl_stick', STICK, FLAT, mats)
    hw.lever('ctl_chem_throttle', CHEM_LEVER, FLAT, mats, 'ДОСВЕТ')
    hw.push_button('ctl_cutoff', CUTOFF, FLAT, mats, 'ОТСЕЧКА')


def build_right_controls(mats) -> None:
    """Under the right hand: the thrust sled; breakers and glass switches on the wall. The target and the shield are on the
    panel."""
    hw.throttle('ctl_throttle', (0.8, 0.4, CONSOLE_TOP + 0.007), FLAT, mats)
    axes = wall_axes(1)
    face = POD_FACE - 0.003
    for i, (name, text, is_on) in enumerate(RIGHT_WALL):
        hw.toggle(name, (face, WALL_FRONT - 0.07 * i, SWITCH_ROW), axes, mats, text, is_on=is_on)
    labels = collection('labels')
    label('caption_breakers', 'АВТОМАТЫ ЗАЩИТЫ', (face, WALL_FRONT - 0.105, SWITCH_ROW + 0.055), axes, 0.009, mats['legend'], labels)
    label('caption_canopy', 'ФОНАРЬ И ИНДИКАЦИЯ', (face, WALL_FRONT - 0.385, SWITCH_ROW + 0.055), axes, 0.009, mats['legend'], labels)
