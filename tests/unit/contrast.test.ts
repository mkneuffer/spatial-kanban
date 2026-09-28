import { describe, expect, it } from 'vitest'
import { contrastRatio, inkFor, readableOn } from '../../src/render/contrast'
import { BOARD_WHITE, markerInk, STICKY_COLORS } from '../../src/skins/whiteboard/palette'

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('darkens pale ink on a light background and lightens dark ink on a dark one', () => {
    const pale = readableOn('#bfe3ff', '#ffffff')
    expect(contrastRatio(pale, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    const dim = readableOn('#333333', '#111111')
    expect(contrastRatio(dim, '#111111')).toBeGreaterThanOrEqual(4.5)
    expect(readableOn('#000000', '#ffffff')).toBe('#000000')
  })

  it('never puts white letters on a pale label dot', () => {
    expect(inkFor(STICKY_COLORS.canary)).not.toBe('#ffffff')
    expect(inkFor('#1f5fbf')).toBe('#ffffff')
  })

  it('keeps every column marker readable on the whiteboard, even white or pastel columns', () => {
    for (const c of ['#ffffff', '#fdfd96', '#a8e6a1', '#8fd0ff', '#cdb8ff', '#ff9ec7', '#2da44e', undefined]) {
      expect(contrastRatio(markerInk(c), BOARD_WHITE)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
