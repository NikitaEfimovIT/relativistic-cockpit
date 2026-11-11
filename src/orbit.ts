// Flight by a body: the ship on a Kepler orbit round one centre, exact over any step, and pushed by an engine.
// Coasting, it is carried in universal variables (Curtis, Orbital Mechanics for Engineering Students, algorithms 3.3–3.4;
// the hyperbolic first guess from Vallado, Fundamentals of Astrodynamics, algorithm 8), so that a year a second costs one
// solve per frame and the orbit does not drift. Under thrust it is integrated by RK4 in steps of a second at most.
import type { Vec3 } from './galaxy'

/** m and m/s from the centre, galactic axes. */
export interface State {
  readonly r: Vec3
  readonly v: Vec3
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const length = (a: Vec3): number => Math.sqrt(dot(a, a))

/** Stumpff's functions S(z) and C(z), by their series near z = 0. */
function stumpff(z: number): readonly [number, number] {
  if (z > 1e-6) {
    const s = Math.sqrt(z)
    return [(s - Math.sin(s)) / (s * z), (1 - Math.cos(s)) / z]
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z)
    return [(Math.sinh(s) - s) / (s * -z), (Math.cosh(s) - 1) / -z]
  }
  return [1 / 6 - z / 120 + (z * z) / 5040, 1 / 2 - z / 24 + (z * z) / 720]
}

const NEWTON_STEPS = 60

/** The universal anomaly χ after `dt`, by Newton's method; NaN if it does not settle. */
function universalAnomaly(r0: number, vr0: number, alpha: number, gm: number, dt: number): number {
  const root = Math.sqrt(gm)
  const guess = ((): number => {
    if (alpha > 1e-12) return root * alpha * dt
    if (alpha < -1e-12) {
      const a = 1 / alpha
      const x = Math.log((-2 * gm * alpha * dt) / (r0 * vr0 + Math.sqrt(-gm * a) * (1 - r0 * alpha)))
      if (Number.isFinite(x)) return Math.sqrt(-a) * x
    }
    return (root * dt) / r0
  })()
  let chi = guess
  for (let i = 0; i < NEWTON_STEPS; i++) {
    const z = alpha * chi * chi
    const [S, C] = stumpff(z)
    const f = ((r0 * vr0) / root) * chi * chi * C + (1 - alpha * r0) * chi ** 3 * S + r0 * chi - root * dt
    const df = ((r0 * vr0) / root) * chi * (1 - z * S) + (1 - alpha * r0) * chi * chi * C + r0
    const step = f / df
    chi -= step
    if (Math.abs(step) <= 1e-13 * Math.max(1, Math.abs(chi))) return chi
  }
  return Number.NaN
}

/**
 * Where the ship is `dt` seconds on, coasting round a centre of gravitational parameter `gm` (m³/s²); with none, in a
 * straight line. An ellipse is carried by `dt` modulo its period, so the anomaly stays small at any step.
 */
export function propagate(s: State, gm: number, dt: number): State {
  if (dt === 0) return s
  if (gm === 0) return { r: add(s.r, scale(s.v, dt)), v: s.v }
  const r0 = length(s.r)
  const v0 = length(s.v)
  const vr0 = dot(s.r, s.v) / r0
  const alpha = 2 / r0 - (v0 * v0) / gm
  const period = alpha > 1e-12 ? (2 * Math.PI) / (Math.sqrt(gm) * alpha ** 1.5) : Infinity
  const t = period < Infinity ? dt % period : dt
  const chi = universalAnomaly(r0, vr0, alpha, gm, t)
  if (!Number.isFinite(chi)) return propagate(propagate(s, gm, t / 2), gm, t / 2) // ponytail: halve until Newton settles
  const z = alpha * chi * chi
  const [S, C] = stumpff(z)
  const f = 1 - ((chi * chi) / r0) * C
  const g = t - (chi ** 3 * S) / Math.sqrt(gm)
  const r = add(scale(s.r, f), scale(s.v, g))
  const rn = length(r)
  const fDot = (Math.sqrt(gm) / (rn * r0)) * (z * chi * S - chi)
  const gDot = 1 - ((chi * chi) / rn) * C
  return { r, v: add(scale(s.r, fDot), scale(s.v, gDot)) }
}

export interface Elements {
  readonly periapsis: number // m from the centre
  readonly apoapsis: number // m from the centre; Infinity on an open orbit
  readonly period: number // s; Infinity on an open orbit
  readonly timeToPeriapsis: number // s; Infinity once an open orbit has passed it
  readonly eccentricity: number
}

/** The shape of the orbit and where on it the ship is. */
export function elementsOf(s: State, gm: number): Elements {
  const r = length(s.r)
  const v2 = dot(s.v, s.v)
  const rv = dot(s.r, s.v)
  const h = length(cross(s.r, s.v))
  const e = length(scale(add(scale(s.r, v2 - gm / r), scale(s.v, -rv)), 1 / gm))
  const p = (h * h) / gm
  const periapsis = p / (1 + e)
  const energy = v2 / 2 - gm / r
  if (energy < 0) {
    const a = -gm / (2 * energy)
    const motion = Math.sqrt(gm / a ** 3)
    const cosE = Math.min(1, Math.max(-1, (1 - r / a) / Math.max(e, 1e-15)))
    const E = rv >= 0 ? Math.acos(cosE) : 2 * Math.PI - Math.acos(cosE)
    const mean = E - e * Math.sin(E)
    // 2a − r_p rather than p/(1 − e): falling straight down from rest, e is 1 and p is 0, and the apoapsis is where it fell from
    return { periapsis, apoapsis: 2 * a - periapsis, period: (2 * Math.PI) / motion, timeToPeriapsis: (2 * Math.PI - mean) / motion, eccentricity: e }
  }
  const a = gm / (2 * Math.max(energy, Number.MIN_VALUE)) // the hyperbola's |a|
  const F = (rv >= 0 ? 1 : -1) * Math.acosh(Math.max(1, (1 + r / a) / e))
  const mean = e * Math.sinh(F) - F
  const motion = Math.sqrt(gm / a ** 3)
  return { periapsis, apoapsis: Infinity, period: Infinity, timeToPeriapsis: mean < 0 ? -mean / motion : Infinity, eccentricity: e }
}

const BISECTIONS = 60

/**
 * s into a coasting step of `dt` when the ship first comes down to `floor` m from the centre, or null if it does not.
 * The lowest point inside the step is the periapsis, if the step reaches it; otherwise one of its ends.
 */
export function impactTime(s: State, gm: number, dt: number, floor: number): number | null {
  if (length(s.r) <= floor) return 0
  if (gm === 0) return null // ponytail: no body pulls, so none is near enough to strike
  const { periapsis, timeToPeriapsis } = elementsOf(s, gm)
  const passesPeriapsis = timeToPeriapsis <= dt
  if (passesPeriapsis ? periapsis > floor : length(propagate(s, gm, dt).r) > floor) return null
  let [low, high] = [0, passesPeriapsis ? timeToPeriapsis : dt]
  for (let i = 0; i < BISECTIONS; i++) {
    const mid = (low + high) / 2
    if (length(propagate(s, gm, mid).r) > floor) low = mid
    else high = mid
  }
  return high
}

/**
 * The sphere within which a body's pull outweighs its parent's tides: a(1 − e)·∛(m / 3M) at the closest point of its
 * orbit (Hamilton & Burns 1992, Icarus 96, 43). `gm` and `parentGm` stand for the masses: G cancels.
 */
export const hillRadius = (a: number, e: number, gm: number, parentGm: number): number =>
  a * (1 - e) * Math.cbrt(gm / (3 * parentGm))

export interface Thrust {
  readonly direction: Vec3 // unit, galactic axes
  readonly force: number // N
  readonly mass: number // kg at the start of the step
  readonly flow: number // kg/s
}

const RK4_STEP = 1 // s

/** `dt` seconds under thrust and gravity, by RK4 in steps of a second at most; the mass falls as the propellant burns. */
export function burn(s: State, gm: number, dt: number, thrust: Thrust): { readonly state: State; readonly mass: number } {
  const steps = Math.max(1, Math.ceil(dt / RK4_STEP))
  const h = dt / steps
  const accel = (r: Vec3, t: number): Vec3 => {
    const push = scale(thrust.direction, thrust.force / (thrust.mass - thrust.flow * t))
    if (gm === 0) return push
    const d = length(r)
    return add(push, scale(r, -gm / (d * d * d)))
  }
  let { r, v } = s
  for (let i = 0; i < steps; i++) {
    const t = i * h
    const [k1r, k1v] = [v, accel(r, t)]
    const [k2r, k2v] = [add(v, scale(k1v, h / 2)), accel(add(r, scale(k1r, h / 2)), t + h / 2)]
    const [k3r, k3v] = [add(v, scale(k2v, h / 2)), accel(add(r, scale(k2r, h / 2)), t + h / 2)]
    const [k4r, k4v] = [add(v, scale(k3v, h)), accel(add(r, scale(k3r, h)), t + h)]
    r = add(r, scale(add(add(k1r, k4r), scale(add(k2r, k3r), 2)), h / 6))
    v = add(v, scale(add(add(k1v, k4v), scale(add(k2v, k3v), 2)), h / 6))
  }
  return { state: { r, v }, mass: thrust.mass - thrust.flow * dt }
}
