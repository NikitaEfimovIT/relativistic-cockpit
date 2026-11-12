import type { Vec3 } from './galaxy'

// Where things are on the sky, and when: the rotation from equatorial to galactic axes, directions from coordinates, the
// frame of the sky at a place, and the date every position is given for.

/** ICRS to galactic rotation; rows are the galactic axes (Hipparcos catalogue, ESA 1997, vol. 1, §1.5.3). */
const ICRS_TO_GALACTIC: readonly Vec3[] = [
  [-0.0548755604, -0.873437090, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
]

const DEG = Math.PI / 180
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: Vec3): Vec3 => {
  const length = Math.sqrt(dot(a, a))
  return [a[0] / length, a[1] / length, a[2] / length]
}

/** 2027-05-01 0h UT. α Centauri, the first target, is then near opposition, so the Sun is behind the ship at launch. */
export const LAUNCH_JD = 2_461_526.5

export const equatorialToGalactic = (v: Vec3): Vec3 => [dot(ICRS_TO_GALACTIC[0], v), dot(ICRS_TO_GALACTIC[1], v), dot(ICRS_TO_GALACTIC[2], v)]

/** Unit vector towards right ascension and declination, both in degrees, in equatorial axes. */
export const equatorialDirection = (ra: number, dec: number): Vec3 =>
  [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)]

/** Unit vector towards galactic longitude and latitude, both in degrees, in galactic axes. */
export const galacticDirection = (l: number, b: number): Vec3 =>
  [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)]

/** North, east and away from the Sun at a place on the sky, in galactic axes: position angles count from north to east. */
export function skyFrame(position: Vec3): readonly [Vec3, Vec3, Vec3] {
  const away = unit(position)
  const pole = equatorialToGalactic([0, 0, 1])
  const along = dot(pole, away)
  const north = unit([pole[0] - along * away[0], pole[1] - along * away[1], pole[2] - along * away[2]])
  const east: Vec3 = [north[1] * away[2] - north[2] * away[1], north[2] * away[0] - north[0] * away[2], north[0] * away[1] - north[1] * away[0]]
  return [north, east, away]
}
