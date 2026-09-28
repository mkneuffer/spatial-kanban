import type { RemoteBoard, RemoteBoardSummary, RemoteCard, RemoteColumn, SyncOp, SyncOpResult } from '../../../src/integrations/protocol'
import type { Env } from '../env'
import { between, graphql, ProviderError, request, settle, type ProviderAdapter, type ProviderContext, type TokenSet } from './types'

/**
 * Linear. A board is a team: columns are its workflow states, cards its issues.
 * Completed and canceled issues older than `DONE_WINDOW_DAYS` are left out,
 * like Linear's own board.
 */
const API = 'https://api.linear.app/graphql'
const DONE_WINDOW_DAYS = 30
const STATE_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled']

const gql = <T>(token: string, query: string, variables: Record<string, unknown> = {}) => graphql<T>(API, { authorization: `Bearer ${token}` }, query, variables, 'Linear')

interface State {
  id: string
  name: string
  color: string
  type: string
  position: number
}

interface Issue {
  id: string
  identifier: string
  title: string
  description: string | null
  url: string
  sortOrder: number
  dueDate: string | null
  state: { id: string }
  labels: { nodes: Array<{ id: string; name: string; color: string }> }
  assignee: { id: string; name: string; displayName: string; avatarUrl: string | null } | null
}

export function sortStates(states: State[]): RemoteColumn[] {
  const rank = (t: string) => (STATE_ORDER.includes(t) ? STATE_ORDER.indexOf(t) : STATE_ORDER.length)
  return [...states].sort((a, b) => rank(a.type) - rank(b.type) || a.position - b.position).map((s) => ({ id: s.id, title: s.name, color: s.color }))
}

export function mapIssues(columns: RemoteColumn[], issues: Issue[]): RemoteCard[] {
  const index = new Map(columns.map((c, i) => [c.id, i]))
  return issues
    .filter((i) => index.has(i.state.id))
    .sort((a, b) => index.get(a.state.id)! - index.get(b.state.id)! || a.sortOrder - b.sortOrder)
    .map((i) => ({
      ref: { provider: 'linear', id: i.id, url: i.url, key: i.identifier },
      title: i.title,
      description: i.description ?? '',
      columnId: i.state.id,
      labels: i.labels.nodes.map((l) => ({ id: l.id, name: l.name, color: l.color })),
      assignees: i.assignee ? [{ id: i.assignee.id, name: i.assignee.displayName || i.assignee.name, avatarUrl: i.assignee.avatarUrl ?? undefined }] : [],
      dueDate: i.dueDate ?? undefined,
    }))
}

async function getBoard(ctx: ProviderContext, remoteId: string, now = Date.now()): Promise<RemoteBoard> {
  const since = new Date(now - DONE_WINDOW_DAYS * 86_400_000).toISOString()
  type Page = {
    organization: { urlKey: string }
    team: {
      id: string
      name: string
      key: string
      states: { nodes: State[] }
      issues: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Issue[] }
    } | null
  }
  const issues: Issue[] = []
  let first: Page | null = null
  let after: string | null = null
  for (let page = 0; page < 10; page++) {
    const data: Page = await gql<Page>(
      ctx.token,
      /* GraphQL */ `
        query($id: String!, $after: String, $since: DateTimeOrDuration!) {
          organization { urlKey }
          team(id: $id) {
            id name key
            states { nodes { id name color type position } }
            issues(first: 100, after: $after, filter: { or: [{ completedAt: { null: true }, canceledAt: { null: true } }, { completedAt: { gt: $since } }, { canceledAt: { gt: $since } }] }) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id identifier title description url sortOrder dueDate
                state { id }
                labels { nodes { id name color } }
                assignee { id name displayName avatarUrl }
              }
            }
          }
        }`,
      { id: remoteId, after, since },
    )
    if (!data.team) throw new ProviderError('That Linear team doesn’t exist or you can’t see it.', 404, true)
    first ??= data
    issues.push(...data.team.issues.nodes)
    if (!data.team.issues.pageInfo.hasNextPage) break
    after = data.team.issues.pageInfo.endCursor
  }
  const team = first!.team!
  const columns = sortStates(team.states.nodes)
  return { id: team.id, name: team.name, url: `https://linear.app/${first!.organization.urlKey}/team/${team.key}/active`, columns, cards: mapIssues(columns, issues) }
}

/** A sortOrder between the previous and next issue on the board. */
async function sortOrderBetween(token: string, prevId: string | null, nextId: string | null): Promise<number | undefined> {
  if (!prevId && !nextId) return undefined
  const data = await gql<{ prev?: { sortOrder: number } | null; next?: { sortOrder: number } | null }>(
    token,
    `query($p: String!, $n: String!, $hasP: Boolean!, $hasN: Boolean!) { prev: issue(id: $p) @include(if: $hasP) { sortOrder } next: issue(id: $n) @include(if: $hasN) { sortOrder } }`,
    { p: prevId ?? '', n: nextId ?? '', hasP: !!prevId, hasN: !!nextId },
  )
  return between(data.prev?.sortOrder, data.next?.sortOrder)
}

async function applyOp(ctx: ProviderContext, remoteId: string, op: SyncOp): Promise<SyncOpResult> {
  const { token } = ctx
  const update = (id: string, input: Record<string, unknown>) =>
    gql<{ issueUpdate: { success: boolean } }>(token, `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, { id, input })
  switch (op.op) {
    case 'update':
      await update(op.ref.id, { ...(op.title !== undefined ? { title: op.title } : {}), ...(op.description !== undefined ? { description: op.description } : {}) })
      return { ok: true }
    case 'move': {
      const sortOrder = await sortOrderBetween(token, op.afterId, op.beforeId)
      await update(op.ref.id, { ...(op.columnChanged ? { stateId: op.columnId } : {}), ...(sortOrder !== undefined ? { sortOrder } : {}) })
      return { ok: true }
    }
    case 'archive': {
      const name = op.archived ? 'issueArchive' : 'issueUnarchive'
      await gql(token, `mutation($id: String!) { ${name}(id: $id) { success } }`, { id: op.ref.id })
      return { ok: true }
    }
    case 'create': {
      const sortOrder = await sortOrderBetween(token, op.afterId, null)
      const data = await gql<{ issueCreate: { issue: { id: string; identifier: string; url: string } } }>(
        token,
        `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { id identifier url } } }`,
        { input: { teamId: remoteId, title: op.title || 'Untitled', description: op.description || undefined, stateId: op.columnId, ...(sortOrder !== undefined ? { sortOrder } : {}) } },
      )
      const issue = data.issueCreate.issue
      return { ok: true, ref: { provider: 'linear', id: issue.id, url: issue.url, key: issue.identifier } }
    }
  }
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenSet> {
  const body = await request<{ access_token: string; refresh_token?: string; expires_in?: number }>('https://api.linear.app/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: env.LINEAR_CLIENT_ID!, client_secret: env.LINEAR_CLIENT_SECRET!, ...params }).toString(),
    label: 'Linear',
  })
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined }
}

export const linear: ProviderAdapter = {
  id: 'linear',
  boardNoun: 'team',
  flow: 'oauth2',
  isConfigured: (env: Env) => !!(env.LINEAR_CLIENT_ID && env.LINEAR_CLIENT_SECRET),
  authorizeUrl(env, redirectUri, state) {
    const q = new URLSearchParams({ client_id: env.LINEAR_CLIENT_ID!, redirect_uri: redirectUri, response_type: 'code', scope: 'read,write', state, prompt: 'consent' })
    return `https://linear.app/oauth/authorize?${q}`
  },
  exchangeCode: (env, code, redirectUri) => tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  refresh: (env, refreshToken) => tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken }),
  async account(_env, token) {
    const data = await gql<{ viewer: { id: string; name: string }; organization: { name: string } }>(token, 'query { viewer { id name } organization { name } }')
    return { id: data.viewer.id, name: `${data.viewer.name} (${data.organization.name})` }
  },
  async listBoards(ctx): Promise<RemoteBoardSummary[]> {
    const data = await gql<{ organization: { name: string }; teams: { nodes: Array<{ id: string; name: string; key: string }> } }>(ctx.token, 'query { organization { name } teams(first: 100) { nodes { id name key } } }')
    return data.teams.nodes.map((t) => ({ id: t.id, name: `${t.name} (${t.key})`, group: data.organization.name }))
  },
  getBoard: (ctx, remoteId) => getBoard(ctx, remoteId),
  applyOp: (ctx, remoteId, op) => settle(() => applyOp(ctx, remoteId, op)),
}
