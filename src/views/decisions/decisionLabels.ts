import type { DecisionState } from '../../types'
import { t } from '../../i18n'

/** A decision's state, as the reader reads it. */
export function decisionStateLabel(state: DecisionState): string {
  switch (state) {
    case 'proposed':
      return t('decision.state.proposed')
    case 'decided':
      return t('decision.state.decided')
    case 'superseded':
      return t('decision.state.superseded')
    case 'cancelled':
      return t('decision.state.cancelled')
  }
}

/** Each state's glyph: its colour is never the only thing that tells it. */
export const DECISION_STATE_ICON: Record<DecisionState, string> = {
  proposed: 'circle-dashed',
  decided: 'circle-check-big',
  superseded: 'replace',
  cancelled: 'circle-x'
}

export const DECISION_STATE_COLOR: Record<DecisionState, string> = {
  proposed: 'var(--color-orange, #b8a06b)',
  decided: 'var(--color-green, #79b58d)',
  superseded: 'var(--text-muted)',
  cancelled: 'var(--text-faint)'
}
