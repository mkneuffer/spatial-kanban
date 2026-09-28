import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cardRef, type Person } from '../../data/model'
import { useBoardStore } from '../../data/store'
import { cardsInColumn } from '../../data/ordering'
import { DEMO_PEOPLE } from '../../data/seed'
import { usePlacements } from '../../data/placements'
import { useView } from '../../board/viewStore'
import { archiveWithAnimation } from '../../board/effects'
import { STICKY_COLORS } from '../../skins/whiteboard/palette'
import { pillBg, pillText } from '../../skins/projects/palette'
import { initials } from '../../skins/projects/layout'
import { PROVIDER_NAMES } from '../../integrations/protocol'
import { dueAfterDeadline } from '../../data/dates'
import { toast } from '../toasts'
import { Icon, LabelGlyph } from './icons'

/**
 * Card details and editing — long-form editing lives in 2D (PLAN §2 non-goals,
 * §6.5). Used by the 2D board, the desktop 3D view and the phone AR overlay.
 */
export function CardDrawer({ dark }: { dark: boolean }) {
  const cardId = useView((s) => s.detailCardId)
  const isNew = useView((s) => s.editIsNew)
  const doc = useBoardStore((s) => s.doc)
  const dispatch = useBoardStore((s) => s.dispatch)
  const parked = usePlacements((s) => (cardId ? !!s.freeCards[cardId] : false))
  const card = cardId ? doc.cards[cardId] : undefined
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const closeRef = useRef<() => void>(() => {})

  // Escape closes the drawer wherever focus is.
  useEffect(() => {
    if (!cardId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cardId])

  useEffect(() => {
    if (!card) return
    setTitle(card.title)
    setDesc(card.description ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id])

  useEffect(() => {
    if (!cardId) return
    returnFocus.current = document.activeElement as HTMLElement
    requestAnimationFrame(() => {
      if (isNew) {
        titleRef.current?.focus()
        titleRef.current?.select()
      } else drawerRef.current?.focus()
    })
    return () => returnFocus.current?.focus?.()
  }, [cardId, isNew])

  if (!card || !cardId) return null
  closeRef.current = () => close()

  const commitText = () => {
    const current = useBoardStore.getState().doc.cards[card.id]
    if (!current) return
    const t = title.trim()
    const changes: { title?: string; description?: string } = {}
    if (t && t !== current.title) changes.title = t
    if (desc !== (current.description ?? '')) changes.description = desc || undefined
    if (Object.keys(changes).length) dispatch({ type: 'card/update', id: card.id, changes })
  }

  const close = () => {
    commitText()
    const untouched = isNew && (title.trim() === '' || title.trim() === 'New card') && !desc
    if (untouched) {
      dispatch({ type: 'card/delete', id: card.id })
      toast('Discarded the empty card', { ms: 2500 })
    }
    useView.getState().set({ detailCardId: null, editCardId: null, editIsNew: false })
  }

  const toggleLabel = (id: string) =>
    dispatch({ type: 'card/update', id: card.id, changes: { labelIds: card.labelIds.includes(id) ? card.labelIds.filter((l) => l !== id) : [...card.labelIds, id] } })

  const toggleAssignee = (p: Person) =>
    dispatch({
      type: 'card/update',
      id: card.id,
      changes: { assignees: card.assignees.some((a) => a.id === p.id) ? card.assignees.filter((a) => a.id !== p.id) : [...card.assignees, p] },
    })

  const people = [...DEMO_PEOPLE, ...card.assignees.filter((a) => !DEMO_PEOPLE.some((p) => p.id === a.id))]
  const column = doc.columns[card.columnId]
  // Labels, assignees and due dates of a synced card come from the online tool.
  const tool = card.externalRef && doc.board.integration?.provider === card.externalRef.provider ? PROVIDER_NAMES[card.externalRef.provider] : null
  const managed = tool ? <span className="managed">From {tool}</span> : null

  return (
    <>
      <div className="scrim" onClick={close} />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Card ${cardRef(card)} details`}
        tabIndex={-1}
        ref={drawerRef}
>
        <header>
          <span className="ring" style={{ color: column?.color, width: 12, height: 12, borderRadius: '50%', border: '2px solid currentColor', display: 'inline-block' }} />
          <span>
            {cardRef(card) || 'Card'} · {column?.title}
            {parked ? ' · parked in the room' : ''}
          </span>
          <span className="grow" />
          {tool && card.externalRef?.url && (
            <a className="btn ghost" href={card.externalRef.url} target="_blank" rel="noreferrer">
              <Icon name="external" /> Open in {tool}
            </a>
          )}
          <button className="btn ghost icon" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="body">
          <textarea
            ref={titleRef}
            className="title-input"
            aria-label="Title"
            rows={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commitText()
                ;(e.target as HTMLTextAreaElement).blur()
              }
            }}
          />
          <label className="field">
            <span>Status</span>
            <select
              value={card.columnId}
              onChange={(e) => useBoardStore.getState().moveCard(card.id, e.target.value, cardsInColumn(doc.cards, e.target.value).length)}
            >
              {doc.board.columnIds.map((id) => (
                <option key={id} value={id}>
                  {doc.columns[id].title}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Labels {managed}</span>
            <div className="chips">
              {(tool ? doc.board.labels.filter((l) => card.labelIds.includes(l.id)) : doc.board.labels).map((l) => (
                <button
                  key={l.id}
                  className="pill chip-toggle"
                  aria-pressed={card.labelIds.includes(l.id)}
                  disabled={!!tool}
                  style={{ background: pillBg(l.color, dark), color: pillText(l.color, dark) }}
                  onClick={() => toggleLabel(l.id)}
                >
                  <LabelGlyph icon={l.icon} />
                  {l.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Assignees {managed}</span>
            <div className="chips">
              {tool && card.assignees.length === 0 && <span className="managed">Nobody</span>}
              {(tool ? card.assignees : people).map((p) => (
                <button key={p.id} className="pill chip-toggle" aria-pressed={card.assignees.some((a) => a.id === p.id)} disabled={!!tool} onClick={() => toggleAssignee(p)}>
                  <span className="avatar" style={{ background: p.color ?? '#6e7781', width: 18, height: 18, margin: 0, fontSize: 8, border: 0 }} aria-hidden="true">
                    {initials(p.name)}
                  </span>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field-row">
            <DateField label="Due date" note={managed} readOnly={!!tool} value={card.dueDate} onChange={(dueDate) => dispatch({ type: 'card/update', id: card.id, changes: { dueDate } })} />
            <DateField label="Deadline" value={card.deadline} onChange={(deadline) => dispatch({ type: 'card/update', id: card.id, changes: { deadline } })} />
          </div>
          {dueAfterDeadline(card) && (
            <p className="field-hint warn" role="status">
              The due date is after the deadline.
            </p>
          )}
          <div className="field">
            <span>Sticky note color (whiteboard skin)</span>
            <div className="swatches">
              <button className="swatch" aria-label="Automatic (from first label)" aria-pressed={!card.color} style={{ background: 'linear-gradient(135deg, #ffe066 50%, #8fd0ff 50%)' }} onClick={() => dispatch({ type: 'card/update', id: card.id, changes: { color: undefined } })} />
              {Object.entries(STICKY_COLORS).map(([name, c]) => (
                <button key={name} className="swatch" aria-label={name} aria-pressed={card.color === c} style={{ background: c }} onClick={() => dispatch({ type: 'card/update', id: card.id, changes: { color: c } })} />
              ))}
            </div>
          </div>
          <label className="field">
            <span>Description</span>
            <textarea value={desc} placeholder="Add details, links, acceptance criteria…" onChange={(e) => setDesc(e.target.value)} onBlur={commitText} />
          </label>
        </div>
        <footer>
          {parked && (
            <button className="btn" onClick={() => usePlacements.getState().unparkCard(card.id)}>
              Return to board
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              commitText()
              useView.getState().set({ detailCardId: null, editCardId: null, editIsNew: false })
              archiveWithAnimation(card.id)
            }}
          >
            <Icon name="archive" /> Archive
          </button>
          <button
            className="btn danger"
            onClick={() => {
              useView.getState().set({ detailCardId: null, editCardId: null, editIsNew: false })
              dispatch({ type: 'card/delete', id: card.id })
              toast('Card deleted', { action: { label: 'Undo', run: () => useBoardStore.getState().undo() } })
            }}
          >
            <Icon name="trash" /> Delete
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </footer>
      </div>
    </>
  )
}

/** A date input with a clear button; an empty value clears the date. */
function DateField({ label, note, readOnly, value, onChange }: { label: string; note?: ReactNode; readOnly?: boolean; value?: string; onChange(value: string | undefined): void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {note}
      </label>
      <span className="date-input">
        <input id={id} type="date" value={value ?? ''} readOnly={readOnly} onChange={(e) => onChange(e.target.value || undefined)} />
        {value && !readOnly && (
          <button type="button" className="btn ghost icon" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange(undefined)}>
            <Icon name="close" />
          </button>
        )}
      </span>
    </div>
  )
}
