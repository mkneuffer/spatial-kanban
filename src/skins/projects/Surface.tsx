import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import type { SurfaceProps } from '../types'
import { ChipBatch, createChipMaterial } from '../../render/chips'
import { TextBatch, placeText } from '../../render/textBatch'
import { FONTS } from '../../render/fonts'
import { toLocal, type Rect } from '../../board/space'
import { useBoardStore } from '../../data/store'
import { usePlacements } from '../../data/placements'
import { useView } from '../../board/viewStore'
import { projectsPalette } from './palette'
import { projectsMetrics, type ProjectsContent } from './layout'

/**
 * Projects board surface: frosted panel, column lanes with status dot, name and
 * count / WIP limit, the new-card pad and archive tray (PLAN §7.2).
 */
export function ProjectsSurface({ layout, dark, highContrast, opacity, targetColumnId, overBin, padActive }: SurfaceProps<ProjectsContent>) {
  const palette = useMemo(() => projectsPalette(dark, highContrast), [dark, highContrast])
  const title = useBoardStore((s) => s.doc.board.title)
  const freeCards = usePlacements((s) => s.freeCards)
  const res = useMemo(
    () => ({
      panel: new ChipBatch(createChipMaterial({ transparent: true, roughness: 0.85, envMapIntensity: 0.3 }), 4, true, 'board-panel'),
      lanes: new ChipBatch(createChipMaterial({ lit: false, transparent: true }), 64, false, 'lanes'),
      dynamic: new ChipBatch(createChipMaterial({ lit: false, transparent: true }), 64, false, 'surface-dynamic'),
      text: new TextBatch('surface-text'),
    }),
    [],
  )
  useMemo(() => {
    // Transparent layers draw back to front in this order.
    res.panel.renderOrder = -3
    res.lanes.renderOrder = -2
    res.dynamic.renderOrder = -1
  }, [res])
  useEffect(
    () => () => {
      res.panel.dispose()
      res.lanes.dispose()
      res.dynamic.dispose()
      res.text.dispose()
    },
    [res],
  )

  const { size, k } = layout
  const M = projectsMetrics(k)
  const at = (r: Rect) => {
    const [x, y] = toLocal(r.x + r.w / 2, r.y + r.h / 2, size)
    return { x, y, w: r.w, h: r.h }
  }

  // Static geometry & text: rebuilt when layout or theme changes.
  useLayoutEffect(() => {
    const [W, H] = size
    const d = 0.012 * k
    res.panel.begin()
    res.panel.push({ x: 0, y: 0, z: -d / 2, w: W, h: H, r: 0.022 * k, d, color: palette.board, alpha: palette.boardAlpha * opacity })
    res.panel.end()

    res.lanes.begin()
    const t = res.text
    t.mark()
    const z = 0.0006
    const titleR = at(layout.title)
    t.set('title', { text: title, font: FONTS.inter600, fontSize: M.boardTitleSize, color: palette.text })
    placeText(t.get('title')!, titleR.x - titleR.w / 2 + 0.004 * k, titleR.y, z, 0, 1, 1, opacity)

    for (const col of layout.columns) {
      const c = at(col.rect)
      const hl = targetColumnId === col.id
      const edge = hl ? (col.atLimit ? palette.warn : palette.accent) : palette.laneBorder
      const bw = (hl ? 0.0022 : 0.0009) * Math.max(0.6, k)
      res.lanes.push({ x: c.x, y: c.y, z: z - 0.0002, w: c.w + 2 * bw, h: c.h + 2 * bw, r: 0.012 * k + bw, color: edge, alpha: opacity })
      res.lanes.push({ x: c.x, y: c.y, z, w: c.w, h: c.h, r: 0.012 * k, color: palette.lane, alpha: opacity })
      // Header: status dot, name, count / WIP.
      const h = at(col.header)
      const dotD = M.headerSize * 0.62
      const left = h.x - h.w / 2 + 0.012 * k
      res.lanes.push({ x: left + dotD / 2, y: h.y, z: z + 0.0002, w: dotD, h: dotD, r: dotD, color: col.color, alpha: opacity })
      t.set(`h:${col.id}`, { text: col.title, font: FONTS.inter600, fontSize: M.headerSize, color: palette.text })
      placeText(t.get(`h:${col.id}`)!, left + dotD + 0.008 * k, h.y, z + 0.0003, 0, 1, 1, opacity)
      const count = col.wipLimit !== undefined ? `${col.count} / ${col.wipLimit}` : `${col.count}`
      const warn = col.overLimit || (hl && col.atLimit)
      t.set(`c:${col.id}`, { text: count, font: FONTS.inter500, fontSize: M.headerSize * 0.78, color: warn ? palette.warn : palette.muted, anchorX: 'right' })
      placeText(t.get(`c:${col.id}`)!, h.x + h.w / 2 - 0.012 * k, h.y, z + 0.0003, 0, 1, 1, opacity)
      if (warn) {
        // WIP limit reached: amber underline under the header (the drop still goes through).
        res.lanes.push({ x: h.x, y: h.y - h.h / 2 + 0.002 * k, z: z + 0.0002, w: h.w - 0.02 * k, h: 0.002 * k, r: 0.001 * k, color: palette.warn, alpha: opacity })
      }
    }

    // Pad: a stack of blank cards with "+ New card".
    const pad = at(layout.pad)
    for (let i = 2; i >= 0; i--) {
      res.lanes.push({
        x: pad.x + i * 0.003 * k, y: pad.y - i * 0.003 * k, z: z + 0.0002 * (3 - i),
        w: pad.w - 0.01 * k, h: pad.h - 0.012 * k, r: 0.008 * k,
        color: i === 0 ? (padActive ? palette.accent : palette.card) : palette.pad, alpha: opacity,
      })
    }
    t.set('pad', { text: '+  New card', font: FONTS.inter600, fontSize: M.headerSize * 0.9, color: padActive ? '#ffffff' : palette.text, anchorX: 'center' })
    placeText(t.get('pad')!, pad.x, pad.y, z + 0.001, 0, 1, 1, opacity)

    // Archive tray.
    const bin = at(layout.bin)
    res.lanes.push({ x: bin.x, y: bin.y, z, w: bin.w, h: bin.h - 0.01 * k, r: 0.008 * k, color: overBin ? palette.danger : palette.lane, alpha: opacity })
    t.set('bin', { text: overBin ? 'Release to archive' : 'Archive', font: FONTS.inter500, fontSize: M.headerSize * 0.82, color: overBin ? '#ffffff' : palette.muted, anchorX: 'center' })
    placeText(t.get('bin')!, bin.x, bin.y, z + 0.0005, 0, 1, 1, opacity)

    // Parked cards leave a dashed-looking ghost in their slot.
    for (const id in freeCards) {
      const slot = layout.cards[id]
      if (!slot || slot.hidden) continue
      const s = at(slot.rect)
      res.lanes.push({ x: s.x, y: s.y, z: z + 0.0002, w: s.w, h: s.h, r: M.radius, color: palette.laneBorder, alpha: 0.55 * opacity })
      res.lanes.push({ x: s.x, y: s.y, z: z + 0.0003, w: s.w - 0.003 * k, h: s.h - 0.003 * k, r: M.radius, color: palette.lane, alpha: opacity })
      t.set(`park:${id}`, { text: 'Parked in room', font: FONTS.inter500, fontSize: M.refSize, color: palette.muted, anchorX: 'center' })
      placeText(t.get(`park:${id}`)!, s.x, s.y, z + 0.0005, 0, 1, 1, opacity)
    }

    res.lanes.end()
    t.sweep()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, palette, opacity, targetColumnId, overBin, padActive, title, freeCards])

  // Per-frame: drop placeholder and scrollbars.
  useFrame(() => {
    const { scroll } = useView.getState()
    res.dynamic.begin()
    const ph = layout.placeholder
    if (ph) {
      const p = at(ph)
      res.dynamic.push({ x: p.x, y: p.y, z: 0.0012, w: p.w, h: p.h, r: M.radius, color: palette.accent, alpha: 0.18 * opacity })
    }
    for (const col of layout.columns) {
      if (col.maxScroll <= 0) continue
      const b = at(col.body)
      const frac = col.body.h / col.contentHeight
      const barH = Math.max(0.02 * k, b.h * frac)
      const pos = (scroll[col.id] ?? 0) / col.maxScroll
      const y = b.y + b.h / 2 - barH / 2 - pos * (b.h - barH)
      res.dynamic.push({ x: b.x + b.w / 2 - 0.004 * k, y, z: 0.0012, w: 0.0035 * k, h: barH, r: 0.002 * k, color: palette.muted, alpha: 0.6 * opacity })
    }
    res.dynamic.end()
  })

  return (
    <group>
      <primitive object={res.panel.root} />
      <primitive object={res.lanes.root} />
      <primitive object={res.dynamic.root} />
      <primitive object={res.text.root} />
    </group>
  )
}
