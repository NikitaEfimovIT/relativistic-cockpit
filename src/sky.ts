import * as THREE from 'three'
import { EARTH_MAP, MOON_MAP, PLANET_MAPS, createGlobe } from './globe'
import { ALL_GLOBES } from './exoplanets'
import { EARTH, MOON, type Globe } from './solarSystem'
import { COLOUR_EXCESS_SLOPE, DENSITY_CAP, GALAXY_GLSL, HALPHA_RADIANCE_PER_EM, KPC_LY, galactocentric, type Vec3 } from './galaxy'
import { loadDustMap } from './dustMap'
import { createGalaxyBake } from './galaxyBake'
import { BRIGHT_LIMIT_V, BRIGHT_STARS } from './brightStars'
import { STARS } from './nearbyStars'
import {
  BLACKBODY_LUT, LOG_T_MAX, LOG_T_MIN, LUT_SIZE, T_CMB,
  gammaOf, lutXYZ, magnitudeToIlluminance, oneMinusBeta,
} from './physics'
import { STAR_BOX_LY, generateStars, withoutNakedEyeStars } from './stars'
import { galacticToShipMatrix, type Quat } from './voyage'
import { LENS_GLSL, createLens } from './lensShader'

/** Display calibration: a star of this magnitude sits at the visibility threshold. */
const LIMITING_MAGNITUDE = 7.6
const DISPLAY_AT_LIMIT = 0.04
/** The diffuse glow is shown as x²/(x + GLOW_TOE): a quarter of the faintest star's peak is where it starts to show. */
const GLOW_TOE = DISPLAY_AT_LIMIT / 4
/** Share of the colour of a glow too faint for the cones that is still shown: barely perceptible, a choice. */
const SCOTOPIC_HINT = 0.15
/**
 * σ of a star on screen, device px: as small as stays stable while moving, the glare carries the rest (Schneegans 2025).
 * In device pixels and not CSS ones, or on a dense screen every star is twice as wide as it needs to be, and soft.
 */
export const STAR_SIGMA = 0.72
/** Radiance per lux of a point source with that PSF on a 1000 px, 70° reference view. */
const REFERENCE_PEAK_PER_LUX = 1 / (2 * Math.PI * STAR_SIGMA ** 2 * ((2 * Math.tan((35 * Math.PI) / 180)) / 1000) ** 2)
export const NIGHT_EXPOSURE = DISPLAY_AT_LIMIT / (magnitudeToIlluminance(LIMITING_MAGNITUDE) * REFERENCE_PEAK_PER_LUX)

const ADAPTED_KEY = 0.5
const VIEW_SOLID_ANGLE = 1.5 // sr, roughly the cockpit view
const CABIN_LIGHTS_DIMMING = 6 // how far a lit cabin stops the eye down; a choice for the monitor, not a measurement

/** What lit cabin lights add to the exposure meter, lx. It does not grow with zoom: they are not in the telescope. */
export const cabinLightsLux = (eyeZoom: number): number =>
  ((CABIN_LIGHTS_DIMMING - 1) * VIEW_SOLID_ANGLE * ADAPTED_KEY) / NIGHT_EXPOSURE / (eyeZoom * eyeZoom)

/**
 * Exposure metered on the mean luminance of the view, E/Ω, falling back to the night value in the dark.
 * Zooming shrinks Ω, so when the forward disc fills the view it is exposed for its true colour.
 */
export const adaptedExposure = (illuminance: number, eyeZoom: number): number =>
  NIGHT_EXPOSURE / (1 + (NIGHT_EXPOSURE * ((illuminance * eyeZoom * eyeZoom) / VIEW_SOLID_ANGLE)) / ADAPTED_KEY)

const CABIN_REFLECTANCE = 0.05 // the share of the CMB's light that the dark cabin sends back to the eye

/**
 * What the eye's meter reads, lx. With the bright spot in view it is the spot; looking away it is what that spot lights
 * up. Without this, turning away would open the eye to night level while the cabin is still flooded with light.
 */
export function meteredIlluminance(illuminance: number, starlight: number, offCourse: number, halfFov: number, zoom = 1): number {
  const inView = inViewWeight(offCourse, halfFov)
  return meteredSource(illuminance, offCourse, halfFov, 0, zoom) + starlight * inView
}

/** 1 while a source is in view, 0 once it is well outside, smoothly between. */
const inViewWeight = (offAxis: number, halfFov: number): number =>
  1 - Math.min(1, Math.max(0, (offAxis - 1.2 * halfFov) / (0.4 * halfFov)))

const MAX_SPOT_WEIGHT = 8

/**
 * The same rule for any bright source `offAxis` rad from where the eye looks: itself in view, its light on the cabin
 * out of it. A source of angular radius `radius` that fills part of the view counts as its own luminance and not the
 * mean of the view, up to a limit: the eye fixed on a large sunlit planet adapts to it, as a centre-weighted meter
 * does. A point source keeps the plain mean. This weighting is a choice, not a measured law. What the cabin sends back
 * is the cabin's own brightness, which `zoom` does not magnify, so like the cabin lights its share does not grow with it.
 */
export function meteredSource(illuminance: number, offAxis: number, halfFov: number, radius = 0, zoom = 1): number {
  const spot = radius > 0 ? Math.min(MAX_SPOT_WEIGHT, Math.max(1, VIEW_SOLID_ANGLE / (2 * Math.PI * (1 - Math.cos(radius))))) : 1
  // a large disc is in view while its edge is, not only its centre: low over a planet the eye looks at its limb
  return illuminance * (CABIN_REFLECTANCE / (zoom * zoom) + (1 - CABIN_REFLECTANCE) * spot * inViewWeight(Math.max(0, offAxis - radius), halfFov))
}

const xyzToLinearSrgb = ([X, Y, Z]: readonly [number, number, number]): THREE.Vector3 =>
  new THREE.Vector3(
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  )

/** Linear sRGB colour of a blackbody, normalised so that luminance is 1. */
export function blackbodyTint(T: number): THREE.Vector3 {
  const xyz = lutXYZ(T)
  return xyzToLinearSrgb(xyz).divideScalar(Math.max(xyz[1], 1e-300)).max(new THREE.Vector3())
}

const BLACKBODY_GLSL = /* glsl */ `
uniform sampler2D uLut;
const float HDR_LIMIT = 3e4; // stays well inside half-float range
const mat3 XYZ_TO_SRGB = mat3(3.2406,-0.9689,0.0557, -1.5372,1.8758,-0.2040, -0.4986,0.0415,1.0570);
// Radiance of a blackbody at T in linear sRGB, with Y in cd/m². Precomputed Planck x CIE integral.
vec3 blackbody(float T) {
  float u = clamp((log(T)/2.302585 - ${LOG_T_MIN.toFixed(1)}) / ${(LOG_T_MAX - LOG_T_MIN).toFixed(1)}, 0., 1.) * ${(LUT_SIZE - 1).toFixed(1)};
  int i = int(u);
  vec3 a = texelFetch(uLut, ivec2(i, 0), 0).rgb;
  vec3 b = texelFetch(uLut, ivec2(min(i + 1, ${LUT_SIZE - 1}), 0), 0).rgb;
  return max(XYZ_TO_SRGB * exp(mix(a, b, u - float(i)) * 2.302585), 0.);
}`

// Motion is along -z. All aberration arithmetic goes through 1-β (uEps) and chord lengths, because at
// six nines β itself is only 17 float32 ulps from 1 and the forward spot would band otherwise.
const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.);
  gl_Position.z = gl_Position.w * 0.9999;
}`

const ABERRATION_GLSL = /* glsl */ `
varying vec3 vDir;
uniform float uGamma, uEps, uExposure;
const float DEG_PER_CHORD = 57.29578;
vec3 limited(vec3 c) { return c * min(1., HDR_LIMIT / max(max(c.r, max(c.g, c.b)), 1e-20)); } // keeps chromaticity`

// The blueshifted CMB and the glare it causes, added after the pyramid: its disc can lie outside the view
// and still veil the eye, which a screen-space blur cannot know about.
const CMB_FRAGMENT = /* glsl */ `
${BLACKBODY_GLSL}
${ABERRATION_GLSL}
uniform float uVeilLux, uEyeZoom, uHasMask;
uniform vec3 uVeilTint;
uniform vec2 uResolution;
uniform sampler2D uMask;
void main() {
  vec3 d = normalize(vDir);
  vec3 chord = d - vec3(0., 0., -1.);
  float oneMinusCos = 0.5 * dot(chord, chord);
  float D = 1. / (uGamma * (oneMinusCos + uEps * (-d.z)));   // Doppler factor, ship-frame form
  // The hull hides the sky (its alpha in the frame is 1), but not the glare, which happens inside the eye.
  float open = mix(1., 1. - min(texture2D(uMask, gl_FragCoord.xy / uResolution).a, 1.), uHasMask);
  vec3 c = blackbody(${T_CMB.toFixed(5)} * D) * open;
  // Stiles–Holladay veiling glare with a soft core below 1°. The angle is the one at the eye, hence the zoom.
  float thetaDeg = length(chord) * DEG_PER_CHORD * uEyeZoom;
  c += uVeilTint * 10. * uVeilLux / (thetaDeg * thetaDeg + 0.25);
  gl_FragColor = vec4(limited(c * uExposure), 1.);
}`

const LINE_GLSL = /* glsl */ `
float lobe(float w, float a, float mu, float s1, float s2) {
  float t = (w - mu) * (w < mu ? s1 : s2);
  return a * exp(-.5 * t * t);
}
vec3 cie(float w) { // Wyman et al. 2013
  return vec3(
    lobe(w, .362, 442., .0624, .0374) + lobe(w, 1.056, 599.8, .0264, .0323) + lobe(w, -.065, 501.1, .049, .0382),
    lobe(w, .821, 568.8, .0213, .0247) + lobe(w, .286, 530.9, .0613, .0322),
    lobe(w, 1.217, 437., .0845, .0278) + lobe(w, .681, 459., .0385, .0725));
}
// An emission line keeps its photons: the wavelength moves to λ/D and the integrated radiance scales as D⁴.
// Hα, with Hβ at the case-B ratio 1/2.86 (Osterbrock & Ferland 2006), and typical [N II] and [O III] alongside.
vec3 emissionLines(float em, float D) {
  vec3 xyz = cie(656.3 / D) + .35 * cie(658.3 / D) + .35 * cie(486.1 / D) + .35 * cie(500.7 / D);
  float D2 = D * D;
  return max(XYZ_TO_SRGB * xyz, 0.) * 683. * ${HALPHA_RADIANCE_PER_EM.toExponential(6)} * em * D2 * D2;
}`

const GALAXY_FRAGMENT = /* glsl */ `
${BLACKBODY_GLSL}
${ABERRATION_GLSL}
${LINE_GLSL}
${LENS_GLSL}
uniform samplerCube uCubeA, uCubeB;
uniform float uMix, uIsEye;
uniform mat3 uBasis;
const vec3 LUMA = vec3(.2126, .7152, .0722);
void main() {
  vec3 d = normalize(vDir);
  vec3 chord = d - vec3(0., 0., -1.);
  float oneMinusCos = 0.5 * dot(chord, chord);
  float denom = oneMinusCos + uEps * (-d.z);                 // 1 - β cos θ′
  float D = 1. / (uGamma * denom);                           // Doppler factor, ship-frame form
  vec3 n = vec3(d.xy * D, (oneMinusCos - uEps) / denom) * uBasis; // same ray in the galaxy frame, galactic axes
  // By a black hole: where that ray came from, blueshifted by the fall into the well; black in its shadow; or the hole's
  // disk or its star, met first, a surface as hot as it looks to an eye at rest there (a blackbody stays one at T·g)
  float seenT;
  int seen = lensView(n, seenT);
  if (seen == 1) { gl_FragColor = vec4(0., 0., 0., 1.); return; }
  if (seen == 2) { gl_FragColor = vec4(limited(blackbody(seenT * D) * uExposure), 1.); return; }
  D *= uBlue;
  vec4 sky = mix(textureCube(uCubeA, n), textureCube(uCubeB, n), uMix);
  float visual = max(sky.r, 1e-6) * 1e-3;
  // The light of many populations through dust is one diluted blackbody of the colour temperature of its B−V
  // (Ballesteros 2012, eq. 14). The dilution W is Lorentz invariant, so it stays one at T′ = D·T.
  float bv = clamp(-2.5 * log(max(sky.g, 1e-6) / max(sky.r, 1e-6)) / 2.302585, -.3, 3.);
  float T = 4600. * (1. / (.92 * bv + 1.7) + 1. / (.92 * bv + .62));
  float dilution = visual / max(dot(blackbody(T), LUMA), 1e-30);
  vec3 c = dilution * blackbody(T * D) + emissionLines(max(sky.b, 0.) * 1e3, D);
  // Colour takes light enough for the cones: barely any below about 0.01 cd/m², all of it above about 3, the mesopic
  // range (Stockman & Sharpe 2006). The Milky Way, near 1e-4, is grey to the eye, as observers find; it takes colour
  // only where the blueshift brightens it, and a camera sees it at any level. The hint left below the range is a choice.
  float Y = dot(c, LUMA);
  float cones = mix(${SCOTOPIC_HINT.toFixed(2)}, 1., smoothstep(-2., .48, log(max(Y, 1e-12)) / 2.302585));
  c = mix(vec3(Y), c, mix(1., cones, uIsEye));
  // A toe for the glow alone, not for the stars: shown linearly, a background a tenth as bright as the faintest star
  // still lifts the whole sky to grey, where the eye sees black. A display choice, not a measured law.
  vec3 shown = c * uExposure;
  float y = dot(shown, LUMA);
  gl_FragColor = vec4(limited(shown * (y / (y + ${GLOW_TOE.toFixed(4)}))), 1.);
}`

const STAR_VERTEX = /* glsl */ `
${BLACKBODY_GLSL}
${GALAXY_GLSL}
${LENS_GLSL}
uniform float uImage; // 0: each star where it is, or its image on its own side of a hole; 1: its image beyond the hole
attribute float aTemperature, aRadiusSquared, aRandom;
uniform float uGamma, uEps, uExposure, uPeakPerLux, uSigmaPx, uBox, uThin, uDust;
uniform vec3 uShip, uFrom;
uniform mat3 uBasis;
uniform samplerCube uCubeB;
varying vec3 vColor;
varying float vFalloff;
const float THRESHOLD = 0.001;
const float MAX_RADIUS_PX = 40.;
const float KPC_PER_LY = ${(1 / KPC_LY).toExponential(6)};
const float NEAR_LY = ${(STAR_BOX_LY / 2).toFixed(1)};
void drop() { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; }
void main() {
  vec3 g = position - uShip;                                  // ly, galactic axes
  if (uBox > 0.) g -= uBox * floor(g / uBox + 0.5);          // nearest periodic image
  // The box only offers candidates. Keeping each with the probability of the disc's density at its true place
  // gives a Poisson process with that density, so the stars crowd towards the plane and thin out above it.
  float blends = 1.;
  if (uThin > .5) {
    float density = starDensityRatio(uFrom + g * KPC_PER_LY, aTemperature) / ${DENSITY_CAP.toFixed(3)};
    if (aRandom > density) { drop(); return; }
    blends = max(1., density);                                 // denser than the catalog: unresolved neighbours
  }
  // By a black hole each star is drawn twice: where its rays come from on either side of the hole, as bright as the
  // lens makes it. Without one only the first draw is kept.
  float mu = 1.;
  vec3 toStar = g / max(length(g), 1e-12);
  if (uLensOn > .5) toStar = imageOf(toStar, uImage, sqrt(aRadiusSquared) / max(length(g), 1e-12), mu);
  else if (uImage > .5) { drop(); return; }
  vec3 r = uBasis * (toStar * length(g));                      // into the ship's axes

  float dist = max(length(r), 1e-12);
  vec3 n = r / dist;
  vec3 sum = n + vec3(0., 0., -1.);
  float onePlusCos = 0.5 * dot(sum, sum);
  float denom = onePlusCos + uEps * n.z;                      // 1 + β cos θ, with cos θ = -n.z
  float D = uGamma * denom;                                   // Doppler factor, galaxy-frame form
  vec3 seen = vec3(n.xy / D, (uEps - onePlusCos) / denom);    // aberrated direction on the ship
  vec3 view = mat3(viewMatrix) * seen;
  gl_Position = projectionMatrix * vec4(view, 1.);
  gl_Position.z = gl_Position.w * 0.9998;

  // Dust between us and the star. Lowering T at fixed W dims and reddens it by about the same A_V (tested). A real star's
  // V and colour are as seen from the Sun, its dust already in them, so it gets none here.
  float extinction = uDust * textureLod(uCubeB, g / dist, 0.).a * min(1., dist / NEAR_LY);
  float T = 1. / (1. / aTemperature + extinction / 3.1 * ${COLOUR_EXCESS_SLOPE.toExponential(4)});

  // Point source: T′ = D T and solid angle Ω′ = Ω/D². Together these reproduce L′λ = D⁵ Lλ.
  float solidAngle = 3.14159265 * aRadiusSquared / (dist * dist) / (D * D) * mu;
  float fade = uBox > 0. ? 1. - smoothstep(0.85, 1., dist / (uBox * 0.5)) : 1.;
  // Off-axis pixels subtend a smaller solid angle, as cos³, so the same flux reads brighter there (Schneegans 2025).
  float cosAxis = max(-view.z, .05);
  vec3 color = blackbody(T * D * uBlue) * solidAngle * blends * uPeakPerLux / (cosAxis * cosAxis * cosAxis) * uExposure * fade;
  float peak = max(color.r, max(color.g, color.b));
  if (!(peak > THRESHOLD)) { drop(); return; }
  float falloff = log(peak / THRESHOLD);
  vColor = color * min(1., HDR_LIMIT / peak); // keeps chromaticity
  vFalloff = falloff;
  gl_PointSize = 2. * min(uSigmaPx * sqrt(2. * falloff), MAX_RADIUS_PX) + 1.;
}`

const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vFalloff;
void main() {
  vec2 p = 2. * gl_PointCoord - 1.;
  float r2 = dot(p, p);
  if (r2 > 1.) discard;
  gl_FragColor = vec4(vColor * exp(-vFalloff * r2), 1.); // Gaussian PSF reaching the threshold at the sprite edge
}`

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0., 1.);
}`

// The final step. Per channel, like film or a sensor, so that an overexposed source clips towards white.
const DISPLAY_FRAGMENT = /* glsl */ `
uniform sampler2D uImage;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(1. - exp(-texture2D(uImage, vUv).rgb), 1.);
  #include <colorspace_fragment>
  // Faint gradients band in 8 bits, which reads as a compressed image. Interleaved gradient noise, Jimenez 2014.
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
  gl_FragColor.rgb += (dither - .5) / 255.;
}`

/** Maps the finished HDR frame to the screen. */
export const createDisplayMaterial = (image: THREE.Texture): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  uniforms: { uImage: { value: image } },
  vertexShader: FULLSCREEN_VERTEX,
  fragmentShader: DISPLAY_FRAGMENT,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})

const MONITOR_PEAK = 4 // a screen has a brightest white, however bright the star it shows

/** The rear camera's picture on its monitor, as light entering the frame: the tone curve comes at the end. */
export const createMonitorMaterial = (image: THREE.Texture, gain: THREE.IUniform<number>): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  uniforms: { uImage: { value: image }, uGain: gain },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uImage;
    uniform float uGain;
    varying vec2 vUv;
    void main() { gl_FragColor = vec4(min(texture2D(uImage, vUv).rgb, vec3(${MONITOR_PEAK.toFixed(1)})) * uGain, 1.); }`,
  toneMapped: false,
})

export interface SkyView {
  readonly phi: number
  readonly position: Vec3 // ly from the Sun, galactic axes
  readonly attitude: Quat
  readonly days: number // since launch, galaxy frame: how far the Earth has turned
  readonly exposure: number
  readonly veilLux: number // CMB illuminance to scatter in the eye; 0 for a camera
  readonly eyeZoom: number // user magnification, 1 when not zoomed
  readonly sigmaPx: number
  readonly isEye: boolean // the pilot's eye, which sees no colour in faint light; a camera does
}

export interface Sky {
  /** Advances the galaxy bake; once per frame. `position` in ly from the Sun. */
  update(gl: THREE.WebGLRenderer, position: Vec3, phi: number, dt: number): void
  /** Clears `target` and draws the unresolved Galaxy and the stars. */
  renderStars(gl: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, view: SkyView): void
  /** Adds the blueshifted CMB and its veil. Where `mask` has alpha 1, the hull hides the CMB but not the veil. */
  addCmb(gl: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, view: SkyView, mask?: THREE.Texture): void
  dispose(): void
}

export function createSky(): Sky {
  const lut = new THREE.DataTexture(BLACKBODY_LUT, LUT_SIZE, 1, THREE.RGBAFormat, THREE.FloatType)
  lut.needsUpdate = true
  const bake = createGalaxyBake(1, loadDustMap())
  const lens = createLens()

  const shared = {
    uLut: { value: lut },
    uGamma: { value: 1 },
    uEps: { value: 1 },
    uExposure: { value: NIGHT_EXPOSURE },
    uIsEye: { value: 1 },
  }

  const sphere = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      uniforms: { ...shared, ...uniforms },
      vertexShader: SKY_VERTEX,
      fragmentShader,
      side: THREE.BackSide,
      blending,
      transparent: blending !== THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }))
    mesh.frustumCulled = false
    return mesh
  }

  const basis = { value: new THREE.Matrix3() }
  const galaxySphere = sphere(GALAXY_FRAGMENT, { ...bake.uniforms, ...lens.uniforms, uBasis: basis }, THREE.NoBlending)
  const cmbSphere = sphere(CMB_FRAGMENT, {
    uVeilLux: { value: 0 },
    uEyeZoom: { value: 1 },
    uVeilTint: { value: new THREE.Vector3() },
    uHasMask: { value: 0 },
    uMask: { value: null },
    uResolution: { value: new THREE.Vector2() },
  }, THREE.AdditiveBlending)

  const starUniforms = {
    ...shared,
    uCubeB: bake.uniforms.uCubeB,
    uBasis: basis,
    uFrom: { value: new THREE.Vector3() },
    uPeakPerLux: { value: 1 },
    uSigmaPx: { value: 1 },
  }
  type Stars = THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  /** One set of stars, drawn twice: as they are (or their near images by a hole), and their images beyond a hole. */
  const makeStars = (
    positions: Float32Array, temperatures: Float32Array, radiiSquared: Float32Array, randoms: Float32Array, box: number,
  ): readonly [Stars, Stars] => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aTemperature', new THREE.BufferAttribute(temperatures, 1))
    geometry.setAttribute('aRadiusSquared', new THREE.BufferAttribute(radiiSquared, 1))
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1))
    const uniforms = {
      ...starUniforms, ...lens.uniforms,
      uBox: { value: box }, uThin: { value: box > 0 ? 1 : 0 }, uDust: { value: box > 0 ? 1 : 0 }, uShip: { value: new THREE.Vector3() },
    }
    const drawn = (image: number): Stars => {
      const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uImage: { value: image } },
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }))
      points.frustumCulled = false
      points.renderOrder = 1
      return points
    }
    return [drawn(0), drawn(1)]
  }

  // The synthetic sky leaves the naked-eye stars, as seen from the Sun, to the real catalogue
  const catalog = withoutNakedEyeStars(generateStars(), BRIGHT_LIMIT_V)
  const [stars, starsBeyond] = makeStars(catalog.positions, catalog.temperatures, catalog.radiiSquared, catalog.randoms, STAR_BOX_LY)
  // The real stars, the targets and the naked-eye sky from Hipparcos, are placed relative to the ship on the CPU, in
  // double precision: in float32 a star 25 ly off would jump in steps of a tenth of an AU as the ship closes in on it.
  const realStars = [...STARS, ...BRIGHT_STARS]
  const [neighbours, neighboursBeyond] = makeStars(
    new Float32Array(realStars.length * 3),
    Float32Array.from(realStars, (star) => star.temperature),
    Float32Array.from(realStars, (star) => star.radiusSquared),
    new Float32Array(realStars.length),
    0,
  )
  const globeGeometry = new THREE.SphereGeometry(1, 128, 64)
  const mapOf = (globe: Globe) => (globe === EARTH ? EARTH_MAP : globe === MOON ? MOON_MAP : PLANET_MAPS[globe.name])
  const globes = ALL_GLOBES.map((globe, i) => createGlobe(globe, blackbodyTint, globeGeometry, 2 + i, mapOf(globe)))

  const scene = new THREE.Scene()
  scene.add(galaxySphere, stars, starsBeyond, neighbours, neighboursBeyond, ...globes.flatMap((globe) => (globe.rings ? [globe.mesh, globe.rings] : [globe.mesh])))
  const cmbScene = new THREE.Scene()
  cmbScene.add(cmbSphere)

  const applyCommon = (view: SkyView): void => {
    shared.uGamma.value = gammaOf(view.phi)
    shared.uEps.value = oneMinusBeta(view.phi)
    shared.uExposure.value = view.exposure
    shared.uIsEye.value = view.isEye ? 1 : 0
    galacticToShipMatrix(view.attitude, basis.value)
  }
  const wrap = (x: number): number => x - STAR_BOX_LY * Math.floor(x / STAR_BOX_LY) // keeps float32 precision far out
  const placeNeighbours = (position: Vec3): void => {
    const attribute = neighbours.geometry.getAttribute('position') as THREE.BufferAttribute
    realStars.forEach((star, i) => attribute.setXYZ(i, star.position[0] - position[0], star.position[1] - position[1], star.position[2] - position[2]))
    attribute.needsUpdate = true
  }
  // A hole's star is drawn as its disc while the hole's lens is on, and so not as a point too
  const sizes = neighbours.geometry.getAttribute('aRadiusSquared') as THREE.BufferAttribute
  let hiddenStar: string | null = null
  const hideStar = (name: string | null): void => {
    if (name === hiddenStar) return
    STARS.forEach((star, i) => { if (star.name === hiddenStar || star.name === name) sizes.setX(i, star.name === name ? 0 : star.radiusSquared) })
    sizes.needsUpdate = true
    hiddenStar = name
  }
  const withoutAutoClear = (gl: THREE.WebGLRenderer, draw: () => void): void => {
    const autoClear = gl.autoClear
    gl.autoClear = false
    draw()
    gl.autoClear = autoClear
  }

  return {
    update(gl, position, phi, dt) {
      bake.update(gl, galactocentric(position), phi, dt)
    },
    renderStars(gl, camera, target, view) {
      applyCommon(view)
      const pixelAngle = (2 * Math.tan((camera.fov * Math.PI) / 360)) / target.height
      starUniforms.uPeakPerLux.value = 1 / (2 * Math.PI * view.sigmaPx ** 2 * pixelAngle ** 2)
      starUniforms.uSigmaPx.value = view.sigmaPx
      const { position } = view
      starUniforms.uFrom.value.set(...galactocentric(position))
      stars.material.uniforms.uShip.value.set(wrap(position[0]), wrap(position[1]), wrap(position[2]))
      placeNeighbours(position)
      lens.update(position)
      hideStar(lens.hiddenStar())
      starsBeyond.visible = lens.isOn()
      neighboursBeyond.visible = lens.isOn()
      for (const globe of globes) globe.update(view, pixelAngle)
      // the farthest first, so that the nearer hides it: by Mars it is Mars in front, not the Earth
      const away = (i: number): number => Math.hypot(...ALL_GLOBES[i].position.map((c, k) => c - position[k]))
      globes.map((_, i) => i).sort((a, b) => away(b) - away(a)).forEach((i, rank) => {
        globes[i].mesh.renderOrder = 2 + 2 * rank
        if (globes[i].rings) globes[i].rings.renderOrder = 3 + 2 * rank // over its own planet, under anything nearer
      })
      withoutAutoClear(gl, () => {
        gl.setRenderTarget(target)
        gl.clear()
        gl.render(scene, camera)
      })
    },
    addCmb(gl, camera, target, view, mask) {
      applyCommon(view)
      const uniforms = cmbSphere.material.uniforms
      uniforms.uVeilLux.value = view.veilLux
      uniforms.uEyeZoom.value = view.eyeZoom
      uniforms.uVeilTint.value = blackbodyTint(T_CMB * Math.exp(view.phi)) // D straight ahead is e^φ
      uniforms.uHasMask.value = mask ? 1 : 0
      uniforms.uMask.value = mask ?? null
      uniforms.uResolution.value.set(target.width, target.height)
      withoutAutoClear(gl, () => {
        gl.setRenderTarget(target)
        gl.render(cmbScene, camera)
      })
    },
    dispose() {
      lut.dispose()
      bake.dispose()
      lens.dispose()
      for (const globe of globes) globe.dispose()
      globeGeometry.dispose()
      for (const node of [galaxySphere, cmbSphere, stars, neighbours]) node.geometry.dispose() // the images beyond share it
      for (const node of [galaxySphere, cmbSphere, stars, starsBeyond, neighbours, neighboursBeyond]) node.material.dispose()
    },
  }
}
