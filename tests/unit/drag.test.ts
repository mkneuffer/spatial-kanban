import { describe, expect, it } from 'vitest'
import { dragReducer, IDLE, MAX_TAP_SLOP, onBoardDragZ, pickColumn, TAP_MAX_DIST, TEAR_OFF_DIST, tapSlop, tearOffHeight, type DragContext, type DragEvent, type DragState, NEW_CARD_ID } from '../../src/board/drag'
import { projectsLayout, projectsInsertionIndex } from '../../src/skins/projects/layout'
import { approximateMeasure } from '../../src/board/text'
import { createDemoBoard } from '../../src/data/seed'
import { cardsInColumn } from '../../src/data/ordering'

const doc = createDemoBoard()
const layout = projectsLayout({ doc, size: [1.6, 1], options: { measure: approximateMeasure } })
const ctx: DragContext = { layout, insertionIndex: projectsInsertionIndex as DragContext['insertionIndex'], downLocal: [0, -1, 0] }
const [c0, c1] = layout.columns
const card = cardsInColumn(doc.cards, c0.id)[0]
const slot = layout.cards[card.id]
const cu = slot.rect.x + slot.rect.w / 2
const cv = slot.rect.y + slot.rect.h / 2

function run(events: DragEvent[], start: DragState = IDLE) {
  let state = start
  const effects = []
  for (const e of events) {
    const r = dragReducer(state, e, ctx)
    state = r.state
    effects.push(...r.effects)
  }
  return { state, effects }
}

const down = (kind: 'ray' | 'grab' | 'touch' = 'ray', t = 0, source: 'board' | 'pad' | 'free' = 'board', id: string | null = card.id, z = 0, slop?: number): DragEvent => ({
  type: 'down',
  pointerId: 1,
  pointerKind: kind,
  cardId: id,
  source,
  point: { u: cu, v: cv, z, t },
  cardCenter: [cu, cv],
  slop,
})
const move = (u: number, v: number, z = 0, t = 50): DragEvent => ({ type: 'move', pointerId: 1, point: { u, v, z, t } })
const up = (u: number, v: number, z = 0, t = 100): DragEvent => ({ type: 'up', pointerId: 1, point: { u, v, z, t } })

describe('pickColumn', () => {
  it('keeps the previous column within the hysteresis band', () => {
    const edge = c0.rect.x + c0.rect.w + 0.01
    expect(pickColumn(layout.columns, edge, c0.id)?.id).toBe(c0.id)
    expect(pickColumn(layout.columns, edge + 0.02, c0.id)?.id).toBe(c1.id)
  })
  it('clamps to the outermost columns', () => {
    expect(pickColumn(layout.columns, -1, null)?.id).toBe(c0.id)
    expect(pickColumn(layout.columns, 9, null)?.id).toBe(layout.columns.at(-1)!.id)
  })
})

describe('dragReducer', () => {
  it('opens details on a quick tap', () => {
    const { effects, state } = run([down(), up(cu + 0.002, cv, 0, 90)])
    expect(effects).toContainEqual({ type: 'detail', cardId: card.id })
    expect(state.phase).toBe('idle')
  })

  it('does not open details on a long press', () => {
    const { effects } = run([down(), up(cu, cv, 0, 900)])
    expect(effects.some((e) => e.type === 'detail')).toBe(false)
  })

  it('drags to another column and commits one move', () => {
    const tu = c1.rect.x + c1.rect.w / 2
    const { effects } = run([down(), move(cu + 0.05, cv), move(tu, c1.body.y + 0.01, 0, 80), up(tu, c1.body.y + 0.01)])
    expect(effects).toContainEqual({ type: 'commit', cardId: card.id, columnId: c1.id, index: 0 })
    expect(effects.filter((e) => e.type === 'commit')).toHaveLength(1)
    expect(effects).toContainEqual({ type: 'haptic', strength: 'firm' })
  })

  it('archives when dropped on the bin', () => {
    const bu = layout.bin.x + layout.bin.w / 2
    const bv = layout.bin.y + layout.bin.h / 2
    const { effects } = run([down(), move(cu, cv + 0.05), move(bu, bv, 0, 80), up(bu, bv)])
    expect(effects).toContainEqual({ type: 'archive', cardId: card.id })
  })

  it('tears off with a grab pointer pulled > 12 cm, then parks on release', () => {
    const { effects, state } = run([down('grab'), move(cu, cv + 0.02, 0.02, 20), move(cu, cv, 0.15, 60)])
    expect(state.phase).toBe('dragFree')
    expect(effects).toContainEqual({ type: 'sound', name: 'tear' })
    const r = dragReducer(state, up(cu, cv, 0.15, 400), ctx)
    expect(r.effects.some((e) => e.type === 'park')).toBe(true)
  })

  it('ray pointers never tear off', () => {
    const { state } = run([down('ray'), move(cu, cv + 0.02, 0.5)])
    expect(state.phase).toBe('dragOnBoard')
  })

  it('reattaches with hysteresis', () => {
    let { state } = run([down('grab'), move(cu, cv + 0.02, 0.02, 20), move(cu, cv, 0.15, 40)])
    state = dragReducer(state, move(cu, cv, 0.09, 60), ctx).state
    expect(state.phase).toBe('dragFree') // between 6 and 12 cm: still free
    state = dragReducer(state, move(cu, cv, 0.04, 80), ctx).state
    expect(state.phase).toBe('dragOnBoard')
  })

  it('throwing a free card downward archives it', () => {
    let { state } = run([down('grab'), move(cu, cv + 0.02, 0.02, 20), move(cu, cv, 0.2, 40)])
    state = dragReducer(state, move(cu, cv + 0.05, 0.2, 60), ctx).state
    const r = dragReducer(state, up(cu, cv + 0.35, 0.2, 140), ctx)
    expect(r.effects).toContainEqual({ type: 'archive', cardId: card.id })
  })

  it('creates a card when dragging from the pad', () => {
    const tu = c1.rect.x + c1.rect.w / 2
    const { effects } = run([down('ray', 0, 'pad', NEW_CARD_ID), move(tu, c1.body.y + 0.3), up(tu, c1.body.y + 0.3)])
    expect(effects.some((e) => e.type === 'create' && e.columnId === c1.id)).toBe(true)
  })

  it('a tap on the pad is a padTap', () => {
    const { effects } = run([down('ray', 0, 'pad', NEW_CARD_ID), up(cu, cv, 0, 60)])
    expect(effects).toContainEqual({ type: 'padTap' })
  })

  it('a far ray tap tolerates jitter that would start a drag up close', () => {
    const slop = tapSlop('ray', 2.5)
    expect(slop).toBeGreaterThan(TAP_MAX_DIST)
    const far = run([down('ray', 0, 'board', card.id, 0, slop), move(cu + 0.03, cv, 0, 40), up(cu + 0.03, cv, 0, 120)])
    expect(far.effects).toContainEqual({ type: 'detail', cardId: card.id })
    const near = run([down('ray', 0, 'board', card.id, 0, tapSlop('ray', 0.3)), move(cu + 0.03, cv, 0, 40)])
    expect(near.state.phase).toBe('dragOnBoard')
  })

  it('measures tear-off from where a grab picked the card up', () => {
    // Grabbed from 7 cm away (a controller grip's reach): pulling to 15 cm is only 8 cm of pull.
    let { state } = run([down('grab', 0, 'board', card.id, 0.07), move(cu, cv + 0.02, 0.08, 20), move(cu, cv, 0.15, 60)])
    expect(state.phase).toBe('dragOnBoard')
    state = dragReducer(state, move(cu, cv, 0.2, 80), ctx).state
    expect(state.phase).toBe('dragFree')
  })

  it('a poke tap opens details although the fingertip lifts off the surface to release', () => {
    const { effects } = run([down('touch', 0, 'board', card.id, 0.004), move(cu + 0.002, cv, 0.012, 40), up(cu + 0.003, cv, 0.02, 150)])
    expect(effects).toContainEqual({ type: 'detail', cardId: card.id })
  })

  it('a grabbed card follows the hand up to the height it tears off at', () => {
    const lift = 0.015
    const grabbedFar = { source: 'board' as const, start: { u: cu, v: cv, z: 0.05, t: 0 } }
    expect(tearOffHeight(grabbedFar)).toBeCloseTo(0.05 + TEAR_OFF_DIST)
    expect(tearOffHeight({ source: 'free', start: { u: cu, v: cv, z: 0.3, t: 0 } })).toBe(TEAR_OFF_DIST)
    // Hand at 15 cm, grabbed from 5 cm: still on the board, and the card stays in the hand.
    expect(onBoardDragZ('grab', 0.15, lift, tearOffHeight(grabbedFar))).toBeCloseTo(0.15)
  })

  it('a tap on a parked card opens its details instead of re-parking it', () => {
    const { effects, state } = run([down('ray', 0, 'free', card.id, 0.3), up(cu + 0.002, cv, 0.3, 90)])
    expect(effects).toContainEqual({ type: 'detail', cardId: card.id })
    expect(effects.some((e) => e.type === 'park')).toBe(false)
    expect(state.phase).toBe('idle')
  })

  it('dragging a parked card keeps it free until it is back over the board', () => {
    let { state } = run([down('ray', 0, 'free', card.id, 0.3), move(-0.4, cv, 0.3, 30)])
    expect(state.phase).toBe('dragFree')
    const r = dragReducer(state, up(-0.5, cv, 0.3, 200), ctx)
    const park = r.effects.find((e) => e.type === 'park')
    expect(park && park.type === 'park' && park.position[2]).toBeCloseTo(0.3)
    state = dragReducer(state, move(cu, cv, 0.3, 60), ctx).state
    expect(state.phase).toBe('dragOnBoard')
  })

  it('cancel returns to idle', () => {
    const { state, effects } = run([down(), move(cu + 0.05, cv), { type: 'cancel', pointerId: 1 }])
    expect(state.phase).toBe('idle')
    expect(effects).toContainEqual({ type: 'cancel' })
  })

  it('ignores other pointers', () => {
    const { state } = run([down(), { type: 'move', pointerId: 2, point: { u: 0, v: 0, z: 0, t: 10 } }])
    expect(state.phase).toBe('pressed')
  })
})

describe('tapSlop', () => {
  it('is fixed for direct pointers and scales with distance for rays, within bounds', () => {
    expect(tapSlop('grab', 3)).toBe(TAP_MAX_DIST)
    expect(tapSlop('touch', 3)).toBe(TAP_MAX_DIST)
    expect(tapSlop('ray', 0.2)).toBe(TAP_MAX_DIST)
    expect(tapSlop('ray', 3)).toBeGreaterThan(tapSlop('ray', 1))
    expect(tapSlop('ray', 50)).toBe(MAX_TAP_SLOP)
    expect(tapSlop('mouse', 2)).toBeLessThan(tapSlop('ray', 2))
    expect(tapSlop('ray', Number.NaN)).toBe(TAP_MAX_DIST)
  })
})
