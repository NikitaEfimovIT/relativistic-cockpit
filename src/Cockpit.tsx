import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { CockpitModel } from './CockpitModel'
import { bakeCabinEnvironment } from './environment'
import { Hud } from './Hud'
import { LooseObjects } from './LooseObjects'
import { sim } from './sim'

RectAreaLightUniformsLib.init()

/** The brightest light coming in from outside: the blueshifted CMB ahead, or the Sun, or a star being approached. */
export interface CabinLight {
  readonly exposure: number
  readonly illuminance: number // lx
  readonly tint: THREE.Vector3
  readonly direction: THREE.Vector3 // unit, towards the source, ship axes
}

function CabinEnvironment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const baked = bakeCabinEnvironment(gl)
    scene.environment = baked.texture
    return () => {
      scene.environment = null
      baked.dispose()
    }
  }, [gl, scene])
  return null
}

const LIT_ENVIRONMENT = 2.2 // the sketch of the lit cabin, only while the cabin lights are on
const STARLIGHT = 0.16
const SHADOW_MAP_SIZE = 2048

const LIGHT_DISTANCE = 20 // m, where the shadow camera sits on the way to the source: past the whole ship
// The box the shadows are drawn in: from the panel to the aft wall. Outside it three leaves the sun unshadowed, which
// would light the compartments through their walls. ponytail: one 2048² map over 14.4 m, 7 mm a texel; cascades if
// the cockpit's shadows look soft.
const SHADOW_CENTRE = new THREE.Vector3(0, 0, 5.8)
const SHADOW_HALF = 7.2 // m
const SHADOW_REDRAW_RAD = 0.004 // the shadows are baked, so they are redrawn only when the light has really moved

// The cabin lights: over the desks either side of the seat, under the hood of the panel, and one under the crown of
// each compartment (engineering, living, science), where the strips on the ribs are. With them off, only the screens,
// the lamps and the light through the glass and the portholes are left; the blast shields shut out the glass.
const SILL_LIGHTS: ReadonlyArray<readonly [number, number, number]> = [[-0.9, -0.3, -0.2], [0.9, -0.3, -0.2]]
const SILL_LIGHT = 0.28
// A panel along the crown, lighting down only: a point light there burns a spot into the ceiling a hand above it.
const CROWN_LIGHTS: ReadonlyArray<readonly [number, number, number]> = [[0, 0.84, 3.15], [0, 0.84, 6.95], [0, 0.84, 10.75]]
const CROWN_PANEL = [0.3, 2.4] as const // m across and along the ship
const CROWN_LIGHT = 8 // nit; with the panel's 0.72 m², about 1.5 lux on the deck 2 m under it
const HOOD_WASH = 0.3

function CabinLights({ light }: { readonly light: RefObject<CabinLight> }) {
  const { scene, gl } = useThree()
  const shadowFrom = useMemo(() => new THREE.Vector3(), []) // zero, so that the first frame places the light and its target
  const cmbLight = useRef<THREE.DirectionalLight>(null!)
  const bounce = useRef<THREE.AmbientLight>(null!)
  const ambient = useRef<THREE.AmbientLight>(null!)
  const starlight = useRef<THREE.DirectionalLight>(null!)
  const sills = useRef<Array<THREE.PointLight | null>>([])
  const crowns = useRef<Array<THREE.RectAreaLight | null>>([])
  const hood = useRef<THREE.PointLight>(null!)
  useFrame(() => {
    const { exposure, illuminance, tint, direction } = light.current
    const { lights, shutters } = sim.get()
    // three's Lambert radiance is albedo/π · intensity, so exposure·E is the physical light level.
    const level = exposure * illuminance
    if (direction.angleTo(shadowFrom) > SHADOW_REDRAW_RAD) {
      shadowFrom.copy(direction)
      // straight up or down the default up vector of the shadow camera is degenerate, so nudge it
      cmbLight.current.position.copy(direction).setX(direction.x + (Math.abs(direction.y) > 0.999 ? 1e-3 : 0)).multiplyScalar(LIGHT_DISTANCE).add(SHADOW_CENTRE)
      cmbLight.current.target.position.copy(SHADOW_CENTRE)
      cmbLight.current.target.updateMatrixWorld() // the target is not in the scene, so nothing else updates it
      cmbLight.current.shadow.camera.updateProjectionMatrix() // its bounds are set as props, which do not redo the projection
      gl.shadowMap.needsUpdate = true
    }
    cmbLight.current.intensity = level
    cmbLight.current.color.setRGB(tint.x, tint.y, tint.z)
    bounce.current.intensity = 0.15 * level // ponytail: one bounce off the rear bulkhead, no real GI
    bounce.current.color.setRGB(tint.x, tint.y, tint.z)
    scene.environmentIntensity = LIT_ENVIRONMENT * lights
    ambient.current.intensity = 0.5 * lights
    starlight.current.intensity = STARLIGHT * (1 - shutters) // ponytail: the shields' share of the glass taken as their travel
    sills.current.forEach((sill) => { if (sill) sill.intensity = SILL_LIGHT * lights })
    crowns.current.forEach((crown) => { if (crown) crown.intensity = CROWN_LIGHT * lights })
    hood.current.intensity = HOOD_WASH * lights
  })
  return (
    <>
      <ambientLight ref={ambient} intensity={0} color="#8ea6cc" />
      {SILL_LIGHTS.map((position, i) => (
        <pointLight key={i} ref={(made) => { sills.current[i] = made }} position={position} intensity={0} color="#d9ecff" decay={2} />
      ))}
      {CROWN_LIGHTS.map((position, i) => (
        <rectAreaLight key={i} ref={(made) => { crowns.current[i] = made }} position={position} rotation={[-Math.PI / 2, 0, 0]}
          width={CROWN_PANEL[0]} height={CROWN_PANEL[1]} intensity={0} color="#e6f0ff" />
      ))}
      <pointLight ref={hood} position={[0, -0.22, -0.82]} intensity={0} color="#ffcfa0" decay={2} />
      {/* Starlight through the canopy */}
      <directionalLight ref={starlight} position={[0.2, 0.5, -1]} intensity={STARLIGHT} color="#a9c4ff" />
      {/* The brightest source outside is small on the sky, so the frame throws hard shadows into the cabin */}
      <directionalLight
        ref={cmbLight}
        position={[0, 0, -LIGHT_DISTANCE]}
        intensity={0}
        castShadow
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-camera-left={-SHADOW_HALF}
        shadow-camera-right={SHADOW_HALF}
        shadow-camera-top={SHADOW_HALF}
        shadow-camera-bottom={-SHADOW_HALF}
        shadow-camera-near={1}
        shadow-camera-far={2 * LIGHT_DISTANCE}
        shadow-bias={-0.0006}
        shadow-normalBias={0.012}
        shadow-radius={2.5}
      />
      <ambientLight ref={bounce} intensity={0} />
    </>
  )
}

/** The cabin hardly moves, so its shadows are drawn once, after the model is in, and not on every frame. */
function BakedShadows() {
  const { gl, scene } = useThree()
  useEffect(() => {
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh && !(node instanceof THREE.InstancedMesh) && node.material instanceof THREE.MeshStandardMaterial) {
        node.castShadow = true
        node.receiveShadow = true
      }
    })
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
  }, [gl, scene])
  return null
}

export interface CockpitProps {
  readonly rearImage: THREE.Texture
  readonly light: RefObject<CabinLight>
}

export function Cockpit({ rearImage, light }: CockpitProps) {
  return (
    <>
      <CabinEnvironment />
      <CabinLights light={light} />
      <Suspense fallback={null}>
        <CockpitModel rearImage={rearImage} light={light} />
        <LooseObjects />
        <BakedShadows />
      </Suspense>
      <Hud />
    </>
  )
}
