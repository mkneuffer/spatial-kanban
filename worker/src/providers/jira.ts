import type { RemoteBoard, RemoteBoardSummary, RemoteCard, RemoteColumn, SyncOp, SyncOpResult } from '../../../src/integrations/protocol'
import type { Env } from '../env'
import { ProviderError, request, settle, type ProviderAdapter, type ProviderContext, type TokenSet } from './types'

/**
 * Jira Cloud (OAuth 2.0 3LO). A board is a project: columns are its statuses
 * grouped To Do → In progress → Done, cards its issues in rank order. Moving a
 * card runs the workflow transition to that status. Done issues untouched for
 * `DONE_WINDOW_DAYS` are left out.
 */
const API = 'https://api.atlassian.com'
const SCOPES = 'read:jira-work write:jira-work read:jira-user read:me offline_access'
const DONE_WINDOW_DAYS = 30
const CATEGORY_ORDER = ['new', 'indeterminate', 'done']
const CATEGORY_COLORS: Record<string, string> = { new: '#8b949e', indeterminate: '#2f81f7', done: '#3fb950' }
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,63}$/

interface Site {
  id: string
  url: string
  name: string
}

export interface JiraStatus {
  id: string
  name: string
  statusCategory: { key: string }
}

interface JiraIssue {
  id: string
  key: string
  fields: {
    summary: string
    description: AdfNode | null
    status: JiraStatus
    labels: string[]
    assignee: { accountId: string; displayName: string; avatarUrls?: Record<string, string> } | null
    duedate: string | null
  }
}

// ——— Atlassian Document Format ↔ plain text ———

export interface AdfNode {
  type: string
  version?: number
  text?: string
  attrs?: Record<string, unknown>
  content?: AdfNode[]
}

export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return ''
  const inline = (n: AdfNode): string => {
    if (n.type === 'text') return n.text ?? ''
    if (n.type === 'hardBreak') return '\n'
    if (n.type === 'mention' || n.type === 'emoji') return String(n.attrs?.text ?? n.attrs?.shortName ?? '')
    if (n.type === 'inlineCard') return String(n.attrs?.url ?? '')
    return (n.content ?? []).map(inline).join('')
  }
  const block = (n: AdfNode, prefix = ''): string[] => {
    switch (n.type) {
      case 'paragraph':
        return [prefix + inline(n)]
      case 'heading':
        return [`${'#'.repeat(Number(n.attrs?.level ?? 1))} ${inline(n)}`]
      case 'codeBlock':
        return ['```\n' + inline(n) + '\n```']
      case 'rule':
        return ['---']
      case 'bulletList':
      case 'orderedList':
        return [
          (n.content ?? [])
            .map((item, i) => {
              const marker = n.type === 'bulletList' ? '- ' : `${i + 1}. `
              return (item.content ?? []).flatMap((c) => block(c)).join('\n').replace(/^/, marker).replace(/\n/g, '\n  ')
            })
            .join('\n'),
        ]
      case 'blockquote':
        return (n.content ?? []).flatMap((c) => block(c, '> '))
      default:
        return n.content ? n.content.flatMap((c) => block(c, prefix)) : [inline(n)]
    }
  }
  return block(node).filter((s, i, a) => s !== '' || (i > 0 && a[i - 1] !== '')).join('\n\n').trim()
}

export function textToAdf(text: string): AdfNode | null {
  if (!text.trim()) return null
  const paragraph = (para: string): AdfNode => ({
    type: 'paragraph',
    content: para.split('\n').flatMap((line, i): AdfNode[] => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]),
  })
  return { type: 'doc', version: 1, content: text.trim().split(/\n{2,}/).map(paragraph) }
}

// ——— mapping ———

/** Unique statuses across the project's issue types, grouped by category. */
export function statusColumns(byType: Array<{ subtask?: boolean; statuses: JiraStatus[] }>): RemoteColumn[] {
  const seen = new Map<string, JiraStatus>()
  for (const t of byType) if (!t.subtask) for (const s of t.statuses) if (!seen.has(s.id)) seen.set(s.id, s)
  const rank = (s: JiraStatus) => {
    const i = CATEGORY_ORDER.indexOf(s.statusCategory.key)
    return i < 0 ? 1 : i
  }
  return [...seen.values()]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => ({ id: s.id, title: s.name, color: CATEGORY_COLORS[s.statusCategory.key] ?? CATEGORY_COLORS.new }))
}

const LABEL_PALETTE = ['#579dff', '#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef', '#6cc3e0', '#94c748']
function labelColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return LABEL_PALETTE[h % LABEL_PALETTE.length]
}

export function mapIssue(issue: JiraIssue, siteUrl: string): RemoteCard {
  const f = issue.fields
  return {
    ref: { provider: 'jira', id: issue.id, url: `${siteUrl}/browse/${issue.key}`, key: issue.key, meta: { key: issue.key } },
    title: f.summary,
    description: adfToText(f.description),
    columnId: f.status.id,
    labels: f.labels.map((l) => ({ id: l, name: l, color: labelColor(l) })),
    assignees: f.assignee ? [{ id: f.assignee.accountId, name: f.assignee.displayName, avatarUrl: f.assignee.avatarUrls?.['48x48'] }] : [],
    dueDate: f.duedate ?? undefined,
  }
}

// ——— API ———

function parseRemoteId(remoteId: string): { cloudId: string; key: string } {
  const [cloudId, key] = remoteId.split('/')
  if (!cloudId || !key || !PROJECT_KEY.test(key) || !/^[\w-]+$/.test(cloudId)) throw new ProviderError('Invalid Jira project.', 400, true)
  return { cloudId, key }
}

function jira<T>(ctx: ProviderContext, cloudId: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return request<T>(`${API}/ex/jira/${cloudId}/rest/api/3${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${ctx.token}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    label: 'Jira',
  })
}

function sites(token: string): Promise<Site[]> {
  return request<Site[]>(`${API}/oauth/token/accessible-resources`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, label: 'Jira' })
}

async function siteUrl(ctx: ProviderContext, cloudId: string): Promise<string> {
  const known = (ctx.meta.sites as Site[] | undefined)?.find((s) => s.id === cloudId)
  if (known) return known.url
  const site = (await sites(ctx.token)).find((s) => s.id === cloudId)
  if (!site) throw new ProviderError('You no longer have access to that Jira site.', 403, true)
  return site.url
}

async function searchIssues(ctx: ProviderContext, cloudId: string, key: string): Promise<JiraIssue[]> {
  const fields = ['summary', 'description', 'status', 'labels', 'assignee', 'duedate']
  const scope = `project = "${key}" AND (statusCategory != Done OR updated >= -${DONE_WINDOW_DAYS}d)`
  const run = async (order: string) => {
    const issues: JiraIssue[] = []
    let nextPageToken: string | undefined
    for (let page = 0; page < 10; page++) {
      const res = await jira<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>(ctx, cloudId, '/search/jql', {
        method: 'POST',
        body: { jql: `${scope} ORDER BY ${order}`, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) },
      })
      issues.push(...res.issues)
      if (res.isLast !== false || !res.nextPageToken) break
      nextPageToken = res.nextPageToken
    }
    return issues
  }
  try {
    return await run('Rank ASC')
  } catch (err) {
    // Projects without Jira Software have no Rank field.
    if (err instanceof ProviderError && err.status === 400) return run('created ASC')
    throw err
  }
}

async function getBoard(ctx: ProviderContext, remoteId: string): Promise<RemoteBoard> {
  const { cloudId, key } = parseRemoteId(remoteId)
  const [url, project, statuses, issues] = await Promise.all([
    siteUrl(ctx, cloudId),
    jira<{ name: string }>(ctx, cloudId, `/project/${key}`),
    jira<Array<{ subtask?: boolean; statuses: JiraStatus[] }>>(ctx, cloudId, `/project/${key}/statuses`),
    searchIssues(ctx, cloudId, key),
  ])
  const columns = statusColumns(statuses)
  const known = new Set(columns.map((c) => c.id))
  // Issues in a status the project list didn't include (e.g. a sub-task status) still get a column.
  for (const i of issues) {
    const s = i.fields.status
    if (!known.has(s.id)) {
      known.add(s.id)
      columns.push({ id: s.id, title: s.name, color: CATEGORY_COLORS[s.statusCategory.key] ?? CATEGORY_COLORS.new })
    }
  }
  const index = new Map(columns.map((c, i) => [c.id, i]))
  const cards = issues.map((i) => mapIssue(i, url)).sort((a, b) => index.get(a.columnId)! - index.get(b.columnId)!)
  return { id: remoteId, name: `${project.name} (${key})`, url: `${url}/browse/${key}`, columns, cards }
}

async function transition(ctx: ProviderContext, cloudId: string, issueKey: string, statusId: string): Promise<void> {
  const { transitions } = await jira<{ transitions: Array<{ id: string; to: { id: string; name: string } }> }>(ctx, cloudId, `/issue/${issueKey}/transitions`)
  const t = transitions.find((x) => x.to.id === statusId)
  if (!t) throw new ProviderError(`Jira’s workflow doesn’t allow moving ${issueKey} to that status.`, 409, true)
  await jira(ctx, cloudId, `/issue/${issueKey}/transitions`, { method: 'POST', body: { transition: { id: t.id } } })
}

async function applyOp(ctx: ProviderContext, remoteId: string, op: SyncOp): Promise<SyncOpResult> {
  const { cloudId, key } = parseRemoteId(remoteId)
  const issueKey = (ref: { id: string; meta?: Record<string, string> }) => encodeURIComponent(ref.meta?.key ?? ref.id)
  switch (op.op) {
    case 'update': {
      const fields: Record<string, unknown> = {}
      if (op.title !== undefined) fields.summary = op.title
      if (op.description !== undefined) fields.description = textToAdf(op.description)
      await jira(ctx, cloudId, `/issue/${issueKey(op.ref)}`, { method: 'PUT', body: { fields } })
      return { ok: true }
    }
    case 'move':
      // Jira keeps its own rank; only status changes are pushed.
      if (op.columnChanged) await transition(ctx, cloudId, issueKey(op.ref), op.columnId)
      return { ok: true }
    case 'archive':
      return { ok: false, error: 'Archiving isn’t available for Jira. The card stays archived here only.', permanent: true }
    case 'create': {
      const project = await jira<{ issueTypes: Array<{ id: string; name: string; subtask: boolean }> }>(ctx, cloudId, `/project/${key}`)
      const types = project.issueTypes.filter((t) => !t.subtask)
      const type = types.find((t) => t.name === 'Task') ?? types.find((t) => t.name === 'Story') ?? types[0]
      if (!type) throw new ProviderError('This Jira project has no issue type to create cards with.', 422, true)
      const created = await jira<{ id: string; key: string }>(ctx, cloudId, '/issue', {
        method: 'POST',
        body: { fields: { project: { key }, summary: op.title || 'Untitled', issuetype: { id: type.id }, ...(op.description ? { description: textToAdf(op.description) } : {}) } },
      })
      const url = await siteUrl(ctx, cloudId)
      const ref = { provider: 'jira' as const, id: created.id, url: `${url}/browse/${created.key}`, key: created.key, meta: { key: created.key } }
      const issue = await jira<{ fields: { status: { id: string } } }>(ctx, cloudId, `/issue/${created.key}?fields=status`)
      if (issue.fields.status.id !== op.columnId) {
        try {
          await transition(ctx, cloudId, created.key, op.columnId)
        } catch {
          // Created in the workflow's first status; the next sync moves the card there.
        }
      }
      return { ok: true, ref }
    }
  }
}

async function tokenRequest(env: Env, body: Record<string, string>): Promise<TokenSet> {
  const res = await request<{ access_token: string; refresh_token?: string; expires_in?: number }>('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: env.JIRA_CLIENT_ID, client_secret: env.JIRA_CLIENT_SECRET, ...body }),
    label: 'Atlassian',
  })
  return { accessToken: res.access_token, refreshToken: res.refresh_token, expiresAt: res.expires_in ? Date.now() + res.expires_in * 1000 : undefined }
}

export const jiraAdapter: ProviderAdapter = {
  id: 'jira',
  boardNoun: 'project',
  flow: 'oauth2',
  isConfigured: (env: Env) => !!(env.JIRA_CLIENT_ID && env.JIRA_CLIENT_SECRET),
  authorizeUrl(env, redirectUri, state) {
    const q = new URLSearchParams({ audience: 'api.atlassian.com', client_id: env.JIRA_CLIENT_ID!, scope: SCOPES, redirect_uri: redirectUri, state, response_type: 'code', prompt: 'consent' })
    return `https://auth.atlassian.com/authorize?${q}`
  },
  exchangeCode: (env, code, redirectUri) => tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  refresh: (env, refreshToken) => tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refreshToken }),
  async account(_env, token) {
    const [me, resources] = await Promise.all([
      request<{ account_id: string; name: string; email?: string }>(`${API}/me`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, label: 'Atlassian' }),
      sites(token),
    ])
    return { id: me.account_id, name: me.name, meta: { sites: resources.map(({ id, url, name }) => ({ id, url, name })) } }
  },
  async listBoards(ctx): Promise<RemoteBoardSummary[]> {
    const list = await sites(ctx.token)
    const perSite = await Promise.all(
      list.map(async (site) => {
        const res = await jira<{ values: Array<{ key: string; name: string }> }>(ctx, site.id, '/project/search?maxResults=100&orderBy=name')
        return res.values.map((p) => ({ id: `${site.id}/${p.key}`, name: `${p.name} (${p.key})`, group: site.name, url: `${site.url}/browse/${p.key}` }))
      }),
    )
    return perSite.flat()
  },
  getBoard,
  applyOp: (ctx, remoteId, op) => settle(() => applyOp(ctx, remoteId, op)),
}
