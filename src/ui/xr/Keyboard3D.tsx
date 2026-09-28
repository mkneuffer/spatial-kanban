import { useEffect, useRef, useState } from 'react'
import { useDeviceCaps } from '../../xr/capabilities'
import { playSound } from '../../fx/audio'
import { Button3D, Label, Panel, UI } from './primitives'

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const KEY_W = 0.036
const KEY_H = 0.042
const GAP = 0.005

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: unknown) => void) | null
}

function createRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = navigator.language || 'en-US'
  r.interimResults = true
  r.continuous = false
  return r
}

/**
 * Text input in XR (PLAN §6.5): a compact 3D keyboard for short titles, with
 * voice dictation through the Web Speech API where available.
 */
export function Keyboard3D({ initial, title = 'Card title', onSubmit, onCancel }: { initial: string; title?: string; onSubmit(text: string): void; onCancel(): void }) {
  const [text, setText] = useState(initial)
  const [shift, setShift] = useState(true)
  const [listening, setListening] = useState(false)
  const speech = useDeviceCaps((s) => s.speech)
  const rec = useRef<SpeechRecognitionLike | null>(null)
  const base = useRef('')

  useEffect(() => () => rec.current?.stop(), [])

  const type = (ch: string) => {
    playSound('key')
    setText((t) => (t + (shift ? ch.toUpperCase() : ch)).slice(0, 140))
    if (shift) setShift(false)
  }

  const toggleVoice = () => {
    if (listening) {
      rec.current?.stop()
      return
    }
    const r = createRecognition()
    if (!r) return
    rec.current = r
    base.current = text ? `${text} ` : ''
    r.onresult = (e) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript
      const joined = (base.current + transcript).replace(/\s+/g, ' ').trimStart()
      setText(joined.charAt(0).toUpperCase() + joined.slice(1))
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    setListening(true)
    r.start()
  }

  const width = 10 * KEY_W + 9 * GAP + 0.03
  const height = 0.36
  const top = height / 2
  return (
    <Panel width={width} height={height} radius={0.022}>
      <Label size={0.014} color={UI.muted} anchorX="left" position={[-width / 2 + 0.016, top - 0.02, 0]}>
        {title}
      </Label>
      {/* Text field */}
      <Panel width={width - 0.03} height={0.05} radius={0.01} color="#070a0e" border={listening ? UI.danger : UI.accent} position={[0, top - 0.058, 0]}>
        <Label size={0.02} anchorX="left" position={[-(width - 0.03) / 2 + 0.012, 0, 0]} maxWidth={width - 0.06}>
          {`${text}|`}
        </Label>
      </Panel>
      {ROWS.map((row, r) => {
        const rowW = row.length * KEY_W + (row.length - 1) * GAP
        const y = top - 0.115 - r * (KEY_H + GAP)
        return row.split('').map((ch, i) => (
          <Button3D
            key={`${r}-${ch}`}
            label={shift ? ch.toUpperCase() : ch}
            width={KEY_W}
            height={KEY_H}
            fontSize={0.018}
            position={[-rowW / 2 + KEY_W / 2 + i * (KEY_W + GAP), y, 0]}
            onClick={() => type(ch)}
          />
        ))
      })}
      {/* Bottom row */}
      {(() => {
        const y = top - 0.115 - 4 * (KEY_H + GAP)
        const left = -width / 2 + 0.015
        const items: Array<{ label: string; w: number; on: () => void; variant?: 'primary' | 'danger' | 'default'; active?: boolean; disabled?: boolean }> = [
          { label: 'Aa', w: 0.05, on: () => setShift((s) => !s), active: shift },
          { label: speech ? (listening ? 'Stop' : 'Dictate') : 'Voice n/a', w: 0.07, on: toggleVoice, active: listening, disabled: !speech },
          { label: 'space', w: 0.118, on: () => type(' ') },
          { label: 'Del', w: 0.05, on: () => setText((t) => t.slice(0, -1)) },
          { label: 'Cancel', w: 0.06, on: onCancel, variant: 'danger' },
          { label: 'Done', w: 0.055, on: () => onSubmit(text.trim()), variant: 'primary', disabled: !text.trim() },
        ]
        let x = left
        return items.map((it) => {
          const pos: [number, number, number] = [x + it.w / 2, y, 0]
          x += it.w + GAP
          return (
            <Button3D
              key={it.label}
              label={it.label}
              width={it.w}
              height={KEY_H}
              fontSize={0.014}
              position={pos}
              onClick={it.on}
              variant={it.variant}
              active={it.active}
              disabled={it.disabled}
            />
          )
        })
      })()}
    </Panel>
  )
}
