import catalogue from './brightStars.json'
import { colourTemperature, type Vec3 } from './galaxy'
import { LY_PER_PC, STARS, equatorialDirection, equatorialToGalactic, visualRadiusSquared } from './nearbyStars'
import { illuminanceToMagnitude } from './physics'
import { starIlluminance } from './stars'

// The naked-eye sky as it is: every Hipparcos star brighter than V 6.5, at its place in space, so that the
// constellations are the real ones and come apart as the ship leaves the Sun. Where the data comes from:
// scripts/fetch-bright-stars.mjs. Positions are for 1991.25; in the decades since, proper motion has moved a handful of
// them by a few arcminutes and the rest by less.

/** The catalogue holds every star brighter than this, seen from the Sun. */
export const BRIGHT_LIMIT_V = 6.5
/** mas. A smaller parallax is a bound, not a measurement: such a star stands at 1 kpc, about as far as Hipparcos reached. */
const PARALLAX_FLOOR = 1
export const FARTHEST_LY = (1000 / PARALLAX_FLOOR) * LY_PER_PC
/** For the three stars the catalogue has no colour for: the Sun's. */
const SOLAR_BV = 0.65
/** A catalogue star this close to a target, and about as bright, is that target, which its own table draws. */
const SAME_PLACE = Math.cos((0.1 * Math.PI) / 180)
const SAME_BRIGHTNESS = 1 // mag

export interface SkyStar {
  readonly hip: number
  readonly position: Vec3 // ly from the Sun, galactic axes
  readonly temperature: number // K, from B−V as seen, reddening and all
  readonly radiusSquared: number // ly², of the blackbody as bright in V as the star is from the Sun
}

type Row = readonly [hip: number, ra: number, dec: number, v: number, bv: number | null, plx: number | null, ePlx: number | null]

const COLUMNS = 'hip,ra,dec,v,bv,plx,ePlx'
if (catalogue.columns.join() !== COLUMNS) throw new Error(`src/brightStars.json has columns ${catalogue.columns.join()}, expected ${COLUMNS}`)
const ROWS = catalogue.stars as unknown as readonly Row[]

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v)
  return [v[0] / length, v[1] / length, v[2] / length]
}

const TARGETS = STARS.slice(1).map((star) => { // the Sun first: it is not on the sky
  const distance = Math.hypot(...star.position)
  return { towards: unit(star.position), v: illuminanceToMagnitude(starIlluminance(star.temperature, star.radiusSquared, distance)) }
})

const isTarget = (direction: Vec3, v: number): boolean => TARGETS.some(({ towards, v: targetV }) =>
  towards[0] * direction[0] + towards[1] * direction[1] + towards[2] * direction[2] > SAME_PLACE && Math.abs(targetV - v) < SAME_BRIGHTNESS)

const toSkyStar = ([hip, ra, dec, v, bv, plx]: Row): SkyStar => {
  const distance = (1000 / Math.max(plx ?? 0, PARALLAX_FLOOR)) * LY_PER_PC
  const [x, y, z] = equatorialToGalactic(equatorialDirection(ra, dec))
  const temperature = colourTemperature(bv ?? SOLAR_BV)
  return { hip, position: [x * distance, y * distance, z * distance], temperature, radiusSquared: visualRadiusSquared(v, temperature, distance) }
}

export const BRIGHT_STARS: readonly SkyStar[] = ROWS
  .filter(([, ra, dec, v]) => !isTarget(equatorialToGalactic(equatorialDirection(ra, dec)), v))
  .map(toSkyStar)

export const brightStar = (hip: number): SkyStar => {
  const star = BRIGHT_STARS.find((candidate) => candidate.hip === hip)
  if (!star) throw new Error(`HIP ${hip} is not among the bright stars`)
  return star
}
