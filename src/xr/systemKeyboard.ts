import { xrStore, useXRApp } from './session'
import { onXRBackground } from './lifecycle'

/**
 * The platform's own keyboard in immersive XR (PLAN §6.5).
 *
 * Meta Quest Browser reports `XRSession.isSystemKeyboardSupported` and shows
 * the system keyboard, on top of the immersive scene, when a DOM text field is
 * focused. Focusing needs user activation: call `openSystemKeyboard` directly
 * from a click handler (pmndrs dispatches 3D clicks synchronously inside the
 * XR `selectend` event, so a 3D button click counts).
 *
 * One hidden `<input>` is shared by every editor; the 3D keyboard panel
 * mirrors its value and remains available as a fallback.
 */

let input: HTMLInputElement | null = null

export const MAX_TITLE = 140

function element(): HTMLInputElement {
  if (input) return input
  const el = document.createElement('input')
  el.type = 'text'
  el.maxLength = MAX_TITLE
  el.autocomplete = 'off'
  el.spellcheck = true
  el.setAttribute('autocapitalize', 'sentences')
  el.setAttribute('enterkeyhint', 'done')
  el.setAttribute('aria-label', 'Card title')
  el.dataset.xrKeyboard = ''
  // Off-screen but focusable (display:none or visibility:hidden can't take focus).
  Object.assign(el.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', border: '0', padding: '0' })
  document.body.appendChild(el)
  input = el
  onXRBackground(closeSystemKeyboard)
  return el
}

/** True in a headset session whose browser can show its system keyboard. */
export function systemKeyboardAvailable(): boolean {
  const session = xrStore.getState().session as (XRSession & { isSystemKeyboardSupported?: boolean }) | undefined
  // Phone AR edits in the DOM overlay, which gets the OS keyboard on its own.
  return !!session && session.isSystemKeyboardSupported === true && !useXRApp.getState().caps.domOverlay
}

/**
 * Show the system keyboard, optionally resetting the text. Returns true if the
 * field took focus. Call from a click handler.
 */
export function openSystemKeyboard(initial?: string): boolean {
  if (!systemKeyboardAvailable()) return false
  const el = element()
  if (initial !== undefined) el.value = initial.slice(0, MAX_TITLE)
  try {
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  } catch {
    return false
  }
  return document.activeElement === el
}

export function closeSystemKeyboard() {
  if (input && document.activeElement === input) input.blur()
}

/** The shared field, created on first use. */
export function systemKeyboardInput(): HTMLInputElement {
  return element()
}
