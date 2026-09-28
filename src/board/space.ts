/**
 * Board-space math (PLAN §8, decision 1).
 *
 * Board space is 2D, in meters, origin at the board's top-left corner,
 * u → right, v → down. The 3D board root is centered: local x → right,
 * y → up, +z out of the board surface toward the viewer.
 */

export interface Vec2 {
  u: number
  v: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type V3 = [number, number, number]

export function toLocal(u: number, v: number, size: readonly [number, number]): [number, number] {
  return [u - size[0] / 2, size[1] / 2 - v]
}

export function toBoard(x: number, y: number, size: readonly [number, number]): Vec2 {
  return { u: x + size[0] / 2, v: size[1] / 2 - y }
}

export function rectCenterLocal(r: Rect, size: readonly [number, number]): [number, number] {
  return toLocal(r.x + r.w / 2, r.y + r.h / 2, size)
}

export function rectContains(r: Rect, u: number, v: number, margin = 0): boolean {
  return u >= r.x - margin && u <= r.x + r.w + margin && v >= r.y - margin && v <= r.y + r.h + margin
}

export function expandRect(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }
}

/**
 * Intersect a ray given in board-local coordinates with the board plane (z = 0).
 * Returns null when the ray is parallel to or pointing away from the plane.
 */
export function rayToBoardLocal(origin: V3, dir: V3): { x: number; y: number; t: number } | null {
  if (Math.abs(dir[2]) < 1e-6) return null
  const t = -origin[2] / dir[2]
  if (t < 0) return null
  return { x: origin[0] + dir[0] * t, y: origin[1] + dir[1] * t, t }
}

/** Intersect a ray with the plane z = zPlane (board-local). */
export function rayToPlaneZ(origin: V3, dir: V3, zPlane: number): { x: number; y: number; t: number } | null {
  if (Math.abs(dir[2]) < 1e-6) return null
  const t = (zPlane - origin[2]) / dir[2]
  if (t < 0) return null
  return { x: origin[0] + dir[0] * t, y: origin[1] + dir[1] * t, t }
}

/**
 * Clip the span [c - len/2, c + len/2] to [lo, hi]. Returns the visible part's
 * center and length, or null when nothing is left.
 */
export function clipSpan(c: number, len: number, lo: number, hi: number): { c: number; len: number } | null {
  const a = Math.max(lo, c - len / 2)
  const b = Math.min(hi, c + len / 2)
  if (!(b > a)) return null
  return { c: (a + b) / 2, len: b - a }
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Deterministic hash of a string to [0, 1). Used for seeded sticky-note jitter. */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}
