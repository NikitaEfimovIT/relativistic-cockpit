import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { RESOLVED_RADIUS_KPC, SUN, galactocentric, sightline, type Vec3 } from '../src/galaxy'

/** Probe places lie along one line from the Sun: inward and a little above the disc. The cube is in galactic axes. */
const along = (distanceLy: number): Vec3 => galactocentric([0.97 * distanceLy, 0, 0.24 * distanceLy])
import { loadDustMap } from '../src/dustMap'
import { createGalaxyBake, type GalaxyBake } from '../src/galaxyBake'
import { createGlare, createHdrTarget } from '../src/glare'
import { STILES_HOLLADAY } from '../src/physics'

// Runs the real shaders on the real GPU and reads the numbers back, because the formulas they carry cannot be
// reached from a unit test. Served by the dev server for e2e/shaders.spec.ts only; not part of the build.

const gl = new THREE.WebGLRenderer()
gl.autoClear = false

const read = (target: THREE.WebGLRenderTarget, x: number, y: number): number[] => {
  const data = new Uint16Array(4)
  gl.readRenderTargetPixels(target, x, y, 1, 1, data)
  return Array.from(data, (half) => THREE.DataUtils.fromHalfFloat(half))
}

/** The glare of a 2×2 px source, relative to the source, against the Stiles–Holladay law in the same pixels. */
function probeGlare(radii: readonly number[]): ReadonlyArray<{ readonly radius: number; readonly ratio: number }> {
  const SIZE = 1024
  const SOURCE = 1000
  const target = createHdrTarget(SIZE, SIZE)
  const paint = new FullScreenQuad(new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `void main() { gl_FragColor = vec4(vec3(${SOURCE.toFixed(1)}), 1.); }`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }))
  gl.setRenderTarget(target)
  gl.clear()
  target.scissorTest = true
  target.scissor.set(SIZE / 2 - 1, SIZE / 2 - 1, 2, 2)
  gl.setRenderTarget(target)
  paint.render(gl)
  target.scissorTest = false

  const glare = createGlare()
  glare.apply(gl, target)
  return radii.map((radius) => {
    const distance = radius + 0.5
    // E = 4 L Ω_px and θ = distance·√Ω_px, so the pixel scale cancels: L_veil / L = 10·4·(π/180)²/distance².
    const law = (STILES_HOLLADAY * 4 * (Math.PI / 180) ** 2) / distance ** 2
    return { radius, ratio: read(target, SIZE / 2 + radius, SIZE / 2)[0] / SOURCE / law }
  })
}

const LOOKUP_FRAGMENT = /* glsl */ `
uniform samplerCube uCube;
uniform vec3 uDirection;
void main() { gl_FragColor = textureCube(uCube, uDirection); }`

const bakeAndLookUp = (turbulence: number, directions: readonly Vec3[], distanceLy: number = 0): ReadonlyArray<readonly number[]> =>
  lookUp(createGalaxyBake(turbulence), directions, along(distanceLy))

function lookUp(bake: GalaxyBake, directions: readonly Vec3[], from: Vec3): ReadonlyArray<readonly number[]> {
  for (let i = 0; i < 2000 && !bake.uniforms.uCubeB.value; i++) bake.update(gl, from, 0, 1 / 60)
  const target = createHdrTarget(1, 1)
  const material = new THREE.ShaderMaterial({
    uniforms: { uCube: bake.uniforms.uCubeB, uDirection: { value: new THREE.Vector3() } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: LOOKUP_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const quad = new FullScreenQuad(material)
  const samples = directions.map((direction) => {
    material.uniforms.uDirection.value.set(...direction)
    gl.setRenderTarget(target)
    quad.render(gl)
    return read(target, 0, 0)
  })
  bake.dispose()
  return samples
}

/** The bake without turbulence, looked up through the cube map, against the same integral in TypeScript. */
function probeBake(directions: readonly Vec3[]) {
  const baked = bakeAndLookUp(0, directions)
  return directions.map((direction, i) => {
    const towards = direction
    const expected = sightline(SUN, towards, 40, true)
    return {
      direction,
      visual: baked[i][0] * 1e-3 / expected.luminanceV,
      blue: baked[i][1] * 1e-3 / expected.luminanceB,
      nearExtinction: baked[i][3] / sightline(SUN, towards, RESOLVED_RADIUS_KPC).extinctionV,
    }
  })
}

/** Mean light with turbulence, over the same without it, from several places on the course. */
function probeTurbulence(directions: readonly Vec3[], places: readonly number[]): { readonly light: number } {
  const total = (turbulence: number): number => places
    .flatMap((place) => bakeAndLookUp(turbulence, directions, place))
    .reduce((sum, sample) => sum + sample[0], 0)
  return { light: total(1) / total(0) }
}

/** What a flight does to the bake: the first one, none at cruise, a new one on slowing down, and the fade between. */
function probeRebake() {
  const bake = createGalaxyBake(0)
  const { uCubeA, uCubeB, uMix } = bake.uniforms
  const run = (distanceLy: number, phi: number, frames: number): void => {
    for (let i = 0; i < frames; i++) bake.update(gl, along(distanceLy), phi, 1 / 60)
  }
  run(0, 0, 400)
  const first = uCubeB.value
  const settled = uMix.value
  run(20_000, 5, 400) // far along, but at cruise
  const afterCruise = uCubeB.value
  run(20_000, 1, 400) // braked
  const afterBraking = { current: uCubeB.value, previous: uCubeA.value, mix: uMix.value }
  bake.dispose()
  return {
    hasFirstBake: first !== null,
    settled,
    skippedAtCruise: afterCruise === first,
    rebakedAfterBraking: afterBraking.current !== first && afterBraking.previous === first,
    finalMix: afterBraking.mix,
  }
}

/** With the measured dust: the extinction to the edge of the resolved stars, from the Sun; without `isFine`, the 3D
 * map's cells stay smooth. */
async function probeDustMap(directions: readonly Vec3[], isFine: boolean): Promise<readonly number[]> {
  const loading = loadDustMap().then((map) => {
    if (isFine) return map
    map.fine?.dispose()
    return { ...map, fine: null }
  })
  const bake = createGalaxyBake(1, loading)
  await loading // the bake took the map first: it asked first
  return lookUp(bake, directions, SUN).map((sample) => sample[3])
}

Object.assign(window, { probes: { probeGlare, probeBake, probeTurbulence, probeRebake, probeDustMap } })
