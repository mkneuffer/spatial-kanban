import { useEffect, useRef, useState } from 'react'
import type { Column } from '../../data/model'
import { useBoardStore } from '../../data/store'
import { PROVIDER_NAMES } from '../../integrations/protocol'
import { Icon } from './icons'

const COLORS = ['#8b949e', '#2f81f7', '#d29922', '#a371f7', '#3fb950', '#f85149', '#db61a2', '#39c5cf']

/** Column actions: rename, WIP limit, color, reorder, delete. */
export function ColumnMenu({ column }: { column: Column }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(column.title)
  const ref = useRef<HTMLDivElement>(null)
  const dispatch = useBoardStore((s) => s.dispatch)
  const ids = useBoardStore((s) => s.doc.board.columnIds)
  const provider = useBoardStore((s) => s.doc.board.integration?.provider)
  const index = ids.indexOf(column.id)
  // Columns of a synced board belong to the online tool.
  const synced = !!(provider && column.externalId)

  useEffect(() => setName(column.title), [column.title])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const rename = () => {
    const t = name.trim()
    if (t && t !== column.title) dispatch({ type: 'column/update', id: column.id, changes: { title: t } })
  }

  return (
    <div className="menu" ref={ref}>
      <button className="btn ghost icon" aria-label={`${column.title} column options`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          <div className="label">Name</div>
          <div style={{ padding: '4px 10px 8px' }}>
            <input
              className="field"
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', background: 'var(--bg)' }}
              value={name}
              aria-label="Column name"
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  rename()
                  setOpen(false)
                }
              }}
            />
          </div>
          <div className="label">WIP limit</div>
          <div style={{ padding: '4px 10px 8px' }}>
            <select
              aria-label="Work-in-progress limit"
              value={column.wipLimit ?? ''}
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', background: 'var(--bg)' }}
              onChange={(e) => dispatch({ type: 'column/update', id: column.id, changes: { wipLimit: e.target.value ? Number(e.target.value) : undefined } })}
            >
              <option value="">No limit</option>
              {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="label">Color</div>
          <div className="swatches" style={{ padding: '4px 10px 8px' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                className="swatch"
                style={{ background: c, width: 20, height: 20, borderRadius: '50%' }}
                aria-label={`Color ${c}`}
                aria-pressed={column.color === c}
                onClick={() => dispatch({ type: 'column/update', id: column.id, changes: { color: c } })}
              />
            ))}
          </div>
          <hr />
          <button className="item" role="menuitem" disabled={index <= 0} onClick={() => dispatch({ type: 'column/move', id: column.id, toIndex: index - 1 })}>
            Move left
          </button>
          <button className="item" role="menuitem" disabled={index >= ids.length - 1} onClick={() => dispatch({ type: 'column/move', id: column.id, toIndex: index + 1 })}>
            Move right
          </button>
          <hr />
          <button
            className="item"
            role="menuitem"
            style={{ color: 'var(--danger)' }}
            disabled={ids.length <= 1 || synced}
            title={synced ? `This column comes from ${PROVIDER_NAMES[provider!]}. Change it there.` : undefined}
            onClick={() => {
              setOpen(false)
              const target = ids[index - 1] ?? ids[index + 1]
              dispatch({ type: 'column/delete', id: column.id, moveCardsTo: target })
            }}
          >
            Delete column (keeps its cards)
          </button>
        </div>
      )}
    </div>
  )
}
