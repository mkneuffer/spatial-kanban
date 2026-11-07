import { beforeEach, describe, expect, it } from 'vitest'
import { onPaper, paperSurface } from '../../src/render/paper'
import { addPoint, eraserPad, finishStroke, inkDiff, rubOut, toUnits } from '../../src/board/ink'
import { useBoardStore } from '../../src/data/store'
import { createDemoBoard } from '../../src/data/seed'
import type { InkStroke } from '../../src/data/model'
import { fitTitle, trayGeometry, trayItems, whiteboardLayout, whiteboardMetrics } from '../../src/skins/whiteboard/layout'
import { Euler, Quaternion, Vector3 } from 'three'
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
    // Everything within the pad's reach (4 cm half length + 2.4 cm radius) is gone.
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

describe('the tray holds its markers and eraser properly', () => {
  const sizes: Array<[string, [number, number]]> = [
    ['poster', [1.6, 1.0]],
    ['desk', [0.9, 0.56]],
    ['compact', [0.6, 0.38]],
  ]
  it.each(sizes)('%s board: everything rests on the shelf, in front of the frame and behind the lip', (_n, size) => {
    const k = Math.min(size[0] / 1.6, size[1] / 1.0)
    const g = trayGeometry(size, k)
    const eps = 1e-9
    const items = [
      ...g.markers.map((m) => ({ x: m.x, w: m.w, bottom: m.y - m.h / 2, z0: m.z - m.h / 2, z1: m.z + m.h / 2 })),
      { x: g.eraser.x, w: g.eraser.w, bottom: g.eraser.y - g.eraser.h / 2, z0: g.eraser.z - g.eraser.d / 2, z1: g.eraser.z + g.eraser.d / 2 },
    ]
    for (const it of items) {
      // Sitting on the shelf: never sunk into it, and at most a millimetre up (the eraser rides on its felt).
      expect(it.bottom).toBeGreaterThanOrEqual(g.trayTop - eps)
      expect(it.bottom - g.trayTop).toBeLessThan(0.001 * k)
      // Clear of the board frame behind and the lip in front.
      expect(it.z0).toBeGreaterThan(g.frameFront)
      expect(it.z1).toBeLessThan(g.lipBack)
      // Within the tray's length.
      expect(it.x - it.w / 2).toBeGreaterThan(-g.trayW / 2)
      expect(it.x + it.w / 2).toBeLessThan(g.trayW / 2)
    }
    // Side by side without touching.
    for (let i = 0; i + 1 < items.length; i++) expect(items[i].x + items[i].w / 2).toBeLessThan(items[i + 1].x - items[i + 1].w / 2)
    // The lip stands taller than a marker's radius, so a marker can't roll off.
    expect(g.lipH).toBeGreaterThan(g.markers[0].h / 2)
  })

  it.each(sizes)('%s board: no two tray parts share a face plane (no z-fighting)', (_n, size) => {
    const k = Math.min(size[0] / 1.6, size[1] / 1.0)
    const g = trayGeometry(size, k)
    type Box = { x: number; y: number; z: number; w: number; h: number; d: number }
    const span = (b: Box, axis: 'x' | 'y' | 'z'): [number, number] => {
      const half = { x: b.w, y: b.h, z: b.d }[axis] / 2
      return [b[axis] - half, b[axis] + half]
    }
    const e = g.eraser
    const boxes: Record<string, Box> = {
      shelf: g.shelfBox,
      lip: g.lipBox,
      frame: g.frameBar,
      // The eraser's pad face is its bottom.
      eraser: { x: e.x, y: e.y, z: e.z, w: e.w, h: e.h, d: e.d },
    }
    const names = Object.keys(boxes)
    const axes = ['x', 'y', 'z'] as const
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const A = boxes[names[i]], B = boxes[names[j]]
        for (const axis of axes) {
          const others = axes.filter((a) => a !== axis)
          // Faces in the same plane only fight where they overlap in the other two axes.
          const overlap = others.every((o) => {
            const [a0, a1] = span(A, o), [b0, b1] = span(B, o)
            return Math.min(a1, b1) - Math.max(a0, b0) > 1e-9
          })
          if (!overlap) continue
          for (const fa of span(A, axis))
            for (const fb of span(B, axis))
              expect(Math.abs(fa - fb), `${names[i]} and ${names[j]} share a ${axis} plane`).toBeGreaterThan(0.0002 * k)
        }
      }
  })

  it('lays a marker clip-up along the tray (model +Z up, barrel +Y along the tray)', () => {
    const q = new Quaternion().setFromEuler(new Euler(0, -Math.PI / 2, -Math.PI / 2, 'ZYX'))
    const up = new Vector3(0, 0, 1).applyQuaternion(q)
    const along = new Vector3(0, 1, 0).applyQuaternion(q)
    expect(up.y).toBeCloseTo(1)
    expect(along.x).toBeCloseTo(1)
  })
})

describe('note content follows the paper curl', () => {
  // A 11 cm note; pieces of content spread over it, from the top line to the bottom-right initials.
  const w = 0.11, h = 0.11
  const pieces = [
    { top: 0.01, bottom: 0.035, right: 0.1, anchor: 0 },
    { top: 0.045, bottom: 0.07, right: 0.1, anchor: 0 },
    { top: 0.085, bottom: 0.1, right: 0.02, anchor: 0.5 },
    { top: 0.086, bottom: 0.101, right: 0.101, anchor: 0.5 },
  ]
  it.each([0, 0.02, 0.12, 0.5, 1])('curl %s: every piece lies on or just above the paper, never behind it', (curl) => {
    for (const pc of pieces) {
      const p = onPaper(w, h, curl, pc.top, pc.bottom, pc.right, pc.anchor)
      const anchorY = pc.top + (pc.bottom - pc.top) * pc.anchor
      // The piece is a straight segment in (rendered y down the note, lift): through its anchor, at its tilt.
      const ay = anchorY - p.dy
      const pieceAt = (yr: number) => p.dz + Math.tan(-p.tilt) * (yr - ay)
      for (let i = 0; i <= 40; i++) {
        const y = pc.top + ((pc.bottom - pc.top) * i) / 40
        for (const x of [0, pc.right]) {
          // The paper point that started at y is drawn slid up by dy and lifted by dz.
          const s0 = paperSurface(w, h, curl, x / w, 1 - y / h)
          const yr = y - s0.dy
          expect(pieceAt(yr)).toBeGreaterThanOrEqual(s0.dz - 1e-4 * h)
          // ...and stays close to it: the content curls with the note rather than floating off it.
          expect(pieceAt(yr) - s0.dz).toBeLessThan(0.006)
        }
      }
      // The piece's ends land on the paper's ends (within its 0.7 mm text offset's worth).
      const len = (pc.bottom - pc.top) * p.yScale
      const end = { y: ay + Math.cos(p.tilt) * len * (1 - pc.anchor), z: p.dz + Math.sin(-p.tilt) * len * (1 - pc.anchor) }
      const b = paperSurface(w, h, curl, pc.right / w, 1 - pc.bottom / h)
      if (pc.right / w <= 0.72) {
        expect(Math.abs(end.y - (pc.bottom - b.dy))).toBeLessThan(2e-4)
        expect(Math.abs(end.z - b.dz)).toBeLessThan(2e-4)
      }
    }
  })
  it('flat notes keep flat content', () => {
    const p = onPaper(w, h, 0, 0.01, 0.035, 0.05, 0)
    expect(p.tilt).toBeCloseTo(0, 12)
    expect(p.dz).toBeCloseTo(0, 12)
  })
})
