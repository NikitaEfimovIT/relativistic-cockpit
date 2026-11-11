import { describe, expect, test } from 'vitest'
import {
  BUS_LIMIT_W, INITIAL_HABITAT, celsius, crewCondition, heatLossW, pio2MmHg, ppO2Kpa, pressureKpa, stepHabitat, usefulConsciousness,
  type Habitat, type HabitatInputs,
} from './habitat'

const HOUR = 3600
const DAY = 86_400
const BASE: HabitatInputs = { busOn: true, baseLoadW: 1300 } // screens, lights, fans, scrubber and the rest, without heat or O₂

/** Runs the habitat for `seconds` of ship time in frames of `frame` s, as the sim would at a fast clock. */
function live(h: Habitat, seconds: number, inputs: HabitatInputs = BASE, frame = 600): Habitat {
  let at = h
  for (let t = 0; t < seconds; t += frame) at = stepHabitat(at, inputs, frame).habitat
  return at
}

/** Ship seconds until `isDone`, in steps of `frame`. */
function timeUntil(h: Habitat, isDone: (h: Habitat) => boolean, inputs: HabitatInputs = BASE, frame = 60, limit = 60 * DAY): number {
  let at = h
  for (let t = 0; t < limit; t += frame) {
    if (isDone(at)) return t
    at = stepHabitat(at, inputs, frame).habitat
  }
  return Infinity
}

describe('the habitat left to itself', () => {
  test('holds 22 °C, 101 kPa and 21 % oxygen for days, with the heater and the oxygen generator on', () => {
    const h = live(INITIAL_HABITAT, 3 * DAY)

    expect(celsius(h)).toBeCloseTo(22, 0)
    expect(pressureKpa(h)).toBeCloseTo(101.3, 0)
    expect(ppO2Kpa(h)).toBeCloseTo(21.3, 0)
    expect(crewCondition(h, 0)).toBe('норма')
  })

  test('steps of an hour, as the fastest clock takes, land where small steps do', () => {
    const fine = live({ ...INITIAL_HABITAT, heater1On: false }, DAY, BASE, 60)
    const coarse = live({ ...INITIAL_HABITAT, heater1On: false }, DAY, BASE, HOUR)

    expect(celsius(coarse)).toBeCloseTo(celsius(fine), 0)
  })
})

describe('heat', () => {
  test('the insulated hull loses about 2 kW to space at 22 °C', () => {
    expect(heatLossW(295.15)).toBeGreaterThan(1500)
    expect(heatLossW(295.15)).toBeLessThan(3000)
  })

  test('with the heaters off it cools below 18 °C in a few hours', () => {
    const hours = timeUntil({ ...INITIAL_HABITAT, heater1On: false }, (h) => celsius(h) < 18) / HOUR

    expect(hours).toBeGreaterThan(1.5)
    expect(hours).toBeLessThan(4)
  })

  test('a dead heater warms nothing with its switch on; the other one takes over', () => {
    const dead = { ...INITIAL_HABITAT, heater1Failed: true }

    expect(timeUntil(dead, (h) => celsius(h) < 18) / HOUR).toBeLessThan(4)
    expect(celsius(live({ ...dead, heater2On: true }, 12 * HOUR))).toBeCloseTo(INITIAL_HABITAT.setpoint, 0)
  })

  test('with no power at all only the crew warms it, and in a month it is far below freezing', () => {
    const h = live({ ...INITIAL_HABITAT, reactorOn: false, batteryWh: 0 }, 30 * DAY, { busOn: false, baseLoadW: 0 })

    expect(celsius(h)).toBeLessThan(-50)
    expect(crewCondition(h, 0)).toBe('погиб')
  })

  test('cold air takes the body’s heat: at 6 °C thinking is impaired in about an hour', () => {
    const cold = { ...INITIAL_HABITAT, kelvin: 279.15 }
    const frozen: HabitatInputs = { busOn: true, baseLoadW: 0 } // no heater, held there by nothing: the test is the body
    const hours = timeUntil({ ...cold, heater1On: false }, (h) => crewCondition(h, 0) !== 'норма', frozen) / HOUR

    expect(hours).toBeGreaterThan(0.7)
    expect(hours).toBeLessThan(1.6)
  })
})

describe('air', () => {
  test('without the oxygen generator the inspired oxygen falls to the caution level in about three days', () => {
    const days = timeUntil({ ...INITIAL_HABITAT, o2GenOn: false }, (h) => pio2MmHg(h) < 127, BASE, 600) / DAY

    expect(days).toBeGreaterThan(2)
    expect(days).toBeLessThan(4.5)
  })

  test('an open vent valve: the caution in about three hours, the lowest pressure for life in about a day', () => {
    const open = { ...INITIAL_HABITAT, ventOpen: true }

    const caution = timeUntil(open, (h) => pio2MmHg(h) < 127) / HOUR
    const floor = timeUntil(open, (h) => pressureKpa(h) < 34.5) / HOUR

    expect(caution).toBeGreaterThan(2)
    expect(caution).toBeLessThan(4.5)
    expect(floor).toBeGreaterThan(14)
    expect(floor).toBeLessThan(32)
  })

  test('a vent stuck open lets nothing out once its line is isolated', () => {
    const isolated = { ...INITIAL_HABITAT, ventOpen: true, ventStuck: true, ventIsolated: true }

    expect(pressureKpa(live(isolated, 12 * HOUR))).toBeCloseTo(pressureKpa(INITIAL_HABITAT), 0)
  })

  test('repress brings the pressure back from the tank and stops short of 103 kPa', () => {
    const vented = live({ ...INITIAL_HABITAT, ventOpen: true }, 6 * HOUR)
    const refilled = live({ ...vented, ventOpen: false, repressOn: true }, 12 * HOUR)

    expect(pressureKpa(vented)).toBeLessThan(80)
    expect(pressureKpa(refilled)).toBeGreaterThan(100)
    expect(pressureKpa(refilled)).toBeLessThanOrEqual(103)
    expect(refilled.tankKg).toBeLessThan(INITIAL_HABITAT.tankKg)
  })

  test('repress fills a cabin vented to nothing', () => {
    const empty = { ...INITIAL_HABITAT, n2Kg: 0, o2Kg: 0, repressOn: true }

    expect(pressureKpa(live(empty, 2 * HOUR))).toBeGreaterThan(30)
  })

  test('useful consciousness runs out fast in thin air: minutes at 7.9 kPa of oxygen, seconds at 3.4', () => {
    expect(usefulConsciousness(7.9) / 60).toBeGreaterThan(3)
    expect(usefulConsciousness(7.9) / 60).toBeLessThan(5)
    expect(usefulConsciousness(3.4)).toBeLessThan(15)
    expect(usefulConsciousness(21)).toBe(Infinity)
  })
})

describe('power', () => {
  test('with the reactor off the battery carries the load for hours, then the bus trips', () => {
    const off = { ...INITIAL_HABITAT, reactorOn: false }
    let h = off
    let trippedAfter = Infinity
    for (let t = 0; t < DAY; t += 60) {
      const step = stepHabitat(h, BASE, 60)
      h = step.habitat
      if (step.tripped) {
        trippedAfter = t
        break
      }
    }

    expect(trippedAfter / HOUR).toBeGreaterThan(3)
    expect(trippedAfter / HOUR).toBeLessThan(12)
    expect(h.batteryWh).toBe(0)
  })

  test('with the reactor on the battery stays full', () => {
    expect(live(INITIAL_HABITAT, DAY).batteryWh).toBe(INITIAL_HABITAT.batteryWh)
  })

  test('both heaters flat out on a cold ship and everything else on draw more than the bus takes: it trips', () => {
    const cold = { ...INITIAL_HABITAT, kelvin: 278.15, heater2On: true }

    const { tripped } = stepHabitat(cold, { busOn: true, baseLoadW: BUS_LIMIT_W - 3000 }, 1)

    expect(tripped).toBe(true)
  })

  test('with the bus off the reactor still charges the battery', () => {
    const { habitat } = stepHabitat({ ...INITIAL_HABITAT, batteryWh: 1000 }, { busOn: false, baseLoadW: 1300 }, HOUR)

    expect(habitat.batteryWh).toBeGreaterThan(1500) // what the life support leaves of the 3 kW
    expect(habitat.batteryWh).toBeLessThan(1000 + 3000)
  })

  test('the life support has a bus of its own: with the main bus off, as at a cold start, the heat and the oxygen hold', () => {
    const h = live(INITIAL_HABITAT, DAY, { busOn: false, baseLoadW: 1300 })

    expect(celsius(h)).toBeCloseTo(22, 0)
    expect(ppO2Kpa(h)).toBeCloseTo(21.3, 0)
  })

  test('with the main bus off only the life support draws on the battery', () => {
    const { habitat, tripped } = stepHabitat({ ...INITIAL_HABITAT, reactorOn: false }, { busOn: false, baseLoadW: 1300 }, HOUR)

    expect(tripped).toBe(false)
    expect(INITIAL_HABITAT.batteryWh - habitat.batteryWh).toBeLessThan(2000) // the heater and the generator, not the 1.3 kW
    expect(habitat.batteryWh).toBeLessThan(INITIAL_HABITAT.batteryWh)
  })

  test('with the reactor off and the battery flat the life support stops too', () => {
    const dead = { ...INITIAL_HABITAT, reactorOn: false, batteryWh: 0 }

    const h = live(dead, DAY, { busOn: false, baseLoadW: 0 })

    expect(celsius(h)).toBeLessThan(10)
    expect(ppO2Kpa(h)).toBeLessThan(20)
  })
})

describe('the crew', () => {
  test('dies of radiation, cold or hypoxia, and is otherwise well', () => {
    expect(crewCondition(INITIAL_HABITAT, 6)).toBe('погиб')
    expect(crewCondition({ ...INITIAL_HABITAT, hypoxia: 3 }, 0)).toBe('погиб')
    expect(crewCondition({ ...INITIAL_HABITAT, hypoxia: 1.2 }, 0)).toBe('гипоксия')
    expect(crewCondition({ ...INITIAL_HABITAT, coldJ: 400_000 }, 0)).toBe('переохлаждение')
    expect(crewCondition(INITIAL_HABITAT, 0)).toBe('норма')
  })
})
