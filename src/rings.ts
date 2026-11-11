// Saturn's rings, C to A, drawn with the planet in the sky scene: lit by the Sun, in front of the planet where they are,
// hidden by it where they are behind it, and dark in its shadow. Radii, optical depths and albedos: NASA's Saturnian
// Rings Fact Sheet (NSSDC), each band at the middle of its published range (choice). The brightness is a layer of
// isotropic scatterers in single scattering (Chandrasekhar 1960), scaled so that a thick band seen and lit face on
// shows its albedo: I/F = 2A·μ0/(μ0 + μ)·(1 − e^(−τ(1/μ + 1/μ0))) on the lit face, and the diffuse transmission
// 2A·μ0/(μ − μ0)·(e^(−τ/μ) − e^(−τ/μ0)) through to the other. ponytail: the rings' shadow on the planet is left out.
import * as THREE from 'three'

const SATURN_KM = 60_268 // the equatorial radius the fact sheet measures from
/** Bands outwards: [inner edge km, optical depth, albedo], each to the next one's edge; the last edge closes the rings. */
const BANDS: ReadonlyArray<readonly [number, number, number]> = [
  [74_658, 0.1, 0.2], // C: τ 0.05–0.35, albedo 0.12–0.3
  [91_975, 1.5, 0.5], // B: τ 0.4–2.5, albedo 0.4–0.6
  [117_507, 0.05, 0.3], // Cassini division: τ 0–0.1, albedo 0.2–0.4
  [122_340, 0.7, 0.5], // A: τ 0.4–1.0, albedo 0.4–0.6
  [133_250, 0, 0], // the Encke gap about 133 410 km, some 325 km wide (width from memory)
  [133_570, 0.7, 0.5], // A beyond it
  [136_780, 0, 0], // the outer edge of A
]
export const RING_INNER = BANDS[0][0] / SATURN_KM
export const RING_OUTER = BANDS[BANDS.length - 1][0] / SATURN_KM

const VERTEX = /* glsl */ `
uniform vec3 uCentre, uU, uV;
uniform float uRadius;
varying vec2 vLocal;
varying vec3 vPoint;
void main() {
  vLocal = position.xy;
  vPoint = uCentre + uRadius * (position.x * uU + position.y * uV);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * vPoint, 1.);
  gl_Position.z = gl_Position.w * 0.9997;
}`

const FRAGMENT = /* glsl */ `
uniform vec3 uCentre, uU, uV, uSun, uSunTint, uHue;
uniform float uRadius, uRadiance, uExposure;
uniform float uEdge[${BANDS.length}], uTau[${BANDS.length}], uAlbedo[${BANDS.length}];
varying vec2 vLocal;
varying vec3 vPoint;
void main() {
  float r = length(vLocal), tau = 0., A = 0.;
  for (int i = 0; i < ${BANDS.length - 1}; i++) if (r >= uEdge[i] && r < uEdge[i + 1]) { tau = uTau[i]; A = uAlbedo[i]; }
  if (tau <= 0.) discard;
  vec3 u = normalize(vPoint);
  float b = dot(u, uCentre), disc = b * b - dot(uCentre, uCentre) + uRadius * uRadius;
  if (disc > 0. && b - sqrt(disc) < length(vPoint)) discard; // the planet is in front of this part
  vec3 n = normalize(cross(uU, uV));
  float mu = max(abs(dot(n, u)), 1e-3), mu0 = max(abs(dot(n, uSun)), 1e-3);
  bool isLitFace = dot(n, -vPoint) * dot(n, uSun) > 0.;
  float reflected = isLitFace
    ? 2. * A * mu0 / (mu0 + mu) * (1. - exp(-tau * (1. / mu + 1. / mu0)))
    : abs(mu - mu0) < 1e-3 ? 2. * A * tau / mu0 * exp(-tau / mu0) : 2. * A * mu0 / (mu - mu0) * (exp(-tau / mu) - exp(-tau / mu0));
  vec3 q = (vPoint - uCentre) / uRadius;
  float along = dot(q, uSun);
  if (along < 0. && length(q - along * uSun) < 1.) reflected = 0.; // in the planet's shadow
  vec3 c = uHue * uSunTint * uRadiance * reflected * uExposure;
  gl_FragColor = vec4(c * min(1., 3e4 / max(max(c.r, max(c.g, c.b)), 1e-20)), 1. - exp(-tau / mu));
}`

export interface RingUniforms {
  readonly uCentre: THREE.IUniform<THREE.Vector3>
  readonly uRadius: THREE.IUniform<number>
  readonly uU: THREE.IUniform<THREE.Vector3>
  readonly uV: THREE.IUniform<THREE.Vector3>
  readonly uSun: THREE.IUniform<THREE.Vector3>
  readonly uSunTint: THREE.IUniform<THREE.Vector3>
  readonly uHue: THREE.IUniform<THREE.Vector3>
  readonly uRadiance: THREE.IUniform<number>
  readonly uExposure: THREE.IUniform<number>
}

/** The rings as a flat annulus in planet radii, blended over what is behind them by what they let through. */
export function createRings(): { readonly mesh: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>; readonly uniforms: RingUniforms } {
  const uniforms = {
    uCentre: { value: new THREE.Vector3() },
    uRadius: { value: 1 },
    uU: { value: new THREE.Vector3(1, 0, 0) },
    uV: { value: new THREE.Vector3(0, 1, 0) },
    uSun: { value: new THREE.Vector3(0, 0, 1) },
    uSunTint: { value: new THREE.Vector3(1, 1, 1) },
    uHue: { value: new THREE.Vector3(1, 1, 1) },
    uRadiance: { value: 1 },
    uExposure: { value: 1 },
    uEdge: { value: BANDS.map(([km]) => km / SATURN_KM) },
    uTau: { value: BANDS.map(([, tau]) => tau) },
    uAlbedo: { value: BANDS.map(([, , albedo]) => albedo) },
  }
  const mesh = new THREE.Mesh(new THREE.RingGeometry(RING_INNER, RING_OUTER, 256, 1), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }))
  mesh.frustumCulled = false
  return { mesh, uniforms }
}
