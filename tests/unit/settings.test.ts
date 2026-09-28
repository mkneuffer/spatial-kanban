import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, migrateSettings, SETTINGS_VERSION } from '../../src/data/settings'

describe('settings', () => {
  it('defaults to the whiteboard skin', () => {
    expect(DEFAULT_SETTINGS.skinId).toBe('whiteboard')
  })

  it('moves boards saved under the old default to the whiteboard once', () => {
    expect(migrateSettings({ skinId: 'projects', sound: false })).toEqual({ skinId: 'whiteboard', sound: false, version: SETTINGS_VERSION })
  })

  it('keeps a skin chosen after the upgrade', () => {
    expect(migrateSettings({ version: SETTINGS_VERSION, skinId: 'projects' }).skinId).toBe('projects')
  })
})
