import { INITIAL_PROPULSION, RCS_KG_PER_DEGREE, drawRcs, isBurning, nextThrottle, refuelled, settleThrottle, stepPressure, type Propulsion } from './chemical'
import { commLink, messagesDue } from './comms'
import { LOCAL_BETA, launchLocal, localAt, localClockLimits, localPosition, orbitOf, stepLocal, timeToImpact, type Local } from './flight'
import type { Vec3 } from './galaxy'
import { ALL_GLOBES } from './exoplanets'
import { FAULT_NAMES, activeFaults, nextFaultAt, strike, type FaultId } from './failures'
import { INITIAL_HABITAT, busLoadW, crewCondition, heatersRunning, isVenting, stepHabitat, type CrewCondition, type Habitat } from './habitat'
import { CO2_SCRUBBED, UNTENDED_AIR_WARP, co2AtFace, stepCo2 } from './lifeSupport'
import { C, G0, HULL_BETA, LETHAL_DOSE, YEAR, advanceShip, betaOf, doseRate, rest, type Ship } from './physics'
import {
  LAUNCH_TARGET, TARGETS, arrivalRadius, clockLimit, distanceTo, forwardOf, launchCourse, navigate, rotated, setCourse, shipPosition, stepTurn,
  turnAngle, type Course,
} from './voyage'

const DEG = Math.PI / 180
const scaled = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dotted = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Full lever is 1 g, the classic relativistic-rocket figure. */
export const MAX_ACCELERATION = G0

const SPOOL_TIME = 1.5 // s, engine run-up
const FIELD_TIME = 0.8 // s, shield coil ramp (cosmetic; the shield itself is ideal)
const WAKE_TIME = 3 // s, from a cold cabin to every system lit
const LIGHTS_TIME = 0.18 // s, cabin lights ramping up
const SHUTTER_TRAVEL = 2.6 // s, fully open to fully closed
const TINT_TIME = 0.45 // s, the glass darkening
const DIM_TIME = 0.15 // s, the instrument lights

/** The pilot's clock, ship seconds per real second: a second, ten, a minute, ten, an hour, a day, a week, a month, a year. */
export const CLOCK_STEPS: readonly number[] = [1, 10, 60, 600, 3600, 86_400, 604_800, YEAR / 12, YEAR]
const CLOCK_AT_START = 2 // a minute a second: the Earth falls behind at a pace the eye can follow

/** The circuit breakers on the overhead block, each feeding one system from the bus. */
export interface Breakers {
  readonly nav: boolean // navigation screen, indicators on the glass, course selector, brake callout
  readonly comms: boolean // radio and its screen
  readonly dosimeter: boolean // radiation screen and Geiger counter
  readonly camera: boolean // rear monitor
}
export type Breaker = keyof Breakers
const BREAKERS_IN: Breakers = { nav: true, comms: true, dosimeter: true, camera: true }

export type LogLevel = 'info' | 'caution' | 'warning'
/** A line of the ship's log: when, by both clocks, and what. */
export interface LogEntry {
  readonly tau: number // ship s
  readonly earth: number // galaxy-frame s: the Earth's clock
  readonly text: string
  readonly level: LogLevel
}
const LOG_LENGTH = 50

export interface SimState {
  readonly ship: Ship
  readonly course: Course
  readonly clock: number // the pilot's setting, an index into CLOCK_STEPS
  readonly warp: number // ship s per real s, as the clock runs now: the setting, or less while something needs the pilot
  readonly busOn: boolean // the main bus: every system but the clocks' luminous hands draws from it
  readonly armed: boolean // the engine's arming switch
  readonly breakers: Breakers
  readonly engineOn: boolean // where the start switch is; the engine runs only if armed and powered too
  readonly spool: number // 0..1
  readonly throttle: number // -1 (full braking) .. 1 (full thrust)
  readonly shieldOn: boolean
  readonly field: number // 0..1
  readonly dose: number // Sv, accumulated by the crew
  readonly alarm: boolean
  readonly power: number // 0..1; rises while the bus is on, and drops to nothing the moment it goes off
  readonly cabinLightsOn: boolean
  readonly lights: number // 0..1
  readonly hudOn: boolean
  readonly shuttersClosed: boolean
  readonly shutters: number // 0 open .. 1 closed
  readonly filterOn: boolean
  readonly filter: number // 0 clear .. 1 fully tinted
  readonly instrumentsDimmed: boolean
  readonly dim: number // 0 full .. 1 night level
  readonly messagesHeard: number // of MESSAGES in comms.ts, received while the link with the Earth was up
  readonly fansOn: boolean
  readonly scrubberOn: boolean
  readonly co2: number // mm Hg in the cabin air
  readonly faultsAcked: number // bits of the annunciator's faults that the pilot has acknowledged; see annunciator.ts
  readonly targetCursor: number // index into TARGETS of the row lit on the target screen; ВЫБРАТЬ aims the ship at it
  readonly mailArrivedAt: readonly number[] // ship s at which each message heard came in, in the order of MESSAGES
  readonly mailRead: number // bits of the messages opened on the desk; ponytail: 32 at most, an array when there are more
  readonly track: readonly Vec3[] // ly, galactic: where each leg before this one began, for the map
  readonly habitat: Habitat // power, heat, air and the crew's body: habitat.ts
  readonly busTripped: boolean // the bus's breaker threw itself on an overload or a flat battery; the switch resets it
  readonly faultSeed: number // the random state the faults are drawn from: failures.ts
  readonly nextFaultAt: number // ship s; Infinity in a flight without faults
  readonly faultsSeen: readonly FaultId[] // the open faults as the log last wrote them, to log each one opening and closing
  readonly log: readonly LogEntry[] // newest first
  readonly local: Local | null // flight by a body below 30 km/s (flight.ts); null on a light-mode leg
  readonly propulsion: Propulsion // the chemical engine and its tanks (chemical.ts)
  readonly lightModeOn: boolean // СВЕТОВОЙ РЕЖИМ: the main engine runs only with it
  readonly manualAttitude: boolean // РУЧН: the keys turn the ship; АВТО: ВЫБРАТЬ does
  readonly stick: Vec3 // the attitude command about the ship's axes, each −1..1: pitch up, yaw left, roll left
  readonly burnStartedAt: number | null // ship s when the chemical engine lit, for the event timer
  readonly wrecked: boolean // the ship struck a body's air or ground: the crew is dead and the flight over
}

/** The bus on, the light mode engaged and the engine armed, as at the end of the checklist. */
export const readyForStart = (s: SimState): SimState => ({ ...s, busOn: true, lightModeOn: true, armed: true })

/**
 * Where a flight begins: on its circular orbit by the Earth; at rest out along the course for ?x=, with the light
 * mode on, since there is nothing near to fly by; under way for ?beta=.
 */
function launchPlace(phi: number, x: number): Pick<SimState, 'ship' | 'course' | 'local' | 'lightModeOn' | 'track'> {
  const launch = launchCourse()
  const ship = { ...rest(), phi, x }
  if (phi > 0) return { ship, course: launch, local: null, lightModeOn: true, track: [] }
  const local = x > 0 ? localAt(shipPosition(launch, x), [0, 0, 0]) : launchLocal(launch)
  const course = { ...launch, origin: localPosition(local), startX: x }
  return { ship, course, local, lightModeOn: x > 0, track: x > 0 ? [launch.origin] : [] }
}

const coldSim = (phi: number, x: number): SimState => ({
  ...launchPlace(phi, x),
  propulsion: INITIAL_PROPULSION,
  manualAttitude: false,
  stick: [0, 0, 0],
  burnStartedAt: null,
  wrecked: false,
  clock: CLOCK_AT_START,
  warp: CLOCK_STEPS[CLOCK_AT_START],
  busOn: false,
  armed: false,
  breakers: BREAKERS_IN,
  engineOn: false,
  spool: 0,
  throttle: 0,
  shieldOn: false,
  field: 0,
  dose: 0,
  alarm: false,
  power: 0,
  cabinLightsOn: false,
  lights: 0,
  hudOn: true,
  shuttersClosed: false,
  shutters: 0,
  filterOn: false,
  filter: 0,
  instrumentsDimmed: false,
  dim: 0,
  messagesHeard: 0,
  fansOn: true,
  scrubberOn: true,
  co2: CO2_SCRUBBED,
  faultsAcked: 0,
  targetCursor: LAUNCH_TARGET,
  mailArrivedAt: [],
  mailRead: 0,
  habitat: INITIAL_HABITAT,
  busTripped: false,
  faultSeed: 0,
  nextFaultAt: Infinity,
  faultsSeen: [],
  log: [],
})

/** Faults drawn from `seed`, the first somewhere ahead of the ship's clock; without a seed, none: a test's flight runs clean. */
const withFaults = (s: SimState, seed: number | null): SimState => {
  if (seed === null) return s
  const next = nextFaultAt(s.ship.tau, s.habitat, seed)
  return { ...s, faultSeed: next.seed, nextFaultAt: next.at }
}

/** A new flight starts cold. A ?beta= jump arrives powered, armed and shielded: unshielded it kills the crew on frame one. */
export const initialSim = (phi = 0, x = 0, seed: number | null = null): SimState =>
  withFaults(phi > 0 ? { ...readyForStart(coldSim(phi, x)), power: 1, shieldOn: true, field: 1 } : coldSim(phi, x), seed)

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export const toggleBus = (s: SimState): SimState => ({ ...s, busOn: !s.busOn, busTripped: false })
const withHabitat = (s: SimState, change: Partial<Habitat>): SimState => ({ ...s, habitat: { ...s.habitat, ...change } })
/** Started again after a scram, the reactor's fault is dealt with. */
export const toggleReactor = (s: SimState): SimState => withHabitat(s, { reactorOn: !s.habitat.reactorOn, reactorScrammed: false })
export const toggleHeater = (s: SimState, which: 1 | 2): SimState =>
  withHabitat(s, which === 1 ? { heater1On: !s.habitat.heater1On } : { heater2On: !s.habitat.heater2On })
export const SETPOINT_RANGE = [16, 28] as const // °C the thermostat can be set to: choice, round NASA's 18–27 °C
export const stepSetpoint = (s: SimState, step: 1 | -1): SimState =>
  withHabitat(s, { setpoint: clamp(s.habitat.setpoint + step, SETPOINT_RANGE[0], SETPOINT_RANGE[1]) })
export const toggleO2Generator = (s: SimState): SimState => withHabitat(s, { o2GenOn: !s.habitat.o2GenOn })
/** A stuck vent does not answer its switch: only the isolation valve closes its line. */
export const toggleVent = (s: SimState): SimState => (s.habitat.ventStuck ? s : withHabitat(s, { ventOpen: !s.habitat.ventOpen }))
export const toggleIsolation = (s: SimState): SimState => withHabitat(s, { ventIsolated: !s.habitat.ventIsolated })
export const toggleRepress = (s: SimState): SimState => withHabitat(s, { repressOn: !s.habitat.repressOn })
export const toggleArm = (s: SimState): SimState => ({ ...s, armed: !s.armed })
export const toggleBreaker = (s: SimState, breaker: Breaker): SimState =>
  ({ ...s, breakers: { ...s.breakers, [breaker]: !s.breakers[breaker] } })
export const toggleFans = (s: SimState): SimState => ({ ...s, fansOn: !s.fansOn })
export const toggleScrubber = (s: SimState): SimState => ({ ...s, scrubberOn: !s.scrubberOn })
export const toggleEngine = (s: SimState): SimState => ({ ...s, engineOn: !s.engineOn })
export const toggleLightMode = (s: SimState): SimState => ({ ...s, lightModeOn: !s.lightModeOn })
/** АВТО / РУЧН; the stick is let go either way. */
export const toggleManualAttitude = (s: SimState): SimState => ({ ...s, manualAttitude: !s.manualAttitude, stick: [0, 0, 0] })
const withPropulsion = (s: SimState, change: Partial<Propulsion>): SimState => ({ ...s, propulsion: { ...s.propulsion, ...change } })
export const togglePressurisation = (s: SimState): SimState => withPropulsion(s, { pressurised: !s.propulsion.pressurised })
export const toggleFeed = (s: SimState): SimState => withPropulsion(s, { feedOpen: !s.propulsion.feedOpen })
export const toggleCrossfeed = (s: SimState): SimState => withPropulsion(s, { crossfeedOpen: !s.propulsion.crossfeedOpen })
export const toggleChemEngine = (s: SimState): SimState => withPropulsion(s, { engineOn: !s.propulsion.engineOn })
export const nudgeChemThrottle = (s: SimState, step: 1 | -1): SimState =>
  withPropulsion(s, { throttle: nextThrottle(s.propulsion.throttle, step) })
/** The chemical engine's lever let go at `value`: it rests off, at 10–60 % or full (chemical.ts). */
export const setChemThrottle = (s: SimState, value: number): SimState => withPropulsion(s, { throttle: settleThrottle(Math.min(1, Math.max(0, value))) })
/** АВАРИЙНАЯ ОТСЕЧКА: both start switches off at once; the levers stay where they are. */
export const cutOff = (s: SimState): SimState => ({ ...withPropulsion(s, { engineOn: false }), engineOn: false })
/** The attitude command from the keys, about the ship's axes: pitch up, yaw left, roll left, each −1..1. */
export const setStick = (s: SimState, stick: Vec3): SimState => ({ ...s, stick })
export const toggleShield = (s: SimState): SimState => ({ ...s, shieldOn: !s.shieldOn })
export const toggleCabinLights = (s: SimState): SimState => ({ ...s, cabinLightsOn: !s.cabinLightsOn })
export const toggleHud = (s: SimState): SimState => ({ ...s, hudOn: !s.hudOn })
export const toggleShutters = (s: SimState): SimState => ({ ...s, shuttersClosed: !s.shuttersClosed })
export const toggleFilter = (s: SimState): SimState => ({ ...s, filterOn: !s.filterOn })
export const toggleInstrumentsDim = (s: SimState): SimState => ({ ...s, instrumentsDimmed: !s.instrumentsDimmed })
export const setThrottle = (s: SimState, value: number): SimState => ({ ...s, throttle: clamp(value, -1, 1) })
export const nudgeThrottle = (s: SimState, delta: number): SimState => setThrottle(s, s.throttle + delta)
export const turnClock = (s: SimState, step: 1 | -1): SimState => ({ ...s, clock: clamp(s.clock + step, 0, CLOCK_STEPS.length - 1) })
/** Ship seconds per real second that the pilot has set the clock to. */
export const clockSetting = (s: SimState): number => CLOCK_STEPS[s.clock]
/**
 * A new target. In АВТО the thrusters turn the ship to it and burn their propellant for the turn; dry, the ship does not
 * turn and the target stays as it was. In РУЧН the target changes and the pilot turns the ship.
 */
export function selectTarget(s: SimState, target: number): SimState {
  const set = setCourse(s.course, s.ship, target)
  const course = s.manualAttitude ? { ...set, turn: null } : set
  const propulsion = course.turn
    ? drawRcs(s.propulsion, (RCS_KG_PER_DEGREE * turnAngle(course.turn.from, course.turn.to)) / DEG)
    : s.propulsion
  if (propulsion === null) return s
  const isSameLeg = course.origin.every((v, i) => v === s.course.origin[i]) // the ship has not moved off it
  return { ...s, course, propulsion, track: isSameLeg ? s.track : [...s.track, s.course.origin] }
}
/** A letter opened on the desk. */
export const readLetter = (s: SimState, index: number): SimState => ({ ...s, mailRead: s.mailRead | (1 << index) })
export const isLetterRead = (s: SimState, index: number): boolean => (s.mailRead & (1 << index)) !== 0
const isNavFed = (s: SimState): boolean => s.busOn && s.breakers.nav
/** The arrows on the target screen move its highlight through the table, and round again; the ship keeps its course. */
export const moveTargetCursor = (s: SimState, step: 1 | -1): SimState =>
  isNavFed(s) ? { ...s, targetCursor: (s.targetCursor + step + TARGETS.length) % TARGETS.length } : s
/**
 * ВЫБРАТЬ aims the ship at the highlighted body, at rest only. Stopped past the target, pressed on it again, it aims the
 * ship back at it: that is the way home from an overshoot.
 */
export const confirmTarget = (s: SimState): SimState => (isNavFed(s) ? selectTarget(s, s.targetCursor) : s)

/** The main engine runs in the light mode only: armed, started and powered. */
export const isEngineLive = (s: SimState): boolean => s.engineOn && s.armed && s.busOn && s.lightModeOn
/** The chemical engine burns, by a body only. */
export const isChemBurning = (s: SimState): boolean => s.local !== null && !s.wrecked && isBurning(s.propulsion, s.busOn, s.lightModeOn)
/** The crew's condition: as their bodies have taken it, or dead with the ship. */
export const crewOf = (s: SimState): CrewCondition => (s.wrecked ? 'погиб' : crewCondition(s.habitat, s.dose))
export const isShielded = (s: SimState): boolean => s.shieldOn && s.busOn

/** The main engine is held while the attitude thrusters turn the ship. */
export const properAcceleration = (s: SimState): number =>
  isEngineLive(s) && !s.course.turn ? MAX_ACCELERATION * s.throttle * s.spool : 0

const isScrubbing = (s: SimState): boolean => s.busOn && s.scrubberOn
/** The fans stir the air, and so does any thrust: it gives the cabin an up, and warm breath rises. */
const isAirStirred = (s: SimState): boolean => (s.busOn && s.fansOn) || properAcceleration(s) !== 0 || isChemBurning(s)
/** mm Hg of CO₂ in the air the pilot breathes. */
export const faceCo2 = (s: SimState): number => co2AtFace(s.co2, isAirStirred(s))
/** The life support as it is left to run on its own: the heat, the oxygen and the power all looking after themselves. */
const isHabitatNominal = ({ habitat: h }: SimState): boolean => heatersRunning(h) > 0 && h.o2GenOn && !isVenting(h) && h.reactorOn
/** The clock flies only while the ship looks after the air and the habitat by itself. */
const isAirTended = (s: SimState): boolean => isScrubbing(s) && isAirStirred(s) && isHabitatNominal(s)

/** W the ship draws from the bus besides the habitat's heaters and oxygen generator: each a choice, in FORMULAS.md. */
export const LOADS_W = {
  core: 150, // the screens of the panel, the annunciator, the lamps
  nav: 100, comms: 150, dosimeter: 20, camera: 20, // behind their breakers
  lights: 240, // eight 30 W lamps (R: an ISS ceiling light, NTRS 20090022250)
  fans: 100,
  scrubber: 300, // a CDRA for 4+ crew takes 1100 W (R: ICES-2020-178); for one, a third of that
  desk: 190, // its computer and three screens
} as const
/** W drawn from the reactor and the battery now: the main bus's loads and the life-support bus's. */
export const totalLoadW = (s: SimState): number => busLoadW(s.habitat, { busOn: s.busOn, baseLoadW: baseLoadW(s) })

export function baseLoadW(s: SimState): number {
  if (!s.busOn) return 0
  const breakers = (Object.keys(s.breakers) as Breaker[]).reduce((sum, b) => sum + (s.breakers[b] ? LOADS_W[b] : 0), 0)
  return LOADS_W.core + LOADS_W.desk + breakers + (s.cabinLightsOn ? LOADS_W.lights : 0) + (s.fansOn ? LOADS_W.fans : 0)
    + (s.scrubberOn ? LOADS_W.scrubber : 0)
}

/**
 * What holds the clock below its setting: the brake point or the stop ahead, air that the ship does not tend, a fault;
 * by a body, the chemical engine burning, the orbit going round, or a strike ahead.
 */
export type ClockHold = 'brake' | 'arrival' | 'air' | 'fault' | 'burn' | 'orbit' | 'impact' | null

/** Ship s per real s while a fault is open: choice, so that the hours a fault leaves before harm are a minute or two at the desk. */
export const FAULT_WARP = 150
/** Ship s per real s while the chemical engine burns: choice, so that leaving the launch orbit takes most of a minute. */
export const BURN_WARP = 60

/** The fastest the clock may run now, and what holds it there if that is below the pilot's setting; ties go to the first. */
function clockCeiling(s: SimState): { readonly warp: number; readonly hold: ClockHold } {
  const acceleration = properAcceleration(s)
  const local = s.local ? localClockLimits(s.local) : { orbit: Infinity, impact: Infinity }
  const limits: ReadonlyArray<readonly [number, ClockHold]> = [
    [activeFaults(s.habitat).length > 0 ? FAULT_WARP : Infinity, 'fault'],
    [isAirTended(s) ? Infinity : UNTENDED_AIR_WARP, 'air'],
    [clockLimit(s.course, s.ship, acceleration), acceleration < 0 ? 'arrival' : 'brake'],
    [local.impact, 'impact'],
    [isChemBurning(s) ? BURN_WARP : Infinity, 'burn'],
    [local.orbit, 'orbit'],
  ]
  const [limit, hold] = limits.reduce((low, next) => (next[0] < low[0] ? next : low))
  return limit < clockSetting(s) ? { warp: limit, hold } : { warp: clockSetting(s), hold: null }
}

export const clockHold = (s: SimState): ClockHold => clockCeiling(s).hold

/**
 * The brake callout: the full-braking distance has reached the stopping point and the ship is not braking.
 * ponytail: any braking silences it, even a lever only part way back that will overshoot; the HUD still says ТОРМОЗИ.
 */
export const isBrakingOverdue = (s: SimState): boolean =>
  navigate(s.course, s.ship).cue === 'brake' && properAcceleration(s) >= 0

export type TimerEvent = 'impact' | 'burn' | 'brake' | 'periapsis'
/** An orbit rounder than this has no periapsis worth timing: choice; the launch orbit is round to 10⁻¹⁵. */
const ROUND_ORBIT = 1e-3
export interface Timer {
  readonly event: TimerEvent
  readonly seconds: number // ship s: to the event, or for a burn how long it has run
}

/**
 * The event timer: what comes next that the pilot must time, the most pressing first: a strike ahead, the burn going on,
 * the brake point of a leg, the periapsis. ponytail: the brake point at the present speed, as if the ship coasted to it.
 */
export function eventTimer(s: SimState): Timer | null {
  const strike = s.local ? timeToImpact(s.local) : null
  if (strike !== null) return { event: 'impact', seconds: strike }
  if (s.burnStartedAt !== null) return { event: 'burn', seconds: s.ship.tau - s.burnStartedAt }
  if (!s.local) {
    const nav = navigate(s.course, s.ship)
    const pace = C * Math.sinh(s.ship.phi)
    return pace > 0 && nav.toGo > nav.braking ? { event: 'brake', seconds: (nav.toGo - nav.braking) / pace } : null
  }
  const orbit = orbitOf(s.local)
  const hasPeriapsis = orbit !== null && orbit.elements.eccentricity > ROUND_ORBIT && Number.isFinite(orbit.elements.timeToPeriapsis)
  return hasPeriapsis ? { event: 'periapsis', seconds: orbit.elements.timeToPeriapsis } : null
}

/** Ship seconds per real second, this moment. */
export const currentWarp = (s: SimState): number => s.warp

/**
 * The clock may slow at once, so that it is slow by the time a decision is due, but it speeds up by at most a factor
 * e every WARP_RISE_TIME: turning it up, or a hold coming off, would otherwise jump it by orders of magnitude in one frame.
 */
const WARP_RISE_TIME = 0.5 // s

let current = initialSim()

/** The single live state. Every read gets an immutable snapshot; every change replaces it. */
export const sim = {
  get: (): SimState => current,
  update: (change: (s: SimState) => SimState): void => {
    current = change(current)
  },
}

/** °/s, real time, the attitude thrusters turn the ship at about each axis with the key held: choice. */
export const MANUAL_RATE = 3 * DEG

/**
 * In РУЧН, by a body and powered, the keys turn the ship at MANUAL_RATE about its own axes, in real seconds as the
 * automatic turn goes, so that a fast clock does not whirl it; each degree costs the thrusters' propellant.
 */
function steer(s: SimState, course: Course, dtReal: number): Pick<SimState, 'course' | 'propulsion'> {
  const still = { course, propulsion: s.propulsion }
  if (!s.local || !s.manualAttitude || course.turn || !s.busOn) return still
  const omega = scaled(s.stick, MANUAL_RATE * dtReal)
  const degrees = Math.hypot(...omega) / DEG
  const propulsion = degrees > 0 ? drawRcs(s.propulsion, RCS_KG_PER_DEGREE * degrees) : null
  return propulsion ? { course: { ...course, attitude: rotated(course.attitude, omega) }, propulsion } : still
}

type Motion = Pick<SimState, 'ship' | 'course' | 'local' | 'propulsion' | 'wrecked' | 'track'>

/**
 * `dTau` ship seconds of motion. By a body the ship coasts on its orbit or the chemical engine pushes it; once the main
 * engine pushes, a leg begins where it is, at its speed along the nose, the rest of its motion let go (ponytail: km/s
 * against a leg at light speed). A leg that slows below LOCAL_BETA ends by the body there, its last speed carried over,
 * and where it began goes into the track for the map; ended near its target, it finds the tanks full (convention).
 */
function move(s: SimState, acceleration: number, dTau: number): Motion {
  const { ship, course, local, propulsion, track } = s
  if (local && acceleration <= 0) {
    const step = stepLocal(local, propulsion, course.attitude, dTau, isChemBurning(s))
    return {
      ship: { ...ship, tau: ship.tau + dTau, t: ship.t + dTau },
      course: { ...course, origin: localPosition(step.local), startX: ship.x },
      local: step.local, propulsion: step.propulsion, wrecked: step.isWrecked, track,
    }
  }
  const leg = local ? { ...course, origin: localPosition(local), startX: ship.x } : course
  const start = local ? { ...ship, phi: Math.atanh(Math.max(0, dotted(local.v, forwardOf(course.attitude))) / C) } : ship
  const moved = advanceShip(start, acceleration, dTau)
  const isBraking = acceleration < 0 && moved.phi > 0
  if (acceleration > 0 || isBraking || betaOf(moved.phi) > LOCAL_BETA) return { ship: moved, course: leg, local: null, propulsion, wrecked: false, track }
  const here = localAt(shipPosition(leg, moved.x), scaled(forwardOf(leg.attitude), C * Math.sinh(moved.phi)))
  const radius = arrivalRadius(leg)
  const isAtTarget = distanceTo(leg, { ...moved, x: leg.startX }, leg.target) > radius && distanceTo(leg, moved, leg.target) < radius
  return {
    ship: { ...moved, phi: 0 }, course: { ...leg, origin: localPosition(here), startX: moved.x }, local: here,
    propulsion: isAtTarget ? refuelled(propulsion) : propulsion, wrecked: false, track: [...track, leg.origin],
  }
}

/** One frame of simulation; `dtReal` is in real seconds. A wrecked ship is still. */
export function stepSim(s: SimState, dtReal: number): SimState {
  if (s.wrecked) return s
  const approach = (value: number, target: number, tau: number): number =>
    value + (target - value) * (1 - Math.exp(-dtReal / tau))
  const spool = approach(s.spool, isEngineLive(s) ? 1 : 0, SPOOL_TIME)
  const field = approach(s.field, isShielded(s) ? 1 : 0, FIELD_TIME)
  const steered = steer(s, stepTurn(s.course, dtReal), dtReal)
  const acceleration = properAcceleration({ ...s, spool, course: steered.course })
  const warp = Math.min(clockCeiling({ ...s, spool, ...steered }).warp, s.warp * Math.exp(dtReal / WARP_RISE_TIME))
  const untilFault = Math.max(0, s.nextFaultAt - s.ship.tau)
  const dTau = Math.min(dtReal * warp, untilFault) // a fault ends the frame where it strikes: the clock drops from there
  const motion = move({ ...s, course: steered.course, propulsion: stepPressure(steered.propulsion, dTau) }, acceleration, dTau)
  const { ship, course } = motion
  const burnStartedAt = isChemBurning({ ...s, ...motion }) ? (s.burnStartedAt ?? s.ship.tau) : null
  const dose = s.dose + (isShielded(s) ? 0 : doseRate(ship.phi) * dTau) // ponytail: ideal shield, no leakage model
  const isExposed = !isShielded(s) && betaOf(ship.phi) >= HULL_BETA
  const power = s.busOn ? Math.min(1, s.power + dtReal / WAKE_TIME) : 0
  const lights = approach(s.lights, s.cabinLightsOn && s.busOn ? 1 : 0, LIGHTS_TIME)
  const shutters = clamp(s.shutters + ((s.shuttersClosed ? 1 : -1) * dtReal) / SHUTTER_TRAVEL, 0, 1)
  const filter = approach(s.filter, s.filterOn ? 1 : 0, TINT_TIME)
  const dim = approach(s.dim, s.instrumentsDimmed ? 1 : 0, DIM_TIME)
  // The Earth repeats every message, so whatever its light has brought is heard as soon as the link is up.
  const link = commLink(course, ship)
  const isListening = link.isUp && s.busOn && s.breakers.comms
  const messagesHeard = isListening ? Math.max(s.messagesHeard, messagesDue(link.earthSeen)) : s.messagesHeard
  const mailArrivedAt = messagesHeard > s.messagesHeard
    ? [...s.mailArrivedAt, ...Array.from({ length: messagesHeard - s.messagesHeard }, () => ship.tau)]
    : s.mailArrivedAt
  const co2 = stepCo2(s.co2, isScrubbing(s), dTau)
  const { habitat, tripped } = stepHabitat(s.habitat, { busOn: s.busOn, baseLoadW: baseLoadW(s) }, dTau)
  const stepped: SimState = {
    ...s, ...motion, burnStartedAt, warp, spool, field, dose, alarm: isExposed || dose >= LETHAL_DOSE || motion.wrecked, power, lights, shutters,
    filter, dim, messagesHeard,
    mailArrivedAt, co2, habitat, busOn: s.busOn && !tripped, busTripped: s.busTripped || tripped,
  }
  return withLog(s, dtReal * warp >= untilFault ? strikeNow(stepped) : stepped)
}

/** The fault due now strikes, and the next one is drawn. */
function strikeNow(s: SimState): SimState {
  const struck = strike(s.habitat, s.faultSeed)
  const next = nextFaultAt(s.ship.tau, struck.habitat, struck.seed)
  return { ...s, habitat: struck.habitat, faultSeed: next.seed, nextFaultAt: next.at }
}

const FAULT_LEVEL: Readonly<Record<FaultId, LogLevel>> = { reactor: 'caution', heater: 'caution', vent: 'warning' }
const CREW_LOG: Readonly<Record<CrewCondition, readonly [string, LogLevel]>> = {
  норма: ['Экипаж в норме', 'info'], гипоксия: ['Экипаж: гипоксия', 'warning'],
  переохлаждение: ['Экипаж: переохлаждение', 'warning'], погиб: ['Экипаж погиб', 'warning'],
}
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
/** The log's line for a wreck: the air or the ground of the body that pulled the ship. */
const wreckText = (s: SimState): string => {
  const globe = s.local?.centre != null ? ALL_GLOBES[s.local.centre] : null
  if (!globe) return 'Корабль разрушен'
  return `Корабль разрушен: ${globe.ceiling > 0 ? 'вход в атмосферу' : 'удар о поверхность'}, ${globe.name}`
}

/**
 * What this frame brought, written to the log: faults opening and closing (the crew's switches close them between frames,
 * so they are compared with the last ones written), a tripped bus, letters, and the crew's condition.
 */
function withLog(before: SimState, after: SimState): SimState {
  const open = activeFaults(after.habitat)
  const crew = crewOf(after)
  // the least pressing first: written newest first, the frame's faults end up on top
  const lines: ReadonlyArray<readonly [string, LogLevel]> = [
    ...Array.from({ length: after.messagesHeard - before.messagesHeard }, () => ['Письмо от ЦУП', 'info'] as const),
    ...before.faultsSeen.filter((f) => !open.includes(f)).map((f) => [`Устранено: ${FAULT_NAMES[f]}`, 'info'] as const),
    ...(after.busTripped && !before.busTripped ? [['Главная шина сработала', 'warning'] as const] : []),
    ...(after.wrecked && !before.wrecked ? [[wreckText(after), 'warning'] as const] : []),
    ...(crew !== crewOf(before) ? [CREW_LOG[crew]] : []),
    ...open.filter((f) => !before.faultsSeen.includes(f)).map((f) => [`Отказ: ${FAULT_NAMES[f]}`, FAULT_LEVEL[f]] as const),
  ]
  if (lines.length === 0 && open.length === before.faultsSeen.length) return after
  const entries = lines.map(([text, level]) => ({ tau: after.ship.tau, earth: after.ship.t, text: capital(text), level }))
  return { ...after, faultsSeen: open, log: [...entries.reverse(), ...after.log].slice(0, LOG_LENGTH) }
}
