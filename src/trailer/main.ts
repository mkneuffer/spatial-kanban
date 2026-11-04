import './trailer.css'
import { mountLauncher } from './launcher'
import { mountBoard } from './roles/board'
import { mountEditor } from './roles/editor'
import { mountPR } from './roles/pr'
import { mountPreview } from './roles/preview'
import { mountTerminal } from './roles/terminal'
import { bindKeys, join, ROLES, type Role } from './shared'

// The workstation: a fake dev session spread over several windows (one per monitor),
// linked over a BroadcastChannel. `?role=` picks the window; no role shows the launcher.
const param = new URLSearchParams(location.search).get('role')
const role = (ROLES as readonly string[]).includes(param ?? '') ? (param as Role) : null

const MOUNT: Record<Role, () => void> = {
  editor: mountEditor,
  terminal: mountTerminal,
  preview: mountPreview,
  pr: mountPR,
  board: mountBoard,
}

if (role) {
  MOUNT[role]()
  bindKeys()
} else {
  mountLauncher()
}
join(role ?? 'launcher')
