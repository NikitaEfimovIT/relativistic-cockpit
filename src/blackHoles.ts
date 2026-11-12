import { LAUNCH_JD, equatorialDirection, equatorialToGalactic, galacticDirection, skyFrame } from './coords'
import { diskT4, peakT4 } from './disk'
import { KPC_LY, SUN, type Vec3 } from './galaxy'
import { C, G0, LY } from './physics'

// The black holes a flight can be aimed at. Schwarzschild, without spin: Kerr is a later step. The ship parks at rest
// beside one, as it does by a star: a convention, since hovering there would take a thrust beyond any engine.

const SUN_GM = 1.32712440041279419e20 // m³/s², as in solarSystem.ts (which imports the bodies, and so could not be imported here)
const R_SUN_M = 6.957e8 // IAU 2015 B3
const DAY = 86_400
const DEG = Math.PI / 180

/** A thin disk round the hole, in its plane; the gas goes round `axis` right-handed. */
export interface Disk {
  readonly outer: number // r_s
  readonly t4: number // K⁴ per unit of thinDiskFlux (disk.ts)
  readonly axis: Vec3 // unit, galactic axes
}

/** A star in orbit about the hole, drawn as a disc while the hole's lens is on. */
export interface Companion {
  readonly name: string // as in BODIES
  readonly position: Vec3 // ly from the Sun, galactic axes, at launch
  readonly radius: number // m, its true size, for its disc by the hole
  readonly temperature: number // K
  readonly v: number // apparent V magnitude from the Earth, its dust in it, for the star in the catalogue's way
}

export interface Hole {
  readonly body: string // its place in BODIES
  readonly name: string // as the instruments call it
  readonly mass: number // M☉
  readonly parking: number // r_s from its centre, at least the tidal limit
  readonly position: Vec3 // ly from the Sun, galactic axes
  readonly disk: Disk | null
  readonly companion: Companion | null
}

/** m: 2GM/c². */
export const schwarzschildRadius = (mass: number): number => (2 * mass * SUN_GM) / (C * C)

const add = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a))
/** The part of `a` across unit `k`, made unit. */
const across = (a: Vec3, k: Vec3): Vec3 => unit(add(a, k, -dot(a, k)))

// ── Sgr A* ──────────────────────────────────────────────────────────────────────

// GRAVITY Collaboration 2022 (A&A 657, L12): 4.297 ± 0.012 ± 0.040 million Suns, at 8.277 kpc. It stands at the centre of
// the model Galaxy, 8.2 kpc off. Parked at 10 r_s (choice) the shadow spans 28.5° and the clock aboard runs at 0.949.
// Its glow is left out: in visible light no one has seen it (the dust in front dims it by some 30 magnitudes).
const SGR_A: Hole = {
  body: 'Центр Галактики', name: 'Sgr A*', mass: 4.297e6, parking: 10,
  position: [-SUN[0] * KPC_LY, -SUN[1] * KPC_LY, -SUN[2] * KPC_LY], disk: null, companion: null,
}

// ── Cygnus X-1 ──────────────────────────────────────────────────────────────────

// Miller-Jones et al. 2021 (Science 371, 1046): 21.2 ± 2.2 Suns, 2.22 kpc, the orbit tilted 27.5° to the line of sight,
// the supergiant 40.6 Suns, about 22 R☉ and 31 000 K. Position of HD 226868 from SIMBAD. Later analyses (2025) put the
// masses lower, 13.8–17.5 Suns for the hole, and the tilt at 33.7°. V ≈ 8.9 (Hadrava 2007, arXiv 0710.0758).
const CYG = { ra: 299.5903036, dec: 35.2015903, kpc: 2.22, mass: 21.2, starMass: 40.6, starRadius: 22 * R_SUN_M, starT: 31_000, starV: 8.9 }
// The orbit: P = 5.599829 d (Brocksopp et al. 1999), the hole furthest from us at MJD 50077.973; it turns clockwise on the
// sky, and its axis lies at position angle ≈ 88–131° (arXiv 2304.07553; 110° taken, the convention unchecked). The disk
// lies in the plane of the orbit (choice: that paper finds signs the hole's spin, and so its inner disk, are tilted).
const ORBIT = { period: 5.599829 * DAY, t0: 50_077.973 + 2_400_000.5, tilt: 27.5, positionAngle: 110 }
// Its glow, 2.1·10³⁷ erg/s averaged over time (Orosz et al. 2011, at 1.86 kpc), taken to 2.22 kpc; a disk without spin
// turns 1 − √(8/9) = 5.7 % of the mass it swallows into light. No X-rays, no corona, no inner disk cut short as in the
// hard state: a plain thin disk all the way in.
const CYG_GLOW_W = 2.1e30 * (2.22 / 1.86) ** 2
const EFFICIENCY = 1 - Math.sqrt(8 / 9)
/** The disk reaches this share of the hole's Roche lobe (choice: the tidal limit of a disk is 0.6–0.9 of it). */
const DISK_IN_LOBE = 0.7

/** The Roche lobe of a body of mass ratio q to its partner, over the separation (Eggleton 1983). */
const rocheLobe = (q: number): number => (0.49 * q ** (2 / 3)) / (0.6 * q ** (2 / 3) + Math.log(1 + q ** (1 / 3)))

const CYG_X1: Hole = (() => {
  const position = scale(equatorialToGalactic(equatorialDirection(CYG.ra, CYG.dec)), CYG.kpc * KPC_LY)
  const [north, east, away] = skyFrame(position)
  const onSky = add(scale(north, Math.cos(ORBIT.positionAngle * DEG)), east, Math.sin(ORBIT.positionAngle * DEG))
  // clockwise on our sky: the orbit's angular momentum points away from us
  const axis = unit(add(scale(away, Math.cos(ORBIT.tilt * DEG)), onSky, Math.sin(ORBIT.tilt * DEG)))
  const separation = Math.cbrt((SUN_GM * (CYG.mass + CYG.starMass) * ORBIT.period ** 2) / (4 * Math.PI ** 2)) // m
  // At t0 the hole is furthest from us: the star lies on our side of it. From there it moves on round the axis.
  const start = across(scale(away, -1), axis)
  const phase = 2 * Math.PI * ((LAUNCH_JD - ORBIT.t0) * DAY / ORBIT.period)
  const toStar = add(scale(start, Math.cos(phase)), cross(axis, start), Math.sin(phase))
  const rs = schwarzschildRadius(CYG.mass)
  return {
    body: 'Лебедь X-1', name: 'Лебедь X-1', mass: CYG.mass, parking: 0, position,
    disk: { outer: (DISK_IN_LOBE * rocheLobe(CYG.mass / CYG.starMass) * separation) / rs, t4: diskT4(rs, CYG_GLOW_W / (EFFICIENCY * C * C)), axis },
    companion: { name: 'HD 226868', position: add(position, toStar, separation / LY), radius: CYG.starRadius, temperature: CYG.starT, v: CYG.starV },
  }
})()

// ── Invented ────────────────────────────────────────────────────────────────────

// Not a real hole: a hundred million Suns, as Gargantua in the film, put 1 500 ly off above the plane of the Galaxy (choice)
// so that it is in reach. Its disk, 6000 K at its hottest and out to 15 r_s, is seen nearly edge on from the Sun's side:
// its axis 85° to the line of sight, tipped towards galactic north, so the near side shows its top face. All choices.
const INVENTED_PLACE = { l: 30, b: 25, ly: 1500, tilt: 85 }
const INVENTED: Hole = (() => {
  const towards = galacticDirection(INVENTED_PLACE.l, INVENTED_PLACE.b)
  const up = across([0, 0, 1], towards)
  const axis = add(scale(towards, -Math.cos(INVENTED_PLACE.tilt * DEG)), up, Math.sin(INVENTED_PLACE.tilt * DEG))
  return {
    body: 'Безымянная', name: 'Безымянная', mass: 1e8, parking: 25, position: scale(towards, INVENTED_PLACE.ly),
    disk: { outer: 15, t4: peakT4(6000), axis }, companion: null,
  }
})()

export const HOLES: readonly Hole[] = [INVENTED, CYG_X1, SGR_A]

/** The hole at a place in BODIES. */
export function holeAt(body: string): Hole {
  const hole = HOLES.find((h) => h.body === body)
  if (!hole) throw new Error(`No black hole at ${body}`)
  return hole
}

// A body stretched by more than this across its length dies (choice: about what a pilot survives briefly, head to foot).
const TIDE_LIMIT = 10 * G0 // m/s²
const BODY_LENGTH = 2 // m

/** m: where the stretch 2GM·L/r³ across a body reaches the limit. */
export const tidalRadius = (mass: number): number => Math.cbrt((2 * mass * SUN_GM * BODY_LENGTH) / TIDE_LIMIT)

/** m: nearer than this the ship is lost, to the tides or, inside the photon sphere, to the hole, which no view survives. */
export const wreckRadius = (mass: number): number => Math.max(1.5 * schwarzschildRadius(mass), tidalRadius(mass))

/** m from the centre where the ship stops. */
export const parkingRadius = (hole: Hole): number => Math.max(hole.parking * schwarzschildRadius(hole.mass), tidalRadius(hole.mass))

/** Ship seconds per far-away second for a ship at rest at r: √(1 − r_s/r). */
export const clockRate = (rs: number, r: number): number => Math.sqrt(1 - rs / r)

/** The innermost stable orbit, where a thin disk ends: 3 r_s. */
export const DISK_INNER = 3

