import { useBoardStore } from '../data/store'
import { usePlacements } from '../data/placements'
import { useSettings } from '../data/settings'
import { playSound } from '../fx/audio'
import { pulse } from '../fx/haptics'
import { getSkin } from '../skins/registry'
import type { BoardRuntime } from './runtime'
import { NEW_CARD_ID, type DragEffect } from './drag'
import { useView } from './viewStore'
import { toast } from '../ui/toasts'
import { openSystemKeyboard } from '../xr/systemKeyboard'

const LEAVE_MS = 450

export function archiveWithAnimation(cardId: string, runtime?: BoardRuntime) {
  const store = useBoardStore.getState()
  const card = store.doc.cards[cardId]
  if (!card) return
  usePlacements.getState().unparkCard(cardId)
  store.archiveCard(cardId, true)
  const view = useView.getState()
  view.set({ leaving: { ...view.leaving, [cardId]: performance.now() } })
  if (view.detailCardId === cardId) view.select(null)
  setTimeout(() => {
    const v = useView.getState()
    const next = { ...v.leaving }
    delete next[cardId]
    v.set({ leaving: next })
    runtime?.animator.delete(cardId)
  }, LEAVE_MS)
  toast(`Archived “${truncate(card.title)}”`, { action: { label: 'Undo', run: () => useBoardStore.getState().undo() } })
}

export function truncate(s: string, n = 32) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Start editing a freshly created card's title (keyboard / voice in XR, the drawer on 2D/3D). */
export function beginNewCard(columnId: string, index: number, runtime?: BoardRuntime) {
  const card = useBoardStore.getState().createCard(columnId, 'New card', index)
  if (runtime) {
    // Continue the ghost's motion into the new card so it doesn't pop.
    const ghost = runtime.animator.peek(NEW_CARD_ID)
    if (ghost) {
      const a = runtime.animator.get(card.id)
      Object.assign(a, { ...ghost, v: { ...ghost.v }, initialized: true })
      runtime.animator.delete(NEW_CARD_ID)
    }
  }
  // In a headset, open the system keyboard now, while we're still inside the user's gesture.
  if (useView.getState().mode === 'xr') openSystemKeyboard('')
  useView.getState().set({ editCardId: card.id, editIsNew: true, detailCardId: card.id })
  return card
}

/** Apply side effects emitted by the pure drag reducer. */
export function runDragEffects(effects: DragEffect[], runtime: BoardRuntime, gamepad?: Gamepad | null) {
  const skin = getSkin(useSettings.getState().skinId)
  const store = useBoardStore.getState()
  const placements = usePlacements.getState()
  for (const fx of effects) {
    switch (fx.type) {
      case 'sound':
        playSound(skin.sounds[fx.name])
        break
      case 'haptic':
        pulse(gamepad, fx.strength)
        break
      case 'commit':
        store.moveCard(fx.cardId, fx.columnId, fx.index)
        break
      case 'create':
        beginNewCard(fx.columnId, fx.index, runtime)
        break
      case 'padTap': {
        const first = store.doc.board.columnIds[0]
        if (first) beginNewCard(first, 0, runtime)
        playSound(skin.sounds.drop)
        break
      }
      case 'detail': {
        // Tapping the selected card again closes its details.
        const view = useView.getState()
        view.select(view.detailCardId === fx.cardId ? null : fx.cardId)
        playSound('clickSoft')
        break
      }
      case 'archive':
        archiveWithAnimation(fx.cardId, runtime)
        break
      case 'park':
        placements.parkCard(fx.cardId, { position: fx.position, quaternion: [0, 0, 0, 1] })
        break
      case 'unpark':
        placements.unparkCard(fx.cardId)
        break
      case 'cancel':
        break
    }
  }
}
