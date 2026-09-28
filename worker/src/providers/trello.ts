import type { RemoteBoard, RemoteBoardSummary, RemoteCard, SyncOp, SyncOpResult } from '../../../src/integrations/protocol'
import type { Env } from '../env'
import { between, request, settle, type ProviderAdapter, type ProviderContext } from './types'

/**
 * Trello. Columns are the board's open lists, cards its open cards. Trello's
 * authorize page hands the token back in the URL fragment, so sign-in finishes
 * with a small page that posts it to the Worker (see auth.ts).
 */
const API = 'https://api.trello.com/1'

export const LABEL_COLORS: Record<string, string> = {
  green: '#4bce97',
  yellow: '#e2b203',
  orange: '#faa53d',
  red: '#f87462',
  purple: '#9f8fef',
  blue: '#579dff',
  sky: '#6cc3e0',
  lime: '#94c748',
  pink: '#e774bb',
  black: '#8590a2',
}

const labelColor = (c: string | null) => LABEL_COLORS[(c ?? '').replace(/_(light|dark)$/, '')] ?? '#8590a2'

function call<T>(ctx: ProviderContext, path: string, init: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  return request<T>(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `OAuth oauth_consumer_key="${ctx.env.TRELLO_API_KEY}", oauth_token="${ctx.token}"`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    label: 'Trello',
  })
}

interface TList {
  id: string
  name: string
  pos: number
}

interface TCard {
  id: string
  name: string
  desc: string
  idList: string
  pos: number
  due: string | null
  idLabels: string[]
  idMembers: string[]
  shortUrl: string
  idShort: number
}

interface TBoard {
  id: string
  name: string
  url: string
  lists: TList[]
  cards: TCard[]
  labels: Array<{ id: string; name: string; color: string | null }>
  members: Array<{ id: string; fullName: string; username: string; avatarUrl: string | null }>
}

export function mapBoard(b: TBoard): RemoteBoard {
  const lists = [...b.lists].sort((x, y) => x.pos - y.pos)
  const listIndex = new Map(lists.map((l, i) => [l.id, i]))
  const labels = new Map(b.labels.map((l) => [l.id, { id: l.id, name: l.name || l.color || 'label', color: labelColor(l.color) }]))
  const members = new Map(b.members.map((m) => [m.id, { id: m.id, name: m.fullName || m.username, avatarUrl: m.avatarUrl ? `${m.avatarUrl}/50.png` : undefined }]))
  const cards: RemoteCard[] = b.cards
    .filter((c) => listIndex.has(c.idList))
    .sort((x, y) => listIndex.get(x.idList)! - listIndex.get(y.idList)! || x.pos - y.pos)
    .map((c) => ({
      ref: { provider: 'trello', id: c.id, url: c.shortUrl, key: `#${c.idShort}` },
      title: c.name,
      description: c.desc ?? '',
      columnId: c.idList,
      labels: c.idLabels.map((id) => labels.get(id)).filter((l) => !!l),
      assignees: c.idMembers.map((id) => members.get(id)).filter((m) => !!m),
      dueDate: c.due ? c.due.slice(0, 10) : undefined,
    }))
  return { id: b.id, name: b.name, url: b.url, columns: lists.map((l) => ({ id: l.id, title: l.name })), cards }
}

async function getBoard(ctx: ProviderContext, remoteId: string): Promise<RemoteBoard> {
  const q = new URLSearchParams({
    fields: 'id,name,url',
    lists: 'open',
    list_fields: 'id,name,pos',
    cards: 'open',
    card_fields: 'id,name,desc,idList,pos,due,idLabels,idMembers,shortUrl,idShort',
    labels: 'all',
    label_fields: 'id,name,color',
    members: 'all',
    member_fields: 'id,fullName,username,avatarUrl',
  })
  return mapBoard(await call<TBoard>(ctx, `/boards/${encodeURIComponent(remoteId)}?${q}`))
}

/** A `pos` right after `afterId` in the list (Trello positions are floats). */
async function positionIn(ctx: ProviderContext, listId: string, afterId: string | null, movingId?: string): Promise<number | 'top' | 'bottom'> {
  if (!afterId) return 'top'
  const cards = (await call<Array<{ id: string; pos: number }>>(ctx, `/lists/${encodeURIComponent(listId)}/cards?fields=id,pos`)).filter((c) => c.id !== movingId).sort((a, b) => a.pos - b.pos)
  const i = cards.findIndex((c) => c.id === afterId)
  if (i < 0 || i === cards.length - 1) return 'bottom'
  return between(cards[i].pos, cards[i + 1].pos)
}

async function applyOp(ctx: ProviderContext, op: SyncOp): Promise<SyncOpResult> {
  switch (op.op) {
    case 'update':
      await call(ctx, `/cards/${encodeURIComponent(op.ref.id)}`, { method: 'PUT', body: { ...(op.title !== undefined ? { name: op.title } : {}), ...(op.description !== undefined ? { desc: op.description } : {}) } })
      return { ok: true }
    case 'move': {
      const pos = await positionIn(ctx, op.columnId, op.afterId, op.ref.id)
      await call(ctx, `/cards/${encodeURIComponent(op.ref.id)}`, { method: 'PUT', body: { idList: op.columnId, pos } })
      return { ok: true }
    }
    case 'archive':
      await call(ctx, `/cards/${encodeURIComponent(op.ref.id)}`, { method: 'PUT', body: { closed: op.archived } })
      return { ok: true }
    case 'create': {
      const pos = await positionIn(ctx, op.columnId, op.afterId)
      const card = await call<TCard>(ctx, '/cards', { method: 'POST', body: { idList: op.columnId, name: op.title || 'Untitled', desc: op.description, pos } })
      return { ok: true, ref: { provider: 'trello', id: card.id, url: card.shortUrl, key: `#${card.idShort}` } }
    }
  }
}

async function listBoards(ctx: ProviderContext): Promise<RemoteBoardSummary[]> {
  const boards = await call<Array<{ id: string; name: string; url: string; idOrganization: string | null; organization?: { displayName: string } }>>(
    ctx,
    '/members/me/boards?filter=open&fields=id,name,url,idOrganization&organization=true&organization_fields=displayName',
  )
  return boards.map((b) => ({ id: b.id, name: b.name, url: b.url, group: b.organization?.displayName ?? 'Personal' }))
}

export const trello: ProviderAdapter = {
  id: 'trello',
  boardNoun: 'board',
  flow: 'fragment',
  isConfigured: (env: Env) => !!env.TRELLO_API_KEY,
  authorizeUrl(env, redirectUri) {
    // `state` rides along in the return URL (see auth.ts).
    const q = new URLSearchParams({
      expiration: 'never',
      name: env.TRELLO_APP_NAME ?? 'Spatial Kanban',
      scope: 'read,write',
      response_type: 'token',
      key: env.TRELLO_API_KEY!,
      return_url: redirectUri,
      callback_method: 'fragment',
    })
    return `https://trello.com/1/authorize?${q}`
  },
  async account(env, token) {
    const me = await request<{ id: string; username: string; fullName: string }>(`${API}/members/me?fields=id,username,fullName`, {
      headers: { authorization: `OAuth oauth_consumer_key="${env.TRELLO_API_KEY}", oauth_token="${token}"`, accept: 'application/json' },
      label: 'Trello',
    })
    return { id: me.id, name: me.fullName || me.username }
  },
  listBoards,
  getBoard,
  applyOp: (ctx, _remoteId, op) => settle(() => applyOp(ctx, op)),
}
