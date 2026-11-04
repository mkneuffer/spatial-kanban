import { mountChrome } from '../chrome'
import { BRANCH, escapeHtml, FILE, getState, stage, subscribe, typedText } from '../shared'

const TREE = [
  { d: 0, name: 'workspace', dir: true },
  { d: 1, name: 'src', dir: true },
  { d: 2, name: 'scene', dir: true },
  { d: 3, name: 'beacon.ts', file: FILE },
  { d: 3, name: 'camera.ts' },
  { d: 3, name: 'routes.ts' },
  { d: 2, name: 'signals', dir: true },
  { d: 3, name: 'bus.ts' },
  { d: 2, name: 'main.ts' },
  { d: 1, name: 'tests', dir: true },
  { d: 2, name: 'beacon.test.ts' },
  { d: 1, name: 'package.json' },
  { d: 1, name: 'vite.config.ts' },
]

const KEYWORDS = /\b(const|let|function|return|if|else|import|from|export|new)\b/g

/** A small TypeScript highlighter: strings, numbers, keywords, calls, properties. */
function highlight(line: string): string {
  const out: string[] = []
  const re = /('[^']*'?|\/\/.*$|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*(?=\()|[A-Za-z_$][\w$]*(?=:)|[A-Za-z_$][\w$]*)/g
  let last = 0
  for (const m of line.matchAll(re)) {
    out.push(escapeHtml(line.slice(last, m.index)))
    const t = m[0]
    let cls = ''
    if (t.startsWith("'")) cls = 'tk-str'
    else if (t.startsWith('//')) cls = 'tk-cmt'
    else if (/^\d/.test(t)) cls = 'tk-num'
    else if (KEYWORDS.test(t)) cls = 'tk-kw'
    else if (line[m.index! + t.length] === '(') cls = 'tk-fn'
    else if (line[m.index! + t.length] === ':') cls = 'tk-prop'
    KEYWORDS.lastIndex = 0
    out.push(cls ? `<span class="${cls}">${escapeHtml(t)}</span>` : escapeHtml(t))
    last = m.index! + t.length
  }
  out.push(escapeHtml(line.slice(last)))
  return out.join('')
}

export function mountEditor() {
  const { body } = mountChrome('editor', `nvim ${FILE} — ~/workspace`)
  body.innerHTML = `
    <div class="editor">
      <aside class="tree" id="tree"></aside>
      <section class="code">
        <div class="tabs"><span class="tab active" id="tab">beacon.ts</span><span class="tab">routes.ts</span></div>
        <pre class="lines" id="lines"></pre>
        <div class="modeline" id="mode"></div>
        <div class="cmdline" id="cmd"></div>
      </section>
    </div>`
  const tree = document.getElementById('tree')!
  tree.innerHTML = TREE.map(
    (n) => `<div class="node ${n.dir ? 'dir' : ''} ${n.file ? 'current' : ''}" style="padding-left:${0.6 + n.d * 1.1}em">${n.dir ? '▾ ' : '  '}${n.name}</div>`,
  ).join('')
  const lines = document.getElementById('lines')!
  const mode = document.getElementById('mode')!
  const cmd = document.getElementById('cmd')!
  const tab = document.getElementById('tab')!
  let cmdTimer = 0

  const render = (flash?: string) => {
    const s = getState()
    const st = stage(s)
    const text = typedText(s)
    const rows = text.split('\n')
    const editing = st === 'idle' || st === 'typing' || st === 'saved'
    lines.innerHTML = rows
      .map((r, i) => {
        const isLast = i === rows.length - 1
        return `<span class="ln">${String(i + 1).padStart(3)}</span>${highlight(r)}${isLast && editing ? '<span class="cursor"></span>' : ''}`
      })
      .join('\n')
    lines.scrollTop = lines.scrollHeight
    const dirty = s.typed > 0 && s.typed !== s.savedTyped
    tab.textContent = `beacon.ts${dirty ? ' ●' : ''}`
    mode.innerHTML = `<span class="mode ${editing ? 'insert' : 'normal'}">${editing ? 'INSERT' : 'NORMAL'}</span> <span class="branch"> ${BRANCH}</span> ${FILE}${dirty ? ' [+]' : ''}<span class="right">ts · utf-8 · ${rows.length}:${rows[rows.length - 1].length + 1}</span>`
    if (flash) {
      cmd.innerHTML = flash
      clearTimeout(cmdTimer)
      cmdTimer = window.setTimeout(() => (cmd.innerHTML = ''), 2500)
    }
  }
  render()
  subscribe((s, prev) => {
    if (s.savedAt && s.savedAt !== prev.savedAt) render(`<span class="dim">:w</span>  "${FILE}" ${s.typed ? typedText(s).split('\n').length : 0}L written`)
    else if (s.commitAt && !prev.commitAt) render(`<span class="dim">-- committed, buffer is read-only --</span>`)
    else render()
  })
}
