// The look of the desk computer: a dark desktop, its own and not the cockpit instruments'. Sizes are canvas px of a
// 900 × 510 screen; from the chair in a 1000 × 640 view a canvas px is about 0.42 of a view px, so the 32 px body reads
// at 13–14 px, and a 64 px key is a 27 px target.
import type { DeskUi, Region } from './deskUi'
import type { SimState } from './sim'

/** Semantic colours: slate surfaces, one blue accent for what is selected or acts, and the status colours with text. */
export const UI = {
  desk: '#0B1220',
  surface: '#111A2E',
  raised: '#17233B',
  hover: '#1E2C48',
  pressed: '#26375A',
  border: '#2A3956',
  text: '#E6EDF7',
  muted: '#93A3BD', // 6:1 on the surface
  faint: '#64748B',
  accent: '#4C8DFF',
  accentSoft: 'rgba(76, 141, 255, 0.16)',
  ok: '#34D399',
  warn: '#FBBF24',
  danger: '#F87171',
} as const

export const SANS = '"SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
export const TYPE = { title: 36, body: 32, small: 26, caption: 22 } as const
export const SPACE = { xs: 8, s: 16, m: 24, l: 32 } as const
export const TARGET = 64 // px: the least height of anything the mouse presses
export const BAR = 64 // px: the bar along the top of every screen

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Where the pointer is on this screen, in canvas px, and whether its button is down; null when it is elsewhere. */
export type Pointer = { readonly x: number; readonly y: number; readonly isDown: boolean } | null

/** A desk screen's painter: it draws the screen for this moment and says where its keys are. */
export type DeskPainter = (
  ctx: CanvasRenderingContext2D, width: number, height: number, s: SimState, ui: DeskUi, p: Pointer,
) => readonly Region[]

export const isOver = (p: Pointer, r: Rect): boolean => p !== null && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h

export function setFont(ctx: CanvasRenderingContext2D, size: number, weight: 400 | 500 | 600 | 700 = 400): void {
  ctx.font = `${weight} ${size}px ${SANS}`
  ctx.textBaseline = 'middle'
}

/** The text cut to `maxWidth` with an ellipsis, rather than squeezed. */
export function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let end = text.length
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--
  return `${text.slice(0, end).trimEnd()}…`
}

/** Words into lines no wider than `maxWidth`. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return text.split(' ').reduce<string[]>((lines, word) => {
    const last = lines[lines.length - 1]
    const joined = last === undefined ? word : `${last} ${word}`
    return last !== undefined && ctx.measureText(joined).width > maxWidth ? [...lines, word] : [...lines.slice(0, -1), joined]
  }, [])
}

export function fillRound(ctx: CanvasRenderingContext2D, r: Rect, radius: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, radius)
  ctx.fill()
}

export function strokeRound(ctx: CanvasRenderingContext2D, r: Rect, radius: number, color: string, width = 2): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.roundRect(r.x + width / 2, r.y + width / 2, r.w - width, r.h - width, radius)
  ctx.stroke()
}

export type IconName = 'mail' | 'map' | 'gauge' | 'book' | 'close' | 'plus' | 'minus' | 'target'

/** Line icons drawn as paths, `size` px square with its centre at (x, y). */
export function paintIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string): void {
  const h = size / 2
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(2, size / 11)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (name === 'mail') {
    ctx.roundRect(x - h, y - h * 0.7, size, size * 0.7, 3)
    ctx.moveTo(x - h, y - h * 0.6)
    ctx.lineTo(x, y + h * 0.1)
    ctx.lineTo(x + h, y - h * 0.6)
  } else if (name === 'map') {
    ctx.arc(x, y, h, 0, 2 * Math.PI)
    ctx.moveTo(x - h, y)
    ctx.lineTo(x + h, y)
    ctx.ellipse(x, y, h * 0.42, h, 0, 0, 2 * Math.PI)
  } else if (name === 'gauge') {
    ctx.arc(x, y + h * 0.25, h, Math.PI, 2 * Math.PI)
    ctx.moveTo(x, y + h * 0.25)
    ctx.lineTo(x + h * 0.55, y - h * 0.35)
  } else if (name === 'book') {
    ctx.moveTo(x, y - h * 0.6)
    ctx.lineTo(x, y + h * 0.8)
    ctx.moveTo(x, y - h * 0.6)
    ctx.quadraticCurveTo(x - h * 0.5, y - h * 0.9, x - h, y - h * 0.6)
    ctx.lineTo(x - h, y + h * 0.8)
    ctx.quadraticCurveTo(x - h * 0.5, y + h * 0.5, x, y + h * 0.8)
    ctx.moveTo(x, y - h * 0.6)
    ctx.quadraticCurveTo(x + h * 0.5, y - h * 0.9, x + h, y - h * 0.6)
    ctx.lineTo(x + h, y + h * 0.8)
    ctx.quadraticCurveTo(x + h * 0.5, y + h * 0.5, x, y + h * 0.8)
  } else if (name === 'close') {
    ctx.moveTo(x - h * 0.6, y - h * 0.6)
    ctx.lineTo(x + h * 0.6, y + h * 0.6)
    ctx.moveTo(x + h * 0.6, y - h * 0.6)
    ctx.lineTo(x - h * 0.6, y + h * 0.6)
  } else if (name === 'plus' || name === 'minus') {
    ctx.moveTo(x - h * 0.6, y)
    ctx.lineTo(x + h * 0.6, y)
    if (name === 'plus') {
      ctx.moveTo(x, y - h * 0.6)
      ctx.lineTo(x, y + h * 0.6)
    }
  } else {
    ctx.arc(x, y, h * 0.75, 0, 2 * Math.PI)
    ctx.moveTo(x + h * 0.25, y)
    ctx.arc(x, y, h * 0.25, 0, 2 * Math.PI)
  }
  ctx.stroke()
}

/** The bar along the top: the app's icon and name, and on the right what the app puts there. */
export function paintBar(ctx: CanvasRenderingContext2D, width: number, icon: IconName, title: string): void {
  ctx.fillStyle = UI.surface
  ctx.fillRect(0, 0, width, BAR)
  ctx.fillStyle = UI.border
  ctx.fillRect(0, BAR - 2, width, 2)
  paintIcon(ctx, icon, SPACE.m + 16, BAR / 2, 30, UI.accent)
  setFont(ctx, TYPE.title, 600)
  ctx.textAlign = 'left'
  ctx.fillStyle = UI.text
  ctx.fillText(title, SPACE.m + 44, BAR / 2)
}

type ButtonKind = 'primary' | 'secondary' | 'ghost'

/** A button: filled blue for the one action that matters, outlined otherwise; it lightens under the pointer and darkens
 * while pressed, and a disabled one is dim and answers nothing. */
export function paintButton(
  ctx: CanvasRenderingContext2D, id: string, r: Rect, p: Pointer,
  { text = '', icon, kind = 'secondary', isDisabled = false }: { text?: string; icon?: IconName; kind?: ButtonKind; isDisabled?: boolean } = {},
): Region | null {
  const over = !isDisabled && isOver(p, r)
  const pressed = over && (p?.isDown ?? false)
  const base = kind === 'primary' ? UI.accent : kind === 'secondary' ? UI.raised : 'rgba(0, 0, 0, 0)'
  fillRound(ctx, r, 12, isDisabled ? UI.surface : pressed ? (kind === 'primary' ? '#3A72D6' : UI.pressed) : over ? (kind === 'primary' ? '#6AA1FF' : UI.hover) : base)
  if (kind === 'secondary') strokeRound(ctx, r, 12, UI.border)
  const color = isDisabled ? UI.faint : kind === 'primary' ? '#FFFFFF' : UI.text
  setFont(ctx, TYPE.small, 600)
  ctx.textAlign = 'center'
  ctx.fillStyle = color
  const iconSize = Math.min(30, r.h * 0.45)
  if (icon && text) {
    const textWidth = ctx.measureText(text).width
    const start = r.x + (r.w - iconSize - 12 - textWidth) / 2
    paintIcon(ctx, icon, start + iconSize / 2, r.y + r.h / 2, iconSize, color)
    ctx.textAlign = 'left'
    ctx.fillText(text, start + iconSize + 12, r.y + r.h / 2)
  } else if (icon) {
    paintIcon(ctx, icon, r.x + r.w / 2, r.y + r.h / 2, iconSize, color)
  } else {
    ctx.fillText(fit(ctx, text, r.w - 2 * SPACE.s), r.x + r.w / 2, r.y + r.h / 2)
  }
  return isDisabled ? null : { id, ...r }
}

/** A segmented control: one choice of a few, the chosen one raised and blue. */
export function paintSegments(
  ctx: CanvasRenderingContext2D, r: Rect, p: Pointer, segments: ReadonlyArray<readonly [string, string]>, chosen: string,
): readonly Region[] {
  fillRound(ctx, r, 12, UI.desk)
  const w = r.w / segments.length
  return segments.map(([id, text], i) => {
    const cell = { x: r.x + i * w + 4, y: r.y + 4, w: w - 8, h: r.h - 8 }
    const isChosen = id === chosen
    if (isChosen) fillRound(ctx, cell, 9, UI.accent)
    else if (isOver(p, cell)) fillRound(ctx, cell, 9, UI.hover)
    setFont(ctx, TYPE.small, 600)
    ctx.textAlign = 'center'
    ctx.fillStyle = isChosen ? '#FFFFFF' : UI.muted
    ctx.fillText(text, cell.x + cell.w / 2, cell.y + cell.h / 2)
    return { id, ...cell }
  })
}

/** A thin bar beside a list that says how much of it shows and where. */
export function paintScrollbar(ctx: CanvasRenderingContext2D, track: Rect, offset: number, visible: number, total: number): void {
  if (total <= visible) return
  fillRound(ctx, track, track.w / 2, UI.raised)
  const h = Math.max(40, (track.h * visible) / total)
  const y = track.y + ((track.h - h) * offset) / Math.max(1, total - visible)
  fillRound(ctx, { x: track.x, y, w: track.w, h }, track.w / 2, UI.faint)
}

/** A status: a dot and a word in its colour, never the colour alone. */
export function paintStatus(ctx: CanvasRenderingContext2D, text: string, color: string, right: number, y: number): void {
  setFont(ctx, TYPE.small, 600)
  ctx.textAlign = 'right'
  ctx.fillStyle = color
  ctx.fillText(text, right, y)
  const width = ctx.measureText(text).width
  ctx.beginPath()
  ctx.arc(right - width - 16, y, 7, 0, 2 * Math.PI)
  ctx.fill()
}
