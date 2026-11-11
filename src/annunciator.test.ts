import { describe, expect, test } from 'vitest'
import { acknowledge, annunciatorCells, isCalling, masterAlarm, settleAcknowledged } from './annunciator'
import { CO2_OFF_NOMINAL } from './lifeSupport'
import { LETHAL_DOSE } from './physics'
import {
  initialSim, readyForStart, setThrottle, toggleArm, toggleBreaker, toggleBus, toggleEngine, toggleFans, type SimState,
} from './sim'
import { brakingDistance, distanceToGo, launchCourse } from './voyage'

const toneOf = (s: SimState, label: string): string | undefined => annunciatorCells(s).find((cell) => cell.label === label)?.tone
const powered = (): SimState => toggleBus(initialSim())

describe('the annunciator', () => {
  test('a cold panel shows nothing and calls for nothing, even with the crew exposed', () => {
    const cold = { ...initialSim(), alarm: true, engineOn: true }
    expect(annunciatorCells(cold).every((cell) => cell.tone === 'off')).toBe(true)
    expect(masterAlarm(cold)).toBeNull()
  })

  test('starting the engine unarmed lights a caution, and the master caution with it', () => {
    const s = toggleEngine(powered())
    expect(toneOf(s, 'НЕ ВЗВЕДЁН')).toBe('amber')
    expect(masterAlarm(s)).toBe('caution')
    expect(masterAlarm(toggleArm(s))).toBeNull()
  })

  test('acknowledging quiets the master, and the cell stays lit while the fault lasts', () => {
    const acked = acknowledge(toggleEngine(powered()))
    expect(masterAlarm(acked)).toBeNull()
    expect(toneOf(acked, 'НЕ ВЗВЕДЁН')).toBe('amber')
  })

  test('a fault that clears and comes back calls again', () => {
    const acked = acknowledge(toggleEngine(powered()))
    const cleared = settleAcknowledged(toggleArm(acked))
    expect(masterAlarm(toggleArm(cleared))).toBe('caution')
  })

  test('radiation is a warning, and pulling the dosimeter breaker cannot hide it; the dose caution it can', () => {
    const exposed = { ...powered(), alarm: true, dose: LETHAL_DOSE }
    expect(toneOf(exposed, 'РАДИАЦИЯ')).toBe('red')
    expect(toneOf(exposed, 'ДОЗА')).toBe('amber')
    expect(masterAlarm(exposed)).toBe('warning')
    const pulled = toggleBreaker(exposed, 'dosimeter')
    expect(toneOf(pulled, 'РАДИАЦИЯ')).toBe('red')
    expect(toneOf(pulled, 'ДОЗА')).toBe('off')
  })

  test('CO₂ cautions above the NASA limit, and warns again when it reaches the off-nominal level', () => {
    const stale = toggleFans(readyForStart(initialSim()))
    expect(toneOf(stale, 'CO₂')).toBe('amber')
    const acked = acknowledge(stale)
    const worse = { ...acked, co2: CO2_OFF_NOMINAL }
    expect(toneOf(worse, 'CO₂')).toBe('red')
    expect(masterAlarm(worse)).toBe('warning')
  })

  test('the link with the Earth is cautioned when lost, unless the radio is off its breaker', () => {
    const cruise = initialSim(Math.atanh(0.999999), 1e17)
    expect(toneOf(cruise, 'НЕТ СВЯЗИ')).toBe('amber')
    expect(toneOf(toggleBreaker(cruise, 'comms'), 'НЕТ СВЯЗИ')).toBe('off')
    expect(toneOf(powered(), 'НЕТ СВЯЗИ')).toBe('off')
  })

  test('braking overdue is cautioned, unless the navigation computer is off its breaker', () => {
    const PHI = Math.atanh(0.9)
    const closing = initialSim(PHI, distanceToGo(launchCourse(), 0) - 0.6 * brakingDistance(PHI))
    expect(toneOf(closing, 'ТОРМОЗИ')).toBe('amber')
    expect(isCalling(closing, 'ТОРМОЗИ')).toBe(true) // the chime sounds
    expect(isCalling(acknowledge(closing), 'ТОРМОЗИ')).toBe(false) // and stops when the master is pressed
    expect(toneOf(toggleBreaker(closing, 'nav'), 'ТОРМОЗИ')).toBe('off')
    expect(toneOf({ ...setThrottle(toggleEngine(closing), -1), spool: 1 }, 'ТОРМОЗИ')).toBe('off')
  })
})

describe('the habitat on the annunciator', () => {
  test('the first six cells keep their places, which are the model\'s lenses; the habitat\'s two come after them, then ТОПЛИВО', () => {
    expect(annunciatorCells(powered()).map(({ label }) => label)).toEqual(
      ['РАДИАЦИЯ', 'ДОЗА', 'CO₂', 'ТОРМОЗИ', 'НЕТ СВЯЗИ', 'НЕ ВЗВЕДЁН', 'ПИТАНИЕ', 'ЖИЗНЕОБЕСП.', 'ТОПЛИВО'])
  })

  test('ТОПЛИВО lights when the chemical engine is started without its feed open', () => {
    const started = { ...powered(), propulsion: { ...powered().propulsion, engineOn: true, throttle: 0.5 } }
    expect(annunciatorCells(started).find(({ label }) => label === 'ТОПЛИВО')?.tone).toBe('amber')
    expect(annunciatorCells(powered()).find(({ label }) => label === 'ТОПЛИВО')?.tone).toBe('off')
  })

  test('a bus that tripped itself warns on ПИТАНИЕ, though it is off: the annunciator stays on the battery for it', () => {
    const tripped = { ...powered(), busOn: false, busTripped: true }

    expect(toneOf(tripped, 'ПИТАНИЕ')).toBe('red')
    expect(masterAlarm(tripped)).toBe('warning')
  })

  test('the reactor off with the battery carrying the load cautions on ПИТАНИЕ', () => {
    const s = powered()

    expect(toneOf({ ...s, habitat: { ...s.habitat, reactorOn: false } }, 'ПИТАНИЕ')).toBe('amber')
    expect(toneOf(s, 'ПИТАНИЕ')).toBe('off')
  })

  test('a cabin below 18 °C cautions on ЖИЗНЕОБЕСП.; a crew already harmed warns', () => {
    const s = powered()

    expect(toneOf({ ...s, habitat: { ...s.habitat, kelvin: 288.15 } }, 'ЖИЗНЕОБЕСП.')).toBe('amber')
    expect(toneOf({ ...s, habitat: { ...s.habitat, hypoxia: 1.5 } }, 'ЖИЗНЕОБЕСП.')).toBe('red')
    expect(toneOf(s, 'ЖИЗНЕОБЕСП.')).toBe('off')
  })

  test('an open fault cautions on its cell at once, before any reading strays: the heater and the vent on ЖИЗНЕОБЕСП., the reactor on ПИТАНИЕ', () => {
    const s = powered()
    const heater = { ...s, habitat: { ...s.habitat, heater1Failed: true } }
    const vent = { ...s, habitat: { ...s.habitat, ventOpen: true, ventStuck: true } }
    const reactor = { ...s, busOn: false, habitat: { ...s.habitat, reactorOn: false, reactorScrammed: true } }

    expect(toneOf(heater, 'ЖИЗНЕОБЕСП.')).toBe('amber')
    expect(masterAlarm(heater)).toBe('caution')
    expect(toneOf(vent, 'ЖИЗНЕОБЕСП.')).toBe('amber')
    expect(toneOf({ ...reactor, busOn: true }, 'ПИТАНИЕ')).toBe('amber')
  })
})
