import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps, type ReactNode, type RefObject } from 'react'
import { createPortal, useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { annunciatorCells, type CellTone } from './annunciator'
import { playGeigerClicks } from './audio'
import { geigerRate, poissonCount, statusLamps, type LampTone } from './cabinLogic'
import { BlastShields, useCanopyGlass } from './Canopy'
import { GalaxyClock, ShipClock } from './Clocks'
import type { CabinLight } from './Cockpit'
import {
  ArmSwitch, BusSwitch, EngineToggle, MasterAlarmButton, PanelSwitch, ScreenKey, ShieldToggle, ThrottleLever,
} from './Controls'
import { WALL_SWITCHES } from './aboard'
import { MailScreen, MapScreen, SystemsScreen } from './DeskScreens'
import { BACKGROUND_LAYER } from './frame'
import { Co2Screen, Label, NavScreen, RadiationScreen, RearCaption, TargetScreen, TimeScreen, TimerScreen, fedBy, useWake } from './Instruments'
import { AttitudeStick, ChemEngineToggle, ChemLever, CutoffButton, LightModeToggle, STRIP_SWITCHES, StripSwitch } from './FlightControls'
import { doseRate } from './physics'
import {
  confirmTarget, isShielded, moveTargetCursor, sim, toggleBreaker, toggleCabinLights, toggleFans, toggleFilter, toggleHud, toggleInstrumentsDim, toggleScrubber, toggleShutters,
  turnClock, type Breaker, type SimState,
} from './sim'
import { createMonitorMaterial } from './sky'
import { BoardDial, StatusScreen } from './WallBoard'
import { celsius, pressureKpa } from './habitat'

// The cockpit as modelled in blender/cockpit.py. The shell, the furniture and the glass come from the model; every
// control, screen and lamp is the app's own, hung on the empty that the model names for it.

const MODEL_URL = `${import.meta.env.BASE_URL}cockpit.glb`

/**
 * glTF turns Blender's z-up into y-up for every node, so a mount's own axes arrive as (right, out of the panel, down
 * the panel). This turns them back into the frame the app's controls are built in: x right, y up the panel, z out.
 */
const PANEL_FRAME = new THREE.Euler(-Math.PI / 2, 0, 0)
const REPLACED = /^(ctl_|gauge_)/ // the app draws these whole; of a screen it keeps the model's bezel
const LIGHT_LINE = new THREE.Color(0.75, 0.9, 1.0)
const LIGHT_LINE_GLOW = 6

interface Model {
  readonly root: THREE.Object3D
  readonly nodes: ReadonlyMap<string, THREE.Object3D>
  readonly glass: readonly THREE.Mesh[]
  readonly lightLines: readonly THREE.MeshStandardMaterial[]
}

const hideParts = (mount: THREE.Object3D): void => mount.traverse((child) => {
  if (child !== mount && child instanceof THREE.Mesh) child.visible = false
})

function prepare(scene: THREE.Group): Model {
  const nodes = new Map<string, THREE.Object3D>()
  const glass: THREE.Mesh[] = []
  const lightLines = new Set<THREE.MeshStandardMaterial>()
  scene.updateMatrixWorld(true) // the shields copy the glass where the model puts it
  scene.traverse((node) => {
    nodes.set(node.name, node)
    if (!(node instanceof THREE.Mesh)) return
    if (node.name === 'canopy_glass' || node.name === 'canopy_windshield' || node.name.startsWith('porthole_glass_')) {
      glass.push(node)
      return
    }
    const material = node.material as THREE.MeshStandardMaterial
    material.side = THREE.DoubleSide // moulded surfaces are seen from either side
    if (material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0) {
      // three would render the whole scene a second time for transmission; plain see-through does as well here
      material.transmission = 0
      material.transparent = true
      material.opacity = 0.55
    }
    if (material.name === 'light_line') lightLines.add(material)
    if (node.name.endsWith('_lens')) node.material = material.clone() // each lamp is lit on its own
    node.castShadow = true
    node.receiveShadow = true
  })
  nodes.forEach((node, name) => {
    if (REPLACED.test(name)) hideParts(node)
    const screenGlass = nodes.get(`${name}_glass`)
    if (name.startsWith('scr_') && screenGlass) screenGlass.visible = false
  })
  return { root: scene, nodes, glass, lightLines: [...lightLines] }
}

/** Puts app components on a mount of the model, in the panel frame unless told otherwise. */
function On({ node, isPanel = true, children }: { readonly node?: THREE.Object3D; readonly isPanel?: boolean; readonly children: ReactNode }) {
  if (!node) return null
  return createPortal(isPanel ? <group rotation={PANEL_FRAME}>{children}</group> : children, node)
}

export function CockpitModel({ rearImage, light }: { readonly rearImage: THREE.Texture; readonly light: RefObject<CabinLight> }) {
  const gltf = useLoader(GLTFLoader, MODEL_URL)
  const model = useMemo(() => prepare(gltf.scene), [gltf])
  const glass = useCanopyGlass(light)
  useEffect(() => {
    // Says that the cabin is in, for anyone waiting to touch it: the E2E tests do.
    document.body.dataset.cockpit = 'ready'
    return () => { delete document.body.dataset.cockpit }
  }, [])
  useLayoutEffect(() => {
    for (const mesh of model.glass) {
      mesh.material = mesh.name === 'canopy_windshield' ? glass.windshield : glass.canopy
      mesh.layers.set(BACKGROUND_LAYER) // glass is drawn but does not occlude the sky
      mesh.renderOrder = 1
      mesh.castShadow = false
      mesh.receiveShadow = false
    }
  }, [model, glass])
  useFrame(() => {
    // The light lines under the sills are the cabin lights, and go out with them.
    const glow = LIGHT_LINE_GLOW * sim.get().lights
    model.lightLines.forEach((line) => {
      line.emissive.copy(LIGHT_LINE)
      line.emissiveIntensity = glow
    })
  })
  return (
    <>
      <primitive object={model.root} />
      {/* ponytail: the portholes have no shutters; they look abeam, where the sky never blinds. Add them if it ever does. */}
      <BlastShields glass={model.glass.filter((mesh) => !mesh.name.startsWith('porthole_'))} />
      <Instruments nodes={model.nodes} rearImage={rearImage} />
      <Lamps nodes={model.nodes} />
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// The instruments on their mounts

const WALL = { labelSize: 0.0105, hitSize: 0.06 } as const // the wall switches stand 7 cm apart
const BREAKERS: ReadonlyArray<readonly [string, Breaker, string]> = [
  ['ctl_breaker_nav', 'nav', 'НАВИГАЦИЯ'], ['ctl_breaker_comms', 'comms', 'СВЯЗЬ'],
  ['ctl_breaker_dosimeter', 'dosimeter', 'ДОЗИМЕТР'], ['ctl_breaker_camera', 'camera', 'КАМЕРА'],
]
const CANOPY_SWITCHES: ReadonlyArray<readonly [string, string, (s: SimState) => boolean, (s: SimState) => SimState]> = [
  ['ctl_hud', 'ИНДИКАТОРЫ', (s) => s.hudOn, toggleHud], ['ctl_shutters', 'ШТОРКИ', (s) => s.shuttersClosed, toggleShutters],
  ['ctl_tint', 'ТОНИРОВКА', (s) => s.filterOn, toggleFilter], ['ctl_dim', 'ЯРКОСТЬ', (s) => s.instrumentsDimmed, toggleInstrumentsDim],
]
const CAPTION = 0.0095
const WALL_STATUS_SCREEN = [0.44, 0.17] as const // m: console.py's STATUS_SCREEN
const CONSOLE_DIAL = 0.075 // m: console.py's DIAL_RADIUS
const ROOM_DIAL = 0.055 // m: console.py's ROOM_DIAL
const BOARD_KEY = [0.04, 0.026] as const // m: a setpoint key, before the console's scale
// The console's controls stand 17 cm apart: drawn 1.4 times the cockpit's, their legends are 2.7 cm, read standing
const CONSOLE = { scale: 1.4, labelSize: 0.019, hitSize: 0.06 } as const
const ROOM = { scale: 1, labelSize: 0.016, hitSize: 0.05 } as const // the room panel's, 6 cm apart
const CONSOLE_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['cap_console_power', 'ПИТАНИЕ'], ['cap_console_air', 'ВОЗДУХ И СВЕТ'], ['cap_console_heat', 'ТЕПЛО'], ['cap_console_pressure', 'ДАВЛЕНИЕ'],
]
const GROUP_TITLE = 0.026 // m: a group's title, as tall as its controls' legends
const TITLE_COLOR = '#e6edf7'
const START_SCALE = 0.75 // the start switches stand 10 cm apart on the panel
const SCREEN_SPILL = 0.25 // the screens' light on what is near them; a choice, so that a dark cabin stays dark beyond the panel
const ON_GLASS = [0, 0, 0.003] as const // a screen's picture, just in front of the model's dark glass
const CLOCK_KEY = [0.045, 0.026] as const // m: narrower than the target keys, to fit beside the time screen on the 0.72 m facet
const CLOCK_KEYS_U = 0.27 // m right of the time screen's centre: clear of its 0.486 m bezel, clear of the centre facet's edge at 0.36
const GEIGER_U = 0.26 // m right of the radiation screen's centre: past the target keys, which end at 0.201
const GEIGER_V = -0.25 // m under it: level with the table of targets

function Instruments({ nodes, rearImage }: { readonly nodes: ReadonlyMap<string, THREE.Object3D>; readonly rearImage: THREE.Texture }) {
  const at = (name: string): THREE.Object3D | undefined => nodes.get(name)
  return (
    <>
      <On node={at('scr_nav')}><NavScreen size={[0.7, 0.36]} position={ON_GLASS} /></On>
      {/* Under it: the chemical engine's switches, the event timer, the attitude mode and the light mode (panel.py's STRIP) */}
      {STRIP_SWITCHES.map(([name, text, isOn, toggle]) => (
        <On key={name} node={at(name)}><StripSwitch label={text} isOn={isOn} toggle={toggle} scale={START_SCALE} /></On>
      ))}
      <On node={at('ctl_chem_engine')}><ChemEngineToggle scale={START_SCALE} /></On>
      <On node={at('ctl_lightmode')}><LightModeToggle scale={START_SCALE} /></On>
      <On node={at('scr_timer')}><TimerScreen size={[0.24, 0.09]} position={ON_GLASS} /></On>
      {/* The left desk: the attitude stick, the chemical engine's lever and the cutoff (cabin.py) */}
      <On node={at('ctl_stick')} isPanel={false}><AttitudeStick /></On>
      <On node={at('ctl_chem_throttle')} isPanel={false}><ChemLever /></On>
      <On node={at('ctl_cutoff')} isPanel={false}><CutoffButton /></On>
      <On node={at('scr_rad')}>
        <RadiationScreen size={[0.7, 0.36]} position={ON_GLASS} />
        <GeigerLamp position={[GEIGER_U, GEIGER_V, 0.004]} />
        <Label text="СЧЁТЧИК" size={CAPTION} position={[GEIGER_U, GEIGER_V - 0.022, 0.002]} />
      </On>
      {/* Under the radiation screen: the shield's toggle, then the table of targets and its keys: up, ВЫБРАТЬ, down */}
      <On node={at('ctl_shield')}><ShieldToggle scale={START_SCALE} /></On>
      <On node={at('scr_target')}><TargetScreen size={[0.24, 0.09]} position={ON_GLASS} /></On>
      <On node={at('ctl_target_up')}><ScreenKey arrow={1} press={(s) => moveTargetCursor(s, -1)} /></On>
      <On node={at('ctl_target_select')}><ScreenKey press={confirmTarget} /></On>
      <On node={at('ctl_target_down')}><ScreenKey arrow={-1} press={(s) => moveTargetCursor(s, 1)} /></On>
      <On node={at('scr_time')}>
        <TimeScreen size={[0.46, 0.09]} position={ON_GLASS} />
        {/* Beside its readout, the pilot's clock: faster above, slower below */}
        <ScreenKey text="+" size={CLOCK_KEY} press={(s) => turnClock(s, 1)} position={[CLOCK_KEYS_U, 0.017, 0.001]} />
        <ScreenKey text="−" size={CLOCK_KEY} press={(s) => turnClock(s, -1)} position={[CLOCK_KEYS_U, -0.017, 0.001]} />
        <Label text="ЧАСЫ" size={CAPTION} position={[CLOCK_KEYS_U, 0.046, 0.002]} />
      </On>
      <On node={at('scr_co2')}><Co2Screen size={[0.2, 0.12]} position={ON_GLASS} /></On>
      <On node={at('scr_rear')}>
        <RearMonitor image={rearImage} />
        <PanelGlow />
      </On>
      <On node={at('gauge_ship')}><ShipClock scale={0.6} /></On>
      <On node={at('gauge_galaxy')}><GalaxyClock scale={0.6} /></On>
      <On node={at('ctl_master')}><MasterAlarmButton scale={0.65} /></On>
      {/* Under the navigation screen: the start in the order of the checklist; life support and the lights on the left wall */}
      <On node={at('ctl_bus')}><BusSwitch scale={START_SCALE} /></On>
      <On node={at('ctl_arm')}><ArmSwitch scale={START_SCALE} /></On>
      <On node={at('ctl_engine')}><EngineToggle scale={START_SCALE} /></On>
      <On node={at('ctl_lights')}><PanelSwitch label="СВЕТ" isOn={(s) => s.cabinLightsOn} toggle={toggleCabinLights} {...WALL} /></On>
      <On node={at('ctl_fans')}>
        <PanelSwitch label="ВЕНТИЛЯЦИЯ" isOn={(s) => s.fansOn} toggle={toggleFans} {...WALL} />
        <Label text="ЖИЗНЕОБЕСПЕЧЕНИЕ" size={CAPTION} position={[0.05, 0.055, 0.002]} />
      </On>
      <On node={at('ctl_scrubber')}><PanelSwitch label="ПОГЛОТИТЕЛЬ" isOn={(s) => s.scrubberOn} toggle={toggleScrubber} {...WALL} /></On>
      {/* Right console: the thrust sled; breakers and the canopy's switches on the wall */}
      <On node={at('ctl_throttle')} isPanel={false}><ThrottleLever /></On>
      {BREAKERS.map(([name, breaker, text]) => (
        <On key={name} node={at(name)}>
          <PanelSwitch label={text} isOn={(s) => s.breakers[breaker]} toggle={(s) => toggleBreaker(s, breaker)} {...WALL} />
        </On>
      ))}
      {CANOPY_SWITCHES.map(([name, text, isOn, toggle]) => (
        <On key={name} node={at(name)}><PanelSwitch label={text} isOn={isOn} toggle={toggle} {...WALL} /></On>
      ))}
      <On node={at('ctl_breaker_nav')}><Label text="АВТОМАТЫ ЗАЩИТЫ" size={CAPTION} position={[0.105, 0.055, 0.002]} /></On>
      {/* The engineer's desk: mail, the map, the systems and the manual */}
      <On node={at('scr_desk_mail')}><MailScreen /></On>
      <On node={at('scr_desk_map')}><MapScreen /></On>
      <On node={at('scr_desk_systems')}><SystemsScreen /></On>
      {/* The life-support console in the engineering bay and the room panel by the bed, worked on foot by gaze and E;
          their hit boxes belong to no seat */}
      {Object.entries(WALL_SWITCHES).map(([name, { label, kind, isOn, flip }]) => {
        const isRoom = name.startsWith('ctl_room_')
        const { scale, labelSize, hitSize } = isRoom ? ROOM : CONSOLE
        return (
          <On key={name} node={at(name)}>
            <group userData={{ seat: 'board' }} scale={scale}>
              {kind === 'key'
                ? <><ScreenKey text={label.slice(-1)} size={BOARD_KEY} press={flip} />
                  {!isRoom && <Label text={label} size={labelSize} position={[0, -0.03, 0.002]} />}</>
                : <PanelSwitch label={label} isOn={isOn} toggle={flip} labelSize={labelSize} hitSize={hitSize} />}
            </group>
          </On>
        )
      })}
      {/* the room's two keys share one legend, under both: console.py puts them 6 cm apart */}
      <On node={at('ctl_room_setpoint_down')}><Label text="УСТАВКА" size={ROOM.labelSize} position={[0.03, -0.035, 0.002]} /></On>
      {CONSOLE_GROUPS.map(([name, text]) => (
        <On key={name} node={at(name)}><Label text={text} size={GROUP_TITLE} color={TITLE_COLOR} /></On>
      ))}
      <On node={at('scr_wall_status')}><StatusScreen size={WALL_STATUS_SCREEN} position={ON_GLASS} /></On>
      <On node={at('gauge_wall_temp')}>
        <BoardDial radius={CONSOLE_DIAL} caption="ТЕМПЕРАТУРА" unit="°C" captionSize={0.018} isCaptionBelow min={0} max={40} read={(s) => celsius(s.habitat)} />
      </On>
      <On node={at('gauge_wall_pressure')}>
        <BoardDial radius={CONSOLE_DIAL} caption="ДАВЛЕНИЕ" unit="кПа" captionSize={0.018} isCaptionBelow min={0} max={120} read={(s) => pressureKpa(s.habitat)} />
      </On>
      <On node={at('gauge_room_temp')}>
        <BoardDial radius={ROOM_DIAL} caption="ТЕМПЕРАТУРА" unit="°C" captionSize={0.014} min={0} max={40} read={(s) => celsius(s.habitat)} />
      </On>
      <On node={at('gauge_room_pressure')}>
        <BoardDial radius={ROOM_DIAL} caption="ДАВЛЕНИЕ" unit="кПа" captionSize={0.014} min={0} max={120} read={(s) => pressureKpa(s.habitat)} />
      </On>
      <On node={at('ctl_hud')}><Label text="ФОНАРЬ И ИНДИКАЦИЯ" size={CAPTION} position={[0.105, 0.055, 0.002]} /></On>
    </>
  )
}

const REAR_PICTURE = [0.5, 0.308] as const // m, within the model's 0.5 × 0.35 glass, over the caption

/** The rear camera's picture, with its caption along the bottom of the same glass. */
function RearMonitor({ image }: { readonly image: THREE.Texture }) {
  const gain = useWake(0.66, fedBy('camera'))
  const material = useMemo(() => createMonitorMaterial(image, gain), [image, gain])
  useEffect(() => () => material.dispose(), [material])
  return (
    <>
      <mesh material={material} position={[0, 0.019, 0.003]}>
        <planeGeometry args={[REAR_PICTURE[0], REAR_PICTURE[1]]} />
      </mesh>
      <RearCaption size={[REAR_PICTURE[0], 0.022]} position={[0, -0.158, 0.0035]} />
    </>
  )
}

/** What the screens throw on the pilot's knees, the consoles and the floor. */
function PanelGlow() {
  const light = useRef<THREE.RectAreaLight>(null!)
  const gain = useWake(0.2)
  useFrame(() => { light.current.intensity = SCREEN_SPILL * gain.value })
  return <rectAreaLight ref={light} width={1.5} height={0.32} intensity={0} color="#ffc48a" position={[0, -0.065, 0.03]} rotation={[0, Math.PI, 0]} />
}

/** A tick of light for every click of the Geiger counter; the clicks themselves are in audio.ts. */
function GeigerLamp(props: ComponentProps<'mesh'>) {
  const material = useRef<THREE.MeshBasicMaterial>(null!)
  const flash = useRef(0)
  useFrame((_, dt) => {
    const s = sim.get()
    const isCounting = s.busOn && s.breakers.dosimeter
    const clicks = isCounting ? poissonCount(geigerRate(doseRate(s.ship.phi), isShielded(s)) * Math.min(dt, 0.1), Math.random) : 0
    if (clicks > 0) {
      flash.current = 1
      playGeigerClicks(clicks)
    }
    flash.current *= Math.exp(-dt / 0.04)
    material.current.color.setRGB(0.05 + 2.4 * flash.current, 0.03 + 2.8 * flash.current, 0.03 + 1 * flash.current)
  })
  return (
    <mesh {...props}>
      <circleGeometry args={[0.007, 16]} />
      <meshBasicMaterial ref={material} toneMapped={false} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// The lamps: the model's lenses, lit from the ship's state, with the app's legends on them

const GLOW: Record<LampTone | CellTone, THREE.Color> = {
  off: new THREE.Color(0, 0, 0),
  amber: new THREE.Color(2.4, 1.2, 0.22),
  green: new THREE.Color(0.5, 2.2, 0.9),
  red: new THREE.Color(2.8, 0.3, 0.2),
  cyan: new THREE.Color(0.45, 1.5, 2.8),
}
const UNLIT = new THREE.Color(0.035, 0.035, 0.032)
const LIT = new THREE.Color(0, 0, 0)
const CELL_PITCH = 0.05

function light(lens: THREE.Object3D | undefined, tone: LampTone | CellTone): void {
  if (!(lens instanceof THREE.Mesh)) return
  const material = lens.material as THREE.MeshStandardMaterial
  material.color.copy(tone === 'off' ? UNLIT : LIT)
  material.emissive.copy(GLOW[tone])
  material.emissiveIntensity = 1
}

function Lamps({ nodes }: { readonly nodes: ReadonlyMap<string, THREE.Object3D> }) {
  const statusText = useMemo(() => statusLamps(sim.get()).map(({ label }) => label), [])
  const cellText = useMemo(() => annunciatorCells(sim.get()).map(({ label }) => label), [])
  useFrame(() => {
    const s = sim.get()
    statusLamps(s).forEach(({ tone }, i) => light(nodes.get(`lamps_status_${i}_lens`), tone))
    annunciatorCells(s).forEach(({ tone }, i) => light(nodes.get(`annunciator_${i}_lens`), tone))
  })
  return (
    <>
      {statusText.map((text, i) => (
        <On key={text} node={nodes.get(`lamps_status_${i}`)}><Label text={text} size={0.0062} position={[0, 0, 0.0045]} /></On>
      ))}
      <On node={nodes.get('annunciator')}>
        {cellText.map((text, i) => (
          <Label key={text} text={text} size={0.0068} position={[(i - (cellText.length - 1) / 2) * CELL_PITCH, 0, 0.0045]} />
        ))}
      </On>
    </>
  )
}
