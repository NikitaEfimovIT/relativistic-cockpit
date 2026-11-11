import { isCalling, masterAlarm } from './annunciator'
import { geigerRate } from './cabinLogic'
import { LEVEL_SPREAD_DB, SOUNDS, renderSound, type Sound } from './clicks'
import { G0, doseRate } from './physics'
import { isShielded, properAcceleration, type SimState } from './sim'
import { createSolitude, type Solitude } from './solitude'

// The switches, buttons, keys and relays play recordings of real ones (public/sounds, CC0, see FORMULAS); everything
// else is synthesised, and so are they until their files have loaded, or if they fail to.

interface AudioRig {
  readonly ctx: AudioContext
  readonly master: GainNode // the machinery goes in here
  readonly muffle: BiquadFilterNode // the trim between the machinery and the pilot
  readonly rumbleGain: GainNode
  readonly rumbleFilter: BiquadFilterNode
  readonly humGain: GainNode
  readonly shieldGain: GainNode
  readonly alarmGain: GainNode
  readonly crackleGain: GainNode
  readonly ventGain: GainNode
  readonly servoGain: GainNode
  readonly noise: AudioBuffer
  readonly solitude: Solitude
}

let rig: AudioRig | null = null

// The machinery is heard through the cabin's trim: one level for all of it, and a gentle cut of the top. Both are choices.
// The controls under the pilot's hand are heard directly, each at its own level (clicks.ts).
const MASTER_GAIN = 0.6
const MUFFLE_HZ = 4500

// How loud the machinery runs: a quarter (−12 dB) of the first mix, which drowned the switches.
const RUMBLE_IDLE = 0.0125 // the engine spooled up, without thrust
const RUMBLE_THRUST = 0.125 // more at full thrust, either way
const HUM = 0.02
const SHIELD = 0.0045
const SERVOS = 0.00875

function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    data[i] = last * 3.5
  }
  return buffer
}

function buildRig(): AudioRig {
  const ctx = new AudioContext()
  // The render loop stops in a hidden tab, so nothing else would fade the engine or the alarm out.
  document.addEventListener('visibilitychange', () => {
    void (document.hidden ? ctx.suspend() : ctx.resume())
  })
  const muffle = ctx.createBiquadFilter()
  muffle.type = 'lowpass'
  muffle.frequency.value = MUFFLE_HZ
  muffle.Q.value = 0.5
  muffle.connect(ctx.destination)
  const master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(muffle)
  const gainInto = (destination: AudioNode, value = 0): GainNode => {
    const gain = ctx.createGain()
    gain.gain.value = value
    gain.connect(destination)
    return gain
  }

  const noise = brownNoise(ctx, 4)
  const rumbleGain = gainInto(master)
  const rumbleFilter = ctx.createBiquadFilter()
  rumbleFilter.type = 'lowpass'
  rumbleFilter.connect(rumbleGain)
  const rumble = ctx.createBufferSource()
  rumble.buffer = noise
  rumble.loop = true
  rumble.connect(rumbleFilter)
  rumble.start()

  const humGain = gainInto(master)
  const humFilter = ctx.createBiquadFilter()
  humFilter.type = 'lowpass'
  humFilter.frequency.value = 170
  humFilter.connect(humGain)
  const hum = ctx.createOscillator()
  hum.type = 'sawtooth'
  hum.frequency.value = 38
  hum.connect(humFilter)
  hum.start()

  const shieldGain = gainInto(master)
  for (const frequency of [146, 147.5, 293]) {
    const coil = ctx.createOscillator()
    coil.frequency.value = frequency
    coil.connect(shieldGain)
    coil.start()
  }

  const alarmGain = gainInto(master)
  const alarm = ctx.createOscillator()
  alarm.type = 'square'
  alarm.frequency.value = 760
  alarm.connect(alarmGain)
  alarm.start()
  const warble = ctx.createOscillator()
  warble.type = 'square'
  warble.frequency.value = 2.2
  const warbleDepth = ctx.createGain()
  warbleDepth.gain.value = 130
  warbleDepth.connect(alarm.frequency)
  warble.connect(warbleDepth)
  warble.start()

  // Above what single clicks can follow, the counter becomes a continuous crackle.
  const crackleGain = gainInto(master)
  const crackleFilter = ctx.createBiquadFilter()
  crackleFilter.type = 'bandpass'
  crackleFilter.frequency.value = GEIGER_BAND_HZ
  crackleFilter.Q.value = 0.9
  crackleFilter.connect(crackleGain)
  const crackle = ctx.createBufferSource()
  crackle.buffer = noise
  crackle.loop = true
  crackle.connect(crackleFilter)
  crackle.start()

  // The fans: the sound a powered cabin makes when nothing else is happening.
  const ventGain = gainInto(master)
  const ventFilter = ctx.createBiquadFilter()
  ventFilter.type = 'bandpass'
  ventFilter.frequency.value = 520
  ventFilter.Q.value = 0.5
  ventFilter.connect(ventGain)
  const vent = ctx.createBufferSource()
  vent.buffer = noise
  vent.loop = true
  vent.playbackRate.value = 1.7
  vent.connect(ventFilter)
  vent.start()

  // The shutter motors.
  const servoGain = gainInto(master)
  const servoFilter = ctx.createBiquadFilter()
  servoFilter.type = 'lowpass'
  servoFilter.frequency.value = 900
  servoFilter.connect(servoGain)
  for (const frequency of [118, 177.5]) {
    const servo = ctx.createOscillator()
    servo.type = 'sawtooth'
    servo.frequency.value = frequency
    servo.connect(servoFilter)
    servo.start()
  }

  const solitude = createSolitude(ctx, master)

  return { ctx, master, muffle, rumbleGain, rumbleFilter, humGain, shieldGain, alarmGain, crackleGain, ventGain, servoGain, noise, solitude }
}

/** Browsers only allow audio after a user gesture, so this is called from the first one. */
export function startAudio(): void {
  if (rig) {
    void rig.ctx.resume()
    return
  }
  try {
    rig = buildRig()
  } catch (error: unknown) {
    console.warn('Sound is unavailable; the simulator carries on silently.', error)
    return
  }
  loadTakes(rig.ctx)
}

/** Takes cut from recordings of real controls, each its sound's: a press plays one of them. */
const SOUNDS_URL = `${import.meta.env.BASE_URL}sounds/` // under the site's base: on GitHub Pages it is the repository's
export const RECORDINGS: Readonly<Partial<Record<Sound, readonly string[]>>> = {
  switch: Array.from({ length: 8 }, (_, i) => `${SOUNDS_URL}toggle-${i + 1}.wav`),
  guardedSwitch: [`${SOUNDS_URL}guarded-toggle.wav`], // the recording's one clean flip; its pitch and level still vary per press
  buttonDown: [`${SOUNDS_URL}button-down.wav`],
  buttonUp: [`${SOUNDS_URL}button-up.wav`],
  keyDown: [`${SOUNDS_URL}key-down.wav`],
  keyUp: [`${SOUNDS_URL}key-up.wav`],
  relay: [`${SOUNDS_URL}relay.wav`],
}
const TAKE_PITCH_SPREAD = 0.03 // either way, as the synthesised clicks vary

interface Take {
  readonly buffer: AudioBuffer
  readonly gain: number // brings its peak to its sound's level (clicks.ts)
}

let takes: Readonly<Partial<Record<Sound, readonly Take[]>>> = {}

async function loadTake(ctx: AudioContext, sound: Sound, path: string): Promise<Take> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  const buffer = await ctx.decodeAudioData(await response.arrayBuffer())
  const loudest = buffer.getChannelData(0).reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  if (loudest === 0) throw new Error(`${path} is silent`)
  return { buffer, gain: 10 ** (SOUNDS[sound].level / 20) / loudest }
}

/** Loads every take; a sound whose files fail keeps its synthesised click. */
function loadTakes(ctx: AudioContext): void {
  for (const [sound, paths] of Object.entries(RECORDINGS) as Array<[Sound, readonly string[]]>) {
    Promise.all(paths.map((path) => loadTake(ctx, sound, path)))
      .then((loaded) => { takes = { ...takes, [sound]: loaded } })
      .catch((error: unknown) => console.warn(`The recordings of '${sound}' did not load; it stays synthesised.`, error))
  }
}

const GEIGER_BAND_HZ = 1800 // the counter's clicks and its crackle, low enough to be soft

// The counter's tick: a burst of the noise through its band, a dull tick from behind the panel, not a snap.
const GEIGER_TICK = { q: 0.8, seconds: 0.007, gain: 0.15 } as const

function playGeigerTick({ ctx, noise, master }: AudioRig): void {
  const source = ctx.createBufferSource()
  source.buffer = noise
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = GEIGER_BAND_HZ
  filter.Q.value = GEIGER_TICK.q
  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(GEIGER_TICK.gain * 4, ctx.currentTime)
  envelope.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + GEIGER_TICK.seconds)
  source.connect(filter)
  filter.connect(envelope)
  envelope.connect(master)
  source.start(ctx.currentTime, Math.random() * 3, GEIGER_TICK.seconds)
}

/** Sounds made behind the panel or in the hull: heard through the trim, like the rest of the machinery. */
const MACHINERY: ReadonlySet<Sound> = new Set<Sound>(['relay', 'clunk'])

/** A mechanical sound of the cabin: one of its recorded takes if they have loaded, else a fresh synthesis; never quite the same twice. */
export function playClick(sound: Sound): void {
  if (!rig) return
  const { ctx } = rig
  const source = ctx.createBufferSource()
  const level = ctx.createGain()
  const recorded = takes[sound]
  if (recorded) {
    const take = recorded[Math.floor(Math.random() * recorded.length)]
    source.buffer = take.buffer
    source.playbackRate.value = 1 + TAKE_PITCH_SPREAD * (2 * Math.random() - 1)
    level.gain.value = take.gain * 10 ** ((LEVEL_SPREAD_DB * (2 * Math.random() - 1)) / 20)
  } else {
    source.buffer = synthesised(ctx, sound)
  }
  source.connect(level).connect(MACHINERY.has(sound) ? rig.muffle : ctx.destination)
  source.start()
}

const synthesised = (ctx: BaseAudioContext, sound: Sound): AudioBuffer => {
  const samples = renderSound(sound, ctx.sampleRate)
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
  buffer.getChannelData(0).set(samples)
  return buffer
}

const MAX_CLICKS_PER_FRAME = 3
const CRACKLE_ONSET = 60 // clicks/s

export function playGeigerClicks(count: number): void {
  if (!rig) return
  for (let i = 0; i < Math.min(count, MAX_CLICKS_PER_FRAME); i++) playGeigerTick(rig)
}

// The brake callout: a falling two-tone chime, unlike the warbling radiation alarm, repeated until the lever goes back.
const CHIME = [988, 740] as const // Hz, B5 then F♯5
const CHIME_GAP = 0.18 // s between the two tones
const CHIME_TONE = 0.16 // s each
const CHIME_GAIN = 0.12
const CALLOUT_PERIOD = 1.2 // s

function playChime(ctx: AudioContext, out: AudioNode): void {
  CHIME.forEach((frequency, i) => {
    const at = ctx.currentTime + i * CHIME_GAP
    const tone = ctx.createOscillator()
    tone.type = 'triangle'
    tone.frequency.value = frequency
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.exponentialRampToValueAtTime(CHIME_GAIN, at + 0.01)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + CHIME_TONE)
    tone.connect(envelope).connect(out)
    tone.start(at)
    tone.stop(at + CHIME_TONE)
  })
}

// A new caution: one soft double tone, unlike the warbling klaxon of a warning and the falling brake chime.
const CAUTION_TONE = 1320 // Hz
const CAUTION_GAIN = 0.07

function playCautionTone(ctx: AudioContext, out: AudioNode): void {
  for (const delay of [0, 0.12]) {
    const at = ctx.currentTime + delay
    const tone = ctx.createOscillator()
    tone.frequency.value = CAUTION_TONE
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, at)
    envelope.gain.exponentialRampToValueAtTime(CAUTION_GAIN, at + 0.008)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.09)
    tone.connect(envelope).connect(out)
    tone.start(at)
    tone.stop(at + 0.1)
  }
}

const SMOOTHING = 0.08 // s
const RELAYS = 9 // relays that close one after another as the cabin wakes

let lastRelay = 0
let lastShutters = 0
let wereShuttersMoving = false
let nextCallout = 0 // audio-clock time of the next chime; 0 means the callout is quiet, so it starts at once
let wasCalling = false

export function updateAudio(s: SimState): void {
  if (!rig) return
  const now = rig.ctx.currentTime
  const thrust = Math.abs(properAcceleration(s)) / G0
  rig.rumbleGain.gain.setTargetAtTime(s.spool * (RUMBLE_IDLE + RUMBLE_THRUST * thrust), now, SMOOTHING)
  rig.rumbleFilter.frequency.setTargetAtTime(60 + 340 * thrust, now, SMOOTHING)
  rig.humGain.gain.setTargetAtTime(HUM * s.spool, now, SMOOTHING)
  rig.shieldGain.gain.setTargetAtTime(SHIELD * s.field, now, SMOOTHING)
  const call = masterAlarm(s)
  rig.alarmGain.gain.setTargetAtTime(call === 'warning' ? 0.03 : 0, now, SMOOTHING) // pressing the master alarm silences it
  if (call === 'caution' && !wasCalling) playCautionTone(rig.ctx, rig.master)
  wasCalling = call !== null
  const isCounting = s.busOn && s.breakers.dosimeter
  const rate = isCounting ? geigerRate(doseRate(s.ship.phi), isShielded(s)) : 0
  rig.crackleGain.gain.setTargetAtTime(0.0004 * Math.max(0, rate - CRACKLE_ONSET), now, SMOOTHING)
  rig.ventGain.gain.setTargetAtTime(s.fansOn ? 0.03 * s.power : 0, now, 0.6)

  const relay = Math.floor(s.power * RELAYS)
  if (relay > lastRelay) playClick('relay')
  lastRelay = relay

  const areShuttersMoving = s.shutters !== lastShutters
  rig.servoGain.gain.setTargetAtTime(areShuttersMoving ? SERVOS : 0, now, 0.05)
  if (wereShuttersMoving && !areShuttersMoving) playClick('clunk')
  wereShuttersMoving = areShuttersMoving
  lastShutters = s.shutters

  if (!isCalling(s, 'ТОРМОЗИ')) nextCallout = 0 // the annunciator's own callout: quiet once acknowledged
  else if (now >= nextCallout) {
    playChime(rig.ctx, rig.master)
    nextCallout = now + CALLOUT_PERIOD
  }

  rig.solitude.update(s)
}
