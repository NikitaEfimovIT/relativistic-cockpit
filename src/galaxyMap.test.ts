import { describe, expect, test } from 'vitest'
import { MAP_SCALES, nearestPoint, toMap, tripTimes } from './galaxyMap'
import { G0, YEAR } from './physics'

describe('a trip at 1 g, turning over half way', () => {
  test('to α Centauri, 4.37 ly, takes about 3.6 years aboard and 6 on the Earth', () => {
    const { ship, earth } = tripTimes(4.37, G0)

    expect(ship / YEAR).toBeCloseTo(3.58, 1)
    expect(earth / YEAR).toBeCloseTo(6.0, 1)
  })

  test('a short hop is Newtonian: both clocks read 2√(d/a)', () => {
    const lightYearsInMetres = 9.4607e15
    const distance = 1e-6 // ly, about 9.5 million km
    const newtonian = 2 * Math.sqrt((distance * lightYearsInMetres) / G0)

    const { ship, earth } = tripTimes(distance, G0)

    expect(ship / newtonian).toBeCloseTo(1, 4)
    expect(earth / newtonian).toBeCloseTo(1, 4)
  })

  test('the Earth always waits longer than the crew', () => {
    for (const distance of [0.01, 1, 100, 26_000]) {
      const { ship, earth } = tripTimes(distance, G0)
      expect(earth).toBeGreaterThan(ship)
    }
  })
})

describe('the map, seen from above the galactic plane with the ship in the middle', () => {
  const size = [900, 510] as const

  test('the ship is in the middle of the screen', () => {
    expect(toMap([3, 4, 5], [3, 4, 5], 10, ...size)).toEqual([450, 255])
  })

  test('towards the galactic centre (+x) is up, and the way the Galaxy turns (+y) is to the left', () => {
    const [, up] = toMap([1, 0, 0], [0, 0, 0], 1, ...size)
    const [left] = toMap([0, 1, 0], [0, 0, 0], 1, ...size)

    expect(up).toBeCloseTo(0)
    expect(left).toBeCloseTo(450 - 255)
  })

  test('the scales run from inside the Solar System to the whole Galaxy, ten times apart', () => {
    expect(MAP_SCALES[0]).toBeLessThan(0.002) // ly, about 100 au
    expect(MAP_SCALES[MAP_SCALES.length - 1]).toBeGreaterThanOrEqual(50_000)
    MAP_SCALES.slice(1).forEach((scale, i) => expect(scale / MAP_SCALES[i]).toBeCloseTo(10))
  })

  test('a click picks the nearest point within reach, and nothing when none is near', () => {
    const points = [[100, 100], [300, 120], [310, 130]] as const

    expect(nearestPoint(points, 305, 124, 20)).toBe(1)
    expect(nearestPoint(points, 309, 129, 20)).toBe(2)
    expect(nearestPoint(points, 600, 400, 20)).toBeNull()
  })

  test('of points on the same spot it picks the first: a star before the planets listed after it', () => {
    expect(nearestPoint([[10, 10], [10, 10], [10, 10]], 12, 11, 20)).toBe(0)
  })
})
