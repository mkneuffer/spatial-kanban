import type { AnySkin } from './types'
import { projectsSkin } from './projects'
import { whiteboardSkin } from './whiteboard'

export const SKINS: AnySkin[] = [projectsSkin, whiteboardSkin]

export const skinsById: Record<string, AnySkin> = Object.fromEntries(SKINS.map((s) => [s.id, s]))

export function getSkin(id: string | undefined): AnySkin {
  return (id && skinsById[id]) || whiteboardSkin
}
