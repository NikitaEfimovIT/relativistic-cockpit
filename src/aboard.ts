/** The body aboard this ship: the walking geometry of walk.ts joined to the layout the model was built with, and to the systems its console and room panel work. */

import { BLOCKERS, CEILING_PROFILE, FLOOR_PROFILE, SEATS, TARGETS, WALLS } from './cockpitLayout'
import {
  stepSetpoint, toggleBreaker, toggleBus, toggleCabinLights, toggleFans, toggleHeater, toggleIsolation, toggleO2Generator, toggleReactor, toggleRepress,
  toggleScrubber, toggleVent, type SimState,
} from './sim'
import {
  eyeHeight, footprint, gazeTarget, pulledOut, sitDown, slideOf, stepDrawers, toggleDrawer, walk,
  type Body, type Box, type SeatName, type Target, type Vec3, type WalkKeys,
} from './walk'

interface WallSwitch {
  readonly label: string // its legend on the board, as in blender/cockpit_lib/wallpanel.py
  readonly kind: 'switch' | 'key' // a key springs back: it has no on
  readonly isOn: (s: SimState) => boolean
  readonly flip: (s: SimState) => SimState
}

const KEY_IS_NEVER_ON = (): boolean => false

/** The board's controls: some a second handle on a system the cockpit has, the rest the habitat's own. */
export const WALL_SWITCHES: Readonly<Record<string, WallSwitch>> = {
  ctl_wall_bus: { label: 'ШИНА', kind: 'switch', isOn: (s) => s.busOn, flip: toggleBus },
  ctl_wall_breaker_nav: { label: 'НАВИГАЦИЯ', kind: 'switch', isOn: (s) => s.breakers.nav, flip: (s) => toggleBreaker(s, 'nav') },
  ctl_wall_breaker_comms: { label: 'СВЯЗЬ', kind: 'switch', isOn: (s) => s.breakers.comms, flip: (s) => toggleBreaker(s, 'comms') },
  ctl_wall_breaker_dosimeter: { label: 'ДОЗИМЕТР', kind: 'switch', isOn: (s) => s.breakers.dosimeter, flip: (s) => toggleBreaker(s, 'dosimeter') },
  ctl_wall_breaker_camera: { label: 'КАМЕРА', kind: 'switch', isOn: (s) => s.breakers.camera, flip: (s) => toggleBreaker(s, 'camera') },
  ctl_wall_reactor: { label: 'РЕАКТОР', kind: 'switch', isOn: (s) => s.habitat.reactorOn, flip: toggleReactor },
  ctl_wall_lights: { label: 'СВЕТ', kind: 'switch', isOn: (s) => s.cabinLightsOn, flip: toggleCabinLights },
  ctl_wall_fans: { label: 'ВЕНТИЛЯТОРЫ', kind: 'switch', isOn: (s) => s.fansOn, flip: toggleFans },
  ctl_wall_scrubber: { label: 'ПОГЛОТИТЕЛЬ', kind: 'switch', isOn: (s) => s.scrubberOn, flip: toggleScrubber },
  ctl_wall_o2: { label: 'КИСЛОРОД', kind: 'switch', isOn: (s) => s.habitat.o2GenOn, flip: toggleO2Generator },
  ctl_wall_heater_1: { label: 'ОБОГРЕВ 1', kind: 'switch', isOn: (s) => s.habitat.heater1On, flip: (s) => toggleHeater(s, 1) },
  ctl_wall_heater_2: { label: 'ОБОГРЕВ 2', kind: 'switch', isOn: (s) => s.habitat.heater2On, flip: (s) => toggleHeater(s, 2) },
  ctl_wall_setpoint_down: { label: 'УСТАВКА −', kind: 'key', isOn: KEY_IS_NEVER_ON, flip: (s) => stepSetpoint(s, -1) },
  ctl_wall_setpoint_up: { label: 'УСТАВКА +', kind: 'key', isOn: KEY_IS_NEVER_ON, flip: (s) => stepSetpoint(s, 1) },
  ctl_wall_vent: { label: 'СБРОС ДАВЛ.', kind: 'switch', isOn: (s) => s.habitat.ventOpen, flip: toggleVent },
  ctl_wall_repress: { label: 'НАДДУВ', kind: 'switch', isOn: (s) => s.habitat.repressOn, flip: toggleRepress },
  ctl_wall_isolate: { label: 'ИЗОЛЯЦИЯ', kind: 'switch', isOn: (s) => s.habitat.ventIsolated, flip: toggleIsolation },
  // the room panel by the bed: twins of the console's light and thermostat
  ctl_room_lights: { label: 'СВЕТ', kind: 'switch', isOn: (s) => s.cabinLightsOn, flip: toggleCabinLights },
  ctl_room_setpoint_down: { label: 'УСТАВКА −', kind: 'key', isOn: KEY_IS_NEVER_ON, flip: (s) => stepSetpoint(s, -1) },
  ctl_room_setpoint_up: { label: 'УСТАВКА +', kind: 'key', isOn: KEY_IS_NEVER_ON, flip: (s) => stepSetpoint(s, 1) },
}

/** The targets as they stand now: a drawer that is out has its front out in the aisle. */
const targetsNow = (b: Body): readonly Target[] =>
  TARGETS.map((t) => (t.kind === 'drawer' ? pulledOut(t, slideOf(b, t.id)) : t))

/** Everything that stops the feet: walls, furniture and whatever drawers are out. */
export function obstacles(b: Body): readonly Box[] {
  const drawers = targetsNow(b).filter((t) => t.kind === 'drawer' && slideOf(b, t.id) > 0)
  return [...WALLS, ...BLOCKERS, ...drawers.map(footprint)]
}

/** Where the eye is: in a seat, where the seat puts it; on foot, above the feet and under the ceiling. */
export function eyeOf(b: Body): Vec3 {
  if (b.seat) return SEATS[b.seat].eye
  return [b.at.x, eyeHeight(FLOOR_PROFILE, CEILING_PROFILE, b.at.z), b.at.z]
}

/** Which way a seat faces; on foot the head alone decides. */
export const seatYaw = (b: Body): number => (b.seat ? SEATS[b.seat].yaw : 0)

/** One frame of the body: the feet move only when standing, the drawers slide either way. */
export function stepBody(b: Body, keys: WalkKeys, yaw: number, dt: number): Body {
  const at = b.seat ? b.at : walk(b.at, keys, yaw, dt, obstacles(b))
  return stepDrawers({ ...b, at }, dt)
}

/** What E would act on. Seated, the cursor is free and the hands work the controls, so nothing is aimed at. */
export function aimOf(b: Body, direction: Vec3): Target | null {
  if (b.seat) return null
  const length = Math.hypot(...direction)
  const unit: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length]
  return gazeTarget(eyeOf(b), unit, targetsNow(b), WALLS)
}

/** E on a seat sits in it, on a drawer slides it; a switch belongs to the ship's systems (flipSwitch). */
export function use(b: Body, aim: Target): Body {
  if (aim.kind === 'seat') return sitDown(b, aim.id as SeatName)
  if (aim.kind === 'drawer') return toggleDrawer(b, aim.id)
  return b
}

export const isSwitchOn = (s: SimState, id: string): boolean => WALL_SWITCHES[id]?.isOn(s) ?? false

export const flipSwitch = (s: SimState, id: string): SimState => WALL_SWITCHES[id]?.flip(s) ?? s
