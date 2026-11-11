import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { shieldHeight } from './cabinLogic'
import type { CabinLight } from './Cockpit'
import { sim } from './sim'

// The canopy, in two pieces of one curved glass: the windshield ahead of the bow, and the rest. The sky is drawn
// behind the whole scene, so the glass only adds what glass adds. Inside it, the blast shields rise from the sills.

/** Stencil values that tell the glass apart; 0 is everything else. The indicators are drawn on the windshield only. */
export const WINDSHIELD_STENCIL = 4
const CANOPY_STENCIL = 5

export const ADD_LIGHT_ONLY = {
  transparent: true,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor, // the alpha of the frame still says that this is sky, not hull
} as const

const GLASS_VERTEX = /* glsl */ `
varying vec2 vPlace;
varying vec3 vNormalView, vToEye;
varying float vLit;
uniform vec3 uLight;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.);
  vPlace = world.xz + .7 * world.y;
  vec4 view = viewMatrix * world;
  vNormalView = normalMatrix * normal;
  vToEye = -view.xyz;
  // The eye sits at the origin, inside a canopy convex around it, so the outer face is the one turned away from it.
  // Light reaches only that face: the hull shades the inner one.
  vec3 normalWorld = normalize(mat3(modelMatrix) * normal);
  vec3 outward = dot(normalWorld, world.xyz) > 0. ? normalWorld : -normalWorld;
  vLit = max(0., dot(outward, uLight));
  gl_Position = projectionMatrix * view;
}`

// What separates the pilot from the void: a faint reflection of the cabin, stronger at grazing angles
// (Schlick's Fresnel for n = 1.5) and only as bright as the cabin is lit, and grime that lights up when a bright
// source outside, the Sun or the blueshifted CMB, falls on the glass.
const GLASS_FRAGMENT = /* glsl */ `
varying vec2 vPlace;
varying vec3 vNormalView, vToEye;
varying float vLit;
uniform float uScatter, uCabinGlow;
uniform vec3 uTint;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
void main() {
  float facing = abs(dot(normalize(vNormalView), normalize(vToEye)));
  float fresnel = .04 + .96 * pow(1. - facing, 5.);
  float grime = .55 * noise(vPlace * 5.) + .3 * noise(vPlace * 13. + 3.1) + .15 * noise(vPlace * 31. + 7.7);
  // Glass that the light reaches at a grazing angle catches little of it.
  float lit = uScatter * vLit * vLit;
  vec3 c = vec3(.03, .04, .06) * fresnel * uCabinGlow + uTint * lit * (.0012 + .004 * grime * grime);
  gl_FragColor = vec4(c, 1.);
}`

/** What the glass reflects of a dark cabin, as a share of a lit one. */
const DARK_CABIN_GLOW = 0.1

export interface CanopyGlass {
  readonly windshield: THREE.ShaderMaterial
  readonly canopy: THREE.ShaderMaterial
}

/** The two glass materials, kept in step with the light outside and the cabin lights. */
export function useCanopyGlass(light: RefObject<CabinLight>): CanopyGlass {
  const uniforms = useMemo(() => ({
    uScatter: { value: 0 }, uCabinGlow: { value: DARK_CABIN_GLOW },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uLight: { value: new THREE.Vector3(0, 0, -1) },
  }), [])
  const glass = useMemo(() => {
    const make = (stencil: number): THREE.ShaderMaterial => new THREE.ShaderMaterial({
      uniforms,
      vertexShader: GLASS_VERTEX,
      fragmentShader: GLASS_FRAGMENT,
      ...ADD_LIGHT_ONLY,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
      stencilWrite: true,
      stencilRef: stencil,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    })
    return { windshield: make(WINDSHIELD_STENCIL), canopy: make(CANOPY_STENCIL) }
  }, [uniforms])
  useEffect(() => () => {
    glass.windshield.dispose()
    glass.canopy.dispose()
  }, [glass])
  useFrame(() => {
    uniforms.uCabinGlow.value = DARK_CABIN_GLOW + (1 - DARK_CABIN_GLOW) * sim.get().lights
    const { exposure, illuminance, tint, direction } = light.current
    uniforms.uScatter.value = Math.min(exposure * illuminance, 40)
    uniforms.uTint.value.copy(tint)
    uniforms.uLight.value.copy(direction)
  })
  return glass
}

// The shields lie on the glass itself, drawn in front of it: set in from it, they leave a slit along the wall that the
// head, turning off the eye's point, sees the sky through.
const SHIELD_DEPTH_OFFSET = -2

/**
 * The blast shields that replace the shutters: they rise out of the sills up the inside of the glass, both sides at
 * once, until they meet over the crown. Drawn as the glass itself, cut off above the height they have reached.
 */
export function BlastShields({ glass }: { readonly glass: readonly THREE.Mesh[] }) {
  const { gl } = useThree()
  const group = useRef<THREE.Group>(null!)
  const lastClosure = useRef(-1)
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#3b3f45', roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: SHIELD_DEPTH_OFFSET, polygonOffsetUnits: SHIELD_DEPTH_OFFSET,
    clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)],
    clipShadows: true, // half-raised shields shade only as far as they have risen
  }), [])
  useEffect(() => {
    gl.localClippingEnabled = true
    return () => material.dispose()
  }, [gl, material])
  useFrame(() => {
    const closure = sim.get().shutters
    group.current.visible = closure > 0.001
    material.clippingPlanes![0].constant = shieldHeight(closure)
    // The shadows are drawn once for a still cabin, so moving shields have to ask for them to be drawn again.
    if (closure !== lastClosure.current) {
      lastClosure.current = closure
      gl.shadowMap.needsUpdate = true
    }
  })
  // Each piece sits where the model puts its glass.
  return (
    <group ref={group} visible={false}>
      {glass.map((mesh) => (
        <mesh key={mesh.uuid} geometry={mesh.geometry} material={material} matrixAutoUpdate={false} matrix={mesh.matrixWorld} castShadow receiveShadow />
      ))}
    </group>
  )
}
