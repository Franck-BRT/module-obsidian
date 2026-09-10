import type { Task } from '../../types'
import { documentOf, isDocument } from '../../store/Document'
import { docStateLabel } from '../../views/library/docStateLabel'
import { Chip } from '../primitives/Chip'
import { t } from '../../i18n'

const STATE_COLORS: Record<string, string> = {
  expected: 'var(--text-muted)',
  received: 'var(--color-blue)',
  'in-review': 'var(--color-orange)',
  approved: 'var(--color-green)',
  obsolete: 'var(--text-faint)'
}

/**
 * The mark a document carries wherever it shows up as a ticket. It says the state rather
 * than just the type: in a plan, "expected" and "approved" are the difference between
 * something to chase and something to forget about.
 */
export function renderDocumentBadge(parent: HTMLElement, task: Task): void {
  if (!isDocument(task)) return
  const meta = documentOf(task)
  new Chip(parent)
    .setLabel(t('common.documentBadge'))
    .setVariant('solid')
    .setSize('sm')
    .setColor(STATE_COLORS[meta.state] ?? 'var(--text-muted)')
    .setTooltip(`${docStateLabel(meta.state)}${meta.reference ? ` · ${meta.reference}` : ''}`)
}
