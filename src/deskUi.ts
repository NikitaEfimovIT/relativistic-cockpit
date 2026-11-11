// What the engineer's desk shows, apart from the simulation: which letter is open, the map's scale and pick, the tab
// and page of the right-hand screen. Its keys are regions the screens draw; a click finds the region under it.
import { MAP_SCALES, MAP_START } from './galaxyMap'
import { FAULTS_PAGE, MANUAL } from './manual'
import { readLetter, type SimState } from './sim'

export interface DeskUi {
  readonly letter: number | null // index into MESSAGES of the letter open on the mail screen; null: the newest
  readonly mapScale: number // index into MAP_SCALES
  readonly picked: number | null // index into TARGETS picked on the map
  readonly tab: 'systems' | 'journal' | 'manual'
  readonly page: number // index into MANUAL: the section open
  readonly mailScroll: number // letters scrolled past at the top of the list
  readonly manualScroll: number // canvas px of the open section scrolled past
  readonly journalScroll: number // entries of the log scrolled past at the top
}

export const INITIAL_DESK: DeskUi = { letter: null, mapScale: MAP_START, picked: null, tab: 'systems', page: 0, mailScroll: 0, manualScroll: 0, journalScroll: 0 }

export type DeskScreenName = 'mail' | 'map' | 'systems'

/** Which desk screen the pointer is over now, for the wheel: over a screen it scrolls that screen's list, not the view. */
export const deskPointer: { screen: DeskScreenName | null } = { screen: null }

/** How far each list can scroll, as its screen last laid it out: letters for the mail, canvas px for the manual, entries for the log. */
export const scrollLimits: { mail: number; manual: number; journal: number } = { mail: 0, manual: 0, journal: 0 }

/** A turn of the wheel over a screen: `steps` letters on the mail or entries of the log, px on the manual; within `limit`. */
export function scrollDesk(ui: DeskUi, screen: DeskScreenName | 'manual', steps: number, limit: number): DeskUi {
  const within = (v: number): number => Math.min(Math.max(0, limit), Math.max(0, v))
  if (screen === 'mail') return { ...ui, mailScroll: within(ui.mailScroll + steps) }
  if (screen === 'manual' || (screen === 'systems' && ui.tab === 'manual')) return { ...ui, manualScroll: within(ui.manualScroll + steps) }
  if (screen === 'systems' && ui.tab === 'journal') return { ...ui, journalScroll: within(ui.journalScroll + steps) }
  return ui
}

/** A key a screen has drawn, in canvas px; `at` resolves a click inside it to a key of its own (a star on the map). */
export interface Region {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly at?: (x: number, y: number) => string | null
}

/** The canvas pixel under a point of the screen's plane: three's uv runs up from the bottom, the canvas down from the top. */
export const uvToCanvas = (uv: { readonly x: number; readonly y: number }, width: number, height: number): readonly [number, number] =>
  [uv.x * width, (1 - uv.y) * height]

export function regionAt(regions: readonly Region[], x: number, y: number): string | null {
  const region = regions.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  if (!region) return null
  return region.at ? region.at(x, y) : region.id
}

const clampIndex = (i: number, length: number): number => Math.min(length - 1, Math.max(0, i))

/** What a key does to the desk and to the ship. The desk runs off the bus: dark, it answers nothing. */
export function pressDesk(ui: DeskUi, s: SimState, id: string): { readonly ui: DeskUi; readonly s: SimState } {
  if (!s.busOn) return { ui, s }
  const [screen, key, arg] = id.split(':')
  if (screen === 'mail') return { ui: { ...ui, letter: Number(key) }, s: readLetter(s, Number(key)) }
  if (id === 'map:in') return { ui: { ...ui, mapScale: clampIndex(ui.mapScale - 1, MAP_SCALES.length) }, s }
  if (id === 'map:out') return { ui: { ...ui, mapScale: clampIndex(ui.mapScale + 1, MAP_SCALES.length) }, s }
  if (screen === 'map' && key === 'pick') return { ui: { ...ui, picked: Number(arg) }, s }
  if (id === 'map:send') return { ui, s: ui.picked === null ? s : { ...s, targetCursor: ui.picked } }
  if (id === 'map:clear') return { ui: { ...ui, picked: null }, s }
  if (id === 'tab:systems' || id === 'tab:journal' || id === 'tab:manual') return { ui: { ...ui, tab: key as DeskUi['tab'] }, s }
  if (screen === 'fault') return { ui: { ...ui, tab: 'manual', page: FAULTS_PAGE, manualScroll: 0 }, s } // the open faults' procedures on top
  if (screen === 'manual') return { ui: { ...ui, page: clampIndex(Number(key), MANUAL.length), manualScroll: 0 }, s }
  return { ui, s }
}

let current = INITIAL_DESK

/** The single live desk, as sim.ts keeps the ship: immutable snapshots, replaced on every change. */
export const desk = {
  get: (): DeskUi => current,
  update: (change: (ui: DeskUi) => DeskUi): void => {
    current = change(current)
  },
}

const WHEEL_NOTCH = 100 // px of a wheel's deltaY to a notch: one letter of the mail
const MANUAL_PER_PX = 0.7 // canvas px of the manual a px of the wheel scrolls
let wheelLeft = 0

/** The wheel over a desk screen: the mail and the log by whole entries, the manual smoothly; the map has nothing to scroll. */
export function wheelDesk(deltaY: number): void {
  const screen = deskPointer.screen
  const isJournal = screen === 'systems' && desk.get().tab === 'journal'
  if (screen === 'systems' && !isJournal) {
    desk.update((ui) => scrollDesk(ui, 'systems', deltaY * MANUAL_PER_PX, scrollLimits.manual))
    return
  }
  if (screen !== 'mail' && !isJournal) return
  wheelLeft += deltaY
  const notches = Math.trunc(wheelLeft / WHEEL_NOTCH)
  if (notches === 0) return
  wheelLeft -= notches * WHEEL_NOTCH
  desk.update((ui) => scrollDesk(ui, screen, notches, isJournal ? scrollLimits.journal : scrollLimits.mail))
}
