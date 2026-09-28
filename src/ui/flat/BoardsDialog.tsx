import { useEffect, useMemo, useState } from 'react'
import { useBoardStore } from '../../data/store'
import type { BoardSummary } from '../../data/persistence'
import { deleteBoard, listBoards, openBoard } from '../../app/persistence'
import { openRemoteBoard, syncNow, unlinkBoard } from '../../app/integrations'
import { api, ApiRequestError } from '../../integrations/api'
import { PROVIDER_NAMES, type ProviderId, type ProviderInfo, type RemoteBoardSummary } from '../../integrations/protocol'
import { isConnected, useIntegrations, type SyncStatus } from '../../integrations/store'
import { toast } from '../toasts'
import { Dialog } from './Dialogs'
import { Icon } from './icons'

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'not yet'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString()
}

const STATUS_TEXT: Record<SyncStatus, string> = {
  off: 'Not syncing',
  syncing: 'Syncing…',
  synced: 'Synced',
  error: 'Sync problem',
  offline: 'Offline — changes are saved here and sync when you’re back',
  'needs-auth': 'Reconnect to keep syncing',
}

/** Boards on this device, and (when a sync backend exists) the online tools they can mirror. */
export function BoardsDialog({ onClose }: { onClose(): void }) {
  const backend = useIntegrations((s) => s.backend)
  const providers = useIntegrations((s) => s.providers)
  const initial = useIntegrations((s) => s.panel.provider)
  const board = useBoardStore((s) => s.doc.board)
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [picker, setPicker] = useState<ProviderId | null>(initial ?? null)

  useEffect(() => {
    let live = true
    void listBoards().then((b) => live && setBoards(b))
    return () => {
      live = false
    }
  }, [board.id, board.title, board.integration])

  return (
    <Dialog title="Boards & integrations" onClose={onClose}>
      {board.integration && <LinkedBoard />}

      <h3>Boards on this device</h3>
      <div className="archived-list">
        {boards.map((b) => (
          <div key={b.id} className="row">
            <span>
              {b.title}
              {b.integration && <span className="badge">{PROVIDER_NAMES[b.integration.provider]}</span>}
            </span>
            {b.id === board.id ? (
              <span className="current">Open</span>
            ) : (
              <button className="btn" onClick={() => void openBoard(b.id).then(onClose)}>
                Open
              </button>
            )}
            <button
              className="btn ghost icon"
              aria-label={`Delete ${b.title}`}
              title="Delete from this device"
              onClick={() => {
                const note = b.integration ? ` Nothing is deleted in ${PROVIDER_NAMES[b.integration.provider]}.` : ''
                if (!window.confirm(`Delete “${b.title}” from this device?${note}`)) return
                void deleteBoard(b.id).then(() => listBoards().then(setBoards))
              }}
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>

      {backend === 'ready' && (
        <>
          <h3>Online tools</h3>
          <p>Open a board from one of these to keep it in sync both ways. Your local boards stay as they are.</p>
          <div className="archived-list">
            {providers.map((p) => (
              <ProviderRow key={p.id} provider={p} onBrowse={() => setPicker(p.id)} />
            ))}
          </div>
          {picker && <RemotePicker key={picker} provider={picker} boards={boards} onDone={onClose} />}
        </>
      )}
      {backend === 'unavailable' && (
        <p className="hint">
          Syncing with GitHub Projects, Trello, Linear or Jira needs the optional sync server. Deploy this app as a Cloudflare Worker to turn it on (see the README).
        </p>
      )}
    </Dialog>
  )
}

function LinkedBoard() {
  const integration = useBoardStore((s) => s.doc.board.integration)!
  const sync = useIntegrations((s) => s.sync)
  const name = PROVIDER_NAMES[integration.provider]
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="linked" data-status={sync.status}>
      <div>
        <strong>
          Synced with {name}: {integration.name}
        </strong>
        <div className="muted">
          {STATUS_TEXT[sync.status]}
          {sync.status === 'synced' && ` · last checked ${relativeTime(sync.lastSyncedAt)}`}
          {sync.status === 'error' && sync.error ? ` · ${sync.error}` : ''}
        </div>
      </div>
      <div className="linked-actions">
        {sync.status === 'needs-auth' ? (
          <a className="btn primary" href={api.connectUrl(integration.provider)}>
            Reconnect
          </a>
        ) : (
          <button className="btn" onClick={syncNow} disabled={sync.status === 'syncing'}>
            <Icon name="sync" /> Sync now
          </button>
        )}
        {integration.url && (
          <a className="btn ghost" href={integration.url} target="_blank" rel="noreferrer">
            <Icon name="external" /> Open in {name}
          </a>
        )}
        <button
          className="btn ghost"
          onClick={() => {
            if (!window.confirm(`Stop syncing this board with ${name}? The cards stay here as a local board.`)) return
            unlinkBoard()
            toast('This board is local-only now.')
          }}
        >
          Stop syncing
        </button>
      </div>
    </div>
  )
}

function ProviderRow({ provider, onBrowse }: { provider: ProviderInfo; onBrowse(): void }) {
  const connections = useIntegrations((s) => s.connections)
  const connection = connections.find((c) => c.provider === provider.id)
  return (
    <div className="row">
      <span>
        {provider.name}
        {connection && <span className="muted"> · {connection.accountName}</span>}
      </span>
      {connection ? (
        <>
          <button className="btn primary" onClick={onBrowse}>
            Open a {provider.boardNoun}…
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              await api.disconnect(provider.id).catch(() => undefined)
              await useIntegrations.getState().refreshConnections()
              toast(`${provider.name} disconnected.`)
            }}
          >
            Disconnect
          </button>
        </>
      ) : (
        <a className="btn" href={api.connectUrl(provider.id)}>
          Connect
        </a>
      )}
    </div>
  )
}

function RemotePicker({ provider, boards, onDone }: { provider: ProviderId; boards: BoardSummary[]; onDone(): void }) {
  const connected = useIntegrations((s) => isConnected(s.connections, provider))
  const noun = useIntegrations((s) => s.providers.find((p) => p.id === provider)?.boardNoun ?? 'board')
  const [items, setItems] = useState<RemoteBoardSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    if (!connected) return
    let live = true
    api
      .boards(provider)
      .then((b) => live && setItems(b))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [provider, connected])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map = new Map<string, RemoteBoardSummary[]>()
    for (const b of items ?? []) {
      if (q && !`${b.name} ${b.group ?? ''}`.toLowerCase().includes(q)) continue
      const g = b.group ?? ''
      map.set(g, [...(map.get(g) ?? []), b])
    }
    return [...map]
  }, [items, query])

  if (!connected) return null

  const open = async (b: RemoteBoardSummary) => {
    // Already on this device: open that copy instead of importing a second one.
    const existing = boards.find((x) => x.integration?.provider === provider && x.integration.remoteId === b.id)
    setOpening(b.id)
    try {
      if (existing) await openBoard(existing.id)
      else await openRemoteBoard(provider, b.id)
      onDone()
    } catch (e) {
      const err = e as ApiRequestError
      toast(`Couldn’t open “${b.name}”: ${err.message}`, { tone: 'warn', ms: 6000 })
      setOpening(null)
    }
  }

  return (
    <div className="picker" aria-label={`${PROVIDER_NAMES[provider]} ${noun}s`}>
      <h3>
        {PROVIDER_NAMES[provider]}: choose a {noun}
      </h3>
      {error && <p className="hint">{error}</p>}
      {!items && !error && <p className="hint">Loading…</p>}
      {items && items.length === 0 && <p className="hint">No {noun}s found for this account.</p>}
      {items && items.length > 8 && <input className="picker-search" type="search" placeholder={`Filter ${noun}s`} aria-label={`Filter ${noun}s`} value={query} onChange={(e) => setQuery(e.target.value)} />}
      {groups.map(([group, list]) => (
        <div key={group} className="picker-group">
          {group && <div className="label">{group}</div>}
          {list.map((b) => {
            const here = boards.some((x) => x.integration?.provider === provider && x.integration.remoteId === b.id)
            return (
              <button key={b.id} className="picker-item" disabled={opening !== null} onClick={() => void open(b)}>
                <span>{b.name}</span>
                <span className="muted">{opening === b.id ? 'Opening…' : here ? 'On this device' : ''}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Compact sync state next to the board title; opens the dialog. */
export function SyncIndicator() {
  const integration = useBoardStore((s) => s.doc.board.integration)
  const status = useIntegrations((s) => s.sync.status)
  const backend = useIntegrations((s) => s.backend)
  if (!integration) return null
  const name = PROVIDER_NAMES[integration.provider]
  const text = backend !== 'ready' ? 'Sync unavailable' : status === 'needs-auth' ? 'Reconnect' : status === 'error' ? 'Sync problem' : status === 'offline' ? 'Offline' : status === 'syncing' ? 'Syncing' : name
  return (
    <button className="sync-pill" data-status={backend === 'ready' ? status : 'error'} title={`${name} · ${STATUS_TEXT[status]}`} onClick={() => useIntegrations.getState().openPanel()}>
      <Icon name="sync" />
      <span className="hide-sm">{text}</span>
    </button>
  )
}
