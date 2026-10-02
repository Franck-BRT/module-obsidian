import type { PriorityConfig, StatusConfig, Task } from '../../types'
import type { AgendaBlock } from '../../store/agenda/agendaTemplate'
import { baselineGap } from '../../store/baseline'
import { awaitedDocuments, chaseGroups } from '../../store/chasing'
import type { ContactBook } from '../../store/contacts'
import { contactWork } from '../../store/contactWork'
import { documentOf, isDocument, pendingApprovers } from '../../store/Document'
import { isMeeting, taskTimeRange } from '../../store/Meeting'
import { addDays, projectMetrics, type ProjectMetrics } from '../../store/Metrics'
import { isPhase } from '../../store/Phase'
import { isRisk } from '../../store/risk'
import { decidedSince, decisionDay, decisionOf, isDecision, isPending, orderDecisions } from '../../store/decision'
import { flattenTasks } from '../../store/TaskTreeOps'
import { formatDateLetter, formatDateShort } from '../../dates'
import { displayName, isTerminalStatus } from '../../utils'
import { bandLabel, impactLabel, probabilityLabel } from '../risks/riskLabels'
import { t } from '../../i18n'

/** What an agenda is filled from: the project as it stands, seen from the meeting's day. */
export interface AgendaContext {
  projectTitle: string
  projectPath: string
  /** Every ticket of the project, lots and their tickets included. */
  tasks: Task[]
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  /** The meeting's day, YYYY-MM-DD. */
  date: string
  /** Days ahead looked at. */
  horizon: number
  /** The meeting it is the agenda of, when there is one. */
  meeting?: Task
  /** The meeting of the same kind before it, when there was one. */
  previous?: Task
  book: ContactBook
  keyOf?: (raw: string) => string
  /** A link to a note, as the vault writes it. */
  link: (path: string, title: string) => string
}

/** Days between two days, the second later when above zero. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000)
}

/** A table cell: no bar, no line break. */
function cell(value: string): string {
  return (
    value
      .replace(/\|/g, '\\|')
      .replace(/\s*\n+\s*/g, ' ')
      .trim() || '—'
  )
}

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
  ].join('\n')
}

const nothing = (): string => `_${t('agenda.nothing')}_`

function people(task: Task): string {
  return task.assignees.map(displayName).join(', ')
}

/** The previous meeting the agenda was given, its date and its note. */
function meetingDay(task: Task): string {
  return task.due || task.start
}

/**
 * The meeting of the same kind held last before `date`, in `tasks`; with no kind given,
 * the last meeting held before it.
 */
export function previousMeeting(tasks: Task[], date: string, kind: string | undefined, self?: string): Task | null {
  return (
    tasks
      .filter(
        (task) =>
          isMeeting(task) &&
          task.id !== self &&
          !task.archived &&
          !!meetingDay(task) &&
          meetingDay(task) < date &&
          (!kind || task.meetingKind === kind)
      )
      .sort((a, b) => meetingDay(b).localeCompare(meetingDay(a)))[0] ?? null
  )
}

/** Fills the blocks of one agenda, computing what they share once. */
export class AgendaFiller {
  private flat: Task[]
  private metrics: ProjectMetrics
  private end: string

  constructor(private context: AgendaContext) {
    this.flat = context.tasks
    this.end = addDays(context.date, context.horizon)
    this.metrics = projectMetrics({
      tasks: this.flat,
      statuses: context.statuses,
      priorities: context.priorities,
      today: context.date,
      keyOf: context.keyOf,
      soonDays: context.horizon,
      topRisks: Number.MAX_SAFE_INTEGER
    })
  }

  private done(task: Task): boolean {
    return isTerminalStatus(task.status, this.context.statuses)
  }

  /** Work in the plain sense: no lot, risk, document, milestone nor meeting. */
  private work(): Task[] {
    return this.flat.filter(
      (task) =>
        !task.archived &&
        !isPhase(task) &&
        !isRisk(task) &&
        !isDecision(task) &&
        !isDocument(task) &&
        !isMeeting(task) &&
        task.type !== 'milestone' &&
        !this.done(task)
    )
  }

  render(block: AgendaBlock): string {
    const c = this.context
    const m = this.metrics
    switch (block) {
      case 'project':
        return c.projectTitle
      case 'meeting':
        return c.meeting?.title ?? ''
      case 'date':
        return formatDateLetter(c.date)
      case 'time':
        return c.meeting ? taskTimeRange(c.meeting) : ''
      case 'horizon':
        return String(c.horizon)
      case 'attendees':
        return this.attendees()
      case 'contacts':
        return this.contacts()
      case 'progress':
        return this.progress(m)
      case 'milestones':
        return this.milestones(m)
      case 'phases':
        return m.phases.length
          ? table(
              [t('task.type.phase'), t('common.progress'), t('common.due'), t('agenda.state')],
              m.phases.map((phase) => [
                phase.title,
                `${phase.progress} %`,
                phase.due ? formatDateShort(phase.due) : '',
                phase.overruns ? t('kpi.overruns') : ''
              ])
            )
          : nothing()
      case 'late':
        return this.late()
      case 'upcoming':
        return this.upcoming()
      case 'slips':
        return this.slips()
      case 'workload':
        return this.workload()
      case 'risks':
        return this.risks(() => true)
      case 'critical-risks':
        return this.risks((band) => band === 'critical' || band === 'high')
      case 'risks-to-review':
        return this.risks(() => true, true)
      case 'risk-matrix':
        return this.riskMatrix(m)
      case 'pending-decisions':
        return this.pendingDecisions()
      case 'recent-decisions':
        return this.recentDecisions()
      case 'late-documents':
        return this.lateDocuments()
      case 'expected-documents':
        return this.expectedDocuments()
      case 'documents-in-review':
        return this.documentsInReview()
      case 'previous-meeting':
        return c.previous
          ? t('agenda.previousMeeting', {
              meeting: c.previous.filePath ? c.link(c.previous.filePath, c.previous.title) : c.previous.title,
              date: formatDateLetter(meetingDay(c.previous))
            })
          : `_${t('agenda.noPrevious')}_`
      case 'previous-actions':
        return this.previousActions()
    }
  }

  private personLine(raw: string): string {
    const contact = this.context.book.find(raw)
    const name = displayName(raw)
    if (!contact) return name
    const company = contact.kind === 'person' ? contact.company : ''
    const about = [contact.role, company].filter(Boolean).join(', ')
    return about ? `${name} — ${about}` : name
  }

  private attendees(): string {
    const meeting = this.context.meeting
    if (!meeting?.assignees.length) return `- _${t('agenda.toComplete')}_`
    return meeting.assignees.map((one) => `- ${this.personLine(one)}`).join('\n')
  }

  private contacts(): string {
    const c = this.context
    const { byContact } = contactWork(
      c.book,
      [{ path: c.projectPath, title: c.projectTitle, tasks: this.flat, statuses: c.statuses }],
      c.date
    )
    const companies = c.book.companies().filter((one) => byContact.has(one.path))
    const people = c.book.contacts.filter(
      (one) => one.kind === 'person' && byContact.has(one.path) && !companies.some((co) => co.name === one.company)
    )
    if (!companies.length && !people.length) return nothing()
    const lines: string[] = []
    for (const company of companies) {
      const who = c.book
        .members(company.name)
        .map((one) => [one.name, one.role].filter(Boolean).join(', '))
        .join(' ; ')
      lines.push(`- **${company.name}**${company.role ? ` — ${company.role}` : ''}${who ? ` — ${who}` : ''}`)
    }
    for (const person of people) lines.push(`- ${this.personLine(person.name)}`)
    return lines.join('\n')
  }

  /** The work past its date, as the agenda lists it: no document, milestone, risk nor meeting. */
  private lateWork(): Task[] {
    const date = this.context.date
    return this.work()
      .filter((task) => task.due && task.due < date)
      .sort((a, b) => a.due.localeCompare(b.due))
  }

  /**
   * Where the project stands, said as the rest of the agenda counts: late is the work
   * listed late — a document or a past meeting is not —; then a lot overrunning, a
   * document awaited past its date, an open critical risk.
   */
  private progress(m: ProjectMetrics): string {
    const late = this.lateWork().length
    const health = m.health
    const level = late
      ? 'late'
      : health.overrunningPhases || health.lateDocs || health.criticalRisks
        ? 'at-risk'
        : 'on-track'
    const why = late
      ? t('kpi.whyLate', { count: late })
      : health.overrunningPhases
        ? t('kpi.whyOverrun', { count: health.overrunningPhases })
        : health.lateDocs
          ? t('kpi.whyDocs', { count: health.lateDocs })
          : health.criticalRisks
            ? t('kpi.whyRisks', { count: health.criticalRisks })
            : t('kpi.whyFine', { count: this.work().length })
    const lines = [
      `- ${t('common.progress')} : **${m.progress} %** — ${t('kpi.doneOf', { done: m.done, total: m.total })}`,
      `- ${t('agenda.state')} : ${t(`kpi.health.${level}`)} — ${why}`
    ]
    if (m.span.start) {
      lines.push(
        `- ${t('kpi.window')} : ${formatDateShort(m.span.start)} → ${formatDateShort(m.span.due || m.span.start)}`
      )
    }
    return lines.join('\n')
  }

  /** Per person, the work they hold and how much of it is late; what nobody holds last. */
  private workload(): string {
    const date = this.context.date
    const keyOf = this.context.keyOf ?? displayName
    const rows = new Map<string, { name: string; open: number; late: number }>()
    for (const task of this.work()) {
      const late = !!task.due && task.due < date
      for (const raw of task.assignees.length ? task.assignees : ['']) {
        const key = raw ? keyOf(raw) : ''
        const row = rows.get(key) ?? { name: raw ? displayName(raw) : '', open: 0, late: 0 }
        row.open += 1
        if (late) row.late += 1
        rows.set(key, row)
      }
    }
    if (!rows.size) return nothing()
    const sorted = [...rows.values()].sort(
      (a, b) => Number(!a.name) - Number(!b.name) || b.open - a.open || a.name.localeCompare(b.name)
    )
    return table(
      [t('task.assignees'), t('agenda.open'), t('kpi.late')],
      sorted.map((row) => [row.name || t('kpi.unassigned'), String(row.open), String(row.late)])
    )
  }

  private milestones(m: ProjectMetrics): string {
    const shown = m.milestones.filter(
      (one) => one.state !== 'done' || (one.date && one.date >= addDays(this.context.date, -this.context.horizon))
    )
    if (!shown.length) return nothing()
    return table(
      [t('task.type.milestone'), t('common.due'), t('agenda.state')],
      shown.map((one) => [
        one.title,
        one.date ? formatDateShort(one.date) : '',
        one.state === 'later' && one.date && one.date <= this.end
          ? t('kpi.milestone.soon')
          : t(`kpi.milestone.${one.state}`)
      ])
    )
  }

  private late(): string {
    const date = this.context.date
    const late = this.lateWork()
    if (!late.length) return nothing()
    return table(
      [t('agenda.ticket'), t('task.assignees'), t('common.due'), t('agenda.lateBy')],
      late.map((task) => [
        task.title,
        people(task),
        formatDateShort(task.due),
        t('chase.daysLate', { count: daysBetween(task.due, date) })
      ])
    )
  }

  private upcoming(): string {
    const date = this.context.date
    const coming = this.work()
      .filter((task) => task.due && task.due >= date && task.due <= this.end)
      .sort((a, b) => a.due.localeCompare(b.due))
    if (!coming.length) return nothing()
    return table(
      [t('agenda.ticket'), t('task.assignees'), t('common.due'), t('common.progress')],
      coming.map((task) => [task.title, people(task), formatDateShort(task.due), `${task.progress} %`])
    )
  }

  private slips(): string {
    const moved = this.flat
      .filter((task) => !task.archived && !isPhase(task) && !this.done(task))
      .map((task) => ({ task, gap: baselineGap(task) }))
      .filter((one): one is { task: Task; gap: { end: number; start: number | null } } => (one.gap?.end ?? 0) > 0)
      .sort((a, b) => b.gap.end - a.gap.end)
    if (!moved.length) return nothing()
    return table(
      [t('agenda.ticket'), t('agenda.planned'), t('agenda.now'), t('agenda.gap')],
      moved.map(({ task, gap }) => [
        task.title,
        formatDateShort(task.baseline?.due || task.baseline?.start || ''),
        formatDateShort(task.due || task.start),
        `+${gap.end} ${t('agenda.daysUnit')}`
      ])
    )
  }

  private risks(keep: (band: string) => boolean, toReview = false): string {
    const risks = this.metrics.risks.top.filter(
      (risk) => keep(risk.band) && (!toReview || (!!risk.review && risk.review <= this.end))
    )
    if (!risks.length) return nothing()
    return table(
      [
        t('risk.score'),
        t('task.type.risk'),
        `${t('risk.probability')} × ${t('risk.impact')}`,
        t('task.assignees'),
        t('risk.mitigation'),
        t('risk.review')
      ],
      risks.map((risk) => [
        `**${risk.score}** ${bandLabel(risk.band)}`,
        risk.title,
        `${probabilityLabel(risk.probability)} × ${impactLabel(risk.impact)}`,
        risk.assignees.map(displayName).join(', '),
        risk.mitigation || t('risk.noMitigation'),
        risk.review ? formatDateShort(risk.review) : ''
      ])
    )
  }

  private riskMatrix(m: ProjectMetrics): string {
    const r = m.risks
    if (!r.open) return nothing()
    const bands = (['critical', 'high', 'medium', 'low'] as const)
      .map((band) => `${bandLabel(band)} : ${r.byBand[band]}`)
      .join(' · ')
    const lines = [`- ${t('kpi.risks')} : **${r.open}** (${bands})`]
    if (r.unmitigated) lines.push(`- ${t('kpi.risksUnmitigated', { count: r.unmitigated })}`)
    if (r.reviewLate) lines.push(`- ${t('kpi.risksReviewLate', { count: r.reviewLate })}`)
    return lines.join('\n')
  }

  private lateDocuments(): string {
    const groups = chaseGroups(awaitedDocuments(this.flat, this.context.date))
    if (!groups.length) return nothing()
    const lines: string[] = []
    for (const group of groups) {
      const person = group.issuer ? this.context.book.personFor(group.issuer) : null
      const head = group.issuer
        ? `**${displayName(group.issuer)}**${person ? ` (${t('agenda.contact', { name: person.name })})` : ''}`
        : `**${t('chase.noIssuer')}**`
      lines.push(`- ${head}`)
      for (const item of group.items) {
        const name = [item.reference, item.title, item.issue ? t('chase.mail.issue', { issue: item.issue }) : '']
          .filter(Boolean)
          .join(' — ')
        const chased = item.chases.length
          ? ` · ${t('chase.chasedShort', { count: item.chases.length, date: formatDateShort(item.chases[item.chases.length - 1]) })}`
          : ''
        lines.push(
          `    - ${name} — ${t('chase.mail.due', { date: formatDateShort(item.due) })} (${t('chase.daysLate', { count: item.daysLate })}${chased})`
        )
      }
    }
    return lines.join('\n')
  }

  private expectedDocuments(): string {
    const date = this.context.date
    const docs = this.flat
      .filter(
        (task) =>
          !task.archived &&
          isDocument(task) &&
          documentOf(task).state === 'expected' &&
          !!task.due &&
          task.due >= date &&
          task.due <= this.end
      )
      .sort((a, b) => a.due.localeCompare(b.due))
    if (!docs.length) return nothing()
    return table(
      [t('doc.reference'), t('agenda.document'), t('doc.issuer'), t('common.due')],
      docs.map((task) => {
        const meta = documentOf(task)
        return [meta.reference, task.title, displayName(meta.issuer), formatDateShort(task.due)]
      })
    )
  }

  /** The decisions still to take, the soonest due first: what the meeting is asked to settle. */
  private pendingDecisions(): string {
    const pending = orderDecisions(this.flat.filter((task) => !task.archived && isDecision(task) && isPending(task)))
    if (!pending.length) return nothing()
    const date = this.context.date
    return table(
      [t('task.type.decision'), t('agenda.decideBy'), t('decision.decidedBy')],
      pending.map((task) => [
        task.title,
        task.due ? `${formatDateShort(task.due)}${task.due < date ? ` (${t('decision.late')})` : ''}` : '',
        displayName(decisionOf(task).decidedBy)
      ])
    )
  }

  /** The decisions taken since the meeting before — or the last thirty days —, the latest first. */
  private recentDecisions(): string {
    const c = this.context
    const since = c.previous ? meetingDay(c.previous) : addDays(c.date, -30)
    const taken = decidedSince(
      this.flat.filter((task) => !task.archived && isDecision(task)),
      since
    ).filter((task) => decisionDay(task) <= c.date)
    if (!taken.length) return nothing()
    return taken
      .map((task) => {
        const decision = decisionOf(task)
        const by = decision.decidedBy ? `, ${t('decision.by', { name: displayName(decision.decidedBy) })}` : ''
        const name = task.filePath ? c.link(task.filePath, task.title) : task.title
        return `- ${name} — ${formatDateShort(decisionDay(task))}${by}`
      })
      .join('\n')
  }

  private documentsInReview(): string {
    const docs = this.flat.filter((task) => {
      if (task.archived || !isDocument(task)) return false
      const state = documentOf(task).state
      return state === 'received' || state === 'in-review'
    })
    if (!docs.length) return nothing()
    return table(
      [t('doc.reference'), t('agenda.document'), t('doc.issuer'), t('agenda.awaitingVisa')],
      docs.map((task) => {
        const meta = documentOf(task)
        return [
          meta.reference,
          task.title,
          displayName(meta.issuer),
          pendingApprovers(meta).map(displayName).join(', ') || t('agenda.toReview')
        ]
      })
    )
  }

  private previousActions(): string {
    const previous = this.context.previous
    if (!previous) return `_${t('agenda.noPrevious')}_`
    const open = flattenTasks(previous.subtasks)
      .map((flat) => flat.task)
      .filter((task) => !task.archived && !this.done(task))
    if (!open.length) return `_${t('agenda.noActions')}_`
    return table(
      [t('agenda.action'), t('task.assignees'), t('common.due')],
      open.map((task) => [task.title, people(task), task.due ? formatDateShort(task.due) : ''])
    )
  }
}
