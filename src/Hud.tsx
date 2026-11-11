import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ADD_LIGHT_ONLY, WINDSHIELD_STENCIL } from './Canopy'
import { auto, distanceText, legend } from './format'
import { BACKGROUND_LAYER } from './frame'
import { fedBy, useWake } from './Instruments'
import { LY, G0, apparentDirection, gammaOf, skyFractionAngle } from './physics'
import { properAcceleration, sim, type SimState } from './sim'
import { directionToCentre, earthDistance, earthSource, galacticToShip, indexOfTarget, navigate, starSources, targetDirection, type Cue } from './voyage'

// Indicators on the windshield, focused at infinity like a real head-up display: they stay on the sky when the head
// moves, and the marks and rings are drawn on the sphere of directions, so they cover exactly the stars they speak of.
// Half the sky lies inside the inner ring. At rest it is a great circle; at the speed limit it is a tenth of a degree.

const HUD_RADIUS = 20 // m; only needs to be well outside the cabin, and inside the camera's far plane
const HUD_COLOUR = new THREE.Color(0.36, 1.25, 0.82)
const COURSE_RING_PX = 13
const LABEL_HEIGHT_PX = 14
const TEXT_WIDTH_PX = 512
const TEXT_HEIGHT_PX = 56
const TEXT_REFRESH_HZ = 8
const MARK_MERGE_PX = 26 // closer than this, the true and the apparent mark of the centre read as one
const RING_LABEL_MIN_PX = 34 // a ring smaller than this sits inside the course mark, and its label would only clutter it

const HUD_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  gl_Position.z = gl_Position.w * 0.9999;
}`

const HUD_FRAGMENT = /* glsl */ `
#define PI 3.14159265
varying vec3 vDir;
uniform float uHalfSky, uMostSky, uPixel, uCss, uLevel, uShowTrue, uShowSun, uShowEarth;
uniform vec3 uTrue, uSeen, uColour, uSun, uEarth;
const vec3 COURSE = vec3(0., 0., -1.);

float line(float distance, float halfWidth) {
  return 1. - smoothstep(halfWidth, halfWidth + 1.3 * uPixel, abs(distance));
}
float angleBetween(vec3 a, vec3 b) { return 2. * asin(min(.5 * length(a - b), 1.)); }
vec2 around(vec3 d, vec3 centre) {
  vec3 u = normalize(cross(centre, abs(centre.y) < .99 ? vec3(0., 1., 0.) : vec3(1., 0., 0.)));
  vec3 v = cross(u, centre);
  return vec2(dot(d - centre, u), dot(d - centre, v));
}
void main() {
  vec3 d = normalize(vDir);
  float theta = angleBetween(d, COURSE);
  float bearing = atan(d.y, d.x);
  float lit = 0.;

  // The course: a ring, four ticks and a dot, of constant size on the screen.
  float ring = ${COURSE_RING_PX.toFixed(1)} * uCss;
  lit = max(lit, line(theta - ring, .55 * uCss));
  lit = max(lit, line(theta, 1.1 * uCss));
  if (theta > ring && theta < ring + 8. * uCss) lit = max(lit, max(line(d.x, .55 * uCss), line(d.y, .55 * uCss)));

  // Half of the whole sky lies inside this ring, with a tick every 30° of bearing.
  lit = max(lit, .85 * line(theta - uHalfSky, .55 * uCss));
  float sector = (fract(bearing / (PI / 6.) + .5) - .5) * (PI / 6.);
  if (theta > uHalfSky && theta < uHalfSky + 7. * uCss) lit = max(lit, .85 * line(sector * sin(theta), .55 * uCss));

  // Nine tenths of it inside this one, dashed.
  float dash = step(.5, fract(bearing * 18. / PI));
  lit = max(lit, .6 * dash * line(theta - uMostSky, .5 * uCss));

  // The centre of the Galaxy where it appears, as a filled dot in a ring...
  float toSeen = angleBetween(d, uSeen);
  lit = max(lit, line(toSeen - 7. * uCss, .55 * uCss));
  lit = max(lit, line(toSeen, 2.2 * uCss));

  // ...and where it really is, as a hollow diamond, joined by the line along which aberration has moved it.
  if (uShowTrue > .5 && dot(d, uTrue) > 0.) {
    vec2 t = around(d, uTrue);
    lit = max(lit, .75 * line(abs(t.x) + abs(t.y) - 9. * uCss, .5 * uCss));
    float seenTheta = angleBetween(uSeen, COURSE), trueTheta = angleBetween(uTrue, COURSE);
    float off = sin(theta) * sin(bearing - atan(uTrue.y, uTrue.x));
    if (theta > seenTheta + 7. * uCss && theta < trueTheta - 9. * uCss && cos(bearing - atan(uTrue.y, uTrue.x)) > 0.) {
      lit = max(lit, .5 * step(.5, fract(theta / (12. * uCss))) * line(off, .4 * uCss));
    }
  }
  // Home: small rings on the Sun and the Earth, where they appear
  lit = max(lit, uShowSun * line(angleBetween(d, uSun) - 6. * uCss, .5 * uCss));
  lit = max(lit, uShowEarth * line(angleBetween(d, uEarth) - 6. * uCss, .5 * uCss));
  gl_FragColor = vec4(uColour * lit * uLevel, 1.);
}`

const STENCIL_TO_WINDSHIELD = {
  ...ADD_LIGHT_ONLY,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  stencilWrite: true,
  stencilRef: WINDSHIELD_STENCIL,
  stencilFunc: THREE.EqualStencilFunc,
} as const

const TEXT_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColour;
uniform float uLevel;
varying vec2 vUv;
void main() { gl_FragColor = vec4(uColour * texture2D(uMap, vUv).a * uLevel, 1.); }`

type Direction = readonly [number, number, number]

interface HudTextProps {
  readonly text: (s: SimState, seconds: number) => string
  /** The direction the text hangs from, or null to hide it. */
  readonly place: (s: SimState) => Direction | null
  readonly offset: readonly [number, number] // CSS pixels, from that direction to the text's left edge
  readonly level: THREE.IUniform<number>
  readonly widthPx?: number // of the texture; long lines need more
}

function HudText({ text, place, offset, level, widthPx = TEXT_WIDTH_PX }: HudTextProps) {
  const { camera, size } = useThree()
  const mesh = useRef<THREE.Mesh>(null!)
  const { context, texture } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = TEXT_HEIGHT_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas is unavailable, so the indicators cannot be drawn')
    return { context: ctx, texture: new THREE.CanvasTexture(canvas) }
  }, [widthPx])
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, uColour: { value: HUD_COLOUR }, uLevel: level },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: TEXT_FRAGMENT,
    ...STENCIL_TO_WINDSHIELD,
  }), [texture, level])
  useEffect(() => () => {
    texture.dispose()
    material.dispose()
  }, [texture, material])
  const lastText = useRef('')
  const lastPaint = useRef(-1)
  const [right, up, at] = useMemo(() => [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], [])

  useFrame(({ clock }) => {
    const s = sim.get()
    const direction = place(s)
    mesh.current.visible = direction !== null && level.value > 0
    if (!direction) return
    if (clock.elapsedTime - lastPaint.current > 1 / TEXT_REFRESH_HZ) {
      lastPaint.current = clock.elapsedTime
      const next = text(s, clock.elapsedTime)
      if (next !== lastText.current) {
        lastText.current = next
        context.clearRect(0, 0, widthPx, TEXT_HEIGHT_PX)
        context.font = `600 ${TEXT_HEIGHT_PX * 0.72}px "SF Mono", Menlo, Consolas, monospace`
        context.textBaseline = 'middle'
        context.fillStyle = '#fff'
        context.fillText(next, 0, TEXT_HEIGHT_PX / 2)
        texture.needsUpdate = true
      }
    }
    // Hung at a distance, so that it stays on the sky, and scaled to stay the same size on the screen when zoomed.
    const perspective = camera as THREE.PerspectiveCamera
    const metresPerCssPixel = (HUD_RADIUS * 2 * Math.tan((perspective.fov * Math.PI) / 360)) / size.height
    right.setFromMatrixColumn(camera.matrixWorld, 0)
    up.setFromMatrixColumn(camera.matrixWorld, 1)
    const height = LABEL_HEIGHT_PX * metresPerCssPixel
    const width = height * (widthPx / TEXT_HEIGHT_PX)
    at.set(...direction).multiplyScalar(HUD_RADIUS).add(camera.position)
      .addScaledVector(right, offset[0] * metresPerCssPixel + width / 2)
      .addScaledVector(up, offset[1] * metresPerCssPixel)
    mesh.current.position.copy(at)
    mesh.current.quaternion.copy(camera.quaternion)
    mesh.current.scale.set(width, height, 1)
  })
  return (
    <mesh ref={mesh} material={material} layers={BACKGROUND_LAYER} frustumCulled={false} renderOrder={5}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}

const COURSE: Direction = [0, 0, -1]
const onRing = (angle: number, bearing: number): Direction =>
  [Math.sin(angle) * Math.cos(bearing), Math.sin(angle) * Math.sin(bearing), -Math.cos(angle)]
const seenCentre = (s: SimState): Direction => apparentDirection(directionToCentre(s.course, s.ship.x), s.ship.phi)

const HALF_SKY = 0.5
const MOST_SKY = 0.9
const LABEL_BEARING = 0.75 // rad
const EARTH_MARK_LY = 0.002 // about 130 AU: beyond that the Earth is lost in the Sun's glare anyway
const WIDE_TEXT_PX = 1024

const CUES: Readonly<Record<Cue, string>> = {
  turning: 'РАЗВОРОТ НА ЦЕЛЬ',
  arrived: 'ПРИБЫТИЕ · ЦЕЛЬ (T) — СЛЕДУЮЩАЯ',
  ready: 'КУРС ЗАДАН · РЫЧАГ ВПЕРЁД',
  behind: 'ЦЕЛЬ ПОЗАДИ · ЦЕЛЬ (T) — РАЗВЕРНУТЬСЯ',
  cruise: '',
  brakeSoon: 'ГОТОВЬСЯ ТОРМОЗИТЬ',
  brake: 'ТОРМОЗИ — РЫЧАГ НАЗАД',
  passed: 'ПРОЛЁТ — ТОРМОЗИ',
}
const BLINKING: ReadonlySet<Cue> = new Set(['brake', 'passed'])

const targetLine = (s: SimState): string => {
  const nav = navigate(s.course, s.ship)
  return `${legend(nav.name)}  ${distanceText(nav.distance)}`
}
const brakingLine = (s: SimState): string => `ТОРМОЗНОЙ ПУТЬ ${distanceText(navigate(s.course, s.ship).braking)}`
const cueLine = (s: SimState, seconds: number): string => {
  const { cue } = navigate(s.course, s.ship)
  return BLINKING.has(cue) && Math.floor(seconds * 2.5) % 2 === 1 ? '' : CUES[cue]
}
/** For a while after a message comes in, where to look for it: the radio is low on the left. */
const NEW_MESSAGE_SECONDS = 8
const messageHint = (() => {
  let heard = -1
  let since = -Infinity
  return (s: SimState, seconds: number): string => {
    if (heard >= 0 && s.messagesHeard > heard) since = seconds
    heard = s.messagesHeard
    return seconds - since < NEW_MESSAGE_SECONDS ? '◄ СВЯЗЬ: СООБЩЕНИЕ С ЗЕМЛИ' : ''
  }
})()
// Neither is marked while it is the target: the target's own label names it
const EARTH_TARGET = indexOfTarget('Земля')
/** By a body, where the ship is going relative to it, or straight against that: the nose goes there to push or to brake. */
const motion = (sign: 1 | -1) => (s: SimState): Direction | null => {
  if (!s.local || s.local.centre === null) return null
  const v = s.local.v
  const speed = Math.hypot(v[0], v[1], v[2])
  return speed < 1 ? null : galacticToShip(s.course.attitude, [(sign * v[0]) / speed, (sign * v[1]) / speed, (sign * v[2]) / speed])
}
const isSunMarked = (s: SimState): boolean => s.course.target !== 0
const isEarthMarked = (s: SimState): boolean => s.course.target !== EARTH_TARGET && earthDistance(s.course, s.ship.x) < EARTH_MARK_LY * LY

export function Hud() {
  const { camera, size, viewport } = useThree()
  const gain = useWake(0.84, fedBy('nav')) // the marks on the glass come from the navigation computer
  const level = useMemo(() => ({ value: 0 }), [])
  const sphere = useRef<THREE.Mesh>(null!)
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uHalfSky: { value: Math.PI / 2 },
      uMostSky: { value: 2 },
      uPixel: { value: 0.001 },
      uCss: { value: 0.001 },
      uLevel: level,
      uShowTrue: { value: 0 },
      uTrue: { value: new THREE.Vector3(0, 0, -1) },
      uSeen: { value: new THREE.Vector3(0, 0, -1) },
      uShowSun: { value: 0 },
      uShowEarth: { value: 0 },
      uSun: { value: new THREE.Vector3(0, 0, 1) },
      uEarth: { value: new THREE.Vector3(0, 0, 1) },
      uColour: { value: HUD_COLOUR },
    },
    vertexShader: HUD_VERTEX,
    fragmentShader: HUD_FRAGMENT,
    side: THREE.BackSide,
    ...STENCIL_TO_WINDSHIELD,
  }), [level])
  useEffect(() => () => material.dispose(), [material])
  const isShowingTrue = useRef(false)
  const radiansPerCssPixel = useRef(0.001)
  const ringLabel = (fraction: number) => (s: SimState): Direction | null => {
    const angle = skyFractionAngle(fraction, s.ship.phi)
    return angle > RING_LABEL_MIN_PX * radiansPerCssPixel.current ? onRing(angle, LABEL_BEARING) : null
  }

  useFrame(() => {
    const s = sim.get()
    level.value = s.hudOn ? gain.value : 0
    sphere.current.visible = level.value > 0
    sphere.current.position.copy(camera.position)
    const uniforms = material.uniforms
    const pixelsHigh = size.height * viewport.dpr
    const radiansPerPixel = (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360)) / pixelsHigh
    uniforms.uPixel.value = radiansPerPixel
    uniforms.uCss.value = radiansPerPixel * viewport.dpr
    radiansPerCssPixel.current = radiansPerPixel * viewport.dpr
    uniforms.uHalfSky.value = skyFractionAngle(HALF_SKY, s.ship.phi)
    uniforms.uMostSky.value = skyFractionAngle(MOST_SKY, s.ship.phi)
    const real = directionToCentre(s.course, s.ship.x)
    const seen = apparentDirection(real, s.ship.phi)
    uniforms.uTrue.value.set(...real)
    uniforms.uSeen.value.set(...seen)
    const gap = Math.hypot(real[0] - seen[0], real[1] - seen[1], real[2] - seen[2])
    isShowingTrue.current = gap > MARK_MERGE_PX * radiansPerPixel * viewport.dpr
    uniforms.uShowTrue.value = isShowingTrue.current ? 1 : 0
    uniforms.uShowSun.value = isSunMarked(s) ? 1 : 0
    uniforms.uShowEarth.value = isEarthMarked(s) ? 1 : 0
    uniforms.uSun.value.set(...starSources(s.course, s.ship)[0].direction)
    uniforms.uEarth.value.set(...earthSource(s.course, s.ship).direction)
  })

  return (
    <>
      <mesh ref={sphere} material={material} layers={BACKGROUND_LAYER} frustumCulled={false} renderOrder={4}>
        <sphereGeometry args={[HUD_RADIUS, 48, 32]} />
      </mesh>
      <HudText
        level={level}
        place={() => COURSE}
        offset={[26, -30]}
        text={(s) => `γ ${auto(gammaOf(s.ship.phi), 3)}  ${(properAcceleration(s) / G0).toFixed(2)} g`}
      />
      {/* The target is dead ahead once the ship has turned onto it: it flies straight at it */}
      <HudText level={level} place={(s) => targetDirection(s.course, s.ship)} offset={[26, 30]} text={targetLine} widthPx={WIDE_TEXT_PX} />
      <HudText
        level={level}
        place={(s) => (s.ship.phi > 0 ? COURSE : null)}
        offset={[26, 48]}
        text={brakingLine}
        widthPx={WIDE_TEXT_PX}
      />
      <HudText level={level} place={() => COURSE} offset={[-110, -54]} text={cueLine} widthPx={WIDE_TEXT_PX} />
      <HudText level={level} place={() => COURSE} offset={[-110, -72]} text={messageHint} widthPx={WIDE_TEXT_PX} />
      <HudText
        level={level}
        place={(s) => (isSunMarked(s) ? starSources(s.course, s.ship)[0].direction : null)}
        offset={[10, 10]}
        text={() => 'СОЛНЦЕ'}
      />
      <HudText
        level={level}
        place={(s) => (isEarthMarked(s) ? earthSource(s.course, s.ship).direction : null)}
        offset={[10, 10]}
        text={() => 'ЗЕМЛЯ'}
      />
      <HudText level={level} place={motion(1)} offset={[-5, 5]} text={() => '+ ПО ХОДУ'} />
      <HudText level={level} place={motion(-1)} offset={[-5, 5]} text={() => '× ПРОТИВ ХОДА'} />
      <HudText level={level} place={ringLabel(HALF_SKY)} offset={[8, 6]} text={() => '½ НЕБА'} />
      <HudText level={level} place={ringLabel(MOST_SKY)} offset={[8, 6]} text={() => '90 % НЕБА'} />
      <HudText level={level} place={seenCentre} offset={[12, 12]} text={() => 'ЦЕНТР ГАЛАКТИКИ'} />
      <HudText
        level={level}
        place={(s) => (isShowingTrue.current ? directionToCentre(s.course, s.ship.x) : null)}
        offset={[14, 12]}
        text={() => 'ИСТИННОЕ НАПРАВЛЕНИЕ'}
      />
    </>
  )
}
