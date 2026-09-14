import type { DependencyType, Task } from '../types'
import { DEFAULT_DEPENDENCY_OPTION } from '../types'
import type { WorkCalendar } from './WorkCalendar'
import { ALL_DAYS, workingDaysBetween } from './WorkCalendar'
import { flattenTasks } from './TaskTreeOps'
import { isPhase } from './Phase'

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
 * A template is written without dates on purpose, which is what the **duration** is for:
 * at that stage one knows roughly how long a thing takes and not at all when it happens,
 * so a stated duration is the most deliberate answer there is and comes first. Dates are
 * consulted next, for the templates that were laid out that way; a ticket that says
 * neither takes a day, which is enough for it to be a bar rather than a point.
 *
 * A milestone does no work, but it **owns the day it marks**: what follows it opens the
 * day after, which is the rule the project's own scheduler applies once the dates are
 * real — an FS link clears its predecessor's last day before starting. Giving it no day
 * here would put the next bar's left edge half a column behind the diamond's centre, and
 * draw the arrow between them pointing backwards.
 *
 * Days are counted the way the project counts them — plain days, or working days when it
 * keeps off weekends and holidays — so a duration means the same thing here as it will
 * once the project is created and its dates are real.
 */
export function lengthOf(task: Task, calendar: WorkCalendar = ALL_DAYS): number {
  if (task.type === 'milestone') return 1
  if (task.duration !== undefined && task.duration > 0) return Math.max(1, Math.round(task.duration))
  if (task.start && task.due) return Math.max(1, workingDaysBetween(calendar, task.start, task.due) + 1)
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
 * allow, which is the standard forward pass.
 *
 * A lot takes part in that pass twice over, because a lot is a container and not a
 * ticket. It **covers what it holds**, so anything waiting on it waits for the last of
 * them rather than for a nominal day; and its own links **bind what it holds**, so a lot
 * told to follow another opens after it and takes its contents along. Neither half works
 * without the other: reading a lot as a one-day ticket would let a successor start inside
 * it, and placing a lot without moving its contents would drag it straight back onto them.
 *
 * Links that form a loop cannot be ordered at all. Rather than refuse to draw anything,
 * the tickets in the loop are laid at day zero and named, so the chart says where the
 * problem is instead of hiding it.
 */
export function relativePlan(tasks: Task[], calendar: WorkCalendar = ALL_DAYS): RelativePlan {
  const flat = flattenTasks(tasks)
  const byId = new Map(flat.map((entry) => [entry.task.id, entry.task]))
  const parentOf = new Map<string, string>()
  for (const entry of flat) if (entry.parentId) parentOf.set(entry.task.id, entry.parentId)
  /** Everything a lot holds, at any depth. Empty for anything that is not a lot. */
  const heldBy = new Map<string, string[]>(
    flat.map((entry) => [
      entry.task.id,
      isPhase(entry.task) ? flattenTasks(entry.task.subtasks).map((held) => held.task.id) : []
    ])
  )

  // Kahn's algorithm, over the links and over what containment implies: a lot can only be
  // placed once what it holds is placed, and what a lot holds can only be placed once
  // whatever the lot waits on is.
  const dependents = new Map<string, string[]>()
  const remaining = new Map<string, number>(flat.map((entry) => [entry.task.id, 0]))
  const edge = (from: string, to: string): void => {
    dependents.set(from, [...(dependents.get(from) ?? []), to])
    remaining.set(to, (remaining.get(to) ?? 0) + 1)
  }
  const linkPreds = new Map<string, string[]>()
  for (const { task } of flat) {
    const deps = task.dependencies.filter((id) => byId.has(id))
    linkPreds.set(task.id, deps)
    for (const dep of deps) {
      edge(dep, task.id)
      for (const inside of heldBy.get(task.id) ?? []) edge(dep, inside)
    }
    for (const inside of heldBy.get(task.id) ?? []) edge(inside, task.id)
  }

  const queue = flat.filter((entry) => remaining.get(entry.task.id) === 0).map((entry) => entry.task.id)
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
  const placed = new Set(ordered)
  const cycles = flat.map((entry) => entry.task.id).filter((id) => !placed.has(id))

  // A loop has no order to read, so no member of it can be placed after another. They all
  // go to day zero, which is visibly wrong on the chart — which is the point. Doing it
  // first rather than last means a lot holding one still covers it.
  const bars = new Map<string, RelativeBar>(
    cycles.flatMap((id) => {
      const task = byId.get(id)
      return task ? [[id, { offset: 0, length: lengthOf(task, calendar) }] as const] : []
    })
  )

  const floorFromLinks = (task: Task, ownLength: number): number => {
    let floor = 0
    for (const depId of linkPreds.get(task.id) ?? []) {
      const pred = bars.get(depId)
      if (!pred) continue
      const option = task.dependencyOptions?.[depId] ?? DEFAULT_DEPENDENCY_OPTION
      floor = Math.max(floor, earliestStart(pred, option.type, option.lag, ownLength))
    }
    return Math.max(0, floor)
  }

  // The floor a lot's own links put under it. It is read before the lot itself is placed —
  // what it holds needs it first — so it is worked out on demand and kept. FF and SF need
  // a length the lot does not have yet, and take what it declares.
  const lotFloors = new Map<string, number>()
  const lotFloor = (id: string): number => {
    const known = lotFloors.get(id)
    if (known !== undefined) return known
    const lot = byId.get(id)
    const floor = lot ? Math.max(floorFromLinks(lot, lengthOf(lot, calendar)), inheritedFloor(id)) : 0
    lotFloors.set(id, floor)
    return floor
  }
  /** What the lots around a ticket impose on it, however deep it sits inside them. */
  function inheritedFloor(id: string): number {
    let floor = 0
    for (let parent = parentOf.get(id); parent !== undefined; parent = parentOf.get(parent)) {
      floor = Math.max(floor, lotFloor(parent))
    }
    return floor
  }

  for (const id of ordered) {
    const task = byId.get(id)
    if (!task) continue
    const held = (heldBy.get(id) ?? []).flatMap((inside) => bars.get(inside) ?? [])
    if (held.length) {
      // A lot holds work rather than doing any, so it covers what it holds — the same
      // rule its dates follow when it has them.
      const from = Math.min(...held.map((bar) => bar.offset))
      const to = Math.max(...held.map((bar) => bar.offset + bar.length))
      bars.set(id, { offset: from, length: Math.max(1, to - from) })
      continue
    }
    const length = lengthOf(task, calendar)
    bars.set(id, { offset: Math.max(floorFromLinks(task, length), inheritedFloor(id)), length })
  }

  const span = Math.max(1, ...[...bars.values()].map((bar) => bar.offset + bar.length))
  return { bars, span, cycles }
}
