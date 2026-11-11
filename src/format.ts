import { LAUNCH_JD } from './solarSystem'

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '-': '⁻', '+': '', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
}

/** 2.34·10¹⁵ */
export function sci(value: number, digits = 2): string {
  if (value === 0) return '0'
  const [mantissa, exponent] = value.toExponential(digits).split('e')
  return `${mantissa}·10${[...exponent].map((c) => SUPERSCRIPT[c]).join('')}`
}

/** A value in ordinary notation while it is readable, in scientific notation otherwise. */
export function auto(value: number, digits = 2): string {
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-2)) return sci(value, digits)
  return value.toFixed(digits)
}

/** Capitals for a panel legend; Greek letters stay small, since a capital α is just A. */
export const legend = (name: string): string => name.replace(/[а-яё]/g, (c) => c.toUpperCase())

const AU_M = 1.495978707e11
const LY_M = 299_792_458 * 31_557_600

/** A distance in the unit a pilot would use for it: km near a planet, AU in a planetary system, light years beyond. */
export function distanceText(metres: number): string {
  const m = Math.abs(metres)
  if (m < 0.1 * AU_M) return `${Math.round(m / 1000).toLocaleString('ru-RU')} км`
  if (m < 0.05 * LY_M) return `${(m / AU_M).toFixed(m < 10 * AU_M ? 2 : 0)} а. е.`
  return `${(m / LY_M).toFixed(m < 1000 * LY_M ? 2 : 0)} св. г`
}

const WARP_UNITS: ReadonlyArray<readonly [number, string]> = [
  [31_557_600, 'г'], [2_629_800, 'мес.'], [86_400, 'сут'], [3_600, 'ч'], [60, 'мин'], [1, 'с'],
]

/** Why the clock runs slower than the pilot set it (ClockHold in sim.ts), for the time screen and the status line. */
export const CLOCK_HOLD_TEXT = {
  brake: 'ВПЕРЕДИ ТОРМОЖЕНИЕ', arrival: 'ПРИБЫТИЕ', air: 'ЖИЗНЕОБЕСПЕЧЕНИЕ БЕЗ ПРИСМОТРА', fault: 'ОТКАЗ НА БОРТУ',
  burn: 'ИДЁТ ИМПУЛЬС', orbit: 'ВИТОК ОРБИТЫ', impact: 'ВПЕРЕДИ УДАР',
} as const

/** What the event timer counts to, or for a burn how long it has run (eventTimer in sim.ts). */
export const TIMER_TEXT = { impact: 'ДО УДАРА', burn: 'ИМПУЛЬС', brake: 'ДО ТОРМОЖЕНИЯ', periapsis: 'ДО ПЕРИЦЕНТРА' } as const

/** The event timer's reading: "04:12:30", with days in front past a day, and in the units of durationText past 100 days. */
export function timerText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s >= 100 * 86_400) return durationText(s)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const clock = `${pad(Math.floor((s % 86_400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  return s >= 86_400 ? `${Math.floor(s / 86_400)} сут ${clock}` : clock
}

/** Ship seconds per real second, as "1 с = 3 сут". */
export function warpText(warp: number): string {
  const [size, unit] = WARP_UNITS.find(([seconds]) => warp >= seconds) ?? WARP_UNITS[WARP_UNITS.length - 1]
  const value = warp / size
  return `1 с = ${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`
}

const DURATION_UNITS: ReadonlyArray<readonly [number, string]> = [
  [31_557_600, 'г'], [86_400, 'сут'], [3_600, 'ч'], [60, 'мин'], [1, 'с'],
]

/** A span of time in the unit that keeps it short: "0.08 с", "12.5 мин", "4.37 г". */
export function durationText(seconds: number): string {
  const span = Math.abs(seconds)
  const [size, unit] = DURATION_UNITS.find(([unitSeconds]) => span >= unitSeconds) ?? DURATION_UNITS[DURATION_UNITS.length - 1]
  const value = span / size
  return `${value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0)} ${unit}`
}

const UNIX_EPOCH_JD = 2_440_587.5
const LAUNCH_MS = (LAUNCH_JD - UNIX_EPOCH_JD) * 86_400_000

/** The Earth's calendar `seconds` after launch, dd.mm.yyyy; past the reach of the calendar, the year alone. */
export function earthDate(seconds: number): string {
  const date = new Date(LAUNCH_MS + Math.max(0, seconds) * 1000)
  if (Number.isNaN(date.getTime())) return `${Math.floor(2027 + seconds / 31_557_600)} год`
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`
}

/** The Earth's calendar and clock `seconds` after launch, dd.mm.yyyy hh:mm UTC; past the calendar, the year alone. */
export function earthDateTime(seconds: number): string {
  const date = new Date(LAUNCH_MS + Math.max(0, seconds) * 1000)
  if (Number.isNaN(date.getTime())) return earthDate(seconds)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${earthDate(seconds)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

/** Speed as a percentage of c, truncated rather than rounded so it never reads 100 %. */
export function speedPercent(oneMinusBeta: number): string {
  const tenThousandths = Math.floor((1 - oneMinusBeta) * 1e6 + 1e-6)
  return (Math.min(tenThousandths, 999_999) / 1e4).toFixed(4)
}

/** Ship time as days of the flight and the time of day: "412 сут 06:15". */
export function shipClock(tau: number): string {
  const days = Math.floor(tau / 86_400)
  const minutes = Math.floor((tau - days * 86_400) / 60)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${days} сут ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}
