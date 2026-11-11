// The mail on the desk's left-hand screen: the inbox down the side, newest first, the open letter beside it.
import { MESSAGES, commLink } from './comms'
import { BAR, SPACE, TYPE, UI, fillRound, fit, isOver, paintBar, paintIcon, paintScrollbar, paintStatus, setFont, wrap, type DeskPainter, type Pointer } from './deskTheme'
import { scrollLimits, type Region } from './deskUi'
import { durationText, earthDateTime } from './format'
import { isLetterRead, type SimState } from './sim'

const LIST_WIDTH = 340
const LIST_HEAD = 60
const ROW = 76 // px: a sender and time over a line of the text
const SENDER = 'ЦУП'
const SENDER_FULL = 'Центр управления полётом'

/** A letter's words without the "ЦУП:" it is sent under, as the inbox already names the sender. */
const bodyOf = (text: string): string => {
  const body = text.replace(/^ЦУП:\s*/, '')
  return body.charAt(0).toUpperCase() + body.slice(1)
}

function paintEmpty(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const middle = (BAR + height) / 2
  paintIcon(ctx, 'mail', width / 2, middle - 60, 64, UI.faint)
  setFont(ctx, TYPE.body, 600)
  ctx.textAlign = 'center'
  ctx.fillStyle = UI.text
  ctx.fillText('Писем пока нет', width / 2, middle + 20)
  setFont(ctx, TYPE.small)
  ctx.fillStyle = UI.muted
  ctx.fillText('Письма приходят, пока есть связь с Землёй', width / 2, middle + 64)
}

function paintRow(ctx: CanvasRenderingContext2D, s: SimState, i: number, y: number, isOpen: boolean, isHover: boolean): Region {
  const row = { x: 0, y, w: LIST_WIDTH, h: ROW }
  if (isOpen) {
    fillRound(ctx, { x: 8, y: y + 4, w: LIST_WIDTH - 24, h: ROW - 8 }, 10, UI.accentSoft)
    fillRound(ctx, { x: 8, y: y + 14, w: 5, h: ROW - 28 }, 3, UI.accent)
  } else if (isHover) fillRound(ctx, { x: 8, y: y + 4, w: LIST_WIDTH - 24, h: ROW - 8 }, 10, UI.hover)
  const isUnread = !isLetterRead(s, i)
  if (isUnread) {
    ctx.fillStyle = UI.accent
    ctx.beginPath()
    ctx.arc(30, y + 26, 6, 0, 2 * Math.PI)
    ctx.fill()
  }
  setFont(ctx, TYPE.small, isUnread ? 700 : 500)
  ctx.textAlign = 'left'
  ctx.fillStyle = UI.text
  ctx.fillText(SENDER, 46, y + 26)
  setFont(ctx, TYPE.caption)
  ctx.textAlign = 'right'
  ctx.fillStyle = isUnread ? UI.accent : UI.muted
  ctx.fillText(earthDateTime(MESSAGES[i].sentAfter), LIST_WIDTH - SPACE.m, y + 26)
  setFont(ctx, TYPE.caption)
  ctx.textAlign = 'left'
  ctx.fillStyle = UI.muted
  ctx.fillText(fit(ctx, bodyOf(MESSAGES[i].text), LIST_WIDTH - 46 - SPACE.m), 46, y + 54)
  return { id: `mail:${i}`, ...row }
}

function paintInbox(ctx: CanvasRenderingContext2D, height: number, s: SimState, open: number, scroll: number, p: Pointer): readonly Region[] {
  ctx.fillStyle = UI.surface
  ctx.fillRect(0, BAR, LIST_WIDTH, height - BAR)
  setFont(ctx, TYPE.small, 600)
  ctx.textAlign = 'left'
  ctx.fillStyle = UI.muted
  ctx.fillText('Входящие', SPACE.m, BAR + LIST_HEAD / 2)
  ctx.textAlign = 'right'
  ctx.fillText(String(s.messagesHeard), LIST_WIDTH - SPACE.m, BAR + LIST_HEAD / 2)
  const top = BAR + LIST_HEAD
  const visible = Math.floor((height - top) / ROW)
  const newestFirst = Array.from({ length: s.messagesHeard }, (_, k) => s.messagesHeard - 1 - k)
  const shown = newestFirst.slice(scroll, scroll + visible)
  paintScrollbar(ctx, { x: LIST_WIDTH - 12, y: top, w: 6, h: visible * ROW }, scroll, visible, newestFirst.length)
  return shown.map((i, row) => {
    const y = top + row * ROW
    return paintRow(ctx, s, i, y, i === open, isOver(p, { x: 0, y, w: LIST_WIDTH, h: ROW }))
  })
}

function paintLetter(ctx: CanvasRenderingContext2D, width: number, height: number, s: SimState, i: number): void {
  const left = LIST_WIDTH + SPACE.l
  const textWidth = width - left - SPACE.l
  setFont(ctx, TYPE.body, 600)
  ctx.textAlign = 'left'
  ctx.fillStyle = UI.text
  ctx.fillText(fit(ctx, SENDER_FULL, textWidth), left, BAR + 48)
  setFont(ctx, TYPE.caption)
  ctx.fillStyle = UI.muted
  ctx.fillText(`Отправлено ${earthDateTime(MESSAGES[i].sentAfter)} UTC`, left, BAR + 90)
  ctx.fillText(`Получено на ${durationText(s.mailArrivedAt[i] ?? 0)} полёта`, left, BAR + 122)
  ctx.fillStyle = UI.border
  ctx.fillRect(left, BAR + 150, textWidth, 2)
  setFont(ctx, TYPE.body)
  ctx.fillStyle = UI.text
  wrap(ctx, bodyOf(MESSAGES[i].text), textWidth).forEach((line, n) => {
    const y = BAR + 196 + n * 46
    if (y < height - SPACE.m) ctx.fillText(line, left, y)
  })
}

export const paintMail: DeskPainter = (ctx, width, height, s, ui, p) => {
  ctx.fillStyle = UI.desk
  ctx.fillRect(0, 0, width, height)
  paintBar(ctx, width, 'mail', 'Почта')
  const link = commLink(s.course, s.ship)
  const isListening = link.isUp && s.breakers.comms
  paintStatus(ctx, isListening ? 'Связь с Землёй' : 'Нет связи', isListening ? UI.ok : UI.warn, width - SPACE.m, BAR / 2)
  if (s.messagesHeard === 0) {
    scrollLimits.mail = 0
    paintEmpty(ctx, width, height)
    return []
  }
  const visible = Math.floor((height - BAR - LIST_HEAD) / ROW)
  scrollLimits.mail = Math.max(0, s.messagesHeard - visible)
  const scroll = Math.min(ui.mailScroll, scrollLimits.mail)
  const open = ui.letter !== null && ui.letter < s.messagesHeard ? ui.letter : s.messagesHeard - 1
  const rows = paintInbox(ctx, height, s, open, scroll, p)
  paintLetter(ctx, width, height, s, open)
  return rows
}
