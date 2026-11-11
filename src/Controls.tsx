import { useRef, type ComponentProps } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { acknowledge, masterAlarm } from './annunciator'
import { playClick } from './audio'
import { nextStartStep, throttleMarks } from './cabinLogic'
import type { Sound } from './clicks'
import { Label, useWake } from './Instruments'
import {
  isEngineLive, setThrottle, sim, toggleArm, toggleBus, toggleEngine, toggleShield, type SimState,
} from './sim'

/** Set while a pointer drag belongs to a control, so the head does not turn with it. */
export const grab = { active: false }

const LEVER_TRAVEL_PX = 220
const DETENT = 0.06

const METAL = new THREE.MeshStandardMaterial({ color: '#a9b0b8', roughness: 0.28, metalness: 0.9 })
const DARK = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.55, metalness: 0.5 })

const damp = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau)

export const cursor = (kind: string) => ({
  onPointerOver: (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    document.body.style.cursor = kind
  },
  onPointerOut: () => {
    document.body.style.cursor = 'auto'
  },
})

/**
 * Pointer handlers for a key or a button that travels under the finger: it sounds going down, and again coming up,
 * whether the finger lifts or slides off. What it does happens on the click.
 */
export const travelling = (isPressed: { current: boolean }, down: Sound, up: Sound) => {
  const release = (): void => {
    if (!isPressed.current) return
    isPressed.current = false
    playClick(up)
  }
  return {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return // only the primary button presses, as only it clicks
      e.stopPropagation()
      grab.active = true
      isPressed.current = true
      playClick(down)
    },
    onPointerUp: release,
    onPointerLeave: release,
    onPointerCancel: release,
  }
}

type GuardedToggleProps = ComponentProps<'group'> & {
  readonly label: string
  readonly isOn: (s: SimState) => boolean
  readonly toggle: (s: SimState) => SimState
  readonly lamp: (s: SimState, material: THREE.MeshStandardMaterial) => void // lights the lamp beside it, every frame
}

/** A toggle under a flip-up guard, for what must not be thrown by accident: the engine, and the shield, which no crew outlives switched off at speed. */
export function GuardedToggle({ label, isOn, toggle, lamp, ...props }: GuardedToggleProps) {
  const handle = useRef<THREE.Group>(null!)
  const guard = useRef<THREE.Group>(null!)
  const light = useRef<THREE.MeshStandardMaterial>(null!)
  const isHovered = useRef(false)

  useFrame((_, dt) => {
    const s = sim.get()
    const on = isOn(s)
    const target = Math.PI / 2 + (on ? -0.55 : 0.55)
    handle.current.rotation.x += (target - handle.current.rotation.x) * damp(dt, 0.035)
    const guardTarget = on || isHovered.current ? -1.5 : 0
    guard.current.rotation.x += (guardTarget - guard.current.rotation.x) * damp(dt, 0.07)
    lamp(s, light.current)
  })

  return (
    <group {...props}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={DARK}>
        <cylinderGeometry args={[0.032, 0.036, 0.008, 28]} />
      </mesh>
      <group ref={handle} position={[0, 0, 0.004]} rotation={[Math.PI / 2 + 0.55, 0, 0]}>
        <mesh position={[0, 0.024, 0]} material={METAL}>
          <cylinderGeometry args={[0.0055, 0.0075, 0.048, 14]} />
        </mesh>
        <mesh position={[0, 0.05, 0]} material={METAL}>
          <sphereGeometry args={[0.0085, 16, 12]} />
        </mesh>
      </group>
      {/* Flip-up safety guard: lifts when the hand comes near, stays up while the switch is on */}
      <group ref={guard} position={[0, 0.042, 0.01]}>
        <mesh position={[0, -0.042, 0.052]}>
          <boxGeometry args={[0.054, 0.086, 0.003]} />
          <meshStandardMaterial color="#c8281e" roughness={0.35} transparent opacity={0.62} depthWrite={false} />
        </mesh>
        {[-0.0265, 0.0265].map((x) => (
          <mesh key={x} position={[x, -0.042, 0.026]}>
            <boxGeometry args={[0.003, 0.086, 0.052]} />
            <meshStandardMaterial color="#a81e16" roughness={0.45} />
          </mesh>
        ))}
      </group>
      {/* The guard's hinge, on the base's top edge and around its pivot: without it the open guard hangs in the air */}
      <mesh position={[0, 0.042, 0.008]} rotation={[0, 0, Math.PI / 2]} material={DARK}>
        <cylinderGeometry args={[0.008, 0.008, 0.064, 16]} />
      </mesh>
      <mesh position={[0.075, 0.012, 0.004]}>
        <sphereGeometry args={[0.009, 14, 10]} />
        <meshStandardMaterial ref={light} color="#20262a" emissive="#000000" roughness={0.3} />
      </mesh>
      {/* Clear of the closed guard, which from the seat falls 1 cm lower than the guard itself, over a label right under it */}
      <Label text={label} size={0.018} position={[0, -0.066, 0.002]} />
      {/* Generous invisible target: the real parts are small. No wider, or under the radiation screen it takes the clock's keys */}
      <mesh
        visible={false}
        position={[0, 0, 0.03]}
        {...cursor('pointer')}
        onPointerEnter={() => { isHovered.current = true }}
        onPointerLeave={() => { isHovered.current = false }}
        onPointerDown={(e) => { e.stopPropagation(); grab.active = true }}
        onClick={(e) => {
          e.stopPropagation()
          sim.update(toggle)
          playClick('guardedSwitch')
        }}
      >
        <boxGeometry args={[0.08, 0.13, 0.09]} />
      </mesh>
    </group>
  )
}

/** A slow red pulse says that this is the next switch of the start; amber, that it is on but the engine is not up yet. */
const engineLamp = (s: SimState, material: THREE.MeshStandardMaterial): void => {
  const isReady = isEngineLive(s) && s.spool > 0.95
  material.emissive.set(isReady ? '#35ff6a' : s.engineOn ? '#ffb020' : '#ff3a20')
  material.emissiveIntensity = isReady ? 2.5
    : s.engineOn ? 1.5 + Math.sin(performance.now() / 90)
      : nextStartStep(s) === 'engine' ? startPulse() : s.busOn ? 0.12 : 0
}

const SHIELD_BLUE = new THREE.Color('#4cc2ff')
/** Blue, faint while the bus is on, and as bright as the shield's field. */
const shieldLamp = (s: SimState, material: THREE.MeshStandardMaterial): void => {
  material.emissive.copy(SHIELD_BLUE)
  material.emissiveIntensity = (s.busOn ? 0.15 : 0) + 3 * s.field * (1 + 0.08 * Math.sin(performance.now() / 260))
}

export const EngineToggle = (props: ComponentProps<'group'>) =>
  <GuardedToggle label="ДВИГАТЕЛЬ" isOn={(s) => s.engineOn} toggle={toggleEngine} lamp={engineLamp} {...props} />

export const ShieldToggle = (props: ComponentProps<'group'>) =>
  <GuardedToggle label="ЩИТ" isOn={(s) => s.shieldOn} toggle={toggleShield} lamp={shieldLamp} {...props} />

/** 0..1.7, slow: the lamp of the next switch to throw in a cold start. */
const startPulse = (): number => 0.9 + 0.8 * Math.sin(performance.now() / 500)

type PanelSwitchProps = ComponentProps<'group'> & {
  readonly label: string
  readonly labelSize?: number
  readonly isOn: (s: SimState) => boolean
  readonly toggle: (s: SimState) => SimState
  readonly isNext?: (s: SimState) => boolean // its lamp pulses red while it is the next step of the start
  readonly hitSize?: number // m, the square that answers to the mouse; smaller where switches stand close
}

/** A plain toggle with a legend and a lamp that says whether it is on. */
export function PanelSwitch({ label, labelSize = 0.019, isOn, toggle, isNext, hitSize = 0.09, ...props }: PanelSwitchProps) {
  const handle = useRef<THREE.Group>(null!)
  const lamp = useRef<THREE.MeshBasicMaterial>(null!)
  useFrame((_, dt) => {
    const s = sim.get()
    const on = isOn(s)
    const target = Math.PI / 2 + (on ? -0.55 : 0.55)
    handle.current.rotation.x += (target - handle.current.rotation.x) * damp(dt, 0.035)
    if (!on && isNext?.(s)) lamp.current.color.setRGB(startPulse(), 0.06 * startPulse(), 0.03)
    else lamp.current.color.setRGB(on ? 0.18 : 0.02, on ? 1.1 : 0.03, on ? 0.4 : 0.02)
  })
  return (
    <group {...props}>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={DARK}>
        <cylinderGeometry args={[0.018, 0.021, 0.006, 20]} />
      </mesh>
      <group ref={handle} position={[0, 0, 0.003]} rotation={[Math.PI / 2 + 0.55, 0, 0]}>
        <mesh position={[0, 0.016, 0]} material={METAL}>
          <cylinderGeometry args={[0.0035, 0.005, 0.032, 10]} />
        </mesh>
      </group>
      <mesh position={[0.034, 0, 0.002]}>
        <circleGeometry args={[0.0055, 14]} />
        <meshBasicMaterial ref={lamp} toneMapped={false} />
      </mesh>
      <Label text={label} size={labelSize} position={[0, -0.036, 0.002]} color="#e8c9a0" />
      <mesh
        visible={false}
        position={[0, 0, 0.02]}
        {...cursor('pointer')}
        onPointerDown={(e) => { e.stopPropagation(); grab.active = true }}
        onClick={(e) => {
          e.stopPropagation()
          sim.update(toggle)
          playClick('switch')
        }}
      >
        <boxGeometry args={[hitSize, hitSize, 0.06]} />
      </mesh>
    </group>
  )
}

export const BusSwitch = (props: ComponentProps<'group'>) =>
  <PanelSwitch label="ШИНА" isOn={(s) => s.busOn} toggle={toggleBus} isNext={(s) => nextStartStep(s) === 'bus'} {...props} />

export const ArmSwitch = (props: ComponentProps<'group'>) =>
  <PanelSwitch label="ВЗВЕДЕНИЕ" labelSize={0.016} isOn={(s) => s.armed} toggle={toggleArm} isNext={(s) => nextStartStep(s) === 'arm'} {...props} />

const ALARM_RED = new THREE.Color(3, 0.25, 0.15)
const ALARM_AMBER = new THREE.Color(2.6, 1.2, 0.15)
const ALARM_PAINT = '#3a0c08' // the cap's red glass, seen by the cabin light; it glows only when it calls
const UNLIT = new THREE.Color(0, 0, 0)
const ALARM_FLASH_HZ = 3

/** ГЛАВНАЯ АВАРИЯ: flashes red for a warning, amber for a caution, until it is pressed. */
export function MasterAlarmButton(props: ComponentProps<'group'>) {
  const face = useRef<THREE.MeshStandardMaterial>(null!)
  const cap = useRef<THREE.Mesh>(null!)
  const isPressed = useRef(false)
  useFrame(({ clock }, dt) => {
    const call = masterAlarm(sim.get())
    const isLit = call !== null && Math.floor(clock.elapsedTime * ALARM_FLASH_HZ) % 2 === 0
    face.current.emissive.copy(isLit ? (call === 'warning' ? ALARM_RED : ALARM_AMBER) : UNLIT)
    const travel = isPressed.current ? 0.003 : 0.008
    cap.current.position.z += (travel - cap.current.position.z) * damp(dt, 0.025)
  })
  return (
    <group {...props}>
      <mesh material={DARK}>
        <boxGeometry args={[0.112, 0.036, 0.006]} />
      </mesh>
      <mesh
        ref={cap}
        position={[0, 0, 0.008]}
        {...cursor('pointer')}
        {...travelling(isPressed, 'buttonDown', 'buttonUp')}
        onClick={(e) => {
          e.stopPropagation()
          sim.update(acknowledge)
        }}
      >
        <boxGeometry args={[0.1, 0.026, 0.008]} />
        <meshStandardMaterial ref={face} color={ALARM_PAINT} roughness={0.3} toneMapped={false} />
      </mesh>
      <Label text="ГЛ. АВАРИЯ" size={0.013} color="#6d7379" position={[0, 0, 0.0125]} />
    </group>
  )
}

const DARK_METAL = new THREE.MeshStandardMaterial({ color: '#6f7377', roughness: 0.35, metalness: 1 })
const GRAPHITE = new THREE.MeshStandardMaterial({ color: '#3c3d40', roughness: 0.45 })

const KEY_SIZE = [0.06, 0.026] as const // m, as in the model

type ScreenKeyProps = ComponentProps<'group'> & {
  readonly arrow?: 1 | -1 // ▲ or ▼; without one, or a legend of its own, the key reads ВЫБРАТЬ
  readonly text?: string
  readonly size?: readonly [number, number] // m, the face: the target keys' by default
  readonly press: (s: SimState) => SimState
}

/** A key beside a screen, as in the model: a cap proud of a dark frame, its legend lit from behind. */
export function ScreenKey({ arrow, text, size = KEY_SIZE, press, ...props }: ScreenKeyProps) {
  const cap = useRef<THREE.Group>(null!)
  const isPressed = useRef(false)
  const [width, height] = size
  useFrame((_, dt) => {
    const travel = isPressed.current ? 0.0035 : 0.006
    cap.current.position.z += (travel - cap.current.position.z) * damp(dt, 0.02)
  })
  return (
    <group {...props}>
      <mesh position={[0, 0, 0.002]} material={DARK_METAL}>
        <boxGeometry args={[width, height, 0.004]} />
      </mesh>
      <group ref={cap} position={[0, 0, 0.006]}>
        <mesh material={GRAPHITE}>
          <boxGeometry args={[width - 0.006, height - 0.005, 0.006]} />
        </mesh>
        <Label
          text={text ?? (arrow === 1 ? '▲' : arrow === -1 ? '▼' : 'ВЫБРАТЬ')}
          size={text !== undefined || arrow ? 0.017 : 0.0115}
          position={[0, 0, 0.0032]}
        />
      </group>
      <mesh
        visible={false}
        position={[0, 0, 0.01]}
        {...cursor('pointer')}
        {...travelling(isPressed, 'keyDown', 'keyUp')}
        onClick={(e) => {
          e.stopPropagation()
          sim.update(press)
        }}
      >
        <boxGeometry args={[width, height, 0.02]} />
      </mesh>
    </group>
  )
}

// The thrust sled, as in the model: a low sled in a long track, a row of lamps either side.
const SLED_TRAVEL = 0.24 // m from −1 g to +1 g
const SCALE_MARKS = 9
const SCALE_SIDES = [-0.04, 0.04] as const
const SLED_BODY = new RoundedBoxGeometry(0.07, 0.04, 0.1, 4, 0.016)
const SLED_PAD = new RoundedBoxGeometry(0.05, 0.008, 0.06, 2, 0.0035)
const SLED_WHITE = new THREE.MeshStandardMaterial({ color: '#cfd0cc', roughness: 0.38 })
const GRIP = new THREE.MeshStandardMaterial({ color: '#d2541c', roughness: 0.42, metalness: 0.1 })
const THRUST_LAMP = new THREE.Color(0.25, 1.4, 0.55)
const BRAKE_LAMP = new THREE.Color(1.6, 0.8, 0.15)
const DETENT_LAMP = new THREE.Color(1.2, 1.2, 1.2)
const NOSE_LAMP = new THREE.Color(0.3, 1.2, 1.6)
const UNLIT_MARK = 0.12 // of full, for a lamp outside the bar: the scale still reads in the dark
const markAt = (i: number): number => -1 + (2 * i) / (SCALE_MARKS - 1) // the setting each lamp stands for
const markColour = (i: number): THREE.Color => (markAt(i) > 0 ? THRUST_LAMP : markAt(i) < 0 ? BRAKE_LAMP : DETENT_LAMP)

export function ThrottleLever(props: ComponentProps<'group'>) {
  const sled = useRef<THREE.Group>(null!)
  const nose = useRef<THREE.MeshBasicMaterial>(null!)
  const lamps = useRef<Array<THREE.MeshBasicMaterial | null>>([])
  const drag = useRef<{ readonly y: number; readonly start: number } | null>(null)
  const backlight = useWake(0.1) // the lamps are on the bus, and the dimmer turns them down with the rest

  useFrame((_, dt) => {
    const s = sim.get()
    const target = (-s.throttle * SLED_TRAVEL) / 2 // forward is −z
    sled.current.position.z += (target - sled.current.position.z) * damp(dt, 0.04)
    const bar = throttleMarks(s.throttle, SCALE_MARKS)
    lamps.current.forEach((lamp, k) => {
      const i = k % SCALE_MARKS
      lamp?.color.copy(markColour(i)).multiplyScalar(backlight.value * (bar[i] ? 1 : UNLIT_MARK))
    })
    nose.current.color.copy(NOSE_LAMP).multiplyScalar(backlight.value)
  })

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    grab.active = true
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, start: sim.get().throttle }
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
    const raw = drag.current.start + (drag.current.y - e.clientY) / LEVER_TRAVEL_PX
    const value = Math.abs(raw) < DETENT ? 0 : raw
    const wasAtDetent = sim.get().throttle === 0
    sim.update((s) => setThrottle(s, value))
    if (value === 0 && !wasAtDetent) playClick('detent')
  }

  return (
    <group {...props}>
      <mesh position={[0, 0.004, 0]} material={DARK}>
        <boxGeometry args={[0.11, 0.008, SLED_TRAVEL + 0.08]} />
      </mesh>
      <mesh position={[0, 0.0085, 0]}>
        <boxGeometry args={[0.016, 0.001, SLED_TRAVEL + 0.02]} />
        <meshStandardMaterial color="#05060a" />
      </mesh>
      {SCALE_SIDES.flatMap((x, side) => Array.from({ length: SCALE_MARKS }, (_, i) => (
        <mesh key={`${x}:${i}`} position={[x, 0.009, (-markAt(i) * SLED_TRAVEL) / 2]}>
          <boxGeometry args={[0.012, 0.002, 0.004]} />
          <meshBasicMaterial ref={(made) => { lamps.current[side * SCALE_MARKS + i] = made }} color="#000000" toneMapped={false} />
        </mesh>
      )))}
      <group position={[-0.085, 0.009, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <Label text="+1 g" size={0.02} position={[0, SLED_TRAVEL / 2, 0]} color="#7fe0a0" />
        <Label text="0" size={0.02} position={[0, 0, 0]} />
        <Label text="−1 g" size={0.02} position={[0, -SLED_TRAVEL / 2, 0]} color="#ffb070" />
        <Label text="ТЯГА" size={0.024} position={[0.085, -SLED_TRAVEL / 2 - 0.05, 0]} />
      </group>
      <group ref={sled}>
        <mesh geometry={SLED_BODY} material={SLED_WHITE} position={[0, 0.03, 0]} />
        <mesh geometry={SLED_PAD} material={GRIP} position={[0, 0.05, 0.012]} />
        <mesh position={[0, 0.03, -0.0515]}>
          <boxGeometry args={[0.05, 0.006, 0.003]} />
          <meshBasicMaterial ref={nose} color="#000000" toneMapped={false} />
        </mesh>
        {/* A low target over the sled: a tall one would stand in front of the breakers on the wall */}
        <mesh
          visible={false}
          position={[0, 0.035, 0]}
          {...cursor('grab')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        >
          <boxGeometry args={[0.11, 0.07, 0.13]} />
        </mesh>
      </group>
    </group>
  )
}
