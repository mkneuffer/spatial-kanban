import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { generateKeyBetween } from 'fractional-indexing'
import type { BoardDoc, Card } from '../../src/data/model'
import { cardsInColumn } from '../../src/data/ordering'
import { applyAction } from '../../src/data/actions'
import { PROVIDER_CAPABILITIES, type RemoteBoard, type RemoteCard } from '../../src/integrations/protocol'
import { boardFromRemote, commitOp, planSync, type PlanOptions, type SyncShadow } from '../../src/integrations/sync'

let n = 0
const opts = (caps = PROVIDER_CAPABILITIES.github): PlanOptions => ({ caps, now: '2026-01-01T00:00:00.000Z', newId: () => `L${++n}` })

function rc(id: string, columnId: string, title = id.toUpperCase(), extra: Partial<RemoteCard> = {}): RemoteCard {
  return { ref: { provider: 'github', id, key: `#${id}` }, title, description: '', columnId, labels: [], assignees: [], ...extra }
}

function remote(cards: RemoteCard[], columns = [{ id: 'todo', title: 'Todo' }, { id: 'doing', title: 'Doing' }, { id: 'done', title: 'Done' }]): RemoteBoard {
  return { id: 'PVT_1', name: 'Roadmap', columns, cards }
}

const base = () => remote([rc('a', 'todo'), rc('b', 'todo'), rc('c', 'todo'), rc('d', 'doing')])

function setup(r = base()) {
  return boardFromRemote('github', r, { now: '2026-01-01T00:00:00.000Z', newId: () => `L${++n}` })
}

const colOf = (doc: BoardDoc, ext: string) => doc.board.columnIds.find((id) => doc.columns[id].externalId === ext)!
const byRef = (doc: BoardDoc, rid: string) => Object.values(doc.cards).find((c) => c.externalRef?.id === rid)!
const titles = (doc: BoardDoc, ext: string) => cardsInColumn(doc.cards, colOf(doc, ext)).map((c) => c.externalRef?.id ?? c.title)
const edit = (doc: BoardDoc, fn: (d: BoardDoc) => void) => produce(doc, fn)
const act = (doc: BoardDoc, action: Parameters<typeof applyAction>[1]) => produce(doc, (d) => applyAction(d, action, 'now'))

/** Apply every planned op as if it succeeded, returning the new shadow. */
function commitAll(shadow: SyncShadow, ops: ReturnType<typeof planSync>['ops']) {
  return ops.reduce((s, p) => commitOp(s, p, { ok: true, ref: p.op.op === 'create' ? { provider: 'github', id: `new-${p.target}` } : undefined }), shadow)
}

describe('boardFromRemote', () => {
  it('mirrors columns, cards and order', () => {
    const { doc, shadow } = setup()
    expect(doc.board.integration).toMatchObject({ provider: 'github', remoteId: 'PVT_1', name: 'Roadmap' })
    expect(doc.board.columnIds.map((id) => doc.columns[id].title)).toEqual(['Todo', 'Doing', 'Done'])
    expect(titles(doc, 'todo')).toEqual(['a', 'b', 'c'])
    expect(titles(doc, 'doing')).toEqual(['d'])
    expect(shadow.order).toEqual({ todo: ['a', 'b', 'c'], doing: ['d'], done: [] })
    expect(planSync(doc, shadow, base(), opts()).ops).toEqual([])
  })

  it('maps labels and assignees', () => {
    const { doc } = setup(remote([rc('a', 'todo', 'A', { labels: [{ id: 'l1', name: 'bug', color: '#d73a4a' }], assignees: [{ id: 'u1', name: 'Ada' }] })]))
    const card = byRef(doc, 'a')
    expect(card.labelIds).toEqual(['github:l1'])
    expect(doc.board.labels).toContainEqual({ id: 'github:l1', name: 'bug', color: '#d73a4a', icon: 'bug' })
    expect(card.assignees[0]).toMatchObject({ id: 'github:u1', name: 'Ada' })
  })
})

describe('pull', () => {
  it('takes remote edits, moves, additions and removals', () => {
    const { doc, shadow } = setup()
    const r = remote([rc('b', 'todo', 'B!'), rc('a', 'doing'), rc('d', 'doing'), rc('e', 'done', 'E')])
    const plan = planSync(doc, shadow, r, opts())
    expect(plan.ops).toEqual([])
    expect(byRef(plan.next, 'b').title).toBe('B!')
    expect(titles(plan.next, 'todo')).toEqual(['b'])
    expect(titles(plan.next, 'doing')).toEqual(['a', 'd'])
    expect(titles(plan.next, 'done')).toEqual(['e'])
    expect(byRef(plan.next, 'c').archived).toBe(true)
    expect(plan.shadow.cards.c.archived).toBe(true)
  })

  it('keeps unpushed local edits the remote did not touch', () => {
    const { doc, shadow } = setup()
    const local = act(doc, { type: 'card/update', id: byRef(doc, 'a').id, changes: { title: 'Local A' } })
    const plan = planSync(local, shadow, base(), opts())
    expect(byRef(plan.next, 'a').title).toBe('Local A')
    expect(plan.ops.map((o) => o.op)).toEqual([{ op: 'update', ref: expect.objectContaining({ id: 'a' }), title: 'Local A' }])
  })

  it('lets the remote win when both sides changed a field', () => {
    const { doc, shadow } = setup()
    const local = act(doc, { type: 'card/update', id: byRef(doc, 'a').id, changes: { title: 'Local A' } })
    const plan = planSync(local, shadow, remote([rc('a', 'todo', 'Remote A'), rc('b', 'todo'), rc('c', 'todo'), rc('d', 'doing')]), opts())
    expect(byRef(plan.next, 'a').title).toBe('Remote A')
    expect(plan.ops).toEqual([])
  })

  it('returns the same doc when nothing changed', () => {
    const { doc, shadow } = setup()
    expect(planSync(doc, shadow, base(), opts()).next).toBe(doc)
  })

  it('keeps local-only columns and follows remote column changes', () => {
    const { doc, shadow } = setup()
    const withLocal = act(doc, { type: 'column/create', column: { id: 'mine', boardId: doc.board.id, title: 'Mine' }, index: 1 })
    const r = remote(base().cards.filter((c) => c.columnId !== 'done'), [
      { id: 'doing', title: 'In progress' },
      { id: 'todo', title: 'Todo' },
    ])
    const plan = planSync(withLocal, shadow, r, opts())
    const titlesInOrder = plan.next.board.columnIds.map((id) => plan.next.columns[id].title)
    // "Done" was deleted remotely, so it stays as a local-only column.
    expect(titlesInOrder).toEqual(['In progress', 'Mine', 'Todo', 'Done'])
    expect(Object.values(plan.next.columns).find((c) => c.title === 'Done')!.externalId).toBeUndefined()
  })

  it('does not undo a local column rename the remote left alone', () => {
    const { doc, shadow } = setup()
    const renamed = act(doc, { type: 'column/update', id: colOf(doc, 'todo'), changes: { title: 'Up next' } })
    expect(planSync(renamed, shadow, base(), opts()).next.columns[colOf(doc, 'todo')].title).toBe('Up next')
  })

  it('does not resurrect a locally deleted card unless the remote changes it', () => {
    const { doc, shadow } = setup()
    const deleted = act(doc, { type: 'card/delete', id: byRef(doc, 'c').id })
    const first = planSync(deleted, shadow, base(), opts())
    const archived = commitAll(first.shadow, first.ops)
    expect(first.ops.map((o) => o.op)).toEqual([{ op: 'archive', ref: { provider: 'github', id: 'c' }, archived: true }])
    const r = remote(base().cards.filter((c) => c.ref.id !== 'c'))
    expect(planSync(first.next, archived, r, opts()).next.cards).toEqual(first.next.cards)
    // Restored in the tool → comes back.
    const back = planSync(first.next, archived, base(), opts())
    expect(titles(back.next, 'todo')).toEqual(['a', 'b', 'c'])
  })
})

describe('push', () => {
  it('pushes a move to another column with its neighbours, then settles', () => {
    const { doc, shadow } = setup()
    const moved = act(doc, { type: 'card/move', id: byRef(doc, 'b').id, toColumnId: colOf(doc, 'doing'), orderKey: 'a0' })
    const plan = planSync(moved, shadow, null, opts())
    expect(plan.ops.map((o) => o.op)).toEqual([
      { op: 'move', ref: expect.objectContaining({ id: 'b' }), columnId: 'doing', afterId: null, beforeId: 'd', columnChanged: true },
    ])
    const settled = commitAll(plan.shadow, plan.ops)
    expect(settled.order).toMatchObject({ todo: ['a', 'c'], doing: ['b', 'd'] })
    expect(planSync(moved, settled, null, opts()).ops).toEqual([])
  })

  it('reorders with the fewest moves', () => {
    const { doc, shadow } = setup()
    // a b c → c a b: only "c" moved.
    const todo = colOf(doc, 'todo')
    const first = cardsInColumn(doc.cards, todo)[0].orderKey
    const moved = act(doc, { type: 'card/move', id: byRef(doc, 'c').id, toColumnId: todo, orderKey: generateKeyBetween(null, first) })
    expect(titles(moved, 'todo')).toEqual(['c', 'a', 'b'])
    const ops = planSync(moved, shadow, null, opts()).ops.map((o) => o.op)
    expect(ops).toEqual([{ op: 'move', ref: expect.objectContaining({ id: 'c' }), columnId: 'todo', afterId: null, beforeId: 'a', columnChanged: false }])
    expect(planSync(moved, shadow, null, opts(PROVIDER_CAPABILITIES.jira)).ops).toEqual([])
  })

  it('creates new local cards after their linked neighbour', () => {
    const { doc, shadow } = setup()
    const card: Card = { ...byRef(doc, 'a'), id: 'local-1', title: 'New', externalRef: undefined, orderKey: 'zz' }
    const added = act(doc, { type: 'card/create', card })
    const plan = planSync(added, shadow, null, opts())
    expect(plan.ops.map((o) => o.op)).toEqual([{ op: 'create', localId: 'local-1', columnId: 'todo', title: 'New', description: '', afterId: 'c' }])
    expect(planSync(added, shadow, null, { ...opts(), skipCreate: (id) => id === 'local-1' }).ops).toEqual([])
    const settled = commitAll(plan.shadow, plan.ops)
    expect(settled.order.todo).toEqual(['a', 'b', 'c', 'new-local-1'])
    expect(settled.cards['new-local-1']).toEqual({ title: 'New', description: '', column: 'todo', archived: false })
  })

  it('archives and restores where the tool supports it', () => {
    const { doc, shadow } = setup()
    const archived = act(doc, { type: 'card/archive', id: byRef(doc, 'd').id, archived: true })
    expect(planSync(archived, shadow, null, opts()).ops.map((o) => o.op)).toEqual([{ op: 'archive', ref: expect.objectContaining({ id: 'd' }), archived: true }])
    // Jira has no archive: the card stays archived locally only, and a pull keeps it that way.
    const jira = planSync(archived, shadow, base(), opts(PROVIDER_CAPABILITIES.jira))
    expect(jira.ops).toEqual([])
    expect(byRef(jira.next, 'd').archived).toBe(true)
  })

  it('reverts a change the tool refused on the next pull', () => {
    const { doc, shadow } = setup()
    const moved = act(doc, { type: 'card/move', id: byRef(doc, 'a').id, toColumnId: colOf(doc, 'done'), orderKey: 'a0' })
    const plan = planSync(moved, shadow, null, opts())
    const refused = plan.ops.reduce((s, p) => commitOp(s, p, { ok: false, error: 'Not allowed', permanent: true }), plan.shadow)
    expect(planSync(moved, refused, null, opts()).ops).toEqual([])
    const pulled = planSync(moved, refused, base(), opts())
    expect(titles(pulled.next, 'todo')).toEqual(['a', 'b', 'c'])
    expect(pulled.ops).toEqual([])
  })

  it('retries after a transient failure', () => {
    const { doc, shadow } = setup()
    const edited = act(doc, { type: 'card/update', id: byRef(doc, 'a').id, changes: { description: 'Details' } })
    const plan = planSync(edited, shadow, null, opts())
    const after = plan.ops.reduce((s, p) => commitOp(s, p, { ok: false, error: 'Timeout', permanent: false }), plan.shadow)
    expect(planSync(edited, after, null, opts()).ops).toHaveLength(1)
  })

  it('holds back archiving when most of the board went missing at once', () => {
    const cards = ['a', 'b', 'c', 'd', 'e'].map((id) => rc(id, 'todo'))
    const { doc, shadow } = setup(remote(cards))
    const emptied = edit(doc, (d) => {
      d.cards = {}
    })
    const plan = planSync(emptied, shadow, null, opts())
    expect(plan.ops).toEqual([])
    expect(plan.heldDeletes).toBe(5)
    // A few deletions on a bigger board still go through.
    const two = act(act(doc, { type: 'card/delete', id: byRef(doc, 'a').id }), { type: 'card/delete', id: byRef(doc, 'b').id })
    expect(planSync(two, shadow, null, opts()).ops.map((o) => o.op.op)).toEqual(['archive', 'archive'])
  })

  it('ignores cards linked to another provider and cards in local-only columns', () => {
    const { doc, shadow } = setup()
    const next = edit(doc, (d) => {
      d.columns.mine = { id: 'mine', boardId: d.board.id, title: 'Mine' }
      d.board.columnIds.push('mine')
      d.cards.x = { ...d.cards[byRef(d, 'a').id], id: 'x', externalRef: undefined, columnId: 'mine' }
      d.cards.y = { ...d.cards[byRef(d, 'a').id], id: 'y', externalRef: { provider: 'trello', id: 'a' } }
    })
    expect(planSync(next, shadow, null, opts()).ops).toEqual([])
  })
})
