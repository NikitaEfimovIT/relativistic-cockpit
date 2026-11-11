"""The pilot's seat, upright with its back laid back a little and the feet on the deck, with its harness; and a mannequin."""

import math

from .geometry import FLAT, Vec, capsule, collection, cross, disc, normalise, offset, oriented_box, pillow, ring, subsurf, sweep, uv_sphere
from .shape import FLOOR

RECLINE = math.radians(12)
BACK = (0.0, -math.sin(RECLINE), math.cos(RECLINE))  # from the hips up to the head
BEHIND = (0.0, -math.cos(RECLINE), -math.sin(RECLINE))
FRONT = tuple(-c for c in BEHIND)
ACROSS = (1.0, 0.0, 0.0)
BACK_PLANE: Vec = (0.0, -0.175, -0.033)  # on the cushion, just behind the head
HIPS = offset(offset(BACK_PLANE, BACK, -0.78), FRONT, 0.12)
KNEE_Y, KNEE_Z = 0.55, -0.72
FOOT_Y, FOOT_Z = 0.66, -1.17  # on the deck

# The shell in section across the back: (across, behind the cushion). Side bolsters come forward round the pilot.
SHELL_PROFILE = [(-0.30, -0.06), (-0.315, 0.0), (-0.3, 0.05), (-0.2, 0.075), (0.0, 0.085), (0.2, 0.075), (0.3, 0.05), (0.315, 0.0), (0.30, -0.06),
                 (0.275, -0.06), (0.285, 0.0), (0.27, 0.035), (0.18, 0.055), (0.0, 0.062), (-0.18, 0.055), (-0.27, 0.035), (-0.285, 0.0),
                 (-0.275, -0.06)]


def on_back(along: float, across: float = 0.0, behind: float = 0.0) -> Vec:
    """A point on the couch: `along` the back from the head plane, `across`, and `behind` the cushion face."""
    return tuple(BACK_PLANE[i] + along * BACK[i] + across * ACROSS[i] + behind * BEHIND[i] for i in range(3))


def shell_width(along: float) -> float:
    """Narrow round the head, full across the shoulders and below."""
    t = min(1.0, max(0.0, (along + 0.3) / 0.25))
    return 1.0 - 0.38 * t * t * (3 - 2 * t)


def build_couch(mats) -> None:
    cabin = collection('cabin')
    rings = [[on_back(a, x * shell_width(a), b) for (x, b) in SHELL_PROFILE] for a in [-0.95 + 0.07 * i for i in range(16)]]
    subsurf(sweep('couch_shell', rings, mats['white'], cabin, closed_profile=True, caps=True), 1)
    back_axes = (ACROSS, BACK, BEHIND)
    pillow('couch_back', on_back(-0.44, 0, 0.012), back_axes, (0.44, 0.62, 0.09), mats['cushion'], cabin)
    for side in (-1, 1):
        pillow(f'couch_bolster_{side}', on_back(-0.46, side * 0.245, -0.012), back_axes, (0.07, 0.52, 0.11), mats['cushion'], cabin, 0.025)
        # Slim: 4 cm proud of the cushion, so that the eye of a turned head stays clear of them
        pillow(f'couch_head_wing_{side}', on_back(0.02, side * 0.145, -0.005), back_axes, (0.05, 0.19, 0.07), mats['cushion'], cabin, 0.02)
    pillow('couch_headrest', on_back(0.02, 0, 0.015), back_axes, (0.24, 0.2, 0.08), mats['cushion'], cabin)
    pan_up = normalise((0.0, 1.0, -0.12))
    pan = (0.0, HIPS[1] + 0.2, HIPS[2] - 0.11)
    pillow('couch_seat', pan, (ACROSS, pan_up, cross(ACROSS, pan_up)), (0.46, 0.46, 0.08), mats['cushion'], cabin)
    mount_top = pan[2] - 0.06
    oriented_box('couch_mount', (0.0, pan[1], (FLOOR + mount_top) / 2), FLAT, (0.16, 0.3, mount_top - FLOOR), mats['graphite'], cabin, 0.02, 4)
    for side in (-1, 1):
        oriented_box(f'couch_rail_{side}', (side * 0.12, 0.3, FLOOR + 0.012), FLAT, (0.035, 1.1, 0.024), mats['dark_metal'], cabin, 0.004)
    build_harness(mats, pan)


def strap(name: str, a: Vec, b: Vec, width: float, mats, coll):
    """A length of webbing lying on the cushion between two points."""
    up = normalise(tuple(b[i] - a[i] for i in range(3)))
    right = normalise(cross(up, FRONT))
    normal = cross(right, up)
    centre = tuple((a[i] + b[i]) / 2 for i in range(3))
    length = math.sqrt(sum((b[i] - a[i]) ** 2 for i in range(3)))
    return oriented_box(name, centre, (right, up, normal), (width, length, 0.004), mats['strap'], coll, 0.0015, 2)


def build_harness(mats, pan: Vec) -> None:
    """Five-point harness, unbuckled at rest on the couch: shoulder straps, lap belts and the crotch strap meet at the buckle."""
    cabin = collection('cabin')
    face = -0.047  # just in front of the cushion face
    buckle = on_back(-0.66, 0.0, face - 0.006)
    for side in (-1, 1):
        strap(f'harness_shoulder_{side}', on_back(-0.02, side * 0.075, face), on_back(-0.64, side * 0.03, face), 0.045, mats, cabin)
        lap_start = (side * 0.22, HIPS[1] + 0.06, HIPS[2] - 0.03)
        strap(f'harness_lap_{side}', lap_start, offset(buckle, ACROSS, side * 0.03), 0.05, mats, cabin)
    strap('harness_crotch', (0.0, pan[1] + 0.12, pan[2] + 0.045), buckle, 0.045, mats, cabin)
    facing = ((-1.0, 0.0, 0.0), BACK, FRONT)
    disc('harness_buckle', buckle, facing, 0.034, mats['metal'], cabin, 32)
    ring('harness_buckle_rim', buckle, facing, 0.036, 0.028, 0.006, mats['dark_metal'], cabin, 32)
    disc('harness_buckle_centre', offset(buckle, FRONT, 0.0065), facing, 0.014, mats['graphite_soft'], cabin, 24)


def build_mannequin(mats) -> None:
    """For scale in the side and outside views; never exported."""
    dummy = collection('dummy')
    uv_sphere('dummy_head', (0.0, -0.085, 0.03), (0.085, 0.1, 0.11), mats['dummy'], dummy)
    shoulders = offset(offset(BACK_PLANE, BACK, -0.22), FRONT, 0.12)
    capsule('dummy_torso', shoulders, HIPS, 0.13, mats['dummy'], dummy)
    for side in (-1, 1):
        knee = (side * 0.11, KNEE_Y, KNEE_Z)
        capsule(f'dummy_thigh_{side}', (side * 0.1, HIPS[1], HIPS[2]), knee, 0.065, mats['dummy'], dummy)
        capsule(f'dummy_shin_{side}', knee, (side * 0.12, FOOT_Y, FOOT_Z), 0.05, mats['dummy'], dummy)
        elbow = (side * 0.3, 0.22, -0.42)
        capsule(f'dummy_arm_{side}', (side * 0.2, shoulders[1], shoulders[2]), elbow, 0.045, mats['dummy'], dummy)
        capsule(f'dummy_forearm_{side}', elbow, (side * 0.5, 0.45, -0.46), 0.04, mats['dummy'], dummy)
