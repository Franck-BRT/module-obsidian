import { waitWords, type VisaWait } from '../../store/visaDelay'
import { t } from '../../i18n'

/** A wait in the reader's words: « J-3 », « aujourd’hui », « 2 j de retard ». */
export function waitText(wait: Pick<VisaWait, 'late'>): string {
  return waitWords(wait, {
    left: (count) => t('visa.wait.left', { count }),
    today: t('visa.wait.today'),
    late: (count) => t('visa.wait.late', { count })
  })
}
