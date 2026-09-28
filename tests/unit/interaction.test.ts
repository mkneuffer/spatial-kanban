import { describe, expect, it } from 'vitest'
import { Group, Vector3 } from 'three'
import { clipSpan } from '../../src/board/space'
import { useView } from '../../src/board/viewStore'
import { eventToBoard, isPrimaryButton, pointerKindOf, type XPointerEvent } from '../../src/board/BoardInteraction'

const size: [number, number] = [1.6, 1]

function board() {
  // A wall board 1.5 m up, facing +z.
  const g = new Group()
  g.position.set(0, 1.5, 0)
  g.updateMatrixWorld(true)
  return g
}

function rayEvent(origin: Vector3, through: Vector3, extra: Partial<XPointerEvent> = {}): XPointerEvent {
  return { pointerId: 1, pointerType: 'ray', point: through, pointerPosition: origin, target: new Group(), object: new Group(), stopPropagation() {}, ...extra }
}

describe('clipSpan', () => {
  it('keeps a span inside the range untouched', () => {
    expect(clipSpan(0, 0.2, -1, 1)).toEqual({ c: 0, len: 0.2 })
  })
  it('trims the part outside the range', () => {
    const r = clipSpan(0.9, 0.4, -1, 1)!
    expect(r.c).toBeCloseTo(0.85)
    expect(r.len).toBeCloseTo(0.3)
  })
  it('returns null when nothing is visible', () => {
    expect(clipSpan(2, 0.2, -1, 1)).toBeNull()
  })
})

describe('eventToBoard', () => {
  it('projects a ray through the board plane into board space', () => {
    const p = eventToBoard(rayEvent(new Vector3(0, 1.5, 2), new Vector3(0, 1.5, 0.01)), board(), size)!
    expect(p.u).toBeCloseTo(0.8)
    expect(p.v).toBeCloseTo(0.5)
    expect(p.z).toBe(0)
  })
  it('intersects a raised plane for parked cards', () => {
    // Ray at 45° down-left: the plane 0.3 m out is met 0.3 m before the board.
    const origin = new Vector3(1, 1.5, 1)
    const p = eventToBoard(rayEvent(origin, new Vector3(0.5, 1.5, 0.5)), board(), size, 0.3)!
    expect(p.u).toBeCloseTo(0.8 + 0.3)
    expect(p.z).toBeCloseTo(0.3)
  })
  it('returns null when the ray points away from or grazes the board', () => {
    expect(eventToBoard(rayEvent(new Vector3(0, 1.5, 2), new Vector3(0, 1.5, 3)), board(), size)).toBeNull()
    expect(eventToBoard(rayEvent(new Vector3(0, 1.5, 0.5), new Vector3(10, 1.5, 0.49)), board(), size)).toBeNull()
  })
  it('uses the 3D position for grab pointers', () => {
    const e = rayEvent(new Vector3(0.1, 1.6, 0.05), new Vector3(0.1, 1.6, 0.01), { pointerType: 'grab' })
    const p = eventToBoard(e, board(), size)!
    expect(p.u).toBeCloseTo(0.9)
    expect(p.v).toBeCloseTo(0.4)
    expect(p.z).toBeCloseTo(0.05)
  })
})

describe('pointer helpers', () => {
  it('classifies pointer types', () => {
    expect(pointerKindOf('screen-mouse')).toBe('mouse')
    expect(pointerKindOf('screen-touch')).toBe('screen')
    expect(pointerKindOf('grab')).toBe('grab')
    expect(pointerKindOf('touch')).toBe('touch')
    expect(pointerKindOf('ray')).toBe('ray')
  })
  it('only the primary button picks things up', () => {
    const e = rayEvent(new Vector3(), new Vector3(0, 0, -1))
    expect(isPrimaryButton(e)).toBe(true)
    expect(isPrimaryButton({ ...e, button: 2 })).toBe(false)
  })
})

describe('selection', () => {
  it('switching cards closes an editor that belongs to another card', () => {
    const v = useView.getState()
    v.set({ detailCardId: 'a', editCardId: 'a', editIsNew: true })
    useView.getState().select('b')
    expect(useView.getState()).toMatchObject({ detailCardId: 'b', editCardId: null, editIsNew: false })
  })
  it('re-selecting the edited card keeps the editor open', () => {
    useView.getState().set({ detailCardId: 'a', editCardId: 'a', editIsNew: false })
    useView.getState().select('a')
    expect(useView.getState()).toMatchObject({ detailCardId: 'a', editCardId: 'a' })
  })
  it('clearing the selection closes the editor', () => {
    useView.getState().set({ detailCardId: 'a', editCardId: 'a' })
    useView.getState().select(null)
    expect(useView.getState()).toMatchObject({ detailCardId: null, editCardId: null })
  })
})
