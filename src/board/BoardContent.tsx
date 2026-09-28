import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXR } from '@react-three/xr'
import { Vector3, type Group } from 'three'
import { useBoardStore } from '../data/store'
import { useSettings } from '../data/settings'
import { usePlacements } from '../data/placements'
import { getSkin } from '../skins/registry'
import type { AnySkin } from '../skins/types'
import { BoardInteraction } from './BoardInteraction'
import { BoardEffects } from './fx'
import type { BoardLayout, DragGap, LayoutOptions } from './layout'
import { BoardRuntimeContext, createRuntime, type BoardRuntime } from './runtime'
import { canvasMeasure } from './text'
import { SKIN_SWITCH_MS, useView } from './viewStore'
import { registerPointerFocus } from '../voice/focus'

interface Props {
  size: [number, number]
  dark: boolean
  /** Board opacity (tracking loss). */
  opacity?: number
  /** Extra board-attached UI (menu button, handles) rendered in board space. */
  children?: (layout: BoardLayout) => ReactNode
  rootRef?: React.RefObject<Group | null>
}

const FAR_DISTANCE = 3

function useLayouts(skin: AnySkin | null, size: [number, number], dragGap: DragGap | undefined) {
  const doc = useBoardStore((s) => s.doc)
  const scroll = useView((s) => s.scroll)
  const fontsVersion = useView((s) => s.fontsVersion)
  const mirror = useSettings((s) => s.leftHanded)
  const highContrast = useSettings((s) => s.highContrast)
  const [w, h] = size
  return useMemo(() => {
    if (!skin) return null
    const options: LayoutOptions = { measure: canvasMeasure, scroll, mirror, highContrast }
    const view = skin.layout({ doc, size: [w, h], options: { ...options, drag: dragGap } })
    const base = dragGap ? skin.layout({ doc, size: [w, h], options: { ...options, drag: { cardId: dragGap.cardId } } }) : view
    return { view, base }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin, doc, w, h, scroll, mirror, highContrast, fontsVersion, dragGap?.cardId, dragGap?.columnId, dragGap?.index, dragGap?.height])
}

/**
 * Board content in board-local space (origin at the board center). Computes
 * layouts, renders the active skin (both skins while morphing), and wires up
 * interaction. The parent owns the transform (anchor, desk wall, …).
 */
export function BoardContent({ size, dark, opacity = 1, children, rootRef }: Props) {
  const runtime = useMemo(() => createRuntime(canvasMeasure), [])
  // Voice commands resolve "it" and the default column from what a pointer is over.
  useEffect(
    () =>
      registerPointerFocus(() => ({
        cardId: [...runtime.hoverCards.values()].at(-1) ?? null,
        columnId: [...runtime.hoverColumns.values()].at(-1)?.columnId ?? null,
      })),
    [runtime],
  )
  const localRoot = useRef<Group>(null)
  const skinId = useSettings((s) => s.skinId)
  const highContrast = useSettings((s) => s.highContrast)
  const skinSwitch = useView((s) => s.skinSwitch)
  const drag = useView((s) => s.drag)
  const skin = getSkin(skinId)
  const fromSkin = skinSwitch ? getSkin(skinSwitch.from) : null

  const dragGap: DragGap | undefined =
    drag.phase === 'dragOnBoard' || drag.phase === 'dragFree'
      ? {
          cardId: drag.source === 'pad' ? null : drag.cardId,
          columnId: drag.targetColumnId ?? undefined,
          index: drag.targetIndex ?? undefined,
          height: runtime.dragSize?.[1],
        }
      : undefined

  const { view, base } = useLayouts(skin, size, dragGap)!
  const fromLayouts = useLayouts(fromSkin && fromSkin.id !== skin.id ? fromSkin : null, size, dragGap)
  runtime.baseLayout = base
  runtime.size = size
  runtime.opacity = opacity

  // Skin switch: cross-fade surfaces over the morph, then drop the old skin.
  const [mix, setMix] = useState(1)
  useEffect(() => {
    if (!skinSwitch) {
      setMix(1)
      return
    }
    runtime.fx.sweep(runtime.size[0], runtime.size[1], '#f5a524')
    let raf = 0
    const tick = () => {
      const t = Math.min(1, (performance.now() - skinSwitch.start) / SKIN_SWITCH_MS)
      setMix(t)
      if (t < 1) raf = requestAnimationFrame(tick)
      else useView.getState().set({ skinSwitch: null })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [skinSwitch])

  // LOD by distance to the viewer + thumbstick scrolling of the hovered column.
  const session = useXR((s) => s.session)
  const inputs = useXR((s) => s.inputSourceStates)
  const tmp = useMemo(() => ({ board: new Vector3(), cam: new Vector3() }), [])
  const appear = useRef<{ group: Group | null; start: number }>({ group: null, start: -1 })
  useFrame((state, dt) => {
    const root = localRoot.current
    if (!root) return
    runtime.root = root
    // Entrance: the board settles in with a soft overshoot (skipped under reduced motion).
    const ap = appear.current
    if (ap.group && ap.start !== Infinity) {
      if (ap.start < 0) ap.start = performance.now()
      const t = Math.min(1, (performance.now() - ap.start) / 650)
      const reduced = useSettings.getState().reducedMotion
      const e = reduced || t >= 1 ? 1 : easeOutBack(t)
      ap.group.scale.setScalar(0.9 + 0.1 * e)
      ap.group.position.z = (1 - e) * 0.03
      if (t >= 1 || reduced) ap.start = Infinity
    }
    root.getWorldPosition(tmp.board)
    state.camera.getWorldPosition(tmp.cam)
    const far = tmp.board.distanceTo(tmp.cam) > FAR_DISTANCE * Math.max(0.5, view.k)
    if (far !== runtime.far) runtime.far = far

    // Each controller's thumbstick scrolls the column its own pointer is over.
    if (session && skin.overflow === 'scroll' && runtime.hoverColumns.size > 0) {
      for (const s of inputs) {
        if (s.type !== 'controller') continue
        const axes = s.inputSource.gamepad?.axes
        const y = axes ? axes[3] ?? 0 : 0
        if (Math.abs(y) <= 0.2) continue
        const colId = hoveredColumnOf(runtime.hoverColumns, s.inputSource)
        const col = colId ? view.columnById[colId] : undefined
        if (!colId || !col) continue
        const v = useView.getState()
        const next = Math.max(0, Math.min(col.maxScroll, (v.scroll[colId] ?? 0) + y * dt * 0.35 * view.k))
        if (next !== v.scroll[colId]) v.setScroll(colId, next)
      }
    }
  })

  const targetColumnId = drag.phase === 'dragOnBoard' ? drag.targetColumnId : null
  const overBin = drag.phase === 'dragOnBoard' && drag.overBin
  const padActive = drag.source === 'pad' && drag.phase !== 'idle'
  const Surface = skin.Surface
  const Cards = skin.Cards
  const FromSurface = fromSkin?.Surface
  const FromCards = fromSkin?.Cards
  const switching = !!skinSwitch && !!fromSkin && fromSkin.id !== skin.id && !!fromLayouts

  return (
    <BoardRuntimeContext.Provider value={runtime}>
      <group ref={(g) => void (appear.current.group = g)} name="board-appear">
        <group
          ref={(g) => {
            localRoot.current = g
            if (rootRef) rootRef.current = g
          }}
          name="board-content"
        >
          {switching && FromSurface && FromCards && (
            <group key={`from-${fromSkin!.id}`}>
              <FromSurface layout={fromLayouts!.view} dark={dark} highContrast={highContrast} opacity={opacity * (1 - mix)} targetColumnId={null} overBin={false} padActive={false} />
              <FromCards layout={fromLayouts!.view} dark={dark} highContrast={highContrast} role="from" />
            </group>
          )}
          <group key={`skin-${skin.id}`}>
            <Surface
              layout={view}
              dark={dark}
              highContrast={highContrast}
              opacity={opacity * (switching ? mix : 1)}
              targetColumnId={targetColumnId}
              overBin={overBin}
              padActive={padActive}
            />
            <Cards layout={view} dark={dark} highContrast={highContrast} role={switching ? 'to' : 'only'} />
          </group>
          <BoardInteraction layout={view} skin={skin} />
          <BoardEffects />
          {children?.(view)}
        </group>
      </group>
    </BoardRuntimeContext.Provider>
  )
}

function hoveredColumnOf(hover: BoardRuntime['hoverColumns'], source: XRInputSource): string | null {
  for (const h of hover.values()) if (h.source === source) return h.columnId
  return null
}

function easeOutBack(t: number) {
  const c = 1.4
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

/** Switch skins with the morph animation (PLAN §7.5). */
export function switchSkin(to: string) {
  const settings = useSettings.getState()
  const from = settings.skinId
  if (from === to) return
  const reduced = settings.reducedMotion
  useView.getState().set({ skinSwitch: reduced ? null : { from, to, start: performance.now() } })
  settings.set({ skinId: to })
  // The skin is remembered per placement: a whiteboard on the wall, Projects on the desk (PLAN §7.5).
  if (useView.getState().mode === 'xr') usePlacements.getState().updatePlacement({ skinId: to })
}
