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
  /** Handheld AR (a phone): the DOM overlay is the screen, so the screen HUD and 2D drawer apply. */
  handheld: boolean
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
  handheld: false,
  layers: false,
}

/**
 * A DOM overlay of type "screen" is a phone's screen. Headsets grant `dom-overlay` too (Quest Browser does
 * in immersive-ar) but show it as a floating or head-locked quad in front of the user, which is not a place
 * for the phone HUD.
 */
export function isHandheldOverlay(type: string | undefined | null): boolean {
  return type === 'screen'
}

/**
 * Whether an AR session should ask for a DOM overlay at all. Only handheld AR (immersive-ar without
 * immersive-vr) uses the screen HUD. On a headset the overlay is a quad between the user and the scene,
 * and the browser swallows any press whose ray lands on overlay content (`beforexrselect`), so the 3D
 * menus behind it never receive the select. Until the device has been detected, assume a phone so one
 * never loses its HUD.
 */
export function wantsDomOverlay(caps: Pick<DeviceCapabilities, 'checked' | 'immersiveAR' | 'immersiveVR'>): boolean {
  if (!caps.checked) return true
  return caps.immersiveAR && !caps.immersiveVR
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
  const overlayType = (session as XRSession & { domOverlayState?: { type?: string } | null }).domOverlayState?.type
  return {
    mode,
    hitTest: has('hit-test', typeof session.requestHitTestSource === 'function'),
    anchors: has('anchors', anchorsApi),
    persistentAnchors: typeof s.restorePersistentAnchor === 'function',
    planes: has('plane-detection', false),
    meshes: has('mesh-detection', false),
    hands: has('hand-tracking', false),
    domOverlay: has('dom-overlay', false) || overlayType != null,
    handheld: isHandheldOverlay(overlayType),
    layers: has('layers', false),
  }
}

export type { PersistentAnchorSession }
