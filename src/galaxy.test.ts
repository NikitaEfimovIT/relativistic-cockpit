import { expect, test } from 'vitest'
import {
  COLOUR_EXCESS_SLOPE, EM_PER_RAYLEIGH, KPC_LY, R_SUN, SUN, colourTemperature, dustDensity, galactocentric,
  sightline, starDensityRatio, starlightExcess, stellarLight,
} from './galaxy'
import { lutXYZ, luminanceToSurfaceBrightness } from './physics'

test('the disc reproduces the local luminosity density and column of Flynn et al. 2006', () => {
  // Act
  const local = stellarLight([-R_SUN, 0, 0]).v
  let column = 0
  for (let z = -6; z < 6; z += 0.001) column += stellarLight([-R_SUN, 0, z + 0.0005]).v // one step is 1 pc

  // Assert: ρ_L = 0.056 L☉/pc³, Σ_L = 24.4 L☉/pc²
  expect(local).toBeCloseTo(0.056, 2)
  expect(column).toBeGreaterThan(23)
  expect(column).toBeLessThan(26)
})

test('the local column has the colour of the Flynn et al. 2006 mass-to-light ratios (B−V ≈ 0.58)', () => {
  // Act
  let [v, b] = [0, 0]
  for (let z = -6; z < 6; z += 0.001) {
    const light = stellarLight([-R_SUN, 0, z + 0.0005])
    v += light.v
    b += light.b
  }

  // Assert
  const bv = -2.5 * Math.log10(b / v)
  expect(bv).toBeGreaterThan(0.5)
  expect(bv).toBeLessThan(0.7)
})

test('integrated starlight at the galactic pole is about 23–24 mag/arcsec²', () => {
  const { luminanceV } = sightline(SUN, [0, 0, 1])
  const brightness = luminanceToSurfaceBrightness(luminanceV)
  expect(brightness).toBeGreaterThan(23)
  expect(brightness).toBeLessThan(24.2)
})

test('the disc seen edge-on is several times brighter than the pole, as in the night sky', () => {
  const pole = sightline(SUN, [0, 0, 1]).luminanceV
  const anticentre = sightline(SUN, [-1, 0, 0]).luminanceV
  expect(anticentre / pole).toBeGreaterThan(2)
  expect(anticentre / pole).toBeLessThan(30)
})

test('dust: about 30 mag of extinction to the galactic centre, and little towards the pole', () => {
  expect(sightline(SUN, [1, 0, 0], 8.2).extinctionV).toBeGreaterThan(20)
  expect(sightline(SUN, [1, 0, 0], 8.2).extinctionV).toBeLessThan(45)
  expect(sightline(SUN, [0, 0, 1]).extinctionV).toBeLessThan(0.3)
})

test('the dust layer is thinner than the stars, so that a dark lane runs along the band', () => {
  const atSun = dustDensity([-R_SUN, 0, 0])
  const above = dustDensity([-R_SUN, 0, 0.3])
  const starsAbove = stellarLight([-R_SUN, 0, 0.3]).v / stellarLight([-R_SUN, 0, 0]).v
  expect(above / atSun).toBeLessThan(starsAbove)
})

test('Ballesteros 2012 eq. 14 gives the colour temperature of the Sun and of an A0 star', () => {
  expect(colourTemperature(0.65)).toBeGreaterThan(5600)
  expect(colourTemperature(0.65)).toBeLessThan(6000)
  expect(colourTemperature(0)).toBeCloseTo(10125, -2)
})

test('colour excess as a shift of 1/T matches eq. 14 and dims a star by about A_V', () => {
  // Arrange: A_V = 1 mag, R_V = 3.1
  const excess = 1 / 3.1

  // Act: the shift in 1/T that eq. 14 implies between B−V = 0 and 1
  const slope = 1 / colourTemperature(1) - 1 / colourTemperature(0)
  const dimming = (T: number) => {
    const reddened = 1 / (1 / T + excess * COLOUR_EXCESS_SLOPE)
    return -2.5 * Math.log10(lutXYZ(reddened)[1] / lutXYZ(T)[1])
  }

  // Assert
  expect(COLOUR_EXCESS_SLOPE / slope).toBeCloseTo(1, 1)
  for (const T of [4000, 6000, 10000]) {
    expect(dimming(T)).toBeGreaterThan(0.5)
    expect(dimming(T)).toBeLessThan(1.5)
  }
})

test('one rayleigh of Hα is about 2.75 pc cm⁻⁶ of emission measure', () => {
  expect(EM_PER_RAYLEIGH).toBeGreaterThan(2.6)
  expect(EM_PER_RAYLEIGH).toBeLessThan(2.9)
})

test('a place given from the Sun in light years lands where the model has it', () => {
  expect(galactocentric([0, 0, 0])).toEqual(SUN)
  expect(galactocentric([R_SUN * KPC_LY, 0, 0])[0]).toBeCloseTo(0, 10) // the centre lies along +x
})

test('star density is local at the Sun, thins out of the plane, and hot stars hug the plane', () => {
  expect(starDensityRatio([-R_SUN, 0, 0], 6000)).toBeCloseTo(1, 5)
  expect(starDensityRatio([-R_SUN, 0, 0], 20000)).toBeCloseTo(1, 5)
  expect(starDensityRatio([-R_SUN, 0, 0.3], 6000)).toBeLessThan(0.5)
  expect(starDensityRatio([-R_SUN, 0, 0.3], 20000)).toBeLessThan(starDensityRatio([-R_SUN, 0, 0.3], 6000))
})

test('the eye adapts to the blueshifted starlight: nothing at rest, and more the faster the ship goes', () => {
  // Arrange: a uniform sky of mean luminance 1.5·10⁻⁴ cd/m² gives π times that on a plane at rest
  const atRest = Math.PI * 1.5e-4

  // Act
  const [half, near] = [starlightExcess(Math.atanh(0.5)), starlightExcess(Math.atanh(0.9))]

  // Assert
  expect(starlightExcess(0)).toBe(0)
  expect(half).toBeGreaterThan(3 * atRest)
  expect(near).toBeGreaterThan(half)
})
