import { describe, expect, test } from 'vitest'
import { LETHAL_DOSE, betaOf, gammaOf } from './physics'
import {
  CLOCK_STEPS, clockHold, clockSetting, confirmTarget, currentWarp, faceCo2, initialSim, isBrakingOverdue, isShielded, moveTargetCursor, nudgeThrottle,
  readyForStart, selectTarget, setThrottle, stepSim, toggleArm, toggleBreaker, toggleBus, toggleCabinLights, toggleEngine, toggleFans, toggleFilter,
  toggleHud, toggleInstrumentsDim, toggleScrubber, toggleShield, toggleShutters, turnClock, type SimState,
  FAULT_WARP, toggleHeater, toggleIsolation, toggleReactor, toggleRepress, toggleVent, toggleLightMode,
  BURN_WARP, crewOf, cutOff, eventTimer, isChemBurning, setChemThrottle, nudgeChemThrottle, setStick, toggleChemEngine, toggleFeed, toggleManualAttitude,
  togglePressurisation,
} from './sim'
import { LOCAL_BETA, orbitOf } from './flight'
import { turnAngle } from './voyage'
import { activeFaults } from './failures'
import { crewCondition } from './habitat'
import { CO2_LIMIT, CO2_SCRUBBED, UNTENDED_AIR_WARP } from './lifeSupport'
import { TARGETS, brakingDistance, distanceToGo, indexOfTarget, launchCourse, navigate } from './voyage'
import { commLink, messagesDue } from './comms'
import { rest } from './physics'

const run = (sim: SimState, seconds: number): SimState =>
  Array.from({ length: Math.round(seconds * 20) }).reduce<SimState>((s) => stepSim(s, 0.05), sim)

const spooled = (sim: SimState): SimState => run(toggleEngine(readyForStart(sim)), 10)

/** Steps until `isDone`, within a generous real-time limit: the clock's pace depends on where the ship is. */
const runUntil = (sim: SimState, isDone: (s: SimState) => boolean, limit = 900): SimState => {
  let s = sim
  for (let t = 0; t < limit && !isDone(s); t += 0.05) s = stepSim(s, 0.05)
  return s
}
const YEARS = 31_557_600
/** Far enough that the brake point is thousands of light years off: nothing to stop for. */
const deepSpace = (sim: SimState): SimState => selectTarget(sim, indexOfTarget('Центр Галактики'))
/** The clock turned all the way up: a year a second, wherever nothing near needs the pilot. */
const atFastestClock = (sim: SimState): SimState => CLOCK_STEPS.reduce<SimState>((s) => turnClock(s, 1), sim)

describe('engine and lever', () => {
  test('lever does nothing while the engine is off', () => {
    const sim = run(setThrottle(initialSim(), 1), 5)
    expect(sim.ship.phi).toBe(0)
  })

  test('a running engine at full lever reaches 99.9999 % c after about 7 ship years, and stops there', () => {
    const sim = setThrottle(runUntil(deepSpace(spooled(toggleShield(atFastestClock(initialSim())))), (s) => !s.course.turn), 1)
    const thrust = (s: SimState): number => s.ship.tau - sim.ship.tau // years pass at rest too, with the clock turned up
    expect(betaOf(runUntil(sim, (s) => thrust(s) > 6.9 * YEARS).ship.phi)).toBeLessThan(0.999999)
    const end = runUntil(sim, (s) => thrust(s) > 7.6 * YEARS).ship
    expect(gammaOf(end.phi)).toBeCloseTo(707.1, 0) // Baez's 1 g figure
  })

  test('pulling the lever back brakes to a stop', () => {
    const fast = runUntil(setThrottle(spooled(toggleShield(atFastestClock(initialSim()))), 1), (s) => s.ship.phi > 1)
    const stopped = runUntil(setThrottle(fast, -1), (s) => s.ship.phi === 0)
    expect(fast.ship.phi).toBeGreaterThan(1)
    expect(stopped.ship.phi).toBe(0)
  })

  test('shutting the engine down leaves the ship coasting', () => {
    const fast = runUntil(setThrottle(spooled(toggleShield(initialSim())), 1), (s) => betaOf(s.ship.phi) > 3 * LOCAL_BETA)
    const coasting = run(toggleEngine(fast), 10)
    expect(coasting.local).toBeNull() // faster than flight by a body
    expect(coasting.ship.phi).toBeGreaterThanOrEqual(fast.ship.phi)
    expect(run(coasting, 5).ship.phi).toBeCloseTo(coasting.ship.phi, 6)
  })

  test('throttle input is clamped to the lever travel', () => {
    expect(setThrottle(initialSim(), 3).throttle).toBe(1)
    expect(setThrottle(initialSim(), -3).throttle).toBe(-1)
    expect(nudgeThrottle(setThrottle(initialSim(), 0.98), 0.1).throttle).toBe(1)
  })
})

describe('shield and dose', () => {
  test('flying past 0.3 c unshielded is lethal and raises the alarm', () => {
    const sim = runUntil(setThrottle(spooled(atFastestClock(initialSim())), 1), (s) => betaOf(s.ship.phi) > 0.32)
    expect(betaOf(sim.ship.phi)).toBeGreaterThan(0.3)
    expect(sim.dose).toBeGreaterThan(LETHAL_DOSE)
    expect(sim.alarm).toBe(true)
  })

  test('the shield keeps the crew dose at zero at any speed', () => {
    const sim = run(setThrottle(spooled(toggleShield(atFastestClock(initialSim()))), 1), 90)
    expect(sim.dose).toBe(0)
    expect(sim.alarm).toBe(false)
  })
})

test('a jump along the course keeps the ship at rest and away from danger', () => {
  const sim = initialSim(0, 1e19)
  expect(sim.ship.x).toBe(1e19)
  expect(sim.ship.phi).toBe(0)
  expect(sim.dose).toBe(0)
})

describe('the start-up checklist', () => {
  test('the cabin is cold until the bus is switched on, keeps its power when the engine stops, and goes dark without the bus', () => {
    const idle = run(initialSim(), 5)
    const powered = run(toggleBus(initialSim()), 5)
    const coasting = run(toggleEngine(spooled(initialSim())), 5)
    const cut = stepSim(toggleBus(powered), 0.05)
    expect(idle.power).toBe(0)
    expect(powered.power).toBe(1)
    expect(coasting.power).toBe(1)
    expect(cut.power).toBe(0)
  })

  test('the engine runs only with the bus on, the light mode engaged, armed and started; the switch alone does nothing', () => {
    const lever = (s: SimState): SimState => run(setThrottle(toggleEngine(s), 1), 8)
    expect(lever(initialSim()).ship.phi).toBe(0)
    expect(lever(toggleBus(initialSim())).ship.phi).toBe(0)
    expect(lever(toggleArm(initialSim())).ship.phi).toBe(0)
    expect(lever(toggleArm(toggleBus(initialSim()))).ship.phi).toBe(0) // no light mode
    expect(lever(toggleLightMode(toggleArm(toggleBus(initialSim())))).ship.phi).toBeGreaterThan(0)
  })

  test('disarming in flight shuts the engine down, and the ship coasts', () => {
    const fast = runUntil(setThrottle(spooled(toggleShield(initialSim())), 1), (s) => betaOf(s.ship.phi) > 3 * LOCAL_BETA)
    const disarmed = run(toggleArm(fast), 5)
    expect(disarmed.spool).toBeLessThan(0.1)
    expect(run(disarmed, 3).ship.phi).toBeCloseTo(disarmed.ship.phi, 6)
  })

  test('the shield and the cabin lights need the bus', () => {
    expect(isShielded(toggleShield(initialSim()))).toBe(false)
    expect(isShielded(toggleShield(toggleBus(initialSim())))).toBe(true)
    expect(run(toggleCabinLights(initialSim()), 2).lights).toBe(0)
  })

  test('the bus failing at speed drops the shield, and the dose with it', () => {
    const PHI = Math.atanh(0.9)
    expect(run(initialSim(PHI), 1).dose).toBe(0)
    expect(run(toggleBus(initialSim(PHI)), 1).alarm).toBe(true)
  })

})

describe('the target screen', () => {
  const powered = (): SimState => toggleBus(initialSim())
  const CRUISE = Math.atanh(0.6)

  test('its arrows move the highlight round the table, and the ship keeps its course', () => {
    const start = powered()
    const moved = moveTargetCursor(start, 1)
    expect(moved.targetCursor).toBe(start.targetCursor + 1)
    expect(moved.course).toEqual(start.course)
    expect(moveTargetCursor(moved, -1).targetCursor).toBe(start.targetCursor)
    const atTop = { ...start, targetCursor: 0 }
    expect(moveTargetCursor(atTop, -1).targetCursor).toBe(TARGETS.length - 1)
  })

  test('ВЫБРАТЬ turns the ship to the highlighted body', () => {
    const chosen = confirmTarget(moveTargetCursor(powered(), 1))
    expect(chosen.course.target).toBe(chosen.targetCursor)
    expect(chosen.course.turn).not.toBeNull()
  })

  test('under way ВЫБРАТЬ cannot turn the ship', () => {
    const cruising = initialSim(CRUISE)
    expect(confirmTarget(moveTargetCursor(cruising, 1)).course).toEqual(cruising.course)
  })

  test('the screen needs the bus and the navigation breaker', () => {
    expect(moveTargetCursor(initialSim(), 1).targetCursor).toBe(initialSim().targetCursor)
    expect(moveTargetCursor(toggleBreaker(powered(), 'nav'), 1).targetCursor).toBe(powered().targetCursor)
    const highlighted = moveTargetCursor(powered(), 1)
    expect(confirmTarget(toggleBus(highlighted)).course.target).toBe(powered().course.target)
  })

  test('stopped past the target, ВЫБРАТЬ on it aims the ship back: the way home from an overshoot', () => {
    const start = initialSim()
    const past = toggleBus(initialSim(0, 2 * distanceToGo(start.course, start.ship.x)))
    expect(navigate(past.course, past.ship).cue).toBe('behind')
    const back = confirmTarget(past)
    expect(back.course.target).toBe(past.course.target)
    expect(back.course.turn).not.toBeNull()
  })
})

describe("the pilot's clock", () => {
  const course = launchCourse()
  const phi = Math.atanh(0.9)

  test('a new flight starts at a minute a second, and the clock turns from real time to a year a second', () => {
    expect(clockSetting(initialSim())).toBe(60)
    expect(currentWarp(initialSim())).toBe(60)
    expect(clockSetting(atFastestClock(initialSim()))).toBe(YEARS)
    expect(clockSetting(CLOCK_STEPS.reduce<SimState>((s) => turnClock(s, -1), initialSim()))).toBe(1)
  })

  test('turned up, it picks up within seconds and then holds the setting: it never runs faster by itself', () => {
    // Arrange: a day a second, thrusting towards the Galactic Centre with nothing to stop for in thousands of light years
    const day = [1, 1, 1].reduce<SimState>((s, step) => turnClock(s, step as 1), initialSim())
    let s = setThrottle(runUntil(deepSpace(spooled(toggleShield(day))), (state) => !state.course.turn), 1)

    // Act
    const seen: number[] = []
    for (let t = 0; t < 30; t += 0.05) {
      s = stepSim(s, 0.05)
      seen.push(currentWarp(s))
    }

    // Assert
    expect(clockSetting(day)).toBe(86_400)
    expect(Math.max(...seen)).toBe(86_400)
    expect(seen[Math.round(5 / 0.05)]).toBe(86_400)
    expect(clockHold(s)).toBeNull()
  })

  test('it slows by itself only for what needs the pilot: the brake point, the stop, and air the ship does not tend', () => {
    // Arrange: coasting at 0.9 c a tenth of a light year before the brake point; braking towards the stop; coasting in
    // deep space with the scrubber off; at rest by the star
    const coasting = atFastestClock(initialSim(phi, distanceToGo(course, 0) - brakingDistance(phi) - 1e15))
    const braking = { ...setThrottle(toggleEngine(atFastestClock(initialSim(phi, distanceToGo(course, 0) - brakingDistance(phi)))), -1), spool: 1 }
    const unscrubbed = toggleScrubber(readyForStart(atFastestClock(initialSim(0, 1e19))))
    const arrived = readyForStart(atFastestClock(initialSim(0, distanceToGo(course, 0))))

    // Act
    const [ahead, stopping, stale, still] = [coasting, braking, unscrubbed, arrived].map((s) => run(s, 2))

    // Assert
    expect(clockHold(ahead)).toBe('brake')
    expect(currentWarp(ahead)).toBeLessThan(YEARS / 10)
    expect(clockHold(stopping)).toBe('arrival')
    expect(clockHold(stale)).toBe('air')
    expect(currentWarp(stale)).toBeLessThanOrEqual(UNTENDED_AIR_WARP)
    expect(clockHold(still)).toBeNull()
    expect(currentWarp(run(still, 8))).toBe(YEARS)
  })
})

describe('life support', () => {
  const coastingInDeepSpace = (): SimState => run(readyForStart(atFastestClock(initialSim(0, 1e19))), 5)

  test('a ventilated cabin with its scrubber running stays at the working level, and the clock is free', () => {
    const s = run(coastingInDeepSpace(), 5)
    expect(s.co2).toBeCloseTo(CO2_SCRUBBED, 3)
    expect(faceCo2(s)).toBeLessThan(CO2_LIMIT)
    expect(currentWarp(s)).toBeGreaterThan(1e5)
  })

  test('with the scrubber off the CO₂ climbs, and the clock slows so that the pilot sees it climb', () => {
    const s = run(toggleScrubber(coastingInDeepSpace()), 10)
    expect(currentWarp(s)).toBeLessThanOrEqual(UNTENDED_AIR_WARP)
    expect(s.co2).toBeGreaterThan(CO2_SCRUBBED)
    expect(run(toggleScrubber(s), 10).co2).toBeCloseTo(CO2_SCRUBBED, 1)
  })

  test('with the fans off the breath gathers at the face while weightless, and thrust carries it away', () => {
    const still = run(toggleFans(coastingInDeepSpace()), 2)
    expect(faceCo2(still)).toBeGreaterThan(CO2_LIMIT)
    expect(currentWarp(still)).toBeLessThanOrEqual(UNTENDED_AIR_WARP)
    const thrusting = run(setThrottle(toggleEngine(toggleShield(still)), 1), 3)
    expect(faceCo2(thrusting)).toBeLessThan(CO2_LIMIT)
  })

  test('a cold ship cleans no air', () => {
    expect(run(initialSim(0, 1e19), 10).co2).toBeGreaterThan(CO2_SCRUBBED)
  })
})

test('a jump to speed arrives with the bus on and the engine armed, and a new flight starts cold', () => {
  const jump = initialSim(Math.atanh(0.9))
  expect([jump.power, jump.busOn, jump.armed]).toEqual([1, true, true])
  const cold = initialSim()
  expect([cold.power, cold.busOn, cold.armed]).toEqual([0, false, false])
})

test('the cabin lights ramp on and off', () => {
  // Arrange
  const advance = (s: SimState): SimState => {
    let state = s
    for (let t = 0; t < 2; t += 1 / 60) state = stepSim(state, 1 / 60)
    return state
  }

  // Act
  const on = advance(toggleCabinLights(toggleBus(initialSim())))
  const off = advance(toggleCabinLights(on))

  // Assert
  expect(on.lights).toBeGreaterThan(0.99)
  expect(off.lights).toBeLessThan(0.01)
})

test('the shutters travel at a steady rate, and the tint and the instrument dimmer follow their switches', () => {
  // Arrange
  const advance = (s: SimState, seconds: number): SimState => {
    let state = s
    for (let t = 0; t < seconds; t += 1 / 60) state = stepSim(state, 1 / 60)
    return state
  }

  // Act
  const closing = advance(toggleShutters(initialSim()), 1)
  const closed = advance(closing, 4)
  const opened = advance(toggleShutters(closed), 4)
  const tinted = advance(toggleFilter(initialSim()), 3)
  const dimmed = advance(toggleInstrumentsDim(initialSim()), 3)

  // Assert
  expect(closing.shutters).toBeGreaterThan(0.2)
  expect(closing.shutters).toBeLessThan(0.8)
  expect(closed.shutters).toBe(1)
  expect(opened.shutters).toBe(0)
  expect(tinted.filter).toBeGreaterThan(0.99)
  expect(dimmed.dim).toBeGreaterThan(0.99)
})

test('the indicators on the glass are on by default and can be switched off', () => {
  expect(initialSim().hudOn).toBe(true)
  expect(toggleHud(initialSim()).hudOn).toBe(false)
})

describe('brake callout', () => {
  /** At 0.9 c towards α Cen A, with the stopping point `share` of a braking distance ahead. */
  const PHI = Math.atanh(0.9)
  const closing = (share: number): SimState =>
    initialSim(PHI, distanceToGo(launchCourse(), 0) - share * brakingDistance(PHI))
  const braking = (s: SimState): SimState => ({ ...setThrottle(toggleEngine(s), -1), spool: 1 })

  test('sounds once the braking distance reaches the stopping point and the ship is not braking', () => {
    expect(isBrakingOverdue(closing(0.6))).toBe(true)
    expect(isBrakingOverdue({ ...setThrottle(toggleEngine(closing(0.6)), 1), spool: 1 })).toBe(true) // thrusting on
  })

  test('falls silent as soon as the ship brakes', () => {
    expect(isBrakingOverdue(braking(closing(0.6)))).toBe(false)
  })

  test('is silent before the brake point, at rest and while turning', () => {
    expect(isBrakingOverdue(closing(2))).toBe(false)
    expect(isBrakingOverdue(initialSim())).toBe(false)
    expect(isBrakingOverdue(selectTarget(initialSim(), indexOfTarget('Сириус')))).toBe(false)
  })
})

describe('messages from the Earth', () => {
  /** At rest where the pilot stops for `name`, fifty years after launch: at the end of a leg, before the first step. */
  const stoppedAt = (name: string): SimState => {
    const course = launchCourse(indexOfTarget(name))
    return { ...readyForStart(initialSim()), course, local: null, ship: { ...rest(), x: distanceToGo(course, 0), t: 50 * YEARS } }
  }

  test('start to arrive within seconds of launch, while the clock runs a minute a second', () => {
    expect(initialSim().messagesHeard).toBe(0)
    expect(run(toggleBus(initialSim()), 3).messagesHeard).toBeGreaterThanOrEqual(2)
  })

  test('are not heard by a cold receiver, nor with the radio breaker out', () => {
    expect(run(initialSim(), 3).messagesHeard).toBe(0)
    expect(run(toggleBreaker(toggleBus(initialSim()), 'comms'), 3).messagesHeard).toBe(0)
  })

  test('are heard all at once where the link is up, since the Earth repeats them', () => {
    const vega = stoppedAt('Вега')
    expect(stepSim(vega, 0.05).messagesHeard).toBe(messagesDue(commLink(vega.course, vega.ship).earthSeen))
  })

  test('are not heard where the signal is too weak, however long their light has been here', () => {
    const arcturus = stoppedAt('Арктур')
    expect(messagesDue(commLink(arcturus.course, arcturus.ship).earthSeen)).toBeGreaterThan(5)
    expect(stepSim(arcturus, 0.05).messagesHeard).toBe(0)
  })
})

describe('the desk computer’s records', () => {
  test('each message heard is filed with the ship time it came in, and is not read yet', () => {
    const s = run(toggleBus(initialSim()), 3) // a minute a second: the launch message and the one a minute later

    expect(s.messagesHeard).toBeGreaterThanOrEqual(2)
    expect(s.mailArrivedAt).toHaveLength(s.messagesHeard)
    expect(s.mailArrivedAt[1]).toBeGreaterThanOrEqual(s.mailArrivedAt[0])
    expect(s.mailRead).toBe(0)
  })

  test('where each leg began goes into the track once the ship stops, for the map; turning on the spot is no leg', () => {
    const s = initialSim(0, 1e15) // at rest, a thousand billion km down the first leg

    const turned = selectTarget(s, indexOfTarget('Сириус'))

    expect(s.track).toEqual([launchCourse().origin])
    expect(turned.track).toEqual(s.track)
    expect(selectTarget(turned, indexOfTarget('Вега')).track).toHaveLength(1)
    expect(selectTarget(initialSim(), indexOfTarget('Сириус')).track).toEqual([])
  })

  test('a leg that ends goes into the track from where it began', () => {
    const leg = runUntil(setThrottle(spooled(toggleShield(initialSim(0, 1e15))), 1), (s) => s.local === null)
    const stopped = runUntil(setThrottle(run(leg, 2), 0), (s) => s.local !== null)
    expect(stopped.track).toEqual([...leg.track, leg.course.origin])
  })
})

describe('faults', () => {
  const withHabitat = (s: SimState, change: Partial<SimState['habitat']>): SimState => ({ ...s, habitat: { ...s.habitat, ...change } })
  /** A tended ship at the fastest clock in deep space, nothing near to hold it, with no fault due unless a test sets one. */
  const tended = atFastestClock(readyForStart(initialSim(0, 1e15)))

  test('a flight without a seed has none: tests run clean; one with a seed has its first fault somewhere ahead', () => {
    expect(initialSim().nextFaultAt).toBe(Infinity)
    expect(initialSim(0, 0, 7).nextFaultAt).toBeGreaterThan(0)
    expect(initialSim(0, 0, 7).nextFaultAt).toBeLessThan(Infinity)
  })

  test('a fault strikes at its moment: the frame stops there, the log says so and the next one is drawn', () => {
    const due = { ...atFastestClock(readyForStart(initialSim(0, 1e15, 7))), warp: YEARS, nextFaultAt: 1000 }

    const s = stepSim(due, 0.05)

    expect(s.ship.tau).toBeCloseTo(1000, 6)
    expect(activeFaults(s.habitat)).toHaveLength(1)
    expect(s.log[0].text).toMatch(/^Отказ: /)
    expect(s.nextFaultAt).toBeGreaterThan(1000)
  })

  test('an open fault holds the clock and says so; dealt with, it lets it go and the log says that too', () => {
    const struck = run(withHabitat(tended, { heater1Failed: true }), 3)
    const fixed = run(toggleHeater(struck, 2), 3)

    expect(clockHold(struck)).toBe('fault')
    expect(currentWarp(struck)).toBeLessThanOrEqual(FAULT_WARP)
    expect(clockHold(fixed)).toBeNull()
    expect(fixed.log.map((e) => e.text)).toContain('Устранено: отказ обогревателя 1')
  })

  test('the stuck vent ignores its switch, the isolation valve closes its line; the scrammed reactor clears when started', () => {
    const stuck = withHabitat(tended, { ventOpen: true, ventStuck: true })
    const scrammed = withHabitat(tended, { reactorOn: false, reactorScrammed: true })

    expect(toggleVent(stuck).habitat.ventOpen).toBe(true)
    expect(activeFaults(toggleIsolation(stuck).habitat)).toEqual([])
    expect(toggleReactor(scrammed).habitat).toMatchObject({ reactorOn: true, reactorScrammed: false })
  })

  test('the stuck vent stays open, and holds the clock, until its line is isolated and the cabin is pressed back up', () => {
    const h = tended.habitat
    const thin = withHabitat(tended, { ventOpen: true, ventStuck: true, ventIsolated: true, n2Kg: h.n2Kg * 0.5, o2Kg: h.o2Kg * 0.5 })

    const held = run(thin, 3)
    const refilled = runUntil(toggleRepress(held), (s) => activeFaults(s.habitat).length === 0)

    expect(clockHold(held)).toBe('fault')
    expect(activeFaults(refilled.habitat)).toEqual([])
    expect(refilled.log.map((e) => e.text)).toContain('Устранено: клапан сброса заело открытым')
  })

  test('left alone, a dead heater kills the crew within two days; with the other heater on, it does not', () => {
    const struck = withHabitat(tended, { heater1Failed: true })
    const untilDead = (s: SimState): SimState => {
      let at = s
      while (at.ship.tau < 2 * 86_400 && crewCondition(at.habitat, at.dose) !== 'погиб') at = stepSim(at, 1)
      return at
    }

    const dead = untilDead(struck)

    expect(crewCondition(dead.habitat, dead.dose)).toBe('погиб')
    expect(dead.log.map((e) => e.text)).toContain('Экипаж погиб')
    expect(crewCondition(untilDead(toggleHeater(struck, 2)).habitat, 0)).toBe('норма')
  })

  test('the log keeps the last fifty, newest first, with the letters and a tripped bus', () => {
    const full = { ...tended, log: Array.from({ length: 50 }, (_, i) => ({ tau: i, earth: i, text: `старое ${i}`, level: 'info' as const })) }

    const tripped = stepSim({ ...full, busTripped: false, habitat: { ...full.habitat, batteryWh: 0, reactorOn: false } }, 0.05)
    const heard = run(toggleBus(initialSim()), 3)

    expect(tripped.log).toHaveLength(50)
    expect(tripped.log.map((e) => e.text)).toContain('Главная шина сработала')
    expect(tripped.log.at(-1)?.text).toMatch(/^старое/) // the new lines on top, the oldest gone off the bottom
    expect(tripped.log.map((e) => e.text)).not.toContain('старое 49')
    expect(heard.log.filter((e) => e.text === 'Письмо от ЦУП')).toHaveLength(heard.messagesHeard)
  })
})

describe('flight by a body', () => {
  const chemReady = (s: SimState): SimState =>
    [togglePressurisation, toggleFeed, toggleChemEngine].reduce((t, f) => f(t), toggleBus(s))
  const fullChemLever = (s: SimState): SimState => Array.from({ length: 7 }).reduce<SimState>((t) => nudgeChemThrottle(t, 1), s)

  test('the flight begins on an orbit of the Earth, which holds a clock turned all the way up to a revolution in 30 s', () => {
    const s = run(atFastestClock(toggleBus(initialSim())), 3) // powered, so that the air is tended; 3 s for the clock to rise
    expect(orbitOf(s.local ?? { centre: null, base: [0, 0, 0], r: [0, 0, 0], v: [0, 0, 0] })?.globe.name).toBe('Земля')
    expect(clockHold(s)).toBe('orbit')
    expect(currentWarp(s)).toBeCloseTo((orbitOf(s.local!)?.elements.period ?? 0) / 30, -1)
  })

  test('the chemical engine burns with the helium up, the feed open, its start switch on and the lever open, and raises the orbit', () => {
    const lit = run(fullChemLever(chemReady(initialSim())), 5)
    const before = orbitOf(initialSim().local!)?.elements.apoapsis ?? 0
    expect(isChemBurning(lit)).toBe(true)
    expect(lit.burnStartedAt).not.toBeNull()
    expect(lit.propulsion.propellant).toBeLessThan(initialSim().propulsion.propellant)
    expect(orbitOf(lit.local!)?.elements.apoapsis ?? 0).not.toBeCloseTo(before, -3)
  })

  test('it holds the clock to ×60 while it burns, and the light mode puts it out', () => {
    const lit = run(atFastestClock(fullChemLever(chemReady(initialSim()))), 3)
    expect(clockHold(lit)).toBe('burn')
    expect(currentWarp(lit)).toBeLessThanOrEqual(BURN_WARP)
    expect(isChemBurning(toggleLightMode(lit))).toBe(false)
  })

  test('АВАРИЙНАЯ ОТСЕЧКА throws both start switches off', () => {
    const both = toggleEngine(fullChemLever(chemReady(initialSim())))
    const cut = cutOff(both)
    expect(cut.engineOn).toBe(false)
    expect(cut.propulsion.engineOn).toBe(false)
  })

  test('in РУЧН the keys turn the ship and the thrusters burn for it; in АВТО they do nothing', () => {
    const held = setStick(toggleManualAttitude(toggleBus(initialSim())), [0, 1, 0])
    const turned = run(held, 2)
    expect(turnAngle(initialSim().course.attitude, turned.course.attitude) / (Math.PI / 180)).toBeCloseTo(6, 0)
    expect(turned.propulsion.rcsPropellant).toBeLessThan(held.propulsion.rcsPropellant)
    const auto = run(setStick(toggleBus(initialSim()), [0, 1, 0]), 2)
    expect(auto.course.attitude).toEqual(initialSim().course.attitude)
  })

  test('in РУЧН ВЫБРАТЬ only changes the target: the pilot turns the ship', () => {
    const picked = selectTarget(toggleManualAttitude(initialSim()), indexOfTarget('Сириус'))
    expect(picked.course.turn).toBeNull()
    expect(picked.course.target).toBe(indexOfTarget('Сириус'))
  })

  test('falling into the air wrecks the ship: the crew is dead, the log says where, and nothing moves after', () => {
    const start = initialSim()
    const falling = { ...start, local: start.local && { ...start.local, v: [0, 0, 0] as const } }
    const wrecked = runUntil(atFastestClock(falling), (s) => s.wrecked, 300)
    expect(wrecked.wrecked).toBe(true)
    expect(crewOf(wrecked)).toBe('погиб')
    expect(wrecked.log.map((e) => e.text)).toContain('Корабль разрушен: вход в атмосферу, Земля')
    expect(stepSim(wrecked, 0.05)).toBe(wrecked)
  })

  test('the event timer counts to a strike first, then the length of a burn, then the brake point of a leg, then the periapsis', () => {
    const start = initialSim()
    expect(eventTimer({ ...start, local: start.local && { ...start.local, v: [0, 0, 0] as const } })?.event).toBe('impact')
    expect(eventTimer(run(fullChemLever(chemReady(start)), 1))?.event).toBe('burn')
    expect(eventTimer(start)).toBeNull() // the launch orbit is round: no periapsis to time
    expect(eventTimer(run(fullChemLever(chemReady(start)), 3))?.event).toBe('burn')
    const raised = run(cutOff(run(fullChemLever(chemReady(start)), 3)), 1)
    expect(eventTimer(raised)?.event).toBe('periapsis')
    const leg = runUntil(setThrottle(spooled(toggleShield(initialSim(0, 1e15))), 1), (s) => s.local === null && s.ship.phi > 0)
    expect(eventTimer(leg)?.event).toBe('brake')
  })

  test('a leg that ends by its target finds the tanks full', () => {
    const course = launchCourse(indexOfTarget('Марс'))
    const spent = { ...initialSim(), propulsion: { ...initialSim().propulsion, propellant: 0 } }
    const stopped = stepSim({ ...spent, course, local: null, ship: { ...rest(), x: distanceToGo(course, 0) } }, 0.05)
    expect(stopped.local).not.toBeNull()
    expect(stopped.propulsion.propellant).toBe(initialSim().propulsion.propellant)
  })
})

test('the chemical lever let go between its stops settles where it can stand', () => {
  expect(setChemThrottle(initialSim(), 0.45).propulsion.throttle).toBeCloseTo(0.45, 12)
  expect(setChemThrottle(initialSim(), 0.75).propulsion.throttle).toBeCloseTo(0.6, 12)
  expect(setChemThrottle(initialSim(), 1.4).propulsion.throttle).toBe(1)
  expect(setChemThrottle(initialSim(), -0.3).propulsion.throttle).toBe(0)
})
