import * as THREE from 'three'
import { mulberry32 } from './stars'

// Used metal, without UV maps: a tiling sheet of grime and scratches, projected along the three axes in world space.
// The geometry here comes from extrusions whose UVs mean little, and every plate gets different wear this way.

const SHEET_SIZE = 1024

function paintWearSheet(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SHEET_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable, so the worn materials cannot be drawn')
  const random = mulberry32(7)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, SHEET_SIZE, SHEET_SIZE)

  // Everything is drawn at its wrapped positions too, so that the sheet tiles without a seam.
  const wrapped = (draw: () => void, x: number, y: number): void => {
    for (const dx of [-SHEET_SIZE, 0, SHEET_SIZE]) {
      for (const dy of [-SHEET_SIZE, 0, SHEET_SIZE]) {
        ctx.save()
        ctx.translate(x + dx, y + dy)
        draw()
        ctx.restore()
      }
    }
  }

  // Large soft stains: grime that gathered, and places polished by hands.
  for (let i = 0; i < 90; i++) {
    const radius = 40 + random() * 170
    const isDark = random() < 0.55
    const shade = isDark ? '40, 40, 40' : '205, 205, 205'
    const strength = 0.05 + random() * 0.14
    wrapped(() => {
      const stain = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
      stain.addColorStop(0, `rgba(${shade}, ${strength})`)
      stain.addColorStop(1, `rgba(${shade}, 0)`)
      ctx.fillStyle = stain
      ctx.fillRect(-radius, -radius, 2 * radius, 2 * radius)
    }, random() * SHEET_SIZE, random() * SHEET_SIZE)
  }

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
      wrapped(() => {
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

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

let sheet: THREE.CanvasTexture | null = null
const wearSheet = (): THREE.CanvasTexture => {
  sheet ??= paintWearSheet()
  return sheet
}

export interface WearOptions {
  readonly scale?: number // repeats of the sheet per metre
  readonly tone?: number // how much the wear changes the colour
  readonly rough?: number // how much it changes the roughness
  readonly bump?: number // how deep the scratches read
}

/** A standard material whose colour, gloss and surface vary with the wear sheet. */
export function wornMaterial(parameters: THREE.MeshStandardMaterialParameters, options: WearOptions = {}): THREE.MeshStandardMaterial {
  const { scale = 1.1, tone = 0.8, rough = 0.5, bump = 0.0009 } = options
  const material = new THREE.MeshStandardMaterial(parameters)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWear = { value: wearSheet() }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWearPosition, vWearNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWearPosition = (modelMatrix * vec4(transformed, 1.)).xyz;
        vWearNormal = normalize(mat3(modelMatrix) * objectNormal);`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uWear;
        varying vec3 vWearPosition, vWearNormal;
        float wearOf(vec3 position, vec3 normalWorld) {
          vec3 weight = pow(abs(normalWorld), vec3(6.));
          weight /= weight.x + weight.y + weight.z;
          vec3 p = position * ${scale.toFixed(3)};
          return weight.x * texture2D(uWear, p.yz).r + weight.y * texture2D(uWear, p.zx + .37).r + weight.z * texture2D(uWear, p.xy + .71).r;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wear = wearOf(vWearPosition, normalize(vWearNormal));
        diffuseColor.rgb *= 1. + (wear - .5) * ${tone.toFixed(3)};`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - (wear - .5) * ${rough.toFixed(3)}, .06, 1.);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 sigmaX = dFdx(-vViewPosition), sigmaY = dFdy(-vViewPosition);
          vec3 r1 = cross(sigmaY, normal), r2 = cross(normal, sigmaX);
          float determinant = dot(sigmaX, r1);
          vec3 gradient = sign(determinant) * (dFdx(wear) * r1 + dFdy(wear) * r2);
          normal = normalize(abs(determinant) * normal - ${bump.toFixed(5)} * gradient);
        }`)
  }
  material.customProgramCacheKey = () => `wear:${scale}:${tone}:${rough}:${bump}`
  return material
}

export const HULL = wornMaterial({ color: '#23272e', roughness: 0.62, metalness: 0.55 })
export const TRIM = wornMaterial({ color: '#5a626c', roughness: 0.32, metalness: 0.92 }, { scale: 2.3, tone: 0.5, rough: 0.35 })
export const PANEL = wornMaterial({ color: '#272b32', roughness: 0.55, metalness: 0.6 }, { scale: 1.7, tone: 0.6, rough: 0.4 })
export const DECK = wornMaterial({ color: '#1b1e23', roughness: 0.5, metalness: 0.75 }, { scale: 0.9, tone: 1, rough: 0.6 })
export const SEAT = wornMaterial({ color: '#1a1412', roughness: 0.74, metalness: 0.05 }, { scale: 3.1, tone: 0.5, rough: 0.3, bump: 0.0008 })
