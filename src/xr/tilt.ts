import { Matrix4, Vector3 } from 'three'
import type { Placement, PlacementMode } from '../data/model'
import { usePlacements } from '../data/placements'
import { anchorRuntime, matrixToPose, poseToMatrix } from './anchors'

/**
 * Board tilt (PLAN §5.1). A desk board hinges on its near (bottom) edge like a
 * drafting table: 0° lies flat, 90° would stand upright. A floating board
 * pivots about its center: positive tilt leans the top back so the face turns
 * up toward you, negative leans it forward. Wall boards stay flush.
 */

const DEG = Math.PI / 180

export const TILT_RANGE: Record<PlacementMode, [number, number]> = {
  wall: [0, 0],
  desk: [0, 80],
  float: [-35, 60],
}

export const DEFAULT_TILT: Record<PlacementMode, number> = { wall: 0, desk: 15, float: 0 }

export const canTilt = (mode: PlacementMode) => mode !== 'wall'

export function clampTilt(mode: PlacementMode, deg: number): number {
  const [lo, hi] = TILT_RANGE[mode]
  return Math.max(lo, Math.min(hi, deg))
}

export function tiltOf(p: Pick<Placement, 'mode' | 'tiltDeg'>): number {
  return clampTilt(p.mode, p.tiltDeg ?? DEFAULT_TILT[p.mode])
}

/** Rotation about the board's local X per degree of tilt (desk: raise the top edge; float: lean it back). */
function sign(mode: PlacementMode) {
  return mode === 'desk' ? 1 : -1
}

/** Board-local hinge point: the bottom edge for desks, the center for floating boards. */
export function tiltPivot(mode: PlacementMode, size: readonly [number, number], out = new Vector3()): Vector3 {
  return out.set(0, mode === 'desk' ? -size[1] / 2 : 0, 0)
}

/** Rotate a board's world matrix by `deltaDeg` of tilt about its hinge. */
export function tiltBoardMatrix(board: Matrix4, mode: PlacementMode, size: readonly [number, number], deltaDeg: number, out = new Matrix4()): Matrix4 {
  if (!deltaDeg) return out.copy(board)
  const pivot = tiltPivot(mode, size).applyMatrix4(board)
  const axis = new Vector3(1, 0, 0).transformDirection(board)
  const r = new Matrix4().makeRotationAxis(axis, sign(mode) * deltaDeg * DEG)
  return out
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(r)
    .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
    .multiply(board)
}

/** Where a point attached to the board (`local`, board-local) ends up after `deltaDeg` more tilt. */
export function tiltedPoint(board: Matrix4, mode: PlacementMode, size: readonly [number, number], local: Vector3, deltaDeg: number): Vector3 {
  return local.clone().applyMatrix4(tiltBoardMatrix(board, mode, size, deltaDeg))
}

const _cp = new Vector3()

/** Distance from `p` to a ray (origin `o`, unit direction `d`), or to a point when `d` is null. */
function distanceTo(p: Vector3, o: Vector3, d: Vector3 | null): number {
  _cp.copy(p).sub(o)
  if (!d) return _cp.length()
  const t = Math.max(0, _cp.dot(d))
  return _cp.addScaledVector(d, -t).length()
}

/**
 * The tilt that brings a board-attached handle closest to the pointer: a ray
 * (controller, gaze) or a 3D point (hand, grab). The handle moves on a circle
 * about the hinge, so this is a 1-D search over the allowed range.
 */
export function tiltTowardPointer(
  board0: Matrix4,
  mode: PlacementMode,
  size: readonly [number, number],
  tilt0: number,
  handleLocal: Vector3,
  origin: Vector3,
  direction: Vector3 | null,
): number {
  const [lo, hi] = TILT_RANGE[mode]
  const pivot = tiltPivot(mode, size).applyMatrix4(board0)
  const axis = new Vector3(1, 0, 0).transformDirection(board0)
  const h0 = handleLocal.clone().applyMatrix4(board0).sub(pivot)
  const rot = new Matrix4()
  const p = new Vector3()
  let best = tilt0
  let bestD = Infinity
  for (let t = lo; t <= hi + 1e-6; t += 0.5) {
    rot.makeRotationAxis(axis, sign(mode) * (t - tilt0) * DEG)
    p.copy(h0).applyMatrix4(rot).add(pivot)
    const dist = distanceTo(p, origin, direction)
    if (dist < bestD - 1e-6) {
      bestD = dist
      best = t
    }
  }
  return best
}

/** The board's current world matrix, as the anchored board computes it. */
export function placementWorldMatrix(p: Placement, out = new Matrix4()): Matrix4 {
  const rt = anchorRuntime
  if (rt.pendingBoard) return out.copy(rt.pendingBoard)
  const offset = poseToMatrix(p.localOffset)
  if (rt.anchor && rt.hasPose) return out.multiplyMatrices(rt.pose, offset)
  return out.copy(offset)
}

/** Store a new board world matrix (and tilt) in the placement, relative to its anchor. */
export function commitBoardMatrix(world: Matrix4, changes: Partial<Placement> = {}) {
  const rt = anchorRuntime
  if (rt.pendingBoard) rt.pendingBoard.copy(world)
  const offset = !rt.pendingBoard && rt.anchor && rt.hasPose ? rt.pose.clone().invert().multiply(world) : world
  usePlacements.getState().updatePlacement({ ...changes, localOffset: matrixToPose(offset) })
}

/** Set the live board's tilt (menu buttons). Returns the applied tilt. */
export function setPlacementTilt(target: number): number | null {
  const p = usePlacements.getState().placement
  if (!p || !canTilt(p.mode)) return null
  const current = tiltOf(p)
  const next = clampTilt(p.mode, Math.round(target))
  if (next === current) return current
  const world = tiltBoardMatrix(placementWorldMatrix(p), p.mode, p.size, next - current)
  commitBoardMatrix(world, { tiltDeg: next })
  return next
}
