import type { DocState } from '../../types'
import { t } from '../../i18n'

/** The state's name in the interface's language, exhaustive so a new state cannot slip through. */
export function docStateLabel(state: DocState): string {
  switch (state) {
    case 'expected':
      return t('doc.state.expected')
    case 'received':
      return t('doc.state.received')
    case 'in-review':
      return t('doc.state.in-review')
    case 'approved':
      return t('doc.state.approved')
    case 'obsolete':
      return t('doc.state.obsolete')
  }
}
