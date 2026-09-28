import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/styles.css'
import { loadMeasureFonts, preloadSdfFonts } from './render/fonts'
import { clearMeasureCache } from './board/text'
import { useView } from './board/viewStore'
import { bootPersistence } from './app/persistence'
import { detectDeviceCapabilities } from './xr/capabilities'
import { App } from './app/App'

void bootPersistence()
// In dev, emulate a Quest 3 first (if needed) so capability detection sees it.
void (import.meta.env.DEV ? import('./xr/emulator').then((m) => m.installDevEmulator()) : Promise.resolve(false)).then(() => detectDeviceCapabilities())
void preloadSdfFonts()
// Layout measures text with the real fonts; re-measure once they're loaded.
void loadMeasureFonts().then(() => {
  clearMeasureCache()
  useView.getState().set({ fontsVersion: useView.getState().fontsVersion + 1 })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV) {
  // Console handles for debugging (dev builds only).
  void Promise.all([import('./data/store'), import('./data/placements'), import('./xr/session')]).then(([board, placements, xr]) => {
    Object.assign(window, { __stores: { board: board.useBoardStore, view: useView, placements: placements.usePlacements, xrApp: xr.useXRApp, xr: xr.xrStore } })
  })
}
