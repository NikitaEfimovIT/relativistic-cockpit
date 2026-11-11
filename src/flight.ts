// Flight by a body: the ship below 30 km/s, off its light-mode legs, pulled by the one body whose Hill sphere it is in
// (the smallest, where they nest: the Moon's inside the Earth's). Outside every sphere nothing pulls it: the bodies stand
// still, so the ship rests in the frame that falls with the planet, where the star's pull is a tide (choice, FORMULAS.md).
// The place is kept in metres from the body, not in light years, so that orbits by far stars do not round off.
import { flowOf, shipMass, thrustOf, type Propulsion } from './chemical'
import { ALL_GLOBES } from './exoplanets'
import type { Vec3 } from './galaxy'
import { burn, elementsOf, impactTime, propagate, type Elements, type State } from './orbit'
import { LY } from './physics'
import type { Globe } from './solarSystem'
import { forwardOf, type Course, type Quat } from './voyage'

/** Below this the ship flies by bodies, not on a leg: at 30 km/s the sky's aberration is 20″, too small to see (choice). */
export const LOCAL_BETA = 1e-4

export interface Local {
  readonly centre: number | null // index into ALL_GLOBES of the body that pulls; null outside every Hill sphere
  readonly base: Vec3 // ly, galactic: the body's centre, or with none the point the ship was at when it left the last
  readonly r: Vec3 // m from `base`, galactic axes
  readonly v: Vec3 // m/s
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const length = (a: Vec3): number => Math.sqrt(dot(a, a))

/** ly, galactic: where the ship is. */
export const localPosition = (l: Local): Vec3 => add(l.base, scale(l.r, 1 / LY))

/** The body that pulls a ship at `position`: the smallest Hill sphere it is in, or none. */
export function centreAt(position: Vec3): number | null {
  let best: number | null = null
  ALL_GLOBES.forEach((globe, i) => {
    if (length(sub(position, globe.position)) * LY >= globe.hill) return
    if (best === null || globe.hill < ALL_GLOBES[best].hill) best = i
  })
  return best
}

/** The same ship measured from another centre; with none, from where it is now. */
export function rebased(l: Local, centre: number | null): Local {
  const base = centre === null ? localPosition(l) : ALL_GLOBES[centre].position
  return { centre, base, r: add(scale(sub(l.base, base), LY), l.r), v: l.v }
}

/** A ship at `position` (ly) moving at `v` (m/s), measured from the body that pulls it there. */
export const localAt = (position: Vec3, v: Vec3): Local => rebased({ centre: null, base: position, r: [0, 0, 0], v }, centreAt(position))

const gmOf = (l: Local): number => (l.centre === null ? 0 : ALL_GLOBES[l.centre].gm)
/** m from the centre at which the ship strikes: the top of the air, or the ground. */
const floorOf = (globe: Globe): number => globe.radiusM + globe.ceiling

/**
 * The flight begins on a circular orbit through the course's origin, round the body that pulls there, moving in the
 * plane of the nose and that body: ahead, and away from the side the body is on.
 */
export function launchLocal(course: Course): Local {
  const local = localAt(course.origin, [0, 0, 0])
  if (local.centre === null) return local
  const forward = forwardOf(course.attitude)
  const out = scale(local.r, 1 / length(local.r))
  const along = sub(forward, scale(out, dot(forward, out)))
  const speed = Math.sqrt(gmOf(local) / length(local.r))
  return { ...local, v: scale(along, speed / length(along)) }
}

export interface LocalStep {
  readonly local: Local
  readonly propulsion: Propulsion
  readonly isWrecked: boolean
}

/** Coasts `dt`, stopping where the ship strikes the body, if it does. */
function coast(l: Local, dt: number): { readonly state: State; readonly isWrecked: boolean } {
  const gm = gmOf(l)
  const state = { r: l.r, v: l.v }
  if (l.centre === null) return { state: propagate(state, 0, dt), isWrecked: false }
  const strike = impactTime(state, gm, dt, floorOf(ALL_GLOBES[l.centre]))
  return { state: propagate(state, gm, strike ?? dt), isWrecked: strike !== null }
}

/**
 * `dt` ship seconds by a body: the chemical engine pushing along the nose while it burns and has propellant, then a coast.
 * ponytail: the strike is looked for at the end of a burn only, not inside it; the clock is held to ×60 while it burns.
 */
export function stepLocal(l: Local, p: Propulsion, attitude: Quat, dt: number, isBurning: boolean): LocalStep {
  const flow = flowOf(p)
  const burnTime = isBurning && flow > 0 ? Math.min(dt, p.propellant / flow) : 0
  const pushed = burnTime > 0
    ? burn({ r: l.r, v: l.v }, gmOf(l), burnTime, { direction: forwardOf(attitude), force: thrustOf(p), mass: shipMass(p), flow })
    : null
  const propulsion = pushed ? { ...p, propellant: Math.max(0, p.propellant - flow * burnTime) } : p
  const afterBurn: Local = pushed ? { ...l, r: pushed.state.r, v: pushed.state.v } : l
  const isBurntIn = pushed !== null && l.centre !== null && length(afterBurn.r) <= floorOf(ALL_GLOBES[l.centre])
  const { state, isWrecked } = isBurntIn ? { state: afterBurn, isWrecked: true } : coast(afterBurn, dt - burnTime)
  const moved: Local = { ...afterBurn, r: state.r, v: state.v }
  const centre = centreAt(localPosition(moved))
  return { local: centre === moved.centre ? moved : rebased(moved, centre), propulsion, isWrecked }
}

export interface OrbitView {
  readonly globe: Globe
  readonly altitude: number // m above the ground
  readonly speed: number // m/s relative to the body
  readonly elements: Elements
}

/** The orbit round the body that pulls, for the instruments; null where none does. */
export function orbitOf(l: Local): OrbitView | null {
  if (l.centre === null) return null
  const globe = ALL_GLOBES[l.centre]
  return { globe, altitude: length(l.r) - globe.radiusM, speed: length(l.v), elements: elementsOf({ r: l.r, v: l.v }, globe.gm) }
}

const APPROACH_SAMPLES = 256
const OPEN_HORIZON = 60 * 86_400 // s looked ahead on an open orbit, or with nothing pulling: choice
/** On a closed orbit the clock lets a revolution take no less than this many real seconds: choice. */
export const ORBIT_REAL_S = 30
/** A strike ahead comes closer by no more than a factor e every 1/this real seconds, as the brake point does (voyage.ts). */
const IMPACT_EFOLD_RATE = 0.2

/** s until the ship strikes the body it is falling to, over one orbit or two months ahead; null if it does not. */
export function timeToImpact(l: Local): number | null {
  if (l.centre === null) return null
  const globe = ALL_GLOBES[l.centre]
  const state = { r: l.r, v: l.v }
  const { period } = elementsOf(state, globe.gm)
  return impactTime(state, globe.gm, Number.isFinite(period) ? period : OPEN_HORIZON, floorOf(globe))
}

/** The fastest the clock may run by a body, ship s per real s: for the orbit to be watched, and for a strike ahead. */
export function localClockLimits(l: Local): { readonly orbit: number; readonly impact: number } {
  const view = orbitOf(l)
  const strike = timeToImpact(l)
  return {
    orbit: view && Number.isFinite(view.elements.period) ? view.elements.period / ORBIT_REAL_S : Infinity,
    impact: strike === null ? Infinity : Math.max(1, IMPACT_EFOLD_RATE * strike),
  }
}

/**
 * The nearest the ship comes to `target` (ly) on its present path, over one orbit or two months ahead, and when.
 * ponytail: 256 samples; between them a fast flyby can come closer than shown.
 */
export function closestApproach(l: Local, target: Vec3): { readonly distance: number; readonly time: number } {
  const gm = gmOf(l)
  const period = gm > 0 ? elementsOf({ r: l.r, v: l.v }, gm).period : Infinity
  const span = Number.isFinite(period) ? period : OPEN_HORIZON
  const offset = scale(sub(l.base, target), LY)
  let best = { distance: Infinity, time: 0 }
  for (let k = 0; k <= APPROACH_SAMPLES; k++) {
    const time = (span * k) / APPROACH_SAMPLES
    const distance = length(add(offset, propagate({ r: l.r, v: l.v }, gm, time).r))
    if (distance < best.distance) best = { distance, time }
  }
  return best
}
