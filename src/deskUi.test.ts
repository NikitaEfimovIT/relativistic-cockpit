import { describe, expect, test } from 'vitest'
import { INITIAL_DESK, pressDesk, regionAt, scrollDesk, uvToCanvas, type Region } from './deskUi'
import { FAULTS_PAGE } from './manual'
import { MAP_SCALES } from './galaxyMap'
import { initialSim, toggleBus } from './sim'
import { LAUNCH_TARGET } from './voyage'

const powered = toggleBus(initialSim())

describe('a click on a desk screen', () => {
  test('lands on the canvas pixel under it: uv runs up from the bottom, the canvas down from the top', () => {
    expect(uvToCanvas({ x: 0.25, y: 0.75 }, 900, 510)).toEqual([225, 127.5])
  })

  test('finds the region drawn there, or none', () => {
    const regions: readonly Region[] = [{ id: 'a', x: 0, y: 0, w: 100, h: 50 }, { id: 'b', x: 100, y: 0, w: 100, h: 50 }]

    expect(regionAt(regions, 150, 20)).toBe('b')
    expect(regionAt(regions, 150, 80)).toBeNull()
  })
})

describe('what the keys on the desk screens do', () => {
  test('opening a letter selects it and marks it read', () => {
    const { ui, s } = pressDesk(INITIAL_DESK, powered, 'mail:2')

    expect(ui.letter).toBe(2)
    expect(s.mailRead & (1 << 2)).not.toBe(0)
  })

  test('the map zooms in and out between its first and last scale', () => {
    let ui = INITIAL_DESK
    for (let i = 0; i < 20; i++) ui = pressDesk(ui, powered, 'map:in').ui
    expect(ui.mapScale).toBe(0)
    for (let i = 0; i < 20; i++) ui = pressDesk(ui, powered, 'map:out').ui
    expect(ui.mapScale).toBe(MAP_SCALES.length - 1)
  })

  test('a target picked on the map goes to the cockpit target screen, without turning the ship', () => {
    const picked = pressDesk(INITIAL_DESK, powered, 'map:pick:5')

    const { s } = pressDesk(picked.ui, picked.s, 'map:send')

    expect(picked.ui.picked).toBe(5)
    expect(s.targetCursor).toBe(5)
    expect(s.course.target).toBe(LAUNCH_TARGET)
  })

  test('the right-hand screen switches between the systems and the manual; the manual opens a section from its contents', () => {
    const manual = pressDesk(INITIAL_DESK, powered, 'tab:manual').ui
    const scrolled = scrollDesk({ ...manual, page: 2 }, 'manual', 3, 10)
    const opened = pressDesk(scrolled, powered, 'manual:4').ui

    expect(manual.tab).toBe('manual')
    expect(opened.page).toBe(4)
    expect(opened.manualScroll).toBe(0) // a section opens at its top
  })

  test('the log has a tab of its own, and scrolls by whole entries within its length', () => {
    const journal = pressDesk(INITIAL_DESK, powered, 'tab:journal').ui

    expect(journal.tab).toBe('journal')
    expect(scrollDesk(journal, 'systems', 7, 4).journalScroll).toBe(4)
    expect(scrollDesk(journal, 'systems', -2, 4).journalScroll).toBe(0)
  })

  test('a fault’s key opens the manual at the faults, from the top, where the open ones are', () => {
    const { ui } = pressDesk({ ...INITIAL_DESK, manualScroll: 300 }, powered, 'fault:vent')

    expect(ui).toMatchObject({ tab: 'manual', page: FAULTS_PAGE, manualScroll: 0 })
  })

  test('the card of a picked star closes', () => {
    const picked = pressDesk(INITIAL_DESK, powered, 'map:pick:5').ui

    expect(pressDesk(picked, powered, 'map:clear').ui.picked).toBeNull()
  })

  test('the wheel scrolls a list within its length, and only the list under the pointer', () => {
    const down = scrollDesk(INITIAL_DESK, 'mail', 4, 3)

    expect(down.mailScroll).toBe(3)
    expect(scrollDesk(down, 'mail', -10, 3).mailScroll).toBe(0)
    expect(scrollDesk(INITIAL_DESK, 'map', 4, 3)).toBe(INITIAL_DESK) // the map has no list
  })

  test('without the bus the screens are dark, and nothing on them answers', () => {
    const cold = initialSim()

    const { ui, s } = pressDesk(INITIAL_DESK, cold, 'mail:0')

    expect(ui).toBe(INITIAL_DESK)
    expect(s).toBe(cold)
  })
})
