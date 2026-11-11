/** The keys and the gaze of a body that can leave its seat: what App's input handlers call, kept out of App.tsx. */

import { aimOf, flipSwitch, isSwitchOn, use } from './aboard'
import { playClick } from './audio'
import { SEATS } from './cockpitLayout'
import { sim } from './sim'
import { body, initialBody, isDrawerOpen, promptFor, standUp, type Target, type Vec3, type WalkKeys } from './walk'

export interface Look {
  readonly yaw: number
  readonly pitch: number
  readonly zoom: number
}
export interface LookRef {
  current: Look
}

/** Seated, the eyes rest a little below the horizon, on the instruments. */
export const RESTING_PITCH = -0.16

const STILL: WalkKeys = { forward: false, back: false, left: false, right: false }
const WALK_CODES: Readonly<Record<string, keyof WalkKeys>> = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right' }

let keys: WalkKeys = STILL
let aim: Target | null = null

export const walkKeys = (): WalkKeys => keys
export const currentAim = (): Target | null => aim
export const releaseAllWalkKeys = (): void => {
  keys = STILL
}
export const releaseWalkKey = (code: string): void => {
  const key = WALK_CODES[code]
  if (key) keys = { ...keys, [key]: false }
}

/** Take the mouse for looking around. A browser may refuse (no gesture, a recent Esc): dragging still turns the head. */
export function capture(canvas: HTMLElement): void {
  Promise.resolve(canvas.requestPointerLock()).catch(() => undefined)
}

/** Each frame: note what the eye is on, and say what E would do to it, if anything. */
export function lookAt(direction: Vec3): string | null {
  aim = aimOf(body.get(), direction)
  if (!aim) return null
  const isActive = aim.kind === 'drawer' ? isDrawerOpen(body.get(), aim.id) : aim.kind === 'switch' && isSwitchOn(sim.get(), aim.id)
  return promptFor(aim.kind, isActive)
}

/** Up from a seat: the head keeps looking where it looked, now turned by the whole body. */
function stand(look: LookRef, canvas: HTMLElement): void {
  const seat = body.get().seat
  if (!seat) return
  body.update((b) => standUp(b, SEATS[seat].exit))
  look.current = { ...look.current, yaw: look.current.yaw + SEATS[seat].yaw, pitch: look.current.pitch + RESTING_PITCH / look.current.zoom }
  capture(canvas)
}

function settle(look: LookRef): void {
  look.current = { ...look.current, yaw: 0, pitch: 0 }
  keys = STILL
  if (document.pointerLockElement) document.exitPointerLock()
}

/** E on what the eye is on: a seat is sat in, a drawer slides, a switch flips its system. */
function act(look: LookRef): void {
  const target = aim
  if (!target) return
  if (target.kind === 'switch') {
    sim.update((s) => flipSwitch(s, target.id))
    playClick('switch')
    return
  }
  body.update((b) => use(b, target))
  if (target.kind === 'seat') settle(look)
}

/**
 * A key going down. True when the body took it and the cockpit's own keys must not see it:
 * those work from the pilot couch only.
 */
export function pressAboardKey(e: KeyboardEvent, look: LookRef, canvas: HTMLElement): boolean {
  const seat = body.get().seat
  if (e.code === 'KeyR') {
    body.update(() => initialBody())
    settle(look)
    return false // the voyage starts over too
  }
  if (seat) {
    if (e.code !== 'Space') return seat !== 'pilot'
    e.preventDefault()
    if (!e.repeat) stand(look, canvas)
    return true
  }
  const walkKey = WALK_CODES[e.code]
  if (walkKey) keys = { ...keys, [walkKey]: true }
  if (e.code === 'KeyE' && !e.repeat) act(look)
  if (e.code === 'Space') e.preventDefault()
  return true
}
