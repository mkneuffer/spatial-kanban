import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBoardStore } from '../../data/store'
import { byOrderKey } from '../../data/ordering'
import { cardRef, type LabelIcon } from '../../data/model'
import { PROVIDER_NAMES } from '../../integrations/protocol'
import { VOICE_EXAMPLES } from '../../voice/commands'
import { LABEL_PRESETS } from '../../data/seed'
import { ulid } from '../../data/ids'
import { toast } from '../toasts'
import { Icon, LabelGlyph } from './icons'

export function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
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
      <p>Keep several boards, or sync one with GitHub Projects, Trello, Linear or Jira, from ⋯ → Boards & integrations.</p>
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
      <strong>Voice commands</strong>
      <p>Press the microphone (or V; “Voice” on the board in a headset) and say one command. No AI involved: it matches what you say against your cards and columns.</p>
      <ul className="voice-examples">
        {VOICE_EXAMPLES.map(([say, what]) => (
          <li key={say}>
            “{say}”{what ? ` — ${what}` : ''}
          </li>
        ))}
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
                {cardRef(c) ? `${cardRef(c)} ` : ''}
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

const LABEL_ICONS: LabelIcon[] = ['dot', 'bug', 'star', 'brush', 'book', 'bolt', 'cube', 'flag']
const WIP_LIMITS = [1, 2, 3, 4, 5, 6, 8, 10, 12]

/**
 * A text input that keeps a local draft and commits once: on blur, on Enter,
 * or when it unmounts (for example when the dialog closes with Escape), so a
 * rename is one undo step instead of one per keystroke.
 */
function CommitInput({ value, onCommit, multiline, ...rest }: { value: string; onCommit(value: string): void; multiline?: boolean; 'aria-label': string; placeholder?: string }) {
  const [draft, setDraft] = useState(value)
  const latest = useRef({ draft, value, onCommit })
  latest.current = { draft, value, onCommit }
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const { draft, value, onCommit } = latest.current
    if (draft !== value) onCommit(draft)
  }
  useEffect(() => commit, [])
  if (multiline) return <textarea {...rest} value={draft} rows={3} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/**
 * A color picker that previews locally and commits when the picker closes
 * (the native `change` event), rather than on every drag tick.
 */
function ColorInput({ value, onCommit, label }: { value: string; onCommit(value: string): void; label: string }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = () => el.value !== value && commit.current(el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [value])
  return <input ref={ref} type="color" className="color-input" aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} />
}

/** Edit the board itself: name, description, columns and labels. */
export function BoardDialog({ onClose }: { onClose(): void }) {
  const doc = useBoardStore((s) => s.doc)
  const dispatch = useBoardStore((s) => s.dispatch)
  const { board } = doc
  const ids = board.columnIds
  const liveCards = Object.values(doc.cards).filter((c) => !c.archived)
  const cardCount = (columnId: string) => liveCards.filter((c) => c.columnId === columnId).length
  const labelCount = (labelId: string) => Object.values(doc.cards).filter((c) => c.labelIds.includes(labelId)).length
  const undo = { label: 'Undo', run: () => useBoardStore.getState().undo() }
  // Columns and labels of a synced board that come from the online tool are managed there.
  const provider = board.integration?.provider
  const fromTool = provider ? `This comes from ${PROVIDER_NAMES[provider]}. Change it there.` : undefined

  const addColumn = () =>
    dispatch({ type: 'column/create', column: { id: ulid(), boardId: board.id, title: 'New column', color: '#8b949e' } })

  const addLabel = () => {
    const used = new Set(board.labels.map((l) => l.color.toLowerCase()))
    const preset = LABEL_PRESETS.find((p) => !used.has(p.color.toLowerCase()))
    dispatch({ type: 'label/upsert', label: { id: ulid(), name: 'New label', color: preset?.color ?? '#6e7781', icon: preset?.icon ?? 'dot' } })
  }

  return (
    <Dialog title="Edit board" onClose={onClose}>
      <div className="board-editor">
        <label className="field">
          <span>Board name</span>
          <CommitInput aria-label="Board name" value={board.title} onCommit={(t) => t.trim() && dispatch({ type: 'board/update', changes: { title: t.trim() } })} />
        </label>
        <label className="field">
          <span>Description</span>
          <CommitInput
            multiline
            aria-label="Board description"
            placeholder="What is this board for?"
            value={board.description ?? ''}
            onCommit={(d) => dispatch({ type: 'board/update', changes: { description: d.trim() || undefined } })}
          />
        </label>

        <h3>Columns</h3>
        <ul className="edit-list" aria-label="Columns">
          {ids.map((id, i) => {
            const c = doc.columns[id]
            if (!c) return null
            return (
              <li key={id} className="edit-row">
                <ColorInput label={`${c.title} color`} value={c.color ?? '#8b949e'} onCommit={(color) => dispatch({ type: 'column/update', id, changes: { color } })} />
                <CommitInput aria-label={`Column ${i + 1} name`} value={c.title} onCommit={(t) => t.trim() && dispatch({ type: 'column/update', id, changes: { title: t.trim() } })} />
                <select
                  aria-label={`${c.title} work-in-progress limit`}
                  value={c.wipLimit ?? ''}
                  onChange={(e) => dispatch({ type: 'column/update', id, changes: { wipLimit: e.target.value ? Number(e.target.value) : undefined } })}
                >
                  <option value="">No limit</option>
                  {WIP_LIMITS.map((n) => (
                    <option key={n} value={n}>
                      WIP {n}
                    </option>
                  ))}
                </select>
                <button className="btn ghost icon" aria-label={`Move ${c.title} left`} disabled={i === 0} onClick={() => dispatch({ type: 'column/move', id, toIndex: i - 1 })}>
                  ←
                </button>
                <button className="btn ghost icon" aria-label={`Move ${c.title} right`} disabled={i === ids.length - 1} onClick={() => dispatch({ type: 'column/move', id, toIndex: i + 1 })}>
                  →
                </button>
                <button
                  className="btn ghost icon danger"
                  aria-label={`Delete ${c.title} (its cards move to the neighbouring column)`}
                  disabled={ids.length <= 1 || !!(provider && c.externalId)}
                  title={provider && c.externalId ? fromTool : undefined}
                  onClick={() => {
                    const target = ids[i - 1] ?? ids[i + 1]
                    const n = cardCount(id)
                    dispatch({ type: 'column/delete', id, moveCardsTo: target })
                    toast(`Deleted “${c.title}”${n ? `; ${n} card${n === 1 ? '' : 's'} moved to “${doc.columns[target]?.title}”` : ''}`, { action: undo })
                  }}
                >
                  <Icon name="trash" />
                </button>
              </li>
            )
          })}
        </ul>
        <button className="btn" onClick={addColumn}>
          <Icon name="plus" /> Add column
        </button>

        <h3>Labels</h3>
        {board.labels.length === 0 && <p>No labels yet.</p>}
        <ul className="edit-list" aria-label="Labels">
          {board.labels.map((l, i) => {
            const n = labelCount(l.id)
            return (
              <li key={l.id} className="edit-row">
                <ColorInput label={`${l.name} color`} value={l.color} onCommit={(color) => dispatch({ type: 'label/upsert', label: { ...l, color } })} />
                <span className="icon-select" style={{ color: l.color }}>
                  <LabelGlyph icon={l.icon} />
                  <select aria-label={`${l.name} icon`} value={l.icon ?? 'dot'} onChange={(e) => dispatch({ type: 'label/upsert', label: { ...l, icon: e.target.value as LabelIcon } })}>
                    {LABEL_ICONS.map((icon) => (
                      <option key={icon} value={icon}>
                        {icon}
                      </option>
                    ))}
                  </select>
                </span>
                <CommitInput aria-label={`Label ${i + 1} name`} value={l.name} onCommit={(t) => t.trim() && dispatch({ type: 'label/upsert', label: { ...l, name: t.trim() } })} />
                <span className="usage">{n === 1 ? '1 card' : `${n} cards`}</span>
                <button
                  className="btn ghost icon danger"
                  aria-label={`Delete label ${l.name}`}
                  disabled={!!provider && l.id.startsWith(`${provider}:`)}
                  title={provider && l.id.startsWith(`${provider}:`) ? fromTool : undefined}
                  onClick={() => {
                    dispatch({ type: 'label/delete', id: l.id })
                    toast(`Deleted label “${l.name}”${n ? ` from ${n} card${n === 1 ? '' : 's'}` : ''}`, { action: undo })
                  }}
                >
                  <Icon name="trash" />
                </button>
              </li>
            )
          })}
        </ul>
        <button className="btn" onClick={addLabel}>
          <Icon name="plus" /> Add label
        </button>
      </div>
    </Dialog>
  )
}
