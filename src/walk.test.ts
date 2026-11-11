import { describe, expect, test } from 'vitest'
import {
  BODY_RADIUS,
  DRAWER_TIME,
  DRAWER_TRAVEL,
  HEAD_CLEARANCE,
  STANDING_EYE,
  WALK_SPEED,
  type Box,
  type Profile,
  type Spot,
  type Target,
  type Vec3,
  eyeHeight,
  footprint,
  gazeTarget,
  heightAt,
  initialBody,
  isDrawerOpen,
  promptFor,
  pulledOut,
  pushOut,
  sitDown,
  slideOf,
  standUp,
  stepDrawers,
  toggleDrawer,
  walk,
} from './walk'

const STILL = { forward: false, back: false, left: false, right: false }
const FORWARD = { ...STILL, forward: true }
const START: Spot = { x: 0, z: 0 }

/** Everything beyond z = -1 is wall. */
const WALL_AHEAD: Box = { minX: -5, maxX: 5, minZ: -6, maxZ: -1 }
const WALL_TO_PORT: Box = { minX: -6, maxX: -1, minZ: -5, maxZ: 5 }
const CRATE: Box = { minX: 1, maxX: 2, minZ: 1, maxZ: 2 }

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high)
const gapTo = (box: Box, at: Spot): number =>
  Math.hypot(at.x - clamp(at.x, box.minX, box.maxX), at.z - clamp(at.z, box.minZ, box.maxZ))

const FRAME = 0.05 // s

/** Holds the keys for a while, a frame at a time, and reports where the body ends up and how close it came. */
const stride = (from: Spot, yaw: number, seconds: number, boxes: readonly Box[]): { at: Spot; closest: number } => {
  let at = from
  let closest = Infinity
  for (let frame = 0; frame < Math.round(seconds / FRAME); frame++) {
    at = walk(at, FORWARD, yaw, FRAME, boxes)
    closest = Math.min(closest, ...boxes.map((box) => gapTo(box, at)))
  }
  return { at, closest }
}

describe('walking', () => {
  test('forward follows the gaze: ahead at rest, aft after turning round, to port after a quarter turn left', () => {
    const ahead = walk(START, FORWARD, 0, 0.1, [])
    const aft = walk(START, FORWARD, Math.PI, 0.1, [])
    const port = walk(START, FORWARD, Math.PI / 2, 0.1, [])

    expect(ahead.x).toBeCloseTo(0)
    expect(ahead.z).toBeCloseTo(-WALK_SPEED * 0.1)
    expect(aft.z).toBeCloseTo(WALK_SPEED * 0.1)
    expect(port.x).toBeCloseTo(-WALK_SPEED * 0.1)
    expect(port.z).toBeCloseTo(0)
  })

  test('D steps to the right hand, which swaps sides when the body faces aft, and S steps back', () => {
    const right = { ...STILL, right: true }

    expect(walk(START, right, 0, 0.1, []).x).toBeCloseTo(WALK_SPEED * 0.1)
    expect(walk(START, right, Math.PI, 0.1, []).x).toBeCloseTo(-WALK_SPEED * 0.1)
    expect(walk(START, { ...STILL, back: true }, 0, 0.1, []).z).toBeCloseTo(WALK_SPEED * 0.1)
    expect(walk(START, { ...STILL, left: true }, 0, 0.1, []).x).toBeCloseTo(-WALK_SPEED * 0.1)
  })

  test('a diagonal is no faster than a straight walk', () => {
    const at = walk(START, { ...FORWARD, right: true }, 0, 0.1, [])

    expect(Math.hypot(at.x, at.z)).toBeCloseTo(WALK_SPEED * 0.1)
  })

  test('with no key held the body stays where it is', () => {
    expect(walk(START, STILL, 1, 0.1, [])).toEqual(START)
    expect(walk(START, { ...FORWARD, back: true }, 1, 0.1, [])).toEqual(START)
  })

  test('a stalled frame cannot carry the body further than its own radius', () => {
    const at = walk(START, FORWARD, 0, 5, [])

    expect(Math.hypot(at.x, at.z)).toBeCloseTo(BODY_RADIUS)
  })
})

describe('bumping into things', () => {
  test('the body stops a radius short of a wall', () => {
    const { at } = stride(START, 0, 5, [WALL_AHEAD])

    expect(at.z).toBeCloseTo(-1 + BODY_RADIUS)
  })

  test('walking into a wall at an angle slides along it', () => {
    const { at } = stride(START, Math.PI / 4, 5, [WALL_AHEAD])

    expect(at.z).toBeCloseTo(-1 + BODY_RADIUS)
    expect(at.x).toBeCloseTo(-WALK_SPEED * 5 * Math.SQRT1_2)
  })

  test('a nook between two walls holds the body off both', () => {
    const { at } = stride(START, Math.PI / 4, 5, [WALL_AHEAD, WALL_TO_PORT])

    expect(at.x).toBeCloseTo(-1 + BODY_RADIUS)
    expect(at.z).toBeCloseTo(-1 + BODY_RADIUS)
  })

  test('heading straight at a corner stops a radius away from it', () => {
    const { at } = stride({ x: 0.2, z: 0.2 }, (-3 * Math.PI) / 4, 4, [CRATE])

    expect(Math.hypot(at.x - 1, at.z - 1)).toBeCloseTo(BODY_RADIUS)
  })

  test('an off-centre approach slides along the face and slips round the far corner', () => {
    const { at, closest } = stride({ x: 0.2, z: 0.4 }, (-3 * Math.PI) / 4, 4, [CRATE])

    expect(at.x).toBeGreaterThan(1)
    expect(at.z).toBeGreaterThan(2)
    expect(closest).toBeGreaterThan(BODY_RADIUS - 1e-9)
  })

  test('a box that grows over the body pushes it out through the nearest side', () => {
    const at = pushOut({ x: 1.1, z: 1.5 }, [CRATE])

    expect(at.x).toBeCloseTo(1 - BODY_RADIUS)
    expect(at.z).toBeCloseTo(1.5)
  })

  test('a body standing still is still pushed by what moves into it', () => {
    expect(walk({ x: 0, z: -0.9 }, STILL, 0, 0.016, [WALL_AHEAD]).z).toBeCloseTo(-1 + BODY_RADIUS)
  })
})

describe('the eye above the floor', () => {
  const STAIRS: Profile = [[0, -1], [1, -2]]
  const LOW_THEN_HIGH: Profile = [[1, 0], [1.001, 1]]

  test('a profile is a straight line between its points and level beyond them', () => {
    expect(heightAt(STAIRS, -5)).toBe(-1)
    expect(heightAt(STAIRS, 0.25)).toBeCloseTo(-1.25)
    expect(heightAt(STAIRS, 9)).toBe(-2)
  })

  test('where the ceiling allows, the eye is a standing height above the floor', () => {
    expect(eyeHeight(STAIRS, LOW_THEN_HIGH, 3)).toBeCloseTo(-2 + STANDING_EYE)
  })

  test('under a low ceiling the head ducks to keep clear of it', () => {
    expect(eyeHeight(STAIRS, LOW_THEN_HIGH, -1)).toBeCloseTo(-HEAD_CLEARANCE)
    expect(eyeHeight(STAIRS, LOW_THEN_HIGH, 0.5)).toBeCloseTo(-HEAD_CLEARANCE)
  })
})

describe('looking at things', () => {
  const EYE: Vec3 = [0, 0, 0]
  const AHEAD: Vec3 = [0, 0, -1]
  const seat: Target = { id: 'pilot', kind: 'seat', min: [-0.3, -1, -1.5], max: [0.3, 0.2, -1] }
  const nearer: Target = { id: 'near', kind: 'switch', min: [-0.1, -0.1, -0.8], max: [0.1, 0.1, -0.6] }
  const drawer: Target = { id: 'drawer', kind: 'drawer', min: [0.5, -1.55, -0.4], max: [0.52, -1.25, 0.4] }

  test('the gaze picks what the ray lands on', () => {
    expect(gazeTarget(EYE, AHEAD, [drawer, seat], [])).toBe(seat)
  })

  test('of two things on the ray the nearer one wins, whatever the order', () => {
    expect(gazeTarget(EYE, AHEAD, [seat, nearer], [])).toBe(nearer)
    expect(gazeTarget(EYE, AHEAD, [nearer, seat], [])).toBe(nearer)
  })

  test('nothing is picked off the ray, behind the back or beyond arm reach', () => {
    const far: Target = { ...seat, min: [-0.3, -1, -3.5], max: [0.3, 0.2, -3] }

    expect(gazeTarget(EYE, [1, 0, 0], [seat], [])).toBeNull()
    expect(gazeTarget(EYE, [0, 0, 1], [seat], [])).toBeNull()
    expect(gazeTarget(EYE, AHEAD, [far], [])).toBeNull()
    expect(gazeTarget(EYE, AHEAD, [far], [], 5)).toBe(far)
  })

  test('a wall in the way hides what is behind it', () => {
    const partition: Box = { minX: -5, maxX: 5, minZ: -0.6, maxZ: -0.5 }

    expect(gazeTarget(EYE, AHEAD, [seat], [partition])).toBeNull()
  })

  test('a thing mounted on a wall is not hidden by that wall', () => {
    const wall: Box = { minX: -5, maxX: 5, minZ: -3, maxZ: -1.5 }

    expect(gazeTarget(EYE, AHEAD, [seat], [wall])).toBe(seat)
  })

  test('looking down picks a drawer at the feet', () => {
    const length = Math.hypot(0.5, 1.4)

    expect(gazeTarget(EYE, [0.5 / length, -1.4 / length, 0], [seat, drawer], [])).toBe(drawer)
  })
})

describe('seats', () => {
  test('the voyage starts in the pilot couch', () => {
    expect(initialBody().seat).toBe('pilot')
  })

  test('sitting down takes the seat, standing up puts the feet at its exit', () => {
    const seated = sitDown(standUp(initialBody(), START), 'desk')
    const upright = standUp(seated, { x: 1, z: 2 })

    expect(seated.seat).toBe('desk')
    expect(upright.seat).toBeNull()
    expect(upright.at).toEqual({ x: 1, z: 2 })
  })
})

describe('drawers', () => {
  const front: Target = { id: 'bed_drawer_1', kind: 'drawer', min: [0.6, -1.6, 2], max: [0.62, -1.3, 2.8] }

  test('a drawer slides out at a steady rate and stops fully open', () => {
    const pulled = toggleDrawer(initialBody(), 'a')

    expect(isDrawerOpen(initialBody(), 'a')).toBe(false)
    expect(isDrawerOpen(pulled, 'a')).toBe(true)
    expect(slideOf(pulled, 'a')).toBe(0)
    expect(slideOf(stepDrawers(pulled, DRAWER_TIME / 2), 'a')).toBeCloseTo(0.5)
    expect(slideOf(stepDrawers(pulled, DRAWER_TIME * 3), 'a')).toBe(1)
  })

  test('toggled again it slides back in, and the others stay shut', () => {
    const open = stepDrawers(toggleDrawer(initialBody(), 'a'), DRAWER_TIME)
    const closing = stepDrawers(toggleDrawer(open, 'a'), DRAWER_TIME / 4)

    expect(slideOf(closing, 'a')).toBeCloseTo(0.75)
    expect(slideOf(stepDrawers(closing, DRAWER_TIME), 'a')).toBe(0)
    expect(slideOf(closing, 'b')).toBe(0)
  })

  test('a body with every drawer at rest comes back unchanged', () => {
    const open = stepDrawers(toggleDrawer(initialBody(), 'a'), DRAWER_TIME)

    expect(stepDrawers(open, 0.1)).toBe(open)
  })

  test('a pulled drawer reaches into the aisle, and its footprint blocks the way', () => {
    const out = pulledOut(front, 1)

    expect(out.min[0]).toBeCloseTo(0.6 - DRAWER_TRAVEL)
    expect(out.max).toEqual(front.max)
    expect(pulledOut(front, 0)).toEqual(front)
    expect(footprint(out)).toEqual({ minX: out.min[0], maxX: 0.62, minZ: 2, maxZ: 2.8 })
  })
})

describe('the prompt under the reticle', () => {
  test('it names what E will do to the thing in view', () => {
    expect(promptFor('seat', false)).toBe('E — сесть')
    expect(promptFor('drawer', false)).toBe('E — выдвинуть')
    expect(promptFor('drawer', true)).toBe('E — задвинуть')
    expect(promptFor('switch', false)).toBe('E — включить')
    expect(promptFor('switch', true)).toBe('E — выключить')
  })
})
