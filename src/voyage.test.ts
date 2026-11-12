import { describe, expect, test } from 'vitest'
import { EXOPLANETS } from './exoplanets'
import { BODIES, equatorialToGalactic } from './nearbyStars'
import { C, G0, LY, advanceShip, rest } from './physics'
import { CLOCK_STEPS, clockHold, eventTimer, initialSim, readyForStart, selectTarget, setThrottle, stepSim, toggleEngine, toggleShield, turnClock, type SimState } from './sim'
import { PROPELLANT } from './chemical'
import { orbitOf } from './flight'
import { EARTH_RADIUS_M, GLOBES, LAUNCH_JD, earthPosition, sunFromEarth } from './solarSystem'
import {
  LAUNCH_TARGET, TARGETS, arrivalRadius, brakeCallDistance, brakingDistance, directionToCentre, eclipsed, distanceToGo, earthSource, forwardOf, galacticToShip, indexOfTarget,
  launchCourse, BRAKE_LEAD_S, LEVER_S, REACTION_S, clockLimit, holeNear, navigate, setCourse, shipPosition, starSources, stepTurn, targetDirection,
} from './voyage'

type Vec3 = readonly [number, number, number]
const DEG = Math.PI / 180
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a)
  return [a[0] / length, a[1] / length, a[2] / length]
}
const angle = (a: Vec3, b: Vec3): number => Math.acos(Math.min(1, unit(a).reduce((sum, v, i) => sum + v * unit(b)[i], 0)))
const FRAME = 1 / 30
/** The clock turned all the way up: a year a second, wherever nothing near needs the pilot. */
const atFastestClock = (sim: SimState): SimState => CLOCK_STEPS.reduce<SimState>((s) => turnClock(s, 1), sim)

describe('the launch', () => {
  const course = launchCourse()
  const here = shipPosition(course, 0)

  test('the ship is aimed at α Centauri A', () => {
    expect(angle(forwardOf(course.attitude), sub(TARGETS[LAUNCH_TARGET].position, here))).toBeLessThan(1e-9)
  })

  test('the Earth hangs ahead and to the left at eye level, 25 000 km away, and the departure passes it safely', () => {
    const toEarth = sub(earthPosition(LAUNCH_JD), here)
    const [x, y, z] = galacticToShip(course.attitude, unit(toEarth))
    expect(Math.hypot(...toEarth) * LY).toBeCloseTo(2.5e7, -3)
    expect(Math.atan2(-x, -z) / DEG).toBeCloseTo(55, 6) // azimuth, left of the course
    expect(Math.abs(y)).toBeLessThan(1e-9)
    expect(2 * Math.asin(EARTH_RADIUS_M / 2.5e7) / DEG).toBeGreaterThan(25) // fills much of the window
    expect(2.5e7 * Math.sin(55 * DEG)).toBeGreaterThan(3 * EARTH_RADIUS_M) // closest approach
  })

  test('the Sun is behind the ship and the Earth shows nearly its whole day side', () => {
    const sun = equatorialToGalactic(sunFromEarth(LAUNCH_JD).direction)
    expect(galacticToShip(course.attitude, sun)[2]).toBeGreaterThan(0.5) // aft
    const phaseAngle = angle(sun, sub(here, earthPosition(LAUNCH_JD))) // Sun–Earth–ship
    expect(phaseAngle / DEG).toBeLessThan(30)
  })

  test('the centre of the Galaxy lies along the galactic x axis, a little below it since the Sun is 25 pc up', () => {
    const towards = galacticToShip(course.attitude, unit([8.2, 0, -0.025]))
    expect(angle(directionToCentre(course, 0), towards)).toBeLessThan(1e-6)
  })
})

describe('turning', () => {
  const course = launchCourse()
  const sirius = indexOfTarget('Сириус')

  test('under way the ship cannot turn: picking a target changes nothing', () => {
    const moving = { ...rest(), phi: 0.1 }
    expect(setCourse(course, moving, sirius)).toBe(course)
  })

  test('at rest it turns smoothly onto the new target without moving, and the new leg starts where it stood', () => {
    // Arrange
    const ship = { ...rest(), x: 1e9 }
    const before = shipPosition(course, ship.x)

    // Act
    let turning = setCourse(course, ship, sirius)
    const steps: number[] = []
    while (turning.turn) {
      turning = stepTurn(turning, FRAME)
      steps.push(angle(forwardOf(turning.attitude), sub(TARGETS[sirius].position, before)))
    }

    // Assert
    expect(steps.length * FRAME).toBeGreaterThan(1.5)
    expect(steps.length * FRAME).toBeLessThan(8)
    expect(steps[steps.length - 1]).toBeLessThan(1e-6)
    expect(Math.hypot(...sub(shipPosition(turning, ship.x), before))).toBeLessThan(1e-15)
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThanOrEqual(steps[i - 1] + 1e-12)
  })
})

describe('the targets', () => {
  const stars = new Set(BODIES.map((body) => body.name))

  test('are the stars of the table in its order, each followed by its planets, the Sun’s outwards from it', () => {
    expect(TARGETS.filter((place) => stars.has(place.name)).map((place) => place.name)).toEqual(BODIES.map((body) => body.name))
    expect(TARGETS.slice(0, 10).map((place) => place.name))
      .toEqual(['Солнце', 'Меркурий', 'Венера', 'Земля', 'Луна', 'Марс', 'Юпитер', 'Сатурн', 'Уран', 'Нептун'])
    for (const planet of EXOPLANETS) {
      const [host, at] = [indexOfTarget(planet.star.name), indexOfTarget(planet.name)]
      expect(at, planet.name).toBeGreaterThan(host)
      expect(TARGETS.slice(host + 1, at).some((place) => stars.has(place.name)), planet.name).toBe(false)
    }
    expect(TARGETS).toHaveLength(BODIES.length + GLOBES.length + EXOPLANETS.length)
  })

  test('by a planet or the Moon the ship never stops nearer than where it spans 29.5°, as the Earth does at the start', () => {
    for (const globe of [...GLOBES, ...EXOPLANETS]) {
      const { standoff } = TARGETS[indexOfTarget(globe.name)]
      expect((2 * Math.asin(globe.radiusM / (standoff * LY))) / DEG, globe.name).toBeLessThan(29.55)
    }
  })

  test('answered at once, the brake call stops the ship a third to nine tenths into a planet\'s Hill sphere, bound to it', () => {
    for (const globe of GLOBES) {
      const target = indexOfTarget(globe.name)
      const stop = TARGETS[target].standoff * LY + brakeCallDistance(launchCourse(target))
      expect(stop / globe.hill, globe.name).toBeGreaterThan(0.3)
      expect(stop / globe.hill, globe.name).toBeLessThan(0.9)
    }
  })

  test('at rest the ship turns onto the Moon, which then lies dead ahead some 380 000 km off', () => {
    // Arrange
    const moon = indexOfTarget('Луна')

    // Act
    let turned = setCourse(launchCourse(), rest(), moon)
    while (turned.turn) turned = stepTurn(turned, FRAME)

    // Assert
    expect(angle(targetDirection(turned, rest()), [0, 0, -1])).toBeLessThan(1e-6)
    expect(distanceToGo(turned, 0)).toBeGreaterThan(3.6e8)
    expect(distanceToGo(turned, 0)).toBeLessThan(4.2e8)
  })
})

describe('light from outside', () => {
  const course = launchCourse()

  test('at home the Sun gives the solar illuminance at 1 AU, about 1.27·10⁵ lx', () => {
    expect(starSources(course, rest())[0].illuminance / 1.27e5).toBeCloseTo(1, 1)
  })

  test('the nearly full Earth from 25 000 km lights the cabin like a cloudy day', () => {
    const earthLight = earthSource(course, rest()).illuminance
    expect(earthLight).toBeGreaterThan(1e3)
    expect(earthLight).toBeLessThan(2e4)
  })

  test('at the speed limit the Earth beside the course shrinks to a speck straight ahead (aberration and 1/D)', () => {
    const atRest = earthSource(course, rest())
    const fast = earthSource(course, { ...rest(), phi: Math.atanh(0.999999) })
    expect(fast.radius ?? 0).toBeLessThan((atRest.radius ?? 0) / 500)
    expect(Math.acos(-fast.direction[2])).toBeLessThan(0.01)
  })

  test('at speed a star ahead brightens and turns blue, a star astern dims and reddens', () => {
    // Arrange: the target is dead ahead, the Sun behind
    const fast = { ...rest(), phi: 1 }
    const [restSun, restTarget] = [starSources(course, rest())[0], starSources(course, rest())[2]]
    const [fastSun, fastTarget] = [starSources(course, fast)[0], starSources(course, fast)[2]]

    // Assert
    expect(fastTarget.illuminance).toBeGreaterThan(restTarget.illuminance)
    expect(fastTarget.temperature).toBeGreaterThan(restTarget.temperature)
    expect(fastSun.illuminance).toBeLessThan(restSun.illuminance)
    expect(fastSun.temperature).toBeLessThan(restSun.temperature)
  })
})

describe('braking', () => {
  test('the braking distance is v²/2a when slow and grows as γ when fast (Rindler)', () => {
    const v = 1000
    expect(brakingDistance(Math.atanh(v / C))).toBeCloseTo((v * v) / (2 * G0), -2)
    expect(brakingDistance(Math.acosh(11)) / brakingDistance(Math.acosh(2))).toBeCloseTo(10, 10)
  })

  test('it is the distance the same thrust takes to reach that speed from rest', () => {
    const ship = advanceShip(rest(), G0, 3 * 31_557_600)
    expect(ship.x / brakingDistance(ship.phi)).toBeCloseTo(1, 10)
  })
})

describe('how fast the clock may run', () => {
  const course = launchCourse()

  test('nothing comes at a ship at rest, so nothing holds its clock, by the Earth or by the star', () => {
    expect(clockLimit(course, rest(), 0)).toBe(Infinity)
    expect(clockLimit(course, { ...rest(), x: distanceToGo(course, 0) }, 0)).toBe(Infinity)
  })

  test('it slows for the moment braking must begin, and picks up again once the ship brakes', () => {
    // Arrange: coasting at γ = 2, with the point where braking must begin 1 AU or 1 ly ahead
    const phi = Math.acosh(2)
    const ahead = (margin: number) => ({ ...rest(), phi, x: distanceToGo(course, 0) - brakingDistance(phi) - margin })

    // Act
    const [near, far] = [clockLimit(course, ahead(1.5e11), 0), clockLimit(course, ahead(LY), 0)]
    const braking = clockLimit(course, ahead(1.5e11), -G0)

    // Assert: a second of reaction at the decision costs less than the margin for arriving
    expect(near).toBeLessThan(far / 1000)
    expect(near * C * Math.sinh(phi)).toBeLessThan(arrivalRadius(course))
    expect(braking).toBeGreaterThan(1000 * near)
  })

  test('under full thrust it slows twice as much for the brake point, which the growing braking distance meets halfway', () => {
    const phi = Math.acosh(2)
    const ship = { ...rest(), phi, x: distanceToGo(course, 0) - brakingDistance(phi) - 1.5e11 }
    expect(clockLimit(course, ship, G0) / clockLimit(course, ship, 0)).toBeCloseTo(0.5, 2)
  })
})

describe('the brake call', () => {
  /** Full thrust at 0.9 c towards α Cen A, the brake point `ahead` arrival radii away; real seconds until each moment. */
  const thrustOn = (ahead: number): { readonly call: number; readonly point: number } => {
    const course = launchCourse()
    const phi = Math.atanh(0.9)
    let s: SimState = { ...setThrottle(toggleEngine(readyForStart(atFastestClock(initialSim(phi, 0)))), 1), spool: 1 }
    s = { ...s, ship: { ...s.ship, x: distanceToGo(course, 0) - brakingDistance(phi) - ahead * arrivalRadius(course) } }
    let call = Infinity
    for (let t = 0; t < 60; t += FRAME) {
      const nav = navigate(s.course, s.ship)
      if (nav.cue === 'brake' && call === Infinity) call = t
      if (nav.braking >= nav.toGo) return { call, point: t }
      s = stepSim(s, FRAME)
    }
    throw new Error('never reached the brake point')
  }

  test('comes ahead of the brake point by the pilot’s reaction and the lever’s travel', () => {
    const { call, point } = thrustOn(20)
    expect(point - call).toBeGreaterThan(BRAKE_LEAD_S - 0.2)
    expect(point - call).toBeLessThan(BRAKE_LEAD_S + 0.4)
  })
})

/** A pilot who does only what the hints say: full thrust, and full braking from the moment the HUD says so. */
function flyTo(start: SimState, target: number): { readonly seconds: number; readonly end: SimState } {
  let s = selectTarget(start, target)
  let seconds = 0
  for (; seconds < 1200; seconds += FRAME) {
    const { cue } = navigate(s.course, s.ship)
    if (cue === 'arrived') break
    s = setThrottle(s, cue === 'brake' || cue === 'passed' ? -1 : 1)
    s = stepSim(s, FRAME)
  }
  return { seconds, end: s }
}

/**
 * A pilot with human timing: full thrust until the brake call, then `reaction` seconds to answer it, then LEVER_S to
 * pull the lever steadily from full thrust to full braking, and full braking to a stop.
 */
function flyLikeAPerson(start: SimState, target: number, reaction: number = REACTION_S): SimState {
  let s = selectTarget(start, target)
  let called = -1
  for (let seconds = 0; seconds < 1200; seconds += FRAME) {
    const { cue } = navigate(s.course, s.ship)
    if (cue === 'arrived') break
    if (called < 0 && (cue === 'brake' || cue === 'passed')) called = seconds
    const since = called < 0 ? -1 : seconds - called
    s = setThrottle(s, since < reaction ? 1 : 1 - 2 * Math.min(1, (since - reaction) / LEVER_S))
    s = stepSim(s, FRAME)
  }
  return s
}

describe('a whole flight, following the hints', () => {
  const ready = (() => {
    let s = toggleShield(toggleEngine(readyForStart(atFastestClock(initialSim()))))
    for (let t = 0; t < 4; t += FRAME) s = stepSim(s, FRAME)
    return s
  })()

  test('a pilot who takes a moment to answer the brake call and to pull the lever back still stops beside the star', () => {
    for (const name of ['α Центавра A', 'Сириус']) {
      const end = flyLikeAPerson(ready, indexOfTarget(name))
      expect(navigate(end.course, end.ship).cue, name).toBe('arrived')
    }
  })

  test('by Mars the leg ends inside its Hill sphere: the tanks are full, the ship falls to it, and the timer counts to the strike', () => {
    const spent = { ...ready, propulsion: { ...ready.propulsion, propellant: 1000 } }
    const { end } = flyTo(spent, indexOfTarget('Марс'))
    expect(navigate(end.course, end.ship).cue).toBe('arrived')
    expect(end.local && orbitOf(end.local)?.globe.name).toBe('Марс')
    expect(end.propulsion.propellant).toBe(PROPELLANT)
    expect(eventTimer(end)?.event).toBe('impact')
    expect(clockHold(end)).not.toBeNull() // falling: the clock is held, whatever it was set to
  })

  test('reaches α Centauri A and stops beside it, in a few minutes of real time', () => {
    const { seconds, end } = flyTo(ready, LAUNCH_TARGET)
    const nav = navigate(end.course, end.ship)
    expect(nav.cue).toBe('arrived')
    expect(seconds).toBeGreaterThan(60)
    expect(seconds).toBeLessThan(300)
    expect(end.ship.tau / 31_557_600).toBeGreaterThan(3) // 1 g there and back: about 3.6 years aboard
    expect(end.ship.tau / 31_557_600).toBeLessThan(4)
    expect(clockHold(end), 'parked with the lever still back, nothing comes at the ship').toBeNull()
  })

  test('from there the Sun can be picked: the ship turns round and flies home', () => {
    const there = flyTo(ready, LAUNCH_TARGET).end
    const home = flyTo(there, 0)
    expect(navigate(home.end.course, home.end.ship).cue).toBe('arrived')
  })

  test('the Moon is picked and reached the same way: the hints stop the ship beside it', () => {
    const moon = indexOfTarget('Луна')
    for (const end of [flyTo(ready, moon).end, flyLikeAPerson(ready, moon)]) expect(navigate(end.course, end.ship).cue).toBe('arrived')
  })

  test('by a planet the approach is finer: half a second slow to answer, the pilot still stops short of Jupiter', () => {
    // Arrange
    const jupiter = indexOfTarget('Юпитер')
    const surfaceAhead = TARGETS[jupiter].standoff * LY - (GLOBES.find((globe) => globe.name === 'Юпитер')?.radiusM ?? 0)

    // Act
    const end = flyLikeAPerson(ready, jupiter, REACTION_S + 0.5)

    // Assert: braking never backs the ship up, so where it stops is the nearest it came
    const nav = navigate(end.course, end.ship)
    expect(nav.cue).toBe('arrived')
    expect(-nav.toGo).toBeLessThan(surfaceAhead)
  })
})

describe('by a black hole', () => {
  const sgrA = indexOfTarget('Центр Галактики')
  /** Near top speed for Sgr A* under full thrust, `ahead` arrival radii short of the brake point. */
  const inbound = (ahead: number, phi = 7): SimState => {
    const course = launchCourse(sgrA)
    const s = { ...setThrottle(toggleEngine(readyForStart(atFastestClock(initialSim(phi, 0)))), 1), spool: 1, course }
    return { ...s, ship: { ...s.ship, x: distanceToGo(course, 0) - brakingDistance(phi) - ahead * arrivalRadius(course) } }
  }
  /** Real seconds from the start until the call, and until the brake point, for a pilot who does not brake. */
  const callAndPoint = (start: SimState): { readonly call: number; readonly point: number } => {
    let s = start
    let call = Infinity
    for (let t = 0; t < 300; t += FRAME) {
      const nav = navigate(s.course, s.ship)
      if (nav.cue === 'brake' && call === Infinity) call = t
      if (nav.braking >= nav.toGo) return { call, point: t }
      s = stepSim(s, FRAME)
    }
    throw new Error('never reached the brake point')
  }
  /** Full thrust until the call, `reaction` seconds to answer it, the lever pulled back, full braking to a stop. */
  const flyIn = (start: SimState, reaction: number): SimState => {
    let s = start
    let called = -1
    for (let seconds = 0; seconds < 900 && !s.wrecked; seconds += FRAME) {
      const { cue } = navigate(s.course, s.ship)
      if (cue === 'arrived') break
      if (called < 0 && (cue === 'brake' || cue === 'passed')) called = seconds
      const since = called < 0 ? -1 : seconds - called
      s = setThrottle(s, since < reaction ? 1 : 1 - 2 * Math.min(1, (since - reaction) / LEVER_S))
      s = stepSim(s, FRAME)
    }
    return s
  }

  test('the ship stops by Sgr A* 10 Schwarzschild radii out, and only nearby is the hole near', () => {
    const parked = { ...rest(), x: distanceToGo(launchCourse(sgrA), 0) }
    const near = holeNear(shipPosition(launchCourse(sgrA), parked.x))
    expect(near?.hole.name).toBe('Sgr A*')
    expect(near && near.r / near.rs).toBeCloseTo(10, 3)
    expect(holeNear(shipPosition(launchCourse(), 0))).toBeNull()
  })

  test('where the clock can slow no further, the call still comes twice the reaction and the lever ahead: death waits past it', () => {
    const { call, point } = callAndPoint(inbound(20))
    expect(point - call).toBeGreaterThan(2 * BRAKE_LEAD_S - 0.3)
  })

  test('answered at once, the call stops the ship short of Sgr A*; answered late, the ship falls into it', () => {
    const prompt = flyIn(inbound(20), REACTION_S)
    expect(prompt.wrecked).toBe(false)
    expect(navigate(prompt.course, prompt.ship).cue).toBe('arrived')
    expect(navigate(prompt.course, prompt.ship).toGo).toBeGreaterThan(0)

    const late = flyIn(inbound(20), REACTION_S + 2 * BRAKE_LEAD_S + 1)
    expect(late.wrecked).toBe(true)
    expect(late.log.map((entry) => entry.text)).toContain('Корабль разрушен: падение в чёрную дыру, Sgr A*')
  })
})

test("a star behind a body's disc is put out, one beside it is not", () => {
  const sun = { direction: [0, 0, -1] as Vec3, illuminance: 1.3e5, temperature: 5772 }
  const earth = { direction: [0, 0.1, -Math.sqrt(1 - 0.01)] as Vec3, illuminance: 10, temperature: 5772, radius: 0.2 }
  expect(eclipsed([sun], [earth])[0].illuminance).toBe(0)
  expect(eclipsed([sun], [{ ...earth, radius: 0.05 }])[0].illuminance).toBe(1.3e5)
})
