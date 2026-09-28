import type { RemoteBoard, RemoteBoardSummary, RemoteCard, RemoteColumn, SyncOp, SyncOpResult } from '../../../src/integrations/protocol'
import type { Env } from '../env'
import { graphql, ProviderError, request, settle, type ProviderAdapter, type ProviderContext } from './types'

/**
 * GitHub Projects (v2). Columns are the options of the project's Status field
 * (or its first single-select field), plus "No Status"; cards are project items.
 */
const API = 'https://api.github.com/graphql'
const DEFAULT_SCOPES = 'read:user read:org project repo'
export const NO_STATUS = '__none__'

const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'user-agent': 'spatial-kanban' })
const gql = <T>(token: string, query: string, variables: Record<string, unknown> = {}, partial = false) => graphql<T>(API, headers(token), query, variables, 'GitHub', partial)

export const OPTION_COLORS: Record<string, string> = {
  GRAY: '#8b949e',
  BLUE: '#2f81f7',
  GREEN: '#3fb950',
  YELLOW: '#d29922',
  ORANGE: '#db6d28',
  RED: '#f85149',
  PINK: '#db61a2',
  PURPLE: '#a371f7',
}

interface Field {
  id: string
  name: string
  options: Array<{ id: string; name: string; color: string }>
}

interface Person {
  id: string
  login: string
  name: string | null
  avatarUrl: string
}

interface Item {
  id: string
  isArchived: boolean
  type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE' | 'REDACTED'
  status: { optionId: string | null } | null
  content: {
    __typename: 'Issue' | 'PullRequest' | 'DraftIssue'
    id: string
    title: string
    body: string | null
    number?: number
    url?: string
    repository?: { nameWithOwner: string }
    labels?: { nodes: Array<{ id: string; name: string; color: string }> }
    assignees: { nodes: Person[] }
  } | null
}

const PROJECT_FIELDS = /* GraphQL */ `
  query($id: ID!) {
    node(id: $id) {
      ... on ProjectV2 {
        id title url
        fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name color } } } }
      }
    }
  }`

const PROJECT_ITEMS = /* GraphQL */ `
  query($id: ID!, $field: String!, $after: String) {
    node(id: $id) {
      ... on ProjectV2 {
        items(first: 100, after: $after, orderBy: { field: POSITION, direction: ASC }) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id isArchived type
            status: fieldValueByName(name: $field) { ... on ProjectV2ItemFieldSingleSelectValue { optionId } }
            content {
              __typename
              ... on DraftIssue { id title body assignees(first: 10) { nodes { id login name avatarUrl } } }
              ... on Issue { id number title body url repository { nameWithOwner } labels(first: 20) { nodes { id name color } } assignees(first: 10) { nodes { id login name avatarUrl } } }
              ... on PullRequest { id number title body url repository { nameWithOwner } labels(first: 20) { nodes { id name color } } assignees(first: 10) { nodes { id login name avatarUrl } } }
            }
          }
        }
      }
    }
  }`

interface Project {
  id: string
  title: string
  url: string
  field: Field
}

async function project(token: string, id: string): Promise<Project> {
  const data = await gql<{ node: { id?: string; title: string; url: string; fields: { nodes: Array<Partial<Field>> } } | null }>(token, PROJECT_FIELDS, { id })
  const node = data.node
  if (!node?.id) throw new ProviderError('That GitHub project doesn’t exist or you can’t see it.', 404, true)
  const selects = node.fields.nodes.filter((f): f is Field => !!f.options)
  const field = selects.find((f) => f.name.toLowerCase() === 'status') ?? selects[0]
  if (!field) throw new ProviderError('This project has no Status field to use as columns.', 422, true)
  return { id: node.id, title: node.title, url: node.url, field }
}

export function mapItem(item: Item, projectUrl: string, optionIds: Set<string>): RemoteCard | null {
  const c = item.content
  if (item.isArchived || !c || item.type === 'REDACTED') return null
  const optionId = item.status?.optionId
  const isDraft = c.__typename === 'DraftIssue'
  return {
    ref: {
      provider: 'github',
      id: item.id,
      url: c.url ?? projectUrl,
      key: isDraft ? undefined : `#${c.number}`,
      meta: { contentId: c.id, contentType: c.__typename, ...(c.repository ? { repo: c.repository.nameWithOwner } : {}) },
    },
    title: c.title,
    description: c.body ?? '',
    columnId: optionId && optionIds.has(optionId) ? optionId : NO_STATUS,
    labels: (c.labels?.nodes ?? []).map((l) => ({ id: l.id, name: l.name, color: `#${l.color}` })),
    assignees: c.assignees.nodes.map((p) => ({ id: p.id, name: p.name || p.login, avatarUrl: p.avatarUrl })),
  }
}

async function getBoard(ctx: ProviderContext, remoteId: string): Promise<RemoteBoard> {
  const p = await project(ctx.token, remoteId)
  const columns: RemoteColumn[] = [
    { id: NO_STATUS, title: `No ${p.field.name}`, color: OPTION_COLORS.GRAY },
    ...p.field.options.map((o) => ({ id: o.id, title: o.name, color: OPTION_COLORS[o.color] ?? OPTION_COLORS.GRAY })),
  ]
  const optionIds = new Set(p.field.options.map((o) => o.id))
  const cards: RemoteCard[] = []
  let after: string | null = null
  for (let page = 0; page < 20; page++) {
    type Page = { node: { items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Item[] } } }
    const data: Page = await gql<Page>(ctx.token, PROJECT_ITEMS, { id: p.id, field: p.field.name, after })
    for (const item of data.node.items.nodes) {
      const card = mapItem(item, p.url, optionIds)
      if (card) cards.push(card)
    }
    if (!data.node.items.pageInfo.hasNextPage) break
    after = data.node.items.pageInfo.endCursor
  }
  // Items come in project order; group them by column, keeping that order.
  const index = new Map(columns.map((c, i) => [c.id, i]))
  cards.sort((a, b) => index.get(a.columnId)! - index.get(b.columnId)!)
  return { id: p.id, name: p.title, url: p.url, columns, cards }
}

async function listBoards(ctx: ProviderContext): Promise<RemoteBoardSummary[]> {
  type Node = { id: string; title: string; url: string; closed: boolean }
  const data = await gql<{
    viewer: { login: string; projectsV2: { nodes: Node[] }; organizations: { nodes: Array<{ login: string; projectsV2: { nodes: Node[] } | null } | null> } }
  }>(
    ctx.token,
    /* GraphQL */ `
      query {
        viewer {
          login
          projectsV2(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { id title url closed } }
          organizations(first: 25) { nodes { login projectsV2(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { id title url closed } } } }
        }
      }`,
    {},
    true, // organizations that restrict OAuth apps come back as errors; keep the rest
  )
  const out: RemoteBoardSummary[] = []
  const add = (group: string, nodes: Node[] = []) => {
    for (const n of nodes) if (n && !n.closed) out.push({ id: n.id, name: n.title, group, url: n.url })
  }
  add(data.viewer.login, data.viewer.projectsV2.nodes)
  for (const org of data.viewer.organizations.nodes) if (org) add(org.login, org.projectsV2?.nodes)
  return out
}

async function setStatus(token: string, p: Project, itemId: string, columnId: string) {
  if (columnId === NO_STATUS) {
    await gql(token, `mutation($p: ID!, $i: ID!, $f: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f }) { clientMutationId } }`, { p: p.id, i: itemId, f: p.field.id })
    return
  }
  if (!p.field.options.some((o) => o.id === columnId)) throw new ProviderError('That column no longer exists in the project.', 422, true)
  await gql(
    token,
    `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { clientMutationId } }`,
    { p: p.id, i: itemId, f: p.field.id, o: columnId },
  )
}

async function setPosition(token: string, projectId: string, itemId: string, afterId: string | null) {
  // Positions are project-wide; right after the previous card in the column (or first) keeps the column order.
  await gql(token, `mutation($p: ID!, $i: ID!, $a: ID) { updateProjectV2ItemPosition(input: { projectId: $p, itemId: $i, afterId: $a }) { clientMutationId } }`, { p: projectId, i: itemId, a: afterId })
}

async function applyOp(ctx: ProviderContext, remoteId: string, op: SyncOp, cache: { project?: Promise<Project> }): Promise<SyncOpResult> {
  const { token } = ctx
  const getProject = () => (cache.project ??= project(token, remoteId))
  switch (op.op) {
    case 'update': {
      const type = op.ref.meta?.contentType
      const id = op.ref.meta?.contentId
      if (!id) return { ok: false, error: 'Missing item details; it will refresh on the next sync.', permanent: true }
      const vars = { id, title: op.title, body: op.description }
      if (type === 'Issue') await gql(token, `mutation($id: ID!, $title: String, $body: String) { updateIssue(input: { id: $id, title: $title, body: $body }) { clientMutationId } }`, vars)
      else if (type === 'PullRequest') await gql(token, `mutation($id: ID!, $title: String, $body: String) { updatePullRequest(input: { pullRequestId: $id, title: $title, body: $body }) { clientMutationId } }`, vars)
      else await gql(token, `mutation($id: ID!, $title: String, $body: String) { updateProjectV2DraftIssue(input: { draftIssueId: $id, title: $title, body: $body }) { clientMutationId } }`, vars)
      return { ok: true }
    }
    case 'move': {
      const p = await getProject()
      if (op.columnChanged) await setStatus(token, p, op.ref.id, op.columnId)
      await setPosition(token, p.id, op.ref.id, op.afterId)
      return { ok: true }
    }
    case 'archive': {
      const name = op.archived ? 'archiveProjectV2Item' : 'unarchiveProjectV2Item'
      await gql(token, `mutation($p: ID!, $i: ID!) { ${name}(input: { projectId: $p, itemId: $i }) { clientMutationId } }`, { p: remoteId, i: op.ref.id })
      return { ok: true }
    }
    case 'create': {
      const p = await getProject()
      const data = await gql<{ addProjectV2DraftIssue: { projectItem: { id: string; content: { id: string } } } }>(
        token,
        `mutation($p: ID!, $t: String!, $b: String) { addProjectV2DraftIssue(input: { projectId: $p, title: $t, body: $b }) { projectItem { id content { ... on DraftIssue { id } } } } }`,
        { p: p.id, t: op.title || 'Untitled', b: op.description || null },
      )
      const item = data.addProjectV2DraftIssue.projectItem
      if (op.columnId !== NO_STATUS) await setStatus(token, p, item.id, op.columnId)
      await setPosition(token, p.id, item.id, op.afterId)
      return { ok: true, ref: { provider: 'github', id: item.id, url: p.url, meta: { contentId: item.content.id, contentType: 'DraftIssue' } } }
    }
  }
}

export const github: ProviderAdapter = {
  id: 'github',
  boardNoun: 'project',
  flow: 'oauth2',
  isConfigured: (env: Env) => !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
  authorizeUrl(env, redirectUri, state) {
    const q = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID!, redirect_uri: redirectUri, scope: env.GITHUB_SCOPES ?? DEFAULT_SCOPES, state, allow_signup: 'true' })
    return `https://github.com/login/oauth/authorize?${q}`
  },
  async exchangeCode(env, code, redirectUri) {
    const body = await request<{ access_token?: string; error_description?: string }>('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri }),
      label: 'GitHub',
    })
    if (!body.access_token) throw new ProviderError(body.error_description ?? 'GitHub didn’t return a token.', 400, true)
    return { accessToken: body.access_token }
  },
  async account(_env, token) {
    const data = await gql<{ viewer: { id: string; login: string } }>(token, 'query { viewer { id login } }')
    return { id: data.viewer.id, name: data.viewer.login }
  },
  listBoards,
  getBoard,
  applyOp: (ctx, remoteId, op) => settle(() => applyOp(ctx, remoteId, op, opCache(ctx, remoteId))),
}

// One project lookup per ops request, not per op.
const caches = new WeakMap<ProviderContext, Map<string, { project?: Promise<Project> }>>()
function opCache(ctx: ProviderContext, remoteId: string) {
  let m = caches.get(ctx)
  if (!m) caches.set(ctx, (m = new Map()))
  let c = m.get(remoteId)
  if (!c) m.set(remoteId, (c = {}))
  return c
}
