import { expect, test } from 'vitest'
import { KPC_LY, RESOLVED_RADIUS_KPC, galactocentric, starAcceptance, starDensityRatio } from './galaxy'
import { illuminanceToMagnitude } from './physics'
import { CLUSTER_MEMBERS, STAR_BOX_LY, generateStars, mainSequence, starIlluminance, withoutNakedEyeStars } from './stars'

test('Eker 2018 relations give sensible main-sequence stars', () => {
  const tenSuns = mainSequence(10)
  expect(tenSuns.luminosity).toBeCloseTo(10 ** (2.865 + 1.105), -2)
  expect(tenSuns.temperature).toBeCloseTo(10 ** (-0.17 + 0.888 + 3.671), -1)
})

test('catalog is deterministic for a given seed', () => {
  const [a, b] = [generateStars(1000, 7), generateStars(1000, 7)]
  expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
})

test('positions stay in the periodic box and every star is physical', () => {
  const stars = generateStars(5000, 1)
  expect(Math.max(...stars.positions.map(Math.abs))).toBeLessThanOrEqual(STAR_BOX_LY / 2)
  expect(Math.min(...stars.temperatures)).toBeGreaterThan(3000)
  expect(Math.min(...stars.radiiSquared)).toBeGreaterThan(0)
})

test('the synthetic sky has about as many naked-eye stars as the real one (≈5000 with V < 6)', () => {
  // Arrange
  const stars = generateStars()
  let visible = 0

  // Act: as the star shader sees them from the Sun, thinned to the density of the disc
  for (let i = 0; i < stars.temperatures.length; i++) {
    const [x, y, z] = stars.positions.slice(i * 3, i * 3 + 3)
    const distance = Math.hypot(x, y, z)
    if (distance > STAR_BOX_LY / 2) continue
    const place = galactocentric([x, y, z])
    if (stars.randoms[i] > starAcceptance(starDensityRatio(place, stars.temperatures[i]))) continue
    if (illuminanceToMagnitude(starIlluminance(stars.temperatures[i], stars.radiiSquared[i], distance)) < 6) visible++
  }

  // Assert
  expect(visible).toBeGreaterThan(3000)
  expect(visible).toBeLessThan(9000)
})

test('the stars a real catalogue holds, brighter than its limit from the Sun, leave the synthetic sky to it', () => {
  // Arrange
  const stars = generateStars()
  const fromSun = (i: number): number => illuminanceToMagnitude(
    starIlluminance(stars.temperatures[i], stars.radiiSquared[i], Math.hypot(...stars.positions.slice(i * 3, i * 3 + 3))))

  // Act
  const left = withoutNakedEyeStars(stars, 6.5)

  // Assert: none of those is left, every fainter one is, and the catalogue it was made from is untouched
  let brighterLeft = 0
  let fainterTaken = 0
  for (let i = 0; i < stars.randoms.length; i++) {
    const isBright = fromSun(i) < 6.5
    if (isBright && Number.isFinite(left.randoms[i])) brighterLeft++
    if (!isBright && left.randoms[i] !== stars.randoms[i]) fainterTaken++
  }
  expect(brighterLeft).toBe(0)
  expect(fainterTaken).toBe(0)
  expect(left.randoms).not.toBe(stars.randoms)
  expect(left.positions).toBe(stars.positions)
})

test('the resolved region of the glow is exactly the reach of the star box', () => {
  expect(RESOLVED_RADIUS_KPC * KPC_LY).toBeCloseTo(STAR_BOX_LY / 2, 6)
})

test('open clusters: some stars sit far closer together than the field stars do', () => {
  // Arrange
  const stars = generateStars(20_000, 3)
  const clustered = stars.positions.slice(0, CLUSTER_MEMBERS * 3)

  // Act: the first members all belong to one cluster
  const centre = [0, 1, 2].map((axis) => clustered[axis])
  const spread = Math.max(...[...Array(CLUSTER_MEMBERS).keys()].map((i) =>
    Math.hypot(...centre.map((c, axis) => {
      const delta = clustered[i * 3 + axis] - c
      return delta - STAR_BOX_LY * Math.round(delta / STAR_BOX_LY)
    }))))

  // Assert
  expect(spread).toBeLessThan(STAR_BOX_LY / 10)
})
