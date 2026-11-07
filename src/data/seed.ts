import type { BoardDoc, Card, Column, Label, Person } from './model'
import { keysForCount } from './ordering'
import { ulid } from './ids'

/** Color-blind-safe label palette (Okabe–Ito derived), each paired with an icon. */
export const LABEL_PRESETS: Array<Pick<Label, 'name' | 'color' | 'icon'>> = [
  { name: 'bug', color: '#D55E00', icon: 'bug' },
  { name: 'feature', color: '#0072B2', icon: 'star' },
  { name: 'refactor', color: '#CC79A7', icon: 'brush' },
  { name: 'docs', color: '#009E73', icon: 'book' },
  { name: 'perf', color: '#E69F00', icon: 'bolt' },
  { name: 'ci', color: '#56B4E9', icon: 'cube' },
]

const PEOPLE: Person[] = [
  { id: 'p-ada', name: 'Ada Brooks', color: '#8250df' },
  { id: 'p-kenji', name: 'Kenji Sato', color: '#1a7f37' },
  { id: 'p-priya', name: 'Priya Nair', color: '#bf3989' },
  { id: 'p-luis', name: 'Luis Ortega', color: '#0969da' },
  { id: 'p-mo', name: 'Mo Haddad', color: '#9a6700' },
]

export const DEMO_PEOPLE = PEOPLE

interface SeedCard {
  title: string
  labels?: string[]
  who?: string[]
  due?: number // days from now
  deadline?: number // days from now
  description?: string
}

/** A typical development flow: triage incoming bugs, pick them up, review, verify in QA, ship. */
const COLUMNS: Array<{ title: string; color: string; wipLimit?: number; cards: SeedCard[] }> = [
  {
    title: 'Triage',
    color: '#8b949e',
    cards: [
      {
        title: 'App crashes on save when the title has an emoji',
        labels: ['bug'],
        description: 'Repro: create a note titled "Launch 🚀", press Save. Sentry shows a UnicodeEncodeError in the slug helper. Needs severity and an owner.',
      },
      { title: 'Dark mode: chart tooltips are unreadable', labels: ['bug'] },
      {
        title: 'Flaky test: checkout e2e times out on CI',
        labels: ['bug', 'ci'],
        description: 'Fails about 1 in 8 runs, only on CI. Likely waits on a network call instead of the confirmation element.',
      },
      { title: 'Upgrade to Node 24 LTS', labels: ['refactor', 'ci'] },
    ],
  },
  {
    title: 'Ready',
    color: '#2f81f7',
    cards: [
      {
        title: 'Password reset link expires after 5 minutes',
        labels: ['bug'],
        who: ['p-luis'],
        due: 3,
        description: 'Token TTL is read in seconds but configured in minutes. Expected: 60 minutes. Add a regression test for the TTL parsing.',
      },
      { title: 'Rate limit the public API', labels: ['feature'], who: ['p-kenji'] },
      { title: 'Write the on-call runbook for payment failures', labels: ['docs'], who: ['p-priya'], due: 6, deadline: 10 },
    ],
  },
  {
    title: 'In progress',
    color: '#d29922',
    wipLimit: 3,
    cards: [
      {
        title: 'Fix memory leak in the websocket reconnect loop',
        labels: ['bug', 'perf'],
        who: ['p-ada'],
        due: 2,
        description: 'Each reconnect adds a new message listener without removing the old one. Heap grows ~4 MB per hour on idle tabs. Remove listeners on close and add a heap snapshot check.',
      },
      {
        title: 'Login redirect loop on Safari after the session expires',
        labels: ['bug'],
        who: ['p-kenji', 'p-mo'],
        description: 'Safari blocks the refresh cookie (SameSite=None missing), so the auth guard keeps redirecting to /login.',
      },
      { title: 'Extract the billing module from the monolith', labels: ['refactor'], who: ['p-priya'], due: 5 },
    ],
  },
  {
    title: 'In review',
    color: '#a371f7',
    wipLimit: 3,
    cards: [
      {
        title: 'Fix off-by-one in search pagination',
        labels: ['bug'],
        who: ['p-luis'],
        description: 'Page 2 repeats the last result of page 1. The offset used (page × size) − 1. PR includes unit tests for the first, middle and last page.',
      },
      { title: 'Cache user profile lookups (p95 840 ms → 120 ms)', labels: ['perf'], who: ['p-mo'] },
    ],
  },
  {
    title: 'QA',
    color: '#db61a2',
    wipLimit: 4,
    cards: [
      {
        title: 'Login button submits twice on slow networks',
        labels: ['bug'],
        who: ['p-ada'],
        description: 'Fixed by disabling the button while the request is pending. Verify on throttled 3G in Chrome and Safari.',
      },
      { title: 'CSV export drops rows with commas in names', labels: ['bug'], who: ['p-luis'] },
    ],
  },
  {
    title: 'Done',
    color: '#3fb950',
    cards: [
      { title: 'Run lint, typecheck and unit tests on every PR', labels: ['ci'], who: ['p-kenji'] },
      { title: 'Hotfix: 500 error when checking out an empty cart', labels: ['bug'], who: ['p-mo'] },
      { title: 'Add a bug report template to the repo', labels: ['docs'], who: ['p-priya'] },
    ],
  },
]

export function createDemoBoard(now: Date = new Date()): BoardDoc {
  const iso = now.toISOString()
  const boardId = ulid()
  const labels: Label[] = LABEL_PRESETS.map((l) => ({ ...l, id: `lbl-${l.name}` }))
  const labelByName = new Map(labels.map((l) => [l.name, l.id]))
  const columns: Record<string, Column> = {}
  const cards: Record<string, Card> = {}
  const columnIds: string[] = []
  let number = 101

  for (const col of COLUMNS) {
    const columnId = ulid()
    columnIds.push(columnId)
    columns[columnId] = { id: columnId, boardId, title: col.title, color: col.color, wipLimit: col.wipLimit }
    const keys = keysForCount(col.cards.length)
    col.cards.forEach((c, i) => {
      const id = ulid()
      const inDays = (n?: number) => (n !== undefined ? new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10) : undefined)
      cards[id] = {
        id,
        boardId,
        columnId,
        orderKey: keys[i],
        title: c.title,
        description: c.description,
        labelIds: (c.labels ?? []).map((n) => labelByName.get(n)!).filter(Boolean),
        assignees: (c.who ?? []).map((pid) => PEOPLE.find((p) => p.id === pid)!).filter(Boolean),
        dueDate: inDays(c.due),
        deadline: inDays(c.deadline),
        archived: false,
        number: number++,
        createdAt: iso,
        updatedAt: iso,
      }
    })
  }

  return {
    board: { id: boardId, title: 'Web app — sprint 14', columnIds, labels, createdAt: iso, updatedAt: iso },
    columns,
    cards,
  }
}

export function nextCardNumber(doc: BoardDoc): number {
  let max = 100
  for (const id in doc.cards) max = Math.max(max, doc.cards[id].number ?? 0)
  return max + 1
}

export function newCard(doc: BoardDoc, columnId: string, orderKey: string, title: string, now = new Date()): Card {
  const iso = now.toISOString()
  return {
    id: ulid(),
    boardId: doc.board.id,
    columnId,
    orderKey,
    title,
    labelIds: [],
    assignees: [],
    archived: false,
    number: nextCardNumber(doc),
    createdAt: iso,
    updatedAt: iso,
  }
}
