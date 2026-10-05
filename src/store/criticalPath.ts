import { DEFAULT_DEPENDENCY_OPTION, type StatusConfig, type Task } from '../types'
import { isTerminalStatus } from '../utils'
import { isPhase } from './Phase'
import { flattenTasks } from './TaskTreeOps'
import { addWorkingDays, ALL_DAYS, workingDaysBetween, type WorkCalendar } from './WorkCalendar'

/**
 * The critical path, read off the plan as it stands: the work still to do, its dates and
 * the links between them. Walking back from the last day of the plan through each link —
 * finish-to-start, start-to-start, finish-to-finish, start-to-finish, with their lags —
 * gives every ticket the latest day it may finish without pushing that last day. What
 * lies between that day and its own due date is its margin, in the project's working
 * days; a ticket with none is critical: every day it slips, the end slips too.
 *
 * Only what is still open counts: a ticket done has nothing left to slip, and a phase,
 * a meeting, a risk, a decision or a reserve is not work that holds the next up. A link
 * to a phase stands for links to everything the phase holds.
 */

export interface TaskFloat {
  /** Working days it may slip without moving the end; 0 or less is critical. */
  float: number
  /** The latest day it may finish so. */
  latestDue: string
  critical: boolean
}

export interface CriticalPath {
  /** The last day of the work still to do: where the plan ends. '' when nothing is dated. */
  end: string
  floats: Map<string, TaskFloat>
  /** The critical tickets, in the order they run. */
  path: Task[]
}

const NOT_WORK = new Set(['meeting', 'risk', 'decision', 'reserve'])

/** Whether a ticket is work that can sit on the path: dated, open, not a phase nor a record. */
function charted(task: Task, statuses: StatusConfig[]): boolean {
  if (task.archived || isPhase(task) || NOT_WORK.has(task.type)) return false
  if (!task.due && !task.start) return false
  return !isTerminalStatus(task.status, statuses)
}

interface Node {
  task: Task
  /** Its first and last day, as working days from the plan's first. */
  start: number
  finish: number
}

/** How many working days a slip of `days` pushes the end: what the margin does not absorb. */
export function endSlip(float: number, days: number): number {
  return Math.max(0, days - Math.max(0, float))
}

export function criticalPath(
  tasks: Task[],
  statuses: StatusConfig[] = [],
  calendar: WorkCalendar = ALL_DAYS
): CriticalPath {
  const flat = flattenTasks(tasks).map((one) => one.task)
  const nodes = new Map<string, Node>()
  const dated = flat.filter((task) => charted(task, statuses))
  if (!dated.length) return { end: '', floats: new Map(), path: [] }
  const origin = dated.map((task) => task.start || task.due).reduce((a, b) => (b < a ? b : a))
  const at = (date: string): number => workingDaysBetween(calendar, origin, date)
  for (const task of dated) {
    const first = task.type === 'milestone' ? task.due || task.start : task.start || task.due
    const last = task.type === 'milestone' ? first : task.due || task.start
    const start = at(first)
    nodes.set(task.id, { task, start, finish: Math.max(start, at(last)) })
  }

  // What a link to a phase stands for: everything it holds that is charted.
  const heldBy = new Map<string, string[]>()
  for (const task of flat) {
    if (!isPhase(task)) continue
    heldBy.set(
      task.id,
      flattenTasks(task.subtasks)
        .map((one) => one.task.id)
        .filter((id) => nodes.has(id))
    )
  }

  // Each link, from the predecessor's side: who waits on it, how and with what lag.
  const successors = new Map<string, { id: string; type: string; lag: number }[]>()
  for (const node of nodes.values()) {
    for (const depId of node.task.dependencies) {
      const option = node.task.dependencyOptions?.[depId] ?? DEFAULT_DEPENDENCY_OPTION
      const froms = nodes.has(depId) ? [depId] : (heldBy.get(depId) ?? [])
      for (const from of froms) {
        if (from === node.task.id) continue
        successors.set(from, [...(successors.get(from) ?? []), { id: node.task.id, ...option }])
      }
    }
  }

  const end = Math.max(...[...nodes.values()].map((node) => node.finish))
  const latest = new Map<string, number>()
  // Walked back from the end: a ticket settles once every one waiting on it has. Those
  // caught in a loop of links never settle, and get no margin.
  const pending = new Map<string, number>()
  for (const [id, list] of successors) pending.set(id, list.length)
  const queue = [...nodes.keys()].filter((id) => !pending.get(id))
  // Predecessors of each node, to know whom a settled node releases.
  const predecessors = new Map<string, string[]>()
  for (const [from, list] of successors) {
    for (const link of list) predecessors.set(link.id, [...(predecessors.get(link.id) ?? []), from])
  }
  while (queue.length) {
    const id = queue.shift()
    if (id === undefined) break
    const node = nodes.get(id)
    if (!node) continue
    const length = node.finish - node.start
    let bound = end
    for (const link of successors.get(id) ?? []) {
      const next = nodes.get(link.id)
      const nextFinish = latest.get(link.id)
      if (!next || nextFinish === undefined) continue
      const nextStart = nextFinish - (next.finish - next.start)
      // FS waits for the day after the finish; SS and SF hang off the start, so the
      // finish may be as late as the start's bound plus the ticket's own length.
      const limit =
        link.type === 'SS'
          ? nextStart - link.lag + length
          : link.type === 'FF'
            ? nextFinish - link.lag
            : link.type === 'SF'
              ? nextFinish - link.lag + length
              : nextStart - 1 - link.lag
      bound = Math.min(bound, limit)
    }
    latest.set(id, bound)
    for (const from of predecessors.get(id) ?? []) {
      const left = (pending.get(from) ?? 0) - 1
      pending.set(from, left)
      if (left === 0) queue.push(from)
    }
  }

  const floats = new Map<string, TaskFloat>()
  for (const [id, bound] of latest) {
    const node = nodes.get(id)
    if (!node) continue
    const float = bound - node.finish
    floats.set(id, { float, latestDue: addWorkingDays(calendar, origin, bound), critical: float <= 0 })
  }
  const path = [...nodes.values()]
    .filter((node) => floats.get(node.task.id)?.critical)
    .sort((a, b) => a.start - b.start || a.finish - b.finish || a.task.title.localeCompare(b.task.title))
    .map((node) => node.task)
  return { end: addWorkingDays(calendar, origin, end), floats, path }
}
