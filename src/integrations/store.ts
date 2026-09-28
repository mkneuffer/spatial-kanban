import { create } from 'zustand'
import { api } from './api'
import type { Connection, ProviderId, ProviderInfo } from './protocol'

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error' | 'offline' | 'needs-auth'

interface IntegrationState {
  /** `unavailable`: no backend on this deployment, so integrations are hidden. */
  backend: 'checking' | 'unavailable' | 'ready'
  providers: ProviderInfo[]
  connections: Connection[]
  sync: { status: SyncStatus; lastSyncedAt?: string; error?: string }
  /** The integrations dialog; `provider` jumps straight to that tool's boards. */
  panel: { open: boolean; provider?: ProviderId }
  openPanel(provider?: ProviderId): void
  closePanel(): void
  init(): Promise<void>
  refreshConnections(): Promise<void>
  setSync(changes: Partial<IntegrationState['sync']>): void
}

export const useIntegrations = create<IntegrationState>()((set, get) => ({
  backend: 'checking',
  providers: [],
  connections: [],
  sync: { status: 'off' },
  panel: { open: false },
  openPanel: (provider) => set({ panel: { open: true, provider } }),
  closePanel: () => set({ panel: { open: false } }),

  async init() {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 8000)
    try {
      const config = await api.config(ctl.signal)
      const providers = config.providers.filter((p) => p.enabled)
      // A backend with no tools configured is the same as no backend.
      if (!providers.length) throw new Error('No integrations configured')
      set({ backend: 'ready', providers })
      await get().refreshConnections()
    } catch {
      set({ backend: 'unavailable', providers: [], connections: [] })
    } finally {
      clearTimeout(timer)
    }
  },

  async refreshConnections() {
    try {
      const me = await api.me()
      set({ connections: me.connections })
    } catch {
      set({ connections: [] })
    }
  },

  setSync: (changes) => set((s) => ({ sync: { ...s.sync, ...changes } })),
}))

export const isConnected = (connections: Connection[], provider: ProviderId) => connections.some((c) => c.provider === provider)
