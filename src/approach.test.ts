import { describe, expect, test } from 'vitest'
import { HOLES, parkingRadius } from './blackHoles'
import { PROPELLANT } from './chemical'
import { localAt, localPosition } from './flight'
import { LY, rest } from './physics'
import {
  CLOCK_STEPS, initialSim, isAutoBrakeArmed, isBrakingOverdue, readyForStart, selectTarget, setThrottle, stepSim, toggleAutoBrake, toggleBreaker,
  toggleEngine, turnClock, type SimState,
} from './sim'
import { TARGETS, arrivalRadius, brakeCallDistance, brakingDistance, forwardOf, holeNear, indexOfTarget, launchCourse, navigate, shipPosition } from './voyage'

const CYGNUS = 'Лебедь X-1'
const atFastestClock = (sim: SimState): SimState => CLOCK_STEPS.reduce<SimState>((s) => turnClock(s, 1), sim)
/** A course through the target itself from `back` ly short of its centre: launchCourse passes 20 000 km abeam of it. */
const aimedFrom = (name: string, back: number): Pick<SimState, 'course' | 'targetCursor'> => {
  const target = indexOfTarget(name)
  const launch = launchCourse(target)
  const forward = forwardOf(launch.attitude)
  const [x, y, z] = TARGETS[target].position
  return { course: { ...launch, origin: [x - forward[0] * back, y - forward[1] * back, z - forward[2] * back], startX: 0 }, targetCursor: target }
}
/** At rest `standoffs` of the target's standoffs short of its stop point, aimed at it, the engine started and the lever forward. */
const restingBy = (name: string, standoffs: number): SimState => {
  const aimed = aimedFrom(name, (standoffs + 1) * TARGETS[indexOfTarget(name)].standoff)
  const local = localAt(aimed.course.origin, [0, 0, 0])
  const s = setThrottle(toggleEngine(readyForStart(atFastestClock(initialSim()))), 1)
  return { ...s, ...aimed, ship: rest(), course: { ...aimed.course, origin: localPosition(local) }, local }
}
/** Under full thrust at rapidity `phi`, `ahead` arrival radii short of the brake point. */
const inbound = (name: string, ahead: number, phi = 7): SimState => {
  const place = TARGETS[indexOfTarget(name)]
  const aimed = aimedFrom(name, place.standoff + (brakingDistance(phi) + ahead * place.arrival * LY) / LY)
  return { ...setThrottle(toggleEngine(readyForStart(atFastestClock(initialSim(phi, 0)))), 1), ...aimed, spool: 1 }
}
/** The lever is left alone: the flight runs until the ship has flown and come to rest, or is lost. */
const handsOff = (start: SimState, frame: number): SimState => {
  let s = start
  let hasFlown = false
  for (let seconds = 0; seconds < 1200 && !s.wrecked && !(hasFlown && s.local !== null); seconds += frame) {
    s = stepSim(s, frame)
    hasFlown = hasFlown || s.local === null
  }
  return s
}
/** A hand at the lever: full thrust to the brake point, `late` real seconds more, then full braking to a stop. */
const byHand = (start: SimState, late: number, frame: number): SimState => {
  let s = start
  let due = -1
  for (let seconds = 0; seconds < 600 && !s.wrecked; seconds += frame) {
    const nav = navigate(s.course, s.ship)
    if (due < 0 && s.local === null && nav.braking >= nav.toGo) due = seconds
    if (due >= 0 && seconds - due >= late) s = setThrottle(s, -1)
    if (due >= 0 && s.local !== null) break
    s = stepSim(s, frame)
  }
  return s
}
/** How far from the hole the ship is, over where it should park. */
const overParking = (s: SimState): number => {
  const near = holeNear(shipPosition(s.course, s.ship.x))
  const hole = HOLES.find((h) => h.name === near?.hole.name)
  return near && hole ? near.r / parkingRadius(hole) : NaN
}

describe('by Cygnus X-1 the ship parks clear of the tides that kill', () => {
  test('a hand that brakes on the point lives, and a tenth of a second late at the fastest clock; three tenths late is lost', () => {
    for (const frame of [1 / 60, 1 / 20]) {
      expect(byHand(restingBy(CYGNUS, 10), 0, frame).wrecked, `on the point, ${frame}`).toBe(false)
      expect(byHand(restingBy(CYGNUS, 10), 0.1, frame).wrecked, `0.1 s late, ${frame}`).toBe(false)
      expect(byHand(restingBy(CYGNUS, 10), 0.3, frame).wrecked, `0.3 s late, ${frame}`).toBe(true)
    }
  })
})

describe('АВТОТОРМОЖЕНИЕ', () => {
  test('the lever pushed forward and never touched again, the ship comes to rest on its stop point by α Centauri A', () => {
    const end = handsOff(setThrottle(toggleAutoBrake(toggleEngine(readyForStart(atFastestClock(initialSim())))), 1), 1 / 30)
    const nav = navigate(end.course, end.ship)

    expect(end.wrecked).toBe(false)
    expect(nav.cue).toBe('arrived')
    expect(Math.abs(nav.toGo) / (TARGETS[end.course.target].standoff * LY)).toBeLessThan(0.02)
    expect(end.throttle, 'the lever is back at its detent').toBe(0)
  })

  test('by Cygnus X-1 it parks the ship from a fast leg, from a short hop and with the lever already back, at 60 and at 20 frames a second', () => {
    const starts: ReadonlyArray<readonly [string, SimState]> = [
      ['fast leg', inbound(CYGNUS, 20)], ['short hop', restingBy(CYGNUS, 5)], ['lever back', setThrottle(inbound(CYGNUS, 20, 2), -0.3)],
    ]
    for (const frame of [1 / 60, 1 / 20]) {
      for (const [name, start] of starts) {
        const end = handsOff(toggleAutoBrake(start), frame)
        expect(end.wrecked, `${name}, ${frame}`).toBe(false)
        expect(overParking(end), `${name}, ${frame}`).toBeGreaterThan(0.97)
        expect(overParking(end), `${name}, ${frame}`).toBeLessThan(1.03)
      }
    }
  })

  test('the whole way from the Earth’s orbit to Cygnus X-1: one leg ends abeam of the parking, the hole picked again and a second parks the ship', () => {
    // The course is laid from where the ship is when the target is picked; by the time it has turned, its orbit has carried it
    // thousands of km on, and the leg runs that far to one side of the hole: nothing by a star, more than the parking here.
    const cygnus = indexOfTarget(CYGNUS)
    const ready = toggleAutoBrake(toggleEngine(readyForStart(atFastestClock(initialSim()))))
    const first = handsOff(setThrottle(selectTarget(ready, cygnus), 1), 1 / 30)

    expect(first.wrecked).toBe(false)
    expect(first.throttle).toBe(0)
    expect(overParking(first)).toBeGreaterThan(1) // level with the stop point along the course, and off to its side
    expect(overParking(first)).toBeLessThan(5)

    const second = handsOff(setThrottle(selectTarget(first, cygnus), 1), 1 / 30)
    expect(second.wrecked).toBe(false)
    expect(overParking(second)).toBeGreaterThan(0.97)
    expect(overParking(second)).toBeLessThan(1.03)
  })

  test('by a planet it rests the ship where a pilot who answers the call at once does: bound to it, the tanks filled', () => {
    const ready = toggleAutoBrake(toggleEngine(readyForStart(atFastestClock(initialSim()))))
    const spent = { ...ready, propulsion: { ...ready.propulsion, propellant: 1000 } }
    const end = handsOff(setThrottle(selectTarget(spent, indexOfTarget('Марс')), 1), 1 / 30)
    const nav = navigate(end.course, end.ship)

    expect(nav.cue).toBe('arrived')
    expect(nav.toGo / brakeCallDistance(end.course)).toBeGreaterThan(0.95)
    expect(nav.toGo / brakeCallDistance(end.course)).toBeLessThan(1.05)
    expect(end.propulsion.propellant).toBe(PROPELLANT)
  })

  test('it is the navigation computer’s: switched off, or with that breaker out, the lever stays where the pilot left it', () => {
    const overdue = inbound('Центр Галактики', -0.5)
    for (const s of [overdue, toggleBreaker(toggleAutoBrake(overdue), 'nav')]) {
      expect(isAutoBrakeArmed(s)).toBe(false)
      expect(stepSim(s, 1 / 60).throttle).toBe(1)
    }
  })

  test('past the brake point it brakes with all the engine has', () => {
    const overdue = toggleAutoBrake(inbound('Центр Галактики', -0.5))
    expect(isAutoBrakeArmed(overdue)).toBe(true)
    expect(stepSim(overdue, 1 / 60).throttle).toBe(-1)
  })

  test('while it has the lever, the brake callout is silent', () => {
    const called = inbound('Центр Галактики', 0.5)
    expect(navigate(called.course, called.ship).cue).toBe('brake')
    expect(arrivalRadius(called.course)).toBeGreaterThan(0)
    expect(isBrakingOverdue(called)).toBe(true)
    expect(isBrakingOverdue(toggleAutoBrake(called))).toBe(false)
  })
})
