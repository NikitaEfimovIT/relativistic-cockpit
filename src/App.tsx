import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FAULT_NAMES, activeFaults } from './failures'
import { Cockpit, type CabinLight } from './Cockpit'
import { grab } from './Controls'
import { eyeOf, seatYaw, stepBody } from './aboard'
import { RESTING_PITCH, capture, currentAim, lookAt, pressAboardKey, releaseAllWalkKeys, releaseWalkKey, walkKeys, type LookRef } from './onFoot'
import { body, type Body } from './walk'
import { acknowledge, annunciatorCells, masterAlarm, settleAcknowledged } from './annunciator'
import { playClick, startAudio, updateAudio } from './audio'
import type { Sound } from './clicks'
import { commLink } from './comms'
import { CLOCK_HOLD_TEXT, TIMER_TEXT, durationText, speedPercent } from './format'
import { starlightExcess } from './galaxy'
import { BETA_MAX, G0, LY, T_CMB, forwardIlluminance, oneMinusBeta, rearCameraGain } from './physics'
import { courseOpenness, filterTransmission } from './cabinLogic'
import {
  clockHold, clockSetting, confirmTarget, currentWarp, faceCo2, initialSim, isEngineLive, isLetterRead, moveTargetCursor, nudgeThrottle, properAcceleration, setThrottle, sim,
  stepSim, toggleArm, toggleBus, toggleCabinLights, toggleEngine, toggleFans, toggleFilter, toggleHud, toggleInstrumentsDim, toggleScrubber, toggleShield,
  toggleShutters, totalLoadW, turnClock, type Breakers, type SimState,
  crewOf, cutOff, eventTimer, isChemBurning, nudgeChemThrottle, setStick, toggleChemEngine, toggleCrossfeed, toggleFeed, toggleLightMode, toggleManualAttitude,
  togglePressurisation, wreckText,
} from './sim'
import { PROPELLANT, RCS_PROPELLANT, deltaV } from './chemical'
import { LANGS, LANG_NAMES, currentLang, legendIn, setLang, useLang, type Lang } from './labels'
import { orbitOf } from './flight'
import type { Vec3 } from './galaxy'
import { BACKGROUND_LAYER, createFrame } from './frame'
import { createHdrTarget } from './glare'
import { NIGHT_EXPOSURE, STAR_SIGMA, adaptedExposure, blackbodyTint, cabinLightsLux, createSky, meteredIlluminance, meteredSource } from './sky'
import { ALL_GLOBES } from './exoplanets'
import { DAY } from './solarSystem'
import { COCKPIT_DOOR_Z } from './cockpitLayout'
import { INITIAL_DESK, desk, deskPointer, wheelDesk, type DeskUi } from './deskUi'
import { BATTERY_WH, celsius, ppO2Kpa, pressureKpa } from './habitat'
import { MAP_SCALES } from './galaxyMap'
import { TARGETS, brakingDistance, diskSource, eclipsed, globeSource, holeNear, shipPosition, starSources, type Source } from './voyage'
import { clockRate } from './blackHoles'

const DEG = Math.PI / 180
const REFERENCE_HALF_FOV = 35 * DEG
const REAR_WIDTH = 720
const REAR_HEIGHT = 432
const REAR_FOV = 100
const REAR_BASE_GAIN = 3
const ON_FOOT_PITCH_LIMIT = 1.4 // rad; standing, the head tips from the feet to nearly overhead
const LIGHT_ADAPTATION_TIME = 0.3 // s; eyes stop down to a bright scene quickly
const DARK_ADAPTATION_TIME = 1.5 // s; and recover slowly (compressed from minutes, like the rest of the clock)
const MAX_FRAME = 0.1 // s; a stalled tab must not turn into a month-long lurch
const MAX_ZOOM = 1000
const THROTTLE_KEY_STEP = 0.05
const MAX_JUMP_LY = 300_000
// rad; about as far as a neck turns, 77°. Further, the eye, 10 cm ahead of the neck, would swing into the couch's head
// wings; the field of view still reaches well behind the shoulder.
const YAW_LIMIT = 1.35
const EYE_FROM_NECK = new THREE.Vector3(0, 0.12, -0.1) // m; the head turns about the neck, so the cabin slides against the stars

const hasMotion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Keep at least 100° horizontally, so the side controls stay in view in narrow windows. */
const baseHalfFov = (aspect: number): number => Math.max(REFERENCE_HALF_FOV, Math.atan(Math.tan(50 * DEG) / aspect))

function readJumpFromUrl(): number {
  const beta = Number(new URLSearchParams(window.location.search).get('beta'))
  return Number.isFinite(beta) && beta > 0 && beta <= BETA_MAX ? Math.atanh(beta) : 0
}

/** ?x= places the ship that many light years along its course, to see the Galaxy from elsewhere. */
function readPlaceFromUrl(): number {
  const lightYears = Number(new URLSearchParams(window.location.search).get('x'))
  return Number.isFinite(lightYears) && lightYears > 0 && lightYears <= MAX_JUMP_LY ? lightYears * LY : 0
}

/**
 * The random faults are off for now (the pilot's choice, 2026-11-11): failures.ts and the procedures stay, to come back
 * later. ?seed= still fixes a flight's faults, for a test or to replay one; ?faults=on draws a flight's own at random.
 */
function readSeedFromUrl(): number | null {
  const params = new URLSearchParams(window.location.search)
  const seed = params.get('seed')
  const value = Number(seed)
  if (seed !== null && Number.isInteger(value)) return value >>> 0
  return params.get('faults') === 'on' ? Math.floor(Math.random() * 2 ** 32) : null
}

function useHeadLook(onZoom: (zoom: number) => void) {
  const { gl } = useThree()
  const look = useRef({ yaw: 0, pitch: 0, zoom: 1 })
  useEffect(() => {
    const element = gl.domElement
    let isLooking = false
    const onPress = (e: PointerEvent) => {
      isLooking = e.button === 0
      if (isLooking && body.get().seat === null && document.pointerLockElement !== element) capture(element)
    }
    const onMove = (e: PointerEvent) => {
      if (e.buttons === 0) isLooking = false // the release was lost to a context menu or a window switch
      const isCaptured = document.pointerLockElement === element // on foot the mouse turns the head with no button held
      if (!isCaptured && (!isLooking || grab.active)) return
      const scale = 0.0025 / look.current.zoom
      const yaw = look.current.yaw - e.movementX * scale
      const pitch = look.current.pitch - e.movementY * scale
      const isSeated = body.get().seat !== null // a seat holds the shoulders; standing, the whole body turns
      look.current = {
        ...look.current,
        yaw: isSeated ? THREE.MathUtils.clamp(yaw, -YAW_LIMIT, YAW_LIMIT) : yaw,
        pitch: isSeated ? THREE.MathUtils.clamp(pitch, -0.7, 0.7) : THREE.MathUtils.clamp(pitch, -ON_FOOT_PITCH_LIMIT, ON_FOOT_PITCH_LIMIT),
      }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (body.get().seat === 'desk' && deskPointer.screen !== null) { // over a desk screen the wheel scrolls it, not the view
        wheelDesk(e.deltaY)
        return
      }
      const zoom = THREE.MathUtils.clamp(look.current.zoom * Math.exp(-e.deltaY * 0.0015), 1, MAX_ZOOM)
      look.current = { ...look.current, zoom }
      onZoom(zoom)
    }
    const onRelease = () => {
      isLooking = false
      grab.active = false
    }
    element.addEventListener('pointerdown', onPress)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onRelease)
    window.addEventListener('pointercancel', onRelease)
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('pointerdown', onPress)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onRelease)
      window.removeEventListener('pointercancel', onRelease)
      element.removeEventListener('wheel', onWheel)
    }
  }, [gl, onZoom])
  return look
}

/**
 * The attitude keys, held, and what each commands about the ship's axes: pitch up, yaw left, roll left. W pushes the
 * nose down as a stick pushed forward does; the number pad's 8 2 4 6 7 9 do the same as W S A D Q E.
 */
const STICK_KEYS: Readonly<Record<string, Vec3>> = {
  KeyW: [-1, 0, 0], KeyS: [1, 0, 0], KeyA: [0, 1, 0], KeyD: [0, -1, 0], KeyQ: [0, 0, 1], KeyE: [0, 0, -1],
  Numpad8: [-1, 0, 0], Numpad2: [1, 0, 0], Numpad4: [0, 1, 0], Numpad6: [0, -1, 0], Numpad7: [0, 0, 1], Numpad9: [0, 0, -1],
}
/** The command of the keys held now, each axis clamped to −1..1. */
const stickOf = (held: ReadonlySet<string>): Vec3 => {
  const sum = [...held].reduce<Vec3>((a, code) => {
    const k = STICK_KEYS[code]
    return [a[0] + k[0], a[1] + k[1], a[2] + k[2]]
  }, [0, 0, 0])
  return [Math.sign(sum[0]), Math.sign(sum[1]), Math.sign(sum[2])]
}

const KEY: readonly [Sound, Sound] = ['keyDown', 'keyUp'] // a key beside a screen, going down and coming up
const BUTTON: readonly [Sound, Sound] = ['buttonDown', 'buttonUp'] // a push button

function useKeyboard(look: LookRef, canvas: HTMLElement) {
  useEffect(() => {
    const held = new Map<string, Sound>() // keys down now that stand for a key or a button, and how each sounds coming up
    const stick = new Set<string>() // attitude keys down now
    const steer = (): void => sim.update((s) => setStick(s, stickOf(stick)))
    const travel = (code: string, [down, up]: readonly [Sound, Sound]): void => {
      playClick(down)
      held.set(code, up)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      releaseWalkKey(e.code)
      if (stick.delete(e.code)) steer()
      const up = held.get(e.code)
      if (up === undefined) return
      held.delete(e.code)
      playClick(up)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return // browser shortcuts such as Cmd+S are not cockpit input
      startAudio()
      if (pressAboardKey(e, look, canvas)) return // out of the pilot couch the cockpit's keys are out of reach
      if (e.code === 'ArrowUp') { e.preventDefault(); sim.update((s) => nudgeThrottle(s, THROTTLE_KEY_STEP)) }
      // Shift+↓ throws the lever to full braking at once: stepping there takes forty notches, too long when the brake call sounds
      if (e.code === 'ArrowDown') { e.preventDefault(); sim.update((s) => (e.shiftKey ? setThrottle(s, -1) : nudgeThrottle(s, -THROTTLE_KEY_STEP))) }
      if (e.code === 'BracketRight') { sim.update((s) => nudgeChemThrottle(s, 1)); playClick('detent') } // the chemical engine's lever
      if (e.code === 'BracketLeft') { sim.update((s) => nudgeChemThrottle(s, -1)); playClick('detent') }
      if (e.repeat) return // holding a key moves the lever but must not flip a switch back and forth
      if (e.code in STICK_KEYS) { stick.add(e.code); steer(); return }
      if (e.code === 'KeyP') { sim.update(toggleBus); playClick('switch') }
      if (e.code === 'KeyU') { sim.update(toggleArm); playClick('switch') }
      if (e.code === 'KeyI') { sim.update(toggleEngine); playClick('guardedSwitch') }
      if (e.code === 'KeyG') { sim.update(toggleLightMode); playClick('guardedSwitch') }
      if (e.code === 'KeyK') { sim.update(toggleManualAttitude); playClick('switch') }
      if (e.code === 'Digit1') { sim.update(togglePressurisation); playClick('switch') }
      if (e.code === 'Digit2') { sim.update(toggleFeed); playClick('switch') }
      if (e.code === 'Digit3') { sim.update(toggleCrossfeed); playClick('switch') }
      if (e.code === 'Digit4') { sim.update(toggleChemEngine); playClick('guardedSwitch') }
      if (e.code === 'Digit0') { sim.update(cutOff); travel(e.code, BUTTON) } // АВАРИЙНАЯ ОТСЕЧКА
      if (e.code === 'KeyM') { sim.update(acknowledge); travel(e.code, BUTTON) }
      if (e.code === 'KeyV') { sim.update(toggleFans); playClick('switch') }
      if (e.code === 'KeyC') { sim.update(toggleScrubber); playClick('switch') }
      if (e.code === 'KeyO') { sim.update(toggleShield); playClick('guardedSwitch') }
      if (e.code === 'KeyX') { sim.update((s) => setThrottle(s, 0)); playClick('detent') }
      if (e.code === 'KeyL') { sim.update(toggleCabinLights); playClick('switch') }
      if (e.code === 'KeyH') { sim.update(toggleHud); playClick('switch') }
      if (e.code === 'KeyB') { sim.update(toggleShutters); playClick('switch') }
      if (e.code === 'KeyF') { sim.update(toggleFilter); playClick('switch') }
      if (e.code === 'KeyN') { sim.update(toggleInstrumentsDim); playClick('switch') }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') { sim.update((s) => turnClock(s, 1)); travel(e.code, KEY) } // the clock, faster
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') { sim.update((s) => turnClock(s, -1)); travel(e.code, KEY) }
      if (e.code === 'KeyT') { sim.update((s) => moveTargetCursor(s, e.shiftKey ? -1 : 1)); travel(e.code, KEY) } // ▼, or ▲ with Shift
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { sim.update(confirmTarget); travel(e.code, KEY) } // ВЫБРАТЬ
      if (e.code === 'KeyR') {
        sim.update(() => initialSim(0, 0, readSeedFromUrl()))
        desk.update(() => INITIAL_DESK)
      }
    }
    const onBlur = () => { // a key let go while the window was away never sends its keyup
      held.clear()
      stick.clear()
      steer()
      releaseAllWalkKeys()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pointerdown', startAudio)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', startAudio)
    }
  }, [look, canvas])
}

const UP = new THREE.Vector3(0, 1, 0)

interface StageProps {
  readonly onZoom: (zoom: number) => void
  /** What E would do to the thing in the reticle, if anything, and whether there is a reticle at all. */
  readonly onAim: (prompt: string | null, isOnFoot: boolean) => void
}

function Stage({ onZoom, onAim }: StageProps) {
  const { gl, size, viewport, scene, camera: mainCamera } = useThree()
  const sky = useMemo(createSky, [])
  const frame = useMemo(() => createFrame(scene, mainCamera as THREE.PerspectiveCamera), [scene, mainCamera])
  const rearTarget = useMemo(() => createHdrTarget(REAR_WIDTH, REAR_HEIGHT), [])
  const rearCamera = useMemo(() => {
    const camera = new THREE.PerspectiveCamera(REAR_FOV, REAR_WIDTH / REAR_HEIGHT, 0.01, 10)
    camera.rotation.y = Math.PI
    camera.updateMatrixWorld()
    return camera
  }, [])
  const logExposure = useRef(Math.log(NIGHT_EXPOSURE))
  const light = useRef<CabinLight>({
    exposure: NIGHT_EXPOSURE, illuminance: 0, tint: new THREE.Vector3(1, 1, 1), direction: new THREE.Vector3(0, 0, -1),
  })
  const viewDirection = useMemo(() => new THREE.Vector3(), [])
  const eye = useMemo(() => new THREE.Vector3(), [])
  const headTurn = useMemo(() => new THREE.Euler(), [])
  const look = useHeadLook(onZoom)
  useKeyboard(look, gl.domElement)

  useEffect(() => {
    frame.setSize(Math.round(size.width * viewport.dpr), Math.round(size.height * viewport.dpr))
  }, [frame, size, viewport.dpr])

  useEffect(() => () => {
    sky.dispose()
    frame.dispose()
    rearTarget.dispose()
  }, [sky, frame, rearTarget])

  useFrame((state, delta) => {
    const dt = Math.min(delta, MAX_FRAME)
    sim.update((s) => settleAcknowledged(stepSim(s, dt)))
    const s = sim.get()
    updateAudio(s)
    body.update((b) => stepBody(b, walkKeys(), look.current.yaw, dt))
    const aboard = body.get()
    const isSeated = aboard.seat !== null
    if (state.events.enabled !== isSeated) state.setEvents({ enabled: isSeated }) // on foot a click takes the mouse, it presses nothing
    if (state.events.filter !== forThisSeat) state.setEvents({ filter: forThisSeat })

    const camera = state.camera as THREE.PerspectiveCamera
    const halfFov = Math.atan(Math.tan(baseHalfFov(camera.aspect)) / look.current.zoom)
    camera.fov = (2 * halfFov) / DEG
    camera.updateProjectionMatrix()
    // The resting tilt fades with zoom, so zooming in lands on the course and not below it.
    camera.rotation.set(look.current.pitch + (isSeated ? RESTING_PITCH / look.current.zoom : 0), seatYaw(aboard) + look.current.yaw, 0, 'YXZ')

    const openness = courseOpenness(s.shutters) // closed shutters stop the disc, its glare and its light on the cabin
    const illuminance = forwardIlluminance(s.ship.phi) * openness
    const look3 = camera.getWorldDirection(viewDirection)
    onAim(lookAt([look3.x, look3.y, look3.z]), !isSeated)
    const offCourse = Math.acos(-look3.z)
    // The tinted glass cuts what comes in through it. The eye meters the light as clear glass would let it in: getting
    // used to a view a thousand times darker takes it minutes (the pupil gives back a factor of ten or so in seconds,
    // left out so that the view does not drift), so while the tint is on its share simply stays away.
    const transmission = filterTransmission(s.filter)
    const globesOutside = ALL_GLOBES.map((globe) => globeSource(s.course, s.ship, globe))
    const disk = diskSource(s.course, s.ship)
    const outside: readonly Source[] = [...eclipsed(starSources(s.course, s.ship), globesOutside), ...globesOutside, ...(disk ? [disk] : [])]
    const offAxis = ({ direction: [x, y, z] }: Source): number => Math.acos(Math.max(-1, Math.min(1, x * look3.x + y * look3.y + z * look3.z)))
    const zoom = look.current.zoom
    const fromOutside = outside.reduce((sum, source) => sum + meteredSource(source.illuminance, offAxis(source), halfFov, source.radius, zoom), 0)
    // The shutters close the canopy only: aft of the partition the portholes, which have none, still let the bodies in.
    // ponytail: the cut is the eye's place, not what is in view; a body seen from the cockpit through the doorway is missed.
    const outsideOpenness = eyeOf(aboard)[2] > COCKPIT_DOOR_Z ? 1 : openness
    const meteredLux = meteredIlluminance(illuminance, starlightExcess(s.ship.phi) * openness, offCourse, halfFov, zoom) + fromOutside * outsideOpenness
    const target = Math.log(adaptedExposure(meteredLux + s.lights * cabinLightsLux(look.current.zoom), look.current.zoom))
    const adaptation = target < logExposure.current ? LIGHT_ADAPTATION_TIME : DARK_ADAPTATION_TIME
    logExposure.current += (target - logExposure.current) * (1 - Math.exp(-dt / adaptation))
    const exposure = Math.exp(logExposure.current) * transmission
    // One source casts the shadows: whichever lights the cabin most, the CMB ahead or the brightest body outside.
    const brightest = outside.reduce((best, source) => (source.illuminance > best.illuminance ? source : best))
    const isCmb = forwardIlluminance(s.ship.phi) >= brightest.illuminance
    light.current = isCmb
      ? { exposure, illuminance, tint: blackbodyTint(T_CMB * Math.exp(s.ship.phi)), direction: new THREE.Vector3(0, 0, -1) }
      : { exposure, illuminance: brightest.illuminance * openness, tint: blackbodyTint(brightest.temperature), direction: new THREE.Vector3(...brightest.direction) }

    const thrust = properAcceleration(s) / G0
    const shake = hasMotion ? 0.0007 * Math.abs(thrust) : 0
    headTurn.set(look.current.pitch, look.current.yaw, 0, 'YXZ')
    // Seated, the head turns about the neck; on foot the whole body turns under it (ponytail: no neck there, add it if the view feels stiff).
    if (isSeated) eye.copy(EYE_FROM_NECK).applyEuler(headTurn).sub(EYE_FROM_NECK).divideScalar(look.current.zoom).applyAxisAngle(UP, seatYaw(aboard))
    else eye.set(0, 0, 0)
    const [x, y, z] = eyeOf(aboard)
    camera.position.set(x + eye.x + (Math.random() - 0.5) * shake, y + eye.y + (Math.random() - 0.5) * shake, z + eye.z + 0.014 * thrust)
    camera.updateMatrixWorld()

    const phi = s.ship.phi
    const place = { phi, position: shipPosition(s.course, s.ship.x), attitude: s.course.attitude, days: s.ship.t / DAY }
    sky.update(gl, place.position, phi, dt)
    const rearView = { ...place, exposure: NIGHT_EXPOSURE * REAR_BASE_GAIN * rearCameraGain(phi), veilLux: 0, eyeZoom: 1, sigmaPx: 1.1, isEye: false }
    sky.renderStars(gl, rearCamera, rearTarget, rearView)
    sky.addCmb(gl, rearCamera, rearTarget, rearView)
    frame.render(gl, sky, {
      ...place, exposure, veilLux: illuminance, eyeZoom: look.current.zoom, sigmaPx: STAR_SIGMA, isEye: true,
    }, dt)
  }, 1)

  return (
    <>
      <mesh material={frame.background} frustumCulled={false} renderOrder={-1} layers={BACKGROUND_LAYER}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <Cockpit rearImage={rearTarget.texture} light={light} />
    </>
  )
}

function supportsHdrWebGL(): boolean {
  const context = document.createElement('canvas').getContext('webgl2')
  return !!context && !!(context.getExtension('EXT_color_buffer_float') || context.getExtension('EXT_color_buffer_half_float'))
}

const IS_SUPPORTED = supportsHdrWebGL()
/** A jump to speed lands where 1 g from the Earth would have reached that speed, unless ?x= says otherwise. */
const startPhi = readJumpFromUrl()
sim.update(() => initialSim(startPhi, readPlaceFromUrl() || brakingDistance(startPhi), readSeedFromUrl()))

const STATUS_INTERVAL_MS = 500

/** Which seat's controls a hit belongs to: the desk's screens say so; everything else is the pilot's. */
const seatOf = (object: THREE.Object3D | null): string =>
  object === null ? 'pilot' : ((object.userData.seat as string | undefined) ?? seatOf(object.parent))
/** R3F does not let walls stop a click, so a click reaches only the controls of the seat the eye is in. */
const forThisSeat = (hits: THREE.Intersection[]): THREE.Intersection[] => hits.filter((hit) => seatOf(hit.object) === body.get().seat)

const CREW_TEXT = { норма: 'экипаж в норме', гипоксия: 'экипаж: гипоксия', переохлаждение: 'экипаж: переохлаждение', погиб: 'экипаж погиб' } as const
const on = (isOn: boolean): string => (isOn ? 'вкл' : 'выкл')
function habitatText(s: SimState): string {
  const h = s.habitat
  return [
    `реактор ${on(h.reactorOn)}`, `АКБ ${Math.round((h.batteryWh / BATTERY_WH) * 100)} %`,
    `нагрузка ${Math.round(totalLoadW(s))} Вт`, ...(s.busTripped ? ['шина сработала'] : []),
    `температура ${celsius(h).toFixed(1)} °C`, `уставка ${h.setpoint} °C`, `обогрев 1 ${on(h.heater1On)}`, `обогрев 2 ${on(h.heater2On)}`,
    `давление ${pressureKpa(h).toFixed(1)} кПа`, `кислород ${ppO2Kpa(h).toFixed(1)} кПа`, `генератор кислорода ${on(h.o2GenOn)}`,
    `клапан сброса ${h.ventOpen ? 'открыт' : 'закрыт'}`, `изоляция ${on(h.ventIsolated)}`, `наддув ${on(h.repressOn)}`,
    `отказы: ${activeFaults(h).map((f) => FAULT_NAMES[f]).join('; ') || 'нет'}`,
  ].join(', ')
}

const deskText = (ui: DeskUi): string =>
  `${ui.tab === 'manual' ? `руководство, страница ${ui.page + 1}` : ui.tab === 'journal' ? 'журнал' : 'системы'}, карта до края ${MAP_SCALES[ui.mapScale]} св. лет, на карте ${ui.picked === null ? 'ничего' : TARGETS[ui.picked].name}`

const BREAKER_NAMES: Readonly<Record<keyof Breakers, string>> = { nav: 'навигация', comms: 'связь', dosimeter: 'дозиметр', camera: 'камера' }
const MASTER_ALARM_TEXT = { warning: 'предупреждение', caution: 'внимание' } as const

/** The instruments are canvas textures, so this is what screen readers (and the E2E tests) can read. */
const km = (m: number): string => (Number.isFinite(m) ? `${Math.round(m / 1e3)} км` : 'уход')
const percent = (part: number, whole: number): string => `${Math.round((100 * part) / whole)} %`

/**
 * Flight by a body and the chemical engine, for the tests. Its words keep clear of the fields before it, which the tests
 * find by substring: no «двигатель», «тяга», «не работает» or «Скорость» here.
 */
function flightText(s: SimState): string {
  const p = s.propulsion
  const orbit = s.local ? orbitOf(s.local) : null
  const hole = holeNear(shipPosition(s.course, s.ship.x))
  const place = orbit
    ? `тело ${orbit.globe.name}, высота ${km(orbit.altitude)}, отн. тела ${Math.round(orbit.speed)} м/с, `
      + `апоцентр ${km(orbit.elements.apoapsis - orbit.globe.radiusM)}, перицентр ${km(orbit.elements.periapsis - orbit.globe.radiusM)}`
    : hole
      ? `дыра ${hole.hole.name}, ${(hole.r / hole.rs).toFixed(1)} r_s, ход часов ${clockRate(hole.rs, hole.r).toFixed(3)}`
      : 'тело нет'
  return [
    `режим ${s.local ? 'у тела' : 'световой'}`,
    place,
    `досвет ${isChemBurning(s) ? 'горит' : 'погашен'} ${Math.round(p.throttle * 100)} %`,
    `наддув ${p.pressurised ? 'вкл' : 'выкл'}, подача ${p.feedOpen ? 'откр' : 'закр'}, перекрёстная ${p.crossfeedOpen ? 'откр' : 'закр'}`,
    `топливо ${percent(p.propellant, PROPELLANT)}, маневровые ${percent(p.rcsPropellant, RCS_PROPELLANT)}, запас ${Math.round(deltaV(p))} м/с`,
    `ориентация ${s.manualAttitude ? 'ручн' : 'авто'}`,
    `световой режим ${s.lightModeOn ? 'вкл' : 'выкл'}`,
    `таймер ${(() => { const t = eventTimer(s); return t ? `${TIMER_TEXT[t.event]} ${durationText(t.seconds)}` : 'нет' })()}`,
    ...(s.wrecked ? ['корабль разрушен'] : []),
  ].join(', ')
}

const placeText = (b: Body): string =>
  b.seat === 'pilot' ? 'в кресле пилота' : b.seat === 'desk' ? 'за инженерным столом' : `на ногах (x ${b.at.x.toFixed(2)} z ${b.at.z.toFixed(2)})`

const openDrawers = (b: Body): string =>
  Object.entries(b.drawers).filter(([, drawer]) => drawer.isOpen).map(([id]) => id).join(' ') || 'нет'

function FlightStatus() {
  const [status, setStatus] = useState('')
  const [wreck, setWreck] = useState<string | null>(null)
  useEffect(() => {
    const id = setInterval(() => {
      const s = sim.get()
      const aboard = body.get()
      const link = commLink(s.course, s.ship)
      setWreck(s.wrecked ? wreckText(s) : null)
      setStatus([
        `место: ${placeText(aboard)}`,
        `взгляд на: ${currentAim()?.id ?? 'ничего'}`,
        `выдвинуты ящики: ${openDrawers(aboard)}`,
        `Скорость ${speedPercent(oneMinusBeta(s.ship.phi))} % c`,
        `шина ${s.busOn ? 'включена' : 'выключена'}`,
        `двигатель ${s.armed ? 'взведён' : 'не взведён'}`,
        `двигатель ${s.engineOn ? 'включён' : 'выключен'}${s.engineOn && !isEngineLive(s) ? ', не работает' : ''}`,
        `автоматы: ${(Object.keys(BREAKER_NAMES) as Array<keyof Breakers>).map((b) => `${BREAKER_NAMES[b]} ${s.breakers[b] ? 'вкл' : 'выкл'}`).join(', ')}`,
        `вентиляция ${s.fansOn ? 'включена' : 'выключена'}`,
        `поглотитель ${s.scrubberOn ? 'включён' : 'выключен'}`,
        `CO₂ ${faceCo2(s).toFixed(1)} мм рт. ст.`,
        `табло: ${annunciatorCells(s).filter(({ tone }) => tone !== 'off').map(({ label }) => label).join(', ') || 'пусто'}`,
        `главная авария ${(() => { const call = masterAlarm(s); return call ? MASTER_ALARM_TEXT[call] : 'не горит' })()}`,
        `щит ${s.shieldOn ? 'включён' : 'выключен'}`,
        `свет в кабине ${s.cabinLightsOn ? 'включён' : 'выключен'}`,
        `питание ${s.power >= 1 ? 'подано' : s.power > 0 ? 'подаётся' : 'нет'}`,
        `индикаторы ${s.hudOn ? 'включены' : 'выключены'}`,
        `шторки ${s.shutters >= 1 ? 'закрыты' : s.shutters <= 0 ? 'открыты' : 'движутся'}`,
        `тонировка ${s.filterOn ? 'включена' : 'выключена'}`,
        `приборы ${s.instrumentsDimmed ? 'приглушены' : 'на полной яркости'}`,
        `тяга ${s.throttle.toFixed(2)}`,
        `цель ${TARGETS[s.course.target].name}${s.course.turn ? ', разворот' : ''}${s.targetCursor !== s.course.target ? `, на экране ${TARGETS[s.targetCursor].name}` : ''}`,
        `ускорение времени ×${Math.round(currentWarp(s))}, часы на ×${clockSetting(s)}${(() => { const hold = clockHold(s); return hold ? `, снижены: ${CLOCK_HOLD_TEXT[hold]}` : '' })()}`,
        `связь с Землёй ${link.isUp ? 'есть' : 'потеряна'}, задержка ${durationText(link.delay)}, принято сообщений ${s.messagesHeard}`,
        `прочитано писем ${Array.from({ length: s.messagesHeard }, (_, i) => i).filter((i) => isLetterRead(s, i)).length}`,
        `стол: ${deskText(desk.get())}`,
        habitatText(s),
        CREW_TEXT[crewOf(s)],
        flightText(s),
      ].join(', '))
    }, STATUS_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
  // A lost ship is still and silent: the window says what it was lost to, since no instrument aboard can.
  // ponytail: in Russian whatever the language of the legends, as the log's lines are.
  return (
    <>
      {wreck && <div role="alert" className="wreck">{wreck} · R — заново</div>}
      <div role="status" className="sr-only">{status}</div>
    </>
  )
}

/** The keys along the bottom of the window, in the language of the legends. */
const HINTS: Readonly<Record<Lang, readonly string[]>> = {
  ru: [
    'Под центральным экраном: ШИНА (P) → световой режим (G) → ВЗВЕДЕНИЕ (U) → пуск под крышкой (I), щит под крышкой (O), АВАРИЯ (M) · под правым: цель ▲▼ (Shift+T, T), ВЫБРАТЬ (Enter) · справа на консоли: салазки тяги (↑↓, полный тормоз Shift+↓, X)',
    '· химический двигатель: 1 2 3 4, ручка [ ] или перетаскивание, отсечка 0 · АВТО / РУЧН (K), повороты W A S D, крен Q E',
    '· левая стенка: свет (L), вентиляция (V), поглотитель CO₂ (C) · правая: H, B, F, N, автоматы · часы: + и − справа от экрана времени (=, −) · осмотр — перетаскивание, зум — колесо · R — заново',
    '· Пробел — встать с кресла; на ногах: щелчок берёт мышь (Esc отпускает), WASD — ходьба, E — сесть или взять то, что в прицеле',
  ],
  en: [
    'Under the centre screen: MAIN BUS (P) → LIGHT MODE (G) → ARM (U) → guarded start (I), guarded SHIELD (O), MASTER ALARM (M) · under the right screen: target ▲▼ (Shift+T, T), SELECT (Enter) · right desk: thrust sled (↑↓, full braking Shift+↓, X)',
    '· chemical engine: 1 2 3 4, lever [ ] or drag, CUTOFF 0 · attitude AUTO / MAN (K), turn W A S D, roll Q E',
    '· left wall: lights (L), fans (V), CO₂ scrubber (C) · right wall: H, B, F, N, breakers · clock: + and − right of the time screen (=, −) · look around — drag, zoom — wheel · R — new flight',
    '· Space — stand up; on foot: a click takes the mouse (Esc gives it back), WASD — walk, E — sit down or use what is in the sight',
  ],
  zh: [
    '中央屏幕下方：主母线 (P) → 光速模式 (G) → 预位 (U) → 带护盖的启动开关 (I)，带护盖的护盾开关 (O)，主告警 (M) · 右屏下方：目标 ▲▼ (Shift+T, T)，选择 (Enter) · 右侧台面：推力滑块 (↑↓，全力制动 Shift+↓，X)',
    '· 化学发动机：1 2 3 4，推力杆 [ ] 或拖动，切断 0 · 姿态 自动/手动 (K)，转向 W A S D，滚转 Q E',
    '· 左舱壁：照明 (L)，通风 (V)，CO₂吸收 (C) · 右舱壁：H, B, F, N，断路器 · 时钟：时间屏右侧的 + 和 − (=, −) · 环视——拖动，缩放——滚轮 · R——重新开始',
    '· 空格——离开座椅；行走时：点击锁定鼠标（Esc 释放），WASD——行走，E——坐下或使用准星所指之物',
  ],
}

function Hint() {
  return <div className="hint">{HINTS[useLang()].join(' ')}</div>
}

/** RU · EN · 中文 in the corner: the language of the legends. A button gives up the focus, or Space and Enter would press it again. */
function LanguageSwitch() {
  const lang = useLang()
  return (
    <div className="lang">
      {LANGS.map((each) => (
        <button key={each} type="button" className={each === lang ? 'on' : ''} onClick={(e) => { setLang(each); e.currentTarget.blur() }}>
          {LANG_NAMES[each]}
        </button>
      ))}
    </div>
  )
}

export function App() {
  const zoomBadge = useRef<HTMLDivElement>(null)
  // A DOM write rather than state: re-rendering the Canvas parent on every wheel tick re-renders the whole scene.
  const showZoom = useCallback((zoom: number) => {
    if (!zoomBadge.current) return
    zoomBadge.current.hidden = zoom <= 1.01
    zoomBadge.current.textContent = `зум ×${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}`
  }, [])
  const reticle = useRef<HTMLDivElement>(null)
  const prompt = useRef<HTMLDivElement>(null)
  // Called every frame, so it writes only what has changed.
  const showAim = useCallback((text: string | null, isOnFoot: boolean) => {
    if (!reticle.current || !prompt.current) return
    if (reticle.current.hidden === isOnFoot) reticle.current.hidden = !isOnFoot
    const shown = text === null ? '' : legendIn(text, currentLang())
    if (prompt.current.textContent === shown) return
    prompt.current.textContent = shown
    prompt.current.hidden = text === null
  }, [])

  if (!IS_SUPPORTED) {
    return <p style={{ padding: 24 }}>Симулятору нужен WebGL 2 с рендером в HDR-буфер. Этот браузер его не предоставляет.</p>
  }
  return (
    <>
      <Canvas flat shadows="percentage" dpr={[1, 2]} gl={{ antialias: false }} camera={{ fov: 70, near: 0.01, far: 50, position: [0, 0, 0] }}>
        <Stage onZoom={showZoom} onAim={showAim} />
      </Canvas>
      <Hint />
      <LanguageSwitch />
      <div className="zoom" ref={zoomBadge} hidden />
      <div className="reticle" ref={reticle} hidden />
      <div className="prompt" ref={prompt} hidden />
      <FlightStatus />
    </>
  )
}
