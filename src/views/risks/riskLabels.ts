import type { RiskBand } from '../../store/risk'
import { t } from '../../i18n'

/** The scale a probability is read on, 1 to 4. */
export function probabilityLabel(level: number): string {
  switch (level) {
    case 4:
      return t('risk.probability.4')
    case 3:
      return t('risk.probability.3')
    case 2:
      return t('risk.probability.2')
    default:
      return t('risk.probability.1')
  }
}

/** The scale an impact is read on, 1 to 4. */
export function impactLabel(level: number): string {
  switch (level) {
    case 4:
      return t('risk.impact.4')
    case 3:
      return t('risk.impact.3')
    case 2:
      return t('risk.impact.2')
    default:
      return t('risk.impact.1')
  }
}

export function bandLabel(band: RiskBand): string {
  switch (band) {
    case 'critical':
      return t('risk.band.critical')
    case 'high':
      return t('risk.band.high')
    case 'medium':
      return t('risk.band.medium')
    case 'low':
      return t('risk.band.low')
  }
}

/** A band's colour, the same in the form, the matrix and the register. */
export const BAND_COLOR: Record<RiskBand, string> = {
  low: '#15803d',
  medium: '#ca8a04',
  high: '#ea580c',
  critical: '#dc2626'
}
