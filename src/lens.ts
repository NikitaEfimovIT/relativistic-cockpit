// Gravitational lensing by a Schwarzschild hole, seen by an eye at rest x Schwarzschild radii from it. Lengths in r_s.
//
// A ray traced back from the eye at an angle ε from the direction of the hole stays in the plane of the hole, the eye and
// itself. Along it u = r_s/r obeys Binet's equation u″ = −u + (3/2)u² in the angle φ swept about the hole, and at the eye
// du/dφ = u√(1 − u)·cot ε, from the impact parameter b = r sin ε / √(1 − r_s/r) of a static observer (the eye's frame,
// James et al. 2015, appendix A; for a hole without spin it is the textbook Schwarzschild ray). Having swept Φ it leaves
// to infinity at f = π − Φ from the hole's direction, beyond it if f < 0; or it falls in, and that is the shadow.

/** x beyond which a hole is left out: its Einstein ring √(2/x) is under 10⁻³ rad, below a pixel unzoomed. Choice. */
export const LENS_REACH = 2e6
export const LENS_SAMPLES = 256
/** The table's nearest ray to the shadow's edge, as a fraction of its angle: it winds about two turns. */
const EDGE = 1e-6
const MAX_SWEEP = 100 // rad; no tabled ray winds this far

/** The shadow's angular radius from x r_s: sin ε = (3√3/2)/x · √(1 − 1/x). */
export const shadowAngle = (x: number): number => Math.asin(Math.min(1, ((1.5 * Math.sqrt(3)) / x) * Math.sqrt(1 - 1 / x)))

export interface Sweep {
  readonly phi: number // rad swept about the hole
  readonly escaped: boolean
}

const pull = (u: number): number => -u + 1.5 * u * u

/** One RK4 step of Binet's equation for u and du/dφ. */
function step(u: number, v: number, h: number): readonly [number, number] {
  const k1v = pull(u)
  const k2u = v + 0.5 * h * k1v
  const k2v = pull(u + 0.5 * h * v)
  const k3u = v + 0.5 * h * k2v
  const k3v = pull(u + 0.5 * h * k2u)
  const k4u = v + h * k3v
  const k4v = pull(u + h * k3u)
  return [u + (h / 6) * (v + 2 * k2u + 2 * k3u + k4u), v + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)]
}
/** Small enough for a ray that leaves in a sliver of a turn: the flat-space sweep is π − ε. */
const stepFor = (eps: number): number => Math.min(0.005, Math.max(1e-9, (Math.PI - eps) / 300))
const slopeAt = (u: number, eps: number): number => (u * Math.sqrt(1 - u)) / Math.tan(eps)

/** One ray, by RK4 in φ: how far round the hole it goes before it gets away or falls in. */
export function sweep(x: number, eps: number): Sweep {
  if (Math.PI - eps < 1e-12) return { phi: 0, escaped: true } // straight out
  const h = stepFor(eps)
  let [u, v] = [1 / x, slopeAt(1 / x, eps)]
  for (let phi = 0; phi < MAX_SWEEP; phi += h) {
    const [next, slope] = step(u, v, h)
    if (next <= 0) return { phi: phi + (h * u) / (u - next), escaped: true }
    if (next >= 1) return { phi: phi + (h * (1 - u)) / (next - u), escaped: false }
    ;[u, v] = [next, slope]
  }
  return { phi: MAX_SWEEP, escaped: false }
}

/**
 * The bending δ = ε − f tabled over t ∈ [0, 1], with ε − ε_shadow = (π − ε_shadow)·e^{span·(t − 1)}: the samples crowd
 * towards the shadow's edge, where the rays wind round the photon sphere and f runs off logarithmically. δ rather than f,
 * since it is small and smooth far from the hole. `slope` is dδ/dt.
 */
export interface Lens {
  readonly x: number
  readonly shadow: number // rad
  readonly span: number
  readonly delta: Float64Array
  readonly slope: Float64Array
}

const epsilonOf = (shadow: number, span: number, t: number): number => shadow + (Math.PI - shadow) * Math.exp(span * (t - 1))
const tOf = (lens: Lens, eps: number): number => 1 + Math.log((eps - lens.shadow) / (Math.PI - lens.shadow)) / lens.span

export function lensFor(x: number): Lens {
  const shadow = shadowAngle(x)
  const span = Math.log((Math.PI - shadow) / (EDGE * shadow))
  const last = LENS_SAMPLES - 1
  const delta = Float64Array.from({ length: LENS_SAMPLES }, (_, i) => {
    const eps = epsilonOf(shadow, span, i / last)
    return eps - (Math.PI - sweep(x, eps).phi)
  })
  const slope = delta.map((_, i) => {
    const [a, b] = [Math.max(0, i - 1), Math.min(last, i + 1)]
    return ((delta[b] - delta[a]) * last) / (b - a)
  })
  return { x, shadow, span, delta, slope }
}

/** Linear in t between the samples, clamped at the ends. */
const sampled = (table: Float64Array, t: number): number => {
  const at = Math.min(LENS_SAMPLES - 1, Math.max(0, t * (LENS_SAMPLES - 1)))
  const i = Math.min(LENS_SAMPLES - 2, Math.floor(at))
  return table[i] + (table[i + 1] - table[i]) * (at - i)
}

/** f: where a ray leaving the eye at ε from the hole ends up, rad from the hole's direction; −∞ inside the shadow. */
export const outgoing = (lens: Lens, eps: number): number =>
  eps <= lens.shadow ? -Infinity : eps - sampled(lens.delta, tOf(lens, eps))

/** ε at which a source at f from the hole is seen: f > 0 on its own side, f < 0 the image on the far side. */
export function imageAt(lens: Lens, f: number): number {
  let [lo, hi] = [0, 1]
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi)
    if (outgoing(lens, epsilonOf(lens.shadow, lens.span, mid)) < f) lo = mid
    else hi = mid
  }
  return epsilonOf(lens.shadow, lens.span, 0.5 * (lo + hi))
}

/**
 * How much brighter an image at ε is than its source at γ unlensed: the ratio of solid angles, sin ε dε / sin γ dγ. A
 * source of angular radius ρ is never brighter than one ρ off the axis (choice: it caps the ring, where a point would
 * be infinitely bright).
 */
export function magnification(lens: Lens, eps: number, gamma: number, rho: number = 0): number {
  const dEpsDt = (eps - lens.shadow) * lens.span
  const dfDeps = 1 - sampled(lens.slope, tOf(lens, eps)) / dEpsDt
  return Math.sin(eps) / (Math.max(Math.abs(Math.sin(gamma)), rho) * Math.abs(dfDeps))
}

// ── Where along a ray it is: for the disk ───────────────────────────────────────

export const RAY_ROWS = 256 // the first half rays into the shadow, the second half rays past it
export const RAY_COLUMNS = 512
export const RAY_SWEEP = 3 * Math.PI // a disk is met at most three times: once a half turn
export const GONE = -1 // u after the ray has got away
export const FALLEN = 2 // u after it has fallen through the horizon
const HALF = RAY_ROWS / 2
/** ln of how far into the shadow the rows reach: the first inward row is EDGE of its angle from the edge. */
export const INWARD_SPAN = Math.log(1 / EDGE)

/**
 * u = r_s/r along each ray, at φ = 0 … RAY_SWEEP in RAY_COLUMNS steps: where a ray from the eye crosses the plane of a
 * disk, how far out it is. Rows crowd towards the shadow's edge from both sides, as the bending table's do. Kept as w = u·b,
 * b the ray's impact parameter: far out that is sin(φ + ε), smooth from row to row where u itself goes as 1/sin ε.
 */
export interface Rays {
  readonly x: number
  readonly shadow: number
  readonly span: number
  readonly table: Float32Array // row-major, RAY_ROWS × RAY_COLUMNS
}

/** ε of a row: into the shadow e^… down from its edge, past it as the bending table. */
function rowEpsilon(shadow: number, span: number, row: number): number {
  if (row < HALF) return shadow * (1 - Math.exp(-INWARD_SPAN * (row / (HALF - 1))))
  return epsilonOf(shadow, span, (row - HALF) / (HALF - 1))
}

/** The fractional row of a ray at ε, never mixing the two halves. */
export function rowOf(rays: Pick<Rays, 'shadow' | 'span'>, eps: number): number {
  if (eps < rays.shadow) {
    const row = (-Math.log(1 - eps / rays.shadow) / INWARD_SPAN) * (HALF - 1)
    return Math.min(HALF - 1, Math.max(0, row))
  }
  const t = 1 + Math.log((eps - rays.shadow) / (Math.PI - rays.shadow)) / rays.span
  return HALF + Math.min(1, Math.max(0, t)) * (HALF - 1)
}

export function raysFor(x: number): Rays {
  const shadow = shadowAngle(x)
  const span = Math.log((Math.PI - shadow) / (EDGE * shadow))
  const table = new Float32Array(RAY_ROWS * RAY_COLUMNS)
  const column = RAY_SWEEP / (RAY_COLUMNS - 1)
  for (let row = 0; row < RAY_ROWS; row++) {
    const eps = rowEpsilon(shadow, span, row)
    const b = impact(x, eps)
    const at = row * RAY_COLUMNS
    if (eps < 1e-12) continue // straight in: rayRadius knows it
    const h = stepFor(eps)
    let [u, v] = [1 / x, slopeAt(1 / x, eps)]
    let [phi, filled] = [0, 0]
    while (filled < RAY_COLUMNS) {
      const [next, slope] = step(u, v, h)
      for (; filled < RAY_COLUMNS && filled * column <= phi + h; filled++) table[at + filled] = b * (u + ((next - u) * (filled * column - phi)) / h)
      if (next <= 0 || next >= 1) break
      ;[u, v, phi] = [next, slope, phi + h]
    }
    for (; filled < RAY_COLUMNS; filled++) table[at + filled] = b * (u < 0.5 ? GONE : FALLEN)
  }
  return { x, shadow, span, table }
}

/** r_s: the impact parameter of a ray leaving an eye at rest x r_s out at ε from the hole. */
export const impact = (x: number, eps: number): number => (x * Math.sin(eps)) / Math.sqrt(1 - 1 / x)

/** r_s from the hole at φ along the ray seen at ε; Infinity once it has got away, 0 once it has fallen in. */
export function rayRadius(rays: Rays, eps: number, phi: number): number {
  if (eps < 1e-12) return phi > 0 ? 0 : rays.x
  const row = rowOf(rays, eps)
  const lower = row < HALF ? Math.min(HALF - 2, Math.floor(row)) : Math.min(RAY_ROWS - 2, Math.floor(row))
  const col = Math.min(RAY_COLUMNS - 1.001, Math.max(0, (phi / RAY_SWEEP) * (RAY_COLUMNS - 1)))
  const left = Math.floor(col)
  const at = (r: number, c: number): number => rays.table[r * RAY_COLUMNS + c]
  const along = (r: number): number => at(r, left) + (at(r, left + 1) - at(r, left)) * (col - left)
  const u = (along(lower) + (along(lower + 1) - along(lower)) * (row - lower)) / impact(rays.x, eps)
  return u >= 1 ? 0 : u <= 0 ? Infinity : 1 / u
}
