import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { useDeviceCaps } from '../../xr/capabilities'
import { onXRBackground } from '../../xr/lifecycle'
import { createRecognition, type SpeechRecognitionLike } from '../../voice/speech'
import { closeSystemKeyboard, MAX_TITLE, openSystemKeyboard, systemKeyboardAvailable, systemKeyboardInput } from '../../xr/systemKeyboard'
import { playSound } from '../../fx/audio'
import { useSettings } from '../../data/settings'
import { canvasMeasure } from '../../board/text'
import { Button3D, Label, Panel, UI } from './primitives'

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const KEY_W = 0.04
const KEY_H = 0.046
const GAP = 0.0055

/**
 * Text input in XR (PLAN §6.5). Uses the headset's system keyboard when the
 * browser offers one (Meta Quest), with this panel mirroring the text; falls
 * back to a compact 3D keyboard. Voice dictation through the Web Speech API
 * where available.
 */
export function Keyboard3D({
  initial,
  title = 'Card title',
  onSubmit,
  onCancel,
  anchor = 'center',
}: {
  initial: string
  title?: string
  onSubmit(text: string): void
  onCancel(): void
  /** 'top': the panel hangs below its origin (so it can grow and shrink under another panel). */
  anchor?: 'center' | 'top'
}) {
  const [text, setTextState] = useState(initial)
  const [shift, setShift] = useState(!initial)
  const [listening, setListening] = useState(false)
  const [system] = useState(() => systemKeyboardAvailable())
  const [systemFocused, setSystemFocused] = useState(false)
  const [showKeys, setShowKeys] = useState(!system)
  const speech = useDeviceCaps((s) => s.speech)
  const rec = useRef<SpeechRecognitionLike | null>(null)
  const base = useRef('')
  const latest = useRef({ text, onSubmit, onCancel })
  latest.current = { text, onSubmit, onCancel }

  const setText = (next: string | ((t: string) => string)) => {
    setTextState((t) => {
      const value = (typeof next === 'function' ? next(t) : next).slice(0, MAX_TITLE)
      // Keep the system keyboard's field in step with 3D keys and dictation.
      if (system) {
        const el = systemKeyboardInput()
        if (el.value !== value) el.value = value
      }
      return value
    })
  }

  useEffect(() => {
    const stopVoice = onXRBackground(() => rec.current?.stop())
    return () => {
      stopVoice()
      rec.current?.stop()
    }
  }, [])

  // System keyboard: mirror the hidden field, submit on Enter, cancel on Escape.
  useEffect(() => {
    if (!system) return
    const el = systemKeyboardInput()
    el.value = initial
    const onInput = () => setTextState(el.value.slice(0, MAX_TITLE))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const t = latest.current.text.trim()
        if (t) latest.current.onSubmit(t)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        latest.current.onCancel()
      }
    }
    const onFocus = () => setSystemFocused(true)
    const onBlur = () => setSystemFocused(false)
    el.addEventListener('input', onInput)
    el.addEventListener('keydown', onKey)
    el.addEventListener('focus', onFocus)
    el.addEventListener('blur', onBlur)
    // The opener normally focused the field inside its click; try again in case it didn't.
    if (document.activeElement !== el) openSystemKeyboard()
    setSystemFocused(document.activeElement === el)
    return () => {
      el.removeEventListener('input', onInput)
      el.removeEventListener('keydown', onKey)
      el.removeEventListener('focus', onFocus)
      el.removeEventListener('blur', onBlur)
      closeSystemKeyboard()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system])

  const type = (ch: string) => {
    playSound('key')
    setText((t) => t + (shift ? ch.toUpperCase() : ch))
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
  const keysH = showKeys ? 5 * (KEY_H + GAP) : 0
  const height = 0.13 + keysH + (showKeys ? 0.005 : 0.05)
  const top = height / 2
  const fieldW = width - 0.03
  const fieldBorder = listening ? UI.danger : system && systemFocused ? UI.success : UI.accent
  const hint = listening ? 'Listening… speak now' : system ? (systemFocused ? 'Type on the system keyboard · Enter to save' : 'Tap the field to show the keyboard') : null

  const actions: Array<{ label: string; w: number; on: () => void; variant?: 'primary' | 'danger' | 'default'; active?: boolean; disabled?: boolean }> = []
  if (showKeys) {
    actions.push({ label: 'Aa', w: 0.056, on: () => setShift((v) => !v), active: shift })
  }
  if (system) actions.push({ label: showKeys ? 'Hide keys' : 'Keys', w: showKeys ? 0.09 : 0.06, on: () => setShowKeys((v) => !v), active: showKeys })
  actions.push({ label: speech ? (listening ? 'Stop' : 'Dictate') : 'Voice n/a', w: 0.074, on: toggleVoice, active: listening, disabled: !speech })
  if (showKeys) {
    actions.push({ label: 'space', w: system ? 0.07 : 0.13, on: () => type(' ') })
    actions.push({ label: 'Del', w: 0.052, on: () => setText((t) => t.slice(0, -1)) })
  } else {
    actions.push({ label: 'Keyboard', w: 0.09, on: () => openSystemKeyboard(), active: systemFocused })
  }
  actions.push({ label: 'Cancel', w: 0.066, on: onCancel, variant: 'danger' })
  actions.push({ label: 'Done', w: 0.066, on: () => onSubmit(text.trim()), variant: 'primary', disabled: !text.trim() })
  const shown = fitTail(text, fieldW - 0.04)
  const totalW = actions.reduce((sum, a) => sum + a.w, 0) + (actions.length - 1) * GAP
  const scale = Math.min(1, fieldW / totalW)

  return (
    <Panel width={width} height={height} radius={0.022} position={anchor === 'top' ? [0, -height / 2, 0] : undefined}>
      <Label size={0.016} color={UI.muted} anchorX="left" position={[-width / 2 + 0.016, top - 0.022, 0]}>
        {title}
      </Label>
      {hint && (
        <Label size={0.0135} color={listening ? UI.danger : UI.muted} anchorX="right" position={[width / 2 - 0.016, top - 0.022, 0]}>
          {hint}
        </Label>
      )}
      {/* Text field — tapping it brings the system keyboard back. */}
      <group position={[0, top - 0.068, 0]}>
        <Panel width={fieldW} height={0.056} radius={0.012} color="#070a0e" border={fieldBorder} interactive={false}>
          <Label size={FIELD_TEXT} anchorX="left" position={[-fieldW / 2 + 0.014, 0, 0]}>
            {shown.text || ' '}
          </Label>
          <Caret x={-fieldW / 2 + 0.014 + shown.width} />
        </Panel>
        {system && (
          <mesh
            position={[0, 0, 0.004]}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              openSystemKeyboard()
            }}
          >
            <planeGeometry args={[fieldW, 0.056]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        )}
      </group>
      {showKeys &&
        ROWS.map((row, r) => {
          const rowW = row.length * KEY_W + (row.length - 1) * GAP
          const y = top - 0.13 - r * (KEY_H + GAP)
          return row.split('').map((ch, i) => (
            <Button3D
              key={`${r}-${ch}`}
              label={shift ? ch.toUpperCase() : ch}
              width={KEY_W}
              height={KEY_H}
              fontSize={0.021}
              position={[-rowW / 2 + KEY_W / 2 + i * (KEY_W + GAP), y, 0]}
              onClick={() => type(ch)}
            />
          ))
        })}
      <group position={[0, -height / 2 + 0.016 + KEY_H / 2, 0]} scale={[scale, scale, 1]}>
        {(() => {
          let x = -totalW / 2
          return actions.map((it) => {
            const pos: [number, number, number] = [x + it.w / 2, 0, 0]
            x += it.w + GAP
            return (
              <Button3D
                key={it.label}
                label={it.label}
                width={it.w}
                height={KEY_H}
                fontSize={0.0155}
                position={pos}
                onClick={it.on}
                variant={it.variant}
                active={it.active}
                disabled={it.disabled}
              />
            )
          })
        })()}
      </group>
    </Panel>
  )
}

const FIELD_TEXT = 0.024

/** The end of `text` that fits in `maxW` (what you're typing stays in view), with its width. */
function fitTail(text: string, maxW: number): { text: string; width: number } {
  const measure = (t: string) => canvasMeasure(t, 'Inter', FIELD_TEXT, 500)
  let t = text
  let w = measure(t)
  if (w <= maxW) return { text: t, width: w }
  let start = 0
  while (start < text.length && w > maxW) {
    start++
    t = `…${text.slice(start)}`
    w = measure(t)
  }
  return { text: t, width: w }
}

/** Blinking text caret after the last character. */
function Caret({ x }: { x: number }) {
  const ref = useRef<Group>(null)
  const reduced = useSettings((s) => s.reducedMotion)
  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.visible = reduced || Math.floor(clock.elapsedTime * 1.8) % 2 === 0
  })
  return (
    <group ref={ref} position={[x + 0.003, 0, 0.002]}>
      <mesh raycast={() => {}}>
        <planeGeometry args={[0.0022, 0.03]} />
        <meshBasicMaterial color={UI.accent} />
      </mesh>
    </group>
  )
}
