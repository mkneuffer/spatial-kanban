import { create } from 'zustand'
import type { ID } from '../data/model'
import { cardsInColumn } from '../data/ordering'
import { useBoardStore } from '../data/store'
import { useView } from '../board/viewStore'
import { archiveWithAnimation, truncate } from '../board/effects'
import { switchSkin } from '../board/BoardContent'
import { playSound } from '../fx/audio'
import { onXRBackground } from '../xr/lifecycle'
import { toast } from '../ui/toasts'
import { parseCommand, type ParseResult, type VoiceCommand, type VoiceContext } from './commands'
import { createRecognition, speechSupported, type SpeechRecognitionLike } from './speech'
import { pointerFocus } from './focus'

interface VoiceState {
  supported: boolean
  listening: boolean
  /** What's being heard right now (interim results). */
  heard: string
  /** The last card a command touched, so "it" works in the next one. */
  lastCardId: ID | null
  /** Bumped when someone asks for help, so the 2D app can open the help dialog. */
  helpRequests: number
  start(): void
  stop(): void
  toggle(): void
}

let recognition: SpeechRecognitionLike | null = null
let stopOnBackground: (() => void) | null = null

const undo = { label: 'Undo', run: () => useBoardStore.getState().undo() }

/** "It" is the open card, else the one being dragged, pointed at, or used last. */
export function voiceContext(): VoiceContext {
  const v = useView.getState()
  const pointer = pointerFocus()
  return {
    focusCardId: v.detailCardId ?? v.drag.cardId ?? pointer.cardId ?? useVoice.getState().lastCardId,
    defaultColumnId: pointer.columnId,
  }
}

/** Carries out a parsed command and says what happened. Returns the card it touched. */
export function runCommand(command: VoiceCommand): ID | null {
  const store = useBoardStore.getState()
  const doc = store.doc
  const title = (id: ID) => `“${truncate(doc.cards[id]?.title ?? '')}”`
  const column = (id: ID) => `“${doc.columns[id]?.title ?? ''}”`
  switch (command.kind) {
    case 'create': {
      const card = store.createCard(command.columnId, command.title)
      playSound('pop')
      toast(`Added “${truncate(command.title)}” to ${column(command.columnId)}`, { tone: 'success', action: undo })
      return card.id
    }
    case 'move': {
      const card = doc.cards[command.cardId]
      if (card.columnId === command.columnId) {
        toast(`${title(card.id)} is already in ${column(command.columnId)}`)
        return card.id
      }
      store.moveCard(card.id, command.columnId, cardsInColumn(doc.cards, command.columnId).length)
      playSound('drop')
      toast(`Moved ${title(card.id)} to ${column(command.columnId)}`, { tone: 'success', action: undo })
      return card.id
    }
    case 'rename': {
      const before = title(command.cardId)
      store.dispatch({ type: 'card/update', id: command.cardId, changes: { title: command.title } })
      toast(`Renamed ${before} to “${truncate(command.title)}”`, { tone: 'success', action: undo })
      return command.cardId
    }
    case 'describe':
      store.dispatch({ type: 'card/update', id: command.cardId, changes: { description: command.text } })
      toast(`Updated the description of ${title(command.cardId)}`, { tone: 'success', action: undo })
      return command.cardId
    case 'archive':
      archiveWithAnimation(command.cardId)
      return null
    case 'open':
      useView.getState().select(command.cardId)
      return command.cardId
    case 'undo':
      if (!store.past.length) toast('Nothing to undo')
      else (store.undo(), toast('Undone'))
      return null
    case 'redo':
      if (!store.future.length) toast('Nothing to redo')
      else (store.redo(), toast('Redone'))
      return null
    case 'skin':
      switchSkin(command.skinId)
      return null
    case 'help':
      useVoice.setState((s) => ({ helpRequests: s.helpRequests + 1 }))
      // Outside a headset the help dialog opens instead.
      if (useView.getState().mode === 'xr') toast('Try “new card …”, “move … to …”, “rename … to …”, “archive …”, “undo”.', { ms: 7000 })
      return null
  }
}

/** Parses the recognizer's alternatives and runs the first one that makes sense. */
export function handleHeard(alternatives: string[]): ParseResult {
  const doc = useBoardStore.getState().doc
  const ctx = voiceContext()
  const results = alternatives.map((a) => parseCommand(a, doc, ctx))
  const result = results.find((r) => r.ok) ?? results[0] ?? { ok: false, reason: 'I didn’t catch that.' }
  if (result.ok) {
    const touched = runCommand(result.command)
    if (touched) useVoice.setState({ lastCardId: touched })
  } else {
    toast(result.reason, { tone: 'warn', ms: 5000 })
  }
  return result
}

export const useVoice = create<VoiceState>()((set, get) => ({
  supported: speechSupported(),
  listening: false,
  heard: '',
  lastCardId: null,
  helpRequests: 0,

  start() {
    if (get().listening) return
    const r = createRecognition()
    if (!r) {
      toast('Voice commands need a browser with speech recognition (Chrome, Edge, Quest Browser, Safari).', { tone: 'warn', ms: 6000 })
      return
    }
    r.maxAlternatives = 3
    recognition = r
    let handled = false
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1]
      if (!last) return
      set({ heard: last[0]?.transcript ?? '' })
      if (!last.isFinal || handled) return
      handled = true
      const alts = Array.from({ length: last.length }, (_, i) => last[i].transcript).filter(Boolean)
      handleHeard(alts)
    }
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone access is blocked. Allow it for this site to use voice commands.', { tone: 'warn', ms: 7000 })
      else if (e.error === 'no-speech') toast('I didn’t hear anything.', { ms: 3000 })
      else if (e.error === 'network') toast('Speech recognition needs a connection.', { tone: 'warn' })
    }
    r.onend = () => {
      recognition = null
      stopOnBackground?.()
      stopOnBackground = null
      set({ listening: false, heard: '' })
    }
    stopOnBackground = onXRBackground(() => r.stop())
    set({ listening: true, heard: '' })
    playSound('tick')
    try {
      r.start()
    } catch {
      set({ listening: false })
    }
  },

  stop() {
    recognition?.stop()
  },

  toggle() {
    if (get().listening) get().stop()
    else get().start()
  },
}))
