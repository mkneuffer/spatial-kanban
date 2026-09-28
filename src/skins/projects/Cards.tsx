import { useEffect, useMemo } from 'react'
import { Color } from 'three'
import type { CardsProps } from '../types'
import { cardPoint, useCardFrames, type CardDrawer } from '../../board/cardFrames'
import type { CardSlot } from '../../board/layout'
import { useBoardRuntime } from '../../board/runtime'
import { NEW_CARD_ID } from '../../board/drag'
import { ChipBatch, createChipMaterial } from '../../render/chips'
import { ShadowBatch, createShadowMaterial } from '../../render/shadows'
import { TextBatch, placeText } from '../../render/textBatch'
import { FONTS } from '../../render/fonts'
import { useBoardStore } from '../../data/store'
import { projectsPalette, pillBg, pillText } from './palette'
import { projectsCardContent, projectsMetrics, type ProjectsContent } from './layout'
import { projectsMotion } from './motion'

const CARD_Z = 0.0016

export function ProjectsCards({ layout, dark, highContrast, role }: CardsProps<ProjectsContent>) {
  const runtime = useBoardRuntime()
  const palette = useMemo(() => projectsPalette(dark, highContrast), [dark, highContrast])
  const res = useMemo(
    () => ({
      bodies: new ChipBatch(createChipMaterial({ roughness: 0.9, envMapIntensity: 0.25 }), 256, true, 'card-bodies'),
      flat: new ChipBatch(createChipMaterial({ lit: false }), 512, false, 'card-decor'),
      shadows: new ShadowBatch(createShadowMaterial(), 256),
      text: new TextBatch('card-text'),
    }),
    [],
  )
  useEffect(
    () => () => {
      res.bodies.dispose()
      res.flat.dispose()
      res.shadows.dispose()
      res.text.dispose()
    },
    [res],
  )

  const colors = useMemo(
    () => ({
      card: new Color(palette.card),
      border: new Color(palette.cardBorder),
      accent: new Color(palette.accent),
    }),
    [palette],
  )

  const M = projectsMetrics(layout.k)
  const depth = 0.0022 * Math.max(0.6, layout.k)
  const border = 0.0012 * Math.max(0.6, layout.k)

  const drawer: CardDrawer<ProjectsContent> = {
    content(list) {
      const t = res.text
      t.mark()
      for (const { id, slot } of list) {
        const c = slot.content
        if (c.ref) t.set(`${id}:ref`, { text: c.ref, font: FONTS.inter500, fontSize: c.refSize, color: palette.muted })
        t.set(`${id}:title`, {
          text: c.lines.join('\n') || ' ',
          font: FONTS.inter500,
          fontSize: c.titleSize,
          color: id === NEW_CARD_ID ? palette.muted : palette.text,
          anchorY: 'top',
          lineHeight: c.lineH / c.titleSize,
        })
        for (const p of c.pills) t.set(`${id}:pill:${p.id}`, { text: p.text, font: FONTS.inter500, fontSize: p.textSize, color: pillText(p.color, dark), anchorX: 'center' })
        for (const av of c.avatars) t.set(`${id}:av:${av.id}`, { text: av.initials, font: FONTS.inter600, fontSize: av.d * 0.42, color: palette.avatarText, anchorX: 'center' })
        if (c.due) t.set(`${id}:due`, { text: c.due.text, font: FONTS.inter400, fontSize: c.due.size, color: c.due.overdue ? palette.danger : palette.muted })
      }
      t.sweep()
    },
    begin() {
      res.bodies.begin()
      res.flat.begin()
      res.shadows.begin()
    },
    card(f) {
      const { a, slot, id } = f
      const c = slot.content
      const far = runtime.far
      const zc = a.z + CARD_Z + depth / 2
      const zf = a.z + CARD_Z + depth + 0.0003
      const clip = { clipMin: f.clipMin, clipMax: f.clipMax }
      const op = runtime.opacity

      res.shadows.push({
        x: a.x,
        y: a.y - 0.002 - f.lift * 0.006,
        z: 0.0009,
        w: a.w * f.sx,
        h: a.h,
        r: M.radius,
        blur: 0.004 + f.lift * 0.014,
        // Contact shadow fades out as the card leaves the surface (torn off / parked).
        alpha: (0.35 + f.lift * 0.45) * palette.shadow * op * (f.clipped ? 0 : 1) * Math.max(0, 1 - a.z / 0.12),
        rot: a.rot,
        scale: a.scale,
      })
      const hl = f.selected || f.hovered || f.kind === 'drag' || f.kind === 'new'
      res.bodies.push({
        x: a.x, y: a.y, z: zc - 0.0003, w: a.w + 2 * border, h: a.h + 2 * border, r: M.radius + border, d: depth,
        rot: a.rot, sx: f.sx, scale: a.scale, color: hl ? colors.accent : colors.border, ...clip, alpha: op,
      })
      res.bodies.push({ x: a.x, y: a.y, z: zc, w: a.w, h: a.h, r: M.radius, d: depth, rot: a.rot, sx: f.sx, scale: a.scale, color: colors.card, ...clip, alpha: op })

      const place = (key: string, cx: number, cy: number, visible = true) => {
        const m = res.text.get(key)
        if (!m) return
        const [x, y] = cardPoint(f, cx, cy)
        placeText(m, x, y, zf, a.rot, a.scale, f.sx, visible ? op : 0)
        m.clipRect = f.clipped ? [-10, (f.clipMin - y) / a.scale, 10, (f.clipMax - y) / a.scale] : null
      }

      // Issue icon: ring in the column color.
      if (!far && c.ref) {
        const col = layout.columnById[slot.columnId]?.color ?? palette.muted
        const [ix, iy] = cardPoint(f, c.iconX, c.iconY)
        const d = c.iconD * a.scale
        res.flat.push({ x: ix, y: iy, z: zf - 0.0001, w: d * f.sx, h: d, r: d, color: col, ...clip, alpha: op })
        res.flat.push({ x: ix, y: iy, z: zf - 0.00005, w: d * 0.7 * f.sx, h: d * 0.7, r: d, color: colors.card, ...clip, alpha: op })
        res.flat.push({ x: ix, y: iy, z: zf, w: d * 0.28 * f.sx, h: d * 0.28, r: d, color: col, ...clip, alpha: op })
      }
      place(`${id}:ref`, c.refX, c.refY, !far)
      place(`${id}:title`, c.padX, c.titleY)

      for (const p of c.pills) {
        const [px, py] = cardPoint(f, p.x + p.w / 2, p.y + p.h / 2)
        if (!far) res.flat.push({ x: px, y: py, z: zf - 0.0001, w: p.w * a.scale * f.sx, h: p.h * a.scale, r: p.h, rot: a.rot, color: pillBg(p.color, dark), ...clip, alpha: op })
        place(`${id}:pill:${p.id}`, p.x + p.w / 2, p.y + p.h / 2, !far)
      }
      for (const av of c.avatars) {
        const [px, py] = cardPoint(f, av.x, av.y)
        if (!far) {
          res.flat.push({ x: px, y: py, z: zf - 0.00015, w: av.d * 1.12 * a.scale * f.sx, h: av.d * 1.12 * a.scale, r: av.d, color: colors.card, ...clip, alpha: op })
          res.flat.push({ x: px, y: py, z: zf - 0.0001, w: av.d * a.scale * f.sx, h: av.d * a.scale, r: av.d, color: av.color, ...clip, alpha: op })
        }
        place(`${id}:av:${av.id}`, av.x, av.y, !far)
      }
      if (c.due) place(`${id}:due`, c.due.x, c.due.y + c.due.size * 0.5, !far)
    },
    end() {
      res.bodies.end()
      res.flat.end()
      res.shadows.end()
    },
  }

  const newCardSlot = useMemo(() => {
    let cached: CardSlot<ProjectsContent> | null = null
    let key = ''
    return () => {
      const [w] = layout.newCardSize
      const k2 = `${w}`
      if (!cached || key !== k2) {
        const doc = useBoardStore.getState().doc
        const blank = {
          id: NEW_CARD_ID, boardId: doc.board.id, columnId: '', orderKey: '', title: 'New card', labelIds: [], assignees: [],
          archived: false, createdAt: '', updatedAt: '',
        }
        const { content, height } = projectsCardContent(blank, doc, w, M, runtime.measure)
        cached = { id: NEW_CARD_ID, columnId: '', index: 0, rect: { x: 0, y: 0, w, h: height }, rotation: 0, z: 0, clip: [-Infinity, Infinity], hidden: false, content }
        key = k2
      }
      return cached
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.newCardSize[0], layout.k])

  useCardFrames(layout, role, projectsMotion, drawer, newCardSlot)

  return (
    <group>
      <primitive object={res.shadows.root} />
      <primitive object={res.bodies.root} />
      <primitive object={res.flat.root} />
      <primitive object={res.text.root} />
    </group>
  )
}

export { pillBg, pillText }
