import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { clampTilt, tiltBoardMatrix, tiltOf, tiltTowardPointer, TILT_RANGE } from '../../src/xr/tilt'
import { deskPose, facing } from '../../src/xr/placement/snapping'

const ONE = new Vector3(1, 1, 1)
const matrixOf = (p: { position: Vector3; quaternion: Quaternion }) => new Matrix4().compose(p.position, p.quaternion, ONE)
const normalOf = (m: Matrix4) => new Vector3(0, 0, 1).transformDirection(m)
const at = (m: Matrix4, x: number, y: number) => new Vector3(x, y, 0).applyMatrix4(m)

describe('board tilt', () => {
  const size: [number, number] = [0.6, 0.4]
  const user = new Vector3(0, 1.3, 0.4)

  it('hinges a desk board on its near edge, matching deskPose', () => {
    const flat = matrixOf(deskPose(new Vector3(0, 0.74, -0.3), user, size, 0))
    const tilted = tiltBoardMatrix(flat, 'desk', size, 30)
    const reference = matrixOf(deskPose(new Vector3(0, 0.74, -0.3), user, size, 30))
    // The near edge stays on the desk…
    expect(at(tilted, 0, -size[1] / 2).distanceTo(at(flat, 0, -size[1] / 2))).toBeLessThan(1e-6)
    // …the far edge rises, and the result is the same pose deskPose builds directly.
    expect(at(tilted, 0, size[1] / 2).y).toBeGreaterThan(at(flat, 0, size[1] / 2).y + 0.15)
    expect(normalOf(tilted).angleTo(normalOf(reference))).toBeLessThan(1e-5)
    expect(at(tilted, 0, 0).distanceTo(at(reference, 0, 0))).toBeLessThan(1e-5)
  })

  it('leans a floating board back about its center', () => {
    const upright = matrixOf(facing(new Vector3(0, 1.2, -1), new Vector3(0, 1.5, 0)))
    const leaned = tiltBoardMatrix(upright, 'float', [1.2, 0.75], 20)
    expect(at(leaned, 0, 0).distanceTo(at(upright, 0, 0))).toBeLessThan(1e-6)
    // The face turns up toward the viewer, and the top edge moves away.
    expect(normalOf(leaned).y).toBeGreaterThan(0.3)
    expect(at(leaned, 0, 0.375).z).toBeLessThan(at(upright, 0, 0.375).z)
  })

  it('finds the tilt that brings the handle to the pointer', () => {
    const flat = matrixOf(deskPose(new Vector3(0, 0.74, -0.3), user, size, 0))
    const handle = new Vector3(0, size[1] / 2 + 0.04, 0)
    const goal = at(tiltBoardMatrix(flat, 'desk', size, 40), handle.x, handle.y)
    // A hand at the handle's 40° position…
    expect(tiltTowardPointer(flat, 'desk', size, 0, handle, goal, null)).toBeCloseTo(40, 0)
    // …and a controller ray aimed at it from the user's side.
    const origin = new Vector3(0.1, 1.1, 0.3)
    const dir = goal.clone().sub(origin).normalize()
    expect(tiltTowardPointer(flat, 'desk', size, 0, handle, origin, dir)).toBeCloseTo(40, 0)
  })

  it('clamps to each mode’s range and keeps walls flush', () => {
    expect(clampTilt('desk', 120)).toBe(TILT_RANGE.desk[1])
    expect(clampTilt('desk', -10)).toBe(0)
    expect(clampTilt('float', -90)).toBe(TILT_RANGE.float[0])
    expect(clampTilt('wall', 30)).toBe(0)
    expect(tiltOf({ mode: 'desk' })).toBe(15)
    expect(tiltOf({ mode: 'float', tiltDeg: 25 })).toBe(25)
  })
})
