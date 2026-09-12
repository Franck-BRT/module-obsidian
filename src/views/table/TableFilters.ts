import type { Task, TaskPriority, StatusConfig, PriorityConfig } from '../../types'
import type { SortDir, SortKey } from './TableRenderer'
import { displayName, statusSortOrder } from '../../utils'

/** What a sort is: which field, which way. Named so anything can ask for one. */
export interface TaskOrder {
  sortKey: SortKey
  sortDir: SortDir
}

export function compareTask(
  a: Task,
  b: Task,
  order: TaskOrder,
  statuses: StatusConfig[] = [],
  priorities: PriorityConfig[] = []
): number {
  const dir = order.sortDir === 'asc' ? 1 : -1
  switch (order.sortKey) {
    case 'title':
      return dir * a.title.localeCompare(b.title)
    case 'status':
      return dir * (statusSortOrder(a.status, statuses) - statusSortOrder(b.status, statuses))
    case 'priority':
      return dir * (priorityOrder(a.priority, priorities) - priorityOrder(b.priority, priorities))
    case 'due':
      return compareText(a.due, b.due, dir)
    case 'assignees':
      return compareText(displayName(a.assignees[0] ?? ''), displayName(b.assignees[0] ?? ''), dir)
    case 'progress':
      return dir * (a.progress - b.progress)
    default:
      return 0
  }
}

/**
 * Text, with everything unfilled last whichever way the list is read.
 *
 * A blank is an absent value, not a small one: a task with no due date is not "before
 * the first of January", and reversing the order should not parade every undated row at
 * the top. So emptiness is settled before direction is applied, never by it.
 */
function compareText(a: string, b: string, dir: number): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return dir * a.localeCompare(b)
}

function priorityOrder(p: TaskPriority, priorities: PriorityConfig[]): number {
  const idx = priorities.findIndex((cfg) => cfg.id === p)
  return idx >= 0 ? idx : 999
}
