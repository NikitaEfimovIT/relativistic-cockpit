import * as THREE from 'three'

// The dust within 1.25 kpc of the Sun as it was measured: the 3D map of Edenhofer et al. 2024 (A&A 685, A82; CC BY
// 4.0; Zenodo 10.5281/zenodo.10658339), made from the reddening of tens of millions of Gaia stars at known distances.
// Inside its 0.5° cells, the structure Planck saw in the dust's glow at 5′ (Planck Collaboration Int. XLVIII 2016,
// A&A 596, A109). scripts/build-dust-map.py resamples both onto the grids below; galaxyBake.ts marches through them.

/** The grid the build script writes and the bake shader is compiled for. */
export const DUST_GRID = {
  longitudes: 720, // texture x: galactic l in 0.5° cells from 0°
  latitudes: 360, // y: galactic b from −90°
  shells: 48, // z: what lies within innerPc, then shells log-spaced out to outerPc
  innerPc: 68.619,
  outerPc: 1248.1,
  logMin: -3, // log10 of A_V per kpc at code 0 and at code 255
  logMax: 3.5,
} as const

/** The structure finer than a cell: a factor on the dust, by direction from the Sun, about 1 on average over a cell. */
export const FINE_GRID = {
  longitudes: 4320, // texture x: galactic l in 5′ pixels from 0°
  latitudes: 2160, // y: galactic b from −90°
  logMin: -0.5, // log10 of the factor at code 0 and at code 255; code 128 is exactly 1
  logMax: 0.49609375,
} as const

export interface DustMap {
  readonly volume: THREE.Data3DTexture
  /** Null when its file did not load: the dust within 1.25 kpc is then as smooth as its 0.5° cells. */
  readonly fine: THREE.DataTexture | null
}

const FILES = `${import.meta.env.BASE_URL}dust/edenhofer2024`
const FINE_FILES = `${import.meta.env.BASE_URL}dust/planck2016`

/** The bytes, unless the files hold something other than exactly the grid the shader expects. */
function checked(what: string, grid: object, meta: unknown, bytes: ArrayBuffer, size: number): Uint8Array {
  const fields = (typeof meta === 'object' && meta !== null ? meta : {}) as Record<string, unknown>
  const wrong = Object.entries(grid).filter(([key, value]) => fields[key] !== value).map(([key]) => key)
  if (wrong.length > 0) throw new Error(`The ${what}'s ${wrong.join(', ')} differ from the grid the sky is built for`)
  if (bytes.byteLength !== size) throw new Error(`The ${what} has ${bytes.byteLength} bytes, not ${size}`)
  return new Uint8Array(bytes)
}

/** Log codes, interpolated by the GPU, round in longitude and clamped at the poles. */
function asCodes<T extends THREE.DataTexture | THREE.Data3DTexture>(texture: T): T {
  texture.format = THREE.RedFormat
  texture.type = THREE.UnsignedByteType
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  if (texture instanceof THREE.Data3DTexture) texture.wrapR = THREE.ClampToEdgeWrapping
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

/** The grid as a texture of log-coded A_V per kpc. */
export function parseDustMap(meta: unknown, bytes: ArrayBuffer): THREE.Data3DTexture {
  const { longitudes, latitudes, shells } = DUST_GRID
  const codes = checked('dust map', DUST_GRID, meta, bytes, longitudes * latitudes * shells)
  return asCodes(new THREE.Data3DTexture(codes, longitudes, latitudes, shells))
}

/** The structure finer than a cell as a texture of log-coded factors. */
export function parseFineDust(meta: unknown, bytes: ArrayBuffer): THREE.DataTexture {
  const { longitudes, latitudes } = FINE_GRID
  // ponytail: one 4320-texel-wide texture; a GPU allowing less than that would want it cut in two
  return asCodes(new THREE.DataTexture(checked('fine dust map', FINE_GRID, meta, bytes, longitudes * latitudes), longitudes, latitudes))
}

const fetchOk = async (url: string): Promise<Response> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

const load = (file: string): Promise<[unknown, ArrayBuffer]> => Promise.all([
  fetchOk(`${file}.json`).then((response) => response.json() as Promise<unknown>),
  fetchOk(`${file}.bin`).then((response) => response.arrayBuffer()),
])

/** 22 MB from public/dust. */
export async function loadDustMap(): Promise<DustMap> {
  const fine = load(FINE_FILES).then(([meta, bytes]) => parseFineDust(meta, bytes)).catch((error: unknown) => {
    console.warn('The fine dust map did not load; the dust within 1.25 kpc stays as smooth as its 0.5° cells.', error)
    return null
  })
  const [meta, bytes] = await load(FILES)
  return { volume: parseDustMap(meta, bytes), fine: await fine }
}
