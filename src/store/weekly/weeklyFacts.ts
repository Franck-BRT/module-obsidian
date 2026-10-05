import { Temporal } from '../../dates'
import type { StatusConfig, Task } from '../../types'
import { isTerminalStatus } from '../../utils'
import { isPhase } from '../Phase'
import { flattenTasks } from '../TaskTreeOps'
import { addDays } from '../Metrics'
import { documentOf, isDocument } from '../Document'
import { decisionDay, isDecision, isPending } from '../decision'
import { isReserve, isLateReserve, reserveOf } from '../reserve'
import { projectBudget } from '../budget'
import { criticalPath } from '../criticalPath'
import { ALL_DAYS, type WorkCalendar } from '../WorkCalendar'

/**
 * What changed in a project over a week, read off its tickets: what was finished, what
 * fell late, what moved, the milestones met or missed, the decisions taken, the
 * documents received and signed, the reserves raised and lifted, the money committed and
 * invoiced, and where the plan now ends. What a ticket does not date — a due date moved,
 * the progress, the forecast — is read against a snapshot kept from the week before.
 */

/** The state a week's report leaves, for the next to compare against. */
export interface WeeklySnapshot {
  /** YYYY-MM-DD. */
  taken: string
  progress: number
  /** The planned end of the work, '' when nothing is dated. */
  end: string
  forecast: number
  /** Each open ticket's due date, by id. */
  dues: Record<string, string>
}

export interface Moved {
  task: Task
  /** Days later; negative when brought forward. */
  days: number
}

export interface WeeklyFacts {
  week: string
  /** The week looked at, both days included. */
  from: string
  to: string
  progress: { now: number; before: number | null }
  end: { now: string; before: string | null }
  done: Task[]
  late: { task: Task; days: number; fresh: boolean }[]
  moved: Moved[]
  upcoming: Task[]
  milestones: { met: Task[]; missed: Task[]; next: Task | null }
  decisions: { taken: Task[]; overdue: Task[] }
  documents: { received: Task[]; signed: Task[] }
  reserves: { raised: number; lifted: number; open: number; late: number }
  budget: { committed: number; invoiced: number; forecast: number; before: number | null; amount: number }
}

/** « 2026-W41 »: the ISO week a day falls in. */
export function isoWeek(date: string): string {
  const day = Temporal.PlainDate.from(date)
  return `${day.yearOfWeek ?? day.year}-W${String(day.weekOfYear ?? 1).padStart(2, '0')}`
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

const RECORDS = new Set(['risk', 'decision', 'reserve', 'meeting', 'document'])

export interface WeeklyInput {
  tasks: Task[]
  statuses: StatusConfig[]
  calendar?: WorkCalendar
  /** The last day looked at; the week is the seven days ending on it. */
  today: string
  progress: number
  previous?: WeeklySnapshot
}

export function weeklyFacts(input: WeeklyInput): WeeklyFacts {
  const { statuses, today, previous } = input
  const from = addDays(today, -6)
  const within = (date: string): boolean => !!date && date.slice(0, 10) >= from && date.slice(0, 10) <= today
  const seen = new Set<string>()
  const all = flattenTasks(input.tasks)
    .map((flat) => flat.task)
    .filter((task) => !task.archived && !seen.has(task.id) && !!seen.add(task.id))
  const open = (task: Task): boolean => !isTerminalStatus(task.status, statuses)
  const work = all.filter((task) => !isPhase(task) && !RECORDS.has(task.type))
  const tasks = work.filter((task) => task.type !== 'milestone')
  const milestones = work.filter((task) => task.type === 'milestone')

  const late = tasks
    .filter((task) => open(task) && task.due && task.due < today)
    .map((task) => ({ task, days: daysBetween(task.due, today), fresh: task.due >= from }))
    .sort((a, b) => b.days - a.days)
  const moved: Moved[] = previous
    ? work
        .filter((task) => open(task) && task.due && previous.dues[task.id] && previous.dues[task.id] !== task.due)
        .map((task) => ({ task, days: daysBetween(previous.dues[task.id], task.due) }))
        .sort((a, b) => b.days - a.days)
    : []
  const nextWeek = addDays(today, 7)
  const decisions = all.filter(isDecision)
  const documents = all.filter(isDocument)
  const reserves = all.filter(isReserve)
  const budget = projectBudget(input.tasks)
  const sum = (index: 0 | 1): number =>
    budget.lots
      .flatMap((lot) => (index === 0 ? (lot.task.budget?.commitments ?? []) : (lot.task.budget?.invoices ?? [])))
      .filter((line) => within(line.date))
      .reduce((total, line) => total + line.amount, 0)
  const end = criticalPath(input.tasks, statuses, input.calendar ?? ALL_DAYS).end

  return {
    week: isoWeek(today),
    from,
    to: today,
    progress: { now: input.progress, before: previous ? previous.progress : null },
    end: { now: end, before: previous ? previous.end : null },
    done: tasks.filter((task) => !open(task) && within(task.completed)),
    late,
    moved,
    upcoming: tasks
      .filter((task) => open(task) && task.due && task.due > today && task.due <= nextWeek)
      .sort((a, b) => a.due.localeCompare(b.due)),
    milestones: {
      met: milestones.filter((task) => !open(task) && within(task.completed || task.due)),
      missed: milestones.filter((task) => open(task) && within(task.due) && task.due < today),
      next:
        milestones
          .filter((task) => open(task) && task.due && task.due >= today)
          .sort((a, b) => a.due.localeCompare(b.due))[0] ?? null
    },
    decisions: {
      taken: decisions.filter((task) => !isPending(task) && within(decisionDay(task))),
      overdue: decisions.filter((task) => isPending(task) && !!task.due && task.due < today)
    },
    documents: {
      received: documents.filter((task) => documentOf(task).versions.some((version) => within(version.at))),
      signed: documents.filter((task) => documentOf(task).approvals.some((approval) => within(approval.at)))
    },
    reserves: {
      raised: reserves.filter((task) => within(reserveOf(task).raisedOn)).length,
      lifted: reserves.filter((task) => within(reserveOf(task).liftedOn)).length,
      open: reserves.filter((task) => reserveOf(task).state !== 'lifted').length,
      late: reserves.filter((task) => isLateReserve(task, today)).length
    },
    budget: {
      committed: sum(0),
      invoiced: sum(1),
      forecast: budget.total.forecast,
      before: previous ? previous.forecast : null,
      amount: budget.total.budget
    }
  }
}

/** The state to keep for next week's comparison. */
export function weeklySnapshot(facts: WeeklyFacts, tasks: Task[], statuses: StatusConfig[]): WeeklySnapshot {
  const dues: Record<string, string> = {}
  for (const { task } of flattenTasks(tasks)) {
    if (!task.archived && task.due && !isTerminalStatus(task.status, statuses)) dues[task.id] = task.due
  }
  return { taken: facts.to, progress: facts.progress.now, end: facts.end.now, forecast: facts.budget.forecast, dues }
}

/** Whether this week's reports are owed: switched on, not done this week, and the day reached. */
export function weeklyDue(
  settings: { weeklyReport: boolean; weeklyReportDone: string; weeklyReportDay: string },
  day: string
): boolean {
  if (!settings.weeklyReport || settings.weeklyReportDone === isoWeek(day)) return false
  return Temporal.PlainDate.from(day).dayOfWeek >= (Number(settings.weeklyReportDay) || 1)
}

/** Whether anything at all happened: a quiet week is said so rather than listed empty. */
export function isQuiet(facts: WeeklyFacts): boolean {
  return (
    !facts.done.length &&
    !facts.late.some((one) => one.fresh) &&
    !facts.moved.length &&
    !facts.milestones.met.length &&
    !facts.milestones.missed.length &&
    !facts.decisions.taken.length &&
    !facts.documents.received.length &&
    !facts.documents.signed.length &&
    !facts.reserves.raised &&
    !facts.reserves.lifted &&
    !facts.budget.committed &&
    !facts.budget.invoiced
  )
}
