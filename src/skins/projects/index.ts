import type { Skin } from '../types'
import { projectsLayout, projectsInsertionIndex, type ProjectsContent } from './layout'
import { projectsMotion } from './motion'
import { ProjectsSurface } from './Surface'
import { ProjectsCards } from './Cards'

export const projectsSkin: Skin<ProjectsContent> = {
  id: 'projects',
  name: 'Projects',
  description: 'Clean, information-dense board in the style of GitHub Projects.',
  layout: projectsLayout,
  insertionIndex: projectsInsertionIndex,
  motion: projectsMotion,
  overflow: 'scroll',
  sounds: { pick: 'clickSoft', drop: 'drop', tear: 'tear', stick: 'click', archive: 'whoosh', tick: 'tick' },
  // Neutral cards: color comes only from labels and status dots.
  cardColor: (_card, _doc, dark) => (dark ? '#1f2630' : '#ffffff'),
  visibleFields: ['number', 'title', 'labelIds', 'assignees', 'dueDate'],
  Surface: ProjectsSurface,
  Cards: ProjectsCards,
}
