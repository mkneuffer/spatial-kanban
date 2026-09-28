import type { Skin } from '../types'
import { whiteboardLayout, whiteboardInsertionIndex, type WhiteboardContent } from './layout'
import { whiteboardMotion } from './motion'
import { WhiteboardSurface } from './Surface'
import { WhiteboardCards } from './Cards'
import { noteColor } from './palette'

export const whiteboardSkin: Skin<WhiteboardContent> = {
  id: 'whiteboard',
  name: 'Whiteboard',
  description: 'A glossy whiteboard covered in paper sticky notes.',
  layout: whiteboardLayout,
  insertionIndex: whiteboardInsertionIndex,
  motion: whiteboardMotion,
  overflow: 'stack',
  sounds: { pick: 'peel', drop: 'slap', tear: 'tear', stick: 'stick', archive: 'whoosh', tick: 'tick' },
  cardColor: (card, doc) => noteColor(card, doc),
  visibleFields: ['title', 'labelIds', 'assignees'],
  Surface: WhiteboardSurface,
  Cards: WhiteboardCards,
}
