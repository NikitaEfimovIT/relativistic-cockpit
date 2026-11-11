import { expect, test, type Page } from '@playwright/test'

const status = (page: Page) => page.getByRole('status')

const speedOf = async (page: Page): Promise<number> => {
  const text = (await status(page).textContent()) ?? ''
  return Number(text.match(/Скорость ([\d.]+)/)?.[1] ?? Number.NaN)
}

const open = async (page: Page, path = '/'): Promise<readonly string[]> => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  // the app flies without faults unless the path asks for them (?seed=, ?faults=on): one would hold a fast clock at any moment
  await page.goto(path)
  await expect(status(page)).toContainText('Скорость')
  await expect(page.locator('body[data-cockpit="ready"]')).toBeAttached({ timeout: 15_000 }) // the cockpit model is in
  return errors
}

test('starts at rest with every system off and no errors', async ({ page }) => {
  const errors = await open(page)
  await expect(status(page)).toContainText('Скорость 0.0000 % c')
  await expect(status(page)).toContainText('двигатель выключен')
  await expect(status(page)).toContainText('щит выключен')
  expect(errors).toEqual([])
})

/** A light year out along the course: night, and far enough from both ends of the leg for the clock to run fast. */
const DEEP_SPACE = '/?x=1'

/** The first two steps of a cold start: the bus, then the engine's arming switch (the light mode is on out here). */
const startUp = async (page: Page): Promise<void> => {
  await page.keyboard.press('p')
  await page.keyboard.press('u')
}

/** The pilot's clock turned all the way up, to a year a second: it starts at a minute. */
const fastestClock = async (page: Page): Promise<void> => {
  for (let i = 0; i < 8; i++) await page.keyboard.press('Equal')
  await expect(status(page)).toContainText('часы на ×31557600')
}

test('the lever does nothing until the engine runs, then accelerates and brakes to a stop', async ({ page }) => {
  await open(page, DEEP_SPACE)
  await startUp(page)
  await page.keyboard.press('o')
  await fastestClock(page)
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(1500)
  expect(await speedOf(page)).toBe(0)

  await page.keyboard.press('i')
  await expect.poll(() => speedOf(page), { timeout: 60_000 }).toBeGreaterThan(30)
  await expect(status(page)).toContainText('экипаж в норме')

  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowDown')
  await expect(status(page)).toContainText('тяга -1.00')
  await expect.poll(() => speedOf(page), { timeout: 60_000 }).toBe(0)
})

test('dropping the shield above 0.3 c kills the crew', async ({ page }) => {
  await open(page, '/?beta=0.6')
  await expect(status(page)).toContainText('щит включён')
  await expect(status(page)).toContainText('экипаж в норме')
  await page.keyboard.press('o')
  await expect(status(page)).toContainText('экипаж погиб')
})

test('a jump to the speed limit reads 99.9999 % and never 100 %', async ({ page }) => {
  await open(page, '/?beta=0.999999')
  await expect(status(page)).toContainText('Скорость 99.9999 % c')
})

test('an out-of-range jump parameter is ignored', async ({ page }) => {
  await open(page, '/?beta=7')
  await expect(status(page)).toContainText('Скорость 0.0000 % c')
})

test('the wheel zooms and reports the magnification', async ({ page }) => {
  await open(page)
  await page.mouse.move(500, 200)
  await page.mouse.wheel(0, -800)
  await expect(page.getByText(/зум ×/)).toBeVisible()
})

// Fixed coordinates for the 1000×640 viewport in playwright.config.ts: the controls live in the WebGL scene. They were
// found by projecting the mounts of public/cockpit.glb through the app's camera, after the head turns below.
const LOOK_LEFT = { dx: -540, dy: 120 } // hard left, as far as the neck turns, and down at the left console
const LOOK_RIGHT = { dx: 420, dy: 150 } // right and down at the right console, the target keys and the wall
const BUS_SWITCH = { x: 377, y: 548 } // looking ahead: the row under the centre screen
const ARM_SWITCH = { x: 429, y: 548 }
const ENGINE_TOGGLE = { x: 481, y: 550 }
const LIGHT_SWITCH = { x: 517, y: 266 } // looking left
const LEVER_KNOB = { x: 484, y: 314 } // looking right: the top of the thrust sled
const NAV_BREAKER = { x: 551, y: 224 } // on the wall beyond the sled
const RADIO_BREAKER = { x: 575, y: 228 }
const SHUTTER_SWITCH = { x: 688, y: 247 }
const TARGET_DOWN = { x: 445, y: 287 } // looking right: the keys beside the target screen, under the radiation screen
const TARGET_SELECT = { x: 442, y: 274 }
const SHIELD_SWITCH = { x: 542, y: 547 } // looking ahead: in the row, right of the engine's start
const CLOCK_FASTER = { x: 618, y: 466 } // looking ahead: the clock's keys, right of the time screen
const CLOCK_SLOWER = { x: 619, y: 482 }

/** Turns the head as the pilot does, by dragging the view from a point clear of the controls. */
const turnHead = async (page: Page, { dx, dy }: { readonly dx: number; readonly dy: number }): Promise<void> => {
  const [x, y] = [500 - dx / 2, 60]
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)
}

test('the cockpit controls answer to the mouse', async ({ page }) => {
  await open(page, DEEP_SPACE)
  await page.mouse.click(BUS_SWITCH.x, BUS_SWITCH.y)
  await expect(status(page)).toContainText('шина включена')
  await page.mouse.click(ARM_SWITCH.x, ARM_SWITCH.y)
  await expect(status(page)).toContainText('двигатель взведён')
  await page.mouse.click(ENGINE_TOGGLE.x, ENGINE_TOGGLE.y)
  await expect(status(page)).toContainText('двигатель включён')
  await page.mouse.click(CLOCK_SLOWER.x, CLOCK_SLOWER.y)
  await expect(status(page)).toContainText('часы на ×10,')
  for (let i = 0; i < 7; i++) await page.mouse.click(CLOCK_FASTER.x, CLOCK_FASTER.y)
  await expect(status(page)).toContainText('часы на ×31557600')

  await page.mouse.click(SHIELD_SWITCH.x, SHIELD_SWITCH.y)
  await expect(status(page)).toContainText('щит включён')

  await turnHead(page, LOOK_RIGHT)
  await page.mouse.move(LEVER_KNOB.x, LEVER_KNOB.y)
  await page.mouse.down()
  await page.mouse.move(LEVER_KNOB.x, LEVER_KNOB.y - 300, { steps: 8 })
  await page.mouse.up()
  await expect(status(page)).toContainText('тяга 1.00')
  await expect.poll(() => speedOf(page), { timeout: 30_000 }).toBeGreaterThan(5)
})

const throttleOf = async (page: Page): Promise<number> => {
  await page.waitForTimeout(700) // the status line refreshes every 500 ms
  const text = (await status(page).textContent()) ?? ''
  return Number(text.match(/тяга (-?[\d.]+)/)?.[1] ?? Number.NaN)
}

test('zooming and resizing do not leak GPU buffers', async ({ page }) => {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype
    const create = proto.createBuffer
    proto.createBuffer = function createBufferCounted() {
      document.documentElement.dataset.buffers = String(Number(document.documentElement.dataset.buffers ?? 0) + 1)
      return create.call(this)
    }
  })
  const bufferCount = () => page.evaluate(() => Number(document.documentElement.dataset.buffers))
  await open(page)
  await page.waitForTimeout(1000)
  const before = await bufferCount()

  await page.mouse.move(500, 200)
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -100)
  await page.setViewportSize({ width: 900, height: 600 })
  await page.setViewportSize({ width: 1000, height: 640 })
  await page.waitForTimeout(500)

  expect((await bufferCount()) - before).toBeLessThan(10)
})

test('browser shortcuts and key auto-repeat do not flip systems', async ({ page }) => {
  await open(page, '/?beta=0.6')
  await page.keyboard.press('Control+o')
  await page.keyboard.press('Meta+o')
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', repeat: true })))
  await page.waitForTimeout(800)
  await expect(status(page)).toContainText('щит включён')
  await expect(status(page)).toContainText('экипаж в норме')
})

test('Shift+↓ throws the lever to full braking at once, and ↑ still steps it back', async ({ page }) => {
  await open(page, '/?beta=0.6')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(status(page)).toContainText('тяга -1.00')
  await page.keyboard.press('ArrowUp')
  await expect(status(page)).toContainText('тяга -0.95')
})

test('a lost pointerup does not leave the lever attached to the cursor', async ({ page }) => {
  await open(page)
  await turnHead(page, LOOK_RIGHT)
  await page.mouse.move(LEVER_KNOB.x, LEVER_KNOB.y)
  await page.mouse.down()
  await page.mouse.move(LEVER_KNOB.x, LEVER_KNOB.y - 60, { steps: 4 })
  const whileHeld = await throttleOf(page)
  expect(whileHeld).toBeGreaterThan(0.1)

  // This is what a context menu or a window switch in mid-drag leaves behind.
  await page.evaluate(() => window.addEventListener('pointerup', (e) => e.stopImmediatePropagation(), { capture: true, once: true }))
  await page.mouse.up()
  await page.mouse.move(LEVER_KNOB.x, LEVER_KNOB.y - 160, { steps: 4 })

  expect(await throttleOf(page)).toBe(whileHeld)
})

test('only the primary button grabs the lever', async ({ page }) => {
  await open(page)
  await turnHead(page, LOOK_RIGHT)
  await page.mouse.move(LEVER_KNOB.x, LEVER_KNOB.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(LEVER_KNOB.x, LEVER_KNOB.y - 100, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  expect(await throttleOf(page)).toBe(0)
})


test('the flight starts by the Earth, aimed at α Centauri A', async ({ page }) => {
  await open(page)
  await expect(status(page)).toContainText('цель α Центавра A')
})

test('the target screen steps through the stars, and ВЫБРАТЬ turns the ship to the one lit', async ({ page }) => {
  await open(page)
  await page.keyboard.press('p') // the navigation computer draws from the bus
  await turnHead(page, LOOK_RIGHT)
  await page.mouse.click(TARGET_DOWN.x, TARGET_DOWN.y)
  await expect(status(page)).toContainText('цель α Центавра A, на экране α Центавра B') // lit, the ship not turned yet
  await page.mouse.click(TARGET_SELECT.x, TARGET_SELECT.y)
  await expect(status(page)).toContainText('цель α Центавра B, разворот')
  await expect(status(page)).not.toContainText('разворот', { timeout: 10_000 })

  await page.keyboard.press('t')
  await expect(status(page)).toContainText('на экране Звезда Барнарда')
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('цель Звезда Барнарда, разворот')

  await page.keyboard.press('Shift+T')
  await expect(status(page)).toContainText('на экране α Центавра B')
})

test('under way the target screen cannot turn the ship', async ({ page }) => {
  await open(page, '/?beta=0.6')
  await page.keyboard.press('t')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  await expect(status(page)).toContainText('цель α Центавра A, на экране α Центавра B')
})

const NEAR_DISC = { x: 540, y: 252 } // about 3° from straight ahead, at rest pitch

test('the cabin lights answer to their key and their switch', async ({ page }) => {
  await open(page)
  await expect(status(page)).toContainText('свет в кабине выключен')

  await page.keyboard.press('l')
  await expect(status(page)).toContainText('свет в кабине включён')

  await turnHead(page, LOOK_LEFT)
  await page.mouse.click(LIGHT_SWITCH.x, LIGHT_SWITCH.y)
  await expect(status(page)).toContainText('свет в кабине выключен')
})

/** Mean difference of two screenshots per colour channel, out of 255. */
const frameDifference = (page: Page, a: Buffer, b: Buffer): Promise<number> => page.evaluate(async ([first, second]) => {
  const pixels = async (base64: string): Promise<Uint8ClampedArray> => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable')
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data
  }
  const [p, q] = [await pixels(first), await pixels(second)]
  return p.reduce((sum, value, i) => sum + Math.abs(value - q[i]), 0) / p.length
}, [a.toString('base64'), b.toString('base64')] as const)

test('dragging the lever does not turn the head, and dragging the sky does', async ({ page }) => {
  await open(page, DEEP_SPACE) // at launch the turning Earth would keep the frame from ever going still
  await turnHead(page, LOOK_RIGHT)
  const sky = { clip: { x: 0, y: 0, width: 1000, height: 160 } }
  // The Milky Way is baked over a few frames and fades in, so wait until the frame stops changing. The glass
  // reflects the running clocks, which is why this is a tolerance and not an exact match.
  const STILL = 0.25
  let before = await page.screenshot(sky)
  await expect(async () => {
    await page.waitForTimeout(400)
    const frame = await page.screenshot(sky)
    const change = await frameDifference(page, frame, before)
    before = frame
    expect(change).toBeLessThan(STILL)
  }).toPass({ timeout: 15_000 })

  await page.mouse.move(LEVER_KNOB.x, LEVER_KNOB.y)
  await page.mouse.down()
  await page.mouse.move(LEVER_KNOB.x, LEVER_KNOB.y - 100, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.press('x')
  await page.waitForTimeout(300)
  const frameAfterLever = await page.screenshot(sky)
  expect(await frameDifference(page, frameAfterLever, before)).toBeLessThan(STILL) // engine off, so the ship has not moved either

  await page.mouse.move(500, 60)
  await page.mouse.down()
  await page.mouse.move(400, 60, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const frameAfterLook = await page.screenshot(sky)
  expect(await frameDifference(page, frameAfterLook, before)).toBeGreaterThan(4 * STILL)
})

test('the cabin wakes when the bus is switched on, and turning the lights on dims the stars', async ({ page }) => {
  await open(page, DEEP_SPACE) // by the Earth the sunlit cabin has already stopped the eye down
  await expect(status(page)).toContainText('питание нет')
  const panel = { clip: { x: 100, y: 330, width: 800, height: 240 } }
  const sky = { clip: { x: 300, y: 120, width: 400, height: 150 } }
  await page.waitForTimeout(2500) // the Milky Way has baked and faded in
  const coldPanel = await page.screenshot(panel)

  await page.keyboard.press('p')
  await expect(status(page)).toContainText('питание подано', { timeout: 8000 })
  await page.waitForTimeout(600)
  const litPanel = await page.screenshot(panel)
  expect(await frameDifference(page, coldPanel, litPanel)).toBeGreaterThan(8)

  const darkSky = await page.screenshot(sky)
  await page.keyboard.press('l')
  await page.waitForTimeout(1200)
  const stoppedDownSky = await page.screenshot(sky)
  expect(await frameDifference(page, darkSky, stoppedDownSky)).toBeGreaterThan(1)
})

/** Red, green and blue of a screenshot at one point. */
const pixelAt = (page: Page, shot: Buffer, x: number, y: number): Promise<readonly number[]> => page.evaluate(async ([base64, px, py]) => {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable')
  context.drawImage(bitmap, 0, 0)
  return Array.from(context.getImageData(px as number, py as number, 1, 1).data).slice(0, 3)
}, [shot.toString('base64'), x, y] as const)

test('the overhead switches answer to their keys', async ({ page }) => {
  await open(page)
  await expect(status(page)).toContainText('индикаторы включены')
  await page.keyboard.press('h')
  await expect(status(page)).toContainText('индикаторы выключены')
  await page.keyboard.press('f')
  await expect(status(page)).toContainText('тонировка включена')
  await page.keyboard.press('n')
  await expect(status(page)).toContainText('приборы приглушены')
})

test('a wall switch can be reached and pressed by turning the head', async ({ page }) => {
  await open(page)
  await turnHead(page, LOOK_RIGHT)

  await page.mouse.click(SHUTTER_SWITCH.x, SHUTTER_SWITCH.y)
  await expect(status(page)).toContainText('шторки движутся')

  await page.mouse.click(RADIO_BREAKER.x, RADIO_BREAKER.y)
  await expect(status(page)).toContainText('связь выкл')

  await page.mouse.click(NAV_BREAKER.x, NAV_BREAKER.y) // the thrust lever no longer stands in front of it
  await expect(status(page)).toContainText('навигация выкл')
})

test('the shutters close off the sky, and open again to the same view', async ({ page }) => {
  await open(page, DEEP_SPACE) // at launch the eye is set for the sunlit cabin, and the sky is black open or shut
  const sky = { clip: { x: 300, y: 120, width: 400, height: 150 } }
  await page.waitForTimeout(6000) // the Milky Way is baked and fades in
  await page.keyboard.press('h')
  await page.waitForTimeout(400)
  const open_ = await page.screenshot(sky)

  await page.keyboard.press('b')
  await expect(status(page)).toContainText('шторки закрыты', { timeout: 6000 })
  const closed = await page.screenshot(sky)
  expect(await frameDifference(page, open_, closed)).toBeGreaterThan(2)

  await page.keyboard.press('b')
  await expect(status(page)).toContainText('шторки открыты', { timeout: 6000 })
  await page.waitForTimeout(300)
  expect(await frameDifference(page, open_, await page.screenshot(sky))).toBeLessThan(0.5)
})

test('the tinted glass takes away the glare around the blueshifted disc', async ({ page }) => {
  await open(page, '/?beta=0.999999')
  await page.keyboard.press('h') // nothing but the glow of the disc near the course
  await page.waitForTimeout(3000)
  const clear = await pixelAt(page, await page.screenshot(), NEAR_DISC.x, NEAR_DISC.y)
  expect(Math.max(...clear)).toBeGreaterThan(90)

  await page.keyboard.press('f')
  await page.waitForTimeout(2500)
  const tinted = await pixelAt(page, await page.screenshot(), NEAR_DISC.x, NEAR_DISC.y)
  expect(Math.max(...tinted)).toBeLessThan(25)
  await page.waitForTimeout(5000) // the eye does not get used to the tint
  expect(Math.max(...await pixelAt(page, await page.screenshot(), NEAR_DISC.x, NEAR_DISC.y))).toBeLessThan(25)
})

/** Mean brightness of the upper half of a shot, 0–255: the sky through the canopy, and any glare in it. */
const skyBrightness = (page: Page, shot: Buffer): Promise<number> => page.evaluate(async (base64) => {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable')
  context.drawImage(bitmap, 0, 0)
  const data = context.getImageData(0, 0, bitmap.width, Math.floor(bitmap.height / 2)).data
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  return sum / (data.length / 4)
}, shot.toString('base64'))

test('facing the Sun, the tint takes its glare away and keeps it away for as long as it is on', async ({ page }) => {
  // Arrange: turned round to face the Sun, with nothing on the glass
  await open(page)
  await page.keyboard.press('p') // the target screen draws from the bus
  for (let i = 0; i < 13; i++) await page.keyboard.press('Shift+T') // up past Proxima and its two planets, then the Sun's nine
  await expect(status(page)).toContainText('на экране Солнце')
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('разворот')
  await expect(status(page)).not.toContainText('разворот', { timeout: 30_000 })
  await page.keyboard.press('h')
  await page.waitForTimeout(3000)
  const clear = await skyBrightness(page, await page.screenshot())

  // Act
  await page.keyboard.press('f')
  await page.waitForTimeout(1500)
  const tinted = await skyBrightness(page, await page.screenshot())
  await page.waitForTimeout(6000) // well past the eye's 1.5 s of dark adaptation, which used to bring the glare back
  const later = await skyBrightness(page, await page.screenshot())

  // Assert
  expect(tinted).toBeLessThan(0.4 * clear)
  expect(later).toBeLessThan(1.2 * tinted + 1)
})

/** Pixels in a square round the centre of a shot, `half` px each way, brighter than `level` (channel mean, 0–255). */
const litPixels = (page: Page, shot: Buffer, half: number, level: number): Promise<number> => page.evaluate(async ({ base64, half, level }) => {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
  if (!context) throw new Error('2D canvas is unavailable')
  context.drawImage(bitmap, 0, 0)
  const data = context.getImageData(bitmap.width / 2 - half, bitmap.height / 2 - half, 2 * half, 2 * half).data
  let count = 0
  for (let i = 0; i < data.length; i += 4) if ((data[i] + data[i + 1] + data[i + 2]) / 3 > level) count++
  return count
}, { base64: shot.toString('base64'), half, level })

// Aimed at 61 Cygni A at launch, the Moon is 48° to the right and 16° up. Seated it is behind the right front pillar;
// standing behind the seat, the eye higher and further aft, sees it in clear glass (ray-cast in blender/cockpit.blend).
// Seated, zoom takes off the resting tilt; standing keeps it, so the head is raised by about as much: 60 px, set
// by eye on the zoomed frame (64 px of tilt left the disc half a degree low).
const MOON_LOOK = { dx: 337, dy: -172 }

test('by the Earth, zoomed in where Horizons puts the Moon, there is a sunlit crescent', async ({ page }) => {
  // Arrange: aimed at 61 Cygni A, which puts the Moon in the right-hand glass
  await open(page)
  await page.keyboard.press('p') // the target screen draws from the bus
  for (let i = 0; i < 14; i++) await page.keyboard.press('t') // the stars down to it, and the planets after Barnard's, Lalande's and ε Eridani
  await expect(status(page)).toContainText('на экране 61 Лебедя A')
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('разворот')
  await expect(status(page)).not.toContainText('разворот', { timeout: 30_000 })

  // Act: the head onto the Moon, up out of the seat (the gaze stays where it was), then twenty times closer
  await page.mouse.move(500, 300) // low enough that the drag up stays on the page
  await page.mouse.down()
  await page.mouse.move(500 + MOON_LOOK.dx, 300 + MOON_LOOK.dy, { steps: 20 })
  await page.mouse.up()
  await page.keyboard.press('Space')
  await expect(status(page)).toContainText('место: на ногах')
  await page.evaluate(() => document.exitPointerLock()) // standing takes the mouse, and moving it would turn the head
  await page.waitForFunction(() => document.pointerLockElement === null)
  await page.mouse.move(500, 320)
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -100)
  await expect(page.getByText('зум ×20')).toBeVisible()
  await page.waitForTimeout(3000)

  // Assert: the disc, 31′ across, is about 75 px here; 30 % of it lit is well under half of its 4400 px
  const lit = await litPixels(page, await page.screenshot(), 80, 60)
  expect(lit).toBeGreaterThan(300)
  expect(lit).toBeLessThan(2200)
})

test('the Moon can be picked on the target screen: the ship turns to it, and zoomed in it is dead ahead', async ({ page }) => {
  // Arrange
  await open(page)
  await page.keyboard.press('p') // the target screen draws from the bus
  for (let i = 0; i < 9; i++) await page.keyboard.press('Shift+T') // up past Proxima and its two planets, then Neptune to Mars
  await expect(status(page)).toContainText('на экране Луна')

  // Act: turned onto it, nothing on the glass, twenty times closer, no turn of the head
  await page.keyboard.press('Enter')
  await expect(status(page)).toContainText('цель Луна, разворот')
  await expect(status(page)).not.toContainText('разворот', { timeout: 30_000 })
  await page.keyboard.press('h')
  await page.mouse.move(500, 320)
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -100)
  await expect(page.getByText('зум ×20')).toBeVisible()
  await page.waitForTimeout(3000)

  // Assert: the crescent of the test above, within the head's resting tilt (0.16 rad over the zoom, about a disc) of the centre
  const lit = await litPixels(page, await page.screenshot(), 130, 60)
  expect(lit).toBeGreaterThan(300)
  expect(lit).toBeLessThan(2200)
})

test('a chime calls for braking past the brake point, until the lever goes back', async ({ page }) => {
  // Counts the chime's first tone as the page builds it; there is no other way to hear a headless page.
  await page.addInitScript(() => {
    const tones: OscillatorNode[] = []
    Object.assign(window, { chimes: () => tones.filter((o) => o.type === 'triangle' && o.frequency.value === 988).length })
    const create = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      const tone = create.call(this)
      tones.push(tone)
      return tone
    }
  })
  const chimes = () => page.evaluate(() => (window as unknown as { chimes: () => number }).chimes())
  // 0.9 c, 3.5 ly out: α Cen A is 0.9 ly ahead, and 1 g needs 1.25 ly to stop
  await open(page, '/?beta=0.9&x=3.5')
  await page.mouse.click(500, 150) // sound starts with the first gesture
  await expect.poll(chimes, { timeout: 5000 }).toBeGreaterThanOrEqual(2)

  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('i')
  await expect(status(page)).toContainText('тяга -1.00')
  await page.waitForTimeout(500) // the engine starts to spool
  const whenBraking = await chimes()
  await page.waitForTimeout(3000)
  expect(await chimes()).toBe(whenBraking)
})

test('a toggle clicks once, a key by a screen sounds going down and again coming up, by keyboard or by mouse', async ({ page }) => {
  // Counts the short sounds the page starts: the controls' clicks, not the cabin's loops of noise, which are seconds long
  await page.addInitScript(() => {
    let clicks = 0
    Object.assign(window, { clicks: () => clicks })
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) {
      if ((this.buffer?.duration ?? Infinity) < 0.5) clicks++
      return start.apply(this, args)
    }
  })
  const clicks = () => page.evaluate(() => (window as unknown as { clicks: () => number }).clicks())
  await open(page)

  await page.keyboard.press('h') // the indicators' toggle
  await expect.poll(clicks).toBe(1)
  await page.keyboard.down('t') // ▼ beside the target screen, held
  await expect.poll(clicks).toBe(2)
  await page.keyboard.up('t')
  await expect.poll(clicks).toBe(3)

  await turnHead(page, LOOK_RIGHT)
  await page.mouse.move(TARGET_DOWN.x, TARGET_DOWN.y)
  await page.mouse.down()
  await expect.poll(clicks).toBe(4)
  await page.mouse.up()
  await expect.poll(clicks).toBe(5)
  await page.waitForTimeout(500)
  expect(await clicks()).toBe(5) // and nothing after: each sounded once
})

test('the shield has a toggle like the other systems: it clicks once, as it flips, not going down and coming up', async ({ page }) => {
  await page.addInitScript(() => {
    let clicks = 0
    Object.assign(window, { clicks: () => clicks })
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) {
      if ((this.buffer?.duration ?? Infinity) < 0.5) clicks++
      return start.apply(this, args)
    }
  })
  const clicks = () => page.evaluate(() => (window as unknown as { clicks: () => number }).clicks())
  await open(page)
  await page.mouse.click(500, 150) // sound starts with the first gesture
  const before = await clicks()

  await page.mouse.move(SHIELD_SWITCH.x, SHIELD_SWITCH.y)
  await page.mouse.down()
  await page.waitForTimeout(300)
  expect(await clicks()).toBe(before) // a toggle does not sound under the finger before it flips
  await page.mouse.up()
  await expect(status(page)).toContainText('щит включён')
  await expect.poll(clicks).toBe(before + 1)
})

test('once the recordings of real controls have loaded, a toggle plays one of them', async ({ page }) => {
  // Notes every buffer the page decodes, which are the recordings, and whether each short sound it starts is one of them
  await page.addInitScript(() => {
    const decoded = new Set<AudioBuffer>()
    const played: boolean[] = []
    Object.assign(window, { decodedTakes: () => decoded.size, lastWasTake: () => played[played.length - 1] })
    const decode = BaseAudioContext.prototype.decodeAudioData
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, data: ArrayBuffer) {
      return decode.call(this, data).then((buffer) => {
        decoded.add(buffer)
        return buffer
      })
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) {
      if ((this.buffer?.duration ?? Infinity) < 0.5) played.push(this.buffer !== null && decoded.has(this.buffer))
      return start.apply(this, args)
    }
  })
  const decodedTakes = () => page.evaluate(() => (window as unknown as { decodedTakes: () => number }).decodedTakes())
  const lastWasTake = () => page.evaluate(() => (window as unknown as { lastWasTake: () => boolean | undefined }).lastWasTake())
  const errors = await open(page)

  await page.keyboard.press('h') // the first touch starts the sound, and with it the loading
  await expect.poll(decodedTakes).toBe(14) // every take in RECORDINGS
  await page.keyboard.press('h')
  await expect.poll(lastWasTake).toBe(true)
  expect(errors).toEqual([])
})

test('the Earth is heard at launch, and lost at six nines', async ({ page }) => {
  await open(page)
  await page.keyboard.press('p') // a cold radio hears nothing
  await expect(status(page)).toContainText('связь с Землёй есть')
  await expect.poll(async () => Number((await status(page).textContent())?.match(/принято сообщений (\d+)/)?.[1]), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2)

  await open(page, '/?beta=0.999999')
  await expect(status(page)).toContainText('связь с Землёй потеряна')
})

test('a cold start goes bus, arming, engine: the start switch alone only lights a caution', async ({ page }) => {
  await open(page, DEEP_SPACE)
  await page.keyboard.press('i')
  await expect(status(page)).toContainText('двигатель включён, не работает')
  await expect(status(page)).toContainText('табло: пусто') // a cold panel shows nothing

  await page.keyboard.press('p')
  await expect(status(page)).toContainText(/табло: (CO₂, )?НЕ ВЗВЕДЁН/) // CO₂ may still be clearing after the cold wait
  await expect(status(page)).toContainText('главная авария внимание')
  await page.keyboard.press('m')
  await expect(status(page)).toContainText('главная авария не горит')

  await page.keyboard.press('u')
  await expect(status(page)).toContainText('табло: пусто')
  await expect(status(page)).not.toContainText('не работает')
})

const co2Of = async (page: Page): Promise<number> =>
  Number(((await status(page).textContent()) ?? '').match(/CO₂ ([\d.]+) мм/)?.[1] ?? Number.NaN)

test('with the fans off the breath gathers at the face, and the clock slows until they are back on', async ({ page }) => {
  await open(page, DEEP_SPACE)
  await startUp(page)
  await fastestClock(page)
  await expect.poll(() => co2Of(page)).toBeLessThan(3)

  await page.keyboard.press('v')
  await expect.poll(() => co2Of(page)).toBeGreaterThan(3)
  await expect(status(page)).toContainText(/ускорение времени ×300,/)
  await expect(status(page)).toContainText('главная авария внимание')

  await page.keyboard.press('v')
  await expect.poll(() => co2Of(page)).toBeLessThan(3)
  await expect(status(page)).not.toContainText(/ускорение времени ×300,/)
})

/** On foot a press on the view takes the mouse; let it go first, so the drag that follows turns the head by exactly what it moves. */
const MAX_DRAG = 900 // px: a longer drag would start off the 1000 px window, so a long turn is made in pieces

/** Turns the head on foot by dragging; each press takes the pointer lock again, so it is let go before every piece. */
const turnOnFoot = async (page: Page, dx: number, dy: number): Promise<void> => {
  const pieces = Math.ceil(Math.abs(dx) / MAX_DRAG) || 1
  for (let i = 0; i < pieces; i++) {
    await page.evaluate(() => document.exitPointerLock())
    await page.waitForFunction(() => document.pointerLockElement === null)
    await turnHead(page, { dx: dx / pieces, dy: i === 0 ? dy : 0 })
  }
}

const STANDING_EYE = 0.4 // m: 1.62 m over the deck, which is 1.22 m under the seated eye
const RAD_PER_PX = 0.0025 // as App.tsx turns the head
const RESTING_PITCH = -0.16 // standing up keeps the seated gaze, which has this tilt

/** Where the status line puts the body, x and z. */
const spotOf = async (page: Page): Promise<readonly [number, number]> => {
  const match = ((await status(page).textContent()) ?? '').match(/на ногах \(x (-?[\d.]+) z (-?[\d.]+)\)/)
  return match ? [Number(match[1]), Number(match[2])] : [Number.NaN, Number.NaN]
}

/** Walks with `key` held until the body is aft of `z`; the status line is half a second behind, so it overshoots a little. */
const walkAftPast = async (page: Page, key: string, z: number): Promise<void> => {
  await page.keyboard.down(key)
  await expect.poll(async () => (await spotOf(page))[1], { timeout: 15_000, intervals: [50] }).toBeGreaterThan(z)
  await page.keyboard.up(key)
  await page.waitForTimeout(700) // for the status line to show where it stopped
}

/**
 * Turns the standing head from where it was on standing up (facing `yaw`, tilted by the resting pitch) onto a point,
 * from wherever the walk ended: the walk is timed by the status line and does not stop at a fixed place.
 */
const aimOnFoot = async (
  page: Page, yaw: number, [x, y, z]: readonly [number, number, number], pitch = RESTING_PITCH,
): Promise<readonly [number, number]> => {
  const [bx, bz] = await spotOf(page)
  const [dx, dy, dz] = [x - bx, y - STANDING_EYE, z - bz]
  const towards = Math.atan2(-dx, -dz)
  const turn = towards - yaw
  const wrapped = Math.atan2(Math.sin(turn), Math.cos(turn))
  const up = Math.atan2(dy, Math.hypot(dx, dz))
  await turnOnFoot(page, -wrapped / RAD_PER_PX, -(up - pitch) / RAD_PER_PX)
  return [towards, up]
}

const CHAIR = [-0.45, -0.72, 3.2] as const // the desk chair's seat, in the middle of its target
const DRAWER = [0.48, -1.0, 7.2] as const // the face of the middle drawer under the bed

/** Out of the pilot seat, backwards (the stern is behind it) through the doorway, then onto the chair at the desk. */
const walkToDesk = async (page: Page): Promise<void> => {
  await page.keyboard.press('Space')
  await expect(status(page)).toContainText('место: на ногах (x 0.00 z 0.62)')
  await walkAftPast(page, 's', 3.9)
  await aimOnFoot(page, 0, CHAIR)
  await expect(page.locator('.prompt')).toHaveText('E — сесть')
  await page.keyboard.press('e')
  await expect(status(page)).toContainText('место: за инженерным столом')
}

test('the pilot stands up, walks aft through the doorway and sits at the desk, where the cockpit keys are out of reach', async ({ page }) => {
  const errors = await open(page)
  await expect(status(page)).toContainText('место: в кресле пилота')

  await walkToDesk(page)

  await expect(page.locator('.reticle')).toBeHidden()
  await page.keyboard.press('p') // the bus switch is in the cockpit
  await expect(status(page)).toContainText('шина выключена')
  expect(errors).toEqual([])
})

test('from the desk the engineer stands up, walks aft to the bed, looks at a drawer under it and pulls it out', async ({ page }) => {
  await open(page)
  await walkToDesk(page)

  await page.keyboard.press('Space')
  await expect(status(page)).toContainText('место: на ногах (x 0.10 z 3.20)')
  await walkAftPast(page, 'a', 6.0) // facing the desk on the port wall, aft is to the left
  await aimOnFoot(page, Math.PI / 2, DRAWER)
  await expect(page.locator('.prompt')).toHaveText('E — выдвинуть')
  await page.keyboard.press('e')

  await expect(status(page)).toContainText('выдвинуты ящики: drawer_bed_2')
  await page.evaluate(() => document.exitPointerLock())
})

// The desk's screens from the chair at a 1000×640 view, found by projecting canvas points of public/cockpit.glb's
// scr_desk_* mounts through the app's camera (the head at rest; for the mail, turned left by LOOK_AT_MAIL).
const SIRIUS_ON_MAP = { x: 565, y: 456 } // at the map's starting scale, 10 ly to its top edge
const SEND_TO_TARGET = { x: 594, y: 463 } // «На экран ЦЕЛЬ» on the card a picked star opens along the map's bottom
const LOOK_AT_MAIL = { dx: -220, dy: 0 } // the mail is on the left-hand screen
const SECOND_LETTER = { x: 317, y: 362 } // the second letter of the inbox, newest first
const LOOK_AT_SYSTEMS = { dx: 440, dy: 0 } // from the mail across to the right-hand screen
const MANUAL_TAB = { x: 707, y: 294 } // «Руководство», the third of the tabs in its bar
const POWER_SECTION = { x: 498, y: 416 } // «Питание», the seventh line of the manual's contents, ten lines close up

test('at the desk the engineer picks a star on the map for the cockpit target screen, and opens a letter', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('p') // the desk runs off the bus
  await walkToDesk(page)
  await expect(status(page)).toContainText(/принято сообщений [2-9]/)
  await page.waitForTimeout(500) // the screens repaint eight times a second

  await page.mouse.click(SIRIUS_ON_MAP.x, SIRIUS_ON_MAP.y)
  await expect(status(page)).toContainText('на карте Сириус')
  await page.mouse.click(SEND_TO_TARGET.x, SEND_TO_TARGET.y)
  await expect(status(page)).toContainText('цель α Центавра A, на экране Сириус') // lit there; the ship not turned

  await turnHead(page, LOOK_AT_MAIL)
  await page.mouse.click(SECOND_LETTER.x, SECOND_LETTER.y)
  await expect(status(page)).toContainText('прочитано писем 1')

  await turnHead(page, LOOK_AT_SYSTEMS)
  await page.mouse.click(MANUAL_TAB.x, MANUAL_TAB.y)
  await expect(status(page)).toContainText('стол: руководство, страница 1')
  await page.mouse.click(POWER_SECTION.x, POWER_SECTION.y)
  await expect(status(page)).toContainText('стол: руководство, страница 7')
  expect(errors).toEqual([])
})

// The middles of gaze boxes on the life-support console in the engineering bay, from src/cockpitLayout.ts
const HEATER_1 = [1.034, -0.25, 3.4] as const
const REACTOR = [1.034, -0.25, 2.77] as const
const CONSOLE_Z = 2.9 // m aft: between the two, across the aisle from the desk
const ISOLATE = [1.034, -0.25, 3.97] as const // ИЗОЛЯЦИЯ, the vent line's valve, last in the pressure group
// its first fault: the vent valve stuck open, 19 days into the flight; out in deep space, where no orbit holds the clock
const VENT_SEED = '/?seed=39&x=1'

/** Steps to starboard with D held until the body is past `x`; the console's cabinet stops it at x 0.62. */
const walkStarboardPast = async (page: Page, x: number): Promise<void> => {
  await page.keyboard.down('d')
  await expect.poll(async () => (await spotOf(page))[0], { timeout: 15_000, intervals: [50] }).toBeGreaterThan(x)
  await page.keyboard.up('d')
  await page.waitForTimeout(700)
}
const readingOf = (pattern: RegExp) => async (page: Page): Promise<number> =>
  Number(((await status(page).textContent()) ?? '').match(pattern)?.[1] ?? Number.NaN)
const temperatureOf = readingOf(/температура (-?[\d.]+) °C/)
const batteryOf = readingOf(/АКБ (\d+) %/)

test('at the life-support console the engineer turns a heater off and the cabin cools, then the reactor, and the battery takes the load', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('p')
  await page.keyboard.press('Equal') // ten minutes a second
  await page.keyboard.press('Equal') // an hour: above the ×300 the clock holds to while the habitat is not left as it should be
  await page.keyboard.press('Space')
  await expect(status(page)).toContainText('место: на ногах (x 0.00 z 0.62)')
  await walkAftPast(page, 's', CONSOLE_Z)
  await walkStarboardPast(page, 0.55)

  const gaze = await aimOnFoot(page, 0, HEATER_1)
  await expect(page.locator('.prompt')).toHaveText('E — выключить')
  await page.keyboard.press('e')
  await expect(status(page)).toContainText('обогрев 1 выкл')
  await expect(status(page)).toContainText('снижены: ЖИЗНЕОБЕСПЕЧЕНИЕ БЕЗ ПРИСМОТРА')
  const warm = await temperatureOf(page)
  await expect.poll(() => temperatureOf(page), { timeout: 20_000 }).toBeLessThan(warm - 0.3)

  await aimOnFoot(page, gaze[0], REACTOR, gaze[1])
  await expect(page.locator('.prompt')).toHaveText('E — выключить')
  await page.keyboard.press('e')
  await expect(status(page)).toContainText('реактор выкл')
  await expect.poll(() => batteryOf(page), { timeout: 20_000 }).toBeLessThan(99)
  await expect(status(page)).toContainText(/табло:.*ПИТАНИЕ/) // the only place the status line says it in capitals
  expect(errors).toEqual([])
})

test('a fault holds the clock and lights the annunciator; the procedure at the console deals with it', async ({ page }) => {
  const errors = await open(page, VENT_SEED)
  await page.keyboard.press('p') // the scrubber runs off the bus: air left to itself would hold the clock as well
  for (let i = 0; i < 6; i++) await page.keyboard.press('Equal') // to a year a second
  await expect(status(page)).toContainText('отказы: клапан сброса заело открытым', { timeout: 20_000 })
  await expect(status(page)).toContainText('снижены: ОТКАЗ НА БОРТУ')
  await expect(status(page)).toContainText(/табло:.*ЖИЗНЕОБЕСП\./)

  await page.keyboard.press('Space')
  await walkAftPast(page, 's', CONSOLE_Z)
  await walkStarboardPast(page, 0.55)
  await aimOnFoot(page, 0, ISOLATE)
  await expect(page.locator('.prompt')).toHaveText('E — включить')
  await page.keyboard.press('e')

  await expect(status(page)).toContainText('изоляция вкл')
  await expect(status(page)).toContainText('отказы: нет')
  await expect(status(page)).not.toContainText('ОТКАЗ НА БОРТУ')
  expect(errors).toEqual([])
})

const apoapsisOf = async (page: Page): Promise<number> =>
  Number(((await status(page).textContent()) ?? '').match(/апоцентр (\d+) км/)?.[1] ?? Number.NaN)

test('the flight begins on an orbit of the Earth, and a burn of the chemical engine raises its far side', async ({ page }) => {
  await open(page)
  await page.keyboard.press('p')
  await expect(status(page)).toContainText('режим у тела')
  await expect(status(page)).toContainText('тело Земля')
  const before = await apoapsisOf(page)
  for (const key of ['1', '2', '4']) await page.keyboard.press(key) // НАДДУВ, ПОДАЧА, пуск
  for (let i = 0; i < 7; i++) await page.keyboard.press(']') // the lever to full
  await expect(status(page)).toContainText('досвет горит 100 %')
  await expect.poll(() => apoapsisOf(page), { timeout: 20_000 }).toBeGreaterThan(before + 500)
  await page.keyboard.press('0') // АВАРИЙНАЯ ОТСЕЧКА
  await expect(status(page)).toContainText('досвет погашен')
})

test('the main engine runs in the light mode only', async ({ page }) => {
  await open(page)
  for (const key of ['p', 'u', 'o', 'i']) await page.keyboard.press(key) // bus, arming, shield, start: no light mode
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowUp')
  await expect(status(page)).toContainText('двигатель включён, не работает')
  await page.keyboard.press('g')
  await expect(status(page)).not.toContainText('не работает')
  await expect(status(page)).toContainText('режим световой')
  await expect.poll(() => speedOf(page), { timeout: 30_000 }).toBeGreaterThan(0)
})

// Under the navigation screen and on the left desk, projected from public/cockpit.glb's mounts (the light mode's from the
// head at rest, the rest after STRIP_VIEW)
const LIGHT_MODE_AT_REST = { x: 299, y: 491 }
const STRIP_VIEW = { dx: -330, dy: 110 } // left and down, at the strip under the navigation screen and the desk below it
const PRESSURISE = { x: 383, y: 305 }
const FEED = { x: 409, y: 310 }
const CHEM_START = { x: 472, y: 321 }
const MANUAL_ATTITUDE = { x: 628, y: 349 }
const CUTOFF = { x: 462, y: 359 }
const CHEM_LEVER_AT_OFF = { x: 264, y: 391 } // the sled of ДОСВЕТ, at the back of its track

test('the controls of flight by a body answer to the mouse: the light mode, the valves, the start, the lever, the cutoff and РУЧН', async ({ page }) => {
  await open(page)
  await page.keyboard.press('p') // the bus by its key: the first click after loading is the old mouse test's to prove
  await expect(status(page)).toContainText('шина включена')
  await page.mouse.click(LIGHT_MODE_AT_REST.x, LIGHT_MODE_AT_REST.y)
  await expect(status(page)).toContainText('световой режим вкл')
  await page.mouse.click(LIGHT_MODE_AT_REST.x, LIGHT_MODE_AT_REST.y)
  await expect(status(page)).toContainText('световой режим выкл')

  await turnHead(page, STRIP_VIEW)
  await page.mouse.click(PRESSURISE.x, PRESSURISE.y)
  await page.mouse.click(FEED.x, FEED.y)
  await expect(status(page)).toContainText('наддув вкл, подача откр')
  await page.mouse.click(CHEM_START.x, CHEM_START.y)
  await page.mouse.move(CHEM_LEVER_AT_OFF.x, CHEM_LEVER_AT_OFF.y)
  await page.mouse.down()
  await page.mouse.move(CHEM_LEVER_AT_OFF.x, CHEM_LEVER_AT_OFF.y - 150, { steps: 8 }) // 0.68 of the travel: it stands at 60 %
  await page.mouse.up()
  await expect(status(page)).toContainText('досвет горит 60 %')
  await page.keyboard.press(']')
  await expect(status(page)).toContainText('досвет горит 100 %')
  await page.mouse.click(CUTOFF.x, CUTOFF.y)
  await expect(status(page)).toContainText('досвет погашен')
  await page.mouse.click(MANUAL_ATTITUDE.x, MANUAL_ATTITUDE.y)
  await expect(status(page)).toContainText('ориентация ручн')
})
