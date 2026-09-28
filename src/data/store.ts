import { create } from 'zustand'
import { enablePatches, produceWithPatches, applyPatches, type Patch } from 'immer'
import { applyAction, isUndoable, type BoardAction } from './actions'
import type { BoardDoc, Card, ID } from './model'
import { cardsInColumn, keyForIndex } from './ordering'
import { createDemoBoard, newCard } from './seed'

enablePatches()

const HISTORY_LIMIT = 200

interface HistoryEntry {
  action: BoardAction['type']
  patches: Patch[]
  inverse: Patch[]
}

export interface BoardState {
  doc: BoardDoc
  /** Increments on every change; cheap dependency for memoized selectors. */
  revision: number
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** Set once the persisted doc has been loaded (or the demo seeded). */
  ready: boolean

  dispatch(action: BoardAction): void
  undo(): void
  redo(): void
  load(doc: BoardDoc): void

  // Convenience wrappers — each is exactly one serializable action.
  moveCard(cardId: ID, toColumnId: ID, index: number): void
  createCard(columnId: ID, title: string, index?: number): Card
  archiveCard(cardId: ID, archived?: boolean): void
}

type Listener = (patches: Patch[], doc: BoardDoc) => void
const patchListeners = new Set<Listener>()

/** Subscribe to committed patches (persistence, future sync). */
export function onBoardPatches(fn: Listener): () => void {
  patchListeners.add(fn)
  return () => patchListeners.delete(fn)
}

export const useBoardStore = create<BoardState>()((set, get) => ({
  doc: createDemoBoard(),
  revision: 0,
  past: [],
  future: [],
  ready: false,

  dispatch(action) {
    const { doc } = get()
    const [next, patches, inverse] = produceWithPatches(doc, (draft) => applyAction(draft, action, new Date().toISOString()))
    if (patches.length === 0) return
    set((s) => ({
      doc: next,
      revision: s.revision + 1,
      past: isUndoable(action) ? [...s.past, { action: action.type, patches, inverse }].slice(-HISTORY_LIMIT) : [],
      future: [],
    }))
    for (const fn of patchListeners) fn(patches, next)
  },

  undo() {
    const { past, doc } = get()
    const entry = past[past.length - 1]
    if (!entry) return
    const next = applyPatches(doc, entry.inverse)
    set((s) => ({ doc: next, revision: s.revision + 1, past: s.past.slice(0, -1), future: [...s.future, entry] }))
    for (const fn of patchListeners) fn(entry.inverse, next)
  },

  redo() {
    const { future, doc } = get()
    const entry = future[future.length - 1]
    if (!entry) return
    const next = applyPatches(doc, entry.patches)
    set((s) => ({ doc: next, revision: s.revision + 1, future: s.future.slice(0, -1), past: [...s.past, entry] }))
    for (const fn of patchListeners) fn(entry.patches, next)
  },

  load(doc) {
    set((s) => ({ doc, revision: s.revision + 1, past: [], future: [], ready: true }))
  },

  moveCard(cardId, toColumnId, index) {
    const { doc, dispatch } = get()
    const card = doc.cards[cardId]
    if (!card) return
    const siblings = cardsInColumn(doc.cards, toColumnId, cardId)
    // No-op if the card would land where it already is.
    if (card.columnId === toColumnId) {
      const current = cardsInColumn(doc.cards, toColumnId).findIndex((c) => c.id === cardId)
      if (current === index) return
    }
    dispatch({ type: 'card/move', id: cardId, toColumnId, orderKey: keyForIndex(siblings, index) })
  },

  createCard(columnId, title, index) {
    const { doc, dispatch } = get()
    const siblings = cardsInColumn(doc.cards, columnId)
    const card = newCard(doc, columnId, keyForIndex(siblings, index ?? siblings.length), title)
    dispatch({ type: 'card/create', card })
    return card
  },

  archiveCard(cardId, archived = true) {
    get().dispatch({ type: 'card/archive', id: cardId, archived })
  },
}))

/** Non-React accessor for per-frame XR code (PLAN §12: read with getState()). */
export const boardStore = useBoardStore
