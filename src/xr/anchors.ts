import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Pose } from '../data/model'
import type { PersistentAnchorSession } from './capabilities'

/**
 * Anchor manager (PLAN §5.3): create, persist, restore, re-anchor. XRAnchor
 * objects aren't serializable, so the live anchor lives here; the Placement
 * record keeps the persistent handle and the anchor → board offset.
 */

interface AnchorWithHandle extends XRAnchor {
  requestPersistentHandle?: () => Promise<string>
}

export interface AnchorRuntime {
  anchor: XRAnchor | null
  /** Last good anchor pose (world = local-floor). */
  pose: Matrix4
  hasPose: boolean
  lastSeen: number
  /** Board world pose to convert into an anchor-relative offset once the anchor's pose is known. */
  pendingBoard: Matrix4 | null
  /** Set after a large move: create a fresh anchor near the board in the next frame. */
  reanchor: boolean
}

export const anchorRuntime: AnchorRuntime = {
  anchor: null,
  pose: new Matrix4(),
  hasPose: false,
  lastSeen: 0,
  pendingBoard: null,
  reanchor: false,
}

export function resetAnchorRuntime() {
  anchorRuntime.anchor?.delete?.()
  anchorRuntime.anchor = null
  anchorRuntime.hasPose = false
  anchorRuntime.pendingBoard = null
  anchorRuntime.reanchor = false
  anchorRuntime.pose.identity()
}

export const TRACKING_LOST_MS = 1000
export const RESTORE_TIMEOUT_MS = 5000
export const REANCHOR_DISTANCE = 1

export function poseToMatrix(p: Pose, out = new Matrix4()): Matrix4 {
  return out.compose(new Vector3(...p.position), new Quaternion(...p.quaternion), new Vector3(1, 1, 1))
}

export function matrixToPose(m: Matrix4): Pose {
  const pos = new Vector3()
  const q = new Quaternion()
  const s = new Vector3()
  m.decompose(pos, q, s)
  return { position: [pos.x, pos.y, pos.z], quaternion: [q.x, q.y, q.z, q.w] }
}

/**
 * Create an anchor inside an active XR frame. Hit-test anchors attach to the
 * tracked surface; otherwise a free anchor at the board pose.
 */
export async function createAnchorInFrame(frame: XRFrame, refSpace: XRReferenceSpace, board: Matrix4, hit: XRHitTestResult | null): Promise<XRAnchor | null> {
  try {
    if (hit && 'createAnchor' in hit && typeof hit.createAnchor === 'function') {
      const a = await hit.createAnchor()
      if (a) return a
    }
  } catch (err) {
    console.warn('[anchors] hit-test anchor failed, falling back to a free anchor', err)
  }
  try {
    if (typeof frame.createAnchor !== 'function') return null
    const p = new Vector3()
    const q = new Quaternion()
    board.decompose(p, q, new Vector3())
    return (await frame.createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), refSpace)) ?? null
  } catch (err) {
    console.warn('[anchors] createAnchor failed', err)
    return null
  }
}

/** Meta Quest extension: persist an anchor across sessions. */
export async function persistAnchor(anchor: XRAnchor): Promise<string | undefined> {
  const a = anchor as AnchorWithHandle
  if (typeof a.requestPersistentHandle !== 'function') return undefined
  try {
    return await a.requestPersistentHandle()
  } catch (err) {
    console.warn('[anchors] requestPersistentHandle failed', err)
    return undefined
  }
}

export async function restoreAnchor(session: XRSession, handle: string): Promise<XRAnchor | null> {
  const s = session as PersistentAnchorSession
  if (typeof s.restorePersistentAnchor !== 'function') return null
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), RESTORE_TIMEOUT_MS))
  try {
    return await Promise.race([s.restorePersistentAnchor(handle), timeout])
  } catch (err) {
    console.warn('[anchors] restore failed', err)
    return null
  }
}

/** Clean up stale persistent anchors so they don't pile up. */
export async function forgetAnchor(session: XRSession | undefined, handle: string | undefined) {
  if (!session || !handle) return
  const s = session as PersistentAnchorSession
  try {
    await s.deletePersistentAnchor?.(handle)
  } catch {
    // Already gone.
  }
}
