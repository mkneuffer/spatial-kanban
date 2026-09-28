import { useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Matrix4, Plane, Quaternion, Ray, Vector3 } from 'three'
import { useBoardStore } from '../data/store'
import { MIN_BOARD_HEIGHT, minBoardWidth, usePlacements } from '../data/placements'
import { useSettings } from '../data/settings'
import type { BoardLayout } from '../board/layout'
import { useBoardRuntime } from '../board/runtime'
import { toLocal } from '../board/space'
import { pointerKindOf, pointerRay, type XPointerEvent } from '../board/BoardInteraction'
import { playSound } from '../fx/audio'
import { Label, roundedRectGeometry, UI } from '../ui/xr/primitives'
import { anchorRuntime, matrixToPose, REANCHOR_DISTANCE } from './anchors'
import { facing } from './placement/snapping'
import { canTilt, tiltBoardMatrix, tiltOf, tiltTowardPointer } from './tilt'

type HandleKind = 'move' | 'resize' | 'tilt'

interface DragStart {
  pointerId: number
  kind: HandleKind
  board: Matrix4
  inv: Matrix4
  plane: Plane
  hit: Vector3
  distance: number
  size: [number, number]
  tilt: number
}

const ONE = new Vector3(1, 1, 1)

/**
 * Move bar under the board, a corner resize handle and — for desk and floating
 * boards — a tilt hinge on the top edge (PLAN §6.2). Moving, resizing and
 * tilting only change the placement's local offset, size and tilt; large moves
 * trigger a re-anchor (PLAN §5.3).
 */
export function BoardHandles({ layout, emphasized }: { layout: BoardLayout; emphasized: boolean }) {
  const runtime = useBoardRuntime()
  const camera = useThree((s) => s.camera)
  const start = useRef<DragStart | null>(null)
  const [hover, setHover] = useState<HandleKind | null>(null)
  const [active, setActive] = useState<HandleKind | null>(null)
  const mode = usePlacements((s) => s.placement?.mode ?? 'wall')
  const tiltDeg = usePlacements((s) => (s.placement ? tiltOf(s.placement) : 0))
  const tmp = useMemo(() => ({ v: new Vector3(), q: new Quaternion(), s: new Vector3(), head: new Vector3(), m: new Matrix4(), handle: new Vector3() }), [])

  const pointerWorld = (e: XPointerEvent, plane: Plane, distance: number): Vector3 => {
    const kind = pointerKindOf(e.pointerType)
    if ((kind === 'grab' || kind === 'touch') && e.pointerPosition) return e.pointerPosition.clone()
    const ray = pointerRay(e)
    if (ray) {
      const hit = new Vector3()
      if (new Ray(ray.origin, ray.direction).intersectPlane(plane, hit)) return hit
      return ray.origin.addScaledVector(ray.direction, distance)
    }
    return e.point.clone()
  }

  const begin = (kind: HandleKind) => (raw: unknown) => {
    const e = raw as XPointerEvent
    const root = runtime.root
    if (!root) return
    e.stopPropagation()
    e.target.setPointerCapture?.(e.pointerId)
    root.updateWorldMatrix(true, false)
    const board = root.matrixWorld.clone()
    const normal = new Vector3(0, 0, 1).transformDirection(board)
    const center = new Vector3().setFromMatrixPosition(board)
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, center)
    const hit = pointerWorld(e, plane, 1)
    const ray = pointerRay(e)
    // Tilting carries the handle at its own distance; moving carries the board by its center.
    const distance = (kind === 'tilt' ? ray?.origin.distanceTo(e.point) : ray?.origin.distanceTo(center)) ?? 1
    const placement = usePlacements.getState().placement
    const tilt = placement ? tiltOf(placement) : 0
    start.current = { pointerId: e.pointerId, kind, board, inv: board.clone().invert(), plane, hit, distance, size: [...layout.size] as [number, number], tilt }
    setActive(kind)
    playSound('clickSoft')
  }

  const move = (raw: unknown) => {
    const e = raw as XPointerEvent
    const s = start.current
    const placement = usePlacements.getState().placement
    if (!s || s.pointerId !== e.pointerId || !placement) return
    e.stopPropagation()
    const pw = pointerWorld(e, s.plane, s.distance)
    s.board.decompose(tmp.v, tmp.q, tmp.s)
    let world: Matrix4
    let size = placement.size
    let tiltDeg = placement.tiltDeg
    if (s.kind === 'tilt') {
      const ray = pointerRay(e)
      const kind = pointerKindOf(e.pointerType)
      const direct = (kind === 'grab' || kind === 'touch') && e.pointerPosition
      const next = direct
        ? tiltTowardPointer(s.board, placement.mode, s.size, s.tilt, tmp.handle, e.pointerPosition!, null)
        : ray
          ? tiltTowardPointer(s.board, placement.mode, s.size, s.tilt, tmp.handle, ray.origin, ray.direction)
          : s.tilt
      if (Math.round(next) !== Math.round(tiltOf(placement))) playSound('tick')
      tiltDeg = next
      world = tiltBoardMatrix(s.board, placement.mode, s.size, next - s.tilt)
    } else if (s.kind === 'move') {
      const ray = pointerRay(e)
      if (placement.mode === 'float' && pointerKindOf(e.pointerType) === 'ray' && ray) {
        // Float: carry the board along the ray at its distance, turning to face the user (keeping its tilt).
        const pos = ray.origin.addScaledVector(ray.direction, s.distance)
        camera.getWorldPosition(tmp.head)
        const pose = facing(pos, tmp.head)
        world = tiltBoardMatrix(new Matrix4().compose(pose.position, pose.quaternion, ONE), 'float', s.size, s.tilt)
      } else {
        const delta = pw.clone().sub(s.hit)
        // Wall / desk: stay in the surface plane.
        if (placement.mode !== 'float') delta.addScaledVector(s.plane.normal, -delta.dot(s.plane.normal))
        world = new Matrix4().compose(tmp.v.clone().add(delta), tmp.q.clone(), ONE)
      }
    } else {
      // Resize from the bottom corner; the opposite top corner stays fixed.
      const local = pw.clone().applyMatrix4(s.inv)
      const mirror = useSettings.getState().leftHanded
      const [W0, H0] = s.size
      const fixedX = mirror ? W0 / 2 : -W0 / 2
      const fixedY = H0 / 2
      const cols = useBoardStore.getState().doc.board.columnIds.length
      const minW = placement.mode === 'desk' ? 0.4 : minBoardWidth(cols)
      const w = Math.max(minW, Math.min(4, mirror ? fixedX - local.x : local.x - fixedX))
      const h = Math.max(MIN_BOARD_HEIGHT, Math.min(2.6, fixedY - local.y))
      size = [w, h]
      const center = new Vector3(fixedX + (mirror ? -w / 2 : w / 2), fixedY - h / 2, 0).applyMatrix4(s.board)
      world = new Matrix4().compose(center, tmp.q.clone(), ONE)
    }
    const rt = anchorRuntime
    const offset = rt.anchor && rt.hasPose ? rt.pose.clone().invert().multiply(world) : world
    usePlacements.getState().updatePlacement({ localOffset: matrixToPose(offset), size, tiltDeg })
  }

  const end = (raw: unknown) => {
    const e = raw as XPointerEvent
    const s = start.current
    if (!s || s.pointerId !== e.pointerId) return
    e.target.releasePointerCapture?.(e.pointerId)
    start.current = null
    setActive(null)
    playSound('drop')
    const rt = anchorRuntime
    const root = runtime.root
    if (rt.anchor && rt.hasPose && root) {
      root.updateWorldMatrix(true, false)
      const board = new Vector3().setFromMatrixPosition(root.matrixWorld)
      const anchor = new Vector3().setFromMatrixPosition(rt.pose)
      if (board.distanceTo(anchor) > REANCHOR_DISTANCE) rt.reanchor = true
    }
  }

  const k = layout.k
  const hr = layout.handle
  const [hx, hy] = toLocal(hr.x + hr.w / 2, hr.y + hr.h / 2, layout.size)
  const cr = layout.corner
  const [cx, cy] = toLocal(cr.x + cr.w / 2, cr.y + cr.h / 2, layout.size)
  // Tilt hinge: a grip centered above the top edge (the far edge on a desk).
  const tiltable = canTilt(mode)
  const tw = Math.max(0.09, Math.min(0.2, hr.w * 0.55))
  const th = Math.max(0.018, hr.h)
  const ty = layout.size[1] / 2 + Math.max(0.035, 0.045 * k)
  tmp.handle.set(0, ty, 0.006)
  const handlers = (kind: HandleKind) => ({
    onPointerDown: begin(kind),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onPointerEnter: () => setHover(kind),
    onPointerLeave: () => setHover((h) => (h === kind ? null : h)),
  })
  const color = (kind: HandleKind) => (active === kind ? UI.accent : hover === kind || emphasized ? '#c9d1d9' : '#6e7681')
  const opacity = emphasized || hover || active ? 0.95 : 0.55
  const mirror = layout.corner.x < 0

  const tiltLive = active === 'tilt' || hover === 'tilt'
  return (
    <group>
      {tiltable && (
        <group position={[0, ty, 0.006]}>
          <mesh geometry={roundedRectGeometry(tw, th, th / 2)} raycast={() => {}}>
            <meshBasicMaterial color={color('tilt')} transparent opacity={opacity} />
          </mesh>
          {/* Up/down chevrons: "this edge swings". */}
          {[-1, 1].map((dir) => (
            <mesh key={dir} position={[0, dir * th * 1.05, 0]} rotation={[0, 0, (dir * Math.PI) / 2]} scale={[0.8, 1.4, 1]} raycast={() => {}}>
              <circleGeometry args={[th * 0.36, 3]} />
              <meshBasicMaterial color={color('tilt')} transparent opacity={opacity * 0.9} />
            </mesh>
          ))}
          <mesh {...handlers('tilt')}>
            <boxGeometry args={[tw + 0.04, th + 0.05, 0.05]} />
            <meshBasicMaterial visible={false} />
          </mesh>
          {(tiltLive || emphasized) && (
            <group position={[tw / 2 + 0.012, 0, 0.002]}>
              <mesh geometry={roundedRectGeometry(0.1, 0.03, 0.015)} position={[0.05, 0, -0.001]} raycast={() => {}}>
                <meshBasicMaterial color={UI.panel} transparent opacity={0.9} depthWrite={false} />
              </mesh>
              <Label size={0.015} weight={600} anchorX="left" position={[0.012, 0, 0.001]}>
                {`Tilt ${Math.round(tiltDeg)}°`}
              </Label>
            </group>
          )}
        </group>
      )}
      <mesh position={[hx, hy, 0.006]} geometry={roundedRectGeometry(hr.w, hr.h, hr.h / 2)} {...handlers('move')}>
        <meshBasicMaterial color={color('move')} transparent opacity={opacity} />
      </mesh>
      {/* Larger invisible grab zone around the bar. */}
      <mesh position={[hx, hy, 0.006]} {...handlers('move')}>
        <boxGeometry args={[hr.w + 0.04, hr.h + 0.04, 0.04]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <group position={[cx, cy, 0.006]}>
        {/* L-shaped corner handle hugging the board's bottom corner */}
        <mesh position={[(mirror ? 1 : -1) * cr.w * 0.3, 0, 0]} raycast={() => {}}>
          <planeGeometry args={[cr.w * 0.6, 0.008 * Math.max(0.7, k)]} />
          <meshBasicMaterial color={color('resize')} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, cr.h * 0.3, 0]} raycast={() => {}}>
          <planeGeometry args={[0.008 * Math.max(0.7, k), cr.h * 0.6]} />
          <meshBasicMaterial color={color('resize')} transparent opacity={opacity} />
        </mesh>
        <mesh {...handlers('resize')}>
          <boxGeometry args={[cr.w * 1.2, cr.h * 1.2, 0.04]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>
    </group>
  )
}
