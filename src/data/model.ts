/**
 * Core data model (PLAN §9). Board data is shared truth; placements are
 * device-local and never synced as spatial truth.
 */

export type ID = string // ULID

export interface Board {
  id: ID
  title: string
  columnIds: ID[] // column order
  labels: Label[]
  createdAt: string
  updatedAt: string
  /** Set when the board mirrors a board in an online tool (GitHub Projects, Trello, …). */
  integration?: BoardIntegration
}

export type ProviderId = 'github' | 'trello' | 'linear' | 'jira'

export interface BoardIntegration {
  provider: ProviderId
  /** The remote board's id: a GitHub project node id, Trello board id, Linear team id, or `cloudId/PROJECT` for Jira. */
  remoteId: string
  name: string
  url?: string
}

export interface Column {
  id: ID
  boardId: ID
  title: string
  color?: string
  wipLimit?: number
  /** Remote column id when the board is linked: a GitHub Status option, Trello list, Linear or Jira status. */
  externalId?: string
}

export interface Card {
  id: ID
  boardId: ID
  columnId: ID
  orderKey: string // fractional index — reorder without renumbering
  title: string
  description?: string // markdown, edited in 2D
  labelIds: ID[]
  assignees: Person[]
  dueDate?: string
  color?: string // explicit color override (sticky skin)
  archived: boolean
  /** Short human reference shown on the card, e.g. 101 → "#101". */
  number?: number
  /** The remote item this card mirrors, when the board is linked. */
  externalRef?: ExternalRef
  skinData?: {
    // presentation hints, namespaced per skin
    sticky?: { offset?: [number, number]; rotation?: number }
  }
  createdAt: string
  updatedAt: string
}

export interface ExternalRef {
  provider: ProviderId
  id: string
  url?: string
  /** Human reference shown instead of `#number`, e.g. "ENG-12" or "owner/repo#42". */
  key?: string
  /** Provider-specific data the backend needs to update the item (e.g. GitHub content id). */
  meta?: Record<string, string>
}

export interface Label {
  id: ID
  name: string
  color: string
  icon?: LabelIcon
}

/** Every label carries an icon so color never carries meaning alone (PLAN §13). */
export type LabelIcon = 'bug' | 'star' | 'brush' | 'book' | 'bolt' | 'cube' | 'flag' | 'dot'

export interface Person {
  id: string
  name: string
  avatarUrl?: string
  color?: string
}

/** The shared, syncable part of a board. */
export interface BoardDoc {
  board: Board
  columns: Record<ID, Column>
  cards: Record<ID, Card>
}

export interface Pose {
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

export type PlacementMode = 'wall' | 'desk' | 'float'

export type ScalePreset = 'poster' | 'desk' | 'compact'

// Device-local, never synced as shared truth
export interface Placement {
  id: ID
  boardId: ID
  deviceId: string
  mode: PlacementMode
  anchorHandle?: string // persistent anchor UUID, if supported
  /**
   * anchor → board root. When no anchor exists this is the board pose in the
   * session's `local-floor` space.
   */
  localOffset: Pose
  size: [number, number] // meters
  tiltDeg?: number // desk mode
  skinId: string
  updatedAt: string
}

// Cards torn off the board and parked elsewhere in the room
export interface FreeCardPlacement {
  cardId: ID
  deviceId: string
  anchorHandle?: string
  /** Pose relative to the board root, so parked cards travel with the board. */
  localOffset: Pose
}

export const IDENTITY_POSE: Pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }

/** The short reference shown on a card: the remote key when linked, otherwise the local number. */
export function cardRef(card: Pick<Card, 'number' | 'externalRef'>): string {
  if (card.externalRef) return card.externalRef.key ?? ''
  return card.number !== undefined ? `#${card.number}` : ''
}
