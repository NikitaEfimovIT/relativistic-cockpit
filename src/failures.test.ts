import { describe, expect, test } from 'vitest'
import { FAULT_MTBF, activeFaults, nextFaultAt, possibleFaults, random, strike } from './failures'
import { INITIAL_HABITAT } from './habitat'

describe('the random numbers', () => {
  test('are the same from the same seed, between 0 and 1, and move the seed on', () => {
    const [a, next] = random(42)
    const draws = Array.from({ length: 1000 }).reduce<{ seed: number; values: number[] }>(
      ({ seed, values }) => { const [v, s] = random(seed); return { seed: s, values: [...values, v] } }, { seed: 7, values: [] })

    expect(random(42)).toEqual([a, next])
    expect(next).not.toBe(42)
    expect(Math.min(...draws.values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...draws.values)).toBeLessThan(1)
    expect(draws.values.reduce((sum, v) => sum + v, 0) / 1000).toBeCloseTo(0.5, 1)
  })
})

describe('when a fault comes', () => {
  test('later than now, on average the mean time between failures shared out between the faults that can happen', () => {
    const gaps = Array.from({ length: 4000 }).reduce<{ seed: number; sum: number }>(({ seed, sum }) => {
      const next = nextFaultAt(1000, INITIAL_HABITAT, seed)
      expect(next.at).toBeGreaterThan(1000)
      return { seed: next.seed, sum: sum + next.at - 1000 }
    }, { seed: 3, sum: 0 })

    expect(gaps.sum / 4000 / (FAULT_MTBF / 3)).toBeCloseTo(1, 1)
  })

  test('with nothing left that can fail, it looks again a mean time between failures later', () => {
    const spent = { ...INITIAL_HABITAT, reactorOn: false, heater1Failed: true, ventStuck: true }

    expect(possibleFaults(spent)).toEqual([])
    expect(nextFaultAt(0, spent, 1).at).toBe(FAULT_MTBF)
  })
})

describe('a fault', () => {
  test('strikes only what can fail: a running reactor, a heater not yet broken, a vent not yet stuck', () => {
    const onlyReactor = { ...INITIAL_HABITAT, heater1Failed: true, ventStuck: true }

    const struck = strike(onlyReactor, 5)

    expect(struck.fault).toBe('reactor')
    expect(struck.habitat.reactorOn).toBe(false)
    expect(struck.habitat.reactorScrammed).toBe(true)
    expect(struck.seed).not.toBe(5)
    expect(strike({ ...onlyReactor, reactorOn: false }, 5).fault).toBeNull()
  })

  test('each of the three in turn, from enough seeds', () => {
    const found = new Set(Array.from({ length: 30 }, (_, seed) => strike(INITIAL_HABITAT, seed).fault))
    const vent = strike({ ...INITIAL_HABITAT, reactorOn: false, heater1Failed: true }, 1)
    const heater = strike({ ...INITIAL_HABITAT, reactorOn: false, ventStuck: true }, 1)

    expect(found).toEqual(new Set(['reactor', 'heater', 'vent']))
    expect(vent.habitat).toMatchObject({ ventOpen: true, ventStuck: true })
    expect(heater.habitat).toMatchObject({ heater1Failed: true, heater1On: true }) // its switch stays where it was
  })

  test('stays open until the crew deals with it: the reactor restarted, the other heater on, the vent line isolated', () => {
    const struck = { ...INITIAL_HABITAT, reactorOn: false, reactorScrammed: true, heater1Failed: true, ventOpen: true, ventStuck: true }

    expect(activeFaults(INITIAL_HABITAT)).toEqual([])
    expect(activeFaults(struck)).toEqual(['reactor', 'heater', 'vent'])
    expect(activeFaults({ ...struck, reactorScrammed: false, heater2On: true, ventIsolated: true })).toEqual([])
  })
})
