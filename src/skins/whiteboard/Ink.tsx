import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
} from 'three'
import type { ChipBatch } from '../../render/chips'
import { buildStrokeGeometry, type Stroke } from '../../render/strokes'
import { useBoardRuntime } from '../../board/runtime'
import { useView } from '../../board/viewStore'
import { useBoardStore } from '../../data/store'
import type { InkStroke } from '../../data/model'
import type { BoardLayout } from '../../board/layout'
import { MARKER_LENGTH, placeModel, type ToolModels } from './toolModels'
import { trayGeometry, type WhiteboardContent } from './layout'

/** A dry-erase marker lying in the tray: white barrel with a colored cap. */
export function pushMarker(b: ChipBatch, x: number, y: number, z: number, w: number, h: number, color: string, alpha: number) {
  b.push({ x, y, z, w, h, r: h / 2, d: h, color: '#f2f2f0', alpha })
  b.push({ x: x + w * 0.385, y, z: z + 0.0005, w: w * 0.27, h: h * 1.08, r: h / 2, d: h * 1.08, color, alpha })
}

/** The eraser: a dark handle on a felt pad. */
export function pushEraser(b: ChipBatch, x: number, y: number, z: number, w: number, h: number, d: number, alpha: number) {
  b.push({ x, y, z, w, h, r: h * 0.15, d, color: '#2d3748', alpha })
  b.push({ x, y: y - h * 0.385, z, w, h: h * 0.23, r: h * 0.08, d: d * 1.02, color: '#e7e2d6', alpha })
}

function toStrokes(list: readonly InkStroke[], W: number, H: number): Stroke[] {
  return list.map((s) => toStroke(s.points, s.color, s.width, W, H))
}

function toStroke(points: readonly number[], color: string, width: number, W: number, H: number): Stroke {
  const pts: Array<[number, number]> = []
  for (let i = 0; i + 1 < points.length; i += 2) pts.push([points[i] * W - W / 2, H / 2 - points[i + 1] * H])
  return { points: pts, width: width * W, color }
}

/**
 * Marker ink on the whiteboard surface: saved strokes plus the one being drawn,
 * merged into a single ribbon mesh (one draw call). It sits on the melamine,
 * under the sticky notes, like real ink would.
 */
export function InkLayer({ size, opacity }: { size: [number, number]; k: number; opacity: number }) {
  const runtime = useBoardRuntime()
  const ink = useBoardStore((s) => s.doc.board.ink)
  const mesh = useMemo(() => {
    const m = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, depthWrite: false }))
    m.raycast = () => {}
    m.renderOrder = 1
    m.name = 'marker-ink'
    return m
  }, [])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicMaterial).dispose()
    },
    [mesh],
  )
  const built = useRef<{ ink: unknown; version: number; w: number; h: number }>({ ink: null, version: -1, w: 0, h: 0 })
  useFrame(() => {
    const st = runtime.ink
    const [W, H] = size
    const b = built.current
    ;(mesh.material as MeshBasicMaterial).opacity = opacity
    // Rebuild only when the saved ink, the stroke in progress or the board size changed.
    if (b.ink === ink && b.version === st.version && b.w === W && b.h === H) return
    b.ink = ink
    b.version = st.version
    b.w = W
    b.h = H
    const strokes = toStrokes(st.erasing ?? ink ?? [], W, H)
    if (st.draft && st.draft.points.length >= 2) {
      const pts = st.draft.points.length === 2 ? [...st.draft.points, st.draft.points[0] + st.draft.width * 0.3, st.draft.points[1]] : st.draft.points
      strokes.push(toStroke(pts, st.draft.color, st.draft.width, W, H))
    }
    mesh.geometry.dispose()
    // Over the sticky notes too: drawing across a note writes on it, as on a real board.
    mesh.geometry = buildStrokeGeometry(strokes, INK_Z)
  })
  return <primitive object={mesh} />
}

const Y = new Vector3(0, 1, 0)
/** Just above a resting note's paper and text; a picked-up note lifts well clear of it. */
const INK_Z = 0.0026

type MarkerId = keyof ToolModels['markers']
const isMarkerId = (id: string): id is MarkerId => id === 'black' || id === 'blue' || id === 'red'

/** The real markers and eraser lying in the tray (whichever is in hand is missing from its slot). */
export function TrayTools({ layout, models, opacity }: { layout: BoardLayout<WhiteboardContent>; models: ToolModels; opacity: number }) {
  const toolId = useView((s) => s.tool?.id ?? null)
  const meshes = useMemo(
    () => ({
      black: placeModel(models.markers.black, 'tray-marker-black'),
      blue: placeModel(models.markers.blue, 'tray-marker-blue'),
      red: placeModel(models.markers.red, 'tray-marker-red'),
      eraser: placeModel(models.eraser, 'tray-eraser'),
    }),
    [models],
  )
  const { size, k } = layout
  const g = trayGeometry(size, k)
  const ids = (layout.tray ?? []).map((t) => t.id)
  g.markers.forEach((m, i) => {
    const id = ids[i]
    if (!id || !isMarkerId(id)) return
    const mesh = meshes[id]
    mesh.visible = toolId !== id
    // Lying along the tray, nib to the left: the model's tip is its origin and its barrel runs up +Y.
    mesh.rotation.set(0, 0, -Math.PI / 2)
    mesh.scale.setScalar(k)
    mesh.position.set(m.x - (MARKER_LENGTH * k) / 2, m.y, m.z)
  })
  // Pad down on the tray, long side along it.
  meshes.eraser.visible = toolId !== 'eraser'
  meshes.eraser.rotation.set(-Math.PI / 2, 0, 0)
  meshes.eraser.scale.setScalar(k)
  meshes.eraser.position.set(g.eraser.x, g.trayTop, g.eraser.z)
  // Fade with the board (tracking loss, skin switch). Alpha-tested felt fuzz keeps its own mode.
  for (const o of Object.values(meshes))
    o.traverse((c) => {
      if (!(c instanceof Mesh)) return
      const mat = c.material as Material & { alphaTest?: number }
      if (mat.alphaTest) return
      mat.transparent = opacity < 0.999
      mat.opacity = opacity
    })
  return (
    <group>
      {Object.values(meshes).map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </group>
  )
}

/**
 * The marker or eraser in hand. The marker's nib follows the pointer,
 * leaning like a held pen; the eraser keeps its felt pad flat to the board
 * (it never rolls or tilts), hovering just off the surface and pressed onto it
 * while you rub.
 */
export function HeldTool({ size, k, models }: { size: [number, number]; k: number; models: ToolModels | null }) {
  const runtime = useBoardRuntime()
  const tool = useView((s) => s.tool)
  const fallback = useMemo(() => {
    const body = new MeshStandardMaterial({ color: '#f2f2f0', roughness: 0.45 })
    const accent = new MeshStandardMaterial({ color: '#23262b', roughness: 0.5 })
    const marker = new Group()
    const r = 0.0103
    const tipLen = 0.012
    const barrel = MARKER_LENGTH - tipLen
    const tip = new Mesh(new ConeGeometry(r * 0.35, tipLen, 16), accent)
    tip.rotation.x = Math.PI
    tip.position.y = tipLen / 2
    const barrelMesh = new Mesh(new CylinderGeometry(r, r, barrel, 24), body)
    barrelMesh.position.y = tipLen + barrel / 2
    const cap = new Mesh(new CylinderGeometry(r * 1.06, r * 1.06, 0.03, 24), accent)
    cap.position.y = tipLen + barrel - 0.015
    marker.add(tip, barrelMesh, cap)
    const eraser = new Group()
    const handle = new Mesh(new BoxGeometry(0.13, 0.05, 0.03), new MeshStandardMaterial({ color: '#2d3748', roughness: 0.6 }))
    handle.position.z = 0.011 + 0.015
    const pad = new Mesh(new BoxGeometry(0.124, 0.046, 0.011), new MeshStandardMaterial({ color: '#e7e2d6', roughness: 0.95 }))
    pad.position.z = 0.0055
    eraser.add(handle, pad)
    return { marker, eraser, accent }
  }, [])
  const parts = useMemo(() => {
    const root = new Group()
    root.name = 'held-tool'
    const marker = new Group()
    const eraser = new Group()
    const real = models
      ? {
          black: placeModel(models.markers.black, 'held-marker-black'),
          blue: placeModel(models.markers.blue, 'held-marker-blue'),
          red: placeModel(models.markers.red, 'held-marker-red'),
          eraser: placeModel(models.eraser, 'held-eraser'),
        }
      : null
    if (real) {
      marker.add(real.black, real.blue, real.red)
      eraser.add(real.eraser)
    } else {
      marker.add(fallback.marker)
      eraser.add(fallback.eraser)
    }
    root.add(marker, eraser)
    root.traverse((o) => {
      o.raycast = () => {}
    })
    return { root, marker, eraser, real }
  }, [models, fallback])
  useEffect(
    () => () => {
      for (const g of [fallback.marker, fallback.eraser])
        g.traverse((o) => {
          if (o instanceof Mesh) {
            o.geometry.dispose()
            ;(o.material as Material).dispose()
          }
        })
    },
    [fallback],
  )
  useEffect(() => {
    if (tool?.kind !== 'marker') return
    fallback.accent.color.set(tool.color)
    if (parts.real) for (const id of ['black', 'blue', 'red'] as const) parts.real[id].visible = tool.id === id
  }, [tool, parts, fallback])

  const tmp = useMemo(() => ({ q: new Quaternion(), dir: new Vector3(0.55, 0.42, 0.72).normalize() }), [])
  useFrame(() => {
    const c = runtime.ink.cursor
    const { root, marker, eraser } = parts
    root.visible = !!tool && c.visible
    if (!root.visible) return
    const [W, H] = size
    root.scale.setScalar(k)
    marker.visible = tool!.kind === 'marker'
    eraser.visible = tool!.kind === 'eraser'
    if (marker.visible) {
      // Held like a pen: the barrel leans up and to the right, toward you; the nib touches down to draw.
      root.position.set(c.u - W / 2, H / 2 - c.v, c.down ? 0.0008 : 0.008 * k)
      tmp.q.setFromUnitVectors(Y, tmp.dir)
      marker.quaternion.copy(tmp.q)
    } else {
      // Pad flat to the board and square to it, always: no roll, no tilt, no spin.
      root.position.set(c.u - W / 2, H / 2 - c.v, c.down ? 0.0004 : 0.006 * k)
      eraser.quaternion.identity()
    }
  })
  return <primitive object={parts.root} />
}
