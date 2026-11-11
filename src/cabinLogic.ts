import { CANOPY_CROWN, CANOPY_SILL_LOW } from './cockpitLayout'
import { properAcceleration, type SimState } from './sim'

// The small rules that make the cabin feel alive, kept apart from the rendering so that they can be tested.

const WAKE_WINDOW = 0.12 // of the power ramp: how long a surface flickers before it holds steady
const FLICKER_RATE = 37 // Hz
const FLICKER_DIM = 0.12

const smoothstep = (low: number, high: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)))
  return t * t * (3 - 2 * t)
}

/** Brightness of a surface that comes on when the power reaches `delay` (both 0..1). */
export function wakeLevel(power: number, delay: number, seconds: number): number {
  const progress = (power - delay) / WAKE_WINDOW
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  const strike = Math.sin(seconds * FLICKER_RATE) + Math.sin(seconds * FLICKER_RATE * 2.7)
  return progress * (strike > 0 ? 1 : FLICKER_DIM)
}

/** Angle of a clock hand, clockwise from twelve as seen from the front. */
export const handAngle = (years: number, yearsPerTurn: number): number =>
  -2 * Math.PI * ((years / yearsPerTurn) % 1)

/** How far a hand has dissolved into a blur, from how much of a turn it makes per frame. */
export const handBlur = (turnsPerFrame: number): number => smoothstep(0.08, 0.3, turnsPerFrame)

const GEIGER_BACKGROUND = 0.7 // clicks/s; cosmic rays get through everything. Chosen to be heard, not measured.
const GEIGER_PER_DECADE = 28 // clicks/s for every factor of ten in dose rate, as on a logarithmic counter
const GEIGER_ONE_CLICK_DOSE = 1e-6 // Sv per ship second
const GEIGER_MAX = 400

/** Clicks per real second. Rate is compressed as on a logarithmic scale: the hull and the shield both stop it. */
export function geigerRate(doseRatePerSecond: number, isShielded: boolean): number {
  if (isShielded || doseRatePerSecond <= 0) return GEIGER_BACKGROUND
  return Math.min(GEIGER_MAX, GEIGER_BACKGROUND + GEIGER_PER_DECADE * Math.log10(1 + doseRatePerSecond / GEIGER_ONE_CLICK_DOSE))
}

/** A Poisson-distributed count for a small mean (Knuth). */
export function poissonCount(mean: number, random: () => number): number {
  const limit = Math.exp(-mean)
  let count = 0
  let product = random()
  while (product > limit) {
    count++
    product *= random()
  }
  return count
}

export type LampTone = 'off' | 'amber' | 'green' | 'red' | 'cyan'

export interface StatusLamp {
  readonly label: string
  readonly tone: LampTone
}

const READY = 0.95

const STATUS_LABELS = ['ПИТАНИЕ', 'ВЗВЕДЕНО', 'ДВИГАТЕЛЬ', 'ТЯГА', 'ЩИТ', 'СВЕТ'] as const

/** The row of lamps that report what the ship is actually doing. They are lamps too, and dark without the bus. */
export function statusLamps(s: SimState): readonly StatusLamp[] {
  if (!s.busOn) return STATUS_LABELS.map((label) => ({ label, tone: 'off' }))
  const thrust = properAcceleration(s)
  const spooling = (level: number): LampTone => (level >= READY ? 'green' : 'amber')
  const tones: readonly LampTone[] = [
    spooling(s.power),
    s.armed ? 'amber' : 'off',
    s.engineOn ? spooling(s.spool) : 'off', // amber while it spools, or while the switch is on and the engine cannot run
    thrust > 0 ? 'green' : thrust < 0 ? 'amber' : 'off',
    s.shieldOn ? 'cyan' : 'off',
    s.cabinLightsOn ? 'amber' : 'off',
  ]
  return STATUS_LABELS.map((label, i) => ({ label, tone: tones[i] }))
}

export type StartStep = 'bus' | 'light' | 'arm' | 'engine'

/** The next switch of the main engine's cold start, which blinks to say so; none once the engine has been started. */
export function nextStartStep(s: SimState): StartStep | null {
  if (!s.busOn) return 'bus'
  if (!s.lightModeOn) return 'light'
  if (!s.armed) return 'arm'
  return s.engineOn ? null : 'engine'
}

const SHIELD_START = CANOPY_SILL_LOW - 0.01 // m: open, the shields' top edge is down in the sills
const SHIELD_END = CANOPY_CROWN + 0.02 // m: closed, they have met over the crown
/** Height in metres, from the eye, that the blast shields have risen to inside the glass (0 open .. 1 closed). */
export const shieldHeight = (closure: number): number => SHIELD_START + (SHIELD_END - SHIELD_START) * closure
/** Straight ahead is at eye level, so the shields cover it once they have risen that far. */
export const SHIELD_REACHES_COURSE = -SHIELD_START / (SHIELD_END - SHIELD_START)
const COURSE_MARGIN = 0.04 // of the shields' travel: the disc has a size, so the edge takes a moment to cover it

/** How much of the light from straight ahead still comes in, as the shutters close (0 open, 1 closed). */
export const courseOpenness = (closure: number): number =>
  1 - smoothstep(SHIELD_REACHES_COURSE - COURSE_MARGIN, SHIELD_REACHES_COURSE + COURSE_MARGIN, closure)

const FILTER_DECADES = 3

/**
 * Transmission of the tinted glass: a thousandth. The eye does not get used to it while it is on (App.tsx), so it
 * keeps the glare round the Sun or the blueshifted disc away, darkens the sky past its stars, and leaves the discs.
 */
export const filterTransmission = (tint: number): number => 10 ** (-FILTER_DECADES * tint)

/**
 * The lamps along the thrust track, from the back stop to the forward one, the middle one at the detent: lit from the
 * detent to the setting, so the row reads as a bar of thrust ahead or of braking behind.
 */
export const throttleMarks = (throttle: number, count: number): readonly boolean[] =>
  Array.from({ length: count }, (_, i) => {
    const at = -1 + (2 * i) / (count - 1)
    return at * throttle >= 0 && Math.abs(at) <= Math.abs(throttle) + 1e-9
  })
