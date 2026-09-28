import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { produce } from 'immer'
import { applyAction, type BoardAction } from '../../src/data/actions'
import type { BoardDoc } from '../../src/data/model'
import { cardsInColumn } from '../../src/data/ordering'
import { SyncEngine, type EngineDeps } from '../../src/integrations/engine'
import type { OpsResponse, RemoteBoard, SyncOp } from '../../src/integrations/protocol'
import { boardFromRemote, type SyncShadow } from '../../src/integrations/sync'

let created: RemoteBoard['cards'] = []
const remoteBoard = (): RemoteBoard => ({
  id: 'B',
  name: 'Board',
  columns: [
    { id: 'todo', title: 'Todo' },
    { id: 'done', title: 'Done' },
  ],
  cards: [{ ref: { provider: 'trello', id: 'r1', key: '#1' }, title: 'One', description: '', columnId: 'todo', labels: [], assignees: [] }, ...created],
})

let n = 0
function harness(opts: { refuse?: boolean } = {}) {
  const { doc: initial, shadow } = boardFromRemote('trello', remoteBoard(), { now: 'now', newId: () => `L${++n}` })
  let doc: BoardDoc = initial
  let saved: SyncShadow | null = shadow
  const listeners = new Set<(a?: BoardAction) => void>()
  const pushed: SyncOp[][] = []
  const fetches: number[] = []
  let release: (() => void) | null = null
  const deps: EngineDeps = {
    getDoc: () => doc,
    dispatch: (action) => {
      doc = produce(doc, (d) => applyAction(d, action, 'now'))
      listeners.forEach((fn) => fn(action))
    },
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    loadShadow: async () => saved,
    saveShadow: async (_id, s) => void (saved = s),
    fetchBoard: async () => (fetches.push(Date.now()), remoteBoard()),
    pushOps: async (_i, ops): Promise<OpsResponse> => {
      pushed.push(ops)
      // Hold creates until the test releases them, to exercise in-flight dedupe.
      if (ops.some((o) => o.op === 'create')) await new Promise<void>((r) => (release = r))
      return {
        results: ops.map((o) => {
          if (opts.refuse) return { ok: false, error: 'No', permanent: true }
          if (o.op !== 'create') return { ok: true }
          const ref = { provider: 'trello' as const, id: `r-${o.localId}`, key: '#9' }
          created.push({ ref, title: o.title, description: o.description, columnId: o.columnId, labels: [], assignees: [] })
          return { ok: true, ref }
        }),
      }
    },
    onStatus: vi.fn(),
    notify: vi.fn(),
    isActive: () => true,
  }
  const engine = new SyncEngine(doc.board.id, doc.board.integration!, deps)
  const local = (action: BoardAction) => deps.dispatch(action)
  return { engine, deps, local, pushed, fetches, getDoc: () => doc, release: () => release?.() }
}

beforeEach(() => {
  vi.useFakeTimers()
  created = []
})
afterEach(() => vi.useRealTimers())

const settle = async (engine: SyncEngine) => {
  await vi.advanceTimersByTimeAsync(700)
  await engine.idle
}

describe('SyncEngine', () => {
  it('pulls on start and pushes local changes after a short debounce', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.idle
    expect(h.fetches).toHaveLength(1)
    const card = Object.values(h.getDoc().cards)[0]
    h.local({ type: 'card/update', id: card.id, changes: { title: 'Renamed' } })
    h.local({ type: 'card/update', id: card.id, changes: { title: 'Renamed again' } })
    expect(h.pushed).toHaveLength(0)
    await settle(h.engine)
    expect(h.pushed).toEqual([[{ op: 'update', ref: card.externalRef, title: 'Renamed again' }]])
    h.engine.stop()
  })

  it('does not create a card twice while its create is in flight', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.idle
    const todo = h.getDoc().board.columnIds[0]
    h.local({ type: 'card/create', card: { ...Object.values(h.getDoc().cards)[0], id: 'new', title: 'New', externalRef: undefined, orderKey: 'a9' } })
    await vi.advanceTimersByTimeAsync(700)
    // A second change while the create is still out.
    h.local({ type: 'column/update', id: todo, changes: { wipLimit: 3 } })
    h.engine.requestPull()
    await vi.advanceTimersByTimeAsync(700)
    h.release()
    await h.engine.idle
    await settle(h.engine)
    const creates = h.pushed.flat().filter((o) => o.op === 'create')
    expect(creates).toHaveLength(1)
    expect(h.getDoc().cards.new.externalRef).toEqual({ provider: 'trello', id: 'r-new', key: '#9' })
    expect(cardsInColumn(h.getDoc().cards, todo).map((c) => c.id)).toContain('new')
    h.engine.stop()
  })

  it('pulls straight after a refused change, restoring the remote value', async () => {
    const h = harness({ refuse: true })
    await h.engine.start()
    await h.engine.idle
    const card = Object.values(h.getDoc().cards)[0]
    h.local({ type: 'card/update', id: card.id, changes: { title: 'Nope' } })
    await settle(h.engine)
    expect(h.deps.notify).toHaveBeenCalledWith('Trello: No')
    expect(h.fetches).toHaveLength(2)
    expect(h.getDoc().cards[card.id].title).toBe('One')
    h.engine.stop()
  })

  it('leaves a just-pushed card alone when a pull comes back stale', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.idle
    const card = Object.values(h.getDoc().cards)[0]
    const done = h.getDoc().board.columnIds[1]
    h.local({ type: 'card/move', id: card.id, toColumnId: done, orderKey: 'a0' })
    await settle(h.engine)
    expect(h.pushed.flat().map((o) => o.op)).toEqual(['move'])
    // The fake remote never applies the move: a stale read right after the push.
    h.engine.requestPull()
    await h.engine.idle
    expect(h.getDoc().cards[card.id].columnId).toBe(done)
    expect(h.pushed).toHaveLength(1)
    // Once it has settled, the remote wins again.
    await vi.advanceTimersByTimeAsync(21_000)
    h.engine.requestPull()
    await h.engine.idle
    expect(h.getDoc().cards[card.id].columnId).toBe(h.getDoc().board.columnIds[0])
    h.engine.stop()
  })

  it('stops when the open board changes', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.idle
    const other = produce(h.getDoc(), (d) => {
      d.board.id = 'another'
    })
    h.deps.getDoc = () => other
    h.engine.requestPull()
    await h.engine.idle
    expect(h.fetches).toHaveLength(1)
    h.engine.stop()
  })
})
