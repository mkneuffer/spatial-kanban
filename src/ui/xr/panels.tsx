import { useMemo } from 'react'
import { cardRef, type PlacementMode, type ScalePreset } from '../../data/model'
import { useBoardStore } from '../../data/store'
import { useSettings } from '../../data/settings'
import { cardsInColumn } from '../../data/ordering'
import { SKINS } from '../../skins/registry'
import { switchSkin } from '../../board/BoardContent'
import { archiveWithAnimation } from '../../board/effects'
import { useView } from '../../board/viewStore'
import { formatDue } from '../../skins/projects/layout'
import { useXRApp, exitXR } from '../../xr/session'
import { useToasts } from '../toasts'
import { Button3D, Label, Panel, Toggle3D, UI } from './primitives'

const MODES: Array<{ id: PlacementMode; label: string; sub: string }> = [
  { id: 'wall', label: 'Wall', sub: 'Flush on a wall, poster size' },
  { id: 'desk', label: 'Desk', sub: 'On your table, tilted toward you' },
  { id: 'float', label: 'Float', sub: 'In the air in front of you' },
]

/** First step in AR: choose where the board goes (PLAN §4). */
export function PlacementChooser({ onChoose, lastMode, hint }: { onChoose(mode: PlacementMode): void; lastMode?: PlacementMode; hint?: string }) {
  const caps = useXRApp((s) => s.caps)
  const surfaces = caps.hitTest || caps.planes
  return (
    <Panel width={0.56} height={0.34} radius={0.028}>
      <Label size={0.03} weight={700} position={[0, 0.125, 0]}>
        Place your board
      </Label>
      <Label size={0.015} color={UI.muted} position={[0, 0.088, 0]} maxWidth={0.5}>
        {hint ?? (surfaces ? 'Pick a spot. The ghost board snaps to walls and desks it finds.' : 'No surface detection on this device — the board will float where you point.')}
      </Label>
      {MODES.map((m, i) => (
        <Button3D
          key={m.id}
          label={m.label}
          sublabel={m.sub}
          width={0.165}
          height={0.12}
          fontSize={0.026}
          active={m.id === lastMode}
          position={[(i - 1) * 0.178, -0.01, 0]}
          onClick={() => onChoose(m.id)}
        />
      ))}
      <Button3D label="Exit" width={0.12} height={0.04} variant="ghost" position={[0, -0.13, 0]} onClick={exitXR} />
    </Panel>
  )
}

/** Restore failed: the saved anchor isn't in this room (PLAN §4, returning flow). */
export function NotFoundPanel({ onPlace, onFloat }: { onPlace(): void; onFloat(): void }) {
  return (
    <Panel width={0.5} height={0.24} radius={0.026}>
      <Label size={0.026} weight={700} position={[0, 0.07, 0]}>
        Board not found here
      </Label>
      <Label size={0.015} color={UI.muted} position={[0, 0.03, 0]} maxWidth={0.44}>
        It may be in another room, or the room map was reset. Your size and skin are kept.
      </Label>
      <Button3D label="Place it again" variant="primary" width={0.2} height={0.05} position={[-0.11, -0.05, 0]} onClick={onPlace} />
      <Button3D label="Float it here" width={0.18} height={0.05} position={[0.11, -0.05, 0]} onClick={onFloat} />
    </Panel>
  )
}

const PRESETS: Array<{ id: ScalePreset; label: string }> = [
  { id: 'poster', label: 'Poster' },
  { id: 'desk', label: 'Desk' },
  { id: 'compact', label: 'Compact' },
]

/** Board menu: skins, size, placement, comfort settings, undo, exit. */
export function BoardMenu3D({ onMove, onReplace, onPreset, onClose }: { onMove(): void; onReplace(): void; onPreset(p: ScalePreset): void; onClose(): void }) {
  const settings = useSettings()
  const canUndo = useBoardStore((s) => s.past.length > 0)
  const canRedo = useBoardStore((s) => s.future.length > 0)
  const W = 0.36
  const H = 0.64
  let y = H / 2 - 0.035
  const row = (h: number) => {
    const at = y - h / 2
    y -= h + 0.012
    return at
  }
  const titleY = row(0.03)
  const skinLabelY = row(0.016)
  const skinY = row(0.05)
  const sizeLabelY = row(0.016)
  const sizeY = row(0.042)
  const placeY = row(0.042)
  const toggles = [
    ['Reduced motion', 'reducedMotion'],
    ['Sound', 'sound'],
    ['Haptics', 'haptics'],
    ['High contrast', 'highContrast'],
    ['Left-handed', 'leftHanded'],
  ] as const
  const toggleYs = toggles.map(() => row(0.042) + 0.004)
  const undoY = row(0.042)
  return (
    <Panel width={W} height={H} radius={0.024}>
      <Label size={0.024} weight={700} anchorX="left" position={[-W / 2 + 0.02, titleY, 0]}>
        Board
      </Label>
      <Button3D label="Close" width={0.08} height={0.034} variant="ghost" position={[W / 2 - 0.055, titleY, 0]} onClick={onClose} />
      <Label size={0.013} color={UI.muted} anchorX="left" position={[-W / 2 + 0.02, skinLabelY, 0]}>
        SKIN
      </Label>
      {SKINS.map((s, i) => (
        <Button3D key={s.id} label={s.name} width={0.158} height={0.05} active={settings.skinId === s.id} position={[(i - 0.5) * 0.166, skinY, 0]} onClick={() => switchSkin(s.id)} />
      ))}
      <Label size={0.013} color={UI.muted} anchorX="left" position={[-W / 2 + 0.02, sizeLabelY, 0]}>
        SIZE
      </Label>
      {PRESETS.map((p, i) => (
        <Button3D key={p.id} label={p.label} width={0.104} height={0.042} active={settings.scalePreset === p.id} position={[(i - 1) * 0.111, sizeY, 0]} onClick={() => onPreset(p.id)} />
      ))}
      <Button3D label="Move board" width={0.158} height={0.042} position={[-0.083, placeY, 0]} onClick={onMove} />
      <Button3D label="Place again" width={0.158} height={0.042} position={[0.083, placeY, 0]} onClick={onReplace} />
      {toggles.map(([label, key], i) => (
        <Toggle3D key={key} label={label} width={W - 0.04} value={settings[key]} onChange={(v) => settings.set({ [key]: v })} position={[0, toggleYs[i], 0]} />
      ))}
      <Button3D label="Undo" width={0.1} height={0.042} disabled={!canUndo} position={[-0.115, undoY, 0]} onClick={() => useBoardStore.getState().undo()} />
      <Button3D label="Redo" width={0.1} height={0.042} disabled={!canRedo} position={[-0.008, undoY, 0]} onClick={() => useBoardStore.getState().redo()} />
      <Button3D label="Exit XR" width={0.1} height={0.042} variant="danger" position={[0.115, undoY, 0]} onClick={exitXR} />
    </Panel>
  )
}

/** Card detail beside the board (read-only content, quick actions). */
export function DetailPanel3D({ cardId, onEditTitle }: { cardId: string; onEditTitle(): void }) {
  const doc = useBoardStore((s) => s.doc)
  const card = doc.cards[cardId]
  const column = card ? doc.columns[card.columnId] : undefined
  const labels = useMemo(() => (card ? card.labelIds.map((id) => doc.board.labels.find((l) => l.id === id)).filter(Boolean) : []), [card, doc])
  if (!card || !column) return null
  const close = () => useView.getState().set({ detailCardId: null })
  const columns = doc.board.columnIds.map((id) => doc.columns[id])
  const W = 0.4
  const H = 0.5
  const top = H / 2
  const due = card.dueDate ? formatDue(card.dueDate) : null
  const desc = card.description ? (card.description.length > 260 ? `${card.description.slice(0, 259)}…` : card.description) : 'No description. Add one in the 2D view.'
  return (
    <Panel width={W} height={H} radius={0.024}>
      <Label size={0.014} color={UI.muted} anchorX="left" position={[-W / 2 + 0.02, top - 0.03, 0]}>
        {`${cardRef(card) ? `${cardRef(card)} · ` : ''}${column.title}`}
      </Label>
      <Button3D label="Close" width={0.08} height={0.034} variant="ghost" position={[W / 2 - 0.055, top - 0.03, 0]} onClick={close} />
      <Label size={0.024} weight={600} anchorX="left" anchorY="top" maxWidth={W - 0.04} lineHeight={1.2} position={[-W / 2 + 0.02, top - 0.058, 0]}>
        {card.title}
      </Label>
      <Label size={0.014} color={UI.muted} anchorX="left" anchorY="top" position={[-W / 2 + 0.02, top - 0.15, 0]} maxWidth={W - 0.04}>
        {[
          labels.length ? `Labels: ${labels.map((l) => l!.name).join(', ')}` : null,
          card.assignees.length ? `Assignees: ${card.assignees.map((p) => p.name).join(', ')}` : null,
          due ? `${due.text}${due.overdue ? ' (overdue)' : ''}` : null,
        ]
          .filter(Boolean)
          .join('\n') || 'No labels or assignees'}
      </Label>
      <Label size={0.0145} anchorX="left" anchorY="top" maxWidth={W - 0.04} lineHeight={1.35} position={[-W / 2 + 0.02, top - 0.225, 0]}>
        {desc}
      </Label>
      <Label size={0.012} color={UI.muted} anchorX="left" position={[-W / 2 + 0.02, -H / 2 + 0.118, 0]}>
        MOVE TO
      </Label>
      {columns.map((c, i) => {
        const w = (W - 0.04 - (columns.length - 1) * 0.006) / columns.length
        return (
          <Button3D
            key={c.id}
            label={c.title}
            width={w}
            height={0.036}
            fontSize={0.0115}
            active={c.id === card.columnId}
            position={[-W / 2 + 0.02 + w / 2 + i * (w + 0.006), -H / 2 + 0.085, 0]}
            onClick={() => {
              if (c.id === card.columnId) return
              useBoardStore.getState().moveCard(card.id, c.id, cardsInColumn(doc.cards, c.id).length)
            }}
          />
        )
      })}
      <Button3D label="Edit title" width={0.17} height={0.042} variant="primary" position={[-0.095, -H / 2 + 0.035, 0]} onClick={onEditTitle} />
      <Button3D label="Archive" width={0.17} height={0.042} variant="danger" position={[0.095, -H / 2 + 0.035, 0]} onClick={() => archiveWithAnimation(card.id)} />
    </Panel>
  )
}

/** World-locked toast pill under the board (no head-locked UI in headsets). */
export function Toast3D({ position }: { position: [number, number, number] }) {
  const toasts = useToasts((s) => s.toasts)
  const t = toasts[toasts.length - 1]
  if (!t) return null
  const w = Math.min(0.7, 0.1 + t.message.length * 0.0105 + (t.action ? 0.1 : 0))
  return (
    <group position={position}>
      <Panel width={w} height={0.052} radius={0.026} border={t.tone === 'warn' ? UI.warn : UI.panelBorder}>
        <Label size={0.0175} anchorX="left" position={[-w / 2 + 0.022, 0, 0]} maxWidth={w - (t.action ? 0.13 : 0.04)}>
          {t.message}
        </Label>
        {t.action && (
          <Button3D
            label={t.action.label}
            width={0.09}
            height={0.036}
            variant="primary"
            position={[w / 2 - 0.055, 0, 0]}
            onClick={() => {
              t.action!.run()
              useToasts.getState().dismiss(t.id)
            }}
          />
        )}
      </Panel>
    </group>
  )
}
