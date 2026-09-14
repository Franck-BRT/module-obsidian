import type { StatusConfig, Task } from '../types'
import { makeDocument } from '../types'
import { getDefaultStatusId } from '../utils'
import { addDays } from './Metrics'
import { isDocument } from './Document'

/** The earliest day anything in the tree stands on, or '' when nothing is dated. */
export function firstDateOf(tasks: Task[]): string {
  let first = ''
  const walk = (list: Task[]): void => {
    for (const task of list) {
      for (const date of [task.start, task.due]) {
        if (date && (!first || date < first)) first = date
      }
      walk(task.subtasks)
    }
  }
  walk(tasks)
  return first
}

/** Days from one YYYY-MM-DD to another, negative when the second is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000)
}

export interface TemplateStart {
  /** The day the new project starts. Empty leaves every date exactly as the template has it. */
  start: string
  statuses: StatusConfig[]
}

/**
 * What a new project inherits from a template: its shape, and none of its history.
 *
 * A template is built like a project — with the same editor, so it can hold lots,
 * milestones, dependencies and the documents that will be awaited — and it is the
 * history that must not come along. Everything that says work happened is cleared:
 * status back to the palette's first, no progress, no completion date, no logged hours,
 * nothing archived. A document keeps what describes it — its reference, its issue, who
 * owes it, who signs it — and loses what was deposited against it, because the file and
 * the signatures belong to the project that did the work, not to the next one.
 *
 * The dates move as a block. The gap between the template's first day and the day the
 * new project starts is applied to every date in the tree, so a plan laid out over
 * months keeps its spacing rather than being flattened onto one day. Relative dates
 * would be another way; this one lets a template be read as a plan, which is what makes
 * it possible to build one in the views that already exist.
 */
export function tasksFromTemplate(tasks: Task[], opts: TemplateStart): Task[] {
  const anchor = firstDateOf(tasks)
  const shift = opts.start && anchor ? daysBetween(anchor, opts.start) : 0
  const status = getDefaultStatusId(opts.statuses)
  const move = (date: string): string => (date && shift ? addDays(date, shift) : date)

  const walk = (list: Task[]): Task[] =>
    list.map((task) => ({
      ...task,
      status,
      progress: 0,
      completed: '',
      archived: false,
      start: move(task.start),
      due: move(task.due),
      timeLogs: [],
      ...(isDocument(task)
        ? {
            document: makeDocument({
              reference: task.document?.reference ?? '',
              issue: task.document?.issue ?? '',
              issuer: task.document?.issuer ?? '',
              recipient: task.document?.recipient ?? '',
              phase: task.document?.phase ?? '',
              approvers: [...(task.document?.approvers ?? [])]
            })
          }
        : {}),
      subtasks: walk(task.subtasks)
    }))

  return walk(tasks)
}
