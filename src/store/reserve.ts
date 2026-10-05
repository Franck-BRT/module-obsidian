import type { ReservePhase, ReserveState, StatusConfig, Task, TaskReserve } from '../types'
import { fold } from './library/libraryDoc'
import { displayName } from '../utils'

/**
 * The punch list: the reserves raised before handover, at it, or during the year of
 * perfect completion after, each numbered, placed, given to the contractor who must lift
 * it — the ticket's assignee — by a day — its due date. A reserve is said lifted by the
 * contractor first, then seen lifted by whoever raised it: two days, both kept.
 */

export const RESERVE_PHASES: ReservePhase[] = ['opr', 'reception', 'gpa']
export const RESERVE_STATES: ReserveState[] = ['open', 'declared', 'lifted']
export const RESERVE_SEVERITIES: TaskReserve['severity'][] = ['minor', 'major', 'blocking']

export function isReserve(task: Pick<Task, 'type'>): boolean {
  return task.type === 'reserve'
}

export function emptyReserve(over: Partial<TaskReserve> = {}): TaskReserve {
  return {
    number: '',
    phase: 'opr',
    location: '',
    lot: '',
    severity: 'minor',
    state: 'open',
    raisedOn: '',
    declaredOn: '',
    liftedOn: '',
    photos: [],
    chases: [],
    ...over
  }
}

export function reserveOf(task: Pick<Task, 'reserve'>): TaskReserve {
  return task.reserve ?? emptyReserve()
}

/** The number the next reserve takes: R-001, R-002…, past the highest there is. */
export function nextReserveNumber(tasks: Pick<Task, 'reserve'>[]): string {
  let highest = 0
  for (const task of tasks) {
    const found = /(\d+)\s*$/.exec(task.reserve?.number ?? '')
    if (found) highest = Math.max(highest, Number(found[1]))
  }
  return `R-${String(highest + 1).padStart(3, '0')}`
}

/** Its state moved, the day of it noted: said lifted, seen lifted, or opened again. */
export function moveReserve(reserve: TaskReserve, state: ReserveState, day: string): TaskReserve {
  if (state === reserve.state) return reserve
  if (state === 'open') return { ...reserve, state, declaredOn: '', liftedOn: '' }
  if (state === 'declared') return { ...reserve, state, declaredOn: reserve.declaredOn || day, liftedOn: '' }
  return { ...reserve, state, declaredOn: reserve.declaredOn || day, liftedOn: day }
}

/** The state after this one, for a click that moves it on: open, said lifted, seen lifted, open again. */
export function nextReserveState(state: ReserveState): ReserveState {
  return state === 'open' ? 'declared' : state === 'declared' ? 'lifted' : 'open'
}

/** The status a reserve's state calls for: seen lifted, done; else the first open status. */
export function statusForReserve(state: ReserveState, current: string, statuses: StatusConfig[]): string | null {
  const done = statuses.find((status) => status.complete && status.id === 'done') ?? statuses.find((s) => s.complete)
  const open = statuses.find((status) => !status.complete)
  const want = state === 'lifted' ? done : open
  const now = statuses.find((status) => status.id === current)
  if (!want || want.id === current) return null
  // Still open, in some open status of the reader's: left there.
  if (state !== 'lifted' && now && !now.complete) return null
  return want.id
}

/** Past its day and not seen lifted. */
export function isLateReserve(task: Pick<Task, 'reserve' | 'due'>, today: string): boolean {
  return reserveOf(task).state !== 'lifted' && !!task.due && task.due < today
}

/** Who must lift it, as the register names them; '' for nobody yet. */
export function reserveCompany(task: Pick<Task, 'assignees'>): string {
  return task.assignees[0] ? displayName(task.assignees[0]) : ''
}

export interface ReserveCount {
  open: number
  declared: number
  lifted: number
  late: number
}

export interface CompanyReserves extends ReserveCount {
  company: string
}

export interface ReserveSummary extends ReserveCount {
  total: number
  byCompany: CompanyReserves[]
}

/** How many reserves stand where, and by contractor — those with the most still open first. */
export function reserveSummary(tasks: Task[], today: string): ReserveSummary {
  const reserves = tasks.filter((task) => isReserve(task) && !task.archived)
  const count = (list: Task[]): ReserveCount => ({
    open: list.filter((task) => reserveOf(task).state === 'open').length,
    declared: list.filter((task) => reserveOf(task).state === 'declared').length,
    lifted: list.filter((task) => reserveOf(task).state === 'lifted').length,
    late: list.filter((task) => isLateReserve(task, today)).length
  })
  const companies = new Map<string, Task[]>()
  for (const task of reserves) {
    const key = reserveCompany(task)
    companies.set(key, [...(companies.get(key) ?? []), task])
  }
  const byCompany = [...companies.entries()]
    .map(([company, list]) => ({ company, ...count(list) }))
    .sort(
      (a, b) =>
        Number(!a.company) - Number(!b.company) ||
        b.open + b.declared - (a.open + a.declared) ||
        a.company.localeCompare(b.company)
    )
  return { total: reserves.length, ...count(reserves), byCompany }
}

/** By number, as the punch list reads. */
export function orderReserves<T extends Pick<Task, 'reserve' | 'title'>>(list: T[]): T[] {
  const numberOf = (task: T): number => Number(/(\d+)\s*$/.exec(task.reserve?.number ?? '')?.[1] ?? Infinity)
  return [...list].sort((a, b) => numberOf(a) - numberOf(b) || a.title.localeCompare(b.title))
}

/** A day the contractor was chased, once. */
export function recordReserveChase(reserve: TaskReserve, day: string): TaskReserve {
  return reserve.chases.includes(day) ? reserve : { ...reserve, chases: [...reserve.chases, day].sort() }
}

export interface ReserveMailWords {
  date: (iso: string) => string
  subject: (project: string) => string
  greeting: string
  intro: (project: string) => string
  line: (reserve: { number: string; title: string; location: string; due: string; late: boolean }) => string
  ask: (date: string) => string
  closing: string
}

/** The mail asking a contractor to lift their reserves still open, the late ones first. */
export function reserveMail(
  tasks: Task[],
  context: { project: string; askedBy: string; today: string },
  words: ReserveMailWords
): { subject: string; body: string } {
  const open = orderReserves(tasks.filter((task) => reserveOf(task).state !== 'lifted')).sort(
    (a, b) => Number(isLateReserve(b, context.today)) - Number(isLateReserve(a, context.today))
  )
  const lines = open.map((task) => {
    const reserve = reserveOf(task)
    return `- ${words.line({
      number: reserve.number,
      title: task.title,
      location: reserve.location,
      due: task.due ? words.date(task.due) : '',
      late: isLateReserve(task, context.today)
    })}`
  })
  const body = [
    words.greeting,
    '',
    words.intro(context.project),
    '',
    ...lines,
    '',
    words.ask(words.date(context.askedBy)),
    '',
    words.closing
  ]
  return { subject: words.subject(context.project), body: body.join('\n') }
}

const STATE_WORDS: [ReserveState, string[]][] = [
  ['lifted', ['lifted', 'levee', 'leve', 'levee constatee', 'soldee', 'closed', 'cleared']],
  ['declared', ['declared', 'declaree levee', 'declare leve', 'a verifier', 'to check', 'claimed']],
  ['open', ['open', 'ouverte', 'ouvert', 'en cours', 'a lever', 'non levee']]
]

/** A state as written, in either language; null when it says none. */
export function readReserveState(raw: unknown): ReserveState | null {
  const folded = typeof raw === 'string' ? fold(raw).replace(/[-_]/g, ' ').trim() : ''
  for (const [state, words] of STATE_WORDS) if (words.includes(folded)) return state
  return null
}

/** A phase as written: « OPR », « réception », « GPA »; null when it says none. */
export function readReservePhase(raw: unknown): ReservePhase | null {
  const folded = typeof raw === 'string' ? fold(raw).replace(/[-_.]/g, ' ').trim() : ''
  if (/^(opr|pre reception|operations prealables|before handover|snagging)$/.test(folded)) return 'opr'
  if (/^(reception|handover|pv de reception|at handover)$/.test(folded)) return 'reception'
  if (/^(gpa|parfait achevement|garantie de parfait achevement|defects liability|after handover)$/.test(folded)) {
    return 'gpa'
  }
  return null
}
