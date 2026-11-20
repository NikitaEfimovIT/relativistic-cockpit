import * as THREE from 'three'
import { mulberry32 } from './stars'

// Used surfaces, without UV maps: a tiling sheet of grime and scratches, or of woven cloth, projected along the three
// axes. The geometry here comes from extrusions whose UVs mean little, and every plate gets different wear this way.
// The parts of the cockpit model get theirs by the name of their material: FINISHES. Every amount here is a choice.

const SHEET_SIZE = 1024
const THREAD = 8 // px of the weave sheet to a thread; the sheet holds a whole number of them, so it tiles

type Sheet = 'wear' | 'weave'
type Paint = (ctx: CanvasRenderingContext2D, random: () => number) => void

/** Draws at the wrapped positions too, so that the sheet tiles without a seam. */
function wrapped(ctx: CanvasRenderingContext2D, draw: () => void, x: number, y: number): void {
  for (const dx of [-SHEET_SIZE, 0, SHEET_SIZE]) {
    for (const dy of [-SHEET_SIZE, 0, SHEET_SIZE]) {
      ctx.save()
      ctx.translate(x + dx, y + dy)
      draw()
      ctx.restore()
    }
  }
}

/** Large soft stains: grime that gathered, and places polished by hands. */
function paintStains(ctx: CanvasRenderingContext2D, random: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    const radius = 40 + random() * 170
    const isDark = random() < 0.55
    const shade = isDark ? '40, 40, 40' : '205, 205, 205'
    const strength = 0.05 + random() * 0.14
    wrapped(ctx, () => {
      const stain = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
      stain.addColorStop(0, `rgba(${shade}, ${strength})`)
      stain.addColorStop(1, `rgba(${shade}, 0)`)
      ctx.fillStyle = stain
      ctx.fillRect(-radius, -radius, 2 * radius, 2 * radius)
    }, random() * SHEET_SIZE, random() * SHEET_SIZE)
  }
}

const paintWear: Paint = (ctx, random) => {
  paintStains(ctx, random, 90)

  // Fine speckle: a few thousand dots of pitted paint.
  for (let i = 0; i < 5000; i++) {
    const shade = random() < 0.5 ? 30 : 225
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${0.05 + random() * 0.25})`
    const size = 1 + random() * 1.6
    ctx.fillRect(random() * SHEET_SIZE, random() * SHEET_SIZE, size, size)
  }

  // Scratches: short bright lines, mostly in loose bundles running the same way.
  for (let bundle = 0; bundle < 130; bundle++) {
    const angle = random() * Math.PI
    const [x, y] = [random() * SHEET_SIZE, random() * SHEET_SIZE]
    const count = 1 + Math.floor(random() * 6)
    for (let i = 0; i < count; i++) {
      const length = 12 + random() * 90
      const offset = (random() - 0.5) * 22
      const wobble = (random() - 0.5) * 0.12
      const alpha = 0.05 + random() * 0.2
      const width = 0.7 + random() * 0.7
      wrapped(ctx, () => {
        ctx.rotate(angle + wobble)
        ctx.strokeStyle = `rgba(240, 240, 240, ${alpha})`
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.moveTo(-length / 2, offset)
        ctx.lineTo(length / 2, offset)
        ctx.stroke()
      }, x, y)
    }
  }
}

/** Cloth: threads going over and under, and the soft unevenness of something sat on. Far away it averages to plain. */
const paintWeave: Paint = (ctx, random) => {
  paintStains(ctx, random, 40)
  for (let y = 0; y < SHEET_SIZE; y += THREAD) {
    for (let x = 0; x < SHEET_SIZE; x += THREAD) {
      const isOver = ((x + y) / THREAD) % 2 === 0
      const shade = isOver ? 215 : 45
      ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${0.35 + random() * 0.2})`
      ctx.fillRect(x + 1, y + 1, THREAD - 2, THREAD - 2)
    }
  }
}

const PAINTS: Readonly<Record<Sheet, Paint>> = { wear: paintWear, weave: paintWeave }

function paintSheet(paint: Paint): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SHEET_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable, so the worn materials cannot be drawn')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, SHEET_SIZE, SHEET_SIZE)
  paint(ctx, mulberry32(7))
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

const sheets = new Map<Sheet, THREE.CanvasTexture>()
function sheetOf(kind: Sheet): THREE.CanvasTexture {
  const made = sheets.get(kind) ?? paintSheet(PAINTS[kind])
  sheets.set(kind, made)
  return made
}

type Triple = readonly [number, number, number]

/** Gaps between panels: planes across the part's x, y and z, in metres. A pitch of 0 means no seams across that axis. */
export interface Seams {
  readonly pitch: Triple
  readonly offset: Triple
}

export interface WearOptions {
  readonly sheet?: Sheet
  readonly scale?: number // repeats of the sheet per metre
  readonly tone?: number // how much the wear changes the colour
  readonly rough?: number // how much it changes the roughness
  readonly bump?: number // how deep the scratches read
  readonly rides?: boolean // laid in the part's own axes instead of the world's, so that it stays put on a part that moves
  readonly seams?: Seams
}

const SEAM_HALF_WIDTH = 0.0015 // m: a 3 mm gap
const SEAM_SHADE = 0.7 // the share of the light the gap swallows
const SEAM_ROUGHNESS = 0.9
const AXES = ['x', 'y', 'z'] as const

const glsl = (value: number): string => value.toFixed(5)

/** The seams as GLSL: 1 in a gap, 0 on a panel; nothing at all for a part that has none. */
function seamGlsl(seams: Seams | undefined): string {
  if (!seams) return ''
  const lines = AXES.flatMap((axis, i) => (seams.pitch[i] > 0
    ? [`seam = max(seam, seamLine(p.${axis} - ${glsl(seams.offset[i])}, ${glsl(seams.pitch[i])}, abs(facing.${axis})));`]
    : []))
  return /* glsl */ `
    float seamLine(float along, float pitch, float facing) {
      float away = abs(fract(along / pitch + .5) - .5) * pitch;
      float pixel = max(fwidth(along), 1e-6);
      // a gap thinner than a pixel fades instead of flickering; a face lying in the plane of the seam is not a seam
      float line = clamp((${glsl(SEAM_HALF_WIDTH)} - away) / pixel + .5, 0., 1.) * min(1., ${glsl(2 * SEAM_HALF_WIDTH)} / pixel);
      return line * (1. - smoothstep(.7, .95, facing));
    }
    float seamOf(vec3 p, vec3 facing) {
      float seam = 0.;
      ${lines.join('\n      ')}
      return seam;
    }`
}

/** Gives a material the wear of a sheet: its colour, gloss and surface vary with it. Pass a material of your own: it is changed. */
export function withWear<M extends THREE.MeshStandardMaterial>(material: M, options: WearOptions = {}): M {
  const { sheet = 'wear', scale = 1.1, tone = 0.8, rough = 0.5, bump = 0.0009, rides = false, seams } = options
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWear = { value: sheetOf(sheet) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWearPosition, vWearNormal;`)
      .replace('#include <begin_vertex>', rides
        ? `#include <begin_vertex>
        vWearPosition = transformed;
        vWearNormal = objectNormal;`
        : `#include <begin_vertex>
        vWearPosition = (modelMatrix * vec4(transformed, 1.)).xyz;
        vWearNormal = normalize(mat3(modelMatrix) * objectNormal);`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uWear;
        varying vec3 vWearPosition, vWearNormal;
        float wearOf(vec3 position, vec3 facing) {
          vec3 weight = pow(abs(facing), vec3(6.));
          weight /= weight.x + weight.y + weight.z;
          vec3 p = position * ${scale.toFixed(3)};
          return weight.x * texture2D(uWear, p.yz).r + weight.y * texture2D(uWear, p.zx + .37).r + weight.z * texture2D(uWear, p.xy + .71).r;
        }${seamGlsl(seams)}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wear = wearOf(vWearPosition, normalize(vWearNormal));
        diffuseColor.rgb *= 1. + (wear - .5) * ${tone.toFixed(3)};
        ${seams ? `float seam = seamOf(vWearPosition, normalize(vWearNormal));
        diffuseColor.rgb *= 1. - ${glsl(SEAM_SHADE)} * seam;` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - (wear - .5) * ${rough.toFixed(3)}, .06, 1.);
        ${seams ? `roughnessFactor = mix(roughnessFactor, ${glsl(SEAM_ROUGHNESS)}, seam);` : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 sigmaX = dFdx(-vViewPosition), sigmaY = dFdy(-vViewPosition);
          vec3 r1 = cross(sigmaY, normal), r2 = cross(normal, sigmaX);
          float determinant = dot(sigmaX, r1);
          vec3 gradient = sign(determinant) * (dFdx(wear) * r1 + dFdy(wear) * r2);
          normal = normalize(abs(determinant) * normal - ${bump.toFixed(5)} * gradient);
        }`)
  }
  material.customProgramCacheKey = () => `wear:${JSON.stringify({ sheet, scale, tone, rough, bump, rides, seams })}`
  return material
}

/** A standard material whose colour, gloss and surface vary with the wear sheet. */
export function wornMaterial(parameters: THREE.MeshStandardMaterialParameters, options: WearOptions = {}): THREE.MeshStandardMaterial {
  return withWear(new THREE.MeshStandardMaterial(parameters), options)
}

export const HULL = wornMaterial({ color: '#23272e', roughness: 0.62, metalness: 0.55 })
export const TRIM = wornMaterial({ color: '#5a626c', roughness: 0.32, metalness: 0.92 }, { scale: 2.3, tone: 0.5, rough: 0.35 })
export const PANEL = wornMaterial({ color: '#272b32', roughness: 0.55, metalness: 0.6 }, { scale: 1.7, tone: 0.6, rough: 0.4 })
export const DECK = wornMaterial({ color: '#1b1e23', roughness: 0.5, metalness: 0.75 }, { scale: 0.9, tone: 1, rough: 0.6 })
export const SEAT = wornMaterial({ color: '#1a1412', roughness: 0.74, metalness: 0.05 }, { scale: 3.1, tone: 0.5, rough: 0.3, bump: 0.0008 })

// The cockpit model (blender/cockpit_lib/materials.py) carries plain colours. Each of its materials gets a finish here by
// name, or null to stay as modelled: what glows, what is glass, and what the app repaints every frame.
const COMPOSITE: WearOptions = { scale: 0.9, tone: 0.1, rough: 0.22, bump: 0.0002, rides: true } // paint under a clear coat: its gloss varies, its colour hardly
const CLOTH: WearOptions = { sheet: 'weave', scale: 6, tone: 0.5, rough: 0.25, bump: 0.0006, rides: true }

export const FINISHES: Readonly<Record<string, WearOptions | null>> = {
  white_composite: COMPOSITE,
  white_trim: { scale: 1.7, tone: 0.12, rough: 0.25, bump: 0.0003, rides: true },
  graphite: { scale: 1.3, tone: 0.5, rough: 0.4, bump: 0.0005, rides: true },
  graphite_soft: { scale: 2.1, tone: 0.4, rough: 0.3, bump: 0.0004, rides: true },
  satin_metal: { scale: 2.3, tone: 0.5, rough: 0.35, rides: true },
  dark_metal: { scale: 1.9, tone: 0.5, rough: 0.35, rides: true },
  cushion: CLOTH,
  harness_webbing: { ...CLOTH, scale: 9 },
  hatch_seal: null, // smooth rubber and fresh paint
  lever_grip: null,
  stencil_paint: null,
  hull_red: null,
  canopy_glass: null,
  guard_red_glass: null,
  screen_glass: null,
  light_line: null, // the app sets its glow every frame
  legend_backlit: null,
  lamp_off: null,
  lamp_amber: null,
  lamp_green: null,
  lamp_cyan: null,
  lamp_red: null,
  lamp_red_dim: null,
  ui_amber: null,
  ui_green: null,
  ui_cyan: null,
  ui_dim: null,
}

// The inner shell is built of panels 0.9 m long, counted from the cockpit door: a seam falls on the door and on the first
// frame aft of it, 3.6 m on; the next bay is 4.0 m long, so its far frame lies between two seams. The deck is of plates
// 0.6 m wide, laid about the centreline.
// ponytail: the seams are dark lines drawn in the shader on planes across the part, not gaps in the geometry; if they
// ever have to catch the light at their edges, model them in Blender.
const WALL_SEAMS: Seams = { pitch: [0, 0, 0.9], offset: [0, 0, 1.35] }
const DECK_SEAMS: Seams = { pitch: [0.6, 0, 0.9], offset: [0.3, 0, 1.35] }
const QUILT: Seams = { pitch: [0.18, 0, 0.18], offset: [0, 0, 0] } // ponytail: stitching is the same dark line as a gap; the cloth does not pucker
const WALLS = /^(vault_|wall_|end_wall)/
const DECKS = /^(floor|quarters_walkway)$/
const QUILTED = /^(bed_mattress|couch_seat|couch_back|chair_seat|chair_back)$/

/** The finish of a part of the cockpit model, by the names of its material and of the part; null leaves it as modelled. */
export function finishOf(material: string, part: string): WearOptions | null {
  const finish = Object.hasOwn(FINISHES, material) ? FINISHES[material] : null
  if (!finish) return null
  const seams = DECKS.test(part) ? DECK_SEAMS : WALLS.test(part) ? WALL_SEAMS : QUILTED.test(part) ? QUILT : null
  return seams ? { ...finish, seams } : finish
}
