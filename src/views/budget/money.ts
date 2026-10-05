import { dateLocale } from '../../i18n'

/** The spaces Intl puts between thousands, as a PDF's Helvetica can draw them. */
const NO_BREAK = String.fromCharCode(0xa0)
const tidy = (text: string): string =>
  text.replace(new RegExp(`[${String.fromCharCode(0x202f, 0x2009)}]`, 'g'), NO_BREAK)

/** An amount in euros, whole: « 12 500 € », « €12,500 »; with its sign when asked. */
export function formatMoney(amount: number, signed = false): string {
  const text = new Intl.NumberFormat(dateLocale() ?? 'en', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    ...(signed ? { signDisplay: 'exceptZero' as const } : {})
  }).format(Math.round(amount))
  return tidy(text)
}

/** An amount in a few characters, for an axis: « 1,2 M€ », « 350 k€ ». */
export function formatMoneyShort(amount: number): string {
  return tidy(
    new Intl.NumberFormat(dateLocale() ?? 'en', {
      style: 'currency',
      currency: 'EUR',
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(amount)
  )
}
