import type { Vec3 } from './galaxy'
import { AU_LY, BODIES, equatorialToGalactic, indexOfBody } from './nearbyStars'
import { hillRadius } from './orbit'
import { EARTH_RADIUS_M, GLOBES, LAUNCH_JD, PLANETS, SUN_GM, type Globe } from './solarSystem'

// The planets round the target stars, from the NASA Exoplanet Archive (Planetary Systems Composite Parameters, queried
// November 2026): every confirmed one, except τ Ceti's three, which the archive flags as disputed. Each stands where its
// orbit puts it at launch and stays there, like everything else.
//
// The masses, the planets' (pl_bmasse) and their stars' (st_mass), from the same table, queried 2026-11-11.
// Measured: the period, the size and shape of the orbit, and when the planet passed in front of its star (conjunction)
// or its periastron. Carried over hundreds of orbits to launch, the period's error leaves the place uncertain by 5° to
// 50° along the orbit. For a planet known by its periastron alone, the side of its star it is on also rests on the
// argument of periastron, which the archive gives as each paper did: the planet's own or its star's, 180° apart.
// Chosen, since unmeasured: the tilt of the orbit where it is unknown, 60°, the median for random orientations; for all,
// the node at position angle 0, north, so that each system lies in one plane. Radii of planets found by their star's
// wobble are the archive's estimates from the mass. Their surfaces are unknown: below 1.6 R⊕ they shine as Mercury, bare
// rock; up to 6 R⊕ as Neptune; larger as Jupiter, each with that planet's measured phase law and colour.

export interface Orbit {
  readonly name: string
  readonly host: string // as in BODIES
  readonly period: number // days
  readonly a: number // AU
  readonly e: number
  readonly omega: number // deg: argument of periastron, as published
  readonly conjunction?: number // JD, when it was in front of its star
  readonly periastron?: number // JD, used when there is no conjunction
  readonly inclination?: number // deg, where measured
  readonly radius: number // R⊕
  readonly mass: number // M⊕, as the archive gives it
  readonly isMinimum: boolean // the archive's mass is M sin i, from the star's wobble alone
}

export const ORBITS: readonly Orbit[] = [
  { name: 'Проксима Центавра b', host: 'Проксима Центавра', period: 11.18465, a: 0.04848, e: 0, omega: 3.3, conjunction: 2457897.9, radius: 1.02, mass: 1.055, isMinimum: true },
  { name: 'Проксима Центавра d', host: 'Проксима Центавра', period: 5.12338, a: 0.02881, e: 0, omega: 4, periastron: 2460557.55, radius: 0.692, mass: 0.26, isMinimum: true },
  { name: 'Звезда Барнарда b', host: 'Звезда Барнарда', period: 3.1542, a: 0.0229, e: 0.03, omega: 3.8, conjunction: 2460139.204, radius: 0.72, mass: 0.299, isMinimum: true },
  { name: 'Звезда Барнарда c', host: 'Звезда Барнарда', period: 4.1244, a: 0.0274, e: 0.08, omega: 90.8, periastron: 2460242.92, radius: 0.743, mass: 0.335, isMinimum: true },
  { name: 'Звезда Барнарда d', host: 'Звезда Барнарда', period: 2.3402, a: 0.0188, e: 0.04, omega: -51.8, periastron: 2460243.7, radius: 0.694, mass: 0.263, isMinimum: true },
  { name: 'Звезда Барнарда e', host: 'Звезда Барнарда', period: 6.7392, a: 0.0381, e: 0.04, omega: -27.5, periastron: 2460245.3, radius: 0.637, mass: 0.193, isMinimum: true },
  { name: 'Лаланд 21185 b', host: 'Лаланд 21185', period: 12.9394, a: 0.07879, e: 0.063, omega: -30, conjunction: 2456305.38, radius: 1.45, mass: 2.69, isMinimum: true },
  { name: 'Лаланд 21185 c', host: 'Лаланд 21185', period: 2946, a: 2.94, e: 0.132, omega: 63, conjunction: 2457205, radius: 3.76, mass: 13.6, isMinimum: true },
  { name: 'ε Эридана b', host: 'ε Эридана', period: 2680, a: 3.53, e: 0.06, omega: 268, conjunction: 2457388, inclination: 40, radius: 13.8, mass: 317.83, isMinimum: false },
  { name: 'ε Индейца A b', host: 'ε Индейца', period: 25450, a: 15.76, e: 0.25, omega: -28.13, periastron: 2441420.76, inclination: 102.18, radius: 12.7, mass: 2065.9, isMinimum: false },
]

/** The stars' masses, M☉, from the same table (st_mass). */
const HOST_MASS: Readonly<Record<string, number>> = {
  'Проксима Центавра': 0.1221, 'Звезда Барнарда': 0.162, 'Лаланд 21185': 0.3899, 'ε Эридана': 0.82, 'ε Индейца': 0.8,
}
const EARTH_GM = 3.98600435507e14 // m³/s², as in solarSystem.ts
const AU_M = 1.495978707e11

const DEG = Math.PI / 180
const ASSUMED_INCLINATION = 60 // deg
const ROCK_BELOW = 1.6 // R⊕
const ICE_GIANT_BELOW = 6 // R⊕

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: Vec3): Vec3 => {
  const length = Math.sqrt(dot(a, a))
  return [a[0] / length, a[1] / length, a[2] / length]
}

/** North, east and away from the Sun at a star's place, in galactic axes. */
function skyFrame(position: Vec3): readonly [Vec3, Vec3, Vec3] {
  const away = unit(position)
  const pole = equatorialToGalactic([0, 0, 1])
  const along = dot(pole, away)
  const north = unit([pole[0] - along * away[0], pole[1] - along * away[1], pole[2] - along * away[2]])
  const east: Vec3 = [north[1] * away[2] - north[2] * away[1], north[2] * away[0] - north[0] * away[2], north[0] * away[1] - north[1] * away[0]]
  return [north, east, away]
}

const eccentricAnomaly = (mean: number, e: number): number => {
  let anomaly = mean + e * Math.sin(mean)
  for (let i = 0; i < 30; i++) anomaly -= (anomaly - e * Math.sin(anomaly) - mean) / (1 - e * Math.cos(anomaly))
  return anomaly
}

/** Mean anomaly at `jd`. At conjunction the planet is in front of its star: ω + f = 270°. */
function meanAnomaly(orbit: Orbit, jd: number): number {
  const motion = (2 * Math.PI) / orbit.period
  if (orbit.conjunction !== undefined) {
    const f = 1.5 * Math.PI - orbit.omega * DEG
    const E = 2 * Math.atan(Math.sqrt((1 - orbit.e) / (1 + orbit.e)) * Math.tan(f / 2))
    return E - orbit.e * Math.sin(E) + motion * (jd - orbit.conjunction)
  }
  if (orbit.periastron === undefined) throw new Error(`${orbit.name} has neither a conjunction nor a periastron`)
  return motion * (jd - orbit.periastron)
}

/** Where a planet is at `jd`, ly from the Sun in galactic axes. Its node is at position angle 0, north. */
export function orbitPlace(orbit: Orbit, jd: number): Vec3 {
  const host = BODIES[indexOfBody(orbit.host)].position
  const E = eccentricAnomaly(meanAnomaly(orbit, jd), orbit.e)
  const r = orbit.a * (1 - orbit.e * Math.cos(E)) * AU_LY
  const f = 2 * Math.atan2(Math.sqrt(1 + orbit.e) * Math.sin(E / 2), Math.sqrt(1 - orbit.e) * Math.cos(E / 2))
  const u = orbit.omega * DEG + f
  const tilt = (orbit.inclination ?? ASSUMED_INCLINATION) * DEG
  const [north, east, away] = skyFrame(host)
  const [x, y, z] = [r * Math.cos(u), r * Math.sin(u) * Math.cos(tilt), r * Math.sin(u) * Math.sin(tilt)]
  const at = (k: number): number => host[k] + x * north[k] + y * east[k] + z * away[k]
  return [at(0), at(1), at(2)]
}

const like = (radius: number): Globe => {
  const name = radius < ROCK_BELOW ? 'Меркурий' : radius < ICE_GIANT_BELOW ? 'Нептун' : 'Юпитер'
  const planet = PLANETS.find((globe) => globe.name === name)
  if (!planet) throw new Error(`No ${name} among the planets`)
  return planet
}

/**
 * GM, m³/s². A mass from the wobble alone is M sin i: divided by the sine of the tilt the orbit is drawn with, the
 * measured one or the assumed 60°, so that mass and orbit agree.
 */
const gmOf = (orbit: Orbit): number =>
  (orbit.mass * EARTH_GM) / (orbit.isMinimum ? Math.sin((orbit.inclination ?? ASSUMED_INCLINATION) * DEG) : 1)

/** The air is as unknown as the surface: as deep as on the planet it is drawn like (choice); bare rock has none. */
export const EXOPLANETS: readonly Globe[] = ORBITS.map((orbit) => ({
  name: orbit.name,
  position: orbitPlace(orbit, LAUNCH_JD),
  radiusM: orbit.radius * EARTH_RADIUS_M,
  colour: like(orbit.radius).colour,
  albedo: like(orbit.radius).albedo,
  star: BODIES[indexOfBody(orbit.host)],
  gm: gmOf(orbit),
  hill: hillRadius(orbit.a * AU_M, orbit.e, gmOf(orbit), HOST_MASS[orbit.host] * SUN_GM),
  ceiling: like(orbit.radius).ceiling,
  pattern: orbit.radius < ROCK_BELOW ? 'rock' : orbit.radius < ICE_GIANT_BELOW ? 'ice' : 'gas',
}))

/** Every globe in drawing order: the other stars' planets first, the solar system after, the Earth on top. */
export const ALL_GLOBES: readonly Globe[] = [...EXOPLANETS, ...GLOBES]
