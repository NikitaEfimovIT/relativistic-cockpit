"""The instrument panel: three facets turned to the pilot, a hood over each, the screens, the clocks, and the
annunciator with the master alarm on the lip of the hood where the eye already is."""

import math

from . import hardware as hw
from .geometry import Axes, Vec, attach, collection, frame_point, label, mount, oriented_box, rotate_z, sweep, subsurf, tilted_axes
from .cabin import RIB_DEPTH, RIB_WIDTH
from .shape import BOW_Y, canopy_x_at

PANEL_CENTRE: Vec = (0.0, 0.95, -0.33)
PANEL_TILT = math.atan2(-PANEL_CENTRE[2], PANEL_CENTRE[1])  # rad: the panel square to the pilot's eye
PANEL_HEIGHT = 0.5
CENTRE_WIDTH = 0.72
WING_WIDTH = 0.97  # out to the wall: 2.5 m across with the centre
WING_YAW = math.radians(25)
HOOD_GAP = 0.003  # m at each end of a hood, so that the three read as separate mouldings

# The hood in section: (towards the pilot, up) from the top edge of its facet. A rounded lip over the screens, then a
# long top running forward towards the glass.
HOOD_PROFILE = [(0.0, -0.014), (0.032, -0.014), (0.056, -0.004), (0.064, 0.016), (0.052, 0.036), (0.02, 0.046),
                (-0.1, 0.05), (-0.22, 0.044), (-0.33, 0.026), (-0.35, 0.005), (-0.34, -0.012), (-0.15, -0.016)]


def facets() -> list[tuple[str, Vec, Axes, float, float]]:
    """(label, centre, axes, width, yaw) of the three facets; the wings hinge on the edges of the centre one."""
    axes = tilted_axes(PANEL_TILT)
    found = [('centre', PANEL_CENTRE, axes, CENTRE_WIDTH, 0.0)]
    for side, name in ((-1, 'left'), (1, 'right')):
        hinge = frame_point(PANEL_CENTRE, axes, side * CENTRE_WIDTH / 2, 0)
        yaw = -side * WING_YAW  # out and back towards the pilot, so that each wing faces in
        wing_axes = tilted_axes(PANEL_TILT, yaw)
        found.append((name, frame_point(hinge, wing_axes, side * WING_WIDTH / 2, 0), wing_axes, WING_WIDTH, yaw))
    return found


GLASS_CLEARANCE = 0.02  # m the hoods keep from the inside of the canopy
BOW_DEPTH = RIB_DEPTH  # m the bow stands in from the glass
BOW_HALF_THICKNESS = RIB_WIDTH / 2  # m along the ship either side of BOW_Y


def is_clear_of_canopy(point: Vec) -> bool:
    """Inside the glass by the clearance, and by the bow's depth as well where the bow is."""
    x, y, z = point
    margin = GLASS_CLEARANCE + (BOW_DEPTH if abs(y - BOW_Y) < BOW_HALF_THICKNESS + GLASS_CLEARANCE / 2 else 0.0)
    return abs(x) <= canopy_x_at(y, z) - margin


def hood(name: str, centre: Vec, axes: Axes, width: float, yaw: float, mats, outer_end: float | None):
    """A hood swept along its facet's top edge, its top running forward towards the glass. On a wing it shortens towards
    the outer end; anywhere it shortens further rather than come near the glass or run into the bow."""
    towards_pilot = rotate_z((0.0, -1.0, 0.0), yaw)

    def ring(top: Vec, reach: float) -> list[Vec]:
        return [(top[0] + towards_pilot[0] * d * (reach if d < 0 else 1.0), top[1] + towards_pilot[1] * d * (reach if d < 0 else 1.0), top[2] + z)
                for d, z in HOOD_PROFILE]

    rings = []
    steps = 8
    for i in range(steps + 1):
        u = -width / 2 + HOOD_GAP + (width - 2 * HOOD_GAP) * i / steps
        reach = 1.0 if outer_end is None else 1.0 - 0.82 * max(0.0, u * outer_end / (width / 2))
        top = frame_point(centre, axes, u, PANEL_HEIGHT / 2)
        while reach > 0.05 and not all(is_clear_of_canopy(p) for p in ring(top, reach)):
            reach -= 0.01
        rings.append(ring(top, reach))
    return subsurf(sweep(name, rings, mats['white'], collection('cabin'), closed_profile=True, caps=True), 1)


def build_panel(mats) -> None:
    cabin = collection('cabin')
    by_name = {name: (centre, axes, width, yaw) for name, centre, axes, width, yaw in facets()}
    for name, (centre, axes, width, yaw) in by_name.items():
        oriented_box(f'panel_{name}', frame_point(centre, axes, 0, 0, -0.025), axes, (width, PANEL_HEIGHT, 0.05), mats['graphite'], cabin, 0.012)
        hood(f'glareshield_{name}', centre, axes, width, yaw, mats, {'left': -1.0, 'right': 1.0}.get(name))
    build_screens(by_name, mats)
    build_lip(by_name['centre'], mats)
    centre, axes, _, _ = by_name['centre']
    oriented_box('light_line_panel', frame_point(centre, axes, 0, -PANEL_HEIGHT / 2 - 0.006, 0.01), axes, (CENTRE_WIDTH - 0.04, 0.005, 0.005),
                 mats['strip'], cabin, 0)


def build_screens(by_name, mats) -> None:
    centre, axes, _, _ = by_name['centre']
    hw.screen('scr_rear', frame_point(centre, axes, 0, 0.065), axes, *REAR_SCREEN, mats, rear_camera(mats))
    hw.screen('scr_time', frame_point(centre, axes, 0, TIME_V), axes, *TIME_SCREEN, mats, time_cells(mats))
    nav = hw.text_rows('ui_nav', 'НАВИГАЦИЯ → α ЦЕНТАВРА A', 'amber', [
        ('СКОРОСТЬ', '0.0000 % c', ''), ('γ', '1.000', ''), ('СОБСТВ. УСКОРЕНИЕ', '0.00 g', ''),
        ('ДО ЦЕЛИ', '4.37 св. г', ''), ('ТОРМОЗНОЙ ПУТЬ, 1 g', '0 км', '')], mats)
    rad = hw.text_rows('ui_rad', 'ЩИТ ВКЛЮЧЁН', 'cyan', [
        ('ПОТОК ВОДОРОДА', '0', ''), ('ЭНЕРГИЯ ПРОТОНА', '0.000 ГэВ', ''), ('ДОЗА БЕЗ ЩИТА', '0.0 Зв/с', ''),
        ('ДОЗА ЭКИПАЖА', '0.0 Зв', ''), ('ЭКИПАЖ', 'В НОРМЕ', 'green')], mats)
    for name, screen_name, paint in (('left', 'scr_nav', nav), ('right', 'scr_rad', rad)):
        wing_centre, wing_axes, _, _ = by_name[name]
        hw.screen(screen_name, frame_point(wing_centre, wing_axes, 0, 0.06), wing_axes, *WING_SCREEN, mats, paint)
    # The clocks either side of the rear screen, over the τ and t of the time screen: the ship's on the left, the galaxy's
    # on the right
    clock_u = ((REAR_SCREEN[0] + hw.BEZEL) / 2 + CENTRE_WIDTH / 2) / 2
    for side, gauge_name, caption, hands in ((-1, 'gauge_ship', 'БОРТ, лет', (0.08, 0.31)), (1, 'gauge_galaxy', 'ГАЛАКТИКА, лет', (0.08, 0.36))):
        hw.gauge(gauge_name, frame_point(centre, axes, side * clock_u, CLOCK_V, 0.001), axes, CLOCK_RADIUS, mats, caption, hands)
    build_row(by_name['centre'], mats)
    build_target(by_name['right'], mats)
    build_strip(by_name['left'], mats)


REAR_SCREEN = (0.5, 0.35)  # m: as wide as the rear camera's picture is for its height, with room for a clock each side
TIME_SCREEN, TIME_V = (0.46, 0.09), -0.18  # m, and how far under the centre facet's middle
WING_SCREEN = (0.7, 0.36)  # m: navigation on the left, radiation on the right
CLOCK_V = 0.06  # m above the centre facet's middle
CLOCK_RADIUS = 0.04
TARGET_SCREEN = (0.24, 0.09)  # m
TARGET_V = -0.19  # m below the right wing's middle: under the radiation screen
TARGET_KEYS = (('ctl_target_up', 1, 0.035), ('ctl_target_select', 0, 0.0), ('ctl_target_down', -1, -0.035))  # name, arrow, v


def build_target(wing, mats) -> None:
    """The table of targets on a screen of its own under the radiation screen, with keys beside it: up and down the
    table, and ВЫБРАТЬ to turn the ship to the one lit."""
    centre, axes, _, _ = wing
    hw.screen('scr_target', frame_point(centre, axes, 0.0, TARGET_V), axes, *TARGET_SCREEN, mats, hw.text_rows('ui_target', 'ЦЕЛЬ', 'cyan', [
        ('Солнце', '4.37 св. г', ''), ('● α ЦЕНТАВРА A', '4.37 св. г', 'amber'), ('α Центавра B', '4.37 св. г', '')], mats))
    keys_u = (TARGET_SCREEN[0] + hw.BEZEL) / 2 + 0.008 + hw.KEY_SIZE[0] / 2
    for name, arrow, dv in TARGET_KEYS:
        hw.key(name, frame_point(centre, axes, keys_u, TARGET_V + dv, 0.001), axes, mats, 'ВЫБРАТЬ', arrow)


STRIP_V = -0.19  # m below the left wing's middle: under the navigation screen, the mirror of the target screen
TIMER_SCREEN, TIMER_U = (0.24, 0.09), 0.08  # m, the event timer, between the chemical engine's switches and the light mode's
# name, across, legend, guarded: outboard the chemical engine in the order of its start, inboard the attitude mode and
# the light mode, the light mode's next to the bus at the start of the centre row
STRIP = (('ctl_pressurise', -0.42, 'НАДДУВ', False), ('ctl_feed', -0.33, 'ПОДАЧА', False), ('ctl_crossfeed', -0.24, 'ПЕРЕКР.', False),
         ('ctl_chem_engine', -0.13, 'ДОСВЕТ ПУСК', True), ('ctl_attitude', 0.27, 'РУЧН. УПР.', False), ('ctl_lightmode', 0.37, 'СВЕТ. РЕЖИМ', True))


def build_strip(wing, mats) -> None:
    """Under the navigation screen: the chemical engine's switches, the event timer, the attitude and the light mode."""
    centre, axes, _, _ = wing
    hw.screen('scr_timer', frame_point(centre, axes, TIMER_U, STRIP_V), axes, *TIMER_SCREEN, mats, hw.text_rows('ui_timer', 'ТАЙМЕР', 'green', [
        ('ДО ПЕРИЦЕНТРА', '24 мин', '')], mats))
    for name, u, text, guarded in STRIP:
        hw.toggle(name, frame_point(centre, axes, u, STRIP_V, 0.001), axes, mats, text, guarded=guarded)


ROW_HEIGHT = 0.15  # m: the strip of switches under the centre screen
ROW = (('ctl_bus', -0.26), ('ctl_arm', -0.15), ('ctl_engine', -0.04), ('ctl_shield', 0.09), ('ctl_master', 0.24))  # name, across


def build_row(centre_facet, mats) -> None:
    """Under the centre screen, as on the reference: the start in the order of the checklist, the shield, and the master
    alarm at the end of the row."""
    centre, axes, _, _ = centre_facet
    cabin = collection('cabin')
    middle = frame_point(centre, axes, 0, -PANEL_HEIGHT / 2 - ROW_HEIGHT / 2 - 0.005, 0.03)
    oriented_box('panel_row', frame_point(middle, axes, 0, 0, -0.03), axes, (CENTRE_WIDTH - 0.06, ROW_HEIGHT, 0.06), mats['graphite'], cabin, 0.012)
    at = {name: frame_point(middle, axes, u, 0.01, 0.001) for name, u in ROW}
    hw.toggle('ctl_bus', at['ctl_bus'], axes, mats, 'ШИНА', is_on=True)
    hw.toggle('ctl_arm', at['ctl_arm'], axes, mats, 'ВЗВЕДЕНИЕ', is_on=True, lamp='amber')
    hw.toggle('ctl_engine', at['ctl_engine'], axes, mats, 'ПУСК ДВИГАТЕЛЯ', guarded=True)
    hw.toggle('ctl_shield', at['ctl_shield'], axes, mats, 'ЩИТ', guarded=True)
    button = mount('ctl_master', at['ctl_master'], axes, collection('placeholders'))
    attach(button,
           oriented_box('ctl_master_cap', frame_point(at['ctl_master'], axes, 0, 0, 0.006), axes, (0.08, 0.05, 0.012), mats['red_dim'], cabin, 0.004),
           label('ctl_master_legend', 'АВАРИЯ', frame_point(at['ctl_master'], axes, 0, -0.04, 0.002), axes, 0.0075, mats['legend'], collection('labels')))


def rear_camera(mats):
    def paint(origin: Vec, axes: Axes, width: float, height: float) -> list:
        labels = collection('labels')
        stars = oriented_box('ui_rear_stars', origin, axes, (width - 0.01, height - 0.03, 0.0004), mats['stars'], labels, 0)
        caption = label('ui_rear_caption', 'ЗАДНИЙ ОБЗОР · D ×1.000 · 17.9 % НЕБА · УСИЛ. ×1.0', frame_point(origin, axes, 0, -height / 2 + 0.012),
                        axes, 0.0085, mats['ui_cyan'], labels, hw.SCREEN_FONT)
        return [stars, caption]
    return paint


def time_cells(mats):
    def paint(origin: Vec, axes: Axes, width: float, height: float) -> list:
        labels = collection('labels')
        drawn = []
        for i, (title, value) in enumerate((('БОРТОВОЕ ВРЕМЯ τ', '0.01 лет'), ('ВРЕМЯ ГАЛАКТИКИ t', '0.01 лет'))):
            u = -width / 2 + 0.012 + i * width / 2
            drawn.append(label(f'ui_time_title{i}', title, frame_point(origin, axes, u, height * 0.22), axes, 0.0095, mats['ui_dim'], labels,
                               hw.SCREEN_FONT, 'LEFT'))
            drawn.append(label(f'ui_time_value{i}', value, frame_point(origin, axes, u, -height * 0.16), axes, 0.019, mats['ui_green'], labels,
                               hw.SCREEN_FONT, 'LEFT'))
        return drawn
    return paint


# in the order of src/annunciator.ts's cells: a lens's number is its cell's
ANNUNCIATOR = ('РАДИАЦИЯ', 'ДОЗА', 'CO2', 'ТОРМОЗИ', 'НЕТ СВЯЗИ', 'НЕ ВЗВЕДЁН', 'ПИТАНИЕ', 'ЖИЗНЕОБЕСП.', 'ТОПЛИВО')


def build_lip(centre_facet, mats) -> None:
    """The face of the centre hood's lip: the annunciator's cells, one for each in ANNUNCIATOR."""
    centre, axes, _, _ = centre_facet
    top = frame_point(centre, axes, 0, PANEL_HEIGHT / 2)
    lip = (top[0], top[1] - 0.063, top[2] + 0.014)
    lip_axes = tilted_axes(math.radians(10))
    holder = mount('annunciator', lip, lip_axes, collection('placeholders'))
    cells = []
    for i, text in enumerate(ANNUNCIATOR):
        u = (i - (len(ANNUNCIATOR) - 1) / 2) * 0.05
        cells += hw.lamp_cell(f'annunciator_{i}', frame_point(lip, lip_axes, u, 0), lip_axes, (0.046, 0.017), mats['lamp_off'], text, mats, 0.0062, False)
    attach(holder, *cells)
