import type { BoardDoc, Card, Column, Label, Person } from './model'
import { keysForCount } from './ordering'
import { ulid } from './ids'

/** Color-blind-safe label palette (Okabe–Ito derived), each paired with an icon. */
export const LABEL_PRESETS: Array<Pick<Label, 'name' | 'color' | 'icon'>> = [
  { name: 'bug', color: '#D55E00', icon: 'bug' },
  { name: 'feature', color: '#0072B2', icon: 'star' },
  { name: 'design', color: '#CC79A7', icon: 'brush' },
  { name: 'docs', color: '#009E73', icon: 'book' },
  { name: 'perf', color: '#E69F00', icon: 'bolt' },
  { name: 'xr', color: '#56B4E9', icon: 'cube' },
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
  description?: string
}

const COLUMNS: Array<{ title: string; color: string; wipLimit?: number; cards: SeedCard[] }> = [
  {
    title: 'Backlog',
    color: '#8b949e',
    cards: [
      { title: 'Room mode: spread columns across several walls', labels: ['xr', 'feature'] },
      { title: 'Corkboard skin with push pins and yarn links', labels: ['design'] },
      { title: 'Voice search: "show my cards"', labels: ['feature'], who: ['p-mo'] },
      { title: 'Two-handed scale and rotate on the board frame', labels: ['xr'] },
    ],
  },
  {
    title: 'Ready',
    color: '#2f81f7',
    cards: [
      { title: 'Throw a card downward to archive it', labels: ['xr', 'feature'], who: ['p-kenji'] },
      { title: 'Document the Quest on-device testing loop', labels: ['docs'], who: ['p-luis'], due: 6 },
      {
        title: 'LOD: drop avatars and labels beyond 3 m',
        labels: ['perf'],
        description: 'Keep wall mode readable from across the room by showing only titles and color blocks when the board is far away.',
      },
    ],
  },
  {
    title: 'In progress',
    color: '#d29922',
    wipLimit: 3,
    cards: [
      {
        title: 'Snap the ghost board to detected walls',
        labels: ['xr'],
        who: ['p-ada'],
        due: 2,
        description: 'Classify hit-test normals, prefer semantically labeled planes, then smooth the ghost pose with a critically damped spring.',
      },
      { title: 'Sticky-note peel and slap animation', labels: ['design', 'xr'], who: ['p-priya', 'p-ada'] },
      { title: 'Instanced card bodies and batched SDF text', labels: ['perf'], who: ['p-kenji'], due: 4 },
    ],
  },
  {
    title: 'In review',
    color: '#a371f7',
    wipLimit: 3,
    cards: [
      { title: 'Fix card flicker at column edges', labels: ['bug'], who: ['p-luis'], description: 'Add 2 cm of hysteresis so the target column does not flicker while dragging along a boundary.' },
      { title: 'Persist placements per device in IndexedDB', labels: ['feature'], who: ['p-mo'] },
    ],
  },
  {
    title: 'Done',
    color: '#3fb950',
    cards: [
      { title: 'Fractional order keys for conflict-free moves', labels: ['feature'], who: ['p-kenji'] },
      { title: 'Color-blind-safe label palette with icons', labels: ['design', 'docs'], who: ['p-priya'] },
      { title: 'Enter immersive-ar with passthrough on Quest', labels: ['xr'], who: ['p-ada'] },
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
      const due = c.due !== undefined ? new Date(now.getTime() + c.due * 86_400_000).toISOString().slice(0, 10) : undefined
      cards[id] = {
        id,
        boardId,
        columnId,
        orderKey: keys[i],
        title: c.title,
        description: c.description,
        labelIds: (c.labels ?? []).map((n) => labelByName.get(n)!).filter(Boolean),
        assignees: (c.who ?? []).map((pid) => PEOPLE.find((p) => p.id === pid)!).filter(Boolean),
        dueDate: due,
        archived: false,
        number: number++,
        createdAt: iso,
        updatedAt: iso,
      }
    })
  }

  return {
    board: { id: boardId, title: 'Spatial Kanban — launch', columnIds, labels, createdAt: iso, updatedAt: iso },
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
