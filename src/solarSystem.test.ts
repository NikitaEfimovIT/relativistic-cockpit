import { expect, test } from 'vitest'
import type { Vec3 } from './galaxy'
import { AU_LY, equatorialDirection, equatorialToGalactic } from './nearbyStars'
import { LY } from './physics'
import { EARTH, GLOBES, LAUNCH_JD, MOON, MOON_AXES, PLANETS, SPINS, earthAxes, greenwichAngle, lambertPhase, spinAxes, sunFromEarth } from './solarSystem'

const DEG = Math.PI / 180
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const norm = (a: Vec3): number => Math.sqrt(dot(a, a))
const between = (a: Vec3, b: Vec3): number => Math.acos(Math.min(1, dot(a, b) / (norm(a) * norm(b))))

// JPL Horizons (DE441) for 2027-05-01 0h UT, seen from the Earth's centre: astrometric RA, Dec (deg), V, phase (deg)
const HORIZONS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  Луна: [335.082320762, -8.731844217, -9.014, 113.5495],
  Меркурий: [40.055043464, 15.655872373, -2.118, 8.0124],
  Венера: [12.384354308, 3.520149683, -3.875, 39.4371],
  Марс: [148.137421403, 15.144583313, 0.252, 36.114],
  Юпитер: [139.866103689, 16.661439619, -2.118, 10.7268],
  Сатурн: [19.494750481, 5.804924961, 0.709, 2.1005],
  Уран: [61.898880458, 20.812281559, 5.805, 1.2064],
  Нептун: [5.164808405, 0.753129539, 7.812, 1.1052],
}
/** Magnitudes fainter than Horizons for what the laws leave out: Saturn's rings, Uranus's latitude term, Mars's turning. */
const LEFT_OUT: Readonly<Record<string, number>> = { Сатурн: 0.27, Уран: 0.07, Марс: 0.03 }
const SUN_V = -26.75 // Mallama et al. 2017, Table 6

test('at launch the Sun is where Horizons puts it among the stars, to half an arcminute', () => {
  const horizons = equatorialDirection(37.627000773, 14.823084826)
  expect(between(sunFromEarth(LAUNCH_JD).direction, horizons) / DEG * 60).toBeLessThan(0.5)
})

test('from the Earth at launch the Moon and the planets are where Horizons sees them', () => {
  for (const globe of [MOON, ...PLANETS]) {
    const [ra, dec] = HORIZONS[globe.name]
    const seen = sub(globe.position, EARTH.position)
    expect(between(seen, equatorialToGalactic(equatorialDirection(ra, dec))) / DEG * 3600, globe.name).toBeLessThan(2)
  }
})

test('at launch each is as bright as the Astronomical Almanac makes it, less what its law leaves out', () => {
  for (const globe of [MOON, ...PLANETS]) {
    const [, , magnitude, phase] = HORIZONS[globe.name]
    const fromSun = norm(globe.position) / AU_LY
    const fromEarth = sub(globe.position, EARTH.position)
    const alpha = between(globe.position, fromEarth)
    const ratio = globe.radiusM / (norm(fromEarth) * LY)
    const v = SUN_V - 2.5 * Math.log10(((2 / 3) * globe.albedo(alpha) * lambertPhase(alpha) * ratio * ratio) / (fromSun * fromSun))
    expect(alpha / DEG, globe.name).toBeCloseTo(phase, 1)
    expect(Math.abs(v - magnitude - (LEFT_OUT[globe.name] ?? 0)), globe.name).toBeLessThan(0.02)
  }
})

test("the Moon's map faces the Earth with its longitude 0, north up towards the ecliptic's pole", () => {
  const { greenwich, east, pole } = MOON_AXES
  const eclipticPole = equatorialToGalactic([0, -Math.sin(23.43928 * DEG), Math.cos(23.43928 * DEG)])
  expect(between(greenwich, sub(EARTH.position, MOON.position))).toBeLessThan(1e-9)
  for (const axis of [greenwich, east, pole]) expect(norm(axis)).toBeCloseTo(1, 12)
  expect(Math.abs(dot(greenwich, east)) + Math.abs(dot(east, pole)) + Math.abs(dot(pole, greenwich))).toBeLessThan(1e-8) // as orthonormal as the galactic matrix
  expect(dot(east, [pole[1] * greenwich[2] - pole[2] * greenwich[1], pole[2] * greenwich[0] - pole[0] * greenwich[2], pole[0] * greenwich[1] - pole[1] * greenwich[0]])).toBeCloseTo(1, 12)
  expect(between(pole, eclipticPole) / DEG).toBeLessThan(5.2) // the Moon keeps within 5.1° of the ecliptic
})

test('every globe sends a finite, positive light at every phase', () => {
  for (const globe of GLOBES) {
    for (let degrees = 0; degrees <= 180; degrees++) {
      const albedo = globe.albedo(degrees * DEG)
      expect(Number.isFinite(albedo) && albedo > 0, `${globe.name} at ${degrees}°`).toBe(true)
    }
  }
})
const longitude = (jd: number): number => {
  const [x, y, z] = sunFromEarth(jd).direction
  const obliquity = 23.439 * DEG
  // back from equatorial to ecliptic: rotate about x by the obliquity
  const yEcliptic = Math.cos(obliquity) * y + Math.sin(obliquity) * z
  return ((Math.atan2(yEcliptic, x) / DEG) + 360) % 360
}

test('the Sun is at the equinox point on 2000-03-20 07:35 UT and at 90° on 2000-06-21 01:48 UT', () => {
  const equinox = longitude(2451623.816)
  expect(Math.min(equinox, 360 - equinox)).toBeLessThan(0.02)
  expect(longitude(2451716.575)).toBeCloseTo(90, 1)
})

test('the Earth is nearest the Sun in early January and farthest in early July', () => {
  expect(sunFromEarth(2451547.5).distanceAu).toBeCloseTo(0.9833, 3) // 2000-01-03
  expect(sunFromEarth(2451730.5).distanceAu).toBeCloseTo(1.0167, 3) // 2000-07-04
})

test('the Earth turns once in a sidereal day of 23 h 56 min 4.1 s', () => {
  const sidereal = 0.99726957
  const turned = greenwichAngle(2451545 + sidereal) - greenwichAngle(2451545)
  expect(Math.abs(Math.sin(turned))).toBeLessThan(1e-5)
  expect(greenwichAngle(2451545) / DEG).toBeCloseTo(280.46, 2)
})

test('a Lambert sphere is full at phase 0, half lit at 90° with 1/π of full light, and dark at 180°', () => {
  expect(lambertPhase(0)).toBeCloseTo(1, 12)
  expect(lambertPhase(Math.PI / 2)).toBeCloseTo(1 / Math.PI, 12)
  expect(lambertPhase(Math.PI)).toBeCloseTo(0, 12)
})

test("the Earth's pull counts out to 1.5 million km, the Moon's to 58 000 km round it, and the Earth's air ends 100 km up", () => {
  expect(EARTH.hill / 1e9).toBeCloseTo(1.47, 2)
  expect(MOON.hill / 1e6).toBeCloseTo(58, 0)
  expect(EARTH.ceiling / 1e3).toBeCloseTo(102, 0)
  expect(MOON.ceiling).toBe(0)
})

test("every planet's sphere of pull reaches far beyond its radius, and far out Neptune's is the widest", () => {
  for (const planet of PLANETS) expect(planet.hill).toBeGreaterThan(50 * planet.radiusM)
  const widest = PLANETS.reduce((a, b) => (b.hill > a.hill ? b : a))
  expect(widest.name).toBe('Нептун') // 30 AU out, the Sun's tides are weak: wider than Jupiter's
})

test("the IAU's frame for the Earth matches the Earth's own turning, and every planet's frame is orthonormal", () => {
  const jd = LAUNCH_JD + 12.3
  const iau = spinAxes({ ra: [0, -0.641], dec: [90, -0.557], w: [190.147, 360.9856235] }, jd) // the Earth, IAU 2009
  const own = earthAxes(jd)
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  // within a degree: earthAxes turns from the equinox of date and keeps J2000's pole, both some 0.4° off by 2027
  expect(Math.acos(Math.min(1, dot(iau.greenwich, own.greenwich))) / (Math.PI / 180)).toBeLessThan(1)
  expect(Math.acos(Math.min(1, dot(iau.pole, own.pole))) / (Math.PI / 180)).toBeLessThan(1)
  for (const spin of Object.values(SPINS)) {
    const { greenwich, east, pole } = spinAxes(spin, jd)
    expect(Math.abs(dot(greenwich, east)) + Math.abs(dot(east, pole)) + Math.abs(dot(pole, greenwich))).toBeLessThan(1e-8) // as orthonormal as the galactic matrix
  }
})
