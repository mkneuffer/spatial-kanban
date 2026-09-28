import Dexie, { type EntityTable } from 'dexie'
import type { Patch } from 'immer'
import type { Board, BoardDoc, Card, Column, FreeCardPlacement, Placement } from './model'
import type { Settings } from './settings'

interface KV {
  key: string
  value: unknown
}

export class KanbanDB extends Dexie {
  boards!: EntityTable<Board, 'id'>
  columns!: EntityTable<Column, 'id'>
  cards!: EntityTable<Card, 'id'>
  placements!: EntityTable<Placement, 'id'>
  freeCards!: Dexie.Table<FreeCardPlacement, [string, string]>
  kv!: EntityTable<KV, 'key'>

  constructor(name = 'spatial-kanban') {
    super(name)
    this.version(1).stores({
      boards: 'id',
      columns: 'id, boardId',
      cards: 'id, boardId, columnId',
      placements: 'id, [boardId+deviceId]',
      freeCards: '[cardId+deviceId], deviceId',
      kv: 'key',
    })
  }
}

export async function loadDoc(db: KanbanDB, boardId?: string): Promise<BoardDoc | null> {
  const lastId = boardId ?? ((await db.kv.get('lastBoardId'))?.value as string | undefined)
  const board = (lastId && (await db.boards.get(lastId))) || (await db.boards.toCollection().first())
  if (!board) return null
  const [columns, cards] = await Promise.all([
    db.columns.where('boardId').equals(board.id).toArray(),
    db.cards.where('boardId').equals(board.id).toArray(),
  ])
  // Heal column order if a column was lost.
  const columnMap = Object.fromEntries(columns.map((c) => [c.id, c]))
  board.columnIds = board.columnIds.filter((id) => columnMap[id])
  return { board, columns: columnMap, cards: Object.fromEntries(cards.map((c) => [c.id, c])) }
}

/** Extra key/value rows written in the same transaction as the board (e.g. its sync state). */
export type KVWrites = Map<string, unknown>

export async function saveDocFull(db: KanbanDB, doc: BoardDoc, kv?: KVWrites): Promise<void> {
  await db.transaction('rw', db.boards, db.columns, db.cards, db.kv, async () => {
    await Promise.all([
      db.columns.where('boardId').equals(doc.board.id).delete(),
      db.cards.where('boardId').equals(doc.board.id).delete(),
    ])
    await db.boards.put(doc.board)
    await db.columns.bulkPut(Object.values(doc.columns))
    await db.cards.bulkPut(Object.values(doc.cards))
    await db.kv.put({ key: 'lastBoardId', value: doc.board.id })
    if (kv?.size) await db.kv.bulkPut([...kv].map(([key, value]) => ({ key, value })))
  })
}

/** Which entities did a set of Immer patches touch? */
export interface DirtySet {
  full: boolean
  board: boolean
  cards: Set<string>
  columns: Set<string>
}

export function emptyDirty(): DirtySet {
  return { full: false, board: false, cards: new Set(), columns: new Set() }
}

export function collectDirty(patches: Patch[], into: DirtySet = emptyDirty()): DirtySet {
  for (const p of patches) {
    const [root, id] = p.path as [string, string | undefined]
    if (p.path.length <= 1) into.full = true
    else if (root === 'board') into.board = true
    else if (root === 'cards' && id !== undefined) into.cards.add(String(id))
    else if (root === 'columns' && id !== undefined) into.columns.add(String(id))
  }
  return into
}

export async function saveDirty(db: KanbanDB, doc: BoardDoc, dirty: DirtySet, kv?: KVWrites): Promise<void> {
  if (dirty.full) return saveDocFull(db, doc, kv)
  await db.transaction('rw', db.boards, db.columns, db.cards, db.kv, async () => {
    if (kv?.size) await db.kv.bulkPut([...kv].map(([key, value]) => ({ key, value })))
    if (dirty.board) await db.boards.put(doc.board)
    for (const id of dirty.cards) {
      const card = doc.cards[id]
      if (card) await db.cards.put(card)
      else await db.cards.delete(id)
    }
    for (const id of dirty.columns) {
      const column = doc.columns[id]
      if (column) await db.columns.put(column)
      else await db.columns.delete(id)
    }
  })
}

export interface BoardSummary {
  id: string
  title: string
  updatedAt: string
  integration?: Board['integration']
}

export async function listBoards(db: KanbanDB): Promise<BoardSummary[]> {
  const boards = await db.boards.toArray()
  return boards
    .map(({ id, title, updatedAt, integration }) => ({ id, title, updatedAt, integration }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

/** Removes a board with its cards, columns, placements and sync state. */
export async function deleteBoardData(db: KanbanDB, boardId: string): Promise<void> {
  await db.transaction('rw', [db.boards, db.columns, db.cards, db.placements, db.kv], async () => {
    await Promise.all([
      db.boards.delete(boardId),
      db.columns.where('boardId').equals(boardId).delete(),
      db.cards.where('boardId').equals(boardId).delete(),
      db.placements.filter((p) => p.boardId === boardId).delete(),
      db.kv.delete(`sync:${boardId}`),
    ])
  })
}

export async function loadPlacement(db: KanbanDB, boardId: string, deviceId: string): Promise<Placement | null> {
  const list = await db.placements.where('[boardId+deviceId]').equals([boardId, deviceId]).toArray()
  list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return list[0] ?? null
}

export async function savePlacement(db: KanbanDB, placement: Placement | null, boardId: string, deviceId: string) {
  await db.transaction('rw', db.placements, async () => {
    await db.placements.where('[boardId+deviceId]').equals([boardId, deviceId]).delete()
    if (placement) await db.placements.put(placement)
  })
}

export async function loadFreeCards(db: KanbanDB, deviceId: string): Promise<FreeCardPlacement[]> {
  return db.freeCards.where('deviceId').equals(deviceId).toArray()
}

export async function saveFreeCards(db: KanbanDB, deviceId: string, free: FreeCardPlacement[]) {
  await db.transaction('rw', db.freeCards, async () => {
    await db.freeCards.where('deviceId').equals(deviceId).delete()
    await db.freeCards.bulkPut(free)
  })
}

export async function loadSettings(db: KanbanDB): Promise<Partial<Settings> | null> {
  return ((await db.kv.get('settings'))?.value as Partial<Settings>) ?? null
}

export async function saveSettings(db: KanbanDB, settings: Settings) {
  await db.kv.put({ key: 'settings', value: settings })
}

// ——— JSON import / export ———

export const EXPORT_FORMAT = 'spatial-kanban/board'
export const EXPORT_VERSION = 1

export function exportDoc(doc: BoardDoc): string {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      board: doc.board,
      columns: doc.board.columnIds.map((id) => doc.columns[id]),
      cards: Object.values(doc.cards),
    },
    null,
    2,
  )
}

export function importDoc(json: string): BoardDoc {
  const data = JSON.parse(json)
  if (data?.format !== EXPORT_FORMAT) throw new Error('Not a Spatial Kanban board export.')
  if (typeof data.version !== 'number' || data.version > EXPORT_VERSION) throw new Error('This export is from a newer version.')
  const board = data.board as Board
  if (!board?.id || !Array.isArray(board.columnIds)) throw new Error('The export is missing its board.')
  const columns: Record<string, Column> = {}
  for (const c of data.columns as Column[]) columns[c.id] = c
  const cards: Record<string, Card> = {}
  for (const c of data.cards as Card[]) {
    if (!columns[c.columnId]) continue
    cards[c.id] = { ...c, labelIds: c.labelIds ?? [], assignees: c.assignees ?? [], archived: c.archived ?? false }
  }
  board.columnIds = board.columnIds.filter((id) => columns[id])
  if (board.columnIds.length === 0) throw new Error('The board has no columns.')
  return { board, columns, cards }
}
