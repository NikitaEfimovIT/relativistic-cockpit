import { isFuelCaution } from './chemical'
import { commLink } from './comms'
import { CO2_LIMIT, CO2_OFF_NOMINAL } from './lifeSupport'
import { activeFaults } from './failures'
import { BATTERY_WH, REACTOR_W, celsius, crewCondition, pio2MmHg, pressureKpa } from './habitat'
import { faceCo2, isBrakingOverdue, totalLoadW, type SimState } from './sim'

// The annunciator: a lamp for each fault, and the master alarm that calls the pilot to look at it. A new fault sets
// the master off; pressing it acknowledges every fault lit at that moment, and their cells stay lit while they last.

const CAREER_DOSE = 0.6 // Sv, NASA-STD-3001 V1 4030: the career limit for every astronaut
const BATTERY_LOW = 0.2 // of its charge: choice
const COMFORT_C = [18, 27] as const // NASA-STD-3001 Rev E V2 6012
const PIO2_CAUTION = 127 // mm Hg, NASA-STD-3001 Rev E table 6.2-1: mild hypoxia, the one-hour average
const PIO2_WARNING = 122 // the absolute floor
const PRESSURE_FLOOR = 34.5 // kPa, V2 6006

/** The battery is carrying what the reactor cannot. */
const isDischarging = (s: SimState): boolean =>
  totalLoadW(s) > (s.habitat.reactorOn ? REACTOR_W : 0)
const isOutsideComfort = ({ habitat: h }: SimState): boolean => celsius(h) < COMFORT_C[0] || celsius(h) > COMFORT_C[1] || pio2MmHg(h) < PIO2_CAUTION
const isHabitatDangerous = (s: SimState): boolean =>
  pio2MmHg(s.habitat) < PIO2_WARNING || pressureKpa(s.habitat) < PRESSURE_FLOOR || crewCondition(s.habitat, 0) !== 'норма'

interface Fault {
  readonly label: string
  readonly isWarning: boolean // red, with the klaxon; otherwise amber, with one tone
  readonly isLit: (s: SimState) => boolean
}

/** Two faults may share a cell: CO₂ cautions first, and warns again when it gets worse. */
const FAULTS: readonly Fault[] = [
  { label: 'РАДИАЦИЯ', isWarning: true, isLit: (s) => s.alarm }, // wired past the dosimeter breaker: no switch hides it
  { label: 'ДОЗА', isWarning: false, isLit: (s) => s.breakers.dosimeter && s.dose >= CAREER_DOSE },
  { label: 'CO₂', isWarning: false, isLit: (s) => faceCo2(s) > CO2_LIMIT },
  { label: 'CO₂', isWarning: true, isLit: (s) => faceCo2(s) >= CO2_OFF_NOMINAL },
  { label: 'ТОРМОЗИ', isWarning: false, isLit: (s) => s.breakers.nav && isBrakingOverdue(s) },
  { label: 'НЕТ СВЯЗИ', isWarning: false, isLit: (s) => s.breakers.comms && !commLink(s.course, s.ship).isUp },
  { label: 'НЕ ВЗВЕДЁН', isWarning: false, isLit: (s) => s.engineOn && !s.armed },
  // The habitat's, after the first six: a lens is the index of its cell, an acknowledged bit the index of its fault
  { label: 'ПИТАНИЕ', isWarning: false, isLit: (s) => isDischarging(s) || s.habitat.batteryWh < BATTERY_LOW * BATTERY_WH },
  { label: 'ПИТАНИЕ', isWarning: true, isLit: (s) => s.busTripped },
  { label: 'ЖИЗНЕОБЕСП.', isWarning: false, isLit: isOutsideComfort },
  { label: 'ЖИЗНЕОБЕСП.', isWarning: true, isLit: isHabitatDangerous },
  // an open fault, at once: before the readings it will move have strayed
  { label: 'ПИТАНИЕ', isWarning: false, isLit: (s) => activeFaults(s.habitat).includes('reactor') },
  { label: 'ЖИЗНЕОБЕСП.', isWarning: false, isLit: (s) => activeFaults(s.habitat).some((f) => f !== 'reactor') },
  // the chemical engine's, the ninth cell: little left, the thrusters dry without the crossfeed, or started with no feed
  { label: 'ТОПЛИВО', isWarning: false, isLit: (s) => isFuelCaution(s.propulsion) },
]

const CELL_LABELS: readonly string[] = [...new Set(FAULTS.map(({ label }) => label))]
const WARNINGS = FAULTS.reduce((bits, fault, i) => (fault.isWarning ? bits | (1 << i) : bits), 0)

/**
 * One bit per fault, in the order of FAULTS. The panel draws from the bus, so a cold one shows nothing; but a bus that
 * tripped itself leaves it on the battery, to say so.
 */
export const litFaults = (s: SimState): number =>
  s.busOn || s.busTripped ? FAULTS.reduce((bits, fault, i) => (fault.isLit(s) ? bits | (1 << i) : bits), 0) : 0

export type CellTone = 'off' | 'amber' | 'red'

export interface Cell {
  readonly label: string
  readonly tone: CellTone
}

export function annunciatorCells(s: SimState): readonly Cell[] {
  const lit = litFaults(s)
  return CELL_LABELS.map((label) => {
    const bits = FAULTS.reduce((cell, fault, i) => (fault.label === label ? cell | (1 << i) : cell), 0) & lit
    return { label, tone: bits & WARNINGS ? 'red' : bits ? 'amber' : 'off' }
  })
}

export type MasterAlarm = 'warning' | 'caution' | null

/** What the master alarm calls for: the worst fault the pilot has not acknowledged yet. */
export function masterAlarm(s: SimState): MasterAlarm {
  const unacknowledged = litFaults(s) & ~s.faultsAcked
  if (unacknowledged & WARNINGS) return 'warning'
  return unacknowledged ? 'caution' : null
}

/** A fault under this label is lit and not acknowledged yet. */
export const isCalling = (s: SimState, label: string): boolean =>
  FAULTS.some((fault, i) => fault.label === label && (litFaults(s) & ~s.faultsAcked & (1 << i)) !== 0)

/** Pressing the master alarm. */
export const acknowledge = (s: SimState): SimState => ({ ...s, faultsAcked: litFaults(s) })

/** Run every frame: a fault that clears is forgotten, so that it calls again if it comes back. */
export function settleAcknowledged(s: SimState): SimState {
  const faultsAcked = s.faultsAcked & litFaults(s)
  return faultsAcked === s.faultsAcked ? s : { ...s, faultsAcked }
}
