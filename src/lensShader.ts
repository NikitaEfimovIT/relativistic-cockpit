import * as THREE from 'three'
import { DISK_INNER, type Hole } from './blackHoles'
import type { Vec3 } from './galaxy'
import { INWARD_SPAN, LENS_SAMPLES, RAY_COLUMNS, RAY_ROWS, RAY_SWEEP, lensFor, raysFor, type Lens, type Rays } from './lens'
import { LY } from './physics'
import { holeNear } from './voyage'

// The lens of the nearest black hole on the GPU: the tables of lens.ts in textures, and their uses. The sky is looked up
// along where a ray from the eye truly came from, unless the ray met the hole's disk or its star first, or fell in; each
// star is drawn where its images are. All in the galactic axes, the frame of an eye at rest by the hole: the ship's own
// motion is aberrated on top, as everywhere.

/** GLSL: what a shader needs to lens. Without a hole near, uLensOn is 0 and uBlue 1, and nothing changes. */
export const LENS_GLSL = /* glsl */ `
uniform float uLensOn, uShadow, uSpan, uBlue, uX;
uniform vec3 uHole; // unit, galactic axes, towards the hole
uniform sampler2D uLensTable; // r: the bending δ, g: dδ/dt, over t (lens.ts)
uniform float uDiskOn, uDiskOuter, uDiskT4;
uniform vec3 uDiskAxis; // unit: the gas goes round it right-handed
uniform sampler2D uRays; // w = u·b along each ray (lens.ts, raysFor)
uniform float uCompanionOn, uCompanionR, uCompanionT;
uniform vec3 uCompanion; // r_s from the hole, galactic axes
const float LENS_PI = 3.14159265;
const float RAY_HALF = ${(RAY_ROWS / 2).toFixed(1)};
const float RAY_LAST_COLUMN = ${(RAY_COLUMNS - 1).toFixed(1)};
const float RAY_SWEEP = ${RAY_SWEEP.toFixed(7)};
const float INWARD_SPAN = ${INWARD_SPAN.toFixed(7)};
vec2 lensAt(float t) {
  float at = clamp(t, 0., 1.) * ${(LENS_SAMPLES - 1).toFixed(1)};
  int i = min(int(at), ${LENS_SAMPLES - 2});
  return mix(texelFetch(uLensTable, ivec2(i, 0), 0).rg, texelFetch(uLensTable, ivec2(i + 1, 0), 0).rg, at - float(i));
}
float lensT(float eps) { return 1. + log((eps - uShadow) / (LENS_PI - uShadow)) / uSpan; }
float lensEps(float t) { return uShadow + (LENS_PI - uShadow) * exp(uSpan * (t - 1.)); }
float outgoing(float eps) { return eps - lensAt(lensT(eps)).r; }
// The angle from the hole, from a chord and not a cosine, which loses it near the hole; and the unit vector across.
float fromHole(vec3 n, out vec3 across) {
  float c = dot(n, uHole);
  vec3 side = n - c * uHole;
  float s = length(side);
  across = s > 1e-30 ? side / s : normalize(cross(uHole, abs(uHole.x) < .9 ? vec3(1., 0., 0.) : vec3(0., 1., 0.)));
  return atan(s, c);
}
float impact(float eps) { return uX * sin(eps) / sqrt(1. - 1. / uX); }
// u = r_s/r at φ along the ray seen at eps: <= 0 once it has got away, >= 1 once it has fallen in.
float rayU(float eps, float phi) {
  float row = eps < uShadow
    ? clamp(-log(1. - eps / uShadow) / INWARD_SPAN * (RAY_HALF - 1.), 0., RAY_HALF - 1.)
    : RAY_HALF + clamp(1. + log((eps - uShadow) / (LENS_PI - uShadow)) / uSpan, 0., 1.) * (RAY_HALF - 1.);
  float lower = row < RAY_HALF ? min(RAY_HALF - 2., floor(row)) : min(2. * RAY_HALF - 2., floor(row));
  float col = clamp(phi / RAY_SWEEP * RAY_LAST_COLUMN, 0., RAY_LAST_COLUMN - .001);
  ivec2 p = ivec2(int(col), int(lower));
  float f = fract(col);
  float a = mix(texelFetch(uRays, p, 0).r, texelFetch(uRays, p + ivec2(1, 0), 0).r, f);
  float b = mix(texelFetch(uRays, p + ivec2(0, 1), 0).r, texelFetch(uRays, p + ivec2(1, 1), 0).r, f);
  float w = mix(a, b, row - lower);
  // past the shadow the table holds what the hole adds to a straight line (lens.ts, straight)
  if (eps >= uShadow) w += phi + eps < LENS_PI ? sin(phi + eps) : LENS_PI - phi - eps;
  return w / max(impact(eps), 1e-30);
}
// Page & Thorne 1974, eq. 15n, at x = r/M (disk.ts)
float thinDiskFlux(float x) {
  if (x <= 6.) return 0.;
  float s = sqrt(x);
  float l = log(((s + 1.7320508) * (2.4494897 - 1.7320508)) / ((2.4494897 + 1.7320508) * (s - 1.7320508)));
  return (s - 2.4494897 + .8660254 * l) / ((x - 3.) * x * x * sqrt(x));
}
// The disk where the ray seen along n (eps, across) first meets it: its temperature as the eye gets it. It crosses the
// disk's plane every half turn; the gas's motion and the climb out of the well shift the light (Luminet 1979).
bool diskHit(float eps, vec3 across, vec3 n, out float seenT) {
  seenT = 0.;
  if (uDiskOn < .5) return false;
  float phi0 = atan(dot(uHole, uDiskAxis), dot(across, uDiskAxis));
  if (phi0 <= 0.) phi0 += LENS_PI;
  for (int k = 0; k < 3; k++) {
    float phi = phi0 + float(k) * LENS_PI;
    if (phi >= RAY_SWEEP) break;
    float u = rayU(eps, phi);
    if (u <= 0. || u >= 1.) return false;
    float r = 1. / u;
    if (r >= ${DISK_INNER.toFixed(1)} && r <= uDiskOuter) {
      vec3 spin = cross(uHole, n);
      float lambda = impact(eps) * dot(spin / max(length(spin), 1e-30), uDiskAxis); // L_z/E of the light, r_s
      float g = sqrt(1. - 1.5 / r) / ((1. - sqrt(.5 / (r * r * r)) * lambda) * sqrt(1. - 1. / uX));
      seenT = pow(uDiskT4 * thinDiskFlux(2. * r), .25) * g;
      return true;
    }
  }
  return false;
}
// What the eye sees along n by a hole: 0 the sky, n moved to where its light came from; 1 nothing, the shadow; 2 a surface,
// the disk or the hole's star, of temperature seenT as it arrives (before the ship's own Doppler).
int lensView(inout vec3 n, out float seenT) {
  seenT = 0.;
  if (uLensOn < .5) return 0;
  vec3 across;
  float eps = fromHole(n, across);
  if (diskHit(eps, across, n, seenT)) return 2;
  if (eps <= uShadow) return 1;
  float f = outgoing(eps);
  vec3 away = cos(f) * uHole + sin(f) * across;
  if (uCompanionOn > .5) { // straight once out of the hole's pull: the line at b from it, which a star near by can be on
    vec3 w = uCompanion - impact(eps) * (-sin(f) * uHole + cos(f) * across);
    float along = dot(w, away);
    if (along > 0. && dot(w, w) - along * along < uCompanionR * uCompanionR) {
      seenT = uCompanionT * uBlue;
      return 2;
    }
  }
  n = away;
  return 0;
}
// Where a source along s is seen: its image on its own side of the hole (far = 0) or beyond it (far = 1), and how much
// brighter that image is (mu), nothing behind the disk. rho, the source's angular radius, caps the brightening on the ring.
vec3 imageOf(vec3 s, float far, float rho, out float mu) {
  vec3 across;
  float gamma = fromHole(s, across);
  float target = far < .5 ? gamma : -gamma;
  float lo = 0., hi = 1.;
  for (int i = 0; i < 18; i++) {
    float mid = .5 * (lo + hi);
    if (outgoing(lensEps(mid)) < target) lo = mid; else hi = mid;
  }
  float t = .5 * (lo + hi);
  float eps = lensEps(t);
  float dfDeps = 1. - lensAt(t).g / ((eps - uShadow) * uSpan);
  mu = sin(eps) / (max(abs(sin(gamma)), rho) * abs(dfDeps));
  vec3 side = far < .5 ? across : -across;
  vec3 seen = cos(eps) * uHole + sin(eps) * side;
  float blocked;
  if (diskHit(eps, side, seen, blocked)) mu = 0.;
  return seen;
}`

export interface SkyLens {
  readonly uniforms: Record<string, THREE.IUniform>
  readonly isOn: () => boolean
  /** The star drawn as a disc by the hole, not as a point, while the lens is on. */
  readonly hiddenStar: () => string | null
  /** The hole nearest `position` (ly) sets the lens; the tables are refreshed once its distance changes by 1 %. */
  update(position: Vec3): void
  dispose(): void
}

const REFRESH = 0.01
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

export function createLens(): SkyLens {
  const bending = new Float32Array(LENS_SAMPLES * 4)
  const table = new THREE.DataTexture(bending, LENS_SAMPLES, 1, THREE.RGBAFormat, THREE.FloatType)
  const rays = new THREE.DataTexture(new Float32Array(RAY_COLUMNS * RAY_ROWS), RAY_COLUMNS, RAY_ROWS, THREE.RedFormat, THREE.FloatType)
  const uniforms = {
    uLensOn: { value: 0 },
    uHole: { value: new THREE.Vector3(0, 0, 1) },
    uShadow: { value: 0 },
    uSpan: { value: 1 },
    uBlue: { value: 1 },
    uX: { value: 1e6 },
    uLensTable: { value: table },
    uDiskOn: { value: 0 },
    uDiskOuter: { value: 0 },
    uDiskT4: { value: 0 },
    uDiskAxis: { value: new THREE.Vector3(0, 0, 1) },
    uRays: { value: rays },
    uCompanionOn: { value: 0 },
    uCompanionR: { value: 0 },
    uCompanionT: { value: 0 },
    uCompanion: { value: new THREE.Vector3() },
  }
  let tabled: { readonly hole: Hole; readonly lens: Lens; readonly rays: Rays | null } | null = null
  let hidden: string | null = null
  const refresh = (hole: Hole, x: number): void => {
    const lens = lensFor(x)
    lens.delta.forEach((delta, i) => bending.set([delta, lens.slope[i]], 4 * i))
    table.needsUpdate = true
    const traced = hole.disk ? raysFor(x) : null
    if (traced) {
      ;(rays.image.data as Float32Array).set(traced.table)
      rays.needsUpdate = true
    }
    tabled = { hole, lens, rays: traced }
    uniforms.uShadow.value = lens.shadow
    uniforms.uSpan.value = lens.span
    uniforms.uX.value = x
  }
  return {
    uniforms,
    isOn: () => uniforms.uLensOn.value > 0,
    hiddenStar: () => hidden,
    update(position) {
      const near = holeNear(position)
      uniforms.uLensOn.value = near ? 1 : 0
      uniforms.uBlue.value = 1
      uniforms.uDiskOn.value = 0
      uniforms.uCompanionOn.value = 0
      hidden = null
      if (!near) return
      const { hole, rs } = near
      const x = Math.max(1.5, near.r / rs)
      if (!tabled || tabled.hole !== hole || Math.abs(x / tabled.lens.x - 1) > REFRESH) refresh(hole, x)
      uniforms.uHole.value.set(...near.direction)
      uniforms.uBlue.value = 1 / Math.sqrt(1 - 1 / x) // the sky blueshifted for an eye at rest down in the well
      if (hole.disk) {
        uniforms.uDiskOn.value = 1
        uniforms.uDiskOuter.value = hole.disk.outer
        uniforms.uDiskT4.value = hole.disk.t4
        uniforms.uDiskAxis.value.set(...hole.disk.axis)
      }
      if (hole.companion) {
        uniforms.uCompanionOn.value = 1
        uniforms.uCompanion.value.set(...sub(hole.companion.position, hole.position).map((c) => (c * LY) / rs) as [number, number, number])
        uniforms.uCompanionR.value = hole.companion.radius / rs
        uniforms.uCompanionT.value = hole.companion.temperature
        hidden = hole.companion.name
      }
    },
    dispose() {
      table.dispose()
      rays.dispose()
    },
  }
}
