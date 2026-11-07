import { mountChrome } from '../chrome'
import { SNIPPET } from '../snippet'
import { advance, BRANCH, CHECKS, checksProgress, COMMIT_MSG, DURATION, escapeHtml, everyFrame, FILE, getState, PR_NUMBER, stage, TICKET } from '../shared'

/**
 * The pull request page: the diff (as saved), commits, CI checks running in
 * real time once the PR opens, the review, and the merge button.
 */
export function mountPR() {
  const { body } = mountChrome('pr', `Pull request #${PR_NUMBER} — example/workspace`)
  body.innerHTML = `
    <div class="pr">
      <header class="pr-head">
        <div class="pr-title"><span id="prTitle"></span> <span class="dim">#${PR_NUMBER}</span></div>
        <div class="pr-meta"><span class="pill" id="pill"></span> <span id="meta"></span></div>
      </header>
      <div class="pr-grid">
        <section class="pr-main">
          <div class="card"><div class="card-h">Files changed <span class="dim" id="stat"></span></div><pre class="diff" id="diff"></pre></div>
        </section>
        <aside class="pr-side">
          <div class="card"><div class="card-h">Checks</div><div id="checks"></div></div>
          <div class="card"><div class="card-h">Review</div><div id="review"></div></div>
          <button class="merge" id="merge">Merge pull request</button>
        </aside>
      </div>
    </div>`
  const el = (id: string) => document.getElementById(id)!
  const merge = el('merge') as HTMLButtonElement
  merge.addEventListener('click', () => advance())
  let lastKey = ''

  everyFrame(() => {
    const s = getState()
    const st = stage(s)
    const now = Date.now()
    const saved = SNIPPET.slice(0, s.savedTyped)
    const rows = saved ? saved.split('\n') : []
    const key = `${st}:${s.savedTyped}:${Math.floor(checksProgress(s, now) * 40)}:${s.prAt ? Math.floor((now - s.prAt) / 500) : 0}`
    if (key === lastKey) return
    lastKey = key

    const open = !!s.prAt
    el('prTitle').textContent = open || s.pushAt ? COMMIT_MSG : `Compare: main ← ${BRANCH}`
    const pill = el('pill')
    pill.className = `pill ${st === 'merged' ? 'merged' : open ? 'open' : 'draft'}`
    pill.textContent = st === 'merged' ? '✓ Merged' : open ? (st === 'opening' ? 'Opening…' : 'Open') : s.pushAt ? 'Ready to open' : 'Not pushed'
    el('meta').innerHTML = `<span class="branch">${BRANCH}</span> → <span class="branch">main</span> · closes ${TICKET.key}`

    el('stat').textContent = rows.length ? `1 file · +${rows.length} −0` : 'no changes saved yet'
    el('diff').innerHTML = rows.length
      ? `<span class="diff-file">${FILE}</span>\n<span class="dim">@@ -0,0 +1,${rows.length} @@</span>\n` + rows.map((r) => `<span class="add">+ ${escapeHtml(r) || ' '}</span>`).join('')
      : '<span class="dim">Save in the editor to see the diff.</span>'
    el('diff').scrollTop = el('diff').scrollHeight

    // Checks run in sequence after the PR opens.
    const prog = checksProgress(s, now)
    el('checks').innerHTML = CHECKS.map((c, i) => {
      const start = i === 0 ? 0 : CHECKS[i - 1].at
      const state = !open || st === 'opening' ? 'queued' : prog >= c.at ? 'pass' : prog >= start ? 'running' : 'queued'
      const icon = state === 'pass' ? '✓' : state === 'running' ? '◌' : '·'
      return `<div class="check ${state}"><span class="ci">${icon}</span>${c.label}</div>`
    }).join('')

    const reviewAt = s.prAt ? s.prAt + DURATION.pr + DURATION.checks : Infinity
    const approved = st === 'approved' || st === 'merged'
    el('review').innerHTML = !open
      ? '<div class="dim">Requested from @maya once the PR is open.</div>'
      : approved
        ? `<div class="review ok"><b>@maya</b> approved<div class="quote">“Love the quiet-route follow. Ship it 🚀”</div></div>`
        : now > reviewAt
          ? '<div class="review"><b>@maya</b> is reviewing…</div>'
          : '<div class="dim">@maya is waiting for checks.</div>'

    merge.disabled = st !== 'approved'
    merge.classList.toggle('ready', st === 'approved')
    merge.classList.toggle('done', st === 'merged')
    merge.textContent = st === 'merged' ? '✓ Merged' : 'Merge pull request'
  })
}
