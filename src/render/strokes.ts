import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import { hash01 } from '../board/space'

/**
 * Hand-drawn marker strokes (whiteboard skin): wobbly polylines turned into
 * flat ribbons and merged into a single geometry → one draw call.
 */

export type P2 = [number, number]

export interface Stroke {
  points: P2[]
  width: number
  color: string
}

/** A slightly wobbly line from a to b, seeded so it's stable across sessions. */
export function wobblyLine(a: P2, b: P2, seed: string, amp: number, segments = 18): P2[] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const p1 = hash01(seed, 11) * Math.PI * 2
  const p2 = hash01(seed, 12) * Math.PI * 2
  const f1 = 1 + hash01(seed, 13) * 1.5
  const f2 = 3 + hash01(seed, 14) * 3
  const pts: P2[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    // Taper the wobble to zero at the ends so strokes meet cleanly.
    const w = Math.sin(Math.PI * t) * amp * (0.7 * Math.sin(p1 + t * Math.PI * f1) + 0.3 * Math.sin(p2 + t * Math.PI * f2))
    pts.push([a[0] + dx * t + nx * w, a[1] + dy * t + ny * w])
  }
  return pts
}

export function wobblyRect(cx: number, cy: number, w: number, h: number, seed: string, amp: number): P2[][] {
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const y0 = cy - h / 2
  const y1 = cy + h / 2
  const o = amp * 0.8 // overshoot corners like a real marker
  return [
    wobblyLine([x0 - o, y1], [x1 + o * 0.5, y1 + o * 0.3], seed + 't', amp),
    wobblyLine([x1, y1 + o], [x1 - o * 0.3, y0 - o], seed + 'r', amp),
    wobblyLine([x1 + o * 0.4, y0], [x0 - o, y0 - o * 0.2], seed + 'b', amp),
    wobblyLine([x0, y0 - o * 0.5], [x0 + o * 0.3, y1 + o], seed + 'l', amp),
  ]
}

export function wobblyCircle(cx: number, cy: number, r: number, seed: string, amp: number, segments = 28): P2[] {
  const start = hash01(seed, 21) * Math.PI * 2
  const pts: P2[] = []
  for (let i = 0; i <= segments + 3; i++) {
    const t = start + (i / segments) * Math.PI * 2
    const rr = r + amp * Math.sin(t * 3 + hash01(seed, 22) * 6)
    pts.push([cx + Math.cos(t) * rr * 1.15, cy + Math.sin(t) * rr])
  }
  return pts
}

export function buildStrokeGeometry(strokes: Stroke[], z: number): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const c = new Color()
  for (const s of strokes) {
    c.set(s.color)
    const n = s.points.length
    if (n < 2) continue
    const base = pos.length / 3
    for (let i = 0; i < n; i++) {
      const p = s.points[i]
      const prev = s.points[Math.max(0, i - 1)]
      const next = s.points[Math.min(n - 1, i + 1)]
      let tx = next[0] - prev[0]
      let ty = next[1] - prev[1]
      const tl = Math.hypot(tx, ty) || 1
      tx /= tl
      ty /= tl
      // Marker pressure: slightly thinner at the ends.
      const t = i / (n - 1)
      const w = (s.width / 2) * (0.75 + 0.25 * Math.sin(Math.PI * t))
      pos.push(p[0] - ty * w, p[1] + tx * w, z, p[0] + ty * w, p[1] - tx * w, z)
      col.push(c.r, c.g, c.b, c.r, c.g, c.b)
      if (i < n - 1) {
        const a = base + i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}
