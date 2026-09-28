import { createContext, useContext } from 'react'
import type { Group } from 'three'
import type { ID } from '../data/model'
import { Animator } from './animator'
import type { BoardLayout, CardSlot } from './layout'
import type { TextMeasure } from './text'
import type { BoardFX } from './fx'

/**
 * Mutable per-board runtime shared by the board's 3D components. Stable
 * identity; fields are updated in place so per-frame code never re-renders.
 */
export interface BoardRuntime {
  animator: Animator
  /** Last known slot per card — used for cards currently outside the layout (dragged, leaving). */
  slotCache: Map<ID, CardSlot>
  /** Size of the card being dragged, captured on pick-up. */
  dragSize: [number, number] | null
  root: Group | null
  size: [number, number]
  /** Level of detail: true when the board is far away (PLAN §12 LOD). */
  far: boolean
  /** Board opacity (tracking loss fades to 50%). */
  opacity: number
  measure: TextMeasure
  /** Latest gap-free layout for hit testing. */
  baseLayout: BoardLayout | null
  interactive: boolean
  /** Card under each pointer (pointerId → card id). Several pointers can hover at once. */
  hoverCards: Map<number, ID>
  /** Column body under each pointer, with the XR input source behind it (thumbstick scrolling). */
  hoverColumns: Map<number, { columnId: ID; source: XRInputSource | null }>
  /** Particle effects (no-ops until <BoardEffects> mounts, and under reduced motion). */
  fx: BoardFX
}

const noFX: BoardFX = { land() {}, lift() {}, celebrate() {}, archive() {}, spawn() {}, sweep() {} }

export function createRuntime(measure: TextMeasure): BoardRuntime {
  return {
    animator: new Animator(),
    slotCache: new Map(),
    dragSize: null,
    root: null,
    size: [1.6, 1],
    far: false,
    opacity: 1,
    measure,
    baseLayout: null,
    interactive: true,
    hoverCards: new Map(),
    hoverColumns: new Map(),
    fx: noFX,
  }
}

export const BoardRuntimeContext = createContext<BoardRuntime | null>(null)

export function useBoardRuntime(): BoardRuntime {
  const r = useContext(BoardRuntimeContext)
  if (!r) throw new Error('useBoardRuntime must be used inside <BoardContent>')
  return r
}
