import type { DependencyType, StatusConfig, Task } from '../types'
import { DEFAULT_DEPENDENCY_OPTION } from '../types'
import { flattenTasks } from './TaskTreeOps'
import { isPhase } from './Phase'
import { daysBetween } from './Template'

/** Where one ticket sits in a plan that has no dates: days from day zero, and how long. */
export interface RelativeBar {
  offset: number
  length: number
}

export interface RelativePlan {
  bars: Map<string, RelativeBar>
  /** How many days the whole thing covers, at least one. */
  span: number
  /** Tickets the links put in a loop: laid at day zero, and worth saying out loud. */
  cycles: string[]
}

/**
 * How long a ticket takes, with or without dates.
 *
 * A template is written without dates on purpose, so the dates are only consulted when
 * someone bothered to put them there — a ticket that says nothing takes a day, which is
 * enough for it to be a bar rather than a point, and a milestone takes none because a
 * milestone is a moment.
 */
export function lengthOf(task: Task): number {
  if (task.type === 'milestone') return 0
  if (task.start && task.due) return Math.max(1, daysBetween(task.start, task.due) + 1)
  return 1
}

/** Where a successor may start, given where its predecessor sits and the link between them. */
export function earliestStart(pred: RelativeBar, type: DependencyType, lag: number, ownLength: number): number {
  switch (type) {
    case 'FS':
      return pred.offset + pred.length + lag
    case 'SS':
      return pred.offset + lag
    case 'FF':
      return pred.offset + pred.length + lag - ownLength
    case 'SF':
      return pred.offset + lag - ownLength
  }
}

/**
 * The plan a set of links implies, in days from the start, with no dates involved.
 *
 * This is what a template has to show: a template is written before anyone knows when
 * the project will run, so its chart cannot be drawn from dates — but the order is
 * already decided, and the order is the thing worth checking. Everything with nothing
 * in front of it starts on day zero; everything else starts as early as its links
 * allow, which is the standard forward pass, and a lot spans what it holds.
 *
 * Links that form a loop cannot be ordered at all. Rather than refuse to draw anything,
 * the tickets in the loop are laid at day zero and named, so the chart says where the
 * problem is instead of hiding it.
 */
export function relativePlan(tasks: Task[], statuses: StatusConfig[] = []): RelativePlan {
  const flat = flattenTasks(tasks).map((entry) => entry.task)
  const byId = new Map(flat.map((task) => [task.id, task]))
  const bars = new Map<string, RelativeBar>()

  // Kahn's algorithm over the links that point at something in this project.
  const predecessors = new Map<string, string[]>()
  const dependents = new Map<string, string[]>()
  for (const task of flat) {
    const deps = task.dependencies.filter((id) => byId.has(id))
    predecessors.set(task.id, deps)
    for (const dep of deps) dependents.set(dep, [...(dependents.get(dep) ?? []), task.id])
  }

  const remaining = new Map(flat.map((task) => [task.id, predecessors.get(task.id)?.length ?? 0]))
  const queue = flat.filter((task) => (remaining.get(task.id) ?? 0) === 0).map((task) => task.id)
  const ordered: string[] = []
  while (queue.length) {
    const id = queue.shift()
    if (id === undefined) break
    ordered.push(id)
    for (const next of dependents.get(id) ?? []) {
      const left = (remaining.get(next) ?? 0) - 1
      remaining.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  const cycles = flat.map((task) => task.id).filter((id) => !ordered.includes(id))

  for (const id of ordered) {
    const task = byId.get(id)
    if (!task) continue
    const length = lengthOf(task)
    let offset = 0
    for (const depId of predecessors.get(id) ?? []) {
      const pred = bars.get(depId)
      if (!pred) continue
      const option = task.dependencyOptions?.[depId] ?? DEFAULT_DEPENDENCY_OPTION
      offset = Math.max(offset, earliestStart(pred, option.type, option.lag, length))
    }
    bars.set(id, { offset: Math.max(0, offset), length })
  }

  // A loop has no order to read, so no member of it can be placed after another. They
  // all go to day zero, which is visibly wrong on the chart — which is the point.
  for (const id of cycles) {
    const task = byId.get(id)
    if (task) bars.set(id, { offset: 0, length: lengthOf(task) })
  }

  // A lot holds work rather than doing any, so it covers what it holds — the same rule
  // its dates follow when it has them.
  for (const task of flat) {
    if (!isPhase(task)) continue
    const held = flattenTasks(task.subtasks)
      .map((entry) => bars.get(entry.task.id))
      .filter((bar): bar is RelativeBar => !!bar)
    if (!held.length) continue
    const from = Math.min(...held.map((bar) => bar.offset))
    const to = Math.max(...held.map((bar) => bar.offset + bar.length))
    bars.set(task.id, { offset: from, length: Math.max(1, to - from) })
  }

  const span = Math.max(1, ...[...bars.values()].map((bar) => bar.offset + bar.length))
  return { bars, span, cycles }
}
