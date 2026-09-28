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
    notePad: 0.01 * k,
    textSize: 0.025 * k,
    minTextSize: 0.0185 * k,
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
  const bottomRow = labels.length || card.assignees.length ? M.dotD * 1.6 : 0
  const availH = s - 2 * M.notePad - bottomRow
  // Write smaller when the title is long, like a person would.
  let size = M.textSize
  let lines: string[] = []
  for (;;) {
    const lineH = size * 1.08
    const maxLines = Math.max(1, Math.floor(availH / lineH))
    lines = wrapText(card.title || '…', innerW, measure, 'Caveat', size, maxLines, 700)
    const complete = !lines[lines.length - 1]?.endsWith('…')
    if (complete || size <= M.minTextSize) break
    size = Math.max(M.minTextSize, size * 0.9)
  }
  const lineH = size * 1.08
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
  return { lines, textSize: size, lineH, textY: M.notePad, dots, who, padX: M.notePad }
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
