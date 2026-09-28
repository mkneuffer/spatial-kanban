import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react'
import { cardRef, type BoardDoc, type Card } from '../../data/model'
import { hash01 } from '../../board/space'
import { formatDue, initials } from '../../skins/projects/layout'
import { noteColor } from '../../skins/whiteboard/palette'
import { pillBg, pillText } from '../../skins/projects/palette'
import { LabelGlyph } from './icons'

interface Props extends HTMLAttributes<HTMLDivElement> {
  card: Card
  doc: BoardDoc
  skinId: string
  dark: boolean
  dragging?: boolean
  overlay?: boolean
  parked?: boolean
}

export const FlatCard = forwardRef<HTMLDivElement, Props>(function FlatCard({ card, doc, skinId, dark, dragging, overlay, parked, style, ...rest }, ref) {
  const column = doc.columns[card.columnId]
  const labels = card.labelIds.map((id) => doc.board.labels.find((l) => l.id === id)).filter(Boolean)
  const due = card.dueDate ? formatDue(card.dueDate) : null
  const sticky = skinId === 'whiteboard'
  const s: CSSProperties = {
    ...style,
    ...(sticky ? { background: noteColor(card, doc), ['--tilt' as string]: `${((hash01(card.id, 3) - 0.5) * 5).toFixed(2)}deg` } : null),
  }
  const describedBy = [
    labels.length ? `Labels: ${labels.map((l) => l!.name).join(', ')}.` : '',
    card.assignees.length ? `Assigned to ${card.assignees.map((p) => p.name).join(', ')}.` : '',
    due ? `${due.text}${due.overdue ? ', overdue' : ''}.` : '',
    parked ? 'Parked in the room.' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      ref={ref}
      className={`card${dragging ? ' dragging' : ''}${overlay ? ' overlay' : ''}`}
      style={s}
      aria-label={`${cardRef(card) ? `${cardRef(card)} ` : ''}${card.title}. ${describedBy}`}
      {...rest}
    >
      <div className="meta">
        <span className="ring" style={{ color: column?.color ?? 'var(--muted)' }} aria-hidden="true" />
        {cardRef(card) && <span>{cardRef(card)}</span>}
        {parked && <span className="parked-badge">· parked in room</span>}
      </div>
      <div className="title">{card.title || 'Untitled'}</div>
      {labels.length > 0 && (
        <div className="labels">
          {labels.map((l) => (
            <span
              key={l!.id}
              className="pill"
              title={l!.name}
              style={sticky ? { background: l!.color } : { background: pillBg(l!.color, dark), color: pillText(l!.color, dark), borderColor: `${l!.color}55` }}
            >
              <LabelGlyph icon={l!.icon} />
              {l!.name}
            </span>
          ))}
        </div>
      )}
      {(due || card.assignees.length > 0) && (
        <div className="footer">
          {due ? <span className={due.overdue ? 'overdue' : ''}>{due.text}</span> : <span />}
          <span className="who">{card.assignees.map((p) => initials(p.name)).join(' ')}</span>
          <span className="avatars">
            {card.assignees.slice(0, 3).map((p) => (
              <span key={p.id} className="avatar" style={{ background: p.color ?? '#6e7781' }} title={p.name}>
                {initials(p.name)}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  )
})
