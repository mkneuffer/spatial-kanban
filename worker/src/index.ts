import { PROVIDER_CAPABILITIES, PROVIDER_IDS, PROVIDER_NAMES, type ApiConfig, type ApiMe, type BoardRequest, type OpsRequest, type OpsResponse, type ProviderId, type SyncOp, type SyncOpResult } from '../../src/integrations/protocol'
import { authCallback, disconnect, fragmentToken, providerContext, publicOrigin, requireAdapter, requireSetup, SESSION_COOKIE, startAuth } from './auth'
import { Store } from './db'
import type { Env } from './env'
import { badRequest, errorResponse, getCookie, HttpError, json, notConnected, readJson } from './http'
import { ADAPTERS } from './providers'
import { ProviderError } from './providers/types'

export type { Env }

const MAX_OPS = 100

/**
 * Spatial Kanban's Worker: serves the app (static assets) and the optional
 * integrations API under `/api`. Without D1 and TOKEN_ENCRYPTION_KEY, or
 * without any provider credentials, `/api/config` reports nothing enabled and
 * the app runs local-only.
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)
    try {
      return await route(req, env, url)
    } catch (err) {
      return errorResponse(err)
    }
  },
} satisfies ExportedHandler<Env>

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean).slice(1) // drop "api"
  const method = req.method
  if (method === 'POST') checkOrigin(req, env)

  if (method === 'GET' && parts.join('/') === 'config') return config(env)
  if (method === 'GET' && parts.join('/') === 'me') return me(req, env)

  const [area, provider, action, ...rest] = parts
  if (rest.length === 0 && area === 'auth' && provider) {
    if (method === 'GET' && action === 'start') return startAuth(req, env, provider)
    if (method === 'GET' && action === 'callback') return authCallback(req, env, provider)
    if (method === 'POST' && action === 'token') return fragmentToken(req, env, provider)
    if (method === 'POST' && action === 'disconnect') return disconnect(req, env, provider)
  }
  if (rest.length === 0 && area === 'integrations' && provider) {
    if (method === 'GET' && action === 'boards') return boards(req, env, provider)
    if (method === 'POST' && action === 'board') return board(req, env, provider)
    if (method === 'POST' && action === 'ops') return ops(req, env, provider)
  }
  throw new HttpError(404, 'Not found.')
}

/** Cross-site POSTs are refused (on top of SameSite cookies and the JSON-only bodies). */
function checkOrigin(req: Request, env: Env) {
  const origin = req.headers.get('origin')
  if (origin && origin !== publicOrigin(env, req)) throw new HttpError(403, 'Cross-origin request refused.', 'forbidden')
}

function config(env: Env): Response {
  const ready = !!env.DB && !!env.TOKEN_ENCRYPTION_KEY
  const body: ApiConfig = {
    version: 1,
    providers: PROVIDER_IDS.map((id) => ({
      id,
      name: PROVIDER_NAMES[id],
      enabled: ready && ADAPTERS[id].isConfigured(env),
      capabilities: PROVIDER_CAPABILITIES[id],
      boardNoun: ADAPTERS[id].boardNoun,
    })),
  }
  return json(body)
}

async function me(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ connections: [] } satisfies ApiMe)
  const store = new Store(env.DB)
  const userId = await store.sessionUser(getCookie(req, SESSION_COOKIE))
  const rows = userId ? await store.connections(userId) : []
  const body: ApiMe = {
    connections: rows
      .filter((r) => PROVIDER_IDS.includes(r.provider) && ADAPTERS[r.provider].isConfigured(env))
      .map((r) => ({ provider: r.provider, accountName: r.account_name, connectedAt: new Date(r.connected_at).toISOString() })),
  }
  return json(body)
}

/** Maps provider failures on reads to API errors. */
async function providerCall<T>(provider: ProviderId, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err
    if (err.status === 401) throw notConnected(PROVIDER_NAMES[provider])
    if (err.status === 403 || err.status === 404) throw new HttpError(err.status, err.message, 'forbidden')
    throw new HttpError(502, err.message, 'provider_error')
  }
}

async function boards(req: Request, env: Env, provider: string): Promise<Response> {
  requireSetup(env)
  const adapter = requireAdapter(env, provider)
  const ctx = await providerContext(req, env, adapter.id)
  return json(await providerCall(adapter.id, () => adapter.listBoards(ctx)))
}

async function board(req: Request, env: Env, provider: string): Promise<Response> {
  requireSetup(env)
  const adapter = requireAdapter(env, provider)
  const { remoteId } = await readJson<BoardRequest>(req)
  if (typeof remoteId !== 'string' || !remoteId || remoteId.length > 200) throw badRequest('Missing board id.')
  const ctx = await providerContext(req, env, adapter.id)
  return json(await providerCall(adapter.id, () => adapter.getBoard(ctx, remoteId)))
}

async function ops(req: Request, env: Env, provider: string): Promise<Response> {
  requireSetup(env)
  const adapter = requireAdapter(env, provider)
  const body = await readJson<OpsRequest>(req)
  if (typeof body.remoteId !== 'string' || !body.remoteId) throw badRequest('Missing board id.')
  if (!Array.isArray(body.ops) || body.ops.length > MAX_OPS) throw badRequest(`Send between 0 and ${MAX_OPS} changes at a time.`)
  body.ops.forEach((op, i) => {
    const problem = validateOp(op, adapter.id)
    if (problem) throw badRequest(`Change ${i + 1}: ${problem}`)
  })
  const ctx = await providerContext(req, env, adapter.id)
  const store = new Store(env.DB!)
  const results: SyncOpResult[] = []
  // In order: a move may refer to a card placed by the move before it.
  for (const op of body.ops) {
    try {
      if (op.op === 'create') {
        const prior = await store.createdItem(ctx.userId, adapter.id, op.localId)
        if (prior) {
          results.push({ ok: true, ref: prior })
          continue
        }
      }
      const result = await adapter.applyOp(ctx, body.remoteId, op)
      if (op.op === 'create' && result.ok && result.ref) await store.saveCreatedItem(ctx.userId, adapter.id, op.localId, result.ref)
      results.push(result)
    } catch (err) {
      if (err instanceof ProviderError && err.status === 401) throw notConnected(PROVIDER_NAMES[adapter.id])
      console.error(err)
      results.push({ ok: false, error: 'Unexpected error while saving this change.', permanent: false })
    }
  }
  return json({ results } satisfies OpsResponse)
}

const str = (v: unknown, max = 100_000) => typeof v === 'string' && v.length <= max
const optStr = (v: unknown, max?: number) => v === undefined || str(v, max)
const optId = (v: unknown) => v === null || str(v, 200)

export function validateOp(op: SyncOp, provider: ProviderId): string | null {
  if (!op || typeof op !== 'object') return 'not an object'
  if (op.op !== 'create') {
    if (!op.ref || op.ref.provider !== provider || !str(op.ref.id, 200)) return 'bad card reference'
    if (op.ref.meta !== undefined && (typeof op.ref.meta !== 'object' || Object.values(op.ref.meta).some((v) => !str(v, 500)))) return 'bad card reference'
  }
  switch (op.op) {
    case 'create':
      return str(op.localId, 100) && str(op.columnId, 200) && str(op.title, 10_000) && str(op.description) && optId(op.afterId) ? null : 'bad create'
    case 'update':
      return optStr(op.title, 10_000) && optStr(op.description) ? null : 'bad update'
    case 'move':
      return str(op.columnId, 200) && optId(op.afterId) && optId(op.beforeId) && typeof op.columnChanged === 'boolean' ? null : 'bad move'
    case 'archive':
      return typeof op.archived === 'boolean' ? null : 'bad archive'
    default:
      return 'unknown change'
  }
}
