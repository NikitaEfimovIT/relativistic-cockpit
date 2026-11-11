// The desk's right-hand screen: the ship's systems as cards with any open fault over them, the log, or the manual with
// its contents down the side and the faults' procedures ticking themselves off.
import {
  BAR, SPACE, TARGET, TYPE, UI, fillRound, fit, isOver, paintBar, paintButton, paintScrollbar, paintSegments, setFont, strokeRound, wrap,
  type DeskPainter, type Pointer, type Rect,
} from './deskTheme'
import { paintJournal } from './deskJournal'
import { scrollLimits, type DeskUi, type Region } from './deskUi'
import { FAULT_NAMES, activeFaults, type FaultId } from './failures'
import { BATTERY_WH, celsius, isVenting, ppO2Kpa, pressureKpa, type Habitat } from './habitat'
import { CO2_LIMIT, CO2_OFF_NOMINAL } from './lifeSupport'
import { MANUAL, proceduresInOrder, ticksOf, type ManualPage } from './manual'
import { LETHAL_DOSE } from './physics'
import { crewOf, faceCo2, totalLoadW, type SimState } from './sim'

const GAP = 16
const TOC_WIDTH = 300
const TOC_ROW = 48 // px a section down the side, at most; more sections than fit, and the rows close up
const LINE = 42 // px between lines of the manual
const ROW = 36 // px between the rows of a card: four fit
const CARD_PAD = 18 // px inside a card: a third of the screen is tight for a label and its value side by side
const STEP_INDENT = 44 // px: a step's text, right of its tick box
const TICK = 26 // px, a step's tick box

type Row = readonly [label: string, value: string, tone: string]
type Card = readonly [title: string, rows: readonly Row[]]

const onOff = (isOn: boolean): string => (isOn ? 'Вкл' : 'Выкл')
const okIf = (isOk: boolean, isBad = false): string => (isBad ? UI.danger : isOk ? UI.ok : UI.warn)
const fixed = (v: number, digits: number): string => v.toFixed(digits).replace('.', ',')
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
const ventText = (h: Habitat): string => (h.ventIsolated ? 'Изолирован' : h.ventStuck ? 'Заело' : h.ventOpen ? 'Открыт' : 'Закрыт')
const ventTone = (h: Habitat): string => (isVenting(h) ? (h.ventStuck ? UI.danger : UI.warn) : h.ventIsolated ? UI.warn : UI.ok)

function cards(s: SimState): readonly Card[] {
  const h = s.habitat
  const t = celsius(h)
  const co2 = faceCo2(s)
  const crew = crewOf(s)
  return [
    ['ПИТАНИЕ', [
      ['Реактор', h.reactorScrammed ? 'Защита' : onOff(h.reactorOn), okIf(h.reactorOn, h.reactorScrammed)],
      ['Аккумулятор', `${Math.round((h.batteryWh / BATTERY_WH) * 100)} %`, okIf(h.batteryWh > 0.2 * BATTERY_WH, h.batteryWh === 0)],
      ['Нагрузка', `${fixed(totalLoadW(s) / 1000, 2)} кВт`, UI.text],
    ]],
    ['ТЕПЛО', [
      ['Температура', `${fixed(t, 1)} °C`, okIf(t >= 18 && t <= 27, t < 10)],
      ['Уставка', `${h.setpoint} °C`, UI.text],
      ['Обогрев 1', h.heater1Failed ? 'Отказ' : onOff(h.heater1On), h.heater1Failed ? UI.danger : okIf(h.heater1On || h.heater2On)],
      ['Обогрев 2', onOff(h.heater2On), h.heater2On ? UI.ok : UI.muted],
    ]],
    ['АТМОСФЕРА', [
      ['Давление', `${fixed(pressureKpa(h), 1)} кПа`, okIf(pressureKpa(h) > 95, pressureKpa(h) < 34.5)],
      ['Кислород', `${fixed(ppO2Kpa(h), 1)} кПа`, okIf(ppO2Kpa(h) > 18, ppO2Kpa(h) < 15)],
      ['CO₂, мм рт. ст.', fixed(co2, 1), okIf(co2 <= CO2_LIMIT, co2 >= CO2_OFF_NOMINAL)],
      ['Сброс', ventText(h), ventTone(h)],
    ]],
    ['БОРТСЕТЬ', [
      ['Шина', s.busTripped ? 'Сработала' : onOff(s.busOn), okIf(s.busOn, s.busTripped)],
      ['Вентиляция', onOff(s.fansOn), okIf(s.fansOn)],
      ['Поглотитель', onOff(s.scrubberOn), okIf(s.scrubberOn)],
    ]],
    ['АВТОМАТЫ', [
      ['Навигация', onOff(s.breakers.nav), okIf(s.breakers.nav)],
      ['Связь', onOff(s.breakers.comms), okIf(s.breakers.comms)],
      ['Дозиметр', onOff(s.breakers.dosimeter), okIf(s.breakers.dosimeter)],
      ['Камера', onOff(s.breakers.camera), okIf(s.breakers.camera)],
    ]],
    ['ЭКИПАЖ', [
      ['Состояние', crew === 'норма' ? 'В норме' : capital(crew), okIf(crew === 'норма', crew !== 'норма')],
      ['Щит', onOff(s.shieldOn), UI.text],
      ['Доза', `${fixed(s.dose, 3)} Зв`, okIf(s.dose < 0.6, s.dose >= LETHAL_DOSE)],
    ]],
  ]
}

function paintCard(ctx: CanvasRenderingContext2D, r: Rect, [title, rows]: Card): void {
  fillRound(ctx, r, 14, UI.surface)
  strokeRound(ctx, r, 14, UI.border)
  setFont(ctx, TYPE.caption, 700)
  ctx.textAlign = 'left'
  ctx.fillStyle = UI.muted
  ctx.fillText(title, r.x + CARD_PAD, r.y + 34)
  rows.forEach(([label, value, tone], i) => {
    const y = r.y + 72 + i * ROW
    setFont(ctx, TYPE.caption + 2, 600)
    ctx.textAlign = 'right'
    ctx.fillStyle = tone
    const shown = fit(ctx, value, r.w * 0.6)
    ctx.fillText(shown, r.x + r.w - CARD_PAD, y)
    const labelWidth = r.w - 2 * CARD_PAD - ctx.measureText(shown).width - 12 // the label has what the value leaves
    setFont(ctx, TYPE.caption)
    ctx.textAlign = 'left'
    ctx.fillStyle = UI.muted
    ctx.fillText(fit(ctx, label, labelWidth), r.x + CARD_PAD, y)
  })
}

const FAULT_LEVEL: Readonly<Record<FaultId, readonly [string, string]>> = {
  reactor: ['ВНИМАНИЕ', UI.warn], heater: ['ВНИМАНИЕ', UI.warn], vent: ['ПРЕДУПРЕЖДЕНИЕ', UI.danger],
}

/** The open faults, one bar each: how bad, what, and the key to its procedure. Two lines where there is room for them. */
function paintFaults(ctx: CanvasRenderingContext2D, area: Rect, faults: readonly FaultId[], p: Pointer): readonly Region[] {
  const h = Math.min(120, (area.h - (faults.length - 1) * GAP) / faults.length)
  const isTall = h >= 84
  return faults.flatMap((fault, i) => {
    const r = { x: area.x, y: area.y + i * (h + GAP), w: area.w, h }
    const [word, tone] = FAULT_LEVEL[fault]
    const middle = r.y + r.h / 2
    fillRound(ctx, r, 14, UI.surface)
    strokeRound(ctx, r, 14, tone, 3)
    fillRound(ctx, { x: r.x, y: r.y, w: 10, h: r.h }, 5, tone)
    setFont(ctx, TYPE.caption, 700)
    ctx.textAlign = 'left'
    ctx.fillStyle = tone
    ctx.fillText(word, r.x + 30, isTall ? middle - 18 : middle)
    const nameX = isTall ? r.x + 30 : r.x + 30 + ctx.measureText(word).width + SPACE.s
    setFont(ctx, TYPE.small, 600)
    ctx.fillStyle = UI.text
    ctx.fillText(fit(ctx, capital(FAULT_NAMES[fault]), r.x + r.w - 260 - nameX), nameX, isTall ? middle + 16 : middle)
    const key = Math.min(TARGET, r.h - 12)
    const button = paintButton(ctx, `fault:${fault}`, { x: r.x + r.w - 236, y: middle - key / 2, w: 216, h: key }, p,
      { text: 'Процедура', icon: 'book', kind: 'primary' })
    return button ? [button] : []
  })
}

/** Six cards in two rows; with a fault open, its bar takes the place of the lower row, under power, heat and air. */
function paintSystems(ctx: CanvasRenderingContext2D, width: number, height: number, s: SimState, p: Pointer): readonly Region[] {
  const w = (width - 4 * GAP) / 3
  const h = (height - BAR - 3 * GAP) / 2
  const faults = activeFaults(s.habitat)
  const shown = faults.length > 0 ? cards(s).slice(0, 3) : cards(s)
  shown.forEach((card, i) => paintCard(ctx, { x: GAP + (i % 3) * (w + GAP), y: BAR + GAP + Math.floor(i / 3) * (h + GAP), w, h }, card))
  if (faults.length === 0) return []
  return paintFaults(ctx, { x: GAP, y: BAR + 2 * GAP + h, w: width - 2 * GAP, h }, faults, p)
}

function paintContents(ctx: CanvasRenderingContext2D, height: number, ui: DeskUi, p: Pointer): readonly Region[] {
  ctx.fillStyle = UI.surface
  ctx.fillRect(0, BAR, TOC_WIDTH, height - BAR)
  const pitch = Math.min(TOC_ROW, Math.floor((height - BAR - 16) / MANUAL.length))
  return MANUAL.map((page, i) => {
    const row = { x: 8, y: BAR + 8 + i * pitch, w: TOC_WIDTH - 16, h: pitch - 4 }
    if (i === ui.page) {
      fillRound(ctx, row, 10, UI.accentSoft)
      fillRound(ctx, { x: row.x, y: row.y + 10, w: 5, h: row.h - 20 }, 3, UI.accent)
    } else if (isOver(p, row)) fillRound(ctx, row, 10, UI.hover)
    setFont(ctx, TYPE.caption, i === ui.page ? 600 : 500)
    ctx.textAlign = 'left'
    ctx.fillStyle = i === ui.page ? UI.text : UI.muted
    const title = page.title.replace(/^\d+\.\s*/, '')
    ctx.fillText(fit(ctx, `${i + 1}  ${title.charAt(0) + title.slice(1).toLowerCase()}`, row.w - 2 * SPACE.s), row.x + SPACE.s, row.y + row.h / 2)
    return { id: `manual:${i}`, ...row }
  })
}

/** A line of a section: a procedure's heading (lit while its fault is open), a step with its tick, or plain text. */
type Line = { readonly kind: 'heading'; readonly text: string; readonly isOpen: boolean }
  | { readonly kind: 'step'; readonly text: string; readonly isDone: boolean; readonly hasBox: boolean } // a later line has no box
  | { readonly kind: 'text'; readonly text: string }

function sectionLines(ctx: CanvasRenderingContext2D, page: ManualPage, s: SimState, width: number): readonly Line[] {
  setFont(ctx, TYPE.body)
  const open = activeFaults(s.habitat)
  const procedures = proceduresInOrder(page, s).flatMap((procedure): Line[] => [
    { kind: 'heading', text: capital(procedure.title.toLowerCase()), isOpen: procedure.fault !== undefined && open.includes(procedure.fault) },
    ...procedure.steps.flatMap((step, i) => wrap(ctx, `${i + 1}. ${step.text}`, width - STEP_INDENT)
      .map((text, k): Line => ({ kind: 'step', text, isDone: ticksOf(procedure, s)[i], hasBox: k === 0 }))),
    { kind: 'text', text: '' },
  ])
  const text = page.text.flatMap((paragraph, i): Line[] =>
    [...(i > 0 ? [{ kind: 'text', text: '' } as const] : []), ...wrap(ctx, paragraph, width - SPACE.s).map((t): Line => ({ kind: 'text', text: t }))])
  return [...procedures, ...text]
}

function paintTick(ctx: CanvasRenderingContext2D, x: number, y: number, isDone: boolean): void {
  const box = { x, y: y - TICK / 2, w: TICK, h: TICK }
  if (isDone) fillRound(ctx, box, 6, UI.ok)
  else strokeRound(ctx, box, 6, UI.muted)
  if (!isDone) return
  ctx.strokeStyle = UI.desk
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(x + 6, y)
  ctx.lineTo(x + 11, y + 6)
  ctx.lineTo(x + 20, y - 6)
  ctx.stroke()
}

function paintLine(ctx: CanvasRenderingContext2D, line: Line, x: number, y: number): void {
  ctx.textAlign = 'left'
  if (line.kind === 'heading') {
    setFont(ctx, TYPE.body, 700)
    ctx.fillStyle = line.isOpen ? UI.warn : UI.text
    ctx.fillText(line.text, x, y)
    return
  }
  if (line.kind === 'step' && line.hasBox) paintTick(ctx, x, y, line.isDone)
  setFont(ctx, TYPE.body)
  ctx.fillStyle = line.kind === 'step' && line.isDone ? UI.muted : UI.text
  ctx.fillText(line.text, line.kind === 'step' ? x + STEP_INDENT : x, y)
}

function paintSection(ctx: CanvasRenderingContext2D, width: number, height: number, ui: DeskUi, s: SimState): void {
  const page = MANUAL[ui.page]
  const view = { x: TOC_WIDTH + SPACE.l, y: BAR, w: width - TOC_WIDTH - 2 * SPACE.l, h: height - BAR }
  const lines = sectionLines(ctx, page, s, view.w)
  const contentHeight = 80 + lines.length * LINE
  scrollLimits.manual = Math.max(0, contentHeight - view.h + SPACE.m)
  const scroll = Math.min(ui.manualScroll, scrollLimits.manual)
  ctx.save()
  ctx.beginPath()
  ctx.rect(view.x, view.y, view.w, view.h)
  ctx.clip()
  const title = page.title.replace(/^\d+\.\s*/, '')
  setFont(ctx, TYPE.title, 600)
  ctx.textAlign = 'left'
  ctx.fillStyle = UI.text
  ctx.fillText(title.charAt(0) + title.slice(1).toLowerCase(), view.x, view.y + 44 - scroll)
  lines.forEach((line, i) => paintLine(ctx, line, view.x, view.y + 104 + i * LINE - scroll))
  ctx.restore()
  paintScrollbar(ctx, { x: width - 14, y: BAR + 8, w: 6, h: view.h - 16 }, scroll, view.h, contentHeight)
}

const TABS: ReadonlyArray<readonly [string, string]> = [['tab:systems', 'Системы'], ['tab:journal', 'Журнал'], ['tab:manual', 'Руководство']]
const TABS_WIDTH = 540

export const paintRight: DeskPainter = (ctx, width, height, s, ui, p) => {
  ctx.fillStyle = UI.desk
  ctx.fillRect(0, 0, width, height)
  paintBar(ctx, width, 'gauge', 'Корабль')
  const tabs = paintSegments(ctx, { x: width - TABS_WIDTH - SPACE.s, y: 6, w: TABS_WIDTH, h: BAR - 12 }, p, TABS, `tab:${ui.tab}`)
  if (ui.tab === 'systems') return [...tabs, ...paintSystems(ctx, width, height, s, p)]
  if (ui.tab === 'journal') {
    paintJournal(ctx, width, height, s, ui)
    return tabs
  }
  const contents = paintContents(ctx, height, ui, p)
  paintSection(ctx, width, height, ui, s)
  return [...tabs, ...contents]
}
