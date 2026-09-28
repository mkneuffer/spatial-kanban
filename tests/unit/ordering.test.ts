import { describe, expect, it } from 'vitest'
import { keyForIndex, keysForCount, cardsInColumn } from '../../src/data/ordering'
import { createDemoBoard } from '../../src/data/seed'

describe('fractional ordering', () => {
  it('generates keys between neighbours without renumbering', () => {
    const keys = keysForCount(3).map((orderKey) => ({ orderKey }))
    const start = keyForIndex(keys, 0)
    const mid = keyForIndex(keys, 1)
    const end = keyForIndex(keys, 3)
    expect(start < keys[0].orderKey).toBe(true)
    expect(mid > keys[0].orderKey && mid < keys[1].orderKey).toBe(true)
    expect(end > keys[2].orderKey).toBe(true)
  })

  it('clamps out-of-range indexes', () => {
    const keys = keysForCount(2).map((orderKey) => ({ orderKey }))
    expect(keyForIndex(keys, -5) < keys[0].orderKey).toBe(true)
    expect(keyForIndex(keys, 99) > keys[1].orderKey).toBe(true)
    expect(keyForIndex([], 0)).toBeTypeOf('string')
  })

  it('survives many inserts at the same spot', () => {
    let list = keysForCount(2).map((orderKey) => ({ orderKey }))
    for (let i = 0; i < 200; i++) {
      const k = keyForIndex(list, 1)
      list = [list[0], { orderKey: k }, ...list.slice(1)]
    }
    const sorted = [...list].sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))
    expect(sorted).toEqual(list)
  })

  it('sorts cards within a column and skips archived ones', () => {
    const doc = createDemoBoard()
    const col = doc.board.columnIds[0]
    const cards = cardsInColumn(doc.cards, col)
    expect(cards.length).toBeGreaterThan(1)
    for (let i = 1; i < cards.length; i++) expect(cards[i - 1].orderKey < cards[i].orderKey).toBe(true)
    doc.cards[cards[0].id].archived = true
    expect(cardsInColumn(doc.cards, col).length).toBe(cards.length - 1)
  })
})
