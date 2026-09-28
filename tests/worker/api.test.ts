import { afterEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import type { ApiConfig, ApiMe, OpsResponse, RemoteBoard, RemoteBoardSummary } from '../../src/integrations/protocol'
import { encrypt } from '../../worker/src/crypto'
import { Store } from '../../worker/src/db'
import { Browser, gqlHas, makeEnv, mockFetch, ORIGIN, urlIs } from './helpers'

const GH = 'https://api.github.com/graphql'

afterEach(() => vi.unstubAllGlobals())

/** Signs a browser in to GitHub through the full OAuth round trip. */
async function connectGitHub(browser: Browser, login = 'octo') {
  mockFetch([
    [urlIs('POST', 'https://github.com/login/oauth/access_token'), () => ({ access_token: `gho_${login}` })],
    [gqlHas(GH, 'viewer { id login }'), () => ({ data: { viewer: { id: `U_${login}`, login } } })],
  ])
  const start = await browser.fetch('/api/auth/github/start?return=%2F%3Fboard%3D1')
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!
  return browser.fetch(`/api/auth/github/callback?code=abc&state=${state}`)
}

const PROJECT = {
  node: {
    id: 'PVT_1',
    title: 'Roadmap',
    url: 'https://github.com/users/octo/projects/1',
    fields: {
      nodes: [
        {},
        {
          id: 'F_status',
          name: 'Status',
          options: [
            { id: 'o_todo', name: 'Todo', color: 'GRAY' },
            { id: 'o_done', name: 'Done', color: 'GREEN' },
          ],
        },
      ],
    },
  },
}

describe('config', () => {
  it('lists providers and whether each is enabled', async () => {
    const env = makeEnv({ LINEAR_CLIENT_SECRET: undefined })
    const res = await new Browser(env).fetch('/api/config')
    const body = (await res.json()) as ApiConfig
    expect(Object.fromEntries(body.providers.map((p) => [p.id, p.enabled]))).toEqual({ github: true, trello: true, linear: false, jira: true })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('disables everything without a database or encryption key', async () => {
    for (const env of [makeEnv({ DB: undefined }), makeEnv({ TOKEN_ENCRYPTION_KEY: undefined })]) {
      const body = (await (await new Browser(env).fetch('/api/config')).json()) as ApiConfig
      expect(body.providers.every((p) => !p.enabled)).toBe(true)
    }
  })

  it('serves the app for everything outside /api', async () => {
    const res = await new Browser(makeEnv()).fetch('/some/page')
    expect(await res.text()).toContain('app')
  })
})

describe('OAuth sign-in', () => {
  it('connects GitHub and returns to the app', async () => {
    const env = makeEnv()
    const browser = new Browser(env)
    const start = await browser.fetch('/api/auth/github/start?return=%2Fboard')
    expect(start.status).toBe(302)
    const auth = new URL(start.headers.get('location')!)
    expect(auth.origin + auth.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(auth.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/github/callback`)
    expect(browser.cookies.get('sk_oauth')).toBe(auth.searchParams.get('state'))

    const done = await connectGitHub(browser)
    expect(done.status).toBe(302)
    expect(done.headers.get('location')).toBe(`${ORIGIN}/?board=1&connected=github`)
    expect(browser.cookies.has('sk_session')).toBe(true)
    expect(browser.cookies.has('sk_oauth')).toBe(false)
    const me = (await (await browser.fetch('/api/me')).json()) as ApiMe
    expect(me.connections).toEqual([{ provider: 'github', accountName: 'octo', connectedAt: expect.any(String) }])
  })

  it('stores tokens encrypted', async () => {
    const env = makeEnv()
    await connectGitHub(new Browser(env))
    const row = await env.DB!.prepare('SELECT access_token FROM connections').first<{ access_token: string }>()
    expect(row!.access_token).toMatch(/^v1\./)
    expect(row!.access_token).not.toContain('gho_')
  })

  it('refuses a callback whose state does not match this browser', async () => {
    const env = makeEnv()
    const a = new Browser(env)
    const start = await a.fetch('/api/auth/github/start')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const res = await new Browser(env).fetch(`/api/auth/github/callback?code=abc&state=${state}`)
    expect(new URL(res.headers.get('location')!).searchParams.get('integration_error')).toMatch(/another browser/)
  })

  it('reports a denied consent back to the app', async () => {
    const browser = new Browser(makeEnv())
    const start = await browser.fetch('/api/auth/github/start')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const res = await browser.fetch(`/api/auth/github/callback?error=access_denied&error_description=Nope&state=${state}`)
    expect(new URL(res.headers.get('location')!).searchParams.get('integration_error')).toBe('Nope')
  })

  it('only returns to same-origin paths', async () => {
    const browser = new Browser(makeEnv())
    mockFetch([
      [urlIs('POST', 'https://github.com/login/oauth/access_token'), () => ({ access_token: 'gho_x' })],
      [gqlHas(GH, 'viewer'), () => ({ data: { viewer: { id: 'U', login: 'x' } } })],
    ])
    const start = await browser.fetch('/api/auth/github/start?return=%2F%2Fevil.example%2F')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const res = await browser.fetch(`/api/auth/github/callback?code=c&state=${state}`)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/?connected=github`)
  })

  it('signs a second device in as the same user', async () => {
    const env = makeEnv()
    const laptop = new Browser(env)
    await connectGitHub(laptop)
    const headset = new Browser(env)
    await connectGitHub(headset)
    const users = await env.DB!.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
    expect(users!.n).toBe(1)
  })

  it('connects Trello through the fragment page', async () => {
    const env = makeEnv()
    const browser = new Browser(env)
    const start = await browser.fetch('/api/auth/trello/start?return=%2F')
    const auth = new URL(start.headers.get('location')!)
    expect(auth.host).toBe('trello.com')
    const returnUrl = new URL(auth.searchParams.get('return_url')!)
    expect(returnUrl.pathname).toBe('/api/auth/trello/callback')

    const page = await browser.fetch(returnUrl.pathname + returnUrl.search)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/)

    mockFetch([[urlIs('GET', 'https://api.trello.com/1/members/me'), () => ({ id: 'm1', username: 'ada', fullName: 'Ada Brooks' })]])
    const res = await browser.fetch('/api/auth/trello/token', { json: { state: returnUrl.searchParams.get('state'), token: 'a'.repeat(64) } })
    expect(((await res.json()) as { redirect: string }).redirect).toBe(`${ORIGIN}/?connected=trello`)
    const me = (await (await browser.fetch('/api/me')).json()) as ApiMe
    expect(me.connections.map((c) => [c.provider, c.accountName])).toEqual([['trello', 'Ada Brooks']])
  })

  it('disconnects', async () => {
    const browser = new Browser(makeEnv())
    await connectGitHub(browser)
    await browser.fetch('/api/auth/github/disconnect', { json: {} })
    expect(((await (await browser.fetch('/api/me')).json()) as ApiMe).connections).toEqual([])
  })
})

describe('integrations API', () => {
  it('needs a connection', async () => {
    const res = await new Browser(makeEnv()).fetch('/api/integrations/github/boards')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'not_connected' })
  })

  it('refuses cross-origin writes', async () => {
    const res = await new Browser(makeEnv()).fetch('/api/integrations/github/ops', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(403)
  })

  it('lists GitHub projects, keeping what an org blocked', async () => {
    const browser = new Browser(makeEnv())
    await connectGitHub(browser)
    mockFetch([
      [
        gqlHas(GH, 'organizations'),
        () => ({
          data: {
            viewer: {
              login: 'octo',
              projectsV2: { nodes: [{ id: 'P1', title: 'Mine', url: 'u1', closed: false }, { id: 'P0', title: 'Old', url: 'u0', closed: true }] },
              organizations: { nodes: [{ login: 'acme', projectsV2: { nodes: [{ id: 'P2', title: 'Launch', url: 'u2', closed: false }] } }, { login: 'locked', projectsV2: null }] },
            },
          },
          errors: [{ message: 'Although you appear to have the correct authorization credentials, the `locked` organization has enabled OAuth App access restrictions' }],
        }),
      ],
    ])
    const boards = (await (await browser.fetch('/api/integrations/github/boards')).json()) as RemoteBoardSummary[]
    expect(boards).toEqual([
      { id: 'P1', name: 'Mine', group: 'octo', url: 'u1' },
      { id: 'P2', name: 'Launch', group: 'acme', url: 'u2' },
    ])
  })

  it('reads a GitHub project as a board', async () => {
    const browser = new Browser(makeEnv())
    await connectGitHub(browser)
    const person = { id: 'U1', login: 'octo', name: null, avatarUrl: 'https://avatars/1' }
    mockFetch([
      [gqlHas(GH, 'fields(first: 50)'), () => ({ data: PROJECT })],
      [
        gqlHas(GH, 'items(first: 100'),
        (c) => {
          expect(c.json.variables).toMatchObject({ id: 'PVT_1', field: 'Status' })
          return {
            data: {
              node: {
                items: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    { id: 'I_done', isArchived: false, type: 'ISSUE', status: { optionId: 'o_done' }, content: { __typename: 'Issue', id: 'IS_1', number: 7, title: 'Ship', body: 'Body', url: 'https://github.com/o/r/issues/7', repository: { nameWithOwner: 'o/r' }, labels: { nodes: [{ id: 'L1', name: 'bug', color: 'd73a4a' }] }, assignees: { nodes: [person] } } },
                    { id: 'I_draft', isArchived: false, type: 'DRAFT_ISSUE', status: null, content: { __typename: 'DraftIssue', id: 'DI_1', title: 'Idea', body: '', assignees: { nodes: [] } } },
                    { id: 'I_todo', isArchived: false, type: 'ISSUE', status: { optionId: 'o_todo' }, content: { __typename: 'Issue', id: 'IS_2', number: 8, title: 'Plan', body: null, url: 'https://github.com/o/r/issues/8', repository: { nameWithOwner: 'o/r' }, labels: { nodes: [] }, assignees: { nodes: [] } } },
                    { id: 'I_arch', isArchived: true, type: 'ISSUE', status: { optionId: 'o_todo' }, content: { __typename: 'Issue', id: 'IS_3', number: 9, title: 'Gone', body: '', labels: { nodes: [] }, assignees: { nodes: [] } } },
                    { id: 'I_red', isArchived: false, type: 'REDACTED', status: null, content: null },
                  ],
                },
              },
            },
          }
        },
      ],
    ])
    const res = await browser.fetch('/api/integrations/github/board', { json: { remoteId: 'PVT_1' } })
    const board = (await res.json()) as RemoteBoard
    expect(board.columns.map((c) => [c.id, c.title, c.color])).toEqual([
      ['__none__', 'No Status', '#8b949e'],
      ['o_todo', 'Todo', '#8b949e'],
      ['o_done', 'Done', '#3fb950'],
    ])
    expect(board.cards.map((c) => [c.ref.id, c.columnId, c.ref.key ?? null])).toEqual([
      ['I_draft', '__none__', null],
      ['I_todo', 'o_todo', '#8'],
      ['I_done', 'o_done', '#7'],
    ])
    expect(board.cards[2]).toMatchObject({
      title: 'Ship',
      description: 'Body',
      labels: [{ id: 'L1', name: 'bug', color: '#d73a4a' }],
      assignees: [{ id: 'U1', name: 'octo', avatarUrl: 'https://avatars/1' }],
      ref: { url: 'https://github.com/o/r/issues/7', meta: { contentId: 'IS_1', contentType: 'Issue', repo: 'o/r' } },
    })
  })

  it('applies ops to GitHub in order and reports each result', async () => {
    const browser = new Browser(makeEnv())
    await connectGitHub(browser)
    const calls = mockFetch([
      [gqlHas(GH, 'fields(first: 50)'), () => ({ data: PROJECT })],
      [gqlHas(GH, 'updateProjectV2ItemFieldValue'), () => ({ data: { updateProjectV2ItemFieldValue: { clientMutationId: null } } })],
      [gqlHas(GH, 'updateProjectV2ItemPosition'), () => ({ data: { updateProjectV2ItemPosition: { clientMutationId: null } } })],
      [gqlHas(GH, 'addProjectV2DraftIssue'), () => ({ data: { addProjectV2DraftIssue: { projectItem: { id: 'I_new', content: { id: 'DI_new' } } } } })],
      [gqlHas(GH, 'updateIssue'), () => ({ errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }] })],
    ])
    const ref = { provider: 'github' as const, id: 'I_todo', meta: { contentId: 'IS_2', contentType: 'Issue' } }
    const res = await browser.fetch('/api/integrations/github/ops', {
      json: {
        remoteId: 'PVT_1',
        ops: [
          { op: 'move', ref, columnId: 'o_done', afterId: 'I_done', beforeId: null, columnChanged: true },
          { op: 'create', localId: 'L1', columnId: 'o_todo', title: 'New', description: '', afterId: null },
          { op: 'update', ref, title: 'Renamed' },
        ],
      },
    })
    const { results } = (await res.json()) as OpsResponse
    expect(results).toEqual([
      { ok: true },
      { ok: true, ref: { provider: 'github', id: 'I_new', url: PROJECT.node.url, meta: { contentId: 'DI_new', contentType: 'DraftIssue' } } },
      { ok: false, error: 'Resource not accessible by integration', permanent: true },
    ])
    const mutations = calls.map((c) => c.json?.query as string).filter((q) => q?.startsWith('mutation')).map((q) => q.match(/\{ (\w+)\(/)![1])
    expect(mutations).toEqual(['updateProjectV2ItemFieldValue', 'updateProjectV2ItemPosition', 'addProjectV2DraftIssue', 'updateProjectV2ItemFieldValue', 'updateProjectV2ItemPosition', 'updateIssue'])
    // The project's fields are looked up once per request.
    expect(calls.filter((c) => c.json?.query?.includes('fields(first: 50)'))).toHaveLength(1)
    const move = calls.find((c) => c.json?.query?.includes('updateProjectV2ItemFieldValue'))!
    expect(move.json.variables).toEqual({ p: 'PVT_1', i: 'I_todo', f: 'F_status', o: 'o_done' })
    expect(move.headers.get('authorization')).toBe('Bearer gho_octo')
  })

  it('creates a card once even when the create is retried', async () => {
    const browser = new Browser(makeEnv())
    await connectGitHub(browser)
    const calls = mockFetch([
      [gqlHas(GH, 'fields(first: 50)'), () => ({ data: PROJECT })],
      [gqlHas(GH, 'addProjectV2DraftIssue'), () => ({ data: { addProjectV2DraftIssue: { projectItem: { id: 'I_new', content: { id: 'DI_new' } } } } })],
      [gqlHas(GH, 'mutation'), () => ({ data: {} })],
    ])
    const create = { op: 'create', localId: 'L1', columnId: 'o_todo', title: 'New', description: '', afterId: null }
    const first = (await (await browser.fetch('/api/integrations/github/ops', { json: { remoteId: 'PVT_1', ops: [create] } })).json()) as OpsResponse
    const again = (await (await browser.fetch('/api/integrations/github/ops', { json: { remoteId: 'PVT_1', ops: [create] } })).json()) as OpsResponse
    expect(again.results).toEqual(first.results)
    expect(calls.filter((c) => c.json?.query?.includes('addProjectV2DraftIssue'))).toHaveLength(1)
  })

  it('validates ops', async () => {
    const browser = new Browser(makeEnv())
    await connectGitHub(browser)
    const bad = [{ op: 'move', ref: { provider: 'trello', id: 'x' }, columnId: 'c', afterId: null, beforeId: null, columnChanged: true }]
    const res = await browser.fetch('/api/integrations/github/ops', { json: { remoteId: 'PVT_1', ops: bad } })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Change 1: bad card reference' })
  })

  it('asks to reconnect when the provider rejects the token', async () => {
    const browser = new Browser(makeEnv())
    await connectGitHub(browser)
    mockFetch([[gqlHas(GH, 'fields'), () => new Response('{"message":"Bad credentials"}', { status: 401 })]])
    const res = await browser.fetch('/api/integrations/github/board', { json: { remoteId: 'PVT_1' } })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'not_connected' })
  })

  it('refreshes an expired Jira token and stores the rotated one', async () => {
    const env = makeEnv()
    const browser = new Browser(env)
    await connectGitHub(browser) // any connection gives this browser a session
    const store = new Store(env.DB!)
    const { user_id } = (await env.DB!.prepare('SELECT user_id FROM connections').first<{ user_id: string }>())!
    await store.saveConnection({
      user_id,
      provider: 'jira',
      account_id: 'acc',
      account_name: 'Ada',
      access_token: await encrypt('test-key', 'old-access'),
      refresh_token: await encrypt('test-key', 'old-refresh'),
      expires_at: Date.now() - 1000,
      meta: JSON.stringify({ sites: [{ id: 'cloud1', url: 'https://acme.atlassian.net', name: 'Acme' }] }),
    })
    const calls = mockFetch([
      [urlIs('POST', 'https://auth.atlassian.com/oauth/token'), () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })],
      [urlIs('GET', 'https://api.atlassian.com/oauth/token/accessible-resources'), () => [{ id: 'cloud1', url: 'https://acme.atlassian.net', name: 'Acme' }]],
      [urlIs('GET', 'https://api.atlassian.com/ex/jira/cloud1/rest/api/3/project/search'), () => ({ values: [{ key: 'ENG', name: 'Engineering' }] })],
    ])
    const boards = (await (await browser.fetch('/api/integrations/jira/boards')).json()) as RemoteBoardSummary[]
    expect(boards).toEqual([{ id: 'cloud1/ENG', name: 'Engineering (ENG)', group: 'Acme', url: 'https://acme.atlassian.net/browse/ENG' }])
    expect(calls[0].json).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-refresh', client_id: 'jira-id' })
    expect(calls[1].headers.get('authorization')).toBe('Bearer new-access')
    const row = await store.connection(user_id, 'jira')
    const { decrypt } = await import('../../worker/src/crypto')
    expect(await decrypt('test-key', row!.refresh_token!)).toBe('new-refresh')
    expect(row!.expires_at).toBeGreaterThan(Date.now())
  })
})
