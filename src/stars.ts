import { DENSITY_CAP } from './galaxy'
import { LY, illuminanceToMagnitude, lutXYZ } from './physics'

// ponytail: synthetic catalog in a periodic box instead of HYG/BSC. The ship covers ~690 ly in the
// run-up and ~60 ly per real second at cruise, far beyond where an Earth-centred catalog has stars.
// The box only supplies candidates: the star shader keeps each by the model's density at its true place.
export const STAR_BOX_LY = 3000
/** 1.13·10⁻⁵ candidates per ly³ at the local density, which reproduces the ~5000 stars with V < 6. */
export const STAR_COUNT = Math.round(1.13e-5 * STAR_BOX_LY ** 3 * DENSITY_CAP)

const R_SUN_LY = 6.957e8 / LY
const T_SUN = 5772
const MASS_MIN = 1.5 // lighter stars are far below naked-eye brightness at these distances
const MASS_MAX = 31
const GIANT_FRACTION = 0.12

/** Inside this distance from the Sun the sky has the table in nearbyStars.ts, which holds every star above 1.5 M☉. */
const REAL_NEIGHBOURS_LY = 30

const CLUSTER_COUNT = 500
export const CLUSTER_MEMBERS = 60
const CLUSTER_RADIUS_LY: readonly [number, number] = [5, 25]

/** Eker et al. 2018, tables 4 and 5: log L = α log M + β, valid up to each upper mass. */
const MLR: ReadonlyArray<readonly [number, number, number]> = [
  [2.4, 4.329, 0.01],
  [7, 3.967, 0.093],
  [31, 2.865, 1.105],
]

export interface MainSequenceStar {
  readonly luminosity: number // L☉
  readonly temperature: number // K
}

export function mainSequence(mass: number): MainSequenceStar {
  const logM = Math.log10(mass)
  const [, alpha, beta] = MLR.find(([upper]) => mass <= upper) ?? MLR[MLR.length - 1]
  return {
    luminosity: 10 ** (alpha * logM + beta),
    temperature: 10 ** (-0.17 * logM * logM + 0.888 * logM + 3.671),
  }
}

/** Stefan–Boltzmann: R² in ly², from L in L☉ and T in K. */
export const radiusSquaredLy = (luminosity: number, temperature: number): number =>
  R_SUN_LY ** 2 * luminosity * (T_SUN / temperature) ** 4

/** Illuminance in lx at `distance` ly, in the star's rest frame: E = Y(T)·πR²/d². */
export const starIlluminance = (temperature: number, radiusSquared: number, distance: number): number =>
  (lutXYZ(temperature)[1] * Math.PI * radiusSquared) / (distance * distance)

export const mulberry32 = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * Inverse-CDF table for the present-day mass function: Kroupa 2001 IMF (α = 2.3) times the
 * main-sequence lifetime τ ∝ M/L, since short-lived massive stars are rarer than they are born.
 */
const MASS_CDF: ReadonlyArray<readonly [number, number]> = (() => {
  const STEPS = 400
  const ratio = (MASS_MAX / MASS_MIN) ** (1 / STEPS)
  let total = 0
  const table: Array<readonly [number, number]> = []
  for (let i = 0; i <= STEPS; i++) {
    const mass = MASS_MIN * ratio ** i
    total += mass ** -2.3 * (mass / mainSequence(mass).luminosity) * mass // dM ∝ M d(ln M)
    table.push([mass, total])
  }
  return table.map(([mass, cum]) => [mass, cum / total] as const)
})()

const sampleMass = (u: number): number => (MASS_CDF.find(([, cum]) => cum >= u) ?? MASS_CDF[MASS_CDF.length - 1])[0]

export interface StarCatalog {
  readonly positions: Float32Array // ly, 3 per star, in [-box/2, box/2]
  readonly temperatures: Float32Array // K
  readonly radiiSquared: Float32Array // ly²
  readonly randoms: Float32Array // in [0, 1), compared with the model's density to keep or drop the star
}

const wrap = (x: number): number => x - STAR_BOX_LY * Math.round(x / STAR_BOX_LY)

export function generateStars(count: number = STAR_COUNT, seed: number = 42): StarCatalog {
  const random = mulberry32(seed)
  const uniform = (): number => (random() - 0.5) * STAR_BOX_LY
  const gaussian = (): number => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  const positions = new Float32Array(count * 3)
  const temperatures = new Float32Array(count)
  const radiiSquared = new Float32Array(count)
  const randoms = new Float32Array(count)
  let cluster: readonly [number, number, number, number] = [0, 0, 0, 0]
  const clustered = Math.min(count, CLUSTER_COUNT * CLUSTER_MEMBERS)
  for (let i = 0; i < count; i++) {
    const isClustered = i < clustered
    if (isClustered && i % CLUSTER_MEMBERS === 0) {
      const [low, high] = CLUSTER_RADIUS_LY
      cluster = [uniform(), uniform(), uniform(), low + (high - low) * random()]
    }
    positions[i * 3] = isClustered ? wrap(cluster[0] + gaussian() * cluster[3]) : uniform()
    positions[i * 3 + 1] = isClustered ? wrap(cluster[1] + gaussian() * cluster[3]) : uniform()
    positions[i * 3 + 2] = isClustered ? wrap(cluster[2] + gaussian() * cluster[3]) : uniform()
    // ponytail: giants as a flat K-giant population, not evolutionary tracks; they only set sky colour balance
    const isGiant = !isClustered && random() < GIANT_FRACTION
    const star = isGiant
      ? { luminosity: 40 * 37.5 ** random(), temperature: 3700 + 1300 * random() }
      : mainSequence(sampleMass(random()))
    temperatures[i] = star.temperature
    radiiSquared[i] = radiusSquaredLy(star.luminosity, star.temperature)
    const isNearSun = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]) < REAL_NEIGHBOURS_LY
    randoms[i] = isNearSun ? Infinity : random() // the real neighbours stand there instead; Infinity is never kept
  }
  return { positions, temperatures, radiiSquared, randoms }
}

/**
 * The catalogue less every star brighter than `limitV` seen from the Sun: a real catalogue stands there instead. A new
 * catalogue; the one given is left as it is. Their periodic images far away go too, under 2 % of the stars.
 * ponytail: judged without dust, so a few stars just past the limit behind thick dust go as well.
 */
export function withoutNakedEyeStars(catalog: StarCatalog, limitV: number): StarCatalog {
  const { positions, temperatures, radiiSquared } = catalog
  const randoms = catalog.randoms.map((random, i) => {
    const distance = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    return illuminanceToMagnitude(starIlluminance(temperatures[i], radiiSquared[i], distance)) < limitV ? Infinity : random
  })
  return { ...catalog, randoms }
}
