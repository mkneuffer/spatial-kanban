import { SNIPPET } from './snippet'

/**
 * Shared state for the workstation windows. Every window (tab) is one monitor
 * of the same fictional dev session: an editor, a terminal, a live preview, the
 * pull request, and the team's board. They stay in step over a
 * BroadcastChannel, so each can sit on its own screen.
 *
 * The state is small and replicated: each change bumps a version and is
 * broadcast whole; a window keeps the newest version it has seen. Step timing
 * is derived from timestamps (Date.now() is shared by every tab on a machine),
 * so no window has to stay open to "finish" a step.
 */

export const ROLES = ['editor', 'terminal', 'preview', 'pr', 'board'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_INFO: Record<Role, { title: string; blurb: string; icon: string }> = {
  editor: { title: 'Editor', blurb: 'nvim with the file tree. Any key types the code.', icon: '✎' },
  terminal: { title: 'Terminal', blurb: 'Dev server, hot reload, tests, then commit → push → PR.', icon: '›_' },
  preview: { title: 'Preview', blurb: 'localhost:5173 — the scene builds itself as the code is typed.', icon: '◉' },
  pr: { title: 'Pull request', blurb: 'The diff, CI checks, review and merge.', icon: '⇄' },
  board: { title: 'Board', blurb: 'The ticket moving across the team board, and the activity feed.', icon: '▦' },
}

export const BRANCH = 'feat/signal-beacon'
export const FILE = 'src/scene/beacon.ts'
export const COMMIT_MSG = 'feat: add glowing signal beacon'
export const REPO = 'github.com/example/workspace'
export const PR_NUMBER = 18
export const TICKET = { key: 'SK-42', title: 'Add a glowing signal beacon' }

/** How long each step runs (ms). */
export const DURATION = { commit: 2600, push: 3600, pr: 3200, checks: 9000, review: 2500 }

export const CHECKS = [
  { name: 'build', label: 'Build', at: 0.15 },
  { name: 'unit', label: 'Unit tests · 182 passed', at: 0.45 },
  { name: 'xr', label: 'XR emulator e2e', at: 0.75 },
  { name: 'preview', label: 'Preview deploy', at: 1 },
] as const

export interface FeedItem {
  t: number
  who: string
  text: string
}

export interface WorkState {
  /** Version for last-writer-wins replication. */
  v: number
  /** Characters of SNIPPET typed so far. */
  typed: number
  startedAt?: number
  savedAt?: number
  /** Chars typed at the last save (the preview and diff show saved code). */
  savedTyped: number
  commitAt?: number
  pushAt?: number
  prAt?: number
  mergedAt?: number
  feed: FeedItem[]
}

export const initialState = (): WorkState => ({ v: 0, typed: 0, savedTyped: 0, feed: [] })

type Listener = (s: WorkState, prev: WorkState) => void

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sk-workstation') : null
const myId = Math.random().toString(36).slice(2, 8)
let state: WorkState = load() ?? initialState()
const listeners = new Set<Listener>()
const peers = new Map<string, { role: string; seen: number }>()
let myRole = 'launcher'

function load(): WorkState | null {
  try {
    const raw = sessionStorage.getItem('sk-workstation')
    return raw ? (JSON.parse(raw) as WorkState) : null
  } catch {
    return null
  }
}

function persist() {
  try {
    sessionStorage.setItem('sk-workstation', JSON.stringify(state))
  } catch {
    // Not important: a reload just asks the other windows for the state.
  }
}

function apply(next: WorkState) {
  const prev = state
  state = next
  persist()
  listeners.forEach((fn) => fn(state, prev))
}

type Message =
  | { kind: 'state'; from: string; state: WorkState }
  | { kind: 'hello'; from: string; role: string }
  | { kind: 'here'; from: string; role: string }
  | { kind: 'bye'; from: string }
  | { kind: 'focus'; from: string; role: string }

function post(m: Message) {
  channel?.postMessage(m)
}

channel?.addEventListener('message', (ev: MessageEvent<Message>) => {
  const m = ev.data
  if (m.from === myId) return
  if (m.kind === 'state') {
    // Newest version wins; a reset (v: 0 → fresh) is sent with a higher version too.
    if (m.state.v > state.v) apply(m.state)
  } else if (m.kind === 'hello' || m.kind === 'here') {
    peers.set(m.from, { role: m.role, seen: Date.now() })
    if (m.kind === 'hello') {
      post({ kind: 'here', from: myId, role: myRole })
      // Bring the newcomer up to date.
      if (state.v > 0) post({ kind: 'state', from: myId, state })
    }
    peerListeners.forEach((fn) => fn())
  } else if (m.kind === 'bye') {
    peers.delete(m.from)
    peerListeners.forEach((fn) => fn())
  } else if (m.kind === 'focus') {
    focusListeners.forEach((fn) => fn(m.role))
  }
})

const peerListeners = new Set<() => void>()
const focusListeners = new Set<(role: string) => void>()

/** Join the session as `role`: announce, keep a heartbeat, and say goodbye on close. */
export function join(role: string) {
  myRole = role
  post({ kind: 'hello', from: myId, role })
  setInterval(() => {
    post({ kind: 'here', from: myId, role })
    const now = Date.now()
    let changed = false
    for (const [id, p] of peers) if (now - p.seen > 5000) changed = peers.delete(id) || changed
    if (changed) peerListeners.forEach((fn) => fn())
  }, 2000)
  window.addEventListener('pagehide', () => post({ kind: 'bye', from: myId }))
  window.addEventListener('focus', () => post({ kind: 'focus', from: myId, role }))
}

export function getState() {
  return state
}

export function subscribe(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function onPeers(fn: () => void) {
  peerListeners.add(fn)
  return () => peerListeners.delete(fn)
}

/** Another window got focus (the person moved to that monitor). */
export function onFocusElsewhere(fn: (role: string) => void) {
  focusListeners.add(fn)
  return () => focusListeners.delete(fn)
}

export function peerRoles(): string[] {
  return [...peers.values()].map((p) => p.role)
}

export function update(change: Partial<WorkState> | ((s: WorkState) => Partial<WorkState>), feed?: Omit<FeedItem, 't'>) {
  const c = typeof change === 'function' ? change(state) : change
  const next: WorkState = { ...state, ...c, v: state.v + 1 }
  if (feed) next.feed = [...state.feed, { ...feed, t: Date.now() }].slice(-40)
  apply(next)
  post({ kind: 'state', from: myId, state: next })
}

export function reset() {
  update(initialState())
}

// ─── derived ──────────────────────────────────────────────────────────────────

export type Stage = 'idle' | 'typing' | 'saved' | 'committing' | 'committed' | 'pushing' | 'pushed' | 'opening' | 'checks' | 'approved' | 'merged'

export function stage(s: WorkState, now = Date.now()): Stage {
  if (s.mergedAt) return 'merged'
  if (s.prAt) {
    const t = now - s.prAt
    if (t < DURATION.pr) return 'opening'
    if (t < DURATION.pr + DURATION.checks + DURATION.review) return 'checks'
    return 'approved'
  }
  if (s.pushAt) return now - s.pushAt < DURATION.push ? 'pushing' : 'pushed'
  if (s.commitAt) return now - s.commitAt < DURATION.commit ? 'committing' : 'committed'
  if (s.savedAt && s.savedTyped === s.typed && s.typed > 0) return 'saved'
  if (s.typed > 0) return 'typing'
  return 'idle'
}

/** 0..1 progress through CI (after the PR opens). */
export function checksProgress(s: WorkState, now = Date.now()) {
  if (!s.prAt) return 0
  return Math.max(0, Math.min(1, (now - s.prAt - DURATION.pr) / DURATION.checks))
}

/** What Enter does next, from any window. */
export function advance() {
  const s = state
  switch (stage(s)) {
    case 'typing':
      update({ savedAt: Date.now(), savedTyped: s.typed }, { who: 'you', text: `saved ${FILE}` })
      break
    case 'saved':
      update({ commitAt: Date.now() }, { who: 'you', text: `committed "${COMMIT_MSG}"` })
      break
    case 'committed':
      update({ pushAt: Date.now() }, { who: 'you', text: `pushed ${BRANCH}` })
      break
    case 'pushed':
      update({ prAt: Date.now() }, { who: 'you', text: `opened pull request #${PR_NUMBER}` })
      break
    case 'approved':
      update({ mergedAt: Date.now() }, { who: 'you', text: `merged #${PR_NUMBER} into main` })
      break
  }
}

/** Reveal the next 2–6 characters of the snippet; runs of indentation come along for free. */
export function typeMore() {
  const s = state
  if (s.typed >= SNIPPET.length || s.commitAt) return
  let pos = s.typed
  let n = 2 + Math.floor(Math.random() * 5)
  while (n > 0 && pos < SNIPPET.length) {
    const ch = SNIPPET[pos++]
    if (ch === '\n') {
      while (SNIPPET[pos] === ' ') pos++
      break
    }
    if (ch !== ' ') n--
  }
  const first = s.typed === 0
  update({ typed: pos, ...(first ? { startedAt: Date.now() } : {}) }, first ? { who: 'you', text: `started ${TICKET.key} on ${BRANCH}` } : undefined)
}

export function typedText(s: WorkState) {
  return SNIPPET.slice(0, s.typed)
}

/** Number of complete lines typed (the preview builds from these). */
export function linesTyped(s: WorkState) {
  return typedText(s).split('\n').length - 1
}

/**
 * The keys shared by every window: any key types, Enter advances, Esc resets.
 * Windows can override by handling keys first and calling preventDefault.
 */
export function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable]')) return
    if (e.key === 'Escape') {
      e.preventDefault()
      reset()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      advance()
    } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Tab') {
      e.preventDefault()
      typeMore()
    }
  })
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Re-render on an animation tick while time-driven stages are running. */
export function everyFrame(fn: () => void) {
  let raf = 0
  const loop = () => {
    fn()
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  return () => cancelAnimationFrame(raf)
}

export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export { myId }
