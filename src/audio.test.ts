import { describe, expect, test } from 'vitest'
import { RECORDINGS } from './audio'
import type { Sound } from './clicks'

// The app's tsconfig carries no Node types, so Node's fs comes in by an import the type checker does not follow.
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as { readonly readFileSync: (path: string) => Uint8Array }

/** The samples of a 16-bit PCM WAV file in public/, with what its header says. */
function readWav(path: string): { readonly rate: number; readonly channels: number; readonly bits: number; readonly samples: Float32Array } {
  const bytes = readFileSync(`public${path}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number): string => new TextDecoder().decode(bytes.subarray(at, at + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${path} is not a WAV file`)
  const [channels, rate, bits] = [view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]
  let data = 12
  while (tag(data) !== 'data') data += 8 + ((view.getUint32(data + 4, true) + 1) & ~1) // over the chunks before the samples, padded to even
  const samples = new Float32Array(view.getUint32(data + 4, true) / 2).map((_, i) => view.getInt16(data + 8 + 2 * i, true) / 32_768)
  return { rate, channels, bits, samples }
}

const db = (x: number): number => 20 * Math.log10(x)
const peak = (s: Float32Array): number => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const rms = (s: Float32Array): number => Math.sqrt(s.reduce((sum, v) => sum + v * v, 0) / s.length)
/** Hz: the RMS frequency of a take, from how fast it changes, as in clicks.test.ts. */
const pitch = (s: Float32Array, rate: number): number =>
  (rate / Math.PI) * Math.asin(Math.min(1, rms(s.slice(1).map((v, i) => v - s[i])) / rms(s) / 2))

describe('the recordings of real controls', () => {
  const takes = Object.entries(RECORDINGS).flatMap(([sound, paths]) => (paths ?? []).map((path) => [sound as Sound, path] as const))

  test('cover every switch, button, key and the relays; the lever notch and the shutters stay synthesised', () => {
    expect(Object.keys(RECORDINGS).sort()).toEqual(['buttonDown', 'buttonUp', 'guardedSwitch', 'keyDown', 'keyUp', 'relay', 'switch'])
    expect(RECORDINGS.switch?.length).toBeGreaterThanOrEqual(6) // takes enough that no two flips in a row need sound the same
  })

  test('each take is a short mono 48 kHz WAV, peaking near full scale, faded in and out', () => {
    for (const [sound, path] of takes) {
      const { rate, channels, bits, samples } = readWav(path)
      expect([rate, channels, bits], path).toEqual([48_000, 1, 16])
      expect(samples.length / rate, path).toBeLessThan(0.3) // short, as the e2e test counts sounds under 0.5 s
      expect(db(peak(samples)), path).toBeGreaterThan(-1.5)
      expect(Math.abs(samples[0]), `${sound}: ${path} starts in silence`).toBeLessThan(0.01)
      expect(db(peak(samples.slice(-rate / 200)) / peak(samples)), `${path} ends faded out`).toBeLessThan(-40)
    }
  })

  test('each take is a click, not a thud', () => {
    // A thud once cut for the guarded toggle by mistake measured 205 Hz; the dullest real take, the button coming up, 898 Hz
    for (const [, path] of takes) {
      const { rate, samples } = readWav(path)
      expect(pitch(samples, rate), path).toBeGreaterThan(500)
    }
  })
})
