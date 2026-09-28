import { beforeEach, describe, expect, it } from 'vitest'
import { useBoardStore } from '../../src/data/store'
import { createDemoBoard } from '../../src/data/seed'
import { cardsInColumn } from '../../src/data/ordering'
import { applyAction } from '../../src/data/actions'
import { produce } from 'immer'

const s = () => useBoardStore.getState()

describe('board store', () => {
  beforeEach(() => s().load(createDemoBoard()))

  it('moves a card between columns with a single action', () => {
    const [a, b] = s().doc.board.columnIds
    const card = cardsInColumn(s().doc.cards, a)[0]
    s().moveCard(card.id, b, 1)
    const inB = cardsInColumn(s().doc.cards, b)
    expect(inB[1].id).toBe(card.id)
    expect(s().past.at(-1)?.action).toBe('card/move')
  })

  it('reorders within a column', () => {
    const col = s().doc.board.columnIds[0]
    const before = cardsInColumn(s().doc.cards, col).map((c) => c.id)
    s().moveCard(before[0], col, 2)
    const after = cardsInColumn(s().doc.cards, col).map((c) => c.id)
    expect(after).toEqual([before[1], before[2], before[0], ...before.slice(3)])
  })

  it('ignores no-op moves', () => {
    const col = s().doc.board.columnIds[0]
    const first = cardsInColumn(s().doc.cards, col)[0]
    const rev = s().revision
    s().moveCard(first.id, col, 0)
    expect(s().revision).toBe(rev)
  })

  it('undoes and redoes', () => {
    const col = s().doc.board.columnIds[1]
    const card = s().createCard(col, 'Hello')
    expect(s().doc.cards[card.id].title).toBe('Hello')
    s().dispatch({ type: 'card/update', id: card.id, changes: { title: 'Renamed' } })
    s().undo()
    expect(s().doc.cards[card.id].title).toBe('Hello')
    s().undo()
    expect(s().doc.cards[card.id]).toBeUndefined()
    s().redo()
    s().redo()
    expect(s().doc.cards[card.id].title).toBe('Renamed')
  })

  it('archives and restores to the bottom of the column', () => {
    const col = s().doc.board.columnIds[0]
    const [first] = cardsInColumn(s().doc.cards, col)
    s().archiveCard(first.id)
    expect(cardsInColumn(s().doc.cards, col).some((c) => c.id === first.id)).toBe(false)
    s().archiveCard(first.id, false)
    expect(cardsInColumn(s().doc.cards, col).at(-1)?.id).toBe(first.id)
  })

  it('deleting a column re-homes its cards', () => {
    const [a, b] = s().doc.board.columnIds
    const moving = cardsInColumn(s().doc.cards, a).length
    const target = cardsInColumn(s().doc.cards, b).length
    s().dispatch({ type: 'column/delete', id: a, moveCardsTo: b })
    expect(s().doc.columns[a]).toBeUndefined()
    expect(cardsInColumn(s().doc.cards, b).length).toBe(moving + target)
  })

  it('never deletes the last column', () => {
    const doc = createDemoBoard()
    const next = produce(doc, (d) => {
      for (const id of [...d.board.columnIds]) applyAction(d, { type: 'column/delete', id }, 'now')
    })
    expect(next.board.columnIds.length).toBe(1)
  })

  it('moves columns', () => {
    const ids = s().doc.board.columnIds
    s().dispatch({ type: 'column/move', id: ids[0], toIndex: 2 })
    expect(s().doc.board.columnIds).toEqual([ids[1], ids[2], ids[0], ...ids.slice(3)])
  })

  it('edits the board name and description as one undo step each', () => {
    const before = s().doc.board.title
    s().dispatch({ type: 'board/update', changes: { title: 'Q4 roadmap', description: 'What ships this quarter' } })
    expect(s().doc.board.title).toBe('Q4 roadmap')
    expect(s().doc.board.description).toBe('What ships this quarter')
    s().undo()
    expect(s().doc.board.title).toBe(before)
    expect(s().doc.board.description).toBeUndefined()
  })

  it('adds, edits and deletes labels', () => {
    const count = s().doc.board.labels.length
    s().dispatch({ type: 'label/upsert', label: { id: 'lbl-new', name: 'research', color: '#000000', icon: 'flag' } })
    expect(s().doc.board.labels).toHaveLength(count + 1)
    s().dispatch({ type: 'label/upsert', label: { id: 'lbl-new', name: 'spike', color: '#123456', icon: 'bolt' } })
    expect(s().doc.board.labels.find((l) => l.id === 'lbl-new')).toMatchObject({ name: 'spike', color: '#123456', icon: 'bolt' })
    expect(s().doc.board.labels).toHaveLength(count + 1)

    const used = s().doc.board.labels[0].id
    const tagged = Object.values(s().doc.cards).filter((c) => c.labelIds.includes(used)).length
    expect(tagged).toBeGreaterThan(0)
    s().dispatch({ type: 'label/delete', id: used })
    expect(s().doc.board.labels.some((l) => l.id === used)).toBe(false)
    expect(Object.values(s().doc.cards).some((c) => c.labelIds.includes(used))).toBe(false)
    s().undo()
    expect(Object.values(s().doc.cards).filter((c) => c.labelIds.includes(used)).length).toBe(tagged)
  })

  it('sets and clears a deadline separately from the due date', () => {
    const card = s().createCard(s().doc.board.columnIds[0], 'Ship it')
    s().dispatch({ type: 'card/update', id: card.id, changes: { dueDate: '2030-01-10', deadline: '2030-01-15' } })
    s().dispatch({ type: 'card/update', id: card.id, changes: { deadline: undefined } })
    expect(s().doc.cards[card.id].dueDate).toBe('2030-01-10')
    expect(s().doc.cards[card.id].deadline).toBeUndefined()
  })
})
