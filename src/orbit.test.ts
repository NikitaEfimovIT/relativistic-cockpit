import { describe, expect, test } from 'vitest'
import type { Vec3 } from './galaxy'
import { burn, elementsOf, hillRadius, impactTime, propagate, type State } from './orbit'

const GM_EARTH = 3.98600435507e14 // m³/s², JPL DE440
const R0 = 2.5e7 // m, the launch orbit
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const circular = (r: number, gm: number = GM_EARTH): State => ({ r: [r, 0, 0], v: [0, Math.sqrt(gm / r), 0] })
const energy = (s: State, gm: number): number => length(s.v) ** 2 / 2 - gm / length(s.r)
const angularMomentum = (s: State): number => length([
  s.r[1] * s.v[2] - s.r[2] * s.v[1], s.r[2] * s.v[0] - s.r[0] * s.v[2], s.r[0] * s.v[1] - s.r[1] * s.v[0],
])

describe('Kepler', () => {
  test('a circular orbit 25 000 km from the Earth takes 10.9 h and comes back to where it began', () => {
    const start = circular(R0)
    const { period } = elementsOf(start, GM_EARTH)
    expect(period / 3600).toBeCloseTo(10.93, 2)
    const back = propagate(start, GM_EARTH, period)
    expect(length([back.r[0] - R0, back.r[1], back.r[2]])).toBeLessThan(1)
  })

  test('a quarter of the period carries the ship a quarter of the way round', () => {
    const start = circular(R0)
    const quarter = propagate(start, GM_EARTH, elementsOf(start, GM_EARTH).period / 4)
    expect(quarter.r[0]).toBeCloseTo(0, -1)
    expect(quarter.r[1]).toBeCloseTo(R0, -1)
  })

  test('energy and angular momentum hold over a thousand orbits stepped at a year a second', () => {
    const gm = GM_EARTH
    const start: State = { r: [R0, 0, 0], v: [0, 3000, 1200] } // eccentric and tilted
    const frame = 31_557_600 / 60
    let s = start
    for (let i = 0; i < 1000; i++) s = propagate(s, gm, frame)
    expect(Math.abs(energy(s, gm) / energy(start, gm) - 1)).toBeLessThan(1e-9)
    expect(Math.abs(angularMomentum(s) / angularMomentum(start) - 1)).toBeLessThan(1e-9)
  })

  test('a ship faster than escape leaves on a hyperbola, and keeps its energy far out', () => {
    const escape = Math.sqrt((2 * GM_EARTH) / R0)
    const start: State = { r: [R0, 0, 0], v: [0, 1.2 * escape, 0] }
    const elements = elementsOf(start, GM_EARTH)
    expect(elements.apoapsis).toBe(Infinity)
    expect(elements.period).toBe(Infinity)
    expect(elements.periapsis).toBeCloseTo(R0, -1)
    const later = propagate(start, GM_EARTH, 30 * 86_400)
    expect(length(later.r)).toBeGreaterThan(1e9)
    expect(Math.abs(energy(later, GM_EARTH) / energy(start, GM_EARTH) - 1)).toBeLessThan(1e-9)
  })

  test('from the apoapsis of an ellipse the periapsis is half a period away', () => {
    const start: State = { r: [R0, 0, 0], v: [0, 2500, 0] } // slower than circular: this is the apoapsis
    const elements = elementsOf(start, GM_EARTH)
    expect(elements.apoapsis).toBeCloseTo(R0, -1)
    expect(elements.timeToPeriapsis / elements.period).toBeCloseTo(0.5, 6)
    const atPeriapsis = propagate(start, GM_EARTH, elements.timeToPeriapsis)
    expect(length(atPeriapsis.r) / elements.periapsis).toBeCloseTo(1, 6)
  })

  test('without a body the ship drifts in a straight line', () => {
    const drifted = propagate({ r: [1, 2, 3], v: [10, 0, -1] }, 0, 100)
    expect(drifted.r).toEqual([1001, 2, -97])
  })
})

describe('impact', () => {
  const FLOOR = 6.471e6 // the Earth's radius and 100 km of air

  test('a ship falling from 25 000 km with little sideways speed hits the air at the moment found', () => {
    const start: State = { r: [R0, 0, 0], v: [0, 500, 0] }
    const t = impactTime(start, GM_EARTH, 86_400, FLOOR)
    expect(t).not.toBeNull()
    expect(length(propagate(start, GM_EARTH, t ?? 0).r) / FLOOR).toBeCloseTo(1, 6)
  })

  test('a step that ends before the fall gets there finds nothing', () => {
    expect(impactTime({ r: [R0, 0, 0], v: [0, 500, 0] }, GM_EARTH, 60, FLOOR)).toBeNull()
  })

  test('an orbit that passes above the air never hits it, over many orbits in one step', () => {
    expect(impactTime(circular(R0), GM_EARTH, 100 * 86_400, FLOOR)).toBeNull()
  })

  test('a periapsis below the air inside a long step is caught, though both ends of the step are high', () => {
    const start: State = { r: [R0, 0, 0], v: [0, 1500, 0] } // periapsis ≈ 4 900 km from the centre
    const { period } = elementsOf(start, GM_EARTH)
    expect(impactTime(start, GM_EARTH, period, FLOOR)).not.toBeNull()
  })
})

describe('Hill sphere', () => {
  test("the Earth's reaches 1.5 million km", () => {
    const au = 1.495978707e11
    expect(hillRadius(1.00000261 * au, 0.01671123, GM_EARTH, 1.32712440041e20) / 1e9).toBeCloseTo(1.47, 2)
  })
})

describe('burn', () => {
  test('away from any body the speed gained is the rocket equation: v_e ln(m0 / m1)', () => {
    const exhaust = 311 * 9.80665
    const force = 46_700
    const flow = force / exhaust
    const { state, mass } = burn({ r: [0, 0, 0], v: [0, 0, 0] }, 0, 1000, { direction: [1, 0, 0], force, mass: 100_000, flow })
    expect(mass).toBeCloseTo(100_000 - flow * 1000, 6)
    expect(state.v[0] / (exhaust * Math.log(100_000 / mass))).toBeCloseTo(1, 9)
  })

  test('a burn along the motion raises the far side of the orbit', () => {
    const start = circular(R0)
    const { state } = burn(start, GM_EARTH, 600, { direction: [0, 1, 0], force: 46_700, mass: 100_000, flow: 15 })
    expect(elementsOf(state, GM_EARTH).apoapsis).toBeGreaterThan(R0 * 1.1)
  })
})

test('falling straight down from rest, the apoapsis is where the fall began and the periapsis the centre', () => {
  const elements = elementsOf({ r: [R0, 0, 0], v: [0, 0, 0] }, GM_EARTH)
  expect(elements.apoapsis / R0).toBeCloseTo(1, 9)
  expect(elements.periapsis).toBeCloseTo(0, 3)
})
