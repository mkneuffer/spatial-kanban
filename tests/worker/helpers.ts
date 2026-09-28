import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'
import worker, { type Env } from '../../worker/src/index'

type Row = Record<string, unknown>

/** Just enough of D1 for the Worker, backed by an in-memory SQLite database. */
export function createD1(): D1Database {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(fileURLToPath(new URL('../../worker/migrations/0001_init.sql', import.meta.url).href), 'utf8'))
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => statement(sql, p),
    first: async <T = Row>() => {
      const row = db.prepare(sql).get(...(params as never[]))
      return (row ? { ...row } : null) as T | null
    },
    all: async <T = Row>() => ({ results: db.prepare(sql).all(...(params as never[])).map((r) => ({ ...r })) as T[], success: true, meta: {} }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...(params as never[])).changes) } }),
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: Array<ReturnType<typeof statement>>) => {
      const out = []
      for (const s of stmts) out.push(await s.run())
      return out
    },
    exec: async (sql: string) => {
      db.exec(sql)
      return { count: 0, duration: 0 }
    },
  } as unknown as D1Database
}

export const ORIGIN = 'https://kanban.test'

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('<!doctype html>app', { headers: { 'content-type': 'text/html' } }) } as unknown as Fetcher,
    DB: createD1(),
    TOKEN_ENCRYPTION_KEY: 'test-key',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    TRELLO_API_KEY: 'trello-key',
    LINEAR_CLIENT_ID: 'lin-id',
    LINEAR_CLIENT_SECRET: 'lin-secret',
    JIRA_CLIENT_ID: 'jira-id',
    JIRA_CLIENT_SECRET: 'jira-secret',
    ...overrides,
  }
}

/** A browser: remembers cookies between requests to the Worker. */
export class Browser {
  cookies = new Map<string, string>()
  constructor(private env: Env) {}

  async fetch(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    let body = init.body
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      headers.set('origin', ORIGIN)
      body = JSON.stringify(init.json)
    }
    const method = init.method ?? (init.json !== undefined ? 'POST' : 'GET')
    const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers, body, redirect: 'manual' }), this.env)
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';')
      const [name, ...value] = pair.split('=')
      if (attrs.some((a) => a.trim() === 'Max-Age=0')) this.cookies.delete(name)
      else this.cookies.set(name, value.join('='))
    }
    return res
  }
}

export interface Call {
  url: string
  method: string
  headers: Headers
  body: string
  /** Parsed JSON body (GraphQL: `{ query, variables }`). */
  json: any
}

type Handler = (call: Call) => unknown | Promise<unknown>

/**
 * Stubs global fetch (the provider APIs). Each route is `[test, reply]`; a reply
 * that is a Response is returned as-is, anything else as JSON.
 */
export function mockFetch(routes: Array<[(c: Call) => boolean, Handler]>) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const body = typeof init.body === 'string' ? init.body : ''
    let json: unknown
    try {
      json = body ? JSON.parse(body) : undefined
    } catch {
      json = undefined
    }
    const call: Call = { url, method: init.method ?? 'GET', headers: new Headers(init.headers), body, json }
    calls.push(call)
    const route = routes.find(([test]) => test(call))
    if (!route) return new Response(JSON.stringify({ message: `unmocked ${call.method} ${url}` }), { status: 599 })
    const out = await route[1](call)
    return out instanceof Response ? out : new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

export const gqlHas = (host: string, fragment: string) => (c: Call) => c.url.startsWith(host) && typeof c.json?.query === 'string' && c.json.query.includes(fragment)
export const urlIs = (method: string, prefix: string) => (c: Call) => c.method === method && c.url.startsWith(prefix)
