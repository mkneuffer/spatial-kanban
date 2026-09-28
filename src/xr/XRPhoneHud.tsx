import { useEffect, useRef } from 'react'
import { XRDomOverlay, useXR } from '@react-three/xr'
import type { PlacementMode } from '../data/model'
import { useSettings } from '../data/settings'
import { SKINS } from '../skins/registry'
import { switchSkin } from '../board/BoardContent'
import { useToasts } from '../ui/toasts'
import { useXRApp, exitXR } from './session'
import { useView } from '../board/viewStore'
import { CardDrawer } from '../ui/flat/CardDrawer'

/**
 * Handheld AR HUD via the DOM overlay (PLAN §3: phone AR is the one place a
 * small screen-locked HUD is allowed). Only shown when the session has a DOM overlay.
 */
export function XRPhoneHud({ onChoose }: { onChoose(mode: PlacementMode): void }) {
  const domOverlay = useXRApp((s) => s.caps.domOverlay)
  const mode = useXR((s) => s.mode)
  if (!domOverlay || mode !== 'immersive-ar') return null
  return (
    <XRDomOverlay>
      <HudContent onChoose={onChoose} />
    </XRDomOverlay>
  )
}

function HudContent({ onChoose }: { onChoose(mode: PlacementMode): void }) {
  const phase = useXRApp((s) => s.phase)
  const skinId = useSettings((s) => s.skinId)
  const toasts = useToasts((s) => s.toasts)
  const detailCardId = useView((s) => s.detailCardId)
  const root = useRef<HTMLDivElement>(null)

  // Taps on the HUD must not also fire an XR "select" (which would place the board). The event bubbles.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const stop = (e: Event) => e.preventDefault()
    el.addEventListener('beforexrselect', stop)
    return () => el.removeEventListener('beforexrselect', stop)
  }, [])

  const nextSkin = SKINS[(SKINS.findIndex((s) => s.id === skinId) + 1) % SKINS.length]
  const t = toasts[toasts.length - 1]
  return (
    <div className="hud" ref={root}>
      <div className="bar">
        <button onClick={exitXR}>Exit AR</button>
        <span style={{ display: 'flex', gap: 8 }}>
          {(phase === 'working' || phase === 'adjusting') && (
            <button onClick={() => useXRApp.getState().setPhase('choose')}>Place again</button>
          )}
          <button onClick={() => switchSkin(nextSkin.id)}>{nextSkin.name} skin</button>
        </span>
      </div>
      <div className="bottom">
        {t && (
          <div className="hint">
            {t.message}
            {t.action && (
              <button style={{ marginLeft: 8, padding: '4px 10px' }} onClick={() => t.action!.run()}>
                {t.action.label}
              </button>
            )}
          </div>
        )}
        {phase === 'choose' && (
          <div className="modes">
            <button className="primary" onClick={() => onChoose('wall')}>
              Wall
            </button>
            <button className="primary" onClick={() => onChoose('desk')}>
              Desk
            </button>
            <button className="primary" onClick={() => onChoose('float')}>
              Float
            </button>
          </div>
        )}
        {phase === 'placing' && <div className="hint">Aim the center of the screen at a surface, then tap to place</div>}
        {phase === 'adjusting' && (
          <button className="primary" onClick={() => useXRApp.getState().setPhase('working')}>
            Done
          </button>
        )}
        {phase === 'working' && <div className="hint">Drag cards with a finger · tap a card for details</div>}
      </div>
      {detailCardId && (
        <div style={{ pointerEvents: 'auto', color: 'var(--text)' }}>
          <CardDrawer dark />
        </div>
      )}
    </div>
  )
}
