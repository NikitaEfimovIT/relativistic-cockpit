import { describe, expect, test } from 'vitest'
import { LEVEL_SPREAD_DB, SOUNDS, renderSound, type Sound } from './clicks'

const RATE = 48_000
const NAMES = Object.keys(SOUNDS) as Sound[]

/** A seeded generator (mulberry32), so that a test hears the same press every time. */
const seeded = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const decibels = (x: number): number => 20 * Math.log10(x)
const peak = (s: Float32Array): number => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const rms = (s: Float32Array): number => Math.sqrt(s.reduce((sum, v) => sum + v * v, 0) / s.length)
/** Hz: the RMS frequency of a sound, from how fast it changes; for a tone, RMS(x′)/RMS(x) = 2 sin(πf/rate). */
const pitch = (s: Float32Array): number => {
  const change = s.slice(1).map((v, i) => v - s[i])
  return (RATE / Math.PI) * Math.asin(Math.min(1, rms(change) / rms(s) / 2))
}

describe('the sounds of the controls', () => {
  test('each sounds at its own level, at either common rate, and has died away within 0.3 s', () => {
    for (const rate of [44_100, RATE]) {
      for (const sound of NAMES) {
        const samples = renderSound(sound, rate, seeded(1))
        expect(samples.every(Number.isFinite), sound).toBe(true)
        expect(Math.abs(decibels(peak(samples)) - SOUNDS[sound].level), sound).toBeLessThanOrEqual(LEVEL_SPREAD_DB + 0.01)
        expect(samples.length / rate, sound).toBeLessThan(0.3)
        expect(decibels(rms(samples.slice(-rate / 100)) / peak(samples)), sound).toBeLessThan(-40) // its last 10 ms
      }
    }
  })

  test('no two presses sound exactly alike', () => {
    for (const sound of NAMES) {
      const [first, second] = [renderSound(sound, RATE, seeded(1)), renderSound(sound, RATE, seeded(2))]
      expect(first.length === second.length && first.every((v, i) => v === second[i]), sound).toBe(false)
    }
  })

  test('a key sounds on the way down and again on the way up, quieter and higher', () => {
    const [down, up] = [renderSound('keyDown', RATE, seeded(3)), renderSound('keyUp', RATE, seeded(3))]
    expect(decibels(peak(down)) - decibels(peak(up))).toBeGreaterThan(3)
    expect(pitch(up)).toBeGreaterThan(pitch(down))
  })

  test('a toggle is a bright metal click, and the bigger guarded ones sound lower', () => {
    const [toggle, guarded] = [renderSound('switch', RATE, seeded(4)), renderSound('guardedSwitch', RATE, seeded(4))]
    expect(pitch(toggle)).toBeGreaterThan(2000)
    expect(pitch(guarded)).toBeLessThan(0.85 * pitch(toggle))
  })

  test('the shutters stop with a low thump, the relays behind the panel are quieter than the switches', () => {
    expect(pitch(renderSound('clunk', RATE, seeded(5)))).toBeLessThan(600)
    expect(SOUNDS.relay.level).toBeLessThan(SOUNDS.switch.level - 10)
  })
})
