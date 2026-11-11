import { useEffect, useMemo, useRef, type ComponentProps } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { handAngle, handBlur } from './cabinLogic'
import { Label } from './Instruments'
import { YEAR } from './physics'
import { sim, type SimState } from './sim'
import { TRIM } from './wear'

// Two clocks side by side make time dilation something you can watch. They start in step. As the ship speeds up, the
// galaxy's clock pulls ahead, and at the limit its hands dissolve into a disc while the ship's clock keeps its pace.
// Both are mechanical, with luminous hands, so they run in a cold cabin too.

const RADIUS = 0.066
const LONG_HAND = RADIUS * 0.82
const SHORT_HAND = RADIUS * 0.54
const YEARS_PER_TURN_LONG = 1
const YEARS_PER_TURN_SHORT = 12
const LUMINOUS = new THREE.Color(1.15, 0.72, 0.28)

function paintDial(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is unavailable, so the clock dial cannot be drawn')
  ctx.fillStyle = '#050607'
  ctx.fillRect(0, 0, size, size)
  ctx.translate(size / 2, size / 2)
  for (let i = 0; i < 48; i++) {
    const isHour = i % 4 === 0
    ctx.rotate((2 * Math.PI) / 48)
    ctx.fillStyle = isHour ? '#e8b878' : '#6f5a3d'
    ctx.fillRect(isHour ? -2.5 : -1, -size * 0.47, isHour ? 5 : 2, isHour ? size * 0.075 : size * 0.035)
  }
  ctx.font = `600 ${size * 0.1}px "SF Mono", Menlo, Consolas, monospace`
  ctx.fillStyle = '#d9b285'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const [text, x, y] of [['12', 0, -0.3], ['3', 0.31, 0], ['6', 0, 0.31], ['9', -0.31, 0]] as const) {
    ctx.fillText(text, x * size, y * size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function Hand({ length, width, onFrame }: {
  readonly length: number
  readonly width: number
  readonly onFrame: (pivot: THREE.Group, material: THREE.MeshBasicMaterial, disc: THREE.MeshBasicMaterial) => void
}) {
  const pivot = useRef<THREE.Group>(null!)
  const material = useRef<THREE.MeshBasicMaterial>(null!)
  const disc = useRef<THREE.MeshBasicMaterial>(null!)
  useFrame(() => onFrame(pivot.current, material.current, disc.current))
  return (
    <>
      <mesh position={[0, 0, 0.003]}>
        <circleGeometry args={[length, 32]} />
        <meshBasicMaterial ref={disc} color={LUMINOUS} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={pivot}>
        <mesh position={[0, length / 2, 0.005]}>
          <planeGeometry args={[width, length]} />
          <meshBasicMaterial ref={material} color={LUMINOUS} transparent toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

type ClockProps = ComponentProps<'group'> & {
  readonly label: string
  readonly read: (s: SimState) => number // years
}

function Clock({ label, read, ...props }: ClockProps) {
  const dial = useMemo(paintDial, [])
  useEffect(() => () => dial.dispose(), [dial])
  const last = useRef(read(sim.get()))
  const blurPerFrame = useRef(0)
  useFrame(() => {
    const years = read(sim.get())
    blurPerFrame.current = Math.abs(years - last.current)
    last.current = years
  })
  const hand = (yearsPerTurn: number) => (pivot: THREE.Group, material: THREE.MeshBasicMaterial, disc: THREE.MeshBasicMaterial): void => {
    pivot.rotation.z = handAngle(last.current, yearsPerTurn)
    const blur = handBlur(blurPerFrame.current / yearsPerTurn)
    material.opacity = 1 - 0.92 * blur
    disc.opacity = 0.2 * blur
  }
  return (
    <group {...props}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.002]} material={TRIM}>
        <cylinderGeometry args={[RADIUS + 0.008, RADIUS + 0.01, 0.012, 40]} />
      </mesh>
      <mesh position={[0, 0, 0.005]}>
        <circleGeometry args={[RADIUS, 48]} />
        <meshBasicMaterial map={dial} toneMapped={false} />
      </mesh>
      <group position={[0, 0, 0.006]}>
        <Hand length={LONG_HAND} width={0.0034} onFrame={hand(YEARS_PER_TURN_LONG)} />
        <group position={[0, 0, 0.002]}>
          <Hand length={SHORT_HAND} width={0.006} onFrame={hand(YEARS_PER_TURN_SHORT)} />
        </group>
        <mesh position={[0, 0, 0.009]} material={TRIM}>
          <circleGeometry args={[0.0055, 16]} />
        </mesh>
      </group>
      <Label text={label} size={0.019} position={[0, RADIUS + 0.025, 0.002]} color="#e8c9a0" />
    </group>
  )
}

export const ShipClock = (props: ComponentProps<'group'>) =>
  <Clock label="БОРТ, лет" read={(s) => s.ship.tau / YEAR} {...props} />
export const GalaxyClock = (props: ComponentProps<'group'>) =>
  <Clock label="ГАЛАКТИКА, лет" read={(s) => s.ship.t / YEAR} {...props} />
