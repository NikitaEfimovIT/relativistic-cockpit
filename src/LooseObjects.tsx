import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FOB_ANCHOR, FOB_BRACKET } from './cockpitLayout'
import { apparentGravity, stepTether, type Tether, type Vec3 } from './loose'
import { G0 } from './physics'
import { properAcceleration, sim } from './sim'
import { TRIM } from './wear'

// A tritium fob on a short cord: the only thing in the cabin that is not bolted down.
// It tells you what the ship is doing before any gauge does.

/** Under the canopy's bow, left of the line of sight; the bracket comes down from the bow to the cord. */
const ANCHOR: Vec3 = FOB_ANCHOR
const BRACKET_FOOT: Vec3 = FOB_BRACKET
const CORD_LENGTH = 0.16
const CORD_POINTS = 14
const ENGINE_SHAKE = 1.6 // m/s² at full thrust
const BREEZE = 0.035 // m/s², what the ventilation does to a fob in free fall
const FOB_GLOW = new THREE.Color(0.2, 1.05, 0.42)

const hasMotion = (): boolean => !window.matchMedia('(prefers-reduced-motion: reduce)').matches

function Fob() {
  const fob = useRef<THREE.Group>(null!)
  const tether = useRef<Tether>({ position: [0.04, -0.05, 0.03], velocity: [0.01, 0.02, -0.01] })
  const isMoving = useMemo(hasMotion, [])
  const cord = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CORD_POINTS * 3), 3))
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#39404a' }))
  }, [])
  useEffect(() => () => {
    cord.geometry.dispose()
    ;(cord.material as THREE.Material).dispose()
  }, [cord])
  const bracket = useMemo(() => {
    const foot = new THREE.Vector3(...BRACKET_FOOT)
    const anchor = new THREE.Vector3(...ANCHOR)
    return {
      position: foot.clone().add(anchor).multiplyScalar(0.5),
      length: foot.distanceTo(anchor),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), anchor.clone().sub(foot).normalize()),
    }
  }, [])
  const down = useMemo(() => new THREE.Vector3(), [])
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), [])

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05)
    const s = sim.get()
    const a = properAcceleration(s)
    const shake = isMoving ? ENGINE_SHAKE * Math.abs(a / G0) : 0
    const breeze = isMoving ? BREEZE : 0
    const time = clock.elapsedTime
    const [gx, gy, gz] = apparentGravity(a)
    const push: Vec3 = [
      gx + breeze * Math.sin(time * 0.31) + shake * (Math.random() - 0.5),
      gy + breeze * Math.sin(time * 0.23 + 1) + shake * (Math.random() - 0.5),
      gz + breeze * Math.sin(time * 0.19 + 2) + shake * (Math.random() - 0.5),
    ]
    tether.current = stepTether(tether.current, CORD_LENGTH, push, dt)
    const [x, y, z] = tether.current.position
    fob.current.position.set(ANCHOR[0] + x, ANCHOR[1] + y, ANCHOR[2] + z)
    down.set(x, y, z)
    const distance = down.length()
    if (distance > 1e-4) fob.current.quaternion.setFromUnitVectors(yAxis, down.divideScalar(distance).negate())

    // The cord is a shallow curve: slack in free fall, straight once it carries the weight.
    const slack = Math.sqrt(Math.max(0, CORD_LENGTH * CORD_LENGTH - distance * distance)) * 0.5
    const positions = cord.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < CORD_POINTS; i++) {
      const t = i / (CORD_POINTS - 1)
      const bow = 4 * t * (1 - t) * slack
      positions.setXYZ(i, ANCHOR[0] + x * t + bow * 0.6, ANCHOR[1] + y * t - bow * 0.8, ANCHOR[2] + z * t)
    }
    positions.needsUpdate = true
  })

  return (
    <>
      <mesh material={TRIM} position={bracket.position} quaternion={bracket.quaternion}>
        <cylinderGeometry args={[0.006, 0.008, bracket.length, 8]} />
      </mesh>
      <primitive object={cord} frustumCulled={false} />
      <group ref={fob}>
        <mesh material={TRIM} position={[0, 0.019, 0]}>
          <torusGeometry args={[0.005, 0.0013, 8, 16]} />
        </mesh>
        <mesh material={TRIM}>
          <capsuleGeometry args={[0.0062, 0.021, 4, 10]} />
        </mesh>
        {/* The vial of tritium runs through it, so that it glows whichever way it has turned */}
        <mesh>
          <cylinderGeometry args={[0.0066, 0.0066, 0.017, 10]} />
          <meshBasicMaterial color={FOB_GLOW} toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

export const LooseObjects = Fob
