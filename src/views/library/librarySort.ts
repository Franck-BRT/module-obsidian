import type { PMSettings, Task } from '../../types'
import { DOC_STATES } from '../../types'
import { documentOf } from '../../store/Document'
import { displayName } from '../../utils'
import { t } from '../../i18n'
import { docStateLabel } from './docStateLabel'

/**
 * What a library can be read by. These are the document's own fields, not a task's: a
 * register is looked through by reference, by issue or by who owes it, and sorting it
 * by priority would answer a question nobody asks of a drawing.
 *
 * Reference leads because it is the order a library has always been in, and stays the
 * default — a view that reordered itself on upgrade would be a surprise, not a feature.
 */
export const LIBRARY_SORT_KEYS: PMSettings['librarySortKey'][] = [
  'reference',
  'title',
  'state',
  'due',
  'issue',
  'issuer',
  'deposited'
]

export function librarySortKeyLabel(key: PMSettings['librarySortKey']): string {
  switch (key) {
    case 'reference':
      return t('doc.reference')
    case 'title':
      return t('common.task')
    case 'state':
      return t('doc.state')
    case 'due':
      return t('common.due')
    case 'issue':
      return t('doc.issue')
    case 'issuer':
      return t('doc.issuer')
    case 'deposited':
      return t('doc.lastDeposit')
  }
}

/** The last deposit's date, or '' for a document still only expected. */
export function lastDepositAt(task: Task): string {
  const versions = documentOf(task).versions
  return versions.length ? (versions[versions.length - 1]?.at ?? '') : ''
}

/**
 * Every empty field sorts last, whichever way round the list is read.
 *
 * A blank is not a small value, it is an absent one: a document with no issue yet is
 * not "before A", and reversing the order should not parade the unfilled fields at the
 * top. So emptiness is settled before direction is applied, never by it.
 */
function compare(a: string, b: string, dir: number): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return dir * a.localeCompare(b)
}

/** Where a state sits in the life of a document: expected, received, in review, … */
function stateRank(task: Task): string {
  const idx = DOC_STATES.indexOf(documentOf(task).state)
  // Padded so it compares as text with everything else, and labelled so a state the
  // palette no longer knows still sorts somewhere sensible rather than first.
  return idx >= 0 ? String(idx) : `9${docStateLabel(documentOf(task).state)}`
}

function field(task: Task, key: PMSettings['librarySortKey']): string {
  const doc = documentOf(task)
  switch (key) {
    case 'reference':
      return doc.reference
    case 'title':
      return task.title
    case 'state':
      return stateRank(task)
    case 'due':
      return task.due
    case 'issue':
      return doc.issue
    case 'issuer':
      return displayName(doc.issuer)
    case 'deposited':
      return lastDepositAt(task)
  }
}

/**
 * The documents in the order the library should list them.
 *
 * The title is the tie-break throughout, as it was when the order was fixed: two
 * drawings at issue B are then in a stable, readable order rather than in whichever
 * order the tree walk happened to produce.
 */
export function orderDocuments(
  docs: Task[],
  order: { sortKey: PMSettings['librarySortKey']; sortDir: PMSettings['librarySortDir'] }
): Task[] {
  const dir = order.sortDir === 'asc' ? 1 : -1
  return [...docs].sort((a, b) => {
    const primary = compare(field(a, order.sortKey), field(b, order.sortKey), dir)
    if (primary !== 0) return primary
    return order.sortKey === 'title' ? 0 : a.title.localeCompare(b.title)
  })
}
