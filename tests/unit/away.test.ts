import { beforeEach, describe, expect, it } from 'vitest'
import { AWAY_DISTANCE, boardAway, NEAR_DISTANCE, UNTRACKED_MS } from '../../src/xr/anchors'
import { createPlacement, hasSavedSpot, usePlacements } from '../../src/data/placements'

const here = { distance: 1.2, hasAnchor: true, hasPose: true, msSinceRestore: 10_000 }

describe('is the board out of reach?', () => {
  it('is here when nearby and tracked', () => {
    expect(boardAway(null, here)).toBe(null)
  })
  it('is in another room when far away', () => {
    expect(boardAway(null, { ...here, distance: AWAY_DISTANCE + 2 })).toBe('far')
  })
  it('stays "far" until the user is well back within reach (no flicker at the line)', () => {
    const between = { ...here, distance: (AWAY_DISTANCE + NEAR_DISTANCE) / 2 }
    expect(boardAway('far', between)).toBe('far')
    expect(boardAway(null, between)).toBe(null)
    expect(boardAway('far', { ...here, distance: NEAR_DISTANCE - 0.5 })).toBe(null)
  })
  it('is not in this room when a restored anchor is never found here', () => {
    const lost = { ...here, hasPose: false }
    expect(boardAway(null, { ...lost, msSinceRestore: 500 })).toBe(null) // still looking
    expect(boardAway(null, { ...lost, msSinceRestore: UNTRACKED_MS + 1 })).toBe('untracked')
  })
  it('a board without an anchor (this session only) is judged by distance alone', () => {
    expect(boardAway(null, { distance: 9, hasAnchor: false, hasPose: false, msSinceRestore: 99_999 })).toBe('far')
    expect(boardAway(null, { distance: 1, hasAnchor: false, hasPose: false, msSinceRestore: 99_999 })).toBe(null)
  })
})

describe('resetting the AR board position', () => {
  const st = () => usePlacements.getState()
  beforeEach(() => {
    const p = createPlacement('b1', 'wall', 'whiteboard', [1.2, 0.75])
    st().hydrate({ ...p, anchorHandle: 'anchor-1', localOffset: { position: [0.1, 0.2, -0.3], quaternion: [0, 0, 0, 1] }, tiltDeg: undefined }, [
      { cardId: 'c1', deviceId: p.deviceId, localOffset: { position: [0.5, 0, 0.2], quaternion: [0, 0, 0, 1] } },
    ])
  })

  it('forgets the anchor and the spot, keeps size, mode and skin, and remembers the old anchor to delete', () => {
    expect(hasSavedSpot(st().placement)).toBe(true)
    st().resetAnchor()
    const p = st().placement!
    expect(p.anchorHandle).toBeUndefined()
    expect(p.staleAnchorHandles).toEqual(['anchor-1'])
    expect(p.localOffset.position).toEqual([0, 0, 0])
    expect(p.size).toEqual([1.2, 0.75])
    expect(p.mode).toBe('wall')
    expect(p.skinId).toBe('whiteboard')
    expect(hasSavedSpot(p)).toBe(false)
    // Cards parked around the old spot go back onto the board.
    expect(st().freeCards).toEqual({})
  })

  it('collects anchors from repeated resets without duplicating work', () => {
    st().resetAnchor()
    st().updatePlacement({ anchorHandle: 'anchor-2' })
    st().resetAnchor()
    expect(st().placement!.staleAnchorHandles).toEqual(['anchor-1', 'anchor-2'])
  })

  it('does nothing without a placement', () => {
    st().hydrate(null, [])
    st().resetAnchor()
    expect(st().placement).toBeNull()
  })
})
