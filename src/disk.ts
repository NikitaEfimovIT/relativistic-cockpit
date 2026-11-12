import type { Vec3 } from './galaxy'
import { C, lutXYZ } from './physics'

// A thin accretion disk round a black hole without spin: its glow (Novikov & Thorne 1973, Page & Thorne 1974) and how
// its light reaches the eye, shifted by the gas's orbit and by the climb out of the well (Luminet 1979).

const SIGMA = 5.670374419e-8 // W m⁻² K⁻⁴, Stefan–Boltzmann (CODATA 2018)

/**
 * The flux a thin disk gives off at x = r/M, M = GM/c², in units of 3GMṀ/(8πM³): Page & Thorne 1974, eq. 15n, for no
 * spin. Zero at the innermost stable orbit, 6 M, where the gas stops being held and falls in; x⁻³ far out. (Luminet
 * 1979, eq. 15, prints √3/3 for the √3/2 of the logarithm: a misprint.)
 */
export function thinDiskFlux(x: number): number {
  if (x <= 6) return 0
  const s = Math.sqrt(x)
  const [r3, r6] = [Math.sqrt(3), Math.sqrt(6)]
  const log = Math.log(((s + r3) * (r6 - r3)) / ((r6 + r3) * (s - r3)))
  return (s - r6 + (r3 / 2) * log) / ((x - 3) * x ** 2.5)
}

/** Where the flux peaks, x = 9.55. */
const PEAK_X = (() => {
  let peak = 6.01
  for (let x = 6.01; x < 20; x += 1e-3) if (thinDiskFlux(x) > thinDiskFlux(peak)) peak = x
  return peak
})()

/** K⁴ per unit of thinDiskFlux, for a hole of Schwarzschild radius rs (m) fed Ṁ kg/s: σT⁴ = 3GMṀ/(8πM³)·f, M = r_s/2. */
export const diskT4 = (rs: number, mdot: number): number => (3 * C * C * mdot) / (2 * Math.PI * rs * rs * SIGMA)

/** The same, for a disk chosen by how hot its hottest ring is. */
export const peakT4 = (peak: number): number => peak ** 4 / thinDiskFlux(PEAK_X)

/** K at r Schwarzschild radii. */
export const diskTemperature = (t4: number, r: number): number => (t4 * thinDiskFlux(2 * r)) ** 0.25

/**
 * ν at an eye at rest x r_s out over ν given off by the disk at r r_s, for a ray whose angular momentum about the disk's
 * axis is λ = L_z/E, r_s: g = √(1 − 3M/r) / (1 − Ωλ) / √(1 − r_s/x), with Ω = √(M/r³) the gas's angular velocity. The
 * gas's time dilation, its motion towards the eye or away, and the light's gain falling into the well.
 */
export const diskShift = (r: number, lambda: number, x: number): number =>
  Math.sqrt(1 - 1.5 / r) / ((1 - Math.sqrt(0.5 / (r * r * r)) * lambda) * Math.sqrt(1 - 1 / x))

export interface DiskLight {
  readonly illuminance: number // lx on a surface facing `direction`
  readonly direction: Vec3 // unit, from the eye towards where the light comes from on balance
  readonly temperature: number // K, the light's mean
  readonly solidAngle: number // sr the glowing disk covers: thin when seen edge on, however wide it is
}

const RINGS = 96
const SECTORS = 96
const add = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec3): Vec3 => add([0, 0, 0], a, 1 / Math.hypot(...a))

/**
 * The light of a flat disk at an eye `at` from its centre, in any unit of length the radii share: the vector sum of each
 * patch's luminance × cos(its slant) × area / distance², no lens and no Doppler (ponytail: for the exposure meter and
 * the cabin's light, not the picture). Rings log-spaced, so it holds from the hot middle to the cold edge.
 */
export function flatDiskLight(at: Vec3, axis: Vec3, inner: number, outer: number, temperatureAt: (r: number) => number): DiskLight {
  const k = unit(axis)
  const e1 = unit(cross(k, Math.abs(k[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
  const e2 = cross(k, e1)
  const step = Math.log(outer / inner) / RINGS
  let sum: Vec3 = [0, 0, 0]
  let [weight, warmth, solidAngle] = [0, 0, 0]
  for (let i = 0; i < RINGS; i++) {
    const r = inner * Math.exp((i + 0.5) * step)
    const temperature = temperatureAt(r)
    if (!(temperature > 0)) continue
    const luminance = lutXYZ(temperature)[1]
    const area = r * r * step * ((2 * Math.PI) / SECTORS) // r dr dψ, with dr = r d(ln r)
    for (let j = 0; j < SECTORS; j++) {
      const psi = ((j + 0.5) * 2 * Math.PI) / SECTORS
      const toPatch = add(add(add([0, 0, 0], e1, r * Math.cos(psi)), e2, r * Math.sin(psi)), at, -1)
      const d2 = dot(toPatch, toPatch)
      const d = Math.sqrt(d2)
      const seen = ((Math.abs(dot(toPatch, k)) / d) * area) / d2
      const lux = luminance * seen
      solidAngle += seen
      sum = add(sum, toPatch, lux / d)
      weight += lux
      warmth += lux * temperature
    }
  }
  const illuminance = Math.hypot(...sum)
  return { illuminance, direction: illuminance > 0 ? unit(sum) : [0, 0, -1], temperature: weight > 0 ? warmth / weight : 0, solidAngle }
}
