import { describe, expect, it } from 'vitest'
import { createDemoBoard } from '../../src/data/seed'
import type { BoardDoc } from '../../src/data/model'
import { findColumn, parseCommand, VOICE_EXAMPLES, type VoiceCommand } from '../../src/voice/commands'

const doc: BoardDoc = createDemoBoard(new Date('2026-01-01'))
const col = (title: string) => doc.board.columnIds.find((id) => doc.columns[id].title === title)!
const card = (title: string) => Object.values(doc.cards).find((c) => c.title === title)!
const flicker = card('Fix card flicker at column edges')
const snap = card('Snap the ghost board to detected walls')

const parse = (heard: string, ctx = {}) => parseCommand(heard, doc, ctx)
const ok = (heard: string, ctx = {}): VoiceCommand => {
  const r = parse(heard, ctx)
  if (!r.ok) throw new Error(`${heard}: ${r.reason}`)
  return r.command
}

describe('columns', () => {
  it('matches names loosely', () => {
    expect(findColumn(doc, 'in progress')?.title).toBe('In progress')
    expect(findColumn(doc, 'progress')?.title).toBe('In progress')
    expect(findColumn(doc, 'the review column')?.title).toBe('In review')
    expect(findColumn(doc, 'finished')?.title).toBe('Done')
    expect(findColumn(doc, 'last')?.title).toBe('Done')
    expect(findColumn(doc, 'second column')?.title).toBe('Ready')
    expect(findColumn(doc, 'in')).toBeNull() // "In progress" and "In review" are ambiguous
  })
})

describe('creating', () => {
  it('adds to the first column by default, or the pointed-at one', () => {
    expect(ok('New card fix the login bug')).toEqual({ kind: 'create', title: 'Fix the login bug', columnId: col('Backlog') })
    expect(ok('add a task write the docs.', { defaultColumnId: col('Ready') })).toEqual({ kind: 'create', title: 'Write the docs', columnId: col('Ready') })
    expect(ok('create sticky note buy tape')).toMatchObject({ title: 'Buy tape' })
  })

  it('takes a column from either end', () => {
    expect(ok('add a sticky to done called ship the beta')).toEqual({ kind: 'create', title: 'Ship the beta', columnId: col('Done') })
    expect(ok('new task write release notes in review')).toEqual({ kind: 'create', title: 'Write release notes', columnId: col('In review') })
    expect(ok('add buy milk to ready')).toEqual({ kind: 'create', title: 'Buy milk', columnId: col('Ready') })
  })

  it('keeps "to" in a title when it is not a column', () => {
    expect(ok('new card talk to the design team')).toMatchObject({ title: 'Talk to the design team', columnId: col('Backlog') })
  })

  it('asks for a title', () => {
    expect(parse('new card')).toMatchObject({ ok: false, reason: expect.stringMatching(/title/) })
  })
})

describe('moving', () => {
  it('finds the card by part of its title', () => {
    expect(ok('move card flicker to done')).toEqual({ kind: 'move', cardId: flicker.id, columnId: col('Done') })
    expect(ok('Put snap the ghost board into review.')).toEqual({ kind: 'move', cardId: snap.id, columnId: col('In review') })
    expect(ok('mark flicker as done')).toEqual({ kind: 'move', cardId: flicker.id, columnId: col('Done') })
  })

  it('finds cards by number and by pronoun', () => {
    expect(ok(`move card ${flicker.number} to ready`)).toMatchObject({ cardId: flicker.id, columnId: col('Ready') })
    expect(ok(`move #${flicker.number} to ready`)).toMatchObject({ cardId: flicker.id })
    expect(ok('move it to done', { focusCardId: snap.id })).toMatchObject({ cardId: snap.id })
    expect(parse('move it to done')).toMatchObject({ ok: false, reason: expect.stringMatching(/Which card/) })
  })

  it('finds the first or last card of a column', () => {
    const first = Object.values(doc.cards).filter((c) => c.columnId === col('Done')).sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))[0]
    expect(ok('move the first card in done to backlog')).toMatchObject({ cardId: first.id, columnId: col('Backlog') })
  })

  it('explains what went wrong', () => {
    expect(parse('move the unicorn to done')).toMatchObject({ ok: false, reason: expect.stringMatching(/No card matches/) })
    expect(parse('move flicker to the moon')).toMatchObject({ ok: false })
    // "skin" appears in several titles? No — but "the" alone matches nothing useful.
    expect(parse('move the to done')).toMatchObject({ ok: false })
  })

  it('refuses to guess between similar cards', () => {
    expect(parse('archive board')).toMatchObject({ ok: false, reason: expect.stringMatching(/more than one/) })
  })
})

describe('editing', () => {
  it('renames, including titles that contain "to"', () => {
    expect(ok('rename flicker to fix edge flicker')).toEqual({ kind: 'rename', cardId: flicker.id, title: 'Fix edge flicker' })
    expect(ok('change snap the ghost board to walk to the wall')).toEqual({ kind: 'rename', cardId: snap.id, title: 'Walk to the wall' })
    expect(ok('call it better name', { focusCardId: flicker.id })).toEqual({ kind: 'rename', cardId: flicker.id, title: 'Better name' })
  })

  it('opens a card to edit when no new title is given', () => {
    expect(ok('edit flicker')).toEqual({ kind: 'open', cardId: flicker.id })
  })

  it('sets descriptions', () => {
    expect(ok('describe it as only on safari', { focusCardId: flicker.id })).toEqual({ kind: 'describe', cardId: flicker.id, text: 'Only on safari' })
    expect(ok('add a note to flicker saying check hysteresis')).toEqual({ kind: 'describe', cardId: flicker.id, text: 'Check hysteresis' })
  })
})

describe('everything else', () => {
  it('archives (delete is archive, so it can be undone)', () => {
    expect(ok('archive flicker')).toEqual({ kind: 'archive', cardId: flicker.id })
    expect(ok('delete this card', { focusCardId: snap.id })).toEqual({ kind: 'archive', cardId: snap.id })
  })

  it('opens, undoes, switches skin and helps', () => {
    expect(ok('show me flicker')).toEqual({ kind: 'open', cardId: flicker.id })
    expect(ok('Undo.')).toEqual({ kind: 'undo' })
    expect(ok('redo that')).toEqual({ kind: 'redo' })
    expect(ok('switch to whiteboard')).toEqual({ kind: 'skin', skinId: 'whiteboard' })
    expect(ok('change to the projects view')).toEqual({ kind: 'skin', skinId: 'projects' })
    expect(ok('what can I say')).toEqual({ kind: 'help' })
  })

  it('says so when it does not understand', () => {
    expect(parse('make me a sandwich')).toMatchObject({ ok: false, reason: expect.stringMatching(/Not a command/) })
    expect(parse('   ')).toMatchObject({ ok: false })
  })

  it('understands every example it shows', () => {
    for (const [example] of VOICE_EXAMPLES) {
      for (const phrase of example.split(' · ')) {
        const r = parseCommand(phrase.replace('login bug', 'flicker').replace('card 104', `card ${flicker.number}`), doc, { focusCardId: flicker.id })
        expect(r.ok, `${phrase}: ${r.ok ? '' : r.reason}`).toBe(true)
      }
    }
  })
})
