import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { isXRInputSourceState } from '@react-three/xr'
import { BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, Vector3, type Object3D, type Ray } from 'three'
import type { AnySkin } from '../skins/types'
import type { ID } from '../data/model'
import { useBoardStore } from '../data/store'
import { usePlacements } from '../data/placements'
import { dragReducer, IDLE, NEW_CARD_ID, type DragContext, type DragPoint, type DragSource, type PointerKind } from './drag'
import { runDragEffects } from './effects'
import type { BoardLayout } from './layout'
import { useBoardRuntime } from './runtime'
import { rayToPlaneZ, toBoard, toLocal, type Rect } from './space'
import { useView } from './viewStore'
import { playSound } from '../fx/audio'

/** The subset of pmndrs/pointer-events' PointerEvent this layer relies on. */
export interface XPointerEvent {
  pointerId: number
  pointerType: string
  pointerState?: unknown
  point: Vector3
  ray?: Ray
  pointerPosition?: Vector3
  target: Object3D
  object: Object3D
  deltaY?: number
  stopPropagation(): void
}

export function pointerKindOf(type: string): PointerKind {
  if (type.startsWith('screen')) return type.includes('touch') ? 'screen' : 'mouse'
  if (type.includes('grab')) return 'grab'
  if (type.includes('touch')) return 'touch'
  return 'ray'
}

export function gamepadOf(e: XPointerEvent): Gamepad | null {
  const s = e.pointerState
  return isXRInputSourceState(s) && 'inputSource' in s ? ((s.inputSource as XRInputSource).gamepad ?? null) : null
}

const _inv = new Matrix4()
const _o = new Vector3()
const _d = new Vector3()

/**
 * The pointer's world ray. pmndrs' `event.ray` follows the camera's forward
 * axis for screen pointers, so derive it from the pointer origin through the
 * intersection point instead — correct for mouse, touch and XR rays alike.
 */
export function pointerRay(e: XPointerEvent): { origin: Vector3; direction: Vector3 } | null {
  if (e.pointerPosition && e.point) {
    const direction = e.point.clone().sub(e.pointerPosition)
    if (direction.lengthSq() > 1e-10) return { origin: e.pointerPosition.clone(), direction: direction.normalize() }
  }
  if (e.ray) return { origin: e.ray.origin.clone(), direction: e.ray.direction.clone() }
  return null
}

/** Project a pointer into board space: rays intersect a plane; grab/poke pointers use their 3D position. */
export function eventToBoard(e: XPointerEvent, root: Object3D, size: [number, number], planeZ = 0): DragPoint {
  root.updateWorldMatrix(true, false)
  _inv.copy(root.matrixWorld).invert()
  const kind = pointerKindOf(e.pointerType)
  const t = performance.now()
  if ((kind === 'grab' || kind === 'touch') && e.pointerPosition) {
    _o.copy(e.pointerPosition).applyMatrix4(_inv)
    const { u, v } = toBoard(_o.x, _o.y, size)
    return { u, v, z: Math.max(0, _o.z), t }
  }
  const ray = pointerRay(e)
  if (ray) {
    _o.copy(ray.origin).applyMatrix4(_inv)
    _d.copy(ray.direction).transformDirection(_inv)
    const hit = rayToPlaneZ([_o.x, _o.y, _o.z], [_d.x, _d.y, _d.z], planeZ)
    if (hit) {
      const { u, v } = toBoard(hit.x, hit.y, size)
      return { u, v, z: planeZ, t }
    }
  }
  _o.copy(e.point).applyMatrix4(_inv)
  const { u, v } = toBoard(_o.x, _o.y, size)
  return { u, v, z: planeZ, t }
}

const proxyGeometry = new BoxGeometry(1, 1, 1)
const proxyMaterial = new MeshBasicMaterial({ visible: false })
const PROXY_DEPTH = 0.012

interface Props {
  layout: BoardLayout
  skin: AnySkin
}

/**
 * Invisible hit proxies for cards, columns, the pad — and the glue that turns
 * unified pointer events (ray, grab, poke, touch, mouse) into drag-reducer events.
 * Board logic never checks which device it runs on (PLAN §6.1).
 */
export function BoardInteraction({ layout, skin }: Props) {
  const runtime = useBoardRuntime()
  const freeCards = usePlacements((s) => s.freeCards)
  const dragPhase = useView((s) => s.drag.phase)
  const dragCardId = useView((s) => s.drag.cardId)
  const proxies = useRef(new Map<ID, Mesh>())
  const gamepad = useRef<Gamepad | null>(null)
  const scrollDrag = useRef<{ columnId: ID; pointerId: number; v0: number; s0: number; moved: boolean } | null>(null)
  // Desktop 3D: stop the orbit camera while something on the board is being dragged.
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const lockCamera = (locked: boolean) => {
    if (controls) controls.enabled = !locked
  }

  const ids = useMemo(() => {
    const set = new Set(Object.keys(layout.cards))
    for (const id in freeCards) set.add(id)
    if (dragCardId && dragPhase !== 'idle') set.add(dragCardId)
    return [...set]
  }, [layout, freeCards, dragCardId, dragPhase])

  const ctx = (): DragContext => {
    const root = runtime.root!
    root.updateWorldMatrix(true, false)
    _inv.copy(root.matrixWorld).invert()
    const down = new Vector3(0, -1, 0).transformDirection(_inv)
    return { layout: runtime.baseLayout ?? layout, insertionIndex: skin.insertionIndex, downLocal: [down.x, down.y, down.z] }
  }

  const dispatch = (event: Parameters<typeof dragReducer>[1]) => {
    const view = useView.getState()
    const { state, effects } = dragReducer(view.drag, event, ctx())
    if (state !== view.drag) view.set({ drag: state })
    if (effects.length) runDragEffects(effects, runtime, gamepad.current)
  }

  const onCardDown = (id: ID, source: DragSource) => (raw: unknown) => {
    const e = raw as XPointerEvent
    if (!runtime.root || useView.getState().drag.phase !== 'idle') return
    e.stopPropagation()
    e.target.setPointerCapture?.(e.pointerId)
    gamepad.current = gamepadOf(e)
    const a = runtime.animator.peek(id)
    const slot = layout.cards[id]
    const free = usePlacements.getState().freeCards[id]
    const planeZ = source === 'free' && free ? free.localOffset.position[2] : 0
    const point = eventToBoard(e, runtime.root, layout.size, source === 'free' && pointerKindOf(e.pointerType) !== 'ray' ? planeZ : 0)
    const center = a ? toBoard(a.x, a.y, layout.size) : slot ? { u: slot.rect.x + slot.rect.w / 2, v: slot.rect.y + slot.rect.h / 2 } : { u: point.u, v: point.v }
    runtime.dragSize = a ? [a.w, a.h] : slot ? [slot.rect.w, slot.rect.h] : null
    lockCamera(true)
    dispatch({ type: 'down', pointerId: e.pointerId, pointerKind: pointerKindOf(e.pointerType), cardId: id, source, point, cardCenter: [center.u, center.v] })
  }

  const onPadDown = (raw: unknown) => {
    const e = raw as XPointerEvent
    if (!runtime.root || useView.getState().drag.phase !== 'idle') return
    e.stopPropagation()
    e.target.setPointerCapture?.(e.pointerId)
    gamepad.current = gamepadOf(e)
    const point = eventToBoard(e, runtime.root, layout.size)
    runtime.dragSize = layout.newCardSize
    lockCamera(true)
    dispatch({ type: 'down', pointerId: e.pointerId, pointerKind: pointerKindOf(e.pointerType), cardId: NEW_CARD_ID, source: 'pad', point, cardCenter: [point.u, point.v] })
  }

  const onMove = (raw: unknown) => {
    const e = raw as XPointerEvent
    const drag = useView.getState().drag
    if (!runtime.root || drag.phase === 'idle' || drag.pointerId !== e.pointerId) return
    e.stopPropagation()
    const point = eventToBoard(e, runtime.root, layout.size)
    dispatch({ type: 'move', pointerId: e.pointerId, point })
  }

  const onUp = (raw: unknown) => {
    const e = raw as XPointerEvent
    const drag = useView.getState().drag
    if (!runtime.root || drag.phase === 'idle' || drag.pointerId !== e.pointerId) return
    e.stopPropagation()
    e.target.releasePointerCapture?.(e.pointerId)
    lockCamera(false)
    const point = eventToBoard(e, runtime.root, layout.size)
    dispatch({ type: 'up', pointerId: e.pointerId, point })
  }

  const onCancel = (raw: unknown) => {
    const e = raw as XPointerEvent
    const drag = useView.getState().drag
    if (drag.pointerId === e.pointerId) {
      lockCamera(false)
      useView.getState().set({ drag: IDLE })
    }
  }

  // Hover is tracked per pointer. Each hand's pointers hand over within one commit
  // (a ray leaving as the near-field grab or poke enters), so a bare "leave → clear"
  // would wipe the highlight the direct pointer just set.
  const hovers = useRef(new Map<number, ID>())
  const syncHover = () => {
    const v = useView.getState()
    if (v.drag.phase !== 'idle') return
    let last: ID | null = null
    for (const id of hovers.current.values()) last = id
    if (v.hoverCardId !== last) v.set({ hoverCardId: last })
  }
  const hoverEnter = (id: ID) => (raw: unknown) => {
    const { pointerId } = raw as XPointerEvent
    hovers.current.delete(pointerId)
    hovers.current.set(pointerId, id)
    syncHover()
  }
  const hoverLeave = (id: ID) => (raw: unknown) => {
    const { pointerId } = raw as XPointerEvent
    if (hovers.current.get(pointerId) === id) hovers.current.delete(pointerId)
    syncHover()
  }

  // ——— Column bodies: hover (thumbstick scroll target), wheel and swipe scrolling ———
  const scrollBy = (columnId: ID, delta: number) => {
    const col = layout.columnById[columnId]
    if (!col || skin.overflow !== 'scroll' || col.maxScroll <= 0) return
    const v = useView.getState()
    const next = Math.max(0, Math.min(col.maxScroll, (v.scroll[columnId] ?? 0) + delta))
    if (next !== v.scroll[columnId]) v.setScroll(columnId, next)
  }

  const bodyHandlers = (columnId: ID) => ({
    onPointerEnter: () => useView.getState().set({ hoverColumnId: columnId }),
    onPointerLeave: () => {
      if (useView.getState().hoverColumnId === columnId) useView.getState().set({ hoverColumnId: null })
    },
    onWheel: (raw: unknown) => {
      const e = raw as XPointerEvent
      e.stopPropagation()
      scrollBy(columnId, (e.deltaY ?? 0) * 0.0004 * layout.k)
    },
    onPointerDown: (raw: unknown) => {
      const e = raw as XPointerEvent
      if (!runtime.root || skin.overflow !== 'scroll') return
      e.stopPropagation()
      e.target.setPointerCapture?.(e.pointerId)
      const p = eventToBoard(e, runtime.root, layout.size)
      lockCamera(true)
      scrollDrag.current = { columnId, pointerId: e.pointerId, v0: p.v, s0: useView.getState().scroll[columnId] ?? 0, moved: false }
    },
    onPointerMove: (raw: unknown) => {
      const e = raw as XPointerEvent
      const sd = scrollDrag.current
      if (!runtime.root || !sd || sd.pointerId !== e.pointerId) return
      const p = eventToBoard(e, runtime.root, layout.size)
      const target = sd.s0 - (p.v - sd.v0)
      sd.moved = true
      scrollBy(columnId, target - (useView.getState().scroll[columnId] ?? 0))
    },
    onPointerUp: (raw: unknown) => {
      const e = raw as XPointerEvent
      if (scrollDrag.current?.pointerId === e.pointerId) {
        e.target.releasePointerCapture?.(e.pointerId)
        lockCamera(false)
        scrollDrag.current = null
      }
    },
  })

  // ——— Column headers: drag sideways to reorder ———
  const headerHandlers = (columnId: ID) => ({
    onPointerDown: (raw: unknown) => {
      const e = raw as XPointerEvent
      if (!runtime.root || useView.getState().drag.phase !== 'idle') return
      e.stopPropagation()
      e.target.setPointerCapture?.(e.pointerId)
      const p = eventToBoard(e, runtime.root, layout.size)
      const index = layout.columns.findIndex((c) => c.id === columnId)
      lockCamera(true)
      useView.getState().set({ columnDrag: { columnId, pointerId: e.pointerId, targetIndex: index, u: p.u } })
    },
    onPointerMove: (raw: unknown) => {
      const e = raw as XPointerEvent
      const cd = useView.getState().columnDrag
      if (!runtime.root || !cd || cd.pointerId !== e.pointerId) return
      const p = eventToBoard(e, runtime.root, layout.size)
      const others = layout.columns.filter((c) => c.id !== cd.columnId)
      let targetIndex = 0
      for (const c of others) if (c.rect.x + c.rect.w / 2 < p.u) targetIndex++
      if (targetIndex !== cd.targetIndex || Math.abs(p.u - cd.u) > 0.002) {
        if (targetIndex !== cd.targetIndex) playSound(skin.sounds.tick)
        useView.getState().set({ columnDrag: { ...cd, targetIndex, u: p.u } })
      }
    },
    onPointerUp: (raw: unknown) => {
      const e = raw as XPointerEvent
      const cd = useView.getState().columnDrag
      if (!cd || cd.pointerId !== e.pointerId) return
      e.target.releasePointerCapture?.(e.pointerId)
      lockCamera(false)
      const from = layout.columns.findIndex((c) => c.id === cd.columnId)
      if (cd.targetIndex !== from) {
        useBoardStore.getState().dispatch({ type: 'column/move', id: cd.columnId, toIndex: cd.targetIndex })
        playSound(skin.sounds.drop)
      }
      useView.getState().set({ columnDrag: null })
    },
  })

  // Per frame: proxies follow their animated cards.
  useFrame(() => {
    for (const [id, mesh] of proxies.current) {
      const a = runtime.animator.peek(id)
      if (!a || !a.initialized) {
        mesh.visible = false
        continue
      }
      const hidden = layout.cards[id]?.hidden ?? false
      mesh.visible = !hidden
      mesh.position.set(a.x, a.y, a.z + 0.004)
      mesh.rotation.set(0, 0, a.rot)
      // Scrolled-out cards collapse so they can't be hit.
      const s = hidden ? 0.0001 : a.scale
      mesh.scale.set(Math.max(0.0001, a.w * s), Math.max(0.0001, a.h * s), PROXY_DEPTH)
    }
  })

  const rectMesh = (r: Rect, z: number, depth: number) => {
    const [x, y] = toLocal(r.x + r.w / 2, r.y + r.h / 2, layout.size)
    return { position: [x, y, z] as [number, number, number], scale: [r.w, r.h, depth] as [number, number, number] }
  }

  return (
    <group name="hit-proxies">
      {ids.map((id) => (
        <mesh
          key={id}
          ref={(m) => {
            if (m) proxies.current.set(id, m)
            else proxies.current.delete(id)
          }}
          geometry={proxyGeometry}
          material={proxyMaterial}
          userData={{ cardId: id }}
          onPointerDown={onCardDown(id, freeCards[id] ? 'free' : 'board')}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onPointerEnter={hoverEnter(id)}
          onPointerLeave={hoverLeave(id)}
        />
      ))}
      {layout.columns.map((col) => (
        <group key={col.id}>
          <mesh geometry={proxyGeometry} material={proxyMaterial} {...rectMesh(col.body, -0.001, 0.004)} {...bodyHandlers(col.id)} />
          <mesh geometry={proxyGeometry} material={proxyMaterial} {...rectMesh(col.header, 0.002, 0.006)} {...headerHandlers(col.id)} />
        </group>
      ))}
      <mesh
        geometry={proxyGeometry}
        material={proxyMaterial}
        {...rectMesh(layout.pad, 0.004, PROXY_DEPTH)}
        onPointerDown={onPadDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      />
      <ColumnDropMarker layout={layout} />
    </group>
  )
}

/** Accent bar showing where a dragged column header will land. */
function ColumnDropMarker({ layout }: { layout: BoardLayout }) {
  const cd = useView((s) => s.columnDrag)
  if (!cd) return null
  const others = layout.columns.filter((c) => c.id !== cd.columnId)
  let u: number
  if (others.length === 0) return null
  if (cd.targetIndex <= 0) u = others[0].rect.x - 0.007 * layout.k
  else if (cd.targetIndex >= others.length) u = others[others.length - 1].rect.x + others[others.length - 1].rect.w + 0.007 * layout.k
  else u = (others[cd.targetIndex - 1].rect.x + others[cd.targetIndex - 1].rect.w + others[cd.targetIndex].rect.x) / 2
  const col = layout.columns[0]
  const [x, y] = toLocal(u, col.rect.y + col.rect.h / 2, layout.size)
  return (
    <mesh position={[x, y, 0.006]} raycast={() => {}}>
      <planeGeometry args={[0.004 * Math.max(0.6, layout.k), col.rect.h]} />
      <meshBasicMaterial color="#4493f8" />
    </mesh>
  )
}
