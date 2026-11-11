import * as THREE from 'three'

// What metal reflects, and the fill of the lit cabin. A blurred sketch of the cabin as seen from the seat: dark walls,
// the glow of the instruments and the strips under the sills. It is a look, not a measurement, and it is baked once.
// Nothing overhead glows in it, and no windows: the sky is black, and what does shine in from outside, the Sun or the
// CMB, is a light of its own that the shields can shade. It is on only with the cabin lights.

type Glow = readonly [number, number, number]
const INSTRUMENTS: Glow = [1.5, 0.8, 0.32]
const STRIP: Glow = [1.6, 2.6, 4.2]

const panel = (color: Glow, width: number, height: number, position: readonly [number, number, number]): THREE.Mesh => {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(...color), side: THREE.DoubleSide, toneMapped: false }),
  )
  mesh.position.set(...position)
  mesh.lookAt(0, 0, 0)
  return mesh
}

export function bakeCabinEnvironment(gl: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const room = new THREE.Scene()
  room.add(
    new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.007, 0.01), side: THREE.BackSide })),
    panel(INSTRUMENTS, 1.6, 0.3, [0, -0.45, -0.85]),
    panel(STRIP, 1.2, 0.04, [-1.4, -0.5, -0.6]),
    panel(STRIP, 1.2, 0.04, [1.4, -0.5, -0.6]),
    panel(STRIP, 1.2, 0.04, [-1.6, -0.45, 0.2]),
    panel(STRIP, 1.2, 0.04, [1.6, -0.45, 0.2]),
  )
  const generator = new THREE.PMREMGenerator(gl)
  const baked = generator.fromScene(room, 0.015, 0.1, 20)
  generator.dispose()
  room.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose()
      ;(node.material as THREE.Material).dispose()
    }
  })
  return baked
}
