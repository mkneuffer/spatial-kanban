import { useBoardStore, onBoardPatches } from '../data/store'
import { createDemoBoard } from '../data/seed'
import { pickSettings, useSettings } from '../data/settings'
import { usePlacements } from '../data/placements'
import type { BoardDoc } from '../data/model'
import {
  collectDirty,
  deleteBoardData,
  emptyDirty,
  KanbanDB,
  type KVWrites,
  listBoards as listBoardRows,
  loadDoc,
  loadFreeCards,
  loadPlacement,
  loadSettings,
  saveDirty,
  saveDocFull,
  saveFreeCards,
  savePlacement,
  saveSettings,
} from '../data/persistence'

function debounce(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  const run = () => {
    t = undefined
    fn()
  }
  const call = () => {
    if (t) clearTimeout(t)
    t = setTimeout(run, ms)
  }
  call.flush = () => {
    if (t) {
      clearTimeout(t)
      run()
    }
  }
  return call
}

let db: KanbanDB | null = null
let flushAll: () => void = () => undefined
/** Key/value rows waiting to be saved together with the next board save. */
let pendingKv: KVWrites = new Map()
let scheduleDocSave: () => void = () => undefined

/**
 * Local-first persistence (PLAN §14, phase 1): load from IndexedDB on boot,
 * then save each change (debounced) using the entities Immer's patches touched.
 * Placements are device-local and stored separately under the device id.
 */
export async function bootPersistence(): Promise<void> {
  try {
    const opened = new KanbanDB()
    await opened.open()
    db = opened
  } catch (err) {
    console.warn('[persistence] IndexedDB unavailable — running in memory only', err)
    useBoardStore.setState({ ready: true })
    return
  }

  try {
    const [doc, settings] = await Promise.all([loadDoc(db), loadSettings(db)])
    if (settings) useSettings.getState().hydrate(settings)
    if (doc) useBoardStore.getState().load(doc)
    else {
      const seeded = useBoardStore.getState().doc
      await saveDocFull(db, seeded)
      useBoardStore.getState().load(seeded)
    }
    await hydratePlacements(db)
  } catch (err) {
    console.warn('[persistence] load failed — starting from the demo board', err)
    useBoardStore.setState({ ready: true })
  }

  const store = db
  let dirty = emptyDirty()
  const flushDoc = debounce(() => {
    const d = dirty
    const kv = pendingKv
    dirty = emptyDirty()
    pendingKv = new Map()
    void saveDirty(store, useBoardStore.getState().doc, d, kv).catch((e) => console.warn('[persistence] save failed', e))
  }, 250)
  onBoardPatches((patches) => {
    collectDirty(patches, dirty)
    flushDoc()
  })
  scheduleDocSave = flushDoc

  const flushSettings = debounce(() => void saveSettings(store, pickSettings(useSettings.getState())), 300)
  useSettings.subscribe(flushSettings)

  const flushPlacement = debounce(() => {
    const { placement, deviceId } = usePlacements.getState()
    void savePlacement(store, placement, useBoardStore.getState().doc.board.id, deviceId)
  }, 400)
  const flushFree = debounce(() => {
    const { freeCards, deviceId } = usePlacements.getState()
    void saveFreeCards(store, deviceId, Object.values(freeCards))
  }, 400)
  usePlacements.subscribe((s, prev) => {
    if (s.placement !== prev.placement) flushPlacement()
    if (s.freeCards !== prev.freeCards) flushFree()
  })

  flushAll = () => {
    flushDoc.flush()
    flushSettings.flush()
    flushPlacement.flush()
    flushFree.flush()
  }
  window.addEventListener('pagehide', () => flushAll())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushAll())
}

async function hydratePlacements(store: KanbanDB) {
  const boardId = useBoardStore.getState().doc.board.id
  const deviceId = usePlacements.getState().deviceId
  const [placement, free] = await Promise.all([loadPlacement(store, boardId, deviceId), loadFreeCards(store, deviceId)])
  usePlacements.getState().hydrate(placement, free)
}

// ——— multiple boards ———

export async function listBoards() {
  return db ? listBoardRows(db) : []
}

/** Saves pending changes, then shows another stored board. */
export async function openBoard(boardId: string): Promise<void> {
  if (!db) return
  flushAll()
  const doc = await loadDoc(db, boardId)
  if (!doc) throw new Error('That board no longer exists.')
  await db.kv.put({ key: 'lastBoardId', value: doc.board.id })
  useBoardStore.getState().load(doc)
  await hydratePlacements(db)
}

/** Stores a new board (and optionally its sync state), then opens it. */
export async function addBoard(doc: BoardDoc, syncState?: unknown): Promise<void> {
  if (!db) {
    useBoardStore.getState().load(doc)
    usePlacements.getState().hydrate(null, [])
    return
  }
  flushAll()
  await saveDocFull(db, doc)
  if (syncState !== undefined) await db.kv.put({ key: `sync:${doc.board.id}`, value: syncState })
  await openBoard(doc.board.id)
}

/** Deletes a stored board. Deleting the open board opens another (or a fresh demo). */
export async function deleteBoard(boardId: string): Promise<void> {
  if (!db) return
  const current = useBoardStore.getState().doc.board.id === boardId
  await deleteBoardData(db, boardId)
  if (!current) return
  const next = (await listBoardRows(db))[0]
  if (next) await openBoard(next.id)
  else await addBoard(createDemoBoard())
}

export async function kvGet<T>(key: string): Promise<T | null> {
  return db ? (((await db.kv.get(key))?.value as T | undefined) ?? null) : null
}

/**
 * Saves a key/value row in the same transaction as the board's pending changes,
 * so the two never disagree after a reload (used for sync state).
 */
export function kvSetWithBoard(key: string, value: unknown): void {
  if (!db) return
  pendingKv.set(key, value)
  scheduleDocSave()
}
