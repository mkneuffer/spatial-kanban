/**
 * Near-field (direct) hand interaction tuning, kept pure so it can be unit tested.
 *
 * A tracked hand has two direct pointers:
 * - **pinch grab** — a sphere at the midpoint between thumb and index tips, pressed by the
 *   runtime's pinch (`select`). It is where the fingers actually close, so a pinched card
 *   stays in the fingers instead of trailing the index tip.
 * - **poke** — a sphere at the index tip that presses when the fingertip reaches a
 *   surface from the front, and releases once it lifts clear (with hysteresis).
 *
 * pmndrs puts both at the index tip and breaks ties in favour of grab, so poke never
 * fired. The gate below arbitrates by hand shape instead: while the thumb is closing
 * on the index (a pinch forming) poke is off; with the index clear of the thumb it is on.
 */

/** Grab sphere radius at the pinch point (m). */
export const PINCH_GRAB_RADIUS = 0.05
/** Poke hover sphere radius at the index tip (m). */
export const POKE_HOVER_RADIUS = 0.06
/** Index-tip distance to the surface that presses (m). The joint sits ~7 mm inside the fingertip. */
export const POKE_DOWN = 0.004
/** Lift distance that releases a poke press (m). Larger than POKE_DOWN so a sliding finger doesn't chatter. */
export const POKE_UP = 0.02
/** How far the fingertip may sink behind a pressed surface before the press is dropped (m). */
export const POKE_THROUGH = 0.06
/** Poke presses are slower than pinches; allow a longer press to still count as a click (ms). */
export const POKE_CLICK_MS = 600
/** Thumb–index tip gap below which a pinch is forming: poke switches off (m). */
export const PINCH_FORMING = 0.035
/** Thumb–index tip gap above which the hand reads as pointing: poke switches on (m). */
export const POINTING = 0.05
/** Hand rays start past the near-field grab sphere so there is no dead zone between them (m). */
export const HAND_RAY_MIN_DISTANCE = 0.1

/** Poke gate with hysteresis on the thumb–index gap. Unknown gap (no joints) keeps the previous state. */
export function pokeAllowed(gap: number, previous: boolean): boolean {
  if (!Number.isFinite(gap)) return previous
  return previous ? gap > PINCH_FORMING : gap > POINTING
}

export interface PokeSample {
  /** The pointer is the active one in its hand's combined pointer. */
  enabled: boolean
  /** The poke gate (hand shape) allows a new press. */
  allowed: boolean
  /** Signed distance from the fingertip to the surface along its front normal (m); NaN when nothing is hit. */
  distance: number
  /** The hit surface faces the fingertip (approach from the front). */
  front: boolean
}

/** Next pressed state for the poke pointer. */
export function pokePressed(pressed: boolean, s: PokeSample): boolean {
  if (!pressed) return s.enabled && s.allowed && s.front && Number.isFinite(s.distance) && s.distance <= POKE_DOWN
  if (!s.enabled || !Number.isFinite(s.distance)) return false
  return s.distance <= POKE_UP && s.distance >= -POKE_THROUGH
}
