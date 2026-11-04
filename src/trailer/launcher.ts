import { escapeHtml, onPeers, peerRoles, reset, ROLE_INFO, ROLES, type Role } from './shared'

interface ScreenDetailed {
  availLeft: number
  availTop: number
  availWidth: number
  availHeight: number
  isPrimary: boolean
  label?: string
}

const urlFor = (role: Role) => {
  const u = new URL(location.href)
  u.search = `?role=${role}`
  return u.toString()
}

function openRole(role: Role, rect?: { left: number; top: number; width: number; height: number }) {
  const features = rect ? `popup,left=${Math.round(rect.left)},top=${Math.round(rect.top)},width=${Math.round(rect.width)},height=${Math.round(rect.height)}` : 'popup,width=1100,height=720'
  // A named target reuses that role's window if it's already open.
  return window.open(urlFor(role), `workstation-${role}`, features)
}

/**
 * The workstation launcher: open each window (a role) and put it on its own
 * monitor. Chrome and Edge can place them across screens with the Window
 * Management API; elsewhere they open as separate windows to drag over.
 */
export function mountLauncher() {
  document.title = 'Workstation — launcher'
  document.body.dataset.role = 'launcher'
  const canPlace = 'getScreenDetails' in window
  document.body.innerHTML = `
    <div class="window">
      <div class="titlebar"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span><span class="title">workstation — choose a window for each monitor</span></div>
      <div class="body launcher">
        <h1>Multi-monitor workstation</h1>
        <p class="dim">Each window is one part of the same coding session, linked live across tabs. Put each on its own monitor. Press any key in any window to type, <b>Enter</b> to move on (save → commit → push → PR → merge), and <b>Esc</b> to reset every window.</p>
        <div class="roles">${ROLES.map(
          (r) => `<div class="role" data-role="${r}"><div class="ri">${ROLE_INFO[r].icon}</div><div class="rt">${ROLE_INFO[r].title}</div><div class="rb dim">${escapeHtml(ROLE_INFO[r].blurb)}</div>
            <div class="ra"><button data-open="${r}">Open window</button><a href="?role=${r}">here</a></div><div class="live" id="live-${r}"></div></div>`,
        ).join('')}</div>
        <div class="actions">
          <button class="primary" id="spread">${canPlace ? 'Spread across my screens' : 'Open all windows'}</button>
          <button id="reset">Reset session</button>
        </div>
        <p class="dim small" id="note">${canPlace ? 'Your browser will ask to manage windows on all your displays.' : 'Your browser opens them as separate windows: drag each one to a monitor (and press F11 for full screen). If only one opens, allow pop-ups for this site.'}</p>
      </div>
    </div>`

  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => openRole(b.dataset.open as Role)))
  document.getElementById('reset')!.addEventListener('click', () => reset())
  document.getElementById('spread')!.addEventListener('click', async () => {
    const note = document.getElementById('note')!
    let screens: ScreenDetailed[] = []
    if (canPlace) {
      try {
        const details = await (window as unknown as { getScreenDetails(): Promise<{ screens: ScreenDetailed[] }> }).getScreenDetails()
        screens = [...details.screens].sort((a, b) => a.availLeft - b.availLeft || a.availTop - b.availTop)
      } catch {
        note.textContent = 'Window placement was not allowed, so the windows open on this screen. Drag each one to a monitor.'
      }
    }
    // Preferred order across screens, left to right: editor in the middle-ish where you type.
    const order: Role[] = screens.length >= 3 ? ['pr', 'editor', 'terminal', 'preview', 'board'] : ['editor', 'terminal', 'preview', 'pr', 'board']
    order.forEach((role, i) => {
      if (screens.length) {
        // One role per screen; extra roles share the last screens, split in halves.
        const perScreen = Math.ceil(order.length / screens.length)
        const scr = screens[Math.min(screens.length - 1, Math.floor(i / perScreen))]
        const slot = i % perScreen
        const w = scr.availWidth / perScreen
        openRole(role, { left: scr.availLeft + slot * w, top: scr.availTop, width: w, height: scr.availHeight })
      } else {
        openRole(role, { left: 40 + i * 60, top: 40 + i * 40, width: 1100, height: 720 })
      }
    })
  })

  const renderLive = () => {
    const open = peerRoles()
    for (const r of ROLES) document.getElementById(`live-${r}`)!.textContent = open.includes(r) ? '● open' : ''
  }
  renderLive()
  onPeers(renderLive)
}
