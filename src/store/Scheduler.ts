import { Temporal } from '../dates'
import { DEFAULT_DEPENDENCY_OPTION, type StatusConfig, type Task } from '../types'
import { isTerminalStatus } from '../utils'
import { flattenTasks } from './TaskTreeOps'
import {
  addWorkingDays,
  ALL_DAYS,
  alignForward,
  nextWorkingDay,
  workingDaysBetween,
  type WorkCalendar
} from './WorkCalendar'

export interface SchedulePatch {
  taskId: string
  start: string // YYYY-MM-DD
  due: string // YYYY-MM-DD
}

export interface ScheduleResult {
  patches: SchedulePatch[]
  cycles: string[][]
}

export function daysBetween(a: string, b: string): number {
  return Temporal.PlainDate.from(b).since(Temporal.PlainDate.from(a), { largestUnit: 'days' }).days
}

export function addDays(date: string, n: number): string {
  return Temporal.PlainDate.from(date).add({ days: n }).toString()
}

/** Predecessor id -> ids of the tasks waiting on it. */
export function dependentsFromTasks(tasks: Task[]): Map<string, string[]> {
  const dependentsOf = new Map<string, string[]>()
  for (const ft of flattenTasks(tasks)) {
    for (const depId of ft.task.dependencies) {
      const list = dependentsOf.get(depId)
      if (list) list.push(ft.task.id)
      else dependentsOf.set(depId, [ft.task.id])
    }
  }
  return dependentsOf
}

/** Can `fromId` reach `toId` by following dependents? */
export function reaches(dependentsOf: Map<string, string[]>, fromId: string, toId: string): boolean {
  const visited = new Set<string>()
  const queue = [fromId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    if (current === toId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of dependentsOf.get(current) ?? []) {
      queue.push(next)
    }
  }
  return false
}

/**
 * Would making `from` depend on `to` close a cycle? "from depends on to" is the edge
 * to -> from, so yes exactly when `from` can already reach `to`.
 */
export function wouldCreateCycle(tasks: Task[], fromId: string, toId: string): boolean {
  return reaches(dependentsFromTasks(tasks), fromId, toId)
}

/**
 * Date patches derived from the dependency graph. `changed` scopes the pass to the
 * downstream dependents of the task ids it names. Terminal-status tasks never move;
 * their dates are a record of what happened.
 *
 * With `pullForward`, a predecessor that finished early counts as ending on its
 * completion date and its dependents move up by the days saved, keeping their existing
 * slack and never starting before the day after a predecessor ends.
 *
 * Every span and offset is counted in `calendar`'s working days, so a dependent never
 * lands on a weekend or a holiday. The default calendar works every day, which makes
 * this arithmetic identical to plain calendar days.
 */
export function computeSchedule(
  tasks: Task[],
  /** The tasks whose dates just moved. Absent reschedules the whole tree. */
  changed?: string | string[],
  statuses: StatusConfig[] = [],
  pullForward = false,
  /** Predecessors in other projects. They constrain dates here but are never moved. */
  externals: Task[] = [],
  calendar: WorkCalendar = ALL_DAYS
): ScheduleResult {
  const externalIds = new Set(externals.map((t) => t.id))
  const flat = [...flattenTasks(tasks).map((ft) => ft.task), ...externals]
  const taskById = new Map<string, Task>()
  const dependentsOf = new Map<string, string[]>()
  const predecessorsOf = new Map<string, string[]>()

  for (const t of flat) {
    taskById.set(t.id, t)
  }

  for (const t of flat) {
    const validDeps: string[] = []
    for (const depId of t.dependencies) {
      if (!taskById.has(depId)) continue
      validDeps.push(depId)
      const list = dependentsOf.get(depId) ?? []
      list.push(t.id)
      dependentsOf.set(depId, list)
    }
    predecessorsOf.set(t.id, validDeps)
  }

  const seeds = changed === undefined ? [] : typeof changed === 'string' ? [changed] : changed
  let scopeIds: Set<string> | null = null
  if (seeds.length > 0) {
    scopeIds = new Set<string>()
    const queue = [...seeds]
    while (queue.length > 0) {
      const id = queue.shift()
      if (id === undefined) break
      if (scopeIds.has(id)) continue
      scopeIds.add(id)
      for (const depId of dependentsOf.get(id) ?? []) {
        queue.push(depId)
      }
    }
  }

  // Kahn's algorithm: topological sort, with the leftovers being the cycles.
  const inDegree = new Map<string, number>()
  const relevantIds = scopeIds ? [...scopeIds] : flat.map((t) => t.id)

  const scope = scopeIds
  for (const id of relevantIds) {
    const deps = predecessorsOf.get(id) ?? []
    const filtered = scope ? deps.filter((d) => scope.has(d)) : deps
    inDegree.set(id, filtered.length)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const topoOrder: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    topoOrder.push(id)
    for (const depId of dependentsOf.get(id) ?? []) {
      const currentDeg = inDegree.get(depId)
      if (currentDeg === undefined) continue
      const newDeg = currentDeg - 1
      inDegree.set(depId, newDeg)
      if (newDeg === 0) queue.push(depId)
    }
  }

  const sortedSet = new Set(topoOrder)
  const cycleIds = relevantIds.filter((id) => !sortedSet.has(id))
  const cycles: string[][] = cycleIds.length > 0 ? [cycleIds] : []

  // Mutable copies of the dates, so a shift cascades within this run.
  const startOf = new Map<string, string>()
  const dueOf = new Map<string, string>()
  // Days by which a task's finish beat the date it was planned for.
  const daysSavedBy = new Map<string, number>()
  for (const t of flat) {
    startOf.set(t.id, t.start)
    dueOf.set(t.id, t.due)
    if (!pullForward || !t.completed || !t.due || t.completed >= t.due) continue
    // An external's completion date was stamped against its own project's palette, not
    // the one passed here, so its status can't be re-checked from this side.
    if (!externalIds.has(t.id) && !isTerminalStatus(t.status, statuses)) continue
    dueOf.set(t.id, t.completed)
    daysSavedBy.set(t.id, workingDaysBetween(calendar, t.completed, t.due))
  }

  const patches: SchedulePatch[] = []

  for (const id of topoOrder) {
    const task = taskById.get(id)
    if (!task) continue

    if (externalIds.has(id)) continue
    if (isTerminalStatus(task.status, statuses)) continue

    const deps = predecessorsOf.get(id) ?? []
    if (deps.length === 0) continue

    // The tightest date each link demands, and the same date had every predecessor
    // finished on plan. Start-anchored links (FS, SS) bound the start; finish-anchored
    // ones (FF, SF) bound the finish.
    let earliestStart = ''
    let plannedStart = ''
    let earliestDue = ''
    let plannedDue = ''
    for (const depId of deps) {
      const dep = taskById.get(depId)
      if (dep?.archived) continue
      const option = task.dependencyOptions?.[depId] ?? DEFAULT_DEPENDENCY_OPTION
      // FS and FF hang off the predecessor's finish, SS and SF off its start. Only a
      // finish moves when a task is completed early, so only it has a planned variant.
      const fromFinish = option.type === 'FS' || option.type === 'FF'
      const anchor = fromFinish ? (dueOf.get(depId) ?? '') : (startOf.get(depId) ?? '')
      if (!anchor) continue
      const plannedAnchor = fromFinish ? addWorkingDays(calendar, anchor, daysSavedBy.get(depId) ?? 0) : anchor
      // FS is the only link that clears the predecessor's last day before starting.
      const offset = (base: string): string =>
        addWorkingDays(
          calendar,
          option.type === 'FS' ? nextWorkingDay(calendar, base) : alignForward(calendar, base),
          option.lag
        )
      const bound = offset(anchor)
      const plannedBound = offset(plannedAnchor)
      // SF and FF bound the finish; FS and SS bound the start.
      const boundsStart = option.type === 'FS' || option.type === 'SS'
      if (boundsStart) {
        if (!earliestStart || bound > earliestStart) earliestStart = bound
        if (!plannedStart || plannedBound > plannedStart) plannedStart = plannedBound
      } else {
        if (!earliestDue || bound > earliestDue) earliestDue = bound
        if (!plannedDue || plannedBound > plannedDue) plannedDue = plannedBound
      }
    }
    if (!earliestStart && !earliestDue) continue

    const daysSaved = earliestStart
      ? workingDaysBetween(calendar, earliestStart, plannedStart)
      : workingDaysBetween(calendar, earliestDue, plannedDue)
    const currentStart = startOf.get(id) ?? ''
    const currentDue = dueOf.get(id) ?? ''

    const pullBy = (anchor: string) =>
      Math.min(daysSaved, Math.max(0, workingDaysBetween(calendar, earliestStart, anchor)))

    let newStart = currentStart
    let newDue = currentDue
    let pulled = 0

    const isMilestone = task.type === 'milestone' || (!currentStart && currentDue)

    if (!earliestStart) {
      // Only finish-anchored links, handled below: nothing bounds the start.
    } else if (isMilestone) {
      // A milestone has no span, so its due date moves instead of its start.
      if (!currentDue || currentDue < earliestStart) {
        newDue = earliestStart
      } else if (daysSaved > 0) {
        pulled = pullBy(currentDue)
        newDue = addWorkingDays(calendar, currentDue, -pulled)
      }
    } else if (currentStart && currentDue) {
      if (currentStart < earliestStart) {
        // Both ends are inclusive, so the span is one day longer than the gap.
        const duration = workingDaysBetween(calendar, currentStart, currentDue) + 1
        newStart = earliestStart
        newDue = addWorkingDays(calendar, earliestStart, duration - 1)
      } else if (daysSaved > 0) {
        pulled = pullBy(currentStart)
        newStart = addWorkingDays(calendar, currentStart, -pulled)
        newDue = addWorkingDays(calendar, currentDue, -pulled)
      }
    } else if (currentStart && !currentDue) {
      if (currentStart < earliestStart) {
        newStart = earliestStart
      } else if (daysSaved > 0) {
        pulled = pullBy(currentStart)
        newStart = addWorkingDays(calendar, currentStart, -pulled)
      }
    } else {
      newStart = earliestStart
    }

    // A finish-anchored link bounds the finish. The task keeps its length, so the
    // start travels with it.
    if (earliestDue && (!newDue || newDue < earliestDue)) {
      const shift = newDue ? workingDaysBetween(calendar, newDue, earliestDue) : 0
      newDue = earliestDue
      if (newStart && shift > 0) newStart = addWorkingDays(calendar, newStart, shift)
    }

    if (newStart !== currentStart || newDue !== currentDue) {
      startOf.set(id, newStart)
      dueOf.set(id, newDue)
      if (pulled > 0) daysSavedBy.set(id, pulled)
      patches.push({ taskId: id, start: newStart, due: newDue })
    }
  }

  return { patches, cycles }
}
