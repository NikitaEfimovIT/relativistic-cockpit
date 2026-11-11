import { describe, expect, test } from 'vitest'
import { BRIGHT_LIMIT_V, BRIGHT_STARS, FARTHEST_LY, brightStar } from './brightStars'
import { STARS } from './nearbyStars'
import { illuminanceToMagnitude } from './physics'
import { starIlluminance } from './stars'

const DEG = Math.PI / 180
const distanceOf = (position: readonly [number, number, number]): number => Math.hypot(...position)
const magnitudeFromSun = (star: { readonly position: readonly [number, number, number]; readonly temperature: number; readonly radiusSquared: number }) =>
  illuminanceToMagnitude(starIlluminance(star.temperature, star.radiusSquared, distanceOf(star.position)))
const longitudeLatitude = ([x, y, z]: readonly [number, number, number]): readonly [number, number] =>
  [((Math.atan2(y, x) / DEG) + 360) % 360, Math.asin(z / distanceOf([x, y, z])) / DEG]

describe('the naked-eye sky from Hipparcos', () => {
  test('it holds every Hipparcos star brighter than V 6.5 but the targets: about 8,770', () => {
    expect(BRIGHT_STARS.length).toBeGreaterThan(8700)
    expect(BRIGHT_STARS.length).toBeLessThan(8785)
  })

  test('a target is drawn once, from its own table, and not again from the catalogue', () => {
    const targets = STARS.slice(1).filter((star) => magnitudeFromSun(star) < BRIGHT_LIMIT_V) // the Sun is not on the sky
    expect(targets).toHaveLength(13)
    for (const target of targets) {
      const towards = target.position.map((c) => c / distanceOf(target.position))
      const twin = BRIGHT_STARS.find((star) => {
        const cos = star.position.reduce((sum, c, i) => sum + c * towards[i], 0) / distanceOf(star.position)
        return cos > Math.cos(0.1 * DEG) && Math.abs(magnitudeFromSun(star) - magnitudeFromSun(target)) < 1
      })
      expect(twin, target.name).toBeUndefined()
    }
  })

  test('the brightest star left once Sirius is a target is Canopus, V −0.62, 309 ly away', () => {
    const brightest = BRIGHT_STARS.reduce((best, star) => (magnitudeFromSun(star) < magnitudeFromSun(best) ? star : best))
    expect(brightest.hip).toBe(30438)
    expect(magnitudeFromSun(brightest)).toBeCloseTo(-0.62, 2)
    expect(distanceOf(brightest.position)).toBeCloseTo(309.2, 0)
  })

  test('familiar stars land at their published galactic longitude and latitude', () => {
    // SIMBAD: Rigel l = 209.24°, b = −25.25°; Polaris 123.28°, +26.46°
    for (const [hip, l, b] of [[24436, 209.24, -25.25], [11767, 123.28, 26.46]] as const) {
      const [gotL, gotB] = longitudeLatitude(brightStar(hip).position)
      expect(gotL, `HIP ${hip}`).toBeCloseTo(l, 1)
      expect(gotB, `HIP ${hip}`).toBeCloseTo(b, 1)
    }
  })

  test('colours come from B−V: Rigel blue-white, Antares red', () => {
    expect(brightStar(24436).temperature).toBeGreaterThan(9000)
    expect(brightStar(80763).temperature).toBeLessThan(3700)
  })

  test('a star too far for Hipparcos to measure stands no further than 1 kpc, and none is lost', () => {
    const distances = BRIGHT_STARS.map((star) => distanceOf(star.position))
    expect(Math.max(...distances)).toBeCloseTo(FARTHEST_LY, 6)
    expect(distances.every(Number.isFinite)).toBe(true)
  })

  test('from the Sun each star is as bright as the catalogue says', () => {
    expect(magnitudeFromSun(brightStar(24436))).toBeCloseTo(0.18, 6) // Rigel
    expect(BRIGHT_STARS.every((star) => magnitudeFromSun(star) < BRIGHT_LIMIT_V)).toBe(true)
  })
})
