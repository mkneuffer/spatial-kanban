import { produce } from 'immer'
import type { Board, BoardDoc, Card, Column, ExternalRef, ID, Label, LabelIcon, Person, ProviderId } from '../data/model'
import { cardsInColumn, keyForIndex, keysForCount } from '../data/ordering'
import type { ProviderCapabilities, RemoteBoard, RemoteCard, RemoteLabel, RemotePerson, SyncOp, SyncOpResult } from './protocol'

/**
 * Three-way sync between the local board, the remote board and a "shadow": the
 * remote state as of the last successful sync. For every field:
 *
 * - remote differs from the shadow → the remote changed, so it wins locally;
 * - otherwise local differs from the shadow → local changed, so it is pushed.
 *
 * A pull therefore makes the shadow equal to the remote snapshot, and pushing
 * is just the diff between the local board and the shadow. All of this is pure;
 * `engine.ts` does the I/O.
 */

/** The synced fields of one card. `column` is the remote column id. */
export interface ShadowCard {
  title: string
  description: string
  column: string | null
  archived: boolean
}

export interface ShadowColumn {
  id: string
  title: string
  color?: string
}

export interface SyncShadow {
  version: 1
  provider: ProviderId
  remoteId: string
  cards: Record<string, ShadowCard>
  /** Remote column id → live remote card ids, in board order. */
  order: Record<string, string[]>
  columns: ShadowColumn[]
}

export function emptyShadow(provider: ProviderId, remoteId: string): SyncShadow {
  return { version: 1, provider, remoteId, cards: {}, order: {}, columns: [] }
}

/** A push operation plus how to record it in the shadow once it lands. */
export interface PlannedOp {
  op: SyncOp
  /** Card id (remote) whose shadow entry the op updates; for creates, the local card id. */
  target: string
  /** Shadow fields to record on success. */
  fields?: Partial<ShadowCard>
  /** Column orders to record on success (snapshotted when planned). */
  order?: Record<string, string[]>
}

export interface SyncPlan {
  /** The local board after taking remote changes (same object when nothing changed). */
  next: BoardDoc
  shadow: SyncShadow
  ops: PlannedOp[]
  /**
   * Cards missing locally that were *not* archived remotely because so many
   * went missing at once that it looks like the board was replaced, not edited.
   */
  heldDeletes: number
}

export interface PlanOptions {
  caps: ProviderCapabilities
  now: string
  newId: () => string
  /** Local cards not to create remotely (a create is in flight or already failed). */
  skipCreate?: (localId: ID) => boolean
  /**
   * Remote cards changed by this device moments ago. Some APIs (Jira's search)
   * lag behind writes, so a pull leaves these alone rather than trusting a stale read.
   */
  settling?: ReadonlySet<string>
}

// ——— state extraction ———

function refOf(card: Card, provider: ProviderId): ExternalRef | undefined {
  return card.externalRef?.provider === provider ? card.externalRef : undefined
}

function remoteColumnOf(doc: BoardDoc, card: Card): string | null {
  return doc.columns[card.columnId]?.externalId ?? null
}

export function localCardState(doc: BoardDoc, card: Card): ShadowCard {
  return { title: card.title, description: card.description ?? '', column: remoteColumnOf(doc, card), archived: card.archived }
}

/** Remote card id → local card, for cards linked to this provider. */
export function linkedCards(doc: BoardDoc, provider: ProviderId): Map<string, Card> {
  const map = new Map<string, Card>()
  for (const id in doc.cards) {
    const ref = refOf(doc.cards[id], provider)
    if (ref) map.set(ref.id, doc.cards[id])
  }
  return map
}

/** Remote column id → live linked remote card ids in local board order. */
export function localOrder(doc: BoardDoc, provider: ProviderId): Record<string, string[]> {
  const order: Record<string, string[]> = {}
  for (const columnId of doc.board.columnIds) {
    const ext = doc.columns[columnId]?.externalId
    if (!ext) continue
    order[ext] = cardsInColumn(doc.cards, columnId)
      .map((c) => refOf(c, provider)?.id)
      .filter((id): id is string => !!id)
  }
  return order
}

function remoteCardState(card: RemoteCard): ShadowCard {
  return { title: card.title, description: card.description, column: card.columnId, archived: false }
}

function remoteOrder(remote: RemoteBoard): Record<string, string[]> {
  const order: Record<string, string[]> = Object.fromEntries(remote.columns.map((c) => [c.id, [] as string[]]))
  for (const card of remote.cards) order[card.columnId]?.push(card.ref.id)
  return order
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => x === b![i])

// ——— remote → local field mapping ———

const LABEL_ICONS: Array<[RegExp, LabelIcon]> = [
  [/bug|defect|fix|error|crash/i, 'bug'],
  [/feat|enhance|improve|idea|story/i, 'star'],
  [/design|ui|ux|visual/i, 'brush'],
  [/doc|writing|content/i, 'book'],
  [/perf|speed|fast|urgent|critical|blocker/i, 'bolt'],
  [/priority|important|p[0-2]\b/i, 'flag'],
]

export function labelIcon(name: string): LabelIcon {
  return LABEL_ICONS.find(([re]) => re.test(name))?.[1] ?? 'dot'
}

export const remoteLabelId = (provider: ProviderId, id: string) => `${provider}:${id}`

function toLabel(provider: ProviderId, l: RemoteLabel): Label {
  return { id: remoteLabelId(provider, l.id), name: l.name, color: l.color, icon: labelIcon(l.name) }
}

/** A stable, readable avatar color for a remote person without one. */
export function personColor(seed: string): string {
  const palette = ['#8250df', '#1a7f37', '#bf3989', '#0969da', '#9a6700', '#cf222e', '#0550ae', '#6e7781']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

function toPerson(provider: ProviderId, p: RemotePerson): Person {
  const id = `${provider}:${p.id}`
  return { id, name: p.name, avatarUrl: p.avatarUrl, color: personColor(id) }
}

const json = (v: unknown) => JSON.stringify(v ?? null)

/** Fields that always come from the remote (they are not pushed back). */
function applyRemoteMeta(card: Card, rc: RemoteCard, provider: ProviderId): void {
  const labelIds = rc.labels.map((l) => remoteLabelId(provider, l.id))
  // Local-only labels stay on the card; remote labels mirror the remote.
  const kept = card.labelIds.filter((id) => !id.startsWith(`${provider}:`))
  const nextLabels = [...kept, ...labelIds]
  if (json(nextLabels) !== json(card.labelIds)) card.labelIds = nextLabels
  const assignees = rc.assignees.map((p) => toPerson(provider, p))
  if (json(assignees) !== json(card.assignees)) card.assignees = assignees
  if ((rc.dueDate ?? undefined) !== card.dueDate) card.dueDate = rc.dueDate
  if (json(rc.ref) !== json(card.externalRef)) card.externalRef = rc.ref
}

/**
 * Put the linked cards of one local column in the remote order, keeping
 * local-only cards (and linked cards the remote doesn't list here) in their slots.
 */
function reorderColumn(draft: BoardDoc, localColumnId: ID, remoteIds: string[], provider: ProviderId): void {
  const current = cardsInColumn(draft.cards, localColumnId)
  const byRemote = new Map<string, Card>()
  for (const c of current) {
    const ref = refOf(c, provider)
    if (ref) byRemote.set(ref.id, c)
  }
  const queue = remoteIds.map((id) => byRemote.get(id)).filter((c): c is Card => !!c)
  const slotted = new Set(queue)
  let q = 0
  const result = current.map((c) => (slotted.has(c) ? queue[q++] : c))
  if (result.every((c, i) => c === current[i])) return
  const keys = keysForCount(result.length)
  result.forEach((c, i) => {
    if (c.orderKey !== keys[i]) c.orderKey = keys[i]
  })
}

// ——— pull ———

function pull(doc: BoardDoc, shadow: SyncShadow, remote: RemoteBoard, opts: PlanOptions): BoardDoc {
  const provider = shadow.provider
  return produce(doc, (draft) => {
    const board = draft.board
    const now = opts.now

    // Columns: the remote owns which columns exist; titles, colors and order
    // follow the remote whenever it changed them.
    const byExt = new Map<string, Column>()
    for (const id of board.columnIds) {
      const col = draft.columns[id]
      if (!col?.externalId) continue
      // Two local columns for one remote column (e.g. an edited import): keep the first linked.
      if (byExt.has(col.externalId)) delete col.externalId
      else byExt.set(col.externalId, col)
    }
    const shadowCols = new Map(shadow.columns.map((c) => [c.id, c]))
    const remoteColIds = new Set(remote.columns.map((c) => c.id))
    for (const rc of remote.columns) {
      const local = byExt.get(rc.id)
      if (!local) {
        const column: Column = { id: opts.newId(), boardId: board.id, title: rc.title, color: rc.color, externalId: rc.id }
        draft.columns[column.id] = column
        board.columnIds.push(column.id)
        byExt.set(rc.id, draft.columns[column.id])
        continue
      }
      const s = shadowCols.get(rc.id) ?? { id: rc.id, title: local.title, color: local.color }
      if (rc.title !== s.title && local.title !== rc.title) local.title = rc.title
      if (rc.color !== s.color && local.color !== rc.color) local.color = rc.color
    }
    // A column deleted remotely stays as a local-only column.
    for (const [ext, col] of byExt) {
      if (!remoteColIds.has(ext)) {
        delete col.externalId
        byExt.delete(ext)
      }
    }
    const remoteColOrder = remote.columns.map((c) => c.id)
    const shadowColOrder = shadow.columns.length ? shadow.columns.map((c) => c.id) : null
    const localColOrder = board.columnIds.map((id) => draft.columns[id].externalId).filter((x): x is string => !!x)
    if (!sameList(remoteColOrder, shadowColOrder ?? localColOrder)) {
      const queue = remoteColOrder.map((ext) => byExt.get(ext)!.id)
      let q = 0
      const ids = board.columnIds.map((id) => (draft.columns[id].externalId ? (queue[q++] ?? id) : id))
      if (!sameList(ids, board.columnIds)) board.columnIds = ids
    }

    // Labels: upsert the remote ones (they're referenced as `provider:id`).
    for (const rc of remote.cards) {
      for (const l of rc.labels) {
        const label = toLabel(provider, l)
        const i = board.labels.findIndex((x) => x.id === label.id)
        if (i < 0) board.labels.push(label)
        else if (board.labels[i].name !== label.name || board.labels[i].color !== label.color) board.labels[i] = label
      }
    }

    // Cards.
    const linked = linkedCards(draft, provider)
    const remoteById = new Map(remote.cards.map((c) => [c.ref.id, c]))
    const rOrder = remoteOrder(remote)
    const touchedColumns = new Set<string>()
    const localColumn = (ext: string | null) => (ext ? byExt.get(ext)?.id : undefined)

    const mergeCard = (card: Card, s: ShadowCard, r: ShadowCard, rc: RemoteCard | undefined) => {
      let changed = false
      if (r.title !== s.title && card.title !== r.title) ((card.title = r.title), (changed = true))
      if (r.description !== s.description && (card.description ?? '') !== r.description) ((card.description = r.description || undefined), (changed = true))
      if (r.column !== s.column) {
        const col = localColumn(r.column)
        if (col && card.columnId !== col) {
          card.columnId = col
          card.orderKey = keyForIndex(cardsInColumn(draft.cards, col, card.id), Infinity)
          changed = true
        }
      }
      if (r.archived !== s.archived && card.archived !== r.archived) {
        card.archived = r.archived
        if (!r.archived) card.orderKey = keyForIndex(cardsInColumn(draft.cards, card.columnId, card.id), Infinity)
        changed = true
      }
      if (rc) {
        const before = json([card.labelIds, card.assignees, card.dueDate, card.externalRef])
        applyRemoteMeta(card, rc, provider)
        if (json([card.labelIds, card.assignees, card.dueDate, card.externalRef]) !== before) changed = true
      }
      if (changed) card.updatedAt = now
    }

    for (const rc of remote.cards) {
      const col = localColumn(rc.columnId)
      if (!col) continue
      const r = remoteCardState(rc)
      const card = linked.get(rc.ref.id)
      const s = shadow.cards[rc.ref.id]
      if (card && opts.settling?.has(rc.ref.id)) continue
      if (card) {
        mergeCard(card, s ?? localCardState(draft, card), r, rc)
        continue
      }
      // Not on the local board. Recreate it unless it was deleted here and the
      // remote hasn't changed it since.
      if (s && json(s) === json(r)) continue
      const created: Card = {
        id: opts.newId(),
        boardId: board.id,
        columnId: col,
        orderKey: keyForIndex(cardsInColumn(draft.cards, col), Infinity),
        title: rc.title,
        description: rc.description || undefined,
        labelIds: [],
        assignees: [],
        archived: false,
        createdAt: now,
        updatedAt: now,
      }
      applyRemoteMeta(created, rc, provider)
      draft.cards[created.id] = created
      touchedColumns.add(rc.columnId)
    }

    // Linked cards the remote no longer lists were archived or deleted there.
    for (const [rid, card] of linked) {
      if (remoteById.has(rid) || opts.settling?.has(rid)) continue
      const s = shadow.cards[rid] ?? localCardState(draft, card)
      mergeCard(card, s, { ...s, archived: true }, undefined)
    }

    // Order: follow the remote in every column whose remote order changed.
    const lOrder = localOrder(doc, provider)
    for (const ext of remoteColOrder) {
      const base = shadow.columns.length ? shadow.order[ext] : lOrder[ext]
      if (touchedColumns.has(ext) || !sameList(rOrder[ext], base)) reorderColumn(draft, byExt.get(ext)!.id, rOrder[ext], provider)
    }
  })
}

/** The shadow after a successful pull: the remote snapshot (settling cards keep what was pushed). */
function shadowFromRemote(shadow: SyncShadow, remote: RemoteBoard, settling?: ReadonlySet<string>): SyncShadow {
  const cards: Record<string, ShadowCard> = {}
  // Cards the remote no longer lists are remembered as archived, so a local
  // copy that was deleted isn't resurrected unless the remote changes it.
  for (const id in shadow.cards) cards[id] = { ...shadow.cards[id], archived: true }
  const columns = new Set(remote.columns.map((c) => c.id))
  for (const rc of remote.cards) if (columns.has(rc.columnId)) cards[rc.ref.id] = remoteCardState(rc)
  for (const id of settling ?? []) if (shadow.cards[id]) cards[id] = shadow.cards[id]
  return {
    ...shadow,
    cards,
    order: remoteOrder(remote),
    columns: remote.columns.map((c) => ({ id: c.id, title: c.title, color: c.color })),
  }
}

// ——— push ———

/** Indices (into `seq`) of a longest strictly increasing subsequence. */
function lisIndices(seq: number[]): Set<number> {
  const tails: number[] = []
  const prev = new Array<number>(seq.length).fill(-1)
  for (let i = 0; i < seq.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (seq[tails[mid]] < seq[i]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  }
  const out = new Set<number>()
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.add(i)
  return out
}

/** Local deletions pushed in one go before they look like a replaced board. */
const MAX_DELETES = 3
const MAX_DELETE_SHARE = 0.25

function planPush(doc: BoardDoc, shadow: SyncShadow, opts: PlanOptions): { ops: PlannedOp[]; heldDeletes: number } {
  const provider = shadow.provider
  const { caps } = opts
  const ops: PlannedOp[] = []
  const linked = linkedCards(doc, provider)
  const lOrder = localOrder(doc, provider)

  // Edits and archiving.
  for (const [rid, card] of linked) {
    const s = shadow.cards[rid]
    if (!s) continue
    const l = localCardState(doc, card)
    const ref = card.externalRef!
    if (caps.edit && (l.title !== s.title || l.description !== s.description)) {
      const op: SyncOp = { op: 'update', ref }
      if (l.title !== s.title) op.title = l.title
      if (l.description !== s.description) op.description = l.description
      ops.push({ op, target: rid, fields: { title: l.title, description: l.description } })
    }
    if (caps.archive && l.archived !== s.archived) {
      const cols = [s.column, l.column].filter((c): c is string => !!c)
      ops.push({ op: { op: 'archive', ref, archived: l.archived }, target: rid, fields: { archived: l.archived }, order: pick(lOrder, cols) })
    }
  }
  // A linked card deleted locally is archived remotely (never deleted).
  let heldDeletes = 0
  if (caps.archive) {
    const deletes: PlannedOp[] = []
    let live = 0
    for (const rid in shadow.cards) {
      const s = shadow.cards[rid]
      if (s.archived) continue
      live++
      if (linked.has(rid)) continue
      const order = s.column ? { [s.column]: (shadow.order[s.column] ?? []).filter((id) => id !== rid) } : undefined
      deletes.push({ op: { op: 'archive', ref: { provider, id: rid }, archived: true }, target: rid, fields: { archived: true }, order })
    }
    if (deletes.length > MAX_DELETES && deletes.length > live * MAX_DELETE_SHARE) heldDeletes = deletes.length
    else ops.push(...deletes)
  }

  // Moves: cards that changed column, plus a minimal set of reordered cards
  // (those outside the longest run that kept its relative order).
  for (const ext in lOrder) {
    const seq = lOrder[ext]
    const shadowSeq = shadow.order[ext] ?? []
    const shadowIndex = new Map(shadowSeq.map((id, i) => [id, i]))
    const stayed = seq.map((rid, i) => ({ rid, i })).filter(({ rid }) => shadow.cards[rid]?.column === ext && shadowIndex.has(rid))
    const keep = lisIndices(stayed.map(({ rid }) => shadowIndex.get(rid)!))
    const reordered = new Set(stayed.filter((_, k) => !keep.has(k)).map(({ rid }) => rid))
    seq.forEach((rid, i) => {
      const s = shadow.cards[rid]
      // A card restored locally is un-archived by its archive op, then placed here.
      if (!s || (s.archived && !caps.archive)) return
      const columnChanged = s.column !== ext
      if (columnChanged ? !caps.move : !(caps.reorder && reordered.has(rid))) return
      const cols = [ext, ...(s.column && columnChanged ? [s.column] : [])]
      ops.push({
        op: { op: 'move', ref: linked.get(rid)!.externalRef!, columnId: ext, afterId: seq[i - 1] ?? null, beforeId: seq[i + 1] ?? null, columnChanged },
        target: rid,
        fields: { column: ext },
        order: pick(lOrder, cols),
      })
    })
  }

  // New local cards in linked columns.
  if (caps.create) {
    for (const columnId of doc.board.columnIds) {
      const ext = doc.columns[columnId]?.externalId
      if (!ext) continue
      let afterId: string | null = null
      for (const card of cardsInColumn(doc.cards, columnId)) {
        const ref = refOf(card, provider)
        if (ref) {
          afterId = ref.id
          continue
        }
        if (card.externalRef || opts.skipCreate?.(card.id)) continue
        ops.push({
          op: { op: 'create', localId: card.id, columnId: ext, title: card.title, description: card.description ?? '', afterId },
          target: card.id,
        })
      }
    }
  }
  return { ops, heldDeletes }
}

function pick(order: Record<string, string[]>, keys: string[]): Record<string, string[]> {
  return Object.fromEntries(keys.map((k) => [k, order[k] ?? []]))
}

/** Plan one sync cycle. Pass `remote: null` for a push-only cycle. */
export function planSync(doc: BoardDoc, shadow: SyncShadow, remote: RemoteBoard | null, opts: PlanOptions): SyncPlan {
  const next = remote ? pull(doc, shadow, remote, opts) : doc
  const nextShadow = remote ? shadowFromRemote(shadow, remote, opts.settling) : shadow
  return { next, shadow: nextShadow, ...planPush(next, nextShadow, opts) }
}

/**
 * Record a finished op in the shadow. Successes and permanent failures are both
 * recorded as the local value: after a refusal the next pull sees the remote
 * differ from the shadow, so the remote value is restored locally.
 */
export function commitOp(shadow: SyncShadow, planned: PlannedOp, result: SyncOpResult): SyncShadow {
  if (!result.ok && !result.permanent) return shadow
  const { op } = planned
  if (op.op === 'create') {
    if (!result.ok || !result.ref) return shadow
    const rid = result.ref.id
    const seq = [...(shadow.order[op.columnId] ?? [])]
    const at = op.afterId ? seq.indexOf(op.afterId) + 1 : 0
    seq.splice(at, 0, rid)
    return {
      ...shadow,
      cards: { ...shadow.cards, [rid]: { title: op.title, description: op.description, column: op.columnId, archived: false } },
      order: { ...shadow.order, [op.columnId]: seq },
    }
  }
  const prev = shadow.cards[planned.target]
  return {
    ...shadow,
    cards: prev ? { ...shadow.cards, [planned.target]: { ...prev, ...planned.fields } } : shadow.cards,
    order: planned.order ? { ...shadow.order, ...planned.order } : shadow.order,
  }
}

// ——— import ———

/** A new local board mirroring a remote board, plus its initial shadow. */
export function boardFromRemote(provider: ProviderId, remote: RemoteBoard, opts: { now: string; newId: () => string }): { doc: BoardDoc; shadow: SyncShadow } {
  const boardId = opts.newId()
  const board: Board = {
    id: boardId,
    title: remote.name,
    columnIds: [],
    labels: [],
    createdAt: opts.now,
    updatedAt: opts.now,
    integration: { provider, remoteId: remote.id, name: remote.name, url: remote.url },
  }
  const empty: BoardDoc = { board, columns: {}, cards: {} }
  const shadow = emptyShadow(provider, remote.id)
  // Pulling into an empty board creates the columns and cards in remote order.
  const plan = planSync(empty, shadow, remote, { caps: { create: false, edit: false, move: false, reorder: false, archive: false }, now: opts.now, newId: opts.newId })
  return { doc: plan.next, shadow: plan.shadow }
}