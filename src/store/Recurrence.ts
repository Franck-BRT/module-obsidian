import { Temporal } from '../dates'
import type { Recurrence, Task } from '../types'
import { cloneTaskSubtree, flattenTasks } from './TaskTreeOps'

export interface OccurrenceDates {
  start: string
  due: string
}

/** A task stale by more than this many periods is left alone rather than caught up. */
const MAX_CATCH_UP_PERIODS = 500

function shift(date: string, rec: Recurrence, periods: number): string {
  const every = Math.max(1, Math.floor(rec.every)) * periods
  const d = Temporal.PlainDate.from(date)
  switch (rec.interval) {
    case 'daily':
      return d.add({ days: every }).toString()
    case 'weekly':
      return d.add({ weeks: every }).toString()
    case 'monthly':
      return d.add({ months: every }).toString()
    case 'yearly':
      return d.add({ years: every }).toString()
  }
}

/**
 * Where the next occurrence of a recurring task falls, or null when there should not
 * be one: no date to count from, or the series has run past its end date.
 *
 * Every shift is measured from the original dates rather than compounded, so a task
 * due on the 31st stays on the 31st instead of drifting down the month. A task
 * completed long after it was due skips whole periods until it lands past
 * `notBefore`, which keeps the series on its original cadence rather than starting a
 * new one that is already overdue.
 */
export function nextOccurrence(
  rec: Recurrence,
  start: string,
  due: string,
  /** Usually the completion date: the new occurrence has to fall after it. */
  notBefore = ''
): OccurrenceDates | null {
  const anchor = due || start
  if (!anchor) return null

  for (let periods = 1; periods <= MAX_CATCH_UP_PERIODS; periods++) {
    const nextAnchor = shift(anchor, rec, periods)
    if (notBefore && nextAnchor <= notBefore) continue
    if (rec.endDate && nextAnchor > rec.endDate) return null
    return {
      start: start ? shift(start, rec, periods) : '',
      due: due ? shift(due, rec, periods) : ''
    }
  }
  return null
}

/**
 * The task to create when a recurring one is ticked off, or null when the series is
 * over. Fresh ids throughout, every progress field wound back, and dates moved to the
 * next slot; subtasks come along reset the same way, keeping their offset from the
 * parent so a recurring checklist keeps its shape.
 *
 * Dependencies on tasks outside the copied subtree are dropped. They belong to the
 * occurrence that just finished, and keeping them would let auto-scheduling drag the
 * new one back to a predecessor that is already done.
 */
export function buildNextOccurrence(task: Task, openStatusId: string, completedOn: string): Task | null {
  if (!task.recurrence) return null
  const dates = nextOccurrence(task.recurrence, task.start, task.due, completedOn)
  if (!dates) return null

  const clone = cloneTaskSubtree(task, true)
  const anchorBefore = task.due || task.start
  const anchorAfter = dates.due || dates.start
  const offset =
    anchorBefore && anchorAfter
      ? Temporal.PlainDate.from(anchorAfter).since(Temporal.PlainDate.from(anchorBefore), {
          largestUnit: 'days'
        }).days
      : 0

  const ownIds = new Set(flattenTasks([clone]).map((f) => f.task.id))
  for (const { task: node } of flattenTasks([clone])) {
    node.status = openStatusId
    node.progress = 0
    node.completed = ''
    node.timeLogs = undefined
    node.archived = false
    node.dependencies = node.dependencies.filter((id) => ownIds.has(id))
    node.dependencyOptions = pickOptions(node.dependencyOptions, node.dependencies)
    if (node !== clone) {
      node.start = node.start ? shiftByDays(node.start, offset) : ''
      node.due = node.due ? shiftByDays(node.due, offset) : ''
    }
  }
  clone.start = dates.start
  clone.due = dates.due
  return clone
}

function shiftByDays(date: string, days: number): string {
  return days === 0 ? date : Temporal.PlainDate.from(date).add({ days }).toString()
}

/** Keeps only the options whose predecessor survived the dependency filter. */
function pickOptions(options: Task['dependencyOptions'], keep: string[]): Task['dependencyOptions'] {
  if (!options) return undefined
  const out: NonNullable<Task['dependencyOptions']> = {}
  for (const id of keep) {
    const option = options[id]
    if (option) out[id] = option
  }
  return Object.keys(out).length ? out : undefined
}
