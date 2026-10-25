import './trailer.css'
import { SNIPPET } from './snippet'

// Trailer page: a fake terminal for screen recording. Any key "types" the snippet,
// Enter brings up Commit → Push → PR, and each click prints believable git output.

const BRANCH = 'feat/signal-beacon'
const COMMIT_MSG = 'feat: add glowing signal beacon'
const REPO = 'github.com/example/workspace'
const PR_NUMBER = 18

const screen = document.getElementById('screen')!
const hint = document.getElementById('hint')!
const pipeline = document.getElementById('pipeline')!
const shipped = document.getElementById('shipped')!
const steps = [...pipeline.querySelectorAll<HTMLButtonElement>('.step')]

const prompt = () => `<span class="prompt">dev@workstation</span>:<span class="path">~/workspace</span> <span class="branch">(${BRANCH})</span> $ `

let typed: Text
let cursor: HTMLSpanElement
let pos = 0
let phase: 'typing' | 'pipeline' | 'running' | 'done' = 'typing'
let nextStep = 0

function reset() {
  screen.innerHTML = ''
  appendHtml(`${prompt()}nvim src/scene/beacon.ts\n\n`)
  typed = document.createTextNode('')
  cursor = document.createElement('span')
  cursor.className = 'cursor'
  screen.append(typed, cursor)
  pos = 0
  phase = 'typing'
  nextStep = 0
  pipeline.hidden = true
  shipped.hidden = true
  document.body.classList.remove('with-pipeline')
  hint.classList.remove('gone')
  steps.forEach((b) => b.classList.remove('done', 'running'))
  updateSteps()
}

function appendHtml(html: string) {
  const span = document.createElement('span')
  span.innerHTML = html
  if (cursor?.isConnected) screen.insertBefore(span, cursor)
  else screen.append(span)
  scrollToEnd()
}

function scrollToEnd() {
  screen.scrollTop = screen.scrollHeight
}

/** Reveal the next 2–6 characters; runs of indentation come along for free. */
function typeChunk() {
  let n = 2 + Math.floor(Math.random() * 5)
  let out = ''
  while (n > 0) {
    if (pos >= SNIPPET.length) {
      pos = 0
      out += '\n'
    }
    const ch = SNIPPET[pos++]
    out += ch
    if (ch === '\n') {
      while (SNIPPET[pos] === ' ') out += SNIPPET[pos++]
      break
    }
    if (ch !== ' ') n--
  }
  typed.appendData(out)
  scrollToEnd()
}

function openPipeline() {
  phase = 'pipeline'
  // Close the "file": print :wq and drop back to a prompt.
  typed.appendData('\n')
  appendHtml(`<span class="dim">:wq</span>\n<span class="dim">"src/scene/beacon.ts" written</span>\n\n`)
  cursor.remove()
  document.body.classList.add('with-pipeline')
  pipeline.hidden = false
  hint.classList.add('gone')
  updateSteps()
  scrollToEnd()
}

function updateSteps() {
  steps.forEach((b, i) => {
    b.disabled = phase !== 'pipeline' || i !== nextStep
    b.classList.toggle('next', phase === 'pipeline' && i === nextStep)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hex = (len: number) => Array.from({ length: len }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')

async function command(cmd: string) {
  appendHtml(prompt())
  for (const ch of cmd) {
    appendHtml(escapeHtml(ch))
    await sleep(18 + Math.random() * 30)
  }
  appendHtml('\n')
  await sleep(220)
}

async function lines(out: string[], delay = 90) {
  for (const l of out) {
    appendHtml(l + '\n')
    await sleep(delay + Math.random() * delay)
  }
}

async function progress(label: string, total: number, suffix = '') {
  const span = document.createElement('span')
  screen.append(span)
  for (let i = 0; i <= 20; i++) {
    const pct = Math.round((i / 20) * 100)
    const done = Math.round((i / 20) * total)
    span.textContent = `${label}: ${String(pct).padStart(3)}% (${done}/${total})${i === 20 ? `, done${suffix}.` : ''}`
    scrollToEnd()
    await sleep(35)
  }
  appendHtml('\n')
}

const ok = (s: string) => `<span class="ok">${s}</span>`

const runners: Record<string, () => Promise<void>> = {
  async commit() {
    await command('git add -A')
    await command(`git commit -m "${COMMIT_MSG}"`)
    await lines([
      `[${BRANCH} ${hex(7)}] ${COMMIT_MSG}`,
      ` 1 file changed, 18 insertions(+), 2 deletions(-)`,
      ` create mode 100644 src/scene/beacon.ts`,
    ])
  },
  async push() {
    await command(`git push -u origin ${BRANCH}`)
    await lines(['Enumerating objects: 8, done.'], 25)
    await progress('Writing objects', 5, ' | 1.2 KiB')
    await lines([
      `Total 5 (delta 2), reused 0 (delta 0), pack-reused 0`,
      `To ${REPO}.git`,
      ` * [new branch]      ${BRANCH} -> ${BRANCH}`,
      `branch '${BRANCH}' set up to track 'origin/${BRANCH}'.`,
    ])
  },
  async pr() {
    await command('gh pr create --fill --base main')
    await lines([`Creating pull request for <span class="branch">${BRANCH}</span> into <span class="branch">main</span> in example/workspace`, ''], 50)
    await lines([ok(`https://${REPO}/pull/${PR_NUMBER}`), ''], 150)
    for (const check of ['checks queued', 'preview ready']) {
      appendHtml(`<span class="dim">*  ${check}</span>`)
      await sleep(80 + Math.random() * 100)
      screen.lastElementChild!.innerHTML = `${ok('✓')}  ${check}`
      appendHtml('\n')
    }
    await lines(['', ok('All checks were successful'), ''])
  },
}

async function runStep(i: number) {
  if (phase !== 'pipeline' || i !== nextStep) return
  phase = 'running'
  const btn = steps[i]
  btn.classList.add('running')
  updateSteps()
  await runners[btn.dataset.step!]()
  btn.classList.remove('running')
  btn.classList.add('done')
  nextStep++
  if (nextStep < steps.length) {
    phase = 'pipeline'
  } else {
    phase = 'done'
    await sleep(400)
    shipped.hidden = false
  }
  updateSteps()
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

steps.forEach((b, i) => b.addEventListener('click', () => void runStep(i)))

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'Escape') {
    e.preventDefault()
    reset()
    return
  }
  if (phase === 'typing') {
    if (e.key === 'Enter') {
      e.preventDefault()
      openPipeline()
    } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Tab') {
      e.preventDefault()
      hint.classList.add('gone')
      typeChunk()
    }
  } else if (phase === 'pipeline' && e.key === 'Enter') {
    // Enter also advances, handy when the mouse is out of shot.
    e.preventDefault()
    void runStep(nextStep)
  }
})

reset()
