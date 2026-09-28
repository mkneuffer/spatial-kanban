import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import type { Card, ID } from './model'

export function compareOrderKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function byOrderKey<T extends { orderKey: string; id: string }>(a: T, b: T): number {
  return compareOrderKeys(a.orderKey, b.orderKey) || compareOrderKeys(a.id, b.id)
}

/** Live (non-archived) cards of a column, sorted by order key. */
export function cardsInColumn(cards: Record<ID, Card>, columnId: ID, excludeId?: ID): Card[] {
  const list: Card[] = []
  for (const id in cards) {
    const c = cards[id]
    if (c.columnId === columnId && !c.archived && c.id !== excludeId) list.push(c)
  }
  return list.sort(byOrderKey)
}

/**
 * Order key that places an item at `index` in an already-sorted list that does
 * NOT contain the item being moved.
 */
export function keyForIndex(sorted: ReadonlyArray<{ orderKey: string }>, index: number): string {
  const i = Math.max(0, Math.min(index, sorted.length))
  const before = i > 0 ? sorted[i - 1].orderKey : null
  const after = i < sorted.length ? sorted[i].orderKey : null
  if (before !== null && after !== null && before >= after) {
    // Duplicate keys (e.g. concurrent inserts). Fall back to appending after `before`.
    return generateKeyBetween(before, null)
  }
  return generateKeyBetween(before, after)
}

export function keysForCount(n: number): string[] {
  return generateNKeysBetween(null, null, n)
}
