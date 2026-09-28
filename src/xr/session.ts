import { createXRStore } from '@react-three/xr'
import { create } from 'zustand'
import type { PlacementMode } from '../data/model'
import { useView, type ViewMode } from '../board/viewStore'
import { unlockAudio } from '../fx/audio'
import { detectSessionCapabilities, EMPTY_SESSION_CAPS, type SessionCapabilities } from './capabilities'
import { KanbanHand } from './hands/KanbanHand'

/**
 * The XR store (pmndrs/xr). Everything optional so the session starts on the
 * widest range of devices (PLAN §10); `session.enabledFeatures` then fills the
 * capabilities object.
 */
export const xrStore = createXRStore({
  offerSession: false,
  enterGrantedSession: false,
  // Dev emulation is installed by ./emulator (IWER), which also handles embedded browsers.
  emulate: false,
  hitTest: true,
  anchors: true,
  planeDetection: true,
  meshDetection: false,
  handTracking: true,
  domOverlay: true,
  layers: false,
  bodyTracking: false,
  frameRate: 'high',
  foveation: 0.5,
  // Meta Dark v6 hands with pinch-point grab and a working fingertip poke (see ./hands).
  hand: KanbanHand,
  controller: { teleportPointer: false, rayPointer: true, grabPointer: true },
})

export type XRPhase =
  | 'inactive'
  | 'restoring' // looking for the persisted anchor
  | 'notFound' // restore failed → offer to place again
  | 'choose' // pick wall / desk / float
  | 'placing' // ghost board follows the pointer
  | 'adjusting' // placed; move/resize handles emphasized, "Done"
  | 'working'

interface XRAppState {
  phase: XRPhase
  placingMode: PlacementMode
  /** When the current phase started (guards against the same click confirming placement). */
  phaseAt: number
  tracking: 'ok' | 'lost'
  menuOpen: boolean
  caps: SessionCapabilities
  /** Mode the app returns to when the session ends. */
  returnMode: ViewMode
  setPhase(phase: XRPhase): void
  set(changes: Partial<Omit<XRAppState, 'set' | 'setPhase'>>): void
}

export const useXRApp = create<XRAppState>()((set) => ({
  phase: 'inactive',
  placingMode: 'wall',
  phaseAt: 0,
  tracking: 'ok',
  menuOpen: false,
  caps: EMPTY_SESSION_CAPS,
  returnMode: '3d',
  setPhase: (phase) => set({ phase, phaseAt: performance.now() }),
  set: (changes) => set(changes),
}))

let listening = false
function listenForSessionChanges() {
  if (listening) return
  listening = true
  let prev: XRSession | undefined
  xrStore.subscribe((state) => {
    if (state.session === prev) return
    prev = state.session
    if (state.session) {
      useXRApp.getState().set({ caps: detectSessionCapabilities(state.session, state.mode) })
    } else {
      const app = useXRApp.getState()
      app.set({ menuOpen: false, tracking: 'ok', caps: EMPTY_SESSION_CAPS })
      app.setPhase('inactive')
      useView.getState().set({ mode: app.returnMode, detailCardId: null, editCardId: null })
    }
  })
}

/** Must be called from a user gesture (click). */
export async function enterXR(mode: 'immersive-ar' | 'immersive-vr') {
  listenForSessionChanges()
  unlockAudio()
  const view = useView.getState()
  useXRApp.getState().set({ returnMode: view.mode === 'xr' ? '3d' : view.mode })
  // Mount the XR scene before requesting the session.
  view.set({ mode: 'xr', detailCardId: null })
  try {
    const session = mode === 'immersive-ar' ? await xrStore.enterAR() : await xrStore.enterVR()
    if (!session) throw new Error('The browser did not start an XR session.')
    return session
  } catch (err) {
    useView.getState().set({ mode: useXRApp.getState().returnMode })
    throw err
  }
}

export function exitXR() {
  void xrStore.getState().session?.end()
}
