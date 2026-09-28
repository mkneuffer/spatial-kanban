import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useBoardStore } from '../data/store'
import { useSettings, type Settings } from '../data/settings'
import { usePlacements } from '../data/placements'
import type { ScalePreset } from '../data/model'
import { createDemoBoard } from '../data/seed'
import { exportDoc, importDoc } from '../data/persistence'
import { useView, type ViewMode } from '../board/viewStore'
import { switchSkin } from '../board/BoardContent'
import { SKINS } from '../skins/registry'
import { setSoundEnabled, unlockAudio } from '../fx/audio'
import { setHapticsEnabled } from '../fx/haptics'
import { useDeviceCaps } from '../xr/capabilities'
import { enterXR } from '../xr/session'
import { FlatBoard } from '../ui/flat/FlatBoard'
import { CardDrawer } from '../ui/flat/CardDrawer'
import { Icon, Logo } from '../ui/flat/icons'
import { Toasts } from '../ui/ToastHost'
import { ArchivedDialog, HelpDialog } from '../ui/flat/Dialogs'
import { toast } from '../ui/toasts'

// The 3D/XR scene (three.js, R3F, WebXR) loads after the 2D board has painted.
const Scene = lazy(() => import('./Scene').then((m) => ({ default: m.Scene })))

function useDarkMode() {
  const query = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

const isEditable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

export function App() {
  const ready = useBoardStore((s) => s.ready)
  const mode = useView((s) => s.mode)
  const skinId = useSettings((s) => s.skinId)
  const sound = useSettings((s) => s.sound)
  const haptics = useSettings((s) => s.haptics)
  const highContrast = useSettings((s) => s.highContrast)
  const dark = useDarkMode()
  const [dialog, setDialog] = useState<'help' | 'archived' | null>(null)

  useEffect(() => setSoundEnabled(sound), [sound])
  useEffect(() => setHapticsEnabled(haptics), [haptics])
  useEffect(() => {
    document.documentElement.dataset.contrast = highContrast ? 'high' : ''
  }, [highContrast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useBoardStore.getState().redo()
        else useBoardStore.getState().undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        useBoardStore.getState().redo()
      } else if (e.key === '?') setDialog('help')
    }
    window.addEventListener('keydown', onKey)
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`app skin-${skinId}`}>
      <TopBar onDialog={setDialog} />
      <CapabilityBanner />
      <main className="stage">
        <div className="canvas-layer" data-hidden={mode === '2d'} aria-hidden={mode === '2d'}>
          <Suspense fallback={null}>
            <Scene dark={dark} />
          </Suspense>
        </div>
        {!ready && <div className="loading">Loading your board…</div>}
        {ready && mode === '2d' && <FlatBoard dark={dark} />}
        {ready && mode === '3d' && (
          <div className="canvas-hint">Drag cards between columns · drag the pad to create · scroll a column · drag empty space to orbit</div>
        )}
      </main>
      {mode !== 'xr' && <CardDrawer dark={dark} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'archived' && <ArchivedDialog onClose={() => setDialog(null)} />}
      <Toasts />
    </div>
  )
}

function TopBar({ onDialog }: { onDialog(d: 'help' | 'archived'): void }) {
  const title = useBoardStore((s) => s.doc.board.title)
  const canUndo = useBoardStore((s) => s.past.length > 0)
  const canRedo = useBoardStore((s) => s.future.length > 0)
  const mode = useView((s) => s.mode)
  const skinId = useSettings((s) => s.skinId)
  const caps = useDeviceCaps()
  const [draft, setDraft] = useState(title)
  useEffect(() => setDraft(title), [title])

  const setMode = (m: ViewMode) => useView.getState().set({ mode: m })
  const start = (m: 'immersive-ar' | 'immersive-vr') =>
    enterXR(m).catch((err: Error) => toast(`Couldn’t start ${m === 'immersive-ar' ? 'AR' : 'VR'}: ${err.message}`, { tone: 'warn', ms: 6000 }))

  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span>Spatial Kanban</span>
      </div>
      <div className="board-title">
        <input
          aria-label="Board title"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft.trim() && draft !== title && useBoardStore.getState().dispatch({ type: 'board/update', changes: { title: draft.trim() } })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>
            Board
          </button>
          <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>
            3D
          </button>
        </div>
        <div className="seg hide-sm" role="group" aria-label="Skin">
          {SKINS.map((s) => (
            <button key={s.id} aria-pressed={skinId === s.id} onClick={() => switchSkin(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="xr-buttons">
          {caps.immersiveAR && (
            <button className="btn primary" onClick={() => start('immersive-ar')}>
              <Icon name="glasses" /> Enter AR
            </button>
          )}
          {caps.immersiveVR && (
            <button className={`btn${caps.immersiveAR ? ' hide-sm' : ' primary'}`} onClick={() => start('immersive-vr')}>
              <Icon name="cube" /> {caps.immersiveAR ? 'VR' : 'Enter VR'}
            </button>
          )}
        </div>
        <button className="btn ghost icon hide-sm" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={() => useBoardStore.getState().undo()}>
          <Icon name="undo" />
        </button>
        <button className="btn ghost icon hide-sm" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={() => useBoardStore.getState().redo()}>
          <Icon name="redo" />
        </button>
        <MoreMenu onDialog={onDialog} />
      </div>
    </header>
  )
}

const TOGGLES: Array<[keyof Settings, string]> = [
  ['reducedMotion', 'Reduced motion'],
  ['sound', 'Sound'],
  ['haptics', 'Haptics'],
  ['highContrast', 'High contrast'],
  ['leftHanded', 'Left-handed mode'],
]

const PRESETS: Array<[ScalePreset, string]> = [
  ['poster', 'Poster'],
  ['desk', 'Desk'],
  ['compact', 'Compact'],
]

function MoreMenu({ onDialog }: { onDialog(d: 'help' | 'archived'): void }) {
  const [open, setOpen] = useState(false)
  const settings = useSettings()
  const ref = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const exportBoard = () => {
    const doc = useBoardStore.getState().doc
    const blob = new Blob([exportDoc(doc)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${doc.board.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'board'}.kanban.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setOpen(false)
  }

  const importBoard = async (f: File) => {
    try {
      const doc = importDoc(await f.text())
      useBoardStore.getState().dispatch({ type: 'doc/replace', doc })
      usePlacements.getState().hydrate(null, [])
      toast(`Imported “${doc.board.title}”`, { tone: 'success' })
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, { tone: 'warn', ms: 6000 })
    }
  }

  return (
    <div className="menu" ref={ref}>
      <button className="btn ghost icon" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          <div className="label">Skin</div>
          {SKINS.map((s) => (
            <button key={s.id} className="item" role="menuitemradio" aria-checked={settings.skinId === s.id} onClick={() => switchSkin(s.id)}>
              {s.name}
              <span className="switch" data-on={settings.skinId === s.id} aria-hidden="true" />
            </button>
          ))}
          <div className="label">3D board size</div>
          {PRESETS.map(([id, label]) => (
            <button key={id} className="item" role="menuitemradio" aria-checked={settings.scalePreset === id} onClick={() => settings.set({ scalePreset: id })}>
              {label}
              <span className="switch" data-on={settings.scalePreset === id} aria-hidden="true" />
            </button>
          ))}
          <div className="label">Comfort & accessibility</div>
          {TOGGLES.map(([key, label]) => (
            <button key={key} className="item" role="menuitemcheckbox" aria-checked={!!settings[key]} onClick={() => settings.set({ [key]: !settings[key] })}>
              {label}
              <span className="switch" data-on={!!settings[key]} aria-hidden="true" />
            </button>
          ))}
          <hr />
          <button className="item" role="menuitem" onClick={() => (onDialog('archived'), setOpen(false))}>
            Archived cards…
          </button>
          <button className="item" role="menuitem" onClick={exportBoard}>
            Export board (JSON)
          </button>
          <button className="item" role="menuitem" onClick={() => file.current?.click()}>
            Import board…
          </button>
          <button
            className="item"
            role="menuitem"
            onClick={() => {
              if (!window.confirm('Replace this board with a fresh demo board? You can undo right after.')) return
              useBoardStore.getState().dispatch({ type: 'doc/replace', doc: createDemoBoard() })
              usePlacements.getState().hydrate(null, [])
              setOpen(false)
            }}
          >
            Reset demo board
          </button>
          <hr />
          <button className="item" role="menuitem" onClick={() => (onDialog('help'), setOpen(false))}>
            Controls & help <span className="kbd">?</span>
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importBoard(f)
              e.target.value = ''
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

function CapabilityBanner() {
  const caps = useDeviceCaps()
  const mode = useView((s) => s.mode)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('sk:banner') === '1'
    } catch {
      return false
    }
  })
  if (!caps.checked || dismissed || mode === 'xr') return null
  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem('sk:banner', '1')
    } catch {
      /* private mode */
    }
  }
  const emulated = import.meta.env.DEV && caps.webxr
  let tone = ''
  let text: string
  if (!caps.secureContext) {
    tone = 'warn'
    text = 'WebXR needs a secure (HTTPS) connection. The 2D board and 3D view still work.'
  } else if (!caps.webxr) {
    text = 'This browser has no WebXR (for example iOS Safari). The 2D board and 3D view work here — open this page on a Meta Quest or an ARCore Android phone to pin the board to your wall.'
  } else if (emulated) {
    text = 'Dev mode: WebXR is emulated as a Meta Quest 3 in a synthetic office (IWER). Use the emulator panel to move the headset and controllers.'
  } else if (caps.immersiveAR) {
    text = 'Mixed reality is available. Press “Enter AR”, then choose Wall, Desk or Float.'
  } else if (caps.immersiveVR) {
    text = 'VR is available (no passthrough on this device). The board floats in a virtual room.'
  } else {
    text = 'WebXR is present but no immersive sessions are supported. Use the 2D board or 3D view.'
  }
  return (
    <div className={`banner ${tone}`} role="status">
      <p>{text}</p>
      {!caps.webxr && mode !== '3d' && (
        <button className="btn" onClick={() => useView.getState().set({ mode: '3d' })}>
          Try the 3D view
        </button>
      )}
      <button className="btn ghost icon" aria-label="Dismiss" onClick={dismiss}>
        <Icon name="close" />
      </button>
    </div>
  )
}
