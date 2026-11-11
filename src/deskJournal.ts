// The log on the desk's right-hand screen: what happened aboard, newest first, by both clocks.
import { BAR, SPACE, TYPE, UI, fit, paintIcon, paintScrollbar, setFont } from './deskTheme'
import { scrollLimits, type DeskUi } from './deskUi'
import { earthDateTime, shipClock } from './format'
import type { LogLevel, SimState } from './sim'

const ROW = 76 // px: the line over its two clocks
const TONE: Readonly<Record<LogLevel, string>> = { info: UI.accent, caution: UI.warn, warning: UI.danger }

function paintEmpty(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const middle = (BAR + height) / 2
  paintIcon(ctx, 'book', width / 2, middle - 60, 64, UI.faint)
  setFont(ctx, TYPE.body, 600)
  ctx.textAlign = 'center'
  ctx.fillStyle = UI.text
  ctx.fillText('Записей пока нет', width / 2, middle + 20)
  setFont(ctx, TYPE.small)
  ctx.fillStyle = UI.muted
  ctx.fillText('Сюда пишутся отказы, письма и состояние экипажа', width / 2, middle + 64)
}

export function paintJournal(ctx: CanvasRenderingContext2D, width: number, height: number, s: SimState, ui: DeskUi): void {
  const top = BAR + SPACE.xs
  const visible = Math.floor((height - top) / ROW)
  scrollLimits.journal = Math.max(0, s.log.length - visible)
  if (s.log.length === 0) {
    paintEmpty(ctx, width, height)
    return
  }
  const scroll = Math.min(ui.journalScroll, scrollLimits.journal)
  s.log.slice(scroll, scroll + visible).forEach((entry, i) => {
    const y = top + i * ROW
    ctx.fillStyle = TONE[entry.level]
    ctx.beginPath()
    ctx.arc(SPACE.m + 6, y + 28, 7, 0, 2 * Math.PI)
    ctx.fill()
    setFont(ctx, TYPE.small, 600)
    ctx.textAlign = 'left'
    ctx.fillStyle = entry.level === 'info' ? UI.text : TONE[entry.level]
    ctx.fillText(fit(ctx, entry.text, width - 80), 48, y + 28)
    setFont(ctx, TYPE.caption)
    ctx.fillStyle = UI.muted
    ctx.fillText(fit(ctx, `${shipClock(entry.tau)} на борту · ${earthDateTime(entry.earth)} на Земле`, width - 80), 48, y + 58)
    ctx.fillStyle = UI.border
    ctx.fillRect(48, y + ROW - 1, width - 48 - SPACE.m, 1)
  })
  paintScrollbar(ctx, { x: width - 14, y: top, w: 6, h: visible * ROW }, scroll, visible, s.log.length)
}
