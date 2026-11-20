import { expect, test } from 'vitest'
import { FINISHES, finishOf } from './wear'

// The app's tsconfig carries no Node types: see audio.test.ts.
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as { readonly readFileSync: (path: string) => Uint8Array }

/** The names of the materials in a binary glTF: its first chunk is the JSON. */
function materialNames(path: string): readonly string[] {
  const file = readFileSync(path)
  const length = new DataView(file.buffer, file.byteOffset).getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(file.subarray(20, 20 + length))) as { readonly materials: readonly { readonly name: string }[] }
  return json.materials.map((material) => material.name)
}

test('every material of the cockpit model has a decision: a finish, or to be left as modelled', () => {
  const undecided = materialNames('public/cockpit.glb').filter((name) => !(name in FINISHES))

  expect(undecided).toEqual([])
})

test('what glows, what is glass and what the app repaints each frame is left as modelled', () => {
  for (const name of ['light_line', 'lamp_off', 'lamp_amber', 'legend_backlit', 'canopy_glass', 'guard_red_glass', 'screen_glass']) {
    expect(finishOf(name, 'anything')).toBeNull()
  }
})

test('a material the table does not know is left as modelled', () => {
  expect(finishOf('no_such_material', 'vault_quarters')).toBeNull()
})

test('the shell and the deck are built of panels with seams between them; the furniture is not', () => {
  expect(finishOf('white_composite', 'vault_quarters')?.seams).toBeDefined()
  expect(finishOf('white_composite', 'wall_left')?.seams).toBeDefined()
  expect(finishOf('graphite', 'floor')?.seams).toBeDefined()

  expect(finishOf('white_composite', 'couch_shell')?.seams).toBeUndefined()
  expect(finishOf('graphite', 'panel_centre')?.seams).toBeUndefined()
})

test('the wall panels are counted from the cockpit door: a seam falls on it and on the first frame aft', () => {
  const seams = finishOf('white_composite', 'vault_quarters')?.seams
  const [pitch, offset] = [seams?.pitch[2] ?? 0, seams?.offset[2] ?? 0]

  for (const frame of [1.35, 4.95]) expect(((frame - offset) / pitch) % 1).toBeCloseTo(0, 6) // the next frame, at 8.95, lies between two seams
})

test('the mattress and the seat cushions are quilted: threads are too fine to see from across the bay, stitching is not', () => {
  for (const part of ['bed_mattress', 'couch_seat', 'couch_back', 'chair_seat']) expect(finishOf('cushion', part)?.seams).toBeDefined()

  expect(finishOf('cushion', 'couch_headrest')?.seams).toBeUndefined()
})

test('cloth is woven, not scratched; and a finish rides with its part, so that a drawer keeps its marks as it slides', () => {
  expect(finishOf('cushion', 'bed_mattress')?.sheet).toBe('weave')
  expect(finishOf('satin_metal', 'drawer_bed_1_handle')?.sheet ?? 'wear').toBe('wear')
  expect(finishOf('white_composite', 'drawer_bed_1_front')?.rides).toBe(true)
})
