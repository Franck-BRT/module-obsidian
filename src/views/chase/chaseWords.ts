import type { ChaseBlockWords, ChaseWords } from '../../store/chasing'
import type { ContactBook } from '../../store/contacts'
import { formatDateLetter } from '../../dates'
import { t } from '../../i18n'

/** The reminder's words, in the reader's language. */
export function chaseWords(): ChaseWords {
  return {
    date: formatDateLetter,
    subject: (project, tone) =>
      tone === 'final'
        ? t('chase.mail.subjectFinal', { project })
        : tone === 'firm'
          ? t('chase.mail.subjectFirm', { project })
          : t('chase.mail.subject', { project }),
    greeting: t('chase.mail.greeting'),
    intro: (project, tone) =>
      tone === 'final'
        ? t('chase.mail.introFinal', { project })
        : tone === 'firm'
          ? t('chase.mail.introFirm', { project })
          : t('chase.mail.intro', { project }),
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
    ask: (date, tone) =>
      tone === 'final'
        ? t('chase.mail.askFinal', { date })
        : tone === 'firm'
          ? t('chase.mail.askFirm', { date })
          : t('chase.mail.ask', { date }),
    closing: t('chase.mail.closing')
  }
}

/**
 * The list's words, as the model is given it — with, when the contacts are known, the
 * person to address at each issuer.
 */
export function chaseBlockWords(book?: ContactBook): ChaseBlockWords {
  return {
    intro: t('chat.chaseIntro'),
    project: (title) => t('chat.chaseProject', { title }),
    issuer: (name) => {
      const person = book?.personFor(name)
      const who = person ? [person.name, person.role].filter(Boolean).join(', ') : ''
      return who ? t('chat.chaseIssuerContact', { name, contact: who }) : t('chat.chaseIssuer', { name })
    },
    unnamed: t('chat.chaseUnnamed'),
    late: (days) => t('chat.chaseLate', { count: days }),
    chased: (dates) => t('chat.chaseChased', { dates }),
    never: t('chat.chaseNever'),
    none: t('chat.chaseNone')
  }
}
