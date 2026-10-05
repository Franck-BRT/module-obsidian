import { makeTask, type DependencyType, type Task } from '../../types'

/**
 * A planning brought from elsewhere — MS Project, a spreadsheet —, as this plugin will
 * hold it: an outline of lines, those with lines under them becoming lots, those of no
 * length milestones, the others tasks, each with its dates, its progress, its people and
 * its links to the lines it follows.
 */

export interface PlanLink {
  /** The key of the line it follows. */
  key: string
  type: DependencyType
  /** Days, positive or negative. */
  lag: number
}

export interface PlanLine {
  /** Its id in the source: MS Project's UID, the sheet's line number. */
  key: string
  title: string
  /** 1 for the top of the outline. */
  level: number
  start: string
  due: string
  milestone: boolean
  /** 0–100. */
  progress: number
  people: string[]
  notes: string
  links: PlanLink[]
}

/** What could not be read: a link to a line that is not there, or a date not understood. */
export interface PlanWarning {
  line: string
  kind: 'link' | 'date'
  /** The missing line's key, or the date as written. */
  value: string
}

export interface Plan {
  name: string
  lines: PlanLine[]
  /** What could not be read as asked: a link to a line that is not there, a date not understood. */
  warnings: PlanWarning[]
}

export interface PlanCounts {
  lots: number
  tasks: number
  milestones: number
  links: number
  people: number
  start: string
  due: string
}

/** Which lines hold others: those followed by a deeper one. */
function holders(lines: PlanLine[]): Set<number> {
  const out = new Set<number>()
  lines.forEach((line, at) => {
    const next = lines[at + 1]
    if (next && next.level > line.level) out.add(at)
  })
  return out
}

export function planCounts(plan: Plan): PlanCounts {
  const lots = holders(plan.lines)
  const dates = plan.lines
    .flatMap((line) => [line.start, line.due])
    .filter(Boolean)
    .sort()
  return {
    lots: lots.size,
    tasks: plan.lines.filter((line, at) => !lots.has(at) && !line.milestone).length,
    milestones: plan.lines.filter((line, at) => !lots.has(at) && line.milestone).length,
    links: plan.lines.reduce((total, line) => total + line.links.length, 0),
    people: new Set(plan.lines.flatMap((line) => line.people)).size,
    start: dates[0] ?? '',
    due: dates[dates.length - 1] ?? ''
  }
}

/**
 * The plan as tickets: an outline of trees, every link pointing to the new id of the
 * line it follows. A line with lines under it is a lot, whose dates are its lines'.
 */
export function planTasks(plan: Plan, doneStatus = 'done'): Task[] {
  const lots = holders(plan.lines)
  const ids = new Map<string, string>()
  const made = plan.lines.map((line, at) => {
    const lot = lots.has(at)
    const task = makeTask({
      title: line.title || '—',
      type: lot ? 'phase' : line.milestone ? 'milestone' : 'task',
      start: lot || line.milestone ? '' : line.start,
      due: lot ? '' : line.due || line.start,
      progress: lot ? 0 : Math.max(0, Math.min(100, Math.round(line.progress))),
      ...(line.progress >= 100 && !lot ? { status: doneStatus } : {}),
      assignees: [...line.people],
      description: line.notes
    })
    ids.set(line.key, task.id)
    return task
  })
  plan.lines.forEach((line, at) => {
    const task = made[at]
    const links = line.links.filter((link) => ids.has(link.key) && link.key !== line.key)
    task.dependencies = links.map((link) => ids.get(link.key) ?? '')
    const options = links.filter((link) => link.type !== 'FS' || link.lag)
    if (options.length) {
      task.dependencyOptions = Object.fromEntries(
        options.map((link) => [ids.get(link.key) ?? '', { type: link.type, lag: link.lag }])
      )
    }
  })
  // The outline: each line under the nearest line above it that is shallower.
  const roots: Task[] = []
  const stack: { level: number; task: Task }[] = []
  plan.lines.forEach((line, at) => {
    while (stack.length && stack[stack.length - 1].level >= line.level) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.task.subtasks.push(made[at])
    else roots.push(made[at])
    stack.push({ level: line.level, task: made[at] })
  })
  return roots
}
