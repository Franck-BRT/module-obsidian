import type { GanttGranularity, Task } from '../../types'
import type { RelativePlan } from '../../store/RelativePlan'
import type { TimelineCfg } from './TimelineConfig'
import { DAY_WIDTH } from './TimelineConfig'
import { flattenTasks } from '../../store/TaskTreeOps'
import { addDays } from '../../store/Metrics'
import { Temporal, parsePlainDate } from '../../dates'

/** A plan shorter than this still gets a month of axis, so its bars are readable. */
const MIN_WEEKS = 4

/**
 * The day the chart pretends the plan starts on.
 *
 * A Monday, so a week-by-week axis counts whole weeks from the start, and far enough in
 * the past that today's line never lands in the middle of a template. It is never shown:
 * the axis is relabelled in days from the start.
 */
export const RELATIVE_ANCHOR = '2000-01-03'

/**
 * The tasks a dateless plan is drawn with.
 *
 * The chart reads `start` and `due` — every bar, every arrow, every summary bracket — so
 * rather than teach all of it a second way to place a bar, the plan is projected onto
 * days counted from an anchor and the chart draws that. The anchor never reaches the
 * reader: the axis is relabelled in days from the start, and the copies never reach the
 * store either, which is why the real tickets are kept beside them for editing.
 */
export function projectOntoDays(tasks: Task[], plan: RelativePlan, anchor: string): Task[] {
  const project = (task: Task): Task => {
    const bar = plan.bars.get(task.id)
    return {
      ...task,
      start: bar ? addDays(anchor, bar.offset) : '',
      // A bar of n days covers days 0..n-1, and a milestone is one day wide so it has a
      // point to be drawn at.
      due: bar ? addDays(anchor, bar.offset + Math.max(bar.length, 1) - 1) : '',
      subtasks: task.subtasks.map(project)
    }
  }
  return tasks.map(project)
}

/** The real ticket behind every projected copy, so an edit never lands on a copy. */
export function realTasksById(tasks: Task[]): Map<string, Task> {
  return new Map(flattenTasks(tasks).map((entry) => [entry.task.id, entry.task]))
}

/**
 * The axis the projected bars are drawn against.
 *
 * The ordinary one folds today into its span and pads it out to a readable minimum, which
 * is right for a project and wrong for a template: with an anchor in the past it would
 * stretch six weeks of work across a quarter of a century. This one starts on the anchor,
 * runs in whole weeks so the last band is as wide as the rest, and keeps a month's width
 * for a plan too short to fill one.
 */
export function relativeTimelineConfig(plan: RelativePlan, granularity: GanttGranularity): TimelineCfg {
  const weeks = Math.max(MIN_WEEKS, Math.ceil(plan.span / 7))
  const totalDays = weeks * 7
  const startDate = parsePlainDate(RELATIVE_ANCHOR) ?? Temporal.PlainDate.from(RELATIVE_ANCHOR)
  const dayWidth = DAY_WIDTH[granularity]
  return {
    startDate,
    endDate: startDate.add({ days: totalDays }),
    dayWidth,
    granularity,
    totalDays,
    totalWidth: totalDays * dayWidth
  }
}
