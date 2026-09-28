import { Color } from 'three'

/**
 * WCAG contrast helpers (PLAN §13). Text colors that come from user data
 * (column and label colors) go through `readableOn` so pale inks never end up
 * on a white board, and white letters never sit on a pale dot.
 */

const _a = new Color()
const _b = new Color()

function channel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Relative luminance of an sRGB hex color (0 = black, 1 = white). */
export function luminance(hex: string): number {
  // three's Color converts hex to linear working space; read it back as sRGB.
  const { r, g, b } = _a.set(hex).convertLinearToSRGB()
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/**
 * Returns `fg`, darkened (on light backgrounds) or lightened (on dark ones)
 * just enough to reach `min` contrast against `bg`. Keeps the hue.
 */
export function readableOn(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return fg
  const toward = luminance(bg) > 0.4 ? '#000000' : '#ffffff'
  _b.set(toward)
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const c = '#' + _a.set(fg).lerp(_b, t).getHexString()
    if (contrastRatio(c, bg) >= min) return c
  }
  return toward
}

/** Black or white, whichever reads better on `bg`. */
export function inkFor(bg: string, light = '#ffffff', dark = '#1a1a1a'): string {
  return contrastRatio(light, bg) >= contrastRatio(dark, bg) ? light : dark
}
