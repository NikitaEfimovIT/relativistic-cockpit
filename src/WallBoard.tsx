// The dials of the life-support console and of the room panel: a needle over a scale painted once. They are mechanical, so
// they read without the bus; luminous, as the cockpit's clocks are.
import { useMemo, useRef, type ComponentProps } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BATTERY_WH, celsius, ppO2Kpa, pressureKpa } from './habitat'
import { AMBER, FONT, GREEN, Label, RED, Screen, newCanvas, paintRows, type Painter } from './Instruments'
import { CO2_LIMIT } from './lifeSupport'
import { faceCo2, sim, totalLoadW, type SimState } from './sim'
import { legendIn, useLang } from './labels'

const FACE_PX = 384
const SWEEP = (3 * Math.PI) / 2 // the scale runs round three quarters of the dial, from bottom left to bottom right
const TICKS = 8 // spaces between numbered ticks

function paintFace(ctx: CanvasRenderingContext2D, min: number, max: number, unit: string): void {
  const r = FACE_PX / 2
  ctx.fillStyle = '#e9ece6'
  ctx.beginPath()
  ctx.arc(r, r, r, 0, 2 * Math.PI)
  ctx.fill()
  ctx.strokeStyle = '#1b1e22'
  ctx.fillStyle = '#1b1e22'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `600 ${FACE_PX * 0.085}px ${FONT}`
  for (let i = 0; i <= TICKS * 2; i++) {
    const angle = -Math.PI / 2 - SWEEP / 2 + (SWEEP * i) / (TICKS * 2) // canvas angle, from the top, clockwise
    const isMajor = i % 2 === 0
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
    ctx.lineWidth = isMajor ? 5 : 3
    ctx.beginPath()
    ctx.moveTo(r + cos * r * 0.92, r + sin * r * 0.92)
    ctx.lineTo(r + cos * r * (isMajor ? 0.78 : 0.84), r + sin * r * (isMajor ? 0.78 : 0.84))
    ctx.stroke()
    if (isMajor) ctx.fillText(String(Math.round(min + ((max - min) * i) / (TICKS * 2))), r + cos * r * 0.62, r + sin * r * 0.62)
  }
  ctx.font = `700 ${FACE_PX * 0.13}px ${FONT}`
  ctx.fillText(unit, r, r * 1.62) // in the gap the scale leaves at the bottom
}

type BoardDialProps = ComponentProps<'group'> & {
  readonly radius: number // m, the model's dial
  readonly caption: string
  readonly unit: string
  readonly captionSize?: number
  readonly isCaptionBelow?: boolean
  readonly min: number
  readonly max: number
  readonly read: (s: SimState) => number
}

/** A dial with a needle and its unit on the face; its caption over it, or under it where a frame stands above. */
export function BoardDial({ radius, caption, unit, captionSize = 0.0085, isCaptionBelow = false, min, max, read, ...props }: BoardDialProps) {
  const shownUnit = legendIn(unit, useLang())
  const texture = useMemo(() => {
    const [ctx, face] = newCanvas(FACE_PX, FACE_PX)
    paintFace(ctx, min, max, shownUnit)
    return face
  }, [min, max, shownUnit])
  const needle = useRef<THREE.Group>(null!)
  useFrame(() => {
    const share = THREE.MathUtils.clamp((read(sim.get()) - min) / (max - min), 0, 1)
    needle.current.rotation.z = SWEEP / 2 - SWEEP * share // zero at the top; a dial turns clockwise as it rises
  })
  return (
    <group {...props}>
      <mesh position={[0, 0, 0.0012]}>
        <circleGeometry args={[radius, 48]} />
        <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.12} roughness={0.6} />
      </mesh>
      <group ref={needle} position={[0, 0, 0.0025]}>
        <mesh position={[0, radius * 0.38, 0]}>
          <boxGeometry args={[radius * 0.06, radius * 0.85, 0.0008]} />
          <meshStandardMaterial color="#d2442a" emissive="#d2442a" emissiveIntensity={0.25} />
        </mesh>
      </group>
      <Label text={caption} size={captionSize} position={[0, (isCaptionBelow ? -1 : 1) * (radius + 0.008 + captionSize / 2), 0.002]} />
    </group>
  )
}

const STATUS_TEXT = 1.5 // the console's screen is read standing, 0.8 m off: its letters half as big again as a cockpit screen's

const comfort = (ok: boolean, bad: boolean): string => (bad ? RED : ok ? GREEN : AMBER)

const paintStatus: Painter = (ctx, width, height, s) => {
  const h = s.habitat
  const t = celsius(h)
  const charge = h.batteryWh / BATTERY_WH
  paintRows(ctx, width, height, 'ЖИЗНЕОБЕСПЕЧЕНИЕ', [
    { label: `ТЕМП. · УСТ. ${h.setpoint}`, value: `${t.toFixed(1)} °C`, tone: comfort(t >= 18 && t <= 27, t < 10) },
    { label: 'ДАВЛЕНИЕ', value: `${pressureKpa(h).toFixed(1)} кПа`, tone: comfort(pressureKpa(h) > 95, pressureKpa(h) < 34.5) },
    { label: 'КИСЛОРОД', value: `${ppO2Kpa(h).toFixed(1)} кПа`, tone: comfort(ppO2Kpa(h) > 18, ppO2Kpa(h) < 15) },
    { label: 'CO₂', value: `${faceCo2(s).toFixed(1)} мм`, tone: comfort(faceCo2(s) <= CO2_LIMIT, false) },
    { label: h.reactorOn ? 'АКБ' : 'АКБ · РЕАКТОР ВЫКЛ', value: `${Math.round(charge * 100)} %`, tone: comfort(h.reactorOn && charge > 0.2, charge === 0) },
    { label: 'НАГРУЗКА', value: `${(totalLoadW(s) / 1000).toFixed(2)} кВт`, tone: GREEN },
  ], GREEN, STATUS_TEXT)
}

/** The console's screen: the habitat at a glance, read standing. It runs off the bus. */
export const StatusScreen = ({ size, ...props }: ComponentProps<'group'> & { readonly size: readonly [number, number] }) => (
  <Screen width={size[0]} height={size[1]} paint={paintStatus} hasBezel={false} delay={0.6} {...props} />
)
