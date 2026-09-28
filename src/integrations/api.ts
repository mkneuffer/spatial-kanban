import type { ApiConfig, ApiError, ApiMe, BoardRequest, OpsRequest, OpsResponse, ProviderId, RemoteBoard, RemoteBoardSummary, SyncOp } from './protocol'

/**
 * Client for the optional integrations backend. It is always same-origin: the
 * Cloudflare Worker serves the app too, and `npm run dev` proxies `/api` to it.
 */
const BASE = '/api'

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: ApiError['code'],
  ) {
    super(message)
  }
}

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiRequestError('Can’t reach the sync server.', 0, 'unavailable')
  }
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) throw new ApiRequestError('Sync server unavailable.', res.status, 'unavailable')
  const data = (await res.json()) as T | ApiError
  if (!res.ok) {
    const e = data as ApiError
    throw new ApiRequestError(e.error || `Request failed (${res.status})`, res.status, e.code)
  }
  return data as T
}

export const api = {
  config: (signal?: AbortSignal) => call<ApiConfig>('/config', undefined, signal),
  me: () => call<ApiMe>('/me'),
  boards: (provider: ProviderId) => call<RemoteBoardSummary[]>(`/integrations/${provider}/boards`),
  board: (provider: ProviderId, remoteId: string) => call<RemoteBoard>(`/integrations/${provider}/board`, { remoteId } satisfies BoardRequest),
  ops: (provider: ProviderId, remoteId: string, ops: SyncOp[]) => call<OpsResponse>(`/integrations/${provider}/ops`, { remoteId, ops } satisfies OpsRequest),
  disconnect: (provider: ProviderId) => call<{ ok: true }>(`/auth/${provider}/disconnect`, {}),
  /** Full-page navigation target that starts the provider's sign-in. */
  connectUrl(provider: ProviderId): string {
    const back = `${location.pathname}${location.search}`
    return `${BASE}/auth/${provider}/start?return=${encodeURIComponent(back)}`
  },
}
