import type { ChaseBlockWords, ChaseWords } from '../../store/chasing'
import { formatDateLetter } from '../../dates'
import { t } from '../../i18n'

/** The reminder's words, in the reader's language. */
export function chaseWords(): ChaseWords {
  return {
    date: formatDateLetter,
    subject: (project) => t('chase.mail.subject', { project }),
    greeting: t('chase.mail.greeting'),
    intro: (project) => t('chase.mail.intro', { project }),
    line: (item) =>
      [
        item.reference,
        item.title,
        item.issue ? t('chase.mail.issue', { issue: item.issue }) : '',
        t('chase.mail.due', { date: item.due })
      ]
        .filter(Boolean)
        .join(' — '),
    already: (last, count) =>
      count > 1 ? t('chase.mail.alreadyMany', { count, date: last }) : t('chase.mail.alreadyOnce', { date: last }),
    ask: (date) => t('chase.mail.ask', { date }),
    closing: t('chase.mail.closing')
  }
}

/** The list's words, as the model is given it. */
export function chaseBlockWords(): ChaseBlockWords {
  return {
    intro: t('chat.chaseIntro'),
    project: (title) => t('chat.chaseProject', { title }),
    issuer: (name) => t('chat.chaseIssuer', { name }),
    unnamed: t('chat.chaseUnnamed'),
    late: (days) => t('chat.chaseLate', { count: days }),
    chased: (dates) => t('chat.chaseChased', { dates }),
    never: t('chat.chaseNever'),
    none: t('chat.chaseNone')
  }
}
