import { useBoardStore, onBoardPatches } from '../data/store'
import { DEFAULT_SETTINGS, pickSettings, useSettings } from '../data/settings'
import { usePlacements } from '../data/placements'
import {
  collectDirty,
  emptyDirty,
  KanbanDB,
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

let flushNow: () => void = () => {}

/** Write pending changes immediately (before the app may be backgrounded or closed). */
export function flushPersistence() {
  flushNow()
}

/**
 * Local-first persistence (PLAN §14, phase 1): load from IndexedDB on boot,
 * then save each change (debounced) using the entities Immer's patches touched.
 * Placements are device-local and stored separately under the device id.
 */
export async function bootPersistence(): Promise<void> {
  let db: KanbanDB
  try {
    db = new KanbanDB()
    await db.open()
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
    const boardId = useBoardStore.getState().doc.board.id
    const deviceId = usePlacements.getState().deviceId
    const [placement, free] = await Promise.all([loadPlacement(db, boardId, deviceId), loadFreeCards(db, deviceId)])
    // Placements saved before the whiteboard became the default remember the old default, not a choice.
    const upgraded = placement && (settings?.version ?? 1) < 2 && placement.skinId === 'projects' ? { ...placement, skinId: DEFAULT_SETTINGS.skinId } : placement
    usePlacements.getState().hydrate(upgraded, free)
  } catch (err) {
    console.warn('[persistence] load failed — starting from the demo board', err)
    useBoardStore.setState({ ready: true })
  }

  let dirty = emptyDirty()
  const flushDoc = debounce(() => {
    const d = dirty
    dirty = emptyDirty()
    void saveDirty(db, useBoardStore.getState().doc, d).catch((e) => console.warn('[persistence] save failed', e))
  }, 250)
  onBoardPatches((patches) => {
    collectDirty(patches, dirty)
    flushDoc()
  })

  const flushSettings = debounce(() => void saveSettings(db, pickSettings(useSettings.getState())), 300)
  useSettings.subscribe(flushSettings)

  const flushPlacement = debounce(() => {
    const { placement, deviceId } = usePlacements.getState()
    void savePlacement(db, placement, useBoardStore.getState().doc.board.id, deviceId)
  }, 400)
  const flushFree = debounce(() => {
    const { freeCards, deviceId } = usePlacements.getState()
    void saveFreeCards(db, deviceId, Object.values(freeCards))
  }, 400)
  usePlacements.subscribe((s, prev) => {
    if (s.placement !== prev.placement) flushPlacement()
    if (s.freeCards !== prev.freeCards) flushFree()
  })

  const flushAll = () => {
    flushDoc.flush()
    flushSettings.flush()
    flushPlacement.flush()
    flushFree.flush()
  }
  flushNow = flushAll
  window.addEventListener('pagehide', flushAll)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushAll())
}
