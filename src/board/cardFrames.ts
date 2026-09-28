import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ID } from '../data/model'
import { useBoardStore } from '../data/store'
import { usePlacements } from '../data/placements'
import { useSettings } from '../data/settings'
import type { SkinMotion } from '../skins/types'
import type { CardAnim, AnimTarget } from './animator'
import { NEW_CARD_ID, trailVelocity } from './drag'
import type { BoardLayout, CardSlot } from './layout'
import { useBoardRuntime } from './runtime'
import { toLocal } from './space'
import { SKIN_SWITCH_MS, useView } from './viewStore'

export type CardKind = 'slot' | 'drag' | 'parked' | 'leaving' | 'new'

export interface CardFrame<C> {
  id: ID
  slot: CardSlot<C>
  a: CardAnim
  kind: CardKind
  /** Horizontal squash while flipping between skins (1 = flat-on). */
  sx: number
  /** 0..1 — how far the card is lifted (drives shadow blur and strength). */
  lift: number
  hovered: boolean
  selected: boolean
  /** Board-local vertical clip range, or ±Infinity. */
  clipMin: number
  clipMax: number
  /** Card sits partially outside its column viewport. */
  clipped: boolean
}

export interface CardDrawer<C> {
  begin(): void
  card(f: CardFrame<C>): void
  end(): void
  /** Called when the set of rendered cards or their content changes. */
  content(frames: ReadonlyArray<{ id: ID; slot: CardSlot<C>; kind: CardKind }>): void
}

const FLIP_MS = 360
const LEAVE_MS = 420

/**
 * Shared per-frame card driver for skins. Computes each card's target from the
 * layout and transient drag state, steps its spring, and hands the result to the
 * skin's drawer. Runs entirely outside React state.
 */
export function useCardFrames<C>(
  layout: BoardLayout<C>,
  role: 'only' | 'from' | 'to',
  motion: SkinMotion,
  drawer: CardDrawer<C>,
  newCardSlot: () => CardSlot<C>,
) {
  const runtime = useBoardRuntime()
  const cache = useRef(new Map<ID, CardSlot<C>>())
  const lastKind = useRef(new Map<ID, CardKind>())
  const contentKey = useRef('')
  const lastLayout = useRef<BoardLayout<C> | null>(null)
  const target: AnimTarget = { x: 0, y: 0, z: 0, w: 0, h: 0, rot: 0, scale: 1, curl: 0 }

  useFrame((_, dt) => {
    const now = performance.now()
    const view = useView.getState()
    const { drag, skinSwitch, detailCardId, leaving } = view
    const hoverCards = runtime.hoverCards
    const free = usePlacements.getState().freeCards
    const cards = useBoardStore.getState().doc.cards
    const reduced = useSettings.getState().reducedMotion
    const { animator } = runtime
    const [W, H] = layout.size
    const k = layout.k
    const stepping = role !== 'from'

    for (const id in layout.cards) cache.current.set(id, layout.cards[id])

    // Which cards render this frame, and as what.
    const list: Array<{ id: ID; slot: CardSlot<C>; kind: CardKind }> = []
    const dragging = drag.phase === 'dragOnBoard' || drag.phase === 'dragFree'
    const dragId = dragging ? (drag.source === 'pad' ? NEW_CARD_ID : drag.cardId) : null
    for (const id in layout.cards) {
      if (id === dragId || free[id] || leaving[id]) continue
      list.push({ id, slot: layout.cards[id], kind: 'slot' })
    }
    for (const id in free) {
      if (id === dragId || !cards[id] || cards[id].archived) continue
      const slot = cache.current.get(id)
      if (slot) list.push({ id, slot, kind: 'parked' })
    }
    for (const id in leaving) {
      const slot = cache.current.get(id)
      if (slot) list.push({ id, slot, kind: 'leaving' })
    }
    if (dragId === NEW_CARD_ID) list.push({ id: NEW_CARD_ID, slot: newCardSlot(), kind: 'new' })
    else if (dragId) {
      const slot = cache.current.get(dragId)
      if (slot) list.push({ id: dragId, slot, kind: 'drag' })
    }

    const key = list.map((e) => e.id + e.kind).join('|')
    if (key !== contentKey.current || layout !== lastLayout.current) {
      contentKey.current = key
      lastLayout.current = layout
      drawer.content(list)
    }

    const velocity = dragging ? trailVelocity(drag.trail) : [0, 0, 0]
    const liftScale = Math.max(0.5, k)

    drawer.begin()
    for (const entry of list) {
      const { id, slot, kind } = entry
      const a = animator.get(id)
      const r = slot.rect
      let lift = 0
      let clipMin = -Infinity
      let clipMax = Infinity
      const hovered = drag.phase === 'idle' && isHovered(hoverCards, id)

      if (kind === 'slot') {
        const [cx, cy] = toLocal(r.x + r.w / 2, r.y + r.h / 2, [W, H])
        const pressed = drag.phase === 'pressed' && drag.cardId === id
        target.x = cx
        target.y = cy
        target.z = slot.z + (hovered ? 0.003 * liftScale : 0)
        target.w = r.w
        target.h = r.h
        target.rot = slot.rotation
        target.scale = pressed ? 0.985 : hovered ? 1.015 : 1
        target.curl = hovered && motion.peel ? 0.12 : 0
        lift = hovered ? 0.25 : 0
        clipMax = H / 2 - slot.clip[0]
        clipMin = H / 2 - slot.clip[1]
      } else if (kind === 'drag' || kind === 'new') {
        const p = drag.current!
        const [cx, cy] = toLocal(p.u + drag.grabOffset[0], p.v + drag.grabOffset[1], [W, H])
        const size = kind === 'new' ? layout.newCardSize : runtime.dragSize ?? [r.w, r.h]
        const free3d = drag.phase === 'dragFree'
        target.x = cx
        target.y = cy
        target.z = free3d ? p.z : motion.liftHeight * liftScale
        target.w = size[0]
        target.h = size[1]
        const tilt = Math.max(-0.3, Math.min(0.3, -velocity[0] * motion.dragTilt))
        target.rot = (free3d ? 0 : slot.rotation * 0.5) + tilt
        target.scale = motion.dragScale
        target.curl = motion.peel ? 1 : 0
        lift = 1
      } else if (kind === 'parked') {
        const pos = free[id].localOffset.position
        target.x = pos[0]
        target.y = pos[1]
        target.z = pos[2]
        target.w = r.w
        target.h = r.h
        target.rot = 0
        target.scale = hovered ? 1.03 : 1
        target.curl = motion.peel ? 0.25 : 0
        lift = 0.6
      } else {
        // leaving → fly into the bin
        const b = layout.bin
        const [bx, by] = toLocal(b.x + b.w / 2, b.y + b.h / 2, [W, H])
        const t = Math.min(1, (now - leaving[id]) / LEAVE_MS)
        target.x = bx
        target.y = by
        target.z = 0.02 * liftScale * (1 - t)
        target.w = r.w
        target.h = r.h
        target.rot = slot.rotation + 0.6
        target.scale = Math.max(0.05, 0.35 * (1 - t))
        target.curl = 0
        lift = 0.5 * (1 - t)
      }

      if (stepping) {
        const prev = lastKind.current.get(id)
        animator.step(a, target, motion.spring, dt, reduced, now)
        if (prev && prev !== 'slot' && prev !== 'leaving' && kind === 'slot' && motion.squash && !reduced) {
          animator.kick(id, 'scale', -1.6)
        }
        lastKind.current.set(id, kind)
      }

      let sx = 1
      if (skinSwitch && role !== 'only' && !reduced) {
        const delay = ((a.x + W / 2) / Math.max(W, 0.01)) * (SKIN_SWITCH_MS - FLIP_MS)
        const p = Math.max(0, Math.min(1, (now - skinSwitch.start - delay) / FLIP_MS))
        if (role === 'from' && p >= 0.5) continue
        if (role === 'to' && p < 0.5) continue
        sx = Math.max(0.02, Math.abs(Math.cos(Math.PI * p)))
      }

      const clipped = kind === 'slot' && (r.y < slot.clip[0] || r.y + r.h > slot.clip[1])
      drawer.card({ id, slot, a, kind, sx, lift, hovered, selected: detailCardId === id, clipMin, clipMax, clipped })
    }
    drawer.end()
  })
}

function isHovered(hover: ReadonlyMap<number, ID>, id: ID): boolean {
  for (const v of hover.values()) if (v === id) return true
  return false
}

/** Transform a card-local point (from the card's top-left, y down) to board-local 3D. */
export function cardPoint(f: { a: CardAnim; slot: CardSlot<unknown>; sx: number }, cx: number, cy: number): [number, number] {
  const { a, slot } = f
  const ox = (cx - slot.rect.w / 2) * f.sx * a.scale
  const oy = (slot.rect.h / 2 - cy) * a.scale
  const c = Math.cos(a.rot)
  const s = Math.sin(a.rot)
  return [a.x + ox * c - oy * s, a.y + ox * s + oy * c]
}
