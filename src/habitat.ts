// The habitat: the electric bus with its reactor and battery, the heat of the cabin, its air (nitrogen and oxygen), and
// what they do to the crew. One volume and one temperature: the compartments are open to each other. Figures and their
// sources are in FORMULAS.md; R read in the source, V worked from it, choice marked as such.
import { HULL_AREA } from './cockpitLayout'
import { LETHAL_DOSE } from './physics'
import { CABIN_AIR } from './lifeSupport'

const GAS_CONSTANT = 8.314 // J/(mol K)
const O2_MOLAR = 0.031999 // kg/mol
const N2_MOLAR = 0.028013
const SIGMA = 5.670374e-8 // W/(m² K⁴)
const MMHG_PER_KPA = 7.50062
const DAY = 86_400

// Power
export const REACTOR_W = 3000 // choice within Kilopower's 1–10 kWe (KRUSTY, AIAA 2018-4973)
export const BATTERY_WH = 14_900 // R/V: one ISS battery unit, 30 Li-ion cells of 496 Wh (NTRS 20170003873)
export const BUS_LIMIT_W = 5000 // choice: above it the bus's breaker trips

// Heat
const MLI_EMISSIVITY = 0.03 // R: the effective emissivity Gateway's thermal model gives cabin insulation (ICES-2020-576)
const SKY_K = 3 // the cosmic background; ponytail: the Sun near the Earth and starlight are left out
const THERMAL_MASS = 1.47e6 // J/K: air 73 kJ/K (V) and 1.4 MJ/K of structure and kit, about 1.5 t of aluminium (choice)
export const HEATER_W = 2500 // each of two; choice, with room over the hull's ~2.2 kW when the main bus is off
const THERMOSTAT_BAND = 0.5 // K below the setpoint at which a heater runs flat out; choice
const CREW_HEAT_W = 139 // R: an awake crew member, 500 kJ/h (BVAD, NASA/TP-2015-218570/REV2, table 3-23)

// Air
const O2_USE = 0.84 / DAY // kg/s: R, BVAD
const O2_TARGET_KPA = 21.3 // the generator's setpoint: BVAD's nominal 21.2 kPa of oxygen
const O2_BAND_KPA = 0.5 // choice
const O2_MAKE_MAX = (2 * 0.84) / DAY // kg/s: choice, twice what one crew member breathes
const ELECTROLYSIS_J_PER_KG = 17.9e6 // V: ΔH = 285.8 kJ/mol of water, two mol of water to a mol of O₂
const ELECTROLYSIS_EFFICIENCY = 0.6 // choice
const VENT_AREA = Math.PI * 0.0015 ** 2 // m²: a 3 mm vent line; choice
const DISCHARGE = 0.6 // choice: no source for a hole's discharge coefficient
const AIR_GAS = 287 // J/(kg K)
const REPRESS_KG_S = 0.005 // choice
const REPRESS_STOP_KPA = 103 // NASA-STD-3001 Rev E V2 6006: the upper total pressure for indefinite exposure
const AIR_O2_SHARE = 0.232 // of air's mass
const TANK_KG = 100 // choice

// The crew
const COMFORT_LOW_C = 18 // R: NASA-STD-3001 Rev E V2 6012, the low end of the allowed zone
const BODY_CONDUCTANCE = 7 // W/K the clothed body loses below it: choice, about 1 clo over 1.8 m²
const COLD_IMPAIRED_J = 336_000 // R: V2 6014 allows 4.1 kJ/kg lost; for 82 kg
const COLD_DEATH_J = 2.58e6 // the core down to 28 °C, 287 kJ/K: from memory, not checked
const HYPOXIA_RECOVERY_S = 600 // choice
const HYPOXIA_DEATH = 3 // times the time of useful consciousness: choice

/** Time of useful consciousness (FAA AC 61-107B fig. 2-3) against the oxygen's partial pressure at those altitudes (V). */
const CONSCIOUSNESS: ReadonlyArray<readonly [number, number]> = [
  [10.6, 25 * 60], [9.0, 10 * 60], [7.9, 4 * 60], [6.9, 2.75 * 60], [6.3, 1.5 * 60], [5.0, 45], [3.9, 17.5], [3.4, 10.5],
]

export interface Habitat {
  readonly reactorOn: boolean
  readonly reactorScrammed: boolean // its protection threw it off: a fault, until it is started again
  readonly batteryWh: number
  readonly heater1On: boolean
  readonly heater1Failed: boolean // dead for the flight: its switch does nothing
  readonly heater2On: boolean
  readonly setpoint: number // °C
  readonly o2GenOn: boolean
  readonly ventOpen: boolean
  readonly ventStuck: boolean // stuck open for the flight: only the isolation valve closes its line
  readonly ventIsolated: boolean
  readonly repressOn: boolean
  readonly tankKg: number
  readonly kelvin: number
  readonly n2Kg: number
  readonly o2Kg: number
  readonly coldJ: number // heat the crew's body has lost beyond what it makes
  readonly hypoxia: number // how much of the time of useful consciousness is used up
}

export interface HabitatInputs {
  readonly busOn: boolean
  readonly baseLoadW: number // what the rest of the ship draws from the bus: screens, lights, fans, scrubber, radios
}

const START_KELVIN = 295.15
const START_MOLES = (101_325 * CABIN_AIR) / (GAS_CONSTANT * START_KELVIN)

export const INITIAL_HABITAT: Habitat = {
  reactorOn: true, reactorScrammed: false, batteryWh: BATTERY_WH, heater1On: true, heater1Failed: false, heater2On: false, setpoint: 22,
  o2GenOn: true, ventOpen: false, ventStuck: false, ventIsolated: false,
  repressOn: false, tankKg: TANK_KG, kelvin: START_KELVIN, n2Kg: 0.79 * START_MOLES * N2_MOLAR, o2Kg: 0.21 * START_MOLES * O2_MOLAR,
  coldJ: 0, hypoxia: 0,
}

const moles = (h: Habitat): number => h.n2Kg / N2_MOLAR + h.o2Kg / O2_MOLAR
export const pressureKpa = (h: Habitat): number => (moles(h) * GAS_CONSTANT * h.kelvin) / CABIN_AIR / 1000
export const ppO2Kpa = (h: Habitat): number => ((h.o2Kg / O2_MOLAR) * GAS_CONSTANT * h.kelvin) / CABIN_AIR / 1000
/** NASA-STD-3001 Rev E table 6.2-1: inspired O₂, the cabin's pressure less 47 mm of water vapour, times the O₂ share. */
export const pio2MmHg = (h: Habitat): number => (pressureKpa(h) * MMHG_PER_KPA - 47) * (ppO2Kpa(h) / pressureKpa(h))
export const celsius = (h: Habitat): number => h.kelvin - 273.15
export const heatLossW = (kelvin: number): number => MLI_EMISSIVITY * SIGMA * HULL_AREA * (kelvin ** 4 - SKY_K ** 4)

/** Seconds of useful consciousness at this oxygen pressure (kPa); Infinity above 18 000 ft's. Log-linear between points. */
export function usefulConsciousness(ppO2: number): number {
  if (ppO2 >= CONSCIOUSNESS[0][0]) return Infinity
  const below = CONSCIOUSNESS.findIndex(([p]) => p <= ppO2)
  if (below < 0) return CONSCIOUSNESS[CONSCIOUSNESS.length - 1][1]
  const [[p0, t0], [p1, t1]] = [CONSCIOUSNESS[below - 1], CONSCIOUSNESS[below]]
  return t0 * (t1 / t0) ** ((p0 - ppO2) / (p0 - p1))
}

export type CrewCondition = 'норма' | 'гипоксия' | 'переохлаждение' | 'погиб'

export function crewCondition(h: Habitat, dose: number): CrewCondition {
  if (dose >= LETHAL_DOSE || h.coldJ >= COLD_DEATH_J || h.hypoxia >= HYPOXIA_DEATH) return 'погиб'
  if (h.hypoxia >= 1) return 'гипоксия'
  if (h.coldJ >= COLD_IMPAIRED_J) return 'переохлаждение'
  return 'норма'
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
/** The heaters that warm: on, and not broken. */
export const heatersRunning = (h: Habitat): number => Number(h.heater1On && !h.heater1Failed) + Number(h.heater2On)
/** The vent line lets air out: the valve open and the line not isolated. */
export const isVenting = (h: Habitat): boolean => h.ventOpen && !h.ventIsolated
const heaterW = (h: Habitat): number =>
  heatersRunning(h) * HEATER_W * clamp01((h.setpoint - celsius(h)) / THERMOSTAT_BAND)
const o2Making = (h: Habitat): number => (h.o2GenOn ? O2_MAKE_MAX * clamp01((O2_TARGET_KPA - ppO2Kpa(h)) / O2_BAND_KPA) : 0)

/** W the habitat's own systems draw from the bus: the heaters and the oxygen generator. */
export const habitatDrawW = (h: Habitat): number => heaterW(h) + (o2Making(h) * ELECTROLYSIS_J_PER_KG) / ELECTROLYSIS_EFFICIENCY

const MAX_STEP = 300 // s: a tenth of the fastest change modelled, the thermostat's ~12 minutes

/** The air: the crew breathes, the generator makes oxygen with the share of its power it gets, the vent leaks by choked flow,
 * the tank represses. */
function stepAir(h: Habitat, powerShare: number, dt: number): Habitat {
  const made = o2Making(h) * powerShare * dt
  const total = h.n2Kg + h.o2Kg
  const vented = isVenting(h) ? Math.min(total, (DISCHARGE * 0.685 * VENT_AREA * pressureKpa(h) * 1000 * dt) / Math.sqrt(AIR_GAS * h.kelvin)) : 0
  const p = pressureKpa(h)
  const short = p > 0 ? Math.max(0, (total * (REPRESS_STOP_KPA - p)) / p) : Infinity // kg the cabin lacks to the stop
  const refill = h.repressOn ? Math.min(h.tankKg, REPRESS_KG_S * dt, short) : 0
  const share = total > 0 ? h.o2Kg / total : 0
  return {
    ...h,
    o2Kg: Math.max(0, h.o2Kg - O2_USE * dt + made - vented * share + refill * AIR_O2_SHARE),
    n2Kg: Math.max(0, h.n2Kg - vented * (1 - share) + refill * (1 - AIR_O2_SHARE)),
    tankKg: h.tankKg - refill,
  }
}

/** The crew's body: cold air takes its heat, thin air uses up its time of useful consciousness; both come back. */
function stepCrew(h: Habitat, dt: number): Habitat {
  const chill = BODY_CONDUCTANCE * (COMFORT_LOW_C - celsius(h)) * dt
  const time = usefulConsciousness(ppO2Kpa(h))
  return {
    ...h,
    coldJ: Math.max(0, h.coldJ + chill),
    hypoxia: Number.isFinite(time) ? h.hypoxia + dt / time : Math.max(0, h.hypoxia - dt / HYPOXIA_RECOVERY_S),
  }
}

/** The life-support bus, for the heaters and the oxygen generator: wired straight to the reactor and the battery, past the
 * main bus's switch, so that a cold start or a tripped main bus leaves the crew warm and breathing. */
export const isLifeBusLive = (h: Habitat): boolean => h.reactorOn || h.batteryWh > 0

/** W drawn from the reactor and the battery: the main bus's loads, if it is on, and the life support's. */
export const busLoadW = (h: Habitat, inputs: HabitatInputs): number =>
  (inputs.busOn ? inputs.baseLoadW : 0) + (isLifeBusLive(h) ? habitatDrawW(h) : 0)

/** One step of at most MAX_STEP: power first, as it says what the heaters and the generator may have. */
function substep(h: Habitat, inputs: HabitatInputs, dt: number): { readonly habitat: Habitat; readonly tripped: boolean } {
  const mainW = inputs.busOn ? inputs.baseLoadW : 0
  const wantedW = isLifeBusLive(h) ? habitatDrawW(h) : 0
  if (mainW > 0 && mainW + wantedW > BUS_LIMIT_W) return { habitat: h, tripped: true } // the main bus sheds its load first
  const sourceW = h.reactorOn ? REACTOR_W : 0
  if (mainW > 0 && h.batteryWh <= 0 && mainW + wantedW > sourceW) return { habitat: h, tripped: true }
  // ponytail: a flat battery and too little reactor share what there is out evenly between the heaters and the generator
  const lifeShare = wantedW > 0 ? Math.min(1, (sourceW - mainW + (h.batteryWh * 3600) / dt) / wantedW) : 0
  const lifeW = wantedW * Math.max(0, lifeShare)
  const netW = sourceW - mainW - lifeW
  const batteryWh = Math.min(BATTERY_WH, Math.max(0, h.batteryWh + (netW * dt) / 3600))
  const powerShare = wantedW > 0 ? lifeW / wantedW : 0
  const stored = o2Making(h) * powerShare * ELECTROLYSIS_J_PER_KG // the share of the generator's power kept in its oxygen
  const heatW = CREW_HEAT_W + mainW + lifeW - stored - heatLossW(h.kelvin)
  const warmed = { ...h, batteryWh, kelvin: h.kelvin + (heatW * dt) / THERMAL_MASS }
  return { habitat: stepCrew(stepAir(warmed, powerShare, dt), dt), tripped: false }
}

/**
 * `dt` ship seconds of the habitat, in steps short enough to follow its fastest change. If the bus trips on the way the
 * rest of the time runs unpowered, and `tripped` says so: the caller throws the bus's switch.
 */
export function stepHabitat(h: Habitat, inputs: HabitatInputs, dt: number): { readonly habitat: Habitat; readonly tripped: boolean } {
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP))
  let at = h
  for (let i = 0; i < steps; i++) {
    const next = substep(at, inputs, dt / steps)
    if (next.tripped) {
      const rest = stepHabitat(next.habitat, { ...inputs, busOn: false }, (dt / steps) * (steps - i))
      return { habitat: rest.habitat, tripped: true }
    }
    at = next.habitat
  }
  return { habitat: at, tripped: false }
}
