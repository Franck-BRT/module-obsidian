import type { PMSettings, PriorityConfig, StatusConfig, Task } from '../../types'
import { isPhase, phaseSpan } from '../../store/Phase'
import { compareTask } from '../table/TableFilters'
import { t } from '../../i18n'

/** The orders the Gantt offers, manual first: it is the project's own. */
export const GANTT_SORT_KEYS: PMSettings['ganttSortKey'][] = [
  'manual',
  'title',
  'status',
  'priority',
  'due',
  'assignees',
  'progress'
]

export function sortKeyLabel(key: PMSettings['ganttSortKey']): string {
  switch (key) {
    case 'manual':
      return t('gantt.sortManual')
    case 'title':
      return t('common.task')
    case 'status':
      return t('common.status')
    case 'priority':
      return t('common.priority')
    case 'due':
      return t('common.due')
    case 'assignees':
      return t('task.assignees')
    case 'progress':
      return t('common.progress')
  }
}

export interface GanttOrder {
  sortKey: PMSettings['ganttSortKey']
  sortDir: PMSettings['ganttSortDir']
}

/**
 * A list of siblings in the order the chart should draw them.
 *
 * Manual hands back what it was given — the order the project stores, the one the drag
 * handle writes. Any other key sorts, and a phase is compared on what it holds rather
 * than on its own often-empty fields: sorting by due date should put a lot where its
 * work actually falls, not last among the undated.
 */
export function orderTasks(
  tasks: Task[],
  order: GanttOrder,
  statuses: StatusConfig[] = [],
  priorities: PriorityConfig[] = []
): Task[] {
  if (order.sortKey === 'manual') return tasks
  const sortKey = order.sortKey
  const seen = new Map<string, Task>()
  const of = (task: Task): Task => {
    const cached = seen.get(task.id)
    if (cached) return cached
    const span = isPhase(task) ? phaseSpan(task, statuses) : null
    const value = span ? { ...task, start: span.start, due: span.due, progress: span.progress } : task
    seen.set(task.id, value)
    return value
  }
  return [...tasks].sort((a, b) => compareTask(of(a), of(b), { sortKey, sortDir: order.sortDir }, statuses, priorities))
}
