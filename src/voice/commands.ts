import type { BoardDoc, Card, Column, ID } from '../data/model'
import { byOrderKey, cardsInColumn } from '../data/ordering'

/**
 * Voice commands without AI: a small grammar over what the Web Speech API
 * heard, resolved against the board. Pure, so it's unit-tested; `run.ts`
 * carries the commands out.
 */
export type VoiceCommand =
  | { kind: 'create'; title: string; columnId: ID }
  | { kind: 'move'; cardId: ID; columnId: ID }
  | { kind: 'rename'; cardId: ID; title: string }
  | { kind: 'describe'; cardId: ID; text: string }
  | { kind: 'archive'; cardId: ID }
  | { kind: 'open'; cardId: ID }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'skin'; skinId: 'whiteboard' | 'projects' }
  | { kind: 'help' }

export type ParseResult = { ok: true; command: VoiceCommand } | { ok: false; reason: string }

export interface VoiceContext {
  /** The card "it" / "this card" refers to: the open, hovered or last-mentioned card. */
  focusCardId?: ID | null
  /** Where new cards go when no column is named (e.g. the hovered column). */
  defaultColumnId?: ID | null
}

// ——— text helpers ———

const STOP = new Set(['the', 'a', 'an', 'card', 'task', 'sticky', 'note', 'item', 'issue', 'called', 'named', 'titled', 'about', 'for', 'of', 'to', 'on', 'in'])

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .trim()
}

const words = (s: string) => normalize(s).split(' ').filter(Boolean)
const keyWords = (s: string) => words(s).filter((w) => !STOP.has(w))
/** "to do" and "todo", "in progress" and "inprogress" compare equal. */
const squash = (s: string) => normalize(s).replace(/\s+/g, '')

/** Tidy what was heard into a title: trimmed, no trailing period, first letter capitalised. */
export function asTitle(s: string): string {
  const t = s.trim().replace(/[.!?]+$/, '').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

// ——— resolving columns and cards ———

const DONE_WORDS = /^(done|finished|complete|completed|closed|shipped)$/
const ORDINALS: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, '1st': 0, '2nd': 1, '3rd': 2, '4th': 3, '5th': 4 }

export function findColumn(doc: BoardDoc, phrase: string): Column | null {
  const cols = doc.board.columnIds.map((id) => doc.columns[id]).filter(Boolean)
  const p = normalize(phrase).replace(/^the /, '').replace(/ (column|list|lane)$/, '')
  if (!p) return null
  const flat = squash(p)
  const exact = cols.find((c) => squash(c.title) === flat)
  if (exact) return exact
  if (p === 'last') return cols[cols.length - 1] ?? null
  if (p in ORDINALS) return cols[ORDINALS[p]] ?? null
  if (DONE_WORDS.test(p)) return cols.find((c) => words(c.title).some((w) => DONE_WORDS.test(w))) ?? cols[cols.length - 1] ?? null
  // "progress" for "In progress", "review" for "In review".
  const pw = keyWords(p)
  const partial = cols.filter((c) => pw.length > 0 && pw.every((w) => words(c.title).some((t) => t.startsWith(w) || w.startsWith(t))))
  return partial.length === 1 ? partial[0] : null
}

const PRONOUNS = /^(it|this|that|this one|that one|this card|that card|the card|this sticky|that sticky|this task|that task|this note|that note)$/

type CardMatch = { card: Card } | { error: string }

/** Scores how well a spoken phrase names a card title (0…1). */
function titleScore(phraseWords: string[], title: string): number {
  if (!phraseWords.length) return 0
  const tw = keyWords(title)
  if (!tw.length) return 0
  let hit = 0
  for (const w of phraseWords) if (tw.some((t) => t === w || (w.length >= 4 && (t.startsWith(w) || w.startsWith(t))))) hit++
  // Mostly about how much of what was said matches, a little about covering the title.
  return (hit / phraseWords.length) * 0.8 + (hit / tw.length) * 0.2
}

export function findCard(doc: BoardDoc, phrase: string, ctx: VoiceContext): CardMatch {
  const p = normalize(phrase)
  const live = Object.values(doc.cards).filter((c) => !c.archived)
  if (PRONOUNS.test(p)) {
    const card = ctx.focusCardId ? doc.cards[ctx.focusCardId] : undefined
    return card && !card.archived ? { card } : { error: 'Which card? Point at one or say its title.' }
  }
  // "card 104", "number 104", "#104", "ENG 12"
  const num = p.match(/^(?:card |number |ticket |issue |#)?#?(\d+)$/)
  if (num) {
    const n = Number(num[1])
    const card = live.find((c) => c.number === n || c.externalRef?.key?.replace(/\D/g, '') === num[1])
    if (card) return { card }
  }
  const key = squash(p)
  const byKey = live.find((c) => c.externalRef?.key && squash(c.externalRef.key) === key)
  if (byKey) return { card: byKey }
  // "the first/last card in Done"
  const pos = p.match(/^(?:the )?(first|top|last|bottom) (?:card|task|sticky|note|one)? ?(?:in|on|of) (.+)$/)
  if (pos) {
    const col = findColumn(doc, pos[2])
    if (col) {
      const list = cardsInColumn(doc.cards, col.id)
      const card = /first|top/.test(pos[1]) ? list[0] : list[list.length - 1]
      return card ? { card } : { error: `${col.title} is empty.` }
    }
  }
  const pw = keyWords(p)
  if (!pw.length) return { error: 'Which card? Say its title.' }
  const exact = live.filter((c) => normalize(c.title) === p)
  if (exact.length === 1) return { card: exact[0] }
  const scored = live.map((card) => ({ card, score: titleScore(pw, card.title) })).sort((a, b) => b.score - a.score || byOrderKey(a.card, b.card))
  const [best, second] = scored
  if (!best || best.score < 0.6) return { error: `No card matches “${phrase.trim()}”.` }
  if (second && best.score - second.score < 0.12) return { error: `“${phrase.trim()}” matches more than one card. Say more of the title.` }
  return { card: best.card }
}

// ——— grammar ———

const CREATE = /^(?:please )?(?:new|add|create|make|start)(?: a| an| another)? (?:new )?(?:card|task|sticky(?: note)?|note|item|issue|ticket|todo)\b[,:]?\s*(.*)$/i
const NAMED = /^(?:called|named|titled|saying|that says)\s+/i
const LEADING_COLUMN = /^(?:in|to|into|under|on)\s+(?:the\s+)?(.+?)\s+(?:column\s+|list\s+)?(?:called|named|titled|saying|that says)\s+(.+)$/i
const TRAILING_COLUMN = /^(.+?)\s+(?:in|to|into|under|on)\s+(?:the\s+)?(.+?)(?:\s+(?:column|list|lane))?$/i
const ADD_TO = /^(?:please )?add\s+(.+?)\s+to\s+(?:the\s+)?(.+?)(?:\s+(?:column|list|lane))?$/i
const MOVE = /^(?:please )?(?:move|put|drag|send|shift|take)\s+(.+)$/i
const MARK_DONE = /^(?:please )?(?:mark|set)\s+(.+?)\s+(?:as\s+)?(done|finished|complete|completed)$/i
const RENAME = /^(?:please )?(?:rename|retitle|change|edit|update)\s+(?:the\s+(?:title|name)\s+of\s+)?(.+)$/i
const DESCRIBE = /^(?:please )?(?:describe\s+(.+?)\s+as|(?:add|set)\s+(?:a\s+|the\s+)?(?:description|details|note|notes)\s+(?:to|for|of|on)\s+(.+?)(?:\s+(?:to|saying|that says|as))?)[,:]?\s+(.+)$/i
const ARCHIVE = /^(?:please )?(?:archive|remove|delete|trash|bin|discard|throw away|get rid of)\s+(.+)$/i
const OPEN = /^(?:please )?(?:open|show me|show|select|details for|details of|view)\s+(.+)$/i
const SKIN = /^(?:switch|change|go|swap)\s+(?:to\s+)?(?:the\s+)?(whiteboard|sticky notes?|projects?|github|board view)(?:\s+(?:skin|view|mode|look))?$/i

function strip(s: string): string {
  return s.trim().replace(/[.!?]+$/, '').trim()
}

/** Split "A to B" at each " to " (or other separator) and return the first split both sides accept. */
function splitAt<T>(text: string, sep: RegExp, accept: (left: string, right: string) => T | null): T | null {
  const parts = [...text.matchAll(new RegExp(sep.source, 'gi'))]
  for (const m of parts) {
    const left = text.slice(0, m.index).trim()
    const right = text.slice(m.index! + m[0].length).trim()
    if (!left || !right) continue
    const got = accept(left, right)
    if (got) return got
  }
  return null
}

export function parseCommand(heard: string, doc: BoardDoc, ctx: VoiceContext = {}): ParseResult {
  const text = strip(heard)
  const n = normalize(text)
  if (!n) return { ok: false, reason: 'I didn’t catch that.' }

  if (/^(undo|undo that|go back|take that back)$/.test(n)) return { ok: true, command: { kind: 'undo' } }
  if (/^(redo|redo that)$/.test(n)) return { ok: true, command: { kind: 'redo' } }
  if (/^(help|what can i say|voice commands?|commands|what can you do)$/.test(n)) return { ok: true, command: { kind: 'help' } }

  const skin = text.match(SKIN)
  if (skin) return { ok: true, command: { kind: 'skin', skinId: /white|sticky/i.test(skin[1]) ? 'whiteboard' : 'projects' } }

  // Before "create": "add a note to <card> saying …" describes a card that exists.
  const describe = text.match(DESCRIBE)
  if (describe) {
    const found = findCard(doc, describe[1] ?? describe[2], ctx)
    if (!('error' in found)) return { ok: true, command: { kind: 'describe', cardId: found.card.id, text: asTitle(describe[3]) } }
    if (describe[1]) return { ok: false, reason: found.error }
  }

  const defaultColumn = () => (ctx.defaultColumnId && doc.columns[ctx.defaultColumnId] ? ctx.defaultColumnId : doc.board.columnIds[0])

  // Create: "new card fix the login bug", "add a sticky to Done called ship it",
  // "new task write docs in review", "add buy milk to To do".
  const create = text.match(CREATE)
  if (create) {
    let rest = create[1].trim()
    if (!rest) return { ok: false, reason: 'What should the new card say? Try “new card” followed by its title.' }
    const lead = rest.match(LEADING_COLUMN)
    if (lead) {
      const col = findColumn(doc, lead[1])
      if (col) return { ok: true, command: { kind: 'create', title: asTitle(lead[2]), columnId: col.id } }
    }
    rest = rest.replace(NAMED, '')
    const trail = rest.match(TRAILING_COLUMN)
    if (trail) {
      const col = findColumn(doc, trail[2])
      if (col) return { ok: true, command: { kind: 'create', title: asTitle(trail[1]), columnId: col.id } }
    }
    return { ok: true, command: { kind: 'create', title: asTitle(rest), columnId: defaultColumn() } }
  }

  const done = text.match(MARK_DONE)
  if (done) {
    const found = findCard(doc, done[1], ctx)
    if ('error' in found) return { ok: false, reason: found.error }
    const col = findColumn(doc, done[2])!
    return { ok: true, command: { kind: 'move', cardId: found.card.id, columnId: col.id } }
  }

  const move = text.match(MOVE)
  if (move) {
    let lastError = ''
    const hit = splitAt(move[1], /\s+(?:to|into|over to|onto|in)\s+/, (left, right) => {
      const col = findColumn(doc, right)
      if (!col) return null
      const found = findCard(doc, left, ctx)
      if ('error' in found) {
        lastError = found.error
        return null
      }
      return { kind: 'move' as const, cardId: found.card.id, columnId: col.id }
    })
    if (hit) return { ok: true, command: hit }
    return { ok: false, reason: lastError || 'Move which card to which column? Try “move” card “to” column.' }
  }

  const rename = text.match(RENAME)
  if (rename) {
    let lastError = ''
    const hit = splitAt(rename[1], /\s+to\s+/, (left, right) => {
      const found = findCard(doc, left, ctx)
      if ('error' in found) {
        lastError = found.error
        return null
      }
      return { kind: 'rename' as const, cardId: found.card.id, title: asTitle(right) }
    })
    if (hit) return { ok: true, command: hit }
    // "edit this card" with no new title opens it for editing.
    const found = findCard(doc, rename[1], ctx)
    if (!('error' in found)) return { ok: true, command: { kind: 'open', cardId: found.card.id } }
    return { ok: false, reason: lastError || 'Rename which card? Try “rename” card “to” new title.' }
  }

  // "call it ship the beta" renames the focused card.
  const callIt = text.match(/^(?:call|name|title)\s+(it|this|this card|that card)\s+(.+)$/i)
  if (callIt) {
    const found = findCard(doc, callIt[1], ctx)
    if ('error' in found) return { ok: false, reason: found.error }
    return { ok: true, command: { kind: 'rename', cardId: found.card.id, title: asTitle(callIt[2]) } }
  }

  const add = text.match(ADD_TO)
  if (add) {
    const col = findColumn(doc, add[2])
    if (col) return { ok: true, command: { kind: 'create', title: asTitle(add[1]), columnId: col.id } }
  }

  const archive = text.match(ARCHIVE)
  if (archive) {
    const found = findCard(doc, archive[1], ctx)
    if ('error' in found) return { ok: false, reason: found.error }
    return { ok: true, command: { kind: 'archive', cardId: found.card.id } }
  }

  const open = text.match(OPEN)
  if (open) {
    const found = findCard(doc, open[1], ctx)
    if ('error' in found) return { ok: false, reason: found.error }
    return { ok: true, command: { kind: 'open', cardId: found.card.id } }
  }

  return { ok: false, reason: `Not a command I know: “${text}”. Say “help” for examples.` }
}

/** Examples shown in help (and used by the tests). */
export const VOICE_EXAMPLES: Array<[string, string]> = [
  ['New card fix the login bug', 'adds a card to the first (or pointed-at) column'],
  ['Add a sticky to Done called ship the beta', 'adds a card to a named column'],
  ['Move login bug to In progress', 'moves a card; “it” means the card you’re pointing at or just used'],
  ['Mark login bug done', 'moves a card to the done column'],
  ['Rename login bug to fix the sign-in bug', 'changes a card’s title'],
  ['Describe it as happens on Safari only', 'sets the description'],
  ['Archive card 104', 'archives a card (by title, number or key like ENG-12)'],
  ['Open login bug', 'shows a card’s details'],
  ['Undo · Redo', ''],
  ['Switch to whiteboard · Switch to projects', 'changes the skin'],
]
