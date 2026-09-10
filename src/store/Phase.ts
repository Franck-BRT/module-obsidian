import type { StatusConfig, Task } from '../types'
import { isTerminalStatus } from '../utils'

/**
 * A phase — "lot 1", "lot 2" — gathers tasks inside a project. It is a container, not a
 * ticket: it holds no work of its own, its dates and progress come from what it holds,
 * and the views draw it as a heading rather than as a row of task cells.
 */
export function isPhase(task: Pick<Task, 'type'>): boolean {
  return task.type === 'phase'
}

/** Whether a phase holds this task, at any depth. */
export function phaseHolds(phase: Task, taskId: string): boolean {
  return phase.subtasks.some((sub) => sub.id === taskId || phaseHolds(sub, taskId))
}

export interface PhaseSpan {
  /** What the phase's own fields say. Empty when it declares nothing. */
  declaredStart: string
  declaredDue: string
  /** What the tasks it holds add up to. Empty when none of them is dated. */
  rolledStart: string
  rolledDue: string
  /** What the views draw: the declaration when there is one, the roll-up otherwise. */
  start: string
  due: string
  /** Mean progress of the tasks it holds, a completed task counting as 100. */
  progress: number
  /** How many tasks that mean is over. Zero for an empty phase. */
  count: number
  /** The work runs outside the dates the phase declares. */
  overruns: boolean
}

/**
 * What a phase amounts to.
 *
 * Dates and progress are read from the tasks it holds, at any depth — the same counting
 * the project overview does, where every task counts once, a parent alongside its own
 * subtasks. A date the phase itself declares wins over the roll-up, because someone
 * typed it on purpose; `overruns` then says the tasks no longer fit inside it, which is
 * the whole point of declaring one.
 *
 * A nested phase contributes what it holds, and its declared dates with it: the
 * declaration is the answer that phase gives about itself.
 */
export function phaseSpan(phase: Task, statuses: StatusConfig[] = []): PhaseSpan {
  let rolledStart = ''
  let rolledDue = ''
  let progressSum = 0
  let count = 0

  const widen = (start: string, due: string): void => {
    if (start && (!rolledStart || start < rolledStart)) rolledStart = start
    if (due && (!rolledDue || due > rolledDue)) rolledDue = due
  }

  const walk = (task: Task): void => {
    if (isPhase(task)) {
      const span = phaseSpan(task, statuses)
      widen(span.start, span.due)
      progressSum += span.progress * span.count
      count += span.count
      return
    }
    // A task dated on one end only still stakes out that day.
    widen(task.start || task.due, task.due || task.start)
    progressSum += isTerminalStatus(task.status, statuses) ? 100 : task.progress
    count += 1
    for (const sub of task.subtasks) walk(sub)
  }

  for (const child of phase.subtasks) walk(child)

  const start = phase.start || rolledStart
  const due = phase.due || rolledDue
  const overruns =
    (!!phase.start && !!rolledStart && rolledStart < phase.start) ||
    (!!phase.due && !!rolledDue && rolledDue > phase.due)

  return {
    declaredStart: phase.start,
    declaredDue: phase.due,
    rolledStart,
    rolledDue,
    start,
    due,
    progress: count ? Math.round(progressSum / count) : 0,
    count,
    overruns
  }
}
