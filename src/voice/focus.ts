import type { ID } from '../data/model'

/**
 * What the pointers are over, for voice commands ("move it to Done", "new
 * card …" into the pointed-at column). The 3D board registers a reader; the
 * hover state itself lives in its runtime.
 */
export interface PointerFocus {
  cardId: ID | null
  columnId: ID | null
}

let source: (() => PointerFocus) | null = null

export function registerPointerFocus(read: () => PointerFocus): () => void {
  source = read
  return () => {
    if (source === read) source = null
  }
}

export function pointerFocus(): PointerFocus {
  return source?.() ?? { cardId: null, columnId: null }
}
