import type { BudgetLine, StatusConfig, Task, TaskBudget } from '../types'
import { isPhase, phaseSpan } from './Phase'
import { addDays } from './Metrics'
import { flattenTasks } from './TaskTreeOps'

/**
 * The money of a project, lot by lot: what each was given, what is committed to the
 * companies — contracts, amendments, orders —, what they have invoiced, what remains to
 * commit and so where the lot will end — the forecast at completion — against its
 * budget. All amounts excluding tax. A lot is a phase; its budget is kept on its note.
 */

export interface BudgetFigures {
  budget: number
  committed: number
  invoiced: number
  /** What remains to commit: the estimate when there is one, else what the budget leaves. */
  toCommit: number
  /** Where it will end: committed plus what remains to commit. */
  forecast: number
  /** Forecast less budget: above zero an overrun, below a saving. */
  variance: number
}

export interface LotBudget {
  task: Task
  figures: BudgetFigures
}

export interface ProjectBudget {
  lots: LotBudget[]
  total: BudgetFigures
}

export function emptyBudget(over: Partial<TaskBudget> = {}): TaskBudget {
  return { amount: 0, commitments: [], invoices: [], ...over }
}

export function budgetOf(task: Pick<Task, 'budget'>): TaskBudget {
  return task.budget ?? emptyBudget()
}

const sum = (lines: BudgetLine[]): number => lines.reduce((total, line) => total + line.amount, 0)

/** A lot's figures, from its budget. */
export function budgetFigures(budget: TaskBudget): BudgetFigures {
  const committed = sum(budget.commitments)
  const invoiced = sum(budget.invoices)
  const toCommit = budget.toCommit ?? Math.max(0, budget.amount - committed)
  const forecast = committed + toCommit
  return { budget: budget.amount, committed, invoiced, toCommit, forecast, variance: forecast - budget.amount }
}

/** Figures added up. */
export function addFigures(list: BudgetFigures[]): BudgetFigures {
  const total = { budget: 0, committed: 0, invoiced: 0, toCommit: 0, forecast: 0, variance: 0 }
  for (const one of list) {
    total.budget += one.budget
    total.committed += one.committed
    total.invoiced += one.invoiced
    total.toCommit += one.toCommit
    total.forecast += one.forecast
    total.variance += one.variance
  }
  return total
}

/** Whether a phase carries any money at all. */
export function hasBudget(task: Pick<Task, 'budget'>): boolean {
  const budget = task.budget
  return !!budget && (budget.amount !== 0 || budget.commitments.length > 0 || budget.invoices.length > 0)
}

/** The project's lots, in its order, each with its figures, and their total. */
export function projectBudget(tasks: Task[]): ProjectBudget {
  // Once each, should the tickets come already flattened.
  const seen = new Set<string>()
  const lots = flattenTasks(tasks)
    .map((flat) => flat.task)
    .filter((task) => isPhase(task) && !task.archived && !seen.has(task.id) && !!seen.add(task.id))
    .map((task) => ({ task, figures: budgetFigures(budgetOf(task)) }))
  return { lots, total: addFigures(lots.map((lot) => lot.figures)) }
}

export interface BudgetPoint {
  date: string
  /** The budget as the lots' dates spread it: what should be spent by then. */
  planned: number
  /** Committed and invoiced by then; null past today, which is not known yet. */
  committed: number | null
  invoiced: number | null
}

/** How much of `amount`, spread evenly over [start, due], falls on or before `date`. */
function spread(amount: number, start: string, due: string, date: string): number {
  if (date < start) return 0
  if (date >= due) return amount
  const days = (to: string): number => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
  return (amount * (days(date) + 1)) / (days(due) + 1)
}

/**
 * The curve of a project's money over time: the budget as the lots' dates spread it —
 * each lot's evenly across its span, a lot with no dates across the whole —, and what
 * has been committed and invoiced, cumulated, up to today. Sampled at even steps, a week
 * apart or wider for a long project, today among them; none when nothing has a date.
 */
export function budgetCurve(lots: LotBudget[], statuses: StatusConfig[], today: string): BudgetPoint[] {
  const spans = lots.map((lot) => ({ lot, span: phaseSpan(lot.task, statuses) }))
  const lines = lots.flatMap((lot) => [...budgetOf(lot.task).commitments, ...budgetOf(lot.task).invoices])
  const dates = [
    ...spans.flatMap(({ span, lot }) => (lot.figures.budget ? [span.start, span.due] : [])),
    ...lines.map((line) => line.date)
  ].filter(Boolean)
  if (!dates.length) return []
  const first = dates.reduce((a, b) => (b < a ? b : a))
  const last = [...dates, today].reduce((a, b) => (b > a ? b : a))
  const length = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000
  const step = Math.max(7, Math.ceil(length / 80))
  const samples: string[] = []
  for (let day = first; day < last; day = addDays(day, step)) samples.push(day)
  samples.push(last)
  if (today > first && today < last && !samples.includes(today)) {
    samples.push(today)
    samples.sort()
  }
  const dated = (list: BudgetLine[], date: string): number =>
    list.filter((line) => line.date && line.date <= date).reduce((total, line) => total + line.amount, 0)
  const commitments = lots.flatMap((lot) => budgetOf(lot.task).commitments)
  const invoices = lots.flatMap((lot) => budgetOf(lot.task).invoices)
  return samples.map((date) => {
    let planned = 0
    for (const { lot, span } of spans) {
      const amount = lot.figures.budget
      if (!amount) continue
      planned += span.start && span.due ? spread(amount, span.start, span.due, date) : spread(amount, first, last, date)
    }
    const known = date <= today
    return {
      date,
      planned: Math.round(planned),
      committed: known ? dated(commitments, date) : null,
      invoiced: known ? dated(invoices, date) : null
    }
  })
}
