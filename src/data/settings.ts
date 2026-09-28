import { create } from 'zustand'
import type { ScalePreset } from './model'

export interface Settings {
  /** Bumped when a default changes so saved settings can pick up the new default once. */
  version: number
  skinId: string
  reducedMotion: boolean
  sound: boolean
  haptics: boolean
  highContrast: boolean
  leftHanded: boolean
  scalePreset: ScalePreset
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** v2: the whiteboard became the default skin. */
export const SETTINGS_VERSION = 2

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  skinId: 'whiteboard',
  reducedMotion: typeof window !== 'undefined' ? prefersReducedMotion() : false,
  sound: true,
  haptics: true,
  highContrast: false,
  leftHanded: false,
  scalePreset: 'poster',
}

interface SettingsState extends Settings {
  set(changes: Partial<Settings>): void
  hydrate(settings: Partial<Settings>): void
}

export const useSettings = create<SettingsState>()((set) => ({
  ...DEFAULT_SETTINGS,
  set: (changes) => set(changes),
  hydrate: (settings) => set(migrateSettings(settings)),
}))

/** Upgrade settings saved by an older version. Choices made after an upgrade are kept. */
export function migrateSettings(saved: Partial<Settings>): Partial<Settings> {
  const out = { ...saved }
  if ((out.version ?? 1) < 2) out.skinId = DEFAULT_SETTINGS.skinId
  out.version = SETTINGS_VERSION
  return out
}

export function pickSettings(s: Settings): Settings {
  const { version, skinId, reducedMotion, sound, haptics, highContrast, leftHanded, scalePreset } = s
  return { version, skinId, reducedMotion, sound, haptics, highContrast, leftHanded, scalePreset }
}
