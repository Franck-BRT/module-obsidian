import type { ReservePhase, ReserveState, TaskReserve } from '../../types'
import { t } from '../../i18n'

export function phaseLabel(phase: ReservePhase): string {
  switch (phase) {
    case 'opr':
      return t('reserve.phase.opr')
    case 'reception':
      return t('reserve.phase.reception')
    case 'gpa':
      return t('reserve.phase.gpa')
  }
}

export function stateLabel(state: ReserveState): string {
  switch (state) {
    case 'open':
      return t('reserve.state.open')
    case 'declared':
      return t('reserve.state.declared')
    case 'lifted':
      return t('reserve.state.lifted')
  }
}

export function severityLabel(severity: TaskReserve['severity']): string {
  switch (severity) {
    case 'minor':
      return t('reserve.severity.minor')
    case 'major':
      return t('reserve.severity.major')
    case 'blocking':
      return t('reserve.severity.blocking')
  }
}

/** Each state's glyph and colour: the colour never the only thing that tells it. */
export const STATE_ICON: Record<ReserveState, string> = {
  open: 'circle-dot',
  declared: 'circle-help',
  lifted: 'circle-check-big'
}

export const STATE_COLOR: Record<ReserveState, string> = {
  open: 'var(--color-red, #e5534b)',
  declared: 'var(--color-orange, #e0a458)',
  lifted: 'var(--color-green, #79b58d)'
}
