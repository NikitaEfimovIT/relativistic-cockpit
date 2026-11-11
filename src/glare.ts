import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { GLARE_WEIGHT_PER_OCTAVE } from './physics'

// Veiling glare in the eye, for every source on screen. Each level of a blur pyramid doubles σ and keeps the
// image's energy, and Schneegans et al. 2025 (eq. 3–4) show that summing such levels converges to 1/θ²:
// the Stiles–Holladay law. The kernels are the 13-tap downsample and tent upsample of Jimenez 2014.

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0., 1.);
}`

const DOWN_FRAGMENT = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
varying vec2 vUv;
const vec3 LIMIT = vec3(3e4); // a saturated half-float would otherwise turn a whole level into infinity
vec3 at(float x, float y) { return min(texture2D(uSource, vUv + uTexel * vec2(x, y)).rgb, LIMIT); }
void main() {
  vec3 c = at(0., 0.) * .125;
  c += (at(-2., 2.) + at(2., 2.) + at(-2., -2.) + at(2., -2.)) * .03125;
  c += (at(0., 2.) + at(-2., 0.) + at(2., 0.) + at(0., -2.)) * .0625;
  c += (at(-1., 1.) + at(1., 1.) + at(-1., -1.) + at(1., -1.)) * .125;
  gl_FragColor = vec4(c, 1.);
}`

const UP_FRAGMENT = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
vec3 at(float x, float y) { return texture2D(uSource, vUv + uTexel * vec2(x, y)).rgb; }
void main() {
  vec3 c = at(0., 0.) * 4.;
  c += (at(0., 1.) + at(-1., 0.) + at(1., 0.) + at(0., -1.)) * 2.;
  c += at(-1., 1.) + at(1., 1.) + at(-1., -1.) + at(1., -1.);
  gl_FragColor = vec4(c * uWeight / 16., 1.);
}`

const material = (fragmentShader: string, isAdditive: boolean): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  uniforms: { uSource: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
  vertexShader: VERTEX,
  fragmentShader,
  blending: isAdditive ? THREE.CustomBlending : THREE.NoBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})

export const createHdrTarget = (width: number, height: number): THREE.WebGLRenderTarget =>
  new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  })

export interface Glare {
  /** Adds the glare of what `target` holds to `target` itself. */
  apply(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void
  dispose(): void
}

export function createGlare(): Glare {
  const down = material(DOWN_FRAGMENT, false)
  const up = material(UP_FRAGMENT, true)
  const quad = new FullScreenQuad(down)
  let levels: readonly THREE.WebGLRenderTarget[] = []

  const fit = (width: number, height: number): void => {
    if (levels[0]?.width === width >> 1 && levels[0]?.height === height >> 1) return
    levels.forEach((level) => level.dispose())
    const count = Math.max(1, Math.floor(Math.log2(Math.min(width, height))) - 1)
    levels = Array.from({ length: count }, (_, i) =>
      createHdrTarget(Math.max(1, width >> (i + 1)), Math.max(1, height >> (i + 1))))
  }

  const pass = (
    gl: THREE.WebGLRenderer, shader: THREE.ShaderMaterial, source: THREE.WebGLRenderTarget,
    destination: THREE.WebGLRenderTarget, weight: number,
  ): void => {
    shader.uniforms.uSource.value = source.texture
    ;(shader.uniforms.uTexel.value as THREE.Vector2).set(1 / source.width, 1 / source.height)
    shader.uniforms.uWeight.value = weight
    quad.material = shader
    gl.setRenderTarget(destination)
    quad.render(gl)
  }

  return {
    apply(gl, target) {
      fit(target.width, target.height)
      levels.forEach((level, i) => pass(gl, down, i === 0 ? target : levels[i - 1], level, 1))
      for (let i = levels.length - 1; i > 0; i--) pass(gl, up, levels[i], levels[i - 1], 1)
      pass(gl, up, levels[0], target, GLARE_WEIGHT_PER_OCTAVE)
    },
    dispose() {
      levels.forEach((level) => level.dispose())
      down.dispose()
      up.dispose()
      quad.dispose()
    },
  }
}
