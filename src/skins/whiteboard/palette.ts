import { Color } from 'three'
import type { BoardDoc, Card } from '../../data/model'

/** Default sticky palette (PLAN §7.3), chosen to stay distinguishable for color-blind users. */
export const STICKY_COLORS = {
  canary: '#ffe066',
  pink: '#ff9ec7',
  blue: '#8fd0ff',
  green: '#a8e6a1',
  orange: '#ffb86b',
  lilac: '#cdb8ff',
} as const

const STICKY_LIST = Object.values(STICKY_COLORS)

export function whiteboardPalette(highContrast: boolean) {
  return {
    board: '#fbfbf7',
    frame: '#c8ccd2',
    frameDark: '#8d939b',
    corner: '#3a3f46',
    ink: highContrast ? '#000000' : '#23262b',
    inkMuted: highContrast ? '#1a1a1a' : '#5b6068',
    noteInk: highContrast ? '#000000' : '#2b2a33',
    blue: '#1f5fbf',
    red: '#c62828',
    green: '#2e7d32',
    highlight: '#3b82f6',
    noteBorder: highContrast ? 0.35 : 0,
  }
}

function hue(hex: string): number {
  const hsl = { h: 0, s: 0, l: 0 }
  new Color(hex).getHSL(hsl)
  return hsl.h
}

/** Note color: explicit card color, else nearest sticky hue to the first label, else canary. */
export function noteColor(card: Pick<Card, 'color' | 'labelIds'>, doc: BoardDoc): string {
  if (card.color) return card.color
  const label = doc.board.labels.find((l) => l.id === card.labelIds[0])
  if (!label) return STICKY_COLORS.canary
  const h = hue(label.color)
  let best: string = STICKY_COLORS.canary
  let bestD = Infinity
  for (const c of STICKY_LIST) {
    const d = Math.min(Math.abs(hue(c) - h), 1 - Math.abs(hue(c) - h))
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/** Marker ink color for a column header, derived from the column color. */
export function markerInk(color: string | undefined): string {
  if (!color) return '#23262b'
  const c = new Color(color)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  if (hsl.s < 0.15) return '#23262b'
  return '#' + new Color().setHSL(hsl.h, Math.min(0.85, hsl.s + 0.1), 0.34).getHexString()
}
