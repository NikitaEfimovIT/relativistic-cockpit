import { commLink } from './comms'
import { G0 } from './physics'
import { properAcceleration, type SimState } from './sim'

// The sounds of being alone: the hull ticking as it cools after a burn, and the radio. The levels are set by ear.

const TICK_GAIN = 0.006 // heard in the quiet, not over it
const TICK_MUFFLE_HZ = 1400 // the trim between the skin and the cabin takes the ring out of it
const QUIET_TICK_RATE = 1 / 40 // per second: a cold, idle hull still settles now and then
const COOLING_TICK_RATE = 0.5 // per second, just after a burn
const COOLING_TIME = 45 // s
const STATIC_GAIN = 0.04
/**
 * A struck plate rings at inharmonic partials; 1 : 2.76 : 5.40 are the first modes of a free bar. Damped by the trim, they
 * die in a tenth of a second or so: a knock, not a ring.
 */
const PARTIALS: ReadonlyArray<readonly [number, number, number]> = [[1, 0.16, 1], [2.76, 0.08, 0.5], [5.4, 0.04, 0.3]]

function whiteNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/** One envelope that rises fast and dies away, for a sound that starts at `at`. */
function envelope(ctx: AudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
  return gain
}

/** The hull settling somewhere around the cabin: a short muffled knock from a random side. */
function hullTick(ctx: AudioContext, out: AudioNode): void {
  const at = ctx.currentTime
  const base = 300 + Math.random() * 600
  const side = ctx.createStereoPanner()
  side.pan.value = Math.random() * 1.6 - 0.8
  side.connect(out)
  const muffle = ctx.createBiquadFilter()
  muffle.type = 'lowpass'
  muffle.frequency.value = TICK_MUFFLE_HZ
  muffle.connect(side)
  for (const [ratio, decay, share] of PARTIALS) {
    const tone = ctx.createOscillator()
    tone.frequency.value = base * ratio
    tone.connect(envelope(ctx, at, TICK_GAIN * share, 0.002, decay)).connect(muffle)
    tone.start(at)
    tone.stop(at + decay + 0.01)
  }
}

/** A burst of radio noise, and, for a message, two rising tones over it. */
function radio(ctx: AudioContext, out: AudioNode, hiss: AudioBuffer, seconds: number, isMessage: boolean): void {
  const at = ctx.currentTime
  const source = ctx.createBufferSource()
  source.buffer = hiss
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 2200
  band.Q.value = 0.6
  source.connect(band).connect(envelope(ctx, at, STATIC_GAIN, 0.04, seconds)).connect(out)
  source.start(at, Math.random() * 2, seconds + 0.1)
  if (!isMessage) return
  ;[[660, 0.25], [990, 0.37]].forEach(([frequency, delay]) => {
    const tone = ctx.createOscillator()
    tone.frequency.value = frequency
    tone.connect(envelope(ctx, at + delay, 0.05, 0.01, 0.09)).connect(out)
    tone.start(at + delay)
    tone.stop(at + delay + 0.12)
  })
}

export interface Solitude {
  update(s: SimState): void
}

export function createSolitude(ctx: AudioContext, out: AudioNode): Solitude {
  const hiss = whiteNoise(ctx, 3)
  let last = ctx.currentTime
  let lastBurn = -Infinity
  let heard = -1 // -1 until the first frame, so that messages already in do not all ring when the sound comes on
  let wasUp = true

  return {
    update(s) {
      const now = ctx.currentTime
      const dt = Math.min(0.1, Math.max(0, now - last))
      last = now

      if (Math.abs(properAcceleration(s)) > 0.02 * G0) lastBurn = now
      const cooling = Math.exp(-(now - lastBurn) / COOLING_TIME)
      if (Math.random() < (QUIET_TICK_RATE + COOLING_TICK_RATE * cooling) * dt) hullTick(ctx, out)

      const isUp = commLink(s.course, s.ship).isUp
      const isListening = s.busOn && s.breakers.comms // a dead radio does not crackle when the link comes and goes
      if (heard >= 0 && s.messagesHeard > heard) radio(ctx, out, hiss, 0.7, true)
      else if (heard >= 0 && isListening && isUp !== wasUp) radio(ctx, out, hiss, 0.3, false)
      heard = s.messagesHeard
      wasUp = isUp
    },
  }
}
