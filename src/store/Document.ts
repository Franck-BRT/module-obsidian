import type { DocApproval, DocState, DocumentMeta, DocVersion, StatusConfig, Task } from '../types'
import { makeDocument } from '../types'
import { isTerminalStatus } from '../utils'

export function isDocument(task: Pick<Task, 'type'>): boolean {
  return task.type === 'document'
}

/** The document side of a ticket, defaulted so a caller never has to test for it. */
export function documentOf(task: Task): DocumentMeta {
  return task.document ?? makeDocument()
}

export function nextVersion(meta: DocumentMeta): number {
  return meta.versions.reduce((highest, entry) => Math.max(highest, entry.version), 0) + 1
}

/** The file the document currently stands for, or '' while it is still only expected. */
export function currentFile(meta: DocumentMeta): string {
  return meta.file
}

export interface Deposit {
  file: string
  at: string
  by: string
  note: string
  /** Where the file that was current has been put away, if there was one. */
  archived?: { version: number; file: string }
}

/**
 * Records a file landing on the document.
 *
 * The deposit that answers an expectation moves it to received; a deposit onto a
 * document already further along leaves its state alone, because a new issue of an
 * approved drawing is not automatically approved — someone has to look at it again,
 * which is what `reopen` is for.
 */
export function recordDeposit(meta: DocumentMeta, deposit: Deposit): DocumentMeta {
  const versions = meta.versions.map((entry) =>
    deposit.archived && entry.version === deposit.archived.version ? { ...entry, file: deposit.archived.file } : entry
  )
  versions.push({
    version: nextVersion(meta),
    file: deposit.file,
    at: deposit.at,
    by: deposit.by,
    note: deposit.note
  })
  return {
    ...meta,
    file: deposit.file,
    versions,
    state: meta.state === 'expected' ? 'received' : meta.state
  }
}

/**
 * Puts an approved document back under review, and drops the approvals that were
 * given for the file it no longer holds. A visa signs a version, not a name.
 */
export function reopen(meta: DocumentMeta): DocumentMeta {
  return { ...meta, state: 'in-review', approvals: [] }
}

export function pendingApprovers(meta: DocumentMeta): string[] {
  const settled = new Set(meta.approvals.map((approval) => approval.by))
  return meta.approvers.filter((approver) => !settled.has(approver))
}

/**
 * Files one person's verdict.
 *
 * A rejection puts the document under review whoever else has signed: one refusal is
 * enough to say it is not ready. It goes to approved only once every named approver has
 * approved — and a document with no approvers named is approved by the person doing it,
 * since waiting for a list nobody wrote would be waiting forever.
 */
export function recordApproval(meta: DocumentMeta, approval: DocApproval): DocumentMeta {
  const approvals = [...meta.approvals.filter((entry) => entry.by !== approval.by), approval]
  const next = { ...meta, approvals }
  if (approval.verdict === 'rejected') return { ...next, state: 'in-review' }
  const outstanding = pendingApprovers(next)
  const refused = approvals.some((entry) => entry.verdict === 'rejected')
  return { ...next, state: outstanding.length === 0 && !refused ? 'approved' : 'in-review' }
}

/**
 * The status a document's state implies, read off the project's own palette rather than
 * hard-coded: an approved document is done, an obsolete one is whatever the palette
 * offers for abandoned work, and anything still coming is not complete.
 *
 * Null when the palette has nothing to say, which leaves the task's status alone.
 */
export function statusForState(state: DocState, statuses: StatusConfig[]): string | null {
  const complete = statuses.filter((status) => isTerminalStatus(status.id, statuses))
  const open = statuses.filter((status) => !isTerminalStatus(status.id, statuses))
  switch (state) {
    case 'approved':
      return complete[0]?.id ?? null
    case 'obsolete':
      // The last complete status is where a palette usually keeps "cancelled".
      return complete[complete.length - 1]?.id ?? null
    case 'expected':
      return open[0]?.id ?? null
    case 'received':
    case 'in-review':
      return open[1]?.id ?? open[0]?.id ?? null
  }
}

/** A document still expected once its date has passed. The chasing list is built of these. */
export function isAwaited(task: Task, today: string): boolean {
  if (!isDocument(task)) return false
  const meta = documentOf(task)
  return meta.state === 'expected' && !!task.due && task.due < today
}

export interface BordereauRow {
  reference: string
  title: string
  issue: string
  version: string
  date: string
  recipient: string
}

/**
 * The transmittal a set of documents makes: what is being sent, at which issue, to
 * whom. Ordered by reference so two bordereaux of the same documents read the same.
 */
export function bordereauRows(tasks: Task[]): BordereauRow[] {
  return tasks
    .filter(isDocument)
    .map((task) => {
      const meta = documentOf(task)
      const last: DocVersion | undefined = meta.versions[meta.versions.length - 1]
      return {
        reference: meta.reference,
        title: task.title,
        issue: meta.issue,
        version: last ? `v${last.version}` : '',
        date: last?.at.slice(0, 10) ?? '',
        recipient: meta.recipient
      }
    })
    .sort((a, b) => a.reference.localeCompare(b.reference) || a.title.localeCompare(b.title))
}
