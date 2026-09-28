import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { Group, Matrix4, Vector3 } from 'three'
import type { PlacementMode, ScalePreset } from '../data/model'
import { useBoardStore } from '../data/store'
import { useSettings } from '../data/settings'
import { createPlacement, DEFAULT_SIZES, PRESET_SIZES, usePlacements } from '../data/placements'
import { BoardContent } from '../board/BoardContent'
import { useView } from '../board/viewStore'
import type { BoardLayout } from '../board/layout'
import { toLocal } from '../board/space'
import { Button3D } from '../ui/xr/primitives'
import { BoardMenu3D, DetailPanel3D, NotFoundPanel, PlacementChooser, Toast3D } from '../ui/xr/panels'
import { Keyboard3D } from '../ui/xr/Keyboard3D'
import { toast } from '../ui/toasts'
import { playSound } from '../fx/audio'
import { detectSessionCapabilities } from './capabilities'
import { useXRApp } from './session'
import {
  anchorRuntime,
  createAnchorInFrame,
  forgetAnchor,
  matrixToPose,
  persistAnchor,
  poseToMatrix,
  resetAnchorRuntime,
  restoreAnchor,
  TRACKING_LOST_MS,
} from './anchors'
import { PlacementController, type PlacementCandidate } from './placement/PlacementController'
import { floatPose } from './placement/snapping'
import { BoardHandles } from './BoardHandles'
import { XRPhoneHud } from './XRPhoneHud'
import { VREnvironment } from './VREnvironment'

const ONE = new Vector3(1, 1, 1)

function boardSizeFor(mode: PlacementMode, preset: ScalePreset): [number, number] {
  if (mode === 'wall') return PRESET_SIZES[preset]
  return DEFAULT_SIZES[mode]
}

/** Freeze a pose in front of the viewer once head tracking is valid. */
function SpawnInFront({ distance = 0.75, drop = 0.2, children }: { distance?: number; drop?: number; children: ReactNode }) {
  const group = useRef<Group>(null)
  const done = useRef(false)
  const frames = useRef(0)
  const camera = useThree((s) => s.camera)
  const tmp = useMemo(() => ({ p: new Vector3(), f: new Vector3() }), [])
  useFrame(() => {
    if (done.current || !group.current) return
    camera.getWorldPosition(tmp.p)
    camera.getWorldDirection(tmp.f)
    frames.current++
    // Wait for a real head pose (the first XR frames can still report the origin).
    if (tmp.p.lengthSq() < 1e-6 && frames.current < 30) return
    const pose = floatPose(tmp.p, tmp.f, distance, drop)
    group.current.position.copy(pose.position)
    group.current.quaternion.copy(pose.quaternion)
    group.current.visible = true
    done.current = true
  })
  return (
    <group ref={group} visible={false}>
      {children}
    </group>
  )
}

/** Keeps 3D panels readable: scale with distance so angular size stays roughly constant. */
function DistanceScaled({ base = 1, children }: { base?: number; children: ReactNode }) {
  const group = useRef<Group>(null)
  const camera = useThree((s) => s.camera)
  const tmp = useMemo(() => ({ a: new Vector3(), b: new Vector3() }), [])
  useFrame(() => {
    const g = group.current
    if (!g?.parent) return
    g.parent.getWorldPosition(tmp.a)
    camera.getWorldPosition(tmp.b)
    const s = base * Math.max(0.7, Math.min(2.4, tmp.a.distanceTo(tmp.b) / 1.3))
    g.scale.setScalar(s)
  })
  return <group ref={group}>{children}</group>
}

/**
 * The XR experience (PLAN §4–§6): restore → choose → place → adjust → work.
 * Rendered inside <XR>; active only while a session is running.
 */
export function XRExperience({ dark }: { dark: boolean }) {
  const session = useXR((s) => s.session)
  const mode = useXR((s) => s.mode)
  const phase = useXRApp((s) => s.phase)
  const placingMode = useXRApp((s) => s.placingMode)
  const placement = usePlacements((s) => s.placement)
  const scalePreset = useSettings((s) => s.scalePreset)

  // Session start: restore the persisted anchor if we can, else ask where to place.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    const app = useXRApp.getState()
    const caps = detectSessionCapabilities(session, mode)
    app.set({ caps, menuOpen: false, tracking: 'ok' })
    resetAnchorRuntime()
    const p = usePlacements.getState().placement
    if (p) useSettings.getState().set({ skinId: p.skinId })
    if (p?.anchorHandle && caps.persistentAnchors) {
      app.setPhase('restoring')
      void restoreAnchor(session, p.anchorHandle).then((anchor) => {
        if (cancelled) return
        if (anchor) {
          anchorRuntime.anchor = anchor
          anchorRuntime.lastSeen = performance.now()
          useXRApp.getState().setPhase('working')
          toast('Board restored where you left it', { tone: 'success' })
        } else {
          useXRApp.getState().setPhase('notFound')
        }
      })
    } else {
      app.set({ placingMode: p?.mode ?? 'wall' })
      app.setPhase('choose')
    }
    return () => {
      cancelled = true
    }
  }, [session, mode])

  const startPlacing = (m: PlacementMode) => {
    useXRApp.getState().set({ placingMode: m, menuOpen: false })
    useXRApp.getState().setPhase('placing')
  }

  const size: [number, number] = placement && placement.mode === placingMode ? placement.size : boardSizeFor(placingMode, scalePreset)
  const tilt = placement?.mode === 'desk' ? (placement.tiltDeg ?? 15) : 15

  const onConfirm = (c: PlacementCandidate, frame: XRFrame | undefined, refSpace: XRReferenceSpace | undefined) => {
    const app = useXRApp.getState()
    const doc = useBoardStore.getState().doc
    const settings = useSettings.getState()
    const prev = usePlacements.getState().placement
    const board = new Matrix4().compose(c.pose.position, c.pose.quaternion, ONE)
    if (prev?.anchorHandle) void forgetAnchor(session, prev.anchorHandle)
    resetAnchorRuntime()
    const base = prev && prev.boardId === doc.board.id ? prev : createPlacement(doc.board.id, placingMode, settings.skinId, size)
    usePlacements.getState().setPlacement({
      ...base,
      mode: placingMode,
      size,
      tiltDeg: placingMode === 'desk' ? tilt : undefined,
      skinId: settings.skinId,
      anchorHandle: undefined,
      localOffset: matrixToPose(board),
      updatedAt: new Date().toISOString(),
    })
    if (app.caps.anchors && frame && refSpace) {
      anchorRuntime.pendingBoard = board.clone()
      void createAnchorInFrame(frame, refSpace, board, c.hit).then(async (anchor) => {
        if (!anchor) {
          anchorRuntime.pendingBoard = null
          return
        }
        anchorRuntime.anchor = anchor
        anchorRuntime.lastSeen = performance.now()
        const handle = await persistAnchor(anchor)
        if (handle) usePlacements.getState().updatePlacement({ anchorHandle: handle })
      })
    }
    app.setPhase('adjusting')
    toast(
      app.caps.persistentAnchors
        ? 'Placed and saved. Drag the bar to move, the corner to resize.'
        : app.caps.anchors
          ? 'Placed. It stays put this session — re-place it next time.'
          : 'Placed (no anchors on this device).',
      { tone: 'success', ms: 5000 },
    )
  }

  const floatHere = () => {
    useXRApp.getState().set({ placingMode: 'float' })
    useXRApp.getState().setPhase('placing')
  }

  if (!session) return null
  return (
    <>
      {mode === 'immersive-vr' && <VREnvironment />}
      {phase === 'choose' && (
        <SpawnInFront key="choose">
          <PlacementChooser onChoose={startPlacing} lastMode={placement?.mode} />
        </SpawnInFront>
      )}
      {phase === 'restoring' && (
        <SpawnInFront key="restoring">
          <Button3D label="Looking for your board…" width={0.4} height={0.06} variant="ghost" onClick={() => useXRApp.getState().setPhase('notFound')} />
        </SpawnInFront>
      )}
      {phase === 'notFound' && (
        <SpawnInFront key="notfound">
          <NotFoundPanel onPlace={() => useXRApp.getState().setPhase('choose')} onFloat={floatHere} />
        </SpawnInFront>
      )}
      {phase === 'placing' && <PlacementController key={placingMode} mode={placingMode} size={size} tiltDeg={tilt} onConfirm={onConfirm} />}
      {(phase === 'adjusting' || phase === 'working') && placement && <AnchoredBoard dark={dark} />}
      <XRPhoneHud onChoose={startPlacing} />
    </>
  )
}

function AnchoredBoard({ dark }: { dark: boolean }) {
  const placement = usePlacements((s) => s.placement)!
  const phase = useXRApp((s) => s.phase)
  const menuOpen = useXRApp((s) => s.menuOpen)
  const detailCardId = useView((s) => s.detailCardId)
  const editCardId = useView((s) => s.editCardId)
  const leftHanded = useSettings((s) => s.leftHanded)
  const phoneOverlay = useXRApp((s) => s.caps.domOverlay)
  const session = useXR((s) => s.session)
  const originSpace = useXR((s) => s.originReferenceSpace)
  const gl = useThree((s) => s.gl)
  const group = useRef<Group>(null)
  const [lost, setLost] = useState(false)
  const lostRef = useRef(false)
  const tmp = useMemo(() => ({ offset: new Matrix4(), world: new Matrix4(), inv: new Matrix4(), p: new Vector3(), a: new Vector3() }), [])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const rt = anchorRuntime
    const now = performance.now()
    const frame = gl.xr.getFrame?.() as XRFrame | undefined
    const refSpace = originSpace ?? gl.xr.getReferenceSpace() ?? undefined
    if (rt.anchor && frame && refSpace) {
      try {
        const pose = frame.getPose(rt.anchor.anchorSpace, refSpace)
        if (pose) {
          rt.pose.fromArray(pose.transform.matrix)
          rt.hasPose = true
          rt.lastSeen = now
        }
      } catch {
        // Anchor deleted underneath us.
      }
    }
    // Tracking loss: freeze at the last good pose and fade to 50% (don't hide it).
    const isLost = !!rt.anchor && rt.hasPose && now - rt.lastSeen > TRACKING_LOST_MS
    if (isLost !== lostRef.current) {
      lostRef.current = isLost
      setLost(isLost)
      useXRApp.getState().set({ tracking: isLost ? 'lost' : 'ok' })
    }
    // Newly created anchor: express the board relative to it.
    if (rt.pendingBoard && rt.anchor && rt.hasPose) {
      tmp.offset.copy(rt.pose).invert().multiply(rt.pendingBoard)
      usePlacements.getState().updatePlacement({ localOffset: matrixToPose(tmp.offset) })
      rt.pendingBoard = null
    }
    const p = usePlacements.getState().placement
    if (!p) return
    poseToMatrix(p.localOffset, tmp.offset)
    if (rt.pendingBoard) tmp.world.copy(rt.pendingBoard)
    else if (rt.anchor && rt.hasPose) tmp.world.multiplyMatrices(rt.pose, tmp.offset)
    else tmp.world.copy(tmp.offset)

    // Re-anchor after large moves: anchors are most accurate near where they were made.
    if (rt.reanchor && frame && refSpace) {
      rt.reanchor = false
      const board = tmp.world.clone()
      const oldHandle = p.anchorHandle
      const oldAnchor = rt.anchor
      void createAnchorInFrame(frame, refSpace, board, null).then(async (anchor) => {
        if (!anchor) return
        rt.anchor = anchor
        rt.hasPose = false
        rt.pendingBoard = board
        oldAnchor?.delete?.()
        void forgetAnchor(session, oldHandle)
        const handle = await persistAnchor(anchor)
        usePlacements.getState().updatePlacement({ anchorHandle: handle })
      })
    }

    g.matrix.copy(tmp.world)
    g.matrixWorldNeedsUpdate = true
  })

  const [W, H] = placement.size
  const side = leftHanded ? -1 : 1

  return (
    <group ref={group} matrixAutoUpdate={false}>
      <BoardContent size={placement.size} dark={dark} opacity={lost ? 0.5 : 1}>
        {(layout: BoardLayout) => (
          <>
            <BoardHandles layout={layout} emphasized={phase === 'adjusting'} />
            <MenuButton layout={layout} />
            {menuOpen && (
              <group position={[side * (W / 2 + 0.04), H / 2, 0.01]}>
                <DistanceScaled base={Math.max(0.6, Math.min(1, 0.4 + 0.6 * layout.k))}>
                  <group position={[side * 0.18, -0.32, 0]}>
                    <BoardMenu3D
                      onClose={() => useXRApp.getState().set({ menuOpen: false })}
                      onMove={() => {
                        useXRApp.getState().set({ menuOpen: false })
                        useXRApp.getState().setPhase('adjusting')
                      }}
                      onReplace={() => {
                        useXRApp.getState().set({ menuOpen: false, placingMode: placement.mode })
                        useXRApp.getState().setPhase('choose')
                      }}
                      onPreset={(preset) => applyPreset(preset)}
                    />
                  </group>
                </DistanceScaled>
              </group>
            )}
            {detailCardId && !menuOpen && !phoneOverlay && (
              <group position={[side * (W / 2 + 0.04), H / 2, 0.01]}>
                <DistanceScaled base={Math.max(0.6, Math.min(1, 0.4 + 0.6 * layout.k))}>
                  <group position={[side * 0.2, -0.25, 0]}>
                    <DetailPanel3D cardId={detailCardId} onEditTitle={() => useView.getState().set({ editCardId: detailCardId, editIsNew: false })} />
                    {editCardId && <EditKeyboard cardId={editCardId} />}
                  </group>
                </DistanceScaled>
              </group>
            )}
            {phase === 'adjusting' && (
              <Button3D
                label="Done"
                variant="primary"
                width={0.14}
                height={0.05}
                position={[0, -H / 2 - layout.handle.h * 2 - 0.07, 0.01]}
                onClick={() => {
                  useXRApp.getState().setPhase('working')
                  playSound('drop')
                }}
              />
            )}
            <Toast3D position={[0, -H / 2 - (phase === 'adjusting' ? 0.2 : 0.12), 0.02]} />
          </>
        )}
      </BoardContent>
    </group>
  )
}

function EditKeyboard({ cardId }: { cardId: string }) {
  const card = useBoardStore((s) => s.doc.cards[cardId])
  const isNew = useView((s) => s.editIsNew)
  if (!card) return null
  const close = () => useView.getState().set({ editCardId: null, editIsNew: false })
  return (
    <group position={[0, -0.47, 0.02]} rotation={[-0.25, 0, 0]}>
      <Keyboard3D
        key={cardId}
        initial={isNew ? '' : card.title}
        title={isNew ? 'New card title' : 'Edit title'}
        onSubmit={(text) => {
          if (text) useBoardStore.getState().dispatch({ type: 'card/update', id: cardId, changes: { title: text } })
          close()
        }}
        onCancel={() => {
          if (isNew) {
            useBoardStore.getState().dispatch({ type: 'card/delete', id: cardId })
            useView.getState().set({ detailCardId: null })
          }
          close()
        }}
      />
    </group>
  )
}

function MenuButton({ layout }: { layout: BoardLayout }) {
  const open = useXRApp((s) => s.menuOpen)
  const r = layout.menu
  const [x, y] = toLocal(r.x + r.w / 2, r.y + r.h / 2, layout.size)
  const w = Math.max(0.07, r.w * 1.9)
  return (
    <Button3D
      label={open ? 'Close' : 'Menu'}
      width={w}
      height={Math.max(0.034, r.h)}
      fontSize={Math.max(0.012, r.h * 0.38)}
      active={open}
      position={[x - (layout.menu.x > layout.size[0] / 2 ? (w - r.w) / 2 : -(w - r.w) / 2), y, 0.004]}
      onClick={() => useXRApp.getState().set({ menuOpen: !open })}
    />
  )
}

/** Resize to a scale preset (PLAN §5.4), keeping the board centered where it is. */
function applyPreset(preset: ScalePreset) {
  useSettings.getState().set({ scalePreset: preset })
  const p = usePlacements.getState().placement
  if (!p) return
  usePlacements.getState().updatePlacement({ size: PRESET_SIZES[preset] })
}

