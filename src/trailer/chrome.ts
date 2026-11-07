import { escapeHtml, getState, onPeers, peerRoles, ROLE_INFO, ROLES, stage, subscribe, type Role } from './shared'

/**
 * The frame every workstation window shares: a title bar (traffic lights,
 * title) and a status line showing which other windows are linked.
 */
export function mountChrome(role: Role, title: string): { body: HTMLElement; status: HTMLElement } {
  document.title = `${ROLE_INFO[role].title} — workstation`
  document.body.dataset.role = role
  document.body.innerHTML = `
    <div class="window">
      <div class="titlebar">
        <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
        <span class="title">${escapeHtml(title)}</span>
        <span class="links" id="links"></span>
      </div>
      <div class="body" id="body"></div>
      <div class="statusline" id="status"></div>
    </div>`
  const links = document.getElementById('links')!
  const renderLinks = () => {
    const others = peerRoles()
    links.innerHTML = ROLES.map((r) => {
      const on = r === role || others.includes(r)
      return `<span class="link ${on ? 'on' : ''} ${r === role ? 'me' : ''}" title="${ROLE_INFO[r].title}${on ? ' (open)' : ''}">${ROLE_INFO[r].icon}</span>`
    }).join('')
  }
  renderLinks()
  onPeers(renderLinks)
  const status = document.getElementById('status')!
  const renderStatus = () => {
    const s = getState()
    const n = peerRoles().length
    status.innerHTML = `<span>${stageLabel(stage(s))}</span><span class="dim">${n ? `linked with ${n} window${n > 1 ? 's' : ''}` : 'no other windows yet'} · any key types · Enter next · Esc reset</span>`
  }
  renderStatus()
  subscribe(renderStatus)
  onPeers(renderStatus)
  setInterval(renderStatus, 500)
  return { body: document.getElementById('body')!, status }
}

export function stageLabel(st: ReturnType<typeof stage>): string {
  return {
    idle: '● ready',
    typing: '● editing',
    saved: '● saved',
    committing: '◆ committing…',
    committed: '◆ committed',
    pushing: '▲ pushing…',
    pushed: '▲ pushed',
    opening: '⇄ opening PR…',
    checks: '⇄ checks running',
    approved: '✓ approved',
    merged: '✓ merged',
  }[st]
}
