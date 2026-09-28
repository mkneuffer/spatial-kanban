import type { BoardAction } from '../data/actions'
import { syncDiff } from '../data/actions'
import type { BoardDoc, BoardIntegration, ID } from '../data/model'
import { ulid } from '../data/ids'
import { PROVIDER_CAPABILITIES, PROVIDER_NAMES, type OpsResponse, type RemoteBoard, type SyncOp } from './protocol'
import { commitOp, emptyShadow, planSync, type SyncShadow } from './sync'
import type { SyncStatus } from './store'

export const POLL_MS = 30_000
const PUSH_DEBOUNCE_MS = 600
/** How long a pull leaves a just-pushed card alone (see `PlanOptions.settling`). */
const SETTLE_MS = 20_000

export interface EngineDeps {
  getDoc(): BoardDoc
  dispatch(action: BoardAction): void
  /** Subscribe to committed board changes; returns an unsubscribe function. */
  onChange(fn: (action?: BoardAction) => void): () => void
  loadShadow(boardId: ID): Promise<SyncShadow | null>
  saveShadow(boardId: ID, shadow: SyncShadow): Promise<void>
  fetchBoard(integration: BoardIntegration): Promise<RemoteBoard>
  pushOps(integration: BoardIntegration, ops: SyncOp[]): Promise<OpsResponse>
  onStatus(status: SyncStatus, info?: { error?: string; lastSyncedAt?: string }): void
  notify(message: string): void
  /** `true` while the page is visible and online; polling pauses otherwise. */
  isActive(): boolean
  /** Keep a new card local for now (e.g. it's still being written, and may be discarded). */
  holdCreate?(localId: ID): boolean
}

/**
 * Keeps one linked board in sync: pulls on start, on an interval and when the
 * page comes back; pushes local changes shortly after they happen. Cycles run
 * one at a time, and each plans against the board as it is when the remote
 * snapshot arrives, so edits made during a request are never lost.
 */
export class SyncEngine {
  private shadow: SyncShadow | null = null
  private stopped = false
  private running = false
  private wantPull = false
  private wantPush = false
  private pushTimer: ReturnType<typeof setTimeout> | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private unsubscribe: (() => void) | undefined
  private inflightCreates = new Set<ID>()
  private failedCreates = new Set<ID>()
  /** Remote card id → time until which pulls leave it alone. */
  private settling = new Map<string, number>()
  private lastError: string | undefined
  private warnedDeletes = false
  /** Resolves when the current run of cycles finishes (for tests). */
  idle: Promise<void> = Promise.resolve()

  constructor(
    readonly boardId: ID,
    readonly integration: BoardIntegration,
    private deps: EngineDeps,
  ) {}

  async start(): Promise<void> {
    const saved = await this.deps.loadShadow(this.boardId)
    if (this.stopped) return
    this.shadow = saved && saved.provider === this.integration.provider && saved.remoteId === this.integration.remoteId ? saved : emptyShadow(this.integration.provider, this.integration.remoteId)
    this.unsubscribe = this.deps.onChange((action) => {
      if (action?.type !== 'sync/apply') this.requestPush()
    })
    this.pollTimer = setInterval(() => this.deps.isActive() && this.requestPull(), POLL_MS)
    this.requestPull()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.pushTimer)
    clearInterval(this.pollTimer)
    this.unsubscribe?.()
  }

  requestPull(): void {
    this.wantPull = true
    this.kick()
  }

  requestPush(): void {
    clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined
      this.wantPush = true
      this.kick()
    }, PUSH_DEBOUNCE_MS)
  }

  /** Push immediately (e.g. when the page is being hidden). */
  flush(): void {
    if (this.pushTimer === undefined) return
    clearTimeout(this.pushTimer)
    this.pushTimer = undefined
    this.wantPush = true
    this.kick()
  }

  private kick() {
    if (this.running || this.stopped || !this.shadow) return
    this.running = true
    this.idle = this.loop().finally(() => (this.running = false))
  }

  private async loop() {
    while (!this.stopped && (this.wantPull || this.wantPush)) {
      const pull = this.wantPull
      this.wantPull = this.wantPush = false
      await this.cycle(pull)
    }
  }

  private isCurrent(doc: BoardDoc) {
    const i = doc.board.integration
    return !this.stopped && doc.board.id === this.boardId && i?.provider === this.integration.provider && i.remoteId === this.integration.remoteId
  }

  private async cycle(pull: boolean) {
    const { deps } = this
    if (!this.isCurrent(deps.getDoc())) return
    let remote: RemoteBoard | null = null
    if (pull) {
      deps.onStatus('syncing')
      try {
        remote = await deps.fetchBoard(this.integration)
      } catch (err) {
        this.fail(err as Error)
        return
      }
    }
    const doc = deps.getDoc()
    if (!this.isCurrent(doc)) return

    const now = Date.now()
    for (const [id, until] of this.settling) if (until <= now) this.settling.delete(id)
    const plan = planSync(doc, this.shadow!, remote, {
      settling: new Set(this.settling.keys()),
      caps: PROVIDER_CAPABILITIES[this.integration.provider],
      now: new Date().toISOString(),
      newId: ulid,
      skipCreate: (id) => this.inflightCreates.has(id) || this.failedCreates.has(id) || !!deps.holdCreate?.(id),
    })
    this.shadow = plan.shadow
    const diff = syncDiff(doc, plan.next)
    if (diff) deps.dispatch(diff)
    if (plan.heldDeletes && !this.warnedDeletes) {
      this.warnedDeletes = true
      deps.notify(`${plan.heldDeletes} cards are missing from this board, so they weren’t archived in ${PROVIDER_NAMES[this.integration.provider]}. Archive them there if that was intended.`)
    }

    let refused = false
    if (plan.ops.length) {
      if (!pull) deps.onStatus('syncing')
      const creates = plan.ops.filter((p) => p.op.op === 'create').map((p) => p.target)
      creates.forEach((id) => this.inflightCreates.add(id))
      let response: OpsResponse
      try {
        response = await deps.pushOps(this.integration, plan.ops.map((p) => p.op))
      } catch (err) {
        creates.forEach((id) => this.inflightCreates.delete(id))
        this.fail(err as Error)
        return
      }
      const errors = new Set<string>()
      const linked: BoardDoc['cards'][string][] = []
      plan.ops.forEach((planned, i) => {
        const result = response.results[i] ?? { ok: false, error: 'No response', permanent: false }
        this.shadow = commitOp(this.shadow!, planned, result)
        if (!result.ok) {
          errors.add(result.error)
          if (result.permanent) refused = true
        } else {
          const rid = planned.op.op === 'create' ? result.ref?.id : planned.target
          if (rid) this.settling.set(rid, Date.now() + SETTLE_MS)
        }
        if (planned.op.op !== 'create') return
        this.inflightCreates.delete(planned.target)
        if (result.ok && result.ref) {
          const card = deps.getDoc().cards[planned.target]
          if (card) linked.push({ ...card, externalRef: result.ref })
        } else if (!result.ok && result.permanent) this.failedCreates.add(planned.target)
      })
      if (linked.length && this.isCurrent(deps.getDoc())) deps.dispatch({ type: 'sync/apply', cards: linked })
      for (const e of errors) deps.notify(`${PROVIDER_NAMES[this.integration.provider]}: ${e}`)
    }

    await deps.saveShadow(this.boardId, this.shadow!).catch(() => undefined)
    this.lastError = undefined
    deps.onStatus('synced', pull ? { lastSyncedAt: new Date().toISOString() } : undefined)
    // A refused change is restored from the remote right away.
    if (refused) this.wantPull = true
  }

  private fail(err: Error & { status?: number; code?: string }) {
    const needsAuth = err.code === 'not_connected' || err.status === 401
    const offline = err.code === 'unavailable'
    this.deps.onStatus(needsAuth ? 'needs-auth' : offline ? 'offline' : 'error', { error: err.message })
    if (err.message !== this.lastError && !offline) {
      this.deps.notify(needsAuth ? `Reconnect ${PROVIDER_NAMES[this.integration.provider]} to keep this board in sync.` : `Sync failed: ${err.message}`)
    }
    this.lastError = err.message
  }
}
