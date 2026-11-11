// Things that float in the cabin. They run on the viewer's clock, not the ship's: at one month per second a pendulum
// would be a blur. The acceleration they feel is the real one, so they show what the crew's bodies would feel.

export type Vec3 = readonly [number, number, number]

/** The ship accelerates towards -z, so whatever is loose inside it falls towards +z. */
export const apparentGravity = (properAcceleration: number): Vec3 => [0, 0, properAcceleration === 0 ? 0 : properAcceleration]

export interface Tether {
  readonly position: Vec3 // relative to the anchor, m
  readonly velocity: Vec3
}

const MAX_STEP = 1 / 240 // s
const AIR_DRAG = 0.9 // 1/s, a light object in cabin air
const CORD_RESTITUTION = 0.15

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const add = (a: Vec3, b: Vec3, scale: number): Vec3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale]

/** Advances an object on a cord that can go slack but cannot stretch. */
export function stepTether(tether: Tether, length: number, acceleration: Vec3, dt: number): Tether {
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP))
  const step = dt / steps
  let { position, velocity } = tether
  for (let i = 0; i < steps; i++) {
    velocity = add(add(velocity, acceleration, step), velocity, -AIR_DRAG * step)
    position = add(position, velocity, step)
    const distance = Math.hypot(...position)
    if (distance > length) {
      const outward: Vec3 = [position[0] / distance, position[1] / distance, position[2] / distance]
      position = add([0, 0, 0], outward, length)
      const radial = dot(velocity, outward)
      if (radial > 0) velocity = add(velocity, outward, -radial * (1 + CORD_RESTITUTION)) // the cord snaps taut
    }
  }
  return { position, velocity }
}
