import { create } from 'zustand'
import type { P2 } from '../../render/strokes'

/**
 * Dry-erase ink drawn with the whiteboard's markers. Strokes live in board-local
 * meters (origin at the board center, y up), so they stay put when the board is
 * resized or moved. Ink is per board and per device, like a real whiteboard:
 * it is not part of the synced board document.
 */

export type MarkerId = 'black' | 'blue' | 'red'
export type ToolId = MarkerId | 'eraser'

/**
 * The three Alyx markers (ink colors as in Alyx-Physics' alyx-room.js). `width` is the line width in
 * meters: black and red are the medium tip, blue the bold one, like there.
 */
export const MARKERS: Record<MarkerId, { ink: string; body: string; label: string; width: number; model: string }> = {
  black: { ink: '#0d0d0f', body: '#2a2e35', label: 'Black', width: 0.004, model: 'Alyx_Marker_Black' },
  blue: { ink: '#1433bf', body: '#1f5fbf', label: 'Blue', width: 0.0055, model: 'Alyx_Marker_Blue' },
  red: { ink: '#cc120f', body: '#c62828', label: 'Red', width: 0.004, model: 'Alyx_Marker_Red' },
}
export const MARKER_ORDER: MarkerId[] = ['black', 'red', 'blue']

export interface InkStroke {
  id: string
  color: string
  /** Nib width in meters. */
  width: number
  points: P2[]
}

/** A faint trace left behind by the eraser, like real dry-erase ghosting. */
export interface InkGhost {
  color: string
  width: number
  points: P2[]
}

/** Which tool is in hand, and what is holding it. */
export interface HeldTool {
  tool: ToolId
  /** 'pointer': mouse, touch or a far ray draws where it points. 'hand': the tool sits in a hand or controller and draws by touching the board. */
  by: 'pointer' | 'hand'
  /** The XR input source holding it (hand mode). */
  source?: XRInputSource
}

interface InkState {
  boardId: string | null
  strokes: InkStroke[]
  ghosts: InkGhost[]
  /** The stroke being drawn right now (not yet committed). */
  live: InkStroke | null
  held: HeldTool | null
  /** Bumped on every change to committed ink so the mesh rebuilds. */
  version: number
  load(boardId: string): void
  pick(held: HeldTool | null): void
  begin(color: string, width: number, p: P2): void
  extend(p: P2): void
  end(): void
  erase(p: P2, radius: number): void
  clear(): void
}

const KEY = (id: string) => `sk-ink:${id}`
const MAX_GHOSTS = 400
/** Points closer than this to the previous one are dropped (keeps strokes light). */
const MIN_STEP = 0.0015

let seq = 0
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`

function read(boardId: string): { strokes: InkStroke[]; ghosts: InkGhost[] } {
  try {
    const raw = localStorage.getItem(KEY(boardId))
    if (!raw) return { strokes: [], ghosts: [] }
    const v = JSON.parse(raw) as { strokes?: InkStroke[]; ghosts?: InkGhost[] }
    return { strokes: Array.isArray(v.strokes) ? v.strokes : [], ghosts: Array.isArray(v.ghosts) ? v.ghosts : [] }
  } catch {
    return { strokes: [], ghosts: [] }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(boardId: string | null, strokes: InkStroke[], ghosts: InkGhost[]) {
  if (!boardId) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      // Round to 0.1 mm: plenty for ink, and keeps storage small.
      const r = (s: { points: P2[] }) => ({ ...s, points: s.points.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]) })
      localStorage.setItem(KEY(boardId), JSON.stringify({ strokes: strokes.map(r), ghosts: ghosts.map(r) }))
    } catch {
      // Storage full or blocked: ink stays for this session only.
    }
  }, 300)
}

function dist2(a: P2, b: P2) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

/** Distance from p to segment ab, squared. */
function segDist2(p: P2, a: P2, b: P2) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return dist2(p, [a[0] + dx * t, a[1] + dy * t])
}

/**
 * Remove every part of `stroke` within `radius` of `p`. Returns the surviving
 * pieces, and the removed pieces (which become ghosts), or null when untouched.
 */
export function eraseFromStroke(stroke: InkStroke, p: P2, radius: number): { kept: P2[][]; removed: P2[][] } | null {
  const r2 = (radius + stroke.width / 2) ** 2
  const pts = stroke.points
  const hitPoint = pts.map((q) => dist2(q, p) <= r2)
  let touched = hitPoint.some(Boolean)
  if (!touched && pts.length > 1) {
    for (let i = 0; i < pts.length - 1; i++) {
      if (segDist2(p, pts[i], pts[i + 1]) <= r2) {
        touched = true
        // A segment that passes under the eraser without a point inside it: split there.
        hitPoint[i] = hitPoint[i + 1] = true
        break
      }
    }
  }
  if (!touched) return null
  const kept: P2[][] = []
  const removed: P2[][] = []
  let run: P2[] = []
  let gone: P2[] = []
  pts.forEach((q, i) => {
    if (hitPoint[i]) {
      if (run.length) kept.push(run)
      run = []
      gone.push(q)
    } else {
      if (gone.length) removed.push(gone)
      gone = []
      run.push(q)
    }
  })
  if (run.length) kept.push(run)
  if (gone.length) removed.push(gone)
  return { kept: kept.filter((k) => k.length > 1 || pts.length === 1), removed }
}

export const useInk = create<InkState>()((set, get) => ({
  boardId: null,
  strokes: [],
  ghosts: [],
  live: null,
  held: null,
  version: 0,
  load(boardId) {
    if (get().boardId === boardId) return
    const { strokes, ghosts } = read(boardId)
    set((s) => ({ boardId, strokes, ghosts, live: null, version: s.version + 1 }))
  },
  pick(held) {
    if (get().live) get().end()
    set({ held })
  },
  begin(color, width, p) {
    set({ live: { id: newId(), color, width, points: [p, [p[0] + 0.0002, p[1]]] } })
  },
  extend(p) {
    const live = get().live
    if (!live) return
    const last = live.points[live.points.length - 1]
    if (dist2(last, p) < MIN_STEP * MIN_STEP) return
    // Fill long jumps (fast hands, low frame rate) so the line stays smooth.
    const d = Math.sqrt(dist2(last, p))
    const steps = Math.min(8, Math.floor(d / 0.01))
    const added: P2[] = []
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1)
      added.push([last[0] + (p[0] - last[0]) * t, last[1] + (p[1] - last[1]) * t])
    }
    // The first point was a placeholder dot; replace it once the nib moves.
    const points = live.points.length === 2 && dist2(live.points[0], live.points[1]) < 1e-7 ? [live.points[0]] : live.points
    set({ live: { ...live, points: [...points, ...added, p] } })
  },
  end() {
    const { live, strokes, ghosts, boardId } = get()
    if (!live) return
    const next = [...strokes, live]
    set((s) => ({ live: null, strokes: next, version: s.version + 1 }))
    save(boardId, next, ghosts)
  },
  erase(p, radius) {
    const { strokes, ghosts, boardId } = get()
    let changed = false
    const next: InkStroke[] = []
    const newGhosts: InkGhost[] = []
    for (const s of strokes) {
      const res = eraseFromStroke(s, p, radius)
      if (!res) {
        next.push(s)
        continue
      }
      changed = true
      res.kept.forEach((points, i) => next.push({ ...s, id: i === 0 ? s.id : newId(), points }))
      for (const points of res.removed) newGhosts.push({ color: s.color, width: s.width, points })
    }
    if (!changed) return
    const g = [...ghosts, ...newGhosts].slice(-MAX_GHOSTS)
    set((s) => ({ strokes: next, ghosts: g, version: s.version + 1 }))
    save(boardId, next, g)
  },
  clear() {
    const { strokes, ghosts, boardId } = get()
    const g = [...ghosts, ...strokes.map((s) => ({ color: s.color, width: s.width, points: s.points }))].slice(-MAX_GHOSTS)
    set((s) => ({ strokes: [], ghosts: g, live: null, version: s.version + 1 }))
    save(boardId, [], g)
  },
}))
