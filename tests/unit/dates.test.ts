import { describe, expect, it } from 'vitest'
import { cardDates, daysUntil, dueAfterDeadline, formatDate } from '../../src/data/dates'

const today = new Date(2026, 8, 28) // Sep 28, 2026

describe('card dates', () => {
  it('counts whole days in local time', () => {
    expect(daysUntil('2026-09-28', today)).toBe(0)
    expect(daysUntil('2026-09-29', today)).toBe(1)
    expect(daysUntil('2026-09-27', today)).toBe(-1)
    expect(daysUntil('2026-10-28', today)).toBe(30)
  })

  it('formats due dates and deadlines', () => {
    expect(formatDate('2026-09-28', 'due', today)).toEqual({ kind: 'due', text: 'Due today', overdue: false })
    expect(formatDate('2026-09-29', 'deadline', today).text).toBe('Deadline tomorrow')
    expect(formatDate('2026-10-03', 'deadline', today).text).toBe('Deadline Oct 3')
    expect(formatDate('2027-01-05', 'due', today).text).toBe('Due Jan 5, 2027')
    expect(formatDate('2026-09-20', 'deadline', today).overdue).toBe(true)
  })

  it('lists the due date before the deadline and skips missing ones', () => {
    expect(cardDates({}, today)).toEqual([])
    expect(cardDates({ deadline: '2026-10-01' }, today).map((d) => d.kind)).toEqual(['deadline'])
    expect(cardDates({ dueDate: '2026-09-30', deadline: '2026-10-01' }, today).map((d) => d.kind)).toEqual(['due', 'deadline'])
  })

  it('flags a due date that falls after the deadline', () => {
    expect(dueAfterDeadline({ dueDate: '2026-10-02', deadline: '2026-10-01' })).toBe(true)
    expect(dueAfterDeadline({ dueDate: '2026-10-01', deadline: '2026-10-01' })).toBe(false)
    expect(dueAfterDeadline({ dueDate: '2026-10-02' })).toBe(false)
  })
})
