// The map on the desk's middle screen: the Galaxy from above its plane with the ship in the middle; a star under the
// pointer lights up, a click opens its card with the trip there, and the card sends it to the cockpit's target screen.
import { BAR, SPACE, TARGET, TYPE, UI, fillRound, fit, paintBar, paintButton, setFont, strokeRound, type DeskPainter, type Pointer } from './deskTheme'
import type { DeskUi, Region } from './deskUi'
import { distanceText, durationText } from './format'
import { MAP_SCALES, nearestPoint, toMap, tripTimes } from './galaxyMap'
import { G0, LY } from './physics'
import type { SimState } from './sim'
import { TARGETS, distanceTo, shipPosition } from './voyage'

const PICK_REACH = 28 // px of canvas round a star that a click or the pointer takes it from
const LABEL_SPACING = 44 // px: a name is left off where another stands closer
const CARD_HEIGHT = 128

type Point = readonly [number, number]

function paintTrack(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.strokeStyle = UI.faint
  ctx.lineWidth = 2
  ctx.setLineDash([10, 8])
  ctx.beginPath()
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.stroke()
  ctx.setLineDash([])
}

function paintStars(ctx: CanvasRenderingContext2D, points: readonly Point[], s: SimState, ui: DeskUi, hovered: number | null): void {
  const named: Point[] = []
  setFont(ctx, TYPE.caption, 500)
  ctx.textAlign = 'left'
  points.forEach(([x, y], i) => {
    const isPicked = i === ui.picked
    const isFocus = isPicked || i === hovered
    ctx.fillStyle = isPicked ? UI.accent : i === s.course.target ? UI.ok : isFocus ? UI.text : UI.muted
    ctx.beginPath()
    ctx.arc(x, y, isFocus || i === s.course.target ? 7 : 5, 0, 2 * Math.PI)
    ctx.fill()
    if (isFocus) {
      ctx.strokeStyle = isPicked ? UI.accent : UI.text
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 14, 0, 2 * Math.PI)
      ctx.stroke()
    }
    const isCrowded = named.some(([nx, ny]) => Math.hypot(nx - x, ny - y) < LABEL_SPACING)
    if (isCrowded && !isFocus) return
    named.push([x, y])
    ctx.fillStyle = isFocus ? UI.text : UI.muted
    ctx.fillText(TARGETS[i].name, x + 18, y)
  })
}

function paintShip(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const [x, y] = [width / 2, height / 2]
  ctx.fillStyle = UI.ok
  ctx.beginPath()
  ctx.moveTo(x, y - 12)
  ctx.lineTo(x - 9, y + 9)
  ctx.lineTo(x + 9, y + 9)
  ctx.closePath()
  ctx.fill()
}

/** The picked star's card along the bottom: its name, how far, how long, and what to do with it. */
function paintCard(ctx: CanvasRenderingContext2D, width: number, height: number, s: SimState, picked: number, p: Pointer): readonly Region[] {
  const card = { x: SPACE.m, y: height - CARD_HEIGHT - SPACE.m, w: width - 2 * SPACE.m, h: CARD_HEIGHT }
  fillRound(ctx, card, 16, UI.raised)
  strokeRound(ctx, card, 16, UI.border)
  const metres = distanceTo(s.course, s.ship, picked)
  const trip = tripTimes(metres / LY, G0)
  const textWidth = card.w - 330
  setFont(ctx, TYPE.body, 600)
  ctx.textAlign = 'left'
  ctx.fillStyle = UI.text
  ctx.fillText(fit(ctx, TARGETS[picked].name, textWidth), card.x + SPACE.m, card.y + 36)
  setFont(ctx, TYPE.caption)
  ctx.fillStyle = UI.muted
  ctx.fillText(fit(ctx, distanceText(metres), textWidth), card.x + SPACE.m, card.y + 74)
  ctx.fillText(fit(ctx, `При 1 g из покоя: на борту ${durationText(trip.ship)}, на Земле ${durationText(trip.earth)}`, textWidth), card.x + SPACE.m, card.y + 104)
  const isSent = s.targetCursor === picked
  const send = paintButton(ctx, 'map:send', { x: card.x + card.w - 300, y: card.y + (CARD_HEIGHT - TARGET) / 2, w: 210, h: TARGET }, p,
    { text: isSent ? 'На экране ЦЕЛЬ' : 'На экран ЦЕЛЬ', icon: 'target', kind: 'primary', isDisabled: isSent })
  const close = paintButton(ctx, 'map:clear', { x: card.x + card.w - 80, y: card.y + (CARD_HEIGHT - TARGET) / 2, w: TARGET, h: TARGET }, p,
    { icon: 'close', kind: 'ghost' })
  // the card itself answers nothing, so that a click on it does not pick a star under it
  return [...[send, close].filter((r): r is Region => r !== null), { id: 'map:card', ...card }]
}

export const paintMap: DeskPainter = (ctx, width, height, s, ui, p) => {
  ctx.fillStyle = UI.desk
  ctx.fillRect(0, 0, width, height)
  const half = MAP_SCALES[ui.mapScale]
  const here = shipPosition(s.course, s.ship.x)
  const project = (point: readonly [number, number, number]): Point => toMap(point, here, half, width, height)
  paintTrack(ctx, [...s.track, s.course.origin, here].map(project))
  const points = TARGETS.map((t) => project(t.position))
  const hovered = p && p.y > BAR ? nearestPoint(points, p.x, p.y, PICK_REACH) : null
  paintStars(ctx, points, s, ui, hovered)
  paintShip(ctx, width, height)
  paintBar(ctx, width, 'map', 'Карта Галактики')
  setFont(ctx, TYPE.small, 500)
  ctx.textAlign = 'right'
  ctx.fillStyle = UI.muted
  const zoomLeft = width - SPACE.s - 2 * (TARGET - 8) - SPACE.xs
  ctx.fillText(`До края ${distanceText(half * LY)}`, zoomLeft - SPACE.m, BAR / 2)
  const keys = [
    paintButton(ctx, 'map:out', { x: zoomLeft, y: 4, w: TARGET - 8, h: BAR - 8 }, p, { icon: 'minus', isDisabled: ui.mapScale === MAP_SCALES.length - 1 }),
    paintButton(ctx, 'map:in', { x: zoomLeft + TARGET - 8 + SPACE.xs, y: 4, w: TARGET - 8, h: BAR - 8 }, p, { icon: 'plus', isDisabled: ui.mapScale === 0 }),
  ].filter((r): r is Region => r !== null)
  const card = ui.picked === null ? [] : paintCard(ctx, width, height, s, ui.picked, p)
  const field: Region = {
    id: 'map:field', x: 0, y: BAR, w: width, h: height - BAR,
    at: (x, y) => {
      const i = nearestPoint(points, x, y, PICK_REACH)
      return i === null ? null : `map:pick:${i}`
    },
  }
  return [...keys, ...card, field]
}
