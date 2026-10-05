import type { StatusConfig, Task } from '../types'
import { Temporal } from '../dates'
import { isTerminalStatus } from '../utils'
import { isDecision } from './decision'
import { isReserve } from './reserve'
import { isDocument } from './Document'
import { isMeeting } from './Meeting'
import { isPhase } from './Phase'
import { isRisk } from './risk'
import { flattenTasks } from './TaskTreeOps'
import { isWorkingDay, type WorkCalendar } from './WorkCalendar'
import { minutesBetween } from './Clock'

/**
 * The load plan: for each person, the hours of work they hold week by week, across every
 * project, set against what they can give in a week.
 *
 * A ticket's work is what is left of its estimate — its progress taken off — spread
 * evenly over the working days from today, or its start when later, to its due date,
 * and shared between the people it is assigned to. A ticket with no estimate counts a
 * set number of hours on each of its working days, for each of its people: the plan
 * then says where people are spread thin, if not by how much. Work past its date is
 * still owed: what is left of it falls in the current week. A meeting counts its own
 * hours on its day. Lots, milestones, risks and decisions are not work; a document is
 * work only when it was given an estimate — it is otherwise someone else's to produce.
 */

export interface LoadOptions {
  /** Today, YYYY-MM-DD: nothing before it is counted. */
  today: string
  /** How many weeks, from the one holding today. */
  weeks: number
  /** Hours a day a ticket with no estimate holds each of its people; 0 counts none. */
  defaultHoursPerDay: number
  /** Hours a meeting with no times holds. */
  meetingHours: number
  /** The key a name is known by, so a link and a bare name are one person. */
  keyOf: (raw: string) => string
}

export interface LoadProject {
  path: string
  title: string
  tasks: Task[]
  statuses: StatusConfig[]
  calendar: WorkCalendar
}

/** What one ticket puts on one person in one week. */
export interface LoadPiece {
  taskId: string
  title: string
  projectPath: string
  projectTitle: string
  hours: number
  /** From an estimate, rather than the set hours a day. */
  estimated: boolean
  /** Past its date: its remaining work fell in the current week. */
  late: boolean
  start: string
  due: string
}

export interface PersonLoad {
  key: string
  /** The name as first written: a link or a bare name; '' for work nobody holds. */
  raw: string
  /** Hours each week. */
  hours: number[]
  /** The tickets behind each week's hours. */
  pieces: LoadPiece[][]
  /** Estimated work with no date at all: owed, but nowhere in the plan. */
  unscheduled: LoadPiece[]
}

export interface Workload {
  /** The Monday of each week. */
  weeks: string[]
  people: PersonLoad[]
}

const plain = (iso: string): Temporal.PlainDate => Temporal.PlainDate.from(iso)

/** The Monday of the week a day falls in. */
export function mondayOf(iso: string): string {
  const day = plain(iso)
  return day.subtract({ days: day.dayOfWeek - 1 }).toString()
}

/** The Mondays of `count` weeks, from the one holding `today`. */
export function weekStarts(today: string, count: number): string[] {
  const first = plain(mondayOf(today))
  return Array.from({ length: Math.max(1, count) }, (_, at) => first.add({ weeks: at }).toString())
}

/** Whether a ticket is work the plan counts, and how. */
function kindOf(task: Task): 'work' | 'meeting' | null {
  if (isPhase(task) || isRisk(task) || isDecision(task) || isReserve(task) || task.type === 'milestone') return null
  if (isMeeting(task)) return 'meeting'
  if (isDocument(task) && !(task.timeEstimate && task.timeEstimate > 0)) return null
  return 'work'
}

/** The working days from `from` to `to`, both included, at most `cap` days past `from`. */
function workingDays(calendar: WorkCalendar, from: string, to: string, cap: string): string[] {
  const out: string[] = []
  let day = plain(from)
  const last = plain(to < cap ? to : cap)
  while (Temporal.PlainDate.compare(day, last) <= 0) {
    const iso = day.toString()
    if (isWorkingDay(calendar, iso)) out.push(iso)
    day = day.add({ days: 1 })
  }
  return out
}

/** How many working days from `from` to `to`, both included — however far apart. */
function countWorkingDays(calendar: WorkCalendar, from: string, to: string): number {
  if (to < from) return 0
  const span = plain(to).since(plain(from), { largestUnit: 'days' }).days + 1
  const weeks = Math.floor(span / 7)
  let count = weeks * calendar.workingWeekdays.size
  let day = plain(from).add({ days: weeks * 7 })
  for (let at = weeks * 7; at < span; at++, day = day.add({ days: 1 })) {
    if (calendar.workingWeekdays.has(day.dayOfWeek)) count++
  }
  for (const holiday of calendar.holidays) {
    if (holiday >= from && holiday <= to && calendar.workingWeekdays.has(plain(holiday).dayOfWeek)) count--
  }
  return Math.max(0, count)
}

/** Hours, kept to a quarter. */
function quarter(hours: number): number {
  return Math.round(hours * 4) / 4
}

export function workload(projects: LoadProject[], options: LoadOptions): Workload {
  const weeks = weekStarts(options.today, options.weeks)
  const first = weeks[0]
  const end = plain(weeks[weeks.length - 1])
    .add({ days: 6 })
    .toString()
  const people = new Map<string, PersonLoad>()
  const personOf = (raw: string): PersonLoad => {
    const key = raw ? options.keyOf(raw) : ''
    let person = people.get(key)
    if (!person) {
      person = { key, raw, hours: weeks.map(() => 0), pieces: weeks.map(() => []), unscheduled: [] }
      people.set(key, person)
    }
    return person
  }
  const weekAt = (day: string): number => Math.floor(plain(day).since(plain(first), { largestUnit: 'days' }).days / 7)

  for (const project of projects) {
    for (const { task } of flattenTasks(project.tasks)) {
      if (task.archived || isTerminalStatus(task.status, project.statuses)) continue
      const kind = kindOf(task)
      if (!kind) continue
      const holders = task.assignees.length ? task.assignees : ['']
      const base = {
        taskId: task.id,
        title: task.title,
        projectPath: project.path,
        projectTitle: project.title,
        start: task.start,
        due: task.due
      }
      // Each day's hours, then gathered by week for each person.
      const days = new Map<string, number>()
      let estimated = false
      let late = false
      if (kind === 'meeting') {
        const day = task.due || task.start
        if (!day || day < options.today || day > end) continue
        const minutes = minutesBetween(task.startTime ?? '', task.endTime ?? '')
        days.set(day, minutes ? minutes / 60 : options.meetingHours)
      } else {
        const estimate = task.timeEstimate && task.timeEstimate > 0 ? task.timeEstimate : 0
        const left = estimate * (1 - Math.min(100, Math.max(0, task.progress || 0)) / 100)
        const from0 = task.start || task.due
        const to0 = task.due || task.start
        if (!from0) {
          // No date at all: what is estimated is owed, but in no week.
          if (left > 0) {
            for (const raw of holders) {
              personOf(raw).unscheduled.push({
                ...base,
                hours: quarter(left / holders.length),
                estimated: true,
                late: false
              })
            }
          }
          continue
        }
        estimated = left > 0
        if (estimate && left <= 0) continue
        if (to0 < options.today) {
          // Past its date and not done: what is left falls now.
          late = true
          if (estimated) days.set(options.today, left)
          else {
            // Not estimated: its set hours, on what is left of this week.
            const sunday = plain(first).add({ days: 6 }).toString()
            for (const day of workingDays(project.calendar, options.today, sunday, end)) {
              days.set(day, options.defaultHoursPerDay)
            }
          }
        } else {
          const from = from0 > options.today ? from0 : options.today
          if (estimated) {
            const total = countWorkingDays(project.calendar, from, to0)
            if (!total) days.set(to0, left)
            else for (const day of workingDays(project.calendar, from, to0, end)) days.set(day, left / total)
          } else {
            for (const day of workingDays(project.calendar, from, to0, end)) days.set(day, options.defaultHoursPerDay)
          }
        }
      }
      for (const raw of holders) {
        const person = personOf(raw)
        // An estimate is shared between its people; set hours, or a meeting, each holds whole.
        const share = estimated ? 1 / holders.length : 1
        const byWeek = new Map<number, number>()
        for (const [day, hours] of days) {
          if (day < first || day > end || !hours) continue
          const at = weekAt(day)
          byWeek.set(at, (byWeek.get(at) ?? 0) + hours * share)
        }
        for (const [at, hours] of byWeek) {
          person.hours[at] += hours
          person.pieces[at].push({ ...base, hours: quarter(hours), estimated: estimated || kind === 'meeting', late })
        }
      }
    }
  }
  const out = [...people.values()].filter(
    (person) => person.hours.some((hours) => hours > 0) || person.unscheduled.length
  )
  for (const person of out) {
    person.hours = person.hours.map(quarter)
    for (const week of person.pieces) week.sort((a, b) => b.hours - a.hours || a.title.localeCompare(b.title))
  }
  // The busiest first, work nobody holds last.
  out.sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1
    const peak = (person: PersonLoad): number => Math.max(...person.hours)
    return peak(b) - peak(a) || a.raw.localeCompare(b.raw)
  })
  return { weeks, people: out }
}

/** How full a week is against a capacity: under, near (from 85 %), over. */
export function loadLevel(hours: number, capacity: number): 'empty' | 'under' | 'near' | 'over' {
  if (hours <= 0) return 'empty'
  if (capacity <= 0) return 'over'
  const ratio = hours / capacity
  return ratio > 1 ? 'over' : ratio >= 0.85 ? 'near' : 'under'
}
