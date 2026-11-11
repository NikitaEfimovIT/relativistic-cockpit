// Every expected value here is copied from a published source; see FORMULAS.md.
import { describe, expect, test } from 'vitest'
import {
  BETA_MAX, C, G0, GLARE_WEIGHT_PER_OCTAVE, LY, PHI_MAX, SIGMA_SB, STILES_HOLLADAY, T_CMB, YEAR,
  aberrate, advanceShip, apparentAngle, apparentDirection, betaOf, blackbodyXYZ, cieY, dopplerFromGalaxy, dopplerFromShip,
  doseRate, fieldIntegral, forwardIlluminance, gammaOf, illuminanceToMagnitude, luminanceToSurfaceBrightness, lutXYZ,
  magnitudeToIlluminance, oneMinusBeta, phiFromGamma, planck, protonEnergyGeV, protonFlux, rearCameraGain, rest,
  skyFractionAngle, skyFractionAstern,
} from './physics'

const AU = 1.495978707e11
const R_SUN = 6.957e8

describe('relativistic rocket (Gibbs & Baez FAQ table, a = 1.03 ly/yr²)', () => {
  const a = (1.03 * LY) / YEAR ** 2
  const rows = [
    { tauYr: 1, tYr: 1.19, dLy: 0.56, gamma: 1.58 },
    { tauYr: 2, tYr: 3.75, dLy: 2.9, gamma: 3.99 },
    { tauYr: 5, tYr: 83.7, dLy: 82.7, gamma: 86.2 },
    { tauYr: 8, tYr: 1840, dLy: 1839, gamma: 1895 },
  ]

  test.each(rows)('τ = $tauYr yr gives published t, d, γ', ({ tauYr, tYr, dLy, gamma }) => {
    // Arrange: an uncapped ship, because the FAQ table goes past our 99.9999 % limit.
    const uncapped = Infinity

    // Act
    const ship = advanceShip(rest(), a, tauYr * YEAR, uncapped)

    // Assert
    expect(ship.t / YEAR / tYr).toBeCloseTo(1, 2)
    expect(ship.x / LY / dLy).toBeCloseTo(1, 2)
    expect(gammaOf(ship.phi) / gamma).toBeCloseTo(1, 2)
  })

  test('25 000 ly trip at 1 g: γ = 12 877, 19.7 ship years, 25 002 Earth years (Edelstein 2012, §4)', () => {
    // Arrange: accelerate for the first 12 500 ly, which by symmetry is half of the published trip.
    const halfTauYears = 19.7 / 2

    // Act
    const halfway = advanceShip(rest(), a, halfTauYears * YEAR, Infinity)

    // Assert
    expect(gammaOf(halfway.phi) / 12_877).toBeCloseTo(1, 1)
    expect((2 * halfway.t) / YEAR / 25_002).toBeCloseTo(1, 1)
    expect(halfway.x / LY / 12_500).toBeCloseTo(1, 1)
  })

  test('integration is exact: many small steps equal one big step', () => {
    const big = advanceShip(rest(), G0, 5 * YEAR)
    const small = Array.from({ length: 500 }).reduce<ReturnType<typeof rest>>(
      (s) => advanceShip(s, G0, YEAR / 100), rest())
    expect(small.phi).toBeCloseTo(big.phi, 9)
    expect(small.x / big.x).toBeCloseTo(1, 9)
    expect(small.t / big.t).toBeCloseTo(1, 9)
  })

  test('speed is capped at 99.9999 % and the ship then coasts at constant γ', () => {
    const ship = advanceShip(rest(), G0, 50 * YEAR)
    expect(ship.phi).toBe(PHI_MAX)
    expect(betaOf(ship.phi)).toBeCloseTo(BETA_MAX, 12)
    expect(gammaOf(ship.phi)).toBeCloseTo(707.1, 0)
    const later = advanceShip(ship, 0, YEAR)
    expect((later.t - ship.t) / (gammaOf(ship.phi) * YEAR)).toBeCloseTo(1, 9)
  })

  test('braking stops at rest instead of reversing', () => {
    const moving = advanceShip(rest(), G0, YEAR)
    const stopped = advanceShip(moving, -G0, 10 * YEAR)
    expect(stopped.phi).toBe(0)
    expect(stopped.x).toBeGreaterThan(moving.x)
  })

  test('1 − β stays accurate where tanh would lose digits', () => {
    expect(oneMinusBeta(PHI_MAX) / 1e-6).toBeCloseTo(1, 7)
  })
})

describe('aberration and Doppler', () => {
  test('β = 0.75, θ = 90° is seen at θ′ = 41.4° (Gravity Probe B Q&A)', () => {
    const thetaPrime = Math.acos(aberrate(0, 0.75))
    expect((thetaPrime * 180) / Math.PI).toBeCloseTo(41.4, 1)
  })

  test('both Doppler forms agree across the sky', () => {
    const phi = 3
    for (const cosTheta of [-0.999, -0.5, 0, 0.5, 0.999]) {
      const cosShip = aberrate(cosTheta, betaOf(phi))
      expect(dopplerFromShip(cosShip, phi) / dopplerFromGalaxy(cosTheta, phi)).toBeCloseTo(1, 9)
    }
  })

  test('a source abeam in the ship frame is redshifted by 1/γ', () => {
    expect(dopplerFromShip(0, 2)).toBeCloseTo(1 / gammaOf(2), 12)
  })

  test('D = 1 at cos θ₀ = √((γ−1)/(γ+1)) (Yurtsever & Wilkinson eq. 29)', () => {
    const gamma = 100
    const phi = phiFromGamma(gamma)
    expect(dopplerFromShip(Math.sqrt((gamma - 1) / (gamma + 1)), phi)).toBeCloseTo(1, 9)
  })

  test('solid angle transforms as dΩ′ = dΩ/D², which gives point flux ∝ D²', () => {
    const beta = 0.9
    const phi = Math.atanh(beta)
    for (const c of [-0.8, -0.2, 0.3, 0.9]) {
      const h = 1e-6
      const jacobian = (aberrate(c + h, beta) - aberrate(c - h, beta)) / (2 * h)
      expect(jacobian * dopplerFromGalaxy(c, phi) ** 2).toBeCloseTo(1, 6)
    }
  })

  test('boosted Planck radiance obeys L′λ = D⁵ Lλ, i.e. stays Planck at T′ = DT (Weiskopf 1999)', () => {
    const D = 7.3
    const T = 5000
    for (const lambdaShip of [400e-9, 550e-9, 700e-9]) {
      const ratio = planck(lambdaShip, D * T) / (D ** 5 * planck(lambdaShip * D, T))
      expect(ratio).toBeCloseTo(1, 9)
    }
  })

  test('fraction of the galaxy sky inside an astern cone follows from aberration', () => {
    const halfAngle = (50 * Math.PI) / 180
    const beta = 0.9
    const cosShip = -Math.cos(halfAngle)
    const viaAberration = (1 + aberrate(cosShip, -beta)) / 2
    expect(skyFractionAstern(halfAngle, 0)).toBeCloseTo((1 - Math.cos(halfAngle)) / 2, 12)
    expect(skyFractionAstern(halfAngle, Math.atanh(beta))).toBeCloseTo(viaAberration, 12)
    expect(skyFractionAstern(Math.PI, 3)).toBeCloseTo(1, 12)
  })

  test('forward CMB at 99.9999 % c is a 3850 K blackbody', () => {
    expect(T_CMB * dopplerFromShip(1, PHI_MAX)).toBeCloseTo(3854, 0)
  })
})

describe('blackbody photometry', () => {
  test('Planck integrates to the Stefan–Boltzmann law', () => {
    const T = 5772
    const dLambda = 1e-9
    let sum = 0
    for (let l = 10e-9; l < 100e-6; l += dLambda) sum += planck(l, T) * dLambda
    expect((sum * Math.PI) / (SIGMA_SB * T ** 4)).toBeCloseTo(1, 2)
  })

  test('Planck does not overflow to NaN deep in the Wien tail', () => {
    expect(planck(400e-9, 1)).toBe(0)
  })

  test('Wyman ȳ fit peaks near 1 at 555–560 nm', () => {
    expect(cieY(557)).toBeCloseTo(1, 1)
  })

  test('6500 K sits at the published Planckian chromaticity (x, y) = (0.3135, 0.3237)', () => {
    const [X, Y, Z] = blackbodyXYZ(6500)
    expect(X / (X + Y + Z)).toBeCloseTo(0.3135, 2)
    expect(Y / (X + Y + Z)).toBeCloseTo(0.3237, 2)
  })

  test('absolute scale: the Sun gives about 1.27·10⁵ lx and V ≈ −26.7', () => {
    const omega = Math.PI * (R_SUN / AU) ** 2
    const lux = blackbodyXYZ(5772)[1] * omega
    expect(lux / 1.27e5).toBeCloseTo(1, 1)
    expect(illuminanceToMagnitude(lux)).toBeCloseTo(-26.74, 0)
  })

  test('a star far up the Rayleigh–Jeans tail dims by 2.5 magnitudes per decade of D', () => {
    const fluxAt = (D: number): number => lutXYZ(5000 * D)[1] / (D * D)
    const magnitudes = -2.5 * Math.log10(fluxAt(10_000) / fluxAt(1000))
    expect(magnitudes).toBeCloseTo(2.5, 1)
  })

  test('the LUT reproduces direct integration', () => {
    for (const T of [50, 900, 3854, 25000, 3e7]) {
      const [, direct] = blackbodyXYZ(T)
      const [, viaLut] = lutXYZ(T)
      if (direct > 1e-30) expect(viaLut / direct).toBeCloseTo(1, 1)
    }
  })

  test('rear camera gain starts at 1, grows with speed and saturates at the sensor limit', () => {
    expect(rearCameraGain(0)).toBeCloseTo(1, 9)
    expect(rearCameraGain(1)).toBeGreaterThan(rearCameraGain(0.5))
    expect(rearCameraGain(PHI_MAX)).toBe(1e6)
  })

  test('forward CMB illuminance is nil at rest and huge at 99.9999 % c', () => {
    expect(forwardIlluminance(0)).toBeLessThan(1e-30)
    expect(forwardIlluminance(PHI_MAX)).toBeGreaterThan(10)
    expect(forwardIlluminance(PHI_MAX)).toBeLessThan(1e5)
  })
})

describe('interstellar hydrogen (Edelstein & Edelstein 2012, tables 1 and 2)', () => {
  const table = [
    { gamma: 10, fluxE15: 5.4, sievertPerSecond: 346, gev: 8.5 },
    { gamma: 100, fluxE15: 54, sievertPerSecond: 3460, gev: 93 },
    { gamma: 1000, fluxE15: 540, sievertPerSecond: 34600, gev: 939 },
  ]

  test.each(table)('γ = $gamma matches flux, dose and proton energy', (row) => {
    const phi = phiFromGamma(row.gamma)
    expect(protonFlux(phi) / (row.fluxE15 * 1e15)).toBeCloseTo(1, 1)
    expect(doseRate(phi) / row.sievertPerSecond).toBeCloseTo(1, 1)
    expect(protonEnergyGeV(phi) / row.gev).toBeCloseTo(1, 1)
  })

  test('below 0.3 c the hull stops the flow (Semyonov 2009)', () => {
    expect(doseRate(Math.atanh(0.29))).toBe(0)
    expect(doseRate(Math.atanh(0.31))).toBeGreaterThan(0)
  })

  test('magnetic rigidity Bρ = p/e reproduces the 7 TeV LHC value of 23 350 T·m', () => {
    const massProtonGeV = 0.93827
    const phi = Math.asinh(7000 / massProtonGeV)
    expect(fieldIntegral(phi) / 23350).toBeCloseTo(1, 2)
  })
})

test('constants: 1 g ≈ 1.03 ly/yr² as quoted by the FAQ', () => {
  expect((G0 * YEAR) / C).toBeCloseTo(1.03, 2)
})

test('Gaussians of doubling σ and equal energy sum to the Stiles–Holladay law (Schneegans 2025, eq. 3–4)', () => {
  // Arrange
  const DEG = Math.PI / 180
  const gaussian = (theta: number, sigma: number) => Math.exp(-(theta * theta) / (2 * sigma * sigma)) / (2 * Math.PI * sigma * sigma)
  const glare = (thetaDeg: number, weightOf: (level: number) => number) => {
    let sum = 0
    for (let i = 0; i < 14; i++) sum += weightOf(i) * gaussian(thetaDeg * DEG, 0.02 * DEG * 2 ** i)
    return sum
  }

  // Act & Assert: within 3 % of 10/θ² from 1° to 20°
  for (const theta of [1, 2, 5, 10, 20]) {
    expect(glare(theta, () => GLARE_WEIGHT_PER_OCTAVE) / (STILES_HOLLADAY / (theta * theta))).toBeCloseTo(1, 1)
  }
  // The energy of a blurred image is the same at every level, so halving it per level would fall as 1/θ³.
  const halved = (i: number) => 2 ** -i
  expect(glare(2, halved) / glare(8, halved)).toBeGreaterThan(40)
  expect(glare(2, () => 1) / glare(8, () => 1)).toBeCloseTo(16, -1)
})

test('surface brightness converts to luminance as in Schneegans 2025, eq. 2', () => {
  expect(luminanceToSurfaceBrightness(10.8e4)).toBeCloseTo(0, 6)
  expect(luminanceToSurfaceBrightness(4.3e-4)).toBeCloseTo(21, 1)
  // One V = 0 star per square arcsecond is the published zero point of the magnitude scale.
  const ARCSEC2 = (Math.PI / 180 / 3600) ** 2
  expect(10.8e4 * ARCSEC2).toBeCloseTo(magnitudeToIlluminance(0), 7)
})

describe('where the sky has gone, for the indicators on the glass', () => {
  const DEG = Math.PI / 180

  test('the half-angle form of aberration agrees with the cosine form', () => {
    for (const beta of [0.1, 0.5, 0.9, 0.999]) {
      for (const theta of [10, 45, 90, 135, 170].map((degrees) => degrees * DEG)) {
        expect(Math.cos(apparentAngle(theta, Math.atanh(beta)))).toBeCloseTo(aberrate(Math.cos(theta), beta), 10)
      }
    }
  })

  test('half of the sky lies within cos θ′ = β of the course', () => {
    expect(skyFractionAngle(0.5, 0)).toBeCloseTo(90 * DEG, 10)
    expect(Math.cos(skyFractionAngle(0.5, Math.atanh(0.9)))).toBeCloseTo(0.9, 10)
    expect(skyFractionAngle(0.5, Math.atanh(0.9)) / DEG).toBeCloseTo(25.84, 2)
  })

  test('the ring keeps its precision at the speed limit, where the cosine form cannot', () => {
    // θ′ = 2·atan(e^−φ), and at six nines e^−φ = 7.07·10⁻⁴
    expect(skyFractionAngle(0.5, PHI_MAX)).toBeCloseTo(2 * Math.atan(Math.exp(-PHI_MAX)), 12)
    expect(skyFractionAngle(0.5, PHI_MAX) / DEG).toBeCloseTo(0.081, 3)
  })

  test('more of the sky needs a wider ring, and the whole sky fills the view', () => {
    const phi = Math.atanh(0.9)
    expect(skyFractionAngle(0.9, phi)).toBeGreaterThan(skyFractionAngle(0.5, phi))
    expect(skyFractionAngle(1, phi) / DEG).toBeCloseTo(180, 6)
  })

  test('a direction keeps its bearing around the course and only slides towards it', () => {
    // Arrange: 60° off the course, up and to the right
    const theta = 60 * DEG
    const bearing = 30 * DEG
    const direction = [Math.sin(theta) * Math.cos(bearing), Math.sin(theta) * Math.sin(bearing), -Math.cos(theta)] as const

    // Act
    const seen = apparentDirection(direction, Math.atanh(0.9))

    // Assert
    expect(Math.hypot(...seen)).toBeCloseTo(1, 12)
    expect(Math.atan2(seen[1], seen[0])).toBeCloseTo(bearing, 10)
    expect(-seen[2]).toBeCloseTo(aberrate(Math.cos(theta), 0.9), 10)
    expect(apparentDirection(direction, 0)[0]).toBeCloseTo(direction[0], 12)
    expect(apparentDirection([0, 0, -1], 5)).toEqual([0, 0, -1])
  })
})
