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
      return dir * (a.due || 'zzz').localeCompare(b.due || 'zzz')
    case 'assignees':
      return dir * displayName(a.assignees[0] ?? '').localeCompare(displayName(b.assignees[0] ?? ''))
    case 'progress':
      return dir * (a.progress - b.progress)
    default:
      return 0
  }
}

function priorityOrder(p: TaskPriority, priorities: PriorityConfig[]): number {
  const idx = priorities.findIndex((cfg) => cfg.id === p)
  return idx >= 0 ? idx : 999
}
