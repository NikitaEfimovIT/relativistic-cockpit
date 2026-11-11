import { describe, expect, test } from 'vitest'
import { G0 } from './physics'
import { apparentGravity, stepTether, type Tether, type Vec3 } from './loose'

const FRAME = 1 / 60
const LENGTH = 0.16

const hang = (acceleration: Vec3, seconds: number, start: Tether = { position: [0, 0, 0], velocity: [0, 0, 0] }): Tether => {
  let tether = start
  for (let t = 0; t < seconds; t += FRAME) tether = stepTether(tether, LENGTH, acceleration, FRAME)
  return tether
}

describe('apparent gravity', () => {
  test('under thrust "down" is aft, behind the seat; under braking it is towards the windshield', () => {
    expect(apparentGravity(G0)).toEqual([0, 0, G0])
    expect(apparentGravity(-G0)).toEqual([0, 0, -G0])
    expect(apparentGravity(0)).toEqual([0, 0, 0])
  })
})

describe('the fob on its cord', () => {
  test('under thrust it swings aft and comes to rest at the full length of the cord', () => {
    const { position, velocity } = hang([0, 0, G0], 20)
    expect(position[2]).toBeCloseTo(LENGTH, 3)
    expect(Math.hypot(...velocity)).toBeLessThan(0.01)
  })

  test('under braking it goes the other way', () => {
    expect(hang([0, 0, -G0], 20).position[2]).toBeCloseTo(-LENGTH, 3)
  })

  test('when the thrust stops it does not fall back: there is no weight, it only drifts', () => {
    // Arrange: resting aft under thrust
    const loaded = hang([0, 0, G0], 20)

    // Act
    const after = hang([0, 0, 0], 2, loaded)

    // Assert
    expect(after.position[2]).toBeGreaterThan(0.9 * LENGTH)
    expect(Math.hypot(...after.velocity)).toBeLessThan(0.01)
  })

  test('the cord never stretches, however hard the fob is thrown about', () => {
    // Arrange
    let tether: Tether = { position: [0, 0, 0], velocity: [3, -2, 4] }

    // Act & Assert
    for (let i = 0; i < 2000; i++) {
      const phase = i * 0.07
      tether = stepTether(tether, LENGTH, [Math.sin(phase) * 15, Math.cos(phase * 1.3) * 15, Math.sin(phase * 0.7) * 15], FRAME)
      expect(Math.hypot(...tether.position)).toBeLessThanOrEqual(LENGTH + 1e-9)
    }
  })

  test('a stalled frame does not make it explode', () => {
    const { position } = stepTether({ position: [0, 0, 0.1], velocity: [0, 0, 1] }, LENGTH, [0, 0, G0], 0.1)
    expect(Math.hypot(...position)).toBeLessThanOrEqual(LENGTH + 1e-9)
    expect(position.every(Number.isFinite)).toBe(true)
  })
})
