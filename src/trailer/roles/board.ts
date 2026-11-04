import { mountChrome } from '../chrome'
import { clock, escapeHtml, everyFrame, getState, stage, subscribe, TICKET, type Stage } from '../shared'

const COLUMNS = ['Backlog', 'In progress', 'In review', 'Done'] as const

const OTHER_CARDS: Array<{ key: string; title: string; col: number; who: string }> = [
  { key: 'SK-39', title: 'Snap ghost board to walls', col: 3, who: 'AP' },
  { key: 'SK-40', title: 'Persist anchors per device', col: 2, who: 'MW' },
  { key: 'SK-44', title: 'Voice: "show my cards"', col: 0, who: 'JL' },
  { key: 'SK-45', title: 'LOD for far boards', col: 0, who: 'AP' },
  { key: 'SK-41', title: 'Sticky-note peel animation', col: 1, who: 'MW' },
]

function columnOf(st: Stage): number {
  if (st === 'idle') return 0
  if (st === 'merged') return 3
  if (st === 'opening' || st === 'checks' || st === 'approved') return 2
  return 1
}

/**
 * The team board: the ticket being worked on moves Backlog → In progress →
 * In review → Done as the session goes, next to a live activity feed.
 */
export function mountBoard() {
  const { body } = mountChrome('board', `Team board — Spatial Kanban`)
  body.innerHTML = `
    <div class="team">
      <div class="kanban" id="kanban">${COLUMNS.map((c, i) => `<div class="col" data-col="${i}"><div class="col-h">${c} <span class="count" id="count${i}"></span></div><div class="col-b" id="col${i}"></div></div>`).join('')}</div>
      <aside class="feed"><div class="card-h">Activity</div><div id="feed"></div></aside>
    </div>
    <div class="confetti" id="confetti"></div>`
  const ticket = document.createElement('div')
  ticket.className = 'kcard mine'
  ticket.innerHTML = `<div class="k">${TICKET.key}</div><div class="t">${escapeHtml(TICKET.title)}</div><div class="who"><span class="av">you</span><span class="sub" id="sub"></span></div>`
  for (const c of OTHER_CARDS) {
    const d = document.createElement('div')
    d.className = 'kcard'
    d.innerHTML = `<div class="k">${c.key}</div><div class="t">${escapeHtml(c.title)}</div><div class="who"><span class="av">${c.who}</span></div>`
    document.getElementById(`col${c.col}`)!.append(d)
  }
  let col = -1
  const place = () => {
    const st = stage(getState())
    const next = columnOf(st)
    if (next === col) return
    // FLIP: measure, move, then animate from the old spot.
    const before = ticket.getBoundingClientRect()
    const target = document.getElementById(`col${next}`)!
    target.prepend(ticket)
    if (col >= 0) {
      const after = ticket.getBoundingClientRect()
      ticket.animate([{ transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) rotate(-3deg) scale(1.05)` }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2,.9,.3,1.15)' })
    }
    col = next
    COLUMNS.forEach((_, i) => (document.getElementById(`count${i}`)!.textContent = String(document.getElementById(`col${i}`)!.children.length)))
    if (st === 'merged') burst()
  }
  const sub = () => {
    const st = stage(getState())
    document.getElementById('sub')!.textContent =
      st === 'idle' ? '' : st === 'typing' || st === 'saved' ? 'editing beacon.ts' : st === 'committing' || st === 'committed' ? 'committed' : st === 'pushing' || st === 'pushed' ? 'pushed' : st === 'merged' ? 'merged ✓' : 'PR #18 · checks'
  }
  const feed = document.getElementById('feed')!
  const renderFeed = () => {
    const items = [...getState().feed].reverse()
    feed.innerHTML = items.length
      ? items.map((f) => `<div class="fi"><span class="dim">${clock(f.t)}</span> <b>${escapeHtml(f.who)}</b> ${escapeHtml(f.text)}</div>`).join('')
      : '<div class="dim">Quiet so far. Start typing in any window.</div>'
  }
  place()
  sub()
  renderFeed()
  subscribe(() => {
    place()
    sub()
    renderFeed()
  })
  // Time-driven stages (checks finishing) move the card without a state change.
  everyFrame(() => {
    place()
  })

  function burst() {
    const box = document.getElementById('confetti')!
    const colors = ['#33ff66', '#ffd34f', '#4fc3ff', '#ff6fae', '#c7a6ff']
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('i')
      p.style.left = `${70 + Math.random() * 20}%`
      p.style.background = colors[i % colors.length]
      p.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}vw`)
      p.style.setProperty('--rot', `${Math.random() * 720}deg`)
      p.style.animationDelay = `${Math.random() * 0.3}s`
      box.append(p)
      setTimeout(() => p.remove(), 2600)
    }
  }
}
