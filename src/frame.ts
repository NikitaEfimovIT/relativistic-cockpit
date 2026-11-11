import * as THREE from 'three'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { createGlare, createHdrTarget } from './glare'
import { createDisplayMaterial, type Sky, type SkyView } from './sky'

// One HDR frame for the sky and the cabin, so that both pass through the same eye:
//   sky (Galaxy + stars) → cabin over it, antialiased → contact shadows → glare from everything → CMB → tone curve.
// The CMB is added after the glare because its veil is computed analytically: its disc can lie outside the view.

/** Objects on this layer are drawn but do not occlude: the sky behind everything, and the panes of glass. */
export const BACKGROUND_LAYER = 1

const AO_SCALE = 2 // contact shadows are soft, so half resolution is enough
const SLOW_FRAME = 1 / 40 // s
const SLOW_PATIENCE = 2 // s; the shadows are the first thing to go on a GPU that cannot keep up

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0., 1.);
}`

const BACKGROUND_FRAGMENT = /* glsl */ `
uniform sampler2D uSky;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(uSky, vUv).rgb, 0.); } // alpha 0: nothing in front of the sky here`

const COMPOSE_FRAGMENT = /* glsl */ `
uniform sampler2D uScene, uOcclusion;
uniform float uHasOcclusion;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uScene, vUv);
  float occlusion = mix(1., texture2D(uOcclusion, vUv).r, uHasOcclusion * min(c.a, 1.));
  gl_FragColor = vec4(c.rgb * occlusion, 1.);
}`

export interface Frame {
  /** The material of the fullscreen mesh that puts the sky behind the cabin. */
  readonly background: THREE.ShaderMaterial
  setSize(width: number, height: number): void
  render(gl: THREE.WebGLRenderer, sky: Sky, view: SkyView, dt: number): void
  dispose(): void
}

export function createFrame(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Frame {
  camera.layers.enable(BACKGROUND_LAYER)
  const skyTarget = createHdrTarget(1, 1)
  const cabinTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    samples: window.devicePixelRatio >= 2 ? 2 : 4, // a dense display needs less antialiasing
    depthBuffer: true,
    stencilBuffer: true, // each pane of glass only shows its own reflection
  })
  const composedTarget = createHdrTarget(1, 1)
  const glare = createGlare()

  const occlusion = new GTAOPass(scene, camera, 1, 1)
  occlusion.output = GTAOPass.OUTPUT.Off
  occlusion.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.4, thickness: 0.6, scale: 1.5, samples: 12, distanceFallOff: 1, screenSpaceRadius: false })
  occlusion.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 12 })

  const background = new THREE.ShaderMaterial({
    uniforms: { uSky: { value: skyTarget.texture } },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: BACKGROUND_FRAGMENT,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const compose = new THREE.ShaderMaterial({
    uniforms: {
      uScene: { value: cabinTarget.texture },
      uOcclusion: { value: occlusion.pdRenderTarget.texture },
      uHasOcclusion: { value: 1 },
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: COMPOSE_FRAGMENT,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const display = createDisplayMaterial(composedTarget.texture)
  const quad = new FullScreenQuad(compose)

  let hasOcclusion = true
  let slowFor = 0

  return {
    background,
    setSize(width, height) {
      skyTarget.setSize(width, height)
      cabinTarget.setSize(width, height)
      composedTarget.setSize(width, height)
      occlusion.setSize(Math.max(1, Math.round(width / AO_SCALE)), Math.max(1, Math.round(height / AO_SCALE)))
    },
    render(gl, sky, view, dt) {
      slowFor = dt > SLOW_FRAME ? slowFor + dt : 0
      if (slowFor > SLOW_PATIENCE) hasOcclusion = false

      const autoClear = gl.autoClear
      gl.autoClear = false
      gl.setClearColor(0x000000, 0)

      sky.renderStars(gl, camera, skyTarget, view)

      gl.setRenderTarget(cabinTarget)
      gl.clear()
      gl.render(scene, camera)

      if (hasOcclusion) {
        camera.layers.disable(BACKGROUND_LAYER)
        occlusion.render(gl, composedTarget, composedTarget, dt, false) // with OUTPUT.Off it only fills its own targets
        camera.layers.enable(BACKGROUND_LAYER)
      }
      compose.uniforms.uHasOcclusion.value = hasOcclusion ? 1 : 0

      quad.material = compose
      gl.setRenderTarget(composedTarget)
      quad.render(gl)

      glare.apply(gl, composedTarget)
      sky.addCmb(gl, camera, composedTarget, view, cabinTarget.texture)

      quad.material = display
      gl.setRenderTarget(null)
      quad.render(gl)

      gl.autoClear = autoClear
    },
    dispose() {
      skyTarget.dispose()
      cabinTarget.dispose()
      composedTarget.dispose()
      glare.dispose()
      occlusion.dispose()
      background.dispose()
      compose.dispose()
      display.dispose()
      quad.dispose()
    },
  }
}
