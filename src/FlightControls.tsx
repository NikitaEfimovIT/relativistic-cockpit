// The controls for flight by a body and for the light mode: the switches of the strip under the navigation screen, and
// on the left desk the attitude stick, the chemical engine's lever and the cutoff. As the model has them (panel.py,
// cabin.py, hardware.py); the stick follows the keys only, as the pilot chose; the lever is dragged too, as ТЯГА is.
import { useRef, type ComponentProps } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { nextStartStep } from './cabinLogic'
import { GuardedToggle, PanelSwitch, cursor, grab, travelling } from './Controls'
import { playClick } from './audio'
import { Label, useWake } from './Instruments'
import {
  cutOff, isChemBurning, setChemThrottle, sim, toggleChemEngine, toggleCrossfeed, toggleFeed, toggleLightMode, toggleManualAttitude, togglePressurisation,
  type SimState,
} from './sim'

const damp = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau)
const DARK = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.55, metalness: 0.5 })
const METAL = new THREE.MeshStandardMaterial({ color: '#a9b0b8', roughness: 0.28, metalness: 0.9 })
const BOOT = new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.9 })
const GRIP = new THREE.MeshStandardMaterial({ color: '#d2541c', roughness: 0.42, metalness: 0.1 })
const WHITE = new THREE.MeshStandardMaterial({ color: '#cfd0cc', roughness: 0.38 })
const ON_DESK: readonly [number, number, number] = [-Math.PI / 2, 0, 0] // a label lying on the desk, read from the seat
const startPulse = (): number => 0.9 + 0.8 * Math.sin(performance.now() / 500)

// ── The strip under the navigation screen ──────────────────────────────────────────────────────────────────────────

/** СВЕТ. РЕЖИМ's lamp: green while engaged; the slow red pulse while it is the next step of the main engine's start. */
const lightModeLamp = (s: SimState, material: THREE.MeshStandardMaterial): void => {
  material.emissive.set(s.lightModeOn ? '#35ff6a' : '#ff3a20')
  material.emissiveIntensity = s.lightModeOn ? (s.busOn ? 2 : 0) : nextStartStep(s) === 'light' ? startPulse() : s.busOn ? 0.12 : 0
}

/** ДОСВЕТ ПУСК's lamp: green while the engine burns, amber flickering while started but not burning. */
const chemLamp = (s: SimState, material: THREE.MeshStandardMaterial): void => {
  const isBurning = isChemBurning(s)
  material.emissive.set(isBurning ? '#35ff6a' : '#ffb020')
  material.emissiveIntensity = isBurning ? 2.5 : s.propulsion.engineOn ? 1.5 + Math.sin(performance.now() / 90) : s.busOn ? 0.12 : 0
}

export const LightModeToggle = (props: ComponentProps<'group'>) =>
  <GuardedToggle label="СВЕТ. РЕЖИМ" isOn={(s) => s.lightModeOn} toggle={toggleLightMode} lamp={lightModeLamp} {...props} />

export const ChemEngineToggle = (props: ComponentProps<'group'>) =>
  <GuardedToggle label="ДОСВЕТ ПУСК" isOn={(s) => s.propulsion.engineOn} toggle={toggleChemEngine} lamp={chemLamp} {...props} />

/** The plain switches of the strip, in its order: the chemical engine's valves, then the attitude mode. */
export const STRIP_SWITCHES: ReadonlyArray<readonly [string, string, (s: SimState) => boolean, (s: SimState) => SimState]> = [
  ['ctl_pressurise', 'НАДДУВ', (s) => s.propulsion.pressurised, togglePressurisation],
  ['ctl_feed', 'ПОДАЧА', (s) => s.propulsion.feedOpen, toggleFeed],
  ['ctl_crossfeed', 'ПЕРЕКР.', (s) => s.propulsion.crossfeedOpen, toggleCrossfeed],
  ['ctl_attitude', 'РУЧН. УПР.', (s) => s.manualAttitude, toggleManualAttitude],
]

export const StripSwitch = ({ label, isOn, toggle, ...props }: ComponentProps<'group'> & {
  readonly label: string
  readonly isOn: (s: SimState) => boolean
  readonly toggle: (s: SimState) => SimState
}) => <PanelSwitch label={label} labelSize={0.016} isOn={isOn} toggle={toggle} hitSize={0.08} {...props} />

// ── The attitude stick ─────────────────────────────────────────────────────────────────────────────────────────────

const STICK_TILT = 0.35 // rad at a key held: pitch and roll
const STICK_TWIST = 0.5 // rad: yaw twists the grip
const GRIP_SHAPE = new RoundedBoxGeometry(0.036, 0.06, 0.04, 3, 0.014)

/**
 * The attitude hand controller, upright on the desk: in РУЧН it leans as the keys command, back for the nose up, to a
 * side for a roll, and twists for a yaw; let go, it stands up again.
 */
export function AttitudeStick(props: ComponentProps<'group'>) {
  const shaft = useRef<THREE.Group>(null!)
  useFrame((_, dt) => {
    const { stick, manualAttitude } = sim.get()
    const [pitch, yaw, roll] = manualAttitude ? stick : [0, 0, 0]
    const k = damp(dt, 0.06)
    shaft.current.rotation.x += (pitch * STICK_TILT - shaft.current.rotation.x) * k
    shaft.current.rotation.y += (yaw * STICK_TWIST - shaft.current.rotation.y) * k
    shaft.current.rotation.z += (roll * STICK_TILT - shaft.current.rotation.z) * k
  })
  return (
    <group {...props}>
      <mesh position={[0, 0.006, 0]} material={DARK}>
        <cylinderGeometry args={[0.045, 0.048, 0.012, 32]} />
      </mesh>
      <group ref={shaft} position={[0, 0.012, 0]}>
        <mesh position={[0, 0.015, 0]} material={BOOT}>
          <cylinderGeometry args={[0.016, 0.026, 0.03, 20]} />
        </mesh>
        <mesh position={[0, 0.055, 0]} material={METAL}>
          <cylinderGeometry args={[0.008, 0.009, 0.06, 12]} />
        </mesh>
        <mesh position={[0, 0.1, 0]} geometry={GRIP_SHAPE} material={GRIP} />
      </group>
      <Label text="ОРИЕНТАЦИЯ" size={0.016} position={[0, 0.0125, 0.065]} rotation={ON_DESK} />
    </group>
  )
}

// ── The chemical engine's lever ────────────────────────────────────────────────────────────────────────────────────

const LEVER_TRAVEL = 0.16 // m from off at the back to full at the front
const LEVER_MARKS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 1] as const // its notches (chemical.ts)
const SLED = new RoundedBoxGeometry(0.05, 0.034, 0.07, 3, 0.012)
const MARK_LIT = new THREE.Color(1.6, 0.8, 0.15)
const MARK_UNLIT = 0.12
const leverZ = (throttle: number): number => (LEVER_TRAVEL / 2) * (1 - 2 * throttle) // forward is −z
const LEVER_DRAG_PX = 220 // px of drag from off to full, as ТЯГА takes from its detent to a full g

/**
 * The chemical engine's lever: a short sled, off at the back, 10–60 % and full at the front, lamps up to it. Dragged
 * up the screen it goes forward; between 60 and 100 % it does not stand, and settles at the nearer of the two.
 */
export function ChemLever(props: ComponentProps<'group'>) {
  const sled = useRef<THREE.Group>(null!)
  const lamps = useRef<Array<THREE.MeshBasicMaterial | null>>([])
  const drag = useRef<{ readonly y: number; readonly start: number } | null>(null)
  const backlight = useWake(0.1)
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    grab.active = true
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, start: sim.get().propulsion.throttle }
    document.body.style.cursor = 'grabbing'
  }
  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    ;(e.target as unknown as Element).releasePointerCapture(e.pointerId)
    drag.current = null
    grab.active = false
    document.body.style.cursor = 'grab'
  }
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    if (e.buttons === 0) { // the release was lost to a context menu or a window switch
      endDrag(e)
      return
    }
    const { y, start } = drag.current
    const was = sim.get().propulsion.throttle
    sim.update((s) => setChemThrottle(s, start + (y - e.clientY) / LEVER_DRAG_PX))
    const now = sim.get().propulsion.throttle
    if (now !== was && (now === 0 || now === 1 || was === 0 || was === 1)) playClick('detent') // into or out of its stops
  }
  useFrame((_, dt) => {
    const { throttle } = sim.get().propulsion
    sled.current.position.z += (leverZ(throttle) - sled.current.position.z) * damp(dt, 0.04)
    lamps.current.forEach((lamp, i) => {
      lamp?.color.copy(MARK_LIT).multiplyScalar(backlight.value * (i > 0 && LEVER_MARKS[i] <= throttle + 1e-9 ? 1 : MARK_UNLIT))
    })
  })
  return (
    <group {...props}>
      <mesh position={[0, 0.004, 0]} material={DARK}>
        <boxGeometry args={[0.08, 0.008, LEVER_TRAVEL + 0.06]} />
      </mesh>
      {LEVER_MARKS.map((mark, i) => (
        <mesh key={mark} position={[0.03, 0.009, leverZ(mark)]}>
          <boxGeometry args={[0.01, 0.002, 0.004]} />
          <meshBasicMaterial ref={(made) => { lamps.current[i] = made }} color="#000000" toneMapped={false} />
        </mesh>
      ))}
      <group ref={sled} position={[0, 0, leverZ(0)]}>
        <mesh geometry={SLED} material={WHITE} position={[0, 0.026, 0]} />
        <mesh position={[0, 0.044, 0.01]} material={GRIP}>
          <boxGeometry args={[0.036, 0.004, 0.04]} />
        </mesh>
        {/* a low target over the sled, as ТЯГА's, so that it stands in front of nothing */}
        <mesh
          visible={false}
          position={[0, 0.03, 0]}
          {...cursor('grab')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        >
          <boxGeometry args={[0.08, 0.06, 0.1]} />
        </mesh>
      </group>
      <group position={[-0.058, 0.009, 0]} rotation={ON_DESK}>
        <Label text="100" size={0.014} position={[0, LEVER_TRAVEL / 2, 0]} color="#ffb070" />
        <Label text="60" size={0.014} position={[0, -leverZ(0.6), 0]} />
        <Label text="0" size={0.014} position={[0, -LEVER_TRAVEL / 2, 0]} />
      </group>
      <Label text="ДОСВЕТ" size={0.018} position={[0, 0.009, LEVER_TRAVEL / 2 + 0.05]} rotation={ON_DESK} />
    </group>
  )
}

// ── АВАРИЙНАЯ ОТСЕЧКА ──────────────────────────────────────────────────────────────────────────────────────────────

const CUTOFF_RED = new THREE.MeshStandardMaterial({ color: '#b3170f', roughness: 0.35 })

/** A red mushroom button under a clear cover that lifts when the hand comes near: both start switches off at once. */
export function CutoffButton(props: ComponentProps<'group'>) {
  const cover = useRef<THREE.Group>(null!)
  const cap = useRef<THREE.Mesh>(null!)
  const isHovered = useRef(false)
  const isPressed = useRef(false)
  const press = travelling(isPressed, 'buttonDown', 'buttonUp')
  useFrame((_, dt) => {
    cover.current.rotation.x += ((isHovered.current ? -1.6 : 0) - cover.current.rotation.x) * damp(dt, 0.07)
    cap.current.position.y += ((isPressed.current ? 0.012 : 0.017) - cap.current.position.y) * damp(dt, 0.025)
  })
  return (
    <group {...props}>
      <mesh position={[0, 0.005, 0]} material={DARK}>
        <cylinderGeometry args={[0.03, 0.032, 0.01, 28]} />
      </mesh>
      <mesh ref={cap} position={[0, 0.017, 0]} material={CUTOFF_RED}>
        <cylinderGeometry args={[0.022, 0.02, 0.014, 28]} />
      </mesh>
      {/* the clear cover, hinged at its far edge */}
      <group ref={cover} position={[0, 0.002, -0.035]}>
        <mesh position={[0, 0.02, 0.035]}>
          <boxGeometry args={[0.07, 0.04, 0.07]} />
          <meshStandardMaterial color="#c8281e" roughness={0.3} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      </group>
      <Label text="ОТСЕЧКА" size={0.016} position={[0, 0.0105, 0.05]} rotation={ON_DESK} />
      <mesh
        visible={false}
        position={[0, 0.03, 0]}
        {...cursor('pointer')}
        {...press}
        onPointerEnter={() => { isHovered.current = true }}
        onPointerLeave={() => {
          isHovered.current = false
          press.onPointerLeave()
        }}
        onClick={(e) => {
          e.stopPropagation()
          sim.update(cutOff)
        }}
      >
        <boxGeometry args={[0.08, 0.06, 0.08]} />
      </mesh>
    </group>
  )
}
