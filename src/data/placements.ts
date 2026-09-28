import { create } from 'zustand'
import type { FreeCardPlacement, ID, Placement, PlacementMode, Pose, ScalePreset } from './model'
import { IDENTITY_POSE } from './model'
import { getDeviceId, ulid } from './ids'

/** Default board sizes per placement mode (PLAN §5.1) and scale preset (§5.4). */
export const DEFAULT_SIZES: Record<PlacementMode, [number, number]> = {
  wall: [1.6, 1.0],
  desk: [0.6, 0.4],
  float: [1.2, 0.75],
}

export const PRESET_SIZES: Record<ScalePreset, [number, number]> = {
  poster: [1.6, 1.0],
  desk: [0.9, 0.56],
  compact: [0.6, 0.38],
}

/** Minimum column width (PLAN §5.4). */
export const MIN_COLUMN_WIDTH = 0.25
export const MIN_BOARD_HEIGHT = 0.3

export function minBoardWidth(columnCount: number): number {
  return Math.max(0.5, columnCount * MIN_COLUMN_WIDTH * 0.9)
}

interface PlacementState {
  deviceId: string
  placement: Placement | null
  freeCards: Record<ID, FreeCardPlacement>
  setPlacement(p: Placement | null): void
  updatePlacement(changes: Partial<Placement>): void
  parkCard(cardId: ID, localOffset: Pose): void
  unparkCard(cardId: ID): void
  hydrate(placement: Placement | null, freeCards: FreeCardPlacement[]): void
}

export const usePlacements = create<PlacementState>()((set, get) => ({
  deviceId: typeof window !== 'undefined' ? getDeviceId() : 'test-device',
  placement: null,
  freeCards: {},
  setPlacement: (placement) => set({ placement }),
  updatePlacement: (changes) => {
    const p = get().placement
    if (!p) return
    set({ placement: { ...p, ...changes, updatedAt: new Date().toISOString() } })
  },
  parkCard: (cardId, localOffset) =>
    set((s) => ({ freeCards: { ...s.freeCards, [cardId]: { cardId, deviceId: s.deviceId, localOffset } } })),
  unparkCard: (cardId) =>
    set((s) => {
      if (!s.freeCards[cardId]) return s
      const next = { ...s.freeCards }
      delete next[cardId]
      return { freeCards: next }
    }),
  hydrate: (placement, freeCards) =>
    set({ placement, freeCards: Object.fromEntries(freeCards.map((f) => [f.cardId, f])) }),
}))

export function createPlacement(boardId: ID, mode: PlacementMode, skinId: string, size?: [number, number]): Placement {
  return {
    id: ulid(),
    boardId,
    deviceId: usePlacements.getState().deviceId,
    mode,
    localOffset: IDENTITY_POSE,
    size: size ?? DEFAULT_SIZES[mode],
    tiltDeg: mode === 'desk' ? 15 : undefined,
    skinId,
    updatedAt: new Date().toISOString(),
  }
}
