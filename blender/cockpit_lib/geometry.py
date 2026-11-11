"""Plain-mesh building blocks. Nothing here depends on operator context, so all of it runs in background mode."""

import math

import bpy
from mathutils import Matrix, Vector

Vec = tuple[float, float, float]
Axes = tuple[Vec, Vec, Vec]  # right, up, normal
Point2 = tuple[float, float]

FLAT: Axes = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

# ---------------------------------------------------------------------------------------------------------------------
# Vectors and frames


def cross(p: Vec, q: Vec) -> Vec:
    return (p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0])


def normalise(p: Vec) -> Vec:
    length = math.sqrt(sum(c * c for c in p))
    return tuple(c / length for c in p)


def offset(point: Vec, vector: Vec, amount: float) -> Vec:
    return tuple(point[i] + amount * vector[i] for i in range(3))


def frame_point(origin: Vec, axes: Axes, u: float, v: float, w: float = 0.0) -> Vec:
    """origin + u·right + v·up + w·normal."""
    right, up, normal = axes
    return tuple(origin[i] + u * right[i] + v * up[i] + w * normal[i] for i in range(3))


def rotate_z(vector: Vec, angle: float) -> Vec:
    c, s = math.cos(angle), math.sin(angle)
    return (c * vector[0] - s * vector[1], s * vector[0] + c * vector[1], vector[2])


def tilted_axes(tilt: float, yaw: float = 0.0) -> Axes:
    """A surface facing the pilot (−Y), leaning back by `tilt`, turned by `yaw` about Z."""
    right = rotate_z((1.0, 0.0, 0.0), yaw)
    up = rotate_z((0.0, math.sin(tilt), math.cos(tilt)), yaw)
    normal = rotate_z((0.0, -math.cos(tilt), math.sin(tilt)), yaw)
    return right, up, normal


def facing_eye(point: Vec) -> Axes:
    """A surface at `point` turned square to the pilot's eye at the origin."""
    to_eye = normalise(tuple(-c for c in point))
    return tilted_axes(math.asin(to_eye[2]), math.atan2(to_eye[0], -to_eye[1]))


def axes_matrix(origin: Vec, axes: Axes) -> Matrix:
    right, up, normal = axes
    matrix = Matrix((right, up, normal)).transposed().to_4x4()
    matrix.translation = Vector(origin)
    return matrix


def frange(start: float, stop: float, step: float) -> list[float]:
    count = int(round((stop - start) / step))
    return [start + step * i for i in range(count + 1)]


def superellipse(width: float, height: float, z0: float, exponent: float, t0: float, t1: float, count: int) -> list[Point2]:
    """Points of |x/w|^n + |(z−z0)/h|^n = 1 from angle t0 to t1."""
    points = []
    for i in range(count):
        t = t0 + (t1 - t0) * i / (count - 1)
        c, s = math.cos(t), math.sin(t)
        points.append((width * math.copysign(abs(c) ** (2 / exponent), c), z0 + height * math.copysign(abs(s) ** (2 / exponent), s)))
    return points


# ---------------------------------------------------------------------------------------------------------------------
# Objects


def collection(name: str) -> bpy.types.Collection:
    found = bpy.data.collections.get(name)
    if found:
        return found
    made = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(made)
    return made


def mesh_object(name: str, verts: list[Vec], faces: list[tuple[int, ...]], mat, coll, smooth: bool = False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    if mesh.validate() and len(mesh.polygons) != len(faces):
        print('VALIDATE dropped faces in', name, len(faces), '->', len(mesh.polygons))
    if smooth:
        for polygon in mesh.polygons:
            polygon.use_smooth = True
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    return obj


def bevel(obj, width: float, segments: int = 3):
    modifier = obj.modifiers.new('bevel', 'BEVEL')
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = 'ANGLE'
    modifier.use_clamp_overlap = True
    return obj


def subsurf(obj, levels: int = 1):
    modifier = obj.modifiers.new('subsurf', 'SUBSURF')
    modifier.levels = levels
    modifier.render_levels = levels
    return obj


def smooth_all(obj):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def mount(name: str, origin: Vec, axes: Axes, coll):
    """An empty whose frame is where a control sits; the app hangs its working control on it by name."""
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_size = 0.02
    empty.matrix_world = axes_matrix(origin, axes)
    coll.objects.link(empty)
    return empty


def attach(parent, *children):
    for child in children:
        child.parent = parent
        child.matrix_parent_inverse = parent.matrix_world.inverted()
    return parent


# ---------------------------------------------------------------------------------------------------------------------
# Shapes


def oriented_box(name: str, origin: Vec, axes: Axes, size: Vec, mat, coll, rounding: float = 0.008, segments: int = 3):
    """A box of size (width, height, depth) centred at origin, along the right/up/normal axes."""
    hx, hy, hz = (s / 2 for s in size)
    corners = [frame_point(origin, axes, sx * hx, sy * hy, sz * hz) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    obj = mesh_object(name, corners, faces, mat, coll)
    return bevel(obj, rounding, segments) if rounding else obj


def pillow(name: str, origin: Vec, axes: Axes, size: Vec, mat, coll, rounding: float = 0.03):
    """A padded block: rounded hard, then softened."""
    return subsurf(smooth_all(oriented_box(name, origin, axes, size, mat, coll, rounding, 5)), 1)


def picture_frame(name: str, origin: Vec, axes: Axes, width: float, height: float, border: float, depth: float, mat, coll):
    """A rectangular bezel standing `depth` proud of the surface, `border` wide."""
    def rect(half_w, half_h, w):
        return [frame_point(origin, axes, sx * half_w, sy * half_h, w) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    outer_back, outer_front = rect(width / 2, height / 2, 0.0), rect(width / 2, height / 2, depth)
    inner_front, inner_back = rect(width / 2 - border, height / 2 - border, depth), rect(width / 2 - border, height / 2 - border, 0.0)
    verts = outer_back + outer_front + inner_front + inner_back
    faces = []
    for i in range(4):
        j = (i + 1) % 4
        faces += [(4 + i, 4 + j, 8 + j, 8 + i), (i, j, 4 + j, 4 + i), (8 + i, 8 + j, 12 + j, 12 + i)]
    return bevel(mesh_object(name, verts, faces, mat, coll), min(border, depth) * 0.3, 2)


def disc(name: str, origin: Vec, axes: Axes, radius: float, mat, coll, segments: int = 32):
    verts = [origin] + [frame_point(origin, axes, radius * math.cos(a), radius * math.sin(a))
                        for a in (2 * math.pi * i / segments for i in range(segments))]
    faces = [(0, 1 + i, 1 + (i + 1) % segments) for i in range(segments)]
    return mesh_object(name, verts, faces, mat, coll)


def ring(name: str, origin: Vec, axes: Axes, outer: float, inner: float, depth: float, mat, coll, segments: int = 48):
    """A flat annulus standing `depth` proud of the surface."""
    angles = [2 * math.pi * i / segments for i in range(segments)]
    layers = [(outer, 0.0), (outer, depth), (inner, depth), (inner, 0.0)]
    verts = [frame_point(origin, axes, r * math.cos(a), r * math.sin(a), w) for (r, w) in layers for a in angles]
    faces = []
    for layer in range(3):
        a, b = layer * segments, (layer + 1) * segments
        faces += [(a + i, a + (i + 1) % segments, b + (i + 1) % segments, b + i) for i in range(segments)]
    return mesh_object(name, verts, faces, mat, coll, smooth=True)


def cylinder(name: str, origin: Vec, axes: Axes, radius: float, height: float, mat, coll, segments: int = 24):
    """Standing on the surface at origin, `height` along the normal; six segments make a nut."""
    angles = [2 * math.pi * i / segments + math.pi / segments for i in range(segments)]
    verts = [frame_point(origin, axes, radius * math.cos(a), radius * math.sin(a), w) for w in (0.0, height) for a in angles]
    faces = [(i, (i + 1) % segments, segments + (i + 1) % segments, segments + i) for i in range(segments)]
    faces += [tuple(range(segments - 1, -1, -1)), tuple(range(segments, 2 * segments))]
    obj = mesh_object(name, verts, faces, mat, coll)
    return bevel(obj, min(radius, height) * 0.15, 2)


def uv_sphere(name: str, centre: Vec, radii: Vec, mat, coll, rings: int = 16, segments: int = 24):
    rx, ry, rz = radii
    verts = [(centre[0], centre[1], centre[2] + rz)]
    for r in range(1, rings):
        theta = math.pi * r / rings
        for s in range(segments):
            phi = 2 * math.pi * s / segments
            verts.append((centre[0] + rx * math.sin(theta) * math.cos(phi), centre[1] + ry * math.sin(theta) * math.sin(phi),
                          centre[2] + rz * math.cos(theta)))
    verts.append((centre[0], centre[1], centre[2] - rz))
    faces = [(0, 1 + s, 1 + (s + 1) % segments) for s in range(segments)]
    for r in range(rings - 2):
        a, b = 1 + r * segments, 1 + (r + 1) * segments
        faces += [(a + s, b + s, b + (s + 1) % segments, a + (s + 1) % segments) for s in range(segments)]
    last = len(verts) - 1
    base = 1 + (rings - 2) * segments
    faces += [(base + s, last, base + (s + 1) % segments) for s in range(segments)]
    return mesh_object(name, verts, faces, mat, coll, smooth=True)


def capsule(name: str, a: Vec, b: Vec, radius: float, mat, coll, segments: int = 20, caps: int = 5):
    """A tube with round ends, as one mesh."""
    w = normalise(tuple(b[i] - a[i] for i in range(3)))
    u = normalise(cross(w, (1.0, 0.0, 0.0) if abs(w[0]) < 0.9 else (0.0, 1.0, 0.0)))
    v = cross(w, u)
    latitudes = [(-math.pi / 2 + math.pi / 2 * k / caps, a) for k in range(1, caps + 1)]
    latitudes += [(math.pi / 2 * k / caps, b) for k in range(0, caps)]
    rings = []
    for phi, end in latitudes:
        centre = offset(end, w, radius * math.sin(phi))
        r = radius * math.cos(phi)
        rings.append([tuple(centre[i] + r * (math.cos(t) * u[i] + math.sin(t) * v[i]) for i in range(3))
                      for t in (2 * math.pi * s / segments for s in range(segments))])
    return sweep(name, rings, mat, coll, closed_profile=True, caps=True)


def sweep(name: str, rings: list[list[Vec]], mat, coll, closed_profile: bool = False, caps: bool = False):
    """Rings of points joined by quads, in order; a closed profile wraps round, and caps close the ends."""
    count = len(rings[0])
    verts = [p for ring_points in rings for p in ring_points]
    faces = []
    span = count if closed_profile else count - 1
    for r in range(len(rings) - 1):
        a, b = r * count, (r + 1) * count
        faces += [(a + i, a + (i + 1) % count, b + (i + 1) % count, b + i) for i in range(span)]
    if caps and closed_profile:
        last = (len(rings) - 1) * count
        faces += [tuple(range(count - 1, -1, -1)), tuple(range(last, last + count))]
    return mesh_object(name, verts, faces, mat, coll, smooth=True)


def loft(name: str, stations: list[float], section, mat, coll):
    """Rings of `section(y)` points (x, z) at every station along Y, joined by quads."""
    return sweep(name, [[(x, y, z) for (x, z) in section(y)] for y in stations], mat, coll)


# ---------------------------------------------------------------------------------------------------------------------
# Text, for legends and for the screens in the renders (the app draws its own)

_FONTS: dict[str, object] = {}
LEGEND_FONT = '/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf'
SCREEN_FONT = '/System/Library/Fonts/Menlo.ttc'


def label(name: str, text: str, origin: Vec, axes: Axes, size: float, mat, coll, font: str = LEGEND_FONT, align: str = 'CENTER'):
    if font not in _FONTS:
        _FONTS[font] = bpy.data.fonts.load(font, check_existing=True)
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = text
    curve.font = _FONTS[font]
    curve.size = size
    curve.align_x = align
    curve.align_y = 'CENTER'
    curve.materials.append(mat)
    obj = bpy.data.objects.new(name, curve)
    obj.matrix_world = axes_matrix(offset(origin, axes[2], 0.0006), axes)
    coll.objects.link(obj)
    return obj
