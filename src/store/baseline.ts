import type { Task } from '../types'

/**
 * How far a ticket has moved from the reference plan: its end — a milestone's day — later
 * or earlier by so many days, and its start too. What the Gantt writes beside the bar,
 * and what a status point counts as slipped.
 */

const DAY = 86_400_000

function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY)
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A ticket's last day: its end, or its start when it has only that. */
function endOf(dates: { start: string; due: string }): string {
  const end = dates.due || dates.start
  return DATE.test(end) ? end : ''
}

export interface BaselineGap {
  /** Days its end moved: later when above zero; null when either plan gives it no date. */
  end: number | null
  /** Days its start moved, the same way. */
  start: number | null
}

/** How a ticket stands against the reference; null when it was not in it. */
export function baselineGap(task: Pick<Task, 'start' | 'due' | 'baseline'>): BaselineGap | null {
  const was = task.baseline
  if (!was) return null
  const end = endOf(was) && endOf(task) ? days(endOf(was), endOf(task)) : null
  const start = DATE.test(was.start) && DATE.test(task.start) ? days(was.start, task.start) : null
  return { end, start }
}

/** A gap in days as it is written: « +5 j », « −2 j »; '' for none. */
export function gapText(daysMoved: number | null, unit: string): string {
  if (!daysMoved) return ''
  return `${daysMoved > 0 ? '+' : '−'}${Math.abs(daysMoved)} ${unit}`
}

/**
 * When the plan ends, now and in the reference: the latest end of the tickets the
 * reference held, lots aside. Empty where none has a date.
 */
export function planEnds(tasks: Pick<Task, 'start' | 'due' | 'baseline' | 'type' | 'archived'>[]): {
  now: string
  planned: string
} {
  let now = ''
  let planned = ''
  for (const task of tasks) {
    if (task.archived || task.type === 'phase' || !task.baseline) continue
    const own = endOf(task)
    const was = endOf(task.baseline)
    if (own > now) now = own
    if (was > planned) planned = was
  }
  return { now, planned }
}
