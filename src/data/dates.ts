import type { Card } from './model'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A card has two optional dates: a planned due date and a hard deadline. */
export type DateKind = 'due' | 'deadline'

export interface FormattedDate {
  kind: DateKind
  text: string
  overdue: boolean
}

/** Whole days from `today` to a `YYYY-MM-DD` date (negative when it has passed). */
export function daysUntil(date: string, today = new Date()): number {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(y, (m ?? 1) - 1, d ?? 1)
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target.getTime() - start.getTime()) / 86_400_000)
}

export function formatDate(date: string, kind: DateKind, today = new Date()): FormattedDate {
  const [y, m, d] = date.split('-').map(Number)
  const days = daysUntil(date, today)
  const prefix = kind === 'due' ? 'Due' : 'Deadline'
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${MONTHS[(m ?? 1) - 1]} ${d ?? 1}${y !== today.getFullYear() ? `, ${y}` : ''}`
  return { kind, text: `${prefix} ${when}`, overdue: days < 0 }
}

/** The card's dates in display order (due date, then deadline). */
export function cardDates(card: Pick<Card, 'dueDate' | 'deadline'>, today = new Date()): FormattedDate[] {
  const out: FormattedDate[] = []
  if (card.dueDate) out.push(formatDate(card.dueDate, 'due', today))
  if (card.deadline) out.push(formatDate(card.deadline, 'deadline', today))
  return out
}

/** True when the planned due date falls after the hard deadline. */
export function dueAfterDeadline(card: Pick<Card, 'dueDate' | 'deadline'>): boolean {
  return !!card.dueDate && !!card.deadline && card.dueDate > card.deadline
}
