import { describe, expect, it } from 'vitest'
import { createDemoBoard } from '../../src/data/seed'
import { cardsInColumn } from '../../src/data/ordering'
import { projectsLayout, projectsInsertionIndex } from '../../src/skins/projects/layout'
import { whiteboardLayout, whiteboardInsertionIndex } from '../../src/skins/whiteboard/layout'
import { approximateMeasure, wrapText } from '../../src/board/text'
import type { LayoutInput } from '../../src/board/layout'

const doc = createDemoBoard(new Date('2026-09-28T12:00:00Z'))
const input = (extra: Partial<LayoutInput['options']> = {}, size: [number, number] = [1.6, 1]): LayoutInput => ({
  doc,
  size,
  options: { measure: approximateMeasure, ...extra },
})

describe.each([
  ['projects', projectsLayout],
  ['whiteboard', whiteboardLayout],
] as const)('%s layout', (_name, layout) => {
  it('lays out every column inside the board, left to right', () => {
    const L = layout(input())
    expect(L.columns.map((c) => c.id)).toEqual(doc.board.columnIds)
    for (const c of L.columns) {
      expect(c.rect.x).toBeGreaterThanOrEqual(0)
      expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(1.6 + 1e-9)
      expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(1 + 1e-9)
    }
    for (let i = 1; i < L.columns.length; i++) expect(L.columns[i].rect.x).toBeGreaterThan(L.columns[i - 1].rect.x + L.columns[i - 1].rect.w)
  })

  it('places each live card inside its column', () => {
    const L = layout(input())
    const live = Object.values(doc.cards).filter((c) => !c.archived)
    expect(Object.keys(L.cards).length).toBe(live.length)
    for (const slot of Object.values(L.cards)) {
      const col = L.columnById[slot.columnId]
      expect(slot.rect.x).toBeGreaterThanOrEqual(col.rect.x - 0.01)
      expect(slot.rect.x + slot.rect.w).toBeLessThanOrEqual(col.rect.x + col.rect.w + 0.01)
    }
  })

  it('excludes the dragged card and opens a gap', () => {
    const col = doc.board.columnIds[1]
    const [first, second] = cardsInColumn(doc.cards, col)
    const base = layout(input())
    const L = layout(input({ drag: { cardId: first.id, columnId: col, index: 0, height: 0.1 } }))
    expect(L.cards[first.id]).toBeUndefined()
    // The second card now occupies index 0 but sits below the gap.
    expect(L.cards[second.id].index).toBe(0)
    const moved = L.cards[second.id].rect
    const gap = base.cards[first.id].rect
    expect(moved.x > gap.x + 0.01 || moved.y > gap.y + 0.01).toBe(true)
  })

  it('is deterministic (seeded jitter is stable)', () => {
    expect(layout(input())).toEqual(layout(input()))
  })

  it('scales down for a desk-size board', () => {
    const poster = layout(input())
    const desk = layout(input({}, [0.6, 0.4]))
    expect(desk.k).toBeLessThan(poster.k)
    const id = Object.keys(poster.cards)[0]
    expect(desk.cards[id].rect.w).toBeLessThan(poster.cards[id].rect.w)
  })

  it('mirrors pad and bin in left-hand mode', () => {
    const L = layout(input())
    const M = layout(input({ mirror: true }))
    expect(L.pad.x).toBeGreaterThan(L.bin.x)
    expect(M.pad.x).toBeLessThan(M.bin.x)
  })
})

describe('projects specifics', () => {
  it('counts WIP including the card being dropped in', () => {
    const [src, , wip] = doc.board.columnIds
    const card = cardsInColumn(doc.cards, src)[0]
    const base = projectsLayout(input())
    const L = projectsLayout(input({ drag: { cardId: card.id, columnId: wip, index: 0 } }))
    expect(L.columnById[wip].count).toBe(base.columnById[wip].count + 1)
    expect(L.columnById[src].count).toBe(base.columnById[src].count - 1)
    expect(L.columnById[wip].overLimit).toBe(true)
  })

  it('computes insertion index from card midpoints', () => {
    const col = doc.board.columnIds[0]
    const L = projectsLayout(input())
    const slots = cardsInColumn(doc.cards, col).map((c) => L.cards[c.id])
    expect(projectsInsertionIndex(L, col, 0, slots[0].rect.y)).toBe(0)
    expect(projectsInsertionIndex(L, col, 0, slots[1].rect.y + slots[1].rect.h * 0.9)).toBe(2)
    expect(projectsInsertionIndex(L, col, 0, 5)).toBe(slots.length)
  })

  it('clamps scroll to the overflow', () => {
    const big = createDemoBoard()
    const col = big.board.columnIds[0]
    const [template] = cardsInColumn(big.cards, col)
    for (let i = 0; i < 12; i++) big.cards[`x${i}`] = { ...template, id: `x${i}`, orderKey: `z${i}` }
    const L = projectsLayout({ doc: big, size: [1.6, 1], options: { measure: approximateMeasure, scroll: { [col]: 99 } } })
    const c = L.columnById[col]
    expect(c.scroll).toBe(c.maxScroll)
    expect(c.maxScroll).toBeGreaterThan(0)
  })

  it('clamps titles to three lines', () => {
    const long = 'word '.repeat(80)
    const lines = wrapText(long, 0.2, approximateMeasure, 'Inter', 0.0165, 3)
    expect(lines.length).toBe(3)
    expect(lines[2].endsWith('…')).toBe(true)
  })
})

describe('whiteboard specifics', () => {
  it('jitters notes by at most ±3°', () => {
    const L = whiteboardLayout(input())
    for (const s of Object.values(L.cards)) expect(Math.abs(s.rotation)).toBeLessThanOrEqual((3 * Math.PI) / 180 + 1e-9)
  })

  it('stacks instead of overflowing a short column', () => {
    const L = whiteboardLayout(input({}, [1.6, 0.45]))
    for (const s of Object.values(L.cards)) {
      const col = L.columnById[s.columnId]
      expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(col.body.y + col.body.h + 0.02)
    }
  })

  it('computes grid insertion in reading order', () => {
    const col = doc.board.columnIds[0]
    const L = whiteboardLayout(input())
    const g = L.columnById[col].grid!
    expect(whiteboardInsertionIndex(L, col, g.x0 + 0.01, g.y0 + 0.01)).toBe(0)
    if (g.perRow > 1) expect(whiteboardInsertionIndex(L, col, g.x0 + g.cell * 1.5, g.y0 + 0.01)).toBe(1)
    expect(whiteboardInsertionIndex(L, col, g.x0, g.y0 + g.step * 1.2)).toBe(Math.min(g.perRow, cardsInColumn(doc.cards, col).length))
  })
})
