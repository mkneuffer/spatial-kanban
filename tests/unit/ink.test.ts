import { beforeEach, describe, expect, it } from 'vitest'
import { addPoint, eraserPad, finishStroke, inkDiff, rubOut, toUnits } from '../../src/board/ink'
import { useBoardStore } from '../../src/data/store'
import { createDemoBoard } from '../../src/data/seed'
import type { InkStroke } from '../../src/data/model'
import { fitTitle, trayItems, whiteboardLayout, whiteboardMetrics } from '../../src/skins/whiteboard/layout'
import { approximateMeasure } from '../../src/board/text'

const size: [number, number] = [1.6, 1]
let n = 0
const id = () => `p${++n}`

/** A horizontal stroke across the board at v = 0.5 m, one point every 1 cm. */
function line(u0: number, u1: number, v = 0.5, sid = 'line'): InkStroke {
  const points: number[] = []
  for (let u = u0; u <= u1 + 1e-9; u += 0.01) points.push(...toUnits(u, v, size))
  return { id: sid, color: '#000', width: 0.004 / 1.6, points }
}

describe('marker ink helpers', () => {
  it('stores points in board units and skips jitter smaller than the step', () => {
    const pts: number[] = []
    expect(addPoint(pts, 0.8, 0.5, size, 0.0025)).toBe(true)
    expect(addPoint(pts, 0.801, 0.5, size, 0.0025)).toBe(false)
    expect(addPoint(pts, 0.81, 0.5, size, 0.0025)).toBe(true)
    expect(pts).toEqual([0.5, 0.5, 0.50625, 0.5])
  })

  it('turns a single click into a short dot so it renders', () => {
    expect(finishStroke([0.5, 0.5], 0.01)).toHaveLength(4)
    const long = [0, 0, 1, 1]
    expect(finishStroke(long, 0.01)).toBe(long)
  })

  it('leaves strokes the eraser misses untouched', () => {
    const s = line(0.2, 0.4)
    const r = rubOut([s], eraserPad(1.2, 0.5, 1), size, id)
    expect(r.changed).toBe(false)
    expect(r.strokes[0]).toBe(s)
  })

  it('splits a stroke where the eraser rubs through its middle', () => {
    const s = line(0.2, 0.8)
    const r = rubOut([s], eraserPad(0.5, 0.5, 1), size, id)
    expect(r.changed).toBe(true)
    expect(r.strokes).toHaveLength(2)
    const [left, right] = r.strokes
    // Everything within the pad's reach (3.9 cm half length + 2.3 cm radius) is gone.
    expect(left.points.at(-2)! * 1.6).toBeLessThan(0.5 - 0.05)
    expect(right.points[0] * 1.6).toBeGreaterThan(0.5 + 0.05)
    expect(left.color).toBe(s.color)
  })

  it('wipes a short stroke completely', () => {
    const r = rubOut([line(0.49, 0.51)], eraserPad(0.5, 0.5, 1), size, id)
    expect(r.strokes).toEqual([])
  })

  it('describes an erase as removed ids plus the pieces left behind', () => {
    const s = line(0.2, 0.8)
    const keep = line(0.2, 0.3, 0.1, 'keep')
    const after = rubOut([s, keep], eraserPad(0.5, 0.5, 1), size, id).strokes
    const diff = inkDiff([s, keep], after)
    expect(diff.ids).toEqual(['line'])
    expect(diff.add).toHaveLength(2)
  })
})

describe('ink actions', () => {
  const st = () => useBoardStore.getState()
  beforeEach(() => st().load(createDemoBoard()))

  it('adds, erases (with leftover pieces) and clears ink, each as one undo step', () => {
    st().dispatch({ type: 'ink/add', stroke: line(0.2, 0.8) })
    expect(st().doc.board.ink).toHaveLength(1)
    const pieces = rubOut(st().doc.board.ink!, eraserPad(0.5, 0.5, 1), size, id).strokes
    st().dispatch({ type: 'ink/erase', ...inkDiff(st().doc.board.ink!, pieces) })
    expect(st().doc.board.ink).toHaveLength(2)
    st().undo()
    expect(st().doc.board.ink!.map((s) => s.id)).toEqual(['line'])
    st().dispatch({ type: 'ink/clear' })
    expect(st().doc.board.ink).toEqual([])
    st().undo()
    expect(st().doc.board.ink).toHaveLength(1)
  })

  it('ignores empty strokes and erasing nothing', () => {
    st().dispatch({ type: 'ink/add', stroke: { id: 'x', color: '#000', width: 0.01, points: [0.5] } })
    st().dispatch({ type: 'ink/erase', ids: ['nope'] })
    expect(st().doc.board.ink ?? []).toEqual([])
    expect(st().past).toHaveLength(0)
  })

  it('does not touch the board timestamp (ink is never synced)', () => {
    const before = st().doc.board.updatedAt
    st().dispatch({ type: 'ink/add', stroke: line(0.2, 0.3) })
    expect(st().doc.board.updatedAt).toBe(before)
  })
})

describe('whiteboard tray and note text', () => {
  const doc = createDemoBoard(new Date('2026-09-28T12:00:00Z'))

  it('puts three markers and an eraser in the tray, below the board and clear of the move handle', () => {
    const L = whiteboardLayout({ doc, size, options: { measure: approximateMeasure } })
    expect(L.tray!.map((t) => t.id)).toEqual(['black', 'blue', 'red', 'eraser'])
    for (const t of L.tray!) {
      expect(t.rect.y).toBeGreaterThanOrEqual(size[1])
      expect(t.rect.y + t.rect.h).toBeLessThan(L.handle.y)
    }
    // Markers don't overlap each other or the eraser.
    const r = L.tray!.map((t) => t.rect)
    for (let i = 0; i + 1 < r.length; i++) expect(r[i].x + r[i].w).toBeLessThanOrEqual(r[i + 1].x + 1e-9)
  })

  it('scales the tray with the board', () => {
    const small = trayItems([0.6, 0.38], 0.375)
    for (const t of small) expect(t.rect.x + t.rect.w).toBeLessThan(0.6)
  })

  const M = whiteboardMetrics(1)
  const s = 0.11
  const innerW = s - 2 * M.notePad
  const availH = s - 2 * M.notePad - M.dotD * 1.35

  it('writes short titles big and long titles smaller, never cutting words', () => {
    const short = fitTitle('Rate limit the API', innerW, availH, M, approximateMeasure)
    const long = fitTitle('Fix memory leak in the websocket reconnect loop on idle tabs', innerW, availH, M, approximateMeasure)
    expect(short.size).toBeGreaterThan(long.size)
    expect(long.lines.join(' ')).toBe('Fix memory leak in the websocket reconnect loop on idle tabs')
    for (const l of long.lines) expect(approximateMeasure(l, 'Caveat', long.size, 700)).toBeLessThanOrEqual(innerW + 1e-9)
    expect((long.lines.length - 1) * long.size * M.lineH + long.size).toBeLessThanOrEqual(availH + 1e-9)
  })

  it('cuts with an ellipsis only when even the smallest handwriting cannot fit', () => {
    const essay = fitTitle('word '.repeat(80).trim(), innerW, availH, M, approximateMeasure)
    expect(essay.size).toBe(M.minTextSize)
    expect(essay.lines.at(-1)!.endsWith('…')).toBe(true)
  })
})
