"""The life-support console on the starboard wall of the engineering bay, across the aisle from the desk: a cabinet with a
face sloped towards whoever stands at it, the screen and the dials up the slope, the controls near the hands in framed
groups. And the small room panel by the bed in the living compartment: the dials, the light and the thermostat.

The app draws the controls, their legends and the group titles on these mounts; the walk map aims the gaze at them."""

import math

from . import hardware as hw
from .geometry import Axes, attach, collection, frame_point, mesh_object, mount, oriented_box
from .shape import FLOOR, ZONES, half_width

_, ENGINEERING_AFT, ENGINEERING_FORE = ZONES[3]
_, LIVING_AFT, LIVING_FORE = ZONES[2]

# The cabinet: as long as the desk across the aisle, its face from 0.80 m to 1.15 m over the deck, under the porthole
CONSOLE_Y = ENGINEERING_AFT + 1.75  # the desk's middle
CONSOLE_LENGTH = 1.9  # nine columns of controls in four groups
FRONT_HEIGHT = 0.80
SLOPE = math.radians(40)  # the face from the horizontal: square on to the eye of someone standing half a metre off
SLOPE_LENGTH = 0.55
TOP_HEIGHT = FRONT_HEIGHT + SLOPE_LENGTH * math.sin(SLOPE)
BACK_X = half_width(CONSOLE_Y, FLOOR + TOP_HEIGHT) - 0.01  # the face's top edge against the wall
FRONT_X = BACK_X - SLOPE_LENGTH * math.cos(SLOPE)
# Read standing in front: right is aft (−y), up the slope towards the wall, out of it towards the eye
FACE_AXES: Axes = ((0.0, -1.0, 0.0), (math.cos(SLOPE), 0.0, math.sin(SLOPE)), (-math.sin(SLOPE), 0.0, math.cos(SLOPE)))
FACE_CENTRE = ((FRONT_X + BACK_X) / 2, CONSOLE_Y, FLOOR + (FRONT_HEIGHT + TOP_HEIGHT) / 2)

PITCH = 0.17  # m between columns: a legend of eleven letters at 2.7 cm
GROUP_GAP = 0.06
UPPER_ROW, LOWER_ROW, TITLE_ROW = -0.035, -0.145, 0.03  # heights up the face from its middle
MONITOR_ROW = 0.165
FRAME_TOP, FRAME_BOTTOM = 0.055, -0.225
STATUS_SCREEN = (0.44, 0.17)  # a title and six lines of 2.4 cm
DIAL_RADIUS = 0.075

# The groups, left to right: their key (the app's title), and their controls by column, upper then lower
GROUPS = (
    ('power', (('ctl_wall_bus', 'ШИНА', 'switch'), ('ctl_wall_breaker_nav', 'НАВИГАЦИЯ', 'switch')),
              (('ctl_wall_breaker_comms', 'СВЯЗЬ', 'switch'), ('ctl_wall_breaker_dosimeter', 'ДОЗИМЕТР', 'switch')),
              (('ctl_wall_reactor', 'РЕАКТОР', 'switch'), ('ctl_wall_breaker_camera', 'КАМЕРА', 'switch'))),
    ('air', (('ctl_wall_lights', 'СВЕТ', 'switch'), ('ctl_wall_fans', 'ВЕНТИЛЯТОРЫ', 'switch')),
            (('ctl_wall_o2', 'КИСЛОРОД', 'switch'), ('ctl_wall_scrubber', 'ПОГЛОТИТЕЛЬ', 'switch'))),
    ('heat', (('ctl_wall_heater_1', 'ОБОГРЕВ 1', 'switch'), ('ctl_wall_setpoint_down', 'УСТАВКА −', 'key')),
             (('ctl_wall_heater_2', 'ОБОГРЕВ 2', 'switch'), ('ctl_wall_setpoint_up', 'УСТАВКА +', 'key'))),
    ('pressure', (('ctl_wall_vent', 'СБРОС ДАВЛ.', 'switch'), ('ctl_wall_repress', 'НАДДУВ', 'switch')),
                 (('ctl_wall_isolate', 'ИЗОЛЯЦИЯ', 'switch'),)),  # the vent line's isolation valve, for a vent stuck open
)


def group_spans() -> list[tuple[str, float, float]]:
    """Each group's key and the across-the-face span of its columns' centres, laid out from the left with gaps between."""
    columns = sum(len(columns) for _, *columns in GROUPS)
    width = columns * PITCH + (len(GROUPS) - 1) * GROUP_GAP
    left, spans = -width / 2 + PITCH / 2, []
    for key, *columns in GROUPS:
        spans.append((key, left, left + (len(columns) - 1) * PITCH))
        left += len(columns) * PITCH + GROUP_GAP
    return spans


def at(u: float, v: float, lift: float = 0.0):
    return frame_point(FACE_CENTRE, FACE_AXES, u, v, lift)


def switches() -> list[tuple[str, str, float, float, str]]:
    """Every control on the console: its mount, legend, place (across, up the face) and kind."""
    found = []
    for (_, start, _), (_, *columns) in zip(group_spans(), GROUPS):
        for i, column in enumerate(columns):
            for (name, text, kind), v in zip(column, (UPPER_ROW, LOWER_ROW)):
                found.append((name, text, start + i * PITCH, v, kind))
    return found


SWITCHES = tuple(switches())


def build_cabinet(mats) -> None:
    """The cabinet: its cross-section, from the deck up the front, up the slope to the wall and down it, along the hull."""
    cabin = collection('cabin')
    section = [(FRONT_X, FLOOR), (FRONT_X, FLOOR + FRONT_HEIGHT), (BACK_X, FLOOR + TOP_HEIGHT), (BACK_X, FLOOR)]
    y0, y1 = CONSOLE_Y - CONSOLE_LENGTH / 2, CONSOLE_Y + CONSOLE_LENGTH / 2
    verts = [(x, y, z) for y in (y0, y1) for x, z in section]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3)]
    mesh_object('console_cabinet', verts, faces, mats['white'], cabin)
    oriented_box('console_face', at(0, 0, 0.003), FACE_AXES, (CONSOLE_LENGTH - 0.05, SLOPE_LENGTH - 0.04, 0.006),
                 mats['graphite_soft'], cabin, 0.004)


def build_frames(mats) -> None:
    """A thin raised frame round each group, and a mount for its title over it."""
    cabin, places = collection('cabin'), collection('placeholders')
    top, bottom = FRAME_TOP, FRAME_BOTTOM
    for key, first, last in group_spans():
        left, right = first - PITCH / 2 + 0.01, last + PITCH / 2 - 0.01
        middle, width, height = (left + right) / 2, right - left, top - bottom
        for name, u, v, size in (('top', middle, top, (width, 0.004)), ('bottom', middle, bottom, (width, 0.004)),
                                 ('left', left, (top + bottom) / 2, (0.004, height)), ('right', right, (top + bottom) / 2, (0.004, height))):
            oriented_box(f'console_frame_{key}_{name}', at(u, v, 0.008), FACE_AXES, (*size, 0.003), mats['white_trim'], cabin)
        mount(f'cap_console_{key}', at(middle, TITLE_ROW, 0.008), FACE_AXES, places)


def build_console(mats) -> None:
    build_cabinet(mats)
    build_frames(mats)
    spans = {key: (first, last) for key, first, last in group_spans()}
    middle = {key: (first + last) / 2 for key, (first, last) in spans.items()}
    # the screen over power and air, each dial over the group it answers to
    hw.screen('scr_wall_status', at((spans['power'][0] + spans['air'][1]) / 2, MONITOR_ROW, 0.008), FACE_AXES, *STATUS_SCREEN, mats)
    hw.gauge('gauge_wall_temp', at(middle['heat'], MONITOR_ROW, 0.008), FACE_AXES, DIAL_RADIUS, mats, 'ТЕМПЕРАТУРА, °C', (0.3, 0.55))
    hw.gauge('gauge_wall_pressure', at(middle['pressure'], MONITOR_ROW, 0.008), FACE_AXES, DIAL_RADIUS, mats, 'ДАВЛЕНИЕ, кПа', (0.3, 0.02))
    for name, text, u, v, kind in SWITCHES:
        if kind == 'key':
            hw.key(name, at(u, v, 0.008), FACE_AXES, mats, text)
        else:
            hw.toggle(name, at(u, v, 0.008), FACE_AXES, mats, text, is_on=True)


# ---------------------------------------------------------------------------------------------------------------------
# The room panel by the bed: on the starboard wall between the living compartment's porthole and the rib ahead of it

ROOM_SIZE = (0.28, 0.40)
ROOM_Y = LIVING_FORE - 0.2  # the 0.4 m of wall between the porthole's end and the rib
ROOM_HEIGHT = 1.40  # m over the deck: its middle a little under a standing eye
ROOM_AXES: Axes = ((0.0, -1.0, 0.0), (0.0, 0.0, 1.0), (-1.0, 0.0, 0.0))  # flat, facing into the room
ROOM_CENTRE = (half_width(ROOM_Y, FLOOR + ROOM_HEIGHT + ROOM_SIZE[1] / 2) - 0.03, ROOM_Y, FLOOR + ROOM_HEIGHT)
ROOM_DIAL = 0.055
# The room's controls: its mount, legend, place (across, up) and kind; twins of the console's
ROOM_SWITCHES = (
    ('ctl_room_lights', 'СВЕТ', -0.075, -0.10, 'switch'),
    ('ctl_room_setpoint_down', 'УСТАВКА −', 0.035, -0.10, 'key'),
    ('ctl_room_setpoint_up', 'УСТАВКА +', 0.095, -0.10, 'key'),
)


def room_at(u: float, v: float, lift: float = 0.0):
    return frame_point(ROOM_CENTRE, ROOM_AXES, u, v, lift)


def build_room_panel(mats) -> None:
    cabin = collection('cabin')
    width, height = ROOM_SIZE
    back = half_width(ROOM_Y, FLOOR + ROOM_HEIGHT - height / 2) - ROOM_CENTRE[0]  # the wall leans out below: fill the gap
    attach(mount('room_panel', ROOM_CENTRE, ROOM_AXES, collection('placeholders')),
           oriented_box('room_panel_body', room_at(0, 0, -back / 2), ROOM_AXES, (width, height, back + 0.02), mats['white_trim'], cabin, 0.008),
           oriented_box('room_panel_face', room_at(0, 0, 0.011), ROOM_AXES, (width - 0.03, height - 0.03, 0.003), mats['graphite_soft'], cabin, 0.004))
    for i, name in enumerate(('gauge_room_temp', 'gauge_room_pressure')):
        hw.gauge(name, room_at((i - 0.5) * 0.13, 0.08, 0.014), ROOM_AXES, ROOM_DIAL, mats, '', (0.3, 0.55))
    for name, text, u, v, kind in ROOM_SWITCHES:
        if kind == 'key':
            hw.key(name, room_at(u, v, 0.014), ROOM_AXES, mats, text)
        else:
            hw.toggle(name, room_at(u, v, 0.014), ROOM_AXES, mats, text, is_on=True)
