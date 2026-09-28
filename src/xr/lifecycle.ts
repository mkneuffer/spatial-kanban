import { IDLE } from '../board/drag'
import { useView } from '../board/viewStore'
import { flushPersistence } from '../app/persistence'
import { pauseAudio, resumeAudio } from '../fx/audio'

/**
 * XR session lifecycle (PLAN §8): what happens when the session is
 * backgrounded (Quest system menu → `visible-blurred`, headset off →
 * `hidden`) and when it ends.
 *
 * On Meta Quest the system "Resume / Quit" dialog is drawn while our page
 * keeps running. Anything that holds on to the session while that dialog is up
 * — a live speech recognizer, a focused text field, a pointer-captured drag
 * whose input source vanished, an audio device — can leave the dialog
 * unresponsive. So on blur we stop all of it, and on end we tear down before
 * the 2D/3D page re-mounts.
 */

type Stopper = () => void
const stoppers = new Set<Stopper>()

/**
 * Register something to stop whenever the session is backgrounded or ends
 * (speech recognition, system-keyboard focus, …). Returns an unregister function.
 */
export function onXRBackground(stop: Stopper): () => void {
  stoppers.add(stop)
  return () => stoppers.delete(stop)
}

/** Stop everything that could hold the session or the system UI. Safe to call repeatedly. */
export function releaseForBackground() {
  for (const stop of [...stoppers]) {
    try {
      stop()
    } catch (err) {
      console.warn('[xr] background cleanup failed', err)
    }
  }
  // Input sources disappear while the system menu is up and never send pointerup: drop any drag.
  const view = useView.getState()
  // (The board clears its per-pointer hover state through its own onXRBackground stopper.)
  if (view.drag.phase !== 'idle' || view.columnDrag) view.set({ drag: IDLE, columnDrag: null })
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
  pauseAudio()
  flushPersistence()
}

/** Wire visibility and end handling for one session. Returns a detach function. */
export function attachSessionLifecycle(session: XRSession): () => void {
  const onVisibility = () => {
    if (session.visibilityState === 'visible') resumeAudio()
    else releaseForBackground()
  }
  const onEnd = () => {
    releaseForBackground()
    // Back on the page: sounds are allowed again.
    resumeAudio()
    detach()
  }
  const detach = () => {
    session.removeEventListener('visibilitychange', onVisibility)
    session.removeEventListener('end', onEnd)
  }
  session.addEventListener('visibilitychange', onVisibility)
  session.addEventListener('end', onEnd)
  return detach
}

let pageListening = false

/** Page-level backgrounding (tab switch, headset sleep): pause audio and save. */
export function listenForPageVisibility() {
  if (pageListening || typeof document === 'undefined') return
  pageListening = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pauseAudio()
      flushPersistence()
    } else resumeAudio()
  })
}
