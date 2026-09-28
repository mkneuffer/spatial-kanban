import type { BoardDoc, Card, Column, ID } from '../data/model'
import { cardsInColumn } from '../data/ordering'
import type { Rect } from './space'
import type { TextMeasure } from './text'

/**
 * Layout engine types (PLAN §8). Everything is in board space (meters, origin
 * top-left, v down). Layouts are pure functions of (doc, size, options).
 */

export interface CardSlot<C = unknown> {
  id: ID
  columnId: ID
  index: number
  /** Rect in board space, with the column scroll applied. */
  rect: Rect
  /** Rotation about the board normal, radians (sticky jitter). */
  rotation: number
  /** Extra stacking offset along the normal, meters. */
  z: number
  /** Visible (vertical) clip range in board space: [top, bottom]. */
  clip: [number, number]
  /** Fully outside the column viewport — skip rendering. */
  hidden: boolean
  /** Skin-specific content layout (text lines, chip positions, …). */
  content: C
}

export interface ColumnSlot {
  id: ID
  index: number
  title: string
  color: string
  rect: Rect
  header: Rect
  /** Viewport the cards live in. */
  body: Rect
  count: number
  wipLimit?: number
  overLimit: boolean
  atLimit: boolean
  contentHeight: number
  scroll: number
  maxScroll: number
  /** Grid geometry for skins that lay cards out in cells (whiteboard). */
  grid?: { perRow: number; cell: number; step: number; x0: number; y0: number; gap: number }
}

export interface BoardLayout<C = unknown> {
  skinId: string
  size: [number, number]
  /** Scale factor relative to the 1.6 m "poster" design size. */
  k: number
  title: Rect
  columns: ColumnSlot[]
  columnById: Record<ID, ColumnSlot>
  cards: Record<ID, CardSlot<C>>
  /** Blank-card pad (create), done bin (archive), menu button — all inside the board. */
  pad: Rect
  bin: Rect
  menu: Rect
  /** Handle bar under the board (move) and bottom-corner resize handle — outside the board. */
  handle: Rect
  corner: Rect
  /** Size of a freshly created card in this skin (for the pad ghost). */
  newCardSize: [number, number]
  /** Where the dragged card will land (drop indicator), if it has a target. */
  placeholder: (Rect & { columnId: ID }) | null
}

export interface DragGap {
  /** Card being dragged (excluded from its column). null for a new card from the pad. */
  cardId: ID | null
  /** Where the placeholder gap goes; omitted while the card is off-target. */
  columnId?: ID
  index?: number
  /** Height of the gap to open (meters). */
  height?: number
}

export interface LayoutOptions {
  measure: TextMeasure
  scroll?: Record<ID, number>
  /** Left-hand mode mirrors pad, bin and menu (PLAN §13). */
  mirror?: boolean
  drag?: DragGap
  highContrast?: boolean
}

export interface LayoutInput {
  doc: BoardDoc
  size: [number, number]
  options: LayoutOptions
}

export const POSTER_WIDTH = 1.6
export const POSTER_HEIGHT = 1.0

export function scaleFactor(size: readonly [number, number]): number {
  return Math.max(0.2, Math.min(size[0] / POSTER_WIDTH, size[1] / POSTER_HEIGHT))
}

/** Column geometry shared by both skins: evenly split columns under a title bar. */
export function layoutFrame(
  doc: BoardDoc,
  size: [number, number],
  p: { pad: number; titleH: number; footerH: number; gap: number; headerH: number; bodyInset: number },
  mirror = false,
) {
  const [W, H] = size
  const cols = doc.board.columnIds.map((id) => doc.columns[id]).filter(Boolean) as Column[]
  const n = Math.max(1, cols.length)
  const top = p.pad + p.titleH
  const bottom = H - p.pad - p.footerH
  const colW = (W - 2 * p.pad - (n - 1) * p.gap) / n
  const colRects = cols.map((c, i) => ({
    column: c,
    rect: { x: p.pad + i * (colW + p.gap), y: top, w: colW, h: bottom - top },
  }))
  const title: Rect = { x: p.pad, y: p.pad, w: W - 2 * p.pad, h: p.titleH }
  const footerY = H - p.pad - p.footerH + p.gap * 0.5
  const footerH = p.footerH - p.gap * 0.5
  const tool = Math.min(footerH * 1.9, W * 0.2)
  const padRect: Rect = { x: mirror ? p.pad : W - p.pad - tool, y: footerY, w: tool, h: footerH }
  const binRect: Rect = { x: mirror ? W - p.pad - tool : p.pad, y: footerY, w: tool, h: footerH }
  const menuSize = p.titleH * 0.8
  const menu: Rect = {
    x: mirror ? p.pad : W - p.pad - menuSize,
    y: p.pad + (p.titleH - menuSize) / 2,
    w: menuSize,
    h: menuSize,
  }
  const handleW = Math.min(0.32, W * 0.3)
  const handleH = Math.max(0.028, 0.035 * scaleFactor(size))
  // Below the frame and the whiteboard's marker tray.
  const handle: Rect = { x: (W - handleW) / 2, y: H + Math.max(0.05, 0.085 * scaleFactor(size)), w: handleW, h: handleH }
  const cs = Math.max(0.05, 0.06 * scaleFactor(size))
  const corner: Rect = mirror ? { x: -cs * 0.6, y: H - cs * 0.4, w: cs, h: cs } : { x: W - cs * 0.4, y: H - cs * 0.4, w: cs, h: cs }
  return { cols, colRects, title, pad: padRect, bin: binRect, menu, handle, corner, colW, top, bottom }
}

export function columnSlot(
  column: Column,
  index: number,
  rect: Rect,
  headerH: number,
  bodyInset: number,
  count: number,
  contentHeight: number,
  requestedScroll: number,
  fallbackColor: string,
): ColumnSlot {
  const header: Rect = { x: rect.x, y: rect.y, w: rect.w, h: headerH }
  const body: Rect = { x: rect.x, y: rect.y + headerH, w: rect.w, h: Math.max(0, rect.h - headerH - bodyInset) }
  const maxScroll = Math.max(0, contentHeight - body.h)
  const scroll = Math.max(0, Math.min(requestedScroll, maxScroll))
  const limit = column.wipLimit
  return {
    id: column.id,
    index,
    title: column.title,
    color: column.color ?? fallbackColor,
    rect,
    header,
    body,
    count,
    wipLimit: limit,
    atLimit: limit !== undefined && count >= limit,
    overLimit: limit !== undefined && count > limit,
    contentHeight,
    scroll,
    maxScroll,
  }
}

/**
 * Cards of a column in render order, with the dragged card removed and an
 * optional placeholder gap. Returns `{ cards, gapIndex }`.
 */
export function columnCards(doc: BoardDoc, columnId: ID, drag?: DragGap): { cards: Card[]; gapIndex: number | null } {
  const cards = cardsInColumn(doc.cards, columnId, drag?.cardId ?? undefined)
  const gapIndex = drag && drag.columnId === columnId && drag.index !== undefined ? Math.min(drag.index, cards.length) : null
  return { cards, gapIndex }
}

/** Card count for WIP purposes: includes the card being dropped in. */
export function wipCount(doc: BoardDoc, columnId: ID, drag?: DragGap): number {
  const { cards, gapIndex } = columnCards(doc, columnId, drag)
  const draggedFromHere = drag?.cardId && doc.cards[drag.cardId]?.columnId === columnId
  // While the card has a target, only the target counts it; with no target it still belongs to its source.
  const untargeted = drag?.columnId === undefined
  return cards.length + (gapIndex !== null ? 1 : 0) + (untargeted && draggedFromHere ? 1 : 0)
}
