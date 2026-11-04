import { mountChrome } from '../chrome'
import { advance, BRANCH, COMMIT_MSG, escapeHtml, FILE, getState, linesTyped, PR_NUMBER, REPO, sleep, stage, subscribe, type WorkState } from '../shared'

/**
 * The terminal: the dev server and test watcher react to every save, and the
 * Commit → Push → PR → Merge pipeline plays here, whichever window pressed it.
 */
export function mountTerminal() {
  const { body } = mountChrome('terminal', 'dev@workstation: ~/workspace — zsh')
  body.innerHTML = `
    <div class="terminal">
      <pre id="screen" class="screen"></pre>
      <div id="pipeline" class="pipeline">
        <button class="step" data-step="commit"><span class="icon">◆</span><span class="label">Commit</span></button>
        <span class="arrow">›</span>
        <button class="step" data-step="push"><span class="icon">▲</span><span class="label">Push</span></button>
        <span class="arrow">›</span>
        <button class="step" data-step="pr"><span class="icon">⇄</span><span class="label">PR</span></button>
        <span class="arrow">›</span>
        <button class="step" data-step="merge"><span class="icon">✓</span><span class="label">Merge</span></button>
      </div>
    </div>
    <div id="shipped" class="shipped" hidden>SHIPPED ✓</div>`
  const screen = document.getElementById('screen')!
  const shipped = document.getElementById('shipped')!
  const steps = [...document.querySelectorAll<HTMLButtonElement>('.step')]

  const prompt = () => `<span class="prompt">dev@workstation</span>:<span class="path">~/workspace</span> <span class="branch">(${BRANCH})</span> $ `
  const print = (html: string) => {
    const span = document.createElement('span')
    span.innerHTML = html
    screen.append(span)
    // Keep the scrollback bounded.
    while (screen.childNodes.length > 400) screen.firstChild!.remove()
    screen.scrollTop = screen.scrollHeight
  }
  const ok = (s: string) => `<span class="ok">${s}</span>`
  const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
  const time = () => `<span class="dim">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`

  // Commands play one at a time, in order.
  let queue = Promise.resolve()
  const play = (fn: (fast: boolean) => Promise<void>, fast = false) => {
    queue = queue.then(() => fn(fast)).catch(() => undefined)
  }
  const command = async (cmd: string, fast: boolean) => {
    print(prompt())
    if (fast) print(escapeHtml(cmd))
    else for (const ch of cmd) {
      print(escapeHtml(ch))
      await sleep(14 + Math.random() * 24)
    }
    print('\n')
    if (!fast) await sleep(180)
  }
  const out = async (ls: string[], fast: boolean, delay = 70) => {
    for (const l of ls) {
      print(l + '\n')
      if (!fast) await sleep(delay + Math.random() * delay)
    }
  }
  const progress = async (label: string, total: number, suffix: string, fast: boolean) => {
    const span = document.createElement('span')
    screen.append(span)
    for (let i = fast ? 20 : 0; i <= 20; i++) {
      span.textContent = `${label}: ${String(Math.round((i / 20) * 100)).padStart(3)}% (${Math.round((i / 20) * total)}/${total})${i === 20 ? `, done${suffix}.` : ''}`
      screen.scrollTop = screen.scrollHeight
      if (!fast) await sleep(30)
    }
    print('\n')
  }

  const scripts = {
    boot: async (fast: boolean) => {
      await command('npm run dev', fast)
      await out(['', `  ${ok('VITE')} v8.3.1  ready in 312 ms`, '', `  ➜  Local:   <span class="path">http://localhost:5173/</span>`, `  ➜  Network: use --host to expose`, ''], fast, 40)
      await out([`${time()} <span class="dim">[vitest]</span> watching for file changes…`, ''], fast)
    },
    save: async (fast: boolean, s: WorkState) => {
      const lines = linesTyped(s)
      await out([`${time()} <span class="path">[vite]</span> hmr update <span class="dim">/${FILE}</span>`], fast, 40)
      const passed = Math.min(3, 1 + Math.floor(lines / 8))
      await out([`${time()} <span class="dim">[vitest]</span> ${ok('✓')} tests/beacon.test.ts <span class="dim">(${passed} test${passed > 1 ? 's' : ''})</span> ${12 + lines}ms`, ''], fast, 60)
    },
    commit: async (fast: boolean) => {
      await command('git add -A', fast)
      await command(`git commit -m "${COMMIT_MSG}"`, fast)
      await out([`[${BRANCH} ${hex(7)}] ${COMMIT_MSG}`, ` 2 files changed, 21 insertions(+), 2 deletions(-)`, ` create mode 100644 ${FILE}`, ''], fast)
    },
    push: async (fast: boolean) => {
      await command(`git push -u origin ${BRANCH}`, fast)
      await out(['Enumerating objects: 8, done.'], fast, 25)
      await progress('Writing objects', 5, ' | 1.2 KiB', fast)
      await out([`Total 5 (delta 2), reused 0 (delta 0), pack-reused 0`, `To ${REPO}.git`, ` * [new branch]      ${BRANCH} -> ${BRANCH}`, `branch '${BRANCH}' set up to track 'origin/${BRANCH}'.`, ''], fast)
    },
    pr: async (fast: boolean) => {
      await command('gh pr create --fill --base main', fast)
      await out([`Creating pull request for <span class="branch">${BRANCH}</span> into <span class="branch">main</span> in example/workspace`, '', ok(`https://${REPO}/pull/${PR_NUMBER}`), ''], fast, 120)
      await command(`gh pr checks ${PR_NUMBER} --watch`, fast)
    },
    merge: async (fast: boolean) => {
      await out([`${ok('✓')} build   ${ok('✓')} unit   ${ok('✓')} xr-e2e   ${ok('✓')} preview`, ok('All checks were successful'), ''], fast, 60)
      await command(`gh pr merge ${PR_NUMBER} --squash --delete-branch`, fast)
      await out([`${ok('✓')} Squashed and merged pull request #${PR_NUMBER} (${COMMIT_MSG})`, `${ok('✓')} Deleted branch ${BRANCH} and switched to branch main`, ''], fast, 140)
    },
  }

  // Catch up on a session that started before this window opened.
  const s0 = getState()
  play(scripts.boot)
  if (s0.savedAt) play((f) => scripts.save(f, s0), true)
  if (s0.commitAt) play(scripts.commit, true)
  if (s0.pushAt) play(scripts.push, true)
  if (s0.prAt) play(scripts.pr, true)
  if (s0.mergedAt) play(scripts.merge, true)

  subscribe((s, prev) => {
    if ((!s.startedAt && prev.startedAt) || (s.typed === 0 && prev.typed > 0)) {
      // Reset from any window.
      screen.innerHTML = ''
      shipped.hidden = true
      queue = Promise.resolve()
      play(scripts.boot, true)
      return
    }
    if (s.savedAt && s.savedAt !== prev.savedAt) play((f) => scripts.save(f, s))
    if (s.commitAt && !prev.commitAt) play(scripts.commit)
    if (s.pushAt && !prev.pushAt) play(scripts.push)
    if (s.prAt && !prev.prAt) play(scripts.pr)
    if (s.mergedAt && !prev.mergedAt) {
      play(scripts.merge)
      play(async () => {
        await sleep(300)
        shipped.hidden = false
      })
    }
  })

  // The big pipeline buttons light up in turn.
  const NEXT: Record<string, string> = { saved: 'commit', committed: 'push', pushed: 'pr', approved: 'merge' }
  const RUNNING: Record<string, string> = { committing: 'commit', pushing: 'push', opening: 'pr', checks: 'pr' }
  const ORDER = ['commit', 'push', 'pr', 'merge']
  const DONE_AT: Record<string, number> = { committed: 1, pushing: 1, pushed: 2, opening: 2, checks: 3, approved: 3, merged: 4 }
  const renderSteps = () => {
    const st = stage(getState())
    const next = NEXT[st]
    const running = RUNNING[st]
    const done = DONE_AT[st] ?? 0
    steps.forEach((b) => {
      const i = ORDER.indexOf(b.dataset.step!)
      b.disabled = b.dataset.step !== next
      b.classList.toggle('next', b.dataset.step === next)
      b.classList.toggle('running', b.dataset.step === running)
      b.classList.toggle('done', i < done)
    })
  }
  steps.forEach((b) => b.addEventListener('click', () => advance()))
  renderSteps()
  setInterval(renderSteps, 200)
  subscribe(renderSteps)
}
