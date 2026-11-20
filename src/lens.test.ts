import { describe, expect, test } from 'vitest'
import { imageAt, lensFor, magnification, outgoing, rayRadius, raysFor, shadowAngle, sweep } from './lens'

const DEG = Math.PI / 180

describe('the shadow', () => {
  test('from 10 r_s the shadow spans 28.5°: sin ε = (3√3/2)(r_s/r)√(1 − r_s/r)', () => {
    expect((2 * shadowAngle(10)) / DEG).toBeCloseTo(28.54, 2)
  })

  test('a ray just outside the shadow edge gets away, one just inside falls in', () => {
    const edge = shadowAngle(10)
    expect(sweep(10, edge * (1 + 1e-4)).escaped).toBe(true)
    expect(sweep(10, edge * (1 - 1e-4)).escaped).toBe(false)
  })
})

describe('where a ray goes', () => {
  test('far from the hole a ray is bent by 2 r_s/b, as Einstein found', () => {
    const x = 1e5
    const b = 1000 // r_s
    const eps = Math.asin((b * Math.sqrt(1 - 1 / x)) / x)
    const lens = lensFor(x)
    expect((eps - outgoing(lens, eps)) / (2 / b)).toBeCloseTo(1, 2)
  })

  test('looking straight away from the hole the sky is where it is, and the map is monotonic', () => {
    const lens = lensFor(10)
    expect(outgoing(lens, Math.PI)).toBeCloseTo(Math.PI, 9)
    let last = -Infinity
    for (let eps = lens.shadow * 1.000001; eps < Math.PI; eps += 0.01) {
      const f = outgoing(lens, eps)
      expect(f).toBeGreaterThan(last)
      last = f
    }
  })

  test('the image of a direction comes back to it', () => {
    const lens = lensFor(10)
    for (const eps of [lens.shadow * 1.001, 0.4, 1, 2, 3]) expect(imageAt(lens, outgoing(lens, eps))).toBeCloseTo(eps, 5)
  })
})

describe('images of a star', () => {
  test('a star right behind the hole is a ring √(2 r_s/r) in radius, far out where the second order is under 0.1 %', () => {
    const x = 1e6 // at 10⁴ r_s the ring is 0.5 % wider, from the (15π/32)·r_s/b of the next order of the bending
    expect(imageAt(lensFor(x), 0) / Math.sqrt(2 / x)).toBeCloseTo(1, 2)
  })

  test('far from the hole the two images add up to the point lens: (u² + 2)/(u√(u² + 4))', () => {
    const x = 1e4
    const lens = lensFor(x)
    const u = 0.5
    const gamma = u * Math.sqrt(2 / x)
    const total = magnification(lens, imageAt(lens, gamma), gamma) + magnification(lens, imageAt(lens, -gamma), gamma)
    expect(total / ((u * u + 2) / (u * Math.sqrt(u * u + 4)))).toBeCloseTo(1, 2)
  })

  test('on the ring a star of finite size is bright, not infinitely so', () => {
    const lens = lensFor(1e4)
    const ring = imageAt(lens, 0)
    expect(magnification(lens, ring, 0, 1e-6)).toBeGreaterThan(100)
    expect(Number.isFinite(magnification(lens, ring, 0, 1e-6))).toBe(true)
  })
})

describe('where along a ray it is, for the disk', () => {
  test('far from the hole a ray is a straight line: r = b / sin(φ + ε)', () => {
    const x = 1e5
    const rays = raysFor(x)
    const eps = 0.3
    const b = x * Math.sin(eps)
    for (const phi of [0.2, Math.PI / 2 - eps, 2.5]) expect(rayRadius(rays, eps, phi) / (b / Math.sin(phi + eps))).toBeCloseTo(1, 2)
  })

  test('a ray at the edge of the shadow circles the photon sphere, 1.5 r_s out', () => {
    const rays = raysFor(10)
    const r = rayRadius(rays, rays.shadow * (1 + 1e-5), Math.PI)
    expect(r).toBeGreaterThan(1.5)
    expect(r).toBeLessThan(1.7)
  })

  test('a ray into the shadow is gone once it reaches the horizon, one outside once it is away', () => {
    const rays = raysFor(10)
    expect(rayRadius(rays, rays.shadow / 2, 3 * Math.PI - 0.01)).toBe(0)
    expect(rayRadius(rays, 2, 3 * Math.PI - 0.01)).toBe(Infinity)
  })

  // Seen from in or over a wide disk, its far side runs out to a horizon: rays that leave just after they cross its
  // plane. A ray between two tabled ones has to end where it truly ends, or the horizon is drawn with the table's teeth.
  test('between the tabled rays a ray is still there until it gets away, and gone right after', () => {
    const NEAR = 0.01 // rad from its end
    for (const x of [78, 3000, 30_000]) {
      const rays = raysFor(x)
      for (const eps of [0.4, 0.9, 1.3, 1.57, 2.2]) {
        const end = sweep(x, eps).phi
        const b = (x * Math.sin(eps)) / Math.sqrt(1 - 1 / x)

        const before = rayRadius(rays, eps, end - NEAR)
        const after = rayRadius(rays, eps, end + NEAR)

        expect(before / (b / Math.sin(NEAR))).toBeGreaterThan(0.9) // nearly straight by then: r = b / sin(what is left)
        expect(before / (b / Math.sin(NEAR))).toBeLessThan(1.1)
        expect(after).toBe(Infinity)
      }
    }
  })

  test('a ray into the shadow is inside the horizon from where it reaches it, between the tabled rays too', () => {
    const x = 10
    const rays = raysFor(x)
    for (const part of [0.3, 0.77, 0.93]) {
      const eps = rays.shadow * part
      const end = sweep(x, eps).phi

      expect(rayRadius(rays, eps, end - 0.02)).toBeGreaterThan(1)
      expect(rayRadius(rays, eps, end + 0.02)).toBe(0)
    }
  })
})
