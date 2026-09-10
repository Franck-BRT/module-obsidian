import type { PMSettings, PriorityConfig, StatusConfig, Task } from '../types'
import { isPhase, phaseSpan } from '../store/Phase'
import { compareTask } from './table/TableFilters'
import { t } from '../i18n'

/** Every field a view can order rows by. Manual leads: it is the project's own order. */
export type SortKey = PMSettings['ganttSortKey']

/** What the Gantt offers: one flat list of rows, so every field is on the table. */
export const GANTT_SORT_KEYS: SortKey[] = ['manual', 'title', 'status', 'priority', 'due', 'assignees', 'progress']

/**
 * What the board offers: the same list without status, which a board already answers
 * with the column a card sits in. Offering it would sort each column by the one thing
 * every card in it shares.
 */
export const KANBAN_SORT_KEYS: SortKey[] = GANTT_SORT_KEYS.filter((key) => key !== 'status')

export function sortKeyLabel(key: SortKey): string {
  switch (key) {
    case 'manual':
      return t('sort.manual')
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

export interface TaskOrder {
  sortKey: SortKey
  sortDir: PMSettings['ganttSortDir']
}

/**
 * A list of tasks in the order a view should draw them — siblings in a chart, the cards
 * of one column on a board.
 *
 * Manual hands back what it was given — the order the project stores, the one the drag
 * handle writes. Any other key sorts, and a phase is compared on what it holds rather
 * than on its own often-empty fields: sorting by due date should put a lot where its
 * work actually falls, not last among the undated.
 */
export function orderTasks(
  tasks: Task[],
  order: TaskOrder,
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
