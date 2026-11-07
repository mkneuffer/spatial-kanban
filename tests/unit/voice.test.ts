import { describe, expect, it } from 'vitest'
import { createDemoBoard } from '../../src/data/seed'
import type { BoardDoc } from '../../src/data/model'
import { findColumn, parseCommand, VOICE_EXAMPLES, type VoiceCommand } from '../../src/voice/commands'

const doc: BoardDoc = createDemoBoard(new Date('2026-01-01'))
const col = (title: string) => doc.board.columnIds.find((id) => doc.columns[id].title === title)!
const card = (title: string) => Object.values(doc.cards).find((c) => c.title === title)!
const pagination = card('Fix off-by-one in search pagination')
const leak = card('Fix memory leak in the websocket reconnect loop')

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
    expect(ok('New card fix the login bug')).toEqual({ kind: 'create', title: 'Fix the login bug', columnId: col('Triage') })
    expect(ok('add a task write the docs.', { defaultColumnId: col('Ready') })).toEqual({ kind: 'create', title: 'Write the docs', columnId: col('Ready') })
    expect(ok('create sticky note buy tape')).toMatchObject({ title: 'Buy tape' })
  })

  it('takes a column from either end', () => {
    expect(ok('add a sticky to done called ship the beta')).toEqual({ kind: 'create', title: 'Ship the beta', columnId: col('Done') })
    expect(ok('new task write release notes in review')).toEqual({ kind: 'create', title: 'Write release notes', columnId: col('In review') })
    expect(ok('add buy milk to ready')).toEqual({ kind: 'create', title: 'Buy milk', columnId: col('Ready') })
  })

  it('keeps "to" in a title when it is not a column', () => {
    expect(ok('new card talk to the design team')).toMatchObject({ title: 'Talk to the design team', columnId: col('Triage') })
  })

  it('asks for a title', () => {
    expect(parse('new card')).toMatchObject({ ok: false, reason: expect.stringMatching(/title/) })
  })
})

describe('moving', () => {
  it('finds the card by part of its title', () => {
    expect(ok('move card pagination to done')).toEqual({ kind: 'move', cardId: pagination.id, columnId: col('Done') })
    expect(ok('Put memory leak into review.')).toEqual({ kind: 'move', cardId: leak.id, columnId: col('In review') })
    expect(ok('mark pagination as done')).toEqual({ kind: 'move', cardId: pagination.id, columnId: col('Done') })
  })

  it('finds cards by number and by pronoun', () => {
    expect(ok(`move card ${pagination.number} to ready`)).toMatchObject({ cardId: pagination.id, columnId: col('Ready') })
    expect(ok(`move #${pagination.number} to ready`)).toMatchObject({ cardId: pagination.id })
    expect(ok('move it to done', { focusCardId: leak.id })).toMatchObject({ cardId: leak.id })
    expect(parse('move it to done')).toMatchObject({ ok: false, reason: expect.stringMatching(/Which card/) })
  })

  it('finds the first or last card of a column', () => {
    const first = Object.values(doc.cards).filter((c) => c.columnId === col('Done')).sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))[0]
    expect(ok('move the first card in done to triage')).toMatchObject({ cardId: first.id, columnId: col('Triage') })
  })

  it('explains what went wrong', () => {
    expect(parse('move the unicorn to done')).toMatchObject({ ok: false, reason: expect.stringMatching(/No card matches/) })
    expect(parse('move pagination to the moon')).toMatchObject({ ok: false })
    // "skin" appears in several titles? No — but "the" alone matches nothing useful.
    expect(parse('move the to done')).toMatchObject({ ok: false })
  })

  it('refuses to guess between similar cards', () => {
    expect(parse('archive login')).toMatchObject({ ok: false, reason: expect.stringMatching(/more than one/) })
  })
})

describe('editing', () => {
  it('renames, including titles that contain "to"', () => {
    expect(ok('rename pagination to fix the page offset')).toEqual({ kind: 'rename', cardId: pagination.id, title: 'Fix the page offset' })
    expect(ok('change memory leak to walk to the wall')).toEqual({ kind: 'rename', cardId: leak.id, title: 'Walk to the wall' })
    expect(ok('call it better name', { focusCardId: pagination.id })).toEqual({ kind: 'rename', cardId: pagination.id, title: 'Better name' })
  })

  it('opens a card to edit when no new title is given', () => {
    expect(ok('edit pagination')).toEqual({ kind: 'open', cardId: pagination.id })
  })

  it('sets descriptions', () => {
    expect(ok('describe it as only on safari', { focusCardId: pagination.id })).toEqual({ kind: 'describe', cardId: pagination.id, text: 'Only on safari' })
    expect(ok('add a note to pagination saying check hysteresis')).toEqual({ kind: 'describe', cardId: pagination.id, text: 'Check hysteresis' })
  })
})

describe('everything else', () => {
  it('archives (delete is archive, so it can be undone)', () => {
    expect(ok('archive pagination')).toEqual({ kind: 'archive', cardId: pagination.id })
    expect(ok('delete this card', { focusCardId: leak.id })).toEqual({ kind: 'archive', cardId: leak.id })
  })

  it('opens, undoes, switches skin and helps', () => {
    expect(ok('show me pagination')).toEqual({ kind: 'open', cardId: pagination.id })
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
        const r = parseCommand(phrase.replace('login bug', 'pagination').replace('card 104', `card ${pagination.number}`), doc, { focusCardId: pagination.id })
        expect(r.ok, `${phrase}: ${r.ok ? '' : r.reason}`).toBe(true)
      }
    }
  })
})
