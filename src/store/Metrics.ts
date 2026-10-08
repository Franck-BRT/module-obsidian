import type { DocState, PriorityConfig, StatusConfig, Task } from '../types'
import { DOC_STATES } from '../types'
import { isTerminalStatus, displayName } from '../utils'
import { isPhase, phaseSpan } from './Phase'
import { documentOf, isDocument } from './Document'
import { docStateConfigOf } from './TicketPalette'
import { totalLoggedHours } from './TaskTreeOps'
import { isWork } from './workTickets'
import { isRisk, orderRisks, riskBand, riskMatrix, riskScore, type RiskBand } from './risk'

/** One class of a breakdown: what it is, how many, and the colour it already wears. */
export interface MetricSlice {
  id: string
  label: string
  color: string
  count: number
}

export interface AssigneeLoad {
  /** '' for the row gathering what nobody has taken. */
  name: string
  total: number
  done: number
  late: number
}

export interface PhaseProgress {
  id: string
  title: string
  progress: number
  count: number
  start: string
  due: string
  overruns: boolean
}

export interface MilestoneMark {
  id: string
  title: string
  date: string
  state: 'done' | 'late' | 'soon' | 'later'
}

/** One sample of the curve: everything due by that date, everything finished by it. */
export interface BurnPoint {
  date: string
  planned: number
  done: number
}

export interface BurnCurve {
  points: BurnPoint[]
  step: 'day' | 'week' | 'month'
  /**
   * Finished tickets carrying no completion date — nothing can place them in time, so
   * the curve's last point sits below the real total by exactly this many. Said out
   * loud rather than quietly folded in, which would draw work on a day it did not
   * happen. Tickets finished before the field existed are the usual reason.
   */
  undatedDone: number
  /** Open tickets with no due date: they are in no column of the plan. */
  unplanned: number
}

export interface MetricsHealth {
  level: 'on-track' | 'at-risk' | 'late'
  late: number
  overrunningPhases: number
  lateDocs: number
  /** Open risks in the critical band. */
  criticalRisks: number
}

/** One open risk as the dashboard lists it. */
export interface RiskMark {
  id: string
  title: string
  probability: number
  impact: number
  score: number
  band: RiskBand
  assignees: string[]
  mitigation: string
  /** Its review date, its due date; '' when none. */
  review: string
}

export interface RiskSummary {
  open: number
  closed: number
  /** Open risks in each band. */
  byBand: Record<RiskBand, number>
  /** Open risks by probability then impact, 1 to 4. */
  matrix: number[][]
  /** The most critical open risks, the worst first. */
  top: RiskMark[]
  /** Open risks with no mitigation written. */
  unmitigated: number
  /** Open risks whose review date has passed. */
  reviewLate: number
}

export interface ProjectMetrics {
  /** Tickets that carry work. A lot holds work, so it is counted in `phases` instead. */
  total: number
  done: number
  open: number
  late: number
  dueSoon: number
  undated: number
  progress: number
  byStatus: MetricSlice[]
  byPriority: MetricSlice[]
  byAssignee: AssigneeLoad[]
  phases: PhaseProgress[]
  milestones: MilestoneMark[]
  documents: { total: number; awaited: number; late: number; byState: MetricSlice[] }
  risks: RiskSummary
  time: { logged: number; estimate: number }
  burn: BurnCurve
  span: { start: string; due: string }
  health: MetricsHealth
}

export interface MetricsInput {
  /** Flat, already filtered and scoped. Lots may be in it; they are pulled out here. */
  tasks: Task[]
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  today: string
  /** How two spellings of one person are told to be the same. */
  keyOf?: (raw: string) => string
  /** How many days ahead counts as "coming up". */
  soonDays?: number
  /** At most this many points on the curve; the step widens until they fit. */
  maxPoints?: number
  /** At most this many risks in `risks.top`. */
  topRisks?: number
}

/** Adds days to a YYYY-MM-DD without a Date object, which would drag a timezone in. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const at = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * 86_400_000
  return new Date(at).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000)
}

/**
 * Everything a dashboard shows, computed once.
 *
 * A lot is never counted as a ticket: it holds work rather than being work, exactly as
 * every view already treats it. Documents are ordinary tickets and are counted with the
 * rest — they are work someone owes — and then broken out again, because what a
 * document is waiting for is not what a task is waiting for. A risk is not work at all —
 * its date is when it is reviewed, not when something is owed —, so it is counted in
 * `risks` only, and an open critical one puts the project at risk.
 */
export function projectMetrics(input: MetricsInput): ProjectMetrics {
  const { tasks, statuses, priorities, today } = input
  const keyOf = input.keyOf ?? displayName
  const soonDays = input.soonDays ?? 7
  const horizon = addDays(today, soonDays)

  const work = tasks.filter(isWork)
  const isDone = (task: Task): boolean => isTerminalStatus(task.status, statuses)

  let done = 0
  let late = 0
  let dueSoon = 0
  let undated = 0
  let progressSum = 0
  let logged = 0
  let estimate = 0
  let start = ''
  let due = ''

  const statusCount = new Map<string, number>()
  const priorityCount = new Map<string, number>()
  const byPerson = new Map<string, AssigneeLoad>()

  const load = (name: string): AssigneeLoad => {
    const key = name ? keyOf(name) : ''
    let row = byPerson.get(key)
    if (!row) {
      row = { name: name ? displayName(name) : '', total: 0, done: 0, late: 0 }
      byPerson.set(key, row)
    }
    return row
  }

  for (const task of work) {
    const finished = isDone(task)
    if (finished) done += 1
    progressSum += finished ? 100 : task.progress
    statusCount.set(task.status, (statusCount.get(task.status) ?? 0) + 1)
    priorityCount.set(task.priority, (priorityCount.get(task.priority) ?? 0) + 1)
    logged += totalLoggedHours(task)
    estimate += task.timeEstimate ?? 0

    const isLate = !finished && !!task.due && task.due < today
    if (isLate) late += 1
    else if (!finished && !!task.due && task.due <= horizon) dueSoon += 1
    if (!finished && !task.due) undated += 1

    const edgeStart = task.start || task.due
    const edgeDue = task.due || task.start
    if (edgeStart && (!start || edgeStart < start)) start = edgeStart
    if (edgeDue && (!due || edgeDue > due)) due = edgeDue

    const people = task.assignees.length ? task.assignees : ['']
    for (const person of people) {
      const row = load(person)
      row.total += 1
      if (finished) row.done += 1
      if (isLate) row.late += 1
    }
  }

  const phases: PhaseProgress[] = tasks.filter(isPhase).map((phase) => {
    const span = phaseSpan(phase, statuses)
    return {
      id: phase.id,
      title: phase.title,
      progress: span.progress,
      count: span.count,
      start: span.start,
      due: span.due,
      overruns: span.overruns
    }
  })

  const docs = work.filter(isDocument)
  const docStateCount = new Map<DocState, number>()
  let lateDocs = 0
  for (const task of docs) {
    const meta = documentOf(task)
    docStateCount.set(meta.state, (docStateCount.get(meta.state) ?? 0) + 1)
    if (meta.state === 'expected' && !!task.due && task.due < today) lateDocs += 1
  }

  const milestones: MilestoneMark[] = work
    .filter((task) => task.type === 'milestone')
    .map((task) => {
      const date = task.due || task.start
      const state: MilestoneMark['state'] = isDone(task)
        ? 'done'
        : date && date < today
          ? 'late'
          : date && date <= horizon
            ? 'soon'
            : 'later'
      return { id: task.id, title: task.title, date, state }
    })
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))

  const risks = riskSummary(tasks.filter(isRisk), isDone, today, input.topRisks ?? 5)

  const overrunningPhases = phases.filter((phase) => phase.overruns).length
  const criticalRisks = risks.byBand.critical
  const level: MetricsHealth['level'] =
    late > 0 ? 'late' : overrunningPhases || lateDocs || criticalRisks ? 'at-risk' : 'on-track'

  return {
    total: work.length,
    done,
    open: work.length - done,
    late,
    dueSoon,
    undated,
    progress: work.length ? Math.round(progressSum / work.length) : 0,
    byStatus: statuses
      .map((cfg) => ({ id: cfg.id, label: cfg.label, color: cfg.color, count: statusCount.get(cfg.id) ?? 0 }))
      .filter((slice) => slice.count > 0),
    byPriority: priorities
      .map((cfg) => ({ id: cfg.id, label: cfg.label, color: cfg.color, count: priorityCount.get(cfg.id) ?? 0 }))
      .filter((slice) => slice.count > 0),
    byAssignee: rankPeople([...byPerson.values()]),
    phases,
    milestones,
    documents: {
      total: docs.length,
      awaited: docStateCount.get('expected') ?? 0,
      late: lateDocs,
      byState: DOC_STATES.map((state) => ({
        id: state,
        label: state,
        color: docStateConfigOf(state).color,
        count: docStateCount.get(state) ?? 0
      })).filter((slice) => slice.count > 0)
    },
    risks,
    time: { logged: Math.round(logged * 10) / 10, estimate: Math.round(estimate * 10) / 10 },
    burn: burnCurve(work, statuses, today, input.maxPoints ?? 24),
    span: { start, due },
    health: { level, late, overrunningPhases, lateDocs, criticalRisks }
  }
}

/** The risks of a project summed up: the open ones by band and cell, the worst named. */
export function riskSummary(risks: Task[], isDone: (task: Task) => boolean, today: string, keep = 5): RiskSummary {
  const open = risks.filter((risk) => !isDone(risk))
  const byBand: Record<RiskBand, number> = { low: 0, medium: 0, high: 0, critical: 0 }
  for (const risk of open) byBand[riskBand(riskScore(risk).score)] += 1
  return {
    open: open.length,
    closed: risks.length - open.length,
    byBand,
    matrix: riskMatrix(open),
    top: orderRisks(open, () => true)
      .slice(0, keep)
      .map((risk) => {
        const { probability, impact, score } = riskScore(risk)
        return {
          id: risk.id,
          title: risk.title,
          probability,
          impact,
          score,
          band: riskBand(score),
          assignees: risk.assignees,
          mitigation: risk.risk?.mitigation.trim() ?? '',
          review: risk.due
        }
      }),
    unmitigated: open.filter((risk) => !risk.risk?.mitigation.trim()).length,
    reviewLate: open.filter((risk) => !!risk.due && risk.due < today).length
  }
}

/**
 * The busiest first, what nobody has taken last, and a tail folded into one row.
 *
 * Eight rows is where a list stops being read and starts being scanned past; the ninth
 * person is not given a row of their own but is not dropped either — their work is
 * still in the total.
 */
export function rankPeople(rows: AssigneeLoad[], keep = 8): AssigneeLoad[] {
  const named = rows.filter((row) => row.name).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  const nobody = rows.filter((row) => !row.name)
  const head = named.slice(0, keep)
  const tail = named.slice(keep)
  if (tail.length) {
    head.push({
      name: '',
      total: tail.reduce((sum, row) => sum + row.total, 0),
      done: tail.reduce((sum, row) => sum + row.done, 0),
      late: tail.reduce((sum, row) => sum + row.late, 0)
    })
  }
  return [...head, ...nobody]
}

/**
 * The plan against the work: how much was due by each date, how much was finished by it.
 *
 * Both series count the same thing — tickets — so they share one axis, and the gap
 * between them is the whole reading: the finished line below the planned line is late,
 * above it is ahead. The window runs from the first date the project holds to the last,
 * today included, so the curve always reaches the present even on a project whose dates
 * have all passed.
 */
export function burnCurve(work: Task[], statuses: StatusConfig[], today: string, maxPoints = 24): BurnCurve {
  const dueDates = work.map((task) => task.due).filter(Boolean)
  const doneDates = work.filter((task) => isTerminalStatus(task.status, statuses)).map((task) => task.completed)
  const undatedDone = doneDates.filter((date) => !date).length
  const unplanned = work.filter((task) => !isTerminalStatus(task.status, statuses) && !task.due).length
  const dated = [...dueDates, ...doneDates.filter(Boolean), today].sort()
  const first = dated[0]
  const last = dated[dated.length - 1]
  if (!first || !last) return { points: [], step: 'day', undatedDone, unplanned }

  const days = Math.max(daysBetween(first, last), 1)
  const step: BurnCurve['step'] = days <= maxPoints ? 'day' : days <= maxPoints * 7 ? 'week' : 'month'
  const stride = step === 'day' ? 1 : step === 'week' ? 7 : 30

  const points: BurnPoint[] = []
  for (let at = first; at < last; at = addDays(at, stride)) points.push(sample(at))
  points.push(sample(last))
  return { points, step, undatedDone, unplanned }

  function sample(date: string): BurnPoint {
    return {
      date,
      planned: dueDates.filter((due) => due <= date).length,
      done: doneDates.filter((at) => !!at && at <= date).length
    }
  }
}
