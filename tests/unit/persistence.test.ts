import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { produceWithPatches, enablePatches } from 'immer'
import { KanbanDB, collectDirty, exportDoc, importDoc, loadDoc, saveDirty, saveDocFull, savePlacement, loadPlacement } from '../../src/data/persistence'
import { createDemoBoard } from '../../src/data/seed'
import { applyAction } from '../../src/data/actions'
import type { Placement } from '../../src/data/model'

enablePatches()

describe('persistence', () => {
  it('round-trips a full board', async () => {
    const db = new KanbanDB('t-roundtrip')
    const doc = createDemoBoard()
    await saveDocFull(db, doc)
    const loaded = await loadDoc(db)
    expect(loaded).toEqual(doc)
  })

  it('saves only dirty entities from patches', async () => {
    const db = new KanbanDB('t-dirty')
    const doc = createDemoBoard()
    await saveDocFull(db, doc)
    const cardId = Object.keys(doc.cards)[0]
    const [next, patches] = produceWithPatches(doc, (d) => {
      applyAction(d, { type: 'card/update', id: cardId, changes: { title: 'Changed' } }, 'now')
      applyAction(d, { type: 'card/delete', id: Object.keys(doc.cards)[1] }, 'now')
    })
    const dirty = collectDirty(patches)
    expect(dirty.full).toBe(false)
    expect(dirty.cards.size).toBe(2)
    await saveDirty(db, next, dirty)
    const loaded = await loadDoc(db)
    expect(loaded?.cards[cardId].title).toBe('Changed')
    expect(Object.keys(loaded!.cards)).toHaveLength(Object.keys(doc.cards).length - 1)
  })

  it('stores one placement per board and device', async () => {
    const db = new KanbanDB('t-placement')
    const base: Placement = {
      id: 'p1', boardId: 'b', deviceId: 'd', mode: 'wall', size: [1.6, 1], skinId: 'projects', updatedAt: '1',
      localOffset: { position: [0, 1, 0], quaternion: [0, 0, 0, 1] }, anchorHandle: 'uuid-1',
    }
    await savePlacement(db, base, 'b', 'd')
    await savePlacement(db, { ...base, id: 'p2', anchorHandle: 'uuid-2' }, 'b', 'd')
    expect((await loadPlacement(db, 'b', 'd'))?.anchorHandle).toBe('uuid-2')
    expect(await loadPlacement(db, 'b', 'other')).toBeNull()
  })

  it('exports and imports JSON', () => {
    const doc = createDemoBoard()
    const back = importDoc(exportDoc(doc))
    expect(back.board.columnIds).toEqual(doc.board.columnIds)
    expect(Object.keys(back.cards).sort()).toEqual(Object.keys(doc.cards).sort())
    expect(() => importDoc('{"format":"nope"}')).toThrow()
  })
})
