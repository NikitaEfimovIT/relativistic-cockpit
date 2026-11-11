// The three screens of the engineer's desk, one computer: mail on the left, the map in the middle, the systems and the
// manual on the right (deskMail.ts, deskMap.ts, deskSystems.ts; their look in deskTheme.ts). Each screen paints itself
// and its keys; the pointer over it lights what it is on, a click acts on the key under it, the wheel scrolls its list.
import { useMemo, useRef, type ComponentProps } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { playClick } from './audio'
import { paintMail } from './deskMail'
import { paintMap } from './deskMap'
import { paintRight } from './deskSystems'
import type { DeskPainter, Pointer } from './deskTheme'
import { desk, deskPointer, pressDesk, regionAt, uvToCanvas, type DeskScreenName, type Region } from './deskUi'
import { PIXELS_PER_METRE, REFRESH_HZ, SCREEN_GLOW, newCanvas, useWake } from './Instruments'
import { sim } from './sim'

const KEY_GLOW = 0.62 // of the cockpit screens' glow: a desktop is lit to be read for hours, not to cut through glare

type DeskScreenProps = ComponentProps<'group'> & {
  readonly screen: DeskScreenName // name would clash with three's own
  readonly size: readonly [number, number] // m, the model's glass
  readonly paint: DeskPainter
}

/** A screen of the desk computer that answers to the mouse. */
function DeskScreen({ screen, size: [width, height], paint, ...props }: DeskScreenProps) {
  const pixelWidth = Math.round(width * PIXELS_PER_METRE)
  const pixelHeight = Math.round(height * PIXELS_PER_METRE)
  const [ctx, texture] = useMemo(() => newCanvas(pixelWidth, pixelHeight), [pixelWidth, pixelHeight])
  const regions = useRef<readonly Region[]>([])
  const pointer = useRef<Pointer>(null)
  const lastPaint = useRef(-1)
  const emission = useRef<THREE.MeshBasicMaterial>(null!)
  const gain = useWake(0.5)
  useFrame(({ clock }) => {
    emission.current.color.copy(SCREEN_GLOW).multiplyScalar(gain.value * KEY_GLOW)
    if (clock.elapsedTime - lastPaint.current < 1 / REFRESH_HZ) return
    lastPaint.current = clock.elapsedTime
    regions.current = paint(ctx, pixelWidth, pixelHeight, sim.get(), desk.get(), pointer.current)
    texture.needsUpdate = true
  })
  const at = (e: ThreeEvent<PointerEvent | MouseEvent>): readonly [number, number] | null =>
    e.uv ? uvToCanvas(e.uv, pixelWidth, pixelHeight) : null
  const track = (e: ThreeEvent<PointerEvent>, isDown: boolean): void => {
    const point = at(e)
    pointer.current = point && { x: point[0], y: point[1], isDown }
    document.body.style.cursor = point && regionAt(regions.current, point[0], point[1]) ? 'pointer' : 'default'
    lastPaint.current = -1 // answer the pointer at once, not at the next eighth of a second
  }
  return (
    <group {...props} userData={{ seat: 'desk' }}>
      <mesh
        position={[0, 0, 0.003]}
        onPointerMove={(e) => {
          deskPointer.screen = screen
          track(e, pointer.current?.isDown ?? false)
        }}
        onPointerOut={() => {
          deskPointer.screen = null
          pointer.current = null
          document.body.style.cursor = 'auto'
          lastPaint.current = -1
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          track(e, true)
          const point = at(e)
          if (point && regionAt(regions.current, point[0], point[1])) playClick('keyDown')
        }}
        onPointerUp={(e) => track(e, false)}
        onClick={(e) => {
          e.stopPropagation()
          const point = at(e)
          const id = point && regionAt(regions.current, point[0], point[1])
          if (!id) return
          const pressed = pressDesk(desk.get(), sim.get(), id)
          desk.update(() => pressed.ui)
          sim.update(() => pressed.s)
          playClick('keyUp')
          lastPaint.current = -1
        }}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial ref={emission} map={texture} color={SCREEN_GLOW} toneMapped={false} />
      </mesh>
    </group>
  )
}

const SIZE = [0.6, 0.34] as const // m: furniture.py's SCREEN_SIZE

export const MailScreen = (props: ComponentProps<'group'>) => <DeskScreen screen="mail" size={SIZE} paint={paintMail} {...props} />
export const MapScreen = (props: ComponentProps<'group'>) => <DeskScreen screen="map" size={SIZE} paint={paintMap} {...props} />
export const SystemsScreen = (props: ComponentProps<'group'>) => <DeskScreen screen="systems" size={SIZE} paint={paintRight} {...props} />
