import { useEffect, useMemo, useRef, useState } from 'react'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BoardDoc, Column, ID } from '../../data/model'
import { useBoardStore } from '../../data/store'
import { cardsInColumn } from '../../data/ordering'
import { usePlacements } from '../../data/placements'
import { useSettings } from '../../data/settings'
import { useView } from '../../board/viewStore'
import { beginNewCard } from '../../board/effects'
import { playSound } from '../../fx/audio'
import { FlatCard } from './FlatCard'
import { ColumnMenu } from './ColumnMenu'
import { Icon } from './icons'
import { ulid } from '../../data/ids'

type Items = Record<ID, ID[]>

function itemsFromDoc(doc: BoardDoc): Items {
  const out: Items = {}
  for (const colId of doc.board.columnIds) out[colId] = cardsInColumn(doc.cards, colId).map((c) => c.id)
  return out
}

function findContainer(items: Items, id: ID): ID | undefined {
  if (id in items) return id
  return Object.keys(items).find((col) => items[col].includes(id))
}

function SortableCard({ id, doc, skinId, dark, parked }: { id: ID; doc: BoardDoc; skinId: string; dark: boolean; parked: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const card = doc.cards[id]
  if (!card) return null
  return (
    <FlatCard
      ref={setNodeRef}
      card={card}
      doc={doc}
      skinId={skinId}
      dark={dark}
      parked={parked}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => useView.getState().select(id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === 'Enter') useView.getState().select(id)
      }}
    />
  )
}

function ColumnView({ column, ids, doc, skinId, dark, isTarget }: { column: Column; ids: ID[]; doc: BoardDoc; skinId: string; dark: boolean; isTarget: boolean }) {
  const { setNodeRef } = useDroppable({ id: column.id })
  const freeCards = usePlacements((s) => s.freeCards)
  const count = ids.length
  const limit = column.wipLimit
  const over = limit !== undefined && count > limit
  const atLimit = limit !== undefined && count >= limit
  return (
    <section className={`column${isTarget ? ' target' : ''}${atLimit ? ' at-limit' : ''}`} aria-labelledby={`col-${column.id}`}>
      <div className="column-header">
        <span className="dot" style={{ background: column.color ?? 'var(--muted)' }} aria-hidden="true" />
        <h2 id={`col-${column.id}`}>{column.title}</h2>
        <span className={`count${over ? ' over' : ''}`} aria-label={limit !== undefined ? `${count} of ${limit} work-in-progress limit` : `${count} cards`}>
          {limit !== undefined ? `${count} / ${limit}` : count}
        </span>
        <ColumnMenu column={column} />
      </div>
      <SortableContext items={ids} strategy={skinId === 'whiteboard' ? rectSortingStrategy : verticalListSortingStrategy}>
        <div className="column-body" ref={setNodeRef}>
          {ids.map((id) => (
            <SortableCard key={id} id={id} doc={doc} skinId={skinId} dark={dark} parked={!!freeCards[id]} />
          ))}
        </div>
      </SortableContext>
      <button
        className="btn add-card"
        onClick={() => {
          beginNewCard(column.id, ids.length)
          playSound('clickSoft')
        }}
      >
        <Icon name="plus" /> Add card
      </button>
    </section>
  )
}

/**
 * The 2D board (PLAN §3, graceful fallback): same store and actions as XR,
 * fully keyboard- and screen-reader-accessible via dnd-kit.
 */
export function FlatBoard({ dark }: { dark: boolean }) {
  const doc = useBoardStore((s) => s.doc)
  const skinId = useSettings((s) => s.skinId)
  const [items, setItems] = useState<Items>(() => itemsFromDoc(doc))
  const [activeId, setActiveId] = useState<ID | null>(null)
  const dragging = useRef(false)
  const startContainer = useRef<ID | null>(null)

  useEffect(() => {
    if (!dragging.current) setItems(itemsFromDoc(doc))
  }, [doc])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const title = (id: unknown) => doc.cards[String(id)]?.title ?? 'card'
  const colName = (id: ID | undefined) => (id ? doc.columns[id]?.title : undefined) ?? 'column'
  const position = (id: unknown) => {
    const col = findContainer(items, String(id))
    if (!col) return ''
    return `${colName(col)}, position ${items[col].indexOf(String(id)) + 1} of ${items[col].length}`
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${title(active.id)}. ${position(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${title(active.id)} is over ${position(active.id) || colName(String(over.id))}.` : `${title(active.id)} is no longer over a column.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${title(active.id)} in ${position(active.id)}.` : `Dropped ${title(active.id)}.`),
    onDragCancel: ({ active }) => `Cancelled. ${title(active.id)} returned to ${colName(startContainer.current ?? undefined)}.`,
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    dragging.current = true
    setActiveId(String(active.id))
    startContainer.current = findContainer(items, String(active.id)) ?? null
    playSound(skinId === 'whiteboard' ? 'peel' : 'clickSoft')
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return
    const activeCol = findContainer(items, String(active.id))
    const overCol = findContainer(items, String(over.id))
    if (!activeCol || !overCol || activeCol === overCol) return
    setItems((prev) => {
      const from = prev[activeCol].filter((id) => id !== active.id)
      const to = [...prev[overCol]]
      const overIndex = to.indexOf(String(over.id))
      const index = overIndex >= 0 ? overIndex : to.length
      to.splice(index, 0, String(active.id))
      playSound('tick')
      return { ...prev, [activeCol]: from, [overCol]: to }
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragging.current = false
    setActiveId(null)
    const id = String(active.id)
    const col = findContainer(items, id)
    if (!over || !col) {
      setItems(itemsFromDoc(useBoardStore.getState().doc))
      return
    }
    let list = items[col]
    const overIndex = list.indexOf(String(over.id))
    const activeIndex = list.indexOf(id)
    if (overIndex >= 0 && overIndex !== activeIndex) {
      list = [...list]
      list.splice(activeIndex, 1)
      list.splice(overIndex, 0, id)
    }
    const index = list.indexOf(id)
    useBoardStore.getState().moveCard(id, col, index)
    setItems(itemsFromDoc(useBoardStore.getState().doc))
    playSound(skinId === 'whiteboard' ? 'slap' : 'drop')
  }

  const onDragCancel = () => {
    dragging.current = false
    setActiveId(null)
    setItems(itemsFromDoc(useBoardStore.getState().doc))
  }

  const targetCol = activeId ? findContainer(items, activeId) : undefined
  const activeCard = activeId ? doc.cards[activeId] : null
  const columns = useMemo(() => doc.board.columnIds.map((id) => doc.columns[id]).filter(Boolean), [doc])

  return (
    <div className="flat" role="region" aria-label="Kanban board">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: 'To pick up a card, press space or enter. Use the arrow keys to move it between and within columns. Press space or enter again to drop, or escape to cancel. Press enter on a focused card to open its details.',
          },
        }}
      >
        <div className="columns">
          {columns.map((c) => (
            <ColumnView key={c.id} column={c} ids={items[c.id] ?? []} doc={doc} skinId={skinId} dark={dark} isTarget={!!activeId && targetCol === c.id && startContainer.current !== c.id} />
          ))}
          <button
            className="btn add-column"
            onClick={() => {
              const id = ulid()
              useBoardStore.getState().dispatch({ type: 'column/create', column: { id, boardId: doc.board.id, title: 'New column', color: '#8b949e' } })
            }}
          >
            <Icon name="plus" /> Add column
          </button>
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
          {activeCard ? <FlatCard card={activeCard} doc={doc} skinId={skinId} dark={dark} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
