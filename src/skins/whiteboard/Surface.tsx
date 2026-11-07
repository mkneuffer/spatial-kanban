import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, MeshBasicMaterial, Mesh, BufferGeometry } from 'three'
import type { SurfaceProps } from '../types'
import { ChipBatch, createChipMaterial } from '../../render/chips'
import { PaperBatch, createPaperMaterial } from '../../render/paper'
import { TextBatch, placeText } from '../../render/textBatch'
import { buildStrokeGeometry, wobblyCircle, wobblyLine, wobblyRect, type Stroke } from '../../render/strokes'
import { FONTS } from '../../render/fonts'
import { toLocal, type Rect } from '../../board/space'
import { useBoardStore } from '../../data/store'
import { usePlacements } from '../../data/placements'
import { markerInk, STICKY_COLORS, whiteboardPalette } from './palette'
import { trayGeometry, whiteboardMetrics, type WhiteboardContent } from './layout'
import { useView } from '../../board/viewStore'
import { InkLayer, HeldTool, TrayTools, pushEraser, pushMarker } from './Ink'
import { useToolModels } from './toolModels'

/**
 * Glossy melamine whiteboard with a thin aluminum frame, a marker tray on the
 * bottom edge, marker-font headings and wobbly hand-drawn separators (PLAN §7.3).
 */
export function WhiteboardSurface({ layout, highContrast, opacity, targetColumnId, overBin, padActive }: SurfaceProps<WhiteboardContent>) {
  const palette = useMemo(() => whiteboardPalette(highContrast), [highContrast])
  const title = useBoardStore((s) => s.doc.board.title)
  const freeCards = usePlacements((s) => s.freeCards)
  const toolId = useView((s) => s.tool?.id ?? null)
  const models = useToolModels()
  // The tray belongs to this skin: switching skins puts the marker back.
  useEffect(() => () => useView.getState().set({ tool: null }), [])
  const res = useMemo(() => {
    const strokeMat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true })
    const strokes = new Mesh(new BufferGeometry(), strokeMat)
    strokes.raycast = () => {}
    strokes.renderOrder = -1
    const r = {
      board: new ChipBatch(createChipMaterial({ clearcoat: 1, roughness: 0.3 }), 4, true, 'melamine'),
      metal: new ChipBatch(createChipMaterial({ roughness: 0.32, metalness: 0.85 }), 32, true, 'frame'),
      plastic: new ChipBatch(createChipMaterial({ roughness: 0.5 }), 32, true, 'tray'),
      marks: new ChipBatch(createChipMaterial({ lit: false, transparent: true }), 32, false, 'highlights'),
      pad: new PaperBatch(createPaperMaterial(), 4),
      text: new TextBatch('whiteboard-text'),
      strokes,
      strokeMat,
    }
    r.board.renderOrder = -3
    r.marks.renderOrder = -2
    return r
  }, [])
  useEffect(
    () => () => {
      res.board.dispose()
      res.metal.dispose()
      res.plastic.dispose()
      res.marks.dispose()
      res.pad.dispose()
      res.text.dispose()
      res.strokes.geometry.dispose()
    },
    [res],
  )

  const { size, k } = layout
  const M = whiteboardMetrics(k)
  const at = (r: Rect) => {
    const [x, y] = toLocal(r.x + r.w / 2, r.y + r.h / 2, size)
    return { x, y, w: r.w, h: r.h }
  }

  useLayoutEffect(() => {
    const [W, H] = size
    const d = 0.016 * k
    const fw = 0.02 * k // frame width
    const fd = 0.03 * k
    const op = opacity
    // Solid parts only blend while faded (tracking loss / skin switch).
    for (const b of [res.board, res.metal, res.plastic]) (b.mesh.material as { transparent: boolean }).transparent = op < 0.999
    res.board.begin()
    res.board.push({ x: 0, y: 0, z: -d / 2, w: W, h: H, r: 0.004 * k, d, color: palette.board, alpha: op })
    res.board.end()

    res.metal.begin()
    res.metal.push({ x: 0, y: H / 2 + fw / 2, z: -d + fd / 2, w: W + 2 * fw, h: fw, r: 0.004 * k, d: fd, color: palette.frame, alpha: op })
    res.metal.push({ x: 0, y: -H / 2 - fw / 2, z: -d + fd / 2, w: W + 2 * fw, h: fw, r: 0.004 * k, d: fd, color: palette.frame, alpha: op })
    res.metal.push({ x: -W / 2 - fw / 2, y: 0, z: -d + fd / 2, w: fw, h: H, r: 0.004 * k, d: fd, color: palette.frame, alpha: op })
    res.metal.push({ x: W / 2 + fw / 2, y: 0, z: -d + fd / 2, w: fw, h: H, r: 0.004 * k, d: fd, color: palette.frame, alpha: op })
    res.metal.end()

    res.plastic.begin()
    // Corner caps.
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      res.plastic.push({ x: sx * (W / 2 + fw / 2), y: sy * (H / 2 + fw / 2), z: -d + fd / 2 + 0.001, w: fw * 1.5, h: fw * 1.5, r: fw * 0.5, d: fd * 1.08, color: palette.corner, alpha: op })
    }
    // Marker tray along the bottom edge, with three markers and an eraser (whichever is in hand is missing).
    const g = trayGeometry(size, k)
    const { trayW, trayH, trayD, trayY } = g
    res.plastic.push({ x: 0, y: trayY, z: trayD / 2 - d, w: trayW, h: trayH, r: 0.003 * k, d: trayD, color: palette.frame, alpha: op })
    res.plastic.push({ x: 0, y: trayY + trayH * 0.9, z: trayD - d - 0.002 * k, w: trayW, h: trayH * 0.9, r: 0.002 * k, d: 0.004 * k, color: palette.frameDark, alpha: op })
    // Simple stand-ins until the real marker and eraser models have loaded (<TrayTools> draws those).
    const tray = layout.tray ?? []
    if (!models) {
      g.markers.forEach((m, i) => {
        const item = tray[i]
        if (!item || item.id === toolId) return
        pushMarker(res.plastic, m.x, m.y, m.z, m.w, m.h, item.color, op)
      })
      if (toolId !== 'eraser') pushEraser(res.plastic, g.eraser.x, g.eraser.y, g.eraser.z, g.eraser.w, g.eraser.h, g.eraser.d, op)
    }
    res.plastic.end()

    // Ink: headings, separators, bin box, WIP circles.
    const strokes: Stroke[] = []
    const t = res.text
    t.mark()
    const z = 0.0008
    const ink = palette.ink
    const lw = 0.0028 * k
    const tr = at(layout.title)
    t.set('title', { text: title, font: FONTS.marker, fontSize: M.boardTitleSize, color: ink })
    placeText(t.get('title')!, tr.x - tr.w / 2 + 0.006 * k, tr.y + 0.004 * k, z, -0.006, 1, 1, op)

    layout.columns.forEach((col, i) => {
      const h = at(col.header)
      const color = markerInk(col.color)
      t.set(`h:${col.id}`, { text: col.title, font: FONTS.marker, fontSize: M.headerSize, color, anchorX: 'center' })
      placeText(t.get(`h:${col.id}`)!, h.x, h.y + 0.004 * k, z, ((i % 3) - 1) * 0.012, 1, 1, op)
      const count = col.wipLimit !== undefined ? `${col.count}/${col.wipLimit}` : `${col.count}`
      const warn = col.overLimit || (targetColumnId === col.id && col.atLimit)
      t.set(`c:${col.id}`, { text: count, font: FONTS.caveat700, fontSize: M.headerSize * 0.72, color: warn ? palette.red : palette.inkMuted, anchorX: 'right' })
      const cx = h.x + h.w / 2 - 0.01 * k
      placeText(t.get(`c:${col.id}`)!, cx, h.y - h.h * 0.28, z, 0, 1, 1, op)
      if (warn) strokes.push({ points: wobblyCircle(cx - 0.018 * k, h.y - h.h * 0.28, 0.016 * k, col.id, 0.0012 * k), width: lw * 0.7, color: palette.red })
      // Underline the heading.
      strokes.push({
        points: wobblyLine([h.x - h.w * 0.36, h.y - h.h * 0.46], [h.x + h.w * 0.3, h.y - h.h * 0.44], col.id + 'u', 0.0015 * k),
        width: lw * 0.8,
        color,
      })
      // Vertical separator after every column but the last.
      if (i < layout.columns.length - 1) {
        const next = layout.columns[i + 1]
        const u = (col.rect.x + col.rect.w + next.rect.x) / 2
        const [x0, y0] = toLocal(u, col.rect.y + 0.005 * k, size)
        const [, y1] = toLocal(u, col.rect.y + col.rect.h, size)
        strokes.push({ points: wobblyLine([x0, y0], [x0 + 0.002 * k, y1], col.id + 's', 0.004 * k, 26), width: lw, color: ink })
      }
    })

    const bin = at(layout.bin)
    for (const pts of wobblyRect(bin.x, bin.y, bin.w * 0.92, bin.h * 0.8, 'bin', 0.0015 * k)) {
      strokes.push({ points: pts, width: lw * 0.9, color: overBin ? palette.red : palette.inkMuted })
    }
    t.set('bin', { text: overBin ? 'let go to archive' : 'done bin', font: FONTS.caveat700, fontSize: M.headerSize * 0.75, color: overBin ? palette.red : palette.inkMuted, anchorX: 'center' })
    placeText(t.get('bin')!, bin.x, bin.y, z, 0.02, 1, 1, op)

    const pad = at(layout.pad)
    t.set('pad', { text: padActive ? 'drop it in a column' : 'grab a new note', font: FONTS.caveat700, fontSize: M.headerSize * 0.72, color: palette.blue, anchorX: 'right' })
    placeText(t.get('pad')!, pad.x + pad.w / 2 - pad.h * 1.1, pad.y, z, -0.02, 1, 1, op)

    for (const id in freeCards) {
      const slot = layout.cards[id]
      if (!slot) continue
      const s = at(slot.rect)
      for (const pts of wobblyRect(s.x, s.y, s.w * 0.94, s.h * 0.94, id, 0.001 * k)) strokes.push({ points: pts, width: lw * 0.5, color: '#9aa0a6' })
    }

    t.sweep()
    res.strokes.geometry.dispose()
    res.strokes.geometry = buildStrokeGeometry(strokes, z)
    res.strokeMat.opacity = op

    // Blank note pad (a small stack of real paper).
    res.pad.begin()
    const ps = Math.min(pad.h * 1.05, M.maxNote * 0.7)
    for (let i = 0; i < 3; i++) {
      res.pad.push({
        x: pad.x + pad.w / 2 - ps / 2 - 0.004 * k + i * 0.0015 * k,
        y: pad.y + i * 0.0012 * k,
        z: 0.0012 + i * 0.0006,
        w: ps,
        h: ps,
        rot: (i - 1) * 0.04,
        scale: 1,
        sx: 1,
        curl: i === 2 && padActive ? 0.5 : 0,
        color: STICKY_COLORS.canary,
      })
    }
    res.pad.end()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, palette, opacity, targetColumnId, overBin, padActive, title, freeCards, toolId, models])

  // Per frame: highlighter over the target column and the drop placeholder.
  useFrame(() => {
    res.marks.begin()
    if (targetColumnId) {
      const col = layout.columnById[targetColumnId]
      if (col) {
        const c = at(col.rect)
        res.marks.push({ x: c.x, y: c.y, z: 0.0004, w: c.w, h: c.h, r: 0.006 * k, color: col.atLimit ? '#f59e0b' : palette.highlight, alpha: 0.09 * opacity })
      }
    }
    const ph = layout.placeholder
    if (ph) {
      const p = at(ph)
      res.marks.push({ x: p.x, y: p.y, z: 0.0006, w: p.w, h: p.h, r: 0.002 * k, color: '#6b7280', alpha: 0.16 * opacity })
    }
    res.marks.end()
  })

  return (
    <group>
      <primitive object={res.board.root} />
      <primitive object={res.metal.root} />
      <primitive object={res.plastic.root} />
      <primitive object={res.marks.root} />
      <primitive object={res.strokes} />
      <primitive object={res.pad.root} />
      <primitive object={res.text.root} />
      <InkLayer size={size} k={k} opacity={opacity} />
      {models && <TrayTools layout={layout} models={models} opacity={opacity} />}
      <HeldTool size={size} k={k} models={models} />
    </group>
  )
}
