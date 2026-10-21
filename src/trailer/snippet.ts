// The "code" that appears as the trailer is being typed. Each key press reveals the
// next few characters, so any key mashing reads as fluent typing on screen.
export const SNIPPET = `import { useXR, useHitTest } from '@react-three/xr'
import { createAnchor, restoreAnchor } from './anchors'
import { useBoard } from '../board/store'

// Pin the board to the nearest wall and keep it there across sessions.
export async function pinBoardToWall(session: XRSession, frame: XRFrame) {
  const space = await session.requestReferenceSpace('local-floor')
  const planes = [...(frame.detectedPlanes ?? [])]
  const wall = planes
    .filter((p) => p.semanticLabel === 'wall' && p.orientation === 'vertical')
    .sort((a, b) => distanceTo(a, space) - distanceTo(b, space))[0]

  if (!wall) return placeFloating(session, space)

  const pose = frame.getPose(wall.planeSpace, space)
  const anchor = await createAnchor(frame, pose!.transform, wall.planeSpace)
  useBoard.getState().set({ anchorId: anchor.uuid, mode: 'wall' })
  return anchor
}

export function snapCardToColumn(card: Card, columns: Column[], x: number) {
  const target = columns.reduce((best, col) =>
    Math.abs(col.center - x) < Math.abs(best.center - x) ? col : best,
  )
  if (target.id === card.columnId) return card
  const rank = between(target.cards.at(-1)?.rank, undefined)
  emit('card:moved', { id: card.id, from: card.columnId, to: target.id })
  return { ...card, columnId: target.id, rank }
}

export function onRelease(card: Card, velocity: Vector3) {
  // Throw it downward to archive.
  if (velocity.y < -2.4 && velocity.length() > 3) return archive(card)
  // Pulled more than 12 cm off the board: park it in the room.
  if (card.offset.z > 0.12) return parkInRoom(card)
  return settle(card, { ripple: true, sway: 0.35, slap: true })
}

export function useSync(provider: 'github' | 'linear' | 'jira' | 'trello') {
  const board = useBoard((s) => s.board)
  useEffect(() => {
    const ws = new WebSocket(\`/api/sync/\${provider}/\${board.id}\`)
    ws.onmessage = (e) => applyRemote(JSON.parse(e.data))
    return () => ws.close()
  }, [provider, board.id])
}
`
