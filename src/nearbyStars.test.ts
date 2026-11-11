import { describe, expect, test } from 'vitest'
import { AU_LY, BODIES, STARS, equatorialDirection, equatorialToGalactic, indexOfBody, luminosityOf, visualRadiusSquared } from './nearbyStars'
import { illuminanceToMagnitude, lutXYZ } from './physics'

const DEG = Math.PI / 180
const body = (name: string) => BODIES[indexOfBody(name)]
const longitudeLatitude = ([x, y, z]: readonly [number, number, number]): readonly [number, number] => {
  const r = Math.hypot(x, y, z)
  return [((Math.atan2(y, x) / DEG) + 360) % 360, Math.asin(z / r) / DEG]
}

describe('coordinates', () => {
  test('the north galactic pole of ICRS (192.859°, +27.128°) maps to b = 90°', () => {
    const [, , z] = equatorialToGalactic(equatorialDirection(192.85948, 27.12825))
    expect(z).toBeCloseTo(1, 8)
  })

  test('known stars land at their published galactic longitude and latitude', () => {
    // SIMBAD: Sirius l = 227.23°, b = −8.89°; Vega 67.45°, +19.24°; α Cen A 315.73°, −0.68°; Betelgeuse 199.79°, −8.96°
    const cases: ReadonlyArray<readonly [string, number, number]> = [
      ['Сириус', 227.23, -8.89], ['Вега', 67.45, 19.24], ['α Центавра A', 315.73, -0.68], ['Бетельгейзе', 199.79, -8.96],
    ]
    for (const [name, l, b] of cases) {
      const [gotL, gotB] = longitudeLatitude(body(name).position)
      expect(gotL, name).toBeCloseTo(l, 1)
      expect(gotB, name).toBeCloseTo(b, 1)
    }
  })

  test('distances follow from the parallaxes: Proxima 4.25 ly, α Cen 4.40 ly, Sirius 8.60 ly, Betelgeuse 498 ly', () => {
    const distance = (name: string) => Math.hypot(...body(name).position)
    expect(distance('Проксима Центавра')).toBeCloseTo(4.25, 2)
    expect(distance('α Центавра A')).toBeCloseTo(4.39, 1)
    expect(distance('Сириус')).toBeCloseTo(8.6, 1)
    expect(distance('Бетельгейзе')).toBeCloseTo(498, 0) // Hipparcos 2007, 6.55 ± 0.83 mas: the distance is uncertain by 13 %
  })

  test('the table runs from the Sun outwards and ends at the centre of the Galaxy', () => {
    const distances = BODIES.map((b) => Math.hypot(...b.position))
    for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1] - 1e-9)
    expect(BODIES[0].name).toBe('Солнце')
    expect(distances[distances.length - 1]).toBeGreaterThan(26_000)
    expect(STARS).toHaveLength(BODIES.length - 1)
  })
})

describe('brightness', () => {
  test('the Sun as a blackbody of R☉ and 5772 K is V = −26.74 at 1 AU', () => {
    const sun = BODIES[0]
    const illuminance = (lutXYZ(sun.temperature)[1] * Math.PI * sun.radiusSquared) / AU_LY ** 2
    expect(illuminanceToMagnitude(illuminance)).toBeCloseTo(-26.74, 0)
  })

  test('the radius is chosen to give back the catalogue V at the star’s distance', () => {
    const r2 = visualRadiusSquared(1.0, 6000, 30)
    expect(illuminanceToMagnitude((lutXYZ(6000)[1] * Math.PI * r2) / 900)).toBeCloseTo(1.0, 8)
  })

  test('for A–K stars the implied luminosity matches the published one within 40 %', () => {
    // Liebert 2005, Aufdenberg 2006, Kervella 2017, Kervella 2004, Ramírez & Allende Prieto 2011, Peterson 2006,
    // Teixeira 2009. Vega is a fast rotator seen pole-on: from its flux, as from ours, it looks like 57 L☉, not its 40.
    const published: ReadonlyArray<readonly [string, number]> = [
      ['Сириус', 25.4], ['Вега', 57], ['α Центавра A', 1.519], ['Процион', 6.93],
      ['Арктур', 170], ['Альтаир', 10.6], ['τ Кита', 0.52],
    ]
    for (const [name, luminosity] of published) {
      const star = body(name)
      expect(luminosityOf(star.radiusSquared, star.temperature) / luminosity, name).toBeGreaterThan(0.6)
      expect(luminosityOf(star.radiusSquared, star.temperature) / luminosity, name).toBeLessThan(1.4)
    }
  })

  test('a star is approached to where it shines as the Sun does on the Earth', () => {
    expect(BODIES[0].standoff).toBeCloseTo(AU_LY, 12)
    expect(body('Сириус').standoff / AU_LY).toBeGreaterThan(4)
    expect(body('Проксима Центавра').standoff / AU_LY).toBeLessThan(0.1)
  })
})
