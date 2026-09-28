import { Matrix4, Quaternion, Vector3 } from 'three'

/**
 * Surface snapping math (PLAN §5.2). Pure functions over three.js math types so
 * they run (and are tested) without a headset. World space is `local-floor`:
 * +Y up, meters.
 */

export const UP = new Vector3(0, 1, 0)

export type SurfaceClass = 'vertical' | 'horizontal' | 'other'

/** |n·up| < 0.3 → wall candidate; n·up > 0.9 → desk/floor candidate. */
export function classifyNormal(n: Vector3): SurfaceClass {
  const d = n.dot(UP)
  if (Math.abs(d) < 0.3) return 'vertical'
  if (d > 0.9) return 'horizontal'
  return 'other'
}

/** Minimum height for a horizontal surface to count as a desk (below is floor). */
export const MIN_DESK_HEIGHT = 0.4
export const WALL_OFFSET = 0.005

const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _m = new Matrix4()

export function basisQuaternion(x: Vector3, y: Vector3, z: Vector3, out = new Quaternion()): Quaternion {
  _m.makeBasis(x, y, z)
  return out.setFromRotationMatrix(_m)
}

export function horizontal(v: Vector3, out = new Vector3()): Vector3 {
  out.set(v.x, 0, v.z)
  const len = out.length()
  return len < 1e-6 ? out.set(0, 0, -1) : out.divideScalar(len)
}

export interface BoardPose {
  position: Vector3
  quaternion: Quaternion
}

/**
 * Wall: forward = wall normal (horizontalized), up = world up projected onto the
 * wall plane. Keeps the board upright even when the hit normal is noisy.
 */
export function wallPose(point: Vector3, normal: Vector3, size: readonly [number, number]): BoardPose {
  const z = horizontal(normal, _z.clone())
  const y = _y.copy(UP).addScaledVector(z, -UP.dot(z)).normalize()
  const x = _x.crossVectors(y, z).normalize()
  const position = point.clone().addScaledVector(z, WALL_OFFSET)
  // Keep the bottom edge off the floor.
  position.y = Math.max(position.y, size[1] / 2 + 0.05)
  return { position, quaternion: basisQuaternion(x, y, z) }
}

/**
 * Desk: lies on the surface with its top edge pointing away from the user, then
 * tilts up by `tiltDeg` about its bottom edge like a drafting table.
 */
export function deskPose(point: Vector3, userPosition: Vector3, size: readonly [number, number], tiltDeg: number): BoardPose {
  const away = horizontal(point.clone().sub(userPosition), new Vector3())
  const tilt = (tiltDeg * Math.PI) / 180
  const flatY = away
  const flatZ = UP.clone()
  // Rotate about local X by +tilt: top edge rises, the face turns toward the user.
  const y = flatY.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(flatZ, Math.sin(tilt))
  const z = flatZ.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(flatY, -Math.sin(tilt))
  const x = new Vector3().crossVectors(y, z).normalize()
  const bottomEdge = point.clone().addScaledVector(away, -size[1] / 2)
  const position = bottomEdge.addScaledVector(y, size[1] / 2).addScaledVector(UP, WALL_OFFSET)
  return { position, quaternion: basisQuaternion(x, y, z) }
}

/** Float: 1.2 m in front at chest height, facing the user (yaw only). */
export function floatPose(headPosition: Vector3, headForward: Vector3, distance = 1.2, drop = 0.3): BoardPose {
  const f = horizontal(headForward, new Vector3())
  const position = headPosition.clone().addScaledVector(f, distance)
  position.y = Math.max(0.6, headPosition.y - drop)
  return facing(position, headPosition)
}

/** Upright pose at `position` whose face points toward `target` (yaw only). */
export function facing(position: Vector3, target: Vector3): BoardPose {
  const z = horizontal(target.clone().sub(position), new Vector3())
  const y = UP.clone()
  const x = new Vector3().crossVectors(y, z).normalize()
  return { position: position.clone(), quaternion: basisQuaternion(x, y, z) }
}

/** Intersect a ray with the horizontal plane y = h. */
export function rayToHeight(origin: Vector3, dir: Vector3, h: number): Vector3 | null {
  if (Math.abs(dir.y) < 1e-4) return null
  const t = (h - origin.y) / dir.y
  if (t <= 0 || t > 4) return null
  return origin.clone().addScaledVector(dir, t)
}

/**
 * Snap a board centered at `center` (2D, plane-local) to the edges of a
 * rectangle (`min`, `max`) when an edge is within `threshold` (PLAN: 3 cm).
 */
export function snapToEdges(
  center: [number, number],
  half: [number, number],
  min: [number, number],
  max: [number, number],
  threshold = 0.03,
): [number, number] {
  const out: [number, number] = [center[0], center[1]]
  for (const i of [0, 1] as const) {
    const lo = center[i] - half[i]
    const hi = center[i] + half[i]
    if (Math.abs(lo - min[i]) < threshold) out[i] = min[i] + half[i]
    else if (Math.abs(hi - max[i]) < threshold) out[i] = max[i] - half[i]
  }
  return out
}

/**
 * Critically damped spring step for smoothing the ghost pose. Returns the new
 * value and writes velocity back into `vel`.
 */
export function smoothDamp(current: Vector3, target: Vector3, vel: Vector3, smoothTime: number, dt: number): Vector3 {
  const omega = 2 / Math.max(1e-4, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current.clone().sub(target)
  const temp = vel.clone().addScaledVector(change, omega).multiplyScalar(dt)
  vel.sub(temp.clone().multiplyScalar(omega)).multiplyScalar(exp)
  return target.clone().add(change.add(temp).multiplyScalar(exp))
}

export function slerpToward(current: Quaternion, target: Quaternion, smoothTime: number, dt: number): Quaternion {
  const t = 1 - Math.exp(-dt / Math.max(1e-4, smoothTime / 3))
  return current.clone().slerp(target, t)
}
