import type { DocumentMeta, Task } from '../types'
import { documentOf, isDocument } from './Document'
import { addDays } from './Metrics'

/**
 * How long a document waits for its visas: from the day its file was deposited, its
 * reviewers have so many days to sign — the contract's figure, the project's or the
 * document's own. A reviewer who has not signed since that deposit is still owed: a
 * visa signs an issue, so one given to the issue before does not count for this one.
 * A document nobody is named to sign still waits, for whoever reviews it.
 */

export interface VisaWait {
  task: Task
  /** Who owes the visa; '' when nobody is named. */
  approver: string
  /** The day its file was deposited. */
  received: string
  /** The day the visa is due. */
  due: string
  /** Days past that day; negative while there is time left. */
  late: number
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000)
}

/** The moment its current file landed, as written; '' when none ever did. */
function lastDeposit(meta: DocumentMeta): string {
  return meta.versions.reduce<string>((best, version) => (version.at > best ? version.at : best), '')
}

/**
 * Who still owes a visa on a document, and by when: each reviewer named who has not
 * signed since its last deposit — or, nobody named, the document itself. None for a
 * document still expected, obsolete, without a file or never deposited.
 */
export function visaWaitsOf(task: Task, today: string, days: number): VisaWait[] {
  if (!isDocument(task) || task.archived) return []
  const meta = documentOf(task)
  if (meta.state === 'expected' || meta.state === 'obsolete' || !meta.file) return []
  const deposited = lastDeposit(meta)
  if (!deposited) return []
  const received = deposited.slice(0, 10)
  const due = addDays(received, Math.max(1, meta.visaDays ?? days))
  const signed = new Set(meta.approvals.filter((one) => one.at >= deposited).map((one) => one.by))
  // Nobody named: approved by hand, or signed by someone since, it waits no more.
  if (!meta.approvers.length && (meta.state === 'approved' || signed.size)) return []
  const owed = meta.approvers.length ? meta.approvers.filter((one) => !signed.has(one)) : ['']
  return owed.map((approver) => ({ task, approver, received, due, late: daysBetween(due, today) }))
}

/** Every visa owed among tickets, the latest past its day first, then the soonest due. */
export function visaWaits(tasks: Task[], today: string, daysOf: (task: Task) => number): VisaWait[] {
  return tasks
    .flatMap((task) => visaWaitsOf(task, today, daysOf(task)))
    .sort((a, b) => b.late - a.late || a.task.title.localeCompare(b.task.title))
}

/** A wait in a few words: « J-3 », « aujourd’hui », « +2 j ». */
export function waitWords(
  wait: Pick<VisaWait, 'late'>,
  words: { left: (days: number) => string; today: string; late: (days: number) => string }
): string {
  if (wait.late > 0) return words.late(wait.late)
  if (wait.late === 0) return words.today
  return words.left(-wait.late)
}
