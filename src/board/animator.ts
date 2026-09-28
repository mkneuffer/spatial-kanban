import type { SpringConfig } from '../skins/types'

/**
 * Per-card spring animation, integrated outside React in useFrame (PLAN §12).
 * Springs make card motion physical: the view animates toward whatever the
 * layout + drag state say, so drops, reorders and skin morphs all fall out of
 * the same mechanism.
 */

export const ANIM_KEYS = ['x', 'y', 'z', 'w', 'h', 'rot', 'scale', 'curl'] as const
export type AnimKey = (typeof ANIM_KEYS)[number]
export type AnimTarget = Record<AnimKey, number>

export interface CardAnim extends AnimTarget {
  v: AnimTarget
  initialized: boolean
  /** Performance.now() when this card last had a target (for leave animations). */
  seen: number
}

const zero = (): AnimTarget => ({ x: 0, y: 0, z: 0, w: 0, h: 0, rot: 0, scale: 0, curl: 0 })

export class Animator {
  private anims = new Map<string, CardAnim>()

  get(id: string): CardAnim {
    let a = this.anims.get(id)
    if (!a) {
      a = { ...zero(), scale: 1, v: zero(), initialized: false, seen: 0 }
      this.anims.set(id, a)
    }
    return a
  }

  peek(id: string): CardAnim | undefined {
    return this.anims.get(id)
  }

  delete(id: string) {
    this.anims.delete(id)
  }

  keys() {
    return this.anims.keys()
  }

  /** Nudge a value's velocity (squash on drop, bounce on create). */
  kick(id: string, key: AnimKey, velocity: number) {
    const a = this.anims.get(id)
    if (a) a.v[key] += velocity
  }

  /** Snap to target without animation (first appearance, reduced motion). */
  snap(a: CardAnim, t: AnimTarget) {
    for (const k of ANIM_KEYS) {
      a[k] = t[k]
      a.v[k] = 0
    }
    a.initialized = true
  }

  step(a: CardAnim, t: AnimTarget, spring: SpringConfig, dt: number, reduced: boolean, now: number) {
    a.seen = now
    if (!a.initialized || reduced) {
      this.snap(a, t)
      return
    }
    stepSpring(a, t, spring, dt)
  }
}

export function stepSpring(a: AnimTarget & { v: AnimTarget }, t: AnimTarget, spring: SpringConfig, dt: number) {
  const total = Math.min(dt, 1 / 20)
  const n = Math.max(1, Math.ceil(total / (1 / 240)))
  const h = total / n
  const { stiffness: k, damping: c } = spring
  for (let i = 0; i < n; i++) {
    for (const key of ANIM_KEYS) {
      const x = a[key]
      const v = a.v[key]
      const acc = -k * (x - t[key]) - c * v
      const nv = v + acc * h
      a.v[key] = nv
      a[key] = x + nv * h
    }
  }
}

/** Shortest signed angle difference, for rotation targets. */
export function angleDelta(a: number, b: number) {
  let d = b - a
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}
