import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { classifyNormal, deskPose, facing, floatPose, smoothDamp, snapToEdges, wallPose } from '../../src/xr/placement/snapping'

const axes = (q: import('three').Quaternion) => ({
  x: new Vector3(1, 0, 0).applyQuaternion(q),
  y: new Vector3(0, 1, 0).applyQuaternion(q),
  z: new Vector3(0, 0, 1).applyQuaternion(q),
})

describe('surface classification', () => {
  it('classifies walls, desks and slopes', () => {
    expect(classifyNormal(new Vector3(0, 0, 1))).toBe('vertical')
    expect(classifyNormal(new Vector3(0.1, 0.2, 0.97).normalize())).toBe('vertical')
    expect(classifyNormal(new Vector3(0, 1, 0))).toBe('horizontal')
    expect(classifyNormal(new Vector3(0, 0.7, 0.7).normalize())).toBe('other')
    expect(classifyNormal(new Vector3(0, -1, 0))).toBe('other')
  })
})

describe('wall pose', () => {
  it('stays upright even with a noisy normal', () => {
    const p = wallPose(new Vector3(0, 1.4, -2), new Vector3(0.05, 0.2, 1).normalize(), [1.6, 1])
    const { y, z } = axes(p.quaternion)
    expect(y.y).toBeCloseTo(1, 5)
    expect(z.y).toBeCloseTo(0, 5)
    expect(p.position.z).toBeGreaterThan(-2) // offset off the wall
  })
  it('keeps the bottom edge off the floor', () => {
    const p = wallPose(new Vector3(0, 0.2, -2), new Vector3(0, 0, 1), [1.6, 1])
    expect(p.position.y - 0.5).toBeGreaterThanOrEqual(0.05 - 1e-9)
  })
})

describe('desk pose', () => {
  it('faces up and toward the user, top edge away', () => {
    const user = new Vector3(0, 1.2, 0)
    const p = deskPose(new Vector3(0, 0.75, -0.6), user, [0.6, 0.4], 15)
    const { y, z } = axes(p.quaternion)
    expect(z.y).toBeCloseTo(Math.cos((15 * Math.PI) / 180), 5)
    expect(z.z).toBeGreaterThan(0) // tilted toward the user (+z)
    expect(y.z).toBeLessThan(0) // top edge points away
    expect(p.position.y).toBeGreaterThan(0.75)
  })
  it('lies flat with zero tilt', () => {
    const p = deskPose(new Vector3(1, 0.75, 0), new Vector3(0, 1.2, 0), [0.6, 0.4], 0)
    expect(axes(p.quaternion).z.y).toBeCloseTo(1, 5)
  })
})

describe('float pose', () => {
  it('sits in front at chest height, facing the user, yaw only', () => {
    const head = new Vector3(0, 1.6, 0)
    const p = floatPose(head, new Vector3(0, -0.5, -1).normalize())
    expect(p.position.z).toBeCloseTo(-1.2, 5)
    expect(p.position.y).toBeCloseTo(1.3, 5)
    const { z, y } = axes(p.quaternion)
    expect(z.z).toBeCloseTo(1, 5)
    expect(y.y).toBeCloseTo(1, 5)
  })
  it('facing() points the face at the target', () => {
    const p = facing(new Vector3(2, 1, 0), new Vector3(0, 1, 0))
    expect(axes(p.quaternion).z.x).toBeCloseTo(-1, 5)
  })
})

describe('snapping and smoothing', () => {
  it('snaps edges within 3 cm', () => {
    expect(snapToEdges([0.02, 0], [0.5, 0.3], [-0.5, -1], [2, 1])).toEqual([0, 0])
    expect(snapToEdges([0.2, 0], [0.5, 0.3], [-0.5, -1], [2, 1])).toEqual([0.2, 0])
  })
  it('smoothDamp converges without overshoot', () => {
    let x = new Vector3(0, 0, 0)
    const target = new Vector3(1, 0, 0)
    const v = new Vector3()
    let max = 0
    for (let i = 0; i < 120; i++) {
      x = smoothDamp(x, target, v, 0.1, 1 / 60)
      max = Math.max(max, x.x)
    }
    expect(x.x).toBeCloseTo(1, 3)
    expect(max).toBeLessThanOrEqual(1 + 1e-6)
  })
})
