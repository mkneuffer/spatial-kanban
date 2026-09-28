import type { ProviderId } from '../../src/integrations/protocol'
import { decrypt, encrypt, randomToken } from './crypto'
import { SESSION_TTL_MS, Store } from './db'
import type { Env } from './env'
import { cookie, getCookie, HttpError, json, notConnected, readJson, redirect, safeReturnPath } from './http'
import { ADAPTERS } from './providers'
import { ProviderError, type ProviderContext, type TokenSet } from './providers/types'
import { PROVIDER_NAMES } from '../../src/integrations/protocol'

export const SESSION_COOKIE = 'sk_session'
export const STATE_COOKIE = 'sk_oauth'

export function publicOrigin(env: Env, req: Request): string {
  return (env.PUBLIC_URL ?? new URL(req.url).origin).replace(/\/$/, '')
}

function isSecure(origin: string): boolean {
  const { protocol, hostname } = new URL(origin)
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1'
}

export const callbackUrl = (env: Env, req: Request, provider: ProviderId) => `${publicOrigin(env, req)}/api/auth/${provider}/callback`

export function requireSetup(env: Env): { db: D1Database; key: string } {
  if (!env.DB || !env.TOKEN_ENCRYPTION_KEY) throw new HttpError(503, 'Integrations aren’t set up on this server.', 'unavailable')
  return { db: env.DB, key: env.TOKEN_ENCRYPTION_KEY }
}

export function requireAdapter(env: Env, provider: string) {
  const adapter = ADAPTERS[provider as ProviderId]
  if (!adapter) throw new HttpError(404, 'Unknown integration.', 'bad_request')
  if (!adapter.isConfigured(env)) throw new HttpError(503, `${PROVIDER_NAMES[adapter.id]} isn’t set up on this server.`, 'unavailable')
  return adapter
}

function backTo(env: Env, req: Request, returnTo: string, params: Record<string, string>): string {
  const url = new URL(safeReturnPath(returnTo), publicOrigin(env, req))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

const clearState = (env: Env, req: Request) => cookie(STATE_COOKIE, '', { maxAge: 0, path: '/api/auth', secure: isSecure(publicOrigin(env, req)) })

/** `GET /api/auth/:provider/start?return=/path` */
export async function startAuth(req: Request, env: Env, provider: string): Promise<Response> {
  const { db } = requireSetup(env)
  const adapter = requireAdapter(env, provider)
  const returnTo = safeReturnPath(new URL(req.url).searchParams.get('return'))
  const state = await new Store(db).createState(adapter.id, returnTo)
  let redirectUri = callbackUrl(env, req, adapter.id)
  // Trello returns the token in the fragment and ignores `state`, so it rides in the return URL.
  if (adapter.flow === 'fragment') redirectUri += `?state=${encodeURIComponent(state)}`
  const stateCookie = cookie(STATE_COOKIE, state, { maxAge: 600, path: '/api/auth', secure: isSecure(publicOrigin(env, req)) })
  return redirect(adapter.authorizeUrl(env, redirectUri, state), [stateCookie])
}

async function checkState(req: Request, db: D1Database, provider: ProviderId, state: string | null | undefined) {
  // The state must match the cookie set when this browser started signing in.
  if (!state || state !== getCookie(req, STATE_COOKIE)) throw new HttpError(400, 'Sign-in expired or was started in another browser. Please try again.', 'bad_request')
  const found = await new Store(db).consumeState(state, provider)
  if (!found) throw new HttpError(400, 'Sign-in expired. Please try again.', 'bad_request')
  return found.returnTo
}

/**
 * Stores the connection under the signed-in user. A browser without a session
 * signs in as whoever connected this account before (so a second device picks
 * up the same connections), or as a new user.
 */
async function finish(req: Request, env: Env, provider: ProviderId, tokens: TokenSet): Promise<string[]> {
  const { db, key } = requireSetup(env)
  const store = new Store(db)
  const adapter = ADAPTERS[provider]
  const account = await adapter.account(env, tokens.accessToken)
  let userId = await store.sessionUser(getCookie(req, SESSION_COOKIE))
  const cookies = [clearState(env, req)]
  if (!userId) {
    userId = (await store.userForAccount(provider, account.id)) ?? (await store.createUser())
    const token = await store.createSession(userId)
    cookies.push(cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_MS / 1000, path: '/api', secure: isSecure(publicOrigin(env, req)) }))
  }
  await store.saveConnection({
    user_id: userId,
    provider,
    account_id: account.id,
    account_name: account.name,
    access_token: await encrypt(key, tokens.accessToken),
    refresh_token: tokens.refreshToken ? await encrypt(key, tokens.refreshToken) : null,
    expires_at: tokens.expiresAt ?? null,
    meta: JSON.stringify(account.meta ?? {}),
  })
  return cookies
}

const message = (err: unknown) => (err instanceof HttpError || err instanceof ProviderError ? err.message : 'Something went wrong.')

/** `GET /api/auth/:provider/callback` */
export async function authCallback(req: Request, env: Env, provider: string): Promise<Response> {
  const adapter = requireAdapter(env, provider)
  if (adapter.flow === 'fragment') return fragmentPage()
  const { db } = requireSetup(env)
  const url = new URL(req.url)
  let returnTo = '/'
  try {
    returnTo = await checkState(req, db, adapter.id, url.searchParams.get('state'))
    const denied = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    if (denied || !code) throw new HttpError(400, url.searchParams.get('error_description') ?? 'Access wasn’t granted.', 'bad_request')
    const tokens = await adapter.exchangeCode!(env, code, callbackUrl(env, req, adapter.id))
    const cookies = await finish(req, env, adapter.id, tokens)
    return redirect(backTo(env, req, returnTo, { connected: adapter.id }), cookies)
  } catch (err) {
    if (!(err instanceof HttpError || err instanceof ProviderError)) console.error(err)
    return redirect(backTo(env, req, returnTo, { integration_error: message(err) }), [clearState(env, req)])
  }
}

/** `POST /api/auth/:provider/token` — the fragment flow's second half. */
export async function fragmentToken(req: Request, env: Env, provider: string): Promise<Response> {
  const adapter = requireAdapter(env, provider)
  if (adapter.flow !== 'fragment') throw new HttpError(404, 'Not found.')
  const { db } = requireSetup(env)
  const body = await readJson<{ state?: string; token?: string }>(req)
  let returnTo = '/'
  try {
    returnTo = await checkState(req, db, adapter.id, body.state)
    if (!body.token || !/^[\w-]{20,200}$/.test(body.token)) throw new HttpError(400, 'Access wasn’t granted.', 'bad_request')
    const cookies = await finish(req, env, adapter.id, { accessToken: body.token })
    const res = json({ redirect: backTo(env, req, returnTo, { connected: adapter.id }) })
    for (const c of cookies) res.headers.append('set-cookie', c)
    return res
  } catch (err) {
    return json({ redirect: backTo(env, req, returnTo, { integration_error: message(err) }) })
  }
}

function fragmentPage(): Response {
  const nonce = randomToken(16)
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connecting…</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#0d1117;color:#e6edf3}</style></head>
<body><p>Connecting…</p>
<script nonce="${nonce}">
(async () => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token')
  const state = new URLSearchParams(location.search).get('state')
  history.replaceState(null, '', location.pathname)
  let target = '/?integration_error=' + encodeURIComponent('Sign-in failed.')
  try {
    const res = await fetch(location.pathname.replace(/callback$/, 'token'), { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ state, token }) })
    target = (await res.json()).redirect || target
  } catch {}
  location.replace(target)
})()
</script></body></html>`
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'`,
    },
  })
}

/** `POST /api/auth/:provider/disconnect` */
export async function disconnect(req: Request, env: Env, provider: string): Promise<Response> {
  const { db } = requireSetup(env)
  const adapter = ADAPTERS[provider as ProviderId]
  if (!adapter) throw new HttpError(404, 'Unknown integration.')
  const store = new Store(db)
  const userId = await store.sessionUser(getCookie(req, SESSION_COOKIE))
  if (userId) await store.deleteConnection(userId, adapter.id)
  return json({ ok: true })
}

/** The signed-in user's token for a provider, refreshed when it's about to expire. */
export async function providerContext(req: Request, env: Env, provider: ProviderId): Promise<ProviderContext> {
  const { db, key } = requireSetup(env)
  const store = new Store(db)
  const adapter = ADAPTERS[provider]
  const name = PROVIDER_NAMES[provider]
  const userId = await store.sessionUser(getCookie(req, SESSION_COOKIE))
  if (!userId) throw notConnected(name)
  const row = await store.connection(userId, provider)
  if (!row) throw notConnected(name)
  let token = await decrypt(key, row.access_token)
  if (row.expires_at !== null && row.expires_at < Date.now() + 60_000) {
    if (!row.refresh_token || !adapter.refresh) throw notConnected(name)
    let fresh: TokenSet
    try {
      fresh = await adapter.refresh(env, await decrypt(key, row.refresh_token))
    } catch (err) {
      if (err instanceof ProviderError && !err.permanent) throw new HttpError(503, `${name} is unavailable right now.`, 'provider_error')
      throw notConnected(name)
    }
    await store.updateTokens(userId, provider, {
      access_token: await encrypt(key, fresh.accessToken),
      // Some tools rotate refresh tokens; keep the old one when they don't.
      refresh_token: fresh.refreshToken ? await encrypt(key, fresh.refreshToken) : row.refresh_token,
      expires_at: fresh.expiresAt ?? null,
    })
    token = fresh.accessToken
  }
  return { env, userId, token, meta: JSON.parse(row.meta) as Record<string, unknown> }
}
