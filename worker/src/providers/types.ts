import type { ProviderId, RemoteBoard, RemoteBoardSummary, SyncOp, SyncOpResult } from '../../../src/integrations/protocol'
import type { Env } from '../env'

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** Epoch ms. */
  expiresAt?: number
}

export interface Account {
  id: string
  name: string
  /** Stored with the connection and handed back in `ProviderContext.meta`. */
  meta?: Record<string, unknown>
}

export interface ProviderContext {
  env: Env
  userId: string
  token: string
  meta: Record<string, unknown>
}

export interface ProviderAdapter {
  id: ProviderId
  boardNoun: string
  /** `oauth2`: authorization-code flow. `fragment`: the token comes back in the URL fragment (Trello). */
  flow: 'oauth2' | 'fragment'
  isConfigured(env: Env): boolean
  authorizeUrl(env: Env, redirectUri: string, state: string): string
  exchangeCode?(env: Env, code: string, redirectUri: string): Promise<TokenSet>
  refresh?(env: Env, refreshToken: string): Promise<TokenSet>
  account(env: Env, token: string): Promise<Account>
  listBoards(ctx: ProviderContext): Promise<RemoteBoardSummary[]>
  getBoard(ctx: ProviderContext, remoteId: string): Promise<RemoteBoard>
  applyOp(ctx: ProviderContext, remoteId: string, op: SyncOp): Promise<SyncOpResult>
}

/** A failed call to a provider API. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Retrying the same request won't help (validation, permissions, workflow rules). */
    readonly permanent: boolean,
  ) {
    super(message)
  }
}

export function classifyStatus(status: number): boolean {
  // 4xx other than timeouts and rate limits: the request itself is the problem.
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

/** fetch() that throws a ProviderError with the provider's message on failure. */
export async function request<T>(url: string, init: RequestInit & { label: string }): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ProviderError(`Couldn’t reach ${init.label}.`, 0, false)
  }
  const text = await res.text()
  let body: unknown = undefined
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = text
  }
  if (!res.ok) throw new ProviderError(errorMessage(body) ?? `${init.label} returned ${res.status}.`, res.status, classifyStatus(res.status))
  return body as T
}

function errorMessage(body: unknown): string | undefined {
  if (!body) return undefined
  if (typeof body === 'string') return body.length < 200 ? body : undefined
  const b = body as Record<string, unknown>
  const candidates = [b.error_description, b.message, b.errorMessage, (b.errorMessages as string[] | undefined)?.[0], b.error]
  const errors = b.errors as Record<string, string> | Array<{ message?: string }> | undefined
  if (Array.isArray(errors)) candidates.push(errors[0]?.message)
  else if (errors && typeof errors === 'object') candidates.push(Object.values(errors)[0])
  return candidates.find((c): c is string => typeof c === 'string' && c.length > 0)
}

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string; type?: string; extensions?: { code?: string; type?: string; userPresentableMessage?: string } }>
}

/**
 * POSTs a GraphQL query. `partial` accepts data that came with errors (e.g.
 * an organization that blocks the OAuth app while the rest of the query works).
 */
export async function graphql<T>(url: string, headers: Record<string, string>, query: string, variables: Record<string, unknown>, label: string, partial = false): Promise<T> {
  const body = await request<GraphQLResponse<T>>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
    label,
  })
  if (body.errors?.length && !(partial && body.data)) {
    const e = body.errors[0]
    const code = e.extensions?.code ?? e.type ?? ''
    const transient = /RATE|LIMIT|TIMEOUT|INTERNAL|SERVICE/i.test(code)
    const unauth = /AUTHENTICATION|UNAUTHENTICATED/i.test(code)
    throw new ProviderError(e.extensions?.userPresentableMessage ?? e.message, unauth ? 401 : transient ? 503 : 422, !transient && !unauth)
  }
  if (!body.data) throw new ProviderError(`${label} returned no data.`, 502, false)
  return body.data
}

/** Runs an op, turning provider errors into a result instead of failing the batch. */
export async function settle(fn: () => Promise<SyncOpResult>): Promise<SyncOpResult> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.status === 401) throw err
      return { ok: false, error: err.message, permanent: err.permanent }
    }
    throw err
  }
}

/** A sort value between the previous and next card, for tools with numeric ordering. */
export function between(prev: number | undefined, next: number | undefined, step = 1024): number {
  if (prev !== undefined && next !== undefined) return (prev + next) / 2
  if (prev !== undefined) return prev + step
  if (next !== undefined) return next - step
  return 0
}
