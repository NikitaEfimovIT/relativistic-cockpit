import { describe, expect, test } from 'vitest'
import { INITIAL_PROPULSION, type Propulsion } from './chemical'
import { ALL_GLOBES } from './exoplanets'
import { centreAt, launchLocal, localPosition, orbitOf, rebased, stepLocal, type Local } from './flight'
import type { Vec3 } from './galaxy'
import { LY } from './physics'
import { EARTH, MOON } from './solarSystem'
import { forwardOf, launchCourse, type Quat } from './voyage'

const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: Vec3): Vec3 => [a[0] / length(a), a[1] / length(a), a[2] / length(a)]
const firing: Propulsion = { ...INITIAL_PROPULSION, pressurised: true, pressure: 1, feedOpen: true, engineOn: true, throttle: 1 }
const EARTH_INDEX = ALL_GLOBES.indexOf(EARTH)

/** An attitude with the nose, the ship's −z, along `d`: the half-way quaternion [(0,0,−1) × d, 1 + (0,0,−1)·d]. */
const noseAlong = (d: Vec3): Quat => {
  const q: Quat = [d[1], -d[0], 0, 1 - d[2]]
  const n = Math.hypot(...q)
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

describe('the launch orbit', () => {
  test('is circular round the Earth, 25 000 km out, and runs ahead and to the right of the nose', () => {
    const course = launchCourse()
    const local = launchLocal(course)
    expect(local.centre).toBe(EARTH_INDEX)
    expect(length(local.r) / 1e6).toBeCloseTo(25, 6)
    expect(length(local.v)).toBeCloseTo(Math.sqrt(EARTH.gm / 2.5e7), 6)
    expect(dot(local.r, local.v) / (length(local.r) * length(local.v))).toBeCloseTo(0, 9)
    expect(dot(local.v, forwardOf(course.attitude))).toBeGreaterThan(0)
  })

  test('puts the ship where the course begins', () => {
    const course = launchCourse()
    const here = localPosition(launchLocal(course))
    expect(length([here[0] - course.origin[0], here[1] - course.origin[1], here[2] - course.origin[2]]) * LY).toBeLessThan(1)
  })
})

describe('which body pulls', () => {
  const near = (globe: Vec3, km: number): Vec3 => [globe[0] + (km * 1e3) / LY, globe[1], globe[2]]

  test("the Earth by the Earth, the Moon by the Moon though it lies inside the Earth's sphere, and none far out", () => {
    expect(centreAt(near(EARTH.position, 30_000))).toBe(EARTH_INDEX)
    expect(centreAt(near(MOON.position, 10_000))).toBe(ALL_GLOBES.indexOf(MOON))
    expect(centreAt([EARTH.position[0] + 1, EARTH.position[1], EARTH.position[2]])).toBeNull()
  })

  test('changing the centre keeps the ship where it is', () => {
    const local: Local = { centre: EARTH_INDEX, base: EARTH.position, r: [3e8, 1e8, 0], v: [0, 0, 0] }
    const moved = rebased(local, ALL_GLOBES.indexOf(MOON))
    const [a, b] = [localPosition(local), localPosition(moved)]
    expect(length([a[0] - b[0], a[1] - b[1], a[2] - b[2]]) * LY).toBeLessThan(10)
    expect(moved.base).toEqual(MOON.position)
  })
})

describe('a step by a body', () => {
  test('coasting, the launch orbit comes round in 10.9 h', () => {
    const course = launchCourse()
    const start = launchLocal(course)
    let local = start
    for (let i = 0; i < 100; i++) local = stepLocal(local, INITIAL_PROPULSION, course.attitude, 393.38, false).local
    expect(length([local.r[0] - start.r[0], local.r[1] - start.r[1], local.r[2] - start.r[2]]) / 1e3).toBeLessThan(50)
  })

  test("burning along the motion burns propellant at the engine's flow and raises the apoapsis", () => {
    const start = launchLocal(launchCourse())
    const { local, propulsion } = stepLocal(start, firing, noseAlong(unit(start.v)), 600, true)
    expect(firing.propellant - propulsion.propellant).toBeCloseTo((46_700 / (311 * 9.80665)) * 600, 3)
    expect(orbitOf(local)?.elements.apoapsis ?? 0).toBeGreaterThan(2.5e7 * 1.1)
  })

  test('falling into the air wrecks the ship where it meets it', () => {
    const local: Local = { centre: EARTH_INDEX, base: EARTH.position, r: [2.5e7, 0, 0], v: [0, 300, 0] }
    const step = stepLocal(local, INITIAL_PROPULSION, launchCourse().attitude, 86_400, false)
    expect(step.isWrecked).toBe(true)
    expect(length(step.local.r) / (EARTH.radiusM + EARTH.ceiling)).toBeCloseTo(1, 4)
  })

  test('far from every body the ship drifts in a straight line', () => {
    const local: Local = { centre: null, base: [100, 0, 0], r: [0, 0, 0], v: [1000, 0, 0] }
    expect(stepLocal(local, INITIAL_PROPULSION, launchCourse().attitude, 10, false).local.r).toEqual([10_000, 0, 0])
  })
})
