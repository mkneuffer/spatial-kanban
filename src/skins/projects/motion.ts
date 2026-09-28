import type { SkinMotion } from '../types'

/** Tight and quick: no tilt, cards lift straight up (PLAN §7.2). */
export const projectsMotion: SkinMotion = {
  liftHeight: 0.015,
  dragScale: 1.05,
  spring: { stiffness: 400, damping: 35 },
  dragTilt: 0,
  peel: false,
  squash: false,
}
