import type { Task, GanttGranularity } from '../../types'
import { flattenTasks } from '../../store/TaskTreeOps'
import { Temporal, today, parsePlainDate } from '../../dates'

export const ROW_HEIGHT = 44
export const HEADER_HEIGHT = 56
export const LABEL_WIDTH = 280
export const BAR_PADDING = 8
export const BAR_BORDER_RADIUS = 7
/** Half the width of a milestone diamond, from its centre to its left or right point. */
export const MILESTONE_SIZE = 12

export const DAY_WIDTH: Record<GanttGranularity, number> = {
  day: 44,
  week: 22,
  month: 9,
  quarter: 5,
  year: 2
}

export interface TimelineCfg {
  startDate: Temporal.PlainDate
  endDate: Temporal.PlainDate
  dayWidth: number
  granularity: GanttGranularity
  totalDays: number
  totalWidth: number
}

const MIN_DAYS: Record<GanttGranularity, number> = {
  day: 30,
  week: 90,
  month: 365,
  quarter: 365,
  year: 1095
}

export function buildTimelineConfig(tasks: Task[], granularity: GanttGranularity): TimelineCfg {
  const allTasks = flattenTasks(tasks).map((f) => f.task)
  const dates: Temporal.PlainDate[] = []

  for (const t of allTasks) {
    const start = parsePlainDate(t.start)
    const due = parsePlainDate(t.due)
    if (start) dates.push(start)
    if (due) dates.push(due)
  }

  const now = today()
  dates.push(now)

  let startDate = dates.reduce((min, d) => (Temporal.PlainDate.compare(d, min) < 0 ? d : min), dates[0])
  let endDate = dates.reduce((max, d) => (Temporal.PlainDate.compare(d, max) > 0 ? d : max), dates[0])

  startDate = startDate.subtract({ days: 7 })
  endDate = endDate.add({ days: 14 })

  const currentSpan = endDate.since(startDate, { largestUnit: 'days' }).days
  if (currentSpan < MIN_DAYS[granularity]) {
    const extra = Math.ceil((MIN_DAYS[granularity] - currentSpan) / 2)
    startDate = startDate.subtract({ days: extra })
    endDate = endDate.add({ days: extra })
  }

  if (granularity !== 'day') {
    startDate = startDate.with({ day: 1 })
  }

  const dayWidth = DAY_WIDTH[granularity]
  const totalDays = endDate.since(startDate, { largestUnit: 'days' }).days
  return {
    startDate,
    endDate,
    dayWidth,
    granularity,
    totalDays,
    totalWidth: totalDays * dayWidth
  }
}

export function dateToX(cfg: TimelineCfg, date: Temporal.PlainDate): number {
  return date.since(cfg.startDate, { largestUnit: 'days' }).days * cfg.dayWidth
}

export function xToDate(cfg: TimelineCfg, x: number): Temporal.PlainDate {
  return cfg.startDate.add({ days: Math.round(x / cfg.dayWidth) })
}

/**
 * Snap-point X positions. day: every day border. week: Monday and Thursday.
 * month: 1st, ~8th, ~15th, ~22nd. quarter and year: the 1st of each month.
 */
export function getSnapPoints(cfg: TimelineCfg): number[] {
  const points: number[] = []
  const { startDate, totalDays, dayWidth, granularity } = cfg

  for (let i = 0; i <= totalDays; i++) {
    const d = startDate.add({ days: i })
    const x = i * dayWidth

    if (granularity === 'day') {
      points.push(x)
    } else if (granularity === 'week') {
      // Temporal dayOfWeek runs Mon=1 to Sun=7.
      if (d.dayOfWeek === 1 || d.dayOfWeek === 4) points.push(x)
    } else if (granularity === 'month') {
      if (d.day === 1 || d.day === 8 || d.day === 15 || d.day === 22) points.push(x)
    } else if (d.day === 1) {
      points.push(x)
    }
  }
  return points
}

/** Snap an x position to the nearest snap point within a threshold. */
export function snapX(x: number, snapPoints: number[], threshold: number): number {
  let closest = x
  let minDist = Infinity
  for (const sp of snapPoints) {
    const dist = Math.abs(x - sp)
    if (dist < minDist) {
      minDist = dist
      closest = sp
    }
    if (sp > x + threshold) break // snap points are sorted, no need to continue
  }
  return minDist <= threshold ? closest : x
}

export function getWeekNumber(d: Temporal.PlainDate): number {
  return d.weekOfYear ?? 0
}

/**
 * Where a dependency arrow leaves a ticket, and where one arrives at it.
 *
 * A bar runs from the start of its first day to the end of its last, so an arrow leaves
 * its right edge and arrives at its left. A milestone has no span at all — it is a
 * diamond drawn in the middle of the day it marks, and it carries **no start date**, so
 * reading `start` for it yields nothing and its incoming arrows were being dropped
 * altogether. It is anchored on the diamond's own points instead, which is also what
 * keeps the arrow touching it at every zoom level rather than at one.
 */
export function arrowStartX(task: Pick<Task, 'type' | 'start' | 'due'>, cfg: TimelineCfg): number | null {
  const date = parsePlainDate(task.due) ?? parsePlainDate(task.start)
  if (!date) return null
  if (task.type === 'milestone') return dateToX(cfg, date) + cfg.dayWidth / 2 + MILESTONE_SIZE
  return dateToX(cfg, date.add({ days: 1 }))
}

export function arrowEndX(task: Pick<Task, 'type' | 'start' | 'due'>, cfg: TimelineCfg): number | null {
  if (task.type === 'milestone') {
    const date = parsePlainDate(task.due) ?? parsePlainDate(task.start)
    return date === null ? null : dateToX(cfg, date) + cfg.dayWidth / 2 - MILESTONE_SIZE
  }
  const start = parsePlainDate(task.start) ?? parsePlainDate(task.due)
  return start === null ? null : dateToX(cfg, start)
}
