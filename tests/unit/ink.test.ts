import { beforeEach, describe, expect, it } from 'vitest'
import { eraseFromStroke, useInk, type InkStroke } from '../../src/skins/whiteboard/ink'

const line = (n: number): InkStroke => ({ id: 's', color: '#000', width: 0.004, points: Array.from({ length: n }, (_, i) => [i * 0.01, 0] as [number, number]) })

describe('eraseFromStroke', () => {
  it('leaves strokes the eraser does not touch', () => {
    expect(eraseFromStroke(line(10), [0.05, 0.2], 0.02)).toBeNull()
  })

  it('splits a stroke where the eraser crosses it', () => {
    const res = eraseFromStroke(line(11), [0.05, 0], 0.012)!
    expect(res.kept).toHaveLength(2)
    expect(res.kept[0].at(-1)![0]).toBeLessThan(0.04)
    expect(res.kept[1][0][0]).toBeGreaterThan(0.06)
    expect(res.removed).toHaveLength(1)
  })

  it('erases a long segment that passes under the eraser between points', () => {
    const s: InkStroke = { id: 's', color: '#000', width: 0.004, points: [[0, 0], [0.5, 0]] }
    const res = eraseFromStroke(s, [0.25, 0.001], 0.01)!
    expect(res).not.toBeNull()
  })
})

describe('useInk', () => {
  beforeEach(() => useInk.setState({ boardId: null, strokes: [], ghosts: [], live: null, held: null }))

  it('commits a drawn stroke and leaves a ghost when erased', () => {
    const ink = useInk.getState()
    ink.begin('#1433bf', 0.004, [0, 0])
    for (let i = 1; i <= 20; i++) useInk.getState().extend([i * 0.005, 0])
    useInk.getState().end()
    expect(useInk.getState().strokes).toHaveLength(1)
    expect(useInk.getState().strokes[0].points.length).toBeGreaterThan(10)
    useInk.getState().erase([0.05, 0], 0.01)
    expect(useInk.getState().strokes).toHaveLength(2)
    expect(useInk.getState().ghosts.length).toBeGreaterThan(0)
  })
})
