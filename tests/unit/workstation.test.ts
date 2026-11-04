import { describe, expect, it } from 'vitest'
import { checksProgress, DURATION, initialState, stage } from '../../src/trailer/shared'

describe('workstation stage', () => {
  const t0 = 1_000_000

  it('walks from idle to merged on shared timestamps', () => {
    const s = initialState()
    expect(stage(s, t0)).toBe('idle')
    s.typed = 40
    expect(stage(s, t0)).toBe('typing')
    s.savedAt = t0
    s.savedTyped = 40
    expect(stage(s, t0)).toBe('saved')
    s.typed = 44
    expect(stage(s, t0)).toBe('typing') // unsaved changes again
    s.savedTyped = 44
    s.commitAt = t0
    expect(stage(s, t0 + 10)).toBe('committing')
    expect(stage(s, t0 + DURATION.commit + 1)).toBe('committed')
    s.pushAt = t0
    expect(stage(s, t0 + DURATION.push + 1)).toBe('pushed')
    s.prAt = t0
    expect(stage(s, t0 + 10)).toBe('opening')
    expect(stage(s, t0 + DURATION.pr + 10)).toBe('checks')
    expect(stage(s, t0 + DURATION.pr + DURATION.checks + DURATION.review + 1)).toBe('approved')
    s.mergedAt = t0
    expect(stage(s, t0)).toBe('merged')
  })

  it('reports CI progress only after the PR has opened', () => {
    const s = { ...initialState(), prAt: t0 }
    expect(checksProgress(s, t0 + 100)).toBe(0)
    expect(checksProgress(s, t0 + DURATION.pr + DURATION.checks / 2)).toBeCloseTo(0.5)
    expect(checksProgress(s, t0 + DURATION.pr + DURATION.checks * 2)).toBe(1)
  })
})
