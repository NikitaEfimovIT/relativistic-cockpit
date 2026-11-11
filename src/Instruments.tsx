import { useMemo, useRef, type ComponentProps } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { wakeLevel } from './cabinLogic'
import { MESSAGES, commLink, messagesDue } from './comms'
import { CLOCK_HOLD_TEXT, TIMER_TEXT, auto, distanceText, durationText, earthDate, legend, sci, speedPercent, timerText, warpText } from './format'
import {
  G0, LETHAL_DOSE, LY, PHI_MAX, T_CMB, YEAR,
  doseRate, energyFlux, fieldIntegral, gammaOf, oneMinusBeta, protonEnergyGeV, protonFlux, rearCameraGain, skyFractionAstern,
} from './physics'
import { CO2_LIMIT, CO2_OFF_NOMINAL } from './lifeSupport'
import { PROPELLANT, deltaV } from './chemical'
import { legendIn, useLang } from './labels'
import { closestApproach, orbitOf, type Local } from './flight'
import { clockHold, clockSetting, currentWarp, eventTimer, faceCo2, properAcceleration, sim, type Breaker, type SimState } from './sim'
import { TARGETS, distanceTo, isAtRest, navigate } from './voyage'

export const FONT = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
export const PIXELS_PER_METRE = 1500
export const REFRESH_HZ = 8
/** Emission of a screen in the HDR frame: above 1 so that the final tone curve leaves it legible and it can glare. */
export const SCREEN_GLOW = new THREE.Color(2.4, 2.4, 2.4)

const NIGHT_DIMMING = 0.78 // how far the dimmer on the overhead block takes the cabin's own lights down

/** Whether a system's breaker is in. */
export const fedBy = (breaker: Breaker) => (s: SimState): boolean => s.breakers[breaker]

/** How lit a surface that comes on at `delay` in the start-up sequence is, this frame; dark if its breaker is out. */
export function useWake(delay: number, isFed?: (s: SimState) => boolean): THREE.IUniform<number> {
  const gain = useMemo(() => ({ value: 0 }), [])
  useFrame(({ clock }) => {
    const s = sim.get()
    gain.value = isFed && !isFed(s) ? 0 : wakeLevel(s.power, delay, clock.elapsedTime) * (1 - NIGHT_DIMMING * s.dim)
  })
  return gain
}

export const AMBER = '#ffb347'
export const GREEN = '#7dffa8'
export const CYAN = '#7fdcff'
export const RED = '#ff5a4a'
export const DIM = 'rgba(190, 215, 225, 0.55)'

export interface Row {
  readonly label: string
  readonly value: string
  readonly tone?: string
}

export function newCanvas(width: number, height: number): readonly [CanvasRenderingContext2D, THREE.CanvasTexture] {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable, so the instruments cannot be drawn')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return [context, texture]
}

export function paintBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = '#020302'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.007)'
  for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 2)
}

/** A title over rows of label and value; `textScale` enlarges the letters where a screen is read from further off. */
export function paintRows(
  ctx: CanvasRenderingContext2D, width: number, height: number, title: string, rows: readonly Row[], accent: string, textScale = 1,
): void {
  paintBackground(ctx, width, height)
  const pad = width * 0.035
  const titleSize = height * 0.062 * textScale
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `600 ${titleSize}px ${FONT}`
  ctx.fillStyle = accent
  ctx.fillText(title, pad, height * 0.075)
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.35
  ctx.fillRect(pad, height * 0.135, width - 2 * pad, 2)
  ctx.globalAlpha = 1
  const rowHeight = (height * 0.85) / rows.length
  rows.forEach((row, i) => {
    const y = height * 0.15 + rowHeight * (i + 0.5)
    ctx.textAlign = 'left'
    ctx.font = `500 ${height * 0.056 * textScale}px ${FONT}`
    ctx.fillStyle = DIM
    ctx.fillText(row.label, pad, y)
    ctx.textAlign = 'right'
    ctx.font = `600 ${height * 0.078 * textScale}px ${FONT}`
    ctx.fillStyle = row.tone ?? accent
    ctx.fillText(row.value, width - pad, y)
  })
}

export type Painter = (ctx: CanvasRenderingContext2D, width: number, height: number, s: SimState) => void

type ScreenProps = ComponentProps<'group'> & {
  readonly width: number
  readonly height: number
  readonly paint: Painter
  readonly hasBezel?: boolean
  readonly delay?: number // when it comes on in the start-up sequence, 0..1
  readonly isFed?: (s: SimState) => boolean // its breaker
}

export function Screen({ width, height, paint, hasBezel = true, delay = 0, isFed, ...props }: ScreenProps) {
  const pixelWidth = Math.round(width * PIXELS_PER_METRE)
  const pixelHeight = Math.round(height * PIXELS_PER_METRE)
  const [ctx, texture] = useMemo(() => newCanvas(pixelWidth, pixelHeight), [pixelWidth, pixelHeight])
  const lastPaint = useRef(-1)
  const surface = useRef<THREE.Mesh>(null)
  const emission = useRef<THREE.MeshBasicMaterial>(null!)
  const gain = useWake(delay, isFed)
  useFrame(() => {
    emission.current.color.copy(SCREEN_GLOW).multiplyScalar(gain.value)
  })
  useFrame(({ clock }) => {
    if (clock.elapsedTime - lastPaint.current < 1 / REFRESH_HZ) return
    lastPaint.current = clock.elapsedTime
    paint(ctx, pixelWidth, pixelHeight, sim.get())
    texture.needsUpdate = true
  })
  return (
    <group {...props}>
      {hasBezel && (
        <mesh position={[0, 0, -0.006]}>
          <boxGeometry args={[width + 0.022, height + 0.022, 0.012]} />
          <meshStandardMaterial color="#0b0d10" roughness={0.5} metalness={0.5} />
        </mesh>
      )}
      <mesh ref={surface} position={[0, 0, 0.001]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial ref={emission} map={texture} color={SCREEN_GLOW} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** By a body the screen shows the orbit: where the ship is on it, the propellant left, and how near the target it comes. */
function paintOrbit(ctx: CanvasRenderingContext2D, width: number, height: number, s: SimState, local: Local): void {
  const orbit = orbitOf(local)
  const target = TARGETS[s.course.target]
  const approach = closestApproach(local, target.position)
  const p = s.propulsion
  const fuel = `${Math.round((100 * p.propellant) / PROPELLANT)} % · ${Math.round(deltaV(p))} м/с`
  const near = { label: 'СБЛИЖЕНИЕ', value: `${distanceText(approach.distance)} ЧЕРЕЗ ${durationText(approach.time)}` }
  if (!orbit) {
    paintRows(ctx, width, height, `ДРЕЙФ → ${legend(target.name)}`, [
      { label: 'ТЕЛО', value: 'НЕТ ПРИТЯЖЕНИЯ' }, { label: 'ТОПЛИВО', value: fuel }, near,
    ], AMBER)
    return
  }
  const { globe, elements } = orbit
  const floor = globe.radiusM + globe.ceiling
  paintRows(ctx, width, height, `ОРБИТА → ${legend(target.name)}`, [
    { label: 'ТЕЛО', value: legend(globe.name) },
    { label: 'ВЫСОТА', value: distanceText(orbit.altitude) },
    { label: 'СКОРОСТЬ ОТН. ТЕЛА', value: `${(orbit.speed / 1000).toFixed(3)} км/с` },
    {
      label: 'ПЕРИЦЕНТР',
      value: elements.periapsis < globe.radiusM ? 'ВНУТРИ ТЕЛА' : distanceText(elements.periapsis - globe.radiusM),
      tone: elements.periapsis < floor ? RED : undefined,
    },
    { label: 'АПОЦЕНТР', value: Number.isFinite(elements.apoapsis) ? distanceText(elements.apoapsis - globe.radiusM) : 'УХОД' },
    { label: 'ПЕРИОД', value: Number.isFinite(elements.period) ? durationText(elements.period) : '—' },
    { label: 'ТОПЛИВО', value: fuel, tone: p.propellant < 0.1 * PROPELLANT ? AMBER : undefined },
    near,
  ], AMBER)
}

const paintNav: Painter = (ctx, width, height, s) => {
  if (s.local) {
    paintOrbit(ctx, width, height, s, s.local)
    return
  }
  const phi = s.ship.phi
  const eps = oneMinusBeta(phi)
  const gamma = gammaOf(phi)
  const isAtLimit = phi >= PHI_MAX
  const nav = navigate(s.course, s.ship)
  const isLate = nav.cue === 'brake' || nav.cue === 'passed'
  paintRows(ctx, width, height, `НАВИГАЦИЯ → ${legend(nav.name)}`, [
    { label: 'СКОРОСТЬ', value: `${speedPercent(eps)} % c`, tone: isAtLimit ? GREEN : undefined },
    { label: '1 − β', value: sci(eps) },
    { label: 'γ', value: gamma < 100 ? gamma.toFixed(3) : gamma.toFixed(1) },
    { label: 'СОБСТВ. УСКОРЕНИЕ', value: `${(properAcceleration(s) / G0).toFixed(2)} g` },
    { label: 'ДОПЛЕР НОС / КОРМА', value: `×${auto(Math.exp(phi))} / ×${auto(Math.exp(-phi), 3)}` },
    { label: 'РЕЛИКТОВОЕ, КУРС', value: `${auto(T_CMB * Math.exp(phi), T_CMB * Math.exp(phi) < 100 ? 2 : 0)} K` },
    { label: 'ДО ЦЕЛИ', value: distanceText(nav.distance), tone: nav.cue === 'arrived' ? GREEN : undefined },
    { label: 'ТОРМОЗНОЙ ПУТЬ, 1 g', value: distanceText(nav.braking), tone: isLate ? RED : undefined },
  ], AMBER)
}

const paintRadiation: Painter = (ctx, width, height, s) => {
  const phi = s.ship.phi
  const isLethal = s.dose >= LETHAL_DOSE
  paintRows(ctx, width, height, s.shieldOn ? 'ЩИТ ВКЛЮЧЁН' : 'ЩИТ ВЫКЛЮЧЕН', [
    { label: 'ПОТОК H, м⁻²с⁻¹', value: sci(protonFlux(phi)) },
    { label: 'ЭНЕРГИЯ ПРОТОНА', value: `${auto(protonEnergyGeV(phi), 3)} ГэВ` },
    { label: 'МОЩНОСТЬ, Вт/м²', value: sci(energyFlux(phi)) },
    { label: 'ТРЕБ. ПОЛЕ Bρ', value: `${auto(fieldIntegral(phi), 3)} Т·м` },
    { label: 'ДОЗА БЕЗ ЩИТА', value: `${auto(doseRate(phi), 1)} Зв/с`, tone: doseRate(phi) > 0 && !s.shieldOn ? RED : undefined },
    { label: 'ДОЗА ЭКИПАЖА', value: `${auto(s.dose, 1)} Зв`, tone: isLethal ? RED : undefined },
    isLethal
      ? { label: 'ЭКИПАЖ ПОГИБ', value: 'R — НОВЫЙ ПОЛЁТ', tone: RED }
      : { label: 'ЭКИПАЖ', value: 'В НОРМЕ', tone: GREEN },
  ], s.shieldOn ? CYAN : RED)
}

const paintTime: Painter = (ctx, width, height, s) => {
  paintBackground(ctx, width, height)
  const cells: readonly Row[] = [
    { label: 'БОРТОВОЕ ВРЕМЯ τ', value: `${auto(s.ship.tau / YEAR)} лет` },
    { label: 'ВРЕМЯ ГАЛАКТИКИ t', value: `${auto(s.ship.t / YEAR)} лет` },
    { label: 'ПУТЬ В ГАЛАКТИКЕ x', value: `${auto(s.ship.x / LY)} св. лет` },
    { label: 'СОКРАЩЕНИЕ ДЛИНЫ 1/γ', value: auto(1 / gammaOf(s.ship.phi), 4) },
  ]
  const cellWidth = width / 2
  const cellHeight = height * 0.42
  cells.forEach((cell, i) => {
    const x = (i % 2) * cellWidth + width * 0.03
    const y = Math.floor(i / 2) * cellHeight + height * 0.06
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `500 ${height * 0.105}px ${FONT}`
    ctx.fillStyle = DIM
    ctx.fillText(cell.label, x, y)
    ctx.font = `600 ${height * 0.17}px ${FONT}`
    ctx.fillStyle = GREEN
    ctx.fillText(cell.value, x, y + height * 0.14)
  })
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.font = `500 ${height * 0.09}px ${FONT}`
  const hold = clockHold(s)
  ctx.fillStyle = hold ? AMBER : DIM
  const held = hold ? ` · ЧАСЫ СНИЖЕНЫ: ${CLOCK_HOLD_TEXT[hold]}, задано ${warpText(clockSetting(s))}` : ''
  ctx.fillText(`${warpText(currentWarp(s))} на борту${held}`, width - width * 0.03, height * 0.985, width * 0.94) // squeezed, not cut, when long
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return text.split(' ').reduce<string[]>((lines, word) => {
    const last = lines[lines.length - 1]
    const joined = last === undefined ? word : `${last} ${word}`
    return last !== undefined && ctx.measureText(joined).width > maxWidth
      ? [...lines, word]
      : [...lines.slice(0, -1), joined]
  }, [])
}

const marginText = (dB: number): string => (dB > 99 ? '> +99 дБ' : `${dB >= 0 ? '+' : '−'}${Math.abs(dB).toFixed(0)} дБ`)
const MESSAGE_LINES = 4

// The radio: how old the Earth that is heard is, how fast it plays out here, and the last thing it said.
const paintComms: Painter = (ctx, width, height, s) => {
  const link = commLink(s.course, s.ship)
  const accent = link.isUp ? GREEN : RED
  paintBackground(ctx, width, height)
  const pad = width * 0.04
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${height * 0.068}px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillStyle = CYAN
  ctx.fillText('СВЯЗЬ С ЗЕМЛЁЙ', pad, height * 0.07)
  ctx.textAlign = 'right'
  ctx.fillStyle = accent
  ctx.fillText(link.isUp ? '● ПРИЁМ' : 'СВЯЗЬ ПОТЕРЯНА', width - pad, height * 0.07)
  ctx.globalAlpha = 0.35
  ctx.fillStyle = CYAN
  ctx.fillRect(pad, height * 0.125, width - 2 * pad, 2)
  ctx.fillRect(pad, height * 0.575, width - 2 * pad, 2)
  ctx.globalAlpha = 1

  const rows: readonly Row[] = [
    { label: 'ЗАДЕРЖКА СИГНАЛА', value: durationText(link.delay) },
    { label: 'ЗЕМЛЯ, КАКОЙ ВИДНА', value: earthDate(link.earthSeen) },
    { label: 'ЗЕМЛЯ СЕЙЧАС', value: earthDate(link.earthNow) },
    { label: 'ТЕМП ЗЕМНЫХ ЧАСОВ', value: `×${auto(link.rate, 3)}` },
    { label: 'СИГНАЛ', value: marginText(link.margin), tone: accent },
  ]
  rows.forEach((row, i) => {
    const y = height * (0.17 + 0.083 * i)
    ctx.textAlign = 'left'
    ctx.font = `500 ${height * 0.052}px ${FONT}`
    ctx.fillStyle = DIM
    ctx.fillText(row.label, pad, y)
    ctx.textAlign = 'right'
    ctx.font = `600 ${height * 0.062}px ${FONT}`
    ctx.fillStyle = row.tone ?? CYAN
    ctx.fillText(row.value, width - pad, y)
  })

  const inFlight = Math.max(0, messagesDue(link.earthNow) - s.messagesHeard)
  ctx.textAlign = 'left'
  ctx.font = `500 ${height * 0.05}px ${FONT}`
  ctx.fillStyle = DIM
  ctx.fillText(`ПРИНЯТО ${s.messagesHeard} · ЕЩЁ В ПУТИ ${inFlight}`, pad, height * 0.625)
  ctx.font = `500 ${height * 0.06}px ${FONT}`
  ctx.fillStyle = AMBER
  const text = s.messagesHeard > 0 ? MESSAGES[s.messagesHeard - 1].text : 'Ждём первого сигнала.'
  wrapText(ctx, text, width - 2 * pad).slice(0, MESSAGE_LINES).forEach((line, i) => ctx.fillText(line, pad, height * (0.71 + 0.08 * i)))
}

const REAR_CONE_HALF_ANGLE = (50 * Math.PI) / 180

// A black rear monitor reads as a fault unless it says why, so the caption states where the stars went.
const paintRearCaption: Painter = (ctx, width, height, s) => {
  const phi = s.ship.phi
  ctx.fillStyle = 'rgba(2, 4, 6, 0.86)'
  ctx.fillRect(0, 0, width, height)
  const share = auto(100 * skyFractionAstern(REAR_CONE_HALF_ANGLE, phi), 2)
  const caption = `ЗАДНИЙ ОБЗОР · D ×${auto(Math.exp(-phi), 3)} · ${share} % НЕБА · УСИЛ. ×${auto(rearCameraGain(phi), 1)}`
  const baseSize = height * 0.62
  ctx.font = `600 ${baseSize}px ${FONT}`
  const size = Math.min(baseSize, (baseSize * width * 0.97) / ctx.measureText(caption).width)
  ctx.font = `600 ${size}px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillStyle = CYAN
  ctx.fillText(caption, width / 2, height / 2)
}

// The gas analyser: CO₂ in the air at the pilot's face, against NASA's limit, and the two switches that keep it down.
const paintCo2: Painter = (ctx, width, height, s) => {
  const co2 = faceCo2(s)
  const tone = co2 >= CO2_OFF_NOMINAL ? RED : co2 > CO2_LIMIT ? AMBER : GREEN
  paintBackground(ctx, width, height)
  const pad = width * 0.05
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `600 ${height * 0.2}px ${FONT}`
  ctx.fillStyle = DIM
  ctx.fillText('CO₂, мм рт. ст.', pad, height * 0.2, width - 2 * pad) // the screen is narrow for its height: squeeze, not cut
  ctx.textAlign = 'right'
  ctx.font = `600 ${height * 0.46}px ${FONT}`
  ctx.fillStyle = tone
  ctx.fillText(co2 < 99.5 ? co2.toFixed(1) : '> 99', width - pad, height * 0.55, width * 0.5 - pad)
  ctx.textAlign = 'left'
  ctx.font = `500 ${height * 0.17}px ${FONT}`
  ctx.fillStyle = DIM
  ctx.fillText(`НОРМА ≤ ${CO2_LIMIT}`, pad, height * 0.55, width * 0.5 - 2 * pad)
  ctx.fillText(`ВЕНТ ${s.fansOn ? 'ВКЛ' : 'ВЫКЛ'} · ПОГЛ ${s.scrubberOn ? 'ВКЛ' : 'ВЫКЛ'}`, pad, height * 0.86, width - 2 * pad)
}

/** What the target screen says above its table: what ВЫБРАТЬ would do now, or why it would do nothing. */
function targetStatus(s: SimState): readonly [string, string] | null {
  if (s.course.turn) return ['РАЗВОРОТ', AMBER]
  if (!isAtRest(s.ship)) return ['ТОЛЬКО В ПОКОЕ', DIM]
  return s.targetCursor !== s.course.target ? ['НАЖМИТЕ ВЫБРАТЬ', CYAN] : null
}

const TARGET_ROWS = [-1, 0, 1] as const // the row above the lit one, the lit one, the row below
const TARGET_ROW_Y = [0.37, 0.61, 0.86] as const // of the height

/** Three rows of the table of targets round the lit one, each with how far it is; the ship's target marked ●. */
const paintTarget: Painter = (ctx, width, height, s) => {
  paintBackground(ctx, width, height)
  const pad = width * 0.04
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `600 ${height * 0.13}px ${FONT}`
  ctx.fillStyle = CYAN
  ctx.fillText('ЦЕЛЬ', pad, height * 0.12)
  const status = targetStatus(s)
  if (status) {
    ctx.textAlign = 'right'
    ctx.fillStyle = status[1]
    ctx.fillText(status[0], width - pad, height * 0.12, width * 0.66)
  }
  ctx.globalAlpha = 0.35
  ctx.fillRect(pad, height * 0.22, width - 2 * pad, 2)
  ctx.globalAlpha = 1
  TARGET_ROWS.forEach((offset, k) => {
    const row = (s.targetCursor + offset + TARGETS.length) % TARGETS.length
    const isLit = offset === 0
    const isTarget = row === s.course.target
    const y = height * TARGET_ROW_Y[k]
    const size = height * (isLit ? 0.165 : 0.12)
    if (isLit) {
      ctx.fillStyle = 'rgba(127, 220, 255, 0.14)'
      ctx.fillRect(pad / 2, y - height * 0.13, width - pad, height * 0.26)
    }
    ctx.textAlign = 'left'
    ctx.font = `${isLit ? 700 : 500} ${size}px ${FONT}`
    ctx.fillStyle = isTarget ? AMBER : isLit ? CYAN : DIM
    ctx.fillText(`${isTarget ? '● ' : ''}${TARGETS[row].name}`, pad, y, width * 0.58 - pad) // the two columns never meet
    ctx.textAlign = 'right'
    ctx.font = `500 ${size * 0.72}px ${FONT}`
    ctx.fillStyle = isLit ? CYAN : DIM
    ctx.fillText(distanceText(distanceTo(s.course, s.ship, row)), width - pad, y, width * 0.36 - pad)
  })
}

/** The event timer: what it counts to, and the count, red for a strike ahead and amber while the engine burns. */
const paintTimer: Painter = (ctx, width, height, s) => {
  paintBackground(ctx, width, height)
  const pad = width * 0.04
  const timer = eventTimer(s)
  const tone = timer?.event === 'impact' ? RED : timer?.event === 'burn' ? AMBER : GREEN
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = `600 ${height * 0.13}px ${FONT}`
  ctx.fillStyle = GREEN
  ctx.fillText('ТАЙМЕР', pad, height * 0.12)
  ctx.textAlign = 'right'
  ctx.fillStyle = timer ? tone : DIM
  ctx.fillText(timer ? TIMER_TEXT[timer.event] : 'НЕТ СОБЫТИЯ', width - pad, height * 0.12, width * 0.62)
  ctx.globalAlpha = 0.35
  ctx.fillStyle = GREEN
  ctx.fillRect(pad, height * 0.22, width - 2 * pad, 2)
  ctx.globalAlpha = 1
  ctx.textAlign = 'center'
  ctx.font = `700 ${height * 0.4}px ${FONT}`
  ctx.fillStyle = timer ? tone : DIM
  ctx.fillText(timer ? timerText(timer.seconds) : '—', width / 2, height * 0.62, width - 2 * pad)
}

/** A display set into the cockpit model, which supplies its bezel: only its size is the model's. */
type SetScreenProps = ComponentProps<'group'> & { readonly size: readonly [number, number] }

export const RearCaption = ({ size, ...props }: SetScreenProps) =>
  <Screen width={size[0]} height={size[1]} paint={paintRearCaption} hasBezel={false} delay={0.72} isFed={fedBy('camera')} {...props} />
export const TargetScreen = ({ size, ...props }: SetScreenProps) =>
  <Screen width={size[0]} height={size[1]} paint={paintTarget} hasBezel={false} delay={0.08} isFed={fedBy('nav')} {...props} />
export const NavScreen = ({ size, ...props }: SetScreenProps) =>
  <Screen width={size[0]} height={size[1]} paint={paintNav} hasBezel={false} delay={0.04} isFed={fedBy('nav')} {...props} />
export const RadiationScreen = ({ size, ...props }: SetScreenProps) =>
  <Screen width={size[0]} height={size[1]} paint={paintRadiation} hasBezel={false} delay={0.3} isFed={fedBy('dosimeter')} {...props} />
export const TimeScreen = ({ size, ...props }: SetScreenProps) =>
  <Screen width={size[0]} height={size[1]} paint={paintTime} hasBezel={false} delay={0.5} {...props} />
export const CommScreen = ({ size, ...props }: SetScreenProps) =>
  <Screen width={size[0]} height={size[1]} paint={paintComms} hasBezel={false} delay={0.62} isFed={fedBy('comms')} {...props} />
export const TimerScreen = ({ size, ...props }: SetScreenProps) =>
  <Screen width={size[0]} height={size[1]} paint={paintTimer} hasBezel={false} delay={0.1} isFed={fedBy('nav')} {...props} />
export const Co2Screen = ({ size, ...props }: SetScreenProps) =>
  <Screen width={size[0]} height={size[1]} paint={paintCo2} hasBezel={false} delay={0.24} {...props} />

type LabelProps = ComponentProps<'mesh'> & {
  readonly text: string
  readonly size?: number
  readonly color?: string
}

const LEGEND_GLOW = new THREE.Color(1.5, 1.5, 1.5)

/** A printed legend on the panel: painted, so the cabin light shows it, and lit from behind while the bus is on. */
export function Label({ text, size = 0.016, color = '#b6c4cf', ...props }: LabelProps) {
  const shown = legendIn(text, useLang()) // written in Russian, shown in the language chosen (labels.ts)
  const material = useRef<THREE.MeshStandardMaterial>(null!)
  const backlight = useWake(0)
  useFrame(() => { material.current.emissiveIntensity = backlight.value })
  const { texture, aspect } = useMemo(() => {
    const pixelHeight = 64
    const font = `600 ${pixelHeight * 0.72}px ${FONT}`
    const probe = document.createElement('canvas').getContext('2d')
    if (!probe) throw new Error('2D canvas is unavailable, so the panel legends cannot be drawn')
    probe.font = font
    const pixelWidth = Math.ceil(probe.measureText(shown).width) + 8
    const [ctx, map] = newCanvas(pixelWidth, pixelHeight)
    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillStyle = color
    ctx.fillText(shown, pixelWidth / 2, pixelHeight / 2)
    map.needsUpdate = true
    return { texture: map, aspect: pixelWidth / pixelHeight }
  }, [shown, color])
  return (
    <mesh {...props} raycast={() => null}>
      <planeGeometry args={[size * aspect, size]} />
      <meshStandardMaterial ref={material} map={texture} emissive={LEGEND_GLOW} emissiveMap={texture} emissiveIntensity={0} roughness={0.8}
        transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}
