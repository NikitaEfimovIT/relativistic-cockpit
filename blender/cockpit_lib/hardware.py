"""Controls and instruments as hardware: each sits on a named mount (an empty) that the app will find by name, with
its parts as children. Legends and screen pictures go to the render-only `labels` collection."""

import math

from .geometry import (
    LEGEND_FONT, SCREEN_FONT, Axes, Vec, attach, capsule, collection, cylinder, disc, frame_point, label, mount, oriented_box,
    picture_frame, pillow, ring,
)


def colls():
    return collection('cabin'), collection('placeholders'), collection('labels')


def spin(axes: Axes, angle: float) -> Axes:
    """The same surface, turned by `angle` within its own plane."""
    right, up, normal = axes
    c, s = math.cos(angle), math.sin(angle)
    return (tuple(c * right[i] + s * up[i] for i in range(3)), tuple(-s * right[i] + c * up[i] for i in range(3)), normal)


def legend(name: str, text: str, origin: Vec, axes: Axes, v: float, mats, size: float = 0.0095, u: float = 0.0, mat_key: str = 'legend'):
    return label(name, text, frame_point(origin, axes, u, v), axes, size, mats[mat_key], colls()[2], LEGEND_FONT)


# ---------------------------------------------------------------------------------------------------------------------
# Screens


BEZEL = 0.026  # m the bezel adds to a screen's width and height


def screen(name: str, origin: Vec, axes: Axes, width: float, height: float, mats, paint=None):
    """A flat display in a bezel; `paint(origin, axes, width, height)` draws the picture for the renders."""
    cabin, places, _ = colls()
    holder = mount(name, origin, axes, places)
    bezel = picture_frame(f'{name}_bezel', origin, axes, width + BEZEL, height + BEZEL, 0.015, 0.007, mats['graphite_soft'], cabin)
    glass = oriented_box(f'{name}_glass', frame_point(origin, axes, 0, 0, 0.001), axes, (width, height, 0.002), mats['screen_glass'], cabin, 0)
    attach(holder, bezel, glass)
    if paint:
        attach(holder, *paint(frame_point(origin, axes, 0, 0, 0.0025), axes, width, height))
    return holder


def text_rows(prefix: str, title: str, accent: str, rows: list[tuple[str, str, str]], mats, title_right: tuple[str, str] | None = None):
    """A painter for a screen of labelled values, like the app's own: title, rule, then label on the left, value on the right."""
    def paint(origin: Vec, axes: Axes, width: float, height: float) -> list:
        labels = colls()[2]
        pad = height * 0.07
        title_size = height * 0.075
        top = height / 2 - pad
        drawn = [label(f'{prefix}_title', title, frame_point(origin, axes, -width / 2 + pad, top - title_size / 2), axes, title_size,
                       mats[f'ui_{accent}'], labels, SCREEN_FONT, 'LEFT')]
        if title_right:
            text, tone = title_right
            drawn.append(label(f'{prefix}_title_right', text, frame_point(origin, axes, width / 2 - pad, top - title_size / 2), axes, title_size,
                               mats[f'ui_{tone}'], labels, SCREEN_FONT, 'RIGHT'))
        rule_v = top - title_size - 0.006
        drawn.append(oriented_box(f'{prefix}_rule', frame_point(origin, axes, 0, rule_v), axes, (width - 2 * pad, 0.0012, 0.0005),
                                  mats[f'ui_{accent}'], labels, 0))
        row_height = (rule_v - (-height / 2 + pad)) / max(1, len(rows))
        size = min(height * 0.06, row_height * 0.62)
        for i, (name, value, tone) in enumerate(rows):
            v = rule_v - row_height * (i + 0.5)
            if name:
                drawn.append(label(f'{prefix}_row{i}', name, frame_point(origin, axes, -width / 2 + pad, v), axes, size, mats['ui_dim'],
                                   labels, SCREEN_FONT, 'LEFT'))
            drawn.append(label(f'{prefix}_value{i}', value, frame_point(origin, axes, width / 2 - pad if name else -width / 2 + pad, v), axes,
                               size * 1.12, mats[f'ui_{tone or accent}'], labels, SCREEN_FONT, 'RIGHT' if name else 'LEFT'))
        return drawn
    return paint


# ---------------------------------------------------------------------------------------------------------------------
# Switches, buttons, knobs


def toggle(name: str, origin: Vec, axes: Axes, mats, text: str, is_on: bool = False, lamp: str = 'green', guarded: bool = False):
    """A bat-handle toggle on a hex nut, its lamp beside it and its legend below; red glass over it if guarded."""
    cabin, places, _ = colls()
    holder = mount(name, origin, axes, places)
    lean = math.radians(22 if is_on else -22)  # the handle leans up the panel when the switch is on
    base = frame_point(origin, axes, 0, 0, 0.009)
    tip = frame_point(origin, axes, 0, math.sin(lean) * 0.026, 0.009 + math.cos(lean) * 0.026)
    parts = [
        cylinder(f'{name}_nut', origin, axes, 0.011, 0.004, mats['dark_metal'], cabin, 6),
        cylinder(f'{name}_collar', frame_point(origin, axes, 0, 0, 0.004), axes, 0.0055, 0.006, mats['metal'], cabin, 16),
        capsule(f'{name}_handle', base, tip, 0.0032, mats['metal'], cabin, 12, 3),
        disc(f'{name}_lamp', frame_point(origin, axes, 0.022, 0.006, 0.0008), axes, 0.0035, mats[lamp] if is_on else mats['lamp_off'], cabin, 16),
        legend(f'{name}_legend', text, origin, axes, -0.025, mats),
    ]
    if guarded:
        parts.append(oriented_box(f'{name}_guard', frame_point(origin, axes, 0, 0.002, 0.017), axes, (0.034, 0.058, 0.03), mats['guard'], cabin, 0.004))
        parts.append(cylinder(f'{name}_guard_hinge', frame_point(origin, axes, 0, 0.031, 0.0), axes, 0.004, 0.032, mats['dark_metal'], cabin, 12))
    return attach(holder, *parts)


KEY_SIZE = (0.06, 0.026)  # m, the face of a key beside a screen


def key(name: str, origin: Vec, axes: Axes, mats, text: str = '', arrow: int = 0):
    """A square-edged key beside a screen: a cap proud of a dark frame, its legend lit on top. `arrow` +1 or −1 draws ▲
    or ▼ in place of the text, as a triangle: the legend font has no arrows."""
    cabin, places, labels = colls()
    holder = mount(name, origin, axes, places)
    w, h = KEY_SIZE
    top = frame_point(origin, axes, 0, 0, 0.0092)
    legend_part = (disc(f'{name}_arrow', top, spin(axes, arrow * math.pi / 2), 0.007, mats['legend'], labels, 3) if arrow
                   else label(f'{name}_legend', text, top, axes, 0.0075, mats['legend'], labels))
    return attach(holder,
                  oriented_box(f'{name}_frame', frame_point(origin, axes, 0, 0, 0.002), axes, (w, h, 0.004), mats['dark_metal'], cabin, 0.002),
                  oriented_box(f'{name}_cap', frame_point(origin, axes, 0, 0, 0.006), axes, (w - 0.006, h - 0.005, 0.006), mats['graphite_soft'],
                               cabin, 0.002),
                  legend_part)


def knob(name: str, origin: Vec, axes: Axes, mats, text: str, radius: float = 0.016, ticks: int = 18):
    """A detented rotary knob over a ring of ticks, with a pointer line on its top."""
    cabin, places, _ = colls()
    holder = mount(name, origin, axes, places)
    parts = [
        disc(f'{name}_skirt', frame_point(origin, axes, 0, 0, 0.0005), axes, radius + 0.012, mats['graphite_soft'], cabin, 48),
        cylinder(f'{name}_body', origin, axes, radius, 0.017, mats['dark_metal'], cabin, 30),
        disc(f'{name}_top', frame_point(origin, axes, 0, 0, 0.0172), axes, radius * 0.82, mats['metal'], cabin, 30),
        oriented_box(f'{name}_pointer', frame_point(origin, axes, 0, radius * 0.45, 0.0176), axes, (0.0022, radius * 0.7, 0.0008), mats['legend'], cabin, 0),
        legend(f'{name}_legend', text, origin, axes, radius + 0.022, mats, 0.011),
    ]
    for i in range(ticks):
        tick_axes = spin(axes, 2 * math.pi * i / ticks)
        parts.append(oriented_box(f'{name}_tick{i}', frame_point(origin, tick_axes, 0, radius + 0.007, 0.001), tick_axes,
                                  (0.0015, 0.005, 0.0006), mats['legend'], cabin, 0))
    return attach(holder, *parts)


def lamp_cell(name: str, origin: Vec, axes: Axes, size: tuple[float, float], mat, text: str, mats, text_size: float, is_lit: bool):
    """A square annunciator lens with its legend engraved on it: dark letters when lit, light ones when not."""
    lens = oriented_box(f'{name}_lens', frame_point(origin, axes, 0, 0, 0.002), axes, (size[0], size[1], 0.004), mat, colls()[0], 0.0012, 2)
    engraved = label(f'{name}_legend', text, frame_point(origin, axes, 0, 0, 0.0042), axes, text_size, mats['paint' if is_lit else 'legend'],
                     colls()[2], LEGEND_FONT)
    return [lens, engraved]


# ---------------------------------------------------------------------------------------------------------------------
# Instruments


def gauge(name: str, origin: Vec, axes: Axes, radius: float, mats, caption: str, hands: tuple[float, float] = (0.3, 0.72)):
    """An analogue clock: bezel, dial with twelve ticks, two hands and a centre cap."""
    cabin, places, labels = colls()
    holder = mount(name, origin, axes, places)
    parts = [
        ring(f'{name}_bezel', origin, axes, radius + 0.007, radius, 0.008, mats['metal'], cabin),
        disc(f'{name}_dial', frame_point(origin, axes, 0, 0, 0.001), axes, radius, mats['screen_glass'], cabin, 48),
        disc(f'{name}_cap', frame_point(origin, axes, 0, 0, 0.0045), axes, 0.0045, mats['metal'], cabin, 16),
        label(f'{name}_caption', caption, frame_point(origin, axes, 0, radius + 0.016), axes, 0.0085, mats['legend'], labels, LEGEND_FONT),
    ]
    for i in range(12):
        tick_axes = spin(axes, 2 * math.pi * i / 12)
        length = 0.008 if i % 3 == 0 else 0.0045
        parts.append(oriented_box(f'{name}_tick{i}', frame_point(origin, tick_axes, 0, radius - 0.004 - length / 2, 0.0016), tick_axes,
                                  (0.0016, length, 0.0006), mats['legend'], cabin, 0))
    for i, (turn, length, key) in enumerate(((hands[0], 0.55, 'legend'), (hands[1], 0.85, 'amber'))):
        hand_axes = spin(axes, -2 * math.pi * turn)
        parts.append(oriented_box(f'{name}_hand{i}', frame_point(origin, hand_axes, 0, radius * length / 2, 0.003 + 0.0008 * i), hand_axes,
                                  (0.0028 - 0.0008 * i, radius * length, 0.0008), mats[key], cabin, 0))
    return attach(holder, *parts)


def stick(name: str, origin: Vec, axes: Axes, mats) -> object:
    """The attitude hand controller: a black boot on a round base and a grip on top, upright; the app tilts it with the keys."""
    cabin, places, _ = colls()
    holder = mount(name, origin, axes, places)
    return attach(holder,
                  cylinder(f'{name}_base', origin, axes, 0.045, 0.012, mats['dark_metal'], cabin, 32),
                  cylinder(f'{name}_boot', frame_point(origin, axes, 0, 0, 0.012), axes, 0.026, 0.03, mats['seal'], cabin, 20),
                  capsule(f'{name}_shaft', frame_point(origin, axes, 0, 0, 0.03), frame_point(origin, axes, 0, 0, 0.09), 0.009, mats['metal'], cabin, 12, 3),
                  pillow(f'{name}_grip', frame_point(origin, axes, 0, 0, 0.115), axes, (0.036, 0.04, 0.06), mats['grip'], cabin, 0.014),
                  legend(f'{name}_legend', 'ОРИЕНТАЦИЯ', origin, axes, -0.065, mats, 0.011))


def lever(name: str, origin: Vec, axes: Axes, mats, text: str, travel: float = 0.16):
    """A short sled for one engine's thrust, off at the back of its track and full at the front."""
    cabin, places, _ = colls()
    holder = mount(name, origin, axes, places)
    return attach(holder,
                  oriented_box(f'{name}_track', frame_point(origin, axes, 0, 0, 0.004), axes, (0.08, travel + 0.06, 0.008), mats['graphite_soft'], cabin, 0.008),
                  oriented_box(f'{name}_slot', frame_point(origin, axes, 0, 0, 0.0085), axes, (0.014, travel + 0.01, 0.001), mats['seal'], cabin, 0),
                  pillow(f'{name}_sled', frame_point(origin, axes, 0, -travel / 2, 0.026), axes, (0.05, 0.07, 0.034), mats['white'], cabin, 0.014),
                  legend(f'{name}_legend', text, origin, axes, -travel / 2 - 0.05, mats, 0.012))


def push_button(name: str, origin: Vec, axes: Axes, mats, text: str):
    """A red mushroom button under a hinged clear cover, for what must stop at once."""
    cabin, places, _ = colls()
    holder = mount(name, origin, axes, places)
    return attach(holder,
                  cylinder(f'{name}_collar', origin, axes, 0.03, 0.01, mats['dark_metal'], cabin, 28),
                  cylinder(f'{name}_cap', frame_point(origin, axes, 0, 0, 0.01), axes, 0.022, 0.014, mats['red_dim'], cabin, 28),
                  oriented_box(f'{name}_cover', frame_point(origin, axes, 0, 0, 0.03), axes, (0.07, 0.07, 0.04), mats['guard'], cabin, 0.006),
                  legend(f'{name}_legend', text, origin, axes, -0.05, mats, 0.011))


THROTTLE_MARKS = 9  # lamps along each side of the track, the middle one at the detent


def scale_marks(name: str, origin: Vec, axes: Axes, length: float, u: float, mats) -> list:
    """Lamps along the travel: green ahead of the detent, amber behind it, white at it."""
    marks = []
    for i in range(THROTTLE_MARKS):
        v = -length / 2 + length * i / (THROTTLE_MARKS - 1)
        key = 'ui_dim' if i == THROTTLE_MARKS // 2 else ('ui_green' if v > 0 else 'ui_amber')
        marks.append(oriented_box(f'{name}{i}', frame_point(origin, axes, u, v, 0.009), axes, (0.012, 0.004, 0.002), mats[key], colls()[0], 0))
    return marks


def throttle(name: str, origin: Vec, axes: Axes, mats, travel: float = 0.24, setting: float = 0.0):
    """A low sled in a long track, pushed forward for thrust and pulled back to brake, with a detent between and a row
    of lamps either side. It stands 5 cm off the console, so it hides nothing on the wall beyond it."""
    cabin, places, _ = colls()
    holder = mount(name, origin, axes, places)
    v = setting * travel / 2
    parts = [
        oriented_box(f'{name}_track', frame_point(origin, axes, 0, 0, 0.004), axes, (0.11, travel + 0.08, 0.008), mats['graphite_soft'], cabin, 0.008),
        oriented_box(f'{name}_slot', frame_point(origin, axes, 0, 0, 0.0085), axes, (0.016, travel + 0.02, 0.001), mats['seal'], cabin, 0),
        *scale_marks(f'{name}_mark_in', origin, axes, travel, -0.04, mats),
        *scale_marks(f'{name}_mark_out', origin, axes, travel, 0.04, mats),
        pillow(f'{name}_sled', frame_point(origin, axes, 0, v, 0.03), axes, (0.07, 0.1, 0.04), mats['white'], cabin, 0.018),
        pillow(f'{name}_pad', frame_point(origin, axes, 0, v - 0.012, 0.05), axes, (0.05, 0.06, 0.008), mats['grip'], cabin, 0.004),
        oriented_box(f'{name}_nose', frame_point(origin, axes, 0, v + 0.051, 0.03), axes, (0.05, 0.003, 0.006), mats['cyan'], cabin, 0.001),
        legend(f'{name}_forward', '+1 g', origin, axes, travel / 2, mats, 0.011, -0.085, 'ui_green'),
        legend(f'{name}_detent', '0', origin, axes, 0.0, mats, 0.011, -0.085),
        legend(f'{name}_back', '−1 g', origin, axes, -travel / 2, mats, 0.011, -0.085, 'ui_amber'),
        legend(f'{name}_legend', 'ТЯГА', origin, axes, -travel / 2 - 0.05, mats, 0.013),
    ]
    return attach(holder, *parts)
