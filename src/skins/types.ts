import type { FC } from 'react'
import type { BoardDoc, Card, ID } from '../data/model'
import type { BoardLayout, LayoutInput } from '../board/layout'
import type { SoundName } from '../fx/audio'

/**
 * A skin is a pure presentation plugin (PLAN §7.1). It receives board state and
 * decides layout, looks, motion, and sound. It never changes board data.
 */

export interface SpringConfig {
  stiffness: number
  damping: number
}

export interface SkinMotion {
  /** How far a grabbed card rises off the board (m). */
  liftHeight: number
  /** Scale of a grabbed card. */
  dragScale: number
  spring: SpringConfig
  /** Radians of tilt per m/s of drag velocity (sticky notes sway). */
  dragTilt: number
  /** Paper peel from the bottom edge while grabbed. */
  peel: boolean
  /** Squash on drop. */
  squash: boolean
}

export interface SkinSounds {
  pick: SoundName
  drop: SoundName
  tear: SoundName
  stick: SoundName
  archive: SoundName
  tick: SoundName
}

export interface SurfaceProps<C = unknown> {
  layout: BoardLayout<C>
  dark: boolean
  highContrast: boolean
  /** 0..1, used to fade during skin switches and tracking loss. */
  opacity: number
  /** Column the dragged card currently targets (for highlight). */
  targetColumnId: ID | null
  overBin: boolean
  padActive: boolean
}

export interface CardsProps<C = unknown> {
  layout: BoardLayout<C>
  dark: boolean
  highContrast: boolean
  /** This skin's role while switching skins. */
  role: 'only' | 'from' | 'to'
}

export interface Skin<C = unknown> {
  id: string
  name: string
  description: string
  layout(input: LayoutInput): BoardLayout<C>
  /** Insertion index for a pointer at (u, v) over `columnId`, computed against a gap-free layout. */
  insertionIndex(layout: BoardLayout<C>, columnId: ID, u: number, v: number): number
  motion: SkinMotion
  overflow: 'scroll' | 'stack'
  sounds: SkinSounds
  cardColor(card: Card, doc: BoardDoc, dark: boolean): string
  visibleFields: Array<keyof Card>
  Surface: FC<SurfaceProps<C>>
  Cards: FC<CardsProps<C>>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySkin = Skin<any>
