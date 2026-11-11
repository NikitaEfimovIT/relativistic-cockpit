import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// The published formulas that only exist in GLSL, checked on the GPU. See e2e/probe.ts.

type Vec3 = readonly [number, number, number]
interface Probes {
  probeGlare(radii: readonly number[]): ReadonlyArray<{ readonly radius: number; readonly ratio: number }>
  probeBake(directions: readonly Vec3[]): ReadonlyArray<{
    readonly direction: Vec3
    readonly visual: number
    readonly blue: number
    readonly nearExtinction: number
  }>
  probeTurbulence(directions: readonly Vec3[], places: readonly number[]): { readonly light: number }
  probeRebake(): {
    readonly hasFirstBake: boolean
    readonly settled: number
    readonly skippedAtCruise: boolean
    readonly rebakedAfterBraking: boolean
    readonly finalMix: number
  }
  probeDustMap(directions: readonly Vec3[], isFine: boolean): Promise<readonly number[]>
}

const openProbes = async (page: Page): Promise<void> => {
  await page.goto('/e2e/probe.html')
  await page.waitForFunction(() => 'probes' in window)
}

const normalise = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

test('the glare pyramid follows the Stiles–Holladay law', async ({ page }) => {
  // Arrange
  await openProbes(page)

  // Act
  const samples = await page.evaluate(
    (radii) => (window as unknown as { probes: Probes }).probes.probeGlare(radii),
    [12, 24, 48, 96, 192],
  )

  // Assert
  for (const { radius, ratio } of samples) {
    expect(ratio, `at ${radius} px`).toBeGreaterThan(0.7)
    expect(ratio, `at ${radius} px`).toBeLessThan(1.4)
  }
})

test('the bake matches the tested galaxy model, in every direction of the cube map', async ({ page }) => {
  // Arrange: forward, along each axis, and off-axis so that a wrong cube-face orientation cannot pass
  await openProbes(page)
  const directions: readonly Vec3[] = [
    [0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
    normalise([1, 1, -1]), normalise([-1, 0.4, 0.8]), normalise([0.3, -1, 0.5]), normalise([-0.7, -0.6, -0.2]),
  ]

  // Act
  const samples = await page.evaluate(
    (list) => (window as unknown as { probes: Probes }).probes.probeBake(list),
    directions,
  )

  // Assert
  for (const { direction, visual, blue, nearExtinction } of samples) {
    const where = `towards ${direction.map((c) => c.toFixed(2)).join(', ')}`
    expect(visual, `V ${where}`).toBeGreaterThan(0.8)
    expect(visual, `V ${where}`).toBeLessThan(1.25)
    expect(blue, `B ${where}`).toBeGreaterThan(0.8)
    expect(blue, `B ${where}`).toBeLessThan(1.25)
    expect(nearExtinction, `A_V ${where}`).toBeGreaterThan(0.75)
    expect(nearExtinction, `A_V ${where}`).toBeLessThan(1.3)
  }
})

test('a clumpy dust medium lets a little more light through than a smooth one', async ({ page }) => {
  // Arrange: a spread of directions over the whole sky
  await openProbes(page)
  const golden = Math.PI * (3 - Math.sqrt(5))
  const places = [0, 1500, 3000, 4500, 6000, 7500, 9000, 10500]
  const directions = Array.from({ length: 200 }, (_, i): Vec3 => {
    const y = 1 - (2 * (i + 0.5)) / 200
    const radius = Math.sqrt(1 - y * y)
    return [radius * Math.cos(i * golden), y, radius * Math.sin(i * golden)]
  })

  // Act
  const { light } = await page.evaluate(
    ([list, course]) => (window as unknown as { probes: Probes }).probes.probeTurbulence(list, course),
    [directions, places] as const,
  )

  // Assert: ⟨e^−τ⟩ ≥ e^−⟨τ⟩. The mean column itself is heavy-tailed: a few places cannot measure it, so it was
  // checked numerically over 2·10⁶ samples of the same noise (mean 0.93–1.11, see FORMULAS.md).
  expect(light).toBeGreaterThan(1)
  expect(light).toBeLessThan(2.5)
})

test('the sky is rebaked after a long flight, but not at cruise, when it could not be seen', async ({ page }) => {
  // Arrange
  await openProbes(page)

  // Act
  const result = await page.evaluate(() => (window as unknown as { probes: Probes }).probes.probeRebake())

  // Assert
  expect(result.hasFirstBake).toBe(true)
  expect(result.settled).toBe(1)
  expect(result.skippedAtCruise).toBe(true)
  expect(result.rebakedAfterBraking).toBe(true)
  expect(result.finalMix).toBe(1)
})

// The dust map as the app loads it, summed cell by cell here, apart from the shader that is under test
const DUST = new URL('../public/dust/', import.meta.url)
const GRID = { ...JSON.parse(readFileSync(new URL('edenhofer2024.json', DUST), 'utf8')), codes: readFileSync(new URL('edenhofer2024.bin', DUST)) }
const CELL = 360 / GRID.longitudes
const RESOLVED_PC = 1500 / 3.26156 // where the bake stops counting the extinction to the resolved stars

/** A_V from the Sun to `reachPc` through the cell that holds (l, b), degrees. */
function mapColumn(l: number, b: number, reachPc: number): number {
  const { longitudes, latitudes, shells, innerPc, outerPc, logMin, logMax, codes } = GRID
  const cell = Math.floor((b + 90) / CELL) * longitudes + Math.floor(l / CELL)
  const start = (k: number): number => (k === 0 ? 0 : innerPc * (outerPc / innerPc) ** ((k - 1) / (shells - 1)))
  return Array.from({ length: shells }, (_, k) => {
    const perKpc = 10 ** (logMin + (codes[k * latitudes * longitudes + cell] / 255) * (logMax - logMin))
    return (perKpc * Math.max(0, Math.min(start(k + 1), reachPc) - start(k))) / 1000
  }).reduce((sum, part) => sum + part, 0)
}

// Where SIMBAD puts three nearby dark clouds (galactic l, b), with the radius of a ring of sky around each; the cube is in
// galactic axes
const CLOUDS = [['Coalsack Nebula', 300.71, -0.96, 5], ['TMC-1 (Taurus)', 174.39, -13.43, 8], ['Ophiuchus Molecular Cloud', 353.22, 16.53, 8]] as const
const DEG = Math.PI / 180
const towards = (l: number, b: number): Vec3 => [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)]
const probeDust = (page: Page, directions: readonly Vec3[], isFine: boolean): Promise<readonly number[]> => page.evaluate(
  ([list, fine]) => (window as unknown as { probes: Probes }).probes.probeDustMap(list, fine),
  [directions, isFine] as const,
)

test('the measured dust lies where it was measured: three dark clouds stand out from the sky around them', async ({ page }) => {
  // Arrange: the clouds at the centre of their cells, and a ring of sky around each, in the map's smooth cells
  await openProbes(page)
  const centre = (angle: number): number => (Math.floor(angle / CELL) + 0.5) * CELL
  const RING = 8
  const directions = CLOUDS.flatMap(([, l, b, radius]) => [
    towards(centre(l), centre(b)),
    ...Array.from({ length: RING }, (_, i) => towards(l + radius * Math.cos((2 * Math.PI * i) / RING), b + radius * Math.sin((2 * Math.PI * i) / RING))),
  ])

  // Act
  const extinction = await probeDust(page, [...directions, towards(0, 89.75)], false)

  // Assert: the bake carries the map's own column, and each cloud is darker than all the sky around it
  CLOUDS.forEach(([name, l, b], i) => {
    const [cloud, ...ring] = extinction.slice(i * (RING + 1), (i + 1) * (RING + 1))
    const expected = mapColumn(centre(l), centre(b), RESOLVED_PC)
    expect(cloud / expected, `${name}: A_V ${cloud.toFixed(2)} baked, ${expected.toFixed(2)} in the map`).toBeGreaterThan(0.85)
    expect(cloud / expected, `${name}: A_V ${cloud.toFixed(2)} baked, ${expected.toFixed(2)} in the map`).toBeLessThan(1.2)
    expect(cloud, `${name} against the sky around it`).toBeGreaterThan(1.3 * Math.max(...ring))
  })
  expect(extinction.at(-1), 'towards the north galactic pole').toBeLessThan(0.15)
})

// Planck's structure inside the cells, as the app loads it
const FINE = { ...JSON.parse(readFileSync(new URL('planck2016.json', DUST), 'utf8')), codes: readFileSync(new URL('planck2016.bin', DUST)) }
const PER_CELL = FINE.longitudes / GRID.longitudes
const PIXEL = CELL / PER_CELL

/** log10 of the factor Planck's structure puts on the dust in 5′ pixel (i, j). */
const fineLog = (i: number, j: number): number => FINE.logMin + (FINE.codes[j * FINE.longitudes + i] / 255) * (FINE.logMax - FINE.logMin)

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length
const spread = (values: readonly number[]): number => Math.sqrt(mean(values.map((value) => (value - mean(values)) ** 2)))
const correlation = (x: readonly number[], y: readonly number[]): number =>
  mean(x.map((value, k) => (value - mean(x)) * (y[k] - mean(y)))) / (spread(x) * spread(y))

test("Planck's structure lands inside the cells where Planck saw it, and each cell keeps its dust", async ({ page }) => {
  // Arrange: every 5′ pixel of the 3 × 3 cells around each cloud
  await openProbes(page)
  const SIDE = 3 * PER_CELL
  const pixels = CLOUDS.map(([, l, b]) => {
    const [i0, j0] = [(Math.floor(l / CELL) - 1) * PER_CELL, (Math.floor((b + 90) / CELL) - 1) * PER_CELL]
    return Array.from({ length: SIDE * SIDE }, (_, k) => [i0 + (k % SIDE), j0 + Math.floor(k / SIDE)] as const)
  })
  const directions = pixels.flat().map(([i, j]) => towards((i + 0.5) * PIXEL, (j + 0.5) * PIXEL - 90))

  // Act
  const fine = await probeDust(page, directions, true)
  const smooth = await probeDust(page, directions, false)

  // Assert: the structure is Planck's, a little softened by the cube's own texels, and moves no dust between cells
  CLOUDS.forEach(([name], c) => {
    const at = (k: number): number => c * SIDE * SIDE + k
    const measured = pixels[c].map((_, k) => Math.log10(fine[at(k)] / smooth[at(k)]))
    const expected = pixels[c].map(([i, j]) => fineLog(i, j))
    expect(correlation(measured, expected), `${name}: the bake against Planck, pixel by pixel`).toBeGreaterThan(0.9)
    expect(spread(measured) / spread(expected), `${name}: how much of Planck's contrast the bake keeps`).toBeGreaterThan(0.7)
    expect(spread(measured) / spread(expected), `${name}: how much of Planck's contrast the bake keeps`).toBeLessThan(1.05)
    for (let cell = 0; cell < 9; cell++) {
      const inside = pixels[c].map((_, k) => k).filter((k) =>
        Math.floor((k % SIDE) / PER_CELL) === cell % 3 && Math.floor(Math.floor(k / SIDE) / PER_CELL) === Math.floor(cell / 3))
      const kept = mean(inside.map((k) => fine[at(k)])) / mean(inside.map((k) => smooth[at(k)]))
      expect(kept, `${name}, cell ${cell}: its dust with Planck's structure over its dust without`).toBeGreaterThan(0.97)
      expect(kept, `${name}, cell ${cell}: its dust with Planck's structure over its dust without`).toBeLessThan(1.03)
    }
  })
})
