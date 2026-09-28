import { cardRef, type BoardDoc, type Card, type ID } from '../../data/model'
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
import { ellipsize, wrapText, type TextMeasure } from '../../board/text'

/** Card-local content layout, measured from the card's top-left corner (m). */
export interface ProjectsContent {
  ref: string
  refX: number
  refY: number
  refSize: number
  iconX: number
  iconY: number
  iconD: number
  lines: string[]
  titleY: number
  titleSize: number
  lineH: number
  pills: Array<{ id: ID; text: string; color: string; x: number; y: number; w: number; h: number; textSize: number }>
  avatars: Array<{ id: string; initials: string; color: string; x: number; y: number; d: number }>
  due?: { text: string; x: number; y: number; size: number; overdue: boolean }
  padX: number
}

export function projectsMetrics(k: number) {
  return {
    pad: 0.03 * k,
    titleH: 0.075 * k,
    footerH: 0.072 * k,
    gap: 0.014 * k,
    headerH: 0.058 * k,
    bodyInset: 0.008 * k,
    colMargin: 0.01 * k,
    cardPad: 0.012 * k,
    cardGap: 0.01 * k,
    refSize: 0.0112 * k,
    titleSize: 0.0165 * k,
    lineH: 0.0165 * k * 1.3,
    pillH: 0.02 * k,
    pillText: 0.0096 * k,
    pillPadX: 0.0075 * k,
    avatarD: 0.02 * k,
    dueSize: 0.0102 * k,
    headerSize: 0.0165 * k,
    boardTitleSize: 0.026 * k,
    radius: 0.008 * k,
  }
}

export type ProjectsMetrics = ReturnType<typeof projectsMetrics>

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDue(date: string, today = new Date()): { text: string; overdue: boolean } {
  const [y, m, d] = date.split('-').map(Number)
  const due = new Date(y, (m ?? 1) - 1, d ?? 1)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((due.getTime() - start.getTime()) / 86_400_000)
  const label = days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due ${MONTHS[due.getMonth()]} ${due.getDate()}`
  return { text: label, overdue: days < 0 }
}

export function projectsCardContent(card: Card, doc: BoardDoc, width: number, M: ProjectsMetrics, measure: TextMeasure): { content: ProjectsContent; height: number } {
  const innerW = width - 2 * M.cardPad
  const refRowH = Math.max(M.refSize * 1.4, M.avatarD)
  const iconD = M.refSize * 1.05
  const avatars = card.assignees.slice(0, 3).map((p, i, arr) => ({
    id: p.id,
    initials: initials(p.name),
    color: p.color ?? '#6e7781',
    d: M.avatarD,
    x: width - M.cardPad - M.avatarD / 2 - (arr.length - 1 - i) * M.avatarD * 0.7,
    y: M.cardPad + refRowH / 2,
  }))
  const ref = cardRef(card)

  const lines = wrapText(card.title || 'Untitled', innerW, measure, 'Inter', M.titleSize, 3, 500)
  const titleY = M.cardPad + refRowH + 0.006 * (M.titleSize / 0.0165)
  let y = titleY + Math.max(1, lines.length) * M.lineH

  const pills: ProjectsContent['pills'] = []
  const labels = card.labelIds.map((id) => doc.board.labels.find((l) => l.id === id)).filter(Boolean)
  if (labels.length) {
    y += M.pillH * 0.35
    let x = M.cardPad
    let rowY = y
    let rows = 1
    for (const l of labels) {
      const text = ellipsize(l!.name, innerW - 2 * M.pillPadX, measure, 'Inter', M.pillText, 500)
      const w = measure(text, 'Inter', M.pillText, 500) + 2 * M.pillPadX
      if (x + w > width - M.cardPad && x > M.cardPad) {
        if (rows >= 2) break
        rows++
        x = M.cardPad
        rowY += M.pillH + M.pillH * 0.25
      }
      pills.push({ id: l!.id, text, color: l!.color, x, y: rowY, w, h: M.pillH, textSize: M.pillText })
      x += w + M.pillH * 0.3
    }
    y = rowY + M.pillH
  }

  let due: ProjectsContent['due']
  if (card.dueDate) {
    const f = formatDue(card.dueDate)
    y += M.dueSize * 0.6
    due = { text: f.text, overdue: f.overdue, x: M.cardPad, y, size: M.dueSize }
    y += M.dueSize * 1.3
  }

  const height = y + M.cardPad
  return {
    height,
    content: {
      ref,
      refX: M.cardPad + iconD + M.refSize * 0.45,
      refY: M.cardPad + refRowH / 2,
      refSize: M.refSize,
      iconX: M.cardPad + iconD / 2,
      iconY: M.cardPad + refRowH / 2,
      iconD,
      lines,
      titleY,
      titleSize: M.titleSize,
      lineH: M.lineH,
      pills,
      avatars,
      due,
      padX: M.cardPad,
    },
  }
}

export function projectsLayout({ doc, size, options }: LayoutInput): BoardLayout<ProjectsContent> {
  const k = scaleFactor(size)
  const M = projectsMetrics(k)
  const frame = layoutFrame(doc, size, M, options.mirror)
  const drag = options.drag
  const columns: ColumnSlot[] = []
  const cards: Record<ID, CardSlot<ProjectsContent>> = {}
  const cardW = frame.colW - 2 * M.colMargin
  let placeholder: BoardLayout['placeholder'] = null

  frame.colRects.forEach(({ column, rect }, ci) => {
    const { cards: list, gapIndex } = columnCards(doc, column.id, drag)
    const measured = list.map((c) => ({ card: c, ...projectsCardContent(c, doc, cardW, M, options.measure) }))
    const gapH = drag?.height ?? 0.08 * k
    let contentHeight = M.colMargin
    measured.forEach((m, i) => {
      if (gapIndex === i) contentHeight += gapH + M.cardGap
      contentHeight += m.height + M.cardGap
    })
    if (gapIndex !== null && gapIndex >= measured.length) contentHeight += gapH + M.cardGap
    contentHeight += M.colMargin - M.cardGap

    const slot = columnSlot(
      column,
      ci,
      rect,
      M.headerH,
      M.bodyInset,
      wipCount(doc, column.id, drag),
      contentHeight,
      options.scroll?.[column.id] ?? 0,
      '#8b949e',
    )
    columns.push(slot)

    const clip: [number, number] = [slot.body.y, slot.body.y + slot.body.h]
    let y = slot.body.y + M.colMargin - slot.scroll
    const markGap = () => {
      placeholder = { x: rect.x + M.colMargin, y, w: cardW, h: gapH, columnId: column.id }
      y += gapH + M.cardGap
    }
    measured.forEach((m, i) => {
      if (gapIndex === i) markGap()
      const r = { x: rect.x + M.colMargin, y, w: cardW, h: m.height }
      cards[m.card.id] = {
        id: m.card.id,
        columnId: column.id,
        index: i,
        rect: r,
        rotation: 0,
        z: 0,
        clip,
        hidden: r.y > clip[1] || r.y + r.h < clip[0],
        content: m.content,
      }
      y += m.height + M.cardGap
    })
    if (gapIndex !== null && gapIndex >= measured.length) markGap()
  })

  return {
    skinId: 'projects',
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
    newCardSize: [cardW, 0.075 * k],
    placeholder,
  }
}

/** Vertical list: insertion index = number of cards whose midpoint is above the pointer. */
export function projectsInsertionIndex(layout: BoardLayout<ProjectsContent>, columnId: ID, _u: number, v: number): number {
  let index = 0
  for (const id in layout.cards) {
    const s = layout.cards[id]
    if (s.columnId === columnId && s.rect.y + s.rect.h / 2 < v) index++
  }
  return index
}
