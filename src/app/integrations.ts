import { useBoardStore, onBoardPatches } from '../data/store'
import { useView } from '../board/viewStore'
import type { BoardIntegration, ProviderId } from '../data/model'
import { ulid } from '../data/ids'
import { api } from '../integrations/api'
import { SyncEngine } from '../integrations/engine'
import { PROVIDER_IDS, PROVIDER_NAMES } from '../integrations/protocol'
import { useIntegrations } from '../integrations/store'
import { boardFromRemote, type SyncShadow } from '../integrations/sync'
import { toast } from '../ui/toasts'
import { addBoard, kvGet, kvSetWithBoard } from './persistence'

let engine: SyncEngine | null = null

const isActive = () => document.visibilityState === 'visible' && navigator.onLine !== false

function startEngine(boardId: string, integration: BoardIntegration) {
  engine?.stop()
  engine = new SyncEngine(boardId, integration, {
    getDoc: () => useBoardStore.getState().doc,
    dispatch: (action) => useBoardStore.getState().dispatch(action),
    onChange: (fn) => onBoardPatches((_patches, _doc, action) => fn(action)),
    loadShadow: (id) => kvGet<SyncShadow>(`sync:${id}`),
    saveShadow: async (id, shadow) => kvSetWithBoard(`sync:${id}`, shadow),
    fetchBoard: (i) => api.board(i.provider, i.remoteId),
    pushOps: (i, ops) => api.ops(i.provider, i.remoteId, ops),
    onStatus: (status, info) => useIntegrations.getState().setSync({ status, error: info?.error, ...(info?.lastSyncedAt ? { lastSyncedAt: info.lastSyncedAt } : {}) }),
    notify: (message) => toast(message, { tone: 'warn', ms: 6000 }),
    isActive,
    holdCreate: (id) => {
      const v = useView.getState()
      return v.editIsNew && (v.detailCardId === id || v.editCardId === id)
    },
  })
  void engine.start()
}

function stopEngine() {
  engine?.stop()
  engine = null
  useIntegrations.getState().setSync({ status: 'off', error: undefined, lastSyncedAt: undefined })
}

/** Starts or stops syncing to match the open board. */
function reconcileEngine() {
  const { backend } = useIntegrations.getState()
  const { board } = useBoardStore.getState().doc
  const i = board.integration
  if (!i || backend !== 'ready') return stopEngine()
  if (engine && engine.boardId === board.id && engine.integration.provider === i.provider && engine.integration.remoteId === i.remoteId) return
  startEngine(board.id, i)
}

/** Pull now (the "Sync now" button). */
export function syncNow() {
  engine?.requestPull()
}

/** Imports a remote board as a new local board and opens it. */
export async function openRemoteBoard(provider: ProviderId, remoteId: string): Promise<void> {
  const remote = await api.board(provider, remoteId)
  const { doc, shadow } = boardFromRemote(provider, remote, { now: new Date().toISOString(), newId: ulid })
  await addBoard(doc, shadow)
  toast(`Opened “${remote.name}” from ${PROVIDER_NAMES[provider]}. Changes sync both ways.`, { tone: 'success' })
}

/** Stops syncing the open board; the cards stay as a local board. */
export function unlinkBoard() {
  const { doc, dispatch } = useBoardStore.getState()
  if (!doc.board.integration) return
  const board = { ...doc.board }
  delete board.integration
  dispatch({ type: 'sync/apply', board })
}

/** Handles `?connected=<provider>` / `?integration_error=…` after an OAuth round trip. */
function consumeAuthReturn(): ProviderId | null {
  const url = new URL(location.href)
  const connected = url.searchParams.get('connected') as ProviderId | null
  const error = url.searchParams.get('integration_error')
  if (!connected && !error) return null
  url.searchParams.delete('connected')
  url.searchParams.delete('integration_error')
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  if (error) toast(`Couldn’t connect: ${error}`, { tone: 'warn', ms: 8000 })
  if (connected && PROVIDER_IDS.includes(connected)) {
    toast(`${PROVIDER_NAMES[connected]} connected.`, { tone: 'success' })
    return connected
  }
  return null
}

/**
 * Optional integrations. Without a backend (a static deployment, or `npm run dev`
 * on its own) `/api/config` is missing and all of this stays dormant.
 */
export async function bootIntegrations(onConnected: (provider: ProviderId) => void): Promise<void> {
  const returned = consumeAuthReturn()
  await useIntegrations.getState().init()
  let last = { id: '', integration: undefined as BoardIntegration | undefined }
  useBoardStore.subscribe((s) => {
    if (s.doc.board.id === last.id && s.doc.board.integration === last.integration) return
    last = { id: s.doc.board.id, integration: s.doc.board.integration }
    reconcileEngine()
  })
  useIntegrations.subscribe((s, prev) => {
    if (s.backend !== prev.backend) reconcileEngine()
    // Reconnected after an auth error: resume.
    if (s.connections !== prev.connections) engine?.requestPull()
  })
  reconcileEngine()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') engine?.flush()
    else engine?.requestPull()
  })
  window.addEventListener('online', () => engine?.requestPull())
  // A card held back while it was being written can go out now.
  useView.subscribe((s, prev) => prev.editIsNew && !s.editIsNew && engine?.requestPush())
  if (returned && useIntegrations.getState().backend === 'ready') onConnected(returned)
}
