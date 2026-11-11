import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { DUST_GRID, FINE_GRID, type DustMap } from './dustMap'
import { BLUE_PER_VISUAL, COLUMN_TO_LUMINANCE, GALAXY_GLSL, KPC_LY, RESOLVED_RADIUS_KPC, SUN, UNRESOLVED_FRACTION, type Vec3 } from './galaxy'
import { mulberry32 } from './stars'

// The unresolved Milky Way, ray-marched from the ship's true position into a cube map along the galactic axes, so
// that turning the ship needs no new bake. Marching every frame is too slow, and the view only changes over hundreds
// of light years, so the bake runs in tiles on a back buffer over several frames and fades in when it is done.
//
// Each texel holds what the sky shader needs to Doppler-shift it later: V and B luminance (mcd/m²), the
// emission measure of the ionised gas (10³ pc cm⁻⁶), and the extinction to the edge of the resolved stars (mag).

const FACE_SIZE = 1024
const TILES_PER_SIDE = 4
const TILES = 6 * TILES_PER_SIDE * TILES_PER_SIDE
const FADE_SECONDS = 1.2
const REBAKE_LY = 150
const REBAKE_MAX_PHI = 3 // above γ ≈ 10 aberration has crushed the sky into a spot, and parallax cannot be seen
const NOISE_SIZE = 64
const MAP_HANDOVER_PC = 900 // from here out to the map's edge its dust gives way to the model's


const BAKE_FRAGMENT = /* glsl */ `
precision highp sampler3D;
${GALAXY_GLSL}
uniform sampler3D uNoise;
uniform vec3 uFrom;
uniform int uFace;
uniform float uTurbulence;
uniform sampler3D uDustMap;
uniform float uHasDustMap;
uniform sampler2D uFineDust;
uniform float uHasFineDust;

const vec3 SUN = vec3(${SUN.map((c) => c.toFixed(6)).join(', ')});
const float MAP_SHELLS = ${DUST_GRID.shells.toFixed(1)};
const float MAP_INNER = ${DUST_GRID.innerPc.toFixed(6)}; // pc
const float MAP_OUTER = ${DUST_GRID.outerPc.toFixed(6)};
const float MAP_HANDOVER = ${MAP_HANDOVER_PC.toFixed(1)};
const int MAP_SAMPLES = 4; // per step: a step is up to about twice as long as a shell of the map

float shellDensity(vec2 sky, float shell) {
  float code = textureLod(uDustMap, vec3(sky, (shell + .5) / MAP_SHELLS), 0.).r;
  return pow(10., ${DUST_GRID.logMin.toFixed(6)} + code * ${(DUST_GRID.logMax - DUST_GRID.logMin).toFixed(6)});
}

// A_V per kpc at g, from the map. Between shell centres the density is interpolated, not its logarithm, which would
// lose most of a cloud one shell thick; across the sky the texture interpolates the logarithm, which keeps edges sharp.
// Inside a cell, Planck's dust at 5′ shapes it, by direction from the Sun: the map has no finer distances.
float mappedDust(vec3 g) {
  vec3 h = (g - SUN) * 1000.; // pc from the Sun, galactic axes
  float d = max(length(h), 1e-3);
  vec2 sky = vec2(atan(h.y, h.x) / 6.2831853, asin(clamp(h.z / d, -1., 1.)) / 3.1415927 + .5);
  float shell = clamp(.5 + (MAP_SHELLS - 1.) * log(d / MAP_INNER) / log(MAP_OUTER / MAP_INNER), 0., MAP_SHELLS - 1.);
  float below = min(floor(shell), MAP_SHELLS - 2.);
  float fine = uHasFineDust > 0.
    ? pow(10., ${FINE_GRID.logMin.toFixed(8)} + textureLod(uFineDust, sky, 0.).r * ${(FINE_GRID.logMax - FINE_GRID.logMin).toFixed(8)})
    : 1.;
  return fine * mix(shellDensity(sky, below), shellDensity(sky, below + 1.), shell - below);
}

const float NEAR = ${RESOLVED_RADIUS_KPC.toFixed(6)};
const int STEPS = 96;
const float OUTER = ${(0.4 * Math.LN10).toFixed(6)};
const float L0 = 3.;      // kpc, the largest eddies
const float DARK_SIGMA = 2.1;  // log-normal width of the dust density: most of a path is clear, and clouds are dense
const float FBM_STD = .08;

vec3 faceDirection(vec2 st) {
  if (uFace == 0) return vec3(1., -st.y, -st.x);
  if (uFace == 1) return vec3(-1., -st.y, st.x);
  if (uFace == 2) return vec3(st.x, 1., st.y);
  if (uFace == 3) return vec3(st.x, -1., -st.y);
  if (uFace == 4) return vec3(st.x, -st.y, 1.);
  return vec3(-st.x, -st.y, -1.);
}

vec4 tile(vec3 p) {
  vec3 i = floor(p), f = p - i;
  f = f * f * (3. - 2. * f);
  return textureLod(uNoise, (i + f + .5) / ${NOISE_SIZE}., 0.);
}

const mat3 TURN = mat3(.8, .6, 0., -.48, .64, .6, .36, -.48, .8);
float fbm(vec3 p, float octaves) {
  float sum = 0., amp = 1., norm = 0.;
  for (int i = 0; i < 13; i++) {
    float weight = clamp(octaves - float(i), 0., 1.);
    if (weight <= 0.) break;
    sum += amp * weight * tile(p).r;
    norm += amp * weight;
    p = TURN * p * 2.03 + 11.3;
    amp *= .7;
  }
  return sum / norm;
}
float logNormal(float g, float sigma) { return exp(sigma * g - .5 * sigma * sigma); }

void main() {
  vec2 st = 2. * gl_FragCoord.xy / ${FACE_SIZE}. - 1.;
  vec3 dir = normalize(faceDirection(st));

  float v = 0., b = 0., em = 0., av = 0., near = 0.;
  float s = .008;
  for (int i = 0; i < STEPS; i++) {
    vec3 at = uFrom + dir * s;
    // Concentric shells: a slice through the noise that runs along the ray would smear it into streaks. Only from
    // outside the disc must the steps tighten near the plane, or they cut its thin gas layer into dashes.
    float planeFloor = mix(.4, .06, smoothstep(.15, .5, abs(uFrom.z)));
    float ds = min(max(.008, .14 * s), .5 * max(abs(at.z), planeFloor) / max(abs(dir.z), 1e-3));
    vec3 g = at + dir * ds * .5; // no jitter: per-texel noise on a log-normal field turns filaments into grain
    if (length(g.xy) > 30. && dot(g.xy, dir.xy) > 0.) break;
    if (abs(g.z) > 3.5 && g.z * dir.z > 0.) break;

    float arm = armField(g);
    float kappa = dustDensity(g, arm);
    float old = oldLight(g), bulge = bulgeLight(g), young = youngLight(g, arm);
    float dark = 1., cloud = 1., ionised = 0.;
    if (uTurbulence > 0. && (kappa > .003 || young > 3e-4)) {
      // Detail down to a texel of the cube, about 0.075° on the sky, and to 1 pc nearer than 770 pc, where the steps
      // along the ray could not follow anything finer. Domain warping turns blobs into filaments.
      float octaves = clamp(log2(L0 / max(.001, s * .0013)), 2., 12.);
      vec3 warp = tile(g / 1.1 + 3.7).gba - .5 + .5 * (tile(g / .37 + 9.1).gba - .5);
      vec3 q = g / L0 + warp * .3;
      float field = (fbm(q * 2.3, octaves) - .5) / FBM_STD;
      dark = logNormal(field, DARK_SIGMA);
      float gas = (fbm(q * 3.1 + 21.7, min(octaves, 6.)) - .5) / FBM_STD;
      cloud = logNormal(.7 * field + .7 * gas, .55);
      float clump = smoothstep(1.25, 2.3, gas) * (.15 + .85 * arm) * sech2(g.z / .09);
      ionised = 18. * clump * clump; // n_e, cm⁻³; emission measures of 10³–10⁵ pc cm⁻⁶, as in bright H II regions
    }
    float dust = kappa * dark;
    float measured = uHasDustMap * (1. - smoothstep(MAP_HANDOVER, MAP_OUTER, length(g - SUN) * 1000.));
    if (measured > 0.) {
      float real = 0.;
      for (int k = 0; k < MAP_SAMPLES; k++) real += mappedDust(at + dir * ds * (float(k) + .5) / float(MAP_SAMPLES));
      dust = mix(dust, real / float(MAP_SAMPLES), measured);
    }
    float resolved = mix(${UNRESOLVED_FRACTION.toFixed(3)}, 1., smoothstep(.8 * NEAR, NEAR, s));
    float pc = ds * 1000.;
    float visual = exp(-OUTER * av), blue = exp(-OUTER * 1.32 * av), red = exp(-OUTER * .81 * av);
    float hot = young * cloud;
    v += (old + bulge + hot) * resolved * pc * visual;
    b += (old * ${BLUE_PER_VISUAL.old.toFixed(6)} + bulge * ${BLUE_PER_VISUAL.bulge.toFixed(6)} + hot * ${BLUE_PER_VISUAL.young.toFixed(6)}) * resolved * pc * blue;
    em += ionised * ionised * pc * red;
    av += dust * ds;
    if (s < NEAR) near = av;
    s += ds;
  }
  gl_FragColor = vec4(v * ${(COLUMN_TO_LUMINANCE * 1e3).toExponential(6)}, b * ${(COLUMN_TO_LUMINANCE * 1e3).toExponential(6)}, em * 1e-3, near);
}`

function createNoise(): THREE.Data3DTexture {
  const random = mulberry32(1)
  const data = Uint8Array.from({ length: NOISE_SIZE ** 3 * 4 }, () => Math.floor(random() * 256))
  const noise = new THREE.Data3DTexture(data, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE)
  noise.format = THREE.RGBAFormat
  noise.type = THREE.UnsignedByteType
  noise.minFilter = noise.magFilter = THREE.LinearFilter
  noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping
  noise.needsUpdate = true
  return noise
}

const createCube = (): THREE.WebGLCubeRenderTarget => new THREE.WebGLCubeRenderTarget(FACE_SIZE, {
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearMipmapLinearFilter,
  magFilter: THREE.LinearFilter,
  generateMipmaps: false,
  depthBuffer: false,
})

export interface GalaxyBake {
  /** Bound to the sky shader: the previous and the current cube, and how far the fade has got. */
  readonly uniforms: {
    readonly uCubeA: THREE.IUniform<THREE.Texture | null>
    readonly uCubeB: THREE.IUniform<THREE.Texture | null>
    readonly uMix: THREE.IUniform<number>
  }
  /** `from` is the ship's place in the model, galactocentric kpc. */
  update(gl: THREE.WebGLRenderer, from: Vec3, phi: number, dt: number): void
  dispose(): void
}

/**
 * `turbulence` is 0 only in the GPU test, which compares the bake with the smooth model in galaxy.ts. Given a dust map,
 * the first bake waits for it, and if it fails to load the model's dust stands in.
 */
export function createGalaxyBake(turbulence: number = 1, dustMap?: Promise<DustMap>): GalaxyBake {
  const noise = createNoise()
  const cubes = [createCube(), createCube()] as const
  const uniforms: GalaxyBake['uniforms'] = { uCubeA: { value: null }, uCubeB: { value: null }, uMix: { value: 1 } }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: noise },
      uFrom: { value: new THREE.Vector3() },
      uFace: { value: 0 },
      uTurbulence: { value: turbulence },
      uDustMap: { value: null },
      uHasDustMap: { value: 0 },
      uFineDust: { value: null },
      uHasFineDust: { value: 0 },
    },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: BAKE_FRAGMENT,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const quad = new FullScreenQuad(material)

  let back = 0
  let nextTile = -1 // -1: nothing is being baked
  let tilesPerFrame = 2
  let bakedAt: Vec3 | null = null
  let isDisposed = false
  // ponytail: no Milky Way until the 12 MB have come, which is a moment from disc; a slow link would want the model first
  let isWaitingForDust = dustMap !== undefined
  dustMap?.then(
    ({ volume, fine }) => {
      if (isDisposed) {
        volume.dispose()
        fine?.dispose()
        return
      }
      material.uniforms.uDustMap.value = volume
      material.uniforms.uHasDustMap.value = 1
      material.uniforms.uFineDust.value = fine
      material.uniforms.uHasFineDust.value = fine ? 1 : 0
      isWaitingForDust = false
    },
    (error: unknown) => {
      console.warn('The dust map did not load; the sky shows the model dust instead.', error)
      isWaitingForDust = false
    },
  )

  const bakeTile = (gl: THREE.WebGLRenderer, tile: number): void => {
    const cube = cubes[back]
    const size = FACE_SIZE / TILES_PER_SIDE
    const inFace = tile % (TILES_PER_SIDE * TILES_PER_SIDE)
    cube.scissorTest = true
    cube.scissor.set((inFace % TILES_PER_SIDE) * size, Math.floor(inFace / TILES_PER_SIDE) * size, size, size)
    cube.texture.generateMipmaps = tile === TILES - 1 // three builds the mip chain after this render
    material.uniforms.uFace.value = Math.floor(tile / (TILES_PER_SIDE * TILES_PER_SIDE))
    gl.setRenderTarget(cube, material.uniforms.uFace.value as number)
    quad.render(gl)
    cube.texture.generateMipmaps = false
  }

  return {
    uniforms,
    update(gl, from, phi, dt) {
      if (isWaitingForDust) return
      uniforms.uMix.value = Math.min(1, uniforms.uMix.value + dt / FADE_SECONDS)
      const isSettled = nextTile < 0 && uniforms.uMix.value >= 1
      const hasMoved = !bakedAt || Math.hypot(from[0] - bakedAt[0], from[1] - bakedAt[1], from[2] - bakedAt[2]) * KPC_LY > REBAKE_LY
      if (isSettled && hasMoved && (phi < REBAKE_MAX_PHI || !bakedAt)) {
        nextTile = 0
        bakedAt = from
        ;(material.uniforms.uFrom.value as THREE.Vector3).set(...from)
      }
      if (nextTile < 0) return

      // The cost of a bake depends on the GPU, so the pace follows the frame time.
      tilesPerFrame = THREE.MathUtils.clamp(dt < 1 / 50 ? tilesPerFrame * 1.3 : tilesPerFrame * 0.7, 1, TILES)
      const autoClear = gl.autoClear
      gl.autoClear = false
      const end = Math.min(TILES, nextTile + Math.ceil(tilesPerFrame))
      for (; nextTile < end; nextTile++) bakeTile(gl, nextTile)
      gl.autoClear = autoClear
      if (nextTile < TILES) return

      nextTile = -1
      uniforms.uCubeA.value = uniforms.uCubeB.value
      uniforms.uCubeB.value = cubes[back].texture
      uniforms.uMix.value = 0
      back = 1 - back
    },
    dispose() {
      isDisposed = true
      ;(material.uniforms.uDustMap.value as THREE.Data3DTexture | null)?.dispose()
      ;(material.uniforms.uFineDust.value as THREE.DataTexture | null)?.dispose()
      noise.dispose()
      cubes.forEach((cube) => cube.dispose())
      material.dispose()
      quad.dispose()
    },
  }
}
