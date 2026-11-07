import type { InkStroke } from '../data/model'
import type { Rect } from './space'

/**
 * Whiteboard marker ink (pure helpers). Strokes are stored in board units
 * (0..1 of width and height) so they survive a board resize; everything here
 * converts to meters with the board size when distances matter.
 */

/** A marker or the eraser, as it sits in the whiteboard's tray. */
export interface TrayItem {
  id: string
  kind: 'marker' | 'eraser'
  /** Ink color (markers); the eraser's felt color. */
  color: string
  /** Board space (meters, v down). The tray hangs below the board, so v > height. */
  rect: Rect
}

/** The tool in hand: one of the tray's markers, or the eraser. */
export interface InkTool {
  id: string
  kind: 'marker' | 'eraser'
  color: string
}

/** Marker line width in meters on the 1.6 m poster board (scaled with the board). */
export const MARKER_WIDTH = 0.0042
/** The eraser's felt pad (12.8 × 4.8 cm on the poster board) as a capsule: half the straight length, and the radius. */
export const ERASER_RADIUS = 0.024
export const ERASER_HALF = 0.04
/** A new point is added once the tip has moved this far (meters, scaled). */
export const MIN_STEP = 0.0025

/** Board meters → stored board units. */
export function toUnits(u: number, v: number, size: readonly [number, number]): [number, number] {
  return [round(u / size[0]), round(v / size[1])]
}

function round(x: number) {
  return Math.round(x * 1e5) / 1e5
}

/** Append a point (board meters) to a flat unit list if it moved far enough. Returns true when added. */
export function addPoint(points: number[], u: number, v: number, size: readonly [number, number], minStep: number): boolean {
  const n = points.length
  if (n >= 2) {
    const du = (u / size[0] - points[n - 2]) * size[0]
    const dv = (v / size[1] - points[n - 1]) * size[1]
    if (du * du + dv * dv < minStep * minStep) return false
  }
  const [a, b] = toUnits(u, v, size)
  points.push(a, b)
  return true
}

/** Distance from p to segment ab, all in meters. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** The eraser's felt pad: a horizontal capsule centered on (u, v), in meters. */
export interface EraserPad {
  u: number
  v: number
  /** Half the length of the pad's straight part. */
  half: number
  r: number
}

export function eraserPad(u: number, v: number, k: number): EraserPad {
  return { u, v, half: ERASER_HALF * k, r: ERASER_RADIUS * k }
}

function underPad(pad: EraserPad, x: number, y: number, reach: number) {
  return segDist(x, y, pad.u - pad.half, pad.v, pad.u + pad.half, pad.v) <= pad.r + reach
}

/**
 * Rub the eraser over the ink: points under the pad are wiped, and a stroke
 * that loses its middle splits into the pieces that are left. Strokes it
 * doesn't touch are returned as the same objects. `newId` names the pieces.
 */
export function rubOut(strokes: readonly InkStroke[], pad: EraserPad, size: readonly [number, number], newId: () => string): { strokes: InkStroke[]; changed: boolean } {
  const [W, H] = size
  const out: InkStroke[] = []
  let changed = false
  for (const s of strokes) {
    const p = s.points
    const reach = (s.width * W) / 2
    const keep: boolean[] = []
    let any = false
    for (let i = 0; i + 1 < p.length; i += 2) {
      const hit = underPad(pad, p[i] * W, p[i + 1] * H, reach)
      keep.push(!hit)
      if (hit) any = true
    }
    if (!any) {
      out.push(s)
      continue
    }
    changed = true
    let run: number[] = []
    const flush = () => {
      if (run.length >= 4) out.push({ id: newId(), color: s.color, width: s.width, points: run })
      run = []
    }
    keep.forEach((k, j) => {
      if (k) run.push(p[j * 2], p[j * 2 + 1])
      else flush()
    })
    flush()
  }
  return { strokes: changed ? out : (strokes as InkStroke[]), changed }
}

/** What an erase changed, as one action: strokes removed and the pieces left behind. */
export function inkDiff(before: readonly InkStroke[], after: readonly InkStroke[]): { ids: string[]; add: InkStroke[] } {
  const was = new Set(before.map((s) => s.id))
  const now = new Set(after.map((s) => s.id))
  return { ids: [...was].filter((id) => !now.has(id)), add: after.filter((s) => !was.has(s.id)) }
}

/** A single click with a marker leaves a dot: turn a one-point stroke into a tiny segment so it renders. */
export function finishStroke(points: number[], width: number): number[] {
  if (points.length !== 2) return points
  // `width` is already in units of the board width, like u.
  const du = width * 0.35
  return [points[0] - du / 2, points[1], points[0] + du / 2, points[1]]
}

/** Is board point (u, v) on the writable whiteboard surface? */
export function onBoard(u: number, v: number, size: readonly [number, number]): boolean {
  return u >= 0 && v >= 0 && u <= size[0] && v <= size[1]
}
