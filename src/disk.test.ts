import { describe, expect, test } from 'vitest'
import { diskShift, diskT4, diskTemperature, flatDiskLight, peakT4, thinDiskFlux } from './disk'
import { lutXYZ } from './physics'
import { schwarzschildRadius } from './blackHoles'

describe('a thin disk (Page & Thorne 1974)', () => {
  test('gives off nothing at the innermost stable orbit, 6 M, and peaks at 9.55 M', () => {
    expect(thinDiskFlux(6)).toBeCloseTo(0, 12)
    let peak = 6
    for (let x = 6; x < 30; x += 0.001) if (thinDiskFlux(x) > thinDiskFlux(peak)) peak = x
    expect(peak).toBeCloseTo(9.55, 1)
  })

  test('far out it is Newtonian: 3GMṀ/(8πr³)', () => {
    expect(thinDiskFlux(1e6) * 1e18).toBeCloseTo(1, 2)
  })

  test('Cygnus X-1, 21.2 Suns shining 3.0·10³⁰ W at an efficiency of 0.057, is 1.9 million K at its hottest', () => {
    const mdot = 3.0e30 / ((1 - Math.sqrt(8 / 9)) * 299_792_458 ** 2)
    const t4 = diskT4(schwarzschildRadius(21.2), mdot)
    expect(diskTemperature(t4, 9.55 / 2) / 1e6).toBeCloseTo(1.89, 1)
  })

  test('a disk set by its hottest point is that hot there', () => {
    expect(diskTemperature(peakT4(6000), 9.55 / 2)).toBeCloseTo(6000, -1)
  })
})

describe('the light of the disk at the eye', () => {
  test('seen along the axis only time dilation and the climb out of the well shift it', () => {
    expect(diskShift(5, 0, 25)).toBeCloseTo(Math.sqrt(1 - 1.5 / 5) / Math.sqrt(1 - 1 / 25), 12)
  })

  test('the side coming towards the eye is blueshifted, the side going away reddened', () => {
    expect(diskShift(3, 2.6, Infinity)).toBeGreaterThan(1)
    expect(diskShift(3, -2.6, Infinity)).toBeLessThan(0.6)
  })

  test('an endless flat disk of luminance L lights a surface facing it with πL', () => {
    const light = flatDiskLight([0, 0, 1], [0, 0, 1], 1e-4, 1e5, () => 5772)
    expect(light.illuminance / (Math.PI * lutXYZ(5772)[1])).toBeCloseTo(1, 2)
    expect(light.direction[2]).toBeCloseTo(-1, 6) // down, at the disk
    expect(light.temperature).toBeCloseTo(5772, 6)
    expect(light.solidAngle / (2 * Math.PI)).toBeCloseTo(1, 2) // the whole hemisphere below
  })
})
