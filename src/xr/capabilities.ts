import { create } from 'zustand'

/**
 * Capability detection drives features (PLAN §8, decision 5). Never sniff user
 * agents: ask the browser what it supports, then read `enabledFeatures`.
 */

export interface DeviceCapabilities {
  checked: boolean
  webxr: boolean
  immersiveAR: boolean
  immersiveVR: boolean
  secureContext: boolean
  speech: boolean
}

export interface SessionCapabilities {
  mode: XRSessionMode | null
  hitTest: boolean
  anchors: boolean
  persistentAnchors: boolean
  planes: boolean
  meshes: boolean
  hands: boolean
  domOverlay: boolean
  layers: boolean
}

export const EMPTY_SESSION_CAPS: SessionCapabilities = {
  mode: null,
  hitTest: false,
  anchors: false,
  persistentAnchors: false,
  planes: false,
  meshes: false,
  hands: false,
  domOverlay: false,
  layers: false,
}

export const useDeviceCaps = create<DeviceCapabilities>()(() => ({
  checked: false,
  webxr: false,
  immersiveAR: false,
  immersiveVR: false,
  secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
  speech: typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
}))

export async function detectDeviceCapabilities(): Promise<DeviceCapabilities> {
  const xr = typeof navigator !== 'undefined' ? navigator.xr : undefined
  const check = async (mode: XRSessionMode) => {
    try {
      return (await xr?.isSessionSupported(mode)) ?? false
    } catch {
      return false
    }
  }
  const [ar, vr] = await Promise.all([check('immersive-ar'), check('immersive-vr')])
  const caps: DeviceCapabilities = { ...useDeviceCaps.getState(), checked: true, webxr: !!xr, immersiveAR: ar, immersiveVR: vr }
  useDeviceCaps.setState(caps)
  return caps
}

/** Anchors-module session extensions (typed in @types/webxr; delete is not in every version). */
type PersistentAnchorSession = XRSession & {
  deletePersistentAnchor?: (uuid: string) => Promise<void>
}

export function detectSessionCapabilities(session: XRSession, mode: XRSessionMode | null): SessionCapabilities {
  const enabled = new Set<string>((session as XRSession & { enabledFeatures?: string[] }).enabledFeatures ?? [])
  // Some runtimes don't report enabledFeatures; fall back to API presence.
  const has = (feature: string, probe: boolean) => (enabled.size > 0 ? enabled.has(feature) : probe)
  const s = session as PersistentAnchorSession
  const anchorsApi = typeof XRFrame !== 'undefined' && 'createAnchor' in XRFrame.prototype
  return {
    mode,
    hitTest: has('hit-test', typeof session.requestHitTestSource === 'function'),
    anchors: has('anchors', anchorsApi),
    persistentAnchors: typeof s.restorePersistentAnchor === 'function',
    planes: has('plane-detection', false),
    meshes: has('mesh-detection', false),
    hands: has('hand-tracking', false),
    domOverlay: has('dom-overlay', false) || !!(session as XRSession & { domOverlayState?: unknown }).domOverlayState,
    layers: has('layers', false),
  }
}

export type { PersistentAnchorSession }
