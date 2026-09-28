import { useEffect, useRef, type ReactNode } from 'react'
import { useBoardStore } from '../../data/store'
import { byOrderKey } from '../../data/ordering'

function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => prev?.focus?.()
  }, [])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{title}</h2>
        {children}
        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  )
}

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog title="Controls & help" onClose={onClose}>
      <p>The same board works everywhere. Changes save on this device automatically.</p>
      <strong>Mixed reality (Meta Quest, Android AR)</strong>
      <ul>
        <li>Enter AR, choose Wall, Desk or Float, then pinch / pull the trigger / tap to place.</li>
        <li>Grab or pinch a card to pick it up; drag it along the board; let go to drop.</li>
        <li>With hands or grip, pull a card more than 12 cm off the board to tear it off and park it in the room. Drag it back to return it.</li>
        <li>Throw a torn-off card downward, or drop any card on the bin, to archive it.</li>
        <li>Pull a blank card from the pad to create one, then type or dictate its title.</li>
        <li>Quick tap a card for details. Drag the bar under the board to move it, the corner to resize.</li>
        <li>Thumbstick scrolls the hovered column (Projects skin). Menu (top corner) switches skins and settings.</li>
        <li>On Quest the board stays where you left it between sessions (persistent anchors).</li>
      </ul>
      <strong>3D view</strong>
      <ul>
        <li>Drag cards with the mouse; drag empty space to orbit; scroll to zoom or to scroll a column.</li>
      </ul>
      <strong>2D board (keyboard & screen reader)</strong>
      <ul>
        <li>Tab to a card, press Space to pick it up, arrow keys to move, Space to drop, Escape to cancel.</li>
        <li>Enter opens details. ⌘/Ctrl+Z undoes, ⇧⌘Z redoes. Press ? for this help.</li>
      </ul>
    </Dialog>
  )
}

export function ArchivedDialog({ onClose }: { onClose(): void }) {
  const doc = useBoardStore((s) => s.doc)
  const archived = Object.values(doc.cards)
    .filter((c) => c.archived)
    .sort(byOrderKey)
  return (
    <Dialog title="Archived cards" onClose={onClose}>
      {archived.length === 0 ? (
        <p>Nothing archived yet. Drop a card on the bin, or throw a torn-off card downward in XR.</p>
      ) : (
        <div className="archived-list">
          {archived.map((c) => (
            <div key={c.id} className="row">
              <span>
                {c.number ? `#${c.number} ` : ''}
                {c.title}
              </span>
              <button className="btn" onClick={() => useBoardStore.getState().archiveCard(c.id, false)}>
                Restore
              </button>
              <button className="btn danger" onClick={() => useBoardStore.getState().dispatch({ type: 'card/delete', id: c.id })}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  )
}
