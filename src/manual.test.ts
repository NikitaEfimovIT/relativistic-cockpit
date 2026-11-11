import { expect, test } from 'vitest'
import { FAULT_NAMES, type FaultId } from './failures'
import { FAULTS_PAGE, MANUAL, proceduresInOrder, ticksOf } from './manual'
import {
  initialSim, stepSim, toggleIsolation, toggleRepress, toggleBus, toggleFeed, toggleManualAttitude, togglePressurisation, type SimState,
} from './sim'
import type { Quat } from './voyage'

const powered = toggleBus(initialSim())
const withHabitat = (s: SimState, change: Partial<SimState['habitat']>): SimState => ({ ...s, habitat: { ...s.habitat, ...change } })
const procedureOf = (fault: FaultId) => (MANUAL[FAULTS_PAGE].procedures ?? []).find((p) => p.fault === fault)
const ticks = (s: SimState, fault: FaultId): readonly boolean[] => {
  const procedure = procedureOf(fault)
  return procedure ? ticksOf(procedure, s) : []
}

test('every fault has its procedure on the faults page, under its name', () => {
  const procedures = MANUAL[FAULTS_PAGE].procedures ?? []

  expect(procedures.map((p) => p.fault).sort()).toEqual(Object.keys(FAULT_NAMES).sort())
  procedures.forEach((p) => expect(p.title.toLowerCase()).toBe(p.fault && FAULT_NAMES[p.fault]))
})

test('the orbit section has its checklists, ticked as the pilot goes: raising the orbit, up to the burn', () => {
  const page = MANUAL.find((p) => p.title.startsWith('10.'))
  const raise = page?.procedures?.find((p) => p.title === 'ПОДЪЁМ ОРБИТЫ')
  expect(raise).toBeDefined()
  if (!raise) return
  const fed = togglePressurisation(toggleFeed(toggleBus(initialSim())))
  expect(ticksOf(raise, initialSim())).toEqual([false, false, false])
  expect(ticksOf(raise, fed)).toEqual([true, false, false])
  const v = fed.local?.v ?? [0, 0, 1]
  const along = Math.hypot(...v)
  const half: Quat = [v[1] / along, -v[0] / along, 0, 1 - v[2] / along] // −z turned onto the motion, by the half-way quaternion
  const n = Math.hypot(...half)
  const nose: Quat = [half[0] / n, half[1] / n, half[2] / n, half[3] / n]
  const aimed = toggleManualAttitude({ ...fed, course: { ...fed.course, attitude: nose } })
  expect(ticksOf(raise, aimed)).toEqual([true, true, false])
})

test('the steps of the stuck vent tick off as they are done: isolate, repress, wait for 101 kPa, repress off', () => {
  const stuck = withHabitat(powered, { ventOpen: true, ventStuck: true, n2Kg: powered.habitat.n2Kg * 0.9, o2Kg: powered.habitat.o2Kg * 0.9 })
  const pressing = toggleRepress(toggleIsolation(stuck))
  let full = pressing
  for (let i = 0; i < 2000 && !ticks(full, 'vent')[2]; i++) full = stepSim(full, 1)

  expect(ticks(stuck, 'vent')).toEqual([false, false, false, false])
  expect(ticks(toggleIsolation(stuck), 'vent')).toEqual([true, false, false, false])
  expect(ticks(pressing, 'vent')).toEqual([true, true, false, false])
  expect(ticks(toggleRepress(full), 'vent')).toEqual([true, true, true, true])
})

test('a step ticks only after the ones before it: a cabin still full is not «101 kPa reached» before the vent is isolated', () => {
  const stuck = withHabitat(powered, { ventOpen: true, ventStuck: true, repressOn: true })

  expect(ticks(stuck, 'vent')).toEqual([false, false, false, false])
})

test('the procedures of the faults open now come first', () => {
  const heater = withHabitat(powered, { heater1Failed: true })

  expect(proceduresInOrder(MANUAL[FAULTS_PAGE], heater)[0].fault).toBe('heater')
  expect(proceduresInOrder(MANUAL[FAULTS_PAGE], powered).map((p) => p.fault)).toEqual(['reactor', 'heater', 'vent'])
})
