// Getting about the ship on foot: walking, bumping into things, ducking and looking at them.
// Kept apart from the rendering so that it can be tested.
//
// Axes as everywhere in the app: x to starboard, y up, z aft, metres from the pilot's eye.
// A floor to walk on is a fiction this ship allows itself: under thrust "down" points aft,
// and a coasting ship has no "down" at all (see FORMULAS.md).

export type Vec3 = readonly [number, number, number]

/** A place on the deck plan. */
export interface Spot {
  readonly x: number
  readonly z: number
}

/** Something that cannot be walked through, as its outline on the deck plan. */
export interface Box {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

/** A height along the ship: [z, height] points, straight between them and level beyond the ends. */
export type Profile = readonly (readonly [number, number])[]

export interface WalkKeys {
  readonly forward: boolean
  readonly back: boolean
  readonly left: boolean
  readonly right: boolean
}

export type TargetKind = 'seat' | 'drawer' | 'switch' | 'key'

/** Something E can act on, as the box the gaze has to land on. */
export interface Target {
  readonly id: string
  readonly kind: TargetKind
  readonly min: Vec3
  readonly max: Vec3
}

export type SeatName = 'pilot' | 'desk'

export interface Drawer {
  readonly isOpen: boolean
  /** 0 pushed home, 1 pulled all the way out. */
  readonly slide: number
}

export interface Body {
  /** The seat taken, or null when on foot. */
  readonly seat: SeatName | null
  /** Where the feet are while on foot. */
  readonly at: Spot
  /** Drawers that have been touched, by the name of their target; the rest are shut. */
  readonly drawers: Readonly<Record<string, Drawer>>
}

// Chosen figures for one adult, not a model of anyone in particular.
export const BODY_RADIUS = 0.25 // m
export const WALK_SPEED = 1.3 // m/s, an unhurried walk
export const STANDING_EYE = 1.62 // m above the floor
export const HEAD_CLEARANCE = 0.13 // m from the eye up to what the head has to stay under
export const REACH = 2.0 // m: far enough for a drawer at the feet of a standing body
export const DRAWER_TIME = 0.5 // s to slide all the way
export const DRAWER_TRAVEL = 0.45 // m

const PUSH_PASSES = 3
const SHUT: Drawer = { isOpen: false, slide: 0 }

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high)

/** The height of a profile at a place along the ship. */
export function heightAt(profile: Profile, z: number): number {
  const after = profile.findIndex(([edge]) => edge >= z)
  if (after === 0) return profile[0][1]
  if (after < 0) return profile[profile.length - 1][1]
  const [z0, h0] = profile[after - 1]
  const [z1, h1] = profile[after]
  return h0 + ((h1 - h0) * (z - z0)) / (z1 - z0)
}

/**
 * Where the eye is carried: standing tall where there is room, ducking where the ceiling is low.
 * ponytail: the ceiling is a profile along the ship only, so the canopy's slope to the sides is
 * ignored; the one place it matters is a strip half a metre wide. A ceiling(x, z) if that grows.
 */
export function eyeHeight(floor: Profile, ceiling: Profile, z: number): number {
  return Math.min(heightAt(floor, z) + STANDING_EYE, heightAt(ceiling, z) - HEAD_CLEARANCE)
}

/** Moves a round body off one box: away from the nearest point, or out through the nearest side. */
function pushFrom(at: Spot, box: Box, radius: number): Spot {
  const nearX = clamp(at.x, box.minX, box.maxX)
  const nearZ = clamp(at.z, box.minZ, box.maxZ)
  const gap = Math.hypot(at.x - nearX, at.z - nearZ)
  if (gap >= radius) return at
  if (gap > 0) {
    return { x: nearX + ((at.x - nearX) / gap) * radius, z: nearZ + ((at.z - nearZ) / gap) * radius }
  }
  const exits: readonly (readonly [number, number, number])[] = [
    [at.x - box.minX, -1, 0],
    [box.maxX - at.x, 1, 0],
    [at.z - box.minZ, 0, -1],
    [box.maxZ - at.z, 0, 1],
  ]
  const [depth, alongX, alongZ] = exits.reduce((best, exit) => (exit[0] < best[0] ? exit : best))
  return { x: at.x + alongX * (depth + radius), z: at.z + alongZ * (depth + radius) }
}

/** Where a round body ends up once nothing overlaps it. Sliding along a wall falls out of this. */
export function pushOut(at: Spot, boxes: readonly Box[], radius = BODY_RADIUS): Spot {
  let spot = at
  for (let pass = 0; pass < PUSH_PASSES; pass++) {
    spot = boxes.reduce((moved, box) => pushFrom(moved, box, radius), spot)
  }
  return spot
}

/**
 * One frame of walking. The camera looks along -z at yaw 0 and turns left as yaw grows,
 * so forward is (-sin yaw, -cos yaw) on the plan and the right hand is (cos yaw, -sin yaw).
 * A step is never longer than the body's radius, so a stalled frame cannot jump a wall.
 * ponytail: one speed, no acceleration and no slower crouch; add them when walking feels wrong.
 */
export function walk(at: Spot, keys: WalkKeys, yaw: number, dt: number, boxes: readonly Box[]): Spot {
  const along = Number(keys.forward) - Number(keys.back)
  const across = Number(keys.right) - Number(keys.left)
  const wish = Math.hypot(along, across)
  if (wish === 0) return pushOut(at, boxes)
  const step = Math.min(WALK_SPEED * dt, BODY_RADIUS) / wish
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  const next = {
    x: at.x + (cos * across - sin * along) * step,
    z: at.z - (sin * across + cos * along) * step,
  }
  return pushOut(next, boxes)
}

/** How far along a ray a box is entered, one axis at a time; Infinity when the ray misses it. */
function entry(
  origin: readonly number[],
  direction: readonly number[],
  min: readonly number[],
  max: readonly number[],
): number {
  let near = 0
  let far = Infinity
  for (let axis = 0; axis < origin.length; axis++) {
    if (direction[axis] === 0) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return Infinity
      continue
    }
    const one = (min[axis] - origin[axis]) / direction[axis]
    const other = (max[axis] - origin[axis]) / direction[axis]
    near = Math.max(near, Math.min(one, other))
    far = Math.min(far, Math.max(one, other))
  }
  return near <= far ? near : Infinity
}

/**
 * What the gaze rests on: the nearest target along a unit direction, within reach and not behind a wall.
 * Walls are the full-height boxes of the plan, so their test needs no height.
 * ponytail: furniture does not hide anything; give it heights and test it here if a prompt ever
 * shows through a cupboard.
 */
export function gazeTarget(
  eye: Vec3,
  direction: Vec3,
  targets: readonly Target[],
  walls: readonly Box[],
  reach = REACH,
): Target | null {
  const plan = [eye[0], eye[2]]
  const heading = [direction[0], direction[2]]
  const limit = Math.min(
    reach,
    ...walls.map((wall) => entry(plan, heading, [wall.minX, wall.minZ], [wall.maxX, wall.maxZ])),
  )
  let found: Target | null = null
  let foundAt = Infinity
  for (const target of targets) {
    const at = entry(eye, direction, target.min, target.max)
    if (at <= limit && at < foundAt) {
      found = target
      foundAt = at
    }
  }
  return found
}

/** The voyage starts strapped into the pilot couch, with every drawer shut. */
export function initialBody(): Body {
  return { seat: 'pilot', at: { x: 0, z: 0 }, drawers: {} }
}

export function sitDown(body: Body, seat: SeatName): Body {
  return { ...body, seat }
}

/** Out of the seat and onto the spot where that seat lets its occupant out. */
export function standUp(body: Body, exit: Spot): Body {
  return { ...body, seat: null, at: exit }
}

const drawerOf = (body: Body, id: string): Drawer => (Object.hasOwn(body.drawers, id) ? body.drawers[id] : SHUT)

/** How far out a drawer is, 0 to 1. */
export function slideOf(body: Body, id: string): number {
  return drawerOf(body, id).slide
}

/** Whether a drawer has been pulled, however far it has slid so far. */
export function isDrawerOpen(body: Body, id: string): boolean {
  return drawerOf(body, id).isOpen
}

export function toggleDrawer(body: Body, id: string): Body {
  const drawer = drawerOf(body, id)
  return { ...body, drawers: { ...body.drawers, [id]: { ...drawer, isOpen: !drawer.isOpen } } }
}

/** Slides every drawer toward where it was sent, at a steady rate. */
export function stepDrawers(body: Body, dt: number): Body {
  const drawers = Object.entries(body.drawers)
  if (drawers.every(([, drawer]) => drawer.slide === Number(drawer.isOpen))) return body
  const step = dt / DRAWER_TIME
  const slid = drawers.map(([id, drawer]): readonly [string, Drawer] => [
    id,
    { ...drawer, slide: clamp(drawer.slide + (drawer.isOpen ? step : -step), 0, 1) },
  ])
  return { ...body, drawers: Object.fromEntries(slid) }
}

/**
 * A drawer's box once it has slid: the gaze can land on all of it, and its footprint blocks the aisle.
 * ponytail: every drawer slides toward -x, because they all live under the bed on the starboard
 * wall; give the target a direction when another wall gets drawers.
 */
export function pulledOut(drawer: Target, slide: number): Target {
  const [x, y, z] = drawer.min
  return { ...drawer, min: [x - slide * DRAWER_TRAVEL, y, z] }
}

/** The outline on the deck plan of a box given in three dimensions. */
export function footprint(box: { readonly min: Vec3; readonly max: Vec3 }): Box {
  return { minX: box.min[0], maxX: box.max[0], minZ: box.min[2], maxZ: box.max[2] }
}

/** What E will do to the thing under the reticle, given whether that thing is already on or open. */
export function promptFor(kind: TargetKind, isActive: boolean): string {
  if (kind === 'seat') return 'E — сесть'
  if (kind === 'drawer') return isActive ? 'E — задвинуть' : 'E — выдвинуть'
  if (kind === 'key') return 'E — нажать'
  return isActive ? 'E — выключить' : 'E — включить'
}

let current: Body = initialBody()

/** The single live body. Every read gets an immutable snapshot; every change replaces it. */
export const body = {
  get: (): Body => current,
  update: (change: (b: Body) => Body): void => {
    current = change(current)
  },
}
