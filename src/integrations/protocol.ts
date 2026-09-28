/**
 * The wire protocol between the app and the optional integrations backend
 * (`worker/`). Shared by both sides, so it must stay free of DOM and Workers types.
 */
import type { ExternalRef, ProviderId } from '../data/model'

export type { ExternalRef, ProviderId }

export const PROVIDER_IDS: readonly ProviderId[] = ['github', 'trello', 'linear', 'jira']

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  github: 'GitHub Projects',
  trello: 'Trello',
  linear: 'Linear',
  jira: 'Jira',
}

/** What each provider can take from the board. Everything is always pulled. */
export interface ProviderCapabilities {
  create: boolean
  edit: boolean
  move: boolean
  /** Reordering cards inside a column. */
  reorder: boolean
  archive: boolean
}

export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  github: { create: true, edit: true, move: true, reorder: true, archive: true },
  trello: { create: true, edit: true, move: true, reorder: true, archive: true },
  linear: { create: true, edit: true, move: true, reorder: true, archive: true },
  // Jira ranking and archiving need Jira Software admin scopes; cards keep their Jira rank.
  jira: { create: true, edit: true, move: true, reorder: false, archive: false },
}

export interface ProviderInfo {
  id: ProviderId
  name: string
  /** The backend has credentials for this provider. */
  enabled: boolean
  capabilities: ProviderCapabilities
  /** What a "board" is called in this tool, for the picker. */
  boardNoun: string
}

/** `GET /api/config` */
export interface ApiConfig {
  version: 1
  providers: ProviderInfo[]
}

export interface Connection {
  provider: ProviderId
  accountName: string
  connectedAt: string
}

/** `GET /api/me` */
export interface ApiMe {
  connections: Connection[]
}

/** One entry in the board picker. */
export interface RemoteBoardSummary {
  id: string
  name: string
  /** Owner, workspace, team or site — whatever groups boards in that tool. */
  group?: string
  url?: string
}

export interface RemoteColumn {
  id: string
  title: string
  color?: string
}

export interface RemoteLabel {
  id: string
  name: string
  color: string
}

export interface RemotePerson {
  id: string
  name: string
  avatarUrl?: string
}

export interface RemoteCard {
  ref: ExternalRef
  title: string
  description: string
  columnId: string
  labels: RemoteLabel[]
  assignees: RemotePerson[]
  dueDate?: string
}

/**
 * A full snapshot of a remote board. Cards are listed in board order; cards
 * the tool has archived, closed or deleted are simply absent.
 */
export interface RemoteBoard {
  id: string
  name: string
  url?: string
  columns: RemoteColumn[]
  cards: RemoteCard[]
}

/** A local change to apply to the remote board. */
export type SyncOp =
  | { op: 'create'; localId: string; columnId: string; title: string; description: string; afterId: string | null }
  | { op: 'update'; ref: ExternalRef; title?: string; description?: string }
  | { op: 'move'; ref: ExternalRef; columnId: string; afterId: string | null; beforeId: string | null; columnChanged: boolean }
  | { op: 'archive'; ref: ExternalRef; archived: boolean }

export type SyncOpResult =
  | { ok: true; ref?: ExternalRef }
  | {
      ok: false
      error: string
      /** The tool refused the change (e.g. a workflow rule). Retrying won't help, so the app reverts it. */
      permanent: boolean
    }

/** `POST /api/integrations/:provider/board` */
export interface BoardRequest {
  remoteId: string
}

/** `POST /api/integrations/:provider/ops` */
export interface OpsRequest {
  remoteId: string
  ops: SyncOp[]
}

export interface OpsResponse {
  results: SyncOpResult[]
}

export interface ApiError {
  error: string
  /** `not_connected` means the user must connect (or reconnect) the provider. */
  code?: 'not_connected' | 'bad_request' | 'provider_error' | 'unavailable' | 'forbidden'
}
