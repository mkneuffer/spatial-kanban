import type { Board, BoardDoc, Card, Column, ID, Label } from './model'
import { cardsInColumn, keyForIndex } from './ordering'

/**
 * Small, serializable board actions (PLAN §8, decision 3). Every change to shared
 * board data goes through `applyAction`, which makes undo/redo, persistence and
 * future sync straightforward.
 */
export type BoardAction =
  | { type: 'card/create'; card: Card }
  | { type: 'card/update'; id: ID; changes: Partial<Omit<Card, 'id' | 'boardId'>> }
  | { type: 'card/move'; id: ID; toColumnId: ID; orderKey: string }
  | { type: 'card/archive'; id: ID; archived: boolean }
  | { type: 'card/delete'; id: ID }
  | { type: 'column/create'; column: Column; index?: number }
  | { type: 'column/update'; id: ID; changes: Partial<Omit<Column, 'id' | 'boardId'>> }
  | { type: 'column/move'; id: ID; toIndex: number }
  | { type: 'column/delete'; id: ID; moveCardsTo?: ID }
  | { type: 'board/update'; changes: Partial<Pick<Board, 'title' | 'description'>> }
  | { type: 'label/upsert'; label: Label }
  | { type: 'label/delete'; id: ID }
  | { type: 'doc/replace'; doc: BoardDoc }

/**
 * Applies an action to a mutable draft (used with Immer). Pure with respect to
 * its inputs apart from `now`, which is passed in for testability.
 */
export function applyAction(draft: BoardDoc, action: BoardAction, now: string): void {
  switch (action.type) {
    case 'card/create': {
      draft.cards[action.card.id] = { ...action.card }
      break
    }
    case 'card/update': {
      const card = draft.cards[action.id]
      if (!card) return
      Object.assign(card, action.changes, { updatedAt: now })
      break
    }
    case 'card/move': {
      const card = draft.cards[action.id]
      if (!card || !draft.columns[action.toColumnId]) return
      card.columnId = action.toColumnId
      card.orderKey = action.orderKey
      card.updatedAt = now
      break
    }
    case 'card/archive': {
      const card = draft.cards[action.id]
      if (!card) return
      card.archived = action.archived
      if (!action.archived) {
        // Restored cards go to the bottom of their column (or the first column).
        if (!draft.columns[card.columnId]) card.columnId = draft.board.columnIds[0]
        card.orderKey = keyForIndex(cardsInColumn(draft.cards, card.columnId, card.id), Infinity)
      }
      card.updatedAt = now
      break
    }
    case 'card/delete': {
      delete draft.cards[action.id]
      break
    }
    case 'column/create': {
      draft.columns[action.column.id] = { ...action.column }
      const ids = draft.board.columnIds
      const index = action.index ?? ids.length
      ids.splice(Math.max(0, Math.min(index, ids.length)), 0, action.column.id)
      draft.board.updatedAt = now
      break
    }
    case 'column/update': {
      const column = draft.columns[action.id]
      if (!column) return
      Object.assign(column, action.changes)
      draft.board.updatedAt = now
      break
    }
    case 'column/move': {
      const ids = draft.board.columnIds
      const from = ids.indexOf(action.id)
      if (from < 0) return
      ids.splice(from, 1)
      ids.splice(Math.max(0, Math.min(action.toIndex, ids.length)), 0, action.id)
      draft.board.updatedAt = now
      break
    }
    case 'column/delete': {
      if (!draft.columns[action.id]) return
      const ids = draft.board.columnIds
      if (ids.length <= 1) return // a board always keeps at least one column
      draft.board.columnIds = ids.filter((id) => id !== action.id)
      const target = action.moveCardsTo ?? draft.board.columnIds[0]
      const moving = cardsInColumn(draft.cards, action.id)
      for (const card of moving) {
        const dest = cardsInColumn(draft.cards, target, card.id)
        card.columnId = target
        card.orderKey = keyForIndex(dest, dest.length)
        card.updatedAt = now
      }
      // Archived cards of the deleted column are re-homed too.
      for (const id in draft.cards) {
        if (draft.cards[id].columnId === action.id) draft.cards[id].columnId = target
      }
      delete draft.columns[action.id]
      draft.board.updatedAt = now
      break
    }
    case 'board/update': {
      Object.assign(draft.board, action.changes, { updatedAt: now })
      break
    }
    case 'label/upsert': {
      const i = draft.board.labels.findIndex((l) => l.id === action.label.id)
      if (i >= 0) draft.board.labels[i] = { ...action.label }
      else draft.board.labels.push({ ...action.label })
      draft.board.updatedAt = now
      break
    }
    case 'label/delete': {
      draft.board.labels = draft.board.labels.filter((l) => l.id !== action.id)
      for (const id in draft.cards) {
        const card = draft.cards[id]
        if (card.labelIds.includes(action.id)) card.labelIds = card.labelIds.filter((l) => l !== action.id)
      }
      draft.board.updatedAt = now
      break
    }
    case 'doc/replace': {
      draft.board = action.doc.board
      draft.columns = action.doc.columns
      draft.cards = action.doc.cards
      break
    }
  }
}

/** Actions that are not worth an undo step on their own. */
export function isUndoable(action: BoardAction): boolean {
  return action.type !== 'doc/replace'
}
