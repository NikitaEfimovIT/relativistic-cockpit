import { expect, test } from 'vitest'
import { EXOPLANETS, ORBITS, orbitPlace } from './exoplanets'
import type { Vec3 } from './galaxy'
import { AU_LY, BODIES, indexOfBody } from './nearbyStars'
import { rest } from './physics'
import { PLANETS } from './solarSystem'
import { globeSource, indexOfTarget, type Course } from './voyage'

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const hostOf = (name: string) => BODIES[indexOfBody(name)]

// Host masses, M☉: NASA Exoplanet Archive, st_mass in the same rows as the planets
const HOST_MASS: Readonly<Record<string, number>> = {
  'Проксима Центавра': 0.1221, 'Звезда Барнарда': 0.162, 'Лаланд 21185': 0.3899, 'ε Эридана': 0.82, 'ε Индейца': 0.8,
}

test("each planet's period and orbit agree with its star's mass by Kepler's third law, to 1 %", () => {
  for (const orbit of ORBITS) {
    const years = orbit.period / 365.25
    expect(Math.abs((years ** 2 * HOST_MASS[orbit.host]) / orbit.a ** 3 - 1), orbit.name).toBeLessThan(0.01)
  }
})

test('at launch each planet is on its orbit, between a(1 − e) and a(1 + e) from its star', () => {
  ORBITS.forEach((orbit, i) => {
    const offset = sub(EXOPLANETS[i].position, hostOf(orbit.host).position)
    const au = Math.sqrt(dot(offset, offset)) / AU_LY
    expect(au, orbit.name).toBeGreaterThan(orbit.a * (1 - orbit.e) * (1 - 1e-9))
    expect(au, orbit.name).toBeLessThan(orbit.a * (1 + orbit.e) * (1 + 1e-9))
  })
})

test('at its conjunction a planet is in front of its star, between it and the Sun', () => {
  for (const orbit of ORBITS) {
    if (orbit.conjunction === undefined) continue
    const host = hostOf(orbit.host).position
    expect(dot(sub(orbitPlace(orbit, orbit.conjunction), host), host), orbit.name).toBeLessThan(0)
  }
})

test('a rocky planet borrows the light of Mercury, a giant that of Jupiter', () => {
  const [proximaB, epsilonEridaniB] = [EXOPLANETS[0], EXOPLANETS.find((p) => p.name === 'ε Эридана b')]
  expect(proximaB.albedo).toBe(PLANETS.find((p) => p.name === 'Меркурий')?.albedo)
  expect(epsilonEridaniB?.albedo).toBe(PLANETS.find((p) => p.name === 'Юпитер')?.albedo)
})

test('a planet round another star is lit by that star, not by the Sun', () => {
  const proxima = hostOf('Проксима Центавра')
  const back = 1 - (0.05 * AU_LY) / Math.sqrt(dot(proxima.position, proxima.position))
  const stop: Vec3 = [proxima.position[0] * back, proxima.position[1] * back, proxima.position[2] * back]
  const course: Course = { target: indexOfTarget('Проксима Центавра'), origin: stop, startX: 0, attitude: [0, 0, 0, 1], turn: null }
  const light = globeSource(course, rest(), EXOPLANETS[0])
  expect(light.temperature).toBe(proxima.temperature)
  expect(light.illuminance).toBeGreaterThan(0)
  expect(Number.isFinite(light.illuminance)).toBe(true)
})

test("each exoplanet pulls with the archive's mass, its sphere of pull clear of its surface", () => {
  for (const planet of EXOPLANETS) {
    expect(planet.gm).toBeGreaterThan(0)
    expect(planet.hill).toBeGreaterThan(3 * planet.radiusM)
  }
  const proxima = EXOPLANETS.find((p) => p.name === 'Проксима Центавра b')
  expect((proxima?.gm ?? 0) / 3.986e14).toBeCloseTo(1.055 / Math.sin(Math.PI / 3), 2) // M sin i at the assumed 60°
})

test('no one has seen an exoplanet: each gets a made-up surface of its kind, rock, ice giant or gas giant by its radius', () => {
  const kind = (name: string) => EXOPLANETS.find((p) => p.name === name)?.pattern
  expect(kind('Проксима Центавра b')).toBe('rock')
  expect(kind('Лаланд 21185 c')).toBe('ice')
  expect(kind('ε Эридана b')).toBe('gas')
  expect(PLANETS.every((p) => p.pattern === undefined)).toBe(true) // the Sun's planets are drawn from maps or in their hue
})
