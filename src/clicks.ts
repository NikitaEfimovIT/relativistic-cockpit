// The mechanical sounds of the cabin, synthesised as struck parts (modal synthesis): each sound is a few hits, each hit a
// brief push into the damped modes of the parts it sets ringing. A metal snap is short and hard, so it rings every mode;
// a plastic cap lands softer, and its longer contact filters off the top. After a snap a switch's contacts bounce for
// about a millisecond, which turns a tick into a click. Every frequency, decay, timing and level here is a choice made
// from how such parts are built, without listening and without copying a recording. No imports: tested in Node, and
// rendered to files there to be heard.

/** Every mechanical sound the cabin makes. */
export type Sound = 'switch' | 'guardedSwitch' | 'buttonDown' | 'buttonUp' | 'keyDown' | 'keyUp' | 'detent' | 'relay' | 'clunk'

interface Mode {
  readonly hz: number
  readonly decay: number // s, to 1/e
  readonly gain: number
}

interface Hit {
  readonly at: number // s from the start of the sound
  readonly gain: number
  readonly contact: number // s that the parts touch: the shorter, the brighter
  readonly modes: readonly Mode[]
  readonly bounces: number // of the contacts, after the hit
}

interface Recipe {
  readonly level: number // dBFS at its loudest, give or take LEVEL_SPREAD_DB
  readonly hits: readonly Hit[]
}

const mode = (hz: number, decay: number, gain: number): Mode => ({ hz, decay, gain })
const hit = (at: number, gain: number, contact: number, modes: readonly Mode[], bounces = 0): Hit => ({ at, gain, contact, modes, bounces })

// A toggle: its spring snaps the lever over centre, then the lever strikes its stop and the panel thumps.
const SNAP = [mode(3150, 0.004, 1), mode(5200, 0.003, 0.75), mode(7600, 0.002, 0.5), mode(10_400, 0.0012, 0.3)]
const STOP = [mode(2100, 0.008, 1), mode(3900, 0.005, 0.6), mode(6100, 0.003, 0.35), mode(240, 0.018, 0.45), mode(610, 0.01, 0.3)]
// The guarded switches, the engine's and the shield's, are bigger: they ring lower and longer, and thump more.
const BIG_SNAP = [mode(2300, 0.006, 1), mode(3800, 0.004, 0.7), mode(5600, 0.003, 0.45), mode(8100, 0.0018, 0.25)]
const BIG_STOP = [mode(1500, 0.011, 1), mode(2800, 0.007, 0.55), mode(180, 0.025, 0.7), mode(450, 0.014, 0.4)]
// A push button: the microswitch inside snaps, then the cap lands on its bezel; coming up, the same in reverse, lighter.
const MICROSWITCH = [mode(5800, 0.0015, 1), mode(8600, 0.001, 0.6), mode(4100, 0.002, 0.4)]
const CAP_DOWN = [mode(1650, 0.006, 1), mode(2950, 0.004, 0.5), mode(380, 0.012, 0.5)]
const CAP_UP = [mode(1900, 0.005, 1), mode(3400, 0.0035, 0.5), mode(450, 0.009, 0.3)]
// A key with a clicky switch, as on a mechanical keyboard: the click at actuation, then the stem bottoms out and the cap
// meets the plate, over the case's low "thock"; on the way up the stem strikes the top of its housing, higher and lighter.
const KEY_CLICK = [mode(4600, 0.0018, 1), mode(6900, 0.0012, 0.6), mode(9800, 0.0008, 0.35)]
const BOTTOM_OUT = [mode(1250, 0.01, 0.8), mode(2300, 0.007, 1), mode(3600, 0.004, 0.5), mode(430, 0.016, 0.55)]
const TOP_OUT = [mode(1700, 0.007, 0.6), mode(2900, 0.005, 1), mode(4500, 0.003, 0.5)]
// The thrust lever's zero notch: a sprung ball drops into it, and the lever's mass thuds.
const DETENT = [mode(1100, 0.008, 1), mode(2400, 0.005, 0.5), mode(150, 0.022, 0.8)]
// A power relay pulling in behind the panel: the armature slams onto its core.
const ARMATURE = [mode(2600, 0.006, 1), mode(4400, 0.004, 0.6), mode(1200, 0.009, 0.5), mode(320, 0.012, 0.3)]
// The shutters reaching their stops: heavy, soft, low.
const SHUTTER_STOP = [mode(95, 0.035, 1), mode(230, 0.025, 0.6), mode(520, 0.015, 0.35), mode(1300, 0.006, 0.15)]

// Levels, which the recordings of real controls play at too (audio.ts): 6 dB under the noise bursts they replace (a toggle
// was −8 dBFS at its peak, a button −2), as loud as those proved too loud; the relays quieter still, the shutters' stop
// 30 dB under its old thump, which clipped.
export const SOUNDS: Readonly<Record<Sound, Recipe>> = {
  switch: { level: -15, hits: [hit(0, 1, 40e-6, SNAP, 2), hit(0.0026, 0.8, 80e-6, STOP, 1)] },
  guardedSwitch: { level: -13, hits: [hit(0, 1, 60e-6, BIG_SNAP, 2), hit(0.0035, 0.9, 120e-6, BIG_STOP, 1)] },
  buttonDown: { level: -17, hits: [hit(0, 0.7, 30e-6, MICROSWITCH, 1), hit(0.004, 1, 150e-6, CAP_DOWN)] },
  buttonUp: { level: -22, hits: [hit(0, 0.6, 30e-6, MICROSWITCH, 1), hit(0.003, 0.7, 120e-6, CAP_UP)] },
  keyDown: { level: -17, hits: [hit(0, 0.6, 30e-6, KEY_CLICK), hit(0.009, 1, 120e-6, BOTTOM_OUT)] },
  keyUp: { level: -23, hits: [hit(0, 0.4, 30e-6, KEY_CLICK), hit(0.006, 1, 100e-6, TOP_OUT)] },
  detent: { level: -21, hits: [hit(0, 1, 300e-6, DETENT)] },
  relay: { level: -28, hits: [hit(0, 1, 50e-6, ARMATURE, 2)] },
  clunk: { level: -26, hits: [hit(0, 1, 1.5e-3, SHUTTER_STOP)] },
}

/** dB from one press to the next, either way: no finger presses the same way twice. */
export const LEVEL_SPREAD_DB = 1
const TIME_SPREAD = 0.25 // of each hit's delay after the first, either way
const PITCH_SPREAD = 0.03 // of every mode's frequency, either way: parts differ a little from one switch to the next
const BOUNCE_GAIN = 0.35 // of the hit or bounce before
const BOUNCE_GAP = [0.00025, 0.0009] as const // s
const RING_OUT = 6.9 // decay times, to −60 dB

/** A fresh render of `sound` at `sampleRate`, peaking at its level; `random`, in [0, 1), makes each press a little different. */
export function renderSound(sound: Sound, sampleRate: number, random: () => number = Math.random): Float32Array {
  const spread = (amount: number): number => 1 + amount * (2 * random() - 1)
  const hits = SOUNDS[sound].hits.flatMap((recipe) => withBounces({
    ...recipe,
    at: recipe.at * spread(TIME_SPREAD),
    modes: recipe.modes.map((m) => ({ ...m, hz: m.hz * spread(PITCH_SPREAD) })),
  }, random))
  const end = Math.max(...hits.map((h) => h.at + h.contact + RING_OUT * Math.max(...h.modes.map((m) => m.decay))))
  const samples = new Float32Array(Math.ceil(end * sampleRate))
  for (const h of hits) ringInto(samples, h, sampleRate)
  const level = SOUNDS[sound].level + LEVEL_SPREAD_DB * (2 * random() - 1)
  return toPeak(samples, 10 ** (level / 20))
}

/** The hit, then its contacts' bounces, each weaker than the one before, at random gaps. */
function withBounces(first: Hit, random: () => number): Hit[] {
  return Array.from({ length: first.bounces }).reduce<Hit[]>((hits) => {
    const last = hits[hits.length - 1]
    const gap = BOUNCE_GAP[0] + (BOUNCE_GAP[1] - BOUNCE_GAP[0]) * random()
    return [...hits, { ...last, at: last.at + gap, gain: last.gain * BOUNCE_GAIN * (0.6 + 0.8 * random()), bounces: 0 }]
  }, [first])
}

/** Adds `h` into `samples`: a half-sine push as long as its contact drives a two-pole resonator for each of its modes. */
function ringInto(samples: Float32Array, h: Hit, sampleRate: number): void {
  const start = Math.round(h.at * sampleRate)
  const width = Math.max(1, Math.round(h.contact * sampleRate))
  const push = Array.from({ length: width }, (_, i) => Math.sin((Math.PI * (i + 0.5)) / width))
  const area = push.reduce((sum, v) => sum + v, 0)
  for (const { hz, decay, gain } of h.modes) {
    const w = (2 * Math.PI * hz) / sampleRate
    const r = Math.exp(-1 / (decay * sampleRate))
    const [a1, a2] = [2 * r * Math.cos(w), r * r]
    const drive = (h.gain * gain * Math.sin(w)) / area // a push of unit area rings the mode at amplitude `gain`
    const length = Math.min(samples.length - start, width + Math.ceil(RING_OUT * decay * sampleRate))
    let previous = 0
    let beforeThat = 0
    for (let n = 0; n < length; n++) {
      const y = (n < width ? drive * push[n] : 0) + a1 * previous - a2 * beforeThat
      samples[start + n] += y
      beforeThat = previous
      previous = y
    }
  }
}

const toPeak = (samples: Float32Array, peak: number): Float32Array => {
  const loudest = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  return loudest > 0 ? samples.map((v) => (v * peak) / loudest) : samples
}
