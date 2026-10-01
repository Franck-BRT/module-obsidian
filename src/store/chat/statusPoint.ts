import type { Project, StatusConfig } from '../../types'
import { isTerminalStatus } from '../../utils'
import { flattenTasks } from '../TaskTreeOps'
import { fold } from '../library/libraryDoc'

/**
 * A project's status point, its facts worked out by the plugin rather than guessed by the
 * model: what is late, what finished, what moved and what is new since the last point,
 * and what is coming. The plan is photographed at each point, so the next one says what
 * moved in between, whoever moved it.
 */

/** A ticket as a point sees it. */
export interface TicketState {
  title: string
  project: string
  type: string
  start: string
  due: string
  status: string
  done: boolean
  assignees: string[]
  /** Its last day in the reference plan, where the project has one and it was in it. */
  baselineEnd?: string
}

/** The plan at one moment: every ticket by its id. */
export type PlanState = Record<string, TicketState>

/** The tickets of the projects as they are, archived ones and lots left out. */
export function planState(projects: Project[], statusesOf: (project: Project) => StatusConfig[]): PlanState {
  const state: PlanState = {}
  for (const project of projects) {
    const statuses = statusesOf(project)
    for (const { task } of flattenTasks(project.tasks)) {
      if (task.archived || task.type === 'phase') continue
      state[task.id] = {
        title: task.title,
        project: project.title,
        type: task.type,
        start: task.start,
        due: task.due,
        status: task.status,
        done: isTerminalStatus(task.status, statuses),
        assignees: [...task.assignees],
        ...(task.baseline && (task.baseline.due || task.baseline.start)
          ? { baselineEnd: task.baseline.due || task.baseline.start }
          : {})
      }
    }
  }
  return state
}

export interface ShiftedTicket {
  ticket: TicketState
  from: string
  to: string
  days: number
}

export interface StatusFacts {
  today: string
  /** When the last point was made; '' for the first. */
  since: string
  total: number
  done: number
  late: TicketState[]
  finished: TicketState[]
  shifted: ShiftedTicket[]
  added: TicketState[]
  upcoming: TicketState[]
  /**
   * The plan against its reference, where there is one: when it was frozen, when the plan
   * ended then and ends now, and the open tickets that finish later than it said.
   */
  reference: { at: string; planned: string; now: string; days: number; behind: ShiftedTicket[] } | null
}

const DAY = 86_400_000

function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY)
}

/**
 * The facts of a point, from the plan now and as it was at the last one: late — open past
 * its due date —, finished, moved — its end later or earlier —, new, and coming within
 * `horizon` days, milestones first.
 */
export function statusFacts(
  now: PlanState,
  before: { at: string; state: PlanState } | null,
  today: string,
  horizon = 14,
  /** When the reference plan was frozen; '' when there is none. */
  referenceAt = ''
): StatusFacts {
  const tickets = Object.entries(now)
  const byDue = (a: TicketState, b: TicketState): number => (a.due || a.start).localeCompare(b.due || b.start)
  const late = tickets.map(([, one]) => one).filter((one) => !one.done && one.due && one.due < today)
  const limit = new Date(Date.parse(today) + horizon * DAY).toISOString().slice(0, 10)
  const upcoming = tickets
    .map(([, one]) => one)
    .filter((one) => {
      const when = one.due || one.start
      return !one.done && when && when >= today && when <= limit
    })
    .sort((a, b) => Number(b.type === 'milestone') - Number(a.type === 'milestone') || byDue(a, b))
  const finished: TicketState[] = []
  const shifted: ShiftedTicket[] = []
  const added: TicketState[] = []
  if (before) {
    for (const [id, one] of tickets) {
      const was = before.state[id]
      if (!was) {
        added.push(one)
        continue
      }
      if (one.done && !was.done) finished.push(one)
      const from = was.due || was.start
      const to = one.due || one.start
      if (from && to && from !== to) shifted.push({ ticket: one, from, to, days: days(from, to) })
    }
  }
  let reference: StatusFacts['reference'] = null
  const kept = tickets.map(([, one]) => one).filter((one) => one.baselineEnd)
  if (referenceAt && kept.length) {
    const endOf = (one: TicketState): string => one.due || one.start
    const planned = kept.reduce((last, one) => ((one.baselineEnd ?? '') > last ? (one.baselineEnd ?? '') : last), '')
    const ends = kept.map(endOf).filter(Boolean)
    const latest = ends.reduce((last, one) => (one > last ? one : last), '')
    const behind = kept
      .filter((one) => !one.done && endOf(one) && one.baselineEnd && endOf(one) > one.baselineEnd)
      .map((one) => ({
        ticket: one,
        from: one.baselineEnd ?? '',
        to: endOf(one),
        days: days(one.baselineEnd ?? '', endOf(one))
      }))
      .sort((a, b) => b.days - a.days)
    reference = { at: referenceAt, planned, now: latest, days: planned && latest ? days(planned, latest) : 0, behind }
  }
  return {
    today,
    since: before?.at ?? '',
    total: tickets.length,
    done: tickets.filter(([, one]) => one.done).length,
    late: late.sort(byDue),
    finished,
    shifted: shifted.sort((a, b) => Math.abs(b.days) - Math.abs(a.days)),
    added,
    upcoming,
    reference
  }
}

export interface StatusWords {
  heading: (today: string, since: string) => string
  first: string
  progress: (done: number, total: number, percent: number) => string
  late: (count: number) => string
  finished: (count: number) => string
  shifted: (count: number) => string
  added: (count: number) => string
  upcoming: (count: number, days: number) => string
  none: string
  milestone: string
  lateBy: (days: number) => string
  /** The section of tickets behind the reference frozen on `at`. */
  reference: (count: number, at: string) => string
  /** When the plan ended in the reference and ends now. */
  referenceEnd: (planned: string, now: string, days: number) => string
}

/** How many of each are written out; the rest are counted. */
const LISTED = 25

/** The facts as the model is given them: one section a kind, a line a ticket. */
export function statusText(facts: StatusFacts, words: StatusWords, horizon = 14): string {
  const line = (one: TicketState, extra = ''): string => {
    const who = one.assignees.length ? ` · @ ${one.assignees.join(', ')}` : ''
    const when = one.due || one.start
    const mark = one.type === 'milestone' ? ` (${words.milestone})` : ''
    return `- ${one.title}${mark} · ${one.project}${when ? ` · ${when}` : ''}${who}${extra}`
  }
  const section = (title: string, lines: string[]): string[] => {
    if (!lines.length) return [title, words.none, '']
    const shown = lines.slice(0, LISTED)
    if (lines.length > LISTED) shown.push(`… (+${lines.length - LISTED})`)
    return [title, ...shown, '']
  }
  const percent = facts.total ? Math.round((facts.done / facts.total) * 100) : 0
  const out = [words.heading(facts.today, facts.since), words.progress(facts.done, facts.total, percent), '']
  out.push(
    ...section(
      words.late(facts.late.length),
      facts.late.map((one) => line(one, ` · ${words.lateBy(days(one.due, facts.today))}`))
    )
  )
  if (facts.since) {
    out.push(
      ...section(
        words.shifted(facts.shifted.length),
        facts.shifted.map(
          (move) =>
            `- ${move.ticket.title} · ${move.ticket.project} · ${move.from} → ${move.to} (${move.days > 0 ? '+' : '−'}${Math.abs(move.days)} j)`
        )
      ),
      ...section(
        words.finished(facts.finished.length),
        facts.finished.map((one) => line(one))
      ),
      ...section(
        words.added(facts.added.length),
        facts.added.map((one) => line(one))
      )
    )
  } else out.push(words.first, '')
  if (facts.reference) {
    const { at, planned, now, behind, days: moved } = facts.reference
    const shown = section(
      words.reference(behind.length, at),
      behind.map(
        (move) => `- ${move.ticket.title} · ${move.ticket.project} · ${move.from} → ${move.to} (+${move.days} j)`
      )
    )
    // The plan's end first, under the heading: what is asked before anything else.
    if (planned && now) shown.splice(1, 0, words.referenceEnd(planned, now, moved))
    out.push(...shown)
  }
  out.push(
    ...section(
      words.upcoming(facts.upcoming.length, horizon),
      facts.upcoming.map((one) => line(one))
    )
  )
  return out.join('\n').trim()
}

/** Whether a question asks for a status point, in either language. */
export function asksForStatus(question: string): boolean {
  return /point d.?avancement|point de situation|compte rendu d.?avancement|depuis le dernier point|status (report|update)|progress report|since the last (point|report)/.test(
    fold(question)
  )
}

export interface SnapshotStorage {
  read(name: string): Promise<string | null>
  write(name: string, data: string): Promise<void>
}

const SNAPSHOTS = 'status-snapshots.json'

/** How many points of one project are kept. */
const KEPT = 12

/**
 * The plan as it was at each point, by the projects the point was about: the next point
 * compares with the last one made on an earlier day — two asked the same day compare with
 * the same one.
 */
export class StatusSnapshots {
  private points: Record<string, { at: string; state: PlanState }[]> = {}
  private loading: Promise<void> | null = null

  constructor(private storage: SnapshotStorage) {}

  ready(): Promise<void> {
    this.loading ??= this.load()
    return this.loading
  }

  private async load(): Promise<void> {
    try {
      const text = await this.storage.read(SNAPSHOTS)
      this.points = text ? (JSON.parse(text) as typeof this.points) : {}
    } catch {
      this.points = {}
    }
  }

  /** The last point made before `today` about these projects; null when there is none. */
  baseline(key: string, today: string): { at: string; state: PlanState } | null {
    const earlier = (this.points[key] ?? []).filter((point) => point.at < today)
    return earlier.length ? earlier[earlier.length - 1] : null
  }

  /** Today's point, kept: one a day, the latest of the day. */
  async record(key: string, today: string, state: PlanState): Promise<void> {
    await this.ready()
    const kept = (this.points[key] ?? []).filter((point) => point.at !== today)
    kept.push({ at: today, state })
    this.points[key] = kept.slice(-KEPT)
    await this.storage.write(SNAPSHOTS, JSON.stringify(this.points))
  }
}

/** What a point about these projects is known by, whatever order they were attached in. */
export function pointKey(paths: string[]): string {
  return [...new Set(paths)].sort().join('|')
}
