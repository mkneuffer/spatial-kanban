import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { isXRInputSourceState } from '@react-three/xr'
import { BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, Vector3, type Object3D, type Ray } from 'three'
import type { AnySkin } from '../skins/types'
import type { ID } from '../data/model'
import { useBoardStore } from '../data/store'
import { usePlacements } from '../data/placements'
import { dragReducer, IDLE, NEW_CARD_ID, TAP_MAX_MS, tapSlop, type DragContext, type DragPoint, type PointerKind } from './drag'
import { runDragEffects } from './effects'
import type { BoardLayout } from './layout'
import { useBoardRuntime } from './runtime'
import { clipSpan, rayToPlaneZ, toBoard, toLocal, type Rect } from './space'
import { useView } from './viewStore'
import { playSound } from '../fx/audio'
import { pulse } from '../fx/haptics'
import { onXRBackground } from '../xr/lifecycle'

/** The subset of pmndrs/pointer-events' PointerEvent this layer relies on. */
export interface XPointerEvent {
  pointerId: number
  pointerType: string
  pointerState?: unknown
  point: Vector3
  ray?: Ray
  pointerPosition?: Vector3
  /** Distance from the pointer to the hit (ray length, or sphere distance for grab/touch). */
  distance?: number
  /** Mouse button (0 for XR selects, grabs and touches). */
  button?: number
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

/** Only the primary button picks things up: right-drag and middle-drag stay with the orbit camera. */
export function isPrimaryButton(e: XPointerEvent): boolean {
  return (e.button ?? 0) === 0
}

export function inputSourceOf(e: XPointerEvent): XRInputSource | null {
  const s = e.pointerState
  return isXRInputSourceState(s) && 'inputSource' in s ? (s.inputSource as XRInputSource) : null
}

export function gamepadOf(e: XPointerEvent): Gamepad | null {
  return inputSourceOf(e)?.gamepad ?? null
}

const _inv = new Matrix4()
const _o = new Vector3()
const _d = new Vector3()

/** Rays that meet the board plane further away than this are grazing it; their hits are noise. */
const MAX_RAY_DISTANCE = 12

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

/** How far the pointer is from what it hit (for distance-scaled tap slop). */
export function pointerDistance(e: XPointerEvent): number {
  if (e.pointerPosition && e.point) return e.pointerPosition.distanceTo(e.point)
  return e.distance ?? 0
}

/**
 * Project a pointer into board space: rays intersect the plane z = planeZ;
 * grab/poke pointers use their 3D position. Returns null when a ray misses the
 * plane (parallel, pointing away, or grazing it far away) — callers keep the
 * previous point instead of letting the card fly off.
 */
export function eventToBoard(e: XPointerEvent, root: Object3D, size: [number, number], planeZ = 0): DragPoint | null {
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
    if (!hit || hit.t > MAX_RAY_DISTANCE) return null
    const { u, v } = toBoard(hit.x, hit.y, size)
    return { u, v, z: planeZ, t }
  }
  return hitToBoard(e, root, size, planeZ)
}

/** The event's hit point, dropped straight onto the board (fallback when there is no usable ray). */
function hitToBoard(e: XPointerEvent, root: Object3D, size: [number, number], planeZ = 0): DragPoint {
  root.updateWorldMatrix(true, false)
  _o.copy(e.point).applyMatrix4(_inv.copy(root.matrixWorld).invert())
  const { u, v } = toBoard(_o.x, _o.y, size)
  return { u, v, z: planeZ, t: performance.now() }
}

/** For presses: the pointer always hit something, so fall back to that hit. */
function pressToBoard(e: XPointerEvent, root: Object3D, size: [number, number], planeZ = 0): DragPoint {
  return eventToBoard(e, root, size, planeZ) ?? hitToBoard(e, root, size, planeZ)
}

const proxyGeometry = new BoxGeometry(1, 1, 1)
const proxyMaterial = new MeshBasicMaterial({ visible: false })
const PROXY_DEPTH = 0.012
/** Board surfaces lose to anything else a pointer touches (a grab sphere often reaches both a card and the board). */
const SURFACE_ORDER = -1

/**
 * `visible = false` does not stop three's raycast or pmndrs' sphere tests, so
 * proxies that must not be hit are switched off through pointer-events itself.
 */
function setHittable(o: Object3D, on: boolean) {
  o.visible = on
  o.pointerEvents = on ? 'auto' : 'none'
}

interface SurfacePress {
  columnId: ID | null
  pointerId: number
  start: DragPoint
  s0: number
  slop: number
  moved: boolean
  scrollable: boolean
}

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
  const placed = useRef(new WeakSet<Mesh>())
  const gamepad = useRef<Gamepad | null>(null)
  /** Board-local z of the plane a ray drags a parked card in (its own depth, not the board's). */
  const dragPlane = useRef(0)
  const surfacePress = useRef<SurfacePress | null>(null)
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

  // Leaving the board (exit XR, 3D → 2D) mid-gesture must not strand a drag, a locked camera or stale hovers.
  useEffect(
    () => () => {
      const v = useView.getState()
      if (v.drag.phase !== 'idle' || v.columnDrag) v.set({ drag: IDLE, columnDrag: null })
      runtime.animator.delete(NEW_CARD_ID)
      runtime.hoverCards.clear()
      runtime.hoverColumns.clear()
      if (controls) controls.enabled = true
    },
    [runtime, controls],
  )

  // The system menu (or headset sleep) removes input sources without leave or up events.
  useEffect(
    () =>
      onXRBackground(() => {
        runtime.hoverCards.clear()
        runtime.hoverColumns.clear()
        surfacePress.current = null
        if (controls) controls.enabled = true
      }),
    [runtime, controls],
  )

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
    if (state.phase === 'idle') {
      runtime.dragSize = null
      if (view.drag.source === 'pad') runtime.animator.delete(NEW_CARD_ID)
    }
  }

  /** A card or column drag is in progress (one at a time; other pointers wait). */
  const busy = () => {
    const v = useView.getState()
    return v.drag.phase !== 'idle' || v.columnDrag !== null
  }

  const onCardDown = (id: ID) => (raw: unknown) => {
    const e = raw as XPointerEvent
    if (!runtime.root || !isPrimaryButton(e) || busy()) return
    e.stopPropagation()
    e.target.setPointerCapture?.(e.pointerId)
    gamepad.current = gamepadOf(e)
    const kind = pointerKindOf(e.pointerType)
    const a = runtime.animator.peek(id)
    const slot = layout.cards[id]
    // Read at press time: the render-time closure can lag a park/unpark by a frame.
    const free = usePlacements.getState().freeCards[id]
    // A ray drags a parked card in its own plane, parallel to the board, so it doesn't jump onto the board.
    dragPlane.current = free && kind !== 'grab' && kind !== 'touch' ? free.localOffset.position[2] : 0
    const point = pressToBoard(e, runtime.root, layout.size, dragPlane.current)
    const center = a ? toBoard(a.x, a.y, layout.size) : slot ? { u: slot.rect.x + slot.rect.w / 2, v: slot.rect.y + slot.rect.h / 2 } : { u: point.u, v: point.v }
    runtime.dragSize = a ? [a.w, a.h] : slot ? [slot.rect.w, slot.rect.h] : null
    lockCamera(true)
    dispatch({
      type: 'down',
      pointerId: e.pointerId,
      pointerKind: kind,
      cardId: id,
      source: free ? 'free' : 'board',
      point,
      cardCenter: [center.u, center.v],
      slop: tapSlop(kind, pointerDistance(e)),
    })
  }

  const onPadDown = (raw: unknown) => {
    const e = raw as XPointerEvent
    if (!runtime.root || !isPrimaryButton(e) || busy()) return
    e.stopPropagation()
    e.target.setPointerCapture?.(e.pointerId)
    gamepad.current = gamepadOf(e)
    const kind = pointerKindOf(e.pointerType)
    dragPlane.current = 0
    const point = pressToBoard(e, runtime.root, layout.size)
    runtime.dragSize = layout.newCardSize
    lockCamera(true)
    dispatch({
      type: 'down',
      pointerId: e.pointerId,
      pointerKind: kind,
      cardId: NEW_CARD_ID,
      source: 'pad',
      point,
      cardCenter: [point.u, point.v],
      slop: tapSlop(kind, pointerDistance(e)),
    })
  }

  /** The plane the active drag projects rays onto: a parked card's own depth until it's back on the board. */
  const planeFor = () => {
    const drag = useView.getState().drag
    return drag.source === 'free' && drag.phase !== 'dragOnBoard' ? dragPlane.current : 0
  }

  const onMove = (raw: unknown) => {
    const e = raw as XPointerEvent
    const drag = useView.getState().drag
    if (!runtime.root || drag.phase === 'idle' || drag.pointerId !== e.pointerId) return
    e.stopPropagation()
    const point = eventToBoard(e, runtime.root, layout.size, planeFor())
    if (point) dispatch({ type: 'move', pointerId: e.pointerId, point })
  }

  const onUp = (raw: unknown) => {
    const e = raw as XPointerEvent
    const drag = useView.getState().drag
    if (!runtime.root || drag.phase === 'idle' || drag.pointerId !== e.pointerId) return
    e.stopPropagation()
    e.target.releasePointerCapture?.(e.pointerId)
    lockCamera(false)
    // A ray that slid off the plane at release drops the card where it was last shown.
    const point = eventToBoard(e, runtime.root, layout.size, planeFor()) ?? { ...(drag.current ?? drag.start!), t: performance.now() }
    dispatch({ type: 'up', pointerId: e.pointerId, point })
  }

  const onCancel = (raw: unknown) => {
    const e = raw as XPointerEvent
    const drag = useView.getState().drag
    if (drag.phase === 'idle' || drag.pointerId !== e.pointerId) return
    lockCamera(false)
    dispatch({ type: 'cancel', pointerId: e.pointerId })
  }

  const cardHover = (id: ID) => ({
    onPointerEnter: (raw: unknown) => {
      const e = raw as XPointerEvent
      runtime.hoverCards.set(e.pointerId, id)
      if (useView.getState().drag.phase === 'idle' && pointerKindOf(e.pointerType) === 'ray') pulse(gamepadOf(e), 'tick')
    },
    onPointerLeave: (raw: unknown) => {
      const e = raw as XPointerEvent
      if (runtime.hoverCards.get(e.pointerId) === id) runtime.hoverCards.delete(e.pointerId)
    },
  })

  // ——— Board surface (column bodies + backdrop): hover (thumbstick target), wheel and swipe
  // scrolling, and a tap on empty board clears the selection ———
  const scrollBy = (columnId: ID, delta: number) => {
    const col = layout.columnById[columnId]
    if (!col || skin.overflow !== 'scroll' || col.maxScroll <= 0) return
    const v = useView.getState()
    const next = Math.max(0, Math.min(col.maxScroll, (v.scroll[columnId] ?? 0) + delta))
    if (next !== v.scroll[columnId]) v.setScroll(columnId, next)
  }

  const endSurfacePress = (e: XPointerEvent) => {
    const sp = surfacePress.current
    if (!sp || sp.pointerId !== e.pointerId) return null
    e.target.releasePointerCapture?.(e.pointerId)
    if (sp.scrollable) lockCamera(false)
    surfacePress.current = null
    return sp
  }

  const surfaceHandlers = (columnId: ID | null) => ({
    onPointerEnter: (raw: unknown) => {
      const e = raw as XPointerEvent
      if (columnId) runtime.hoverColumns.set(e.pointerId, { columnId, source: inputSourceOf(e) })
    },
    onPointerLeave: (raw: unknown) => {
      const e = raw as XPointerEvent
      if (columnId && runtime.hoverColumns.get(e.pointerId)?.columnId === columnId) runtime.hoverColumns.delete(e.pointerId)
    },
    onWheel: (raw: unknown) => {
      const e = raw as XPointerEvent
      if (!columnId) return
      e.stopPropagation()
      scrollBy(columnId, (e.deltaY ?? 0) * 0.0004 * layout.k)
    },
    onPointerDown: (raw: unknown) => {
      const e = raw as XPointerEvent
      if (!runtime.root || !isPrimaryButton(e) || busy() || surfacePress.current) return
      e.stopPropagation()
      e.target.setPointerCapture?.(e.pointerId)
      const col = columnId ? layout.columnById[columnId] : undefined
      const scrollable = !!col && skin.overflow === 'scroll' && col.maxScroll > 0
      if (scrollable) lockCamera(true)
      surfacePress.current = {
        columnId,
        pointerId: e.pointerId,
        start: pressToBoard(e, runtime.root, layout.size),
        s0: columnId ? useView.getState().scroll[columnId] ?? 0 : 0,
        slop: tapSlop(pointerKindOf(e.pointerType), pointerDistance(e)),
        moved: false,
        scrollable,
      }
    },
    onPointerMove: (raw: unknown) => {
      const e = raw as XPointerEvent
      const sp = surfacePress.current
      if (!runtime.root || !sp || sp.pointerId !== e.pointerId) return
      const p = eventToBoard(e, runtime.root, layout.size)
      if (!p) return
      if (!sp.moved && Math.hypot(p.u - sp.start.u, p.v - sp.start.v, p.z - sp.start.z) > sp.slop) sp.moved = true
      if (sp.moved && sp.scrollable && sp.columnId) {
        const target = sp.s0 - (p.v - sp.start.v)
        scrollBy(sp.columnId, target - (useView.getState().scroll[sp.columnId] ?? 0))
      }
    },
    onPointerUp: (raw: unknown) => {
      const e = raw as XPointerEvent
      const sp = endSurfacePress(e)
      if (!sp) return
      const tap = !sp.moved && performance.now() - sp.start.t <= TAP_MAX_MS
      if (tap && useView.getState().detailCardId) {
        useView.getState().select(null)
        playSound('clickSoft')
      }
    },
    onPointerCancel: (raw: unknown) => {
      endSurfacePress(raw as XPointerEvent)
    },
  })

  // ——— Column headers: drag sideways to reorder ———
  const endColumnDrag = (e: XPointerEvent) => {
    const cd = useView.getState().columnDrag
    if (!cd || cd.pointerId !== e.pointerId) return null
    e.target.releasePointerCapture?.(e.pointerId)
    lockCamera(false)
    useView.getState().set({ columnDrag: null })
    return cd
  }

  const headerHandlers = (columnId: ID) => ({
    onPointerDown: (raw: unknown) => {
      const e = raw as XPointerEvent
      if (!runtime.root || !isPrimaryButton(e) || busy()) return
      e.stopPropagation()
      e.target.setPointerCapture?.(e.pointerId)
      const p = pressToBoard(e, runtime.root, layout.size)
      const index = layout.columns.findIndex((c) => c.id === columnId)
      lockCamera(true)
      useView.getState().set({
        columnDrag: { columnId, pointerId: e.pointerId, targetIndex: index, u: p.u, u0: p.u, slop: tapSlop(pointerKindOf(e.pointerType), pointerDistance(e)), moved: false },
      })
    },
    onPointerMove: (raw: unknown) => {
      const e = raw as XPointerEvent
      const cd = useView.getState().columnDrag
      if (!runtime.root || !cd || cd.pointerId !== e.pointerId) return
      const p = eventToBoard(e, runtime.root, layout.size)
      if (!p) return
      const moved = cd.moved || Math.abs(p.u - cd.u0) > cd.slop
      if (!moved) return
      const others = layout.columns.filter((c) => c.id !== cd.columnId)
      let targetIndex = 0
      for (const c of others) if (c.rect.x + c.rect.w / 2 < p.u) targetIndex++
      if (!cd.moved || targetIndex !== cd.targetIndex || Math.abs(p.u - cd.u) > 0.002) {
        if (targetIndex !== cd.targetIndex) {
          playSound(skin.sounds.tick)
          pulse(gamepadOf(e), 'tick')
        }
        useView.getState().set({ columnDrag: { ...cd, targetIndex, u: p.u, moved: true } })
      }
    },
    onPointerUp: (raw: unknown) => {
      const e = raw as XPointerEvent
      const cd = endColumnDrag(e)
      if (!cd || !cd.moved) return
      const from = layout.columns.findIndex((c) => c.id === cd.columnId)
      if (cd.targetIndex !== from) {
        useBoardStore.getState().dispatch({ type: 'column/move', id: cd.columnId, toIndex: cd.targetIndex })
        playSound(skin.sounds.drop)
        pulse(gamepadOf(e), 'firm')
      }
    },
    onPointerCancel: (raw: unknown) => {
      endColumnDrag(raw as XPointerEvent)
    },
  })

  // Per frame: proxies follow their animated cards, clipped to what's actually visible.
  useFrame(() => {
    const [, H] = layout.size
    const free = usePlacements.getState().freeCards
    const { drag, leaving } = useView.getState()
    const dragId = drag.phase !== 'idle' ? drag.cardId : null
    for (const [id, mesh] of proxies.current) {
      const a = runtime.animator.peek(id)
      if (!a || !a.initialized || leaving[id]) {
        setHittable(mesh, false)
        continue
      }
      let y = a.y
      let h = a.h * a.scale
      const slot = layout.cards[id]
      // Parked and dragged cards float free of their column, so its scroll viewport doesn't apply.
      if (slot && !free[id] && id !== dragId) {
        if (slot.hidden) {
          setHittable(mesh, false)
          continue
        }
        // A card half scrolled out of its column must not catch pointers over the header or footer.
        if (Number.isFinite(slot.clip[0]) || Number.isFinite(slot.clip[1])) {
          const span = clipSpan(a.y, h, H / 2 - slot.clip[1], H / 2 - slot.clip[0])
          if (!span) {
            setHittable(mesh, false)
            continue
          }
          y = span.c
          h = span.len
        }
      }
      setHittable(mesh, true)
      mesh.position.set(a.x, y, a.z + 0.004)
      mesh.rotation.set(0, 0, a.rot)
      mesh.scale.set(Math.max(0.0001, a.w * a.scale), Math.max(0.0001, h), PROXY_DEPTH)
    }
  })

  const rectMesh = (r: Rect, z: number, depth: number) => {
    const [x, y] = toLocal(r.x + r.w / 2, r.y + r.h / 2, layout.size)
    return { position: [x, y, z] as [number, number, number], scale: [r.w, r.h, depth] as [number, number, number] }
  }
  const surfaceRef = (m: Mesh | null) => {
    if (m) m.pointerEventsOrder = SURFACE_ORDER
  }

  return (
    <group name="hit-proxies">
      {ids.map((id) => (
        <mesh
          key={id}
          ref={(m) => {
            if (m) {
              // A new proxy isn't hittable until a frame has put it where its card is
              // (until then it's a 1 m box at the board center).
              if (!placed.current.has(m)) {
                placed.current.add(m)
                setHittable(m, false)
              }
              proxies.current.set(id, m)
            } else proxies.current.delete(id)
          }}
          geometry={proxyGeometry}
          material={proxyMaterial}
          userData={{ cardId: id }}
          onPointerDown={onCardDown(id)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          {...cardHover(id)}
        />
      ))}
      <mesh ref={surfaceRef} geometry={proxyGeometry} material={proxyMaterial} {...rectMesh({ x: 0, y: 0, w: layout.size[0], h: layout.size[1] }, -0.004, 0.002)} {...surfaceHandlers(null)} />
      {layout.columns.map((col) => (
        <group key={col.id}>
          <mesh ref={surfaceRef} geometry={proxyGeometry} material={proxyMaterial} {...rectMesh(col.body, -0.001, 0.004)} {...surfaceHandlers(col.id)} />
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
  if (!cd?.moved) return null
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
