"""Materials. Those the app will load are constant Principled values, which glTF carries; the procedural ones are for
the renders only and sit on render-only objects."""

import bpy

Rgb = tuple[float, float, float]


def principled(name: str, color: Rgb, roughness: float = 0.5, metallic: float = 0.0, emission: Rgb | None = None, strength: float = 0.0,
               transmission: float = 0.0, thin: bool = False, sheen: float = 0.0, coat: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Transmission Weight'].default_value = transmission
    bsdf.inputs['Thin Wall'].default_value = thin  # one surface, not a solid lens
    bsdf.inputs['Sheen Weight'].default_value = sheen
    bsdf.inputs['Coat Weight'].default_value = coat
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    return mat


def set_emission(mat, strength: float) -> None:
    mat.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = strength


def starfield(name: str, density: float = 22.0, strength: float = 8.0):
    """Render only: points of light, for the rear camera's screen. Cells of a few centimetres, so that a star covers a
    few pixels at arm's length and the denoiser keeps it."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    coords = nodes.new('ShaderNodeTexCoord')
    voronoi = nodes.new('ShaderNodeTexVoronoi')
    voronoi.inputs['Scale'].default_value = density
    ramp = nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Max'].default_value = 0.09
    ramp.inputs['To Min'].default_value = 1.0
    ramp.inputs['To Max'].default_value = 0.0
    sharpen = nodes.new('ShaderNodeMath')
    sharpen.operation = 'POWER'
    sharpen.inputs[1].default_value = 5.0
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = (0.8, 0.85, 1.0, 1)
    gain = nodes.new('ShaderNodeMath')
    gain.operation = 'MULTIPLY'
    gain.inputs[1].default_value = strength
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(coords.outputs['Object'], voronoi.inputs['Vector'])
    links.new(voronoi.outputs['Distance'], ramp.inputs['Value'])
    links.new(ramp.outputs['Result'], sharpen.inputs[0])
    links.new(sharpen.outputs['Value'], gain.inputs[0])
    links.new(gain.outputs['Value'], emission.inputs['Strength'])
    links.new(emission.outputs['Emission'], output.inputs['Surface'])
    return mat


AMBER: Rgb = (1.0, 0.55, 0.15)
GREEN: Rgb = (0.35, 1.0, 0.55)
CYAN: Rgb = (0.3, 0.75, 1.0)
RED: Rgb = (1.0, 0.12, 0.06)


def make_materials() -> dict:
    black = (0.0, 0.0, 0.0)
    return {
        # Shell and furniture
        'white': principled('white_composite', (0.80, 0.80, 0.78), roughness=0.38, coat=0.15),
        'white_trim': principled('white_trim', (0.62, 0.63, 0.63), roughness=0.45),
        'graphite': principled('graphite', (0.028, 0.03, 0.033), roughness=0.62),
        'graphite_soft': principled('graphite_soft', (0.045, 0.047, 0.05), roughness=0.45),
        'metal': principled('satin_metal', (0.62, 0.64, 0.67), roughness=0.3, metallic=1.0),
        'dark_metal': principled('dark_metal', (0.18, 0.19, 0.2), roughness=0.35, metallic=1.0),
        'cushion': principled('cushion', (0.05, 0.052, 0.058), roughness=0.85, sheen=0.4),
        'strap': principled('harness_webbing', (0.06, 0.065, 0.075), roughness=0.75, sheen=0.3),
        'seal': principled('hatch_seal', (0.012, 0.012, 0.013), roughness=0.8),
        'grip': principled('lever_grip', (0.82, 0.33, 0.11), roughness=0.42),
        'glass': principled('canopy_glass', (0.85, 0.9, 0.95), roughness=0.02, transmission=1.0, thin=True),
        'guard': principled('guard_red_glass', (0.8, 0.08, 0.05), roughness=0.15, transmission=0.7, thin=True),
        'screen_glass': principled('screen_glass', (0.004, 0.005, 0.006), roughness=0.08),
        # Lamps, lit or not
        'lamp_off': principled('lamp_off', (0.035, 0.035, 0.032), roughness=0.25),
        'amber': principled('lamp_amber', black, emission=AMBER, strength=3.0),
        'green': principled('lamp_green', black, emission=GREEN, strength=2.5),
        'cyan': principled('lamp_cyan', black, emission=CYAN, strength=2.5),
        'red': principled('lamp_red', black, emission=RED, strength=3.0),
        'red_dim': principled('lamp_red_dim', (0.25, 0.02, 0.015), roughness=0.3, emission=RED, strength=0.25),
        'strip': principled('light_line', black, emission=(0.75, 0.9, 1.0), strength=0.0),
        # Render only: legends, the pictures on the screens, the exterior, the mannequin
        'legend': principled('legend_backlit', (0.75, 0.76, 0.74), roughness=0.5, emission=(0.95, 0.92, 0.85), strength=0.35),
        'paint': principled('stencil_paint', (0.03, 0.032, 0.035), roughness=0.5),
        'ui_amber': principled('ui_amber', black, emission=AMBER, strength=3.5),
        'ui_green': principled('ui_green', black, emission=GREEN, strength=3.0),
        'ui_cyan': principled('ui_cyan', black, emission=CYAN, strength=3.0),
        'ui_red': principled('ui_red', black, emission=RED, strength=3.0),
        'ui_dim': principled('ui_dim', black, emission=(0.62, 0.72, 0.76), strength=1.4),
        'stars': starfield('rear_camera_stars'),
        'tinted': principled('canopy_tinted', (0.05, 0.06, 0.07), roughness=0.03, transmission=1.0, thin=True),
        'dummy': principled('mannequin', (0.25, 0.27, 0.3), roughness=0.7),
    }
