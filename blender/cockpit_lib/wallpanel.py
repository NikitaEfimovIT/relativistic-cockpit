"""The closed door to the technical bay in the end wall. The life-support controls are on the console in console.py."""

from .geometry import LEGEND_FONT, collection, cylinder, frame_point, label, oriented_box, picture_frame
from .quarters import FACING_FORWARD as DOOR_AXES
from .shape import QUARTERS_AFT, QUARTERS_FLOOR

DOOR = (0.8, 1.95)  # m wide, high


def build_door(mats) -> None:
    """Shut for now: what is behind it is a later stage. Its name is painted on it at eye height, as a mesh the app shows too."""
    cabin = collection('cabin')
    width, height = DOOR
    middle = (0.0, QUARTERS_AFT, QUARTERS_FLOOR + height / 2)
    picture_frame('door_tech_frame', middle, DOOR_AXES, width + 0.12, height + 0.06, 0.06, 0.03, mats['white_trim'], cabin)
    oriented_box('door_tech', frame_point(middle, DOOR_AXES, 0, -0.03, 0.008), DOOR_AXES, (width, height, 0.016), mats['white'], cabin, 0.006)
    oriented_box('door_tech_band', frame_point(middle, DOOR_AXES, 0, 0.1, 0.017), DOOR_AXES, (width, 0.1, 0.004), mats['graphite_soft'], cabin, 0.002)
    oriented_box('door_tech_handle', frame_point(middle, DOOR_AXES, -width / 2 + 0.08, -0.05, 0.03), DOOR_AXES, (0.03, 0.24, 0.03), mats['dark_metal'], cabin)
    cylinder('door_tech_lock', frame_point(middle, DOOR_AXES, -width / 2 + 0.08, 0.14, 0.018), DOOR_AXES, 0.012, 0.004, mats['red'], cabin, 16)
    label('door_tech_name', 'ТЕХ. СИСТЕМЫ', frame_point(middle, DOOR_AXES, 0, 0.5, 0.017), DOOR_AXES, 0.06, mats['paint'], cabin, LEGEND_FONT)
