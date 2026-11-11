import { describe, expect, test } from 'vitest'
import { CABIN_AIR, CO2_LIMIT, CO2_OFF_NOMINAL, CO2_SCRUBBED, co2AtFace, stepCo2 } from './lifeSupport'

const HOUR = 3600

describe('carbon dioxide in the cabin', () => {
  test('the cockpit and the three compartments hold about sixty cubic metres of air', () => {
    expect(CABIN_AIR).toBeGreaterThan(55)
    expect(CABIN_AIR).toBeLessThan(65)
  })

  test('with nothing taking it out, one pilot raises it by about a quarter of a mm Hg an hour', () => {
    const rise = stepCo2(CO2_SCRUBBED, false, HOUR) - CO2_SCRUBBED
    expect(rise).toBeGreaterThan(0.2)
    expect(rise).toBeLessThan(0.32)
  })

  test('without the scrubber the off-nominal level is about two days away', () => {
    const hours = (CO2_OFF_NOMINAL - CO2_SCRUBBED) / stepCo2(0, false, HOUR)
    expect(hours).toBeGreaterThan(36)
    expect(hours).toBeLessThan(60)
  })

  test('the scrubber brings it back to its working level from anywhere, and holds it there', () => {
    expect(stepCo2(20, true, 5 * 24 * HOUR)).toBeCloseTo(CO2_SCRUBBED, 2) // ten hours a factor of e: it draws the same air for a bigger ship
    expect(stepCo2(CO2_SCRUBBED, true, HOUR)).toBeCloseTo(CO2_SCRUBBED, 10)
    expect(stepCo2(20, true, 1e12)).toBe(CO2_SCRUBBED) // a year-long frame at cruise must not overshoot
  })

  test('the working level is within the NASA limit, so a ventilated cabin raises no caution', () => {
    expect(co2AtFace(CO2_SCRUBBED, true)).toBeLessThan(CO2_LIMIT)
  })

  test('in still air the breath gathers round the face: above the limit, but short of the off-nominal level', () => {
    const face = co2AtFace(CO2_SCRUBBED, false)
    expect(face).toBeGreaterThan(CO2_LIMIT)
    expect(face).toBeLessThan(CO2_OFF_NOMINAL)
  })
})
