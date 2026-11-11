// The habitat's rare random faults: when the next one comes, which, what it does, and whether the crew has dealt with it.
// Deterministic from a seed kept in the state, so that a test can call up a fault and the same flight replays the same.
import { pressureKpa, type Habitat } from './habitat'
import { YEAR } from './physics'

const SAFE_KPA = 95 // the cabin pressed back up far enough for the vent's fault to be over: the systems card's «норма»

/** Ship s between failures of each kind, on average: choice; the ISS's life-support units run 0.3–13 years (FORMULAS.md). */
export const FAULT_MTBF = 2 * YEAR

export type FaultId = 'reactor' | 'heater' | 'vent'

/** What each fault is called: the log and the desk write it after «Отказ:», the manual over its procedure. */
export const FAULT_NAMES: Readonly<Record<FaultId, string>> = {
  reactor: 'аварийная защита реактора',
  heater: 'отказ обогревателя 1',
  vent: 'клапан сброса заело открытым',
}

/** What it does: the reactor's protection throws its switch; the heater goes dead with its switch on; the vent opens and sticks. */
const EFFECTS: Readonly<Record<FaultId, Partial<Habitat>>> = {
  reactor: { reactorOn: false, reactorScrammed: true },
  heater: { heater1Failed: true },
  vent: { ventOpen: true, ventStuck: true },
}

/** mulberry32: a 32-bit state to a number in [0, 1), and the next state. */
export function random(state: number): readonly [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0
  let t = Math.imul(next ^ (next >>> 15), next | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4_294_967_296, next]
}

/** What can fail in the habitat as it is: a reactor that runs, a heater not yet broken, a vent not yet stuck. */
export const possibleFaults = (h: Habitat): readonly FaultId[] => [
  ...(h.reactorOn ? (['reactor'] as const) : []),
  ...(h.heater1Failed ? [] : (['heater'] as const)),
  ...(h.ventStuck ? [] : (['vent'] as const)),
]

/**
 * When the next fault comes after `now`: exponential, at the rate of the faults that can happen now.
 * ponytail: the rate is fixed at the draw; a reactor turned off in the meantime only makes the strike miss, and draw again.
 */
export function nextFaultAt(now: number, h: Habitat, seed: number): { readonly at: number; readonly seed: number } {
  const [u, next] = random(seed)
  const rate = possibleFaults(h).length / FAULT_MTBF
  return { at: rate > 0 ? now - Math.log(1 - u) / rate : now + FAULT_MTBF, seed: next }
}

/** A fault strikes: one of those that can, at random; or none, if nothing can fail now. */
export function strike(h: Habitat, seed: number): { readonly habitat: Habitat; readonly seed: number; readonly fault: FaultId | null } {
  const [u, next] = random(seed)
  const possible = possibleFaults(h)
  if (possible.length === 0) return { habitat: h, seed: next, fault: null }
  const fault = possible[Math.floor(u * possible.length)]
  return { habitat: { ...h, ...EFFECTS[fault] }, seed: next, fault }
}

/**
 * The faults that still need the crew: a scrammed reactor not started again, a dead heater with the other one off, a
 * stuck vent with its line open or the air it let out not yet back. The heater and the vent stay broken for the flight;
 * the procedures work round them.
 */
export const activeFaults = (h: Habitat): readonly FaultId[] => [
  ...(h.reactorScrammed ? (['reactor'] as const) : []),
  ...(h.heater1Failed && !h.heater2On ? (['heater'] as const) : []),
  ...(h.ventStuck && !(h.ventIsolated && pressureKpa(h) >= SAFE_KPA) ? (['vent'] as const) : []),
]
