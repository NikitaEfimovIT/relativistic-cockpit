"""What stands in the compartments: the engineer's desk with its three screens and chair to port in the engineering bay, the
bed and its drawers to starboard in the living compartment, and the cabinets of the science bay."""

import math

from .geometry import FLAT, Axes, Vec, attach, collection, frame_point, mesh_object, mount, oriented_box, pillow
from .hardware import screen
from .shape import FLOOR, QUARTERS_FLOOR, ZONES, half_width

_, SCIENCE_AFT, _ = ZONES[1]
_, LIVING_AFT, _ = ZONES[2]
_, ENGINEERING_AFT, _ = ZONES[3]
DESK_TOP = FLOOR + 0.74  # an office desk's height
DESK_Y = (ENGINEERING_AFT + 0.85, ENGINEERING_AFT + 2.65)  # under the porthole, as long as the three screens
DESK = (-(half_width(sum(DESK_Y) / 2, DESK_TOP) - 0.005), -0.7, *DESK_Y)  # x from, to (against the curve of the wall); y from, to
CHAIR = (-0.45, sum(DESK_Y) / 2)  # the middle of its seat
SEAT_TOP = FLOOR + 0.45
SEAT_SIZE = 0.44
SITTING_EYE = 0.79  # m from the seat up to the eye: a chosen figure for one adult
SCREENS = ('mail', 'map', 'systems')  # aft to forward, which is left to right for whoever sits at them
# 27-inch, 16:9: at 0.67 m from the eye a 2.2 cm line of text is 14 px of a 1000 × 640 view (420 px a radian at its
# middle); the old 0.42 m screens gave 7 px
SCREEN_SIZE = (0.60, 0.34)
SCREEN_HEIGHT = DESK_TOP + 0.27  # the tops just under the porthole's lower edge
SCREEN_INSET = 0.2  # m out from the wall's line at the desk: the middle screen 0.67 m from the eye
SCREEN_TURN = 0.3  # rad: the outer two turned in towards the chair
BED_TOP = FLOOR + 0.5  # under the mattress: high enough for the drawers under it
BED_Y = (LIVING_AFT + 0.75, LIVING_AFT + 2.75)  # 2 m, the head forward, under the porthole
BED = (0.5, half_width(sum(BED_Y) / 2, BED_TOP + 0.14) - 0.005, *BED_Y)
DRAWER_Y = tuple(sum(BED_Y) / 2 + d for d in (0.6533, 0.0, -0.6533))  # the middle of each drawer's front
DRAWER_SIZE = (0.48, 0.59, 0.3)  # deep, wide, high
DRAWER_Z = FLOOR + 0.22


def turned(angle: float) -> Axes:
    """The face of something on the port wall, read from the room and turned by an angle about the vertical."""
    return (math.sin(angle), math.cos(angle), 0.0), (0.0, 0.0, 1.0), (math.cos(angle), -math.sin(angle), 0.0)


def build_desk(mats) -> None:
    cabin = collection('cabin')
    x0, x1, y0, y1 = DESK
    middle, length, depth = (y0 + y1) / 2, y1 - y0, x1 - x0
    side = mount('desk_left', (0.0, 0.0, 0.0), FLAT, collection('placeholders'))  # so that the cutaway hides all of it
    top = oriented_box('desk_top', ((x0 + x1) / 2, middle, DESK_TOP - 0.02), FLAT, (depth, length, 0.04), mats['white'], cabin, 0.012)
    legs = [oriented_box(f'desk_leg_{i}', ((x0 + x1) / 2 - 0.02, y, (DESK_TOP - 0.04 + QUARTERS_FLOOR) / 2), FLAT,
                         (depth - 0.06, 0.04, DESK_TOP - 0.04 - QUARTERS_FLOOR), mats['white_trim'], cabin)
            for i, y in enumerate((y0 + 0.04, y1 - 0.04))]
    rail = oriented_box('desk_rail', (x0 + SCREEN_INSET - 0.08, middle, SCREEN_HEIGHT), FLAT, (0.06, length - 0.2, 0.06), mats['graphite_soft'], cabin)
    keyboard = oriented_box('desk_keyboard', (x1 - 0.2, middle, DESK_TOP + 0.008), FLAT, (0.14, 0.42, 0.016), mats['graphite_soft'], cabin, 0.004)
    keys = oriented_box('desk_keys', (x1 - 0.2, middle, DESK_TOP + 0.017), FLAT, (0.11, 0.39, 0.004), mats['dark_metal'], cabin, 0.001)
    attach(side, top, rail, keyboard, keys, *legs)
    width, height = SCREEN_SIZE
    half = width / 2 + 0.013  # with its bezel
    for i, name in enumerate(SCREENS):
        offset = i - 1
        angle = offset * SCREEN_TURN
        # edge to edge with the middle one: its centre half a width on, round the turn
        along = offset * (half + half * math.cos(SCREEN_TURN) + 0.01)
        origin = (x0 + SCREEN_INSET + abs(offset) * half * math.sin(SCREEN_TURN), middle + along, SCREEN_HEIGHT)
        axes = turned(angle)
        attach(side, screen(f'scr_desk_{name}', origin, axes, width, height, mats))
        # The monitor's body behind its bezel, and an arm back to the rail: the app hides the model's glass to draw its
        # own picture, so without a back the screen is a frame seen through from behind
        back = oriented_box(f'desk_monitor_{name}_back', frame_point(origin, axes, 0, 0, -0.022), axes,
                            (width + 0.03, height + 0.03, 0.03), mats['graphite_soft'], cabin, 0.008)
        reach = math.dist(origin[:2], (x0 + SCREEN_INSET - 0.08, origin[1])) - 0.03
        arm = oriented_box(f'desk_monitor_{name}_arm', frame_point(origin, axes, 0, 0, -0.04 - reach / 2), axes,
                           (0.06, 0.08, reach), mats['dark_metal'], cabin, 0.01)
        attach(side, back, arm)


def build_chair(mats) -> None:
    cabin = collection('cabin')
    x, y = CHAIR
    side = mount('chair_left', (0.0, 0.0, 0.0), FLAT, collection('placeholders'))
    seat = pillow('chair_seat', (x, y, SEAT_TOP - 0.035), FLAT, (SEAT_SIZE, SEAT_SIZE, 0.07), mats['cushion'], cabin)
    back = pillow('chair_back', (x + SEAT_SIZE / 2 - 0.02, y, SEAT_TOP + 0.3), FLAT, (0.06, SEAT_SIZE - 0.04, 0.5), mats['cushion'], cabin)
    post_height = SEAT_TOP - 0.07 - QUARTERS_FLOOR
    post = oriented_box('chair_post', (x, y, QUARTERS_FLOOR + post_height / 2), FLAT, (0.07, 0.07, post_height), mats['dark_metal'], cabin)
    foot = oriented_box('chair_foot', (x, y, QUARTERS_FLOOR + 0.015), FLAT, (0.4, 0.4, 0.03), mats['dark_metal'], cabin, 0.01)
    attach(side, seat, back, post, foot)


def build_drawer(index: int, y: float, mats) -> None:
    """An open tray behind a front panel, hung on an empty at the middle of its front: the app slides that empty towards the aisle."""
    cabin = collection('cabin')
    deep, wide, high = DRAWER_SIZE
    x = BED[0]
    holder = mount(f'drawer_bed_{index}', (x, y, DRAWER_Z), FLAT, collection('placeholders'))
    front = oriented_box(f'drawer_bed_{index}_front', (x - 0.01, y, DRAWER_Z), FLAT, (0.02, wide + 0.012, high + 0.03), mats['white'], cabin, 0.005)
    handle = oriented_box(f'drawer_bed_{index}_handle', (x - 0.027, y, DRAWER_Z + high / 2 - 0.05), FLAT, (0.014, 0.22, 0.02), mats['dark_metal'], cabin, 0.004)
    low, top = DRAWER_Z - high / 2, DRAWER_Z + high / 2 - 0.02
    ring: list[Vec] = [(x, y - wide / 2, 0.0), (x + deep, y - wide / 2, 0.0), (x + deep, y + wide / 2, 0.0), (x, y + wide / 2, 0.0)]
    verts = [(px, py, low) for (px, py, _) in ring] + [(px, py, top) for (px, py, _) in ring]
    faces = [(0, 1, 2, 3)] + [(i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i) for i in range(4)]
    tray = mesh_object(f'drawer_bed_{index}_tray', verts, faces, mats['white_trim'], cabin)
    attach(holder, front, handle, tray)


def build_bed(mats) -> None:
    """A deck on a frame with three drawers in it, a mattress and a pillow; the head is forward."""
    cabin = collection('cabin')
    x0, x1, y0, y1 = BED
    centre_x, centre_y, wide, long = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
    oriented_box('bed_plinth', (centre_x + 0.02, centre_y, QUARTERS_FLOOR + 0.03), FLAT, (wide - 0.04, long, 0.06), mats['graphite_soft'], cabin)
    oriented_box('bed_deck', (centre_x, centre_y, BED_TOP - 0.025), FLAT, (wide, long, 0.05), mats['white'], cabin, 0.012)
    opening = DRAWER_Y[0] - DRAWER_Y[1]
    uprights = [y1 - 0.02] + [(a + b) / 2 for a, b in zip(DRAWER_Y, DRAWER_Y[1:])] + [y0 + 0.02]
    for i, y in enumerate(uprights):
        oriented_box(f'bed_upright_{i}', (centre_x, y, DRAWER_Z), FLAT, (wide, 0.04, 0.36), mats['white'], cabin, 0.004)
    back = [(x0 + 0.5, y0, QUARTERS_FLOOR), (x0 + 0.5, y1, QUARTERS_FLOOR), (x0 + 0.5, y1, BED_TOP - 0.05), (x0 + 0.5, y0, BED_TOP - 0.05)]
    mesh_object('bed_inside', back, [(0, 1, 2, 3)], mats['graphite'], cabin)
    pillow('bed_mattress', (centre_x, centre_y, BED_TOP + 0.07), FLAT, (wide - 0.03, long - 0.03, 0.14), mats['cushion'], cabin, 0.05)
    pillow('bed_pillow', (centre_x, y1 - 0.25, BED_TOP + 0.18), FLAT, (0.5, 0.32, 0.09), mats['white_trim'], cabin, 0.04)
    for i, y in enumerate(DRAWER_Y):
        build_drawer(i + 1, y, mats)
    assert opening - 0.04 > DRAWER_SIZE[1], 'the drawers have to fit between the uprights'


# ponytail: the science bay's cabinets are blocks with a dark face until there is something to do in there
RACK_SIZE = (0.4, 1.0, 1.1)  # deep, long, high
RACKS = tuple((side * 1.0, SCIENCE_AFT + y) for side in (-1, 1) for y in (0.7, 1.9))  # the middle of each, in plan


def build_racks(mats) -> None:
    cabin = collection('cabin')
    deep, long, high = RACK_SIZE
    for i, (x, y) in enumerate(RACKS):
        oriented_box(f'rack_{i}', (x, y, QUARTERS_FLOOR + high / 2), FLAT, (deep, long, high), mats['white'], cabin, 0.02)
        face = x - math.copysign(deep / 2 + 0.002, x)
        oriented_box(f'rack_{i}_face', (face, y, QUARTERS_FLOOR + high * 0.6), FLAT, (0.006, long - 0.12, high * 0.6), mats['graphite_soft'], cabin, 0.004)


def build_furniture(mats) -> None:
    build_desk(mats)
    build_chair(mats)
    build_bed(mats)
    build_racks(mats)
