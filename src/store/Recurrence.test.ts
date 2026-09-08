import { describe, expect, it } from 'vitest'
import { Temporal } from '../dates'
import type { Recurrence } from '../types'
import { nextOccurrence } from './Recurrence'

const weekly: Recurrence = { interval: 'weekly', every: 1 }
const monthly: Recurrence = { interval: 'monthly', every: 1 }

describe('nextOccurrence', () => {
  it('moves both ends by one period, keeping the span', () => {
    expect(nextOccurrence(weekly, '2026-04-06', '2026-04-08')).toEqual({
      start: '2026-04-13',
      due: '2026-04-15'
    })
  })

  it('honours the interval count', () => {
    expect(nextOccurrence({ interval: 'weekly', every: 3 }, '', '2026-04-08')).toEqual({
      start: '',
      due: '2026-04-29'
    })
  })

  it('counts from the due date when there is one', () => {
    expect(nextOccurrence({ interval: 'daily', every: 2 }, '', '2026-04-08')?.due).toBe('2026-04-10')
  })

  it('falls back to the start date when there is no due date', () => {
    expect(nextOccurrence(weekly, '2026-04-06', '')).toEqual({ start: '2026-04-13', due: '' })
  })

  it('returns null when the task has no date to count from', () => {
    expect(nextOccurrence(weekly, '', '')).toBeNull()
  })

  it('stops at the end date', () => {
    expect(nextOccurrence({ ...weekly, endDate: '2026-04-10' }, '', '2026-04-08')).toBeNull()
    expect(nextOccurrence({ ...weekly, endDate: '2026-04-20' }, '', '2026-04-08')?.due).toBe('2026-04-15')
  })

  it('treats a malformed interval count as one', () => {
    expect(nextOccurrence({ interval: 'daily', every: 0 }, '', '2026-04-08')?.due).toBe('2026-04-09')
  })
})

describe('nextOccurrence catching up on a late completion', () => {
  it('skips whole periods rather than landing in the past', () => {
    // Due in January, ticked off in April: the next one is the following weekly slot.
    const next = nextOccurrence(weekly, '', '2026-01-07', '2026-04-08')
    expect(next?.due).toBe('2026-04-15')
  })

  it('keeps the original day of the week while catching up', () => {
    const next = nextOccurrence(weekly, '', '2026-01-07', '2026-04-08')
    expect(Temporal.PlainDate.from(next?.due ?? '').dayOfWeek).toBe(Temporal.PlainDate.from('2026-01-07').dayOfWeek)
  })

  it('does not drift down the month when catching up', () => {
    // The 31st has no counterpart in February, but the series must come back to it.
    const next = nextOccurrence(monthly, '', '2026-01-31', '2026-03-15')
    expect(next?.due).toBe('2026-03-31')
  })

  it('still respects the end date while catching up', () => {
    expect(nextOccurrence({ ...weekly, endDate: '2026-02-01' }, '', '2026-01-07', '2026-04-08')).toBeNull()
  })
})
