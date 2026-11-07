import type { BoardDoc, Card, ID } from '../../data/model'
import {
  columnCards,
  columnSlot,
  layoutFrame,
  scaleFactor,
  wipCount,
  type BoardLayout,
  type CardSlot,
  type ColumnSlot,
  type LayoutInput,
} from '../../board/layout'
import { hash01 } from '../../board/space'
import { wrapText, type TextMeasure } from '../../board/text'
import { initials } from '../projects/layout'
import { toBoard } from '../../board/space'
import type { TrayItem } from '../../board/ink'
import { whiteboardPalette } from './palette'
import { ERASER_SIZE, MARKER_LENGTH, MARKER_RADIUS } from './toolModels'

export interface WhiteboardContent {
  lines: string[]
  textSize: number
  lineH: number
  /** Card-local, from the note's top-left. */
  textY: number
  dots: Array<{ id: ID; letter: string; color: string; x: number; y: number; d: number }>
  who?: { text: string; x: number; y: number; size: number }
  padX: number
}

export function whiteboardMetrics(k: number) {
  return {
    pad: 0.045 * k,
    titleH: 0.08 * k,
    footerH: 0.08 * k,
    gap: 0.02 * k,
    headerH: 0.07 * k,
    bodyInset: 0.004 * k,
    colMargin: 0.012 * k,
    noteGap: 0.012 * k,
    maxNote: 0.125 * k,
    minNote2Up: 0.085 * k,
    notePad: 0.009 * k,
    /** Short titles are written big; long ones shrink down to the minimum before they're cut. */
    textSize: 0.029 * k,
    minTextSize: 0.0135 * k,
    lineH: 1.02,
    headerSize: 0.034 * k,
    boardTitleSize: 0.04 * k,
    dotD: 0.015 * k,
    jitterPos: 0.004 * k,
    jitterRot: (3 * Math.PI) / 180,
  }
}

export type WhiteboardMetrics = ReturnType<typeof whiteboardMetrics>

export function noteContent(card: Card, doc: BoardDoc, s: number, M: WhiteboardMetrics, measure: TextMeasure): WhiteboardContent {
  const innerW = s - 2 * M.notePad
  const labels = card.labelIds.map((id) => doc.board.labels.find((l) => l.id === id)).filter(Boolean)
  const bottomRow = labels.length || card.assignees.length ? M.dotD * 1.35 : 0
  const availH = s - 2 * M.notePad - bottomRow
  const { lines, size } = fitTitle(card.title || '…', innerW, availH, M, measure)
  const lineH = size * M.lineH
  const dots = labels.slice(0, 4).map((l, i) => ({
    id: l!.id,
    letter: l!.name[0]?.toUpperCase() ?? '',
    color: l!.color,
    d: M.dotD,
    x: M.notePad + M.dotD / 2 + i * M.dotD * 1.25,
    y: s - M.notePad - M.dotD / 2,
  }))
  const who = card.assignees.length
    ? {
        text: card.assignees.map((p) => initials(p.name)).join(' '),
        x: s - M.notePad,
        y: s - M.notePad - M.dotD / 2,
        size: M.dotD * 1.45,
      }
    : undefined
  // Centre the block in the space left above the dots, so a short title doesn't hug the top edge.
  const used = (lines.length - 1) * lineH + size * 1.1
  const textY = M.notePad + Math.max(0, (availH - used) / 2) * 0.8
  return { lines, textSize: size, lineH, textY, dots, who, padX: M.notePad }
}

/**
 * The largest handwriting at which the whole title fits the note, like a person
 * who writes smaller when there's more to say. Words are never split across
 * lines unless a single word is wider than the note at the smallest size;
 * only then is the title cut with an ellipsis.
 */
export function fitTitle(title: string, innerW: number, availH: number, M: WhiteboardMetrics, measure: TextMeasure): { lines: string[]; size: number } {
  const words = title.trim().split(/\s+/).join(' ')
  const at = (size: number) => {
    const maxLines = Math.max(1, Math.floor((availH + size * (M.lineH - 1)) / (size * M.lineH)))
    return wrapText(title, innerW, measure, 'Caveat', size, maxLines, 700)
  }
  for (let size = M.textSize; size > M.minTextSize; size *= 0.94) {
    const lines = at(size)
    // Whole words only: an ellipsis or a mid-word break means it doesn't really fit.
    if (lines.join(' ') === words) return { lines, size }
  }
  return { lines: at(M.minTextSize), size: M.minTextSize }
}

/**
 * Marker tray under the board's bottom edge: the tray itself, three markers and
 * an eraser, in board-local 3D coordinates (origin at the board center, y up).
 * Shared by the surface (drawing) and the layout (hit areas), so they always agree.
 */
export function trayGeometry(size: readonly [number, number], k: number) {
  const [W, H] = size
  const d = 0.016 * k // board thickness
  const fw = 0.02 * k // frame width
  const fd = 0.03 * k // frame depth: the frame stands this far proud of the board's back
  const trayW = Math.min(W * 0.5, 0.8)
  const trayH = 0.012 * k // shelf thickness
  const lipD = 0.004 * k
  const lipH = trayH * 0.9 // how far the front lip rises above the shelf
  // The shelf runs from the frame's front face out to the lip, deep enough for the eraser with room to spare.
  const frameFront = -d + fd
  const shelf = 0.064 * k
  const trayD = fd + shelf + lipD // the tray hangs from the board's back, under the frame
  const lipBack = -d + trayD - lipD
  // No two parts may share a face plane, or they z-fight (flicker). So the shelf's top tucks a hair up into
  // the frame bar instead of meeting its bottom face; the shelf stops inside the lip; and the lip is a hair
  // longer and deeper than the shelf, so their ends, fronts and bottoms never line up.
  const tuck = 0.0006 * k
  const trayY = -H / 2 - fw - trayH / 2 + tuck
  const trayTop = trayY + trayH / 2
  const shelfBack = -d + 0.0008 * k // just in front of the board's and frame's back faces
  const shelfFront = lipBack + lipD / 2 // hidden inside the lip
  const shelfBox = { x: 0, y: trayY, z: (shelfBack + shelfFront) / 2, w: trayW, h: trayH, d: shelfFront - shelfBack }
  const lipBottom = trayY - trayH / 2 - 0.0008 * k
  const lipBox = { x: 0, y: (lipBottom + trayTop + lipH) / 2, z: lipBack + lipD / 2, w: trayW + 0.0016 * k, h: trayTop + lipH - lipBottom, d: lipD }
  // Capped markers lie against the lip, clip up; the eraser sits pad-down in the middle of the shelf, beside them.
  const mw = MARKER_LENGTH * k
  const mh = MARKER_RADIUS * 2 * k
  const gap = 0.002 * k
  const mz = lipBack - mh / 2 - gap
  const markers = [0, 1, 2].map((i) => ({ x: -trayW / 2 + trayW * 0.18 + i * 0.16 * k, y: trayTop + mh / 2, z: mz, w: mw, h: mh }))
  const eh = ERASER_SIZE.height * k
  const ed = ERASER_SIZE.h * k
  // The eraser rides half a millimetre up on its felt fibers, so its pad (and the fuzz around it) never meets the shelf's plane.
  const eraserLift = 0.0005 * k
  const eraser = { x: trayW / 2 - 0.08 * k, y: trayTop + eraserLift + eh / 2, z: (frameFront + lipBack) / 2, w: ERASER_SIZE.w * k, h: eh, d: ed, lift: eraserLift }
  // The bottom frame bar, as the surface draws it (for checks against the tray).
  const frameBar = { x: 0, y: -H / 2 - fw / 2, z: -d + fd / 2, w: W + 2 * fw, h: fw, d: fd }
  return { d, fw, fd, trayW, trayH, trayD, trayY, trayTop, lipD, lipH, lipBack, frameFront, markers, eraser, shelfBox, lipBox, frameBar }
}

export const MARKER_IDS = ['black', 'blue', 'red'] as const

/** The tray's markers and eraser as pick-up targets, in board space. */
export function trayItems(size: [number, number], k: number, highContrast = false): TrayItem[] {
  const g = trayGeometry(size, k)
  const p = whiteboardPalette(highContrast)
  const colors = [p.ink, p.blue, p.red]
  // Hit areas are a little taller than the markers so they're easy to point at.
  const rect = (x: number, y: number, w: number, h: number) => {
    const { u, v } = toBoard(x, y, size)
    // Never reach up onto the writing surface: a press there must draw, not grab a marker.
    const top = Math.max(size[1], v - h / 2)
    return { x: u - w / 2, y: top, w, h: v + h / 2 - top }
  }
  return [
    ...g.markers.map((m, i) => ({ id: MARKER_IDS[i], kind: 'marker' as const, color: colors[i], rect: rect(m.x, m.y, m.w, m.h * 1.8), z: m.z, depth: m.h * 1.6 })),
    { id: 'eraser', kind: 'eraser' as const, color: '#2d3748', rect: rect(g.eraser.x, g.eraser.y, g.eraser.w, g.eraser.h * 1.3), z: g.eraser.z, depth: g.eraser.d },
  ]
}

export function noteGrid(colW: number, M: WhiteboardMetrics) {
  const inner = colW - 2 * M.colMargin
  const perRow = inner >= 2 * M.minNote2Up + M.noteGap ? 2 : 1
  const s = Math.min(M.maxNote, (inner - (perRow - 1) * M.noteGap) / perRow)
  return { perRow, s, inner }
}

export function whiteboardLayout({ doc, size, options }: LayoutInput): BoardLayout<WhiteboardContent> {
  const k = scaleFactor(size)
  const M = whiteboardMetrics(k)
  const frame = layoutFrame(doc, size, M, options.mirror)
  const { perRow, s, inner } = noteGrid(frame.colW, M)
  const drag = options.drag
  const columns: ColumnSlot[] = []
  const cards: Record<ID, CardSlot<WhiteboardContent>> = {}
  let placeholder: BoardLayout['placeholder'] = null

  frame.colRects.forEach(({ column, rect }, ci) => {
    const { cards: list, gapIndex } = columnCards(doc, column.id, drag)
    const n = list.length + (gapIndex !== null ? 1 : 0)
    const rows = Math.ceil(n / perRow)
    const bodyH = rect.h - M.headerH - M.bodyInset
    const natural = rows > 0 ? rows * s + (rows - 1) * M.noteGap + 2 * M.colMargin : 0
    // Overflow = stack: rows overlap like a real pile instead of scrolling.
    let step = s + M.noteGap
    if (natural > bodyH && rows > 1) step = Math.max(s * 0.22, (bodyH - 2 * M.colMargin - s) / (rows - 1))
    const slot = columnSlot(column, ci, rect, M.headerH, M.bodyInset, wipCount(doc, column.id, drag), Math.min(natural, bodyH), 0, '#333')
    const gridW = perRow * s + (perRow - 1) * M.noteGap
    const x0 = rect.x + M.colMargin + (inner - gridW) / 2
    const y0 = slot.body.y + M.colMargin
    slot.grid = { perRow, cell: s, step, x0, y0, gap: M.noteGap }
    columns.push(slot)
    let pos = 0
    const cellRect = (at: number) => ({ x: x0 + (at % perRow) * (s + M.noteGap), y: y0 + Math.floor(at / perRow) * step, w: s, h: s })
    if (gapIndex !== null) placeholder = { ...cellRect(gapIndex), columnId: column.id }
    list.forEach((card, i) => {
      if (gapIndex === i) pos++
      const row = Math.floor(pos / perRow)
      const col = pos % perRow
      const jx = (hash01(card.id, 1) - 0.5) * 2 * M.jitterPos
      const jy = (hash01(card.id, 2) - 0.5) * 2 * M.jitterPos
      const rot = card.skinData?.sticky?.rotation ?? (hash01(card.id, 3) - 0.5) * 2 * M.jitterRot
      cards[card.id] = {
        id: card.id,
        columnId: column.id,
        index: i,
        rect: { x: x0 + col * (s + M.noteGap) + jx, y: y0 + row * step + jy, w: s, h: s },
        rotation: rot,
        // Later rows sit on top of earlier ones when stacked.
        z: row * 0.0004 + col * 0.0001,
        clip: [-Infinity, Infinity],
        hidden: false,
        content: noteContent(card, doc, s, M, options.measure),
      }
      pos++
    })
  })

  return {
    skinId: 'whiteboard',
    size,
    k,
    title: frame.title,
    columns,
    columnById: Object.fromEntries(columns.map((c) => [c.id, c])),
    cards,
    pad: frame.pad,
    bin: frame.bin,
    menu: frame.menu,
    handle: frame.handle,
    corner: frame.corner,
    newCardSize: [s, s],
    placeholder,
    tray: trayItems(size, k, options.highContrast),
  }
}

/** Grid insertion in reading order: the note takes the cell under the pointer. */
export function whiteboardInsertionIndex(layout: BoardLayout<WhiteboardContent>, columnId: ID, u: number, v: number): number {
  const col = layout.columnById[columnId]
  if (!col?.grid) return 0
  const { perRow, cell, step, x0, y0, gap } = col.grid
  let n = 0
  for (const id in layout.cards) if (layout.cards[id].columnId === columnId) n++
  const row = Math.max(0, Math.floor((v - y0 + (step - cell) / 2) / step))
  const colIdx = perRow > 1 ? Math.max(0, Math.min(perRow - 1, Math.floor((u - x0 + gap / 2) / (cell + gap)))) : 0
  return Math.max(0, Math.min(n, row * perRow + colIdx))
}
