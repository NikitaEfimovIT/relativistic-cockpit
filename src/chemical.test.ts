import { describe, expect, test } from 'vitest'
import {
  INITIAL_PROPULSION, PROPELLANT, RCS_PROPELLANT, deltaV, drawRcs, isBurning, isFuelCaution, nextThrottle, refuelled,
  settleThrottle, stepPressure, type Propulsion,
} from './chemical'

const ready: Propulsion = { ...INITIAL_PROPULSION, pressurised: true, pressure: 1, feedOpen: true, engineOn: true, throttle: 1 }

describe('the rocket equation', () => {
  test('full tanks hold about 2.1 km/s', () => {
    expect(deltaV(INITIAL_PROPULSION)).toBeGreaterThan(2050)
    expect(deltaV(INITIAL_PROPULSION)).toBeLessThan(2150)
  })

  test('empty tanks hold nothing', () => {
    expect(deltaV({ ...INITIAL_PROPULSION, propellant: 0 })).toBe(0)
  })
})

describe('the lever', () => {
  test('steps up from off through 10–60 % to full, skipping the band the engine cannot run in, and back', () => {
    const up: number[] = []
    let value = 0
    for (let i = 0; i < 8; i++) up.push((value = nextThrottle(value, 1)))
    expect(up.map((v) => Math.round(v * 100))).toEqual([10, 20, 30, 40, 50, 60, 100, 100])
    expect(nextThrottle(1, -1)).toBeCloseTo(0.6, 12)
    expect(nextThrottle(0.1, -1)).toBe(0)
    expect(nextThrottle(0, -1)).toBe(0)
  })

  test('a setting inside the forbidden band settles to the nearer edge', () => {
    expect(settleThrottle(0.7)).toBeCloseTo(0.6, 12)
    expect(settleThrottle(0.9)).toBe(1)
    expect(settleThrottle(0.05)).toBe(0.1)
    expect(settleThrottle(0.04)).toBe(0)
  })
})

describe('what it takes to burn', () => {
  test('pressure, the feed, the start switch, the lever and the bus; and the light mode off', () => {
    expect(isBurning(ready, true, false)).toBe(true)
    expect(isBurning({ ...ready, pressure: 0.5 }, true, false)).toBe(false)
    expect(isBurning({ ...ready, feedOpen: false }, true, false)).toBe(false)
    expect(isBurning({ ...ready, engineOn: false }, true, false)).toBe(false)
    expect(isBurning({ ...ready, throttle: 0 }, true, false)).toBe(false)
    expect(isBurning({ ...ready, propellant: 0 }, true, false)).toBe(false)
    expect(isBurning(ready, false, false)).toBe(false)
    expect(isBurning(ready, true, true)).toBe(false)
  })

  test('the helium brings the tanks up to pressure in a few seconds once its valve opens, and lets it go once it closes', () => {
    const opened = { ...INITIAL_PROPULSION, pressurised: true }
    expect(stepPressure(opened, 0.5).pressure).toBeLessThan(0.95)
    expect(stepPressure(opened, 10).pressure).toBeGreaterThan(0.95)
    expect(stepPressure({ ...ready, pressurised: false }, 10).pressure).toBeLessThan(0.05)
  })
})

describe('the attitude thrusters', () => {
  test('draw from their own tank', () => {
    const drawn = drawRcs(INITIAL_PROPULSION, 2)
    expect(drawn?.rcsPropellant).toBeCloseTo(RCS_PROPELLANT - 2, 12)
    expect(drawn?.propellant).toBe(PROPELLANT)
  })

  test('with their tank dry they cannot turn the ship, unless the crossfeed opens the main tanks to them', () => {
    const dry = { ...ready, rcsPropellant: 0 }
    expect(drawRcs(dry, 2)).toBeNull()
    const crossfed = drawRcs({ ...dry, crossfeedOpen: true }, 2)
    expect(crossfed?.propellant).toBeCloseTo(PROPELLANT - 2, 12)
    expect(drawRcs({ ...dry, crossfeedOpen: true, pressure: 0 }, 2)).toBeNull() // the main tanks feed under pressure only
  })
})

describe('the ТОПЛИВО caution', () => {
  test('lights below a tenth of the propellant, with the thrusters dry and no crossfeed, or with the engine started dry of feed', () => {
    expect(isFuelCaution(ready)).toBe(false)
    expect(isFuelCaution({ ...ready, propellant: 0.09 * PROPELLANT })).toBe(true)
    expect(isFuelCaution({ ...ready, rcsPropellant: 0 })).toBe(true)
    expect(isFuelCaution({ ...ready, rcsPropellant: 0, crossfeedOpen: true })).toBe(false)
    expect(isFuelCaution({ ...ready, feedOpen: false })).toBe(true)
    expect(isFuelCaution({ ...ready, pressure: 0 })).toBe(true)
  })
})

test('at the target the tanks are full again', () => {
  const spent = { ...ready, propellant: 10, rcsPropellant: 1 }
  expect(refuelled(spent)).toEqual({ ...spent, propellant: PROPELLANT, rcsPropellant: RCS_PROPELLANT })
})
