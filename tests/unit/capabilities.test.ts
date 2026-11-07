import { describe, expect, it } from 'vitest'
import { detectSessionCapabilities, isHandheldOverlay, wantsDomOverlay } from '../../src/xr/capabilities'

const session = (extra: Record<string, unknown>) => ({ enabledFeatures: ['local-floor', 'hit-test', 'anchors'], ...extra }) as unknown as XRSession

describe('DOM overlay: phones only', () => {
  it('only a "screen" overlay is a handheld', () => {
    expect(isHandheldOverlay('screen')).toBe(true)
    for (const t of ['floating', 'head-locked', undefined, null]) expect(isHandheldOverlay(t)).toBe(false)
  })

  it('asks for an overlay on a phone (AR only), never on a headset (AR + VR), and before detection', () => {
    expect(wantsDomOverlay({ checked: true, immersiveAR: true, immersiveVR: false })).toBe(true)
    expect(wantsDomOverlay({ checked: true, immersiveAR: true, immersiveVR: true })).toBe(false)
    expect(wantsDomOverlay({ checked: true, immersiveAR: false, immersiveVR: true })).toBe(false)
    expect(wantsDomOverlay({ checked: false, immersiveAR: false, immersiveVR: false })).toBe(true)
  })

  it('a headset that granted dom-overlay (Quest Browser) is not treated as a phone', () => {
    const caps = detectSessionCapabilities(session({ enabledFeatures: ['local-floor', 'dom-overlay'], domOverlayState: { type: 'floating' } }), 'immersive-ar')
    expect(caps.domOverlay).toBe(true)
    expect(caps.handheld).toBe(false)
  })

  it('a phone session is handheld', () => {
    const caps = detectSessionCapabilities(session({ enabledFeatures: ['local-floor', 'dom-overlay'], domOverlayState: { type: 'screen' } }), 'immersive-ar')
    expect(caps.handheld).toBe(true)
  })

  it('without an overlay nothing is handheld', () => {
    const caps = detectSessionCapabilities(session({}), 'immersive-ar')
    expect(caps.domOverlay).toBe(false)
    expect(caps.handheld).toBe(false)
  })
})
