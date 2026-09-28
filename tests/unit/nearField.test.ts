import { describe, expect, it } from 'vitest'
import { PINCH_FORMING, POINTING, POKE_DOWN, POKE_THROUGH, POKE_UP, pokeAllowed, pokePressed, type PokeSample } from '../../src/xr/hands/nearField'
import { onBoardDragZ, TEAR_OFF_DIST } from '../../src/board/drag'

const touching = (distance: number, over: Partial<PokeSample> = {}): PokeSample => ({ enabled: true, allowed: true, front: true, distance, ...over })

describe('poke gate', () => {
  it('switches on only once the index is clear of the thumb, and off as a pinch forms', () => {
    expect(pokeAllowed(POINTING - 0.005, false)).toBe(false)
    expect(pokeAllowed(POINTING + 0.005, false)).toBe(true)
    // Hysteresis: between the thresholds the previous state holds.
    expect(pokeAllowed((PINCH_FORMING + POINTING) / 2, true)).toBe(true)
    expect(pokeAllowed((PINCH_FORMING + POINTING) / 2, false)).toBe(false)
    expect(pokeAllowed(PINCH_FORMING - 0.005, true)).toBe(false)
  })

  it('keeps its state when joints are missing', () => {
    expect(pokeAllowed(NaN, true)).toBe(true)
    expect(pokeAllowed(NaN, false)).toBe(false)
  })
})

describe('poke press', () => {
  it('presses at the surface, not centimetres in front of it', () => {
    expect(pokePressed(false, touching(0.03))).toBe(false)
    expect(pokePressed(false, touching(POKE_DOWN + 0.002))).toBe(false)
    expect(pokePressed(false, touching(POKE_DOWN))).toBe(true)
    expect(pokePressed(false, touching(0))).toBe(true)
  })

  it('only presses from the front, while allowed and active', () => {
    expect(pokePressed(false, touching(0, { front: false }))).toBe(false)
    expect(pokePressed(false, touching(0, { allowed: false }))).toBe(false)
    expect(pokePressed(false, touching(0, { enabled: false }))).toBe(false)
    expect(pokePressed(false, touching(NaN))).toBe(false)
  })

  it('holds a press while the finger slides along or sinks into the surface', () => {
    expect(pokePressed(true, touching(POKE_UP - 0.002))).toBe(true)
    expect(pokePressed(true, touching(-0.02))).toBe(true)
    // The gate only guards new presses: a pinch forming mid-slide does not drop the card.
    expect(pokePressed(true, touching(0.005, { allowed: false }))).toBe(true)
  })

  it('releases after a clear lift, a push far through, or losing the pointer', () => {
    expect(pokePressed(true, touching(POKE_UP + 0.001))).toBe(false)
    expect(pokePressed(true, touching(-POKE_THROUGH - 0.001))).toBe(false)
    expect(pokePressed(true, touching(0, { enabled: false }))).toBe(false)
    expect(pokePressed(true, touching(NaN))).toBe(false)
  })
})

describe('on-board drag depth', () => {
  const lift = 0.015
  it('keeps a grabbed card in the hand up to the tear-off distance', () => {
    expect(onBoardDragZ('grab', 0.005, lift)).toBe(lift)
    expect(onBoardDragZ('grab', 0.07, lift)).toBe(0.07)
    expect(onBoardDragZ('grab', 0.5, lift)).toBe(TEAR_OFF_DIST)
  })

  it('keeps a poked card under the fingertip and ray drags at the skin lift', () => {
    expect(onBoardDragZ('touch', 0.02, lift)).toBeLessThan(lift)
    expect(onBoardDragZ('ray', 0.3, lift)).toBe(lift)
    expect(onBoardDragZ('mouse', 0, lift)).toBe(lift)
  })
})
