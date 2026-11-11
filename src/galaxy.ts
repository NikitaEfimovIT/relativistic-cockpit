import { C, H, forwardIlluminance, lutXYZ, magnitudeToIlluminance } from './physics'

// A smooth model of the Milky Way in galactic coordinates: kpc, X from the Sun towards the centre, Y along
// the rotation, Z to the north pole, centre at the origin. The GLSL below mirrors the TypeScript functions
// so that the published numbers can be tested here. Turbulence is added on top in galaxyBake.ts.

export const KPC_LY = 3261.56
export type Vec3 = readonly [number, number, number]

const DEG = Math.PI / 180

export const R_SUN = 8.2 // Bland-Hawthorn & Gerhard 2016
export const SUN: Vec3 = [-R_SUN, 0, 0.025]
const THIN_LENGTH = 2.6
const THIN_HEIGHT = 0.3
const THICK_LENGTH = 2.0
const THICK_HEIGHT = 0.9
const THICK_FRACTION = 0.04
const INNER_CORE = 2.5 // ponytail: the exponential stops growing here, instead of modelling the bar's inner hole

const RHO_V = 0.056 // L☉/pc³, Flynn et al. 2006
const YOUNG_FRACTION = 0.473 // of local V light, so that the column comes to Flynn's Σ_L = 24.4 L☉/pc²
const YOUNG_HEIGHT = 0.1

const BAR_ANGLE = 27 * DEG // Bland-Hawthorn & Gerhard 2016
const BULGE_SCALES: Vec3 = [1.5, 0.6, 0.4] // kpc; assumption, a triaxial Gaussian of about the published shape
const BULGE_LIGHT = 5e9 // L☉, V: 1.5·10¹⁰ M☉ (Bland-Hawthorn & Gerhard 2016) at an assumed M/L_V = 3
const BULGE_CENTRE = BULGE_LIGHT / ((2 * Math.PI) ** 1.5 * BULGE_SCALES[0] * BULGE_SCALES[1] * BULGE_SCALES[2] * 1e9)

const BV_OLD = 0.85
const BV_YOUNG = 0
const BV_BULGE = 1

const DUST_LOCAL = 1 // A_V, mag/kpc in the plane
const DUST_LENGTH = 2.26 // Drimmel & Spergel 2001
const DUST_HEIGHT = 0.188 // Drimmel & Spergel 2001, at the Solar Circle
const DUST_CORE = 4 // the dust disc has a central hole; tested against ~30 mag to the centre

const ARM_COUNT = 4 // Drimmel & Spergel 2001, Reid et al. 2019
const ARM_TAN_PITCH = Math.tan(12 * DEG) // Reid et al. 2019 fit 9–17° depending on the arm
const ARM_PHASE = -Math.PI / 4 // puts the Sun between the Sagittarius and Perseus arms
const ARM_POWER = 3

const sech2 = (x: number): number => 1 / Math.cosh(Math.min(Math.abs(x), 12)) ** 2
const radial = (R: number, length: number): number => Math.exp(-(Math.max(R, INNER_CORE) - R_SUN) / length)

function armField([x, y]: Vec3): number {
  const R = Math.hypot(x, y)
  const beta = Math.atan2(y, -x)
  const spiral = (0.5 + 0.5 * Math.cos(ARM_COUNT * (beta + Math.log(Math.max(R, 0.5) / R_SUN) / ARM_TAN_PITCH - ARM_PHASE))) ** ARM_POWER
  const local = 0.8 * Math.exp(-0.5 * ((R - 8.35) / 0.25) ** 2) * Math.exp(-0.5 * ((beta - 0.05) / 0.35) ** 2) // Local arm
  return Math.max(spiral, local)
}

const ARM_AT_SUN = armField([-R_SUN, 0, 0])
const youngBoost = (arm: number): number => (0.3 + 2.24 * arm) / (0.3 + 2.24 * ARM_AT_SUN)
const dustBoost = (arm: number): number => (0.5 + 1.5 * arm) / (0.5 + 1.5 * ARM_AT_SUN)

const oldLight = (g: Vec3): number => {
  const R = Math.hypot(g[0], g[1])
  return (1 - YOUNG_FRACTION) * RHO_V * (
    (1 - THICK_FRACTION) * radial(R, THIN_LENGTH) * sech2(g[2] / THIN_HEIGHT)
    + THICK_FRACTION * radial(R, THICK_LENGTH) * sech2(g[2] / THICK_HEIGHT))
}

const youngLight = (g: Vec3): number =>
  YOUNG_FRACTION * RHO_V * radial(Math.hypot(g[0], g[1]), THIN_LENGTH) * sech2(g[2] / YOUNG_HEIGHT) * youngBoost(armField(g))

const bulgeLight = ([x, y, z]: Vec3): number => {
  const [cos, sin] = [Math.cos(BAR_ANGLE), Math.sin(BAR_ANGLE)]
  const [along, across] = [x * cos - y * sin, x * sin + y * cos]
  const [a, b, c] = BULGE_SCALES
  return BULGE_CENTRE * Math.exp(-0.5 * ((along / a) ** 2 + (across / b) ** 2 + (z / c) ** 2))
}

/** V and B light of the stars at a point, L☉/pc³ with B on the same scale as V at B−V = 0. */
export function stellarLight(g: Vec3): { readonly v: number; readonly b: number } {
  const [old, young, bulge] = [oldLight(g), youngLight(g), bulgeLight(g)]
  return {
    v: old + young + bulge,
    b: old * 10 ** (-0.4 * BV_OLD) + young * 10 ** (-0.4 * BV_YOUNG) + bulge * 10 ** (-0.4 * BV_BULGE),
  }
}

/** Mean V extinction per unit path, mag/kpc. */
export const dustDensity = (g: Vec3): number =>
  DUST_LOCAL * Math.exp(-(Math.max(Math.hypot(g[0], g[1]), DUST_CORE) - R_SUN) / DUST_LENGTH)
  * sech2(g[2] / DUST_HEIGHT) * dustBoost(armField(g))

/** cd/m² for a column of 1 L☉/pc²: the Sun's V = M_V at 10 pc spread over one pc² of area. */
export const COLUMN_TO_LUMINANCE = 100 * magnitudeToIlluminance(4.83)
const EXTINCTION_B_OVER_V = 1.32 // Cardelli et al. 1989, R_V = 3.1
const EXTINCTION_TO_OPTICAL_DEPTH = 0.4 * Math.LN10

/** Half the star box: nearer than this, the bright stars are drawn one by one and are not part of the glow. */
export const RESOLVED_RADIUS_KPC = 1500 / KPC_LY
/** Faint dwarfs below the catalog's mass limit, as a share of the disc's V light (estimate); they stay a glow. */
export const UNRESOLVED_FRACTION = 0.35
const smoothstep = (low: number, high: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

export interface Sightline {
  readonly luminanceV: number // cd/m²
  readonly luminanceB: number
  readonly extinctionV: number // mag
}

/** The smooth model integrated along a ray. The bake does this per texel, with turbulence on top. */
export function sightline(from: Vec3, direction: Vec3, maxKpc: number = 40, withoutResolved: boolean = false): Sightline {
  let [v, b, extinction, s] = [0, 0, 0, 0.002]
  while (s < maxKpc) {
    const ds = Math.max(0.002, 0.01 * s)
    const g: Vec3 = [from[0] + direction[0] * (s + ds / 2), from[1] + direction[1] * (s + ds / 2), from[2] + direction[2] * (s + ds / 2)]
    const light = stellarLight(g)
    const share = withoutResolved
      ? UNRESOLVED_FRACTION + (1 - UNRESOLVED_FRACTION) * smoothstep(0.8 * RESOLVED_RADIUS_KPC, RESOLVED_RADIUS_KPC, s)
      : 1
    v += share * light.v * ds * 1000 * Math.exp(-EXTINCTION_TO_OPTICAL_DEPTH * extinction)
    b += share * light.b * ds * 1000 * Math.exp(-EXTINCTION_TO_OPTICAL_DEPTH * EXTINCTION_B_OVER_V * extinction)
    extinction += dustDensity(g) * ds
    s += ds
  }
  return { luminanceV: v * COLUMN_TO_LUMINANCE, luminanceB: b * COLUMN_TO_LUMINANCE, extinctionV: extinction }
}

/** Colour temperature from B−V: Ballesteros 2012, eq. 14. */
export const colourTemperature = (bv: number): number => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
/** Reddening a star by E(B−V) moves its 1/T by this much per magnitude: the mean slope of eq. 14. */
export const COLOUR_EXCESS_SLOPE = 1.12e-4

// Hα from recombination: 4πj = n_e n_p α_eff hν, with α_eff = 1.17·10⁻¹³ cm³/s at 10⁴ K (Osterbrock & Ferland 2006).
const ALPHA_HALPHA = 1.17e-13
const PC_CM = 3.0857e18
const PHOTONS_PER_EM = (ALPHA_HALPHA * PC_CM) / (4 * Math.PI) // photons cm⁻² s⁻¹ sr⁻¹ per pc cm⁻⁶
export const EM_PER_RAYLEIGH = 1e6 / (4 * Math.PI) / PHOTONS_PER_EM
const HALPHA_PHOTON_J = (H * C) / 656.3e-9
/** Hα radiance, W·m⁻²·sr⁻¹, for an emission measure of 1 pc·cm⁻⁶. */
export const HALPHA_RADIANCE_PER_EM = PHOTONS_PER_EM * 1e4 * HALPHA_PHOTON_J

/** A place given in ly from the Sun along the galactic axes, as the model's galactocentric kpc. */
export const galactocentric = (fromSunLy: Vec3): Vec3 =>
  [SUN[0] + fromSunLy[0] / KPC_LY, SUN[1] + fromSunLy[1] / KPC_LY, SUN[2] + fromSunLy[2] / KPC_LY]

export const HOT_STAR_K = 7500
const OLD_LOCAL = oldLight([-R_SUN, 0, 0])
const YOUNG_LOCAL = youngLight([-R_SUN, 0, 0])
export const starDensityRatio = (g: Vec3, temperature: number): number =>
  temperature > HOT_STAR_K ? youngLight(g) / YOUNG_LOCAL : (oldLight(g) + bulgeLight(g)) / OLD_LOCAL

/** The catalog holds this many times the local density, so the inner disc can be denser than the Sun's. */
export const DENSITY_CAP = 1.6
/** Thinning a uniform catalog by this probability yields a Poisson process with the model's density. */
export const starAcceptance = (ratio: number): number => Math.min(1, ratio / DENSITY_CAP)

// The sky as the exposure meter sees it: a uniform diluted blackbody of the starlight's colour and mean brightness.
const STARLIGHT_T = 5000
const STARLIGHT_MEAN_LUMINANCE = 1.5e-4 // cd/m²; the band is ~4·10⁻⁴ and the pole ~4·10⁻⁵
const STARLIGHT_DILUTION = STARLIGHT_MEAN_LUMINANCE / lutXYZ(STARLIGHT_T)[1]
/** What aberration and blueshift add to the light on a forward-facing eye, over the night sky it adapted to. */
export const starlightExcess = (phi: number): number =>
  STARLIGHT_DILUTION * Math.max(0, forwardIlluminance(phi, STARLIGHT_T) - forwardIlluminance(0, STARLIGHT_T))

const float = (x: number): string => x.toFixed(8)

export const BLUE_PER_VISUAL = { old: 10 ** (-0.4 * BV_OLD), young: 10 ** (-0.4 * BV_YOUNG), bulge: 10 ** (-0.4 * BV_BULGE) } as const

/** The same smooth model for the shaders. */
export const GALAXY_GLSL = /* glsl */ `
const float R_SUN = ${float(R_SUN)};
float sech2(float x) { float c = cosh(min(abs(x), 12.)); return 1. / (c * c); }
float radialFall(float R, float len) { return exp(-(max(R, ${float(INNER_CORE)}) - R_SUN) / len); }
float armField(vec3 g) {
  float R = length(g.xy);
  float beta = atan(g.y, -g.x);
  float spiral = pow(.5 + .5 * cos(${float(ARM_COUNT)} * (beta + log(max(R, .5) / R_SUN) / ${float(ARM_TAN_PITCH)} - (${float(ARM_PHASE)}))), ${float(ARM_POWER)});
  float a = (R - 8.35) / .25, b = (beta - .05) / .35;
  return max(spiral, .8 * exp(-.5 * (a * a + b * b)));
}
float youngBoost(float arm) { return (.3 + 2.24 * arm) / ${float(0.3 + 2.24 * ARM_AT_SUN)}; }
float dustBoost(float arm) { return (.5 + 1.5 * arm) / ${float(0.5 + 1.5 * ARM_AT_SUN)}; }
float oldLight(vec3 g) {
  float R = length(g.xy);
  return ${float((1 - YOUNG_FRACTION) * RHO_V)} * (${float(1 - THICK_FRACTION)} * radialFall(R, ${float(THIN_LENGTH)}) * sech2(g.z / ${float(THIN_HEIGHT)})
    + ${float(THICK_FRACTION)} * radialFall(R, ${float(THICK_LENGTH)}) * sech2(g.z / ${float(THICK_HEIGHT)}));
}
float youngLight(vec3 g, float arm) {
  return ${float(YOUNG_FRACTION * RHO_V)} * radialFall(length(g.xy), ${float(THIN_LENGTH)}) * sech2(g.z / ${float(YOUNG_HEIGHT)}) * youngBoost(arm);
}
float bulgeLight(vec3 g) {
  float along = g.x * ${float(Math.cos(BAR_ANGLE))} - g.y * ${float(Math.sin(BAR_ANGLE))};
  float across = g.x * ${float(Math.sin(BAR_ANGLE))} + g.y * ${float(Math.cos(BAR_ANGLE))};
  vec3 q = vec3(along, across, g.z) / vec3(${float(BULGE_SCALES[0])}, ${float(BULGE_SCALES[1])}, ${float(BULGE_SCALES[2])});
  return ${float(BULGE_CENTRE)} * exp(-.5 * dot(q, q));
}
float dustDensity(vec3 g, float arm) {
  return ${float(DUST_LOCAL)} * exp(-(max(length(g.xy), ${float(DUST_CORE)}) - R_SUN) / ${float(DUST_LENGTH)}) * sech2(g.z / ${float(DUST_HEIGHT)}) * dustBoost(arm);
}
float starDensityRatio(vec3 g, float temperature) {
  return temperature > ${float(HOT_STAR_K)}
    ? youngLight(g, armField(g)) / ${float(YOUNG_LOCAL)}
    : (oldLight(g) + bulgeLight(g)) / ${float(OLD_LOCAL)};
}`
