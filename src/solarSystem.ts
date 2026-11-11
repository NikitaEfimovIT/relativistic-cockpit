import type { Vec3 } from './galaxy'
import { AU_LY, BODIES, equatorialToGalactic, type Body } from './nearbyStars'
import { hillRadius } from './orbit'
import { LY } from './physics'

// Where the Earth is, and which way it faces, on a given date; and the Moon and the planets, as they stand at launch.
// The Sun's place is referred to J2000, the axes of the sky, so it stands among the stars and the planets where JPL
// Horizons puts it (0.2′ at launch). The Earth's turning is still reckoned from the equinox of date: 0.4° on the globe.

const DEG = Math.PI / 180
const J2000 = 2451545.0
export const DAY = 86_400
/** °/century by which the equinox of date runs ahead of J2000's (IAU 2006 precession, p_A). */
const PRECESSION = 5028.796195 / 3600
/** Obliquity of J2000, as in JPL's approximate positions of the planets. */
const OBLIQUITY = 23.43928 * DEG

/** 2027-05-01 0h UT. α Centauri, the first target, is then near opposition, so the Sun is behind the ship at launch. */
export const LAUNCH_JD = 2_461_526.5
export const EARTH_RADIUS_M = 6.371e6
/** Bond albedo of the Earth (Stephens et al. 2015, CERES). */
export const EARTH_ALBEDO = 0.3

export interface SunPlace {
  readonly direction: Vec3 // unit, from the Earth, equatorial axes
  readonly distanceAu: number
}

/** The Sun seen from the Earth: Astronomical Almanac low-precision formulae, good to 0.01° over 1950–2050, in J2000. */
export function sunFromEarth(jd: number): SunPlace {
  const n = jd - J2000
  const meanLongitude = 280.46 + 0.9856474 * n - PRECESSION * (n / 36525)
  const anomaly = (357.528 + 0.9856003 * n) * DEG
  const longitude = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * DEG
  return {
    direction: [Math.cos(longitude), Math.cos(OBLIQUITY) * Math.sin(longitude), Math.sin(OBLIQUITY) * Math.sin(longitude)],
    distanceAu: 1.00014 - 0.01671 * Math.cos(anomaly) - 0.00014 * Math.cos(2 * anomaly),
  }
}

/** The Earth, ly from the Sun in galactic axes. */
export function earthPosition(jd: number): Vec3 {
  const { direction, distanceAu } = sunFromEarth(jd)
  const [x, y, z] = equatorialToGalactic(direction)
  const scale = -distanceAu * AU_LY
  return [x * scale, y * scale, z * scale]
}

/** Greenwich mean sidereal angle, rad: how far the Earth has turned (Astronomical Almanac). */
export const greenwichAngle = (jd: number): number => ((280.46061837 + 360.98564736629 * (jd - J2000)) % 360) * DEG

export interface EarthAxes {
  readonly greenwich: Vec3 // towards 0° longitude on the equator, galactic axes
  readonly east: Vec3 // towards 90° E on the equator
  readonly pole: Vec3 // the north pole
}

/** The Earth-fixed frame on a date, for laying its map on the globe. */
export function earthAxes(jd: number): EarthAxes {
  const angle = greenwichAngle(jd)
  return {
    greenwich: equatorialToGalactic([Math.cos(angle), Math.sin(angle), 0]),
    east: equatorialToGalactic([-Math.sin(angle), Math.cos(angle), 0]),
    pole: equatorialToGalactic([0, 0, 1]),
  }
}

/**
 * A body's spin as the IAU gives it: the north pole at right ascension α0 + α1·T and declination δ0 + δ1·T (deg, ICRF;
 * T Julian centuries from J2000), and the prime meridian W0 + W1·d (deg, d days) east of the node of its equator on the
 * ICRF equator.
 */
export interface Spin {
  readonly ra: readonly [number, number]
  readonly dec: readonly [number, number]
  readonly w: readonly [number, number]
}

/**
 * IAU WGCCRE 2015 (Archinal et al. 2018, Celest. Mech. Dyn. Astr. 130:22), as NAIF's pck00011 has them. Mars's and
 * Jupiter's periodic terms, hundredths of a degree, are left out. Jupiter's W is System III, its magnetic field's.
 */
export const SPINS: Readonly<Record<string, Spin>> = {
  'Меркурий': { ra: [281.0103, -0.0328], dec: [61.4155, -0.0049], w: [329.5988, 6.1385108] },
  'Марс': { ra: [317.269202, -0.10927547], dec: [54.432516, -0.05827105], w: [176.049863, 350.891982443297] },
  'Юпитер': { ra: [268.056595, -0.006499], dec: [64.495303, 0.002413], w: [284.95, 870.536] },
  'Сатурн': { ra: [40.589, -0.036], dec: [83.537, -0.004], w: [38.9, 810.7939024] },
}

const crossed = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** The body-fixed frame on a date, for laying its map on the globe, in galactic axes. */
export function spinAxes(spin: Spin, jd: number): EarthAxes {
  const d = jd - J2000
  const T = d / 36525
  const ra = (spin.ra[0] + spin.ra[1] * T) * DEG
  const dec = (spin.dec[0] + spin.dec[1] * T) * DEG
  const w = ((spin.w[0] + spin.w[1] * d) % 360) * DEG
  const pole: Vec3 = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
  const node: Vec3 = [-Math.sin(ra), Math.cos(ra), 0]
  const across = crossed(pole, node) // 90° east of the node along the equator
  const [c, s] = [Math.cos(w), Math.sin(w)]
  const greenwich: Vec3 = [node[0] * c + across[0] * s, node[1] * c + across[1] * s, node[2] * c + across[2] * s]
  return { greenwich: equatorialToGalactic(greenwich), east: equatorialToGalactic(crossed(pole, greenwich)), pole: equatorialToGalactic(pole) }
}

/** The share of a Lambert sphere's light sent towards a phase angle α (Sun–body–observer), relative to full phase. */
export const lambertPhase = (alpha: number): number => (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI

// ── The Moon and the planets ────────────────────────────────────────────────────

const AU_M = 1.495978707e11
/** V of the Sun seen from 1 AU (Mallama et al. 2017, Icarus 282, 19, Table 6). */
const SUN_V = -26.75

export interface Globe {
  readonly name: string
  readonly position: Vec3 // ly from the Sun, galactic axes; frozen as at launch, like the Earth
  readonly radiusM: number
  /** Geometric albedo in the Rc, V and B bands, taken for the red, green and blue channels: only its hue is used. */
  readonly colour: Vec3
  /** Albedo of a Lambert surface that sends as much light as the body does towards phase angle α (rad). */
  readonly albedo: (alpha: number) => number
  readonly star: Body // the one that lights it
  readonly gm: number // m³/s²
  readonly hill: number // m: within this its pull is the one that counts (orbit.ts)
  readonly ceiling: number // m above radiusM where the air stops a ship; 0 for a body without air
  /** A surface no one has seen, drawn by a made-up pattern of its kind: bare rock, an ice giant's faint bands, a gas giant's. */
  readonly pattern?: 'rock' | 'ice' | 'gas'
}

/** The Sun's gravitational parameter, m³/s² (JPL astrodynamic parameters, DE440). */
export const SUN_GM = 1.32712440041279419e20
/**
 * Air this many scale heights deep stops a ship: choice, so that the Earth's comes to 100 km (12 × 8.5 km), the usual
 * edge of space. A ship without a heat shield does not live through more of it at orbital speed.
 */
export const SCALE_HEIGHTS_OF_AIR = 12

/** Its orbit round its parent and its air: a in AU, e, the scale height H in km (0 without air), GM in m³/s². */
interface Gravity {
  readonly gm: number
  readonly a: number
  readonly e: number
  readonly scaleHeightKm: number
}

const pull = ({ gm, a, e, scaleHeightKm }: Gravity, parentGm: number = SUN_GM): Pick<Globe, 'gm' | 'hill' | 'ceiling'> => ({
  gm, hill: hillRadius(a * AU_M, e, gm, parentGm), ceiling: SCALE_HEIGHTS_OF_AIR * scaleHeightKm * 1e3,
})

const EARTH_AT_LAUNCH = earthPosition(LAUNCH_JD)

/** Where a body is, from its place relative to the Earth's centre in km, ICRF axes. */
const fromEarth = (km: Vec3): Vec3 => {
  const [x, y, z] = equatorialToGalactic(km)
  const k = 1e3 / LY
  return [EARTH_AT_LAUNCH[0] + x * k, EARTH_AT_LAUNCH[1] + y * k, EARTH_AT_LAUNCH[2] + z * k]
}

/**
 * The Lambert albedo that gives a body the light of its measured magnitude law V(1, α), α in degrees: (3/2)·pΦ(α) over
 * the Lambert phase Φ_L(α), with pΦ = 10^(−0.4(V(1,α) − V☉))·(1 AU/R)². Past `alphaMax`, where the measurements end,
 * the albedo stays as it was there and the Lambert phase alone dims the body further.
 */
const measured = (radiusM: number, magnitude: (alpha: number) => number, alphaMax: number) => (alpha: number): number => {
  const clamped = Math.min(alpha, alphaMax * DEG)
  const seen = 10 ** (-0.4 * (magnitude(clamped / DEG) - SUN_V)) * (AU_M / radiusM) ** 2
  return (1.5 * seen) / lambertPhase(clamped)
}

const globe = (
  name: string, km: Vec3, radiusKm: number, colour: Vec3, magnitude: (alpha: number) => number, alphaMax: number, gravity: Gravity,
  parentGm: number = SUN_GM,
): Globe => ({
  name, position: fromEarth(km), radiusM: radiusKm * 1e3, colour, albedo: measured(radiusKm * 1e3, magnitude, alphaMax), star: BODIES[0],
  ...pull(gravity, parentGm),
})

// Gravity: GM from JPL's astrodynamic parameters (DE440; for Mars and beyond, the planet with its moons); a and e of
// each orbit round the Sun from JPL's approximate positions of the planets, table 1 (J2000; the Earth's is the
// Earth–Moon barycentre's); the Moon's round the Earth and every scale height from the NASA planetary fact sheets.
const EARTH_GM = 3.98600435507e14

// Places: JPL Horizons (DE441) for 2027-05-01 0h UT, from the Earth's centre, ICRF, light time included, so that from
// the Earth each body is where it is seen. Mean radii: NASA planetary fact sheets. Albedos in B, V and Rc: Mallama et al.
// 2017, Table 7. Magnitude laws: Mallama & Hilton 2018 (Astronomy and Computing 25, 10), the Astronomical Almanac's,
// without Saturn's rings, Uranus's latitude term or Mars's rotation and season terms; each is used as far as it was
// measured (Mars and the Moon: to 170°, a choice). The Moon's law is Allen's 0.026α + 4·10⁻⁹α⁴ with V(1,0) = 0.23, as
// Horizons has it: it matches Horizons to 0.001ᵐ from 8° to 172°. The Moon is grey until there is a map.

export const MOON = globe('Луна', [3.568668451402485e5, -1.657859348045439e5, -6.043715385592729e4], 1737.4, [1, 1, 1],
  (a) => 0.23 + 0.026 * a + 4e-9 * a ** 4, 170, { gm: 4.902800118e12, a: 3.844e8 / AU_M, e: 0.0549, scaleHeightKm: 0 }, EARTH_GM)

const jupiterPhase = (x: number): number => 1 - 1.507 * x - 0.363 * x ** 2 - 0.062 * x ** 3 + 2.809 * x ** 4 - 1.876 * x ** 5

export const PLANETS: readonly Globe[] = [
  globe('Меркурий', [1.451738562572148e8, 1.220531851666305e8, 5.315456163040429e7], 2439.7, [0.158, 0.142, 0.105],
    (a) => -0.613 + 6.328e-2 * a - 1.6336e-3 * a ** 2 + 3.3644e-5 * a ** 3 - 3.4265e-7 * a ** 4 + 1.6893e-9 * a ** 5 - 3.0334e-12 * a ** 6, 169.5,
    { gm: 2.2031868551e13, a: 0.38709927, e: 0.20563593, scaleHeightKm: 0 }),
  globe('Венера', [2.125142938753157e8, 4.666346522147031e7, 1.338439192729427e7], 6051.8, [0.658, 0.689, 0.658],
    (a) => (a <= 163.7 ? -4.384 - 1.044e-3 * a + 3.687e-4 * a ** 2 - 2.814e-6 * a ** 3 + 8.938e-9 * a ** 4 : 236.05828 - 2.81914 * a + 8.39034e-3 * a ** 2), 179,
    { gm: 3.24858592e14, a: 0.72333566, e: 0.00677672, scaleHeightKm: 15.9 }),
  globe('Марс', [-1.313399111504436e8, 8.163292630159065e7, 4.185469631565724e7], 3389.5, [0.25, 0.17, 0.088],
    (a) => (a <= 50 ? -1.601 + 0.02267 * a - 1.302e-4 * a ** 2 : -0.367 - 0.02573 * a + 3.445e-4 * a ** 2), 170,
    { gm: 4.2828375816e13, a: 1.52371034, e: 0.0933941, scaleHeightKm: 11.0 }),
  globe('Юпитер', [-5.645049695164984e8, 4.759283819464406e8, 2.20976712060303e8], 69911, [0.513, 0.538, 0.443],
    (a) => (a <= 12 ? -9.395 - 3.7e-4 * a + 6.16e-4 * a ** 2 : -9.428 - 2.5 * Math.log10(jupiterPhase(a / 180))), 130,
    { gm: 1.267127641e17, a: 5.202887, e: 0.04838624, scaleHeightKm: 27 }),
  globe('Сатурн', [1.44667818833075e9, 5.121464517986873e8, 1.560180385719502e8], 58232, [0.646, 0.499, 0.339],
    (a) => (a <= 6 ? -8.95 - 3.7e-4 * a + 6.16e-4 * a ** 2 : -8.94 + 2.446e-4 * a + 2.672e-4 * a ** 2 - 1.505e-6 * a ** 3 + 4.767e-9 * a ** 4), 150,
    { gm: 3.79405848418e16, a: 9.53667594, e: 0.05386179, scaleHeightKm: 59.5 }),
  globe('Уран', [1.338401338997117e9, 2.506485090592653e9, 1.080059112774176e9], 25362, [0.264, 0.488, 0.561],
    (a) => -7.11 + 6.587e-3 * a + 1.045e-4 * a ** 2, 154,
    { gm: 5.7945564e15, a: 19.18916464, e: 0.04725744, scaleHeightKm: 27.7 }),
  globe('Нептун', [4.572503472853096e9, 4.132988381769941e8, 6.03521831112927e7], 24622, [0.226, 0.442, 0.562],
    (a) => -7.0 + 7.944e-3 * a + 9.617e-5 * a ** 2, 133,
    { gm: 6.83652710058e15, a: 30.06992276, e: 0.00859048, scaleHeightKm: 19.7 }), // H 19.1–20.3 km: the middle
]

/** The Earth as a globe: drawn from its map, lit as a Lambert sphere of its Bond albedo. The colour is for no map. */
export const EARTH: Globe = {
  name: 'Земля', position: EARTH_AT_LAUNCH, radiusM: EARTH_RADIUS_M, colour: [0.392, 0.434, 0.512], albedo: () => EARTH_ALBEDO,
  star: BODIES[0], ...pull({ gm: EARTH_GM, a: 1.00000261, e: 0.01671123, scaleHeightKm: 8.5 }),
}

/**
 * The Moon's map frame, frozen like the rest: longitude 0 towards the Earth, north towards the ecliptic's pole. Libration,
 * up to 8° in longitude and 7° in latitude, and the 1.5° between the Moon's axis and that pole are left out.
 */
export const MOON_AXES: EarthAxes = (() => {
  const d = EARTH_AT_LAUNCH.map((c, i) => c - MOON.position[i])
  const length = Math.hypot(...d)
  const x: Vec3 = [d[0] / length, d[1] / length, d[2] / length]
  const p = equatorialToGalactic([0, -Math.sin(OBLIQUITY), Math.cos(OBLIQUITY)])
  const along = p[0] * x[0] + p[1] * x[1] + p[2] * x[2]
  const q = [p[0] - along * x[0], p[1] - along * x[1], p[2] - along * x[2]]
  const n = Math.hypot(...q)
  const z: Vec3 = [q[0] / n, q[1] / n, q[2] / n]
  return { greenwich: x, east: [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]], pole: z }
})()

/** In drawing order: the Earth last, since by the Earth it is in front of all the rest. */
export const GLOBES: readonly Globe[] = [MOON, ...PLANETS, EARTH]
