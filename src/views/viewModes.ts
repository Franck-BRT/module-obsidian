import { VIEW_MODES, type ViewMode } from '../types'
import { t } from '../i18n'

/**
 * What each view is called, wherever one has to be chosen: the global setting and a
 * project's own override both read from here rather than listing the views again.
 *
 * A function, not a constant, because the labels are translated and a constant would
 * freeze the locale at import time.
 */
export function viewModeLabel(mode: ViewMode): string {
  switch (mode) {
    case 'table':
      return t('common.table')
    case 'gantt':
      return t('common.gantt')
    case 'kanban':
      return t('common.board')
    case 'library':
      return t('view.library')
    case 'mail':
      return t('view.mail')
    case 'impacts':
      return t('view.impacts')
    case 'dashboard':
      return t('kpi.title')
  }
}

/** Every view, in the order the switcher offers them, ready for a dropdown. */
export function viewModeOptions(): { id: ViewMode; label: string }[] {
  return VIEW_MODES.map((mode) => ({ id: mode, label: viewModeLabel(mode) }))
}
