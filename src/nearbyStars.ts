import { KPC_LY, R_SUN, SUN, type Vec3 } from './galaxy'
import { LY, lutXYZ, magnitudeToIlluminance } from './physics'

// The real stars a flight can be aimed at: the neighbours, some bright stars further out, and Betelgeuse. Positions,
// parallaxes and V come from SIMBAD (queried November 2026; parallaxes from Gaia EDR3, Hipparcos 2007 or Söderhjelm
// 1999 for α Cen). Temperatures are the mean of the SIMBAD measurements published since 2000, row by row, to 10 K.
// Proper motions are left out: in a few decades they move nothing.

/** ICRS to galactic rotation; rows are the galactic axes (Hipparcos catalogue, ESA 1997, vol. 1, §1.5.3). */
const ICRS_TO_GALACTIC: readonly Vec3[] = [
  [-0.0548755604, -0.873437090, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
]

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const DEG = Math.PI / 180

export const equatorialToGalactic = (v: Vec3): Vec3 => [dot(ICRS_TO_GALACTIC[0], v), dot(ICRS_TO_GALACTIC[1], v), dot(ICRS_TO_GALACTIC[2], v)]

/** Unit vector towards right ascension and declination, both in degrees, in equatorial axes. */
export const equatorialDirection = (ra: number, dec: number): Vec3 =>
  [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)]

export const LY_PER_PC = 3.261563777
export const AU_LY = 1.495978707e11 / LY
const SOLAR_RADIUS_LY = 6.957e8 / LY // IAU 2015 B3
const T_SUN = 5772 // K, IAU 2015 B3

interface CatalogStar {
  readonly name: string
  readonly ra: number // deg, ICRS
  readonly dec: number
  readonly parallax: number // mas
  readonly v: number // apparent V magnitude
  readonly temperature: number // K
}

const CATALOG: readonly CatalogStar[] = [
  { name: 'Проксима Центавра', ra: 217.42894, dec: -62.67949, parallax: 768.0665, v: 11.13, temperature: 3190 },
  { name: 'α Центавра A', ra: 219.90206, dec: -60.83399, parallax: 742.12, v: 0.01, temperature: 5750 },
  { name: 'α Центавра B', ra: 219.8961, dec: -60.83753, parallax: 742.12, v: 1.33, temperature: 5220 },
  { name: 'Звезда Барнарда', ra: 269.45208, dec: 4.69336, parallax: 546.9759, v: 9.511, temperature: 3250 },
  { name: 'Вольф 359', ra: 164.1205, dec: 7.01472, parallax: 415.1794, v: 13.507, temperature: 2860 },
  { name: 'Лаланд 21185', ra: 165.83415, dec: 35.96988, parallax: 392.7529, v: 7.52, temperature: 3640 },
  { name: 'Сириус', ra: 101.28716, dec: -16.71612, parallax: 379.21, v: -1.46, temperature: 9690 },
  { name: 'ε Эридана', ra: 53.23269, dec: -9.45826, parallax: 310.5773, v: 3.73, temperature: 5090 },
  { name: '61 Лебедя A', ra: 316.72475, dec: 38.74942, parallax: 285.9949, v: 5.21, temperature: 4420 },
  { name: 'Процион', ra: 114.8255, dec: 5.22499, parallax: 284.56, v: 0.37, temperature: 6590 },
  { name: 'ε Индейца', ra: 330.84022, dec: -56.78598, parallax: 274.8431, v: 4.69, temperature: 4720 },
  { name: 'τ Кита', ra: 26.01701, dec: -15.93748, parallax: 273.8097, v: 3.5, temperature: 5350 },
  { name: 'Альтаир', ra: 297.69583, dec: 8.86832, parallax: 194.95, v: 0.76, temperature: 7400 },
  { name: 'Вега', ra: 279.23473, dec: 38.78369, parallax: 130.23, v: 0.03, temperature: 9480 },
  { name: 'Фомальгаут', ra: 344.41269, dec: -29.62224, parallax: 129.81, v: 1.16, temperature: 8470 },
  { name: 'Арктур', ra: 213.9153, dec: 19.18241, parallax: 88.83, v: -0.05, temperature: 4300 },
  // A red supergiant, its V wandering 0.0–1.6. Hipparcos 2007, as SIMBAD has it; its distance is disputed: 548 ly from
  // asteroseismology (Joyce et al. 2020), 724 ly from radio astrometry (Harper et al. 2017). Teff 3540–4250 K by paper.
  { name: 'Бетельгейзе', ra: 88.79294, dec: 7.40706, parallax: 6.55, v: 0.42, temperature: 3710 },
]

export interface Body {
  readonly name: string
  readonly position: Vec3 // ly from the Sun, galactic axes
  readonly temperature: number // K; 0 for a place that is not drawn as a star
  readonly radiusSquared: number // ly², of the blackbody that has the star's V magnitude
  readonly standoff: number // ly; where to stop: as far out as the Earth is from the Sun, for the star's luminosity
}

/**
 * R² of a blackbody at T that is as bright in V as the star: E = Y(T)·πR²/d². For an M dwarf this is not its true size,
 * since molecular bands take light out of V, but it is the right brightness on the screen.
 */
export const visualRadiusSquared = (v: number, temperature: number, distanceLy: number): number =>
  (magnitudeToIlluminance(v) * distanceLy * distanceLy) / (Math.PI * lutXYZ(temperature)[1])

/** L/L☉ by Stefan–Boltzmann, from R² in ly² and T in K. */
export const luminosityOf = (radiusSquared: number, temperature: number): number =>
  (radiusSquared / SOLAR_RADIUS_LY ** 2) * (temperature / T_SUN) ** 4

const MIN_STANDOFF_AU = 0.05

const fromCatalog = ({ name, ra, dec, parallax, v, temperature }: CatalogStar): Body => {
  const distance = (1000 / parallax) * LY_PER_PC
  const [x, y, z] = equatorialToGalactic(equatorialDirection(ra, dec))
  const radiusSquared = visualRadiusSquared(v, temperature, distance)
  const standoff = Math.max(MIN_STANDOFF_AU, Math.sqrt(luminosityOf(radiusSquared, temperature))) * AU_LY
  return { name, position: [x * distance, y * distance, z * distance], temperature, radiusSquared, standoff }
}

const SUN_BODY: Body = { name: 'Солнце', position: [0, 0, 0], temperature: T_SUN, radiusSquared: SOLAR_RADIUS_LY ** 2, standoff: AU_LY }

/** Sgr A*: nothing to draw, the bulge in the bake is what shows there. Stop well outside the central cluster. */
const GALACTIC_CENTRE: Body = {
  name: 'Центр Галактики',
  position: [-SUN[0] * KPC_LY, -SUN[1] * KPC_LY, -SUN[2] * KPC_LY],
  temperature: 0,
  radiusSquared: 0,
  standoff: 0.01 * R_SUN * KPC_LY,
}

/** Every place a course can be set for: the Sun first, the stars by distance, the centre of the Galaxy last. */
export const BODIES: readonly Body[] = [SUN_BODY, ...CATALOG.map(fromCatalog), GALACTIC_CENTRE]

/** The ones drawn as stars. */
export const STARS: readonly Body[] = BODIES.filter((body) => body.temperature > 0)

export const indexOfBody = (name: string): number => {
  const index = BODIES.findIndex((body) => body.name === name)
  if (index < 0) throw new Error(`No such body in the table: ${name}`)
  return index
}
