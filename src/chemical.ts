// The chemical engine for flight by a body, its propellant and valves, and the attitude thrusters' tank.
// The engine is the Apollo lunar module's descent engine (DPS): 10 500 lbf, throttled 10–60 % or run full, Isp 311 s
// (R: Wikipedia, «Descent propulsion system», after NASA's flight reports; to be checked against the Apollo 10 DPS
// evaluation). Aerozine 50 and nitrogen tetroxide fed by helium pressure. The ship's masses are choices.
import { G0 } from './physics'

export const ENGINE_FORCE = 46_700 // N at full thrust
export const ISP = 311 // s; ponytail: the same at every setting, though the DPS gave 285 s at 10 %
export const EXHAUST = ISP * G0 // m/s
export const DRY_MASS = 50_000 // kg: the ship with its crew and stores, its tanks empty (choice)
export const PROPELLANT = 50_000 // kg in the main tanks when full (choice)
export const RCS_PROPELLANT = 500 // kg in the attitude thrusters' tank (choice)
/** kg the attitude thrusters burn per degree they turn the ship, starting and stopping the turn: choice, ~3.6 kg a half turn. */
export const RCS_KG_PER_DEGREE = 0.02
const PRESSURE_TIME = 1 // s, the helium's time constant: ready in about three
const READY_PRESSURE = 0.95
const LOW_PROPELLANT = 0.1 // of full: the ТОПЛИВО caution

/** Where the lever can stand: off, 10–60 % in tens, or full; between 60 and 92.5 % the DPS wore its nozzle out. */
const NOTCHES: readonly number[] = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1]
const BAND_TOP = 0.6

export interface Propulsion {
  readonly propellant: number // kg in the main tanks
  readonly rcsPropellant: number // kg in the attitude thrusters' tank
  readonly pressurised: boolean // НАДДУВ: the helium valve
  readonly pressure: number // 0..1 of the working pressure
  readonly feedOpen: boolean // ПОДАЧА: the propellant valves to the engine
  readonly crossfeedOpen: boolean // ПЕРЕКРЁСТНАЯ ПОДАЧА: the main tanks to the attitude thrusters
  readonly engineOn: boolean // ДОСВЕТ ПУСК
  readonly throttle: number // the lever, one of NOTCHES
}

export const INITIAL_PROPULSION: Propulsion = {
  propellant: PROPELLANT, rcsPropellant: RCS_PROPELLANT, pressurised: false, pressure: 0, feedOpen: false,
  crossfeedOpen: false, engineOn: false, throttle: 0,
}

/** The lever moved one notch up or down. */
export function nextThrottle(value: number, step: 1 | -1): number {
  const here = NOTCHES.reduce((best, notch, i) => (Math.abs(notch - value) < Math.abs(NOTCHES[best] - value) ? i : best), 0)
  return NOTCHES[Math.min(NOTCHES.length - 1, Math.max(0, here + step))]
}

/** Where a lever let go at `value` comes to rest: off below 5 %, the nearer edge of the band it cannot stand in. */
export function settleThrottle(value: number): number {
  if (value < 0.05) return 0
  if (value < NOTCHES[1]) return NOTCHES[1]
  if (value <= BAND_TOP) return value
  return value - BAND_TOP < 1 - value ? BAND_TOP : 1
}

export const shipMass = (p: Propulsion): number => DRY_MASS + p.propellant + p.rcsPropellant

/** m/s the main tanks can still give: the rocket equation, v_e ln(m0 / m1). */
export const deltaV = (p: Propulsion): number => EXHAUST * Math.log(shipMass(p) / (shipMass(p) - p.propellant))

const isPressed = (p: Propulsion): boolean => p.pressure >= READY_PRESSURE

/** The engine fires: under pressure, fed, started, the lever open, the bus up, and the light mode not engaged. */
export const isBurning = (p: Propulsion, busOn: boolean, lightModeOn: boolean): boolean =>
  busOn && !lightModeOn && p.engineOn && p.feedOpen && isPressed(p) && p.throttle > 0 && p.propellant > 0

export const thrustOf = (p: Propulsion): number => ENGINE_FORCE * p.throttle
export const flowOf = (p: Propulsion): number => thrustOf(p) / EXHAUST

export function stepPressure(p: Propulsion, dt: number): Propulsion {
  const target = p.pressurised ? 1 : 0
  return { ...p, pressure: p.pressure + (target - p.pressure) * (1 - Math.exp(-dt / PRESSURE_TIME)) }
}

/**
 * `kg` of propellant for the attitude thrusters, from their tank; dry, from the main tanks through the crossfeed, which
 * feeds under pressure only. Null if neither has it: the ship cannot turn. As the lunar module's ascent tanks could feed
 * its thrusters (to be sourced).
 */
export function drawRcs(p: Propulsion, kg: number): Propulsion | null {
  if (p.rcsPropellant >= kg) return { ...p, rcsPropellant: p.rcsPropellant - kg }
  const short = kg - p.rcsPropellant
  if (p.crossfeedOpen && isPressed(p) && p.propellant >= short) return { ...p, rcsPropellant: 0, propellant: p.propellant - short }
  return null
}

/** ТОПЛИВО: a tenth of the propellant left, the thrusters dry with no crossfeed, or the engine started without feed. */
export const isFuelCaution = (p: Propulsion): boolean =>
  p.propellant < LOW_PROPELLANT * PROPELLANT
  || (p.rcsPropellant <= 0 && !p.crossfeedOpen)
  || (p.engineOn && p.throttle > 0 && (!p.feedOpen || !isPressed(p)))

/** At the target the tanks are found full: a convention, as if tankers had been sent ahead (README). */
export const refuelled = (p: Propulsion): Propulsion => ({ ...p, propellant: PROPELLANT, rcsPropellant: RCS_PROPELLANT })
