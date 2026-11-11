import { CABIN_VOLUME } from './cockpitLayout'
import { DAY } from './solarSystem'

// The cabin air, as far as carbon dioxide goes. Figures from NASA's CO₂ technical brief, OCHMO-TB-004 Rev D; see
// FORMULAS.md for which are taken from it and which are choices.

const CO2_PER_DAY = 0.91 // kg one crew member breathes out in a day without exercise
const CO2_MOLAR_MASS = 0.04401 // kg/mol
const GAS_CONSTANT = 8.314 // J/(mol K)
const CABIN_TEMPERATURE = 295 // K
const PASCALS_PER_MMHG = 133.322
// of the cabin left to air: the boxes of the seat, consoles, desk, bed and cabinets add up to about 4.8 m³ of the 65.7;
// an estimate, not measured on the model
const FREE_AIR = 0.93

/** m³ of air aboard: the hull from the aft wall to the panel, as the model has it, less the furniture. */
export const CABIN_AIR = CABIN_VOLUME * FREE_AIR

/** mm Hg per ship second: the pilot's breath spread through the cabin, as an ideal gas. */
const CO2_RISE = ((CO2_PER_DAY / CO2_MOLAR_MASS) * GAS_CONSTANT * CABIN_TEMPERATURE) / CABIN_AIR / PASCALS_PER_MMHG / DAY

/** mm Hg the scrubber holds; a choice inside the 2.3–5.3 typical of spacecraft. */
export const CO2_SCRUBBED = 2.5
/** NASA-STD-3001 V2 6004: the one-hour average in the cabin. Above it, the annunciator cautions. */
export const CO2_LIMIT = 3
/** The ISS off-nominal level: headache and breathlessness on exertion. Above it, the annunciator warns. */
export const CO2_OFF_NOMINAL = 15

/** The scrubber takes out a fixed share of the air it draws each second, so it holds the level where that equals the breath. */
const SCRUB_TIME = CO2_SCRUBBED / CO2_RISE // s

/** Solved exactly over the step, so that a frame that spans a ship year at cruise lands on the right value. */
export function stepCo2(co2: number, isScrubbing: boolean, dtShip: number): number {
  if (!isScrubbing) return co2 + CO2_RISE * dtShip
  return CO2_SCRUBBED + (co2 - CO2_SCRUBBED) * Math.exp(-dtShip / SCRUB_TIME)
}

/**
 * Weightless and with the fans off, nothing carries the breath away, and it gathers round the face.
 * ponytail: a fixed excess, a choice below the 30 mm Hg of breath itself; NASA notes such pockets but gives no size.
 */
const STILL_AIR_EXCESS = 10 // mm Hg

export const co2AtFace = (cabin: number, isStirred: boolean): number => cabin + (isStirred ? 0 : STILL_AIR_EXCESS)

/** Ship seconds per real second at most while the air is left to itself: the pilot has to stay awake for it. A choice. */
export const UNTENDED_AIR_WARP = 300
