import type { SkinMotion } from '../types'

/** Loose and physical: peel on pick-up, sway while dragged, slap and squash on drop (PLAN §7.3). */
export const whiteboardMotion: SkinMotion = {
  liftHeight: 0.02,
  dragScale: 1.06,
  spring: { stiffness: 210, damping: 17 },
  dragTilt: 0.18,
  peel: true,
  squash: true,
}
