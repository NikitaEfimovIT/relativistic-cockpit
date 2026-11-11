import * as THREE from 'three'
import type { Vec3 } from './galaxy'
import { LY, apparentDirection, lutXYZ } from './physics'
import { LAUNCH_JD, MOON_AXES, SPINS, earthAxes, spinAxes, type EarthAxes, type Globe } from './solarSystem'
import { dopplerTowards, galacticToShip, type Quat } from './voyage'
import { createRings } from './rings'

// A Lambert sphere lit by its star, drawn among the stars and in front of them: the Earth and the Moon from their maps,
// the planets, here and round other stars, in the hue of their albedo, each as bright as its measured magnitude law
// (solarSystem.ts, exoplanets.ts). They stay where they were at launch. The Earth's atmosphere is not modelled; its map, if present, is NASA's Blue Marble (public domain).

const DRAW_DISTANCE = 4 // m: inside the camera's far plane, far outside the cabin; only the angle matters
const MIN_RADIUS_PX = 1.2 // below this the disc is drawn this big and dimmed to keep its flux

const VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uRadius;
varying vec3 vNormal;
void main() {
  vNormal = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (uCentre + uRadius * position), 1.);
  gl_Position.z = gl_Position.w * 0.9997;
}`

// Longitude jumps from +π to −π on the far meridian; taking the texture gradient from whichever of two seams is
// further away keeps the mip level right there, instead of a line of the smallest mip down the globe.
// A made-up surface for a planet no one has seen (README says so): mottled rock, or the bands of a giant, faint for an
// ice giant, strong for a gas giant, each varying about 1 so that the disc keeps the light of its albedo law.
const PATTERN = /* glsl */ `
uniform float uPattern, uSeed;
float hash(vec3 p) {
  p = fract(p * .3183099 + .1) * 17.;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float sum = 0., a = .5;
  for (int i = 0; i < 5; i++) { sum += a * noise(p); p *= 2.03; a *= .5; }
  return sum;
}
float pattern(vec3 e) {
  vec3 p = e * 3. + uSeed;
  if (uPattern < 1.5) return .55 + .95 * fbm(p * 1.6);
  float bands = sin(e.z * (uPattern < 2.5 ? 22. : 40.) + 1.4 * fbm(p * 1.7) + uSeed);
  return 1. + (uPattern < 2.5 ? .06 : .26) * bands;
}`

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap, uRadiance, uExposure;
uniform vec3 uSun, uSunTint, uAlbedo;
uniform mat3 uToSurface;
varying vec3 vNormal;
${PATTERN}
void main() {
  vec3 n = normalize(vNormal);
  vec3 albedo = uAlbedo;
  if (uHasMap < .5 && uPattern > .5) albedo *= pattern(uToSurface * n);
  if (uHasMap > .5) {
    vec3 e = uToSurface * n;
    vec2 uv = vec2(atan(e.y, e.x) / 6.2831853 + .5, asin(clamp(e.z, -1., 1.)) / 3.14159265 + .5);
    vec2 shifted = vec2(fract(uv.x + .5), uv.y);
    vec2 dx = dFdx(uv), dy = dFdy(uv), sdx = dFdx(shifted), sdy = dFdy(shifted);
    bool isSeam = abs(sdx.x) + abs(sdy.x) < abs(dx.x) + abs(dy.x);
    albedo *= textureGrad(uMap, uv, isSeam ? sdx : dx, isSeam ? sdy : dy).rgb; // uAlbedo is the map's scale then
  }
  vec3 c = albedo * uSunTint * uRadiance * max(dot(n, uSun), 0.) * uExposure;
  gl_FragColor = vec4(c * min(1., 3e4 / max(max(c.r, max(c.g, c.b)), 1e-20)), 1.); // in half-float range, hue kept
}`

export interface GlobeView {
  readonly phi: number
  readonly position: Vec3 // ly from the Sun, galactic axes
  readonly attitude: Quat
  readonly days: number // since launch
  readonly exposure: number
}

export interface SkyGlobe {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  readonly rings?: THREE.Mesh // Saturn's, drawn after it
  update(view: GlobeView, pixelAngle: number): void
  dispose(): void
}

/** A map to lay on a globe, and which way the globe faces a number of days after launch. */
export interface SurfaceMap {
  readonly url: string
  readonly axes: (days: number) => EarthAxes
  /**
   * For a map that gives only the pattern: its mean over the near side, weighted as a full disc lights it (cos² from the
   * centre). The map is then scaled so that this mean is the body's own albedo. Without it the pixels are the albedo.
   */
  readonly meanAlbedo?: number
  /** A grey map, of brightness only: it is laid over the hue of the body's albedo, as the Moon's colour is not. */
  readonly isTinted?: boolean
}

const BASE = import.meta.env.BASE_URL // the site's root: on GitHub Pages, the repository's path
export const EARTH_MAP: SurfaceMap = { url: `${BASE}earth.jpg`, axes: (days) => earthAxes(LAUNCH_JD + days) }
/** NASA SVS CGI Moon Kit, the 2025 colour map: balanced for the eye and not calibrated, so only its pattern is used. */
export const MOON_MAP: SurfaceMap = { url: `${BASE}moon.jpg`, axes: () => MOON_AXES, meanAlbedo: 0.38 }

/** A planet's map, turned as the IAU has it spin. `meanAlbedo`: the map's linear luminance averaged over its area. */
const planetMap = (name: string, url: string, meanAlbedo: number, isTinted = false): SurfaceMap =>
  ({ url: `${BASE}${url}`, axes: (days) => spinAxes(SPINS[name], LAUNCH_JD + days), meanAlbedo, isTinted })

/**
 * Mercury: MESSENGER's monochrome basemap (NASA/JHUAPL/Carnegie), in Mercury's own hue. Mars: the Viking colorized
 * mosaic MDIM 2.1 (NASA/JPL/USGS). Jupiter: Cassini's cylindrical map of December 2000 (NASA/JPL/Space Science Institute,
 * PIA07782); its bands and spots move, so it shows Jupiter as it was then. All public domain, cut to 2048 × 1024.
 */
export const PLANET_MAPS: Readonly<Record<string, SurfaceMap>> = {
  'Меркурий': planetMap('Меркурий', 'mercury.jpg', 0.1172, true),
  'Марс': planetMap('Марс', 'mars.jpg', 0.1308),
  'Юпитер': planetMap('Юпитер', 'jupiter.jpg', 0.365),
}

const LUMA = new THREE.Vector3(0.2126, 0.7152, 0.0722)
const GALACTIC_AXES: EarthAxes = { greenwich: [1, 0, 0], east: [0, 1, 0], pole: [0, 0, 1] }

/**
 * `tintOf` gives the linear sRGB colour of a blackbody of unit luminance. From the moving ship the lit body is a diluted
 * blackbody at T′ = DT of its star, as in the galaxy shader, and its disc is 1/D the size. `geometry` is shared: the
 * caller disposes of it.
 */
export function createGlobe(
  globe: Globe, tintOf: (temperature: number) => THREE.Vector3, geometry: THREE.SphereGeometry, renderOrder: number, map?: SurfaceMap,
): SkyGlobe {
  const { star } = globe
  const fromStar: Vec3 = [globe.position[0] - star.position[0], globe.position[1] - star.position[1], globe.position[2] - star.position[2]]
  const distance = Math.hypot(...fromStar)
  const towardsStar: Vec3 = [-fromStar[0] / distance, -fromStar[1] / distance, -fromStar[2] / distance]
  /** Luminance of a white Lambert surface facing its star there, cd/m²: E/π with E = Y(T)·πR²/d². */
  const litWhite = (lutXYZ(star.temperature)[1] * star.radiusSquared) / distance ** 2
  const colour = new THREE.Vector3(...globe.colour)
  const hue = colour.clone().divideScalar(colour.clone().multiply(tintOf(star.temperature)).dot(LUMA)) // luminance 1 in its light

  const uniforms = {
    uMap: { value: null as THREE.Texture | null },
    uHasMap: { value: 0 },
    uRadiance: { value: litWhite },
    uExposure: { value: 1 },
    uSun: { value: new THREE.Vector3() },
    uSunTint: { value: new THREE.Vector3(1, 1, 1) },
    uAlbedo: { value: new THREE.Vector3() },
    uToSurface: { value: new THREE.Matrix3() },
    uCentre: { value: new THREE.Vector3() },
    uRadius: { value: 1 },
    uPattern: { value: globe.pattern === 'rock' ? 1 : globe.pattern === 'ice' ? 2 : globe.pattern === 'gas' ? 3 : 0 },
    uSeed: { value: [...globe.name].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 997, 7) / 97 }, // its own, from its name
  }
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }))
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder // after the stars, so that it hides the ones behind it

  if (map) {
    new THREE.TextureLoader().load(map.url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 8
      uniforms.uMap.value = texture
      uniforms.uHasMap.value = 1
    }, undefined, () => { /* no map: the globe stays in the hue of its albedo, which says so plainly */ })
  }

  const rings = globe.name === 'Сатурн' ? createRings() : null
  rings?.uniforms.uHue.value.copy(hue)

  const toSurface = new THREE.Matrix3()
  const shipToGalactic = new THREE.Matrix3()
  const rotation = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  return {
    mesh,
    rings: rings?.mesh,
    update(view, pixelAngle) {
      const offset: Vec3 = [globe.position[0] - view.position[0], globe.position[1] - view.position[1], globe.position[2] - view.position[2]]
      const length = Math.hypot(...offset)
      const unit: Vec3 = [offset[0] / length, offset[1] / length, offset[2] / length]
      const n = galacticToShip(view.attitude, unit)
      const doppler = dopplerTowards(n, view.phi)
      const seenRadius = Math.asin(Math.min(1, globe.radiusM / (length * LY))) / doppler
      const drawnRadius = Math.max(seenRadius, MIN_RADIUS_PX * pixelAngle)
      const cosPhase = -(towardsStar[0] * unit[0] + towardsStar[1] * unit[1] + towardsStar[2] * unit[2]) // star–body–ship
      uniforms.uCentre.value.set(...apparentDirection(n, view.phi)).multiplyScalar(DRAW_DISTANCE)
      uniforms.uRadius.value = DRAW_DISTANCE * Math.sin(Math.min(drawnRadius, Math.PI / 2))
      uniforms.uRadiance.value = (litWhite * lutXYZ(star.temperature * doppler)[1]) / lutXYZ(star.temperature)[1]
      uniforms.uSunTint.value.copy(tintOf(star.temperature * doppler))
      const albedo = globe.albedo(Math.acos(Math.max(-1, Math.min(1, cosPhase))))
      const scale = map?.meanAlbedo ? albedo / map.meanAlbedo : 1
      if (uniforms.uHasMap.value > 0.5 && map?.isTinted) uniforms.uAlbedo.value.copy(hue).multiplyScalar(scale)
      else if (uniforms.uHasMap.value > 0.5) uniforms.uAlbedo.value.setScalar(scale)
      else uniforms.uAlbedo.value.copy(hue).multiplyScalar(albedo)
      uniforms.uExposure.value = view.exposure * (seenRadius / drawnRadius) ** 2
      uniforms.uSun.value.set(...galacticToShip(view.attitude, towardsStar)) // uSun and uSunTint: its own star's
      if (map || globe.pattern) {
        // a made-up surface is fixed in the galaxy's axes: how fast such a planet turns is not known
        const { greenwich: g, east: e, pole: p } = map ? map.axes(view.days) : GALACTIC_AXES
        shipToGalactic.setFromMatrix4(rotation.makeRotationFromQuaternion(quaternion.set(...view.attitude)))
        toSurface.set(g[0], g[1], g[2], e[0], e[1], e[2], p[0], p[1], p[2])
        uniforms.uToSurface.value.multiplyMatrices(toSurface, shipToGalactic)
      }
      mesh.visible = seenRadius > 1e-12
      if (rings) {
        const r = rings.uniforms
        const { greenwich, east } = spinAxes(SPINS[globe.name], LAUNCH_JD + view.days) // the rings lie in the equator
        r.uCentre.value.copy(uniforms.uCentre.value)
        r.uRadius.value = uniforms.uRadius.value
        r.uU.value.set(...galacticToShip(view.attitude, greenwich))
        r.uV.value.set(...galacticToShip(view.attitude, east))
        r.uSun.value.copy(uniforms.uSun.value)
        r.uSunTint.value.copy(uniforms.uSunTint.value)
        r.uRadiance.value = uniforms.uRadiance.value
        r.uExposure.value = uniforms.uExposure.value
        rings.mesh.visible = mesh.visible && seenRadius >= MIN_RADIUS_PX * pixelAngle // a dot of a planet has no rings to see
      }
    },
    dispose() {
      mesh.material.dispose()
      rings?.mesh.material.dispose()
      rings?.mesh.geometry.dispose()
      uniforms.uMap.value?.dispose()
    },
  }
}
