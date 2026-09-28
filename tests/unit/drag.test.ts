import { describe, expect, it } from 'vitest'
import { dragReducer, IDLE, pickColumn, type DragContext, type DragEvent, type DragState, NEW_CARD_ID } from '../../src/board/drag'
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

const down = (kind: 'ray' | 'grab' = 'ray', t = 0, source: 'board' | 'pad' | 'free' = 'board', id: string | null = card.id): DragEvent => ({
  type: 'down',
  pointerId: 1,
  pointerKind: kind,
  cardId: id,
  source,
  point: { u: cu, v: cv, z: 0, t },
  cardCenter: [cu, cv],
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

  it('ignores other pointers', () => {
    const { state } = run([down(), { type: 'move', pointerId: 2, point: { u: 0, v: 0, z: 0, t: 10 } }])
    expect(state.phase).toBe('pressed')
  })
})
