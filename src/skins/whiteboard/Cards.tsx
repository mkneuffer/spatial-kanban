import { useEffect, useMemo } from 'react'
import { Color } from 'three'
import type { CardsProps } from '../types'
import { cardPoint, useCardFrames, type CardDrawer } from '../../board/cardFrames'
import type { CardSlot } from '../../board/layout'
import { useBoardRuntime } from '../../board/runtime'
import { NEW_CARD_ID } from '../../board/drag'
import { ChipBatch, createChipMaterial } from '../../render/chips'
import { PaperBatch, createPaperMaterial } from '../../render/paper'
import { ShadowBatch, createShadowMaterial } from '../../render/shadows'
import { TextBatch, placeText } from '../../render/textBatch'
import { FONTS } from '../../render/fonts'
import { useBoardStore } from '../../data/store'
import { noteColor, STICKY_COLORS, whiteboardPalette } from './palette'
import { noteContent, whiteboardMetrics, type WhiteboardContent } from './layout'
import { whiteboardMotion } from './motion'

/** Height of the paper at card-local y (from top), mirroring the peel in the paper shader. */
function peelZ(curl: number, cy: number, h: number) {
  const y01 = 1 - cy / h
  const bend = Math.max(0, 0.55 - y01) / 0.55
  return curl * bend * bend * h * 0.42
}

export function WhiteboardCards({ layout, highContrast, role }: CardsProps<WhiteboardContent>) {
  const runtime = useBoardRuntime()
  const palette = useMemo(() => whiteboardPalette(highContrast), [highContrast])
  const res = useMemo(
    () => ({
      paper: new PaperBatch(createPaperMaterial(), 256),
      edges: new ChipBatch(createChipMaterial({ lit: false }), 256, false, 'note-edges'),
      dots: new ChipBatch(createChipMaterial({ lit: false }), 512, false, 'note-dots'),
      shadows: new ShadowBatch(createShadowMaterial(), 256),
      text: new TextBatch('note-text'),
      colors: new Map<string, Color>(),
    }),
    [],
  )
  useEffect(
    () => () => {
      res.paper.dispose()
      res.edges.dispose()
      res.dots.dispose()
      res.shadows.dispose()
      res.text.dispose()
    },
    [res],
  )
  const M = whiteboardMetrics(layout.k)
  const edge = new Color('#1a1a1a')

  const drawer: CardDrawer<WhiteboardContent> = {
    content(list) {
      const t = res.text
      const doc = useBoardStore.getState().doc
      t.mark()
      res.colors.clear()
      for (const { id, slot } of list) {
        const c = slot.content
        const card = doc.cards[id]
        res.colors.set(id, new Color(card ? noteColor(card, doc) : STICKY_COLORS.canary))
        c.lines.forEach((line, i) =>
          t.set(`${id}:l${i}`, { text: line, font: FONTS.caveat500, fontSize: c.textSize, color: id === NEW_CARD_ID ? palette.inkMuted : palette.noteInk, anchorY: 'top' }),
        )
        for (const dot of c.dots) t.set(`${id}:d:${dot.id}`, { text: dot.letter, font: FONTS.inter700, fontSize: dot.d * 0.62, color: '#ffffff', anchorX: 'center' })
        if (c.who) t.set(`${id}:who`, { text: c.who.text, font: FONTS.caveat700, fontSize: c.who.size, color: palette.inkMuted, anchorX: 'right' })
      }
      t.sweep()
    },
    begin() {
      res.paper.begin()
      res.edges.begin()
      res.dots.begin()
      res.shadows.begin()
    },
    card(f) {
      const { a, slot, id } = f
      const c = slot.content
      const op = runtime.opacity
      const z0 = a.z + 0.0012
      res.shadows.push({
        x: a.x + 0.001,
        y: a.y - 0.003 - f.lift * 0.01,
        z: 0.0005,
        w: a.w * f.sx * 0.96,
        h: a.h * 0.96,
        r: 0.002,
        blur: 0.004 + f.lift * 0.02,
        alpha: (0.22 + f.lift * 0.3) * op * Math.max(0, 1 - a.z / 0.12),
        rot: a.rot,
        scale: a.scale,
      })
      const color = res.colors.get(id) ?? new Color(STICKY_COLORS.canary)
      res.paper.push({ x: a.x, y: a.y, z: z0, w: a.w, h: a.h, rot: a.rot, scale: a.scale, sx: f.sx, curl: a.curl, color })
      if (highContrast || f.selected || f.hovered) {
        const border = 0.0012 * Math.max(0.6, layout.k)
        res.edges.push({
          x: a.x, y: a.y, z: z0 - 0.0002, w: a.w + 2 * border, h: a.h + 2 * border, r: 0.001, rot: a.rot, sx: f.sx, scale: a.scale,
          color: f.selected ? '#1f5fbf' : edge,
        })
      }
      const zText = z0 + 0.0007
      const far = runtime.far
      c.lines.forEach((_, i) => {
        const m = res.text.get(`${id}:l${i}`)
        if (!m) return
        const cy = c.textY + i * c.lineH
        const [x, y] = cardPoint(f, c.padX, cy)
        placeText(m, x, y, zText + peelZ(a.curl, cy + c.lineH / 2, slot.rect.h) * a.scale, a.rot, a.scale, f.sx, op)
      })
      for (const dot of c.dots) {
        const [x, y] = cardPoint(f, dot.x, dot.y)
        const lz = peelZ(a.curl, dot.y, slot.rect.h) * a.scale
        if (!far) res.dots.push({ x, y, z: zText + lz - 0.0002, w: dot.d * a.scale * f.sx, h: dot.d * a.scale, r: dot.d, color: dot.color, alpha: op })
        const m = res.text.get(`${id}:d:${dot.id}`)
        if (m) placeText(m, x, y, zText + lz, a.rot, a.scale, f.sx, far ? 0 : op)
      }
      if (c.who) {
        const m = res.text.get(`${id}:who`)
        if (m) {
          const [x, y] = cardPoint(f, c.who.x, c.who.y)
          placeText(m, x, y, zText + peelZ(a.curl, c.who.y, slot.rect.h) * a.scale, a.rot, a.scale, f.sx, far ? 0 : op)
        }
      }
    },
    end() {
      res.paper.end()
      res.edges.end()
      res.dots.end()
      res.shadows.end()
    },
  }

  const newCardSlot = useMemo(() => {
    let cached: CardSlot<WhiteboardContent> | null = null
    return () => {
      if (!cached) {
        const doc = useBoardStore.getState().doc
        const [s] = layout.newCardSize
        const blank = { id: NEW_CARD_ID, boardId: '', columnId: '', orderKey: '', title: 'new note', labelIds: [], assignees: [], archived: false, createdAt: '', updatedAt: '' }
        const content = noteContent(blank, doc, s, M, runtime.measure)
        cached = { id: NEW_CARD_ID, columnId: '', index: 0, rect: { x: 0, y: 0, w: s, h: s }, rotation: -0.03, z: 0, clip: [-Infinity, Infinity], hidden: false, content }
      }
      return cached
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.newCardSize[0], layout.k])

  useCardFrames(layout, role, whiteboardMotion, drawer, newCardSlot)

  return (
    <group>
      <primitive object={res.shadows.root} />
      <primitive object={res.edges.root} />
      <primitive object={res.paper.root} />
      <primitive object={res.dots.root} />
      <primitive object={res.text.root} />
    </group>
  )
}

