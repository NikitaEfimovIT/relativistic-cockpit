// SI units unless a suffix says otherwise. Sources for every formula: FORMULAS.md.
// Convention: θ is the angle between the velocity and the direction TO the source;
// primed quantities are measured on the ship; D = ν′/ν (D > 1 is a blueshift).

export const C = 299_792_458
export const H = 6.62607015e-34
export const K_B = 1.380649e-23
export const SIGMA_SB = 5.670374419e-8
export const G0 = 9.80665
export const YEAR = 31_557_600
export const LY = C * YEAR
export const T_CMB = 2.72548

const E_CHARGE = 1.602176634e-19
const M_PROTON = 1.67262192369e-27
const MEV = 1e6 * E_CHARGE
const PROTON_REST_GEV = 0.93827

export const BETA_MAX = 0.999999
export const PHI_MAX = Math.atanh(BETA_MAX)

/** Mean interstellar hydrogen density, m⁻³. */
export const H_DENSITY = 1.8e6
/** Protons are stopped by the hull below this speed. */
export const HULL_BETA = 0.3
/** Acute dose that is generally fatal, Sv. */
export const LETHAL_DOSE = 6
const STOPPING_POWER = (2 * MEV * 1e-4) / 1e-3 // 2 MeV·cm²/g in J·m²/kg
const PROTON_WEIGHTING_FACTOR = 2

// ── Kinematics ────────────────────────────────────────────────────────────────

export interface Ship {
  readonly phi: number // rapidity; stored instead of β, which runs out of digits near c
  readonly tau: number // ship proper time, s
  readonly t: number // galaxy-frame time, s
  readonly x: number // galaxy-frame distance, m
}

export const rest = (): Ship => ({ phi: 0, tau: 0, t: 0, x: 0 })
export const betaOf = (phi: number): number => Math.tanh(phi)
export const gammaOf = (phi: number): number => Math.cosh(phi)
export const phiFromGamma = (gamma: number): number => Math.acosh(gamma)
export const oneMinusBeta = (phi: number): number => 2 / (Math.exp(2 * phi) + 1)

/**
 * Exact hyperbolic-motion step for constant proper acceleration `a` over proper time `dTau`.
 * Rapidity is clamped to [0, phiMax]; the rest of the step is a coast at constant γ.
 */
export function advanceShip(ship: Ship, a: number, dTau: number, phiMax: number = PHI_MAX): Ship {
  const phi = Math.min(phiMax, Math.max(0, ship.phi + (a * dTau) / C))
  const dPhi = phi - ship.phi
  const burn = dPhi === 0 ? 0 : (dPhi * C) / a
  const coast = dTau - burn
  const dtBurn = burn === 0 ? 0 : (C / a) * (Math.sinh(phi) - Math.sinh(ship.phi))
  const dxBurn = burn === 0 ? 0 : ((C * C) / a) * (Math.cosh(phi) - Math.cosh(ship.phi))
  return {
    phi,
    tau: ship.tau + dTau,
    t: ship.t + dtBurn + coast * Math.cosh(phi),
    x: ship.x + dxBurn + coast * C * Math.sinh(phi),
  }
}

// ── Aberration and Doppler (the shaders in sky.ts implement the same two maps) ────

export const aberrate = (cosTheta: number, beta: number): number =>
  (cosTheta + beta) / (1 + beta * cosTheta)

/** Aberration in half-angle form, tan(θ′/2) = e^(−φ)·tan(θ/2): exact at any speed, where cos θ′ runs out of digits. */
export const apparentAngle = (theta: number, phi: number): number => 2 * Math.atan(Math.exp(-phi) * Math.tan(theta / 2))

/** Angle from the course within which a fraction of the whole sky is seen, counting from straight ahead. */
export const skyFractionAngle = (fraction: number, phi: number): number =>
  apparentAngle(Math.acos(1 - 2 * fraction), phi)

/** Where a direction in the galaxy's frame appears from the ship: same bearing around the course, closer to it. */
export function apparentDirection(direction: readonly [number, number, number], phi: number): readonly [number, number, number] {
  const [x, y, z] = direction
  const sideways = Math.hypot(x, y)
  if (sideways === 0) return direction
  const seen = apparentAngle(Math.atan2(sideways, -z), phi)
  return [(x / sideways) * Math.sin(seen), (y / sideways) * Math.sin(seen), -Math.cos(seen)]
}

export const dopplerFromGalaxy = (cosTheta: number, phi: number): number =>
  Math.cosh(phi) * (1 + Math.tanh(phi) * cosTheta)

export const dopplerFromShip = (cosThetaShip: number, phi: number): number =>
  1 / (Math.cosh(phi) * (1 - cosThetaShip + oneMinusBeta(phi) * cosThetaShip))

/**
 * Fraction of the galaxy's sky inside a cone of `halfAngle` around the stern, as seen on the ship.
 * From cos θ = (cos θ′ − β)/(1 − β cos θ′), rewritten through 1 − β so it survives six nines.
 */
export function skyFractionAstern(halfAngle: number, phi: number): number {
  const cosShip = -Math.cos(halfAngle)
  const eps = oneMinusBeta(phi)
  return (0.5 * (1 + cosShip) * eps) / (1 - cosShip + eps * cosShip)
}

// ── Blackbody photometry ──────────────────────────────────────────────────────

const LUMINOUS_EFFICACY = 683 // lm/W
const MAGNITUDE_ZERO_LUX = 2.54e-6

export type Xyz = readonly [number, number, number]

const lobe = (w: number, a: number, mu: number, s1: number, s2: number): number => {
  const t = (w - mu) * (w < mu ? s1 : s2)
  return a * Math.exp(-0.5 * t * t)
}

export const cieX = (w: number): number =>
  lobe(w, 0.362, 442.0, 0.0624, 0.0374) + lobe(w, 1.056, 599.8, 0.0264, 0.0323) + lobe(w, -0.065, 501.1, 0.049, 0.0382)
export const cieY = (w: number): number =>
  lobe(w, 0.821, 568.8, 0.0213, 0.0247) + lobe(w, 0.286, 530.9, 0.0613, 0.0322)
export const cieZ = (w: number): number =>
  lobe(w, 1.217, 437.0, 0.0845, 0.0278) + lobe(w, 0.681, 459.0, 0.0385, 0.0725)

/** Planck spectral radiance B_λ, W·m⁻²·sr⁻¹·m⁻¹. */
export function planck(lambda: number, T: number): number {
  const x = (H * C) / (lambda * K_B * T)
  return x > 700 ? 0 : (2 * H * C * C) / lambda ** 5 / Math.expm1(x)
}

/** Tristimulus radiance of a blackbody, scaled so that Y is luminance in cd/m². */
export function blackbodyXYZ(T: number): Xyz {
  let [X, Y, Z] = [0, 0, 0]
  for (let nm = 360; nm <= 830; nm += 5) {
    const radiance = planck(nm * 1e-9, T) * 5e-9
    X += radiance * cieX(nm)
    Y += radiance * cieY(nm)
    Z += radiance * cieZ(nm)
  }
  return [X * LUMINOUS_EFFICACY, Y * LUMINOUS_EFFICACY, Z * LUMINOUS_EFFICACY]
}

export const illuminanceToMagnitude = (lux: number): number => -2.5 * Math.log10(lux / MAGNITUDE_ZERO_LUX)
export const magnitudeToIlluminance = (mag: number): number => MAGNITUDE_ZERO_LUX * 10 ** (-0.4 * mag)
/** Schneegans et al. 2025, eq. 2: L = 10.8·10⁴·10^(−0.4 S), with S in mag/arcsec² and L in cd/m². */
export const luminanceToSurfaceBrightness = (luminance: number): number => -2.5 * Math.log10(luminance / 10.8e4)

/** Stiles–Holladay veiling glare (Vos 2003): L_veil = 10·E/θ², with θ in degrees. */
export const STILES_HOLLADAY = 10
/**
 * Energy each octave of a glare pyramid must scatter to reproduce the law above. Schneegans et al. 2025,
 * eq. 3–4: ∫ w/(2πσ²) exp(−θ²/2σ²) d(ln σ) = w/(2πθ²), so w per unit ln σ is constant across the levels.
 */
export const GLARE_WEIGHT_PER_OCTAVE = 2 * Math.PI * Math.LN2 * STILES_HOLLADAY * (Math.PI / 180) ** 2

export const LUT_SIZE = 512
export const LOG_T_MIN = 0
export const LOG_T_MAX = 9
const LOG_FLOOR = -40

/** RGBA32F table of log₁₀(X, Y, Z) over log-spaced temperature; alpha is unused. */
export const BLACKBODY_LUT: Float32Array = (() => {
  const data = new Float32Array(LUT_SIZE * 4)
  for (let i = 0; i < LUT_SIZE; i++) {
    const T = 10 ** (LOG_T_MIN + ((LOG_T_MAX - LOG_T_MIN) * i) / (LUT_SIZE - 1))
    const xyz = blackbodyXYZ(T)
    data.set([...xyz.map((v) => Math.max(LOG_FLOOR, Math.log10(v + 1e-300))), 1], i * 4)
  }
  return data
})()

export function lutXYZ(T: number): Xyz {
  const u = ((Math.log10(T) - LOG_T_MIN) / (LOG_T_MAX - LOG_T_MIN)) * (LUT_SIZE - 1)
  const clamped = Math.min(LUT_SIZE - 1.001, Math.max(0, u))
  const i = Math.floor(clamped)
  const f = clamped - i
  const channel = (c: number): number =>
    10 ** (BLACKBODY_LUT[i * 4 + c] * (1 - f) + BLACKBODY_LUT[(i + 1) * 4 + c] * f)
  return [channel(0), channel(1), channel(2)]
}

const REAR_REFERENCE_T = 1e4
const REAR_MAX_GAIN = 1e6

/**
 * Automatic gain of the rear camera: undoes the visible-band dimming of a 10 000 K star dead astern,
 * Y(DT)/(D²·Y(T)), up to the sensor limit. Past that limit the picture really does go black.
 */
export function rearCameraGain(phi: number): number {
  const D = Math.exp(-phi)
  const dimming = lutXYZ(REAR_REFERENCE_T * D)[1] / (D * D * lutXYZ(REAR_REFERENCE_T)[1])
  return Math.min(REAR_MAX_GAIN, Math.max(1, 1 / dimming))
}

/** Illuminance (lx) on a plane facing forward, from an isotropic blackbody sky blueshifted by the ship's speed. */
export function forwardIlluminance(phi: number, temperature: number = T_CMB): number {
  const gamma = Math.cosh(phi)
  const eps = oneMinusBeta(phi)
  const STEPS = 96
  const thetaMin = 1e-6
  const ratio = (Math.PI / 2 / thetaMin) ** (1 / STEPS)
  let sum = 0
  for (let i = 0; i < STEPS; i++) {
    const t0 = thetaMin * ratio ** i
    const t1 = t0 * ratio
    const t = Math.sqrt(t0 * t1)
    const oneMinusCos = 2 * Math.sin(t / 2) ** 2
    const D = 1 / (gamma * (oneMinusCos + eps * Math.cos(t)))
    sum += lutXYZ(temperature * D)[1] * Math.cos(t) * Math.sin(t) * (t1 - t0)
  }
  return 2 * Math.PI * sum
}

// ── Interstellar hydrogen ─────────────────────────────────────────────────────

/** Proton flux in the ship frame, m⁻²·s⁻¹: Φ = γβnc. */
export const protonFlux = (phi: number, density: number = H_DENSITY): number => Math.sinh(phi) * density * C

export const protonEnergyGeV = (phi: number): number => (Math.cosh(phi) - 1) * PROTON_REST_GEV

/** Kinetic energy carried by the oncoming protons, W/m². */
export const energyFlux = (phi: number): number => protonFlux(phi) * (Math.cosh(phi) - 1) * M_PROTON * C * C

/** Unshielded dose rate per second of ship time, Sv/s. */
export const doseRate = (phi: number): number =>
  Math.tanh(phi) < HULL_BETA ? 0 : PROTON_WEIGHTING_FACTOR * protonFlux(phi) * STOPPING_POWER

/** Field integral needed to bend an oncoming proton, T·m: Bρ = p/e. */
export const fieldIntegral = (phi: number): number => (Math.sinh(phi) * M_PROTON * C) / E_CHARGE
