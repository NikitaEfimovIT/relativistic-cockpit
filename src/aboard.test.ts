import { expect, test } from 'vitest'
import { aimOf, eyeOf, flipSwitch, isSwitchOn, obstacles, seatYaw, stepBody, use } from './aboard'
import { SEATS } from './cockpitLayout'
import { initialSim } from './sim'
import { BODY_RADIUS, initialBody, standUp, toggleDrawer, type Body, type WalkKeys } from './walk'

const STILL: WalkKeys = { forward: false, back: false, left: false, right: false }
const AHEAD: WalkKeys = { ...STILL, forward: true }
const AFT = Math.PI // the yaw that faces the stern
const END_WALL = 12.55 // m aft of the eye: the science bay's aft wall, with the door to the engines
const STANDING_EYE = 0.4 // m: 1.62 m above the deck, which is 1.22 m below the seated eye

const onFoot = (x: number, z: number): Body => standUp(initialBody(), { x, z })
const live = (from: Body, seconds: number, keys: WalkKeys): Body =>
  Array.from({ length: Math.round(seconds * 60) }).reduce<Body>((b) => stepBody(b, keys, AFT, 1 / 60), from)

test('the voyage starts in the pilot couch, with the eye where the cockpit was built around it', () => {
  const body = initialBody()

  expect(eyeOf(body)).toEqual([0, 0, 0])
  expect(seatYaw(body)).toBe(0)
  expect(aimOf(body, [0, 0, -1])).toBeNull() // seated, the cursor is free and nothing is aimed at
})

test('behind the seat the pilot stands upright: the cockpit is two metres high', () => {
  const body = standUp(initialBody(), SEATS.pilot.exit)

  const [, height, z] = eyeOf(body)

  expect(z).toBeCloseTo(SEATS.pilot.exit.z)
  expect(height).toBeCloseTo(STANDING_EYE, 2)
})

test('walking aft leads through the doorway in the partition, on the level, and stops at the end wall', () => {
  const body = live(standUp(initialBody(), SEATS.pilot.exit), 12, AHEAD)

  expect(body.at.z).toBeCloseTo(END_WALL - BODY_RADIUS, 2)
  expect(eyeOf(body)[1]).toBeCloseTo(STANDING_EYE, 2)
})

test('looking at the chair and using it seats the engineer facing the screens on the port wall', () => {
  const standing = onFoot(0.2, 3.2)
  const aim = aimOf(standing, [-0.8, -0.6, 0])

  const seated = aim ? use(standing, aim) : standing

  expect(aim?.id).toBe('desk')
  expect(seated.seat).toBe('desk')
  expect(eyeOf(seated)).toEqual(SEATS.desk.eye)
  expect(seatYaw(seated)).toBeCloseTo(Math.PI / 2)
})

test('a drawer pulled out stands in the aisle: the feet stop at it', () => {
  const pulled = live(toggleDrawer(onFoot(0.2, 5.0), 'drawer_bed_1'), 1, STILL) // a second for it to slide

  const stopped = live(pulled, 4, AHEAD)

  expect(obstacles(pulled).some((box) => box.minX < 0.1 && box.maxX === 0.5)).toBe(true)
  expect(stopped.at.z).toBeLessThan(6.252) // the drawer's forward edge
  expect(live(onFoot(0.2, 5.0), 4, AHEAD).at.z).toBeGreaterThan(7) // with it shut the aisle is clear
})

test('a switch on the console works the same system as its twin in the cockpit', () => {
  const sim = initialSim()

  const flipped = flipSwitch(sim, 'ctl_wall_breaker_comms')

  expect(isSwitchOn(flipped, 'ctl_wall_breaker_comms')).toBe(!sim.breakers.comms)
  expect(flipSwitch(sim, 'ctl_wall_fans').fansOn).toBe(!sim.fansOn)
  expect(flipSwitch(sim, 'no_such_switch')).toBe(sim)
})

test('the console works the habitat: the setpoint keys step the thermostat and spring back, the vent switch opens the vent', () => {
  const sim = initialSim()

  const warmer = flipSwitch(flipSwitch(sim, 'ctl_wall_setpoint_up'), 'ctl_wall_setpoint_up')
  const vented = flipSwitch(sim, 'ctl_wall_vent')

  expect(warmer.habitat.setpoint).toBe(sim.habitat.setpoint + 2)
  expect(isSwitchOn(warmer, 'ctl_wall_setpoint_up')).toBe(false)
  expect(Array.from({ length: 40 }).reduce<typeof sim>((s) => flipSwitch(s, 'ctl_wall_setpoint_down'), sim).habitat.setpoint).toBe(16)
  expect(isSwitchOn(vented, 'ctl_wall_vent')).toBe(true)
  expect(vented.habitat.ventOpen).toBe(true)
})

test('the room panel by the bed works the light and the thermostat, as the console does', () => {
  const sim = initialSim()

  const dark = flipSwitch(sim, 'ctl_room_lights')
  const cooler = flipSwitch(sim, 'ctl_room_setpoint_down')

  expect(dark.cabinLightsOn).toBe(!sim.cabinLightsOn)
  expect(isSwitchOn(dark, 'ctl_room_lights')).toBe(isSwitchOn(dark, 'ctl_wall_lights'))
  expect(cooler.habitat.setpoint).toBe(sim.habitat.setpoint - 1)
  expect(flipSwitch(sim, 'ctl_room_setpoint_up').habitat.setpoint).toBe(sim.habitat.setpoint + 1)
})
