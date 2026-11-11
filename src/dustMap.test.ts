import { describe, expect, test } from 'vitest'
import built from '../public/dust/edenhofer2024.json'
import fineBuilt from '../public/dust/planck2016.json'
import { DUST_GRID, FINE_GRID, parseDustMap, parseFineDust } from './dustMap'

// The real grids are loaded and checked on the GPU in e2e/shaders.spec.ts.
const SIZE = DUST_GRID.longitudes * DUST_GRID.latitudes * DUST_GRID.shells
const FINE_SIZE = FINE_GRID.longitudes * FINE_GRID.latitudes

describe('the dust map', () => {
  test('the built grid is the one the bake is compiled for', () => {
    const texture = parseDustMap(built, new ArrayBuffer(SIZE))
    expect([texture.image.width, texture.image.height, texture.image.depth]).toEqual([DUST_GRID.longitudes, DUST_GRID.latitudes, DUST_GRID.shells])
  })

  test('a download cut short is refused', () => {
    expect(() => parseDustMap(built, new ArrayBuffer(1000))).toThrow(/1000 bytes/)
  })

  test('a grid built with other settings is refused', () => {
    expect(() => parseDustMap({ ...built, shells: 96 }, new ArrayBuffer(SIZE))).toThrow(/shells/)
    expect(() => parseDustMap(null, new ArrayBuffer(SIZE))).toThrow(/longitudes/)
  })

  test('the built structure finer than a cell is the one the bake is compiled for', () => {
    const texture = parseFineDust(fineBuilt, new ArrayBuffer(FINE_SIZE))
    expect([texture.image.width, texture.image.height]).toEqual([FINE_GRID.longitudes, FINE_GRID.latitudes])
  })

  test('a fine map cut short, or coded over another range, is refused', () => {
    expect(() => parseFineDust(fineBuilt, new ArrayBuffer(FINE_SIZE - 1))).toThrow(/fine dust map has/)
    expect(() => parseFineDust({ ...fineBuilt, logMax: 1 }, new ArrayBuffer(FINE_SIZE))).toThrow(/logMax/)
  })
})
