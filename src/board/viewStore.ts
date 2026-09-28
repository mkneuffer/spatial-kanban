import { create } from 'zustand'
import type { ID } from '../data/model'
import { IDLE, type DragState } from './drag'

export type ViewMode = '2d' | '3d' | 'xr'

export interface SkinSwitch {
  from: string
  to: string
  start: number
}

export interface ColumnDrag {
  columnId: ID
  pointerId: number
  targetIndex: number
  u: number
}

export interface ViewState {
  mode: ViewMode
  drag: DragState
  columnDrag: ColumnDrag | null
  hoverCardId: ID | null
  hoverColumnId: ID | null
  /** Card whose detail panel/drawer is open. */
  detailCardId: ID | null
  /** Card whose title is being edited (XR keyboard / voice, or the 2D drawer). */
  editCardId: ID | null
  /** True when the card being edited was just created (empty title → delete on cancel). */
  editIsNew: boolean
  scroll: Record<ID, number>
  skinSwitch: SkinSwitch | null
  /** Bumped when measurement fonts finish loading so layouts re-measure. */
  fontsVersion: number
  /** Cards just archived, animating into the bin. */
  leaving: Record<ID, number>
  set(changes: Partial<Omit<ViewState, 'set'>>): void
  setScroll(columnId: ID, value: number): void
}

export const SKIN_SWITCH_MS = 700

export const useView = create<ViewState>()((set) => ({
  mode: '2d',
  drag: IDLE,
  columnDrag: null,
  hoverCardId: null,
  hoverColumnId: null,
  detailCardId: null,
  editCardId: null,
  editIsNew: false,
  scroll: {},
  skinSwitch: null,
  fontsVersion: 0,
  leaving: {},
  set: (changes) => set(changes),
  setScroll: (columnId, value) => set((s) => ({ scroll: { ...s.scroll, [columnId]: value } })),
}))
