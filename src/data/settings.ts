import { create } from 'zustand'
import type { ScalePreset } from './model'

export interface Settings {
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

export const DEFAULT_SETTINGS: Settings = {
  skinId: 'projects',
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
  hydrate: (settings) => set(settings),
}))

export function pickSettings(s: Settings): Settings {
  const { skinId, reducedMotion, sound, haptics, highContrast, leftHanded, scalePreset } = s
  return { skinId, reducedMotion, sound, haptics, highContrast, leftHanded, scalePreset }
}
