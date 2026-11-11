import * as THREE from 'three'
import { EXOPLANETS } from './exoplanets'
import type { Vec3 } from './galaxy'
import { BODIES, STARS, equatorialToGalactic, type Body } from './nearbyStars'
import { C, G0, LY, apparentDirection, lutXYZ, type Ship } from './physics'
import { EARTH, EARTH_RADIUS_M, LAUNCH_JD, MOON, PLANETS, earthPosition, lambertPhase, sunFromEarth, type Globe } from './solarSystem'

// The course: a straight leg from where the ship last stood still towards the star or planet it is aimed at. The ship
// turns only at rest, on its attitude thrusters, so every leg is a line and the main engine pushes along it, forwards or back.

export type Quat = readonly [number, number, number, number]

export interface Turn {
  readonly from: Quat
  readonly to: Quat
  readonly progress: number // 0..1
  readonly duration: number // real s
}

export interface Course {
  readonly target: number // index into TARGETS
  readonly origin: Vec3 // ly from the Sun, galactic axes: where this leg began
  readonly startX: number // m: the ship's galaxy-frame distance when it began
  readonly attitude: Quat // turns the ship's axes (x right, y up, z aft) into galactic ones
  readonly turn: Turn | null
}

const DEG = Math.PI / 180
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const normalise = (a: Vec3): Vec3 => scale(a, 1 / length(a))
const toThree = (q: Quat): THREE.Quaternion => new THREE.Quaternion(q[0], q[1], q[2], q[3])
const fromThree = (q: THREE.Quaternion): Quat => [q.x, q.y, q.z, q.w]
const rotate = (q: THREE.Quaternion, v: Vec3): Vec3 => {
  const r = new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(q)
  return [r.x, r.y, r.z]
}

export const shipToGalactic = (attitude: Quat, v: Vec3): Vec3 => rotate(toThree(attitude), v)
export const galacticToShip = (attitude: Quat, v: Vec3): Vec3 => rotate(toThree(attitude).invert(), v)
export const forwardOf = (attitude: Quat): Vec3 => shipToGalactic(attitude, [0, 0, -1])

/** The attitude turned by `omega`, rad about the ship's own axes (x right, y up, z aft): a small turn of the thrusters. */
export function rotated(attitude: Quat, omega: Vec3): Quat {
  const angle = length(omega)
  if (angle === 0) return attitude
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...scale(omega, 1 / angle)), angle)
  return fromThree(toThree(attitude).multiply(turn).normalize())
}

/** rad between two attitudes: how far the thrusters turn the ship to go from one to the other. */
export const turnAngle = (from: Quat, to: Quat): number => toThree(from).angleTo(toThree(to))

/** Where the ship is, ly from the Sun in galactic axes. */
export const shipPosition = (course: Course, x: number): Vec3 =>
  add(course.origin, scale(forwardOf(course.attitude), (x - course.startX) / LY))

/** For the shaders: `uBasis * g` takes a galactic vector into the ship's axes, `n * uBasis` the other way. */
export const galacticToShipMatrix = (attitude: Quat, target: THREE.Matrix3 = new THREE.Matrix3()): THREE.Matrix3 =>
  target.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(toThree(attitude).invert()))

/** Where the target appears, ship axes: dead ahead, except while the ship is turning onto it. */
export const targetDirection = (course: Course, ship: Ship): Vec3 =>
  apparentDirection(galacticToShip(course.attitude, normalise(sub(TARGETS[course.target].position, shipPosition(course, ship.x)))), ship.phi)

/** Unit vector from the ship to the centre of the Galaxy, in the ship's axes. */
export const directionToCentre = (course: Course, x: number): Vec3 =>
  galacticToShip(course.attitude, normalise(sub(BODIES[BODIES.length - 1].position, shipPosition(course, x))))

// ── Targets ─────────────────────────────────────────────────────────────────────

/** Somewhere a course can be set for, how far short of it to stop, and how near stopping counts as arriving. */
export interface Place {
  readonly name: string
  readonly position: Vec3 // ly from the Sun, galactic axes
  readonly standoff: number // ly
  readonly arrival: number // ly
}

const LAUNCH_DISTANCE_M = 2.5e7 // from the Earth's centre, so that it spans 29°
/** Nearer a globe than as many of its radii as the ship starts from the Earth it never stops: there it spans 29.5°. */
const GLOBE_STANDOFF_RADII = LAUNCH_DISTANCE_M / EARTH_RADIUS_M
/**
 * By a globe the ship stops this far inside its Hill sphere: a pilot who answers the brake call at once comes to rest
 * near half way in (navigate: 1 + 0.7·GLOBE_ARRIVAL_STANDOFFS standoffs out), already bound to it and falling, so that a
 * sideways push of tens of m/s carries it past and the periapsis is the place to capture. Choice.
 */
const HILL_STANDOFFS = 9

// Stopping within so many standoffs counts as arriving. The brake call comes 0.7 of that early (brakeCallDistance), so it
// must be over 1/0.3 for a pilot who answers at once to arrive. At the clock's limit a second late to brake overshoots by
// a fifth of it: by a star 4 standoffs go unseen, but by a globe one is enough to take the ship through it, so there the
// approach is four times finer. Choices, not physics.
const ARRIVAL_STANDOFFS = 20
const GLOBE_ARRIVAL_STANDOFFS = 5

const starPlace = ({ name, position, standoff }: Body): Place => ({ name, position, standoff, arrival: ARRIVAL_STANDOFFS * standoff })
const globePlace = (globe: Globe): Place => {
  const standoff = Math.max(globe.hill / HILL_STANDOFFS, GLOBE_STANDOFF_RADII * globe.radiusM) / LY
  return { name: globe.name, position: globe.position, standoff, arrival: GLOBE_ARRIVAL_STANDOFFS * standoff }
}

/** The Sun's planets outwards from it, the Moon after the Earth. */
const SUN_FAMILY: readonly Globe[] = [...PLANETS.slice(0, 2), EARTH, MOON, ...PLANETS.slice(2)]

/** Every place a course can be set for: the table of stars in its order, the Sun first, each star followed by its planets. */
export const TARGETS: readonly Place[] = BODIES.flatMap((body, i) =>
  [starPlace(body), ...(i === 0 ? SUN_FAMILY : EXOPLANETS.filter((planet) => planet.star === body)).map(globePlace)])

export const indexOfTarget = (name: string): number => {
  const index = TARGETS.findIndex((place) => place.name === name)
  if (index < 0) throw new Error(`No such target: ${name}`)
  return index
}

// ── Launch ──────────────────────────────────────────────────────────────────────

export const LAUNCH_TARGET = indexOfTarget('α Центавра A')
const EARTH_AZIMUTH = 55 * DEG // left of the course, in the front quarter window

/**
 * At rest near the Earth, aimed at the first target, with the Earth ahead and to the left at eye level: the departure
 * passes it 20 000 km from its centre. The ship waits on the Sun's side of the course, so it sees the day side.
 */
export function launchCourse(target: number = LAUNCH_TARGET): Course {
  const earth = earthPosition(LAUNCH_JD)
  const forward = normalise(sub(TARGETS[target].position, earth))
  const sun = equatorialToGalactic(sunFromEarth(LAUNCH_JD).direction)
  const sideways = sub(sun, scale(forward, dot(sun, forward)))
  const right = length(sideways) > 1e-3 ? normalise(sideways) : normalise(cross(forward, [0, 0, 1])) // Sun on the course
  const back = scale(forward, -1)
  const up = cross(back, right)
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...back))
  const fromEarth = sub(scale(right, Math.sin(EARTH_AZIMUTH)), scale(forward, Math.cos(EARTH_AZIMUTH)))
  return {
    target,
    origin: add(earth, scale(fromEarth, LAUNCH_DISTANCE_M / LY)),
    startX: 0,
    attitude: fromThree(new THREE.Quaternion().setFromRotationMatrix(basis)),
    turn: null,
  }
}

// ── Turning ─────────────────────────────────────────────────────────────────────

const REST_PHI = 1e-9
const TURN_BASE = 1.5 // s
const TURN_PER_RADIAN = 1.6 // s; a half turn takes about 6.5 s

export const isAtRest = (ship: Ship): boolean => ship.phi < REST_PHI

/** The attitude that points the nose along `direction` by the shortest turn from `attitude`. */
const aimed = (attitude: Quat, direction: Vec3): Quat => {
  const [fx, fy, fz] = forwardOf(attitude)
  const swing = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(fx, fy, fz), new THREE.Vector3(...direction))
  return fromThree(swing.multiply(toThree(attitude)))
}

/** Picks a target. At rest the ship starts turning to it and a new leg begins here; under way nothing happens. */
export function setCourse(course: Course, ship: Ship, target: number): Course {
  const here = shipPosition(course, ship.x)
  const offset = sub(TARGETS[target].position, here)
  if (!isAtRest(ship) || length(offset) === 0) return course
  const to = aimed(course.attitude, normalise(offset))
  const angle = toThree(course.attitude).angleTo(toThree(to))
  const turn = angle < 1e-6 ? null : { from: course.attitude, to, progress: 0, duration: TURN_BASE + TURN_PER_RADIAN * angle }
  return { target, origin: here, startX: ship.x, attitude: course.attitude, turn }
}

export function stepTurn(course: Course, dtReal: number): Course {
  const { turn } = course
  if (!turn) return course
  const progress = Math.min(1, turn.progress + dtReal / turn.duration)
  if (progress >= 1) return { ...course, attitude: turn.to, turn: null }
  const eased = progress * progress * (3 - 2 * progress)
  return { ...course, attitude: fromThree(toThree(turn.from).slerp(toThree(turn.to), eased)), turn: { ...turn, progress } }
}

// ── Light from outside ──────────────────────────────────────────────────────────

export interface Source {
  readonly direction: Vec3 // where it appears, ship axes, unit
  readonly illuminance: number // lx on a surface facing it, aboard
  readonly temperature: number // K, as seen aboard
  readonly radius?: number // rad, for a source that is not a point
}

/**
 * The stars as they light the ship, with any behind the disc of a body put out: in a planet's shadow the Sun neither
 * lights the cabin nor casts its shadows. ponytail: a star is a point here, so there is no penumbra; the star half
 * behind the limb is wholly lit or wholly dark.
 */
export const eclipsed = (stars: readonly Source[], globes: readonly Source[]): Source[] =>
  stars.map((star) => (globes.some((globe) => (globe.radius ?? 0) > Math.acos(Math.min(1, dot(star.direction, globe.direction))))
    ? { ...star, illuminance: 0 }
    : star))

/**
 * The Sun and the stars of the table as the crew sees them. A point source keeps W, so T′ = D·T, and its solid angle
 * shrinks as 1/D²: E′ = Y(DT)·πR²/(d²D²), the same as the star shader. D = γ(1 + β cos θ), θ from the course.
 */
export function starSources(course: Course, ship: Ship): Source[] {
  const here = shipPosition(course, ship.x)
  return STARS.map((star) => {
    const offset = sub(star.position, here)
    const distance = length(offset)
    const n = galacticToShip(course.attitude, scale(offset, 1 / distance))
    const doppler = dopplerTowards(n, ship.phi)
    const temperature = star.temperature * doppler
    const illuminance = (lutXYZ(temperature)[1] * Math.PI * star.radiusSquared) / (distance * distance * doppler * doppler)
    return { direction: apparentDirection(n, ship.phi), illuminance, temperature }
  })
}

/** m from the ship to the Earth. */
export const earthDistance = (course: Course, x: number): number => length(sub(EARTH.position, shipPosition(course, x))) * LY

/** D = γ(1 + β cos θ) for a direction n in the ship's axes, galaxy frame; θ is measured from the course. */
export const dopplerTowards = (n: Vec3, phi: number): number => Math.cosh(phi) * (1 - Math.tanh(phi) * n[2])

/**
 * Starlight off a globe, as a Lambert sphere of albedo A: E = (2/3)·A·E*·(R/d)²·Φ(α), where E* is its star's light there,
 * 2A/3 the geometric albedo of such a sphere and Φ its phase law. A is the Earth's Bond albedo, or what gives the Moon and
 * the planets their measured light (solarSystem.ts, exoplanets.ts). Seen from the moving ship, the light off a globe is a
 * diluted blackbody of its star like any other: T′ = DT, the dilution stays, and the disc's solid angle shrinks as 1/D².
 */
export function globeSource(course: Course, ship: Ship, globe: Globe): Source {
  const { star } = globe
  const offset = sub(globe.position, shipPosition(course, ship.x))
  const distance = length(offset)
  const fromStar = sub(globe.position, star.position)
  const towardsStar = normalise(scale(fromStar, -1))
  const phase = Math.acos(Math.max(-1, Math.min(1, -dot(towardsStar, offset) / distance)))
  const ratio = globe.radiusM / (distance * LY)
  const n = galacticToShip(course.attitude, scale(offset, 1 / distance))
  const doppler = dopplerTowards(n, ship.phi)
  const temperature = star.temperature * doppler
  const light = (lutXYZ(star.temperature)[1] * Math.PI * star.radiusSquared) / dot(fromStar, fromStar)
  const atRest = (2 / 3) * globe.albedo(phase) * light * ratio * ratio * lambertPhase(phase)
  return {
    direction: apparentDirection(n, ship.phi),
    illuminance: (atRest * lutXYZ(temperature)[1]) / lutXYZ(star.temperature)[1] / (doppler * doppler),
    temperature,
    radius: Math.asin(Math.min(1, ratio)) / doppler,
  }
}

export const earthSource = (course: Course, ship: Ship): Source => globeSource(course, ship, EARTH)

// ── Time and arrival ────────────────────────────────────────────────────────────

/** m along the course from the ship to where it should stop; negative once that point is behind. */
export function distanceToGo(course: Course, x: number): number {
  const place = TARGETS[course.target]
  return (dot(sub(place.position, shipPosition(course, x)), forwardOf(course.attitude)) - place.standoff) * LY
}

/** Galaxy-frame distance to stop from rapidity φ at proper deceleration a: c²/a (cosh φ − 1) (Rindler). */
export const brakingDistance = (phi: number, acceleration: number = G0): number => ((C * C) / acceleration) * (Math.cosh(phi) - 1)

/** m: stopping this close counts as arriving. */
export const arrivalRadius = (course: Course): number => TARGETS[course.target].arrival * LY

/**
 * The fastest the pilot's clock may run, ship seconds per real second. What needs the pilot next, the point where
 * braking must begin or the point where the ship should stop, comes closer by no more than a factor e every
 * 1/EFOLD_RATE real seconds, whatever the scale, so that a second of reaction costs little. Nothing comes at a ship at
 * rest, even with the lever back: only thrust moves it. Only the viewer's clock is compressed, never the physics.
 */
const EFOLD_RATE = 0.2 // per real second

export function clockLimit(course: Course, ship: Ship, acceleration: number): number {
  if (isAtRest(ship) && acceleration <= 0) return Infinity
  const toGo = distanceToGo(course, ship.x)
  const precision = arrivalRadius(course)
  const events = [Math.max(Math.abs(toGo), precision)]
  // Under thrust the brake point comes at the ship faster than the ship flies, since the braking distance grows to meet it,
  // at c·sinh φ·a/g. Shrinking the event by the same factor keeps its approach at a factor e per 1/EFOLD_RATE seconds.
  if (acceleration >= 0) events.push(Math.max(Math.abs(toGo - brakingDistance(ship.phi)), precision) / (1 + acceleration / G0))
  const distance = Math.min(...events)
  // dx/dτ is c·sinh φ; from rest under thrust it is about √(2ad), which keeps the start from stalling
  const pace = Math.max(C * Math.sinh(ship.phi), Math.sqrt(2 * G0 * distance))
  return Math.max(1, (EFOLD_RATE * distance) / pace)
}

export type Cue = 'turning' | 'arrived' | 'ready' | 'behind' | 'cruise' | 'brakeSoon' | 'brake' | 'passed'

export interface Navigation {
  readonly name: string
  readonly distance: number // m, straight to the target
  readonly toGo: number // m, along the course to the stopping point
  readonly braking: number // m, at full braking
  readonly cue: Cue
}

const BRAKE_SOON = 0.8

// The brake call comes early by what the pilot needs to act on it: to hear it and decide, then to pull the lever from
// full thrust to full braking. Choices, not measurements: a second and a half to answer a tone the pilot is waiting for,
// and two seconds for the lever, about what holding ↓ takes to step it through its forty notches.
export const REACTION_S = 1.5
export const LEVER_S = 2
export const BRAKE_LEAD_S = REACTION_S + LEVER_S

/**
 * m before the brake point where the call sounds BRAKE_LEAD_S real seconds ahead of it, with the clock at its limit:
 * that brings the brake point closer by a factor e every 1/EFOLD_RATE seconds down to the arrival radius, then covers
 * that radius in 1/EFOLD_RATE seconds more (clockLimit). A slower clock only gives the pilot more time. Answered at
 * once, the call stops the ship short by this much, within the arrival radius.
 */
export function brakeCallDistance(course: Course): number {
  const efolds = EFOLD_RATE * BRAKE_LEAD_S
  return arrivalRadius(course) * (efolds <= 1 ? efolds : Math.exp(efolds - 1))
}

/** m from the ship to one of TARGETS, straight. */
export const distanceTo = (course: Course, ship: Ship, target: number): number =>
  length(sub(TARGETS[target].position, shipPosition(course, ship.x))) * LY

/** What the hints on the HUD and the nav screen say. There is no autopilot: braking is the pilot's. */
export function navigate(course: Course, ship: Ship): Navigation {
  const distance = distanceTo(course, ship, course.target)
  const toGo = distanceToGo(course, ship.x)
  const braking = brakingDistance(ship.phi)
  const cue = ((): Cue => {
    if (course.turn) return 'turning'
    if (isAtRest(ship)) {
      if (distance < arrivalRadius(course)) return 'arrived'
      return toGo < 0 ? 'behind' : 'ready'
    }
    if (toGo < 0) return 'passed'
    if (braking + brakeCallDistance(course) >= toGo) return 'brake'
    return braking >= BRAKE_SOON * toGo ? 'brakeSoon' : 'cruise'
  })()
  return { name: TARGETS[course.target].name, distance, toGo, braking, cue }
}
