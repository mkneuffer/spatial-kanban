import type { ID } from '../data/model'
import type { BoardLayout, ColumnSlot } from './layout'
import { rectContains, type V3 } from './space'

/**
 * Drag state machine (PLAN §6.3), pure and device-agnostic. Positions are in
 * board-local meters: u, v in board space plus z = distance off the surface.
 *
 *   Idle → Pressed → (tap) Detail
 *                  → DragOnBoard ⇄ DragFree → release → commit / park / archive
 */

export const TAP_MAX_MS = 300 // PLAN says 150 ms; pinches on Quest routinely take longer.
export const TAP_MAX_DIST = 0.01
export const TEAR_OFF_DIST = 0.12
export const REATTACH_DIST = 0.06
export const COLUMN_HYSTERESIS = 0.02
export const THROW_SPEED = 1.4 // m/s, downward in world space
export const NEW_CARD_ID = '__new__'

export type PointerKind = 'ray' | 'grab' | 'touch' | 'mouse' | 'screen'
export type DragSource = 'board' | 'pad' | 'free'

export interface DragPoint {
  u: number
  v: number
  z: number
  t: number
}

export type DragPhase = 'idle' | 'pressed' | 'dragOnBoard' | 'dragFree'

export interface DragState {
  phase: DragPhase
  pointerId: number | null
  pointerKind: PointerKind
  cardId: ID | null
  source: DragSource
  start: DragPoint | null
  current: DragPoint | null
  /** Card center minus pointer, so the card doesn't jump to the pointer. */
  grabOffset: [number, number]
  targetColumnId: ID | null
  targetIndex: number | null
  overBin: boolean
  /** Recent points for throw velocity. */
  trail: DragPoint[]
}

export const IDLE: DragState = {
  phase: 'idle',
  pointerId: null,
  pointerKind: 'ray',
  cardId: null,
  source: 'board',
  start: null,
  current: null,
  grabOffset: [0, 0],
  targetColumnId: null,
  targetIndex: null,
  overBin: false,
  trail: [],
}

export type DragEffect =
  | { type: 'haptic'; strength: 'tick' | 'firm' }
  | { type: 'sound'; name: 'pick' | 'drop' | 'tear' | 'stick' | 'archive' | 'tick' }
  | { type: 'commit'; cardId: ID; columnId: ID; index: number }
  | { type: 'create'; columnId: ID; index: number }
  | { type: 'detail'; cardId: ID }
  | { type: 'padTap' }
  | { type: 'archive'; cardId: ID }
  | { type: 'park'; cardId: ID; position: V3 }
  | { type: 'unpark'; cardId: ID }
  | { type: 'cancel' }

export interface DragContext<C = unknown> {
  /** Gap-free layout with the dragged card excluded (for hit testing). */
  layout: BoardLayout<C>
  insertionIndex(layout: BoardLayout<C>, columnId: ID, u: number, v: number): number
  /** World "down" expressed in board-local axes (for throw detection). */
  downLocal: V3
}

export type DragEvent =
  | {
      type: 'down'
      pointerId: number
      pointerKind: PointerKind
      cardId: ID | null
      source: DragSource
      point: DragPoint
      /** Center of the card in board space (u, v) at press time. */
      cardCenter: [number, number]
    }
  | { type: 'move'; pointerId: number; point: DragPoint }
  | { type: 'up'; pointerId: number; point: DragPoint }
  | { type: 'cancel'; pointerId: number }

export interface DragResult {
  state: DragState
  effects: DragEffect[]
}

/** Pointer kinds that report a 3D position and can therefore tear cards off. */
export function canTearOff(kind: PointerKind): boolean {
  return kind === 'grab' || kind === 'touch'
}

/**
 * How far off the board a card dragged along it sits (board-local z, m).
 * - grab (pinch, grip): the card stays in the hand, rising with it until it tears off,
 *   so a direct grab never leaves the card behind on the board.
 * - touch (poke): the card stays just under the fingertip instead of floating in front of it.
 * - ray / mouse / screen: the skin's fixed lift.
 */
export function onBoardDragZ(kind: PointerKind, pointerZ: number, lift: number): number {
  if (kind === 'grab') return Math.min(TEAR_OFF_DIST, Math.max(lift, pointerZ))
  if (kind === 'touch') return Math.min(lift, 0.004)
  return lift
}

/**
 * Target column with hysteresis: keep the previous column until the pointer is
 * more than `hysteresis` outside it, so the target doesn't flicker at edges.
 */
export function pickColumn(columns: ColumnSlot[], u: number, prevId: ID | null, hysteresis = COLUMN_HYSTERESIS): ColumnSlot | null {
  if (columns.length === 0) return null
  if (prevId) {
    const prev = columns.find((c) => c.id === prevId)
    if (prev && u >= prev.rect.x - hysteresis && u <= prev.rect.x + prev.rect.w + hysteresis) return prev
  }
  for (const c of columns) if (u >= c.rect.x && u <= c.rect.x + c.rect.w) return c
  // Gaps between columns: nearest column center.
  let best = columns[0]
  let bestD = Infinity
  for (const c of columns) {
    const d = Math.abs(u - (c.rect.x + c.rect.w / 2))
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

function dist2(a: DragPoint, b: DragPoint): number {
  return Math.hypot(a.u - b.u, a.v - b.v, a.z - b.z)
}

function pushTrail(trail: DragPoint[], p: DragPoint): DragPoint[] {
  const next = [...trail, p].filter((q) => p.t - q.t <= 120)
  return next.length > 12 ? next.slice(-12) : next
}

/** Velocity (m/s) in board-local axes over the recent trail: [du, dv, dz]. */
export function trailVelocity(trail: DragPoint[]): V3 {
  if (trail.length < 2) return [0, 0, 0]
  const a = trail[0]
  const b = trail[trail.length - 1]
  const dt = (b.t - a.t) / 1000
  if (dt <= 0) return [0, 0, 0]
  return [(b.u - a.u) / dt, (b.v - a.v) / dt, (b.z - a.z) / dt]
}

function resolveTarget<C>(state: DragState, ctx: DragContext<C>, p: DragPoint) {
  const { layout } = ctx
  // Card center follows the pointer + grab offset; target from the pointer itself.
  const overBin = state.source !== 'pad' && rectContains(layout.bin, p.u, p.v, 0.01)
  if (overBin) return { targetColumnId: null, targetIndex: null, overBin: true }
  const inside = p.u >= -0.05 && p.u <= layout.size[0] + 0.05 && p.v >= -0.05 && p.v <= layout.size[1] + 0.05
  if (!inside) return { targetColumnId: null, targetIndex: null, overBin: false }
  const col = pickColumn(layout.columns, p.u, state.targetColumnId)
  if (!col) return { targetColumnId: null, targetIndex: null, overBin: false }
  return { targetColumnId: col.id, targetIndex: ctx.insertionIndex(layout, col.id, p.u, p.v), overBin: false }
}

export function dragReducer<C>(state: DragState, event: DragEvent, ctx: DragContext<C>): DragResult {
  const effects: DragEffect[] = []

  if (event.type === 'down') {
    if (state.phase !== 'idle') return { state, effects }
    const p = event.point
    const next: DragState = {
      ...IDLE,
      phase: event.source === 'free' ? 'dragFree' : 'pressed',
      pointerId: event.pointerId,
      pointerKind: event.pointerKind,
      cardId: event.cardId,
      source: event.source,
      start: p,
      current: p,
      grabOffset: [event.cardCenter[0] - p.u, event.cardCenter[1] - p.v],
      trail: [p],
    }
    if (event.source === 'free') {
      effects.push({ type: 'sound', name: 'pick' }, { type: 'haptic', strength: 'tick' })
    }
    return { state: next, effects }
  }

  if (state.phase === 'idle' || event.pointerId !== state.pointerId) return { state, effects }

  if (event.type === 'cancel') {
    return { state: IDLE, effects: [{ type: 'cancel' }] }
  }

  const p = event.point
  const trail = pushTrail(state.trail, p)

  if (event.type === 'move') {
    let next: DragState = { ...state, current: p, trail }
    if (state.phase === 'pressed') {
      if (dist2(p, state.start!) <= TAP_MAX_DIST) return { state: next, effects }
      next = { ...next, phase: 'dragOnBoard' }
      effects.push({ type: 'sound', name: 'pick' }, { type: 'haptic', strength: 'tick' })
    }
    const tearable = canTearOff(state.pointerKind) && state.source !== 'pad'
    if (next.phase === 'dragOnBoard' && tearable && p.z > TEAR_OFF_DIST) {
      next = { ...next, phase: 'dragFree', targetColumnId: null, targetIndex: null, overBin: false }
      effects.push({ type: 'sound', name: 'tear' }, { type: 'haptic', strength: 'firm' })
      return { state: next, effects }
    }
    if (next.phase === 'dragFree') {
      // Ray pointers can't express depth, so a ray drag of a parked card snaps back to the board plane.
      const backOnBoard = !canTearOff(state.pointerKind) || p.z < REATTACH_DIST
      const within = p.u >= 0 && p.u <= ctx.layout.size[0] && p.v >= 0 && p.v <= ctx.layout.size[1]
      if (backOnBoard && within) {
        next = { ...next, phase: 'dragOnBoard' }
        effects.push({ type: 'sound', name: 'stick' }, { type: 'haptic', strength: 'tick' })
      } else {
        return { state: next, effects }
      }
    }
    const target = resolveTarget(next, ctx, p)
    if (target.targetColumnId !== state.targetColumnId || target.overBin !== state.overBin) {
      if (state.targetColumnId !== null || state.overBin || target.targetColumnId !== null) {
        effects.push({ type: 'haptic', strength: 'tick' }, { type: 'sound', name: 'tick' })
      }
    }
    return { state: { ...next, ...target }, effects }
  }

  // event.type === 'up'
  const cardId = state.cardId
  const done = (fx: DragEffect[]): DragResult => ({ state: IDLE, effects: fx })

  if (state.phase === 'pressed') {
    const quick = p.t - state.start!.t <= TAP_MAX_MS && dist2(p, state.start!) <= TAP_MAX_DIST
    if (!quick) return done([{ type: 'cancel' }])
    if (state.source === 'pad') return done([{ type: 'padTap' }])
    return done(cardId ? [{ type: 'detail', cardId }] : [{ type: 'cancel' }])
  }

  if (state.phase === 'dragOnBoard') {
    if (state.overBin && cardId && state.source !== 'pad') {
      return done([
        ...(state.source === 'free' ? [{ type: 'unpark', cardId } as DragEffect] : []),
        { type: 'archive', cardId },
        { type: 'sound', name: 'archive' },
        { type: 'haptic', strength: 'firm' },
      ])
    }
    if (state.targetColumnId !== null && state.targetIndex !== null) {
      const fx: DragEffect[] = [
        { type: 'sound', name: 'drop' },
        { type: 'haptic', strength: 'firm' },
      ]
      if (state.source === 'pad') fx.unshift({ type: 'create', columnId: state.targetColumnId, index: state.targetIndex })
      else if (cardId) {
        if (state.source === 'free') fx.unshift({ type: 'unpark', cardId })
        fx.unshift({ type: 'commit', cardId, columnId: state.targetColumnId, index: state.targetIndex })
      }
      return done(fx)
    }
    return done([{ type: 'cancel' }])
  }

  // dragFree release: throw down to archive, otherwise park where released.
  if (state.phase === 'dragFree' && cardId) {
    const [vu, vv, vz] = trailVelocity(trail)
    // Board space v points down the board; convert to board-local (x, y, z) = (u, -v, z).
    const vel: V3 = [vu, -vv, vz]
    const down = ctx.downLocal
    const downSpeed = vel[0] * down[0] + vel[1] * down[1] + vel[2] * down[2]
    if (downSpeed > THROW_SPEED) {
      return done([
        ...(state.source === 'free' ? [{ type: 'unpark', cardId } as DragEffect] : []),
        { type: 'archive', cardId },
        { type: 'sound', name: 'archive' },
        { type: 'haptic', strength: 'firm' },
      ])
    }
    const [W, H] = ctx.layout.size
    const center: V3 = [p.u + state.grabOffset[0] - W / 2, H / 2 - (p.v + state.grabOffset[1]), p.z]
    return done([
      { type: 'park', cardId, position: center },
      { type: 'sound', name: 'stick' },
      { type: 'haptic', strength: 'firm' },
    ])
  }

  return done([{ type: 'cancel' }])
}
