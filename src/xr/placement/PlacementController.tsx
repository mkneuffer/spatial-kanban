import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR, useXRHitTestSource, useXRInputSourceEvent } from '@react-three/xr'
import { Group, Matrix4, Quaternion, Vector3 } from 'three'
import type { PlacementMode } from '../../data/model'
import { useSettings } from '../../data/settings'
import { playSound } from '../../fx/audio'
import { pulse } from '../../fx/haptics'
import { roundedRectGeometry, Label, UI } from '../../ui/xr/primitives'
import { useXRApp } from '../session'
import { raycastPlanes, isDeskLabel, isWallLabel } from '../surfaces'
import {
  classifyNormal,
  deskPose,
  facing,
  floatPose,
  MIN_DESK_HEIGHT,
  rayToHeight,
  slerpToward,
  smoothDamp,
  snapToEdges,
  wallPose,
  type BoardPose,
} from './snapping'

export interface PlacementCandidate {
  pose: BoardPose
  hit: XRHitTestResult | null
  source: 'plane' | 'hit' | 'manual'
  label?: string
}

interface Props {
  mode: PlacementMode
  size: [number, number]
  tiltDeg: number
  /** Called inside the XR frame so an anchor can be created from it. */
  onConfirm(candidate: PlacementCandidate, frame: XRFrame | undefined, refSpace: XRReferenceSpace | undefined): void
}

const HELP: Record<PlacementMode, { snapped: string; manual: string }> = {
  wall: { snapped: 'Wall found — pinch or pull the trigger to place', manual: 'Point at a wall · or place it here' },
  desk: { snapped: 'Desk found — pinch or pull the trigger to place', manual: 'Point at your desk · or place it here' },
  float: { snapped: 'Pinch or pull the trigger to place', manual: 'Pinch or pull the trigger to place' },
}

/** Choose the input that drives placement: the dominant hand/controller, else the viewer (phone AR). */
function usePrimaryInput() {
  const inputs = useXR((s) => s.inputSourceStates)
  const leftHanded = useSettings((s) => s.leftHanded)
  const dominant = leftHanded ? 'left' : 'right'
  const tracked = inputs.filter((s) => s.type === 'controller' || s.type === 'hand')
  return tracked.find((s) => s.inputSource.handedness === dominant) ?? tracked[0] ?? null
}

/**
 * Placement & snapping (PLAN §5.2). Each frame: collect hit-test results and
 * detected-plane hits along the pointer ray, classify by normal, filter by
 * mode, build the board pose, smooth it, and show the ghost. Select confirms.
 */
export function PlacementController({ mode, size, tiltDeg, onConfirm }: Props) {
  const primary = usePrimaryInput()
  const space = primary?.inputSource.targetRaySpace
  const hitSource = useXRHitTestSource(space ?? 'viewer')
  const planes = useXR((s) => s.detectedPlanes)
  const originSpace = useXR((s) => s.originReferenceSpace)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const ghost = useRef<Group>(null)
  const reticle = useRef<Group>(null)
  const [status, setStatus] = useState<'snapped' | 'manual'>('manual')
  const current = useRef<PlacementCandidate | null>(null)
  const confirmRequested = useRef(false)
  const smooth = useMemo(() => ({ pos: new Vector3(), vel: new Vector3(), rot: new Quaternion(), init: false }), [])
  const tmp = useMemo(() => ({ m: new Matrix4(), o: new Vector3(), d: new Vector3(), q: new Quaternion(), s: new Vector3(), head: new Vector3(), fwd: new Vector3() }), [])

  useXRInputSourceEvent(
    'all',
    'select',
    () => {
      const app = useXRApp.getState()
      // Ignore the select that opened this phase (the chooser click).
      if (app.phase !== 'placing' || performance.now() - app.phaseAt < 350) return
      confirmRequested.current = true
    },
    [],
  )

  useFrame((_, dt) => {
    const frame = gl.xr.getFrame?.() as XRFrame | undefined
    const refSpace = originSpace ?? gl.xr.getReferenceSpace() ?? undefined
    camera.getWorldPosition(tmp.head)
    camera.getWorldDirection(tmp.fwd)

    // Pointer ray in world space.
    let haveRay = false
    if (frame && refSpace && space) {
      const pose = frame.getPose(space, refSpace)
      if (pose) {
        tmp.m.fromArray(pose.transform.matrix)
        tmp.o.setFromMatrixPosition(tmp.m)
        tmp.d.set(0, 0, -1).transformDirection(tmp.m)
        haveRay = true
      }
    }
    if (!haveRay) {
      tmp.o.copy(tmp.head)
      tmp.d.copy(tmp.fwd)
    }

    let candidate: PlacementCandidate | null = null
    if (mode === 'float') {
      candidate = { pose: floatPose(tmp.head, tmp.fwd), hit: null, source: 'manual' }
    } else if (frame && refSpace) {
      // 1. Semantically labeled planes.
      const planeHits = planes.length ? raycastPlanes(frame, refSpace, planes, tmp.o, tmp.d) : []
      const wantLabel = mode === 'wall' ? isWallLabel : isDeskLabel
      const want = mode === 'wall' ? 'vertical' : 'horizontal'
      const labeled = planeHits.find((h) => wantLabel(h.label) && classifyNormal(h.normal) === want)
      const unlabeled = planeHits.find((h) => classifyNormal(h.normal) === want && (want === 'vertical' || h.point.y > MIN_DESK_HEIGHT))
      const planeHit = labeled ?? unlabeled
      if (planeHit) {
        const pose = mode === 'wall' ? wallPose(planeHit.point, planeHit.normal, size) : deskPose(planeHit.point, tmp.head, size, tiltDeg)
        // Snap to plane edges within 3 cm.
        const inv = planeHit.planeMatrix.clone().invert()
        const local = pose.position.clone().applyMatrix4(inv)
        const bx = new Vector3(1, 0, 0).applyQuaternion(pose.quaternion).transformDirection(inv)
        if (Math.abs(bx.x) > 0.98 || Math.abs(bx.z) > 0.98) {
          const alongX = Math.abs(bx.x) > 0.98
          const half: [number, number] = alongX ? [size[0] / 2, size[1] / 2] : [size[1] / 2, size[0] / 2]
          const [sx, sz] = snapToEdges([local.x, local.z], half, planeHit.min, planeHit.max)
          pose.position.copy(new Vector3(sx, local.y, sz).applyMatrix4(planeHit.planeMatrix))
          if (mode === 'wall') pose.position.addScaledVector(planeHit.normal, 0.005)
        }
        candidate = { pose, hit: null, source: 'plane', label: planeHit.label }
      }
      // 2. Hit test, classified by normal.
      if (!candidate && hitSource) {
        const results = frame.getHitTestResults(hitSource.source)
        for (const r of results.slice(0, 4)) {
          if (!hitSource.getWorldMatrix(tmp.m, r)) continue
          const p = new Vector3().setFromMatrixPosition(tmp.m)
          const n = new Vector3(0, 1, 0).transformDirection(tmp.m)
          const cls = classifyNormal(n)
          if (mode === 'wall' && cls === 'vertical') {
            if (n.dot(tmp.d) > 0) n.negate()
            candidate = { pose: wallPose(p, n, size), hit: r, source: 'hit' }
            break
          }
          if (mode === 'desk' && cls === 'horizontal' && p.y > MIN_DESK_HEIGHT) {
            candidate = { pose: deskPose(p, tmp.head, size, tiltDeg), hit: r, source: 'hit' }
            break
          }
        }
      }
    }
    // 3. Manual placement fallback.
    if (!candidate) {
      if (mode === 'desk') {
        const p = rayToHeight(tmp.o, tmp.d, 0.74)
        const at = p ?? tmp.o.clone().addScaledVector(tmp.d, 0.7)
        candidate = { pose: deskPose(at, tmp.head, size, tiltDeg), hit: null, source: 'manual' }
      } else {
        const at = tmp.o.clone().addScaledVector(tmp.d, 1.6)
        candidate = { pose: facing(at, tmp.head), hit: null, source: 'manual' }
      }
    }
    current.current = candidate
    const snapped = candidate.source !== 'manual' || mode === 'float'
    if ((snapped ? 'snapped' : 'manual') !== status) setStatus(snapped ? 'snapped' : 'manual')

    // Smooth the ghost with a critically damped spring.
    if (!smooth.init) {
      smooth.pos.copy(candidate.pose.position)
      smooth.rot.copy(candidate.pose.quaternion)
      smooth.init = true
    } else {
      smooth.pos.copy(smoothDamp(smooth.pos, candidate.pose.position, smooth.vel, 0.08, dt))
      smooth.rot.copy(slerpToward(smooth.rot, candidate.pose.quaternion, 0.08, dt))
    }
    if (ghost.current) {
      ghost.current.position.copy(smooth.pos)
      ghost.current.quaternion.copy(smooth.rot)
    }
    if (reticle.current) {
      reticle.current.visible = candidate.source !== 'manual'
      reticle.current.position.copy(candidate.pose.position)
      reticle.current.quaternion.copy(candidate.pose.quaternion)
    }

    if (confirmRequested.current) {
      confirmRequested.current = false
      // Place exactly where the ghost shows (smoothed pose), anchored to the surface when possible.
      const final: PlacementCandidate = { ...candidate, pose: { position: smooth.pos.clone(), quaternion: smooth.rot.clone() } }
      playSound('slap')
      if (primary) pulse(primary.inputSource.gamepad, 'firm')
      onConfirm(final, frame, refSpace)
    }
  })

  const color = status === 'snapped' ? UI.success : UI.warn
  const [W, H] = size
  const help = HELP[mode][status]
  return (
    <group>
      <group ref={ghost}>
        <mesh geometry={roundedRectGeometry(W, H, 0.02)} raycast={() => {}}>
          <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} />
        </mesh>
        <GhostOutline w={W} h={H} color={color} />
        <group position={[0, -H / 2 - 0.05, 0.002]}>
          <mesh geometry={roundedRectGeometry(Math.min(0.62, W * 0.95), 0.06, 0.03)} raycast={() => {}}>
            <meshBasicMaterial color={UI.panel} transparent opacity={0.85} depthWrite={false} />
          </mesh>
          <Label size={0.02} position={[0, 0, 0.002]}>
            {help}
          </Label>
        </group>
      </group>
      <group ref={reticle}>
        <mesh raycast={() => {}} position={[0, 0, 0.003]}>
          <ringGeometry args={[0.018, 0.024, 32]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    </group>
  )
}

function GhostOutline({ w, h, color }: { w: number; h: number; color: string }) {
  const t = 0.006
  return (
    <group position={[0, 0, 0.001]}>
      {[
        [0, h / 2, w, t],
        [0, -h / 2, w, t],
        [-w / 2, 0, t, h],
        [w / 2, 0, t, h],
      ].map(([x, y, sw, sh], i) => (
        <mesh key={i} position={[x, y, 0]} raycast={() => {}}>
          <planeGeometry args={[sw, sh]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  )
}
