import { Matrix4, Vector3 } from 'three'

/**
 * Surface registry helpers (PLAN §5.2): raycast against detected planes,
 * preferring semantic labels from Quest Space Setup ('wall', 'table', …).
 */

export interface PlaneHit {
  point: Vector3
  normal: Vector3
  distance: number
  label: string | undefined
  /** Plane pose in world space (plane-local Y = normal, polygon in X/Z). */
  planeMatrix: Matrix4
  /** Polygon AABB in plane-local X/Z. */
  min: [number, number]
  max: [number, number]
}

const _inv = new Matrix4()
const _o = new Vector3()
const _d = new Vector3()

function pointInPolygon(x: number, z: number, poly: ReadonlyArray<DOMPointReadOnly>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const zi = poly[i].z
    const xj = poly[j].x
    const zj = poly[j].z
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside
  }
  return inside
}

export function raycastPlanes(frame: XRFrame, refSpace: XRReferenceSpace, planes: ReadonlyArray<XRPlane>, origin: Vector3, dir: Vector3): PlaneHit[] {
  const hits: PlaneHit[] = []
  for (const plane of planes) {
    const pose = frame.getPose(plane.planeSpace, refSpace)
    if (!pose) continue
    const m = new Matrix4().fromArray(pose.transform.matrix)
    _inv.copy(m).invert()
    _o.copy(origin).applyMatrix4(_inv)
    _d.copy(dir).transformDirection(_inv)
    if (Math.abs(_d.y) < 1e-5) continue
    const t = -_o.y / _d.y
    if (t <= 0 || t > 8) continue
    const x = _o.x + _d.x * t
    const z = _o.z + _d.z * t
    if (!pointInPolygon(x, z, plane.polygon)) continue
    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity
    for (const p of plane.polygon) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minZ = Math.min(minZ, p.z)
      maxZ = Math.max(maxZ, p.z)
    }
    const normal = new Vector3(0, 1, 0).transformDirection(m)
    // Planes face one way; flip the normal toward the ray origin.
    if (normal.dot(dir) > 0) normal.negate()
    hits.push({
      point: origin.clone().addScaledVector(dir, t),
      normal,
      distance: t,
      label: (plane as XRPlane & { semanticLabel?: string }).semanticLabel?.toLowerCase(),
      planeMatrix: m,
      min: [minX, minZ],
      max: [maxX, maxZ],
    })
  }
  return hits.sort((a, b) => a.distance - b.distance)
}

export function isWallLabel(label: string | undefined) {
  return label === 'wall' || label === 'wall art' || label === 'window' || label === 'door frame'
}

export function isDeskLabel(label: string | undefined) {
  return label === 'table' || label === 'desk'
}
