// The map on the engineer's desk: the Galaxy seen from above its plane, the ship in the middle; and what a trip to a
// target would take at 1 g with the turn-over half way, from rest.
import type { Vec3 } from './galaxy'
import { C, LY } from './physics'

/** ly from the middle of the map to its top edge: from about 63 au to the whole disc, ten times apart. */
export const MAP_SCALES: readonly number[] = [0.001, 0.01, 0.1, 1, 10, 100, 1000, 10_000, 100_000]
export const MAP_START = 4 // 10 ly: the Sun and the nearest stars in one view

/**
 * Where a point in galactic coordinates (ly) falls on a map `width` × `height` px centred on `centre`, seen from the north
 * galactic pole: towards the galactic centre (+x) is up and the way the Galaxy turns (+y) is to the left. Height above the
 * plane is not shown.
 */
export function toMap(point: Vec3, centre: Vec3, halfHeightLy: number, width: number, height: number): readonly [number, number] {
  const pxPerLy = height / 2 / halfHeightLy
  return [width / 2 - (point[1] - centre[1]) * pxPerLy, height / 2 - (point[0] - centre[0]) * pxPerLy]
}

/** The index of the point nearest (x, y) within `reach` px, or null. */
export function nearestPoint(points: ReadonlyArray<readonly [number, number]>, x: number, y: number, reach: number): number | null {
  let best: number | null = null
  let bestDistance = Infinity
  points.forEach(([px, py], i) => {
    const distance = Math.hypot(px - x, py - y)
    if (distance <= reach && distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  return best
}

/**
 * Ship and Earth seconds for `distanceLy` at proper acceleration `a` (m/s²), from rest, turning over half way: the
 * relativistic rocket, τ = (2c/a)·arcosh(1 + a·d/2c²) and t = (2c/a)·sinh(a·τ/2c).
 */
export function tripTimes(distanceLy: number, a: number): { readonly ship: number; readonly earth: number } {
  const half = (distanceLy * LY) / 2
  const halfTau = (C / a) * Math.acosh(1 + (a * half) / (C * C))
  return { ship: 2 * halfTau, earth: (2 * C / a) * Math.sinh((a * halfTau) / C) }
}
