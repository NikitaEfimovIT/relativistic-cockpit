import { describe, expect, test } from 'vitest'
import { HOLES, clockRate, parkingRadius, schwarzschildRadius, tidalRadius, wreckRadius } from './blackHoles'

const sgrA = HOLES.find((hole) => hole.name === 'Sgr A*')

describe('black holes', () => {
  test('Sgr A* is 4.297 million Suns, 12.7 million km across its horizon radius', () => {
    expect(sgrA?.mass).toBe(4.297e6)
    expect(schwarzschildRadius(4.297e6) / 1e10).toBeCloseTo(1.269, 3)
  })

  test('by Sgr A* the ship stops 10 Schwarzschild radii out: tides there are nothing', () => {
    const rs = schwarzschildRadius(4.297e6)
    expect(sgrA && parkingRadius(sgrA) / rs).toBeCloseTo(10, 9)
    expect(tidalRadius(4.297e6)).toBeLessThan(rs)
    expect(wreckRadius(4.297e6) / rs).toBeCloseTo(1.5, 9) // the photon sphere: inside it there is no view to draw
  })

  test('by a hole of 21.2 Suns, as Cygnus X-1, a 2 m body is stretched by 10 g at 4 860 km', () => {
    expect(tidalRadius(21.2) / 1e3).toBeCloseTo(4860, -1)
    expect(wreckRadius(21.2)).toBe(tidalRadius(21.2))
  })

  test('the clock of a ship at rest runs as √(1 − r_s/r): 0.949 at 10 r_s', () => {
    expect(clockRate(1, 10)).toBeCloseTo(Math.sqrt(0.9), 12)
    expect(clockRate(1, Infinity)).toBe(1)
  })
})

describe('Cygnus X-1 and its star', () => {
  const cygX1 = HOLES.find((hole) => hole.name === 'Лебедь X-1')
  const AU = 1.495978707e11
  const LY_M = 299_792_458 * 31_557_600
  const sub = (a: readonly number[], b: readonly number[]): number[] => a.map((v, i) => v - b[i])
  const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, v, i) => s + v * b[i], 0)
  const angle = (a: readonly number[], b: readonly number[]): number => Math.acos(dot(a, b) / Math.hypot(...a) / Math.hypot(...b))

  test('21.2 Suns, 2.22 kpc off; the ship stops where the tides are down to 1 g, 167 r_s out: ∛10 times as far as they kill', () => {
    expect(cygX1?.mass).toBe(21.2)
    expect(cygX1 && Math.hypot(...cygX1.position)).toBeCloseTo(7241, 0)
    expect(cygX1 && parkingRadius(cygX1) / schwarzschildRadius(21.2)).toBeCloseTo(167.2, 0)
    expect(cygX1 && parkingRadius(cygX1) / 1e3).toBeCloseTo(10_470, -1)
    expect(cygX1 && parkingRadius(cygX1) / wreckRadius(21.2)).toBeCloseTo(Math.cbrt(10), 9)
  })

  test('its blue supergiant circles it 0.244 AU off, in the plane of the disk, 25° in radius as seen from the hole', () => {
    const star = cygX1?.companion
    const offset = star && cygX1 ? sub(star.position, cygX1.position).map((v) => v * LY_M) : [0, 0, 0]
    expect(Math.hypot(...offset) / AU).toBeCloseTo(0.244, 3)
    expect(cygX1?.disk && Math.abs(dot(offset, cygX1.disk.axis)) / Math.hypot(...offset)).toBeLessThan(1e-6) // ly 7 241 off: digits go
    expect(star && (Math.asin(star.radius / Math.hypot(...offset)) * 180) / Math.PI).toBeCloseTo(24.8, 0)
  })

  test('its disk reaches to 0.7 of the hole’s Roche lobe, 1.3·10⁵ r_s, and its axis is 27.5° from the line of sight', () => {
    expect(cygX1?.disk && cygX1.disk.outer / 1e5).toBeCloseTo(1.32, 1)
    expect(cygX1?.disk && (angle(cygX1.disk.axis, cygX1.position) * 180) / Math.PI).toBeCloseTo(27.5, 6)
  })
})

describe('the invented hole', () => {
  const invented = HOLES.find((hole) => hole.disk && hole.companion === null)
  test('a hundred million Suns with a disk 6000 K at its hottest, seen nearly edge on from the Sun', () => {
    expect(invented?.mass).toBe(1e8)
    expect(invented?.parking).toBe(25)
    const axis = invented?.disk?.axis ?? [0, 0, 1]
    const towards = invented?.position ?? [1, 0, 0]
    const tilt = (Math.acos(-axis.reduce((s, v, i) => s + v * towards[i], 0) / Math.hypot(...towards)) * 180) / Math.PI
    expect(tilt).toBeCloseTo(85, 6)
  })
})
